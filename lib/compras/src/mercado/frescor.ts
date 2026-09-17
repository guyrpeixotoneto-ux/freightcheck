/**
 * O FRESCOR — cotação da internet envelhece, e a tela tem de dizer quando.
 *
 * Um preço capturado há três meses continua sendo um preço, e apresentá-lo
 * calado como "mercado hoje" é a forma mais fácil de este agente mentir sem
 * nenhum número errado. Toda evidência externa carrega `capturadoEm`, e é este
 * arquivo que o transforma em uma das quatro respostas abaixo.
 *
 * **Duas datas, e elas não são a mesma coisa.** `capturadoEm` é quando nós
 * baixamos a página; `idadeDaPagina` é o que a própria página declara sobre si.
 * Buscar hoje um anúncio de 2024 é captura fresca de preço velho — as duas
 * juntas dizem isso, e nenhuma delas sozinha diz.
 */

export type Frescor = "AGORA" | "RECENTE" | "ENVELHECIDA" | "VELHA";

export const ROTULO_DO_FRESCOR: Record<Frescor, string> = {
  AGORA: "Capturada nesta consulta",
  RECENTE: "Capturada nas últimas 24 horas",
  ENVELHECIDA: "Capturada há mais de um dia",
  VELHA: "Capturada há mais de uma semana",
};

/** As fronteiras, em horas. Uma semana é o ponto em que o preço deixa de servir. */
const RECENTE_ATE_HORAS = 24;
const ENVELHECIDA_ATE_HORAS = 24 * 7;

/**
 * Quão fresca é uma captura.
 *
 * `agora` entra por argumento e não sai de `Date.now()` aqui dentro: uma função
 * que lê o relógio não se testa, e o frescor é exatamente a propriedade que
 * precisa de teste com o tempo controlado.
 */
export function frescorDe(capturadoEm: string, agora: Date): Frescor {
  const quando = new Date(capturadoEm).getTime();
  if (!Number.isFinite(quando)) return "VELHA";

  const horas = (agora.getTime() - quando) / 3_600_000;
  if (horas < 1) return "AGORA";
  if (horas < RECENTE_ATE_HORAS) return "RECENTE";
  if (horas < ENVELHECIDA_ATE_HORAS) return "ENVELHECIDA";
  return "VELHA";
}

/** A pior idade de um conjunto — é ela que qualifica a recomendação inteira. */
export function frescorDoConjunto(
  capturas: string[],
  agora: Date,
): Frescor | null {
  if (capturas.length === 0) return null;
  const ordem: Frescor[] = ["AGORA", "RECENTE", "ENVELHECIDA", "VELHA"];
  return capturas
    .map((c) => frescorDe(c, agora))
    .reduce((pior, atual) =>
      ordem.indexOf(atual) > ordem.indexOf(pior) ? atual : pior,
    );
}

/** Se uma captura ainda serve para ser apresentada como preço de mercado. */
export function aindaServe(frescor: Frescor): boolean {
  return frescor !== "VELHA";
}
