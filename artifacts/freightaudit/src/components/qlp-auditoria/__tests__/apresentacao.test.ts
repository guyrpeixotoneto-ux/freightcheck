import { describe, expect, it } from "vitest";
import type { ConferenciaDaLinha } from "@workspace/comparison/qlp";
import {
  FILTROS_VAZIOS,
  contagemPorVeredito,
  escreverDiferenca,
  escreverQuantidade,
  filtrar,
  linhasDoCsv,
} from "@/lib/qlp-auditoria";

/**
 * O que estes testes prendem.
 *
 * A conta mora no núcleo e já tem testes lá. O que se prende aqui é a camada de
 * tela, e ela tem duas responsabilidades que podem sair erradas sem que nenhuma
 * conta mude:
 *
 * 1. **O filtro por conta é a fila de trabalho desta tela.** "Os cargos em que a
 *    despesa de telefonia não fecha" é uma pergunta que alguém leva para a
 *    transportadora; um filtro que devolvesse também os cargos sem base
 *    transformaria a fila numa lista.
 * 2. **O sinal da diferença é a informação.** Declarar mais do que a conta
 *    produz e declarar menos são duas conversas, e "R$ 2.400,00" sozinho não
 *    distingue as duas.
 */

const conta = (
  chave: string,
  confere: boolean | null,
  diferenca: number | null = null,
): ConferenciaDaLinha["contas"][number] => ({
  conta: chave,
  rotulo: chave,
  forma: "PRODUTO",
  esperado: confere === null ? null : 7_200,
  declarado: confere === null ? null : 7_200 + (diferenca ?? 0),
  diferenca,
  confere,
});

const linha = (
  chave: string,
  nome: string | null,
  contas: ConferenciaDaLinha["contas"],
): ConferenciaDaLinha => ({
  chave,
  nome,
  contas,
  conferem: contas.filter((c) => c.confere === true).length,
  divergem: contas.filter((c) => c.confere === false).length,
  semBase: contas.filter((c) => c.confere === null).length,
  veredito:
    contas.some((c) => c.confere === false)
      ? "DIVERGE"
      : contas.some((c) => c.confere === true)
        ? "CONFERE"
        : "BASE_INSUFICIENTE",
});

const QUADRO: ConferenciaDaLinha[] = [
  linha("CH1", "AUXILIAR ADM", [conta("ordenados", true), conta("telefonia", true)]),
  linha("CH2", "SUPERVISOR", [conta("ordenados", true), conta("telefonia", false, 60)]),
  linha("CH3", "ANALISTA", [conta("ordenados", null), conta("telefonia", null)]),
];

describe("o filtro da tabela", () => {
  it("recorta pelos cargos em que uma conta específica não fecha", () => {
    const so = filtrar(QUADRO, { ...FILTROS_VAZIOS, conta: "telefonia" });
    expect(so.map((l) => l.chave)).toEqual(["CH2"]);
  });

  it("não devolve, no filtro de conta, o cargo que só está sem base", () => {
    /* Sem base não é o mesmo que não fechar: um é dado que falta, o outro é
       conta que discorda, e a fila de trabalho é a segunda. */
    const so = filtrar(QUADRO, { ...FILTROS_VAZIOS, conta: "ordenados" });
    expect(so).toHaveLength(0);
  });

  it("busca pelo nome legível e pela chave normalizada", () => {
    expect(filtrar(QUADRO, { ...FILTROS_VAZIOS, busca: "supervisor" })).toHaveLength(1);
    expect(filtrar(QUADRO, { ...FILTROS_VAZIOS, busca: "ch3" })).toHaveLength(1);
  });

  it("conta cada veredito sobre o mesmo recorte da tabela", () => {
    const contagem = contagemPorVeredito(QUADRO, FILTROS_VAZIOS);
    expect(contagem.TODOS).toBe(3);
    expect(contagem.CONFERE).toBe(1);
    expect(contagem.DIVERGE).toBe(1);
    expect(contagem.BASE_INSUFICIENTE).toBe(1);
  });
});

describe("a escrita", () => {
  it("carimba o sinal da diferença, que é a informação", () => {
    expect(escreverDiferenca(2_400)).toContain("+");
    expect(escreverDiferenca(-2_400)).toContain("−");
    expect(escreverDiferenca(null)).toBe("—");
  });

  it("escreve quantidade inteira sem casas, e fracionária com elas", () => {
    expect(escreverQuantidade(3)).toBe("3");
    /* `formatNumber` corta o zero à direita: 1,4 — e a fração, que é a
       informação, continua na tela. */
    expect(escreverQuantidade(1.4)).toBe("1,4");
    expect(escreverQuantidade(null)).toBe("—");
  });
});

describe("o CSV", () => {
  it("escreve uma linha por conta, e não uma por cargo", () => {
    const linhas = linhasDoCsv(QUADRO, "ADMINISTRATIVO");
    /* Cabeçalho + três cargos × duas contas. */
    expect(linhas).toHaveLength(1 + 6);
  });

  /*
    Uma coluna por fato também no arquivo: a chave legível do quadro real traz
    unidade, cargo e a classificação grudada dentro da célula do cargo, e quem
    abre o CSV numa planilha filtra por cada uma sem fatiar texto.
  */
  it("abre a chave legível em unidade, cargo e classificação", () => {
    const glued = linha(
      "CH4",
      "07526557001505_CERV · Cargo: Conferente | Classificação: Classificação: CARREGAMENTO",
      [conta("ordenados", true)],
    );
    expect(linhasDoCsv([glued], "ADMINISTRATIVO")[1].slice(0, 3)).toEqual([
      "07526557001505_CERV",
      "Conferente",
      "CARREGAMENTO",
    ]);
  });

  it("sem unidade na chave, o cargo continua sendo o nome legível inteiro", () => {
    expect(linhasDoCsv([QUADRO[0]], "ADMINISTRATIVO")[1][1]).toBe("AUXILIAR ADM");
  });

  it("deixa a célula vazia onde não há número, em vez de escrever zero", () => {
    const linhas = linhasDoCsv([QUADRO[2]], "ADMINISTRATIVO");
    expect(linhas[1][6]).toBe("");
    expect(linhas[1][9]).toBe("Base insuficiente");
  });
});
