import { and, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  ALTERACAO_DE_ORIGEM_VISIVEL,
  changeTable,
  justificativaTable,
} from "@workspace/db";

/**
 * Painel de Justificativas — a leitura de cobertura de Chamados.
 *
 * A fila de Justificativas (`pages/justificativas.tsx`) responde "o que eu
 * justifico agora": uma vigência, uma aba de tipo, os cards das placas que
 * mudaram. Ela não responde a pergunta do gestor que **cobra** o trabalho —
 * quanto do que mudou já está explicado e quanto ainda falta, no acervo
 * inteiro. Era uma conta que só existia somando telas na mão, vigência a
 * vigência, aba a aba.
 *
 * O que este arquivo apura é isso, e nada além: quantas alterações cada
 * comparação tem, quantas delas já têm justificativa, quantas placas ainda
 * carregam pendência, e quem escreveu o que já está escrito. Três leituras da
 * mesma junção — `change` de um lado, `justificativa` do outro —, e o painel
 * monta com elas os cartões, a rosca, as barras e a lista.
 *
 * **Justificada é a alteração que tem ao menos uma linha em `justificativa`.**
 * Justificar de novo grava linha nova (é histórico, não edição — ver
 * `schema/justificativa.ts`), então a existência é o que define o status e a
 * mais recente é o que a lista mostra. Contar linhas de justificativa como
 * "justificadas" contaria duas vezes a alteração reescrita, e o painel
 * passaria dos 100%.
 *
 * O recorte de origem é o mesmo de toda a família (`ALTERACAO_DE_ORIGEM_VISIVEL`)
 * e a linha sem placa (`LAYOUT_CHANGE`) fica de fora, pelo mesmo motivo de
 * `contagemPorTipo`: a fila de Justificativas não a mostra, então ela não pode
 * aparecer aqui como pendência que ninguém consegue justificar.
 */

/**
 * As alterações que a fila de Justificativas enfileira — as mesmas que ela
 * mostra.
 */
function alteracoesDaFilaDeJustificativas(changeSetIds: string[]): SQL {
  return and(
    inArray(changeTable.changeSetId, changeSetIds),
    sql`${changeTable.entityLabel} IS NOT NULL`,
    ALTERACAO_DE_ORIGEM_VISIVEL,
  )!;
}

/**
 * Se a alteração já foi justificada — por existência, e não por contagem.
 *
 * Subconsulta em vez de junção porque a junção multiplicaria a linha por
 * justificativa gravada, e todo `count(*)` deste arquivo teria de virar
 * `count(DISTINCT)` para dizer a verdade. `justificativa_change_id_idx`
 * sustenta o `EXISTS`.
 */
const JA_JUSTIFICADA: SQL = sql`EXISTS (
  SELECT 1 FROM justificativa j WHERE j.change_id = ${changeTable.id}
)`;

/**
 * A cobertura de uma comparação, quebrada por tipo de ativo — as mesmas duas
 * chaves de `contagemPorTipo`, para o painel poder recortar por aba sem uma
 * segunda ida ao banco.
 */
export interface CoberturaDeJustificativas {
  changeSetId: string;
  /** Cru, como a linha o gravou — quem normaliza é quem monta as abas. */
  entityType: string | null;
  alteracoes: number;
  justificadas: number;
  /** Placas distintas com alteração aqui. */
  placas: number;
  /** Placas com **ao menos uma** alteração ainda sem justificativa. */
  placasPendentes: number;
}

export async function coberturaDeJustificativas(
  db: Database,
  changeSetIds: string[],
): Promise<CoberturaDeJustificativas[]> {
  if (changeSetIds.length === 0) return [];

  return await db
    .select({
      changeSetId: changeTable.changeSetId,
      entityType: changeTable.entityType,
      alteracoes: sql<number>`count(*)`.mapWith(Number),
      justificadas:
        sql<number>`count(*) FILTER (WHERE ${JA_JUSTIFICADA})`.mapWith(Number),
      placas:
        sql<number>`count(DISTINCT ${changeTable.entityLabel})`.mapWith(Number),
      placasPendentes:
        sql<number>`count(DISTINCT ${changeTable.entityLabel}) FILTER (WHERE NOT ${JA_JUSTIFICADA})`.mapWith(
          Number,
        ),
    })
    .from(changeTable)
    .where(alteracoesDaFilaDeJustificativas(changeSetIds))
    .groupBy(changeTable.changeSetId, changeTable.entityType);
}

/**
 * Quem justificou, e quanto — o "Responsável" do painel.
 *
 * Por alteração distinta (`change_id`), e não por linha gravada: quem
 * reescreveu a própria justificativa três vezes explicou uma alteração, não
 * três. `ultimaEm` é a data mais recente do autor, que é o que ordena a lista.
 */
export interface AutorDeJustificativas {
  changeSetId: string;
  criadoPor: string;
  justificadas: number;
  ultimaEm: Date;
}

export async function autoresDeJustificativas(
  db: Database,
  changeSetIds: string[],
): Promise<AutorDeJustificativas[]> {
  if (changeSetIds.length === 0) return [];

  return await db
    .select({
      changeSetId: justificativaTable.changeSetId,
      criadoPor: justificativaTable.criadoPor,
      justificadas:
        sql<number>`count(DISTINCT ${justificativaTable.changeId})`.mapWith(
          Number,
        ),
      ultimaEm: sql<Date>`max(${justificativaTable.criadoEm})`,
    })
    .from(justificativaTable)
    .where(inArray(justificativaTable.changeSetId, changeSetIds))
    .groupBy(justificativaTable.changeSetId, justificativaTable.criadoPor);
}

/**
 * O que a alteração fez ao dinheiro — o recorte que o gestor pede por nome.
 *
 * Justificar existe por causa do impacto: o que se cobra explicação é da
 * alteração que subiu ou desceu um valor. `AUMENTO` e `REDUCAO` são o sinal do
 * delta apurado na comparação (`delta_absolute`), e `TODAS` é o que não
 * recorta. A alteração sem delta — texto, data, entrou/saiu — não é nem uma
 * nem outra, e por isso some dos dois recortes em vez de cair no maior deles.
 */
export type DirecaoDoImpacto = "TODAS" | "AUMENTO" | "REDUCAO";

export type SituacaoDaJustificativa = "TODAS" | "PENDENTE" | "JUSTIFICADA";

export interface FiltroDoPainel {
  changeSetIds: string[];
  /** Cru; a normalização do tipo é de quem chama, como nas abas. */
  entityType?: string | null;
  situacao?: SituacaoDaJustificativa;
  direcao?: DirecaoDoImpacto;
  /** Só faz sentido sobre as justificadas — é o autor da mais recente. */
  autor?: string;
  limit?: number;
  offset?: number;
}

/**
 * Uma linha da lista do painel: a alteração, e a justificativa dela quando
 * existe.
 */
export interface LinhaDoPainel {
  changeId: number;
  changeSetId: string;
  entityLabel: string;
  entityType: string | null;
  attributeCode: string | null;
  attributeName: string | null;
  valueBefore: string | null;
  valueAfter: string | null;
  /** O delta apurado — é o sinal dele que dá a direção do impacto. */
  deltaAbsolute: number | null;
  impactAmount: number | null;
  impactPeriodicity: string | null;
  /** `null` é a pendência: nunca foi justificada. */
  texto: string | null;
  criadoPor: string | null;
  criadoEm: Date | null;
}

const DELTA = sql`${changeTable.deltaAbsolute}`;

function condicaoDaDirecao(direcao: DirecaoDoImpacto): SQL | undefined {
  if (direcao === "AUMENTO") return sql`${DELTA} > 0`;
  if (direcao === "REDUCAO") return sql`${DELTA} < 0`;
  return undefined;
}

/**
 * A lista do painel — pendentes ou justificadas, paginada, com o total sem
 * paginação ao lado.
 *
 * A justificativa que entra na linha é **a mais recente** da alteração, pela
 * mesma regra que `GET /justificativas` aplica: reescrever grava linha nova, e
 * a lista mostra a que vale hoje. Aqui isso é uma janela (`row_number`) em vez
 * do de-duplicar em memória, porque a lista é paginada no banco — de-duplicar
 * depois do `LIMIT` devolveria menos linhas do que a página pediu.
 */
export async function linhasDoPainel(
  db: Database,
  filtro: FiltroDoPainel,
): Promise<{ total: number; linhas: LinhaDoPainel[] }> {
  const {
    changeSetIds,
    entityType,
    situacao = "TODAS",
    direcao = "TODAS",
    autor,
    limit = 10,
    offset = 0,
  } = filtro;
  if (changeSetIds.length === 0) return { total: 0, linhas: [] };

  const ultimas = db
    .select({
      changeId: justificativaTable.changeId,
      texto: justificativaTable.texto,
      criadoPor: justificativaTable.criadoPor,
      criadoEm: justificativaTable.criadoEm,
      ordem: sql<number>`row_number() OVER (
        PARTITION BY ${justificativaTable.changeId}
        ORDER BY ${justificativaTable.criadoEm} DESC, ${justificativaTable.id} DESC
      )`.as("ordem"),
    })
    .from(justificativaTable)
    .where(inArray(justificativaTable.changeSetId, changeSetIds))
    .as("ultimas");

  const onde = and(
    alteracoesDaFilaDeJustificativas(changeSetIds),
    entityType === undefined || entityType === null
      ? undefined
      : eq(changeTable.entityType, entityType),
    condicaoDaDirecao(direcao),
    situacao === "PENDENTE" ? isNull(ultimas.changeId) : undefined,
    situacao === "JUSTIFICADA" ? isNotNull(ultimas.changeId) : undefined,
    autor ? eq(ultimas.criadoPor, autor) : undefined,
  );

  const juncao = and(
    eq(ultimas.changeId, changeTable.id),
    eq(ultimas.ordem, sql`1`),
  )!;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(changeTable)
    .leftJoin(ultimas, juncao)
    .where(onde);

  const linhas = await db
    .select({
      changeId: changeTable.id,
      changeSetId: changeTable.changeSetId,
      entityLabel: changeTable.entityLabel,
      entityType: changeTable.entityType,
      attributeCode: changeTable.attributeCode,
      attributeName: changeTable.attributeName,
      valueBefore: changeTable.valueBefore,
      valueAfter: changeTable.valueAfter,
      deltaAbsolute: sql<number | null>`${changeTable.deltaAbsolute}`.mapWith(
        (v) => (v === null ? null : Number(v)),
      ),
      impactAmount: sql<number | null>`${changeTable.impactAmount}`.mapWith(
        (v) => (v === null ? null : Number(v)),
      ),
      impactPeriodicity: changeTable.impactPeriodicity,
      texto: ultimas.texto,
      criadoPor: ultimas.criadoPor,
      criadoEm: ultimas.criadoEm,
    })
    .from(changeTable)
    .leftJoin(ultimas, juncao)
    .where(onde)
    /*
      As justificadas descem da mais recente — é a leitura de "o que acabou de
      ser explicado". As pendentes não têm data nenhuma, então a ordem é a da
      fila: placa, e dentro dela o atributo, que é como o gestor as procura.
    */
    .orderBy(
      situacao === "JUSTIFICADA"
        ? desc(ultimas.criadoEm)
        : sql`${changeTable.entityLabel} ASC`,
      sql`${changeTable.attributeCode} ASC NULLS LAST`,
      changeTable.id,
    )
    .limit(limit)
    .offset(offset);

  return {
    total,
    linhas: linhas.map((l) => ({ ...l, entityLabel: l.entityLabel ?? "" })),
  };
}
