/**
 * APLICAR UMA DECISÃO DO REAL — de "eu classifiquei" a "o número mudou".
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo resolve
 * ---------------------------------------------------------------------------
 * Registrar uma decisão era barato e não mudava nada: a linha entrava em
 * `financiamento_real_decisao`, e o valor só passava a contar quando alguém
 * reimportasse aquele mês à mão. Quem classificava oito placas via as oito
 * continuarem na fila, com a soma na tela igual à de antes — e a resposta
 * honesta para "por que não mudou?" era um pedido de trabalho manual.
 *
 * Aqui a decisão vira número no mesmo clique. Sem novo upload e sem
 * reimportação manual: o extrato inteiro continua em RAW (`raw_row`/`raw_cell`,
 * as 43 colunas verbatim, append-only), `estagiarExtratoReal` já lê de lá e não
 * do arquivo, e `apurar` é função pura das linhas mais as decisões conhecidas.
 * Reler o RAW com a decisão nova na mão produz exatamente a mesma transformação
 * da importação — é a **mesma** função, e não uma segunda cópia dela.
 *
 * ---------------------------------------------------------------------------
 * Por que aplicar é abrir revisão, e não escrever na vigência
 * ---------------------------------------------------------------------------
 * Porque o banco não deixa, e não deixa de propósito. O gatilho
 * `fact_immutable` (`0001`) recusa INSERT, UPDATE e DELETE em fato de snapshot
 * que não esteja em DRAFT, e toda vigência ativa está em CLOSED. "Gerar ou
 * atualizar o fato visível" dentro da vigência de pé não é difícil: é proibido
 * pela mesma garantia que sustenta todo número do produto — *correção entra
 * como revisão nova, nunca como edição*.
 *
 * Então a aplicação faz o que a correção sempre fez, só que sozinha: uma
 * leitura nova sobre o RAW já guardado, `preview`, e `promote` em
 * `NEW_REVISION`. A vigência alcançada vira revisão N+1 e a N passa a
 * SUPERSEDED, numa transação só, com quem aplicou e por quê no histórico. Nada
 * é sobrescrito em silêncio, e nenhum período protegido muda de forma alguma:
 * o que estava lá continua lá, como revisão anterior.
 *
 * ---------------------------------------------------------------------------
 * Idempotência — e por que ela não é uma trava, é uma consequência
 * ---------------------------------------------------------------------------
 * Dois cliques no mesmo botão não duplicam fato nenhum, e não porque haja um
 * `if (jaAplicou)` em algum lugar: a segunda passada relê o mesmo RAW com o
 * mesmo conjunto de decisões, produz o mesmo conteúdo normalizado, e `promote`
 * reconhece vigência por vigência que o payload é idêntico ao que já está ativo
 * — `DUPLICATA_DE_DADOS`, nenhuma revisão aberta. A mesma razão faz as
 * competências que a decisão **não** alcança ficarem paradas: só muda a
 * vigência cujo conteúdo mudou.
 *
 * ---------------------------------------------------------------------------
 * O que é transacional, e o que é sequencial
 * ---------------------------------------------------------------------------
 * A escrita canônica — snapshot novo, fatos, supersede da revisão anterior — é
 * uma transação só, a de `promote`. Ou ela entra inteira ou não entra nada: uma
 * falha no meio não deixa meia revisão de pé.
 *
 * A decisão é gravada **antes**, e comitada, por duas razões. A primeira é que
 * `estagiarExtratoReal` lê as decisões do banco: uma decisão dentro de uma
 * transação aberta seria invisível para a própria releitura que ela deve
 * governar. A segunda é que decidir e aplicar são dois atos, e o primeiro
 * aconteceu — se a revisão falhar, o certo é a decisão continuar registrada,
 * com o motivo da falha ao lado e `aplicada_em` nulo, e não sumir como se
 * ninguém tivesse olhado.
 */

import { eq, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  financiamentoRealDecisaoTable,
  importRunTable,
  unidadeTable,
} from "@workspace/db/schema";
import { markRunFailed, preview, promote, PromocaoRecusada } from "../pipeline";
import { ACERVOS } from "../tipos";
import { estagiarExtratoReal, vincularLancamentosAosFatos } from "./estagio";
import type { TipoDeDecisao } from "./agregacao";

/** As três decisões que a tela registra. A lista mora no domínio. */
export const TIPOS_DE_DECISAO: readonly TipoDeDecisao[] = [
  "DUPLICATA_CONFIRMADA",
  "LANCAMENTOS_DISTINTOS",
  "CLASSIFICAR_ATIVO",
];

/** Os tipos que o acervo Real aceita. A lista mora no domínio, e é lida dele. */
const TIPOS_DO_ACERVO_REAL: readonly string[] =
  ACERVOS.find((a) => a.code === "REAL")?.tipos ?? [];

/**
 * A recusa da aplicação, com o código que a tela mostra.
 *
 * Erro com nome, como as recusas do pipeline: quem opera precisa saber **qual**
 * conferência barrou para saber o que fazer, e um texto livre obrigaria a tela
 * a adivinhar por substring.
 */
export class AplicacaoRecusada extends Error {
  constructor(
    readonly codigo:
      | "DECISAO_INVALIDA"
      | "LEITURA_ABERTA"
      | "SEM_VIGENCIA_ATIVA"
      | "REVISAO_RECUSADA",
    message: string,
    readonly detalhe: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AplicacaoRecusada";
  }
}

export interface DecisaoParaAplicar {
  tipo: string;
  /** A impressão digital do grupo repetido, ou a placa normalizada. */
  chave: string;
  /** O `entity_type` escolhido, em `CLASSIFICAR_ATIVO`. */
  valor?: string | null;
  motivo: string;
  decididoPor: string;
}

/** Uma vigência que a aplicação mexeu — ou reconheceu como já igual. */
export interface VigenciaDaAplicacao {
  label: string;
  revisao: number;
  snapshotId: string;
  fatos: number;
}

export interface ResultadoDaAplicacao {
  decisaoId: string;
  /** Houve revisão nova? Falso no clique repetido e na decisão sem alcance. */
  aplicada: boolean;
  /** Os lançamentos que a decisão alcançou, medidos antes de aplicar. */
  lancamentosAfetados: number;
  /** As competências alcançadas, `YYYY-MM-01`, em ordem. */
  competencias: string[];
  /** As placas alcançadas — uma, na classificação; uma, na duplicata. */
  placas: string[];
  /** O valor que estava fora do confronto e a decisão move, em positivo. */
  valor: number;
  /** As vigências que ganharam revisão nova. */
  revisoes: VigenciaDaAplicacao[];
  /** As leituras que a aplicação abriu — uma por arquivo alcançado. */
  importRunIds: string[];
  /** A frase que a tela mostra. Diz o que aconteceu, não o que vai acontecer. */
  efeito: string;
}

interface AlcanceDaDecisao {
  importRunId: string;
  sourceFileId: string;
  competencias: string[];
  placas: string[];
  lancamentos: number;
  valor: number;
}

/**
 * Registrar a decisão e aplicá-la — na mesma chamada, nesta ordem.
 *
 * Devolve o que aconteceu, e não o que aconteceria: quantos lançamentos a
 * decisão alcançou, que competências, e que revisões foram abertas.
 */
export async function aplicarDecisaoDoReal(
  db: Database,
  decisao: DecisaoParaAplicar,
  opcoes: { canal?: string | null } = {},
): Promise<ResultadoDaAplicacao> {
  const tipo = validarDecisao(decisao);

  /*
    O alcance é medido **antes** de a decisão existir, e por isso mede o que a
    fila tinha: os lançamentos que estão parados esperando esta resposta. Medido
    depois, ele seria o resultado da própria decisão — e responderia "nenhum" no
    exato caso em que tudo deu certo.
  */
  const alcance = await medirAlcance(db, tipo, decisao.chave, opcoes.canal ?? null);

  const competencias = [...new Set(alcance.flatMap((a) => a.competencias))].sort();
  const placas = [...new Set(alcance.flatMap((a) => a.placas))].sort();
  const lancamentosAfetados = alcance.reduce((s, a) => s + a.lancamentos, 0);
  const valor = arredondar(alcance.reduce((s, a) => s + a.valor, 0));

  const [gravada] = await db
    .insert(financiamentoRealDecisaoTable)
    .values({
      tipo,
      chave: decisao.chave,
      valor: decisao.valor ?? null,
      motivo: decisao.motivo,
      decididoPor: decisao.decididoPor,
      competencias,
      lancamentosAfetados,
    })
    .returning();

  /*
    Decisão sem alcance não é erro, e não abre leitura nenhuma.

    É o segundo clique no mesmo botão, e é a decisão sobre uma pendência que
    outra releitura já resolveu. Nos dois casos não há o que reprocessar: o
    trabalho seria reler o extrato inteiro para reescrever exatamente o que já
    está lá. A decisão fica registrada — alguém decidiu, e isso é história —, e
    a resposta diz que não havia o que mover.
  */
  if (alcance.length === 0) {
    const efeito =
      "A decisão ficou registrada. Não havia lançamento pendente com este endereço — " +
      "ou ela já tinha sido aplicada, ou outra releitura deste mês já a resolveu. " +
      "Nada foi reprocessado e nenhum valor mudou.";
    await db
      .update(financiamentoRealDecisaoTable)
      .set({ aplicacaoResultado: { aplicada: false, motivo: efeito } })
      .where(eq(financiamentoRealDecisaoTable.id, gravada.id));
    return {
      decisaoId: gravada.id,
      aplicada: false,
      lancamentosAfetados: 0,
      competencias: [],
      placas: [],
      valor: 0,
      revisoes: [],
      importRunIds: [],
      efeito,
    };
  }

  const revisoes: VigenciaDaAplicacao[] = [];
  const importRunIds: string[] = [];
  const semMudanca: string[] = [];

  try {
    for (const alvo of alcance) {
      const aplicado = await reprocessarArquivo(db, alvo, {
        decisao,
        decisaoId: gravada.id,
      });
      importRunIds.push(aplicado.importRunId);
      revisoes.push(...aplicado.revisoes);
      semMudanca.push(...aplicado.semMudanca);
    }
  } catch (err) {
    /*
      A decisão sobrevive à falha da aplicação, com o motivo ao lado.

      Apagá-la seria apagar o único registro de que alguém olhou aquela
      pendência, para esconder que a revisão não subiu — e o estado real da
      operação passa a ser justamente esse: decidido, não aplicado.
    */
    await db
      .update(financiamentoRealDecisaoTable)
      .set({
        aplicacaoResultado: {
          aplicada: false,
          erro: err instanceof Error ? err.message : String(err),
          codigo: err instanceof AplicacaoRecusada ? err.codigo : "FALHA",
        },
      })
      .where(eq(financiamentoRealDecisaoTable.id, gravada.id));
    throw err;
  }

  const efeito = frasear(revisoes, semMudanca, valor, competencias);

  await db
    .update(financiamentoRealDecisaoTable)
    .set({
      aplicadaEm: new Date(),
      aplicadaPor: decisao.decididoPor,
      aplicacaoRunId: importRunIds[0] ?? null,
      aplicacaoResultado: {
        aplicada: revisoes.length > 0,
        revisoes,
        semMudanca,
        importRunIds,
        valor,
      },
    })
    .where(eq(financiamentoRealDecisaoTable.id, gravada.id));

  return {
    decisaoId: gravada.id,
    aplicada: revisoes.length > 0,
    lancamentosAfetados,
    competencias,
    placas,
    valor,
    revisoes,
    importRunIds,
    efeito,
  };
}

function validarDecisao(decisao: DecisaoParaAplicar): TipoDeDecisao {
  const tipo = decisao.tipo.trim() as TipoDeDecisao;
  if (!TIPOS_DE_DECISAO.includes(tipo)) {
    throw new AplicacaoRecusada(
      "DECISAO_INVALIDA",
      `"${decisao.tipo}" não é uma decisão conhecida. As três são: ${TIPOS_DE_DECISAO.join(", ")}.`,
    );
  }
  if (decisao.chave.trim() === "") {
    throw new AplicacaoRecusada(
      "DECISAO_INVALIDA",
      "A decisão precisa dizer sobre o que ela é.",
    );
  }
  /*
    O motivo é obrigatório, e não é burocracia: uma decisão sem motivo não é
    auditável, e daqui a seis meses ninguém vai lembrar por que aquelas duas
    linhas viraram uma só.
  */
  if (decisao.motivo.trim() === "") {
    throw new AplicacaoRecusada(
      "DECISAO_INVALIDA",
      "Escreva o motivo da decisão. Sem ele, quem ler o histórico daqui a seis meses " +
        "vê o que foi decidido e não por quê.",
    );
  }
  if (tipo === "CLASSIFICAR_ATIVO") {
    const escolhido = (decisao.valor ?? "").trim();
    if (escolhido === "") {
      throw new AplicacaoRecusada(
        "DECISAO_INVALIDA",
        "Classificar um ativo exige dizer de que tipo ele é.",
      );
    }
    /*
      E o tipo tem de ser um dos que o acervo Real aceita — a mesma lista que o
      seletor da tela oferece, lida do mesmo lugar.

      Sem esta conferência, a rota aceitaria um tipo que a tela não tem como
      mandar, e a aplicação o criaria: `confirmNewEntityTypes` leva o tipo
      escolhido porque escolher **é** declarar, e uma declaração que ninguém
      podia fazer pela tela viraria uma frota paralela entrando por um erro de
      digitação em `curl`.
    */
    if (!TIPOS_DO_ACERVO_REAL.includes(escolhido)) {
      throw new AplicacaoRecusada(
        "DECISAO_INVALIDA",
        `"${escolhido}" não é um tipo de ativo do acervo Real. Os aceitos são: ` +
          `${TIPOS_DO_ACERVO_REAL.join(", ")}.`,
      );
    }
  }
  return tipo;
}

/**
 * O que esta decisão move, arquivo por arquivo.
 *
 * O recorte é o mesmo da fila que a tela lê (`lerPendenciasDoReal`): a leitura
 * mais recente de cada arquivo que sustenta uma vigência ativa. Um lançamento
 * de uma leitura velha não está na fila de ninguém, e reprocessá-lo abriria
 * revisão sobre um arquivo que já foi relido.
 */
async function medirAlcance(
  db: Database,
  tipo: TipoDeDecisao,
  chave: string,
  canal: string | null,
): Promise<AlcanceDaDecisao[]> {
  const pendente =
    tipo === "CLASSIFICAR_ATIVO"
      ? sql`l.placa = ${chave} AND l.status = 'PENDENTE_DE_CLASSIFICACAO'`
      : sql`l.impressao_hash = ${chave} AND l.status = 'DUPLICATA_PROVAVEL'`;

  const { rows } = await db.execute<{
    import_run_id: string;
    source_file_id: string;
    competencias: string[];
    placas: string[];
    lancamentos: string;
    valor: string;
  }>(sql`
    SELECT l.import_run_id,
           ir.source_file_id,
           array_agg(DISTINCT l.competencia::text ORDER BY l.competencia::text) AS competencias,
           array_agg(DISTINCT l.placa) AS placas,
           count(*)::text AS lancamentos,
           sum(l.valor_absoluto)::text AS valor
      FROM finame_real_lancamento l
      JOIN import_run ir ON ir.id = l.import_run_id
     WHERE ${pendente}
       AND l.import_run_id IN (
             SELECT DISTINCT ON (r.source_file_id) r.id
               FROM import_run r
              WHERE r.source_file_id IN (
                      SELECT dono.source_file_id
                        FROM import_run dono
                        JOIN snapshot s ON s.import_run_id = dono.id
                       WHERE s.dataset_family = 'FINANCIAMENTO_REAL'
                         AND s.status <> 'SUPERSEDED'
                         ${canal ? sql`AND s.canal = ${canal}` : sql``}
                    )
                AND EXISTS (
                      SELECT 1 FROM finame_real_lancamento x WHERE x.import_run_id = r.id
                    )
              ORDER BY r.source_file_id, r.started_at DESC
           )
     GROUP BY l.import_run_id, ir.source_file_id
  `);

  return rows.map((r) => ({
    importRunId: r.import_run_id,
    sourceFileId: r.source_file_id,
    competencias: r.competencias,
    placas: r.placas,
    lancamentos: Number(r.lancamentos),
    valor: arredondar(Number(r.valor)),
  }));
}

/**
 * Reler um arquivo do RAW já guardado e publicar a revisão que a decisão pede.
 *
 * A esteira é a de sempre — estágio, pré-visualização, promoção —, e é essa a
 * razão de ela estar aqui em cinco linhas em vez de virar um caminho próprio:
 * tudo o que o pipeline garante depois do staging (identidade canônica,
 * herança entre revisões, escopo obrigatório, presença, cobertura,
 * imutabilidade) continua valendo sem uma exceção escrita para este botão.
 */
async function reprocessarArquivo(
  db: Database,
  alvo: AlcanceDaDecisao,
  contexto: { decisao: DecisaoParaAplicar; decisaoId: string },
): Promise<{
  importRunId: string;
  revisoes: VigenciaDaAplicacao[];
  semMudanca: string[];
}> {
  await recusarSeHouverLeituraAberta(db, alvo.sourceFileId);
  const anterior = await lerRunAnterior(db, alvo.importRunId);

  const novoRunId = await abrirLeituraDaAplicacao(db, alvo, anterior, contexto);

  let promovida: Awaited<ReturnType<typeof promote>>;
  try {
    await clonarRaw(db, alvo.importRunId, novoRunId);

    const unidadeNome = await nomeDaUnidade(db, anterior.declaredUnidade);
    await estagiarExtratoReal(db, novoRunId, { unidadeNome });
    await preview(db, novoRunId);

    /*
      `NEW_REVISION` é declarado aqui porque **é** o que está sendo pedido: a
      pessoa classificou um ativo que a vigência ativa não conta, e contá-lo
      reescreve aquele mês. Sem a declaração, `promote` recusaria com
      `VIGENCIA_ATIVA_EXISTENTE` — e recusaria com razão, porque correção sem
      quem a assuma é sobrescrita silenciosa.

      O tipo classificado viaja em `confirmNewEntityTypes` pela mesma lógica:
      criar equipamento é declaração de quem promove, e escolher o tipo no
      seletor da fila *é* essa declaração. Um tipo que não seja esse continua
      barrando a promoção, como deve.
    */
    promovida = await promote(db, novoRunId, {
      onExistingSnapshot: "NEW_REVISION",
      promotedBy: contexto.decisao.decididoPor,
      confirmNewEntityTypes:
        contexto.decisao.tipo === "CLASSIFICAR_ATIVO" && contexto.decisao.valor
          ? [contexto.decisao.valor]
          : [],
    });
  } catch (err) {
    /*
      A leitura aberta não pode ficar aberta.

      `import_run_leitura_aberta_uq` permite uma por arquivo, e um run parado em
      STAGED depois de uma falha trancaria toda aplicação seguinte — e a
      importação legítima daquele mês junto. Fechar aqui é o que faz a recusa
      ser um "não deu", e não um beco.
    */
    await markRunFailed(
      db,
      novoRunId,
      err instanceof Error ? err.message : String(err),
    ).catch(() => undefined);

    /*
      E os lançamentos da leitura que não vingou saem junto — este é o passo que
      falta em toda limpeza pela metade.

      A fila da tela lê a leitura **mais recente** de cada arquivo, e a que
      acabou de falhar é a mais recente. Deixá-la com os lançamentos gravados
      faria a pendência sumir da tela sobre um fato que não mudou: a decisão já
      estaria aplicada nas linhas e não estaria no dinheiro — que é a pior das
      duas metades, porque não se vê.

      Apagar é seguro porque a tabela é derivada: cada linha é a leitura de uma
      linha de planilha que continua em `raw_cell`, e a próxima aplicação a
      reconstrói idêntica. O run fica, com o motivo da falha, porque **ele** é
      história: alguém tentou aplicar e não deu. O RAW clonado fica com ele, e
      fica porque RAW é imutável por gatilho — apagá-lo seria pedir ao banco
      para desfazer uma captura, que é justamente o que ele não faz.
    */
    await db
      .execute(
        sql`DELETE FROM finame_real_lancamento WHERE import_run_id = ${novoRunId}::uuid`,
      )
      .catch(() => undefined);

    if (err instanceof PromocaoRecusada) {
      throw new AplicacaoRecusada(
        "REVISAO_RECUSADA",
        `A revisão da vigência foi recusada: ${err.message} Nada foi gravado, e a decisão ` +
          `continua registrada.`,
        { decisao: err.decisao, ...err.detalhe },
      );
    }
    throw err;
  }

  /*
    O rastreio fecha **depois** da promoção, e fora do `try` de propósito.

    Ligar lançamento a fato só é possível quando o fato existe, e neste ponto
    ele existe: a vigência entrou. Uma falha daqui para baixo é um rastreio
    incompleto — sério, e conserta-se rodando de novo —, e não motivo para
    limpar lançamento nenhum: a limpeza acima existe para a aplicação que **não**
    aconteceu, e aplicá-la a uma que aconteceu apagaria as linhas que explicam
    o número que acabou de entrar.
  */
  await vincularLancamentosAosFatos(db, novoRunId);

  return {
    importRunId: novoRunId,
    revisoes: promovida.snapshots.map((s) => ({
      label: s.label,
      revisao: s.revision,
      snapshotId: s.id,
      fatos: s.factCount,
    })),
    /*
      As vigências que a releitura reconheceu como já iguais. Não é sobra: é o
      que prova que a aplicação mexe só no mês que a decisão alcança, e é o que
      o segundo clique produz por inteiro.
    */
    semMudanca: promovida.duplicadasPorDados,
  };
}

/**
 * Uma leitura aberta do mesmo arquivo barra a aplicação — e a frase diz qual.
 *
 * Não é uma precaução: é o índice `import_run_leitura_aberta_uq`, que admite
 * uma leitura por decidir por arquivo. Descobrir isso pelo 23505 do Postgres
 * daria a mesma proteção com a pior frase possível.
 */
async function recusarSeHouverLeituraAberta(
  db: Database,
  sourceFileId: string,
): Promise<void> {
  const { rows } = await db.execute<{ id: string; status: string }>(sql`
    SELECT id, status FROM import_run
     WHERE source_file_id = ${sourceFileId}::uuid
       AND status IN ('PENDING', 'READING', 'STAGED', 'PREVIEWED', 'PROMOTING')
     LIMIT 1
  `);
  const aberta = rows[0];
  if (!aberta) return;

  throw new AplicacaoRecusada(
    "LEITURA_ABERTA",
    `Já existe uma leitura deste extrato esperando decisão (${aberta.status}). Aplicar agora ` +
      `abriria uma segunda leitura do mesmo arquivo, e as duas disputariam a mesma vigência. ` +
      `Conclua ou cancele aquela importação em Importações e aplique de novo — a decisão já ` +
      `ficou registrada.`,
    { importRunId: aberta.id, status: aberta.status },
  );
}

async function lerRunAnterior(
  db: Database,
  importRunId: string,
): Promise<typeof importRunTable.$inferSelect> {
  const [run] = await db
    .select()
    .from(importRunTable)
    .where(eq(importRunTable.id, importRunId));
  if (!run) {
    throw new AplicacaoRecusada(
      "SEM_VIGENCIA_ATIVA",
      "A importação que trouxe este lançamento não existe mais — não há o que reler.",
    );
  }
  return run;
}

/**
 * A leitura que a aplicação abre — um `import_run` novo sobre o mesmo arquivo.
 *
 * É um reprocessamento, e diz isso no banco: `reprocess_of_run_id` aponta para
 * a leitura relida e `reprocess_reason` conta por quê, as duas viajando juntas
 * como a `0040` exige. A declaração inteira é herdada — tipo, família,
 * granularidade, competência e unidade —, porque reler um arquivo nunca
 * desdeclara nada sobre ele.
 */
async function abrirLeituraDaAplicacao(
  db: Database,
  alvo: AlcanceDaDecisao,
  anterior: typeof importRunTable.$inferSelect,
  contexto: { decisao: DecisaoParaAplicar; decisaoId: string },
): Promise<string> {
  const alvoDaDecisao =
    contexto.decisao.tipo === "CLASSIFICAR_ATIVO"
      ? `a placa ${alvo.placas.join(", ")} como ${contexto.decisao.valor}`
      : `a linha repetida ${contexto.decisao.chave.slice(0, 12)}`;

  const [novo] = await db
    .insert(importRunTable)
    .values({
      sourceFileId: alvo.sourceFileId,
      status: "PENDING",
      triggeredBy: contexto.decisao.decididoPor,
      reprocessOfRunId: alvo.importRunId,
      reprocessReason:
        `Aplicação de decisão do financiamento real: ${alvoDaDecisao}. ` +
        `Motivo de quem decidiu: ${contexto.decisao.motivo}. ` +
        `Decisão ${contexto.decisaoId}.`,
      declaredType: anterior.declaredType,
      declaredFamily: anterior.declaredFamily,
      declaredPeriod: anterior.declaredPeriod,
      declaredGranularity: anterior.declaredGranularity,
      declaredCompetence: anterior.declaredCompetence,
      declaredUnidade: anterior.declaredUnidade,
    })
    .returning({ id: importRunTable.id });

  return novo.id;
}

/**
 * Copiar o RAW da leitura anterior para a nova — o que substitui o upload.
 *
 * ---------------------------------------------------------------------------
 * Por que copiar, e não apontar para o RAW do outro run
 * ---------------------------------------------------------------------------
 * Porque o RAW é de quem o leu. Fatos de uma revisão nova apontando para
 * células de um run antigo fariam a exclusão daquela importação — que apaga o
 * RAW dela em cascata — derrubar a origem de um fato vivo, e o rastreio do
 * número na tela morreria com ela. Copiado, cada leitura continua com a sua, e
 * a garantia de sempre segue valendo: todo fato aponta para a célula que o
 * originou, dentro da leitura que o produziu.
 *
 * ---------------------------------------------------------------------------
 * Por que não reabrir o `.xlsx`
 * ---------------------------------------------------------------------------
 * Porque o RAW **é** o arquivo, para todo efeito deste pipeline: 43 colunas
 * gravadas verbatim, com cabeçalho e valor de cada célula, imutáveis por
 * gatilho desde que entraram. Reabrir o arquivo faria a aplicação depender de o
 * blob continuar em disco, e abriria a porta para o banco e o arquivo
 * discordarem sobre o que foi lido — que é o defeito que `estagiarExtratoReal`
 * já evita ao ler de RAW.
 *
 * A cópia é feita em SQL, sem trazer célula nenhuma para a aplicação: são
 * dezenas de milhares de linhas, e o ganho de passá-las por JavaScript é zero.
 */
async function clonarRaw(
  db: Database,
  deRunId: string,
  paraRunId: string,
): Promise<void> {
  await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;

    await tx.execute(sql`
      INSERT INTO raw_sheet (
        import_run_id, sheet_name, sheet_index, row_count, column_count,
        role, role_reason, header_row_index
      )
      SELECT ${paraRunId}::uuid, sheet_name, sheet_index, row_count, column_count,
             role, role_reason, header_row_index
        FROM raw_sheet
       WHERE import_run_id = ${deRunId}::uuid
    `);

    /*
      As linhas e as células casam pelo par natural — a aba pelo `sheet_index`, a
      linha pelo `row_index` —, e não por um mapa de ids carregado na memória.
      O par é único dentro de uma leitura por construção do capturador, e é o
      que permite a cópia inteira caber em dois INSERT … SELECT.
    */
    await tx.execute(sql`
      INSERT INTO raw_row (raw_sheet_id, row_index, is_header)
      SELECT nova.id, velha_linha.row_index, velha_linha.is_header
        FROM raw_row velha_linha
        JOIN raw_sheet velha ON velha.id = velha_linha.raw_sheet_id
        JOIN raw_sheet nova
          ON nova.import_run_id = ${paraRunId}::uuid
         AND nova.sheet_index = velha.sheet_index
       WHERE velha.import_run_id = ${deRunId}::uuid
    `);

    await tx.execute(sql`
      INSERT INTO raw_cell (
        raw_row_id, column_index, column_letter, column_header,
        raw_value, source_type, formatted_text
      )
      SELECT nova_linha.id, c.column_index, c.column_letter, c.column_header,
             c.raw_value, c.source_type, c.formatted_text
        FROM raw_cell c
        JOIN raw_row velha_linha ON velha_linha.id = c.raw_row_id
        JOIN raw_sheet velha ON velha.id = velha_linha.raw_sheet_id
        JOIN raw_sheet nova
          ON nova.import_run_id = ${paraRunId}::uuid
         AND nova.sheet_index = velha.sheet_index
        JOIN raw_row nova_linha
          ON nova_linha.raw_sheet_id = nova.id
         AND nova_linha.row_index = velha_linha.row_index
       WHERE velha.import_run_id = ${deRunId}::uuid
    `);

    /*
      Os contadores do run, escritos do que de fato entrou — e não copiados do
      run anterior. Uma contagem herdada seria uma afirmação sobre esta leitura
      feita a partir de outra, e o dia em que as duas divergissem seria o dia em
      que ninguém saberia qual está errada.
    */
    await tx.execute(sql`
      UPDATE import_run r
         SET raw_sheet_count = medida.abas,
             raw_row_count = medida.linhas,
             raw_cell_count = medida.celulas,
             status = 'READING'
        FROM (
          SELECT count(DISTINCT s.id) AS abas,
                 count(DISTINCT l.id) AS linhas,
                 count(c.id) AS celulas
            FROM raw_sheet s
            LEFT JOIN raw_row l ON l.raw_sheet_id = s.id
            LEFT JOIN raw_cell c ON c.raw_row_id = l.id
           WHERE s.import_run_id = ${paraRunId}::uuid
        ) AS medida
       WHERE r.id = ${paraRunId}::uuid
    `);
  });
}

/** O nome da unidade, para o escopo nascer legível — como na importação. */
async function nomeDaUnidade(
  db: Database,
  cnpj: string | null,
): Promise<string | null> {
  if (!cnpj) return null;
  const [unidade] = await db
    .select({ nome: unidadeTable.nome })
    .from(unidadeTable)
    .where(eq(unidadeTable.cnpj, cnpj));
  return unidade?.nome ?? null;
}

/**
 * A frase da tela — o que aconteceu, com os números que aconteceram.
 *
 * "Decisão registrada" não serve: era exatamente o que a tela dizia quando nada
 * mudava. Aqui ela diz que mês mudou, para que revisão, e quanto entrou.
 */
function frasear(
  revisoes: VigenciaDaAplicacao[],
  semMudanca: string[],
  valor: number,
  competencias: string[],
): string {
  const dinheiro = valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  if (revisoes.length === 0) {
    return (
      `A decisão ficou registrada e o extrato foi relido, e o resultado é igual ao que já ` +
      `estava ativo${semMudanca.length > 0 ? ` (${semMudanca.join(", ")})` : ""}: nenhuma ` +
      `revisão foi aberta e nada foi duplicado.`
    );
  }

  const meses = competencias.length === 1 ? "a competência" : "as competências";
  return (
    `Aplicada: ${dinheiro} entraram no realizado de ${meses} ` +
    `${competencias.join(", ")}. ${revisoes.length === 1 ? "A vigência" : "As vigências"} ` +
    `${revisoes.map((r) => `${r.label} (revisão ${r.revisao})`).join(", ")} ` +
    `${revisoes.length === 1 ? "foi reaberta" : "foram reabertas"} em revisão nova; a anterior ` +
    `continua no histórico. O confronto já conta este valor.`
  );
}

function arredondar(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}
