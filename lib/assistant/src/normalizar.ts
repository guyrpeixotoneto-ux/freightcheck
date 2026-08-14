/**
 * O vocabulário de quem pergunta não é o vocabulário das colunas.
 *
 * Quem opera diz "quanto o pneu subiu", não `pneuMensal`; diz "chamado", não
 * "curadoria"; escreve "vigencia" sem acento porque estava com pressa. Este
 * módulo é a única camada que sabe disso, e é deliberadamente burra: comparar
 * texto sem acento e sem caixa, contar quantos termos de um assunto aparecem
 * na frase, e nada além. Não há embedding, não há modelo, não há aprendizado.
 *
 * O motivo é o mesmo do resto do produto: o que decide qual resposta sai daqui
 * precisa ser explicável a quem discordar dela. Uma pontuação que se lê em três
 * linhas de código pode ser conferida; uma que sai de um vetor de 1536
 * dimensões, não.
 */

/** Sem acento e sem caixa: ninguém digita "vigência" com o acento certo. */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * As palavras da frase que valem para busca.
 *
 * Palavras com uma ou duas letras saem porque "de", "o", "em" aparecem em toda
 * pergunta e em todo artigo — mantê-las faria qualquer texto casar com qualquer
 * pergunta, que é o mesmo que não ter busca. `PALAVRAS_VAZIAS` cobre o resto do
 * português funcional, que tem palavras longas o bastante para passar pelo
 * filtro de tamanho ("quanto", "porque", "qual").
 */
export function termos(texto: string): string[] {
  return normalizar(texto)
    .split(/[^a-z0-9]+/)
    .filter((palavra) => palavra.length > 2 && !PALAVRAS_VAZIAS.has(palavra));
}

/**
 * Português funcional — o que aparece em toda pergunta e não distingue nenhuma.
 *
 * Note o que **não** está aqui: "book", "vigência", "parâmetro", "impacto".
 * São palavras comuns nas perguntas deste produto e é justamente por isso que
 * elas discriminam: quem as escreve está pedindo um assunto específico.
 */
const PALAVRAS_VAZIAS = new Set([
  "que", "qual", "quais", "quanto", "quantos", "quantas", "como", "onde", "quando",
  "porque", "por", "para", "pra", "com", "sem", "dos", "das", "nos", "nas", "num",
  "numa", "uma", "uns", "umas", "meu", "minha", "seu", "sua", "isso", "esse", "essa",
  "este", "esta", "aqui", "esta", "sao", "foi", "ser", "tem", "ter", "vai", "faz",
  "fazer", "pode", "posso", "quero", "preciso", "sobre", "mais", "menos", "muito",
  "todo", "toda", "todos", "todas", "outro", "outra", "mesmo", "mesma", "entre",
  "ate", "ate", "nao", "sim", "voce", "eu", "ele", "ela", "sei", "diz", "dizer",
  "explica", "explicar", "mostra", "mostrar", "quer", "temos", "tenho",
  "disso", "disto", "nisso", "aquilo", "algum", "alguma", "cada", "ainda",
]);

/**
 * Quanto desta pergunta é sobre este assunto.
 *
 * Conta quantos termos do assunto aparecem na pergunta, com dois pesos: o termo
 * escrito inteiro vale mais que o termo encontrado dentro de outra palavra, e um
 * termo de várias palavras ("book do operador") vale pelo tamanho, porque quem
 * digita a expressão inteira está sendo específico e merece ser levado a sério.
 *
 * A pontuação é dividida pelo número de termos do assunto: sem isso, um assunto
 * com quarenta sinônimos venceria todos os outros só por ser mais gordo.
 */
export function pontuar(pergunta: string, termosDoAssunto: string[]): number {
  if (termosDoAssunto.length === 0) return 0;
  const frase = normalizar(pergunta);
  const palavras = new Set(termos(pergunta));

  let pontos = 0;
  for (const bruto of termosDoAssunto) {
    const termo = normalizar(bruto);
    if (!termo) continue;

    if (termo.includes(" ")) {
      // Expressão: só conta inteira, e vale pelo número de palavras dela.
      if (frase.includes(termo)) pontos += termo.split(" ").length * 2;
      continue;
    }

    if (palavras.has(termo)) pontos += 2;
    else if (termo.length > 4 && variante(termo, palavras)) pontos += 1;
  }

  return pontos / termosDoAssunto.length;
}

/**
 * O termo aparece na pergunta como variante de uma palavra inteira?
 *
 * Só conta prefixo, nos dois sentidos — "vigencias" casa com "vigencia" e
 * vice-versa —, e nunca casa no meio de outra palavra. A regra anterior era
 * `frase.includes(termo)`, e ela dava um ponto de "revisão" para quem
 * perguntasse a **previsão** do tempo: "previsao" termina com "revisao". Uma
 * pergunta claramente fora do assunto passava a recuperar um artigo sobre o
 * Book, que é exatamente o erro que o limiar existe para impedir.
 */
function variante(termo: string, palavras: Set<string>): boolean {
  for (const palavra of palavras) {
    if (palavra.startsWith(termo)) return true;
    if (palavra.length > 4 && termo.startsWith(palavra)) return true;
  }
  return false;
}

/**
 * O termo mais provável quando a pergunta nomeia uma coisa do produto.
 *
 * Devolve a sequência de palavras significativas mais longa da pergunta, que é
 * o melhor palpite para "PNEU", "IPVA", "Índice de Reajuste" — e é passado às
 * buscas por nome de bloco e de parâmetro. Não tenta ser esperto: se errar, a
 * busca por nome não acha nada e a resposta diz que não achou, em vez de achar
 * a coisa errada com confiança.
 */
export function alvoProvavel(pergunta: string): string {
  const palavras = termos(pergunta);
  return palavras.join(" ");
}
