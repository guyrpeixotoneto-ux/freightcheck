import { describe, expect, it } from "vitest";
import { parDePartida, vigenciasDaUnidade } from "../finame";

/**
 * O par com que a Auditoria de FINAME abre — a regressão que este arquivo
 * guarda.
 *
 * O sintoma, relatado em 15/09/2026 com a tela aberta em PERNAMBUCO: a
 * comparação abria num aviso âmbar dizendo que **não foi possível determinar a
 * causa desta falha**, com as duas pontas do seletor mostrando exatamente o
 * mesmo texto — `EMPURRADA_2_8_2026 · 16/08/2026` dos dois lados.
 *
 * Não eram a mesma vigência: eram duas unidades diferentes importadas do mesmo
 * arquivo, na mesma data. O rótulo não distingue uma da outra, e o par padrão
 * casava as duas — que é o único par que o motor recusa por construção
 * (`engine.ts`: "Escopos diferentes"). A tela abria recusada sem ninguém ter
 * escolhido nada.
 *
 * As duas funções aqui são a correção, e são strings entrando e strings
 * saindo: nada de rede, nada de React.
 */

const PERNAMBUCO = "scope-pernambuco";
const CAMACARI = "scope-camacari";

const vigencia = (
  id: string,
  effectiveDate: string,
  scopeHash: string,
  entityTypeSet = "CAVALO,CARRETA",
) => ({ id, effectiveDate, scopeHash, entityTypeSet });

describe("as vigências da unidade aberta", () => {
  const acervo = [
    vigencia("pe-ago", "2026-08-16", PERNAMBUCO),
    vigencia("ca-ago", "2026-08-16", CAMACARI),
    vigencia("pe-jul", "2026-07-16", PERNAMBUCO),
  ];

  it("recorta pela unidade quando há uma aberta", () => {
    expect(vigenciasDaUnidade(acervo, PERNAMBUCO).map((v) => v.id)).toEqual([
      "pe-ago",
      "pe-jul",
    ]);
  });

  /* Sem unidade aberta não há recorte a aplicar — esconder seria inventar um. */
  it("devolve o acervo inteiro sem unidade aberta", () => {
    expect(vigenciasDaUnidade(acervo, null)).toHaveLength(3);
  });
});

describe("o par de partida", () => {
  /* O defeito, dito como teste: duas unidades na mesma data não formam par. */
  it("nunca casa duas unidades diferentes, mesmo de mesma data", () => {
    const par = parDePartida([
      vigencia("pe-ago", "2026-08-16", PERNAMBUCO),
      vigencia("ca-ago", "2026-08-16", CAMACARI),
    ]);

    expect(par).toBeNull();
  });

  it("escolhe as duas mais recentes da mesma unidade", () => {
    const par = parDePartida([
      vigencia("pe-jul", "2026-07-16", PERNAMBUCO),
      vigencia("ca-ago", "2026-08-16", CAMACARI),
      vigencia("pe-ago", "2026-08-16", PERNAMBUCO),
    ]);

    expect(par?.base.id).toBe("pe-jul");
    expect(par?.comparada.id).toBe("pe-ago");
  });

  /* A recusa que já existia antes desta correção, e que continua valendo. */
  it("não casa cavalo com carreta", () => {
    const par = parDePartida([
      vigencia("cavalo", "2026-08-16", PERNAMBUCO, "CAVALO"),
      vigencia("carreta", "2026-08-16", PERNAMBUCO, "CARRETA"),
    ]);

    expect(par).toBeNull();
  });

  /* Uma unidade com uma vigência só: tela vazia, não pedido recusado. */
  it("não inventa par para uma unidade com uma vigência só", () => {
    expect(parDePartida([vigencia("ca-ago", "2026-08-16", CAMACARI)])).toBeNull();
    expect(parDePartida([])).toBeNull();
  });
});
