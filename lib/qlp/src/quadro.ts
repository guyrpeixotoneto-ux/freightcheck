import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  loadAttributeClassificationsAt,
  type AttributeClassification,
  type RequestedContext,
} from "@workspace/comparison";
import { ehTipoNumerico, podeSomar, viraDinheiro } from "@workspace/curation";
import {
  DATASET_FAMILY_QUADRO_DE_PESSOAL,
  SEPARADOR_LEGIVEL,
  normalizeDocumento,
} from "@workspace/ingest";
import {
  TIPO_QLP_ADMINISTRATIVO,
  resolverContextoDoQuadro,
  type ContextoDoQuadro,
  filtroDosEscopos,
} from "./contexto";
import { contarRegistrosFaltando } from "./inconsistencias";

/**
 * O quadro de uma vigência: o que o modelo remunera de estrutura administrativa,
 * cargo a cargo, unidade a unidade — com a semântica de cada coluna ao lado.
 *
 * Duas regras herdadas do resto do produto, e não inventadas aqui:
 *
 * 1. **Exibir não é somar.** Todo valor declarado aparece, mesmo com semântica
 *    desconhecida — é o contrato do painel de não-apurados da Composição. O que
 *    fica travado até a curadoria confirmar é a **agregação**: efetivo total e
 *    custo da estrutura passam por `podeSomar`/`viraDinheiro`
 *    (`@workspace/curation`), e quando a resposta é não, a métrica carrega o
 *    motivo por extenso — nunca um zero.
 * 2. **Filtro estreita a lista, não o resumo.** O resumo é da vigência; os
 *    filtros são da tabela. Mesma decisão da visão de frota.
 */

/**
 * O efetivo reconhecido, pelo dicionário do export: "QUANTIDADE DE QLP
 * REMUNERADO — o efetivo reconhecido. É esta quantidade que o benchmark
 * confronta" (`docs/tabela-de-qlp-adm-dicionario.csv`). A tela referencia o
 * código, e a permissão de somá-lo continua sendo da curadoria.
 */
export const ATRIBUTO_EFETIVO = "qlp_administrativo.quantidade_ordenados";

/** A coluna de onde o nome legível da unidade sai, quando o export o traz. */
const ATRIBUTO_NOME_DA_UNIDADE = "qlp_administrativo.unidade_nome";

export interface SemanticaDaColuna {
  status: string;
  isMonetary: boolean | null;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
}

/** Uma coluna do export nesta vigência, com a leitura curada dela. */
export interface AtributoDoQuadro {
  code: string;
  sourceName: string;
  displayName: string | null;
  dataType: string;
  semantica: SemanticaDaColuna;
}

export type ValorDeFato = number | string | boolean | null;

export interface CargoDoQuadro {
  entityId: string;
  /** O cargo como o arquivo o escreveu — vem da identidade, não de um fato. */
  cargo: string;
  /** CNPJ normalizado (14 dígitos) — a chave de agrupamento. */
  unidadeCnpj: string;
  /** O CNPJ como o arquivo o escreveu. */
  unidadeCnpjLegivel: string;
  /** `attribute.code` → valor declarado. Ausente do mapa = célula vazia. */
  valores: Record<string, ValorDeFato>;
}

export interface UnidadeDoQuadro {
  cnpj: string;
  cnpjLegivel: string;
  nome: string | null;
  cargos: CargoDoQuadro[];
}

/** Um número que só existe quando a curadoria permite — senão, o motivo. */
export interface MetricaApuravel {
  valor: number | null;
  /** Frase pronta para a tela quando `valor` é null. */
  motivo: string | null;
}

export interface ResumoDoQuadro {
  unidades: number;
  cargos: number;
  efetivo: MetricaApuravel;
  custo: MetricaApuravel;
  /** Atributos numéricos deste export ainda sem semântica confirmada. */
  numericosPendentes: number;
  /** Verdadeiro quando nenhum numérico está pendente — o custo é o custo. */
  apuracaoCompleta: boolean;
  curadoria: { confirmados: number; total: number };
}

export interface FiltrosDoQuadro {
  /** Busca por cargo, sem acento e sem caixa. */
  busca?: string;
  /** CNPJ da unidade, em qualquer grafia — normalizado antes de comparar. */
  unidade?: string;
}

/*
  `Omit<..., "escopos">`: o quadro herda tudo o que o contexto resolveu **menos**
  a lista de escopos autorizados. Ela é a autorização da consulta, não conteúdo
  da resposta — e esta rota devolve o objeto inteiro por `res.json`, então o que
  estiver aqui vai para o cliente.
*/
export interface VisaoDoQuadro extends Omit<ContextoDoQuadro, "escopos"> {
  resumo: ResumoDoQuadro;
  atributos: AtributoDoQuadro[];
  unidades: UnidadeDoQuadro[];
  filtros: FiltrosDoQuadro;
  /**
   * Quantos registros a importação deixou de fora desta vigência.
   *
   * Zero no caso comum. Maior que zero, **este quadro está incompleto** e a
   * tela tem de dizê-lo antes de qualquer contagem: um cargo em quarentena não
   * aparece na tabela, não entra em `resumo.cargos` e não é distinguível, no
   * desenho, de um cargo que a unidade não tem. O número existe aqui para que
   * essa diferença não dependa de alguém abrir a aba certa.
   *
   * A evidência inteira — chave, linhas e valores em desacordo — está em
   * `getInconsistenciasDoQuadro`.
   */
  registrosFaltando: number;
}

type FatoDoQuadro = {
  entity_id: string;
  identifier_value_raw: string;
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
}

const fold = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

function valorDoFato(fato: FatoDoQuadro): ValorDeFato {
  if (fato.is_null) return null;
  if (fato.value_numeric !== null) return Number(fato.value_numeric);
  if (fato.value_text !== null) return fato.value_text;
  if (fato.value_boolean !== null) return fato.value_boolean;
  return fato.value_date;
}

/** Separa `"07.526.557/0015-05 · ANALISTA ADM"` em CNPJ legível e cargo. */
export function separarChaveLegivel(raw: string): { cnpjLegivel: string; cargo: string } {
  const posicao = raw.indexOf(SEPARADOR_LEGIVEL);
  if (posicao < 0) return { cnpjLegivel: "", cargo: raw };
  return {
    cnpjLegivel: raw.slice(0, posicao),
    cargo: raw.slice(posicao + SEPARADOR_LEGIVEL.length),
  };
}

export async function getQuadroAdministrativo(
  db: Database,
  options: {
    period?: string;
    context?: RequestedContext;
    filtros?: FiltrosDoQuadro;
  } = {},
): Promise<VisaoDoQuadro | null> {
  const resolvido = await resolverContextoDoQuadro(db, {
    ...options.context,
    ...(options.period !== undefined ? { period: options.period } : {}),
  });
  if (!resolvido) return null;
  const { escopos, effectiveDate } = resolvido;

  const { rows } = await db.execute<FatoDoQuadro>(sql`
    SELECT f.entity_id::text       AS entity_id,
           ei.identifier_value_raw,
           a.id::text              AS attribute_id,
           a.code,
           a.source_name,
           a.display_name,
           a.data_type,
           f.value_numeric::text   AS value_numeric,
           f.value_text,
           f.value_boolean,
           f.value_date::text      AS value_date,
           f.is_null
      FROM fato_visivel f
      JOIN snapshot s  ON s.id = f.snapshot_id
      JOIN entity e    ON e.id = f.entity_id
      JOIN entity_identifier ei
        ON ei.entity_id = e.id
       AND ei.identifier_type = 'PLACA'
       AND ei.is_current
      JOIN attribute a ON a.id = f.attribute_id
     WHERE s.status <> 'SUPERSEDED'
     AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
       AND s.dataset_family = ${DATASET_FAMILY_QUADRO_DE_PESSOAL}
       AND e.entity_type = ${TIPO_QLP_ADMINISTRATIVO}
       AND s.effective_date = ${effectiveDate}::date
       AND ${filtroDosEscopos("s", escopos)}
     ORDER BY ei.identifier_value_raw, a.code
  `);

  const classificacoes = await loadAttributeClassificationsAt(db, effectiveDate);

  // As colunas presentes nesta vigência, com a leitura curada de cada uma.
  const atributos = new Map<string, AtributoDoQuadro>();
  const classificacaoPorCode = new Map<string, AttributeClassification>();
  for (const fato of rows) {
    if (atributos.has(fato.code)) continue;
    const cls = classificacoes.get(fato.attribute_id);
    if (cls) classificacaoPorCode.set(fato.code, cls);
    atributos.set(fato.code, {
      code: fato.code,
      sourceName: fato.source_name,
      displayName: fato.display_name,
      dataType: fato.data_type,
      semantica: {
        status: cls?.semanticsStatus ?? "UNKNOWN",
        isMonetary: cls?.isMonetary ?? null,
        unit: cls?.unit ?? null,
        periodicity: cls?.periodicity ?? null,
        aggregation: cls?.aggregation ?? null,
      },
    });
  }

  // As linhas: um cargo por entidade.
  const cargosPorEntidade = new Map<string, CargoDoQuadro>();
  for (const fato of rows) {
    let cargo = cargosPorEntidade.get(fato.entity_id);
    if (!cargo) {
      const { cnpjLegivel, cargo: nomeDoCargo } = separarChaveLegivel(
        fato.identifier_value_raw,
      );
      cargo = {
        entityId: fato.entity_id,
        cargo: nomeDoCargo,
        unidadeCnpj: normalizeDocumento(cnpjLegivel),
        unidadeCnpjLegivel: cnpjLegivel,
        valores: {},
      };
      cargosPorEntidade.set(fato.entity_id, cargo);
    }
    cargo.valores[fato.code] = valorDoFato(fato);
  }
  const cargos = [...cargosPorEntidade.values()];

  // ---------------------------------------------------------------------------
  // O resumo — da vigência inteira, antes de qualquer filtro.
  // ---------------------------------------------------------------------------
  const cnpjs = [...new Set(cargos.map((c) => c.unidadeCnpj))];

  const semanticaDe = (code: string) => {
    const cls = classificacaoPorCode.get(code);
    const atributo = atributos.get(code);
    return {
      unit: cls?.unit ?? null,
      aggregation: cls?.aggregation ?? null,
      isMonetary: cls?.isMonetary ?? null,
      semanticsStatus: cls?.semanticsStatus ?? atributo?.semantica.status ?? "UNKNOWN",
      dataType: cls?.dataType ?? atributo?.dataType ?? null,
      periodicity: cls?.periodicity ?? null,
    };
  };

  const efetivo = ((): MetricaApuravel => {
    if (!atributos.has(ATRIBUTO_EFETIVO)) {
      return {
        valor: null,
        motivo:
          `O export desta vigência não traz a coluna "Quantidade Ordenados" ` +
          `(${ATRIBUTO_EFETIVO}), que é o efetivo reconhecido do dicionário.`,
      };
    }
    const semantica = semanticaDe(ATRIBUTO_EFETIVO);
    if (semantica.semanticsStatus !== "CONFIRMED") {
      return {
        valor: null,
        motivo:
          `Semântica ${semantica.semanticsStatus === "PRESUMED" ? "presumida" : "desconhecida"}: ` +
          `somar o efetivo dos cargos ainda depende de a curadoria confirmar o que esta coluna mede.`,
      };
    }
    const veredito = podeSomar(semantica);
    if (!veredito.ok) return { valor: null, motivo: veredito.motivo };
    const soma = cargos.reduce((total, cargo) => {
      const valor = cargo.valores[ATRIBUTO_EFETIVO];
      return typeof valor === "number" ? total + valor : total;
    }, 0);
    return { valor: soma, motivo: null };
  })();

  const codigosMonetarios = [...atributos.keys()].filter(
    (code) => viraDinheiro(semanticaDe(code)).ok,
  );
  const numericosPendentes = [...atributos.values()].filter(
    (atributo) =>
      ehTipoNumerico(atributo.dataType) && atributo.semantica.status !== "CONFIRMED",
  ).length;

  const custo = ((): MetricaApuravel => {
    if (codigosMonetarios.length === 0) {
      return {
        valor: null,
        motivo:
          numericosPendentes > 0
            ? `Nenhum atributo deste export foi confirmado como montante somável — ` +
              `${numericosPendentes} atributo${numericosPendentes === 1 ? "" : "s"} ` +
              `numérico${numericosPendentes === 1 ? "" : "s"} aguarda${numericosPendentes === 1 ? "" : "m"} ` +
              `confirmação de semântica na Curadoria.`
            : "Nenhum atributo deste export está confirmado como montante somável.",
      };
    }
    let soma = 0;
    for (const cargo of cargos) {
      for (const code of codigosMonetarios) {
        const valor = cargo.valores[code];
        if (typeof valor === "number") soma += valor;
      }
    }
    return { valor: soma, motivo: null };
  })();

  const confirmados = [...atributos.values()].filter(
    (atributo) => atributo.semantica.status === "CONFIRMED",
  ).length;

  const resumo: ResumoDoQuadro = {
    unidades: cnpjs.length,
    cargos: cargos.length,
    efetivo,
    custo,
    numericosPendentes,
    apuracaoCompleta: numericosPendentes === 0,
    curadoria: { confirmados, total: atributos.size },
  };

  // ---------------------------------------------------------------------------
  // Filtros — estreitam a lista, nunca o resumo.
  // ---------------------------------------------------------------------------
  const filtros = options.filtros ?? {};
  let visiveis = cargos;
  if (filtros.unidade) {
    const alvo = normalizeDocumento(filtros.unidade);
    visiveis = visiveis.filter((cargo) => cargo.unidadeCnpj === alvo);
  }
  if (filtros.busca) {
    const alvo = fold(filtros.busca);
    visiveis = visiveis.filter((cargo) => fold(cargo.cargo).includes(alvo));
  }

  // Agrupado por unidade, com o nome que o próprio arquivo declarou.
  const unidades = new Map<string, UnidadeDoQuadro>();
  for (const cargo of visiveis) {
    let unidade = unidades.get(cargo.unidadeCnpj);
    if (!unidade) {
      const nome = cargo.valores[ATRIBUTO_NOME_DA_UNIDADE];
      unidade = {
        cnpj: cargo.unidadeCnpj,
        cnpjLegivel: cargo.unidadeCnpjLegivel,
        nome: typeof nome === "string" ? nome : null,
        cargos: [],
      };
      unidades.set(cargo.unidadeCnpj, unidade);
    }
    unidade.cargos.push(cargo);
  }
  for (const unidade of unidades.values()) {
    unidade.cargos.sort((a, b) => a.cargo.localeCompare(b.cargo, "pt-BR"));
  }

  /*
    `escopos` fica de fora do corpo: ele é a autorização desta leitura, não
    conteúdo dela. Espalhar `resolvido` inteiro o publicaria no JSON da rota —
    a lista de contextos que o servidor consultou, num payload que a tela não
    pede e não usa.
  */
  const { escopos: _autorizacao, ...doContexto } = resolvido;
  return {
    ...doContexto,
    resumo,
    atributos: [...atributos.values()].sort((a, b) => a.code.localeCompare(b.code)),
    unidades: [...unidades.values()].sort((a, b) =>
      (a.nome ?? a.cnpj).localeCompare(b.nome ?? b.cnpj, "pt-BR"),
    ),
    filtros,
    registrosFaltando: await contarRegistrosFaltando(db, escopos, effectiveDate),
  };
}
