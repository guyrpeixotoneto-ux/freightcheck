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
 * Cinco: a original e quatro repetições, somando 13,2s de espera. Eram três, e
 * 1,6s — número escolhido para cobrir "a janela de troca de processo sem fazer
 * quem espera achar que travou".
 *
 * **A conta estava calibrada para a causa errada.** A causa que a tela nomeia
 * primeiro quando não houve resposta (ver o `SEM_RESPOSTA` de `transporte.ts`)
 * é a origem inteira indisponível — Repl dormindo, cold start, reinício —, e
 * essa é da ordem de segundos a dezenas de segundos, não de milissegundos. Com
 * 1,6s de orçamento o painel vermelho era **garantido** em todo cold start: as
 * três tentativas se esgotavam antes de o servidor terminar de subir.
 *
 * E não havia recuperação depois. `refetchOnWindowFocus` é `false` por decisão
 * (ver `App.tsx`), então a API subia cinco segundos mais tarde, passava a
 * responder, e o painel continuava na tela até alguém recarregar à mão. Era
 * esse o laço — não o texto da mensagem, que já tinha sido corrigido uma vez.
 *
 * O que se paga: numa origem de fato fora do ar, o aviso demora 13,2s em vez de
 * 1,6s para aparecer. O que se recebe: o cold start, que é o caso comum,
 * resolve sozinho e ninguém vê erro nenhum. A troca vale porque o custo cai
 * sobre a espera — com "Carregando…" em tela — e o ganho tira uma tela morta.
 *
 * **Os 13,2s são só a espera *entre* tentativas — não um teto da tentativa em
 * si.** Cada uma das cinco chamadas passa por `requisitar` (`lib/api.ts`), que
 * até a correção do `TEMPO_ESGOTADO` não tinha prazo próprio: um `fetch` cuja
 * conexão abre e nunca mais recebe um byte não rejeitava nunca, e nenhuma das
 * cinco tentativas chegava a contar como tentativa — a primeira ficava presa
 * para sempre, e o orçamento inteiro daqui era irrelevante. Com o teto de
 * `requisitar`, cada tentativa agora tem seu próprio prazo (`TEMPO_LIMITE_MS`),
 * e só então os 13,2s de espera **entre** tentativas voltam a significar o que
 * este comentário sempre disse que significavam.
 */
export const TENTATIVAS_AUTOMATICAS = 5;

/**
 * O teto de uma espera, para a progressão não virar um minuto de esqueleto.
 *
 * Sem teto, o quarto degrau da progressão por três seria 10,8s sozinho, e o
 * total passaria de 16s. Oito segundos é o ponto em que esperar mais deixa de
 * comprar cold start — o que não subiu em treze segundos não vai subir no
 * vigésimo — e passa a só atrasar o aviso.
 */
const TETO_DA_ESPERA = 8_000;

/**
 * De quanto em quanto tempo sondar de novo depois que as tentativas
 * automáticas já se esgotaram e a tela está mostrando o painel de
 * indisponibilidade.
 *
 * As tentativas automáticas cobrem os primeiros 13,2s de um cold start; o que
 * elas não cobrem é um cold start mais lento que isso — migração pendente,
 * pool de conexão a reconstruir. Sem uma sondagem depois do esgotamento, o
 * painel ficava preso até alguém clicar em "Tentar de novo": `refetchOnWindowFocus`
 * é `false` por decisão (ver `chamada-resiliente.ts`), e não sobrava nenhum
 * outro gatilho automático — a pessoa podia estar com a aba aberta e focada, e
 * mesmo assim o painel não saía sozinho do lugar depois de a origem voltar.
 *
 * Reaproveita o teto da progressão (`TETO_DA_ESPERA`) em vez de um número
 * novo: é o intervalo que a política já considera "esperar mais não compra
 * mais nada", e sondar nesse ritmo depois do esgotamento é a mesma decisão
 * aplicada ao mesmo problema, só que sem prazo de validade.
 */
export const INTERVALO_DE_RECUPERACAO_MS = TETO_DA_ESPERA;

/**
 * Os estados de transporte que valem uma segunda tentativa.
 *
 * Fora `ERRO_SEM_CORPO`, que é um 4xx — o pedido está errado, e repeti-lo dá o
 * mesmo 4xx três vezes — e `REQUISICAO_CANCELADA`, que é a chamada que **nós**
 * interrompemos: repetir uma navegação abandonada é gastar rede para jogar o
 * resultado fora. `RESPOSTA_ESTRANHA` entra com ressalva — ver
 * `ehFalhaTransitoria`.
 */
const TRANSITORIOS: ReadonlySet<EstadoDoTransporte> = new Set<EstadoDoTransporte>([
  "SEM_RESPOSTA",
  "TEMPO_ESGOTADO",
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
 * Quanto esperar antes da próxima tentativa: 400ms, 1200ms, 3600ms, 8000ms.
 *
 * Progressão por três até o teto, e **sem jitter**. Jitter existe para
 * dessincronizar muitos clientes que falharam juntos; aqui é uma aba de
 * navegador repetindo uma chamada sua, e não há rebanho para espalhar. O que o
 * jitter custaria é caro: uma espera aleatória não é reproduzível, e uma
 * política de repetição que não se consegue reproduzir num teste é uma política
 * que ninguém confere.
 *
 * Os dois primeiros degraus continuam curtos, e pelo motivo de sempre: a maior
 * parte das quedas de transporte se resolve entre um pacote e o seguinte, e
 * 400ms passam sem que quem está na tela perceba que houve uma segunda
 * tentativa; 1200ms cobrem a troca de processo, que é a ordem de grandeza de um
 * restart.
 *
 * Os dois últimos são novos e cobrem outra coisa: o cold start, que é ordem de
 * grandeza de segundos. Eles não existiam, e é por isso que uma origem
 * acordando derrubava a tela — ver `TENTATIVAS_AUTOMATICAS`.
 */
export function esperaDaTentativa(falhasAnteriores: number): number {
  return Math.min(400 * 3 ** falhasAnteriores, TETO_DA_ESPERA);
}

/**
 * A resposta que valeu — e "valeu" não quer dizer "veio cheia".
 *
 * Esta forma existe por causa de um defeito de raciocínio que a primeira versão
 * cometeu: ela perguntava `dados.length > 0` para decidir se havia algo em tela.
 * Parece equivalente e não é. **Uma fila vazia é um resultado**: quer dizer "não
 * há coluna pendente", que é a melhor notícia que a Curadoria pode dar. Tratar
 * esse zero como ausência de dado fazia a tela, na falha seguinte, trocar a boa
 * notícia por um painel de indisponibilidade — e afirmar indisponibilidade sobre
 * uma pergunta que o servidor tinha respondido perfeitamente.
 *
 * A autoridade certa é **houve resposta**, não quantos registros vieram. Por isso
 * o que se guarda é a resposta inteira com a hora dela, e `null` significa uma
 * coisa só: nunca houve resposta. Nenhum chamador precisa contar nada.
 */
export interface RespostaValida<T> {
  dados: T;
  /** Quando o servidor respondeu isto, em ms de época. */
  em: number;
}

/**
 * Guardar a resposta nova, ou manter a anterior quando não houve resposta nova.
 *
 * Guarda o par, e não o dado solto. A versão anterior guardava só os dados e
 * lia a hora do `dataUpdatedAt` da query — que pertence à **chave atual**, e
 * vale 0 numa chave que ainda não respondeu. Numa troca de aba que falhava, a
 * tela exibia a hora da época sobre uma lista carregada dois minutos antes. Uma
 * tira que existe para dizer a idade do dado não pode errar a idade do dado.
 *
 * @param anterior  o que já estava guardado, ou `null` na primeira vez.
 * @param recebida  a resposta desta renderização, ou `undefined` quando não há
 *                  resposta nova — placeholder, espera, ou erro.
 */
export function guardarResposta<T>(
  anterior: RespostaValida<T> | null,
  recebida: RespostaValida<T> | undefined,
): RespostaValida<T> | null {
  return recebida === undefined ? anterior : recebida;
}

/**
 * A tela já pode falar em indisponibilidade?
 *
 * Só quando as duas coisas valem ao mesmo tempo: as tentativas automáticas
 * acabaram **e** nunca houve resposta válida para preservar. É a regra que
 * separa este módulo de um `retry: 2` solto na query.
 *
 * O segundo termo é o que costuma ser esquecido, e o que a primeira versão
 * errou. Uma fila que carregou às 14h02 continua sendo a fila às 14h05, e
 * trocá-la por um painel amarelo porque um refetch de fundo falhou é destruir
 * informação boa em nome de uma falha que ninguém pediu para observar. Quem tem
 * resposta guardada recebe um aviso ao lado; quem nunca teve recebe o painel,
 * porque aí o painel é a única coisa que há para mostrar.
 *
 * @param houveResposta  já houve resposta válida — **inclusive vazia**.
 * @param erro           o erro final, depois de esgotadas as tentativas.
 *                       `null`/`undefined` enquanto o React Query ainda repete.
 */
export function deveApresentarIndisponibilidade(
  houveResposta: boolean,
  erro: unknown,
): boolean {
  if (erro === null || erro === undefined) return false;
  return !houveResposta;
}

/**
 * A falha que **não** substitui a tela: houve erro, e há resposta guardada.
 *
 * O par de `deveApresentarIndisponibilidade`, e declarado aqui pelo mesmo motivo
 * pelo qual aquela existe: enquanto cada tela escrevia `error && dados` à mão,
 * cada tela escrevia uma variação — e a variação que usava `length` reaparecia
 * exatamente no caso da lista vazia.
 */
export function deveAvisarSobreDadoGuardado(
  houveResposta: boolean,
  erro: unknown,
): boolean {
  if (erro === null || erro === undefined) return false;
  return houveResposta;
}
