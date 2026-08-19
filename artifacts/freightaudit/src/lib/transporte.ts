import type { Orientacao } from "@/lib/diagnostico";

/**
 * O que aconteceu com a **requisição** — o outro eixo de diagnóstico.
 *
 * O diagnóstico do banco responde "este ambiente tem onde guardar?". Este
 * responde uma pergunta anterior: a requisição chegou a alguém, e o que voltou
 * era nosso? Os dois são independentes, e confundi-los manda procurar no lugar
 * errado nas duas direções — um banco impecável não explica um roteador sem
 * ninguém atrás, e um processo de pé não explica uma migration que falta.
 *
 * As frases viviam soltas dentro de `readJson`, escritas em `throw new
 * Error(...)`. Era a mesma classe de problema que produziu, no eixo do banco,
 * dois avisos contraditórios na mesma tela: texto de diagnóstico escrito onde
 * o erro acontece, sem tipo, sem lugar único, e portanto livre para divergir do
 * resto. Aqui elas passam a ter dono, e a sair na mesma forma (`Orientacao`) do
 * outro eixo — o que permite à tela desenhar um caminho só.
 */

export type EstadoDoTransporte =
  /** `fetch` rejeitou: a requisição não completou, não houve resposta. */
  | "SEM_RESPOSTA"
  /** 5xx de corpo vazio: não há ninguém atrás de `/api`. */
  | "API_AUSENTE"
  /** 2xx de corpo vazio: a resposta foi cortada a caminho. */
  | "RESPOSTA_INCOMPLETA"
  /** Veio corpo, e ele não é JSON: quem respondeu não é a nossa API. */
  | "RESPOSTA_ESTRANHA"
  /** Erro de status conhecido, sem corpo que o explique. */
  | "ERRO_SEM_CORPO";

export interface DiagnosticoDeTransporte extends Orientacao {
  estado: EstadoDoTransporte;
  /**
   * O status HTTP observado, quando houve um.
   *
   * Não é decoração nem repetição da `evidencia`: é o que separa "transitório"
   * de "definitivo" sem reler texto. `resiliencia.ts` decide por ele se vale
   * tentar de novo, e `registro-de-falhas.ts` o grava. Ausente em
   * `SEM_RESPOSTA` — e essa ausência é o próprio fato: não houve resposta.
   */
  status?: number;
}

/** O que se observou da resposta — tudo de que a classificação precisa. */
export interface TransporteObservado {
  /** `fetch` rejeitou antes de existir resposta. */
  naoCompletou?: boolean;
  /** O status HTTP, quando houve resposta. */
  status?: number;
  /** O corpo veio vazio. */
  corpoVazio?: boolean;
  /** O corpo veio, e não era JSON. Traz um trecho para quem investiga. */
  corpoNaoJson?: string;
}

/**
 * Nenhum destes casos põe dado em risco, e isso precisa estar escrito.
 *
 * Quem acabou de subir um arquivo e vê um erro faz uma pergunta antes de todas:
 * "perdi o que mandei?". Em todo caso deste módulo a resposta é não — ou a
 * requisição não chegou, ou quem respondeu não foi a nossa API, e em nenhum dos
 * dois houve escrita. Deixar isso implícito faz alguém reenviar por medo, que é
 * como um upload vira dois.
 */
const NADA_ENVIADO = {
  emRisco: false,
  texto:
    "Nada foi gravado e nada se perdeu: o que você mandou não chegou a ser " +
    "processado.",
} as const;

/**
 * A ação para quando **houve** resposta, e ela veio de antes da API.
 *
 * O que autoriza esta frase é ter havido resposta: um 5xx de corpo vazio só
 * pode ter sido escrito pelo roteador ou pelo proxy, porque toda resposta desta
 * API é JSON. Aí sim "não há ninguém atrás do /api" é um fato observado, e não
 * uma hipótese — e mandar conferir o processo aponta para onde o defeito está.
 */
const SUBIR_A_API = {
  codigo: "RESTABELECER_API",
  texto:
    'Conferir se o processo "API Server" está de pé. Não é algo que se ' +
    "resolva pela tela, e reenviar o arquivo não muda o resultado.",
  quem: "plataforma",
} as const;

/**
 * A ação para quando **não** houve resposta — e por isso não se sabe o que caiu.
 *
 * Esta constante existe por um defeito que sobreviveu a uma correção. O
 * `SEM_RESPOSTA` recomendava `SUBIR_A_API` como todos os outros estados; numa
 * passagem anterior o `resumo` foi reescrito para admitir as duas causas, e a
 * **ação continuou mandando conferir o processo**. O efeito é o pior possível
 * para quem opera: a frase reconhece que pode não ser a API, e a linha em
 * negrito logo abaixo — a única que se lê com pressa — manda conferir a API. A
 * pessoa confere, encontra o processo de pé, e volta à mesma tela com o mesmo
 * aviso. Foi exatamente esse laço que fez a pergunta "por que esse erro
 * continua dando?".
 *
 * E a recomendação não era só inútil: era improvável. Com o processo fora do
 * ar, quem responde é a camada de antes — o roteador do Replit com 502 de corpo
 * vazio, ou o proxy do Vite com 500 de corpo vazio (medido: `connect
 * ECONNREFUSED` no log do Vite, `HTTP/1.1 500`, `Content-Type: text/plain`,
 * zero bytes). Os dois caem em `API_AUSENTE`, que é outro estado, com outro
 * texto. Chegar em `SEM_RESPOSTA` é chegar no caso em que a API derrubada é a
 * hipótese **menos** compatível com o que se observou.
 *
 * O que resta a fazer é medir, e o código de rede da própria chamada é o que
 * separa as três causas. Por isso a ação é olhar o código, e não subir nada.
 */
const IDENTIFICAR_A_QUEDA = {
  codigo: "IDENTIFICAR_QUEDA",
  texto:
    "Ver o código de rede desta chamada em DevTools → Network (ou rodar a " +
    "sonda abaixo). Ele separa as três causas, e cada uma pede uma coisa " +
    "diferente. Reenviar o arquivo não muda o resultado em nenhuma delas.",
  comando: "node scripts/sonda-cold-start.mjs <url-do-app>",
  quem: "plataforma",
} as const;

/**
 * A única autoridade de classificação do transporte.
 *
 * Pura, como a do banco e pelo mesmo motivo: é o que permite exercitar os cinco
 * casos sem um servidor do lado, e é o que garante que `readJson`, `fetchJson`
 * e a tela cheguem à mesma conclusão a partir dos mesmos fatos.
 */
export function diagnosticarTransporte(
  observado: TransporteObservado,
): DiagnosticoDeTransporte {
  if (observado.naoCompletou) {
    return {
      estado: "SEM_RESPOSTA",
      /*
        `fetch` rejeita com `TypeError` quando a requisição não completa —
        conexão recusada, DNS, um redirect de outra origem barrado por CORS. O
        navegador escreve todas assim, "Failed to fetch" (ou "Load failed", no
        Safari), palavras que não dizem sequer de que lado o defeito está.

        O que **não** cabe aqui é a API derrubada, e essa é a correção. Com o
        processo fora do ar quem responde é a camada anterior, e ela responde:
        502 de corpo vazio pelo roteador do Replit, 500 de corpo vazio pelo
        proxy do Vite. Houve resposta, então o caminho é `API_AUSENTE` logo
        abaixo — nunca este. A versão anterior deste texto mandava conferir o
        processo "API Server" justamente no estado em que ele é a hipótese menos
        compatível com o observado, e quem seguia a instrução encontrava o
        processo de pé e voltava à mesma tela.
      */
      resumo:
        "A requisição não completou: esta tela não chegou a receber resposta " +
        "nenhuma do servidor — nem de erro, nem do roteador. Isso descarta o " +
        'processo "API Server" fora do ar, que responderia 502 e apareceria ' +
        "aqui como outro aviso. Sobram três causas: a origem inteira " +
        "indisponível (Repl dormindo, cold start, reinício), a conexão cortada " +
        "no meio, ou a sessão do ambiente expirada.",
      risco: NADA_ENVIADO,
      acao: IDENTIFICAR_A_QUEDA,
      evidencia:
        "Sem status: o navegador não chegou a receber linha de resposta. O " +
        "código de rede da chamada é o que separa as três — " +
        "ERR_CONNECTION_REFUSED e ERR_NAME_NOT_RESOLVED são a origem fora do " +
        "ar; ERR_EMPTY_RESPONSE e ERR_CONNECTION_RESET são a conexão cortada; " +
        "um erro de CORS citando outro domínio é a sessão expirada.",
    };
  }

  const status = observado.status;

  if (observado.corpoNaoJson !== undefined) {
    return {
      estado: "RESPOSTA_ESTRANHA",
      resumo:
        "Veio uma resposta, e ela não é da nossa API: toda resposta daqui é " +
        "JSON, mesmo quando é erro. O que respondeu foi outra camada — um " +
        "proxy, um roteador, uma página de erro do ambiente.",
      risco: NADA_ENVIADO,
      acao: SUBIR_A_API,
      ...(status === undefined ? {} : { status }),
      evidencia: `Status ${status ?? "desconhecido"}. Começo do corpo: ${observado.corpoNaoJson.slice(0, 160)}`,
    };
  }

  if (observado.corpoVazio) {
    /*
      Um 5xx de corpo vazio nunca é nosso: toda resposta desta API é JSON,
      mesmo quando é erro. Corpo vazio quer dizer que a requisição parou numa
      camada antes — o roteador sem ninguém na porta (502), ou o proxy do Vite
      sem servidor atrás (500). Dizer "o servidor respondeu" a respeito de um
      servidor que não chegou a ser consultado mandou uma tela ser reescrita
      duas vezes atrás de um defeito que estava no ambiente.
    */
    if (status !== undefined && status >= 500) {
      return {
        estado: "API_AUSENTE",
        resumo:
          "A interface está no ar, mas o servidor por trás de /api não está. " +
          "A requisição parou numa camada antes de chegar nele.",
        risco: NADA_ENVIADO,
        acao: SUBIR_A_API,
        status,
        evidencia: `Status ${status}, sem corpo — e toda resposta desta API é JSON, mesmo quando é erro.`,
      };
    }

    if (status !== undefined && status >= 400) {
      return {
        estado: "ERRO_SEM_CORPO",
        resumo: `O servidor respondeu ${status} sem detalhar o motivo.`,
        risco: NADA_ENVIADO,
        acao: null,
        status,
        evidencia: `Status ${status}, sem corpo.`,
      };
    }

    return {
      estado: "RESPOSTA_INCOMPLETA",
      resumo:
        `O servidor respondeu ${status ?? "com sucesso"} sem conteúdo. A ` +
        "conexão pode ter sido interrompida a caminho.",
      risco: NADA_ENVIADO,
      acao: null,
      ...(status === undefined ? {} : { status }),
    };
  }

  // Chamar isto sem observação nenhuma é defeito de quem chamou, e não um
  // estado do transporte. Responder "está tudo bem" esconderia esse defeito.
  return {
    estado: "RESPOSTA_ESTRANHA",
    resumo: "A resposta do servidor não pôde ser interpretada.",
    risco: NADA_ENVIADO,
    acao: SUBIR_A_API,
  };
}

/**
 * A falha de transporte como exceção, carregando o diagnóstico junto.
 *
 * `Error` de mensagem solta era o que impedia a tela de distinguir "o roteador
 * não tem ninguém atrás" de "o arquivo que você mandou não serve" — as duas
 * chegavam como uma linha de texto. Com o tipo, a tela decide; sem ele, ela
 * adivinhava pela frase.
 */
export class ErroDeTransporte extends Error {
  readonly diagnostico: DiagnosticoDeTransporte;

  constructor(diagnostico: DiagnosticoDeTransporte) {
    super(diagnostico.resumo);
    this.name = "ErroDeTransporte";
    this.diagnostico = diagnostico;
  }
}
