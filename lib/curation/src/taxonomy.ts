import { eq, isNull } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  DEFAULT_TAXONOMY,
  contarNosCanonicos,
  garantirTaxonomiaCanonica,
  taxonomyNodeTable,
  type SeedTaxonomyResult,
  type TaxonomySeedNode,
} from "@workspace/db";

/**
 * A taxonomia, do lado da curadoria: **ler e mostrar**.
 *
 * A árvore em si — os 22 nós e a função que os garante — mudou de casa para
 * `@workspace/db`, em `taxonomia-canonica.ts`. O motivo é o mesmo que já havia
 * levado `garantirSemanticaInicial` e as confirmações canônicas para lá: ela é
 * estrutura obrigatória do produto, precisa existir no instante em que os
 * atributos nascem, e quem a garante é a **importação** — um pacote que não
 * pode importar a curadoria.
 *
 * Enquanto morou aqui, nenhum caminho de produção a criava. Medido em
 * 17/08/2026, num banco vazio, importando pela rota que a tela chama: zero
 * nós. O `<Select>` "Nó da taxonomia" da Curadoria vem desta tabela — árvore
 * vazia é lista vazia, e nem a máquina nem uma pessoa conseguiam classificar
 * coisa alguma.
 *
 * O que continua sendo desta casa é a leitura: a árvore com a classe de custo
 * resolvida por herança, e a listagem plana que a tela usa.
 */

export { DEFAULT_TAXONOMY, contarNosCanonicos };
export type { TaxonomySeedNode, SeedTaxonomyResult };

/**
 * Semear a árvore — o mesmo ato, pelo nome que a curadoria sempre usou.
 *
 * Continua existindo porque as ferramentas de curadoria (`dev-seed`,
 * `curate-report`, a rota da passada de proposta) o chamam por este nome, e
 * porque semear à mão uma base antiga continua sendo legítimo. O que ele não é
 * mais é a **única** forma de a árvore existir.
 */
export async function seedTaxonomy(
  db: Database,
  actor: string,
  root: TaxonomySeedNode = DEFAULT_TAXONOMY,
): Promise<SeedTaxonomyResult> {
  return garantirTaxonomiaCanonica(db, actor, root);
}

export interface TaxonomyNodeView {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  kind: string;
  path: string;
  depth: number;
  children: TaxonomyNodeView[];
}

/**
 * A árvore inteira.
 *
 * Sem classe de custo: ela saiu da taxonomia na migration 0030 e virou coluna
 * do atributo. Um nó responde o que o valor é, e é só isso que esta leitura
 * devolve.
 */
export async function getTaxonomyTree(db: Database): Promise<TaxonomyNodeView[]> {
  const nodes = await db
    .select()
    .from(taxonomyNodeTable)
    .where(eq(taxonomyNodeTable.isActive, true))
    .orderBy(taxonomyNodeTable.depth, taxonomyNodeTable.sortOrder);

  const views = new Map<string, TaxonomyNodeView>();
  for (const node of nodes) {
    views.set(node.id, {
      id: node.id,
      parentId: node.parentId,
      code: node.code,
      name: node.name,
      kind: node.kind,
      path: node.path,
      depth: node.depth,
      children: [],
    });
  }

  const roots: TaxonomyNodeView[] = [];
  // Ordered by depth, so a parent is always resolved before its children.
  for (const node of nodes) {
    const view = views.get(node.id)!;
    if (node.parentId === null) {
      roots.push(view);
      continue;
    }
    const parent = views.get(node.parentId);
    if (!parent) continue;
    parent.children.push(view);
  }
  return roots;
}

/** Flat listing, useful for a select box. */
export async function listTaxonomyNodes(db: Database) {
  const tree = await getTaxonomyTree(db);
  const flat: TaxonomyNodeView[] = [];
  const walk = (nodes: TaxonomyNodeView[]) => {
    for (const node of nodes) {
      flat.push(node);
      walk(node.children);
    }
  };
  walk(tree);
  return flat;
}

/** Nodes that no attribute has been assigned to yet. */
export async function unusedLeafNodes(db: Database) {
  return db
    .select()
    .from(taxonomyNodeTable)
    .where(isNull(taxonomyNodeTable.parentId));
}
