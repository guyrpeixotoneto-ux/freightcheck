/**
 * ETAPA 0, prova 3 — depois de um restart, consigo explicar uma resposta antiga?
 *
 * **O que estava faltando, dito com precisão.** A telemetria do assistente vive
 * num anel de 500 eventos em memória, por decisão declarada: ele responde "como
 * está agora", não "como estava em março". A coluna `evidence` guarda as fontes
 * e as lacunas — o que *sustenta* o texto. Nenhum dos dois guarda o que
 * *explica* o texto: de que unidade a resposta falava, quem escolheu essa
 * unidade, o que foi consultado, com que argumentos, e por que a trava podou o
 * que podou. Sem esses campos, "a IA respondeu errado ontem" só se investiga
 * reproduzindo a pergunta à mão — contra um banco que pode já ter mudado.
 *
 * **O restart é simulado do único jeito honesto: derrubando o pool.** Um teste
 * que lesse a mesma conexão provaria que o objeto continua em memória, que é
 * exatamente o que não está em questão. Aqui a conexão que escreveu é fechada,
 * uma nova é aberta contra o mesmo banco, e a explicação é remontada só do que
 * o Postgres devolveu.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  appUserTable,
  assistantConversationTable,
  assistantMessageTable,
  createDb,
  type Database,
} from "@workspace/db";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { responder } from "../resposta";
import { explicarRastro, VERSAO_DO_RASTRO, type RastroDaResposta } from "../rastro";

const ATRIBUTOS: AttributeSpec[] = [
  {
    code: "cavalo.ipva_licenciamento",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "ANUAL",
    aggregation: "SUM",
    isMonetary: true,
  },
];

describe("Etapa 0 — o rastro sobrevive ao processo", () => {
  let ctx: TestDb;
  let url: string;
  let conversaId: string;
  let respostaId: string;

  beforeAll(async () => {
    ctx = await createTestDatabase("rastro_reproduz");
    url = ctx.url;
    const db: Database = ctx.db;

    await buildFixture(
      db,
      ATRIBUTOS,
      [
        {
          label: "antes",
          effectiveDate: "2026-07-02",
          data: { AAA1A11: { "cavalo.ipva_licenciamento": 1000 } },
        },
        {
          label: "depois",
          effectiveDate: "2026-08-01",
          data: { AAA1A11: { "cavalo.ipva_licenciamento": 1200 } },
        },
      ],
      { entityType: "CAVALO", scopeHash: "hash-unico", canal: "EMPURRADA" },
    );

    const [pessoa] = await db
      .insert(appUserTable)
      .values({ email: "rastro@teste", name: "Rastro", passwordHash: "x", role: "ADMIN" })
      .returning();

    /*
      A resposta é produzida sem modelo (`semIa`), e isso não enfraquece a
      prova: o rastro descreve a orquestração e a trava, que rodam nos dois
      casos. O que ficaria de fora é a medição da chamada — e ela tem o seu
      próprio campo, que aqui sai nulo dizendo justamente "não houve chamada".
    */
    const resposta = await responder(db, "O que mudou em agosto?", {
      recorte: { scopeHash: "hash-unico" },
      semIa: true,
    });

    const [conversa] = await db
      .insert(assistantConversationTable)
      .values({ ownerId: pessoa!.id, title: "prova", state: {} })
      .returning();
    conversaId = conversa!.id;

    const gravadas = await db
      .insert(assistantMessageTable)
      .values([
        { conversationId: conversaId, position: 0, role: "PERGUNTA", content: "O que mudou em agosto?" },
        {
          conversationId: conversaId,
          position: 1,
          role: "RESPOSTA",
          content: resposta.texto,
          writer: resposta.redacao,
          evidence: { fontes: resposta.fontes },
          trace: resposta.rastro,
        },
      ])
      .returning({ id: assistantMessageTable.id, role: assistantMessageTable.role });
    respostaId = gravadas.find((g) => g.role === "RESPOSTA")!.id;

    // O "restart": a conexão que escreveu deixa de existir.
    await ctx.pool.end();
  }, 120_000);

  afterAll(async () => {
    const limpeza = createDb(url);
    await limpeza.pool.end();
    await ctx?.drop().catch(() => undefined);
  });

  it("o rastro está no banco, e não só na memória do processo", async () => {
    const { db, pool } = createDb(url);
    try {
      const [linha] = await db
        .select({ trace: assistantMessageTable.trace })
        .from(assistantMessageTable)
        .where(
          and(
            eq(assistantMessageTable.id, respostaId),
            eq(assistantMessageTable.conversationId, conversaId),
          ),
        );
      expect(linha?.trace, "a resposta gravada tem de carregar o rastro").toBeTruthy();
      const rastro = linha!.trace as RastroDaResposta;
      expect(rastro.v).toBe(VERSAO_DO_RASTRO);
    } finally {
      await pool.end();
    }
  });

  it("as sete perguntas de uma investigação têm resposta no que foi guardado", async () => {
    const { db, pool } = createDb(url);
    try {
      const [linha] = await db
        .select({ trace: assistantMessageTable.trace })
        .from(assistantMessageTable)
        .where(eq(assistantMessageTable.id, respostaId));
      const r = linha!.trace as RastroDaResposta;

      // 1. de que recorte a resposta falava
      expect(r.recorte.scopeHash).toBe("hash-unico");
      expect(r.recorte.rotulo).toBeTruthy();
      // 2. quem escolheu esse recorte
      expect(r.recorte.origem).toBe("TELA");
      // 3. de que vigência
      expect(r.recorte.vigencia).toBe("2026-08-01");
      // 4. o que o produto entendeu da pergunta
      expect(r.leitura.intencao).toBeTruthy();
      expect(r.leitura.necessidades.length).toBeGreaterThan(0);
      // 5. o que foi consultado
      expect(r.consultas.length).toBeGreaterThan(0);
      expect(r.consultas[0]!.nome).toBeTruthy();
      // 6. o que aconteceu com o texto
      expect(r.grounding.redigiu).toBe("DETERMINISTICA");
      expect(Array.isArray(r.grounding.numerosRecusados)).toBe(true);
      // 7. o que custou
      expect(r.orquestracao.ms).toBeGreaterThanOrEqual(0);
      expect(r.modelo.nome, "sem chamada ao modelo, o campo diz isso").toBeNull();
    } finally {
      await pool.end();
    }
  });

  it("a explicação em prosa é montada só do que o banco devolveu", async () => {
    const { db, pool } = createDb(url);
    try {
      const [linha] = await db
        .select({ trace: assistantMessageTable.trace })
        .from(assistantMessageTable)
        .where(eq(assistantMessageTable.id, respostaId));
      const texto = explicarRastro(linha!.trace as RastroDaResposta);

      expect(texto).toContain("Recorte:");
      expect(texto).toContain("escolhido por TELA");
      expect(texto).toContain("Consultou");
      expect(texto).toContain("Texto: DETERMINISTICA");
      expect(texto).toContain("Orquestração:");
      /*
        A asserção que impede o rastro de virar decoração: a explicação nomeia a
        consulta que rodou. Um rastro que guardasse só contagens passaria em
        tudo acima e não responderia "o que ele foi buscar?".
      */
      expect(texto).toMatch(/#1 \w+/);
    } finally {
      await pool.end();
    }
  });

  it("um período recusado deixa a causa gravada — o turno sem número se explica", async () => {
    const { db, pool } = createDb(url);
    try {
      const resposta = await responder(db, "O que mudou em fevereiro de 1998?", {
        recorte: { scopeHash: "hash-unico" },
        semIa: true,
      });
      const r = resposta.rastro;
      expect(r.recorte.periodoRecusado).not.toBeNull();
      expect(r.recorte.periodoRecusado!.pedido).toContain("1998");
      expect(r.recorte.vigencia).toBeNull();
      expect(explicarRastro(r)).toContain("Nenhuma consulta de dado rodou");
    } finally {
      await pool.end();
    }
  }, 60_000);
});
