import { describe, expect, it } from "vitest";
import { CATALOGO_DECLARADO } from "../catalogo-declarado";
import {
  DIRECAO_ECONOMICA_TRECHO,
  type DirecaoEconomicaTrechoEntrada,
} from "../direcao-economica-trecho";

/**
 * A rodada de curadoria de TRECHO conferida contra o dicionário declarado.
 *
 * O risco real desta lista não é a regra — é o **código digitado errado**.
 * `aplicarDirecaoEconomicaTrecho` coleta as falhas em vez de parar na
 * primeira (para não deixar a curadoria pela metade em silêncio), e o preço
 * disso é que um `trecho.frete_liquidoo` sumiria dentro do resumo sem que
 * ninguém olhasse. Aqui cada código é conferido contra `CATALOGO_DECLARADO`,
 * que é a mesma fonte de onde a importação deriva os atributos.
 *
 * Sem banco de propósito: o export real da Ambev commitado como fixture só
 * traz CAVALO e CARRETA, então um teste de integração aqui provaria apenas
 * que o fixture não tem trecho — não que a lista está certa.
 */

const DECLARADOS_DE_TRECHO = CATALOGO_DECLARADO.filter((a) => a.entityType === "TRECHO");
const CODIGOS_DECLARADOS = new Set(DECLARADOS_DE_TRECHO.map((a) => a.code));

it("o dicionário declara atributos de TRECHO — a régua deste arquivo existe", () => {
  expect(DECLARADOS_DE_TRECHO.length).toBeGreaterThan(0);
});

it("a lista não repete nenhum atributo", () => {
  const codes = DIRECAO_ECONOMICA_TRECHO.map((e) => e.code);
  expect(new Set(codes).size).toBe(codes.length);
});

it("todo atributo listado começa com 'trecho.'", () => {
  for (const entrada of DIRECAO_ECONOMICA_TRECHO) {
    expect(entrada.code.startsWith("trecho.")).toBe(true);
  }
});

/*
  O teste que pega o erro de digitação. Um código que não existe no dicionário
  nunca vai ser encontrado no banco, e a curadoria dele seria uma linha de
  falha no resumo do script — silenciosa para quem não lê a saída inteira.
*/
it("todo código curado existe no dicionário declarado", () => {
  const desconhecidos = DIRECAO_ECONOMICA_TRECHO.filter((e) => !CODIGOS_DECLARADOS.has(e.code));
  expect(desconhecidos.map((e) => e.code)).toEqual([]);
});

it("os quatro valores do vocabulário são os únicos usados", () => {
  const usados = new Set(DIRECAO_ECONOMICA_TRECHO.map((e) => e.direcao));
  for (const direcao of usados) {
    expect(["HIGHER_IS_BETTER", "HIGHER_IS_WORSE", "NEUTRAL", "DEPENDS_ON_FORMULA"]).toContain(
      direcao,
    );
  }
});

it("toda entrada tem o efeito escrito — a direção sem o porquê não é curadoria", () => {
  for (const entrada of DIRECAO_ECONOMICA_TRECHO) {
    expect(entrada.efeito.trim().length).toBeGreaterThan(0);
  }
});

describe("as decisões que sustentam o veredito do Radar", () => {
  const porCode = new Map<string, DirecaoEconomicaTrechoEntrada>(
    DIRECAO_ECONOMICA_TRECHO.map((e) => [e.code, e]),
  );

  it("frete líquido é maior-é-melhor — é a receita do trecho", () => {
    expect(porCode.get("trecho.frete_liquido")?.direcao).toBe("HIGHER_IS_BETTER");
  });

  it("pedágio é maior-é-pior — é custo pago pela transportadora", () => {
    expect(porCode.get("trecho.frete_reais_km_pedagio")?.direcao).toBe("HIGHER_IS_WORSE");
    expect(porCode.get("trecho.pedagio")?.direcao).toBe("HIGHER_IS_WORSE");
  });

  it("a chave do trecho é neutra — cadastro não move veredito", () => {
    expect(porCode.get("trecho.chave_trecho")?.direcao).toBe("NEUTRAL");
  });

  /*
    O caso que prova que a seção da DRE não basta: `diesel_consumo_km_l` está
    declarado em "(−) Custo variável / Combustível", e mesmo assim subir é
    **bom** — mais km por litro é menos custo. Classificá-lo por atalho a
    partir da seção inverteria o sinal dele no Radar.
  */
  it("km/l não é classificado por atalho da seção de custo", () => {
    expect(porCode.get("trecho.diesel_consumo_km_l")?.direcao).toBe("DEPENDS_ON_FORMULA");
  });

  it("a cobertura é parcial e sabida — nem todo atributo declarado foi curado", () => {
    expect(DIRECAO_ECONOMICA_TRECHO.length).toBeLessThanOrEqual(DECLARADOS_DE_TRECHO.length);
  });
});
