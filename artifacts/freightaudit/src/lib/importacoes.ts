/**
 * O que cada estado de uma importação significa para quem opera — decidido
 * antes de desenhar, e testável sem desenhar.
 *
 * Os nomes internos do pipeline (`import_run_status`) são para quem depura.
 * Tudo que a tela de Importações diz sobre um estado sai daqui, e é aqui que
 * um estado novo do pipeline ganha nome, tom e comportamento — em vez de
 * vazar cru para a tela, que foi exatamente o defeito que este arquivo fecha.
 */

/**
 * Como cada estado se chama e o que ele significa, para quem opera.
 *
 * "Duplicata" era uma palavra só, e ela escondia três situações que pedem
 * reações diferentes: o mesmo arquivo de novo (não faça nada), o mesmo dado num
 * arquivo diferente (não faça nada, e saiba que o número não vai mudar) e uma
 * vigência que já existe (decida se é correção). O estado do run distingue as
 * duas primeiras; a terceira chega como recusa da aprovação.
 */
export const ESTADOS: Record<
  string,
  { rotulo: string; tom: "ok" | "erro" | "neutro" | "espera" }
> = {
  PROMOTED: { rotulo: "aprovada", tom: "ok" },
  PREVIEWED: { rotulo: "conferida", tom: "espera" },
  PENDING: { rotulo: "na fila", tom: "espera" },
  READING: { rotulo: "lendo", tom: "espera" },
  STAGED: { rotulo: "preparada", tom: "espera" },
  PROMOTING: { rotulo: "aprovando", tom: "espera" },
  FAILED: { rotulo: "falhou", tom: "erro" },
  ABORTED: { rotulo: "abortada", tom: "erro" },
  VALIDATION_ERROR: { rotulo: "dado não fecha", tom: "erro" },
  SKIPPED_DUPLICATE: { rotulo: "arquivo já recebido", tom: "neutro" },
  SKIPPED_DUPLICATE_DATA: { rotulo: "dados já registrados", tom: "neutro" },
};

export function estadoDaImportacao(status: string) {
  return ESTADOS[status] ?? { rotulo: status.toLowerCase(), tom: "espera" as const };
}

/**
 * A cara que o cartão de upload faz para um estado do run.
 *
 * `lendo` e `conferida` compõem a linha de detalhe na tela (o progresso, o
 * resumo de fatos e avisos); as demais mostram o motivo que o pipeline gravou
 * no run — `motivoPadrao` é o que se diz quando ele não gravou nenhum.
 */
export interface FaceDoCartao {
  face: "lendo" | "conferida" | "recusada" | "duplicata" | "aprovada";
  /** A frase em negrito do cartão. */
  titulo: string;
  /** O run ainda vai mudar sozinho: o cartão continua perguntando ao servidor. */
  emAndamento: boolean;
  /** O que dizer quando o run não gravou motivo. Nulo nas caras com resumo. */
  motivoPadrao: string | null;
}

/**
 * O cartão conhecia três estados — lendo, conferido, falhou — e todo o resto
 * caía no primeiro. Foi visto na tela: um run recusado por VALIDATION_ERROR
 * aparecia como "Lendo o arquivo…" com o nome interno do enum vazando embaixo
 * ("validation_error… nada entra sem sua aprovação"), o motivo que o pipeline
 * tinha gravado em `failure_reason` não aparecia em lugar nenhum, e o polling
 * não parava nunca — a lista de estados finais era outra lista, escrita à mão,
 * e também não o conhecia.
 *
 * Aqui cada estado terminal tem cara própria, e `emAndamento` é a única
 * autoridade sobre continuar perguntando. Um estado que este arquivo não
 * conhece é tratado como andamento — recusar seria pior que esperar —, mas
 * quem o mostra usa o rótulo de `estadoDaImportacao`, nunca o nome interno.
 */
export function faceDoCartao(status: string | undefined): FaceDoCartao {
  switch (status) {
    case "PREVIEWED":
      return {
        face: "conferida",
        titulo: "Conferido, ainda não importado.",
        emAndamento: false,
        motivoPadrao: null,
      };
    case "FAILED":
      return {
        face: "recusada",
        titulo: "Falhou ao ler o arquivo.",
        emAndamento: false,
        motivoPadrao: "Tente enviar o arquivo de novo.",
      };
    case "VALIDATION_ERROR":
      // Não é falha técnica: o arquivo foi lido inteiro, e o que o pipeline
      // recusou foi o dado. O motivo gravado diz qual conflito foi.
      return {
        face: "recusada",
        titulo: "O dado não fecha — nada foi importado.",
        emAndamento: false,
        motivoPadrao: "Corrija a origem e envie o arquivo de novo.",
      };
    case "ABORTED":
      return {
        face: "recusada",
        titulo: "Importação abortada.",
        emAndamento: false,
        motivoPadrao: "Envie o arquivo de novo para recomeçar.",
      };
    case "SKIPPED_DUPLICATE":
      return {
        face: "duplicata",
        titulo: "Arquivo já recebido.",
        emAndamento: false,
        motivoPadrao:
          "Este arquivo já tinha entrado, byte a byte. Nenhum dado foi importado de novo.",
      };
    case "SKIPPED_DUPLICATE_DATA":
      return {
        face: "duplicata",
        titulo: "Dados já registrados.",
        emAndamento: false,
        motivoPadrao:
          "O arquivo é outro, mas os dados normalizados desta vigência são iguais aos já registrados. Nada foi duplicado.",
      };
    case "PROMOTED":
      return {
        face: "aprovada",
        titulo: "Aprovada e importada.",
        emAndamento: false,
        motivoPadrao: "Os dados deste arquivo já estão no sistema.",
      };
    default:
      return {
        face: "lendo",
        titulo: "Lendo o arquivo…",
        emAndamento: true,
        motivoPadrao: null,
      };
  }
}
