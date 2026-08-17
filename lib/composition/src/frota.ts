/**
 * A visão de frota: uma linha por equipamento, com o que ele recebe e o que
 * mudou.
 *
 * O cuidado que define este arquivo: **a linha da lista e a ficha do
 * equipamento são o mesmo cálculo.** Uma listagem que somasse "os monetários"
 * por SQL agregado seria rápida, divergiria da ficha no primeiro caso de
 * parcela e total, e a divergência apareceria como um número diferente na
 * mesma tela. Aqui os fatos da vigência inteira são lidos de uma vez e passados
 * por `comporDeFatos`, ativo a ativo — a mesma função que a ficha usa.
 *
 * São duas leituras de vigência (a atual e a anterior) e três consultas ao todo,
 * independentemente do tamanho da frota.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  contextFilter,
  resolveContext,
  type SeriesContext,
} from "@workspace/comparison";
import {
  calcularVariacao,
  comporDeFatos,
  lerVigencia,
  listarVigencias,
  mensalDe,
  unidadeDe,
  type Variacao,
} from "./motor";
import { regraDe } from "./regras";
import { avaliarStatus, type Farol, type StatusDoEquipamento } from "./status";

export interface FiltrosDeFrota {
  /** Placa, chassi ou pedaço de um dos dois. */
  busca?: string;
  status?: Farol;
  /** Só quem teve variação na remuneração mensal contra a vigência anterior. */
  comAlteracao?: boolean;
  /** Só quem tem algum alerta aceso. */
  comAlerta?: boolean;
  /** Só quem tem componente monetário que o produto não soube apurar. */
  comNaoCalculavel?: boolean;
}

export interface LinhaDaFrota {
  entityId: string;
  placa: string | null;
  chassi: string | null;
  entityType: string;
  rotuloDoTipo: string;
  unidade: string | null;
  operacao: string | null;
  effectiveDate: string;
  periodLabel: string;
  presente: boolean;
  /** A remuneração mensal apurada. Nulo quando nada pôde ser apurado. */
  mensal: number | null;
  /** Quantos componentes formaram esse número. */
  componentes: number;
  /** Quantos componentes monetários ficaram de fora por falta de regra. */
  semRegraFinanceira: number;
  variacao: Variacao | null;
  status: StatusDoEquipamento;
}

/**
 * Os números da frota inteira, para o topo da tela.
 *
 * Somar a remuneração mensal de todos os cavalos é legítimo — cada linha é um
 * montante mensal por ativo, somável, e nenhum ativo aparece dentro do outro
 * depois que `carreta.finame` saiu da conta (ver `regras.ts`). O que **não**
 * está aqui é qualquer mistura de periodicidades: o total é mensal e diz que é.
 */
export interface ResumoDaFrota {
  equipamentos: number;
  /** Quantos entraram em algum total mensal. */
  comValorApurado: number;
  mensalTotal: number;
  /** A soma das variações dos que têm as duas pontas. */
  variacaoTotal: number | null;
  comAumento: number;
  comReducao: number;
  semVariacao: number;
  incompletos: number;
  /** Componentes monetários sem regra financeira, somados na frota. */
  componentesSemRegra: number;
  porFarol: Record<Farol, number>;
}

export interface VisaoDeFrota {
  entityType: string;
  rotuloDoTipo: string;
  context: {
    scopeHash: string;
    channel: string | null;
    label: string;
    unidade: string | null;
  };
  effectiveDate: string;
  periodLabel: string;
  anterior: { effectiveDate: string; periodLabel: string } | null;
  /** Todas as vigências deste contexto, para o seletor. */
  vigencias: { effectiveDate: string; periodLabel: string }[];
  /** Se esta vigência entregou a série deste equipamento. */
  serieEntregue: boolean;
  resumo: ResumoDaFrota;
  linhas: LinhaDaFrota[];
  /** Quantas linhas existiam antes dos filtros. */
  totalSemFiltro: number;
}

interface Identidade extends Record<string, unknown> {
  entity_id: string;
  placa: string | null;
  chassi: string | null;
}

async function lerIdentidades(
  db: Database,
  entityType: string,
): Promise<Map<string, Identidade>> {
  const { rows } = await db.execute<Identidade>(sql`
    SELECT e.id::text AS entity_id,
           max(ei.identifier_value) FILTER (WHERE ei.identifier_type = 'PLACA')  AS placa,
           max(ei.identifier_value) FILTER (WHERE ei.identifier_type = 'CHASSI') AS chassi
      FROM entity e
      LEFT JOIN entity_identifier ei ON ei.entity_id = e.id AND ei.is_current
     WHERE e.entity_type = ${entityType}
     GROUP BY 1
  `);
  return new Map(rows.map((r) => [r.entity_id, r]));
}

async function serieFoiEntregue(
  db: Database,
  entityType: string,
  effectiveDate: string,
  context: SeriesContext,
): Promise<boolean> {
  const { rows } = await db.execute<{ entity_type_set: string }>(sql`
    SELECT s.entity_type_set
      FROM snapshot s
     WHERE s.effective_date = ${effectiveDate}::date
       AND s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", context)}
  `);
  return rows.some((r) => r.entity_type_set.split("+").includes(entityType));
}

export async function getVisaoDeFrota(
  db: Database,
  entityType: string,
  opcoes: {
    period?: string;
    context?: Partial<SeriesContext>;
    filtros?: FiltrosDeFrota;
  } = {},
): Promise<VisaoDeFrota | null> {
  const context = await resolveContext(db, opcoes.context);
  if (!context) return null;

  const vigencias = await listarVigencias(db, context);
  if (vigencias.length === 0) return null;

  const alvo =
    opcoes.period !== undefined
      ? vigencias.find((v) => v.effectiveDate === opcoes.period)
      : vigencias[vigencias.length - 1];
  if (!alvo) return null;

  const indice = vigencias.indexOf(alvo);
  const anterior = indice > 0 ? vigencias[indice - 1] : null;

  const [material, identidades, serieEntregue] = await Promise.all([
    lerVigencia(db, entityType, alvo.effectiveDate, context),
    lerIdentidades(db, entityType),
    serieFoiEntregue(db, entityType, alvo.effectiveDate, context),
  ]);
  const materialAnterior = anterior
    ? await lerVigencia(db, entityType, anterior.effectiveDate, context)
    : null;

  /*
    Quem aparece na lista: quem está nesta vigência **e** quem estava na
    anterior e sumiu. A saída de um ativo é o evento que mais mexe no total da
    frota e o único que uma listagem "do que está aqui" nunca mostra.
  */
  const ids = new Set<string>([
    ...material.fatosPorAtivo.keys(),
    ...(materialAnterior?.fatosPorAtivo.keys() ?? []),
  ]);

  const regra = regraDe(entityType);
  const linhas: LinhaDaFrota[] = [];

  for (const entityId of ids) {
    const fatos = material.fatosPorAtivo.get(entityId) ?? [];
    const composicao = comporDeFatos(entityType, fatos, material.classificacoes);
    const mensal = mensalDe(composicao.totais);

    const fatosAnteriores = materialAnterior?.fatosPorAtivo.get(entityId) ?? null;
    const anteriorPresente =
      materialAnterior === null ? null : fatosAnteriores !== null && fatosAnteriores.length > 0;
    const mensalAnterior =
      fatosAnteriores && materialAnterior
        ? mensalDe(
            comporDeFatos(entityType, fatosAnteriores, materialAnterior.classificacoes).totais,
          )
        : null;

    const identidade = identidades.get(entityId);
    linhas.push({
      entityId,
      placa: identidade?.placa ?? null,
      chassi: identidade?.chassi ?? null,
      entityType,
      rotuloDoTipo: regra.rotulo,
      unidade: unidadeDe(context),
      operacao: context.channel,
      effectiveDate: alvo.effectiveDate,
      periodLabel: alvo.periodLabel,
      presente: fatos.length > 0,
      mensal,
      componentes: composicao.totais.find((t) => t.gaveta === "MENSAL")?.componentes ?? 0,
      semRegraFinanceira: composicao.naoApurados.filter((n) => n.monetarioPotencial).length,
      variacao: calcularVariacao(mensal, mensalAnterior),
      status: avaliarStatus({
        presente: fatos.length > 0,
        mensal,
        variacao: calcularVariacao(mensal, mensalAnterior),
        integridade: composicao.integridade,
        anteriorPresente,
        naoApurados: composicao.naoApurados,
      }),
    });
  }

  linhas.sort((a, b) =>
    (a.placa ?? "").localeCompare(b.placa ?? "", "pt-BR", { numeric: true }),
  );

  const resumo = resumir(linhas);
  const filtradas = aplicarFiltros(linhas, opcoes.filtros ?? {});

  return {
    entityType,
    rotuloDoTipo: regra.rotulo,
    context: {
      scopeHash: context.scopeHash,
      channel: context.channel,
      label: context.label,
      unidade: unidadeDe(context),
    },
    effectiveDate: alvo.effectiveDate,
    periodLabel: alvo.periodLabel,
    anterior: anterior
      ? { effectiveDate: anterior.effectiveDate, periodLabel: anterior.periodLabel }
      : null,
    vigencias: vigencias.map((v) => ({
      effectiveDate: v.effectiveDate,
      periodLabel: v.periodLabel,
    })),
    serieEntregue,
    /*
      O resumo descreve a frota, e não o recorte: filtrar por "com alerta" não
      pode fazer o total mensal da unidade encolher na tela. Quem quer o número
      do recorte tem a contagem de linhas filtradas ao lado.
    */
    resumo,
    linhas: filtradas,
    totalSemFiltro: linhas.length,
  };
}

function resumir(linhas: LinhaDaFrota[]): ResumoDaFrota {
  const porFarol: Record<Farol, number> = {
    NORMAL: 0,
    ATENCAO: 0,
    CRITICO: 0,
    INCOMPLETO: 0,
  };
  let mensalTotal = 0;
  let comValorApurado = 0;
  let variacaoTotal: number | null = null;
  let comAumento = 0;
  let comReducao = 0;
  let semVariacao = 0;
  let componentesSemRegra = 0;

  for (const linha of linhas) {
    porFarol[linha.status.farol] += 1;
    componentesSemRegra += linha.semRegraFinanceira;
    if (linha.mensal !== null) {
      mensalTotal += linha.mensal;
      comValorApurado += 1;
    }
    if (linha.variacao !== null) {
      variacaoTotal = (variacaoTotal ?? 0) + linha.variacao.absoluta;
      if (linha.variacao.absoluta > 0) comAumento += 1;
      else if (linha.variacao.absoluta < 0) comReducao += 1;
      else semVariacao += 1;
    }
  }

  return {
    equipamentos: linhas.length,
    comValorApurado,
    mensalTotal: Number(mensalTotal.toFixed(2)),
    variacaoTotal: variacaoTotal === null ? null : Number(variacaoTotal.toFixed(2)),
    comAumento,
    comReducao,
    semVariacao,
    incompletos: porFarol.INCOMPLETO,
    componentesSemRegra,
    porFarol,
  };
}

function aplicarFiltros(linhas: LinhaDaFrota[], filtros: FiltrosDeFrota): LinhaDaFrota[] {
  const busca = filtros.busca?.trim().toUpperCase();
  return linhas.filter((linha) => {
    if (busca) {
      const alvo = `${linha.placa ?? ""} ${linha.chassi ?? ""}`.toUpperCase();
      if (!alvo.includes(busca)) return false;
    }
    if (filtros.status && linha.status.farol !== filtros.status) return false;
    if (filtros.comAlteracao && (linha.variacao === null || linha.variacao.absoluta === 0)) {
      return false;
    }
    if (filtros.comAlerta && linha.status.alertas === 0) return false;
    if (filtros.comNaoCalculavel && linha.semRegraFinanceira === 0) return false;
    return true;
  });
}
