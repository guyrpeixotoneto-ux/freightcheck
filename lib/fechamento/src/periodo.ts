/**
 * A competência, e as três formas de escrever uma data no fechamento.
 *
 * As cinco fontes datam a mesma quinzena de três jeitos incompatíveis:
 *
 * | fonte | como escreve 16/07/2026 |
 * | --- | --- |
 * | 2Art | `16072026` — `ddmmaaaa` colado, como número |
 * | 03.08.15 e 03.08.18 | `46219` — serial do Excel |
 * | 03.08.12.09 e 03.02.59.02 | `16/07/2026` — texto |
 *
 * Ler as três aqui, uma vez, é o que permite que o resto do módulo só conheça
 * `AAAA-MM-DD`. Cada leitor devolve `null` para o que não reconhece, e nunca
 * uma data "mais provável": uma viagem datada errado migra de quinzena, e uma
 * quinzena que ganha ou perde um dia de operação cobra o valor errado.
 */

/** O dia, sempre em `AAAA-MM-DD` (UTC), que é como o módulo inteiro fala. */
export type Dia = string;

const MS_POR_DIA = 86_400_000;
/** Serial 25569 é 1970-01-01, a época Unix. */
const EPOCA_EM_SERIAL = 25569;

/**
 * Menor e maior serial que aceitamos como data (1990-01-01 a 2100-01-01).
 *
 * Os limites são o que separa uma data de uma quantidade: a coluna `Data` do
 * 03.08.15 vem como número puro, e um `1` nela é erro de origem, não o dia
 * 31/12/1899.
 */
const SERIAL_MINIMO = 32_874;
const SERIAL_MAXIMO = 73_051;

function doisDigitos(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function comoDia(data: Date): Dia {
  return `${data.getUTCFullYear()}-${doisDigitos(data.getUTCMonth() + 1)}-${doisDigitos(data.getUTCDate())}`;
}

/**
 * Serial do Excel → dia.
 *
 * Reproduz o bug do ano bissexto de 1900: a partir do serial 61 o Excel conta
 * um dia a mais, porque acredita que 29/02/1900 existiu. Sem essa correção
 * toda a base ficaria um dia adiantada — e um dia de operação é dinheiro.
 */
export function diaDeSerial(serial: unknown): Dia | null {
  const n = typeof serial === "number" ? serial : Number(serial);
  if (!Number.isFinite(n)) return null;
  const inteiro = Math.floor(n);
  if (inteiro < SERIAL_MINIMO || inteiro > SERIAL_MAXIMO) return null;
  const ajustado = inteiro >= 61 ? inteiro - 1 : inteiro;
  return comoDia(new Date((ajustado - EPOCA_EM_SERIAL + 1) * MS_POR_DIA));
}

/** `16072026` (o formato do 2Art, número ou texto) → dia. */
export function diaDeDDMMAAAA(bruto: unknown): Dia | null {
  const texto = String(bruto ?? "").trim();
  if (!/^\d{8}$/.test(texto)) return null;
  const dd = Number(texto.slice(0, 2));
  const mm = Number(texto.slice(2, 4));
  const aaaa = Number(texto.slice(4, 8));
  return montar(aaaa, mm, dd);
}

/** `16/07/2026` (o formato do CSV e do TXT) → dia. */
export function diaDeTextoBR(bruto: unknown): Dia | null {
  const texto = String(bruto ?? "").trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
  if (!m) return null;
  return montar(Number(m[3]), Number(m[2]), Number(m[1]));
}

/**
 * Monta o dia recusando data impossível.
 *
 * `31/02` não vira 03/03: o `Date` do JavaScript transborda em silêncio, e o
 * transbordo aqui produziria uma viagem em um dia que não existe no
 * calendário da operação.
 */
function montar(ano: number, mes: number, dia: number): Dia | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) {
    return null;
  }
  return comoDia(data);
}

/**
 * A competência: o período que o fechamento fecha.
 *
 * A quinzena é o grão do pagamento — a primeira vai do dia 1 ao 15, a segunda
 * do 16 ao fim do mês. O rótulo que as fontes usam é sempre o **primeiro dia**
 * do período (`16/07/2026` para 16–31/07), e confundir rótulo com data de
 * emissão é o erro que faz uma quinzena inteira sumir de um filtro.
 */
export interface Competencia {
  /** `2026-07-Q2` — estável, ordenável, e o que a URL carrega. */
  chave: string;
  ano: number;
  mes: number;
  quinzena: 1 | 2;
  inicio: Dia;
  fim: Dia;
  /** Como as fontes rotulam este período: o primeiro dia, em `dd/mm/aaaa`. */
  rotulo: string;
}

function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** Monta a competência a partir do ano, mês e quinzena. */
export function competencia(ano: number, mes: number, quinzena: 1 | 2): Competencia {
  const primeiro = quinzena === 1 ? 1 : 16;
  const ultimo = quinzena === 1 ? 15 : ultimoDiaDoMes(ano, mes);
  const inicio = montar(ano, mes, primeiro);
  const fim = montar(ano, mes, ultimo);
  if (!inicio || !fim) throw new RangeError(`Competência impossível: ${ano}-${mes}-Q${quinzena}`);
  return {
    chave: `${ano}-${doisDigitos(mes)}-Q${quinzena}`,
    ano,
    mes,
    quinzena,
    inicio,
    fim,
    rotulo: `${doisDigitos(primeiro)}/${doisDigitos(mes)}/${ano}`,
  };
}

/** A competência a que um dia pertence. */
export function competenciaDoDia(dia: Dia): Competencia {
  const [ano, mes, d] = dia.split("-").map(Number);
  return competencia(ano, mes, d <= 15 ? 1 : 2);
}

/** O dia está dentro da competência? */
export function dentroDaCompetencia(comp: Competencia, dia: Dia): boolean {
  return dia >= comp.inicio && dia <= comp.fim;
}

/** Lê a chave `2026-07-Q2` de volta. `null` quando o texto não é uma chave. */
export function competenciaDaChave(chave: string): Competencia | null {
  const m = /^(\d{4})-(\d{2})-Q([12])$/.exec(chave.trim());
  if (!m) return null;
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  return competencia(Number(m[1]), mes, Number(m[3]) as 1 | 2);
}
