/**
 * A AUDITORIA DE PNEU — o que a carcaça custa por quilômetro, e as duas contas
 * que o próprio acervo permite fechar sobre ela.
 *
 * ---------------------------------------------------------------------------
 * Por que ela saiu de dentro da Manutenção
 * ---------------------------------------------------------------------------
 * Até aqui, pneu era **uma linha** da Auditoria de Manutenção — e uma linha
 * zerada. `cavalo.valor_pneu` e `carreta.valor_pneus` são zero em 100% das
 * linhas dos dois equipamentos, e `pneu_medida_empurrada` é a mesma medida para
 * a frota inteira. Com essas três colunas, pneu não dava tela: dava uma ressalva
 * no rodapé da manutenção.
 *
 * O que essa leitura não via é que **o pneu do acervo não está no equipamento —
 * está no trecho**. A tabela de frete declara sete colunas de pneu por percurso:
 * quantos pneus o conjunto leva, quanto custa cada um novo, quanto custa a
 * recapagem, quanto a carcaça é revendida, quantos quilômetros ela dura, quantos
 * ela dura depois de ajustada, e o R$/km que sai disso tudo. Nenhuma delas
 * aparecia em tela nenhuma deste produto.
 *
 * São dois grãos e dois assuntos, e por isso são duas telas. A Manutenção é do
 * **cavalo** — o contrato de manutenção é de um caminhão. O pneu é do
 * **trecho** — o desgaste é provocado pelo percurso, e é o percurso que declara
 * a vida útil ajustada. Mantê-los juntos obrigava uma tela a ter dois grãos, e
 * fazia a rubrica com dado real viajar de carona na ressalva da rubrica sem
 * dado.
 *
 * ---------------------------------------------------------------------------
 * As três colunas de equipamento continuam existindo, e continuam vazias
 * ---------------------------------------------------------------------------
 * Elas não desapareceram no caminho: estão em {@link COLUNAS_DE_EQUIPAMENTO_DE_PNEU},
 * declaradas com o que se mediu sobre cada uma, e a tela as publica como aviso
 * em vez de as pôr na tabela. Não entram na comparação porque são de outro grão
 * — uma tabela por trecho com três linhas por placa no meio não é uma tabela, é
 * duas coladas —, e não somem porque o achado é justamente que elas existem: quem
 * for procurar pneu no `Modelo_Cavalo` vai encontrá-las lá, zeradas, e precisa
 * saber por que este produto não as usa.
 *
 * ---------------------------------------------------------------------------
 * As duas conferências, e o que elas não afirmam
 * ---------------------------------------------------------------------------
 * 1. **O R$/km de pneu do preço tem de ser o custo de pneus e câmaras.**
 *    `trecho.frete_reais_km_pneu` é a parcela que entra no preço do frete;
 *    `trecho.pneu_custo_pneus_camaras_reais_km` é o custo que o modelo calculou.
 *    São duas colunas independentes que descrevem o mesmo dinheiro, e quando
 *    divergem o preço daquele trecho carrega um pneu diferente do que o modelo
 *    apurou. A direção importa e sai contada à parte: preço **abaixo** do custo é
 *    desgaste que ninguém está cobrando.
 *
 * 2. **R$/viagem ÷ R$/km tem de dar o km do ciclo.** É a mesma identidade que o
 *    dicionário da tabela de frete publica e que a Auditoria de Km Rodado já
 *    confere sobre as nove parcelas — aqui sobre a de pneu, que é a que esta
 *    tela responde.
 *
 * E há uma terceira leitura que **não é veredito nenhum**, e está marcada como
 * tal em todo lugar em que aparece: a reconstituição do R$/km a partir dos cinco
 * componentes do pneu (ver {@link reconstituicaoDoPneu}). Ela supõe uma
 * recapagem por carcaça, e o acervo não declara quantas são. Por isso ela informa
 * e nunca julga.
 *
 * **Nada aqui vira reais do período.** R$/km é razão — a mesma recusa de
 * `km-rodado.ts` e de `manutencao.ts` —, e o quilômetro realizado por quinzena
 * continua não existindo neste acervo.
 */

import {
  chaveDoVeiculo,
  ehEntradaOuSaidaDoGrao,
  estadoDaAlteracao,
  GRAVIDADE,
  numero,
  ROTULO_DO_ESTADO,
  type AlteracaoDoMotor,
  type EstadoDaLinha,
  type MedidaDaVariavel,
} from "./recorte-de-rubrica";

export {
  estadoDaAlteracao,
  ROTULO_DO_ESTADO,
  type AlteracaoDoMotor,
  type MedidaDaVariavel,
};

/** Os seis estados de uma linha de pneu. O mesmo tipo dos demais recortes. */
export type EstadoDaLinhaDePneu = EstadoDaLinha;

/** O tipo de entidade desta rubrica. Um só, e é o que a separa da Manutenção. */
export const TIPO_DO_PNEU = "TRECHO";

// ---------------------------------------------------------------------------
// As três colunas de equipamento — o que ficou para trás, e por quê
// ---------------------------------------------------------------------------

/** Uma coluna de pneu que o equipamento declara e que esta tela não compara. */
export interface ColunaDeEquipamentoDePneu {
  code: string;
  rotulo: string;
  /** O grão dela — e a razão de ela não caber na tabela desta tela. */
  entityType: "CAVALO" | "CARRETA";
  /** O que se mediu sobre ela no acervo, por extenso. */
  achado: string;
}

/**
 * As três colunas de pneu que moram no equipamento, e o que cada uma é.
 *
 * Elas vinham da Auditoria de Manutenção, onde eram a única variável que a
 * carreta declarava. Ficam aqui, fora da tabela e dentro do aviso, porque são
 * de outro grão — e porque apagá-las faria este produto parecer não saber que
 * elas existem.
 */
export const COLUNAS_DE_EQUIPAMENTO_DE_PNEU: readonly ColunaDeEquipamentoDePneu[] = [
  {
    code: "cavalo.valor_pneu",
    rotulo: "Valor de pneus do cavalo",
    entityType: "CAVALO",
    achado:
      "Zero nas 558 linhas de cavalo do acervo, em todas as vigências. É coluna sem " +
      "dado, não pneu de graça: ela existe, é declarada, e o dinheiro correspondente " +
      "nunca foi preenchido.",
  },
  {
    code: "carreta.valor_pneus",
    rotulo: "Valor de pneus do implemento",
    entityType: "CARRETA",
    achado:
      "Zero nas 657 linhas de carreta, pelo mesmo motivo. Era a única variável de pneu " +
      "que a carreta declarava na Auditoria de Manutenção — e a que não tinha valor.",
  },
  {
    code: "cavalo.pneu_medida_empurrada",
    rotulo: "Medida do pneu",
    entityType: "CAVALO",
    achado:
      "295/80R22,5 na frota inteira, nos dois equipamentos. É a única coluna de pneu do " +
      "equipamento que o acervo preenche — e, por ser a mesma para todos, ela não " +
      "distingue placa nenhuma de outra.",
  },
] as const;

// ---------------------------------------------------------------------------
// O catálogo das variáveis
// ---------------------------------------------------------------------------

/**
 * O que a coluna é dentro da conta do pneu.
 *
 * A distinção é a mesma de `km-rodado.ts`, com um papel que só esta rubrica tem:
 * `UNITARIO`. Um pneu novo custa reais **por pneu**, e a recapagem e a carcaça
 * também — somá-los ao R$/km, ou entre si sem a quantidade, dá um número que não
 * é de nada. Eles viram custo por quilômetro pela vida útil, e é a
 * reconstituição que faz essa conta, com a suposição dela escrita ao lado.
 *
 * - `RAZAO` — R$/km. Vira dinheiro multiplicada por uma quilometragem.
 * - `POR_VIAGEM` — reais por ciclo. É a `RAZAO` já multiplicada pelo km.
 * - `UNITARIO` — reais por pneu ou por carcaça. Nunca soma com `RAZAO`.
 * - `QUANTIDADE` — quantos pneus o conjunto leva.
 * - `VIDA` — quilômetros de vida útil. É o denominador da conta do pneu.
 * - `CONTEXTO` — origem, destino e o km do ciclo, que situam sem medir pneu.
 */
export type PapelDaColunaDePneu =
  | "RAZAO"
  | "POR_VIAGEM"
  | "UNITARIO"
  | "QUANTIDADE"
  | "VIDA"
  | "CONTEXTO";

/** Uma variável de pneu, com o código único que o trecho usa. */
export interface VariavelDePneu {
  /** A chave estável desta variável na tela e na API. Nunca muda de sentido. */
  chave: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  papel: PapelDaColunaDePneu;
  /** O código do atributo. Um só: `TRECHO` é o único tipo que o declara. */
  codigo: string;
  /**
   * Receita, e não custo — só o valor de venda da carcaça.
   *
   * Ele **abate** o custo do pneu em vez de somar a ele: a carcaça é vendida no
   * fim da vida útil, e o dinheiro volta. Somá-lo ao valor do pneu novo e ao da
   * recapagem inflaria o custo justamente pelo que o reduz.
   */
  abate?: boolean;
  /** Uma coluna que não entra em soma nenhuma, e a razão disso. */
  foraDaSoma?: string;
  /** Uma linha de contexto para o ⓘ da tela. */
  ajuda?: string;
}

/**
 * As variáveis do pneu, na ordem em que a tela as lê.
 *
 * Começa nos dois R$/km — o que o modelo apurou e o que o preço cobra, que são a
 * primeira conferência e a pergunta que traz alguém a esta tela —, segue pelos
 * componentes que os explicam (quantos pneus, quanto cada um, quanto a
 * recapagem, quanto a carcaça devolve) e termina nas duas vidas úteis, que são o
 * denominador de tudo isso.
 */
export const VARIAVEIS_DE_PNEU: readonly VariavelDePneu[] = [
  {
    chave: "custo_reais_km",
    rotulo: "Custo de pneus e câmaras R$/km",
    medida: "REAIS_POR_KM",
    papel: "RAZAO",
    codigo: "trecho.pneu_custo_pneus_camaras_reais_km",
    ajuda:
      "O R$/km que o modelo apura para o pneu deste trecho, a partir da quantidade, do " +
      "valor do pneu, da recapagem, da carcaça e da vida útil ajustada. É contra ele que " +
      "a parcela do preço é conferida.",
  },
  {
    chave: "frete_reais_km",
    rotulo: "Pneu no preço do frete R$/km",
    medida: "REAIS_POR_KM",
    papel: "RAZAO",
    codigo: "trecho.frete_reais_km_pneu",
    ajuda:
      "A parcela de pneu que entra no preço do frete — a mesma que a Auditoria de Km " +
      "Rodado soma entre as nove do preço. Aqui ela é conferida contra o custo apurado: " +
      "quando o preço fica abaixo dele, há desgaste que ninguém está cobrando.",
  },
  {
    chave: "quantidade",
    rotulo: "Quantidade de pneus",
    medida: "QUANTIDADE",
    papel: "QUANTIDADE",
    codigo: "trecho.pneu_quantidade_de_pneus",
    ajuda:
      "Quantos pneus o conjunto leva neste trecho. É o multiplicador da conta do pneu — " +
      "e a razão de o valor unitário, sozinho, não dizer nada sobre o R$/km.",
  },
  {
    chave: "valor_medio_pneus",
    rotulo: "Valor médio do pneu novo",
    medida: "DINHEIRO",
    papel: "UNITARIO",
    codigo: "trecho.pneu_valor_medio_pneus",
    ajuda: "Reais por pneu, e não por quilômetro. Vira R$/km só dividido pela vida útil.",
  },
  {
    chave: "valor_medio_recapagem",
    rotulo: "Valor médio da recapagem",
    medida: "DINHEIRO",
    papel: "UNITARIO",
    codigo: "trecho.pneu_valor_medio_da_recapagem",
    ajuda:
      "Reais por recapagem. O acervo não declara **quantas** recapagens uma carcaça " +
      "recebe — é a suposição que a reconstituição do R$/km precisa fazer, e que ela diz " +
      "por extenso.",
  },
  {
    chave: "valor_venda_carcaca",
    rotulo: "Valor de venda da carcaça",
    medida: "DINHEIRO",
    papel: "UNITARIO",
    abate: true,
    ajuda:
      "O que a carcaça devolve no fim da vida útil. **Abate** o custo do pneu em vez de " +
      "somar a ele — é receita, e somá-la inflaria o custo justamente pelo que o reduz.",
    codigo: "trecho.pneu_valor_de_venda_da_carcaca",
  },
  {
    chave: "vida_util",
    rotulo: "Vida útil do pneu",
    medida: "DISTANCIA",
    papel: "VIDA",
    codigo: "trecho.pneu_vidautil_pneu",
    ajuda: "Os quilômetros que o modelo reconhece para a carcaça antes do ajuste do trecho.",
  },
  {
    chave: "vida_util_ajustada",
    rotulo: "Vida útil ajustada",
    medida: "DISTANCIA",
    papel: "VIDA",
    codigo: "trecho.vidautil_ajustada_pneu",
    ajuda:
      "A vida útil depois do ajuste que o trecho impõe — é ela, e não a nominal, que o " +
      "modelo usa como denominador do R$/km.",
  },
] as const;

/**
 * As variáveis que só o detalhe mostra.
 *
 * O R$/viagem, que é o mesmo dinheiro noutra forma e existe aqui para conferir o
 * km; o km do ciclo, que é o denominador dessa conferência e não é uma medida de
 * pneu; e a origem e o destino, que existem para que a gaveta seja legível — a
 * chave do trecho identifica, mas não se lê.
 */
export const VARIAVEIS_DE_DETALHE_DE_PNEU: readonly VariavelDePneu[] = [
  {
    chave: "frete_reais_viagem",
    rotulo: "Pneu no preço do frete R$/viagem",
    medida: "DINHEIRO",
    papel: "POR_VIAGEM",
    codigo: "trecho.frete_reais_viagem_pneus",
    foraDaSoma:
      "É o R$/km de pneu multiplicado pelo km do ciclo — o dicionário da tabela de frete " +
      "avisa que somar as duas formas conta o mesmo dinheiro duas vezes. Ela aparece aqui " +
      "para conferir o km, nunca para somar.",
  },
  {
    chave: "km_ciclo",
    rotulo: "Km do ciclo",
    medida: "DISTANCIA",
    papel: "CONTEXTO",
    codigo: "trecho.km_rodado",
    ajuda:
      "Ida mais volta. Não é uma medida de pneu: está aqui porque é o denominador da " +
      "conferência — R$/viagem ÷ R$/km tem de devolver este número.",
  },
  {
    chave: "origem",
    rotulo: "Origem",
    medida: "TEXTO",
    papel: "CONTEXTO",
    codigo: "trecho.origem",
  },
  {
    chave: "destino",
    rotulo: "Destino",
    medida: "TEXTO",
    papel: "CONTEXTO",
    codigo: "trecho.destino",
  },
] as const;

const TODAS = [...VARIAVEIS_DE_PNEU, ...VARIAVEIS_DE_DETALHE_DE_PNEU];

/** Os códigos de atributo de um conjunto de variáveis. Sem repetição, ordenados. */
export function codigosDePneu(variaveis: readonly VariavelDePneu[]): string[] {
  return [...new Set(variaveis.map((v) => v.codigo))].sort();
}

/** O recorte que a tabela pede ao motor. */
export const CODIGOS_DA_TABELA_DE_PNEU = codigosDePneu(VARIAVEIS_DE_PNEU);

/** O recorte do detalhe: tudo, inclusive o que não soma. */
export const CODIGOS_DO_DETALHE_DE_PNEU = codigosDePneu(TODAS);

const POR_CODIGO = new Map(TODAS.map((v) => [v.codigo, v]));

/** A variável a que um código de atributo pertence, ou `undefined`. */
export function variavelDePneuDoCodigo(code: string | null): VariavelDePneu | undefined {
  return code === null ? undefined : POR_CODIGO.get(code);
}

// ---------------------------------------------------------------------------
// A linha da tabela
// ---------------------------------------------------------------------------

/** Uma linha da tabela: um trecho, uma variável, os dois lados. */
export interface LinhaDePneu {
  /** O `change.id`, quando a linha veio do motor. Ausente nas linhas iguais. */
  id: number | null;
  /** A chave do trecho, como o motor a gravou. Identifica, mas não se lê. */
  entityLabel: string | null;
  entityType: string;
  variavel: string;
  rotuloDaVariavel: string;
  medida: MedidaDaVariavel;
  papel: PapelDaColunaDePneu;
  attributeCode: string | null;
  /** O texto do valor na vigência base. Nulo quando não havia. */
  base: string | null;
  /** O texto do valor na vigência comparada. Nulo quando não há. */
  comparada: string | null;
  /** `comparada − base`. Nula sempre que o motor não a produziu. */
  diferenca: number | null;
  /** A variação em **pontos percentuais**. Nula quando a base é zero. */
  variacao: number | null;
  estado: EstadoDaLinhaDePneu;
  /** A frase da recusa, quando há. Vem do motor, não é escrita aqui. */
  motivo: string | null;
  impactoAmount: number | null;
  impactoPeriodicidade: string | null;
  impactoCalculado: boolean;
  /** O aviso da coluna que não soma, quando esta linha é de uma delas. */
  foraDaSoma: string | null;
}

/**
 * Uma alteração do motor virando linha da tabela.
 *
 * Devolve `null` para o que não é de pneu — a função é o filtro e o tradutor ao
 * mesmo tempo, de modo que nenhuma tela precise saber quais são os códigos.
 */
export function linhaDePneuDaAlteracao(a: AlteracaoDoMotor): LinhaDePneu | null {
  const variavel = variavelDePneuDoCodigo(a.attributeCode);
  /*
    Entrada e saída não citam atributo: o motor as grava uma vez por entidade. Num
    recorte de trecho isso é frequente — um trecho entra e sai da tabela conforme
    a malha muda —, e some da tela se a tradução exigir código de atributo.
  */
  if (!variavel) {
    if (!ehEntradaOuSaidaDoGrao(a, [TIPO_DO_PNEU])) return null;
    return {
      id: a.id ?? null,
      entityLabel: a.entityLabel,
      entityType: a.entityType ?? "",
      variavel: "trecho",
      rotuloDaVariavel: "Trecho na tabela",
      medida: "TEXTO",
      papel: "CONTEXTO",
      attributeCode: null,
      base: a.valueBefore,
      comparada: a.valueAfter,
      diferenca: null,
      variacao: null,
      estado: estadoDaAlteracao(a),
      motivo: a.inconclusiveReason ?? null,
      impactoAmount: null,
      impactoPeriodicidade: null,
      impactoCalculado: false,
      foraDaSoma: null,
    };
  }

  return {
    id: a.id ?? null,
    entityLabel: a.entityLabel,
    entityType: a.entityType ?? "",
    variavel: variavel.chave,
    rotuloDaVariavel: variavel.rotulo,
    medida: variavel.medida,
    papel: variavel.papel,
    attributeCode: a.attributeCode,
    base: a.valueBefore,
    comparada: a.valueAfter,
    diferenca: numero(a.deltaAbsolute),
    variacao: numero(a.deltaPercent),
    estado: estadoDaAlteracao(a),
    motivo: a.inconclusiveReason ?? null,
    impactoAmount: numero(a.impactAmount),
    impactoPeriodicidade: a.impactPeriodicity ?? null,
    impactoCalculado: a.impactConfidence === "CALCULATED",
    foraDaSoma: variavel.foraDaSoma ?? null,
  };
}

/** As linhas de pneu de uma lista de alterações, na ordem em que vieram. */
export function linhasDePneu(alteracoes: readonly AlteracaoDoMotor[]): LinhaDePneu[] {
  const linhas: LinhaDePneu[] = [];
  for (const a of alteracoes) {
    const linha = linhaDePneuDaAlteracao(a);
    if (linha) linhas.push(linha);
  }
  return linhas;
}

/**
 * Um par de valores iguais virando linha — o alternador "sem alteração".
 *
 * Estas linhas **não vêm do motor**: o `change_set` só guarda o que mudou. Elas
 * são montadas a partir das duas leituras de `getEntityTable`, uma por vigência,
 * e por isso carregam `id: null`.
 */
export function linhaDePneuSemAlteracao(par: {
  entityLabel: string | null;
  entityType: string;
  attributeCode: string;
  valor: string | null;
}): LinhaDePneu | null {
  const variavel = variavelDePneuDoCodigo(par.attributeCode);
  if (!variavel) return null;
  return {
    id: null,
    entityLabel: par.entityLabel,
    entityType: par.entityType,
    variavel: variavel.chave,
    rotuloDaVariavel: variavel.rotulo,
    medida: variavel.medida,
    papel: variavel.papel,
    attributeCode: par.attributeCode,
    base: par.valor,
    comparada: par.valor,
    diferenca: null,
    variacao: null,
    estado: "SEM_ALTERACAO",
    motivo: null,
    impactoAmount: null,
    impactoPeriodicidade: null,
    impactoCalculado: false,
    foraDaSoma: variavel.foraDaSoma ?? null,
  };
}

// ---------------------------------------------------------------------------
// O impacto — aqui, como em Km Rodado, quase todo recusa
// ---------------------------------------------------------------------------

/** O que o recorte moveu, separado pelo que cada coluna é. */
export interface ImpactoDePneu {
  /**
   * Um número por periodicidade, **nunca um total único** — e quase sempre
   * vazio.
   *
   * Vazio não é defeito: nenhuma coluna desta tela é dinheiro do período. R$/km
   * é razão, R$/viagem é o mesmo dinheiro noutra forma, o valor do pneu é reais
   * por pneu e a vida útil é distância. O que ficaria aqui é só o que o motor
   * tiver precificado com semântica confirmada.
   */
  porPeriodicidade: Record<string, number>;
  /** Alterações monetárias que o motor não soube precificar, com motivo próprio. */
  naoCalculavel: number;
  /** Linhas retiradas do total por não haver o que somar nelas com segurança. */
  foraDaSoma: number;
  /**
   * Parcelas de R$/km que se moveram — o indicador acionável desta tela.
   *
   * Contá-las à parte é o que impede que "sem impacto precificável" seja lido
   * como "nada mudou no pneu".
   */
  razoesAlteradas: number;
  /** Vidas úteis que se moveram — o denominador da conta mudando de lugar. */
  vidasAlteradas: number;
  /** Valores unitários que se moveram: pneu novo, recapagem, carcaça. */
  unitariosAlterados: number;
}

/**
 * O impacto do recorte de pneu, e as três coisas que ele se recusa a fazer.
 *
 * **Não multiplica razão por quilometragem inventada** — a mesma recusa de
 * `km-rodado.ts`, e pela mesma razão: o realizado não existe neste acervo.
 *
 * **Não soma R$/km com R$/viagem**, que é o mesmo dinheiro em duas formas.
 *
 * **Não soma valor unitário com R$/km.** Reais por pneu e reais por quilômetro
 * são grandezas diferentes; a ponte entre elas é a vida útil, e quem a atravessa
 * é a reconstituição, com a suposição dela declarada.
 */
export function impactoDePneu(linhas: readonly LinhaDePneu[]): ImpactoDePneu {
  const porPeriodicidade: Record<string, number> = {};
  let naoCalculavel = 0;
  let foraDaSoma = 0;
  let razoesAlteradas = 0;
  let vidasAlteradas = 0;
  let unitariosAlterados = 0;

  for (const l of linhas) {
    if (l.estado !== "ALTERADO") continue;

    if (l.papel === "RAZAO") {
      razoesAlteradas++;
      continue;
    }
    if (l.papel === "VIDA") {
      vidasAlteradas++;
      continue;
    }
    if (l.papel === "QUANTIDADE" || l.papel === "CONTEXTO") continue;

    if (l.foraDaSoma) {
      foraDaSoma++;
      continue;
    }
    if (l.papel === "UNITARIO") {
      unitariosAlterados++;
      continue;
    }
    if (!l.impactoCalculado || l.impactoAmount === null) {
      if (l.medida === "DINHEIRO") naoCalculavel++;
      continue;
    }

    const balde = l.impactoPeriodicidade ?? "SEM_PERIODICIDADE";
    porPeriodicidade[balde] = (porPeriodicidade[balde] ?? 0) + l.impactoAmount;
  }

  for (const balde of Object.keys(porPeriodicidade)) {
    porPeriodicidade[balde] = Number(porPeriodicidade[balde].toFixed(6));
  }
  return {
    porPeriodicidade,
    naoCalculavel,
    foraDaSoma,
    razoesAlteradas,
    vidasAlteradas,
    unitariosAlterados,
  };
}

// ---------------------------------------------------------------------------
// Os indicadores e as séries
// ---------------------------------------------------------------------------

/** Quantos trechos cada vigência entregou — vem da contagem do motor. */
export interface TrechosDoParDePneu {
  /** Trechos presentes nas duas vigências. */
  comparados: number;
  novos: number;
  ausentes: number;
}

export interface ResumoDePneu {
  trechosComparados: number;
  /** Comparados que não tiveram nenhuma variável de pneu alterada. */
  semAlteracao: number;
  trechosComAlteracao: number;
  novosNaVigencia: number;
  ausentesNaComparada: number;
  /** Quantas variáveis se moveram, somando todos os trechos. */
  variaveisAlteradas: number;
  trechosComDadoIncompleto: number;
  trechosComConflito: number;
  impacto: ImpactoDePneu;
}

/**
 * Os indicadores do topo, de uma passada só.
 *
 * `trechos` vem do motor porque **esta lista não sabe** quantos trechos não
 * mudaram: um trecho sem nenhuma alteração não produz linha nenhuma.
 */
export function resumirPneu(
  linhas: readonly LinhaDePneu[],
  trechos: TrechosDoParDePneu,
): ResumoDePneu {
  const comAlteracao = new Set<string>();
  const comIncompleto = new Set<string>();
  const comConflito = new Set<string>();
  let variaveisAlteradas = 0;

  for (const l of linhas) {
    if (l.variavel === "trecho") continue;
    switch (l.estado) {
      case "ALTERADO":
        variaveisAlteradas++;
        comAlteracao.add(chaveDoVeiculo(l));
        break;
      case "DADO_INCOMPLETO":
        comIncompleto.add(chaveDoVeiculo(l));
        break;
      case "CONFLITO":
        comConflito.add(chaveDoVeiculo(l));
        break;
      default:
        break;
    }
  }

  /* "Sem alteração" é o que **nenhuma** linha tocou — a mesma regra dos recortes
     anteriores, nascida do cartão que contava os mesmos 62 duas vezes. */
  const tocados = new Set([...comAlteracao, ...comIncompleto, ...comConflito]);
  return {
    trechosComparados: trechos.comparados,
    semAlteracao: Math.max(0, trechos.comparados - tocados.size),
    trechosComAlteracao: comAlteracao.size,
    novosNaVigencia: trechos.novos,
    ausentesNaComparada: trechos.ausentes,
    variaveisAlteradas,
    trechosComDadoIncompleto: comIncompleto.size,
    trechosComConflito: comConflito.size,
    impacto: impactoDePneu(linhas),
  };
}

/** Uma barra do gráfico "alterações por variável". */
export interface AlteracoesDaVariavelDePneu {
  variavel: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  papel: PapelDaColunaDePneu;
  alteracoes: number;
}

/** Quantas alterações cada variável teve, da maior para a menor. */
export function alteracoesPorVariavelDePneu(
  linhas: readonly LinhaDePneu[],
): AlteracoesDaVariavelDePneu[] {
  const contagem = new Map<string, number>();
  for (const l of linhas) {
    if (l.estado !== "ALTERADO" || l.variavel === "trecho") continue;
    contagem.set(l.variavel, (contagem.get(l.variavel) ?? 0) + 1);
  }
  return TODAS.filter((v) => contagem.has(v.chave))
    .map((v) => ({
      variavel: v.chave,
      rotulo: v.rotulo,
      medida: v.medida,
      papel: v.papel,
      alteracoes: contagem.get(v.chave)!,
    }))
    .sort((a, b) => b.alteracoes - a.alteracoes || a.rotulo.localeCompare(b.rotulo));
}

/** Uma fatia do gráfico de status. */
export interface FatiaDeEstadoDePneu {
  estado: EstadoDaLinhaDePneu;
  rotulo: string;
  trechos: number;
  /** A fração sobre o total de trechos do recorte. `0.852` para 85,2%. */
  fracao: number;
}

/**
 * Os trechos por estado — a rosca.
 *
 * Um trecho tem um estado só, e a ordem de gravidade (`GRAVIDADE`, no módulo
 * comum) decide qual. Sem essa regra a soma das fatias passaria do total.
 */
export function distribuicaoPorEstadoDePneu(
  linhas: readonly LinhaDePneu[],
  trechos: TrechosDoParDePneu,
): FatiaDeEstadoDePneu[] {
  const pior = new Map<string, EstadoDaLinhaDePneu>();
  for (const l of linhas) {
    const chave = chaveDoVeiculo(l);
    const atual = pior.get(chave);
    if (atual === undefined || GRAVIDADE.indexOf(l.estado) < GRAVIDADE.indexOf(atual)) {
      pior.set(chave, l.estado);
    }
  }

  const contagem = new Map<EstadoDaLinhaDePneu, number>();
  for (const estado of pior.values()) {
    contagem.set(estado, (contagem.get(estado) ?? 0) + 1);
  }
  const tocados = [...pior.keys()].filter(
    (k) => pior.get(k) !== "NOVO_NA_VIGENCIA" && pior.get(k) !== "AUSENTE_NA_COMPARADA",
  ).length;
  contagem.set("SEM_ALTERACAO", Math.max(0, trechos.comparados - tocados));
  contagem.set("NOVO_NA_VIGENCIA", trechos.novos);
  contagem.set("AUSENTE_NA_COMPARADA", trechos.ausentes);

  const total = trechos.comparados + trechos.novos + trechos.ausentes;
  return GRAVIDADE.filter((e) => (contagem.get(e) ?? 0) > 0)
    .map((estado) => ({
      estado,
      rotulo: ROTULO_DO_ESTADO[estado],
      trechos: contagem.get(estado)!,
      fracao: total === 0 ? 0 : contagem.get(estado)! / total,
    }))
    .sort((a, b) => b.trechos - a.trechos);
}

// ---------------------------------------------------------------------------
// O custo do pneu, a reconstituição e as duas conferências
// ---------------------------------------------------------------------------

/** Um trecho lido de uma das duas vigências, no recorte do pneu. */
export interface ValorDePneu {
  /** `BASE` ou `COMPARADA` — a ponta, não a data. A data é do contexto. */
  ponta: "BASE" | "COMPARADA";
  /** A chave do trecho. */
  entityLabel: string | null;
  origem: string | null;
  destino: string | null;
  /** O R$/km que o modelo apurou para o pneu. */
  custoReaisKm: number | null;
  /** O R$/km de pneu que entra no preço do frete. */
  freteReaisKm: number | null;
  /** O R$/viagem correspondente — o mesmo dinheiro noutra forma. */
  freteReaisViagem: number | null;
  quantidade: number | null;
  valorMedioPneus: number | null;
  valorMedioRecapagem: number | null;
  valorVendaCarcaca: number | null;
  vidaUtil: number | null;
  vidaUtilAjustada: number | null;
  kmCiclo: number | null;
}

/**
 * Meio centavo por quilômetro de folga entre o custo apurado e o preço cobrado.
 *
 * As duas colunas são R$/km escritos pela mesma fonte, e a única folga de que
 * elas precisam é a do arredondamento com que cada uma é publicada. Meio centavo
 * cobre duas casas decimais com sobra e continua acusando o que importa: a
 * parcela de pneu do frete é da ordem de centavos por quilômetro, e uma
 * divergência que signifique alguma coisa é várias vezes maior do que isso.
 */
export const TOLERANCIA_DO_PNEU_EM_REAIS_POR_KM = 0.005;

/**
 * Um por cento de folga entre o km implícito no preço e o km declarado.
 *
 * A mesma régua, e pela mesma razão, da conferência da Auditoria de Km Rodado: o
 * km implícito sai de uma divisão entre dois valores já arredondados, e um por
 * cento absorve esse arredondamento em qualquer distância sem deixar de acusar
 * um preço montado sobre outro quilômetro.
 */
export const TOLERANCIA_DO_PRECO_DE_PNEU = 0.01;

/**
 * O que a conferência de um trecho revelou.
 *
 * `PRECO_DIVERGE_DO_CUSTO` é a primeira conta, e é a que só esta tela faz: o
 * R$/km de pneu do preço e o custo de pneus e câmaras são duas colunas
 * independentes sobre o mesmo dinheiro, e quando discordam o preço daquele
 * trecho carrega um pneu diferente do que o modelo apurou.
 *
 * `PRECO_USA_OUTRO_KM` é a segunda, e é a identidade que o dicionário da tabela
 * de frete publica: `R$/viagem = R$/km × km do ciclo`. Dividindo de volta, o
 * quilômetro embutido aparece — e quando ele não é o declarado, a parcela de
 * pneu daquele trecho foi montada sobre outra distância.
 */
export type VereditoDoPneu =
  | "CONFERE"
  | "PRECO_DIVERGE_DO_CUSTO"
  | "PRECO_USA_OUTRO_KM"
  | "BASE_INSUFICIENTE";

export const ROTULO_DO_VEREDITO_DO_PNEU: Record<VereditoDoPneu, string> = {
  CONFERE: "As duas contas fecham",
  PRECO_DIVERGE_DO_CUSTO: "O preço não é o custo apurado",
  PRECO_USA_OUTRO_KM: "O preço foi montado sobre outro km",
  BASE_INSUFICIENTE: "Base insuficiente",
};

/** A conferência das duas contas, para um trecho numa ponta. */
export interface ConferenciaDoTrechoDePneu {
  custoReaisKm: number | null;
  freteReaisKm: number | null;
  /** `frete − custo`, em R$/km. Negativo é preço abaixo do custo apurado. */
  diferencaDoPreco: number | null;
  /** O km que o R$/viagem de pneu embute, quando as duas formas vieram. */
  kmImplicito: number | null;
  kmDeclarado: number | null;
  /** Verdadeiro quando o preço cobre menos pneu do que o modelo apurou. */
  abaixoDoCusto: boolean;
  veredito: VereditoDoPneu;
}

/**
 * As duas contas do pneu, para um trecho.
 *
 * ---------------------------------------------------------------------------
 * A ordem dos testes é o que os torna verdadeiros
 * ---------------------------------------------------------------------------
 * 1. **Sem nenhum dos dois R$/km** → `BASE_INSUFICIENTE`. Sem uma das pontas não
 *    há o que conferir, e afirmar qualquer coisa seria afirmar sobre nada.
 * 2. **Preço ≠ custo apurado** → `PRECO_DIVERGE_DO_CUSTO`, e decide antes do km:
 *    é a divergência sobre o **dinheiro**, e ela vale qualquer que seja a
 *    distância sobre a qual o preço foi montado.
 * 3. **O R$/viagem embute outro km** → `PRECO_USA_OUTRO_KM`.
 * 4. Caso contrário, `CONFERE`.
 */
export function conferenciaDoTrechoDePneu(valor: ValorDePneu): ConferenciaDoTrechoDePneu {
  const { custoReaisKm, freteReaisKm, kmCiclo } = valor;

  const diferencaDoPreco =
    custoReaisKm === null || freteReaisKm === null
      ? null
      : Number((freteReaisKm - custoReaisKm).toFixed(6));

  /*
    Zero de um lado não confere km nenhum: um trecho que não cobra pneu (R$ 0,00
    por km, R$ 0,00 por viagem) é coerente com qualquer distância, e dividir zero
    por zero não produz quilometragem.
  */
  const kmImplicito =
    freteReaisKm === null ||
    freteReaisKm === 0 ||
    valor.freteReaisViagem === null ||
    valor.freteReaisViagem === 0
      ? null
      : Number((valor.freteReaisViagem / freteReaisKm).toFixed(4));

  const semBase = custoReaisKm === null || freteReaisKm === null;
  const divergeDoCusto =
    diferencaDoPreco !== null &&
    Math.abs(diferencaDoPreco) > TOLERANCIA_DO_PNEU_EM_REAIS_POR_KM;
  const usaOutroKm =
    kmCiclo !== null &&
    kmCiclo !== 0 &&
    kmImplicito !== null &&
    Math.abs(kmImplicito - kmCiclo) / kmCiclo > TOLERANCIA_DO_PRECO_DE_PNEU;

  const veredito: VereditoDoPneu = semBase
    ? "BASE_INSUFICIENTE"
    : divergeDoCusto
      ? "PRECO_DIVERGE_DO_CUSTO"
      : usaOutroKm
        ? "PRECO_USA_OUTRO_KM"
        : "CONFERE";

  return {
    custoReaisKm,
    freteReaisKm,
    diferencaDoPreco,
    kmImplicito,
    kmDeclarado: kmCiclo,
    abaixoDoCusto: divergeDoCusto && (diferencaDoPreco ?? 0) < 0,
    veredito,
  };
}

/** Um km de ciclo só serve de denominador quando existe e não é zero. */
function kmDeclaradoUtil(km: number | null): km is number {
  return km !== null && km !== 0;
}

/** A conferência de uma ponta inteira — quantos trechos caem em cada veredito. */
export interface ConferenciaDaVigenciaDePneu {
  ponta: "BASE" | "COMPARADA";
  trechos: number;
  confere: number;
  divergeDoCusto: number;
  /** Dos divergentes, quantos cobram **menos** pneu do que o custo apurado. */
  abaixoDoCusto: number;
  precoUsaOutroKm: number;
  baseInsuficiente: number;
  /** A maior distância entre o preço e o custo apurado, em R$/km. */
  maiorDivergenciaDoPreco: number | null;
  /** A maior distância entre o km implícito e o declarado, em km. */
  maiorDiferencaDoKm: number | null;
}

/**
 * A conferência de cada ponta, trecho a trecho.
 *
 * Nunca um veredito único da vigência: o que interessa é **quantos** trechos
 * caem em cada leitura, porque cinco trechos cobrando menos pneu do que custam
 * num universo de quatrocentos é uma fila de trabalho, e não um diagnóstico da
 * tabela inteira.
 */
export function conferenciaDoPneu(
  valores: readonly ValorDePneu[],
): ConferenciaDaVigenciaDePneu[] {
  const porPonta = new Map<"BASE" | "COMPARADA", ConferenciaDaVigenciaDePneu>();

  for (const v of valores) {
    const c = conferenciaDoTrechoDePneu(v);
    const atual =
      porPonta.get(v.ponta) ??
      ({
        ponta: v.ponta,
        trechos: 0,
        confere: 0,
        divergeDoCusto: 0,
        abaixoDoCusto: 0,
        precoUsaOutroKm: 0,
        baseInsuficiente: 0,
        maiorDivergenciaDoPreco: null,
        maiorDiferencaDoKm: null,
      } as ConferenciaDaVigenciaDePneu);

    atual.trechos += 1;
    if (c.veredito === "CONFERE") atual.confere += 1;
    if (c.veredito === "PRECO_DIVERGE_DO_CUSTO") atual.divergeDoCusto += 1;
    if (c.veredito === "PRECO_USA_OUTRO_KM") atual.precoUsaOutroKm += 1;
    if (c.veredito === "BASE_INSUFICIENTE") atual.baseInsuficiente += 1;
    if (c.abaixoDoCusto) atual.abaixoDoCusto += 1;

    if (c.diferencaDoPreco !== null) {
      const d = Math.abs(c.diferencaDoPreco);
      if (atual.maiorDivergenciaDoPreco === null || d > atual.maiorDivergenciaDoPreco) {
        atual.maiorDivergenciaDoPreco = Number(d.toFixed(6));
      }
    }
    if (c.kmImplicito !== null && kmDeclaradoUtil(c.kmDeclarado)) {
      const d = Math.abs(c.kmImplicito - c.kmDeclarado);
      if (atual.maiorDiferencaDoKm === null || d > atual.maiorDiferencaDoKm) {
        atual.maiorDiferencaDoKm = Number(d.toFixed(4));
      }
    }

    porPonta.set(v.ponta, atual);
  }

  return [...porPonta.values()].sort((a, b) => a.ponta.localeCompare(b.ponta));
}

// ---------------------------------------------------------------------------
// A reconstituição — informa, e nunca julga
// ---------------------------------------------------------------------------

/**
 * O R$/km que os cinco componentes do pneu montam — **sob uma suposição**.
 *
 * A conta é a do livro: o conjunto leva `quantidade` pneus; cada carcaça custa o
 * pneu novo mais a recapagem, menos o que ela devolve quando é vendida; e esse
 * custo se dilui pela vida útil ajustada.
 *
 *     R$/km = quantidade × (pneu novo + recapagem − carcaça) ÷ vida útil ajustada
 *
 * **A suposição é `recapagens = 1`, e o acervo não a confirma.** Nenhuma coluna
 * diz quantas vezes uma carcaça é recapada, e duas recapagens em vez de uma
 * mudam o resultado em dezenas de por cento. Por isso esta função **não produz
 * veredito nenhum** e nunca entra em {@link conferenciaDoTrechoDePneu}: ela põe
 * o número reconstituído ao lado do apurado, mostra a distância entre os dois, e
 * deixa a leitura para quem conhece o contrato.
 *
 * É a mesma postura que a Auditoria de Manutenção tem diante do R$/km resolvido
 * sem contrato: medir a diferença, dizer que ela existe, e não inventar a fórmula
 * que falta.
 */
export interface ReconstituicaoDoPneu {
  /** O R$/km montado pelos componentes, supondo uma recapagem por carcaça. */
  reconstituido: number | null;
  /** O R$/km que o modelo apurou — a coluna do acervo. */
  apurado: number | null;
  /** `reconstituido − apurado`, em R$/km. */
  diferenca: number | null;
  /** Quais dos cinco componentes faltaram. Vazio quando a conta pôde ser feita. */
  componentesAusentes: string[];
  /** Quantas recapagens a conta supôs. Hoje sempre 1 — e é o que ela declara. */
  recapagensSupostas: number;
}

/** Quantas recapagens a reconstituição supõe por carcaça. Uma, e declarada. */
export const RECAPAGENS_SUPOSTAS = 1;

/** A reconstituição do R$/km de um trecho, com o que faltou para fazê-la. */
export function reconstituicaoDoPneu(valor: ValorDePneu): ReconstituicaoDoPneu {
  const componentes: [string, number | null][] = [
    ["Quantidade de pneus", valor.quantidade],
    ["Valor médio do pneu novo", valor.valorMedioPneus],
    ["Valor médio da recapagem", valor.valorMedioRecapagem],
    ["Valor de venda da carcaça", valor.valorVendaCarcaca],
    ["Vida útil ajustada", valor.vidaUtilAjustada],
  ];
  const componentesAusentes = componentes
    .filter(([, v]) => v === null)
    .map(([nome]) => nome);

  const vida = valor.vidaUtilAjustada;
  const reconstituido =
    componentesAusentes.length > 0 || vida === null || vida === 0
      ? null
      : Number(
          (
            (valor.quantidade! *
              (valor.valorMedioPneus! +
                RECAPAGENS_SUPOSTAS * valor.valorMedioRecapagem! -
                valor.valorVendaCarcaca!)) /
            vida
          ).toFixed(6),
        );

  return {
    reconstituido,
    apurado: valor.custoReaisKm,
    diferenca:
      reconstituido === null || valor.custoReaisKm === null
        ? null
        : Number((reconstituido - valor.custoReaisKm).toFixed(6)),
    componentesAusentes,
    recapagensSupostas: RECAPAGENS_SUPOSTAS,
  };
}

/** A reconstituição de uma ponta inteira, resumida. */
export interface ReconstituicaoDaVigencia {
  ponta: "BASE" | "COMPARADA";
  /** Trechos em que os cinco componentes vieram e a conta pôde ser feita. */
  trechosReconstituidos: number;
  /** Trechos em que faltou ao menos um componente. */
  trechosIncompletos: number;
  /** A média simples do R$/km reconstituído, entre os trechos que a têm. */
  mediaReconstituida: number | null;
  /** A média simples do R$/km apurado, sobre os **mesmos** trechos. */
  mediaApurada: number | null;
  /** Quantos deles ficaram além da folga de meio centavo por quilômetro. */
  trechosDistantes: number;
}

/**
 * A reconstituição por ponta — média simples entre trechos, e só sobre os
 * trechos em que as duas contas existem.
 *
 * As duas médias saem da **mesma** população de propósito: comparar a média do
 * reconstituído sobre 200 trechos com a do apurado sobre 400 produziria uma
 * distância que não é de conta nenhuma, e sim da diferença entre as duas
 * amostras.
 */
export function reconstituicaoPorVigencia(
  valores: readonly ValorDePneu[],
): ReconstituicaoDaVigencia[] {
  const porPonta = new Map<
    "BASE" | "COMPARADA",
    { recon: number[]; apurado: number[]; incompletos: number; distantes: number }
  >();

  for (const v of valores) {
    const r = reconstituicaoDoPneu(v);
    const atual =
      porPonta.get(v.ponta) ?? { recon: [], apurado: [], incompletos: 0, distantes: 0 };
    if (r.reconstituido === null || r.apurado === null) {
      atual.incompletos += 1;
    } else {
      atual.recon.push(r.reconstituido);
      atual.apurado.push(r.apurado);
      if (Math.abs(r.diferenca ?? 0) > TOLERANCIA_DO_PNEU_EM_REAIS_POR_KM) {
        atual.distantes += 1;
      }
    }
    porPonta.set(v.ponta, atual);
  }

  const media = (xs: number[]) =>
    xs.length === 0 ? null : Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4));

  return [...porPonta.entries()]
    .map(([ponta, a]) => ({
      ponta,
      trechosReconstituidos: a.recon.length,
      trechosIncompletos: a.incompletos,
      mediaReconstituida: media(a.recon),
      mediaApurada: media(a.apurado),
      trechosDistantes: a.distantes,
    }))
    .sort((a, b) => a.ponta.localeCompare(b.ponta));
}

// ---------------------------------------------------------------------------
// O custo do pneu por vigência
// ---------------------------------------------------------------------------

/** O R$/km de pneu de uma ponta, lido sobre os trechos dela. */
export interface CustoDoPneuDaVigencia {
  ponta: "BASE" | "COMPARADA";
  /** Trechos com custo apurado. */
  trechos: number;
  /** Em R$/km — a média **simples entre trechos**. Ver o aviso abaixo. */
  custoMedio: number | null;
  custoMinimo: number | null;
  custoMaximo: number | null;
  /** A média simples da parcela de pneu do preço, sobre os trechos que a têm. */
  freteMedio: number | null;
  /** A vida útil ajustada média, em km. */
  vidaMedia: number | null;
  /** A quantidade média de pneus por conjunto. */
  quantidadeMedia: number | null;
}

/**
 * O R$/km de pneu de cada ponta — e a única forma honesta de agregá-lo.
 *
 * **É média simples entre trechos, e a tela diz isso.** O R$/km de pneu da
 * operação seria o dinheiro total de pneu dividido pela quilometragem total, e
 * nenhum dos dois existe no acervo. Ponderar pelo km do ciclo pesaria um trecho
 * de 900 km nove vezes mais do que um de 100 km **como se os dois rodassem o
 * mesmo número de viagens** — a suposição que esta tela recusa, pela mesma razão
 * que a Auditoria de Km Rodado a recusa.
 */
export function custoDoPneuPorVigencia(
  valores: readonly ValorDePneu[],
): CustoDoPneuDaVigencia[] {
  const porPonta = new Map<
    "BASE" | "COMPARADA",
    { custos: number[]; fretes: number[]; vidas: number[]; quantidades: number[] }
  >();

  for (const v of valores) {
    const atual =
      porPonta.get(v.ponta) ?? { custos: [], fretes: [], vidas: [], quantidades: [] };
    if (v.custoReaisKm !== null) atual.custos.push(v.custoReaisKm);
    if (v.freteReaisKm !== null) atual.fretes.push(v.freteReaisKm);
    if (v.vidaUtilAjustada !== null) atual.vidas.push(v.vidaUtilAjustada);
    if (v.quantidade !== null) atual.quantidades.push(v.quantidade);
    porPonta.set(v.ponta, atual);
  }

  const media = (xs: number[], casas = 4) =>
    xs.length === 0 ? null : Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(casas));

  return [...porPonta.entries()]
    .map(([ponta, a]) => ({
      ponta,
      trechos: a.custos.length,
      custoMedio: media(a.custos),
      custoMinimo: a.custos.length === 0 ? null : Number(Math.min(...a.custos).toFixed(4)),
      custoMaximo: a.custos.length === 0 ? null : Number(Math.max(...a.custos).toFixed(4)),
      freteMedio: media(a.fretes),
      vidaMedia: media(a.vidas, 1),
      quantidadeMedia: media(a.quantidades, 2),
    }))
    .sort((a, b) => a.ponta.localeCompare(b.ponta));
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

/** O cabeçalho do CSV — a ordem das colunas da tela. */
export const COLUNAS_DO_CSV_DE_PNEU = [
  "Trecho",
  "Variável",
  "Unidade",
  "De",
  "Para",
  "Diferença",
  "Variação %",
  "Status",
  "Motivo",
  "Fora da soma",
  "Justificativa",
] as const;

/**
 * Como o CSV escreve a unidade de cada coluna, por extenso.
 *
 * A coluna existe por causa do arquivo, e não da tela. Aqui ela é ainda mais
 * necessária do que em Km Rodado: `0,0312`, `420,00`, `6` e `180000` são quatro
 * células numéricas na mesma coluna, e são R$/km, reais por pneu, pneus e
 * quilômetros. Somar a coluna junta as quatro sem avisar.
 */
export const UNIDADE_NO_CSV_DE_PNEU: Record<PapelDaColunaDePneu, string> = {
  RAZAO: "R$/km",
  POR_VIAGEM: "R$/viagem",
  UNITARIO: "R$/pneu",
  QUANTIDADE: "pneus",
  VIDA: "km de vida",
  CONTEXTO: "texto",
};

/**
 * Uma linha da tabela como as células do CSV.
 *
 * A justificativa entra por parâmetro porque **não é da linha**: ela é do
 * gestor, mora em `justificativa` e é lida por `change_id` numa segunda
 * consulta. É a mesma escolha de `celulasDoCsvDeKm`, e pela mesma razão.
 */
export function celulasDoCsvDePneu(
  l: LinhaDePneu,
  justificativa?: string | null,
): (string | number | null)[] {
  return [
    l.entityLabel,
    l.rotuloDaVariavel,
    UNIDADE_NO_CSV_DE_PNEU[l.papel],
    l.base,
    l.comparada,
    l.diferenca,
    l.variacao,
    ROTULO_DO_ESTADO[l.estado],
    l.motivo,
    l.foraDaSoma,
    justificativa ?? null,
  ];
}
