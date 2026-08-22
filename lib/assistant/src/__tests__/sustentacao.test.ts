/**
 * "Tem certeza?" — o caso prioritário, e a prova de que ele deixou de escorregar.
 *
 * **O defeito, reproduzido antes de corrigido.** A frase não casava detector
 * nenhum, caía no plano padrão e recebia o movimento da vigência. Quem duvidou
 * de uma conclusão recebia um relatório sobre outra coisa — e a resposta era
 * fluente, correta sobre o que dizia, e completamente fora da pergunta. É o pior
 * formato de erro que este assistente pode produzir.
 *
 * **A fronteira que este arquivo protege nos dois sentidos.** Dúvida nua é
 * meta-pergunta. Dúvida com uma **afirmação rival** — "confirma que foi R$ 50
 * mil?" — não é: é um pedido de verificação, e a única resposta honesta a ela é
 * consultar e dizer qual é o número apurado. Tratá-la como meta-pergunta
 * deixaria o número falso sem contestação, que é exatamente o que a categoria
 * anti-alucinação do benchmark existe para pegar.
 */

import { describe, expect, it } from "vitest";
import { detectar, leituraProvisoria } from "../plano";
import { nivelDe, responderSustentacao, semRespostaAnterior, CRITERIO } from "../sustentacao";
import type { SustentacaoGuardada } from "../conversa";
import type { FocoDaConversa } from "../foco";

const BASE: SustentacaoGuardada = {
  pergunta: "Qual teve maior perda em agosto?",
  conclusao: "A maior perda veio do consumo negociado do cavalo.",
  consultas: ["alteracoes:grupos", "veiculosDoGrupo"],
  evidencias: 2,
  encadeamentos: 1,
  lacunas: [],
  podadas: { removidas: 0, total: 8 },
  redigiu: "IA",
  recorte: "CAMAÇARI · EMPURRADA",
  vigencia: "2026-08-01",
};

const FOCO: FocoDaConversa = {
  tipo: "GRUPO",
  id: "cavalo.consumo_negociado",
  rotulo: "Consumo negociado cavalo",
  valor: { numero: 52500, escrito: "−R$ 52.500,00/mês", grandeza: "MOEDA" },
  vigencia: "2026-08-01",
  ferramenta: "alteracoes:grupos",
};

describe("a meta-pergunta é reconhecida, e só ela", () => {
  it("a dúvida nua vira SUSTENTACAO", () => {
    for (const p of [
      "Tem certeza?",
      "Confirma?",
      "Como você sabe?",
      "De onde tirou isso?",
      "Qual a confiança nessa resposta?",
      "Posso confiar nisso?",
    ]) {
      expect(detectar(p), p).toContain("SUSTENTACAO");
    }
  });

  it("o defeito reproduzido: sem esta necessidade, a frase não casava nada", () => {
    /*
      A régua anterior, reescrita: sem o detector de SUSTENTACAO, "Tem certeza?"
      não casa detector nenhum e a leitura provisória devolve DESCONHECIDA —
      que é o que a mandava para o plano padrão e para o resumo da vigência.
    */
    const semODetector = detectar("Tem certeza?").filter((n) => n !== "SUSTENTACAO");
    expect(semODetector, "era isto que sobrava — nada").toEqual([]);
    expect(leituraProvisoria("Tem certeza?").intencao).toBe("SUSTENTACAO");
  });

  it("dúvida com afirmação rival NÃO é meta-pergunta — ela pede verificação", () => {
    /*
      "Confirma que o impacto de agosto foi de R$ 50 mil?" traz um número que
      não saiu de consulta nenhuma. A resposta certa é consultar e dizer qual é
      o apurado; devolver uma auditoria da resposta anterior deixaria o valor
      falso de pé.
    */
    for (const p of [
      "Confirma que o impacto de agosto foi de R$ 50 mil?",
      "Tem certeza de que foram 300 alterações?",
      "Você garante que isso deu R$ 128.400,00 por mês?",
    ]) {
      expect(detectar(p), p).not.toContain("SUSTENTACAO");
    }
  });
});

describe("o nível de sustentação — critério, nunca score", () => {
  it("chegou à célula da planilha, sem lacuna e sem poda: comprovado diretamente", () => {
    expect(nivelDe({ ...BASE, consultas: [...BASE.consultas, "proveniencia"] })).toBe(
      "COMPROVADO_DIRETAMENTE",
    );
  });

  it("tudo de consulta, mas sem descer à planilha: fortemente sustentado", () => {
    expect(nivelDe(BASE)).toBe("FORTEMENTE_SUSTENTADO");
  });

  it("qualquer buraco rebaixa para indicativo — lacuna, poda ou consulta que falhou", () => {
    expect(nivelDe({ ...BASE, lacunas: ["não há preço para essa coluna"] })).toBe("INDICATIVO");
    expect(nivelDe({ ...BASE, podadas: { removidas: 1, total: 8 } })).toBe("INDICATIVO");
    expect(nivelDe({ ...BASE, consultas: ["alteracoes:grupos (falhou)"] })).toBe("INDICATIVO");
  });

  it("sem evidência nenhuma: inconclusivo — não há o que confirmar", () => {
    expect(nivelDe({ ...BASE, evidencias: 0 })).toBe("INCONCLUSIVO");
  });

  it("cada nível tem o critério escrito, e nenhum tem número inventado", () => {
    for (const [nivel, criterio] of Object.entries(CRITERIO)) {
      expect(criterio.length, nivel).toBeGreaterThan(30);
      expect(criterio, `${nivel} não pode ter score arbitrário`).not.toMatch(/\d+\s*%/);
    }
  });
});

describe("a resposta separa as quatro coisas que se está perguntando", () => {
  const texto = responderSustentacao(BASE, FOCO).texto;

  it("fatos, cálculos, interpretação e limitações — sempre as quatro", () => {
    for (const secao of ["### Fatos", "### Cálculos", "### Interpretação", "### Limitações"]) {
      expect(texto, `falta ${secao}`).toContain(secao);
    }
  });

  it("abre com a conclusão que está sendo posta em dúvida", () => {
    expect(texto).toContain(BASE.conclusao);
  });

  it("diz o nível e o critério dele — não um percentual de confiança", () => {
    expect(texto).toContain("fortemente sustentado");
    expect(texto).not.toMatch(/\b\d{1,3}%\s*de confian/i);
  });

  it("nomeia o número em discussão a partir do foco estruturado", () => {
    expect(texto).toContain("−R$ 52.500,00/mês");
    expect(texto).toContain("Consumo negociado cavalo");
  });

  it("quando não desceu à planilha, oferece a descida como próximo passo", () => {
    expect(texto).toContain("de onde saiu esse número");
  });

  it("uma consulta que falhou aparece nas limitações, com nome", () => {
    const comFalha = responderSustentacao(
      { ...BASE, consultas: ["alteracoes:grupos", "proveniencia (falhou)"] },
      FOCO,
    ).texto;
    expect(comFalha).toContain("esta consulta falhou");
    expect(comFalha).toContain("nada foi concluído a partir dela");
  });

  it("a poda da trava é declarada — quem lê sabe que leu o que sobrou", () => {
    const comPoda = responderSustentacao(
      { ...BASE, podadas: { removidas: 2, total: 9 } },
      FOCO,
    ).texto;
    expect(comPoda).toContain("2 de 9");
    expect(comPoda).toContain("o que sobrou");
  });

  it("nenhuma resposta fala da máquina em vocabulário de máquina", () => {
    for (const proibido of ["tool", "dossiê", "endpoint", "SQL", "scopeHash"]) {
      expect(texto.toLowerCase(), proibido).not.toContain(proibido.toLowerCase());
    }
  });
});

describe("sem resposta anterior, não há o que confirmar", () => {
  it("declara isso em vez de inventar o que estaria sendo confirmado", () => {
    const t = semRespostaAnterior();
    expect(t).toContain("Não há uma resposta minha anterior");
    expect(t).not.toMatch(/\d/);
  });
});
