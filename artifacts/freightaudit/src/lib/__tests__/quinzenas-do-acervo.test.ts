import { describe, expect, it } from "vitest";
import {
  JANELA,
  quinzenasDoAcervo,
  semEnvio,
  tipoJaEntrou,
  tiposDaVigencia,
  type RunComVigencias,
} from "../quinzenas-do-acervo";

/**
 * O contrato da lista por quinzena: **o calendário é fato, a importação é
 * registro, e a falta é a diferença entre os dois.**
 *
 * Nada aqui pode afirmar que uma quinzena *deveria* ter sido enviada — não há
 * registro nenhum dizendo isso, e inventá-lo seria a mesma promessa vazia que o
 * produto recusa em toda tela. O que se afirma é que a quinzena existe no
 * calendário e que nada entrou nela.
 */

const HOJE = "2026-09-17"; // 2ª quinzena de setembro, em curso.

const run = (patch: Partial<RunComVigencias>): RunComVigencias => ({
  importRunId: "run-1",
  declaredType: null,
  vigencias: [],
  ...patch,
});

const vigencia = (effectiveDate: string, tipos: string[], label = "EMPURRADA") => ({
  label,
  effectiveDate,
  tipos,
});

const chaves = (linhas: { periodo: { chave: string } }[]) =>
  linhas.map((l) => l.periodo.chave);

describe("a janela do calendário", () => {
  it("abre na quinzena corrente e volta seis meses, mesmo sem importação nenhuma", () => {
    const linhas = quinzenasDoAcervo([], HOJE);

    expect(linhas).toHaveLength(JANELA);
    expect(chaves(linhas)[0]).toBe("2026-09-Q2");
    // Doze quinzenas atrás a partir de setembro/2026 é abril/2026.
    expect(chaves(linhas).at(-1)).toBe("2026-04-Q1");
  });

  it("atravessa a virada do ano sem pular nem repetir", () => {
    const linhas = quinzenasDoAcervo([], "2026-01-05");

    expect(chaves(linhas)[0]).toBe("2026-01-Q1");
    expect(chaves(linhas)[1]).toBe("2025-12-Q2");
    expect(chaves(linhas)[2]).toBe("2025-12-Q1");
    // Doze quinzenas contando a de janeiro: a última é a 2ª de julho de 2025.
    expect(chaves(linhas).at(-1)).toBe("2025-07-Q2");
  });

  it("a quinzena corrente é a única em curso", () => {
    const linhas = quinzenasDoAcervo([], HOJE);

    expect(linhas.filter((l) => l.emCurso).map((l) => l.periodo.chave)).toEqual([
      "2026-09-Q2",
    ]);
  });
});

describe("o que entrou em cada quinzena", () => {
  it("põe a importação na quinzena da vigência dela, pelo tipo que ela trouxe", () => {
    const cavalo = run({
      importRunId: "cavalo-set",
      vigencias: [vigencia("2026-09-01", ["CAVALO"], "EMPURRADA_1_9_2026")],
    });

    const linhas = quinzenasDoAcervo([cavalo], HOJE);
    const primeiraDeSetembro = linhas.find((l) => l.periodo.chave === "2026-09-Q1");

    expect(primeiraDeSetembro?.porTipo.get("CAVALO")).toEqual([
      { run: cavalo, label: "EMPURRADA_1_9_2026" },
    ]);
    expect(primeiraDeSetembro?.porTipo.get("CARRETA")).toBeUndefined();
  });

  it("o dia 16 cai na segunda quinzena, e o 15 na primeira", () => {
    const dia15 = run({
      importRunId: "dia-15",
      vigencias: [vigencia("2026-08-15", ["CAVALO"])],
    });
    const dia16 = run({
      importRunId: "dia-16",
      vigencias: [vigencia("2026-08-16", ["CAVALO"])],
    });

    const linhas = quinzenasDoAcervo([dia15, dia16], HOJE);
    const q1 = linhas.find((l) => l.periodo.chave === "2026-08-Q1");
    const q2 = linhas.find((l) => l.periodo.chave === "2026-08-Q2");

    expect(q1?.porTipo.get("CAVALO")?.map((e) => e.run.importRunId)).toEqual(["dia-15"]);
    expect(q2?.porTipo.get("CAVALO")?.map((e) => e.run.importRunId)).toEqual(["dia-16"]);
  });

  it("um arquivo com dois tipos entra nas duas colunas da mesma quinzena", () => {
    const doisTipos = run({
      importRunId: "cavalo-e-carreta",
      vigencias: [vigencia("2026-08-01", ["CARRETA", "CAVALO"])],
    });

    const linha = quinzenasDoAcervo([doisTipos], HOJE).find(
      (l) => l.periodo.chave === "2026-08-Q1",
    );

    expect(linha?.porTipo.get("CAVALO")).toHaveLength(1);
    expect(linha?.porTipo.get("CARRETA")).toHaveLength(1);
  });

  it("o consolidado conta uma vez, não uma por unidade", () => {
    // Duas vigências, mesmo rótulo e mesma data — uma por unidade. Houve um
    // envio, e a linha da quinzena não pode dizer dois.
    const consolidado = run({
      importRunId: "consolidado",
      vigencias: [
        vigencia("2026-08-01", ["CAVALO"], "EMPURRADA_1_8_2026"),
        vigencia("2026-08-01", ["CAVALO"], "EMPURRADA_1_8_2026"),
      ],
    });

    const linha = quinzenasDoAcervo([consolidado], HOJE).find(
      (l) => l.periodo.chave === "2026-08-Q1",
    );

    expect(linha?.porTipo.get("CAVALO")).toHaveLength(1);
  });

  it("a declaração do envio manda sobre o medido, como nas abas", () => {
    // Uma importação antiga, anterior ao agregado por tipo: a vigência não sabe
    // dizer o que veio, e quem sabe é a declaração.
    const declarada = run({
      importRunId: "sem-agregado",
      declaredType: "TRECHO",
      vigencias: [vigencia("2026-08-01", [])],
    });

    const linha = quinzenasDoAcervo([declarada], HOJE).find(
      (l) => l.periodo.chave === "2026-08-Q1",
    );

    expect(linha?.porTipo.get("TRECHO")).toHaveLength(1);
    expect(tiposDaVigencia(declarada, { tipos: [] })).toEqual(["TRECHO"]);
  });

  it("uma importação fora da janela não some — a janela é do calendário, não dela", () => {
    const antiga = run({
      importRunId: "antiga",
      vigencias: [vigencia("2024-03-01", ["CAVALO"])],
    });
    const futura = run({
      importRunId: "futura",
      vigencias: [vigencia("2044-08-01", ["CAVALO"])],
    });

    const linhas = quinzenasDoAcervo([antiga, futura], HOJE);

    expect(chaves(linhas)).toContain("2024-03-Q1");
    expect(chaves(linhas)).toContain("2044-08-Q1");
    // E a ordem continua sendo da mais recente para a mais antiga.
    expect(chaves(linhas)[0]).toBe("2044-08-Q1");
    expect(chaves(linhas).at(-1)).toBe("2024-03-Q1");
  });
});

describe("o que falta", () => {
  it("conta as quinzenas sem envio daquele tipo", () => {
    const cavalo = run({
      importRunId: "cavalo-ago",
      vigencias: [vigencia("2026-08-01", ["CAVALO"])],
    });

    const linhas = quinzenasDoAcervo([cavalo], HOJE);

    // Das doze da janela, uma tem envio e a corrente não conta.
    expect(semEnvio(linhas, "CAVALO")).toHaveLength(JANELA - 2);
  });

  it("a quinzena em curso nunca é falta", () => {
    const linhas = quinzenasDoAcervo([], HOJE);

    expect(semEnvio(linhas, "CAVALO").map((l) => l.periodo.chave)).not.toContain(
      "2026-09-Q2",
    );
  });
});

describe("a ausência que não é falta", () => {
  it("separa o tipo que esta unidade entrega do tipo que ela nunca entregou", () => {
    const cavalo = run({
      importRunId: "cavalo",
      vigencias: [vigencia("2026-08-01", ["CAVALO"])],
    });

    const linhas = quinzenasDoAcervo([cavalo], HOJE);

    // Cavalo entra aqui, e as quinzenas vazias dele são falta.
    expect(tipoJaEntrou(linhas, "CAVALO")).toBe(true);
    // Trecho nunca entrou: a coluna vazia não afirma falta nenhuma.
    expect(tipoJaEntrou(linhas, "TRECHO")).toBe(false);
  });
});
