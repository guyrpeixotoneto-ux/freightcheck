/**
 * O motor de composição: **por que este equipamento recebe este valor nesta
 * vigência?**
 *
 * A resposta é montada de baixo para cima, do fato até o total, e cada degrau
 * fica visível. O que o motor produz não é um número com uma explicação
 * pendurada depois — é a explicação, da qual o número é a última linha.
 *
 * **A regra de segurança, escrita uma vez e aplicada em todo componente.** Um
 * valor só entra num total quando (a) a semântica está CONFIRMADA *na data
 * daquela vigência*, (b) é monetário, (c) é somável, (d) tem periodicidade
 * declarada, (e) o fato é numérico e não nulo, (f) não é parcela de um total
 * que já entrou, e (g) não remunera outro equipamento. Falhando qualquer uma,
 * o componente **não some**: vai para a lista dos não apurados com o motivo
 * nomeado. Exibir "não calculável com segurança" é o resultado certo; exibir um
 * número que não se sustenta é o único resultado inaceitável.
 */

import { sql } from "drizzle-orm";
import { baseQueFalta, podeSomar } from "@workspace/curation";
import type { Database } from "@workspace/db";
import {
  attributeLabel,
  contextFilter,
  loadAttributeClassificationsAt,
  periodLabel,
  placementOf,
  resolveContext,
  type AttributeClassification,
  type ContextInfo,
  type SeriesContext,
} from "@workspace/comparison";
import {
  composicaoDoTotal,
  gavetaDe,
  regraDe,
  resolverRaizes,
  ROTULO_DO_MOTIVO,
  type Gaveta,
  type MotivoDeExclusao,
} from "./regras";
import { avaliarStatus, type StatusDoEquipamento } from "./status";
import { rastrearEquipamento, type RastreioDoEquipamento } from "./rastreio";
import { DUAS_CASAS } from "@workspace/knowledge/formato";

/** Diferença até a qual um total e as suas parcelas são considerados iguais. */
export const TOLERANCIA_CENTAVO = 0.01;

// ---------------------------------------------------------------------------
// Formato de saída
// ---------------------------------------------------------------------------

/** De onde o número veio, até a célula da planilha. */
export interface Origem {
  sourceLabel: string;
  sheetName: string | null;
  rowIndex: number | null;
  columnLetter: string | null;
  columnHeader: string | null;
  rawValue: string | null;
}

/** Uma parcela de um total, dentro da explicação da linha. */
export interface Parcela {
  code: string;
  titulo: string;
  valor: number | null;
  /** Por que a parcela não tem número, quando não tem. */
  ausencia: string | null;
}

/** A resposta a "como chegamos neste valor?". */
export interface Explicacao {
  /** A regra aplicada, em português. */
  regra: string;
  /** A aritmética, quando o valor é um total de parcelas. */
  formula: string | null;
  parcelas: Parcela[];
  /**
   * Quanto o total difere da soma das suas parcelas.
   *
   * Nulo quando não há parcelas a conferir; zero quando fecha. Diferente de
   * zero é uma inconsistência da fonte, e a tela precisa dizê-la — o número
   * exibido continua sendo o da fonte, porque é ele que a Ambev paga.
   */
  divergencia: number | null;
}

export interface LinhaCalculavel {
  code: string;
  titulo: string;
  sourceName: string;
  gaveta: Gaveta;
  valor: number;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  semanticsStatus: string;
  semanticsVersion: number | null;
  calculationBasis: string | null;
  costClass: string | null;
  taxonomyName: string | null;
  taxonomyPath: string | null;
  familia: string;
  parametro: string;
  explicacao: Explicacao;
  origem: Origem | null;
}

export interface ComponenteNaoApurado {
  code: string;
  titulo: string;
  sourceName: string;
  /** O valor como a tela deve mostrá-lo, já com unidade decidida pelo tipo. */
  valorExibido: string | null;
  valorNumerico: number | null;
  dataType: string;
  unit: string | null;
  periodicity: string | null;
  semanticsStatus: string;
  taxonomyName: string | null;
  familia: string;
  parametro: string;
  motivo: MotivoDeExclusao;
  motivoRotulo: string;
  /** A frase que explica a exclusão deste componente, e não do motivo em geral. */
  explicacao: string;
  /** O que destravaria o cálculo, quando há algo que destrave. */
  baseQueFalta: string | null;
  /** Quando é parcela: o total que já a contém. */
  contidoEm: string | null;
  /**
   * Se o componente **parece** dinheiro do equipamento e mesmo assim ficou de
   * fora. É o que alimenta a contagem "X componentes ainda sem regra
   * financeira" — um booleano ou uma data nunca deveriam contar ali.
   */
  monetarioPotencial: boolean;
  /**
   * Se este é um **número que ninguém classificou**.
   *
   * A diferença para `monetarioPotencial` é a direção da dúvida, e ela custou
   * uma tela mentindo. `monetarioPotencial` pergunta "isto é dinheiro?" e só
   * responde sim quando a curadoria já disse que é — de modo que uma coluna
   * nunca olhada responde **não**, some da contagem, e a frota inteira aparece
   * com "0 componentes sem regra financeira" ao lado de dezenas de colunas
   * numéricas que ninguém leu. Medido no export real: 62 de 62 cavalos
   * "apurados", zero pendências, e `lucroVariavelPrevistoCavalo` — R$ 216.173,31
   * por mês na frota — fora da conta sem aparecer em lugar nenhum.
   *
   * Este campo pergunta o contrário: **alguém já descartou que seja dinheiro?**
   * Enquanto a resposta for não, o número conta como pendência. Classificar uma
   * coluna como não-monetária é trabalho de curadoria e faz o número cair; o
   * silêncio, não.
   */
  semClassificacao: boolean;
}

export interface TotalDaGaveta {
  gaveta: Gaveta;
  valor: number;
  componentes: number;
}

/** Uma inconsistência estrutural encontrada durante a montagem. */
export interface AlertaDeIntegridade {
  code: string;
  titulo: string;
  tipo: "TOTAL_NAO_FECHA" | "SEMANTICA_MUDOU";
  mensagem: string;
}

export interface Variacao {
  absoluta: number;
  /** Nulo quando a base anterior é zero — dividir por zero não é "infinito%". */
  percentual: number | null;
}

export interface CabecalhoDoEquipamento {
  entityId: string;
  entityType: string;
  rotuloDoTipo: string;
  placa: string | null;
  chassi: string | null;
  unidade: string | null;
  operacao: string | null;
  contextLabel: string;
  scopeHash: string;
  channel: string | null;
}

export interface ComposicaoDoEquipamento extends CabecalhoDoEquipamento {
  effectiveDate: string;
  periodLabel: string;
  sourceLabels: string[];
  /** Se o ativo tem fatos nesta vigência. Falso é resposta, não erro. */
  presente: boolean;
  totais: TotalDaGaveta[];
  linhas: LinhaCalculavel[];
  naoApurados: ComponenteNaoApurado[];
  integridade: AlertaDeIntegridade[];
  /** A vigência imediatamente anterior deste contexto, quando existe. */
  anterior: {
    effectiveDate: string;
    periodLabel: string;
    presente: boolean;
    mensal: number | null;
  } | null;
  variacaoMensal: Variacao | null;
  completude: {
    /** Componentes que entraram em algum total. */
    calculaveis: number;
    /** Componentes monetários que ficaram de fora por falta de regra. */
    semRegraFinanceira: number;
    /**
     * Números que a curadoria ainda não classificou — ver
     * {@link ComponenteNaoApurado.semClassificacao}.
     */
    semClassificacao: number;
    /**
     * Verdadeiro quando há dinheiro na tela que o produto não soube apurar
     * **ou** número que ninguém classificou. Enquanto for verdadeiro, nenhuma
     * tela pode afirmar que a apuração deste equipamento está completa.
     */
    parcial: boolean;
  };
  /**
   * A conta de conservação desta placa nesta vigência: do arquivo até esta
   * tela. Ver `rastreio.ts` — é o que permite a ficha afirmar que nenhum valor
   * importado ficou de fora, em vez de deixar quem lê supor que ficou tudo.
   */
  rastreio: RastreioDoEquipamento;
  status: StatusDoEquipamento;
}

// ---------------------------------------------------------------------------
// Leitura do banco
// ---------------------------------------------------------------------------

interface FatoDoAtivo extends Record<string, unknown> {
  attribute_id: string;
  code: string;
  source_name: string;
  display_name: string | null;
  data_type: string;
  value_numeric: string | null;
  value_text: string | null;
  value_boolean: boolean | null;
  value_date: string | null;
  is_null: boolean;
  null_reason: string | null;
  source_label: string;
  sheet_name: string | null;
  row_index: number | null;
  column_letter: string | null;
  column_header: string | null;
  raw_value: string | null;
}

/**
 * Todos os fatos de um ativo numa data, com a célula de origem junto.
 *
 * A proveniência vem no mesmo `SELECT` de propósito. A alternativa — buscá-la
 * só quando alguém expande a linha — economizaria colunas e criaria um estado
 * em que o número está na tela e a sua origem ainda não chegou; numa tela de
 * auditoria, os dois nascem juntos ou nenhum dos dois vale.
 */
async function lerFatos(
  db: Database,
  entityId: string,
  effectiveDate: string,
  context: SeriesContext,
): Promise<FatoDoAtivo[]> {
  const { rows } = await db.execute<FatoDoAtivo>(sql`
    SELECT a.id::text        AS attribute_id,
           a.code,
           a.source_name,
           a.display_name,
           a.data_type,
           f.value_numeric::text AS value_numeric,
           f.value_text,
           f.value_boolean,
           f.value_date::text    AS value_date,
           f.is_null,
           f.null_reason,
           s.source_label,
           sh.sheet_name,
           r.row_index,
           c.column_letter,
           c.column_header,
           c.raw_value
      FROM fato_visivel f
      JOIN attribute a  ON a.id = f.attribute_id
      JOIN snapshot s   ON s.id = f.snapshot_id
      LEFT JOIN raw_cell c  ON c.id = f.raw_cell_id
      LEFT JOIN raw_row r   ON r.id = c.raw_row_id
      LEFT JOIN raw_sheet sh ON sh.id = r.raw_sheet_id
     WHERE f.entity_id = ${entityId}::uuid
       AND s.effective_date = ${effectiveDate}::date
       AND s.status <> 'SUPERSEDED'
       AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
       AND ${contextFilter("s", context)}
     ORDER BY a.code
  `);
  return rows;
}

/** As vigências deste contexto, da mais antiga para a mais nova. */
export async function listarVigencias(
  db: Database,
  context: SeriesContext,
): Promise<{ effectiveDate: string; periodLabel: string; sourceLabels: string[] }[]> {
  const { rows } = await db.execute<{ effective_date: string; labels: string[] }>(sql`
    SELECT s.effective_date::text AS effective_date,
           array_agg(DISTINCT s.source_label ORDER BY s.source_label) AS labels
      FROM snapshot s
     WHERE s.status <> 'SUPERSEDED'
     AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
       AND ${contextFilter("s", context)}
     GROUP BY 1
     ORDER BY 1
  `);
  return rows.map((r) => ({
    effectiveDate: r.effective_date,
    periodLabel: periodLabel(r.effective_date),
    sourceLabels: r.labels,
  }));
}

interface IdentidadeDoAtivo extends Record<string, unknown> {
  entity_id: string;
  entity_type: string;
  placa: string | null;
  chassi: string | null;
}

/** A identidade de leitura de um ativo: como ele se chama nas telas. */
export interface Identidade {
  entityId: string;
  entityType: string;
  placa: string | null;
  chassi: string | null;
}

/**
 * As identidades correntes de um ou mais tipos de equipamento, numa consulta.
 *
 * Uma consulta e não uma por tipo: a visão de conjuntos precisa dos dois lados
 * ao mesmo tempo, e duas idas ao banco para montar o mesmo mapa seriam duas
 * chances de ler o cavalo de um estado e a carreta de outro.
 */
export async function lerIdentidades(
  db: Database,
  entityTypes: string[],
): Promise<Map<string, Identidade>> {
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
     WHERE e.entity_type IN (${sql.join(
       entityTypes.map((tipo) => sql`${tipo}`),
       sql`, `,
     )})
     GROUP BY 1, 2
  `);
  return new Map(
    rows.map((r) => [
      r.entity_id,
      {
        entityId: r.entity_id,
        entityType: r.entity_type,
        placa: r.placa,
        chassi: r.chassi,
      },
    ]),
  );
}

async function lerIdentidade(
  db: Database,
  entityId: string,
): Promise<IdentidadeDoAtivo | null> {
  const { rows } = await db.execute<IdentidadeDoAtivo>(sql`
    SELECT e.id::text AS entity_id,
           e.entity_type,
           max(ei.identifier_value) FILTER (WHERE ei.identifier_type = 'PLACA')  AS placa,
           max(ei.identifier_value) FILTER (WHERE ei.identifier_type = 'CHASSI') AS chassi
      FROM entity e
      LEFT JOIN entity_identifier ei ON ei.entity_id = e.id AND ei.is_current
     WHERE e.id = ${entityId}::uuid
     GROUP BY 1, 2
  `);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Classificação de um fato
// ---------------------------------------------------------------------------

function numeroDe(fato: FatoDoAtivo): number | null {
  if (fato.is_null || fato.value_numeric === null) return null;
  const valor = Number(fato.value_numeric);
  return Number.isFinite(valor) ? valor : null;
}

/** O valor como texto legível, seja ele qual for — inclusive a ausência. */
function exibicaoDe(fato: FatoDoAtivo): string | null {
  if (fato.is_null) return null;
  if (fato.value_text !== null) return fato.value_text;
  if (fato.value_numeric !== null) return fato.value_numeric;
  if (fato.value_boolean !== null) return fato.value_boolean ? "Sim" : "Não";
  if (fato.value_date !== null) return fato.value_date;
  return null;
}

/** Tipos que nenhuma curadoria pode transformar em montante financeiro. */
const TIPOS_NUNCA_MONETARIOS = new Set(["TEXT", "BOOLEAN", "DATE"]);

/**
 * O portão da semântica, aplicado a um fato.
 *
 * Devolve `null` quando o componente passa — e o motivo quando não passa. **A
 * ordem das perguntas é a ordem em que elas explicam melhor**, e ela custou
 * duas reescritas:
 *
 * 1. **O tipo vem antes de tudo.** Um chassi, um booleano e uma data não são
 *    dinheiro por serem o que são, e não por faltar curadoria. Perguntar pela
 *    semântica primeiro fazia a placa da carreta aparecer na tela como
 *    "semântica não confirmada" — uma frase que manda o curador confirmar o
 *    significado de um campo de texto, trabalho que não existe.
 * 2. **Depois, o significado.** Nada abaixo de CONFIRMADA entra em conta.
 * 3. **Depois, a base.** Uma razão em R$/km é recusada dizendo *o que falta*
 *    (a quilometragem), e não "não é montante financeiro" — que é verdade e é
 *    inútil, porque esconde que existe uma pergunta a fazer à Ambev.
 * 4. **Por último, o valor.** Perguntar pelo valor antes diria "sem valor nesta
 *    vigência" a respeito de uma coluna cujo significado ninguém confirmou.
 */
function motivoDeExclusao(
  fato: FatoDoAtivo,
  classificacao: AttributeClassification | undefined,
): MotivoDeExclusao | null {
  if (TIPOS_NUNCA_MONETARIOS.has(fato.data_type)) return "NAO_MONETARIO";

  const semantica = classificacao?.semanticsStatus ?? "UNKNOWN";
  if (semantica !== "CONFIRMED") return "SEMANTICA_NAO_CONFIRMADA";

  // A mesma `podeSomar` que o cockpit e o impacto consultam. A ordem das
  // perguntas continua sendo a deste módulo; o que saiu daqui foi a definição.
  const somavel = podeSomar(classificacao!).ok;
  if (!somavel && baseQueFalta(classificacao!) !== null) {
    return "BASE_AUSENTE";
  }

  if (classificacao!.isMonetary !== true) return "NAO_MONETARIO";
  if (!somavel) return "NAO_SOMAVEL";
  if (gavetaDe(classificacao!.periodicity) === null) return "SEM_PERIODICIDADE";
  if (fato.is_null) return "VALOR_AUSENTE";
  if (numeroDe(fato) === null) return "VALOR_NAO_NUMERICO";
  return null;
}

/**
 * As unidades em que uma lacuna ainda é uma lacuna *de dinheiro*.
 *
 * `BRL_KM` entra: uma manutenção de R$ 0,38/km é remuneração que o produto não
 * conseguiu precificar, e contá-la é o que mantém honesta a frase "X componentes
 * sem regra financeira". `PERCENT` fica de fora — uma alíquota de ICMS não é um
 * componente que falte apurar, é a taxa de um componente que já existe
 * (`valorIcms`), e contá-la duplicaria a mesma lacuna.
 */
const UNIDADES_DE_DINHEIRO = new Set(["BRL", "BRL_KM"]);

/**
 * Se um componente que ficou de fora ainda assim **parece dinheiro do
 * equipamento**.
 *
 * É o que separa "faltam três regras financeiras" de "faltam trinta": um
 * booleano, uma data, um chassi e uma alíquota nunca foram candidatos a entrar
 * num total, e contá-los como pendência transformaria a medida de completude
 * num número que nunca melhora, por mais curadoria que se faça.
 *
 * Conta quem tem cara de montante — unidade BRL declarada, ou nome de coluna
 * que a curadoria já classificou como monetária — e ficou de fora por um motivo
 * que a curadoria pode resolver. Escopo de conjunto e parcela de total **não**
 * contam: os dois são o produto acertando, não uma lacuna.
 */
function ehMonetarioPotencial(
  classificacao: AttributeClassification | undefined,
  motivo: MotivoDeExclusao,
): boolean {
  if (motivo === "PARCELA_DE_TOTAL" || motivo === "ESCOPO_DE_CONJUNTO") return false;
  // Uma alíquota e um texto não são lacuna: o produto sabe o que eles são.
  if (motivo === "NAO_MONETARIO" || motivo === "NAO_SOMAVEL") return false;
  return (
    classificacao?.isMonetary === true ||
    UNIDADES_DE_DINHEIRO.has(classificacao?.unit ?? "")
  );
}

/**
 * Se um componente que ficou de fora é um número sobre o qual a curadoria ainda
 * não se pronunciou.
 *
 * Só conta o que tem número nesta vigência: uma coluna sem valor não é dinheiro
 * que o produto deixou de apurar, e contá-la faria a pendência crescer com
 * células vazias. Os motivos que já são uma decisão da curadoria — não
 * monetário, não somável — ficam de fora por definição: neles alguém já
 * respondeu.
 */
function ehSemClassificacao(fato: FatoDoAtivo, motivo: MotivoDeExclusao): boolean {
  return motivo === "SEMANTICA_NAO_CONFIRMADA" && numeroDe(fato) !== null;
}

function explicar(
  motivo: MotivoDeExclusao,
  fato: FatoDoAtivo,
  classificacao: AttributeClassification | undefined,
  contexto: { contidoEm: string | null; evidenciaDeEscopo: string | null },
): string {
  const nome = attributeLabel(fato.code, fato.source_name, fato.display_name);
  switch (motivo) {
    case "SEMANTICA_NAO_CONFIRMADA": {
      const estado = classificacao?.semanticsStatus === "PRESUMED" ? "presumida" : "desconhecida";
      /*
        Curto de propósito. Esta frase se repete uma vez por linha numa tabela
        que costuma ter oito, e o nome do parâmetro já está na coluna ao lado:
        repeti-lo dentro do texto transformava a coluna "explicação" num
        parágrafo idêntico oito vezes, que o olho aprende a pular.
      */
      return `Semântica ${estado}: até a curadoria confirmar o que a coluna mede, somá-la seria adivinhar.`;
    }
    case "NAO_MONETARIO":
      return (
        `${nome} não é um montante financeiro (${classificacao?.unit ?? fato.data_type.toLowerCase()}). ` +
        `Descreve o equipamento; não é parte do que ele recebe.`
      );
    case "NAO_SOMAVEL": {
      const base = classificacao ? (baseQueFalta(classificacao) ?? undefined) : undefined;
      return base
        ? `${nome} é uma razão em ${classificacao?.unit}. Vira dinheiro quando houver ${base}, ` +
            `que este export não traz. Multiplicar por uma quantidade estimada seria inventar o número.`
        : `${nome} tem agregação ${classificacao?.aggregation ?? "indefinida"} — não se acumula ` +
            `num total por ativo.`;
    }
    case "SEM_PERIODICIDADE":
      return (
        `${nome} é monetário e somável, mas ninguém confirmou se o valor é mensal ou anual. ` +
        `Sem isso não há em que total colocá-lo.`
      );
    case "PERIODICIDADE_NAO_MENSAL":
      return `${nome} é ${(classificacao?.periodicity ?? "").toLowerCase()} e vive na sua própria gaveta.`;
    case "PARCELA_DE_TOTAL":
      return (
        `${nome} é parcela de ${attributeLabel(contexto.contidoEm, contexto.contidoEm ?? "")}, ` +
        `que já entrou no total. Somar as duas contaria o mesmo dinheiro duas vezes — ` +
        `o valor aparece dentro da explicação do total.`
      );
    case "ESCOPO_DE_CONJUNTO":
      return contexto.evidenciaDeEscopo ?? `${nome} remunera o conjunto, não este equipamento.`;
    case "BASE_AUSENTE": {
      const base = classificacao ? (baseQueFalta(classificacao) ?? undefined) : undefined;
      return (
        `${nome} é uma razão em ${classificacao?.unit}, e não um montante. Vira dinheiro ` +
        `quando houver ${base ?? "a base a que ela se aplica"} — que este export não traz. ` +
        `Multiplicar por uma quantidade estimada seria inventar o número.`
      );
    }
    case "VALOR_AUSENTE":
      return (
        `${nome} não tem valor nesta vigência (${fato.null_reason ?? "sem motivo registrado"}). ` +
        `Ausência não é zero, e por isso não entra na conta como zero.`
      );
    case "VALOR_NAO_NUMERICO":
      return `${nome} veio como ${fato.data_type.toLowerCase()} nesta vigência, e não como número.`;
  }
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

export interface OpcoesDeComposicao {
  /** A vigência. Sem ela, a mais recente do contexto. */
  period?: string;
  context?: Partial<SeriesContext>;
  /**
   * Se calcula a vigência anterior para produzir variação e status.
   * A listagem de frota faz isso uma vez para todos os ativos, e desliga aqui.
   */
  comAnterior?: boolean;
}

/**
 * O total mensal de um ativo, e nada mais — o insumo da variação e da listagem.
 *
 * É a mesma decisão de {@link montarComposicao}, aplicada em lote: quem
 * calculasse o mês anterior por outro caminho estaria comparando duas contas
 * diferentes e chamando a diferença de variação.
 */
export interface ResumoMensal {
  entityId: string;
  mensal: number | null;
  componentes: number;
  semRegraFinanceira: number;
}

interface MaterialDaVigencia {
  classificacoes: Map<string, AttributeClassification>;
  fatosPorAtivo: Map<string, FatoDoAtivo[]>;
}

/**
 * Carrega, de uma vez, tudo o que uma vigência inteira precisa.
 *
 * Uma consulta por ativo daria 62 idas ao banco para desenhar uma tela de
 * frota, e 124 para desenhá-la com a variação. Aqui são duas.
 */
async function lerVigencia(
  db: Database,
  entityType: string,
  effectiveDate: string,
  context: SeriesContext,
): Promise<MaterialDaVigencia> {
  const classificacoes = await loadAttributeClassificationsAt(db, effectiveDate);

  const { rows } = await db.execute<FatoDoAtivo & { entity_id: string }>(sql`
    SELECT f.entity_id::text AS entity_id,
           a.id::text        AS attribute_id,
           a.code,
           a.source_name,
           a.display_name,
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
      JOIN entity e    ON e.id = f.entity_id
     WHERE e.entity_type = ${entityType}
       AND s.effective_date = ${effectiveDate}::date
       AND s.status <> 'SUPERSEDED'
       AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
       AND ${contextFilter("s", context)}
  `);

  const fatosPorAtivo = new Map<string, FatoDoAtivo[]>();
  for (const row of rows) {
    const lista = fatosPorAtivo.get(row.entity_id) ?? [];
    lista.push(row);
    fatosPorAtivo.set(row.entity_id, lista);
  }
  return { classificacoes, fatosPorAtivo };
}

/**
 * Um componente que passou no portão da semântica, **antes** de qualquer
 * decisão de escopo ou de árvore.
 *
 * Existe para a DRE. A Composição responde "o que este equipamento recebe", e
 * para isso `carreta.custo_fixo` tem de sair — ele remunera o conjunto. A DRE do
 * conjunto pergunta outra coisa, e precisa exatamente daquele valor. Sem esta
 * lista ela teria de reimplementar o portão para alcançá-lo, e o produto
 * passaria a ter duas respostas para "este número é confiável?".
 */
export interface ValorAprovado {
  code: string;
  titulo: string;
  valor: number;
  classificacao: AttributeClassification;
  fato: FatoDoAtivo;
  /** Por que ele não entra no total *deste* equipamento, quando não entra. */
  excluidoPor: MotivoDeExclusao | null;
}

/**
 * O núcleo: dos fatos de um ativo à composição dele.
 *
 * Separado da leitura do banco de propósito — é uma função pura, e é ela que os
 * testes sintéticos exercitam sem precisar de um export inteiro.
 */
export function comporDeFatos(
  entityType: string,
  fatos: FatoDoAtivo[],
  classificacoes: Map<string, AttributeClassification>,
): {
  linhas: LinhaCalculavel[];
  naoApurados: ComponenteNaoApurado[];
  totais: TotalDaGaveta[];
  integridade: AlertaDeIntegridade[];
  /** Tudo o que passou no portão, com ou sem lugar no total deste equipamento. */
  aprovados: Map<string, ValorAprovado>;
} {
  const regra = regraDe(entityType);
  const foraDoEscopo = new Map(regra.foraDoEscopo.map((f) => [f.code, f]));
  const fatoPorCodigo = new Map(fatos.map((f) => [f.code, f]));

  /* Passo 1 — quem passa no portão, antes de qualquer decisão de árvore. */
  const elegiveis: string[] = [];
  const motivos = new Map<string, MotivoDeExclusao>();
  const aprovados = new Map<string, ValorAprovado>();

  for (const fato of fatos) {
    const classificacao = classificacoes.get(fato.attribute_id);
    /*
      O portão vem antes do escopo. A ordem importa por uma razão só, e ela é
      de honestidade: um atributo de conjunto cuja semântica ninguém confirmou
      era anunciado como "remunera o conjunto", frase que dá ao curador a
      impressão de que não há nada a fazer. O motivo verdadeiro é o outro. Nos
      dados reais os dois atributos de conjunto são CONFIRMED, então nada muda
      de comportamento — muda o que o produto diz no dia em que deixarem de ser.
    */
    const motivo = motivoDeExclusao(fato, classificacao);
    if (motivo !== null) {
      motivos.set(fato.code, motivo);
      continue;
    }

    const escopoDeConjunto = foraDoEscopo.has(fato.code);
    if (escopoDeConjunto) motivos.set(fato.code, "ESCOPO_DE_CONJUNTO");
    else elegiveis.push(fato.code);

    aprovados.set(fato.code, {
      code: fato.code,
      titulo: attributeLabel(fato.code, fato.source_name, fato.display_name),
      valor: numeroDe(fato)!,
      classificacao: classificacao!,
      fato,
      excluidoPor: escopoDeConjunto ? "ESCOPO_DE_CONJUNTO" : null,
    });
  }

  /* Passo 2 — a árvore. Parcela de total que entrou não entra sozinha. */
  const { raizes, absorvidas } = resolverRaizes(elegiveis);
  for (const [parte, total] of absorvidas) {
    motivos.set(parte, "PARCELA_DE_TOTAL");
    const aprovado = aprovados.get(parte);
    if (aprovado) aprovados.set(parte, { ...aprovado, excluidoPor: "PARCELA_DE_TOTAL" });
    void total;
  }

  /* Passo 3 — as linhas calculáveis, cada uma com a sua conta. */
  const linhas: LinhaCalculavel[] = [];
  const integridade: AlertaDeIntegridade[] = [];

  for (const code of raizes) {
    const fato = fatoPorCodigo.get(code)!;
    const classificacao = classificacoes.get(fato.attribute_id)!;
    const gaveta = gavetaDe(classificacao.periodicity)!;
    const valor = numeroDe(fato)!;
    const titulo = attributeLabel(code, fato.source_name, fato.display_name);
    const colocacao = placementOf(code);

    const composicao = composicaoDoTotal(code);
    const parcelas: Parcela[] = [];
    let formula: string | null = null;
    let divergencia: number | null = null;

    if (composicao) {
      let soma = 0;
      let temAlguma = false;
      for (const parteCode of composicao.parts) {
        const parteFato = fatoPorCodigo.get(parteCode);
        const parteValor = parteFato ? numeroDe(parteFato) : null;
        if (parteValor !== null) {
          soma += parteValor;
          temAlguma = true;
        }
        parcelas.push({
          code: parteCode,
          titulo: attributeLabel(
            parteCode,
            parteFato?.source_name ?? parteCode,
            parteFato?.display_name,
          ),
          valor: parteValor,
          ausencia:
            parteValor !== null
              ? null
              : parteFato === undefined
                ? "a fonte não entrega esta coluna para este ativo"
                : (parteFato.null_reason ?? "sem valor numérico nesta vigência"),
        });
      }
      if (temAlguma) {
        formula = parcelas
          .filter((p) => p.valor !== null)
          .map((p) => formatarNumero(p.valor!))
          .join(" + ");
        divergencia = Number((valor - soma).toFixed(2));
        if (Math.abs(divergencia) > TOLERANCIA_CENTAVO) {
          integridade.push({
            code,
            titulo,
            tipo: "TOTAL_NAO_FECHA",
            mensagem:
              `${titulo} vale ${formatarNumero(valor)} e as suas parcelas somam ` +
              `${formatarNumero(soma)} — diferença de ${formatarNumero(Math.abs(divergencia))}. ` +
              `O valor exibido continua sendo o da fonte, que é o que a Ambev paga; a ` +
              `divergência fica registrada porque ela é a informação de auditoria.`,
          });
        }
      }
    }

    linhas.push({
      code,
      titulo,
      sourceName: fato.source_name,
      gaveta,
      valor,
      unit: classificacao.unit,
      periodicity: classificacao.periodicity,
      aggregation: classificacao.aggregation,
      semanticsStatus: classificacao.semanticsStatus,
      semanticsVersion: classificacao.semanticsVersion ?? null,
      calculationBasis: classificacao.calculationBasis ?? null,
      costClass: classificacao.costClass,
      taxonomyName: classificacao.taxonomyName,
      taxonomyPath: classificacao.taxonomyPath,
      familia: colocacao.familyName,
      parametro: colocacao.parameter,
      explicacao: {
        regra: composicao
          ? `Total declarado: ${titulo} é a soma de ${composicao.parts.length} parcelas da ` +
            `própria fonte, confirmada em ${classificacao.unit}, ${(classificacao.periodicity ?? "").toLowerCase()}, ` +
            `somável. ${semMarcacao(composicao.evidence)}`
          : `Valor ${(classificacao.periodicity ?? "").toLowerCase()} por ativo, em ` +
            `${classificacao.unit}, com semântica confirmada e agregação somável. ` +
            `Entra no total como veio da fonte, sem conversão.`,
        formula,
        parcelas,
        divergencia,
      },
      origem: {
        sourceLabel: fato.source_label,
        sheetName: fato.sheet_name,
        rowIndex: fato.row_index,
        columnLetter: fato.column_letter,
        columnHeader: fato.column_header,
        rawValue: fato.raw_value,
      },
    });
  }

  linhas.sort((a, b) => b.valor - a.valor || a.titulo.localeCompare(b.titulo, "pt-BR"));

  /* Passo 4 — os que ficaram de fora, cada um com o seu motivo. */
  const naoApurados: ComponenteNaoApurado[] = [];
  for (const fato of fatos) {
    const motivo = motivos.get(fato.code);
    if (motivo === undefined) continue;
    const classificacao = classificacoes.get(fato.attribute_id);
    const colocacao = placementOf(fato.code);
    const contidoEm = absorvidas.get(fato.code) ?? null;
    const escopo = foraDoEscopo.get(fato.code);

    naoApurados.push({
      code: fato.code,
      titulo: attributeLabel(fato.code, fato.source_name, fato.display_name),
      sourceName: fato.source_name,
      valorExibido: exibicaoDe(fato),
      valorNumerico: numeroDe(fato),
      dataType: fato.data_type,
      unit: classificacao?.unit ?? null,
      periodicity: classificacao?.periodicity ?? null,
      semanticsStatus: classificacao?.semanticsStatus ?? "UNKNOWN",
      taxonomyName: classificacao?.taxonomyName ?? null,
      familia: colocacao.familyName,
      parametro: colocacao.parameter,
      motivo,
      motivoRotulo: ROTULO_DO_MOTIVO[motivo],
      explicacao: explicar(motivo, fato, classificacao, {
        contidoEm,
        evidenciaDeEscopo: escopo?.evidencia ?? null,
      }),
      baseQueFalta: classificacao ? baseQueFalta(classificacao) : null,
      contidoEm,
      monetarioPotencial: ehMonetarioPotencial(classificacao, motivo),
      semClassificacao: ehSemClassificacao(fato, motivo),
    });
  }

  naoApurados.sort(
    (a, b) =>
      Number(b.monetarioPotencial) - Number(a.monetarioPotencial) ||
      a.motivo.localeCompare(b.motivo) ||
      a.titulo.localeCompare(b.titulo, "pt-BR"),
  );

  /* Passo 5 — os totais, um por gaveta e jamais um só. */
  const porGaveta = new Map<Gaveta, { valor: number; componentes: number }>();
  for (const linha of linhas) {
    const atual = porGaveta.get(linha.gaveta) ?? { valor: 0, componentes: 0 };
    atual.valor += linha.valor;
    atual.componentes += 1;
    porGaveta.set(linha.gaveta, atual);
  }
  const ordem: Gaveta[] = ["MENSAL", "ANUAL", "AQUISICAO"];
  const totais = ordem
    .filter((g) => porGaveta.has(g))
    .map((gaveta) => ({
      gaveta,
      valor: Number(porGaveta.get(gaveta)!.valor.toFixed(2)),
      componentes: porGaveta.get(gaveta)!.componentes,
    }));

  return { linhas, naoApurados, totais, integridade, aprovados };
}

/**
 * Tira a marcação de código de um texto que vai para a tela.
 *
 * As evidências de `COMPOSITIONS` foram escritas para serem lidas num pull
 * request, com `**ênfase**` e `` `código` ``. Servidas cruas numa resposta de
 * API, chegam à tela como asteriscos e crases literais — o produto passa a
 * exibir marcação de Markdown a quem está conferindo uma planilha. O conteúdo
 * é o mesmo; o que sai é a notação.
 */
function semMarcacao(texto: string): string {
  return texto.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
}

function formatarNumero(valor: number): string {
  return DUAS_CASAS.format(valor);
}

/** O total mensal de uma composição já montada, ou nulo quando não há nenhum. */
export function mensalDe(totais: TotalDaGaveta[]): number | null {
  return totais.find((t) => t.gaveta === "MENSAL")?.valor ?? null;
}

/**
 * A composição de um equipamento numa vigência, pronta para a ficha.
 */
export async function montarComposicao(
  db: Database,
  entityId: string,
  opcoes: OpcoesDeComposicao = {},
): Promise<ComposicaoDoEquipamento | null> {
  const context = await resolveContext(db, opcoes.context);
  if (!context) return null;

  const identidade = await lerIdentidade(db, entityId);
  if (!identidade) return null;

  const vigencias = await listarVigencias(db, context);
  if (vigencias.length === 0) return null;

  const alvo =
    opcoes.period !== undefined
      ? vigencias.find((v) => v.effectiveDate === opcoes.period)
      : vigencias[vigencias.length - 1];
  if (!alvo) return null;

  const indice = vigencias.indexOf(alvo);
  const anterior = indice > 0 ? vigencias[indice - 1] : null;

  const [fatos, classificacoes, rastreio] = await Promise.all([
    lerFatos(db, entityId, alvo.effectiveDate, context),
    loadAttributeClassificationsAt(db, alvo.effectiveDate),
    rastrearEquipamento(db, entityId, alvo.effectiveDate, context),
  ]);

  const { linhas, naoApurados, totais, integridade } = comporDeFatos(
    identidade.entity_type,
    fatos,
    classificacoes,
  );

  let anteriorResumo: ComposicaoDoEquipamento["anterior"] = null;
  let variacaoMensal: Variacao | null = null;

  if (anterior && opcoes.comAnterior !== false) {
    const [fatosAnteriores, classificacoesAnteriores] = await Promise.all([
      lerFatos(db, entityId, anterior.effectiveDate, context),
      loadAttributeClassificationsAt(db, anterior.effectiveDate),
    ]);
    const composicaoAnterior = comporDeFatos(
      identidade.entity_type,
      fatosAnteriores,
      classificacoesAnteriores,
    );
    const mensalAnterior = mensalDe(composicaoAnterior.totais);
    anteriorResumo = {
      effectiveDate: anterior.effectiveDate,
      periodLabel: anterior.periodLabel,
      presente: fatosAnteriores.length > 0,
      mensal: mensalAnterior,
    };
    variacaoMensal = calcularVariacao(mensalDe(totais), mensalAnterior);

    /*
      Semântica que mudou entre as duas vigências, e que afeta uma linha que
      entrou na conta. É o caso `ipvaLicenciamento`, em que a base de cálculo da
      fonte mudou sem que unidade ou periodicidade mudassem — a variação parece
      ser de preço e é de regra.
    */
    for (const linha of linhas) {
      const antes = composicaoAnterior.linhas.find((l) => l.code === linha.code);
      if (!antes) continue;
      if (
        antes.semanticsVersion !== null &&
        linha.semanticsVersion !== null &&
        antes.semanticsVersion !== linha.semanticsVersion
      ) {
        integridade.push({
          code: linha.code,
          titulo: linha.titulo,
          tipo: "SEMANTICA_MUDOU",
          mensagem:
            `O significado de ${linha.titulo} mudou entre ${anterior.periodLabel} e ` +
            `${alvo.periodLabel} (versão ${antes.semanticsVersion} → ${linha.semanticsVersion}). ` +
            `A variação do valor não é necessariamente variação de preço.`,
        });
      }
    }
  }

  const semRegra = naoApurados.filter((n) => n.monetarioPotencial).length;
  const semClasse = naoApurados.filter((n) => n.semClassificacao).length;

  return {
    entityId,
    entityType: identidade.entity_type,
    rotuloDoTipo: regraDe(identidade.entity_type).rotulo,
    placa: identidade.placa,
    chassi: identidade.chassi,
    unidade: unidadeDe(context),
    operacao: context.channel,
    contextLabel: context.label,
    scopeHash: context.scopeHash,
    channel: context.channel,
    effectiveDate: alvo.effectiveDate,
    periodLabel: alvo.periodLabel,
    sourceLabels: alvo.sourceLabels,
    presente: fatos.length > 0,
    totais,
    linhas,
    naoApurados,
    integridade,
    anterior: anteriorResumo,
    variacaoMensal,
    completude: {
      calculaveis: linhas.length,
      semRegraFinanceira: semRegra,
      semClassificacao: semClasse,
      parcial: semRegra > 0 || semClasse > 0,
    },
    rastreio,
    status: avaliarStatus({
      presente: fatos.length > 0,
      mensal: mensalDe(totais),
      variacao: variacaoMensal,
      integridade,
      anteriorPresente: anteriorResumo?.presente ?? null,
      naoApurados,
    }),
  };
}

export function calcularVariacao(
  atual: number | null,
  anterior: number | null,
): Variacao | null {
  if (atual === null || anterior === null) return null;
  const absoluta = Number((atual - anterior).toFixed(2));
  /*
    Percentual sobre base zero não existe. "+∞%" e "+100%" seriam os dois
    igualmente falsos, e a variação absoluta continua verdadeira — é ela que a
    tela mostra quando o percentual não pode ser calculado.
  */
  const percentual =
    anterior === 0 ? null : Number(((absoluta / Math.abs(anterior)) * 100).toFixed(2));
  return { absoluta, percentual };
}

export function unidadeDe(context: ContextInfo): string | null {
  const unidade = context.scopes.find((s) => s.scopeType === "UNIDADE");
  return unidade?.name ?? unidade?.code ?? null;
}

export { lerVigencia, lerFatos, type FatoDoAtivo, type MaterialDaVigencia };
