import { normalizarEquipamento } from "@workspace/curation";

import { EQUIPAMENTOS, rotuloDoTipo } from "@/lib/frota";

/**
 * As duas perguntas da fila de curadoria que não são desenho: "esta coluna já
 * está descrita?" e "de que equipamento ela é?".
 *
 * Moram aqui, e não na tela, porque respondem em vez de pintar. A tela decide a
 * cor do card e a ordem das abas; o significado da cor e o critério das abas
 * são isto, e são testáveis sem montar React.
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

/**
 * As abas fixas da curadoria: os mesmos três tipos que o resto do produto
 * conhece, na mesma ordem, lidos de `lib/frota.ts`.
 *
 * A lista mora lá, e não aqui, porque duas listas dos mesmos três tipos
 * concordam hoje e discordam no dia do quarto: a Curadoria mostraria uma aba
 * que o 360° não tem, ou o contrário, e a divergência só apareceria quando
 * alguém procurasse a aba que falta. Aqui fica o que é da Curadoria — **que
 * elas aparecem mesmo vazias.**
 *

 * Isso é o que faz a tela dizer "não há coluna de trecho nesta base" em vez de
 * simplesmente não ter onde procurar por ela. Um tipo vazio custa uma aba com
 * zero e uma frase; um tipo que só existe quando há dado custa a dúvida de
 * saber se a base não tem a coluna ou se a tela não sabe mostrá-la.
 *
 * **A lista não é escrita aqui.** Ela era, com as mesmas três strings e os
 * mesmos três rótulos que `lib/frota.ts` já mantinha para as telas 360°, e as
 * duas cópias nasceram no mesmo dia por caminhos diferentes — que é exatamente
 * como uma discordância futura começa. Os tipos que o produto nomeia são um
 * conjunto só; o que continua sendo desta tela é o que ela faz com eles: a
 * ordem, a contagem, e a decisão de mostrar a aba vazia.
 */
export const EQUIPAMENTOS_DA_CURADORIA: readonly string[] = EQUIPAMENTOS;

/** O mínimo de que as abas precisam de cada item da fila. */
export interface ItemComEquipamento {
  entityType: string;
}

export interface AbaDeEquipamento {
  /** `null` na aba "Todos" — o recorte que não recorta. */
  tipo: string | null;
  rotulo: string;
  /** Quantos itens da fila visível caem nela. */
  total: number;
}

/**
 * As abas a exibir: "Todos", as três fixas e o que mais a base trouxer.
 *
 * A ordem é deliberada. As fixas vêm na ordem do produto — o cavalo primeiro,
 * porque é o equipamento de maior custo fixo e o que a tela abre —, e um quarto
 * tipo qualquer entra depois delas, em ordem alfabética, sem precisar de
 * mudança nenhuma aqui.
 *
 * O total é contado sobre a fila que está na tela, e não sobre a base inteira:
 * é ele que promete quantos cards a aba tem para mostrar, e uma aba escrita
 * `Carreta 41` que abre com 12 cards porque 29 já foram confirmados seria a
 * própria aba mentindo sobre o que há atrás dela.
 */
export function abasDeEquipamento(
  itens: readonly ItemComEquipamento[],
): AbaDeEquipamento[] {
  const contagem = new Map<string, number>();
  for (const item of itens) {
    const tipo = normalizarEquipamento(item.entityType);
    if (tipo === null) continue;
    contagem.set(tipo, (contagem.get(tipo) ?? 0) + 1);
  }

  const fixas: string[] = [...EQUIPAMENTOS_DA_CURADORIA];
  const extras = [...contagem.keys()]
    .filter((tipo) => !fixas.includes(tipo))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  return [
    { tipo: null, rotulo: "Todos", total: itens.length },
    ...[...fixas, ...extras].map((tipo) => ({
      tipo,
      rotulo: rotuloDoTipo(tipo),
      total: contagem.get(tipo) ?? 0,
    })),
  ];
}

/**
 * O tipo como a base o guarda: em maiúsculas, sem espaço em volta.
 *
 * Existe porque a aba escolhida viaja no endereço, e um link escrito à mão com
 * `?equipamento=cavalo` tem de abrir a mesma aba que o clique. Texto vazio vira
 * `null`, que é a aba "Todos" — um endereço truncado abre a tela inteira, e não
 * uma fila vazia de um equipamento que não existe.
 *
 * **A regra não é escrita aqui.** Ela era, e passou a ter um segundo leitor no
 * dia em que o download do modelo virou o recorte da aba: a tela põe
 * `?equipamento=` no endereço e o servidor decide por ele que abas escrever no
 * arquivo. Com duas cópias, o dia em que uma aprendesse a tirar acento seria o
 * dia em que a tela mostraria 41 atributos e o arquivo sairia vazio.
 */
export { normalizarEquipamento };

/** A fila da aba. Em "Todos" (`null`), a fila inteira. */
export function filtrarPorEquipamento<T extends ItemComEquipamento>(
  itens: readonly T[],
  tipo: string | null,
): T[] {
  if (tipo === null) return [...itens];
  return itens.filter((item) => normalizarEquipamento(item.entityType) === tipo);
}
