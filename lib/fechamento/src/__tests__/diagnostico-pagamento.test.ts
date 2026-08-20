import { describe, expect, it } from "vitest";

import { diagnosticarPagamento } from "../diagnostico-pagamento";
import { fixturePagamentoDoPainel } from "./fixtures";

/**
 * O diagnóstico que responde "importei e não apareceu".
 *
 * Cada caso aqui é uma forma real de o 03.08.20 não virar verba, e o que se
 * afirma é a **causa** — não o texto. A frase pode melhorar; o que não pode é
 * o arquivo recortado ser diagnosticado como layout novo, porque quem conserta
 * um e quem conserta o outro são pessoas diferentes, e a errada perde o dia.
 */

/** O fixture bom, com uma coluna de valor a menos em cada linha de verba. */
function comUmaColunaAMenos(): Buffer {
  const texto = fixturePagamentoDoPainel().toString("utf8");
  return Buffer.from(
    texto
      .split(/\r?\n/)
      .map((l) => {
        const m = /^(\s*\d{1,3}\s*-\s*.+?\s{2,})((?:-?[\d.]+,\d{2}\s+){5})(-?[\d.]+,\d{2})\s*$/.exec(l);
        return m ? `${m[1]}${m[2]!.trimEnd()}` : l;
      })
      .join("\r\n"),
    "utf8",
  );
}

/** O fixture bom, sem os cabeçalhos de seção que tornam a verba elegível. */
function semOsCabecalhosDeSecao(): Buffer {
  const texto = fixturePagamentoDoPainel().toString("utf8");
  return Buffer.from(texto.replace("FRETE\r\n", "").replace("OUTROS CUSTOS\r\n", ""), "utf8");
}

/** O fixture bom sem nenhuma linha de verba — só cabeçalho e descontos. */
function soComOsDescontos(): Buffer {
  const texto = fixturePagamentoDoPainel().toString("utf8");
  return Buffer.from(
    texto
      .split(/\r?\n/)
      .filter((l) => !/^\s*\d{1,3}\s*-\s*\D/.test(l))
      .join("\r\n"),
    "utf8",
  );
}

describe("por que o 03.08.20 não virou verba", () => {
  it("o arquivo bom é diagnosticado como bom, e conta o que leu", () => {
    const d = diagnosticarPagamento(fixturePagamentoDoPainel());
    expect(d.causa).toBe("LEU_NORMALMENTE");
    expect(d.lido.verbas).toBeGreaterThan(0);
    expect(d.cabecalho.periodo.inicio).toBe("2026-07-16");
    expect(d.secoes).toMatchObject({ canal: true, bloco: true });
  });

  it("com uma coluna de valor a menos, aponta a linha e diz quantas achou", () => {
    const d = diagnosticarPagamento(comUmaColunaAMenos());
    expect(d.causa).toBe("LINHA_DE_VERBA_RECUSADA");
    expect(d.lido.verbas).toBe(0);
    expect(d.suspeitas.length).toBeGreaterThan(0);
    expect(d.suspeitas[0]?.motivo).toContain("5 coluna(s) de valor");
    /* A linha física, para quem for abrir o arquivo no editor. */
    expect(d.suspeitas[0]?.linha).toBeGreaterThan(0);
    expect(d.suspeitas[0]?.original).toContain("-");
  });

  it("sem os cabeçalhos de seção, é o arquivo que veio recortado — não o leitor", () => {
    /* A distinção que decide quem conserta: aqui as verbas estão no formato
       certo e foram descartadas por não estarem sob `FRETE`/`OUTROS CUSTOS`.
       Diagnosticar isso como layout novo mandaria mexer no leitor. */
    const d = diagnosticarPagamento(semOsCabecalhosDeSecao());
    expect(d.causa).toBe("SEM_CABECALHO_DE_SECAO");
    expect(d.secoes.verbasBemFormatadas).toBeGreaterThan(0);
    expect(d.secoes.bloco).toBe(false);
    expect(d.resumo).toContain("recortado");
  });

  it("sem nenhum dos três cabeçalhos, o arquivo enviado não é o 03.08.20", () => {
    const d = diagnosticarPagamento(
      Buffer.from("relatorio qualquer\nsem nenhuma linha que o leitor reconheca\n", "utf8"),
    );
    expect(d.causa).toBe("NAO_E_O_03_08_20");
    expect(d.resumo).toContain("não é o demonstrativo");
  });

  it("com cabeçalho e só descontos, diz que o corpo de verba não veio", () => {
    /* O caso relatado da tela: o arquivo é o 03.08.20, os descontos entraram,
       e `linhas_lidas` fica cheio sem uma verba sequer. */
    const d = diagnosticarPagamento(soComOsDescontos());
    expect(d.causa).toBe("SEM_CORPO_DE_VERBA");
    expect(d.lido.verbas).toBe(0);
    expect(d.lido.descontos).toBeGreaterThan(0);
    expect(d.suspeitas).toEqual([]);
  });
});
