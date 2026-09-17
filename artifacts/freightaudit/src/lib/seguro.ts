import {
  ROTULO_DO_ESTADO,
  ROTULO_DO_VEREDITO_DO_APARATO,
  celulasDoCsvDeSeguro,
  COLUNAS_DO_CSV_DE_SEGURO,
  type ConferenciaDoAparato,
  type EstadoDaLinhaDeSeguro,
  type LinhaDeSeguro,
  type MedidaDaVariavel,
  type VereditoDoAparato,
  FILTROS_DE_SEGURO_VAZIOS,
  filtrarLinhasDeSeguro,
  type FiltrosDeSeguro,
} from "@workspace/comparison/seguro";
import { numeroParaCsv } from "@/lib/csv";
import { formatBrl, formatNumber } from "@/lib/format";

/**
 * A metade de tela da Auditoria de Seguro e Aparato — apresentação, e só.
 *
 * A conta inteira mora em `@workspace/comparison/seguro`, que o servidor também
 * importa: estado, diferença, variação, impacto, a conferência contra o custo
 * fixo e os agregados saem de lá, e a tela nunca refaz nenhum deles. O que este
 * arquivo acrescenta é o que é genuinamente de apresentação — como se escreve um
 * número, que cor cada estado recebe e como a tabela vira arquivo.
 *
 * A separação não é gosto: é a mesma de `lib/ipva.ts`, e nasceu do defeito que
 * ela evita — enquanto a soma morava no JSX, o cartão somava a página e a tabela
 * somava o recorte, e os dois números apareciam lado a lado discordando.
 */

/**
 * Os três agregados que os cartões e os gráficos leem.
 *
 * Tipo próprio porque vem três vezes na mesma resposta: uma para a comparação
 * inteira e uma por tipo de equipamento (`porTipo`), que é o que as abas Cavalo
 * e Carreta mostram. A mesma forma nos dois é o que permite a tela trocar de
 * recorte sem trocar de código.
 */
export interface AgregadosDeSeguro {
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
      alteracoesDeTaxa: number;
    };
  };
  alteracoesPorVariavel: {
    variavel: string;
    rotulo: string;
    medida: MedidaDaVariavel;
    alteracoes: number;
  }[];
  distribuicaoPorEstado: {
    estado: EstadoDaLinhaDeSeguro;
    rotulo: string;
    veiculos: number;
    fracao: number;
  }[];
}

export interface ComparacaoDeSeguro extends AgregadosDeSeguro {
  changeSetId: string;
  base: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  comparada: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  /**
   * Os mesmos agregados, um por tipo — calculados no servidor.
   *
   * Não é a tela que os recompõe a partir de `linhas`: "veículos comparados"
   * sai do acervo (`frotaPorTipo`, em `query.ts`) e não da lista de alterações,
   * porque um veículo em que nada mudou não produz linha nenhuma — e nesta
   * rubrica quase ninguém muda.
   */
  porTipo: Record<string, AgregadosDeSeguro>;
  linhas: LinhaDeSeguro[];
}

/** O que a API de `/seguro/totais` devolve: as duas séries da mesma leitura. */
export interface TotaisDeSeguro {
  totais: {
    ponta: "BASE" | "COMPARADA";
    entityType: string;
    total: number;
    seguro: number;
    taxas: number;
    veiculos: number;
    semTacografo: number;
  }[];
  conferencias: ConferenciaDoAparato[];
}

/**
 * Um valor escrito na unidade da própria variável.
 *
 * Nesta rubrica todas as variáveis são dinheiro — mas a função continua
 * recebendo `medida`, e não assume: é a mesma assinatura das outras quatro
 * telas, e o dia em que entrar aqui uma coluna de apólice em meses, ela sai
 * escrita como meses em vez de virar "R$ 12,00".
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
 * A cor de um número que subiu ou desceu — e para que lado ela aponta.
 *
 * O aparato desta tela é **rubrica remunerada na tabela de frete**, e não a
 * apólice que a transportadora paga à seguradora. Um seguro que cai para
 * R$ 0,00 não é economia: é a rubrica deixando de ser paga, e quem opera perdeu
 * dinheiro. Então **descer é vermelho e subir é verde**, a mesma régua do
 * FINAME, do IPVA e do lucro fixo — as quatro são remuneração, e a cor é a do
 * bolso de quem lê.
 */
export function corDaDiferenca(
  diferenca: number | null,
  medida: MedidaDaVariavel,
): string {
  if (diferenca === null || diferenca === 0 || medida !== "DINHEIRO") return "";
  return diferenca > 0 ? "text-success" : "text-destructive";
}

/** O selo de cada estado. Cor **e** texto — nunca só a cor. */
export const SELO_DO_ESTADO: Record<EstadoDaLinhaDeSeguro, string> = {
  SEM_ALTERACAO: "bg-muted text-muted-foreground",
  ALTERADO: "bg-warning/15 text-warning-foreground",
  NOVO_NA_VIGENCIA: "bg-success/15 text-success",
  AUSENTE_NA_COMPARADA: "bg-destructive/15 text-destructive",
  DADO_INCOMPLETO: "bg-muted text-muted-foreground",
  CONFLITO: "bg-destructive/15 text-destructive",
};

/** O selo de cada veredito da conferência. */
export const SELO_DO_VEREDITO: Record<VereditoDoAparato, string> = {
  FORA_DO_TOTAL: "bg-warning/15 text-warning-foreground",
  DENTRO_DO_TOTAL: "bg-success/15 text-success",
  MISTO: "bg-destructive/15 text-destructive",
  BASE_INSUFICIENTE: "bg-muted text-muted-foreground",
};

export { ROTULO_DO_ESTADO, ROTULO_DO_VEREDITO_DO_APARATO };

/** Os estados que a fileira de abas oferece, na ordem em que a tela os lê. */
export const ABAS_DE_ESTADO: { chave: "TODAS" | EstadoDaLinhaDeSeguro; rotulo: string }[] = [
  { chave: "TODAS", rotulo: "Todas as alterações" },
  { chave: "ALTERADO", rotulo: "Alterados" },
  { chave: "NOVO_NA_VIGENCIA", rotulo: "Novos" },
  { chave: "AUSENTE_NA_COMPARADA", rotulo: "Ausentes" },
  { chave: "DADO_INCOMPLETO", rotulo: "Dado incompleto" },
  { chave: "CONFLITO", rotulo: "Conflito" },
  { chave: "SEM_ALTERACAO", rotulo: "Sem alteração" },
];

/**
 * Os filtros e o recorte — **do núcleo**.
 *
 * Os dois nasceram aqui, e era o lugar certo enquanto o recorte só produzia uma
 * tabela. Deixou de ser quando a justificativa em lote passou a poder dizer
 * "todos os resultados deste filtro": ali o cliente manda o filtro, e quem
 * reabre o universo para gravar é o servidor — que não importa a tela.
 *
 * Então eles moram em `@workspace/comparison/seguro`, com as contas, e esta
 * linha é o que resta do que este arquivo tinha. Os nomes de fora continuam os
 * mesmos de propósito: a tela chama `filtrar`, e nenhuma delas precisou mudar.
 */
export {
  FILTROS_DE_SEGURO_VAZIOS as FILTROS_VAZIOS,
  filtrarLinhasDeSeguro as filtrar,
  type FiltrosDeSeguro as FiltrosDeSeguro,
};

/** Quantas linhas cada aba tem, contadas sobre o mesmo recorte da tabela. */
export function contagemPorAba(
  linhas: readonly LinhaDeSeguro[],
  filtros: FiltrosDeSeguro,
): Record<string, number> {
  const contagem: Record<string, number> = { TODAS: 0 };
  for (const aba of ABAS_DE_ESTADO) {
    if (aba.chave === "TODAS") continue;
    contagem[aba.chave] = filtrarLinhasDeSeguro(linhas, { ...filtros, estado: aba.chave }).length;
  }
  contagem.TODAS = filtrarLinhasDeSeguro(linhas, { ...filtros, estado: "TODAS" }).length;
  return contagem;
}

/**
 * A tabela virando as linhas do CSV.
 *
 * As células saem do núcleo (`celulasDoCsvDeSeguro`), e aqui só se converte
 * número em texto do Excel brasileiro. Duas regras separadas porque são dois
 * assuntos: o que vai em cada coluna é do domínio, e a vírgula decimal é do
 * Excel.
 */
export function linhasDoCsv(
  linhas: readonly LinhaDeSeguro[],
  justificadaPor?: ReadonlyMap<number, { texto: string }>,
): string[][] {
  return [
    [...COLUNAS_DO_CSV_DE_SEGURO],
    ...linhas.map((l) =>
      celulasDoCsvDeSeguro(
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
 * O impacto por periodicidade, escrito.
 *
 * Nunca um total único. Quando não há nada precificável, a frase é "sem impacto
 * precificável", que é diferente de "R$ 0,00" — e nesta rubrica ela é o caso
 * comum, porque três das cinco colunas são taxa fixa e não se movem.
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
