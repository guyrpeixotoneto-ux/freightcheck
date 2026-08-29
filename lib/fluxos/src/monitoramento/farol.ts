/**
 * O FAROL — a colheita aplicada ao fluxo desenhado, e a única regra que o motor
 * se permite ter sobre uma métrica: **dado velho não é dado**.
 *
 * ---------------------------------------------------------------------------
 * A validade, que é genérica de verdade
 * ---------------------------------------------------------------------------
 *
 * O motor não sabe se 4% é muito. Sabe, sem saber o que se mede, que uma
 * medição de anteontem não descreve o agora — e que uma etapa verde por causa
 * de um coletor que parou de rodar na terça é a pior tela possível: ela afirma
 * que está tudo bem exatamente quando ninguém está olhando.
 *
 * Por isso a leitura vencida vira `SEM_DADO`, e não some: `EstadoDaEtapa` guarda
 * a medição vencida e a idade dela. A etapa passa a dizer "sem dado — o último
 * era vermelho, há 3 dias", que é a informação que faz alguém ir consertar o
 * coletor.
 *
 * Quem escolhe a validade é o coletor, em cada leitura. `VALIDADE_PADRAO_EM_S`
 * só existe para o coletor que não declarou nada, e é curta de propósito: uma
 * hora. Errar para o lado de "não sei" custa um farol cinza; errar para o outro
 * lado custa a confiança na tela inteira.
 *
 * ---------------------------------------------------------------------------
 * O resumo não soma ausência com normalidade
 * ---------------------------------------------------------------------------
 *
 * `resumoDoFluxo` devolve o pior farol **medido** e, ao lado e sempre, quantas
 * etapas ninguém mede. Não existe aqui um número só que responda "o fluxo está
 * bem?", e a falta dele é o desenho: um fluxo de dezesseis etapas com uma verde
 * e quinze sem coletor não é um fluxo verde, e qualquer média o pintaria assim.
 * Quem for montar o painel de todos os fluxos monta a ordenação a partir destas
 * duas contas separadas.
 */

import type { FluxoCompleto } from "../modelo";
import { chaveDaEtapa } from "./chaves";
import type { Colheita } from "./colheita";
import type { Farol, FarolMedido, Leitura } from "./contrato";
import { GRAVIDADE } from "./contrato";

/** Uma hora — o teto de quem não declarou validade. */
export const VALIDADE_PADRAO_EM_S = 3_600;

export interface EstadoDaEtapa {
  etapaId: string;
  etapaNome: string;
  /** `null` quando a etapa não declara chave — ninguém pediu para medi-la. */
  chave: string | null;
  farol: Farol;
  /** A medição, mesmo quando vencida — é dela que sai "o último era vermelho". */
  leitura: Leitura | null;
  /** A medição existe e passou da validade: farol apagado, valor preservado. */
  vencida: boolean;
  /** Idade da medição em segundos, para a tela escrever "há 3 dias". */
  idadeEmSegundos: number | null;
  /**
   * Por que está `SEM_DADO`, quando está: `sem_chave`, `sem_coletor`,
   * `coletor_falhou`, `sem_resposta`, `vencida`. A tela mostra a frase certa em
   * vez de um cinza mudo, e as cinco causas pedem providências diferentes.
   */
  motivo: MotivoDaAusencia | null;
}

export type MotivoDaAusencia =
  "sem_chave" | "sem_coletor" | "coletor_falhou" | "sem_resposta" | "vencida";

export interface OpcoesDoFarol {
  validadePadraoEmSegundos?: number;
}

/** O estado de cada etapa do fluxo, na ordem em que as etapas já vêm. */
export function estadoDasEtapas(
  completo: FluxoCompleto,
  colheita: Colheita,
  opcoes: OpcoesDoFarol = {},
): EstadoDaEtapa[] {
  const validadePadrao =
    opcoes.validadePadraoEmSegundos ?? VALIDADE_PADRAO_EM_S;
  const orfas = new Set(colheita.orfas);
  const comFalha = new Set(colheita.falhas.flatMap((f) => f.chaves));

  return completo.etapas.map((etapa) => {
    const base = { etapaId: etapa.id, etapaNome: etapa.nome };
    const chave = chaveDaEtapa(etapa);
    if (chave === null) {
      return { ...base, chave: null, ...apagado("sem_chave") };
    }
    const leitura = colheita.leituras.get(chave) ?? null;
    if (leitura === null) {
      const motivo: MotivoDaAusencia = orfas.has(chave)
        ? "sem_coletor"
        : comFalha.has(chave)
          ? "coletor_falhou"
          : "sem_resposta";
      return { ...base, chave, ...apagado(motivo) };
    }
    const idade = idadeEmSegundos(leitura.medidoEm, colheita.agora);
    const validade = leitura.validadeEmSegundos ?? validadePadrao;
    const vencida = idade !== null && idade > validade;
    return {
      ...base,
      chave,
      farol: vencida ? "SEM_DADO" : leitura.farol,
      leitura,
      vencida,
      idadeEmSegundos: idade,
      motivo: vencida ? "vencida" : null,
    };
  });
}

export interface ResumoDoFluxo {
  /** Etapas do fluxo, medidas ou não. */
  etapas: number;
  /** Etapas com farol aceso agora. */
  medidas: number;
  /** Etapas sem farol, pelas cinco causas de `MotivoDaAusencia`. */
  semDado: number;
  /**
   * Etapas para as quais um coletor devolveu leitura — **inclusive a vencida**.
   *
   * Não é `medidas`, e a diferença entre as duas é a pergunta que o diagnóstico
   * de cobertura faz: `medidas` conta farol aceso agora, `respondidas` conta
   * quem respondeu alguma vez dentro desta colheita. Um coletor que voltou a
   * responder depois de dias parado aparece nas duas; um que responde com dado
   * velho aparece só aqui, e é exatamente esse o caso que se quer ver separado —
   * "o coletor está de pé e o dado é que envelheceu" pede conserto diferente de
   * "ninguém responde por esta chave".
   */
  respondidas: number;
  /** Das respondidas, quantas passaram da validade — o `SEM_DADO` por idade. */
  vencidas: number;
  porFarol: Record<Farol, number>;
  /** O pior entre os acesos — `null` quando não há nenhum aceso. */
  pior: FarolMedido | null;
}

export function resumoDoFluxo(
  estados: readonly EstadoDaEtapa[],
): ResumoDoFluxo {
  const porFarol: Record<Farol, number> = {
    VERDE: 0,
    AMARELO: 0,
    VERMELHO: 0,
    SEM_DADO: 0,
  };
  for (const estado of estados) porFarol[estado.farol] += 1;
  return {
    etapas: estados.length,
    medidas: estados.length - porFarol.SEM_DADO,
    semDado: porFarol.SEM_DADO,
    respondidas: estados.filter((e) => e.leitura !== null).length,
    vencidas: estados.filter((e) => e.vencida).length,
    porFarol,
    pior: piorFarol(estados.map((e) => e.farol)),
  };
}

/** O pior entre os acesos. `SEM_DADO` não entra na conta — nem como bom, nem como ruim. */
export function piorFarol(farois: readonly Farol[]): FarolMedido | null {
  let pior: FarolMedido | null = null;
  for (const farol of farois) {
    if (farol === "SEM_DADO") continue;
    if (pior === null || GRAVIDADE[farol] > GRAVIDADE[pior]) pior = farol;
  }
  return pior;
}

function apagado(motivo: MotivoDaAusencia) {
  return {
    farol: "SEM_DADO" as const,
    leitura: null,
    vencida: false,
    idadeEmSegundos: null,
    motivo,
  };
}

function idadeEmSegundos(medidoEm: string, agora: Date): number | null {
  const instante = Date.parse(medidoEm);
  if (Number.isNaN(instante)) return null;
  return Math.max(0, Math.round((agora.getTime() - instante) / 1000));
}
