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
      /**
       * A conta que esta requisição vale. Ausente = ninguém.
       *
       * Durante um "visualizar como" é a conta **visualizada**: é ela que o
       * menu, as permissões e as telas seguem — ver o produto pelos olhos de
       * alguém é exatamente o que se foi fazer. Quem responde pela sessão é
       * `donoDaSessao`, logo abaixo, e é por isso que escrita fica recusada
       * enquanto a visualização estiver aberta
       * (`middlewares/visualizacao-como.ts`).
       */
      user?: SessionUser;
      /**
       * Quem digitou a senha. Igual a `user` fora de uma visualização.
       *
       * Nunca é `undefined` quando `user` não é: toda sessão tem dono. Quem
       * precisa dele é o log e a decisão de recusar escrita — nunca a tela.
       */
      donoDaSessao?: SessionUser;
      /** Desde quando a visualização está aberta; ausente quando não há. */
      visualizacaoDesde?: Date;
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
      const sessao = await resolveSession(db, token);
      if (sessao) {
        req.user = sessao.usuario;
        req.donoDaSessao = sessao.dono;
        if (sessao.visualizacaoDesde !== null) {
          req.visualizacaoDesde = sessao.visualizacaoDesde;
        }
      }
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

  res.status(401).json({
    error: "Faça login para usar o FreightCheck.",
    code: "UNAUTHENTICATED",
  });
};
