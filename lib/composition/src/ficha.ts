/**
 * A ficha do equipamento além da composição: **histórico** e **alterações**.
 *
 * As duas respondem perguntas que a composição de uma vigência não responde —
 * "isto sempre foi assim?" e "o que mexeu desde o mês passado?" — e as duas
 * usam o mesmo motor, de propósito. Um histórico que somasse por outro caminho
 * mostraria uma série que não termina no número da ficha.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  attributeLabel,
  computeChangeSet,
  contextFilter,
  getChangeSetForPair,
  listChanges,
  loadAttributeClassificationsAt,
  periodLabel,
  placementOf,
  resolveContext,
  type AttributeClassification,
  type ChangeRow,
  type SeriesContext,
} from "@workspace/comparison";
import {
  calcularVariacao,
  comporDeFatos,
  listarVigencias,
  mensalDe,
  type FatoDoAtivo,
  type Variacao,
} from "./motor";
import { gavetaDe, regraDe, ROTULO_DO_MOTIVO, type MotivoDeExclusao } from "./regras";
import { motivoDaNaoApuracao, type MotivoDaNaoApuracao } from "./status";

// ---------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------

export interface PontoDoHistorico {
  effectiveDate: string;
  periodLabel: string;
  presente: boolean;
  /** A remuneração mensal apurada naquela vigência. */
  mensal: number | null;
  componentes: number;
  semRegraFinanceira: number;
  /** Números que a curadoria ainda não classificou naquela vigência. */
  semClassificacao: number;
  variacao: Variacao | null;
  /** Quantos componentes calculáveis mudaram de valor contra a vigência anterior. */
  componentesAlterados: number;
  /**
   * Quando não houve remuneração apurada naquela vigência, de que classe é a
   * lacuna. Nulo quando houve valor — e nulo quando o ativo não estava lá.
   */
  naoApuradoPor: MotivoDaNaoApuracao | null;
}

export interface SerieDeComponente {
  code: string;
  titulo: string;
  unit: string | null;
  periodicity: string | null;
  /** Se este componente entrou em algum total na vigência mais recente. */
  financeiro: boolean;
  pontos: {
    effectiveDate: string;
    periodLabel: string;
    valor: number | null;
    exibicao: string | null;
  }[];
}

export interface HistoricoDoEquipamento {
  entityId: string;
  entityType: string;
  placa: string | null;
  pontos: PontoDoHistorico[];
  componentes: SerieDeComponente[];
}

interface FatoHistorico extends FatoDoAtivo, Record<string, unknown> {
  effective_date: string;
}

/**
 * Todo o passado de um ativo numa consulta.
 *
 * A proveniência fica de fora aqui — a série mostra a forma da curva, e quem
 * quer a célula abre a vigência. Trazer a origem de 675 fatos para desenhar
 * nove pontos seria pagar por um dado que ninguém lê nesta tela.
 */
async function lerHistorico(
  db: Database,
  entityId: string,
  context: SeriesContext,
): Promise<FatoHistorico[]> {
  const { rows } = await db.execute<FatoHistorico>(sql`
    SELECT s.effective_date::text AS effective_date,
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
      FROM fact f
      JOIN attribute a ON a.id = f.attribute_id
      JOIN snapshot s  ON s.id = f.snapshot_id
     WHERE f.entity_id = ${entityId}::uuid
       AND s.status <> 'SUPERSEDED'
       AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
       AND ${contextFilter("s", context)}
     ORDER BY s.effective_date, a.code
  `);
  return rows;
}

export async function getHistorico(
  db: Database,
  entityId: string,
  requested?: Partial<SeriesContext>,
): Promise<HistoricoDoEquipamento | null> {
  const context = await resolveContext(db, requested);
  if (!context) return null;

  const { rows: identidade } = await db.execute<{
    entity_type: string;
    placa: string | null;
  }>(sql`
    SELECT e.entity_type,
           max(ei.identifier_value) FILTER (WHERE ei.identifier_type = 'PLACA') AS placa
      FROM entity e
      LEFT JOIN entity_identifier ei ON ei.entity_id = e.id AND ei.is_current
     WHERE e.id = ${entityId}::uuid
     GROUP BY 1
  `);
  if (identidade.length === 0) return null;
  const entityType = identidade[0].entity_type;

  const vigencias = await listarVigencias(db, context);
  const fatos = await lerHistorico(db, entityId, context);

  const porData = new Map<string, FatoHistorico[]>();
  for (const fato of fatos) {
    const lista = porData.get(fato.effective_date) ?? [];
    lista.push(fato);
    porData.set(fato.effective_date, lista);
  }

  /*
    Uma leitura de semântica por vigência, e não uma para todas. Comparar
    dez/2025 com ago/2026 usando o significado de hoje é exatamente o erro que
    `attribute_semantics` existe para impedir.
  */
  const classificacoesPorData = new Map<string, Map<string, AttributeClassification>>();
  for (const vigencia of vigencias) {
    classificacoesPorData.set(
      vigencia.effectiveDate,
      await loadAttributeClassificationsAt(db, vigencia.effectiveDate),
    );
  }

  const pontos: PontoDoHistorico[] = [];
  const calculaveisPorData = new Map<string, Map<string, number>>();
  let anteriorMensal: number | null = null;
  let anteriorCalculaveis: Map<string, number> | null = null;

  for (const vigencia of vigencias) {
    const doMes = porData.get(vigencia.effectiveDate) ?? [];
    const classificacoes = classificacoesPorData.get(vigencia.effectiveDate)!;
    const composicao = comporDeFatos(entityType, doMes, classificacoes);
    const mensal = mensalDe(composicao.totais);

    const calculaveis = new Map(composicao.linhas.map((l) => [l.code, l.valor]));
    calculaveisPorData.set(vigencia.effectiveDate, calculaveis);

    let alterados = 0;
    if (anteriorCalculaveis) {
      const codigos = new Set([...calculaveis.keys(), ...anteriorCalculaveis.keys()]);
      for (const code of codigos) {
        if (calculaveis.get(code) !== anteriorCalculaveis.get(code)) alterados += 1;
      }
    }

    pontos.push({
      effectiveDate: vigencia.effectiveDate,
      periodLabel: vigencia.periodLabel,
      presente: doMes.length > 0,
      mensal,
      componentes: composicao.totais.find((t) => t.gaveta === "MENSAL")?.componentes ?? 0,
      semRegraFinanceira: composicao.naoApurados.filter((n) => n.monetarioPotencial).length,
      semClassificacao: composicao.naoApurados.filter((n) => n.semClassificacao).length,
      variacao: calcularVariacao(mensal, anteriorMensal),
      componentesAlterados: alterados,
      naoApuradoPor:
        mensal === null && doMes.length > 0
          ? motivoDaNaoApuracao(composicao.naoApurados)
          : null,
    });

    anteriorMensal = mensal;
    anteriorCalculaveis = calculaveis;
  }

  /* As séries por componente — todas as colunas do ativo, não só as somáveis.
     "O IPVA subiu?" e "o consumo negociado mudou?" são a mesma pergunta para
     quem está auditando, e só uma delas vira dinheiro. */
  const ultimaData = vigencias[vigencias.length - 1]?.effectiveDate;
  const calculaveisAgora = ultimaData ? (calculaveisPorData.get(ultimaData) ?? new Map()) : new Map();
  const classificacoesAgora = ultimaData
    ? (classificacoesPorData.get(ultimaData) ?? new Map())
    : new Map<string, AttributeClassification>();

  const codigos = [...new Set(fatos.map((f) => f.code))].sort();
  const componentes: SerieDeComponente[] = codigos.map((code) => {
    const exemplo = fatos.find((f) => f.code === code)!;
    const classificacao = classificacoesAgora.get(exemplo.attribute_id);
    return {
      code,
      titulo: attributeLabel(code, exemplo.source_name, exemplo.display_name),
      unit: classificacao?.unit ?? null,
      periodicity: classificacao?.periodicity ?? null,
      financeiro: calculaveisAgora.has(code),
      pontos: vigencias.map((vigencia) => {
        const fato = (porData.get(vigencia.effectiveDate) ?? []).find((f) => f.code === code);
        return {
          effectiveDate: vigencia.effectiveDate,
          periodLabel: vigencia.periodLabel,
          valor:
            fato && !fato.is_null && fato.value_numeric !== null
              ? Number(fato.value_numeric)
              : null,
          exibicao: fato ? exibicaoCurta(fato) : null,
        };
      }),
    };
  });

  return {
    entityId,
    entityType,
    placa: identidade[0].placa,
    pontos,
    componentes,
  };
}

function exibicaoCurta(fato: FatoHistorico): string | null {
  if (fato.is_null) return null;
  if (fato.value_text !== null) return fato.value_text;
  if (fato.value_numeric !== null) return fato.value_numeric;
  if (fato.value_boolean !== null) return fato.value_boolean ? "Sim" : "Não";
  return fato.value_date;
}

// ---------------------------------------------------------------------------
// Alterações
// ---------------------------------------------------------------------------

/** Uma alteração do motor de comparação, relida pelas regras da composição. */
export interface AlteracaoDoEquipamento extends ChangeRow {
  /** Se o atributo participa do total mensal deste equipamento. */
  entraNoTotal: boolean;
  /** Quando não participa: por quê, no vocabulário da composição. */
  motivo: MotivoDeExclusao | null;
  motivoRotulo: string | null;
  explicacao: string | null;
  familia: string;
  parametro: string;
}

export interface AlteracoesDoEquipamento {
  entityId: string;
  placa: string | null;
  de: { effectiveDate: string; periodLabel: string; sourceLabel: string } | null;
  para: { effectiveDate: string; periodLabel: string; sourceLabel: string };
  /** Nulo quando esta é a primeira vigência da série. */
  changeSetId: string | null;
  alteracoes: AlteracaoDoEquipamento[];
  /** A variação do total mensal, que é o que as alterações têm de explicar. */
  variacaoMensal: Variacao | null;
  /**
   * Quanto da variação as alterações calculáveis explicam.
   *
   * A decomposição tem de fechar. O que sobra vira `naoAtribuido`, com a lista
   * das alterações que caíram fora da conta — a mesma disciplina do waterfall
   * em docs/ARQUITETURA.md §7. Decomposição que não fecha passa confiança falsa.
   */
  explicado: number | null;
  naoAtribuido: number | null;
}

interface SnapshotDaSerie {
  id: string;
  effectiveDate: string;
  sourceLabel: string;
}

async function snapshotsDaSerie(
  db: Database,
  entityType: string,
  context: SeriesContext,
): Promise<SnapshotDaSerie[]> {
  const { rows } = await db.execute<{
    id: string;
    effective_date: string;
    source_label: string;
  }>(sql`
    SELECT s.id::text, s.effective_date::text AS effective_date, s.source_label
      FROM snapshot s
     WHERE s.status <> 'SUPERSEDED'
     AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
       AND ${contextFilter("s", context)}
       AND ${entityType} = ANY(string_to_array(s.entity_type_set, '+'))
     ORDER BY s.effective_date
  `);
  return rows.map((r) => ({
    id: r.id,
    effectiveDate: r.effective_date,
    sourceLabel: r.source_label,
  }));
}

/**
 * As alterações deste equipamento entre a vigência escolhida e a anterior.
 *
 * Lê o motor de comparação em vez de reimplementá-lo: natureza da mudança,
 * comparabilidade, versão de semântica dos dois lados e rastreabilidade até a
 * célula já são dele, e uma segunda implementação divergiria da tela de
 * Alterações no primeiro caso difícil. O que este módulo acrescenta é a leitura
 * de composição: **esta mudança mexe no que o equipamento recebe, ou não?**
 */
export async function getAlteracoesDoEquipamento(
  db: Database,
  entityId: string,
  opcoes: { period?: string; context?: Partial<SeriesContext> } = {},
): Promise<AlteracoesDoEquipamento | null> {
  const context = await resolveContext(db, opcoes.context);
  if (!context) return null;

  const { rows: identidade } = await db.execute<{
    entity_type: string;
    placa: string | null;
  }>(sql`
    SELECT e.entity_type,
           max(ei.identifier_value) FILTER (WHERE ei.identifier_type = 'PLACA') AS placa
      FROM entity e
      LEFT JOIN entity_identifier ei ON ei.entity_id = e.id AND ei.is_current
     WHERE e.id = ${entityId}::uuid
     GROUP BY 1
  `);
  if (identidade.length === 0) return null;
  const { entity_type: entityType, placa } = identidade[0];

  const serie = await snapshotsDaSerie(db, entityType, context);
  if (serie.length === 0) return null;

  const alvo =
    opcoes.period !== undefined
      ? serie.find((s) => s.effectiveDate === opcoes.period)
      : serie[serie.length - 1];
  if (!alvo) return null;

  const indice = serie.indexOf(alvo);
  const anterior = indice > 0 ? serie[indice - 1] : null;

  const para = {
    effectiveDate: alvo.effectiveDate,
    periodLabel: periodLabel(alvo.effectiveDate),
    sourceLabel: alvo.sourceLabel,
  };

  if (!anterior) {
    return {
      entityId,
      placa,
      de: null,
      para,
      changeSetId: null,
      alteracoes: [],
      variacaoMensal: null,
      explicado: null,
      naoAtribuido: null,
    };
  }

  /*
    Reaproveita a comparação já gravada; só calcula quando não existe. Abrir uma
    ficha não deveria disparar o diff de uma vigência inteira, mas também não
    pode devolver "sem alterações" só porque ninguém rodou a comparação ainda —
    silêncio e ausência de mudança são indistinguíveis na tela, e um deles é
    mentira.
  */
  const existente = await getChangeSetForPair(db, anterior.id, alvo.id);
  const set =
    existente ??
    (await computeChangeSet(db, anterior.id, alvo.id, { computedBy: "api:composicao" }));

  /* Sem placa não há como filtrar no motor, que denormaliza a entidade pelo
     rótulo. Devolver a comparação inteira seria pior do que devolver nada. */
  const { rows } = placa
    ? await listChanges(db, set.id, { entityLabel: placa, limit: 500 })
    : { rows: [] as ChangeRow[] };

  /* A leitura de composição das duas pontas, para dizer o que entra no total. */
  const [classificacoes, classificacoesAntes] = await Promise.all([
    loadAttributeClassificationsAt(db, alvo.effectiveDate),
    loadAttributeClassificationsAt(db, anterior.effectiveDate),
  ]);
  const [fatosAgora, fatosAntes] = await Promise.all([
    lerFatosSimples(db, entityId, alvo.effectiveDate, context),
    lerFatosSimples(db, entityId, anterior.effectiveDate, context),
  ]);
  const agora = comporDeFatos(entityType, fatosAgora, classificacoes);
  const antes = comporDeFatos(entityType, fatosAntes, classificacoesAntes);

  const noTotal = new Set(agora.linhas.map((l) => l.code));
  const motivoPorCodigo = new Map(agora.naoApurados.map((n) => [n.code, n]));
  /*
    `attributeName` já vem resolvido de `listChanges` — o mesmo nome de leitura
    que a aba Composição usa, tirado do estado atual do atributo e não da cópia
    que a comparação denormalizou na época. Enquanto a resolução morava só aqui,
    a aba Alterações chamava de "finameCavalo" o que a aba ao lado chama de
    "Custo fixo do cavalo"; agora ela mora em `query.ts`, de onde serve também os
    painéis da tela de Alterações, que sofriam do mesmo.
  */
  const alteracoes: AlteracaoDoEquipamento[] = rows.map((row) => {
    const excluido = row.attributeCode ? motivoPorCodigo.get(row.attributeCode) : undefined;
    const colocacao = placementOf(row.attributeCode);
    return {
      ...row,
      entraNoTotal: row.attributeCode !== null && noTotal.has(row.attributeCode),
      motivo: excluido?.motivo ?? null,
      motivoRotulo: excluido ? ROTULO_DO_MOTIVO[excluido.motivo] : null,
      explicacao: excluido?.explicacao ?? null,
      familia: colocacao.familyName,
      parametro: colocacao.parameter,
    };
  });

  const variacaoMensal = calcularVariacao(mensalDe(agora.totais), mensalDe(antes.totais));

  /*
    O quanto as linhas calculáveis explicam da variação. A conta é feita sobre a
    própria composição das duas pontas — e não sobre `impact_amount`, que é da
    comparação e mistura periodicidades. Aqui só entra o que é mensal, que é a
    grandeza do número em destaque.
  */
  let explicado: number | null = null;
  if (variacaoMensal !== null) {
    const antesPorCodigo = new Map(antes.linhas.map((l) => [l.code, l.valor]));
    let soma = 0;
    for (const linha of agora.linhas) {
      if (gavetaDe(linha.periodicity) !== "MENSAL") continue;
      soma += linha.valor - (antesPorCodigo.get(linha.code) ?? 0);
    }
    for (const linha of antes.linhas) {
      if (gavetaDe(linha.periodicity) !== "MENSAL") continue;
      if (!noTotal.has(linha.code)) soma -= linha.valor;
    }
    explicado = Number(soma.toFixed(2));
  }

  return {
    entityId,
    placa,
    de: {
      effectiveDate: anterior.effectiveDate,
      periodLabel: periodLabel(anterior.effectiveDate),
      sourceLabel: anterior.sourceLabel,
    },
    para,
    changeSetId: set.id,
    alteracoes,
    variacaoMensal,
    explicado,
    naoAtribuido:
      variacaoMensal === null || explicado === null
        ? null
        : Number((variacaoMensal.absoluta - explicado).toFixed(2)),
  };
}

/** Os fatos de um ativo numa vigência, sem a proveniência. */
async function lerFatosSimples(
  db: Database,
  entityId: string,
  effectiveDate: string,
  context: SeriesContext,
): Promise<FatoDoAtivo[]> {
  const { rows } = await db.execute<FatoDoAtivo>(sql`
    SELECT a.id::text AS attribute_id,
           a.code, a.source_name, a.display_name, a.data_type,
           f.value_numeric::text AS value_numeric,
           f.value_text, f.value_boolean,
           f.value_date::text AS value_date,
           f.is_null, f.null_reason,
           s.source_label,
           NULL::text AS sheet_name, NULL::int AS row_index,
           NULL::text AS column_letter, NULL::text AS column_header,
           NULL::text AS raw_value
      FROM fact f
      JOIN attribute a ON a.id = f.attribute_id
      JOIN snapshot s  ON s.id = f.snapshot_id
     WHERE f.entity_id = ${entityId}::uuid
       AND s.effective_date = ${effectiveDate}::date
       AND s.status <> 'SUPERSEDED'
       AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
       AND ${contextFilter("s", context)}
  `);
  return rows;
}

// ---------------------------------------------------------------------------
// Conjunto — o atalho da ficha do cavalo para a carreta que ele puxa
// ---------------------------------------------------------------------------

/** O que a ficha do cavalo mostra sobre a carreta que ele puxa. */
export interface VinculoDoCavalo {
  placaCarreta: string;
  carretaEntityId: string | null;
  /** O total do conjunto declarado pela fonte, quando a carreta existe. */
  totalDoConjunto: number | null;
  /**
   * Preenchido **só** quando o banco contradiz a própria invariante: mais de
   * uma carreta corrente com a placa que o cavalo aponta.
   *
   * Isso não deveria acontecer — `entity_identifier_current_uq` é um índice
   * único parcial sobre (`identifier_type`, `identifier_value`) `WHERE
   * is_current`, e é ele que torna "uma placa, um equipamento" uma propriedade
   * do banco e não uma convenção do código. Se mesmo assim aparecer duas, a
   * leitura não escolhe: ela devolve o fato, com as duas identidades, para quem
   * chamou registrar. Escolher a primeira daria um atalho que aponta para a
   * carreta errada sem que ninguém fique sabendo, que é a categoria de erro
   * que este módulo existe para não cometer.
   */
  ambiguidade: { entityIds: string[] } | null;
}

/**
 * A carreta que este cavalo puxa nesta vigência, quando a fonte declara uma.
 *
 * **O que esta função é, e o que ela não é.** É o atalho de navegação da ficha
 * do cavalo: uma linha, um destino, resolvida em SQL para uma placa só. A regra
 * do pareamento — quem puxa quem, quem ficou órfã, o que fazer quando dois
 * cavalos apontam a mesma placa — mora em `vinculo.ts` e serve a aba Conjuntos e
 * a DRE, que precisam da frota inteira pareada de uma vez. As duas leituras
 * respondem à mesma pergunta e uma delas cabe numa consulta; o que não pode é a
 * *regra* estar escrita duas vezes, e não está.
 *
 * O vínculo é confiável: medido em 14/08/2026 na última vigência,
 * `cavalo.placa_carreta` tem valor nos 62 cavalos, aponta 62 placas distintas, e
 * as 62 casam com uma carreta que existe no banco — um para um, sem sobra dos
 * dois lados. E a aritmética confirma a semântica do vínculo, não só a sua
 * forma: `carreta.finame` menos `carreta.finame_implemento` dá exatamente o
 * `cavalo.finame_cavalo` do cavalo apontado, em 558 de 558 linhas.
 *
 * @param vigencia A vigência e o contexto **já resolvidos** pela composição que
 * está na tela. Não são opcionais de propósito: a versão anterior recebia um
 * `period` opcional e um contexto parcial e os resolvia de novo por dentro —
 * `max(effective_date)` numa CTE, `resolveContext` outra vez —, de modo que a
 * ficha e o vínculo dela podiam, em princípio, falar de vigências diferentes.
 * Quem já sabe qual vigência está mostrando passa a dizer, e some a segunda
 * régua.
 */
export async function getVinculoDoCavalo(
  db: Database,
  entityId: string,
  vigencia: { effectiveDate: string; context: SeriesContext },
): Promise<VinculoDoCavalo | null> {
  const { effectiveDate, context } = vigencia;
  const codigoDoVinculo = "cavalo.placa_carreta";
  const totalDoConjunto = regraDe("CARRETA").totalDoConjunto;

  /*
    Os dois filtros que faltavam aqui, e que todas as outras leituras deste
    módulo aplicam: `status <> 'SUPERSEDED'` e o `contextFilter`.

    Sem eles a CTE varria também as revisões mortas da mesma data — reimportar
    uma vigência não apaga a anterior, ela vira SUPERSEDED e os fatos ficam — e
    os outros escopos e canais daquele dia. O resultado era mais de uma linha
    onde o `SELECT` de baixo esperava um valor, e o Postgres derrubava a
    consulta inteira com `21000`. A ficha do equipamento respondia 500; a lista
    da frota, que não resolve vínculo, seguia abrindo. Ver
    `__tests__/vinculo-revisoes.test.ts`.

    O `LIMIT 1` que sobrou não é o conserto — é o que impede que uma família de
    dados nova, que o contexto não separa, volte a transformar uma leitura de
    atalho num erro de página inteira. O critério é determinístico: a revisão
    mais alta, e o fato mais recente dentro dela.
  */
  const { rows } = await db.execute<{
    placa_carreta: string | null;
    carreta_entity_id: string | null;
    total: string | null;
  }>(sql`
    WITH vinculo AS (
      SELECT f.value_text AS placa_carreta
        FROM fact f
        JOIN attribute a ON a.id = f.attribute_id
        JOIN snapshot s  ON s.id = f.snapshot_id
       WHERE f.entity_id = ${entityId}::uuid
         AND a.code = ${codigoDoVinculo}
         AND s.effective_date = ${effectiveDate}::date
         AND s.status <> 'SUPERSEDED'
         AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
         AND ${contextFilter("s", context)}
         AND NOT f.is_null
       ORDER BY s.revision DESC, f.id DESC
       LIMIT 1
    ),
    carreta AS (
      SELECT ei.entity_id
        FROM entity_identifier ei
        JOIN entity e ON e.id = ei.entity_id
       WHERE ei.identifier_type = 'PLACA'
         AND ei.is_current
         AND e.entity_type = 'CARRETA'
         AND ei.identifier_value = (SELECT placa_carreta FROM vinculo)
    )
    /*
      Uma linha por carreta encontrada, e não um valor por subconsulta. É o que
      deixa a multiplicidade visível para quem lê o resultado, em vez de
      transformá-la em erro do banco ou em escolha silenciosa: nenhuma carreta
      dá uma linha com nulos, e mais de uma dá mais de uma linha.
    */
    SELECT v.placa_carreta,
           c.entity_id::text AS carreta_entity_id,
           (SELECT f.value_numeric::text
              FROM fact f
              JOIN attribute a ON a.id = f.attribute_id
              JOIN snapshot s  ON s.id = f.snapshot_id
             WHERE f.entity_id = c.entity_id
               AND a.code = ${totalDoConjunto ?? ""}
               AND s.effective_date = ${effectiveDate}::date
               AND s.status <> 'SUPERSEDED'
               AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
               AND ${contextFilter("s", context)}
               AND NOT f.is_null
             ORDER BY s.revision DESC, f.id DESC
             LIMIT 1)        AS total
      FROM vinculo v
      LEFT JOIN carreta c ON true
  `);

  const placaCarreta = rows[0]?.placa_carreta;
  if (!placaCarreta) return null;

  const encontradas = rows.filter((r) => r.carreta_entity_id !== null);
  if (encontradas.length > 1) {
    return {
      placaCarreta,
      carretaEntityId: null,
      totalDoConjunto: null,
      ambiguidade: { entityIds: encontradas.map((r) => r.carreta_entity_id!).sort() },
    };
  }

  const carreta = encontradas[0];
  return {
    placaCarreta,
    carretaEntityId: carreta?.carreta_entity_id ?? null,
    totalDoConjunto: carreta?.total == null ? null : Number(carreta.total),
    ambiguidade: null,
  };
}
