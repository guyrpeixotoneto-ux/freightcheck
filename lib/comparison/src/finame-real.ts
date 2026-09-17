/**
 * O REALIZADO CONTRA O REMUNERADO — duas granularidades, sem dupla contagem.
 *
 * ---------------------------------------------------------------------------
 * A medição que decidiu este arquivo
 * ---------------------------------------------------------------------------
 * A pergunta era se a comparação mensal deveria **somar as duas quinzenas** do
 * remunerado antes de confrontá-las com o realizado do mês. A resposta estava
 * no acervo, e é inequívoca — agosto/2026, o único mês com as duas quinzenas
 * importadas:
 *
 * | | placas nas duas quinzenas | com valor **idêntico** nas duas |
 * |---|---|---|
 * | cavalos | 64 | 64 |
 * | carretas | 47 | 47 |
 *
 * 111 de 111. `finameCavalo` na vigência da 1ª quinzena e na da 2ª é **o mesmo
 * número**, não duas metades. O produto já dizia isso em outro lugar: a
 * curadoria confirmou essas colunas como periodicidade `MENSAL`, e
 * `NOTA_DA_GAVETA.MENSAL` (`lib/composition/src/regras.ts`) escreve "o que o
 * equipamento recebe **por mês** nesta vigência". A vigência é quinzenal; o
 * valor dentro dela é mensal.
 *
 * O cruzamento com o extrato do banco fecha o argumento. Em 715 pares
 * (placa, mês) comparáveis, a razão realizado ÷ remunerado-de-uma-quinzena tem
 * **mediana 1,03**. Somando as quinzenas ela iria para ~2,06 — quer dizer, a
 * auditoria passaria a afirmar que a Ambev paga o dobro do que o banco cobra,
 * em toda a frota, todo mês.
 *
 * Então a regra é: **um** valor de cada lado.
 *
 *     remunerado(mês) = o valor mensal contido na vigência quinzenal do mês
 *     realizado(mês)  = o consolidado da competência
 *     desvio(mês)     = realizado − remunerado
 *
 * ---------------------------------------------------------------------------
 * E quando as duas quinzenas discordam?
 * ---------------------------------------------------------------------------
 * Não acontece no acervo de hoje, e é por isso mesmo que precisa ter resposta:
 * o dia em que acontecer, a diferença é informação, não ruído a alisar. Média
 * silenciosa está fora — escolheria um número que nenhum dos dois arquivos diz.
 * A linha sai como `REMUNERADO_DIVERGE_ENTRE_QUINZENAS`, com os dois valores
 * visíveis, e não entra em soma nenhuma enquanto alguém não olhar.
 *
 * ---------------------------------------------------------------------------
 * Ausência não vira zero
 * ---------------------------------------------------------------------------
 * A mesma regra que atravessa `finame.ts`: um lado que não existe não produz
 * desvio, não produz percentual e não entra em total. Produz um estado com
 * nome. Zero no lugar de nulo transformaria "a competência ainda não foi
 * importada" numa economia de 100%.
 */

/** O que o remunerado diz numa das quinzenas do mês. */
export interface RemuneradoDaQuinzena {
  /** `YYYY-MM-DD` — dia 1 ou dia 16. */
  effectiveDate: string;
  /** 1 ou 2. */
  quinzena: 1 | 2;
  /** O rótulo da vigência, verbatim: `EMPURRADA_1_8_2026`. */
  label: string;
  placa: string;
  /** O valor **mensal** que a vigência carrega. `null` quando não há fato. */
  valor: number | null;
}

/** O que o extrato do banco diz da competência. */
export interface RealizadoDaCompetencia {
  /** `YYYY-MM-01`. */
  competencia: string;
  placa: string;
  /** A despesa do mês, em positivo. */
  valor: number;
  /** Quantos lançamentos foram somados. Vai para a tela, sempre. */
  lancamentos: number;
  /** A competência pode estar parcial — ver a apuração da importação. */
  parcial: boolean;
  motivoParcial: string | null;
}

export type EstadoDaComparacaoReal =
  | "COMPARAVEL"
  | "REALIZADO_AUSENTE"
  | "REMUNERADO_AUSENTE"
  | "REMUNERADO_DIVERGE_ENTRE_QUINZENAS"
  | "COMPETENCIA_PARCIAL";

export const ROTULO_DO_ESTADO_REAL: Record<EstadoDaComparacaoReal, string> = {
  COMPARAVEL: "Comparável",
  REALIZADO_AUSENTE: "Sem realizado",
  REMUNERADO_AUSENTE: "Sem remunerado",
  REMUNERADO_DIVERGE_ENTRE_QUINZENAS: "Quinzenas discordam",
  COMPETENCIA_PARCIAL: "Competência parcial",
};

export interface LinhaDaComparacaoReal {
  competencia: string;
  placa: string;
  estado: EstadoDaComparacaoReal;
  /** O valor mensal do remunerado, ou `null` quando não há o que comparar. */
  remunerado: number | null;
  realizado: number | null;
  /** `realizado − remunerado`. Nulo sempre que um dos dois for nulo. */
  desvio: number | null;
  /** Em pontos percentuais do remunerado. Nulo quando ele for nulo ou zero. */
  desvioPercentual: number | null;
  lancamentos: number | null;
  /** As quinzenas do remunerado que entraram na leitura, para a tela mostrar. */
  quinzenasLidas: { quinzena: 1 | 2; label: string; valor: number | null }[];
  /** A frase que explica o estado quando ele não é `COMPARAVEL`. */
  nota: string | null;
}

/**
 * A frase que a tela usa para dizer o que cada lado mede.
 *
 * Está aqui, e não no componente, porque servidor e navegador precisam da mesma
 * — e porque a frase é a regra: quem a mudar sem mudar a regra vai precisar
 * passar por este arquivo.
 */
export const GRANULARIDADE_DO_REMUNERADO =
  "Remunerado: valor mensal da vigência quinzenal";
export const GRANULARIDADE_DO_REALIZADO = "Realizado: competência mensal";

/**
 * O que dizer quando alguém abre **uma** quinzena.
 *
 * A regra 4 do desenho: o realizado não é dividido por dois e não é alocado a
 * uma metade do mês. Ele é do mês, e a tela diz isso — inclusive que o mesmo
 * valor aparece nas duas quinzenas, para que a repetição não pareça duplicidade.
 */
export function notaDaQuinzenaIsolada(quinzena: 1 | 2, mesPorExtenso: string): string {
  return (
    `O realizado é de competência mensal: este é o financiamento de ${mesPorExtenso} inteiro, ` +
    `não da ${quinzena}ª quinzena. O mesmo valor aparece nas duas quinzenas do mês — não é ` +
    `duplicidade, e ele não foi dividido por dois: o extrato do banco fecha por mês, e ` +
    `repartir a parcela seria inventar uma alocação que o banco não fez.`
  );
}

/**
 * O valor mensal do remunerado num mês, a partir das quinzenas importadas.
 *
 * Devolve o valor **e** o que sustentou a leitura. Nunca soma, nunca tira
 * média: as duas quinzenas carregam o mesmo valor mensal, e quando não
 * carregam, isso é um achado.
 */
export function remuneradoDoMes(quinzenas: readonly RemuneradoDaQuinzena[]): {
  valor: number | null;
  divergem: boolean;
  lidas: { quinzena: 1 | 2; label: string; valor: number | null }[];
} {
  const lidas = [...quinzenas]
    .sort((a, b) => a.quinzena - b.quinzena)
    .map((q) => ({ quinzena: q.quinzena, label: q.label, valor: q.valor }));

  const comValor = lidas.filter((q) => q.valor !== null);
  if (comValor.length === 0) return { valor: null, divergem: false, lidas };

  const distintos = new Set(comValor.map((q) => q.valor as number));
  if (distintos.size > 1) return { valor: null, divergem: true, lidas };

  /*
    Uma quinzena só é o caso comum do acervo: dezembro/2025 a julho/2026 têm
    apenas a 2ª importada, agosto tem as duas. Com uma, o valor mensal dela é o
    valor mensal do mês — é o que "MENSAL" quer dizer —, e não meia leitura.
  */
  return { valor: comValor[0].valor as number, divergem: false, lidas };
}

/**
 * Compara uma competência inteira, placa a placa.
 *
 * O pareamento é por placa normalizada, que é a mesma entidade dos dois lados
 * por desenho de `entity_identifier`. Placa que só existe de um lado sai como
 * ausência **nomeada**, nunca como zero.
 */
export function compararCompetencia(
  competencia: string,
  remunerado: readonly RemuneradoDaQuinzena[],
  realizado: readonly RealizadoDaCompetencia[],
): LinhaDaComparacaoReal[] {
  const porPlacaRemunerado = new Map<string, RemuneradoDaQuinzena[]>();
  for (const r of remunerado) {
    const lista = porPlacaRemunerado.get(r.placa) ?? [];
    lista.push(r);
    porPlacaRemunerado.set(r.placa, lista);
  }
  const porPlacaRealizado = new Map(realizado.map((r) => [r.placa, r]));

  const placas = [
    ...new Set([...porPlacaRemunerado.keys(), ...porPlacaRealizado.keys()]),
  ].sort();

  return placas.map((placa) => {
    const quinzenas = porPlacaRemunerado.get(placa) ?? [];
    const real = porPlacaRealizado.get(placa) ?? null;
    const { valor: valorRemunerado, divergem, lidas } = remuneradoDoMes(quinzenas);
    const base = {
      competencia,
      placa,
      quinzenasLidas: lidas,
      lancamentos: real?.lancamentos ?? null,
    };

    if (divergem) {
      const valores = lidas
        .filter((q) => q.valor !== null)
        .map((q) => `${q.quinzena}ª quinzena: ${q.valor}`)
        .join("; ");
      return {
        ...base,
        estado: "REMUNERADO_DIVERGE_ENTRE_QUINZENAS",
        remunerado: null,
        realizado: real?.valor ?? null,
        desvio: null,
        desvioPercentual: null,
        nota:
          `As duas quinzenas do mês trazem valores diferentes para esta placa (${valores}). ` +
          `A coluna é mensal, então as duas deveriam trazer o mesmo número. A comparação ` +
          `fica de fora até alguém conferir qual das vigências está certa — uma média entre ` +
          `elas seria um valor que nenhum dos dois arquivos afirma.`,
      };
    }

    if (real === null) {
      return {
        ...base,
        estado: "REALIZADO_AUSENTE",
        remunerado: valorRemunerado,
        realizado: null,
        desvio: null,
        desvioPercentual: null,
        nota:
          "O extrato do financiamento não traz lançamento desta placa nesta competência. " +
          "Pode ser financiamento quitado, ativo alugado ou competência ainda não importada — " +
          "e nenhuma das três é zero.",
      };
    }

    if (valorRemunerado === null) {
      return {
        ...base,
        estado: "REMUNERADO_AUSENTE",
        remunerado: null,
        realizado: real.valor,
        desvio: null,
        desvioPercentual: null,
        nota:
          "A vigência remunerada deste mês não traz FINAME para esta placa. O banco cobrou, " +
          "e o que a Ambev paga por este ativo não está no acervo — é uma diferença a apurar, " +
          "não uma economia.",
      };
    }

    const desvio = arredondar(real.valor - valorRemunerado);
    return {
      ...base,
      estado: real.parcial ? "COMPETENCIA_PARCIAL" : "COMPARAVEL",
      remunerado: valorRemunerado,
      realizado: real.valor,
      desvio,
      desvioPercentual:
        valorRemunerado === 0 ? null : arredondar((desvio / valorRemunerado) * 100),
      nota: real.parcial ? real.motivoParcial : null,
    };
  });
}

export interface ResumoDaCompetencia {
  competencia: string;
  /** Só do que é comparável: somar o que não é seria somar ausência. */
  totalRemunerado: number;
  totalRealizado: number;
  desvio: number;
  desvioPercentual: number | null;
  placasComparadas: number;
  placasSemRealizado: number;
  placasSemRemunerado: number;
  placasComQuinzenasDivergentes: number;
  parcial: boolean;
}

/**
 * Os totais do mês — somando **apenas** as linhas comparáveis.
 *
 * Uma linha sem um dos lados não entra em nenhum dos dois totais. Somá-la de um
 * lado só faria o desvio do mês incluir placas que nunca foram comparadas, e o
 * número do topo deixaria de ser a soma das linhas de baixo — que é o defeito
 * mais caro que um painel pode ter.
 */
export function resumirCompetencia(
  competencia: string,
  linhas: readonly LinhaDaComparacaoReal[],
): ResumoDaCompetencia {
  const comparaveis = linhas.filter(
    (l) => l.remunerado !== null && l.realizado !== null,
  );
  const totalRemunerado = arredondar(
    comparaveis.reduce((s, l) => s + (l.remunerado as number), 0),
  );
  const totalRealizado = arredondar(
    comparaveis.reduce((s, l) => s + (l.realizado as number), 0),
  );
  const desvio = arredondar(totalRealizado - totalRemunerado);

  return {
    competencia,
    totalRemunerado,
    totalRealizado,
    desvio,
    desvioPercentual:
      totalRemunerado === 0 ? null : arredondar((desvio / totalRemunerado) * 100),
    placasComparadas: comparaveis.length,
    placasSemRealizado: linhas.filter((l) => l.estado === "REALIZADO_AUSENTE").length,
    placasSemRemunerado: linhas.filter((l) => l.estado === "REMUNERADO_AUSENTE").length,
    placasComQuinzenasDivergentes: linhas.filter(
      (l) => l.estado === "REMUNERADO_DIVERGE_ENTRE_QUINZENAS",
    ).length,
    parcial: linhas.some((l) => l.estado === "COMPETENCIA_PARCIAL"),
  };
}

function arredondar(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}
