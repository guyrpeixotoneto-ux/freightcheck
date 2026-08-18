import { eq, sql } from "drizzle-orm";
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
  children?: TaxonomySeedNode[];
}

/**
 * A árvore inicial — **puramente semântica**.
 *
 * Ela responde uma pergunta só: *o que este atributo é*. Não responde se ele é
 * custo fixo ou variável, nem em que linha da DRE ele cai; essas duas são
 * respondidas em outro lugar, de propósito.
 *
 * **Por que a raiz se chama "Natureza do atributo".** Ela se chamava
 * "Remuneração", que é o nome do domínio, e uma árvore que começa no nome do
 * domínio já chega enviesada: sob "Remuneração" as classes eram Custo Fixo,
 * Custo Variável e Cadastral — três recortes de custo e nenhum de receita, numa
 * árvore cujo próprio nome falava de receita. O lado que a Ambev paga não tinha
 * casa. A raiz agora diz o que a árvore responde, e o que era classe de custo
 * virou família de natureza.
 *
 * **Por que nenhum nó declara classe de custo.** Porque a classe não é
 * propriedade da natureza: *Pessoal e encargos* é custo fixo quando o valor
 * descreve o cavalo e custo variável quando descreve o trecho, e *Pedágio* é
 * custo variável numa operação e repasse contratual em outra. Com a classe no
 * nó, cada uma dessas naturezas precisaria de dois nós, e "o que é isto?"
 * passaria a ter duas respostas conforme o contexto. `cost_class` mora em
 * `attribute_semantics` desde a migration 0030 — versionada, com autor e data,
 * e livre para variar por atributo sem custar um nó.
 *
 * A regra que este arquivo existe para manter: **redesenhar a DRE amanhã não
 * muda a taxonomia dos atributos.**
 *
 * Deliberadamente rasa: guarda as naturezas que o vocabulário do próprio export
 * sustenta e para aí. Preencher as folhas é trabalho de curadoria, feito um
 * atributo por vez com os valores à vista.
 */
export const DEFAULT_TAXONOMY: TaxonomySeedNode = {
  code: "natureza",
  name: "Natureza do atributo",
  kind: "ROOT",
  children: [
    {
      code: "cadastro",
      name: "Cadastro e identificação",
      kind: "CLASS",
      children: [
        { code: "cad_identificacao", name: "Identificação do ativo", kind: "GROUP" },
        { code: "cad_escopo", name: "Escopo organizacional", kind: "GROUP" },
        { code: "cad_contrato", name: "Contrato e vigência", kind: "GROUP" },
        { code: "cad_especificacao", name: "Especificação técnica", kind: "GROUP" },
      ],
    },
    {
      code: "frota",
      name: "Frota e equipamento",
      kind: "CLASS",
      children: [
        { code: "cf_frota_cavalo", name: "Frota — Cavalo", kind: "GROUP" },
        { code: "cf_frota_carreta", name: "Frota — Carreta", kind: "GROUP" },
        { code: "frota_locacao", name: "Locação de equipamento", kind: "GROUP" },
        { code: "frota_itens_obrigatorios", name: "Itens obrigatórios do implemento", kind: "GROUP" },
        { code: "cf_outros", name: "Outros do ativo", kind: "GROUP" },
      ],
    },
    {
      code: "operacao",
      name: "Consumo e operação",
      kind: "CLASS",
      children: [
        { code: "cv_combustivel", name: "Combustível", kind: "GROUP" },
        { code: "op_arla", name: "Arla", kind: "GROUP" },
        { code: "cv_pneus", name: "Pneus", kind: "GROUP" },
        { code: "cv_manutencao", name: "Manutenção", kind: "GROUP" },
        { code: "op_lavagem", name: "Lavagem e lubrificação", kind: "GROUP" },
        { code: "op_pedagio", name: "Pedágio", kind: "GROUP" },
        { code: "cv_outros", name: "Outros da operação", kind: "GROUP" },
      ],
    },
    {
      code: "pessoal",
      name: "Pessoal",
      kind: "CLASS",
      children: [
        { code: "cf_pessoal", name: "Pessoal e encargos", kind: "GROUP" },
      ],
    },
    {
      code: "protecao",
      name: "Proteção e conformidade",
      kind: "CLASS",
      children: [
        { code: "cf_seguros_tributos", name: "Seguro do ativo", kind: "GROUP" },
        { code: "prot_seguro_carga", name: "Seguro de carga", kind: "GROUP" },
        { code: "prot_rastreamento", name: "Rastreamento e telemetria", kind: "GROUP" },
      ],
    },
    {
      code: "tributos",
      name: "Tributos e taxas",
      kind: "CLASS",
      children: [
        { code: "trib_prestacao", name: "Tributos sobre a prestação", kind: "GROUP" },
        { code: "trib_ipva_licenciamento", name: "IPVA e licenciamento", kind: "GROUP" },
      ],
    },
    {
      code: "capital",
      name: "Capital e financiamento",
      kind: "CLASS",
      children: [
        { code: "cf_financiamento", name: "Financiamento e juros", kind: "GROUP" },
        { code: "cf_depreciacao", name: "Depreciação e amortização", kind: "GROUP" },
        { code: "cap_premissas_financiamento", name: "Premissas de financiamento", kind: "GROUP" },
        { code: "cap_valor_aquisicao", name: "Valor de aquisição do ativo", kind: "GROUP" },
      ],
    },
    {
      code: "remuneracao_transportador",
      name: "Remuneração ao transportador",
      kind: "CLASS",
      children: [
        { code: "rem_fixa", name: "Remuneração fixa", kind: "GROUP" },
        { code: "cf_remuneracao_capital", name: "Remuneração de capital", kind: "GROUP" },
        { code: "rem_variavel", name: "Remuneração variável", kind: "GROUP" },
        { code: "cv_lucro_variavel", name: "Lucro variável", kind: "GROUP" },
        { code: "rem_frete_trecho", name: "Frete do trecho", kind: "GROUP" },
      ],
    },
    {
      code: "direcionador",
      name: "Direcionador operacional",
      kind: "CLASS",
      children: [
        { code: "dir_distancia", name: "Distância", kind: "GROUP" },
        { code: "dir_tempo", name: "Tempo e jornada", kind: "GROUP" },
        { code: "dir_ciclo", name: "Ciclo e frequência", kind: "GROUP" },
        { code: "dir_capacidade", name: "Capacidade", kind: "GROUP" },
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
    sortOrder: number,
  ): Promise<void> {
    const path = parentPath === "" ? node.code : `${parentPath}/${node.code}`;

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
      await walk(child, id, path, depth + 1, childOrder++);
    }
  }

  await walk(root, null, "", 0, 0);
  return { created, existing };
}

/**
 * O padrão de classe de custo que cada família sugere.
 *
 * Mora aqui, ao lado da árvore, porque é uma leitura **da** árvore: dizer que
 * tudo em `operacao` tende a ser custo variável é a mesma espécie de afirmação
 * que pôr combustível dentro de `operacao`. E mora em `@workspace/db` pelo
 * motivo de sempre nesta casa — quem precisa dela é a **importação**, que não
 * pode importar a curadoria.
 *
 * É um padrão, e não uma regra: a classe é do atributo, e é justamente por isso
 * que `cavalo.pessoal` pode ser fixo e `trecho.pessoal` variável apontando para
 * o mesmo nó. O padrão existe para que 138 colunas não nasçam sem classe e
 * sumam das telas de custo enquanto ninguém as visita uma a uma.
 *
 * `remuneracao_transportador` sai NAO_APLICAVEL de propósito: é receita, e
 * carimbá-la de custo a poria do lado errado de toda conta.
 */
export const CLASSE_PADRAO_DA_FAMILIA: Record<string, string> = {
  operacao: "VARIAVEL",
  pessoal: "VARIAVEL",
  frota: "FIXO",
  protecao: "FIXO",
  tributos: "FIXO",
  capital: "FIXO",
  cadastro: "NAO_APLICAVEL",
  direcionador: "NAO_APLICAVEL",
  remuneracao_transportador: "NAO_APLICAVEL",
};

/**
 * Garantir que todo atributo classificado tenha uma classe de custo.
 *
 * Estrutural, como a árvore e as confirmações canônicas, e pelo mesmo teste:
 * sem isto, um atributo que nasce CONFIRMED pelas confirmações canônicas —
 * `cavalo.ipva_licenciamento` é um — fica com `cost_class` nula para sempre,
 * porque a passada de propostas só olha o que **não** está confirmado. Nula, ele
 * some das telas de custo fixo e variável e da DRE sem uma linha de erro.
 *
 * Só preenche o que está vazio. Quem decidiu a classe tem valor gravado, e o
 * `IS NULL` não o alcança: a máquina preenche o branco e nunca reescreve o que
 * alguém assinou.
 */
export async function garantirClasseDeCustoPadrao(
  db: Database,
): Promise<{ preenchidos: number }> {
  let preenchidos = 0;
  for (const [familia, classe] of Object.entries(CLASSE_PADRAO_DA_FAMILIA)) {
    const atributos = await db.execute(sql`
      UPDATE attribute a
         SET cost_class = ${classe}
        FROM taxonomy_node n
       WHERE n.id = a.taxonomy_node_id
         AND a.cost_class IS NULL
         AND split_part(n.path, '/', 2) = ${familia}
    `);
    await db.execute(sql`
      UPDATE attribute_semantics v
         SET cost_class = ${classe}
        FROM taxonomy_node n
       WHERE n.id = v.taxonomy_node_id
         AND v.effective_until IS NULL
         AND v.cost_class IS NULL
         AND split_part(n.path, '/', 2) = ${familia}
    `);
    preenchidos += atributos.rowCount ?? 0;
  }
  return { preenchidos };
}
