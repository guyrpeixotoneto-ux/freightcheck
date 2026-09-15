import {
  ROTULO_DO_ESTADO,
  ROTULO_DO_VEREDITO_DO_KM,
  celulasDoCsvDeKm,
  COLUNAS_DO_CSV_DE_KM,
  type ConferenciaDaVigencia,
  type EstadoDaLinhaDeKm,
  type LinhaDeKm,
  type MedidaDaVariavel,
  type PapelDaColunaDeKm,
  type ParcelaDoPrecoPorKm,
  type PrecoPorKmDaVigencia,
} from "@workspace/comparison/km-rodado";
import { numeroParaCsv } from "@/lib/csv";
import { formatBrl, formatNumber } from "@/lib/format";

/**
 * A metade de tela da Auditoria de Km Rodado — apresentação, e só.
 *
 * A conta inteira mora em `@workspace/comparison/km-rodado`, que o servidor
 * também importa: estado, diferença, variação, impacto, preço por km e as duas
 * conferências saem de lá, e a tela nunca refaz nenhuma delas. O que este
 * arquivo acrescenta é o que é genuinamente de apresentação — como se **escreve**
 * um número cuja unidade muda de linha para linha, que cor cada estado recebe e
 * como a tabela vira arquivo.
 *
 * Aqui a escrita carrega mais peso do que nas quatro telas de custo fixo, e é
 * por causa do grão: numa mesma coluna convivem `1,8400` (R$/km), `412` (km),
 * `758,08` (R$ por viagem) e `44` (viagens). Formatar tudo igual escreveria
 * "R$ 412,00" onde a fonte disse 412 quilômetros — e quem lê acredita.
 */

/** O que a API de `/km-rodado/comparacao` devolve. */
export interface ComparacaoDeKm {
  changeSetId: string;
  base: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  comparada: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  resumo: {
    trechosComparados: number;
    semAlteracao: number;
    trechosComAlteracao: number;
    novosNaVigencia: number;
    ausentesNaComparada: number;
    variaveisAlteradas: number;
    trechosComDadoIncompleto: number;
    trechosComConflito: number;
    impacto: {
      porPeriodicidade: Record<string, number>;
      naoCalculavel: number;
      foraDaSoma: number;
      razoesAlteradas: number;
      distanciasAlteradas: number;
    };
  };
  alteracoesPorVariavel: {
    variavel: string;
    rotulo: string;
    medida: MedidaDaVariavel;
    papel: PapelDaColunaDeKm;
    alteracoes: number;
  }[];
  distribuicaoPorEstado: {
    estado: EstadoDaLinhaDeKm;
    rotulo: string;
    trechos: number;
    fracao: number;
  }[];
  linhas: LinhaDeKm[];
}

/** O que a API de `/km-rodado/totais` devolve: as três séries da mesma leitura. */
export interface TotaisDeKm {
  preco: PrecoPorKmDaVigencia[];
  composicao: ParcelaDoPrecoPorKm[];
  conferencias: ConferenciaDaVigencia[];
}

/**
 * Um valor escrito na unidade da própria variável.
 *
 * `REAIS_POR_KM` sai com quatro casas, e não com duas: o R$/km do diesel é da
 * ordem de R$ 1,84 e o da lavagem, de R$ 0,03 — cortar em duas casas achataria
 * as parcelas pequenas em "R$ 0,03" e faria três componentes diferentes
 * parecerem o mesmo número. É também a casa em que a conferência do km se
 * decide.
 */
export function escreverValor(valor: string | null, medida: MedidaDaVariavel): string {
  if (valor === null || valor === "") return "—";
  if (medida === "TEXTO") return valor;
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return valor;
  switch (medida) {
    case "DINHEIRO":
      return formatBrl(numero);
    case "REAIS_POR_KM":
      return `${formatNumber(numero, 4)} R$/km`;
    case "DISTANCIA":
      return `${formatNumber(numero, 1)} km`;
    case "VIAGENS":
      return `${formatNumber(numero, 0)} ${numero === 1 ? "viagem" : "viagens"}`;
    case "PERCENTUAL":
      return `${formatNumber(numero, 2)}%`;
    case "ANO":
      return formatNumber(numero, 0);
    case "DATA":
      return valor;
    default:
      return valor;
  }
}

/**
 * A diferença, com sinal explícito e na unidade certa.
 *
 * O sinal vem escrito mesmo quando é positivo: numa coluna em que metade das
 * linhas sobe e metade desce, "0,07" e "−0,07" a três linhas de distância se
 * confundem, e "+0,07" não se confunde com nada.
 */
export function escreverDiferenca(
  diferenca: number | null,
  medida: MedidaDaVariavel,
): string {
  if (diferenca === null) return "—";
  const sinal = diferenca > 0 ? "+" : diferenca < 0 ? "−" : "";
  const absoluto = Math.abs(diferenca);
  switch (medida) {
    case "DINHEIRO":
      return `${sinal}${formatBrl(absoluto)}`;
    case "REAIS_POR_KM":
      return `${sinal}${formatNumber(absoluto, 4)} R$/km`;
    case "DISTANCIA":
      return `${sinal}${formatNumber(absoluto, 1)} km`;
    case "PERCENTUAL":
      return `${sinal}${formatNumber(absoluto, 2)} p.p.`;
    default:
      return `${sinal}${formatNumber(absoluto, 0)}`;
  }
}

/** A variação em pontos percentuais. Nula quando a base é zero. */
export function escreverVariacao(variacao: number | null): string {
  if (variacao === null) return "—";
  const sinal = variacao > 0 ? "+" : variacao < 0 ? "−" : "";
  return `${sinal}${formatNumber(Math.abs(variacao), 2)}%`;
}

/** Um R$/km escrito, sempre com quatro casas. */
export function escreverReaisPorKm(valor: number | null): string {
  if (valor === null) return "—";
  return `${formatNumber(valor, 4)} R$/km`;
}

/** Uma quilometragem escrita, com uma casa. */
export function escreverKm(valor: number | null): string {
  if (valor === null) return "—";
  return `${formatNumber(valor, 1)} km`;
}

/**
 * A cor de um número que subiu ou desceu — e por que nem toda linha a recebe.
 *
 * Um R$/km que sobe é preço que sobe: vermelho. Um R$/km de **lucro variável**
 * que sobe também é preço que sobe, e continua vermelho — esta tela é do lado de
 * quem paga o frete, e a margem do transportador entra no preço como qualquer
 * outra parcela.
 *
 * Já uma **distância** não tem lado bom: um trecho que passou de 412 para 430 km
 * não ficou pior nem melhor, mudou de percurso. Pintá-la afirmaria um juízo que
 * esta tela não tem como sustentar — e o mesmo vale para viagens previstas, que
 * são previsão.
 */
export function corDaDiferenca(
  diferenca: number | null,
  papel: PapelDaColunaDeKm,
): string {
  if (diferenca === null || diferenca === 0) return "";
  if (papel !== "RAZAO" && papel !== "POR_VIAGEM") return "";
  return diferenca > 0 ? "text-destructive" : "text-success";
}

/** O selo de cada estado. Cor **e** texto — nunca só a cor. */
export const SELO_DO_ESTADO: Record<EstadoDaLinhaDeKm, string> = {
  SEM_ALTERACAO: "bg-muted text-muted-foreground",
  ALTERADO: "bg-warning/15 text-warning-foreground border border-warning/40",
  NOVO_NA_VIGENCIA: "bg-brand/10 text-brand border border-brand/25",
  AUSENTE_NA_COMPARADA: "bg-destructive/10 text-destructive border border-destructive/25",
  DADO_INCOMPLETO: "bg-muted text-muted-foreground border border-dashed border-border",
  CONFLITO: "bg-destructive/10 text-destructive border border-destructive/40",
};

/** Como a tela escreve a unidade de cada papel, curto. */
export const UNIDADE_DO_PAPEL: Record<PapelDaColunaDeKm, string> = {
  DISTANCIA: "km",
  RAZAO: "R$/km",
  POR_VIAGEM: "R$/viagem",
  VOLUME: "viagens",
  CONTEXTO: "—",
};

export { ROTULO_DO_ESTADO, ROTULO_DO_VEREDITO_DO_KM };

/** Os estados que a fileira de abas oferece, na ordem em que a tela os lê. */
export const ABAS_DE_ESTADO: { chave: "TODAS" | EstadoDaLinhaDeKm; rotulo: string }[] = [
  { chave: "TODAS", rotulo: "Todas as alterações" },
  { chave: "ALTERADO", rotulo: "Alterados" },
  { chave: "NOVO_NA_VIGENCIA", rotulo: "Novos" },
  { chave: "AUSENTE_NA_COMPARADA", rotulo: "Ausentes" },
  { chave: "DADO_INCOMPLETO", rotulo: "Dado incompleto" },
  { chave: "CONFLITO", rotulo: "Conflito" },
  { chave: "SEM_ALTERACAO", rotulo: "Sem alteração" },
];

export interface FiltrosDeKm {
  busca: string;
  papel: "TODOS" | PapelDaColunaDeKm;
  variavel: string;
  estado: "TODAS" | EstadoDaLinhaDeKm;
  /** Só as parcelas de R$/km — o preço do quilômetro, sem o resto. */
  soPrecoPorKm: boolean;
}

export const FILTROS_VAZIOS: FiltrosDeKm = {
  busca: "",
  papel: "TODOS",
  variavel: "TODAS",
  estado: "TODAS",
  soPrecoPorKm: false,
};

/**
 * O recorte da tabela — o mesmo que alimenta a contagem das abas e o CSV.
 *
 * Uma função só, e não uma por consumidor: a aba que diz "12" e a tabela que
 * mostra 9 linhas é o defeito que aparece quando o filtro é reescrito no lugar
 * de ser reutilizado.
 */
export function filtrar(linhas: readonly LinhaDeKm[], filtros: FiltrosDeKm): LinhaDeKm[] {
  const busca = filtros.busca.trim().toLowerCase();
  return linhas.filter((l) => {
    if (filtros.estado !== "TODAS" && l.estado !== filtros.estado) return false;
    if (filtros.papel !== "TODOS" && l.papel !== filtros.papel) return false;
    if (filtros.variavel !== "TODAS" && l.variavel !== filtros.variavel) return false;
    if (filtros.soPrecoPorKm && l.papel !== "RAZAO") return false;
    if (busca) {
      const alvo = `${l.entityLabel ?? ""} ${l.rotuloDaVariavel}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

/** Quantas linhas cada aba tem, contadas sobre o mesmo recorte da tabela. */
export function contagemPorAba(
  linhas: readonly LinhaDeKm[],
  filtros: FiltrosDeKm,
): Record<string, number> {
  const contagem: Record<string, number> = { TODAS: 0 };
  for (const aba of ABAS_DE_ESTADO) {
    if (aba.chave === "TODAS") continue;
    contagem[aba.chave] = filtrar(linhas, { ...filtros, estado: aba.chave }).length;
  }
  contagem.TODAS = filtrar(linhas, { ...filtros, estado: "TODAS" }).length;
  return contagem;
}

/**
 * A tabela virando as linhas do CSV.
 *
 * As células saem do núcleo (`celulasDoCsvDeKm`), e aqui só se converte número
 * em texto do Excel brasileiro. Duas regras separadas porque são dois assuntos:
 * o que vai em cada coluna é do domínio, e a vírgula decimal é do Excel.
 */
export function linhasDoCsv(
  linhas: readonly LinhaDeKm[],
  /*
     O que o gestor escreveu sobre cada alteração, por `change.id` — a mesma
     leitura que a coluna da tabela usa. Opcional porque ela pode não ter
     voltado: um CSV com a coluna em branco continua sendo o arquivo da
     comparação, e recusá-lo por causa do comentário seria trocar o dado pela
     nota sobre o dado.
  */
  justificadaPor?: ReadonlyMap<number, { texto: string }>,
): string[][] {
  return [
    [...COLUNAS_DO_CSV_DE_KM],
    ...linhas.map((l) =>
      celulasDoCsvDeKm(
        l,
        l.id === null ? null : (justificadaPor?.get(l.id)?.texto ?? null),
      ).map((celula) => {
        if (celula === null || celula === undefined) return "";
        if (typeof celula === "number") return numeroParaCsv(celula);
        return celula;
      }),
    ),
  ];
}

/**
 * O impacto por periodicidade, escrito — e quase sempre vazio.
 *
 * Vazio não é defeito nesta rubrica: é a consequência de nenhuma coluna desta
 * tela ser dinheiro do período. Quem diz isso por extenso é o cartão; esta
 * função só escreve o que houver.
 */
export function escreverImpacto(
  porPeriodicidade: Record<string, number>,
): { rotulo: string; valor: string; bruto: number }[] {
  return Object.entries(porPeriodicidade)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodicidade, valor]) => ({
      rotulo: periodicidade.toLowerCase(),
      valor: `${valor > 0 ? "+" : valor < 0 ? "−" : ""}${formatBrl(Math.abs(valor))}`,
      bruto: valor,
    }));
}
