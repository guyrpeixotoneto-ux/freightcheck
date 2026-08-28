import type { RequestHandler } from "express";
import { db } from "@workspace/db";
import {
  moduloDaEscrita,
  nivelDe,
  permissoesDe,
} from "../lib/permissoes";

/**
 * O portão que recusa escrita de quem não tem edição no módulo.
 *
 * Montado depois de `requireSession` e antes das rotas: quem chega aqui já tem
 * sessão, e o que se decide é o que essa sessão **pode mudar**. A regra cabe em
 * uma frase — `POST`, `PUT`, `PATCH` e `DELETE` num caminho que pertence a um
 * módulo exigem nível `EDITAR` naquele módulo — e o resto deste comentário é
 * sobre os limites dela, que é o que costuma faltar por escrito.
 *
 * **Só escrita.** O mapa de `lib/permissoes.ts` diz quem escreve cada prefixo
 * de API; leitura não é filtrada aqui. Não é esquecimento: as telas
 * compartilham endpoints de leitura, e um bloqueio por módulo sobre endpoint
 * compartilhado derrubaria tela permitida sem proteger a proibida. Quem some
 * para quem não tem acesso é o item no menu (`lib/permissoes.ts`, do lado da
 * interface); quem garante que ninguém *muda* o que não pode é este arquivo.
 *
 * **Caminho não reivindicado passa.** Um prefixo que nenhum módulo declara não
 * é bloqueado — seria adivinhar o dono, e adivinhar aqui significa recusar
 * trabalho legítimo com um 403 que ninguém sabe explicar. A lista de prefixos é
 * a fronteira do que este portão promete, e ela está escrita num lugar só.
 *
 * **Uma consulta por escrita, e nenhuma por leitura.** As permissões são lidas
 * do banco na requisição que as usa. Leitura é a maioria esmagadora do tráfego
 * e não paga nada por isto; escrita paga uma consulta indexada pela chave
 * primária, que é barato ao lado do que ela mesma vai gravar.
 */

const ESCRITAS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const portaoDePermissao: RequestHandler = async (req, res, next) => {
  if (!ESCRITAS.has(req.method) || !req.user) {
    next();
    return;
  }

  const modulo = moduloDaEscrita(req.path);
  if (!modulo) {
    next();
    return;
  }

  try {
    const permissoes = await permissoesDe(db, req.user.id);
    const nivel = nivelDe(permissoes, modulo);
    if (nivel === "EDITAR") {
      next();
      return;
    }

    /*
      A frase diz o módulo e a quem pedir. "Acesso negado" manda a pessoa
      adivinhar se errou o caminho, se a sessão caiu ou se alguém mexeu no
      acesso dela — e as três levam a lugares diferentes.
    */
    res.status(403).json({
      error:
        nivel === "VISUALIZAR"
          ? `O seu acesso a este módulo é somente leitura. Peça edição a um administrador em Configurações › Usuários.`
          : `Você não tem acesso a este módulo. Peça a um administrador em Configurações › Usuários.`,
      modulo,
      nivel,
    });
  } catch (err) {
    /*
      Banco fora não é "não pode": mandar 403 acusaria a pessoa de algo que não
      se sabe. Quem classifica a falha é o contrato de erro, uma vez para todas
      as rotas.
    */
    next(err);
  }
};
