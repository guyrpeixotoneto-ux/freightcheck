/**
 * A LEITURA DA COMPARAÇÃO REAL — buscar os dois lados, sem recalcular nenhum.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo é
 * ---------------------------------------------------------------------------
 * A metade com SQL de `finame-real.ts`. Aquele decide (um valor de cada lado,
 * ausência com nome, nada de somar quinzenas) e não fala com banco; este busca
 * o que ele precisa e não decide nada. A separação é a de sempre neste
 * repositório, e serve para que a regra seja testável sem Postgres e a consulta
 * seja conferível sem simulação.
 *
 * ---------------------------------------------------------------------------
 * `fato_visivel`, e não `fact`
 * ---------------------------------------------------------------------------
 * Toda leitura passa pela view, como o resto do produto: ela esconde os fatos
 * das importações ocultadas, e ler `fact` cru faria esta tela mostrar um custo
 * que todas as outras deixaram de mostrar.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import type {
  RealizadoDaCompetencia,
  RemuneradoDaQuinzena,
} from "./finame-real";

/** A vigência mensal de uma competência do acervo Real. */
export interface CompetenciaDoReal {
  competencia: string;
  snapshotId: string;
  sourceLabel: string;
  canal: string;
  /** As unidades que a vigência cobre — o escopo canônico dela. */
  unidades: string[];
}

/**
 * As competências do financiamento real, da mais recente para a mais antiga.
 *
 * O filtro é por `granularidade = 'MENSAL'` **e** família, e os dois são
 * necessários: a família diz de que acervo é, e a granularidade diz que o
 * período é o mês — sem ela, uma vigência do Real que um dia chegasse quinzenal
 * (por API, por exemplo) entraria nesta lista como se fosse competência.
 */
export async function listarCompetenciasDoReal(
  db: Pick<Database, "execute">,
  opcoes: { canal?: string | null } = {},
): Promise<CompetenciaDoReal[]> {
  const { rows } = await db.execute<{
    competencia: string;
    snapshot_id: string;
    source_label: string;
    canal: string;
    unidades: string[] | null;
  }>(sql`
    SELECT s.effective_date::text AS competencia,
           s.id::text             AS snapshot_id,
           s.source_label,
           s.canal,
           array_agg(DISTINCT sc.code) FILTER (WHERE sc.scope_type = 'UNIDADE') AS unidades
      FROM snapshot s
      LEFT JOIN snapshot_scope ss ON ss.snapshot_id = s.id
      LEFT JOIN scope sc ON sc.id = ss.scope_id
     WHERE s.status <> 'SUPERSEDED'
       AND s.dataset_family = 'FINANCIAMENTO_REAL'
       AND s.granularidade = 'MENSAL'
       ${opcoes.canal ? sql`AND s.canal = ${opcoes.canal}` : sql``}
     GROUP BY s.id, s.effective_date, s.source_label, s.canal
     ORDER BY s.effective_date DESC
  `);

  return rows.map((r) => ({
    competencia: r.competencia,
    snapshotId: r.snapshot_id,
    sourceLabel: r.source_label,
    canal: r.canal,
    unidades: r.unidades ?? [],
  }));
}

/**
 * O realizado de uma competência, placa a placa.
 *
 * A contagem de lançamentos e a marca de parcial saem de
 * `finame_real_lancamento`, e não do fato: o fato é o valor, e quantos
 * documentos o compõem é rastreio. Mantê-los juntos na resposta é o que permite
 * a tela mostrar "R$ 10.817,54 · 2 lançamentos" sem uma segunda consulta por
 * linha.
 */
export async function lerRealizadoDaCompetencia(
  db: Pick<Database, "execute">,
  competencia: string,
  opcoes: { canal?: string | null } = {},
): Promise<RealizadoDaCompetencia[]> {
  const { rows } = await db.execute<{
    placa: string;
    valor: string;
    lancamentos: string | null;
  }>(sql`
    SELECT ident.identifier_value AS placa,
           f.value_numeric::text  AS valor,
           (SELECT count(*)::text
              FROM finame_real_lancamento l
             WHERE l.fact_id = f.id AND l.status = 'ACEITO') AS lancamentos
      FROM fato_visivel f
      JOIN attribute a ON a.id = f.attribute_id AND a.code LIKE '%.finame_real'
      JOIN snapshot s ON s.id = f.snapshot_id
      JOIN entity_identifier ident
        ON ident.entity_id = f.entity_id
       AND ident.identifier_type = 'PLACA'
       AND ident.is_current
     WHERE s.status <> 'SUPERSEDED'
       AND s.dataset_family = 'FINANCIAMENTO_REAL'
       AND s.granularidade = 'MENSAL'
       AND s.effective_date = ${competencia}::date
       ${opcoes.canal ? sql`AND s.canal = ${opcoes.canal}` : sql``}
       AND NOT f.is_null
  `);

  return rows.map((r) => ({
    competencia,
    placa: r.placa,
    valor: Number(r.valor),
    lancamentos: Number(r.lancamentos ?? "0"),
    /* A marca de parcial é da competência inteira; quem a calcula é a leitura
       do relatório, abaixo, e ela é aplicada a todas as linhas do mês. */
    parcial: false,
    motivoParcial: null,
  }));
}

/**
 * O remunerado das quinzenas de um mês, placa a placa.
 *
 * Traz as **duas** quinzenas quando existem, e traz o valor de cada uma em
 * separado — é assim que `remuneradoDoMes` pode dizer "as duas concordam" ou
 * "as duas discordam" em vez de receber um número já escolhido por esta
 * consulta. Escolher aqui seria esconder a divergência antes de alguém vê-la.
 */
export async function lerRemuneradoDoMes(
  db: Pick<Database, "execute">,
  competencia: string,
  opcoes: { canal?: string | null; codigos?: readonly string[] } = {},
): Promise<RemuneradoDaQuinzena[]> {
  const codigos = opcoes.codigos ?? ["cavalo.finame_cavalo", "carreta.finame_implemento"];

  const { rows } = await db.execute<{
    placa: string;
    valor: string | null;
    effective_date: string;
    source_label: string;
  }>(sql`
    SELECT ident.identifier_value AS placa,
           f.value_numeric::text  AS valor,
           s.effective_date::text AS effective_date,
           s.source_label
      FROM fato_visivel f
      JOIN attribute a ON a.id = f.attribute_id
      JOIN snapshot s ON s.id = f.snapshot_id
      JOIN entity_identifier ident
        ON ident.entity_id = f.entity_id
       AND ident.identifier_type = 'PLACA'
       AND ident.is_current
     WHERE s.status <> 'SUPERSEDED'
       AND s.dataset_family = 'REMUNERACAO_EQUIPAMENTO'
       AND date_trunc('month', s.effective_date) = ${competencia}::date
       ${opcoes.canal ? sql`AND s.canal = ${opcoes.canal}` : sql``}
       AND a.code IN (${sql.join(
         codigos.map((c) => sql`${c}`),
         sql`, `,
       )})
       AND NOT f.is_null
  `);

  return rows.map((r) => ({
    placa: r.placa,
    /* A quinzena sai do dia, pela mesma régua do resto do produto: dia ≤ 15 é a
       primeira. Ela não é relida do rótulo aqui porque o rótulo é da fonte e
       pode vir grafado de mais de um jeito; a data é derivada por regra testada. */
    quinzena: Number(r.effective_date.slice(8, 10)) <= 15 ? 1 : 2,
    label: r.source_label,
    effectiveDate: r.effective_date,
    valor: r.valor === null ? null : Number(r.valor),
  }));
}

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
 */
const DOS_RUNS_ATIVOS = sql`
  l.import_run_id IN (
    SELECT DISTINCT ON (ir.source_file_id) ir.id
      FROM import_run ir
     WHERE ir.source_file_id IN (
             SELECT dono.source_file_id
               FROM import_run dono
               JOIN snapshot s ON s.import_run_id = dono.id
              WHERE s.dataset_family = 'FINANCIAMENTO_REAL'
                AND s.status <> 'SUPERSEDED'
           )
       AND EXISTS (
             SELECT 1 FROM finame_real_lancamento x WHERE x.import_run_id = ir.id
           )
     ORDER BY ir.source_file_id, ir.started_at DESC
  )
`;

export async function lerPendenciasDoReal(
  db: Pick<Database, "execute">,
): Promise<PendenciasDoReal> {
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
       AND ${DOS_RUNS_ATIVOS}
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
       AND ${DOS_RUNS_ATIVOS}
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
       AND ${DOS_RUNS_ATIVOS}
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
       AND ${DOS_RUNS_ATIVOS}
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
