import {
  formamParDeVigencias,
  motivoSemPar,
  parDePartida,
  type MotivoSemPar,
  type VigenciaEmparelhavel,
} from "@workspace/comparison/recorte-de-rubrica";
import type { CoberturaDoCatalogo } from "@workspace/comparison/alteracoes-por-modulo";
import { COBERTURAS, type ParEscolhido, type ParesDoCatalogo } from "@/lib/alteracoes-por-modulo";

/**
 * O PAR MESTRE — um gesto só para as quatro coberturas do catálogo.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo resolve
 * ---------------------------------------------------------------------------
 * Alterações por Módulo atravessa quatro coberturas, e o motor recusa um par
 * entre coberturas diferentes (`engine.ts`: "Coberturas diferentes"). Daí os
 * quatro seletores: cada cobertura escolhe dentro do que ela própria tem.
 *
 * O preço disso apareceu na primeira leitura em celular: quatro pares de caixas
 * empilhados antes do primeiro cartão, e — por `parDePartida` rodar quatro
 * vezes, uma por lista — quatro pares **diferentes** em tela, sem nada dizendo
 * por que diferem. Quem abre a tela quer comparar agosto com setembro, não
 * quatro vezes a mesma frase.
 *
 * O mestre é esse gesto: escolhe-se **um** par, e ele é aplicado a toda
 * cobertura que o aceita. O que não o aceita **fica como estava** e é nomeado
 * em tela — nunca silenciosamente arrastado para um par que o motor recusaria.
 *
 * ---------------------------------------------------------------------------
 * Por que o mestre é um par de DATAS, e não de ids
 * ---------------------------------------------------------------------------
 * Porque as quatro listas não saem da mesma consulta. Equipamento e Trecho são
 * recortes do **mesmo** `/snapshots`, então uma vigência que cobre os dois tem
 * um id só nas duas listas; os dois quadros do QLP vêm de
 * `/snapshots?datasetFamily=QUADRO_DE_PESSOAL`, que são **outras** vigências,
 * com outros ids. Um mestre por id nunca casaria com o QLP: a mesma quinzena de
 * setembro é um id na frota e outro no quadro.
 *
 * A data é o que as quatro têm em comum — é ela que a tela já escreve
 * (`rotuloDaVigencia`: `setembro/2026 · 1ª quinzena`) e é por ela que quem
 * audita pensa. Cada cobertura traduz a data para o id **dela**
 * ({@link parNaCobertura}) e o par escrito no endereço continua sendo o mesmo
 * de sempre: `baseEquipamento`, `comparadaTrecho`, e assim por diante.
 *
 * ---------------------------------------------------------------------------
 * O mestre não é um quinto estado
 * ---------------------------------------------------------------------------
 * Ele não mora no endereço, e não há o que reconciliar entre ele e os pares:
 * ele é **lido** dos quatro pares ({@link mestreDosPares}) e **escrito** de
 * volta neles ({@link aplicarMestre}). Um link antigo, com quatro pares
 * divergentes, abre exatamente como abria — e a tela diz quais divergem.
 */

/** O par mestre: duas datas de vigência (`YYYY-MM-DD`), ou vazias. */
export type ParMestre = { de: string; para: string };

export const MESTRE_VAZIO: ParMestre = { de: "", para: "" };

/** As vigências que cada cobertura oferece — o que a página já monta. */
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
 * O mestre escrito nos quatro pares — e **só** nos que o aceitam.
 *
 * A cobertura que não forma o par do mestre fica com o par que já tinha. É a
 * regra que mantém verdadeira a promessa da tela: o par em tela é sempre um par
 * que o motor aceita, mesmo quando o gesto foi um só.
 */
export function aplicarMestre(
  mestre: ParMestre,
  listas: ListasDoCatalogo,
  atuais: ParesDoCatalogo,
): ParesDoCatalogo {
  const proximos = { ...atuais };
  for (const cobertura of COBERTURAS) {
    const par = parNaCobertura(listas[cobertura], mestre);
    if (par) proximos[cobertura] = par;
  }
  return proximos;
}

/** As datas de um par de ids, dentro de uma lista. */
function datasDoPar(
  lista: readonly VigenciaEmparelhavel[],
  par: ParEscolhido,
): ParMestre | null {
  const de = lista.find((v) => v.id === par.base)?.effectiveDate;
  const para = lista.find((v) => v.id === par.comparada)?.effectiveDate;
  return de && para ? { de, para } : null;
}

/**
 * O mestre que os quatro pares em tela dizem — a maioria, e não o primeiro.
 *
 * Com os quatro pares iguais (o caso normal depois de um gesto no mestre), é
 * esse par. Com pares divergentes — um link antigo, ou um ajuste por cobertura
 * —, é o par da **maioria**: ele é o que o seletor mestre mostra, e as
 * dissidentes são nomeadas ao lado ({@link situacaoDasCoberturas}).
 *
 * Empate entre dois pares com a mesma contagem: fica o da cobertura que a tela
 * oferece primeiro, que é a ordem de `COBERTURAS`. Nenhum par completo em tela:
 * o mestre é vazio, e a tela abre pedindo uma escolha em vez de inventar uma.
 */
export function mestreDosPares(pares: ParesDoCatalogo, listas: ListasDoCatalogo): ParMestre {
  const contagem = new Map<string, { mestre: ParMestre; vezes: number }>();
  for (const cobertura of COBERTURAS) {
    const par = pares[cobertura];
    if (!par.base || !par.comparada) continue;
    const datas = datasDoPar(listas[cobertura], par);
    if (!datas) continue;
    const chave = `${datas.de}>${datas.para}`;
    const visto = contagem.get(chave);
    if (visto) visto.vezes += 1;
    else contagem.set(chave, { mestre: datas, vezes: 1 });
  }
  let escolhido: { mestre: ParMestre; vezes: number } | null = null;
  for (const entrada of contagem.values()) {
    if (!escolhido || entrada.vezes > escolhido.vezes) escolhido = entrada;
  }
  return escolhido?.mestre ?? MESTRE_VAZIO;
}

/**
 * O mestre de abertura — o par que serve a **mais** coberturas.
 *
 * Os candidatos são os pares de partida das quatro listas (`parDePartida`, a
 * mesma função que cada cobertura usaria sozinha), e vence o que mais
 * coberturas conseguem seguir. É o que troca os quatro pares divergentes do
 * primeiro carregamento por um par só, sem que nenhuma cobertura passe a exibir
 * um par que o motor recusa.
 *
 * Empate em número de seguidores: fica o de destino mais recente — a leitura
 * que a tela abre é "o que mudou na última vigência", e não numa do meio.
 */
export function mestreDePartida(listas: ListasDoCatalogo): ParMestre {
  let escolhido: { mestre: ParMestre; seguidores: number } | null = null;
  for (const cobertura of COBERTURAS) {
    const partida = parDePartida(listas[cobertura]);
    if (!partida) continue;
    const mestre = {
      de: partida.base.effectiveDate,
      para: partida.comparada.effectiveDate,
    };
    const seguidores = coberturasQueSeguem(mestre, listas).length;
    const melhor =
      !escolhido ||
      seguidores > escolhido.seguidores ||
      (seguidores === escolhido.seguidores && mestre.para > escolhido.mestre.para);
    if (melhor) escolhido = { mestre, seguidores };
  }
  return escolhido?.mestre ?? MESTRE_VAZIO;
}

/**
 * A ponta que a escolha invalidou, arrastada para a mais próxima que serve.
 *
 * É o {@link compativelMaisProxima} do seletor de par, um nível acima: trocar o
 * "De" do mestre para uma data que não forma par com o "Para" atual em nenhuma
 * cobertura deixaria em tela um mestre que não aplica nada. A outra ponta vai
 * para a data mais próxima no tempo que volte a servir a alguma cobertura.
 *
 * Empate entre uma anterior e uma posterior à mesma distância: fica a
 * **anterior**, pela mesma razão do seletor de par — a leitura do produto anda
 * para frente no tempo.
 *
 * Quando nenhuma data forma par com a escolhida, a outra ponta fica **vazia**:
 * a tela não consulta par incompleto, e a frase do painel diz que nenhuma
 * cobertura tem esse par. Inventar uma ponta ali seria escolher pela pessoa uma
 * comparação que ela não pediu.
 */
export function reancorarMestre(
  mestre: ParMestre,
  listas: ListasDoCatalogo,
  ancora: "de" | "para",
): ParMestre {
  if (coberturasQueSeguem(mestre, listas).length > 0) return mestre;
  const fixa = ancora === "de" ? mestre.de : mestre.para;
  if (!fixa) return mestre;
  const candidatas = datasDoAcervo(listas).filter(
    (data) =>
      data !== fixa &&
      coberturasQueSeguem(
        ancora === "de" ? { de: fixa, para: data } : { de: data, para: fixa },
        listas,
      ).length > 0,
  );
  const alvo = maisProxima(candidatas, fixa);
  return ancora === "de" ? { de: fixa, para: alvo } : { de: alvo, para: fixa };
}

/** A data mais perto de uma referência; empate fica com a anterior. */
function maisProxima(datas: readonly string[], referencia: string): string {
  const alvo = Date.parse(referencia);
  let escolhida = "";
  let menor = Number.POSITIVE_INFINITY;
  for (const data of datas) {
    const distancia = Math.abs(Date.parse(data) - alvo);
    if (distancia < menor || (distancia === menor && data < escolhida)) {
      menor = distancia;
      escolhida = data;
    }
  }
  return escolhida;
}

/**
 * Em que pé cada cobertura está diante do mestre — o que a tela precisa dizer.
 *
 * - `SEGUE` — o par em tela é o do mestre. É o caso normal, e o que a linha
 *   verde conta em uma frase só.
 * - `PROPRIO` — a cobertura tem par, mas outro: ou o mestre não existe no
 *   acervo dela, ou alguém ajustou essa cobertura à mão. Ela é **nomeada**, com
 *   o par dela junto: era exatamente isto que a tela dos quatro seletores
 *   deixava a pessoa deduzir comparando caixas.
 * - `SEM_PAR` — não há par possível ali, e `motivo` diz qual dos quatro casos é
 *   (`motivoSemPar`, do domínio). A cobertura sem vigência importada aparece
 *   dizendo por quê, em vez de sumir.
 */
export type SituacaoDaCobertura = {
  cobertura: CoberturaDoCatalogo;
  estado: "SEGUE" | "PROPRIO" | "SEM_PAR";
  par: ParEscolhido;
  motivo: MotivoSemPar | null;
};

export function situacaoDasCoberturas(
  mestre: ParMestre,
  pares: ParesDoCatalogo,
  listas: ListasDoCatalogo,
): SituacaoDaCobertura[] {
  return COBERTURAS.map((cobertura) => {
    const lista = listas[cobertura];
    const par = pares[cobertura];
    const motivo = motivoSemPar(lista);
    if (motivo) return { cobertura, estado: "SEM_PAR" as const, par, motivo };
    const datas = par.base && par.comparada ? datasDoPar(lista, par) : null;
    const segue =
      datas !== null && datas.de === mestre.de && datas.para === mestre.para;
    return {
      cobertura,
      estado: segue ? ("SEGUE" as const) : ("PROPRIO" as const),
      par,
      motivo: null,
    };
  });
}
