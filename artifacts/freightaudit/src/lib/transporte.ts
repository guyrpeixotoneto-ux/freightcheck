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
  | "ERRO_SEM_CORPO"
  /** Fomos nós que cancelamos: navegação, desmontagem, `AbortController`. */
  | "REQUISICAO_CANCELADA";

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
  /**
   * A frase que o navegador escreveu ao rejeitar o `fetch`.
   *
   * "Failed to fetch", "Load failed", "NetworkError when attempting to fetch
   * resource" — ela não diz de que lado o defeito está, e mesmo assim é a única
   * pista de primeira mão que existe. Ela se perdia porque o `TypeError` subia
   * cru e era reclassificado por `instanceof` lá na frente; agora entra na
   * evidência, ao lado do que se sabe e do que se supõe.
   */
  motivo?: string;
  /** A chamada foi cancelada por nós, e não pela rede. */
  cancelada?: boolean;
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
 * Esta constante já foi reescrita duas vezes, e as duas correções erraram na
 * mesma direção: a de **afirmar demais**.
 *
 * A primeira versão recomendava `SUBIR_A_API`, como todos os outros estados.
 * Isso é improvável e foi medido: com o processo fora do ar quem responde é a
 * camada de antes — 502 de corpo vazio pelo roteador do Replit, 500 de corpo
 * vazio pelo proxy do Vite (`connect ECONNREFUSED` no log, `Content-Type:
 * text/plain`, zero bytes). Os dois caem em `API_AUSENTE`, que é outro estado.
 * A pessoa conferia o processo, encontrava-o de pé, e voltava ao mesmo aviso.
 *
 * A segunda mandava abrir DevTools → Network ou rodar a sonda para "separar as
 * três causas". Trocou uma recomendação errada por uma tarefa de engenharia
 * entregue a quem só queria a lista — e continuou afirmando mais do que o
 * navegador permite: que as causas possíveis são exatamente três e que a API
 * fora do ar estava descartada.
 *
 * O que de fato se sabe neste estado é pouco e é preciso: **não veio resposta**.
 * Não veio status, não veio cabeçalho, e por isso não há como dizer daqui de que
 * lado a coisa parou. O produto não pode depender de alguém abrir o console para
 * funcionar: ele repete sozinho, e é isso que a ação diz.
 */
const AGUARDAR_A_VOLTA = {
  codigo: "IDENTIFICAR_QUEDA",
  /*
    O texto anterior mandava a pessoa abrir DevTools → Network ou rodar
    `node scripts/sonda-cold-start.mjs`. As duas coisas são úteis — e nenhuma
    das duas é ação de quem está usando o produto. Pedir isso é transferir o
    diagnóstico para quem só queria a lista, e é admitir que o sistema depende
    de alguém abrir o console para funcionar. Ele não depende: a chamada é
    repetida sozinha cinco vezes ao longo de 13,2s (`resiliencia.ts`), e o botão
    ao lado repete agora.

    A sonda continua existindo e continua sendo o instrumento certo — para quem
    investiga. Ela desceu para a `evidencia`, que é a letra miúda dirigida a
    engenharia, em vez de ocupar a linha em negrito que se lê com pressa.
  */
  texto:
    "Não há nada a instalar nem a configurar: a tela repete a chamada sozinha " +
    "por alguns segundos, e o botão abaixo tenta agora. Se continuar falhando " +
    "depois disso, o caminho até o servidor precisa ser olhado por quem cuida " +
    "do ambiente — com a evidência abaixo.",
  quem: "operador",
} as const;

/**
 * A única autoridade de classificação do transporte.
 *
 * Pura, como a do banco e pelo mesmo motivo: é o que permite exercitar os seis
 * casos sem um servidor do lado, e é o que garante que `readJson`, `fetchJson`
 * e a tela cheguem à mesma conclusão a partir dos mesmos fatos.
 */
export function diagnosticarTransporte(
  observado: TransporteObservado,
): DiagnosticoDeTransporte {
  /*
    O cancelamento vem antes de tudo porque não é falha: é uma chamada que nós
    interrompemos. Classificá-lo como queda de rede faria a tela acusar a
    plataforma por uma navegação — e faria a política de repetição insistir numa
    chamada que ninguém quer mais.
  */
  if (observado.cancelada) {
    return {
      estado: "REQUISICAO_CANCELADA",
      resumo:
        "A chamada foi cancelada antes de terminar — normalmente porque a tela " +
        "mudou enquanto ela estava em andamento.",
      risco: NADA_ENVIADO,
      acao: null,
      evidencia: "Cancelada pela própria interface; nenhuma resposta foi pedida ao servidor.",
    };
  }

  if (observado.naoCompletou) {
    /*
      O que se sabe aqui é uma coisa só: não veio resposta. Nem status, nem
      cabeçalho, nem corpo.

      O texto anterior ia muito além disso. Dizia que o processo "API Server"
      fora do ar estava **descartado** ("responderia 502 e apareceria aqui como
      outro aviso") e que sobravam **exatamente três** causas. As duas
      afirmações são inferências que o navegador não sustenta: ele não sabe se
      houve um 502 que não chegou, não sabe se quem caiu foi o roteador, a rede
      local ou a origem, e a lista de causas possíveis não é fechada.

      Pior: neste produto a primeira afirmação era falsa por construção. A tela
      de Unidades compartilhava a chave `["contexts"]` com a barra lateral, cuja
      `queryFn` traduzia todo `!response.ok` em lista vazia — então um 502
      **nunca** chegaria aqui como outro aviso; chegaria como "nenhuma vigência
      importada". A frase que dizia ter descartado a API fora do ar era, ela
      mesma, o efeito de a API fora do ar ter sido descartada antes, no caminho.
      Ver `lib/contextos.ts`.

      A separação abaixo é a que a interface pode honrar: o que se **sabe**
      (fato observado), o que se **supõe** (as causas comuns, nomeadas como
      hipótese), e o que **acontece** (a tela repete sozinha).
    */
    return {
      estado: "SEM_RESPOSTA",
      resumo:
        "O que se sabe: o navegador não recebeu resposta nenhuma desta " +
        "chamada — nem status, nem cabeçalho. Não dá para dizer daqui de que " +
        "lado ela parou. O que costuma ser: a origem indisponível por instantes " +
        "(reinício, partida a frio, o serviço acordando), a conexão " +
        "interrompida, ou a rede deste computador. Nenhuma delas é descartável " +
        "com o que se tem, e as três passam sozinhas.",
      risco: NADA_ENVIADO,
      acao: AGUARDAR_A_VOLTA,
      evidencia:
        (observado.motivo ? `O navegador disse: "${observado.motivo}". ` : "") +
        "Sem status: não houve linha de resposta para ler. Para quem " +
        "investiga, o código de rede da chamada (DevTools → Network) é o que " +
        "distingue as hipóteses — ERR_CONNECTION_REFUSED e " +
        "ERR_NAME_NOT_RESOLVED apontam a origem fora do ar; ERR_EMPTY_RESPONSE " +
        "e ERR_CONNECTION_RESET, a conexão interrompida; um erro de CORS " +
        "citando outro domínio, a sessão do ambiente expirada. " +
        "`node scripts/sonda-cold-start.mjs <url-do-app>` mede se a origem está " +
        "sendo recolhida entre os acessos.",
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
      /*
        A frase do navegador aparece quando houve uma: é o caso do corpo cortado
        no meio da leitura (ver `readJson`), que sem ela era indistinguível de um
        204 legítimo — e, pior, era anunciado como "não houve resposta nenhuma"
        sobre uma chamada cujo status a tela tinha acabado de ler.
      */
      ...(observado.motivo === undefined
        ? {}
        : {
            evidencia:
              `Status ${status ?? "desconhecido"}, e a leitura do corpo falhou: ` +
              `"${observado.motivo}".`,
          }),
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
