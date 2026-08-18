import { describe, expect, it } from "vitest";
import {
  indexarVinculos,
  parearConjuntos,
  rotuloDoPar,
  CODIGO_DO_VINCULO,
  type AtivoDoVinculo,
  type FatoDoVinculo,
} from "../vinculo";

/**
 * O pareamento cavalo–carreta, exercitado nos casos que o export real **não**
 * tem.
 *
 * Nos dados reais o vínculo é um para um nas 9 vigências, e é por isso que estes
 * testes existem: os estados degenerados — a placa que não encontra carreta, a
 * placa disputada por dois cavalos — nunca são exercidos lá, e são exatamente os
 * que, mal tratados, contariam a remuneração de uma carreta duas vezes na frota.
 */

function cavalo(placa: string): AtivoDoVinculo {
  return { entityId: `cav-${placa}`, entityType: "CAVALO", placa };
}

function carreta(placa: string): AtivoDoVinculo {
  return { entityId: `car-${placa}`, entityType: "CARRETA", placa };
}

function aponta(placa: string | null): FatoDoVinculo[] {
  return placa === null
    ? [{ code: CODIGO_DO_VINCULO, value_text: null, is_null: true }]
    : [{ code: CODIGO_DO_VINCULO, value_text: placa, is_null: false }];
}

function cenario(
  ativos: AtivoDoVinculo[],
  vinculos: Record<string, string | null>,
): ReturnType<typeof parearConjuntos> {
  const fatos = new Map<string, FatoDoVinculo[]>(
    ativos.map((a) => [a.entityId, aponta(vinculos[a.entityId] ?? null)]),
  );
  return parearConjuntos(indexarVinculos(ativos, fatos), ativos);
}

describe("o pareamento", () => {
  it("forma o conjunto quando o cavalo aponta uma carreta que existe", () => {
    const pares = cenario([cavalo("AAA1A11"), carreta("BBB2B22")], {
      "cav-AAA1A11": "BBB2B22",
    });
    expect(pares).toHaveLength(1);
    expect(pares[0].natureza).toBe("PAREADO");
    expect(pares[0].id).toBe("cav-AAA1A11");
    expect(rotuloDoPar(pares[0])).toBe("AAA1A11 + BBB2B22");
  });

  it("dá conjunto próprio à carreta que ninguém aponta", () => {
    const pares = cenario([cavalo("AAA1A11"), carreta("BBB2B22"), carreta("CCC3C33")], {
      "cav-AAA1A11": "BBB2B22",
    });
    const orfa = pares.find((p) => p.natureza === "CARRETA_ORFA")!;
    expect(orfa.id).toBe("car-CCC3C33");
    expect(orfa.cavalo).toBeNull();
    expect(rotuloDoPar(orfa)).toBe("CCC3C33");
  });

  it("não inventa carreta quando a placa apontada não está na vigência", () => {
    const pares = cenario([cavalo("AAA1A11")], { "cav-AAA1A11": "ZZZ9Z99" });
    expect(pares[0].natureza).toBe("PLACA_SEM_CARRETA");
    expect(pares[0].carreta).toBeNull();
    /* A placa que a fonte declarou não some — é ela a pergunta para quem
       gerou a planilha. */
    expect(pares[0].placaApontada).toBe("ZZZ9Z99");
  });

  it("distingue não declarar carreta de declarar uma que não existe", () => {
    const pares = cenario([cavalo("AAA1A11")], {});
    expect(pares[0].natureza).toBe("CAVALO_SEM_VINCULO");
    expect(pares[0].placaApontada).toBeNull();
  });

  /**
   * O caso que a lista existe para não errar.
   *
   * Dois cavalos apontando a mesma carreta: se ela entrasse nos dois conjuntos,
   * a remuneração dela seria contada duas vezes na soma da frota. Um só fica com
   * ela, o outro fica sem — e o segundo diz por quê, em vez de aparecer como um
   * cavalo que simplesmente não declarou carreta.
   */
  it("não põe a mesma carreta em dois conjuntos", () => {
    const pares = cenario([cavalo("AAA1A11"), cavalo("DDD4D44"), carreta("BBB2B22")], {
      "cav-AAA1A11": "BBB2B22",
      "cav-DDD4D44": "BBB2B22",
    });
    const comCarreta = pares.filter((p) => p.carreta !== null);
    expect(comCarreta).toHaveLength(1);
    expect(pares.every((p) => p.natureza === "PLACA_DISPUTADA")).toBe(true);
    for (const par of pares) {
      expect(par.disputantes).toEqual(["cav-AAA1A11", "cav-DDD4D44"]);
    }
  });

  it("escolhe o mesmo dono em duas leituras da mesma vigência", () => {
    const ativos = [cavalo("DDD4D44"), cavalo("AAA1A11"), carreta("BBB2B22")];
    const vinculos = { "cav-AAA1A11": "BBB2B22", "cav-DDD4D44": "BBB2B22" };
    const primeira = cenario(ativos, vinculos);
    /* A ordem em que os fatos voltam do banco não é estável; o dono tem de ser. */
    const segunda = cenario([...ativos].reverse(), vinculos);
    const dono = (pares: typeof primeira) =>
      pares.find((p) => p.carreta !== null)!.cavalo!.entityId;
    expect(dono(primeira)).toBe(dono(segunda));
  });

  it("põe cada ativo em exatamente um conjunto", () => {
    const ativos = [
      cavalo("AAA1A11"),
      cavalo("DDD4D44"),
      cavalo("EEE5E55"),
      carreta("BBB2B22"),
      carreta("CCC3C33"),
      carreta("FFF6F66"),
    ];
    const pares = cenario(ativos, {
      "cav-AAA1A11": "BBB2B22",
      "cav-DDD4D44": "FFF6F66",
      "cav-EEE5E55": null,
    });
    const vistos = new Set<string>();
    for (const par of pares) {
      for (const lado of [par.cavalo, par.carreta]) {
        if (!lado) continue;
        expect(vistos.has(lado.entityId)).toBe(false);
        vistos.add(lado.entityId);
      }
    }
    expect(vistos.size).toBe(ativos.length);
  });

  it("lê o vínculo da vigência, e ignora o ativo que não está nela", () => {
    const ativos = [cavalo("AAA1A11"), carreta("BBB2B22")];
    const fatos = new Map<string, FatoDoVinculo[]>([
      ["cav-AAA1A11", aponta("BBB2B22")],
    ]);
    const indice = indexarVinculos(ativos, fatos);
    /* A carreta existe no banco e não entregou fatos nesta vigência: o vínculo
       está declarado e o conjunto não se forma. */
    const pares = parearConjuntos(indice, [ativos[0]]);
    expect(pares).toHaveLength(1);
    expect(pares[0].natureza).toBe("PLACA_SEM_CARRETA");
  });
});
