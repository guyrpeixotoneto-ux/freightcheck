import { describe, expect, it } from "vitest";
import { TIPOS_DE_IMPORTACAO } from "@workspace/ingest/tipos";

import { AMBIENTES, ehAuditoria, type AmbienteDeAuditoria } from "@/lib/ambiente";
import { TIPOS_DO_AMBIENTE, tiposDoAmbiente } from "@/lib/importacoes";

/**
 * O contrato das abas de Importações: **cada auditoria oferece os tipos da
 * operação dela, e as quatro oferecem os dois QLPs.**
 *
 * A aba é a declaração — enviar por ela afirma ao pipeline o que o arquivo traz
 * —, e toda chamada desta tela vai carimbada com a operação do ambiente. Uma
 * aba "Cavalo" dentro da Auditoria Apoio, portanto, não é só um item a mais no
 * menu: é o caminho para uma vigência de empurrada nascer dentro do acervo do
 * apoio. Estes casos são o que impede essa aba de voltar sem que alguém decida
 * que ela deve voltar.
 */

const codigos = (ambiente: AmbienteDeAuditoria): string[] =>
  tiposDoAmbiente(ambiente).map((tipo) => tipo.code);

const QLP = ["QLP_ADMINISTRATIVO", "QLP_OPERACIONAL"];

describe("que tipos cada auditoria importa", () => {
  it("a Empurrada recebe cavalo, carreta e trecho — mais os dois QLPs", () => {
    expect(codigos("auditoria")).toEqual(["CAVALO", "CARRETA", "TRECHO", ...QLP]);
  });

  it("a Rota recebe caminhão e carroceria, e não o cavalo da empurrada", () => {
    expect(codigos("auditoria-rota")).toEqual(["CAMINHAO", "CARROCERIA", ...QLP]);
  });

  it("o AS roda os mesmos ativos da rota", () => {
    expect(codigos("auditoria-as")).toEqual(codigos("auditoria-rota"));
  });

  it("o Apoio recebe só a empilhadeira — sem carreta e sem trecho", () => {
    expect(codigos("auditoria-apoio")).toEqual(["EMPILHADEIRA", ...QLP]);
  });

  it("os dois QLPs valem para as quatro: o quadro de pessoal existe em toda operação", () => {
    for (const ambiente of Object.keys(TIPOS_DO_AMBIENTE) as AmbienteDeAuditoria[]) {
      expect(codigos(ambiente)).toEqual(expect.arrayContaining(QLP));
    }
  });

  it("nenhum ativo de uma operação aparece na aba de outra", () => {
    expect(codigos("auditoria")).not.toContain("CAMINHAO");
    expect(codigos("auditoria")).not.toContain("EMPILHADEIRA");
    expect(codigos("auditoria-rota")).not.toContain("CAVALO");
    expect(codigos("auditoria-apoio")).not.toContain("CAVALO");
    // O trecho é a perna da rota que só o export da empurrada traz.
    expect(codigos("auditoria-rota")).not.toContain("TRECHO");
    expect(codigos("auditoria-apoio")).not.toContain("TRECHO");
  });
});

describe("a lista do ambiente não inventa tipo nenhum", () => {
  it("todo código oferecido é um tipo que o pipeline sabe ler", () => {
    const conhecidos = TIPOS_DE_IMPORTACAO.map((tipo) => tipo.code);
    for (const ambiente of Object.keys(TIPOS_DO_AMBIENTE) as AmbienteDeAuditoria[]) {
      for (const code of codigos(ambiente)) {
        expect(conhecidos).toContain(code);
      }
    }
  });

  it("os oito tipos do pipeline continuam alcançáveis por alguma auditoria", () => {
    const oferecidos = new Set(
      (Object.keys(TIPOS_DO_AMBIENTE) as AmbienteDeAuditoria[]).flatMap(codigos),
    );
    for (const tipo of TIPOS_DE_IMPORTACAO) {
      expect(oferecidos).toContain(tipo.code);
    }
  });

  it("as quatro auditorias têm lista — uma auditoria nova não nasce sem abas", () => {
    const auditorias = AMBIENTES.map((a) => a.id).filter(ehAuditoria);
    expect(auditorias.every((id) => codigos(id).length > 0)).toBe(true);
  });

  it("a definição vem inteira: rótulo e identidade, para a aba e o dropzone", () => {
    const cavalo = tiposDoAmbiente("auditoria")[0];
    expect(cavalo.rotulo).toBe("Cavalo");
    expect(cavalo.identidade.map((coluna) => coluna.sourceName)).toEqual(["Placa"]);
  });
});

describe("fora das auditorias", () => {
  it("um fechamento cai na lista da empurrada, como `baseDaAuditoria` faz", () => {
    expect(codigos("auditoria")).toEqual(
      tiposDoAmbiente("fechamento-rota").map((tipo) => tipo.code),
    );
  });
});
