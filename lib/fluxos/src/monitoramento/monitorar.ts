/**
 * A PORTA — a chamada única que a rota faz, e a razão de ela não tocar no banco.
 *
 * `monitorarFluxo` recebe o `FluxoCompleto` **que a rota já leu** e devolve o
 * farol de cada etapa. Não recebe `db`, não recebe `empresaId` para consultar
 * fluxo nenhum — a empresa que entra aqui é a que os coletores usam para
 * escopar o que medem, e o fluxo já vem lido de `lerFluxo`, com o isolamento por
 * empresa aplicado uma vez, no lugar onde ele mora.
 *
 * A diferença importa: uma segunda função deste módulo que soubesse ler fluxo
 * seria a segunda função a poder esquecer o `where empresa_id`. O repositório
 * continua sendo "o único lugar deste produto que lê e escreve fluxos", e o
 * monitoramento é uma camada por cima dele que não tem como vazar porque não
 * tem como consultar.
 *
 * O custo dessa escolha é que a leitura do fluxo e a colheita acontecem em
 * sequência, e não em paralelo. É aceitável: o fluxo vem de uma consulta local,
 * os coletores é que são as integrações lentas.
 *
 * ---------------------------------------------------------------------------
 * O painel de todos os fluxos — a função que este arquivo prometia
 * ---------------------------------------------------------------------------
 *
 * A tela cruzada — "quais etapas de todos os fluxos estão vermelhas agora" —
 * pede as chaves de muitos fluxos numa colheita só. Ela é `monitorarFluxos`, no
 * fim deste arquivo, e não pediu nada novo do desenho: são as mesmas três peças
 * (`listaDeChaves`, `colher`, `montarMonitoramento`), uma colheita para todos os
 * fluxos, e o mesmo objeto por fluxo que a leitura individual já devolvia.
 *
 * Uma colheita só, e não uma por fluxo, porque a chave é o grão do pedido: dois
 * fluxos que declaram `cte.emissao` são uma pergunta ao coletor, não duas — e
 * `distribuir` já elimina a repetição. A alternativa (chamar `monitorarFluxo` em
 * laço) multiplicaria as integrações lentas pelo número de fluxos cadastrados,
 * que é o único custo real desta leitura.
 */

import type { FluxoCompleto } from "../modelo";
import { listaDeChaves } from "./chaves";
import {
  colher,
  type Colheita,
  type FalhaDeColetor,
  type OpcoesDaColheita,
} from "./colheita";
import {
  estadoDasEtapas,
  resumoDoFluxo,
  type EstadoDaEtapa,
  type OpcoesDoFarol,
  type ResumoDoFluxo,
} from "./farol";
import type { RegistroDeColetores } from "./registro";

export interface Monitoramento {
  fluxoId: string;
  /** Quando esta leitura foi tirada — a tela mostra, e não finge tempo real. */
  apuradoEm: string;
  etapas: EstadoDaEtapa[];
  resumo: ResumoDoFluxo;
  /**
   * As falhas da colheita, sempre presentes na resposta e nunca só no log.
   * Um farol apagado por integração fora do ar precisa dizer isso na tela de
   * quem está olhando, e não no arquivo de quem estiver de plantão.
   */
  falhas: FalhaDeColetor[];
  /** Chaves que o fluxo declara e nenhum coletor atende. */
  semColetor: string[];
}

export type OpcoesDoMonitoramento = OpcoesDaColheita & OpcoesDoFarol;

export async function monitorarFluxo(
  registro: RegistroDeColetores,
  empresaId: string,
  completo: FluxoCompleto,
  opcoes: OpcoesDoMonitoramento = {},
): Promise<Monitoramento> {
  const colheita = await colher(
    registro,
    { empresaId, chaves: listaDeChaves(completo) },
    opcoes,
  );
  return montarMonitoramento(completo, colheita, opcoes);
}

/**
 * O mesmo resultado a partir de uma colheita já feita.
 *
 * Existe para o painel cruzado do futuro — uma colheita, muitos fluxos — e para
 * o teste, que assim prova a apuração sem inventar um coletor a cada caso.
 */
export function montarMonitoramento(
  completo: FluxoCompleto,
  colheita: Colheita,
  opcoes: OpcoesDoFarol = {},
): Monitoramento {
  const etapas = estadoDasEtapas(completo, colheita, opcoes);
  return {
    fluxoId: completo.fluxo.id,
    apuradoEm: colheita.agora.toISOString(),
    etapas,
    resumo: resumoDoFluxo(etapas),
    falhas: colheita.falhas,
    semColetor: colheita.orfas,
  };
}

/**
 * O PAINEL CRUZADO — muitos fluxos, uma colheita, o mesmo objeto por fluxo.
 *
 * Recebe os `FluxoCompleto` **que quem chamou já leu** pelo repositório, pela
 * mesma razão que `monitorarFluxo`: este módulo não consulta fluxo, e por isso
 * não tem como esquecer o `where empresa_id`.
 *
 * `apuradoEm` é o mesmo instante para todos — é uma colheita só —, e é isso que
 * permite a quem lê comparar dois fluxos sem perguntar se foram medidos na mesma
 * hora. As `falhas` e as `semColetor` da resposta de cada fluxo são as da
 * colheita inteira, e não as "daquele fluxo": um coletor que caiu apagou etapa
 * em todo fluxo que dependia dele, e esconder isso de um dos fluxos seria a
 * meia-verdade que o motor inteiro evita.
 */
export async function monitorarFluxos(
  registro: RegistroDeColetores,
  empresaId: string,
  completos: readonly FluxoCompleto[],
  opcoes: OpcoesDoMonitoramento = {},
): Promise<Monitoramento[]> {
  const chaves = [...new Set(completos.flatMap((c) => listaDeChaves(c)))];
  const colheita = await colher(registro, { empresaId, chaves }, opcoes);
  return completos.map((completo) =>
    montarMonitoramento(completo, colheita, opcoes),
  );
}
