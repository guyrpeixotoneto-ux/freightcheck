/**
 * A AUDITORIA DE LUCRO FIXO — o recorte da remuneração sobre o motor que já existe.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo é, e sobretudo o que ele não é
 * ---------------------------------------------------------------------------
 * Ele **não compara nada** e **não traduz o motor de novo**: comparar é do
 * `engine.ts`, e os seis estados, a forma da alteração e a ordem de gravidade
 * vêm de `recorte-de-rubrica.ts` — o mesmo módulo que FINAME e IPVA usam.
 * "Conflito" aqui é, por construção, o mesmo "Conflito" das outras duas.
 *
 * ---------------------------------------------------------------------------
 * A diferença que atravessa o arquivo inteiro: aqui é receita
 * ---------------------------------------------------------------------------
 * FINAME e IPVA são custo — `(−) Custo fixo` e `(−) Depreciação e financeiro` na
 * DRE. O lucro fixo é **`Receita bruta`** (`catalogo-declarado.ts`), e isso não
 * é detalhe de classificação: inverte o sentido de todo número da tela.
 *
 * Uma parcela de FINAME que sobe é custo que subiu, e sai em vermelho. Um lucro
 * fixo que sobe é receita que subiu, e sair em vermelho diria ao operador que
 * ele perdeu dinheiro no mês em que ganhou mais. É a mesma régua de cor aplicada
 * a uma grandeza de sinal oposto, e por isso {@link DIRECAO_ECONOMICA} existe:
 * para que a diferença esteja escrita num lugar só, e não redescoberta em cada
 * componente.
 *
 * ---------------------------------------------------------------------------
 * A pergunta que só esta tela responde: o ciclo
 * ---------------------------------------------------------------------------
 * O verbete da tela em preparo pedia "o percentual contratado sobre o qual ela é
 * calculada". Ele continua não existindo no acervo, e esta tela não o inventa.
 *
 * O que o acervo tem, medido, é melhor do que um percentual: **o lucro fixo e a
 * amortização nunca coexistem.** Em 558 linhas, zero coexistências
 * (`regras.ts`), e o ciclo diz qual dos dois está valendo — ciclo 1 ⟺
 * amortização > 0 e lucro fixo = 0 (503 linhas); ciclo 2 ⟺ amortização = 0 (55),
 * e é aí que o lucro fixo entra. São 554 de 558
 * (`docs/CLASSIFICACAO-DOS-NAO-APURADOS.md`).
 *
 * Então a pergunta desta tela é **quem virou o ciclo entre as duas vigências**:
 * quais ativos terminaram de amortizar o financiamento e passaram a ser
 * remunerados por estar à disposição ({@link viradasDeCiclo}). É o que explica
 * uma linha de lucro fixo que sobe sem que ninguém tenha renegociado nada — e um
 * recorte que só mostrasse o delta em reais chamaria de aumento o que é uma
 * frota envelhecendo para dentro do segundo ciclo.
 *
 * E a mesma medição dá o **achado pelo avesso**: um ativo com amortização e
 * lucro fixo ao mesmo tempo é uma coexistência, que o acervo diz não existir.
 * Quando aparecer, é defeito de dado ou mudança de regra, e nos dois casos é
 * para ser olhado — nunca somado em silêncio ({@link coexistencias}).
 *
 * ---------------------------------------------------------------------------
 * A coluna que não soma, e de onde vem a frase dela
 * ---------------------------------------------------------------------------
 * `carreta.lucro_fixomodelo_novo_ciclo` é do **conjunto**: ela é a soma da
 * parcela da carreta com a do cavalo vinculado, medido em 284 de 284 pares.
 * Somá-la ao lado da parcela do cavalo contaria o mesmo dinheiro duas vezes —
 * R$ 34.793,84 por mês em agosto/2026, 11,5% do total da frota de carretas.
 *
 * A evidência **não é redigitada aqui**: ela é lida de `ESCOPOS_DE_CONJUNTO`
 * (`composition.ts`), que é onde o produto inteiro guarda essa decisão. Uma
 * segunda cópia da frase envelheceria sozinha no dia em que a medição fosse
 * refeita — e foi exatamente isso que aconteceu com este achado uma vez, quando
 * `regras.ts` afirmava que a coluna não continha o cavalo.
 */

import { escopoDeConjunto } from "./composition";
import {
  chaveDoVeiculo,
  estadoDaAlteracao,
  GRAVIDADE,
  numero,
  ROTULO_DO_ESTADO,
  type EstadoDaLinha,
  type MedidaDaVariavel,
  type AlteracaoDoMotor,
} from "./recorte-de-rubrica";
import {
  agruparVeiculos,
  medidasDoCatalogo,
  type OpcoesDoAgrupamento,
  type VeiculoDaRubrica,
} from "./agrupamento-por-veiculo";

export {
  estadoDaAlteracao,
  ROTULO_DO_ESTADO,
  type AlteracaoDoMotor,
  type MedidaDaVariavel,
};

/** Os seis estados de uma linha de lucro fixo. O mesmo tipo dos outros recortes. */
export type EstadoDaLinhaDeLucroFixo = EstadoDaLinha;

/**
 * Para que lado aponta o dinheiro desta tela.
 *
 * `RECEITA` — e é a única das três auditorias de rubrica em que isto é verdade.
 * O valor mora num lugar só porque a tela, o CSV e os cartões precisam da mesma
 * resposta: subir é bom. Deixar cada componente decidir sozinho é como um
 * gráfico acabaria pintando de vermelho a melhor notícia do mês.
 */
export const DIRECAO_ECONOMICA = "RECEITA" as const;

// ---------------------------------------------------------------------------
// O catálogo das variáveis
// ---------------------------------------------------------------------------

/** Uma variável de lucro fixo, com o código que cada tipo de equipamento usa. */
export interface VariavelDeLucroFixo {
  /** A chave estável desta variável na tela e na API. Nunca muda de sentido. */
  chave: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  codigo: { CAVALO?: string; CARRETA?: string };
  /**
   * Um total que embute a parcela do outro equipamento do conjunto.
   *
   * Preenchido a partir de `ESCOPOS_DE_CONJUNTO`, nunca à mão — ver o cabeçalho.
   * Uma linha assim aparece no detalhe, dita por extenso, e fica fora de toda
   * soma.
   */
  foraDaSoma?: string;
  /** Uma linha de contexto para o ⓘ da tela. */
  ajuda?: string;
}

/** A frase medida de um escopo de conjunto, lida de onde ela já mora. */
function evidenciaDoConjunto(code: string): string {
  const escopo = escopoDeConjunto(code);
  /*
    Sem evidência declarada não se inventa uma: a linha passa a somar como
    qualquer outra, que é o comportamento certo para uma coluna que ninguém
    provou ser de conjunto. O `??` não é defensividade vazia — é a diferença
    entre "medimos e não soma" e "não sabemos", e as duas não se dizem igual.
  */
  return escopo?.evidence ?? "";
}

/**
 * As variáveis do lucro fixo, na ordem em que a tela as lê.
 *
 * Começa na rubrica, e as duas seguintes são o que **explica** a rubrica: o
 * ciclo e a amortização. Elas não estão aqui como contexto simpático — são a
 * resposta à pergunta que um lucro fixo zerado levanta, e sem elas a tela
 * mostraria "R$ 0,00" onde o certo é "ainda está amortizando".
 */
export const VARIAVEIS_DE_LUCRO_FIXO: readonly VariavelDeLucroFixo[] = [
  {
    chave: "lucro_fixo",
    rotulo: "Lucro fixo",
    medida: "DINHEIRO",
    codigo: {
      CAVALO: "cavalo.lucro_fixomodelo_novo_ciclo_cavalo",
      CARRETA: "carreta.lucro_fixomodelo_novo_ciclo_carreta",
    },
    ajuda:
      "A parcela própria de cada equipamento. A coluna do conjunto fica no detalhe, " +
      "fora de toda soma: ela embute a parcela do cavalo vinculado.",
  },
  {
    chave: "ciclo",
    rotulo: "Ciclo",
    medida: "CICLO",
    codigo: { CAVALO: "cavalo.ciclo", CARRETA: "carreta.ciclo" },
    ajuda:
      "Ciclo 1 é o ativo ainda amortizando o financiamento, e nele o lucro fixo é zero; " +
      "ciclo 2 é o ativo que terminou de amortizar e passou a ser remunerado. Medido em " +
      "554 de 558 linhas.",
  },
  {
    chave: "amortizacao",
    rotulo: "Amortização",
    medida: "DINHEIRO",
    codigo: {
      CAVALO: "cavalo.amortizacao_cavalo",
      CARRETA: "carreta.amortizacao_implemento",
    },
    ajuda:
      "A outra metade do par: amortização e lucro fixo nunca coexistem — 558 linhas, zero " +
      "coexistências. É ela que explica um lucro fixo zerado.",
  },
  {
    chave: "ano",
    rotulo: "Ano",
    medida: "ANO",
    codigo: { CAVALO: "cavalo.ano", CARRETA: "carreta.ano" },
  },
] as const;

/**
 * As variáveis que só o detalhe mostra.
 *
 * Uma só: a coluna do conjunto. Ela existe no acervo e quem confere a planilha
 * vai encontrá-la lá — some da tela seria deixar a pessoa procurando por que o
 * nosso número não bate com o dela.
 */
export const VARIAVEIS_DE_DETALHE_DE_LUCRO_FIXO: readonly VariavelDeLucroFixo[] = [
  {
    chave: "lucro_fixo_conjunto",
    rotulo: "Lucro fixo do conjunto (cavalo + carreta)",
    medida: "DINHEIRO",
    codigo: { CARRETA: "carreta.lucro_fixomodelo_novo_ciclo" },
    foraDaSoma: evidenciaDoConjunto("carreta.lucro_fixomodelo_novo_ciclo"),
    ajuda: "Só a carreta declara esta coluna; o cavalo não tem equivalente.",
  },
] as const;

const TODAS = [...VARIAVEIS_DE_LUCRO_FIXO, ...VARIAVEIS_DE_DETALHE_DE_LUCRO_FIXO];

/** Os códigos de atributo de um conjunto de variáveis. Sem repetição, ordenados. */
export function codigosDeLucroFixo(
  variaveis: readonly VariavelDeLucroFixo[],
): string[] {
  const codigos = new Set<string>();
  for (const v of variaveis) {
    if (v.codigo.CAVALO) codigos.add(v.codigo.CAVALO);
    if (v.codigo.CARRETA) codigos.add(v.codigo.CARRETA);
  }
  return [...codigos].sort();
}

/** O recorte que a tabela pede ao motor. */
export const CODIGOS_DA_TABELA_DE_LUCRO_FIXO = codigosDeLucroFixo(VARIAVEIS_DE_LUCRO_FIXO);

/**
 * Os códigos de um recorte de equipamento — `TODOS`, `CAVALO` ou `CARRETA`.
 *
 * Existe porque nem toda leitura aceita recortar por `entity_type`. A Evolução
 * por Placa aceita (`tipo`), mas a leitura ponta a ponta (`end-to-end.ts`) só
 * aceita uma lista de atributos — e as duas precisam responder pelo **mesmo**
 * recorte quando a aba Cavalo está aberta, ou a tela publica a variação ponta a
 * ponta do acervo inteiro sob o título de um equipamento só.
 *
 * A tradução é exata, e não uma aproximação: cada variável tem um código por
 * equipamento (`cavalo.lucro_fixomodelo_novo_ciclo_cavalo` e `carreta.lucro_fixomodelo_novo_ciclo_carreta` são atributos distintos), então filtrar pelos
 * códigos de um lado é o mesmo conjunto de linhas que filtrar pelo `entity_type`
 * daquele lado.
 */
export function codigosDoRecorteDeLucroFixo(
  recorte: "TODOS" | "CAVALO" | "CARRETA",
  variaveis: readonly VariavelDeLucroFixo[] = VARIAVEIS_DE_LUCRO_FIXO,
): string[] {
  if (recorte === "TODOS") return codigosDeLucroFixo(variaveis);
  const codigos = new Set<string>();
  for (const v of variaveis) {
    const codigo = v.codigo[recorte];
    if (codigo) codigos.add(codigo);
  }
  return [...codigos].sort();
}

/** O recorte do detalhe: tudo, inclusive a coluna do conjunto. */
export const CODIGOS_DO_DETALHE_DE_LUCRO_FIXO = codigosDeLucroFixo(TODAS);

const POR_CODIGO = new Map<string, VariavelDeLucroFixo>();
for (const v of TODAS) {
  if (v.codigo.CAVALO) POR_CODIGO.set(v.codigo.CAVALO, v);
  if (v.codigo.CARRETA) POR_CODIGO.set(v.codigo.CARRETA, v);
}

/** A variável a que um código de atributo pertence, ou `undefined`. */
export function variavelDeLucroFixoDoCodigo(
  code: string | null,
): VariavelDeLucroFixo | undefined {
  return code === null ? undefined : POR_CODIGO.get(code);
}

/** O código que um tipo de equipamento usa para uma variável, quando existe. */
export function codigoDaVariavelDeLucroFixo(
  variavel: VariavelDeLucroFixo,
  entityType: string,
): string | undefined {
  const tipo = entityType.trim().toUpperCase();
  if (tipo === "CAVALO") return variavel.codigo.CAVALO;
  if (tipo === "CARRETA") return variavel.codigo.CARRETA;
  return undefined;
}

// ---------------------------------------------------------------------------
// A linha da tabela
// ---------------------------------------------------------------------------

/** Uma linha da tabela: um veículo, uma variável, os dois lados. */
export interface LinhaDeLucroFixo {
  /** O `change.id`, quando a linha veio do motor. Ausente nas linhas iguais. */
  id: number | null;
  entityLabel: string | null;
  entityType: string;
  variavel: string;
  rotuloDaVariavel: string;
  medida: MedidaDaVariavel;
  attributeCode: string | null;
  /** O texto do valor na ponta "De". Nulo quando não havia. */
  base: string | null;
  /** O texto do valor na ponta "Para". Nulo quando não há. */
  comparada: string | null;
  /** `Para − De`. Nula sempre que o motor não a produziu. */
  diferenca: number | null;
  /** A variação em **pontos percentuais**. Nula quando a base é zero. */
  variacao: number | null;
  estado: EstadoDaLinhaDeLucroFixo;
  /** A frase da recusa, quando há. Vem do motor, não é escrita aqui. */
  motivo: string | null;
  impactoAmount: number | null;
  impactoPeriodicidade: string | null;
  impactoCalculado: boolean;
  /** O aviso da coluna de conjunto, quando esta linha é de uma delas. */
  foraDaSoma: string | null;
}

/**
 * Uma alteração do motor virando linha da tabela.
 *
 * Devolve `null` para o que não é de lucro fixo — a função é o filtro e o
 * tradutor ao mesmo tempo, de modo que nenhuma tela precise saber quais são os
 * códigos.
 */
export function linhaDeLucroFixoDaAlteracao(
  a: AlteracaoDoMotor,
): LinhaDeLucroFixo | null {
  const variavel = variavelDeLucroFixoDoCodigo(a.attributeCode);
  /*
    Entrada e saída de ativo não citam atributo: o motor as grava uma vez por
    veículo, no eixo da frota. Elas entram como a linha do veículo inteiro —
    sumir com elas esconderia a metade mais visível do que mudou na frota.
  */
  if (!variavel) {
    if (a.changeType !== "ENTITY_ADDED" && a.changeType !== "ENTITY_REMOVED") return null;
    return {
      id: a.id ?? null,
      entityLabel: a.entityLabel,
      entityType: a.entityType ?? "",
      variavel: "veiculo",
      rotuloDaVariavel: "Veículo na frota",
      medida: "DATA",
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
    foraDaSoma: variavel.foraDaSoma || null,
  };
}

/** As linhas de lucro fixo de uma lista de alterações, na ordem em que vieram. */
export function linhasDeLucroFixo(
  alteracoes: readonly AlteracaoDoMotor[],
): LinhaDeLucroFixo[] {
  const linhas: LinhaDeLucroFixo[] = [];
  for (const a of alteracoes) {
    const linha = linhaDeLucroFixoDaAlteracao(a);
    if (linha) linhas.push(linha);
  }
  return linhas;
}

/**
 * Um par de valores iguais virando linha — o alternador "sem alteração".
 *
 * Estas linhas **não vêm do motor**: o `change_set` só guarda o que mudou. Elas
 * são montadas a partir das duas leituras de `getEntityTable`, e por isso
 * carregam `id: null`.
 */
export function linhaDeLucroFixoSemAlteracao(par: {
  entityLabel: string | null;
  entityType: string;
  attributeCode: string;
  valor: string | null;
}): LinhaDeLucroFixo | null {
  const variavel = variavelDeLucroFixoDoCodigo(par.attributeCode);
  if (!variavel) return null;
  return {
    id: null,
    entityLabel: par.entityLabel,
    entityType: par.entityType,
    variavel: variavel.chave,
    rotuloDaVariavel: variavel.rotulo,
    medida: variavel.medida,
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
    foraDaSoma: variavel.foraDaSoma || null,
  };
}

// ---------------------------------------------------------------------------
// O impacto — e as três coisas que ele se recusa a fazer
// ---------------------------------------------------------------------------

/** O impacto financeiro do recorte, por periodicidade. */
export interface ImpactoDeLucroFixo {
  /**
   * Um número por periodicidade, **nunca um total único**.
   *
   * A regra é a mesma do resto do produto, e aqui ela tem um detalhe próprio: o
   * sinal é de **receita**. Um valor positivo é mais dinheiro entrando, não
   * mais custo — ver {@link DIRECAO_ECONOMICA}.
   */
  porPeriodicidade: Record<string, number>;
  /** Alterações monetárias que o motor não soube precificar, com motivo próprio. */
  naoCalculavel: number;
  /** Linhas retiradas do total por serem do conjunto, e não do equipamento. */
  foraDaSoma: number;
}

/**
 * O impacto do recorte de lucro fixo, por periodicidade e sem dupla contagem.
 *
 * **Não soma periodicidades diferentes**, **não soma a coluna do conjunto**
 * junto com as parcelas dela, e **não soma a amortização com o lucro fixo**: a
 * segunda está na tabela para explicar a primeira, não para entrar no mesmo
 * total. Somá-las seria pior do que misturar rubricas — seria misturar uma
 * receita com um custo, e o número resultante não é de lado nenhum da DRE.
 */
export function impactoDeLucroFixo(
  linhas: readonly LinhaDeLucroFixo[],
): ImpactoDeLucroFixo {
  const porPeriodicidade: Record<string, number> = {};
  let naoCalculavel = 0;
  let foraDaSoma = 0;

  for (const l of linhas) {
    if (l.estado !== "ALTERADO") continue;
    if (l.foraDaSoma) {
      foraDaSoma++;
      continue;
    }
    /* Só a rubrica entra. A amortização é contexto; o ano não é dinheiro. */
    if (l.variavel !== "lucro_fixo") continue;
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
  return { porPeriodicidade, naoCalculavel, foraDaSoma };
}

// ---------------------------------------------------------------------------
// O ciclo — a leitura própria desta tela
// ---------------------------------------------------------------------------

/** Um ativo que trocou de ciclo entre as duas vigências. */
export interface ViradaDeCiclo {
  entityLabel: string | null;
  entityType: string;
  de: number | null;
  para: number | null;
  /** O lucro fixo que entrou (ou saiu) junto com a virada, quando há. */
  lucroFixoDiferenca: number | null;
  /** A amortização que saiu (ou entrou) junto, quando há. */
  amortizacaoDiferenca: number | null;
  /**
   * `ENTROU_NO_SEGUNDO` quando o ativo terminou de amortizar e passou a ser
   * remunerado — a virada que o acervo explica. `VOLTOU_AO_PRIMEIRO` é o
   * caminho inverso, que o modelo não prevê: um ativo não desamortiza. Quando
   * aparece, é reclassificação ou defeito de cadastro, e é para ser olhado.
   */
  sentido: "ENTROU_NO_SEGUNDO" | "VOLTOU_AO_PRIMEIRO" | "OUTRO";
}

/**
 * O ciclo como número, ou `null` quando a fonte não o trouxe legível.
 *
 * O branco é testado **antes** de converter, e não é zelo: `numero("")` devolve
 * `0`, porque `Number("")` é `0`. Aqui isso não seria um zero inofensivo — seria
 * uma virada inventada, "ciclo 1 → ciclo 0", numa tela cuja pergunta inteira é
 * quem virou o ciclo. `numero` está certo para o que ele documenta, que é
 * `numeric` do Postgres; o ciclo chega como texto da fonte, onde o branco
 * existe.
 */
function cicloDe(valor: string | null): number | null {
  if (valor === null || valor.trim() === "") return null;
  const n = numero(valor);
  return n === null ? null : Math.trunc(n);
}

/**
 * Quem virou o ciclo entre as duas vigências — a pergunta desta tela.
 *
 * Sai das linhas do motor, e não de uma segunda leitura: o `change_set` já sabe
 * quem mudou de ciclo, porque `ciclo` é uma das variáveis do recorte. O lucro
 * fixo e a amortização do mesmo veículo são costurados ao lado para que a
 * virada venha com o dinheiro que a acompanha — é o par que torna a linha
 * legível: "saiu R$ 3.100 de amortização, entrou R$ 3.318 de lucro fixo".
 *
 * Ordenado pelo dinheiro que entrou, do maior para o menor: numa frota de 62
 * cavalos, quem lê quer primeiro as viradas que pesam.
 */
export function viradasDeCiclo(
  linhas: readonly LinhaDeLucroFixo[],
): ViradaDeCiclo[] {
  const porVeiculo = new Map<string, Map<string, LinhaDeLucroFixo>>();
  for (const l of linhas) {
    if (l.variavel === "veiculo") continue;
    const chave = chaveDoVeiculo(l);
    const doVeiculo = porVeiculo.get(chave) ?? new Map<string, LinhaDeLucroFixo>();
    doVeiculo.set(l.variavel, l);
    porVeiculo.set(chave, doVeiculo);
  }

  const viradas: ViradaDeCiclo[] = [];
  for (const doVeiculo of porVeiculo.values()) {
    const ciclo = doVeiculo.get("ciclo");
    if (!ciclo || ciclo.estado !== "ALTERADO") continue;
    const de = cicloDe(ciclo.base);
    const para = cicloDe(ciclo.comparada);
    if (de === null || para === null || de === para) continue;

    viradas.push({
      entityLabel: ciclo.entityLabel,
      entityType: ciclo.entityType,
      de,
      para,
      lucroFixoDiferenca: doVeiculo.get("lucro_fixo")?.diferenca ?? null,
      amortizacaoDiferenca: doVeiculo.get("amortizacao")?.diferenca ?? null,
      sentido:
        de === 1 && para === 2
          ? "ENTROU_NO_SEGUNDO"
          : de === 2 && para === 1
            ? "VOLTOU_AO_PRIMEIRO"
            : "OUTRO",
    });
  }

  return viradas.sort(
    (a, b) =>
      (b.lucroFixoDiferenca ?? 0) - (a.lucroFixoDiferenca ?? 0) ||
      (a.entityLabel ?? "").localeCompare(b.entityLabel ?? ""),
  );
}

/** Um ativo com amortização e lucro fixo ao mesmo tempo — o que não devia existir. */
export interface Coexistencia {
  entityLabel: string | null;
  entityType: string;
  /** O lucro fixo na ponta comparada. */
  lucroFixo: number;
  /** A amortização na mesma ponta. */
  amortizacao: number;
  /** O ciclo declarado, quando a fonte o trouxe. */
  ciclo: number | null;
}

/**
 * Os ativos que declaram amortização **e** lucro fixo na mesma ponta.
 *
 * O acervo diz que isto não acontece: 558 linhas, zero coexistências
 * (`regras.ts`). Uma medição de zero é a mais frágil que existe — basta uma
 * linha nova para derrubá-la —, e é justamente por isso que a tela pergunta
 * toda vez em vez de confiar na frase. Se aparecer, ou o modelo mudou, ou o
 * cadastro errou; nos dois casos o número que a tela soma está em dúvida, e
 * dizer isso é mais útil do que somar calado.
 *
 * Lê a ponta **comparada**, que é a vigência que se está auditando. A base já
 * foi auditada quando era a comparada de outro par.
 */
export function coexistencias(
  valores: readonly ValorDeLucroFixo[],
): Coexistencia[] {
  const achados: Coexistencia[] = [];
  for (const v of valores) {
    if (v.ponta !== "COMPARADA") continue;
    if (v.lucroFixo === null || v.amortizacao === null) continue;
    if (v.lucroFixo <= 0 || v.amortizacao <= 0) continue;
    achados.push({
      entityLabel: v.entityLabel,
      entityType: v.entityType,
      lucroFixo: v.lucroFixo,
      amortizacao: v.amortizacao,
      ciclo: v.ciclo,
    });
  }
  return achados.sort((a, b) => b.lucroFixo - a.lucroFixo);
}

// ---------------------------------------------------------------------------
// Os indicadores e as séries
// ---------------------------------------------------------------------------

/** Quantos veículos cada vigência entregou — vem da contagem do motor. */
export interface FrotaDoParDeLucroFixo {
  comparados: number;
  novos: number;
  ausentes: number;
}

export interface ResumoDeLucroFixo {
  veiculosComparados: number;
  semAlteracao: number;
  veiculosComAlteracao: number;
  novosNaVigencia: number;
  ausentesNaComparada: number;
  variaveisAlteradas: number;
  veiculosComDadoIncompleto: number;
  veiculosComConflito: number;
  /** Quantos ativos entraram no segundo ciclo — a leitura própria desta tela. */
  entraramNoSegundoCiclo: number;
  /** Quantos voltaram ao primeiro, que é o sentido que o modelo não prevê. */
  voltaramAoPrimeiroCiclo: number;
  impacto: ImpactoDeLucroFixo;
}

/**
 * Os indicadores do topo, de uma passada só.
 *
 * `frota` vem do motor porque esta lista não sabe quantos veículos **não**
 * mudaram: um veículo sem alteração não produz linha nenhuma, e derivar "sem
 * alteração" do tamanho da lista daria zero justamente na comparação em que
 * nada se moveu.
 */
export function resumirLucroFixo(
  linhas: readonly LinhaDeLucroFixo[],
  frota: FrotaDoParDeLucroFixo,
): ResumoDeLucroFixo {
  const comAlteracao = new Set<string>();
  const comIncompleto = new Set<string>();
  const comConflito = new Set<string>();
  let variaveisAlteradas = 0;

  for (const l of linhas) {
    if (l.variavel === "veiculo") continue;
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

  const viradas = viradasDeCiclo(linhas);
  /*
    "Sem alteração" é o que **nenhuma** linha tocou — e não só o que não mudou de
    valor. A regra nasceu no recorte de FINAME, sobre dado real, e vale igual
    aqui: um veículo em conflito não é um veículo em que nada mudou.
  */
  const tocados = new Set([...comAlteracao, ...comIncompleto, ...comConflito]);
  return {
    veiculosComparados: frota.comparados,
    semAlteracao: Math.max(0, frota.comparados - tocados.size),
    veiculosComAlteracao: comAlteracao.size,
    novosNaVigencia: frota.novos,
    ausentesNaComparada: frota.ausentes,
    variaveisAlteradas,
    veiculosComDadoIncompleto: comIncompleto.size,
    veiculosComConflito: comConflito.size,
    entraramNoSegundoCiclo: viradas.filter((v) => v.sentido === "ENTROU_NO_SEGUNDO").length,
    voltaramAoPrimeiroCiclo: viradas.filter((v) => v.sentido === "VOLTOU_AO_PRIMEIRO").length,
    impacto: impactoDeLucroFixo(linhas),
  };
}

/** Uma barra do gráfico "alterações por variável". */
export interface AlteracoesDaVariavelDeLucroFixo {
  variavel: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  alteracoes: number;
}

/** Quantas alterações cada variável teve, da maior para a menor. */
export function alteracoesPorVariavelDeLucroFixo(
  linhas: readonly LinhaDeLucroFixo[],
): AlteracoesDaVariavelDeLucroFixo[] {
  const contagem = new Map<string, number>();
  for (const l of linhas) {
    if (l.estado !== "ALTERADO" || l.variavel === "veiculo") continue;
    contagem.set(l.variavel, (contagem.get(l.variavel) ?? 0) + 1);
  }
  return TODAS.filter((v) => contagem.has(v.chave))
    .map((v) => ({
      variavel: v.chave,
      rotulo: v.rotulo,
      medida: v.medida,
      alteracoes: contagem.get(v.chave)!,
    }))
    .sort((a, b) => b.alteracoes - a.alteracoes || a.rotulo.localeCompare(b.rotulo));
}

/** Uma fatia do gráfico de status. */
export interface FatiaDeEstadoDeLucroFixo {
  estado: EstadoDaLinhaDeLucroFixo;
  rotulo: string;
  veiculos: number;
  fracao: number;
}

/**
 * Os veículos por estado — a rosca.
 *
 * Um veículo aparece numa fatia só, pela ordem de gravidade do módulo comum:
 * sem a regra, a soma das fatias passaria do total de veículos.
 */
export function distribuicaoPorEstadoDeLucroFixo(
  linhas: readonly LinhaDeLucroFixo[],
  frota: FrotaDoParDeLucroFixo,
): FatiaDeEstadoDeLucroFixo[] {
  const pior = new Map<string, EstadoDaLinhaDeLucroFixo>();
  for (const l of linhas) {
    const chave = chaveDoVeiculo(l);
    const atual = pior.get(chave);
    if (atual === undefined || GRAVIDADE.indexOf(l.estado) < GRAVIDADE.indexOf(atual)) {
      pior.set(chave, l.estado);
    }
  }

  const contagem = new Map<EstadoDaLinhaDeLucroFixo, number>();
  for (const estado of pior.values()) {
    contagem.set(estado, (contagem.get(estado) ?? 0) + 1);
  }
  const tocados = [...pior.keys()].filter(
    (k) => pior.get(k) !== "NOVO_NA_VIGENCIA" && pior.get(k) !== "AUSENTE_NA_COMPARADA",
  ).length;
  contagem.set("SEM_ALTERACAO", Math.max(0, frota.comparados - tocados));
  contagem.set("NOVO_NA_VIGENCIA", frota.novos);
  contagem.set("AUSENTE_NA_COMPARADA", frota.ausentes);

  const total = frota.comparados + frota.novos + frota.ausentes;
  return GRAVIDADE.filter((e) => (contagem.get(e) ?? 0) > 0)
    .map((estado) => ({
      estado,
      rotulo: ROTULO_DO_ESTADO[estado],
      veiculos: contagem.get(estado)!,
      fracao: total === 0 ? 0 : contagem.get(estado)! / total,
    }))
    .sort((a, b) => b.veiculos - a.veiculos);
}

// ---------------------------------------------------------------------------
// Os totais e a leitura por ciclo
// ---------------------------------------------------------------------------

/** Um valor lido de uma das duas vigências. */
export interface ValorDeLucroFixo {
  ponta: "BASE" | "COMPARADA";
  entityType: string;
  entityLabel: string | null;
  /** O lucro fixo próprio do equipamento. Nulo quando a vigência não o trouxe. */
  lucroFixo: number | null;
  /** A amortização do mesmo ativo — a outra metade do par. */
  amortizacao: number | null;
  /** O ciclo declarado, quando a fonte o trouxe legível. */
  ciclo: number | null;
}

/** Um ponto do gráfico "valor total por vigência". */
export interface TotalDeLucroFixoDaVigencia {
  ponta: "BASE" | "COMPARADA";
  entityType: string;
  total: number;
  /** Quantos ativos sustentam o total. */
  veiculos: number;
  /** Quantos deles estão no segundo ciclo — os que de fato recebem. */
  noSegundoCiclo: number;
}

/**
 * O total de lucro fixo de cada ponta, por tipo de equipamento.
 *
 * Soma **só a parcela própria** — nunca a coluna do conjunto, que embute a
 * parcela do cavalo vinculado. Os valores vêm da leitura das duas vigências, e
 * não do change set, porque um total tem de incluir quem não mudou.
 *
 * `noSegundoCiclo` viaja junto porque, nesta rubrica, o total sem ele engana: um
 * total que cai porque a frota rejuvenesceu e voltou a amortizar é uma notícia
 * diferente de um total que cai porque a remuneração foi renegociada, e só a
 * contagem dos que estão no segundo ciclo separa as duas.
 */
export function totaisDeLucroFixoPorVigencia(
  valores: readonly ValorDeLucroFixo[],
): TotalDeLucroFixoDaVigencia[] {
  const acumulado = new Map<string, TotalDeLucroFixoDaVigencia>();
  for (const v of valores) {
    if (v.lucroFixo === null) continue;
    const chave = `${v.ponta}${v.entityType}`;
    const atual =
      acumulado.get(chave) ??
      ({
        ponta: v.ponta,
        entityType: v.entityType,
        total: 0,
        veiculos: 0,
        noSegundoCiclo: 0,
      } as TotalDeLucroFixoDaVigencia);
    atual.total += v.lucroFixo;
    atual.veiculos += 1;
    if (v.ciclo === 2) atual.noSegundoCiclo += 1;
    acumulado.set(chave, atual);
  }
  return [...acumulado.values()]
    .map((t) => ({ ...t, total: Number(t.total.toFixed(2)) }))
    .sort((a, b) => a.entityType.localeCompare(b.entityType) || a.ponta.localeCompare(b.ponta));
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

/** O cabeçalho do CSV — a ordem das colunas da tela. */
export const COLUNAS_DO_CSV_DE_LUCRO_FIXO = [
  "Veículo",
  "Tipo",
  "Variável",
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
 * Uma linha da tabela como as células do CSV.
 *
 * Devolve texto cru — sem `R$`, sem separador de milhar e sem decidir o
 * separador do arquivo. O aviso da linha que não soma viaja junto, e existe no
 * arquivo porque o arquivo sai do produto e vira soma na planilha de outra
 * pessoa: um CSV que exporta a coluna do conjunto sem dizer que ela embute
 * o cavalo é a forma mais fácil de o achado se perder.
 *
 * A justificativa entra por parâmetro porque **não é da linha**: ela é do
 * gestor, mora em `justificativa` e é lida por `change_id` numa segunda
 * consulta. Guardá-la dentro da linha faria a comparação carregar um texto que o
 * motor não produziu — e que muda sem a comparação mudar. É a mesma escolha de
 * `celulasDoCsv`, no FINAME. No arquivo ela é a última coluna, e é boa parte do
 * motivo de o CSV existir para além da tela: quem recebe a planilha lê o que
 * mudou e, na mesma linha, por que mudou.
 */
export function celulasDoCsvDeLucroFixo(
  l: LinhaDeLucroFixo,
  justificativa?: string | null,
): (string | number | null)[] {
  return [
    l.entityLabel,
    l.entityType,
    l.rotuloDaVariavel,
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


// ---------------------------------------------------------------------------
// O agrupamento por veículo — uma linha por placa
// ---------------------------------------------------------------------------

/**
 * Um veículo da tabela de lucro fixo: a placa, o que ela moveu, e as linhas
 * por baixo.
 *
 * O corpo do agrupamento mora em `agrupamento-por-veiculo.ts`, com as outras
 * rubricas de custo fixo — inclusive o FINAME, que foi onde ele nasceu. Quatro
 * cópias da mesma função seriam quatro definições de "o estado de uma placa"
 * livres para divergir.
 */
export type VeiculoDeLucroFixo = VeiculoDaRubrica<LinhaDeLucroFixo>;

/**
 * A ordem em que a expansão lê as variáveis de uma placa, e quem é o destaque.
 *
 * A ordem é a do catálogo, e não a que o motor entrega: o catálogo começa pela
 * variável que a tela resume e segue pelo que a explica, e é essa a leitura que
 * a expansão quer. `veiculo` vem antes de tudo, porque entrada e saída de ativo
 * explicam todas as outras linhas da placa; e por isso mesmo fica **fora da
 * contagem**, em vez de fazer uma placa que só entrou na frota aparecer com
 * "1 alteração".
 *
 * O destaque é o lucro fixo próprio do equipamento — **uma** variável, e nunca a soma das monetárias.
 * É a parcela própria de cada equipamento, e nunca a coluna do conjunto: aquela embute a parcela do cavalo vinculado, e usá-la na linha da carreta contaria o mesmo dinheiro nas duas placas. A amortização, que é a outra metade do par, também não entra: ela nunca coexiste com o lucro fixo, e somá-las escreveria como um só dois números que a planilha mantém separados.
 */
export const AGRUPAMENTO_DE_LUCRO_FIXO = {
  ordemDasVariaveis: ["veiculo", ...TODAS.map((v) => v.chave)],
  destaque: "lucro_fixo",
  /* A unidade do destaque e a resposta a "esta rubrica tem dinheiro?" saem
     daqui — do mesmo catálogo que define a ordem da expansão, e nunca de
     uma segunda lista escrita à mão. */
  medidas: medidasDoCatalogo(TODAS),
  foraDaContagem: ["veiculo"],
} as const satisfies OpcoesDoAgrupamento;

/**
 * As linhas viradas uma linha por placa.
 *
 * A tabela nasceu por variável — uma linha por (veículo × variável) —, e a mesma
 * placa aparecia tantas vezes quantas são as variáveis do catálogo, espalhada
 * por várias páginas: ler "o que aconteceu com a QYW6D15" era procurar as linhas
 * dela na lista. Agrupar responde essa pergunta de uma vez, e a lista de baixo
 * continua inteira dentro da placa.
 *
 * **Não recalcula nada.** Contagem, estado e destaque saem das linhas que o
 * motor já produziu; o que a função faz é juntar por `(placa, tipo)` e ordenar.
 */
export function agruparPorVeiculoDeLucroFixo(
  linhas: readonly LinhaDeLucroFixo[],
): VeiculoDeLucroFixo[] {
  return agruparVeiculos(linhas, AGRUPAMENTO_DE_LUCRO_FIXO);
}
