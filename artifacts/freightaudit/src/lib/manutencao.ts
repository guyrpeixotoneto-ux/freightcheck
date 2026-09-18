import {
  ROTULO_DA_ORIGEM,
  ROTULO_DO_ESTADO,
  celulasDoCsvDeManutencao,
  COLUNAS_DO_CSV_DE_MANUTENCAO,
  type ConferenciaDaOrigem,
  type EstadoDaLinhaDeManutencao,
  type LinhaDeManutencao,
  type MedidaDaVariavel,
  type VereditoDaOrigem,
  FILTROS_DE_MANUTENCAO_VAZIOS,
  filtrarLinhasDeManutencao,
  type FiltrosDeManutencao,
} from "@workspace/comparison/manutencao";
import { contarVeiculos } from "@workspace/comparison/agrupamento-por-veiculo";
import { numeroParaCsv } from "@/lib/csv";
import { formatBrl, formatNumber } from "@/lib/format";

/**
 * A metade de tela da Auditoria de Manutenção — apresentação, e só.
 *
 * A conta inteira mora em `@workspace/comparison/manutencao`, que o servidor
 * também importa. O que este arquivo acrescenta é o que é genuinamente de
 * apresentação — e nesta rubrica isso é mais delicado do que nas outras quatro,
 * porque **a unidade muda de linha para linha**: R$/km, meses, percentual, ano,
 * quilômetro e reais convivem na mesma tabela. Uma tela que formatasse tudo como
 * dinheiro escreveria "R$ 0,34" onde a fonte disse trinta e quatro centavos por
 * quilômetro, e "R$ 59,80" onde ela disse 59,8 meses de vida útil.
 */

/** Os três agregados que os cartões e os gráficos leem. */
export interface AgregadosDeManutencao {
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
      alteracoesDeReaisKm: number;
    };
    /** O que esta tela mostra no lugar do impacto em reais. */
    reaisKm: { soma: number; veiculos: number; subiram: number; cairam: number };
  };
  alteracoesPorVariavel: {
    variavel: string;
    rotulo: string;
    medida: MedidaDaVariavel;
    alteracoes: number;
  }[];
  distribuicaoPorEstado: {
    estado: EstadoDaLinhaDeManutencao;
    rotulo: string;
    veiculos: number;
    fracao: number;
  }[];
}

export interface ComparacaoDeManutencao extends AgregadosDeManutencao {
  changeSetId: string;
  base: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  comparada: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  /** Os mesmos agregados, um por tipo — calculados no servidor. */
  porTipo: Record<string, AgregadosDeManutencao>;
  linhas: LinhaDeManutencao[];
}

/** O que a API de `/manutencao/totais` devolve: as duas séries da mesma leitura. */
export interface TotaisDeManutencao {
  totais: {
    ponta: "BASE" | "COMPARADA";
    entityType: string;
    mediaReaisKm: number;
    mediaBid: number;
    veiculos: number;
    zerados: number;
    comContrato: number;
  }[];
  origens: ConferenciaDaOrigem[];
}

/**
 * Um valor escrito na unidade da própria variável.
 *
 * ---------------------------------------------------------------------------
 * As duas unidades que só existem aqui
 * ---------------------------------------------------------------------------
 * **R$/km sai com quatro casas, e não com duas.** O acervo publica 0,16 a 0,54,
 * e um reajuste de manutenção mexe na terceira casa: escrever "R$ 0,34/km" onde
 * o valor é 0,3425 esconde justamente a parte que se move. É a mesma razão pela
 * qual a alíquota do IPVA sai com três casas — a casa a mais é o achado.
 *
 * **Quilômetro sai inteiro e com separador.** Um odômetro de 544.061 escrito
 * como "544061" é ilegível numa coluna, e escrito como "R$ 544.061,00" é pior.
 */
export function escreverValor(valor: string | null, medida: MedidaDaVariavel): string {
  if (valor === null || valor === "") return "—";
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return valor;
  switch (medida) {
    case "DINHEIRO":
      return formatBrl(numero);
    case "REAIS_POR_KM":
      return `${escreverReaisPorKm(numero)}/km`;
    case "PERCENTUAL":
      return `${formatNumber(numero, 2)}%`;
    case "MESES":
      return `${formatNumber(numero, 1)} ${numero === 1 ? "mês" : "meses"}`;
    case "DISTANCIA":
      return `${formatNumber(numero, 0)} km`;
    case "ANO":
      return formatNumber(numero, 0);
    case "DATA":
      return valor;
    default:
      return valor;
  }
}

/**
 * Um R$/km escrito com quatro casas obrigatórias.
 *
 * Não usa `formatNumber` porque aquele corta o zero à direita: R$ 0,3400/km
 * sairia dele como "R$ 0,34/km", e a diferença entre 0,34 e 0,3400 é justamente
 * a que diz se o número foi arredondado ou medido. A mesma doutrina de
 * `escreverAliquota`, em `lib/ipva.ts`.
 */
export function escreverReaisPorKm(valor: number): string {
  const escrito = valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
  return `R$ ${escrito}`;
}

/**
 * A diferença, com sinal explícito e na unidade certa.
 *
 * O sinal vem escrito mesmo quando é positivo: numa coluna em que metade das
 * linhas sobe e metade desce, "0,34" e "−0,34" a três linhas de distância se
 * confundem, e "+0,34" não se confunde com nada.
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
      return `${sinal}${escreverReaisPorKm(absoluto)}/km`;
    case "PERCENTUAL":
      return `${sinal}${formatNumber(absoluto, 2)} p.p.`;
    case "MESES":
      return `${sinal}${formatNumber(absoluto, 1)}`;
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
 * A manutenção desta tela é **rubrica remunerada na tabela de frete**, e não a
 * oficina que a transportadora paga. Um R$/km que cai para zero não é economia:
 * é a rubrica deixando de ser paga, e quem opera perdeu dinheiro. Então subir é
 * verde e descer é vermelho, a mesma régua do FINAME, do IPVA, do lucro fixo e
 * do seguro.
 *
 * **A cor vale para dinheiro e para R$/km, e para mais nada.** Vida em meses,
 * percentual de reajuste, ano e odômetro não têm lado bom: pintá-los afirmaria
 * um juízo que esta tela não tem como sustentar — um contrato com mais meses de
 * vida útil não é melhor nem pior, é outro contrato.
 */
export function corDaDiferenca(
  diferenca: number | null,
  medida: MedidaDaVariavel,
): string {
  if (diferenca === null || diferenca === 0) return "";
  if (medida !== "DINHEIRO" && medida !== "REAIS_POR_KM") return "";
  return diferenca > 0 ? "text-success" : "text-destructive";
}

/** O selo de cada estado. Cor **e** texto — nunca só a cor. */
export const SELO_DO_ESTADO: Record<EstadoDaLinhaDeManutencao, string> = {
  SEM_ALTERACAO: "bg-muted text-muted-foreground",
  ALTERADO: "bg-warning/15 text-warning-foreground",
  NOVO_NA_VIGENCIA: "bg-success/15 text-success",
  AUSENTE_NA_COMPARADA: "bg-destructive/15 text-destructive",
  DADO_INCOMPLETO: "bg-muted text-muted-foreground",
  CONFLITO: "bg-destructive/15 text-destructive",
};

/** O selo de cada veredito da origem do R$/km. */
export const SELO_DA_ORIGEM: Record<VereditoDaOrigem, string> = {
  DO_CONTRATO: "bg-success/15 text-success",
  DO_BID: "bg-success/15 text-success",
  NAO_EXPLICADO: "bg-destructive/15 text-destructive",
  MISTO: "bg-warning/15 text-warning-foreground",
  BASE_INSUFICIENTE: "bg-muted text-muted-foreground",
};

export { ROTULO_DO_ESTADO, ROTULO_DA_ORIGEM };

/** Os estados que a fileira de abas oferece, na ordem em que a tela os lê. */
export const ABAS_DE_ESTADO: {
  chave: "TODAS" | EstadoDaLinhaDeManutencao;
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
 * Então eles moram em `@workspace/comparison/manutencao`, com as contas, e esta
 * linha é o que resta do que este arquivo tinha. Os nomes de fora continuam os
 * mesmos de propósito: a tela chama `filtrar`, e nenhuma delas precisou mudar.
 */
export {
  FILTROS_DE_MANUTENCAO_VAZIOS as FILTROS_VAZIOS,
  filtrarLinhasDeManutencao as filtrar,
  type FiltrosDeManutencao as FiltrosDeManutencao,
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
  linhas: readonly LinhaDeManutencao[],
  filtros: FiltrosDeManutencao,
): Record<string, number> {
  const contagem: Record<string, number> = { TODAS: 0 };
  for (const aba of ABAS_DE_ESTADO) {
    if (aba.chave === "TODAS") continue;
    contagem[aba.chave] = contarVeiculos(
      filtrarLinhasDeManutencao(linhas, { ...filtros, estado: aba.chave }),
    );
  }
  contagem.TODAS = contarVeiculos(
    filtrarLinhasDeManutencao(linhas, { ...filtros, estado: "TODAS" }),
  );
  return contagem;
}

/**
 * A tabela virando as linhas do CSV.
 *
 * As células saem do núcleo (`celulasDoCsvDeManutencao`) — inclusive a coluna
 * **Unidade**, que só o CSV desta rubrica tem —, e aqui só se converte número em
 * texto do Excel brasileiro.
 */
export function linhasDoCsv(
  linhas: readonly LinhaDeManutencao[],
  justificadaPor?: ReadonlyMap<number, { texto: string }>,
): string[][] {
  return [
    [...COLUNAS_DO_CSV_DE_MANUTENCAO],
    ...linhas.map((l) =>
      celulasDoCsvDeManutencao(
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
 * A variação do R$/km escrita — o que esta tela tem no lugar do impacto.
 *
 * Ela é dita na unidade em que foi medida, e o líquido vem acompanhado de
 * quantos subiram e quantos caíram. Não é enfeite: no acervo há uma comparação
 * em que dois caminhões foram de R$ 0,40/km para zero e outros dois de zero para
 * R$ 0,40/km — líquido exatamente zero, e quatro contratos mexidos. Um cartão
 * que mostrasse só o líquido diria que nada aconteceu.
 */
export function escreverVariacaoDoReaisKm(reaisKm: {
  soma: number;
  veiculos: number;
  subiram: number;
  cairam: number;
}): { valor: string; detalhe: string } {
  const sinal = reaisKm.soma > 0 ? "+" : reaisKm.soma < 0 ? "−" : "";
  const valor = `${sinal}${escreverReaisPorKm(Math.abs(reaisKm.soma))}/km`;
  if (reaisKm.veiculos === 0) {
    return { valor, detalhe: "nenhum caminhão mudou de R$/km" };
  }
  const partes = [
    `${formatNumber(reaisKm.subiram, 0)} ${reaisKm.subiram === 1 ? "subiu" : "subiram"}`,
    `${formatNumber(reaisKm.cairam, 0)} ${reaisKm.cairam === 1 ? "caiu" : "caíram"}`,
  ];
  return {
    valor,
    detalhe: `${formatNumber(reaisKm.veiculos, 0)} ${
      reaisKm.veiculos === 1 ? "caminhão" : "caminhões"
    } · ${partes.join(" · ")}`,
  };
}

/**
 * O impacto por periodicidade, escrito.
 *
 * Nesta rubrica ele costuma vir vazio, e a frase é "sem impacto precificável" —
 * que é diferente de "R$ 0,00". R$/km não é dinheiro até ser multiplicado por
 * quilômetro rodado, e essa multiplicação não mora aqui. O número que a tela
 * publica no lugar é {@link escreverVariacaoDoReaisKm}.
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
