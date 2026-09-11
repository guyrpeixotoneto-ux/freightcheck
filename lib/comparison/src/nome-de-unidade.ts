/**
 * O NOME DE UMA UNIDADE — a régua única, e o que ela recusa fazer.
 *
 * Este produto escreve o nome da mesma unidade em quatro vocabulários: o escopo
 * do export de remuneração (`CAMAÇARI`), a coluna `Unidade` do export de
 * chamados (`Camaçari`, `camacari `), o nome do arquivo (`Chamados Agosto
 * Camaçari.xlsx`) e o cadastro digitado à mão. Comparar qualquer par deles cru
 * faz uma tela abrir vazia sobre um acervo cheio — o pior jeito de um recorte
 * falhar, porque parece dado e é grafia.
 *
 * A normalização morava só na interface (`lib/serie-da-unidade.ts`), onde ela
 * casa a série com a unidade da lateral. Agora o motor precisa da mesma régua
 * para ler o nome do arquivo, e duas cópias de uma regra de igualdade é a
 * mesma doença um nível acima: nada obriga as duas a concordarem, e no dia em
 * que divergissem a série gravada deixaria de casar com a unidade da tela sem
 * que nada tivesse mudado. Por isso ela mora aqui, sem dependência de banco, e
 * os dois lados a importam.
 */

/**
 * O nome em forma comparável: caixa alta, sem acento, sem pontuação.
 *
 * `Camaçari`, `CAMAÇARI` e `camacari ` viram a mesma palavra; `CDD CEBRASA`
 * continua diferente de `CEBRASA` — a separação que o casamento por igualdade
 * depende, e que `unidadeNoNomeDoArquivo` também respeita.
 */
export function normalizarUnidade(bruto: string | null | undefined): string | null {
  if (bruto === null || bruto === undefined) return null;
  const normalizada = bruto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  return normalizada === "" ? null : normalizada;
}

/**
 * O menor nome que vale procurar dentro de um nome de arquivo.
 *
 * Duas letras não é nome de unidade, e um código de dois dígitos casaria com
 * qualquer coisa: `Chamados 08 2026.xlsx` acharia a unidade `08` e atribuiria
 * o arquivo inteiro a ela. Três é o menor tamanho em que o casamento diz mais
 * sobre a unidade do que sobre o acaso.
 */
const MENOR_NOME = 3;

/**
 * A unidade do cadastro que o nome do arquivo nomeia — ou `null`.
 *
 * ---------------------------------------------------------------------------
 * Por que aqui a busca é por conteúdo, e em `serieDaUnidade` nunca é
 * ---------------------------------------------------------------------------
 *
 * `serieDaUnidade` compara dois nomes que se pretendem a mesma coisa, e ali
 * "contém" é mentira: `CDD CEBRASA` e `CEBRASA` podem ser a mesma unidade e
 * podem não ser, e decidir isso sozinho atribui chamados de uma unidade a
 * outra sem dizer.
 *
 * Aqui o problema é outro. O nome do arquivo **não** se pretende um nome de
 * unidade: ele é uma frase de gente — `Chamados Agosto Camaçari.xlsx`, `Export
 * final CDD BELEM (3).xlsx` — com a unidade dentro. Não procurar dentro dela é
 * o mesmo que não ler o arquivo, e foi o que deixou o envio real de Camaçari
 * com série `Agosto Camaçari`: um nome que não casa com unidade nenhuma da
 * lateral, e portanto um recorte que nunca chega a ninguém.
 *
 * O rigor que se mantém é outro, e está nas três recusas abaixo:
 *
 * 1. **Palavra inteira.** A busca é por sequência de palavras normalizadas, e
 *    não por substring: `CEBRASA` não casa com `CEBRASANIA`, e `443` não casa
 *    com `4432`.
 * 2. **O mais específico vence.** Havendo `CDD CEBRASA` e `CEBRASA` no
 *    cadastro, um arquivo chamado `Chamados CDD CEBRASA.xlsx` é da primeira —
 *    o nome inteiro está escrito ali, e escolher a mais curta seria descartar
 *    metade da evidência que o próprio arquivo trouxe.
 * 3. **Duas unidades diferentes recusam.** Quando o nome cita duas unidades que
 *    não são uma o sufixo da outra — `Chamados Recife e Camaçari.xlsx` —, não
 *    há resposta, e devolver uma delas seria sorteio. `null` aqui devolve o
 *    envio para a série indeterminada, que é um estado nomeado e reparável.
 *
 * O que volta é o nome **como o cadastro o escreve**, e não o pedaço do
 * arquivo: é sobre o texto do cadastro que a lateral casa a unidade com a
 * série, e devolver `camacari` faria o casamento depender de a normalização
 * das duas pontas continuar igual para sempre.
 */
export function unidadeNoNomeDoArquivo(
  nomeDoArquivo: string,
  unidadesConhecidas: readonly (string | null | undefined)[],
): string | null {
  const alvo = normalizarUnidade(nomeDoArquivo);
  if (alvo === null) return null;
  const frase = ` ${alvo} `;

  const candidatas: { texto: string; normalizada: string }[] = [];
  const vistas = new Set<string>();
  for (const bruta of unidadesConhecidas) {
    const normalizada = normalizarUnidade(bruta);
    if (normalizada === null || normalizada.length < MENOR_NOME) continue;
    if (vistas.has(normalizada)) continue;
    if (!frase.includes(` ${normalizada} `)) continue;
    vistas.add(normalizada);
    candidatas.push({ texto: bruta!.trim(), normalizada });
  }

  if (candidatas.length === 0) return null;

  candidatas.sort((a, b) => b.normalizada.length - a.normalizada.length);
  const maisEspecifica = candidatas[0]!;

  /*
    A recusa (3). Só é "a mesma unidade escrita com mais ou menos palavras"
    quando as menores são sufixo ou prefixo da maior — `CDD CEBRASA` contra
    `CEBRASA`. Qualquer outra coisa são duas unidades no mesmo nome, e aí o
    arquivo não diz de quem ele é.
  */
  const ambigua = candidatas
    .slice(1)
    .some((c) => !ehPedacoDe(c.normalizada, maisEspecifica.normalizada));
  return ambigua ? null : maisEspecifica.texto;
}

/** `CEBRASA` é pedaço de `CDD CEBRASA`; `RECIFE` não é pedaço de `CAMACARI`. */
function ehPedacoDe(menor: string, maior: string): boolean {
  return ` ${maior} `.includes(` ${menor} `);
}
