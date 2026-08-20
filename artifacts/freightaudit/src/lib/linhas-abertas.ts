/**
 * Abrir e fechar linhas numa lista agrupada — o mesmo gesto, e agora um só.
 *
 * Duas telas do Fechamento têm a mesma forma: uma lista de linhas reunidas em
 * grupos, cada linha abrindo logo abaixo de si a resposta cara que ela resume.
 * Em Apurações a linha é a competência, o grupo é a quinzena e o que abre é a
 * conta; em Remuneração a linha é a unidade, o grupo é a vigência e o que abre
 * é o cadastro. O comportamento de abrir é idêntico nas duas, e por isso mora
 * aqui: duas cópias do mesmo gesto divergiriam na primeira correção, e a que
 * ficasse para trás seria a que ninguém lembrou de mexer.
 *
 * **Quais linhas estão abertas é um conjunto, e não "uma de cada vez".** As
 * duas telas existem para comparar — dois CDDs da mesma quinzena, duas unidades
 * da mesma vigência —, e fechar a de cima para ver a de baixo é exatamente o
 * que a expansão veio evitar.
 */

/**
 * Um grupo está aberto quando não falta nenhuma linha dele por abrir.
 *
 * A lista nunca desenha grupo sem linhas, e mesmo assim o vazio é dito: `every`
 * sobre lista vazia é verdadeiro, e um grupo assim ficaria eternamente aberto —
 * seta girada, clique sem efeito.
 */
export function grupoEstaAberto(abertas: ReadonlySet<string>, ids: string[]): boolean {
  return ids.length > 0 && ids.every((id) => abertas.has(id));
}

/** Abre a que estava fechada, fecha a que estava aberta, e não toca nas demais. */
export function alternarUma(abertas: ReadonlySet<string>, id: string): Set<string> {
  const proximo = new Set(abertas);
  if (!proximo.delete(id)) proximo.add(id);
  return proximo;
}

/**
 * O cabeçalho do grupo: abre todas as linhas dele, e só fecha quando não falta
 * nenhuma.
 *
 * Assim o clique num grupo meio aberto termina de abri-lo, em vez de fechar o
 * que já se estava lendo — que seria o contrário do gesto de quem clica em
 * "abrir tudo" depois de já ter aberto uma.
 */
export function alternarGrupo(abertas: ReadonlySet<string>, ids: string[]): Set<string> {
  const proximo = new Set(abertas);
  const todasAbertas = ids.length > 0 && ids.every((id) => proximo.has(id));
  for (const id of ids) {
    if (todasAbertas) proximo.delete(id);
    else proximo.add(id);
  }
  return proximo;
}
