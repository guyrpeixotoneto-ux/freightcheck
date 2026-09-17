/**
 * A PESQUISA DE MERCADO — a cadeia inteira, numa função.
 *
 *   REMUNERAÇÃO → ITEM → ESPECIFICAÇÃO → MERCADO → COTAÇÕES →
 *   NORMALIZAÇÃO → PREÇO-ALVO → ECONOMIA/MARGEM → EVIDÊNCIAS
 *
 * Este arquivo é o trecho do meio dessa cadeia: da especificação às evidências.
 * As pontas ficam onde já estavam — a remuneração vem de `agente/base.ts`, e a
 * margem contra ela é conta de `motor.ts`. Aqui não há segundo caminho para
 * nenhuma das duas.
 *
 * **Um único passo desta função passa por modelo de linguagem**: a busca, que é
 * uma porta (`busca.ts`). Tudo o que vem depois dela — conferência, match,
 * normalização, estatística, faixa-alvo, confiança — é código, e é por isso que
 * a suíte consegue provar a cadeia inteira contra páginas escritas à mão.
 *
 * **Economia e margem não se misturam**, e a separação está nos tipos:
 * {@link Economia} compara o que se paga com o que se deveria pagar;
 * {@link MargemDeMercado} compara o que se paga com o que a Ambev remunera. São
 * perguntas diferentes, com respostas que podem ter sinais opostos — comprar
 * melhor que antes e ainda assim acima da remuneração é o caso normal num item
 * mal remunerado, e um número só esconderia isso.
 */

import { especificarCompra, type EspecificacaoDeCompra } from "./especificacao";
import type { OfertaCapturada } from "./oferta";
import {
  conferirOfertas,
  type Descarte,
  type PaginaBaixada,
} from "./verificacao";
import { classificar, PESO_DO_MATCH, type Match } from "./match";
import { custoComparavel, type CustoComparavel } from "./normalizacao";
import { lerMercado, type LeituraDeMercado } from "./estatistica";
import {
  derivarPrecoAlvo,
  temFaixa,
  type FaixaAlvo,
  type SemAlvoDeMercado,
} from "./preco-alvo";
import { avaliarConfianca, type AvaliacaoDeConfianca } from "./confianca";
import {
  frescorDe,
  frescorDoConjunto,
  aindaServe,
  type Frescor,
} from "./frescor";
import { tentouInstruir } from "./saneamento";
import type { BuscaDeMercado } from "./busca";

/** Uma oferta depois de conferida, classificada e normalizada. */
export interface OfertaAnalisada {
  oferta: OfertaCapturada;
  match: Match;
  custo: CustoComparavel;
  frescor: Frescor;
  /** Verdadeiro quando esta oferta entrou nas contas de mercado. */
  entrouNaConta: boolean;
  /** Por que ficou de fora, quando ficou. */
  foraPorque: string | null;
  /** Verdadeiro quando a página tentou dar instruções ao agente. */
  fonteDuvidosa: boolean;
}

/** O que se paga hoje contra o que se deveria pagar. */
export interface Economia {
  /** O que se paga hoje, por unidade. */
  precoAtual: number;
  /** A ponta da faixa-alvo usada como referência — o teto, que é o realizável. */
  precoRecomendado: number;
  economiaUnitaria: number;
  quantidade: number | null;
  economiaTotal: number | null;
}

/** O que a Ambev remunera contra o que a compra custa. */
export interface MargemDeMercado {
  /** O valor econômico por unidade que o motor calculou sobre a remuneração. */
  remuneracaoUnitaria: number;
  /** O melhor custo total comparável encontrado. */
  custoDeCompra: number;
  margemUnitaria: number;
  quantidade: number | null;
  margemTotal: number | null;
}

export interface PesquisaDeMercado {
  especificacao: EspecificacaoDeCompra;
  /** Quem buscou, para a evidência dizer. */
  buscador: string;
  consultas: string[];
  /** Nulo quando a busca aconteceu. */
  indisponivel: string | null;
  /** As páginas abertas, com URL e instante de captura. */
  paginas: {
    url: string;
    titulo: string | null;
    capturadoEm: string;
    frescor: Frescor;
  }[];
  ofertas: OfertaAnalisada[];
  /** O que o extrator afirmou e a conferência recusou, com motivo. */
  descartadas: Descarte[];
  leitura: LeituraDeMercado | null;
  /** A melhor oferta que entrou na conta, pelo custo total comparável. */
  melhor: OfertaAnalisada | null;
  alvo: FaixaAlvo | SemAlvoDeMercado;
  confianca: AvaliacaoDeConfianca;
  economia: Economia | null;
  margem: MargemDeMercado | null;
  frescor: Frescor | null;
  /** O que a busca custou — e a prova de que ela chamou um modelo de verdade. */
  medicao: {
    latenciaMs: number;
    paginasBaixadas: number;
    modelo: string | null;
    tokensEntrada: number;
    tokensSaida: number;
    buscasServidor: number;
    fetchesServidor: number;
  };
  /** Erros que `web_search`/`web_fetch` devolveram sem levantar exceção. */
  errosDeFerramenta: { ferramenta: string; codigo: string }[];
}

export interface PedidoDePesquisa {
  item: string;
  descricao?: string | null;
  /** A pergunta digitada: vale para ler atributo, não para nomear o item. */
  textoLivre?: string | null;
  quantidade?: number | null;
  regiao?: string | null;
  /** O que se paga hoje, por unidade — a cotação em análise ou o contrato atual. */
  precoAtual?: number | null;
  precoHistorico?: number | null;
  /** O valor econômico por unidade, de `motor.ts`. Vira a margem. */
  remuneracaoUnitaria?: number | null;
  /** O teto econômico, de `motor.ts`. Corta a faixa-alvo. */
  tetoEconomico?: number | null;
  /** O relógio, por argumento: o frescor precisa ser testável. */
  agora?: Date;
  maximoDePaginas?: number;
}

/**
 * A pesquisa completa de um item.
 *
 * Nunca lança por causa da busca: a porta devolve `indisponivel` em vez de
 * estourar, e a pesquisa segue até o fim com zero ofertas — produzindo a recusa
 * de preço-alvo, a confiança baixa e o motivo. É o que permite ao agente
 * responder o que sabe do acervo quando o mercado não respondeu.
 */
export async function pesquisarMercado(
  busca: BuscaDeMercado,
  pedido: PedidoDePesquisa,
): Promise<PesquisaDeMercado> {
  const agora = pedido.agora ?? new Date();
  const especificacao = especificarCompra({
    item: pedido.item,
    descricao: pedido.descricao ?? null,
    textoLivre: pedido.textoLivre ?? null,
    quantidade: pedido.quantidade ?? null,
    regiao: pedido.regiao ?? null,
  });

  const resultado = await busca.buscar(especificacao, {
    ...(pedido.maximoDePaginas !== undefined
      ? { maximoDePaginas: pedido.maximoDePaginas }
      : {}),
  });

  const { aceitas, descartadas } = conferirOfertas(
    resultado.ofertas,
    resultado.paginas,
  );
  const duvidosas = new Set(
    resultado.paginas.filter((p) => tentouInstruir(p.texto)).map((p) => p.url),
  );

  const ofertas: OfertaAnalisada[] = aceitas.map((oferta) => {
    const match = classificar(especificacao, oferta);
    const custo = custoComparavel(oferta, pedido.quantidade ?? null);
    const frescor = frescorDe(oferta.proveniencia.capturadoEm, agora);
    const fora = motivoDeExclusao(match, custo, frescor);

    return {
      oferta,
      match,
      custo,
      frescor,
      entrouNaConta: fora === null,
      foraPorque: fora,
      fonteDuvidosa: duvidosas.has(oferta.proveniencia.url),
    };
  });

  const naConta = ofertas.filter((o) => o.entrouNaConta);
  const custos = naConta
    .map((o) => o.custo.custoTotal)
    .filter((c): c is number => c !== null);

  const leitura = lerMercado(custos);
  const melhor =
    naConta.length === 0
      ? null
      : naConta.reduce((a, b) => {
          /* Empate de custo decide pelo match: exato antes de compatível. */
          const ca = a.custo.custoTotal ?? Number.POSITIVE_INFINITY;
          const cb = b.custo.custoTotal ?? Number.POSITIVE_INFINITY;
          if (ca !== cb) return ca < cb ? a : b;
          return PESO_DO_MATCH[a.match.classe] >= PESO_DO_MATCH[b.match.classe]
            ? a
            : b;
        });

  const alvo = derivarPrecoAlvo({
    custosConfiaveis: custos,
    mediana: leitura?.mediana ?? null,
    precoAtual: pedido.precoAtual ?? null,
    precoHistorico: pedido.precoHistorico ?? null,
    tetoEconomico: pedido.tetoEconomico ?? null,
  });

  const frescor = frescorDoConjunto(
    ofertas.map((o) => o.oferta.proveniencia.capturadoEm),
    agora,
  );

  const confianca = avaliarConfianca({
    comparaveis: naConta.length,
    exatas: naConta.filter((o) => o.match.classe === "EXATO").length,
    fontesDistintas: new Set(naConta.map((o) => o.oferta.proveniencia.fonte))
      .size,
    comFrete: naConta.filter((o) => o.custo.completo).length,
    comDisponibilidade: naConta.filter((o) => o.oferta.disponibilidade !== null)
      .length,
    dispersao: leitura?.dispersao ?? 0,
    frescor,
    fontesQueTentaramInstruir: duvidosas.size,
  });

  return {
    especificacao,
    buscador: busca.nome,
    consultas: resultado.consultas,
    indisponivel: resultado.indisponivel,
    paginas: resultado.paginas.map((p) => ({
      url: p.url,
      titulo: p.titulo,
      capturadoEm: p.capturadoEm,
      frescor: frescorDe(p.capturadoEm, agora),
    })),
    ofertas,
    descartadas,
    leitura,
    melhor,
    alvo,
    confianca,
    economia: calcularEconomia(alvo, pedido),
    margem: calcularMargem(melhor, pedido),
    frescor,
    medicao: resultado.medicao,
    errosDeFerramenta: resultado.errosDeFerramenta,
  };
}

/**
 * Por que uma oferta fica de fora das contas.
 *
 * Quatro motivos, e os quatro são de comparabilidade, não de preço. A oferta
 * excluída **continua na lista**, marcada: sumir com ela faria alguém procurar
 * de novo a mesma oferta barata que já tinha sido descartada, e desta vez sem
 * saber por quê.
 */
function motivoDeExclusao(
  match: Match,
  custo: CustoComparavel,
  frescor: Frescor,
): string | null {
  if (!match.comparavel) return `Fora da conta: ${match.porque}`;
  if (custo.custoTotal === null) return `Fora da conta: ${custo.conta}`;
  if (custo.abaixoDoMinimo) {
    return "Fora da conta: o pedido não alcança a quantidade mínima deste fornecedor.";
  }
  if (!aindaServe(frescor)) {
    return "Fora da conta: a captura tem mais de uma semana e não serve como preço de hoje.";
  }
  return null;
}

/**
 * A economia — o que se paga hoje contra o que se deveria pagar.
 *
 * Usa o **teto** da faixa-alvo, e não o piso: o piso é a ambição e o teto é o
 * realizável, e uma economia anunciada sobre a ambição é uma promessa que a
 * negociação não sustenta. Sem preço atual não há economia — só há faixa-alvo,
 * que é outra coisa.
 */
function calcularEconomia(
  alvo: FaixaAlvo | SemAlvoDeMercado,
  pedido: PedidoDePesquisa,
): Economia | null {
  if (!temFaixa(alvo)) return null;
  const atual = pedido.precoAtual ?? null;
  if (atual === null || atual <= 0) return null;

  const economiaUnitaria = atual - alvo.teto;
  const quantidade = pedido.quantidade ?? null;

  return {
    precoAtual: atual,
    precoRecomendado: alvo.teto,
    economiaUnitaria,
    quantidade,
    economiaTotal: quantidade !== null ? economiaUnitaria * quantidade : null,
  };
}

/**
 * A margem — o que a Ambev remunera contra o que a compra custa.
 *
 * Mede contra o **melhor custo comparável encontrado**, e não contra o preço
 * atual: a pergunta é quanto sobra se a compra for feita bem, e é essa a
 * decisão que o comprador tem na mão. A margem sobre o preço que já se paga
 * continua existindo e é a do motor econômico, na análise do item.
 */
function calcularMargem(
  melhor: OfertaAnalisada | null,
  pedido: PedidoDePesquisa,
): MargemDeMercado | null {
  const remuneracao = pedido.remuneracaoUnitaria ?? null;
  const custo = melhor?.custo.custoTotal ?? null;
  if (remuneracao === null || remuneracao <= 0 || custo === null) return null;

  const margemUnitaria = remuneracao - custo;
  const quantidade = pedido.quantidade ?? null;

  return {
    remuneracaoUnitaria: remuneracao,
    custoDeCompra: custo,
    margemUnitaria,
    quantidade,
    margemTotal: quantidade !== null ? margemUnitaria * quantidade : null,
  };
}
