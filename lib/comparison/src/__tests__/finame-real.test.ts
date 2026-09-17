import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import {
  compararCompetencia,
  notaDaQuinzenaIsolada,
  remuneradoDoMes,
  resumirCompetencia,
  type RealizadoDaCompetencia,
  type RemuneradoDaQuinzena,
} from "../finame-real";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ACERVO = path.resolve(AQUI, "../../../../attached_assets");

function remunerado(
  placa: string,
  quinzena: 1 | 2,
  valor: number | null,
): RemuneradoDaQuinzena {
  return {
    placa,
    quinzena,
    valor,
    effectiveDate: quinzena === 1 ? "2026-08-01" : "2026-08-16",
    label: `EMPURRADA_${quinzena}_8_2026`,
  };
}

function realizado(
  placa: string,
  valor: number,
  extra: Partial<RealizadoDaCompetencia> = {},
): RealizadoDaCompetencia {
  return {
    competencia: "2026-08-01",
    placa,
    valor,
    lancamentos: 1,
    parcial: false,
    motivoParcial: null,
    ...extra,
  };
}

describe("o remunerado do mês, lido das quinzenas", () => {
  it("não soma as duas quinzenas — o valor delas é mensal, não metade", () => {
    /*
      A medição que sustenta esta linha: em agosto/2026, o único mês do acervo
      com as duas quinzenas importadas, 111 de 111 placas trazem o **mesmo**
      valor nas duas. Somar daria o dobro, e a auditoria passaria a afirmar que
      a Ambev paga duas vezes o que o banco cobra, em toda a frota, todo mês.
    */
    const { valor, divergem } = remuneradoDoMes([
      remunerado("QYQ6A80", 1, 4096.31),
      remunerado("QYQ6A80", 2, 4096.31),
    ]);
    expect(valor).toBe(4096.31);
    expect(valor).not.toBe(8192.62);
    expect(divergem).toBe(false);
  });

  it("uma quinzena só é leitura inteira, não meia leitura", () => {
    // O acervo real tem meses com só a 2ª quinzena importada — é o caso comum.
    expect(remuneradoDoMes([remunerado("QYQ6A80", 2, 3323.86)]).valor).toBe(3323.86);
  });

  it("quinzenas discordantes não viram média", () => {
    const { valor, divergem } = remuneradoDoMes([
      remunerado("QYQ6A80", 1, 4000),
      remunerado("QYQ6A80", 2, 5000),
    ]);
    expect(divergem).toBe(true);
    // Nem 4500, nem 4000, nem 9000: nada. A divergência é o achado.
    expect(valor).toBeNull();
  });

  it("nenhuma quinzena com valor é ausência, e ausência não é zero", () => {
    const { valor, divergem } = remuneradoDoMes([remunerado("QYQ6A80", 2, null)]);
    expect(valor).toBeNull();
    expect(divergem).toBe(false);
  });
});

describe("a comparação de uma competência", () => {
  it("compara um valor de cada lado e mostra o desvio", () => {
    const linhas = compararCompetencia(
      "2026-08-01",
      [remunerado("QYQ6A80", 1, 4000), remunerado("QYQ6A80", 2, 4000)],
      [realizado("QYQ6A80", 4400, { lancamentos: 2 })],
    );
    expect(linhas).toHaveLength(1);
    expect(linhas[0].estado).toBe("COMPARAVEL");
    expect(linhas[0].remunerado).toBe(4000);
    expect(linhas[0].realizado).toBe(4400);
    expect(linhas[0].desvio).toBe(400);
    expect(linhas[0].desvioPercentual).toBe(10);
    // Quantos lançamentos compõem o realizado nunca fica escondido.
    expect(linhas[0].lancamentos).toBe(2);
    // E as quinzenas lidas ficam à vista, para a origem do número ser óbvia.
    expect(linhas[0].quinzenasLidas.map((q) => q.quinzena)).toEqual([1, 2]);
  });

  it("ausência de um lado não vira zero nem desvio", () => {
    const semRealizado = compararCompetencia(
      "2026-08-01",
      [remunerado("QYQ6A80", 2, 4000)],
      [],
    );
    expect(semRealizado[0].estado).toBe("REALIZADO_AUSENTE");
    expect(semRealizado[0].desvio).toBeNull();
    expect(semRealizado[0].desvioPercentual).toBeNull();
    expect(semRealizado[0].nota).toContain("nenhuma das três é zero");

    const semRemunerado = compararCompetencia("2026-08-01", [], [
      realizado("QYQ6A80", 4400),
    ]);
    expect(semRemunerado[0].estado).toBe("REMUNERADO_AUSENTE");
    expect(semRemunerado[0].desvio).toBeNull();
  });

  it("marca a competência parcial sem esconder o número", () => {
    const linhas = compararCompetencia(
      "2026-09-01",
      [remunerado("QYQ6A80", 2, 4000)],
      [
        realizado("QYQ6A80", 2000, {
          competencia: "2026-09-01",
          parcial: true,
          motivoParcial: "49 lançamentos, 47% da mediana das demais (105).",
        }),
      ],
    );
    expect(linhas[0].estado).toBe("COMPETENCIA_PARCIAL");
    // O desvio continua calculado: a marca diz "confira", não "não olhe".
    expect(linhas[0].desvio).toBe(-2000);
    expect(linhas[0].nota).toContain("47%");
  });

  it("a divergência entre quinzenas fica de fora da comparação, com os dois valores", () => {
    const linhas = compararCompetencia(
      "2026-08-01",
      [remunerado("QYQ6A80", 1, 4000), remunerado("QYQ6A80", 2, 5000)],
      [realizado("QYQ6A80", 4400)],
    );
    expect(linhas[0].estado).toBe("REMUNERADO_DIVERGE_ENTRE_QUINZENAS");
    expect(linhas[0].desvio).toBeNull();
    expect(linhas[0].nota).toContain("1ª quinzena: 4000");
    expect(linhas[0].nota).toContain("2ª quinzena: 5000");
  });
});

describe("os totais do mês", () => {
  it("somam só o que é comparável — o topo é a soma das linhas de baixo", () => {
    const linhas = compararCompetencia(
      "2026-08-01",
      [remunerado("A", 2, 1000), remunerado("B", 2, 2000), remunerado("C", 2, 500)],
      [realizado("A", 1100), realizado("B", 2200)],
    );
    const resumo = resumirCompetencia("2026-08-01", linhas);
    /*
      A placa C tem remunerado e não tem realizado. Somá-la do lado do
      remunerado faria o desvio do mês incluir uma placa que nunca foi
      comparada — e o total do topo deixaria de bater com a soma das linhas.
    */
    expect(resumo.totalRemunerado).toBe(3000);
    expect(resumo.totalRealizado).toBe(3300);
    expect(resumo.desvio).toBe(300);
    expect(resumo.desvioPercentual).toBe(10);
    expect(resumo.placasComparadas).toBe(2);
    expect(resumo.placasSemRealizado).toBe(1);
  });
});

describe("a leitura de uma quinzena isolada", () => {
  it("diz que o realizado é do mês, e não o divide por dois", () => {
    const nota = notaDaQuinzenaIsolada(1, "agosto/2026");
    expect(nota).toContain("competência mensal");
    expect(nota).toContain("não é duplicidade");
    expect(nota).toContain("não foi dividido por dois");
  });
});

/**
 * A prova sobre o acervo real — a que impede a regra de voltar atrás.
 *
 * Os dois arquivos de verdade: o export de remuneração de 12/2025 a 09/2026 e o
 * extrato do financiamento de 2026. O que se afirma aqui não é uma preferência
 * de desenho, é uma medição — e é ela que um refactor futuro vai precisar
 * derrubar antes de somar as quinzenas.
 */
describe("a prova sobre o acervo real", () => {
  function lerAba(arquivo: string, aba: string): Record<string, unknown>[] {
    const wb = XLSX.read(readFileSync(path.join(ACERVO, arquivo)), { type: "buffer" });
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[aba], {
      raw: true,
      defval: null,
    });
  }

  const semHifen = (placa: unknown) => String(placa ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

  it("as duas quinzenas de agosto/2026 trazem o mesmo valor mensal, placa a placa", () => {
    for (const [aba, coluna] of [
      ["cavalos", "finameCavalo"],
      ["carretas", "finameImplemento"],
    ] as const) {
      const linhas = lerAba("Base_FT_Atualizada_12_2025_a_09_2026.xlsx", aba);
      const porQuinzena = new Map<string, Map<string, unknown>>();
      for (const linha of linhas) {
        const label = String(linha["Vigencia"] ?? "");
        if (label !== "EMPURRADA_1_8_2026" && label !== "EMPURRADA_2_8_2026") continue;
        const mapa = porQuinzena.get(label) ?? new Map<string, unknown>();
        mapa.set(semHifen(linha["Placa"]), linha[coluna]);
        porQuinzena.set(label, mapa);
      }

      const q1 = porQuinzena.get("EMPURRADA_1_8_2026")!;
      const q2 = porQuinzena.get("EMPURRADA_2_8_2026")!;
      const comuns = [...q1.keys()].filter((p) => q2.has(p));
      expect(comuns.length).toBeGreaterThan(40);

      const divergentes = comuns.filter((p) => q1.get(p) !== q2.get(p));
      expect(divergentes).toEqual([]);
    }
  });

  it("o realizado do mês tem a ordem de grandeza de UMA quinzena, não das duas", () => {
    /*
      A razão realizado ÷ remunerado-de-uma-quinzena tem mediana 1,03 nos 715
      pares comparáveis. Somando as quinzenas ela iria para ~2,06 — e é essa
      distância entre 1 e 2 que este teste guarda.
    */
    const extrato = lerAba("Finames_Real_2026.xlsx", "Planilha1");
    const realizadoPorPlacaMes = new Map<string, number>();
    for (const linha of extrato) {
      const chave = `${semHifen(linha["Placa"])}|${Number(linha["MES"])}`;
      const valor = Math.abs(Number(linha["VLRREA"]));
      realizadoPorPlacaMes.set(chave, (realizadoPorPlacaMes.get(chave) ?? 0) + valor);
    }

    const remuneradoPorPlacaMes = new Map<string, number>();
    for (const aba of ["cavalos", "carretas"] as const) {
      const coluna = aba === "cavalos" ? "finameCavalo" : "finameImplemento";
      for (const linha of lerAba("Base_FT_Atualizada_12_2025_a_09_2026.xlsx", aba)) {
        const partes = /^([A-Z]+)_(\d+)_(\d+)_(\d+)$/.exec(String(linha["Vigencia"] ?? ""));
        if (!partes) continue;
        const chave = `${semHifen(linha["Placa"])}|${Number(partes[3])}`;
        const valor = Number(linha[coluna]);
        if (!Number.isFinite(valor) || valor <= 0) continue;
        remuneradoPorPlacaMes.set(chave, valor);
      }
    }

    const razoes: number[] = [];
    for (const [chave, real] of realizadoPorPlacaMes) {
      const rem = remuneradoPorPlacaMes.get(chave);
      if (rem === undefined) continue;
      razoes.push(real / rem);
    }
    razoes.sort((a, b) => a - b);
    expect(razoes.length).toBeGreaterThan(500);

    const mediana = razoes[Math.floor(razoes.length / 2)];
    expect(mediana).toBeGreaterThan(0.9);
    expect(mediana).toBeLessThan(1.2);
    // E, explicitamente: não é 2. Somar as quinzenas colocaria a mediana lá.
    expect(mediana * 2).toBeGreaterThan(1.8);
  });
});
