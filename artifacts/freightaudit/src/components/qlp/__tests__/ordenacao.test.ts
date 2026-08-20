import { describe, expect, it } from "vitest";
import {
  CHAVE_DO_CARGO,
  chaveDoAtributo,
  mesmaChave,
  ordenarCargos,
  ordenarUnidades,
  primeiroSentido,
  proximaOrdem,
  type OrdemDoQuadro,
} from "../ordenacao";
import type { CargoDoQuadro, UnidadeDoQuadro, ValorDeFato } from "../tipos";

/**
 * A ordem da tabela do quadro.
 *
 * O que se prova aqui é sobretudo uma coisa: **ausência não é zero**. A tabela
 * já separa o valor do "—" célula a célula, e a ordenação é o lugar onde essa
 * distinção some sem ninguém ver — basta o comparador somar `null` como zero
 * para o cargo que o export não preencheu aparecer no fundo da lista como o
 * mais barato do quadro. Os testes de salário cobram a ausência no fim **nos
 * dois sentidos**, que é a única posição que não afirma nada sobre o valor que
 * ela não tem.
 *
 * O segundo é a ordem valer por unidade: o quadro é uma seção por unidade, e
 * ordenar por salário ordena os cargos de CAMAÇARI dentro de CAMAÇARI — nunca
 * mistura unidade com unidade nem reordena as seções.
 */

const SALARIO = "qlp_administrativo.salario_ordenados";
const QUANTIDADE = "qlp_administrativo.quantidade_ordenados";

function cargo(nome: string, valores: Record<string, ValorDeFato> = {}): CargoDoQuadro {
  return {
    entityId: `id-${nome}`,
    cargo: nome,
    unidadeCnpj: "07526557001505",
    unidadeCnpjLegivel: "07.526.557/0015-05",
    valores,
  };
}

function unidade(nome: string, cargos: CargoDoQuadro[]): UnidadeDoQuadro {
  return { cnpj: `cnpj-${nome}`, cnpjLegivel: `cnpj-${nome}`, nome, cargos };
}

const nomes = (cargos: CargoDoQuadro[]) => cargos.map((c) => c.cargo);

describe("primeiroSentido", () => {
  it("estreia número do maior para o menor, e texto de A a Z", () => {
    expect(primeiroSentido(chaveDoAtributo(SALARIO), { dataType: "NUMERIC" })).toBe("desc");
    expect(primeiroSentido(chaveDoAtributo("qlp_administrativo.diretoria"), { dataType: "TEXT" }))
      .toBe("asc");
    expect(primeiroSentido(CHAVE_DO_CARGO)).toBe("asc");
  });
});

describe("proximaOrdem", () => {
  it("estreia o salário do maior para o menor, e inverte no segundo clique", () => {
    // Quem clica em salário quer ver o que pesa na folha, não o que não pesa.
    const chave = chaveDoAtributo(SALARIO);
    const primeiro = proximaOrdem(null, chave, { dataType: "NUMERIC" });
    expect(primeiro).toEqual({ chave, sentido: "desc" });
    expect(proximaOrdem(primeiro, chave, { dataType: "NUMERIC" })).toEqual({
      chave,
      sentido: "asc",
    });
  });

  it("estreia o nome do cargo de A a Z", () => {
    expect(proximaOrdem(null, CHAVE_DO_CARGO)).toEqual({
      chave: CHAVE_DO_CARGO,
      sentido: "asc",
    });
  });

  it("o terceiro clique devolve a ordem da casa", () => {
    // Sem esta volta não há como desfazer uma ordenação a não ser recarregando
    // a tela — e a ordem por nome é a única em que o leitor reencontra um cargo
    // onde ele já sabia que estava.
    for (const chave of [CHAVE_DO_CARGO, chaveDoAtributo(SALARIO)]) {
      const um = proximaOrdem(null, chave, { dataType: "NUMERIC" });
      const dois = proximaOrdem(um, chave, { dataType: "NUMERIC" });
      expect(proximaOrdem(dois, chave, { dataType: "NUMERIC" })).toBeNull();
    }
  });

  it("trocar de coluna recomeça pelo sentido de estreia daquela coluna", () => {
    const emSalario: OrdemDoQuadro = { chave: chaveDoAtributo(SALARIO), sentido: "asc" };
    expect(proximaOrdem(emSalario, CHAVE_DO_CARGO)).toEqual({
      chave: CHAVE_DO_CARGO,
      sentido: "asc",
    });
  });

  it("duas colunas de atributo não são a mesma coluna", () => {
    // O `code` é o que separa "salário ordenados" de "quantidade ordenados" —
    // um cabeçalho que se achasse o outro inverteria o sentido do vizinho.
    expect(mesmaChave(chaveDoAtributo(SALARIO), chaveDoAtributo(QUANTIDADE))).toBe(false);
    expect(mesmaChave(chaveDoAtributo(SALARIO), chaveDoAtributo(SALARIO))).toBe(true);
    expect(mesmaChave(CHAVE_DO_CARGO, chaveDoAtributo(SALARIO))).toBe(false);
    expect(mesmaChave(undefined, CHAVE_DO_CARGO)).toBe(false);
  });
});

describe("ordenarCargos", () => {
  const quadro = [
    cargo("ANALISTA", { [SALARIO]: 8000 }),
    cargo("AUXILIAR", { [SALARIO]: 3000 }),
    cargo("GERENTE", { [SALARIO]: 20000 }),
  ];

  it("sem ordem pedida, devolve a lista como chegou", () => {
    expect(ordenarCargos(quadro, null)).toBe(quadro);
  });

  it("não altera a lista que recebeu", () => {
    ordenarCargos(quadro, { chave: chaveDoAtributo(SALARIO), sentido: "desc" });
    expect(nomes(quadro)).toEqual(["ANALISTA", "AUXILIAR", "GERENTE"]);
  });

  it("ordena pelo valor da coluna, nos dois sentidos", () => {
    expect(nomes(ordenarCargos(quadro, { chave: chaveDoAtributo(SALARIO), sentido: "desc" })))
      .toEqual(["GERENTE", "ANALISTA", "AUXILIAR"]);
    expect(nomes(ordenarCargos(quadro, { chave: chaveDoAtributo(SALARIO), sentido: "asc" })))
      .toEqual(["AUXILIAR", "ANALISTA", "GERENTE"]);
  });

  it("põe a ausência no fim nos dois sentidos — ela não é zero", () => {
    // Um cargo sem salário no export não é o cargo mais barato do quadro: é o
    // cargo cujo salário ninguém escreveu. Zero é uma afirmação, e a célula que
    // mostra "—" existe para não fazê-la.
    const comBuraco = [
      cargo("SEM VALOR", {}),
      cargo("ANALISTA", { [SALARIO]: 8000 }),
      cargo("NULO EXPLICITO", { [SALARIO]: null }),
      cargo("ZERADO", { [SALARIO]: 0 }),
    ];
    expect(nomes(ordenarCargos(comBuraco, { chave: chaveDoAtributo(SALARIO), sentido: "desc" })))
      .toEqual(["ANALISTA", "ZERADO", "SEM VALOR", "NULO EXPLICITO"]);
    expect(nomes(ordenarCargos(comBuraco, { chave: chaveDoAtributo(SALARIO), sentido: "asc" })))
      .toEqual(["ZERADO", "ANALISTA", "SEM VALOR", "NULO EXPLICITO"]);
  });

  it("o empate mantém a ordem de chegada, em qualquer sentido", () => {
    const empatados = [
      cargo("ANALISTA", { [SALARIO]: 5000 }),
      cargo("AUXILIAR", { [SALARIO]: 5000 }),
      cargo("COORDENADOR", { [SALARIO]: 5000 }),
    ];
    const ordenados = { chave: chaveDoAtributo(SALARIO), sentido: "desc" } as const;
    expect(nomes(ordenarCargos(empatados, ordenados))).toEqual([
      "ANALISTA",
      "AUXILIAR",
      "COORDENADOR",
    ]);
    expect(nomes(ordenarCargos(empatados, { ...ordenados, sentido: "asc" }))).toEqual([
      "ANALISTA",
      "AUXILIAR",
      "COORDENADOR",
    ]);
  });

  it("ordena pelo nome do cargo com número lido como número", () => {
    // `CARGO 10` depois de `CARGO 9`, e não antes — a régua é a do servidor.
    const numerados = [cargo("CARGO 10"), cargo("CARGO 9"), cargo("CARGO 1")];
    expect(nomes(ordenarCargos(numerados, { chave: CHAVE_DO_CARGO, sentido: "asc" }))).toEqual([
      "CARGO 1",
      "CARGO 9",
      "CARGO 10",
    ]);
    expect(nomes(ordenarCargos(numerados, { chave: CHAVE_DO_CARGO, sentido: "desc" }))).toEqual([
      "CARGO 10",
      "CARGO 9",
      "CARGO 1",
    ]);
  });

  it("ordena texto pela régua pt-BR, com acento no lugar do alfabeto", () => {
    const acentuados = [cargo("MECÂNICO"), cargo("MOTORISTA"), cargo("ADMINISTRATIVO")];
    expect(nomes(ordenarCargos(acentuados, { chave: CHAVE_DO_CARGO, sentido: "asc" }))).toEqual([
      "ADMINISTRATIVO",
      "MECÂNICO",
      "MOTORISTA",
    ]);
  });

  it("ordena booleano como a célula o escreve — Não antes de Sim", () => {
    const chave = chaveDoAtributo("qlp_administrativo.ativo");
    const flags = [
      cargo("SIM", { "qlp_administrativo.ativo": true }),
      cargo("NAO", { "qlp_administrativo.ativo": false }),
    ];
    expect(nomes(ordenarCargos(flags, { chave, sentido: "asc" }))).toEqual(["NAO", "SIM"]);
    expect(nomes(ordenarCargos(flags, { chave, sentido: "desc" }))).toEqual(["SIM", "NAO"]);
  });

  it("coluna de tipos misturados sai numa ordem, e não ao acaso", () => {
    // `MIXED` existe no catálogo. Um comparador que devolvesse zero ali
    // deixaria a ordem ao acaso do motor; aqui compara-se o que a célula
    // mostraria, que é sempre texto.
    const chave = chaveDoAtributo("qlp_administrativo.misturado");
    const misturados = [
      cargo("TEXTO", { "qlp_administrativo.misturado": "B" }),
      cargo("NUMERO", { "qlp_administrativo.misturado": 2 }),
      cargo("OUTRO TEXTO", { "qlp_administrativo.misturado": "A" }),
    ];
    const asc = nomes(ordenarCargos(misturados, { chave, sentido: "asc" }));
    expect(asc).toEqual(["NUMERO", "OUTRO TEXTO", "TEXTO"]);
    expect(nomes(ordenarCargos(misturados, { chave, sentido: "desc" }))).toEqual([...asc].reverse());
  });
});

describe("ordenarUnidades", () => {
  const unidades = [
    unidade("CAMAÇARI", [
      cargo("ANALISTA", { [SALARIO]: 8000 }),
      cargo("GERENTE", { [SALARIO]: 20000 }),
    ]),
    unidade("ALAGOINHAS", [
      cargo("AUXILIAR", { [SALARIO]: 3000 }),
      cargo("COORDENADOR", { [SALARIO]: 12000 }),
    ]),
  ];

  it("sem ordem pedida, devolve o mesmo array — o `useMemo` da tela sai barato", () => {
    expect(ordenarUnidades(unidades, null)).toBe(unidades);
  });

  it("ordena dentro de cada unidade sem misturar uma com a outra", () => {
    const ordenadas = ordenarUnidades(unidades, {
      chave: chaveDoAtributo(SALARIO),
      sentido: "desc",
    });
    expect(nomes(ordenadas[0].cargos)).toEqual(["GERENTE", "ANALISTA"]);
    expect(nomes(ordenadas[1].cargos)).toEqual(["COORDENADOR", "AUXILIAR"]);
  });

  it("não reordena as seções entre si — a sequência das unidades é do servidor", () => {
    // O cabeçalho da tabela pede a ordem dos cargos. A ordem das unidades é
    // outra pergunta, e ninguém a fez.
    const ordenadas = ordenarUnidades(unidades, {
      chave: chaveDoAtributo(SALARIO),
      sentido: "desc",
    });
    expect(ordenadas.map((u) => u.nome)).toEqual(["CAMAÇARI", "ALAGOINHAS"]);
  });

  it("não altera as unidades que recebeu", () => {
    ordenarUnidades(unidades, { chave: chaveDoAtributo(SALARIO), sentido: "desc" });
    expect(nomes(unidades[0].cargos)).toEqual(["ANALISTA", "GERENTE"]);
  });
});
