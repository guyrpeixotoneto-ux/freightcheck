import { describe, expect, it } from "vitest";
import {
  consultaDoIntervalo,
  opcoesDoIntervalo,
  opcoesDoIntervaloGeral,
} from "@/lib/intervalo-da-linha-do-tempo";

/*
  As competências como `/contexts` as entrega ao Dashboard: mais recente
  primeiro. O seletor de vigência ordena ao contrário antes de perguntar, e é
  justamente por isso que a chave precisa de teste — as duas telas montam a
  mesma pergunta a partir de listas em ordens opostas.
*/
const COMPETENCIAS = ["2026-08-02", "2026-08-01", "2026-07-02", "2026-06-01"];

describe("opcoesDoIntervaloGeral — a chave que o Dashboard e o seletor compartilham", () => {
  it("é a mesma para o gráfico da tela e para a contagem do menu", () => {
    const doDashboard = opcoesDoIntervaloGeral(
      COMPETENCIAS[COMPETENCIAS.length - 1],
      COMPETENCIAS[0],
    );
    const ordenadas = [...COMPETENCIAS].sort((a, b) => a.localeCompare(b));
    const doSeletor = opcoesDoIntervaloGeral(ordenadas[0], ordenadas[ordenadas.length - 1]);

    expect(doDashboard.queryKey).toEqual(doSeletor.queryKey);
    expect(doDashboard.queryKey).toEqual([
      "linha-do-tempo-overview",
      "from=2026-06-01&to=2026-08-02",
    ]);
  });

  it("recorta só pelas pontas — nem unidade nem canal entram na pergunta", () => {
    const [, query] = opcoesDoIntervaloGeral("2026-06-01", "2026-08-02").queryKey as [
      string,
      string,
    ];
    expect(new URLSearchParams(query).get("scopeHash")).toBeNull();
    expect(new URLSearchParams(query).get("canal")).toBeNull();
  });

  it("omite a ponta que não existe em vez de mandá-la vazia", () => {
    expect(opcoesDoIntervaloGeral(null, "2026-08-02").queryKey).toEqual([
      "linha-do-tempo-overview",
      "to=2026-08-02",
    ]);
    expect(opcoesDoIntervaloGeral(null, null).queryKey).toEqual(["linha-do-tempo-overview", ""]);
  });
});

describe("opcoesDoIntervalo — o recorte por tipo entra na pergunta", () => {
  const consulta = new URLSearchParams({ scopeHash: "abc", canal: "EMPURRADA" });

  it("sem tipo, a chave é a de sempre — a aba Geral não muda de endereço", () => {
    const opcoes = opcoesDoIntervalo(consulta, "2026-06-01", "2026-08-02");
    const [, query] = opcoes.queryKey as [string, string];
    expect(new URLSearchParams(query).get("tipo")).toBeNull();
  });

  it("com tipo, cavalo e carreta são perguntas diferentes sobre o mesmo intervalo", () => {
    const cavalo = opcoesDoIntervalo(consulta, "2026-06-01", "2026-08-02", "CAVALO");
    const carreta = opcoesDoIntervalo(consulta, "2026-06-01", "2026-08-02", "CARRETA");
    const geral = opcoesDoIntervalo(consulta, "2026-06-01", "2026-08-02");

    expect(cavalo.queryKey).not.toEqual(carreta.queryKey);
    expect(cavalo.queryKey).not.toEqual(geral.queryKey);
    expect(new URLSearchParams((cavalo.queryKey as [string, string])[1]).get("tipo")).toBe(
      "CAVALO",
    );
  });

  it("o recorte acompanha a unidade e o canal, e nunca a vigência aberta", () => {
    const query = consultaDoIntervalo(
      new URLSearchParams({ scopeHash: "abc", canal: "EMPURRADA", period: "2026-07-02" }),
      "2026-06-01",
      "2026-08-02",
      "TRECHO",
    );
    expect(query.get("scopeHash")).toBe("abc");
    expect(query.get("canal")).toBe("EMPURRADA");
    expect(query.get("tipo")).toBe("TRECHO");
    // As pontas são o intervalo; a vigência aberta não recorta a série.
    expect(query.get("period")).toBeNull();
    expect(query.get("from")).toBe("2026-06-01");
    expect(query.get("to")).toBe("2026-08-02");
  });
});
