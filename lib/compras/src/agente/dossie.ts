/**
 * O DOSSIÊ — tudo o que a resposta pode dizer, fechado antes de ela ser escrita.
 *
 * É aqui que as três metades se encontram: o **acervo** (o que a Ambev
 * remunera), o **motor econômico** (o preço-alvo e o teto) e a **carteira** (as
 * cotações que quem compra digitou). O resultado é um objeto com números — e
 * nenhum texto de resposta.
 *
 * **A ordem importa, e ela é a regra central do Agente de Compras.** Nada
 * abaixo passa por modelo de linguagem: quando a redação chegar (`redacao.ts`),
 * ela recebe este dossiê fechado e a tarefa dela é explicá-lo. O modelo não
 * escolhe o item, não busca a remuneração, não calcula o teto e não decide o
 * veredito. *O sistema calcula; a IA interpreta.*
 *
 * O dossiê é o que vai junto para a tela, e é por isso que ele carrega a
 * procedência de cada número (`dados`), o que faltou (`lacunas`) e os atalhos
 * até a origem (`atalhos`): quem discordar do texto compara um com o outro.
 */

import type { Database } from "@workspace/db";
import {
  produtoDe,
  type EscopoDaConsulta,
  type ProdutoDeCompra,
} from "../catalogo";
import {
  avaliarCompra,
  politicaDe,
  type AvaliacaoDeCompra,
  type PoliticaDeCompra,
  type PremissasDaCompra,
} from "../motor";
import {
  listarCotacoes,
  premissasConfiguradas,
  type Cotacao,
  type PremissaDoItem,
} from "../cotacoes";
import { baseDoItem, type BaseDoItem } from "./base";
import {
  atalhoDaCotacao,
  atalhoDoFornecedor,
  atalhosDoItem,
  type Atalho,
} from "./navegacao";

export interface RecorteDaConsulta {
  period?: string | undefined;
  context?: EscopoDaConsulta | undefined;
  operacao?: string | null;
}

/** O que o agente apurou sobre **um** item. */
export interface AnaliseDoItem {
  produto: ProdutoDeCompra;
  leitura: BaseDoItem;
  avaliacao: AvaliacaoDeCompra;
  /** As cotações registradas para este item, da mais recente para a mais antiga. */
  cotacoes: CotacaoAvaliada[];
  /** De onde vieram as premissas usadas — configurada, informada ou estimada. */
  premissaConfigurada: PremissaDoItem | null;
  atalhos: Atalho[];
}

/** Uma cotação com o veredito do motor sobre ela. */
export interface CotacaoAvaliada {
  cotacao: Cotacao;
  avaliacao: AvaliacaoDeCompra;
  atalhos: Atalho[];
}

/**
 * As premissas que valem para um item, e de onde cada uma veio.
 *
 * Três camadas, e a de cima vence: o que a pergunta informou, o que a operação
 * configurou (`compra_premissa`), e o que o catálogo estima. A do meio é a que
 * faz a confiabilidade subir de BAIXA para ALTA sem ninguém tocar em código —
 * ver o cabeçalho de `cotacoes.ts`.
 */
export function premissasDoItem(
  informadas: PremissasDaCompra,
  configurada: PremissaDoItem | null,
): PremissasDaCompra {
  const vidaDaCasa =
    informadas.vidaUtilMeses == null && configurada?.vidaUtilMeses != null;
  const unidadesDaCasa =
    informadas.unidadesPorAtivo == null &&
    configurada?.unidadesPorAtivo != null;

  /*
    A procedência viaja junto, e não é detalhe: o número configurado é tão
    confirmado quanto o digitado, mas ele não veio do pedido — veio da
    configuração da casa, com a justificativa que alguém escreveu ali. Dizer
    "informada no pedido" sobre ele seria errar no único campo cujo trabalho é
    dizer de onde o número veio.
  */
  const daConfiguracao = configurada?.justificativa
    ? `Premissa configurada para este item: ${configurada.justificativa}`
    : "Premissa configurada para este item, em Agente de Compras";

  return {
    ...informadas,
    vidaUtilMeses:
      informadas.vidaUtilMeses ?? configurada?.vidaUtilMeses ?? null,
    unidadesPorAtivo:
      informadas.unidadesPorAtivo ?? configurada?.unidadesPorAtivo ?? null,
    ...(vidaDaCasa || unidadesDaCasa
      ? {
          fonteDasPremissas: {
            ...(vidaDaCasa ? { vidaUtil: daConfiguracao } : {}),
            ...(unidadesDaCasa ? { unidades: daConfiguracao } : {}),
          },
        }
      : {}),
  };
}

/** A política que vale para um item: a pedida, a configurada, e então a da casa. */
export function politicaDoItem(
  pedida: Partial<PoliticaDeCompra> | undefined,
  configurada: PremissaDoItem | null,
): PoliticaDeCompra {
  return politicaDe({
    ...(configurada?.margemAlvo != null
      ? { margemAlvo: configurada.margemAlvo }
      : {}),
    ...(configurada?.margemMinima != null
      ? { margemMinima: configurada.margemMinima }
      : {}),
    ...(pedida ?? {}),
  });
}

export interface PedidoDeAnalise {
  chave: string;
  ownerId: string;
  placa?: string | null;
  premissas?: PremissasDaCompra;
  politica?: Partial<PoliticaDeCompra>;
  recorte?: RecorteDaConsulta;
}

/**
 * A análise completa de um item.
 *
 * Uma consulta ao acervo, uma à carteira, uma à configuração — e o motor
 * rodando uma vez para a pergunta e uma vez por cotação registrada. O motor é
 * puro e barato; o que custa são as três leituras, e elas acontecem uma vez só.
 */
export async function analisarItem(
  db: Database,
  pedido: PedidoDeAnalise,
): Promise<AnaliseDoItem | null> {
  const produto = produtoDe(pedido.chave);
  if (!produto) return null;

  const recorte = pedido.recorte ?? {};
  const [leitura, configuradas, cotacoesDoItem] = await Promise.all([
    baseDoItem(db, {
      chave: pedido.chave,
      placa: pedido.placa ?? null,
      period: recorte.period,
      context: recorte.context,
    }),
    premissasConfiguradas(db, recorte.operacao ?? null),
    listarCotacoes(db, pedido.ownerId, {
      item: pedido.chave,
      ...(recorte.operacao ? { operacao: recorte.operacao } : {}),
    }),
  ]);

  const configurada = configuradas.get(pedido.chave) ?? null;
  const premissas = premissasDoItem(pedido.premissas ?? {}, configurada);
  const politica = politicaDoItem(pedido.politica, configurada);

  const avaliacao = avaliarCompra(
    pedido.chave,
    leitura.base,
    premissas,
    politica,
  );

  const cotacoes: CotacaoAvaliada[] = cotacoesDoItem.map((cotacao) => ({
    cotacao,
    avaliacao: avaliarCompra(
      pedido.chave,
      leitura.base,
      {
        ...premissas,
        precoUnitario: cotacao.precoUnitario,
        quantidade: cotacao.quantidade ?? premissas.quantidade ?? null,
        fornecedor: cotacao.fornecedor,
      },
      politica,
    ),
    atalhos: [
      atalhoDaCotacao(cotacao.id, cotacao.fornecedor),
      atalhoDoFornecedor(cotacao.fornecedor),
    ],
  }));

  return {
    produto,
    leitura,
    avaliacao,
    cotacoes,
    premissaConfigurada: configurada,
    atalhos: atalhosDoItem(produto, {
      placa: leitura.placa,
      period: recorte.period ?? null,
    }),
  };
}

// ---------------------------------------------------------------------------
// A carteira
// ---------------------------------------------------------------------------

/**
 * Uma linha da carteira: o item, a melhor proposta dele e o que ela custa.
 *
 * "Melhor" aqui é a **mais barata entre as vivas** — aguardando ou em
 * negociação. A aprovada não concorre porque a decisão já foi tomada, e a
 * recusada não concorre porque ninguém vai comprar por ela; mantê-las na
 * disputa faria o painel anunciar uma economia que não está mais na mesa.
 */
export interface LinhaDaCarteira {
  produto: ProdutoDeCompra;
  leitura: BaseDoItem;
  melhor: CotacaoAvaliada | null;
  /** Todas as propostas vivas do item, da mais barata para a mais cara. */
  propostas: CotacaoAvaliada[];
  atalhos: Atalho[];
}

const VIVAS = new Set(["AGUARDANDO", "EM_NEGOCIACAO"]);

/**
 * A carteira inteira: um item por linha, ordenada pelo que mais pesa.
 *
 * Ordena por impacto — a diferença para o teto vezes a quantidade —, e não por
 * preço nem por nome. Quem abre esta lista quer saber onde começar, e começar
 * pelo item mais caro é começar pelo maior número, não pelo maior problema: um
 * contrato de R$ 40 mil dentro do teto não precisa de ninguém, e oitenta pneus
 * R$ 140 acima precisam de uma ligação hoje.
 *
 * Itens sem cotação viva não entram: a carteira é o que está em negociação, não
 * o catálogo. O catálogo inteiro continua a um clique, no Remunerado.
 */
export async function carteira(
  db: Database,
  ownerId: string,
  opcoes: {
    recorte?: RecorteDaConsulta;
    politica?: Partial<PoliticaDeCompra>;
    premissas?: PremissasDaCompra;
  } = {},
): Promise<LinhaDaCarteira[]> {
  const recorte = opcoes.recorte ?? {};
  const [todas, configuradas] = await Promise.all([
    listarCotacoes(db, ownerId, {
      ...(recorte.operacao ? { operacao: recorte.operacao } : {}),
    }),
    premissasConfiguradas(db, recorte.operacao ?? null),
  ]);

  const vivas = todas.filter((c) => VIVAS.has(c.situacao));
  const itens = [...new Set(vivas.map((c) => c.item))];

  const linhas: LinhaDaCarteira[] = [];
  for (const chave of itens) {
    const produto = produtoDe(chave);
    if (!produto) continue;

    const leitura = await baseDoItem(db, {
      chave,
      period: recorte.period,
      context: recorte.context,
    });
    const configurada = configuradas.get(chave) ?? null;
    const premissas = premissasDoItem(opcoes.premissas ?? {}, configurada);
    const politica = politicaDoItem(opcoes.politica, configurada);

    const propostas: CotacaoAvaliada[] = vivas
      .filter((c) => c.item === chave)
      .map((cotacao) => ({
        cotacao,
        avaliacao: avaliarCompra(
          chave,
          leitura.base,
          {
            ...premissas,
            precoUnitario: cotacao.precoUnitario,
            quantidade: cotacao.quantidade ?? premissas.quantidade ?? null,
            fornecedor: cotacao.fornecedor,
          },
          politica,
        ),
        atalhos: [
          atalhoDaCotacao(cotacao.id, cotacao.fornecedor),
          atalhoDoFornecedor(cotacao.fornecedor),
        ],
      }))
      .sort((a, b) => a.cotacao.precoUnitario - b.cotacao.precoUnitario);

    linhas.push({
      produto,
      leitura,
      melhor: propostas[0] ?? null,
      propostas,
      atalhos: atalhosDoItem(produto, { period: recorte.period ?? null }),
    });
  }

  /*
    Sem impacto calculável a linha vai para o fim, e não para o começo: ela é a
    que o motor não conseguiu avaliar, e uma lista de prioridades encabeçada
    pelo que não se sabe medir manda começar pelo que não se pode decidir.
  */
  return linhas.sort(
    (a, b) =>
      (b.melhor?.avaliacao.impactoPelaQuantidade ?? Number.NEGATIVE_INFINITY) -
      (a.melhor?.avaliacao.impactoPelaQuantidade ?? Number.NEGATIVE_INFINITY),
  );
}

// ---------------------------------------------------------------------------
// Fornecedores
// ---------------------------------------------------------------------------

/** Como um fornecedor se sai, somando o que ele cotou. */
export interface DesempenhoDoFornecedor {
  fornecedor: string;
  propostas: number;
  /** Quantas caem no alvo, quantas entre alvo e teto, quantas acima. */
  noAlvo: number;
  dentroDoTeto: number;
  acimaDoTeto: number;
  /** A média das margens percentuais das propostas avaliáveis. Nula sem nenhuma. */
  margemMedia: number | null;
  /** O quanto as propostas dele estouram o teto, somado. */
  impactoTotal: number;
  atalho: Atalho;
}

/**
 * O ranking de fornecedores — contado sobre as avaliações, não opinado.
 *
 * Ordena por margem média, do melhor para o pior, e o fornecedor sem nenhuma
 * proposta avaliável vai para o fim: sem preço-alvo não há como dizer se ele é
 * competitivo, e classificá-lo no meio da lista afirmaria justamente isso.
 *
 * **Não é uma nota de fornecedor.** É o que as propostas registradas neste
 * acervo dizem, e este acervo não conhece prazo de entrega, qualidade,
 * histórico de atraso nem capacidade. A resposta diz isso por extenso — um
 * ranking que se apresenta como completo seria pior do que ranking nenhum.
 */
export function porFornecedor(
  linhas: LinhaDaCarteira[],
): DesempenhoDoFornecedor[] {
  const mapa = new Map<
    string,
    DesempenhoDoFornecedor & { somaMargem: number; comMargem: number }
  >();

  for (const linha of linhas) {
    for (const proposta of linha.propostas) {
      const nome = proposta.cotacao.fornecedor;
      const atual = mapa.get(nome) ?? {
        fornecedor: nome,
        propostas: 0,
        noAlvo: 0,
        dentroDoTeto: 0,
        acimaDoTeto: 0,
        margemMedia: null,
        impactoTotal: 0,
        atalho: atalhoDoFornecedor(nome),
        somaMargem: 0,
        comMargem: 0,
      };

      atual.propostas += 1;
      if (proposta.avaliacao.veredito === "NO_ALVO") atual.noAlvo += 1;
      if (proposta.avaliacao.veredito === "ENTRE_ALVO_E_TETO")
        atual.dentroDoTeto += 1;
      if (proposta.avaliacao.veredito === "ACIMA_DO_TETO")
        atual.acimaDoTeto += 1;
      if (proposta.avaliacao.margemPercentual !== null) {
        atual.somaMargem += proposta.avaliacao.margemPercentual;
        atual.comMargem += 1;
      }
      const impacto = proposta.avaliacao.impactoPelaQuantidade;
      if (impacto !== null && impacto > 0) atual.impactoTotal += impacto;

      mapa.set(nome, atual);
    }
  }

  return [...mapa.values()]
    .map((f) => ({
      fornecedor: f.fornecedor,
      propostas: f.propostas,
      noAlvo: f.noAlvo,
      dentroDoTeto: f.dentroDoTeto,
      acimaDoTeto: f.acimaDoTeto,
      margemMedia: f.comMargem > 0 ? f.somaMargem / f.comMargem : null,
      impactoTotal: f.impactoTotal,
      atalho: f.atalho,
    }))
    .sort(
      (a, b) =>
        (b.margemMedia ?? Number.NEGATIVE_INFINITY) -
        (a.margemMedia ?? Number.NEGATIVE_INFINITY),
    );
}
