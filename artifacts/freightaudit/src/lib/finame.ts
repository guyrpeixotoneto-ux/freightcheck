import {
  ROTULO_DO_ESTADO,
  celulasDoCsv,
  COLUNAS_DO_CSV,
  type EstadoDaLinhaDeFiname,
  type LinhaDeFiname,
  type MedidaDaVariavel,
} from "@workspace/comparison/finame";
import { numeroParaCsv } from "@/lib/csv";
import { formatBrl, formatNumber } from "@/lib/format";

/**
 * A metade de tela da Auditoria de FINAME — apresentação, e só.
 *
 * A conta inteira mora em `@workspace/comparison/finame`, que o servidor também
 * importa: estado, diferença, variação, impacto e agregados saem de lá, e a
 * tela nunca refaz nenhum deles. O que este arquivo acrescenta é o que é
 * genuinamente de apresentação — como se **escreve** um número cuja unidade
 * muda de linha para linha, que cor cada estado recebe e como a tabela vira
 * arquivo.
 *
 * A separação não é gosto: enquanto a soma morava no JSX, o cartão somava a
 * página e a tabela somava o recorte, e os dois números apareciam lado a lado
 * na mesma tela discordando.
 */

/** O que a API de `/finame/comparacao` devolve. */
export interface ComparacaoDeFiname {
  changeSetId: string;
  base: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  comparada: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  resumo: {
    veiculosComparados: number;
    semAlteracao: number;
    veiculosComAlteracao: number;
    novosNaVigencia: number;
    ausentesNaComparada: number;
    variaveisAlteradas: number;
    veiculosComDadoIncompleto: number;
    veiculosComConflito: number;
    impacto: {
      porPeriodicidade: Record<string, number>;
      naoCalculavel: number;
      cobertasPorParcelas: number;
    };
  };
  alteracoesPorVariavel: {
    variavel: string;
    rotulo: string;
    medida: MedidaDaVariavel;
    alteracoes: number;
  }[];
  distribuicaoPorEstado: {
    estado: EstadoDaLinhaDeFiname;
    rotulo: string;
    veiculos: number;
    fracao: number;
  }[];
  linhas: LinhaDeFiname[];
}

export interface TotaisDeFiname {
  totais: {
    ponta: "BASE" | "COMPARADA";
    entityType: string;
    total: number;
    veiculos: number;
  }[];
}

/**
 * Um valor escrito na unidade da própria variável.
 *
 * Dinheiro sai com `R$`, percentual com `%`, prazo e carência em meses, ano
 * inteiro e data como a fonte a entregou. É a razão de `medida` viajar em cada
 * linha: uma tabela que formata tudo como dinheiro escreve "R$ 60,00" onde a
 * fonte disse "60 meses", e quem lê acredita.
 */
export function escreverValor(
  valor: string | null,
  medida: MedidaDaVariavel,
): string {
  if (valor === null || valor === "") return "—";
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return valor;
  switch (medida) {
    case "DINHEIRO":
      return formatBrl(numero);
    case "PERCENTUAL":
      return `${formatNumber(numero, 2)}%`;
    case "MESES":
      return `${formatNumber(numero, 0)} ${numero === 1 ? "mês" : "meses"}`;
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
 * linhas sobe e metade desce, "310" e "−310" a três linhas de distância se
 * confundem, e "+310" não se confunde com nada. O percentual é escrito à parte
 * para que a diferença de uma taxa apareça em **pontos percentuais** — 0,5 p.p.
 * e +5,26% são as duas verdades da mesma linha, e só uma delas é a diferença.
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
    case "PERCENTUAL":
      return `${sinal}${formatNumber(absoluto, 2)} p.p.`;
    case "MESES":
      return `${sinal}${formatNumber(absoluto, 0)} ${absoluto === 1 ? "mês" : "meses"}`;
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

/**
 * A cor de um número que subiu ou desceu — e por que ela não é semântica aqui.
 *
 * Uma parcela que sobe é custo; uma que desce é economia. Mas prazo, ano e data
 * não têm lado bom, e pintá-los de verde e vermelho afirmaria um juízo que esta
 * tela não tem como sustentar. Então a cor só aparece em dinheiro; o resto fica
 * na tinta normal, e o sinal diz tudo o que há para dizer.
 */
export function corDaDiferenca(
  diferenca: number | null,
  medida: MedidaDaVariavel,
): string {
  if (diferenca === null || diferenca === 0 || medida !== "DINHEIRO") return "";
  return diferenca > 0 ? "text-destructive" : "text-success";
}

/** O selo de cada estado. Cor **e** texto — nunca só a cor. */
export const SELO_DO_ESTADO: Record<EstadoDaLinhaDeFiname, string> = {
  SEM_ALTERACAO: "bg-muted text-muted-foreground",
  ALTERADO: "bg-warning/15 text-warning-foreground border border-warning/40",
  NOVO_NA_VIGENCIA: "bg-brand/10 text-brand border border-brand/25",
  AUSENTE_NA_COMPARADA: "bg-destructive/10 text-destructive border border-destructive/25",
  DADO_INCOMPLETO: "bg-muted text-muted-foreground border border-dashed border-border",
  CONFLITO: "bg-destructive/10 text-destructive border border-destructive/40",
};

export { ROTULO_DO_ESTADO };

/** Os estados que a fileira de abas oferece, na ordem em que a tela os lê. */
export const ABAS_DE_ESTADO: { chave: "TODAS" | EstadoDaLinhaDeFiname; rotulo: string }[] = [
  { chave: "TODAS", rotulo: "Todas as alterações" },
  { chave: "ALTERADO", rotulo: "Alterados" },
  { chave: "NOVO_NA_VIGENCIA", rotulo: "Novos" },
  { chave: "AUSENTE_NA_COMPARADA", rotulo: "Ausentes" },
  { chave: "DADO_INCOMPLETO", rotulo: "Dado incompleto" },
  { chave: "CONFLITO", rotulo: "Conflito" },
  { chave: "SEM_ALTERACAO", rotulo: "Sem alteração" },
];

export interface FiltrosDeFiname {
  busca: string;
  tipo: string;
  variavel: string;
  estado: "TODAS" | EstadoDaLinhaDeFiname;
}

export const FILTROS_VAZIOS: FiltrosDeFiname = {
  busca: "",
  tipo: "TODOS",
  variavel: "TODAS",
  estado: "TODAS",
};

/**
 * O recorte da tabela — o mesmo que alimenta a contagem das abas e o CSV.
 *
 * Uma função só, e não uma por consumidor: a aba que diz "12" e a tabela que
 * mostra 9 linhas é o defeito que aparece quando o filtro é reescrito no lugar
 * de ser reutilizado.
 */
export function filtrar(
  linhas: readonly LinhaDeFiname[],
  filtros: FiltrosDeFiname,
): LinhaDeFiname[] {
  const busca = filtros.busca.trim().toLowerCase();
  return linhas.filter((l) => {
    if (filtros.estado !== "TODAS" && l.estado !== filtros.estado) return false;
    if (filtros.tipo !== "TODOS" && l.entityType !== filtros.tipo) return false;
    if (filtros.variavel !== "TODAS" && l.variavel !== filtros.variavel) return false;
    if (busca) {
      const alvo = `${l.entityLabel ?? ""} ${l.rotuloDaVariavel}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

/** Quantas linhas cada aba tem, contadas sobre o mesmo recorte da tabela. */
export function contagemPorAba(
  linhas: readonly LinhaDeFiname[],
  filtros: FiltrosDeFiname,
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
 * As células saem do núcleo (`celulasDoCsv`), e aqui só se converte número em
 * texto do Excel brasileiro. Duas regras separadas porque são dois assuntos: o
 * que vai em cada coluna é do domínio, e a vírgula decimal é do Excel.
 */
export function linhasDoCsv(linhas: readonly LinhaDeFiname[]): string[][] {
  return [
    [...COLUNAS_DO_CSV],
    ...linhas.map((l) =>
      celulasDoCsv(l).map((celula) => {
        if (celula === null || celula === undefined) return "";
        if (typeof celula === "number") return numeroParaCsv(celula);
        return celula;
      }),
    ),
  ];
}

/**
 * O impacto por periodicidade, escrito.
 *
 * Nunca um total único: mensal e anual não se somam, e a tela repete essa
 * recusa mostrando um valor por periodicidade. Quando não há nenhum, a frase é
 * "sem impacto precificável" — que é diferente de "R$ 0,00".
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
