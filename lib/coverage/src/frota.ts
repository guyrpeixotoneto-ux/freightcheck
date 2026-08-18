import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { entityExpectationTable, curationEventTable } from "@workspace/db";

/**
 * A frota esperada — o segundo grão do esperado, e o que faltava para a
 * cobertura medir universo em vez de arquivo.
 *
 * ---------------------------------------------------------------------------
 * A assimetria que este arquivo desfaz
 * ---------------------------------------------------------------------------
 * O módulo cobrava atributo e não cobrava equipamento. O denominador de
 * entidades era `snapshot_entity_type.entity_count` — quantos chegaram —, e um
 * denominador tirado do próprio arquivo não consegue acusar falta: dez carretas
 * que somem levam consigo tanto o numerador quanto o denominador, e a célula
 * continua no mesmo percentual. Era o pior caso do produto, e o único que ele
 * não media.
 *
 * ---------------------------------------------------------------------------
 * Por que a continuidade, e por que ela sozinha não bastava
 * ---------------------------------------------------------------------------
 * A lista de quem deveria estar aqui sai da própria série: **um equipamento que
 * apareceu numa vigência anterior deste mesmo recorte deveria continuar
 * aparecendo.** É a afirmação mais fraca que resolve o problema, e não depende
 * de nenhum cadastro externo que este produto não recebe.
 *
 * O que ela não resolve sozinha é a saída. `entity_identifier` tem janela de
 * validade e a importação **nunca a fecha** — só escreve `is_current = true` —,
 * então "todo equipamento já visto" inclui todo caminhão já vendido. Sem um
 * lugar para registrar a baixa, cada venda viraria uma lacuna perpétua, e uma
 * tela vermelha para sempre por um motivo errado ensina a ignorar o vermelho.
 *
 * Daí o par, e a divisão de trabalho entre as duas metades:
 *
 * - **a continuidade é inferência** — recalculada a cada leitura, nunca gravada,
 *   e chega à tela dizendo que é inferência. É a mesma fronteira que
 *   `coverage_expectation` protege do lado dos atributos.
 * - **a baixa é declaração** — vira linha em `entity_expectation`, com ator e
 *   motivo obrigatórios, e é o único jeito de uma ausência deixar de contar.
 *
 * A consequência é deliberada e vale estar escrita: **enquanto ninguém declarar
 * a baixa, a ausência continua contando.** Não é efeito colateral, é o
 * mecanismo — é o que transforma "sumiu um caminhão do arquivo" numa fila de
 * trabalho em vez de num silêncio.
 */

/** Um equipamento que era esperado nesta vigência e não veio. */
export interface EntidadeAusente {
  entityId: string;
  entityType: string;
  /** A placa corrente, ou o início do id quando não há identificador. */
  rotulo: string;
  /** A última vigência deste recorte em que ela apareceu. */
  ultimaVigencia: string;
  /** Em quantas vigências anteriores deste recorte ela apareceu. */
  vigenciasComDado: number;
}

/** O que a frota deveria ser numa vigência, e quem falta para ela ser isso. */
export interface RosterDaVigencia {
  /** Entidades esperadas por tipo: as que chegaram mais as que faltam. */
  esperadasPorTipo: Map<string, number>;
  /** As que faltam, com a evidência de que eram esperadas. */
  ausentes: EntidadeAusente[];
}

/** O recorte de uma vigência — a chave pela qual a continuidade se mede. */
export interface RecorteDaVigencia {
  snapshotId: string;
  datasetFamily: string;
  canal: string;
  scopeHash: string;
  effectiveDate: string;
}

const chaveDoRecorte = (v: { datasetFamily: string; canal: string; scopeHash: string }) =>
  `${v.datasetFamily}|${v.canal}|${v.scopeHash}`;

/**
 * O roster de várias vigências, em três consultas — e não em três por vigência.
 *
 * A primeira versão perguntava por vigência, e cada pergunta varria os fatos de
 * todas as anteriores do mesmo recorte. É quadrático no número de vigências, e
 * o custo apareceu antes de qualquer volume de produção: a suíte de cobertura
 * sobre o export real passou de 7s para 18s só por causa disto.
 *
 * A troca é de granularidade, não de semântica. O par (vigência, entidade) é
 * **pequeno** — entidades × vigências, mil e duzentas linhas no export real,
 * contra as centenas de milhares de `fact` que as produzem —, então ele cabe
 * inteiro em memória e a diferença entre vigências vira um `Set`. As três
 * consultas são: quem esteve em cada vigência, quais baixas foram declaradas, e
 * o rótulo de quem faltou.
 *
 * A janela da matriz **não** limita a continuidade. As vigências pedidas dizem
 * de quais recortes se trata; o histórico considerado é o do recorte inteiro.
 * Sem isso, olhar as últimas seis vigências esconderia quem sumiu na sétima —
 * a lacuna dependeria do filtro de quem está olhando, que é o oposto do que a
 * tela promete.
 */
export async function rosterDasVigencias(
  db: Database,
  vigencias: RecorteDaVigencia[],
  observadasPorVigencia: Map<string, Map<string, number>>,
): Promise<Map<string, RosterDaVigencia>> {
  const roster = new Map<string, RosterDaVigencia>();
  if (vigencias.length === 0) return roster;

  const ids = sql`ARRAY[${sql.join(
    vigencias.map((v) => sql`${v.snapshotId}::uuid`),
    sql`, `,
  )}]`;

  const { rows: presencas } = await db.execute<{
    recorte: string;
    effective_date: string;
    entity_id: string;
    entity_type: string;
  }>(sql`
    WITH pedidas AS (
      SELECT DISTINCT s.dataset_family, s.canal, s.scope_hash
        FROM snapshot s
       WHERE s.id = ANY(${ids})
    )
    SELECT DISTINCT
           s.dataset_family || '|' || s.canal || '|' || s.scope_hash AS recorte,
           s.effective_date::text                                    AS effective_date,
           f.entity_id,
           e.entity_type
      FROM snapshot s
      JOIN pedidas p
        ON p.dataset_family = s.dataset_family
       AND p.canal = s.canal
       AND p.scope_hash = s.scope_hash
      JOIN fact f ON f.snapshot_id = s.id
      JOIN entity e ON e.id = f.entity_id
     WHERE s.status <> 'SUPERSEDED'
  `);

  const { rows: baixas } = await db.execute<{ entity_id: string; desde: string }>(sql`
    SELECT entity_id, min(effective_from)::text AS desde
      FROM entity_expectation
     WHERE status = 'BAIXA'
     GROUP BY entity_id
  `);
  const baixaDe = new Map(baixas.map((b) => [b.entity_id, b.desde]));

  /* Agrupa a presença por recorte uma vez, em vez de filtrar a lista por vigência. */
  const porRecorte = new Map<
    string,
    { entityId: string; entityType: string; data: string }[]
  >();
  for (const p of presencas) {
    const lista = porRecorte.get(p.recorte);
    const item = { entityId: p.entity_id, entityType: p.entity_type, data: p.effective_date };
    if (lista) lista.push(item);
    else porRecorte.set(p.recorte, [item]);
  }

  const ausentesPorVigencia = new Map<string, Omit<EntidadeAusente, "rotulo">[]>();
  const precisamDeRotulo = new Set<string>();

  for (const vigencia of vigencias) {
    const doRecorte = porRecorte.get(chaveDoRecorte(vigencia)) ?? [];
    const agora = new Set<string>();
    const antes = new Map<string, { entityType: string; vezes: number; ultima: string }>();

    for (const p of doRecorte) {
      if (p.data === vigencia.effectiveDate) {
        agora.add(p.entityId);
        continue;
      }
      if (p.data > vigencia.effectiveDate) continue;
      const atual = antes.get(p.entityId);
      if (atual) {
        atual.vezes += 1;
        if (p.data > atual.ultima) atual.ultima = p.data;
        continue;
      }
      antes.set(p.entityId, { entityType: p.entityType, vezes: 1, ultima: p.data });
    }

    const ausentes: Omit<EntidadeAusente, "rotulo">[] = [];
    for (const [entityId, info] of antes) {
      if (agora.has(entityId)) continue;
      const baixa = baixaDe.get(entityId);
      if (baixa !== undefined && baixa <= vigencia.effectiveDate) continue;
      ausentes.push({
        entityId,
        entityType: info.entityType,
        ultimaVigencia: info.ultima,
        vigenciasComDado: info.vezes,
      });
      precisamDeRotulo.add(entityId);
    }
    ausentesPorVigencia.set(vigencia.snapshotId, ausentes);
  }

  const rotulos = await rotulosDe(db, [...precisamDeRotulo]);

  for (const vigencia of vigencias) {
    const observadas = observadasPorVigencia.get(vigencia.snapshotId) ?? new Map<string, number>();
    const ausentes = (ausentesPorVigencia.get(vigencia.snapshotId) ?? [])
      .map((a) => ({ ...a, rotulo: rotulos.get(a.entityId) ?? a.entityId.slice(0, 8) }))
      .sort(
        (a, b) => a.entityType.localeCompare(b.entityType) || a.rotulo.localeCompare(b.rotulo),
      );

    const esperadasPorTipo = new Map(observadas);
    for (const a of ausentes) {
      esperadasPorTipo.set(a.entityType, (esperadasPorTipo.get(a.entityType) ?? 0) + 1);
    }
    roster.set(vigencia.snapshotId, { esperadasPorTipo, ausentes });
  }

  return roster;
}

/**
 * A placa de cada entidade, com o chassi como segunda opção.
 *
 * Ordenar por `identifier_type` puro devolvia CHASSI, que vem antes de PLACA no
 * alfabeto e não é o que ninguém usa para procurar um caminhão. A preferência é
 * explícita para não depender de como os tipos vierem a se chamar.
 */
async function rotulosDe(db: Database, entityIds: string[]): Promise<Map<string, string>> {
  if (entityIds.length === 0) return new Map();
  const lista = sql`ARRAY[${sql.join(
    entityIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]`;
  const { rows } = await db.execute<{ entity_id: string; identifier_value: string }>(sql`
    SELECT DISTINCT ON (ei.entity_id) ei.entity_id, ei.identifier_value
      FROM entity_identifier ei
     WHERE ei.entity_id = ANY(${lista})
       AND ei.is_current
     ORDER BY ei.entity_id, (ei.identifier_type <> 'PLACA'), ei.identifier_type
  `);
  return new Map(rows.map((r) => [r.entity_id, r.identifier_value]));
}

/**
 * O roster de uma vigência só.
 *
 * O drill-down abre uma célula por vez e não tem por que carregar a matriz
 * inteira. Delega ao caminho em lote com uma lista de um, para que as duas
 * leituras da mesma célula não possam divergir — a garantia que o teste "a
 * célula abre com a mesma conta que a matriz mostrou" cobra.
 */
export async function rosterDaVigencia(
  db: Database,
  vigencia: RecorteDaVigencia,
  observadasPorTipo: Map<string, number>,
): Promise<RosterDaVigencia> {
  const todos = await rosterDasVigencias(
    db,
    [vigencia],
    new Map([[vigencia.snapshotId, observadasPorTipo]]),
  );
  return (
    todos.get(vigencia.snapshotId) ?? { esperadasPorTipo: new Map(observadasPorTipo), ausentes: [] }
  );
}

/** Erro de recusa de uma decisão de frota. A rota traduz em 422. */
export class BaixaRecusada extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaixaRecusada";
  }
}

export interface DecisaoDeFrota {
  datasetFamily: string;
  canal?: string | null;
  scopeKey?: string | null;
  entityType: string;
  entityId: string;
  /**
   * BAIXA    — o equipamento saiu da frota em `efetivoDe`. A ausência para de contar.
   * ESPERADA — alguém afirma que ele deveria aparecer, mesmo nunca tendo aparecido.
   */
  status: "ESPERADA" | "BAIXA";
  efetivoDe: string;
  efetivoAte?: string | null;
  motivo: string;
  evidencia?: Record<string, unknown>;
  ator: string;
}

/**
 * Registra uma decisão humana sobre a frota.
 *
 * Duas escritas, sempre as duas — a linha em `entity_expectation`, que muda o
 * que a cobertura passa a esperar, e o evento em `curation_event`, que é onde
 * o produto guarda "quem mudou o quê e por quê". É o mesmo par que
 * `registrarDecisao` faz do lado dos atributos, e pela mesma razão: uma decisão
 * que só aparecesse na primeira seria invisível no histórico; uma que só
 * aparecesse na segunda não mudaria número nenhum.
 */
export async function registrarBaixa(db: Database, decisao: DecisaoDeFrota): Promise<void> {
  if (!decisao.motivo?.trim()) {
    throw new BaixaRecusada(
      "Dar baixa num equipamento exige uma justificativa escrita: ela é o que a próxima pessoa vai ler para entender por que a lacuna sumiu.",
    );
  }
  if (!decisao.ator?.trim()) {
    throw new BaixaRecusada("Uma decisão sem responsável não é auditável.");
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(entityExpectationTable)
      .values({
        datasetFamily: decisao.datasetFamily,
        canal: decisao.canal ?? null,
        scopeKey: decisao.scopeKey ?? null,
        entityType: decisao.entityType,
        entityId: decisao.entityId,
        origin: "CURADORIA",
        status: decisao.status,
        effectiveFrom: decisao.efetivoDe,
        effectiveUntil: decisao.efetivoAte ?? null,
        rationale: decisao.motivo,
        evidence: decisao.evidencia ?? {},
        actor: decisao.ator,
      })
      .onConflictDoUpdate({
        target: [
          entityExpectationTable.sourceSystem,
          entityExpectationTable.datasetFamily,
          entityExpectationTable.canal,
          entityExpectationTable.scopeKey,
          entityExpectationTable.entityType,
          entityExpectationTable.entityId,
          entityExpectationTable.effectiveFrom,
        ],
        set: {
          status: decisao.status,
          effectiveUntil: decisao.efetivoAte ?? null,
          rationale: decisao.motivo,
          evidence: decisao.evidencia ?? {},
          actor: decisao.ator,
          origin: "CURADORIA",
        },
      });

    await tx.insert(curationEventTable).values({
      changeCategory: "CURATION_CHANGE",
      targetKind: "ENTITY_EXPECTATION",
      targetId: sql`${decisao.entityId}::uuid`,
      targetLabel: decisao.entityType,
      field: "entity_status",
      valueBefore: null,
      valueAfter: decisao.status,
      actor: decisao.ator,
      reason: decisao.motivo,
      detail: {
        datasetFamily: decisao.datasetFamily,
        canal: decisao.canal ?? null,
        scopeKey: decisao.scopeKey ?? null,
        entityType: decisao.entityType,
        entityId: decisao.entityId,
        efetivoDe: decisao.efetivoDe,
        efetivoAte: decisao.efetivoAte ?? null,
      },
    });
  });
}
