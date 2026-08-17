import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { contextFilter, type SeriesContext } from "@workspace/comparison";

/**
 * O que mudou **neste ativo** — a ponte entre a pauta e a tela de um cavalo só.
 *
 * A aba Cliente é a única das quatro de Alterações que fala de parâmetros, e
 * não de ativos: a recomendação é sobre a coluna, e o que sustenta o pedido é a
 * abrangência dela — "o FINAME caiu em 41 cavalos" é pauta de reunião, e a mesma
 * linha recortada num ativo diria "caiu em 1", que é a mesma alteração com o
 * argumento desmontado.
 *
 * Isso justifica manter os **números** em nível de frota. Não justifica listar,
 * dentro de uma tela chamada `Cavalo 360° · QYP3G72`, uma pauta em que aquela
 * placa pode nem aparecer entre os afetados. As duas coisas são separáveis, e
 * esta consulta é a separação: ela responde *quais códigos se moveram nesta
 * placa*, e o motor usa isso para escolher **o que entra na lista** — cada item
 * continua trazendo o alcance, o impacto e a evidência da frota inteira.
 *
 * **Não recorta o panorama, e é de propósito.** Refazer a leitura financeira por
 * placa traria de volta as parcelas cujo total está no outro equipamento — a
 * mesma recusa que `motor.ts` já pratica ao filtrar por equipamento em vez de
 * reconsultar. Aqui não há dinheiro nenhum sendo somado: entra uma placa, sai um
 * conjunto de códigos.
 *
 * O grão é o mesmo de `medirTransicoes`: `NUMERIC`, célula vazia quebrando a
 * cadeia — sair de um valor para uma célula vazia é ausência, não mudança — e o
 * zero contando como valor, porque é assim que a fonte escreve "não informado" e
 * é isso que o resto da avaliação já lê.
 */
export interface AlteracoesDoAtivo {
  /**
   * A placa como o banco a guarda, ou `null` quando ela não existe no recorte.
   *
   * Não encontrada, a leitura segue pela frota inteira — a mesma recusa a
   * transformar escolha inválida em erro que `impacto.ts` pratica. E é por isso
   * que o campo volta na resposta: sem ele, a tela mostraria a pauta dos cavalos
   * acreditando ser a de um deles, que é o silêncio caro.
   */
  placa: string | null;
  /** Os códigos que mudaram de valor neste ativo dentro do recorte. */
  codigos: Set<string>;
}

export async function medirAlteracoesDoAtivo(
  db: Database,
  context: SeriesContext,
  placa: string,
): Promise<AlteracoesDoAtivo> {
  const pedida = placa.trim().toUpperCase();
  if (pedida === "") return { placa: null, codigos: new Set() };

  /*
    A placa chega de um endereço que alguém pode ter digitado ou colado, e o
    identificador é gravado normalizado — ver `entity_identifier` em
    `canonical.ts`. Comparar em caixa alta é o mesmo que `impacto.ts` faz para
    resolver o ativo pedido.
  */
  const { rows: ativos } = await db.execute<{
    entity_id: string;
    identifier_value: string;
  }>(sql`
    SELECT ei.entity_id::text AS entity_id, ei.identifier_value
      FROM entity_identifier ei
     WHERE ei.identifier_type = 'PLACA'
       AND ei.is_current
       AND upper(ei.identifier_value) = ${pedida}
     LIMIT 1
  `);

  const ativo = ativos[0];
  if (!ativo) return { placa: null, codigos: new Set() };

  const { rows } = await db.execute<{ code: string }>(sql`
    WITH serie AS (
      SELECT a.code,
             CASE WHEN f.is_null THEN NULL ELSE f.value_numeric END AS valor,
             LAG(CASE WHEN f.is_null THEN NULL ELSE f.value_numeric END) OVER (
               PARTITION BY f.attribute_id
               ORDER BY s.effective_date
             ) AS anterior
        FROM fact f
        JOIN snapshot s  ON s.id = f.snapshot_id
        JOIN attribute a ON a.id = f.attribute_id
       WHERE a.data_type = 'NUMERIC'
         AND f.entity_id = ${ativo.entity_id}::uuid
         AND s.status <> 'SUPERSEDED'
         AND ${contextFilter("s", context)}
    )
    SELECT DISTINCT code
      FROM serie
     WHERE anterior IS NOT NULL
       AND valor IS NOT NULL
       AND valor <> anterior
  `);

  return {
    placa: ativo.identifier_value,
    codigos: new Set(rows.map((r) => r.code)),
  };
}
