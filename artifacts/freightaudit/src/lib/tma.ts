import {
  DEFINICAO_DA_PORTA,
  ROTULO_DA_FOLGA,
  ROTULO_DA_PORTA,
  ROTULO_DO_VEREDITO_DO_LOCAL,
  celulasDoCsvDeTma,
  celulasDoCsvDeTrecho,
  COLUNAS_DO_CSV_DE_TMA,
  COLUNAS_DO_CSV_DE_TRECHO,
  type EvolucaoDoLocal,
  type EvolucaoDoTrecho,
  type LocalDeTma,
  type PortaDoTma,
  type ResumoDaVigencia,
  type TrechoDeTma,
  type VereditoDaFolga,
  type VereditoDoLocal,
} from "@workspace/comparison/tma";
import { numeroParaCsv } from "@/lib/csv";
import { formatNumber } from "@/lib/format";

/**
 * A metade de tela da Auditoria de TMA — apresentação, e só.
 *
 * A conta inteira mora em `@workspace/comparison/tma`, que o servidor também
 * importa: a inversão da tabela por local, o tempo de porta por trecho, as
 * folgas e os vereditos saem de lá.
 *
 * O que este arquivo acrescenta é **escrever minuto como gente lê minuto**, a
 * mesma decisão da Auditoria de Velocidade Média e pela mesma razão: 210 e 270
 * são dois números que ninguém compara de cabeça, e "3h 30min" contra "4h 30min"
 * se compara sozinho. A conversão é só de escrita — o núcleo conta em minutos, e
 * o CSV exporta minutos.
 */

/** O que a API de `/tma/comparacao` devolve. */
export interface ComparacaoDeTma {
  base: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  comparada: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  resumo: ResumoDaVigencia[];
  locais: LocalDeTma[];
  trechos: TrechoDeTma[];
  evolucaoDosLocais: EvolucaoDoLocal[];
  evolucaoDosTrechos: EvolucaoDoTrecho[];
}

export {
  DEFINICAO_DA_PORTA,
  ROTULO_DA_FOLGA,
  ROTULO_DA_PORTA,
  ROTULO_DO_VEREDITO_DO_LOCAL,
  type EvolucaoDoLocal,
  type EvolucaoDoTrecho,
  type LocalDeTma,
  type PortaDoTma,
  type TrechoDeTma,
};

/**
 * Minutos escritos como horas e minutos.
 *
 * Abaixo de uma hora fica só em minutos: "0h 45min" é mais difícil de ler que
 * "45 min", e nesta tela a maior parte das portas está nessa faixa.
 */
export function escreverMinutos(valor: number | null): string {
  if (valor === null) return "—";
  const sinal = valor < 0 ? "−" : "";
  const absoluto = Math.abs(valor);
  if (absoluto < 60) return `${sinal}${formatNumber(absoluto, 0)} min`;
  const horas = Math.floor(absoluto / 60);
  const minutos = Math.round(absoluto - horas * 60);
  /* 59,7 min arredonda para 60 e viraria "3h 60min". */
  if (minutos === 60) return `${sinal}${horas + 1}h 00min`;
  return `${sinal}${horas}h ${String(minutos).padStart(2, "0")}min`;
}

/**
 * Uma diferença de tempo, com sinal explícito.
 *
 * O sinal é a informação: uma porta que ganhou trinta minutos e outra que perdeu
 * trinta são duas conversas diferentes, e "30 min" sozinho não as distingue.
 */
export function escreverDiferencaDeTempo(valor: number | null): string {
  if (valor === null) return "—";
  const sinal = valor > 0 ? "+" : valor < 0 ? "−" : "";
  return `${sinal}${escreverMinutos(Math.abs(valor))}`;
}

/**
 * Uma fração escrita como percentual. `0.285` vira "28,5%".
 *
 * `formatNumber` corta o zero à direita, então `0.28` sai como "28%" — o que
 * nesta tela é o desejado: a casa decimal só aparece quando ela diz alguma
 * coisa.
 */
export function escreverFracao(valor: number | null): string {
  if (valor === null) return "—";
  return `${formatNumber(valor * 100, 1)}%`;
}

/** O selo de cada veredito de local. Cor **e** texto — nunca só a cor. */
export const SELO_DO_LOCAL: Record<VereditoDoLocal, string> = {
  TMA_UNICO: "bg-success/10 text-success border border-success/25",
  VARIA_POR_TRECHO: "bg-warning/15 text-warning-foreground border border-warning/40",
  UM_TRECHO_SO: "bg-muted text-muted-foreground border border-border",
  BASE_INSUFICIENTE: "bg-muted text-muted-foreground border border-dashed border-border",
};

/**
 * O selo da folga de um trecho — e por que nenhum deles é vermelho.
 *
 * Pagar mais tempo de porta do que se pratica pode ser folga negociada; pagar
 * menos pode ser operação absorvendo espera que ninguém reconhece. Nenhum dos
 * dois é um erro, e pintar um de vermelho afirmaria um juízo que esta tela não
 * tem como sustentar — ela mostra os dois lados e o tamanho.
 */
export const SELO_DA_FOLGA: Record<VereditoDaFolga, string> = {
  PAGA_MAIS: "bg-brand/10 text-brand border border-brand/25",
  PAGA_MENOS: "bg-warning/15 text-warning-foreground border border-warning/40",
  IGUAL: "bg-muted text-muted-foreground border border-border",
  SEM_COMPARACAO: "bg-muted text-muted-foreground border border-dashed border-border",
};

/** Os dois grãos que a tela oferece. */
export type GraoDaTela = "LOCAL" | "TRECHO";

export const ROTULO_DO_GRAO: Record<GraoDaTela, string> = {
  LOCAL: "Por local",
  TRECHO: "Por trecho",
};

export interface FiltrosDeTma {
  busca: string;
  porta: "TODAS" | PortaDoTma;
  veredito: "TODOS" | VereditoDoLocal;
  /** Só a ponta comparada, ou as duas lado a lado. */
  ponta: "COMPARADA" | "TODAS";
}

export const FILTROS_VAZIOS: FiltrosDeTma = {
  busca: "",
  porta: "TODAS",
  veredito: "TODOS",
  ponta: "COMPARADA",
};

/**
 * O recorte da tabela de locais.
 *
 * **O padrão é a ponta comparada**, e não as duas. A tabela com as duas pontas
 * mostra cada local duas vezes, o que é útil para ver a evolução linha a linha e
 * péssimo para ler o retrato de hoje — e o retrato de hoje é o que a maioria
 * abre esta tela para ver. As duas pontas continuam a um clique, e a evolução
 * tem painel próprio.
 */
export function filtrarLocais(
  locais: readonly LocalDeTma[],
  filtros: FiltrosDeTma,
): LocalDeTma[] {
  const busca = filtros.busca.trim().toLowerCase();
  return locais.filter((l) => {
    if (filtros.ponta === "COMPARADA" && l.ponta !== "COMPARADA") return false;
    if (filtros.porta !== "TODAS" && l.porta !== filtros.porta) return false;
    if (filtros.veredito !== "TODOS" && l.veredito !== filtros.veredito) return false;
    if (busca && !l.local.toLowerCase().includes(busca)) return false;
    return true;
  });
}

/** O recorte da tabela de trechos — o outro grão, o mesmo filtro de ponta. */
export function filtrarTrechos(
  trechos: readonly TrechoDeTma[],
  filtros: FiltrosDeTma,
): TrechoDeTma[] {
  const busca = filtros.busca.trim().toLowerCase();
  return trechos.filter((t) => {
    if (filtros.ponta === "COMPARADA" && t.ponta !== "COMPARADA") return false;
    if (busca) {
      const alvo = `${t.entityLabel ?? ""} ${t.origem ?? ""} ${t.destino ?? ""}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

/** Quantos locais caem em cada veredito, sobre o mesmo recorte da tabela. */
export function contagemPorVeredito(
  locais: readonly LocalDeTma[],
  filtros: FiltrosDeTma,
): Record<string, number> {
  const contagem: Record<string, number> = {
    TODOS: filtrarLocais(locais, { ...filtros, veredito: "TODOS" }).length,
  };
  for (const veredito of [
    "VARIA_POR_TRECHO",
    "TMA_UNICO",
    "UM_TRECHO_SO",
  ] as const) {
    contagem[veredito] = filtrarLocais(locais, { ...filtros, veredito }).length;
  }
  return contagem;
}

/**
 * A tabela virando as linhas do CSV — uma função por grão.
 *
 * Dois arquivos, e não um com tudo: o grão do local tem doze colunas sobre
 * portas, e o do trecho tem doze sobre ciclos. Um arquivo só teria vinte e
 * quatro colunas, metade vazia em cada linha — e a planilha que alguém monta em
 * cima dele começaria pelo trabalho de separar de novo o que a tela já separou.
 */
export function linhasDoCsvDeLocais(locais: readonly LocalDeTma[]): string[][] {
  return [
    [...COLUNAS_DO_CSV_DE_TMA],
    ...locais.map((l) =>
      celulasDoCsvDeTma(l).map((celula) => {
        if (celula === null || celula === undefined) return "";
        if (typeof celula === "number") return numeroParaCsv(celula);
        return celula;
      }),
    ),
  ];
}

export function linhasDoCsvDeTrechos(trechos: readonly TrechoDeTma[]): string[][] {
  return [
    [...COLUNAS_DO_CSV_DE_TRECHO],
    ...trechos.map((t) =>
      celulasDoCsvDeTrecho(t).map((celula) => {
        if (celula === null || celula === undefined) return "";
        if (typeof celula === "number") return numeroParaCsv(celula);
        return celula;
      }),
    ),
  ];
}
