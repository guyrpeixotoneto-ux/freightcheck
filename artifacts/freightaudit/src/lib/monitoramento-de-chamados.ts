import { useMutation, useQueryClient } from "@tanstack/react-query";

import { fetchJson } from "@/lib/api";
import { useConsultaResiliente } from "@/lib/consulta-resiliente";

/**
 * MONITORAMENTO DE CHAMADOS — os dados e as regras da tela.
 *
 * As contas moram aqui, e não na página, pelo motivo de sempre nesta casa: são
 * strings e números entrando e saindo, e é o que permite prendê-las em teste sem
 * montar tela nenhuma. A página fica com o desenho.
 *
 * **Nada aqui inventa número.** Enquanto o dia não chegou, o resumo é `null` —
 * nunca zero, que se leria como "nada mudou" no meio do carregamento. É a mesma
 * escolha de `lib/painel-de-justificativas.ts`, e pela mesma razão: um zero
 * durante a espera é uma afirmação, e uma afirmação falsa.
 */

export const FUSO_DA_OPERACAO = "America/Sao_Paulo";

// ---------------------------------------------------------------------------
// O que a API devolve
// ---------------------------------------------------------------------------

export type EstadoDoDia =
  | "SEM_IMPORTACAO"
  | "PRIMEIRA_CARGA"
  | "SEM_MOVIMENTACAO"
  | "PENDENTE"
  | "REVISADO";

export type ClasseDaMovimentacao = "NOVO" | "ALTERADO" | "ENCERRADO" | "REMOVIDO";

export interface DiaDaRegua {
  dia: string;
  estado: EstadoDoDia;
  envios: number;
  enviosComFalha: number;
  movimentacoes: number;
  revisadas: number;
  pendentes: number;
  ultimaImportacao: string | null;
}

export interface Diferenca {
  tipo: string;
  campo: string;
  antes: string | null;
  depois: string | null;
}

export interface Movimentacao {
  id: string;
  dia: string;
  serie: string | null;
  externalId: string;
  classe: ClasseDaMovimentacao;
  revisao: number;
  passos: number;
  unidade: string | null;
  area: string | null;
  responsavel: string | null;
  solicitante: string | null;
  statusRaw: string | null;
  statusBucket: string | null;
  assunto: string | null;
  entidade: string | null;
  prazoPrevisto: string | null;
  abertoEm: string | null;
  encerradoEm: string | null;
  alteradoEmFonte: string | null;
  criticidade: string;
  criticidadeMotivo: string | null;
  criticidadeOrigem: string;
  atrasado: boolean;
  movidaEm: string;
  revisada: boolean;
  revisadaPor: string | null;
  revisadaEm: string | null;
  diferencas: Diferenca[];
}

export interface AvisoDoDia {
  tipo: "BASELINE" | "IMPORTACAO_COM_FALHA" | "REMOVIDOS_SUPRIMIDOS";
  texto: string;
}

export interface ResumoDoDia {
  dia: string;
  estado: EstadoDoDia;
  ultimaImportacao: string | null;
  movimentacoes: number;
  novos: number;
  alterados: number;
  encerrados: number;
  removidos: number;
  revisadas: number;
  pendentes: number;
  alteracoesDeCampo: { tipo: string; total: number }[];
  pontosDeAtencao: {
    criticos: number;
    atrasados: number;
    prazosAlterados: number;
    trocasDeResponsavel: number;
  };
  porUnidade: { unidade: string | null; total: number }[];
  avisos: AvisoDoDia[];
  filtros: {
    unidades: string[];
    areas: string[];
    responsaveis: string[];
    status: string[];
    tiposDeAlteracao: string[];
  };
}

export interface Serie {
  serie: string | null;
  origem: string | null;
  envios: number;
  ultimaImportacao: string | null;
}

export const ABAS = [
  "TODOS",
  "NAO_REVISADOS",
  "CRITICOS",
  "NOVOS",
  "ALTERADOS",
  "ENCERRADOS",
  "REMOVIDOS",
] as const;
export type Aba = (typeof ABAS)[number];

export interface FiltrosDaTela {
  unidade?: string;
  area?: string;
  responsavel?: string;
  statusBucket?: string;
  tipoDeAlteracao?: string;
  busca?: string;
}

/** O rótulo com que a série indeterminada viaja na URL. Igual ao da rota. */
export const SEM_SERIE = "@sem-serie";

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

/** `2026-09-02` → `02/09/2026`. Sem `Date`: não há fuso a errar num split. */
export function diaLegivel(dia: string): string {
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a}`;
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** `2026-09-02` → `02 de setembro de 2026`, o título da tela. */
export function diaPorExtenso(dia: string): string {
  const [a, m, d] = dia.split("-");
  return `${d} de ${MESES[Number(m) - 1]} de ${a}`;
}

/** O número e o mês curto de uma posição da régua. */
export function posicaoDaRegua(dia: string): { numero: string; mes: string } {
  const [, m, d] = dia.split("-");
  return { numero: d!, mes: MESES[Number(m) - 1]!.slice(0, 3) };
}

/**
 * A hora de um instante, no fuso da operação.
 *
 * Sempre com `timeZone` explícito: sem ele o navegador usaria o fuso da máquina
 * de quem olha, e a "última importação 08:15" viraria outra hora para quem
 * abrisse a tela de fora do país — enquanto a régua, que é calculada no
 * servidor, continuaria no dia certo. Uma tela em que a hora e o dia discordam
 * é pior do que uma sem hora.
 */
export function horaLegivel(iso: string | null): string | null {
  if (iso === null) return null;
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: FUSO_DA_OPERACAO,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** O dia da operação de hoje — a mesma régua do servidor. */
export function hojeNaOperacao(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_DA_OPERACAO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------

export const ROTULO_DA_CLASSE: Record<ClasseDaMovimentacao, string> = {
  NOVO: "Novo chamado",
  ALTERADO: "Alterado",
  ENCERRADO: "Encerrado",
  REMOVIDO: "Saiu da fila",
};

/**
 * O nome de cada tipo de alteração, na língua de quem opera.
 *
 * O `campo` da diferença é o cabeçalho original do arquivo, e é ele que a linha
 * mostra quando o tipo é `OUTRO` — porque aí o cabeçalho é a única informação
 * que existe sobre o que mudou.
 */
export const ROTULO_DO_TIPO: Record<string, string> = {
  STATUS: "Status",
  ENCERRAMENTO: "Encerramento",
  PRAZO: "Prazo",
  RESPONSAVEL: "Responsável",
  SOLICITANTE: "Solicitante",
  UNIDADE: "Unidade",
  AREA: "Área",
  CATEGORIA: "Categoria",
  VIGENCIA: "Vigência",
  ENTIDADE: "Item",
  VALOR_SOLICITADO: "Valor solicitado",
  OUTRO: "Outra alteração",
};

export function rotuloDaDiferenca(d: Diferenca): string {
  return d.tipo === "OUTRO" || d.tipo === "VALOR_SOLICITADO"
    ? d.campo
    : (ROTULO_DO_TIPO[d.tipo] ?? d.campo);
}

/** O vazio tem nome na tela: um traço, e nunca uma célula em branco. */
export function valorLegivel(valor: string | null): string {
  if (valor === null || valor.trim() === "") return "—";
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) ? diaLegivel(valor) : valor;
}

export const ROTULO_DA_ABA: Record<Aba, { label: string; hint: string }> = {
  TODOS: { label: "Todos", hint: "todas as movimentações do dia" },
  NAO_REVISADOS: { label: "Não revisados", hint: "o que ainda falta olhar" },
  CRITICOS: {
    label: "Críticos",
    hint: "criticidade derivada por nós: prazo vencido em chamado aberto, ou prazo remarcado duas vezes no dia. A Ambev não manda prioridade.",
  },
  NOVOS: { label: "Novos", hint: "chamados que não existiam na importação anterior" },
  ALTERADOS: { label: "Alterados", hint: "chamados que mudaram e seguem abertos" },
  ENCERRADOS: { label: "Encerrados", hint: "chamados que chegaram a um status final hoje" },
  REMOVIDOS: { label: "Saíram da fila", hint: "chamados que não vieram nesta importação" },
};

/**
 * Quantas movimentações cada aba tem — derivado do resumo, nunca contado à parte.
 *
 * Um número ao lado de um filtro é lido como "é isto que sobra se eu clicar", e
 * a promessa só se cumpre se o número vier da mesma conta que a lista. Contar
 * aqui por conta própria daria dois números certos e uma leitura errada.
 */
export function contagemDaAba(resumo: ResumoDoDia | null, aba: Aba): number | undefined {
  if (resumo === null) return undefined;
  switch (aba) {
    case "TODOS": return resumo.movimentacoes;
    case "NAO_REVISADOS": return resumo.pendentes;
    case "CRITICOS": return resumo.pontosDeAtencao.criticos;
    case "NOVOS": return resumo.novos;
    case "ALTERADOS": return resumo.alterados;
    case "ENCERRADOS": return resumo.encerrados;
    case "REMOVIDOS": return resumo.removidos;
  }
}

// ---------------------------------------------------------------------------
// O estado do dia, em palavras
// ---------------------------------------------------------------------------

export interface FraseDoDia {
  tom: "neutro" | "informativo" | "pendente" | "concluido";
  titulo: string;
  detalhe: string;
}

/**
 * O que a tela diz antes de mostrar número nenhum.
 *
 * Os cinco estados existem porque três deles dariam "zero movimentações" e
 * significam coisas opostas: ninguém mandou arquivo, o arquivo chegou e não
 * mexeu em nada, e o arquivo era o primeiro da série. Uma tela que os
 * confundisse mandaria o gestor procurar um problema que não existe — ou deixar
 * de procurar um que existe.
 */
export function fraseDoDia(resumo: ResumoDoDia | null): FraseDoDia | null {
  if (resumo === null) return null;
  const hora = horaLegivel(resumo.ultimaImportacao);

  switch (resumo.estado) {
    case "SEM_IMPORTACAO":
      return {
        tom: "neutro",
        titulo: "Nenhuma importação realizada neste dia.",
        detalhe: "Nada chegou da Ambev com esta data — não é que nada tenha mudado.",
      };
    case "PRIMEIRA_CARGA":
      return {
        tom: "informativo",
        titulo: "Primeira importação desta unidade.",
        detalhe:
          resumo.avisos.find((a) => a.tipo === "BASELINE")?.texto ??
          "O estado inicial foi registrado. O monitoramento começa na próxima importação.",
      };
    case "SEM_MOVIMENTACAO":
      return {
        tom: "informativo",
        titulo: hora
          ? `Importação concluída às ${hora}. Nenhuma movimentação identificada.`
          : "Importação concluída. Nenhuma movimentação identificada.",
        detalhe: "Os chamados vieram iguais aos da importação anterior.",
      };
    case "REVISADO":
      return {
        tom: "concluido",
        titulo: "Dia revisado.",
        detalhe: `${resumo.movimentacoes} de ${resumo.movimentacoes} movimentações analisadas.`,
      };
    case "PENDENTE":
      return {
        tom: "pendente",
        titulo: `${resumo.pendentes} ${
          resumo.pendentes === 1 ? "movimentação aguardando" : "movimentações aguardando"
        } revisão.`,
        detalhe: `${resumo.revisadas} de ${resumo.movimentacoes} já revisadas.`,
      };
  }
}

/**
 * O progresso, ou `null` quando não há o que medir.
 *
 * Um dia sem movimentação **não** tem 0% nem 100%: ele não tem barra. Mostrar
 * "0 de 0 · 100%" celebraria um trabalho que ninguém fez, e "0%" cobraria um
 * trabalho que não existe.
 */
export function progressoDoDia(
  resumo: ResumoDoDia | null,
): { revisadas: number; total: number; percentual: number } | null {
  if (resumo === null || resumo.movimentacoes === 0) return null;
  return {
    revisadas: resumo.revisadas,
    total: resumo.movimentacoes,
    percentual: Math.round((resumo.revisadas / resumo.movimentacoes) * 100),
  };
}

/**
 * O chamado que **oscilou e voltou**.
 *
 * Zero diferenças no saldo do dia com passos registrados: o campo foi e voltou.
 * Não é um caso de borda a esconder — é justamente o ruído que o gestor abre
 * esta tela para pegar, e a linha precisa dizer por que está ali sem nenhum
 * "antes → depois" para mostrar.
 */
export function oscilouEVoltou(m: Movimentacao): boolean {
  return m.diferencas.length === 0 && m.passos > 0 && m.classe === "ALTERADO";
}

// ---------------------------------------------------------------------------
// As consultas
// ---------------------------------------------------------------------------

const BASE = "/monitoramento-de-chamados";

/** A série vira parâmetro só quando existe: ausente é "todas". */
function comSerie(serie: string | null | undefined): string {
  if (serie === undefined) return "";
  return `serie=${encodeURIComponent(serie === null ? SEM_SERIE : serie)}`;
}

function query(partes: (string | null | undefined)[]): string {
  const usadas = partes.filter((p): p is string => Boolean(p));
  return usadas.length === 0 ? "" : `?${usadas.join("&")}`;
}

export function useSeries() {
  return useConsultaResiliente<{ series: Serie[]; semSerie: string }>({
    queryKey: ["monitoramento-chamados", "series"],
    endpoint: `${BASE}/series`,
  });
}

/**
 * `habilitado` — as três consultas da tela esperam o recorte estar decidido.
 *
 * Quem decide é `recorteDeChamados` (`lib/serie-da-unidade.ts`), e ele leva um
 * instante quando há unidade aberta: a série que casa com ela só se sabe depois
 * de a lista de séries chegar. Disparar antes seria disparar duas vezes — e a
 * primeira, com o recorte errado, pintaria "nenhuma movimentação" sobre um dia
 * que tem.
 */
export function useReguaDeDias({
  ate,
  serie,
  habilitado = true,
}: {
  ate: string;
  serie: string | null | undefined;
  habilitado?: boolean;
}) {
  const endereco = `${BASE}/dias${query([`ate=${ate}`, comSerie(serie)])}`;
  return useConsultaResiliente<{
    hoje: string;
    de: string;
    ate: string;
    dias: DiaDaRegua[];
  }>({
    queryKey: ["monitoramento-chamados", "dias", ate, serie ?? "todas"],
    endpoint: `${BASE}/dias`,
    buscar: () => fetchJson(endereco),
    enabled: habilitado,
  });
}

export function useResumoDoDia({
  dia,
  serie,
  habilitado = true,
}: {
  dia: string;
  serie: string | null | undefined;
  habilitado?: boolean;
}) {
  const endereco = `${BASE}/dia/${dia}${query([comSerie(serie)])}`;
  return useConsultaResiliente<ResumoDoDia>({
    queryKey: ["monitoramento-chamados", "dia", dia, serie ?? "todas"],
    endpoint: `${BASE}/dia/:data`,
    buscar: () => fetchJson(endereco),
    enabled: habilitado,
  });
}

export function useMovimentacoes({
  dia,
  serie,
  aba,
  filtros,
  pagina,
  porPagina,
  habilitado = true,
}: {
  dia: string;
  serie: string | null | undefined;
  aba: Aba;
  filtros: FiltrosDaTela;
  pagina: number;
  porPagina: number;
  habilitado?: boolean;
}) {
  const endereco = `${BASE}/dia/${dia}/movimentacoes${query([
    `aba=${aba}`,
    comSerie(serie),
    filtros.unidade && `unidade=${encodeURIComponent(filtros.unidade)}`,
    filtros.area && `area=${encodeURIComponent(filtros.area)}`,
    filtros.responsavel && `responsavel=${encodeURIComponent(filtros.responsavel)}`,
    filtros.statusBucket && `statusBucket=${encodeURIComponent(filtros.statusBucket)}`,
    filtros.tipoDeAlteracao &&
      `tipoDeAlteracao=${encodeURIComponent(filtros.tipoDeAlteracao)}`,
    filtros.busca && `busca=${encodeURIComponent(filtros.busca)}`,
    `limit=${porPagina}`,
    `offset=${(pagina - 1) * porPagina}`,
  ])}`;

  return useConsultaResiliente<{ aba: Aba; total: number; rows: Movimentacao[] }>({
    queryKey: [
      "monitoramento-chamados",
      "movimentacoes",
      dia,
      serie ?? "todas",
      aba,
      filtros,
      pagina,
      porPagina,
    ],
    endpoint: `${BASE}/dia/:data/movimentacoes`,
    buscar: () => fetchJson(endereco),
    enabled: habilitado,
  });
}

// ---------------------------------------------------------------------------
// A revisão
// ---------------------------------------------------------------------------

/**
 * As escritas passam por `fetchJson` como todo o resto do produto.
 *
 * Não é economia de linhas: é o `erroDaResposta` dele que transforma o 409 de
 * "esta movimentação mudou desde que a tela carregou" na frase que a tela
 * mostra, e é o diagnóstico de transporte dele que separa isso de um soluço de
 * rede. Um `fetch` cru aqui devolveria "Failed to fetch" para as duas coisas.
 */
function escrever<T>(caminho: string, metodo: "POST" | "DELETE", corpo?: unknown) {
  /*
    Os dois caminhos são escritos por extenso, e não com um espalhamento
    condicional, por causa de `lib/__tests__/corpo-json.test.ts`: a varredura
    dele lê o objeto de opções **em volta** do `body: JSON.stringify(...)`, e um
    `...(corpo ? { body } : {})` põe o corpo num objeto interno onde o
    `Content-Type` não está. A varredura estava certa — quem lê o código também
    não vê os dois juntos —, e o remendo seria enganá-la.

    E o DELETE deixa de anunciar um tipo de corpo que ele não manda.
  */
  if (corpo === undefined) return fetchJson<T>(caminho, { method: metodo });

  return fetchJson<T>(caminho, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

/**
 * Revisar, desfazer e revisar em lote — as três invalidam as mesmas consultas.
 *
 * A régua entra na lista porque a cor de um dia depende de quantas pendências
 * ele tem: revisar a última movimentação de 02/09 tem de apagar o vermelho da
 * régua na mesma hora. Sem isso a tela ficaria dizendo "há pendências" ao lado
 * de uma lista vazia — dois números certos e a leitura errada.
 */
export function useRevisao(dia: string) {
  const cliente = useQueryClient();
  const invalidar = () =>
    cliente.invalidateQueries({ queryKey: ["monitoramento-chamados"] });

  const revisar = useMutation({
    mutationFn: (m: { id: string; revisao: number }) =>
      escrever<{ movementId: string; revisao: number }>(
        `${BASE}/movimentacoes/${m.id}/revisao`,
        "POST",
        { revisao: m.revisao },
      ),
    onSuccess: invalidar,
  });

  const desfazer = useMutation({
    mutationFn: (id: string) =>
      escrever<{ movementId: string; desfeita: boolean }>(
        `${BASE}/movimentacoes/${id}/revisao`,
        "DELETE",
      ),
    onSuccess: invalidar,
  });

  const emLote = useMutation({
    mutationFn: (ids: string[]) =>
      escrever<{ revisadas: string[]; recusadas: string[] }>(
        `${BASE}/revisoes`,
        "POST",
        { ids },
      ),
    onSuccess: invalidar,
  });

  return { dia, revisar, desfazer, emLote };
}
