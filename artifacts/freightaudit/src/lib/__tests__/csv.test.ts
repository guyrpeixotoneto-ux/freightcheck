import { describe, expect, it } from "vitest";
import { montarCsv, numeroParaCsv, paraNomeDeArquivo } from "../csv";

/**
 * O CSV existe para ser aberto no Excel em português, e cada teste aqui guarda
 * uma falha desse caminho — não uma preferência de formato.
 */
describe("o número", () => {
  it("sai com vírgula decimal, que é o que o Excel brasileiro soma", () => {
    expect(numeroParaCsv(1424.91)).toBe("1424,91");
    expect(numeroParaCsv(-61006)).toBe("-61006,00");
  });

  it("não leva separador de milhar — ele seria lido como outra coluna", () => {
    expect(numeroParaCsv(1234567.5)).toBe("1234567,50");
  });
});

describe("o arquivo", () => {
  it("separa por ponto e vírgula, porque a vírgula já é o decimal", () => {
    expect(montarCsv([["Placa", "Pneus"], ["ABC1D23", "0,00"]])).toBe(
      "﻿Placa;Pneus\r\nABC1D23;0,00\r\n",
    );
  });

  it("abre com o BOM — sem ele todo acento vira ruído no Excel", () => {
    expect(montarCsv([["Manutenção"]]).startsWith("﻿")).toBe(true);
  });

  it("cita só a célula que precisa, e dobra as aspas de dentro dela", () => {
    const csv = montarCsv([["sem aspas", "com;separador", 'com "aspas"']]);
    expect(csv).toContain("sem aspas;");
    expect(csv).toContain('"com;separador"');
    expect(csv).toContain('"com ""aspas"""');
  });

  it("cita a quebra de linha — uma ressalva de duas linhas não vira duas linhas", () => {
    expect(montarCsv([["uma\nressalva"]])).toBe('﻿"uma\nressalva"\r\n');
  });
});

describe("o nome do arquivo", () => {
  /*
    O caso real: "CAMAÇARI · EMPURRADA" e "01/08/2026". A barra é um diretório
    que não existe, e o navegador salva como `download` sem extensão.
  */
  it("perde acento, barra e pontuação — o que sobra ainda identifica", () => {
    expect(paraNomeDeArquivo("CAMAÇARI · EMPURRADA")).toBe("camacari-empurrada");
    expect(paraNomeDeArquivo("01/08/2026")).toBe("01-08-2026");
    expect(paraNomeDeArquivo("  ago/2026  ")).toBe("ago-2026");
  });
});
