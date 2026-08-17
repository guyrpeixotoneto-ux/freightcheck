/**
 * O escopo de frota — de que ativos a tela inteira está falando.
 *
 * As telas Cavalo 360° e Carreta 360° fazem as mesmas quatro perguntas de
 * Alterações sobre uma população menor: os cavalos, as carretas, ou um ativo
 * só. Este arquivo é o vocabulário disso, num lugar só, porque a distinção que
 * ele carrega é a que mantém aquelas telas honestas:
 *
 * **Escopo não é filtro.** Um filtro estreita *a lista* dentro de uma população
 * já anunciada — é o que `ChangeFilters` e `TicketFilters` fazem, e por isso o
 * painel de filtros da tela escreve cada um deles com o × que o desfaz ao lado.
 * Um escopo troca *a população*, e por isso ele precisa alcançar também os
 * cartões, os agrupamentos e os totais. Aplicá-lo como filtro deixaria uma tela
 * chamada "Cavalo 360°" mostrando 1.218 alterações no cartão e 340 na lista, e
 * as duas com a mesma cara de verdade.
 *
 * É por isso que ele entra pelas funções de totalização — `totaisDoEscopo`,
 * `getChangeSetBreakdown`, `getTicketTotals` — e não pelos objetos de filtro
 * que já existiam. As duas coisas convivem: o escopo diz de quem é a tela, e o
 * filtro diz o que dela está à vista.
 *
 * A placa é o identificador corrente do ativo (`entity_identifier` do tipo
 * `PLACA`), que é o mesmo texto que `change.entity_label` e
 * `ticket_change.entity_label` guardam denormalizado. Guardá-la como texto e não
 * como `entity_id` é o que permite ao escopo atravessar as quatro leituras: a
 * do chamado nunca resolveu o ativo canônico, e exigir o UUID deixaria a aba
 * Chamados fora do recorte que dá nome à tela.
 */

/** De que ativos a tela fala. Campo ausente quer dizer "não estreita por aqui". */
export interface EscopoDeFrota {
  /** `CAVALO` | `CARRETA` — o equipamento. */
  entityType?: string | undefined;
  /** A placa de um ativo, quando a tela desceu a um só. */
  plate?: string | undefined;
}

export const ESCOPO_VAZIO: EscopoDeFrota = {};

/** Se o escopo estreita alguma coisa — o resto do produto lê a frota inteira. */
export function temEscopo(escopo: EscopoDeFrota | undefined): boolean {
  if (!escopo) return false;
  return Boolean(escopo.entityType) || Boolean(escopo.plate);
}

/**
 * O escopo como as consultas o querem: sem string vazia, que não estreita nada.
 *
 * `?placa=` vazio chega de uma tela que acabou de limpar o seletor, e tratá-lo
 * como uma placa faria a consulta procurar o ativo de placa "" e devolver uma
 * tela vazia onde a resposta certa é a frota inteira.
 */
export function lerEscopo(valores: {
  entityType?: unknown;
  plate?: unknown;
}): EscopoDeFrota {
  const texto = (valor: unknown): string | undefined =>
    typeof valor === "string" && valor.trim() !== "" ? valor.trim() : undefined;
  const escopo: EscopoDeFrota = {};
  const tipo = texto(valores.entityType);
  const placa = texto(valores.plate);
  if (tipo !== undefined) escopo.entityType = tipo;
  if (placa !== undefined) escopo.plate = placa;
  return escopo;
}
