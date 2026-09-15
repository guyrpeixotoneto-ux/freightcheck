/**
 * O SQL que chegou à tela.
 *
 * Aprovar uma planilha devolveu, em vermelho e no meio da tela de Importações,
 * `Failed query: INSERT INTO "snapshot_entity_type" ( snapshot_id, entity_type,
 * … ) SELECT $1::uuid, … params: 1f10e1af-…`. A planilha tinha 41.391 fatos e
 * zero erros; o que faltava era a migration `0021_cobertura` naquele banco.
 *
 * Duas coisas produziram aquela tela. O drizzle não deixa o erro do `pg` subir
 * cru — ele o embrulha num `DrizzleQueryError` cuja `message` é a consulta
 * inteira com os parâmetros, e põe o erro de verdade em `cause`. E a rota
 * respondia `err.message` direto, com status 422, que nesta API significa "o
 * dado não fecha: corrija a origem e reenvie". A resposta mandava mexer numa
 * planilha que estava certa.
 *
 * Estes testes usam o `DrizzleQueryError` **de verdade**, e não uma imitação:
 * o que se quer provar é que aquela mensagem, exatamente daquela forma, não
 * atravessa mais. Por isso também a última varredura, que não olha o desfecho
 * de nenhum caso em particular — só passeia por todas as saídas do fluxo e
 * exige que nenhuma carregue consulta, parâmetro ou stack.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";
import { DrizzleQueryError } from "drizzle-orm/errors";
import type { EstadoObservado } from "@workspace/db/diagnostico";

const observarBanco = vi.hoisted(() => vi.fn<() => Promise<EstadoObservado>>());
const promote = vi.hoisted(() => vi.fn());
const getImportRunStatus = vi.hoisted(() => vi.fn());
const listImportRuns = vi.hoisted(() => vi.fn());
const deleteImportRun = vi.hoisted(() => vi.fn());
/*
  A promoção deixou de acontecer dentro da requisição — ver o comentário da rota
  e `reservarPromocao`, em `pipeline.ts`. Estas duas são as pontas novas desse
  desenho: a reserva, que é a última coisa síncrona da rota, e a volta ao
  preview, que é onde uma falha inesperada passa a ser gravada agora que não há
  mais resposta HTTP para carregá-la.
*/
const reservarPromocao = vi.hoisted(() => vi.fn());
const devolverAoPreview = vi.hoisted(() => vi.fn());
const pedirCancelamento = vi.hoisted(() => vi.fn());

vi.mock("../../lib/migrations", async (original) => ({
  ...(await original<typeof import("../../lib/migrations")>()),
  observarBanco,
}));

vi.mock("@workspace/ingest", async (original) => ({
  ...(await original<typeof import("@workspace/ingest")>()),
  promote,
  getImportRunStatus,
  listImportRuns,
  deleteImportRun,
  reservarPromocao,
  devolverAoPreview,
  pedirCancelamento,
}));

const { default: router } = await import("../imports");
const { CODIGO_ERRO_INTERNO } = await import(
  "../../middlewares/contrato-json"
);

const { classificarFalhaDeImportacao, ehFraseParaQuemOpera, motivoGravavel } =
  await import("../imports");
const { PromocaoRecusada } = await import("@workspace/ingest");

const RUN = "1f10e1af-ac9b-4beb-86f4-17f941419318";

/**
 * A consulta que apareceu na tela, montada pela classe que a montou.
 *
 * `DrizzleQueryError` compõe `message` a partir da consulta e dos parâmetros —
 * é dela que sai o `Failed query: … params: …`. Passar o erro do `pg` como
 * `cause` é o que o driver faz de verdade, e é onde moram o SQLSTATE e a
 * `routine` — o nome da função em C que levantou o erro, que é o que separa os
 * quatro caminhos do `42P10`.
 */
function erroDoDrizzle(
  code: string,
  texto: string,
  extra: Record<string, string> = {},
): DrizzleQueryError {
  return new DrizzleQueryError(
    'INSERT INTO "snapshot_entity_type" ( snapshot_id, entity_type, ' +
      "entity_count ) SELECT $1::uuid, e.entity_type, count(*)::int FROM " +
      '"fact" f JOIN "entity" e ON e.id = f.entity_id WHERE f.snapshot_id = ' +
      "$2::uuid GROUP BY e.entity_type ON CONFLICT (snapshot_id, entity_type) " +
      "DO NOTHING",
    [RUN, RUN],
    Object.assign(new Error(texto), { code, ...extra }),
  );
}

/** O `42P10` que é banco atrasado: o Postgres não achou o índice do arbitro. */
const SEM_INDICE = { routine: "infer_arbiter_indexes" };

/** Tudo o que nunca pode sair desta API para o browser. */
const PROIBIDO: [RegExp, string][] = [
  [/failed query:/i, "o carimbo do drizzle"],
  [/\bparams:/i, "os parâmetros da consulta"],
  [/insert\s+into/i, "SQL de escrita"],
  [/update\s+"?\w+"?\s+set/i, "SQL de escrita"],
  [/delete\s+from/i, "SQL de escrita"],
  [/select\b[\s\S]*\bfrom\b/i, "SQL de leitura"],
  [/on\s+conflict/i, "a especificação de conflito"],
  [/\$\d+::uuid/, "um parâmetro posicional"],
  [/\n\s+at\s+\S/, "um stack trace"],
];

function exigirRespostaLimpa(corpo: unknown): void {
  const inteiro = JSON.stringify(corpo);
  for (const [marca, oQueE] of PROIBIDO) {
    expect(
      marca.test(inteiro),
      `a resposta traz ${oQueE}: ${inteiro.slice(0, 400)}`,
    ).toBe(false);
  }
}

let servidor: Server;
let base: string;

/*
  O log deixou de ser só ruído a engolir.

  Com a promoção fora da requisição, ele é a única testemunha síncrona de que o
  trabalho de fundo terminou — e o que estes casos precisam é esperar esse fim
  antes de olhar o que ficou gravado. O conteúdo do log continua sendo conferido
  à parte; aqui ele só marca o tempo.
*/
const registro = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // O `req.log` que o pino-http instala em produção. Aqui basta engolir: o
  // conteúdo do log é conferido à parte, e o que estes casos olham é a resposta.
  app.use((req, _res, next) => {
    Object.assign(req, { log: registro });
    next();
  });
  app.use(router);
  /*
    O contrato JSON, montado como no `app.ts`. Não é cerimônia de teste: desde
    que a tradução das recusas e o diagnóstico de schema saíram dos `catch` das
    rotas, é ele quem responde 404, 400, 422, 503 e 500 — e um app de teste sem
    ele mede o `finalhandler` do Express, que devolve HTML.
  */
  app.use(erroEmJson);
  await new Promise<void>((resolve) => {
    servidor = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(
  () =>
    new Promise<void>((resolve) => {
      servidor.close(() => resolve());
    }),
);

beforeEach(() => {
  vi.clearAllMocks();
  // O caminho normal: a reserva é ganha, e o que vier depois é o que cada caso
  // monta. `false` aqui significaria outra coisa — dois cliques disputando —, e
  // não é o que estes casos medem.
  reservarPromocao.mockResolvedValue(true);
  devolverAoPreview.mockResolvedValue(undefined);
  // O estado normal de um banco atrasado: alcançável, com migrations na fila.
  observarBanco.mockResolvedValue({
    configurada: true,
    alcancavel: true,
    aplicadas: 20,
    pendentes: ["0021_cobertura"],
  });
  getImportRunStatus.mockResolvedValue({ status: "PREVIEWED" });
});

afterEach(() => vi.restoreAllMocks());

interface Resposta {
  status: number;
  body: unknown;
}

async function aprovar(): Promise<Resposta> {
  const res = await fetch(`${base}/imports/${RUN}/promote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmNewEntityTypes: ["CARRETA"] }),
  });
  return { status: res.status, body: await res.json() };
}

/**
 * Aprovar e esperar o desfecho — que já não vem na resposta.
 *
 * A rota responde 202 assim que a reserva é ganha: ela promete que a aprovação
 * **começou**. O que a falha produz, portanto, não é mais um corpo HTTP — é o
 * que fica gravado no run para o cartão ler, e é isso que estes casos passaram
 * a afirmar. O 202 continua sendo conferido em cada um: uma falha que virasse
 * 4xx aqui significaria que a rota voltou a esperar o trabalho.
 */
async function aprovarEColherMotivo(): Promise<string> {
  const { status } = await aprovar();
  expect(status).toBe(202);
  await vi.waitFor(() => expect(devolverAoPreview).toHaveBeenCalled());
  return devolverAoPreview.mock.calls[0]?.[2] as string;
}

/** O mesmo, para as recusas: elas se gravam sozinhas, dentro do pipeline. */
async function aprovarEEsperarRecusa(): Promise<void> {
  const { status } = await aprovar();
  expect(status).toBe(202);
  await vi.waitFor(() => expect(registro.warn).toHaveBeenCalled());
}

// ---------------------------------------------------------------------------
// A — o caso vivido
// ---------------------------------------------------------------------------

describe("a aprovação que esbarra num schema atrasado", () => {
  /*
    O caso vivido, relido depois de a promoção sair da requisição.

    O que mudou não foi a classificação — ela continua a mesma função, e os
    testes puros lá embaixo continuam prendendo cada SQLSTATE. O que mudou foi
    **onde a classificação é entregue**: não há mais uma resposta HTTP para
    carregar o 503 e o diagnóstico, porque a resposta já saiu (202) enquanto o
    trabalho começava. O motivo classificado passa a ser gravado no run, que é
    onde o cartão da importação o lê — e é ali, agora, que nenhuma consulta pode
    aparecer. O diagnóstico completo continua inteiro no log do servidor.
  */
  it("grava o motivo de schema no run, e não a consulta", async () => {
    promote.mockRejectedValue(
      erroDoDrizzle("42P01", 'relation "snapshot_entity_type" does not exist'),
    );

    const motivo = await aprovarEColherMotivo();

    // A frase de schema, e nada do drizzle: nem consulta, nem parâmetro.
    expect(motivo).toMatch(/banco de dados|migration|ambiente/i);
    exigirRespostaLimpa(motivo);
  });

  it("não manda corrigir nem reenviar a planilha", async () => {
    promote.mockRejectedValue(
      erroDoDrizzle("42P01", 'relation "snapshot_entity_type" does not exist'),
    );

    const motivo = await aprovarEColherMotivo();

    // O arquivo está certo, e o motivo não pode sugerir o contrário: mandar
    // reenviar era o efeito do 422 que a classificação substituiu.
    expect(motivo).not.toMatch(/corrija a origem|envie o arquivo de novo/i);
  });

  it("o 42P01 chega até com o erro do pg embrulhado em vários níveis", async () => {
    // `cause` é campo livre, e nada obriga o driver a ser o primeiro nível.
    // Um wrapper de retentativa por cima do drizzle já bastaria para esconder
    // o SQLSTATE de quem só olhasse a superfície.
    const doDrizzle = erroDoDrizzle(
      "42703",
      'column "inherited_fact_count" does not exist',
    );
    const doRepositorio = Object.assign(
      new Error("falha ao gravar o agregado"),
      {
        cause: doDrizzle,
      },
    );
    const doServico = Object.assign(new Error("promoção interrompida"), {
      cause: doRepositorio,
    });
    promote.mockRejectedValue(doServico);

    const motivo = await aprovarEColherMotivo();

    expect(motivo).toMatch(/banco de dados|migration|ambiente/i);
    exigirRespostaLimpa(motivo);
  });

  it("o run volta a poder ser aprovado — a falha não consumiu a decisão", async () => {
    promote.mockRejectedValue(erroDoDrizzle("42P01", "no table"));

    await aprovarEColherMotivo();

    // PREVIEWED, e não um estado terminal: o banco é que estava atrasado, e a
    // planilha continua conferida e aprovável assim que ele deixar de estar.
    expect(devolverAoPreview).toHaveBeenCalledWith(
      expect.anything(),
      RUN,
      expect.any(String),
    );
  });
});

// ---------------------------------------------------------------------------
// C — o ON CONFLICT sem índice
// ---------------------------------------------------------------------------

describe("42P10 — o ON CONFLICT sem índice que o case", () => {
  /**
   * O segundo desfecho do mesmo banco atrasado, e o mais fácil de classificar
   * errado: a tabela existe, só o índice único não. `snapshot_entity_type_uq`
   * nasce na mesma migration da tabela, e sem ele o `ON CONFLICT (snapshot_id,
   * entity_type)` do pipeline não tem em que se apoiar.
   */
  it("é schema atrasado — o motivo gravado diz isso, e não manda mexer na planilha", async () => {
    promote.mockRejectedValue(
      erroDoDrizzle(
        "42P10",
        "there is no unique or exclusion constraint matching the ON CONFLICT specification",
        SEM_INDICE,
      ),
    );

    const motivo = await aprovarEColherMotivo();

    expect(motivo).toMatch(/banco de dados|migration|ambiente/i);
    expect(motivo).not.toMatch(/corrija a origem/i);
    exigirRespostaLimpa(motivo);
  });

  /**
   * O mesmo SQLSTATE por outro caminho: um `ORDER BY 5` fora da lista de
   * seleção. Isso é defeito nosso, e mandar rodar migrations por causa dele
   * seria mascarar um bug — que é o oposto do que este arquivo existe para
   * fazer. A separação é pela `routine`, que o Postgres manda sem traduzir.
   */
  it("um 42P10 de consulta mal escrita não vira diagnóstico de schema", async () => {
    promote.mockRejectedValue(
      erroDoDrizzle("42P10", "ORDER BY position 5 is not in select list", {
        routine: "findTargetlistEntrySQL92",
      }),
    );

    const motivo = await aprovarEColherMotivo();

    expect(motivo).not.toMatch(/migration/i);
    exigirRespostaLimpa(motivo);
  });

  it("42883 — a função que a migration cria — é o mesmo desfecho", async () => {
    promote.mockRejectedValue(
      erroDoDrizzle(
        "42883",
        "function freightcheck_snapshot_key(text, text, text, date, jsonb) does not exist",
      ),
    );

    const motivo = await aprovarEColherMotivo();
    expect(motivo).toMatch(/banco de dados|migration|ambiente/i);
  });
});

// ---------------------------------------------------------------------------
// D — a recusa que continua sendo recusa
// ---------------------------------------------------------------------------

describe("as recusas escritas para quem opera continuam inteiras", () => {
  /*
    Uma recusa nomeada grava a si mesma — e é por isso que ela não precisava de
    resposta HTTP para sobreviver.

    `PromocaoRecusada` carrega o estado em que o run deve ficar (PREVIEWED
    quando ainda dá para decidir, VALIDATION_ERROR quando o dado não fecha) e o
    próprio `promote` o escreve depois do ROLLBACK, junto com a frase. A rota
    nunca foi quem guardava isso; ela só repetia. Aqui se prende que ela não
    atrapalha: a aprovação em segundo plano deixa a recusa como está, sem
    devolver o run ao preview por cima do que o pipeline decidiu.
  */
  it("uma recusa nomeada não é reescrita pela rota", async () => {
    const frase =
      "Esta vigência não fecha: o total de EMPURRADA_2_1_2026 diverge do " +
      "somatório dos componentes. Corrija a origem e envie o arquivo de novo.";
    promote.mockRejectedValue(
      new PromocaoRecusada(frase, "DADO_NAO_FECHA", "VALIDATION_ERROR", {
        label: "EMPURRADA_2_1_2026",
      }),
    );

    await aprovarEEsperarRecusa();

    expect(devolverAoPreview).not.toHaveBeenCalled();
    expect(registro.warn).toHaveBeenCalledWith(
      expect.objectContaining({ decisao: "DADO_NAO_FECHA" }),
      expect.stringMatching(/refused/i),
    );
  });

  it("já existe uma versão ativa deixa o run aprovável, sem passar pela rota", async () => {
    promote.mockRejectedValue(
      new PromocaoRecusada(
        "Já existe uma versão ativa desta vigência. Registre uma correção para substituí-la.",
        "VIGENCIA_ATIVA_EXISTENTE",
        "PREVIEWED",
        { revisionAtiva: 1 },
      ),
    );

    await aprovarEEsperarRecusa();

    // O pipeline devolve o run a PREVIEWED por conta própria, com a frase. Se a
    // rota também o fizesse, sobrescreveria o motivo por outro.
    expect(devolverAoPreview).not.toHaveBeenCalled();
    expect(registro.warn).toHaveBeenCalledWith(
      expect.objectContaining({ decisao: "VIGENCIA_ATIVA_EXISTENTE" }),
      expect.anything(),
    );
  });

  it("a recusa de equipamento novo — um Error simples — sobrevive inteira no motivo", async () => {
    // O pipeline a levanta com `new Error(...)`, não com `PromocaoRecusada`.
    // Trocá-la por uma frase genérica seria perder a única mensagem que
    // explica o que houve com a aba CARRETA.
    const frase =
      "Esta importação criaria um equipamento que o dicionário não conhece: " +
      "CARRETA. Se for equipamento novo mesmo, confirme CARRETA na pré-visualização.";
    promote.mockRejectedValue(new Error(frase));

    expect(await aprovarEColherMotivo()).toBe(frase);
  });

  it("o estado errado é recusado antes de chegar ao pipeline", async () => {
    getImportRunStatus.mockResolvedValue({ status: "PROMOTED" });

    const { status, body } = await aprovar();
    expect(status).toBe(409);
    expect((body as Record<string, unknown>)["error"]).toMatch(
      /já foi aprovada/i,
    );
    expect(promote).not.toHaveBeenCalled();
    // E nem a reserva chega a ser tentada: a porta fecha antes.
    expect(reservarPromocao).not.toHaveBeenCalled();
  });

  it("perder a reserva é 409, e não uma segunda promoção do mesmo run", async () => {
    // Duas abas clicando juntas: entre a leitura do estado e a reserva cabe uma
    // corrida, e é a reserva — um UPDATE condicional — que a decide.
    reservarPromocao.mockResolvedValue(false);
    getImportRunStatus
      .mockResolvedValueOnce({ status: "PREVIEWED" })
      .mockResolvedValueOnce({ status: "PROMOTING" });

    const { status, body } = await aprovar();

    expect(status).toBe(409);
    expect((body as Record<string, unknown>)["error"]).toMatch(
      /sendo aprovada/i,
    );
    expect(promote).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// E — o inesperado
// ---------------------------------------------------------------------------

describe("o erro inesperado não conta o que é, nem some", () => {
  it("um defeito nosso vira frase segura, sem o texto do runtime", async () => {
    promote.mockRejectedValue(
      new TypeError("Cannot read properties of undefined (reading 'entityId')"),
    );

    const motivo = await aprovarEColherMotivo();

    /*
      A frase genérica, gravada no run. O detalhe inteiro — erro, `cause`,
      SQLSTATE — continua no log, que é onde ele pode estar; o que este caso
      exige é que ele não esteja no campo que a tela mostra.
    */
    expect(motivo).not.toMatch(/Cannot read properties/);
    exigirRespostaLimpa(motivo);
    expect(registro.error).toHaveBeenCalled();
  });

  it("um erro do banco que não é schema também não manda corrigir a planilha", async () => {
    // 23505 é corrida de gravação: nem recusa de regra, nem migration faltando.
    promote.mockRejectedValue(
      erroDoDrizzle("23505", "duplicate key value violates unique constraint"),
    );

    const motivo = await aprovarEColherMotivo();
    expect(motivo).not.toMatch(/corrija a origem/i);
    exigirRespostaLimpa(motivo);
  });

  it("um erro sem mensagem não deixa o run sem motivo nenhum", async () => {
    promote.mockRejectedValue({ algo: "que não é Error" });

    const motivo = await aprovarEColherMotivo();
    expect(motivo.trim()).not.toBe("");
  });

  it("nem o run preso em PROMOTING para sempre", async () => {
    // O estado é a diferença entre "falhou" e "sumiu". A reserva é comitada, de
    // modo que o ROLLBACK da transação já não a desfaz: quem devolve o run a
    // quem espera decisão é esta chamada, e sem ela o cartão ficaria dizendo
    // "Importando…" até alguém excluir a importação.
    promote.mockRejectedValue(new TypeError("boom"));

    await aprovarEColherMotivo();
    expect(devolverAoPreview).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// E2 — parar
// ---------------------------------------------------------------------------

describe("parar uma importação", () => {
  async function cancelar(): Promise<Resposta> {
    const res = await fetch(`${base}/imports/${RUN}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    return { status: res.status, body: await res.json() };
  }

  it("a importação conferida para na hora, e a resposta diz isso", async () => {
    pedirCancelamento.mockResolvedValue({
      status: "PREVIEWED",
      encerradoAgora: true,
    });

    const { status, body } = await cancelar();
    const corpo = body as Record<string, unknown>;

    expect(status).toBe(200);
    expect(corpo["estado"]).toBe("CANCELADA");
    expect(corpo["mensagem"]).toMatch(/nada deste arquivo entrou/i);
  });

  it("a que está sendo gravada responde 'parando', porque ainda está", async () => {
    // A diferença não é cosmética: dizer "parada" aqui faria a resposta
    // contradizer o estado que a tela consulta um segundo depois.
    pedirCancelamento.mockResolvedValue({
      status: "PROMOTING",
      encerradoAgora: false,
    });

    const { status, body } = await cancelar();
    expect(status).toBe(200);
    expect((body as Record<string, unknown>)["estado"]).toBe("PARANDO");
  });

  it("a que já entrou não se cancela — e a resposta manda para Excluir", async () => {
    pedirCancelamento.mockResolvedValue({
      status: "PROMOTED",
      encerradoAgora: false,
    });

    const { status, body } = await cancelar();
    expect(status).toBe(409);
    expect((body as Record<string, unknown>)["error"]).toMatch(/Excluir/);
  });

  it("uma importação que não existe é 404, e não um cancelamento no vazio", async () => {
    pedirCancelamento.mockResolvedValue(null);

    const { status } = await cancelar();
    expect(status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// F — a varredura
// ---------------------------------------------------------------------------

describe("nenhuma saída deste fluxo carrega SQL", () => {
  /** Cada forma que uma falha de banco toma antes de chegar a um `catch`. */
  const FALHAS: [string, () => unknown][] = [
    ["42P01 embrulhado pelo drizzle", () => erroDoDrizzle("42P01", "no table")],
    ["42P10 sem índice", () => erroDoDrizzle("42P10", "no index", SEM_INDICE)],
    [
      "42P10 de consulta mal escrita",
      () =>
        erroDoDrizzle("42P10", "ORDER BY position 5", {
          routine: "findTargetlistEntrySQL92",
        }),
    ],
    ["23505 embrulhado pelo drizzle", () => erroDoDrizzle("23505", "dup key")],
    [
      "um erro cuja própria frase é a consulta",
      () =>
        new Error(
          'Failed query: UPDATE "import_run" SET status = $1 params: PROMOTED',
        ),
    ],
    [
      "um stack trace que virou mensagem",
      () =>
        new Error(
          "boom\n    at promote (/app/lib/ingest/src/pipeline.ts:1815:11)\n    at async /app/dist/index.mjs:9:1",
        ),
    ],
  ];

  /** Cada porta por onde uma resposta sai. */
  const PORTAS: [string, () => Promise<Resposta>][] = [
    ["POST /imports/:id/promote", () => aprovar()],
    [
      "GET /imports",
      async () => {
        const r = await fetch(`${base}/imports`);
        return { status: r.status, body: await r.json() };
      },
    ],
    [
      "GET /imports/:id/status",
      async () => {
        const r = await fetch(`${base}/imports/${RUN}/status`);
        return { status: r.status, body: await r.json() };
      },
    ],
    [
      "DELETE /imports/:id",
      async () => {
        const r = await fetch(`${base}/imports/${RUN}`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: "arquivo errado" }),
        });
        return { status: r.status, body: await r.json() };
      },
    ],
  ];

  for (const [nomeDaFalha, montar] of FALHAS) {
    for (const [nomeDaPorta, chamar] of PORTAS) {
      it(`${nomeDaPorta} com ${nomeDaFalha}`, async () => {
        promote.mockRejectedValue(montar());
        listImportRuns.mockRejectedValue(montar());
        deleteImportRun.mockRejectedValue(montar());
        getImportRunStatus.mockRejectedValue(montar());

        const { status, body } = await chamar();

        // Nunca 2xx: a falha continua sendo falha.
        expect(status).toBeGreaterThanOrEqual(400);
        exigirRespostaLimpa(body);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// As funções puras, direto
// ---------------------------------------------------------------------------

describe("classificarFalhaDeImportacao", () => {
  it("o SQLSTATE decide antes do texto, e é procurado dentro do embrulho", () => {
    expect(classificarFalhaDeImportacao(erroDoDrizzle("42P01", "x"))).toEqual({
      tipo: "SCHEMA",
    });
    expect(
      classificarFalhaDeImportacao(erroDoDrizzle("42P10", "x", SEM_INDICE)),
    ).toEqual({ tipo: "SCHEMA" });
    expect(classificarFalhaDeImportacao(erroDoDrizzle("23505", "x"))).toEqual({
      tipo: "INESPERADO",
    });
  });

  it("o 42P10 que é defeito de código não vira schema", () => {
    // Sem a rotina do árbitro, 42P10 é consulta mal escrita — e um bug não se
    // conserta rodando migrations.
    expect(
      classificarFalhaDeImportacao(
        erroDoDrizzle("42P10", "x", { routine: "transformDistinctOnClause" }),
      ),
    ).toEqual({ tipo: "INESPERADO" });
  });

  it("uma frase escrita em português é recusa, e sobrevive inteira", () => {
    const frase = "Esta vigência não fecha: corrija a origem e envie de novo.";
    expect(classificarFalhaDeImportacao(new Error(frase))).toEqual({
      tipo: "REGRA",
      mensagem: frase,
    });
  });

  it("um defeito do runtime nunca é recusa, por mais que seja um Error", () => {
    expect(
      classificarFalhaDeImportacao(new TypeError("x is undefined")),
    ).toEqual({ tipo: "INESPERADO" });
    expect(
      classificarFalhaDeImportacao(new RangeError("out of range")),
    ).toEqual({
      tipo: "INESPERADO",
    });
  });

  it("a peneira final pega o que a classificação não viu", () => {
    // Um erro sem `code` nenhum, cuja mensagem é a consulta: nada o
    // classificaria como banco, e ainda assim ele não pode virar resposta.
    const semCodigo = new Error('Failed query: INSERT INTO "fact" params: 1');
    expect(classificarFalhaDeImportacao(semCodigo)).toEqual({
      tipo: "INESPERADO",
    });
  });
});

describe("ehFraseParaQuemOpera", () => {
  it("deixa passar as frases que o pipeline escreve", () => {
    expect(
      ehFraseParaQuemOpera(
        "Esta importação criaria um equipamento que o dicionário não conhece: CARRETA.",
      ),
    ).toBe(true);
    expect(
      ehFraseParaQuemOpera(
        "Já existe uma versão ativa desta vigência. Registre uma correção.",
      ),
    ).toBe(true);
  });

  it("barra consulta, parâmetro e stack", () => {
    expect(ehFraseParaQuemOpera("Failed query: select 1")).toBe(false);
    expect(ehFraseParaQuemOpera('INSERT INTO "fact" VALUES (1)')).toBe(false);
    expect(ehFraseParaQuemOpera("DELETE FROM snapshot WHERE id = 1")).toBe(
      false,
    );
    expect(ehFraseParaQuemOpera('UPDATE "import_run" SET status = $1')).toBe(
      false,
    );
    expect(ehFraseParaQuemOpera("params: 1f10e1af-ac9b")).toBe(false);
    expect(ehFraseParaQuemOpera("boom\n    at promote (/app/x.ts:1:1)")).toBe(
      false,
    );
  });
});

describe("motivoGravavel", () => {
  /**
   * `import_run.failure_reason` é pior do que uma resposta HTTP: a resposta
   * passa, o campo fica. Ele é lido no card da importação meses depois, e era
   * por ali que a consulta entrava no banco para sempre.
   */
  it("nunca grava a consulta no run", () => {
    const gravado = motivoGravavel(erroDoDrizzle("42P01", "no table"));
    expect(gravado).not.toMatch(/Failed query|INSERT INTO|params:/i);
    expect(gravado).toMatch(/falta pelo menos uma migration/i);
    expect(gravado).toMatch(/healthz/);
  });

  it("preserva o motivo quando ele foi escrito para quem lê", () => {
    const frase = "A aba CAVALO não tem coluna de placa.";
    expect(motivoGravavel(new Error(frase))).toBe(frase);
  });

  it("um defeito do runtime vira frase genérica", () => {
    expect(
      motivoGravavel(new TypeError("undefined is not a function")),
    ).toMatch(/Não foi possível concluir a importação/);
  });
});
