import type { UseQueryOptions } from "@tanstack/react-query";
import type { TipoDaLinhaDoTempo } from "@workspace/comparison/tipos";
import { fetchJsonOrNull } from "@/lib/api";

/**
 * A Evolução por Placa, do lado da tela — as regras que a matriz obedece.
 *
 * Nada aqui lê a rede nem o React: a entrada é exatamente o JSON que
 * `/changes/evolucao-por-placa` devolve, o que deixa cada conta conferível ao
 * lado do contrato que a alimenta — a mesma separação de
 * `gestao-a-vista-radar.ts` e de `historico-da-placa.ts`.
 *
 * **O que este arquivo deliberadamente não faz é somar dinheiro.** Todo número
 * financeiro chega pronto do servidor, onde a autoridade de impacto mora. Aqui
 * há ordenação, filtro, busca, paginação e a escolha da cor — decisões de
 * apresentação, e nenhuma delas capaz de mudar um total.
 */

// ---------------------------------------------------------------------------
// O contrato
// ---------------------------------------------------------------------------

export type EstadoDaCelulaDaPlaca = "VALORADA" | "SEM_VALORACAO";
export type Tendencia = "PIORANDO" | "MELHORANDO" | "ESTAVEL" | "SEM_VALORACAO";
export type Prioridade = "CRITICA" | "MONITORAR" | "ATENCAO" | "POSITIVO" | "NEUTRA";

export interface RubricaDaCelula {
  parameterKey: string;
  nome: string;
  alteracoes: number;
  semValoracao: number;
  impacto: number | null;
}

export interface CelulaDaPlaca {
  period: string;
  label: string;
  estado: EstadoDaCelulaDaPlaca;
  alteracoes: number;
  valoradas: number;
  semValoracao: number;
  foraDoTotal: number;
  outraPeriodicidade: number;
  ganho: number;
  perda: number;
  net: number | null;
  /** As rubricas daquela vigência naquela placa — o último degrau do detalhe. */
  rubricas: RubricaDaCelula[];
}

export interface MotivoDaPrioridade {
  chave: "IMPACTO" | "RECORRENCIA" | "PIORA_CONSECUTIVA" | "PENDENCIA" | "RECENCIA";
  rotulo: string;
  pontos: number;
  detalhe: string;
}

export interface RubricaAlterada {
  parameterKey: string;
  nome: string;
  family: string;
  familyName: string;
  alteracoes: number;
  semValoracao: number;
  ativos: number;
  vigencias: number;
  impacto: number | null;
}

export interface AtivoNaEvolucao {
  entityId: string;
  plate: string | null;
  rotulo: string;
  entityType: string | null;
  placasAnteriores: string[];
  celulas: CelulaDaPlaca[];
  acumulado: number | null;
  ganho: number;
  perda: number;
  alteracoes: number;
  semValoracao: number;
  foraDoTotal: number;
  outraPeriodicidade: number;
  vigenciasAfetadas: number;
  vigenciasNegativas: number;
  vigenciasPositivas: number;
  pioraConsecutiva: number;
  rubricasRecorrentes: number;
  ultimaVigencia: string | null;
  tendencia: Tendencia;
  score: number;
  prioridade: Prioridade;
  motivos: MotivoDaPrioridade[];
  rubricas: RubricaAlterada[];
}

export interface InsightDaEvolucao {
  chave:
    | "PIORA_CONSECUTIVA"
    | "CONCENTRACAO_DA_PERDA"
    | "SEM_VALORACAO"
    | "RUBRICA_REPETIDA";
  tom: "PERDA" | "PENDENCIA" | "NEUTRO";
  placas: number;
  texto: string;
  entityIds: string[];
}

export interface EvolucaoPorPlaca {
  context: {
    scopeHash: string;
    channel: string | null;
    label: string;
    latestPeriod: string;
    periodosDisponiveis: string[];
  };
  from: string;
  fromLabel: string;
  to: string;
  toLabel: string;
  periods: { date: string; label: string }[];
  colunas: { period: string; label: string; comparisons: number; alteracoes: number }[];
  gaps: { period: string; label: string; reason: string }[];
  periodicidade: string;
  periodicidades: { periodicity: string; peso: number }[];
  ativos: AtivoNaEvolucao[];
  totais: {
    ativos: number;
    frota: number;
    comPerda: number;
    comGanho: number;
    comPendencia: number;
    alteracoesSemValoracao: number;
    alteracoesEmOutraPeriodicidade: number;
    alteracoes: number;
    perda: number;
    ganho: number;
    liquido: number;
  };
  insights: InsightDaEvolucao[];
  rubricas: RubricaAlterada[];
}

// ---------------------------------------------------------------------------
// A leitura
// ---------------------------------------------------------------------------

/**
 * A pergunta, num lugar só — a mesma decisão de `opcoesDoIntervalo`.
 *
 * A página, o painel lateral e o prefetch fazem exatamente esta pergunta; com a
 * chave montada em cada um deles, "a mesma pergunta" dependeria de os três
 * repetirem a mesma ordem de parâmetros, e uma letra fora do lugar viraria uma
 * segunda requisição cara que ninguém nota, porque as duas respondem certo.
 */
export function consultaDaEvolucao(
  consulta: URLSearchParams,
  de: string | null,
  ate: string | null,
  tipo?: TipoDaLinhaDoTempo | null,
  periodicidade?: string | null,
): URLSearchParams {
  const query = new URLSearchParams(consulta);
  query.delete("period");
  if (de) query.set("from", de);
  if (ate) query.set("to", ate);
  if (tipo) query.set("tipo", tipo);
  if (periodicidade) query.set("periodicidade", periodicidade);
  return query;
}

export function opcoesDaEvolucao(
  consulta: URLSearchParams,
  de: string | null,
  ate: string | null,
  tipo?: TipoDaLinhaDoTempo | null,
  periodicidade?: string | null,
): Pick<UseQueryOptions<EvolucaoPorPlaca | null>, "queryKey" | "queryFn" | "staleTime"> {
  const query = consultaDaEvolucao(consulta, de, ate, tipo, periodicidade);
  return {
    queryKey: ["evolucao-por-placa", query.toString()],
    queryFn: () => fetchJsonOrNull<EvolucaoPorPlaca>(`/changes/evolucao-por-placa?${query}`),
    staleTime: 60_000,
  };
}

// ---------------------------------------------------------------------------
// Os filtros rápidos
// ---------------------------------------------------------------------------

/**
 * As cinco pastilhas acima da matriz, com a definição de cada uma ao lado.
 *
 * A definição viaja junto com a pastilha de propósito: um filtro chamado
 * "Recorrentes" que não diz o que conta como recorrência é um número que o
 * usuário não pode conferir — e é assim que uma tela perde a confiança de quem
 * a usa para cobrar dinheiro de terceiros. A tela escreve `descricao` no título
 * do botão; a régua está em `aplicaFiltro`, logo abaixo, e nos testes.
 */
export const FILTROS_DA_EVOLUCAO = [
  { chave: "todos", rotulo: "Todos", descricao: "todas as placas com alteração no período" },
  {
    chave: "piorando",
    rotulo: "Piorando",
    descricao:
      "acumulado negativo, com as vigências negativas em maioria (ou empatadas)",
  },
  {
    chave: "melhorando",
    rotulo: "Melhorando",
    descricao: "acumulado positivo, com as vigências positivas em maioria (ou empatadas)",
  },
  {
    chave: "sem-valoracao",
    rotulo: "Sem valoração",
    descricao: "tem ao menos uma alteração sem impacto financeiro apurado",
  },
  {
    chave: "recorrentes",
    rotulo: "Recorrentes",
    descricao: "com alteração em 3 ou mais vigências do período",
  },
] as const;

export type FiltroDaEvolucao = (typeof FILTROS_DA_EVOLUCAO)[number]["chave"];

/**
 * Em quantas vigências uma placa precisa se mexer para ser "recorrente".
 *
 * Espelho de `VIGENCIAS_PARA_RECORRENCIA`, no domínio. A tela repete o número
 * em vez de importá-lo do pacote de comparação porque a definição também é
 * texto na pastilha; há teste prendendo os dois lados ao mesmo valor.
 */
export const VIGENCIAS_PARA_RECORRENCIA = 3;

export const ehFiltroDaEvolucao = (valor: string | null): valor is FiltroDaEvolucao =>
  valor !== null && FILTROS_DA_EVOLUCAO.some((f) => f.chave === valor);

export function aplicaFiltro(ativo: AtivoNaEvolucao, filtro: FiltroDaEvolucao): boolean {
  switch (filtro) {
    case "piorando":
      return ativo.tendencia === "PIORANDO";
    case "melhorando":
      return ativo.tendencia === "MELHORANDO";
    case "sem-valoracao":
      return ativo.semValoracao > 0;
    case "recorrentes":
      return ativo.vigenciasAfetadas >= VIGENCIAS_PARA_RECORRENCIA;
    case "todos":
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// A ordenação
// ---------------------------------------------------------------------------

export const ORDENS_DA_EVOLUCAO = [
  { chave: "prioridade", rotulo: "Prioridade de análise" },
  { chave: "maior-perda", rotulo: "Maior perda" },
  { chave: "maior-ganho", rotulo: "Maior ganho" },
  { chave: "alteracoes", rotulo: "Mais alterações" },
  { chave: "vigencias", rotulo: "Mais vigências afetadas" },
  { chave: "pendencias", rotulo: "Mais pendências" },
  { chave: "recorrencia", rotulo: "Maior recorrência de rubrica" },
  { chave: "placa", rotulo: "Placa (A→Z)" },
] as const;

export type OrdemDaEvolucao = (typeof ORDENS_DA_EVOLUCAO)[number]["chave"];

export const ehOrdemDaEvolucao = (valor: string | null): valor is OrdemDaEvolucao =>
  valor !== null && ORDENS_DA_EVOLUCAO.some((o) => o.chave === valor);

/**
 * A ordem pedida, com desempate por placa — sempre.
 *
 * O desempate final não é decoração: sem ele, duas placas com o mesmo score
 * trocam de lugar entre duas leituras da mesma tela, e quem estava lendo a
 * terceira linha perde o lugar sem ter mexido em nada.
 */
export function ordenarAtivos(
  ativos: AtivoNaEvolucao[],
  ordem: OrdemDaEvolucao,
): AtivoNaEvolucao[] {
  const porPlaca = (a: AtivoNaEvolucao, b: AtivoNaEvolucao) =>
    a.rotulo.localeCompare(b.rotulo, "pt-BR", { numeric: true });

  const criterio: Record<
    OrdemDaEvolucao,
    (a: AtivoNaEvolucao, b: AtivoNaEvolucao) => number
  > = {
    prioridade: (a, b) => b.score - a.score,
    // Sem acumulado não é zero: quem não tem preço apurado fica no fim das duas
    // filas de dinheiro, e não no meio delas fingindo um saldo neutro.
    "maior-perda": (a, b) => (a.acumulado ?? Infinity) - (b.acumulado ?? Infinity),
    "maior-ganho": (a, b) => (b.acumulado ?? -Infinity) - (a.acumulado ?? -Infinity),
    alteracoes: (a, b) => b.alteracoes - a.alteracoes,
    vigencias: (a, b) => b.vigenciasAfetadas - a.vigenciasAfetadas,
    pendencias: (a, b) => b.semValoracao - a.semValoracao,
    recorrencia: (a, b) => b.rubricasRecorrentes - a.rubricasRecorrentes,
    placa: porPlaca,
  };

  return [...ativos].sort((a, b) => criterio[ordem](a, b) || porPlaca(a, b));
}

// ---------------------------------------------------------------------------
// A busca e o recorte de um insight
// ---------------------------------------------------------------------------

/**
 * As placas à vista: o filtro rápido, a busca e — quando houver — o insight
 * clicado, nesta ordem.
 *
 * O insight entra como **conjunto de ativos**, e não como mais uma regra: o
 * número que a frase anuncia e a lista que aparece embaixo dela são o mesmo
 * conjunto por construção, e não duas contas que precisam concordar.
 */
export function recorteDaMatriz(
  ativos: AtivoNaEvolucao[],
  opcoes: {
    filtro: FiltroDaEvolucao;
    busca: string;
    ordem: OrdemDaEvolucao;
    insight?: string[] | null;
  },
): AtivoNaEvolucao[] {
  const busca = opcoes.busca.trim().toUpperCase();
  const doInsight = opcoes.insight ? new Set(opcoes.insight) : null;

  return ordenarAtivos(
    ativos.filter((ativo) => {
      if (doInsight && !doInsight.has(ativo.entityId)) return false;
      if (!aplicaFiltro(ativo, opcoes.filtro)) return false;
      if (busca === "") return true;
      return (
        ativo.rotulo.toUpperCase().includes(busca) ||
        ativo.placasAnteriores.some((p) => p.toUpperCase().includes(busca))
      );
    }),
    opcoes.ordem,
  );
}

// ---------------------------------------------------------------------------
// A cor da célula
// ---------------------------------------------------------------------------

export type CorDaCelula = "ganho" | "perda" | "sem-alteracao" | "sem-valoracao";

/** O que a célula é, para a tela pintar — e nunca um R$ 0 no lugar do vazio. */
export function corDaCelula(celula: CelulaDaPlaca | undefined): CorDaCelula {
  if (celula === undefined) return "sem-alteracao";
  if (celula.net === null) return "sem-valoracao";
  if (celula.net > 0) return "ganho";
  if (celula.net < 0) return "perda";
  return "sem-alteracao";
}

/**
 * A intensidade da cor — **três degraus, e não um gradiente contínuo**.
 *
 * Um heatmap com cinquenta tons é bonito e ilegível: a distância entre R$ 900 e
 * R$ 1.100 vira uma diferença de cor que ninguém consegue ler, e a tela passa a
 * sugerir precisão que a vista não tem. Três degraus sobre o maior valor do
 * recorte respondem à única pergunta que a cor precisa responder: isto é
 * grande, médio ou pequeno perto do resto?
 */
export function intensidadeDaCelula(valor: number | null, maiorAbsoluto: number): 1 | 2 | 3 {
  if (valor === null || maiorAbsoluto <= 0) return 1;
  const razao = Math.abs(valor) / maiorAbsoluto;
  if (razao >= 0.5) return 3;
  if (razao >= 0.15) return 2;
  return 1;
}

/** O maior líquido em módulo das células à vista — a régua da intensidade. */
export function maiorCelulaAbsoluta(ativos: AtivoNaEvolucao[]): number {
  let maior = 0;
  for (const ativo of ativos) {
    for (const celula of ativo.celulas) {
      if (celula.net !== null) maior = Math.max(maior, Math.abs(celula.net));
    }
  }
  return maior;
}

// ---------------------------------------------------------------------------
// A série do painel
// ---------------------------------------------------------------------------

export interface PontoDaPlaca {
  period: string;
  label: string;
  /** O impacto **daquela vigência**. Null quando não houve nada apurado. */
  vigencia: number | null;
  /** O impacto **acumulado** até ali, dentro do período. */
  acumulado: number;
  alteracoes: number;
  semValoracao: number;
}

/**
 * A série do gráfico da placa — a distinção que o gráfico existe para manter.
 *
 * `vigencia` é o movimento daquela quinzena; `acumulado` é a soma dos
 * movimentos até ali. As duas medidas contam histórias diferentes e são
 * frequentemente confundidas: uma placa que perdeu R$ 10.146 em julho e nada
 * depois tem `vigencia = 0` em agosto e `acumulado = −10.146` — a linha que
 * anda de lado é a segunda, e é ela que responde "quanto esta placa está
 * perdendo hoje".
 *
 * Uma vigência sem alteração entra na série com `vigencia: null` e o acumulado
 * anterior repetido: o gráfico não pode dar a entender que houve um movimento
 * de R$ 0 onde não houve movimento nenhum.
 */
export function serieDaPlaca(
  ativo: AtivoNaEvolucao,
  colunas: { period: string; label: string }[],
): PontoDaPlaca[] {
  const porPeriodo = new Map(ativo.celulas.map((c) => [c.period, c]));
  let acumulado = 0;
  return colunas.map((coluna) => {
    const celula = porPeriodo.get(coluna.period);
    if (celula?.net != null) acumulado += celula.net;
    return {
      period: coluna.period,
      label: coluna.label,
      vigencia: celula?.net ?? null,
      acumulado: Number(acumulado.toFixed(2)),
      alteracoes: celula?.alteracoes ?? 0,
      semValoracao: celula?.semValoracao ?? 0,
    };
  });
}

/** O rótulo da faixa de prioridade, como a tela o escreve. */
export const ROTULO_DA_PRIORIDADE: Record<Prioridade, string> = {
  CRITICA: "Crítica",
  MONITORAR: "Monitorar",
  ATENCAO: "Atenção",
  POSITIVO: "Positivo",
  NEUTRA: "Neutra",
};

export const ROTULO_DA_TENDENCIA: Record<Tendencia, string> = {
  PIORANDO: "Piorando",
  MELHORANDO: "Melhorando",
  ESTAVEL: "Estável",
  SEM_VALORACAO: "Sem valoração",
};
