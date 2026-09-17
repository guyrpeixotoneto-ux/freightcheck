import { describe, expect, it } from "vitest";
import {
  comoNumero,
  itemDaPergunta,
  lerPergunta,
  placaDaPergunta,
  precosDaPergunta,
  quantidadeDaPergunta,
} from "../agente/extracao";
import { ehDeItem, ehDeMercado, intencaoDe } from "../agente/intencao";
import { conferirLastro, valoresCitados } from "../agente/lastro";
import {
  blocoDaAvaliacao,
  numerosDaAvaliacao,
  redigirEmCodigo,
} from "../agente/redacao";
import { atalhosDoItem } from "../agente/navegacao";
import { premissasDoItem } from "../agente/dossie";
import { avaliarCompra, type BaseRemunerada } from "../motor";
import { produtoDe } from "../catalogo";
import { sugestoes } from "../agente";

/**
 * A metade do Agente de Compras que **não** é o motor: ler a pergunta,
 * classificá-la, escrever a resposta e recusar a redação sem lastro.
 *
 * As três primeiras são por regra, e é por isso que elas têm teste: se um dia
 * passarem a depender de modelo, estes casos param de valer — e é exatamente
 * essa mudança que este arquivo existe para tornar visível.
 */

describe("o que a pergunta traz de número", () => {
  it("lê o preço em grafia brasileira e o distingue da quantidade", () => {
    const leitura = lerPergunta(
      "Quanto posso pagar nesse pneu? A proposta é R$ 3.080,00 para 80 unidades.",
    );
    expect(leitura.precos).toEqual([3080]);
    expect(leitura.quantidade).toBe(80);
    expect(leitura.item?.chave).toBe("pneu");
  });

  it("não confunde 3.080 com três reais e oito centavos", () => {
    expect(comoNumero("3.080")).toBe(3080);
    expect(comoNumero("3.080,50")).toBe(3080.5);
    /* Ponto com duas casas e sem vírgula é decimal de planilha. */
    expect(comoNumero("3080.50")).toBe(3080.5);
  });

  it("só lê como preço o número que vem com marca de dinheiro", () => {
    /* "80" solto é quantidade; lê-lo como preço daria um teto sobre oitenta reais. */
    expect(precosDaPergunta("comprar 80 pneus")).toEqual([]);
    expect(precosDaPergunta("2.900 reais por unidade")).toEqual([2900]);
  });

  it("lê várias propostas na ordem em que aparecem", () => {
    expect(precosDaPergunta("R$ 3.080, R$ 2.950 e R$ 3.210")).toEqual([
      3080, 2950, 3210,
    ]);
  });

  it("exige a palavra da contagem para ler quantidade", () => {
    expect(quantidadeDaPergunta("80 unidades")).toBe(80);
    expect(quantidadeDaPergunta("compra de 120")).toBe(120);
    expect(quantidadeDaPergunta("na vigência de 2026")).toBeNull();
  });

  it("encontra a placa nos dois formatos", () => {
    expect(placaDaPergunta("quanto rende pneu na ABC1D23?")).toBe("ABC1D23");
    expect(placaDaPergunta("e na ABC-1234?")).toBe("ABC1234");
  });
});

describe("qual item a pergunta cita", () => {
  it("encontra pelo apelido de quem compra, não só pelo rótulo do catálogo", () => {
    expect(itemDaPergunta("preciso trocar a borracha")?.chave).toBe("pneu");
    expect(itemDaPergunta("vou comprar peça de oficina")?.chave).toBe(
      "manutencao-avulsa",
    );
    expect(itemDaPergunta("recarga de vale transporte")?.chave).toBe(
      "vale-transporte",
    );
  });

  it("o termo mais longo vence — contrato de manutenção não é manutenção avulsa", () => {
    expect(itemDaPergunta("vou renovar o contrato de manutencao")?.chave).toBe(
      "manutencao-contrato",
    );
  });

  it("casa por palavra inteira: 'epi' não aparece dentro de 'equipamento'", () => {
    expect(itemDaPergunta("qual o custo do equipamento")?.chave).not.toBe(
      "uniformes",
    );
  });

  it("devolve null quando não reconhece — e a resposta pede o item", () => {
    expect(itemDaPergunta("me explique a vigência")).toBeNull();
  });
});

describe("a intenção da pergunta", () => {
  const casos: [string, string][] = [
    ["Quanto devo pagar por este pneu?", "PRECO_ALVO"],
    ["Qual é meu preço máximo?", "TETO"],
    ["Essa cotação está boa?", "AVALIAR_COTACAO"],
    ["Compare essas três cotações.", "COMPARAR"],
    ["Quais fornecedores estão mais competitivos?", "FORNECEDORES"],
    ["Qual fornecedor devo negociar primeiro?", "FORNECEDORES"],
    ["Quais itens estou comprando acima do teto?", "ACIMA_DO_TETO"],
    ["Onde estou destruindo margem?", "MARGEM"],
    ["Quanto sobra da remuneração se eu comprar por esse preço?", "MARGEM"],
    ["Quais compras têm maior oportunidade de economia?", "OPORTUNIDADES"],
    ["Quanto podemos economizar no ano?", "OPORTUNIDADES"],
    ["Simule uma compra de 80 pneus.", "SIMULAR"],
    ["Mostre a evidência que sustenta esse preço-alvo.", "EVIDENCIA"],
  ];

  for (const [pergunta, esperada] of casos) {
    it(`"${pergunta}" → ${esperada}`, () => {
      expect(intencaoDe(pergunta)).toBe(esperada);
    });
  }

  it("a evidência vence o preço-alvo quando a pergunta cita os dois", () => {
    /* Responder com o preço-alvo a quem pediu a evidência devolve o que já tem. */
    expect(intencaoDe("mostre a evidência do preço-alvo")).toBe("EVIDENCIA");
  });

  it("um preço na mão transforma preço-alvo em avaliação de cotação", () => {
    expect(intencaoDe("quanto posso pagar?", { temCotacao: true })).toBe(
      "AVALIAR_COTACAO",
    );
    expect(intencaoDe("quanto posso pagar?")).toBe("PRECO_ALVO");
  });

  it("a pergunta que a tabela não prevê cai no preço-alvo, que é de item", () => {
    expect(intencaoDe("e aí")).toBe("PRECO_ALVO");
    expect(ehDeItem("PRECO_ALVO")).toBe(true);
    expect(ehDeItem("OPORTUNIDADES")).toBe(false);
  });
});

// ---------------------------------------------------------------------------

const PNEU: BaseRemunerada = {
  valor: 917,
  gaveta: "MENSAL",
  escopo: "média por veículo (64 de 64 na frota)",
  fonte: 'Coluna "valorPneu" do export',
  vigencia: "Setembro/2026",
  ressalva: null,
};

const AVALIACAO = avaliarCompra(
  "pneu",
  PNEU,
  {
    precoUnitario: 3080,
    quantidade: 80,
    vidaUtilMeses: 18,
    unidadesPorAtivo: 6,
  },
  { margemAlvo: 0.12, margemMinima: 0.05 },
);

const ANALISE = {
  produto: produtoDe("pneu")!,
  leitura: {
    base: PNEU,
    effectiveDate: "2026-09-01",
    veiculos: 64,
    placa: null,
    unidade: "Camaçari",
  },
  avaliacao: AVALIACAO,
  cotacoes: [],
  premissaConfigurada: null,
  atalhos: atalhosDoItem(produtoDe("pneu")!),
};

describe("a resposta escrita em código", () => {
  const texto = blocoDaAvaliacao(ANALISE, AVALIACAO);

  it("abre pelos dois preços, que é o que quem está no telefone precisa", () => {
    expect(texto.split("\n")[0]).toContain("Preço-alvo");
    expect(texto.split("\n")[1]).toContain("Teto econômico");
  });

  it("diz o quanto a proposta passa do teto e o que isso dá no pedido", () => {
    expect(texto).toContain("acima do teto");
    expect(texto).toContain("80 unidades");
    expect(texto).toContain("acima do limite econômico calculado");
  });

  it("escreve 'limite econômico configurado' — a palavra que o torna honesto", () => {
    expect(texto).toContain("Limite econômico configurado");
    expect(texto).toContain("configurados, não apurados");
  });

  it("abre a conta: remuneração, vigência, fonte e premissas", () => {
    expect(texto).toContain("Como o valor foi calculado");
    expect(texto).toContain("Setembro/2026");
    expect(texto).toContain('Coluna "valorPneu" do export');
    expect(texto).toContain("Dados confirmados");
    expect(texto).toContain("Confiabilidade");
  });

  it("nunca escreve zero no lugar de um número que não existe", () => {
    const semCotacao = avaliarCompra("pneu", PNEU, {
      vidaUtilMeses: 18,
      unidadesPorAtivo: 6,
    });
    const escrito = blocoDaAvaliacao(ANALISE, semCotacao);
    expect(escrito).not.toContain("Proposta atual: R$ 0,00");
  });

  it("a carteira vazia responde o que fazer, e não um silêncio", () => {
    const vazia = redigirEmCodigo({
      intencao: "ACIMA_DO_TETO",
      analise: null,
      carteira: [],
      fornecedores: [],
      semItem: null,
    });
    expect(vazia).toContain("Registre uma proposta");
    expect(vazia).toContain("não as notas de compra");
  });

  it("item sem veredito não é item dentro do teto", () => {
    /*
      O defeito que este caso prende: uma carteira de três itens sem preço-alvo
      respondia "os 3 itens cabem no teto" — uma afirmação sobre uma conta que
      não foi feita. Sem alvo não há teto, e sem teto não há "cabe".
    */
    const semAlvo = avaliarCompra(
      "financiamento",
      { ...PNEU, valor: null },
      { precoUnitario: 900 },
    );
    const linha = {
      produto: produtoDe("financiamento")!,
      leitura: {
        base: PNEU,
        effectiveDate: null,
        veiculos: null,
        placa: null,
        unidade: null,
      },
      melhor: {
        cotacao: {
          id: "x",
          item: "financiamento",
          descricao: null,
          fornecedor: "Banco Frota",
          precoUnitario: 900,
          quantidade: 10,
          operacao: null,
          unidade: null,
          situacao: "AGUARDANDO" as const,
          evidencia: null,
          validaAte: null,
          createdAt: "",
          updatedAt: "",
        },
        avaliacao: semAlvo,
        atalhos: [],
      },
      propostas: [],
      atalhos: [],
    };

    const texto = redigirEmCodigo({
      intencao: "ACIMA_DO_TETO",
      analise: null,
      carteira: [linha],
      fornecedores: [],
      semItem: null,
    });
    expect(texto).not.toContain("cabem no teto");
    expect(texto).toContain("sem teto calculado");
  });

  it("a pergunta de item sem item pede o item, listando o que se pode responder", () => {
    const texto = redigirEmCodigo({
      intencao: "PRECO_ALVO",
      analise: null,
      carteira: [],
      fornecedores: [],
      semItem: "Não identifiquei o item da compra. Pneus, Combustível.",
    });
    expect(texto).toContain("Não identifiquei o item");
  });
});

describe("a procedência das premissas", () => {
  it("o número configurado pela casa não se apresenta como informado no pedido", () => {
    /*
      Os dois são confirmados, e vêm de lugares diferentes. `fonte` é o único
      campo cujo trabalho é dizer de onde o número veio — escrever "informada no
      pedido" sobre a configuração da casa erra exatamente ali.
    */
    const premissas = premissasDoItem(
      { precoUnitario: 3080 },
      {
        item: "pneu",
        operacao: null,
        vidaUtilMeses: 24,
        unidadesPorAtivo: 6,
        margemAlvo: null,
        margemMinima: null,
        justificativa: "Ciclo medido na operação",
        updatedAt: "",
      },
    );
    const a = avaliarCompra("pneu", PNEU, premissas);
    const vida = a.dados.find((d) => d.chave === "vidaUtilMeses")!;
    expect(vida.valor).toBe(24);
    expect(vida.confirmado).toBe(true);
    expect(vida.fonte).toContain("Premissa configurada");
    expect(vida.fonte).toContain("Ciclo medido na operação");
  });

  it("o que a pergunta informou continua dizendo que veio do pedido", () => {
    const a = avaliarCompra("pneu", PNEU, {
      vidaUtilMeses: 18,
      unidadesPorAtivo: 6,
    });
    expect(a.dados.find((d) => d.chave === "vidaUtilMeses")!.fonte).toBe(
      "Informada no pedido",
    );
  });
});

describe("a trava de lastro", () => {
  it("lê os valores em reais do texto, e só eles", () => {
    expect(valoresCitados("R$ 2.750,00 para 80 unidades em 18 meses")).toEqual([
      2750,
    ]);
  });

  it("deixa passar o texto que só cita números do dossiê", () => {
    const permitidos = numerosDaAvaliacao(AVALIACAO);
    const texto = `O teto é ${AVALIACAO.precoTeto!.toFixed(2).replace(".", ",")}`;
    expect(
      conferirLastro(`R$ ${texto.split("é ")[1]}`, permitidos).passou,
    ).toBe(true);
  });

  it("recusa o valor arredondado 'para negociar melhor'", () => {
    const conferencia = conferirLastro(
      "O teto é R$ 2.800,00",
      numerosDaAvaliacao(AVALIACAO),
    );
    expect(conferencia.passou).toBe(false);
    expect(conferencia.semLastro).toEqual([2800]);
  });

  it("aceita a diferença em módulo — o sinal está na frase, não no número", () => {
    const conferencia = conferirLastro("R$ 140,00 abaixo da meta", [-140]);
    expect(conferencia.passou).toBe(true);
  });

  it("tolera um centavo de arredondamento, e não mais que isso", () => {
    expect(conferirLastro("R$ 2.750,00", [2749.995]).passou).toBe(true);
    expect(conferirLastro("R$ 2.750,00", [2749.5]).passou).toBe(false);
  });
});

describe("a navegação contextual", () => {
  it("manda quem perguntou de uniforme para a aba do QLP, não para a da frota", () => {
    const doUniforme = atalhosDoItem(produtoDe("uniformes")!);
    expect(doUniforme[0]!.href).toContain("aba=qlp");
    expect(atalhosDoItem(produtoDe("pneu")!)[0]!.href).toContain("aba=frota");
  });

  it("abre o item na visão por produto, e não na matriz", () => {
    const item = atalhosDoItem(produtoDe("pneu")!).find(
      (a) => a.tipo === "ITEM",
    )!;
    expect(item.href).toContain("visao=produto");
    expect(item.href).toContain("produto=pneu");
  });

  it("não inventa o atalho da composição quando não há placa", () => {
    expect(
      atalhosDoItem(produtoDe("pneu")!).some((a) => a.tipo === "COMPOSICAO"),
    ).toBe(false);
    expect(
      atalhosDoItem(produtoDe("pneu")!, { placa: "ABC1D23" }).some(
        (a) => a.tipo === "COMPOSICAO",
      ),
    ).toBe(true);
  });
});

describe("a decisão de sair para a internet é por regra", () => {
  it("reconhece as perguntas de mercado", () => {
    expect(intencaoDe("Pesquise esse uniforme no mercado.")).toBe(
      "PESQUISAR_MERCADO",
    );
    expect(intencaoDe("Encontre fornecedores para esse item.")).toBe(
      "PESQUISAR_MERCADO",
    );
    expect(intencaoDe("Estou pagando caro?")).toBe("PESQUISAR_MERCADO");
    expect(intencaoDe("Me mostre as fontes.")).toBe("PESQUISAR_MERCADO");
    expect(
      intencaoDe("Quanto a Ambev remunera e quanto consigo comprar?"),
    ).toBe("REMUNERADO_VERSUS_MERCADO");
    expect(intencaoDe("Compare o que somos remunerados com o mercado.")).toBe(
      "REMUNERADO_VERSUS_MERCADO",
    );
  });

  it("não sai para a internet nas perguntas que o acervo responde", () => {
    /*
      Pesquisa de mercado custa tempo e dinheiro. Dispará-la em toda pergunta —
      inclusive nas que o acervo já responde — seria pagar por uma resposta que
      já se tinha.
    */
    for (const p of [
      "Quanto devo pagar por este pneu?",
      "Qual é meu preço máximo?",
      "Quais itens estou comprando acima do teto?",
      "Onde estou destruindo margem?",
      "Mostre a evidência que sustenta esse preço-alvo.",
    ]) {
      expect(ehDeMercado(intencaoDe(p))).toBe(false);
    }
    expect(ehDeMercado(intencaoDe("Pesquise pneu no mercado"))).toBe(true);
  });
});

describe("as sugestões da tela inicial", () => {
  it("são oito, e cada uma é uma pergunta inteira que o agente sabe classificar", () => {
    /*
      O número está preso porque ele é contrato de tela: as sugestões são a
      entrada do produto, e uma que o classificador não reconhecesse levaria
      quem clicou para uma resposta sobre outra coisa. As duas últimas — as de
      mercado — são as únicas que saem para a internet.
    */
    const lista = sugestoes();
    expect(lista).toHaveLength(8);
    for (const s of lista) {
      expect(intencaoDe(s.exemplo, { temCotacao: /R\$/.test(s.exemplo) })).toBe(
        s.intencao,
      );
    }
  });
});
