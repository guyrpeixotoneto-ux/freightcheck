import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
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
  costClass: string | null;
  depth: number;
  isSeed: boolean;
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

  const porId = new Map(nodes.map((n) => [n.id, n]));
  const classeDe = (node: (typeof nodes)[number]): string | null => {
    let atual: (typeof nodes)[number] | undefined = node;
    while (atual) {
      if (atual.costClass) return atual.costClass;
      atual = atual.parentId ? porId.get(atual.parentId) : undefined;
    }
    return null;
  };
  const caminhoDe = (node: (typeof nodes)[number]): string => {
    const partes: string[] = [];
    let atual: (typeof nodes)[number] | undefined = node;
    while (atual) {
      // A raiz fica de fora: `Remuneração › Custo Fixo › Pneus` gasta uma
      // palavra dizendo que estamos no produto de remuneração.
      if (atual.depth > 0) partes.unshift(atual.name);
      atual = atual.parentId ? porId.get(atual.parentId) : undefined;
    }
    return partes.join(" › ");
  };

  return nodes
    // Nem a raiz nem as classes são escolhíveis: uma coluna pertence a um grupo
    // ("Pneus"), e classificá-la em "Custo Fixo" seria não classificá-la.
    .filter((n) => n.depth > 1)
    .map((n) => ({
      id: n.id,
      code: n.code,
      name: n.name,
      caminho: caminhoDe(n),
      costClass: classeDe(n),
      depth: n.depth,
      isSeed: n.createdBy === null,
    }));
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
 */
export async function criarCategoria(
  db: Database,
  entrada: { name: string; actor: string },
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

  const [pai] = await db
    .select()
    .from(taxonomyNodeTable)
    .where(eq(taxonomyNodeTable.code, PAI_DE_CATEGORIA_NOVA));
  if (!pai) {
    throw new Error(
      `A árvore de categorias ainda não foi semeada neste banco: falta o nó "${PAI_DE_CATEGORIA_NOVA}".`,
    );
  }

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
      mensagem: `"${colisao.name}" já existe no cadastro. Selecionada.`,
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
      "Categoria cadastrada na tela de confirmação. Entra sob “Não classificado” — " +
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
