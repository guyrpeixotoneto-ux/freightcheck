/**
 * O bridge desceu e ainda não subiu — dito pelo banco, não deduzido.
 *
 * ---------------------------------------------------------------------------
 * O buraco que este marcador fecha
 * ---------------------------------------------------------------------------
 * `bridgeDown` remove objetos que as migrations criam e **não toca no
 * registro**, pelo motivo escrito em `bridge.ts`. `runMigrations` pula toda
 * migration já registrada. Some-se: depois de um `down`, só o `up` devolve
 * aqueles objetos — a fila estruturalmente não consegue.
 *
 * A `0024_reconciliar_bridge` conserta os bancos que já estão nesse estado, e
 * conserta uma vez: ela tem um `when`, entra no registro, e o próximo `down`
 * sem `up` volta a ser irrecuperável pela fila. O que faltava não era mais uma
 * migration — era o banco **saber** que está no meio de um bridge.
 *
 * Sem isto, um bridge pela metade é indistinguível de um banco saudável por
 * qualquer coisa que se pergunte de fora: a contagem de migrations fecha, o
 * `/healthz` responde SAUDAVEL, e a primeira notícia é uma tela em 500 —
 * às vezes semanas depois, quando alguém abre a única tela que lê a coluna que
 * sumiu. Foi assim em 16/08/2026.
 *
 * ---------------------------------------------------------------------------
 * Três decisões
 * ---------------------------------------------------------------------------
 * **Mora no schema `drizzle`.** É estado de operação sobre o schema, e fica ao
 * lado do outro — e, o que decide: `bridgeDown` só mexe em `public`, então o
 * marcador não corre risco de ser removido pela própria operação que ele
 * descreve.
 *
 * **É escrito dentro da transação do bridge.** O `down` inteiro é uma
 * transação — "ou o bridge inteiro entra, ou nada entra". O marcador entra com
 * ela: um `down` que aborta não deixa marcador, e um `down` que entra não tem
 * como deixar de deixá-lo. Um marcador escrito depois do `COMMIT` seria uma
 * segunda verdade, capaz de discordar da primeira exatamente na janela em que
 * alguém precisaria dele.
 *
 * **Ler nunca quebra.** Num banco que nunca viu um bridge a tabela não existe,
 * e perguntar por ela levantaria um erro que se leria como "o banco caiu" —
 * dentro de `/healthz`, que é a rota que existe para responder isso. Por isso a
 * leitura pergunta antes ao `to_regclass`, do mesmo jeito que `observarBanco`
 * já faz com `public.import_run`.
 */

/** Criado pelo `down`, no momento em que ele precisa escrever. */
export const CRIAR_MARCADOR: readonly string[] = [
  `CREATE SCHEMA IF NOT EXISTS "drizzle"`,
  `CREATE TABLE IF NOT EXISTS "drizzle"."bridge_estado" (
     id integer PRIMARY KEY,
     descido_em timestamptz NOT NULL DEFAULT now(),
     itens jsonb,
     CONSTRAINT bridge_estado_linha_unica CHECK (id = 1)
   )`,
];

/**
 * Uma linha só, sempre a mesma.
 *
 * Dois `down` seguidos sem `up` no meio não são dois bridges pendentes — são um
 * bridge pendente, e a data que importa é a do último. O `CHECK (id = 1)` torna
 * "duas linhas" irrepresentável em vez de improvável.
 */
export const MARCAR_DESCIDA = `
  INSERT INTO "drizzle"."bridge_estado" (id, descido_em, itens)
       VALUES (1, now(), $1::jsonb)
  ON CONFLICT (id) DO UPDATE
          SET descido_em = now(), itens = EXCLUDED.itens`;

/**
 * O `up` limpa. Não é histórico: é "há um bridge pendente agora".
 *
 * **Apagar segue a mesma regra de ler: nunca quebra.** Num banco que nunca viu
 * um bridge a tabela não existe, e um `DELETE` cru ali levanta
 * `relation "drizzle.bridge_estado" does not exist` — no último passo do `up`,
 * depois de ele ter montado a restauração inteira, e dentro da transação dele,
 * o que derruba junto tudo o que ele acabou de restaurar. O `up` é idempotente
 * de propósito, para poder ser rodado por quem está na dúvida se há bridge
 * pendente; abortar justamente na resposta "não há" é o oposto disso.
 *
 * A suíte não pegava porque o caso só aparece onde nenhum `down` jamais rodou:
 * depois de um `down` a tabela fica de pé (o `DELETE` tira a linha, não a
 * tabela), e é por isso que "rodar o `up` duas vezes" passava.
 */
export const LIMPAR_MARCADOR = `
  DO $limpar$
  BEGIN
    IF to_regclass('drizzle.bridge_estado') IS NOT NULL THEN
      DELETE FROM "drizzle"."bridge_estado";
    END IF;
  END $limpar$`;

/** Há um bridge pendente neste banco, e desde quando. */
export interface BridgePendente {
  pendente: boolean;
  /** ISO-8601. Ausente quando não há bridge pendente. */
  desde?: string;
  /** O que o `down` removeu, como ele mesmo relatou. */
  itens?: string[];
}

type Consulta = (
  sql: string,
) => Promise<{ rows: Record<string, unknown>[] }>;

/**
 * Pergunta ao banco se há um bridge pendente.
 *
 * Recebe a função de consulta em vez de uma conexão para servir aos três
 * chamadores sem que nenhum precise do driver do outro: o `pg.Pool` do bridge,
 * o `db.execute` do drizzle no servidor, e o cliente cru dos testes.
 */
export async function bridgePendente(
  consultar: Consulta,
): Promise<BridgePendente> {
  const existe = await consultar(
    `SELECT to_regclass('drizzle.bridge_estado') IS NOT NULL AS existe`,
  );
  if (!existe.rows[0]?.["existe"]) return { pendente: false };

  const { rows } = await consultar(
    `SELECT descido_em, itens FROM "drizzle"."bridge_estado" WHERE id = 1`,
  );
  const linha = rows[0];
  if (!linha) return { pendente: false };

  const descidoEm = linha["descido_em"];
  const itens = linha["itens"];
  return {
    pendente: true,
    ...(descidoEm instanceof Date
      ? { desde: descidoEm.toISOString() }
      : typeof descidoEm === "string"
        ? { desde: descidoEm }
        : {}),
    ...(Array.isArray(itens) ? { itens: itens.map(String) } : {}),
  };
}
