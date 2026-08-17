/**
 * A mecânica do laço, sem depender de chave.
 *
 * **O que dá para provar aqui, e o que não dá.** A *escolha* de ferramentas é do
 * modelo, e simulá-la seria falsificar a prova que o PR 2 precisa dar — essa
 * roda no relatório de trajetória, contra a API de verdade. O que se prova aqui
 * é tudo o que fica em volta dela e que o relatório não isola: que uma segunda
 * rodada acontece, que o `tool_result` volta casado com o `tool_use_id` certo,
 * que a narração intermediária não vira resposta, que os tetos param o laço, e
 * que uma consulta que falha chega ao modelo como falha em vez de derrubar o
 * turno.
 *
 * O cliente é substituído por um roteiro: cada elemento é o que a API
 * responderia naquela rodada. É a única forma de exercitar o laço de forma
 * determinística e sem rede.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Registro, type Ferramenta } from "../ferramentas/registro";

const criar = vi.hoisted(() => vi.fn());

vi.mock("../llm", async (original) => {
  const real = await original<typeof import("../llm")>();
  return {
    ...real,
    disponivel: () => true,
    obterCliente: () => ({ beta: { messages: { create: criar } } }),
  };
});

const { investigar } = await import("../agente");

const texto = (t: string) => ({ type: "text" as const, text: t });
const usa = (id: string, name: string, input: unknown) => ({
  type: "tool_use" as const,
  id,
  name,
  input,
});
const resposta = (content: unknown[], stop: string, entrada = 100, saida = 20) => ({
  content,
  stop_reason: stop,
  usage: { input_tokens: entrada, output_tokens: saida },
});

function registroDeTeste(chamadasVistas: { nome: string; args: unknown }[]) {
  const alteracoes: Ferramenta = {
    nome: "alteracoes",
    descricao: "as alterações de uma vigência, em três níveis de detalhe",
    argumentos: {
      nivel: { tipo: "texto", descricao: "…", opcoes: ["total", "grupos"] as const, obrigatorio: true },
      equipamento: { tipo: "texto", descricao: "…", opcoes: ["CAVALO", "CARRETA"] as const },
    },
    executar: async (_ctx, args) => {
      chamadasVistas.push({ nome: "alteracoes", args });
      return {
        conteudo: { totais: { changes: 267 } },
        evidencias: [
          { ferramenta: "alteracoes", titulo: "t", fatos: [], numeros: [267], origem: "teste" },
        ],
      };
    },
  };
  return new Registro().registrar(alteracoes);
}

const ferramentas = { db: {} as never, recorte: {} };

beforeEach(() => criar.mockReset());
afterEach(() => vi.clearAllMocks());

describe("o laço", () => {
  it("consulta, recebe o resultado e volta ao modelo — duas rodadas", async () => {
    const vistas: { nome: string; args: unknown }[] = [];
    criar
      .mockResolvedValueOnce(
        resposta([texto("deixa eu ver"), usa("tu_1", "alteracoes", { nivel: "total" })], "tool_use"),
      )
      .mockResolvedValueOnce(resposta([texto("Mudaram 267 coisas.")], "end_turn"));

    const r = await investigar({
      pergunta: "o que mudou?",
      registro: registroDeTeste(vistas),
      ferramentas,
    });

    expect(r.rodadas).toBe(2);
    expect(r.parou).toBe("RESPONDEU");
    expect(r.texto).toBe("Mudaram 267 coisas.");
    expect(vistas).toEqual([{ nome: "alteracoes", args: { nivel: "total" } }]);
    // Os tokens somam as duas rodadas: é a soma que aparece na fatura.
    expect(r.medicao.tokensEntrada).toBe(200);
  });

  it("o tool_result volta casado com o tool_use_id, na mesma ordem", async () => {
    criar
      .mockResolvedValueOnce(
        resposta(
          [
            usa("tu_a", "alteracoes", { nivel: "total" }),
            usa("tu_b", "alteracoes", { nivel: "grupos" }),
          ],
          "tool_use",
        ),
      )
      .mockResolvedValueOnce(resposta([texto("pronto")], "end_turn"));

    await investigar({ pergunta: "x", registro: registroDeTeste([]), ferramentas });

    const segunda = criar.mock.calls[1]![0] as { messages: { role: string; content: unknown }[] };
    const ultima = segunda.messages.at(-1)!;
    const ids = (ultima.content as { tool_use_id: string }[]).map((c) => c.tool_use_id);

    expect(ultima.role).toBe("user");
    expect(ids).toEqual(["tu_a", "tu_b"]);
  });

  it("a narração antes de uma consulta é progresso, e não entra na resposta", async () => {
    const narradas: string[] = [];
    criar
      .mockResolvedValueOnce(
        resposta([texto("vou consultar as alterações"), usa("tu_1", "alteracoes", { nivel: "total" })], "tool_use"),
      )
      .mockResolvedValueOnce(resposta([texto("A resposta.")], "end_turn"));

    const r = await investigar({
      pergunta: "x",
      registro: registroDeTeste([]),
      ferramentas,
      aoNarrar: (t) => narradas.push(t),
    });

    expect(narradas).toEqual(["vou consultar as alterações"]);
    expect(r.texto).toBe("A resposta.");
    expect(r.texto).not.toContain("vou consultar");
  });

  it("uma consulta que falha chega ao modelo como falha, e o laço continua", async () => {
    const quebrada = new Registro().registrar({
      nome: "alteracoes",
      descricao: "falha sempre, para provar o que o modelo recebe quando uma consulta quebra",
      argumentos: {},
      executar: async () => {
        throw new Error("banco fora do ar");
      },
    });

    criar
      .mockResolvedValueOnce(resposta([usa("tu_1", "alteracoes", {})], "tool_use"))
      .mockResolvedValueOnce(resposta([texto("Não consegui consultar.")], "end_turn"));

    const r = await investigar({ pergunta: "x", registro: quebrada, ferramentas });

    const segunda = criar.mock.calls[1]![0] as { messages: { content: unknown }[] };
    const resultado = (segunda.messages.at(-1)!.content as { content: string; is_error?: boolean }[])[0]!;

    expect(resultado.is_error).toBe(true);
    expect(resultado.content).toContain("banco fora do ar");
    expect(r.parou).toBe("RESPONDEU");
    // E a chamada que falhou não autoriza número nenhum.
    expect(r.chamadas[0]!.evidencias).toEqual([]);
  });

  it("o teto de rodadas para o laço em vez de deixá-lo correr", async () => {
    criar.mockResolvedValue(resposta([usa("tu_n", "alteracoes", { nivel: "total" })], "tool_use"));

    const r = await investigar({
      pergunta: "x",
      registro: registroDeTeste([]),
      ferramentas,
    });

    expect(r.parou).toBe("TETO_DE_RODADAS");
    expect(r.texto).toBeNull();
    // O que já foi consultado continua no log — a investigação parou, não sumiu.
    expect(r.chamadas.length).toBe(r.rodadas);
  });

  it("uma recusa do classificador não vira erro de infraestrutura", async () => {
    criar.mockResolvedValueOnce(resposta([], "refusal"));

    const r = await investigar({ pergunta: "x", registro: registroDeTeste([]), ferramentas });

    expect(r.parou).toBe("RECUSA");
    expect(r.medicao.desfecho).toBe("RECUSA");
  });

  it("uma exceção da API não derruba o turno", async () => {
    criar.mockRejectedValueOnce(new Error("529 overloaded"));

    const r = await investigar({ pergunta: "x", registro: registroDeTeste([]), ferramentas });

    expect(r.parou).toBe("ERRO");
    expect(r.medicao.erro).toContain("529");
  });

  it("as ferramentas vão ao modelo com esquema, e sem recorte entre os campos", async () => {
    criar.mockResolvedValueOnce(resposta([texto("oi")], "end_turn"));

    await investigar({ pergunta: "x", registro: registroDeTeste([]), ferramentas });

    const params = criar.mock.calls[0]![0] as {
      tools: { name: string; input_schema: { properties: Record<string, unknown> } }[];
    };

    expect(params.tools.map((t) => t.name)).toEqual(["alteracoes"]);
    expect(Object.keys(params.tools[0]!.input_schema.properties)).toEqual(["nivel", "equipamento"]);
  });

  it("o recorte entregue às ferramentas é o do executor, sempre", async () => {
    const vistas: { nome: string; args: unknown }[] = [];
    criar
      .mockResolvedValueOnce(
        resposta(
          // O modelo tenta mandar um recorte junto. A validação recusa o campo
          // desconhecido, e a ferramenta nunca o vê.
          [usa("tu_1", "alteracoes", { nivel: "total", scopeHash: "outra-unidade" })],
          "tool_use",
        ),
      )
      .mockResolvedValueOnce(resposta([texto("ok")], "end_turn"));

    const r = await investigar({
      pergunta: "x",
      registro: registroDeTeste(vistas),
      ferramentas: { db: {} as never, recorte: { scopeHash: "a-desta-conversa" } },
    });

    expect(vistas).toEqual([]);
    expect(r.chamadas[0]!.ok).toBe(false);
    expect(r.chamadas[0]!.erro).toContain("scopeHash");
  });
});

describe("citações — o número que liga a frase à consulta", () => {
  it("cada resultado diz o seu número, e a contagem atravessa as rodadas", async () => {
    criar
      .mockResolvedValueOnce(
        resposta(
          [
            usa("tu_1", "alteracoes", { nivel: "total" }),
            usa("tu_2", "alteracoes", { nivel: "grupos" }),
          ],
          "tool_use",
        ),
      )
      .mockResolvedValueOnce(resposta([usa("tu_3", "alteracoes", { nivel: "total" })], "tool_use"))
      .mockResolvedValueOnce(resposta([texto("pronto [3]")], "end_turn"));

    await investigar({ pergunta: "x", registro: registroDeTeste([]), ferramentas });

    /*
      A leitura é sobre o array final, e não sobre `mock.calls[n]`.

      O laço empurra numa lista só e a passa por referência, então toda chamada
      registrada pelo mock aponta para o **mesmo** array — que continua sendo
      mutado depois. Ler `calls[1].messages.at(-1)` devolve a última mensagem do
      estado final, não a da segunda chamada, e o teste mediria outra coisa.
    */
    const mensagens = (criar.mock.calls[0]![0] as { messages: { role: string; content: unknown }[] })
      .messages;
    const resultados = mensagens
      .filter((m) => Array.isArray(m.content) && (m.content as { type?: string }[])[0]?.type === "tool_result")
      .flatMap((m) => m.content as { content: string }[]);

    expect(resultados).toHaveLength(3);
    expect(resultados[0]!.content).toContain("Fonte [1]");
    expect(resultados[1]!.content).toContain("Fonte [2]");
    /*
      O contador não reinicia por rodada. Se reiniciasse, duas consultas
      diferentes da mesma resposta seriam a fonte [1], e a citação apontaria
      para a vizinha sem nada quebrar.
    */
    expect(resultados[2]!.content).toContain("Fonte [3]");
  });

  it("uma consulta que falhou não recebe número — não sustenta afirmação", async () => {
    const registro = new Registro().registrar({
      nome: "alteracoes",
      descricao: "falha sempre, para provar que uma consulta quebrada não vira fonte citável",
      argumentos: {},
      executar: async () => {
        throw new Error("fora do ar");
      },
    });

    criar
      .mockResolvedValueOnce(resposta([usa("tu_1", "alteracoes", {})], "tool_use"))
      .mockResolvedValueOnce(resposta([texto("não consegui")], "end_turn"));

    await investigar({ pergunta: "x", registro, ferramentas });

    const mensagens = (criar.mock.calls[0]![0] as { messages: { role: string; content: unknown }[] })
      .messages;
    const resultado = (mensagens
      .filter((m) => Array.isArray(m.content) && (m.content as { type?: string }[])[0]?.type === "tool_result")
      .flatMap((m) => m.content as { content: string }[]))[0]!;

    expect(resultado.content).toContain("não devolveu nada citável");
    expect(resultado.content).not.toContain("Fonte [");
  });

  it("a numeração do resultado casa com a das fontes que a tela mostra", async () => {
    /*
      As duas contas moram em lugares diferentes — o laço numera o que manda ao
      modelo, `montarComAgente` numera o que a tela lista — e precisam concordar.
      Se divergirem, a citação [2] do texto aponta para a fonte [3] da tela, e
      nada em teste nenhum quebra.
    */
    criar
      .mockResolvedValueOnce(
        resposta(
          [usa("tu_1", "alteracoes", { nivel: "total" }), usa("tu_2", "alteracoes", { nivel: "grupos" })],
          "tool_use",
        ),
      )
      .mockResolvedValueOnce(resposta([texto("pronto [2]")], "end_turn"));

    const r = await investigar({ pergunta: "x", registro: registroDeTeste([]), ferramentas });
    const { evidenciasDaInvestigacao } = await import("../agente");

    const numeradas = evidenciasDaInvestigacao(r);
    const mensagens = (criar.mock.calls[0]![0] as { messages: { role: string; content: unknown }[] })
      .messages;
    const doModelo = mensagens
      .filter((m) => Array.isArray(m.content) && (m.content as { type?: string }[])[0]?.type === "tool_result")
      .flatMap((m) => (m.content as { content: string }[]).map((c) => c.content));

    expect(numeradas).toHaveLength(2);
    doModelo.forEach((conteudo, i) => expect(conteudo).toContain(`Fonte [${i + 1}]`));
  });
});
