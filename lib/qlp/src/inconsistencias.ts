import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { contextFilter, periodLabel, type ContextInfo } from "@workspace/comparison";
import { DATASET_FAMILY_QUADRO_DE_PESSOAL } from "@workspace/ingest";
import {
  CODIGOS_QUE_ISOLAM_A_CHAVE,
  type ApresentacaoDeApontamento,
} from "@workspace/ingest/apontamentos";
import {
  resolverContextoDoQuadro,
  TIPO_QLP_ADMINISTRATIVO,
  type ContextoDoQuadro,
} from "./contexto";

/**
 * O que ficou de fora do quadro, e por quê.
 *
 * ---------------------------------------------------------------------------
 * Por que esta leitura existe
 * ---------------------------------------------------------------------------
 * O pipeline não escolhe em silêncio entre dois valores conflitantes. Antes,
 * ele também não deixava o arquivo entrar: uma planilha de QLP com 11.760
 * fatos e 8 chaves em conflito parava inteira, e a única saída era corrigir a
 * origem e reenviar. Hoje o arquivo entra e as 8 chaves ficam em quarentena
 * (ver a quarentena por chave em `lib/ingest/pipeline.ts`).
 *
 * Isso resolve o custo e cria uma obrigação: **o que não entrou tem de estar
 * visível onde o quadro é lido**. Uma vigência à qual faltam registros que
 * ninguém vê é pior do que a importação que não acontecia — o número aparece
 * completo, some a evidência de que não é. Esta leitura é essa evidência, e a
 * aba de Inconsistências é onde ela se lê.
 *
 * ---------------------------------------------------------------------------
 * Por que não há tabela nova
 * ---------------------------------------------------------------------------
 * Tudo o que a aba mostra já foi gravado por quem decidiu: `validation_issue`
 * guarda a chave como está escrita no arquivo, as linhas que colidiram, os
 * valores em desacordo e o texto de como corrigir. Copiar isso para uma tabela
 * de pendências criaria uma segunda verdade que pode divergir da primeira — e
 * a pergunta "esta chave ainda está faltando?" tem resposta exata sem cópia
 * nenhuma: é o apontamento do run que produziu a vigência **viva**. Corrigida a
 * origem e importada de novo, a vigência viva passa a ser outra, o run é outro,
 * e a pendência desaparece sozinha, sem ninguém ter de marcá-la como resolvida.
 */

/** Um registro que a importação deixou de fora, com a evidência inteira. */
export interface RegistroInconsistente {
  /** O rótulo literal da fonte, ex.: `EMPURRADA_1_8_2026`. */
  vigenciaLabel: string;
  effectiveDate: string;
  /** "Ago/2026". */
  periodLabel: string;
  /** O código do apontamento — hoje só `ENTIDADE_DUPLICADA_CONFLITANTE`. */
  code: string;
  /** A chave como está escrita no arquivo: `07.526.557/0015-05 · ANALISTA`. */
  chave: string;
  /** As linhas da planilha que colidiram, já em texto: `aba "Planilha1", linha 2`. */
  linhas: string[];
  /**
   * As seções que a tela desenha — onde, registro, diferenças, como corrigir.
   *
   * Ausente nos apontamentos gravados antes do contrato de apresentação
   * existir; nesse caso a tela cai em {@link mensagem}, que sempre existe.
   */
  apresentacao?: ApresentacaoDeApontamento;
  /** A frase inteira do pipeline. Sempre presente — é o fallback da tela. */
  mensagem: string;
}

/** Uma vigência e o que falta nela. */
export interface VigenciaComPendencia {
  vigenciaLabel: string;
  effectiveDate: string;
  periodLabel: string;
  registros: RegistroInconsistente[];
}

export interface InconsistenciasDoQuadro extends ContextoDoQuadro {
  /**
   * Todas as vigências do contexto que têm registro faltando, da mais nova
   * para a mais antiga.
   *
   * A lista **não** respeita a vigência selecionada nas outras abas, e isso é
   * deliberado: aqui não se lê um retrato, lê-se uma fila de trabalho. Uma
   * pendência de três quinzenas atrás continua sendo dado que falta hoje, e
   * escondê-la atrás do seletor faria a aba parecer vazia justamente para
   * quem abriu o produto na quinzena mais recente.
   *
   * O nome não é `vigencias` porque `ContextoDoQuadro` já traz esse campo, com
   * outro sentido — lá é a régua inteira da série, que o seletor usa; aqui é só
   * o que tem pendência.
   */
  pendencias: VigenciaComPendencia[];
  /** Quantos registros faltam no contexto inteiro. */
  total: number;
}

type LinhaDePendencia = {
  source_label: string;
  effective_date: string;
  code: string;
  message: string;
  detail: {
    chave?: string;
    linhas?: string[];
    apresentacao?: ApresentacaoDeApontamento;
  } | null;
}

/**
 * As chaves que a quarentena reteve, por vigência viva do contexto.
 *
 * O `JOIN` é por `snapshot.import_run_id`: a vigência que está no ar foi
 * produzida por um run, e são os conflitos **daquele** run que explicam o que
 * falta nela. Um run anterior, cuja vigência já foi substituída, não tem nada a
 * dizer sobre o quadro de hoje — e é assim que uma correção limpa a lista sem
 * que ninguém precise marcar nada como resolvido.
 *
 * A comparação `detail->>'vigencia' = s.source_label` existe porque um arquivo
 * pode trazer mais de uma quinzena: sem ela, o conflito de uma vigência
 * apareceria como pendência da outra.
 */
async function pendenciasDoContexto(
  db: Database,
  context: ContextInfo,
  effectiveDate?: string,
): Promise<LinhaDePendencia[]> {
  /*
    A lista entra como array JS de propósito: o template do drizzle expande um
    array em `('A', 'B')`, que é a forma que `IN` quer. Um `= ANY($1::text[])`
    receberia a mesma expansão e viraria SQL inválido — foi o 500 que este
    comentário existe para não deixar voltar.
  */
  const codigos = [...CODIGOS_QUE_ISOLAM_A_CHAVE];
  const { rows } = await db.execute<LinhaDePendencia>(sql`
    SELECT s.source_label,
           s.effective_date::text AS effective_date,
           vi.code,
           vi.message,
           vi.detail
      FROM snapshot s
      JOIN validation_issue vi ON vi.import_run_id = s.import_run_id
     WHERE s.status <> 'SUPERSEDED'
     AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
       AND s.dataset_family = ${DATASET_FAMILY_QUADRO_DE_PESSOAL}
       AND ${contextFilter("s", context)}
       AND vi.code IN ${codigos}
       AND vi.detail->>'entityType' = ${TIPO_QLP_ADMINISTRATIVO}
       AND vi.detail->>'vigencia' = s.source_label
       ${effectiveDate ? sql`AND s.effective_date = ${effectiveDate}::date` : sql``}
     ORDER BY s.effective_date DESC, vi.detail->>'chave'
  `);
  return rows;
}

/**
 * Quantos registros faltam numa vigência — o número que marca o quadro como
 * incompleto.
 *
 * Separado de {@link getInconsistenciasDoQuadro} porque quem o chama (a leitura
 * do quadro) não quer a evidência inteira: quer saber se pode apresentar
 * aquele quadro sem ressalva. Zero é o caso comum e custa um índice.
 */
export async function contarRegistrosFaltando(
  db: Database,
  context: ContextInfo,
  effectiveDate: string,
): Promise<number> {
  return (await pendenciasDoContexto(db, context, effectiveDate)).length;
}

/**
 * A fila de trabalho: tudo o que ficou de fora do quadro, por vigência.
 *
 * `null` quando não existe nenhuma vigência de QLP importada — a rota traduz em
 * 404 com a frase que aponta para Importações, como as demais leituras deste
 * pacote.
 */
export async function getInconsistenciasDoQuadro(
  db: Database,
  options: { period?: string; context?: Parameters<typeof resolverContextoDoQuadro>[1] } = {},
): Promise<InconsistenciasDoQuadro | null> {
  const resolvido = await resolverContextoDoQuadro(db, {
    ...options.context,
    ...(options.period !== undefined ? { period: options.period } : {}),
  });
  if (!resolvido) return null;

  const linhas = await pendenciasDoContexto(db, resolvido.context);

  const porVigencia = new Map<string, VigenciaComPendencia>();
  for (const linha of linhas) {
    const registro: RegistroInconsistente = {
      vigenciaLabel: linha.source_label,
      effectiveDate: linha.effective_date,
      periodLabel: periodLabel(linha.effective_date),
      code: linha.code,
      chave: linha.detail?.chave ?? "",
      linhas: linha.detail?.linhas ?? [],
      ...(linha.detail?.apresentacao ? { apresentacao: linha.detail.apresentacao } : {}),
      mensagem: linha.message,
    };
    const grupo = porVigencia.get(linha.source_label) ?? {
      vigenciaLabel: linha.source_label,
      effectiveDate: linha.effective_date,
      periodLabel: registro.periodLabel,
      registros: [],
    };
    grupo.registros.push(registro);
    porVigencia.set(linha.source_label, grupo);
  }

  return {
    ...resolvido,
    pendencias: [...porVigencia.values()],
    total: linhas.length,
  };
}
