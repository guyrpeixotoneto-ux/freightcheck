/**
 * O calendário, na língua do produto.
 *
 * Os nomes dos meses e o dia de hoje não pertencem a ambiente nenhum: eles
 * nasceram na Visão Gerencial do Fechamento e passaram a ser lidos também pela
 * Visão Gerencial da Auditoria, que monta o ano da unidade pela mesma régua. Um
 * segundo `["jan", "fev", …]` escrito na outra tela seria a mesma lista com uma
 * chance a mais de divergir — e a divergência não apareceria no compilador, só
 * numa faixa em que agosto está no lugar de julho.
 *
 * `fechamento-gerencial.ts` reexporta os três: nenhuma tela que já os importava
 * de lá precisou mudar de endereço por causa desta extração.
 */

export const MES_CURTO = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

export const MES_LONGO = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export const doisDigitos = (n: number): string => (n < 10 ? `0${n}` : String(n));

/**
 * Hoje em `AAAA-MM-DD`, no fuso de quem lê.
 *
 * Local e não UTC porque a pergunta que a data responde é "este período já
 * passou para mim?" — e às 21h de 15/08 em Brasília o UTC já virou dia 16, o
 * que faria a tela declarar vencido um período que ainda está correndo para
 * quem opera. O parâmetro existe para o teste: nenhuma função pura deste
 * produto lê o relógio por conta própria.
 */
export function hojeEm(data = new Date()): string {
  return `${data.getFullYear()}-${doisDigitos(data.getMonth() + 1)}-${doisDigitos(data.getDate())}`;
}

function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

export interface PeriodoDaQuinzena {
  /**
   * `2026-08-Q1` — a chave da quinzena.
   *
   * É a mesma que o servidor grava na competência do Fechamento, e é por isso
   * que ela tem esta forma. A Visão Gerencial da Auditoria a usa como chave dos
   * ladrilhos do ano, onde a quinzena não é um registro e sim uma casa do
   * calendário à espera das vigências que caíram nela.
   */
  chave: string;
  ano: number;
  mes: number;
  quinzena: 1 | 2;
  inicio: string;
  fim: string;
}

/** A quinzena pelo calendário: a primeira vai do dia 1 ao 15, a segunda do 16 ao fim do mês. */
export function periodoDaQuinzena(ano: number, mes: number, quinzena: 1 | 2): PeriodoDaQuinzena {
  const primeiro = quinzena === 1 ? 1 : 16;
  const ultimo = quinzena === 1 ? 15 : ultimoDiaDoMes(ano, mes);
  return {
    chave: `${ano}-${doisDigitos(mes)}-Q${quinzena}`,
    ano,
    mes,
    quinzena,
    inicio: `${ano}-${doisDigitos(mes)}-${doisDigitos(primeiro)}`,
    fim: `${ano}-${doisDigitos(mes)}-${doisDigitos(ultimo)}`,
  };
}

/** As 24 quinzenas do ano, de janeiro a dezembro. */
export function periodosDoAno(ano: number): PeriodoDaQuinzena[] {
  const periodos: PeriodoDaQuinzena[] = [];
  for (let mes = 1; mes <= 12; mes += 1) {
    periodos.push(periodoDaQuinzena(ano, mes, 1), periodoDaQuinzena(ano, mes, 2));
  }
  return periodos;
}

/** Em que quinzena do calendário cai uma data `AAAA-MM-DD`. */
export function quinzenaDaData(data: string): 1 | 2 {
  return Number(data.slice(8, 10)) <= 15 ? 1 : 2;
}

/** `2026-08-15` vira `15/08` — o dia dentro do mês que o grupo já nomeou. */
export const emDiaCurto = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
