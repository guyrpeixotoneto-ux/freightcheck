/**
 * O clique numa vigência do gráfico — a regra que as duas telas dividem.
 *
 * O Dashboard e a Linha do Tempo desenham gráficos diferentes (barras
 * divergentes lá, linhas de quantidade e de impacto aqui), mas o clique neles
 * promete a mesma coisa: a tela inteira passa a falar da vigência apontada.
 * Escrita duas vezes, a regra divergiria na primeira correção — e a diferença
 * apareceria como "no Dashboard o clique repetido volta, na Linha do Tempo
 * não", que ninguém decide de propósito.
 */

/** O que o Recharts entrega ao `onClick` do gráfico — só a parte que lemos. */
export interface EstadoDoClique {
  activePayload?: { payload?: { periodo?: string } }[] | undefined;
}

/**
 * Qual vigência um clique no gráfico pediu — `null` quando ele não pede
 * nenhuma.
 *
 * O clique é lido no gráfico inteiro, e não num `onClick` por barra. Só a
 * barra responder deixaria morta a metade de cima da área — a faixa vazia
 * acima de uma perda pequena, a linha do líquido, o vão entre duas barras —, e
 * é justamente ali que o ponteiro cai quando se mira uma barra baixinha. O
 * Recharts já resolve "de qual ponto o cursor está mais perto" para desenhar o
 * tooltip, e `activePayload` é esse mesmo ponto: o alvo do clique passa a ser
 * exatamente aquilo que o tooltip acabou de mostrar.
 *
 * Dois cliques não navegam, e por motivos diferentes. O clique fora de
 * qualquer ponto (a margem do gráfico, a legenda) chega sem `activePayload` —
 * navegar aí mandaria a tela para uma vigência que ninguém apontou. E o clique
 * na vigência que já está aberta não é troca nenhuma: deixá-lo passar
 * empilharia um endereço idêntico no histórico do navegador, e o "voltar" do
 * usuário passaria a precisar de dois cliques para desfazer um.
 */
export function vigenciaDoClique(
  estado: EstadoDoClique | null | undefined,
  vigenciaAtiva: string | null,
): string | null {
  const periodo = estado?.activePayload?.[0]?.payload?.periodo;
  if (!periodo || periodo === vigenciaAtiva) return null;
  return periodo;
}
