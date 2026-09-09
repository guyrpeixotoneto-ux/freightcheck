import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchJson } from "@/lib/api";
import { useConsultaResiliente } from "@/lib/consulta-resiliente";

/**
 * Conciliação de Chamados — as contas da tela, fora do JSX.
 *
 * A tela responde a uma pergunta só, e é a que dá nome ao módulo: **para cada
 * alteração que a planilha importada trouxe, existe o chamado que a pediu?** O
 * Monitoramento, logo acima na lateral, responde o que mudou *nos chamados*; a
 * fila de Justificativas responde por que a vigência mudou. Nenhuma das duas
 * confronta os dois lados, e é esse confronto que mora aqui.
 *
 * As contas ficam neste arquivo pelo motivo de sempre nesta casa: são números
 * entrando e saindo, e é o que permite prendê-las em teste sem montar tela
 * nenhuma. A página fica com o desenho.
 *
 * **Nada aqui inventa número.** Enquanto o resumo não chegou, os totais são
 * `null` — e não zero, que se leria como "está tudo conciliado" no meio do
 * carregamento. É a mesma escolha do Painel de Justificativas.
 *
 * **E nada aqui soma os dois lados.** O impacto do chamado e o da planilha
 * aparecem lado a lado para explicar uma divergência, e nunca adicionados: é a
 * mesma regra que separa as duas superfícies desde `schema/tickets.ts`.
 */

export const SITUACOES = [
  "CONCILIADA",
  "DIVERGENTE",
  "SEM_CHAMADO",
  "SEM_ALTERACAO",
] as const;

export type Situacao = (typeof SITUACOES)[number];

/** O rótulo de cada situação — a mesma frase no filtro, na barra e na linha. */
export const ROTULO_DA_SITUACAO: Record<Situacao, string> = {
  CONCILIADA: "Conciliadas",
  DIVERGENTE: "Divergentes",
  SEM_CHAMADO: "Sem chamado",
  SEM_ALTERACAO: "Sem alteração",
};

/**
 * A mesma situação no singular — o chip de uma linha fala de **um** par.
 *
 * Escrito, e não derivado do plural por corte de letra: "Sem chamado" e "Sem
 * alteração" não têm o `s` que a regra cortaria, e uma regra que acerta por
 * acaso em dois dos quatro casos é a que erra no quinto rótulo que alguém
 * acrescentar.
 */
export const ROTULO_DA_SITUACAO_SINGULAR: Record<Situacao, string> = {
  CONCILIADA: "Conciliada",
  DIVERGENTE: "Divergente",
  SEM_CHAMADO: "Sem chamado",
  SEM_ALTERACAO: "Sem alteração",
};

/**
 * O que cada situação quer dizer, em uma linha.
 *
 * Escrito para quem opera, e não para quem escreveu o schema: "SEM_CHAMADO" é
 * um nome de coluna, e a pessoa que abre a tela precisa saber o que fazer com
 * ele.
 */
export const EXPLICACAO_DA_SITUACAO: Record<Situacao, string> = {
  CONCILIADA: "A planilha mudou o que o chamado pediu, e os valores batem.",
  DIVERGENTE: "Há chamado, mas a planilha aplicou um valor diferente do pedido.",
  SEM_CHAMADO: "A planilha mudou e nenhum chamado deste envio pediu.",
  SEM_ALTERACAO: "O chamado pediu e a vigência comparada não mudou.",
};

export type BaseDoVeredito = "VALOR" | "TEXTO" | "EXISTENCIA";

/** Sobre o que o veredito foi dado — a coluna "conferido por" da tabela. */
export const ROTULO_DA_BASE: Record<BaseDoVeredito, string> = {
  VALOR: "valor",
  TEXTO: "texto",
  EXISTENCIA: "existência",
};

/**
 * OS DOIS GRÃOS DA MESMA PERGUNTA.
 *
 * `ATIVO` cruza `(placa, parâmetro)` e é o grão forte: ele responde se a
 * planilha mudou **no que** o chamado pediu, e não apenas se as duas coisas
 * aconteceram no mesmo mês.
 *
 * `PARAMETRO` cruza `(vigência, parâmetro)` e existe porque o export real não
 * alcança o primeiro: a coluna `Item` vem com `-` em quase toda linha, e sem
 * placa não há par que cruzar. Ele conta — "22 chamados pediram `placaCarreta`
 * e a planilha trocou 22 carretas" — e essa é uma afirmação mais fraca, de
 * propósito: é o que o arquivo sustenta.
 *
 * Os dois **nunca se somam**, e é por isso que a tela obriga a escolher um:
 * um par conciliado por ativo é uma afirmação sobre aquela placa; um parâmetro
 * conciliado é uma afirmação sobre um total. Misturá-los faria um número herdar
 * a força de prova do outro.
 */
export const GRAOS = ["ATIVO", "PARAMETRO"] as const;

export type Grao = (typeof GRAOS)[number];

export const ROTULO_DO_GRAO: Record<Grao, string> = {
  ATIVO: "Por placa e parâmetro",
  PARAMETRO: "Por parâmetro",
};

/** O que cada grão consegue afirmar — a frase que fica embaixo do alternador. */
export const EXPLICACAO_DO_GRAO: Record<Grao, string> = {
  ATIVO:
    "Confronta cada placa com o chamado que a nomeia. É a leitura mais forte, " +
    "e só funciona quando o export traz a placa em “Item”.",
  PARAMETRO:
    "Confronta quantas alterações a planilha trouxe com quantos chamados as " +
    "pediram, parâmetro a parâmetro. Não diz qual chamado é de qual placa — " +
    "diz se os totais batem.",
};

/** O grão que a URL pede. Qualquer outra coisa é o grão por ativo. */
export function graoDaUrl(valor: string | null): Grao {
  return valor === "parametro" ? "PARAMETRO" : "ATIVO";
}

/** Como o grão viaja na URL — ausente é o padrão, e o padrão é por ativo. */
export function graoNaUrl(grao: Grao): string | null {
  return grao === "PARAMETRO" ? "parametro" : null;
}

/**
 * O que cada situação quer dizer **no grão por parâmetro**.
 *
 * Escrito à parte, e não reaproveitado do grão por ativo, porque as frases
 * mudam de sentido: lá "conciliada" quer dizer que os valores batem; aqui, que
 * as contagens batem. Reusar o texto faria a tela prometer uma conferência de
 * valor que este grão não faz.
 */
export const EXPLICACAO_POR_PARAMETRO: Record<Situacao, string> = {
  CONCILIADA:
    "A planilha mudou este parâmetro tantas vezes quantos chamados o pediram.",
  DIVERGENTE:
    "Os dois lados mexeram neste parâmetro, mas em quantidades diferentes.",
  SEM_CHAMADO: "A planilha mudou este parâmetro e nenhum chamado o pediu.",
  SEM_ALTERACAO:
    "Chamados pediram este parâmetro e a comparação não o mudou em placa nenhuma.",
};

export interface LadoDaConciliacao {
  alteracoes: number;
  pares: number;
  placas: number;
  foraDaConciliacao: number;
}

export interface ResumoDaConciliacao {
  changeSetId: string;
  ticketImportId: string;
  planilha: LadoDaConciliacao;
  chamados: LadoDaConciliacao;
  pares: number;
  conciliadas: number;
  divergentes: number;
  semChamado: number;
  semAlteracao: number;
  diferenca: number;
  placasEmComum: number;
  tipos: { entityType: string | null; pares: number }[];
}

export interface LinhaDaConciliacao {
  entityLabel: string;
  entityType: string | null;
  attributeCode: string;
  attributeName: string | null;
  situacao: Situacao;
  base: BaseDoVeredito | null;

  changeId: number | null;
  planilhaAntes: string | null;
  planilhaDepois: string | null;
  planilhaDepoisNumerico: number | null;
  planilhaImpacto: number | null;
  planilhaPeriodicidade: string | null;
  alteracoesNoPar: number;

  ticketChangeId: string | null;
  externalId: string | null;
  statusBucket: string | null;
  chamadosNoPar: number;
  parameterLabel: string | null;
  changeKind: string | null;
  chamadoAntes: string | null;
  chamadoDepois: string | null;
  chamadoDepoisNumerico: number | null;
  chamadoImpacto: number | null;
  beforeSource: string | null;
  vigenciaLabel: string | null;

  diferencaDeValor: number | null;
}

/**
 * O nome legível do parâmetro de uma linha.
 *
 * `attributeName` vem do dicionário e só existe do **lado da planilha** — numa
 * linha SEM_ALTERACAO ele é nulo, e cair direto no código deixava a tela
 * escrevendo `cavalo.seguro` duas vezes, uma delas no lugar do nome. O rótulo
 * que o arquivo de chamados usa ("Seguro") é o nome que existe ali, e é ele que
 * entra antes do código.
 */
export function nomeDoParametro(linha: {
  attributeName: string | null;
  parameterLabel: string | null;
  attributeCode: string;
}): string {
  return linha.attributeName ?? linha.parameterLabel ?? linha.attributeCode;
}

// ---------------------------------------------------------------------------
// O grão por parâmetro
// ---------------------------------------------------------------------------

export interface ResumoPorParametro {
  changeSetId: string;
  ticketImportId: string;
  parametros: number;
  conciliados: number;
  divergentes: number;
  semChamado: number;
  semAlteracao: number;
  alteracoesNaPlanilha: number;
  chamados: number;
  /** Chamados cujo parâmetro o dicionário da base não reconheceu. */
  chamadosForaDaConciliacao: number;
}

export interface LinhaPorParametro {
  attributeCode: string;
  attributeName: string | null;
  entityType: string | null;
  situacao: Situacao;
  alteracoesNaPlanilha: number;
  placasNaPlanilha: number;
  chamados: number;
  /** Quantos deles nomeiam placa — a parcela que o grão por ativo alcançaria. */
  chamadosComPlaca: number;
  operacoes: { changeKind: string | null; chamados: number }[];
  parameterLabel: string | null;
  diferenca: number;
}

/** Quanto dos parâmetros está conciliado — `0` a `100`. */
export function percentualPorParametro(
  resumo: ResumoPorParametro | null,
): number {
  if (!resumo || resumo.parametros === 0) return 0;
  return (resumo.conciliados / resumo.parametros) * 100;
}

/** Os parâmetros que não fecham — o número do cartão. */
export function pendenciasPorParametro(
  resumo: ResumoPorParametro | null,
): number | null {
  if (!resumo) return null;
  return resumo.divergentes + resumo.semChamado + resumo.semAlteracao;
}

/**
 * A diferença de contagem neste grão — a planilha menos os chamados.
 *
 * Somada sobre os parâmetros conciliáveis dos dois lados, e por isso ela **não**
 * é a mesma do grão por ativo: lá o denominador dos chamados são as alterações
 * com placa, aqui são as com parâmetro reconhecido. Duas contas diferentes com
 * o mesmo nome seriam o convite a somá-las.
 */
export function diferencaPorParametro(
  resumo: ResumoPorParametro | null,
): number | null {
  if (!resumo) return null;
  return resumo.alteracoesNaPlanilha - resumo.chamados;
}

/**
 * Quanto do envio esta leitura de fato lê — `0` a `100`.
 *
 * O número existe porque, no export real, ele é **4%**: 153 dos 3.400 chamados
 * têm parâmetro que a base reconhece, e os outros 3.247 são de frete, que não
 * existe na base de equipamentos. Uma tela que mostrasse só os 153 pareceria
 * completa sobre um arquivo que ela mal lê.
 */
export function alcanceDosChamados(
  resumo: ResumoPorParametro | null,
): number | null {
  if (!resumo) return null;
  const total = resumo.chamados + resumo.chamadosForaDaConciliacao;
  if (total === 0) return null;
  return (resumo.chamados / total) * 100;
}

/** As quatro barras deste grão — sempre as quatro, inclusive as zeradas. */
export function barrasPorParametro(
  resumo: ResumoPorParametro | null,
): BarraDaSituacao[] {
  const total = resumo?.parametros ?? 0;
  const contagem: Record<Situacao, number> = {
    CONCILIADA: resumo?.conciliados ?? 0,
    DIVERGENTE: resumo?.divergentes ?? 0,
    SEM_CHAMADO: resumo?.semChamado ?? 0,
    SEM_ALTERACAO: resumo?.semAlteracao ?? 0,
  };
  return SITUACOES.map((situacao) => ({
    situacao,
    rotulo: ROTULO_DA_SITUACAO[situacao],
    pares: contagem[situacao],
    proporcao: total === 0 ? 0 : (contagem[situacao] / total) * 100,
  }));
}

/**
 * As operações de um parâmetro, em uma linha — "22 SET", "24 ADD · 24 REM".
 *
 * O que o chamado **fez** com o parâmetro muda como se lê a contagem: 22 `SET`
 * são 22 trocas de valor, e 71 `FORM_THIS` são recálculos de fórmula que podem
 * não mexer em valor nenhum. Uma coluna só com o total leria as duas coisas
 * igual.
 */
export function resumoDasOperacoes(linha: LinhaPorParametro): string {
  if (linha.operacoes.length === 0) return "";
  return linha.operacoes
    .map((o) => `${o.chamados} ${o.changeKind ?? "sem operação"}`)
    .join(" · ");
}

export interface ComparacaoDisponivel {
  id: string;
  rotuloA: string | null;
  rotuloB: string | null;
  dataB: string | null;
  scopeHash: string | null;
}

export interface EnvioDisponivel {
  id: string;
  filename: string;
  receivedAt: string;
  ticketCount: number;
  /** A unidade que o arquivo nomeia. `null` é a série indeterminada. */
  serie: string | null;
}

// ---------------------------------------------------------------------------
// As contas
// ---------------------------------------------------------------------------

/**
 * Quanto do que mudou está conciliado — `0` a `100`.
 *
 * O denominador é o **par**, e não a alteração da planilha. É a diferença entre
 * "quanto do que a Ambev mudou tem chamado" e "quanto do confronto inteiro está
 * em ordem", e é a segunda que a tela promete: um chamado que pediu o que a
 * planilha não aplicou é pendência tanto quanto uma alteração sem chamado, e um
 * denominador que o ignorasse deixaria a barra subir enquanto a fila crescia.
 *
 * Sem par nenhum devolve `0`, e não `NaN`: uma barra vazia é honesta, uma barra
 * quebrada é defeito.
 */
export function percentualConciliado(resumo: ResumoDaConciliacao | null): number {
  if (!resumo || resumo.pares === 0) return 0;
  return (resumo.conciliadas / resumo.pares) * 100;
}

/** As pendências — tudo o que não está conciliado. É o número do cartão. */
export function pendencias(resumo: ResumoDaConciliacao | null): number | null {
  if (!resumo) return null;
  return resumo.divergentes + resumo.semChamado + resumo.semAlteracao;
}

export interface BarraDaSituacao {
  situacao: Situacao;
  rotulo: string;
  pares: number;
  /** `0` a `100`, sobre o total de pares. */
  proporcao: number;
}

/**
 * As quatro barras, sempre as quatro — inclusive as zeradas.
 *
 * Uma barra zerada diz "nenhuma divergência"; a barra ausente deixa em aberto
 * se não há divergência ou se a tela não sabe mostrá-la. É a mesma decisão das
 * abas por tipo de ativo no Painel de Justificativas, e pela mesma razão.
 */
export function barrasDaSituacao(
  resumo: ResumoDaConciliacao | null,
): BarraDaSituacao[] {
  const pares = resumo?.pares ?? 0;
  const contagem: Record<Situacao, number> = {
    CONCILIADA: resumo?.conciliadas ?? 0,
    DIVERGENTE: resumo?.divergentes ?? 0,
    SEM_CHAMADO: resumo?.semChamado ?? 0,
    SEM_ALTERACAO: resumo?.semAlteracao ?? 0,
  };
  return SITUACOES.map((situacao) => ({
    situacao,
    rotulo: ROTULO_DA_SITUACAO[situacao],
    pares: contagem[situacao],
    proporcao: pares === 0 ? 0 : (contagem[situacao] / pares) * 100,
  }));
}

/**
 * O aviso que a tela precisa dar antes de qualquer número — ou `null` quando
 * não há nada a avisar.
 *
 * São três, e todos são **fatos contados**, nunca palpites sobre cadastro:
 *
 * - `UNIDADES_DIFERENTES` — os dois lados têm população e **nenhuma placa em
 *   comum**. É o retrato de conciliar Recife contra Camaçari: a tela devolveria
 *   centenas de pendências que não são pendências, e dizer isso depois dos
 *   cartões seria dizer tarde demais. O arquivo de chamados nomeia a unidade em
 *   texto e a vigência em identidade canônica, e as duas não se traduzem (ver o
 *   módulo do servidor) — o que dá para afirmar é a interseção, e é o que se
 *   afirma.
 * - `SEM_CHAMADOS` — o envio escolhido não tem nenhuma alteração conciliável.
 *   Sem isso a tela mostraria 100% de "sem chamado" como se fosse achado.
 * - `SEM_ALTERACOES` — a comparação escolhida não mudou nada.
 *
 * O aviso não esconde a tela: ele explica o que ela está mostrando. Esconder
 * transformaria um recorte mal escolhido em tela vazia sem motivo.
 */
export type AvisoDaConciliacao =
  | "POUCO_ALCANCE"
  | "UNIDADES_DIFERENTES"
  | "SEM_CHAMADOS"
  | "SEM_ALTERACOES";

export function avisoDaConciliacao(
  resumo: ResumoDaConciliacao | null,
): AvisoDaConciliacao | null {
  if (!resumo) return null;
  if (resumo.planilha.alteracoes === 0) return "SEM_ALTERACOES";
  if (resumo.chamados.alteracoes === 0) return "SEM_CHAMADOS";
  /*
    `POUCO_ALCANCE` vem **antes** de `UNIDADES_DIFERENTES`, e a ordem é a
    correção de um diagnóstico errado.

    Medido no export real de agosto/setembro de 2026 contra a base do mesmo
    período: 6 das 3.400 alterações de chamado têm placa, e nenhuma delas cai
    numa placa da comparação. `placasEmComum` é zero — mas a causa não é a
    unidade, é o arquivo não trazer placa. Com a ordem antiga a tela mandava
    "troque um dos dois lados", e trocar não resolveria nada: nenhum outro envio
    deste formato traz placa.

    A régua é a maioria: mais alterações fora da conciliação do que dentro
    significa que este grão lê a minoria do envio, e quem abre precisa saber
    disso antes de ler "sem chamado" como achado.
  */
  if (resumo.chamados.foraDaConciliacao > resumo.chamados.alteracoes) {
    return "POUCO_ALCANCE";
  }
  if (resumo.placasEmComum === 0) return "UNIDADES_DIFERENTES";
  return null;
}

export const TEXTO_DO_AVISO: Record<AvisoDaConciliacao, string> = {
  POUCO_ALCANCE:
    "A maioria das alterações deste envio não tem placa ou parâmetro " +
    "reconhecido, então este confronto por placa alcança só uma parte dele — e " +
    "o que sobra aparece como “sem chamado” por falta de chave, não por achado. " +
    "Veja por parâmetro: lá o confronto é entre quantas alterações a planilha " +
    "trouxe e quantos chamados as pediram.",
  UNIDADES_DIFERENTES:
    "Os dois lados têm alterações, mas nenhuma placa em comum — o envio de " +
    "chamados e a vigência comparada provavelmente são de unidades diferentes. " +
    "Troque um dos dois antes de ler os números abaixo.",
  SEM_CHAMADOS:
    "O envio escolhido não tem nenhuma alteração de parâmetro com placa e " +
    "parâmetro reconhecidos. Tudo aparece como “sem chamado” por ausência de " +
    "material, e não por achado.",
  SEM_ALTERACOES:
    "A comparação escolhida não trouxe alteração nenhuma com placa. Não há o " +
    "que conciliar deste lado.",
};

/**
 * O aviso do grão por parâmetro — as duas ausências que ele pode ter.
 *
 * `UNIDADES_DIFERENTES` não existe aqui: sem placa não há interseção de placas
 * a medir, e afirmar unidade sem essa medida seria o palpite sobre cadastro que
 * o módulo do servidor recusa desde o começo.
 */
export type AvisoPorParametro = "SEM_CHAMADOS" | "SEM_ALTERACOES";

export function avisoPorParametro(
  resumo: ResumoPorParametro | null,
): AvisoPorParametro | null {
  if (!resumo) return null;
  if (resumo.alteracoesNaPlanilha === 0) return "SEM_ALTERACOES";
  if (resumo.chamados === 0) return "SEM_CHAMADOS";
  return null;
}

export const TEXTO_DO_AVISO_POR_PARAMETRO: Record<AvisoPorParametro, string> = {
  SEM_CHAMADOS:
    "Nenhum chamado deste envio mexe num parâmetro que a base de equipamentos " +
    "conhece — o mais comum é o envio ser todo de frete, que vive em outra " +
    "base. Não há o que confrontar contra esta comparação.",
  SEM_ALTERACOES:
    "A comparação escolhida não trouxe alteração nenhuma. Não há o que " +
    "conciliar deste lado.",
};

/**
 * O rótulo de uma comparação no seletor — "2026-07 → 2026-08".
 *
 * A seta é a leitura: uma comparação é sempre de uma vigência **para** outra, e
 * um rótulo com as duas soltas faria quem escolhe ter de lembrar qual é qual.
 */
export function rotuloDaComparacao(c: ComparacaoDisponivel): string {
  const a = c.rotuloA ?? "?";
  const b = c.rotuloB ?? "?";
  return `${a} → ${b}`;
}

/**
 * O rótulo de um envio no seletor — a unidade, o arquivo e o dia em que chegou.
 *
 * A unidade vem primeiro porque é o que decide se o envio serve: dois envios do
 * mesmo dia costumam ser unidades diferentes, e não reenvios da mesma fila (ver
 * `ticket_import.serie`). Um seletor que só mostrasse arquivo e data ofereceria
 * duas linhas indistinguíveis para a única escolha que importa aqui.
 */
export function rotuloDoEnvio(e: EnvioDisponivel): string {
  const dia = new Date(e.receivedAt);
  const quando = Number.isNaN(dia.getTime())
    ? e.receivedAt
    : dia.toLocaleDateString("pt-BR");
  return `${e.serie ?? "sem unidade no arquivo"} · ${e.filename} — ${quando}`;
}

// ---------------------------------------------------------------------------
// As consultas
// ---------------------------------------------------------------------------

/** O rótulo com que a série indeterminada viaja na URL. O mesmo da rota. */
export const SEM_SERIE = "@sem-serie";

export interface RecorteDaTela {
  /**
   * A unidade aberta na lateral, do lado da **planilha** — o `scope_hash` da
   * vigência. `null` é sem recorte de unidade.
   */
  escopo: string | null;
  /**
   * A mesma unidade do lado dos **chamados** — a série que o arquivo nomeia.
   *
   * São dois vocabulários para o mesmo recorte, e quem os casa é
   * `lib/serie-da-unidade.ts` (o mesmo do Monitoramento). `undefined` é todas
   * as séries; `null` é a série indeterminada, que é uma série de verdade.
   *
   * Ela existe aqui pela razão que esta tela existe: conciliar a vigência de
   * CAMAÇARI contra o envio de Recife devolveria uma tela cheia de pendência
   * que não é pendência. O aviso continua, para quem escolher os dois lados à
   * mão; o padrão passa a não cair nesse buraco sozinho.
   */
  serie: string | null | undefined;
  changeSetId: string | null;
  ticketImportId: string | null;
  somenteVigenciaComparada: boolean;
}

/** Os parâmetros comuns às três rotas — o recorte, e nada além dele. */
function parametrosDoRecorte(recorte: RecorteDaTela): URLSearchParams {
  const q = new URLSearchParams();
  if (recorte.escopo) q.set("scopeHash", recorte.escopo);
  if (recorte.serie !== undefined) {
    q.set("serie", recorte.serie === null ? SEM_SERIE : recorte.serie);
  }
  if (recorte.changeSetId) q.set("changeSetId", recorte.changeSetId);
  if (recorte.ticketImportId) q.set("ticketImportId", recorte.ticketImportId);
  if (recorte.somenteVigenciaComparada) q.set("somenteVigenciaComparada", "1");
  return q;
}

/**
 * Os dois seletores. Uma consulta só, e antes das outras duas: é dela que sai a
 * lista de comparações e de envios, e é ela que a tela mostra enquanto o resumo
 * ainda não voltou.
 */
export function useOpcoesDaConciliacao(escopo: string | null) {
  const q = new URLSearchParams();
  if (escopo) q.set("scopeHash", escopo);
  const sufixo = q.toString() ? `?${q.toString()}` : "";
  const endereco = `/conciliacao-de-chamados/opcoes${sufixo}`;

  const consulta = useConsultaResiliente<{
    comparacoes: ComparacaoDisponivel[];
    envios: EnvioDisponivel[];
  }>({
    queryKey: ["conciliacao-de-chamados", "opcoes", escopo ?? "todas"],
    endpoint: "/conciliacao-de-chamados/opcoes",
    buscar: () =>
      fetchJson<{
        comparacoes: ComparacaoDisponivel[];
        envios: EnvioDisponivel[];
      }>(endereco),
  });

  return {
    comparacoes: consulta.dados?.comparacoes ?? null,
    envios: consulta.dados?.envios ?? null,
    consulta,
  };
}

/**
 * O resumo — os cartões, as barras e o aviso.
 *
 * `null` enquanto não chegou, nunca zero. Ver o cabeçalho.
 */
export function useResumoDaConciliacao(
  recorte: RecorteDaTela,
  /**
   * O recorte já está decidido.
   *
   * `false` só enquanto a lista de séries não chegou **e** há unidade aberta:
   * disparar antes seria disparar duas vezes, e a primeira — com o envio errado
   * — pintaria pendência que não existe. É o mesmo `habilitado` das consultas do
   * Monitoramento, e pelo mesmo motivo (ver `lib/serie-da-unidade.ts`).
   */
  habilitado = true,
) {
  const endereco = `/conciliacao-de-chamados/resumo?${parametrosDoRecorte(recorte).toString()}`;

  const consulta = useConsultaResiliente<ResumoDaConciliacao>({
    queryKey: ["conciliacao-de-chamados", "resumo", endereco],
    endpoint: "/conciliacao-de-chamados/resumo",
    buscar: () => fetchJson<ResumoDaConciliacao>(endereco),
    enabled: habilitado,
  });

  return { resumo: consulta.dados ?? null, consulta };
}

export interface ConsultaDeLinhas extends RecorteDaTela {
  situacao: Situacao | null;
  tipo: string | null;
  busca: string;
  pagina: number;
  porPagina: number;
}

/** O endereço de `/conciliacao-de-chamados/linhas` para um recorte da tela. */
export function enderecoDasLinhas(consulta: ConsultaDeLinhas): string {
  const q = parametrosDoRecorte(consulta);
  if (consulta.situacao) q.set("situacao", consulta.situacao);
  if (consulta.tipo) q.set("entityType", consulta.tipo);
  if (consulta.busca.trim() !== "") q.set("search", consulta.busca.trim());
  q.set("limit", String(consulta.porPagina));
  q.set("offset", String((consulta.pagina - 1) * consulta.porPagina));
  return `/conciliacao-de-chamados/linhas?${q.toString()}`;
}

export function useLinhasDaConciliacao(
  consulta: ConsultaDeLinhas,
  habilitado = true,
) {
  const endereco = enderecoDasLinhas(consulta);
  const resposta = useQuery({
    queryKey: ["conciliacao-de-chamados", "linhas", endereco],
    queryFn: () =>
      fetchJson<{ total: number; linhas: LinhaDaConciliacao[] }>(endereco),
    placeholderData: (anterior) => anterior,
    enabled: habilitado,
  });

  const linhas = useMemo(() => resposta.data?.linhas ?? [], [resposta.data]);
  return { linhas, total: resposta.data?.total ?? 0, consulta: resposta };
}

// ---------------------------------------------------------------------------
// As consultas do grão por parâmetro
// ---------------------------------------------------------------------------

/**
 * O resumo por parâmetro — os cartões e as barras do segundo grão.
 *
 * Rota própria, e não um `?grao=` na do primeiro, pela mesma razão que o
 * servidor as separou: as duas respostas não têm a mesma força de prova, e uma
 * só convidaria quem lê a somá-las.
 *
 * `null` enquanto não chegou, nunca zero — a mesma regra do resumo por ativo.
 */
export function useResumoPorParametro(
  recorte: RecorteDaTela,
  habilitado = true,
) {
  const endereco = `/conciliacao-de-chamados/por-parametro/resumo?${parametrosDoRecorte(
    recorte,
  ).toString()}`;

  const consulta = useConsultaResiliente<ResumoPorParametro>({
    queryKey: ["conciliacao-de-chamados", "por-parametro", "resumo", endereco],
    endpoint: "/conciliacao-de-chamados/por-parametro/resumo",
    buscar: () => fetchJson<ResumoPorParametro>(endereco),
    enabled: habilitado,
  });

  return { resumo: consulta.dados ?? null, consulta };
}

/**
 * O endereço da lista por parâmetro.
 *
 * Sem `entityType` quando o tipo não foi escolhido, como na outra; a busca vale
 * sobre código, nome na base e rótulo do arquivo — não sobre placa, que este
 * grão não tem.
 */
export function enderecoPorParametro(consulta: ConsultaDeLinhas): string {
  const q = parametrosDoRecorte(consulta);
  if (consulta.situacao) q.set("situacao", consulta.situacao);
  if (consulta.tipo) q.set("entityType", consulta.tipo);
  if (consulta.busca.trim() !== "") q.set("search", consulta.busca.trim());
  q.set("limit", String(consulta.porPagina));
  q.set("offset", String((consulta.pagina - 1) * consulta.porPagina));
  return `/conciliacao-de-chamados/por-parametro/linhas?${q.toString()}`;
}

export function useLinhasPorParametro(
  consulta: ConsultaDeLinhas,
  habilitado = true,
) {
  const endereco = enderecoPorParametro(consulta);
  const resposta = useQuery({
    queryKey: ["conciliacao-de-chamados", "por-parametro", "linhas", endereco],
    queryFn: () =>
      fetchJson<{ total: number; linhas: LinhaPorParametro[] }>(endereco),
    placeholderData: (anterior) => anterior,
    enabled: habilitado,
  });

  const linhas = useMemo(() => resposta.data?.linhas ?? [], [resposta.data]);
  return { linhas, total: resposta.data?.total ?? 0, consulta: resposta };
}
