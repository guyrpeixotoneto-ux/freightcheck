import { describe, expect, it } from "vitest";
import { ehSaudacao, interpretar } from "../interpretacao";
import { avancarEstado, ESTADO_VAZIO } from "../conversa";
import { responder } from "../resposta";
import type { Database } from "@workspace/db";
import type { Dossie } from "../orquestrador";

/**
 * Um "bom dia" respondido com "não encontrei nada sobre isto".
 *
 * Era a primeira coisa que o produto dizia a quem abria a tela, e não era um
 * defeito de redação: a orquestração tratava o cumprimento como consulta, não
 * achava nada — porque não havia o que achar — e concluía a única coisa que
 * podia concluir. O que estes testes fixam é a fronteira: o que é conversa, o
 * que continua sendo pergunta, e o que acontece com o fio quando alguém
 * agradece no meio dele.
 *
 * **O caso que mais importa aqui é o negativo.** Uma detecção larga demais
 * transforma pergunta de verdade em conversa fiada, e esse erro é pior que o
 * que ele conserta: quem perguntou fica sem resposta e sem saber por quê.
 */

describe("o que é saudação", () => {
  it.each([
    "ola",
    "Olá",
    "oi",
    "oii",
    "opa",
    "bom dia",
    "Boa tarde!",
    "boa noite",
    "tudo bem?",
    "Tudo bem?",
    "e aí",
    "beleza?",
    "oi, tudo bem?",
    "Olá, bom dia",
    "bom dia, assistente",
    "obrigado",
    "Obrigada!",
    "valeu",
    "tchau",
    "até logo",
  ])("%j é conversa", (frase) => {
    expect(ehSaudacao(frase)).toBe(true);
    expect(interpretar(frase).intencao).toBe("SAUDACAO");
  });
});

describe("o que continua sendo pergunta", () => {
  /*
    A saudação educada na frente de uma pergunta de verdade é o caso perigoso:
    ela casa o vocabulário social e ainda assim pede uma consulta. Quem escreve
    "bom dia, qual o valor do IPVA?" espera o IPVA, não uma apresentação.
  */
  it.each([
    ["bom dia, qual o valor do IPVA?", "VALOR"],
    ["oi, o que mudou na última vigência?", "MOVIMENTO"],
    ["olá, o que é o Book do Operador?", "BOOK"],
    ["obrigado, mas quanto mudou o pneu?", "EVOLUCAO"],
  ])("%j continua sendo %s", (frase, intencao) => {
    expect(
      ehSaudacao(frase),
      `"${frase}" não pode ser lida como saudação`,
    ).toBe(false);
    expect(interpretar(frase).intencao).toBe(intencao);
  });

  it.each([
    "onde perdemos mais dinheiro?",
    "quais veículos foram mais impactados?",
    "compare julho e agosto",
    "por quê?",
    "e julho?",
  ])("%j não é saudação", (frase) => {
    expect(ehSaudacao(frase)).toBe(false);
  });

  it("frase vazia não é saudação", () => {
    expect(ehSaudacao("   ")).toBe(false);
  });
});

describe("a resposta a um cumprimento", () => {
  /*
    Sem banco de propósito, e isso é uma afirmação, não um atalho: uma saudação
    não resolve recorte, não consulta vigência e não busca no corpus. Se algum
    dia ela passar a tocar o banco, este teste quebra com um erro de conexão —
    e é assim que se descobre que o caminho voltou a fazer o que não devia.
  */
  const semBanco = null as unknown as Database;

  it("não diz que não encontrou nada", async () => {
    const r = await responder(semBanco, "bom dia", { semIa: true });

    expect(r.intencao).toBe("SAUDACAO");
    expect(r.texto).not.toMatch(/não encontrei/i);
    expect(r.lacunas, "cumprimento não gera lacuna").toEqual([]);
  });

  it("se apresenta e convida a pergunta", async () => {
    const r = await responder(semBanco, "ola", { semIa: true });

    expect(r.texto).toMatch(/assistente do FreightCheck/i);
    expect(r.texto).toMatch(/\?$/);
  });

  it("oferece perguntas clicáveis em vez de repeti-las no texto", async () => {
    const r = await responder(semBanco, "oi, tudo bem?", { semIa: true });

    expect(r.sugestoes.length).toBe(3);
    for (const sugestao of r.sugestoes) {
      expect(r.texto, "o exemplo vive na sugestão, não no texto").not.toContain(
        sugestao,
      );
    }
  });

  it("não cita fonte nenhuma — não houve consulta", async () => {
    const r = await responder(semBanco, "obrigado", { semIa: true });

    expect(r.fontes).toEqual([]);
    expect(r.etapas.map((e) => e.nome)).toEqual(["interpretar"]);
  });
});

describe("a saudação não carrega entidade nem herança", () => {
  it("não nomeia parâmetro, período nem intervalo", () => {
    const leitura = interpretar("bom dia");
    expect(leitura.entidades.assuntoCandidato).toBeNull();
    expect(leitura.entidades.periodo).toBeNull();
    expect(leitura.entidades.intervalo).toBeNull();
  });

  it("não é continuação — mesmo quando a forma parece", () => {
    // "e aí?" começa com "e" e é curta: casaria o padrão de continuação.
    expect(interpretar("e aí?").continuacao).toBe(false);
  });

  it("agradecer no meio da conversa não apaga o assunto", () => {
    const anterior = {
      ...ESTADO_VAZIO,
      intencao: "EVOLUCAO" as const,
      assunto: "ipva",
      parametro: "IPVA",
    };
    const dossie = {
      leitura: interpretar("obrigado"),
      plano: { intencao: "SAUDACAO", alvo: null, contexto: null },
      evidencias: [],
      documentos: [],
    } as unknown as Dossie;

    const depois = avancarEstado(anterior, dossie);

    expect(depois.intencao, "o fio continua no que se investigava").toBe(
      "EVOLUCAO",
    );
    expect(depois.assunto).toBe("ipva");
  });
});
