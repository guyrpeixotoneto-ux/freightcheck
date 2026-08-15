import { ApiError } from "@/lib/api";
import { ehDiagnostico, type Diagnostico } from "@/lib/diagnostico";

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
 * **duas recomendações não são representáveis** — há um campo para o
 * diagnóstico, e a mensagem crua só existe quando ele não existe.
 *
 * Pura de propósito, e em `lib/` e não no componente, porque é isto que precisa
 * de teste: o que a tela decide mostrar, não como ela desenha.
 */
export interface Apresentacao {
  /**
   * A requisição não completou — não há resposta nenhuma para diagnosticar.
   * Quando presente, é o texto da explicação; caso contrário, `null`.
   */
  falhaDeRede: string | null;
  /**
   * O que a rota sabe e o diagnóstico não: qual schema falta, e o que houve com
   * o arquivo enviado. **Nunca recomenda nada** — é por isso que pode aparecer
   * ao lado do diagnóstico sem voltar a ser uma segunda opinião.
   */
  contexto: string | null;
  /** A recomendação. Quando existe, é a única que a tela apresenta. */
  diagnostico: Diagnostico | null;
  /**
   * A mensagem do servidor, crua.
   *
   * Só é preenchida quando **não** há diagnóstico — erro não tipado, um bundle
   * antigo ainda no ar, uma rota que não passa por `responderSchemaAusente`. Aí
   * ela é a única coisa que se tem, e não uma opinião concorrente.
   */
  mensagemCrua: string | null;
  /** O link para o `/healthz`, que só ajuda quando não se diagnosticou nada. */
  mostrarLinkHealthz: boolean;
}

export const FALHA_DE_REDE =
  "A requisição não completou: esta tela não chegou a receber resposta " +
  "nenhuma do servidor, nem de erro. Abra /api/healthz para saber qual dos " +
  'dois casos é. Sem resposta, o processo "API Server" não está de pé. Com ' +
  "resposta, ele está — e o que caiu foi só esta chamada, no meio do " +
  "caminho; o registro do processo diz o que aconteceu na hora.";

/**
 * A falha que acontece antes de existir resposta.
 *
 * `fetch` rejeita com `TypeError` quando a requisição não completa — conexão
 * recusada, DNS, o proxy do Vite sem servidor atrás. O navegador escreve isso
 * como "Failed to fetch" (ou "Load failed", no Safari), palavras que não dizem
 * a quem lê sequer de que lado o defeito está.
 *
 * Nenhum erro nosso é `TypeError`: `ApiError` e o que `readJson` levanta são
 * `Error`, então a checagem não captura falha de servidor por engano.
 */
function ehFalhaDeRede(error: unknown): boolean {
  return error instanceof TypeError;
}

/** O diagnóstico que vale para este erro, do mais próximo ao mais distante. */
function escolherDiagnostico(
  error: unknown,
  saude: { diagnostico?: Diagnostico } | undefined,
): Diagnostico | null {
  /*
    O que veio no próprio erro descreve o banco no instante em que a chamada
    falhou. O do `/healthz` é uma segunda pergunta, feita depois. Quando os dois
    existem vêm da mesma função e dos mesmos fatos — mas o primeiro é o do
    momento certo.
  */
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
  if (ehFalhaDeRede(error)) {
    return {
      falhaDeRede: FALHA_DE_REDE,
      contexto: null,
      diagnostico: null,
      mensagemCrua: null,
      mostrarLinkHealthz: false,
    };
  }

  const diagnostico = escolherDiagnostico(error, saude);
  const contexto =
    error instanceof ApiError && error.contexto ? error.contexto : null;
  const mensagem = error instanceof Error ? error.message : String(error);

  return {
    falhaDeRede: null,
    // Sem diagnóstico o contexto viria sozinho e sem remédio — a mensagem crua
    // já o contém por inteiro, e repetir metade dela não ajuda ninguém.
    contexto: diagnostico ? contexto : null,
    diagnostico,
    mensagemCrua: diagnostico ? null : mensagem,
    mostrarLinkHealthz: diagnostico === null,
  };
}
