import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { contextFilter } from "./series";
import type { SeriesContext } from "./series";

/**
 * O que mudou **neste ativo** — quais colunas se moveram numa placa.
 *
 * Uma pergunta pequena, e duas telas a fazem por motivos diferentes.
 *
 * **A aba Cliente** fala de parâmetros, e não de ativos: a recomendação é sobre
 * a coluna, e o que sustenta o pedido é a abrangência dela — "o FINAME caiu em
 * 41 cavalos" é pauta de reunião, e a mesma linha recortada num ativo diria
 * "caiu em 1", que é a mesma alteração com o argumento desmontado. Isso
 * justifica manter os **números** em nível de frota; não justifica listar, numa
 * tela chamada `Cavalo 360° · QYP3G72`, uma pauta em que aquela placa pode nem
 * aparecer entre os afetados. Esta consulta é a separação entre as duas coisas:
 * ela decide **o que entra na lista**, e cada item continua trazendo o alcance,
 * o impacto e a evidência da frota inteira.
 *
 * **A aba Impacto** já lista todos os parâmetros do equipamento no seletor — o
 * que ela não sabia dizer é quais deles mexeram no ativo aberto, e sem isso
 * achar a coluna que mudou custa abrir uma por uma. Aqui a resposta não estreita
 * nada: ela ordena, e o resto da lista continua a um rolar de distância.
 *
 * **Não recorta o panorama, e é de propósito.** Refazer a leitura financeira por
 * placa traria de volta as parcelas cujo total está no outro equipamento — a
 * mesma recusa que o motor da aba Cliente pratica ao filtrar por equipamento em
 * vez de reconsultar. Aqui não há dinheiro nenhum sendo somado: entra uma placa,
 * sai um conjunto de códigos.
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
  /**
   * O movimento do próprio ativo, por código, da vigência mais antiga à mais
   * recente.
   *
   * É o dado que faltava para a tela de um cavalo só. O cartão da pauta dizia
   * "29 favorecidos · 7 prejudicados" e não dizia de que lado **este** cavalo
   * caiu — a pergunta que quem abre `Cavalo 360°` faz primeiro, e a única que a
   * leitura de frota não pode responder por construção.
   *
   * Vem a série inteira, e não um par só: o cartão escolhe a vigência que casa
   * com a evidência que ele já mostra, e cai na última quando não há casamento.
   * Escolher aqui obrigaria esta consulta a conhecer a evidência do cartão.
   */
  transicoes: Map<string, TransicaoDoAtivo[]>;
}

/** Um movimento do ativo: de quanto para quanto, e em qual vigência. */
export interface TransicaoDoAtivo {
  code: string;
  effectiveDate: string;
  sourceLabel: string;
  antes: number;
  depois: number;
}

export async function medirAlteracoesDoAtivo(
  db: Database,
  context: SeriesContext,
  placa: string,
): Promise<AlteracoesDoAtivo> {
  const vazio = (): AlteracoesDoAtivo => ({
    placa: null,
    codigos: new Set(),
    transicoes: new Map(),
  });

  const pedida = placa.trim().toUpperCase();
  if (pedida === "") return vazio();

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
  if (!ativo) return vazio();

  /*
    O `source_label` sai de um `string_agg` porque a mesma data pode ter vindo em
    mais de um arquivo — é o mesmo tratamento de `medirTransicoes`, e o motivo é
    o mesmo: o nome da fonte é o que se procura na planilha depois da reunião.
  */
  const { rows } = await db.execute<{
    code: string;
    effective_date: string;
    source_label: string;
    antes: string;
    depois: string;
  }>(sql`
    WITH serie AS (
      SELECT a.code,
             s.effective_date,
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
         AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
         AND ${contextFilter("s", context)}
    )
    SELECT serie.code,
           serie.effective_date::text AS effective_date,
           string_agg(DISTINCT s.source_label, ' · ') AS source_label,
           serie.anterior::text AS antes,
           serie.valor::text    AS depois
      FROM serie
      JOIN snapshot s ON s.effective_date = serie.effective_date
                     AND s.status <> 'SUPERSEDED'
                     AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
                     AND ${contextFilter("s", context)}
     WHERE serie.anterior IS NOT NULL
       AND serie.valor IS NOT NULL
       AND serie.valor <> serie.anterior
     GROUP BY 1, 2, 4, 5
     ORDER BY 1, 2
  `);

  const transicoes = new Map<string, TransicaoDoAtivo[]>();
  for (const r of rows) {
    const lista = transicoes.get(r.code) ?? [];
    lista.push({
      code: r.code,
      effectiveDate: r.effective_date,
      sourceLabel: r.source_label,
      antes: Number(r.antes),
      depois: Number(r.depois),
    });
    transicoes.set(r.code, lista);
  }

  return {
    placa: ativo.identifier_value,
    codigos: new Set(transicoes.keys()),
    transicoes,
  };
}
