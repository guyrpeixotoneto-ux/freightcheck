import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";

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
 * O recorte em que uma descoberta é uma descoberta.
 *
 * **O escopo não é opcional por elegância — é correção.** Sem ele, um atributo
 * que a unidade A passou a entregar em março marcaria como "novidade de março"
 * também a unidade B, que nunca ouviu falar dele. A cobertura de B ficaria
 * `NOVO` por causa de um dado que não é dela, e o operador de B abriria a seção
 * de novidades para encontrar uma lista de coisas de outra unidade. Foi um
 * teste de isolamento de escopo que encontrou isso.
 */
export interface RecorteDaDescoberta {
  datasetFamily?: string;
  scopeHash?: string;
  canal?: string | null;
}

/**
 * Os atributos com a sua janela de aparição, lidos do layout.
 *
 * `desapareceuEm` é a vigência seguinte à última em que a coluna apareceu — e é
 * nula quando ela apareceu na última vigência da série, porque aí ela não
 * desapareceu: ela ainda está lá.
 */
export async function janelaDosAtributos(
  db: Database,
  recorte: RecorteDaDescoberta = {},
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
      SELECT s.id, s.effective_date, s.dataset_family,
             lead(s.effective_date) OVER (PARTITION BY s.dataset_family ORDER BY s.effective_date)
               AS proxima
        FROM (SELECT DISTINCT ON (dataset_family, effective_date)
                     id, effective_date, dataset_family
                FROM snapshot
               WHERE status <> 'SUPERSEDED'
               AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = import_run_id AND import_run.hidden_at IS NOT NULL)
                 AND (${recorte.datasetFamily ?? null}::text IS NULL
                      OR dataset_family = ${recorte.datasetFamily ?? null})
                 AND (${recorte.scopeHash ?? null}::text IS NULL
                      OR scope_hash = ${recorte.scopeHash ?? null})
                 AND (${recorte.canal === undefined ? null : recorte.canal}::text IS NULL
                      OR canal = ${recorte.canal === undefined ? null : recorte.canal})
               ORDER BY dataset_family, effective_date, revision DESC) s
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

/** A vigência mais recente de um recorte, ou null se ele não tem nenhuma. */
async function ultimaVigencia(
  db: Database,
  recorte: RecorteDaDescoberta,
): Promise<string | null> {
  const { rows } = await db.execute<{ ultima: string | null }>(sql`
    SELECT max(effective_date)::text AS ultima
      FROM snapshot
     WHERE status <> 'SUPERSEDED'
     AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = import_run_id AND import_run.hidden_at IS NOT NULL)
       AND (${recorte.datasetFamily ?? null}::text IS NULL
            OR dataset_family = ${recorte.datasetFamily ?? null})
       AND (${recorte.scopeHash ?? null}::text IS NULL
            OR scope_hash = ${recorte.scopeHash ?? null})
       AND (${recorte.canal === undefined ? null : recorte.canal}::text IS NULL
            OR canal = ${recorte.canal === undefined ? null : recorte.canal})
  `);
  return rows[0]?.ultima ?? null;
}

/**
 * Os atributos descobertos recentemente, com proveniência e candidato.
 *
 * "Recentemente" é definido por `desdeVigencia` — sem ele, tudo o que existe é
 * uma descoberta, o que é verdade no primeiro dia e ruído depois. O padrão é a
 * vigência mais recente da série.
 */
export async function descobertas(
  db: Database,
  opcoes: RecorteDaDescoberta & { desdeVigencia?: string; limite?: number } = {},
): Promise<Descoberta[]> {
  const janelas = await janelaDosAtributos(db, opcoes);
  if (janelas.length === 0) return [];

  /*
    O corte padrão é a **última vigência da série**, e não a última primeira
    aparição.

    A diferença não é sutil: num export estável, em que todas as colunas
    estrearam juntas na primeira vigência, a segunda leitura faz de todas elas
    uma "descoberta recente" — 138 novidades num export que não mudou nada. O
    corte tem de ser a fronteira do tempo, não a do dicionário.
  */
  const corte = opcoes.desdeVigencia ?? (await ultimaVigencia(db, opcoes));
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
           coalesce((
             SELECT sum(sa.value_count + sa.null_count)
               FROM snapshot_attribute sa
               JOIN snapshot s ON s.id = sa.snapshot_id AND s.status <> 'SUPERSEDED'
               AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
              WHERE sa.attribute_id = a.id
           ), 0)::int                                           AS entidades,
           (SELECT s.source_label
              FROM snapshot_attribute sa
              JOIN snapshot s ON s.id = sa.snapshot_id AND s.status <> 'SUPERSEDED'
              AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
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
