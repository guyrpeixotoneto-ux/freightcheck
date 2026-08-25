import type { NextFunction, Request, Response } from "express";

/**
 * Instrumentação de ciclo de requisição e de fase — a evidência que faltava
 * para provar, em vez de inferir, o que acontece entre o cliente pedir e a
 * rota responder.
 *
 * Nasce de uma pergunta concreta: quando o navegador não recebe resposta
 * nenhuma de `/changes/latest` ou `/justificativas`, o defeito pode estar em
 * qualquer um dos elos — o cliente nunca chegou a mandar, o proxy segurou a
 * conexão, o processo reiniciou no meio, uma consulta ao banco ficou presa,
 * ou a resposta terminou e ninguém a leu. Sem medição, cada um desses casos
 * produz o mesmo sintoma do lado do navegador (`TypeError: Failed to fetch`),
 * e escolher entre eles vira chute.
 *
 * O que este módulo grava, por requisição:
 *
 *   - `request.start` / `request.finish`: quando a rota começou e terminou,
 *     com status e duração monotônica.
 *   - `request.close_before_finish`: a conexão foi encerrada **antes** de a
 *     resposta terminar — a evidência direta de que o cliente ou um proxy no
 *     meio desistiu enquanto a API ainda trabalhava. `res.on("finish")`
 *     dispara só quando a resposta terminou de ser escrita; `res.on("close")`
 *     dispara sempre, inclusive quando a conexão cai antes disso. A diferença
 *     entre os dois é o próprio fato que se quer provar.
 *   - `<fase>.start` / `<fase>.end`, via `iniciarFase`: os passos internos de
 *     uma rota — cada consulta ao banco, cada cálculo — para saber qual deles
 *     é lento, e não só que a rota inteira foi.
 *
 * `process.hrtime.bigint()` e não `Date.now()`: é monotônico — não anda para
 * trás se o relógio do sistema for ajustado no meio da medição, o que
 * `Date.now()` não garante. Para uma duração, é a diferença que interessa, e
 * só um relógio monotônico garante que ela nunca dê negativa.
 */

function buildRevision(): string {
  return process.env["BUILD_REVISION"] ?? "desconhecida";
}

function ms(desde: bigint): number {
  return Number(process.hrtime.bigint() - desde) / 1e6;
}

interface BaseDoRegistro {
  requestId: string | number;
  pid: number;
  revision: string;
  pathname: string;
}

function base(req: Request): BaseDoRegistro {
  return {
    requestId: (req.id ?? "desconhecido") as string | number,
    pid: process.pid,
    revision: buildRevision(),
    pathname: req.path,
  };
}

/**
 * Middleware de ciclo de vida da requisição — `request.start`, e depois
 * exatamente um de `request.finish` ou `request.close_before_finish`.
 *
 * Montada por rota (`router.use(caminho, instrumentarCicloDaRequisicao)`), e
 * não globalmente: o pedido era instrumentar `/changes/latest` e
 * `/justificativas`, e escopar aqui é o que impede esta mudança de tocar
 * comportamento ou log de qualquer outra rota.
 */
export function instrumentarCicloDaRequisicao(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const inicio = process.hrtime.bigint();
  const dados = base(req);

  req.log.info(
    { ...dados, evento: "request.start", timestamp: new Date().toISOString() },
    "request.start",
  );

  let terminouNormal = false;

  res.on("finish", () => {
    terminouNormal = true;
    req.log.info(
      {
        ...dados,
        evento: "request.finish",
        timestamp: new Date().toISOString(),
        duracaoMs: ms(inicio),
        status: res.statusCode,
      },
      "request.finish",
    );
  });

  res.on("close", () => {
    // `finish` já disparou: este `close` é a limpeza normal de uma conexão
    // que terminou de ser servida, não a evidência que este evento existe
    // para capturar.
    if (terminouNormal) return;
    req.log.warn(
      {
        ...dados,
        evento: "request.close_before_finish",
        timestamp: new Date().toISOString(),
        duracaoMs: ms(inicio),
        status: res.headersSent ? res.statusCode : undefined,
      },
      "Conexão encerrada antes do finish — cliente ou proxy encerrou enquanto a API ainda trabalhava.",
    );
  });

  next();
}

/** O que se fecha ao final de uma fase. */
export interface FaseEmAndamento {
  /** @param extra  campos que só se sabem no fim — `linhas`, `encontrado`, etc. */
  fim(extra?: Record<string, unknown>): void;
}

/**
 * Marca o início de um passo interno de uma rota, e devolve como fechá-lo.
 *
 * `nome` vira o prefixo do evento (`"computeChangeSet.start"`,
 * `"computeChangeSet.end"`) — a mesma convenção que `/changes/latest` e
 * `/justificativas` usam para cada um dos seus passos.
 */
export function iniciarFase(req: Request, nome: string): FaseEmAndamento {
  const inicio = process.hrtime.bigint();
  const dados = { ...base(req), fase: nome };

  req.log.info(
    { ...dados, evento: `${nome}.start`, timestamp: new Date().toISOString() },
    `${nome}.start`,
  );

  return {
    fim(extra: Record<string, unknown> = {}) {
      req.log.info(
        {
          ...dados,
          evento: `${nome}.end`,
          timestamp: new Date().toISOString(),
          duracaoMs: ms(inicio),
          ...extra,
        },
        `${nome}.end`,
      );
    },
  };
}
