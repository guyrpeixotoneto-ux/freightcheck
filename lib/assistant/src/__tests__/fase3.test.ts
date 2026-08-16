import { describe, expect, it } from "vitest";
import { blocosDoTexto } from "../documento";
import { interpretar } from "../interpretacao";
import { ranquear, trechosDosBlocos, type TrechoDoBook } from "../indice-book";
import {
  emFrases,
  sanear,
  numerosSemLastro,
  type Dossie,
} from "../orquestrador";
import { portaoDeLastro } from "../resposta";
import type { Evidencia } from "../ferramentas";

/**
 * A Fase 3, sem banco: o que chega ao leitor.
 *
 * Três defeitos que não apareciam em nenhuma métrica de pipeline — a bateria
 * mede onde o assistente foi procurar, e estes são sobre o que ele faz com o
 * que achou. O primeiro descartava respostas boas; o segundo trazia o documento
 * errado em primeiro lugar; o terceiro perdia a tabela que continha a regra.
 */

const EVIDENCIA: Evidencia = {
  ferramenta: "resumoDaVigencia",
  titulo: "O que mudou em agosto/2026",
  fatos: [
    {
      rotulo: "Alterações",
      valor: "267",
      detalhe: "7% do que mudou tem impacto calculável (19 de 267)",
    },
    { rotulo: "Impacto apurado", valor: "+R$ 28.511,24/mês" },
    { rotulo: "Revisão vigente", valor: "1", interno: true },
  ],
  numeros: [267, 77, 19, 28511.24],
  origem: "getFamiliesView · agosto/2026",
  recorte: {
    unidade: "CAMAÇARI",
    canal: "EMPURRADA",
    contexto: "CAMAÇARI · EMPURRADA",
    vigencia: "agosto/2026",
  },
};

const DOSSIE = {
  pergunta: "Teve alteração na remuneração?",
  leitura: interpretar("Teve alteração na remuneração?"),
  plano: {
    intencao: "MOVIMENTO" as const,
    necessidades: ["MOVIMENTO" as const],
    porque: "",
    assunto: null,
    comoReconheceu: null,
    herdado: [],
    alvo: null,
    resolucao: null,
    contexto: null,
    periodo: "2026-08-01",
    intervalo: null,
  },
  trechos: [],
  documentos: [],
  evidencias: [EVIDENCIA],
  anexos: [],
  lacunas: [],
  etapas: [],
  desambiguacao: null,
  diagnostico: {
    book: { candidatos: 0, selecionados: 0, melhorPontuacao: 0 },
    ms: 0,
  },
} satisfies Dossie;

describe("P0.4 — a trava reconhece o que é conferível", () => {
  const passa = (texto: string) => numerosSemLastro(texto, DOSSIE).length === 0;

  it("a data da vigência não é uma quantia apurada", () => {
    expect(passa("A vigência começou em 01/08/2026 [1].")).toBe(true);
    expect(passa("Em 08/2026 houve 267 alterações [1].")).toBe(true);
  });

  it("o arredondamento declarado bate com o valor cheio", () => {
    expect(passa("O impacto foi de cerca de R$ 28,5 mil por mês [1].")).toBe(
      true,
    );
    expect(passa("O impacto ficou perto de R$ 29 mil [1].")).toBe(true);
  });

  /*
    A garantia é a mesma de sempre, e estes são os casos que a provam: nenhum
    afrouxamento acima pode deixar passar um número que nenhuma consulta
    devolveu.
  */
  it("e nada disso abre porta para número inventado", () => {
    expect(passa("O impacto foi de cerca de R$ 90 mil [1].")).toBe(false);
    expect(passa("Em agosto houve 412 alterações [1].")).toBe(false);
    expect(passa("São 3,47 alterações por veículo [1].")).toBe(false);
    expect(passa("O total anual chega a R$ 342.134,88 [1].")).toBe(false);
    // Uma data com ano que o dossiê não conhece não é a vigência de ninguém.
    expect(passa("A vigência começou em 01/08/2019 [1].")).toBe(false);
  });
});

describe("P0.4 — o descarte passou a ser da frase", () => {
  it("tira a frase que não se sustenta e mantém o resto", () => {
    const texto =
      "Em agosto houve 267 alterações [1]. O impacto projetado é de R$ 90.000,00 [1]. " +
      "O movimento se concentrou em financiamento [1]. A apuração cobre 19 delas [1].";
    const r = sanear(texto, DOSSIE);

    expect(r.irrecuperavel).toBe(false);
    expect(r.removidas).toBe(1);
    expect(r.texto).toContain("267 alterações");
    expect(r.texto).toContain("financiamento");
    expect(r.texto).not.toContain("90.000,00");
    expect(r.recusados).toContain("90.000,00");
  });

  it("quando a poda passa de um terço, a resposta inteira cai", () => {
    const texto =
      "Foram 412 alterações [1]. O impacto foi de R$ 90.000,00 [1]. Sobrou pouco [1].";
    expect(sanear(texto, DOSSIE).irrecuperavel).toBe(true);
  });

  it("texto inteiro sustentado não é tocado", () => {
    const texto =
      "Em agosto houve 267 alterações [1]. A apuração cobre 19 delas [1].";
    const r = sanear(texto, DOSSIE);
    expect(r.removidas).toBe(0);
    expect(r.texto).toBe(texto);
  });

  it("as frases remontam o texto original byte a byte", () => {
    const texto = "Primeira.\n\nSegunda! Terceira?\nQuarta sem ponto";
    expect(emFrases(texto).join("")).toBe(texto);
  });
});

describe("P0.4 — o fluxo pula a frase e continua", () => {
  it("não fecha na primeira reprovação", () => {
    const saida: string[] = [];
    const portao = portaoDeLastro(DOSSIE, (p) => saida.push(p));
    portao.receber("Em agosto houve 267 alterações [1]. ");
    portao.receber("O impacto projetado é de R$ 90.000,00 [1]. ");
    portao.receber("O movimento se concentrou em financiamento [1]. ");

    const tudo = saida.join("");
    expect(tudo).toContain("267 alterações");
    expect(tudo).toContain("financiamento");
    expect(tudo).not.toContain("90.000,00");
  });
});

describe("P1.2 — o nome da fonte não é assunto", () => {
  const meta = (bloco: string) => ({
    blockKey: `Equipamentos::${bloco}`,
    bloco,
    categoria: "Equipamentos",
    revisao: 1,
    tipo: "TEXTO" as const,
    arquivo: null,
  });

  const INDICE: TrechoDoBook[] = [
    ...trechosDosBlocos(
      [
        {
          tipo: "PARAGRAFO",
          texto:
            "A remuneração de pneu considera o custo por quilômetro rodado.",
        },
      ],
      meta("PNEU"),
    ),
    ...trechosDosBlocos(
      [
        {
          tipo: "PARAGRAFO",
          texto:
            "O vale pedágio é repassado por reembolso e não sofre reajuste.",
        },
      ],
      meta("BOOK VALE PEDÁGIO"),
    ),
  ];

  /*
    O defeito, na forma exata em que ele apareceu: a palavra com que se diz
    **onde** procurar encontrando o bloco que a tem no título.
  */
  it("perguntar 'o que o Book diz sobre pneu' traz pneu, não o bloco chamado BOOK", () => {
    expect(
      ranquear(INDICE, "O que o Book diz sobre pneu?")[0]!.trecho.bloco,
    ).toBe("PNEU");
  });

  it("e quem procura o bloco pelo nome continua achando", () => {
    expect(ranquear(INDICE, "vale pedágio")[0]!.trecho.bloco).toBe(
      "BOOK VALE PEDÁGIO",
    );
  });
});

describe("P1.5 — a tabela escrita à mão continua sendo tabela", () => {
  const blocos = blocosDoTexto(
    "## Critérios\n\n| Item | Consequência |\n| --- | --- |\n| Organograma | Questionamento |\n| Ponto | Desconto |\n",
  );

  it("reconhece cabeçalho e linhas, e descarta a separadora", () => {
    expect(blocos.map((b) => b.tipo)).toEqual(["TITULO", "TABELA"]);
    const tabela = blocos[1];
    expect(tabela).toMatchObject({
      tipo: "TABELA",
      cabecalho: ["Item", "Consequência"],
      linhas: [
        ["Organograma", "Questionamento"],
        ["Ponto", "Desconto"],
      ],
    });
  });

  /*
    O efeito em cadeia: sem o ramo de tabela, `temTabela` era sempre falso para
    regra escrita à mão, e a regra de fatiamento que existe para não partir uma
    tabela não tinha como se aplicar.
  */
  it("e o trecho passa a saber que tem uma", () => {
    const trechos = trechosDosBlocos(blocos, {
      blockKey: "Gente::QLP ADM",
      bloco: "QLP ADM",
      categoria: "Gente",
      revisao: 1,
      tipo: "TEXTO",
      arquivo: null,
    });
    expect(trechos.some((t) => t.temTabela)).toBe(true);
  });
});
