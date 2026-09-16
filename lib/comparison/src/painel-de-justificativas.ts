import { and, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { Database } from "@workspace/db";

import { TIPOS_FORA_DO_PAINEL_DE_JUSTIFICATIVAS } from "./painel-de-justificativas-escopo";
import {
  rubricaDaAlteracao,
  type ChaveDeModulo,
} from "./modulos-de-justificativa";
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
 *
 * **E o trecho fica de fora deste painel** — só dele, e não do produto: as três
 * leituras aqui recortam a população por `DENTRO_DO_PAINEL`, e o porquê está em
 * `painel-de-justificativas-escopo.ts`. É a única diferença de população entre
 * esta tela e a fila, e por isso ela está escrita numa condição com nome, e não
 * dissolvida nas outras.
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
 * O tipo de ativo está dentro do que este painel cobra.
 *
 * É a condição que tira o trecho da leitura inteira — a razão está em
 * `painel-de-justificativas-escopo.ts`. Ela é **separada** de
 * `alteracoesDaFilaDeJustificativas` de propósito: aquela função quer dizer "as
 * mesmas alterações que a fila mostra", e a fila continua mostrando trecho.
 * Somá-las numa condição só apagaria a diferença entre as duas telas, que é
 * justamente o que passou a existir.
 *
 * `entity_type` nulo passa: a alteração sem tipo declarado não é trecho, e o
 * painel a cobra como sempre cobrou. A normalização é a mesma das abas —
 * maiúsculas, sem espaço em volta —, porque o tipo é texto livre no banco.
 */
const DENTRO_DO_PAINEL: SQL =
  /* Lista vazia é "o painel cobra tudo", e não `NOT IN ()` — que o Postgres
     recusa como erro de sintaxe, derrubando as três consultas de uma vez. */
  TIPOS_FORA_DO_PAINEL_DE_JUSTIFICATIVAS.length === 0
    ? sql`TRUE`
    : sql`(
        ${changeTable.entityType} IS NULL
        OR upper(btrim(${changeTable.entityType})) NOT IN (${sql.join(
          TIPOS_FORA_DO_PAINEL_DE_JUSTIFICATIVAS.map((tipo) => sql`${tipo}`),
          sql`, `,
        )})
      )`;

/** A população do painel: a fila, menos os tipos que ele não cobra. */
function alteracoesDoPainel(changeSetIds: string[]): SQL {
  return and(alteracoesDaFilaDeJustificativas(changeSetIds), DENTRO_DO_PAINEL)!;
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
    .where(alteracoesDoPainel(changeSetIds))
    .groupBy(changeTable.changeSetId, changeTable.entityType);
}

/**
 * Quem justificou, e quanto — o "Responsável" do painel.
 *
 * Por alteração distinta (`change_id`), e não por linha gravada: quem
 * reescreveu a própria justificativa três vezes explicou uma alteração, não
 * três. `ultimaEm` é a data mais recente do autor, que é o que ordena a lista.
 *
 * A junção com `change` está aqui pelo mesmo recorte de população das outras
 * duas consultas: sem ela, um autor apareceria no filtro com uma contagem que
 * inclui trecho, e escolhê-lo devolveria uma lista menor do que o número
 * escrito ao lado do nome. É junção por `id`, que é único — ela recorta, e não
 * multiplica a contagem.
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
    .innerJoin(changeTable, eq(changeTable.id, justificativaTable.changeId))
    .where(
      and(
        inArray(justificativaTable.changeSetId, changeSetIds),
        DENTRO_DO_PAINEL,
      ),
    )
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
  /* A classe de custo instantânea da alteração — é ela que diz de que módulo a
     linha é, pela régua de `modulos-de-justificativa.ts`. Viaja com a linha
     porque o CSV do Monitor escreve módulo e rubrica em cada uma, e recalculá-la
     no cliente a partir de outra fonte faria o arquivo discordar da tela. */
  costClass: string | null;
  valueBefore: string | null;
  valueAfter: string | null;
  /** O delta apurado — é o sinal dele que dá a direção do impacto. */
  deltaAbsolute: number | null;
  impactAmount: number | null;
  impactPeriodicity: string | null;
  /** `null` é a pendência: nunca foi justificada. */
  texto: string | null;
  /*
    A justificativa estruturada da linha — a mesma da tabela, e pelo mesmo
    motivo que `texto` viaja junto: reabrir uma linha já justificada no painel
    tem de trazer de volta a fórmula e a regra que foram gravadas, ou o
    diálogo pediria de novo o que já está escrito.
  */
  formula: string | null;
  regra: string | null;
  conforme: boolean | null;
  naoConformidade: string | null;
  motivoExcecao: string | null;
  responsavelAprovacao: string | null;
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
      formula: justificativaTable.formula,
      regra: justificativaTable.regra,
      conforme: justificativaTable.conforme,
      naoConformidade: justificativaTable.naoConformidade,
      motivoExcecao: justificativaTable.motivoExcecao,
      responsavelAprovacao: justificativaTable.responsavelAprovacao,
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
    alteracoesDoPainel(changeSetIds),
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
      costClass: changeTable.costClass,
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
      formula: ultimas.formula,
      regra: ultimas.regra,
      conforme: ultimas.conforme,
      naoConformidade: ultimas.naoConformidade,
      motivoExcecao: ultimas.motivoExcecao,
      responsavelAprovacao: ultimas.responsavelAprovacao,
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

/**
 * A cobertura quebrada por **rubrica** — a leitura que o Monitor cobra.
 *
 * A cobertura por tipo de ativo responde a quem mandar a fila; esta responde
 * *para onde mandar*: cada linha é uma rubrica, e a rubrica tem tela — é lá que
 * a justificativa se escreve desde que cada módulo passou a justificar as
 * próprias alterações. Quem sabe em que rubrica cada atributo entra é
 * `modulos-de-justificativa.ts`, e é de propósito que ele não esteja no SQL: o
 * mapa é o mesmo que a tela lê para escrever o nome e montar o link, e uma
 * segunda régua escrita em `CASE WHEN` discordaria dela no primeiro catálogo
 * que crescesse.
 *
 * O banco agrupa por **atributo**, que é o grão que ele tem; a dobra em rubrica
 * acontece aqui, em memória, sobre algumas centenas de linhas. É a mesma
 * divisão de trabalho de `contagemPorTipo`: contar é do Postgres, nomear é do
 * mapa.
 *
 * `ultimaEm` e `ultimoAutor` são da justificativa **mais recente** da rubrica —
 * o "última justificativa" da tabela. Eles não dizem de quem é a pendência:
 * este produto não atribui responsável a alteração nenhuma, e escrever um nome
 * ao lado de uma pendência afirmaria uma atribuição que não existe. Dizem quem
 * esteve ali por último, que é o que o dado sustenta.
 */
export interface CoberturaDeRubrica {
  changeSetId: string;
  /** Cru, como a linha o gravou — quem normaliza é quem monta as abas. */
  entityType: string | null;
  modulo: ChaveDeModulo;
  /** A chave da rubrica em `modulos-de-justificativa.ts`. */
  rubrica: string;
  alteracoes: number;
  justificadas: number;
  ultimaEm: Date | null;
  ultimoAutor: string | null;
}

export async function coberturaPorRubrica(
  db: Database,
  changeSetIds: string[],
): Promise<CoberturaDeRubrica[]> {
  if (changeSetIds.length === 0) return [];

  /* A mais recente de cada alteração, pela régua de `linhasDoPainel`:
     reescrever grava linha nova, e a que vale é a última. */
  const ultimas = db
    .select({
      changeId: justificativaTable.changeId,
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

  const linhas = await db
    .select({
      changeSetId: changeTable.changeSetId,
      entityType: changeTable.entityType,
      attributeCode: changeTable.attributeCode,
      costClass: changeTable.costClass,
      alteracoes: sql<number>`count(*)`.mapWith(Number),
      justificadas: sql<number>`count(${ultimas.changeId})`.mapWith(Number),
      /* Convertida aqui: o driver devolve o `max` de um timestamp como texto, e
         a dobra em rubrica compara datas entre si para achar a mais recente —
         comparar texto com `Date` acertaria por acaso enquanto os dois viessem
         no mesmo formato. */
      ultimaEm: sql<Date | null>`max(${ultimas.criadoEm})`.mapWith((v) =>
        v === null ? null : new Date(v),
      ),
      /* O autor da justificativa mais recente do grupo. `array_agg` ordenado é
         o que devolve um valor de *outra* coluna da linha que o `max` escolheu
         — um segundo `max(criado_por)` traria o maior nome em ordem alfabética,
         que não é quem escreveu por último. */
      ultimoAutor: sql<string | null>`(array_agg(
        ${ultimas.criadoPor} ORDER BY ${ultimas.criadoEm} DESC NULLS LAST
      ) FILTER (WHERE ${ultimas.criadoPor} IS NOT NULL))[1]`,
    })
    .from(changeTable)
    .leftJoin(
      ultimas,
      and(eq(ultimas.changeId, changeTable.id), eq(ultimas.ordem, sql`1`))!,
    )
    .where(alteracoesDoPainel(changeSetIds))
    .groupBy(
      changeTable.changeSetId,
      changeTable.entityType,
      changeTable.attributeCode,
      changeTable.costClass,
    );

  return dobrarEmRubricas(linhas);
}

/** Uma linha do banco, antes de saber em que rubrica ela entra. */
export interface ContagemPorAtributo {
  changeSetId: string;
  entityType: string | null;
  attributeCode: string | null;
  costClass: string | null;
  alteracoes: number;
  justificadas: number;
  ultimaEm: Date | null;
  ultimoAutor: string | null;
}

/**
 * A dobra de atributo em rubrica — separada da consulta para poder ser testada
 * sem um Postgres de pé, como todo o resto do pacote.
 */
export function dobrarEmRubricas(
  linhas: readonly ContagemPorAtributo[],
): CoberturaDeRubrica[] {
  const porChave = new Map<string, CoberturaDeRubrica>();

  for (const linha of linhas) {
    const rubrica = rubricaDaAlteracao(linha);
    /* JSON, e não uma concatenação com separador: um `entity_type` que
       contivesse o separador faria dois grupos virarem um em silêncio. */
    const chave = JSON.stringify([
      linha.changeSetId,
      linha.entityType,
      rubrica.chave,
    ]);
    const atual = porChave.get(chave);
    if (!atual) {
      porChave.set(chave, {
        changeSetId: linha.changeSetId,
        entityType: linha.entityType,
        modulo: rubrica.modulo,
        rubrica: rubrica.chave,
        alteracoes: linha.alteracoes,
        justificadas: linha.justificadas,
        ultimaEm: linha.ultimaEm,
        ultimoAutor: linha.ultimoAutor,
      });
      continue;
    }
    atual.alteracoes += linha.alteracoes;
    atual.justificadas += linha.justificadas;
    /* A mais recente entre os atributos da rubrica — e o autor **dela**, e não
       o de outro atributo com data mais antiga. */
    if (
      linha.ultimaEm !== null &&
      (atual.ultimaEm === null || linha.ultimaEm > atual.ultimaEm)
    ) {
      atual.ultimaEm = linha.ultimaEm;
      atual.ultimoAutor = linha.ultimoAutor;
    }
  }

  return [...porChave.values()];
}
