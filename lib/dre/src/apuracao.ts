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
  indexarVinculos,
  lerFatos,
  listarVigencias,
  parearConjuntos,
  unidadeDe,
  type FatoDoAtivo,
  type IndiceDeVinculos,
  type ValorAprovado,
} from "@workspace/composition";
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

/**
 * O cadastro de identidade dos dois tipos, numa leitura.
 *
 * ---------------------------------------------------------------------------
 * Por que existe, e por que o resultado se passa adiante em vez de se reler
 * ---------------------------------------------------------------------------
 * Quem lê uma vigência precisa saber, para cada `entity_id`, se ele é cavalo ou
 * carreta e qual a placa. Isso não depende da vigência: é o cadastro, e ele é o
 * mesmo em dezembro e em agosto.
 *
 * `lerMaterial` lia esse cadastro por conta própria, duas consultas por
 * chamada. Numa tela de uma vigência só isso é invisível. Em `getHistoricoDaDRE`,
 * que chama `lerMaterial` **uma vez por vigência**, deixa de ser: medido no log
 * do Postgres com o acervo real (18 vigências), `/api/dre/history` disparava 52
 * consultas, e **18 delas eram esta mesma leitura**, repetida sobre um catálogo
 * que não muda entre uma vigência e a seguinte.
 *
 * Em `localhost` isso custa pouco — a consulta responde em menos de 1 ms. O que
 * ela custa é **ida e volta**: a inclinação medida de `/dre/history` é de 19,0 ms
 * por ms de RTT até o banco, e cada consulta a mais é ~1 ms dessa conta. Contra
 * um Postgres a 15 ms, as 18 repetições sozinhas valiam ~270 ms.
 *
 * A saída é a que `lib/composition/src/conjunto.ts:284` já usa: quem chama em
 * laço lê o cadastro uma vez e o passa adiante. Não é cache — não há
 * invalidação, prazo nem estado guardado entre requisições. É um argumento, com
 * o tempo de vida da requisição que o criou.
 */
export async function lerIdentidadesDaFrota(
  db: Database,
): Promise<Map<string, IdentidadeDoAtivo>> {
  const [cavalos, carretas] = await Promise.all([
    lerIdentidades(db, "CAVALO"),
    lerIdentidades(db, "CARRETA"),
  ]);
  return new Map([...cavalos, ...carretas]);
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
  /**
   * Quem puxa quem nesta vigência, pela regra única de `@workspace/composition`.
   *
   * O índice era montado aqui, à mão, e a aba Conjuntos da Composição precisou
   * do mesmo. Duas implementações da pergunta "qual carreta é desta placa?" são
   * duas chances de a DRE e a Composição responderem coisas diferentes sobre a
   * mesma vigência — e o efeito de discordarem não é cosmético: é uma carreta
   * contada duas vezes de um lado e nenhuma do outro.
   */
  vinculos: IndiceDeVinculos;
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
      FROM fato_visivel f
      JOIN attribute a ON a.id = f.attribute_id
      JOIN snapshot s  ON s.id = f.snapshot_id
     WHERE s.effective_date = ${effectiveDate}::date
       AND s.status <> 'SUPERSEDED'
       AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
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
  /**
   * O cadastro de identidade, quando quem chama já o tem.
   *
   * Opcional de propósito: quem lê **uma** vigência (a DRE de um veículo, a
   * frota de uma vigência) não ganha nada em carregá-lo antes, e obrigá-lo a
   * fazê-lo só acrescentaria cerimônia. Quem lê em laço — `getHistoricoDaDRE` —
   * passa, e deixa de pagar duas consultas por volta. Ver
   * {@link lerIdentidadesDaFrota}.
   */
  identidadesPrecarregadas?: Map<string, IdentidadeDoAtivo>,
): Promise<MaterialDaDRE> {
  const [classificacoes, fatosPorAtivo, identidades] = await Promise.all([
    loadAttributeClassificationsAt(db, effectiveDate),
    lerFatosDaVigencia(db, effectiveDate, context),
    identidadesPrecarregadas ?? lerIdentidadesDaFrota(db),
  ]);

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
  const vinculos = indexarVinculos(identidades.values(), fatosPorAtivo);

  return {
    effectiveDate,
    periodLabel: periodLabel(effectiveDate),
    classificacoes,
    aprovadosPorAtivo,
    identidades,
    vinculos,
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

  /*
    O pareamento é o de `@workspace/composition` — a mesma função que a aba
    Conjuntos usa. O que continua sendo desta casa é o vocabulário: a DRE chama
    de unidade econômica o que lá é conjunto, e escreve "(sem cavalo)" no rótulo
    da órfã porque na cascata da DRE a linha aparece sozinha, sem a coluna de
    natureza que a Composição mostra ao lado.
  */
  const unidades: UnidadeEconomica[] = parearConjuntos(material.vinculos, presentes).map(
    (par) => {
      const lados = [par.cavalo, par.carreta].filter(
        (lado): lado is IdentidadeDoAtivo => lado !== null,
      ) as IdentidadeDoAtivo[];
      const rotulo =
        par.cavalo && par.carreta
          ? `${par.cavalo.placa ?? "—"} + ${par.carreta.placa ?? "—"}`
          : par.cavalo
            ? (par.cavalo.placa ?? par.cavalo.entityId)
            : `${par.carreta?.placa ?? par.id} (sem cavalo)`;
      return {
        id: par.id,
        escopo: "CONJUNTO" as const,
        rotulo,
        lados,
        orfa: par.cavalo === null,
      };
    },
  );

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
