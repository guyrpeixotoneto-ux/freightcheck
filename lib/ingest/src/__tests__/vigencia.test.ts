import { describe, expect, it } from "vitest";
import { channelOf, parseVigenciaLabel } from "../vigencia";

describe("parseVigenciaLabel", () => {
  it("preserves the source label verbatim", () => {
    const result = parseVigenciaLabel("EMPURRADA_1_8_2026");
    expect(result.label).toBe("EMPURRADA_1_8_2026");
  });

  it("lê o segundo campo como quinzena, e não como dia do mês", () => {
    /*
      O erro que este teste existe para não deixar voltar. O campo é a
      quinzena, e o mês tem duas: a 1ª começa no dia 1, a 2ª no dia 16. Lido
      como dia, `EMPURRADA_2_12_2025` virava `2025-12-02` — certo no mês, errado
      por quinze dias, e sem nada que quebrasse, porque as duas vigências do mês
      continuavam com duas datas distintas e na ordem certa. Só a tela dizia a
      verdade em voz alta: "dia 02" para uma quinzena que começa no dia 16.
    */
    expect(parseVigenciaLabel("EMPURRADA_1_8_2026").effectiveDate).toBe("2026-08-01");
    expect(parseVigenciaLabel("EMPURRADA_2_12_2025").effectiveDate).toBe("2025-12-16");

    // Mês e ano seguem onde estavam: 1/8/2026 é agosto, não 8 de janeiro.
    expect(parseVigenciaLabel("EMPURRADA_1_8_2026").effectiveDate).toBe("2026-08-01");
  });

  it("devolve a quinzena que o rótulo nomeia, sem obrigar a relê-la da data", () => {
    expect(parseVigenciaLabel("EMPURRADA_1_8_2026").quinzena).toBe(1);
    expect(parseVigenciaLabel("EMPURRADA_2_8_2026").quinzena).toBe(2);
    // Zero à esquerda é a mesma quinzena: a fonte já escreveu das duas formas.
    expect(parseVigenciaLabel("EMPURRADA_02_12_2025").quinzena).toBe(2);
    expect(parseVigenciaLabel("EMPURRADA_02_12_2025").effectiveDate).toBe("2025-12-16");
  });

  it("as duas vigências de um mês caem em quinzenas distintas do calendário", () => {
    /*
      A régua de `quinzenaDe` (`lib/comparison/src/labels.ts`) é dia ≤ 15 → 1ª.
      Com 01 e 02 as duas caíam na primeira metade, a ordinal teria escrito "1ª
      quinzena" duas vezes, e o rótulo caía no desempate por dia. Com 01 e 16 a
      ordinal volta a distinguir — é assim que a tela passa a escrever
      "1ª quinzena de agosto/2026" sem que a camada de rótulo mude uma linha.
    */
    const primeira = parseVigenciaLabel("EMPURRADA_1_8_2026").effectiveDate!;
    const segunda = parseVigenciaLabel("EMPURRADA_2_8_2026").effectiveDate!;
    expect(Number(primeira.slice(8, 10))).toBeLessThanOrEqual(15);
    expect(Number(segunda.slice(8, 10))).toBeGreaterThan(15);
  });

  it("covers every label in the real export, in order", () => {
    const labels = [
      "EMPURRADA_2_12_2025",
      "EMPURRADA_2_1_2026",
      "EMPURRADA_2_2_2026",
      "EMPURRADA_2_3_2026",
      "EMPURRADA_2_4_2026",
      "EMPURRADA_2_5_2026",
      "EMPURRADA_2_6_2026",
      "EMPURRADA_2_7_2026",
      "EMPURRADA_1_8_2026",
    ];
    const dates = labels.map((l) => parseVigenciaLabel(l).effectiveDate);
    expect(dates).toEqual([
      "2025-12-16",
      "2026-01-16",
      "2026-02-16",
      "2026-03-16",
      "2026-04-16",
      "2026-05-16",
      "2026-06-16",
      "2026-07-16",
      "2026-08-01",
    ]);
    // Chronological, which is what promotion relies on for identifier history.
    expect([...dates].sort()).toEqual(dates);
    // And every one of them is the same channel — the series the product has.
    expect(labels.map(channelOf)).toEqual(labels.map(() => "EMPURRADA"));
  });

  it("returns null instead of guessing when the shape is unknown", () => {
    // "EMPURRADA" has no date; "1_8_2026" has no channel — a label that is all
    // numbers must not be read as a channel called "1"; "" has neither.
    for (const bad of ["EMPURRADA", "1_8_2026", "", "EMPURRADA_1_8_26", "EMPURRADA 1 8 2026"]) {
      const result = parseVigenciaLabel(bad);
      expect(result.effectiveDate).toBeNull();
      expect(result.channel).toBeNull();
      expect(result.failureCode).toBe("UNRECOGNISED_FORMAT");
    }
  });

  it("recusa a quinzena que não existe em vez de arredondá-la para uma que existe", () => {
    /*
      Um mês tem duas quinzenas. `EMPURRADA_3_8_2026` é um arquivo para alguém
      olhar — não uma data a ser adivinhada escolhendo a mais próxima. A forma
      foi reconhecida, então o canal sai lido: é o que permite a mensagem do
      apontamento nomear o canal do rótulo recusado.
    */
    const terceira = parseVigenciaLabel("EMPURRADA_3_8_2026");
    expect(terceira.effectiveDate).toBeNull();
    expect(terceira.quinzena).toBeNull();
    expect(terceira.failureCode).toBe("IMPOSSIBLE_QUINZENA");
    expect(terceira.channel).toBe("EMPURRADA");

    // O que antes era lido como um dia impossível agora é uma quinzena que não
    // existe — mesma recusa, motivo mais preciso.
    expect(parseVigenciaLabel("EMPURRADA_31_2_2026").failureCode).toBe(
      "IMPOSSIBLE_QUINZENA",
    );
    expect(parseVigenciaLabel("EMPURRADA_0_8_2026").failureCode).toBe(
      "IMPOSSIBLE_QUINZENA",
    );
  });

  it("recusa o mês impossível, sem perder a quinzena que soube ler", () => {
    const result = parseVigenciaLabel("EMPURRADA_1_13_2026");
    expect(result.effectiveDate).toBeNull();
    expect(result.failureCode).toBe("IMPOSSIBLE_DATE");
    expect(result.quinzena).toBe(1);
  });
});

/**
 * O canal deixou de ser palavra fixa.
 *
 * O padrão era `^EMPURRADA_…$`: um export do canal ROTA — o que as telas do
 * cliente mostram — seria recusado inteiro, com `UNRECOGNISED_FORMAT`, não
 * porque a forma fosse desconhecida, mas porque a primeira palavra era. A
 * ampliação é estritamente aditiva, e é isso que os testes acima e abaixo
 * provam: nenhum rótulo antes aceito mudou de data, e nenhum rótulo antes
 * recusado por *forma* passou a ser aceito.
 */
describe("outros canais", () => {
  it("aceita ROTA com a mesma data que EMPURRADA na mesma quinzena", () => {
    const rota = parseVigenciaLabel("ROTA_1_8_2026");
    const empurrada = parseVigenciaLabel("EMPURRADA_1_8_2026");
    expect(rota.effectiveDate).toBe("2026-08-01");
    expect(rota.effectiveDate).toBe(empurrada.effectiveDate);
    // A data é a mesma; o canal é o que as distingue.
    expect(rota.channel).toBe("ROTA");
    expect(empurrada.channel).toBe("EMPURRADA");
  });

  it("lê o canal como tudo que vem antes dos três grupos numéricos", () => {
    // Um canal com underscore no nome continua sendo um canal só: quem ancora
    // a divisão são os três grupos do fim, não o primeiro underscore.
    expect(channelOf("ROTA_SECA_1_8_2026")).toBe("ROTA_SECA");
    expect(channelOf("EMPURRADA_2_12_2025")).toBe("EMPURRADA");
  });

  it("devolve canal nulo, e não um canal inventado, para rótulo fora do padrão", () => {
    // Rótulos de fixture e de arquivos com nome à mão caem todos na mesma
    // partição nula — e ficam comparáveis entre si, que é o desejado.
    for (const label of ["CAR_JAN", "vigencia-1", "EMPURRADA"]) {
      expect(channelOf(label)).toBeNull();
    }
  });

  it("não confunde canal com data quando o rótulo tem números demais", () => {
    // Os três grupos do fim ganham; o resto é canal, mesmo com dígitos.
    expect(channelOf("R2_1_8_2026")).toBe("R2");
    expect(parseVigenciaLabel("R2_1_8_2026").effectiveDate).toBe("2026-08-01");
  });
});
