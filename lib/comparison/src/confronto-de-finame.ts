/**
 * O CONFRONTO — remunerado contra realizado, na mesma competência.
 *
 * ---------------------------------------------------------------------------
 * A pergunta, e por que ela não é a da outra fonte
 * ---------------------------------------------------------------------------
 * A comparação entre vigências pergunta *o que mudou*. Esta pergunta é outra:
 * **a remuneração cobriu o custo?** Nenhuma das duas é caso particular da
 * outra, e é por isso que este arquivo existe em vez de um parâmetro em
 * `finame.ts`. Ali, "entrada" e "saída" de veículo são estados legítimos, o
 * percentual tem por base a ponta que quem lê escolher, e inverter o par é uma
 * leitura válida. Aqui nada disso vale: as duas pontas não são dois momentos,
 * são duas **naturezas** do mesmo mês.
 *
 * ---------------------------------------------------------------------------
 * A fórmula, e o que ela significa
 * ---------------------------------------------------------------------------
 * ```
 * diferença = remunerado − realizado
 * ```
 *
 * Positivo é **sobra de remuneração** (a Ambev pagou acima do custo), negativo
 * é **déficit** (pagou abaixo), zero é **equilíbrio**. A direção é fixa: ver
 * `permiteInverter`, em `fonte-de-finame.ts`.
 *
 * E uma advertência que é de produto, não de código: **sobra não é
 * automaticamente boa**. Uma sobra grande pode ser um ativo que saiu da
 * operação e continuou sendo remunerado — que é um achado de auditoria, não uma
 * vitória. Por isso a classificação deste arquivo é descritiva (`SOBRA`,
 * `DEFICIT`) e nunca avaliativa (`FAVORAVEL`), e a cor fica com quem desenha,
 * que é quem sabe o que aquela linha significa naquele lugar.
 *
 * ---------------------------------------------------------------------------
 * As quatro recusas
 * ---------------------------------------------------------------------------
 * 1. **Ausência não vira zero.** Um lado sem dado não é um lado com R$ 0,00. A
 *    linha sai com `cobertura` dizendo qual lado falta e `diferenca: null`.
 * 2. **Não se concilia tipo diferente.** A mesma placa como CAVALO no
 *    remunerado e CARRETA no realizado não é a mesma coisa medida duas vezes; é
 *    duas coisas. Sai `NAO_CONCILIADO`.
 * 3. **Não se soma duplicata.** Duas linhas de realizado para a mesma placa na
 *    mesma competência podem ser um rateio legítimo ou um lançamento repetido,
 *    e este módulo não tem como saber qual. Somá-las "porque provavelmente é
 *    rateio" inventaria custo. Sai `NAO_CONCILIADO`, dito.
 * 4. **O que não concilia não entra em total nenhum.** Nem no líquido, nem nos
 *    dois totais que o produzem — senão a identidade
 *    `líquido = remunerado − realizado` deixa de fechar na própria tela. O que
 *    ficou de fora é **informado** em `foraDoConfronto`, com quanto e quantos.
 */

import type { Competencia, RemuneradoDaCompetencia, SituacaoDoConsolidado } from "./competencia-de-finame";
import { TOLERANCIA_DO_CENTAVO } from "./competencia-de-finame";
import type { ValorRealizado } from "./realizado-de-finame";

/** O veredito de uma linha, em linguagem de quem decide. */
export type ResultadoDoConfronto =
  /** Remunerado acima do custo realizado. */
  | "SOBRA"
  /** Remunerado abaixo do custo realizado. */
  | "DEFICIT"
  /** Os dois lados batem, ao centavo. */
  | "EQUILIBRIO"
  /** Falta dado, ou os dados não são comparáveis. Nunca "zero". */
  | "NAO_CALCULAVEL";

/** O que a conciliação encontrou dos dois lados. */
export type CoberturaDoConfronto =
  /** Os dois lados existem, são do mesmo ativo e do mesmo mês. */
  | "COMPLETA"
  /** Há remunerado; o realizado não tem esta placa nesta competência. */
  | "SEM_REALIZADO"
  /** Há realizado; o remunerado não tem esta placa nesta competência. */
  | "SEM_REMUNERADO"
  /** Os dois lados existem e mesmo assim não se pode compará-los. */
  | "NAO_CONCILIADO";

/** Uma linha do confronto — uma placa, um mês, os dois lados. */
export interface LinhaDoConfronto {
  competencia: Competencia;
  entityLabel: string;
  entityType: string;
  /** O remunerado mensal consolidado. `null` quando não há. */
  remunerado: number | null;
  /** O custo realizado, já normalizado para leitura de custo. `null` quando não há. */
  realizado: number | null;
  /** `remunerado − realizado`, só quando a cobertura é completa. */
  diferenca: number | null;
  /**
   * `diferenca ÷ realizado`, em fração.
   *
   * `null` quando a base é zero — e não `Infinity`, nem 100%. Um realizado zero
   * com remunerado de mil reais não é "mil por cento a mais": é uma divisão que
   * não existe, e a tela escreve um traço.
   */
  variacao: number | null;
  resultado: ResultadoDoConfronto;
  cobertura: CoberturaDoConfronto;
  /** Por que não conciliou, quando não conciliou. Uma frase, para a tela. */
  motivo: string | null;
  /** O que a consolidação mensal do remunerado apurou, quando houve remunerado. */
  situacaoDoRemunerado: SituacaoDoConsolidado | null;
}

/** Os agregados que os cartões leem. */
export interface ResumoDoConfronto {
  competencia: Competencia;
  /** Placas com os dois lados conciliados — as que sustentam os totais. */
  veiculosConciliados: number;
  /** Σ do remunerado **dos conciliados**. */
  totalRemunerado: number;
  /** Σ do realizado **dos conciliados**. */
  totalRealizado: number;
  /** `totalRemunerado − totalRealizado`. Fecha com a soma das diferenças. */
  resultadoLiquido: number;
  veiculosComSobra: number;
  veiculosComDeficit: number;
  veiculosEmEquilibrio: number;
  /** A cobertura, dita em números — é o "98 de 104 veículos conciliados". */
  cobertura: {
    total: number;
    conciliados: number;
    semRealizado: number;
    semRemunerado: number;
    naoConciliados: number;
  };
  /**
   * O dinheiro que ficou fora dos totais, e quanto ele é.
   *
   * Existe para que "por que o líquido não bate com o que eu somei na mão?"
   * tenha resposta na própria tela. Sem isto, a exclusão correta pareceria um
   * erro de soma.
   */
  foraDoConfronto: {
    remuneradoSemRealizado: number;
    realizadoSemRemunerado: number;
    veiculos: number;
  };
}

export interface Confronto {
  competencia: Competencia;
  linhas: LinhaDoConfronto[];
  resumo: ResumoDoConfronto;
}

const chaveDo = (entityLabel: string, entityType: string) => `${entityLabel}${entityType}`;

/**
 * O confronto de uma competência.
 *
 * Recebe os dois lados **já consolidados no mesmo intervalo econômico** — o
 * remunerado mensal de `consolidarCompetencia` e o realizado mensal da fonte.
 * Não é papel desta função conciliar tempo: se ela recebesse uma quinzena de um
 * lado e um mês do outro, não teria como saber. Quem garante o intervalo é
 * quem chama, e é por isso que `competencia` viaja nos dois lados e é conferida
 * abaixo.
 */
export function confrontar(entrada: {
  competencia: Competencia;
  remunerado: readonly RemuneradoDaCompetencia[];
  realizado: readonly ValorRealizado[];
}): Confronto {
  const { competencia } = entrada;

  /*
    O realizado, indexado — e as duplicatas marcadas na indexação.

    Marcar aqui, e não na hora de comparar, é o que garante que a duplicata seja
    vista mesmo quando a placa não tem remunerado: ela não pode sumir do
    relatório de cobertura só porque o outro lado também falta.
  */
  const realizadoPorChave = new Map<string, ValorRealizado>();
  const duplicados = new Set<string>();
  for (const r of entrada.realizado) {
    if (r.competencia !== competencia) continue;
    const chave = chaveDo(r.entityLabel, r.entityType);
    if (realizadoPorChave.has(chave)) duplicados.add(chave);
    else realizadoPorChave.set(chave, r);
  }

  /* As placas do realizado que existem sob **outro** tipo de ativo — a recusa 2. */
  const tiposDoRealizadoPorPlaca = new Map<string, Set<string>>();
  for (const r of entrada.realizado) {
    if (r.competencia !== competencia) continue;
    const tipos = tiposDoRealizadoPorPlaca.get(r.entityLabel) ?? new Set<string>();
    tipos.add(r.entityType);
    tiposDoRealizadoPorPlaca.set(r.entityLabel, tipos);
  }

  const linhas: LinhaDoConfronto[] = [];
  const vistas = new Set<string>();

  for (const rem of entrada.remunerado) {
    if (rem.competencia !== competencia) continue;
    const chave = chaveDo(rem.entityLabel, rem.entityType);
    vistas.add(chave);
    const real = realizadoPorChave.get(chave);

    const base = {
      competencia,
      entityLabel: rem.entityLabel,
      entityType: rem.entityType,
      situacaoDoRemunerado: rem.situacao,
    };

    if (duplicados.has(chave)) {
      linhas.push({
        ...base,
        remunerado: rem.valor,
        realizado: null,
        diferenca: null,
        variacao: null,
        resultado: "NAO_CALCULAVEL",
        cobertura: "NAO_CONCILIADO",
        motivo:
          "O realizado traz mais de um lançamento para esta placa nesta competência. " +
          "Somá-los exigiria uma regra de rateio que esta instalação não declarou.",
      });
      continue;
    }

    /*
      O remunerado que a consolidação recusou não vira lado de comparação.

      Uma placa em DIVERGENCIA_INTRAMENSAL tem dois valores mensais no mesmo
      mês; confrontar qualquer um dos dois com o realizado do mês inteiro
      compararia intervalos econômicos diferentes — a recusa que
      `competencia-de-finame.ts` estabelece e que aqui se cumpre.
    */
    if (rem.situacao !== "CONSOLIDADO" || rem.valor === null) {
      linhas.push({
        ...base,
        remunerado: null,
        realizado: real?.valor ?? null,
        diferenca: null,
        variacao: null,
        resultado: "NAO_CALCULAVEL",
        cobertura: "NAO_CONCILIADO",
        motivo: MOTIVO_DA_SITUACAO[rem.situacao],
      });
      continue;
    }

    if (!real) {
      /* A mesma placa existe no realizado sob outro tipo: dizer isso é melhor
         que dizer "sem realizado", que mandaria procurar o que está ali. */
      const outrosTipos = [...(tiposDoRealizadoPorPlaca.get(rem.entityLabel) ?? [])].filter(
        (t) => t !== rem.entityType,
      );
      linhas.push({
        ...base,
        remunerado: rem.valor,
        realizado: null,
        diferenca: null,
        variacao: null,
        resultado: "NAO_CALCULAVEL",
        cobertura: outrosTipos.length > 0 ? "NAO_CONCILIADO" : "SEM_REALIZADO",
        motivo:
          outrosTipos.length > 0
            ? `O realizado tem esta placa como ${outrosTipos.join(", ")}, e o remunerado a tem ` +
              `como ${rem.entityType}. Tipos de ativo diferentes não se confrontam.`
            : null,
      });
      continue;
    }

    if (real.valor === null) {
      linhas.push({
        ...base,
        remunerado: rem.valor,
        realizado: null,
        diferenca: null,
        variacao: null,
        resultado: "NAO_CALCULAVEL",
        cobertura: "SEM_REALIZADO",
        motivo: null,
      });
      continue;
    }

    linhas.push({
      ...base,
      remunerado: rem.valor,
      realizado: real.valor,
      ...aritmetica(rem.valor, real.valor),
      cobertura: "COMPLETA",
      motivo: null,
    });
  }

  /* O que só o realizado tem — frota que custou e que ninguém remunerou. */
  for (const [chave, real] of realizadoPorChave) {
    if (vistas.has(chave)) continue;
    linhas.push({
      competencia,
      entityLabel: real.entityLabel,
      entityType: real.entityType,
      remunerado: null,
      realizado: duplicados.has(chave) ? null : real.valor,
      diferenca: null,
      variacao: null,
      resultado: "NAO_CALCULAVEL",
      cobertura: duplicados.has(chave) ? "NAO_CONCILIADO" : "SEM_REMUNERADO",
      motivo: duplicados.has(chave)
        ? "O realizado traz mais de um lançamento para esta placa nesta competência."
        : null,
      situacaoDoRemunerado: null,
    });
  }

  linhas.sort(
    (a, b) =>
      a.entityType.localeCompare(b.entityType) || a.entityLabel.localeCompare(b.entityLabel),
  );

  return { competencia, linhas, resumo: resumir(competencia, linhas) };
}

/** A conta de uma linha com os dois lados presentes. */
function aritmetica(
  remunerado: number,
  realizado: number,
): Pick<LinhaDoConfronto, "diferenca" | "variacao" | "resultado"> {
  const diferenca = arredondar(remunerado - realizado);
  /*
    A base zero não produz percentual — e não produz `Infinity`.

    O zero aqui é econômico e legítimo: um ativo quitado custa zero de FINAME no
    mês. O que não existe é a razão entre alguma coisa e nada.
  */
  const variacao = Math.abs(realizado) < TOLERANCIA_DO_CENTAVO ? null : diferenca / realizado;
  const resultado: ResultadoDoConfronto =
    Math.abs(diferenca) < TOLERANCIA_DO_CENTAVO
      ? "EQUILIBRIO"
      : diferenca > 0
        ? "SOBRA"
        : "DEFICIT";
  return { diferenca, variacao, resultado };
}

function resumir(competencia: Competencia, linhas: readonly LinhaDoConfronto[]): ResumoDoConfronto {
  let totalRemunerado = 0;
  let totalRealizado = 0;
  let veiculosComSobra = 0;
  let veiculosComDeficit = 0;
  let veiculosEmEquilibrio = 0;
  let conciliados = 0;
  let semRealizado = 0;
  let semRemunerado = 0;
  let naoConciliados = 0;
  let remuneradoSemRealizado = 0;
  let realizadoSemRemunerado = 0;

  for (const l of linhas) {
    if (l.cobertura === "COMPLETA" && l.remunerado !== null && l.realizado !== null) {
      conciliados += 1;
      totalRemunerado += l.remunerado;
      totalRealizado += l.realizado;
      if (l.resultado === "SOBRA") veiculosComSobra += 1;
      else if (l.resultado === "DEFICIT") veiculosComDeficit += 1;
      else if (l.resultado === "EQUILIBRIO") veiculosEmEquilibrio += 1;
      continue;
    }
    if (l.cobertura === "SEM_REALIZADO") {
      semRealizado += 1;
      if (l.remunerado !== null) remuneradoSemRealizado += l.remunerado;
    } else if (l.cobertura === "SEM_REMUNERADO") {
      semRemunerado += 1;
      if (l.realizado !== null) realizadoSemRemunerado += l.realizado;
    } else {
      naoConciliados += 1;
    }
  }

  totalRemunerado = arredondar(totalRemunerado);
  totalRealizado = arredondar(totalRealizado);

  return {
    competencia,
    veiculosConciliados: conciliados,
    totalRemunerado,
    totalRealizado,
    /* Da diferença dos totais arredondados, e não da soma das diferenças: é a
       mesma conta, e esta ordem garante que o cartão bata com os dois cartões
       que estão ao lado dele. */
    resultadoLiquido: arredondar(totalRemunerado - totalRealizado),
    veiculosComSobra,
    veiculosComDeficit,
    veiculosEmEquilibrio,
    cobertura: {
      total: linhas.length,
      conciliados,
      semRealizado,
      semRemunerado,
      naoConciliados,
    },
    foraDoConfronto: {
      remuneradoSemRealizado: arredondar(remuneradoSemRealizado),
      realizadoSemRemunerado: arredondar(realizadoSemRemunerado),
      veiculos: semRealizado + semRemunerado + naoConciliados,
    },
  };
}

const arredondar = (v: number): number => Number(v.toFixed(2));

const MOTIVO_DA_SITUACAO: Record<SituacaoDoConsolidado, string | null> = {
  CONSOLIDADO: null,
  DIVERGENCIA_INTRAMENSAL:
    "As vigências deste mês declaram parcelas diferentes para esta placa. " +
    "Não há um valor mensal único para confrontar com o realizado.",
  COBERTURA_PARCIAL:
    "Esta placa está em parte das vigências do mês apenas. O intervalo econômico " +
    "dela não é o mesmo do realizado mensal.",
  SEM_VALOR: "Nenhuma vigência do mês informou a parcela FINAME desta placa.",
};
