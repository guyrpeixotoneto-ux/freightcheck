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
  registrarFeedback,
  listarConversas,
  mensagensDaConversa,
  renomearConversa,
  emCaixaDeTitulo,
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
    assunto: "ipva",
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

/*
  O voto é a única medida de qualidade que não fomos nós que escolhemos medir —
  e por isso ele precisa das mesmas garantias de toda escrita neste produto:
  quem vota é quem perguntou, e só a resposta recebe voto.
*/
describe("o voto de quem leu", () => {
  /*
    Uma conversa só desta suíte: a de cima é arquivada pelo teste de exclusão, e
    `acharConversa` — que é o filtro do dono — não enxerga arquivada. Reusá-la
    faria estes casos passarem ou falharem conforme a ordem em que rodassem.
  */
  let propria: string;
  let respostaId: string;

  beforeAll(async () => {
    const criada = await criarConversa(banco.db, dona, "Voto", {});
    propria = criada.id;
    await gravarTurno(banco.db, propria, "Quanto mudou o pneu?", {
      texto: "Mudou.",
      redacao: "IA",
      evidencia: {},
    });
    const mensagens = await mensagensDaConversa(banco.db, propria);
    respostaId = mensagens.find((m) => m.role === "RESPOSTA")!.id;
  });

  it("a dona vota, e votar de novo troca o voto", async () => {

    const util = await registrarFeedback(banco.db, dona, propria, respostaId, "UTIL");
    expect(util?.feedback).toBe("UTIL");

    const naoUtil = await registrarFeedback(banco.db, dona, propria, respostaId, "NAO_UTIL");
    expect(naoUtil?.feedback).toBe("NAO_UTIL");
  });

  it("e clicar de novo desfaz", async () => {
    await registrarFeedback(banco.db, dona, propria, respostaId, "UTIL");
    const desfeito = await registrarFeedback(banco.db, dona, propria, respostaId, null);
    expect(desfeito?.feedback).toBeNull();
  });

  it("outra pessoa não vota", async () => {
    expect(await registrarFeedback(banco.db, outra, propria, respostaId, "UTIL")).toBeNull();
  });

  it("a pergunta não recebe voto", async () => {
    const mensagens = await mensagensDaConversa(banco.db, propria);
    const pergunta = mensagens.find((m) => m.role === "PERGUNTA")!;
    expect(
      await registrarFeedback(banco.db, dona, propria, pergunta.id, "UTIL"),
    ).toBeNull();
  });
});

describe("o título nasce da pergunta", () => {
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

  /*
    Nomear tudo pelo bloco fazia a lista repetir "CUSTO FIXO DE EQUIPAMENTOS"
    seis vezes. A pergunta distingue uma conversa da outra — o assunto
    resolvido só entra quando a frase se apoia no que já estava na tela.
  */
  it("a pergunta que nomeia o assunto vence o bloco resolvido", () => {
    expect(
      tituloDe("O que mais mudou na última vigência?", {
        bloco: "PREÇO COMBUSTÍVEIS",
      }),
    ).toBe("O que mais mudou na última vigência");
  });

  it("a frase que só aponta para a tela cede ao assunto resolvido", () => {
    expect(tituloDe("me explica isso aí", { bloco: "QLP ADM" })).toBe("QLP ADM");
    expect(tituloDe("quanto mudou?", { parametro: "IPVA e licenciamento" })).toBe(
      "IPVA e licenciamento",
    );
    expect(tituloDe("me explica isso aí")).toBeNull();
  });

  it("caixa alta do Book vira texto de ler, com as siglas de pé", () => {
    expect(tituloDe("e agora?", { bloco: "PREÇO COMBUSTÍVEIS" })).toBe(
      "Preço combustíveis",
    );
    expect(tituloDe("e agora?", { bloco: "CUSTO FIXO DE EQUIPAMENTOS" })).toBe(
      "Custo fixo de equipamentos",
    );
    expect(tituloDe("e agora?", { bloco: "QLP ADM" })).toBe("QLP ADM");
    expect(tituloDe("e agora?", { parametro: "IPVA E LICENCIAMENTO" })).toBe(
      "IPVA e licenciamento",
    );
  });

  it("quem escreveu com minúsculas decide a caixa", () => {
    expect(emCaixaDeTitulo("Preço de combustíveis")).toBe("Preço de combustíveis");
    expect(emCaixaDeTitulo("FINAME das carretas")).toBe("FINAME das carretas");
  });
});
