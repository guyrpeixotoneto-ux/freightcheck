import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import * as XLSX from "xlsx";
import { eq, and, sql } from "drizzle-orm";
import {
  type Database,
  attributeTable,
  ticketChangeTable,
  ticketImportTable,
  ticketTable,
} from "@workspace/db";
import { excelSerialToDate, isPlausibleDateSerial } from "./excel-dates";
import { foldText, slugifyColumn } from "./workbook";

/**
 * Ler um export de chamados.
 *
 * A planilha de vigência é um cadastro com grão conhecido — uma linha por
 * ativo, colunas que já vimos antes — e por isso o pipeline dela pode exigir
 * `vigencia` e `placa` e recusar o que não tiver. O export de chamados não tem
 * essa sorte: cada fila do Freightech exporta com um recorte de colunas
 * diferente, e a mesma coisa se chama "Nº do chamado" numa e "Number" noutra.
 *
 * A resposta a isso não é adivinhar melhor em silêncio. É mapear o que se
 * reconhece, **escrever por que** se reconheceu, listar o que sobrou sem
 * destino, e guardar a linha inteira do arquivo em `payload` — de modo que um
 * mapeamento errado seja corrigível depois sem o arquivo original na mão.
 *
 * **Dois formatos, e o largo é o normal.** O export costuma vir como a planilha
 * de vigência: uma linha por chamado, e dezenas de colunas de parâmetro de
 * remuneração ao lado, preenchidas só onde aquele chamado mexeu. Cada célula
 * preenchida vira uma linha de `ticket_change` — é assim que um chamado que
 * altera oito parâmetros produz oito alterações em vez de sete perdidas.
 *
 * O formato estreito — colunas `Parâmetro`, `Valor pedido`, `Valor aplicado` —
 * continua sendo lido, e produz uma alteração por linha. Qual dos dois está na
 * frente se decide por uma pergunta só: existe uma coluna `Parâmetro`?
 */

// ---------------------------------------------------------------------------
// Mapeamento de colunas
// ---------------------------------------------------------------------------

/** Os campos que sabemos preencher a partir de um export de chamados. */
export type TicketField =
  | "externalId"
  | "openedAt"
  | "closedAt"
  | "statusRaw"
  | "changeKind"
  | "vigenciaLabel"
  | "parameterLabel"
  | "entityDescription"
  | "entityLabel"
  | "entityType"
  | "valueBeforeRaw"
  | "requestedValueRaw"
  | "appliedValueRaw"
  | "requestedBy"
  | "subject";

/**
 * Os nomes por que cada campo já apareceu, em forma dobrada.
 *
 * A ordem das chaves é a ordem de disputa: quando dois campos aceitariam o
 * mesmo cabeçalho por aproximação, o primeiro daqui fica com ele. Por isso
 * `externalId` vem antes de tudo (é a coluna que não pode faltar) e `subject`
 * vem por último (é o campo mais vago, e o que menos custa perder).
 */
const ALIASES: Record<TicketField, string[]> = {
  externalId: [
    // `B.O` é como o export do Freightech chama o número do chamado — depois
    // do dobramento, que come o ponto, ele chega aqui como "bo". Era a única
    // coluna obrigatória que faltava, e sem ela o arquivo inteiro era recusado.
    "bo",
    "b o",
    "chamado",
    "numero do chamado",
    "n do chamado",
    "no do chamado",
    "num chamado",
    "numero chamado",
    "codigo do chamado",
    "id do chamado",
    "protocolo",
    "ticket",
    "number",
    "incident",
  ],
  openedAt: [
    "data solicitacao",
    "data da solicitacao",
    "data de solicitacao",
    "abertura",
    "data de abertura",
    "data abertura",
    "aberto em",
    "criado em",
    "data de criacao",
    "opened",
    "opened at",
    "created",
    "created on",
  ],
  closedAt: [
    "data aprovacao",
    "data da aprovacao",
    "data de aprovacao",
    "fechamento",
    "data de fechamento",
    "data fechamento",
    "encerrado em",
    "fechado em",
    "conclusao",
    "data de conclusao",
    "resolvido em",
    "closed",
    "closed at",
    "resolved",
  ],
  statusRaw: ["status", "situacao", "estado do chamado", "state", "andamento"],
  changeKind: ["operacao", "tipo de operacao", "acao", "operation"],
  vigenciaLabel: [
    "vig abertura",
    "vigencia abertura",
    "vigencia de abertura",
    "vig aplicacao",
    // "vigencia" sozinho fica de fora: é palavra comum demais e, por
    // aproximação, uma coluna chamada "Valor aplicado na vigência" era
    // reclamada por este campo em vez de pelo valor aplicado. Perder um
    // cabeçalho genérico custa menos que roubar um específico.
  ],
  parameterLabel: [
    "campo alteracao",
    "campo alterado",
    "campo de alteracao",
    "parametro",
    "atributo",
    "campo",
    "variavel",
    "coluna",
    "item alterado",
    "parametro alterado",
  ],
  entityDescription: ["item", "objeto", "descricao do item"],
  entityLabel: ["placa", "equipamento", "ativo", "veiculo", "frota"],
  entityType: [
    "tipo de equipamento",
    "tipo do equipamento",
    "tipo de ativo",
    "tipo do ativo",
    "tipo de veiculo",
  ],
  valueBeforeRaw: [
    "valor antigo",
    "valor anterior",
    "valor atual",
    "valor vigente",
    "valor original",
    "valor de origem",
    "old value",
  ],
  requestedValueRaw: [
    "valor solicitado",
    "valor pedido",
    "valor requisitado",
    "valor pleiteado",
    "valor proposto",
    "valor novo",
    "solicitado",
    "pedido",
    "new value",
  ],
  appliedValueRaw: [
    "valor aplicado",
    "valor atendido",
    "valor aprovado",
    "valor concedido",
    "valor deferido",
    "valor final",
    "aplicado",
    "atendido",
  ],
  requestedBy: [
    "solicitante",
    "requisitante",
    "aberto por",
    "responsavel",
    "usuario",
    "opened by",
    "requester",
  ],
  subject: [
    "justificativa abertura",
    "justificativa",
    "assunto",
    "descricao",
    "titulo",
    "resumo",
    "observacao",
    "observacoes",
    "short description",
    "description",
  ],
};

const FIELDS = Object.keys(ALIASES) as TicketField[];

/**
 * Um cabeçalho dobrado para comparação.
 *
 * `foldText` tira os acentos, e isso não basta aqui: "Nº do chamado" é como
 * meio Brasil escreve essa coluna, e o indicador ordinal (`º`, `°`) não é uma
 * letra acentuada — sobrevive à decomposição e faz o cabeçalho mais comum de
 * todos deixar de casar com qualquer nome conhecido. O ponto de "N. do
 * chamado" some pelo mesmo motivo.
 */
function foldHeader(header: string): string {
  return foldText(header)
    .replace(/[º°]/g, "o")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Como um campo foi ligado a uma coluna — vai para a tela, não para o log. */
export interface ColumnBinding {
  /** O cabeçalho como estava escrito no arquivo. */
  header: string;
  /** Índice da coluna, 0-based. */
  index: number;
  /** `exato` quando o cabeçalho é um dos nomes conhecidos; `aproximado` quando o contém. */
  match: "exato" | "aproximado";
  reason: string;
}

export interface ColumnPlan {
  bindings: Partial<Record<TicketField, ColumnBinding>>;
  /** Cabeçalhos que nenhum campo reclamou. Continuam inteiros em `payload`. */
  unmapped: string[];
}

/**
 * Decidir que coluna é que campo, em duas passadas.
 *
 * A primeira passada só aceita igualdade: "Status" é `statusRaw` sem discussão.
 * A segunda aceita conter — "Data de abertura do chamado" contém "abertura" —,
 * e é onde os enganos moram, então cada ligação carrega a frase que a
 * justifica. Uma coluna já tomada não é disputada de novo: sem isso, um arquivo
 * com "Valor pedido" e "Valor aplicado" veria os dois casarem com `pedido` e
 * `aplicado` ao mesmo tempo por aproximação, e o segundo campo ficaria vazio
 * apontando para a coluna do primeiro.
 */
export interface PlanOptions {
  /** Que campos disputar. O padrão é todos. */
  fields?: TicketField[];
  /**
   * Quanto do cabeçalho o alias precisa cobrir para valer como aproximação.
   *
   * Existe por causa do formato largo, onde toda coluna não reclamada por um
   * campo é um parâmetro de remuneração de verdade. Sem esta régua, um
   * parâmetro chamado "Custo Variável Simulado" era tomado pelo campo
   * `parameterLabel` — porque contém "variável" —, e o arquivo inteiro passava
   * a ser lido como se fosse do formato estreito. O efeito não era um erro: era
   * zero alteração, em silêncio, num arquivo cheio delas.
   */
  minCoverage?: number;
}

export function planTicketColumns(
  headers: (string | null)[],
  options: PlanOptions = {},
): ColumnPlan {
  const fields = options.fields ?? FIELDS;
  const minCoverage = options.minCoverage ?? 0;
  const bindings: Partial<Record<TicketField, ColumnBinding>> = {};
  const taken = new Set<number>();

  const candidates = headers
    .map((header, index) => ({
      header,
      index,
      folded: header ? foldHeader(header) : "",
    }))
    .filter((c): c is { header: string; index: number; folded: string } =>
      Boolean(c.header && c.folded),
    );

  for (const field of fields) {
    const hit = candidates.find(
      (c) => !taken.has(c.index) && ALIASES[field].includes(c.folded),
    );
    if (!hit) continue;
    bindings[field] = {
      header: hit.header,
      index: hit.index,
      match: "exato",
      reason: `o cabeçalho "${hit.header}" é exatamente um dos nomes conhecidos deste campo`,
    };
    taken.add(hit.index);
  }

  for (const field of fields) {
    if (bindings[field]) continue;
    let found: { c: (typeof candidates)[number]; alias: string } | undefined;
    for (const c of candidates) {
      if (taken.has(c.index)) continue;
      // O alias mais longo primeiro: "valor aplicado" antes de "aplicado",
      // para o cabeçalho casar com o nome mais específico que o descreve.
      const alias = [...ALIASES[field]]
        .sort((a, b) => b.length - a.length)
        .find(
          (a) => c.folded.includes(a) && a.length >= c.folded.length * minCoverage,
        );
      if (alias) {
        found = { c, alias };
        break;
      }
    }
    if (!found) continue;
    bindings[field] = {
      header: found.c.header,
      index: found.c.index,
      match: "aproximado",
      reason: `o cabeçalho "${found.c.header}" contém "${found.alias}"`,
    };
    taken.add(found.c.index);
  }

  return {
    bindings,
    unmapped: candidates.filter((c) => !taken.has(c.index)).map((c) => c.header),
  };
}

// ---------------------------------------------------------------------------
// As colunas de parâmetro
// ---------------------------------------------------------------------------

/**
 * Os três campos que só existem no formato estreito.
 *
 * A presença de `parameterLabel` é o que decide o formato: com ela, cada linha
 * do arquivo descreve um parâmetro e o nome dele está numa célula. Sem ela, o
 * nome do parâmetro está no **cabeçalho**, e são as dezenas de colunas
 * restantes que carregam os valores.
 */
const NARROW_FIELDS: TicketField[] = [
  "parameterLabel",
  "valueBeforeRaw",
  "requestedValueRaw",
  "appliedValueRaw",
];

/** Os campos que descrevem o chamado, e valem nos dois formatos. */
const TICKET_FIELDS: TicketField[] = FIELDS.filter(
  (f) => !NARROW_FIELDS.includes(f),
);

/**
 * Em que formato este arquivo está.
 *
 * A decisão exige **igualdade**, nunca aproximação, e a razão é um defeito
 * real: num export largo de verdade existe uma coluna chamada "Custo Variável
 * Simulado", que *contém* "variável" — um dos nomes conhecidos da coluna
 * `Parâmetro`. Por aproximação ela era tomada por aquele campo, o arquivo
 * inteiro passava a ser lido como estreito, e o resultado não era um erro: era
 * zero alteração, em silêncio, num arquivo cheio delas.
 *
 * Igualdade é a régua certa aqui porque, no formato estreito, essa coluna se
 * chama "Parâmetro" ou "Atributo" e ponto. Quem escreve o nome do parâmetro
 * numa célula não inventa nome para a coluna que o contém.
 */
export function detectLayout(headers: (string | null)[]): "WIDE" | "NARROW" {
  const nomes = ALIASES.parameterLabel;
  return headers.some((h) => h && nomes.includes(foldHeader(h)))
    ? "NARROW"
    : "WIDE";
}

/**
 * Quanto um alias precisa cobrir do cabeçalho para valer, no formato largo.
 *
 * Metade. "Data de abertura do chamado" continua casando com "data de
 * abertura" (16 de 27 caracteres); "Custo Variável Simulado" deixa de casar
 * com "variavel" (8 de 23). No formato estreito não há régua: lá as colunas
 * restantes não são parâmetros, e um casamento frouxo não rouba nada de
 * ninguém.
 */
const WIDE_MIN_COVERAGE = 0.5;

/**
 * As palavras com que um cabeçalho declara ser o lado "antes" ou o lado
 * "depois" de um mesmo parâmetro.
 *
 * Só marcadores inequívocos entram. "de" e "para" seriam os mais naturais em
 * português e estão fora justamente por isso: "Valor **de** pedágio" viraria o
 * lado anterior de um parâmetro chamado "Valor pedágio", e o erro passaria
 * despercebido porque o resultado *parece* um par bem formado.
 */
const ROLE_WORDS = {
  antes: ["antes", "anterior", "atual", "vigente", "antigo", "antiga", "old", "before"],
  depois: [
    "depois",
    "novo",
    "nova",
    "solicitado",
    "solicitada",
    "pedido",
    "pedida",
    "aplicado",
    "aplicada",
    "atendido",
    "atendida",
    "proposto",
    "proposta",
    "new",
    "after",
  ],
} as const;

export type ParameterRole = "antes" | "depois";

/** O cabeçalho sem o marcador de lado, e o lado que ele declarava. */
export function splitParameterRole(header: string): {
  base: string;
  role: ParameterRole | null;
} {
  const folded = foldHeader(header);
  for (const role of ["depois", "antes"] as const) {
    for (const word of ROLE_WORDS[role]) {
      // Palavra inteira: "novo" casa em "Pedágio (novo)" e não em "Renovação".
      const re = new RegExp(`(^|[^a-z0-9])${word}($|[^a-z0-9])`);
      if (!re.test(folded)) continue;
      const base = folded
        .replace(re, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
      // Um cabeçalho que *só* tem o marcador ("Anterior") não nomeia
      // parâmetro nenhum; nesse caso ele não é lado de coisa alguma.
      return base === "" ? { base: folded, role: null } : { base, role };
    }
  }
  return { base: folded, role: null };
}

/** Uma coluna de parâmetro do arquivo, já sabendo se faz par com outra. */
export interface ParameterColumn {
  /** O nome que a tela mostra — sem o marcador de lado quando há par. */
  label: string;
  /** A coluna com o valor novo. Sempre existe. */
  afterIndex: number;
  /** A coluna com o valor anterior, quando o arquivo trouxe as duas. */
  beforeIndex: number | null;
  /** Os cabeçalhos originais, para a tela poder mostrar de onde saiu. */
  afterHeader: string;
  beforeHeader: string | null;
}

/**
 * As colunas de parâmetro de um arquivo largo, com os pares já juntados.
 *
 * Tudo o que não é campo do chamado é parâmetro: no formato largo não existe
 * "coluna não reconhecida", porque o nome do parâmetro é livre por natureza —
 * é o cadastro do Freightech, e ele ganha coluna nova sem avisar ninguém.
 *
 * Duas colunas viram um par só quando **as duas pontas existem**. Um "Pedágio
 * (novo)" sozinho continua sendo uma coluna comum, com o cabeçalho inteiro
 * como nome: sem a outra ponta não há como saber se "novo" era um marcador de
 * lado ou parte do nome do parâmetro, e apagar a palavra por conta própria
 * renomearia um parâmetro do cliente.
 */
export function planParameterColumns(
  headers: (string | null)[],
  bindings: Partial<Record<TicketField, ColumnBinding>>,
): ParameterColumn[] {
  const taken = new Set(Object.values(bindings).map((b) => b.index));
  const livres = headers
    .map((header, index) => ({ header, index }))
    .filter((c): c is { header: string; index: number } =>
      Boolean(c.header) && !taken.has(c.index),
    );

  /** base → { antes?, depois? } */
  const porBase = new Map<
    string,
    Partial<Record<ParameterRole, { header: string; index: number }>>
  >();
  for (const c of livres) {
    const { base, role } = splitParameterRole(c.header);
    if (!role) continue;
    const slot = porBase.get(base) ?? {};
    // O primeiro de cada lado fica; um terceiro cabeçalho que casasse com o
    // mesmo lado não tem como ser desempatado, e sobrescrever seria escolher
    // ao acaso.
    if (!slot[role]) slot[role] = { header: c.header, index: c.index };
    porBase.set(base, slot);
  }

  const pares = new Map<number, ParameterColumn>();
  for (const [base, slot] of porBase) {
    if (!slot.antes || !slot.depois) continue;
    const coluna: ParameterColumn = {
      label: base,
      afterIndex: slot.depois.index,
      beforeIndex: slot.antes.index,
      afterHeader: slot.depois.header,
      beforeHeader: slot.antes.header,
    };
    pares.set(slot.depois.index, coluna);
    pares.set(slot.antes.index, coluna);
  }

  const resultado: ParameterColumn[] = [];
  const jaEmitidos = new Set<ParameterColumn>();
  for (const c of livres) {
    const par = pares.get(c.index);
    if (par) {
      if (!jaEmitidos.has(par)) {
        jaEmitidos.add(par);
        resultado.push(par);
      }
      continue;
    }
    resultado.push({
      label: c.header,
      afterIndex: c.index,
      beforeIndex: null,
      afterHeader: c.header,
      beforeHeader: null,
    });
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// Leitura de valores
// ---------------------------------------------------------------------------

/**
 * Texto para número, sem inventar zero.
 *
 * Um export de chamados escreve dinheiro de todos os jeitos: `R$ 1.234,56`,
 * `1234.56`, `(120,00)` para negativo, e `sob análise` para "ainda não tem
 * valor". Só o que é inequivocamente numérico vira número; o resto volta
 * `null` e continua legível em `*_raw`, porque "sob análise" virando `0` seria
 * exatamente o erro que este produto existe para pegar.
 *
 * **O separador decimal.** Com vírgula e ponto presentes, o que aparece por
 * último é o decimal (`1.234,56` e `1,234.56` são a mesma quantia). Com um só
 * dos dois, ele é decimal — exceto quando é um ponto seguido de exatamente
 * três dígitos (`1.234`), que numa fonte brasileira é milhar.
 */
export function parseTicketNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;

  let text = raw.trim();
  if (text === "") return null;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  text = text
    .replace(/ /g, " ")
    .replace(/^R\$\s*/i, "")
    .replace(/\s*(BRL|reais)$/i, "")
    .trim();

  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1).trim();
  } else if (text.startsWith("+")) {
    text = text.slice(1).trim();
  }

  // Qualquer coisa fora de dígitos e separadores é texto, não número.
  if (!/^[\d.,]+$/.test(text)) return null;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let normalized: string;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    normalized = text.split(thousands).join("").replace(decimal, ".");
  } else if (lastComma >= 0) {
    // Vírgula é decimal aqui. Várias vírgulas só acontecem em milhar à
    // americana (`1,234,567`), e aí nenhuma delas é decimal.
    normalized =
      text.split(",").length > 2
        ? text.split(",").join("")
        : text.replace(",", ".");
  } else if (lastDot >= 0) {
    const parts = text.split(".");
    const isThousands =
      parts.length > 2 || (parts.length === 2 && parts[1].length === 3);
    normalized = isThousands ? parts.join("") : text;
  } else {
    normalized = text;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** `dd/mm/aaaa`, ISO, ou o serial do Excel. O que não for nenhum dos três volta null. */
export function parseTicketDate(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === "number") {
    return isPlausibleDateSerial(raw) ? excelSerialToDate(raw) : null;
  }
  if (typeof raw !== "string") return null;

  const text = raw.trim();
  if (text === "") return null;

  const br = text.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (br) {
    const [, d, m, y, hh = "0", mm = "0", ss = "0"] = br;
    const date = new Date(
      Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss),
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const iso = text.match(/^\d{4}-\d{2}-\d{2}([ T].*)?$/);
  if (iso) {
    const date = new Date(text.includes("T") ? text : text.replace(" ", "T") + "Z");
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

/** As caixas em que a tela agrupa os status que a fonte inventa. */
export const STATUS_BUCKETS = [
  "ABERTO",
  "EM_ANDAMENTO",
  "ATENDIDO",
  "RECUSADO",
  "CANCELADO",
  "DESCONHECIDO",
] as const;

export type StatusBucket = (typeof STATUS_BUCKETS)[number];

/**
 * O status escrito, dobrado numa caixa.
 *
 * A ordem de teste não é decorativa: "não atendido" e "cancelado" precisam ser
 * decididos antes de `ATENDIDO`, senão a negação vira o oposto do que diz. O
 * texto original nunca é substituído — fica em `status_raw`, e é ele que a
 * tabela mostra.
 */
export function normalizeStatus(raw: unknown): StatusBucket {
  if (typeof raw !== "string") return "DESCONHECIDO";
  const s = foldText(raw);
  if (s === "") return "DESCONHECIDO";

  const has = (...words: string[]) => words.some((w) => s.includes(w));

  // Negações primeiro: "nao atendido" não é atendido.
  if (/\bnao\b/.test(s) && has("atendido", "aprovado", "aplicado", "deferido")) {
    return "RECUSADO";
  }
  if (has("cancelad", "canceled", "cancelled")) return "CANCELADO";
  if (has("recusad", "negad", "rejeitad", "rejected", "indeferid", "reprovad")) {
    return "RECUSADO";
  }
  if (
    has(
      "atendido",
      "concluid",
      "resolvid",
      "finalizad",
      "encerrad",
      "fechado",
      "closed",
      "aprovad",
      "deferid",
      "aplicad",
      "completo",
    )
  ) {
    return "ATENDIDO";
  }
  if (has("andamento", "atendimento", "analise", "progress", "processand", "tratativa")) {
    return "EM_ANDAMENTO";
  }
  if (has("aberto", "abertura", "novo", "new", "open", "pendente", "aguardand", "fila")) {
    return "ABERTO";
  }
  return "DESCONHECIDO";
}

/** De onde saiu o valor anterior de um parâmetro. */
export type BeforeSource = "ARQUIVO" | "VIGENCIA" | "AUSENTE";

/**
 * Os dois lados são a mesma quantia, escrita de dois jeitos?
 *
 * O caso que isto pega é concreto: `Valor Antigo` chega como 255873333 e
 * `Valor Solicitado` como "255.87" — o mesmo 255,873333 com o separador
 * decimal perdido de um dos lados. Acontece em quase todo export que passou
 * por uma planilha com a localidade errada.
 *
 * A régua é estreita de propósito: o maior tem de virar o menor ao ser
 * dividido por uma potência de dez, **arredondado ao centavo**. Uma variação
 * real de 1.000 para 1,50 não passa por aqui (1000/10³ = 1, e não 1,50); só
 * passa o que é literalmente o mesmo algarismo com a vírgula em outro lugar.
 */
export function pareceMesmoNumeroOutraFormatacao(a: number, b: number): boolean {
  const maior = Math.max(Math.abs(a), Math.abs(b));
  const menor = Math.min(Math.abs(a), Math.abs(b));
  if (menor === 0 || maior / menor < 1000) return false;

  const centavos = (v: number) => Math.round(v * 100);
  for (let k = 3; k <= 9; k++) {
    if (centavos(maior / 10 ** k) === centavos(menor)) return true;
  }
  return false;
}

/**
 * Por que uma alteração não tem valor, dita na língua de quem opera.
 *
 * As operações do Freightech não são todas sobre um número. `FORM_THIS` troca
 * a fórmula do parâmetro; `ADD` inclui um item na composição. As duas mudam a
 * remuneração de verdade — e nenhuma delas tem "de 10 para 12" para mostrar.
 * Num export real elas são 96% das linhas, então esta explicação é a que mais
 * aparece na tela: escrevê-la mal é deixar quase toda a tabela parecendo
 * defeito nosso.
 */
const EXPLICACAO_SEM_VALOR: Record<string, string> = {
  FORM_THIS:
    "o chamado trocou a fórmula deste parâmetro, não um valor — não existe um “de … para …” a mostrar, e o efeito aparece no cálculo da vigência",
  ADD: "o chamado incluiu este item na composição; inclusão não tem valor anterior com que se comparar",
  REMOVE: "o chamado removeu este item da composição; remoção não tem valor novo com que se comparar",
};

/** A variação de um parâmetro, e o quanto dela pode ser afirmado. */
export interface ParameterMovement {
  /** `agora − antes`. Existe mesmo com o chamado ainda aberto. */
  deltaAbsolute: number | null;
  deltaPercent: number | null;
  /** A variação já aplicada. Só existe com o chamado atendido. */
  impactAmount: number | null;
  impactConfidence: "CALCULATED" | "NOT_CALCULABLE";
  impactReason: string;
}

/**
 * A mesma porta que a aba Planilha usa, com a régua deste lado.
 *
 * **Variação e impacto não são a mesma coisa**, e separá-los é o que permite
 * mostrar alguma coisa sobre um chamado que ainda corre. A variação é
 * aritmética: `agora − antes`, e vale desde que os dois lados sejam números.
 * O impacto é uma afirmação sobre dinheiro que já mudou de mãos, e por isso só
 * existe com o chamado **atendido** — enquanto ele corre, o valor ainda pode
 * mudar, e um número que se altera sozinho na tela é pior do que nenhum.
 *
 * O motivo da recusa é sempre escrito: "não calculável" sem explicação é o
 * mesmo que esconder.
 */
export function computeParameterMovement(
  before: number | null,
  after: number | null,
  bucket: StatusBucket,
  beforeRaw: string | null,
  afterRaw: string | null,
  beforeSource: BeforeSource,
  /** A operação declarada pelo chamado — SET, ADD, FORM_THIS, … */
  changeKind: string | null = null,
): ParameterMovement {
  const semVariacao = (impactReason: string): ParameterMovement => ({
    deltaAbsolute: null,
    deltaPercent: null,
    impactAmount: null,
    impactConfidence: "NOT_CALCULABLE",
    impactReason,
  });

  // O caso mais comum de um export real, e o que mais precisa de explicação:
  // a alteração existe, mas não é sobre um escalar. Dizer só "não calculável"
  // aqui deixaria 96% da tela sem motivo, e um motivo ausente é lido como
  // defeito nosso.
  if (beforeRaw === null && afterRaw === null) {
    return {
      deltaAbsolute: null,
      deltaPercent: null,
      impactAmount: null,
      impactConfidence: "NOT_CALCULABLE",
      impactReason: EXPLICACAO_SEM_VALOR[changeKind ?? ""] ??
        (changeKind
          ? `o chamado registra uma operação "${changeKind}" neste parâmetro, e o arquivo não traz valores para ela`
          : "o arquivo não traz valores para esta alteração"),
    };
  }

  if (afterRaw === null) {
    return semVariacao(
      "o chamado não trouxe valor novo para este parâmetro",
    );
  }
  if (beforeRaw === null) {
    return semVariacao(
      "não há valor anterior: o chamado não trouxe um, e a vigência em vigor não tem este parâmetro para este ativo",
    );
  }

  // Os dois lados existem, mas nem todo parâmetro é número. `ativo` vai de
  // "ATIVO" para "PARADO", `dataFimContrato` de uma data para outra: são
  // alterações de verdade, e dizer delas apenas "não é um número" descreveria
  // a nossa limitação em vez do que o chamado fez.
  if (before === null || after === null) {
    return semVariacao(
      `mudou de "${beforeRaw}" para "${afterRaw}" — é uma alteração de texto, sem variação numérica a apurar`,
    );
  }

  /*
    A mesma quantia escrita de dois jeitos.

    Num export real, `Valor Antigo` chega como 255873333 e `Valor Solicitado`
    como "255.87" — o mesmo 255,873333 com o separador decimal perdido de um
    dos lados. Subtrair os dois dá −255.873.077, e somados os casos assim o
    total da tela ia a −2,7 bilhões: um número que a célula de origem sustenta
    literalmente e que a realidade não sustenta de jeito nenhum.

    Recusar a apuração é o que este produto faz quando a comparação mediria
    outra coisa que não o custo — a mesma decisão da aba Planilha diante de uma
    mudança de significado. Os dois valores continuam à vista; o que não existe
    é o número inventado entre eles.
  */
  if (pareceMesmoNumeroOutraFormatacao(before, after)) {
    return semVariacao(
      `"${beforeRaw}" e "${afterRaw}" são os mesmos algarismos com o separador decimal em posições diferentes — provável perda de formatação na origem. A subtração mediria a formatação, não o custo.`,
    );
  }

  const deltaAbsolute = after - before;
  // Percentual sobre zero não existe. Sair de zero é uma informação real, e
  // ela é dita pelos próprios valores — não por um ∞ na coluna de variação.
  const deltaPercent =
    before === 0 ? null : (deltaAbsolute / Math.abs(before)) * 100;

  if (bucket !== "ATENDIDO") {
    return {
      deltaAbsolute,
      deltaPercent,
      impactAmount: null,
      impactConfidence: "NOT_CALCULABLE",
      impactReason:
        "o chamado ainda não foi atendido; a variação está apurada, mas o valor ainda pode mudar até o fechamento",
    };
  }

  return {
    deltaAbsolute,
    deltaPercent,
    impactAmount: deltaAbsolute,
    impactConfidence: "CALCULATED",
    impactReason:
      beforeSource === "ARQUIVO"
        ? "o próprio chamado declarou os dois valores, e ele já foi atendido"
        : "diferença para a vigência em vigor, com o chamado já atendido",
  };
}

// ---------------------------------------------------------------------------
// Leitura do arquivo
// ---------------------------------------------------------------------------

export interface TicketSheet {
  sheetName: string;
  headers: (string | null)[];
  /** Uma entrada por linha de dados, com o índice físico 1-based. */
  rows: { rowIndex: number; cells: unknown[] }[];
}

/**
 * O conteúdo do arquivo, pelo caminho que preserva os acentos.
 *
 * Um `.xlsx` é um zip e entra como bytes: ali uma data é uma data no próprio
 * formato, sem ambiguidade, e um número é um número.
 *
 * Um `.csv` é texto, e por isso entra por outro caminho — dois defeitos moram
 * nessa diferença, e os dois produzem número errado com cara de certo:
 *
 * 1. **Codificação.** Entregue como bytes, o leitor adivinha e erra para o
 *    lado legado: "Relatório" vira "RelatÃ³rio". Não é cosmético — os nomes de
 *    coluna são casados por texto, e um cabeçalho com acento corrompido deixa
 *    de ser reconhecido. Daí a decodificação explícita, UTF-8 com recuo para
 *    latin1 quando o arquivo não é UTF-8 válido.
 *
 * 2. **Adivinhação de tipo.** `01/07/2026` é 1º de julho em qualquer export
 *    brasileiro, e o leitor o converte para 7 de janeiro — enquanto deixa
 *    `20/07/2026` como texto, porque 20 não pode ser mês. O mesmo vale para
 *    `1.500,50`, que ele lê como um e meio. Por isso `raw: true`: o texto
 *    chega como texto, e quem o interpreta é `parseTicketDate` e
 *    `parseTicketNumber`, que sabem em que país estamos.
 */
function loadWorkbook(filePath: string): XLSX.WorkBook {
  const bytes = readFileSync(filePath);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) {
    return XLSX.read(bytes, { type: "buffer", cellDates: true });
  }

  let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  // U+FFFD é o que o decodificador põe no lugar do byte que não soube ler:
  // sinal de que o arquivo não era UTF-8, e aí latin1 é o outro palpite
  // razoável para um export brasileiro.
  if (text.includes("�")) {
    text = new TextDecoder("latin1").decode(bytes);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  return XLSX.read(text, { type: "string", raw: true });
}

/**
 * A aba de chamados do arquivo, com a linha de cabeçalho encontrada.
 *
 * `.xlsx` e `.csv` entram pelo mesmo leitor — um export de fila costuma vir em
 * CSV, e recusá-lo obrigaria quem opera a abrir e salvar de novo no Excel só
 * para nos agradar.
 *
 * **Achar o cabeçalho.** Ele não está fixado na primeira linha: os exports do
 * Freightech começam com o título do relatório e a data de extração. Mas a
 * primeira linha que *mencione* um chamado também não serve — o título
 * "Relatório de chamados" menciona, e tomá-lo por cabeçalho faz o arquivo
 * inteiro virar dado sob nomes de coluna que não existem. Vence a linha que
 * reconhece **mais campos**, entre as que têm ao menos duas colunas
 * preenchidas e uma delas identificando o chamado. Um casamento exato vale
 * mais que dez aproximados, para que um arquivo bem formado nunca seja
 * derrotado por uma linha de ruído mais comprida.
 */
export function readTicketWorkbook(filePath: string): TicketSheet {
  const workbook = loadWorkbook(filePath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("O arquivo não tem nenhuma aba legível.");
  }
  // `blankrows: true` é o que mantém o índice do array igual à linha física do
  // arquivo. Com ele desligado uma linha em branco no meio encurta a grade, e
  // todo `source_row_index` gravado depois dela aponta para a linha errada —
  // logo o número que a tela mostra como "linha N do arquivo, como veio".
  // As linhas vazias saem depois, já com o índice certo em mãos.
  const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    blankrows: true,
    defval: null,
    raw: true,
  });

  const HEADER_SEARCH_DEPTH = 15;
  const headersOf = (cells: unknown[]) =>
    cells.map((c) => (typeof c === "string" && c.trim() !== "" ? c.trim() : null));

  let headerRow = -1;
  let bestScore = -1;
  for (let i = 0; i < Math.min(grid.length, HEADER_SEARCH_DEPTH); i++) {
    const headers = headersOf(grid[i] ?? []);
    // Uma coluna só não é cabeçalho: é o título do relatório, e é justamente
    // ele que costuma conter a palavra "chamados".
    if (headers.filter(Boolean).length < 2) continue;

    const plan = planTicketColumns(headers);
    if (!plan.bindings.externalId) continue;

    const score =
      Object.keys(plan.bindings).length +
      (plan.bindings.externalId.match === "exato" ? 10 : 0);
    if (score > bestScore) {
      bestScore = score;
      headerRow = i;
    }
  }
  if (headerRow === -1) {
    throw new Error(
      'Não achei a coluna do número do chamado neste arquivo. O export precisa ter uma coluna chamada "Chamado", "Nº do chamado", "Protocolo" ou equivalente — é ela que identifica cada linha.',
    );
  }

  const headers = headersOf(grid[headerRow] ?? []);

  const rows = grid
    .slice(headerRow + 1)
    .map((cells, offset) => ({
      rowIndex: headerRow + offset + 2, // 1-based, cabeçalho já contado
      cells: cells ?? [],
    }))
    .filter((r) => r.cells.some((c) => c !== null && String(c).trim() !== ""));

  return { sheetName, headers, rows };
}

// ---------------------------------------------------------------------------
// Receber e ler
// ---------------------------------------------------------------------------

export interface ReceiveTicketResult {
  ticketImportId: string;
  isDuplicate: boolean;
  contentSha256: string;
}

export interface ReceiveTicketOptions {
  filePath: string;
  filename?: string;
  receivedBy?: string;
  /** Reprocessar um conteúdo já recebido. O padrão recusa. */
  allowReprocess?: boolean;
}

/**
 * Registrar o arquivo e abrir a leitura.
 *
 * A duplicata é recusada, e a recusa é gravada: uma tentativa é um evento que
 * vale registrar, e a tela de importações mostra as duas coisas. A regra é a
 * mesma de `receiveFile` — só a leitura por trás é que é outra.
 */
export async function receiveTicketFile(
  db: Database,
  options: ReceiveTicketOptions,
): Promise<ReceiveTicketResult> {
  const bytes = readFileSync(options.filePath);
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  const filename = options.filename ?? options.filePath.split("/").pop()!;

  const [existing] = await db
    .select({ id: ticketImportTable.id })
    .from(ticketImportTable)
    .where(
      and(
        eq(ticketImportTable.contentSha256, contentSha256),
        eq(ticketImportTable.status, "READ"),
      ),
    );

  const isDuplicate = Boolean(existing) && !options.allowReprocess;

  const [created] = await db
    .insert(ticketImportTable)
    .values({
      filename,
      contentSha256,
      byteSize: statSync(options.filePath).size,
      storagePath: options.filePath,
      receivedBy: options.receivedBy ?? null,
      status: isDuplicate ? "SKIPPED_DUPLICATE" : "PENDING",
      finishedAt: isDuplicate ? new Date() : null,
      failureReason: isDuplicate
        ? `Este arquivo de chamados já havia sido lido (sha256 ${contentSha256.slice(0, 16)}…). Nada foi reprocessado: o conteúdo é idêntico, byte a byte, ao de um envio anterior.`
        : null,
    })
    .returning();

  return { ticketImportId: created.id, isDuplicate, contentSha256 };
}

export interface ReadTicketsResult {
  ticketImportId: string;
  rowCount: number;
  ticketCount: number;
  ignoredRowCount: number;
  /** Quantas linhas de `ticket_change` a leitura produziu. */
  changeCount: number;
  /** WIDE quando os parâmetros estão nos cabeçalhos; NARROW quando em células. */
  layout: "WIDE" | "NARROW";
  unmappedColumns: string[];
  parameterColumns: string[];
  columnMapping: Partial<Record<TicketField, ColumnBinding>>;
}

/**
 * O que o export escreve no lugar de "não tem valor".
 *
 * O Freightech preenche a célula com `-` em vez de deixá-la vazia. Ler isso
 * como texto faria a tela mostrar "de - para -" como se fosse uma alteração de
 * um traço para outro, e o filtro de "sem valor" nunca encontraria nada.
 * Ausência tem de chegar aqui como ausência.
 */
const SENTINELAS = new Set(["-", "--", "---", "n/a", "na", "nao informado", "sem valor"]);

/** Texto útil, ou nada — nunca a string vazia nem o traço disfarçados de valor. */
function textOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = value instanceof Date ? value.toISOString() : String(value).trim();
  if (s === "") return null;
  return SENTINELAS.has(foldText(s)) ? null : s;
}

/**
 * A placa escondida no texto que descreve o item.
 *
 * A coluna `Item` do export vem composta: `Placa: QYW2D78 | Placa Carreta:
 * QYW4C69` num chamado de veículo, `Cargo: Manobrista | Classificação: …` num
 * de mão de obra. A primeira placa é a do ativo principal — a segunda é o
 * implemento acoplado, e casá-la com o canônico atribuiria a alteração ao
 * reboque em vez do cavalo.
 */
export function extractPlaca(descricao: string | null): string | null {
  if (!descricao) return null;
  const m = descricao.match(/\bplaca\s*:\s*([A-Za-z0-9-]{5,10})/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Ler o arquivo recebido: um chamado por linha, uma alteração por parâmetro.
 *
 * É o passo inteiro — não há staging nem promoção, porque não há decisão humana
 * no meio: nada aqui entra na camada canônica nem soma com a comparação de
 * vigências.
 *
 * O que existe é a conta de conservação, e ela é a única defesa contra o modo
 * de falha desta leitura. Um arquivo largo tem dezenas de colunas de parâmetro
 * em que a maioria das células está vazia; um erro de mapeamento não estoura,
 * ele simplesmente produz menos alterações — e menos é indistinguível de "o
 * chamado mexeu em pouca coisa" a olho nu. Por isso `row_count`,
 * `ticket_count`, `ignored_row_count` e `change_count` são todos gravados e
 * mostrados: a soma tem de fechar, e o número de parâmetros lidos aparece ao
 * lado do número de colunas de parâmetro encontradas.
 */
export async function readTicketImport(
  db: Database,
  ticketImportId: string,
): Promise<ReadTicketsResult> {
  const [run] = await db
    .select()
    .from(ticketImportTable)
    .where(eq(ticketImportTable.id, ticketImportId));
  if (!run) throw new Error(`Envio de chamados ${ticketImportId} não encontrado.`);
  if (!run.storagePath) {
    throw new Error(
      `O arquivo de ${run.filename} não está mais em disco; não há o que reler.`,
    );
  }

  await db
    .update(ticketImportTable)
    .set({ status: "READING" })
    .where(eq(ticketImportTable.id, ticketImportId));

  const sheet = readTicketWorkbook(run.storagePath);

  // O formato se decide antes de qualquer ligação de coluna: o nome do
  // parâmetro está numa célula (estreito) ou no cabeçalho (largo)? Só depois
  // disso se sabe com que rigor as colunas podem ser disputadas — no formato
  // largo, tudo o que um campo não reclamar é parâmetro de remuneração, e um
  // casamento frouxo rouba dado de verdade.
  const layout = detectLayout(sheet.headers);
  const plan =
    layout === "WIDE"
      ? planTicketColumns(sheet.headers, {
          fields: TICKET_FIELDS,
          minCoverage: WIDE_MIN_COVERAGE,
        })
      : planTicketColumns(sheet.headers);

  if (!plan.bindings.externalId) {
    throw new Error(
      "Achei o cabeçalho mas não a coluna do número do chamado. Sem ela não há como identificar cada linha.",
    );
  }

  const parameterColumns =
    layout === "WIDE" ? planParameterColumns(sheet.headers, plan.bindings) : [];

  const dicionario = await resolveAttributeCodes(db);
  const at = (cells: unknown[], field: TicketField): unknown => {
    const binding = plan.bindings[field];
    return binding ? (cells[binding.index] ?? null) : null;
  };

  // ---- Passo 1: os chamados -------------------------------------------------
  const tickets: (typeof ticketTable.$inferInsert)[] = [];
  /** O que cada linha vai virar de alteração, antes de saber o id do chamado. */
  const pendentes = new Map<number, PendingChange[]>();
  let ignored = 0;

  for (const row of sheet.rows) {
    const externalId = textOf(at(row.cells, "externalId"));
    if (!externalId) {
      // Linha sem número de chamado não é chamado. Fica contada, e a linha
      // continua no arquivo — nunca some sem aparecer numa conta.
      ignored++;
      continue;
    }

    const statusRaw = textOf(at(row.cells, "statusRaw"));
    const bucket = normalizeStatus(statusRaw);
    const entityDescription = textOf(at(row.cells, "entityDescription"));
    // A placa pode vir numa coluna própria ou embutida na descrição do item.
    const entityLabel =
      textOf(at(row.cells, "entityLabel")) ?? extractPlaca(entityDescription);
    const entityType = textOf(at(row.cells, "entityType"));
    const changeKind = textOf(at(row.cells, "changeKind"));

    const payload: Record<string, unknown> = {};
    sheet.headers.forEach((header, index) => {
      if (!header) return;
      const cell = row.cells[index];
      payload[header] =
        cell instanceof Date ? cell.toISOString() : (cell ?? null);
    });

    const changes =
      layout === "NARROW"
        ? narrowChanges(row.cells, plan, dicionario, entityLabel, entityType)
        : wideChanges(row.cells, parameterColumns, dicionario, entityLabel, entityType);

    pendentes.set(
      row.rowIndex,
      changes.map((c) => ({ ...c, bucket, changeKind })),
    );

    tickets.push({
      ticketImportId,
      externalId,
      openedAt: parseTicketDate(at(row.cells, "openedAt")),
      closedAt: parseTicketDate(at(row.cells, "closedAt")),
      statusRaw,
      statusBucket: bucket,
      entityLabel,
      entityType,
      entityDescription,
      vigenciaLabel: textOf(at(row.cells, "vigenciaLabel")),
      requestedBy: textOf(at(row.cells, "requestedBy")),
      subject: textOf(at(row.cells, "subject")),
      changedParameterCount: changes.length,
      sourceRowIndex: row.rowIndex,
      payload,
    });
  }

  const CHUNK = 500;
  const idPorLinha = new Map<number, string>();
  for (let i = 0; i < tickets.length; i += CHUNK) {
    const gravados = await db
      .insert(ticketTable)
      .values(tickets.slice(i, i + CHUNK))
      .onConflictDoNothing()
      .returning({ id: ticketTable.id, sourceRowIndex: ticketTable.sourceRowIndex });
    for (const g of gravados) idPorLinha.set(g.sourceRowIndex, g.id);
  }

  // ---- Passo 2: o "antes" que o arquivo não trouxe --------------------------
  const vigenciaPorLinha = new Map(
    tickets.map((t) => [t.sourceRowIndex, t.vigenciaLabel ?? null]),
  );
  const semAntes = [...pendentes.values()]
    .flat()
    .filter((c) => c.beforeSource === "AUSENTE" && c.entityLabel && c.attributeCode);
  const vigentes = await valoresVigentes(
    db,
    [...new Set(semAntes.map((c) => c.entityLabel!))],
    [...new Set(semAntes.map((c) => c.attributeCode!))],
    [...new Set([...vigenciaPorLinha.values()].filter((v): v is string => Boolean(v)))],
  );

  // ---- Passo 3: as alterações ----------------------------------------------
  const changeRows: (typeof ticketChangeTable.$inferInsert)[] = [];
  for (const [rowIndex, changes] of pendentes) {
    const ticketId = idPorLinha.get(rowIndex);
    if (!ticketId) continue; // linha já gravada num envio anterior

    for (const c of changes) {
      let beforeRaw = c.valueBeforeRaw;
      let beforeSource = c.beforeSource;
      let beforeReference: string | null = null;

      if (beforeSource === "AUSENTE" && c.entityLabel && c.attributeCode) {
        // A vigência que o próprio chamado nomeia vence a mais recente: ele
        // sabe contra que estado foi aberto, e nós só saberíamos chutar.
        const nomeada = vigenciaPorLinha.get(rowIndex);
        const chave = `${c.entityLabel}|${c.attributeCode}`;
        const vigente =
          (nomeada
            ? vigentes.porVigencia.get(`${nomeada}|${chave}`)
            : undefined) ?? vigentes.maisRecente.get(chave);
        if (vigente) {
          beforeRaw = vigente.value;
          beforeSource = "VIGENCIA";
          beforeReference = vigente.label;
        }
      }

      const before = parseTicketNumber(beforeRaw);
      const after = parseTicketNumber(c.valueAfterRaw);
      const movement = computeParameterMovement(
        before,
        after,
        c.bucket,
        beforeRaw,
        c.valueAfterRaw,
        beforeSource,
        c.changeKind,
      );

      changeRows.push({
        ticketId,
        ticketImportId,
        parameterLabel: c.parameterLabel,
        attributeCode: c.attributeCode,
        entityLabel: c.entityLabel,
        entityType: c.entityType,
        valueBeforeRaw: beforeRaw,
        valueBeforeNumeric: before === null ? null : String(before),
        valueAfterRaw: c.valueAfterRaw,
        valueAfterNumeric: after === null ? null : String(after),
        beforeSource,
        beforeReference,
        deltaAbsolute:
          movement.deltaAbsolute === null ? null : String(movement.deltaAbsolute),
        deltaPercent:
          movement.deltaPercent === null ? null : String(movement.deltaPercent),
        impactAmount:
          movement.impactAmount === null ? null : String(movement.impactAmount),
        impactConfidence: movement.impactConfidence,
        impactReason: movement.impactReason,
        changeKind: c.changeKind,
        sourceColumnIndex: c.sourceColumnIndex,
      });
    }
  }

  for (let i = 0; i < changeRows.length; i += CHUNK) {
    await db
      .insert(ticketChangeTable)
      .values(changeRows.slice(i, i + CHUNK))
      .onConflictDoNothing();
  }

  const parameterHeaders = parameterColumns.map((p) =>
    p.beforeHeader ? `${p.afterHeader} ↔ ${p.beforeHeader}` : p.afterHeader,
  );

  await db
    .update(ticketImportTable)
    .set({
      status: "READ",
      finishedAt: new Date(),
      rowCount: sheet.rows.length,
      ticketCount: tickets.length,
      ignoredRowCount: ignored,
      columnMapping: plan.bindings,
      unmappedColumns: layout === "NARROW" ? plan.unmapped : [],
      parameterColumns: parameterHeaders,
    })
    .where(eq(ticketImportTable.id, ticketImportId));

  return {
    ticketImportId,
    rowCount: sheet.rows.length,
    ticketCount: tickets.length,
    ignoredRowCount: ignored,
    changeCount: changeRows.length,
    layout,
    unmappedColumns: layout === "NARROW" ? plan.unmapped : [],
    parameterColumns: parameterHeaders,
    columnMapping: plan.bindings,
  };
}

/** Uma alteração já extraída da linha, ainda sem o id do chamado. */
interface PendingChange {
  parameterLabel: string;
  attributeCode: string | null;
  entityLabel: string | null;
  entityType: string | null;
  valueBeforeRaw: string | null;
  valueAfterRaw: string | null;
  beforeSource: BeforeSource;
  sourceColumnIndex: number;
  bucket: StatusBucket;
  changeKind: string | null;
}

type PendingDraft = Omit<PendingChange, "bucket" | "changeKind">;

/**
 * Formato largo: uma alteração por célula de parâmetro **preenchida**.
 *
 * A célula vazia é o normal, e é ela que carrega o significado: num export de
 * chamados o parâmetro que não veio é o parâmetro que aquele chamado não
 * mexeu. Emitir uma alteração para ela encheria a tela de linhas sem fato e
 * faria o total de alterações virar o número de chamados vezes o número de
 * colunas — que não é uma medida de nada.
 */
function wideChanges(
  cells: unknown[],
  columns: ParameterColumn[],
  dicionario: Map<string, string>,
  entityLabel: string | null,
  entityType: string | null,
): PendingDraft[] {
  const out: PendingDraft[] = [];
  for (const col of columns) {
    const after = textOf(cells[col.afterIndex]);
    if (after === null) continue;

    const before =
      col.beforeIndex === null ? null : textOf(cells[col.beforeIndex]);

    out.push({
      parameterLabel: col.label,
      attributeCode: matchAttributeCode(dicionario, col.label),
      entityLabel,
      entityType,
      valueBeforeRaw: before,
      valueAfterRaw: after,
      // Só é "do arquivo" quando o arquivo de fato trouxe a outra ponta. Um
      // par declarado com a célula anterior vazia continua sem antes.
      beforeSource: before === null ? "AUSENTE" : "ARQUIVO",
      sourceColumnIndex: col.afterIndex,
    });
  }
  return out;
}

/**
 * Formato estreito: o nome do parâmetro está numa célula, e há um por linha.
 *
 * **A alteração existe mesmo sem valor**, e este é o ponto que o formato real
 * ensinou. Num export de verdade, 96% das linhas trazem `-` nos dois campos de
 * valor: elas são `FORM_THIS` (troca de fórmula) ou `ADD` (inclusão de item),
 * que alteram a remuneração sem que exista "de 10 para 12" para mostrar. Exigir
 * um valor para emitir a alteração descartaria 96% do arquivo — e a tela diria,
 * sem dizer, que aquelas mudanças não aconteceram.
 *
 * O que se faz então é o contrário de esconder: a linha entra, as colunas de
 * valor ficam honestamente vazias, e `changeKind` explica por quê.
 */
function narrowChanges(
  cells: unknown[],
  plan: ColumnPlan,
  dicionario: Map<string, string>,
  entityLabel: string | null,
  entityType: string | null,
): PendingDraft[] {
  const at = (field: TicketField) => {
    const binding = plan.bindings[field];
    return binding ? (cells[binding.index] ?? null) : null;
  };
  const parameterLabel = textOf(at("parameterLabel"));
  if (!parameterLabel) return [];

  const antigo = textOf(at("valueBeforeRaw"));
  const solicitado = textOf(at("requestedValueRaw"));
  const aplicado = textOf(at("appliedValueRaw"));

  // O "depois" é o que de fato foi aplicado, quando o arquivo distingue as
  // duas coisas; senão, é o que se pediu. O "antes" é a coluna de valor
  // antigo — e, quando ela não existe, o par pedido/aplicado ainda serve.
  const after = aplicado ?? solicitado;
  const [before, source]: [string | null, BeforeSource] =
    antigo !== null
      ? [antigo, "ARQUIVO"]
      : aplicado !== null && solicitado !== null
        ? [solicitado, "ARQUIVO"]
        : [null, "AUSENTE"];

  return [
    {
      parameterLabel,
      attributeCode: matchAttributeCode(dicionario, parameterLabel),
      entityLabel,
      entityType,
      valueBeforeRaw: before,
      valueAfterRaw: after,
      beforeSource: source,
      sourceColumnIndex: plan.bindings.parameterLabel?.index ?? 0,
    },
  ];
}

/**
 * O valor em vigor de cada (placa, parâmetro), na vigência mais recente.
 *
 * É o que dá um "antes" ao chamado que só trouxe o valor novo — o caso comum.
 * A procedência é gravada em `before_source = 'VIGENCIA'` e o rótulo da
 * vigência em `before_reference`, porque este valor **não** tem a mesma força
 * de um declarado pelo próprio chamado: ele é o nosso melhor conhecimento do
 * estado anterior, e a tela precisa poder dizer isso.
 *
 * Uma vigência por série: quando carreta e cavalo chegam em arquivos
 * separados, cada uma tem a sua mais recente, e tomar "a mais recente de
 * todas" leria a frota inteira pela data de uma delas.
 */
interface ValorVigente {
  value: string | null;
  label: string;
}

interface ValoresVigentes {
  /** `vigência|placa|código` — o valor naquela vigência nomeada. */
  porVigencia: Map<string, ValorVigente>;
  /** `placa|código` — o valor na vigência mais recente da série. */
  maisRecente: Map<string, ValorVigente>;
}

async function valoresVigentes(
  db: Database,
  placas: string[],
  codes: string[],
  /** As vigências que os próprios chamados nomearam (`Vig. Abertura`). */
  vigenciasNomeadas: string[] = [],
): Promise<ValoresVigentes> {
  const vazio: ValoresVigentes = {
    porVigencia: new Map(),
    maisRecente: new Map(),
  };
  if (placas.length === 0 || codes.length === 0) return vazio;

  const listaPlacas = sql.join(placas.map((p) => sql`${p}`), sql`, `);
  const listaCodes = sql.join(codes.map((c) => sql`${c}`), sql`, `);
  // Sem nenhuma vigência nomeada, a lista precisa de um elemento impossível:
  // `IN ()` é erro de sintaxe no Postgres, e não "não casa com nada".
  const listaVigencias = sql.join(
    (vigenciasNomeadas.length > 0 ? vigenciasNomeadas : [""]).map(
      (v) => sql`${v}`,
    ),
    sql`, `,
  );

  const { rows } = await db.execute<{
    placa: string;
    code: string;
    valor: string | null;
    label: string;
    recente: boolean;
  }>(sql`
    WITH recentes AS (
      SELECT DISTINCT ON (s.scope_hash, s.entity_type_set) s.id
        FROM snapshot s
       WHERE s.status <> 'SUPERSEDED'
       ORDER BY s.scope_hash, s.entity_type_set, s.effective_date DESC
    ),
    alvo AS (
      SELECT s.id,
             s.source_label,
             (r.id IS NOT NULL) AS recente
        FROM snapshot s
        LEFT JOIN recentes r ON r.id = s.id
       WHERE s.status <> 'SUPERSEDED'
         AND (r.id IS NOT NULL OR s.source_label IN (${listaVigencias}))
    )
    SELECT ei.identifier_value AS placa,
           a.code              AS code,
           CASE WHEN f.is_null THEN NULL
                ELSE coalesce(
                  f.value_text,
                  f.value_numeric::text,
                  f.value_boolean::text,
                  f.value_date::text
                )
           END                 AS valor,
           t.source_label      AS label,
           t.recente           AS recente
      FROM fact f
      JOIN alvo t              ON t.id = f.snapshot_id
      JOIN attribute a         ON a.id = f.attribute_id
      JOIN entity_identifier ei ON ei.entity_id = f.entity_id
                              AND ei.is_current
                              AND ei.identifier_type = 'PLACA'
     WHERE ei.identifier_value IN (${listaPlacas})
       AND a.code IN (${listaCodes})
  `);

  const porVigencia = new Map<string, ValorVigente>();
  const maisRecente = new Map<string, ValorVigente>();
  for (const r of rows) {
    const valor = { value: r.valor, label: r.label };
    porVigencia.set(`${r.label}|${r.placa}|${r.code}`, valor);
    if (r.recente) maisRecente.set(`${r.placa}|${r.code}`, valor);
  }
  return { porVigencia, maisRecente };
}

/** Marca o envio como falho, com o motivo à vista de quem opera. */
export async function markTicketImportFailed(
  db: Database,
  ticketImportId: string,
  reason: string,
): Promise<void> {
  await db
    .update(ticketImportTable)
    .set({ status: "FAILED", finishedAt: new Date(), failureReason: reason })
    .where(eq(ticketImportTable.id, ticketImportId));
}

// ---------------------------------------------------------------------------
// Ligação com o dicionário
// ---------------------------------------------------------------------------

/**
 * O dicionário de atributos, indexado pelas formas em que um chamado o citaria.
 *
 * A ligação é uma conveniência de navegação — permite à tela dizer "este
 * chamado fala do mesmo parâmetro daquela alteração" —, e por isso ela falha
 * para `null` em silêncio em vez de recusar a linha. Um chamado sobre um
 * parâmetro que ainda não está no dicionário continua sendo um chamado.
 */
async function resolveAttributeCodes(db: Database): Promise<Map<string, string>> {
  const rows = await db
    .select({
      code: attributeTable.code,
      sourceName: attributeTable.sourceName,
      displayName: attributeTable.displayName,
    })
    .from(attributeTable);

  const index = new Map<string, string>();
  for (const row of rows) {
    for (const name of [row.sourceName, row.displayName]) {
      if (!name) continue;
      const key = slugifyColumn(name);
      if (key && !index.has(key)) index.set(key, row.code);
    }
    // O próprio código sem o prefixo do equipamento: "cavalo.pneu" também é
    // citado como "pneu" num chamado.
    const bare = row.code.includes(".") ? row.code.split(".").slice(1).join(".") : row.code;
    if (bare && !index.has(bare)) index.set(bare, row.code);
  }
  return index;
}

function matchAttributeCode(index: Map<string, string>, label: string): string | null {
  return index.get(slugifyColumn(label)) ?? null;
}
