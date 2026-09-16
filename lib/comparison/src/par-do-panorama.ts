import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { computeChangeSet } from "./engine";
import { getChangeSetForPair } from "./query";
import { contextFilter, type SeriesContext } from "./series";

/**
 * O PAR DO PANORAMA — duas vigências vizinhas, na direção que se pedir.
 *
 * ---------------------------------------------------------------------------
 * A pergunta
 * ---------------------------------------------------------------------------
 * O Panorama Executivo lia **uma** vigência: `?period=agosto`, e a comparação
 * que a importação já tinha gravado contra a anterior dela. O par estava lá o
 * tempo todo — toda a leitura é sobre uma diferença —, mas só uma das pontas
 * era escolhível, e a outra era sempre "a anterior".
 *
 * Com as duas pontas em tela, aparece o gesto que faltava: **inverter**. E
 * inverter não é trocar o sinal do número que já está na tela. Ir de 100 para
 * 110 é +10,0%; voltar de 110 para 100 é −9,09%, porque a base do percentual
 * passou a ser a outra ponta. Uma tela que negasse o que tem mostraria −10,0%
 * na volta — um número que não existe.
 *
 * Então a volta é uma comparação de verdade, e é esta função que a garante:
 * ela pede ao motor o par B×A, uma vez por série, e deixa gravado o que o motor
 * calcular. Quem lê depois é `getFamiliesView`, com a ponta **De** em mãos.
 *
 * ---------------------------------------------------------------------------
 * Por que só vigências consecutivas
 * ---------------------------------------------------------------------------
 * Porque o Panorama publica *o que esta vigência custou*, e essa frase só é
 * verdadeira sobre um passo. Duas vigências salteadas — agosto contra outubro
 * — são um **intervalo**, e um intervalo tem duas leituras legítimas e
 * diferentes (a soma dos movimentos e o estado contra o estado), nenhuma das
 * quais é o que os seis andares desta tela desenham. Quem quer o intervalo tem
 * a Linha do Tempo, que o lê inteiro e diz que é isso que está lendo.
 *
 * A recusa é escrita, e não silenciosa: um endereço colado com um par salteado
 * recebe a frase abaixo em vez de um número montado sobre outra pergunta.
 *
 * ---------------------------------------------------------------------------
 * O que esta função **não** faz
 * ---------------------------------------------------------------------------
 * Não compara nada e não soma nada. Ela resolve as duas datas em snapshots,
 * casa um lado com o outro dentro da mesma série e entrega o par ao motor, que
 * é quem recusa escopo diferente, cobertura diferente e canal diferente
 * (`engine.ts`) — com a frase dele, que é melhor do que qualquer uma que
 * pudesse ser escrita aqui.
 */

/** Uma ponta e outra, como o endereço as traz. */
export interface ParDeVigencias {
  /** O lado A — de onde se parte. */
  de: string;
  /** O lado B — onde se chega, e a vigência que a leitura publica. */
  para: string;
}

/** O que a preparação do par apurou. */
export interface ParPreparado extends ParDeVigencias {
  /**
   * A ponta De é **posterior** à ponta Para — a volta.
   *
   * Sai da ordem das datas, e não de quem chamou: é a mesma conta que decide
   * se havia algo a mandar calcular, e duas respostas para a mesma pergunta é
   * o que faz a tela dizer "invertido" sobre um par que não está.
   */
  invertido: boolean;
  /** Quantas comparações o motor teve de calcular agora — 0 no caso normal. */
  calculadas: number;
}

/**
 * Um snapshot de uma das duas pontas, com o que decide com quem ele casa.
 */
interface PontaDoPar extends Record<string, unknown> {
  id: string;
  effective_date: string;
  scope_hash: string;
  entity_type_set: string;
  source_label: string;
}

/**
 * A recusa deste módulo, escrita para quem opera.
 *
 * `Error` puro, como as recusas do motor, porque é assim que a rota as
 * distingue de uma falha de banco (`classificarFalha`): o que tem SQLSTATE vira
 * 500 com frase genérica, e o que é regra chega inteiro a quem clicou.
 */
export class ParRecusado extends Error {}

/**
 * Deixa o par pronto para leitura — e diz o que ele é.
 *
 * Na direção de sempre (De anterior a Para) não há nada a calcular: a
 * comparação é a que a importação gravou, e mandar recalculá-la seria fazer o
 * número depender de quem abriu a tela primeiro. Só a volta passa pelo motor.
 */
export async function prepararParDoPanorama(
  db: Database,
  context: SeriesContext,
  par: ParDeVigencias,
  /**
   * As vigências do contexto, mais recente primeiro — como `listPeriods` as
   * devolve. Vem de fora porque quem chama já a tem em mãos para resolver o
   * contexto, e porque é ela, e não uma segunda consulta com outra régua, que
   * define o que "consecutivas" quer dizer nesta tela.
   */
  periodos: readonly string[],
): Promise<ParPreparado> {
  const { de, para } = par;
  if (de === para) {
    throw new ParRecusado(
      "As duas pontas são a mesma vigência. Uma vigência não se compara consigo mesma.",
    );
  }

  const ordenadas = [...periodos].sort();
  const indiceDe = ordenadas.indexOf(de);
  const indicePara = ordenadas.indexOf(para);
  if (indiceDe < 0 || indicePara < 0) {
    const ausente = indiceDe < 0 ? de : para;
    throw new ParRecusado(
      `A vigência ${ausente} não pertence a esta unidade. Escolha as duas pontas na lista desta tela.`,
    );
  }
  if (Math.abs(indiceDe - indicePara) !== 1) {
    throw new ParRecusado(
      "O Panorama lê um passo de cada vez: as duas pontas precisam ser vigências vizinhas. " +
        "Para ler um intervalo com vigências no meio, abra a Linha do Tempo — ela soma o caminho inteiro e diz que é isso que está somando.",
    );
  }

  const invertido = de > para;
  // A ida é o que a importação já gravou. Nada a calcular, e nada a decidir.
  if (!invertido) return { de, para, invertido, calculadas: 0 };

  const { rows } = await db.execute<PontaDoPar>(sql`
    SELECT s.id,
           s.effective_date::text AS effective_date,
           s.scope_hash,
           s.entity_type_set,
           s.source_label
      FROM snapshot s
     WHERE s.effective_date IN (${de}::date, ${para}::date)
       AND s.status <> 'SUPERSEDED'
       AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
       AND ${contextFilter("s", context)}
       -- Trecho não pertence a esta leitura, do mesmo modo que não pertence à
       -- leitura agrupada que vai ler o resultado. Ver a nota em loadChanges.
       AND s.entity_type_set IS DISTINCT FROM 'TRECHO'
     ORDER BY s.entity_type_set, s.effective_date
  `);

  /*
    Uma série é (escopo, cobertura), e o par se monta **dentro** dela.

    Uma vigência da Ambev chega ora com cavalo e carreta no mesmo arquivo, ora
    em dois. Casar por data apenas emparelharia o arquivo de cavalo de setembro
    com o de carreta de agosto — o par que o motor recusa por cobertura
    diferente, aqui produzido por nós e apresentado como recusa dele.
  */
  const porSerie = new Map<string, { a?: PontaDoPar; b?: PontaDoPar }>();
  for (const linha of rows) {
    const chave = `${linha.scope_hash}|${linha.entity_type_set}`;
    const serie = porSerie.get(chave) ?? {};
    if (linha.effective_date === de) serie.a = linha;
    else serie.b = linha;
    porSerie.set(chave, serie);
  }

  const pares = [...porSerie.values()].filter(
    (s): s is { a: PontaDoPar; b: PontaDoPar } => Boolean(s.a && s.b),
  );
  if (pares.length === 0) {
    throw new ParRecusado(
      `Nenhuma série tem as duas vigências (${de} e ${para}) com a mesma cobertura nesta unidade. ` +
        "A volta só existe onde a ida existe: sem o mesmo conjunto de equipamento dos dois lados, não há par a inverter.",
    );
  }

  let calculadas = 0;
  for (const { a, b } of pares) {
    /*
      Reaproveita a comparação já calculada; só calcula quando ela não existe —
      o mesmo caminho de `/finame/comparacao`, e é o que faz o segundo clique
      em Inverter custar uma leitura em vez de uma varredura.
    */
    if (await getChangeSetForPair(db, a.id, b.id)) continue;
    await computeChangeSet(db, a.id, b.id, { computedBy: "api:panorama" });
    calculadas += 1;
  }

  return { de, para, invertido, calculadas };
}
