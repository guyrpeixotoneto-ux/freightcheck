/**
 * A DRE contra o banco: pareamento, leitura e montagem.
 *
 * Este arquivo é a única porta entre o motor puro (`motor.ts`) e o Postgres. Ele
 * não calcula nada — lê os fatos pelas mesmas funções que a Composição usa,
 * monta o insumo e entrega ao motor. Um número que apareça aqui apareceu porque
 * `montarDRE` o produziu.
 *
 * **O pareamento cavalo ↔ carreta** é a decisão de modelagem que este arquivo
 * carrega. `cavalo.placa_carreta` liga os dois lados: medido em 14/08/2026, os
 * 62 cavalos da última vigência têm o vínculo preenchido, apontam 62 placas
 * distintas, e as 62 casam com uma carreta existente. As **9 carretas que
 * ninguém aponta** não somem e não são atribuídas a cavalo nenhum: entram na
 * consolidação como unidades econômicas próprias, contadas exatamente uma vez.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  contextFilter,
  loadAttributeClassificationsAt,
  periodLabel,
  resolveContext,
  type AttributeClassification,
  type SeriesContext,
} from "@workspace/comparison";
import {
  comporDeFatos,
  lerFatos,
  listarVigencias,
  unidadeDe,
  type FatoDoAtivo,
  type ValorAprovado,
} from "@workspace/composition";
import { filtroDeVigenciaDisponivel } from "@workspace/availability";
import { montarDRE, type ApuracaoDaDRE, type LadoDaApuracao } from "./motor";
import type { CompetenciaDaDRE } from "./normalizacao";
import { TODOS_OS_ESCOPOS, type EscopoApuravel, type EscopoDeAlocacao } from "./plano";

/** Os escopos que a DRE sabe apurar por veículo. Declarados uma vez, em `plano.ts`. */
export const ESCOPOS_APURAVEIS = TODOS_OS_ESCOPOS;
export type { EscopoApuravel };

export interface OpcoesDeApuracao {
  period?: string;
  context?: Partial<SeriesContext>;
  competencia?: CompetenciaDaDRE;
}

// ---------------------------------------------------------------------------
// Identidade
// ---------------------------------------------------------------------------

export interface IdentidadeDoAtivo {
  entityId: string;
  entityType: "CAVALO" | "CARRETA";
  placa: string | null;
  chassi: string | null;
}

async function lerIdentidades(
  db: Database,
  entityType: string,
): Promise<Map<string, IdentidadeDoAtivo>> {
  const { rows } = await db.execute<{
    entity_id: string;
    entity_type: string;
    placa: string | null;
    chassi: string | null;
  }>(sql`
    SELECT e.id::text AS entity_id,
           e.entity_type,
           max(ei.identifier_value) FILTER (WHERE ei.identifier_type = 'PLACA')  AS placa,
           max(ei.identifier_value) FILTER (WHERE ei.identifier_type = 'CHASSI') AS chassi
      FROM entity e
      LEFT JOIN entity_identifier ei ON ei.entity_id = e.id AND ei.is_current
     WHERE e.entity_type = ${entityType}
     GROUP BY 1, 2
  `);
  return new Map(
    rows.map((r) => [
      r.entity_id,
      {
        entityId: r.entity_id,
        entityType: r.entity_type as "CAVALO" | "CARRETA",
        placa: r.placa,
        chassi: r.chassi,
      },
    ]),
  );
}

// ---------------------------------------------------------------------------
// O material de uma vigência inteira
// ---------------------------------------------------------------------------

/**
 * Tudo o que a frota de uma vigência precisa, em três consultas.
 *
 * A alternativa — uma consulta por ativo — daria 133 idas ao banco para desenhar
 * a tela de frota, e 266 para desenhá-la com a vigência anterior. É a mesma
 * decisão que `lerVigencia` já tomou na Composição, estendida para ler os dois
 * tipos de uma vez, porque a DRE de conjunto precisa dos dois lados juntos.
 */
export interface MaterialDaDRE {
  effectiveDate: string;
  periodLabel: string;
  classificacoes: Map<string, AttributeClassification>;
  /** `entityId → aprovados`, para os dois tipos. */
  aprovadosPorAtivo: Map<string, Map<string, ValorAprovado>>;
  identidades: Map<string, IdentidadeDoAtivo>;
  /** `placa da carreta → entityId do cavalo que a aponta`. */
  cavaloPorCarreta: Map<string, string>;
  /** `entityId do cavalo → placa da carreta que ele aponta`. */
  carretaDoCavalo: Map<string, string>;
  /** `placa → entityId`, só de carretas. */
  carretaPorPlaca: Map<string, string>;
}

async function lerFatosDaVigencia(
  db: Database,
  effectiveDate: string,
  context: SeriesContext,
): Promise<Map<string, FatoDoAtivo[]>> {
  const { rows } = await db.execute<FatoDoAtivo & { entity_id: string }>(sql`
    SELECT f.entity_id::text AS entity_id,
           a.id::text        AS attribute_id,
           a.code,
           a.source_name,
           a.data_type,
           f.value_numeric::text AS value_numeric,
           f.value_text,
           f.value_boolean,
           f.value_date::text    AS value_date,
           f.is_null,
           f.null_reason,
           s.source_label,
           NULL::text AS sheet_name,
           NULL::int  AS row_index,
           NULL::text AS column_letter,
           NULL::text AS column_header,
           NULL::text AS raw_value
      FROM fact f
      JOIN attribute a ON a.id = f.attribute_id
      JOIN snapshot s  ON s.id = f.snapshot_id
     WHERE s.effective_date = ${effectiveDate}::date
       AND ${filtroDeVigenciaDisponivel("s")}
       AND ${contextFilter("s", context)}
  `);

  const porAtivo = new Map<string, FatoDoAtivo[]>();
  for (const row of rows) {
    const lista = porAtivo.get(row.entity_id) ?? [];
    lista.push(row);
    porAtivo.set(row.entity_id, lista);
  }
  return porAtivo;
}

export async function lerMaterial(
  db: Database,
  effectiveDate: string,
  context: SeriesContext,
): Promise<MaterialDaDRE> {
  const [classificacoes, fatosPorAtivo, cavalos, carretas] = await Promise.all([
    loadAttributeClassificationsAt(db, effectiveDate),
    lerFatosDaVigencia(db, effectiveDate, context),
    lerIdentidades(db, "CAVALO"),
    lerIdentidades(db, "CARRETA"),
  ]);

  const identidades = new Map([...cavalos, ...carretas]);

  const aprovadosPorAtivo = new Map<string, Map<string, ValorAprovado>>();
  for (const [entityId, fatos] of fatosPorAtivo) {
    const identidade = identidades.get(entityId);
    if (!identidade) continue;
    aprovadosPorAtivo.set(
      entityId,
      comporDeFatos(identidade.entityType, fatos, classificacoes).aprovados,
    );
  }

  /* O vínculo, lido dos próprios fatos da vigência — não do estado de hoje. */
  const carretaPorPlaca = new Map<string, string>();
  for (const [entityId, identidade] of carretas) {
    if (identidade.placa) carretaPorPlaca.set(identidade.placa, entityId);
  }

  const cavaloPorCarreta = new Map<string, string>();
  const carretaDoCavalo = new Map<string, string>();
  for (const [entityId, fatos] of fatosPorAtivo) {
    if (identidades.get(entityId)?.entityType !== "CAVALO") continue;
    const vinculo = fatos.find((f) => f.code === "cavalo.placa_carreta");
    const placa = vinculo && !vinculo.is_null ? vinculo.value_text : null;
    if (!placa) continue;
    carretaDoCavalo.set(entityId, placa);
    /*
      Primeiro cavalo a apontar a placa fica com ela. Medido: o vínculo é um
      para um nas 9 vigências, então este desempate nunca é exercido hoje. Ele
      existe porque um empate faria a mesma carreta entrar em dois conjuntos, e
      a receita dela seria contada duas vezes na frota.
    */
    if (!cavaloPorCarreta.has(placa)) cavaloPorCarreta.set(placa, entityId);
  }

  return {
    effectiveDate,
    periodLabel: periodLabel(effectiveDate),
    classificacoes,
    aprovadosPorAtivo,
    identidades,
    cavaloPorCarreta,
    carretaDoCavalo,
    carretaPorPlaca,
  };
}

// ---------------------------------------------------------------------------
// Unidades econômicas
// ---------------------------------------------------------------------------

/**
 * Uma unidade econômica: o que a DRE apura como um todo.
 *
 * A regra de não dupla contagem vive aqui, e é a mais importante do módulo:
 * **no escopo CONJUNTO, cada ativo pertence a exatamente uma unidade.** Um
 * cavalo pareado e a sua carreta formam uma; uma carreta órfã forma outra,
 * sozinha; e nenhum ativo aparece nas duas.
 */
export interface UnidadeEconomica {
  /** A chave estável: o entityId do cavalo, ou o da carreta quando órfã. */
  id: string;
  escopo: EscopoApuravel;
  rotulo: string;
  lados: IdentidadeDoAtivo[];
  /** Verdadeiro quando é uma carreta que nenhum cavalo aponta. */
  orfa: boolean;
}

/**
 * As unidades econômicas de uma vigência, num escopo.
 *
 * Em CAVALO e CARRETA, uma por ativo presente. Em CONJUNTO, uma por cavalo
 * pareado mais uma por carreta órfã — o que faz a contagem fechar: 62 cavalos
 * pareados + 9 carretas órfãs = 71 carretas, cada ativo exatamente uma vez.
 */
export function unidadesEconomicas(
  material: MaterialDaDRE,
  escopo: EscopoApuravel,
): UnidadeEconomica[] {
  const presentes = [...material.aprovadosPorAtivo.keys()]
    .map((id) => material.identidades.get(id))
    .filter((i): i is IdentidadeDoAtivo => i !== undefined);

  if (escopo !== "CONJUNTO") {
    return presentes
      .filter((i) => i.entityType === escopo)
      .map((i) => ({
        id: i.entityId,
        escopo,
        rotulo: i.placa ?? i.chassi ?? i.entityId,
        lados: [i],
        orfa: false,
      }))
      .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR", { numeric: true }));
  }

  const unidades: UnidadeEconomica[] = [];
  const carretasUsadas = new Set<string>();

  for (const cavalo of presentes.filter((i) => i.entityType === "CAVALO")) {
    const placa = material.carretaDoCavalo.get(cavalo.entityId);
    const carretaId = placa ? material.carretaPorPlaca.get(placa) : undefined;
    const carreta =
      carretaId && material.aprovadosPorAtivo.has(carretaId)
        ? material.identidades.get(carretaId)
        : undefined;
    if (carreta) carretasUsadas.add(carreta.entityId);
    unidades.push({
      id: cavalo.entityId,
      escopo: "CONJUNTO",
      rotulo: carreta ? `${cavalo.placa ?? "—"} + ${carreta.placa ?? "—"}` : (cavalo.placa ?? cavalo.entityId),
      lados: carreta ? [cavalo, carreta] : [cavalo],
      orfa: false,
    });
  }

  for (const carreta of presentes.filter((i) => i.entityType === "CARRETA")) {
    if (carretasUsadas.has(carreta.entityId)) continue;
    unidades.push({
      id: carreta.entityId,
      escopo: "CONJUNTO",
      rotulo: `${carreta.placa ?? carreta.entityId} (sem cavalo)`,
      lados: [carreta],
      orfa: true,
    });
  }

  return unidades.sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR", { numeric: true }));
}

/** Monta a DRE de uma unidade econômica a partir do material já lido. */
export function apurarUnidade(
  unidade: UnidadeEconomica,
  material: MaterialDaDRE,
  competencia: CompetenciaDaDRE = "MENSAL",
): ApuracaoDaDRE {
  const lados: LadoDaApuracao[] = unidade.lados.map((lado) => ({
    entityId: lado.entityId,
    entityType: lado.entityType,
    placa: lado.placa,
    aprovados: material.aprovadosPorAtivo.get(lado.entityId) ?? new Map(),
  }));

  return montarDRE({
    escopo: unidade.escopo as EscopoDeAlocacao,
    competencia,
    effectiveDate: material.effectiveDate,
    periodLabel: material.periodLabel,
    lados,
  });
}

// ---------------------------------------------------------------------------
// A vigência escolhida
// ---------------------------------------------------------------------------

export interface Vigencias {
  todas: { effectiveDate: string; periodLabel: string }[];
  alvo: { effectiveDate: string; periodLabel: string };
  anterior: { effectiveDate: string; periodLabel: string } | null;
}

export async function resolverVigencias(
  db: Database,
  context: SeriesContext,
  period?: string,
): Promise<Vigencias | null> {
  const vigencias = await listarVigencias(db, context);
  if (vigencias.length === 0) return null;

  const alvo =
    period !== undefined
      ? vigencias.find((v) => v.effectiveDate === period)
      : vigencias[vigencias.length - 1];
  if (!alvo) return null;

  const indice = vigencias.indexOf(alvo);
  return {
    todas: vigencias.map((v) => ({ effectiveDate: v.effectiveDate, periodLabel: v.periodLabel })),
    alvo: { effectiveDate: alvo.effectiveDate, periodLabel: alvo.periodLabel },
    anterior:
      indice > 0
        ? {
            effectiveDate: vigencias[indice - 1].effectiveDate,
            periodLabel: vigencias[indice - 1].periodLabel,
          }
        : null,
  };
}

// ---------------------------------------------------------------------------
// A DRE de um veículo, com proveniência completa
// ---------------------------------------------------------------------------

export interface DREDoVeiculo {
  unidade: UnidadeEconomica;
  contexto: { label: string; scopeHash: string; canal: string | null; unidade: string | null };
  vigencias: Vigencias;
  atual: ApuracaoDaDRE;
  /** Nula na primeira vigência da série. */
  anterior: ApuracaoDaDRE | null;
}

/**
 * A DRE de um veículo, lida com a proveniência célula a célula.
 *
 * Difere de `apurarUnidade` num ponto só, e ele é o motivo de a ficha existir:
 * aqui os fatos vêm com `raw_cell`, `raw_row` e `raw_sheet` juntos. Numa tela de
 * auditoria, o número e a sua origem nascem juntos ou nenhum dos dois vale — é
 * a mesma decisão que `lerFatos` já tomou na Composição.
 */
export async function getDREDoVeiculo(
  db: Database,
  entityId: string,
  escopo: EscopoApuravel,
  opcoes: OpcoesDeApuracao = {},
): Promise<DREDoVeiculo | null> {
  const context = await resolveContext(db, opcoes.context);
  if (!context) return null;

  const vigencias = await resolverVigencias(db, context, opcoes.period);
  if (!vigencias) return null;

  const material = await lerMaterial(db, vigencias.alvo.effectiveDate, context);
  const unidade = unidadesEconomicas(material, escopo).find((u) =>
    u.lados.some((l) => l.entityId === entityId),
  );
  if (!unidade) return null;

  const comProveniencia = async (
    vigencia: { effectiveDate: string; periodLabel: string },
  ): Promise<ApuracaoDaDRE> => {
    const classificacoes = await loadAttributeClassificationsAt(db, vigencia.effectiveDate);
    const lados: LadoDaApuracao[] = await Promise.all(
      unidade.lados.map(async (lado) => {
        const fatos = await lerFatos(db, lado.entityId, vigencia.effectiveDate, context);
        return {
          entityId: lado.entityId,
          entityType: lado.entityType,
          placa: lado.placa,
          aprovados: comporDeFatos(lado.entityType, fatos, classificacoes).aprovados,
        };
      }),
    );
    return montarDRE({
      escopo: unidade.escopo as EscopoDeAlocacao,
      competencia: opcoes.competencia ?? "MENSAL",
      effectiveDate: vigencia.effectiveDate,
      periodLabel: vigencia.periodLabel,
      lados,
    });
  };

  return {
    unidade,
    contexto: {
      label: context.label,
      scopeHash: context.scopeHash,
      canal: context.channel,
      unidade: unidadeDe(context),
    },
    vigencias,
    atual: await comProveniencia(vigencias.alvo),
    anterior: vigencias.anterior ? await comProveniencia(vigencias.anterior) : null,
  };
}
