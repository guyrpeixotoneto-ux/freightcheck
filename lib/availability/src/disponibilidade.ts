import { sql, type SQL } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  chaveDeContextoSql,
  chaveDeSerieSql,
  filtroDeVigenciaDisponivel,
} from "./predicados";
import {
  classificarValor,
  type ChaveDeContexto,
  type ChaveDeSerie,
  type ContextoDisponivel,
  type EquipamentoDaVigencia,
  type EscopoDaVigencia,
  type Recorte,
  type ResultadoDaAnterior,
  type SerieDisponivel,
  type ValorClassificado,
  type VeredictoDeDisponibilidade,
  type VigenciaDisponivel,
} from "./modelo";

/**
 * A autoridade de disponibilidade — a resposta oficial para "esse dado existe?".
 *
 * ---------------------------------------------------------------------------
 * A fonte de verdade, e por que é esta
 * ---------------------------------------------------------------------------
 *
 * **Uma vigência está disponível quando existe uma linha em `snapshot` com
 * `status = 'CLOSED'`.** Não é escolha de conveniência; sai do modelo, e cada
 * alternativa foi medida antes de ser descartada.
 *
 * *Por que não RAW nem staging.* A separação já é estrutural: `raw_cell` e
 * `staged_fact` são outras tabelas, e `snapshot` só ganha linha **dentro da
 * transação de promoção**. Medido num arquivo lido e conferido mas não
 * promovido: 112 células RAW, 52 fatos em staging, `import_run` em `PREVIEWED`,
 * e **zero** linhas em `snapshot`. Não é preciso filtrar staging: ele não está
 * na tabela da pergunta.
 *
 * *Por que não a presença de fatos.* Uma vigência que entregou uma coluna
 * inteira vazia continua sendo uma vigência entregue. Definir disponibilidade
 * por `fact` faria "veio tudo vazio" e "não veio nada" darem a mesma resposta —
 * que é exatamente a confusão que este módulo existe para desfazer. Medido no
 * export real: 11.962 fatos declaram ausência (`EMPTY`, `VALUE_MISSING`) e
 * 17.717 são zero econômico. As três coisas são diferentes e todas existem.
 *
 * *Por que não a cobertura.* `@workspace/coverage` responde **quanto** do
 * esperado nós temos. É uma medição sobre o que está disponível, e portanto
 * vem depois — usá-la para definir disponibilidade seria circular.
 *
 * *Por que `= 'CLOSED'` e não `<> 'SUPERSEDED'`.* Ver `predicados.ts`: os dois
 * dão o mesmo conjunto, e o afirmativo diz a regra em vez de listar exceções.
 *
 * ---------------------------------------------------------------------------
 * O papel de cada tabela
 * ---------------------------------------------------------------------------
 *
 * | Pergunta | Autoridade |
 * |---|---|
 * | a vigência existe? | `snapshot.status = 'CLOSED'` |
 * | de quem ela é? | `snapshot.canonical_scope` — não `scope_hash` |
 * | de que canal? | `snapshot.canal` — não o regex sobre o rótulo |
 * | que equipamentos entregou? | `snapshot_entity_type` — não `entity_type_set` |
 * | que colunas trouxe? | `snapshot_attribute.present_in_layout` |
 * | como se chama a unidade? | `snapshot_scope` → `scope` (nome legível) |
 * | qual o valor de uma célula? | `fact` — conteúdo, não existência |
 * | e `entity`? | **nada.** Entidade é global: as 144 do export estão em todas as
 *   nove vigências. Presença numa vigência é ter fato nela, e quem conta isso é
 *   `snapshot_entity_type`. |
 *
 * ---------------------------------------------------------------------------
 * O que esta autoridade não responde
 * ---------------------------------------------------------------------------
 *
 * Elegibilidade. "Existe e não se aplica a esta análise" é decisão de domínio do
 * módulo — a DRE sabe que um equipamento sem regra de composição não se aplica a
 * ela, e a autoridade não tem como saber. O que ela garante é que a metade
 * factual da frase ("existe") seja a mesma para todo mundo.
 */

// ---------------------------------------------------------------------------
// A consulta base
// ---------------------------------------------------------------------------

interface LinhaDeVigencia extends Record<string, unknown> {
  id: string;
  source_label: string;
  effective_date: string;
  revision: number;
  import_run_id: string;
  source_system: string;
  dataset_family: string;
  canal: string;
  serie: string;
  contexto: string;
  entity_count: number;
  fact_count: number;
}

function recorteSql(recorte: Recorte, alias = "s"): SQL {
  const partes: SQL[] = [filtroDeVigenciaDisponivel(alias)];
  if (recorte.contexto !== undefined) {
    partes.push(sql`${chaveDeContextoSql(alias)} = ${recorte.contexto}`);
  }
  if (recorte.serie !== undefined) {
    partes.push(sql`${chaveDeSerieSql(alias)} = ${recorte.serie}`);
  }
  if (recorte.datasetFamily !== undefined) {
    partes.push(sql`${sql.raw(`${alias}.dataset_family`)} = ${recorte.datasetFamily}`);
  }
  if (recorte.antesDe !== undefined) {
    partes.push(sql`${sql.raw(`${alias}.effective_date`)} < ${recorte.antesDe}::date`);
  }
  if (recorte.entityType !== undefined) {
    partes.push(sql`EXISTS (
      SELECT 1 FROM snapshot_entity_type t
       WHERE t.snapshot_id = ${sql.raw(`${alias}.id`)}
         AND t.entity_type = ${recorte.entityType}
    )`);
  }
  return sql.join(partes, sql` AND `);
}

/** O escopo e o rótulo de cada vigência, numa consulta só. */
async function escoposDe(
  db: Database,
  ids: string[],
): Promise<Map<string, EscopoDaVigencia[]>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.execute<{
    snapshot_id: string;
    scope_type: string;
    code: string;
    name: string | null;
  }>(sql`
    SELECT ss.snapshot_id::text AS snapshot_id, sc.scope_type, sc.code, sc.name
      FROM snapshot_scope ss
      JOIN scope sc ON sc.id = ss.scope_id
     WHERE ss.snapshot_id = ANY(${sql`ARRAY[${sql.join(
       ids.map((id) => sql`${id}::uuid`),
       sql`, `,
     )}]`})
     ORDER BY sc.scope_type, sc.code
  `);
  const mapa = new Map<string, EscopoDaVigencia[]>();
  for (const r of rows) {
    const lista = mapa.get(r.snapshot_id) ?? [];
    lista.push({ scopeType: r.scope_type, code: r.code, name: r.name });
    mapa.set(r.snapshot_id, lista);
  }
  return mapa;
}

/** Os agregados por equipamento, numa consulta só. */
async function equipamentosDe(
  db: Database,
  ids: string[],
): Promise<Map<string, EquipamentoDaVigencia[]>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.execute<{
    snapshot_id: string;
    entity_type: string;
    entity_count: number;
    attribute_count: number;
    fact_count: number;
    value_count: number;
    null_count: number;
    inherited_fact_count: number;
  }>(sql`
    SELECT snapshot_id::text AS snapshot_id, entity_type, entity_count,
           attribute_count, fact_count, value_count, null_count,
           inherited_fact_count
      FROM snapshot_entity_type
     WHERE snapshot_id = ANY(${sql`ARRAY[${sql.join(
       ids.map((id) => sql`${id}::uuid`),
       sql`, `,
     )}]`})
     ORDER BY entity_type
  `);
  const mapa = new Map<string, EquipamentoDaVigencia[]>();
  for (const r of rows) {
    const lista = mapa.get(r.snapshot_id) ?? [];
    lista.push({
      entityType: r.entity_type,
      entidades: Number(r.entity_count),
      atributos: Number(r.attribute_count),
      fatos: Number(r.fact_count),
      comValor: Number(r.value_count),
      vazios: Number(r.null_count),
      herdados: Number(r.inherited_fact_count),
    });
    mapa.set(r.snapshot_id, lista);
  }
  return mapa;
}

/** "CAMAÇARI · EMPURRADA". A unidade manda; o canal entra ao lado. */
export function rotuloDoContexto(escopo: EscopoDaVigencia[], canal: string): string {
  const unidade = escopo.find((e) => e.scopeType === "UNIDADE");
  const cabeca = unidade?.name ?? unidade?.code ?? escopo[0]?.name ?? escopo[0]?.code;
  return cabeca ? `${cabeca} · ${canal}` : canal;
}

/**
 * As vigências disponíveis, em ordem cronológica.
 *
 * É o **censo**: todo módulo se mede contra esta lista. Um módulo pode mostrar
 * menos, desde que o recorte seja declarado e verificável — o que ele não pode
 * é chegar a um conjunto diferente para o mesmo recorte.
 */
export async function vigenciasDisponiveis(
  db: Database,
  recorte: Recorte = {},
): Promise<VigenciaDisponivel[]> {
  const { rows } = await db.execute<LinhaDeVigencia>(sql`
    SELECT s.id::text,
           s.source_label,
           s.effective_date::text AS effective_date,
           s.revision,
           s.import_run_id::text AS import_run_id,
           s.source_system,
           s.dataset_family,
           s.canal,
           ${chaveDeSerieSql("s")}    AS serie,
           ${chaveDeContextoSql("s")} AS contexto,
           s.entity_count,
           s.fact_count
      FROM snapshot s
     WHERE ${recorteSql(recorte)}
     ORDER BY s.effective_date, s.dataset_family
  `);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [escopos, equipamentos] = await Promise.all([
    escoposDe(db, ids),
    equipamentosDe(db, ids),
  ]);

  return rows.map((r) => {
    const escopo = escopos.get(r.id) ?? [];
    return {
      snapshotId: r.id,
      sourceLabel: r.source_label,
      effectiveDate: r.effective_date,
      revision: Number(r.revision),
      importRunId: r.import_run_id,
      sourceSystem: r.source_system,
      datasetFamily: r.dataset_family,
      canal: r.canal,
      serie: r.serie,
      contexto: r.contexto,
      rotulo: rotuloDoContexto(escopo, r.canal),
      escopo,
      equipamentos: equipamentos.get(r.id) ?? [],
      entidades: Number(r.entity_count),
      fatos: Number(r.fact_count),
    };
  });
}

/** Os contextos que já entregaram vigência — o seletor da tela. */
export async function contextosDisponiveis(
  db: Database,
): Promise<ContextoDisponivel[]> {
  const vigencias = await vigenciasDisponiveis(db);
  const porContexto = new Map<ChaveDeContexto, VigenciaDisponivel[]>();
  for (const v of vigencias) {
    const lista = porContexto.get(v.contexto) ?? [];
    lista.push(v);
    porContexto.set(v.contexto, lista);
  }
  return [...porContexto.entries()]
    .map(([chave, lista]) => {
      const datas = [...new Set(lista.map((v) => v.effectiveDate))].sort();
      return {
        chave,
        canal: lista[0].canal,
        escopo: lista[0].escopo,
        rotulo: lista[0].rotulo,
        series: [...new Set(lista.map((v) => v.serie))].sort(),
        periodos: datas.length,
        primeiraVigencia: datas[0],
        ultimaVigencia: datas[datas.length - 1],
      };
    })
    /* Mais recente primeiro, com desempate determinístico pela chave: deixar a
       ordem por conta do Postgres foi como o Painel passou a exibir a série de
       menor impacto e a omitir a maior, sem dizer que omitia. */
    .sort(
      (a, b) => b.ultimaVigencia.localeCompare(a.ultimaVigencia) || a.chave.localeCompare(b.chave),
    );
}

/** As séries disponíveis, com as datas que cada uma cobre. */
export async function seriesDisponiveis(db: Database): Promise<SerieDisponivel[]> {
  const vigencias = await vigenciasDisponiveis(db);
  const porSerie = new Map<ChaveDeSerie, VigenciaDisponivel[]>();
  for (const v of vigencias) {
    const lista = porSerie.get(v.serie) ?? [];
    lista.push(v);
    porSerie.set(v.serie, lista);
  }
  return [...porSerie.entries()]
    .map(([chave, lista]) => ({
      chave,
      contexto: lista[0].contexto,
      datasetFamily: lista[0].datasetFamily,
      canal: lista[0].canal,
      rotulo: lista[0].rotulo,
      periodos: [...new Set(lista.map((v) => v.effectiveDate))].sort(),
    }))
    .sort((a, b) => a.chave.localeCompare(b.chave));
}

/** A série a que uma vigência pertence, ou `null` se ela não está disponível. */
export async function serieDe(
  db: Database,
  snapshotId: string,
): Promise<ChaveDeSerie | null> {
  const { rows } = await db.execute<{ serie: string }>(sql`
    SELECT ${chaveDeSerieSql("s")} AS serie
      FROM snapshot s
     WHERE s.id = ${snapshotId}::uuid
       AND ${filtroDeVigenciaDisponivel("s")}
  `);
  return rows[0]?.serie ?? null;
}

/**
 * A vigência anterior da **mesma série**.
 *
 * Regra: mesma série, disponível, com a maior `effective_date` estritamente
 * menor que a do alvo. Não há critério de desempate porque não pode haver
 * empate — `snapshot_canonical_live_uq` é único sobre a identidade canônica, que
 * inclui a data, de modo que existe no máximo uma vigência disponível por
 * (série, data). A garantia é do banco, e não desta função.
 *
 * `entity_type_set` **não** entra. Uma entrega que passou a trazer cavalos além
 * das carretas continua sendo a próxima vigência da mesma série. O que a
 * cobertura de equipamento decide não é *se* há anterior: é **o que dela pode
 * ser comparado**, e isso é recorte da comparação, feito por componente em
 * `diffSnapshots`.
 *
 * Quando não há anterior, a resposta **nomeia o motivo**. `null` mudo é o que
 * fez "é a primeira da série" e "a série se partiu" virarem a mesma frase.
 */
export async function vigenciaAnterior(
  db: Database,
  snapshotId: string,
): Promise<ResultadoDaAnterior> {
  const { rows } = await db.execute<{ id: string }>(sql`
    SELECT anterior.id::text AS id
      FROM snapshot alvo
      JOIN snapshot anterior
        ON ${chaveDeSerieSql("anterior")} = ${chaveDeSerieSql("alvo")}
       AND ${filtroDeVigenciaDisponivel("anterior")}
       AND anterior.effective_date < alvo.effective_date
     WHERE alvo.id = ${snapshotId}::uuid
       AND ${filtroDeVigenciaDisponivel("alvo")}
     ORDER BY anterior.effective_date DESC
     LIMIT 1
  `);

  if (rows.length > 0) {
    const [vigencia] = await vigenciasPorId(db, [rows[0].id]);
    if (vigencia) return { encontrada: true, vigencia };
  }

  const serie = await serieDe(db, snapshotId);
  if (serie === null) {
    return {
      encontrada: false,
      motivo: "VIGENCIA_DESCONHECIDA",
      frase:
        "Não foi possível determinar a vigência anterior: esta vigência não está " +
        "disponível — ou não existe, ou foi substituída por uma revisão.",
    };
  }

  return {
    encontrada: false,
    motivo: "PRIMEIRA_DA_SERIE",
    frase: "Esta é a primeira vigência da série; não há anterior com que comparar.",
  };
}

/** As vigências destes ids, com tudo o que `vigenciasDisponiveis` traz. */
async function vigenciasPorId(
  db: Database,
  ids: string[],
): Promise<VigenciaDisponivel[]> {
  if (ids.length === 0) return [];
  const todas = await vigenciasDisponiveis(db);
  const procurados = new Set(ids);
  return todas.filter((v) => procurados.has(v.snapshotId));
}

/**
 * O veredito: existe, não existe em lugar nenhum, ou existe **em outro lugar**.
 *
 * É a função que um módulo chama antes de escrever "não há dados", e a razão de
 * ela existir é que a frase só é verdadeira num dos três casos. Quando o recorte
 * vem vazio e o sistema não, a resposta diz **onde** o dado está — o que
 * transforma uma tela vazia numa tela que explica.
 */
export async function verificarDisponibilidade(
  db: Database,
  recorte: Recorte = {},
): Promise<VeredictoDeDisponibilidade> {
  const vigencias = await vigenciasDisponiveis(db, recorte);
  if (vigencias.length > 0) return { estado: "DISPONIVEL", vigencias };

  const contextos = await contextosDisponiveis(db);
  if (contextos.length === 0) return { estado: "VAZIO_GLOBAL" };

  const onde = contextos.map((c) => c.rotulo).join(", ");
  return {
    estado: "VAZIO_NO_RECORTE",
    existemEm: contextos,
    motivo:
      `Não há vigência para o recorte pedido. O sistema tem vigência importada em: ${onde}.`,
  };
}

/**
 * Os equipamentos que um recorte entregou, com o total de ativos de cada um.
 *
 * Sai de `snapshot_entity_type`, sem tocar `fact` — a tabela que cresce para
 * milhões. `entity_type_set` seria mais barato ainda e está errado: ele é o
 * rótulo do que a vigência **declara** cobrir, e cresce quando uma revisão
 * parcial herda componentes que o arquivo não trouxe.
 */
export async function equipamentosDisponiveis(
  db: Database,
  recorte: Recorte = {},
): Promise<{ entityType: string; vigencias: number; entidades: number }[]> {
  const { rows } = await db.execute<{
    entity_type: string;
    vigencias: number;
    entidades: number;
  }>(sql`
    SELECT t.entity_type,
           count(DISTINCT s.id)::int   AS vigencias,
           max(t.entity_count)::int    AS entidades
      FROM snapshot s
      JOIN snapshot_entity_type t ON t.snapshot_id = s.id
     WHERE ${recorteSql(recorte)}
     GROUP BY t.entity_type
     ORDER BY t.entity_type
  `);
  return rows.map((r) => ({
    entityType: r.entity_type,
    vigencias: Number(r.vigencias),
    entidades: Number(r.entidades),
  }));
}

/**
 * Os atributos que um recorte trouxe no layout.
 *
 * `present_in_layout` é o que separa "a coluna sumiu do arquivo" de "a coluna
 * está lá e este ativo não tem valor". As duas se parecem numa tela e
 * significam coisas opostas.
 */
export async function atributosDisponiveis(
  db: Database,
  recorte: Recorte = {},
): Promise<
  {
    code: string;
    entityType: string;
    dataType: string;
    semanticsStatus: string;
    vigencias: number;
    comValor: number;
  }[]
> {
  const { rows } = await db.execute<{
    code: string;
    entity_type: string;
    data_type: string;
    semantics_status: string;
    vigencias: number;
    com_valor: number;
  }>(sql`
    SELECT a.code, a.entity_type, a.data_type,
           a.semantics_status::text AS semantics_status,
           count(DISTINCT s.id)::int AS vigencias,
           sum(sa.value_count)::int  AS com_valor
      FROM snapshot s
      JOIN snapshot_attribute sa ON sa.snapshot_id = s.id AND sa.present_in_layout
      JOIN attribute a           ON a.id = sa.attribute_id
     WHERE ${recorteSql(recorte)}
       AND (${recorte.entityType ?? null}::text IS NULL OR a.entity_type = ${recorte.entityType ?? null})
     GROUP BY a.code, a.entity_type, a.data_type, a.semantics_status
     ORDER BY a.entity_type, a.code
  `);
  return rows.map((r) => ({
    code: r.code,
    entityType: r.entity_type,
    dataType: r.data_type,
    semanticsStatus: r.semantics_status,
    vigencias: Number(r.vigencias),
    comValor: Number(r.com_valor),
  }));
}

/**
 * O que há numa célula — vigência, ativo e atributo —, classificado.
 *
 * Uma consulta, e não três, porque as três perguntas precisam ser respondidas
 * sobre o **mesmo instante**: se o atributo pertence ao equipamento, se a
 * vigência trouxe a coluna, e se há fato. Respondê-las em consultas separadas
 * abriria a porta para a resposta ser montada com metades de estados
 * diferentes.
 */
export async function estadoDoValor(
  db: Database,
  snapshotId: string,
  entityId: string,
  attributeCode: string,
): Promise<ValorClassificado> {
  const { rows } = await db.execute<{
    atributo_do_equipamento: boolean;
    coluna_no_layout: boolean;
    tem_fato: boolean;
    is_null: boolean | null;
    null_reason: string | null;
    value_numeric: string | null;
  }>(sql`
    SELECT (a.entity_type = e.entity_type)                       AS atributo_do_equipamento,
           coalesce(sa.present_in_layout, false)                 AS coluna_no_layout,
           (f.id IS NOT NULL)                                    AS tem_fato,
           f.is_null,
           f.null_reason,
           f.value_numeric::text                                 AS value_numeric
      FROM attribute a
      CROSS JOIN entity e
      LEFT JOIN snapshot_attribute sa
             ON sa.snapshot_id = ${snapshotId}::uuid AND sa.attribute_id = a.id
      LEFT JOIN fact f
             ON f.snapshot_id = ${snapshotId}::uuid
            AND f.entity_id = e.id
            AND f.attribute_id = a.id
     WHERE a.code = ${attributeCode}
       AND e.id = ${entityId}::uuid
  `);

  const linha = rows[0];
  if (!linha) {
    return {
      estado: "NAO_APLICAVEL",
      valor: null,
      motivo: "Atributo ou ativo desconhecido.",
    };
  }

  return classificarValor({
    atributoDoEquipamento: linha.atributo_do_equipamento,
    colunaNoLayout: linha.coluna_no_layout,
    fato: linha.tem_fato
      ? {
          isNull: linha.is_null ?? false,
          nullReason: linha.null_reason,
          valueNumeric: linha.value_numeric,
        }
      : null,
  });
}
