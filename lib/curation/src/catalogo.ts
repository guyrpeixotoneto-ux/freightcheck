import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  attributeTable,
  curationEventTable,
  semanticMeaningTable,
  taxonomyNodeTable,
} from "@workspace/db";
import {
  COMO_ESCREVER,
  codigoDe,
  derivarSemantica,
  interpretarRotulo,
  normalizarRotulo,
  procurarProximos,
  SIGNIFICADOS_PADRAO,
  type Proximo,
  type Significado,
} from "./significado";

/**
 * O cadastro canônico — significados econômicos e categorias, criáveis sem
 * sair da tela.
 *
 * ---------------------------------------------------------------------------
 * Por que a criação mora aqui e não na rota
 * ---------------------------------------------------------------------------
 * Criar um significado tem cinco obrigações que não são de interface:
 * derivar os campos técnicos pela autoridade, recusar duplicata textual,
 * recusar duplicata **econômica** (`R$/litro` já existe como `R$ por litro`),
 * registrar autor e data, e gravar o evento de curadoria. Uma rota que fizesse
 * isso à mão teria uma sexta obrigação — a de não esquecer nenhuma das cinco —
 * e a CLI e os testes teriam a sua própria versão delas.
 *
 * ---------------------------------------------------------------------------
 * Criar nunca é o efeito colateral de digitar
 * ---------------------------------------------------------------------------
 * Nada aqui é chamado enquanto alguém escreve. {@link procurarSignificado} é o
 * que a busca do combobox usa, e ela **não escreve**; a criação é uma chamada
 * separada, disparada por um clique numa ação que diz o nome do que vai ser
 * criado. É o item 5.7 do pedido, e é o que impede o cadastro de encher de
 * digitações abandonadas.
 *
 * E ela é **idempotente sobre o que já existe**: pedir para criar algo que já
 * está cadastrado devolve o que existe, com `criado: false`. A tela seleciona
 * o encontrado e ninguém precisa entender o que aconteceu.
 */

/** O recorte do cadastro. Ver a nota sobre escopo em `schema/significado.ts`. */
export interface Escopo {
  scopeType: string;
  scopeCode: string;
}

export const ESCOPO_GLOBAL: Escopo = { scopeType: "GLOBAL", scopeCode: "*" };

/** Um significado como o cadastro o guarda, já com a derivação junto. */
export interface SignificadoCadastrado extends Significado {
  id: string;
  scopeType: string;
  scopeCode: string;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  isMonetary: boolean | null;
  currency: string | null;
  valueKind: string;
  denominator: string | null;
  isSeed: boolean;
  createdBy: string;
}

function paraSignificado(row: typeof semanticMeaningTable.$inferSelect): SignificadoCadastrado {
  return {
    id: row.id,
    scopeType: row.scopeType,
    scopeCode: row.scopeCode,
    code: row.code,
    label: row.label,
    forma: row.forma as Significado["forma"],
    base: row.base,
    unit: row.unit,
    periodicity: row.periodicity,
    aggregation: row.aggregation,
    isMonetary: row.isMonetary,
    currency: row.currency,
    valueKind: row.valueKind,
    denominator: row.denominator,
    isSeed: row.isSeed,
    createdBy: row.createdBy,
  };
}

/** O catálogo do escopo, em ordem de leitura. */
export async function listarSignificados(
  db: Database,
  escopo: Escopo = ESCOPO_GLOBAL,
): Promise<SignificadoCadastrado[]> {
  const rows = await db
    .select()
    .from(semanticMeaningTable)
    .where(
      and(
        eq(semanticMeaningTable.scopeType, escopo.scopeType),
        eq(semanticMeaningTable.scopeCode, escopo.scopeCode),
      ),
    )
    /*
      Montante primeiro, e dentro de cada forma pelo rótulo. Não é estética: as
      colunas que carregam dinheiro são as que travam a fila, e a lista abre no
      que vai ser escolhido em quatro de cada cinco confirmações.
    */
    .orderBy(
      sql`CASE ${semanticMeaningTable.forma}
            WHEN 'MONTANTE'  THEN 0
            WHEN 'TAXA'      THEN 1
            WHEN 'PROPORCAO' THEN 2
            WHEN 'CONSUMO'   THEN 3
            WHEN 'GRANDEZA'  THEN 4
            ELSE 5
          END`,
      asc(semanticMeaningTable.label),
    );
  return rows.map(paraSignificado);
}

/**
 * Garantir que o catálogo inicial existe no escopo pedido.
 *
 * A migration já o insere no escopo global — este caminho é o que serve um
 * escopo novo, os testes, e o banco que veio de antes. Idempotente: uma linha
 * que já existe pelo código não é reescrita, porque o rótulo pode ter sido
 * ajustado por quem opera e padronizá-lo de volta seria desfazer trabalho de
 * gente.
 */
export async function seedSignificados(
  db: Database,
  actor: string,
  escopo: Escopo = ESCOPO_GLOBAL,
): Promise<{ criados: number; existentes: number }> {
  const existentes = await listarSignificados(db, escopo);
  const porCodigo = new Set(existentes.map((s) => s.code));

  let criados = 0;
  for (const significado of SIGNIFICADOS_PADRAO) {
    if (porCodigo.has(significado.code)) continue;
    const derivada = derivarSemantica(significado);
    await db.insert(semanticMeaningTable).values({
      scopeType: escopo.scopeType,
      scopeCode: escopo.scopeCode,
      code: significado.code,
      label: significado.label,
      normalizedLabel: normalizarRotulo(significado.label),
      forma: significado.forma,
      base: significado.base,
      ...derivada,
      isSeed: true,
      createdBy: actor,
    });
    criados++;
  }
  return { criados, existentes: existentes.length };
}

/** Por que a criação não aconteceu, ou o que ela encontrou no lugar. */
export type DesfechoDaCriacao =
  /** Entrou no cadastro agora. */
  | "CRIADO"
  /** Já existia — pelo texto ou pela economia. O `item` é o que existe. */
  | "JA_EXISTE"
  /** A autoridade não soube traduzir o rótulo. Nada foi gravado. */
  | "NAO_ENTENDIDO";

export interface ResultadoDaCriacao<T> {
  desfecho: DesfechoDaCriacao;
  item: T | null;
  /** Frase pronta para a tela. Vazia quando `CRIADO`. */
  mensagem: string;
  /** O que já existia e se parece com o pedido — para a tela oferecer. */
  proximos: Proximo<T>[];
}

/**
 * Buscar significados, com o que existe de parecido em destaque.
 *
 * É o que alimenta o combobox: ele filtra localmente enquanto se digita, e
 * consulta isto para decidir se oferece **criar**. A pergunta que esta função
 * responde não é "quais casam com o texto" — é "existe alguma coisa que a
 * pessoa provavelmente quis dizer?", que é uma pergunta diferente e é a que
 * impede `combustivel` de virar um segundo `Combustível`.
 */
export async function procurarSignificado(
  db: Database,
  termo: string,
  escopo: Escopo = ESCOPO_GLOBAL,
): Promise<Proximo<SignificadoCadastrado>[]> {
  const catalogo = await listarSignificados(db, escopo);
  return procurarProximos(
    termo,
    catalogo,
    (s) => s.label,
    (s) => s.code,
  );
}

/**
 * Cadastrar um significado a partir do que a pessoa digitou.
 *
 * Três recusas, e nenhuma delas é arbitrária:
 *
 * 1. **Sem responsável.** Mesma regra da confirmação: um cadastro que ninguém
 *    assinou não é auditável, e este passa a decidir se uma coluna vira
 *    dinheiro.
 * 2. **Rótulo que a autoridade não traduz.** Cadastrá-lo criaria uma opção sem
 *    derivação — a pessoa escolheria, o botão habilitaria, e o atributo seria
 *    confirmado sem unidade e fora de qualquer soma. A recusa vem com o formato
 *    ({@link COMO_ESCREVER}), que é uma porta e não um muro.
 * 3. **Duplicata.** Pelo texto normalizado *ou* pelo código econômico. A
 *    segunda é a que importa: `R$/litro` e `R$ por litro` são rótulos
 *    diferentes e a mesma economia, e dois cadastros para ela seriam dois
 *    grupos que nenhuma tela conseguiria reconciliar depois.
 */
export async function criarSignificado(
  db: Database,
  entrada: { label: string; actor: string; escopo?: Escopo },
): Promise<ResultadoDaCriacao<SignificadoCadastrado>> {
  const escopo = entrada.escopo ?? ESCOPO_GLOBAL;
  if (!entrada.actor?.trim()) {
    throw new Error("Cadastrar um significado exige um responsável identificado.");
  }

  const catalogo = await listarSignificados(db, escopo);
  const proximos = procurarProximos(
    entrada.label,
    catalogo,
    (s) => s.label,
    (s) => s.code,
  );

  const jaExiste = proximos.find((p) => p.tipo === "IGUAL" || p.tipo === "EQUIVALENTE");
  if (jaExiste) {
    return {
      desfecho: "JA_EXISTE",
      item: jaExiste.item,
      mensagem:
        jaExiste.tipo === "IGUAL"
          ? `"${jaExiste.item.label}" já está no cadastro. Selecionado.`
          : `"${jaExiste.item.label}" já significa exatamente isso no cadastro. ` +
            `Dois cadastros para a mesma economia não teriam como ser reconciliados depois. Selecionado.`,
      proximos,
    };
  }

  const interpretado = interpretarRotulo(entrada.label);
  if (!interpretado) {
    return { desfecho: "NAO_ENTENDIDO", item: null, mensagem: COMO_ESCREVER, proximos };
  }

  const derivada = derivarSemantica(interpretado);
  const [linha] = await db
    .insert(semanticMeaningTable)
    .values({
      scopeType: escopo.scopeType,
      scopeCode: escopo.scopeCode,
      code: interpretado.code,
      // O rótulo é o que a pessoa escreveu, e não o do catálogo padrão: quem
      // digitou "R$/l" chamou aquilo assim, e reescrever para "R$ por litro"
      // seria padronizar o vocabulário de quem opera pelo nosso.
      label: interpretado.label,
      normalizedLabel: normalizarRotulo(interpretado.label),
      forma: interpretado.forma,
      base: interpretado.base,
      ...derivada,
      isSeed: false,
      createdBy: entrada.actor,
    })
    .returning();

  const item = paraSignificado(linha);
  await db.insert(curationEventTable).values({
    targetKind: "SEMANTIC_MEANING",
    targetId: item.id,
    targetLabel: item.code,
    field: "created",
    valueBefore: null,
    valueAfter: item.label,
    actor: entrada.actor,
    reason: `Significado cadastrado na tela de confirmação. Deriva ${derivada.valueKind}, unidade ${derivada.unit ?? "—"}, agregação ${derivada.aggregation ?? "—"}.`,
    detail: { changeKind: "MEANING_CATALOG", ...derivada },
  });

  return { desfecho: "CRIADO", item, mensagem: "", proximos: [] };
}

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------

/** Uma categoria como a tela a mostra: caminho de negócio, sem id nem código. */
export interface CategoriaCadastrada {
  id: string;
  code: string;
  name: string;
  /** "Custo Variável › Manutenção" — a hierarquia dita, sem falar em taxonomia. */
  caminho: string;
  /**
   * O caminho partido nos dois níveis em que a DRE se lê.
   *
   * `sintetico` é a classe — a linha que totaliza, "Custo Variável". `analitico`
   * é o que vem abaixo dela, "Manutenção", e é o que de fato se escolhe: a
   * árvore não oferece classes, porque classificar em "Custo Variável" é o mesmo
   * que não classificar.
   *
   * Os dois são derivados do mesmo nó, e não campos guardados. Um atributo tem
   * **uma** classificação; sintético e analítico são as duas alturas de onde se
   * olha para ela, e guardá-las em separado criaria o dia em que uma discorda da
   * outra. Numa árvore mais funda que dois níveis, `analitico` fica com todos os
   * degraus abaixo da classe — "Frota — Cavalo › Depreciação" —, porque cortar
   * no primeiro perderia a diferença entre dois nós de mesmo nome em galhos
   * diferentes.
   */
  sintetico: string;
  analitico: string;
  costClass: string | null;
  depth: number;
  isSeed: boolean;
  /**
   * Quantas colunas estão nesta categoria hoje.
   *
   * É a materialidade da decisão de classe, e por isso viaja junto: uma
   * categoria com dezoito colunas dentro decide de que lado da conta cai
   * dezoito colunas, e uma vazia não decide nada ainda. A tela de classificação
   * ordena por isto, pela mesma razão que a fila de curadoria ordena por
   * magnitude — o tempo de quem cura vale mais onde há mais em jogo.
   */
  atributos: number;
  /**
   * O código da classe em que a categoria mora: `custo_fixo`, `custo_variavel`,
   * `cadastral` ou `nao_classificado`.
   *
   * `costClass` sozinha não responde "esta categoria já foi classificada?", e a
   * diferença não é sutil: `cadastral` **também** devolve `null`, e de
   * propósito — cadastro não é custo, e carimbá-lo FIXO o poria num total. Sem
   * este campo, a tela de classificação cobraria uma decisão de quem já a
   * tomou, para sempre.
   */
  classeCode: string | null;
}

/**
 * O nó a que uma categoria criada na tela é pendurada.
 *
 * `nao_classificado` e não um palpite entre custo fixo e variável. A classe de
 * custo decide de que lado da conta a coluna cai em quatro telas do produto, e
 * ninguém consegue lê-la em "Pedágio": pedágio é custo variável numa operação
 * e repasse contratual em outra. Pendurar sob "Não classificado" afirma o que é
 * verdade — a categoria existe, a classe ainda não foi decidida — e a árvore já
 * sabe conviver com isso desde o primeiro dia (`guessTaxonomyCode` cai nela, e
 * `INHERITED_COST_CLASS_JOIN` devolve nulo sem quebrar nada).
 */
export const PAI_DE_CATEGORIA_NOVA = "nao_classificado";

/**
 * As categorias, com o caminho escrito em linguagem de negócio.
 *
 * A raiz ("Remuneração") sai do caminho: ela é a árvore inteira e não informa
 * nada. O que sobra é `Custo Variável › Manutenção`, que é como se fala disso
 * numa reunião — e é o item 6 do pedido, que pede a hierarquia preservada por
 * dentro e invisível como jargão por fora.
 */
export async function listarCategorias(db: Database): Promise<CategoriaCadastrada[]> {
  const nodes = await db
    .select()
    .from(taxonomyNodeTable)
    .where(eq(taxonomyNodeTable.isActive, true))
    .orderBy(asc(taxonomyNodeTable.depth), asc(taxonomyNodeTable.sortOrder));

  const contagem = await db
    .select({
      taxonomyNodeId: attributeTable.taxonomyNodeId,
      total: sql<number>`count(*)`.mapWith(Number),
    })
    .from(attributeTable)
    .groupBy(attributeTable.taxonomyNodeId);
  const atributosPorNo = new Map(
    contagem
      .filter((c): c is { taxonomyNodeId: string; total: number } =>
        c.taxonomyNodeId !== null,
      )
      .map((c) => [c.taxonomyNodeId, c.total]),
  );

  const porId = new Map(nodes.map((n) => [n.id, n]));
  const classeDe = (node: (typeof nodes)[number]): string | null => {
    let atual: (typeof nodes)[number] | undefined = node;
    while (atual) {
      if (atual.costClass) return atual.costClass;
      atual = atual.parentId ? porId.get(atual.parentId) : undefined;
    }
    return null;
  };
  /** O ancestral de profundidade 1 — a classe em que o nó mora. */
  const classeCodeDe = (node: (typeof nodes)[number]): string | null => {
    let atual: (typeof nodes)[number] | undefined = node;
    while (atual && atual.depth > 1) {
      atual = atual.parentId ? porId.get(atual.parentId) : undefined;
    }
    return atual?.depth === 1 ? atual.code : null;
  };
  /**
   * Os nomes do nó até a classe, sem a raiz.
   *
   * A raiz fica de fora: `Remuneração › Custo Fixo › Pneus` gasta uma palavra
   * dizendo que estamos no produto de remuneração. O primeiro elemento é sempre
   * a classe (profundidade 1), e é dele que sai o sintético.
   */
  const degrausDe = (node: (typeof nodes)[number]): string[] => {
    const partes: string[] = [];
    let atual: (typeof nodes)[number] | undefined = node;
    while (atual) {
      if (atual.depth > 0) partes.unshift(atual.name);
      atual = atual.parentId ? porId.get(atual.parentId) : undefined;
    }
    return partes;
  };

  return nodes
    // Nem a raiz nem as classes são escolhíveis: uma coluna pertence a um grupo
    // ("Pneus"), e classificá-la em "Custo Fixo" seria não classificá-la.
    .filter((n) => n.depth > 1)
    .map((n) => {
      const degraus = degrausDe(n);
      return {
        id: n.id,
        code: n.code,
        name: n.name,
        caminho: degraus.join(" › "),
        sintetico: degraus[0] ?? "",
        analitico: degraus.slice(1).join(" › "),
        costClass: classeDe(n),
        depth: n.depth,
        isSeed: n.createdBy === null,
        atributos: atributosPorNo.get(n.id) ?? 0,
        classeCode: classeCodeDe(n),
      };
    });
}

// ---------------------------------------------------------------------------
// As linhas sintéticas — o primeiro nível da DRE
// ---------------------------------------------------------------------------

/** A raiz da árvore. Toda linha sintética é filha dela. */
export const RAIZ_DA_TAXONOMIA = "remuneracao";

/**
 * Uma linha da DRE — o nível que totaliza, e não o que classifica.
 *
 * É o mesmo nó de `taxonomy_node` que `CategoriaCadastrada.sintetico` devolve
 * como texto; a diferença é que aqui ele vem inteiro, com código e contagem, e
 * **existe mesmo estando vazio**. Derivar a lista das categorias — que é o que
 * a tela fazia — esconde exatamente a linha recém-criada: ela ainda não tem
 * analítico nenhum dentro, e uma linha que some no instante seguinte ao de ser
 * criada é indistinguível de uma criação que falhou.
 */
export interface SinteticoCadastrado {
  id: string;
  code: string;
  /** "Custo Fixo" — o nome como a DRE o imprime. */
  nome: string;
  costClass: string | null;
  /**
   * `true` nas três casas em que classificar decide dinheiro — custo fixo,
   * custo variável e cadastral.
   *
   * Não é enfeite de tela: é o que impede uma categoria nova de nascer já
   * classificada. Pendurar "Pedágio" direto em "Custo Variável" é afirmar de
   * que lado da conta as colunas dele caem, e essa afirmação tem dono, data e
   * justificativa em {@link classificarCategoria} — não um clique num combobox
   * que estava a caminho de outra coisa. Ver {@link criarCategoria}.
   */
  decideClasseDeCusto: boolean;
  /** Quantos analíticos moram nesta linha hoje, em qualquer profundidade. */
  categorias: number;
  isSeed: boolean;
}

/** As três casas que a classificação usa como destino. */
function ehDestinoDeClassificacao(code: string): boolean {
  return CLASSES_DE_CATEGORIA.some((c) => c.no === code);
}

/**
 * As linhas da DRE, em ordem de leitura.
 *
 * Inclui "Não classificado", que é uma linha de verdade — é onde mora o que
 * ainda não foi decidido, e escondê-la faria a tela mentir sobre onde as
 * categorias novas caem.
 */
export async function listarSinteticos(db: Database): Promise<SinteticoCadastrado[]> {
  const nodes = await db
    .select()
    .from(taxonomyNodeTable)
    .where(eq(taxonomyNodeTable.isActive, true))
    .orderBy(asc(taxonomyNodeTable.sortOrder), asc(taxonomyNodeTable.name));

  return nodes
    .filter((n) => n.depth === 1)
    .map((n) => ({
      id: n.id,
      code: n.code,
      nome: n.name,
      costClass: n.costClass,
      decideClasseDeCusto: ehDestinoDeClassificacao(n.code),
      // Por prefixo de caminho, e não por `parentId`: uma linha pode ter neta,
      // e "Frota — Cavalo › Depreciação" conta para "Custo Fixo" tanto quanto
      // "Pneus" conta.
      categorias: nodes.filter((f) => f.depth > 1 && f.path.startsWith(`${n.path}/`)).length,
      isSeed: n.createdBy === null,
    }));
}

/**
 * Cadastrar uma linha da DRE a partir do que a pessoa digitou.
 *
 * ---------------------------------------------------------------------------
 * Por que isto existe ao lado de {@link criarCategoria}
 * ---------------------------------------------------------------------------
 * Pelo mesmo motivo que a criação de categoria existe: o vocabulário é da
 * operação, e um cadastro fechado no primeiro nível obriga quem cura a escolher
 * a linha *mais parecida* com a que ela queria — que é a aproximação silenciosa
 * que este produto não aceita em lugar nenhum. Uma DRE que precisa de "Receita
 * de frete" e só tem custo fixo, custo variável e cadastral não é uma DRE
 * incompleta: é uma DRE errada, e o erro não aparece em tela nenhuma.
 *
 * ---------------------------------------------------------------------------
 * O que a linha nova **não** ganha
 * ---------------------------------------------------------------------------
 * `cost_class`. Ela nasce sem lado da conta, pela mesma razão que uma categoria
 * nasce sob "Não classificado": de que lado uma linha da DRE cai é uma decisão
 * do negócio, não se lê no nome dela, e declará-la aqui poria colunas num total
 * de custo por causa de uma palavra digitada num combobox. Sem `cost_class`
 * declarada, tudo que morar debaixo dela herda nulo — que é o que
 * `INHERITED_COST_CLASS_JOIN` já sabe tratar desde o primeiro dia.
 *
 * Idempotente sobre o que já existe, como toda criação inline daqui.
 */
export async function criarSintetico(
  db: Database,
  entrada: { name: string; actor: string },
): Promise<ResultadoDaCriacao<SinteticoCadastrado>> {
  if (!entrada.actor?.trim()) {
    throw new Error("Cadastrar uma linha da DRE exige um responsável identificado.");
  }
  const nome = entrada.name.trim().replace(/\s+/g, " ");
  if (!nome) throw new Error("Uma linha da DRE precisa de um nome.");

  const sinteticos = await listarSinteticos(db);
  const proximos = procurarProximos(nome, sinteticos, (s) => s.nome);
  const igual = proximos.find((p) => p.tipo === "IGUAL");
  if (igual) {
    return {
      desfecho: "JA_EXISTE",
      item: igual.item,
      mensagem: `"${igual.item.nome}" já é uma linha da DRE. Selecionada.`,
      proximos,
    };
  }

  /*
    Um nome que já é categoria não vira linha da DRE.

    A checagem não é a mesma da colisão de código logo abaixo, e é por isso que
    ela existe: "Pneus" está cadastrada como `cv_pneus`, e o código derivado do
    nome seria `pneus` — passaria sem esbarrar em nada, e a árvore ficaria com
    "Pneus" totalizando "Pneus". Quem lê a DRE não tem como saber qual dos dois
    está olhando, e a leitura das duas colunas da planilha de atributos, que
    casa sintético e analítico **pelo nome**, passaria a ter duas respostas.
  */
  const homonima = procurarProximos(nome, await listarCategorias(db), (c) => c.name).find(
    (p) => p.tipo === "IGUAL",
  );
  if (homonima) {
    return {
      desfecho: "JA_EXISTE",
      item: null,
      mensagem:
        `"${homonima.item.name}" já existe como categoria, em "${homonima.item.caminho}". ` +
        "Uma linha da DRE precisa de outro nome — duas coisas com o mesmo nome na árvore não se distinguem em relatório nenhum.",
      proximos,
    };
  }

  const [raiz] = await db
    .select()
    .from(taxonomyNodeTable)
    .where(eq(taxonomyNodeTable.code, RAIZ_DA_TAXONOMIA));
  if (!raiz) {
    throw new Error(
      `A árvore de categorias ainda não foi semeada neste banco: falta a raiz "${RAIZ_DA_TAXONOMIA}".`,
    );
  }

  const code = normalizarRotulo(nome).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const [colisao] = await db
    .select()
    .from(taxonomyNodeTable)
    .where(eq(taxonomyNodeTable.code, code));
  if (colisao) {
    /*
      O código é único na árvore inteira, e a colisão pode ser com um nó de
      outro nível — "Combustível" já existe como analítico dentro de "Custo
      Variável". Devolver `item: null` com o motivo por extenso é o que impede
      a tela de selecionar, no campo do sintético, uma categoria que não é uma
      linha da DRE.
    */
    const existente = sinteticos.find((s) => s.id === colisao.id) ?? null;
    return {
      desfecho: "JA_EXISTE",
      item: existente,
      mensagem: existente
        ? `"${colisao.name}" já é uma linha da DRE. Selecionada.`
        : `"${colisao.name}" já existe na árvore como categoria, e não como linha da DRE. ` +
          `Escolha outro nome para a linha, ou use essa categoria no analítico.`,
      proximos,
    };
  }

  const ultima = sinteticos.length;
  const [inserido] = await db
    .insert(taxonomyNodeTable)
    .values({
      parentId: raiz.id,
      code,
      name: nome,
      kind: "CLASS",
      // Sem lado da conta declarado: ver a nota acima.
      costClass: null,
      path: `${raiz.path}/${code}`,
      depth: raiz.depth + 1,
      // Depois das linhas que vieram com o produto, e na ordem em que forem
      // criadas — a DRE se lê de cima para baixo, e linha nova entra no fim.
      sortOrder: ultima,
      createdBy: entrada.actor,
    })
    .returning();

  await db.insert(curationEventTable).values({
    targetKind: "TAXONOMY_NODE",
    targetId: inserido.id,
    targetLabel: code,
    field: "created",
    valueBefore: null,
    valueAfter: inserido.path,
    actor: entrada.actor,
    reason:
      "Linha sintética da DRE cadastrada na tela de confirmação. Nasce sem classe de custo — " +
      "de que lado da conta ela cai não se lê no nome, e nada abaixo dela entra num total até que se decida.",
  });

  const atualizados = await listarSinteticos(db);
  return {
    desfecho: "CRIADO",
    item: atualizados.find((s) => s.id === inserido.id) ?? null,
    mensagem: "",
    proximos: [],
  };
}

/**
 * O nó em que uma categoria criada na tela vai morar.
 *
 * Ver a nota sobre `sintetico` em {@link criarCategoria}: a linha pedida vale
 * quando não decide lado da conta; qualquer outra coisa cai em
 * {@link PAI_DE_CATEGORIA_NOVA}, inclusive um código que não existe mais —
 * uma tela aberta há uma hora não pode criar categoria fora da árvore.
 */
async function paiDaCategoriaNova(
  db: Database,
  sintetico: string | null | undefined,
): Promise<typeof taxonomyNodeTable.$inferSelect> {
  const pedido = sintetico?.trim();
  if (pedido && !ehDestinoDeClassificacao(pedido)) {
    const [linha] = await db
      .select()
      .from(taxonomyNodeTable)
      .where(
        and(
          eq(taxonomyNodeTable.code, pedido),
          eq(taxonomyNodeTable.isActive, true),
        ),
      );
    if (linha?.depth === 1) return linha;
  }

  const [padrao] = await db
    .select()
    .from(taxonomyNodeTable)
    .where(eq(taxonomyNodeTable.code, PAI_DE_CATEGORIA_NOVA));
  if (!padrao) {
    throw new Error(
      `A árvore de categorias ainda não foi semeada neste banco: falta o nó "${PAI_DE_CATEGORIA_NOVA}".`,
    );
  }
  return padrao;
}

/**
 * Cadastrar uma categoria a partir do que a pessoa digitou.
 *
 * Mesmas regras da criação de significado, menos uma: não há derivação
 * econômica a fazer, então não há como um nome ser "não entendido". Uma
 * categoria é uma palavra do negócio, e quem opera é quem sabe quais são.
 *
 * A busca por parecidos continua valendo, e é o caso `combustivel` /
 * `Combustível` do pedido: ela é feita **antes**, e o que ela encontra volta
 * para a tela oferecer em vez de criar.
 *
 * ---------------------------------------------------------------------------
 * Em que linha da DRE a categoria nasce
 * ---------------------------------------------------------------------------
 * `sintetico` é o código da linha escolhida na tela, e ele é **um pedido, não
 * uma ordem**. Ele é atendido quando a linha não decide lado da conta — uma
 * linha criada por quem opera, ou "Não classificado". Numa das três casas da
 * classificação (custo fixo, custo variável, cadastral) ele é recusado em
 * silêncio e a categoria entra sob "Não classificado", porque criar direto lá
 * dentro seria classificar: afirmar de que lado da conta as colunas caem sem
 * autor, sem justificativa e sem o evento que {@link classificarCategoria}
 * grava. A tela diz isso antes do clique, e o `item` devolvido traz o
 * sintético real — é por ele que o campo se corrige sozinho.
 *
 * Sem `sintetico`, o destino é "Não classificado", como sempre foi.
 */
export async function criarCategoria(
  db: Database,
  entrada: { name: string; actor: string; sintetico?: string | null },
): Promise<ResultadoDaCriacao<CategoriaCadastrada>> {
  if (!entrada.actor?.trim()) {
    throw new Error("Cadastrar uma categoria exige um responsável identificado.");
  }
  const nome = entrada.name.trim().replace(/\s+/g, " ");
  if (!nome) throw new Error("Uma categoria precisa de um nome.");

  const categorias = await listarCategorias(db);
  const proximos = procurarProximos(nome, categorias, (c) => c.name);
  const igual = proximos.find((p) => p.tipo === "IGUAL");
  if (igual) {
    return {
      desfecho: "JA_EXISTE",
      item: igual.item,
      mensagem: `"${igual.item.caminho}" já existe. Selecionada.`,
      proximos,
    };
  }

  // O simétrico da checagem em `criarSintetico`, e pelo mesmo motivo: uma
  // categoria com o nome de uma linha da DRE deixa a árvore com dois nós
  // homônimos em alturas diferentes, e nenhum relatório os separa.
  const linhaDaDre = procurarProximos(nome, await listarSinteticos(db), (s) => s.nome).find(
    (p) => p.tipo === "IGUAL",
  );
  if (linhaDaDre) {
    return {
      desfecho: "JA_EXISTE",
      item: null,
      mensagem:
        `"${linhaDaDre.item.nome}" é uma linha da DRE, e não uma categoria dentro dela. ` +
        "Escolha essa linha no campo de cima, e cadastre aqui o detalhe que vai dentro.",
      proximos,
    };
  }

  const pai = await paiDaCategoriaNova(db, entrada.sintetico);

  /*
    O código é derivado do nome normalizado, e é único na árvore inteira — não
    só entre irmãos. É o que o schema exige (`taxonomy_node_code_uq`), e é o que
    faz "Pedágio" criado hoje e "Pedagio" digitado amanhã colidirem em vez de
    virarem dois nós. A colisão é tratada como duplicata, e não como erro: quem
    digitou não precisa saber que existe um código por trás.
  */
  const code = normalizarRotulo(nome).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const [colisao] = await db
    .select()
    .from(taxonomyNodeTable)
    .where(eq(taxonomyNodeTable.code, code));
  if (colisao) {
    const existente = categorias.find((c) => c.id === colisao.id);
    return {
      desfecho: "JA_EXISTE",
      item: existente ?? null,
      // Sem `existente`, o nó que colidiu é a raiz ou uma linha da DRE — nada
      // foi selecionado, e dizer "Selecionada" seria a tela mentindo.
      mensagem: existente
        ? `"${colisao.name}" já existe no cadastro. Selecionada.`
        : `"${colisao.name}" já existe na árvore, e não como categoria. Escolha outro nome.`,
      proximos,
    };
  }

  const [inserido] = await db
    .insert(taxonomyNodeTable)
    .values({
      parentId: pai.id,
      code,
      name: nome,
      kind: "GROUP",
      // Sem classe de custo declarada: ver `PAI_DE_CATEGORIA_NOVA`.
      costClass: null,
      path: `${pai.path}/${code}`,
      depth: pai.depth + 1,
      sortOrder: 0,
      createdBy: entrada.actor,
    })
    .returning();

  await db.insert(curationEventTable).values({
    targetKind: "TAXONOMY_NODE",
    targetId: inserido.id,
    targetLabel: code,
    field: "created",
    valueBefore: null,
    valueAfter: inserido.path,
    actor: entrada.actor,
    reason:
      `Categoria cadastrada na tela de confirmação. Entra sob “${pai.name}” — ` +
      "a classe de custo (fixo ou variável) não se lê no nome e continua por decidir.",
  });

  const atualizadas = await listarCategorias(db);
  return {
    desfecho: "CRIADO",
    item: atualizadas.find((c) => c.id === inserido.id) ?? null,
    mensagem: "",
    proximos: [],
  };
}

/**
 * O significado de um atributo, resolvido pelo cadastro.
 *
 * Devolve `null` quando o código não existe no escopo — que é o que uma tela
 * desatualizada, ou um pedido forjado, produziriam.
 */
export async function acharSignificado(
  db: Database,
  code: string,
  escopo: Escopo = ESCOPO_GLOBAL,
): Promise<SignificadoCadastrado | null> {
  const [linha] = await db
    .select()
    .from(semanticMeaningTable)
    .where(
      and(
        eq(semanticMeaningTable.scopeType, escopo.scopeType),
        eq(semanticMeaningTable.scopeCode, escopo.scopeCode),
        eq(semanticMeaningTable.code, code),
      ),
    );
  return linha ? paraSignificado(linha) : null;
}

/** O código canônico de um rótulo, para quem só tem o texto. Nunca escreve. */
export function codigoDoRotulo(rotulo: string): string | null {
  const lido = interpretarRotulo(rotulo);
  return lido ? codigoDe(lido.forma, lido.base) : null;
}

// ---------------------------------------------------------------------------
// Classificar uma categoria em custo fixo, variável ou "não é custo"
// ---------------------------------------------------------------------------

/**
 * As três casas em que uma categoria pode morar, ditas como quem opera as diz.
 *
 * São exatamente as três classes que `DEFAULT_TAXONOMY` declara abaixo da raiz,
 * e não uma lista paralela: `custo_fixo` e `custo_variavel` declaram
 * `cost_class`, `cadastral` não declara nenhum de propósito — chassi, placa e
 * ano descrevem o ativo e não remuneram nada. "Não classificado" fica de fora
 * porque não é destino: é de onde se sai.
 */
export const CLASSES_DE_CATEGORIA = [
  {
    classe: "FIXO" as const,
    no: "custo_fixo",
    rotulo: "Custo fixo",
    ajuda: "O que se paga por ter o ativo, rode ele ou não: financiamento, depreciação, seguros, tributos, remuneração de capital.",
  },
  {
    classe: "VARIAVEL" as const,
    no: "custo_variavel",
    rotulo: "Custo variável",
    ajuda: "O que se paga por rodar: combustível, manutenção, pneus, pedágio, e o lucro variável previsto.",
  },
  {
    classe: "NAO_E_CUSTO" as const,
    no: "cadastral",
    rotulo: "Não é custo",
    ajuda: "Descreve o equipamento e não entra em conta nenhuma: identificação, especificação técnica, contrato, escopo.",
  },
];

export type ClasseDeCategoria = (typeof CLASSES_DE_CATEGORIA)[number]["classe"];

export interface ClassificacaoResult {
  /** MOVIDA quando a árvore mudou; JA_ESTAVA quando o pedido era o estado atual. */
  desfecho: "MOVIDA" | "JA_ESTAVA";
  categoria: CategoriaCadastrada;
  /** O caminho de antes, para a tela dizer o que mudou. */
  caminhoAnterior: string;
  /** Quantos nós tiveram o caminho reescrito — a categoria e os filhos dela. */
  nosMovidos: number;
}

/**
 * Classificar uma categoria — que é **movê-la** na árvore, e não carimbá-la.
 *
 * ---------------------------------------------------------------------------
 * Por que mover, e não gravar `cost_class` no próprio nó
 * ---------------------------------------------------------------------------
 * A coluna existe e seria mais curto escrevê-la direto. Não é o que o modelo
 * diz, e a diferença aparece na hora de explicar um número: `cost_class` é
 * declarada nas **classes** e herdada por tudo abaixo, e é por isso que quem
 * pergunta "por que combustível é variável?" segue de `cv_combustivel` até
 * `custo_variavel` e lê a resposta na árvore. Um nó pendurado em
 * "Não classificado" carimbado como FIXO responderia "porque alguém escreveu
 * FIXO nele" — a mesma informação sem nenhuma explicação em volta, e uma árvore
 * cuja estrutura deixa de significar o que ela significa em todo o resto.
 *
 * Mover mantém as duas verdades sendo uma só: o caminho **é** a classificação,
 * e `INHERITED_COST_CLASS_JOIN` continua achando a resposta pelo ancestral mais
 * próximo, sem saber que houve curadoria.
 *
 * ---------------------------------------------------------------------------
 * O que isto muda e o que não muda
 * ---------------------------------------------------------------------------
 * **Muda** de que lado da conta as colunas daquela categoria caem, nas telas
 * que leem a classe: o panorama de alterações, os recortes de custo, a DRE.
 *
 * **Não muda** comparação já calculada. `change.cost_class` é materializada
 * quando a comparação roda, e reescrevê-la aqui seria a curadoria editando um
 * resultado apurado — exatamente o que este produto não faz. As comparações
 * existentes seguem com a classe que tinham quando foram calculadas, e passam a
 * refletir a nova quando forem recalculadas. A tela diz isso.
 *
 * **Não mexe em fato nenhum**, como nada em `curation_event` mexe.
 *
 * ---------------------------------------------------------------------------
 * A justificativa é obrigatória
 * ---------------------------------------------------------------------------
 * Mesma régua da confirmação de semântica, e pelo mesmo motivo: isto decide
 * dinheiro. Dizer que pedágio é custo variável é uma afirmação sobre o contrato
 * que alguém vai querer auditar, e um `parent_id` que mudou sem autor e sem
 * razão não sustenta a auditoria.
 */
export async function classificarCategoria(
  db: Database,
  entrada: {
    code: string;
    classe: ClasseDeCategoria;
    actor: string;
    reason: string;
  },
): Promise<ClassificacaoResult> {
  if (!entrada.actor?.trim()) {
    throw new Error("Classificar uma categoria exige um responsável identificado.");
  }
  if (!entrada.reason?.trim()) {
    throw new Error(
      "Classificar uma categoria exige uma justificativa — é o que um revisor vai querer ler depois.",
    );
  }

  const destino = CLASSES_DE_CATEGORIA.find((c) => c.classe === entrada.classe);
  if (!destino) {
    throw new Error(
      `Classe "${entrada.classe}" não existe. As três são ${CLASSES_DE_CATEGORIA.map((c) => c.classe).join(", ")}.`,
    );
  }

  const [no] = await db
    .select()
    .from(taxonomyNodeTable)
    .where(eq(taxonomyNodeTable.code, entrada.code));
  if (!no) throw new Error(`Categoria "${entrada.code}" não encontrada.`);

  /*
    A raiz e as classes não se classificam: elas **são** a classificação.
    Mover "Custo Fixo" para dentro de "Custo Variável" não é uma correção
    concebível, é a árvore deixando de significar alguma coisa — e o `depth`
    é o que separa os dois casos sem precisar de uma lista de códigos.
  */
  if (no.depth <= 1) {
    throw new Error(
      `"${no.name}" é uma das classes da árvore, e não uma categoria dentro delas. ` +
        `Classificar move uma categoria para dentro de uma classe; a classe não vai para dentro de si mesma.`,
    );
  }

  const [paiNovo] = await db
    .select()
    .from(taxonomyNodeTable)
    .where(eq(taxonomyNodeTable.code, destino.no));
  if (!paiNovo) {
    throw new Error(
      `A árvore de categorias ainda não foi semeada neste banco: falta o nó "${destino.no}".`,
    );
  }

  const caminhoAnterior = (await listarCategorias(db)).find((c) => c.code === no.code)
    ?.caminho ?? no.path;

  if (no.parentId === paiNovo.id) {
    const categoria = (await listarCategorias(db)).find((c) => c.code === no.code)!;
    return { desfecho: "JA_ESTAVA", categoria, caminhoAnterior, nosMovidos: 0 };
  }

  const caminhoNovo = `${paiNovo.path}/${no.code}`;
  const deslocamento = paiNovo.depth + 1 - no.depth;

  const nosMovidos = await db.transaction(async (tx) => {
    /*
      A subárvore inteira, e não só o nó.

      Hoje as categorias criadas na tela são folhas, e seria cômodo tratar só
      elas. Mas `path` é ancestralidade materializada: deixar um filho com o
      caminho antigo o desliga do pai e o esconde de toda consulta por prefixo —
      inclusive da que resolve a classe de custo. O `||` com o prefixo antigo é
      o mesmo recorte que `INHERITED_COST_CLASS_JOIN` usa para achar ancestral,
      escrito ao contrário.

      **O `::int` não é enfeite.** `substring(texto from …)` tem duas
      sobrecargas em Postgres — por posição e por expressão regular POSIX — e um
      parâmetro sem tipo declarado faz o planejador escolher a segunda: o corte
      vira a regex "37", não casa caminho nenhum, e o `substring` devolve NULL.
      Concatenar com NULL dá NULL, e o caminho da categoria seria apagado. A
      coluna é NOT NULL, então o banco recusa — mas o motivo fica a três saltos
      de distância de quem lê o erro.
    */
    const { rowCount } = await tx.execute(sql`
      UPDATE taxonomy_node
         SET path = ${caminhoNovo} || substring(path from ${no.path.length + 1}::int),
             depth = depth + ${deslocamento}::int
       WHERE path = ${no.path} OR path LIKE ${no.path + "/%"}
    `);

    await tx
      .update(taxonomyNodeTable)
      .set({ parentId: paiNovo.id })
      .where(eq(taxonomyNodeTable.id, no.id));

    await tx.insert(curationEventTable).values({
      targetKind: "TAXONOMY_NODE",
      targetId: no.id,
      targetLabel: no.code,
      field: "parent_id",
      valueBefore: no.path,
      valueAfter: caminhoNovo,
      actor: entrada.actor,
      reason: entrada.reason,
      detail: { changeKind: "COST_CLASS", classe: entrada.classe },
    });

    return rowCount ?? 0;
  });

  const categoria = (await listarCategorias(db)).find((c) => c.code === no.code)!;
  return { desfecho: "MOVIDA", categoria, caminhoAnterior, nosMovidos };
}
