import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { appliedMigrations } from "@workspace/db/migrate";
import { HealthCheckResponse } from "@workspace/api-zod";
import { expectedMigrations, relatorioDaPartida } from "../lib/migrations";

/**
 * Saúde do processo, e — o que faltava — do que ele enxerga do banco.
 *
 * A pergunta "o api-server publicado está recebendo a DATABASE_URL?" não tinha
 * como ser respondida de fora. Nada neste repositório entrega essa variável ao
 * deployment: o código só lê `process.env.DATABASE_URL`, e quem a coloca lá é a
 * plataforma. Sem uma resposta observável, a checagem virava adivinhação sobre
 * o que o Replit injeta em qual processo.
 *
 * Agora `/api/healthz` responde isso, sem expor valor nenhum: se a variável
 * chegou, se dá para conectar com ela, e se o schema existe do outro lado.
 */
const router: IRouter = Router();

/**
 * Quais migrations este banco tem, e quais este build esperava encontrar.
 *
 * `migrated` sozinho respondia por uma tabela só, criada na primeira migration
 * de todas — e por isso dizia "sim" num banco a que faltavam as cinco últimas.
 * Uma tela que dependesse de uma delas recebia 500, e o diagnóstico apontava
 * para a tela. Aqui a pergunta é a certa: **quais faltam.**
 *
 * O nome da migration atravessa (ele está no repositório, não revela nada) e o
 * SQLSTATE da falha também. A mensagem do driver, não: ela carrega host,
 * usuário e às vezes a linha que falhou, e este endpoint é público. A mensagem
 * inteira vai para o log do processo, onde já estava.
 */
export interface MigrationHealth {
  /** Quantas migrations este build carrega. */
  expected: number;
  /** Quantas o banco tem registradas. */
  applied: number;
  /** As que faltam, pelo nome, na ordem em que precisam entrar. */
  pending: string[];
  /** Onde a última tentativa deste processo parou, se parou. */
  failure?: { tag: string; code?: string };
}

export interface DatabaseHealth {
  /** A variável chegou ao processo. Nunca dizemos o que tem dentro dela. */
  configured: boolean;
  reachable: boolean;
  /** O schema existe: a primeira migration rodou neste banco. */
  migrated: boolean;
  /** Todas as migrations deste build estão aplicadas — o estado que importa. */
  upToDate?: boolean;
  migrations?: MigrationHealth;
  /** Código da falha, quando há. Código, nunca a mensagem — ver abaixo. */
  code?: string;
  detail: string;
}

/**
 * Só o código do erro atravessa, nunca a mensagem.
 *
 * Mensagens de driver carregam host, porta e às vezes usuário, e este endpoint
 * é público. O código diz o suficiente para agir e não descreve a topologia de
 * ninguém.
 */
function explain(code: string | undefined): string {
  switch (code) {
    case "ECONNREFUSED":
    case "ETIMEDOUT":
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "A DATABASE_URL chegou ao processo, mas o banco não respondeu no endereço que ela aponta.";
    case "28P01":
    case "28000":
      return "O banco recusou as credenciais da DATABASE_URL que este processo recebeu.";
    case "3D000":
      return "A DATABASE_URL aponta para um banco que não existe.";
    default:
      return "A DATABASE_URL chegou ao processo, mas a conexão falhou.";
  }
}

/**
 * A pendência dita de um jeito que diz o que fazer.
 *
 * Nomear as migrations que faltam é o ponto: "faltam 2" manda procurar; "faltam
 * 0008_book_entries e 0009_…" já diz qual tela vai responder erro e o que
 * precisa rodar para ela voltar.
 */
function descreverPendencia(migrations: MigrationHealth): string {
  const uma = migrations.pending.length === 1;
  const quantas = uma
    ? "1 migration não foi aplicada"
    : `${migrations.pending.length} migrations não foram aplicadas`;

  const parou = migrations.failure
    ? ` A tentativa parou em ${migrations.failure.tag}` +
      (migrations.failure.code
        ? ` (SQLSTATE ${migrations.failure.code}).`
        : ".") +
      " O log do servidor tem a mensagem inteira."
    : "";

  return (
    `Conectado, mas ${quantas} neste banco: ${migrations.pending.join(", ")}. ` +
    `As telas que dependem ${uma ? "dela respondem erro até que ela rode" : "delas respondem erro até que rodem"}.${parou}`
  );
}

/**
 * @param probe  pergunta ao banco se o schema está lá; separado da rota para
 *               os testes poderem exercitar cada desfecho sem um banco real.
 */
export async function describeDatabase(
  probe: () => Promise<{ migrated: boolean; migrations?: MigrationHealth }>,
  databaseUrl: string | undefined = process.env["DATABASE_URL"],
): Promise<DatabaseHealth> {
  if (!databaseUrl) {
    return {
      configured: false,
      reachable: false,
      migrated: false,
      detail:
        "Este processo não recebeu DATABASE_URL. O banco pode existir e estar " +
        "saudável: o que falta é a variável chegar até aqui.",
    };
  }

  try {
    const { migrated, migrations } = await probe();
    const pendentes = migrations?.pending ?? [];
    const upToDate = migrated && pendentes.length === 0;
    return {
      configured: true,
      reachable: true,
      migrated,
      upToDate,
      ...(migrations ? { migrations } : {}),
      detail: !migrated
        ? "Conectado, mas o schema não existe neste banco — faltam migrations."
        : upToDate
          ? "Conectado, com o schema aplicado."
          : descreverPendencia(migrations!),
    };
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code: unknown }).code)
        : undefined;
    return {
      configured: true,
      reachable: false,
      migrated: false,
      ...(code ? { code } : {}),
      detail: explain(code),
    };
  }
}

/**
 * Responde sempre 200, inclusive com o banco fora.
 *
 * O `[services.production.health.startup]` do artifact aponta para cá: se esta
 * rota falhasse quando o banco falha, o deployment nunca ficaria de pé — e o
 * roteador voltaria a devolver 502 sem corpo, que é justamente o estado que
 * este endpoint existe para tornar legível.
 */
router.get("/healthz", async (_req, res) => {
  const base = HealthCheckResponse.parse({ status: "ok" });
  const database = await describeDatabase(async () => {
    const result = await db.execute<{ migrated: boolean }>(
      sql`select to_regclass('public.import_run') is not null as migrated`,
    );
    const migrated = Boolean(result.rows[0]?.migrated);
    return { migrated, migrations: await pesquisarMigrations(migrated) };
  });
  res.json({ ...base, database });
});

/**
 * O que o banco tem, comparado ao que este build carrega.
 *
 * A lista de aplicadas vem do banco a cada chamada, e não do que este processo
 * fez na partida: quem migrou pode ter sido outra instância, ou uma pessoa pela
 * linha de comando, e a resposta precisa valer para agora. O relatório da
 * partida entra só para dizer *onde parou* — informação que o banco não guarda.
 */
async function pesquisarMigrations(
  migrated: boolean,
): Promise<MigrationHealth> {
  const esperadas = expectedMigrations();
  const relatorio = relatorioDaPartida();

  // Num banco vazio a tabela de registro também não existe, e perguntar por ela
  // devolveria um erro que `describeDatabase` leria como "o banco caiu".
  const aplicadas = migrated
    ? new Set<number>(await appliedMigrations(db))
    : new Set<number>();
  const pending = esperadas
    .filter((migration) => !aplicadas.has(migration.when))
    .map((migration) => migration.tag);

  return {
    expected: esperadas.length,
    applied: esperadas.length - pending.length,
    pending,
    ...(relatorio?.failure
      ? {
          failure: {
            tag: relatorio.failure.tag,
            ...(relatorio.failure.code ? { code: relatorio.failure.code } : {}),
          },
        }
      : {}),
  };
}

const startedAt = new Date().toISOString();

/**
 * De qual código este servidor foi feito, e desde quando está no ar.
 *
 * A pergunta "o que está no ar é o meu último commit?" não tinha resposta
 * verificável, e por três vezes um bundle antigo passou por um bug de código.
 * O carimbo entra no bundle em tempo de build (ver build.mjs) — fora do
 * contrato gerado por OpenAPI de propósito: é diagnóstico de operação, não
 * superfície de produto.
 */
router.get("/build", (_req, res) => {
  res.json({
    revision: process.env["BUILD_REVISION"] ?? "desconhecida",
    builtAt: process.env["BUILD_TIME"] ?? "desconhecido",
    startedAt,
  });
});

export default router;
