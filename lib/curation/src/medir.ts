/**
 * Quanto tempo cada etapa levou — instrumento, não regra.
 *
 * Este módulo não decide nada e não muda resultado nenhum. Existe porque
 * "a fila de curadoria demorou" não é um diagnóstico: `getCurationQueue` faz
 * três coisas de custo muito diferente — um agregado sobre a tabela `fact`
 * inteira, um `select` sobre `attribute` com três `left join`, e a montagem em
 * memória — e sem separá-las a resposta a "o que travou?" seria um palpite
 * sobre qual das três foi.
 *
 * **Por que um parâmetro, e não um logger importado.** `lib/curation` não fala
 * com o servidor: importar o `pino` do api-server aqui amarraria o motor a
 * quem o chama, e ele também roda por CLI e por teste. Quem instrumenta passa
 * a função; quem não passa não paga nada — `medir` sem registrador chama direto
 * e nem lê o relógio.
 */

/** Recebe o nome da etapa e quanto ela levou, em milissegundos. */
export type RegistrarEtapa = (etapa: string, ms: number) => void;

/**
 * Roda `fn` cronometrando, quando há quem registre.
 *
 * O `finally` é deliberado: uma etapa que **falhou** também tem duração, e é
 * justamente ela que interessa quando a pergunta é "onde travou". Registrar só
 * o sucesso apagaria do log o caso que motivou o instrumento.
 */
export async function medir<T>(
  registrar: RegistrarEtapa | undefined,
  etapa: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (registrar === undefined) return fn();
  const inicio = performance.now();
  try {
    return await fn();
  } finally {
    registrar(etapa, Math.round(performance.now() - inicio));
  }
}
