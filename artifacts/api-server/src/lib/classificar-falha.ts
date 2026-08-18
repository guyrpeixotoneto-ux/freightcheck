import { codigoDoPostgres } from "@workspace/db";
import { faltaSchema } from "./schema-ausente";

/**
 * O texto de uma exceção pode ser mostrado a quem opera? E, se não, o que ela é?
 *
 * Nasceu dentro de `routes/imports.ts`, para a única rota que precisava deixar
 * passar a frase de uma recusa — "este equipamento não estava na vigência
 * anterior" — sem deixar passar junto o `Failed query: select … params: …` que
 * o drizzle carimba na frente de qualquer falha de banco.
 *
 * Está aqui porque a mesma pergunta é feita em outros quatro lugares, e lá ela
 * **não** estava sendo feita: `POST /change-sets`, as duas rotas de versão de
 * semântica e o upload do painel respondiam 422 com `err.message` para *toda*
 * exceção. Numa recusa de regra, o texto certo; numa falha de banco, a consulta
 * inteira na tela — com um número HTTP que ainda por cima diz ao cliente que o
 * defeito foi dele.
 */

/**
 * As marcas do que nunca é frase para quem opera.
 *
 * Esta lista **não classifica nada** — quem classifica é o SQLSTATE, logo
 * abaixo. Ela é a peneira final, no ponto em que um texto viraria resposta: uma
 * rede contra o dia em que uma mensagem de banco chegar por um caminho que
 * ninguém previu, embrulhada de um jeito sem `code`. Uma rede depois da
 * classificação é barata; uma heurística de texto *no lugar* dela seria frágil,
 * e é por isso que ela não está no lugar dela.
 */
const MARCAS_QUE_NAO_SAO_FRASE = [
  /failed query:/i, // o carimbo do drizzle
  /\bparams:/i, // os parâmetros que ele imprime junto
  /\binsert\s+into\b/i,
  /\bdelete\s+from\b/i,
  /\bupdate\s+"?[\w.]+"?\s+set\b/i,
  /\bselect\b[\s\S]*\bfrom\b/i,
  /\n\s+at\s+\S/, // um stack trace que virou mensagem
];

/** Este texto pode ser mostrado a quem opera? */
export function ehFraseParaQuemOpera(texto: string): boolean {
  return !MARCAS_QUE_NAO_SAO_FRASE.some((marca) => marca.test(texto));
}

/**
 * Os erros que o runtime levanta sozinho.
 *
 * Um `TypeError` não é recusa: é defeito nosso, e a frase dele fala de
 * `undefined` e de nome de variável. Separá-los **pela classe** é o que permite
 * manter inteira a frase das recusas que o domínio escreve em português com
 * `new Error(...)` — a de equipamento novo, por exemplo — sem deixar passar a
 * de um bug. Fosse por texto, seria adivinhação.
 */
function ehDefeitoDoRuntime(err: unknown): boolean {
  return (
    err instanceof TypeError ||
    err instanceof RangeError ||
    err instanceof ReferenceError ||
    err instanceof SyntaxError ||
    err instanceof URIError ||
    err instanceof EvalError
  );
}

/**
 * O que fazer com um erro que subiu de uma camada de domínio. Três desfechos.
 *
 * - `SCHEMA`    — o banco está atrás do repositório. 503, com o diagnóstico.
 * - `REGRA`     — recusa escrita para quem opera. 4xx, com a frase inteira.
 * - `INESPERADO`— defeito nosso ou falha de banco. 500, com frase genérica.
 *
 * A ordem das perguntas é o desenho: o SQLSTATE decide primeiro, e ele é
 * procurado **dentro** do que o drizzle embrulhou (`codigoDoPostgres` percorre
 * a cadeia de `cause`). Só o que não veio do driver pode ser recusa de regra —
 * e é por isso que nenhuma consulta chega à tela.
 */
export type DesfechoDaFalha =
  | { tipo: "SCHEMA" }
  | { tipo: "REGRA"; mensagem: string }
  | { tipo: "INESPERADO" };

export function classificarFalha(err: unknown): DesfechoDaFalha {
  if (faltaSchema(err)) return { tipo: "SCHEMA" };
  // Qualquer outro SQLSTATE é o banco falando, e o banco não fala com quem
  // opera. 23505, 23503, 40001 — todos viram frase genérica e log completo.
  if (codigoDoPostgres(err) !== undefined) return { tipo: "INESPERADO" };
  if (ehDefeitoDoRuntime(err)) return { tipo: "INESPERADO" };
  if (
    err instanceof Error &&
    err.message.trim() !== "" &&
    ehFraseParaQuemOpera(err.message)
  ) {
    return { tipo: "REGRA", mensagem: err.message };
  }
  return { tipo: "INESPERADO" };
}
