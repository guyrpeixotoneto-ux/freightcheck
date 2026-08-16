import { describe, expect, it } from "vitest";
import {
  emptyTicketFilters,
  proximaOrdem,
  toTicketQuery,
  type OrdemChamados,
} from "../ticket-table";

/**
 * O que a lista de chamados pede ao servidor.
 *
 * A conta do rodapé é testada em `lib/__tests__/paginacao.test.ts`; o que se
 * prova aqui é o outro lado da mesma decisão. Com a lista paginada, ordenar
 * deixou de ser assunto da tabela: se o `sort` não sair na query, o cabeçalho
 * ordena as cem linhas que chegaram e diz, com a mesma seta, que ordenou as mil
 * e duzentas.
 */

describe("toTicketQuery", () => {
  it("manda a ordenação junto com a página", () => {
    const query = new URLSearchParams(
      toTicketQuery(emptyTicketFilters, {}, { porPagina: 100, pagina: 3 }, {
        key: "impacto",
        dir: "desc",
      }),
    );
    expect(query.get("sort")).toBe("impacto");
    expect(query.get("dir")).toBe("desc");
    expect(query.get("limit")).toBe("100");
    expect(query.get("offset")).toBe("200");
  });

  it("sem ordem pedida, não manda ordem nenhuma", () => {
    // A ausência é o que faz o servidor devolver a ordem de casa — a de
    // materialidade. Mandar um `sort` vazio pediria outra coisa.
    const query = new URLSearchParams(
      toTicketQuery(emptyTicketFilters, {}, { porPagina: 100, pagina: 1 }),
    );
    expect(query.has("sort")).toBe(false);
    expect(query.has("dir")).toBe(false);
  });

  it("não perde os filtros nem o envio escolhido ao ordenar", () => {
    const query = new URLSearchParams(
      toTicketQuery(
        { ...emptyTicketFilters, statusBucket: "RECUSADO", onlyDivergent: true },
        { ticketImportId: "abc" },
        { porPagina: 50, pagina: 2 },
        { key: "data", dir: "asc" },
      ),
    );
    expect(query.get("statusBucket")).toBe("RECUSADO");
    expect(query.get("onlyDivergent")).toBe("true");
    expect(query.get("ticketImportId")).toBe("abc");
    expect(query.get("sort")).toBe("data");
    expect(query.get("offset")).toBe("50");
  });
});

describe("proximaOrdem", () => {
  it("estreia cada coluna pelo lado que interessa", () => {
    // Impacto ascendente é o maior prejuízo primeiro; data começa pela mais
    // recente. Abrir as duas do mesmo jeito daria a uma delas a resposta errada.
    expect(proximaOrdem(null, "impacto")).toEqual({ key: "impacto", dir: "asc" });
    expect(proximaOrdem(null, "data")).toEqual({ key: "data", dir: "desc" });
  });

  it("inverte no segundo clique e volta para casa no terceiro", () => {
    const primeiro = proximaOrdem(null, "situacao");
    const segundo = proximaOrdem(primeiro, "situacao");
    expect(segundo).toEqual({ key: "situacao", dir: "desc" });
    // `null` é a ordem por materialidade: voltar a ela não pode custar
    // recarregar a tela.
    expect(proximaOrdem(segundo, "situacao")).toBeNull();
  });

  it("trocar de coluna recomeça, e não herda o sentido da anterior", () => {
    const impactoInvertido: OrdemChamados = { key: "impacto", dir: "desc" };
    expect(proximaOrdem(impactoInvertido, "chamado")).toEqual({
      key: "chamado",
      dir: "asc",
    });
  });
});
