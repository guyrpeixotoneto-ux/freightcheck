import {
  DIRECAO_ECONOMICA,
  ROTULO_DO_ESTADO,
  celulasDoCsvDeLucroFixo,
  COLUNAS_DO_CSV_DE_LUCRO_FIXO,
  type Coexistencia,
  type EstadoDaLinhaDeLucroFixo,
  type LinhaDeLucroFixo,
  type MedidaDaVariavel,
  type ViradaDeCiclo,
  FILTROS_DE_LUCRO_FIXO_VAZIOS,
  filtrarLinhasDeLucroFixo,
  type FiltrosDeLucroFixo,
} from "@workspace/comparison/lucro-fixo";
import { contarVeiculos } from "@workspace/comparison/agrupamento-por-veiculo";
import { numeroParaCsv } from "@/lib/csv";
import { formatBrl, formatNumber } from "@/lib/format";

/**
 * A metade de tela da Auditoria de Lucro Fixo — apresentação, e só.
 *
 * A conta inteira mora em `@workspace/comparison/lucro-fixo`, que o servidor
 * também importa: estado, diferença, variação, impacto, viradas de ciclo,
 * coexistências e agregados saem de lá, e a tela nunca refaz nenhum deles.
 *
 * O que este arquivo acrescenta é apresentação — e, nesta rubrica, uma decisão
 * que não é só apresentação disfarçada: **a cor.** Ver {@link corDaDiferenca}.
 */

/** O que a API de `/lucro-fixo/comparacao` devolve. */
/**
 * Os três agregados que os cartões e os gráficos leem.
 *
 * Tipo próprio porque agora vem quatro vezes na mesma resposta: uma para a
 * comparação inteira e uma por tipo de equipamento (`porTipo`), que é o que as
 * abas Cavalo e Carreta mostram. A mesma forma nos dois é o que permite a tela
 * trocar de recorte sem trocar de código.
 */
export interface AgregadosDeLucroFixo {
  resumo: {
    veiculosComparados: number;
    semAlteracao: number;
    veiculosComAlteracao: number;
    novosNaVigencia: number;
    ausentesNaComparada: number;
    variaveisAlteradas: number;
    veiculosComDadoIncompleto: number;
    veiculosComConflito: number;
    entraramNoSegundoCiclo: number;
    voltaramAoPrimeiroCiclo: number;
    impacto: {
      porPeriodicidade: Record<string, number>;
      naoCalculavel: number;
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
    estado: EstadoDaLinhaDeLucroFixo;
    rotulo: string;
    veiculos: number;
    fracao: number;
  }[];
}

export interface ComparacaoDeLucroFixo extends AgregadosDeLucroFixo {
  changeSetId: string;
  base: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  comparada: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  /**
   * Os mesmos agregados, um por tipo — calculados no servidor.
   *
   * Não é a tela que os recompõe a partir de `linhas`: "veículos comparados"
   * sai do acervo (`frotaPorTipo`, em `query.ts`) e não da lista de alterações,
   * porque um veículo em que nada mudou não produz linha nenhuma.
   */
  porTipo: Record<string, AgregadosDeLucroFixo>;
  linhas: LinhaDeLucroFixo[];
}

/** O que a API de `/lucro-fixo/totais` devolve: as duas séries da mesma leitura. */
export interface TotaisDeLucroFixo {
  totais: {
    ponta: "BASE" | "COMPARADA";
    entityType: string;
    total: number;
    veiculos: number;
    noSegundoCiclo: number;
  }[];
  coexistencias: Coexistencia[];
}

export type { ViradaDeCiclo };

/**
 * Um valor escrito na unidade da própria variável.
 *
 * O ciclo sai como "Ciclo 2", e não como "2": o número sozinho, numa coluna ao
 * lado de reais e de anos, não diz o que é. É a razão de `CICLO` existir como
 * medida em vez de o ciclo pegar carona em `ANO` — que daria o número certo sob
 * o rótulo errado.
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
    case "CICLO":
      return `Ciclo ${formatNumber(Math.trunc(numero), 0)}`;
    case "DATA":
      return valor;
    default:
      return valor;
  }
}

/**
 * A diferença, com sinal explícito e na unidade certa.
 *
 * O ciclo não ganha diferença escrita como número: "+1 ciclo" é uma frase que
 * ninguém diz, e o que interessa numa troca de ciclo é **de onde para onde**,
 * que a tabela já mostra nas duas colunas ao lado.
 */
export function escreverDiferenca(
  diferenca: number | null,
  medida: MedidaDaVariavel,
): string {
  if (diferenca === null) return "—";
  if (medida === "CICLO") return "—";
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
 * A cor de um número que subiu ou desceu — a mesma régua de FINAME e IPVA.
 *
 * A rubrica é `Receita bruta` (`DIRECAO_ECONOMICA`), e subir é **verde**: um
 * lucro fixo que cresceu é mais dinheiro entrando.
 *
 * **A amortização segue a mesma direção**, e não a régua de custo que esta
 * função já usou. Ela também é linha remunerada na tabela de frete, não a
 * prestação que a transportadora paga ao banco: uma amortização que cai é
 * rubrica deixando de ser paga — piora, e sai em vermelho. Decidir por variável
 * pintava de verde a pior notícia da tabela.
 *
 * Ciclo, ano e data continuam sem cor: eles não têm lado bom, e pintá-los
 * afirmaria um juízo que esta tela não tem como sustentar.
 */
export function corDaDiferenca(
  diferenca: number | null,
  medida: MedidaDaVariavel,
): string {
  if (diferenca === null || diferenca === 0 || medida !== "DINHEIRO") return "";
  return diferenca > 0 ? "text-success" : "text-destructive";
}

/** O selo de cada estado. Cor **e** texto — nunca só a cor. */
export const SELO_DO_ESTADO: Record<EstadoDaLinhaDeLucroFixo, string> = {
  SEM_ALTERACAO: "bg-muted text-muted-foreground",
  ALTERADO: "bg-warning/15 text-warning-foreground border border-warning/40",
  NOVO_NA_VIGENCIA: "bg-brand/10 text-brand border border-brand/25",
  AUSENTE_NA_COMPARADA: "bg-destructive/10 text-destructive border border-destructive/25",
  DADO_INCOMPLETO: "bg-muted text-muted-foreground border border-dashed border-border",
  CONFLITO: "bg-destructive/10 text-destructive border border-destructive/40",
};

/**
 * O selo do sentido de uma virada de ciclo.
 *
 * `ENTROU_NO_SEGUNDO` é verde: é o ativo que terminou de amortizar e passou a
 * ser remunerado — a virada que o modelo prevê e a boa notícia da tela.
 * `VOLTOU_AO_PRIMEIRO` é aviso, e não erro: um ativo não desamortiza, então ou
 * houve reclassificação ou houve defeito de cadastro. Chamar de erro afirmaria
 * qual dos dois, e a tela não sabe.
 */
export const SELO_DO_SENTIDO: Record<ViradaDeCiclo["sentido"], string> = {
  ENTROU_NO_SEGUNDO: "bg-success/12 text-success border border-success/25",
  VOLTOU_AO_PRIMEIRO: "bg-warning/15 text-warning-foreground border border-warning/40",
  OUTRO: "bg-muted text-muted-foreground border border-border",
};

export const ROTULO_DO_SENTIDO: Record<ViradaDeCiclo["sentido"], string> = {
  ENTROU_NO_SEGUNDO: "Terminou de amortizar",
  VOLTOU_AO_PRIMEIRO: "Voltou ao primeiro ciclo",
  OUTRO: "Outro ciclo",
};

export { ROTULO_DO_ESTADO, DIRECAO_ECONOMICA };

/** Os estados que a fileira de abas oferece, na ordem em que a tela os lê. */
export const ABAS_DE_ESTADO: {
  chave: "TODAS" | EstadoDaLinhaDeLucroFixo;
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
 * Então eles moram em `@workspace/comparison/lucro-fixo`, com as contas, e esta
 * linha é o que resta do que este arquivo tinha. Os nomes de fora continuam os
 * mesmos de propósito: a tela chama `filtrar`, e nenhuma delas precisou mudar.
 */
export {
  FILTROS_DE_LUCRO_FIXO_VAZIOS as FILTROS_VAZIOS,
  filtrarLinhasDeLucroFixo as filtrar,
  type FiltrosDeLucroFixo as FiltrosDeLucroFixo,
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
  linhas: readonly LinhaDeLucroFixo[],
  filtros: FiltrosDeLucroFixo,
  viradas: readonly ViradaDeCiclo[] = [],
): Record<string, number> {
  const contagem: Record<string, number> = { TODAS: 0 };
  for (const aba of ABAS_DE_ESTADO) {
    if (aba.chave === "TODAS") continue;
    contagem[aba.chave] = contarVeiculos(
      filtrarLinhasDeLucroFixo(linhas, { ...filtros, estado: aba.chave }, viradas),
    );
  }
  contagem.TODAS = contarVeiculos(
    filtrarLinhasDeLucroFixo(linhas, { ...filtros, estado: "TODAS" }, viradas),
  );
  return contagem;
}

/** A tabela virando as linhas do CSV. */
export function linhasDoCsv(
  linhas: readonly LinhaDeLucroFixo[],
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
    [...COLUNAS_DO_CSV_DE_LUCRO_FIXO],
    ...linhas.map((l) =>
      celulasDoCsvDeLucroFixo(
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
 * Nunca um total único. E o sinal aqui é de receita: `+` é mais dinheiro
 * entrando — o mesmo que o `+` significa nas telas de FINAME e IPVA.
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
