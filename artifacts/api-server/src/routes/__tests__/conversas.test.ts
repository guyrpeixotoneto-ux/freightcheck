/**
 * A conversa é de quem a criou — provado, não prometido.
 *
 * A promessa "toda consulta filtra pelo dono" é fácil de escrever num
 * comentário e fácil de furar na rota seguinte. Cada caso aqui é uma tentativa
 * de acesso que **tem** de falhar: ler, renomear, arquivar e continuar a
 * conversa de outra pessoa. Todas voltam `null` — não erro, não vazio parcial —
 * porque para quem não é dono aquela conversa simplesmente não existe.
 *
 * O último caso é o outro lado da mesma regra: arquivar não apaga. Depois de
 * arquivada, a conversa some da lista e **todas** as mensagens continuam na
 * tabela; um histórico que sustentou uma decisão de auditoria não desaparece
 * porque alguém arrumou a barra lateral.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import {
  acharConversa,
  arquivarConversa,
  criarConversa,
  gravarTurno,
  listarConversas,
  mensagensDaConversa,
  renomearConversa,
  tituloDe,
} from "../../lib/conversas";

let banco: TestDb;
let dona: string;
let outra: string;
let conversa: string;

async function criarPessoa(email: string): Promise<string> {
  const { rows } = await banco.db.execute<{ id: string }>(sql`
    INSERT INTO app_user (name, email, password_hash)
    VALUES (${email}, ${email}, 'scrypt$sem-uso-neste-teste')
    RETURNING id
  `);
  return rows[0]!.id;
}

beforeAll(async () => {
  banco = await createTestDatabase("conversas");
  dona = await criarPessoa("dona@empresa.com");
  outra = await criarPessoa("outra@empresa.com");

  const criada = await criarConversa(banco.db, dona, "Quanto mudou o IPVA", {
    termoDoParametro: "ipva",
  });
  conversa = criada.id;
  await gravarTurno(banco.db, conversa, "Quanto mudou o IPVA?", {
    texto: "204 alterações em julho/2026.",
    redacao: "DETERMINISTICA",
    evidencia: { intencao: "EVOLUCAO" },
  });
});

afterAll(async () => {
  await banco?.drop();
});

describe("a conversa é privada de quem a criou", () => {
  it("a dona lê a própria conversa", async () => {
    expect(await acharConversa(banco.db, dona, conversa)).toBeTruthy();
    expect(await listarConversas(banco.db, dona)).toHaveLength(1);
  });

  it("outra pessoa não lê", async () => {
    expect(await acharConversa(banco.db, outra, conversa)).toBeNull();
    expect(await listarConversas(banco.db, outra)).toEqual([]);
  });

  it("outra pessoa não renomeia", async () => {
    expect(await renomearConversa(banco.db, outra, conversa, "invadida")).toBeNull();
    const intacta = await acharConversa(banco.db, dona, conversa);
    expect(intacta!.title).toBe("Quanto mudou o IPVA");
  });

  it("outra pessoa não arquiva", async () => {
    expect(await arquivarConversa(banco.db, outra, conversa)).toBeNull();
    expect(await acharConversa(banco.db, dona, conversa)).toBeTruthy();
  });
});

describe("excluir é arquivar", () => {
  it("some da lista e nenhuma mensagem é apagada", async () => {
    const antes = await mensagensDaConversa(banco.db, conversa);
    expect(antes.length).toBeGreaterThan(0);

    expect(await arquivarConversa(banco.db, dona, conversa)).toBeTruthy();

    expect(await listarConversas(banco.db, dona)).toEqual([]);
    expect(await acharConversa(banco.db, dona, conversa)).toBeNull();

    const { rows } = await banco.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM assistant_message WHERE conversation_id = ${conversa}
    `);
    expect(rows[0]!.n, "as mensagens continuam no banco").toBe(antes.length);
  });
});

describe("o título nasce do assunto", () => {
  it("tira a pontuação final e não corta palavra ao meio", () => {
    expect(tituloDe("Quanto mudou o IPVA?")).toBe("Quanto mudou o IPVA");
    const longo = tituloDe(
      "Quais parâmetros do FreightCheck não têm preço suficiente para calcular impacto nesta vigência?",
    )!;
    expect(longo.length).toBeLessThanOrEqual(61);
    expect(longo.endsWith("…")).toBe(true);
    expect(longo).not.toMatch(/\s…$/);
  });

  /*
    A barra lateral tinha meia dúzia de conversas chamadas "ola" — o título
    nascia da primeira linha digitada, e a primeira linha costuma ser um
    cumprimento. Sem assunto não há título: quem batiza é a pergunta seguinte.
  */
  it("um cumprimento não vira nome de conversa", () => {
    expect(tituloDe("ola")).toBeNull();
    expect(tituloDe("bom dia!")).toBeNull();
    expect(tituloDe("oi, tudo bem?")).toBeNull();
  });

  it("o assunto resolvido vence a frase digitada", () => {
    expect(tituloDe("me explica isso aí", { bloco: "QLP ADM" })).toBe("QLP ADM");
    expect(tituloDe("quanto mudou?", { parametro: "IPVA e licenciamento" })).toBe(
      "IPVA e licenciamento",
    );
  });
});
