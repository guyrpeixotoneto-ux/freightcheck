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

const { faltaSchema, regraDeMigrationPendente, responderSchemaAusente } =
  await import("../schema-ausente");

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

  /**
   * A função que a migration cria, e a coluna gerada que depende dela.
   *
   * `freightcheck_snapshot_key` sustenta `snapshot.canonical_snapshot_key`, e
   * os gatilhos de imutabilidade também são funções. Num banco parado antes da
   * migration que as cria, a tabela existe e a chamada morre — o mesmo desfecho
   * de uma tabela ausente, uma camada abaixo.
   */
  it("reconhece função inexistente", () => {
    expect(faltaSchema({ code: "42883" })).toBe(true);
  });

  /**
   * **42P10 não decide sozinho.**
   *
   * O Postgres 16 o levanta por quatro caminhos, e só um é schema. Os valores de
   * `routine` abaixo foram medidos contra um Postgres de verdade, não deduzidos:
   * é o nome da função em C que levantou o erro, e ele vem no protocolo sem
   * tradução. Sem essa separação, um `ORDER BY 5` mal escrito mandaria alguém
   * rodar migrations.
   */
  it("o ON CONFLICT sem índice é schema — pela rotina, não pelo SQLSTATE", () => {
    expect(
      faltaSchema({ code: "42P10", routine: "infer_arbiter_indexes" }),
    ).toBe(true);
  });

  it("os outros três 42P10 são defeito de código, e não viram schema ausente", () => {
    // ORDER BY / GROUP BY por posição fora da lista de seleção.
    expect(
      faltaSchema({ code: "42P10", routine: "findTargetlistEntrySQL92" }),
    ).toBe(false);
    // DISTINCT ON divergindo do ORDER BY.
    expect(
      faltaSchema({ code: "42P10", routine: "transformDistinctOnClause" }),
    ).toBe(false);
    // E o 42P10 sem rotina nenhuma: na dúvida, não é migration faltando.
    expect(faltaSchema({ code: "42P10" })).toBe(false);
  });

  it("acha o erro do pg dentro do que o drizzle embrulhou, com os campos", () => {
    // É assim que ele chega: o wrapper por fora, com a consulta e os
    // parâmetros, e o erro do `pg` — o que tem o SQLSTATE e a rotina — em
    // `cause`. Olhar só a superfície não acharia nem um nem outra.
    const embrulhado = Object.assign(
      new Error('Failed query: INSERT INTO "snapshot_entity_type" …'),
      {
        cause: Object.assign(
          new Error(
            "there is no unique or exclusion constraint matching the ON CONFLICT specification",
          ),
          { code: "42P10", routine: "infer_arbiter_indexes" },
        ),
      },
    );

    expect(faltaSchema(embrulhado)).toBe(true);
  });

  it("não confunde violação de unicidade nem erro comum com schema ausente", () => {
    expect(faltaSchema({ code: "23505" })).toBe(false);
    expect(faltaSchema({ code: "23503" })).toBe(false);
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
      pendentes: [
        "0000_freightcheck_foundation",
        "0013_chamados_por_parametro",
      ],
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

// ---------------------------------------------------------------------------
// A regra fechada que este banco aplica e é de antes deste build
// ---------------------------------------------------------------------------

/**
 * **O caso vivido de 22/08/2026.** A tela do fechamento passou a oferecer as
 * duas casinhas do 03.08.18 — a `0055` separou `DISPONIBILIDADE_FF` de
 * `DISPONIBILIDADE_VAN` —, o envio chegou ao servidor e o `check` de
 * `fechamento_documento.tipo` o recusou: naquele banco a `0055` ainda não
 * tinha rodado, e a lista fechada era a de antes. O que a tela mostrou foi "O
 * servidor falhou ao processar este pedido", que manda procurar defeito num
 * arquivo perfeito.
 *
 * O que se trava aqui é a evidência que separa esse caso do outro `23514` — o
 * valor que a regra do domínio recusa de verdade, e que continua sendo 500. O
 * critério não é o SQLSTATE: é a fila. Se uma migration **pendente neste
 * banco** reescreve a constraint que recusou, a regra aplicada aqui é
 * comprovadamente uma versão anterior da que este build escreve.
 */
describe("regraDeMigrationPendente", () => {
  /** A recusa como o `pg` a entrega: SQLSTATE e a constraint, sem texto. */
  const recusaDoCheck = (constraint: string) =>
    Object.assign(new Error("new row violates check constraint"), {
      code: "23514",
      constraint,
      table: "fechamento_documento",
    });

  const bancoAtrasado = () =>
    observarBanco.mockResolvedValue({
      configurada: true,
      alcancavel: true,
      aplicadas: 55,
      pendentes: ["0055_disponibilidade_por_frota"],
    });

  it("a constraint que a migration pendente reescreve é schema, não pedido", async () => {
    bancoAtrasado();

    const observado = await regraDeMigrationPendente(
      recusaDoCheck("fechamento_documento_tipo"),
    );

    /* Devolve o estado observado — e não `true` — para que quem responde use
       a mesma observação, e não uma segunda leitura do banco. */
    expect(observado?.pendentes).toEqual(["0055_disponibilidade_por_frota"]);
  });

  it("atravessa o embrulho do drizzle, como toda classificação daqui", async () => {
    bancoAtrasado();

    const embrulhado = Object.assign(
      new Error('Failed query: insert into "fechamento_documento" … params: …'),
      { cause: recusaDoCheck("fechamento_documento_tipo") },
    );

    expect(await regraDeMigrationPendente(embrulhado)).not.toBeNull();
  });

  it("uma constraint que a fila pendente não toca continua sendo 500", async () => {
    /*
      É o outro `23514`, e é o comum: um valor que a regra do domínio recusa.
      Classificá-lo como banco atrasado mandaria rodar migrations por causa de
      um dado errado — o espelho do erro que este módulo existe para não
      cometer.
    */
    bancoAtrasado();

    expect(
      await regraDeMigrationPendente(recusaDoCheck("ticket_status_ck")),
    ).toBeNull();
  });

  it("sem migration pendente, nenhum check_violation vira falta de schema", async () => {
    observarBanco.mockResolvedValue({
      configurada: true,
      alcancavel: true,
      aplicadas: 56,
      pendentes: [],
    });

    expect(
      await regraDeMigrationPendente(recusaDoCheck("fechamento_documento_tipo")),
    ).toBeNull();
  });

  it("sem o nome da constraint não há o que perguntar à fila", async () => {
    /* Adivinhá-lo pelo texto da mensagem seria classificar por frase, que é o
       que este arquivo inteiro recusa. */
    bancoAtrasado();

    expect(await regraDeMigrationPendente({ code: "23514" })).toBeNull();
  });

  it("não pergunta ao banco pelo que não é check_violation", async () => {
    /* A observação custa consultas, e o erro que não é 23514 nunca chega a
       precisar dela — nem o 23505, que é o vizinho mais próximo. */
    bancoAtrasado();

    expect(await regraDeMigrationPendente({ code: "23505" })).toBeNull();
    expect(await regraDeMigrationPendente(new Error("boom"))).toBeNull();
    expect(await regraDeMigrationPendente(null)).toBeNull();
    expect(observarBanco).not.toHaveBeenCalled();
  });

  it("a observação já feita é a que vira diagnóstico — o banco não é lido duas vezes", async () => {
    bancoAtrasado();

    const observado = await regraDeMigrationPendente(
      recusaDoCheck("fechamento_documento_tipo"),
    );
    const { res, gravado } = resFalso();
    await responderSchemaAusente(res as never, CONTEXTO, observado!);

    expect(observarBanco).toHaveBeenCalledTimes(1);
    expect(gravado.status).toBe(503);
    const corpo = gravado.corpo as Record<string, unknown>;
    expect((corpo["diagnostico"] as { estado: string }).estado).toBe(
      "MIGRATIONS_PENDENTES",
    );
    /* E a ação é a única que resolve: rodar a fila. */
    expect(
      (corpo["diagnostico"] as { acao: { codigo: string } }).acao.codigo,
    ).toBe("APLICAR_MIGRATIONS");
  });
});
