import { describe, expect, it } from "vitest";
import { opcoesDoIntervaloGeral } from "@/lib/intervalo-da-linha-do-tempo";

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
