/**
 * AS PENDÊNCIAS DO REALIZADO — o que ficou de fora da soma, e por quê.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo é
 * ---------------------------------------------------------------------------
 * A leitura das duas filas que a importação do extrato produz — a duplicata
 * provável e a placa sem tipo de ativo — mais o rastreio de um valor até os
 * lançamentos que o compõem.
 *
 * Ele não compara nada: o confronto Remunerado × Realizado é de
 * `confronto-de-finame.ts`, e o número do realizado chega lá pelo adaptador
 * (`fonte-real-do-acervo.ts`). O que mora aqui é o que **não** entrou naquele
 * número, que é a outra metade da honestidade: um consolidado que esconde o que
 * ficou de fora é uma soma sem origem.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";

export interface PendenciasDoReal {
  duplicatas: {
    competencia: string;
    placa: string;
    numdoc: string;
    valor: number;
    motivo: string | null;
    linhaRepetida: number;
    /**
     * O endereço da pendência: o hash da impressão digital da linha.
     *
     * **Não** é a chave contábil. Aquela agrupa principal e juros do mesmo
     * documento — dois lançamentos legítimos —, e uma confirmação de duplicata
     * endereçada por ela apagaria o juro junto com a repetição.
     *
     * `null` num lançamento lido antes de a coluna existir: a pendência é real,
     * mas não tem endereço até o mês ser reimportado.
     */
    impressaoHash: string | null;
  }[];
  semClassificacao: {
    placa: string;
    competencias: string[];
    lancamentos: number;
    valor: number;
    /** A conta contábil que o extrato traz — evidência, nunca regra. */
    contas: string[];
  }[];
  /** Quantos lançamentos foram somados em cada competência, para a marca de parcial. */
  porCompetencia: { competencia: string; lancamentos: number; placas: number }[];
}

/**
 * O que ficou de fora e por quê — a matéria-prima das duas filas da tela.
 *
 * Uma consulta por fila, e não uma por linha: as duas são listas curtas por
 * natureza (cinco duplicatas e oito placas, no extrato de 2026), e o que
 * importa é que elas sejam **lidas do banco**, e não recalculadas a partir do
 * arquivo — o arquivo já não está mais lá quando alguém abre a tela.
 */
/**
 * Os lançamentos que **contam** — a leitura mais recente do arquivo que
 * sustenta cada vigência ativa.
 *
 * ---------------------------------------------------------------------------
 * Por que não basta "o run que promoveu"
 * ---------------------------------------------------------------------------
 * Um arquivo relido produz um segundo conjunto de lançamentos, e o primeiro
 * continua no banco: cada importação guarda a leitura dela, e apagar a anterior
 * seria apagar a história de como aquele mês foi lido. Sem recorte nenhum a tela
 * soma os dois — a releitura do extrato real mostrou dez duplicatas onde há
 * cinco, cada uma aparecendo duas vezes.
 *
 * Recortar pelo run que promoveu a vigência resolve a duplicidade e cria outro
 * problema, e ele também apareceu no app: a releitura com o leitor novo foi
 * reconhecida como **mesmo conteúdo** (`SKIPPED_DUPLICATE_DATA`, que é a
 * idempotência funcionando), então nenhuma revisão foi aberta e a vigência ativa
 * continuou sendo do run antigo. A tela passou a mostrar a leitura velha — sem o
 * endereço que o leitor novo grava — e as pendências ficaram indecidíveis.
 *
 * O recorte certo tem dois passos, e é o que está escrito abaixo: **qual
 * arquivo** sustenta uma vigência ativa, e **qual leitura dele** é a mais
 * recente que produziu lançamentos. O primeiro passo é a autoridade de sempre —
 * a vigência ativa decide o que é verdade hoje; o segundo é o que faz reler um
 * arquivo com um leitor melhor servir para alguma coisa.
 *
 * E o canal entra no primeiro passo, e não como filtro depois: a operação é o
 * mesmo eixo que recorta todo o resto deste produto, e quem audita a Rota não
 * tem por que ver as pendências da Empurrada. Ele viaja em cada pergunta porque
 * a autorização é por requisição, nunca guardada.
 */
function dosRunsAtivos(canal?: string | null) {
  return sql`
  l.import_run_id IN (
    SELECT DISTINCT ON (ir.source_file_id) ir.id
      FROM import_run ir
     WHERE ir.source_file_id IN (
             SELECT dono.source_file_id
               FROM import_run dono
               JOIN snapshot s ON s.import_run_id = dono.id
              WHERE s.dataset_family = 'FINANCIAMENTO_REAL'
                AND s.status <> 'SUPERSEDED'
                ${canal ? sql`AND s.canal = ${canal}` : sql``}
           )
       AND EXISTS (
             SELECT 1 FROM finame_real_lancamento x WHERE x.import_run_id = ir.id
           )
     ORDER BY ir.source_file_id, ir.started_at DESC
  )
`;
}

export async function lerPendenciasDoReal(
  db: Pick<Database, "execute">,
  opcoes: { canal?: string | null } = {},
): Promise<PendenciasDoReal> {
  const dosRunsDoCanal = dosRunsAtivos(opcoes.canal);
  const { rows: duplicatas } = await db.execute<{
    competencia: string;
    placa: string;
    numdoc: string;
    valor: string;
    motivo: string | null;
    raw_row_id: string;
    chave: string | null;
  }>(sql`
    SELECT l.competencia::text AS competencia,
           l.placa,
           l.numdoc,
           l.valor_absoluto::text AS valor,
           l.motivo,
           r.row_index::text AS raw_row_id,
           l.impressao_hash AS chave
      FROM finame_real_lancamento l
      JOIN raw_row r ON r.id = l.raw_row_id
     WHERE l.status = 'DUPLICATA_PROVAVEL'
       AND ${dosRunsDoCanal}
     ORDER BY l.competencia, l.placa
  `);

  const { rows: semTipo } = await db.execute<{
    placa: string;
    competencias: string[];
    lancamentos: string;
    valor: string;
    contas: string[];
  }>(sql`
    SELECT l.placa,
           array_agg(DISTINCT l.competencia::text ORDER BY l.competencia::text) AS competencias,
           count(*)::text AS lancamentos,
           sum(l.valor_absoluto)::text AS valor,
           array_agg(DISTINCT coalesce(l.conta_analitica, 'sem conta')) AS contas
      FROM finame_real_lancamento l
     WHERE l.status = 'PENDENTE_DE_CLASSIFICACAO'
       AND ${dosRunsDoCanal}
     GROUP BY l.placa
     ORDER BY sum(l.valor_absoluto) DESC
  `);

  const { rows: porCompetencia } = await db.execute<{
    competencia: string;
    lancamentos: string;
    placas: string;
  }>(sql`
    SELECT l.competencia::text AS competencia,
           count(*)::text AS lancamentos,
           count(DISTINCT l.placa)::text AS placas
      FROM finame_real_lancamento l
     WHERE l.status = 'ACEITO'
       AND ${dosRunsDoCanal}
     GROUP BY l.competencia
     ORDER BY l.competencia
  `);

  return {
    duplicatas: duplicatas.map((d) => ({
      competencia: d.competencia,
      placa: d.placa,
      numdoc: d.numdoc,
      valor: Number(d.valor),
      motivo: d.motivo,
      linhaRepetida: Number(d.raw_row_id),
      impressaoHash: d.chave,
    })),
    semClassificacao: semTipo.map((s) => ({
      placa: s.placa,
      competencias: s.competencias,
      lancamentos: Number(s.lancamentos),
      valor: Number(s.valor),
      contas: s.contas,
    })),
    porCompetencia: porCompetencia.map((c) => ({
      competencia: c.competencia,
      lancamentos: Number(c.lancamentos),
      placas: Number(c.placas),
    })),
  };
}

/**
 * Os lançamentos que compõem um valor — a expansão do número na tela.
 *
 * É o que transforma "R$ 15.478,60 em maio" em "dois documentos, principal e
 * juros, filial 19, escriturados em 27/05". Sem isto o consolidado seria uma
 * soma sem origem, que é exatamente o que este produto não entrega.
 */
export async function lerLancamentosDaPlaca(
  db: Pick<Database, "execute">,
  competencia: string,
  placa: string,
  opcoes: { canal?: string | null } = {},
): Promise<
  {
    numdoc: string;
    valor: number;
    valorOriginal: number;
    conta: string | null;
    filial: string | null;
    escrituracao: string | null;
    status: string;
    motivo: string | null;
    linha: number;
    aba: string;
    arquivo: string | null;
  }[]
> {
  const { rows } = await db.execute<{
    numdoc: string;
    valor: string;
    valor_original: string;
    conta: string | null;
    filial: string | null;
    escrituracao: string | null;
    status: string;
    motivo: string | null;
    linha: string;
    aba: string;
    arquivo: string | null;
  }>(sql`
    SELECT l.numdoc,
           l.valor_absoluto::text AS valor,
           l.valor_original::text AS valor_original,
           l.conta_analitica AS conta,
           l.codfil AS filial,
           l.datatu::text AS escrituracao,
           l.status,
           l.motivo,
           r.row_index::text AS linha,
           sh.sheet_name AS aba,
           sf.filename AS arquivo
      FROM finame_real_lancamento l
      JOIN raw_row r ON r.id = l.raw_row_id
      JOIN raw_sheet sh ON sh.id = r.raw_sheet_id
      JOIN import_run ir ON ir.id = l.import_run_id
      LEFT JOIN source_file sf ON sf.id = ir.source_file_id
     WHERE l.competencia = ${competencia}::date
       AND l.placa = ${placa}
       AND ${dosRunsAtivos(opcoes.canal)}
     ORDER BY r.row_index
  `);

  return rows.map((r) => ({
    numdoc: r.numdoc,
    valor: Number(r.valor),
    valorOriginal: Number(r.valor_original),
    conta: r.conta,
    filial: r.filial,
    escrituracao: r.escrituracao,
    status: r.status,
    motivo: r.motivo,
    linha: Number(r.linha),
    aba: r.aba,
    arquivo: r.arquivo,
  }));
}
