/**
 * O vocabulário da direção econômica — puro, para a tela e para o banco lerem
 * a mesma lista.
 *
 * Mora separado de `direcao-economica.ts` pelo mesmo motivo que `significado.ts`
 * mora separado de `catalogo.ts`: a gravação precisa de drizzle e do banco, a
 * lista de opções não precisa de nada, e é a lista que a tela do navegador
 * importa. Uma segunda cópia dos rótulos dentro do frontend seria a fonte
 * óbvia de uma tela que oferece uma opção que o servidor recusa.
 *
 * ---------------------------------------------------------------------------
 * Por que são quatro valores, e não seis
 * ---------------------------------------------------------------------------
 * "Menor é melhor" e "maior é pior" são a mesma afirmação dita de dois jeitos,
 * e o mesmo vale para o outro par. Guardar as quatro frases como quatro valores
 * distintos pareceria mais fiel a quem escolhe e seria um defeito silencioso em
 * quem lê: `sinal()` no Radar de Trechos devolve `1` para `HIGHER_IS_BETTER`,
 * `-1` para `HIGHER_IS_WORSE` e `0` para o resto, então um `LOWER_IS_BETTER`
 * novo entraria no radar como **neutro** — uma alteração material contada como
 * imaterial, que é exatamente o erro que o campo existe para evitar. O mesmo
 * acontece em `ehAlteracaoMaterial`, na composição e no assistente.
 *
 * Então o par de frases mora no rótulo, onde ele é leitura, e não no código,
 * onde ele seria uma quinta e uma sexta categoria que ninguém trata.
 */
export const DIRECOES_ECONOMICAS = [
  {
    direcao: "HIGHER_IS_BETTER" as const,
    rotulo: "Maior é melhor",
    /** A mesma coisa, dita pelo outro lado. Ver a nota acima. */
    inverso: "menor é pior",
    ajuda: "Subir aumenta a remuneração ou reduz o custo da transportadora.",
  },
  {
    direcao: "HIGHER_IS_WORSE" as const,
    rotulo: "Maior é pior",
    inverso: "menor é melhor",
    ajuda: "Subir reduz a remuneração ou aumenta o custo da transportadora.",
  },
  {
    direcao: "NEUTRAL" as const,
    rotulo: "Neutro",
    inverso: null,
    ajuda: "É cadastro, não grandeza econômica — não deve afetar o veredito do trecho.",
  },
  {
    direcao: "DEPENDS_ON_FORMULA" as const,
    rotulo: "Depende da fórmula",
    inverso: null,
    ajuda: "O sentido depende de que conta usa este atributo — não classificar sem essa conta.",
  },
];

export type DirecaoEconomica = (typeof DIRECOES_ECONOMICAS)[number]["direcao"];

/** A opção do vocabulário, ou `null` para o que ninguém curou ainda. */
export function direcaoDe(codigo: string | null | undefined) {
  if (!codigo) return null;
  return DIRECOES_ECONOMICAS.find((d) => d.direcao === codigo) ?? null;
}
