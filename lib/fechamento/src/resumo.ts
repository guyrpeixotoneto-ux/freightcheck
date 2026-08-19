import { centavos, type Canal } from "./dominio";
import type { NaturezaDaVerba } from "./verbas";

/**
 * O mês inteiro numa página — o `RESUMO GERAL` da planilha, sem planilha.
 *
 * A apuração responde por **uma** quinzena, que é o grão do fechamento. Mas o
 * documento que a transportadora discute com a Ambev é mensal: a aba `Resumo
 * Geral` da `.xlsb` põe 1ª quinzena, 2ª quinzena e TOTAL lado a lado, e é
 * olhando para as três colunas que alguém decide se o mês fecha. Sem esta
 * consolidação, comparar exigia abrir duas telas e somar à mão — e somar à mão
 * o que o sistema já sabe é exatamente o trabalho que ele existe para tirar.
 *
 * **Por que a aritmética mora aqui e não na tela.** Pela mesma razão de
 * `lib/fechamento-gerencial`: uma soma feita no navegador é uma segunda opinião
 * sobre remuneração, e o produto não pode ter duas. Este módulo é puro — recebe
 * o que o banco guardou e devolve as três colunas —, o que permite conferir o
 * mês inteiro num teste sem subir nada.
 *
 * **Por que `null` e não `0` na quinzena que não apurou.** Uma quinzena sem
 * competência aberta e uma quinzena que valeu zero são coisas diferentes, e a
 * planilha confunde as duas (a célula vazia e a célula com `R$ -` têm a mesma
 * cara). Aqui a coluna vazia é `null` até o fim, e o total de uma quinzena só
 * é a soma das duas quando as duas existem — a alternativa seria apresentar
 * meio mês com cara de mês inteiro.
 *
 * **Por que o fecho compara com o 03.08.20, e não com o que a planilha chama de
 * `TOTAL GERAL UNIDADE`.** Aquela coluna é a reconstrução da própria planilha,
 * feita com um fator de conversão digitado (1,366960) que não sai de nenhum dos
 * arquivos. Reproduzi-la seria reproduzir o erro. O que este resumo põe lado a
 * lado são os dois números que têm documento: o que a Ambev **emitiu** em CT-e
 * (03.08.15) e o que o demonstrativo **assinado** diz que ela pagaria
 * (03.08.20).
 */

/** Um valor nas três colunas da planilha. `null` é ausência, nunca zero. */
export interface TresColunas {
  primeira: number | null;
  segunda: number | null;
  /** A soma das que existem, ou `null` quando nenhuma existe. */
  total: number | null;
}

/** Uma verba no mês, nas três colunas. */
export interface LinhaDoResumo {
  vbz: number;
  nome: string;
  natureza: NaturezaDaVerba | string;
  emitido: TresColunas;
  apurado: TresColunas;
}

/** As verbas de uma natureza, somadas — os quadros da planilha. */
export interface BlocoDoResumo {
  natureza: NaturezaDaVerba | string;
  titulo: string;
  linhas: LinhaDoResumo[];
  emitido: TresColunas;
  apurado: TresColunas;
}

/**
 * Um desconto do 03.08.20 no mês.
 *
 * Eles entram no resumo porque são as linhas que o `RESUMO GERAL` da planilha
 * traz entre as verbas e o total — `DESCONTO DE DEVOLUÇÃO`, `DESCONTO DE
 * DISPONIBILIDADE`, `DESCONTO COMPLEMENTAR NEGATIVO`. E entram **fora** das
 * somas: o relatório diz, em cada linha, que o valor já foi subtraído da verba
 * correspondente. Somá-los ao emitido descontaria duas vezes.
 */
export interface DescontoDoResumo {
  tipo: string;
  /** O rótulo curto, o que a tela mostra na coluna da esquerda. */
  nome: string;
  valores: TresColunas;
}

export interface CanalDoResumo {
  canal: Canal;
  blocos: BlocoDoResumo[];
  /**
   * Os descontos do demonstrativo, sem imposto e já subtraídos das verbas.
   * Informativos: existem para conferir contra a planilha, não para somar.
   */
  descontos: DescontoDoResumo[];
  emitido: TresColunas;
  /** O que a apuração reconstruiu — a soma dos apurados. */
  conferido: TresColunas;
  /** O emitido que nenhuma fonte sustenta. */
  semFonte: TresColunas;
  /** `Total Remuneração` do 03.08.20 — o lado que a Ambev assina. */
  demonstrativo: TresColunas;
  /** `emitido − demonstrativo`. Positivo: emitiu-se mais do que o combinado. */
  diferenca: TresColunas;
}

/** O que uma quinzena traz para o resumo — o que o banco guardou dela. */
export interface QuinzenaApurada {
  quinzena: 1 | 2;
  competenciaId: string;
  chave: string;
  estado: string;
  /** Nulo quando a competência existe e ainda não apurou. */
  verbas:
    | {
        vbz: number;
        canal: string;
        nome: string;
        natureza: string;
        emitido: number;
        esperado: number | null;
      }[]
    | null;
  /**
   * O `Total Remuneração` do 03.08.20, por canal.
   *
   * Vem da soma de `valor_faturado` dos itens gravados, que é como o próprio
   * relatório o fecha (frete + outros custos). Nulo quando o 03.08.20 não foi
   * importado — e aí a coluna do fecho fica vazia em vez de zerada.
   */
  demonstrativo: { canal: Canal; total: number }[] | null;
  /** Os descontos do 03.08.20, somados por canal e tipo. */
  descontos: { canal: Canal; tipo: string; valor: number }[] | null;
}

export interface ResumoDoMes {
  ano: number;
  mes: number;
  unidade: { codigo: string; nome: string | null };
  transportadora: { codigo: string; nome: string | null };
  /** As duas quinzenas do mês, existam elas ou não. */
  quinzenas: {
    quinzena: 1 | 2;
    competenciaId: string | null;
    chave: string | null;
    estado: string | null;
    apurada: boolean;
    temDemonstrativo: boolean;
  }[];
  canais: CanalDoResumo[];
}

/** Os quadros, na ordem em que a planilha os empilha. */
const BLOCOS: { natureza: string; titulo: string }[] = [
  { natureza: "FIXO", titulo: "Fixo — a parcela contratada da frota e da equipe" },
  { natureza: "ADMINISTRATIVO", titulo: "Administrativo — o repasse fixo" },
  { natureza: "VARIAVEL", titulo: "Variável — o que a operação rodou" },
  { natureza: "COMPLEMENTAR", titulo: "Complementar — a despesa extra aprovada" },
];

/**
 * Soma duas colunas que podem não existir.
 *
 * `null + 5` não é `5`: é `5` com a ressalva de que metade do mês não foi
 * apurada. A ressalva viaja no próprio dado — o total só some quando as duas
 * quinzenas somem —, porque uma tela que recebe um número não tem como saber
 * que ele é meio.
 */
function somar(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return centavos((a ?? 0) + (b ?? 0));
}

function tresColunas(primeira: number | null, segunda: number | null): TresColunas {
  return { primeira, segunda, total: somar(primeira, segunda) };
}

function acumular(alvo: TresColunas, parcela: TresColunas): TresColunas {
  return {
    primeira: somar(alvo.primeira, parcela.primeira),
    segunda: somar(alvo.segunda, parcela.segunda),
    total: somar(alvo.total, parcela.total),
  };
}

const VAZIO: TresColunas = { primeira: null, segunda: null, total: null };

function subtrair(a: TresColunas, b: TresColunas): TresColunas {
  const menos = (x: number | null, y: number | null) =>
    x === null || y === null ? null : centavos(x - y);
  return {
    primeira: menos(a.primeira, b.primeira),
    segunda: menos(a.segunda, b.segunda),
    total: menos(a.total, b.total),
  };
}

/**
 * Monta o resumo do mês a partir do que o banco guardou de cada quinzena.
 *
 * Recebe zero, uma ou duas quinzenas: o mês em que só a segunda foi importada é
 * o caso comum de quem está no meio do trabalho, e ele tem de aparecer inteiro,
 * com a primeira coluna vazia e dizendo por quê — em vez de esperar as duas
 * para mostrar qualquer coisa.
 */
export function montarResumo(entrada: {
  ano: number;
  mes: number;
  unidade: { codigo: string; nome: string | null };
  transportadora: { codigo: string; nome: string | null };
  quinzenas: QuinzenaApurada[];
}): ResumoDoMes {
  const daQuinzena = (n: 1 | 2) => entrada.quinzenas.find((q) => q.quinzena === n) ?? null;
  const primeira = daQuinzena(1);
  const segunda = daQuinzena(2);

  const valorDe = (q: QuinzenaApurada | null, escolher: (v: NonNullable<QuinzenaApurada["verbas"]>[number]) => number | null, filtro: (v: NonNullable<QuinzenaApurada["verbas"]>[number]) => boolean) => {
    if (!q?.verbas) return null;
    const alvos = q.verbas.filter(filtro);
    if (alvos.length === 0) return null;
    const valores = alvos.map(escolher).filter((n): n is number => n !== null);
    if (valores.length === 0) return null;
    return centavos(valores.reduce((s, n) => s + n, 0));
  };

  /* O universo de verbas é a união das duas quinzenas: uma verba que só
     apareceu numa delas ainda é linha do mês, com a outra coluna vazia. */
  const canais = new Map<Canal, Map<number, { nome: string; natureza: string }>>();
  for (const q of entrada.quinzenas) {
    for (const v of q.verbas ?? []) {
      const canal = v.canal as Canal;
      const porVbz = canais.get(canal) ?? new Map();
      if (!porVbz.has(v.vbz)) porVbz.set(v.vbz, { nome: v.nome, natureza: v.natureza });
      canais.set(canal, porVbz);
    }
  }

  const montados: CanalDoResumo[] = [];
  for (const [canal, verbas] of [...canais].sort((a, b) => a[0].localeCompare(b[0]))) {
    const blocos: BlocoDoResumo[] = [];
    let emitidoDoCanal = VAZIO;
    let conferidoDoCanal = VAZIO;
    let semFonteDoCanal = VAZIO;

    for (const { natureza, titulo } of BLOCOS) {
      const daNatureza = [...verbas]
        .filter(([, v]) => v.natureza === natureza)
        .sort((a, b) => a[0] - b[0]);
      if (daNatureza.length === 0) continue;

      const linhas: LinhaDoResumo[] = [];
      let emitidoDoBloco = VAZIO;
      let apuradoDoBloco = VAZIO;

      for (const [vbz, { nome }] of daNatureza) {
        const mesma = (v: { vbz: number; canal: string }) => v.vbz === vbz && v.canal === canal;
        const emitido = tresColunas(
          valorDe(primeira, (v) => v.emitido, mesma),
          valorDe(segunda, (v) => v.emitido, mesma),
        );
        const apurado = tresColunas(
          valorDe(primeira, (v) => v.esperado, mesma),
          valorDe(segunda, (v) => v.esperado, mesma),
        );
        linhas.push({ vbz, nome, natureza, emitido, apurado });
        emitidoDoBloco = acumular(emitidoDoBloco, emitido);
        apuradoDoBloco = acumular(apuradoDoBloco, apurado);
      }

      blocos.push({ natureza, titulo, linhas, emitido: emitidoDoBloco, apurado: apuradoDoBloco });
      emitidoDoCanal = acumular(emitidoDoCanal, emitidoDoBloco);
      conferidoDoCanal = acumular(conferidoDoCanal, apuradoDoBloco);
    }

    /* O sem fonte é o emitido das verbas que a apuração não reconstruiu — e é
       contado sobre as verbas, não como `emitido − conferido`: a subtração
       daria o mesmo número por acaso e esconderia a verba que fecha com
       diferença. */
    const semFonte = (q: QuinzenaApurada | null) =>
      valorDe(q, (v) => v.emitido, (v) => v.canal === canal && v.esperado === null);
    semFonteDoCanal = tresColunas(semFonte(primeira), semFonte(segunda));

    /*
      Os descontos aparecem na ordem em que a planilha os empilha, e só os que
      alguma das duas quinzenas trouxe: uma linha de desconto zerada em todo o
      mês é ruído — o relatório traz as quatro de disponibilidade sempre, e
      três delas costumam ser zero.
    */
    const tiposDeDesconto = new Map<string, string>([
      ["DEVOLUCAO", "Desconto de devolução"],
      ["DISPONIBILIDADE_CUSTO_FIXO", "Disponibilidade — custo fixo"],
      ["DISPONIBILIDADE_EQUIPE", "Disponibilidade — equipe de entrega"],
      ["DISPONIBILIDADE_INDIRETO", "Disponibilidade — custo indireto"],
      ["DISPONIBILIDADE_FATOR_AJUDANTE", "Disponibilidade — fator ajudante"],
      ["FRETE_MINIMO", "Desconto de frete mínimo"],
    ]);
    const descontos: DescontoDoResumo[] = [];
    for (const [tipo, nome] of tiposDeDesconto) {
      const valorDoDesconto = (q: QuinzenaApurada | null) => {
        const achado = q?.descontos?.find((d) => d.canal === canal && d.tipo === tipo);
        return achado ? achado.valor : null;
      };
      const valores = tresColunas(valorDoDesconto(primeira), valorDoDesconto(segunda));
      if (valores.total === null || valores.total === 0) continue;
      descontos.push({ tipo, nome, valores });
    }

    const doDemonstrativo = (q: QuinzenaApurada | null) =>
      q?.demonstrativo?.find((d) => d.canal === canal)?.total ?? null;
    const demonstrativo = tresColunas(doDemonstrativo(primeira), doDemonstrativo(segunda));

    montados.push({
      canal,
      blocos,
      descontos,
      emitido: emitidoDoCanal,
      conferido: conferidoDoCanal,
      semFonte: semFonteDoCanal,
      demonstrativo,
      diferenca: subtrair(emitidoDoCanal, demonstrativo),
    });
  }

  return {
    ano: entrada.ano,
    mes: entrada.mes,
    unidade: entrada.unidade,
    transportadora: entrada.transportadora,
    quinzenas: ([1, 2] as const).map((n) => {
      const q = daQuinzena(n);
      return {
        quinzena: n,
        competenciaId: q?.competenciaId ?? null,
        chave: q?.chave ?? null,
        estado: q?.estado ?? null,
        apurada: !!q?.verbas,
        temDemonstrativo: !!q?.demonstrativo,
      };
    }),
    canais: montados,
  };
}
