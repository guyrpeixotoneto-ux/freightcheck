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
  const quando = new Date(comFusoExplicito(capturadoEm)).getTime();
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

/**
 * O carimbo da ferramenta, com fuso, sempre.
 *
 * `web_fetch` devolve `retrieved_at` de dois jeitos — observados nas duas
 * primeiras pesquisas reais deste agente: `2026-09-17T00:58:14.396000+00:00` e
 * `2026-09-17T09:32:45.902484`, o segundo sem fuso nenhum. O JavaScript lê uma
 * data-hora sem fuso como **hora local**, então em São Paulo aquele segundo
 * carimbo vira três horas no futuro.
 *
 * E o erro tem direção: no futuro, a diferença até agora fica negativa, cai no
 * `horas < 1` e **toda captura vira AGORA**. Quer dizer, o defeito não faz a
 * cotação parecer velha — faz a velha parecer fresca, que é exatamente o
 * engano que `frescor.ts` existe para impedir.
 *
 * A normalização é conservadora: só acrescenta `Z` quando a string tem forma de
 * data-hora ISO e não traz fuso. Qualquer outra coisa passa intacta e cai no
 * `VELHA` do chamador, que é o desfecho certo para carimbo ilegível.
 */
export function comFusoExplicito(carimbo: string): string {
  const texto = carimbo.trim();
  const ehDataHora = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(texto);
  const temFuso = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(texto);
  return ehDataHora && !temFuso ? `${texto}Z` : texto;
}

/** Se uma captura ainda serve para ser apresentada como preço de mercado. */
export function aindaServe(frescor: Frescor): boolean {
  return frescor !== "VELHA";
}
