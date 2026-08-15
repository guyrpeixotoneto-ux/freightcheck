/**
 * A DRE da frota: consolidado, ranking e atenção numa leitura só.
 *
 * Duas vigências lidas, três consultas cada. A anterior é lida porque **metade
 * das perguntas do módulo é sobre variação** — "o que mudou?", "quem piorou?" —
 * e calcular a vigência anterior por outro caminho seria comparar duas contas
 * diferentes e chamar a diferença de variação. É a mesma decisão que
 * `lib/composition/src/frota.ts` já tomou.
 */

import type { Database } from "@workspace/db";
import {
  resolveContext,
  type SeriesContext,
} from "@workspace/comparison";
import { unidadeDe } from "@workspace/composition";
import {
  apurarUnidade,
  lerMaterial,
  resolverVigencias,
  unidadesEconomicas,
  type EscopoApuravel,
  type OpcoesDeApuracao,
  type UnidadeEconomica,
  type Vigencias,
} from "./apuracao";
import {
  consolidar,
  ordenarRanking,
  veiculosComAtencao,
  type Alerta,
  type ConsolidadoDaDRE,
  type CriterioDeOrdenacao,
  type LinhaDoRanking,
} from "./consolidado";
import type { ApuracaoDaDRE } from "./motor";
import type { EscopoDeAlocacao } from "./plano";

export interface FiltrosDaFrota {
  /** Placa, chassi ou pedaço de um dos dois. */
  busca?: string;
  /** Só quem tem resultado apurado negativo. */
  soNegativos?: boolean;
  /** Só quem tem alguma linha essencial ausente. */
  soIncompletos?: boolean;
  ordenarPor?: CriterioDeOrdenacao;
}

export interface DREDaFrota {
  escopo: EscopoApuravel;
  contexto: { label: string; scopeHash: string; canal: string | null; unidade: string | null };
  vigencias: Vigencias;
  consolidado: ConsolidadoDaDRE;
  /** O consolidado da vigência anterior, para a variação do topo. */
  consolidadoAnterior: ConsolidadoDaDRE | null;
  ranking: LinhaDoRanking[];
  atencao: Alerta[];
  /** Quantas linhas existiam antes dos filtros. */
  totalSemFiltro: number;
}

/** O resultado apurado de uma apuração — o número que o ranking ordena. */
function resultadoDe(apuracao: ApuracaoDaDRE): number | null {
  return apuracao.subtotais.find((s) => s.id === "RESULTADO_ECONOMICO")!.valorParcial;
}

function receitaDe(apuracao: ApuracaoDaDRE): number | null {
  return apuracao.subtotais.find((s) => s.id === "RECEITA_BRUTA")!.valorParcial;
}

function linhaDoRanking(
  unidade: UnidadeEconomica,
  atual: ApuracaoDaDRE,
  anterior: ApuracaoDaDRE | null,
): LinhaDoRanking {
  const receita = receitaDe(atual);
  const resultado = resultadoDe(atual);
  const receitaAntes = anterior ? receitaDe(anterior) : null;
  const resultadoAntes = anterior ? resultadoDe(anterior) : null;

  const variacaoResultado =
    resultado === null || resultadoAntes === null
      ? null
      : Number((resultado - resultadoAntes).toFixed(2));

  return {
    id: unidade.id,
    rotulo: unidade.rotulo,
    escopo: unidade.escopo as EscopoDeAlocacao,
    entityIds: unidade.lados.map((l) => l.entityId),
    orfa: unidade.orfa,
    receita,
    resultado,
    /*
      Margem calculada aqui, e não guardada: é sempre resultado ÷ receita **deste
      veículo**. A frota nunca a lê desta coluna — ver `consolidar`, que
      recalcula de numerador e denominador consolidados.
    */
    margemPercentual:
      receita === null || resultado === null || receita === 0
        ? null
        : Number(((resultado / receita) * 100).toFixed(2)),
    custo:
      receita === null || resultado === null ? null : Number((receita - resultado).toFixed(2)),
    cobertura: atual.cobertura.percentual,
    estado: atual.estado,
    variacaoResultado,
    variacaoResultadoPercentual:
      variacaoResultado === null || resultadoAntes === null || resultadoAntes === 0
        ? null
        : Number(((variacaoResultado / Math.abs(resultadoAntes)) * 100).toFixed(2)),
    variacaoReceita:
      receita === null || receitaAntes === null ? null : Number((receita - receitaAntes).toFixed(2)),
  };
}

export async function getDREDaFrota(
  db: Database,
  escopo: EscopoApuravel,
  opcoes: OpcoesDeApuracao & { filtros?: FiltrosDaFrota } = {},
): Promise<DREDaFrota | null> {
  const context = await resolveContext(db, opcoes.context);
  if (!context) return null;

  const vigencias = await resolverVigencias(db, context, opcoes.period);
  if (!vigencias) return null;

  const material = await lerMaterial(db, vigencias.alvo.effectiveDate, context);
  const materialAnterior = vigencias.anterior
    ? await lerMaterial(db, vigencias.anterior.effectiveDate, context)
    : null;

  const unidades = unidadesEconomicas(material, escopo);
  const unidadesAnteriores = materialAnterior
    ? new Map(unidadesEconomicas(materialAnterior, escopo).map((u) => [u.id, u]))
    : new Map<string, UnidadeEconomica>();

  const apuracoes = unidades.map((u) => apurarUnidade(u, material, opcoes.competencia));

  const ranking = unidades.map((unidade, i) => {
    const antes = unidadesAnteriores.get(unidade.id);
    const apuracaoAnterior =
      antes && materialAnterior ? apurarUnidade(antes, materialAnterior, opcoes.competencia) : null;
    return linhaDoRanking(unidade, apuracoes[i], apuracaoAnterior);
  });

  const consolidado = consolidar(apuracoes, escopo as EscopoDeAlocacao, vigencias.alvo);
  const consolidadoAnterior =
    materialAnterior && vigencias.anterior
      ? consolidar(
          unidadesEconomicas(materialAnterior, escopo).map((u) =>
            apurarUnidade(u, materialAnterior, opcoes.competencia),
          ),
          escopo as EscopoDeAlocacao,
          vigencias.anterior,
        )
      : null;

  const filtros = opcoes.filtros ?? {};
  const filtrado = aplicarFiltros(ranking, filtros);

  return {
    escopo,
    contexto: {
      label: context.label,
      scopeHash: context.scopeHash,
      canal: context.channel,
      unidade: unidadeDe(context),
    },
    vigencias,
    /*
      O consolidado descreve a frota, e não o recorte: filtrar por "só negativos"
      não pode fazer a receita da unidade encolher na tela. Mesma decisão da
      Composição — quem quer o número do recorte tem a contagem de linhas ao lado.
    */
    consolidado,
    consolidadoAnterior,
    ranking: ordenarRanking(filtrado, filtros.ordenarPor ?? "MENOR_RESULTADO"),
    atencao: veiculosComAtencao(ranking),
    totalSemFiltro: ranking.length,
  };
}

function aplicarFiltros(linhas: LinhaDoRanking[], filtros: FiltrosDaFrota): LinhaDoRanking[] {
  const busca = filtros.busca?.trim().toUpperCase();
  return linhas.filter((l) => {
    if (busca && !l.rotulo.toUpperCase().includes(busca)) return false;
    if (filtros.soNegativos && !(l.resultado !== null && l.resultado < 0)) return false;
    if (filtros.soIncompletos && l.estado === "COMPLETA") return false;
    return true;
  });
}

export type { SeriesContext };
