import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "./index";
import {
  attributeSemanticsTable,
  attributeTable,
  curationEventTable,
  taxonomyNodeTable,
} from "./schema";

/**
 * As confirmações canônicas — e o único lugar que as escreve.
 *
 * Uma confirmação é conhecimento de domínio que uma pessoa forneceu. Guardá-la
 * só no banco a tornaria invisível à revisão e perdida a cada base nova;
 * mantê-la aqui a torna diffável, atribuível e reaplicável em qualquer
 * ambiente. Cada entrada registra **quem** decidiu e **com que base** — a linha
 * escrita num pull request é ela própria o ato humano.
 *
 * **Por que este arquivo mora em `@workspace/db`, e não na curadoria.** Ele
 * precisa ser alcançável pelos dois lados que o usam sem que nenhum dos dois
 * dependa do outro: a **importação** (`@workspace/ingest`), que replica estas
 * decisões no momento em que os atributos nascem, e a **curadoria**
 * (`@workspace/curation`), que as reaplica em lote e as mostra na tela. Os dois
 * pacotes já dependem de `@workspace/db` e de mais nada em comum. Uma cópia da
 * lista de cada lado seria uma segunda autoridade semântica — exatamente o que
 * este arquivo existe para impedir — e `@workspace/curation` continua exportando
 * `CONFIRMED_SEMANTICS` e `applyConfirmations` daqui, para que nenhum chamador
 * precise saber que a lista mudou de casa.
 *
 * É a mesma decisão, e o mesmo endereço, de `garantirSemanticaInicial` ao lado:
 * a regra que a importação e a curadoria têm de compartilhar mora no piso que
 * as duas pisam.
 *
 * Não acrescente uma entrada que ninguém lhe disse. Um atributo sem confirmação
 * ficar UNKNOWN é o sistema funcionando; um palpite registrado aqui como fato,
 * não.
 */

// ---------------------------------------------------------------------------
// O vocabulário da semântica
// ---------------------------------------------------------------------------

/*
  As três listas fechadas vivem aqui pelo mesmo motivo que o registro: são o
  vocabulário das colunas `unit`, `periodicity` e `aggregation` desta mesma
  tabela, e `@workspace/curation` as reexporta. Quem escrevia `Unit` na
  curadoria e precisava dela na importação teria de copiá-la.
*/

export type Unit =
  | "BRL"
  | "BRL_KM"
  | "KM_L"
  | "PERCENT"
  | "KM"
  | "LITROS"
  | "MESES"
  | "ANO"
  | "QTD";

export type Aggregation = "SUM" | "AVG" | "WEIGHTED_AVG" | "NONE";
export type Periodicity = "MENSAL" | "ANUAL" | "PONTUAL";

export interface ConfirmedSemantics {
  code: string;
  unit: Unit | null;
  periodicity: Periodicity | null;
  aggregation: Aggregation;
  isMonetary: boolean;
  taxonomyCode?: string;
  /** A pessoa que decidiu. Nunca um identificador de sistema. */
  confirmedBy: string;
  /** Em que a decisão se baseou — o que um revisor vai querer ler. */
  basis: string;
}

export const CONFIRMED_SEMANTICS: ConfirmedSemantics[] = [
  {
    code: "carreta.custo_fixo",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Confirmado pelo transportador em 10/08/2026: custoFixo é um valor mensal por implemento.",
  },
  {
    code: "carreta.icms",
    unit: "PERCENT",
    // A rate has no periodicity — it is not an amount accruing over time.
    periodicity: null,
    aggregation: "NONE",
    isMonetary: false,
    taxonomyCode: "cf_seguros_tributos",
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Confirmado pelo transportador em 10/08/2026: a coluna icms é alíquota, não valor. " +
      "O montante correspondente é valorIcms. Consistente com a faixa observada (0 a 12).",
  },
  {
    code: "carreta.pis_cofins",
    unit: "PERCENT",
    periodicity: null,
    aggregation: "NONE",
    isMonetary: false,
    taxonomyCode: "cf_seguros_tributos",
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Confirmado pelo transportador em 10/08/2026: a coluna pisCofins é alíquota, não valor. " +
      "O montante correspondente é valorPisCofins. Consistente com a faixa observada (0 a 9,3).",
  },

  // ---------------------------------------------------------------------------
  // Bloco de alta confiança, aprovado em 10/08/2026 a partir de
  // docs/AUDITORIA-PERIODICIDADE.md. Cada entrada cita a conta que a sustenta —
  // nenhuma delas veio de interpretar nome de coluna.
  // ---------------------------------------------------------------------------

  // Cadeia A — custoFixo (já confirmado MENSAL) = finame + lucroFixomodeloNovoCiclo,
  // em 611 de 657 linhas. Uma soma não muda de periodicidade no meio.
  ...([
    ["carreta.finame", "cf_financiamento"],
    ["carreta.lucro_fixomodelo_novo_ciclo", "cf_remuneracao_capital"],
  ] as const).map(([code, taxonomyCode]) => ({
    code,
    unit: "BRL" as const,
    periodicity: "MENSAL" as const,
    aggregation: "SUM" as const,
    isMonetary: true,
    taxonomyCode,
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Aprovado em 10/08/2026 com base aritmética: custoFixo = finame + lucroFixomodeloNovoCiclo " +
      "em 611 de 657 linhas (93%), em todas as 9 vigências. Como custoFixo é confirmado MENSAL, " +
      "as duas parcelas são mensais — uma soma não muda de periodicidade no meio.",
  })),

  // Cadeia B — a amortização é o valor financiado dividido pelo prazo em MESES:
  // razão 1,108 (carretas, desvio 0,018) e 1,081 (cavalos, desvio 0,040).
  // Lida como anual, a conta erraria por um fator de treze.
  ...([
    ["carreta.finame_implemento", "cf_financiamento"],
    ["carreta.juros_finame_implemento", "cf_financiamento"],
    ["carreta.amortizacao_implemento", "cf_depreciacao"],
    ["cavalo.finame_cavalo", "cf_financiamento"],
    ["cavalo.juros_finame_cavalo", "cf_financiamento"],
    ["cavalo.amortizacao_cavalo", "cf_depreciacao"],
    ["cavalo.lucro_fixomodelo_novo_ciclo_cavalo", "cf_remuneracao_capital"],
  ] as const).map(([code, taxonomyCode]) => ({
    code,
    unit: "BRL" as const,
    periodicity: "MENSAL" as const,
    aggregation: "SUM" as const,
    isMonetary: true,
    taxonomyCode,
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Aprovado em 10/08/2026 com base aritmética: amortizacao ÷ (valorNF × (1 − entrada%) ÷ periodoFiname) " +
      "= 1,108 nas carretas (desvio 0,018) e 1,081 nos cavalos (desvio 0,040) — ou seja, o prazo do FINAME " +
      "está em meses. Lido como anual, erraria por um fator de 13. E finameImplemento = amortizacao + juros " +
      "em 37 de 38 implementos com ambas as parcelas não nulas.",
  })),

  // Cadeia D — 1,000% do valor da NF, desvio zero, de Jan a Jun/2026.
  // Um por cento ao ano é alíquota plausível; ao mês daria 12% a.a.
  {
    code: "cavalo.ipva_licenciamento",
    unit: "BRL",
    periodicity: "ANUAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_seguros_tributos",
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Aprovado em 10/08/2026: de Jan a Jun/2026 o valor é exatamente 1,000% de valorNfCompra para " +
      "as 62 placas, com desvio 0,0000. Um por cento do valor do veículo ao ano é alíquota plausível; " +
      "ao mês daria 12% a.a., o que não existe. Atenção: a base de cálculo mudou duas vezes na série " +
      "(2,52% médio → 1,000% fixo → 0,651% médio) — ver docs/ACHADO-IPVA.md.",
  },

  // Cadeia C — cinco colunas nunca variam nas 9 vigências, e valorPisCofins é
  // exatamente 9,250% da NF com desvio zero. São valores de aquisição.
  ...([
    ["carreta.valor_nf_compra", "cf_outros"],
    ["cavalo.valor_nf_compra", "cf_outros"],
  ] as const).map(([code, taxonomyCode]) => ({
    code,
    unit: "BRL" as const,
    periodicity: "PONTUAL" as const,
    aggregation: "SUM" as const,
    isMonetary: true,
    taxonomyCode,
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Aprovado em 10/08/2026: o valor nunca varia ao longo das 9 vigências para nenhum ativo " +
      "(100% com um único valor distinto). É o valor da nota de compra — grandeza de aquisição, " +
      "não fluxo periódico.",
  })),
  ...([
    ["carreta.valor_pis_cofins", "cf_seguros_tributos"],
    ["cavalo.valor_pis_cofins", "cf_seguros_tributos"],
  ] as const).map(([code, taxonomyCode]) => ({
    code,
    unit: "BRL" as const,
    periodicity: "PONTUAL" as const,
    aggregation: "SUM" as const,
    isMonetary: true,
    taxonomyCode,
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Aprovado em 10/08/2026: é exatamente 9,250% de valorNfCompra, com desvio 0,0000 nos 132 ativos, " +
      "e nunca varia ao longo da série. Tributo incidente sobre a nota de compra — valor de aquisição.",
  })),
];

// ---------------------------------------------------------------------------
// A escrita
// ---------------------------------------------------------------------------

export interface SemanticaConfirmada {
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  isMonetary: boolean | null;
  /**
   * O significado do cadastro que sustenta os quatro campos acima.
   *
   * Quem o **decide** é a curadoria: o caminho da tela o resolve com
   * `significadoPara` + `acharSignificado`, que vivem lá porque dependem do
   * catálogo. Esta função só o grava — nos três destinos, como tudo o mais.
   * Omitir o campo aqui faria a confirmação feita na tela perder o ponteiro
   * assim que a escrita passou a ser uma só.
   */
  meaningId?: string | null;
  taxonomyNodeId: string | null;
}

/**
 * Gravar uma semântica confirmada — a única função que o faz.
 *
 * Escreve nos três lugares que uma confirmação toca, e é por isso que ela é uma
 * função só:
 *
 * 1. `attribute`, que é a **projeção** da versão em vigor;
 * 2. `attribute_semantics` na versão aberta (`effective_until IS NULL`), que é
 *    o que a comparação lê na data de cada vigência — quem escrevesse só a
 *    projeção criaria duas verdades, e a que vale para o dinheiro seria a que
 *    ninguém escreveu;
 * 3. `curation_event`, um evento por campo que mudou, porque uma confirmação
 *    sem rastro de quem e por quê não é auditável.
 *
 * As **validações** não estão aqui: elas pertencem a quem chama. A confirmação
 * humana (`confirmAttribute`, na curadoria) recusa ator vazio, justificativa
 * vazia e semântica incoerente antes de chegar até aqui; a reaplicação do
 * registro canônico faz a sua própria conferência. O que esta função garante é
 * que os três destinos nunca divirjam.
 */
export async function gravarSemanticaConfirmada(
  db: Database,
  atributo: { id: string; code: string },
  semantica: SemanticaConfirmada,
  autoria: { actor: string; reason: string; confirmedAt?: Date },
): Promise<{ camposAlterados: string[] }> {
  const [antes] = await db
    .select()
    .from(attributeTable)
    .where(eq(attributeTable.id, atributo.id));

  const confirmadoEm = autoria.confirmedAt ?? new Date();
  const alvo = {
    unit: semantica.unit,
    periodicity: semantica.periodicity,
    aggregation: semantica.aggregation,
    isMonetary: semantica.isMonetary,
    // Quem não tem opinião sobre o significado preserva o que já estava lá.
    meaningId: semantica.meaningId !== undefined ? semantica.meaningId : (antes?.meaningId ?? null),
    taxonomyNodeId: semantica.taxonomyNodeId,
    semanticsStatus: "CONFIRMED" as const,
    confirmedBy: autoria.actor,
    confirmedAt: confirmadoEm,
  };

  const camposAlterados: string[] = [];
  const eventos: (typeof curationEventTable.$inferInsert)[] = [];
  const comparar = (field: string, before: unknown, after: unknown) => {
    const b = before === null || before === undefined ? null : String(before);
    const a = after === null || after === undefined ? null : String(after);
    if (b === a) return;
    camposAlterados.push(field);
    eventos.push({
      targetKind: "ATTRIBUTE",
      targetId: atributo.id,
      targetLabel: atributo.code,
      field,
      valueBefore: b,
      valueAfter: a,
      actor: autoria.actor,
      reason: autoria.reason,
    });
  };

  comparar("unit", antes?.unit, alvo.unit);
  comparar("periodicity", antes?.periodicity, alvo.periodicity);
  comparar("aggregation", antes?.aggregation, alvo.aggregation);
  comparar("is_monetary", antes?.isMonetary, alvo.isMonetary);
  // O significado entra no histórico como qualquer outro campo: é a afirmação
  // que passou a sustentar os quatro acima, e um revisor vai querer vê-la.
  comparar("meaning_id", antes?.meaningId, alvo.meaningId);
  comparar("taxonomy_node_id", antes?.taxonomyNodeId, alvo.taxonomyNodeId);
  comparar("semantics_status", antes?.semanticsStatus, alvo.semanticsStatus);

  await db
    .update(attributeTable)
    .set({ ...alvo, semanticsRationale: autoria.reason } as never)
    .where(eq(attributeTable.id, atributo.id));

  await db
    .update(attributeSemanticsTable)
    .set({
      unit: alvo.unit,
      periodicity: alvo.periodicity,
      aggregation: alvo.aggregation,
      isMonetary: alvo.isMonetary,
      meaningId: alvo.meaningId,
      taxonomyNodeId: alvo.taxonomyNodeId,
      semanticsStatus: alvo.semanticsStatus,
      rationale: autoria.reason,
      confirmedBy: autoria.actor,
      confirmedAt: confirmadoEm,
    })
    .where(
      and(
        eq(attributeSemanticsTable.attributeId, atributo.id),
        isNull(attributeSemanticsTable.effectiveUntil),
      ),
    );

  if (eventos.length > 0) await db.insert(curationEventTable).values(eventos);

  return { camposAlterados };
}

// ---------------------------------------------------------------------------
// A reaplicação do registro
// ---------------------------------------------------------------------------

export interface ApplyConfirmationsResult {
  /** Confirmados agora por esta passada. */
  applied: string[];
  /** Já estavam exatamente assim — nada foi escrito, nada foi reestampado. */
  unchanged: string[];
  /** Não existem nesta base: a fonte ainda não trouxe a coluna. */
  missing: string[];
  /**
   * Já confirmados por alguém, com semântica **diferente** da do registro.
   *
   * Não são sobrescritos. A pessoa que confirmou na tela é a autoridade sobre o
   * atributo dela; um lote que revertesse isso a cada importação apagaria uma
   * decisão humana em silêncio, uma vez por arquivo recebido. Divergir é
   * notícia para quem cuida do registro, e é por isso que sai na resposta.
   */
  divergentes: string[];
  /**
   * O atributo existe, mas o tipo de dado desta base contradiz o registro —
   * uma coluna monetária que chegou como texto, por exemplo.
   *
   * Também não é aplicado, e por um motivo prático além do conceitual: a
   * constraint `attribute_semantica_coerente` recusaria a escrita, e recusá-la
   * dentro da transação da promoção derrubaria a importação inteira por causa
   * de uma célula. A importação não decide semântica; ela replica a decisão
   * onde a decisão se sustenta, e relata o resto.
   */
  incoerentes: string[];
}

/** Tipos sobre os quais nenhum montante financeiro se sustenta. */
const TIPOS_NAO_NUMERICOS = new Set(["TEXT", "BOOLEAN", "DATE", "MIXED", "UNKNOWN"]);

/**
 * Reaplicar o registro numa base — idempotente.
 *
 * Roda em dois lugares, e é a mesma função nos dois: dentro da transação de
 * `promote` (`@workspace/ingest`), a cada promoção, e nas ferramentas de
 * curadoria que reconstroem uma base. Um atributo que já carrega exatamente
 * esta semântica é deixado em paz — sem evento e sem reestampar a data da
 * confirmação —, e é isso que permite chamá-la a cada importação.
 *
 * A taxonomia entra na comparação de propósito: numa base em que a árvore ainda
 * não foi semeada, a semântica é aplicada e o nó fica nulo; quando a árvore
 * chegar, a passada seguinte vê a diferença e preenche o nó em vez de concluir
 * "já está igual" e deixá-lo nulo para sempre.
 */
export async function aplicarConfirmacoesCanonicas(
  db: Database,
  registry: ConfirmedSemantics[] = CONFIRMED_SEMANTICS,
): Promise<ApplyConfirmationsResult> {
  const applied: string[] = [];
  const unchanged: string[] = [];
  const missing: string[] = [];
  const divergentes: string[] = [];
  const incoerentes: string[] = [];

  for (const entry of registry) {
    const [attribute] = await db
      .select()
      .from(attributeTable)
      .where(eq(attributeTable.code, entry.code));

    if (!attribute) {
      missing.push(entry.code);
      continue;
    }

    let taxonomyNodeId = attribute.taxonomyNodeId;
    if (entry.taxonomyCode) {
      const [node] = await db
        .select({ id: taxonomyNodeTable.id })
        .from(taxonomyNodeTable)
        .where(eq(taxonomyNodeTable.code, entry.taxonomyCode));
      // Sem árvore semeada, o nó não existe ainda — ver o doc acima.
      if (node) taxonomyNodeId = node.id;
    }

    const jaConfirmado = attribute.semanticsStatus === "CONFIRMED";
    const mesmaSemantica =
      attribute.unit === entry.unit &&
      attribute.periodicity === entry.periodicity &&
      attribute.aggregation === entry.aggregation &&
      attribute.isMonetary === entry.isMonetary;

    if (jaConfirmado && mesmaSemantica && attribute.taxonomyNodeId === taxonomyNodeId) {
      unchanged.push(entry.code);
      continue;
    }

    // Confirmado com outro significado: é decisão de quem confirmou, e o
    // registro não passa por cima dela — apenas relata a divergência.
    if (jaConfirmado && !mesmaSemantica) {
      divergentes.push(entry.code);
      continue;
    }

    if (entry.isMonetary && TIPOS_NAO_NUMERICOS.has(attribute.dataType)) {
      incoerentes.push(entry.code);
      continue;
    }

    /*
      Quem já confirmou o mesmo significado mantém a assinatura dele. O que
      sobra ao registro nesse caso é completar o que falta — o nó da taxonomia,
      que a promoção não tem como preencher numa base cuja árvore ainda não foi
      semeada —, e completar não é motivo para trocar o nome de quem decidiu
      nem a justificativa que ela escreveu.
    */
    const autoria =
      jaConfirmado && attribute.confirmedBy
        ? {
            actor: attribute.confirmedBy,
            reason: attribute.semanticsRationale ?? entry.basis,
          }
        : { actor: entry.confirmedBy, reason: entry.basis };

    await gravarSemanticaConfirmada(
      db,
      { id: attribute.id, code: attribute.code },
      {
        unit: entry.unit,
        periodicity: entry.periodicity,
        aggregation: entry.aggregation,
        isMonetary: entry.isMonetary,
        taxonomyNodeId,
      },
      autoria,
    );
    applied.push(entry.code);
  }

  return { applied, unchanged, missing, divergentes, incoerentes };
}
