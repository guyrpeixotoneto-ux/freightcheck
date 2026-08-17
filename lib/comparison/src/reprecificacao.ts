import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { loadAttributeClassificationsAt } from "./classification";
import { assessImpact } from "./impact";

/**
 * Reprecificar — quanto vale uma mudança que já sabemos que aconteceu.
 *
 * ---------------------------------------------------------------------------
 * O defeito que este módulo fecha, medido
 * ---------------------------------------------------------------------------
 *
 * O impacto era calculado **uma vez**, dentro de `computeChangeSet`, lendo a
 * semântica do atributo naquele instante — e nunca mais revisto. Confirmar um
 * atributo na curadoria depois disso não reprecificava nada: `confirmAttribute`
 * escrevia o dicionário e ia embora.
 *
 * O custo disso foi medido contra o export real, com o mesmo dado e a mesma
 * curadoria, variando só **quando** a comparação rodou:
 *
 * | estado                                   | precificadas | movimento        |
 * |------------------------------------------|--------------|------------------|
 * | como a produção fica                     | 0 de 3.224   | —                |
 * | comparações refeitas depois da curadoria | 345 de 3.224 | R$ 1.530.515,54  |
 *
 * A tela mostrava 3.224 alterações e nenhum dinheiro, que se lê como "nada
 * mudou em valor" — e não como "isto foi precificado antes de sabermos
 * precificar". É a mesma família dos PRs 18, 19 e 20: não é número errado, é
 * informação que existe e não chega.
 *
 * ---------------------------------------------------------------------------
 * Por que reprecificar e não recomparar
 * ---------------------------------------------------------------------------
 *
 * São dois derivados diferentes, e continuam separados. **Comparação responde
 * o que mudou; reprecificação responde quanto aquilo vale.** Refazer a
 * comparação para atualizar um preço jogaria fora a classificação, a
 * comparabilidade e o veredito de cada linha para reconstruí-los idênticos —
 * e, pior, tornaria o preço refém de uma operação cara o bastante para alguém
 * decidir adiá-la.
 *
 * Tudo o que a reprecificação precisa já está gravado na linha de `change`:
 * `numeric_before`, `numeric_after` e `comparability`. O que muda é só a
 * semântica do atributo, e é ela que este módulo relê.
 *
 * ---------------------------------------------------------------------------
 * A autoridade é a mesma, e é por isso que o resultado converge
 * ---------------------------------------------------------------------------
 *
 * `assessImpact` é a única função que decide se uma variação vira dinheiro, e é
 * ela que roda aqui — não uma segunda implementação "equivalente". A semântica
 * é lida por `loadAttributeClassificationsAt` **na data da vigência B** de cada
 * comparação, que é exatamente o que `computeChangeSet` faz: cada lado é lido
 * com a semântica que valia na vigência dele, e não com a de hoje.
 *
 * Consequência que este módulo se compromete a manter, e que o teste de
 * convergência prova: reprecificar isoladamente chega ao **mesmo conjunto e aos
 * mesmos valores** que refazer as comparações inteiras.
 */

export interface ResultadoDaReprecificacao {
  attributeCode: string;
  /** Linhas de `change` daquele atributo que foram reavaliadas. */
  avaliadas: number;
  /** Passaram a ter preço — o número que a curadoria acabou de destravar. */
  passaramACalcular: number;
  /**
   * Deixaram de ter preço.
   *
   * Não é hipótese: uma correção de curadoria que tira `is_monetary`, ou que
   * troca a agregação para algo não somável, **deve** desprecificar o que
   * estava precificado errado. Um número que some é menos ruim do que um número
   * errado que fica.
   */
  deixaramDeCalcular: number;
  /** Continuam sem preço, e cada uma com o motivo escrito. */
  continuamSemPreco: number;
  /** Os motivos, agrupados: a resposta a "por que ainda não tem preço?". */
  motivos: { motivo: string; alteracoes: number }[];
  /** Quantas linhas de fato mudaram no banco. Zero na segunda execução. */
  atualizadas: number;
}

/**
 * Reprecifica as alterações de um atributo.
 *
 * **Idempotente por construção**: o veredito é função pura de
 * (semântica vigente, `numeric_before`, `numeric_after`, `comparability`), e a
 * escrita só acontece onde o veredito difere do que está gravado. Rodar de novo
 * sem mudança de semântica nem de dado escreve zero linhas e devolve as mesmas
 * contagens.
 */
export async function reprecificar(
  db: Database,
  attributeCode: string,
): Promise<ResultadoDaReprecificacao> {
  const { rows } = await db.execute<{
    id: string;
    attribute_id: string;
    efetiva: string;
    numeric_before: string | null;
    numeric_after: string | null;
    comparability: string;
    impact_confidence: string;
    impact_amount: string | null;
    impact_periodicity: string | null;
    impact_reason: string | null;
  }>(sql`
    SELECT ch.id::text,
           ch.attribute_id::text,
           sb.effective_date::text AS efetiva,
           ch.numeric_before::text,
           ch.numeric_after::text,
           ch.comparability,
           ch.impact_confidence,
           ch.impact_amount::text,
           ch.impact_periodicity,
           ch.impact_reason
      FROM "change" ch
      JOIN change_set cs ON cs.id = ch.change_set_id
      JOIN snapshot sb   ON sb.id = cs.snapshot_b_id
      JOIN attribute a   ON a.id = ch.attribute_id
     WHERE a.code = ${attributeCode}
  `);

  /*
    A semântica é lida uma vez por data, e não uma vez por linha.

    Um atributo com nove vigências tem nove datas e milhares de alterações;
    resolver a classificação por linha faria milhares de consultas para obter
    nove respostas. Agrupar não muda resultado nenhum — é a mesma função com o
    mesmo argumento.
  */
  const datas = [...new Set(rows.map((r) => r.efetiva))];
  const semanticaPorData = new Map(
    await Promise.all(
      datas.map(
        async (data) =>
          [data, await loadAttributeClassificationsAt(db, data)] as const,
      ),
    ),
  );

  const resultado: ResultadoDaReprecificacao = {
    attributeCode,
    avaliadas: rows.length,
    passaramACalcular: 0,
    deixaramDeCalcular: 0,
    continuamSemPreco: 0,
    motivos: [],
    atualizadas: 0,
  };
  const motivos = new Map<string, number>();

  for (const row of rows) {
    const classification = semanticaPorData.get(row.efetiva)?.get(row.attribute_id);
    /*
      Sem classificação não há o que reavaliar, e a linha fica como está.

      Acontece quando o atributo não existia na data daquela vigência. Deixá-la
      intacta é o certo: reprecificar sem semântica seria inventar um veredito
      que ninguém pode sustentar.
    */
    if (!classification) continue;

    const veredito = assessImpact({
      classification,
      numericBefore: row.numeric_before === null ? null : Number(row.numeric_before),
      numericAfter: row.numeric_after === null ? null : Number(row.numeric_after),
      comparable: row.comparability === "COMPARABLE",
    });

    const antes = row.impact_confidence;
    const agora = veredito.confidence;
    if (antes !== "CALCULATED" && agora === "CALCULATED") resultado.passaramACalcular++;
    if (antes === "CALCULATED" && agora !== "CALCULATED") resultado.deixaramDeCalcular++;
    if (agora !== "CALCULATED") {
      resultado.continuamSemPreco++;
      motivos.set(veredito.reason, (motivos.get(veredito.reason) ?? 0) + 1);
    }

    /*
      Só escreve o que mudou.

      É o que torna a segunda execução gratuita **e** verificável: `atualizadas`
      vindo zero é a prova de que a operação é idempotente, e não uma promessa
      no comentário.
    */
    const valorNovo = veredito.amount === null ? null : String(veredito.amount);
    const igual =
      antes === agora &&
      normalizarNumero(row.impact_amount) === normalizarNumero(valorNovo) &&
      row.impact_periodicity === veredito.periodicity &&
      row.impact_reason === veredito.reason;
    if (igual) continue;

    await db.execute(sql`
      UPDATE "change"
         SET impact_confidence  = ${veredito.confidence},
             impact_amount      = ${valorNovo},
             impact_periodicity = ${veredito.periodicity},
             impact_reason      = ${veredito.reason}
       WHERE id = ${row.id}::bigint
    `);
    resultado.atualizadas++;
  }

  resultado.motivos = [...motivos.entries()]
    .map(([motivo, alteracoes]) => ({ motivo, alteracoes }))
    .sort((a, b) => b.alteracoes - a.alteracoes);

  return resultado;
}

/**
 * `numeric(18,6)` volta do banco como `"1200.000000"` e sai daqui como `"1200"`.
 *
 * Comparar as duas formas como texto declararia diferente o que é igual, e a
 * consequência não seria só uma escrita a mais: `atualizadas` nunca chegaria a
 * zero, e a prova de idempotência passaria a acusar um defeito que não existe.
 */
function normalizarNumero(v: string | null): string | null {
  return v === null ? null : String(Number(v));
}

/**
 * Quantas alterações ainda esperam preço, e por quê — no recorte inteiro.
 *
 * É a metade visível da regra: reprecificar na confirmação resolve o atributo
 * que acabou de ser confirmado, e **esta** função responde quanto ainda falta.
 * Sem ela, quem cura não tem como saber se parou no meio.
 */
export async function aguardandoPreco(db: Database): Promise<{
  total: number;
  porAtributo: { attributeCode: string; attributeName: string; alteracoes: number; motivo: string }[];
}> {
  const { rows } = await db.execute<{
    code: string;
    nome: string;
    n: number;
    motivo: string | null;
  }>(sql`
    SELECT a.code,
           coalesce(a.display_name, a.source_name) AS nome,
           count(*)::int                           AS n,
           mode() WITHIN GROUP (ORDER BY ch.impact_reason) AS motivo
      FROM "change" ch
      JOIN attribute a ON a.id = ch.attribute_id
     WHERE ch.impact_confidence <> 'CALCULATED'
       AND ch.change_type = 'VALUE_CHANGED'
     GROUP BY 1, 2
     ORDER BY 3 DESC
  `);

  return {
    total: rows.reduce((soma, r) => soma + Number(r.n), 0),
    porAtributo: rows.map((r) => ({
      attributeCode: r.code,
      attributeName: r.nome,
      alteracoes: Number(r.n),
      motivo: r.motivo ?? "(sem motivo registrado)",
    })),
  };
}
