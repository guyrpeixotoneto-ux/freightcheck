import { lerCnpj } from "@workspace/db";

/**
 * A UNIDADE DE UM ENVIO — de quem é o arquivo, decidido no instante em que ele
 * entra, e nunca mais depois.
 *
 * **O defeito que este módulo desfaz.** A importação sabia de qual unidade era
 * o arquivo — a coluna `Unidade - CNPJ` vem em cada linha, e quem enviou tinha
 * a unidade aberta na lateral — e não gravava isso em lugar nenhum que o
 * Fechamento alcançasse. A ponte entre o escopo e a unidade cadastrada só
 * nascia de um cadastro manual em Remuneração, então a tela de Ativos e Parados
 * recusava a série de CAMAÇARI mandando associar à mão o que a importação
 * acabara de ler. O acervo inteiro importado, o CNPJ gravado dentro do código
 * do escopo, e a resposta `SEM_CADASTRO`.
 *
 * ---------------------------------------------------------------------------
 * Duas faixas, e a ordem entre elas não é arbitrária
 * ---------------------------------------------------------------------------
 *
 * 1. **O CNPJ que o próprio código do escopo carrega.** `07526557001505_CERV`
 *    traz catorze dígitos de documento, e `unidade.cnpj` é único: o documento
 *    *é* a identidade, e não há o que interpretar. É a mesma faixa que
 *    `identidade-da-competencia.ts` chama de `CNPJ_NO_CODIGO`.
 * 2. **A unidade que quem enviou tinha aberta.** O código sem documento —
 *    `443`, `CDD Belém` — não identifica ninguém, e é aí que a escolha de quem
 *    estava na tela responde. Ela é ato explícito de uma pessoa, escrito em
 *    cima da tela o tempo todo, e é a mesma autoridade que abrir competência já
 *    honra quando alguém escolhe a unidade do cadastro.
 *
 * A ordem é essa e não a inversa porque as duas discordando é **conflito**, não
 * empate: um arquivo cujo CNPJ diz Recife enviado de dentro de CAMAÇARI é um
 * arquivo na casa errada, e a saída dele é {@link RecusaDeUnidade}, não uma das
 * duas respostas escolhida em silêncio.
 *
 * ---------------------------------------------------------------------------
 * O que continua recusado
 * ---------------------------------------------------------------------------
 *
 * Nome. Nome parecido, nome igual, prefixo, `CAMAÇARI` contra `CAMAÇARI`. Dois
 * CDDs podem chamar-se igual, e a frota de um desenhada sob o nome do outro é o
 * estrago que este produto inteiro se organiza para não cometer — é a mesma
 * recusa que `identidade-da-competencia.ts` e `cadastro-porta.ts` fazem, e ela
 * não afrouxa por estar mais perto da origem.
 *
 * **Puro de propósito.** Nada aqui abre consulta: quem lê o banco é o pipeline,
 * que traz a unidade declarada e as candidatas por CNPJ já resolvidas. É o que
 * permite conferir estas regras sem subir Postgres, que é a diferença entre
 * elas terem teste e não terem.
 */

/** Uma unidade cadastrada, reduzida ao que decide identidade. */
export interface UnidadeCadastrada {
  id: string;
  nome: string;
  /** Os catorze dígitos, ou `null` na unidade cadastrada só por código gerencial. */
  cnpj: string | null;
}

/**
 * Um escopo UNIDADE que o arquivo trouxe, com a unidade que o CNPJ dele acha.
 *
 * `unidadePorCnpj` vem resolvida de fora — é a única leitura de banco que estas
 * regras precisam, e ela é uma igualdade sobre uma coluna única.
 */
export interface EscopoDoArquivo {
  /** O código como o arquivo o escreveu: `07526557001505_CERV`. */
  code: string;
  /** O nome legível que o arquivo trouxe ao lado. Descrição, nunca identidade. */
  nome: string | null;
  /** A unidade cadastrada cujo CNPJ é o que este código carrega, se houver. */
  unidadePorCnpj: UnidadeCadastrada | null;
}

/** Por que a unidade deste escopo pôde ser afirmada. */
export type ComoSoubeDoEscopo =
  /** O código do escopo carrega o CNPJ de uma unidade cadastrada. */
  | "CNPJ_DO_ESCOPO"
  /** Quem enviou tinha esta unidade aberta, e o código não diz documento nenhum. */
  | "UNIDADE_DO_ENVIO";

export interface IdentidadeDoEscopo {
  unidade: UnidadeCadastrada;
  como: ComoSoubeDoEscopo;
}

/**
 * Os catorze dígitos que um código de escopo carrega, ou `null`.
 *
 * `lerCnpj` recusa o que não identifica — CPF, tamanho errado, verificador que
 * não fecha —, e é essa recusa que separa esta leitura de um `replace(/\D/g)`
 * cru: aqui não se procura "o que parece documento", procura-se um CNPJ.
 * `CDD Belém` não passa por ela, e é o certo.
 */
export function cnpjDoEscopo(code: string): string | null {
  return lerCnpj(code).canonico;
}

/**
 * De qual unidade cadastrada é este escopo — o documento primeiro, a declaração
 * depois, e nada em terceiro.
 *
 * `null` quando nenhuma das duas responde: o código sem documento num envio que
 * não declarou unidade. É a resposta honesta, e é o único caso em que a
 * associação manual continua sendo pedida.
 */
export function identidadeDoEscopo(
  escopo: EscopoDoArquivo,
  declarada: UnidadeCadastrada | null,
): IdentidadeDoEscopo | null {
  if (escopo.unidadePorCnpj) {
    return { unidade: escopo.unidadePorCnpj, como: "CNPJ_DO_ESCOPO" };
  }
  if (declarada) return { unidade: declarada, como: "UNIDADE_DO_ENVIO" };
  return null;
}

/**
 * A recusa de um envio cuja unidade não fecha com a que o arquivo traz.
 *
 * Duas formas, e a saída de cada uma é outra — a mesma razão por que
 * `conferirQuinzenaDeclarada` escreve dois textos e não um.
 */
export interface RecusaDeUnidade {
  motivo: "CONFLITO" | "MULTIPLA";
  /** O nome da unidade que estava aberta quando alguém enviou. */
  declarada: string;
  /** As unidades que o arquivo traz dentro, como ele as nomeia. */
  encontradas: string[];
  titulo: string;
  resumo: string;
  comoCorrigir: string;
}

/**
 * O arquivo é da unidade que quem enviou tinha aberta?
 *
 * ---------------------------------------------------------------------------
 * Por que esta conferência existe, e por que ela bloqueia
 * ---------------------------------------------------------------------------
 *
 * Porque a partir de agora o envio **afirma** uma unidade, e uma afirmação que
 * ninguém confere é pior do que afirmação nenhuma: ela viraria identidade no
 * banco. Um extrato de Recife enviado de dentro de CAMAÇARI gravaria o escopo
 * dele como CAMAÇARI, e o erro só apareceria meses depois, numa frota que não
 * fecha com nada.
 *
 * É a mesma regra das outras declarações desta tela — o tipo, a quinzena, a
 * competência do Real: quem envia diz, o arquivo diz, e a importação para
 * quando os dois discordam. A declaração nunca vence o arquivo; ela só responde
 * onde o arquivo se cala.
 *
 * ---------------------------------------------------------------------------
 * Os três desfechos
 * ---------------------------------------------------------------------------
 *
 * - **Sem declaração** (envio da Visão Geral, envio anterior a esta regra):
 *   `null`. O arquivo decide sozinho pelo CNPJ que traz, como sempre decidiu.
 * - **Uma unidade no arquivo, e ela é a declarada** — ou o código dela não traz
 *   documento nenhum, e aí a declaração é quem responde: `null`.
 * - **Uma unidade no arquivo, e ela é outra** (`CONFLITO`), ou **mais de uma**
 *   (`MULTIPLA`): recusa, com as unidades nomeadas.
 *
 * `MULTIPLA` não diz que o consolidado de cinco unidades é ilegítimo — ele é o
 * export normal da Ambev, e continua entrando. Diz que ele não entra *por
 * dentro de uma unidade*: mandado dali, ele afirmaria que as cinco são aquela.
 * A saída é a Visão Geral, que não declara nenhuma, e é ela que a frase oferece.
 */
export function conferirUnidadeDoEnvio(entrada: {
  declarada: UnidadeCadastrada | null;
  escopos: readonly EscopoDoArquivo[];
}): RecusaDeUnidade | null {
  const { declarada, escopos } = entrada;
  if (declarada === null) return null;
  if (escopos.length === 0) return null;

  const comoOArquivoNomeia = (e: EscopoDoArquivo) => e.nome?.trim() || e.code;
  const encontradas = [...new Set(escopos.map(comoOArquivoNomeia))];

  if (escopos.length > 1) {
    const resumo =
      `Este arquivo foi enviado de dentro de ${declarada.nome}, e traz ` +
      `${escopos.length} unidades dentro: ${encontradas.join(", ")}.`;
    return {
      motivo: "MULTIPLA",
      declarada: declarada.nome,
      encontradas,
      titulo: "O arquivo traz mais de uma unidade",
      resumo,
      comoCorrigir:
        "Um arquivo com mais de uma unidade entra pela Visão Geral, que não declara " +
        "unidade nenhuma — cada unidade que ele trouxer ganha a identidade pelo CNPJ " +
        "que vem na linha dela. Enviado de dentro de uma, ele afirmaria que todas são " +
        `${declarada.nome}.`,
    };
  }

  const unico = escopos[0]!;
  const doArquivo = unico.unidadePorCnpj;
  /*
    O código sem documento não é divergência: `443` não diz de quem é, e chamar
    isso de conflito mandaria corrigir um arquivo que está certo. É justamente o
    caso em que a declaração existe para responder — ver `identidadeDoEscopo`.
  */
  if (doArquivo === null) return null;
  if (doArquivo.id === declarada.id) return null;

  const resumo =
    `Este arquivo foi enviado de dentro de ${declarada.nome}, e o CNPJ que ele traz ` +
    `dentro é o de ${doArquivo.nome} (${unico.code}).`;
  return {
    motivo: "CONFLITO",
    declarada: declarada.nome,
    encontradas,
    titulo: "O arquivo não é da unidade aberta",
    resumo,
    comoCorrigir:
      `Abra ${doArquivo.nome} na lateral e envie por lá — ou confira se este é mesmo ` +
      "o arquivo que você queria enviar.",
  };
}
