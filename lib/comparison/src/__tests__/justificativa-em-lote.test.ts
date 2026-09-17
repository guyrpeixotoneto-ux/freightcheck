import { describe, expect, it } from "vitest";
import {
  alteracoesIguais,
  chaveDoContexto,
  descreverEscopoDoLote,
  lerEscopoDoLote,
  repartirAlvosDoLote,
  resumirConjuntoDoLote,
  TETO_DA_SELECAO,
  type AlteracaoDoLote,
} from "../justificativa-em-lote";
import { FILTROS_DE_IPVA_VAZIOS } from "../ipva";

/**
 * A justificativa em lote — as regras que decidem **o que** vai ser gravado.
 *
 * Nenhuma delas é de tela: são a diferença entre a lista e o recorte, o que
 * acontece com o que já está explicado, e quando duas alterações são "a mesma
 * coisa". A tela e a rota leem estas funções; se elas cedessem, a frase da
 * caixa passaria a prometer um número que a gravação não entrega.
 */

const alteracao = (over: Partial<AlteracaoDoLote> = {}): AlteracaoDoLote => ({
  id: 1,
  entityLabel: "RPG0C44",
  entityType: "CAVALO",
  variavel: "ipva",
  rotuloDaVariavel: "IPVA / Licenciamento",
  base: "7210.00",
  comparada: "4145.26",
  escrito: { base: "R$ 7.210,00", comparada: "R$ 4.145,26" },
  ...over,
});

describe("o escopo do lote", () => {
  it("lê uma seleção, sem repetidos e sem lixo", () => {
    const lido = lerEscopoDoLote({ changeIds: [3, 1, 3, "x", null, 2] });
    expect(lido.ok).toBe(true);
    expect(lido.ok && lido.valor).toEqual({ tipo: "SELECAO", changeIds: [3, 1, 2] });
  });

  it("recusa uma seleção vazia", () => {
    expect(lerEscopoDoLote({ changeIds: [] })).toMatchObject({ ok: false });
  });

  it("recusa uma seleção maior que o teto — quem tem recorte manda o recorte", () => {
    const ids = Array.from({ length: TETO_DA_SELECAO + 1 }, (_, i) => i + 1);
    expect(lerEscopoDoLote({ changeIds: ids })).toMatchObject({ ok: false });
  });

  it("lê um recorte com o par de vigências e os filtros", () => {
    const lido = lerEscopoDoLote({
      tipo: "FILTRO",
      rubrica: "ipva",
      base: "v1",
      comparada: "v2",
      filtros: { busca: "RPG", estado: "ALTERADO", soNegativos: true },
    });
    expect(lido.ok).toBe(true);
    expect(lido.ok && lido.valor).toEqual({
      tipo: "FILTRO",
      rubrica: "ipva",
      base: "v1",
      comparada: "v2",
      filtros: {
        ...FILTROS_DE_IPVA_VAZIOS,
        busca: "RPG",
        estado: "ALTERADO",
        soNegativos: true,
      },
      semAlteracao: false,
    });
  });

  it("recusa um recorte sem par — um filtro sem par não descreve universo nenhum", () => {
    expect(
      lerEscopoDoLote({ tipo: "FILTRO", rubrica: "ipva", base: "", comparada: "v2" }),
    ).toMatchObject({ ok: false });
  });

  it("recusa um estado inventado, caindo no recorte mais largo", () => {
    const lido = lerEscopoDoLote({
      tipo: "FILTRO",
      rubrica: "ipva",
      base: "v1",
      comparada: "v2",
      filtros: { estado: "QUALQUER_COISA" },
    });
    expect(lido.ok && lido.valor.tipo === "FILTRO" && lido.valor.filtros.estado).toBe(
      "TODAS",
    );
  });

  it("recusa uma rubrica cujo recorte o servidor não sabe reabrir", () => {
    expect(
      lerEscopoDoLote({ tipo: "FILTRO", rubrica: "finame", base: "v1", comparada: "v2" }),
    ).toMatchObject({ ok: false });
  });

  it("descreve o universo em português, com os filtros que valem", () => {
    const frase = descreverEscopoDoLote({
      tipo: "FILTRO",
      rubrica: "ipva",
      base: "v1",
      comparada: "v2",
      filtros: { ...FILTROS_DE_IPVA_VAZIOS, estado: "ALTERADO", tipo: "CAVALO" },
      semAlteracao: false,
    });
    expect(frase).toContain("todos os resultados do recorte");
    expect(frase).toContain("estado ALTERADO");
    expect(frase).toContain("tipo CAVALO");
    /* O que não foi filtrado não entra: "variável TODAS" seria um filtro
       inventado no registro de auditoria. */
    expect(frase).not.toContain("variável");

    expect(descreverEscopoDoLote({ tipo: "SELECAO", changeIds: [1, 2] })).toBe(
      "2 alterações escolhidas a dedo",
    );
  });
});

describe("o que já está justificado", () => {
  it("por padrão é preservado, e contado", () => {
    const r = repartirAlvosDoLote([1, 2, 3], new Set([2]), false);
    expect(r.aplicar).toEqual([1, 3]);
    expect(r.preservadas).toEqual([2]);
    expect(r.sobrescritas).toEqual([]);
  });

  it("com o aval explícito, é substituído — e a substituição é nomeada", () => {
    const r = repartirAlvosDoLote([1, 2, 3], new Set([2]), true);
    expect(r.aplicar).toEqual([1, 2, 3]);
    expect(r.preservadas).toEqual([]);
    expect(r.sobrescritas).toEqual([2]);
  });

  it("não sobra nada para aplicar quando todas já estão explicadas", () => {
    const r = repartirAlvosDoLote([1, 2], new Set([1, 2]), false);
    expect(r.aplicar).toEqual([]);
    expect(r.preservadas).toEqual([1, 2]);
  });
});

describe("o resumo do conjunto", () => {
  it("afirma o que é igual em todas e se cala no resto", () => {
    const resumo = resumirConjuntoDoLote(
      [
        alteracao({ id: 1, entityLabel: "RPG0C44" }),
        alteracao({ id: 2, entityLabel: "RPG1B56" }),
      ],
      new Set([2]),
    );
    expect(resumo).toMatchObject({
      total: 2,
      veiculos: 2,
      jaJustificadas: 1,
      variavel: "IPVA / Licenciamento",
      entityType: "CAVALO",
      base: "7210.00",
      comparada: "4145.26",
      baseEscrita: "R$ 7.210,00",
      comparadaEscrita: "R$ 4.145,26",
      mesmoContexto: true,
    });
  });

  it("cala o valor quando o conjunto tem mais de um", () => {
    const resumo = resumirConjuntoDoLote(
      [alteracao({ id: 1 }), alteracao({ id: 2, comparada: "9000.00" })],
      new Set(),
    );
    expect(resumo.base).toBe("7210.00");
    expect(resumo.baseEscrita).toBe("R$ 7.210,00");
    expect(resumo.comparada).toBeNull();
    /* O escrito acompanha o cru: calado o valor, calada a escrita dele. */
    expect(resumo.comparadaEscrita).toBeNull();
    expect(resumo.mesmoContexto).toBe(false);
  });

  it("conta placas e alterações como dois números diferentes", () => {
    const resumo = resumirConjuntoDoLote(
      [
        alteracao({ id: 1, variavel: "ipva" }),
        alteracao({ id: 2, variavel: "licenciamento", rotuloDaVariavel: "Licenciamento" }),
      ],
      new Set(),
    );
    expect(resumo.total).toBe(2);
    expect(resumo.veiculos).toBe(1);
    expect(resumo.variavel).toBeNull();
  });
});

describe("as alterações iguais", () => {
  const universo = [
    alteracao({ id: 1, entityLabel: "A" }),
    alteracao({ id: 2, entityLabel: "B" }),
    alteracao({ id: 3, entityLabel: "C", comparada: "9000.00" }),
    alteracao({ id: 4, entityLabel: "D", entityType: "CARRETA" }),
  ];

  it("acha as do mesmo contexto, incluindo a que já estava marcada", () => {
    expect(alteracoesIguais(universo, new Set([1])).map((a) => a.id)).toEqual([1, 2]);
  });

  it("não responde quando há mais de um contexto marcado", () => {
    expect(alteracoesIguais(universo, new Set([1, 3]))).toEqual([]);
  });

  it("não responde sem nada marcado", () => {
    expect(alteracoesIguais(universo, new Set())).toEqual([]);
  });

  it("o tipo de ativo separa: mesma variável e mesmos valores não bastam", () => {
    expect(alteracoesIguais(universo, new Set([4])).map((a) => a.id)).toEqual([4]);
  });

  it("ausência de valor não é zero", () => {
    expect(chaveDoContexto(alteracao({ base: null }))).not.toBe(
      chaveDoContexto(alteracao({ base: "0" })),
    );
  });
});
