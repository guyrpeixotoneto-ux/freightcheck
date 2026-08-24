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
 * (não iniciada / em voo / terminada) e a garantia central: **`liberar` é
 * verdadeiro se e somente se a fase é `TERMINADA`** — o teto nunca é o quinto
 * caminho para chegar lá. O que ela publica sobre o banco em si —
 * `diagnosticar(observarBanco())` — continua em `janela-da-partida.test.ts`,
 * com o app de verdade.
 */
describe("liberar é fase === TERMINADA, sem exceção", () => {
  beforeEach(() => esquecerPartida(1_000));
  afterEach(() => esquecerPartida());

  it("não iniciada: retém", () => {
    const estado = estadoDaPromocao(1_500, 15_000);
    expect(estado.fase).toBe("NAO_INICIADA");
    expect(estado.liberar).toBe(false);
  });

  it("em voo: retém", () => {
    tentativaComecou(1_000);
    const estado = estadoDaPromocao(2_000, 15_000);
    expect(estado.fase).toBe("EM_VOO");
    expect(estado.liberar).toBe(false);
    expect(estado.esperandoHaMs).toBe(1_000);
  });

  it("terminada por convergência: libera", () => {
    tentativaComecou(1_000);
    tentativaTerminou("Nenhuma migration pendente.");
    const estado = estadoDaPromocao(1_010, 15_000);
    expect(estado.liberar).toBe(true);
    expect(estado.fase).toBe("TERMINADA");
  });

  it("terminada por migration recusada: libera — não é 'terminou de forma insegura', porque o portão continua sendo quem admite tráfego de produto", () => {
    tentativaComecou(1_000);
    tentativaTerminou("A migration 0056_frota_promax foi recusada pelo banco.");
    const estado = estadoDaPromocao(1_050, 15_000);
    expect(estado.liberar).toBe(true);
    expect(estado.motivo).toContain("0056_frota_promax");
  });
});

describe("o teto NUNCA libera — só marca a espera como anômala", () => {
  beforeEach(() => esquecerPartida(1_000));
  afterEach(() => esquecerPartida());

  it("em voo além do teto: continua retendo, e sinaliza a anomalia", () => {
    tentativaComecou(1_000);

    const dentro = estadoDaPromocao(1_000 + 14_999, 15_000);
    expect(dentro.liberar).toBe(false);
    expect(dentro.alemDoTeto).toBe(false);

    const alem = estadoDaPromocao(1_000 + 15_000, 15_000);
    expect(alem.liberar).toBe(false);
    expect(alem.fase).toBe("EM_VOO");
    expect(alem.alemDoTeto).toBe(true);
    expect(alem.motivo).toMatch(/teto informativo de 15000 ms/);
    expect(alem.motivo).toMatch(/nunca por tempo decorrido/);
  });

  it("bem além do teto — dez vezes o valor — continua fail-closed", () => {
    tentativaComecou(1_000);
    const estado = estadoDaPromocao(1_000 + 150_000, 15_000);
    expect(estado.liberar).toBe(false);
    expect(estado.alemDoTeto).toBe(true);
  });

  it("não iniciada além do teto: continua retendo", () => {
    const estado = estadoDaPromocao(1_000 + 15_000, 15_000);
    expect(estado.liberar).toBe(false);
    expect(estado.fase).toBe("NAO_INICIADA");
    expect(estado.alemDoTeto).toBe(true);
  });

  it("terminada além do teto (tarde, mas terminou): libera pela conclusão, e alemDoTeto sai false — a pergunta deixou de valer", () => {
    tentativaComecou(1_000);
    tentativaTerminou("Nenhuma migration pendente.");
    const estado = estadoDaPromocao(1_000 + 999_999, 15_000);
    expect(estado.liberar).toBe(true);
    expect(estado.alemDoTeto).toBe(false);
  });

  it("STARTUP_PROBE_MAX_WAIT_MS não é lido como uma segunda forma de liberar — mesmo com valor 0", () => {
    tentativaComecou(1_000);
    const estado = estadoDaPromocao(1_000, 0);
    expect(estado.liberar).toBe(false);
    expect(estado.alemDoTeto).toBe(true);
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

  it('"0" explícito é aceito — e, como o teto nunca libera, só faz o rótulo de anomalia aparecer desde o primeiro instante', () => {
    expect(tetoDaPromocao({ STARTUP_PROBE_MAX_WAIT_MS: "0" })).toBe(0);
  });
});
