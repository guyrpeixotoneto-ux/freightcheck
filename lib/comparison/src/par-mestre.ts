import {
  formamParDeVigencias,
  type VigenciaEmparelhavel,
} from "./recorte-de-rubrica";
import { COBERTURAS, type CoberturaDoCatalogo } from "./alteracoes-por-modulo";

/**
 * O PAR MESTRE — uma data para as quatro coberturas do catálogo.
 *
 * ---------------------------------------------------------------------------
 * Por que esta regra desceu da tela para o domínio
 * ---------------------------------------------------------------------------
 * Ela nasceu inteira em `lib/seletor-mestre.ts`, no navegador, porque só a tela
 * precisava traduzir uma data para os ids de cada cobertura. Deixou de ser
 * verdade quando o seletor mestre ganhou a coluna de números: quem calcula o
 * que cada data candidata produz é o servidor, e ele precisa chegar **aos
 * mesmos ids** que a tela escreveria no endereço ao clicar naquela linha.
 *
 * Duas cópias desta tradução seriam o pior defeito possível neste menu: o
 * número ao lado de `agosto/2026 · 1ª quinzena` sairia de um par, o clique
 * levaria a outro, e nada em tela diria por quê. Uma função só, nos dois lados,
 * é o que faz o número do menu ser o número que o clique entrega.
 *
 * O que ficou na tela é o que é da tela: reancorar a ponta invalidada, ler o
 * mestre dos quatro pares, nomear quem divergiu.
 */

/** O par mestre: duas datas de vigência (`YYYY-MM-DD`), ou vazias. */
export type ParMestre = { de: string; para: string };

export const MESTRE_VAZIO: ParMestre = { de: "", para: "" };

/** Um par já traduzido para os ids de uma cobertura. */
export type ParEscolhido = { base: string; comparada: string };

/** As vigências que cada cobertura oferece — o que as duas pontas montam. */
export type ListasDoCatalogo<T extends VigenciaEmparelhavel = VigenciaEmparelhavel> = Record<
  CoberturaDoCatalogo,
  readonly T[]
>;

/** O mestre está completo — duas pontas, e distintas. */
export function mestreCompleto(mestre: ParMestre): boolean {
  return Boolean(mestre.de) && Boolean(mestre.para) && mestre.de !== mestre.para;
}

/** Trocar as pontas do mestre é trocar as pontas de cada cobertura que o segue. */
export function inverterMestre(mestre: ParMestre): ParMestre {
  return { de: mestre.para, para: mestre.de };
}

/**
 * Todas as datas do acervo, das quatro listas, uma vez cada — da mais nova para
 * a mais velha.
 *
 * É o que o seletor mestre oferece, e é de propósito que ele seja a **união** e
 * não a interseção: a interseção esconderia a quinzena que só o QLP tem, e
 * escolher por ela é um gesto legítimo — as coberturas que não a têm ficam com
 * o par delas, que é justamente o que a tela sabe dizer.
 */
export function datasDoAcervo(listas: ListasDoCatalogo): string[] {
  const datas = new Set<string>();
  for (const cobertura of COBERTURAS) {
    for (const v of listas[cobertura]) datas.add(v.effectiveDate);
  }
  return [...datas].sort((a, b) => b.localeCompare(a));
}

/**
 * O par do mestre traduzido para os ids de uma cobertura — `null` quando ela
 * não o forma.
 *
 * Uma data pode ter mais de uma vigência na mesma lista (a lista do QLP não é
 * recortada por unidade), então o teste não é "achei as duas datas": é achar o
 * primeiro par de vigências dessas duas datas que o motor aceita
 * (`formamParDeVigencias`, que exige mesma unidade e coberturas que se falam).
 * Nenhum par sai daqui sem passar por essa régua.
 */
export function parNaCobertura(
  lista: readonly VigenciaEmparelhavel[],
  mestre: ParMestre,
): ParEscolhido | null {
  if (!mestreCompleto(mestre)) return null;
  const des = lista.filter((v) => v.effectiveDate === mestre.de);
  const paras = lista.filter((v) => v.effectiveDate === mestre.para);
  for (const base of des) {
    for (const comparada of paras) {
      if (formamParDeVigencias(base, comparada)) {
        return { base: base.id, comparada: comparada.id };
      }
    }
  }
  return null;
}

/** As coberturas que conseguem formar o par do mestre. */
export function coberturasQueSeguem(
  mestre: ParMestre,
  listas: ListasDoCatalogo,
): CoberturaDoCatalogo[] {
  return COBERTURAS.filter((c) => parNaCobertura(listas[c], mestre) !== null);
}

/**
 * Os pares de cada cobertura para um mestre — só os que o motor aceita.
 *
 * É o que a rota de candidatas pede por data, e é a mesma leitura que
 * `aplicarMestre` escreve no endereço do outro lado.
 */
export function paresDoMestre(
  mestre: ParMestre,
  listas: ListasDoCatalogo,
): Partial<Record<CoberturaDoCatalogo, ParEscolhido>> {
  const pares: Partial<Record<CoberturaDoCatalogo, ParEscolhido>> = {};
  for (const cobertura of COBERTURAS) {
    const par = parNaCobertura(listas[cobertura], mestre);
    if (par) pares[cobertura] = par;
  }
  return pares;
}
