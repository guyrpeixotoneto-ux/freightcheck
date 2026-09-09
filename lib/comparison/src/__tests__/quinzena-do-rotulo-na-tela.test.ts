import { describe, expect, it } from "vitest";
import { parseVigenciaLabel } from "@workspace/ingest";
import { rotuloCurtoDaVigencia, rotuloDaVigencia, rotuloDeListaDaVigencia } from "../labels";

/**
 * Do rótulo da fonte até o que o seletor escreve — a volta inteira.
 *
 * As duas metades desta prova moram em pacotes diferentes e são testadas
 * separadamente: `lib/ingest` responde "que data é `EMPURRADA_2_8_2026`?" e
 * `labels` responde "como se escreve `2026-08-16` no meio destas outras?".
 * Cada uma estava certa sobre a sua metade e o produto continuava errado na
 * emenda — o seletor da tela escrevia **"agosto/2026 · dia 02"** para uma
 * quinzena que começa no dia 16, e nenhum teste de nenhum dos dois pacotes
 * tinha como acusar isso, porque nenhum dos dois via a emenda.
 *
 * O erro era o parser: ele lia o segundo campo do rótulo como dia do mês.
 * `EMPURRADA_2_8_2026` virava `2026-08-02`, as duas vigências de agosto caíam
 * na primeira metade do calendário, e `rotuloDaVigencia` — que só escreve a
 * ordinal quando as datas do mês caem em metades diferentes — não tinha como
 * chegar em "2ª quinzena". Ele caía no desempate por dia, que é o certo para
 * duas entregas da mesma metade e a resposta errada aqui.
 *
 * Consertado o parser, a camada de rótulo não mudou uma linha: as datas passam
 * a cair em metades distintas e a ordinal aparece sozinha. É essa dependência
 * — silenciosa, e do tipo que volta — que este arquivo prende.
 */

/** As seis vigências do acervo real, como a fonte as nomeia. */
const ROTULOS = [
  "EMPURRADA_2_8_2026",
  "EMPURRADA_1_8_2026",
  "EMPURRADA_2_7_2026",
  "EMPURRADA_1_7_2026",
  "EMPURRADA_2_6_2026",
  "EMPURRADA_1_6_2026",
];

const DATAS = ROTULOS.map((r) => parseVigenciaLabel(r).effectiveDate!);

describe("o rótulo da fonte chega à tela como quinzena", () => {
  it("cada vigência cai no dia em que a quinzena dela começa", () => {
    expect(DATAS).toEqual([
      "2026-08-16",
      "2026-08-01",
      "2026-07-16",
      "2026-07-01",
      "2026-06-16",
      "2026-06-01",
    ]);
  });

  it("o seletor escreve a ordinal, e não mais o dia do mês", () => {
    // Era `{ mes: "agosto/2026", marca: "dia 02" }` — o print que abriu o caso.
    expect(DATAS.map((d) => rotuloDeListaDaVigencia(d, DATAS))).toEqual([
      { mes: "agosto/2026", marca: "2ª quinzena" },
      { mes: "agosto/2026", marca: "1ª quinzena" },
      { mes: "julho/2026", marca: "2ª quinzena" },
      { mes: "julho/2026", marca: "1ª quinzena" },
      { mes: "junho/2026", marca: "2ª quinzena" },
      { mes: "junho/2026", marca: "1ª quinzena" },
    ]);
  });

  it("o nome de uma linha só — título de diálogo, coluna de CSV — diz o mesmo", () => {
    expect(rotuloDaVigencia(DATAS[0], DATAS)).toBe("2ª quinzena de agosto/2026");
    expect(rotuloDaVigencia(DATAS[1], DATAS)).toBe("1ª quinzena de agosto/2026");
  });

  it("o tick do eixo continua sendo o dia, e agora é o dia certo", () => {
    /*
      `rotuloCurtoDaVigencia` desempata sempre pelo dia — a ordinal não cabe num
      tick. O que muda é que o dia deixou de mentir: o eixo escrevia `02/08/2026`
      para a quinzena que começa em `16/08/2026`.
    */
    expect(rotuloCurtoDaVigencia(DATAS[0], DATAS)).toBe("16/08/2026");
    expect(rotuloCurtoDaVigencia(DATAS[1], DATAS)).toBe("01/08/2026");
  });

  it("um mês com uma entrega só continua sendo o mês, sem marca inventada", () => {
    // A régua não mudou: desempate só onde há empate.
    const soUma = [parseVigenciaLabel("EMPURRADA_2_5_2026").effectiveDate!];
    expect(rotuloDeListaDaVigencia(soUma[0], soUma)).toEqual({
      mes: "maio/2026",
      marca: null,
    });
    expect(rotuloDaVigencia(soUma[0], soUma)).toBe("maio/2026");
  });
});
