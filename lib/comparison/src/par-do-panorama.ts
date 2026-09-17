import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { computeChangeSet } from "./engine";
import { getChangeSetForPair } from "./query";
import { contextFilter, type SeriesContext } from "./series";
import { coberturaComum, coberturasSeFalam } from "./recorte-de-rubrica";

/**
 * O PAR DO PANORAMA — duas vigências da unidade, na direção que se pedir.
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
 * Qualquer par, e não só o passo seguinte
 * ---------------------------------------------------------------------------
 * Esta função recusou, até 17/09/2026, todo par que não fosse de vigências
 * **vizinhas**: o Panorama publicava *o que esta vigência custou*, e a frase só
 * é verdadeira sobre um passo. A recusa tinha um preço que apareceu no uso: o
 * seletor da tela, para nunca montar um par recusado, arrastava a outra ponta a
 * cada escolha — escolher agosto no **De** movia o **Para** de setembro para
 * agosto, e a referência que a pessoa tinha fixado saía debaixo dela.
 *
 * As dezesseis auditorias de rubrica nunca tiveram essa trava: a de FINAME
 * compara junho com setembro sem reclamar, e é o motor quem calcula. A trava
 * daqui fazia o mesmo produto responder duas coisas diferentes à mesma
 * pergunta, e o que a tela desenha — o líquido do par, de onde ele vem, onde
 * aconteceu — não deixa de ser verdade com duas vigências no meio. **O que é do
 * par continua sendo do par**: a variação contra a vigência anterior, que só
 * existe entre dois passos que se sucedem, é o andar que se cala (ver
 * `pages/panorama.tsx`), e não um número montado sobre outra pergunta.
 *
 * Quem quer o caminho inteiro somado continua tendo a Linha do Tempo: ela lê o
 * intervalo movimento a movimento, que é outra leitura, e diz que é essa que
 * está fazendo.
 *
 * As comparações salteadas **não vazam** para a leitura da vigência: quem lê
 * sem ponta pedida exige a comparação canônica de cada série
 * (`grouped.ts`, cláusula `ladoA`), e é a mesma régua que já protege o acervo
 * das candidatas que as dezesseis auditorias gravam ao abrir o menu
 * (`candidatas-do-par.ts`).
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
 * No par canônico (Para contra a anterior imediata dela) não há nada a
 * calcular: a comparação é a que a importação gravou, e mandar recalculá-la
 * seria fazer o número depender de quem abriu a tela primeiro. A volta e o par
 * salteado passam pelo motor.
 *
 * O que ela **não** faz é consertar a escolha de ninguém: par com a mesma
 * vigência nas duas pontas, ou com uma ponta que não é desta unidade, é recusa
 * escrita — nunca um par vizinho montado no lugar do pedido.
 */
export async function prepararParDoPanorama(
  db: Database,
  context: SeriesContext,
  par: ParDeVigencias,
  /**
   * As vigências do contexto, mais recente primeiro — como `listPeriods` as
   * devolve. Vem de fora porque quem chama já a tem em mãos para resolver o
   * contexto, e porque é ela, e não uma segunda consulta com outra régua, que
   * define quais vigências são desta unidade — e qual delas é a anterior
   * imediata do Para, que é o único par que não precisa passar pelo motor.
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
  const invertido = de > para;

  /*
    O par **canônico** — Para contra a anterior imediata dela — é o que a
    importação já gravou. Nada a calcular, e nada a decidir: mandar recalculá-lo
    faria o número depender de quem abriu a tela primeiro.

    Todo o resto passa pelo motor: a volta (De posterior a Para) e o par
    salteado (junho contra setembro, com julho e agosto no meio). Os dois são
    comparações que a importação não gravou, e nenhuma régua de data sozinha
    alcança — é o motor quem as calcula, uma vez por série, e quem responde
    depois.
  */
  if (!invertido && indiceDe === indicePara - 1) {
    return { de, para, invertido, calculadas: 0 };
  }

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
  /*
    O casamento é por unidade e **cobertura que se fala** — não por cobertura
    idêntica.

    Era `scope_hash|entity_type_set`, e a igualdade quebrava esta tela no mês em
    que um arquivo parcial entrava: de um lado `CAVALO`, do outro
    `CARRETA+CAVALO`, nenhuma série com as duas pontas, e o Panorama recusava o
    par com um ano de cavalo nas duas. É o defeito de 16/09/2026 — o mesmo que
    tirou sete meses do seletor do FINAME —, aqui na forma de uma recusa.

    A régua é a de `coberturasSeFalam`: as coberturas têm de se cruzar e ser do
    mesmo grão. Entre as candidatas de uma unidade fica a de **maior
    interseção**, e o empate fica com a de cobertura idêntica — quem procura é
    quem manda, e não a ordem em que o banco devolveu.
  */
  const porUnidade = new Map<string, { a: PontaDoPar[]; b: PontaDoPar[] }>();
  for (const linha of rows) {
    const lados = porUnidade.get(linha.scope_hash) ?? { a: [], b: [] };
    if (linha.effective_date === de) lados.a.push(linha);
    else lados.b.push(linha);
    porUnidade.set(linha.scope_hash, lados);
  }

  const pares: { a: PontaDoPar; b: PontaDoPar }[] = [];
  for (const { a: ladoA, b: ladoB } of porUnidade.values()) {
    for (const a of ladoA) {
      const melhor = ladoB
        .filter((b) => coberturasSeFalam(a.entity_type_set, b.entity_type_set))
        .sort(
          (x, y) =>
            coberturaComum(a.entity_type_set, y.entity_type_set).length -
              coberturaComum(a.entity_type_set, x.entity_type_set).length ||
            Number(y.entity_type_set === a.entity_type_set) -
              Number(x.entity_type_set === a.entity_type_set) ||
            x.entity_type_set.localeCompare(y.entity_type_set),
        )[0];
      if (melhor) pares.push({ a, b: melhor });
    }
  }

  if (pares.length === 0) {
    throw new ParRecusado(
      `Nenhuma série tem as duas vigências (${de} e ${para}) com equipamento em comum nesta unidade. ` +
        "Sem nenhum tipo de equipamento dos dois lados não há o que comparar — escolha outra ponta, " +
        "ou importe a cobertura que falta na vigência desejada.",
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
