/**
 * A medição precisa dizer a verdade sobre si mesma antes de medir o resto.
 *
 * Cada caso aqui fixa uma distinção que a resposta **não fazia** e cuja
 * ausência custou uma investigação manual: "não houve chamada" não é "houve e
 * foi descartada"; "não há chave" não é "quem chamou pediu sem modelo"; e a
 * contagem do contexto tem de contar o que o modelo recebe, não o que o dossiê
 * carrega.
 */

import { describe, expect, it } from "vitest";
import { contextoParaOModelo, explicarRedacao } from "../medicao";
import type { Dossie } from "../orquestrador";
import type { Evidencia } from "../ferramentas";

function dossieVazio(parcial: Partial<Dossie> = {}): Dossie {
  return {
    pergunta: "o que mudou?",
    leitura: {
      intencao: "MOVIMENTO",
      porque: "teste",
      continuacao: false,
      entidades: { assuntoCandidato: null, periodo: null, intervalo: null, equipamento: null },
    } as Dossie["leitura"],
    plano: {
      intencao: "MOVIMENTO",
      necessidades: ["MOVIMENTO"],
      porque: "teste",
      assunto: null,
      comoReconheceu: null,
      herdado: [],
      alvo: null,
      resolucao: null,
      contexto: null,
      origemDoRecorte: "PADRAO" as const,
      unidadeCitada: null,
      periodoImpossivel: null,
      periodo: null,
      intervalo: null,
    },
    trechos: [],
    documentos: [],
    evidencias: [],
    anexos: [],
    lacunas: [],
    etapas: [],
    desambiguacao: null,
    encadeamentos: [],
  telaScopeHash: null,
    diagnostico: { book: { candidatos: 0, selecionados: 0, melhorPontuacao: 0 }, ms: 1 },
    ...parcial,
  };
}

const evidencia = (fatos: Evidencia["fatos"]): Evidencia => ({
  ferramenta: "resumoDaVigencia",
  titulo: "O que mudou em agosto/2026",
  fatos,
  numeros: [267],
  origem: "getFamiliesView",
});

describe("explicarRedacao — a causa, e não o sintoma", () => {
  it("separa falta de chave de IA desligada por opção", () => {
    const base = { frasesPodadas: 0, frasesTotais: 0, numerosRecusados: [], erro: null };

    const semChave = explicarRedacao({ ...base, codigo: "SEM_CHAVE" });
    const desligada = explicarRedacao({ ...base, codigo: "IA_DESLIGADA" });

    // As duas redigem em código e nenhuma chamou o modelo — e mesmo assim não
    // podem ser a mesma linha de relatório: uma é ambiente faltando, a outra é
    // uma escolha de quem chamou.
    expect(semChave.redigiu).toBe("DETERMINISTICA");
    expect(desligada.redigiu).toBe("DETERMINISTICA");
    expect(semChave.houveChamada).toBe(false);
    expect(desligada.houveChamada).toBe(false);
    expect(semChave.causa).not.toBe(desligada.causa);
    expect(semChave.causa).toContain("ANTHROPIC_API_KEY");
    expect(desligada.causa).toContain("semIa");
  });

  it("uma resposta descartada declara houve chamada, com a conta das frases", () => {
    const m = explicarRedacao({
      codigo: "DESCARTADA",
      frasesPodadas: 7,
      frasesTotais: 9,
      numerosRecusados: ["1.234", "56"],
      erro: null,
    });

    expect(m.houveChamada).toBe(true);
    expect(m.redigiu).toBe("DETERMINISTICA");
    expect(m.causa).toContain("7 de 9");
    expect(m.causa).toContain("1.234");
  });

  it("uma resposta podada continua sendo do modelo", () => {
    const m = explicarRedacao({
      codigo: "IA_PODADA",
      frasesPodadas: 1,
      frasesTotais: 12,
      numerosRecusados: ["99"],
      erro: null,
    });

    expect(m.redigiu).toBe("IA");
    expect(m.houveChamada).toBe(true);
  });

  it("o erro da API entra na causa, para não virar 'sem chave' na leitura", () => {
    const m = explicarRedacao({
      codigo: "ERRO",
      frasesPodadas: 0,
      frasesTotais: 0,
      numerosRecusados: [],
      erro: "529 overloaded",
    });

    expect(m.causa).toContain("529 overloaded");
    expect(m.houveChamada).toBe(true);
  });
});

describe("contextoParaOModelo — o que o modelo recebe, não o que o dossiê tem", () => {
  it("um dossiê vazio é contado como vazio, e não como 'não medido'", () => {
    const c = contextoParaOModelo(dossieVazio());

    expect(c.itens.total).toBe(0);
    expect(c.fatos).toBe(0);
    expect(c.secoes).toEqual([]);
  });

  it("não conta a evidência cujos fatos são todos internos", () => {
    /*
      `emTexto` filtra essa evidência antes de enviar. Contá-la aqui faria a
      medição afirmar um material que o modelo nunca viu — que é exatamente o
      tipo de erro que este módulo existe para não cometer.
    */
    const c = contextoParaOModelo(
      dossieVazio({
        evidencias: [
          evidencia([{ rotulo: "Revisão vigente", valor: "1", interno: true }]),
          evidencia([{ rotulo: "Alterações", valor: "267" }]),
        ],
      }),
    );

    expect(c.itens.dado).toBe(1);
    expect(c.fatos).toBe(1);
    expect(c.secoes).toContain("EVIDÊNCIA");
  });

  it("corta o histórico como `montarMensagens` o corta", () => {
    const historico = Array.from({ length: 12 }, (_, i) => ({
      papel: "PERGUNTA" as const,
      texto: `t${i}`.padEnd(4000, "x"),
    }));

    const c = contextoParaOModelo(dossieVazio(), { historico });

    // Oito turnos, cada um em três mil caracteres: o que o modelo vê, e não o
    // que a conversa acumulou.
    expect(c.turnos).toBe(8);
    expect(c.caracteres.historico).toBe(8 * 3000);
  });

  it("o texto integral do dossiê só sai quando quem chamou pede", () => {
    const dossie = dossieVazio({ evidencias: [evidencia([{ rotulo: "Alterações", valor: "267" }])] });

    expect(contextoParaOModelo(dossie).dossie).toBeNull();
    expect(contextoParaOModelo(dossie, { incluirTexto: true }).dossie).toContain("267");
  });

  it("mede o dossiê mesmo sem chave — é o caso em que a medição mais importa", () => {
    const c = contextoParaOModelo(
      dossieVazio({ evidencias: [evidencia([{ rotulo: "Alterações", valor: "267" }])] }),
      { incluirTexto: true },
    );

    expect(c.caracteres.dossie).toBeGreaterThan(0);
    expect(c.caracteres.instrucao).toBeGreaterThan(1000);
  });
});
