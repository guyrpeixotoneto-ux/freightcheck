import { sql } from "drizzle-orm";
import {
  chaveDeEscopoSql,
  chaveDeSerieSql,
  filtroDeVigenciaDisponivel,
} from "@workspace/availability";
import type { Database } from "@workspace/db";

/**
 * O observado — o que o FreightCheck de fato tem, depois de consolidar tudo.
 *
 * **Arquivo não é a unidade de medida; dado é.** Isso não precisou ser
 * construído: o `promote` já funde entregas parciais na vigência canônica que
 * já existe. Medido no export real, `Modelo_Carreta.xlsx` abre nove vigências
 * com `entity_type_set = CARRETA` e `Modelo_Cavalo.xlsx` as leva a
 * `CARRETA+CAVALO` na revisão 2, herdando os fatos que ele não toca. A união
 * semântica acontece antes de a cobertura existir; este arquivo só a lê.
 *
 * Por isso não há aqui nenhuma soma de arquivos, nenhuma média de percentuais
 * por importação e nenhuma contagem de linhas. Reimportar o mesmo dado não
 * aumenta nada porque não cria fato nenhum — ou o SHA-256 barra o arquivo, ou o
 * `canonical_payload_hash` barra o conteúdo, ou a revisão substitui a anterior.
 *
 * **Nenhuma consulta deste arquivo toca `fact`, com uma exceção declarada.** O
 * observado sai de `snapshot_entity_type` (uma linha por vigência e
 * equipamento) e de `snapshot_attribute` (uma por vigência e coluna) — as duas
 * escritas na promoção, as duas pequenas. A exceção é o não aplicável, que só
 * existe em `fact.null_reason` e é lido por um índice parcial feito para isso.
 */

/** Uma vigência ativa, com o agregado de cada equipamento que ela cobre. */
export interface VigenciaObservada {
  snapshotId: string;
  sourceSystem: string;
  datasetFamily: string;
  canal: string;
  /**
   * A chave de escopo **canônica**, vinda de `chaveDeEscopoSql`.
   *
   * Era `snapshot.scope_hash`, que é hash dos códigos **como vieram**: a mesma
   * unidade com o CNPJ mascarado num arquivo e sem máscara noutro virava duas,
   * e a Cobertura media duas unidades onde há uma. O nome continua sendo
   * `scopeHash` — é um hash —, e o que mudou é **de que** ele é hash.
   */
  scopeHash: string;
  /**
   * A chave de **série** da autoridade: sistema, família e contexto.
   *
   * A matriz agrupava as vigências por `${datasetFamily}|${scopeHash}|${canal}`,
   * remontando à mão a chave que o banco já sabe calcular. Ela vem pronta.
   */
  serie: string;
  /** O escopo canônico serializado — a chave de recorte por unidade. */
  scopeKey: string;
  scopeLabel: string;
  effectiveDate: string;
  sourceLabel: string;
  revision: number;
  importRunId: string;
  equipamentos: {
    entityType: string;
    entidades: number;
    atributos: number;
    fatos: number;
    comValor: number;
    vazios: number;
    herdados: number;
  }[];
}

/**
 * Todas as vigências ativas, com os agregados prontos.
 *
 * Quem diz o que é "vigência disponível" é `filtroDeVigenciaDisponivel`, da
 * autoridade. Aqui estava escrito `status <> 'SUPERSEDED'` — que responde à
 * mesma pergunta e não é a mesma frase: ela inclui `DRAFT`, que é a vigência
 * ainda sendo montada dentro de uma transação. Nos bancos que existem hoje as
 * duas dão o mesmo conjunto; a diferença é que agora só há uma definição, e
 * mudá-la muda todos os módulos de uma vez.
 *
 * Duas consultas e um `Map`, em vez de um join com agregação: a lista de
 * vigências é pequena — dezenas hoje, milhares no horizonte — e juntar em
 * memória evita que o Postgres materialize o produto de vigências por
 * equipamentos só para desmontá-lo em seguida.
 */
export async function vigenciasObservadas(
  db: Database,
  filtro: { datasetFamily?: string; scopeHash?: string; canal?: string | null } = {},
): Promise<VigenciaObservada[]> {
  const { rows } = await db.execute<{
    id: string;
    source_system: string;
    dataset_family: string;
    canal: string;
    chave_de_escopo: string;
    serie: string;
    scope_key: string;
    scope_label: string;
    effective_date: string;
    source_label: string;
    revision: number;
    import_run_id: string;
  }>(sql`
    SELECT s.id,
           s.source_system,
           s.dataset_family,
           s.canal,
           ${chaveDeEscopoSql("s")}                    AS chave_de_escopo,
           ${chaveDeSerieSql("s")}                     AS serie,
           s.canonical_scope::text                     AS scope_key,
           coalesce(
             (SELECT string_agg(coalesce(sc.name, sc.code), ' · ' ORDER BY sc.scope_type)
                FROM snapshot_scope ss JOIN scope sc ON sc.id = ss.scope_id
               WHERE ss.snapshot_id = s.id AND sc.scope_type = 'UNIDADE'),
             -- Sem UNIDADE nomeada, o rótulo é o começo da chave canônica.
             -- Era o começo do scope_hash, e ali duas grafias do mesmo CNPJ
             -- davam dois rótulos diferentes para a mesma unidade.
             left(${chaveDeEscopoSql("s")}, 8)
           )                                           AS scope_label,
           s.effective_date::text,
           s.source_label,
           s.revision,
           s.import_run_id
      FROM snapshot s
     WHERE ${filtroDeVigenciaDisponivel("s")}
       AND (${filtro.datasetFamily ?? null}::text IS NULL OR s.dataset_family = ${filtro.datasetFamily ?? null})
       AND (${filtro.scopeHash ?? null}::text IS NULL
            OR ${chaveDeEscopoSql("s")} = ${filtro.scopeHash ?? null})
       AND (${filtro.canal === undefined ? null : filtro.canal}::text IS NULL
            OR s.canal = ${filtro.canal === undefined ? null : filtro.canal})
     ORDER BY s.effective_date, s.dataset_family, s.canal
  `);

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const { rows: agregados } = await db.execute<{
    snapshot_id: string;
    entity_type: string;
    entity_count: number;
    attribute_count: number;
    fact_count: number;
    value_count: number;
    null_count: number;
    inherited_fact_count: number;
  }>(sql`
    SELECT snapshot_id, entity_type, entity_count, attribute_count,
           fact_count, value_count, null_count, inherited_fact_count
      FROM snapshot_entity_type
     WHERE snapshot_id = ANY(${sql`ARRAY[${sql.join(
       ids.map((id) => sql`${id}::uuid`),
       sql`, `,
     )}]`})
     ORDER BY entity_type
  `);

  const porSnapshot = new Map<string, VigenciaObservada["equipamentos"]>();
  for (const a of agregados) {
    const lista = porSnapshot.get(a.snapshot_id) ?? [];
    lista.push({
      entityType: a.entity_type,
      entidades: Number(a.entity_count),
      atributos: Number(a.attribute_count),
      fatos: Number(a.fact_count),
      comValor: Number(a.value_count),
      vazios: Number(a.null_count),
      herdados: Number(a.inherited_fact_count),
    });
    porSnapshot.set(a.snapshot_id, lista);
  }

  return rows.map((r) => ({
    snapshotId: r.id,
    sourceSystem: r.source_system,
    datasetFamily: r.dataset_family,
    canal: r.canal,
    scopeHash: r.chave_de_escopo,
    serie: r.serie,
    scopeKey: r.scope_key,
    scopeLabel: r.scope_label,
    effectiveDate: r.effective_date,
    sourceLabel: r.source_label,
    revision: Number(r.revision),
    importRunId: r.import_run_id,
    equipamentos: porSnapshot.get(r.id) ?? [],
  }));
}

/** O que uma vigência entregou, atributo a atributo. */
export interface AtributoObservado {
  snapshotId: string;
  attributeId: string;
  attributeCode: string;
  attributeLabel: string;
  entityType: string;
  /** Entidades com valor. `fact.is_null = false`. */
  comValor: number;
  /** Entidades com a coluna entregue e sem valor. */
  vazias: number;
  /** Destas, as que declaram NOT_APPLICABLE. Nunca contam como lacuna. */
  naoAplicaveis: number;
  noLayout: boolean;
  /** O nome literal da coluna no arquivo. Nunca reescrito. */
  sourceName: string;
  semanticsStatus: string;
}

/**
 * O layout de um conjunto de vigências.
 *
 * `snapshot_attribute` responde isto inteiro sem tocar em `fact`: a promoção já
 * gravou ali quantos valores e quantos nulos cada coluna trouxe. É o que torna
 * a matriz barata — 1.809 linhas para os 124.632 fatos do export real, e a
 * tabela cresce com vigências × colunas, não com entidades.
 */
export async function atributosObservados(
  db: Database,
  snapshotIds: string[],
): Promise<AtributoObservado[]> {
  if (snapshotIds.length === 0) return [];
  const lista = sql`ARRAY[${sql.join(
    snapshotIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]`;

  const { rows } = await db.execute<{
    snapshot_id: string;
    attribute_id: string;
    code: string;
    display_name: string | null;
    source_name: string;
    entity_type: string;
    semantics_status: string;
    value_count: number;
    null_count: number;
    present_in_layout: boolean;
    nao_aplicaveis: number;
  }>(sql`
    SELECT sa.snapshot_id,
           sa.attribute_id,
           a.code,
           a.display_name,
           a.source_name,
           a.entity_type,
           a.semantics_status::text                    AS semantics_status,
           sa.value_count,
           sa.null_count,
           sa.present_in_layout,
           /*
             O único ponto do observado que desce ao fato, e ele desce por um
             índice parcial (fact_nao_aplicavel_idx) que só indexa as linhas
             com este motivo. Sem a subconsulta, uma dispensa legítima da origem
             viraria lacuna; com um índice cheio, a matriz pagaria o tamanho da
             fact table para descobrir isso.
           */
           coalesce((
             SELECT count(*) FROM fact f
              WHERE f.snapshot_id = sa.snapshot_id
                AND f.attribute_id = sa.attribute_id
                AND f.null_reason = 'NOT_APPLICABLE'
           ), 0)::int                                  AS nao_aplicaveis
      FROM snapshot_attribute sa
      JOIN attribute a ON a.id = sa.attribute_id
     WHERE sa.snapshot_id = ANY(${lista})
     ORDER BY a.entity_type, a.code
  `);

  return rows.map((r) => ({
    snapshotId: r.snapshot_id,
    attributeId: r.attribute_id,
    attributeCode: r.code,
    attributeLabel: r.display_name ?? r.source_name,
    entityType: r.entity_type,
    comValor: Number(r.value_count),
    vazias: Number(r.null_count),
    naoAplicaveis: Number(r.nao_aplicaveis),
    noLayout: r.present_in_layout,
    sourceName: r.source_name,
    semanticsStatus: r.semantics_status,
  }));
}

/**
 * As entidades de um tipo numa vigência, com e sem o atributo pedido.
 *
 * É o último degrau do drill-down — "quais placas" — e o primeiro que precisa
 * de `fact`. Cabe: o predicado é `(snapshot_id, attribute_id)`, que é o começo
 * de `fact_snapshot_attribute_idx`, e o conjunto é uma coluna de uma vigência,
 * não a tabela.
 *
 * O `LEFT JOIN` é o que responde a pergunta certa. Um `INNER JOIN` listaria
 * quem tem o fato e chamaria o resto de inexistente; aqui a entidade sem fato
 * aparece com `estado = 'AUSENTE'`, que é justamente o que se foi procurar.
 */
export async function entidadesDoAtributo(
  db: Database,
  snapshotId: string,
  attributeCode: string,
  opcoes: { apenasFaltando?: boolean; limite?: number } = {},
): Promise<
  {
    entityId: string;
    identificador: string;
    entityType: string;
    estado: "PRESENTE" | "VAZIO" | "NAO_APLICAVEL" | "AUSENTE";
    nullReason: string | null;
    valor: string | null;
    factId: number | null;
  }[]
> {
  const limite = Math.min(opcoes.limite ?? 500, 2000);
  const { rows } = await db.execute<{
    entity_id: string;
    identificador: string;
    entity_type: string;
    estado: "PRESENTE" | "VAZIO" | "NAO_APLICAVEL" | "AUSENTE";
    null_reason: string | null;
    valor: string | null;
    fact_id: string | null;
  }>(sql`
    WITH alvo AS (
      SELECT id, entity_type FROM attribute WHERE code = ${attributeCode}
    ),
    universo AS (
      SELECT DISTINCT f.entity_id
        FROM fact f
        JOIN entity e ON e.id = f.entity_id
       WHERE f.snapshot_id = ${snapshotId}::uuid
         AND e.entity_type = (SELECT entity_type FROM alvo)
    )
    SELECT u.entity_id,
           coalesce(
             (SELECT ei.identifier_value FROM entity_identifier ei
               WHERE ei.entity_id = u.entity_id AND ei.identifier_type = 'PLACA'
               ORDER BY ei.is_current DESC, ei.effective_from DESC LIMIT 1),
             left(u.entity_id::text, 8)
           )                                            AS identificador,
           e.entity_type,
           CASE
             WHEN f.id IS NULL                                 THEN 'AUSENTE'
             WHEN f.null_reason = 'NOT_APPLICABLE'             THEN 'NAO_APLICAVEL'
             WHEN f.is_null                                    THEN 'VAZIO'
             ELSE 'PRESENTE'
           END                                          AS estado,
           f.null_reason,
           coalesce(f.value_text, f.value_numeric::text, f.value_boolean::text,
                    f.value_date::text)                 AS valor,
           f.id::text                                   AS fact_id
      FROM universo u
      JOIN entity e ON e.id = u.entity_id
      LEFT JOIN fact f
        ON f.snapshot_id = ${snapshotId}::uuid
       AND f.entity_id = u.entity_id
       AND f.attribute_id = (SELECT id FROM alvo)
     WHERE ${opcoes.apenasFaltando ? sql`f.id IS NULL OR (f.is_null AND f.null_reason <> 'NOT_APPLICABLE')` : sql`true`}
     ORDER BY 2
     LIMIT ${limite}
  `);

  return rows.map((r) => ({
    entityId: r.entity_id,
    identificador: r.identificador,
    entityType: r.entity_type,
    estado: r.estado,
    nullReason: r.null_reason,
    valor: r.valor,
    factId: r.fact_id === null ? null : Number(r.fact_id),
  }));
}
