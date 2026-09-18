import { SEM_IMPACTO_FINANCEIRO } from "./qlp-comparacao";
import { SEM_IMPACTO_DE_TMA } from "./tma";

/**
 * POR QUE UM MÓDULO NÃO PUBLICA MONTANTE — o registro, escrito uma vez só.
 *
 * ---------------------------------------------------------------------------
 * Duas ausências, e elas não se dizem com a mesma frase
 * ---------------------------------------------------------------------------
 * "Não há dinheiro neste cartão" tem dois significados opostos, e confundi-los
 * é o defeito que este arquivo existe para impedir:
 *
 * - **O módulo podia ter dinheiro e não teve.** O aluguel é BRL/MENSAL
 *   confirmado; se ele não se moveu em nenhuma vigência do acervo, a resposta é
 *   *"sem alteração financeira nas vigências disponíveis"* — e ela é
 *   verificável, porque vem com quantos pares foram varridos e em que
 *   intervalo.
 * - **O módulo não produz montante por decisão semântica.** O R$/km da
 *   manutenção é uma razão; o preço da nota de compra não tem módulo dono; as
 *   colunas do QLP chegam sem semântica confirmada. Aqui não falta dado: falta
 *   *significado*, e é a curadoria que o dá, não uma importação.
 *
 * A primeira é a ausência de um fato. A segunda é um fato sobre o módulo. Uma
 * tela que dissesse "sem alteração financeira" na manutenção mandaria alguém
 * procurar uma vigência que não existe, quando o que há para procurar é uma
 * confirmação de curadoria.
 *
 * ---------------------------------------------------------------------------
 * Por que as frases moram juntas, e as duas antigas não foram copiadas
 * ---------------------------------------------------------------------------
 * Porque a pergunta é a mesma para os nove módulos, e nove cópias dela
 * envelheceriam em nove velocidades. O que **não** se faz aqui é reescrever uma
 * frase que já existe: o QLP e o TMA já publicavam a sua, nos módulos que as
 * conhecem, e elas entram importadas — mudar a explicação do TMA continua sendo
 * mexer em `tma.ts`, e esta tabela acompanha sozinha.
 */

/** A natureza do que um módulo mede, quando ela não é dinheiro. */
export interface NaturezaDoModulo {
  /** Por que não há montante — a frase que a tela exibe sob o rótulo. */
  motivo: string;
  /**
   * Em que grandeza este módulo mede.
   *
   * Vai para o lugar em que o cartão financeiro escreve a periodicidade: é a
   * resposta honesta a "R$ de quê?" quando não há R$ nenhum.
   */
  unidade: string;
}

/**
 * Os módulos cuja natureza atual não permite apurar montante financeiro.
 *
 * A ausência de uma chave aqui é o que define um módulo como financeiro — e é
 * de propósito que a lista seja de exceções: um módulo novo entra como
 * financeiro e, se não for, alguém tem de vir aqui escrever por quê.
 */
export const NATUREZA_SEM_MONTANTE: Record<string, NaturezaDoModulo> = {
  AQUISICAO: {
    motivo:
      "O valor de aquisição do ativo não compõe o impacto de custo fixo. A nota " +
      "de compra não tem módulo dono da soma — as três telas que a leem recusam " +
      "somá-la com a mesma frase —, e incluí-la aqui contaria o preço do ativo " +
      "como despesa do período.",
    unidade: "R$ por nota de compra",
  },
  MANUTENCAO: {
    motivo:
      "A manutenção é apurada em R$/km, que é uma razão e não um montante do " +
      "período. Ela só vira dinheiro multiplicada pela quilometragem que a " +
      "operação rodou — produção que esta comparação não carrega.",
    unidade: "R$/km",
  },
  CONSUMO: {
    motivo:
      "O consumo é apurado em R$/km e km/l. As duas são razões: viram dinheiro " +
      "multiplicadas pela distância rodada, que não é dado desta comparação.",
    unidade: "R$/km e km/l",
  },
  PNEU: {
    motivo:
      "O pneu é apurado em R$/km, sobre valor unitário e vida útil. O montante " +
      "depende da quilometragem rodada no período, que esta comparação não " +
      "carrega.",
    unidade: "R$/km",
  },
  KM_RODADO: {
    motivo:
      "O km rodado mede distância e a parcela de R$/km que ela remunera. A " +
      "distância não é dinheiro, e a parcela é razão — o montante só existe " +
      "multiplicado pela produção do período.",
    unidade: "km e R$/km",
  },
  VELOCIDADE_MEDIA: {
    motivo:
      "A velocidade média mede km/h e minutos de parada. O tempo só vira dinheiro " +
      "atravessado pela jornada e pelo número de viagens — conta que este acervo " +
      "não sustenta.",
    unidade: "km/h e minutos",
  },
  TMA: { motivo: SEM_IMPACTO_DE_TMA, unidade: "minutos" },
};

/** A natureza dos assuntos do quadro — uma só, e ela vem do QLP. */
export const NATUREZA_DO_QLP: NaturezaDoModulo = {
  motivo: SEM_IMPACTO_FINANCEIRO,
  unidade: "cargos e efetivo",
};

/** Se este módulo pode, por natureza, publicar montante financeiro. */
export function ehModuloFinanceiro(modulo: string): boolean {
  return !(modulo in NATUREZA_SEM_MONTANTE);
}
