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
 * aprovável; uma aba que prometia um tipo e entregou outro é ERRO e segura
 * **o arquivo**, porque não há parte aproveitável de um arquivo que não é o
 * que disse ser. O selo do cartão escreve essa diferença, e escrever exige
 * saber — este Set é a lista, aqui porque o pipeline (que recusa por ela) e a
 * tela (que a anuncia) precisam ler a mesma, e este é o módulo que os dois
 * alcançam.
 */
export const CODIGOS_QUE_BLOQUEIAM_PROMOCAO: ReadonlySet<string> = new Set([
  "TIPO_DIVERGE_DA_DECLARACAO",
  // Aba rebaixada com tipo declarado: alguém disse que aquela aba era de um
  // tipo e a leitura não a reconheceu como tal. Promover importaria uma
  // vigência sem o que foi prometido — silêncio no lugar do dado.
  "ABA_REBAIXADA_COM_TIPO_DECLARADO",
]);

/**
 * Os códigos que retiram **uma chave** da importação e deixam o resto entrar.
 *
 * ---------------------------------------------------------------------------
 * Por que esta categoria existe, e por que ela não é bloqueio
 * ---------------------------------------------------------------------------
 * A duplicidade conflitante — a mesma entidade duas vezes na mesma vigência
 * com valores que discordam — já foi bloqueio de arquivo, e o preço apareceu
 * na tela: um QLP com 11.760 fatos bons parava inteiro por 8 chaves em
 * conflito, e a saída oferecida era corrigir a origem e reenviar. Oito
 * problemas seguravam onze mil respostas.
 *
 * O que não pode acontecer continua não acontecendo: o pipeline não escolhe em
 * silêncio entre dois valores conflitantes. Ele **não escolhe** — a chave fica
 * de fora da importação, com toda a evidência gravada no apontamento, e o
 * resto da vigência entra. É uma terceira consequência, e ela precisa de nome
 * próprio: "Erro" faria a tela dizer que só aquela linha caiu (não caiu: caiu
 * o registro inteiro, em todas as suas colunas), e "Erro bloqueante" faria a
 * tela dizer que nada entrou (entrou quase tudo).
 *
 * Quem lê isto junto com {@link CODIGOS_QUE_BLOQUEIAM_PROMOCAO} vê as três
 * consequências que uma importação pode ter, e elas são exaustivas: a linha
 * cai, o registro cai, ou o arquivo cai.
 */
export const CODIGOS_QUE_ISOLAM_A_CHAVE: ReadonlySet<string> = new Set([
  "ENTIDADE_DUPLICADA_CONFLITANTE",
]);

/**
 * Um apontamento reduzido ao que decide a consequência dele.
 *
 * Não é a linha inteira de `validation_issue`: as duas perguntas abaixo se
 * respondem com o código e a severidade, e pedir mais do que isso impediria
 * fazê-las sobre uma contagem agrupada — que é a forma como o pipeline e a
 * leitura de estado do run olham os apontamentos.
 */
export interface ApontamentoClassificavel {
  code: string;
  severity: string;
}

/**
 * Este apontamento impede aprovar o arquivo inteiro?
 *
 * ---------------------------------------------------------------------------
 * Por que é uma função, e não a consulta ao Set
 * ---------------------------------------------------------------------------
 * A pergunta tem duas partes — a severidade **e** o código —, e foi a segunda
 * parte esquecida em um dos lugares que produziu o defeito que este arquivo
 * fecha: a tela perguntava só `errors > 0`, o pipeline perguntava as duas, e um
 * QLP com 8 chaves em quarentena e nenhum impedimento ficava com o botão
 * "Aprovar e importar" desabilitado enquanto o pipeline o considerava
 * perfeitamente aprovável. Os dois lados diziam responder à mesma pergunta e
 * respondiam a duas.
 *
 * Hoje quem quer saber chama isto: o pipeline ao gravar o desfecho da
 * pré-visualização, a leitura de estado do run ao contar o que impede, e a tela
 * ao decidir se o botão pode ser apertado. Uma pergunta, uma resposta, um lugar
 * onde ela muda.
 */
export function impedePromocao(apontamento: ApontamentoClassificavel): boolean {
  return (
    apontamento.severity === "ERROR" &&
    CODIGOS_QUE_BLOQUEIAM_PROMOCAO.has(apontamento.code)
  );
}

/**
 * Este apontamento retira uma chave e deixa o resto do arquivo entrar?
 *
 * A severidade não entra na conta de propósito: a quarentena é consequência do
 * **código**, e um dia em que ela deixe de ser ERRO — porque deixar um registro
 * de fora com a evidência gravada talvez não seja erro nenhum — não pode fazer
 * a contagem de chaves retidas cair para zero sem que ninguém tenha mexido nela.
 */
export function isolaAChave(apontamento: { code: string }): boolean {
  return CODIGOS_QUE_ISOLAM_A_CHAVE.has(apontamento.code);
}

/**
 * O texto do selo de um apontamento: a severidade com a consequência dentro.
 *
 * "ERROR" cru diria menos do que a tela sabe; "Erro bloqueante" em todo ERRO
 * diria mais do que é verdade. O selo diz exatamente o que o código faz — e
 * são três coisas diferentes que ele pode fazer, não duas.
 */
export function rotuloDoSelo(severity: string, code: string): string {
  if (severity === "ERROR") {
    // As mesmas duas perguntas que decidem se o botão de aprovar pode ser
    // apertado — o selo que a tela desenha e a decisão que ela toma não podem
    // sair de leituras diferentes da mesma lista.
    if (impedePromocao({ code, severity })) return "Erro bloqueante";
    if (isolaAChave({ code })) return "Registro não importado";
    return "Erro";
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
