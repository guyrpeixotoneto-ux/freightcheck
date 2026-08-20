import { linhaDoCadastro, type Medida } from "./catalogo";

/**
 * O QUE A PLANILHA DECLARA — a metade do cadastro que não sai do acervo.
 *
 * O resto deste módulo responde "o que o acervo da Auditoria sustenta". Este
 * arquivo responde a outra pergunta, e é ela que quem opera faz primeiro: **o
 * que a planilha desta unidade diz.** São coisas diferentes e é por isso que
 * vivem em campos diferentes até o fim — da tabela à tela, o número medido e o
 * número digitado nunca se misturam num campo só.
 *
 * A aritmética aqui é pura, como a de `medicao.ts`: normalizar o que chegou,
 * recusar o que não é número, e comparar o declarado com o que o cadastro
 * apurou. Quem vai ao banco é `planilha.ts`.
 *
 * **A regra que este arquivo protege.** Um número informado entra no cadastro
 * como `INFORMADO`, com autor e data, e nunca como `APURADO`. E onde o cadastro
 * **já chegou a um número** — medindo o acervo, ou derivando de linhas que o
 * mediram —, é esse número que continua valendo: o declarado fica ao lado, como
 * {@link Conferencia}. Não é preciosismo: a planilha de CAMAÇARI diz 56 cavalos
 * ativos e o export da mesma vigência traz 62. Deixar o digitado sobrescrever o
 * medido apagaria essa diferença, que é exatamente o achado que justifica ter as
 * duas metades no mesmo lugar. A fusão em si está em `montagem.ts`; o que mora
 * aqui é o que ela usa.
 */

/** O que uma pessoa declarou para uma linha do cadastro. */
export interface ValorDeclarado {
  valor: number;
  /**
   * De onde veio o número, nas palavras de quem digitou.
   *
   * Numa linha que o acervo não sustenta, é a única procedência que existe — e
   * é por isso que a tela a mostra no lugar da regra de medição, em vez de
   * escondê-la atrás de um ícone.
   */
  observacao: string | null;
  /** Quem informou, pelo nome. Nulo quando a conta não pôde ser identificada. */
  autor: string | null;
  /** Quando, em ISO-8601. */
  informadoEm: string;
}

/** A planilha de uma vigência: o que foi declarado, por chave do catálogo. */
export type PlanilhaDeclarada = ReadonlyMap<string, ValorDeclarado>;

/**
 * O acervo e a planilha respondendo a mesma linha — e o que os separa.
 *
 * Existe só quando os dois respondem. Uma linha que só o acervo sustenta não
 * tem o que conferir, e uma que só a planilha declara também não: conferir é
 * ter duas medidas independentes da mesma coisa.
 */
export interface Conferencia {
  /**
   * O número a que o **cadastro** chegou sem a planilha: medido no acervo, ou
   * derivado de linhas que o foram.
   *
   * "Cadastro" e não "medido" porque nem sempre é medida direta. `Total Custo
   * Frota Fixa sem imposto` é a soma de seis linhas, e `% de Impostos fora do
   * Município` é aritmética sobre as alíquotas: conferir o total impresso na
   * aba contra a soma das parcelas da própria aba é uma das conferências mais
   * úteis que este cadastro faz, e ela não envolve medida nenhuma.
   */
  cadastro: number;
  /** O número que a planilha declara. */
  planilha: number;
  /** Planilha menos cadastro. Positivo = a aba diz mais do que o cadastro. */
  diferenca: number;
  /** Nulo quando o do cadastro é zero — dividir por zero não é "infinito%". */
  percentual: number | null;
  /** Se os dois batem, dentro da tolerância da medida. */
  bate: boolean;
}

/**
 * A tolerância de cada medida, e por que ela não é uma só.
 *
 * Dinheiro fecha no centavo: um real de diferença numa parcela por veículo,
 * multiplicado por 56 veículos e duas quinzenas, é a ordem de grandeza das
 * divergências que este produto existe para achar. Percentual fecha em um
 * décimo de milésimo de ponto, que é a precisão com que `medicao.ts` arredonda
 * — abaixo disso a diferença é resíduo de arredondamento, não desacordo.
 * Quantidade é inteira e não tem tolerância nenhuma: 56 cavalos e 57 cavalos
 * são números diferentes, e chamá-los de iguais seria calar a única linha do
 * cadastro em que a divergência se conta na mão.
 */
const TOLERANCIA: Record<Medida, number> = {
  DINHEIRO: 0.005,
  PERCENTUAL: 0.00005,
  QUANTIDADE: 0,
};

/** Quantas casas cada medida guarda — as mesmas de `medicao.ts`. */
const CASAS: Record<Medida, number> = {
  DINHEIRO: 2,
  PERCENTUAL: 4,
  QUANTIDADE: 0,
};

function arredondar(valor: number, casas: number): number {
  const fator = 10 ** casas;
  return Math.round((valor + Number.EPSILON) * fator) / fator;
}

/**
 * O que a planilha declara contra o que o cadastro apurou.
 *
 * `bate` compara pela tolerância da medida, e não por igualdade exata: os dois
 * lados chegam arredondados de lugares diferentes — um de uma soma sobre
 * milhares de trechos, o outro de uma célula de Excel — e exigir bit a bit
 * marcaria como divergência o que é resíduo do último dígito.
 */
export function conferir(cadastro: number, planilha: number, medida: Medida): Conferencia {
  const diferenca = arredondar(planilha - cadastro, CASAS[medida] + 2);
  return {
    cadastro,
    planilha,
    diferenca,
    percentual: cadastro === 0 ? null : arredondar((diferenca / Math.abs(cadastro)) * 100, 2),
    bate: Math.abs(diferenca) <= TOLERANCIA[medida],
  };
}

/** Erro de recusa: o que chegou não é planilha. Rota traduz em 400. */
export class LinhaDaPlanilhaInvalida extends Error {
  constructor(
    readonly chave: string,
    motivo: string,
  ) {
    super(motivo);
    this.name = "LinhaDaPlanilhaInvalida";
  }
}

/** Uma célula recebida da tela, já conferida contra o catálogo. */
export interface CelulaDaPlanilha {
  chave: string;
  /** `null` apaga a célula — é o desfazer de quem digitou no campo errado. */
  valor: number | null;
  observacao: string | null;
}

/**
 * O que chegou da tela, conferido contra o catálogo — ou a recusa escrita.
 *
 * Três recusas, e nenhuma delas é "corrigir em silêncio":
 *
 * 1. **Chave que o catálogo não tem.** Gravar uma linha que a tela nunca vai
 *    ler é criar dado órfão; e uma chave errada costuma ser um cliente
 *    desatualizado, que precisa saber disso.
 * 2. **Valor que não é número finito.** `NaN` gravado num `numeric` vira uma
 *    linha que derruba toda leitura seguinte da unidade.
 * 3. **Percentual acima de 100 ou negativo, quantidade fracionária ou
 *    negativa.** São impossíveis pelo que a linha mede, e o erro que as produz
 *    é sempre o mesmo — a fração `0,059` digitada onde a aba pede `5,90`, ou o
 *    sinal invertido de uma cópia. Aceitá-las produziria um gross-up com
 *    divisor errado sem que nada na tela indicasse a origem.
 *
 * Dinheiro negativo **passa**: um desconto lançado como parcela negativa é
 * legítimo na aba, e recusá-lo obrigaria a inventar um sinal fora do produto.
 */
export function conferirCelula(entrada: {
  chave: unknown;
  valor: unknown;
  observacao?: unknown;
}): CelulaDaPlanilha {
  const chave = typeof entrada.chave === "string" ? entrada.chave.trim() : "";
  const linha = chave === "" ? undefined : linhaDoCadastro(chave);
  if (!linha) {
    throw new LinhaDaPlanilhaInvalida(
      chave,
      `"${chave}" não é uma linha do cadastro. As chaves válidas são as do catálogo da ` +
        "planilha — a tela as manda junto com cada linha que desenha.",
    );
  }

  const observacao =
    typeof entrada.observacao === "string" && entrada.observacao.trim() !== ""
      ? entrada.observacao.trim()
      : null;

  if (entrada.valor === null || entrada.valor === undefined || entrada.valor === "") {
    return { chave, valor: null, observacao: null };
  }

  const valor = typeof entrada.valor === "number" ? entrada.valor : Number(entrada.valor);
  if (!Number.isFinite(valor)) {
    throw new LinhaDaPlanilhaInvalida(
      chave,
      `"${linha.rotulo}" recebeu um valor que não é número. Para deixar a linha em branco, ` +
        "mande `null` — apagar é um gesto, e ele existe.",
    );
  }

  if (linha.medida === "PERCENTUAL" && (valor < 0 || valor > 100)) {
    throw new LinhaDaPlanilhaInvalida(
      chave,
      `"${linha.rotulo}" é um percentual e recebeu ${valor}. A aba escreve o percentual em ` +
        "pontos — `5,90` para cinco vírgula nove por cento, não `0,059`.",
    );
  }

  if (linha.medida === "QUANTIDADE" && (!Number.isInteger(valor) || valor < 0)) {
    throw new LinhaDaPlanilhaInvalida(
      chave,
      `"${linha.rotulo}" conta veículos ou rotas e recebeu ${valor}. Uma contagem é inteira e ` +
        "não é negativa.",
    );
  }

  return { chave, valor: arredondar(valor, CASAS[linha.medida]), observacao };
}
