import { describe, expect, it } from "vitest";
import {
  criarDeduplicador,
  indexarVinculos,
  resumirImpacto,
  SEM_VINCULOS,
  type LinhaDeMudanca,
} from "../deduplicacao";

/**
 * Cobertura sem representação é dinheiro sumido — o furo P1 da auditoria.
 *
 * A regra "o total sai quando a parcela mudou" decidia por um índice de forma
 * (mudou?) e não de dinheiro (contou?). Um total calculável (+R$ 100) com uma
 * parcela APPEARED — sem delta, sem impacto apurável — saía da soma "coberto
 * pela parcela", e a parcela não punha nada no lugar: o oficial dizia R$ 0 com
 * o rastro afirmando que o dinheiro estava contado numa linha que não contava
 * nada. Sempre para baixo, sempre sem alarme.
 *
 * O caso não ocorre no export real de ago/2026 (a partição 6+6+7 fecha), mas
 * nada impedia uma vigência futura de produzi-lo. Estas provas o produzem.
 */

const total = (impacto: Partial<LinhaDeMudanca> = {}): LinhaDeMudanca => ({
  attributeCode: "carreta.custo_fixo",
  entityId: "carreta-1",
  comparacaoId: "cmp-1",
  impactConfidence: "CALCULATED",
  impactAmount: "100.00",
  impactPeriodicity: "MENSAL",
  ...impacto,
});

const parcela = (impacto: Partial<LinhaDeMudanca> = {}): LinhaDeMudanca => ({
  attributeCode: "carreta.finame",
  entityId: "carreta-1",
  comparacaoId: "cmp-1",
  ...impacto,
});

describe("total calculável com parcela sem preço", () => {
  it("o total CONTA quando a parcela mudou sem impacto apurável (APPEARED)", () => {
    const linhas = [
      total(),
      // A parcela apareceu: null → valor. INCONCLUSIVE, sem delta, sem preço.
      parcela({ impactConfidence: "NOT_CALCULABLE", impactAmount: null, impactPeriodicity: null }),
    ];
    const resumo = resumirImpacto(linhas, criarDeduplicador(linhas, SEM_VINCULOS));

    expect(resumo.byPeriodicity).toEqual({ MENSAL: 100 });
    expect(resumo.excludedChanges).toBe(0);
    expect(resumo.notCalculable).toBe(1);
  });

  it("o total SAI quando a parcela contou — o comportamento certo continua o mesmo", () => {
    const linhas = [
      total(),
      parcela({
        impactConfidence: "CALCULATED",
        impactAmount: "100.00",
        impactPeriodicity: "MENSAL",
      }),
    ];
    const resumo = resumirImpacto(linhas, criarDeduplicador(linhas, SEM_VINCULOS));

    // A parcela representa o dinheiro; o total sai e o rastro explica.
    expect(resumo.byPeriodicity).toEqual({ MENSAL: 100 });
    expect(resumo.excludedChanges).toBe(1);
    expect(resumo.rastro.degraus[0].removidoByPeriodicity).toEqual({ MENSAL: 100 });
  });

  it("a cobertura é por ativo: parcela sem preço num veículo não descobre o outro", () => {
    const linhas = [
      total({ entityId: "carreta-1" }),
      parcela({
        entityId: "carreta-1",
        impactConfidence: "CALCULATED",
        impactAmount: "100.00",
        impactPeriodicity: "MENSAL",
      }),
      total({ entityId: "carreta-2" }),
      parcela({ entityId: "carreta-2", impactConfidence: "NOT_CALCULABLE", impactAmount: null }),
    ];
    const resumo = resumirImpacto(linhas, criarDeduplicador(linhas, SEM_VINCULOS));

    // carreta-1: total coberto (parcela contou). carreta-2: total conta.
    expect(resumo.byPeriodicity).toEqual({ MENSAL: 200 });
    expect(resumo.excludedChanges).toBe(1);
  });
});

describe("conjunto com coluna embutida sem preço", () => {
  // Código REAL de escopo de conjunto: carreta.finame embute cavalo.finame_cavalo
  // (ver ESCOPOS_DE_CONJUNTO). Um código inventado faria a regra nunca disparar
  // e este arquivo passar sem provar nada.
  const colunaDeConjunto = (impacto: Partial<LinhaDeMudanca> = {}): LinhaDeMudanca => ({
    attributeCode: "carreta.finame",
    entityId: "carreta-1",
    comparacaoId: "cmp-1",
    impactConfidence: "CALCULATED",
    impactAmount: "50.00",
    impactPeriodicity: "MENSAL",
    ...impacto,
  });

  const embutido = (impacto: Partial<LinhaDeMudanca> = {}): LinhaDeMudanca => ({
    attributeCode: "cavalo.finame_cavalo",
    entityId: "cavalo-9",
    comparacaoId: "cmp-1",
    ...impacto,
  });

  const vinculos = indexarVinculos([{ entityId: "carreta-1", embuteEntityId: "cavalo-9" }]);

  it("a coluna de conjunto CONTA quando o embutido mudou sem preço", () => {
    const linhas = [
      colunaDeConjunto(),
      embutido({ impactConfidence: "NOT_CALCULABLE", impactAmount: null, impactPeriodicity: null }),
    ];
    const resumo = resumirImpacto(linhas, criarDeduplicador(linhas, vinculos));

    // O embutido não contou nada: tirar a coluna de conjunto da soma seria
    // sumir com R$ 50 que nenhuma outra linha representa.
    expect(resumo.byPeriodicity).toEqual({ MENSAL: 50 });
    expect(resumo.excludedChanges).toBe(0);
  });

  it("a coluna de conjunto SAI quando o embutido contou — o certo continua o mesmo", () => {
    const linhas = [
      colunaDeConjunto(),
      embutido({
        impactConfidence: "CALCULATED",
        impactAmount: "30.00",
        impactPeriodicity: "MENSAL",
      }),
    ];
    const resumo = resumirImpacto(linhas, criarDeduplicador(linhas, vinculos));

    expect(resumo.byPeriodicity).toEqual({ MENSAL: 30 });
    expect(resumo.excludedChanges).toBe(1);
  });
});
