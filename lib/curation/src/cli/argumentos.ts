/**
 * Ler o responsável da linha de comando, com o `--` que o pnpm insiste em
 * repassar.
 *
 * ---------------------------------------------------------------------------
 * O defeito medido
 * ---------------------------------------------------------------------------
 * O comando documentado é
 *
 *     pnpm run curar:direcao-economica-trecho -- "seu@email.com"
 *
 * O `--` ali serve para o **pnpm** parar de interpretar o que vem depois. Só
 * que o script já termina em `tsx src/cli/...`, então o pnpm concatena tudo o
 * que sobrou — inclusive o próprio `--` — e o processo recebe:
 *
 *     argv = [node, cli.ts, "--", "guyrpeixoto.neto@gmail.com"]
 *
 * `process.argv[2]` é `"--"`. A validação antiga só perguntava se estava
 * vazio, e `"--"` não está: em 26/08/2026 a rodada anunciou
 * `como --…` e teria assinado os 110 `curation_event` com `--` no campo
 * `actor` se o banco tivesse respondido. Uma curadoria assinada por `--` é
 * pior do que uma que não rodou: ela existe, parece auditada, e não tem dono.
 *
 * ---------------------------------------------------------------------------
 * A regra
 * ---------------------------------------------------------------------------
 * Descartar os separadores e as bandeiras, e ficar com o primeiro argumento
 * que sobrar. Um responsável é um e-mail ou um nome — nunca começa por `-`,
 * então "começa por `-`" é o critério, e ele cobre `--`, `-f` e
 * `--qualquer-coisa` de uma vez, inclusive uma bandeira futura que ninguém
 * escreveu ainda.
 */

/** Argumentos de verdade: sem separador, sem bandeira, sem vazio. */
export function argumentosPosicionais(argv: readonly string[]): string[] {
  return argv.map((a) => a.trim()).filter((a) => a !== "" && !a.startsWith("-"));
}

/**
 * O responsável, ou `null` quando ninguém foi informado.
 *
 * `null` e não `"--"`: quem chama precisa poder recusar a rodada, e a recusa
 * tem de acontecer **antes** de qualquer escrita.
 */
export function atorDosArgumentos(argv: readonly string[]): string | null {
  return argumentosPosicionais(argv)[0] ?? null;
}
