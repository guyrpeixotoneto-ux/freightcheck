import type {
  EspecieDeItem,
  SentidoDoIndicador,
  StatusDaEtapa,
  StatusDoFluxo,
  TipoDeConexao,
  TipoDeEtapa,
} from "./catalogo";

/**
 * O que sai pela API, e o que entra por ela.
 *
 * São dois conjuntos separados de propósito. O que **sai** carrega `id`,
 * `empresaId` e carimbos; o que **entra** não carrega nenhum dos três — a
 * empresa de uma escrita nunca vem do cliente, ela é resolvida no servidor a
 * partir do escopo da requisição e conferida contra o fluxo (ver
 * `repositorio.ts` e `routes/fluxos.ts`). Um tipo de entrada que aceitasse
 * `empresaId` deixaria essa regra depender de alguém lembrar de ignorá-lo.
 */

export interface Fluxo {
  id: string;
  empresaId: string;
  nome: string;
  slug: string;
  descricao: string | null;
  objetivo: string | null;
  categoria: string;
  status: StatusDoFluxo;
  versao: number;
  dono: string | null;
  criadoEm: string;
  atualizadoEm: string;
  criadoPor: string | null;
  atualizadoPor: string | null;
}

/**
 * A linha da tela de listagem — o fluxo mais o que só um `count` responde, e
 * de onde ele pendura.
 */
export interface FluxoNaLista extends Fluxo {
  etapas: number;
  conexoes: number;
  /**
   * A etapa que este fluxo detalha, quando ele é subfluxo de alguém — o mesmo
   * vínculo de `Etapa.subfluxoId`, lido do lado de baixo.
   *
   * Sem isto a listagem é plana e um subfluxo aparece ao lado do processo que
   * ele detalha, como se fossem dois processos irmãos: quem abriu a tela vê
   * "Origem da tarifa" e "Operação Empurrada" no mesmo nível, e nada diz que a
   * primeira é um pedaço da segunda. É `null` para fluxo raiz.
   */
  pai: PaiNaLista | null;
}

/** O degrau de cima de uma linha da listagem: quem detalha o quê. */
export interface PaiNaLista {
  fluxoId: string;
  etapaId: string;
  etapaNome: string;
}

export interface ItemDaEtapa {
  id: string;
  especie: EspecieDeItem;
  nome: string;
  descricao: string | null;
  obrigatorio: boolean | null;
  link: string | null;
  ordem: number;
}

export interface IndicadorDaEtapa {
  id: string;
  nome: string;
  descricao: string | null;
  unidade: string | null;
  sentido: SentidoDoIndicador;
  origem: string | null;
  ordem: number;
}

export interface AcaoDaEtapa {
  id: string;
  titulo: string;
  descricao: string | null;
  rota: string;
  parametros: Record<string, string> | null;
  icone: string | null;
  ordem: number;
}

export interface Etapa {
  id: string;
  fluxoId: string;
  nome: string;
  descricao: string | null;
  tipo: TipoDeEtapa;
  ordem: number;
  responsavel: string | null;
  area: string | null;
  objetivo: string | null;
  sistemaPrincipal: string | null;
  regras: string | null;
  /** O que a etapa consulta para ser executada — relatórios, telas, planilhas. */
  informacoesConsultadas: string | null;
  observacoes: string | null;
  status: StatusDaEtapa;
  posX: number;
  posY: number;
  chaveMonitoramento: string | null;
  /**
   * O fluxo que detalha esta etapa, quando existe — ver `subfluxo_id` em
   * `schema/fluxo.ts`. É só o `id`: o nome e a contagem de etapas do detalhe
   * vêm em `FluxoCompleto.subfluxos`, porque são resultado de um join e não
   * um campo da linha.
   */
  subfluxoId: string | null;
  itens: ItemDaEtapa[];
  indicadores: IndicadorDaEtapa[];
  acoes: AcaoDaEtapa[];
}

export interface Conexao {
  id: string;
  fluxoId: string;
  origemEtapaId: string;
  destinoEtapaId: string;
  tipo: TipoDeConexao;
  rotulo: string | null;
  ordem: number;
}

/**
 * O cabeçalho de um subfluxo, do ponto de vista de quem o referencia.
 *
 * O suficiente para o cartão da etapa dizer "isto abre um processo de 8 etapas"
 * sem uma segunda ida ao servidor, e nada além disso: quem quer o detalhe abre
 * o fluxo, que é uma tela que já existe.
 */
export interface ResumoDeSubfluxo {
  id: string;
  nome: string;
  slug: string;
  categoria: string;
  status: StatusDoFluxo;
  etapas: number;
}

/**
 * Um degrau do caminho de volta — o fluxo pai e a etapa que trouxe até aqui.
 *
 * Sem isto, um subfluxo é um fluxo órfão: ele aparece na listagem geral sem
 * dizer de onde veio, e quem entrou por uma etapa não tem como voltar para o
 * processo que estava lendo. A trilha vem da raiz para o pai imediato, na ordem
 * em que se lê.
 */
export interface DegrauDaTrilha {
  fluxoId: string;
  fluxoNome: string;
  etapaId: string;
  etapaNome: string;
}

/** O fluxo inteiro numa leitura só — o que a tela de visualização recebe. */
export interface FluxoCompleto {
  fluxo: Fluxo;
  etapas: Etapa[];
  conexoes: Conexao[];
  /**
   * Os subfluxos referenciados pelas etapas acima, um por `subfluxoId` distinto.
   * Fica aqui, e não dentro de cada etapa, porque é o resultado de um join: a
   * etapa guarda a referência, a leitura resolve o que ela aponta.
   */
  subfluxos: ResumoDeSubfluxo[];
  /** De onde este fluxo é detalhe — vazio quando ele é raiz. */
  trilha: DegrauDaTrilha[];
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export interface EntradaDeFluxo {
  nome: string;
  slug?: string;
  descricao?: string | null;
  objetivo?: string | null;
  categoria: string;
  status?: StatusDoFluxo;
  dono?: string | null;
}

export interface EntradaDeItem {
  especie: EspecieDeItem;
  nome: string;
  descricao?: string | null;
  obrigatorio?: boolean | null;
  link?: string | null;
  ordem?: number;
}

export interface EntradaDeIndicador {
  nome: string;
  descricao?: string | null;
  unidade?: string | null;
  sentido?: SentidoDoIndicador;
  origem?: string | null;
  ordem?: number;
}

export interface EntradaDeAcao {
  titulo: string;
  descricao?: string | null;
  rota: string;
  parametros?: Record<string, string> | null;
  icone?: string | null;
  ordem?: number;
}

export interface EntradaDeEtapa {
  nome: string;
  descricao?: string | null;
  tipo?: TipoDeEtapa;
  ordem?: number;
  responsavel?: string | null;
  area?: string | null;
  objetivo?: string | null;
  sistemaPrincipal?: string | null;
  regras?: string | null;
  informacoesConsultadas?: string | null;
  observacoes?: string | null;
  status?: StatusDaEtapa;
  posX?: number;
  posY?: number;
  chaveMonitoramento?: string | null;
}

export interface EntradaDeConexao {
  origemEtapaId: string;
  destinoEtapaId: string;
  tipo?: TipoDeConexao;
  rotulo?: string | null;
  ordem?: number;
}

/** Uma posição no canvas, para o salvamento em lote do arrastar. */
export interface PosicaoDaEtapa {
  etapaId: string;
  posX: number;
  posY: number;
}

// ---------------------------------------------------------------------------
// A forma declarativa de um fluxo — o que uma seed traz
// ---------------------------------------------------------------------------

/**
 * Um fluxo inteiro descrito em dado, com as etapas referidas por uma chave
 * local em vez de por `id`.
 *
 * É o formato de `exemplos/`, e é o mesmo formato que o `POST /fluxos/importar`
 * aceita. O ponto é que **não existe caminho de código especial para semear**:
 * a seed do CTe passa exatamente pelas mesmas funções que a tela usa quando
 * alguém cria um fluxo à mão. Se a semeadura precisasse de um atalho, seria
 * sinal de que a API não é suficiente — e o critério de aceite deste módulo é
 * justamente que ela seja.
 */
export interface EtapaDeclarada extends EntradaDeEtapa {
  /** A chave local, única dentro da declaração. Nunca vai para o banco. */
  chave: string;
  itens?: EntradaDeItem[];
  indicadores?: EntradaDeIndicador[];
  acoes?: EntradaDeAcao[];
}

export interface ConexaoDeclarada {
  de: string;
  para: string;
  tipo?: TipoDeConexao;
  rotulo?: string | null;
  ordem?: number;
}

export interface FluxoDeclarado extends EntradaDeFluxo {
  slug: string;
  etapas: EtapaDeclarada[];
  conexoes: ConexaoDeclarada[];
}
