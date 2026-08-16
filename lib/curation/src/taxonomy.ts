import { eq, isNull } from "drizzle-orm";
import {
  comoAutoridade,
  curationEventTable,
  taxonomyNodeTable,
  type Database,
} from "@workspace/db";

/**
 * The remuneration hierarchy.
 *
 * Depth is free by design: `REMUNERAÇÃO → CUSTO FIXO → Frota — Cavalo →
 * Depreciação` is four levels today and may be six tomorrow without a
 * migration. What a node declares is its cost class; descendants inherit it
 * from the nearest ancestor that does.
 */

export interface TaxonomySeedNode {
  code: string;
  name: string;
  kind: "ROOT" | "CLASS" | "GROUP" | "SUBGROUP";
  costClass?: "FIXO" | "VARIAVEL";
  children?: TaxonomySeedNode[];
}

/**
 * The starting tree.
 *
 * Deliberately shallow and generic: it holds the classes and the groups the
 * export's own vocabulary supports (frota, combustível, manutenção, pneus,
 * pessoal...), and stops there. Filling the leaves is curation work, done one
 * attribute at a time with the values in view — not a structure invented up
 * front and then bent to fit.
 */
export const DEFAULT_TAXONOMY: TaxonomySeedNode = {
  code: "remuneracao",
  name: "Remuneração",
  kind: "ROOT",
  children: [
    {
      code: "custo_fixo",
      name: "Custo Fixo",
      kind: "CLASS",
      costClass: "FIXO",
      children: [
        { code: "cf_frota_cavalo", name: "Frota — Cavalo", kind: "GROUP" },
        { code: "cf_frota_carreta", name: "Frota — Carreta", kind: "GROUP" },
        { code: "cf_financiamento", name: "Financiamento e juros", kind: "GROUP" },
        { code: "cf_depreciacao", name: "Depreciação e amortização", kind: "GROUP" },
        { code: "cf_remuneracao_capital", name: "Remuneração de capital", kind: "GROUP" },
        { code: "cf_seguros_tributos", name: "Seguros e tributos", kind: "GROUP" },
        { code: "cf_pessoal", name: "Pessoal e encargos", kind: "GROUP" },
        { code: "cf_outros", name: "Outros custos fixos", kind: "GROUP" },
      ],
    },
    {
      code: "custo_variavel",
      name: "Custo Variável",
      kind: "CLASS",
      costClass: "VARIAVEL",
      children: [
        { code: "cv_combustivel", name: "Combustível", kind: "GROUP" },
        { code: "cv_manutencao", name: "Manutenção", kind: "GROUP" },
        { code: "cv_pneus", name: "Pneus", kind: "GROUP" },
        { code: "cv_lucro_variavel", name: "Lucro variável", kind: "GROUP" },
        { code: "cv_outros", name: "Outros custos variáveis", kind: "GROUP" },
      ],
    },
    {
      /**
       * Not every column is a cost. Chassis, model, year and the like describe
       * the asset; they belong in the tree so nothing sits unclassified, but
       * they carry no cost class and never enter an aggregation.
       */
      code: "cadastral",
      name: "Cadastral (não remuneratório)",
      kind: "CLASS",
      children: [
        { code: "cad_identificacao", name: "Identificação do ativo", kind: "GROUP" },
        { code: "cad_escopo", name: "Escopo organizacional", kind: "GROUP" },
        { code: "cad_contrato", name: "Contrato e vigência", kind: "GROUP" },
        { code: "cad_especificacao", name: "Especificação técnica", kind: "GROUP" },
      ],
    },
    {
      code: "nao_classificado",
      name: "Não classificado",
      kind: "CLASS",
      children: [],
    },
  ],
};

export interface SeedTaxonomyResult {
  created: number;
  existing: number;
}

/**
 * Create the tree if it is not there yet. Idempotent: re-running adds only
 * what is missing and never rewrites an existing node.
 */
export function seedTaxonomy(
  db: Database,
  actor: string,
  root: TaxonomySeedNode = DEFAULT_TAXONOMY,
): Promise<SeedTaxonomyResult> {
  /* Semear a árvore de remuneração é decisão de curadoria — ver `autoridade.ts`. */
  return comoAutoridade("CURADORIA", () => semearSobAutoridade(db, actor, root));
}

async function semearSobAutoridade(
  db: Database,
  actor: string,
  root: TaxonomySeedNode,
): Promise<SeedTaxonomyResult> {
  let created = 0;
  let existing = 0;

  async function walk(
    node: TaxonomySeedNode,
    parentId: string | null,
    parentPath: string,
    depth: number,
    inheritedCostClass: string | null,
    sortOrder: number,
  ): Promise<void> {
    const path = parentPath === "" ? node.code : `${parentPath}/${node.code}`;
    const costClass = node.costClass ?? inheritedCostClass;

    const [found] = await db
      .select()
      .from(taxonomyNodeTable)
      .where(eq(taxonomyNodeTable.code, node.code));

    let id: string;
    if (found) {
      existing++;
      id = found.id;
    } else {
      const [inserted] = await db
        .insert(taxonomyNodeTable)
        .values({
          parentId,
          code: node.code,
          name: node.name,
          kind: node.kind,
          costClass: node.costClass ?? null,
          path,
          depth,
          sortOrder,
        })
        .returning();
      id = inserted.id;
      created++;
      await db.insert(curationEventTable).values({
        targetKind: "TAXONOMY_NODE",
        targetId: id,
        targetLabel: node.code,
        field: "created",
        valueBefore: null,
        valueAfter: path,
        actor,
        reason: "Estrutura inicial da taxonomia.",
      });
    }

    let childOrder = 0;
    for (const child of node.children ?? []) {
      await walk(child, id, path, depth + 1, costClass, childOrder++);
    }
  }

  await walk(root, null, "", 0, null, 0);
  return { created, existing };
}

export interface TaxonomyNodeView {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  kind: string;
  /** Declared here, or inherited from the nearest ancestor that declares it. */
  costClass: string | null;
  path: string;
  depth: number;
  children: TaxonomyNodeView[];
}

/** Read the whole tree, with cost class resolved through inheritance. */
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
      costClass: node.costClass,
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
    if (view.costClass === null) view.costClass = parent.costClass;
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
