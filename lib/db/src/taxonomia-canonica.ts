import { eq } from "drizzle-orm";
import type { Database } from "./index";
import { curationEventTable, taxonomyNodeTable } from "./schema";

/**
 * A árvore da remuneração — **estrutura obrigatória do produto**, e por isso
 * daqui.
 *
 * A profundidade é livre por desenho: `REMUNERAÇÃO → CUSTO FIXO → Frota —
 * Cavalo → Depreciação` são quatro níveis hoje e podem ser seis amanhã sem
 * migration. O que um nó declara é a sua classe de custo; os descendentes a
 * herdam do ancestral mais próximo que a declara.
 *
 * **Por que mora em `@workspace/db`, ao lado de `semantica-confirmada.ts`.**
 * Esta árvore não é uma decisão por base nem por cliente: são os mesmos 22 nós
 * em toda instalação, e sem eles nem a máquina nem uma pessoa conseguem
 * classificar coisa alguma — o `<Select>` "Nó da taxonomia" da Curadoria é
 * populado a partir desta tabela, e árvore vazia é lista vazia. Quem precisa
 * dela são a **importação** (que a garante no momento em que os atributos
 * nascem) e a **curadoria** (que a lê e a mostra), dois pacotes que não podem
 * se importar. É a mesma fronteira, pelo mesmo motivo, de
 * `garantirSemanticaInicial` e `aplicarConfirmacoesCanonicas`.
 *
 * Medido em 17/08/2026, num banco vazio, importando pela mesma rota que a tela
 * chama: **zero nós** depois da promoção. O único caminho de produção que
 * semeava a árvore era um handler de `POST /imports/:id/promote` em
 * `overview.ts` que o Express nunca alcançava — `importsRouter` é montado
 * antes, e serve a rota. Com a árvore ausente, `cost_class` e `taxonomy_name`
 * saíam nulos em 267 de 267 linhas de comparação, e ficavam nulos para sempre,
 * porque as duas colunas são **gravadas** no momento em que a comparação é
 * calculada.
 *
 * O que **não** desceu para cá, de propósito: `runProposalPass`. Ele é
 * inferência — move atributos para PRESUMED e escreve a justificativa do
 * motor —, e inferência não é verdade estrutural. Classificar um atributo
 * continua sendo ato de curadoria, feito um a um com os valores à vista.
 */

export interface TaxonomySeedNode {
  code: string;
  name: string;
  kind: "ROOT" | "CLASS" | "GROUP" | "SUBGROUP";
  costClass?: "FIXO" | "VARIAVEL";
  children?: TaxonomySeedNode[];
}

/**
 * A árvore inicial.
 *
 * Deliberadamente rasa e genérica: guarda as classes e os grupos que o
 * vocabulário do próprio export sustenta (frota, combustível, manutenção,
 * pneus, pessoal…), e para aí. Preencher as folhas é trabalho de curadoria,
 * feito um atributo por vez com os valores à vista — não uma estrutura
 * inventada de antemão e depois torcida para caber.
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
       * Nem toda coluna é custo. Chassi, modelo, ano e afins descrevem o ativo;
       * ficam na árvore para que nada sobre sem lugar, mas não carregam classe
       * de custo e nunca entram numa agregação.
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

/** Quantos nós a árvore canônica tem. Contado da própria árvore, nunca à mão. */
export function contarNosCanonicos(root: TaxonomySeedNode = DEFAULT_TAXONOMY): number {
  return 1 + (root.children ?? []).reduce((n, c) => n + contarNosCanonicos(c), 0);
}

export interface SeedTaxonomyResult {
  created: number;
  existing: number;
}

/**
 * Garantir a árvore. Idempotente: uma segunda passada só acrescenta o que
 * falta e nunca reescreve um nó existente — que é o que permite chamá-la em
 * toda promoção sem que a segunda importação duplique nada.
 *
 * Recebe o ator porque a criação de um nó é registrada em `curation_event`, e
 * um evento sem autor não é auditável. Da importação vem o ator da promoção;
 * da tela, a pessoa.
 */
export async function garantirTaxonomiaCanonica(
  db: Database,
  actor: string,
  root: TaxonomySeedNode = DEFAULT_TAXONOMY,
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
