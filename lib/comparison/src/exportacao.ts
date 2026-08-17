import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  chaveDeAgrupamento,
  montarMatriz,
  type PontaAPonta,
  type PresencaNaMatriz,
  type QuinzenaGroup,
  type QuinzenaPeriod,
  type ValorDaMatriz,
  type VigenciaDaMatriz,
} from "./impacto";
import { attributeLabel } from "./labels";
import {
  getPanoramaDeAlteracoes,
  listaDeTexto,
  type ClasseDeCusto,
  type LeituraDeAlteracoes,
  type ParametroAlterado,
} from "./panorama";
import {
  contextFilter,
  type ContextInfo,
  type RequestedContext,
  type SeriesContext,
} from "./series";

/**
 * A aba Impacto inteira, do jeito que ela sai em Excel.
 *
 * A tela responde em dois níveis: *o que mudou* (o panorama) e *quanto cada
 * ativo custa em cada quinzena* (a matriz, um parâmetro por vez). Quem confere o
 * mês precisa dos dois ao mesmo tempo — e hoje isso significa clicar em trinta e
 * cinco linhas, esperar trinta e cinco tabelas e copiar cada uma. Esta leitura é
 * essa mesma navegação feita de uma vez: o panorama decide **quais** parâmetros
 * entram, e cada um deles vira uma matriz completa.
 *
 * Três decisões separam isto de um dump de `fact`:
 *
 * **1. Quem entra é o panorama, não uma varredura.** "Parâmetro que teve
 * alteração" é uma definição com regras — a célula vazia quebra a cadeia em vez
 * de ser pulada, e o recorte De/Até vale — e ela já existe em `panorama.ts`.
 * Reescrevê-la aqui produziria um arquivo com um número de alterações diferente
 * do que a tela mostra, o que é pior do que não exportar.
 *
 * **2. As matrizes saem da mesma função da tela.** {@link montarMatriz} é
 * compartilhada com `getQuinzenaMatrix`: "ausência não é zero", a vigência que
 * não entregou o equipamento e a comparação que a pula são as garantias desta
 * leitura, e o Excel precisa delas mais do que a tela — no arquivo não há
 * `title` para explicar uma célula, e um zero digitado onde o ativo não estava
 * na frota é uma afirmação que ninguém vai conferir.
 *
 * **3. O banco é lido por equipamento, não por parâmetro.** Trinta e cinco
 * chamadas a `getQuinzenaMatrix` seriam duzentas consultas para produzir um
 * arquivo. As presenças, as placas e a dobra são as **mesmas** para todos os
 * parâmetros de um equipamento; só os valores mudam, e eles vêm numa consulta
 * só, para todos os códigos de uma vez.
 *
 * O que **não** se filtra aqui é o que a tela deixa de fora dos rankings: a
 * parcela cujo total também mudou e a coluna que já contém o outro equipamento.
 * Elas mudaram, alguém vai procurá-las, e uma aba a menos num arquivo é uma
 * ausência sem explicação. Cada aba diz o papel que tem
 * ({@link AbaDeImpacto.linhaEconomica}), que é o que impede alguém de somar as
 * abas entre si e contar o mesmo real duas vezes.
 */

/** O corte de classe de custo pedido. `TUDO` é o panorama inteiro. */
export type CorteDaExportacao = "TUDO" | ClasseDeCusto;

/** Uma aba: um parâmetro que mudou, com a matriz dele inteira. */
export interface AbaDeImpacto {
  /**
   * O parâmetro e a régua dele, como o panorama os apurou.
   *
   * Vem inteiro em vez de campo a campo porque o cabeçalho da aba precisa de
   * quase tudo — unidade, periodicidade, classe, grupo, quantas alterações, e o
   * motivo de não haver dinheiro apurado quando não há.
   */
  parametro: ParametroAlterado;
  /**
   * Se o parâmetro é uma das linhas econômicas do panorama.
   *
   * `false` são os dois casos que a tela tira dos rankings para não contar o
   * mesmo real duas vezes: a parcela cujo total também mudou, e a coluna que já
   * embute o outro equipamento. A aba existe do mesmo jeito — ver o topo do
   * arquivo —, e este campo é o que a mantém honesta.
   */
  linhaEconomica: boolean;
  /** Por qual coluna as linhas estão dobradas. Null quando não há como dobrar. */
  groupedBy: { code: string; title: string } | null;
  periods: QuinzenaPeriod[];
  groups: QuinzenaGroup[];
  totals: (number | null)[];
  grandTotal: number | null;
  /** Ativos nesta aba — a soma das linhas de todos os grupos. */
  ativos: number;
  pontaAPonta: PontaAPonta | null;
}

export interface ExportacaoDeImpacto {
  context: ContextInfo;
  corte: CorteDaExportacao;
  /** O nome do corte como a tela o escreve. Null em "Tudo". */
  corteNome: string | null;
  /** As vigências do recorte, na ordem — o eixo das colunas de toda aba. */
  periodos: { effectiveDate: string; sourceLabel: string }[];
  /** Os totais do panorama, para o índice repetir os ladrilhos da tela. */
  totais: LeituraDeAlteracoes["totais"];
  abas: AbaDeImpacto[];
}

export interface ExportacaoOptions {
  context?: RequestedContext;
  /** O corte de classe ativo na tela. Sem ele, tudo que mudou. */
  classe?: CorteDaExportacao;
}

/**
 * Tudo que mudou, parâmetro a parâmetro, com a matriz de cada um.
 *
 * Devolve `null` quando o contexto não tem vigência nenhuma — a rota traduz em
 * 404, como as outras duas leituras desta aba.
 */
export async function getExportacaoDeImpacto(
  db: Database,
  options: ExportacaoOptions = {},
): Promise<ExportacaoDeImpacto | null> {
  const panorama = await getPanoramaDeAlteracoes(db, {
    ...(options.context !== undefined ? { context: options.context } : {}),
  });
  if (!panorama) return null;

  const corte = options.classe ?? "TUDO";
  const recorte =
    corte === "TUDO" ? null : (panorama.recortes.find((r) => r.classe === corte) ?? null);
  const leitura: LeituraDeAlteracoes = recorte ?? panorama;

  /*
    A ordem das abas é a ordem da lista da tela — dinheiro apurado primeiro, pelo
    módulo da variação de preço; depois o que mudou muito e ainda não sabemos
    ler. Reordenar aqui (alfabético, por código) faria o arquivo abrir num
    parâmetro que a tela não mostra em cima, e a primeira aba de um arquivo é
    lida como a resposta.
  */
  const escolhidos = panorama.parametros.filter(
    (p) => corte === "TUDO" || p.classeDeCusto === corte,
  );
  const economicas = new Set(leitura.maisAlterados);

  const context = panorama.context;
  const porTipo = new Map<string, ParametroAlterado[]>();
  for (const p of escolhidos) {
    const lista = porTipo.get(p.entityType);
    if (lista) lista.push(p);
    else porTipo.set(p.entityType, [p]);
  }

  const corpos = new Map<string, Omit<AbaDeImpacto, "parametro" | "linhaEconomica">>();
  for (const [entityType, parametros] of porTipo) {
    const periodos = await lerVigencias(db, context, entityType);
    // Um equipamento sem vigência nenhuma no recorte não rende aba: os
    // parâmetros dele ficam de fora, e o índice não os promete.
    if (periodos.length === 0) continue;

    const [presencas, placaDe, dobra, valoresPorCodigo] = await Promise.all([
      lerPresencas(db, context, entityType),
      lerPlacas(db, entityType),
      lerDobra(db, context, entityType),
      lerValores(
        db,
        context,
        parametros.map((p) => p.code),
      ),
    ]);

    for (const p of parametros) {
      const corpo = montarMatriz({
        periodos,
        presencas,
        valores: valoresPorCodigo.get(p.code) ?? [],
        placaDe,
        grupoDe: dobra.grupoDe,
      });
      corpos.set(p.code, {
        groupedBy: dobra.groupedBy,
        periods: corpo.periods,
        groups: corpo.groups,
        totals: corpo.totals,
        grandTotal: corpo.grandTotal,
        ativos: corpo.entities,
        pontaAPonta: corpo.pontaAPonta,
      });
    }
  }

  const abas: AbaDeImpacto[] = [];
  for (const parametro of escolhidos) {
    const corpo = corpos.get(parametro.code);
    if (!corpo) continue;
    abas.push({
      parametro,
      linhaEconomica: economicas.has(parametro.code),
      ...corpo,
    });
  }

  return {
    context,
    corte,
    corteNome: recorte?.nome ?? null,
    periodos: panorama.periods.map((p) => ({
      effectiveDate: p.effectiveDate,
      sourceLabel: p.sourceLabel,
    })),
    totais: leitura.totais,
    abas,
  };
}

/**
 * O eixo das colunas de um equipamento.
 *
 * Mesma consulta de `getQuinzenaMatrix`, e `delivered` pelo mesmo motivo: sem
 * ele uma entrega parcial pintaria a coluna inteira de saída de ativo.
 */
async function lerVigencias(
  db: Database,
  context: SeriesContext,
  entityType: string,
): Promise<VigenciaDaMatriz[]> {
  const { rows } = await db.execute<{
    effective_date: string;
    source_label: string;
    delivered: boolean;
  }>(sql`
    SELECT s.effective_date::text AS effective_date,
           string_agg(DISTINCT s.source_label, ' · ') AS source_label,
           bool_or(${entityType} = ANY (string_to_array(s.entity_type_set, '+'))) AS delivered
      FROM snapshot s
     WHERE s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", context)}
     GROUP BY 1
     ORDER BY 1
  `);
  return rows.map((r) => ({
    effectiveDate: r.effective_date,
    sourceLabel: r.source_label,
    delivered: r.delivered,
  }));
}

/** Quem estava na frota em cada vigência — ter **qualquer** fato nela. */
async function lerPresencas(
  db: Database,
  context: SeriesContext,
  entityType: string,
): Promise<PresencaNaMatriz[]> {
  const { rows } = await db.execute<{ effective_date: string; entity_id: string }>(sql`
    SELECT s.effective_date::text AS effective_date,
           f.entity_id::text AS entity_id
      FROM fact f
      JOIN snapshot s ON s.id = f.snapshot_id
      JOIN entity e   ON e.id = f.entity_id
     WHERE e.entity_type = ${entityType}
       AND s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", context)}
     GROUP BY 1, 2
  `);
  return rows.map((r) => ({
    effectiveDate: r.effective_date,
    entityId: r.entity_id,
  }));
}

async function lerPlacas(
  db: Database,
  entityType: string,
): Promise<Map<string, string>> {
  const { rows } = await db.execute<{ entity_id: string; valor: string }>(sql`
    SELECT ei.entity_id::text AS entity_id, ei.identifier_value AS valor
      FROM entity_identifier ei
      JOIN entity e ON e.id = ei.entity_id
     WHERE ei.identifier_type = 'PLACA'
       AND ei.is_current
       AND e.entity_type = ${entityType}
  `);
  return new Map(rows.map((r) => [r.entity_id, r.valor]));
}

/**
 * A dobra das linhas: a data de entrada de cada ativo.
 *
 * A mesma coluna que a tabela dinâmica do cliente usa, e a mesma que a tela
 * mostra. Vem uma vez por equipamento porque não depende do parâmetro.
 */
async function lerDobra(
  db: Database,
  context: SeriesContext,
  entityType: string,
): Promise<{
  grupoDe: Map<string, { key: string; label: string; order: string }>;
  groupedBy: { code: string; title: string } | null;
}> {
  const code = `${entityType.toLowerCase()}.data`;
  const { rows } = await db.execute<{
    entity_id: string;
    value_date: string | null;
    value_numeric: string | null;
    value_text: string | null;
    source_name: string;
    display_name: string | null;
  }>(sql`
    SELECT DISTINCT ON (f.entity_id)
           f.entity_id::text AS entity_id,
           f.value_date::text AS value_date,
           f.value_numeric::text AS value_numeric,
           f.value_text,
           a.source_name, a.display_name
      FROM fact f
      JOIN snapshot s  ON s.id = f.snapshot_id
      JOIN attribute a ON a.id = f.attribute_id
     WHERE a.code = ${code}
       AND NOT f.is_null
       AND s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", context)}
     ORDER BY f.entity_id, s.effective_date DESC
  `);

  const grupoDe = new Map<string, { key: string; label: string; order: string }>();
  for (const g of rows) {
    const chave = chaveDeAgrupamento({
      valueDate: g.value_date,
      valueNumeric: g.value_numeric,
      valueText: g.value_text,
    });
    if (chave) grupoDe.set(g.entity_id, chave);
  }

  return {
    grupoDe,
    groupedBy:
      rows.length > 0
        ? {
            code,
            title: attributeLabel(code, rows[0].source_name, rows[0].display_name),
          }
        : null,
  };
}

/**
 * Os valores de todos os parâmetros de um equipamento, numa consulta só.
 *
 * É a única parte que muda de parâmetro para parâmetro, e é por isso que ela
 * traz todos de uma vez: o custo de um arquivo com trinta e cinco abas passa a
 * ser uma consulta por equipamento em vez de uma por aba.
 */
async function lerValores(
  db: Database,
  context: SeriesContext,
  codes: string[],
): Promise<Map<string, ValorDaMatriz[]>> {
  const porCodigo = new Map<string, ValorDaMatriz[]>();
  if (codes.length === 0) return porCodigo;

  const { rows } = await db.execute<{
    code: string;
    effective_date: string;
    entity_id: string;
    value_numeric: string | null;
    is_null: boolean;
  }>(sql`
    SELECT a.code,
           s.effective_date::text AS effective_date,
           f.entity_id::text AS entity_id,
           f.value_numeric::text AS value_numeric,
           f.is_null
      FROM fact f
      JOIN snapshot s   ON s.id = f.snapshot_id
      JOIN attribute a  ON a.id = f.attribute_id
     WHERE a.code = ANY (${listaDeTexto(codes)})
       AND s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", context)}
  `);

  for (const r of rows) {
    const lista = porCodigo.get(r.code);
    const valor: ValorDaMatriz = {
      effectiveDate: r.effective_date,
      entityId: r.entity_id,
      valueNumeric: r.value_numeric,
      isNull: r.is_null,
    };
    if (lista) lista.push(valor);
    else porCodigo.set(r.code, [valor]);
  }
  return porCodigo;
}
