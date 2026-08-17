import { sql } from "drizzle-orm";
import type { Database } from "./index";

/**
 * Todo atributo tem uma versão de semântica, desde o primeiro dia da série.
 *
 * ---------------------------------------------------------------------------
 * O buraco que este módulo fecha
 * ---------------------------------------------------------------------------
 * `attribute` e `attribute_semantics` são a mesma verdade em dois formatos: a
 * segunda é o que a coluna significou ao longo do tempo da fonte, a primeira é
 * a projeção da versão em vigor. Só que elas tinham **donos diferentes**. A
 * promoção cria o atributo; a versão 1 nascia num lote — `backfillSemantics` —
 * que mora na curadoria e que nada, em produção, chamava. Ele é chamado pelo
 * `dev-seed` e pelos testes, e por mais ninguém.
 *
 * O efeito medido num banco com o export real promovido e nenhuma curadoria:
 * **138 atributos, 138 sem versão**. Não é o caso de uma coluna — é o de todas.
 * E o sintoma que apareceu na tela foi o menor deles: "fórmula de cálculo" mora
 * só na linha versionada, então gravá-la era recusado com um pedido de backfill
 * que ninguém tinha como atender pela interface.
 *
 * O que ficava quieto era pior. A comparação resolve unidade, periodicidade e
 * base de cálculo lendo a versão em vigor na data de cada vigência; sem
 * nenhuma linha, ela cai na projeção e **nenhuma mudança de semântica da fonte
 * é detectável**. O caso que justificou a tabela inteira — o IPVA trocando de
 * base de cálculo duas vezes sem trocar de unidade — passaria batido num banco
 * onde a tabela está vazia.
 *
 * ---------------------------------------------------------------------------
 * Por que isto não inventa semântica
 * ---------------------------------------------------------------------------
 * A versão 1 criada aqui **copia o atributo e nada mais**: unidade,
 * periodicidade, agregação, monetário, taxonomia, status, definição — os
 * mesmos valores, que num atributo recém-importado são todos nulos e
 * `UNKNOWN`. Ela não afirma que a coluna é mensal, nem que é dinheiro, nem que
 * alguém a conferiu. Ela afirma uma coisa só, que é verdade por construção:
 * *este é o trecho da série sobre o qual o que sabemos é isto* — inclusive
 * quando o que sabemos é nada.
 *
 * `change_origin` fica `INITIAL`, e é o que impede a linha de virar notícia:
 * a comparação só emite `SEMANTICS_CHANGE` para versões com origem
 * `SOURCE_SEMANTICS_CHANGE`. Um atributo com uma versão só nunca é
 * incompatível consigo mesmo, então nenhuma comparação existente muda de
 * número por causa desta função.
 *
 * `calculation_basis` nasce nula de propósito, e é a única coisa que a versão
 * **não** copia do atributo: não existe esse campo em `attribute`, ninguém o
 * escreveu ainda, e preenchê-lo com um palpite seria exatamente a invenção que
 * este módulo não pode fazer.
 */

export interface SemanticaInicialResult {
  /** Versões 1 criadas agora. Zero é o estado saudável de um banco em dia. */
  criadas: number;
  /**
   * Versões iniciais cujo começo foi puxado para trás (ou para a frente) até o
   * início da série. Ver {@link garantirSemanticaInicial}.
   */
  ajustadas: number;
  /** O início da série considerado nesta passada. */
  inicio: string;
}

/**
 * Onde a série começa: a vigência mais antiga que o banco conhece.
 *
 * Sem nenhuma vigência ainda, qualquer data que preceda tudo serve — e é o que
 * acontece num banco que ganhou atributos por fixture antes de ganhar dados.
 * A passada seguinte, já com vigências, normaliza o começo para a real.
 */
const INICIO_SEM_VIGENCIA = "1970-01-01";

/**
 * Garante a invariante, e devolve o que precisou fazer para isso.
 *
 * Idempotente: numa base em dia não escreve nada e responde `{criadas: 0,
 * ajustadas: 0}`. É seguro chamá-la em toda promoção, e é para isso que ela
 * existe — a versão passa a nascer junto do atributo, na mesma transação, em
 * vez de depender de alguém lembrar de rodar um lote depois.
 *
 * **O ajuste do começo.** A versão inicial precisa cobrir a série *inteira*,
 * não o pedaço que existia quando o atributo apareceu. Uma importação
 * retroativa — um arquivo de um mês anterior chegando depois — deixaria toda
 * versão 1 começando tarde demais, e a comparação daquela vigência antiga
 * deixaria de resolver semântica silenciosamente. Por isso o começo da versão
 * inicial é sempre reescrito para o início da série.
 *
 * Só a versão inicial se move, e só quando isso não atropela nada: `version = 1`,
 * `change_origin = 'INITIAL'`, e nunca para depois do fim dela própria. Uma
 * versão aberta por mudança da fonte tem uma data que **significa** alguma
 * coisa — a vigência em que a Ambev mudou a regra — e essa nunca é tocada.
 */
export async function garantirSemanticaInicial(
  db: Database,
): Promise<SemanticaInicialResult> {
  const { rows: series } = await db.execute<{ inicio: string | null }>(sql`
    SELECT min(effective_date)::text AS inicio FROM snapshot
  `);
  const inicio = series[0]?.inicio ?? INICIO_SEM_VIGENCIA;

  const { rowCount: criadas } = await db.execute(sql`
    INSERT INTO attribute_semantics (
      attribute_id, version, effective_from, effective_until,
      unit, periodicity, aggregation, is_monetary, taxonomy_node_id,
      calculation_basis, definition,
      semantics_status, confirmed_by, confirmed_at, rationale, change_origin
    )
    SELECT a.id, 1, ${inicio}::date, NULL,
           a.unit, a.periodicity, a.aggregation, a.is_monetary, a.taxonomy_node_id,
           NULL, a.definition,
           a.semantics_status::text, a.confirmed_by, a.confirmed_at,
           a.semantics_rationale, 'INITIAL'
      FROM attribute a
     WHERE NOT EXISTS (
             SELECT 1 FROM attribute_semantics v WHERE v.attribute_id = a.id
           )
  `);

  const { rowCount: ajustadas } = await db.execute(sql`
    UPDATE attribute_semantics
       SET effective_from = ${inicio}::date
     WHERE version = 1
       AND change_origin = 'INITIAL'
       AND effective_from <> ${inicio}::date
       AND (effective_until IS NULL OR ${inicio}::date < effective_until)
  `);

  return { criadas: criadas ?? 0, ajustadas: ajustadas ?? 0, inicio };
}

/*
  Conferir se a invariante vale é o assunto de `integridade-semantica.ts`, e
  mora lá justamente porque não é o mesmo assunto: este módulo escreve, aquele
  só pergunta — e o comando que pergunta não pode ter à mão a função que
  conserta, ou a próxima pessoa apressada as junta.
*/
