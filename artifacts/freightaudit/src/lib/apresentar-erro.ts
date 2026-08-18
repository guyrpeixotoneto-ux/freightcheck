import { ApiError } from "@/lib/api";
import { ehDiagnostico, type Diagnostico } from "@/lib/diagnostico";
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
  /** O link para o `/healthz`, que só ajuda quando não se orientou nada. */
  mostrarLinkHealthz: boolean;
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
  saude: { diagnostico?: Diagnostico } | undefined,
): OrientacaoApresentada | null {
  if (error instanceof ErroDeTransporte) return error.diagnostico;

  /*
    `fetch` rejeita com `TypeError` quando a requisição não completa. Nenhum
    erro nosso é `TypeError` — `ApiError` e `ErroDeTransporte` são `Error` —,
    então a checagem não captura falha de servidor por engano.
  */
  if (error instanceof TypeError) {
    return diagnosticarTransporte({ naoCompletou: true });
  }

  if (error instanceof ApiError && ehDiagnostico(error.diagnostico)) {
    return error.diagnostico;
  }

  if (saude && ehDiagnostico(saude.diagnostico)) {
    /*
      Um banco saudável não explica o erro que trouxe alguém até aqui: a causa
      está em outro lugar, e imprimir "está tudo certo" ao lado de uma falha
      manda procurar no lugar errado. Some, e a mensagem crua volta a ser o que
      se tem — que é a verdade nesse caso.
    */
    return saude.diagnostico.estado === "SAUDAVEL" ? null : saude.diagnostico;
  }

  return null;
}

export function apresentar(
  error: unknown,
  saude?: { diagnostico?: Diagnostico },
): Apresentacao {
  const orientacao = escolherOrientacao(error, saude);
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
    mostrarLinkHealthz: orientacao === null,
  };
}
