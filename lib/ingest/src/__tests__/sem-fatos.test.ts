import { describe, expect, it } from "vitest";
import { motivoDeArquivoSemFatos } from "../sem-fatos";

/**
 * A recusa do arquivo que não produziu nada.
 *
 * Sem banco: a regra é uma função de (abas, fatos) para frase, e é assim que
 * ela precisa continuar — a mesma frase vai para o `failure_reason` do run,
 * para a lista de apontamentos e para o 422 da aprovação.
 */

const aba = (sheetName: string, role: string, rowCount = 100) => ({
  sheetName,
  role,
  rowCount,
});

describe("um arquivo que produziu fatos", () => {
  it("não é recusado, mesmo com abas descartadas ao lado", () => {
    expect(
      motivoDeArquivoSemFatos({
        abas: [aba("cavalos", "SOURCE"), aba("Quantidade", "PIVOT")],
        fatos: 42_000,
      }),
    ).toBeNull();
  });

  it("não é recusado nem quando um único fato entrou", () => {
    expect(
      motivoDeArquivoSemFatos({ abas: [aba("cavalos", "SOURCE")], fatos: 1 }),
    ).toBeNull();
  });
});

describe("um arquivo em que nenhuma aba virou fonte", () => {
  const motivo = motivoDeArquivoSemFatos({
    abas: [aba("Trecho", "PIVOT", 812), aba("Parâmetros", "UNKNOWN", 30)],
    fatos: 0,
  });

  it("recusa, e diz que nada foi gravado", () => {
    expect(motivo).not.toBeNull();
    expect(motivo).toMatch(/não entrou/i);
    expect(motivo).toMatch(/[Nn]ada foi gravado/);
  });

  it("nomeia as abas descartadas — é por onde quem operou procura", () => {
    expect(motivo).toContain('"Trecho"');
    expect(motivo).toContain('"Parâmetros"');
  });

  it("diz qual é o grão que o leitor exige, sem mandar mexer no dado", () => {
    expect(motivo).toMatch(/vigência e placa/i);
    // A frase não pede ao cliente que invente uma coluna para agradar o leitor.
    expect(motivo).not.toMatch(/acrescente|adicione uma coluna/i);
  });
});

describe("um arquivo cujas abas foram lidas mas não renderam fato", () => {
  const motivo = motivoDeArquivoSemFatos({
    abas: [aba("cavalos", "SOURCE", 1), aba("carretas", "SOURCE", 1)],
    fatos: 0,
  });

  it("recusa por um motivo diferente do anterior", () => {
    expect(motivo).toMatch(/foram lidas como fonte/);
    expect(motivo).toMatch(/nenhuma linha produziu fato/);
  });

  it("nomeia as abas que foram lidas", () => {
    expect(motivo).toContain('"cavalos" e "carretas"');
  });
});

describe("um arquivo sem aba nenhuma", () => {
  it("recusa dizendo que o arquivo não foi lido", () => {
    expect(motivoDeArquivoSemFatos({ abas: [], fatos: 0 })).toMatch(
      /nenhuma aba foi lida/i,
    );
  });
});
