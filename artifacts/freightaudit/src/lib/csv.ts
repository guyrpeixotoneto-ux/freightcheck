/**
 * CSV para abrir no Excel brasileiro — e só para isso.
 *
 * Este arquivo não é um exportador genérico: é a tradução de uma tabela que já
 * está na tela para um arquivo que a pessoa vai abrir com dois cliques, no
 * Excel, em português. Cada decisão aqui existe por uma falha concreta desse
 * caminho, e nenhuma delas é preferência de estilo.
 *
 * - **Separador `;`.** O Excel em português lê `,` como decimal, então um CSV
 *   separado por vírgula abre com a planilha inteira numa coluna só. É a mesma
 *   escolha que o próprio Excel faz ao salvar como CSV em pt-BR.
 * - **Decimal com vírgula.** Pela outra ponta da mesma regra: `1424.91` chega
 *   como texto — ou, pior, como a data 14/24 — e a soma da coluna não fecha.
 * - **BOM na frente.** Sem ele o Excel abre em Latin-1, e toda placa está certa
 *   mas todo rótulo com acento vira `manutenÃ§Ã£o`.
 * - **CRLF entre as linhas.** É o que o Excel espera; o `\n` sozinho funciona
 *   na maioria das versões e falha em algumas do Windows, e o custo de acertar
 *   é um caractere.
 *
 * **O que ele não faz: formatar dinheiro.** `R$` na célula transforma número em
 * texto, e uma coluna de texto não soma. O arquivo leva o número; quem quiser o
 * símbolo formata a coluna na planilha.
 */

/**
 * Uma célula escapada segundo o RFC 4180 — com aspas só quando precisa.
 *
 * Aspas em tudo seria mais simples e é o que a maioria das implementações faz;
 * o problema aparece na leitura humana do arquivo em qualquer editor que não
 * seja planilha, onde `"ABC1D23";"Cavalo"` esconde o conteúdo atrás de ruído.
 */
function celula(valor: string): string {
  return /[";\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
}

/** O número como o Excel brasileiro o lê: vírgula decimal, sem milhar. */
export function numeroParaCsv(valor: number, casas = 2): string {
  return valor.toFixed(casas).replace(".", ",");
}

/**
 * As linhas viradas texto de arquivo, com o BOM que o Excel precisa.
 *
 * Recebe tudo já em `string` de propósito: quem chama é quem sabe se aquela
 * célula é dinheiro, contagem ou frase, e um `unknown` aqui obrigaria este
 * módulo a adivinhar — que é exatamente o erro que `lib/format.ts` existe para
 * impedir do outro lado.
 */
export function montarCsv(linhas: string[][]): string {
  return `\ufeff${linhas.map((l) => l.map(celula).join(";")).join("\r\n")}\r\n`;
}

/** O CSV como Blob, pronto para `salvarArquivo`. */
export function csvComoBlob(linhas: string[][]): Blob {
  return new Blob([montarCsv(linhas)], { type: "text/csv;charset=utf-8" });
}

/**
 * Um pedaço de texto que pode virar nome de arquivo.
 *
 * O contexto de uma auditoria tem `·`, acento e barra ("CAMAÇARI · EMPURRADA",
 * "01/08/2026"), e uma barra num nome de arquivo é um diretório que não existe:
 * o navegador salva como `download` sem extensão, e a pessoa perde o arquivo.
 */
export function paraNomeDeArquivo(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
