/**
 * O AGRUPAMENTO POR VEÍCULO — uma linha por placa, em toda rubrica de custo fixo.
 *
 * ---------------------------------------------------------------------------
 * De onde isto veio, e por que não ficou no FINAME
 * ---------------------------------------------------------------------------
 * A tabela das auditorias de custo fixo nasceu **por variável**: uma linha para
 * cada par (veículo × variável). Com catorze variáveis de FINAME a mesma placa
 * aparecia catorze vezes, espalhada por três páginas, e perguntar "o que
 * aconteceu com a QYW6D15?" era caçar as linhas dela na lista. O FINAME
 * resolveu isso agrupando por placa — e IPVA, Lucro Fixo e Impostos ficaram com
 * o defeito que ele já não tinha.
 *
 * Copiar a função para as outras três seria criar quatro definições de "o
 * estado de uma placa" livres para divergir: bastava uma delas esquecer a
 * ordem de gravidade para a mesma frota aparecer com dois estados diferentes em
 * duas telas irmãs. `deduplicacao.ts` documenta no cabeçalho quanto custaram as
 * quatro respostas para "qual foi o impacto?" — este módulo existe para não
 * repetir o padrão com "o que mudou nesta placa?".
 *
 * ---------------------------------------------------------------------------
 * O que a função faz, e as três coisas que ela se recusa a fazer
 * ---------------------------------------------------------------------------
 * Ela junta as linhas por `(placa, tipo)`, conta o que se moveu, escolhe o
 * estado e ordena. Nada além disso.
 *
 * **Não recalcula.** Diferença, variação e estado saem das linhas que o motor
 * já produziu. Uma segunda régua aqui seria a quinta resposta do produto para a
 * mesma pergunta.
 *
 * **Não soma variáveis.** A coluna de dinheiro da placa é **uma** variável — a
 * que a rubrica declara em {@link OpcoesDoAgrupamento.destaque} —, e nunca a
 * soma das monetárias. No FINAME somar parcela, juros e amortização contaria o
 * mesmo dinheiro duas vezes, porque a parcela é a soma dos outros dois; no
 * Impostos, juntar ICMS com PIS/COFINS somaria dois tributos que não se somam.
 * A recusa é a mesma dos dois lados, e por isso mora aqui.
 *
 * **Não inventa o que não está no recorte.** A placa cuja linha de destaque não
 * veio — porque não se moveu, ou porque um filtro por variável a tirou — fica
 * com `destaque` nulo, e a tela escreve `—`. Nulo aqui é "não está no recorte",
 * nunca "não mudou" e nunca R$ 0,00.
 */

import {
  chaveDoVeiculo,
  GRAVIDADE,
  type EstadoDaLinha,
  type MedidaDaVariavel,
} from "./recorte-de-rubrica";

/**
 * O mínimo que uma linha precisa ter para ser agrupada.
 *
 * É a interseção das quatro linhas de custo fixo — `LinhaDeFiname`,
 * `LinhaDeIpva`, `LinhaDeLucroFixo` e `LinhaDeImpostos` —, escrita como
 * estrutura e não como união: cada rubrica continua com os campos que só ela
 * tem (o tributo dos Impostos, o prazo do FINAME), e o agrupamento devolve a
 * linha inteira, do tipo que entrou.
 */
export interface LinhaAgrupavel {
  entityLabel: string | null;
  entityType: string;
  variavel: string;
  medida: MedidaDaVariavel;
  /** O texto do valor na ponta "De". Nulo quando não havia. */
  base: string | null;
  /** O texto do valor na ponta "Para". Nulo quando não há. */
  comparada: string | null;
  diferenca: number | null;
  variacao: number | null;
  estado: EstadoDaLinha;
}

/** A variável de dinheiro da placa, com as duas pontas já em número. */
export interface DestaqueDoVeiculo {
  base: number | null;
  comparada: number | null;
  diferenca: number | null;
  variacao: number | null;
}

/** Um veículo da tabela: a placa, o que ela moveu, e as linhas por baixo. */
export interface VeiculoDaRubrica<L extends LinhaAgrupavel> {
  entityLabel: string | null;
  entityType: string;
  /** Quantas variáveis se moveram nesta placa. */
  alteracoes: number;
  /** Quantas dessas são dinheiro — as demais são prazo, taxa, ano, data. */
  alteracoesEmDinheiro: number;
  /**
   * A variável de dinheiro que representa a placa — **uma**, e não a soma.
   *
   * Qual delas é escolha da rubrica: a parcela no FINAME, o IPVA anual no IPVA,
   * o lucro fixo próprio no Lucro Fixo, o PIS/COFINS nos Impostos. Nula quando
   * essa variável não está no recorte aberto.
   */
  destaque: DestaqueDoVeiculo | null;
  /**
   * O estado da placa — o pior entre as linhas dela, pela mesma régua da rosca.
   *
   * Quem tem conflito aparece como conflito ainda que também tenha uma variável
   * alterada: um veículo tem um estado só, e é o mais grave. Sem essa regra a
   * mesma placa apareceria em duas leituras diferentes na mesma tela, e a soma
   * das fatias passaria do total de veículos.
   */
  estado: EstadoDaLinha;
  /** As linhas desta placa, na ordem do catálogo — o que a expansão mostra. */
  linhas: L[];
}

/** O que cada rubrica precisa dizer sobre si para ser agrupada. */
export interface OpcoesDoAgrupamento {
  /**
   * As chaves de variável na ordem em que a expansão as lê.
   *
   * É a do catálogo, e não a que o motor entrega. Na ordem do motor a parcela
   * FINAME caía no meio das duas parcelas que a compõem — "Amortização, Parcela
   * FINAME, Juros" —, e quem lê soma as três e chega ao dobro do que a placa
   * custa. O catálogo começa pelo total e segue pelo que o compõe, que é a
   * leitura que a tela quer.
   *
   * O que não estiver na lista vai para o fim, na ordem do motor.
   */
  ordemDasVariaveis: readonly string[];
  /** A chave da variável de dinheiro que representa a placa. */
  destaque: string;
  /**
   * As chaves que existem para dar contexto e não contam como alteração.
   *
   * No FINAME é `veiculo` — a entrada e a saída do ativo, que explica todas as
   * outras linhas da placa em vez de ser mais uma delas. Contá-la faria uma
   * placa que só entrou na frota aparecer com "1 alteração" sem nada ter mudado.
   */
  foraDaContagem?: readonly string[];
}

const numeroDoTexto = (valor: string | null): number | null => {
  if (valor === null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

/**
 * As linhas viradas uma linha por placa.
 *
 * Duas ordens, e nenhuma é a do motor: as linhas de dentro seguem o catálogo
 * (ver {@link OpcoesDoAgrupamento.ordemDasVariaveis}), e as placas seguem o
 * dinheiro — primeiro quem moveu mais destaque em valor absoluto, depois quem
 * moveu mais variáveis, e a placa desempata. Uma ordem alfabética poria a maior
 * queda do mês na página quatro.
 */
export function agruparVeiculos<L extends LinhaAgrupavel>(
  linhas: readonly L[],
  opcoes: OpcoesDoAgrupamento,
): VeiculoDaRubrica<L>[] {
  const ordem = new Map<string, number>(
    opcoes.ordemDasVariaveis.map((chave, indice) => [chave, indice]),
  );
  const ordemDa = (l: L): number => ordem.get(l.variavel) ?? opcoes.ordemDasVariaveis.length;
  const foraDaContagem = new Set(opcoes.foraDaContagem ?? []);

  const veiculos = new Map<string, VeiculoDaRubrica<L>>();

  for (const l of linhas) {
    const chave = chaveDoVeiculo(l);
    const veiculo =
      veiculos.get(chave) ??
      ({
        entityLabel: l.entityLabel,
        entityType: l.entityType,
        alteracoes: 0,
        alteracoesEmDinheiro: 0,
        destaque: null,
        estado: l.estado,
        linhas: [],
      } as VeiculoDaRubrica<L>);

    veiculo.linhas.push(l);

    if (!foraDaContagem.has(l.variavel) && l.estado === "ALTERADO") {
      veiculo.alteracoes++;
      if (l.medida === "DINHEIRO") veiculo.alteracoesEmDinheiro++;
    }
    if (l.variavel === opcoes.destaque) {
      veiculo.destaque = {
        base: numeroDoTexto(l.base),
        comparada: numeroDoTexto(l.comparada),
        diferenca: l.diferenca,
        variacao: l.variacao,
      };
    }
    if (GRAVIDADE.indexOf(l.estado) < GRAVIDADE.indexOf(veiculo.estado)) {
      veiculo.estado = l.estado;
    }

    veiculos.set(chave, veiculo);
  }

  /* Estável de propósito: duas linhas da mesma variável mantêm a ordem do
     motor, e só as variáveis diferentes se movem. */
  for (const veiculo of veiculos.values()) {
    veiculo.linhas.sort((a, b) => ordemDa(a) - ordemDa(b));
  }

  return [...veiculos.values()].sort((a, b) => {
    const deA = Math.abs(a.destaque?.diferenca ?? 0);
    const deB = Math.abs(b.destaque?.diferenca ?? 0);
    if (deA !== deB) return deB - deA;
    if (a.alteracoes !== b.alteracoes) return b.alteracoes - a.alteracoes;
    return (a.entityLabel ?? "").localeCompare(b.entityLabel ?? "");
  });
}

/**
 * O primeiro valor não nulo de um campo de contexto, entre as linhas da placa.
 *
 * O contexto é **do veículo**, mas chega repetido em cada linha dela — e nem
 * toda linha o declara. A primeira que declara manda; nenhuma que declara, o
 * campo fica nulo. Ausência aqui não vira zero nem string vazia, pela mesma
 * razão que em toda parte: um prazo que ninguém informou não é "0 meses".
 */
export function contextoDasLinhas<L, C>(
  linhas: readonly L[],
  ler: (linha: L) => C | null,
): C | null {
  for (const l of linhas) {
    const valor = ler(l);
    if (valor !== null && valor !== undefined) return valor;
  }
  return null;
}
