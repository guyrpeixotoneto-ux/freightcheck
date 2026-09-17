import { describe, expect, it } from "vitest";

import {
  competenciaDaBusca,
  competenciaReconciliada,
  consultaDoConfronto,
  enderecoDaCompetencia,
  enderecoDaFonte,
  fonteDaBusca,
} from "../fonte-de-finame";

/**
 * A FONTE NO ENDEREÇO — o que sobrevive a uma troca, e o que não pode sobreviver.
 *
 * O defeito que estes casos prendem é sempre o mesmo, por duas portas: um
 * parâmetro do eixo temporal de uma fonte sobrevivendo na outra. `base=<uuid>`
 * numa tela de competência é um par de vigências fantasma; `competencia=2026-09`
 * numa tela de par é um mês que ninguém consegue abrir. Nos dois casos a URL
 * promete uma coisa e a tela mostra outra.
 */

const CAMINHO = "/custo-fixo-finame";

describe("a fonte que o endereço traz", () => {
  it("um link antigo, sem a chave, abre em Remunerado", () => {
    expect(fonteDaBusca("")).toBe("REMUNERADO");
    expect(fonteDaBusca("?base=abc&comparada=def")).toBe("REMUNERADO");
    expect(fonteDaBusca("?scopeHash=xyz&modo=evolucao")).toBe("REMUNERADO");
  });

  it("o link com a fonte abre nela", () => {
    expect(fonteDaBusca("?fonte=real")).toBe("REAL");
    expect(fonteDaBusca("?fonte=remunerado")).toBe("REMUNERADO");
  });

  it("um valor inventado não quebra a tela — cai no padrão", () => {
    expect(fonteDaBusca("?fonte=realizado")).toBe("REMUNERADO");
    expect(fonteDaBusca("?fonte=")).toBe("REMUNERADO");
  });
});

describe("a troca de fonte", () => {
  it("ir para Real leva embora o par de vigências", () => {
    const endereco = enderecoDaFonte(
      CAMINHO,
      "?base=v1&comparada=v2&scopeHash=CAMACARI",
      "REAL",
      "2026-09",
    );
    const q = new URLSearchParams(endereco.split("?")[1]);

    expect(q.get("fonte")).toBe("real");
    expect(q.get("competencia")).toBe("2026-09");
    expect(q.get("base")).toBeNull();
    expect(q.get("comparada")).toBeNull();
    /* O que é da tela, e não de uma das fontes, atravessa. */
    expect(q.get("scopeHash")).toBe("CAMACARI");
  });

  it("voltar para Remunerado leva embora a competência", () => {
    const endereco = enderecoDaFonte(
      CAMINHO,
      "?fonte=real&competencia=2026-09&scopeHash=CAMACARI&recorteEvolucao=CAVALO",
      "REMUNERADO",
    );
    const q = new URLSearchParams(endereco.split("?")[1]);

    expect(q.get("competencia")).toBeNull();
    /* Remunerado é o padrão: ele não precisa se declarar, e o link fica limpo. */
    expect(q.get("fonte")).toBeNull();
    expect(q.get("scopeHash")).toBe("CAMACARI");
    expect(q.get("recorteEvolucao")).toBe("CAVALO");
  });

  it("a fonte atravessa Cavalo, Carreta e Evolução", () => {
    /* O modo e o recorte são chaves próprias: trocá-los não toca na fonte. */
    const comEvolucao = "?fonte=real&competencia=2026-09&modo=evolucao&recorteEvolucao=CARRETA";
    expect(fonteDaBusca(comEvolucao)).toBe("REAL");
    expect(competenciaDaBusca(comEvolucao)).toBe("2026-09");

    const q = new URLSearchParams(
      enderecoDaCompetencia(CAMINHO, comEvolucao, "2026-08").split("?")[1],
    );
    expect(q.get("modo")).toBe("evolucao");
    expect(q.get("recorteEvolucao")).toBe("CARRETA");
    expect(q.get("fonte")).toBe("real");
    expect(q.get("competencia")).toBe("2026-08");
  });

  it("uma competência sem valor válido não é lida do endereço", () => {
    expect(competenciaDaBusca("?competencia=2026-13")).toBeNull();
    expect(competenciaDaBusca("?competencia=setembro")).toBeNull();
    expect(competenciaDaBusca("?competencia=2026-09")).toBe("2026-09");
  });
});

describe("a competência reconciliada", () => {
  const existentes = ["2026-07", "2026-08", "2026-09"];

  it("o par escolhido é preservado quando existe nos dois contextos", () => {
    expect(competenciaReconciliada("2026-08", existentes)).toBe("2026-08");
  });

  it("o que não existe é trocado pela última válida, e não mantido", () => {
    expect(competenciaReconciliada("2025-01", existentes)).toBe("2026-09");
    expect(competenciaReconciliada(null, existentes)).toBe("2026-09");
  });

  it("sem competência nenhuma, não se inventa uma", () => {
    expect(competenciaReconciliada("2026-09", [])).toBeNull();
    expect(competenciaReconciliada(null, [])).toBeNull();
  });
});

describe("a consulta que vai ao servidor", () => {
  it("declara a fonte sempre — o servidor não adivinha", () => {
    const q = new URLSearchParams(
      consultaDoConfronto(new URLSearchParams("scopeHash=CAMACARI"), "2026-09", "CAVALO"),
    );
    expect(q.get("fonte")).toBe("real");
    expect(q.get("competencia")).toBe("2026-09");
    expect(q.get("tipo")).toBe("CAVALO");
    expect(q.get("scopeHash")).toBe("CAMACARI");
  });

  it("o recorte Cavalo + Carreta não vira um tipo inventado", () => {
    const q = new URLSearchParams(
      consultaDoConfronto(new URLSearchParams(), "2026-09", "TODOS"),
    );
    expect(q.get("tipo")).toBeNull();
  });
});
