/**
 * A forma que um apontamento de importação tem quando chega a uma pessoa.
 *
 * ---------------------------------------------------------------------------
 * Por que existe uma forma, e não só uma frase
 * ---------------------------------------------------------------------------
 * Todo apontamento sempre teve `message` — uma frase — e `detail` — o que o
 * pipeline sabia na hora, cru. A frase melhorou com o tempo, mas continuava
 * sendo um parágrafo: quando o conflito envolvia três campos, a frase tinha as
 * três divergências emendadas; quando a chave era composta, o CNPJ e o cargo
 * vinham colados no meio do texto. Quem lia precisava desmontar o parágrafo de
 * olho para responder as perguntas que toda recusa levanta: o que aconteceu?
 * onde? de que registro se trata? o que exatamente difere? o que eu faço? e
 * por que a importação não seguiu sozinha?
 *
 * Esta interface é essas perguntas, uma a uma, como **dado** — e a tela as
 * apresenta como seções, não como parágrafo. O pipeline responde o que souber;
 * seção sem resposta fica de fora e a tela não a desenha. `message` continua
 * existindo e continua legível: é o fallback de tela para apontamentos antigos
 * (gravados antes desta forma existir), o texto dos logs e o que os testes
 * leem.
 *
 * ---------------------------------------------------------------------------
 * Por que mora em `detail`, e não numa coluna nova
 * ---------------------------------------------------------------------------
 * `validation_issue.detail` é JSONB sem contrato — cada código anota o que o
 * seu caso pede. A apresentação entra ali sob a chave `apresentacao` porque é
 * exatamente isso: uma anotação a mais, que apontamentos antigos não têm e não
 * precisam ganhar retroativamente. Uma coluna exigiria migration e obrigaria
 * backfill ou NULL — e NULL numa coluna diz menos que a ausência de uma chave
 * num JSON que já é opcional inteiro.
 *
 * ---------------------------------------------------------------------------
 * Por que este arquivo não importa nada
 * ---------------------------------------------------------------------------
 * Pelo mesmo motivo de `tipos.ts`: a tela de Importações precisa destes tipos
 * e destes rótulos, e pedi-los pelo índice de `@workspace/ingest` arrastaria
 * `xlsx` e o `pg` inteiro para o bundle do navegador. Sem import, o subcaminho
 * `@workspace/ingest/apontamentos` é publicável para os dois lados — e o
 * pipeline que escreve e a tela que desenha leem o mesmo contrato, que é a
 * única forma de eles nunca discordarem sobre o que é uma seção.
 */

export type SeveridadeDeApontamento = "ERROR" | "WARNING" | "INFO";

/** O nome de cada severidade, sem dizer nada sobre bloqueio — ver o selo. */
export const ROTULO_DE_SEVERIDADE: Record<SeveridadeDeApontamento, string> = {
  ERROR: "Erro",
  WARNING: "Aviso",
  INFO: "Informação",
};

/**
 * Os códigos cuja presença impede aprovar a importação inteira.
 *
 * ERRO e bloqueio são coisas diferentes, e a tela não pode confundi-las: uma
 * linha sem placa é ERRO e recusa **aquela linha** — o arquivo segue
 * aprovável; a mesma chave com dois valores é ERRO e segura **o arquivo**,
 * porque não existe resposta certa para promover. O selo do cartão escreve
 * essa diferença ("Erro bloqueante" contra "Erro"), e escrever exige saber —
 * este Set é a lista, aqui porque o pipeline (que recusa por ela) e a tela
 * (que a anuncia) precisam ler a mesma, e este é o módulo que os dois
 * alcançam.
 */
export const CODIGOS_QUE_BLOQUEIAM_PROMOCAO: ReadonlySet<string> = new Set([
  "ENTIDADE_DUPLICADA_CONFLITANTE",
  "TIPO_DIVERGE_DA_DECLARACAO",
]);

/**
 * O texto do selo de um apontamento: a severidade com a consequência dentro.
 *
 * "ERROR" cru diria menos do que a tela sabe; "Erro bloqueante" em todo ERRO
 * diria mais do que é verdade. O selo diz exatamente o que o código faz.
 */
export function rotuloDoSelo(severity: string, code: string): string {
  if (severity === "ERROR") {
    return CODIGOS_QUE_BLOQUEIAM_PROMOCAO.has(code) ? "Erro bloqueante" : "Erro";
  }
  return ROTULO_DE_SEVERIDADE[severity as SeveridadeDeApontamento] ?? severity;
}

/** Onde o problema está, dito como quem abre a planilha procura. */
export interface OndeDoApontamento {
  aba: string;
  /** Linhas como o Excel as numera. Ausente quando o problema é da aba toda. */
  linhas?: number[];
  /** A coluna, quando o problema é de uma coluna e não de linhas. */
  coluna?: string;
}

/**
 * Um campo que identifica o registro envolvido, com o nome que a planilha usa.
 *
 * É a resposta a "de quem estamos falando?" sem a chave normalizada: em vez de
 * `07526557001505CARGOCONFERENTE…`, duas linhas — `Unidade - CNPJ:
 * 07.526.557/0015-05` e `Cargo: CONFERENTE…`.
 */
export interface CampoDeRegistro {
  campo: string;
  valor: string;
}

/** Um dos valores em desacordo, com a linha de onde ele veio. */
export interface VersaoDeValor {
  aba?: string;
  linha?: number;
  valor: string;
}

/** Um campo em que as linhas discordam: a coluna pelo nome real, e as versões. */
export interface DiferencaDeApontamento {
  /** O cabeçalho como está escrito na planilha; o código só na falta dele. */
  campo: string;
  versoes: VersaoDeValor[];
}

/** As seções de um apontamento, na ordem em que a tela as apresenta. */
export interface ApresentacaoDeApontamento {
  /** O que aconteceu, numa linha — o título do cartão. */
  titulo: string;
  /** O mesmo, com o essencial do contexto: vigência, quantas linhas, o efeito. */
  resumo: string;
  /** Onde encontramos: aba, linhas, coluna. */
  onde?: OndeDoApontamento[];
  /** Qual registro está envolvido, em campos humanos. */
  registro?: CampoDeRegistro[];
  /** O que está diferente, estruturado — nunca um parágrafo. */
  diferencas?: DiferencaDeApontamento[];
  /** O que fazer para resolver. */
  comoCorrigir?: string;
  /** Por que o FreightCheck agiu assim (bloqueou, avisou, consolidou). */
  porQueImporta?: string;
}

/** A chave, dentro de `validation_issue.detail`, onde a apresentação mora. */
export const CHAVE_DA_APRESENTACAO = "apresentacao";

/**
 * A apresentação de um `detail`, ou `null` quando ele não tem uma que sirva.
 *
 * A tela lê `detail` de uma coluna JSONB que já foi escrita por várias versões
 * do pipeline e será escrita por outras — confiar no formato seria quebrar a
 * tela no primeiro apontamento antigo. A verificação aqui é o mínimo que o
 * desenho exige (as duas seções obrigatórias, como texto); as opcionais são
 * conferidas onde são usadas, e qualquer coisa fora da forma degrada para o
 * fallback (`message`), nunca para uma tela quebrada.
 */
export function apresentacaoDoDetalhe(
  detail: unknown,
): ApresentacaoDeApontamento | null {
  if (detail === null || typeof detail !== "object") return null;
  const candidata = (detail as Record<string, unknown>)[CHAVE_DA_APRESENTACAO];
  if (candidata === null || typeof candidata !== "object") return null;
  const { titulo, resumo } = candidata as Record<string, unknown>;
  if (typeof titulo !== "string" || typeof resumo !== "string") return null;
  return candidata as unknown as ApresentacaoDeApontamento;
}
