import {
  CHAVE_DA_FONTE,
  fonteDoParametro,
  parametroDaFonte,
  SEMANTICA_DA_FONTE,
  type FonteDeFiname,
} from "@workspace/comparison/fonte-de-finame";
import { ehCompetencia, type Competencia } from "@workspace/comparison/competencia-de-finame";

/**
 * A FONTE, DO LADO DA TELA — ler do endereço, escrever no endereço, e nada mais.
 *
 * A decisão do que cada fonte significa mora em `@workspace/comparison/
 * fonte-de-finame`, que o servidor importa do mesmo jeito. Este arquivo é a
 * metade de navegação: qual fonte o endereço traz, que endereço uma troca
 * produz, e **o que precisa cair** quando a fonte muda.
 *
 * ---------------------------------------------------------------------------
 * A limpeza da troca é a parte que erra feio
 * ---------------------------------------------------------------------------
 * As duas fontes têm eixos temporais diferentes — a Remunerada tem um par de
 * vigências (`base`/`comparada`), a Real tem uma competência. Trocar de fonte
 * sem limpar deixaria na URL uma ponta que a outra fonte não sabe ler, e o
 * primeiro efeito da tela a leria como se soubesse: um `base=<uuid>` sobrevivendo
 * na fonte Real é um par de vigências fantasma sob uma tela de competência.
 *
 * Por isso {@link enderecoDaFonte} não acrescenta a chave nova: ela **troca** o
 * eixo inteiro. O que atravessa a troca é o que é da tela e não de uma das
 * fontes — unidade, canal, operação, `scopeHash` e o recorte de equipamento.
 */

export { CHAVE_DA_FONTE, SEMANTICA_DA_FONTE, type FonteDeFiname };

/** A chave da competência no endereço — o eixo temporal da fonte Real. */
export const CHAVE_DA_COMPETENCIA = "competencia";

/** As chaves do eixo temporal de cada fonte. Nenhuma delas atravessa a troca. */
const EIXO_DA_FONTE: Record<FonteDeFiname, readonly string[]> = {
  REMUNERADO: ["base", "comparada"],
  REAL: [CHAVE_DA_COMPETENCIA],
};

/**
 * A fonte que o endereço traz.
 *
 * Link antigo, sem a chave, abre em Remunerado — o comportamento que esta tela
 * sempre teve. Ver `fonteDoParametro`, que é quem decide.
 */
export function fonteDaBusca(busca: string): FonteDeFiname {
  return fonteDoParametro(new URLSearchParams(busca).get(CHAVE_DA_FONTE));
}

/**
 * A competência que o endereço traz — `null` quando não traz uma válida.
 *
 * `null` não é erro: é "ninguém escolheu ainda", e quem escolhe então é a tela,
 * pegando a última competência válida da fonte. Uma competência malformada cai
 * no mesmo `null` em vez de virar um mês inexistente.
 */
export function competenciaDaBusca(busca: string): Competencia | null {
  const pedida = new URLSearchParams(busca).get(CHAVE_DA_COMPETENCIA);
  return ehCompetencia(pedida) ? pedida : null;
}

/**
 * O endereço de uma troca de fonte — com o eixo temporal da fonte que sai
 * removido.
 *
 * `competencia` entra quando se vai para a Real e já se sabe qual mês abrir; sem
 * ela, a tela escolhe e reescreve o endereço no primeiro quadro. O caminho é
 * preservado, de modo que a função serve tanto para `/custo-fixo-finame` quanto
 * para qualquer endereço que venha a hospedar esta tela.
 */
export function enderecoDaFonte(
  caminho: string,
  busca: string,
  fonte: FonteDeFiname,
  competencia?: Competencia | null,
): string {
  const parametros = new URLSearchParams(busca);

  /* O eixo da fonte que sai **e** o da que entra saem os dois: o da que sai
     porque é incompatível, o da que entra porque quem manda nele é o argumento
     desta chamada — e não um resto de uma visita anterior. */
  for (const chave of [...EIXO_DA_FONTE.REMUNERADO, ...EIXO_DA_FONTE.REAL]) {
    parametros.delete(chave);
  }

  if (fonte === "REMUNERADO") parametros.delete(CHAVE_DA_FONTE);
  else parametros.set(CHAVE_DA_FONTE, parametroDaFonte(fonte));

  if (fonte === "REAL" && competencia) {
    parametros.set(CHAVE_DA_COMPETENCIA, competencia);
  }

  const query = parametros.toString();
  return query === "" ? caminho : `${caminho}?${query}`;
}

/**
 * O endereço de uma troca de competência, dentro da fonte Real.
 *
 * Separado de {@link enderecoDaFonte} porque não é uma troca de eixo: a fonte
 * continua a mesma, e o resto do endereço — unidade, recorte, modo — fica
 * intocado.
 */
export function enderecoDaCompetencia(
  caminho: string,
  busca: string,
  competencia: Competencia,
): string {
  const parametros = new URLSearchParams(busca);
  parametros.set(CHAVE_DA_FONTE, parametroDaFonte("REAL"));
  parametros.set(CHAVE_DA_COMPETENCIA, competencia);
  return `${caminho}?${parametros.toString()}`;
}

/**
 * A competência que a tela deve abrir, dada a que o endereço pede e as que
 * existem.
 *
 * A regra, na ordem: **preserva o que existe nos dois contextos**, e só escolhe
 * quando o que foi pedido não existe — aí a última, que é a mais recente. Uma
 * competência pedida e inexistente nunca fica na tela nem no endereço; é a
 * mesma doutrina de `parReconciliado`, do lado remunerado.
 */
export function competenciaReconciliada(
  pedida: Competencia | null,
  disponiveis: readonly Competencia[],
): Competencia | null {
  if (pedida && disponiveis.includes(pedida)) return pedida;
  return disponiveis.length > 0 ? disponiveis[disponiveis.length - 1] : null;
}

/** A consulta que as rotas da fonte Real recebem. */
export function consultaDoConfronto(
  contexto: URLSearchParams,
  competencia: Competencia | null,
  tipo: "TODOS" | "CAVALO" | "CARRETA",
): string {
  const q = new URLSearchParams(contexto);
  q.set(CHAVE_DA_FONTE, parametroDaFonte("REAL"));
  if (competencia) q.set(CHAVE_DA_COMPETENCIA, competencia);
  if (tipo !== "TODOS") q.set("tipo", tipo);
  return q.toString();
}
