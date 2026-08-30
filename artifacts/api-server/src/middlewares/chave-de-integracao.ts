import type { RequestHandler } from "express";
import { db } from "@workspace/db";
import {
  CABECALHO_DA_CHAVE,
  chaveApresentada,
  type ChaveGuardada,
  type Escopo,
} from "@workspace/integrations";
import { conferirChave, registrarChamada, resultadoDoStatus } from "../lib/integracoes";

declare global {
  namespace Express {
    interface Request {
      /**
       * A chave que autenticou esta chamada. Só existe sob `/api/v1`.
       *
       * Nunca coexiste com `req.user`: a superfície externa é montada antes de
       * `requireSession` e nenhuma rota dela lê cookie. É a separação que
       * garante que uma chave de máquina jamais alcance uma tela e que uma
       * sessão de pessoa jamais seja aceita como credencial de integração.
       */
      integracao?: ChaveGuardada;
      /**
       * A importação que esta chamada criou, quando criou alguma.
       *
       * A rota a anota aqui; quem grava o log a lê no `finish`. É o único jeito
       * de o registro da chamada saber o desfecho sem que a rota precise
       * chamar o registrador — e uma rota que chamasse o registrador é uma rota
       * que um dia esqueceria.
       */
      importRunDaChamada?: string;
    }
  }
}

/**
 * O PORTÃO DA PORTA DE API — autentica pela chave e registra o que passou.
 *
 * Duas responsabilidades num middleware só, e elas não se separam de propósito:
 * **toda** chamada autenticada vira linha no log, inclusive a que este mesmo
 * middleware recusa por escopo. Se o registro morasse nas rotas, a chamada
 * recusada não seria registrada por nenhuma delas — e "esta chave apanha 403
 * desde terça" é exatamente o que a tela de Integrações existe para mostrar.
 *
 * ---------------------------------------------------------------------------
 * Como o status final é conhecido
 * ---------------------------------------------------------------------------
 *
 * Pelo `finish` da resposta, e não pelo retorno da rota. É o que faz o log
 * contar também o 500 que o contrato de erro escreve depois
 * (`middlewares/contrato-json.ts`) e o 404 de um caminho que não existe: os
 * dois acontecem fora da rota, e um registro que só a rota alimentasse
 * mostraria a integração saudável enquanto ela apanhava.
 *
 * ---------------------------------------------------------------------------
 * O que ele não faz
 * ---------------------------------------------------------------------------
 *
 * **Não registra a chave que não reconheceu.** Uma chamada com chave inválida
 * não tem dono — atribuí-la a alguém seria inventar, e guardá-la numa tabela
 * "de tentativas" convidaria a gravar o que veio no cabeçalho, que é
 * exatamente o que não se pode fazer com uma credencial de origem
 * desconhecida. Ela é recusada, e o log do processo (com `requestId`) é onde
 * ela aparece.
 *
 * **Não limita frequência.** Não há rate limit aqui, e não é esquecimento: o
 * que existe hoje atrás desta porta é o envio de planilha, cuja defesa é
 * outra — o mesmo conteúdo não entra duas vezes (`content_sha256`, no
 * pipeline). Um limitador sem estado compartilhado daria falsa segurança num
 * serviço que escala horizontalmente. Está em `docs/INTEGRACOES.md` como o que
 * vem junto da primeira rota que precise dele.
 */
export function chaveDeIntegracao(escopo: Escopo | null): RequestHandler {
  return async (req, res, next) => {
    const comeco = Date.now();
    const segredo = chaveApresentada({
      authorization: req.headers.authorization,
      chavePropria: req.headers[CABECALHO_DA_CHAVE],
    });

    let decisao;
    try {
      decisao = await conferirChave(db, segredo, escopo);
    } catch (err) {
      /*
        Banco fora, schema atrasado, defeito nosso: não é "não autorizado", e
        responder 401 mandaria quem integra trocar uma chave que está correta.
        Sobe para o contrato, que classifica uma vez para todas as rotas.
      */
      next(err);
      return;
    }

    const chave = decisao.chave;
    if (chave) {
      /*
        O registro é armado **antes** da resposta, e dispara no `finish`. Armar
        depois de responder perderia justamente as respostas que este
        middleware escreve logo abaixo.
      */
      res.on("finish", () => {
        void registrarChamada(
          db,
          {
            integracaoId: chave.integracaoId,
            chaveId: chave.id,
            metodo: req.method,
            caminho: req.originalUrl.split("?")[0]!,
            status: res.statusCode,
            duracaoMs: Date.now() - comeco,
            resultado: resultadoDoStatus(res.statusCode),
            motivo: decisao.ok ? null : decisao.mensagem,
            bytes: Number.parseInt(String(req.headers["content-length"] ?? "0"), 10) || 0,
            requestId: typeof req.id === "string" ? req.id : String(req.id ?? ""),
            importRunId: req.importRunDaChamada ?? null,
          },
          (err) => req.log.error({ err }, "Não foi possível registrar a chamada de API"),
        );
      });
    }

    if (!decisao.ok) {
      res.status(decisao.status).json({
        error: decisao.mensagem,
        code: decisao.motivo,
        requestId: req.id,
      });
      return;
    }

    req.integracao = decisao.chave;
    next();
  };
}
