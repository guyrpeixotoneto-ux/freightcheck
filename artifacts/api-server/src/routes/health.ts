import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { HealthCheckResponse } from "@workspace/api-zod";

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

export interface DatabaseHealth {
  /** A variável chegou ao processo. Nunca dizemos o que tem dentro dela. */
  configured: boolean;
  reachable: boolean;
  /** O schema existe: migrations aplicadas neste banco. */
  migrated: boolean;
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
 * @param probe  pergunta ao banco se o schema está lá; separado da rota para
 *               os testes poderem exercitar cada desfecho sem um banco real.
 */
export async function describeDatabase(
  probe: () => Promise<{ migrated: boolean }>,
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
    const { migrated } = await probe();
    return {
      configured: true,
      reachable: true,
      migrated,
      detail: migrated
        ? "Conectado, com o schema aplicado."
        : "Conectado, mas o schema não existe neste banco — faltam migrations.",
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
    return { migrated: Boolean(result.rows[0]?.migrated) };
  });
  res.json({ ...base, database });
});

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
