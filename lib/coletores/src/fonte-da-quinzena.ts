import { and, desc, eq } from "drizzle-orm";
import {
  fechamentoCompetenciaTable,
  fechamentoDocumentoTable,
  type Database,
} from "@workspace/db";

/**
 * A FONTE DA QUINZENA — o documento vigente da competência mais recente de uma
 * empresa, e o único lugar onde o `where` do isolamento é escrito.
 *
 * ---------------------------------------------------------------------------
 * Por que isto é uma função e não uma consulta copiada
 * ---------------------------------------------------------------------------
 *
 * Todo coletor que lê o fechamento faz exatamente a mesma pergunta antes de
 * medir qualquer coisa: *qual é o arquivo do tipo X, vigente, da última
 * competência desta empresa?* São três filtros, e os três são o produto inteiro:
 *
 * - `fechamento_competencia.unidade_id = empresa` — **o isolamento**. A empresa
 *   do módulo de fluxos é a unidade canônica, e uma competência sem unidade
 *   associada (`unidade_id` nulo, o legado que `fechamento_competencia`
 *   descreve) não é de ninguém e não pinta o farol de ninguém;
 * - `tipo = …` — escolhe um relatório entre os nove;
 * - `vigente` — escolhe o reenvio que a apuração usa, e não o arquivo que foi
 *   substituído.
 *
 * Esquecer o primeiro é o defeito mais caro que este módulo pode ter: o farol de
 * uma empresa aceso pelo arquivo de outra. Com a consulta num lugar só, escrever
 * um coletor novo não é uma oportunidade de esquecê-lo — é uma chamada.
 *
 * `cte-autorizacao-sefaz.ts` ainda tem a cópia privada dele, escrita antes deste
 * arquivo existir. Adotar esta função lá é uma troca de uma linha, e ela não
 * entrou junto de propósito: aquele coletor tem bateria própria e mexer nele
 * agora misturaria uma refatoração com a entrega de dois coletores novos.
 *
 * ---------------------------------------------------------------------------
 * A validade, e por que ela é da fonte e não da métrica
 * ---------------------------------------------------------------------------
 *
 * Nenhum destes relatórios é um serviço consultável: são arquivos enviados uma
 * vez por quinzena. `medidoEm` é `enviadoEm` — o instante em que o fato foi
 * observado, e não o instante em que alguém abriu a tela —, e a validade é a
 * mesma que `cte-autorizacao-sefaz.ts` já argumentou: **dezesseis dias**, uma
 * quinzena mais um dia de folga.
 *
 * O intervalo é escolhido pelos dois erros que ele evita. Curto demais (a hora
 * padrão do motor) deixaria a etapa cinza em quase todo o tempo, porque a fonte
 * não é de tempo real — o farol seria inútil sem ser falso. Longo demais
 * manteria aceso em outubro um verde de julho, que é o defeito grave: afirmar
 * normalidade sobre uma quinzena que ninguém importou. Em dezesseis dias, **a
 * ausência do próximo arquivo é ela mesma a informação** — a etapa apaga sozinha
 * quando o fechamento atrasa, e diz `vencida` em vez de sumir.
 */

/** Dezesseis dias — a quinzena da fonte, mais um dia de folga. */
export const VALIDADE_DA_QUINZENA_EM_SEGUNDOS = 16 * 24 * 60 * 60;

/** O documento e o mínimo que todo coletor precisa saber sobre ele. */
export interface DocumentoDaQuinzena {
  documentoId: string;
  /** `2026-07-Q2` — para a frase da etapa dizer de que quinzena ela fala. */
  competencia: string;
  enviadoEm: Date;
  /** Quantas linhas o leitor produziu a partir do arquivo. */
  linhasLidas: number;
  /**
   * Quantas linhas o leitor **recusou**.
   *
   * Não é um detalhe de importação: é o que separa "o arquivo chegou inteiro" de
   * "o arquivo chegou e há dado dele fora da conta". O Fechamento já trata as
   * duas como estados diferentes (`COM_RECUSA`, em `status-da-etapa.ts`), e os
   * coletores herdam essa distinção em vez de inventar outra.
   */
  recusas: number;
}

/**
 * O documento vigente do tipo pedido, na competência mais recente da empresa.
 *
 * `null` quando a empresa não tem competência, ou tem e aquele relatório não
 * chegou. Nos dois casos o coletor deve **calar** — silêncio é "não sei", que é
 * diferente de "está tudo bem".
 */
export async function documentoDaQuinzena(
  db: Database,
  empresaId: string,
  tipo: string,
): Promise<DocumentoDaQuinzena | null> {
  const [linha] = await db
    .select({
      documentoId: fechamentoDocumentoTable.id,
      competencia: fechamentoCompetenciaTable.chave,
      enviadoEm: fechamentoDocumentoTable.enviadoEm,
      linhasLidas: fechamentoDocumentoTable.linhasLidas,
      recusas: fechamentoDocumentoTable.recusas,
    })
    .from(fechamentoDocumentoTable)
    .innerJoin(
      fechamentoCompetenciaTable,
      eq(fechamentoDocumentoTable.competenciaId, fechamentoCompetenciaTable.id),
    )
    .where(
      and(
        eq(fechamentoCompetenciaTable.unidadeId, empresaId),
        eq(fechamentoDocumentoTable.tipo, tipo),
        eq(fechamentoDocumentoTable.vigente, true),
      ),
    )
    .orderBy(
      desc(fechamentoCompetenciaTable.inicio),
      desc(fechamentoDocumentoTable.enviadoEm),
    )
    .limit(1);

  if (!linha) return null;
  return {
    documentoId: linha.documentoId,
    competencia: linha.competencia,
    enviadoEm: linha.enviadoEm,
    linhasLidas: linha.linhasLidas,
    recusas: Array.isArray(linha.recusas) ? linha.recusas.length : 0,
  };
}

/**
 * O farol de uma afirmação de presença — o único que estes dois coletores fazem.
 *
 * **Não existe vermelho aqui, e a ausência dele é a decisão.** O que estes
 * relatórios sustentam é *o fato aconteceu e está registrado*. Eles não trazem o
 * que teria de existir para uma afirmação negativa: não há denominador do que
 * *deveria* ter acontecido, não há prazo contra o qual atrasar, e um arquivo sem
 * linhas é a ausência do fato — não um fato ruim. Pintar de vermelho a quinzena
 * em que ninguém importou nada seria acusar a operação de um problema que é do
 * fechamento, e pintar de vermelho a quinzena sem viagem acusaria a operação de
 * não ter rodado num período em que talvez não devesse rodar.
 *
 * Sobram dois estados, e os dois são afirmações que o arquivo assina:
 *
 *  VERDE     o documento vigente da quinzena traz o fato, e o leitor não recusou
 *            nenhuma linha dele — o registro está completo;
 *  AMARELO   traz o fato, e há linha do arquivo que o leitor recusou. O fato
 *            está evidenciado e parte do arquivo ficou fora da conta, que é
 *            exatamente o estado `COM_RECUSA` que o Fechamento já nomeia.
 *
 * O resto é silêncio, e o motor o transforma em `SEM_DADO` com o motivo certo.
 */
export function farolDaPresenca(recusas: number): "VERDE" | "AMARELO" {
  return recusas === 0 ? "VERDE" : "AMARELO";
}
