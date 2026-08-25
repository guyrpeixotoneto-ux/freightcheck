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
import { estadoDaPromocao } from "../lib/partida";
import { estadoDoBackup } from "../lib/backup-agendado";

/**
 * As três rotas de estado, e a fronteira entre elas.
 *
 * | rota       | pergunta                                   | toca o banco |
 * | ---------- | ------------------------------------------ | ------------ |
 * | `/healthz`  | este processo está de pé?                  | não          |
 * | `/startupz` | a promoção pode acontecer, ou a fila ainda está em voo? | não |
 * | `/readyz`   | este ambiente tem o que este build precisa? | sim          |
 * | `/build`    | de qual código ele foi feito?              | não          |
 *
 * **`/startupz` não é uma quarta autoridade sobre o banco.** Ele nunca chama
 * `observarBanco`, e sua resposta não classifica estado nenhum — o que ele
 * publica é um fato deste processo: a tentativa de partida terminou, ou não? A
 * classificação continua sendo só `/readyz`. Ver `lib/partida.ts` para o
 * porquê da separação e o que ela deliberadamente não faz.
 *
 * A fronteira entre as duas primeiras é a correção deste arquivo, e ela não é
 * arrumação. As duas perguntas têm consumidores opostos — o startup probe
 * precisa de um 200 mesmo com o banco fora, a prontidão precisa de um não-200
 * exatamente quando não dá para servir — e por anos foram respondidas pelo
 * mesmo endereço. O efeito colateral era a interface: com `/healthz` sendo o
 * único lugar que sabia do banco, a tela passou a **mandar a pessoa abri-lo**,
 * e "confira /api/healthz" virou a resposta do produto a quem só queria entrar.
 *
 * A pergunta "o api-server publicado está recebendo a DATABASE_URL?" não tinha
 * como ser respondida de fora. Nada neste repositório entrega essa variável ao
 * deployment: o código só lê `process.env.DATABASE_URL`, e quem a coloca lá é a
 * plataforma. Sem uma resposta observável, a checagem virava adivinhação sobre
 * o que o Replit injeta em qual processo. Quem a responde agora é `/readyz`,
 * sem expor valor nenhum: se a variável chegou, se dá para conectar com ela, e
 * se o schema do outro lado é o que este build declara.
 */
const router: IRouter = Router();

/** Quando este processo subiu — respondido pelo `/healthz` e pelo `/build`. */
const startedAt = new Date().toISOString();

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
 * Liveness, e **só** liveness: este processo está de pé e atendendo.
 *
 * ---------------------------------------------------------------------------
 * Por que esta rota não fala do banco
 * ---------------------------------------------------------------------------
 * Ela já falou, e o preço apareceu na tela de quem usa o produto. Enquanto
 * `/healthz` respondia o estado do banco, ele virou **o endereço que a
 * interface mandava a pessoa abrir**: "Se isto persistir, confira
 * `/api/healthz`" na tela de login, um link "Ver /api/healthz" na tela que não
 * conseguiu ser desenhada. Um produto que responde a uma falha entregando um
 * endpoint técnico está pedindo a quem só queria entrar que faça o diagnóstico
 * no lugar dele.
 *
 * A separação é o que permite tirar aquela frase sem perder informação:
 * liveness aqui, readiness em `/readyz`, e a interface consulta `/readyz`
 * sozinha quando uma chamada falha — ver `lib/prontidao.ts` na interface. O que
 * a pessoa lê passa a ser uma frase em português; o nome da migration e o
 * comando continuam existindo, atrás de "Detalhes técnicos".
 *
 * ---------------------------------------------------------------------------
 * Por que ela responde 200 sempre
 * ---------------------------------------------------------------------------
 * O `[services.production.health.startup]` do artifact aponta para cá. Uma
 * rota de saúde que falhasse junto com o banco faria o deployment nunca ficar
 * de pé — e o roteador voltaria a devolver 502 sem corpo, que é justamente o
 * estado que estas rotas existem para tornar legível. "De pé" e "pronto" são
 * duas perguntas, e cada uma tem o seu endereço.
 *
 * Não toca no banco: nenhuma consulta, nenhuma conexão. É o que a torna
 * imune ao banco fora do ar — a propriedade que o startup probe precisa — e o
 * que a faz responder em microssegundos.
 */
router.get("/healthz", (_req, res) => {
  const base = HealthCheckResponse.parse({ status: "ok" });
  res.json({
    ...base,
    /*
      O que este processo sabe sem perguntar a ninguém. `startedAt` é o mesmo
      carimbo do `/build`, e está aqui porque a primeira pergunta de quem
      encontra um serviço estranho é há quanto tempo ele subiu.
    */
    startedAt,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

/**
 * O alvo do startup probe — a partir de quando ele passa a apontar para cá.
 *
 * ---------------------------------------------------------------------------
 * O que esta rota resolve, e o que ela continua deixando para o portão
 * ---------------------------------------------------------------------------
 * Até aqui o probe apontava para `/healthz`, que responde 200 sem tocar no
 * banco — necessário para o bind não bloquear a partida, mas suficiente para a
 * plataforma promover o release **enquanto a fila deste build ainda está
 * rodando**. É a janela entre `app.listen()` e o fim de
 * `applyMigrationsInBackground()`: dentro dela toda rota de produto responde
 * 503 pelo portão de prontidão, e é exatamente o corpo que apareceu na tela de
 * login em 24/08/2026.
 *
 * `/startupz` responde 503 enquanto essa tentativa está em voo, e 200 quando
 * ela termina — convergiu, falhou de um jeito que só humano resolve, ou este
 * ambiente não migra na partida. Os três são fins de espera: reter a promoção
 * só faz sentido enquanto há algo em andamento.
 *
 * **Não fecha a porta para migration que falha.** Se fechasse — 503
 * permanente —, o deployment nunca subiria, a versão anterior continuaria
 * servindo e nada diria por quê; é o modo de falha que a arquitetura atual
 * (fila em segundo plano, portão em processo) foi escolhida para evitar, e
 * está medido em `docs/MIGRATIONS.md`. Terminar com falha ainda é terminar: o
 * deployment sobe, e quem opera lê o motivo em `/readyz` e no alerta.
 *
 * **Fail-closed sem prazo de validade.** `STARTUP_PROBE_MAX_WAIT_MS` marca a
 * espera como anômala (`alemDoTeto`) no corpo da resposta, mas não libera
 * nada: 503 continua sendo a resposta enquanto a tentativa não tiver
 * terminado, por mais que ela demore. Liberar por relógio, sem saber se a fila
 * terminou, seria mentir sobre o único fato que esta rota existe para dizer —
 * ver o cabeçalho de `lib/partida.ts`.
 */
router.get("/startupz", (_req, res) => {
  const promocao = estadoDaPromocao();
  const corpo = {
    liberar: promocao.liberar,
    fase: promocao.fase,
    detail: promocao.motivo,
    esperandoHaMs: promocao.esperandoHaMs,
    /*
      Informativo, nunca decisório: fica `false` sempre que `liberar` é
      `true`, porque uma vez terminada a tentativa a pergunta "isto demorou
      muito?" deixou de valer para a promoção. Ver `lib/partida.ts`.
    */
    alemDoTeto: promocao.alemDoTeto,
  };
  if (promocao.liberar) {
    res.json(corpo);
    return;
  }
  res.setHeader("Retry-After", "2");
  res.status(503).json(corpo);
});

/**
 * Readiness: este ambiente tem tudo o que este build precisa para servir?
 *
 * **Separado do `/healthz`, e não uma versão dele com outro status.** As duas
 * perguntas têm consumidores opostos: o startup probe precisa de um endpoint
 * que responda 200 mesmo com o banco fora — senão o deployment nunca sobe e o
 * roteador volta a devolver 502 sem corpo —, e a prontidão precisa de um que
 * responda **não-200** exatamente quando não dá para servir. Um endpoint só
 * não pode fazer as duas coisas, e foi por tentar que "de pé" passou anos
 * significando "pronto".
 *
 * **O que entra na conta**, e cada um é uma pré-condição de servir, não uma
 * curiosidade: a `DATABASE_URL` ter chegado, o banco responder, a fila de
 * migrations deste build estar aplicada e o schema conferir com o que o build
 * declara. Pronto é `SAUDAVEL` e nada além — ver `lib/prontidao.ts`.
 *
 * **Medido agora, sempre.** Nenhuma resposta desta rota sai da lembrança da
 * partida: é depois de convergir que o banco cai, e é depois de subir com a
 * fila atrasada que alguém aplica as migrations. Nos dois sentidos, a resposta
 * seguinte já é a nova — sem reiniciar processo nenhum.
 *
 * 503, e não 500: é indisponibilidade temporária deste processo, com
 * `Retry-After` — a mesma classe do portão que recusa as rotas de produto, e
 * pela mesma razão.
 *
 * O corpo traz o diagnóstico inteiro nos dois desfechos. É ele que a interface
 * apresenta quando uma chamada falha, e é a mesma autoridade que responde às
 * rotas: `diagnosticar` classifica uma vez, e ninguém tem como discordar dela
 * sobre o mesmo banco no mesmo instante.
 */
router.get("/readyz", async (_req, res) => {
  const prontidao = await estadoDaProntidao();
  const corpo = {
    ready: prontidao.pronto,
    diagnostico: prontidao.diagnostico,
    detail: textoDoDiagnostico(prontidao.diagnostico),
    database: await describeDatabase(() => observarBanco()),
    /*
      A idade da última cópia sai aqui, e não no liveness: é fato de operação
      deste ambiente, da mesma família das outras pré-condições. Não entra em
      `ready` de propósito — um backup atrasado é motivo para alarme, nunca para
      recusar tráfego de um produto que está servindo corretamente.
    */
    backup: estadoDoBackup(),
  };

  if (prontidao.pronto) {
    res.json(corpo);
    return;
  }
  res.setHeader("Retry-After", "5");
  res.status(503).json(corpo);
});

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
    /*
      `pid` e `uptimeSeconds` são o que fecha a prova de restart sem depender
      de comparar dois carimbos a olho: dois acessos a `/api/build` com o
      mesmo `pid` e `startedAt` são, sem dúvida, o mesmo processo — pids não
      se repetem enquanto o processo anterior existe, e um `pid` novo com
      `revision` igual é exatamente o retrato de um cold start (reiniciou o
      mesmo build), enquanto um `revision` diferente é deploy. Ver
      `process.start`/`process.sigterm`/etc. em `index.ts`, que gravam os
      mesmos três campos no momento em que o processo nasce e morre — o que
      este endpoint publica é a leitura ao vivo do mesmo fato.
    */
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

export default router;
