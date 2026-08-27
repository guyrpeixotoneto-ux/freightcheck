/**
 * O CATÁLOGO — o vocabulário do motor, num arquivo só.
 *
 * Tipo de etapa, tipo de conexão, espécie de item, status e sentido de
 * indicador vivem aqui e em nenhum outro lugar. O banco guarda `text` sem
 * `CHECK` justamente para que acrescentar um valor seja **esta** linha e mais
 * nada: sem migration, sem `ALTER TYPE`, sem redeploy coordenado do banco.
 *
 * Cada entrada carrega o que a interface precisa para desenhá-la — rótulo,
 * descrição e um par de tokens visuais — porque a alternativa é um `switch` por
 * tipo espalhado em cada componente, e é assim que um tipo novo passa a exigir
 * "retrabalho estrutural". Os tokens são nomes de classe do tema do
 * FreightCheck, não cores literais: quem muda a paleta muda o tema, não isto.
 *
 * **Nada aqui sabe o que é um CTe.** `VALIDACAO` é uma etapa que confere algo;
 * que ela confira regra de CTe, dado cadastral de fornecedor ou saldo bancário
 * é assunto do fluxo cadastrado, nunca do catálogo.
 */

export type TipoDeEtapa =
  | "INICIO"
  | "PROCESSO"
  | "DECISAO"
  | "VALIDACAO"
  | "DOCUMENTO"
  | "SISTEMA"
  | "PENDENCIA"
  | "FIM";

export type TipoDeConexao =
  | "SEQUENCIA"
  | "DECISAO_SIM"
  | "DECISAO_NAO"
  | "EXCECAO"
  | "RETRABALHO";

export type EspecieDeItem =
  | "SISTEMA"
  | "DOCUMENTO"
  | "RESPONSAVEL"
  | "FALHA"
  | "GARGALO";

export type StatusDoFluxo = "RASCUNHO" | "ATIVO" | "ARQUIVADO";
export type StatusDaEtapa = "ATIVO" | "ATENCAO" | "INATIVO";
export type SentidoDoIndicador = "MAIOR_MELHOR" | "MENOR_MELHOR" | "NEUTRO";

/** A forma de toda entrada do catálogo: o mínimo que a tela precisa saber. */
export interface EntradaDoCatalogo<T extends string> {
  valor: T;
  rotulo: string;
  descricao: string;
}

export interface EntradaDeTipoDeEtapa extends EntradaDoCatalogo<TipoDeEtapa> {
  /**
   * A forma do cartão no canvas. Três formas, e não oito: o que precisa ser
   * distinguível de relance é "isto decide", "isto começa/termina" e "isto
   * executa". Oito formas diferentes seriam oito coisas para decorar.
   */
  forma: "retangulo" | "losango" | "pilula";
  /** Classes do tema — a borda e o fundo do cartão. */
  classe: string;
  /** O nome do ícone `lucide-react` que a interface monta. */
  icone: string;
}

export const TIPOS_DE_ETAPA: readonly EntradaDeTipoDeEtapa[] = [
  {
    valor: "INICIO",
    rotulo: "Início",
    descricao: "Onde o processo começa. Um fluxo normalmente tem um só.",
    forma: "pilula",
    classe: "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950",
    icone: "Play",
  },
  {
    valor: "PROCESSO",
    rotulo: "Processo",
    descricao: "Uma atividade executada por alguém ou por um sistema.",
    forma: "retangulo",
    classe: "border-border bg-card",
    icone: "Square",
  },
  {
    valor: "DECISAO",
    rotulo: "Decisão",
    descricao: "Um ponto em que o caminho se divide conforme uma condição.",
    forma: "losango",
    classe: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950",
    icone: "GitBranch",
  },
  {
    valor: "VALIDACAO",
    rotulo: "Validação",
    descricao: "Uma conferência que aprova ou devolve o que chegou.",
    forma: "retangulo",
    classe: "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950",
    icone: "ShieldCheck",
  },
  {
    valor: "DOCUMENTO",
    rotulo: "Documento",
    descricao: "A emissão ou o recebimento de um documento.",
    forma: "retangulo",
    classe: "border-violet-300 bg-violet-50 dark:border-violet-800 dark:bg-violet-950",
    icone: "FileText",
  },
  {
    valor: "SISTEMA",
    rotulo: "Sistema",
    descricao: "Um passo que acontece dentro de um sistema, com ou sem gente.",
    forma: "retangulo",
    classe: "border-indigo-300 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950",
    icone: "Server",
  },
  {
    valor: "PENDENCIA",
    rotulo: "Pendência",
    descricao: "Uma espera ou um tratamento de exceção fora do caminho feliz.",
    forma: "retangulo",
    classe: "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950",
    icone: "AlertTriangle",
  },
  {
    valor: "FIM",
    rotulo: "Fim",
    descricao: "Onde o processo termina.",
    forma: "pilula",
    classe: "border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-900",
    icone: "Flag",
  },
];

export interface EntradaDeTipoDeConexao extends EntradaDoCatalogo<TipoDeConexao> {
  /** Traço contínuo ou pontilhado — o que separa caminho normal de desvio. */
  tracejada: boolean;
  /** Classe do traço no tema. */
  classe: string;
}

export const TIPOS_DE_CONEXAO: readonly EntradaDeTipoDeConexao[] = [
  {
    valor: "SEQUENCIA",
    rotulo: "Sequência",
    descricao: "O caminho normal: terminou aqui, segue ali.",
    tracejada: false,
    classe: "stroke-slate-400",
  },
  {
    valor: "DECISAO_SIM",
    rotulo: "Decisão — sim",
    descricao: "A saída da decisão quando a condição é atendida.",
    tracejada: false,
    classe: "stroke-emerald-500",
  },
  {
    valor: "DECISAO_NAO",
    rotulo: "Decisão — não",
    descricao: "A saída da decisão quando a condição não é atendida.",
    tracejada: false,
    classe: "stroke-rose-500",
  },
  {
    valor: "EXCECAO",
    rotulo: "Exceção",
    descricao: "Um desvio por falha, fora do caminho previsto.",
    tracejada: true,
    classe: "stroke-amber-500",
  },
  {
    valor: "RETRABALHO",
    rotulo: "Retrabalho",
    descricao: "A volta para uma etapa anterior — corrigir e refazer.",
    tracejada: true,
    classe: "stroke-violet-500",
  },
];

export interface EntradaDeEspecie extends EntradaDoCatalogo<EspecieDeItem> {
  /** O título da seção no painel lateral. */
  titulo: string;
  /** O nome do ícone `lucide-react`. */
  icone: string;
  /** A espécie usa o campo `link`? (só SISTEMA) */
  usaLink: boolean;
  /** A espécie usa o campo `obrigatorio`? (só DOCUMENTO) */
  usaObrigatorio: boolean;
}

export const ESPECIES_DE_ITEM: readonly EntradaDeEspecie[] = [
  {
    valor: "SISTEMA",
    rotulo: "Sistema",
    titulo: "Sistemas",
    descricao: "Onde a etapa acontece — ERP, TMS, portal, banco, aplicativo.",
    icone: "Server",
    usaLink: true,
    usaObrigatorio: false,
  },
  {
    valor: "DOCUMENTO",
    rotulo: "Documento",
    titulo: "Documentos",
    descricao: "O que entra ou sai da etapa — XML, canhoto, boleto, comprovante.",
    icone: "FileText",
    usaLink: false,
    usaObrigatorio: true,
  },
  {
    valor: "RESPONSAVEL",
    rotulo: "Responsável",
    titulo: "Responsáveis",
    descricao: "Área, função ou pessoa que executa a etapa.",
    icone: "Users",
    usaLink: false,
    usaObrigatorio: false,
  },
  {
    valor: "FALHA",
    rotulo: "Falha possível",
    titulo: "Falhas possíveis",
    descricao: "O que costuma dar errado aqui.",
    icone: "AlertTriangle",
    usaLink: false,
    usaObrigatorio: false,
  },
  {
    valor: "GARGALO",
    rotulo: "Gargalo",
    titulo: "Gargalos",
    descricao: "O que trava ou atrasa a etapa mesmo quando nada falha.",
    icone: "Hourglass",
    usaLink: false,
    usaObrigatorio: false,
  },
];

export const STATUS_DO_FLUXO: readonly EntradaDoCatalogo<StatusDoFluxo>[] = [
  {
    valor: "RASCUNHO",
    rotulo: "Rascunho",
    descricao: "Em construção. Aparece na lista, mas ainda não descreve a operação.",
  },
  {
    valor: "ATIVO",
    rotulo: "Ativo",
    descricao: "Descreve como o processo funciona hoje.",
  },
  {
    valor: "ARQUIVADO",
    rotulo: "Arquivado",
    descricao: "Fora de uso. Some da lista padrão e continua consultável.",
  },
];

export const STATUS_DA_ETAPA: readonly EntradaDoCatalogo<StatusDaEtapa>[] = [
  { valor: "ATIVO", rotulo: "Ativa", descricao: "A etapa faz parte do processo." },
  {
    valor: "ATENCAO",
    rotulo: "Atenção",
    descricao: "A etapa existe e é reconhecidamente problemática.",
  },
  {
    valor: "INATIVO",
    rotulo: "Inativa",
    descricao: "Documentada e fora de uso — mantida para leitura do histórico.",
  },
];

export const SENTIDOS_DO_INDICADOR: readonly EntradaDoCatalogo<SentidoDoIndicador>[] = [
  { valor: "MAIOR_MELHOR", rotulo: "Maior é melhor", descricao: "% de acerto, cobertura." },
  { valor: "MENOR_MELHOR", rotulo: "Menor é melhor", descricao: "Tempo médio, rejeições." },
  { valor: "NEUTRO", rotulo: "Sem sentido definido", descricao: "Contagem, volume." },
];

/**
 * O catálogo inteiro num objeto — o que a API devolve e a interface consome.
 *
 * Existe para que a tela **não** tenha a sua própria cópia da lista. Uma
 * segunda cópia no front é o jeito conhecido de um tipo novo aparecer no banco
 * e não aparecer na tela; servindo o catálogo pela mesma API que serve o
 * fluxo, isso não tem como acontecer.
 */
export const CATALOGO = {
  tiposDeEtapa: TIPOS_DE_ETAPA,
  tiposDeConexao: TIPOS_DE_CONEXAO,
  especiesDeItem: ESPECIES_DE_ITEM,
  statusDoFluxo: STATUS_DO_FLUXO,
  statusDaEtapa: STATUS_DA_ETAPA,
  sentidosDoIndicador: SENTIDOS_DO_INDICADOR,
} as const;

export type Catalogo = typeof CATALOGO;

const valores = <T extends string>(lista: readonly EntradaDoCatalogo<T>[]): Set<string> =>
  new Set(lista.map((e) => e.valor));

const TIPOS_DE_ETAPA_VALIDOS = valores(TIPOS_DE_ETAPA);
const TIPOS_DE_CONEXAO_VALIDOS = valores(TIPOS_DE_CONEXAO);
const ESPECIES_VALIDAS = valores(ESPECIES_DE_ITEM);
const STATUS_DE_FLUXO_VALIDOS = valores(STATUS_DO_FLUXO);
const STATUS_DE_ETAPA_VALIDOS = valores(STATUS_DA_ETAPA);
const SENTIDOS_VALIDOS = valores(SENTIDOS_DO_INDICADOR);

export const ehTipoDeEtapa = (v: unknown): v is TipoDeEtapa =>
  typeof v === "string" && TIPOS_DE_ETAPA_VALIDOS.has(v);
export const ehTipoDeConexao = (v: unknown): v is TipoDeConexao =>
  typeof v === "string" && TIPOS_DE_CONEXAO_VALIDOS.has(v);
export const ehEspecieDeItem = (v: unknown): v is EspecieDeItem =>
  typeof v === "string" && ESPECIES_VALIDAS.has(v);
export const ehStatusDoFluxo = (v: unknown): v is StatusDoFluxo =>
  typeof v === "string" && STATUS_DE_FLUXO_VALIDOS.has(v);
export const ehStatusDaEtapa = (v: unknown): v is StatusDaEtapa =>
  typeof v === "string" && STATUS_DE_ETAPA_VALIDOS.has(v);
export const ehSentidoDoIndicador = (v: unknown): v is SentidoDoIndicador =>
  typeof v === "string" && SENTIDOS_VALIDOS.has(v);

/** O rótulo de um valor, ou o próprio valor quando ele não está no catálogo. */
export function rotuloDe<T extends string>(
  lista: readonly EntradaDoCatalogo<T>[],
  valor: string,
): string {
  return lista.find((e) => e.valor === valor)?.rotulo ?? valor;
}
