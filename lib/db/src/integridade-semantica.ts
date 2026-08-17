import { sql } from "drizzle-orm";
import type { Database } from "./index";

/**
 * As duas invariantes da semântica, em forma de pergunta.
 *
 * `conferir-schema` sabia perguntar se o banco tem as tabelas e as colunas que
 * o repositório declara. Não sabia perguntar se o **conteúdo** delas se
 * sustenta — e as duas afirmações deste schema que mais custam quando falham
 * não são de forma nenhuma:
 *
 * 1. **Todo atributo tem uma versão de semântica aplicável.** A comparação
 *    resolve unidade, periodicidade e base de cálculo lendo
 *    `attribute_semantics` na data de cada vigência. Sem linha, ela cai na
 *    projeção e nenhuma mudança de semântica da fonte é detectável — o produto
 *    inteiro funciona e a única coisa que a tabela versionada existe para
 *    enxergar fica invisível.
 *
 * 2. **A projeção e a versão em vigor dizem a mesma coisa.** `attribute` é a
 *    projeção da versão em vigor; está escrito assim no schema e a comparação
 *    leva a sério. Duas verdades divergentes não dão erro em lugar nenhum: a
 *    tela lê uma, o dinheiro é somado pela outra.
 *
 * ---------------------------------------------------------------------------
 * Diagnóstico, e não conserto
 * ---------------------------------------------------------------------------
 * Nada aqui escreve. É deliberado, e é a mesma regra do resto de
 * `conferir-schema`: divergência tem mais de uma causa — migration pendente,
 * objeto derrubado por fora, escrita de alguém que só tocou metade da verdade
 * — e cada uma pede uma decisão diferente de quem conhece o banco. Um conserto
 * automático escolheria uma das duas verdades sozinho, calado, e é exatamente
 * assim que um número errado vira permanente.
 *
 * Quem impede o estado inválido é a escrita: a versão nasce com o atributo, na
 * mesma transação da promoção (`garantirSemanticaInicial`), e todo caminho que
 * escreve semântica escreve as duas linhas. Estas funções existem para os
 * bancos que vêm de antes disso, e para acusar o dia em que um caminho novo
 * esquecer a metade versionada.
 */

/** Por que a semântica de um atributo não serve. */
export type MotivoSemSemantica =
  /** Nenhuma linha em `attribute_semantics`. O estado de todo banco anterior à 0025. */
  | "SEM_VERSAO"
  /** Tem histórico, mas nenhuma versão aberta — ninguém descreve o presente. */
  | "SEM_VERSAO_EM_VIGOR"
  /** A mais antiga começa depois da vigência mais antiga: há série sem semântica. */
  | "NAO_COBRE_A_SERIE";

export interface AtributoSemSemanticaAplicavel {
  code: string;
  motivo: MotivoSemSemantica;
  /** A frase que explica este caso, com as datas que o tornam verificável. */
  detalhe: string;
}

/**
 * Os atributos cuja semântica não cobre o que precisaria cobrir.
 *
 * "Aplicável" são as três coisas ao mesmo tempo: existir, estar em vigor e
 * começar antes da série. Uma versão que começa em julho não responde pela
 * vigência de dezembro, e a comparação daquela vigência volta a cair na
 * projeção sem dizer nada — por isso o terceiro caso está aqui e não é
 * detalhe de arredondamento.
 *
 * Num banco sem vigência nenhuma, o terceiro caso não existe: não há série a
 * cobrir, e a versão inicial nasce em 1970 justamente para isso.
 */
export async function atributosSemSemanticaAplicavel(
  db: Database,
): Promise<AtributoSemSemanticaAplicavel[]> {
  const { rows } = await db.execute<{
    code: string;
    motivo: MotivoSemSemantica;
    comeco: string | null;
    inicio: string | null;
  }>(sql`
    WITH serie AS (SELECT min(effective_date) AS inicio FROM snapshot),
    estado AS (
      SELECT a.code,
             (SELECT count(*) FROM attribute_semantics v WHERE v.attribute_id = a.id)
               AS versoes,
             (SELECT count(*) FROM attribute_semantics v
               WHERE v.attribute_id = a.id AND v.effective_until IS NULL)
               AS em_vigor,
             (SELECT min(v.effective_from) FROM attribute_semantics v
               WHERE v.attribute_id = a.id)
               AS comeco,
             (SELECT inicio FROM serie) AS inicio
        FROM attribute a
    )
    SELECT code,
           CASE WHEN versoes = 0 THEN 'SEM_VERSAO'
                WHEN em_vigor = 0 THEN 'SEM_VERSAO_EM_VIGOR'
                ELSE 'NAO_COBRE_A_SERIE' END AS motivo,
           comeco::text AS comeco,
           inicio::text AS inicio
      FROM estado
     WHERE versoes = 0
        OR em_vigor = 0
        OR (inicio IS NOT NULL AND comeco > inicio)
     ORDER BY code
  `);

  return rows.map((r) => ({
    code: r.code,
    motivo: r.motivo,
    detalhe:
      r.motivo === "SEM_VERSAO"
        ? "não tem nenhuma linha em attribute_semantics"
        : r.motivo === "SEM_VERSAO_EM_VIGOR"
          ? "tem histórico, mas nenhuma versão aberta descreve o presente"
          : `a versão mais antiga começa em ${r.comeco}, depois da vigência mais ` +
            `antiga (${r.inicio}) — a série antes dessa data fica sem semântica`,
  }));
}

/**
 * Os campos em que `attribute` e a versão em vigor afirmam a mesma coisa.
 *
 * A lista não é "todas as colunas homônimas": é o que `projectCurrentVersion`
 * copia de uma para a outra, que é a definição operacional de "a mesma
 * verdade". Duas colunas ficam de fora de propósito:
 *
 * - `display_name` não é versionado. Um nome melhor é melhor também no
 *   passado, e versioná-lo faria a mesma coluna aparecer com dois nomes em
 *   duas vigências da mesma tela.
 * - `calculation_basis` só existe na versão. Não há projeção dele em
 *   `attribute`, e é por isso que ele foi o campo que denunciou tudo isto.
 */
export const CAMPOS_PROJETADOS = [
  "unit",
  "periodicity",
  "aggregation",
  "is_monetary",
  "taxonomy_node_id",
  "definition",
  "semantics_status",
  "semantics_rationale",
  "confirmed_by",
  "confirmed_at",
] as const;

export interface DivergenciaDeProjecao {
  code: string;
  /** Um dos {@link CAMPOS_PROJETADOS}. */
  campo: string;
  /** O que `attribute` diz. É o que as telas mostram. */
  naProjecao: string | null;
  /** O que a versão em vigor diz. É o que a comparação soma. */
  naVersao: string | null;
}

/**
 * Onde a projeção e a versão em vigor se contradizem.
 *
 * Uma linha por campo divergente, e não por atributo: "custo_fixo diverge" não
 * é acionável, "custo_fixo: periodicity é MENSAL na projeção e ANUAL na versão"
 * é. Atributo sem versão em vigor não aparece aqui — é o outro defeito, e
 * {@link atributosSemSemanticaAplicavel} já o nomeia.
 */
export async function divergenciasDaProjecao(
  db: Database,
): Promise<DivergenciaDeProjecao[]> {
  const { rows } = await db.execute<{
    code: string;
    campo: string;
    projecao: string | null;
    versao: string | null;
  }>(sql`
    SELECT a.code, campo.nome AS campo, campo.projecao, campo.versao
      FROM attribute a
      JOIN attribute_semantics v
        ON v.attribute_id = a.id AND v.effective_until IS NULL
      CROSS JOIN LATERAL (
        VALUES
          ('unit',                a.unit,                    v.unit),
          ('periodicity',         a.periodicity,             v.periodicity),
          ('aggregation',         a.aggregation,             v.aggregation),
          ('is_monetary',         a.is_monetary::text,       v.is_monetary::text),
          ('taxonomy_node_id',    a.taxonomy_node_id::text,  v.taxonomy_node_id::text),
          ('definition',          a.definition,              v.definition),
          ('semantics_status',    a.semantics_status::text,  v.semantics_status),
          ('semantics_rationale', a.semantics_rationale,     v.rationale),
          ('confirmed_by',        a.confirmed_by,            v.confirmed_by),
          ('confirmed_at',        a.confirmed_at::text,      v.confirmed_at::text)
      ) AS campo(nome, projecao, versao)
     WHERE campo.projecao IS DISTINCT FROM campo.versao
     ORDER BY a.code, campo.nome
  `);

  return rows.map((r) => ({
    code: r.code,
    campo: r.campo,
    naProjecao: r.projecao,
    naVersao: r.versao,
  }));
}

export interface IntegridadeSemantica {
  semSemanticaAplicavel: AtributoSemSemanticaAplicavel[];
  divergencias: DivergenciaDeProjecao[];
  /** Quantos atributos foram conferidos — o denominador do "está em dia". */
  atributos: number;
}

/** As duas perguntas, feitas de uma vez. */
export async function conferirIntegridadeSemantica(
  db: Database,
): Promise<IntegridadeSemantica> {
  const { rows } = await db.execute<{ total: number }>(
    sql`SELECT count(*)::int AS total FROM attribute`,
  );
  return {
    semSemanticaAplicavel: await atributosSemSemanticaAplicavel(db),
    divergencias: await divergenciasDaProjecao(db),
    atributos: rows[0]?.total ?? 0,
  };
}

export function integridadeEmDia(r: IntegridadeSemantica): boolean {
  return r.semSemanticaAplicavel.length === 0 && r.divergencias.length === 0;
}

/**
 * O relatório, em linhas prontas para a saída de erro.
 *
 * Função pura, e separada da consulta pelo motivo de sempre neste pacote: o
 * texto que uma pessoa vai ler às duas da manhã é conteúdo, e conteúdo se
 * testa sem subir banco. Cada linha nomeia o atributo, o campo e os dois
 * valores — quem lê precisa decidir **qual** dos dois está certo, e não dá para
 * decidir isso sem ver os dois.
 */
export function relatarIntegridadeSemantica(r: IntegridadeSemantica): string[] {
  if (integridadeEmDia(r)) {
    return [
      `Integridade da semântica em dia: os ${r.atributos} atributos têm versão ` +
        `aplicável, e a projeção concorda com ela em todos os campos.`,
    ];
  }

  const linhas: string[] = [];

  if (r.semSemanticaAplicavel.length > 0) {
    linhas.push(
      `\nAtributos sem versão de semântica aplicável ` +
        `(${r.semSemanticaAplicavel.length} de ${r.atributos}):`,
    );
    for (const a of r.semSemanticaAplicavel) {
      linhas.push(`  ${a.code} — ${a.detalhe} [${a.motivo}]`);
    }
    linhas.push(
      `\n  A versão 1 de cada atributo é criada pela migration ` +
        `0025_semantica_inicial, e desde ela toda coluna nasce com a sua, na ` +
        `mesma transação da promoção. Um atributo nesta lista é banco que não ` +
        `passou pela 0025 — ou linha apagada por fora depois dela.`,
    );
  }

  if (r.divergencias.length > 0) {
    const atributos = new Set(r.divergencias.map((d) => d.code)).size;
    linhas.push(
      `\nCampos em que attribute e a versão em vigor se contradizem ` +
        `(${r.divergencias.length} em ${atributos} atributo(s)):`,
    );
    for (const d of r.divergencias) {
      linhas.push(
        `  ${d.code}.${d.campo}: projeção=${valor(d.naProjecao)} ` +
          `versão=${valor(d.naVersao)}`,
      );
    }
    linhas.push(
      `\n  attribute é a projeção da versão em vigor: as telas leem a projeção ` +
        `e a comparação soma pela versão. Enquanto divergirem, as duas estão ` +
        `certas sobre coisas diferentes — e escolher qual vale é decisão de ` +
        `quem conhece o dado. Se a versão estiver certa, projete-a; se a ` +
        `projeção estiver certa, corrija a versão por 'correctSemantics', que ` +
        `pede justificativa e deixa registro.`,
    );
  }

  // O fecho é curto e vale para os dois casos. A instrução de cada um fica no
  // bloco dele: um conselho sobre divergência embaixo de uma lista de versões
  // ausentes manda a pessoa procurar contradição que não existe.
  linhas.push(
    `\nNada foi corrigido, e não há bandeira que corrija: este comando lê.`,
  );

  return linhas;
}

/** `NULL` dito de forma que não se confunda com a string "null". */
function valor(v: string | null): string {
  return v === null ? "(vazio)" : JSON.stringify(v);
}
