import type { Movimentos } from "@/lib/analise";

/**
 * O Radar de Alterações — a terceira leitura da Gestão à Vista, em matriz.
 *
 * O Financeiro responde "quanto" e o Alertas responde "quem mexeu"; nenhum dos
 * dois responde **quando**. O Radar é a grade unidade × vigência: cada célula
 * diz quantas alterações aquela unidade teve naquela competência, o impacto
 * apurado ali, e quantas alterações ficaram sem impacto apurado. Lido de
 * longe, é onde se vê que uma unidade concentrou tudo numa vigência só, ou que
 * o prejuízo veio pingando.
 *
 * Três recusas sustentam a grade, e as três estão neste arquivo e não na tela:
 *
 * 1. **Periodicidade não soma.** A grade inteira é desenhada numa
 *    periodicidade de cada vez (`montarRadar` recebe qual), porque somar
 *    R$/mês com R$/ano numa célula de wallboard produziria o número mais
 *    lido e menos verdadeiro do produto. `periodicidadesDoRadar` devolve
 *    quais existem no intervalo, na ordem do que pesa mais.
 * 2. **Vazio não é zero.** Uma célula sem vigência (`"sem-vigencia"`) e uma
 *    vigência importada sem comparação calculada (`"sem-comparacao"`, os
 *    `gaps` de `/changes/range`) são estados distintos de "0 alterações
 *    apuradas" — e cada um sai com um desenho próprio, nunca como `R$ 0`.
 * 3. **Sem impacto apurado continua visível.** `notCalculable` viaja até a
 *    célula: uma competência com dez alterações sem preço não pode aparecer
 *    como uma competência calma.
 *
 * Nada aqui lê a rede nem o React. A entrada é exatamente o JSON que
 * `/changes/range` devolve por contexto (`Movimentos`), o que deixa cada conta
 * conferível ao lado do contrato que a alimenta — a mesma separação de
 * `gestao-a-vista-autoplay.ts`.
 */

// ---------------------------------------------------------------------------
// A janela de vigências
// ---------------------------------------------------------------------------

/** Quantas colunas o Radar mostra por padrão — sete competências e o total. */
export const COLUNAS_PADRAO = 7;

/**
 * As vigências que viram coluna, da mais antiga à mais recente, e o `from` que
 * `/changes/range` precisa para produzi-las.
 *
 * `/changes/range` conta as transições que **vão** de `from` até `to` — a ponta
 * inicial é ponto de partida, não período somado (ver `families-view.ts`). Por
 * isso o `from` devolvido aqui é a vigência **anterior** à primeira coluna:
 * pedir `from` igual à primeira coluna devolveria uma coluna a menos, sempre.
 *
 * Sem vigência anterior à primeira coluna (o histórico inteiro cabe na janela),
 * `from` é a própria primeira vigência da série — e a coluna dela fica com
 * "sem comparação", que é a verdade: não há de onde comparar.
 */
export function janelaDoRadar(
  periodosDisponiveis: string[],
  ate: string | null,
  colunas = COLUNAS_PADRAO,
): { from: string | null; to: string | null; periodos: string[] } {
  const ordenados = [...new Set(periodosDisponiveis)].sort();
  const fim = ate ?? ordenados[ordenados.length - 1] ?? null;
  if (fim === null) return { from: null, to: null, periodos: [] };

  const ateOFim = ordenados.filter((p) => p <= fim);
  const periodos = ateOFim.slice(-colunas);
  const anterior = ateOFim[ateOFim.length - periodos.length - 1] ?? null;

  return { from: anterior ?? periodos[0] ?? null, to: fim, periodos };
}

// ---------------------------------------------------------------------------
// A grade
// ---------------------------------------------------------------------------

/**
 * O que a tela sabe de uma unidade antes de montar a linha dela.
 *
 * `movimentos` vem um por contexto, na mesma ordem de `contextos`, porque
 * `/changes/range` responde por um `scopeHash`/`canal` de cada vez. Uma
 * unidade com dois canais tem duas leituras, e a linha dela é a soma das duas
 * — a mesma régua da Visão Geral, que soma os contextos de uma unidade e nunca
 * unidades entre si sem dizer.
 */
export interface UnidadeDoRadar {
  unidade: string;
  label: string;
  contextos: { scopeHash: string; canal: string | null }[];
  movimentos: (Movimentos | null | undefined)[];
}

export type EstadoDaCelula =
  /** A unidade não tem essa vigência — nada aconteceu porque nada foi entregue. */
  | "sem-vigencia"
  /** Vigência importada sem comparação calculada — o que houve ali não está somado. */
  | "sem-comparacao"
  /** Houve comparação: `alteracoes` e `impacto` são fato apurado, inclusive quando zero. */
  | "apurado";

export interface CelulaDoRadar {
  periodo: string;
  label: string;
  estado: EstadoDaCelula;
  alteracoes: number;
  /** Na periodicidade escolhida. `0` quando a comparação existiu e não achou dinheiro nela. */
  impacto: number;
  /** Alterações que a comparação viu e não conseguiu precificar. */
  semApuracao: number;
}

export interface LinhaDoRadar {
  unidade: string;
  label: string;
  contextos: { scopeHash: string; canal: string | null }[];
  celulas: CelulaDoRadar[];
  /** As somas da janela inteira — a última coluna da grade. */
  totalDeAlteracoes: number;
  totalDeImpacto: number;
  totalSemApuracao: number;
}

/**
 * As periodicidades presentes na janela, a que pesa mais primeiro.
 *
 * É o que a tela oferece como abas: uma grade por periodicidade, nunca as duas
 * misturadas. A ordem é por módulo do total, e não por sinal — o que decide a
 * atenção de quem lê de longe é o tamanho do número, e a janela pode muito bem
 * ter o maior movimento a favor.
 */
export function periodicidadesDoRadar(unidades: UnidadeDoRadar[]): string[] {
  const totais = new Map<string, number>();
  for (const unidade of unidades) {
    for (const movimentos of unidade.movimentos) {
      for (const movimento of movimentos?.movements ?? []) {
        for (const [periodicidade, valor] of Object.entries(movimento.impact.byPeriodicity)) {
          totais.set(periodicidade, (totais.get(periodicidade) ?? 0) + valor);
        }
      }
    }
  }
  return [...totais.entries()]
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([periodicidade]) => periodicidade);
}

/**
 * A grade: uma linha por unidade, uma célula por vigência da janela.
 *
 * A ordem das linhas é a mesma do pódio da Visão Geral — maior módulo de
 * impacto primeiro, e o volume de alterações desempata. Unidade sem nenhuma
 * vigência na janela continua na grade, com a linha inteira vazia: sumir com
 * ela faria o telão dizer que a unidade não existe quando o que houve é que
 * ela não mexeu em nada.
 */
export function montarRadar(
  periodos: string[],
  unidades: UnidadeDoRadar[],
  periodicidade: string | null,
): LinhaDoRadar[] {
  const linhas = unidades.map((unidade) => {
    const movimentosPorPeriodo = new Map<string, { changes: number; impacto: number; semApuracao: number }>();
    const rotulos = new Map<string, string>();
    const semComparacao = new Set<string>();

    for (const movimentos of unidade.movimentos) {
      for (const movimento of movimentos?.movements ?? []) {
        rotulos.set(movimento.period, movimento.label);
        const acumulado = movimentosPorPeriodo.get(movimento.period) ?? {
          changes: 0,
          impacto: 0,
          semApuracao: 0,
        };
        acumulado.changes += movimento.changes;
        acumulado.impacto +=
          periodicidade === null ? 0 : (movimento.impact.byPeriodicity[periodicidade] ?? 0);
        acumulado.semApuracao += movimento.impact.notCalculable;
        movimentosPorPeriodo.set(movimento.period, acumulado);
      }
      for (const lacuna of movimentos?.gaps ?? []) {
        rotulos.set(lacuna.period, lacuna.label);
        semComparacao.add(lacuna.period);
      }
    }

    const celulas: CelulaDoRadar[] = periodos.map((periodo) => {
      const apurado = movimentosPorPeriodo.get(periodo);
      if (apurado) {
        return {
          periodo,
          label: rotulos.get(periodo) ?? periodo,
          estado: "apurado" as const,
          alteracoes: apurado.changes,
          impacto: apurado.impacto,
          semApuracao: apurado.semApuracao,
        };
      }
      return {
        periodo,
        label: rotulos.get(periodo) ?? periodo,
        estado: semComparacao.has(periodo) ? ("sem-comparacao" as const) : ("sem-vigencia" as const),
        alteracoes: 0,
        impacto: 0,
        semApuracao: 0,
      };
    });

    return {
      unidade: unidade.unidade,
      label: unidade.label,
      contextos: unidade.contextos,
      celulas,
      totalDeAlteracoes: celulas.reduce((soma, c) => soma + c.alteracoes, 0),
      totalDeImpacto: celulas.reduce((soma, c) => soma + c.impacto, 0),
      totalSemApuracao: celulas.reduce((soma, c) => soma + c.semApuracao, 0),
    };
  });

  return linhas.sort(
    (a, b) =>
      Math.abs(b.totalDeImpacto) - Math.abs(a.totalDeImpacto) ||
      b.totalDeAlteracoes - a.totalDeAlteracoes ||
      a.label.localeCompare(b.label),
  );
}

export interface ResumoDoRadar {
  alteracoes: number;
  /** Unidades com ao menos uma alteração na janela — não o tamanho da grade. */
  unidadesAfetadas: number;
  impacto: number;
  semApuracao: number;
}

/** Os quatro números do topo, somados da mesma grade que a tabela desenha. */
export function resumoDoRadar(linhas: LinhaDoRadar[]): ResumoDoRadar {
  return {
    alteracoes: linhas.reduce((soma, l) => soma + l.totalDeAlteracoes, 0),
    unidadesAfetadas: linhas.filter((l) => l.totalDeAlteracoes > 0).length,
    impacto: linhas.reduce((soma, l) => soma + l.totalDeImpacto, 0),
    semApuracao: linhas.reduce((soma, l) => soma + l.totalSemApuracao, 0),
  };
}

/**
 * A intensidade da célula, de 0 a 1 — quanto ela pesa contra a mais pesada da
 * grade.
 *
 * O telão é lido a metros de distância, onde o número não se lê e a cor sim.
 * A régua é o **módulo do impacto**, não a contagem de alterações: cinquenta
 * alterações de centavos não podem gritar mais alto que uma que custou o mês.
 * Sem nenhum impacto apurado na grade, tudo fica no piso — pintar por contagem
 * ali seria trocar a régua no meio da leitura, sem avisar.
 */
export function intensidadeDaCelula(impacto: number, maiorDaGrade: number): number {
  if (maiorDaGrade <= 0) return 0;
  return Math.min(1, Math.abs(impacto) / maiorDaGrade);
}

/** O maior módulo de impacto de uma célula da grade — a referência da escala. */
export function maiorImpactoDaGrade(linhas: LinhaDoRadar[]): number {
  return linhas.reduce(
    (maior, linha) =>
      linha.celulas.reduce((m, celula) => Math.max(m, Math.abs(celula.impacto)), maior),
    0,
  );
}
