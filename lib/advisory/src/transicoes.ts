import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { contextFilter, type SeriesContext } from "@workspace/comparison";
import type { TransicoesDoParametro } from "./recomendacao";

/**
 * As transições de valor, agrupadas pelo par (antes, depois) e pela vigência.
 *
 * **Por que esta consulta existe, sendo que o panorama já conta alterações.**
 * O panorama responde *quantas* mudanças houve e *quanto* a coluna se moveu
 * entre as duas pontas. Nenhuma das duas coisas produz a frase que vai para o
 * cliente: "de 8,2 para 9,1 em EMPURRADA_2_7_2026, em 73 veículos". Para isso
 * é preciso o par de valores e a vigência em que ele apareceu — que é um grão
 * que nenhuma leitura existente carrega.
 *
 * Não é uma segunda régua financeira, e não soma dinheiro: ela conta ativos por
 * transição. O dinheiro continua vindo de `variacao.preco`, apurado pelo
 * panorama sob o portão de semântica.
 *
 * **Duas decisões que o dado real obrigou.**
 *
 * A célula vazia **quebra a cadeia** em vez de ser pulada, igual a
 * `panorama.ts` e a `impacto.ts`: sair de um valor para uma célula vazia é
 * ausência, não mudança de preço, e voltar a ter valor depois são duas
 * aparições com um buraco no meio. Pular o vazio inventaria uma transição que a
 * matriz do segundo nível não mostra.
 *
 * O **zero, ao contrário, é contado** — e contado à parte. Neste export a fonte
 * escreve zero onde quer dizer "não informado": `lucroVariavelPrevistoCavalo`
 * tem 107 de 107 transições com zero de um dos lados, alternando entre um único
 * valor e nada. Filtrar o zero esconderia o sintoma; tratá-lo como preço
 * produziria uma proposta de recompor R$ 23 mil que ninguém tirou. Ele entra,
 * e `comZero` é o que permite à avaliação reconhecer a coluna intermitente.
 */
export async function medirTransicoes(
  db: Database,
  context: SeriesContext,
  codes: string[],
): Promise<Map<string, TransicoesDoParametro>> {
  if (codes.length === 0) return new Map();

  /*
    O `ARRAY[…]` explícito é o mesmo caminho de `panorama.ts`: o driver `pg`
    transforma um array JS interpolado numa lista de parâmetros, que o Postgres
    recusa no `= ANY (…)`.
  */
  const lista = sql`ARRAY[${sql.join(
    codes.map((c) => sql`${c}`),
    sql`, `,
  )}]::text[]`;

  const [{ rows }, { rows: oscilantes }] = await Promise.all([
    db.execute<{
      code: string;
      effective_date: string;
      source_label: string;
      antes: string;
      depois: string;
      entidades: number;
    }>(sql`
    WITH serie AS (
      SELECT a.code,
             f.entity_id,
             s.effective_date,
             CASE WHEN f.is_null THEN NULL ELSE f.value_numeric END AS valor,
             LAG(CASE WHEN f.is_null THEN NULL ELSE f.value_numeric END) OVER (
               PARTITION BY f.entity_id, f.attribute_id
               ORDER BY s.effective_date
             ) AS anterior
        FROM fact f
        JOIN snapshot s  ON s.id = f.snapshot_id
        JOIN attribute a ON a.id = f.attribute_id
       WHERE a.data_type = 'NUMERIC'
         AND a.code = ANY (${lista})
         AND s.status <> 'SUPERSEDED'
         AND ${contextFilter("s", context)}
    )
    SELECT serie.code,
           serie.effective_date::text AS effective_date,
           string_agg(DISTINCT s.source_label, ' · ') AS source_label,
           serie.anterior::text AS antes,
           serie.valor::text    AS depois,
           COUNT(DISTINCT serie.entity_id)::int AS entidades
      FROM serie
      JOIN snapshot s ON s.effective_date = serie.effective_date
                     AND s.status <> 'SUPERSEDED'
                     AND ${contextFilter("s", context)}
     WHERE serie.anterior IS NOT NULL
       AND serie.valor IS NOT NULL
       AND serie.valor <> serie.anterior
     GROUP BY 1, 2, 4, 5
     ORDER BY 1, 6 DESC
  `),

    /*
      Os ativos que voltam a ter valor depois de zerar.

      A conta é sobre a **linha zerada**: ela conta como oscilação quando existe
      valor não nulo antes dela e depois dela, na série do mesmo ativo. Escrito
      assim a ordem entre os dois é garantida pelas janelas — uma olhando para
      trás, outra para a frente —, e um ativo que só liga (`0, 0, 21`) ou só
      desliga (`7937, 0, 0`) não entra, que é exatamente a diferença entre uma
      coluna que pisca e um evento de ciclo de vida.
    */
    db.execute<{ code: string; ativos: number }>(sql`
      WITH serie AS (
        SELECT a.code,
               f.entity_id,
               s.effective_date,
               f.value_numeric AS valor
          FROM fact f
          JOIN snapshot s  ON s.id = f.snapshot_id
          JOIN attribute a ON a.id = f.attribute_id
         WHERE a.data_type = 'NUMERIC'
           AND a.code = ANY (${lista})
           AND NOT f.is_null
           AND f.value_numeric IS NOT NULL
           AND s.status <> 'SUPERSEDED'
           AND ${contextFilter("s", context)}
      ),
      marcado AS (
        SELECT code, entity_id, valor,
               bool_or(valor <> 0) OVER (
                 PARTITION BY code, entity_id ORDER BY effective_date
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ) AS valor_antes,
               bool_or(valor <> 0) OVER (
                 PARTITION BY code, entity_id ORDER BY effective_date
                 ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING
               ) AS valor_depois
          FROM serie
      )
      SELECT code, COUNT(DISTINCT entity_id)::int AS ativos
        FROM marcado
       WHERE valor = 0 AND valor_antes AND valor_depois
       GROUP BY 1
    `),
  ]);

  const oscilamPorCodigo = new Map(
    oscilantes.map((o) => [o.code, Number(o.ativos)]),
  );

  const porCodigo = new Map<string, TransicoesDoParametro>();
  for (const r of rows) {
    let atual = porCodigo.get(r.code);
    if (!atual) {
      atual = {
        code: r.code,
        total: 0,
        comZero: 0,
        ativosQueOscilam: oscilamPorCodigo.get(r.code) ?? 0,
        padroes: [],
      };
      porCodigo.set(r.code, atual);
    }
    const antes = Number(r.antes);
    const depois = Number(r.depois);
    const entidades = Number(r.entidades);

    atual.total += entidades;
    if (antes === 0 || depois === 0) atual.comZero += entidades;
    atual.padroes.push({
      effectiveDate: r.effective_date,
      sourceLabel: r.source_label,
      antes,
      depois,
      entidades,
    });
  }

  return porCodigo;
}
