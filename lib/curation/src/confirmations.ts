import {
  aplicarConfirmacoesCanonicas,
  CONFIRMED_SEMANTICS,
  type ApplyConfirmationsResult,
  type ConfirmedSemantics,
  type Database,
} from "@workspace/db";

/**
 * O registro das confirmações canônicas — que **mora em `@workspace/db`**.
 *
 * Ele estava aqui, e ficar aqui era o defeito. Uma lista alcançável só pela
 * curadoria só é aplicada por quem chama a curadoria: o `dev-seed`, o
 * `curate-report` e os testes. Nenhum desses é o caminho por onde um arquivo
 * real entra no produto — e o resultado, medido contra o export de agosto/2026,
 * era uma frota inteira lida como "não apurado" com os valores intactos no
 * banco, esperando uma mão que não vinha. É a mesma classe de defeito que já
 * havia deixado a versão 1 da semântica órfã, e a correção é a mesma: a regra
 * desce para o piso que a importação e a curadoria pisam juntas.
 *
 * O que continua aqui é o endereço: `@workspace/curation` reexporta o registro
 * e a sua aplicação, de modo que `applyConfirmations` segue sendo o nome pelo
 * qual as ferramentas de curadoria o chamam. Uma lista, um escritor, dois
 * chamadores.
 */

export { CONFIRMED_SEMANTICS };
export type { ConfirmedSemantics, ApplyConfirmationsResult };

/**
 * Reaplicar o registro numa base. Idempotente — ver
 * {@link aplicarConfirmacoesCanonicas}.
 *
 * Numa base que recebeu qualquer importação depois desta correção, o esperado é
 * que **tudo** volte em `unchanged`: a promoção já aplicou. O valor de rodá-la à
 * mão passou a ser outro — completar bases antigas, e relatar divergências entre
 * o registro e o que uma pessoa confirmou na tela.
 */
export async function applyConfirmations(
  db: Database,
  registry: ConfirmedSemantics[] = CONFIRMED_SEMANTICS,
): Promise<ApplyConfirmationsResult> {
  return aplicarConfirmacoesCanonicas(db, registry);
}
