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
 * O painel de todos os fluxos ainda não mora aqui
 * ---------------------------------------------------------------------------
 *
 * A tela cruzada — "quais etapas de todos os fluxos estão vermelhas agora" —
 * pede as chaves de muitos fluxos numa colheita só, e é uma função a mais, no
 * dia em que existir coletor de verdade para alimentá-la. Ela vai usar as mesmas
 * três peças (`distribuir`, `colher`, `estadoDasEtapas`) e não pede nada novo
 * deste desenho: é o teste de que a divisão está no lugar certo.
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
