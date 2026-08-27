import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";

import { normalizarOperacao, type Operacao } from "./series";

/**
 * O recorte por operação para quem pergunta **por id**.
 *
 * `contextFilter` protege toda leitura que parte de um contexto — unidade,
 * canal, família, operação —, e é por onde passa a maior parte do produto. Mas
 * há um punhado de rotas que não perguntam por contexto: elas recebem o id do
 * recurso e vão direto a ele. `/change-sets/:id/changes`, `/changes/:id/provenance`,
 * `/coverage/cell/:snapshotId/:entityType`. Nessas, o recorte não tem onde
 * entrar — o id **é** o pedido.
 *
 * E é justamente por aí que um vazamento entraria sem passar por nenhuma tela:
 * um id de comparação da empurrada colado numa URL de rota — de um e-mail, de
 * um favorito antigo, de um link de quando as auditorias eram uma só — abriria
 * a lista de alterações da empurrada dentro do ambiente de rota, com o menu, o
 * nome e os totais dizendo "Rota". Nada na tela indicaria o engano.
 *
 * Aqui a regra é a mesma das outras, dita para o caso do id: **o recurso
 * pertence a uma operação, e quem pergunta de outra recebe uma recusa escrita.**
 * Recusa, e não lista vazia: a diferença entre "não existe" e "não é seu" é
 * exatamente o que quem colou o link precisa ler.
 */
export class RecursoDeOutraOperacaoError extends Error {
  constructor(
    /** `comparação`, `vigência`, `ativo` — como a frase o chama. */
    readonly recurso: string,
    readonly id: string,
    readonly operacaoDoRecurso: string | null,
    readonly operacaoPedida: Operacao,
  ) {
    super(
      `A ${recurso} ${id} é da operação ` +
        `${operacaoDoRecurso ?? "não identificada"}, e esta leitura é de ` +
        `${operacaoPedida}. Uma auditoria não lê o acervo de outra — abra o ` +
        `ambiente da operação a que ela pertence.`,
    );
    this.name = "RecursoDeOutraOperacaoError";
  }
}

/** A operação de uma vigência — a coluna canônica, direto. */
export async function operacaoDoSnapshot(
  db: Database,
  snapshotId: string,
): Promise<string | null> {
  const { rows } = await db.execute<{ canal: string }>(sql`
    SELECT canal FROM snapshot WHERE id = ${snapshotId}::uuid
  `);
  return rows[0]?.canal ?? null;
}

/**
 * A operação de uma comparação — a do lado B, que é o lado que ela descreve.
 *
 * Os dois lados são sempre da mesma operação: o motor recusa comparar canais
 * diferentes (`engine.ts`) e o canal entra na identidade canônica da vigência.
 * Ler um lado, então, é ler a comparação.
 */
export async function operacaoDoChangeSet(
  db: Database,
  changeSetId: string,
): Promise<string | null> {
  const { rows } = await db.execute<{ canal: string }>(sql`
    SELECT s.canal
      FROM change_set cs JOIN snapshot s ON s.id = cs.snapshot_b_id
     WHERE cs.id = ${changeSetId}::uuid
  `);
  return rows[0]?.canal ?? null;
}

/** A operação de uma alteração — a da comparação que a produziu. */
export async function operacaoDaAlteracao(
  db: Database,
  changeId: number,
): Promise<string | null> {
  const { rows } = await db.execute<{ canal: string }>(sql`
    SELECT s.canal
      FROM change c
      JOIN change_set cs ON cs.id = c.change_set_id
      JOIN snapshot s    ON s.id = cs.snapshot_b_id
     WHERE c.id = ${changeId}
  `);
  return rows[0]?.canal ?? null;
}

/**
 * As operações em que um ativo aparece.
 *
 * A entidade é a única coisa deste modelo que **atravessa** operações por
 * natureza: a mesma placa pode ser remunerada na empurrada e na rota, e a
 * identidade dela é o ativo físico, não o contrato. Por isso a pergunta aqui
 * não é "de qual operação ela é", e sim "em quais ela aparece" — e a recusa só
 * vale quando ela não aparece na que pergunta.
 */
export async function operacoesDaEntidade(
  db: Database,
  entityId: string,
): Promise<string[]> {
  const { rows } = await db.execute<{ canal: string }>(sql`
    SELECT DISTINCT s.canal
      FROM fact f JOIN snapshot s ON s.id = f.snapshot_id
     WHERE f.entity_id = ${entityId}::uuid
  `);
  return rows.map((r) => r.canal);
}

/**
 * Recusa o recurso que não é desta operação.
 *
 * Sem operação pedida não há o que conferir — quem não recorta lê tudo, que é a
 * regra de {@link operacaoFilter} dita para o caso do id. Recurso inexistente
 * também passa: quem responde "não encontrado" é a rota, com a mensagem dela, e
 * transformar um id que não existe numa recusa de operação diria a coisa errada.
 */
export function exigirOperacao(
  recurso: string,
  id: string,
  operacaoDoRecurso: string | null,
  operacaoPedida?: Operacao | null,
): void {
  const pedida = normalizarOperacao(operacaoPedida ?? null);
  if (pedida === null || operacaoDoRecurso === null) return;
  if (normalizarOperacao(operacaoDoRecurso) === pedida) return;
  throw new RecursoDeOutraOperacaoError(recurso, id, operacaoDoRecurso, pedida);
}

/** O mesmo, para o ativo que pode aparecer em mais de uma operação. */
export function exigirOperacaoEntreAsDaEntidade(
  entityId: string,
  operacoes: string[],
  operacaoPedida?: Operacao | null,
): void {
  const pedida = normalizarOperacao(operacaoPedida ?? null);
  if (pedida === null || operacoes.length === 0) return;
  if (operacoes.some((op) => normalizarOperacao(op) === pedida)) return;
  throw new RecursoDeOutraOperacaoError("ficha do ativo", entityId, operacoes[0], pedida);
}
