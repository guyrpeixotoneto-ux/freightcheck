import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import {
  diagnosticar,
  textoDoDiagnostico,
  type Diagnostico,
  type EstadoObservado,
} from "@workspace/db/diagnostico";
import { observarBanco } from "../lib/migrations";
import { estadoDoBackup } from "../lib/backup-agendado";

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
  /**
   * O estado classificado — a resposta que importa, e a única que a interface
   * deve apresentar como recomendação. Ver `lib/db/src/diagnostico.ts`.
   */
  diagnostico: Diagnostico;
  /**
   * O mesmo diagnóstico como texto corrido, para quem lê por `curl`.
   *
   * É derivado de `diagnostico`, nunca escrito à parte: se divergisse, estariam
   * de volta as duas versões da verdade que este módulo existe para eliminar.
   */
  detail: string;
}

/**
 * @param observar  o estado do banco agora; separado da rota para os testes
 *                  poderem exercitar cada desfecho sem um Postgres do lado.
 *
 * Este endpoint deixou de classificar nada por conta própria. Ele observa,
 * entrega o que observou a `diagnosticar` e publica o resultado. Enquanto a
 * classificação morava aqui, ela era **uma** das duas do repositório — a outra
 * estava escrita à mão nas rotas de Chamados e do Book, que não tinham como
 * saber o estado do banco e mesmo assim prescreviam remédio. Ver
 * `lib/db/src/diagnostico.ts`.
 */
export async function describeDatabase(
  observar: () => Promise<EstadoObservado>,
): Promise<DatabaseHealth> {
  const estado = await observar();
  const diagnostico = diagnosticar(estado);

  return {
    configured: estado.configurada,
    reachable: estado.alcancavel,
    /*
      `migrated` sobrevive por compatibilidade — é o campo que respondia por uma
      tabela só e por isso dizia "sim" num banco a que faltavam cinco
      migrations. Aqui ele significa o que o nome promete: alguma migration
      deste build está registrada. Quem precisa do estado real lê `diagnostico`.
    */
    migrated: estado.alcancavel && estado.aplicadas > 0,
    upToDate: diagnostico.estado === "SAUDAVEL",
    ...(estado.alcancavel
      ? {
          migrations: {
            expected: estado.aplicadas + estado.pendentes.length,
            applied: estado.aplicadas,
            pending: estado.pendentes,
            ...(estado.falha ? { failure: estado.falha } : {}),
          },
        }
      : {}),
    ...(estado.codigoDeConexao ? { code: estado.codigoDeConexao } : {}),
    diagnostico,
    detail: textoDoDiagnostico(diagnostico),
  };
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
  const database = await describeDatabase(() => observarBanco());
  /*
    O backup entra pela mesma razão que as migrations: cópia atrasada é um
    estado que precisa ser observável de fora ANTES de fazer falta. Sai o
    estado, nunca o caminho — este endpoint é público.
  */
  res.json({ ...base, database, backup: estadoDoBackup() });
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
