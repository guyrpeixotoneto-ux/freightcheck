/**
 * O AGENTE DE COMPRAS — o copiloto da decisão de aquisição.
 *
 * *O sistema calcula. A IA interpreta e explica.* Esta é a função que junta as
 * duas metades, e a ordem em que ela faz as coisas **é** a arquitetura:
 *
 * 1. lê a pergunta por regra — item, preço, quantidade, placa (`extracao.ts`);
 * 2. classifica a intenção por regra (`intencao.ts`);
 * 3. consulta o acervo e a carteira e roda o motor econômico (`dossie.ts`);
 * 4. escreve a resposta em código sobre o material fechado (`redacao.ts`);
 * 5. **só então** oferece o texto ao modelo, que pode reescrevê-lo melhor —
 *    e cuja versão é descartada inteira se citar um real que o dossiê não
 *    sustente (`lastro.ts`).
 *
 * Nenhum passo de 1 a 4 passa por modelo de linguagem. O passo 5 não produz
 * número: ele redige. É o que permite abrir a conta de qualquer preço-alvo até
 * a coluna do export que a sustenta, e é o que impede que a mesma pergunta,
 * feita duas vezes, volte com dois tetos.
 *
 * **Sugestões rápidas** e **atalhos de navegação** saem daqui pela mesma razão:
 * quem sabe o que a resposta citou é quem a montou.
 */

import type { Database } from "@workspace/db";
import type { EscopoDaConsulta, ProdutoDeCompra } from "../catalogo";
import { CATALOGO } from "../catalogo";
import type { PoliticaDeCompra, PremissasDaCompra } from "../motor";
import {
  analisarItem,
  carteira,
  porFornecedor,
  type AnaliseDoItem,
  type DesempenhoDoFornecedor,
  type LinhaDaCarteira,
  type RecorteDaConsulta,
} from "./dossie";
import {
  ehDeItem,
  ehDeMercado,
  intencaoDe,
  ROTULO_DA_INTENCAO,
  type Intencao,
} from "./intencao";
import {
  buscaDisponivel,
  buscaIndisponivel,
  buscaPorModelo,
  pesquisarMercado,
  temFaixa,
  type BuscaDeMercado,
  type PesquisaDeMercado,
} from "../mercado";
import { lerPergunta, itemPorChave } from "./extracao";
import {
  blocoDaAvaliacao,
  numerosDaAvaliacao,
  redigirEmCodigo,
} from "./redacao";
import { conferirLastro } from "./lastro";
import { disponivel as iaDisponivel, modeloConfigurado, redigir } from "./llm";
import type { Atalho } from "./navegacao";

export interface PerguntaAoAgente {
  pergunta: string;
  ownerId: string;
  /** O item, quando a tela já sabe qual é. Vence o que a pergunta disser. */
  item?: string | null;
  premissas?: PremissasDaCompra;
  politica?: Partial<PoliticaDeCompra>;
  recorte?: {
    period?: string;
    context?: EscopoDaConsulta;
    operacao?: string | null;
  };
  historico?: { papel: "PERGUNTA" | "RESPOSTA"; texto: string }[];
  /** Pula o modelo. A tela usa para comparar as duas redações. */
  semIa?: boolean;
  /**
   * O buscador de mercado. Omitido, usa o de verdade quando há chave.
   *
   * Entra por argumento para a suíte poder provar a cadeia inteira contra
   * páginas escritas à mão — ver `mercado/busca.ts`. Não é ponto de extensão
   * para o chamador escolher outra internet.
   */
  busca?: BuscaDeMercado;
  /** O relógio, por argumento: o frescor das cotações precisa ser testável. */
  agora?: Date;
}

/** Quem escreveu o texto que está na tela. */
export type Redator = "IA" | "DETERMINISTICA";

export interface RespostaDoAgente {
  texto: string;
  redacao: Redator;
  /** Por que não foi a IA, quando não foi. Nulo quando foi. */
  porqueDeterministica: string | null;
  intencao: Intencao;
  rotuloDaIntencao: string;
  /** O item de que a resposta fala, quando ela fala de um. */
  item: ProdutoDeCompra | null;
  analise: AnaliseDoItem | null;
  carteira: LinhaDaCarteira[];
  fornecedores: DesempenhoDoFornecedor[];
  atalhos: Atalho[];
  /** O que a extração leu da pergunta — a tela mostra para quem quiser corrigir. */
  leitura: {
    precos: number[];
    quantidade: number | null;
    placa: string | null;
  };
  lacunas: string[];
  /** A pesquisa de mercado, quando a pergunta pediu uma. Nula quando não pediu. */
  pesquisa: PesquisaDeMercado | null;
}

/**
 * O que fazer quando a pergunta é de item e nenhum item foi identificado.
 *
 * Não é um erro: é a resposta mais comum do primeiro dia de uso, e ela precisa
 * deixar a pessoa a um clique da resposta. Por isso lista os itens do catálogo
 * em vez de pedir que se reescreva a pergunta.
 */
function pedirItem(): string {
  const nomes = CATALOGO.filter((p) => p.balcao !== "QLP_OPERACIONAL")
    .map((p) => p.rotulo)
    .join(", ");
  return (
    "Não identifiquei o item da compra. Diga qual é — ou escolha na lista — e eu devolvo o " +
    `preço-alvo, o teto e a conta que os sustenta.\n\nItens que este acervo sabe responder: ${nomes}.`
  );
}

/**
 * A resposta do agente a uma pergunta.
 *
 * Nunca lança por causa do modelo: quando ele falha, recusa ou não está
 * configurado, o que sai é a redação em código — a mesma resposta, com o mesmo
 * material. O que pode lançar é o banco, e aí a rota traduz.
 */
export async function responderCompras(
  db: Database,
  pedido: PerguntaAoAgente,
): Promise<RespostaDoAgente> {
  const leitura = lerPergunta(pedido.pergunta);
  const item = itemPorChave(pedido.item) ?? leitura.item;

  /*
    O preço vem da pergunta quando a tela não o mandou. A ordem importa: o campo
    do formulário é explícito e a leitura do texto é inferência, e inferência
    nunca sobrescreve o que alguém digitou num campo com rótulo.
  */
  const precoDaPergunta = leitura.precos[0] ?? null;
  const premissas: PremissasDaCompra = {
    ...(pedido.premissas ?? {}),
    precoUnitario: pedido.premissas?.precoUnitario ?? precoDaPergunta,
    quantidade: pedido.premissas?.quantidade ?? leitura.quantidade,
  };

  const intencao = intencaoDe(pedido.pergunta, {
    temCotacao: premissas.precoUnitario != null,
  });

  const recorte: RecorteDaConsulta = {
    ...(pedido.recorte?.period !== undefined
      ? { period: pedido.recorte.period }
      : {}),
    ...(pedido.recorte?.context !== undefined
      ? { context: pedido.recorte.context }
      : {}),
    operacao: pedido.recorte?.operacao ?? null,
  };

  // ---- o dossiê -----------------------------------------------------------
  let analise: AnaliseDoItem | null = null;
  let linhas: LinhaDaCarteira[] = [];

  if (ehDeItem(intencao) && item) {
    analise = await analisarItem(db, {
      chave: item.chave,
      ownerId: pedido.ownerId,
      placa: leitura.placa,
      premissas,
      ...(pedido.politica ? { politica: pedido.politica } : {}),
      recorte,
    });
  }

  /*
    A carteira é carregada para as intenções de carteira **e** para a comparação
    sem item: "compare essas três cotações" sem dizer de quê compara as vivas.
    Ela não é carregada para uma pergunta de item — seria uma varredura da
    carteira inteira para responder sobre um pneu.
  */
  if (!ehDeItem(intencao)) {
    linhas = await carteira(db, pedido.ownerId, {
      recorte,
      ...(pedido.politica ? { politica: pedido.politica } : {}),
      premissas,
    });
  }

  /*
    A pesquisa de mercado sai para a internet, e por isso ela só acontece quando
    a intenção pede — nunca "por garantia". Ver `ehDeMercado`: quem pergunta o
    teto econômico quer a conta da remuneração, e disparar uma busca ali seria
    pagar por uma resposta que o acervo já tinha.

    Ela recebe o que o motor já apurou: o valor econômico por unidade vira a
    margem contra o mercado, e o teto econômico corta a faixa-alvo. É o elo que
    fecha a cadeia — sem ele a pesquisa devolveria o preço do mercado sem dizer
    se ele cabe na remuneração, que é a única pergunta que este produto faz.
  */
  let pesquisa: PesquisaDeMercado | null = null;
  if (ehDeMercado(intencao) && item) {
    const buscador =
      pedido.busca ??
      (buscaDisponivel()
        ? buscaPorModelo()
        : buscaIndisponivel(
            "A pesquisa de mercado precisa de uma chave de modelo (ANTHROPIC_API_KEY). " +
              "Sem ela o agente responde sobre a remuneração e as cotações registradas, " +
              "e não consulta o mercado.",
          ));

    pesquisa = await pesquisarMercado(buscador, {
      item: item.chave,
      descricao: descricaoDoItem(analise),
      /* A pergunta traz a medida quando quem pergunta a conhece — e só isso. */
      textoLivre: pedido.pergunta,
      quantidade: premissas.quantidade ?? null,
      /*
        A região é a **unidade**, que é um lugar — nunca a operação. "Entrega em
        EMPURRADA" não é endereço e não seleciona fornecedor nenhum; "Camaçari"
        seleciona. A operação continua recortando o acervo, que é o trabalho
        dela.
      */
      regiao: analise?.leitura.unidade ?? null,
      precoAtual:
        premissas.precoUnitario ??
        analise?.cotacoes[0]?.cotacao.precoUnitario ??
        null,
      precoHistorico: premissas.precoHistorico ?? null,
      remuneracaoUnitaria: analise?.avaliacao.valorEconomicoUnitario ?? null,
      tetoEconomico: analise?.avaliacao.precoTeto ?? null,
      ...(pedido.agora ? { agora: pedido.agora } : {}),
    });
  }

  const fornecedores = intencao === "FORNECEDORES" ? porFornecedor(linhas) : [];

  // ---- a redação em código ------------------------------------------------
  const semItem = ehDeItem(intencao) && !item ? pedirItem() : null;
  const material = {
    intencao,
    analise,
    carteira: linhas,
    fornecedores,
    semItem,
    pesquisa,
  };
  const determinismo = redigirEmCodigo(material);

  // ---- a redação por modelo, quando ela passa na trava --------------------
  let texto = determinismo;
  let redacao: Redator = "DETERMINISTICA";
  let porqueDeterministica: string | null = pedido.semIa
    ? "A tela pediu a redação em código."
    : !iaDisponivel()
      ? "Nenhuma chave de modelo configurada — a resposta foi montada em código, sobre o mesmo material."
      : null;

  if (!pedido.semIa && iaDisponivel()) {
    const escrita = await redigir({
      pergunta: pedido.pergunta,
      analise: determinismo,
      ...(pedido.historico ? { historico: pedido.historico } : {}),
    });

    if (escrita.texto === null) {
      porqueDeterministica =
        escrita.desfecho === "RECUSA"
          ? "O modelo recusou a redação; a resposta saiu em código, com o mesmo material."
          : `A chamada ao modelo não devolveu texto (${escrita.desfecho}); a resposta saiu em código.`;
    } else {
      /*
        A trava roda sobre os números que o dossiê sustenta. Sem análise de item
        a lista é a dos números da carteira — e ela é montada aqui, e não na
        redação, porque é aqui que se sabe qual material foi usado.
      */
      const permitidos = numerosPermitidos(analise, linhas, pesquisa);
      const conferencia = conferirLastro(escrita.texto, permitidos);
      if (conferencia.passou) {
        texto = escrita.texto;
        redacao = "IA";
      } else {
        porqueDeterministica =
          `A redação do modelo citou ${conferencia.semLastro.length} valor(es) sem lastro no dossiê ` +
          "e foi descartada inteira. O texto abaixo é o da redação em código, com os mesmos números.";
      }
    }
  }

  const atalhos = analise
    ? analise.atalhos
    : linhas.flatMap((l) => l.atalhos).slice(0, 6);

  return {
    texto,
    redacao,
    porqueDeterministica,
    intencao,
    rotuloDaIntencao: ROTULO_DA_INTENCAO[intencao],
    item: analise?.produto ?? item,
    analise,
    carteira: linhas,
    fornecedores,
    atalhos,
    leitura: {
      precos: leitura.precos,
      quantidade: leitura.quantidade,
      placa: leitura.placa,
    },
    lacunas: analise?.avaliacao.lacunas ?? [],
    pesquisa,
  };
}

/**
 * A descrição que nomeia o item na busca.
 *
 * Só a cotação registrada serve: quem digitou "295/80 R22.5 recapado" escreveu
 * exatamente o que se compra. A pergunta **não** entra aqui — ela vai por
 * `textoLivre`, de onde se lê atributo sem batizar o item com a frase inteira.
 * O rótulo do catálogo também fica de fora de propósito: `especificarCompra` já
 * cai nele sozinho, e passá-lo aqui faria a lacuna "a cotação não traz
 * descrição" nunca aparecer, que é justamente o aviso que destrava a busca.
 */
function descricaoDoItem(analise: AnaliseDoItem | null): string | null {
  return (
    analise?.cotacoes.find((c) => c.cotacao.descricao !== null)?.cotacao
      .descricao ?? null
  );
}

/** Todo número que a resposta pode citar, vindo do material que ela usou. */
function numerosPermitidos(
  analise: AnaliseDoItem | null,
  linhas: LinhaDaCarteira[],
  pesquisa: PesquisaDeMercado | null = null,
): number[] {
  const numeros: number[] = [];
  if (analise) {
    numeros.push(...numerosDaAvaliacao(analise.avaliacao));
    for (const c of analise.cotacoes)
      numeros.push(...numerosDaAvaliacao(c.avaliacao));
  }
  for (const linha of linhas) {
    for (const p of linha.propostas)
      numeros.push(...numerosDaAvaliacao(p.avaliacao));
  }

  /*
    Os totais que a redação em código soma entram na lista: eles são derivados
    do dossiê por uma conta que este código faz, e recusá-los reprovaria a
    redação do modelo por repetir um número que o texto ao lado já traz.
  */
  const somaImpacto = linhas
    .map((l) => l.melhor?.avaliacao.impactoPelaQuantidade ?? 0)
    .filter((n) => n > 0)
    .reduce((a, b) => a + b, 0);
  if (somaImpacto > 0) numeros.push(somaImpacto);

  /*
    Os números do mercado entram na lista pelo mesmo critério dos do acervo:
    eles existem no dossiê, foram conferidos contra o texto da página
    (`mercado/verificacao.ts`) e são calculados em código. O que a trava impede
    continua sendo o mesmo — o modelo citar um real que ninguém apurou.
  */
  if (pesquisa) {
    for (const o of pesquisa.ofertas) {
      numeros.push(o.oferta.preco);
      if (o.custo.custoTotal !== null) numeros.push(o.custo.custoTotal);
      if (o.custo.precoPorUnidade !== null)
        numeros.push(o.custo.precoPorUnidade);
      if (o.custo.fretePorUnidade !== null)
        numeros.push(o.custo.fretePorUnidade);
      if (o.oferta.frete !== null) numeros.push(o.oferta.frete);
    }
    if (pesquisa.leitura) {
      numeros.push(
        pesquisa.leitura.menor,
        pesquisa.leitura.maior,
        pesquisa.leitura.mediana,
        pesquisa.leitura.media,
      );
    }
    if (temFaixa(pesquisa.alvo)) {
      numeros.push(pesquisa.alvo.piso, pesquisa.alvo.teto);
      for (const ev of pesquisa.alvo.evidencias) {
        if (ev.valor !== null) numeros.push(ev.valor);
      }
    }
    if (pesquisa.economia) {
      numeros.push(
        pesquisa.economia.economiaUnitaria,
        pesquisa.economia.precoRecomendado,
      );
      if (pesquisa.economia.economiaTotal !== null)
        numeros.push(pesquisa.economia.economiaTotal);
    }
    if (pesquisa.margem) {
      numeros.push(
        pesquisa.margem.margemUnitaria,
        pesquisa.margem.custoDeCompra,
      );
      if (pesquisa.margem.margemTotal !== null)
        numeros.push(pesquisa.margem.margemTotal);
    }
  }

  const somaGanho = linhas
    .map((l) => {
      const a = l.melhor?.avaliacao;
      const q = l.melhor?.cotacao.quantidade ?? null;
      return a?.diferencaParaAlvo != null && q !== null
        ? Math.max(0, a.diferencaParaAlvo) * q
        : 0;
    })
    .reduce((a, b) => a + b, 0);
  if (somaGanho > 0) numeros.push(somaGanho);

  return numeros;
}

// ---------------------------------------------------------------------------
// Sugestões
// ---------------------------------------------------------------------------

/**
 * As entradas rápidas da tela inicial.
 *
 * Seis, e cada uma é uma pergunta inteira — não um rótulo de filtro. Quem
 * clica em "Ver itens acima do teto" está fazendo a pergunta, e a resposta sai
 * pelo mesmo caminho de quem a digitou. O `exemplo` é o que vai para o campo.
 */
export interface SugestaoRapida {
  rotulo: string;
  exemplo: string;
  intencao: Intencao;
}

export function sugestoes(): SugestaoRapida[] {
  return [
    {
      rotulo: "Analisar uma cotação",
      exemplo:
        "Essa cotação está boa? Pneu a R$ 3.080 por unidade, 80 unidades.",
      intencao: "AVALIAR_COTACAO",
    },
    {
      rotulo: "Descobrir preço-alvo",
      exemplo: "Quanto devo pagar por pneu?",
      intencao: "PRECO_ALVO",
    },
    {
      rotulo: "Ver itens acima do teto",
      exemplo: "Quais itens estou comprando acima do teto?",
      intencao: "ACIMA_DO_TETO",
    },
    {
      rotulo: "Comparar fornecedores",
      exemplo: "Quais fornecedores estão mais competitivos?",
      intencao: "FORNECEDORES",
    },
    {
      rotulo: "Encontrar oportunidades de economia",
      exemplo: "Quais compras têm maior oportunidade de economia?",
      intencao: "OPORTUNIDADES",
    },
    {
      rotulo: "Simular uma compra",
      exemplo: "Simule uma compra de 80 pneus a R$ 2.900 por unidade.",
      intencao: "SIMULAR",
    },
    {
      rotulo: "Pesquisar preço de mercado",
      exemplo: "Pesquise pneu 295/80 R22.5 no mercado, 40 unidades.",
      intencao: "PESQUISAR_MERCADO",
    },
    {
      rotulo: "Remuneração contra o mercado",
      exemplo: "Quanto somos remunerados em pneu e quanto consigo comprar?",
      intencao: "REMUNERADO_VERSUS_MERCADO",
    },
  ];
}

export { blocoDaAvaliacao, iaDisponivel, modeloConfigurado };
export * from "./extracao";
export * from "./intencao";
export * from "./navegacao";
export * from "./base";
export * from "./dossie";
export * from "./panorama";
export * from "./lastro";
export {
  redigirEmCodigo,
  numerosDaAvaliacao,
  reais,
  percentual,
  inteiro,
} from "./redacao";
