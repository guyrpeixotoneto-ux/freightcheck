import {
  ROTULO_DO_ESTADO,
  celulasDoCsv,
  COLUNAS_DO_CSV,
  type EstadoDaLinhaDeFiname,
  type LinhaDeFiname,
  type MedidaDaVariavel,
  FILTROS_DE_FINAME_VAZIOS,
  filtrarLinhasDeFiname,
  type FiltrosDeFiname,
} from "@workspace/comparison/finame";
import { contarVeiculos } from "@workspace/comparison/agrupamento-por-veiculo";
import type { EvolucaoDoTipo } from "@workspace/comparison/finame";
import type { RecorteDeTipo } from "@/components/comparacao/recorte-de-equipamento";
import {
  ehModoDaAuditoria,
  trocaNaRota,
  type ModoDaAuditoria,
} from "./modo-da-auditoria";
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
/**
 * Os três agregados que os cartões e os gráficos leem.
 *
 * Existe como tipo próprio porque agora vem **quatro vezes** na mesma resposta:
 * uma para a comparação inteira e uma por tipo de equipamento (`porTipo`), que
 * é o que as abas Cavalo e Carreta mostram. Escrito uma vez, ele garante que a
 * aba e o total tenham a mesma forma — e a mesma forma é o que permite a tela
 * trocar de recorte sem trocar de código.
 */
export interface AgregadosDeFiname {
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
      /**
       * O que a parcela moveu e outro módulo soma — a diferença entre o cartão
       * de impacto e o painel da evolução, escrita.
       */
      porOutroModulo: Record<string, number>;
      /** Linhas fora do total por serem rubrica de outro módulo — base e tributos. */
      foraDaSoma: number;
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
}

export interface ComparacaoDeFiname extends AgregadosDeFiname {
  changeSetId: string;
  base: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  comparada: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  /**
   * Os mesmos agregados, um por tipo — calculados no servidor.
   *
   * Não é a tela que os recompõe a partir de `linhas`: "veículos comparados"
   * sai do acervo (`frotaPorTipo`, em `query.ts`) e não da lista de alterações,
   * porque um veículo em que nada mudou não produz linha nenhuma. Uma aba que
   * contasse a lista diria zero comparados sobre uma frota inteira parada.
   */
  porTipo: Record<string, AgregadosDeFiname>;
  linhas: LinhaDeFiname[];
}

export interface TotaisDeFiname {
  totais: {
    ponta: "BASE" | "COMPARADA";
    entityType: string;
    total: number;
    veiculos: number;
  }[];
  /**
   * A mesma leitura, aberta nas três parcelas que produzem a diferença.
   *
   * Vem do servidor junto dos totais, e não de uma conta na tela, pela regra
   * desta casa: a decomposição e o total que ela explica têm de sair da mesma
   * leitura, ou a tela mostra duas versões da mesma diferença.
   */
  evolucao: EvolucaoDoTipo[];
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

/**
 * O período do financiamento, escrito — `60` vira `60 meses`.
 *
 * A mesma régua de {@link escreverValor} para a medida `MESES`, e não uma
 * segunda: a coluna "Período FINAME" e a linha "Prazo" mostram o mesmo campo do
 * mesmo veículo, e escrevê-lo de dois jeitos na mesma tela seria convidar a
 * dúvida sobre se são o mesmo número.
 */
export function escreverPeriodo(periodo: string | null): string {
  return escreverValor(periodo, "MESES");
}

/**
 * A data de cadastro, escrita — `2019-05-10` vira `10/05/2019`.
 *
 * A fonte entrega a data em ISO, e a planilha do cliente a lê em dia/mês/ano.
 * Uma data que não chega em ISO sai como veio: inventar um formato sobre um
 * texto que não se entendeu seria trocar um dado bruto legível por um palpite.
 */
export function escreverDataDeCadastro(data: string | null): string {
  if (data === null || data === "") return "—";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(data);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : data;
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
 * O FINAME desta tela é **parcela remunerada na tabela de frete**, não a conta
 * que a transportadora paga ao banco. Uma parcela que cai para R$ 0,00 não é
 * economia: é a rubrica deixando de ser paga, e quem opera perdeu dinheiro.
 * Então **descer é vermelho e subir é verde**, a mesma régua do lucro fixo e do
 * IPVA — as três rubricas são remuneração, e a cor é a do bolso de quem lê.
 *
 * Mas prazo, ano e data não têm lado bom, e pintá-los de verde e vermelho
 * afirmaria um juízo que esta tela não tem como sustentar. Então a cor só
 * aparece em dinheiro; o resto fica na tinta normal, e o sinal diz tudo o que há
 * para dizer.
 */
export function corDaDiferenca(
  diferenca: number | null,
  medida: MedidaDaVariavel,
): string {
  if (diferenca === null || diferenca === 0 || medida !== "DINHEIRO") return "";
  return diferenca > 0 ? "text-success" : "text-destructive";
}

/**
 * O tipo de equipamento, escrito.
 *
 * Exportado, e não repetido em cada componente, porque o painel da Evolução e
 * a gaveta de detalhe mostram o mesmo campo do mesmo veículo na mesma tela:
 * dois mapas seriam duas chances de a mesma placa ser "Cavalo" no painel e
 * "CAVALO" na gaveta.
 */
export const ROTULO_DO_TIPO: Record<string, string> = {
  CAVALO: "Cavalo",
  CARRETA: "Carreta",
};

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

/**
 * Os filtros e o recorte — **do núcleo**.
 *
 * Os dois nasceram aqui, e era o lugar certo enquanto o recorte só produzia uma
 * tabela. Deixou de ser quando a justificativa em lote passou a poder dizer
 * "todos os resultados deste filtro": ali o cliente manda o filtro, e quem
 * reabre o universo para gravar é o servidor — que não importa a tela.
 *
 * Então eles moram em `@workspace/comparison/finame`, com as contas, e esta
 * linha é o que resta do que este arquivo tinha. Os nomes de fora continuam os
 * mesmos de propósito: a tela chama `filtrar`, e nenhuma delas precisou mudar.
 */
export {
  FILTROS_DE_FINAME_VAZIOS as FILTROS_VAZIOS,
  filtrarLinhasDeFiname as filtrar,
  type FiltrosDeFiname as FiltrosDeFiname,
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
  linhas: readonly LinhaDeFiname[],
  filtros: FiltrosDeFiname,
): Record<string, number> {
  const contagem: Record<string, number> = { TODAS: 0 };
  for (const aba of ABAS_DE_ESTADO) {
    if (aba.chave === "TODAS") continue;
    contagem[aba.chave] = contarVeiculos(
      filtrarLinhasDeFiname(linhas, { ...filtros, estado: aba.chave }),
    );
  }
  contagem.TODAS = contarVeiculos(filtrarLinhasDeFiname(linhas, { ...filtros, estado: "TODAS" }));
  return contagem;
}

/**
 * A tabela virando as linhas do CSV.
 *
 * As células saem do núcleo (`celulasDoCsv`), e aqui só se converte número em
 * texto do Excel brasileiro. Duas regras separadas porque são dois assuntos: o
 * que vai em cada coluna é do domínio, e a vírgula decimal é do Excel.
 */
export function linhasDoCsv(
  linhas: readonly LinhaDeFiname[],
  justificadaPor?: ReadonlyMap<number, { texto: string }>,
): string[][] {
  return [
    [...COLUNAS_DO_CSV],
    ...linhas.map((l) =>
      celulasDoCsv(
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

// ---------------------------------------------------------------------------
// O par de vigências — qual unidade, e quais duas pontas
// ---------------------------------------------------------------------------
//
// As três funções deste bloco — `vigenciasDaUnidade`, `parDePartida` e
// `rotulosDasVigencias` — mudaram de endereço para
// `@workspace/comparison/recorte-de-rubrica` no dia em que a segunda tela de
// rubrica passou a escolher um par de vigências. Elas nunca souberam nada sobre
// financiamento: eram genéricas desde que nasceram, e morar no arquivo de uma
// rubrica só era o acidente de terem nascido junto com a primeira.
//
// O que elas resolvem é caro demais para existir em duas versões: sem o
// `scopeHash` no par, a tela abre **recusada** — este acervo tem seis vigências
// × cinco unidades com o mesmo rótulo e a mesma data, e o motor recusa comparar
// escopos diferentes. Uma cópia por rubrica levaria a segunda tela a repetir,
// inteiro, o defeito que a primeira já pagou para descobrir.

// ---------------------------------------------------------------------------
// O modo de leitura — comparação entre duas vigências, ou evolução no ano
// ---------------------------------------------------------------------------

/**
 * Os dois modos, o ano e o endereço — tudo isto mora agora em
 * `modo-da-auditoria.ts`, com as outras três rubricas de custo fixo.
 *
 * Saiu daqui quando IPVA, Lucro Fixo e Impostos ganharam a mesma aba Evolução:
 * nada nestas funções é de financiamento, e quatro cópias seriam quatro
 * definições de "o ano" livres para divergir. Os nomes continuam sendo
 * exportados por este módulo — já amarrados à rota do FINAME —, e quem importava
 * de `@/lib/finame` não mudou uma linha.
 */
export {
  anosDasVigencias,
  ehRecorteDeTipo,
  pontasDoAno,
  type ModoDaAuditoria,
} from "./modo-da-auditoria";

/** Os dois modos da Auditoria de FINAME. Os mesmos das telas irmãs. */
export type ModoDeFiname = ModoDaAuditoria;

/** O modo que veio do endereço — endereço adulterado cai na comparação. */
export function ehModoDeFiname(valor: string | null | undefined): valor is ModoDeFiname {
  return ehModoDaAuditoria(valor);
}

/** A rota da Auditoria de FINAME — uma só, para os dois modos. */
export const ROTA_DO_FINAME = "/custo-fixo-finame";

/** O endereço depois de uma troca, sem tocar no que não foi pedido. */
export const enderecoComTroca = trocaNaRota(ROTA_DO_FINAME);
