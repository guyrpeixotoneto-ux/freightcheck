import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { excelSerialToDate, isPlausibleDateSerial } from "@workspace/ingest";
import {
  comValor,
  contextosDisponiveis,
  filtroDeVigenciaDisponivel,
  foraDoRecorte,
  naoCalculavel,
  naoExiste,
  naoSeAplica,
  type ComVazio,
} from "@workspace/availability";
import { attributeLabel, equipmentLabel } from "./labels";
import {
  contextFilter,
  resolveContext,
  type ContextInfo,
  type SeriesContext,
} from "./series";

/**
 * Impacto — um parâmetro financeiro, ativo a ativo, vigência a vigência.
 *
 * As outras leituras deste pacote respondem *o que mudou* entre duas vigências:
 * elas partem da alteração e chegam ao dinheiro. Esta parte do outro lado —
 * **quanto cada ativo custa em cada quinzena** — e deixa a alteração aparecer
 * como a diferença entre duas colunas vizinhas. É a tabela dinâmica que o
 * cliente monta no Excel, feita aqui em cima do canônico.
 *
 * A troca não é cosmética. Uma lista de alterações responde "o que mexeu"; ela
 * não responde "quanto isto custava em abril e quanto custa agora", que é a
 * pergunta de quem confere o mês. E não responde porque uma alteração só existe
 * quando houve mudança: o ativo que nunca mexeu não aparece em lista nenhuma —
 * e é exatamente ele que precisa estar na tabela para o total da coluna fechar
 * com o que a Ambev pagou.
 *
 * Três regras separam esta leitura de uma soma ingênua, e nenhuma é negociável:
 *
 * 1. **Ausência não é zero.** Um ativo fora da vigência tem célula vazia, nunca
 *    R$ 0,00 — a diferença entre "saiu da frota" e "passou a custar nada" é a
 *    diferença entre uma frota menor e um desconto.
 * 2. **Vigência que não entregou o equipamento não é frota vazia.** Se a
 *    quinzena veio só com carretas, a coluna dos cavalos é *não entregue*, e
 *    nenhum cavalo "saiu" nela.
 * 3. **Entrada e saída de ativo ficam fora do dinheiro.** A variação entre as
 *    duas pontas é decomposta em três parcelas — quem estava nas duas, quem
 *    entrou e quem saiu —, pela mesma razão que `end-to-end.ts` explica em
 *    detalhe: frota maior não é preço maior.
 */

/** O que a célula é, antes de ser um número. */
export type EstadoDaCelula =
  /** O ativo estava na vigência e o parâmetro tinha valor. */
  | "VALOR"
  /** O ativo estava na vigência; o parâmetro veio vazio. */
  | "SEM_VALOR"
  /** O ativo não está nesta vigência. */
  | "FORA_DA_FROTA"
  /** Esta vigência não entregou o arquivo deste equipamento. */
  | "NAO_ENTREGUE";

/**
 * O movimento em relação à vigência anterior **que entregou o equipamento**.
 *
 * `ENTROU` e `SAIU` não carregam `delta`: o dinheiro que chega com um ativo
 * novo não é aumento de preço, e somá-lo à variação faria a tela dizer que o
 * cliente ficou mais caro quando o que houve foi frota maior.
 */
export type Movimento = "SUBIU" | "CAIU" | "IGUAL" | "ENTROU" | "SAIU" | null;

export interface QuinzenaCell {
  value: number | null;
  state: EstadoDaCelula;
  /** Diferença para a vigência anterior, só quando as duas têm valor. */
  delta: number | null;
  movimento: Movimento;
}

export interface QuinzenaRow {
  entityId: string;
  /** A placa. Null quando o ativo não tem identificador corrente. */
  plate: string | null;
  cells: QuinzenaCell[];
  /**
   * A soma das colunas — o "Total Geral" da tabela dinâmica.
   *
   * É a soma de valores de quinzenas diferentes, e portanto **não** é o custo
   * de um período: serve para ordenar e para reproduzir a planilha que o
   * cliente já usa. Quem quiser a variação tem `delta` ao lado.
   */
  total: number | null;
  /** Primeiro e último valor observados, e a distância entre eles. */
  first: number | null;
  last: number | null;
  delta: number | null;
  /** Em quantas vigências entregues o ativo apareceu. */
  periods: number;
}

export interface QuinzenaGroup {
  key: string;
  label: string;
  rows: QuinzenaRow[];
  /** Uma soma por vigência; null quando nenhum ativo do grupo tinha valor. */
  totals: (number | null)[];
  total: number | null;
}

export interface QuinzenaPeriod {
  effectiveDate: string;
  /** O rótulo do arquivo — `EMPURRADA_2_12_2025`. É o cabeçalho da coluna. */
  sourceLabel: string;
  /** A vigência trouxe o arquivo deste equipamento? */
  delivered: boolean;
  /** Ativos deste tipo presentes na vigência. */
  entities: number;
  /** Ativos com valor apurado neste parâmetro. */
  withValue: number;
  total: number | null;
}

/** Um parâmetro que a tela deixa escolher, com a régua dele à vista. */
export interface ImpactoParametro {
  code: string;
  title: string;
  sourceName: string;
  entityType: string;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  isMonetary: boolean | null;
  semanticsStatus: string;
  /**
   * Passa na régua de `assessImpact`: semântica confirmada, monetário e
   * somável. O que não passa continua escolhível — e a tela diz o que falta,
   * em vez de esconder a coluna e deixar quem procura sem resposta.
   */
  somavel: boolean;
}

/**
 * A decomposição da variação entre as duas pontas.
 *
 * `delta` é sempre `comparados.delta + entraram.amount − sairam.amount`. A
 * identidade é o ponto: ela é o que impede a tela de atribuir a preço o que foi
 * tamanho de frota.
 */
export interface PontaAPonta {
  from: string;
  fromLabel: string;
  to: string;
  toLabel: string;
  /** Ativos com valor nas duas pontas — o único lugar onde "ficou mais caro" cabe. */
  comparados: { entities: number; delta: number };
  /** Valor só na ponta final. `foraDaFrota` são os que nem existiam antes. */
  entraram: { entities: number; amount: number; foraDaFrota: number };
  /** Valor só na ponta inicial. */
  sairam: { entities: number; amount: number; foraDaFrota: number };
  totalFrom: number;
  totalTo: number;
  delta: number;
}

export interface QuinzenaMatrix {
  context: ContextInfo;
  entityType: string;
  equipment: string;
  /** Os equipamentos que este contexto já entregou — os botões da tela. */
  entityTypes: string[];
  attribute: ImpactoParametro;
  parameters: ImpactoParametro[];
  /** Por qual coluna as linhas estão dobradas. Null quando não há como dobrar. */
  groupedBy: { code: string; title: string } | null;
  periods: QuinzenaPeriod[];
  groups: QuinzenaGroup[];
  totals: (number | null)[];
  grandTotal: number | null;
  /** Ativos na tabela — a soma das linhas de todos os grupos. */
  entities: number;
  pontaAPonta: PontaAPonta | null;
}

export interface QuinzenaOptions {
  entityType?: string;
  attributeCode?: string;
  /** A coluna que agrupa as linhas. Sem pedido, a data de entrada do ativo. */
  groupBy?: string;
  context?: Partial<SeriesContext>;
}

/**
 * O parâmetro que a tela abre em cada equipamento.
 *
 * É o custo fixo que o próprio cliente usa para conferir o mês — a coluna
 * "FINAME" de cada aba. Não é uma escolha do produto sobre o que importa: é o
 * ponto de partida da tabela que ele já monta, e qualquer outro parâmetro está
 * a um clique no seletor.
 */
const PARAMETRO_INICIAL: Record<string, string> = {
  CAVALO: "cavalo.finame_cavalo",
  CARRETA: "carreta.finame_implemento",
};

/** Duas casas: o centavo existe no fato, e a soma de 560 ativos não pode deslizar. */
const round2 = (valor: number) => Math.round(valor * 100) / 100;

const num = (valor: string | null): number | null =>
  valor === null ? null : Number(valor);

/**
 * O dia a que um instante pertence, depois de tirado o ruído do ponto
 * flutuante.
 *
 * A coluna `data` não traz dias redondos. O Freightech grava o dia como um
 * serial em ponto flutuante, e o mesmo campo chega de três formas: `12:00:00`,
 * `23:59:59.000` e `23:59:59.999`. As duas últimas se parecem e não são a mesma
 * coisa — uma é o último segundo do dia, a outra é um milissegundo antes da
 * meia-noite seguinte, que é o serial do dia seguinte com erro de
 * arredondamento.
 *
 * Truncar a hora trataria as duas como o dia de baixo, e os dois cavalos que
 * entraram em 01/06/21 apareceriam sob 31/05/21. Arredondar para a meia-noite
 * mais próxima trataria as duas como o dia de cima, e as carretas de 18/11/20
 * iriam para 19/11/20. Nenhuma das duas simplificações reproduz o arquivo.
 *
 * O segundo é a unidade mais fina que a fonte de fato expressa — ela usa
 * `23:59:59` como valor distinto de `12:00:00` na mesma coluna, ver
 * `lib/ingest/src/__tests__/excel-dates.test.ts`. Abaixo dele só há ruído da
 * representação. Arredondar para o segundo e então tomar o dia é a regra que
 * respeita a fonte, e é a que reproduz os grupos das duas tabelas dinâmicas do
 * cliente — a do cavalo e a da carreta — um a um.
 */
export function diaDoInstante(instante: Date): string {
  const segundos = Math.round(instante.getTime() / 1000);
  return new Date(segundos * 1000).toISOString().slice(0, 10);
}

/**
 * A data de entrada, como a tabela dinâmica a agrupa.
 *
 * Três formas chegam do mesmo campo, e cada uma tem uma razão de existir: um
 * `value_date` quando a importação reconheceu a coluna como data; um texto ISO
 * quando o arquivo tipou a célula como data e o instante veio junto; e um
 * número quando o arquivo mandou o serial cru sem formatar (o
 * `AMBIGUOUS_DATE_SERIAL` de `lib/ingest/src/values.ts`, que a importação se
 * recusa a converter por conta própria).
 *
 * A conversão aqui é de leitura e não toca o fato. O que não for data plausível
 * continua agrupado pelo que veio escrito — nunca descartado, porque um ativo
 * sem grupo some da tabela, e sumir é o único resultado inaceitável.
 */
export function chaveDeAgrupamento(fato: {
  valueDate: string | null;
  valueNumeric: string | null;
  valueText: string | null;
}): { key: string; label: string; order: string } | null {
  const porDia = (iso: string) => ({ key: iso, label: dataCurta(iso), order: iso });

  if (fato.valueDate !== null) return porDia(fato.valueDate);

  if (fato.valueText !== null && fato.valueText.trim() !== "") {
    const texto = fato.valueText.trim();
    if (/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(texto)) {
      const instante = new Date(texto);
      if (!Number.isNaN(instante.getTime())) return porDia(diaDoInstante(instante));
    }
    return { key: texto, label: texto, order: texto };
  }

  if (fato.valueNumeric !== null) {
    const serial = Number(fato.valueNumeric);
    if (Number.isFinite(serial) && isPlausibleDateSerial(serial)) {
      const instante = excelSerialToDate(serial);
      if (instante) return porDia(diaDoInstante(instante));
    }
    return { key: fato.valueNumeric, label: fato.valueNumeric, order: fato.valueNumeric };
  }

  return null;
}

/** `2021-01-01` → `01/01/21`, que é como a planilha do cliente escreve. */
function dataCurta(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano.slice(2)}` : iso;
}

/** Os equipamentos que este contexto já entregou. */
export async function listImpactEntityTypes(
  db: Database,
  context: SeriesContext,
): Promise<string[]> {
  const { rows } = await db.execute<{ t: string }>(sql`
    SELECT DISTINCT t
      FROM snapshot s,
           unnest(string_to_array(s.entity_type_set, '+')) t
     WHERE ${filtroDeVigenciaDisponivel("s")}
       AND ${contextFilter("s", context)}
     ORDER BY 1
  `);
  return rows.map((r) => r.t);
}

/**
 * Os parâmetros numéricos de um equipamento, com a régua de cada um.
 *
 * Todos, e não só os somáveis. Esconder os demais faria a tela responder "esse
 * parâmetro não existe" a quem procura por um que existe e ainda não foi
 * confirmado — e a curadoria é justamente o que transforma um no outro.
 */
export async function listImpactParameters(
  db: Database,
  entityType: string,
): Promise<ImpactoParametro[]> {
  const { rows } = await db.execute<{
    code: string;
    source_name: string;
    entity_type: string;
    unit: string | null;
    periodicity: string | null;
    aggregation: string | null;
    is_monetary: boolean | null;
    semantics_status: string;
  }>(sql`
    SELECT a.code, a.source_name, a.entity_type, a.unit, a.periodicity,
           a.aggregation, a.is_monetary,
           a.semantics_status::text AS semantics_status
      FROM attribute a
     WHERE a.entity_type = ${entityType}
       AND a.data_type = 'NUMERIC'
     ORDER BY a.code
  `);

  return rows
    .map((r) => ({
      code: r.code,
      title: attributeLabel(r.code, r.source_name),
      sourceName: r.source_name,
      entityType: r.entity_type,
      unit: r.unit,
      periodicity: r.periodicity,
      aggregation: r.aggregation,
      isMonetary: r.is_monetary,
      semanticsStatus: r.semantics_status,
      somavel:
        r.semantics_status === "CONFIRMED" &&
        r.is_monetary === true &&
        r.aggregation === "SUM",
    }))
    .sort((a, b) => {
      // Os que sustentam dinheiro primeiro: é o que a tela abre, e o resto
      // continua alcançável logo abaixo.
      if (a.somavel !== b.somavel) return a.somavel ? -1 : 1;
      return a.title.localeCompare(b.title, "pt-BR");
    });
}

/**
 * A tabela do impacto: um parâmetro, todos os ativos, todas as vigências.
 *
 * ---------------------------------------------------------------------------
 * Quatro causas de vazio, e uma frase só — a divergência D6
 * ---------------------------------------------------------------------------
 *
 * Esta função devolvia `null` em quatro situações estruturalmente distintas, e
 * a rota traduzia as quatro em `404 "Nenhuma vigência importada ainda."`. As
 * quatro têm conserto oposto:
 *
 * | Causa | O que é de verdade | O que a frase mandava fazer |
 * |---|---|---|
 * | sem contexto resolvível | não há vigência nenhuma | importar — **certo** |
 * | nenhuma vigência declara equipamento | há vigência, e ela não diz de que equipamento é | importar — errado |
 * | equipamento sem coluna numérica | há vigência e há fato; o dicionário não tem parâmetro | importar — **errado, e é o caso desta auditoria** |
 * | contexto sem vigência | o dado está noutro recorte | importar — errado |
 *
 * O terceiro é o defeito em forma pura: dado importado, promovido, visível em
 * Cobertura e em Vigências, e o Impacto respondendo "nenhuma vigência importada
 * ainda". Alguém reimporta o mesmo arquivo e nada muda, porque o que falta é
 * curadoria — não planilha.
 *
 * Agora cada uma tem nome, e o nome vem do vocabulário comum
 * (`@workspace/availability`, `vazio.ts`). A regra que ele impõe é a que esta
 * função violava: **só `NAO_EXISTE` pode virar "não há dados"**.
 */
export async function getQuinzenaMatrix(
  db: Database,
  options: QuinzenaOptions = {},
): Promise<ComVazio<QuinzenaMatrix>> {
  const context = await resolveContext(db, options.context);
  if (!context) {
    // A única das quatro em que a frase antiga era verdadeira.
    return naoExiste(
      "Nenhuma vigência importada ainda. Envie a primeira planilha em Importações.",
    );
  }

  const entityTypes = await listImpactEntityTypes(db, context);
  if (entityTypes.length === 0) {
    return naoCalculavel(
      "Há vigência neste contexto, e nenhuma delas declara equipamento. " +
        "O Impacto é por equipamento, então não há eixo para montar a tabela.",
      "Conferir em Cobertura se as vigências têm agregado por equipamento gravado.",
    );
  }

  /*
    Um equipamento sem coluna numérica no dicionário não sustenta tabela
    nenhuma, e devolver vazio por causa dele apagaria o outro equipamento junto.
    A ordem de tentativa é: o que foi pedido, o cavalo, e então o resto — o
    primeiro que tiver parâmetro é o que abre.
  */
  const candidatos = [
    ...(options.entityType && entityTypes.includes(options.entityType)
      ? [options.entityType]
      : []),
    ...entityTypes.filter((t) => t === "CAVALO"),
    ...entityTypes,
  ].filter((tipo, i, todos) => todos.indexOf(tipo) === i);

  let entityType = candidatos[0];
  let parameters = await listImpactParameters(db, entityType);
  for (const tipo of candidatos.slice(1)) {
    if (parameters.length > 0) break;
    entityType = tipo;
    parameters = await listImpactParameters(db, tipo);
  }
  if (parameters.length === 0) {
    /*
      O caso desta auditoria. O dado está lá — vigência promovida, fato gravado,
      equipamento declarado — e o dicionário não tem nenhuma coluna numérica
      para este equipamento. É `NAO_SE_APLICA`, e nunca ausência de dado.
    */
    return naoSeAplica(
      `O dicionário não tem parâmetro numérico para ${candidatos.join(" nem ")}. ` +
        `As vigências estão importadas e visíveis em Cobertura; o que falta é a ` +
        `curadoria confirmar o que cada coluna mede.`,
    );
  }

  const escolhido =
    parameters.find((p) => p.code === options.attributeCode) ??
    parameters.find((p) => p.code === PARAMETRO_INICIAL[entityType]) ??
    parameters.find((p) => p.somavel) ??
    parameters[0];

  // ---- o eixo das colunas ---------------------------------------------------
  /*
    `delivered` é o que separa "a frota inteira sumiu" de "esta quinzena veio
    só com carretas". Sem ele, uma entrega parcial pintaria a coluna inteira de
    saída de ativo — e a leitura ponta a ponta contaria como devolução de frota
    o que foi apenas um arquivo que não chegou.
  */
  const { rows: periodRows } = await db.execute<{
    effective_date: string;
    source_label: string;
    delivered: boolean;
  }>(sql`
    SELECT s.effective_date::text AS effective_date,
           string_agg(DISTINCT s.source_label, ' · ') AS source_label,
           bool_or(${entityType} = ANY (string_to_array(s.entity_type_set, '+'))) AS delivered
      FROM snapshot s
     WHERE ${filtroDeVigenciaDisponivel("s")}
       AND ${contextFilter("s", context)}
     GROUP BY 1
     ORDER BY 1
  `);
  if (periodRows.length === 0) {
    return foraDoRecorte(
      "Há vigência no sistema, e nenhuma neste contexto.",
      await contextosDisponiveis(db),
    );
  }

  const indiceDoPeriodo = new Map(
    periodRows.map((p, i) => [p.effective_date, i] as const),
  );

  // ---- quem estava na frota em cada vigência --------------------------------
  /*
    Presença é ter **qualquer** fato na vigência, e não ter fato neste
    parâmetro: uma coluna que sumiu do layout tiraria da frota, em silêncio,
    ativos que continuam lá — e o que é ausência de coluna apareceria como
    ausência de ativo.
  */
  const { rows: presencas } = await db.execute<{
    effective_date: string;
    entity_id: string;
  }>(sql`
    SELECT s.effective_date::text AS effective_date,
           f.entity_id::text AS entity_id
      FROM fact f
      JOIN snapshot s ON s.id = f.snapshot_id
      JOIN entity e   ON e.id = f.entity_id
     WHERE e.entity_type = ${entityType}
       AND ${filtroDeVigenciaDisponivel("s")}
       AND ${contextFilter("s", context)}
     GROUP BY 1, 2
  `);

  // ---- o valor do parâmetro em cada vigência --------------------------------
  const { rows: valores } = await db.execute<{
    effective_date: string;
    entity_id: string;
    value_numeric: string | null;
    is_null: boolean;
  }>(sql`
    SELECT s.effective_date::text AS effective_date,
           f.entity_id::text AS entity_id,
           f.value_numeric::text AS value_numeric,
           f.is_null
      FROM fact f
      JOIN snapshot s   ON s.id = f.snapshot_id
      JOIN attribute a  ON a.id = f.attribute_id
     WHERE a.code = ${escolhido.code}
       AND ${filtroDeVigenciaDisponivel("s")}
       AND ${contextFilter("s", context)}
  `);

  // ---- placa e data de entrada ---------------------------------------------
  const { rows: placas } = await db.execute<{ entity_id: string; valor: string }>(sql`
    SELECT ei.entity_id::text AS entity_id, ei.identifier_value AS valor
      FROM entity_identifier ei
      JOIN entity e ON e.id = ei.entity_id
     WHERE ei.identifier_type = 'PLACA'
       AND ei.is_current
       AND e.entity_type = ${entityType}
  `);
  const placaDe = new Map(placas.map((p) => [p.entity_id, p.valor]));

  const groupCode = options.groupBy ?? `${entityType.toLowerCase()}.data`;
  const { rows: agrupador } = await db.execute<{
    entity_id: string;
    value_date: string | null;
    value_numeric: string | null;
    value_text: string | null;
    source_name: string;
  }>(sql`
    SELECT DISTINCT ON (f.entity_id)
           f.entity_id::text AS entity_id,
           f.value_date::text AS value_date,
           f.value_numeric::text AS value_numeric,
           f.value_text,
           a.source_name
      FROM fact f
      JOIN snapshot s  ON s.id = f.snapshot_id
      JOIN attribute a ON a.id = f.attribute_id
     WHERE a.code = ${groupCode}
       AND NOT f.is_null
       AND ${filtroDeVigenciaDisponivel("s")}
       AND ${contextFilter("s", context)}
     ORDER BY f.entity_id, s.effective_date DESC
  `);

  // ---- monta as linhas ------------------------------------------------------
  const vazio = (): QuinzenaCell[] =>
    periodRows.map((p) => ({
      value: null,
      state: p.delivered ? ("FORA_DA_FROTA" as const) : ("NAO_ENTREGUE" as const),
      delta: null,
      movimento: null,
    }));

  const celulas = new Map<string, QuinzenaCell[]>();
  const linhaDe = (entityId: string) => {
    let atual = celulas.get(entityId);
    if (!atual) {
      atual = vazio();
      celulas.set(entityId, atual);
    }
    return atual;
  };

  for (const p of presencas) {
    const i = indiceDoPeriodo.get(p.effective_date);
    if (i === undefined) continue;
    const linha = linhaDe(p.entity_id);
    // Uma vigência que não declarou o equipamento mas trouxe fatos dele é uma
    // contradição do próprio arquivo; o fato manda, porque ele é o dado.
    if (linha[i].state === "FORA_DA_FROTA" || linha[i].state === "NAO_ENTREGUE") {
      linha[i] = { ...linha[i], state: "SEM_VALOR" };
    }
  }

  for (const v of valores) {
    const i = indiceDoPeriodo.get(v.effective_date);
    if (i === undefined) continue;
    const linha = linhaDe(v.entity_id);
    const valor = v.is_null ? null : num(v.value_numeric);
    linha[i] =
      valor === null
        ? { value: null, state: "SEM_VALOR", delta: null, movimento: null }
        : { value: valor, state: "VALOR", delta: null, movimento: null };
  }

  // ---- o movimento de cada célula ------------------------------------------
  /*
    A comparação pula as vigências não entregues: a quinzena que veio sem
    cavalos não é um intervalo em que o cavalo esteve fora, e tratá-la como tal
    produziria um SAIU seguido de um ENTROU para a frota inteira, duas vezes por
    entrega parcial.
  */
  for (const linha of celulas.values()) {
    let anterior: QuinzenaCell | null = null;
    for (let i = 0; i < linha.length; i++) {
      const celula = linha[i];
      if (celula.state === "NAO_ENTREGUE") continue;

      if (celula.state === "VALOR") {
        if (anterior?.state === "VALOR" && anterior.value !== null) {
          const delta = round2(celula.value! - anterior.value);
          linha[i] = {
            ...celula,
            delta,
            movimento: delta > 0 ? "SUBIU" : delta < 0 ? "CAIU" : "IGUAL",
          };
        } else if (anterior?.state === "FORA_DA_FROTA") {
          linha[i] = { ...celula, movimento: "ENTROU" };
        }
      } else if (celula.state === "FORA_DA_FROTA" && anterior?.state === "VALOR") {
        linha[i] = { ...celula, movimento: "SAIU" };
      }

      anterior = linha[i];
    }
  }

  // ---- dobra por data de entrada -------------------------------------------
  const grupoDe = new Map<string, { key: string; label: string; order: string }>();
  for (const g of agrupador) {
    const chave = chaveDeAgrupamento({
      valueDate: g.value_date,
      valueNumeric: g.value_numeric,
      valueText: g.value_text,
    });
    if (chave) grupoDe.set(g.entity_id, chave);
  }
  const SEM_GRUPO = {
    key: "__sem_data__",
    label: "sem data de entrada",
    // Ordena por último: é a caixa do que não pôde ser dobrado, e ela não pode
    // abrir a tabela como se fosse o começo do histórico.
    order: "￿",
  };

  const porGrupo = new Map<string, { rotulo: string; ordem: string; linhas: QuinzenaRow[] }>();
  for (const [entityId, cells] of celulas) {
    const valoresDaLinha = cells.filter((c) => c.state === "VALOR" && c.value !== null);
    const total =
      valoresDaLinha.length === 0
        ? null
        : round2(valoresDaLinha.reduce((soma, c) => soma + (c.value ?? 0), 0));
    const first = valoresDaLinha[0]?.value ?? null;
    const last = valoresDaLinha[valoresDaLinha.length - 1]?.value ?? null;

    const linha: QuinzenaRow = {
      entityId,
      plate: placaDe.get(entityId) ?? null,
      cells,
      total,
      first,
      last,
      delta: first !== null && last !== null ? round2(last - first) : null,
      periods: cells.filter((c) => c.state === "VALOR" || c.state === "SEM_VALOR").length,
    };

    const grupo = grupoDe.get(entityId) ?? SEM_GRUPO;
    let balde = porGrupo.get(grupo.key);
    if (!balde) {
      balde = { rotulo: grupo.label, ordem: grupo.order, linhas: [] };
      porGrupo.set(grupo.key, balde);
    }
    balde.linhas.push(linha);
  }

  const somaPorPeriodo = (linhas: QuinzenaRow[]): (number | null)[] =>
    periodRows.map((_, i) => {
      const comValor = linhas.filter((l) => l.cells[i].state === "VALOR");
      if (comValor.length === 0) return null;
      return round2(comValor.reduce((soma, l) => soma + (l.cells[i].value ?? 0), 0));
    });

  const somaTotal = (totais: (number | null)[]): number | null => {
    const presentes = totais.filter((t): t is number => t !== null);
    return presentes.length === 0 ? null : round2(presentes.reduce((a, b) => a + b, 0));
  };

  const groups: QuinzenaGroup[] = [...porGrupo.entries()]
    .sort((a, b) => a[1].ordem.localeCompare(b[1].ordem))
    .map(([key, balde]) => {
      const rows = balde.linhas.sort((a, b) =>
        (a.plate ?? "").localeCompare(b.plate ?? "", "pt-BR", { numeric: true }),
      );
      const totals = somaPorPeriodo(rows);
      return { key, label: balde.rotulo, rows, totals, total: somaTotal(totals) };
    });

  const todasAsLinhas = groups.flatMap((g) => g.rows);
  const totals = somaPorPeriodo(todasAsLinhas);

  const periods: QuinzenaPeriod[] = periodRows.map((p, i) => ({
    effectiveDate: p.effective_date,
    sourceLabel: p.source_label,
    delivered: p.delivered,
    entities: todasAsLinhas.filter((l) => l.cells[i].state !== "FORA_DA_FROTA" && l.cells[i].state !== "NAO_ENTREGUE").length,
    withValue: todasAsLinhas.filter((l) => l.cells[i].state === "VALOR").length,
    total: totals[i],
  }));

  return comValor({
    context,
    entityType,
    equipment: equipmentLabel(entityType),
    entityTypes,
    attribute: escolhido,
    parameters,
    groupedBy:
      agrupador.length > 0
        ? { code: groupCode, title: attributeLabel(groupCode, agrupador[0].source_name) }
        : null,
    periods,
    groups,
    totals,
    grandTotal: somaTotal(totals),
    entities: todasAsLinhas.length,
    pontaAPonta: decomporPontaAPonta(periods, todasAsLinhas),
  });
}

/**
 * A variação entre a primeira e a última vigência entregues, decomposta.
 *
 * O total de uma coluna contra o da outra responde "a frota ficou mais cara?" —
 * e responde errado sempre que entrou ou saiu ativo. Aqui a diferença vira três
 * parcelas que somam exatamente a ela, e só a primeira é preço.
 */
export function decomporPontaAPonta(
  periods: QuinzenaPeriod[],
  rows: QuinzenaRow[],
): PontaAPonta | null {
  const entregues = periods
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.delivered);
  if (entregues.length < 2) return null;

  const inicio = entregues[0];
  const fim = entregues[entregues.length - 1];

  let comparados = 0;
  let deltaComparados = 0;
  let entraram = 0;
  let valorQueEntrou = 0;
  let entraramForaDaFrota = 0;
  let sairam = 0;
  let valorQueSaiu = 0;
  let sairamForaDaFrota = 0;

  for (const linha of rows) {
    const a = linha.cells[inicio.i];
    const b = linha.cells[fim.i];
    const temA = a.state === "VALOR" && a.value !== null;
    const temB = b.state === "VALOR" && b.value !== null;

    if (temA && temB) {
      comparados++;
      deltaComparados += b.value! - a.value!;
    } else if (temB) {
      entraram++;
      valorQueEntrou += b.value!;
      if (a.state === "FORA_DA_FROTA") entraramForaDaFrota++;
    } else if (temA) {
      sairam++;
      valorQueSaiu += a.value!;
      if (b.state === "FORA_DA_FROTA") sairamForaDaFrota++;
    }
  }

  const totalFrom = periods[inicio.i].total ?? 0;
  const totalTo = periods[fim.i].total ?? 0;

  return {
    from: periods[inicio.i].effectiveDate,
    fromLabel: periods[inicio.i].sourceLabel,
    to: periods[fim.i].effectiveDate,
    toLabel: periods[fim.i].sourceLabel,
    comparados: { entities: comparados, delta: round2(deltaComparados) },
    entraram: {
      entities: entraram,
      amount: round2(valorQueEntrou),
      foraDaFrota: entraramForaDaFrota,
    },
    sairam: {
      entities: sairam,
      amount: round2(valorQueSaiu),
      foraDaFrota: sairamForaDaFrota,
    },
    totalFrom,
    totalTo,
    delta: round2(totalTo - totalFrom),
  };
}
