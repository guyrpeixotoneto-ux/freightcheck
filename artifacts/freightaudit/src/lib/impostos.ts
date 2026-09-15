import {
  ROTULO_DO_ESTADO,
  ROTULO_DO_TRIBUTO,
  ROTULO_DO_VEREDITO_DO_TRIBUTO,
  celulasDoCsvDeImpostos,
  COLUNAS_DO_CSV_DE_IMPOSTOS,
  type ConferenciaDaAliquota,
  type EstadoDaLinhaDeImpostos,
  type LinhaDeImpostos,
  type MedidaDaVariavel,
  type Tributo,
  type VereditoDoTributo,
} from "@workspace/comparison/impostos";
import { numeroParaCsv } from "@/lib/csv";
import { formatBrl, formatNumber } from "@/lib/format";

/**
 * A metade de tela da Auditoria de Impostos — apresentação, e só.
 *
 * A conta inteira mora em `@workspace/comparison/impostos`, que o servidor
 * também importa: estado, diferença, variação, impacto, conferência de alíquota
 * e agregados saem de lá, e a tela nunca refaz nenhum deles. O que este arquivo
 * acrescenta é o que é genuinamente de apresentação — como se **escreve** um
 * número cuja unidade muda de linha para linha, que cor cada estado recebe e
 * como a tabela vira arquivo.
 *
 * A separação não é gosto: é a mesma de `lib/finame.ts`, `lib/ipva.ts` e
 * `lib/lucro-fixo.ts`, e nasceu do defeito que ela evita — enquanto a soma
 * morava no JSX, o cartão somava a página e a tabela somava o recorte, e os dois
 * números apareciam lado a lado na mesma tela discordando.
 */

/** O que a API de `/impostos/comparacao` devolve. */
export interface ComparacaoDeImpostos {
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
      foraDaSoma: number;
      aliquotasAlteradas: number;
    };
  };
  alteracoesPorVariavel: {
    variavel: string;
    rotulo: string;
    medida: MedidaDaVariavel;
    tributo: Tributo | null;
    alteracoes: number;
  }[];
  distribuicaoPorEstado: {
    estado: EstadoDaLinhaDeImpostos;
    rotulo: string;
    veiculos: number;
    fracao: number;
  }[];
  linhas: LinhaDeImpostos[];
}

/** O que a API de `/impostos/totais` devolve: as duas séries da mesma leitura. */
export interface TotaisDeImpostos {
  totais: {
    ponta: "BASE" | "COMPARADA";
    entityType: string;
    tributo: Tributo;
    total: number;
    ativos: number;
    zerados: number;
  }[];
  conferencias: ConferenciaDaAliquota[];
}

/**
 * Um valor escrito na unidade da própria variável.
 *
 * Dinheiro sai com `R$`, percentual com `%`, ano inteiro e data como a fonte a
 * entregou. É a razão de `medida` viajar em cada linha: numa tabela em que a
 * linha de cima é R$ 37.890,84 e a de baixo é 12, formatar as duas do mesmo
 * jeito escreveria "R$ 12,00" onde a fonte disse "12 por cento" — e quem lê
 * acredita.
 */
export function escreverValor(valor: string | null, medida: MedidaDaVariavel): string {
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
 * confundem, e "+310" não se confunde com nada.
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
 * A alíquota escrita — sempre com três casas.
 *
 * Três, e não duas, porque é a terceira que carrega o achado: "9,25%" e "9,250%"
 * parecem o mesmo número, e só o segundo deixa ver que **todos** os ativos
 * caíram no mesmo valor. É também a casa em que a declarada e a medida se
 * separam — 9,3 contra 9,250 —, e sem ela a conferência ficaria invisível.
 *
 * Por isso não usa `formatNumber`: aquele corta o zero à direita, e 9,250% sairia
 * dele como "9,25%", que é exatamente a escrita que esconde a evidência.
 */
export function escreverAliquota(percentual: number | null): string {
  if (percentual === null) return "—";
  const escrito = percentual.toLocaleString("pt-BR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
  return `${escrito}%`;
}

/**
 * A cor de um número que subiu ou desceu — e por que ela não é semântica aqui.
 *
 * Um imposto que sobe é custo; um que desce é economia. Mas alíquota, ano e data
 * não têm lado bom — uma alíquota que cai pode ser um crédito legítimo ou uma
 * declaração que ficou para trás —, e pintá-las de verde e vermelho afirmaria um
 * juízo que esta tela não tem como sustentar. Então a cor só aparece em dinheiro;
 * o resto fica na tinta normal, e o sinal diz tudo o que há para dizer.
 */
export function corDaDiferenca(
  diferenca: number | null,
  medida: MedidaDaVariavel,
): string {
  if (diferenca === null || diferenca === 0 || medida !== "DINHEIRO") return "";
  return diferenca > 0 ? "text-destructive" : "text-success";
}

/** O selo de cada estado. Cor **e** texto — nunca só a cor. */
export const SELO_DO_ESTADO: Record<EstadoDaLinhaDeImpostos, string> = {
  SEM_ALTERACAO: "bg-muted text-muted-foreground",
  ALTERADO: "bg-warning/15 text-warning-foreground border border-warning/40",
  NOVO_NA_VIGENCIA: "bg-brand/10 text-brand border border-brand/25",
  AUSENTE_NA_COMPARADA: "bg-destructive/10 text-destructive border border-destructive/25",
  DADO_INCOMPLETO: "bg-muted text-muted-foreground border border-dashed border-border",
  CONFLITO: "bg-destructive/10 text-destructive border border-destructive/40",
};

/**
 * O selo do veredito da conferência.
 *
 * `SEM_MONTANTE` e `DIVERGEM` são os dois que pedem ação, e ficam nas duas cores
 * de alerta: o primeiro é uma coluna que ninguém preencheu ao lado de uma taxa
 * que alguém declarou; o segundo é a taxa declarada discordando do dinheiro.
 *
 * `FORMULA_UNICA` fica em aviso, e não em sucesso, pela mesma razão da Auditoria
 * de IPVA: desvio zero não é o retrato de um dado impecável — é uma fórmula
 * aplicada em bloco, e quem confere precisa saber que ninguém calculou ativo a
 * ativo.
 *
 * `CONFEREM` é o único verde desta tela, e é o único que merece: é o dinheiro
 * dizendo a mesma coisa que a declaração.
 */
export const SELO_DO_VEREDITO: Record<VereditoDoTributo, string> = {
  SEM_MONTANTE: "bg-destructive/10 text-destructive border border-destructive/40",
  DIVERGEM: "bg-warning/15 text-warning-foreground border border-warning/40",
  CONFEREM: "bg-success/10 text-success border border-success/25",
  FORMULA_UNICA: "bg-warning/15 text-warning-foreground border border-warning/40",
  POR_VEICULO: "bg-brand/10 text-brand border border-brand/25",
  BASE_INSUFICIENTE: "bg-muted text-muted-foreground border border-dashed border-border",
};

export { ROTULO_DO_ESTADO, ROTULO_DO_TRIBUTO, ROTULO_DO_VEREDITO_DO_TRIBUTO };

/** Os estados que a fileira de abas oferece, na ordem em que a tela os lê. */
export const ABAS_DE_ESTADO: {
  chave: "TODAS" | EstadoDaLinhaDeImpostos;
  rotulo: string;
}[] = [
  { chave: "TODAS", rotulo: "Todas as alterações" },
  { chave: "ALTERADO", rotulo: "Alterados" },
  { chave: "NOVO_NA_VIGENCIA", rotulo: "Novos" },
  { chave: "AUSENTE_NA_COMPARADA", rotulo: "Ausentes" },
  { chave: "DADO_INCOMPLETO", rotulo: "Dado incompleto" },
  { chave: "CONFLITO", rotulo: "Conflito" },
  { chave: "SEM_ALTERACAO", rotulo: "Sem alteração" },
];

export interface FiltrosDeImpostos {
  busca: string;
  tipo: string;
  tributo: "TODOS" | Tributo;
  variavel: string;
  estado: "TODAS" | EstadoDaLinhaDeImpostos;
  /** Só as alíquotas declaradas — as linhas que nunca viram dinheiro. */
  soAliquotas: boolean;
}

export const FILTROS_VAZIOS: FiltrosDeImpostos = {
  busca: "",
  tipo: "TODOS",
  tributo: "TODOS",
  variavel: "TODAS",
  estado: "TODAS",
  soAliquotas: false,
};

/**
 * O recorte da tabela — o mesmo que alimenta a contagem das abas e o CSV.
 *
 * Uma função só, e não uma por consumidor: a aba que diz "12" e a tabela que
 * mostra 9 linhas é o defeito que aparece quando o filtro é reescrito no lugar
 * de ser reutilizado.
 */
export function filtrar(
  linhas: readonly LinhaDeImpostos[],
  filtros: FiltrosDeImpostos,
): LinhaDeImpostos[] {
  const busca = filtros.busca.trim().toLowerCase();
  return linhas.filter((l) => {
    if (filtros.estado !== "TODAS" && l.estado !== filtros.estado) return false;
    if (filtros.tipo !== "TODOS" && l.entityType !== filtros.tipo) return false;
    if (filtros.tributo !== "TODOS" && l.tributo !== filtros.tributo) return false;
    if (filtros.variavel !== "TODAS" && l.variavel !== filtros.variavel) return false;
    if (filtros.soAliquotas && l.papel !== "ALIQUOTA") return false;
    if (busca) {
      const alvo = `${l.entityLabel ?? ""} ${l.rotuloDaVariavel}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

/** Quantas linhas cada aba tem, contadas sobre o mesmo recorte da tabela. */
export function contagemPorAba(
  linhas: readonly LinhaDeImpostos[],
  filtros: FiltrosDeImpostos,
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
 * As células saem do núcleo (`celulasDoCsvDeImpostos`), e aqui só se converte
 * número em texto do Excel brasileiro. Duas regras separadas porque são dois
 * assuntos: o que vai em cada coluna é do domínio, e a vírgula decimal é do
 * Excel.
 */
export function linhasDoCsv(linhas: readonly LinhaDeImpostos[]): string[][] {
  return [
    [...COLUNAS_DO_CSV_DE_IMPOSTOS],
    ...linhas.map((l) =>
      celulasDoCsvDeImpostos(l).map((celula) => {
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
 * Nunca um total único: o PIS/COFINS de aquisição é `PONTUAL` — incide uma vez,
 * sobre a nota de compra —, e juntá-lo a uma rubrica mensal daria um número que
 * não descreve nem o mês nem a compra. Quando não há nada precificável, a frase é
 * "sem impacto precificável", que é diferente de "R$ 0,00".
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
