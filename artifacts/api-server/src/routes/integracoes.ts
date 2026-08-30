import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  CATALOGO_DE_ESCOPOS,
  RecusaDeIntegracao,
  conferirDadosDaIntegracao,
  ehEscopo,
  type Escopo,
} from "@workspace/integrations";
import {
  ajustarIntegracao,
  criarIntegracao,
  emitirChaveDaIntegracao,
  listarChamadas,
  listarIntegracoes,
  revogarChave,
} from "../lib/integracoes";
import { contextoDeSchema } from "../middlewares/contexto-de-schema";

/**
 * INTEGRAÇÕES — a gestão da porta de API, vista de dentro.
 *
 * Esta superfície é a **administrativa**: quem tem sessão cria integração,
 * emite chave, revoga chave e lê o log de chamadas. A porta em si — o que os
 * sistemas externos chamam — é outra, mora em `routes/v1.ts` e é autenticada
 * por chave, nunca por sessão. Duas superfícies, e a separação é o desenho:
 * uma chave de integração jamais administra integrações, e uma sessão de
 * pessoa jamais é aceita como credencial de máquina.
 *
 * Nenhum `try/catch` aqui, como no resto do servidor: as recusas do domínio
 * (`RecusaDeIntegracao` e filhas) sobem e são traduzidas em
 * `lib/recusa-de-dominio.ts`, e o 5xx é do contrato. Ver
 * `__tests__/o-contrato-cobre-todas-as-rotas.test.ts`.
 */
const router: IRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.use(
  "/integracoes",
  contextoDeSchema(
    "Integrações não tem onde guardar as chaves nem o log de chamadas: as " +
      "tabelas que a migration 0082_integracoes cria não existem neste banco.",
  ),
);

/** Quem está fazendo isto — o mesmo `actor` que o resto do produto grava. */
function autor(req: { user?: { email: string } }): string {
  /*
    A sessão é obrigatória em toda rota deste router (`requireSession`, montado
    antes das rotas em `app.ts`), então este `??` não deveria acontecer. Ele
    existe porque o campo é gravado para sempre: um autor vazio no histórico de
    quem emitiu uma credencial é pior do que um marcador que denuncia o buraco.
  */
  return req.user?.email ?? "desconhecido";
}

function exigirUuid(valor: string, oQue: string): string {
  if (!UUID.test(valor)) {
    throw new RecusaDeIntegracao(`Identificador de ${oQue} inválido.`);
  }
  return valor;
}

/**
 * A lista, com o catálogo de escopos junto.
 *
 * O catálogo vem na mesma resposta em vez de a tela ter a própria cópia. É a
 * mesma decisão de `/fluxos/catalogo`, e existe pelo mesmo defeito: um escopo
 * novo que aparece no servidor e não aparece na tela de emissão porque duas
 * listas existiam e só uma foi atualizada.
 */
router.get("/integracoes", async (_req, res): Promise<void> => {
  res.json({
    escopos: CATALOGO_DE_ESCOPOS,
    integracoes: await listarIntegracoes(db),
  });
});

router.post("/integracoes", async (req, res): Promise<void> => {
  const dados = conferirDadosDaIntegracao(req.body);
  const criada = await criarIntegracao(db, { ...dados, por: autor(req) });
  res.status(201).json(criada);
});

/**
 * Desativar e reativar, num endereço que nomeia o que faz.
 *
 * Não é `PATCH /integracoes/:id` com um objeto de campos: desligar a porta de
 * um sistema externo é um ato, não uma edição, e um ato precisa ser
 * alcançável de um jeito só. Ver a nota equivalente em `routes/fluxos.ts`.
 */
router.post("/integracoes/:id/ativacao", async (req, res): Promise<void> => {
  const id = exigirUuid(req.params.id, "integração");
  const { ativa } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof ativa !== "boolean") {
    throw new RecusaDeIntegracao("Diga se a integração fica ativa: { ativa: true|false }.");
  }
  await ajustarIntegracao(db, id, ativa, autor(req));
  res.status(204).end();
});

/**
 * Emite uma chave — e é a única resposta deste produto que traz um segredo.
 *
 * Ela sai **uma vez**. Não há rota que releia uma chave emitida, e não é
 * esquecimento: o banco guarda só o hash, então nem esta rota teria como
 * responder. Quem perdeu emite outra e revoga a anterior.
 */
router.post("/integracoes/:id/chaves", async (req, res): Promise<void> => {
  const id = exigirUuid(req.params.id, "integração");
  const { escopos, apelido } = (req.body ?? {}) as Record<string, unknown>;

  if (!Array.isArray(escopos) || escopos.length === 0) {
    throw new RecusaDeIntegracao(
      "Uma chave precisa de pelo menos um escopo — uma chave que não alcança " +
        "nada não serve para nada, e uma que alcança tudo é o que este " +
        "desenho existe para evitar.",
    );
  }
  const desconhecidos = escopos.filter((e) => !ehEscopo(e));
  if (desconhecidos.length > 0) {
    throw new RecusaDeIntegracao(
      `Escopo desconhecido: ${desconhecidos.map(String).join(", ")}. Os que ` +
        `existem são ${CATALOGO_DE_ESCOPOS.map((d) => d.escopo).join(", ")}.`,
    );
  }

  const apelidoLimpo =
    typeof apelido === "string" && apelido.trim() !== "" ? apelido.trim().slice(0, 120) : null;

  const emitida = await emitirChaveDaIntegracao(db, id, {
    escopos: escopos as Escopo[],
    apelido: apelidoLimpo,
    por: autor(req),
  });
  res.status(201).json(emitida);
});

/**
 * Revogar. O endereço fala da chave, e não da integração, porque é a chave que
 * está sendo desligada — e porque quem revoga às pressas tem na mão o prefixo
 * que apareceu num log, não o id da integração.
 */
router.post("/integracoes/chaves/:chaveId/revogacao", async (req, res): Promise<void> => {
  const chaveId = exigirUuid(req.params.chaveId, "chave");
  await revogarChave(db, chaveId, autor(req));
  res.status(204).end();
});

/** O log de chamadas de uma integração — as mais recentes primeiro. */
router.get("/integracoes/:id/chamadas", async (req, res): Promise<void> => {
  const id = exigirUuid(req.params.id, "integração");
  const limite = Number.parseInt(String(req.query.limite ?? "100"), 10);
  res.json(await listarChamadas(db, id, Number.isFinite(limite) ? limite : 100));
});

export default router;
