import { describe, expect, it } from "vitest";
import { caminhoDaFicha, tituloDaPlacaAusente } from "../ficha-da-entidade";
import type { EntidadeAusente } from "../tipos";

/**
 * A travessia da Cobertura até a ficha.
 *
 * O que estes casos protegem não é a formatação da URL — é a decisão de
 * **para qual vigência** o link aponta. Apontar para a vigência da célula
 * levaria o leitor a uma ficha vazia, e uma ficha vazia depois de um clique
 * parece defeito do produto quando é o fato do arquivo.
 */

const sumiu: EntidadeAusente = {
  entityId: "7e8b751c-3289-4a5f-bf31-730a947e4352",
  entityType: "CAVALO",
  rotulo: "RZG4I77",
  ultimaVigencia: "2026-04-02",
  vigenciasComDado: 2,
  origem: "CONTINUIDADE",
  motivo: null,
};

const nuncaVeio: EntidadeAusente = {
  entityId: "cad0440a-f567-4934-a167-332db6e132f6",
  entityType: "CAVALO",
  rotulo: "AAA0A00",
  ultimaVigencia: null,
  vigenciasComDado: 0,
  origem: "DECLARACAO",
  motivo: "Transferida de Betim em março; deve vir no arquivo.",
};

const vigencia = {
  effectiveDate: "2026-08-01",
  scopeHash: "ae920348ff",
  canal: "EMPURRADA",
};

describe("caminhoDaFicha", () => {
  it("abre a ficha da entidade pelo entityId", () => {
    expect(caminhoDaFicha(sumiu, vigencia)).toContain(`/composicao/${sumiu.entityId}?`);
  });

  it("aponta para a última vigência em que a placa apareceu, não para a da célula", () => {
    const url = new URL(caminhoDaFicha(sumiu, vigencia), "https://x");
    expect(url.searchParams.get("period")).toBe("2026-04-02");
    expect(url.searchParams.get("period")).not.toBe(vigencia.effectiveDate);
  });

  it("leva o recorte junto, para não abrir a ficha em outra unidade", () => {
    const url = new URL(caminhoDaFicha(sumiu, vigencia), "https://x");
    expect(url.searchParams.get("scopeHash")).toBe("ae920348ff");
    expect(url.searchParams.get("canal")).toBe("EMPURRADA");
  });

  it("para quem nunca veio, cai na vigência da célula — não há mês melhor", () => {
    const url = new URL(caminhoDaFicha(nuncaVeio, vigencia), "https://x");
    expect(url.searchParams.get("period")).toBe("2026-08-01");
  });

  it("escapa o que precisa ser escapado", () => {
    const comEspaco = { ...vigencia, canal: "EMPURRADA ESPECIAL" };
    const url = new URL(caminhoDaFicha(sumiu, comEspaco), "https://x");
    expect(url.searchParams.get("canal")).toBe("EMPURRADA ESPECIAL");
  });
});

describe("tituloDaPlacaAusente", () => {
  it("na ausência por continuidade, diz desde quando", () => {
    expect(tituloDaPlacaAusente(sumiu)).toContain("2 vigências anteriores");
    expect(tituloDaPlacaAusente(sumiu)).toContain("2026-04-02");
  });

  it("concorda o singular", () => {
    expect(tituloDaPlacaAusente({ ...sumiu, vigenciasComDado: 1 })).toContain(
      "1 vigência anterior;",
    );
  });

  /*
    A frase de continuidade aplicada a quem nunca veio diria "apareceu em 0
    vigência(s) anterior(es); a última foi null". O caso declarado tem frase
    própria porque tem conteúdo próprio: quem decidiu, e por quê.
  */
  it("na ausência declarada sem histórico, diz que é declaração e mostra o motivo", () => {
    const t = tituloDaPlacaAusente(nuncaVeio);
    expect(t).toContain("Declarada esperada em Curadoria");
    expect(t).toContain("Transferida de Betim");
    expect(t).not.toContain("null");
    expect(t).not.toContain("0 vigências");
  });
});
