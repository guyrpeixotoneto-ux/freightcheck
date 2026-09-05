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
  /** Quantos chamados o arquivo do dia trouxe — o número que a régua escreve. */
  chamadosNoEnvio: number;
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

/**
 * As situações da fila do dia — `APROVADO`, `EM ANÁLISE`, `REPROVADO`.
 *
 * Os três nomes são os do arquivo da Ambev; o que o servidor conta são as
 * caixas em que `normalizeStatus` os dobra (`ATENDIDO`, `EM_ANDAMENTO`,
 * `RECUSADO`), e a caixa é mais larga que o nome — um "Concluído" também
 * entraria em aprovados. A tela diz isso na dica do cartão em vez de fingir
 * uma precisão que o dado não tem.
 *
 * `outras` é tudo o que não cai nas três, e existe para a soma fechar: a tira
 * abaixo dos cartões só aparece quando ela é maior que zero, e é ela que
 * permite conferir os quatro números contra o total do envio.
 */
export interface SituacoesNoEnvio {
  aprovados: number;
  emAnalise: number;
  reprovados: number;
  outras: number;
  /** A soma das quatro, contada nos chamados — e não declarada pelo envio. */
  total: number;
  detalheDeOutras: { statusBucket: string; total: number }[];
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
  /**
   * Quantos chamados o arquivo do dia trouxe.
   *
   * Grão diferente de `movimentacoes` e **nunca somado com ele**: as
   * movimentações são o subconjunto da fila que se mexeu. É este número que
   * rotula a visão "Chamados do envio" antes de alguém abri-la — sem ele, a
   * tela teria de carregar a relação inteira só para poder dizer que ela existe.
   */
  chamadosNoEnvio: number;
  /**
   * A mesma fila dobrada por desfecho — o que os três cartões do topo contam.
   *
   * Vem do resumo, e não da relação, pela mesma razão de `chamadosNoEnvio`: os
   * cartões estão em tela antes de alguém abrir a visão "Chamados do envio", e
   * carregar 1.218 linhas para poder escrever três números seria pagar a fila
   * inteira em toda abertura de tela.
   */
  situacoesNoEnvio: SituacoesNoEnvio;
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

/**
 * A FILA DO DIA — a relação de chamados que o arquivo trouxe.
 *
 * A outra leitura do mesmo dia, e a resposta a uma reclamação concreta: num dia
 * em que a comparação não achou diferença nenhuma, a tela dizia "nenhuma
 * movimentação identificada" sobre uma lista vazia, e quem operava lia isso como
 * *"o import não trouxe nada"* — quando o arquivo tinha trazido 1.218 chamados.
 *
 * **Não é a mesma população da lista de movimentações, e nunca soma com ela.**
 * A fila é o arquivo inteiro; as movimentações são o subconjunto que se mexeu.
 * É a mesma disciplina de grãos que a aba Chamados mantém do outro lado, e por
 * isso a tela mostra uma de cada vez e diz qual está mostrando.
 */
export interface EnvioDaFila {
  id: string;
  filename: string;
  serie: string | null;
  recebidoEm: string;
  recebidoPor: string | null;
  chamados: number;
}

/**
 * Um parâmetro pedido pelo chamado, como o arquivo o escreveu.
 *
 * `de` e `para` são `Valor Antigo` e `Valor Solicitado` crus — sem número
 * derivado por nós, porque quem confere está com a planilha aberta ao lado.
 * `operacao` é a coluna `Operação` e é ela que explica a alteração sem
 * valores: `FORM_THIS` troca a fórmula, e não há "de 10 para 12" para mostrar.
 */
export interface AlteracaoDoChamado {
  parametro: string;
  operacao: string | null;
  de: string | null;
  para: string | null;
}

export interface ChamadoNaFila {
  id: string;
  externalId: string;
  serie: string | null;
  unidade: string | null;
  area: string | null;
  responsavel: string | null;
  solicitante: string | null;
  operador: string | null;
  statusRaw: string | null;
  statusBucket: string;
  assunto: string | null;
  entidade: string | null;
  /** A coluna `Item` inteira. Só é mostrada quando não repete `entidade`. */
  item: string | null;
  categoria: string | null;
  vigencia: string | null;
  sla: string | null;
  prazoPrevisto: string | null;
  abertoEm: string | null;
  encerradoEm: string | null;
  alteradoEmFonte: string | null;
  parametros: number;
  alteracoes: AlteracaoDoChamado[];
  /** Linha física do arquivo, 1-based — o que casa a relação com o Excel. */
  linhaDoArquivo: number;
  /** Este chamado está entre as movimentações do dia — a ponte entre as duas. */
  movimentou: boolean;
}

export interface FilaDoDia {
  dia: string;
  envios: EnvioDaFila[];
  /** O tamanho da fila sem filtro nenhum — o número que rotula a visão. */
  total: number;
  emAberto: number;
  movimentaram: number;
  /** Quantos sobram depois dos filtros. É este que pagina. */
  totalFiltrado: number;
  rows: ChamadoNaFila[];
  filtros: {
    unidades: string[];
    areas: string[];
    responsaveis: string[];
    status: string[];
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

/**
 * O dia da operação a que um instante pertence — `YYYY-MM-DD`.
 *
 * A mesma conta que `diaDaOperacao` faz no servidor, e com o fuso escrito pela
 * razão de `horaLegivel`: um envio das 21h de 02/09 pertence a 02/09, e sem o
 * `timeZone` explícito o navegador de quem abrisse a tela de outro fuso o
 * jogaria para 03/09 — a tela apontaria para um dia em que não houve envio.
 */
export function diaDaOperacaoDe(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_DA_OPERACAO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** `YYYY-MM-DD` em dias inteiros desde a época. Sem fuso: é só aritmética. */
function emDias(dia: string): number {
  const [a, m, d] = dia.split("-").map(Number);
  return Date.UTC(a!, m! - 1, d!) / 86_400_000;
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

/**
 * Quantas linhas a página vai trazer — a altura que a espera tem de reservar.
 *
 * A lista pedia vinte e cinco linhas ao servidor e desenhava cinco barras
 * cinzas enquanto elas vinham: a tela nascia curta e crescia mil pixels no
 * instante da resposta. Quem já estava lendo o cabeçalho via tudo pular, e
 * quem tinha descido até o fim da espera era largado no meio da lista.
 *
 * O número não é chutado. O resumo do dia chega antes da relação e já diz
 * quantos chamados o envio tem; a lista que muda de página já respondeu o
 * total antes. Quando esse total é conhecido, a espera tem exatamente o
 * tamanho da lista que vem — inclusive na última página, que é mais curta.
 *
 * `null` é o único caso em que ninguém sabe de nada, e aí a espera assume a
 * página cheia: é o palpite que erra para o lado de a tela encolher um pouco,
 * e nunca para o de ela dar o salto que esta função existe para tirar.
 */
export function linhasDaPagina({
  total,
  pagina,
  porPagina,
}: {
  /** O total **sem** paginação, ou `null` enquanto ninguém respondeu. */
  total: number | null;
  /** 1-based, como as pessoas contam páginas. */
  pagina: number;
  porPagina: number;
}): number {
  if (total === null) return porPagina;
  const restantes = total - (pagina - 1) * porPagina;
  return Math.max(0, Math.min(restantes, porPagina));
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
/**
 * A frase que cita o tamanho da fila — e a que fica quando não há fila a citar.
 *
 * Um dia pode estar SEM_MOVIMENTACAO com `chamadosNoEnvio` em zero: é o envio
 * que chegou vazio, ou o banco que ainda não tem a contagem. Escrever "0
 * chamados vieram no arquivo" ali seria trocar uma frase certa por uma que
 * parece defeito, e por isso a alternativa não cita número nenhum.
 */
function comChamados(
  resumo: ResumoDoDia,
  comNumero: (chamados: string) => string,
  semNumero: string,
): string {
  const n = resumo.chamadosNoEnvio;
  return n > 0 ? comNumero(n.toLocaleString("pt-BR")) : semNumero;
}

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
        /*
          O tamanho da fila entra na frase, e não é enfeite.

          Sem ele a frase era "os chamados vieram iguais aos da importação
          anterior" sobre uma lista vazia, e quem opera a lia como *"o import
          não trouxe nada"* — o oposto do que aconteceu, e a reclamação que fez
          esta tela ganhar a visão "Chamados do envio". Dizer quantos vieram
          separa "nada mudou" de "nada chegou" numa linha só.
        */
        detalhe: comChamados(
          resumo,
          (n) =>
            `${n} chamados vieram no arquivo e nenhum deles mudou em relação à ` +
            `importação anterior.`,
          "Os chamados vieram iguais aos da importação anterior.",
        ),
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
// A janela da régua e o acervo
// ---------------------------------------------------------------------------

/** O último envio de um recorte, quando ele cai fora da janela da régua. */
export interface EnvioForaDaJanela {
  /** O dia do último envio do recorte — `YYYY-MM-DD`. */
  dia: string;
  /** Dias inteiros entre esse dia e hoje. Nunca negativo: envio não é futuro. */
  diasAtras: number;
  /** A janela que a régua está mostrando, para a tela poder dizê-la. */
  de: string;
  ate: string;
}

/**
 * O envio que existe, mas não nos dias que a régua está mostrando.
 *
 * A régua olha nove dias e termina em hoje. É a janela certa para quem abre a
 * tela todo dia, e é a errada para quem importou uma unidade uma vez, há três
 * semanas: os nove dias saem todos cinza, cada um deles afirmando com razão que
 * *naquele dia* não chegou arquivo — e o conjunto das nove frases verdadeiras
 * diz uma mentira, que é "não há chamados desta unidade".
 *
 * Foi o que aconteceu com CAMAÇARI: 1.218 chamados lidos em 16/08, a tela
 * aberta em 03/09, e nenhum dos dois lados errado. É o mesmo modo de falhar que
 * o cabeçalho de `serie-da-unidade.ts` descreve para a grafia do nome — *abrir
 * vazia sobre um acervo cheio* —, e a resposta aqui é a mesma que a de lá: a
 * tela **diz** onde o dado está, e não se alarga sozinha para alcançá-lo.
 * Deslocar a régua continua sendo uma decisão de quem opera.
 *
 * Devolve `null` — e a tela não diz nada — em todos os casos em que a janela
 * vazia já é a resposta completa:
 *
 * - a régua ainda não chegou (`dias` vazio): não há janela sobre a qual afirmar;
 * - **algum** dia da janela teve envio: a régua já mostra o que há, e o cinza
 *   do dia aberto é sobre aquele dia, não sobre o acervo;
 * - o recorte nunca importou nada: quem responde por isso é `AvisoDoRecorte`
 *   ("Nenhum chamado importado para …"), e dois avisos sobre o mesmo vazio
 *   fazem duvidar dos dois;
 * - o último envio cai **dentro** da janela: contradiz o item acima e não
 *   deveria acontecer, mas afirmar "fora da janela" sobre um dia que está
 *   dentro é pior do que calar.
 */
export function envioForaDaJanela({
  dias,
  series,
  serie,
  hoje,
}: {
  dias: DiaDaRegua[];
  series: Serie[];
  /** O recorte em vigor: `undefined` é todas as séries, `null` é a sem unidade. */
  serie: string | null | undefined;
  hoje: string;
}): EnvioForaDaJanela | null {
  if (dias.length === 0) return null;
  if (dias.some((d) => d.envios > 0 || d.enviosComFalha > 0)) return null;

  /*
    O último envio do recorte, e não o do acervo: com CAMAÇARI aberta, apontar
    para o envio de RECIFE mandaria quem opera a um dia que, no recorte dela,
    continua vazio — a tela teria trocado um vazio sem explicação por um vazio
    com promessa.
  */
  const doRecorte =
    serie === undefined ? series : series.filter((s) => s.serie === serie);
  const instantes = doRecorte
    .map((s) => s.ultimaImportacao)
    .filter((i): i is string => i !== null);
  if (instantes.length === 0) return null;

  const dia = instantes
    .map(diaDaOperacaoDe)
    .reduce((mais, atual) => (atual > mais ? atual : mais));

  const de = dias[0]!.dia;
  const ate = dias[dias.length - 1]!.dia;
  if (dia >= de && dia <= ate) return null;

  return { dia, diasAtras: Math.max(0, emDias(hoje) - emDias(dia)), de, ate };
}

/**
 * O fim da frase da tira: a distância até hoje e a janela que a régua mostra.
 *
 * Mora aqui, e não no JSX, pela razão do cabeçalho deste arquivo: é string
 * entrando e saindo, e no meio de chaves e quebras de linha o espaço entre um
 * `}` e a palavra seguinte depende de onde a linha quebrou — é assim que nasce
 * o "16/08/20261 dia atrás" que passa batido na revisão e aparece pronto na
 * tela de quem opera.
 *
 * Um dia sozinho fala no singular, e zero dia não fala: um envio de hoje que
 * caísse fora da janela (a régua deslocada para trás) diria "0 dias atrás", que
 * é uma distância inventada para uma coisa que aconteceu agora.
 */
export function janelaDoEnvioFora(envio: EnvioForaDaJanela): string {
  const distancia =
    envio.diasAtras > 0
      ? ` — ${envio.diasAtras} ${envio.diasAtras === 1 ? "dia" : "dias"} atrás`
      : "";
  return (
    `${distancia}. A régua está em ` +
    `${diaLegivel(envio.de)}–${diaLegivel(envio.ate)}.`
  );
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

/**
 * A fila do dia — a relação de chamados, paginada.
 *
 * `habilitado` faz mais do que esperar o recorte aqui: a consulta só dispara
 * quando alguém abre a visão. A fila é do tamanho do arquivo, e carregá-la
 * junto com o resumo faria todo dia pagar por uma lista que a maioria dos dias
 * não vai olhar — a mesma razão pela qual ela é rota própria no servidor.
 */
export function useFilaDoDia({
  dia,
  serie,
  filtros,
  pagina,
  porPagina,
  habilitado = true,
}: {
  dia: string;
  serie: string | null | undefined;
  filtros: FiltrosDaTela;
  pagina: number;
  porPagina: number;
  habilitado?: boolean;
}) {
  const endereco = `${BASE}/dia/${dia}/chamados${query([
    comSerie(serie),
    filtros.unidade && `unidade=${encodeURIComponent(filtros.unidade)}`,
    filtros.area && `area=${encodeURIComponent(filtros.area)}`,
    filtros.responsavel && `responsavel=${encodeURIComponent(filtros.responsavel)}`,
    filtros.statusBucket && `statusBucket=${encodeURIComponent(filtros.statusBucket)}`,
    filtros.busca && `busca=${encodeURIComponent(filtros.busca)}`,
    `limit=${porPagina}`,
    `offset=${(pagina - 1) * porPagina}`,
  ])}`;

  return useConsultaResiliente<FilaDoDia>({
    queryKey: [
      "monitoramento-chamados",
      "fila",
      dia,
      serie ?? "todas",
      filtros,
      pagina,
      porPagina,
    ],
    endpoint: `${BASE}/dia/:data/chamados`,
    buscar: () => fetchJson(endereco),
    enabled: habilitado,
  });
}

/**
 * De onde a relação saiu, escrito por extenso.
 *
 * A lista é o arquivo de outra pessoa, e mostrá-la sem dizer de que arquivo ela
 * é seria pedir confiança sem oferecer conferência — é a mesma linha de
 * procedência que a aba Chamados põe acima da lista dela.
 *
 * Com mais de um envio (mais de uma unidade no mesmo dia, que é o caso comum da
 * Visão Geral) o nome de um só mentiria por omissão, e listar todos daria uma
 * frase de dez linhas. A frase conta quantos são.
 */
export function procedenciaDaFila(envios: EnvioDaFila[]): string | null {
  if (envios.length === 0) return null;
  if (envios.length > 1) {
    const total = envios.reduce((soma, e) => soma + e.chamados, 0);
    return `${envios.length} arquivos lidos neste dia · ${total.toLocaleString("pt-BR")} chamados`;
  }
  const envio = envios[0]!;
  const hora = horaLegivel(envio.recebidoEm);
  return (
    `${envio.filename}${hora ? ` · lido às ${hora}` : ""}` +
    `${envio.recebidoPor ? ` · enviado por ${envio.recebidoPor}` : ""}`
  );
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

// ---------------------------------------------------------------------------
// A relação de chamados como tabela
// ---------------------------------------------------------------------------

/**
 * As colunas da relação, na ordem em que a tabela as escreve.
 *
 * `chamado` não está aqui de propósito: é a coluna que identifica a linha, e
 * uma tabela sem ela é uma lista de atributos de coisa nenhuma. O que esta
 * lista descreve é o que a engrenagem do cabeçalho **deixa esconder**.
 *
 * O assunto vem primeiro, colado no número, porque é a informação mais
 * importante da relação: é a única frase que a fonte escreve sobre o chamado —
 * o motivo pelo qual ele existe — e é por ela que quem confere sabe do que a
 * linha trata. Todo o resto é qualificação disso, e nenhuma outra coluna
 * responde "por quê". É também a ordem da lista de Movimentações, onde o
 * assunto já aparece ao lado do número.
 *
 * Depois dele a ordem é a do arquivo lido de cima para baixo — como o chamado
 * está (status), onde ele acontece (unidade, tipo), quem o toca (solicitante,
 * operador), quando (as duas datas) e como ele terminou (SLA, situação).
 */
export const COLUNAS_DA_RELACAO = [
  { chave: "assunto", rotulo: "Assunto", dica: "a Justificativa Abertura do chamado" },
  { chave: "status", rotulo: "Status", dica: "o status como o arquivo escreveu" },
  { chave: "unidade", rotulo: "Unidade", dica: "a unidade como o arquivo a escreve" },
  {
    chave: "tipo",
    rotulo: "Tipo",
    dica: "o Segmento do arquivo — é por ele que o filtro Área recorta",
  },
  { chave: "solicitante", rotulo: "Solicitante", dica: "quem abriu o chamado" },
  { chave: "operador", rotulo: "Operador", dica: "quem toca o chamado" },
  { chave: "abertoEm", rotulo: "Aberto em", dica: "Data Solicitação" },
  {
    chave: "alteradoEmFonte",
    rotulo: "Alterado na fonte",
    dica: "Data Alteração — quando a Ambev mexeu, não quando lemos o arquivo",
  },
  { chave: "sla", rotulo: "SLA", dica: "o prazo previsto, e se ele já passou" },
  { chave: "situacao", rotulo: "Situação", dica: "encerrado ou em aberto no arquivo" },
] as const;

export type ColunaDaRelacao = (typeof COLUNAS_DA_RELACAO)[number]["chave"];

const TODAS_AS_COLUNAS = COLUNAS_DA_RELACAO.map((c) => c.chave);

const CHAVE_DAS_COLUNAS = "freightcheck:monitoramento:colunas-da-relacao";

/**
 * As colunas que ficam à vista — preferência de quem olha, não fato do dado.
 *
 * Em `localStorage` pela razão de `fluxos-visoes.ts`: guardá-la no servidor
 * faria a escolha de uma pessoa mudar a tela de outra. `try/catch` porque
 * `localStorage` lança em janela privada, e esconder uma coluna não é motivo
 * para a tela inteira não abrir.
 *
 * Uma chave desconhecida — coluna que existia numa versão anterior — é
 * descartada na leitura, e uma coluna nova entra visível: o padrão de uma
 * coluna recém-nascida é aparecer, senão ela nasce escondida para todo mundo
 * que já usou a tela e ninguém descobre que ela existe.
 */
export function lerColunasDaRelacao(): ColunaDaRelacao[] {
  try {
    const cru = globalThis.localStorage?.getItem(CHAVE_DAS_COLUNAS);
    if (!cru) return [...TODAS_AS_COLUNAS];
    const lidas = JSON.parse(cru);
    if (!Array.isArray(lidas)) return [...TODAS_AS_COLUNAS];
    const escondidas = new Set(
      TODAS_AS_COLUNAS.filter((c) => !lidas.includes(c)),
    );
    return TODAS_AS_COLUNAS.filter((c) => !escondidas.has(c));
  } catch {
    return [...TODAS_AS_COLUNAS];
  }
}

export function gravarColunasDaRelacao(colunas: ColunaDaRelacao[]): void {
  try {
    globalThis.localStorage?.setItem(CHAVE_DAS_COLUNAS, JSON.stringify(colunas));
  } catch {
    /* Sem armazenamento, a escolha vale só para esta sessão. */
  }
}

/** O que a coluna SLA diz: o prazo passou, ou não. `null` é chamado sem prazo. */
export type SituacaoDoPrazo = "NO_PRAZO" | "ATRASADO" | null;

/**
 * O prazo do chamado contra o dia que está em tela.
 *
 * A régua é a mesma de `criticidadeDoChamado`, no servidor, e foi aprovada
 * assim: **atrasado é o chamado que tem prazo, o prazo já passou e ele não está
 * encerrado**. Um chamado que fechou depois do prazo não vira atrasado aqui —
 * inventar uma segunda régua faria a mesma palavra contar duas populações, e a
 * tela passaria a discordar do número de "atrasados" que o resumo do dia dá.
 *
 * `dia` é o dia da relação, e nunca o relógio de quem lê: abrir 16/08 em
 * setembro tem de mostrar o que 16/08 mostrava, senão a tela repinta o passado
 * a cada abertura.
 */
export function situacaoDoPrazo(
  chamado: { prazoPrevisto: string | null; encerradoEm: string | null },
  dia: string,
): SituacaoDoPrazo {
  if (chamado.prazoPrevisto === null) return null;
  if (chamado.encerradoEm !== null) return "NO_PRAZO";
  return chamado.prazoPrevisto < dia ? "ATRASADO" : "NO_PRAZO";
}

/**
 * `CAMAÇARI` vira `Camaçari`, e `Camaçari` continua `Camaçari`.
 *
 * O export da Ambev grita unidade, segmento e operador em caixa alta, e uma
 * tabela inteira em maiúsculas é mais difícil de varrer do que a mesma tabela
 * em caixa de título. Só o texto **todo** em caixa alta é dobrado: um valor que
 * já venha misturado é escolha da fonte, e mexer nele seria reescrever o dado.
 * A célula mantém o texto original no `title`, para quem confere contra a
 * planilha.
 */
export function emCaixaDeTitulo(texto: string): string {
  if (texto !== texto.toLocaleUpperCase("pt-BR")) return texto;
  return texto
    .toLocaleLowerCase("pt-BR")
    .replace(/(^|[\s/\-·])(\p{L})/gu, (_, antes: string, letra: string) =>
      `${antes}${letra.toLocaleUpperCase("pt-BR")}`,
    );
}
