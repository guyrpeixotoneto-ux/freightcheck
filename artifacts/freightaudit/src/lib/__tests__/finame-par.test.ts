import { describe, expect, it } from "vitest";
import { parDePartida, rotulosDasVigencias, vigenciasDaUnidade } from "../finame";

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

/**
 * Os rótulos do seletor — a segunda metade do mesmo relato.
 *
 * *"Tô achando estranho ter várias opções com o mesmo nome"*: a lista abria com
 * cinco `EMPURRADA_1_6_2026 · 01/06/2026` idênticas, uma por unidade. Medido no
 * `EMPURRADA_Cavalo.xlsx` que originou o acervo: seis vigências × cinco
 * unidades (CAMAÇARI, CDD CEBRASA, EQUATORIAL, MANAUS, PERNAMBUCO) = trinta
 * vigências, cinco a cinco com o mesmo `sourceLabel` e a mesma data.
 */
describe("os rótulos do seletor", () => {
  const comRotulo = (
    id: string,
    sourceLabel: string,
    effectiveDate: string,
    scopeHash: string,
    extra: { entityTypeSet?: string; revision?: number } = {},
  ) => ({
    id,
    sourceLabel,
    effectiveDate,
    scopeHash,
    entityTypeSet: extra.entityTypeSet ?? "CAVALO,CARRETA",
    ...(extra.revision === undefined ? {} : { revision: extra.revision }),
  });

  const nomes = new Map([
    [PERNAMBUCO, "PERNAMBUCO"],
    [CAMACARI, "CAMAÇARI"],
  ]);
  const nomeDoEscopo = (hash: string) => nomes.get(hash) ?? null;

  it("não acrescenta nada a quem já é único", () => {
    const rotulos = rotulosDasVigencias(
      [
        comRotulo("pe-ago", "EMPURRADA_2_8_2026", "2026-08-16", PERNAMBUCO),
        comRotulo("pe-jul", "EMPURRADA_2_7_2026", "2026-07-16", PERNAMBUCO),
      ],
      nomeDoEscopo,
    );

    expect(rotulos.get("pe-ago")).toBe("EMPURRADA_2_8_2026 · 16/08/2026");
    expect(rotulos.get("pe-jul")).toBe("EMPURRADA_2_7_2026 · 16/07/2026");
  });

  /* O relato, dito como teste: duas unidades, dois rótulos diferentes. */
  it("nomeia a unidade quando é ela que separa as linhas", () => {
    const rotulos = rotulosDasVigencias(
      [
        comRotulo("pe", "EMPURRADA_1_6_2026", "2026-06-01", PERNAMBUCO),
        comRotulo("ca", "EMPURRADA_1_6_2026", "2026-06-01", CAMACARI),
      ],
      nomeDoEscopo,
    );

    expect(rotulos.get("pe")).toBe("EMPURRADA_1_6_2026 · 01/06/2026 · PERNAMBUCO");
    expect(rotulos.get("ca")).toBe("EMPURRADA_1_6_2026 · 01/06/2026 · CAMAÇARI");
    expect(new Set(rotulos.values()).size).toBe(2);
  });

  /* A mesma unidade com cavalo e carreta na mesma data: desempata a cobertura. */
  it("desce para a cobertura quando a unidade não separa", () => {
    const rotulos = rotulosDasVigencias(
      [
        comRotulo("cav", "EMPURRADA_1_6_2026", "2026-06-01", PERNAMBUCO, {
          entityTypeSet: "CAVALO",
        }),
        comRotulo("car", "EMPURRADA_1_6_2026", "2026-06-01", PERNAMBUCO, {
          entityTypeSet: "CARRETA",
        }),
      ],
      nomeDoEscopo,
    );

    expect(rotulos.get("cav")).toBe("EMPURRADA_1_6_2026 · 01/06/2026 · CAVALO");
    expect(rotulos.get("car")).toBe("EMPURRADA_1_6_2026 · 01/06/2026 · CARRETA");
  });

  it("cai na revisão como último desempate", () => {
    const rotulos = rotulosDasVigencias(
      [
        comRotulo("r1", "EMPURRADA_1_6_2026", "2026-06-01", PERNAMBUCO, { revision: 1 }),
        comRotulo("r2", "EMPURRADA_1_6_2026", "2026-06-01", PERNAMBUCO, { revision: 2 }),
      ],
      nomeDoEscopo,
    );

    expect(rotulos.get("r1")).toMatch(/rev\. 1$/);
    expect(rotulos.get("r2")).toMatch(/rev\. 2$/);
  });

  /* Sem `/contexts` respondido não há nome — degrada para o que já existia. */
  it("sobrevive sem os nomes das unidades", () => {
    const rotulos = rotulosDasVigencias([
      comRotulo("pe", "EMPURRADA_1_6_2026", "2026-06-01", PERNAMBUCO),
      comRotulo("ca", "EMPURRADA_1_6_2026", "2026-06-01", CAMACARI),
    ]);

    expect(rotulos.get("pe")).toBe("EMPURRADA_1_6_2026 · 01/06/2026");
    expect(rotulos.get("ca")).toBe("EMPURRADA_1_6_2026 · 01/06/2026");
  });

  /* O acervo real, como o arquivo o produziu: trinta linhas, trinta rótulos. */
  it("dá rótulo distinto às cinco unidades de cada vigência", () => {
    const unidades = [
      [PERNAMBUCO, "PERNAMBUCO"],
      [CAMACARI, "CAMAÇARI"],
    ] as const;
    const lista = ["EMPURRADA_1_6_2026", "EMPURRADA_2_6_2026"].flatMap((label, i) =>
      unidades.map(([hash]) =>
        comRotulo(`${label}-${hash}`, label, i === 0 ? "2026-06-01" : "2026-06-16", hash),
      ),
    );

    const rotulos = rotulosDasVigencias(lista, nomeDoEscopo);

    expect(new Set(rotulos.values()).size).toBe(lista.length);
  });
});
