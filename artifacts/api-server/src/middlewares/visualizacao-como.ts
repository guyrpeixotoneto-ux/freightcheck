import type { RequestHandler } from "express";

/**
 * Enquanto alguém está **visualizando como** outra conta, a sessão só lê.
 *
 * A razão é a mesma que fez este produto ter login: cada confirmação de
 * curadoria e cada promoção de vigência grava um `actor`, e o valor disso está
 * inteiro na frase "foi fulano quem confirmou". Uma escrita feita durante uma
 * visualização não teria autor honesto — nem o da conta visualizada, que não
 * clicou em nada, nem o do administrador, que clicou numa tela montada com o
 * acesso de outra pessoa. Recusar as duas atribuições é a única resposta que
 * não mente, e é esta.
 *
 * Então a visualização é o que o nome diz e nada além: abre o produto pelos
 * olhos de alguém, e não empresta as mãos dele. Quem precisa mudar alguma coisa
 * volta ao próprio perfil — um clique — e faz o ato em seu próprio nome, que é
 * como ele fica gravado.
 *
 * **Três escritas atravessam**, e cada uma pela mesma razão: são a saída.
 * Encerrar a visualização, trocar de conta visualizada e sair do sistema não
 * podem depender de um estado que elas mesmas existem para desfazer — um
 * portão que trancasse a porta de saída deixaria a sessão presa até o cookie
 * expirar.
 *
 * Montado depois de `requireSession` (é ele quem sabe se há visualização) e
 * antes do portão de permissão: recusar por visualização antes de consultar
 * permissão poupa a consulta e responde a razão certa — o motivo da recusa aqui
 * não é o acesso da conta, é o estado da sessão.
 */

const ESCRITAS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** O que continua respondendo durante uma visualização. Ver o comentário. */
const SAIDAS = new Set([
  "/auth/visualizar-como",
  "/auth/visualizar-como/parar",
  "/auth/logout",
]);

export const visualizacaoSomenteLeitura: RequestHandler = (req, res, next) => {
  if (!req.visualizacaoDesde || !ESCRITAS.has(req.method)) {
    next();
    return;
  }

  const normalizado =
    req.path.length > 1 && req.path.endsWith("/")
      ? req.path.slice(0, -1)
      : req.path;
  if (SAIDAS.has(normalizado)) {
    next();
    return;
  }

  res.status(403).json({
    error:
      `Você está visualizando o produto como ${req.user?.name ?? "outra conta"}, ` +
      "e uma visualização não altera nada — o que fosse gravado aqui não teria " +
      "autor honesto. Volte ao seu perfil, na faixa do topo, para fazer isto em " +
      "seu próprio nome.",
    code: "VISUALIZANDO_COMO",
  });
};
