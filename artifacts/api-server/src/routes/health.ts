import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import {
  diagnosticar,
  textoDoDiagnostico,
  type Diagnostico,
  type EstadoObservado,
} from "@workspace/db/diagnostico";
import { observarBanco } from "../lib/migrations";
import { estadoDaProntidao } from "../lib/prontidao";
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
    **`ready` é o campo que faltava, e a distinção é o ponto.** Este endpoint
    responde 200 sempre porque é para onde o startup probe aponta: o
    deployment precisa subir para poder ser diagnosticado. Isso, sozinho,
    fazia um processo com a fila atrasada — ou com uma migration que falhou —
    parecer saudável para qualquer um que olhasse só o status.

    De pé e pronto passam a ser duas perguntas. O status 200 responde a
    primeira; `ready` responde a segunda, e `/readyz` a devolve também como
    código HTTP, para quem consulta por probe em vez de ler corpo.
  */
  const prontidao = await estadoDaProntidao();
  res.json({
    ...base,
    ready: prontidao.pronto,
    database,
    backup: estadoDoBackup(),
  });
});

/**
 * Este processo pode receber tráfego de produto?
 *
 * **Separado do `/healthz`, e não uma versão dele com outro status.** As duas
 * perguntas têm consumidores opostos: o startup probe precisa de um endpoint
 * que responda 200 mesmo com o banco fora — senão o deployment nunca sobe e o
 * roteador volta a devolver 502 sem corpo —, e a prontidão precisa de um que
 * responda **não-200** exatamente quando não dá para servir. Um endpoint só
 * não pode fazer as duas coisas, e foi por tentar que "de pé" passou anos
 * significando "pronto".
 *
 * 503, e não 500: é indisponibilidade temporária deste processo, com
 * `Retry-After` — a mesma classe do portão que recusa as rotas de produto, e
 * pela mesma razão.
 *
 * O corpo traz o diagnóstico inteiro porque é ele que diz o que resolve, e é a
 * mesma autoridade do `/healthz`: as duas rotas não têm como discordar sobre o
 * mesmo banco, porque perguntam à mesma função.
 */
router.get("/readyz", async (_req, res) => {
  const prontidao = await estadoDaProntidao();
  if (prontidao.pronto) {
    res.json({ ready: true });
    return;
  }
  res.setHeader("Retry-After", "5");
  res.status(503).json({
    ready: false,
    diagnostico: prontidao.diagnostico,
    detail: textoDoDiagnostico(prontidao.diagnostico),
  });
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
