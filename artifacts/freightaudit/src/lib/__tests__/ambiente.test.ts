import { describe, expect, it } from "vitest";
import {
  AMBIENTES,
  ambienteDe,
  descricaoDoAmbiente,
  destinoDaRaiz,
  ENTRADA_DA_AUDITORIA,
  RESUMO_EXECUTIVO,
} from "../ambiente";

/**
 * A regra que separa os dois espaços de trabalho é uma só — tudo sob
 * `/fechamento` é Fechamento, o resto é Auditoria — e este teste a guarda nos
 * pontos onde ela quebraria em silêncio: o prefixo que casa por engano
 * (`/fechamentos` não é o ambiente) e a raiz exata.
 */
describe("ambienteDe", () => {
  it("lê a raiz e tudo abaixo dela como Fechamento", () => {
    expect(ambienteDe("/fechamento")).toBe("fechamento");
    expect(ambienteDe("/fechamento/apuracao")).toBe("fechamento");
    expect(ambienteDe("/fechamento/competencias")).toBe("fechamento");
  });

  it("lê todo o resto como Auditoria — inclusive o quase-prefixo", () => {
    expect(ambienteDe("/")).toBe("auditoria");
    expect(ambienteDe("/alteracoes")).toBe("auditoria");
    expect(ambienteDe("/dre/abc-123")).toBe("auditoria");
    expect(ambienteDe("/fechamentos")).toBe("auditoria");
  });
});

describe("os ambientes", () => {
  it("são dois, e a home de cada um vive no ambiente que ela abre", () => {
    expect(AMBIENTES.map((a) => a.id)).toEqual(["auditoria", "fechamento"]);
    for (const ambiente of AMBIENTES) {
      expect(ambienteDe(ambiente.home)).toBe(ambiente.id);
    }
  });

  it("descreve cada id com o próprio registro", () => {
    expect(descricaoDoAmbiente("auditoria").nome).toBe("Auditoria");
    expect(descricaoDoAmbiente("fechamento").nome).toBe("Fechamento");
  });

  /*
    Os dois ambientes abrem na mesma altura — o conjunto antes da unidade —, e é
    isso que este teste guarda. Ele quebra no dia em que a home da Auditoria
    voltar a ser uma tela de unidade, que é exatamente a regressão que a mudança
    de entrada existiu para desfazer.
  */
  it("abre a Auditoria pela Visão Gerencial, como o Fechamento", () => {
    expect(descricaoDoAmbiente("auditoria").home).toBe(ENTRADA_DA_AUDITORIA);
    expect(descricaoDoAmbiente("fechamento").home).toBe("/fechamento");
  });
});

/**
 * A porta e o contrato dos links antigos.
 *
 * As duas metades da regra estão aqui porque só juntas ela faz sentido: a raiz
 * nua abre o acervo, e a raiz com recorte devolve quem chegou ao Resumo
 * executivo — que era o dono do endereço quando o link foi colado.
 */
describe("destinoDaRaiz", () => {
  it("sem consulta, abre a Visão Gerencial", () => {
    expect(destinoDaRaiz("")).toBe(ENTRADA_DA_AUDITORIA);
  });

  it("com recorte, encaminha ao Resumo executivo sem perder um parâmetro", () => {
    expect(destinoDaRaiz("period=2026-08-01&scopeHash=abc")).toBe(
      `${RESUMO_EXECUTIVO}?period=2026-08-01&scopeHash=abc`,
    );
  });

  /*
    O `?` de abertura entra ou não conforme quem chama: `useSearch` do wouter
    entrega a consulta sem ele, `location.search` entrega com. Repetido, o
    endereço sairia com `??` e a primeira chave viraria "?period" — o recorte
    chegaria à tela como se ninguém o tivesse escrito.
  */
  it("aceita a consulta com e sem o ponto de interrogação", () => {
    expect(destinoDaRaiz("?period=2026-08-01")).toBe(
      `${RESUMO_EXECUTIVO}?period=2026-08-01`,
    );
    expect(destinoDaRaiz("?")).toBe(ENTRADA_DA_AUDITORIA);
  });

  it("manda para dentro da Auditoria, nunca de volta para a raiz", () => {
    for (const busca of ["", "?", "period=2026-08-01", "?scopeHash=abc"]) {
      const destino = destinoDaRaiz(busca);
      expect(destino).not.toBe("/");
      expect(ambienteDe(destino.split("?")[0])).toBe("auditoria");
    }
  });
});
