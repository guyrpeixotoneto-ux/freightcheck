import { describe, expect, it } from "vitest";
import {
  cargosDoDepartamento,
  departamentoEmVista,
} from "@/components/configuracoes/usuarios";

/**
 * O DEPARTAMENTO NA GAVETA DE CONTA — o campo que faltava, e a razão de ele não
 * ser uma coluna nova.
 *
 * Quem cadastra alguém sabe em que departamento a pessoa entra, e a gaveta não
 * perguntava. O que ela não pode fazer é guardar a resposta duas vezes:
 * `cargo.departamento_id` já diz onde cada cargo está lotado, e um
 * `departamento_id` na conta permitiria alguém "no Comercial" com um cargo da
 * Controladoria — duas respostas para a mesma pergunta.
 *
 * Então o campo escolhe **através do cargo**, e o que ele decide são duas
 * funções puras: que departamento a caixa de cima mostra, e que cargos a de
 * baixo oferece. É isso que roda aqui — o resto é `Select`, e `Select` não é o
 * que quebra.
 */

const CARGOS = [
  { id: "c1", nome: "Analista de Negócios", departamentoId: "d-comercial" },
  { id: "c2", nome: "Gerente Comercial", departamentoId: "d-comercial" },
  { id: "c3", nome: "Controller", departamentoId: "d-controladoria" },
  /* O cargo que ninguém lotou ainda — o estado inicial de todo cadastro. */
  { id: "c4", nome: "Estagiário", departamentoId: null },
];

describe("que departamento a caixa de cima mostra", () => {
  it("sem escolha e sem cargo, nenhum — e isso é 'todos', não uma lacuna", () => {
    expect(departamentoEmVista(null, null)).toBe("");
  });

  it("sem escolha, o do cargo: abrir a edição de quem tem cargo já mostra onde ela está", () => {
    expect(departamentoEmVista(null, CARGOS[0])).toBe("d-comercial");
  });

  it("o escolhido à mão ganha do cargo — é ele que está filtrando a lista", () => {
    expect(departamentoEmVista("d-controladoria", CARGOS[0])).toBe("d-controladoria");
  });

  it("'todos' escolhido à mão não volta a seguir o cargo: `\"\"` é escolha, `null` é ausência", () => {
    expect(departamentoEmVista("", CARGOS[0])).toBe("");
  });

  it("cargo sem departamento mostra a caixa vazia, e não inventa um", () => {
    expect(departamentoEmVista(null, CARGOS[3])).toBe("");
  });
});

describe("que cargos a caixa de baixo oferece", () => {
  it("sem departamento escolhido, todos — trinta cargos continuam trinta", () => {
    expect(cargosDoDepartamento(CARGOS, "", "").map((c) => c.id)).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
    ]);
  });

  it("com departamento, só os dele — que é o gesto de quem cadastra", () => {
    expect(cargosDoDepartamento(CARGOS, "d-comercial", "").map((c) => c.id)).toEqual([
      "c1",
      "c2",
    ]);
  });

  it("o cargo que já está na conta entra sempre, mesmo fora do filtro", () => {
    /* Sem isto, a gaveta de edição de quem tem `Estagiário` — cargo sem
       departamento — abriria mostrando "Sem cargo" para quem tem cargo. */
    expect(cargosDoDepartamento(CARGOS, "d-comercial", "c4").map((c) => c.id)).toEqual([
      "c1",
      "c2",
      "c4",
    ]);
  });

  it("e não entra duas vezes quando já pertence ao departamento", () => {
    expect(cargosDoDepartamento(CARGOS, "d-comercial", "c1").map((c) => c.id)).toEqual([
      "c1",
      "c2",
    ]);
  });

  it("departamento sem cargo nenhum devolve lista vazia — a tela diz isso em vez de mentir", () => {
    expect(cargosDoDepartamento(CARGOS, "d-logistica", "")).toEqual([]);
  });
});
