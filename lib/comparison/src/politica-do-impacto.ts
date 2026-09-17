/**
 * A POLÍTICA DO IMPACTO — uma decisão, e as quatro superfícies que a obedecem.
 *
 * ---------------------------------------------------------------------------
 * A pergunta
 * ---------------------------------------------------------------------------
 * Uma comparação de rubrica produz dinheiro por periodicidade
 * (`porPeriodicidade`) e uma contagem à parte: quantas alterações de medida
 * DINHEIRO o motor **recusou precificar** (`naoCalculavel`). Quem recusa é o
 * portão da curadoria (`viraDinheiro`): `carreta.seguro` está PRESUMED, e por
 * isso uma carreta pode ir de R$ 180,79 a R$ 631,41 sem que um real apareça na
 * soma.
 *
 * Com os dois números na mão, uma tela pode afirmar três coisas diferentes — e
 * afirmar a errada é a pior forma de mentir numa tela de auditoria, porque
 * mente com números:
 *
 * 1. **`PRECIFICADO`** — há dinheiro somado. Publica-se o dinheiro.
 * 2. **`ZERO`** — não há dinheiro somado e não ficou nada por precificar: a
 *    conta aconteceu e deu zero. `R$ 0,00` é a notícia que quem audita veio
 *    buscar, e o vazio no lugar dela seria lido como "ainda não calculei".
 * 3. **`NAO_PRECIFICAVEL`** — não há dinheiro somado **e** houve alterações
 *    monetárias que ninguém pôde precificar. A conta não aconteceu: escrever
 *    `R$ 0,00` afirmaria que o dinheiro não se moveu numa comparação que não
 *    olhou para ele, e escrever o valor declarado sem ressalva afirmaria que o
 *    produto o confirma. O que existe é movimento declarado, não confirmado.
 *
 * ---------------------------------------------------------------------------
 * Por que ela mora no domínio, e não na rota
 * ---------------------------------------------------------------------------
 * Porque **quatro** superfícies respondem pela mesma comparação, e até
 * 17/09/2026 cada uma decidia sozinha:
 *
 * - o **seletor** de par (o menu do De) aplicava os três estados;
 * - o **cartão** "Impacto financeiro" só olhava `porPeriodicidade`, e por isso
 *   dizia "Sem impacto precificável" tanto no estado 2 quanto no 3 — a frase
 *   do terceiro estado sobre o segundo, que é uma conta que aconteceu;
 * - a **tabela** publicava `+R$ 317,07` na linha da carreta, sem ressalva;
 * - a **evolução entre as duas vigências** publicava `+R$ 2.318,77`, idem.
 *
 * Com o cartão dizendo "sem impacto precificável" e a tabela logo abaixo
 * mostrando reais, uma das duas está errada para quem lê — e nenhuma das duas
 * sabia da outra. A política passa a ser **uma**, e as quatro a consultam.
 *
 * ---------------------------------------------------------------------------
 * O que ela **não** faz
 * ---------------------------------------------------------------------------
 * Não soma, não arredonda e não esconde número nenhum. Ela classifica o que já
 * foi calculado — nenhuma conta desta casa muda por causa dela. No estado 3 o
 * valor declarado continua em tela, com a ressalva ao lado: quem audita precisa
 * ver que a carreta foi de R$ 180,79 a R$ 631,41; o que ele não pode é ler isso
 * como um real confirmado.
 *
 * No dia em que a curadoria confirmar a semântica dessas colunas, o motor passa
 * a devolver `CALCULATED`, `naoCalculavel` zera, e as quatro superfícies caem
 * sozinhas no primeiro estado. Nada aqui precisa saber o nome de nenhuma
 * coluna para isso acontecer — e é justamente por isso que uma lista de exceções
 * por código seria o defeito, e não a correção.
 */

/** O que a tela pode afirmar sobre o dinheiro desta comparação. */
export type EstadoDoImpacto = "PRECIFICADO" | "ZERO" | "NAO_PRECIFICAVEL";

/** A leitura da política — o estado, e o que cada superfície faz com ele. */
export interface LeituraDoImpacto {
  estado: EstadoDoImpacto;
  /**
   * Pode-se publicar um valor somado como resultado desta comparação?
   *
   * Verdadeiro nos estados 1 e 2 — no 2 o valor é zero, e zero é resultado.
   */
  publicaValor: boolean;
  /**
   * O dinheiro que a tela mostra vem de coluna declarada e **não** foi
   * confirmado pela curadoria — a tabela e a evolução marcam, o cartão explica.
   *
   * É o estado 3, e só ele.
   */
  declaradoSemConfirmacao: boolean;
  /** Quantas alterações monetárias ficaram sem valor. Zero fora do estado 3. */
  naoPrecificadas: number;
}

/**
 * A política, aplicada.
 *
 * `porPeriodicidade` é o dinheiro que o motor somou; `naoPrecificadas` é o
 * `naoCalculavel` da rubrica — as alterações de medida DINHEIRO que ele
 * recusou precificar.
 *
 * Algum balde manda: um recorte que precificou **parte** do que mudou publica
 * o que precificou. Calar a coluna ali esconderia dinheiro medido por causa do
 * que ficou por medir.
 */
export function leituraDoImpacto(
  porPeriodicidade: Record<string, number>,
  naoPrecificadas: number,
): LeituraDoImpacto {
  const temValor = Object.keys(porPeriodicidade).length > 0;
  if (temValor) {
    return {
      estado: "PRECIFICADO",
      publicaValor: true,
      declaradoSemConfirmacao: false,
      naoPrecificadas: 0,
    };
  }
  if (naoPrecificadas === 0) {
    return {
      estado: "ZERO",
      publicaValor: true,
      declaradoSemConfirmacao: false,
      naoPrecificadas: 0,
    };
  }
  return {
    estado: "NAO_PRECIFICAVEL",
    publicaValor: false,
    declaradoSemConfirmacao: true,
    naoPrecificadas,
  };
}

/**
 * A ressalva que acompanha um valor declarado e não confirmado.
 *
 * Uma frase só, e curta, porque ela aparece ao lado de números — no rodapé da
 * tabela, embaixo do painel de evolução. A explicação inteira é da rubrica
 * (`SEM_IMPACTO_PRECIFICAVEL_DE_SEGURO` e irmãs), e vai no cartão, que é onde
 * cabe.
 */
export const VALOR_DECLARADO_SEM_CONFIRMACAO =
  "Valores declarados pelo export. A curadoria ainda não confirmou a semântica destas colunas, " +
  "então eles não entram no impacto apurado.";
