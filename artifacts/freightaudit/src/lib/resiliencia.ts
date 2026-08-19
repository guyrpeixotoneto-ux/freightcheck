import { ApiError } from "@/lib/api";
import { ErroDeTransporte, type EstadoDoTransporte } from "@/lib/transporte";

/**
 * Quando insistir, quanto esperar, e quando parar de insistir.
 *
 * Este módulo existe por causa de uma confusão de camadas que a tela cometia
 * sem ter como não cometer: **uma falha de transporte era apresentada como
 * indisponibilidade da Curadoria.** São coisas diferentes. A Curadoria está
 * indisponível quando o servidor, consultado, não consegue entregar a fila — um
 * schema que falta, um banco fora. Um pacote perdido a caminho não diz nada
 * sobre a Curadoria; diz que a requisição não chegou lá. A primeira precisa de
 * um aviso e de uma ação; a segunda precisa de outra tentativa.
 *
 * Enquanto as duas chegavam à tela como "deu erro", não havia como tratá-las
 * diferente — e o desfecho era sempre o da pior: painel de erro no lugar da
 * tela, sobre uma falha que teria passado sozinha em 400ms.
 *
 * **Três decisões, três funções puras.** Vale tentar de novo? Quanto esperar
 * antes? Já esgotou? Nenhuma delas toca rede, relógio ou React — é o que
 * permite exercitar os seis cenários de falha sem um servidor do lado, e é o
 * que garante que a política seja a mesma em toda chamada que a adotar.
 */

/**
 * Quantas vezes uma chamada é feita antes de a tela falar em indisponibilidade.
 *
 * Três: a original e duas repetições. O número não é arbitrário — é o que cobre
 * a janela de troca de processo sem fazer quem espera achar que travou. O
 * `esperaDaTentativa` abaixo soma 1,6s de espera até a terceira; com quatro
 * tentativas seriam 5,2s olhando para um esqueleto, que é tempo suficiente para
 * a pessoa recarregar a página à mão e nunca ver a recuperação acontecer.
 */
export const TENTATIVAS_AUTOMATICAS = 3;

/**
 * Os estados de transporte que valem uma segunda tentativa.
 *
 * Todos menos `ERRO_SEM_CORPO`, que é um 4xx: o pedido está errado, e repeti-lo
 * dá o mesmo 4xx três vezes. `RESPOSTA_ESTRANHA` entra com ressalva — ver
 * `ehFalhaTransitoria`.
 */
const TRANSITORIOS: ReadonlySet<EstadoDoTransporte> = new Set<EstadoDoTransporte>([
  "SEM_RESPOSTA",
  "API_AUSENTE",
  "RESPOSTA_INCOMPLETA",
  "RESPOSTA_ESTRANHA",
]);

/**
 * Esta falha pode ter passado sozinha?
 *
 * A pergunta é sobre o **tempo**, não sobre a gravidade. Um 503 de migration
 * pendente é gravíssimo e não é transitório: ele vai responder igual daqui a
 * uma hora, e repetir a chamada só atrasa o aviso que a pessoa precisa ler. Um
 * `SEM_RESPOSTA` é banal e é transitório: a mesma chamada, 400ms depois,
 * costuma responder.
 *
 * A regra dos 4xx e dos erros com `code` é a mesma que `App.tsx` já aplicava a
 * todas as queries, e continua valendo por aqui: um erro que o servidor
 * classificou é um erro que ele vai classificar igual na repetição.
 */
export function ehFalhaTransitoria(erro: unknown): boolean {
  /*
    `fetch` rejeitando é o caso mais transitório de todos, e é o que estava
    sendo tratado como o mais definitivo. Ver `transporte.ts`.
  */
  if (erro instanceof TypeError) return true;

  if (erro instanceof ErroDeTransporte) {
    const { estado, status } = erro.diagnostico;
    if (!TRANSITORIOS.has(estado)) return false;
    /*
      Corpo que não é JSON com status de sucesso é configuração, não soluço: é o
      Vite devolvendo o `index.html` porque o `/api` não está encaminhado para
      lugar nenhum. Repetir devolve o mesmo HTML. Com 5xx é uma página de erro
      de proxy — 504 de gateway, tipicamente —, e essa passa.
    */
    if (estado === "RESPOSTA_ESTRANHA") return status === undefined || status >= 500;
    return true;
  }

  if (erro instanceof ApiError) return erro.status >= 500 && !erro.code;

  /*
    Erro que não é de nenhuma das classes acima é defeito de código nosso — um
    `select` que estourou, um contrato que mudou. Repetir não conserta e
    esconde: a segunda tentativa produz o mesmo defeito e a tela demora mais
    para mostrá-lo.
  */
  return false;
}

/**
 * Ainda vale tentar? — na forma que o React Query pergunta.
 *
 * @param falhasAnteriores  quantas falhas já houve, **contando a partir de
 *                          zero**: é 0 na decisão que segue a primeira falha.
 *                          É a convenção do `retry` do React Query, medida em
 *                          `fila-de-curadoria.test.ts` em vez de deduzida da
 *                          documentação — ela já mudou entre versões maiores.
 */
export function deveTentarDeNovo(falhasAnteriores: number, erro: unknown): boolean {
  if (!ehFalhaTransitoria(erro)) return false;
  return falhasAnteriores < TENTATIVAS_AUTOMATICAS - 1;
}

/**
 * Quanto esperar antes da próxima tentativa: 400ms, 1200ms.
 *
 * Progressão por três, e **sem jitter**. Jitter existe para dessincronizar
 * muitos clientes que falharam juntos; aqui é uma aba de navegador repetindo
 * uma chamada sua, e não há rebanho para espalhar. O que o jitter custaria é
 * caro: uma espera aleatória não é reproduzível, e uma política de repetição
 * que não se consegue reproduzir num teste é uma política que ninguém confere.
 *
 * O primeiro degrau é curto de propósito — a maior parte das quedas de
 * transporte se resolve entre um pacote e o seguinte, e 400ms passam sem que
 * quem está na tela perceba que houve uma segunda tentativa. O segundo cobre a
 * troca de processo, que é a ordem de grandeza de um restart.
 */
export function esperaDaTentativa(falhasAnteriores: number): number {
  return 400 * 3 ** falhasAnteriores;
}

/**
 * A tela já pode falar em indisponibilidade?
 *
 * Só quando as duas coisas valem ao mesmo tempo: as tentativas automáticas
 * acabaram **e** não há nada em tela para preservar. É a regra que separa este
 * módulo de um `retry: 2` solto na query.
 *
 * O segundo termo é o que costuma ser esquecido. Uma fila que carregou às
 * 14h02 continua sendo a fila às 14h05, e trocá-la por um painel amarelo
 * porque um refetch de fundo falhou é destruir informação boa em nome de uma
 * falha que ninguém pediu para observar. Quem tem dado em tela recebe um aviso
 * ao lado; quem não tem nada recebe o painel, porque aí o painel é a única
 * coisa que há para mostrar.
 *
 * @param temDadoEmTela  há resultado anterior sendo exibido agora.
 * @param erro           o erro final, depois de esgotadas as tentativas.
 *                       `null`/`undefined` enquanto o React Query ainda repete.
 */
export function deveApresentarIndisponibilidade(
  temDadoEmTela: boolean,
  erro: unknown,
): boolean {
  if (erro === null || erro === undefined) return false;
  return !temDadoEmTela;
}

/**
 * O último resultado que valeu, atravessando um erro.
 *
 * Esta função existe por um limite do React Query que só apareceu quando o
 * teste do sexto cenário falhou — e a descoberta vale o comentário, porque a
 * intuição erra aqui. `placeholderData: keepPreviousData` **não** preserva
 * dado através de um erro: o placeholder só é aplicado enquanto o status é
 * `pending`. Assim que a query falha, o status vira `error` e `data` volta a
 * `undefined` para aquela chave. Numa troca de aba que falha — chave nova, sem
 * dado próprio — a lista some, que é exatamente o que se queria impedir.
 *
 * O `keepPreviousData` continua valendo e continua necessário: é ele que evita
 * o esqueleto durante a espera. O que falta é a outra metade, e é esta: quem
 * mostra a fila guarda a última que mostrou, e continua mostrando-a. Duas
 * peças, duas fases — a espera e o erro.
 *
 * Trivial de propósito. O valor está em existir num lugar só, com o motivo
 * escrito: um `??` solto na tela seria apagado na primeira limpeza por alguém
 * que leu a documentação do `keepPreviousData` e concluiu que era redundante.
 */
export function preservarUltimoValido<T>(
  anterior: T | undefined,
  atual: T | undefined,
): T | undefined {
  return atual === undefined ? anterior : atual;
}
