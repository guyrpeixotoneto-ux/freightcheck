/**
 * A evolução da DRE ao longo das vigências — o insumo dos dois únicos gráficos
 * que este módulo desenha (§25).
 *
 * Dois, e não seis. "Distribuição da frota" e "receita × custo × resultado" não
 * entram porque, com uma seção de custo variável inteiramente vazia, o gráfico
 * teria uma barra e uma legenda explicando a ausência das outras — texto
 * disfarçado de visualização. Os dois que ficam respondem perguntas que a tabela
 * responde pior: *para onde isto está indo* e *o que empurrou daqui para ali*.
 */

import type { Database } from "@workspace/db";
import { resolveContext, type SeriesContext } from "@workspace/comparison";
import {
  apurarUnidade,
  lerMaterial,
  resolverVigencias,
  unidadesEconomicas,
  type EscopoApuravel,
} from "./apuracao";
import { consolidar } from "./consolidado";
import type { CompetenciaDaDRE } from "./normalizacao";
import type { EscopoDeAlocacao } from "./plano";

export interface PontoDaSerie {
  effectiveDate: string;
  periodLabel: string;
  /** Falso quando a unidade não estava nesta vigência. Ausência não é zero. */
  presente: boolean;
  receita: number | null;
  resultado: number | null;
  margemPercentual: number | null;
  cobertura: number;
}

export interface HistoricoDaDRE {
  escopo: EscopoApuravel;
  /** Nulo no histórico da frota inteira. */
  entityId: string | null;
  rotulo: string;
  pontos: PontoDaSerie[];
  /** As linhas que mudaram entre a primeira e a última vigência com valor. */
  componentes: {
    code: string;
    titulo: string;
    valores: (number | null)[];
  }[];
}

/**
 * A série de uma unidade econômica, ou da frota, em todas as vigências.
 *
 * Uma leitura de material por vigência. É caro e é o preço certo: a alternativa
 * — uma consulta agregada que somasse "os monetários" por SQL — divergiria do
 * motor no primeiro caso de parcela e total, e a divergência apareceria como
 * duas curvas diferentes para o mesmo número na mesma tela.
 */
export async function getHistoricoDaDRE(
  db: Database,
  escopo: EscopoApuravel,
  opcoes: {
    entityId?: string;
    context?: Partial<SeriesContext>;
    competencia?: CompetenciaDaDRE;
  } = {},
): Promise<HistoricoDaDRE | null> {
  const context = await resolveContext(db, opcoes.context);
  if (!context) return null;

  const vigencias = await resolverVigencias(db, context);
  if (!vigencias) return null;

  const pontos: PontoDaSerie[] = [];
  const porComponente = new Map<string, { titulo: string; valores: (number | null)[] }>();
  let rotulo = escopo === "CAVALO" ? "Cavalos" : escopo === "CARRETA" ? "Carretas" : "Conjuntos";

  for (const vigencia of vigencias.todas) {
    const material = await lerMaterial(db, vigencia.effectiveDate, context);
    const unidades = unidadesEconomicas(material, escopo);

    const alvo = opcoes.entityId
      ? unidades.filter((u) => u.lados.some((l) => l.entityId === opcoes.entityId))
      : unidades;

    if (opcoes.entityId && alvo.length > 0) rotulo = alvo[0].rotulo;

    if (alvo.length === 0) {
      pontos.push({
        effectiveDate: vigencia.effectiveDate,
        periodLabel: vigencia.periodLabel,
        presente: false,
        receita: null,
        resultado: null,
        margemPercentual: null,
        cobertura: 0,
      });
      for (const entrada of porComponente.values()) entrada.valores.push(null);
      continue;
    }

    const consolidado = consolidar(
      alvo.map((u) => apurarUnidade(u, material, opcoes.competencia)),
      escopo as EscopoDeAlocacao,
      vigencia,
    );

    const receita = consolidado.subtotais.find((s) => s.id === "RECEITA_BRUTA")!.valorParcial;
    const resultado = consolidado.subtotais.find(
      (s) => s.id === "RESULTADO_ECONOMICO",
    )!.valorParcial;

    pontos.push({
      effectiveDate: vigencia.effectiveDate,
      periodLabel: vigencia.periodLabel,
      presente: true,
      receita,
      resultado,
      margemPercentual:
        receita === null || resultado === null || receita === 0
          ? null
          : Number(((resultado / receita) * 100).toFixed(2)),
      cobertura: consolidado.cobertura.percentual,
    });

    /* Componentes: uma linha por código, com um valor por vigência, alinhados. */
    const nestaVigencia = new Map<string, { titulo: string; valor: number | null }>();
    for (const secao of consolidado.secoes) {
      for (const l of secao.linhas) nestaVigencia.set(l.code, { titulo: l.titulo, valor: l.valor });
    }
    for (const [code, { titulo, valor }] of nestaVigencia) {
      let entrada = porComponente.get(code);
      if (!entrada) {
        /* Um componente que aparece tarde na série entra com nulos atrás dele,
           e não com zeros — não havia dado, e não havia custo zero. */
        entrada = { titulo, valores: new Array(pontos.length - 1).fill(null) };
        porComponente.set(code, entrada);
      }
      entrada.valores.push(valor);
    }
    for (const [code, entrada] of porComponente) {
      if (!nestaVigencia.has(code)) entrada.valores.push(null);
    }
  }

  return {
    escopo,
    entityId: opcoes.entityId ?? null,
    rotulo,
    pontos,
    componentes: [...porComponente.entries()]
      .map(([code, e]) => ({ code, titulo: e.titulo, valores: e.valores }))
      /* Só quem tem algum valor: um componente nulo em toda a série é lacuna,
         e a lacuna é dita na cobertura, não como uma linha reta no gráfico. */
      .filter((c) => c.valores.some((v) => v !== null)),
  };
}
