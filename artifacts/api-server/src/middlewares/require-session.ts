import type { RequestHandler } from "express";
import { db } from "@workspace/db";
import { isPublicPath } from "../lib/auth";
import {
  resolveSession,
  SESSION_COOKIE,
  type SessionUser,
} from "../lib/session";

declare global {
  namespace Express {
    interface Request {
      /** Quem está autenticado nesta requisição. Ausente = ninguém. */
      user?: SessionUser;
    }
  }
}

/**
 * O portão, e ele fecha por padrão.
 *
 * Montado uma vez em `/api`, antes de qualquer rota: toda rota nasce protegida,
 * e abrir uma exige entrar na lista de `isPublicPath` — um lugar só, que se lê
 * inteiro. O inverso (cada rota se proteger) depende de ninguém esquecer, e é
 * assim que endpoint fica aberto sem que ninguém perceba.
 *
 * A sessão é resolvida também nos caminhos públicos, porque `/auth/session` é
 * público e precisa justamente dizer quem é.
 */
export const requireSession: RequestHandler = async (req, res, next) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  const isPublic = isPublicPath(req.path);

  if (typeof token === "string" && token !== "") {
    try {
      const user = await resolveSession(db, token);
      if (user) req.user = user;
    } catch (err) {
      /*
        O banco fora não é "não autenticado": responder 401 mandaria para a
        tela de login quem já está logado, e a mensagem de lá — sobre
        credenciais — apontaria para o lugar errado.

        Quem responde é o contrato de erro, e não este middleware. Ele escrevia
        aqui a própria frase ("o banco não respondeu"), afirmando por conta
        própria uma causa que não tinha como distinguir de um schema atrasado
        ou de um defeito nosso — e sem o diagnóstico que diz o que resolve.
        `next(err)` entrega o erro a quem classifica uma vez para todas as
        rotas, e a tela recebe a mesma orientação que receberia de qualquer
        outra chamada que morresse pela mesma causa.
      */
      req.log.error({ err }, "Falha ao verificar a sessão");
      if (!isPublic) {
        next(err);
        return;
      }
    }
  }

  if (isPublic || req.user) {
    next();
    return;
  }

  /*
    O `requestId` sai também aqui, e não só nos 5xx do contrato.

    Um 401 é o desfecho que mais se parece, do lado de fora, com um desvio de
    autenticação — e é exatamente por isso que ele precisa se identificar. Com
    o `requestId` no corpo (e o carimbo da API no cabeçalho, ver
    `middlewares/carimbo-da-api.ts`), "a sessão não vale" deixa de ser
    indistinguível de "alguém no meio recusou a chamada": um tem número de
    requisição e linha de log deste processo, o outro não tem nenhum dos dois.
  */
  res.status(401).json({
    error: "Faça login para usar o FreightCheck.",
    code: "UNAUTHENTICATED",
    requestId: req.id,
  });
};
