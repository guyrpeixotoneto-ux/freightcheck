/**
 * O arquivo que não produziu nada — e por que isso precisa recusar.
 *
 * ---------------------------------------------------------------------------
 * O defeito que este módulo fecha
 * ---------------------------------------------------------------------------
 * Uma planilha de trecho foi enviada, lida, conferida e **aprovada**. A tela
 * mostrou o selo verde "aprovada", com o SHA-256 ao lado, o nome de quem
 * enviou e a hora. Nada tinha entrado: nenhuma aba virou fonte, nenhum fato foi
 * gravado, nenhum atributo nasceu, a fila de Curadoria continuou dizendo
 * `Trecho 0` e a tela Trecho 360° continuou vazia.
 *
 * Ninguém mentiu de propósito. O caminho é que estava aberto: `preview` só
 * recusava o dado que *não fecha* (a mesma entidade duas vezes na mesma
 * vigência com valores diferentes), e `promote` percorre as vigências
 * encontradas na staging — zero vigências é um laço que não executa, e um laço
 * que não executa termina bem. Um arquivo que rendeu 40 mil fatos e um arquivo
 * que rendeu zero saíam com o mesmo selo.
 *
 * **Zero fato não é um resultado, é uma falha de leitura.** Ninguém envia uma
 * planilha para que nada aconteça. Se nada aconteceu, ou a aba não tem o grão
 * que o leitor exige — hoje `vigência` + `placa`, ver `workbook.ts` —, ou as
 * linhas não produziram valor nenhum. Nos dois casos há trabalho a fazer com o
 * arquivo, e quem enviou precisa saber disso na hora, não três telas depois.
 *
 * ---------------------------------------------------------------------------
 * Por que a frase é montada aqui, e não na tela
 * ---------------------------------------------------------------------------
 * A recusa aparece em três lugares — no `failure_reason` do run, no apontamento
 * que a pré-visualização lista, e no 422 que a aprovação devolve. Três redações
 * do mesmo fato divergem no dia em que uma delas muda. Esta função é a única
 * que escreve, e ela não fala com o banco nem com o React: entram os fatos que
 * o pipeline mediu, sai a frase — o que a deixa testável sem subir Postgres.
 *
 * ---------------------------------------------------------------------------
 * O que ela **não** faz
 * ---------------------------------------------------------------------------
 * Não julga se o arquivo era de trecho, de cavalo ou de carreta, e não sugere
 * mudar o arquivo para caber no leitor. A frase diz o que o leitor exigiu e o
 * que a aba trouxe; a decisão de ensinar o leitor um grão novo é de produto, e
 * mora noutro lugar. Uma mensagem que mandasse "acrescente uma coluna Placa" a
 * uma planilha de trecho estaria pedindo ao cliente que falsificasse o dado
 * dele para agradar o nosso código.
 */

/** O apontamento que a pré-visualização mostra, e que impede a promoção. */
export const CODIGO_ARQUIVO_SEM_FATOS = "ARQUIVO_SEM_FATOS";

/** Uma aba como o leitor a classificou. O que `raw_sheet` guarda. */
export interface AbaClassificada {
  sheetName: string;
  /** `SOURCE` | `PIVOT` | `UNKNOWN` — o papel decidido em `workbook.ts`. */
  role: string;
  rowCount: number;
}

export interface ArquivoLido {
  abas: AbaClassificada[];
  /** Fatos que a staging produziu para este run. */
  fatos: number;
}

const listar = (nomes: string[]): string =>
  nomes.length <= 1
    ? (nomes[0] ?? "")
    : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;

/**
 * Por que este arquivo não pode ser aprovado — ou `null`, quando ele pode.
 *
 * As três recusas são separadas porque pedem ações diferentes de quem operou:
 * um arquivo que não abriu é problema do arquivo; uma aba descartada é problema
 * de layout; uma aba lida que não rendeu fato é problema de conteúdo. Uma frase
 * genérica ("nada foi importado") mandaria as três pessoas procurarem no lugar
 * errado.
 */
export function motivoDeArquivoSemFatos(lido: ArquivoLido): string | null {
  if (lido.fatos > 0) return null;

  const fontes = lido.abas.filter((a) => a.role === "SOURCE");

  if (lido.abas.length === 0) {
    return (
      "Este arquivo não entrou: nenhuma aba foi lida. " +
      "Confira se é mesmo uma planilha do Freightec e reenvie."
    );
  }

  if (fontes.length === 0) {
    const descartadas = lido.abas.map((a) => `"${a.sheetName}"`);
    return (
      `Este arquivo não entrou: nenhuma das ${lido.abas.length === 1 ? "abas" : `${lido.abas.length} abas`} ` +
      `virou fonte de fatos. ${listar(descartadas)} ${lido.abas.length === 1 ? "foi descartada" : "foram descartadas"} ` +
      `na leitura — o motivo de cada uma está na lista de abas abaixo, e em geral é o grão: ` +
      `o leitor só reconhece como fonte a aba cujo cabeçalho traz vigência e placa. ` +
      `Nada foi gravado, e aprovar isto registraria uma importação que não importou nada.`
    );
  }

  const nomes = fontes.map((a) => `"${a.sheetName}"`);
  return (
    `Este arquivo não entrou: ${nomes.length === 1 ? "a aba" : "as abas"} ${listar(nomes)} ` +
    `${nomes.length === 1 ? "foi lida" : "foram lidas"} como fonte, mas nenhuma linha produziu fato. ` +
    `Ou as linhas estão vazias, ou nenhuma delas tem vigência e placa legíveis — os apontamentos ` +
    `abaixo dizem quantas foram recusadas e por quê. Nada foi gravado.`
  );
}
