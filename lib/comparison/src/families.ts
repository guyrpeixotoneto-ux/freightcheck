/**
 * As famílias de parâmetros — o vocabulário do Freightech, aplicado ao nosso
 * dicionário.
 *
 * Quem usa o Freightech todo dia aprendeu uma organização: escolhe canal,
 * vigência e unidade, e então encontra os parâmetros agrupados em FROTA,
 * DIMENSÕES, EQUIPE, PARÂMETROS GERAIS. Este arquivo é o que permite o
 * FreightCheck falar essa língua sem trocar a sua.
 *
 * **Por que isto é um mapa em código, e não uma árvore no banco.**
 *
 * O FreightCheck já tem uma taxonomia, e ela responde outra pergunta: *custo
 * fixo ou variável?* — que alimenta `classification.ts`, que alimenta
 * `assessImpact`, e que fica gravada em `change.taxonomy_path` a cada
 * comparação. Reclassificar os 138 atributos para caber nas famílias mudaria a
 * classe de custo das comparações futuras e as faria divergir das já gravadas:
 * uma mudança silenciosa de significado, que é exatamente o que este produto
 * existe para denunciar.
 *
 * Família e classe de custo são **eixos ortogonais**, e os dois são verdade ao
 * mesmo tempo: `cavalo.ipva_licenciamento` é *Custo Fixo → Seguros e tributos*
 * e *Tributos e seguros → IPVA e licenciamento*. Então o eixo novo entra ao
 * lado do antigo, sem tocar nele — e mora em código pelo mesmo motivo que
 * `labels.ts`: preencher uma coluna seria alterar dado, e um mapa revisto num
 * pull request é mais fácil de auditar do que um `UPDATE`.
 *
 * **Duas regras que este arquivo respeita.**
 *
 * 1. **Nada é descartado.** Todo atributo do export tem lugar. Um atributo que
 *    a Ambev inventar amanhã cai em `SEM_FAMILIA`, que aparece na tela com esse
 *    nome — nunca some.
 * 2. **Nada é inventado.** Uma família do Freightech sem nenhum atributo nosso
 *    não vira cartão vazio; vira a nota de rodapé de `FREIGHTECH_SEM_DADO`,
 *    que diz o que o Freightech publica e este export não traz.
 */

/** Ordem de exibição. A primeira é a que mais mexe em dinheiro nesta base. */
export const FAMILY_ORDER = [
  "FROTA",
  "AQUISICAO_FINANCIAMENTO",
  "TRIBUTOS_SEGUROS",
  "MODELOS_REMUNERACAO",
  "DIMENSOES",
  "GERAL",
  "PARAMETROS_GERAIS",
  "CONTRATO_CICLO",
  "CONTEXTO",
  "SEM_FAMILIA",
] as const;

export type FamilyCode = (typeof FAMILY_ORDER)[number];

export interface FamilyDefinition {
  code: FamilyCode;
  name: string;
  /** De onde o nome veio: reconhecimento é o ponto, então isto é dito na tela. */
  origin: "FREIGHTECH" | "FREIGHTCHECK";
  /** Uma frase sobre o que a família reúne. */
  note: string;
}

export const FAMILIES: Record<FamilyCode, FamilyDefinition> = {
  FROTA: {
    code: "FROTA",
    name: "Frota",
    origin: "FREIGHTECH",
    note: "O ativo e o que ele consome: caminhão, combustível, manutenção, pneu.",
  },
  AQUISICAO_FINANCIAMENTO: {
    code: "AQUISICAO_FINANCIAMENTO",
    name: "Aquisição e financiamento",
    origin: "FREIGHTCHECK",
    note:
      "FINAME, juros, amortização, prazos e taxas. Não há cartão equivalente nas telas " +
      "do Freightech que conhecemos, e é onde está a maior parte do dinheiro deste export.",
  },
  TRIBUTOS_SEGUROS: {
    code: "TRIBUTOS_SEGUROS",
    name: "Tributos e seguros",
    origin: "FREIGHTCHECK",
    note:
      "IPVA, licenciamento, seguro, ICMS e PIS/COFINS. Separado da manutenção de propósito: " +
      "o IPVA do cavalo é 1% do valor da nota, não um serviço — ver docs/ACHADO-IPVA.md.",
  },
  MODELOS_REMUNERACAO: {
    code: "MODELOS_REMUNERACAO",
    name: "Modelos de remuneração",
    origin: "FREIGHTECH",
    note: "Lucro fixo do novo ciclo e remuneração variável.",
  },
  DIMENSOES: {
    code: "DIMENSOES",
    name: "Dimensões",
    origin: "FREIGHTECH",
    note: "O que descreve o implemento: capacidade, eixo, carroceria.",
  },
  GERAL: {
    code: "GERAL",
    name: "Geral",
    origin: "FREIGHTECH",
    note: "Índice de reajuste.",
  },
  PARAMETROS_GERAIS: {
    code: "PARAMETROS_GERAIS",
    name: "Parâmetros gerais",
    origin: "FREIGHTECH",
    note: "Empresa locadora, região e condições comerciais da operação.",
  },
  CONTRATO_CICLO: {
    code: "CONTRATO_CICLO",
    name: "Contrato e ciclo",
    origin: "FREIGHTCHECK",
    note: "Fim de contrato e ciclo do ativo.",
  },
  CONTEXTO: {
    code: "CONTEXTO",
    name: "Contexto (não remuneratório)",
    origin: "FREIGHTCHECK",
    note:
      "Unidade, operador e identificadores. Descrevem de quem é a linha; não são " +
      "remuneração e nunca entram num total.",
  },
  SEM_FAMILIA: {
    code: "SEM_FAMILIA",
    name: "Sem família",
    origin: "FREIGHTCHECK",
    note:
      "Atributos que o mapa ainda não classificou — uma coluna nova da fonte cai aqui. " +
      "Aparece justamente para não sumir.",
  },
};

/**
 * `código do atributo` → `[família, parâmetro]`.
 *
 * O parâmetro é o cartão do Freightech: "Pneu", "Combustível", "Manutenção
 * Cavalo". No Freightech ele abre uma tabela com várias colunas; aqui ele reúne
 * os atributos correspondentes. **Nunca é 1-para-1 com atributo.**
 *
 * As chaves foram geradas pelo próprio `slugifyColumn` sobre os cabeçalhos
 * reais das abas `carretas` e `cavalos` — não digitadas à mão — e um teste
 * confere que as 138 continuam cobertas.
 */
const MAP: Record<string, [FamilyCode, string]> = {
  // ---- GERAL ---------------------------------------------------------------
  "cavalo.percentual_reajuste_aplicado": ["GERAL", "Índice de reajuste"],
  "cavalo.valor_reajustado": ["GERAL", "Índice de reajuste"],

  // ---- DIMENSÕES -----------------------------------------------------------
  "carreta.implemento": ["DIMENSOES", "Implemento"],
  "carreta.modelo": ["DIMENSOES", "Implemento"],
  "carreta.capacidade_empurrada": ["DIMENSOES", "Implemento"],
  "carreta.capacidade_pallets_real_empurrada": ["DIMENSOES", "Implemento"],
  "carreta.eixo_empurrada": ["DIMENSOES", "Implemento"],
  "carreta.tipo_carroceria_empurrada": ["DIMENSOES", "Implemento"],
  "carreta.double_deck": ["DIMENSOES", "Implemento"],

  // ---- FROTA ---------------------------------------------------------------
  "cavalo.chassi": ["FROTA", "Caminhão"],
  "cavalo.ano": ["FROTA", "Caminhão"],
  "cavalo.montadora": ["FROTA", "Caminhão"],
  "cavalo.modelo_empurrada": ["FROTA", "Caminhão"],
  "cavalo.cambio": ["FROTA", "Caminhão"],
  "cavalo.padrao": ["FROTA", "Caminhão"],
  "cavalo.eixo_empurrada": ["FROTA", "Caminhão"],
  "cavalo.ativo": ["FROTA", "Caminhão"],
  "cavalo.frota_emprestada": ["FROTA", "Caminhão"],
  "cavalo.odometro_entrada": ["FROTA", "Caminhão"],
  "cavalo.faixa_km": ["FROTA", "Caminhão"],
  "cavalo.placa_carreta": ["FROTA", "Caminhão"],

  "carreta.chassi": ["FROTA", "Carreta"],
  "carreta.ano": ["FROTA", "Carreta"],
  "carreta.frota_emprestada": ["FROTA", "Carreta"],

  "carreta.custo_aluguel": ["FROTA", "Caminhão aluguel"],
  "cavalo.custo_aluguel": ["FROTA", "Caminhão aluguel"],

  "cavalo.combustivel_capacidade": ["FROTA", "Combustível"],
  "cavalo.combustivel_consumo_neg": ["FROTA", "Combustível"],
  "cavalo.combustivel_consumo_neg_inteiro": ["FROTA", "Combustível"],
  "cavalo.combustivel_vida_cavalo": ["FROTA", "Combustível"],
  "cavalo.combustivel_percentual_perda_vida": ["FROTA", "Combustível"],
  "cavalo.tipo_combustivel_empurrada": ["FROTA", "Combustível"],

  "cavalo.combustivel_consumo_benchmark": ["FROTA", "Consumo benchmark"],

  "cavalo.manutencao_contrato": ["FROTA", "Contrato de manutenção"],
  "cavalo.manutencao_free_maintenance": ["FROTA", "Contrato de manutenção"],
  "cavalo.free_maintenance": ["FROTA", "Contrato de manutenção"],

  "cavalo.manutencao_bid": ["FROTA", "Manutenção BID"],
  "cavalo.ano_bid": ["FROTA", "Manutenção BID"],
  "cavalo.ganhador_bid": ["FROTA", "Manutenção BID"],
  "cavalo.manutencao_compra_fora_do_bid_autorizada": ["FROTA", "Manutenção BID"],
  "cavalo.manutencao_ano": ["FROTA", "Manutenção BID"],

  "cavalo.manutencao_reais_km": ["FROTA", "Manutenção cavalo"],
  "cavalo.manutencao_reais_km_inteiro": ["FROTA", "Manutenção cavalo"],
  "cavalo.manutencao_vida_meses": ["FROTA", "Manutenção cavalo"],
  "cavalo.reaiskm": ["FROTA", "Manutenção cavalo"],

  // A confirmar com o cliente: são itens de carroceria com valor em reais, e o
  // cartão "Manutenção Carroceria" existe no Freightech. Enquanto a resposta não
  // vem, ficam aqui e o parâmetro é marcado como pendente (PENDING_PARAMETERS).
  "carreta.revestimento": ["FROTA", "Manutenção carroceria"],
  "carreta.faixa_reflexiva": ["FROTA", "Manutenção carroceria"],
  "carreta.tacografo": ["FROTA", "Manutenção carroceria"],
  "carreta.rastreador": ["FROTA", "Manutenção carroceria"],

  "cavalo.valor_pneu": ["FROTA", "Pneu"],
  "carreta.valor_pneus": ["FROTA", "Pneu"],
  "cavalo.pneu_medida_empurrada": ["FROTA", "Pneu"],
  "carreta.pneu_medida_empurrada": ["FROTA", "Pneu"],

  // ---- MODELOS DE REMUNERAÇÃO ---------------------------------------------
  "carreta.lucro_fixomodelo_novo_ciclo": ["MODELOS_REMUNERACAO", "Lucro fixo (novo ciclo)"],
  "carreta.lucro_fixomodelo_novo_ciclo_carreta": ["MODELOS_REMUNERACAO", "Lucro fixo (novo ciclo)"],
  "cavalo.lucro_fixomodelo_novo_ciclo_cavalo": ["MODELOS_REMUNERACAO", "Lucro fixo (novo ciclo)"],

  // O Freightech separa "Remuneração Variável Antigo" de "Novo". Nada no dado
  // diz qual das nossas colunas é qual, então é **um** parâmetro até alguém
  // responder — dividir em dois pelo palpite seria inventar a resposta.
  "carreta.lucro_variavel_previsto": ["MODELOS_REMUNERACAO", "Remuneração variável"],
  "carreta.lucro_variavel_previsto_carreta": ["MODELOS_REMUNERACAO", "Remuneração variável"],
  "cavalo.lucro_variavel_previsto_cavalo": ["MODELOS_REMUNERACAO", "Remuneração variável"],
  "cavalo.custo_variavel_simulado": ["MODELOS_REMUNERACAO", "Remuneração variável"],

  // ---- PARÂMETROS GERAIS ---------------------------------------------------
  "carreta.empresa_locadora": ["PARAMETROS_GERAIS", "Empresa locadora"],
  "cavalo.empresa_locadora": ["PARAMETROS_GERAIS", "Empresa locadora"],
  "cavalo.regiao_empurrada": ["PARAMETROS_GERAIS", "Região"],
  "carreta.organizacao_de_compras": ["PARAMETROS_GERAIS", "Parâmetros de operação"],
  "cavalo.organizacao_de_compras": ["PARAMETROS_GERAIS", "Parâmetros de operação"],
  "carreta.prazo_pagamento": ["PARAMETROS_GERAIS", "Parâmetros de operação"],
  "cavalo.prazo_pagamento": ["PARAMETROS_GERAIS", "Parâmetros de operação"],

  // ---- AQUISIÇÃO E FINANCIAMENTO ------------------------------------------
  // O titular de uma composição declarada: custoFixo = finame + lucroFixo.
  // Fica no seu próprio parâmetro para que a tela possa dizer isso.
  "carreta.custo_fixo": ["AQUISICAO_FINANCIAMENTO", "Custo fixo (total)"],

  "carreta.valor_nf_compra": ["AQUISICAO_FINANCIAMENTO", "Aquisição"],
  "cavalo.valor_nf_compra": ["AQUISICAO_FINANCIAMENTO", "Aquisição"],
  "carreta.percentual_entrada": ["AQUISICAO_FINANCIAMENTO", "Aquisição"],
  "cavalo.percentual_entrada": ["AQUISICAO_FINANCIAMENTO", "Aquisição"],
  "carreta.mes_de_entrada": ["AQUISICAO_FINANCIAMENTO", "Aquisição"],
  "cavalo.mes_de_entrada": ["AQUISICAO_FINANCIAMENTO", "Aquisição"],
  "carreta.data": ["AQUISICAO_FINANCIAMENTO", "Aquisição"],
  "cavalo.data": ["AQUISICAO_FINANCIAMENTO", "Aquisição"],

  "carreta.spread_bndes": ["AQUISICAO_FINANCIAMENTO", "Financiamento"],
  "cavalo.spread_bndes": ["AQUISICAO_FINANCIAMENTO", "Financiamento"],
  "carreta.spread_banco": ["AQUISICAO_FINANCIAMENTO", "Financiamento"],
  "cavalo.spread_banco": ["AQUISICAO_FINANCIAMENTO", "Financiamento"],
  "carreta.tjlp": ["AQUISICAO_FINANCIAMENTO", "Financiamento"],
  "cavalo.tjlp": ["AQUISICAO_FINANCIAMENTO", "Financiamento"],
  "carreta.taxa_finame": ["AQUISICAO_FINANCIAMENTO", "Financiamento"],
  "cavalo.taxa_finame": ["AQUISICAO_FINANCIAMENTO", "Financiamento"],
  "carreta.periodo_finame": ["AQUISICAO_FINANCIAMENTO", "Financiamento"],
  "cavalo.periodo_finame": ["AQUISICAO_FINANCIAMENTO", "Financiamento"],
  "carreta.carencia": ["AQUISICAO_FINANCIAMENTO", "Financiamento"],
  "cavalo.carencia": ["AQUISICAO_FINANCIAMENTO", "Financiamento"],
  "carreta.status_financiamento": ["AQUISICAO_FINANCIAMENTO", "Financiamento"],
  "carreta.status_financiamento_t1_shared": ["AQUISICAO_FINANCIAMENTO", "Financiamento"],
  "cavalo.status_financiamento_t1_shared": ["AQUISICAO_FINANCIAMENTO", "Financiamento"],
  "carreta.finame": ["AQUISICAO_FINANCIAMENTO", "Financiamento"],
  "carreta.finame_implemento": ["AQUISICAO_FINANCIAMENTO", "Financiamento"],
  "carreta.juros_finame_implemento": ["AQUISICAO_FINANCIAMENTO", "Financiamento"],
  "cavalo.finame_cavalo": ["AQUISICAO_FINANCIAMENTO", "Financiamento"],
  "cavalo.juros_finame_cavalo": ["AQUISICAO_FINANCIAMENTO", "Financiamento"],

  "carreta.amortizacao_implemento": ["AQUISICAO_FINANCIAMENTO", "Depreciação"],
  "cavalo.amortizacao_cavalo": ["AQUISICAO_FINANCIAMENTO", "Depreciação"],

  // ---- TRIBUTOS E SEGUROS --------------------------------------------------
  "cavalo.ipva_licenciamento": ["TRIBUTOS_SEGUROS", "IPVA e licenciamento"],
  "carreta.ipva_licenciamento": ["TRIBUTOS_SEGUROS", "IPVA e licenciamento"],
  "carreta.ipva_licenciamento_mensal": ["TRIBUTOS_SEGUROS", "IPVA e licenciamento"],
  "carreta.seguro": ["TRIBUTOS_SEGUROS", "Seguro"],
  "carreta.icms": ["TRIBUTOS_SEGUROS", "Tributos sobre a aquisição"],
  "carreta.percentual_icms": ["TRIBUTOS_SEGUROS", "Tributos sobre a aquisição"],
  "cavalo.percentual_icms": ["TRIBUTOS_SEGUROS", "Tributos sobre a aquisição"],
  "carreta.valor_icms": ["TRIBUTOS_SEGUROS", "Tributos sobre a aquisição"],
  "cavalo.valor_icms": ["TRIBUTOS_SEGUROS", "Tributos sobre a aquisição"],
  "carreta.pis_cofins": ["TRIBUTOS_SEGUROS", "Tributos sobre a aquisição"],
  "carreta.valor_pis_cofins": ["TRIBUTOS_SEGUROS", "Tributos sobre a aquisição"],
  "cavalo.valor_pis_cofins": ["TRIBUTOS_SEGUROS", "Tributos sobre a aquisição"],

  // ---- CONTRATO E CICLO ----------------------------------------------------
  "carreta.data_fim_contrato": ["CONTRATO_CICLO", "Contrato"],
  "cavalo.data_fim_contrato": ["CONTRATO_CICLO", "Contrato"],
  "carreta.ciclo": ["CONTRATO_CICLO", "Contrato"],
  "cavalo.ciclo": ["CONTRATO_CICLO", "Contrato"],

  // ---- CONTEXTO ------------------------------------------------------------
  "carreta.unidade_cnpj": ["CONTEXTO", "Escopo e identificação"],
  "cavalo.unidade_cnpj": ["CONTEXTO", "Escopo e identificação"],
  "carreta.unidade_nome": ["CONTEXTO", "Escopo e identificação"],
  "cavalo.unidade_nome": ["CONTEXTO", "Escopo e identificação"],
  "carreta.unidade_sap": ["CONTEXTO", "Escopo e identificação"],
  "cavalo.unidade_sap": ["CONTEXTO", "Escopo e identificação"],
  "carreta.unidade_tms": ["CONTEXTO", "Escopo e identificação"],
  "cavalo.unidade_tms": ["CONTEXTO", "Escopo e identificação"],
  "carreta.unidade_promax_unb": ["CONTEXTO", "Escopo e identificação"],
  "cavalo.unidade_promax_unb": ["CONTEXTO", "Escopo e identificação"],
  "carreta.unidade_regional": ["CONTEXTO", "Escopo e identificação"],
  "cavalo.unidade_regional": ["CONTEXTO", "Escopo e identificação"],
  "carreta.operador_cnpj": ["CONTEXTO", "Escopo e identificação"],
  "cavalo.operador_cnpj": ["CONTEXTO", "Escopo e identificação"],
  "carreta.operador_nome": ["CONTEXTO", "Escopo e identificação"],
  "cavalo.operador_nome": ["CONTEXTO", "Escopo e identificação"],
  "carreta.operador_sap": ["CONTEXTO", "Escopo e identificação"],
  "cavalo.operador_sap": ["CONTEXTO", "Escopo e identificação"],
  "carreta.operador_tms": ["CONTEXTO", "Escopo e identificação"],
  "cavalo.operador_tms": ["CONTEXTO", "Escopo e identificação"],
  "carreta.operador_promax": ["CONTEXTO", "Escopo e identificação"],
  "cavalo.operador_promax": ["CONTEXTO", "Escopo e identificação"],
  "carreta.id": ["CONTEXTO", "Escopo e identificação"],
  "cavalo.id": ["CONTEXTO", "Escopo e identificação"],
};

/**
 * Parâmetros cuja composição ainda depende de uma resposta do cliente.
 *
 * A tela mostra o aviso ao lado do nome. É diferente de "não sabemos o que a
 * coluna significa" — isso é a curadoria; aqui a dúvida é só sobre em que
 * gaveta do Freightech ela mora.
 */
export const PENDING_PARAMETERS: Record<string, string> = {
  "FROTA|Manutenção carroceria":
    "Revestimento, faixa reflexiva, tacógrafo e rastreador foram colocados aqui por " +
    "serem itens de carroceria com valor em reais. Falta o cliente confirmar se é " +
    "assim que o Freightech os agrupa.",
  "MODELOS_REMUNERACAO|Remuneração variável":
    "O Freightech separa “Antigo” de “Novo”. Nenhuma coluna deste export diz qual é " +
    "qual, então os quatro atributos ficam juntos até alguém responder.",
  "TRIBUTOS_SEGUROS|IPVA e licenciamento":
    "No Freightech o IPVA pode aparecer sob Frota → Manutenção Cavalo. Aqui ele está " +
    "em Tributos porque o dado diz que é 1% do valor da nota, e não um serviço de " +
    "manutenção — somá-lo à manutenção misturaria reais com R$/km e meses.",
};

/**
 * O que o Freightech publica e este export não traz.
 *
 * Existe para a nota de rodapé da tela. **Não vira cartão**: uma família sem
 * nenhum atributo é uma promessa que o produto não pode cumprir, e 25 delas
 * seriam 25 promessas.
 */
export const FREIGHTECH_SEM_DADO: { family: string; parameters: string[] }[] = [
  {
    family: "Equipe",
    parameters: [
      "Benefícios Equipe Entrega",
      "Benefícios Equipe Noturna",
      "Benefícios Remunerado",
      "Encargos e Provisões sem Férias",
      "Encargos e Provisões com Férias",
      "Equipe Noturna",
      "Equipe de Entrega",
      "FAD",
      "FAD - Despesa Fixa",
      "Parâmetros Equipe Entrega",
      "QLP ADM",
    ],
  },
  {
    family: "Uniformes e EPIs",
    parameters: [
      "Cadastros EPI",
      "Uniformes EPIs (Remuneração)",
      "Uniformes e EPI Homologados",
      "Uniformes e EPIs Geral",
      "Valor Uniformes e EPIs sem ICMS",
    ],
  },
  { family: "Despesas", parameters: ["Despesas Operacionais"] },
  {
    family: "Remuneração",
    parameters: ["Faturamento", "Recarga", "Resumo - SRTRANS", "Resumo Rota"],
  },
  { family: "Geral", parameters: ["Cadastro Índice de Reajuste"] },
  { family: "Frota", parameters: ["KM Pneu"] },
  { family: "Parâmetros Gerais", parameters: ["Fator Consumo", "Fator Desgaste Piso"] },
];

export interface FamilyPlacement {
  family: FamilyCode;
  familyName: string;
  parameter: string;
  /** Chave estável do parâmetro, para agrupar e para a URL. */
  parameterKey: string;
  /** Aviso quando a colocação ainda depende de resposta do cliente. */
  pending: string | null;
}

/**
 * Onde um atributo aparece. Nunca devolve nulo: o que o mapa não conhece cai em
 * `SEM_FAMILIA`, com o próprio código como parâmetro, para ficar visível.
 */
export function placementOf(attributeCode: string | null): FamilyPlacement {
  const entry = attributeCode === null ? undefined : MAP[attributeCode];
  const [family, parameter] = entry ?? ["SEM_FAMILIA" as FamilyCode, attributeCode ?? "(sem atributo)"];
  const parameterKey = `${family}|${parameter}`;
  return {
    family,
    familyName: FAMILIES[family].name,
    parameter,
    parameterKey,
    pending: PENDING_PARAMETERS[parameterKey] ?? null,
  };
}

/** Os códigos que o mapa conhece. Usado pelos testes de cobertura. */
export function mappedAttributeCodes(): string[] {
  return Object.keys(MAP);
}
