/**
 * O que `/api/balance` devolve, do jeito que a tela lê.
 *
 * As formas são declaradas aqui e não importadas de `@workspace/balance` pela
 * mesma razão das outras telas: a interface conversa com a API por HTTP, e uma
 * dependência de tipo daria a impressão de um contrato que o navegador não tem
 * como verificar. O que existe é o JSON — e é ele que está escrito abaixo.
 */

export type DestinoNatureza =
  | "FATO"
  | "OUTRO_PAPEL"
  | "DESCARTE"
  | "PERDA"
  | "RESIDUO";

export interface DestinoContagem {
  code: string;
  natureza: DestinoNatureza;
  nome: string;
  explicacao: string;
  celulas: number;
}

export interface BalancoResumo {
  importRunId: string;
  filename: string;
  contentSha256: string;
  status: string;
  recebidoEm: string;
  entrada: number;
  entradaRegistrada: number;
  capturaConfere: boolean;
  destinos: DestinoContagem[];
  porNatureza: Record<DestinoNatureza, number>;
  residuo: number;
  fecha: boolean;
}

export interface AbaBalanco {
  sheetName: string;
  role: string;
  roleReason: string;
  celulas: number;
  virouFato: number;
  perda: number;
  residuo: number;
}

export interface AmostraCelula {
  code: string;
  sheetName: string;
  rowIndex: number;
  columnLetter: string;
  columnHeader: string | null;
  rawValue: string | null;
}

export interface VigenciaBalanco {
  label: string;
  effectiveDate: string | null;
  snapshotId: string | null;
  revision: number | null;
  status: string | null;
  preparados: number;
  declarados: number | null;
  promovidos: number;
  comLastroNoArquivo: number;
  fecha: boolean;
}

export interface SemanticaContagem {
  status: string;
  fatos: number;
  ausencias: number;
}

export interface BalancoImportacao extends BalancoResumo {
  etapa1: {
    porAba: AbaBalanco[];
    amostras: AmostraCelula[];
  };
  etapa2: {
    preparados: number;
    celulasDeOrigem: number;
    promovidos: number;
    naoPromovidos: number;
    porQueNaoPromoveu: string | null;
    vigencias: VigenciaBalanco[];
    fecha: boolean;
  };
  etapa3: {
    fatos: number;
    podeSomar: number;
    semPreco: number;
    ausencias: number;
    porSemantica: SemanticaContagem[];
  };
}

/**
 * Como cada natureza aparece na tela.
 *
 * A cor separa o que a conta separa, e nada além disso: verde é a massa que
 * virou fato, azul a que foi consumida em outro papel, cinza o descarte sem
 * perda, âmbar a perda declarada, vermelho o resíduo. Um resíduo em cinza
 * transformaria o defeito mais grave que esta tela pode encontrar na coisa mais
 * discreta dela.
 */
export const NATUREZAS: {
  code: DestinoNatureza;
  nome: string;
  barra: string;
  texto: string;
  resumo: string;
}[] = [
  {
    code: "FATO",
    nome: "Virou fato",
    barra: "bg-emerald-500",
    texto: "text-emerald-700",
    resumo: "seguiu para o preparo, e é a massa que a auditoria enxerga",
  },
  {
    code: "OUTRO_PAPEL",
    nome: "Outro papel",
    barra: "bg-sky-500",
    texto: "text-sky-700",
    resumo: "virou cabeçalho, vigência ou identidade do equipamento",
  },
  {
    code: "DESCARTE",
    nome: "Descarte declarado",
    barra: "bg-slate-400",
    texto: "text-slate-600",
    resumo: "saiu por regra escrita, sem perder informação",
  },
  {
    code: "PERDA",
    nome: "Perda declarada",
    barra: "bg-amber-500",
    texto: "text-amber-700",
    resumo: "o arquivo trazia e o sistema não aproveitou",
  },
  {
    code: "RESIDUO",
    nome: "Sem destino",
    barra: "bg-red-600",
    texto: "text-red-700",
    resumo: "massa que sumiu sem que o sistema saiba dizer para onde",
  },
];

export function natureza(code: DestinoNatureza) {
  return NATUREZAS.find((n) => n.code === code)!;
}
