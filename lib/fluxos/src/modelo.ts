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

/** A linha da tela de listagem — o fluxo mais o que só um `count` responde. */
export interface FluxoNaLista extends Fluxo {
  etapas: number;
  conexoes: number;
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

/** O fluxo inteiro numa leitura só — o que a tela de visualização recebe. */
export interface FluxoCompleto {
  fluxo: Fluxo;
  etapas: Etapa[];
  conexoes: Conexao[];
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
