import { centavos, type Canal, type Frota } from "./dominio";
import { dentroDaCompetencia, type Competencia, type Dia } from "./periodo";
import type { Viagem } from "./leitores/operacao";

/**
 * O diário da quinzena — a operação dia a dia, e o dia aberto viagem a viagem.
 *
 * É a parte da planilha que a apuração não substituía. `apuracao.ts` responde
 * *quanto* a quinzena vale, verba a verba; as abas `01`…`31` da
 * `Fechamento_Remuneracao.xlsb` respondem outra coisa — **o que aconteceu no
 * dia 3** —, e é essa a pergunta de quem opera: qual veículo saiu, com quantas
 * caixas, quanto rendeu, e quanto fecharam `TOTAL PADRAO` e `TOTAL SPOT`.
 *
 * Duas funções, e a divisão é a da tela: `diasDaCompetencia` é a grade de
 * ladrilhos (uma por dia do período), `abrirDia` é a aba do dia.
 *
 * **A grade traz todos os dias, inclusive os vazios.** Um dia sem viagem
 * nenhuma não some da lista: ele aparece com zero viagens, porque "não rodou" e
 * "não importamos o 2Art" são coisas diferentes e a grade que esconde o dia
 * vazio faz as duas parecerem a mesma. O que separa uma da outra é a fonte
 * estar presente, e isso quem diz é a apuração.
 *
 * **Nada aqui recalcula dinheiro.** Os totais são somas do que o 2Art trouxe,
 * pelas mesmas colunas que a apuração usa (`ValorFrete` sem imposto,
 * `ValorFaturado` com), para que o total do dia e o total do canal na apuração
 * nunca possam discordar — são a mesma soma, feita uma vez.
 */

/** O que um recorte da operação somou. */
export interface TotaisDaOperacao {
  viagens: number;
  entregas: number;
  caixasCarregadas: number;
  caixasEntregues: number;
  /** O frete sem imposto — o que se soma para apurar o variável. */
  freteSemImposto: number;
  imposto: number;
  /** O frete com imposto — o que se compara ao CT-e. */
  freteComImposto: number;
}

export interface TotalPorFrota extends TotaisDaOperacao {
  frota: Frota;
}

export interface TotalPorCanal extends TotaisDaOperacao {
  canal: Canal;
}

/** Um dia da competência, como o ladrilho da grade o mostra. */
export interface DiaDaOperacao {
  dia: Dia;
  /** O número do dia no mês — `1` para 01/08. É o rótulo do ladrilho. */
  numeroDoDia: number;
  /** 0 = domingo. Sem nome porque nomear é da tela, que sabe o idioma dela. */
  diaDaSemana: number;
  totais: TotaisDaOperacao;
  /** `TOTAL PADRAO`, `TOTAL SPOT` — a abertura que as abas diárias fazem. */
  porFrota: TotalPorFrota[];
  porCanal: TotalPorCanal[];
}

/** O dia aberto: os totais e as viagens que os produziram. */
export interface DiaAberto extends DiaDaOperacao {
  viagens: Viagem[];
}

const ZERO = (): TotaisDaOperacao => ({
  viagens: 0,
  entregas: 0,
  caixasCarregadas: 0,
  caixasEntregues: 0,
  freteSemImposto: 0,
  imposto: 0,
  freteComImposto: 0,
});

function somar(alvo: TotaisDaOperacao, viagem: Viagem): void {
  alvo.viagens += 1;
  alvo.entregas += viagem.entregas;
  alvo.caixasCarregadas += viagem.caixasCarregadas;
  alvo.caixasEntregues += viagem.caixasEntregues;
  alvo.freteSemImposto += viagem.valorFrete;
  alvo.imposto += viagem.valorDeImposto;
  alvo.freteComImposto += viagem.valorFaturado;
}

function arredondar(t: TotaisDaOperacao): TotaisDaOperacao {
  return {
    ...t,
    caixasCarregadas: centavos(t.caixasCarregadas),
    caixasEntregues: centavos(t.caixasEntregues),
    freteSemImposto: centavos(t.freteSemImposto),
    imposto: centavos(t.imposto),
    freteComImposto: centavos(t.freteComImposto),
  };
}

/** A ordem em que a planilha abre a frota, e a que a tela repete. */
const ORDEM_DA_FROTA: Frota[] = ["PADRAO", "SPOT", "FIXO", "ESPECIAL"];
const ORDEM_DO_CANAL: Canal[] = ["ROTA", "AS"];

function abrirPorFrota(viagens: Viagem[]): TotalPorFrota[] {
  const por = new Map<Frota, TotaisDaOperacao>();
  for (const v of viagens) {
    const atual = por.get(v.frota) ?? ZERO();
    somar(atual, v);
    por.set(v.frota, atual);
  }
  return [...por]
    .sort((a, b) => ORDEM_DA_FROTA.indexOf(a[0]) - ORDEM_DA_FROTA.indexOf(b[0]))
    .map(([frota, t]) => ({ frota, ...arredondar(t) }));
}

function abrirPorCanal(viagens: Viagem[]): TotalPorCanal[] {
  const por = new Map<Canal, TotaisDaOperacao>();
  for (const v of viagens) {
    const atual = por.get(v.canal) ?? ZERO();
    somar(atual, v);
    por.set(v.canal, atual);
  }
  return [...por]
    .sort((a, b) => ORDEM_DO_CANAL.indexOf(a[0]) - ORDEM_DO_CANAL.indexOf(b[0]))
    .map(([canal, t]) => ({ canal, ...arredondar(t) }));
}

/** Os dias de `inicio` a `fim`, em `AAAA-MM-DD`. */
function diasDoPeriodo(competencia: Competencia): Dia[] {
  const dias: Dia[] = [];
  const fim = new Date(`${competencia.fim}T00:00:00Z`).getTime();
  for (let t = new Date(`${competencia.inicio}T00:00:00Z`).getTime(); t <= fim; t += 86_400_000) {
    dias.push(new Date(t).toISOString().slice(0, 10));
  }
  return dias;
}

/**
 * A grade de dias da competência — um por dia do período, com ou sem operação.
 *
 * Viagem fora do período é descartada em silêncio, e não é erro: o 2Art é
 * exportado por mês, e a quinzena é meio mês. O que a fonte trouxe a mais
 * pertence à outra competência, e apurá-lo aqui seria cobrá-lo duas vezes.
 */
export function diasDaCompetencia(competencia: Competencia, viagens: Viagem[]): DiaDaOperacao[] {
  const porDia = new Map<Dia, Viagem[]>();
  for (const v of viagens) {
    if (!dentroDaCompetencia(competencia, v.dia)) continue;
    const atual = porDia.get(v.dia);
    if (atual) atual.push(v);
    else porDia.set(v.dia, [v]);
  }

  return diasDoPeriodo(competencia).map((dia) => resumir(dia, porDia.get(dia) ?? []));
}

function resumir(dia: Dia, doDia: Viagem[]): DiaDaOperacao {
  const totais = ZERO();
  for (const v of doDia) somar(totais, v);
  return {
    dia,
    numeroDoDia: Number(dia.slice(8, 10)),
    diaDaSemana: new Date(`${dia}T00:00:00Z`).getUTCDay(),
    totais: arredondar(totais),
    porFrota: abrirPorFrota(doDia),
    porCanal: abrirPorCanal(doDia),
  };
}

/**
 * Um dia aberto: os mesmos totais da grade, e as viagens que os produziram.
 *
 * A ordem das viagens é a da planilha — frota, depois canal, depois veículo —,
 * porque é assim que quem confere lê: os `Padrao` juntos, o `TOTAL PADRAO`
 * embaixo, e o mesmo para o spot. Dentro do grupo, o mapa desempata, que é o
 * número que o roteirizador imprime na rota.
 */
export function abrirDia(dia: Dia, viagens: Viagem[]): DiaAberto {
  const doDia = viagens
    .filter((v) => v.dia === dia)
    .sort(
      (a, b) =>
        ORDEM_DA_FROTA.indexOf(a.frota) - ORDEM_DA_FROTA.indexOf(b.frota) ||
        ORDEM_DO_CANAL.indexOf(a.canal) - ORDEM_DO_CANAL.indexOf(b.canal) ||
        (a.detalhe?.veiculo ?? "").localeCompare(b.detalhe?.veiculo ?? "", "pt-BR", {
          numeric: true,
        }) ||
        a.mapa.localeCompare(b.mapa, "pt-BR", { numeric: true }) ||
        a.linha - b.linha,
    );

  return { ...resumir(dia, doDia), viagens: doDia };
}
