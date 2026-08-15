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

/** A ação de quem opera a plataforma, que é a mesma em quase todos os casos. */
const SUBIR_A_API = {
  codigo: "RESTABELECER_API",
  texto:
    'Conferir se o processo "API Server" está de pé. Não é algo que se ' +
    "resolva pela tela, e reenviar o arquivo não muda o resultado.",
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
        conexão recusada, DNS, o proxy do Vite sem servidor atrás. O navegador
        escreve isso como "Failed to fetch" (ou "Load failed", no Safari),
        palavras que não dizem sequer de que lado o defeito está.

        As duas causas se separam com uma pergunta: o `/api/healthz` responde?
        Culpar o processo inteiro nos dois casos mandava procurar um servidor
        derrubado que estava de pé o tempo todo — a tela em que isso apareceu só
        é alcançável depois de a sessão ter sido confirmada pela mesma API.
      */
      resumo:
        "A requisição não completou: esta tela não chegou a receber resposta " +
        "nenhuma do servidor, nem de erro. Abra /api/healthz para saber qual " +
        'dos dois casos é. Sem resposta, o processo "API Server" não está de ' +
        "pé. Com resposta, ele está — e o que caiu foi só esta chamada, no " +
        "meio do caminho.",
      risco: NADA_ENVIADO,
      acao: SUBIR_A_API,
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
        evidencia: `Status ${status}, sem corpo — e toda resposta desta API é JSON, mesmo quando é erro.`,
      };
    }

    if (status !== undefined && status >= 400) {
      return {
        estado: "ERRO_SEM_CORPO",
        resumo: `O servidor respondeu ${status} sem detalhar o motivo.`,
        risco: NADA_ENVIADO,
        acao: null,
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
