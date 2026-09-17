/**
 * O armazém das cotações e das premissas — o que quem compra digitou.
 *
 * Duas coleções, e as duas ficam do lado de fora do acervo: nada aqui é fato
 * canônico, nada entra em vigência, nada participa de reconvergência. Ver o
 * cabeçalho de `lib/db/src/schema/compras.ts`, onde essa fronteira está
 * escrita por extenso, e a migration `0101`.
 *
 * **Cotação é privada de quem a criou, como a conversa do Assistente.** Toda
 * função recebe `ownerId` depois do banco e nenhuma tem sobrecarga que o
 * dispense: uma rota que esqueça o dono não compila. Uma proposta comercial é
 * documento em negociação, e o produto não tem hoje nenhum conceito de equipe
 * de compras que justificasse abri-la a todos.
 *
 * **Premissa é da casa.** Vida útil de pneu não pertence a ninguém — é como a
 * operação funciona —, e por isso `compra_premissa` não tem dono, só o registro
 * de quem a atualizou por último. Duas pessoas configurando vidas úteis
 * diferentes para o mesmo item produziriam dois preços-alvo para a mesma
 * compra, que é o defeito que este produto existe para não ter.
 *
 * **Excluir é arquivar**, como no Assistente e no Book: a cotação que sustentou
 * uma decisão de compra não some porque alguém arrumou a lista.
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  compraCotacaoTable,
  compraPremissaTable,
  type Database,
} from "@workspace/db";

/** As quatro situações em que uma cotação pode estar no fluxo de quem compra. */
export type SituacaoDaCotacao =
  "AGUARDANDO" | "EM_NEGOCIACAO" | "APROVADA" | "RECUSADA";

export const SITUACOES: SituacaoDaCotacao[] = [
  "AGUARDANDO",
  "EM_NEGOCIACAO",
  "APROVADA",
  "RECUSADA",
];

export const ROTULO_DA_SITUACAO: Record<SituacaoDaCotacao, string> = {
  AGUARDANDO: "Aguardando análise",
  EM_NEGOCIACAO: "Em negociação",
  APROVADA: "Aprovada",
  RECUSADA: "Recusada",
};

export function ehSituacao(valor: unknown): valor is SituacaoDaCotacao {
  return typeof valor === "string" && (SITUACOES as string[]).includes(valor);
}

export interface Cotacao {
  id: string;
  item: string;
  descricao: string | null;
  fornecedor: string;
  precoUnitario: number;
  quantidade: number | null;
  operacao: string | null;
  unidade: string | null;
  situacao: SituacaoDaCotacao;
  evidencia: string | null;
  validaAte: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NovaCotacao {
  item: string;
  fornecedor: string;
  precoUnitario: number;
  descricao?: string | null;
  quantidade?: number | null;
  operacao?: string | null;
  unidade?: string | null;
  situacao?: SituacaoDaCotacao;
  evidencia?: string | null;
  validaAte?: string | null;
}

/**
 * `numeric` volta do driver como string, e é de propósito.
 *
 * O `pg` não converte `numeric` para `number` porque não cabe — 18 dígitos não
 * cabem num float. Aqui cabe: preço de compra em reais com duas casas, e a
 * conta que o motor faz sobre ele é a mesma que a tela faria. O que não se pode
 * é deixar a string vazar para o motor, onde `"3080.00" - 2940` é `140` mas
 * `"3080.00" + 0` é `"3080.000"`.
 */
function numero(bruto: unknown): number | null {
  if (bruto === null || bruto === undefined) return null;
  const n = typeof bruto === "number" ? bruto : Number(bruto);
  return Number.isFinite(n) ? n : null;
}

function comoData(bruto: unknown): string | null {
  return bruto instanceof Date ? bruto.toISOString() : null;
}

type LinhaDeCotacao = typeof compraCotacaoTable.$inferSelect;

function paraCotacao(linha: LinhaDeCotacao): Cotacao {
  return {
    id: linha.id,
    item: linha.item,
    descricao: linha.descricao,
    fornecedor: linha.fornecedor,
    /*
      O `!` não é otimismo: `preco_unitario` é NOT NULL com CHECK `> 0` na
      migration, então uma linha sem número aqui seria um banco que não passou
      pela fila de migrations — e nesse caso zero seria pior que o erro.
    */
    precoUnitario: numero(linha.precoUnitario)!,
    quantidade: linha.quantidade,
    operacao: linha.operacao,
    unidade: linha.unidade,
    situacao: ehSituacao(linha.situacao) ? linha.situacao : "AGUARDANDO",
    evidencia: linha.evidencia,
    validaAte: comoData(linha.validaAte),
    createdAt: comoData(linha.createdAt) ?? "",
    updatedAt: comoData(linha.updatedAt) ?? "",
  };
}

/** O filtro do dono. Toda consulta de cotação passa por aqui. */
function daPessoa(ownerId: string) {
  return and(
    eq(compraCotacaoTable.ownerId, ownerId),
    isNull(compraCotacaoTable.archivedAt),
  );
}

/**
 * As cotações de quem perguntou, da mais recente para a mais antiga.
 *
 * `item` e `situacao` recortam; sem eles vem tudo. Não há paginação, e é
 * deliberado: uma carteira de compras real deste produto são dezenas de
 * propostas, e o painel precisa do total — um "há mais" no fim da página
 * transformaria "economia potencial" na economia da primeira página.
 */
export async function listarCotacoes(
  db: Database,
  ownerId: string,
  filtro: {
    item?: string;
    situacao?: SituacaoDaCotacao;
    operacao?: string | null;
  } = {},
): Promise<Cotacao[]> {
  const condicoes = [daPessoa(ownerId)];
  if (filtro.item) condicoes.push(eq(compraCotacaoTable.item, filtro.item));
  if (filtro.situacao)
    condicoes.push(eq(compraCotacaoTable.situacao, filtro.situacao));
  /*
    A operação recorta quando vem, e `NULL` na linha sempre passa: uma cotação
    sem operação declarada vale para todas — foi digitada antes de a compra ter
    dono, que é como a maior parte delas chega.
  */
  if (filtro.operacao) {
    condicoes.push(
      sql`(${compraCotacaoTable.operacao} IS NULL OR ${compraCotacaoTable.operacao} = ${filtro.operacao})`,
    );
  }

  const linhas = await db
    .select()
    .from(compraCotacaoTable)
    .where(and(...condicoes))
    .orderBy(desc(compraCotacaoTable.createdAt));

  return linhas.map(paraCotacao);
}

export async function acharCotacao(
  db: Database,
  ownerId: string,
  id: string,
): Promise<Cotacao | null> {
  const linhas = await db
    .select()
    .from(compraCotacaoTable)
    .where(and(daPessoa(ownerId), eq(compraCotacaoTable.id, id)))
    .limit(1);
  const linha = linhas[0];
  return linha ? paraCotacao(linha) : null;
}

export async function criarCotacao(
  db: Database,
  ownerId: string,
  nova: NovaCotacao,
): Promise<Cotacao> {
  const [linha] = await db
    .insert(compraCotacaoTable)
    .values({
      ownerId,
      item: nova.item,
      fornecedor: nova.fornecedor,
      precoUnitario: nova.precoUnitario.toFixed(2),
      descricao: nova.descricao ?? null,
      quantidade: nova.quantidade ?? null,
      operacao: nova.operacao ?? null,
      unidade: nova.unidade ?? null,
      situacao: nova.situacao ?? "AGUARDANDO",
      evidencia: nova.evidencia ?? null,
      validaAte: nova.validaAte ? new Date(nova.validaAte) : null,
    })
    .returning();
  return paraCotacao(linha!);
}

/** Move a cotação no fluxo. Devolve `null` quando ela não é de quem pediu. */
export async function moverCotacao(
  db: Database,
  ownerId: string,
  id: string,
  situacao: SituacaoDaCotacao,
): Promise<Cotacao | null> {
  const [linha] = await db
    .update(compraCotacaoTable)
    .set({ situacao, updatedAt: new Date() })
    .where(and(daPessoa(ownerId), eq(compraCotacaoTable.id, id)))
    .returning();
  return linha ? paraCotacao(linha) : null;
}

/** Excluir é arquivar. Nenhuma linha é apagada. */
export async function arquivarCotacao(
  db: Database,
  ownerId: string,
  id: string,
): Promise<Cotacao | null> {
  const [linha] = await db
    .update(compraCotacaoTable)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(daPessoa(ownerId), eq(compraCotacaoTable.id, id)))
    .returning();
  return linha ? paraCotacao(linha) : null;
}

// ---------------------------------------------------------------------------
// Premissas
// ---------------------------------------------------------------------------

export interface PremissaDoItem {
  item: string;
  operacao: string | null;
  vidaUtilMeses: number | null;
  unidadesPorAtivo: number | null;
  margemAlvo: number | null;
  margemMinima: number | null;
  justificativa: string | null;
  updatedAt: string;
}

type LinhaDePremissa = typeof compraPremissaTable.$inferSelect;

function paraPremissa(linha: LinhaDePremissa): PremissaDoItem {
  return {
    item: linha.item,
    operacao: linha.operacao,
    vidaUtilMeses: linha.vidaUtilMeses,
    unidadesPorAtivo: linha.unidadesPorAtivo,
    margemAlvo: numero(linha.margemAlvo),
    margemMinima: numero(linha.margemMinima),
    justificativa: linha.justificativa,
    updatedAt: comoData(linha.updatedAt) ?? "",
  };
}

/**
 * As premissas configuradas, indexadas por item, já resolvido o recorte.
 *
 * Quando existem as duas linhas — a da operação e a da casa —, **a da operação
 * vence**. É a razão de a coluna existir: a mesma frota roda com ciclos
 * diferentes em operações diferentes, e obrigar a escolher uma vida útil para
 * as quatro faria três delas responderem com o número da quarta.
 */
export async function premissasConfiguradas(
  db: Database,
  operacao?: string | null,
): Promise<Map<string, PremissaDoItem>> {
  const linhas = await db.select().from(compraPremissaTable);

  const porItem = new Map<string, PremissaDoItem>();
  for (const linha of linhas) {
    const premissa = paraPremissa(linha);
    if (premissa.operacao !== null && premissa.operacao !== (operacao ?? null))
      continue;
    const atual = porItem.get(premissa.item);
    /* A da operação vence a da casa; entre duas da casa não há segunda. */
    if (
      atual === undefined ||
      (atual.operacao === null && premissa.operacao !== null)
    ) {
      porItem.set(premissa.item, premissa);
    }
  }
  return porItem;
}

export interface PremissaPedida {
  item: string;
  operacao?: string | null;
  vidaUtilMeses?: number | null;
  unidadesPorAtivo?: number | null;
  margemAlvo?: number | null;
  margemMinima?: number | null;
  justificativa?: string | null;
}

/**
 * Grava a premissa de um item, ou substitui a que existia.
 *
 * Atualiza primeiro e insere só se nada foi atualizado, em transação. Não é
 * `onConflictDoUpdate` porque o conflito que interessa é sobre um índice de
 * **expressão** — `(item, COALESCE(operacao, ''))`, que é o que impede duas
 * linhas "para todas as operações" do mesmo item —, e o alvo de um
 * `ON CONFLICT` do drizzle é uma lista de colunas. Escrever o índice como
 * `(item, operacao)` faria o banco aceitar as duas linhas, porque `NULL` não
 * colide com `NULL`, e a leitura passaria a escolher uma vida útil entre duas
 * pela ordem do plano.
 *
 * A premissa é configuração, não histórico: não há segunda linha para o mesmo
 * par. Quem quiser saber quando ela mudou tem `updated_at` e `atualizado_por`;
 * quem quiser auditoria de mudança de premissa vai pedir uma tabela de eventos,
 * e ela entra ao lado sem tocar nesta.
 */
export async function guardarPremissa(
  db: Database,
  usuarioId: string,
  pedida: PremissaPedida,
): Promise<PremissaDoItem> {
  const valores = {
    item: pedida.item,
    operacao: pedida.operacao ?? null,
    vidaUtilMeses: pedida.vidaUtilMeses ?? null,
    unidadesPorAtivo: pedida.unidadesPorAtivo ?? null,
    margemAlvo: pedida.margemAlvo != null ? pedida.margemAlvo.toFixed(4) : null,
    margemMinima:
      pedida.margemMinima != null ? pedida.margemMinima.toFixed(4) : null,
    justificativa: pedida.justificativa ?? null,
    atualizadoPor: usuarioId,
  };

  /* `IS NOT DISTINCT FROM` porque o par da casa tem `operacao` nula, e `= NULL`
     não casa com linha nenhuma — a atualização nunca acharia a linha que o
     índice único garante existir, e a inserção seguinte bateria nele. */
  const mesmoPar = and(
    eq(compraPremissaTable.item, valores.item),
    sql`${compraPremissaTable.operacao} IS NOT DISTINCT FROM ${valores.operacao}`,
  );

  return db.transaction(async (tx) => {
    const [atualizada] = await tx
      .update(compraPremissaTable)
      .set({ ...valores, updatedAt: new Date() })
      .where(mesmoPar)
      .returning();
    if (atualizada) return paraPremissa(atualizada);

    const [criada] = await tx
      .insert(compraPremissaTable)
      .values(valores)
      .returning();
    return paraPremissa(criada!);
  });
}
