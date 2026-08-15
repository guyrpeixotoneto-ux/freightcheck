/**
 * Consolidação — do veículo ao conjunto, à unidade e à frota (§16, §17).
 *
 * **A regra que este arquivo existe para não violar: percentual consolidado
 * nunca é média de percentual.** A margem da frota é a soma dos resultados
 * dividida pela soma das receitas, e não a média das margens individuais — as
 * duas contas dão números diferentes sempre que os veículos têm tamanhos
 * diferentes, e a segunda dá o número errado. Um veículo que fatura R$ 500 com
 * 80% de margem e outro que fatura R$ 100.000 com 5% não têm margem média de
 * 42,5%: a frota tem 5,4%. É o teste `consolidacao.test.ts` que segura isso.
 *
 * A segunda regra é a de contagem: **cada ativo entra exatamente uma vez.** As
 * unidades econômicas já vêm disjuntas de `unidadesEconomicas`, e a
 * consolidação confere isso em vez de confiar — `ativosContados` é somado e
 * comparado com os ativos distintos.
 */

import {
  medirCobertura,
  montarSubtotais,
  somarSecoes,
  avaliarEstado,
  type ApuracaoDaDRE,
  type CoberturaDaDRE,
  type EstadoDaDRE,
  type LinhaDaDRE,
  type SecaoDaDRE,
  type SubtotalDaDRE,
} from "./motor";
import {
  componentesDoEscopo,
  NOTA_DA_SECAO,
  SECOES,
  type EscopoDeAlocacao,
} from "./plano";

const TOLERANCIA = 0.01;

export interface ConsolidadoDaDRE {
  escopo: EscopoDeAlocacao;
  effectiveDate: string;
  periodLabel: string;
  /** Quantas unidades econômicas entraram. */
  unidades: number;
  /** Quantos ativos distintos elas cobrem. Prova de não dupla contagem. */
  ativos: number;
  secoes: SecaoDaDRE[];
  subtotais: SubtotalDaDRE[];
  cobertura: CoberturaDaDRE;
  estado: EstadoDaDRE;
  /**
   * O que a curadoria destravaria, agregado.
   *
   * Existe no consolidado e não só na ficha porque a pergunta é de frota: quem
   * decide priorizar uma confirmação quer saber quanto da DRE ela abre para a
   * operação inteira, não para um caminhão.
   */
  aguardandoCuradoria: { code: string; titulo: string; oQueFalta: string }[];
  /** Quantas unidades tiveram resultado apurado, positivo e negativo. */
  distribuicao: {
    comResultado: number;
    positivas: number;
    negativas: number;
    neutras: number;
    semResultado: number;
  };
}

/**
 * Consolida um conjunto de apurações do mesmo escopo e da mesma vigência.
 *
 * A soma é feita **componente a componente**, e os subtotais e percentuais são
 * então recalculados pelas mesmas funções do motor. Somar os subtotais de cada
 * veículo daria o mesmo número quando tudo está apurado e um número errado
 * quando não está: um EBITDA inconclusivo em três veículos e conclusivo em
 * cinquenta somaria os cinquenta e chamaria o resultado de EBITDA da frota.
 */
export function consolidar(
  apuracoes: ApuracaoDaDRE[],
  escopo: EscopoDeAlocacao,
  vigencia: { effectiveDate: string; periodLabel: string },
): ConsolidadoDaDRE {
  const componentes = componentesDoEscopo(escopo);

  /* Numerador por componente. `null` só some quando *nenhuma* unidade tem valor. */
  const soma = new Map<string, { valor: number; unidades: number }>();
  for (const apuracao of apuracoes) {
    for (const secao of apuracao.secoes) {
      for (const linha of secao.linhas) {
        if (linha.valor === null) continue;
        const atual = soma.get(linha.code) ?? { valor: 0, unidades: 0 };
        atual.valor += linha.valor;
        atual.unidades += 1;
        soma.set(linha.code, atual);
      }
    }
  }

  /* Uma linha-modelo por componente, para herdar ausência, evidência e rótulos. */
  const modelo = new Map<string, LinhaDaDRE>();
  for (const apuracao of apuracoes) {
    for (const secao of apuracao.secoes) {
      for (const linha of secao.linhas) {
        if (!modelo.has(linha.code)) modelo.set(linha.code, linha);
      }
    }
  }

  const linhas: LinhaDaDRE[] = componentes.map((componente) => {
    const base = modelo.get(componente.code);
    const acumulado = soma.get(componente.code);
    const valor = acumulado ? Number(acumulado.valor.toFixed(2)) : null;
    return {
      code: componente.code,
      titulo: componente.titulo,
      secao: componente.secao,
      sinal: componente.sinal,
      escopo: componente.escopo,
      valor,
      /*
        Consolidado é sempre CALCULADO quando tem valor: ele é a soma de muitos
        ativos, mesmo que cada parcela tenha sido observada. Chamar de OBSERVADO
        um número que nenhuma célula contém seria mentir sobre a natureza dele.
      */
      natureza: valor === null ? "NAO_DISPONIVEL" : "CALCULADO",
      contribuicao: valor === null ? null : Number((valor * componente.sinal).toFixed(2)),
      percentualDaReceita: null,
      /* As origens ficam na ficha do veículo. Num consolidado de 62 unidades
         elas seriam centenas de entradas que ninguém abre — e o caminho até a
         célula continua a um clique, pela linha do veículo. */
      origens: [],
      ausencia:
        valor === null
          ? (base?.ausencia ?? {
              motivo: componente.ausencia?.motivo ?? "COLUNA_SEM_DADO",
              rotulo: "",
              oQueFalta: componente.ausencia?.oQueFalta ?? "",
            })
          : null,
      essencial: componente.essencial,
      evidencia: componente.evidencia,
    };
  });

  const receita = somarSecoes(linhas, ["RECEITA_BRUTA"]);
  const base = receita !== null && Math.abs(receita) > TOLERANCIA ? receita : null;
  for (const l of linhas) {
    l.percentualDaReceita =
      base === null || l.valor === null ? null : Number(((l.valor / base) * 100).toFixed(2));
  }

  const porSecao = new Map(SECOES.map((s) => [s.id, [] as LinhaDaDRE[]]));
  for (const l of linhas) porSecao.get(l.secao)!.push(l);

  const secoes: SecaoDaDRE[] = SECOES.filter((s) => porSecao.get(s.id)!.length > 0).map((s) => ({
    id: s.id,
    titulo: s.titulo,
    nota: NOTA_DA_SECAO[s.id],
    linhas: porSecao.get(s.id)!,
    total: somarSecoes(linhas, [s.id]),
    fecha: s.fecha,
  }));

  const subtotais = montarSubtotais(linhas, base);
  const cobertura = medirCobertura(componentes, linhas, escopo);

  const resultados = apuracoes.map(
    (a) => a.subtotais.find((s) => s.id === "RESULTADO_ECONOMICO")!.valorParcial,
  );

  const ativos = new Set(apuracoes.flatMap((a) => a.identidade.map((i) => i.entityId)));

  return {
    escopo,
    effectiveDate: vigencia.effectiveDate,
    periodLabel: vigencia.periodLabel,
    unidades: apuracoes.length,
    ativos: ativos.size,
    secoes,
    subtotais,
    cobertura,
    estado: avaliarEstado(subtotais, cobertura),
    aguardandoCuradoria: linhas
      .filter((l) => l.ausencia?.motivo === "SEMANTICA_NAO_CONFIRMADA")
      .map((l) => ({ code: l.code, titulo: l.titulo, oQueFalta: l.ausencia!.oQueFalta })),
    distribuicao: {
      comResultado: resultados.filter((r) => r !== null).length,
      positivas: resultados.filter((r) => r !== null && r > TOLERANCIA).length,
      negativas: resultados.filter((r) => r !== null && r < -TOLERANCIA).length,
      neutras: resultados.filter((r) => r !== null && Math.abs(r) <= TOLERANCIA).length,
      semResultado: resultados.filter((r) => r === null).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Ranking e atenção
// ---------------------------------------------------------------------------

export interface LinhaDoRanking {
  id: string;
  rotulo: string;
  escopo: EscopoDeAlocacao;
  entityIds: string[];
  orfa: boolean;
  receita: number | null;
  /** O resultado apurado com o que existe. Ver `SubtotalDaDRE.valorParcial`. */
  resultado: number | null;
  margemPercentual: number | null;
  /** Custos identificados: receita − resultado. Nulo quando algum lado falta. */
  custo: number | null;
  cobertura: number;
  estado: EstadoDaDRE;
  /** Contra a vigência anterior. Nulo quando não há as duas pontas. */
  variacaoResultado: number | null;
  variacaoResultadoPercentual: number | null;
  variacaoReceita: number | null;
}

export type CriterioDeOrdenacao =
  | "MAIOR_RESULTADO"
  | "MENOR_RESULTADO"
  | "MAIOR_MARGEM"
  | "MENOR_MARGEM"
  | "MAIOR_RECEITA"
  | "MAIOR_CUSTO"
  | "MAIOR_DETERIORACAO"
  | "MAIOR_MELHORA";

export const CRITERIOS: { id: CriterioDeOrdenacao; rotulo: string }[] = [
  { id: "MAIOR_RESULTADO", rotulo: "Maior resultado" },
  { id: "MENOR_RESULTADO", rotulo: "Menor resultado" },
  { id: "MAIOR_MARGEM", rotulo: "Maior margem" },
  { id: "MENOR_MARGEM", rotulo: "Menor margem" },
  { id: "MAIOR_RECEITA", rotulo: "Maior receita" },
  { id: "MAIOR_CUSTO", rotulo: "Maior custo" },
  { id: "MAIOR_DETERIORACAO", rotulo: "Maior deterioração" },
  { id: "MAIOR_MELHORA", rotulo: "Maior melhora" },
];

/**
 * Ordena o ranking, mantendo **o que não tem número sempre no fim**.
 *
 * Um veículo sem resultado apurado não é o pior nem o melhor: ele é o
 * desconhecido, e colocá-lo em qualquer extremo da lista faria a tela dizer uma
 * coisa que os dados não dizem. Ele fica no fim, em qualquer critério, com a
 * célula marcada.
 */
export function ordenarRanking(
  linhas: LinhaDoRanking[],
  criterio: CriterioDeOrdenacao,
): LinhaDoRanking[] {
  const chave = (l: LinhaDoRanking): number | null => {
    switch (criterio) {
      case "MAIOR_RESULTADO":
      case "MENOR_RESULTADO":
        return l.resultado;
      case "MAIOR_MARGEM":
      case "MENOR_MARGEM":
        return l.margemPercentual;
      case "MAIOR_RECEITA":
        return l.receita;
      case "MAIOR_CUSTO":
        return l.custo;
      case "MAIOR_DETERIORACAO":
      case "MAIOR_MELHORA":
        return l.variacaoResultado;
    }
  };
  const crescente = criterio === "MENOR_RESULTADO" || criterio === "MENOR_MARGEM" || criterio === "MAIOR_DETERIORACAO";

  return [...linhas].sort((a, b) => {
    const va = chave(a);
    const vb = chave(b);
    if (va === null && vb === null) return a.rotulo.localeCompare(b.rotulo, "pt-BR");
    if (va === null) return 1;
    if (vb === null) return -1;
    return crescente ? va - vb : vb - va;
  });
}

/** Por que um veículo precisa de atenção (§15). Toda regra é sobre número, nunca texto. */
export type MotivoDeAtencao =
  | "RESULTADO_NEGATIVO"
  | "RESULTADO_DETERIOROU"
  | "MARGEM_BAIXA"
  | "RECEITA_CAIU"
  | "SEM_APURACAO";

export interface Alerta {
  id: string;
  rotulo: string;
  entityIds: string[];
  motivo: MotivoDeAtencao;
  severidade: "CRITICO" | "ATENCAO";
  /** A frase, montada a partir dos números que a dispararam. */
  mensagem: string;
  /** Os números que sustentam o alerta, para a tela e para o Assistente. */
  numeros: Record<string, number>;
}

/**
 * Os limiares.
 *
 * Ficam nomeados e num lugar só porque são a única parte deste módulo que é
 * escolha e não medição. Mudá-los é uma decisão de produto, e ela fica visível
 * num diff em vez de espalhada por comparações soltas.
 */
export const LIMIARES = {
  /** Abaixo disto a margem é baixa o suficiente para valer um aviso. */
  margemBaixaPercentual: 5,
  /** Queda de resultado, em pontos percentuais, que acende o alerta. */
  quedaDeResultadoPercentual: 20,
  /** Queda de receita, em pontos percentuais, que acende o alerta. */
  quedaDeReceitaPercentual: 10,
};

/**
 * Quem precisa de atenção, em ordem de gravidade.
 *
 * As regras são todas sobre os números que a própria tabela mostra — é a
 * exigência de §15. Nenhuma frase aqui é escrita antes de o número existir: a
 * mensagem é montada a partir dele.
 */
export function veiculosComAtencao(linhas: LinhaDoRanking[]): Alerta[] {
  const alertas: Alerta[] = [];

  for (const l of linhas) {
    const base = { id: l.id, rotulo: l.rotulo, entityIds: l.entityIds };

    if (l.resultado !== null && l.resultado < 0) {
      alertas.push({
        ...base,
        motivo: "RESULTADO_NEGATIVO",
        severidade: "CRITICO",
        mensagem: `Resultado apurado negativo: ${brl(l.resultado)} no período.`,
        numeros: { resultado: l.resultado },
      });
    }

    if (
      l.variacaoResultadoPercentual !== null &&
      l.variacaoResultadoPercentual <= -LIMIARES.quedaDeResultadoPercentual
    ) {
      alertas.push({
        ...base,
        motivo: "RESULTADO_DETERIOROU",
        severidade: "CRITICO",
        mensagem:
          `Resultado caiu ${Math.abs(l.variacaoResultadoPercentual).toFixed(1)}% ` +
          `(${brl(l.variacaoResultado ?? 0)}) contra a vigência anterior.`,
        numeros: {
          variacao: l.variacaoResultado ?? 0,
          variacaoPercentual: l.variacaoResultadoPercentual,
        },
      });
    }

    if (
      l.margemPercentual !== null &&
      l.margemPercentual >= 0 &&
      l.margemPercentual < LIMIARES.margemBaixaPercentual
    ) {
      alertas.push({
        ...base,
        motivo: "MARGEM_BAIXA",
        severidade: "ATENCAO",
        mensagem: `Margem apurada de ${l.margemPercentual.toFixed(1)}% da receita.`,
        numeros: { margem: l.margemPercentual },
      });
    }

    if (
      l.variacaoReceita !== null &&
      l.receita !== null &&
      l.receita > 0 &&
      l.variacaoReceita < 0 &&
      Math.abs(l.variacaoReceita) / (l.receita - l.variacaoReceita) * 100 >=
        LIMIARES.quedaDeReceitaPercentual
    ) {
      const queda =
        (Math.abs(l.variacaoReceita) / (l.receita - l.variacaoReceita)) * 100;
      alertas.push({
        ...base,
        motivo: "RECEITA_CAIU",
        severidade: "ATENCAO",
        mensagem: `Receita caiu ${queda.toFixed(1)}% (${brl(l.variacaoReceita)}).`,
        numeros: { variacaoReceita: l.variacaoReceita, quedaPercentual: -queda },
      });
    }

    if (l.receita === null) {
      alertas.push({
        ...base,
        motivo: "SEM_APURACAO",
        severidade: "ATENCAO",
        mensagem:
          "Nenhuma receita pôde ser apurada nesta vigência — o ativo aparece na " +
          "frota sem componente confirmado que o remunere.",
        numeros: {},
      });
    }
  }

  const ordem: Record<MotivoDeAtencao, number> = {
    RESULTADO_NEGATIVO: 0,
    RESULTADO_DETERIOROU: 1,
    MARGEM_BAIXA: 2,
    RECEITA_CAIU: 3,
    SEM_APURACAO: 4,
  };

  /*
    Dentro de cada motivo, o maior número primeiro.

    Ordenar por placa dentro do motivo punha um prejuízo de R$ 343 acima de um
    de R$ 6.400 só porque a placa vinha antes no alfabeto — numa lista de
    quarenta alertas, quem lê os cinco primeiros lê os cinco menos importantes.
  */
  const peso = (a: Alerta): number =>
    Math.max(0, ...Object.values(a.numeros).map((v) => Math.abs(v)));

  return alertas.sort(
    (a, b) =>
      ordem[a.motivo] - ordem[b.motivo] ||
      peso(b) - peso(a) ||
      a.rotulo.localeCompare(b.rotulo, "pt-BR"),
  );
}

function brl(valor: number): string {
  return `R$ ${valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
