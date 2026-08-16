import { describe, expect, it } from "vitest";
import {
  categoriasNaoPropor,
  categoriasPendentes,
  classificar,
  prioridadeDaPauta,
  racionalDeApoio,
  type Recomendacao,
} from "../cliente-recomendacoes";
import { formatBrlCompacto } from "@/lib/format";

/**
 * O que a aba Cliente decide antes de desenhar a pauta.
 *
 * Três coisas, e as três já erraram em produtos parecidos: a etiqueta de
 * prioridade — que não pode virar "quanto é o número", senão a tela manda
 * propor o que ainda é pergunta —, a partição dos painéis do rodapé — que
 * precisa somar exatamente a população, senão o ladrilho do topo discorda da
 * lista logo abaixo dele — e o racional de apoio, que sem denominador vira uma
 * afirmação que ninguém confere.
 */

const rec = (patch: Partial<Recomendacao>): Recomendacao => ({
  code: "taxaFiname",
  title: "Taxa FINAME",
  entityType: "CAVALO",
  equipment: "Cavalo",
  situacao: "PROPOR_AJUSTE",
  confianca: "MEDIA",
  papel: "TAXA",
  sentido: "DIRETO",
  acionavel: "NEGOCIAVEL",
  mecanismo: "",
  efeito: "REDUZ",
  direcoesMistas: false,
  oQueAconteceu: null,
  porque: "",
  impacto: null,
  impactoMotivo: "",
  valorAtual: null,
  valorRecomendado: null,
  diferenca: null,
  fonte: null,
  oQuePerguntar: null,
  veiculosAfetados: 0,
  veiculosNaSerie: 0,
  alteracoes: 0,
  alimenta: [],
  dependeDe: [],
  evidencia: "",
  ...patch,
});

const impacto = (valor: number) => ({
  valor,
  periodicidade: "MENSAL",
  mensal: valor,
  anual: valor * 12,
  projetado: false,
  explicacao: "",
});

describe("prioridadeDaPauta", () => {
  it("só uma proposta de confiança alta vira prioridade alta", () => {
    expect(
      prioridadeDaPauta(rec({ situacao: "PROPOR_AJUSTE", confianca: "ALTA" })),
    ).toBe("ALTA");
    expect(
      prioridadeDaPauta(rec({ situacao: "PROPOR_AJUSTE", confianca: "MEDIA" })),
    ).toBe("MEDIA");
  });

  it("investigação não vira prioridade, por maior que seja o dinheiro", () => {
    expect(
      prioridadeDaPauta(
        rec({
          situacao: "INVESTIGAR",
          confianca: "ALTA",
          impacto: impacto(-731_000),
        }),
      ),
    ).toBe("ATENCAO");
  });
});

describe("classificar", () => {
  const regras = [
    { chave: "A", rotulo: "primeira", quando: (n: number) => n > 10 },
    { chave: "B", rotulo: "segunda", quando: (n: number) => n > 5 },
  ];
  const sobra = { chave: "C", rotulo: "resto" };

  it("conta cada item uma vez só — vence a primeira regra que casa", () => {
    const categorias = classificar([20, 7, 8], regras, sobra);
    expect(categorias).toEqual([
      { chave: "A", rotulo: "primeira", quantidade: 1 },
      { chave: "B", rotulo: "segunda", quantidade: 2 },
    ]);
  });

  it("o que não casa com nenhuma regra aparece, e não some", () => {
    const categorias = classificar([20, 1, 2], regras, sobra);
    expect(categorias.find((c) => c.chave === "C")?.quantidade).toBe(2);
  });

  it("categoria vazia não ocupa linha", () => {
    expect(classificar([1], regras, sobra).map((c) => c.chave)).toEqual(["C"]);
  });
});

describe("categoriasNaoPropor", () => {
  it("separa o que nos favoreceu do que não mexeu na remuneração", () => {
    const categorias = categoriasNaoPropor([
      rec({ situacao: "NAO_PROPOR", efeito: "AUMENTA" }),
      rec({ situacao: "NAO_PROPOR", efeito: "AUMENTA" }),
      rec({ situacao: "NAO_PROPOR", efeito: "SEM_EFEITO" }),
      rec({ situacao: "NAO_PROPOR", efeito: "REDUZ" }),
    ]);

    expect(categorias.map((c) => [c.chave, c.quantidade])).toEqual([
      ["AUMENTA", 2],
      ["SEM_EFEITO", 1],
      ["MECANISMO", 1],
    ]);
  });

  it("a soma das categorias é a população — nada fica fora da conta", () => {
    const recs = [
      rec({ situacao: "NAO_PROPOR", efeito: "AUMENTA" }),
      rec({ situacao: "NAO_PROPOR", efeito: "INDETERMINADO" }),
      rec({ situacao: "NAO_PROPOR", efeito: "REDUZ" }),
    ];
    const total = categoriasNaoPropor(recs).reduce((s, c) => s + c.quantidade, 0);
    expect(total).toBe(recs.length);
  });
});

describe("categoriasPendentes", () => {
  it("a semântica não confirmada vem antes de tudo, mesmo sem impacto", () => {
    const categorias = categoriasPendentes([
      rec({ situacao: "NAO_CALCULAVEL", impacto: null, direcoesMistas: true }),
    ]);
    expect(categorias).toEqual([
      {
        chave: "SEMANTICA",
        rotulo: "Validar a semântica de parâmetros ainda não confirmados",
        quantidade: 1,
      },
    ]);
  });

  it("particiona as pendências: cada item numa frente só", () => {
    const recs = [
      rec({ situacao: "NAO_CALCULAVEL" }),
      rec({ situacao: "INVESTIGAR", direcoesMistas: true, impacto: impacto(-10) }),
      rec({ situacao: "INVESTIGAR", impacto: null }),
      rec({ situacao: "INVESTIGAR", impacto: impacto(-20) }),
    ];
    const categorias = categoriasPendentes(recs);

    expect(categorias.map((c) => [c.chave, c.quantidade])).toEqual([
      ["SEMANTICA", 1],
      ["DIRECOES", 1],
      ["IMPACTO", 1],
      ["REFERENCIA", 1],
    ]);
    expect(categorias.reduce((s, c) => s + c.quantidade, 0)).toBe(recs.length);
  });
});

describe("racionalDeApoio", () => {
  it("dá o denominador junto — “64 veículos” sozinho não se confere", () => {
    expect(
      racionalDeApoio(
        rec({ veiculosAfetados: 64, veiculosNaSerie: 71, equipment: "Cavalo" }),
      ),
    ).toBe("64 de 71 cavalos afetados");
  });

  it("os ativos que foram para o lado contrário viajam junto", () => {
    expect(
      racionalDeApoio(
        rec({
          veiculosAfetados: 12,
          veiculosNaSerie: 62,
          oQueAconteceu: {
            antes: 1,
            depois: 2,
            unidade: null,
            effectiveDate: "2026-08-01",
            sourceLabel: "EMPURRADA_1_8_2026",
            entidades: 8,
            entidadesEmSentidoOposto: 4,
            padroes: 2,
            cobertura: 0.66,
          },
        }),
      ),
    ).toBe("12 de 62 cavalos afetados · 4 para o lado contrário");
  });
});

describe("formatBrlCompacto", () => {
  it("escala o número sem esconder o sinal", () => {
    expect(formatBrlCompacto(38_412)).toBe("R$ 38,4 mil");
    expect(formatBrlCompacto(-18_400)).toBe("−R$ 18,4 mil");
    expect(formatBrlCompacto(-1_240_000)).toBe("−R$ 1,2 mi");
  });

  it("abaixo de mil sai por extenso — “R$ 0,8 mil” seria pior", () => {
    expect(formatBrlCompacto(812)).toBe("R$ 812");
    expect(formatBrlCompacto(-812)).toBe("−R$ 812");
  });
});
