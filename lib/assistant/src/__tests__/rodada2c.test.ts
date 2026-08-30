import { describe, expect, it } from "vitest";
import { interpretar } from "../interpretacao";
import { sanear, vinculosSemLastro, type Dossie } from "../orquestrador";
import { redacaoDeInvestigacaoIncompleta, redacaoDeDescarte } from "../resposta";
import type { Evidencia } from "../ferramentas";

/**
 * Os modos de falha que a rodada 2C expôs — os que as correções da 2B não
 * cobriram, e os que elas mesmas criaram.
 *
 * Cada caso aqui saiu de uma resposta real de produção do build `92573f0d`,
 * conferida contra o banco. A numeração `#n` é a da rodada.
 */

const FINAME: Evidencia = {
  ferramenta: "alteracoes:linhas",
  titulo: "Financiamento (Finame) da carreta — 02/08/2026",
  fatos: [
    { rotulo: "RPG8G28", valor: "8.320,80 → 25.548,15", detalhe: "+17.227,35/mês" },
    { rotulo: "RPG1E60", valor: "8.320,80 → 12.998,65", detalhe: "+4.677,85/mês" },
    { rotulo: "Total do grupo", valor: "+R$ 21.905,20/mês", detalhe: "2 alterações deste lado" },
  ],
  numeros: [8320.8, 25548.15, 12998.65, 17227.35, 4677.85, 21905.2],
  identificadores: ["RPG8G28", "RPG1E60"],
  origem: "getChangeRows · carreta.finame · 2026-08-02",
  recorte: {
    unidade: "PERNAMBUCO", canal: "EMPURRADA",
    contexto: "PERNAMBUCO · EMPURRADA", vigencia: "02/08/2026",
  },
};

const DOSSIE = {
  pergunta: "O que mudou de relevante?",
  leitura: interpretar("O que mudou de relevante?"),
  plano: {
    intencao: "MOVIMENTO" as const, necessidades: ["MOVIMENTO" as const], porque: "",
    assunto: null, comoReconheceu: null, herdado: [], alvo: null, resolucao: null,
    contexto: null, origemDoRecorte: "PADRAO" as const, unidadeCitada: null,
    periodoImpossivel: null, periodo: "2026-08-02", intervalo: null,
  },
  trechos: [], documentos: [], evidencias: [FINAME], anexos: [], lacunas: [], etapas: [],
  desambiguacao: null, encadeamentos: [], telaScopeHash: null,
  diagnostico: { book: { candidatos: 0, selecionados: 0, melhorPontuacao: 0 }, ms: 0 },
} satisfies Dossie;

// ---------------------------------------------------------------------------

describe("1 — investigação interrompida não abre o Book (#11, #27)", () => {
  it("declara o teto em vez de despejar documento", () => {
    const t = redacaoDeInvestigacaoIncompleta(DOSSIE, "TETO_DE_RODADAS", 6);
    expect(t).toContain("Não cheguei a uma conclusão");
    expect(t).toContain("6 rodadas");
    expect(t).toContain("alteracoes:linhas");
    expect(t).not.toContain("INTRODUÇÃO");
    expect(t).not.toContain("INCLUDEPICTURE");
    expect(t).not.toContain("Faixa reflexiva");
    expect(t).not.toMatch(/all rights reserved/i);
  });

  it("não diz que não encontrou nada quando encontrou", () => {
    // #9 da 2B: nove consultas bem-sucedidas e a resposta foi "não encontrei nada".
    const t = redacaoDeInvestigacaoIncompleta(DOSSIE, "TETO_DE_RODADAS", 6);
    expect(t).not.toMatch(/não encontrei/i);
    expect(t).toContain("elas valem, o que falta é a conclusão");
  });

  it("distingue teto de rodadas de teto de tokens", () => {
    const tokens = redacaoDeInvestigacaoIncompleta(DOSSIE, "TETO_DE_TOKENS", 6);
    expect(tokens).toContain("grande demais");
    expect(tokens).not.toContain("rodadas de consulta");
  });

  it("é curta e sugere o caminho", () => {
    const t = redacaoDeInvestigacaoIncompleta(DOSSIE, "TETO_DE_RODADAS", 6);
    expect(t.length).toBeLessThan(700);
    expect(t).toContain("estreitar a pergunta");
  });
});

describe("2 — o marcador não emenda no parágrafo (21 respostas)", () => {
  it("entra em linha própria em texto corrido", () => {
    const resposta =
      "O Finame responde por 99,88% de todo o impacto [1].\n" +
      "O impacto foi de R$ 999.888,77 [1].\n" +
      "O que segue em aberto é a curadoria [1].";
    const { texto } = sanear(resposta, DOSSIE);
    expect(texto).toContain("trecho removido");
    expect(texto).not.toContain("999.888,77");
    // O defeito da 2C: "…[4]. _[trecho removido…]_ **O que segue…" na mesma linha.
    for (const linha of texto.split("\n")) {
      const temMarcador = /_\[trecho removido/.test(linha);
      if (!temMarcador) continue;
      expect(linha.trim()).toMatch(/^_\[trecho removido[^\]]*\]_$/);
    }
  });
});

describe("3 — contagem sem entidade nomeada (#5, #6, #8, #19, #24, #38, #39)", () => {
  it("recusa o valor de uma placa atribuído a quatro", () => {
    // O caso literal: o banco mostra 4 carretas com 4 pares distintos.
    const errado = "O lucro variável previsto saiu de zero para R$ 12.998,65 em 4 carretas [1].";
    const recusados = vinculosSemLastro(errado, DOSSIE);
    expect(recusados.join(" ")).toContain("12.998,65");
    expect(sanear(errado, DOSSIE).texto).not.toContain("12.998,65");
  });

  it("aceita a contagem que o dossiê sustenta", () => {
    // 8.320,80 aparece nas duas linhas de placa: "em 2 carretas" se sustenta.
    const certo = "As duas carretas partiam de R$ 8.320,80 [1].";
    expect(vinculosSemLastro(certo, DOSSIE)).toEqual([]);
  });

  it("não opina quando a frase nomeia placa — as regras 1 e 2 já decidem", () => {
    const certo = "A RPG8G28 foi para R$ 25.548,15 e a RPG1E60 para R$ 12.998,65 [1].";
    expect(vinculosSemLastro(certo, DOSSIE)).toEqual([]);
  });

  it("não opina sobre valor que o dossiê não tem — isso é da régua de lastro", () => {
    const semLastro = "O valor foi para R$ 77.777,77 em 4 carretas [1].";
    expect(vinculosSemLastro(semLastro, DOSSIE)).toEqual([]);
    expect(sanear(semLastro, DOSSIE).texto).not.toContain("77.777,77");
  });
});

describe("4 — nenhuma correção afrouxou o gate", () => {
  it("número inventado continua recusado", () => {
    expect(sanear("O impacto foi de R$ 999.888,77/mês [1].", DOSSIE).texto)
      .not.toContain("999.888,77");
  });
  it("placa inventada continua recusada", () => {
    expect(sanear("A carreta ZZZ9Z99 puxou o resultado [1].", DOSSIE).texto)
      .not.toContain("ZZZ9Z99");
  });
  it("o descarte continua declarando o que não confirmou", () => {
    const t = redacaoDeDescarte(DOSSIE, ["99.111,22"]);
    expect(t).toContain("Não consigo sustentar");
    expect(t).not.toContain("99.111,22");
  });
  it("texto sustentado atravessa sem poda", () => {
    const bom = "A RPG8G28 foi de R$ 8.320,80 para R$ 25.548,15, o que dá +17.227,35/mês [1].";
    expect(sanear(bom, DOSSIE).removidas).toBe(0);
  });
});
