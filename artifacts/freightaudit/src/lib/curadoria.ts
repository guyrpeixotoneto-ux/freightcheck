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
 * As abas fixas da curadoria, na ordem em que o produto fala delas.
 *
 * Elas aparecem mesmo sem nenhum atributo importado do tipo — é o que faz a
 * curadoria dizer "não há coluna de trecho nesta base" em vez de simplesmente
 * não ter onde procurar por ela. Um tipo vazio custa uma aba com zero e uma
 * frase; um tipo que só existe quando há dado custa a dúvida de saber se a base
 * não tem a coluna ou se a tela não sabe mostrá-la.
 *
 * `TRECHO` está na lista antes de existir na base pela mesma razão: o tipo de
 * entidade nasce do nome da aba da planilha importada (`Trecho` → `TRECHO`), e
 * a curadoria precisa estar pronta para recebê-lo sem mudança de código.
 */
export const EQUIPAMENTOS_DA_CURADORIA = ["CAVALO", "CARRETA", "TRECHO"] as const;

const ROTULOS: Record<string, string> = {
  CAVALO: "Cavalo",
  CARRETA: "Carreta",
  TRECHO: "Trecho",
};

/**
 * "CAVALO" → "Cavalo". Um tipo que não conhecemos sai como veio.
 *
 * Inventar capitalização para o desconhecido erraria em `FROTA_PROPRIA` e em
 * qualquer sigla; o nome cru é feio e é verdade, e é o que a pessoa vai
 * reconhecer da aba da planilha que importou.
 */
export function rotuloDoEquipamento(tipo: string): string {
  return ROTULOS[tipo] ?? tipo;
}

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
      rotulo: rotuloDoEquipamento(tipo),
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
 */
export function normalizarEquipamento(valor: string | null): string | null {
  const limpo = valor?.trim().toUpperCase() ?? "";
  return limpo === "" ? null : limpo;
}

/** A fila da aba. Em "Todos" (`null`), a fila inteira. */
export function filtrarPorEquipamento<T extends ItemComEquipamento>(
  itens: readonly T[],
  tipo: string | null,
): T[] {
  if (tipo === null) return [...itens];
  return itens.filter((item) => normalizarEquipamento(item.entityType) === tipo);
}
