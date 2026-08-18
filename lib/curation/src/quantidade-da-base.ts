/**
 * A quantidade da base — o que transforma uma taxa em dinheiro.
 *
 * ---------------------------------------------------------------------------
 * A lacuna, dita por este repositório antes deste arquivo existir
 * ---------------------------------------------------------------------------
 * `agregacao.ts` já responde, para toda taxa, o que falta para ela virar
 * montante: *"quilometragem rodada por ativo no período"* para `BRL_KM`, *"a
 * quantidade de viagem do período, por ativo"* para `BRL_VIAGEM`. A composição
 * já exclui esses componentes com o motivo nomeado `BASE_AUSENTE`, e o texto do
 * catálogo já diz em voz alta que "a taxa vira dinheiro quando multiplicada
 * pela base".
 *
 * O que faltava era **um lugar para a resposta**. A frase descrevia um dado que
 * ninguém tinha como declarar, e por isso `manutencaoReaisKm` — R$/km, no
 * cavalo, hoje, em produção — fica fora de todo total desde que existe. Não é um
 * problema do trecho: o trecho só o torna grande, porque metade das colunas de
 * dinheiro dele são R$/km e a outra metade é R$/viagem.
 *
 * ---------------------------------------------------------------------------
 * A regra, inteira, numa linha
 * ---------------------------------------------------------------------------
 *
 *     R$/base × base/competência = R$/competência
 *
 * `0,38 R$/km × 4.200 km/mês = 1.596 R$/mês`. `12,40 R$/viagem × 128
 * viagens/mês = 1.587 R$/mês`. **É a mesma conta**, e é por isso que o mecanismo
 * é um só: nada aqui conhece quilômetro, viagem, pallet ou eixo. A base é texto
 * que veio da curadoria, e o dia em que a operação cadastrar `R$ por entrega`
 * não custa uma linha de código.
 *
 * ---------------------------------------------------------------------------
 * Por que é uma declaração, e não uma descoberta
 * ---------------------------------------------------------------------------
 * A tentação é procurar sozinho a coluna que parece a quantidade certa — no
 * export de trecho, `previsaoViagens` está lá, com esse nome. Duas razões para
 * não fazer isso, e a segunda é a que importa:
 *
 * 1. Nome de coluna não é contrato. Foi adivinhar por nome que produziu
 *    `MODELOCARRETA`, e aqui o erro seria pior: um palpite errado não deixa a
 *    tela vazia, produz um número com cara de apurado.
 * 2. **A escolha muda o resultado, e é uma escolha de negócio.** O mesmo trecho
 *    traz `previsaoViagens` e `kmRodadoMesPorEquipe`; uma é previsão de
 *    demanda, a outra é projeção de rodagem por equipe. Qual delas remunera é
 *    decisão de quem opera o contrato, não do código que lê o arquivo.
 *
 * Então a fonte é **declarada** — assinada, versionada e justificada, como toda
 * decisão que move dinheiro neste produto. E a declaração aponta para um
 * atributo qualquer: `previsaoViagens` é a primeira fonte, não a arquitetura.
 *
 * ---------------------------------------------------------------------------
 * Previsão não é medição, e o número sai dizendo qual dos dois é
 * ---------------------------------------------------------------------------
 * `previsaoViagens` é uma **previsão**. Multiplicar uma taxa por ela produz um
 * montante projetado, não apurado, e as duas coisas não podem sair da mesma
 * torneira sem etiqueta — é a mesma disciplina de `dre/normalizacao.ts`, onde
 * uma projeção linear carrega `PROJECAO_LINEAR` até a tela.
 *
 * Por isso a natureza da quantidade é campo da declaração e acompanha o
 * resultado. Quem trocar a previsão por viagens realizadas troca a natureza
 * junto, e todo número derivado passa a dizer que foi apurado — sem que uma
 * linha de cálculo mude.
 *
 * ---------------------------------------------------------------------------
 * O que este módulo **não** faz
 * ---------------------------------------------------------------------------
 * Não lê banco, não conhece vigência, não decide se o componente entra no total
 * — o portão continua em `composition/motor.ts`, e continua exigindo semântica
 * confirmada antes de qualquer conta. Este módulo responde uma pergunta só:
 * *dada esta taxa, esta declaração e esta quantidade, qual é o montante, e o que
 * ele assume?* Entradas e saídas, sem efeito nenhum — que é o que permite
 * testá-lo sem subir Postgres.
 */

/*
  O veredito é o de `agregacao.ts`, e não um segundo com o mesmo nome.

  As duas perguntas são vizinhas — "posso somar isto?" e "isto pode ser a
  quantidade de uma base?" — e são feitas pela mesma tela, na mesma sessão de
  curadoria. Dois tipos `Veredito` com formatos ligeiramente diferentes é como
  duas listas de equipamento começam: concordando no dia em que são escritas.

  Importar daqui não custa pureza: `agregacao.ts` também não fala com o banco.
*/
import type { Veredito } from "./agregacao";

// ---------------------------------------------------------------------------
// O vocabulário
// ---------------------------------------------------------------------------

/**
 * A competência a que a quantidade se refere.
 *
 * Hoje mensal, como a DRE (`dre/normalizacao.ts`). Está aqui como tipo próprio,
 * e não como `string`, porque é ele que fecha a conta: sem dizer *de que
 * período* são as 4.200 quilometragens, o produto do multiplicando não tem
 * período nenhum, e a gaveta em que ele cai seria arbitrária.
 */
export type Competencia = "MENSAL";

/**
 * De onde vem o número da quantidade.
 *
 * `MEDIDA` — o que aconteceu: viagens realizadas, odômetro.
 * `PREVISTA` — o que se espera que aconteça: `previsaoViagens`, projeções.
 *
 * Não há terceiro estado, e a diferença não é acadêmica: um total de
 * remuneração montado sobre previsão é um orçamento, e apresentá-lo com a
 * mesma cara de um valor apurado é a classe de erro que este produto existe
 * para não cometer.
 */
export type NaturezaDaQuantidade = "MEDIDA" | "PREVISTA";

export const NATUREZAS: readonly NaturezaDaQuantidade[] = ["MEDIDA", "PREVISTA"];

/**
 * A declaração: quem entrega a quantidade de uma base, para um tipo de ativo.
 *
 * `entityType` aceita `*`, que vale para qualquer tipo. É o que permite
 * declarar uma vez "a quilometragem do mês é `odometro_mes`" sem repetir a
 * frase para cavalo, carreta e trecho — e o que permite ao trecho discordar,
 * porque a declaração específica ganha da geral (ver {@link fonteAplicavel}).
 */
export interface FonteDaQuantidade {
  /** `TRECHO`, `CAVALO`… ou `*` para qualquer tipo. */
  entityType: string;
  /** `KM`, `VIAGEM`, `PALLET` — a base, como a curadoria a nomeia. */
  base: string;
  competencia: Competencia;
  /** O atributo que carrega a quantidade, por ativo e por vigência. */
  attributeCode: string;
  natureza: NaturezaDaQuantidade;
}

/** Uma taxa observada num ativo, numa vigência. */
export interface TaxaObservada {
  attributeCode: string;
  valor: number;
  /** `BRL_KM`, `BRL_VIAGEM` — a unidade confirmada. */
  unit: string;
  /** O denominador confirmado, quando a curadoria o gravou. */
  denominator?: string | null;
}

/** O que a fonte entregou para este ativo, nesta vigência. */
export interface QuantidadeObservada {
  /** `null` quando o ativo não tem valor para o atributo declarado. */
  valor: number | null;
}

export type CodigoDeRecusa =
  /** A unidade não é uma taxa: não há base para multiplicar. */
  | "NAO_E_TAXA"
  /** Ninguém declarou quem entrega a quantidade desta base. */
  | "BASE_NAO_DECLARADA"
  /** A declaração é de outra base — multiplicar seria trocar a unidade. */
  | "BASE_DIVERGENTE"
  /** O ativo não tem valor para o atributo declarado nesta vigência. */
  | "QUANTIDADE_AUSENTE"
  /** A quantidade veio negativa: não existe base negativa. */
  | "QUANTIDADE_NEGATIVA";

export interface MontanteDerivado {
  ok: true;
  valor: number;
  /** O montante nasce na competência da quantidade. */
  periodicity: Competencia;
  /** Montante por ativo se acumula na frota — a mesma regra de sempre. */
  aggregation: "SUM";
  derivacao: Derivacao;
}

/**
 * O rastro da conta, que acompanha o número até a tela.
 *
 * Guardado inteiro, e não só o resultado, pelo mesmo motivo de
 * `dre/normalizacao.ts`: a tela precisa responder "de onde veio este valor?"
 * sem refazer nada, e a resposta inclui **o que foi assumido**.
 */
export interface Derivacao {
  taxa: number;
  unidadeDaTaxa: string;
  atributoDaTaxa: string;
  quantidade: number;
  base: string;
  competencia: Competencia;
  atributoDaQuantidade: string;
  natureza: NaturezaDaQuantidade;
  /** "0,38 × 4.200" — a aritmética, legível. */
  formula: string;
  /** A frase que a tela mostra ao abrir a linha. */
  explicacao: string;
}

export interface DerivacaoRecusada {
  ok: false;
  codigo: CodigoDeRecusa;
  explicacao: string;
}

export type ResultadoDaDerivacao = MontanteDerivado | DerivacaoRecusada;

// ---------------------------------------------------------------------------
// A base de uma taxa
// ---------------------------------------------------------------------------

const PREFIXO_DE_TAXA = "BRL_";

/**
 * Em que base esta taxa é cotada — `BRL_KM` → `KM`.
 *
 * O `denominator` da curadoria ganha do nome da unidade quando os dois existem:
 * ele é o campo que a pessoa confirmou, e a unidade é derivada dele
 * (`unidadeDeTaxa`, em `significado.ts`). Ler a unidade primeiro inverteria a
 * autoridade — e no dia em que uma unidade herdada não seguir o padrão
 * `BRL_<BASE>`, seria o campo certo que ficaria de fora.
 */
export function baseDaTaxa(taxa: {
  unit: string | null;
  denominator?: string | null;
}): string | null {
  const declarada = taxa.denominator?.trim();
  if (declarada) return declarada.toUpperCase();
  const unit = taxa.unit?.trim().toUpperCase();
  if (!unit || !unit.startsWith(PREFIXO_DE_TAXA)) return null;
  const base = unit.slice(PREFIXO_DE_TAXA.length);
  return base === "" ? null : base;
}

/**
 * A declaração que vale para este ativo e esta base.
 *
 * O específico ganha do geral, e nunca o contrário: uma frota que declarou a
 * quilometragem uma vez em `*` e depois disse que no trecho ela é outra coisa
 * está dizendo exatamente isso. Empate entre duas declarações do mesmo
 * `entityType` não é resolvido aqui — o índice único do banco impede que ele
 * exista, e escolher uma em silêncio seria esconder um estado impossível.
 */
export function fonteAplicavel(
  fontes: readonly FonteDaQuantidade[],
  pedido: { entityType: string; base: string; competencia: Competencia },
): FonteDaQuantidade | null {
  const base = pedido.base.toUpperCase();
  const candidatas = fontes.filter(
    (f) =>
      f.base.toUpperCase() === base &&
      f.competencia === pedido.competencia &&
      (f.entityType === pedido.entityType || f.entityType === "*"),
  );
  return (
    candidatas.find((f) => f.entityType === pedido.entityType) ??
    candidatas.find((f) => f.entityType === "*") ??
    null
  );
}

// ---------------------------------------------------------------------------
// A conta
// ---------------------------------------------------------------------------

const NOME_DA_BASE: Record<string, { singular: string; plural: string }> = {
  KM: { singular: "km", plural: "km" },
  VIAGEM: { singular: "viagem", plural: "viagens" },
  PALLET: { singular: "pallet", plural: "pallets" },
  LITRO: { singular: "litro", plural: "litros" },
  ENTREGA: { singular: "entrega", plural: "entregas" },
  HORA: { singular: "hora", plural: "horas" },
  EIXO: { singular: "eixo", plural: "eixos" },
  PNEU: { singular: "pneu", plural: "pneus" },
  TONELADA: { singular: "tonelada", plural: "toneladas" },
};

/** A base dita em português. Desconhecida sai em minúsculas, como veio. */
export function comoSeLeABase(base: string, quantidade = 2): string {
  const conhecida = NOME_DA_BASE[base.toUpperCase()];
  if (!conhecida) return base.toLowerCase().replace(/_/g, " ");
  return Math.abs(quantidade) === 1 ? conhecida.singular : conhecida.plural;
}

const numero = (valor: number): string =>
  valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const quantidadeEscrita = (valor: number): string =>
  Number.isInteger(valor)
    ? valor.toLocaleString("pt-BR")
    : valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/**
 * A taxa vira montante — ou a recusa, com o motivo.
 *
 * A recusa é resultado normal e frequente, exatamente como em
 * `normalizarParaCompetencia`: enquanto ninguém declarar a fonte, o componente
 * fica de fora **com o nome do que falta**, que é o estado honesto e é o que a
 * composição já mostra hoje.
 */
export function derivarMontante(entrada: {
  taxa: TaxaObservada;
  entityType: string;
  competencia: Competencia;
  fontes: readonly FonteDaQuantidade[];
  /** Como ler a quantidade do ativo, uma vez sabido qual atributo é. */
  quantidadeDe: (attributeCode: string) => QuantidadeObservada;
}): ResultadoDaDerivacao {
  const { taxa, entityType, competencia, fontes } = entrada;

  const base = baseDaTaxa(taxa);
  if (base === null) {
    return {
      ok: false,
      codigo: "NAO_E_TAXA",
      explicacao:
        `${taxa.attributeCode} está em ${taxa.unit}, que não é preço por unidade de nada. ` +
        `Só uma taxa vira montante ao ser multiplicada por uma quantidade.`,
    };
  }

  const fonte = fonteAplicavel(fontes, { entityType, base, competencia });
  if (fonte === null) {
    return {
      ok: false,
      codigo: "BASE_NAO_DECLARADA",
      explicacao:
        `${taxa.attributeCode} é R$ por ${comoSeLeABase(base, 1)}, e ninguém declarou que coluna ` +
        `entrega a quantidade de ${comoSeLeABase(base)} do mês, por ativo. Enquanto isso ` +
        `não for declarado, este componente fica fora dos totais — o número existe, ` +
        `o que falta é a base para transformá-lo em dinheiro.`,
    };
  }

  // Cinto e suspensório: `fonteAplicavel` já filtra por base. Uma divergência
  // aqui significaria que alguém montou a entrada à mão com uma fonte de outra
  // base, e multiplicar mesmo assim trocaria a unidade do resultado em silêncio.
  if (fonte.base.toUpperCase() !== base) {
    return {
      ok: false,
      codigo: "BASE_DIVERGENTE",
      explicacao:
        `A fonte declarada entrega ${comoSeLeABase(fonte.base)}, e ${taxa.attributeCode} é ` +
        `cotada por ${comoSeLeABase(base, 1)}. Multiplicar as duas daria um número sem referente.`,
    };
  }

  const { valor: quantidade } = entrada.quantidadeDe(fonte.attributeCode);
  if (quantidade === null || !Number.isFinite(quantidade)) {
    return {
      ok: false,
      codigo: "QUANTIDADE_AUSENTE",
      explicacao:
        `A quantidade de ${comoSeLeABase(base)} vem de ${fonte.attributeCode}, e este ativo ` +
        `não tem valor para essa coluna nesta vigência. Sem ela a taxa continua sendo taxa.`,
    };
  }

  if (quantidade < 0) {
    return {
      ok: false,
      codigo: "QUANTIDADE_NEGATIVA",
      explicacao:
        `${fonte.attributeCode} veio ${quantidadeEscrita(quantidade)} para este ativo. Não existe ` +
        `quantidade negativa de ${comoSeLeABase(base)}; o valor precisa ser corrigido na origem.`,
    };
  }

  const valor = Number((taxa.valor * quantidade).toFixed(2));
  const lidaComoPlural = comoSeLeABase(base, quantidade);
  const projetado = fonte.natureza === "PREVISTA";

  return {
    ok: true,
    valor,
    periodicity: competencia,
    aggregation: "SUM",
    derivacao: {
      taxa: taxa.valor,
      unidadeDaTaxa: taxa.unit,
      atributoDaTaxa: taxa.attributeCode,
      quantidade,
      base,
      competencia,
      atributoDaQuantidade: fonte.attributeCode,
      natureza: fonte.natureza,
      formula: `${numero(taxa.valor)} × ${quantidadeEscrita(quantidade)}`,
      explicacao:
        `R$ ${numero(taxa.valor)} por ${comoSeLeABase(base, 1)} × ` +
        `${quantidadeEscrita(quantidade)} ${lidaComoPlural} ${competencia === "MENSAL" ? "no mês" : ""} = ` +
        `R$ ${numero(valor)}. A quantidade vem de ${fonte.attributeCode}, ` +
        (projetado
          ? `que é uma **previsão** — o total é projetado, e não apurado.`
          : `que é quantidade medida.`),
    },
  };
}

// ---------------------------------------------------------------------------
// A declaração é possível?
// ---------------------------------------------------------------------------

const sim: Veredito = { ok: true, motivo: "" };
const nao = (motivo: string): Veredito => ({ ok: false, motivo });

/**
 * Este atributo pode ser declarado como a quantidade de uma base?
 *
 * A pergunta é feita **antes** de gravar a declaração, e existe para impedir os
 * dois estados que produziriam número sem referente:
 *
 * - **uma coluna monetária como quantidade.** `R$/km × R$` dá reais ao
 *   quadrado. É o erro mais fácil de cometer numa tela de seleção, porque as
 *   colunas de dinheiro são as que têm os nomes mais familiares;
 * - **uma coluna não numérica.** Não há o que multiplicar.
 *
 * Uma razão — km/l, percentual — também não serve: a quantidade de uma base é
 * uma contagem, não uma proporção.
 *
 * O que esta função **não** exige é que a semântica da coluna já esteja
 * confirmada. Quem exige isso é o portão, na hora de somar; exigir aqui
 * inverteria a ordem — a declaração é justamente o trabalho de curadoria que
 * antecede a confirmação do que depende dela.
 */
export function podeSerQuantidadeDaBase(atributo: {
  unit: string | null;
  isMonetary: boolean | null;
  valueKind?: string | null;
  dataType?: string | null;
}): Veredito {
  if (atributo.isMonetary === true) {
    return nao(
      "Esta coluna é monetária. Multiplicar uma taxa em R$ por um valor em R$ " +
        "daria reais ao quadrado — a quantidade da base é uma contagem, não dinheiro.",
    );
  }
  if (atributo.dataType && !["NUMERIC", "INTEGER", "MIXED", "UNKNOWN"].includes(atributo.dataType)) {
    return nao(
      `Esta coluna é ${atributo.dataType.toLowerCase()}, e não há o que multiplicar. ` +
        "A quantidade da base precisa ser um número.",
    );
  }
  if (atributo.valueKind === "RATIO" || atributo.valueKind === "RATE") {
    return nao(
      "Esta coluna é uma razão, e não uma contagem. A quantidade da base é " +
        "quantos km, quantas viagens — não uma proporção entre duas grandezas.",
    );
  }
  return sim;
}
