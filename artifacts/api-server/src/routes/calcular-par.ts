import { Router, type IRouter } from "express";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  computeChangeSet,
  getChangeSetForPair,
  operacaoDoSnapshot,
} from "@workspace/comparison";
import { classificarFalha } from "../lib/classificar-falha";
import { exigirOperacaoDoRecurso } from "../lib/operacao";

/**
 * CALCULAR UM PAR — a lacuna virando comparação, por um gesto de quem lê.
 *
 * ---------------------------------------------------------------------------
 * Por que isto é uma rota, e não um `??` dentro de uma leitura
 * ---------------------------------------------------------------------------
 * As auditorias calculam a comparação que falta no meio da própria consulta
 * (`getChangeSetForPair(...) ?? computeChangeSet(...)`), e ali isso é certo: a
 * pessoa pediu **aquele** par, e esperar por ele é o que ela veio fazer.
 *
 * A tela de últimas alterações não pode fazer o mesmo. Ela olha até doze pares
 * por cobertura, e calcular os que faltam na abertura transformaria um clique no
 * menu em minutos de motor — às vezes para descobrir que nada mudou. Então a
 * varredura só **lê**, e o par sem comparação volta como lacuna, com esta rota do
 * outro lado do botão.
 *
 * ---------------------------------------------------------------------------
 * As três garantias que um botão de cálculo precisa dar
 * ---------------------------------------------------------------------------
 * 1. **Permissão.** As duas pontas passam por `exigirOperacaoDoRecurso`, como em
 *    `/consolidado`: um id de vigência não diz de que operação veio, e um link
 *    antigo não pode mandar a rota comparar o acervo de outra.
 * 2. **Concorrência.** Dois cliques ao mesmo tempo no mesmo par — duas abas, ou
 *    dois cartões da mesma cobertura — chegariam aqui juntos, os dois não
 *    achariam comparação e os dois gravariam uma. Um `pg_advisory_xact_lock` na
 *    chave do par serializa os dois; o segundo entra depois do primeiro ter
 *    gravado, e encontra o trabalho feito.
 * 3. **Idempotência.** Dentro do lock a pergunta é refeita: comparação já `DONE`
 *    volta como está, sem recalcular e sem `force`. Recalcular à toa apagaria e
 *    regravaria milhares de linhas por um duplo clique.
 */

const router: IRouter = Router();

/**
 * A chave de lock de um par — 63 bits estáveis, derivados dos dois ids.
 *
 * `pg_advisory_xact_lock` aceita um `bigint`, e o que se quer é que o **mesmo
 * par** caia sempre na mesma chave e pares diferentes quase nunca colidam. Um
 * hash dos dois ids em ordem dá as duas coisas; uma colisão eventual só faria
 * dois pares diferentes se esperarem, que é lento e nunca errado.
 */
export function chaveDeLockDoPar(baseId: string, comparadaId: string): bigint {
  const hash = createHash("sha256").update(`${baseId}${comparadaId}`).digest();
  /* O bit de sinal sai: `bigint` do Postgres é assinado, e uma chave negativa
     funcionaria, mas atrapalha quem for ler `pg_locks` procurando a nossa. */
  return hash.readBigUInt64BE(0) & 0x7fffffffffffffffn;
}

/**
 * `POST /alteracoes-por-modulo/calcular`
 *
 * Corpo: `{ baseId, comparadaId }` — as duas pontas da lacuna, exatamente como a
 * varredura as publicou. Devolve o `changeSetId`, e diz se ele já existia.
 */
router.post("/alteracoes-por-modulo/calcular", async (req, res, next): Promise<void> => {
  const { baseId, comparadaId } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof baseId !== "string" || typeof comparadaId !== "string" || !baseId || !comparadaId) {
    res.status(400).json({ error: "Informe baseId e comparadaId." });
    return;
  }

  for (const id of [baseId, comparadaId]) {
    await exigirOperacaoDoRecurso(req, "vigência", id, () => operacaoDoSnapshot(db, id));
  }

  try {
    const resultado = await db.transaction(async (tx) => {
      /*
        O lock é de **transação**: ele cai sozinho no commit ou no rollback, e
        não deixa cadeado pendurado se o cálculo estourar no meio.
      */
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${chaveDeLockDoPar(baseId, comparadaId)})`);

      /* Dentro do lock, a pergunta é refeita: quem chegou em segundo encontra o
         trabalho do primeiro, e não recalcula nada. */
      const existente = await getChangeSetForPair(tx, baseId, comparadaId);
      if (existente && existente.status === "DONE") {
        return { changeSetId: existente.id, jaExistia: true };
      }

      const set = await computeChangeSet(tx, baseId, comparadaId, {
        computedBy: "api:ultimas-alteracoes",
      });
      return { changeSetId: set.id, jaExistia: false };
    });

    res.json(resultado);
  } catch (err) {
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
      return;
    }
    req.log.warn({ err }, "Cálculo de par recusado");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

export default router;
