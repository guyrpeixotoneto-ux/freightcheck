import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { esperadoDeclarado, type EsperadoDeclarado } from "./contrato";
import type { Criticidade, Esperado, Justificativa } from "./modelo";

/**
 * O esperado — quatro origens, e a linha que separa duas delas das outras duas.
 *
 * A pergunta "o que deveria existir?" não tem uma resposta só, e fingir que tem
 * é como se erra aqui. Este módulo combina quatro:
 *
 * 1. **CONTRATO** — o plano da DRE. Declaração, com evidência medida.
 * 2. **CURADORIA** — o que uma pessoa confirmou ou dispensou. Declaração.
 * 3. **HISTORICO** — o atributo veio nas vigências anteriores, para estas
 *    entidades. Inferência.
 * 4. **ESTRUTURA** — o atributo veio para quase todas as entidades desta mesma
 *    vigência. Inferência.
 *
 * **As duas primeiras viram linha no banco; as duas últimas nunca.** Elas são
 * recalculadas a cada leitura e chegam à tela com `declarado: false` e o motivo
 * escrito. É essa fronteira que impede o produto de fazer o que o pedido proíbe
 * em letras maiúsculas: transformar inferência em verdade em silêncio. Uma
 * estatística que vira linha no banco é indistinguível de contrato dois commits
 * depois — e ninguém decidiu que ela fosse.
 *
 * Quando um atributo é esperado por mais de uma origem, vale a mais forte, na
 * ordem acima. A declaração ganha da inferência sempre; entre as duas
 * inferências ganha a de histórico, que olha várias vigências, sobre a de
 * estrutura, que olha uma.
 */

/**
 * Quanta presença basta para inferir que o atributo era esperado.
 *
 * Dois limiares, e os dois têm margem larga sobre o que o export real mostra:
 *
 * - **`MINIMO_DE_VIGENCIAS`** — um atributo precisa ter aparecido em pelo menos
 *   duas vigências anteriores. Uma só seria "apareceu uma vez", que é o começo
 *   de uma série tanto quanto o fim de um engano.
 * - **`PRESENCA_ESTRUTURAL`** — 90% das entidades do tipo na própria vigência.
 *   Medido no export: das 138 colunas, as que existem existem para 100% das
 *   entidades do seu equipamento; a densidade é a regra e não a exceção, e 90%
 *   deixa folga para o caso de uma entidade nova entrar no meio do mês.
 *
 * Os dois são constantes exportadas de propósito: um limiar escondido dentro de
 * uma consulta é um número que ninguém revisa.
 */
export const MINIMO_DE_VIGENCIAS = 2;
export const PRESENCA_ESTRUTURAL = 0.9;

/**
 * A presença de um atributo nas vigências anteriores do mesmo recorte.
 *
 * **Coluna entregue e valor presente são duas contagens.** A distinção não é
 * preciosismo: no export real, cinco colunas de carreta — `operador_tms`,
 * `organizacao_de_compras`, `prazo_pagamento`, `unidade_promax_unb` e
 * `unidade_tms` — continuam vindo no layout de Fev/26 em diante e chegam vazias
 * para as 76 carretas. Um histórico que contasse só o layout diria "presente
 * nas 4 vigências anteriores" a respeito de colunas que não trazem número há
 * três meses, e a explicação da lacuna estaria mentindo com números certos.
 */
export interface HistoricoDoAtributo {
  attributeCode: string;
  entityType: string;
  /** Vigências anteriores em que a coluna veio no layout. */
  vigenciasComDado: number;
  /** Destas, aquelas em que ela trouxe valor para alguma entidade. */
  vigenciasComValor: number;
  /** Vigências anteriores consideradas. */
  vigenciasAvaliadas: number;
  /** Entidades que receberam a coluna, na última vigência em que ela apareceu. */
  entidadesNaUltima: number;
  /** Destas, quantas tinham valor de verdade. */
  comValorNaUltima: number;
  /** A última vigência em que a coluna apareceu. */
  ultimaVigencia: string | null;
  /** A primeira vigência em que a coluna apareceu, em toda a série. */
  primeiraVigencia: string | null;
}

/**
 * Quanto cada atributo apareceu antes de uma vigência, no mesmo recorte.
 *
 * Lê apenas `snapshot_attribute` e `snapshot`. O recorte é (família, canal,
 * escopo) — sem ele, a série de uma unidade contaminaria a inferência de outra,
 * e o produto passaria a cobrar de Camaçari um dado que só a outra unidade
 * entrega.
 */
export async function historicoDosAtributos(
  db: Database,
  recorte: {
    datasetFamily: string;
    canal: string;
    scopeHash: string;
    /** Exclusivo: a vigência que está sendo avaliada não entra no próprio histórico. */
    antesDe: string;
  },
): Promise<Map<string, HistoricoDoAtributo>> {
  const { rows } = await db.execute<{
    code: string;
    entity_type: string;
    vigencias_com_dado: number;
    vigencias_com_valor: number;
    entidades_na_ultima: number;
    com_valor_na_ultima: number;
    ultima_vigencia: string | null;
    primeira_vigencia: string | null;
  }>(sql`
    WITH anteriores AS (
      SELECT s.id, s.effective_date
        FROM snapshot s
       WHERE s.status <> 'SUPERSEDED'
       AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
         AND s.dataset_family = ${recorte.datasetFamily}
         AND s.canal = ${recorte.canal}
         AND s.scope_hash = ${recorte.scopeHash}
         AND s.effective_date < ${recorte.antesDe}::date
    ),
    presenca AS (
      SELECT a.code,
             a.entity_type,
             an.effective_date,
             sa.value_count + sa.null_count AS entidades,
             sa.value_count                 AS com_valor,
             row_number() OVER (PARTITION BY a.code ORDER BY an.effective_date DESC) AS recencia
        FROM snapshot_attribute sa
        JOIN anteriores an ON an.id = sa.snapshot_id
        JOIN attribute a ON a.id = sa.attribute_id
       WHERE sa.present_in_layout
    )
    SELECT code,
           entity_type,
           count(*)::int                                        AS vigencias_com_dado,
           count(*) FILTER (WHERE com_valor > 0)::int            AS vigencias_com_valor,
           max(entidades) FILTER (WHERE recencia = 1)::int       AS entidades_na_ultima,
           max(com_valor) FILTER (WHERE recencia = 1)::int       AS com_valor_na_ultima,
           max(effective_date) FILTER (WHERE recencia = 1)::text AS ultima_vigencia,
           min(effective_date)::text                             AS primeira_vigencia
      FROM presenca
     GROUP BY code, entity_type
  `);

  const { rows: totalRows } = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
      FROM snapshot s
     WHERE s.status <> 'SUPERSEDED'
     AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
       AND s.dataset_family = ${recorte.datasetFamily}
       AND s.canal = ${recorte.canal}
       AND s.scope_hash = ${recorte.scopeHash}
       AND s.effective_date < ${recorte.antesDe}::date
  `);
  const avaliadas = Number(totalRows[0]?.n ?? 0);

  const mapa = new Map<string, HistoricoDoAtributo>();
  for (const r of rows) {
    mapa.set(r.code, {
      attributeCode: r.code,
      entityType: r.entity_type,
      vigenciasComDado: Number(r.vigencias_com_dado),
      vigenciasComValor: Number(r.vigencias_com_valor),
      vigenciasAvaliadas: avaliadas,
      entidadesNaUltima: Number(r.entidades_na_ultima ?? 0),
      comValorNaUltima: Number(r.com_valor_na_ultima ?? 0),
      ultimaVigencia: r.ultima_vigencia,
      primeiraVigencia: r.primeira_vigencia,
    });
  }
  return mapa;
}

/** O que o resolvedor precisa saber sobre o presente para inferir estrutura. */
export interface PresencaNaVigencia {
  attributeCode: string;
  entityType: string;
  /** Entidades com o atributo entregue (com valor ou vazio). */
  entidadesComAtributo: number;
}

/**
 * A lista completa do que era esperado numa vigência, com o porquê de cada um.
 *
 * Puro: recebe o declarado, o histórico e a presença já lidos, e decide. É o
 * único lugar onde a precedência entre as quatro origens existe, e é testável
 * sem banco.
 *
 * `dispensados` sai separado porque um `DISPENSADO` **não é** um esperado com
 * outro rótulo: ele não entra no denominador de lado nenhum. Devolvê-lo junto
 * obrigaria cada chamador a filtrar, e o primeiro que esquecesse faria uma
 * dispensa legítima derrubar a cobertura — exatamente o oposto de dispensar.
 */
export function resolverEsperado(entrada: {
  declarado: EsperadoDeclarado[];
  historico: Map<string, HistoricoDoAtributo>;
  presenca: PresencaNaVigencia[];
  /** Entidades por tipo nesta vigência, para o denominador. */
  entidadesPorTipo: Map<string, number>;
}): { esperados: Esperado[]; dispensados: Set<string> } {
  const dispensados = new Set<string>();
  const porCodigo = new Map<string, Esperado>();

  const entidadesDe = (entityType: string) => entrada.entidadesPorTipo.get(entityType) ?? 0;

  /*
    O piso de uma entidade, e por que ele precisa existir.

    Um atributo declarado para um tipo do qual **nenhuma entidade chegou** teria
    denominador zero, e denominador zero sai da conta inteiro: sem lacuna, sem
    percentual, e a célula classificada como `NAO_APLICAVEL`. Foi assim que 110
    atributos de trecho conseguiram não existir sem que nenhum número se mexesse
    — o tipo nunca chegou, então nada era esperado dele, então estava tudo bem.

    O piso é a afirmação mais fraca que resolve isso: **se a fonte deveria mandar
    esta coluna, deveria existir ao menos uma entidade para carregá-la.** Não
    inventa frota — dizer "deveriam existir 40 trechos" seria inventar, e o
    quanto de verdade só se sabe quando houver um roster declarado ou um arquivo.
    Diz apenas que zero está errado, que é o que a tela precisava poder dizer.

    Para todo tipo que chegou isto é inócuo: `max(1, 76)` é 76. Ele só morde
    onde a contagem seria zero, e ali ele é a diferença entre uma lacuna visível
    e um silêncio.
  */
  const entidadesEsperadasDe = (entityType: string) => Math.max(1, entidadesDe(entityType));

  // 1 e 2. Declaração. Ganha de tudo, e a dispensa é registrada à parte.
  for (const d of entrada.declarado) {
    if (d.status === "DISPENSADO") {
      dispensados.add(d.attributeCode);
      continue;
    }
    porCodigo.set(d.attributeCode, {
      attributeCode: d.attributeCode,
      entityType: d.entityType,
      criticidade: d.criticidade,
      entidadesEsperadas: entidadesEsperadasDe(d.entityType),
      justificativa: {
        origem: d.origem,
        declarado: true,
        motivo: d.motivo,
        medicao: { desde: d.efetivoDe, ate: d.efetivoAte, por: d.ator },
      },
    });
  }

  // 3. Histórico. Só entra se não houver declaração para aquele código.
  for (const [code, h] of entrada.historico) {
    if (porCodigo.has(code) || dispensados.has(code)) continue;
    if (h.vigenciasComDado < MINIMO_DE_VIGENCIAS) continue;

    /*
      O denominador é o que o histórico mostrou, e não o total de entidades da
      vigência. Um atributo que sempre veio para 60 dos 64 cavalos passa a ser
      esperado para 60; esperar 64 inventaria quatro lacunas que nunca
      existiram — e inventar lacuna é tão ruim quanto esconder uma.
    */
    const esperadasPorHistorico = Math.min(h.comValorNaUltima, entidadesDe(h.entityType));
    /*
      Uma coluna que sempre veio vazia não gera expectativa de valor.

      `comValorNaUltima = 0` quer dizer que ela chegou no layout e não trouxe
      número para ninguém. Esperar valor daí em diante seria cobrar um dado que
      a origem nunca entregou — e inventar lacuna é tão ruim quanto esconder
      uma. A ausência de valor nessas colunas continua visível em Qualidade de
      dados, que é a tela que fala de dado que chegou com problema.
    */
    if (esperadasPorHistorico === 0) continue;

    porCodigo.set(code, {
      attributeCode: code,
      entityType: h.entityType,
      criticidade: "RELEVANTE",
      entidadesEsperadas: esperadasPorHistorico,
      justificativa: {
        origem: "HISTORICO",
        declarado: false,
        motivo:
          `Esperado por histórico: a coluna veio em ${h.vigenciasComDado} das ` +
          `${h.vigenciasAvaliadas} vigências anteriores e trouxe valor em ${h.vigenciasComValor} ` +
          `delas; na última (${h.ultimaVigencia}) ${h.comValorNaUltima} de ${h.entidadesNaUltima} ` +
          `${h.entidadesNaUltima === 1 ? "equipamento tinha" : "equipamentos tinham"} valor. ` +
          `É inferência, não contrato.`,
        medicao: {
          vigenciasComColuna: h.vigenciasComDado,
          vigenciasComValor: h.vigenciasComValor,
          vigenciasAvaliadas: h.vigenciasAvaliadas,
          entidadesNaUltima: h.entidadesNaUltima,
          comValorNaUltima: h.comValorNaUltima,
          ultimaVigencia: h.ultimaVigencia,
          primeiraVigencia: h.primeiraVigencia,
        },
      },
    });
  }

  // 4. Estrutura. O atributo que veio para quase toda a frota **desta** vigência.
  for (const p of entrada.presenca) {
    if (porCodigo.has(p.attributeCode) || dispensados.has(p.attributeCode)) continue;
    const total = entidadesDe(p.entityType);
    if (total === 0) continue;
    const proporcao = p.entidadesComAtributo / total;
    if (proporcao < PRESENCA_ESTRUTURAL || proporcao >= 1) continue;

    porCodigo.set(p.attributeCode, {
      attributeCode: p.attributeCode,
      entityType: p.entityType,
      criticidade: "INFORMATIVO",
      entidadesEsperadas: total,
      justificativa: {
        origem: "ESTRUTURA",
        declarado: false,
        motivo:
          `Esperado por estrutura: ${p.entidadesComAtributo} de ${total} ` +
          `${p.entityType.toLowerCase()}s desta mesma vigência têm este atributo. É inferência, não contrato.`,
        medicao: { comAtributo: p.entidadesComAtributo, total },
      },
    });
  }

  return {
    esperados: [...porCodigo.values()].sort((a, b) =>
      a.attributeCode.localeCompare(b.attributeCode),
    ),
    dispensados,
  };
}

/**
 * O esperado de uma vigência, do banco à decisão.
 *
 * Junta as três leituras e chama `resolverEsperado`. Existe para que a matriz e
 * o drill-down não montem cada um a sua versão desta sequência — que é como
 * duas telas passam a discordar sobre o mesmo número.
 */
export async function esperadoDaVigencia(
  db: Database,
  vigencia: {
    datasetFamily: string;
    canal: string;
    scopeHash: string;
    scopeKey: string;
    effectiveDate: string;
  },
  presenca: PresencaNaVigencia[],
  entidadesPorTipo: Map<string, number>,
): Promise<{ esperados: Esperado[]; dispensados: Set<string> }> {
  const [declarado, historico] = await Promise.all([
    esperadoDeclarado(db, {
      datasetFamily: vigencia.datasetFamily,
      canal: vigencia.canal,
      scopeKey: vigencia.scopeKey,
      effectiveDate: vigencia.effectiveDate,
    }),
    historicoDosAtributos(db, {
      datasetFamily: vigencia.datasetFamily,
      canal: vigencia.canal,
      scopeHash: vigencia.scopeHash,
      antesDe: vigencia.effectiveDate,
    }),
  ]);

  return resolverEsperado({ declarado, historico, presenca, entidadesPorTipo });
}

/** Atalho para a tela: a criticidade de um atributo, ou o padrão. */
export function criticidadeDe(
  esperados: Esperado[],
  attributeCode: string,
): Criticidade {
  return esperados.find((e) => e.attributeCode === attributeCode)?.criticidade ?? "INFORMATIVO";
}

export type { Justificativa };
