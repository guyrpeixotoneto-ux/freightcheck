import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  esquecerPartida,
  estadoDaPromocao,
  tentativaComecou,
  tentativaTerminou,
  tetoDaPromocao,
} from "../partida";

/**
 * O fato que `/api/startupz` publica, isolado do processo real.
 *
 * `estadoDaPromocao` não toca banco nem relógio de verdade — recebe `agora` e
 * `tetoMs` por parâmetro, e por isso estas provas não dependem de sleep nem de
 * um Postgres do lado. O que se prova aqui é a máquina de três fases
 * (não iniciada / em voo / terminada) e o teto; o que ela publica sobre o
 * banco em si — `diagnosticar(observarBanco())` — continua em
 * `janela-da-partida.test.ts`, com o app de verdade.
 */
describe("o fato da promoção — sem tocar banco", () => {
  beforeEach(() => esquecerPartida(1_000));
  afterEach(() => esquecerPartida());

  it("não iniciada: retém, dentro do teto", () => {
    const estado = estadoDaPromocao(1_500, 15_000);
    expect(estado.fase).toBe("NAO_INICIADA");
    expect(estado.liberar).toBe(false);
  });

  it("em voo: retém, dentro do teto", () => {
    tentativaComecou(1_000);
    const estado = estadoDaPromocao(2_000, 15_000);
    expect(estado.fase).toBe("EM_VOO");
    expect(estado.liberar).toBe(false);
    expect(estado.esperandoHaMs).toBe(1_000);
  });

  it("terminada: libera, qualquer que seja o motivo — inclusive falha", () => {
    tentativaComecou(1_000);
    tentativaTerminou("A migration 0056_frota_promax foi recusada pelo banco.");
    const estado = estadoDaPromocao(1_050, 15_000);
    expect(estado.fase).toBe("TERMINADA");
    expect(estado.liberar).toBe(true);
    expect(estado.motivo).toContain("0056_frota_promax");
  });

  it("terminada convergindo: libera", () => {
    tentativaComecou(1_000);
    tentativaTerminou("Nenhuma migration pendente.");
    const estado = estadoDaPromocao(1_010, 15_000);
    expect(estado.liberar).toBe(true);
  });

  it("teto atingido com a tentativa ainda em voo: libera mesmo assim", () => {
    tentativaComecou(1_000);
    const antes = estadoDaPromocao(1_000 + 14_999, 15_000);
    expect(antes.liberar).toBe(false);

    const depois = estadoDaPromocao(1_000 + 15_000, 15_000);
    expect(depois.liberar).toBe(true);
    expect(depois.fase).toBe("EM_VOO");
    expect(depois.motivo).toMatch(/teto de 15000 ms/);
  });

  it("teto atingido sem a tentativa ter começado: libera mesmo assim", () => {
    const estado = estadoDaPromocao(1_000 + 15_000, 15_000);
    expect(estado.liberar).toBe(true);
    expect(estado.fase).toBe("NAO_INICIADA");
  });

  it("STARTUP_PROBE_MAX_WAIT_MS=0 libera sem esperar nada", () => {
    tentativaComecou(1_000);
    const estado = estadoDaPromocao(1_000, 0);
    expect(estado.liberar).toBe(true);
    expect(estado.motivo).toContain("STARTUP_PROBE_MAX_WAIT_MS=0");
  });
});

describe("o teto — lido do ambiente, com o padrão como rede", () => {
  it("usa o padrão quando a chave não está definida", () => {
    expect(tetoDaPromocao({})).toBe(15_000);
  });

  it("lê um valor numérico explícito", () => {
    expect(tetoDaPromocao({ STARTUP_PROBE_MAX_WAIT_MS: "5000" })).toBe(5_000);
  });

  it("um valor não numérico cai no padrão — não vira zero por engano", () => {
    expect(tetoDaPromocao({ STARTUP_PROBE_MAX_WAIT_MS: "logo, por favor" })).toBe(
      15_000,
    );
  });

  it("valor negativo cai no padrão", () => {
    expect(tetoDaPromocao({ STARTUP_PROBE_MAX_WAIT_MS: "-1" })).toBe(15_000);
  });

  it("\"0\" explícito desliga a espera — não é o mesmo que ausente", () => {
    expect(tetoDaPromocao({ STARTUP_PROBE_MAX_WAIT_MS: "0" })).toBe(0);
  });
});
