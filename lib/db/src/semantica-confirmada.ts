import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "./index";
import {
  attributeSemanticsTable,
  attributeTable,
  curationEventTable,
  semanticMeaningTable,
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
  /**
   * O significado econômico que a decisão afirma — `montante_mes`,
   * `proporcao`…
   *
   * **Declarado, e não deduzido.** A curadoria deriva os quatro campos acima a
   * partir do significado escolhido na tela; aqui o caminho é o inverso, porque
   * estas entradas foram escritas antes de o cadastro existir. Declará-lo
   * mantém a decisão inteira num lugar só e evita que a importação precise da
   * regra de derivação, que vive em `@workspace/curation` — deduzi-lo aqui
   * seria uma segunda cópia dessa regra.
   *
   * Cada código tem de existir no cadastro (`semantic_meaning`), e o que ele
   * declara sobre unidade e periodicidade tem de bater com os campos acima —
   * `confirmations.test.ts` confere as duas coisas.
   */
  meaningCode?: string;
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
    meaningCode: "montante_mes",
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
    meaningCode: "proporcao",
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
    meaningCode: "proporcao",
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
    meaningCode: "montante_mes",
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
    meaningCode: "montante_mes",
    taxonomyCode,
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Aprovado em 10/08/2026 com base aritmética: amortizacao ÷ (valorNF × (1 − entrada%) ÷ periodoFiname) " +
      "= 1,108 nas carretas (desvio 0,018) e 1,081 nos cavalos (desvio 0,040) — ou seja, o prazo do FINAME " +
      "está em meses. Lido como anual, erraria por um fator de 13. E finameImplemento = amortizacao + juros " +
      "em 37 de 38 implementos com ambas as parcelas não nulas.",
  })),

  // Cadeia E — as duas parcelas próprias da carreta, medidas em 18/08/2026.
  //
  // As duas entram pelo mesmo argumento das Cadeias A e B, e não por leitura de
  // nome: **são parcelas de um total já confirmado como MENSAL, e uma soma não
  // muda de periodicidade no meio.** O que elas destravam é a linha própria da
  // carreta — sem elas, excluir as colunas de conjunto levaria embora também o
  // dinheiro que é do implemento.
  {
    code: "carreta.lucro_fixomodelo_novo_ciclo_carreta",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    meaningCode: "montante_mes",
    taxonomyCode: "cf_remuneracao_capital",
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Aprovado em 18/08/2026 com base aritmética: é parcela de " +
      "carreta.lucro_fixomodelo_novo_ciclo, que é parcela de custoFixo — confirmado MENSAL " +
      "pelo transportador em 10/08/2026. A decomposição foi medida nas 9 vigências: " +
      "lucroFixomodeloNovoCiclo = parcela da carreta + parcela do cavalo em 284 de 284 " +
      "pares não nulos, com 36 pares em que as duas parcelas coexistem. É esta coluna que " +
      "passa a ser a linha da carreta depois que o total do conjunto sai do escopo dela.",
  },
  {
    code: "carreta.custo_aluguel",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    meaningCode: "montante_mes",
    taxonomyCode: "cf_financiamento",
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Aprovado em 18/08/2026 com base aritmética: finameImplemento = amortizacaoImplemento " +
      "+ jurosFinameImplemento + custoAluguel em 369 de 369 linhas (346 exatas, 23 por " +
      "arredondamento, zero falhas); sem esta terceira parcela a identidade falha em 18 " +
      "linhas, todas de implementos alugados, em que o custo inteiro está no aluguel. Como " +
      "finameImplemento é confirmado MENSAL pela Cadeia B, a parcela é mensal. Fica na " +
      "classe do financiamento porque é o que ocupa o lugar dele: são os implementos que a " +
      "frota aluga em vez de financiar.",
  },

  // Cadeia D — 1,000% do valor da NF, desvio zero, de Jan a Jun/2026.
  // Um por cento ao ano é alíquota plausível; ao mês daria 12% a.a.
  {
    code: "cavalo.ipva_licenciamento",
    unit: "BRL",
    periodicity: "ANUAL",
    aggregation: "SUM",
    isMonetary: true,
    meaningCode: "montante_ano",
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
    meaningCode: "montante_aquisicao",
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
    meaningCode: "montante_aquisicao",
    taxonomyCode,
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Aprovado em 10/08/2026: é exatamente 9,250% de valorNfCompra, com desvio 0,0000 nos 132 ativos, " +
      "e nunca varia ao longo da série. Tributo incidente sobre a nota de compra — valor de aquisição.",
  })),

  // ---------------------------------------------------------------------------
  // Bloco de 29/08/2026 — os números que ninguém tinha classificado.
  //
  // Quarenta e uma colunas que a ficha contava como "sem classificação" e que
  // **nenhuma delas é montante financeiro**. A investigação inteira, com as
  // contas que sustentam cada grupo abaixo, está em
  // `docs/CLASSIFICACAO-DOS-NAO-APURADOS.md`; o inventário é reproduzível por
  // `lib/composition/src/cli/inventario-sem-classificacao.ts`.
  //
  // **Este bloco não move um centavo, e isso é uma propriedade e não um
  // acidente.** Toda entrada aqui declara `isMonetary: false` e
  // `aggregation: "NONE"` — o portão de `lib/composition/src/motor.ts` recusa
  // as duas coisas antes de qualquer soma. O que muda é o motivo com que a
  // tela as recusa: sai "ninguém olhou para esta coluna" e entra "alguém
  // decidiu que não é dinheiro". `composicao-real.test.ts` prende os totais
  // antes e depois.
  //
  // O que **não** entrou, de propósito: `lucroVariavelPrevistoCavalo` e
  // `lucroVariavelPrevistoCarreta` (0,65% do valor da nota — é dinheiro, e a
  // periodicidade é decisão de negócio), `carreta.lucroVariavelPrevisto` (é o
  // conjunto, e somá-lo com os dois contaria o cavalo duas vezes),
  // `custoVariavelSimulado`, o seguro e os acessórios da carreta, as duas
  // colunas homônimas de IPVA da carreta e as colunas zeradas na série
  // inteira. Nenhuma delas se decide por medição.

  // **O nó da taxonomia é o que a curadoria já tinha dado, em toda entrada
  // deste bloco em que ela já tinha dado um.** Confirmar semântica é dizer o
  // que a coluna mede; remanejar a árvore é outra decisão, de outro dono, e
  // fazer as duas no mesmo commit esconderia a segunda dentro da primeira. As
  // três exceções são colunas que estavam em `nao_classificado` — `reaiskm`,
  // `valorReajustado` e `percentualReajusteAplicado` —, onde não havia decisão
  // a preservar. Omitir o nó não é alternativa: atributo que nasce CONFIRMED
  // sem nó fica sem ele para sempre, porque a passada de propostas só olha o
  // que não está confirmado.
  //
  // Razões em R$/km. Uma razão vira dinheiro multiplicada pela quilometragem
  // rodada no período, que este export não traz — e por isso ela é confirmada
  // como razão, não como montante. `valorReajustado` = `reaiskm` × (1 +
  // reajuste) em 126 de 126 linhas, e `manutencaoContrato` == `valorReajustado`
  // em 558 de 558: as duas são derivadas da terceira e nunca somam com ela.
  ...([
    "cavalo.manutencao_reais_km",
    "cavalo.manutencao_bid",
    "cavalo.reaiskm",
    "cavalo.valor_reajustado",
    "cavalo.manutencao_contrato",
  ] as const).map((code) => ({
    code,
    unit: "BRL_KM" as const,
    periodicity: null,
    aggregation: "NONE" as const,
    isMonetary: false,
    meaningCode: "taxa_km",
    taxonomyCode: "cv_manutencao",
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Aprovado em 29/08/2026: são R$/km de manutenção, declarados como tal pelo próprio time no " +
      "dicionário do cavalo. Medido nas 558 linhas: valorReajustado = reaiskm × (1 + reajuste) em " +
      "126/126, e manutencaoContrato == valorReajustado em 558/558. Razão não é montante: vira " +
      "dinheiro com a quilometragem rodada no período, que este export não traz.",
  })),

  // Alíquotas. Uma alíquota não é montante — o dinheiro correspondente está em
  // outra coluna, quando existe. Medido: taxaFiname é a composição
  // multiplicativa de TJLP, spread BNDES e spread banco em 558 de 558 linhas
  // do cavalo — é subtotal dos outros três, nunca uma quarta grandeza.
  ...([
    ["cavalo.taxa_finame", "cf_financiamento"],
    ["cavalo.tjlp", "cf_financiamento"],
    ["cavalo.spread_bndes", "cf_financiamento"],
    ["cavalo.spread_banco", "cf_financiamento"],
    ["cavalo.percentual_entrada", "cf_financiamento"],
    ["cavalo.percentual_icms", "cf_seguros_tributos"],
    // Sem nó até aqui (`nao_classificado`): o reajuste é do contrato de
    // manutenção, e é o único deste grupo em que a confirmação decide o nó
    // em vez de repetir o que a curadoria já tinha decidido.
    ["cavalo.percentual_reajuste_aplicado", "cv_manutencao"],
    ["cavalo.combustivel_percentual_perda_vida", "cv_combustivel"],
    ["carreta.taxa_finame", "cf_financiamento"],
    ["carreta.tjlp", "cf_financiamento"],
    ["carreta.spread_bndes", "cf_financiamento"],
    ["carreta.spread_banco", "cf_financiamento"],
    ["carreta.percentual_entrada", "cf_financiamento"],
    ["carreta.percentual_icms", "cf_seguros_tributos"],
  ] as const).map(([code, taxonomyCode]) => ({
    code,
    unit: "PERCENT" as const,
    periodicity: null,
    aggregation: "NONE" as const,
    isMonetary: false,
    meaningCode: "proporcao",
    taxonomyCode,
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Aprovado em 29/08/2026: alíquota, não montante — o mesmo argumento que já vale para " +
      "carreta.icms e carreta.pisCofins desde 10/08/2026. Medido nas 558 linhas do cavalo: " +
      "taxaFiname = ((1+TJLP)(1+spreadBNDES)(1+spreadBanco) − 1) em 558/558, ou seja, ela é a " +
      "composição das outras três e não uma quarta grandeza. A soma simples fecharia em só 428.",
  })),

  // Prazos em meses. São o eixo do tempo do financiamento e da manutenção —
  // mudam quando a parcela é calculada, e não são a parcela. `periodoFiname` em
  // meses não é suposição: é o que a razão 1,081 da amortização comprova
  // (Cadeia B, 10/08/2026). E `manutencaoFreeMaintenance` == `freeMaintenance`
  // em 558 de 558 linhas — a mesma medida com dois nomes.
  ...([
    ["cavalo.periodo_finame", "cf_financiamento"],
    ["cavalo.carencia", "cad_contrato"],
    ["cavalo.free_maintenance", "cv_manutencao"],
    ["cavalo.manutencao_free_maintenance", "cv_manutencao"],
    ["cavalo.manutencao_vida_meses", "cv_manutencao"],
    ["carreta.periodo_finame", "cf_financiamento"],
    ["carreta.carencia", "cad_contrato"],
  ] as const).map(([code, taxonomyCode]) => ({
    code,
    unit: "MESES" as const,
    periodicity: null,
    // AVG e não NONE: é o que `derivarSemantica` produz para uma GRANDEZA, e a
    // frase que está lá vale inteira aqui — "a média descreve a frota; a soma
    // de 'meses de vida útil' de 62 cavalos não descreve nada". Média nunca
    // vira total: o portão do dinheiro exige `isMonetary`, que é falso.
    aggregation: "AVG" as const,
    isMonetary: false,
    meaningCode: "grandeza_mes",
    taxonomyCode,
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Aprovado em 29/08/2026: prazo em meses, não dinheiro. O prazo do FINAME em meses é o que a " +
      "Cadeia B mediu em 10/08/2026 (razão 1,081 da amortização). manutencaoFreeMaintenance == " +
      "freeMaintenance em 558/558 — duplicata, e as duas ficam fora de qualquer total.",
  })),

  // Contadores. Pallets, ciclo: números que descrevem o ativo e não se somam
  // entre equipamentos. Medido no cavalo: ciclo 1 ⟺ amortização > 0 e lucro
  // fixo = 0 (503 linhas); ciclo 2 ⟺ amortização = 0 (55) — 554 de 558. O
  // ciclo é consequência do financiamento acabar, não causa de valor.
  //
  // **O nó é o que a curadoria já tinha decidido, e é deliberado.** A tentação
  // era mandar a capacidade para "Capacidade" e o ciclo para "Ciclo e
  // frequência", que existem na árvore e descrevem bem os dois. Duas razões
  // contra: a capacidade saiu de Combustível para Especificação técnica numa
  // curadoria de 16/08/2026 — mover de novo seria desfazer decisão de gente
  // pelas costas —, e o dicionário do cavalo classifica as duas colunas como
  // "Cadastral (não entra na DRE)". Confirmar semântica não é remanejar
  // taxonomia; o nó continua sendo assunto da curadoria.
  //
  // O que **não** se pode fazer é omitir o nó: um atributo que nasce CONFIRMED
  // sem nó fica sem ele para sempre, porque a passada de propostas só olha o
  // que não está confirmado — é o mesmo defeito que
  // `garantirClasseDeCustoPadrao` documenta ao lado.
  ...([
    ["cavalo.combustivel_capacidade", "cad_especificacao"],
    ["cavalo.ciclo", "cad_contrato"],
    ["carreta.ciclo", "cad_contrato"],
  ] as const).map(([code, taxonomyCode]) => ({
    code,
    unit: "QTD" as const,
    periodicity: null,
    aggregation: "AVG" as const,
    isMonetary: false,
    meaningCode: "grandeza_qtd",
    taxonomyCode,
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Aprovado em 29/08/2026: contador do ativo, não montante. combustivelCapacidade é a " +
      "capacidade de pallets — o cabeçalho do time diz 'CAPACIDADE DE PALLETS PARA CALCULO DE " +
      "COMBUSTIVEL', e é ele que desempata o palpite de litros que guessUnit fazia. E o ciclo é " +
      "consequência do financiamento acabar: ciclo 2 ⟺ amortização = 0 em 554 das 558 linhas.",
  })),

  // Consumo em km/l. É a régua com que os litros são reconhecidos, e o preço do
  // litro não vem neste export — sem ele, nem o consumo nem a régua viram
  // dinheiro.
  ...([
    "cavalo.combustivel_consumo_neg",
    "cavalo.combustivel_consumo_benchmark",
  ] as const).map((code) => ({
    code,
    unit: "KM_L" as const,
    periodicity: null,
    aggregation: "NONE" as const,
    isMonetary: false,
    meaningCode: "consumo",
    taxonomyCode: "cv_combustivel",
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Aprovado em 29/08/2026: km/l é consumo, não montante. Vira dinheiro com a quilometragem " +
      "rodada e o preço do litro, e este export não traz nenhum dos dois. Medido: o preço " +
      "implícito do diesel em custoVariavelSimulado varia de R$ 5,78 a R$ 6,42 por vigência — " +
      "existe uma tabela de preço fora deste arquivo, e ela é que falta.",
  })),

  // Hodômetro na entrada. É a quilometragem **acumulada na chegada do ativo**, e
  // não a rodada no período — a diferença importa porque é exatamente a segunda
  // que destravaria os R$/km acima. Confirmá-la como KM impede que alguém a
  // tome pela outra.
  //
  // O nó é o que a curadoria já lhe deu, pelo mesmo motivo do bloco acima: o
  // dicionário do cavalo classifica o hodômetro como cadastral.
  {
    code: "cavalo.odometro_entrada",
    unit: "KM",
    periodicity: null,
    aggregation: "AVG",
    isMonetary: false,
    meaningCode: "grandeza_km",
    taxonomyCode: "cad_especificacao",
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Aprovado em 29/08/2026: hodômetro na entrada do ativo, declarado pelo time como " +
      "'KILOMETRAGEM ATUAL DO VEICULO'. Medido: muda uma vez por placa em 62 de 62, sem mover " +
      "nenhum valor monetário na mesma transição. Não é a quilometragem rodada no período — a " +
      "que falta para os R$/km virarem dinheiro — e por isso não destrava conta nenhuma.",
  },

  // Anos de calendário. 2021 não é uma quantidade: somar ou tirar média de anos
  // de calendário produz um número sem significado. Medido: anoBid ==
  // manutencaoAno em 558 de 558 linhas — duplicata.
  ...([
    ["cavalo.ano", "cad_identificacao"],
    ["cavalo.ano_bid", "cad_contrato"],
    ["cavalo.manutencao_ano", "cv_manutencao"],
    ["carreta.ano", "cad_identificacao"],
  ] as const).map(([code, taxonomyCode]) => ({
    code,
    unit: "ANO" as const,
    periodicity: null,
    aggregation: "NONE" as const,
    isMonetary: false,
    meaningCode: "descritor_ano_calendario",
    taxonomyCode,
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Aprovado em 29/08/2026: ano de calendário, não quantidade — a soma dos 62 cavalos dá " +
      "125.351, que não significa nada. Medido: anoBid == manutencaoAno em 558/558 linhas, e " +
      "as duas são a linha da matriz do BID em que o veículo cai.",
  })),

  // Índices e códigos, sem unidade — e é deliberado que fiquem sem.
  //
  // O vocabulário de unidades deste produto não tem termo para "ordinal do
  // calendário", "idade em anos" nem "código de cadastro", e inventar um aqui
  // seria decidir vocabulário no meio de uma confirmação. `unit: null` diz o
  // que se sabe sem afirmar o que não se sabe; o que a confirmação decide — e
  // é tudo o que ela precisa decidir — é que **não é dinheiro e não se soma**.
  //
  // `operadorPromax` é o caso que mais justifica o bloco: é o código Promax do
  // transportador, vale 1 na frota inteira, e qualquer agregação cega o somava
  // como se fosse quantidade — 62 no cavalo, 71 na carreta.
  ...([
    ["cavalo.combustivel_vida_cavalo", "cv_combustivel", "idade do cavalo em anos, contada da compra"],
    ["cavalo.mes_de_entrada", "cad_contrato", "mês do calendário em que o ativo entrou"],
    ["cavalo.operador_promax", "cad_escopo", "código Promax do transportador"],
    ["carreta.mes_de_entrada", "cad_contrato", "mês do calendário em que o ativo entrou"],
    ["carreta.operador_promax", "cad_escopo", "código Promax do transportador"],
  ] as const).map(([code, taxonomyCode, oQueE]) => ({
    code,
    unit: null,
    periodicity: null,
    aggregation: "NONE" as const,
    isMonetary: false,
    taxonomyCode,
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      `Aprovado em 29/08/2026: ${oQueE} — não é montante e não se soma. Fica sem unidade de ` +
      "propósito: o vocabulário atual não tem termo para ordinal de calendário, idade em anos " +
      "nem código de cadastro, e inventar um aqui seria decidir vocabulário dentro de uma " +
      "confirmação. Medido em combustivelVidaCavalo: razão 12,17 com manutencaoVidaMeses nas " +
      "558 linhas — é relógio, não premissa que alguém negocie.",
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
  autoria: {
    actor: string;
    /** A justificativa, quando houver — a curadoria deixou de exigi-la. */
    reason: string | null;
    confirmedAt?: Date;
    /**
     * Sob que campos registrar o ato quando nenhum valor muda.
     *
     * A confirmação humana é um **ato**, e não um diff: alguém olhou a coluna e
     * assinou embaixo. Quando a importação já havia replicado a mesma decisão
     * canônica, os campos não mudam — e sem isto o ato não deixaria rastro
     * nenhum, o que quebra a auditoria justamente no caso em que ela mais
     * importa: quem foi a pessoa, e quando.
     *
     * Quem chama diz **quais** campos a pessoa afirmou, porque só ele sabe: a
     * tela que confirma pelo significado afirma o significado; a confirmação
     * campo a campo afirma o estado. O evento sai com antes e depois iguais, de
     * propósito.
     *
     * A replicação do registro canônico deixa isto vazio: ela roda a cada
     * importação, e um evento por arquivo recebido seria ruído afogando os atos
     * de gente.
     */
    camposDoAto?: string[];
  },
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

  /*
    Sem justificativa, o que já estava escrito em prosa fica — nos **dois**
    destinos, e é por isso que o mesmo `if` aparece duas vezes logo abaixo.

    A coluna guarda a leitura do motor até que alguém escreva por cima dela.
    Sobrescrevê-la com nulo faria a confirmação *apagar* a análise que a tela
    mostra: o ato de confirmar passaria a destruir a evidência que ele deveria
    acrescentar. E apagar de um só lado seria pior que apagar dos dois —
    `semantics_rationale` é campo projetado, e `divergenciasDaProjecao` compara
    a projeção com a vigência exatamente para acusar quando as duas discordam.
  */
  const emProsa = autoria.reason ? { rationale: autoria.reason } : {};

  await db
    .update(attributeTable)
    .set({
      ...alvo,
      ...(emProsa.rationale ? { semanticsRationale: emProsa.rationale } : {}),
    } as never)
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
      ...emProsa,
      confirmedBy: autoria.actor,
      confirmedAt: confirmadoEm,
    })
    .where(
      and(
        eq(attributeSemanticsTable.attributeId, atributo.id),
        isNull(attributeSemanticsTable.effectiveUntil),
      ),
    );

  {
    /*
      O ato, campo a campo — e **não** só quando nada mudou.
      
      A primeira versão disto só registrava o ato num diff vazio, e isso
      escondia o caso mais comum: a pessoa confirma, um campo muda (o nó da
      taxonomia, digamos) e os que ela de fato afirmou — o significado, o
      estado — continuam iguais. O evento do nó não diz que alguém confirmou o
      significado; só um evento sob aquele campo diz.
      
      Por isso a regra é por campo: quem já tem evento de mudança não ganha
      outro, e quem não tem ganha o registro do ato, com antes e depois iguais.
    */
    const valorDe: Record<string, string | null> = {
      semantics_status: alvo.semanticsStatus,
      meaning_id: alvo.meaningId ?? null,
      taxonomy_node_id: alvo.taxonomyNodeId,
      unit: alvo.unit,
      periodicity: alvo.periodicity,
      aggregation: alvo.aggregation,
    };
    for (const campo of autoria.camposDoAto ?? []) {
      if (camposAlterados.includes(campo)) continue;
      const valor = valorDe[campo] ?? null;
      eventos.push({
        targetKind: "ATTRIBUTE",
        targetId: atributo.id,
        targetLabel: atributo.code,
        field: campo,
        valueBefore: valor,
        valueAfter: valor,
        actor: autoria.actor,
        reason: autoria.reason,
      });
    }
  }

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

    /*
      O significado declarado, resolvido como o nó da taxonomia: por código, no
      escopo global do cadastro. Numa base cuja migration ainda não semeou o
      catálogo o código não existe, e aí o ponteiro fica como estava — a
      semântica é aplicada do mesmo jeito, e a passada seguinte o completa.
    */
    let meaningId = attribute.meaningId;
    if (entry.meaningCode) {
      const [significado] = await db
        .select({ id: semanticMeaningTable.id })
        .from(semanticMeaningTable)
        .where(
          and(
            eq(semanticMeaningTable.scopeType, "GLOBAL"),
            eq(semanticMeaningTable.scopeCode, "*"),
            eq(semanticMeaningTable.code, entry.meaningCode),
          ),
        );
      if (significado) meaningId = significado.id;
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

    if (
      jaConfirmado &&
      mesmaSemantica &&
      attribute.meaningId === meaningId &&
      attribute.taxonomyNodeId === taxonomyNodeId
    ) {
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
        meaningId,
        taxonomyNodeId,
      },
      autoria,
    );
    applied.push(entry.code);
  }

  return { applied, unchanged, missing, divergentes, incoerentes };
}
