import { describe, expect, it } from "vitest";
import {
  baseQueFalta,
  podeSomar,
  podeTirarMedia,
  viraDinheiro,
  type SemanticaDoAtributo,
} from "../agregacao";

/**
 * A autoridade sobre agregação, sozinha.
 *
 * Estes testes não tocam o banco de propósito: a decisão é uma função pura de
 * cinco campos, e é essa pureza que permite os outros módulos consultarem a
 * mesma resposta sem carregar consulta nenhuma. O arquivo irmão em
 * `@workspace/composition` é quem prova que eles de fato consultam.
 */

const attr = (over: Partial<SemanticaDoAtributo> = {}): SemanticaDoAtributo => ({
  unit: "BRL",
  aggregation: "SUM",
  isMonetary: true,
  semanticsStatus: "CONFIRMED",
  ...over,
});

describe("podeSomar — a pergunta aritmética", () => {
  it("soma montante em reais marcado como somável", () => {
    expect(podeSomar(attr()).ok).toBe(true);
  });

  it("soma sem exigir confirmação: o cockpit lê o arquivo, não a apuração", () => {
    // A diferença entre as duas perguntas. Unificá-las faria o cockpit perder o
    // total de tudo que ainda não passou pela curadoria.
    expect(podeSomar(attr({ semanticsStatus: "PRESUMED" })).ok).toBe(true);
    expect(viraDinheiro(attr({ semanticsStatus: "PRESUMED" })).ok).toBe(false);
  });

  it.each(["KM_L", "BRL_KM", "PERCENT"])(
    "recusa somar %s mesmo com SUM gravado no campo",
    (unit) => {
      // O buraco que a auditoria encontrou: o banco aceita gravar isto, e até a
      // constraint existir esta função é a única coisa que impede km/l virar reais.
      const veredito = podeSomar(attr({ unit, aggregation: "SUM" }));
      expect(veredito.ok).toBe(false);
      expect(veredito.motivo).toContain("razão");
    },
  );

  it("diz o que faltaria, e não só que não dá", () => {
    expect(podeSomar(attr({ unit: "KM_L", aggregation: "SUM" })).motivo).toContain(
      "quilometragem rodada e preço do litro",
    );
  });

  it.each(["TEXT", "BOOLEAN", "DATE", "MIXED", "UNKNOWN"])(
    "recusa somar o tipo não numérico %s",
    (dataType) => {
      expect(podeSomar(attr({ dataType, aggregation: "SUM" })).ok).toBe(false);
    },
  );

  it("recusa qualquer agregação que não seja SUM, dizendo qual é", () => {
    expect(podeSomar(attr({ aggregation: "AVG" })).motivo).toContain("AVG");
    expect(podeSomar(attr({ aggregation: null })).motivo).toContain("indefinida");
  });
});

describe("viraDinheiro — a pergunta financeira", () => {
  it("exige confirmação humana antes de tudo", () => {
    const veredito = viraDinheiro(attr({ semanticsStatus: "UNKNOWN" }));
    expect(veredito.ok).toBe(false);
    expect(veredito.motivo).toContain("desconhecida");
  });

  it("exige que seja montante financeiro", () => {
    expect(viraDinheiro(attr({ isMonetary: false })).motivo).toContain("montante financeiro");
  });

  it("herda a recusa aritmética quando a semântica já está confirmada", () => {
    // Uma razão confirmada como monetária e somável passa pelos dois primeiros
    // portões — e é barrada pelo terceiro, que é `podeSomar`.
    const veredito = viraDinheiro(attr({ unit: "BRL_KM", aggregation: "SUM" }));
    expect(veredito.ok).toBe(false);
    expect(veredito.motivo).toContain("razão");
  });

  it("pergunta na ordem que explica melhor: confirmação, natureza, aritmética", () => {
    // Tudo errado ao mesmo tempo: o motivo devolvido é o da confirmação, porque
    // é a ação que destrava as outras.
    const veredito = viraDinheiro(
      attr({ semanticsStatus: "PRESUMED", isMonetary: false, aggregation: "NONE" }),
    );
    expect(veredito.motivo).toContain("presumida");
  });
});

describe("podeTirarMedia — e a ponderada que não existe", () => {
  it("aceita média simples para grandeza física por ativo", () => {
    const veredito = podeTirarMedia(attr({ unit: "MESES", aggregation: "AVG", isMonetary: false }));
    expect(veredito.ok).toBe(true);
    expect(veredito.tipo).toBe("SIMPLES");
  });

  it("aceita média para o que soma: numerador e denominador existem", () => {
    expect(podeTirarMedia(attr()).ok).toBe(true);
  });

  it("recusa WEIGHTED_AVG em vez de entregar média simples com nome de ponderada", () => {
    const veredito = podeTirarMedia(attr({ unit: "KM", aggregation: "WEIGHTED_AVG" }));
    expect(veredito.ok).toBe(false);
    expect(veredito.motivo).toContain("não está implementada");
  });

  it("recusa média de razão: a média das razões não é a razão da frota", () => {
    // O caso do print que abriu esta auditoria: KM_L com AVG no formulário.
    const veredito = podeTirarMedia(attr({ unit: "KM_L", aggregation: "AVG" }));
    expect(veredito.ok).toBe(false);
    expect(veredito.motivo).toContain("não é a razão da frota");
  });

  it("recusa média de tipo não numérico", () => {
    expect(podeTirarMedia(attr({ dataType: "TEXT", aggregation: "AVG" })).ok).toBe(false);
  });
});

describe("baseQueFalta — o que se pergunta à Ambev", () => {
  it("nomeia o dado ausente de cada razão", () => {
    expect(baseQueFalta(attr({ unit: "BRL_KM" }))).toContain("quilometragem rodada");
    expect(baseQueFalta(attr({ unit: "PERCENT" }))).toContain("montante sobre o qual");
  });

  it("é nulo quando o que falta não é dado da fonte", () => {
    expect(baseQueFalta(attr({ unit: "BRL" }))).toBeNull();
    expect(baseQueFalta(attr({ unit: null }))).toBeNull();
  });
});
