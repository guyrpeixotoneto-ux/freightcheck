/**
 * A regra que pinta o card da fila de curadoria de verde.
 *
 * Mora aqui, e não na tela, porque é a única frase da fila que responde uma
 * pergunta em vez de desenhar: "esta coluna já está descrita?". A tela decide a
 * cor; o significado da cor é isto, e é testável sem montar React.
 */

/** O mínimo do atributo de que a regra precisa — os três campos em prosa. */
export interface CamposDeSignificado {
  displayName: string | null;
  definition: string | null;
  calculationBasis: string | null;
}

/**
 * Os três campos do card "Significado" escritos: nome gerencial, o que é e
 * fórmula de cálculo.
 *
 * É de propósito uma pergunta diferente de "está confirmado". Descrever uma
 * coluna não destrava soma nenhuma — quem destrava é a confirmação, e o selo de
 * status do card continua dizendo `Desconhecido` até lá. O verde responde ao
 * que faz a fila andar: "já escrevi o que sei sobre esta coluna?".
 *
 * Espaço em branco não conta. Um campo com um espaço dentro veio de quem
 * apagou o texto e não de quem o escreveu, e um card verde por causa disso
 * seria a fila mentindo sobre o próprio progresso.
 */
export function estaDescrito(atributo: CamposDeSignificado): boolean {
  return Boolean(
    atributo.displayName?.trim() &&
      atributo.definition?.trim() &&
      atributo.calculationBasis?.trim(),
  );
}
