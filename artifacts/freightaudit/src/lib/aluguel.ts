import {
  ROTULO_DO_ESTADO,
  ROTULO_DO_VEREDITO_DO_ALUGUEL,
  celulasDoCsvDeAluguel,
  COLUNAS_DO_CSV_DE_ALUGUEL,
  type ConferenciaDoAluguel,
  type EstadoDaLinhaDeAluguel,
  type LinhaDeAluguel,
  type MedidaDaVariavel,
  type TotalDeAluguelDaVigencia,
  type VereditoDoAluguel,
} from "@workspace/comparison/aluguel";
import { numeroParaCsv } from "@/lib/csv";
import { formatBrl, formatNumber } from "@/lib/format";

/**
 * A metade de tela da Auditoria de Aluguel de Frota — apresentação, e só.
 *
 * A conta inteira mora em `@workspace/comparison/aluguel`, que o servidor também
 * importa: estado, diferença, variação, impacto, total mensal e a conferência da
 * parcela saem de lá, e a tela nunca refaz nenhum deles.
 *
 * A separação não é gosto: é a mesma de `lib/ipva.ts`, e nasceu do defeito que
 * ela evita — enquanto a soma morava no JSX, o cartão somava a página e a tabela
 * somava o recorte, e os dois números apareciam lado a lado discordando.
 */

/** Os três agregados que os cartões e os gráficos leem. */
export interface AgregadosDeAluguel {
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
      alugueisAlterados: number;
    };
  };
  alteracoesPorVariavel: {
    variavel: string;
    rotulo: string;
    medida: MedidaDaVariavel;
    alteracoes: number;
  }[];
  distribuicaoPorEstado: {
    estado: EstadoDaLinhaDeAluguel;
    rotulo: string;
    veiculos: number;
    fracao: number;
  }[];
}

/** O que a API de `/aluguel/comparacao` devolve. */
export interface ComparacaoDeAluguel extends AgregadosDeAluguel {
  changeSetId: string;
  base: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  comparada: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  /**
   * Os mesmos agregados, um por tipo — calculados no servidor.
   *
   * "Veículos comparados" sai do acervo (`frotaPorTipo`) e não da lista de
   * alterações, porque um veículo em que nada mudou não produz linha nenhuma — e
   * nesta rubrica a maioria não muda.
   */
  porTipo: Record<string, AgregadosDeAluguel>;
  linhas: LinhaDeAluguel[];
}

/** O que a API de `/aluguel/totais` devolve: as duas leituras da mesma linha. */
export interface TotaisDeAluguel {
  totais: TotalDeAluguelDaVigencia[];
  conferencias: ConferenciaDoAluguel[];
}

/**
 * Um valor escrito na unidade da própria variável.
 *
 * Nesta rubrica as duas variáveis da tabela são dinheiro — mas a função continua
 * recebendo `medida` e não assume: é a mesma assinatura das outras telas, e o
 * dia em que entrar aqui um prazo de contrato em meses, ele sai escrito como
 * meses em vez de virar "R$ 24,00".
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
 * A cor de um número que subiu ou desceu — **a régua é o sinal, e é uma só**.
 *
 * Positivo é ganho e sai em verde; negativo é perda e sai em vermelho. É a
 * mesma régua do FINAME, do IPVA, do lucro fixo, do seguro e do Monitor Custo
 * Fixo — e a que `docs/PROVA-DA-EVOLUCAO-DE-FINAME.md` fixou para o produto
 * inteiro.
 *
 * Houve aqui a régua inversa, pela leitura de que o aluguel é o que a operação
 * **paga** e um aluguel que sobe é despesa que sobe. Ela foi removida pela
 * mesma razão que saiu do FINAME e do Monitor: o aluguel é linha da tabela de
 * frete, e o que a coluna mede é quanto entra por aquele implemento. Com a
 * régua invertida, a mesma alteração aparecia verde no Monitor — que consolida
 * esta rubrica — e vermelha aqui: a cor contradizendo a cor, sobre o mesmo
 * número. `lib/__tests__/uma-regua-so-para-o-dinheiro.test.ts` prende as doze
 * telas de uma vez.
 */
export function corDaDiferenca(
  diferenca: number | null,
  medida: MedidaDaVariavel,
): string {
  if (diferenca === null || diferenca === 0 || medida !== "DINHEIRO") return "";
  return diferenca > 0 ? "text-success" : "text-destructive";
}

/** O selo de cada estado. Cor **e** texto — nunca só a cor. */
export const SELO_DO_ESTADO: Record<EstadoDaLinhaDeAluguel, string> = {
  SEM_ALTERACAO: "bg-muted text-muted-foreground",
  ALTERADO: "bg-warning/15 text-warning-foreground",
  NOVO_NA_VIGENCIA: "bg-success/15 text-success",
  AUSENTE_NA_COMPARADA: "bg-destructive/15 text-destructive",
  DADO_INCOMPLETO: "bg-muted text-muted-foreground",
  CONFLITO: "bg-destructive/15 text-destructive",
};

/**
 * O selo de cada veredito da conferência.
 *
 * `ALUGUEL_INTEGRAL` é verde: a parcela é o aluguel, a identidade fecha, e não
 * há nada a investigar. `MISTO` é a cor mais grave dos quatro — um implemento
 * que declarasse aluguel e financiamento ao mesmo tempo quebraria a leitura de
 * qualquer total desta casa.
 */
export const SELO_DO_VEREDITO: Record<VereditoDoAluguel, string> = {
  ALUGUEL_INTEGRAL: "bg-success/15 text-success",
  MISTO: "bg-destructive/15 text-destructive",
  SEM_ALUGUEL: "bg-muted text-muted-foreground",
  BASE_INSUFICIENTE: "bg-muted text-muted-foreground",
};

export { ROTULO_DO_ESTADO, ROTULO_DO_VEREDITO_DO_ALUGUEL };

/** Os estados que a fileira de abas oferece, na ordem em que a tela os lê. */
export const ABAS_DE_ESTADO: {
  chave: "TODAS" | EstadoDaLinhaDeAluguel;
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

export interface FiltrosDeAluguel {
  busca: string;
  tipo: string;
  variavel: string;
  estado: "TODAS" | EstadoDaLinhaDeAluguel;
  /**
   * Só os implementos que declaram aluguel.
   *
   * É o filtro que esta tela não pode não ter: a frota alugada é uma minoria
   * dentro da frota lida, e sem ele a lista mistura as placas que interessam com
   * as dezenas que só têm a parcela FINAME do financiamento delas.
   */
  soAlugados: boolean;
}

/**
 * O estado inicial — e `soAlugados` nasce **ligado**.
 *
 * É a única tela do Custo Fixo que abre filtrada, e o print explicou por quê:
 * com ele desligado, a tabela desta unidade abria com 69 carretas declarando
 * "R$ 0,00 · R$ 0,00" e as duas alugadas perdidas no meio. A pergunta da tela é
 * a frota alugada; mostrar a frota inteira por padrão enterra a resposta.
 *
 * Desligá-lo mostra o acervo todo, e o contador ao lado do interruptor diz
 * quantos implementos alugados existem — de modo que a filtragem nunca é
 * silenciosa.
 */
export const FILTROS_VAZIOS: FiltrosDeAluguel = {
  busca: "",
  tipo: "TODOS",
  variavel: "TODAS",
  estado: "TODAS",
  soAlugados: true,
};

/** Um texto do acervo virando número; nulo e lixo continuam nulos, nunca zero. */
function numero(valor: string | null): number | null {
  if (valor === null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * Esta linha é de um implemento que declara aluguel?
 *
 * Olha as duas pontas: uma placa que **deixou** de ter aluguel continua sendo
 * assunto desta tela, e escondê-la sob o filtro faria sumir justamente a
 * alteração mais cara que a rubrica pode ter.
 */
function temAluguel(l: LinhaDeAluguel): boolean {
  if (l.variavel !== "aluguel" && l.variavel !== "aluguel_cavalo") return false;
  return (numero(l.base) ?? 0) > 0 || (numero(l.comparada) ?? 0) > 0;
}

/**
 * O recorte da tabela — o mesmo que alimenta a contagem das abas e o CSV.
 *
 * Uma função só, e não uma por consumidor: a aba que diz "12" e a tabela que
 * mostra 9 linhas é o defeito que aparece quando o filtro é reescrito no lugar
 * de ser reutilizado.
 *
 * `soAlugados` é o único que não é da linha, e sim da **placa**: as linhas de
 * parcela FINAME de um implemento alugado precisam sobreviver ao filtro, ou a
 * conferência que a tela existe para mostrar desaparece justamente quando
 * alguém a liga.
 */
export function filtrar(
  linhas: readonly LinhaDeAluguel[],
  filtros: FiltrosDeAluguel,
): LinhaDeAluguel[] {
  const busca = filtros.busca.trim().toLowerCase();

  const placasAlugadas = new Set<string>();
  if (filtros.soAlugados) {
    for (const l of linhas) {
      if (temAluguel(l)) placasAlugadas.add(`${l.entityLabel}${l.entityType}`);
    }
  }

  return linhas.filter((l) => {
    if (filtros.estado !== "TODAS" && l.estado !== filtros.estado) return false;
    if (filtros.tipo !== "TODOS" && l.entityType !== filtros.tipo) return false;
    if (filtros.variavel !== "TODAS" && l.variavel !== filtros.variavel) return false;
    if (filtros.soAlugados && !placasAlugadas.has(`${l.entityLabel}${l.entityType}`)) {
      return false;
    }
    if (busca) {
      const alvo = `${l.entityLabel ?? ""} ${l.rotuloDaVariavel}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

/** Quantas linhas cada aba tem, contadas sobre o mesmo recorte da tabela. */
export function contagemPorAba(
  linhas: readonly LinhaDeAluguel[],
  filtros: FiltrosDeAluguel,
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
 * As células saem do núcleo (`celulasDoCsvDeAluguel`), e aqui só se converte
 * número em texto do Excel brasileiro. Duas regras separadas porque são dois
 * assuntos: o que vai em cada coluna é do domínio, e a vírgula decimal é do
 * Excel.
 */
export function linhasDoCsv(
  linhas: readonly LinhaDeAluguel[],
  justificadaPor?: ReadonlyMap<number, { texto: string }>,
): string[][] {
  return [
    [...COLUNAS_DO_CSV_DE_ALUGUEL],
    ...linhas.map((l) =>
      celulasDoCsvDeAluguel(
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
 * precificável", que é diferente de "R$ 0,00" — e nesta rubrica o balde, quando
 * existe, é sempre o mensal.
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

/** O rótulo de um tipo de equipamento, como as telas de custo fixo o escrevem. */
export const ROTULO_DO_TIPO: Record<string, string> = {
  CAVALO: "Cavalo",
  CARRETA: "Carreta",
};
