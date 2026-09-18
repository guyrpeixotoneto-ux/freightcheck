import {
  ROTULO_DO_ESTADO,
  ROTULO_DO_VEREDITO_DA_ENTRADA,
  celulasDoCsvDeAquisicao,
  COLUNAS_DO_CSV_DE_AQUISICAO,
  type ConferenciaDaEntrada,
  type EstadoDaLinhaDeAquisicao,
  type LinhaDeAquisicao,
  type MedidaDaVariavel,
  type PapelNaAquisicao,
  type ResultadoDaCoerencia,
  type TotalDeAquisicaoDaVigencia,
  type VereditoDaEntrada,
  FILTROS_DE_AQUISICAO_VAZIOS,
  filtrarLinhasDeAquisicao,
  type FiltrosDeAquisicao,
} from "@workspace/comparison/aquisicao";
import { contarVeiculos } from "@workspace/comparison/agrupamento-por-veiculo";
import { numeroParaCsv } from "@/lib/csv";
import { formatBrl, formatNumber } from "@/lib/format";

/**
 * A metade de tela da Auditoria de Aquisição — apresentação, e só.
 *
 * A conta inteira mora em `@workspace/comparison/aquisicao`, que o servidor
 * também importa: estado, diferença, variação, impacto, o total de nota, a
 * conferência da entrada e a coerência do cadastro saem de lá, e a tela nunca
 * refaz nenhum deles.
 *
 * O que este arquivo acrescenta é o que é genuinamente de apresentação — e aqui
 * ele carrega um peso que as outras telas de custo fixo não têm: **três unidades
 * na mesma coluna de valores**. `665.929,99` é dinheiro, `20` é percentual e
 * `2021-01-01T12:00:00Z` é data. Formatar tudo igual escreveria "R$ 20,00" onde
 * a fonte disse vinte por cento — e quem lê acredita.
 */

/**
 * Os três agregados que os cartões e os gráficos leem.
 *
 * Tipo próprio porque vem três vezes na mesma resposta: uma para a comparação
 * inteira e uma por tipo de equipamento (`porTipo`), que é o que as abas Cavalo
 * e Carreta mostram.
 */
export interface AgregadosDeAquisicao {
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
      /** Sempre vazio nesta rubrica — ver `impactoDeAquisicao`, no núcleo. */
      porPeriodicidade: Record<string, number>;
      foraDaSoma: number;
      notasAlteradas: number;
      valoresNegativos: number;
    };
  };
  alteracoesPorVariavel: {
    variavel: string;
    rotulo: string;
    medida: MedidaDaVariavel;
    alteracoes: number;
  }[];
  distribuicaoPorEstado: {
    estado: EstadoDaLinhaDeAquisicao;
    rotulo: string;
    veiculos: number;
    fracao: number;
  }[];
}

/** O que a API de `/aquisicao/comparacao` devolve. */
export interface ComparacaoDeAquisicao extends AgregadosDeAquisicao {
  changeSetId: string;
  base: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  comparada: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  /**
   * Os mesmos agregados, um por tipo — calculados no servidor.
   *
   * "Veículos comparados" sai do acervo (`frotaPorTipo`) e não da lista de
   * alterações, porque um veículo em que nada mudou não produz linha nenhuma —
   * e nesta rubrica **ninguém** muda.
   */
  porTipo: Record<string, AgregadosDeAquisicao>;
  linhas: LinhaDeAquisicao[];
}

/** O que a API de `/aquisicao/totais` devolve: as três leituras da mesma base. */
export interface TotaisDeAquisicao {
  totais: TotalDeAquisicaoDaVigencia[];
  entrada: ConferenciaDaEntrada[];
  coerencia: ResultadoDaCoerencia;
}

/**
 * Uma data do acervo escrita como quem lê a espera.
 *
 * A fonte entrega ISO com fuso (`2021-01-01T12:00:00Z`), e a tabela do Freightech
 * mostra dia/mês/ano. Uma data ilegível volta como veio, e não como "Invalid
 * Date": o texto cru é feio e verdadeiro, e a palavra em inglês é só feia.
 *
 * Lida em **UTC**, e não no fuso de quem abre a tela — `2021-01-01T00:00:00Z`
 * no Brasil viraria 31/12/2020, e a tela mostraria um ano diferente do que a
 * coluna `ano` declara, inventando uma divergência que o dado não tem.
 */
export function escreverData(valor: string | null): string {
  if (valor === null || valor === "") return "—";
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return valor;
  const dia = String(data.getUTCDate()).padStart(2, "0");
  const mes = String(data.getUTCMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${data.getUTCFullYear()}`;
}

/** Os doze meses, para escrever o mês de entrada por extenso. */
const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/**
 * Um valor escrito na unidade da própria variável.
 *
 * `MESES` aqui **não é duração**: é o mês do ano em que o ativo entrou. Escrever
 * "8 meses" onde a fonte disse agosto é o erro que a mistura de unidades desta
 * tela convida a cometer, e é por isso que esta rubrica trata o caso à parte em
 * vez de herdar o texto das outras.
 */
export function escreverValor(valor: string | null, medida: MedidaDaVariavel): string {
  if (valor === null || valor === "") return "—";
  if (medida === "DATA") return escreverData(valor);
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return valor;
  switch (medida) {
    case "DINHEIRO":
      return formatBrl(numero);
    case "PERCENTUAL":
      return `${formatNumber(numero, 2)}%`;
    case "MESES":
      return MESES[numero - 1] ?? formatNumber(numero, 0);
    case "ANO":
      return formatNumber(numero, 0);
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
 *
 * Data não recebe diferença nenhuma. Um par de datas não subtrai em reais nem em
 * pontos percentuais, e "+1" onde a entrada mudou de janeiro para fevereiro
 * diria uma grandeza que não existe.
 */
export function escreverDiferenca(
  diferenca: number | null,
  medida: MedidaDaVariavel,
): string {
  if (diferenca === null || medida === "DATA") return "—";
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
 * A cor de um número que subiu ou desceu — e por que quase nada aqui é pintado.
 *
 * Nas outras quatro telas do Custo Fixo a cor é a do bolso de quem lê: a rubrica
 * é remuneração, e subir é verde. **Aqui não há bolso.** O valor de nota não é
 * receita nem despesa do período; é o preço que o ativo teve uma vez, e uma nota
 * que "sobe" não é dinheiro entrando — é o cadastro tendo mudado, que é sempre
 * assunto e nunca boa ou má notícia.
 *
 * Então o montante recebe a cor de **aviso**, nos dois sentidos, e nada mais é
 * pintado. Pintar de verde uma nota que subiu convidaria a comemorar a única
 * coisa que esta tela existe para investigar.
 */
export function corDaDiferenca(
  diferenca: number | null,
  medida: MedidaDaVariavel,
): string {
  if (diferenca === null || diferenca === 0 || medida !== "DINHEIRO") return "";
  return "text-warning-foreground";
}

/** O selo de cada estado. Cor **e** texto — nunca só a cor. */
export const SELO_DO_ESTADO: Record<EstadoDaLinhaDeAquisicao, string> = {
  SEM_ALTERACAO: "bg-muted text-muted-foreground",
  ALTERADO: "bg-warning/15 text-warning-foreground",
  NOVO_NA_VIGENCIA: "bg-success/15 text-success",
  AUSENTE_NA_COMPARADA: "bg-destructive/15 text-destructive",
  DADO_INCOMPLETO: "bg-muted text-muted-foreground",
  CONFLITO: "bg-destructive/15 text-destructive",
};

/**
 * O selo de cada veredito da entrada.
 *
 * `CONSTANTE_DO_MODELO` é âmbar, e não verde, pela mesma razão que o
 * `FORMULA_UNICA` do IPVA é: um percentual igual em todos os ativos não é
 * conferência passando — é ninguém tendo calculado caso a caso.
 */
export const SELO_DO_VEREDITO_DA_ENTRADA: Record<VereditoDaEntrada, string> = {
  CONSTANTE_DO_MODELO: "bg-warning/15 text-warning-foreground",
  POR_ATIVO: "bg-success/15 text-success",
  AUSENTE: "bg-destructive/15 text-destructive",
  BASE_INSUFICIENTE: "bg-muted text-muted-foreground",
};

/** Como a tela escreve o papel de cada coluna, curto. */
export const ROTULO_DO_PAPEL: Record<PapelNaAquisicao, string> = {
  MONTANTE: "Montante",
  ALIQUOTA: "Alíquota",
  CADASTRO: "Cadastro",
};

/** A unidade de cada papel, para o aviso ao lado do nome da variável. */
export const UNIDADE_DO_PAPEL: Record<PapelNaAquisicao, string> = {
  MONTANTE: "R$",
  ALIQUOTA: "%",
  CADASTRO: "—",
};

export { ROTULO_DO_ESTADO, ROTULO_DO_VEREDITO_DA_ENTRADA };

/** Os estados que a fileira de abas oferece, na ordem em que a tela os lê. */
export const ABAS_DE_ESTADO: {
  chave: "TODAS" | EstadoDaLinhaDeAquisicao;
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

/**
 * Os filtros e o recorte — **do núcleo**.
 *
 * Os dois nasceram aqui, e era o lugar certo enquanto o recorte só produzia uma
 * tabela. Deixou de ser quando a justificativa em lote passou a poder dizer
 * "todos os resultados deste filtro": ali o cliente manda o filtro, e quem
 * reabre o universo para gravar é o servidor — que não importa a tela.
 *
 * Então eles moram em `@workspace/comparison/aquisicao`, com as contas, e esta
 * linha é o que resta do que este arquivo tinha. Os nomes de fora continuam os
 * mesmos de propósito: a tela chama `filtrar`, e nenhuma delas precisou mudar.
 */
export {
  FILTROS_DE_AQUISICAO_VAZIOS as FILTROS_VAZIOS,
  filtrarLinhasDeAquisicao as filtrar,
  type FiltrosDeAquisicao as FiltrosDeAquisicao,
};

/**
 * Quantos **veículos** cada aba tem, contados sobre o mesmo recorte da tabela.
 *
 * Veículos, e não linhas, desde que a tabela passou a listar placas: a aba e o
 * rodapé contam o que a tela de fato desenha, e o número da aba é o número de
 * linhas que o clique abre. Contando alterações, "Alterados (22)" abria uma
 * tabela de dez placas — com o cartão "Veículos com alteração" dizendo 10 dois
 * centímetros acima. A régua é uma só: {@link contarVeiculos}, a mesma que o
 * agrupamento usa para montar as linhas.
 *
 * As abas podem somar mais do que "Todas": a placa com uma variável alterada e
 * outra em conflito aparece nas duas, e uma vez só na tabela inteira.
 */
export function contagemPorAba(
  linhas: readonly LinhaDeAquisicao[],
  filtros: FiltrosDeAquisicao,
): Record<string, number> {
  const contagem: Record<string, number> = { TODAS: 0 };
  for (const aba of ABAS_DE_ESTADO) {
    if (aba.chave === "TODAS") continue;
    contagem[aba.chave] = contarVeiculos(
      filtrarLinhasDeAquisicao(linhas, { ...filtros, estado: aba.chave }),
    );
  }
  contagem.TODAS = contarVeiculos(
    filtrarLinhasDeAquisicao(linhas, { ...filtros, estado: "TODAS" }),
  );
  return contagem;
}

/**
 * A tabela virando as linhas do CSV.
 *
 * As células saem do núcleo (`celulasDoCsvDeAquisicao`), e aqui só se converte
 * número em texto do Excel brasileiro. Duas regras separadas porque são dois
 * assuntos: o que vai em cada coluna é do domínio, e a vírgula decimal é do
 * Excel.
 */
export function linhasDoCsv(
  linhas: readonly LinhaDeAquisicao[],
  justificadaPor?: ReadonlyMap<number, { texto: string }>,
): string[][] {
  return [
    [...COLUNAS_DO_CSV_DE_AQUISICAO],
    ...linhas.map((l) =>
      celulasDoCsvDeAquisicao(
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

/** O rótulo de um tipo de equipamento, como as duas telas de custo fixo o escrevem. */
export const ROTULO_DO_TIPO: Record<string, string> = {
  CAVALO: "Cavalo",
  CARRETA: "Carreta",
};
