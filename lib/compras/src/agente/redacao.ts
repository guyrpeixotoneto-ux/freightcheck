/**
 * A RESPOSTA ESCRITA — montada em código, sobre o dossiê já fechado.
 *
 * Esta é a redação determinística do Agente de Compras: dado o dossiê
 * (`dossie.ts`), ela escreve a resposta em português, com os números que o
 * motor calculou e nenhum outro. Ela é o caminho **padrão**, e não o caminho de
 * emergência: o produto responde por completo sem chave de modelo nenhuma, e a
 * tela diz qual dos dois escreveu o que está sendo lido.
 *
 * Quando há chave, `llm.ts` reescreve **este mesmo material** com mais fluência.
 * O que ele não pode fazer é acrescentar número: a conferência de lastro
 * (`conferirLastro`) recusa a redação do modelo que traga um valor em reais que
 * não esteja no dossiê, e o texto daqui volta ao lugar dela. É a mesma trava do
 * Assistente, pela mesma razão — um preço de compra inventado com fluência é o
 * defeito mais caro que este produto pode ter.
 *
 * O formato segue o que a mesa de negociação usa: o veredito primeiro, os dois
 * preços logo abaixo, o impacto pela quantidade, e só então a conta. Quem abre
 * a resposta com um fornecedor no telefone precisa dos três primeiros números
 * em duas linhas.
 */

import {
  ROTULO_DA_CONFIABILIDADE,
  ROTULO_DO_VEREDITO,
  ROTULO_SEM_ALVO,
  type AvaliacaoDeCompra,
} from "../motor";
import { ROTULO_DA_SITUACAO } from "../cotacoes";
import type {
  AnaliseDoItem,
  DesempenhoDoFornecedor,
  LinhaDaCarteira,
} from "./dossie";
import {
  ROTULO_DA_CONFIANCA,
  ROTULO_DO_FRESCOR,
  ROTULO_DO_MATCH,
  temFaixa,
  type OfertaAnalisada,
  type PesquisaDeMercado,
} from "../mercado";
import type { Intencao } from "./intencao";

const REAIS = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INTEIRO = new Intl.NumberFormat("pt-BR");

/** `null` vira travessão, e nunca zero. A diferença é a regra da casa. */
export function reais(valor: number | null): string {
  return valor === null ? "—" : REAIS.format(valor);
}

export function percentual(fracao: number | null): string {
  return fracao === null
    ? "—"
    : `${(fracao * 100).toFixed(1).replace(".", ",")}%`;
}

export function inteiro(valor: number | null): string {
  return valor === null ? "—" : INTEIRO.format(valor);
}

/**
 * Os números que a resposta pode conter — a lista contra a qual a trava confere.
 *
 * São os valores do dossiê, e a conferência é **por valor formatado**: o modelo
 * pode escrever "R$ 2.750,00" ou "R$ 2.750", e as duas grafias apontam para o
 * mesmo número do dossiê. O que ele não pode é escrever R$ 2.800 porque soa
 * melhor.
 */
export function numerosDaAvaliacao(a: AvaliacaoDeCompra): number[] {
  return [
    a.valorRemunerado,
    a.valorEconomicoUnitario,
    a.precoAlvo,
    a.precoTeto,
    a.precoCotado,
    a.precoHistorico,
    a.diferencaParaAlvo,
    a.diferencaParaTeto,
    a.margemAbsoluta,
    a.impactoPelaQuantidade,
    a.impactoMensal,
    a.impactoAnual,
    a.premissas.quantidade ?? null,
    a.premissas.vidaUtilMeses ?? null,
    a.premissas.unidadesPorAtivo ?? null,
  ].filter((n): n is number => n !== null);
}

// ---------------------------------------------------------------------------
// O bloco de um item
// ---------------------------------------------------------------------------

/**
 * A conta de um item, do veredito às premissas.
 *
 * É o formato que o exemplo do produto pede: preço-alvo e teto no alto,
 * proposta e diferença na sequência, impacto pela quantidade, e por último
 * "como o valor foi calculado" com a remuneração, a vigência, as premissas e o
 * que é confirmado contra o que é estimado.
 */
export function blocoDaAvaliacao(
  analise: AnaliseDoItem,
  a: AvaliacaoDeCompra,
): string {
  const linhas: string[] = [];

  if (a.precoAlvo === null) {
    linhas.push(
      `**${analise.produto.rotulo} — sem preço-alvo nesta vigência.**`,
      "",
      a.semAlvo !== null
        ? `Motivo: ${ROTULO_SEM_ALVO[a.semAlvo]}. ${pontuada(a.base.fonte)}`
        : pontuada(a.base.fonte),
    );
  } else {
    linhas.push(
      `**Preço-alvo: ${reais(a.precoAlvo)}/unidade**`,
      `**Teto econômico: ${reais(a.precoTeto)}/unidade**`,
    );

    if (a.precoCotado !== null) {
      linhas.push("", `Proposta atual: ${reais(a.precoCotado)}`, "");
      if (a.veredito === "ACIMA_DO_TETO") {
        linhas.push(
          `A proposta está ${reais(a.diferencaParaTeto)} acima do teto.`,
        );
      } else if (a.veredito === "ENTRE_ALVO_E_TETO") {
        linhas.push(
          `A proposta cabe no teto e está ${reais(a.diferencaParaAlvo)} acima da meta de negociação.`,
        );
      } else {
        linhas.push(
          `A proposta está no alvo — ${reais(Math.abs(a.diferencaParaAlvo ?? 0))} abaixo da meta.`,
        );
      }

      if (a.impactoPelaQuantidade !== null && a.premissas.quantidade != null) {
        const q = inteiro(a.premissas.quantidade);
        if (a.impactoPelaQuantidade > 0) {
          linhas.push(
            "",
            `Para uma compra de ${q} unidades, isso representa ${reais(a.impactoPelaQuantidade)} acima do limite econômico calculado.`,
          );
        } else {
          linhas.push(
            "",
            `Para uma compra de ${q} unidades, a proposta cabe no limite econômico com ${reais(Math.abs(a.impactoPelaQuantidade))} de folga.`,
          );
        }
        if (a.impactoMensal !== null) {
          linhas.push(
            `Diluído na vida útil: ${reais(a.impactoMensal)} por mês, ${reais(a.impactoAnual)} no ano.`,
          );
        }
      }
    }

    linhas.push(
      "",
      `Meta de negociação: ${reais(a.precoAlvo)}`,
      `Limite econômico configurado: ${reais(a.precoTeto)}`,
    );
  }

  // ---- como o valor foi calculado -----------------------------------------
  linhas.push("", "**Como o valor foi calculado**", "");
  /* A frase muda quando não há valor: "Remuneração usada: —" sugere que houve
     uma e que ela é zero, e o que houve foi a vigência não trazer nenhuma. */
  linhas.push(
    a.valorRemunerado === null
      ? `- Remuneração usada: nenhuma — ${a.base.escopo}.`
      : `- Remuneração usada: ${reais(a.valorRemunerado)} — ${a.base.escopo}.`,
    `- Vigência: ${a.base.vigencia}.`,
    /* Sem ponto acrescentado: a fonte já vem como frase, e duas pontuações
       seguidas ("...deste item..") é o rastro de uma concatenação descuidada. */
    `- Fonte: ${pontuada(a.base.fonte)}`,
  );
  if (a.valorEconomicoUnitario !== null) {
    linhas.push(
      `- Valor econômico por unidade: ${reais(a.valorEconomicoUnitario)}.`,
    );
  }
  if (a.margemAbsoluta !== null) {
    linhas.push(
      `- Margem da compra: ${reais(a.margemAbsoluta)} por unidade (${percentual(a.margemPercentual)}).`,
    );
  }
  linhas.push(
    `- Política: meta ${percentual(a.politica.margemAlvo)} e limite ${percentual(a.politica.margemMinima)} sobre o valor econômico — configurados, não apurados.`,
  );

  const confirmados = a.dados.filter((d) => d.confirmado && d.valor !== null);
  const estimados = a.dados.filter((d) => !d.confirmado && d.valor !== null);

  if (confirmados.length > 0) {
    linhas.push("", "**Dados confirmados**", "");
    for (const d of confirmados) {
      linhas.push(
        `- ${d.rotulo}: ${escrever(d.valor, d.unidade)} — ${d.fonte}`,
      );
    }
  }
  if (estimados.length > 0) {
    linhas.push("", "**Dados estimados**", "");
    for (const d of estimados) {
      linhas.push(
        `- ${d.rotulo}: ${escrever(d.valor, d.unidade)} — ${d.fonte}`,
      );
    }
  }

  linhas.push(
    "",
    `Confiabilidade: ${ROTULO_DA_CONFIABILIDADE[a.confiabilidade]}.`,
  );

  if (a.lacunas.length > 0) {
    linhas.push("", "**O que falta**", "");
    for (const lacuna of a.lacunas) linhas.push(`- ${lacuna}`);
  }

  return linhas.join("\n");
}

/** Fecha a frase com ponto, se ela já não terminar com pontuação. */
function pontuada(texto: string): string {
  return /[.!?]$/.test(texto.trim()) ? texto.trim() : `${texto.trim()}.`;
}

function escrever(valor: number | null, unidade: string): string {
  if (valor === null) return "—";
  if (unidade === "BRL") return reais(valor);
  return `${inteiro(valor)} ${unidade}`;
}

// ---------------------------------------------------------------------------
// As respostas por intenção
// ---------------------------------------------------------------------------

export interface MaterialDaResposta {
  intencao: Intencao;
  analise: AnaliseDoItem | null;
  carteira: LinhaDaCarteira[];
  fornecedores: DesempenhoDoFornecedor[];
  /** O que impediu a resposta de ser sobre um item, quando foi o caso. */
  semItem: string | null;
  /** A pesquisa de mercado, quando a intenção pediu uma. */
  pesquisa?: PesquisaDeMercado | null;
}

/**
 * A resposta em português, por intenção.
 *
 * Cada ramo escreve sobre o material que o dossiê trouxe para aquela intenção e
 * **só sobre ele**. Um ramo que não tenha material não improvisa com o de outro:
 * ele diz o que falta e o que fazer para destravar — que é a única resposta útil
 * para quem perguntou sobre uma carteira vazia.
 */
export function redigirEmCodigo(material: MaterialDaResposta): string {
  if (
    material.semItem !== null &&
    material.analise === null &&
    ehDeItem(material.intencao)
  ) {
    return material.semItem;
  }

  switch (material.intencao) {
    case "PRECO_ALVO":
    case "TETO":
    case "SIMULAR":
    case "AVALIAR_COTACAO":
    case "EVIDENCIA":
      return material.analise
        ? textoDoItem(material.analise, material.intencao)
        : "Não identifiquei o item.";
    case "COMPARAR":
      return textoDaComparacao(material);
    case "FORNECEDORES":
      return textoDosFornecedores(material.fornecedores);
    case "ACIMA_DO_TETO":
      return textoAcimaDoTeto(material.carteira);
    case "PESQUISAR_MERCADO":
    case "REMUNERADO_VERSUS_MERCADO":
      return material.pesquisa
        ? textoDoMercado(material.pesquisa, material.analise)
        : "Não identifiquei o item para pesquisar no mercado.";
    case "MARGEM":
      return textoDaMargem(material.carteira);
    case "OPORTUNIDADES":
      return textoDasOportunidades(material.carteira);
  }
}

function ehDeItem(intencao: Intencao): boolean {
  return (
    intencao === "PRECO_ALVO" ||
    intencao === "TETO" ||
    intencao === "AVALIAR_COTACAO" ||
    intencao === "SIMULAR" ||
    intencao === "EVIDENCIA"
  );
}

function textoDoItem(analise: AnaliseDoItem, intencao: Intencao): string {
  const partes = [blocoDaAvaliacao(analise, analise.avaliacao)];

  if (intencao !== "EVIDENCIA" && analise.cotacoes.length > 0) {
    partes.push(
      "",
      `**Propostas registradas para ${analise.produto.rotulo}**`,
      "",
    );
    for (const c of analise.cotacoes) {
      const veredito =
        c.avaliacao.veredito === null
          ? "sem avaliação"
          : ROTULO_DO_VEREDITO[c.avaliacao.veredito];
      partes.push(
        `- ${c.cotacao.fornecedor}: ${reais(c.cotacao.precoUnitario)}/un` +
          (c.cotacao.quantidade !== null
            ? ` × ${inteiro(c.cotacao.quantidade)} un`
            : "") +
          ` — ${veredito} · ${ROTULO_DA_SITUACAO[c.cotacao.situacao]}`,
      );
    }
  }

  if (analise.produto.ressalva) {
    partes.push(
      "",
      `**Ressalva do catálogo** — ${analise.produto.ressalva.texto}`,
    );
    partes.push(`Evidência: ${analise.produto.ressalva.evidencia}`);
  }

  return partes.join("\n");
}

function textoDaComparacao(material: MaterialDaResposta): string {
  const propostas = material.analise
    ? material.analise.cotacoes
    : material.carteira.flatMap((l) => l.propostas);

  if (propostas.length === 0) {
    return (
      "Não há propostas registradas para comparar. Registre as cotações — item, fornecedor, " +
      "preço por unidade e quantidade — e a comparação sai com o preço-alvo de cada uma ao lado."
    );
  }

  const ordenadas = [...propostas].sort(
    (a, b) => a.cotacao.precoUnitario - b.cotacao.precoUnitario,
  );
  const linhas = ["**Propostas, da mais barata para a mais cara**", ""];
  for (const [i, p] of ordenadas.entries()) {
    const a = p.avaliacao;
    const veredito =
      a.veredito === null
        ? "sem preço-alvo nesta vigência"
        : ROTULO_DO_VEREDITO[a.veredito];
    linhas.push(
      `${i + 1}. **${p.cotacao.fornecedor}** — ${reais(p.cotacao.precoUnitario)}/un · ${veredito}` +
        (a.diferencaParaAlvo !== null
          ? ` · ${a.diferencaParaAlvo > 0 ? `${reais(a.diferencaParaAlvo)} acima da meta` : `${reais(Math.abs(a.diferencaParaAlvo))} abaixo da meta`}`
          : ""),
    );
  }

  const melhor = ordenadas[0]!;
  linhas.push(
    "",
    `Comece por **${melhor.cotacao.fornecedor}**: é a proposta mais próxima do alvo, e é onde a negociação tem o caminho mais curto.`,
  );
  if (melhor.avaliacao.precoAlvo !== null) {
    linhas.push(
      `Meta de negociação: ${reais(melhor.avaliacao.precoAlvo)} · Limite econômico configurado: ${reais(melhor.avaliacao.precoTeto)}.`,
    );
  }
  return linhas.join("\n");
}

function textoDosFornecedores(fornecedores: DesempenhoDoFornecedor[]): string {
  if (fornecedores.length === 0) {
    return (
      "Nenhum fornecedor tem proposta viva registrada. O FreightCheck não importa cadastro de " +
      "fornecedor nem histórico de compra: o que este painel conhece são as cotações registradas aqui."
    );
  }

  const linhas = ["**Fornecedores, pela margem que as propostas deixam**", ""];
  for (const f of fornecedores) {
    linhas.push(
      `- **${f.fornecedor}** — ${f.propostas} proposta(s), margem média ${percentual(f.margemMedia)}` +
        (f.acimaDoTeto > 0 ? ` · ${f.acimaDoTeto} acima do teto` : "") +
        (f.impactoTotal > 0
          ? ` · ${reais(f.impactoTotal)} acima do limite, somado`
          : ""),
    );
  }

  const primeiro =
    fornecedores.find((f) => f.acimaDoTeto > 0) ?? fornecedores.at(-1);
  if (primeiro) {
    linhas.push(
      "",
      `Negocie primeiro com **${primeiro.fornecedor}**: é onde a diferença para o limite econômico é maior.`,
    );
  }
  linhas.push(
    "",
    "Este ranking é o que as propostas registradas dizem. Ele não conhece prazo de entrega, " +
      "qualidade, histórico de atraso nem capacidade — nada disso entra neste acervo.",
  );
  return linhas.join("\n");
}

function textoAcimaDoTeto(carteira: LinhaDaCarteira[]): string {
  if (carteira.length === 0) return CARTEIRA_VAZIA;

  const fora = carteira.filter(
    (l) => l.melhor?.avaliacao.veredito === "ACIMA_DO_TETO",
  );
  /*
    Item sem veredito não é item dentro do teto.

    Esta distinção foi um defeito antes de ser uma regra: a carteira com três
    itens sem preço-alvo respondia "os 3 itens cabem no teto", que é uma
    afirmação sobre uma conta que não foi feita. Sem alvo não há teto, e sem
    teto não há "cabe".
  */
  const semVeredito = carteira.filter(
    (l) => l.melhor?.avaliacao.veredito == null,
  );
  const avaliados = carteira.length - semVeredito.length;

  const ressalva =
    semVeredito.length === 0
      ? ""
      : `\n\n${semVeredito.length} item(ns) ficaram sem veredito porque a vigência não sustenta um ` +
        `preço-alvo para eles: ${semVeredito.map((l) => l.produto.rotulo).join(", ")}. ` +
        "Eles não estão dentro do teto — eles estão sem teto calculado.";

  if (fora.length === 0) {
    return avaliados === 0
      ? "Nenhum item da carteira tem preço-alvo calculável nesta vigência, então não há como " +
          "dizer quais estão acima do teto." +
          ressalva
      : `Nenhuma das ${avaliados} proposta(s) avaliáveis está acima do limite econômico configurado.` +
          ressalva;
  }

  const linhas = ["**Itens acima do teto econômico**", ""];
  let total = 0;
  for (const l of fora) {
    const a = l.melhor!.avaliacao;
    const impacto = a.impactoPelaQuantidade ?? 0;
    total += Math.max(0, impacto);
    linhas.push(
      `- **${l.produto.rotulo}** (${l.melhor!.cotacao.fornecedor}) — ${reais(a.precoCotado)}/un contra teto de ${reais(a.precoTeto)}` +
        (a.diferencaParaTeto !== null
          ? `, ${reais(a.diferencaParaTeto)} acima`
          : "") +
        (impacto > 0 ? ` · ${reais(impacto)} no pedido` : ""),
    );
  }
  if (total > 0)
    linhas.push(
      "",
      `Somados, ${reais(total)} acima do limite econômico calculado.`,
    );
  if (ressalva !== "") linhas.push(ressalva.trim());
  return linhas.join("\n");
}

function textoDaMargem(carteira: LinhaDaCarteira[]): string {
  if (carteira.length === 0) return CARTEIRA_VAZIA;

  const comMargem = carteira
    .filter((l) => l.melhor?.avaliacao.margemPercentual != null)
    .sort(
      (a, b) =>
        b.melhor!.avaliacao.margemPercentual! -
        a.melhor!.avaliacao.margemPercentual!,
    );

  if (comMargem.length === 0) {
    return (
      "Nenhum item da carteira tem margem calculável: sem valor econômico por unidade não há " +
      "o que comparar com o preço da proposta. Informe a vida útil e as unidades por ativo dos itens."
    );
  }

  const linhas = ["**Margem entre o remunerado e o comprado**", ""];
  for (const l of comMargem) {
    const a = l.melhor!.avaliacao;
    linhas.push(
      `- **${l.produto.rotulo}** — ${percentual(a.margemPercentual)} (${reais(a.margemAbsoluta)}/un) com ${l.melhor!.cotacao.fornecedor}`,
    );
  }

  const pior = comMargem.at(-1)!;
  if ((pior.melhor!.avaliacao.margemPercentual ?? 0) < 0) {
    linhas.push(
      "",
      `**${pior.produto.rotulo}** é onde a margem está sendo destruída: a proposta custa mais do que a remuneração cobre por unidade.`,
    );
  } else {
    linhas.push(
      "",
      `A margem mais apertada é a de **${pior.produto.rotulo}**. É por ela que se começa.`,
    );
  }
  return linhas.join("\n");
}

function textoDasOportunidades(carteira: LinhaDaCarteira[]): string {
  if (carteira.length === 0) return CARTEIRA_VAZIA;

  const comGanho = carteira
    .map((l) => {
      const a = l.melhor?.avaliacao;
      const q = l.melhor?.cotacao.quantidade ?? null;
      const ganho =
        a?.diferencaParaAlvo != null && q !== null
          ? Math.max(0, a.diferencaParaAlvo) * q
          : null;
      return { linha: l, ganho };
    })
    .filter(
      (c): c is { linha: LinhaDaCarteira; ganho: number } =>
        c.ganho !== null && c.ganho > 0,
    )
    .sort((a, b) => b.ganho - a.ganho);

  if (comGanho.length === 0) {
    return (
      "Nenhuma proposta viva está acima da meta de negociação — não há economia a capturar nos " +
      "preços registrados hoje. Informe a quantidade dos pedidos que ainda não a têm para a conta ficar completa."
    );
  }

  const total = comGanho.reduce((s, c) => s + c.ganho, 0);
  const linhas = ["**Onde há economia a capturar**", ""];
  for (const c of comGanho) {
    linhas.push(
      `- **${c.linha.produto.rotulo}** (${c.linha.melhor!.cotacao.fornecedor}) — ${reais(c.ganho)} até a meta de negociação`,
    );
  }
  linhas.push("", `Total na mesa: ${reais(total)} nos pedidos já registrados.`);

  /*
    O anual **não** é o total vezes doze. O total é de pedidos concretos, com
    quantidade declarada; anualizá-lo suporia uma recorrência que ninguém
    informou. O que se pode dizer sobre o ano é o impacto mensal diluído na vida
    útil, e ele sai item a item, no bloco de cada um.
  */
  linhas.push(
    "",
    "Este total é dos pedidos registrados, não de um ano: multiplicá-lo por doze suporia uma " +
      "recorrência que nenhuma cotação declara. O efeito anual de cada item aparece na análise dele, " +
      "diluído na vida útil.",
  );
  return linhas.join("\n");
}

const CARTEIRA_VAZIA =
  "Não há cotação viva registrada. Registre uma proposta — item, fornecedor, preço por unidade e " +
  "quantidade — e este painel passa a responder sobre ela. O FreightCheck importa o modelo de " +
  "remuneração da Ambev, não as notas de compra: a carteira é o que quem compra registra aqui.";

// ---------------------------------------------------------------------------
// A resposta de mercado
// ---------------------------------------------------------------------------

/**
 * A RESPOSTA EXECUTIVA — remuneração, mercado, alvo, economia, margem, fontes.
 *
 * Seis linhas no alto e a evidência embaixo. A ordem é a da decisão, e não a do
 * cálculo: quem lê está com um fornecedor no telefone e precisa, em três
 * segundos, de quanto recebe, quanto o mercado cobra e quanto deveria pagar. A
 * derivação do alvo, as cotações, as fontes e o que foi descartado vêm depois —
 * são o que sustenta as três primeiras linhas quando alguém duvidar delas.
 *
 * **Toda cotação sai com a fonte e a hora.** Não há linha de preço nesta
 * resposta sem o domínio de onde ele veio e quando foi capturado; é a regra
 * mais simples deste arquivo e a que mais trabalho deu para garantir, porque
 * ela começa lá atrás, na conferência (`mercado/verificacao.ts`).
 */
export function textoDoMercado(
  pesquisa: PesquisaDeMercado,
  analise: AnaliseDoItem | null,
): string {
  const l: string[] = [];
  const e = pesquisa.especificacao;
  const naConta = pesquisa.ofertas.filter((o) => o.entrouNaConta);

  l.push(`**Item:** ${e.titulo}`);
  if (e.atributos.length > 0) {
    l.push(
      `**Especificação pesquisada:** ${e.atributos.map((a) => a.canonico).join(" · ")}`,
    );
  }

  // ---- os dois lados --------------------------------------------------------
  const avaliacao = analise?.avaliacao ?? null;
  if (avaliacao?.valorEconomicoUnitario != null) {
    l.push(
      `**Remuneração:** ${reais(avaliacao.valorEconomicoUnitario)}/un — ${avaliacao.base.escopo}, vigência ${avaliacao.base.vigencia}`,
    );
  } else {
    l.push(
      "**Remuneração:** não apurada nesta vigência — a comparação abaixo é só de mercado.",
    );
  }

  if (avaliacao?.precoCotado != null) {
    l.push(`**Preço atual de compra:** ${reais(avaliacao.precoCotado)}/un`);
  }

  if (pesquisa.leitura) {
    l.push(
      `**Mercado encontrado:** ${reais(pesquisa.leitura.menor)}–${reais(pesquisa.leitura.maior)}/un`,
      `**Mediana:** ${reais(pesquisa.leitura.mediana)}/un`,
    );
  }
  if (pesquisa.melhor?.custo.custoTotal != null) {
    l.push(
      `**Melhor custo total comparável:** ${reais(pesquisa.melhor.custo.custoTotal)}/un — ${pesquisa.melhor.oferta.proveniencia.fonte}`,
    );
  }

  // ---- o alvo ---------------------------------------------------------------
  if (temFaixa(pesquisa.alvo)) {
    l.push(
      `**Preço-alvo:** ${reais(pesquisa.alvo.piso)}–${reais(pesquisa.alvo.teto)}/un`,
    );
  } else {
    l.push(
      `**Preço-alvo:** ainda não há evidência suficiente. ${pesquisa.alvo.porque}`,
    );
  }

  // ---- economia e margem, que não se misturam -------------------------------
  if (pesquisa.economia) {
    const { economiaUnitaria, economiaTotal } = pesquisa.economia;
    l.push(
      economiaUnitaria > 0
        ? `**Economia potencial:** ${reais(economiaUnitaria)}/un` +
            (economiaTotal !== null
              ? ` · ${reais(economiaTotal)} no pedido`
              : "")
        : `**Economia potencial:** nenhuma — já se compra ${reais(Math.abs(economiaUnitaria))}/un abaixo do recomendado.`,
    );
  }
  if (pesquisa.margem) {
    const { margemUnitaria, margemTotal } = pesquisa.margem;
    l.push(
      `**Margem sobre a remuneração:** ${reais(margemUnitaria)}/un` +
        (margemTotal !== null ? ` · ${reais(margemTotal)} no pedido` : "") +
        (margemUnitaria < 0
          ? " — a melhor compra encontrada ainda custa mais do que a remuneração cobre."
          : ""),
    );
  }

  l.push(
    `**Confiança:** ${ROTULO_DA_CONFIANCA[pesquisa.confianca.confianca]} (${pesquisa.confianca.pontos}/100)`,
    `**Cotações válidas:** ${naConta.length} de ${pesquisa.ofertas.length} capturadas`,
  );

  // ---- o que a busca não conseguiu -----------------------------------------
  if (pesquisa.indisponivel !== null) {
    l.push(
      "",
      `**A pesquisa de mercado não aconteceu.** ${pesquisa.indisponivel}`,
    );
  }

  // ---- a derivação ----------------------------------------------------------
  if (temFaixa(pesquisa.alvo)) {
    l.push("", "**Como o preço-alvo foi derivado**", "");
    l.push(pesquisa.alvo.derivacao);
    for (const ev of pesquisa.alvo.evidencias) {
      l.push(
        `- ${ev.tipo}: ${ev.valor === null ? "—" : reais(ev.valor)} — ${ev.efeito}`,
      );
    }
  }

  // ---- as cotações, com fonte e hora ---------------------------------------
  if (pesquisa.ofertas.length > 0) {
    l.push("", "**Cotações encontradas**", "");
    for (const o of [...pesquisa.ofertas].sort(ordemDaOferta)) {
      l.push(linhaDaOferta(o));
    }
  }

  // ---- o que foi recusado ---------------------------------------------------
  if (pesquisa.descartadas.length > 0) {
    l.push("", "**Descartadas na conferência de fonte**", "");
    for (const d of pesquisa.descartadas) {
      l.push(`- ${d.url} — ${ROTULO_DO_DESCARTE_LOCAL[d.motivo] ?? d.motivo}`);
    }
  }

  // ---- confiança, fator a fator --------------------------------------------
  const pesaram = pesquisa.confianca.fatores.filter((f) => f.penalidade > 0);
  if (pesaram.length > 0) {
    l.push("", "**O que segura a confiança**", "");
    for (const f of pesaram)
      l.push(`- ${f.fator}: ${f.observado} (−${f.penalidade})`);
  }

  if (e.lacunas.length > 0) {
    l.push("", "**Para a pesquisa ficar mais precisa**", "");
    for (const lacuna of e.lacunas) l.push(`- ${lacuna}`);
  }

  return l.join("\n");
}

/** Na conta primeiro, e dentro de cada grupo pelo custo. */
function ordemDaOferta(a: OfertaAnalisada, b: OfertaAnalisada): number {
  if (a.entrouNaConta !== b.entrouNaConta) return a.entrouNaConta ? -1 : 1;
  return (
    (a.custo.custoTotal ?? Number.POSITIVE_INFINITY) -
    (b.custo.custoTotal ?? Number.POSITIVE_INFINITY)
  );
}

function linhaDaOferta(o: OfertaAnalisada): string {
  const p = o.oferta.proveniencia;
  const custo =
    o.custo.custoTotal !== null
      ? `${reais(o.custo.custoTotal)}/un comparável`
      : "sem custo comparável";
  const anunciado = `${reais(o.oferta.preco)} ${o.oferta.unidadeDoPreco.toLowerCase()}`;

  const partes = [
    `- **${o.oferta.fornecedor ?? p.fonte}** — ${custo} (anunciado ${anunciado})`,
    `· ${ROTULO_DO_MATCH[o.match.classe]}`,
    `· ${ROTULO_DO_FRESCOR[o.frescor]}`,
  ];
  if (o.fonteDuvidosa)
    partes.push("· ⚠ a página tentou dar instruções ao agente");
  if (!o.entrouNaConta) partes.push(`· ${o.foraPorque}`);
  partes.push(`\n  Fonte: ${p.url} — capturado em ${p.capturadoEm}`);

  return partes.join(" ");
}

/**
 * Os motivos de descarte, escritos.
 *
 * Duplicado aqui, e não importado de `mercado/verificacao.ts`, por uma razão
 * chata e real: importar o mapa traria o módulo inteiro para dentro da redação,
 * que hoje não depende dele. São cinco frases; a duplicação custa menos que o
 * acoplamento, e o teste do mercado prende os nomes dos dois lados.
 */
const ROTULO_DO_DESCARTE_LOCAL: Record<string, string> = {
  URL_NAO_BAIXADA: "a oferta cita uma página que a busca não baixou",
  TRECHO_INEXISTENTE: "o trecho citado não existe no texto da página",
  PRECO_FORA_DO_TRECHO: "o preço não aparece no trecho citado",
  PRECO_EM_TEXTO_DE_INSTRUCAO:
    "o preço foi lido de uma frase que tenta dar instruções ao agente",
  PRECO_INVALIDO: "preço ausente, zero ou negativo",
};
