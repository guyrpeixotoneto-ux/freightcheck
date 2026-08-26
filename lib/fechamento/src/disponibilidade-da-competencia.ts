import { centavos, type Canal, type TipoDeFrotaContratada } from "./dominio";
import type { Dia } from "./periodo";
import type { DiaDeDisponibilidade } from "./leitores/disponibilidade";

/**
 * A DISPONIBILIDADE DA COMPETÊNCIA — o 03.08.18 aberto dia a dia, por frota.
 *
 * **Este módulo é puro, e não é o motor financeiro.** Ele não apura, não forma
 * devido e não decide desconto nenhum: reorganiza para leitura as linhas que a
 * importação já gravou, somando o que soma e preservando o que o relatório
 * declarou. Quem transforma disponibilidade em dinheiro é
 * `descontoDeDisponibilidadeDoMes` (em `leitores/disponibilidade.ts`), pela
 * regra do mês — e continua sendo só ele.
 *
 * **A pergunta que a tela responde é "de que dia veio o desconto".** O
 * demonstrativo (03.08.20) agrupa quatro descontos em duas linhas e cobra o
 * mês inteiro de uma vez, no fecho da 2ª quinzena; contestar um centavo exige
 * saber de que dia, de que canal e de que frota ele saiu — e só o 03.08.18
 * diz. Este módulo é o que põe essa abertura na tela sem passar pela apuração.
 *
 * **Nada aqui reparte o mês em quinzenas.** O corte por período é de quem lê o
 * banco (`lerDisponibilidadeDaCompetencia`, em `persistencia.ts`), pelo mesmo
 * `WHERE` que `disponibilidadeDoMes` já usa; o que chega aqui já é o que
 * pertence ao período. Somar dois cortes diferentes na mesma função seria dar
 * a esta soma uma segunda regra de período, e a regra de período é uma só.
 *
 * **O total do mês não é somado aqui, e é de propósito.** Uma competência é
 * meia; somar a que está aberta e chamar o resultado de "desconto do mês"
 * afirmaria como cobrança o que ainda é acúmulo parcial. O que esta soma diz é
 * o que o período trouxe — e a tela diz, por extenso, que a cobrança é mensal.
 */

/** O gap da transportadora, aberto como o relatório o abre, e somado. */
export interface GapDaTransportadora {
  frotaCancelada: number;
  outrosCancelados: number;
  frotaNaoCancelada: number;
  outrosNaoCancelados: number;
  /** A soma das quatro parcelas — a parte do gap que desconta. */
  total: number;
}

export interface DescontosDaDisponibilidade {
  custoFixo: number;
  equipe: number;
  indiretos: number;
  fatorAjudante: number;
  /** O total que o relatório declara — não a soma das parcelas. */
  total: number;
}

/** Um dia de um canal, numa frota — a linha do 03.08.18, como a tela a lê. */
export interface LinhaDeDisponibilidade {
  dia: Dia;
  canal: Canal;
  frotaTotal: number;
  contratada: number;
  realPrimeiraViagem: number;
  realSegundaViagem: number;
  gapTotal: number;
  /** A parte do gap que é da Ambev — **não** desconta. */
  gapDaCia: number;
  gapDaTransportadora: GapDaTransportadora;
  descontos: DescontosDaDisponibilidade;
  /** Como o relatório os declara. `null` quando a coluna não veio. */
  percentualDeUtilizacao: number | null;
  percentualDeDisponibilidade: number | null;
}

/**
 * O que um recorte da disponibilidade somou.
 *
 * **Não há percentual somado.** `% Utilização` e `% Disponibilidade` são
 * razões declaradas linha a linha, e média de razão não é a razão da soma:
 * exibir um percentual "do período" obrigaria a escolher um denominador que o
 * relatório não escolheu. Os percentuais ficam onde o relatório os pôs — na
 * linha do dia.
 */
export interface TotaisDeDisponibilidade {
  /** Quantos dias distintos entraram — não o número de linhas. */
  dias: number;
  linhas: number;
  contratada: number;
  /** `Real 1ª` + `Real 2ª` — o que de fato rodou. */
  realizada: number;
  gapTotal: number;
  gapDaCia: number;
  gapDaTransportadora: number;
  descontos: DescontosDaDisponibilidade;
}

/** Uma das duas casinhas do 03.08.18: os caminhões (`FF`) ou as vans. */
export interface FrotaNaDisponibilidade {
  tipoDeFrota: TipoDeFrotaContratada;
  linhas: LinhaDeDisponibilidade[];
  totais: TotaisDeDisponibilidade;
}

/** A ordem em que o relatório abre as abas, e a que a tela repete. */
const ORDEM_DA_FROTA: TipoDeFrotaContratada[] = ["FF", "VAN"];
const ORDEM_DO_CANAL: Canal[] = ["ROTA", "AS"];

function somarGapDaTransportadora(g: DiaDeDisponibilidade["gapDaTransportadora"]): GapDaTransportadora {
  return {
    ...g,
    total: centavos(
      g.frotaCancelada + g.outrosCancelados + g.frotaNaoCancelada + g.outrosNaoCancelados,
    ),
  };
}

function linhaDe(d: DiaDeDisponibilidade): LinhaDeDisponibilidade {
  return {
    dia: d.dia,
    canal: d.canal,
    frotaTotal: d.frotaTotal,
    contratada: d.contratada,
    realPrimeiraViagem: d.realPrimeiraViagem,
    realSegundaViagem: d.realSegundaViagem,
    gapTotal: d.gapTotal,
    gapDaCia: d.gapDaCia,
    gapDaTransportadora: somarGapDaTransportadora(d.gapDaTransportadora),
    descontos: { ...d.descontos },
    percentualDeUtilizacao: d.percentualDeUtilizacao,
    percentualDeDisponibilidade: d.percentualDeDisponibilidade,
  };
}

function somar(linhas: LinhaDeDisponibilidade[]): TotaisDeDisponibilidade {
  const total = {
    dias: new Set(linhas.map((l) => l.dia)).size,
    linhas: linhas.length,
    contratada: 0,
    realizada: 0,
    gapTotal: 0,
    gapDaCia: 0,
    gapDaTransportadora: 0,
    descontos: { custoFixo: 0, equipe: 0, indiretos: 0, fatorAjudante: 0, total: 0 },
  };

  for (const l of linhas) {
    total.contratada += l.contratada;
    total.realizada += l.realPrimeiraViagem + l.realSegundaViagem;
    total.gapTotal += l.gapTotal;
    total.gapDaCia += l.gapDaCia;
    total.gapDaTransportadora += l.gapDaTransportadora.total;
    total.descontos.custoFixo += l.descontos.custoFixo;
    total.descontos.equipe += l.descontos.equipe;
    total.descontos.indiretos += l.descontos.indiretos;
    total.descontos.fatorAjudante += l.descontos.fatorAjudante;
    total.descontos.total += l.descontos.total;
  }

  return {
    ...total,
    contratada: centavos(total.contratada),
    realizada: centavos(total.realizada),
    gapTotal: centavos(total.gapTotal),
    gapDaCia: centavos(total.gapDaCia),
    gapDaTransportadora: centavos(total.gapDaTransportadora),
    descontos: {
      custoFixo: centavos(total.descontos.custoFixo),
      equipe: centavos(total.descontos.equipe),
      indiretos: centavos(total.descontos.indiretos),
      fatorAjudante: centavos(total.descontos.fatorAjudante),
      total: centavos(total.descontos.total),
    },
  };
}

/**
 * As linhas do 03.08.18 abertas por frota, cada uma em ordem de dia e canal.
 *
 * **Só aparece a frota que tem linha.** As duas casinhas são documentos
 * separados (`DISPONIBILIDADE_FF` e `DISPONIBILIDADE_VAN`), e uma frota sem
 * linha nenhuma não é uma frota que rodou zero: é um relatório que não chegou.
 * Quem diz qual das duas coisas é são as fontes, que a leitura do banco
 * devolve ao lado desta abertura — inventar aqui um bloco vazio faria a tela
 * afirmar zero desconto para uma van cujo arquivo ninguém enviou.
 */
export function abrirDisponibilidade(
  linhas: DiaDeDisponibilidade[],
): FrotaNaDisponibilidade[] {
  const por = new Map<TipoDeFrotaContratada, LinhaDeDisponibilidade[]>();
  for (const d of linhas) {
    const atual = por.get(d.tipoDeFrota) ?? [];
    atual.push(linhaDe(d));
    por.set(d.tipoDeFrota, atual);
  }

  return [...por]
    .sort((a, b) => ORDEM_DA_FROTA.indexOf(a[0]) - ORDEM_DA_FROTA.indexOf(b[0]))
    .map(([tipoDeFrota, doTipo]) => {
      const emOrdem = [...doTipo].sort(
        (a, b) =>
          a.dia.localeCompare(b.dia) ||
          ORDEM_DO_CANAL.indexOf(a.canal) - ORDEM_DO_CANAL.indexOf(b.canal),
      );
      return { tipoDeFrota, linhas: emOrdem, totais: somar(emOrdem) };
    });
}
