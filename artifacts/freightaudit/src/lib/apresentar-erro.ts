import { ApiError } from "@/lib/api";
import { ehDiagnostico, type Diagnostico } from "@/lib/diagnostico";
import {
  orientacaoDaProntidao,
  type RespostaDaProntidao,
} from "@/lib/prontidao";
import {
  ErroDeTransporte,
  diagnosticarTransporte,
  type DiagnosticoDeTransporte,
} from "@/lib/transporte";

/**
 * O que a tela mostra quando uma chamada falha — decidido antes de desenhar.
 *
 * Esta função existe por causa de um defeito de forma, não de texto. O aviso de
 * erro imprimia **dois** parágrafos, sempre: o diagnóstico do `/api/healthz` e
 * a mensagem crua da rota. Enquanto os dois nasciam em lugares diferentes, eles
 * podiam divergir — e divergiram, num ambiente real, entre "rode
 * `migrate:adotar`" e "suba o servidor de novo ou rode `migrate`", sobre o
 * mesmo erro, na mesma tela, um embaixo do outro.
 *
 * Deixar os textos coerentes resolveria aquele caso e nenhum futuro: bastaria
 * alguém escrever a terceira frase. O que fecha a porta é o tipo abaixo, onde
 * **duas orientações não são representáveis** — há um campo para ela, e a
 * mensagem crua só existe quando ele está vazio.
 *
 * **Dois eixos, uma orientação.** As falhas vêm de camadas independentes: o
 * banco (migrations, registro, schema) e o transporte (a requisição chegou? o
 * que respondeu era nosso?). Cada um tem a sua autoridade — `diagnosticar` no
 * servidor, `diagnosticarTransporte` aqui — e as duas devolvem a mesma forma.
 * A escolha entre elas é feita neste arquivo, uma vez, e nunca resulta em duas.
 */
/**
 * A orientação escolhida, sem perder de qual eixo ela veio.
 *
 * Quem desenha só precisa de `Orientacao` — e é por isso que o componente
 * recebe essa forma, e não esta. Mas quem inspeciona (um teste, uma tela que
 * queira tratar `SEM_RESPOSTA` de modo próprio) precisa poder perguntar. União
 * discriminada por `estado`: os dois conjuntos de estados são disjuntos.
 */
export type OrientacaoApresentada = Diagnostico | DiagnosticoDeTransporte;

export interface Apresentacao {
  /**
   * O que a rota sabe e o diagnóstico não: qual schema falta, e o que houve com
   * o arquivo enviado. **Nunca recomenda nada** — é por isso que pode aparecer
   * ao lado da orientação sem voltar a ser uma segunda opinião.
   */
  contexto: string | null;
  /** A orientação. Quando existe, é a única que a tela apresenta. */
  orientacao: OrientacaoApresentada | null;
  /**
   * A mensagem do servidor, crua.
   *
   * Só é preenchida quando **não** há orientação — erro não tipado, um bundle
   * antigo ainda no ar, uma rota que não passa por `responderSchemaAusente`. Aí
   * ela é a única coisa que se tem, e não uma opinião concorrente.
   */
  mensagemCrua: string | null;
  /**
   * O identificador da requisição que falhou, quando o servidor o mandou.
   *
   * Aparece **junto com a orientação ou sozinho**, e é a única coisa nesta
   * forma que não tenta explicar nada. É o que faltava no caso que não tem
   * explicação nenhuma: a tela dizia `Internal server error`, o `/api/healthz`
   * dizia `SAUDAVEL`, e as duas coisas eram verdade — porque a causa era um
   * defeito de código numa rota, que só o log daquela requisição descreve. Sem
   * este número não havia como dizer *qual* requisição procurar.
   */
  requestId: string | null;
  /**
   * A frase principal — a linha que se lê com pressa.
   *
   * Sai do `humano` da orientação quando há uma, e é sempre uma frase em
   * português sobre o que houve: nenhum nome de migration, nenhum comando,
   * nenhum SQLSTATE, nenhum endereço de rota. Sem orientação, é `null` e a tela
   * cai no que sobrou — a mensagem crua e o `requestId`.
   *
   * **Este campo substitui `mostrarLinkHealthz`.** Aquele booleano era a
   * confissão do desenho anterior: quando a interface não sabia explicar, ela
   * entregava um endereço técnico e passava o diagnóstico adiante para quem só
   * queria usar o produto. O que a substitui não é um texto melhor — é a tela
   * ter perguntado sozinha (ver `lib/prontidao.ts`) antes de escrever.
   */
  principal: string | null;
  /**
   * Tudo o que interessa a quem investiga, e a mais ninguém.
   *
   * A tela guarda isto atrás de "Detalhes técnicos", fechado por padrão. Nada
   * aqui é opinião: é o texto técnico da orientação, o comando que resolve, a
   * evidência, a mensagem crua do servidor e o identificador da requisição —
   * cada um com um rótulo, e nenhum deles disputando a linha principal.
   */
  detalhes: { rotulo: string; texto: string; comando?: boolean }[];
}

/**
 * A orientação que vale para este erro, do mais próximo ao mais distante.
 *
 * A ordem é a da proximidade, e cada degrau exclui o de baixo por um motivo:
 *
 * 1. **Transporte.** Se a requisição não chegou, ou quem respondeu não era a
 *    nossa API, o estado do banco não explica nada — e perguntá-lo daria uma
 *    resposta sobre outra coisa. É o degrau que fecha o buraco que sobrava:
 *    antes, um roteador sem ninguém atrás podia ser apresentado com a
 *    recomendação de rodar `migrate`.
 * 2. **O diagnóstico que veio no próprio erro**, que descreve o banco no
 *    instante em que a chamada falhou.
 * 3. **O `/healthz`**, que é uma segunda pergunta, feita depois.
 */
function escolherOrientacao(
  error: unknown,
  prontidao: RespostaDaProntidao | undefined,
): OrientacaoApresentada | null {
  if (error instanceof ErroDeTransporte) return error.diagnostico;

  /*
    A reserva, para as chamadas que ainda usam `fetch` cru.

    Este ramo já foi o caminho **principal** de toda falha de transporte, e era
    uma aposta: "nenhum erro nosso é `TypeError`". A aposta é falsa — um `.map`
    num objeto, um contrato que mudou e um `undefined is not a function` são
    todos `TypeError` —, e o preço era um defeito de código nosso apresentado
    como "o servidor não respondeu", mandando procurar rede.

    Quem passa por `fetchJson`/`fetchArquivo` não cai mais aqui: `requisitar`
    (em `lib/api.ts`) classifica a rejeição na origem e sobe `ErroDeTransporte`,
    com a frase do navegador junto — o ramo de cima. Restam os
    `fetch(getApiUrl(...))` escritos à mão pelas telas, e para eles esta reserva
    continua sendo melhor do que texto cru. O caminho de sair daqui é as telas
    adotarem `fetchJson`, não este ramo ficar mais esperto.
  */
  if (error instanceof TypeError) {
    return diagnosticarTransporte({
      naoCompletou: true,
      ...(error.message === "" ? {} : { motivo: error.message }),
    });
  }

  if (error instanceof ApiError && ehDiagnostico(error.diagnostico)) {
    return error.diagnostico;
  }

  /*
    **A recusa que o servidor escreveu de propósito não é explicada pelo
    ambiente.** Um 4xx sem diagnóstico é uma resposta, e não uma falha: o
    servidor leu o pedido, decidiu, e disse o que decidiu — "e-mail ou senha
    incorretos", "o arquivo não tem a coluna de chamado", "essa vigência não
    existe".

    Sem esta parada, um ambiente em drift (schema divergente, bridge no meio —
    estados em que o portão deliberadamente **não** fecha) faria toda senha
    errada da tela de login ser apresentada como problema de infraestrutura. É o
    espelho do defeito que este arquivo corrige, e seria pior: manda quem errou
    a senha esperar um conserto que não vai mudar nada para ela.
  */
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return null;
  }

  /*
    O terceiro degrau: o que a própria tela foi perguntar.

    Era o `/healthz`, e o que ele respondia sobre o banco. Agora é `/readyz`, e
    a diferença não é de endereço: aquele respondia 200 com o banco fora — é
    para lá que o startup probe aponta —, então "de pé" chegava aqui como se
    fosse "pronto", e o degrau ficava mudo exatamente no caso em que mais se
    precisava dele.

    Um ambiente pronto continua não explicando nada, e `orientacaoDaProntidao`
    é quem aplica essa regra: a causa está em outro lugar, e imprimir "está
    tudo certo" ao lado de uma falha manda procurar no lugar errado. Aí a
    mensagem crua volta a ser o que se tem — que é a verdade nesse caso.
  */
  return orientacaoDaProntidao(prontidao);
}

/**
 * Os detalhes técnicos desta falha, na ordem em que quem investiga os lê.
 *
 * Cada linha tem rótulo porque, sem ele, o bloco vira um parágrafo de coisas
 * soltas: o SQLSTATE ao lado da frase do servidor ao lado de um comando. E
 * nenhuma delas ocupa a mensagem principal — que é a regra inteira deste
 * trabalho, e a razão de este campo existir.
 */
function detalhesTecnicos(
  orientacao: OrientacaoApresentada | null,
  mensagemCrua: string | null,
  requestId: string | null,
): Apresentacao["detalhes"] {
  const linhas: Apresentacao["detalhes"] = [];

  /*
    O texto técnico da orientação entra **quando difere da frase principal**. Um
    servidor anterior a este contrato responde sem `humano`, e aí `principal`
    já é o `resumo`: repeti-lo aqui seria a mesma frase duas vezes na mesma
    caixa.
  */
  if (
    orientacao &&
    orientacao.humano &&
    orientacao.resumo !== orientacao.humano
  ) {
    linhas.push({ rotulo: "O que houve", texto: orientacao.resumo });
  }
  if (orientacao?.acao) {
    linhas.push({ rotulo: "O que resolve", texto: orientacao.acao.texto });
    if (orientacao.acao.comando) {
      linhas.push({
        rotulo: "Comando",
        texto: orientacao.acao.comando,
        comando: true,
      });
    }
  }
  if (orientacao?.evidencia) {
    linhas.push({ rotulo: "Evidência", texto: orientacao.evidencia });
  }
  if (mensagemCrua) {
    linhas.push({ rotulo: "Resposta do servidor", texto: mensagemCrua });
  }
  if (requestId) {
    linhas.push({ rotulo: "Requisição", texto: requestId, comando: true });
  }

  return linhas;
}

/**
 * @param prontidao  o que `/readyz` respondeu, quando a tela já perguntou. É a
 *                   pergunta que ela passou a fazer sozinha no lugar de mandar
 *                   alguém abrir um endpoint — ver `lib/prontidao.ts`.
 */
export function apresentar(
  error: unknown,
  prontidao?: RespostaDaProntidao,
): Apresentacao {
  const orientacao = escolherOrientacao(error, prontidao);
  const contexto =
    error instanceof ApiError && error.contexto ? error.contexto : null;
  const mensagem = error instanceof Error ? error.message : String(error);

  return {
    // Sem orientação o contexto viria sozinho e sem remédio — a mensagem crua
    // já o contém por inteiro, e repetir metade dela não ajuda ninguém.
    contexto: orientacao ? contexto : null,
    orientacao,
    mensagemCrua: orientacao ? null : mensagem,
    /*
      Não entra na regra de "uma orientação só": ele não é opinião sobre o que
      houve, é o endereço da linha de log. Convive com qualquer desfecho, e é
      exatamente no desfecho sem orientação — o erro que ninguém sabe explicar
      — que ele é a única coisa acionável que a tela tem para oferecer.
    */
    requestId: error instanceof ApiError ? (error.requestId ?? null) : null,
    /*
      A frase principal sai da orientação e de nenhum outro lugar. Sem
      orientação ela é `null` — e `null` é uma afirmação: **ninguém sabe
      explicar isto**. A tela responde a esse caso mostrando a mensagem crua e o
      identificador da requisição, que é o que de fato se tem; inventar uma
      frase tranquilizadora ali seria a versão educada de não responder.
    */
    principal: orientacao ? (orientacao.humano ?? orientacao.resumo) : null,
    detalhes: detalhesTecnicos(
      orientacao,
      orientacao ? null : mensagem,
      error instanceof ApiError ? (error.requestId ?? null) : null,
    ),
  };
}
