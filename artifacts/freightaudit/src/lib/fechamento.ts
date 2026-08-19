import { fetchJson, getApiUrl, readJson, erroDaResposta } from "@/lib/api";

/**
 * O cliente do ambiente Fechamento.
 *
 * Os tipos aqui espelham o que `@workspace/fechamento` produz. Eles são
 * reescritos em vez de importados do pacote porque o bundle da interface não
 * deve carregar o motor de apuração: a conta roda no servidor, sobre o que o
 * banco guardou, e a tela só a lê. Um tipo duplicado é o preço de a interface
 * não poder, nem por acidente, calcular remuneração por conta própria.
 */

export type TipoDeFonte = "OPERACAO" | "CTE" | "DISPONIBILIDADE" | "REQUISICOES" | "CONCILIACAO";

export interface Fonte {
  tipo: TipoDeFonte;
  /** O número da rotina do Promax — `03.08.15`. É como quem opera a chama. */
  rotina: string;
  nome: string;
  papel: string;
  extensoes: string[];
}

export interface Competencia {
  id: string;
  chave: string;
  ano: number;
  mes: number;
  quinzena: 1 | 2;
  inicio: string;
  fim: string;
  rotulo: string;
  unidade: { codigo: string; nome: string | null };
  transportadora: { codigo: string; nome: string | null };
  estado: "ABERTA" | "EM_APURACAO" | "APURADA" | "APROVADA" | "ENCERRADA";
  abertaEm: string;
  apuradaEm: string | null;
  encerradaEm: string | null;
  /** Por que a competência foi reaberta, quando foi. */
  motivoDaReabertura: string | null;
}

/** Uma unidade ou transportadora que já apareceu em alguma competência. */
export interface Parte {
  codigo: string;
  nome: string | null;
  competencias: number;
}

export interface Recusa {
  linha: number;
  motivo: string;
  original: string;
}

export interface Documento {
  id: string;
  tipo: TipoDeFonte;
  nomeDoArquivo: string;
  linhasLidas: number;
  recusas: Recusa[];
  vigente: boolean;
  enviadoEm: string;
}

export interface Parcela {
  origem: TipoDeFonte;
  descricao: string;
  semImposto: number | null;
  comImposto: number;
  fator?: number;
  registros: number;
}

export interface VerbaApurada {
  vbz: number;
  canal: string;
  nome: string;
  natureza: string;
  emitido: number;
  baseEmitida: number;
  documentos: number;
  /** Nulo quando nenhuma fonte sustenta a verba. Nulo não é zero. */
  esperado: number | null;
  diferenca: number | null;
  memoria: Parcela[];
}

export interface Divergencia {
  id: string;
  tipo: string;
  canal: string;
  titulo: string;
  valor: number;
  onde: string;
  sentido: "A_RECEBER" | "A_PAGAR" | "INFORMATIVO";
  desfecho: string;
}

export interface Aliquota {
  canal: string;
  fator: number;
  percentual: number;
  medida: { vbzs: number[]; somaSemImposto: number; somaComImposto: number };
}

export interface Apuracao {
  id: string;
  rodadaEm: string;
  fontesPresentes: TipoDeFonte[];
  fontesAusentes: TipoDeFonte[];
  aliquotas: Aliquota[];
  cargaFiscal: { canal: string; percentual: number; fator: number }[];
  totais: { emitido: number; esperado: number; naoConferido: number; diferenca: number };
  verbas: VerbaApurada[];
  divergencias: Divergencia[];
}

export interface CompetenciaAberta {
  competencia: Competencia;
  documentos: Documento[];
  apuracao: Apuracao | null;
}

/* ---------------------------------------------------------------------------
   O diário: a operação dia a dia, e o dia aberto viagem a viagem
   ------------------------------------------------------------------------ */

/** O retrato da viagem — o que a tabela do dia mostra e a conta não usa. */
export interface DetalheDaViagem {
  transportadora: string;
  cargaAtual: string;
  regiao: string;
  veiculo: string;
  entregaOuVolume: string;
  unidadeDeOrigem: string;
  situacaoMultiCdd: string;
  veiculoCadastradoNoCdd: string;
  matriculaDoMotorista: string;
  matriculaDoAjudante1: string;
  matriculaDoAjudante2: string;

  veiculoIndisponivel: string;
  placaIndisponivel: string;
  frotaIndisponivel: string;
  tipoDeIndisponibilidade: string;

  ocupacao: number | null;
  caixasDeRota: number | null;
  caixasDeAs: number | null;
  veiculoBm: number | null;
  rShow: number | null;

  horaDeSaida: string;
  horaDeEntrada: string;
  kmDeSaida: number | null;
  kmDeEntrada: number | null;
  tempoInterno: string;
  tempoDoLaco: string;
  tempoDeDeslocamento: string;
  kmDoLaco: number | null;
  kmDeDeslocamento: number | null;

  tempoPrevisto: string;
  kmPrevisto: number | null;

  custoSpot: number | null;
  custoVariavel: number | null;
  lucro: number | null;
  lucroUnitario: number | null;
  tipoDeImposto: string;
  valorUnitarioPorCaixaEntregue: number | null;
  valorPagoPorCaixaSemImposto: number | null;
  valorPagoPorCaixaComImposto: number | null;
  valorDropdown: number | null;

  valorUnitarioDoPontoDoMotorista: number | null;
  valorUnitarioDoPontoDoAjudante: number | null;
  valorDaEquipeDeEntregaMotorista: number | null;
  valorDaEquipeDeEntregaAjudante: number | null;

  custoVariavelCedbz: number | null;
  lucroUnitarioCedbz: number | null;
  lucroVariavelPorCaixaEntregueFfcedbz: number | null;
}

export interface Viagem {
  /** A linha física no 2Art — a ponta da trilha até a célula de origem. */
  linha: number;
  dia: string;
  canal: string;
  frota: string;
  placa: string;
  mapa: string;
  entregas: number;
  caixasCarregadas: number;
  caixasEntregues: number;
  valorFrete: number;
  percentualDeImposto: number | null;
  valorDeImposto: number;
  valorFaturado: number;
  detalhe?: DetalheDaViagem;
}

export interface TotaisDaOperacao {
  viagens: number;
  entregas: number;
  caixasCarregadas: number;
  caixasEntregues: number;
  freteSemImposto: number;
  imposto: number;
  freteComImposto: number;
}

export interface DiaDaOperacao {
  dia: string;
  numeroDoDia: number;
  /** 0 = domingo. O nome é da tela, que é quem sabe o idioma. */
  diaDaSemana: number;
  totais: TotaisDaOperacao;
  porFrota: (TotaisDaOperacao & { frota: string })[];
  porCanal: (TotaisDaOperacao & { canal: string })[];
}

export interface DiaAberto extends DiaDaOperacao {
  viagens: Viagem[];
}

export interface FonteDoDiario {
  nomeDoArquivo: string;
  linhasLidas: number;
  enviadoEm: string;
}

export interface Diario {
  competencia: Competencia;
  /** Nulo quando o 2Art ainda não foi enviado — e aí a grade nasce vazia. */
  fonte: FonteDoDiario | null;
  dias: DiaDaOperacao[];
  /** Viagens do 2Art fora do período: o arquivo é mensal, a competência é meio mês. */
  viagensForaDoPeriodo: number;
}

export interface DiaDaCompetencia {
  competencia: Competencia;
  fonte: FonteDoDiario | null;
  dia: DiaAberto;
}

export function lerDiario(competenciaId: string): Promise<Diario> {
  return fetchJson<Diario>(`/fechamento/competencias/${competenciaId}/dias`);
}

export function lerDia(competenciaId: string, dia: string): Promise<DiaDaCompetencia> {
  return fetchJson<DiaDaCompetencia>(`/fechamento/competencias/${competenciaId}/dias/${dia}`);
}

/** Como o 2Art escreve o tipo de frota, na palavra que a planilha usa. */
export const NOME_DA_FROTA: Record<string, string> = {
  PADRAO: "Padrão",
  SPOT: "Spot",
  FIXO: "Fixo",
  ESPECIAL: "Especial",
};

/** Domingo a sábado, como o ladrilho os abrevia. */
export const DIAS_DA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function listarFontes(): Promise<Fonte[]> {
  return fetchJson<Fonte[]>("/fechamento/fontes");
}

export function listarCompetencias(): Promise<Competencia[]> {
  return fetchJson<Competencia[]>("/fechamento/competencias");
}

export function lerCompetencia(id: string): Promise<CompetenciaAberta> {
  return fetchJson<CompetenciaAberta>(`/fechamento/competencias/${id}`);
}

export function abrirCompetencia(entrada: {
  ano: number;
  mes: number;
  quinzena: 1 | 2;
  unidade: { codigo: string; nome?: string };
  transportadora: { codigo: string; nome?: string };
}): Promise<Competencia> {
  return fetchJson<Competencia>("/fechamento/competencias", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entrada),
  });
}

export function listarPartes(): Promise<{ unidades: Parte[]; transportadoras: Parte[] }> {
  return fetchJson<{ unidades: Parte[]; transportadoras: Parte[] }>("/fechamento/partes");
}

/** Encerra a competência — congela a quinzena. */
export function encerrar(id: string): Promise<Competencia> {
  return fetchJson<Competencia>(`/fechamento/competencias/${id}/encerramento`, { method: "POST" });
}

/** Reabre uma competência encerrada. O motivo é obrigatório. */
export function reabrir(id: string, motivo: string): Promise<Competencia> {
  return fetchJson<Competencia>(`/fechamento/competencias/${id}/reabertura`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ motivo }),
  });
}

export function apurar(id: string): Promise<Apuracao> {
  return fetchJson<Apuracao>(`/fechamento/competencias/${id}/apuracao`, { method: "POST" });
}

/**
 * Envia um dos cinco relatórios.
 *
 * O arquivo vai em base64 dentro de um JSON, como na importação da Auditoria —
 * ver `routes/fechamento.ts` para o porquê. `FileReader` é usado em vez de
 * `arrayBuffer()` porque o resultado dele já é a data URL de que só o prefixo
 * precisa ser cortado, e o corte é uma linha em vez de uma conversão manual de
 * bytes que é fácil de errar por um caractere.
 */
export async function enviarDocumento(
  competenciaId: string,
  tipo: TipoDeFonte,
  arquivo: File,
): Promise<Documento> {
  const contentBase64 = await lerComoBase64(arquivo);
  const resposta = await fetch(getApiUrl(`/fechamento/competencias/${competenciaId}/documentos`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ tipo, filename: arquivo.name, contentBase64 }),
  });
  const corpo = await readJson(resposta);
  if (!resposta.ok) throw erroDaResposta(resposta, corpo);
  return corpo as unknown as Documento;
}

function lerComoBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error(`Não foi possível ler "${arquivo.name}".`));
    leitor.onload = () => {
      const resultado = String(leitor.result ?? "");
      const virgula = resultado.indexOf(",");
      resolve(virgula >= 0 ? resultado.slice(virgula + 1) : resultado);
    };
    leitor.readAsDataURL(arquivo);
  });
}

/** O estado da competência, em palavra que quem opera reconhece. */
export const NOME_DO_ESTADO: Record<Competencia["estado"], string> = {
  ABERTA: "Aberta",
  EM_APURACAO: "Em apuração",
  APURADA: "Apurada",
  APROVADA: "Aprovada",
  ENCERRADA: "Encerrada",
};

/** O que cada divergência significa, em uma frase. */
export const EXPLICACAO_DA_DIVERGENCIA: Record<string, string> = {
  VERBA_SEM_ORIGEM:
    "Foi emitido CT-e nesta verba e nenhuma das cinco fontes a sustenta. Não é erro — é a parte fixa do contrato, que ainda não tem fonte aqui.",
  VERBA_NAO_FECHA:
    "A apuração reconstruiu esta verba a partir das fontes e chegou a um valor diferente do emitido.",
  REQUISICAO_NAO_FATURADA:
    "Uma despesa foi aprovada no SRTrans e não virou CT-e nenhum. É valor aprovado que não foi pago.",
  DESCONTO_FRETE_MINIMO:
    "O SRTrans reduziu o valor calculado por frete mínimo. Aparece só na coluna do calculado, sem contrapartida no emitido.",
  SALDO_ATRAVESSANDO:
    "Valor que não se resolveu nesta quinzena e foi empurrado para a seguinte, incluindo nota fiscal sem CT-e.",
  DESCONTO_DE_DISPONIBILIDADE:
    "Desconto sobre a parcela fixa por veículo que não rodou, atribuído à transportadora. Reclassificar o gap para a Ambev devolve o valor.",
  OPERACAO_NAO_FECHA:
    "O que o 2Art registra de frete no canal não bate com o que o SRTrans diz ter calculado.",
  AVISO_DA_CONCILIACAO: "O relatório do Promax trouxe um aviso sem valor associado.",
};
