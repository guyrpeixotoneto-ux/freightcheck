import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A leitura de grade por imagem é um rascunho de comparação, e é isso que
 * estes testes prendem.
 *
 * Ela não grava nada e não tem catálogo: a diferença dela para
 * `planilha-por-imagem.ts` é que linha e coluna vêm livres, como a imagem as
 * escreve — não há chave a validar contra um `enum`. O que resta garantir é
 * que ela nunca lança, e que uma célula sem os quatro campos (linha, coluna,
 * valor finito, texto) simplesmente não entra.
 */

const { criar } = vi.hoisted(() => ({ criar: vi.fn() }));

vi.mock("../llm", async (original) => {
  const real = await original<typeof import("../llm")>();
  return { ...real, obterCliente: () => ({ beta: { messages: { create: criar } } }) };
});

const { lerGradeDaImagem } = await import("../grade-por-imagem");

const IMAGEM = { mimeType: "image/png" as const, dados: "aGVsbG8=" };
const CONTEXTO = "Tela do Promax 01.22.02.00 — frota ativa, por categoria.";

function respostaCom(input: unknown, extra: Record<string, unknown> = {}) {
  return {
    stop_reason: "tool_use",
    usage: { input_tokens: 10, output_tokens: 5 },
    content: [{ type: "tool_use", name: "registrar_grade", id: "t1", input }],
    ...extra,
  };
}

beforeEach(() => {
  criar.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-de-mentira");
});

afterEach(() => vi.unstubAllEnvs());

describe("o que nem chega a virar chamada", () => {
  it("diz que não há leitura quando não há chave, em vez de tentar a rede", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");

    const r = await lerGradeDaImagem({ imagem: IMAGEM, contexto: CONTEXTO });

    expect(r.motivo).toBe("SEM_CHAVE");
    expect(r.celulas).toEqual([]);
    expect(criar).not.toHaveBeenCalled();
  });
});

describe("o que a chamada leva", () => {
  it("manda a imagem antes do texto, e obriga a ferramenta", async () => {
    criar.mockResolvedValue(respostaCom({ celulas: [] }));

    await lerGradeDaImagem({ imagem: IMAGEM, contexto: CONTEXTO });

    const params = criar.mock.calls[0]![0];
    const conteudo = params.messages[0].content;

    expect(conteudo[0].type).toBe("image");
    expect(conteudo[0].source.media_type).toBe("image/png");
    expect(conteudo[1].type).toBe("text");
    expect(conteudo[1].text).toContain(CONTEXTO);

    expect(params.tool_choice).toEqual({ type: "tool", name: "registrar_grade" });
  });

  it("não fecha linha nem coluna num enum — os dois são texto livre", async () => {
    criar.mockResolvedValue(respostaCom({ celulas: [] }));

    await lerGradeDaImagem({ imagem: IMAGEM, contexto: CONTEXTO });

    const esquema = criar.mock.calls[0]![0].tools[0].input_schema;
    const item = esquema.properties.celulas.items.properties;
    expect(item.linha.type).toBe("string");
    expect(item.linha.enum).toBeUndefined();
    expect(item.coluna.type).toBe("string");
    expect(item.coluna.enum).toBeUndefined();
  });
});

describe("o que volta, e o que é descartado no caminho", () => {
  it("entrega o número interpretado e guarda o texto que estava na célula", async () => {
    criar.mockResolvedValue(
      respostaCom({
        celulas: [
          { linha: "Total Veículos", coluna: "Padrão", valor: 23, comoEstaNaImagem: "23" },
        ],
      }),
    );

    const r = await lerGradeDaImagem({ imagem: IMAGEM, contexto: CONTEXTO });

    expect(r.motivo).toBe("IA");
    expect(r.celulas).toEqual([
      { linha: "Total Veículos", coluna: "Padrão", valor: 23, comoEstaNaImagem: "23" },
    ]);
  });

  it("descarta célula sem linha ou sem coluna", async () => {
    criar.mockResolvedValue(
      respostaCom({
        celulas: [
          { linha: "", coluna: "Padrão", valor: 1, comoEstaNaImagem: "1" },
          { linha: "Custo Fixo", coluna: "  ", valor: 2, comoEstaNaImagem: "2" },
          { linha: "Custo Fixo", coluna: "Fixo", valor: 3, comoEstaNaImagem: "3" },
        ],
      }),
    );

    const r = await lerGradeDaImagem({ imagem: IMAGEM, contexto: CONTEXTO });

    expect(r.celulas).toHaveLength(1);
    expect(r.celulas[0]).toEqual({
      linha: "Custo Fixo",
      coluna: "Fixo",
      valor: 3,
      comoEstaNaImagem: "3",
    });
  });

  it("descarta o que não é número finito, em vez de mandar NaN para a tela", async () => {
    criar.mockResolvedValue(
      respostaCom({
        celulas: [
          { linha: "Custo Fixo", coluna: "Padrão", valor: "494,22", comoEstaNaImagem: "494,22" },
          { linha: "Custo Fixo", coluna: "MKT", valor: Number.POSITIVE_INFINITY, comoEstaNaImagem: "∞" },
          { linha: "Custo Fixo", coluna: "Fixo", valor: 6258.41, comoEstaNaImagem: "6.258,41" },
        ],
      }),
    );

    const r = await lerGradeDaImagem({ imagem: IMAGEM, contexto: CONTEXTO });

    expect(r.celulas.map((c) => c.coluna)).toEqual(["Fixo"]);
  });
});

describe("os desfechos que não são leitura", () => {
  it("trata a recusa como recusa, sem ler o conteúdo vazio", async () => {
    criar.mockResolvedValue({
      stop_reason: "refusal",
      usage: { input_tokens: 10, output_tokens: 0 },
      content: [],
    });

    const r = await lerGradeDaImagem({ imagem: IMAGEM, contexto: CONTEXTO });

    expect(r.motivo).toBe("RECUSA");
    expect(r.celulas).toEqual([]);
  });

  it("diz que o teto cortou, quando foi o teto que cortou", async () => {
    criar.mockResolvedValue({
      stop_reason: "max_tokens",
      usage: { input_tokens: 10, output_tokens: 12000 },
      content: [{ type: "text", text: "{\"celulas\": [" }],
    });

    const r = await lerGradeDaImagem({ imagem: IMAGEM, contexto: CONTEXTO });

    expect(r.motivo).toBe("ERRO");
    expect(r.erro).toContain("teto");
  });

  it("não lança quando a rede cai — devolve o motivo e deixa a etapa de pé", async () => {
    criar.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const r = await lerGradeDaImagem({ imagem: IMAGEM, contexto: CONTEXTO });

    expect(r.motivo).toBe("ERRO");
    expect(r.erro).toContain("ECONNREFUSED");
    expect(r.celulas).toEqual([]);
  });
});
