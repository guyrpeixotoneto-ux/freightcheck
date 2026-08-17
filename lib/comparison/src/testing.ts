import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { listContexts, type SeriesContext } from "./series";
import {
  attributeTable,
  entityIdentifierTable,
  entityTable,
  factTable,
  importRunTable,
  rawCellTable,
  rawRowTable,
  rawSheetTable,
  scopeTable,
  snapshotAttributeTable,
  snapshotEntityTypeTable,
  snapshotScopeTable,
  snapshotTable,
  sourceFileTable,
  taxonomyNodeTable,
} from "@workspace/db";

/**
 * Synthetic canonical fixtures.
 *
 * The comparison engine reads the canonical layer, so a test can build that
 * layer directly and control exactly one variable at a time — something the
 * real 83k-fact export cannot do. Every fact still gets a real RAW cell behind
 * it, because the engine's traceability guarantees are part of what is
 * under test.
 */

export interface AttributeSpec {
  code: string;
  dataType: "NUMERIC" | "TEXT" | "BOOLEAN" | "DATE" | "MIXED";
  semanticsStatus?: "CONFIRMED" | "PRESUMED" | "UNKNOWN";
  unit?: string | null;
  periodicity?: string | null;
  aggregation?: string | null;
  isMonetary?: boolean | null;
  taxonomyCode?: string;
}

/**
 * `null` means the fact is absent for that asset in that snapshot.
 *
 * `{ date }` writes a real `value_date`, which no other form can produce: a
 * date arriving as a string would land in `value_text` and a test about how
 * dates behave would be testing text. `fact_exactly_one_value` is what makes
 * the distinction matter — the column a value lands in *is* its type.
 */
export type CellValue =
  | number
  | string
  | boolean
  | null
  | { missing: string }
  | { date: string };

export interface SnapshotSpec {
  label: string;
  effectiveDate: string;
  /** plate -> attribute code -> value */
  data: Record<string, Record<string, CellValue>>;
}

export interface FixtureResult {
  snapshotIds: Record<string, string>;
}

export interface FixtureOptions {
  /** Equipment type, which is also the snapshot's entity_type_set. */
  entityType?: string;
  /**
   * De que **unidade** é esta entrega.
   *
   * Duas chamadas com a mesma unidade caem no mesmo escopo e podem ser
   * consolidadas. É um nome de negócio — `"camacari"`, `"a"` —, não uma chave:
   * o fixture o transforma num CNPJ e deixa o banco derivar a identidade dali.
   *
   * Isto era `scopeHash`, e a diferença não é de nome. A opção antiga entregava
   * ao teste a **chave** do escopo, e o escopo canônico era derivado dela — o
   * inverso da produção, onde o arquivo traz os códigos e a chave é o que o
   * banco calcula. Um teste montado assim não conseguia distinguir "mesma
   * unidade" de "mesma chave", que é exatamente a distinção que a identidade
   * canônica existe para fazer.
   */
  unidade?: string;
  /**
   * O canal da identidade canônica.
   *
   * O fixture monta snapshots direto, sem passar pelo `promote`, e o banco agora
   * só admite **uma** vigência ativa por identidade canônica. Duas chamadas que
   * compartilham a unidade para serem consolidadas (carreta e cavalo na mesma
   * data) colidiriam nessa identidade. Cada chamada recebe um canal próprio, o
   * que as mantém distintas sem separar a unidade — que é por onde a
   * consolidação junta as séries.
   */
  canal?: string;
  /**
   * A família do dataset. Existe para que **duas chamadas possam compartilhar
   * escopo, canal e data** sem colidir na identidade canônica.
   *
   * O produto de verdade não precisa disso: cavalo e carreta na mesma data e
   * na mesma unidade são *um* snapshot, com `entity_type_set = CARRETA+CAVALO`.
   * O fixture monta os dois separados para poder variar um sem o outro, e antes
   * mantinha-os distintos dando a cada chamada um canal próprio — o que deixou
   * de servir quando a leitura do canal passou a ser a coluna: dois canais são
   * dois contextos, e um teste que precisa dos dois numa visão só não os
   * encontraria. A família separa a identidade sem separar o contexto.
   */
  datasetFamily?: string;
  /**
   * Os códigos de escopo, escritos como o arquivo os traria.
   *
   * Por padrão o fixture os deriva de `unidade`, já normalizados, que é o que
   * serve quase sempre. Passar este campo é o que permite montar o caso que a
   * identidade canônica existe para resolver: o **mesmo** CNPJ chegando
   * mascarado num arquivo e sem máscara noutro. É a única forma de escrever um
   * código cru, e por isso ela é explícita.
   */
  canonicalScope?: { scopeType: string; code: string }[];
}

/**
 * O CNPJ de uma unidade de teste — quatorze dígitos, determinísticos.
 *
 * Existe para que "a mesma unidade" seja uma afirmação que o teste **escreve**
 * e o banco **verifica**, e não uma chave que o teste entrega pronta. Dois
 * fixtures que dizem `unidade: "camacari"` produzem o mesmo CNPJ, e é o
 * `CHECK` de `canonical_scope` mais `freightcheck_serialize_scope` que fazem
 * dele uma identidade — exatamente como na produção, onde o arquivo traz o
 * CNPJ e ninguém traz a chave.
 *
 * É exportado porque o caso do CNPJ mascarado precisa dos **mesmos** dígitos
 * escritos de duas formas, e inventá-los à mão no teste faria a prova depender
 * de dois literais que ninguém garante iguais.
 */
export function cnpjDe(unidade: string): string {
  return createHash("sha256")
    .update(unidade)
    .digest("hex")
    .replace(/\D/g, "")
    .padEnd(14, "0")
    .slice(0, 14);
}

/**
 * O contexto de uma unidade, **perguntado ao banco**.
 *
 * ---------------------------------------------------------------------------
 * Por que isto existe, e o que ele substituiu
 * ---------------------------------------------------------------------------
 *
 * Vários testes passavam a semente do fixture — `"escopo-motor"` — direto como
 * `scopeHash` de um contexto, e funcionavam. Funcionavam por um motivo que só
 * apareceu quando a compatibilidade caiu: o fixture gravava a semente na coluna
 * `snapshot.scope_hash`, e `resolveContext` aceitava aquela coluna como grafia
 * legada da chave. O teste não estava provando que o módulo enxerga o contexto;
 * estava usando a ponte de compatibilidade, do mesmo jeito que um link antigo.
 *
 * Um teste que constrói a chave por conta própria é o mesmo defeito que esta
 * auditoria passou vinte PRs desfazendo, e não deixa de ser defeito por estar
 * num arquivo de teste: ele congela uma segunda definição de identidade, e
 * passa a passar por razões que não são a razão que ele afirma.
 *
 * Aqui a pergunta é de negócio — "qual é o contexto da unidade X?" — e quem
 * responde é a autoridade, pela mesma consulta que a tela usa.
 */
export async function contextoDaUnidade(
  db: Database,
  unidade: string,
  canal?: string,
): Promise<SeriesContext> {
  const cnpj = cnpjDe(unidade);
  const contextos = await listContexts(db);
  const canalNormalizado = canal?.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

  const achado = contextos.find(
    (c) =>
      c.scopes.some((e) => e.code === cnpj) &&
      (canalNormalizado === undefined || c.channel === canalNormalizado),
  );
  if (!achado) {
    /*
      A recusa nomeia o que existe, porque a causa quase sempre é uma das duas:
      o fixture ainda não rodou, ou rodou com outro canal. As duas ficam óbvias
      com a lista ao lado, e nenhuma delas fica óbvia com `undefined`.
    */
    throw new Error(
      `Nenhum contexto para a unidade "${unidade}"` +
        (canal ? ` no canal ${canalNormalizado}` : "") +
        `. Contextos no banco: ${
          contextos
            .map((c) => `${c.scopes.map((e) => e.code).join("+")}·${c.channel}`)
            .join(", ") || "(nenhum)"
        }`,
    );
  }
  return { scopeHash: achado.scopeHash, channel: achado.channel };
}

let sequence = 0;

export async function buildFixture(
  db: Database,
  attributes: AttributeSpec[],
  snapshots: SnapshotSpec[],
  options: FixtureOptions = {},
): Promise<FixtureResult> {
  sequence++;
  const suffix = `fx${sequence}`;
  const entityType = options.entityType ?? "CARRETA";
  const unidade = options.unidade ?? `unidade-${suffix}`;
  const canal = (options.canal ?? suffix).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const datasetFamily = options.datasetFamily ?? "REMUNERACAO_EQUIPAMENTO";
  /*
    A unidade vira CNPJ, e o CNPJ vira identidade — nesta ordem, que é a da
    produção.

    O escopo tem de sair já normalizado, senão o `CHECK` do banco recusa a
    linha. Um CNPJ de 14 dígitos derivado do nome da unidade faz duas chamadas
    da mesma unidade compartilharem a identidade de escopo, e o fixture nunca
    precisa saber qual é a chave: quem a calcula é o banco, pelas mesmas funções
    que a identidade da vigência usa.
  */
  /*
    A normalização é do banco, e não do fixture — como na produção.

    `freightcheck_canonical_scope` é a mesma função que o `CHECK` da coluna
    exige e que a identidade da vigência usa. Passar por ela aqui é o que
    permite um teste escrever o código **como o arquivo o traria** — um CNPJ
    mascarado, digamos — e ainda assim gravar uma linha canônica.

    Antes o fixture exigia o código já normalizado, e o caso do CNPJ escrito de
    duas formas era montado dando às duas entregas o mesmo escopo canônico e
    dois `scope_hash` diferentes. Aquilo não era o caso real: era a coluna morta
    fingindo a divergência. Agora as duas grafias entram como grafias, e quem as
    junta é a normalização de verdade.
  */
  const { rows: escopoNormalizado } = await db.execute<{ escopo: unknown }>(
    sql`SELECT freightcheck_canonical_scope(${JSON.stringify(
      options.canonicalScope ?? [{ scopeType: "UNIDADE", code: cnpjDe(unidade) }],
    )}::jsonb) AS escopo`,
  );
  const canonicalScope = escopoNormalizado[0].escopo;

  const [file] = await db
    .insert(sourceFileTable)
    .values({
      filename: `${suffix}.xlsx`,
      contentSha256: `sha-${suffix}-${Date.now()}`,
      byteSize: 1,
      storagePath: `/dev/null/${suffix}`,
    })
    .returning();

  const [run] = await db
    .insert(importRunTable)
    .values({ sourceFileId: file.id, status: "PROMOTED" })
    .returning();

  const [nodeFixo] = await db
    .select()
    .from(taxonomyNodeTable)
    .where(eq(taxonomyNodeTable.code, "cf_frota_carreta"));
  const [nodeVar] = await db
    .select()
    .from(taxonomyNodeTable)
    .where(eq(taxonomyNodeTable.code, "cv_combustivel"));

  // --- attributes -----------------------------------------------------------
  const attributeIds = new Map<string, string>();
  for (const spec of attributes) {
    // Attributes are global by code in production too, so a fixture reuses one
    // that already exists rather than fighting the unique constraint.
    const [existing] = await db
      .select()
      .from(attributeTable)
      .where(eq(attributeTable.code, spec.code));
    if (existing) {
      attributeIds.set(spec.code, existing.id);
      continue;
    }
    const node =
      spec.taxonomyCode === "cv_combustivel" ? nodeVar : spec.taxonomyCode ? nodeFixo : null;
    const [created] = await db
      .insert(attributeTable)
      .values({
        code: spec.code,
        sourceName: spec.code.split(".").pop()!,
        displayName: spec.code.split(".").pop()!,
        entityType: spec.code.split(".")[0].toUpperCase(),
        dataType: spec.dataType,
        unit: spec.unit ?? null,
        periodicity: spec.periodicity ?? null,
        aggregation: spec.aggregation ?? null,
        isMonetary: spec.isMonetary ?? null,
        semanticsStatus: spec.semanticsStatus ?? "UNKNOWN",
        taxonomyNodeId: node?.id ?? null,
        confirmedBy: spec.semanticsStatus === "CONFIRMED" ? "fixture@test" : null,
        confirmedAt: spec.semanticsStatus === "CONFIRMED" ? new Date() : null,
      })
      .returning();
    attributeIds.set(spec.code, created.id);
  }

  // --- entities -------------------------------------------------------------
  const plates = new Set<string>();
  for (const snapshot of snapshots) for (const p of Object.keys(snapshot.data)) plates.add(p);

  const entityIds = new Map<string, string>();
  for (const plate of plates) {
    // A plate identifies one asset across every import, so a fixture resolves
    // an existing one exactly the way promotion does.
    const [known] = await db
      .select({ entityId: entityIdentifierTable.entityId })
      .from(entityIdentifierTable)
      .where(
        and(
          eq(entityIdentifierTable.identifierType, "PLACA"),
          eq(entityIdentifierTable.identifierValue, plate),
          eq(entityIdentifierTable.isCurrent, true),
        ),
      );
    if (known) {
      entityIds.set(plate, known.entityId);
      continue;
    }
    const [entity] = await db
      .insert(entityTable)
      .values({ entityType, firstSeenImportRunId: run.id })
      .returning();
    await db.insert(entityIdentifierTable).values({
      entityId: entity.id,
      identifierType: "PLACA",
      identifierValue: plate,
      effectiveFrom: snapshots[0].effectiveDate,
      isCurrent: true,
    });
    entityIds.set(plate, entity.id);
  }

  // --- snapshots ------------------------------------------------------------
  const snapshotIds: Record<string, string> = {};
  let rowCounter = 0;

  for (const spec of snapshots) {
    const [sheet] = await db
      .insert(rawSheetTable)
      .values({
        importRunId: run.id,
        sheetName: "carretas",
        sheetIndex: rowCounter++,
        rowCount: Object.keys(spec.data).length,
        columnCount: attributes.length,
        role: "SOURCE",
        roleReason: "fixture",
        headerRowIndex: 1,
      })
      .returning();

    const [snapshot] = await db
      .insert(snapshotTable)
      .values({
        sourceFileId: file.id,
        importRunId: run.id,
        sourceLabel: spec.label,
        effectiveDate: spec.effectiveDate,
        entityTypeSet: entityType,
        datasetFamily,
        canal,
        canonicalScope,
        status: "DRAFT",
      })
      .returning();
    snapshotIds[spec.label] = snapshot.id;

    /*
      O escopo também vira **linha**, e não só jsonb.

      A promoção grava as duas coisas: `snapshot.canonical_scope`, que
      identifica, e `scope` + `snapshot_scope`, que é como o produto sabe o
      nome e o CNPJ da unidade. O fixture gravava só a primeira, e por isso
      `listContexts` devolvia contexto com `scopes: []` — um contexto sem
      unidade, rotulado pelo próprio hash.

      Isso passou despercebido enquanto os testes pediam o contexto pela
      semente do fixture, aceita como grafia legada. Quando a aceitação caiu, a
      lacuna apareceu: não havia por onde perguntar "qual é o contexto da
      unidade X". Um fixture que não reproduz a forma da produção não é um
      atalho, é uma segunda realidade.
    */
    for (const entrada of canonicalScope as { scopeType: string; code: string }[]) {
      const [existente] = await db
        .select({ id: scopeTable.id })
        .from(scopeTable)
        .where(
          and(
            eq(scopeTable.scopeType, entrada.scopeType),
            eq(scopeTable.code, entrada.code),
          ),
        );
      const scopeId =
        existente?.id ??
        (
          await db
            .insert(scopeTable)
            .values({ scopeType: entrada.scopeType, code: entrada.code })
            .returning()
        )[0].id;

      await db
        .insert(snapshotScopeTable)
        .values({ snapshotId: snapshot.id, scopeId })
        .onConflictDoNothing();
    }

    const presentAttributes = new Set<string>();
    const contagemPorAtributo = new Map<string, { comValor: number; vazios: number }>();
    let fatosDaVigencia = 0;
    let physicalRow = 1;

    for (const [plate, cells] of Object.entries(spec.data)) {
      physicalRow++;
      const [rawRow] = await db
        .insert(rawRowTable)
        .values({ rawSheetId: sheet.id, rowIndex: physicalRow, isHeader: false })
        .returning();

      let column = 0;
      for (const [code, value] of Object.entries(cells)) {
        column++;
        if (value === null) continue; // attribute absent for this asset entirely
        presentAttributes.add(code);

        const missing = typeof value === "object" && value !== null && "missing" in value;
        const dateValue =
          typeof value === "object" && value !== null && "date" in value ? value.date : null;
        const sourceType = missing
          ? "z"
          : dateValue !== null
            ? "d"
            : typeof value === "number"
              ? "n"
              : typeof value === "boolean"
                ? "b"
                : "s";

        const [cell] = await db
          .insert(rawCellTable)
          .values({
            rawRowId: rawRow.id,
            columnIndex: column,
            columnLetter: String.fromCharCode(64 + column),
            columnHeader: code.split(".").pop()!,
            rawValue: missing ? null : (dateValue ?? String(value)),
            sourceType,
          })
          .returning();

        const isNull = missing;
        await db.insert(factTable).values({
          snapshotId: snapshot.id,
          entityId: entityIds.get(plate)!,
          attributeId: attributeIds.get(code)!,
          valueNumeric: !isNull && typeof value === "number" ? String(value) : null,
          valueText: !isNull && typeof value === "string" ? value : null,
          valueBoolean: !isNull && typeof value === "boolean" ? value : null,
          valueDate: dateValue,
          valueHash: isNull
            ? `0:${(value as { missing: string }).missing}`
            : `${sourceType}:${dateValue ?? value}`,
          isNull,
          nullReason: isNull ? (value as { missing: string }).missing : null,
          rawCellId: cell.id,
        });

        fatosDaVigencia++;
        const contagem = contagemPorAtributo.get(code) ?? { comValor: 0, vazios: 0 };
        if (isNull) contagem.vazios++;
        else contagem.comValor++;
        contagemPorAtributo.set(code, contagem);
      }
    }

    /*
      As contagens do layout são escritas, e não deixadas no zero do default.

      `snapshot_attribute.value_count` e `.null_count` deixaram de ser
      estatística decorativa quando a Cobertura de dados passou a lê-los como o
      observado: uma fixture que os deixasse zerados produziria 0% de cobertura
      com todos os fatos no lugar, e o teste estaria medindo a fixture.
    */
    for (const code of presentAttributes) {
      await db.insert(snapshotAttributeTable).values({
        snapshotId: snapshot.id,
        attributeId: attributeIds.get(code)!,
        sourceSheet: "carretas",
        columnIndex: 1,
        presentInLayout: true,
        valueCount: contagemPorAtributo.get(code)?.comValor ?? 0,
        nullCount: contagemPorAtributo.get(code)?.vazios ?? 0,
      });
    }

    /* O mesmo agregado que `promote` grava — ver `snapshot_entity_type`. */
    await db.insert(snapshotEntityTypeTable).values({
      snapshotId: snapshot.id,
      entityType,
      entityCount: Object.keys(spec.data).length,
      attributeCount: presentAttributes.size,
      factCount: fatosDaVigencia,
      valueCount: [...contagemPorAtributo.values()].reduce((s, c) => s + c.comValor, 0),
      nullCount: [...contagemPorAtributo.values()].reduce((s, c) => s + c.vazios, 0),
      inheritedFactCount: 0,
    });

    await db
      .update(snapshotTable)
      .set({
        status: "CLOSED",
        closedAt: new Date(),
        entityCount: Object.keys(spec.data).length,
        factCount: fatosDaVigencia,
      })
      .where(eq(snapshotTable.id, snapshot.id));
  }

  return { snapshotIds };
}

/** A value that exists in RAW but carries no usable content. */
export const absent = (reason = "VALUE_MISSING") => ({ missing: reason });

/** A real date, in `value_date` — not a date-shaped string in `value_text`. */
export const date = (iso: string) => ({ date: iso });
