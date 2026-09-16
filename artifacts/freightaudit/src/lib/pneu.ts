import {
  ROTULO_DO_ESTADO,
  ROTULO_DO_VEREDITO_DO_PNEU,
  celulasDoCsvDePneu,
  COLUNAS_DO_CSV_DE_PNEU,
  type ConferenciaDaVigenciaDePneu,
  type CustoDoPneuDaVigencia,
  type EstadoDaLinhaDePneu,
  type LinhaDePneu,
  type MedidaDaVariavel,
  type PapelDaColunaDePneu,
  type ReconstituicaoDaVigencia,
} from "@workspace/comparison/pneu";
import { numeroParaCsv } from "@/lib/csv";
import { formatBrl, formatNumber } from "@/lib/format";

/**
 * A metade de tela da Auditoria de Pneu — apresentação, e só.
 *
 * A conta inteira mora em `@workspace/comparison/pneu`, que o servidor também
 * importa: estado, diferença, variação, impacto, custo por vigência,
 * reconstituição e as duas conferências saem de lá, e a tela nunca refaz nenhuma
 * delas.
 *
 * O que este arquivo acrescenta é o que é genuinamente de apresentação — e aqui
 * ele carrega mais peso do que em qualquer outra tela de trecho, por causa da
 * mistura de unidades. Numa mesma coluna convivem `0,0312` (R$/km), `2.000,00`
 * (reais por pneu), `6` (pneus) e `480.000` (quilômetros de vida). Formatar tudo
 * igual escreveria "R$ 480.000,00" onde a fonte disse a vida útil da carcaça — e
 * quem lê acredita.
 */

/** O que a API de `/pneu/comparacao` devolve. */
export interface ComparacaoDePneu {
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
      vidasAlteradas: number;
      unitariosAlterados: number;
    };
  };
  alteracoesPorVariavel: {
    variavel: string;
    rotulo: string;
    medida: MedidaDaVariavel;
    papel: PapelDaColunaDePneu;
    alteracoes: number;
  }[];
  distribuicaoPorEstado: {
    estado: EstadoDaLinhaDePneu;
    rotulo: string;
    trechos: number;
    fracao: number;
  }[];
  linhas: LinhaDePneu[];
}

/** O que a API de `/pneu/totais` devolve: as três séries da mesma leitura. */
export interface TotaisDePneu {
  custo: CustoDoPneuDaVigencia[];
  reconstituicao: ReconstituicaoDaVigencia[];
  conferencias: ConferenciaDaVigenciaDePneu[];
}

/**
 * Um valor escrito na unidade da própria variável.
 *
 * `REAIS_POR_KM` sai com quatro casas, e não com duas, por um motivo que nesta
 * rubrica é ainda mais duro do que no Km Rodado: a parcela de pneu é da ordem de
 * três centavos por quilômetro. Cortada em duas casas, ela viraria "R$ 0,03" —
 * e um trecho a 0,0312 e outro a 0,0348, que é uma diferença de 12%, sairiam
 * como o mesmo número.
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
      return `${formatNumber(numero, 0)} km`;
    case "QUANTIDADE":
      return `${formatNumber(numero, 0)} ${numero === 1 ? "pneu" : "pneus"}`;
    case "PERCENTUAL":
      return `${formatNumber(numero, 2)}%`;
    default:
      return valor;
  }
}

/**
 * A diferença, com sinal explícito e na unidade certa.
 *
 * O sinal vem escrito mesmo quando é positivo: numa coluna em que metade das
 * linhas sobe e metade desce, "0,0036" e "−0,0036" a três linhas de distância se
 * confundem, e "+0,0036" não se confunde com nada.
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
      return `${sinal}${formatNumber(absoluto, 0)} km`;
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

/** Uma quilometragem de vida útil escrita, sem casas decimais. */
export function escreverKmDeVida(valor: number | null): string {
  if (valor === null) return "—";
  return `${formatNumber(valor, 0)} km`;
}

/**
 * A cor de um número que subiu ou desceu — e por que nem toda linha a recebe.
 *
 * Um R$/km de pneu que sobe é custo que sobe: vermelho. Um valor unitário que
 * sobe também é — pneu mais caro é pneu mais caro, e a quantidade não muda o
 * sinal disso.
 *
 * Já a **vida útil** tem o sentido invertido: uma carcaça que passou a durar
 * mais barateia o quilômetro. Pintá-la com a régua do custo diria o contrário do
 * que aconteceu, então ela recebe a régua própria — verde quando sobe.
 *
 * A **quantidade de pneus** não é pintada de jeito nenhum: um conjunto que
 * passou de seis para dez pneus não ficou pior nem melhor, mudou de composição,
 * e o custo por quilômetro disso já está na linha de R$/km logo acima.
 */
export function corDaDiferenca(
  diferenca: number | null,
  papel: PapelDaColunaDePneu,
): string {
  if (diferenca === null || diferenca === 0) return "";
  if (papel === "VIDA") return diferenca > 0 ? "text-success" : "text-destructive";
  if (papel !== "RAZAO" && papel !== "POR_VIAGEM" && papel !== "UNITARIO") return "";
  return diferenca > 0 ? "text-destructive" : "text-success";
}

/** O selo de cada estado. Cor **e** texto — nunca só a cor. */
export const SELO_DO_ESTADO: Record<EstadoDaLinhaDePneu, string> = {
  SEM_ALTERACAO: "bg-muted text-muted-foreground",
  ALTERADO: "bg-warning/15 text-warning-foreground border border-warning/40",
  NOVO_NA_VIGENCIA: "bg-brand/10 text-brand border border-brand/25",
  AUSENTE_NA_COMPARADA: "bg-destructive/10 text-destructive border border-destructive/25",
  DADO_INCOMPLETO: "bg-muted text-muted-foreground border border-dashed border-border",
  CONFLITO: "bg-destructive/10 text-destructive border border-destructive/40",
};

/** Como a tela escreve a unidade de cada papel, curto. */
export const UNIDADE_DO_PAPEL: Record<PapelDaColunaDePneu, string> = {
  RAZAO: "R$/km",
  POR_VIAGEM: "R$/viagem",
  UNITARIO: "R$/pneu",
  QUANTIDADE: "pneus",
  VIDA: "km de vida",
  CONTEXTO: "—",
};

export { ROTULO_DO_ESTADO, ROTULO_DO_VEREDITO_DO_PNEU };

/** Os estados que a fileira de abas oferece, na ordem em que a tela os lê. */
export const ABAS_DE_ESTADO: { chave: "TODAS" | EstadoDaLinhaDePneu; rotulo: string }[] = [
  { chave: "TODAS", rotulo: "Todas as alterações" },
  { chave: "ALTERADO", rotulo: "Alterados" },
  { chave: "NOVO_NA_VIGENCIA", rotulo: "Novos" },
  { chave: "AUSENTE_NA_COMPARADA", rotulo: "Ausentes" },
  { chave: "DADO_INCOMPLETO", rotulo: "Dado incompleto" },
  { chave: "CONFLITO", rotulo: "Conflito" },
  { chave: "SEM_ALTERACAO", rotulo: "Sem alteração" },
];

export interface FiltrosDePneu {
  busca: string;
  papel: "TODOS" | PapelDaColunaDePneu;
  variavel: string;
  estado: "TODAS" | EstadoDaLinhaDePneu;
  /** Só as parcelas de R$/km — o custo do quilômetro, sem os componentes. */
  soReaisPorKm: boolean;
}

export const FILTROS_VAZIOS: FiltrosDePneu = {
  busca: "",
  papel: "TODOS",
  variavel: "TODAS",
  estado: "TODAS",
  soReaisPorKm: false,
};

/**
 * O recorte da tabela — o mesmo que alimenta a contagem das abas e o CSV.
 *
 * Uma função só, e não uma por consumidor: a aba que diz "12" e a tabela que
 * mostra 9 linhas é o defeito que aparece quando o filtro é reescrito no lugar
 * de ser reutilizado.
 */
export function filtrar(
  linhas: readonly LinhaDePneu[],
  filtros: FiltrosDePneu,
): LinhaDePneu[] {
  const busca = filtros.busca.trim().toLowerCase();
  return linhas.filter((l) => {
    if (filtros.estado !== "TODAS" && l.estado !== filtros.estado) return false;
    if (filtros.papel !== "TODOS" && l.papel !== filtros.papel) return false;
    if (filtros.variavel !== "TODAS" && l.variavel !== filtros.variavel) return false;
    if (filtros.soReaisPorKm && l.papel !== "RAZAO") return false;
    if (busca) {
      const alvo = `${l.entityLabel ?? ""} ${l.rotuloDaVariavel}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

/** Quantas linhas cada aba tem, contadas sobre o mesmo recorte da tabela. */
export function contagemPorAba(
  linhas: readonly LinhaDePneu[],
  filtros: FiltrosDePneu,
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
 * As células saem do núcleo (`celulasDoCsvDePneu`), e aqui só se converte número
 * em texto do Excel brasileiro. Duas regras separadas porque são dois assuntos: o
 * que vai em cada coluna é do domínio, e a vírgula decimal é do Excel.
 */
export function linhasDoCsv(
  linhas: readonly LinhaDePneu[],
  /*
     O que o gestor escreveu sobre cada alteração, por `change.id`. Opcional
     porque ela pode não ter voltado: um CSV com a coluna em branco continua
     sendo o arquivo da comparação.
  */
  justificadaPor?: ReadonlyMap<number, { texto: string }>,
): string[][] {
  return [
    [...COLUNAS_DO_CSV_DE_PNEU],
    ...linhas.map((l) =>
      celulasDoCsvDePneu(
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
 * tela ser dinheiro do período. Quem diz isso por extenso é o cartão; esta função
 * só escreve o que houver.
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
