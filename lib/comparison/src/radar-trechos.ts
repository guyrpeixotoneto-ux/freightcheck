/**
 * Radar de Trechos — o veredito consolidado por trecho, a partir do que a
 * comparação de vigências já sabe.
 *
 * ---------------------------------------------------------------------------
 * O que esta regra prova, e o que ela deliberadamente não inventa
 * ---------------------------------------------------------------------------
 * `change.impactAmount` é sempre o delta bruto (valorDepois − valorAntes), sem
 * ajuste de sinal — subir um custo e subir uma receita produzem os dois um
 * `impactAmount` positivo, e somá-los direto misturaria melhora com piora
 * (ver `impact.ts`, `deduplicacao.ts`). O que fecha essa lacuna é
 * `change.economicDirection`, agora snapshotado na própria linha (migration
 * `0064`): com ela, dá para inverter o sinal do que é `HIGHER_IS_WORSE` e
 * somar tudo numa régua só — "favorável para a transportadora", não "o número
 * subiu".
 *
 * O que a regra recusa a fazer: usar a direção sem o impacto apurado
 * (`impactConfidence !== "CALCULATED"`) para *quantificar* um veredito. Uma
 * linha assim entra no grupo D — sabemos o sentido, não sabemos o tamanho — e
 * o único uso de D é vetar uma conclusão monetária que ele contradiz (vira
 * MISTO). Fabricar um "melhorou" a partir de um sinal sem magnitude seria
 * inventar um número que os dados não têm.
 *
 * ---------------------------------------------------------------------------
 * A árvore de decisão
 * ---------------------------------------------------------------------------
 * Dado M = as alterações do trecho neste change-set, excluindo os atributos
 * `NEUTRAL` (cadastro nunca move o veredito):
 *
 *   Q (quantificado)      — direção conhecida (BETTER/WORSE) e impacto CALCULATED
 *   D (direção sem valor) — direção conhecida, impacto não calculável
 *   U (não classificado)  — direção NULL ou DEPENDS_ON_FORMULA
 *
 *   signedSum      = Σ(Q) de (WORSE ? -amount : +amount)
 *   coberturaQtd   = (|Q|+|D|) / |M|
 *   coberturaImpacto = Σ|amount| de Q  ÷  Σ|amount| de toda linha com impacto
 *                      apurado (Q, e as de D/U que também tiverem `amount`)
 *                      — null quando nenhuma linha tem valor apurado.
 *   confiabilidade = coberturaImpacto ?? coberturaQtd
 *
 *   1. M vazio                                    → IGUAL
 *   2. confiabilidade < LIMIAR_COBERTURA (60%)     → INCONCLUSIVO
 *   3. D tem sinais opostos entre si                → MISTO
 *   4. D tem sinal oposto ao de signedSum (≠0)       → MISTO
 *   5. |signedSum| ≤ PISO_MATERIALIDADE (R$ 1)       → IGUAL
 *   6. signedSum > 0                                → MELHOROU
 *   7. signedSum < 0                                → PIOROU
 *
 * Os dois limiares são constantes nomeadas e exportadas — ajustáveis pelo
 * produto sem tocar na árvore.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  ALTERACAO_DE_ORIGEM_VISIVEL,
  changeSetTable,
  changeTable,
} from "@workspace/db";
import { computeChangeSet, findPreviousSnapshot } from "./engine";
import type { ImpactConfidence } from "./impact";
import {
  contextFilter,
  listContexts,
  resolveContext,
  type ContextInfo,
  type RequestedContext,
} from "./series";

export const LIMIAR_COBERTURA = 0.6;
export const PISO_MATERIALIDADE = 1;

export type Veredito = "PIOROU" | "MELHOROU" | "IGUAL" | "MISTO" | "INCONCLUSIVO";

export type DirecaoEconomica =
  | "HIGHER_IS_BETTER"
  | "HIGHER_IS_WORSE"
  | "NEUTRAL"
  | "DEPENDS_ON_FORMULA"
  | null;

/** Uma alteração de atributo de um trecho, no formato mínimo que a regra precisa. */
export interface AlteracaoDoTrecho {
  attributeCode: string;
  attributeName: string;
  economicDirection: DirecaoEconomica;
  impactConfidence: ImpactConfidence;
  /** null quando não há valor monetário apurado (NOT_CALCULABLE). */
  impactAmount: number | null;
}

export interface ResumoDoTrecho {
  veredito: Veredito;
  impactoLiquido: number | null;
  totalAlteracoes: number;
  alteracoesMateriais: number;
  alteracoesClassificadas: number;
  coberturaPorQuantidade: number | null;
  coberturaPorImpacto: number | null;
  /** A que a UI mostra: impacto quando disponível, senão quantidade. */
  confiabilidade: number | null;
  /** A linha de maior |impacto assinado| em Q, ou null quando Q está vazio. */
  principalCausa: Contribuicao | null;
  /** Todas as linhas de Q (quantificadas), da maior à menor magnitude. */
  contribuicoes: Contribuicao[];
}

export interface Contribuicao {
  attributeCode: string;
  attributeName: string;
  /** Positivo = favorável, negativo = desfavorável — já com o sinal de direção aplicado. */
  impactoAssinado: number;
}

function sinalDaLinha(l: AlteracaoDoTrecho): 1 | -1 | null {
  if (l.economicDirection === "HIGHER_IS_BETTER") return 1;
  if (l.economicDirection === "HIGHER_IS_WORSE") return -1;
  return null;
}

/**
 * Classifica um trecho a partir de todas as suas alterações num change-set.
 *
 * Pura, sem I/O — o mesmo motivo de `classifyChange`/`assessImpact`: a regra
 * vive uma vez, testável sem banco, e tanto o endpoint quanto os testes a
 * chamam igual.
 */
export function classificarTrecho(todasAsLinhas: AlteracaoDoTrecho[]): ResumoDoTrecho {
  const totalAlteracoes = todasAsLinhas.length;
  const materiais = todasAsLinhas.filter((l) => l.economicDirection !== "NEUTRAL");
  const alteracoesMateriais = materiais.length;

  if (alteracoesMateriais === 0) {
    return {
      veredito: "IGUAL",
      impactoLiquido: 0,
      totalAlteracoes,
      alteracoesMateriais: 0,
      alteracoesClassificadas: 0,
      coberturaPorQuantidade: totalAlteracoes === 0 ? null : 1,
      coberturaPorImpacto: null,
      confiabilidade: totalAlteracoes === 0 ? null : 1,
      principalCausa: null,
      contribuicoes: [],
    };
  }

  const Q = materiais.filter(
    (l) => sinalDaLinha(l) !== null && l.impactConfidence === "CALCULATED" && l.impactAmount !== null,
  );
  const D = materiais.filter(
    (l) => sinalDaLinha(l) !== null && !(l.impactConfidence === "CALCULATED" && l.impactAmount !== null),
  );
  const classificadas = Q.length + D.length;

  const linhasComValor = materiais.filter((l) => l.impactAmount !== null);
  const somaAbsolutaTotalApurada = linhasComValor.reduce((s, l) => s + Math.abs(l.impactAmount!), 0);
  const somaAbsolutaQ = Q.reduce((s, l) => s + Math.abs(l.impactAmount!), 0);

  const coberturaPorQuantidade = alteracoesMateriais === 0 ? null : classificadas / alteracoesMateriais;
  const coberturaPorImpacto =
    somaAbsolutaTotalApurada > 0 ? somaAbsolutaQ / somaAbsolutaTotalApurada : null;
  const confiabilidade = coberturaPorImpacto ?? coberturaPorQuantidade;

  let signedSum = 0;
  const contribuicoes: Contribuicao[] = [];
  for (const l of Q) {
    const impactoAssinado = sinalDaLinha(l)! * l.impactAmount!;
    signedSum += impactoAssinado;
    contribuicoes.push({
      attributeCode: l.attributeCode,
      attributeName: l.attributeName,
      impactoAssinado: Number(impactoAssinado.toFixed(6)),
    });
  }
  contribuicoes.sort((a, b) => Math.abs(b.impactoAssinado) - Math.abs(a.impactoAssinado));
  const melhorCausa = contribuicoes[0] ?? null;

  const sinaisD = new Set(D.map((l) => sinalDaLinha(l)));

  const base = {
    impactoLiquido: Q.length > 0 ? Number(signedSum.toFixed(6)) : null,
    totalAlteracoes,
    alteracoesMateriais,
    alteracoesClassificadas: classificadas,
    coberturaPorQuantidade,
    coberturaPorImpacto,
    confiabilidade,
    principalCausa: melhorCausa,
    contribuicoes,
  };

  if (confiabilidade === null || confiabilidade < LIMIAR_COBERTURA) {
    return { ...base, veredito: "INCONCLUSIVO" };
  }
  if (sinaisD.has(1) && sinaisD.has(-1)) {
    return { ...base, veredito: "MISTO" };
  }
  if (signedSum !== 0) {
    const sinalQ = signedSum > 0 ? 1 : -1;
    if ((sinaisD.has(1) || sinaisD.has(-1)) && !sinaisD.has(sinalQ)) {
      return { ...base, veredito: "MISTO" };
    }
  }
  if (Math.abs(signedSum) <= PISO_MATERIALIDADE) {
    return { ...base, veredito: "IGUAL" };
  }
  return { ...base, veredito: signedSum > 0 ? "MELHOROU" : "PIOROU" };
}

// ---------------------------------------------------------------------------
// Resolver o contexto e a comparação — a mesma vigência que /trecho-360 usa.
// ---------------------------------------------------------------------------

export interface ComparacaoDeTrecho {
  context: ContextInfo;
  changeSetId: string;
  effectiveDate: string;
  sourceLabel: string;
  previousLabel: string | null;
}

/**
 * A comparação de TRECHO mais recente do contexto pedido — ou a vigência
 * pedida, quando `requested` inclui uma.
 *
 * Não reaproveita `getConsolidated`/`/changes/latest`: os dois escolhem a
 * série mais recente **entre todas**, e o commit que excluiu TRECHO dos
 * motores compartilhados (`naoEhSoTrecho`, ver `series.ts`) existe
 * justamente para que uma unidade só-de-trecho não vire, por acidente, "a
 * vigência mais recente" de uma tela pensada para equipamento. Aqui o
 * requisito é o oposto — TRECHO é a série que se quer —, então a resolução
 * é própria: primeiro o contexto (unidade/canal), incluindo explicitamente a
 * "casca" de trecho sozinho (`incluirCascaDeTrecho: true`) que as outras
 * telas escondem, depois a série `entity_type_set = 'TRECHO'` dentro dele.
 *
 * Retorna `null` quando o contexto não existe, ou quando ele existe mas não
 * tem nenhuma vigência de TRECHO — os dois casos viram 404 na rota, com
 * mensagens diferentes.
 *
 * **A lista de contextos usada para o "padrão, sem pedido" é a mesma de
 * `/contexts`** — a que a barra lateral lê para decidir qual unidade é "a
 * atual". Usar aqui uma lista diferente (mesmo que só para incluir a casca de
 * trecho) faria o "mais recente" desta rota divergir do que a barra lateral
 * mostra: a caixa "Unidade atual" diria uma unidade, e o Radar, sem receber
 * `scopeHash` nenhum, resolveria silenciosamente outra — foi exatamente o
 * defeito que produziu "este contexto não tem trecho importado" com a
 * unidade certa visível na tela. A casca só entra quando alguém **pede** um
 * `scopeHash` explícito (o seletor de unidade, depois de trocar), porque aí
 * a pergunta deixou de ser "qual é o padrão" e passou a ser "este que foi
 * pedido existe" — e um scope só-de-trecho é uma resposta legítima a ela.
 */
export type ResultadoDaComparacaoDeTrecho =
  | ({ erro: null } & ComparacaoDeTrecho)
  | { erro: "SEM_CONTEXTO" }
  | { erro: "SEM_TRECHO" }
  | { erro: "PRIMEIRA_VIGENCIA"; context: ContextInfo; effectiveDate: string; sourceLabel: string };

export async function resolverComparacaoDeTrecho(
  db: Database,
  requested?: RequestedContext,
): Promise<ResultadoDaComparacaoDeTrecho> {
  const wantsScope = requested?.scopeHash !== undefined && requested.scopeHash !== null;
  const contexts = await listContexts(db, { incluirCascaDeTrecho: wantsScope });
  const context = await resolveContext(db, requested, contexts).catch(() => null);
  if (!context) return { erro: "SEM_CONTEXTO" };

  /*
    A vigência é achada por **presença de fato** — o mesmo método de
    `listarFrota` (`ativos.ts`), que já é o que Trecho 360° usa. Não filtra
    por `snapshot.entity_type_set = 'TRECHO'`: essa comparação exata falha
    sempre que o trecho chega na mesma vigência que cavalo/carreta (um
    `entity_type_set` composto, tipo `CAVALO+CARRETA+TRECHO`), que é um
    formato real de entrega — a Ambev não promete um arquivo por
    equipamento. A entidade é que sabe o próprio tipo; a vigência não
    precisa saber que só carrega um.
  */
  const { rows } = await db.execute<{
    id: string;
    effective_date: string;
    source_label: string;
  }>(sql`
    SELECT s.id, s.effective_date::text AS effective_date, s.source_label
      FROM snapshot s
      JOIN fato_visivel f ON f.snapshot_id = s.id
      JOIN entity e       ON e.id = f.entity_id
     WHERE e.entity_type = 'TRECHO'
       AND s.status <> 'SUPERSEDED'
       AND NOT EXISTS (
             SELECT 1 FROM import_run
              WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL
           )
       AND ${contextFilter("s", context)}
     ORDER BY s.effective_date DESC
     LIMIT 1
  `);
  const latest = rows[0];
  if (!latest) return { erro: "SEM_TRECHO" };

  const previousId = await findPreviousSnapshot(db, latest.id);
  const previousLabel = previousId
    ? (
        await db.execute<{ source_label: string }>(
          sql`SELECT source_label FROM snapshot WHERE id = ${previousId}::uuid`,
        )
      ).rows[0]?.source_label ?? null
    : null;

  if (!previousId) {
    return {
      erro: "PRIMEIRA_VIGENCIA",
      context,
      effectiveDate: latest.effective_date,
      sourceLabel: latest.source_label,
    };
  }

  const set = await computeChangeSet(db, previousId, latest.id, { computedBy: "api:radar-trechos" });

  return {
    erro: null,
    context,
    changeSetId: set.id,
    effectiveDate: latest.effective_date,
    sourceLabel: latest.source_label,
    previousLabel,
  };
}

// ---------------------------------------------------------------------------
// A leitura — uma varredura, agregada em memória.
// ---------------------------------------------------------------------------

const RESUMO_SEM_ALTERACAO: ResumoDoTrecho = {
  veredito: "IGUAL",
  impactoLiquido: 0,
  totalAlteracoes: 0,
  alteracoesMateriais: 0,
  alteracoesClassificadas: 0,
  coberturaPorQuantidade: null,
  coberturaPorImpacto: null,
  confiabilidade: null,
  principalCausa: null,
  contribuicoes: [],
};

export interface TrechoDoRadar {
  entityId: string;
  entityLabel: string | null;
  resumo: ResumoDoTrecho;
}

const ORDEM_DO_VEREDITO: Record<Veredito, number> = {
  PIOROU: 0,
  MISTO: 1,
  INCONCLUSIVO: 2,
  MELHOROU: 3,
  IGUAL: 4,
};

export interface OpcoesDoRadar {
  /** Vazio ou ausente = todos. */
  status?: Veredito[];
  /** Substring, case-insensitive, contra `entityLabel`. */
  busca?: string;
  limit?: number;
  offset?: number;
}

export interface RadarDeTrechos {
  /** Quantos trechos passam no filtro (status + busca), antes da paginação. */
  total: number;
  /** Por status, sobre o recorte de busca — antes do filtro de status. */
  contagens: Record<Veredito, number>;
  trechos: TrechoDoRadar[];
}

/**
 * O Radar — um trecho por linha, consolidado a partir de um ou mais
 * change-sets (tipicamente um: a comparação mais recente da série de TRECHO).
 *
 * ---------------------------------------------------------------------------
 * Plano de consultas, e por que ele escala
 * ---------------------------------------------------------------------------
 * Duas consultas, nenhuma delas por trecho:
 *
 * 1. Uma varredura de `change` (já indexado por `change_set_id`), filtrada a
 *    `entity_type = 'TRECHO'` e `ALTERACAO_DE_ORIGEM_VISIVEL` (fatos ocultos
 *    respeitados, do mesmo jeito que `situacaoPorAtivo` já faz para a Frota).
 *    Cada linha é uma alteração; centenas de trechos com dezenas de
 *    alterações cada somam milhares de linhas, não milhões — cabe numa
 *    varredura só, sem paginar no banco.
 * 2. Uma segunda varredura, por `snapshot_b_id` do(s) change-set(s), lê a
 *    **população inteira** de trechos daquela vigência via `fato_visivel`
 *    (mesmo padrão de `listarFrota`) — necessária porque um trecho sem
 *    nenhuma alteração não gera linha em `change` (o motor pula
 *    `unchanged`), e sem esta consulta ele desapareceria do Radar em vez de
 *    contar como IGUAL.
 *
 * A classificação (`classificarTrecho`) roda em memória sobre o resultado
 * já agrupado por `entity_id` — uma redução O(linhas), não uma consulta por
 * trecho. Filtro de status/busca e paginação também são em memória, sobre um
 * conjunto de centenas de linhas, não milhares: o gargalo real é a consulta
 * SQL, e ela é única em cada uma das duas etapas.
 */
export async function getRadarDeTrechos(
  db: Database,
  changeSetId: string | string[],
  opcoes: OpcoesDoRadar = {},
): Promise<RadarDeTrechos> {
  const ids = Array.isArray(changeSetId) ? changeSetId : [changeSetId];
  if (ids.length === 0) {
    return {
      total: 0,
      contagens: { PIOROU: 0, MELHOROU: 0, IGUAL: 0, MISTO: 0, INCONCLUSIVO: 0 },
      trechos: [],
    };
  }

  const grupos = new Map<string, { entityLabel: string | null; linhas: AlteracaoDoTrecho[] }>();

  const conjuntos = await db
    .select({ id: changeSetTable.id, snapshotBId: changeSetTable.snapshotBId })
    .from(changeSetTable)
    .where(inArray(changeSetTable.id, ids));
  const snapshotBIds = [...new Set(conjuntos.map((c) => c.snapshotBId))];

  if (snapshotBIds.length > 0) {
    const { rows: presentes } = await db.execute<{ entity_id: string; label: string | null }>(sql`
      SELECT DISTINCT f.entity_id::text AS entity_id,
             (SELECT i.identifier_value FROM entity_identifier i
               WHERE i.entity_id = f.entity_id AND i.is_current
               ORDER BY i.identifier_type LIMIT 1) AS label
        FROM fato_visivel f
        JOIN snapshot s ON s.id = f.snapshot_id
        JOIN entity e   ON e.id = f.entity_id
       WHERE e.entity_type = 'TRECHO'
         AND s.id = ANY(${snapshotBIds}::uuid[])
         AND NOT EXISTS (
               SELECT 1 FROM import_run
                WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL
             )
    `);
    for (const p of presentes) {
      grupos.set(p.entity_id, { entityLabel: p.label, linhas: [] });
    }
  }

  const linhas = await db
    .select({
      entityId: changeTable.entityId,
      entityLabel: changeTable.entityLabel,
      attributeCode: changeTable.attributeCode,
      attributeName: changeTable.attributeName,
      economicDirection: changeTable.economicDirection,
      impactConfidence: changeTable.impactConfidence,
      impactAmount: changeTable.impactAmount,
    })
    .from(changeTable)
    .where(
      and(
        inArray(changeTable.changeSetId, ids),
        eq(changeTable.entityType, "TRECHO"),
        ALTERACAO_DE_ORIGEM_VISIVEL,
      ),
    );

  for (const l of linhas) {
    if (l.entityId === null) continue;
    const grupo = grupos.get(l.entityId) ?? { entityLabel: l.entityLabel, linhas: [] };
    grupo.entityLabel ??= l.entityLabel;
    grupo.linhas.push({
      attributeCode: l.attributeCode ?? "",
      attributeName: l.attributeName ?? l.attributeCode ?? "",
      economicDirection: l.economicDirection as DirecaoEconomica,
      impactConfidence: l.impactConfidence as ImpactConfidence,
      impactAmount: l.impactAmount === null ? null : Number(l.impactAmount),
    });
    grupos.set(l.entityId, grupo);
  }

  let trechos: TrechoDoRadar[] = [...grupos.entries()].map(([entityId, g]) => ({
    entityId,
    entityLabel: g.entityLabel,
    resumo: g.linhas.length === 0 ? RESUMO_SEM_ALTERACAO : classificarTrecho(g.linhas),
  }));

  if (opcoes.busca && opcoes.busca.trim() !== "") {
    const alvo = opcoes.busca.trim().toLowerCase();
    trechos = trechos.filter((t) => (t.entityLabel ?? "").toLowerCase().includes(alvo));
  }

  /*
    As contagens por status são do conjunto recortado pela busca, mas
    **antes** do filtro de status — é o que permite os cards mostrarem os
    cinco totais ao mesmo tempo, inclusive quando um deles já está
    selecionado como filtro da tabela.
  */
  const contagens: Record<Veredito, number> = {
    PIOROU: 0,
    MELHOROU: 0,
    IGUAL: 0,
    MISTO: 0,
    INCONCLUSIVO: 0,
  };
  for (const t of trechos) contagens[t.resumo.veredito]++;

  if (opcoes.status && opcoes.status.length > 0) {
    const permitido = new Set(opcoes.status);
    trechos = trechos.filter((t) => permitido.has(t.resumo.veredito));
  }

  /*
    Fila de atenção: Piorou primeiro, e dentro dele o de maior impacto
    negativo; depois Misto, Inconclusivo, Melhorou, Igual. Dentro de cada
    grupo, materialidade decide o desempate — maior |impacto| primeiro, os
    sem impacto apurado por último; a placa quebra o empate final para que a
    ordem seja estável entre duas chamadas.
  */
  trechos.sort((a, b) => {
    const ordem = ORDEM_DO_VEREDITO[a.resumo.veredito] - ORDEM_DO_VEREDITO[b.resumo.veredito];
    if (ordem !== 0) return ordem;
    const ia = a.resumo.impactoLiquido;
    const ib = b.resumo.impactoLiquido;
    if (ia !== null && ib !== null && ia !== ib) return Math.abs(ib) - Math.abs(ia);
    if (ia !== null && ib === null) return -1;
    if (ia === null && ib !== null) return 1;
    return (a.entityLabel ?? "").localeCompare(b.entityLabel ?? "", "pt-BR", { numeric: true });
  });

  const total = trechos.length;

  /*
    Sem `limit`, não pagina — devolve todos os que passaram no filtro. Os
    cards de contagem por status precisam do conjunto inteiro para não
    subcontar; é a chamada paginada (com `limit`) que corta a lista para a
    tabela, depois de `contagens` já estar certo.
  */
  const offset = opcoes.offset ?? 0;
  const pagina = opcoes.limit === undefined ? trechos : trechos.slice(offset, offset + opcoes.limit);
  return { total, contagens, trechos: pagina };
}
