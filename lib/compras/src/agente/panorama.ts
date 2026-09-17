/**
 * A VISÃO EXECUTIVA do Agente de Compras — seis números, e nenhum estimado.
 *
 * Os indicadores da tela de entrada. Todos saem da carteira já avaliada
 * (`dossie.ts`), o que é o mesmo que dizer: eles são a soma das mesmas
 * avaliações que a resposta do chat mostra uma a uma. Não há segunda conta, e é
 * de propósito — um painel que some por um caminho e o chat que responda por
 * outro é o defeito clássico desta classe de tela, e ele aparece como um
 * "economia potencial: R$ 120 mil" que nenhuma das linhas abaixo explica.
 *
 * **Todo indicador pode ser nulo, e nulo não é zero.** "Economia potencial: R$
 * 0,00" diz que não há economia a capturar; nulo diz que não deu para calcular
 * — não há cotação, ou o acervo não traz o remunerado do item. As duas frases
 * pedem ações opostas, e o painel precisa poder dizer qual delas é.
 */

import type { Database } from "@workspace/db";
import { listarCotacoes, type Cotacao } from "../cotacoes";
import { carteira, type LinhaDaCarteira, type RecorteDaConsulta } from "./dossie";
import type { PoliticaDeCompra } from "../motor";
import type { Atalho } from "./navegacao";

/** Um número do painel, com a frase que o explica e o que fazer com ele. */
export interface Indicador {
  chave: string;
  rotulo: string;
  /** Nulo quando não houve como calcular. A tela mostra o `porque` no lugar. */
  valor: number | null;
  /** BRL, percentual, contagem — como a tela deve escrever o número. */
  formato: "BRL" | "PERCENTUAL" | "CONTAGEM";
  /** Por que o número é esse, ou por que ele não existe. */
  porque: string;
  /** Para onde ir a partir dele, quando há para onde. */
  atalho: Atalho | null;
}

export interface PanoramaDeCompras {
  indicadores: Indicador[];
  /** A carteira que produziu os indicadores, para a tela listar sem reconsultar. */
  linhas: LinhaDaCarteira[];
  /** A política usada, para a tela poder escrever "configurado". */
  politica: PoliticaDeCompra | null;
  /** Quantas cotações existem ao todo, incluindo as já decididas. */
  cotacoes: number;
  vigencia: string | null;
}

/**
 * O painel inteiro, de uma varredura só da carteira.
 *
 * A carteira é a fonte dos cinco primeiros indicadores; o sexto — as cotações à
 * espera — vem da lista completa, porque uma cotação aguardando análise de um
 * item cujo remunerado o acervo não traz **continua esperando análise**. Contá-la
 * só quando o motor consegue avaliá-la esconderia exatamente as que mais
 * precisam de gente.
 */
export async function panoramaDeCompras(
  db: Database,
  ownerId: string,
  opcoes: { recorte?: RecorteDaConsulta; politica?: Partial<PoliticaDeCompra> } = {},
): Promise<PanoramaDeCompras> {
  const recorte = opcoes.recorte ?? {};
  const [linhas, todas] = await Promise.all([
    carteira(db, ownerId, {
      recorte,
      ...(opcoes.politica ? { politica: opcoes.politica } : {}),
    }),
    listarCotacoes(db, ownerId, {
      ...(recorte.operacao ? { operacao: recorte.operacao } : {}),
    }),
  ]);

  const melhores = linhas.map((l) => l.melhor).filter((m): m is NonNullable<typeof m> => m !== null);
  const avaliadas = melhores.filter((m) => m.avaliacao.precoAlvo !== null);

  return {
    indicadores: [
      economiaPotencial(avaliadas),
      acimaDoTeto(avaliadas),
      itensAnalisados(linhas, avaliadas.length),
      margemMedia(avaliadas),
      maiorOportunidade(linhas),
      aguardando(todas),
    ],
    linhas,
    politica: melhores[0]?.avaliacao.politica ?? null,
    cotacoes: todas.length,
    vigencia: linhas[0]?.leitura.base.vigencia ?? null,
  };
}

type Avaliada = NonNullable<LinhaDaCarteira["melhor"]>;

/**
 * Quanto se deixa na mesa se toda proposta viva for aceita como está.
 *
 * Medida contra o **alvo**, e não contra o teto: é a meta de negociação, e é o
 * que um comprador pode de fato capturar ligando para o fornecedor. Contra o
 * teto o número seria menor e responderia outra pergunta — "quanto disto é
 * prejuízo", que é o indicador ao lado.
 *
 * Só conta a diferença positiva. A proposta que já está abaixo do alvo não
 * financia a que está acima: somá-las com sinal produziria uma "economia
 * potencial" que cai quando se consegue um bom preço em outro item.
 */
function economiaPotencial(avaliadas: Avaliada[]): Indicador {
  const comConta = avaliadas.filter(
    (a) => a.avaliacao.diferencaParaAlvo !== null && a.cotacao.quantidade !== null,
  );
  if (comConta.length === 0) {
    return {
      chave: "economia-potencial",
      rotulo: "Economia potencial",
      valor: null,
      formato: "BRL",
      porque:
        "Nenhuma proposta viva tem, ao mesmo tempo, preço-alvo calculado e quantidade informada.",
      atalho: null,
    };
  }

  const total = comConta.reduce(
    (soma, a) => soma + Math.max(0, a.avaliacao.diferencaParaAlvo!) * a.cotacao.quantidade!,
    0,
  );
  return {
    chave: "economia-potencial",
    rotulo: "Economia potencial",
    valor: total,
    formato: "BRL",
    porque: `O que separa ${comConta.length} proposta(s) viva(s) da meta de negociação, pela quantidade de cada pedido.`,
    atalho: null,
  };
}

/**
 * Quantas propostas vivas passam do teto — e, portanto, consomem remuneração.
 *
 * **Zero sem nenhuma avaliação não é zero: é nulo.** Uma carteira em que nenhum
 * item tem preço-alvo devolvia "Compras acima do teto: 0", que é a leitura mais
 * tranquilizadora possível de um painel que não conseguiu calcular nada. O
 * cartão vazio, com a frase ao lado, é a resposta verdadeira.
 */
function acimaDoTeto(avaliadas: Avaliada[]): Indicador {
  if (avaliadas.length === 0) {
    return {
      chave: "acima-do-teto",
      rotulo: "Compras acima do teto",
      valor: null,
      formato: "CONTAGEM",
      porque:
        "Nenhuma proposta viva tem preço-alvo calculável nesta vigência — sem teto não há " +
        "como dizer quantas passam dele.",
      atalho: null,
    };
  }

  const fora = avaliadas.filter((a) => a.avaliacao.veredito === "ACIMA_DO_TETO");
  return {
    chave: "acima-do-teto",
    rotulo: "Compras acima do teto",
    valor: fora.length,
    formato: "CONTAGEM",
    porque:
      fora.length === 0
        ? `Nenhuma das ${avaliadas.length} proposta(s) avaliáveis passa do limite econômico configurado.`
        : `${fora.length} de ${avaliadas.length} proposta(s) avaliáveis passam do limite econômico configurado.`,
    atalho: null,
  };
}

/**
 * Quantos itens o agente conseguiu avaliar — e quantos ficaram sem conta.
 *
 * O denominador aparece na frase porque é ele que diz se o painel está
 * respondendo sobre a carteira ou sobre um pedaço dela.
 */
function itensAnalisados(linhas: LinhaDaCarteira[], comAlvo: number): Indicador {
  return {
    chave: "itens-analisados",
    rotulo: "Itens analisados",
    valor: linhas.length,
    formato: "CONTAGEM",
    porque:
      linhas.length === 0
        ? "Nenhuma cotação viva registrada — registre uma proposta para o painel começar a responder."
        : `${comAlvo} de ${linhas.length} item(ns) têm preço-alvo calculável nesta vigência.`,
    atalho: null,
  };
}

/** A margem média entre o valor econômico e o preço das propostas vivas. */
function margemMedia(avaliadas: Avaliada[]): Indicador {
  const comMargem = avaliadas
    .map((a) => a.avaliacao.margemPercentual)
    .filter((m): m is number => m !== null);
  if (comMargem.length === 0) {
    return {
      chave: "margem-media",
      rotulo: "Margem média de compra",
      valor: null,
      formato: "PERCENTUAL",
      porque: "Nenhuma proposta viva tem valor econômico por unidade calculado.",
      atalho: null,
    };
  }
  return {
    chave: "margem-media",
    rotulo: "Margem média de compra",
    valor: comMargem.reduce((a, b) => a + b, 0) / comMargem.length,
    formato: "PERCENTUAL",
    porque: `Quanto sobra da remuneração, em média, nas ${comMargem.length} melhor(es) proposta(s) de cada item.`,
    atalho: null,
  };
}

/** O item em que uma ligação hoje vale mais dinheiro. */
function maiorOportunidade(linhas: LinhaDaCarteira[]): Indicador {
  const candidatas = linhas
    .map((l) => ({ linha: l, ganho: ganhoDaLinha(l) }))
    .filter((c): c is { linha: LinhaDaCarteira; ganho: number } => c.ganho !== null && c.ganho > 0)
    .sort((a, b) => b.ganho - a.ganho);

  const melhor = candidatas[0];
  if (!melhor) {
    return {
      chave: "maior-oportunidade",
      rotulo: "Maior oportunidade",
      valor: null,
      formato: "BRL",
      porque: "Nenhuma proposta viva está acima da meta de negociação.",
      atalho: null,
    };
  }

  return {
    chave: "maior-oportunidade",
    rotulo: "Maior oportunidade",
    valor: melhor.ganho,
    formato: "BRL",
    porque: `${melhor.linha.produto.rotulo}, com ${melhor.linha.melhor!.cotacao.fornecedor} — é por onde começar.`,
    atalho: melhor.linha.atalhos[1] ?? melhor.linha.atalhos[0] ?? null,
  };
}

function ganhoDaLinha(linha: LinhaDaCarteira): number | null {
  const melhor = linha.melhor;
  if (!melhor) return null;
  const diferenca = melhor.avaliacao.diferencaParaAlvo;
  const quantidade = melhor.cotacao.quantidade;
  if (diferenca === null || quantidade === null) return null;
  return Math.max(0, diferenca) * quantidade;
}

/** Quantas propostas esperam alguém. Conta as que o motor não soube avaliar. */
function aguardando(todas: Cotacao[]): Indicador {
  const fila = todas.filter((c) => c.situacao === "AGUARDANDO");
  return {
    chave: "aguardando",
    rotulo: "Cotações aguardando análise",
    valor: fila.length,
    formato: "CONTAGEM",
    porque:
      fila.length === 0
        ? "Nenhuma proposta na fila."
        : `${fila.length} proposta(s) registrada(s) e ainda sem decisão.`,
    atalho: null,
  };
}
