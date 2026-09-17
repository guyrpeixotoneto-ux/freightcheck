import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchJson, getApiUrl } from "@/lib/api";
import type {
  EstadoDaComparacaoReal,
  LinhaDaComparacaoReal,
  ResumoDaCompetencia,
} from "@workspace/comparison/finame-real";
import { ROTULO_DO_ESTADO_REAL } from "@workspace/comparison/finame-real";

/**
 * Financiamento Real — as consultas da tela, fora do JSX.
 *
 * A tela responde a uma pergunta que nenhuma outra deste produto respondia:
 * **o que a Ambev paga de FINAME bate com o que o banco cobrou?** O que ela
 * mostra de cada lado vem do servidor já comparado — e comparado pelas mesmas
 * funções puras que o servidor usa (`@workspace/comparison/finame-real`), que é
 * o que faz o cartão do topo e a linha da tabela nunca discordarem.
 *
 * O que este arquivo acrescenta é só o transporte e os rótulos. Nenhuma conta
 * nova: uma segunda régua aqui seria a forma mais discreta de a tela passar a
 * dizer um número diferente do da API sobre o mesmo mês.
 */

export { ROTULO_DO_ESTADO_REAL };
export type { EstadoDaComparacaoReal, LinhaDaComparacaoReal, ResumoDaCompetencia };

export interface CompetenciaDisponivel {
  competencia: string;
  rotulo: string;
  sourceLabel: string;
  canal: string;
  unidades: string[];
  lancamentos: number;
  placas: number;
  parcial: boolean;
  motivoParcial: string | null;
}

export interface ComparacaoDoReal {
  competencia: string | null;
  rotulo?: string;
  canal?: string;
  sourceLabel?: string;
  unidades?: string[];
  granularidade: {
    remunerado: string;
    realizado: string;
    quinzenaIsolada?: string;
  };
  parcial?: boolean;
  motivoParcial?: string | null;
  quinzenasLidas?: string[];
  resumo: ResumoDaCompetencia | null;
  linhas: LinhaDaComparacaoReal[];
  competencias: { competencia: string; rotulo: string }[];
  motivo?: string;
}

export interface PendenciasDoReal {
  duplicatas: {
    competencia: string;
    placa: string;
    numdoc: string;
    valor: number;
    motivo: string | null;
    linhaRepetida: number;
    /**
     * O endereço da pendência — é ela que a decisão carrega como chave.
     *
     * `null` quando o lançamento foi lido antes de a coluna existir: a pendência
     * é real e continua à vista, mas só volta a ser decidível depois que aquele
     * mês for reimportado.
     */
    impressaoHash: string | null;
  }[];
  semClassificacao: {
    placa: string;
    competencias: string[];
    lancamentos: number;
    valor: number;
    contas: string[];
  }[];
  valorRetido: number;
  valorSemClassificacao: number;
}

export interface LancamentoDaPlaca {
  numdoc: string;
  valor: number;
  valorOriginal: number;
  conta: string | null;
  filial: string | null;
  escrituracao: string | null;
  status: string;
  motivo: string | null;
  linha: number;
  aba: string;
  arquivo: string | null;
}

export function useCompetenciasDoReal() {
  return useQuery<{ competencias: CompetenciaDisponivel[] }>({
    queryKey: ["financiamento-real", "competencias"],
    queryFn: () => fetchJson("/financiamento-real/competencias"),
  });
}

export function useComparacaoDoReal(competencia: string | null) {
  return useQuery<ComparacaoDoReal>({
    queryKey: ["financiamento-real", "comparacao", competencia],
    queryFn: () =>
      fetchJson(
        competencia
          ? `/financiamento-real/comparacao?competencia=${encodeURIComponent(competencia)}`
          : "/financiamento-real/comparacao",
      ),
  });
}

export function usePendenciasDoReal() {
  return useQuery<PendenciasDoReal>({
    queryKey: ["financiamento-real", "pendencias"],
    queryFn: () => fetchJson("/financiamento-real/pendencias"),
  });
}

/**
 * Os lançamentos por trás de um valor — pedidos só quando alguém abre a linha.
 *
 * `enabled` em vez de uma busca antecipada: são 104 placas por competência, e
 * carregar o rastreio de todas para mostrar o de uma seria pedir ao banco cem
 * vezes o que ninguém vai ler.
 */
export function useLancamentosDaPlaca(competencia: string | null, placa: string | null) {
  return useQuery<{ lancamentos: LancamentoDaPlaca[]; total: number }>({
    queryKey: ["financiamento-real", "lancamentos", competencia, placa],
    enabled: competencia !== null && placa !== null,
    queryFn: () =>
      fetchJson(
        `/financiamento-real/lancamentos?competencia=${encodeURIComponent(
          competencia as string,
        )}&placa=${encodeURIComponent(placa as string)}`,
      ),
  });
}

/**
 * Registrar uma decisão sobre o que ficou de fora da soma.
 *
 * A decisão é **gravada**, e não aplicada: o consolidado só muda quando aquele
 * mês for reimportado, porque a apuração é função pura das linhas do arquivo
 * mais as decisões conhecidas. Aplicar por aqui seria mexer numa vigência
 * fechada sem passar pela pré-visualização — e a resposta do servidor diz isso
 * com todas as letras, para que a tela possa dizer também.
 */
export function useRegistrarDecisao() {
  const cliente = useQueryClient();
  return useMutation<
    { efeito: string },
    Error,
    { tipo: string; chave: string; motivo: string; valor?: string }
  >({
    mutationFn: async (decisao) => {
      const resposta = await fetch(getApiUrl("/financiamento-real/decisoes"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(decisao),
      });
      const corpo = await resposta.json();
      if (!resposta.ok) throw new Error(corpo.error ?? "Não foi possível registrar.");
      return corpo;
    },
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ["financiamento-real", "pendencias"] });
    },
  });
}

/** O tom de cada estado — o mesmo no chip da linha e na legenda. */
export const TOM_DO_ESTADO_REAL: Record<EstadoDaComparacaoReal, string> = {
  COMPARAVEL: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  REALIZADO_AUSENTE: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  REMUNERADO_AUSENTE: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  REMUNERADO_DIVERGE_ENTRE_QUINZENAS:
    "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  COMPETENCIA_PARCIAL: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
};

/**
 * O desvio em reais, escrito com o sinal explícito.
 *
 * Positivo é o banco cobrando **mais** do que a Ambev paga, e é a leitura que
 * interessa: o sinal sem o `+` faz a pessoa ter de lembrar qual lado é qual.
 */
export function escreverDesvio(valor: number | null): string {
  if (valor === null) return "—";
  const formatado = valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  return valor > 0 ? `+${formatado}` : formatado;
}

export function escreverReais(valor: number | null): string {
  if (valor === null) return "—";
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
