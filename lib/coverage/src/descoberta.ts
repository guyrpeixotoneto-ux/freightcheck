import { sql } from "drizzle-orm";
import {
  filtroDeSerie,
  filtroDeVigenciaDisponivel,
  type ChaveDeSerie,
} from "@workspace/availability";
import type { Database } from "@workspace/db";
import { vigenciasObservadas } from "./observado";

/**
 * O que apareceu de novo — e o que provavelmente não é novo, só mudou de nome.
 *
 * Um export que ganha `ipvaLicenciamentoMensal` na mesma vigência em que
 * `ipvaLicenciamento` para de aparecer não trouxe um campo novo e perdeu outro:
 * quase certamente renomeou um. Dizer "campo novo" e "lacuna" nos dois lados é
 * ao mesmo tempo contar uma lacuna que não existe e esconder a mudança que
 * existe.
 *
 * **O que este arquivo não faz, e não fará.** Ele não remapeia nada. Não
 * escreve alias, não fecha janela de expectativa, não muda cobertura. Ele
 * calcula um candidato com a confiança e os motivos, e a decisão é de uma
 * pessoa — `registrarDecisao` em `contrato.ts`, que exige ator e justificativa.
 * Remapeamento automático é destrutivo por natureza: ele apaga a evidência de
 * que houve uma pergunta a fazer.
 *
 * **A confiança é uma soma de sinais nomeados, não uma nota de modelo.** Cada
 * parcela vale um número fixo, e a resposta carrega quais bateram. Quem lê "96%"
 * consegue ver de onde saíram os 96 e discordar de uma parcela específica — o
 * que uma pontuação opaca não permite.
 */

/** Os pesos, somando 1. Explícitos para que uma revisão deles seja um diff. */
export const PESOS = {
  /** Os nomes se parecem depois de normalizados. Peso maior, mas nunca sozinho. */
  nome: 0.4,
  /** Mesmo equipamento. */
  entidade: 0.15,
  /** Mesma família de dataset. */
  familia: 0.1,
  /** Mesmo tipo de dado. */
  tipo: 0.1,
  /** O antigo parou de aparecer exatamente quando o novo apareceu. */
  substituicao: 0.25,
} as const;

export interface CandidatoARenomeacao {
  attributeCode: string;
  confianca: number;
  motivos: string[];
}

export interface Descoberta {
  attributeCode: string;
  attributeLabel: string;
  sourceName: string;
  entityType: string;
  dataType: string;
  /** A vigência em que apareceu pela primeira vez. */
  primeiraVigencia: string;
  primeiroRotulo: string;
  /** A importação e o arquivo que o trouxeram. */
  importRunId: string | null;
  arquivo: string | null;
  /** Entidades que já o receberam. */
  entidadesAfetadas: number;
  datasetFamily: string;
  /** O provável equivalente, quando há um. */
  possivelSucessaoDe: CandidatoARenomeacao | null;
  /** Se já existe decisão de curadoria sobre este atributo. */
  statusDeCuradoria: "PENDENTE" | "DECIDIDO";
}

/**
 * Normaliza um código para comparação de nome.
 *
 * Tira o prefixo de equipamento (`cavalo.`), separadores e caixa. O que sobra é
 * o radical: `cavalo.ipva_licenciamento` e `cavalo.ipva_licenciamento_mensal`
 * viram `ipvalicenciamento` e `ipvalicenciamentomensal`, que é onde a
 * semelhança fica visível.
 */
export function radical(code: string): string {
  return code
    .replace(/^[^.]+\./, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Semelhança de nomes, entre 0 e 1.
 *
 * Prefixo comum sobre o comprimento do maior. É deliberadamente simples e
 * deliberadamente conservador: `ipvalicenciamento` dentro de
 * `ipvalicenciamentomensal` dá 0,74, o que sozinho não passa de nenhum limiar —
 * é a soma com os outros sinais que decide. Uma distância de edição sofisticada
 * daria um número mais bonito e a mesma decisão, com a diferença de que ninguém
 * conseguiria explicá-lo na tela.
 */
export function semelhancaDeNome(a: string, b: string): number {
  const x = radical(a);
  const y = radical(b);
  if (x === y) return 1;
  const menor = x.length <= y.length ? x : y;
  const maior = x.length <= y.length ? y : x;
  if (maior.length === 0) return 0;
  /* Contenção conta como semelhança forte: é a forma da renomeação por sufixo. */
  if (maior.startsWith(menor) || maior.endsWith(menor)) {
    return Number((menor.length / maior.length).toFixed(4));
  }
  let comum = 0;
  while (comum < menor.length && x[comum] === y[comum]) comum++;
  return Number((comum / maior.length).toFixed(4));
}

/** Abaixo disto o par não é sequer oferecido como candidato. */
export const LIMIAR_DE_CANDIDATURA = 0.6;

/**
 * Semelhança de nome mínima para o par sequer ser pontuado.
 *
 * É um **portão**, e não mais um peso, e a diferença foi encontrada por um
 * teste: entidade, família, tipo e coincidência de calendário somam exatamente
 * 0,6 sozinhos. Sem este portão, dois campos sem nenhuma relação de nome que
 * por acaso trocassem de lugar na mesma vigência — `tipoImplemento` entrando
 * quando `kmVolta` some — seriam oferecidos como renomeação um do outro, com a
 * confiança bem no limiar. Renomear é, antes de tudo, manter o nome quase
 * igual; sem essa parte, o que sobra é coincidência com aparência de evidência.
 */
export const SEMELHANCA_MINIMA = 0.5;

/** Um atributo, do jeito que a detecção precisa dele. */
export interface AtributoParaComparar {
  attributeCode: string;
  entityType: string;
  dataType: string;
  datasetFamily: string;
  /** A vigência em que apareceu pela primeira vez. */
  primeiraVigencia: string;
  /** A última vigência em que apareceu; null se ainda aparece. */
  ultimaVigencia: string | null;
  /** Se parou de aparecer, a vigência seguinte à última. */
  desapareceuEm: string | null;
}

/**
 * O provável antecessor de um atributo novo, entre os que sumiram.
 *
 * Puro: recebe listas e devolve o melhor candidato. É assim que o teste de
 * "renomeação não vira ausência definitiva" roda sem banco e sem export.
 */
export function candidatoPara(
  novo: AtributoParaComparar,
  sumidos: AtributoParaComparar[],
): CandidatoARenomeacao | null {
  let melhor: CandidatoARenomeacao | null = null;

  for (const antigo of sumidos) {
    if (antigo.attributeCode === novo.attributeCode) continue;

    const motivos: string[] = [];
    let confianca = 0;

    const semelhanca = semelhancaDeNome(novo.attributeCode, antigo.attributeCode);
    /* O portão. Ver `SEMELHANCA_MINIMA`: sem nome parecido não há renomeação. */
    if (semelhanca < SEMELHANCA_MINIMA) continue;
    confianca += PESOS.nome * semelhanca;
    motivos.push(
      `nomes semelhantes (${Math.round(semelhanca * 100)}% de radical em comum)`,
    );
    if (antigo.entityType === novo.entityType) {
      confianca += PESOS.entidade;
      motivos.push(`mesma entidade (${novo.entityType.toLowerCase()})`);
    }
    if (antigo.datasetFamily === novo.datasetFamily) {
      confianca += PESOS.familia;
      motivos.push("mesma família");
    }
    if (antigo.dataType === novo.dataType) {
      confianca += PESOS.tipo;
      motivos.push(`mesmo tipo de dado (${novo.dataType.toLowerCase()})`);
    }
    /*
      O sinal mais forte, e o menos óbvio: o antigo parou de aparecer na mesma
      vigência em que o novo apareceu. Coincidência de calendário é o que
      distingue "renomearam" de "acrescentaram mais um campo parecido".
    */
    if (antigo.desapareceuEm && antigo.desapareceuEm === novo.primeiraVigencia) {
      confianca += PESOS.substituicao;
      motivos.push(
        `o campo anterior deixou de aparecer exatamente quando este surgiu (${novo.primeiraVigencia})`,
      );
    }

    const arredondada = Number(confianca.toFixed(4));
    if (arredondada < LIMIAR_DE_CANDIDATURA) continue;
    if (!melhor || arredondada > melhor.confianca) {
      melhor = { attributeCode: antigo.attributeCode, confianca: arredondada, motivos };
    }
  }

  return melhor;
}

/**
 * O filtro por onde uma tela pede descobertas — e que **não** é o recorte.
 *
 * Os três campos podem casar com mais de uma série, e é por isso que quem os
 * recebe (`descobertas`) resolve a lista antes de medir qualquer coisa: uma
 * medição por série, nunca uma medição sobre a união delas.
 */
export interface FiltroDeDescoberta {
  datasetFamily?: string;
  scopeHash?: string;
  canal?: string | null;
}

/**
 * Os atributos com a sua janela de aparição, lidos do layout **de uma série**.
 *
 * `desapareceuEm` é a vigência seguinte à última em que a coluna apareceu — e é
 * nula quando ela apareceu na última vigência da série, porque aí ela não
 * desapareceu: ela ainda está lá.
 *
 * **A série é obrigatória, e é a divergência B8 da auditoria.** Aqui o recorte
 * era opcional, e a consulta particionava por `dataset_family` — sem escopo e
 * sem canal. Um atributo que a unidade A passou a entregar em março virava
 * "novidade de março" também para a unidade B, que nunca ouviu falar dele: a
 * cobertura de B ficava `NOVO` por causa de um dado que não é dela, e a
 * sugestão de renomeação cruzava unidades. O chamador que não sabia disso —
 * `detalhe.ts`, passando só a família — não tinha como errar de propósito;
 * agora não tem como errar por omissão.
 */
export async function janelaDosAtributos(
  db: Database,
  serie: ChaveDeSerie,
): Promise<AtributoParaComparar[]> {
  const { rows } = await db.execute<{
    code: string;
    entity_type: string;
    data_type: string;
    dataset_family: string;
    primeira: string;
    ultima: string;
    desapareceu_em: string | null;
  }>(sql`
    WITH vigencias AS (
      /*
        Uma linha por vigência da série, em ordem, com a data da seguinte.

        O DISTINCT ON e o PARTITION BY eram por dataset_family só — o que
        colapsava duas unidades na mesma data e fazia a janela de um atributo
        contar aparições que não eram da série. Agora o recorte é a série
        inteira, aplicada no WHERE, e dentro dela effective_date já é único
        por construção: o índice de identidade canônica não admite duas
        vigências ativas da mesma série na mesma data.
      */
      SELECT s.id, s.effective_date, s.dataset_family,
             lead(s.effective_date) OVER (ORDER BY s.effective_date) AS proxima
        FROM snapshot s
       WHERE ${filtroDeVigenciaDisponivel("s")}
         AND ${filtroDeSerie(serie, "s")}
    ),
    presenca AS (
      SELECT a.code, a.entity_type, a.data_type, v.dataset_family,
             v.effective_date, v.proxima
        FROM snapshot_attribute sa
        JOIN vigencias v ON v.id = sa.snapshot_id
        JOIN attribute a ON a.id = sa.attribute_id
       WHERE sa.present_in_layout
    )
    SELECT code, entity_type, data_type, dataset_family,
           min(effective_date)::text                                          AS primeira,
           max(effective_date)::text                                          AS ultima,
           (array_agg(proxima ORDER BY effective_date DESC))[1]::text          AS desapareceu_em
      FROM presenca
     GROUP BY code, entity_type, data_type, dataset_family
     ORDER BY code
  `);

  return rows.map((r) => ({
    attributeCode: r.code,
    entityType: r.entity_type,
    dataType: r.data_type,
    datasetFamily: r.dataset_family,
    primeiraVigencia: r.primeira,
    ultimaVigencia: r.ultima,
    desapareceuEm: r.desapareceu_em,
  }));
}

/** A vigência mais recente de uma série, ou null se ela não tem nenhuma. */
async function ultimaVigencia(
  db: Database,
  serie: ChaveDeSerie,
): Promise<string | null> {
  const { rows } = await db.execute<{ ultima: string | null }>(sql`
    SELECT max(s.effective_date)::text AS ultima
      FROM snapshot s
     WHERE ${filtroDeVigenciaDisponivel("s")}
       AND ${filtroDeSerie(serie, "s")}
  `);
  return rows[0]?.ultima ?? null;
}

export interface OpcoesDeDescoberta {
  /** O corte do "recentemente". O padrão é a última vigência da série. */
  desdeVigencia?: string;
  limite?: number;
}

/**
 * As descobertas de **uma** série, com proveniência e candidato a renomeação.
 *
 * "Recentemente" é definido por `desdeVigencia` — sem ele, tudo o que existe é
 * uma descoberta, o que é verdade no primeiro dia e ruído depois. O padrão é a
 * vigência mais recente da série.
 */
export async function descobertasDaSerie(
  db: Database,
  serie: ChaveDeSerie,
  opcoes: OpcoesDeDescoberta = {},
): Promise<Descoberta[]> {
  const janelas = await janelaDosAtributos(db, serie);
  if (janelas.length === 0) return [];

  /*
    O corte padrão é a **última vigência da série**, e não a última primeira
    aparição.

    A diferença não é sutil: num export estável, em que todas as colunas
    estrearam juntas na primeira vigência, a segunda leitura faz de todas elas
    uma "descoberta recente" — 138 novidades num export que não mudou nada. O
    corte tem de ser a fronteira do tempo, não a do dicionário.
  */
  const corte = opcoes.desdeVigencia ?? (await ultimaVigencia(db, serie));
  if (corte === null) return [];

  const novos = janelas.filter((j) => j.primeiraVigencia >= corte);
  if (novos.length === 0) return [];

  /*
    O universo de comparação é o que sumiu, e "sumiu" quer dizer: apareceu antes
    do corte e não aparece mais. Comparar contra tudo faria todo campo novo
    receber um candidato — e um candidato que sempre existe não informa nada.
  */
  const sumidos = janelas.filter(
    (j) => j.desapareceuEm !== null && j.primeiraVigencia < corte,
  );

  const codigos = novos.map((n) => n.attributeCode);
  const { rows: detalhes } = await db.execute<{
    code: string;
    display_name: string | null;
    source_name: string;
    import_run_id: string | null;
    filename: string | null;
    entidades: number;
    primeiro_rotulo: string | null;
    decidido: boolean;
  }>(sql`
    SELECT a.code,
           a.display_name,
           a.source_name,
           a.first_seen_import_run_id::text                     AS import_run_id,
           sf.filename,
           /*
             As duas subconsultas abaixo também eram sem recorte, e é o mesmo
             defeito visto de outro ângulo: a descoberta era da série, e as
             entidades afetadas e o rótulo da estreia vinham do banco inteiro.
             Uma novidade de Camaçari relatava a frota de Manaus junto.
           */
           coalesce((
             SELECT sum(sa.value_count + sa.null_count)
               FROM snapshot_attribute sa
               JOIN snapshot s ON s.id = sa.snapshot_id
                              AND ${filtroDeVigenciaDisponivel("s")}
                              AND ${filtroDeSerie(serie, "s")}
              WHERE sa.attribute_id = a.id
           ), 0)::int                                           AS entidades,
           (SELECT s.source_label
              FROM snapshot_attribute sa
              JOIN snapshot s ON s.id = sa.snapshot_id
                             AND ${filtroDeVigenciaDisponivel("s")}
                             AND ${filtroDeSerie(serie, "s")}
             WHERE sa.attribute_id = a.id
             ORDER BY s.effective_date LIMIT 1)                  AS primeiro_rotulo,
           EXISTS (
             SELECT 1 FROM coverage_expectation ce
              WHERE ce.origin = 'CURADORIA'
                AND (ce.attribute_code = a.code OR ce.succeeded_by_attribute_code = a.code)
           )                                                     AS decidido
      FROM attribute a
      LEFT JOIN import_run ir ON ir.id = a.first_seen_import_run_id
      LEFT JOIN source_file sf ON sf.id = ir.source_file_id
     WHERE a.code = ANY(${sql`ARRAY[${sql.join(
       codigos.map((c) => sql`${c}::text`),
       sql`, `,
     )}]`})
  `);

  const porCodigo = new Map(detalhes.map((d) => [d.code, d]));

  return novos
    .map((n) => {
      const d = porCodigo.get(n.attributeCode);
      return {
        attributeCode: n.attributeCode,
        attributeLabel: d?.display_name ?? d?.source_name ?? n.attributeCode,
        sourceName: d?.source_name ?? n.attributeCode,
        entityType: n.entityType,
        dataType: n.dataType,
        datasetFamily: n.datasetFamily,
        primeiraVigencia: n.primeiraVigencia,
        primeiroRotulo: d?.primeiro_rotulo ?? n.primeiraVigencia,
        importRunId: d?.import_run_id ?? null,
        arquivo: d?.filename ?? null,
        entidadesAfetadas: Number(d?.entidades ?? 0),
        possivelSucessaoDe: candidatoPara(n, sumidos),
        statusDeCuradoria: (d?.decidido ? "DECIDIDO" : "PENDENTE") as
          | "PENDENTE"
          | "DECIDIDO",
      };
    })
    .sort(
      (a, b) =>
        (b.possivelSucessaoDe?.confianca ?? 0) - (a.possivelSucessaoDe?.confianca ?? 0) ||
        a.attributeCode.localeCompare(b.attributeCode),
    )
    .slice(0, opcoes.limite ?? 100);
}

/**
 * As descobertas de um filtro — **uma medição por série**, nunca sobre a união.
 *
 * Este é o único lugar do módulo que aceita um recorte incompleto, e ele o
 * aceita resolvendo: o filtro vira uma lista de séries e cada uma é medida
 * sozinha. Sem essa separação, "todas as descobertas" seria uma consulta sobre
 * o banco inteiro, e uma novidade da unidade A apareceria datada na série da
 * unidade B — que é a divergência B8.
 *
 * `limite` é aplicado **por série**, e não ao total: cortar o total faria a
 * segunda unidade sumir da lista quando a primeira tivesse novidades demais.
 */
export async function descobertas(
  db: Database,
  filtro: FiltroDeDescoberta & OpcoesDeDescoberta = {},
): Promise<Descoberta[]> {
  const { datasetFamily, scopeHash, canal, ...opcoes } = filtro;
  const vigencias = await vigenciasObservadas(db, { datasetFamily, scopeHash, canal });
  const series = [...new Set(vigencias.map((v) => v.serie))];

  const porSerie = await Promise.all(
    series.map((serie) => descobertasDaSerie(db, serie, opcoes)),
  );
  return porSerie.flat();
}
