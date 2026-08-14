import { describe, expect, it } from "vitest";
import { LEITURA_TRAVADA_MINUTOS, whyCannotDelete } from "../deletion";

const minutosAtras = (n: number) => new Date(Date.now() - n * 60_000);

/**
 * As recusas que não dependem do banco: as que só olham o estado do run.
 *
 * A frase importa tanto quanto a recusa. Quem está na tela quer saber o que
 * fazer — esperar, ou excluir outra coisa antes —, e "não foi possível excluir"
 * não responde nem uma nem outra.
 */
describe("whyCannotDelete", () => {
  it("segura enquanto o pipeline ainda está escrevendo", () => {
    for (const status of ["PENDING", "READING", "STAGED"]) {
      expect(whyCannotDelete(status, minutosAtras(1))).toMatch(
        /ainda está sendo lida/,
      );
    }
    expect(whyCannotDelete("PROMOTING", minutosAtras(1))).toMatch(
      /sendo aprovada/,
    );
  });

  it("libera o que ficou parado — um servidor reiniciado no meio da leitura", () => {
    // Sem isto, um deploy durante a leitura deixaria o run em READING para
    // sempre: ninguém para terminá-lo, e ninguém autorizado a apagá-lo.
    const travado = minutosAtras(LEITURA_TRAVADA_MINUTOS + 1);
    for (const status of ["PENDING", "READING", "STAGED", "PROMOTING"]) {
      expect(whyCannotDelete(status, travado)).toBeNull();
    }
  });

  it("libera o que já parou de mexer no banco", () => {
    for (const status of [
      "PROMOTED",
      "PREVIEWED",
      "FAILED",
      "ABORTED",
      "SKIPPED_DUPLICATE",
    ]) {
      expect(whyCannotDelete(status)).toBeNull();
    }
  });
});
