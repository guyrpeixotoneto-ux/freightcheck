/**
 * A TRAVA DE LASTRO — nenhum número em reais que o dossiê não contenha.
 *
 * O Agente de Compras produz preços que vão para uma mesa de negociação. Um
 * teto inventado com fluência é o defeito mais caro que este produto pode ter:
 * ele não parece um erro, parece uma conta. Esta trava é o que impede a redação
 * por modelo de introduzir um.
 *
 * **Como ela funciona.** O dossiê já traz a lista fechada dos números que a
 * resposta pode citar (`numerosDaAvaliacao`). A conferência varre o texto atrás
 * de valores em reais e exige que cada um case com algum da lista. Casou tudo,
 * a redação passa; sobrou um, ela é descartada inteira e a redação em código
 * ocupa o lugar dela — a mesma resposta, com o mesmo material, escrita por
 * regra.
 *
 * **Por que descartar inteira e não podar a frase.** Porque um texto a que
 * faltou uma frase é um texto que argumenta por metade: "a proposta está acima
 * do teto" sem o quanto não ajuda ninguém, e pior, parece uma resposta
 * completa. O texto determinístico responde a mesma pergunta por inteiro.
 *
 * **A tolerância é de um centavo**, e é de arredondamento: o dossiê carrega
 * `2749.9999…` e o modelo escreve `R$ 2.750,00`. Ela não é folga de opinião —
 * um centavo não cobre a distância entre dois preços que alguém negociaria.
 */

const TOLERANCIA = 0.011;

/**
 * Os valores em reais que aparecem num texto.
 *
 * Só o que vem depois de `R$`. Um "80" solto é quantidade, um "12" é mês, e
 * exigir lastro para eles reprovaria toda resposta correta que mencionasse a
 * vida útil. A quantidade e as premissas já entram na lista de permitidos por
 * outro caminho — ver `numerosDaAvaliacao`.
 */
export function valoresCitados(texto: string): number[] {
  const achados: number[] = [];
  for (const casa of texto.matchAll(/r\$\s*(-?[\d.]+(?:,\d{1,2})?)/gi)) {
    const bruto = casa[1];
    if (!bruto) continue;
    const n = Number(bruto.replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(n)) achados.push(n);
  }
  return achados;
}

export interface ConferenciaDeLastro {
  /** Verdadeiro quando todo valor citado tem lastro no dossiê. */
  passou: boolean;
  /** Os que não têm. Vazio quando passou. */
  semLastro: number[];
}

/**
 * Confere o texto contra a lista de números que o dossiê sustenta.
 *
 * O valor absoluto entra na comparação porque o texto escreve a diferença em
 * módulo — "R$ 140 acima do teto", quando o dossiê guarda `+140`, e "R$ 140
 * abaixo da meta", quando guarda `-140`. O sinal é a direção, e ela está na
 * frase, não no número.
 */
export function conferirLastro(texto: string, permitidos: number[]): ConferenciaDeLastro {
  const lista = permitidos.flatMap((n) => [n, Math.abs(n)]);
  const semLastro = valoresCitados(texto).filter(
    (citado) => !lista.some((p) => Math.abs(p - citado) <= TOLERANCIA),
  );
  return { passou: semLastro.length === 0, semLastro };
}
