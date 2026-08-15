/**
 * O corpo que uma rota responde quando esbarra num schema que o banco não tem.
 *
 * O que se fixa aqui é a divisão de trabalho que eliminou a contradição: a rota
 * contribui **contexto** — qual schema falta, e que o arquivo não se perdeu — e
 * nunca recomendação; a recomendação vem inteira de `diagnosticar`. Enquanto
 * cada rota escrevia a sua, a de Chamados mandava reiniciar o servidor num
 * banco onde reiniciar era exatamente o que não funcionava.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { EstadoObservado } from "@workspace/db/diagnostico";

const observarBanco = vi.hoisted(() => vi.fn<() => Promise<EstadoObservado>>());

vi.mock("../migrations", async (original) => ({
  ...(await original<typeof import("../migrations")>()),
  observarBanco,
}));

const { faltaSchema, responderSchemaAusente } = await import(
  "../schema-ausente"
);

/** Um `res` do Express reduzido ao que esta função usa. */
function resFalso() {
  const gravado: { status?: number; corpo?: unknown } = {};
  const res = {
    status(codigo: number) {
      gravado.status = codigo;
      return res;
    },
    json(corpo: unknown) {
      gravado.corpo = corpo;
      return res;
    },
  };
  return { res, gravado };
}

const CONTEXTO =
  "Este banco ainda não tem onde guardar chamados: falta pelo menos uma das " +
  "migrations que criam esse schema. Não é o seu arquivo — nada chegou a ser " +
  "gravado, e nada se perdeu.";

beforeEach(() => observarBanco.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("faltaSchema", () => {
  it("reconhece tabela, coluna e tipo inexistentes", () => {
    expect(faltaSchema({ code: "42P01" })).toBe(true);
    expect(faltaSchema({ code: "42703" })).toBe(true);
    expect(faltaSchema({ code: "42704" })).toBe(true);
  });

  it("não confunde violação de unicidade nem erro comum com schema ausente", () => {
    expect(faltaSchema({ code: "23505" })).toBe(false);
    expect(faltaSchema(new Error("boom"))).toBe(false);
    expect(faltaSchema(null)).toBe(false);
  });
});

describe("responderSchemaAusente", () => {
  /**
   * **A regressão do caso vivido**, do lado do servidor.
   *
   * Registro vazio, schema inteiro, `42710` na `0000`. O corpo inteiro — texto
   * corrido, contexto e diagnóstico — só pode oferecer a adoção.
   */
  it("registro perdido: o corpo inteiro manda adotar, e nunca rodar migrate", async () => {
    observarBanco.mockResolvedValue({
      configurada: true,
      alcancavel: true,
      aplicadas: 0,
      pendentes: ["0000_freightcheck_foundation", "0013_chamados_por_parametro"],
      falha: { tag: "0000_freightcheck_foundation", code: "42710" },
    });

    const { res, gravado } = resFalso();
    await responderSchemaAusente(res as never, CONTEXTO);

    // 503 e não 500: indisponibilidade deste ambiente, não erro do pedido.
    expect(gravado.status).toBe(503);

    const corpo = gravado.corpo as Record<string, unknown>;
    expect(corpo["code"]).toBe("SCHEMA_AUSENTE");
    expect(corpo["contexto"]).toBe(CONTEXTO);
    expect((corpo["diagnostico"] as { estado: string }).estado).toBe(
      "REGISTRO_PERDIDO",
    );

    const inteiro = JSON.stringify(corpo);
    expect(inteiro).toMatch(/migrate:adotar/);
    expect(inteiro).not.toMatch(/run migrate`/);
    expect(inteiro).not.toMatch(/suba o servidor/i);
  });

  it("o contexto da rota não recomenda nada — quem recomenda é o diagnóstico", async () => {
    observarBanco.mockResolvedValue({
      configurada: true,
      alcancavel: true,
      aplicadas: 12,
      pendentes: ["0013_chamados_por_parametro"],
    });

    const { res, gravado } = resFalso();
    await responderSchemaAusente(res as never, CONTEXTO);

    const corpo = gravado.corpo as Record<string, unknown>;
    const contexto = corpo["contexto"] as string;

    // Nenhum comando, nenhuma instrução de operação no que a rota escreveu.
    expect(contexto).not.toMatch(/pnpm|migrate|reinici|suba o servidor/i);
    // E, ainda assim, a resposta corrida se basta para quem lê por `curl`.
    expect(corpo["error"]).toContain(contexto);
    expect(corpo["error"]).toMatch(/run migrate/);
    expect((corpo["diagnostico"] as { estado: string }).estado).toBe(
      "MIGRATIONS_PENDENTES",
    );
  });

  /**
   * O par contraditório que o teste ponta a ponta pegou: registro completo,
   * tabela renomeada por fora. A rota dizia "não tem onde guardar" e o
   * diagnóstico dizia "nenhuma ação é necessária", no mesmo corpo.
   */
  it("registro completo e objeto faltando nunca vira 'nenhuma ação é necessária'", async () => {
    observarBanco.mockResolvedValue({
      configurada: true,
      alcancavel: true,
      aplicadas: 18,
      pendentes: [],
    });

    const { res, gravado } = resFalso();
    await responderSchemaAusente(res as never, CONTEXTO);

    const corpo = gravado.corpo as Record<string, unknown>;
    const diagnostico = corpo["diagnostico"] as {
      estado: string;
      acao: { codigo: string } | null;
    };

    expect(diagnostico.estado).toBe("SCHEMA_DIVERGENTE");
    expect(diagnostico.acao?.codigo).toBe("CONFERIR_SCHEMA");
    expect(corpo["error"]).not.toMatch(/Nenhuma ação é necessária/);
  });

  it("com o banco fora, a rota não inventa que faltam migrations", async () => {
    observarBanco.mockResolvedValue({
      configurada: true,
      alcancavel: false,
      codigoDeConexao: "ECONNREFUSED",
      aplicadas: 0,
      pendentes: [],
    });

    const { res, gravado } = resFalso();
    await responderSchemaAusente(res as never, CONTEXTO);

    const corpo = gravado.corpo as Record<string, unknown>;
    const diagnostico = corpo["diagnostico"] as {
      estado: string;
      acao: { quem: string };
    };
    expect(diagnostico.estado).toBe("INDISPONIVEL");
    expect(diagnostico.acao.quem).toBe("plataforma");
  });
});
