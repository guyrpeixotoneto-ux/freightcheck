// @vitest-environment jsdom
//
// A comparação do QLP depois que a variável virou o cabeçalho do cartão.
//
// Antes, a variável era uma coluna: "Total da remuneração, sem o abono" se
// repetia linha a linha, o ⓘ do subtotal junto com ela, e a ordem por diferença
// misturava reais com quantidade e fator na mesma coluna — que é por que
// `corDaDiferenca` só pinta dinheiro. O que estes casos prendem é o que o
// agrupamento prometeu: um cartão por variável, a unidade dita uma vez no alto,
// o aviso do subtotal dito uma vez, a ordem dos cartões vinda do motor e a ordem
// de dentro intacta — sem perder nenhuma linha no caminho.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AlteracoesDaVariavelDeQlp,
  LinhaDeQlpComparado,
} from "@workspace/comparison/qlp-comparacao";

import { TooltipProvider } from "@/components/ui/tooltip";
import { agruparPorVariavel } from "@/lib/qlp-comparacao";

import { CartoesDaComparacaoDeQlp } from "../tabela";

/*
  `TooltipProvider` está aqui porque está em `App.tsx`: a justificativa escrita
  aparece num tooltip, e sem o provedor o Radix recusa a renderização.
*/

afterEach(cleanup);

const ROTULOS = {
  chave28: "07526557001505_CERV · Cargo: MOTORISTA 28 | Turno: EQUIPE ATIVA 12x36",
  chave40: "07526557001505_CERV · Cargo: MOTORISTA 40 | Turno: EQUIPE ATIVA 8x16",
};

const linha = (over: Partial<LinhaDeQlpComparado> = {}): LinhaDeQlpComparado => ({
  id: 1,
  entityLabel: "chave28",
  entityType: "QLP_OPERACIONAL",
  quadro: "OPERACIONAL",
  variavel: "total_da_remuneracao",
  rotuloDaVariavel: "Total da remuneração, sem o abono",
  medida: "DINHEIRO",
  papel: "SUBTOTAL",
  rubrica: "subtotais",
  attributeCode: "qlp_operacional.total_da_remuneracao",
  base: "13064.45",
  comparada: "13718.06",
  diferenca: 653.61,
  variacao: 5,
  estado: "ALTERADO",
  motivo: null,
  foraDaSoma: "Subtotal com o abono **subtraído**. Existe ao lado do de baixo.",
  ...over,
});

/** A diária: outra variável, mesma unidade, e nenhum aviso de subtotal. */
const DIARIA = linha({
  id: 9,
  variavel: "diaria",
  rotuloDaVariavel: "Diária",
  papel: "MONTANTE",
  rubrica: "outros_beneficios",
  attributeCode: "qlp_operacional.diaria",
  base: "646.49",
  comparada: "1317.15",
  diferenca: 670.66,
  variacao: 103.74,
  foraDaSoma: null,
});

/** O efetivo: a variável que **não** é dinheiro. */
const EFETIVO = linha({
  id: 20,
  variavel: "efetivo_total",
  rotuloDaVariavel: "Efetivo total da unidade",
  medida: "QUANTIDADE",
  papel: "QUANTIDADE",
  rubrica: "dimensionamento",
  attributeCode: "qlp_operacional.efetivo_total",
  base: "40",
  comparada: "42",
  diferenca: 2,
  variacao: 5,
  foraDaSoma: null,
});

const RECORTE = [
  linha(),
  linha({ id: 2, entityLabel: "chave40", base: "15195.42", comparada: "15955.17" }),
  DIARIA,
  EFETIVO,
];

/* A ordem que a resposta traz: da variável mais alterada para a menos. */
const ORDEM = [
  { variavel: "total_da_remuneracao", rotulo: "Total da remuneração, sem o abono" },
  { variavel: "diaria", rotulo: "Diária" },
  { variavel: "efetivo_total", rotulo: "Efetivo total da unidade" },
].map((v) => ({
  ...v,
  medida: "DINHEIRO",
  papel: "MONTANTE",
  rubrica: null,
  alteracoes: 1,
  foraDaSoma: null,
})) as AlteracoesDaVariavelDeQlp[];

function montar(linhas = RECORTE, ordem = ORDEM, onAbrir = vi.fn()) {
  render(
    <TooltipProvider>
      <CartoesDaComparacaoDeQlp
        grupos={agruparPorVariavel(linhas, ordem)}
        rotulos={ROTULOS}
        onAbrir={onAbrir}
      />
    </TooltipProvider>,
  );
  return { onAbrir };
}

const titulosDosCartoes = () =>
  screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);

describe("o agrupamento por variável", () => {
  it("dá um cartão a cada variável, e nenhuma linha se perde", () => {
    montar();
    expect(screen.getAllByRole("region")).toHaveLength(3);
    /*
      A linha do cargo é clicável desde a tabela plana, e por isso se apresenta
      como `button` e não como `row` — quem conta linhas conta os botões.
    */
    expect(screen.getAllByRole("button", { name: /^Abrir as variáveis de / })).toHaveLength(
      RECORTE.length,
    );
  });

  it("põe os cartões na ordem que o motor deu, e não em outra", () => {
    montar();
    expect(titulosDosCartoes()).toEqual([
      "Total da remuneração, sem o abono",
      "Diária",
      "Efetivo total da unidade",
    ]);
  });

  it("não muda a ordem de dentro do cartão — ela é a que chegou, por diferença", () => {
    montar();
    const cartao = screen.getByRole("region", { name: "Total da remuneração, sem o abono" });
    const cargos = within(cartao)
      .getAllByRole("button", { name: /^Abrir as variáveis de / })
      .map((tr) => tr.getAttribute("aria-label"));
    expect(cargos).toEqual([
      "Abrir as variáveis de MOTORISTA 28",
      "Abrir as variáveis de MOTORISTA 40",
    ]);
  });

  it("manda para o fim a variável que a ordem do motor não conhece, em vez de escondê-la", () => {
    montar(RECORTE, [ORDEM[1]!]);
    expect(titulosDosCartoes()[0]).toBe("Diária");
    expect(titulosDosCartoes()).toHaveLength(3);
  });
});

describe("o cabeçalho do cartão", () => {
  it("diz a unidade uma vez, e é a da variável — não a do vizinho", () => {
    montar();
    const dinheiro = screen.getByRole("region", { name: "Diária" });
    expect(within(dinheiro).getByText("R$")).toBeTruthy();
    const quantidade = screen.getByRole("region", { name: "Efetivo total da unidade" });
    expect(within(quantidade).getByText("quantidade")).toBeTruthy();
  });

  it("conta os cargos do cartão, no singular quando é um só", () => {
    montar();
    const varios = screen.getByRole("region", { name: "Total da remuneração, sem o abono" });
    expect(within(varios).getByText("2 cargos")).toBeTruthy();
    const um = screen.getByRole("region", { name: "Diária" });
    expect(within(um).getByText("1 cargo")).toBeTruthy();
  });

  it("escreve o aviso do subtotal uma vez, com a ênfase da fonte e sem os asteriscos", () => {
    montar();
    const cartao = screen.getByRole("region", { name: "Total da remuneração, sem o abono" });
    expect(within(cartao).getByText("Subtotal")).toBeTruthy();
    expect(within(cartao).getByText("subtraído").tagName).toBe("STRONG");
    expect(cartao.textContent).toContain("Subtotal com o abono subtraído.");
    expect(cartao.textContent).not.toContain("**");
  });

  it("não inventa selo de subtotal para a variável que é parcela", () => {
    montar();
    const diaria = screen.getByRole("region", { name: "Diária" });
    expect(within(diaria).queryByText("Subtotal")).toBeNull();
  });
});

describe("o que o cartão não mudou", () => {
  it("tira a coluna Variável do corpo e mantém as outras oito", () => {
    montar();
    const cartao = screen.getByRole("region", { name: "Diária" });
    const colunas = within(cartao)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(colunas).toEqual([
      "Cargo",
      "Classificação",
      "De",
      "Para",
      "Diferença",
      "Variação %",
      "Status",
      "Justificativa",
    ]);
  });

  it("dá a todos os cartões a mesma grade, para a coluna se ler de cima a baixo", () => {
    montar();
    const larguras = screen.getAllByRole("region").map((s) =>
      [...s.querySelectorAll("col")].map((c) => (c as HTMLTableColElement).style.width),
    );
    expect(larguras[0]).toEqual(larguras[1]);
    expect(larguras[0]).toEqual(larguras[2]);
  });

  it("continua abrindo a gaveta do cargo pela chave, no clique e no teclado", () => {
    const { onAbrir } = montar();
    const cartao = screen.getByRole("region", { name: "Diária" });
    const linhaDoCargo = within(cartao).getByRole("button", {
      name: "Abrir as variáveis de MOTORISTA 28",
    });
    fireEvent.click(linhaDoCargo);
    fireEvent.keyDown(linhaDoCargo, { key: "Enter" });
    expect(onAbrir).toHaveBeenCalledTimes(2);
    expect(onAbrir).toHaveBeenCalledWith("chave28");
  });

  it("dá o selo com texto, e não só a cor", () => {
    montar();
    expect(screen.getAllByText("Alterado")).toHaveLength(RECORTE.length);
  });
});
