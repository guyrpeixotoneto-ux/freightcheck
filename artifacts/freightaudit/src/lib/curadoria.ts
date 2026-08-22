import { normalizarEquipamento } from "@workspace/curation/equipamento";
import { TIPOS_DE_IMPORTACAO } from "@workspace/ingest/tipos";

import { rotuloDoTipo } from "@/lib/frota";

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
 * As abas fixas da curadoria: **tudo o que o produto importa**, na ordem em que
 * a tela de Importações os oferece — cavalo, carreta, trecho e os dois QLP.
 *
 * A lista sai de `@workspace/ingest/tipos`, e a escolha da autoridade é a
 * decisão desta linha. Ela vinha de `lib/frota.ts`, que é a lista dos tipos com
 * **tela 360°** — três —, e enquanto tudo o que se importava tinha tela as duas
 * respostas coincidiam. O quadro de pessoal desfez a coincidência: ele entra
 * por importação, traz coluna com nome que ninguém definiu, e não tem tela
 * 360° nenhuma. Preso à lista de lá, `QLP_OPERACIONAL` só apareceria na
 * curadoria depois de a primeira planilha dele entrar, e `QLP_ADMINISTRATIVO`
 * aparecia como aba extra — com o nome do banco, em caixa alta, ao lado de
 * `Cavalo` e `Carreta`. A pergunta que a Curadoria faz é "o que já foi
 * importado e ainda não tem significado", e a lista do que se importa é
 * `TIPOS_DE_IMPORTACAO`.
 *
 * O que continua sendo desta tela é o que ela faz com eles: a ordem, a
 * contagem, e — **que elas aparecem mesmo vazias.**
 *
 * Isso é o que faz a tela dizer "não há coluna de trecho nesta base" em vez de
 * simplesmente não ter onde procurar por ela. Um tipo vazio custa uma aba com
 * zero e uma frase; um tipo que só existe quando há dado custa a dúvida de
 * saber se a base não tem a coluna ou se a tela não sabe mostrá-la.
 */
export const EQUIPAMENTOS_DA_CURADORIA: readonly string[] =
  TIPOS_DE_IMPORTACAO.map((tipo) => tipo.code);

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
 * As abas a exibir: "Todos", as fixas e o que mais a base trouxer.
 *
 * A ordem é deliberada. As fixas vêm na ordem do produto — o cavalo primeiro,
 * porque é o equipamento de maior custo fixo e o que a tela abre —, e um tipo
 * que não está na lista de importação entra depois delas, em ordem alfabética,
 * sem precisar de mudança nenhuma aqui.
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

/** O item da fila tal como as duas regras abaixo precisam dele. */
export interface ItemDaFila extends ItemComEquipamento {
  code: string;
}

/**
 * De que equipamento é o atributo aberto — `undefined` quando a fila ainda não
 * o tem.
 *
 * Os três estados são diferentes e as duas regras abaixo dependem da diferença:
 * um tipo é resposta, `null` é "a linha veio sem tipo", e `undefined` é
 * **ausência de resposta** — a fila ainda está carregando, ou o atributo está
 * confirmado e o botão "Pendentes" o esconde. Decidir por `undefined` é decidir
 * por falta de dado, que é como a aba acabava trocando sozinha.
 */
export function equipamentoDoAtributo(
  itens: readonly ItemDaFila[],
  code: string,
): string | null | undefined {
  const item = itens.find((i) => i.code === code);
  return item === undefined ? undefined : normalizarEquipamento(item.entityType);
}

/**
 * O endereço depois de um clique numa aba: **o clique manda.**
 *
 * A tela fazia o contrário e sem dizer. Com um atributo de cavalo aberto, o
 * clique em Carreta escrevia `CARRETA` no endereço e um efeito o reescrevia
 * para `CAVALO` antes da repintura — as abas Carreta, Trecho e QLP não
 * selecionavam, e a única que parecia funcionar era a do atributo já aberto. O
 * efeito existia por um motivo real (um link para `cavalo.ipva` com a aba
 * `Carreta` no endereço mostrava um painel que a lista ao lado não continha),
 * mas ele não distinguia o link torto do clique deliberado.
 *
 * Aqui a contradição se resolve pelo outro lado: a aba escolhida fica, e o
 * atributo que não é dela sai da tela junto. Fecha só nesse caso — "Todos" e a
 * aba do próprio atributo não tiram nada —, e um atributo que a fila não tem
 * (`undefined`) fica onde está, porque em "Pendentes" a fila não traz os
 * confirmados e fechá-lo apagaria justamente o que o link pediu.
 */
export function enderecoDaAba(
  itens: readonly ItemDaFila[],
  tipo: string | null,
  atributo: string | null,
): { equipamento: string | null; atributo: string | null } {
  if (atributo === null || tipo === null) return { equipamento: tipo, atributo };
  const doAtributo = equipamentoDoAtributo(itens, atributo);
  const foraDaAba = doAtributo !== undefined && doAtributo !== tipo;
  return { equipamento: tipo, atributo: foraDaAba ? null : atributo };
}

/** A fila da aba. Em "Todos" (`null`), a fila inteira. */
export function filtrarPorEquipamento<T extends ItemComEquipamento>(
  itens: readonly T[],
  tipo: string | null,
): T[] {
  if (tipo === null) return [...itens];
  return itens.filter((item) => normalizarEquipamento(item.entityType) === tipo);
}
