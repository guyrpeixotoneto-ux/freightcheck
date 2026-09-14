import { describe, expect, it } from "vitest";
import {
  avaliarTrecho,
  chaveDeIdentidade,
  conferirProjecaoMensal,
  deduplicarIdenticos,
  divergenciaEntreCapacidades,
  mediana,
  montarPanorama,
  palletsDaCapacidade,
  percentil,
  percursoDaChave,
  resumirAssimetria,
  resumirKm,
  segmentar,
  type TrechoKm,
} from "../km-rodado";

/**
 * As regras do Km Rodado, sem banco.
 *
 * Cada bloco prende uma forma diferente de errar, e as formas não foram
 * imaginadas: saíram do export real da vigência `EMPURRADA_1_9_2026` e do que a
 * planilha que o transportador mantém à mão acerta e erra sobre ele. Os números
 * citados nos comentários foram medidos sobre aquele arquivo; o teste que os
 * reproduz linha a linha é `km-rodado-real.test.ts`.
 */

function trecho(over: Partial<TrechoKm> = {}): TrechoKm {
  return {
    entityId: "e1",
    chaveTrecho: "CERVEJARIA CAMAÇARI_ASA BRANCA_28_false",
    unidadeCnpj: "07.526.557/0085-70",
    origemSap: "BR04",
    destinoSap: "142200.0",
    unidade: "CAMAÇARI",
    operador: "OPERALOG",
    regional: "Geo NE",
    origem: "Unidade: CERVEJARIA CAMAÇARI | Região: NE",
    destino: "Unidade: ASA BRANCA | Região: null",
    capacidade: "Pallets: 28",
    kmIda: 1305.63,
    kmVolta: 1380.5,
    kmRodado: 2686.13,
    kmRodadoMesPorEquipe: 30152.95,
    previsaoViagens: 0.45,
    diasMes: 25,
    ...over,
  };
}

describe("a identidade do trecho", () => {
  /*
    O caso que motivou o módulo. `chaveTrecho` é igual nas duas linhas — ela
    nomeia a unidade por extenso, e "CDR BAHIA" atende mais de um CNPJ. O km não
    é igual. Sob a identidade antiga uma delas apaga a outra, em silêncio.
  */
  it("separa duas linhas que só o CNPJ da unidade distingue", () => {
    const a = trecho({
      chaveTrecho: "CDR BAHIA_10272914-SENDAS DISTRIBUIDORA S/A(S4)_28_false",
      unidadeCnpj: "07.526.557/0085-70",
      origemSap: "BR5D",
      destinoSap: "29032564.0",
      kmIda: 8.51,
      kmVolta: 14.47,
      kmRodado: 22.98,
    });
    const b = trecho({
      chaveTrecho: "CDR BAHIA_10272914-SENDAS DISTRIBUIDORA S/A(S4)_28_false",
      unidadeCnpj: "07.526.557/0131-05",
      origemSap: "BR5D",
      destinoSap: "29032564.0",
      kmIda: 10,
      kmVolta: 10,
      kmRodado: 20,
    });

    expect(chaveDeIdentidade(a)).not.toBe(chaveDeIdentidade(b));

    const panorama = montarPanorama([a, b]);
    expect(panorama.resumo.trechos).toBe(2);
    expect(panorama.resumo.kmTotal).toBeCloseTo(42.98, 6);
    expect(panorama.resumo.colapsadas).toBe(0);
  });

  it("colapsa duas linhas idênticas e conta o colapso na cobertura", () => {
    const a = trecho({ kmIda: 9, kmVolta: 9, kmRodado: 18 });
    const b = trecho({ entityId: "e2", kmIda: 9, kmVolta: 9, kmRodado: 18 });

    const panorama = montarPanorama([a, b]);
    expect(panorama.resumo.trechos).toBe(1);
    expect(panorama.resumo.kmTotal).toBe(18);
    expect(panorama.resumo.colapsadas).toBe(1);
    /* O denominador continua sendo o que o export trouxe — 2, não 1. */
    expect(panorama.resumo.trechosNoExport).toBe(2);
    expect(panorama.resumo.cobertura).toBeCloseTo(0.5, 6);
  });

  it("não colapsa mesma identidade com km diferente — isso é conflito, e aparece", () => {
    const a = trecho({ kmIda: 9, kmVolta: 9, kmRodado: 18 });
    const b = trecho({ entityId: "e2", kmIda: 10, kmVolta: 10, kmRodado: 20 });

    const { linhas, colapsadas, conflitantes } = deduplicarIdenticos([a, b].map(avaliarTrecho));
    expect(linhas).toHaveLength(2);
    expect(colapsadas).toBe(0);
    expect(conflitantes).toHaveLength(1);
    expect(conflitantes[0]).toHaveLength(2);
  });

  it("recusa o trecho sem a chave que o ancora", () => {
    const a = avaliarTrecho(trecho({ chaveTrecho: "  " }));
    expect(a.exclusao).toBe("SEM_IDENTIDADE");
    expect(a.km).toBeNull();
  });
});

describe("o que entra na conta", () => {
  it("aceita o ciclo que fecha", () => {
    const a = avaliarTrecho(trecho());
    expect(a.exclusao).toBeNull();
    expect(a.km).toBe(2686.13);
  });

  it("recusa o ciclo que não fecha, e não o transforma em zero", () => {
    const a = avaliarTrecho(trecho({ kmIda: 100, kmVolta: 100, kmRodado: 500 }));
    expect(a.exclusao).toBe("CICLO_NAO_FECHA");
    expect(a.km).toBeNull();

    const resumo = resumirKm([a]);
    expect(resumo.trechos).toBe(0);
    expect(resumo.kmTotal).toBeNull();
    expect(resumo.excluidos.CICLO_NAO_FECHA).toBe(1);
  });

  it("aceita o ciclo com folga de um metro, e recusa acima dela", () => {
    expect(avaliarTrecho(trecho({ kmIda: 10, kmVolta: 10, kmRodado: 20.009 })).exclusao).toBeNull();
    expect(avaliarTrecho(trecho({ kmIda: 10, kmVolta: 10, kmRodado: 20.02 })).exclusao).toBe(
      "CICLO_NAO_FECHA",
    );
  });

  it("aceita o km quando falta uma das pernas — a perna ausente não invalida o ciclo", () => {
    const a = avaliarTrecho(trecho({ kmIda: null, kmVolta: null, kmRodado: 1200 }));
    expect(a.exclusao).toBeNull();
    expect(a.km).toBe(1200);
    expect(a.assimetria).toBeNull();
  });

  it("trata zero como ausência, e não como distância", () => {
    const a = avaliarTrecho(trecho({ kmIda: 0, kmVolta: 0, kmRodado: 0 }));
    expect(a.exclusao).toBe("KM_NAO_POSITIVO");
  });

  it("recusa km ausente", () => {
    const a = avaliarTrecho(trecho({ kmIda: null, kmVolta: null, kmRodado: null }));
    expect(a.exclusao).toBe("SEM_KM");
  });

  /*
    A regra de ouro da tela: um recorte sem nenhum trecho válido responde "sem
    dado", nunca "R$ 0" nem "0 km". As duas frases se parecem e significam o
    oposto uma da outra.
  */
  it("devolve nulo, e não zero, quando nada entrou", () => {
    const resumo = resumirKm([]);
    expect(resumo.kmTotal).toBeNull();
    expect(resumo.media).toBeNull();
    expect(resumo.mediana).toBeNull();
    expect(resumo.cobertura).toBeNull();
    expect(resumo.trechos).toBe(0);
  });
});

describe("a projeção mensal e o arredondamento da fonte", () => {
  /*
    O caso real: CERVEJARIA CAMAÇARI → CERVEJARIA MANAUS. `previsaoViagens` sai
    do export como 0,13; o valor que produziu a projeção era 0,12625. Comparar
    contra o ponto acusa; comparar contra a faixa não.
  */
  it("aceita a projeção que o arredondamento de previsaoViagens explica", () => {
    const r = conferirProjecaoMensal(
      trecho({
        kmIda: 4929.8,
        kmVolta: 4929.8,
        kmRodado: 9859.6,
        previsaoViagens: 0.13,
        diasMes: 25,
        kmRodadoMesPorEquipe: 31121.23,
      }),
    );
    expect(r).not.toBeNull();
    expect(r?.confere).toBe(true);
  });

  it("acusa a projeção que o arredondamento não explica", () => {
    const r = conferirProjecaoMensal(
      trecho({ kmRodado: 1000, previsaoViagens: 1, diasMes: 25, kmRodadoMesPorEquipe: 50000 }),
    );
    expect(r?.confere).toBe(false);
    expect(r?.esperado[0]).toBeCloseTo(24875, 6);
    expect(r?.esperado[1]).toBeCloseTo(25125, 6);
  });

  it("cala quando falta parcela — não dá para conferir não é não confere", () => {
    expect(conferirProjecaoMensal(trecho({ previsaoViagens: null }))).toBeNull();
    expect(conferirProjecaoMensal(trecho({ kmRodadoMesPorEquipe: null }))).toBeNull();
  });
});

describe("a divergência entre capacidades", () => {
  it("acha o mesmo percurso com km diferente em 28 e 30 pallets", () => {
    const p28 = trecho({
      chaveTrecho: "CDD CEBRASA_10258211-C S M COMERCIAL_28_false",
      capacidade: "Pallets: 28",
      kmIda: 75.6,
      kmVolta: 75.6,
      kmRodado: 151.2,
    });
    const p30 = trecho({
      entityId: "e2",
      chaveTrecho: "CDD CEBRASA_10258211-C S M COMERCIAL_30_false",
      capacidade: "Pallets: 30",
      kmIda: 58.5,
      kmVolta: 58.5,
      kmRodado: 117,
    });

    const [d, ...resto] = divergenciaEntreCapacidades([p28, p30].map(avaliarTrecho));
    expect(resto).toHaveLength(0);
    expect(d?.percurso).toBe("CDD CEBRASA_10258211-C S M COMERCIAL");
    expect(d?.amplitude).toBeCloseTo(34.2, 6);
    expect(d?.amplitudeRelativa).toBeCloseTo(34.2 / 117, 6);
    /* Ordenado da menor capacidade para a maior, para a tabela ler na ordem. */
    expect(d?.porCapacidade.map((c) => c.pallets)).toEqual([28, 30]);
  });

  it("cala sobre o percurso que só existe numa capacidade", () => {
    expect(divergenciaEntreCapacidades([avaliarTrecho(trecho())])).toHaveLength(0);
  });

  it("cala quando as capacidades concordam", () => {
    const a = trecho({ chaveTrecho: "U_D_28_false", capacidade: "Pallets: 28" });
    const b = trecho({
      entityId: "e2",
      chaveTrecho: "U_D_30_false",
      capacidade: "Pallets: 30",
    });
    expect(divergenciaEntreCapacidades([a, b].map(avaliarTrecho))).toHaveLength(0);
  });

  it("ordena pela maior amplitude — a fila de atenção começa pelo pior", () => {
    const monta = (n: number, km28: number, km30: number) => [
      trecho({
        entityId: `a${n}`,
        chaveTrecho: `U_D${n}_28_false`,
        capacidade: "Pallets: 28",
        kmIda: km28 / 2,
        kmVolta: km28 / 2,
        kmRodado: km28,
      }),
      trecho({
        entityId: `b${n}`,
        chaveTrecho: `U_D${n}_30_false`,
        capacidade: "Pallets: 30",
        kmIda: km30 / 2,
        kmVolta: km30 / 2,
        kmRodado: km30,
      }),
    ];
    const d = divergenciaEntreCapacidades([...monta(1, 100, 110), ...monta(2, 100, 500)].map(avaliarTrecho));
    expect(d.map((x) => Math.round(x.amplitude))).toEqual([400, 10]);
  });
});

describe("ida contra volta", () => {
  it("separa simétrico, assimétrico e indeterminado", () => {
    const a = resumirAssimetria(
      [
        trecho({ kmIda: 100, kmVolta: 100, kmRodado: 200 }),
        trecho({ entityId: "e2", destinoSap: "d2", kmIda: 100, kmVolta: 140, kmRodado: 240 }),
        trecho({ entityId: "e3", destinoSap: "d3", kmIda: null, kmVolta: null, kmRodado: 300 }),
      ].map(avaliarTrecho),
    );
    expect(a).toEqual({
      simetricos: 1,
      assimetricos: 1,
      indeterminados: 1,
      maiorDiferenca: 40,
    });
  });
});

describe("a segmentação", () => {
  it("soma por dimensão e põe o sem-informação em linha própria", () => {
    const cortes = segmentar(
      [
        trecho({ unidade: "CAMAÇARI", kmIda: 50, kmVolta: 50, kmRodado: 100 }),
        trecho({ entityId: "e2", destinoSap: "d2", unidade: "CAMAÇARI", kmIda: 100, kmVolta: 100, kmRodado: 200 }),
        trecho({ entityId: "e3", destinoSap: "d3", unidade: "   ", kmIda: 25, kmVolta: 25, kmRodado: 50 }),
      ].map(avaliarTrecho),
      (t) => t.unidade,
    );
    expect(cortes).toEqual([
      { chave: "CAMAÇARI", trechos: 2, kmTotal: 300, kmMedio: 150 },
      { chave: null, trechos: 1, kmTotal: 50, kmMedio: 50 },
    ]);
  });
});

describe("os utilitários da fonte", () => {
  it("lê o número colado no rótulo da capacidade", () => {
    expect(palletsDaCapacidade("Pallets: 28")).toBe(28);
    expect(palletsDaCapacidade("Pallets: 42")).toBe(42);
    expect(palletsDaCapacidade("sem número")).toBeNull();
    expect(palletsDaCapacidade(null)).toBeNull();
    /* Zero pallets não é um caminhão: é rótulo ilegível. */
    expect(palletsDaCapacidade("Pallets: 0")).toBeNull();
  });

  it("tira a capacidade da chave sem quebrar nome de cliente com sublinhado", () => {
    expect(percursoDaChave("CDR BAHIA_10272914-SENDAS S/A_28_false")).toBe(
      "CDR BAHIA_10272914-SENDAS S/A",
    );
    expect(percursoDaChave("A_B_C_D_30_false")).toBe("A_B_C_D");
    expect(percursoDaChave(null)).toBeNull();
  });

  it("devolve um percentil que algum trecho tem de fato", () => {
    const v = [10, 20, 30, 40, 50];
    expect(percentil(v, 90)).toBe(50);
    expect(percentil(v, 50)).toBe(30);
    expect(percentil(v, 1)).toBe(10);
    expect(percentil([], 90)).toBeNull();
    expect(mediana([10, 20, 30, 40])).toBe(25);
    expect(mediana([])).toBeNull();
  });
});
