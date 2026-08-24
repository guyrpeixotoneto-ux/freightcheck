import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { apurar } from "../apuracao";
import { competencia as montarCompetencia } from "../periodo";
import {
  ladoDaFonte,
  TIPOS_DE_FONTE,
  TIPOS_DE_FROTA_PROMAX,
  FONTES_QUE_FORMAM_O_DEVIDO,
  FONTE_QUE_DEMONSTRA_O_PAGAMENTO,
} from "../dominio";

/**
 * A FRONTEIRA DA FROTA PROMAX — ela não é dinheiro, e isto é provado, não só
 * declarado.
 *
 * Item 3 do pedido: nenhuma rotina financeira (`reconciliacao.ts`,
 * `painel-referencia.ts`, o cálculo de remuneração) trata
 * `FROTA_PROMAX_ATIVA`/`FROTA_PROMAX_INATIVA` como `DEVIDO` nem `DEMONSTRADO`.
 * Este arquivo prova isso por dois caminhos independentes:
 *
 * 1. **Comportamento** — `ladoDaFonte` das duas devolve `CONFERENCIA_OPERACIONAL`,
 *    nunca `DEVIDO`/`DEMONSTRADO`, e `apurar()` nunca as conta como recebidas
 *    (então elas nunca entram em `fontesPresentes`/`fontesAusentes` da
 *    apuração financeira).
 * 2. **Import** — no mesmo espírito de `contaminacao.test.ts`, nenhum dos
 *    módulos financeiros importa `frota-promax-comparacao.ts` nem
 *    `leitores/frota-promax.ts`.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const fonte = (arquivo: string) => readFileSync(path.join(AQUI, "..", arquivo), "utf8");

const MODULOS_FINANCEIROS = [
  "mapa-rota.ts",
  "resumo.ts",
  "apuracao.ts",
  "de-para.ts",
  "reconciliacao.ts",
  "painel-referencia.ts",
  "afericao.ts",
  "matriz.ts",
  "faturado.ts",
];

function importaDe(codigo: string, modulo: string): boolean {
  const semComentarios = codigo
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return new RegExp(`from\\s+["'][^"']*${modulo}["']`).test(semComentarios);
}

describe("a frota Promax é conferência operacional — nunca DEVIDO nem DEMONSTRADO", () => {
  it("ladoDaFonte das duas fontes é CONFERENCIA_OPERACIONAL", () => {
    for (const tipo of TIPOS_DE_FROTA_PROMAX) {
      expect(ladoDaFonte(tipo)).toBe("CONFERENCIA_OPERACIONAL");
      expect(ladoDaFonte(tipo)).not.toBe("DEVIDO");
      expect(ladoDaFonte(tipo)).not.toBe("DEMONSTRADO");
    }
  });

  it("as duas fontes não estão nas listas que formam o devido nem na que demonstra o pagamento", () => {
    for (const tipo of TIPOS_DE_FROTA_PROMAX) {
      expect(FONTES_QUE_FORMAM_O_DEVIDO).not.toContain(tipo);
      expect(tipo).not.toBe(FONTE_QUE_DEMONSTRA_O_PAGAMENTO);
    }
  });

  it("TIPOS_DE_FONTE cobre as nove fontes, incluindo as duas de frota", () => {
    expect(TIPOS_DE_FONTE).toContain("FROTA_PROMAX_ATIVA");
    expect(TIPOS_DE_FONTE).toContain("FROTA_PROMAX_INATIVA");
    expect(TIPOS_DE_FONTE.length).toBe(9);
  });

  it("apurar() nunca conta a frota Promax como recebida — o motor financeiro não a vê", () => {
    const comp = montarCompetencia(2026, 7, 2);
    /*
      `Fontes` (o parâmetro de `apurar`) não tem campo de frota — é impossível
      passar dado de frota para o motor, mesmo por engano. O que se prova aqui
      é a consequência: uma apuração sem nada declara as duas como ausentes só
      quando `FONTES_DA_QUINZENA` as exigisse, e como elas não são exigidas
      (são mensais — ver `dominio.ts`), elas não aparecem nem como ausentes.
    */
    const apuracao = apurar(comp, {});
    expect(apuracao.fontesPresentes).not.toContain("FROTA_PROMAX_ATIVA");
    expect(apuracao.fontesPresentes).not.toContain("FROTA_PROMAX_INATIVA");
    expect(apuracao.fontesAusentes).not.toContain("FROTA_PROMAX_ATIVA");
    expect(apuracao.fontesAusentes).not.toContain("FROTA_PROMAX_INATIVA");
  });

  for (const modulo of MODULOS_FINANCEIROS) {
    it(`${modulo} não importa a comparação de frota nem o leitor dela`, () => {
      const codigo = fonte(modulo);
      expect(
        importaDe(codigo, "frota-promax-comparacao"),
        `${modulo} passou a importar a comparação de frota`,
      ).toBe(false);
      expect(
        importaDe(codigo, "leitores/frota-promax"),
        `${modulo} passou a importar o leitor de frota`,
      ).toBe(false);
    });
  }

  it("a comparação de frota não importa nenhum módulo financeiro — a seta não existe no sentido contrário também", () => {
    const comparacao = fonte("frota-promax-comparacao.ts");
    for (const modulo of ["apuracao", "reconciliacao", "painel-referencia", "mapa-rota", "resumo"]) {
      expect(importaDe(comparacao, modulo), `frota-promax-comparacao.ts importa ${modulo}`).toBe(
        false,
      );
    }
  });
});
