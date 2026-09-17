import type { RequestHandler } from "express";
import { db } from "@workspace/db";
import {
  ambienteDaConsulta,
  ambienteDoAcervo,
  escritaForaDoAmbiente,
  moduloDaEscrita,
  nivelDe,
  nivelDoAmbiente,
  permissoesDe,
} from "../lib/permissoes";

/**
 * O portão que recusa escrita de quem não tem edição no ambiente ou no módulo.
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
 * **Dois eixos, uma consulta.** Desde que o ambiente de trabalho virou
 * permissão, uma escrita passa por duas perguntas: a pessoa edita neste
 * **ambiente** (a auditoria ou o fechamento de onde a chamada saiu) e neste
 * **módulo**? As duas leem o mesmo mapa, lido uma vez só. A do ambiente vem
 * primeiro porque é a mais larga — e porque é a que explica melhor o 403: "você
 * não trabalha no Fechamento AS" é uma frase que quem leu sabe o que fazer com,
 * e "sem acesso a Competências" no meio de um ambiente inteiro que não é seu
 * manda procurar no lugar errado.
 *
 * **E o ambiente são dois carimbos, não um.** `?ambiente=` diz de onde a pessoa
 * fala; `?operacao=` diz que acervo ela quer. Enquanto só o primeiro era
 * autorizado, trocar um pelo outro atravessava a restrição: uma conta recusada
 * na Auditoria Empurrada recebia o acervo dela declarando `ambiente=
 * auditoria-rota` e mantendo `operacao=EMPURRADA` — ou simplesmente omitindo o
 * `?ambiente=`. Agora os dois são conferidos, e a requisição que a tela monta
 * não sente diferença, porque nela os dois nascem do mesmo endereço. Ver
 * `ambienteDoAcervo`, em `lib/permissoes.ts`, que é onde a correspondência mora.
 *
 * **A Administração fica de fora do eixo do ambiente**, e a lista das escritas
 * que ficam está em `lib/permissoes.ts`: contas, unidades, cadastro da casa e
 * sessão valem para o produto inteiro, e o carimbo do cliente não tem como
 * saber disso — fora de um prefixo de ambiente ele manda `auditoria`, que é o
 * que sobra. Sem a lista, tirar a Auditoria Empurrada de alguém tiraria junto o
 * botão de trocar a própria senha.
 *
 * **Escrita sem carimbo nenhum não é recusada por ambiente.** É a mesma regra
 * do caminho não reivindicado: sem `?ambiente=` e sem `?operacao=` não há o que
 * conferir, e adivinhar o dono recusaria trabalho legítimo. O que mudou é que
 * **um** dos dois já basta — uma escrita que pede o acervo de uma operação é
 * conferida contra o ambiente daquela operação mesmo que não declare ambiente
 * nenhum, que era o outro jeito de atravessar isto.
 *
 * Quem *recorta* o dado continua sendo `?operacao=`, em `lib/operacao.ts`, e ele
 * não depende de permissão — são duas garantias diferentes sobre o mesmo
 * carimbo: uma diz de que acervo a resposta sai, a outra diz quem pode pedi-lo.
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
  const fora = escritaForaDoAmbiente(req.path);
  const consulta = req.query as Record<string, unknown>;
  const declarado = fora ? null : ambienteDaConsulta(consulta);
  /*
    O acervo pedido é o segundo ambiente a conferir, e ele não é o declarado.

    Ver `ambienteDoAcervo`, em `lib/permissoes.ts`: os dois carimbos são do
    cliente, e enquanto só o primeiro era autorizado, declarar um ambiente
    permitido e pedir o acervo de outro atravessava a restrição inteira. Os dois
    coincidem na requisição honesta — a tela carimba os dois a partir do mesmo
    endereço —, e é justamente por isso que exigir os dois não custa nada a quem
    está no lugar certo.
  */
  const doAcervo = fora ? null : ambienteDoAcervo(consulta);
  const ambientes = [...new Set([declarado, doAcervo].filter((a) => a !== null))];
  if (!modulo && ambientes.length === 0) {
    next();
    return;
  }

  try {
    const permissoes = await permissoesDe(db, req.user.id);

    for (const ambiente of ambientes) {
      const nivel = nivelDoAmbiente(permissoes, ambiente);
      if (nivel !== "EDITAR") {
        res.status(403).json({
          error:
            nivel === "VISUALIZAR"
              ? "O seu acesso a este ambiente de trabalho é somente leitura. Peça edição a um administrador em Configurações › Permissões."
              : "Você não trabalha neste ambiente. Peça a um administrador em Configurações › Permissões.",
          ambiente,
          nivel,
        });
        return;
      }
    }

    if (!modulo) {
      next();
      return;
    }

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
