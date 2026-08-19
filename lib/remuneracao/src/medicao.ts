/**
 * As medições do cadastro — puras, sem banco e sem HTTP.
 *
 * Toda conta que este módulo faz mora aqui, e mora separada da leitura pela
 * mesma razão que `comporDeFatos` é separada de `lerVigencia`: é sobre estas
 * funções que os testes sintéticos rodam, sem precisar de um export inteiro
 * nem de um Postgres de pé.
 *
 * **O princípio: a alíquota é medida, nunca presumida.** É o mesmo de
 * `@workspace/fechamento/aliquota`, e vale aqui pelo mesmo motivo. O export
 * traz duas coisas diferentes sobre o mesmo tributo — a alíquota que o trecho
 * *declara* (`percentualIcmsIss`) e o imposto que ele *carrega*
 * (`impostosIcmsIss` sobre `freteCtrc`) —, e as duas podem discordar. A que
 * este módulo usa é a segunda, porque ela é dinheiro: uma coluna de percentual
 * pode vir em pontos (`17,84`) ou em fração (`0,1784`), e não há como saber
 * qual das duas sem adivinhar. A razão entre dois valores em reais não tem essa
 * ambiguidade.
 *
 * O que a coluna declarada faz aqui é servir de conferência: ela volta na
 * procedência, com os seus valores distintos, para que a tela possa mostrar
 * "declarado × medido" quando alguém quiser conferir.
 */

/** Um trecho da vigência, reduzido ao que o cadastro precisa dele. */
export interface TrechoDaVigencia {
  /** `icmsIss` — o tributo aplicável ao trecho. Nulo quando a coluna não veio. */
  tributo: "ICMS" | "ISS" | null;
  /** `percentualIcmsIss` — a alíquota **declarada**, em escala desconhecida. */
  percentualDeclarado: number | null;
  /** `freteCtrc` — o valor do documento. É a base de toda razão daqui. */
  freteCtrc: number | null;
  /** `impostosIcmsIss` — quanto de ICMS ou ISS o trecho carrega, em reais. */
  imposto: number | null;
  /** `fretePisCofins` — PIS e COFINS somados, como o export os traz. */
  pisCofins: number | null;
  /** `previsaoViagens` — quantos documentos o trecho gera no mês. */
  previsaoViagens: number | null;
}

/** Um cavalo da vigência, reduzido ao que o cadastro precisa dele. */
export interface CavaloDaVigencia {
  entityId: string;
  /** `ativo` — nulo quando a coluna não veio para aquele veículo. */
  ativo: boolean | null;
}

export type Tributo = "ICMS" | "ISS";

/** Arredonda para `casas`, sem o erro de ponto flutuante do `toFixed` cru. */
function arredondar(valor: number, casas: number): number {
  const fator = 10 ** casas;
  return Math.round((valor + Number.EPSILON) * fator) / fator;
}

// ---------------------------------------------------------------------------
// Frota
// ---------------------------------------------------------------------------

export interface ContagemDaFrota {
  ativos: number;
  inativos: number;
  /** Ativos + inativos. **Não** é o total: quem não respondeu fica de fora. */
  operacao: number;
  /**
   * Quantos veículos não trouxeram a coluna `ativo`.
   *
   * Existe como campo, e não como diferença que a tela calcula, porque é a
   * única coisa que separa "a frota tem 64 veículos" de "64 veículos
   * responderam se estão ativos". Um veículo sem resposta não é inativo — e
   * somá-lo aos inativos é o erro que faria a planilha remunerar frota parada
   * que na verdade nunca foi contada.
   */
  semResposta: number;
  /** Quantos cavalos a vigência entregou, respondendo ou não. */
  total: number;
}

export function contarFrota(cavalos: CavaloDaVigencia[]): ContagemDaFrota {
  let ativos = 0;
  let inativos = 0;
  let semResposta = 0;
  for (const cavalo of cavalos) {
    if (cavalo.ativo === true) ativos += 1;
    else if (cavalo.ativo === false) inativos += 1;
    else semResposta += 1;
  }
  return { ativos, inativos, operacao: ativos + inativos, semResposta, total: cavalos.length };
}

// ---------------------------------------------------------------------------
// Alíquotas
// ---------------------------------------------------------------------------

export interface AliquotaMedida {
  /** A alíquota em pontos percentuais — `17.84` para 17,84%. */
  percentual: number;
  /** Quantos trechos entraram na medição. */
  trechos: number;
  /** A base: a soma do valor de documento dos trechos medidos. */
  base: number;
  /** O imposto somado — o numerador da razão. */
  imposto: number;
  /**
   * Os valores distintos da coluna declarada, como vieram.
   *
   * Sem normalização de escala de propósito: é conferência, não cálculo. Uma
   * lista com um valor só é o caso limpo; mais de um diz que o trecho manda no
   * tributo e a unidade não tem uma alíquota única.
   */
  declarados: number[];
}

/**
 * A alíquota de um tributo, medida sobre os trechos que o aplicam.
 *
 * `null` quando nenhum trecho daquele tributo trouxe as duas pontas em reais —
 * e nulo aqui é resposta, não falha: quer dizer que a vigência não tem como
 * sustentar aquela alíquota, e a linha do cadastro dirá isso em vez de mostrar
 * zero.
 */
export function medirAliquota(
  trechos: TrechoDaVigencia[],
  tributo: Tributo,
): AliquotaMedida | null {
  let base = 0;
  let imposto = 0;
  let contados = 0;
  const declarados = new Set<number>();

  for (const trecho of trechos) {
    if (trecho.tributo !== tributo) continue;
    if (trecho.percentualDeclarado !== null) declarados.add(trecho.percentualDeclarado);
    if (trecho.freteCtrc === null || trecho.imposto === null) continue;
    base += trecho.freteCtrc;
    imposto += trecho.imposto;
    contados += 1;
  }

  if (contados === 0 || base <= 0) return null;

  return {
    percentual: arredondar((imposto / base) * 100, 4),
    trechos: contados,
    base: arredondar(base, 2),
    imposto: arredondar(imposto, 2),
    declarados: [...declarados].sort((a, b) => a - b),
  };
}

/**
 * PIS e COFINS, medidos **juntos** — porque juntos é como o export os traz.
 *
 * `fretePisCofins` é uma coluna só, e separá-la em duas exigiria as duas
 * alíquotas, que é justamente o que se está tentando descobrir. O cadastro
 * pede as duas em linhas separadas; este módulo entrega o par e diz que é par.
 * Rachar 9,25% em 0,65% e 8,60% porque é o que a lei federal diz seria trazer
 * para dentro do produto uma premissa que nenhum arquivo do cliente sustenta.
 */
export function medirPisCofins(
  trechos: TrechoDaVigencia[],
): { percentual: number; trechos: number; base: number; valor: number } | null {
  let base = 0;
  let valor = 0;
  let contados = 0;

  for (const trecho of trechos) {
    if (trecho.freteCtrc === null || trecho.pisCofins === null) continue;
    base += trecho.freteCtrc;
    valor += trecho.pisCofins;
    contados += 1;
  }

  if (contados === 0 || base <= 0) return null;

  return {
    percentual: arredondar((valor / base) * 100, 4),
    trechos: contados,
    base: arredondar(base, 2),
    valor: arredondar(valor, 2),
  };
}

// ---------------------------------------------------------------------------
// Proporção dos documentos
// ---------------------------------------------------------------------------

export interface ProporcaoDeDocumentos {
  /** A fatia dentro do município — a que paga ISS. Em pontos percentuais. */
  dentro: number;
  /** A fatia fora do município — a que compõe CT-e. Em pontos percentuais. */
  fora: number;
  /**
   * O que foi contado.
   *
   * `VIAGENS_PREVISTAS` é o critério certo — a planilha fala em *quantidade de
   * documentos emitidos*, e um trecho emite tantos documentos quantas viagens
   * ele prevê. `TRECHOS` é o recuo honesto para quando a previsão não veio em
   * todos: contar trechos trata a rota de 40 viagens/mês como igual à de 2, e a
   * tela precisa dizer que foi assim que contou.
   */
  criterio: "VIAGENS_PREVISTAS" | "TRECHOS";
  /** O denominador — documentos ou trechos, conforme o critério. */
  documentos: number;
  /** Quantos trechos ficaram de fora por não declarar tributo. */
  semTributo: number;
}

/**
 * Que fatia dos documentos previstos fica dentro do município.
 *
 * `null` quando nenhum trecho declara tributo — sem o `icmsIss`, não há dentro
 * nem fora, e uma proporção de zero sobre zero não é "0%".
 */
export function medirProporcaoDeDocumentos(
  trechos: TrechoDaVigencia[],
): ProporcaoDeDocumentos | null {
  const comTributo = trechos.filter((t) => t.tributo !== null);
  const semTributo = trechos.length - comTributo.length;
  if (comTributo.length === 0) return null;

  /*
    A previsão só serve de peso quando **todos** os trechos a trouxeram. Um
    denominador que soma viagens de uns e conta cabeças de outros não é nenhuma
    das duas medidas, e a tela não teria como dizer o que mostrou.
  */
  const todosPreveem = comTributo.every(
    (t) => t.previsaoViagens !== null && t.previsaoViagens > 0,
  );
  const criterio = todosPreveem ? "VIAGENS_PREVISTAS" : "TRECHOS";
  const peso = (t: TrechoDaVigencia) => (todosPreveem ? (t.previsaoViagens as number) : 1);

  let dentro = 0;
  let total = 0;
  for (const trecho of comTributo) {
    const p = peso(trecho);
    total += p;
    if (trecho.tributo === "ISS") dentro += p;
  }
  if (total <= 0) return null;

  const percentualDentro = arredondar((dentro / total) * 100, 4);
  return {
    dentro: percentualDentro,
    fora: arredondar(100 - percentualDentro, 4),
    criterio,
    documentos: arredondar(total, 4),
    semTributo,
  };
}

// ---------------------------------------------------------------------------
// Resumo de impostos
// ---------------------------------------------------------------------------

/**
 * O divisor do gross-up: quanto sobra de cada real faturado.
 *
 * A planilha traz 84,85% dentro do município e 72,91% fora, e as duas são a
 * mesma conta com um tributo diferente no lugar: `100% − (PIS + COFINS + ISS)`
 * e `100% − (PIS + COFINS + ICMS)`. É o que fecha, com as alíquotas da própria
 * aba, nos dois lados — e é por isso que estas duas linhas são as únicas do
 * cadastro que não dependem de nenhuma leitura nova: dadas as alíquotas, elas
 * são aritmética.
 *
 * Os tributos são "por dentro": incidem sobre o valor do próprio documento, e
 * não sobre o líquido. Por isso o líquido vira documento **dividindo** por este
 * percentual, e não multiplicando por um acréscimo.
 */
export function resumoDeImpostos(aliquotas: {
  pisCofins: number | null;
  icms: number | null;
  iss: number | null;
}): { dentro: number | null; fora: number | null } {
  const { pisCofins, icms, iss } = aliquotas;
  return {
    dentro: pisCofins !== null && iss !== null ? arredondar(100 - pisCofins - iss, 4) : null,
    fora: pisCofins !== null && icms !== null ? arredondar(100 - pisCofins - icms, 4) : null,
  };
}
