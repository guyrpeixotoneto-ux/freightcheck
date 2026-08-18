import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarBancoComExportRealPromovido, type TestDb } from "@workspace/ingest/testing";
import { applyConfirmations, runProposalPass, seedTaxonomy } from "@workspace/curation";
import { getVisaoDeConjuntos, type VisaoDeConjuntos } from "../conjunto";
import { getVisaoDeFrota } from "../frota";

/**
 * A aba Conjuntos contra o export real da Freightec.
 *
 * **O que este arquivo protege.** A aba inteira existe para refazer, a cada
 * leitura, a identidade que autoriza somar a frota de cavalos com a de carretas:
 *
 * ```
 * (finameImplemento + lucroFixomodeloNovoCiclo) + finameCavalo = custoFixo
 * ```
 *
 * Ela foi medida uma vez, em 14/08/2026, sobre 558 pares. Aqui ela é conferida
 * nas 9 vigências, conjunto a conjunto — e o que os testes abaixo registram é
 * que **nenhum dos 657 conjuntos da série diverge**. Um refactor que voltasse a
 * somar `custoFixo` na linha da carreta, ou que perdesse o pareamento, quebra
 * neste arquivo antes de chegar à tela.
 *
 * A segunda garantia é de contagem: **cada ativo aparece em exatamente um
 * conjunto.** Sem ela, a soma da coluna contaria carreta duas vezes, que é
 * precisamente o erro de R$ 1,05 milhão/mês que o módulo existe para não
 * cometer.
 */

let ctx: TestDb;
let agosto: VisaoDeConjuntos;

/** A última vigência do export: EMPURRADA_1_8_2026. */
const AGOSTO = "2026-08-01";

beforeAll(async () => {
  ctx = await criarBancoComExportRealPromovido("composition_conjuntos");
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test:proposal");
  await applyConfirmations(ctx.db);
  agosto = (await getVisaoDeConjuntos(ctx.db, { period: AGOSTO }))!;
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("os conjuntos de agosto/2026", () => {
  it("forma 71 conjuntos: 62 cavalos pareados e 9 carretas órfãs", () => {
    expect(agosto.resumo.conjuntos).toBe(71);
    expect(agosto.resumo.pareados).toBe(62);
    expect(agosto.resumo.carretasOrfas).toBe(9);
    expect(agosto.resumo.cavalosSemCarreta).toBe(0);
    expect(agosto.resumo.vinculosQuebrados).toBe(0);
    expect(agosto.periodLabel).toBe("agosto/2026");
    expect(agosto.seriesEntregues).toEqual({ CAVALO: true, CARRETA: true });
  });

  /**
   * A contagem que impede a dupla contagem.
   *
   * 62 cavalos e 71 carretas na vigência; 62 pareados + 9 órfãs = 71 conjuntos.
   * Nenhum entityId aparece em dois deles — se aparecesse, somar a coluna de
   * remuneração desta lista contaria alguém duas vezes.
   */
  it("põe cada ativo em exatamente um conjunto", () => {
    const vistos = new Set<string>();
    let cavalos = 0;
    let carretas = 0;
    for (const linha of agosto.linhas) {
      for (const lado of [linha.cavalo, linha.carreta]) {
        if (!lado) continue;
        expect(vistos.has(lado.entityId)).toBe(false);
        vistos.add(lado.entityId);
        if (lado.entityType === "CAVALO") cavalos += 1;
        else carretas += 1;
      }
    }
    expect(cavalos).toBe(62);
    expect(carretas).toBe(71);
  });

  it("confere os 71 e todos fecham dentro do centavo", () => {
    expect(agosto.resumo.conferidos).toBe(71);
    expect(agosto.resumo.fecham).toBe(71);
    expect(agosto.resumo.divergem).toBe(0);
    for (const linha of agosto.linhas) {
      expect(linha.fecha).toBe(true);
      expect(Math.abs(linha.divergencia!)).toBeLessThanOrEqual(agosto.toleranciaDaConferencia);
    }
  });

  /**
   * O total do conjunto é o da fonte, e a soma das duas fichas é a nossa.
   *
   * R$ 1.204.664,11 é a soma de `carreta.custo_fixo` nas 71 carretas de
   * agosto/2026 — o mesmo número medido em 15/08/2026 e registrado em
   * `docs/DRE-DIAGNOSTICO.md`. Os onze centavos de diferença contra o apurado
   * são arredondamento da planilha, distribuídos em 71 linhas.
   */
  it("declara R$ 1.204.664,11/mês e apura R$ 1.204.664,00 pelo outro caminho", () => {
    expect(agosto.resumo.comDeclarado).toBe(71);
    expect(agosto.resumo.declaradoTotal).toBeCloseTo(1_204_664.11, 2);
    expect(agosto.resumo.apuradoTotal).toBeCloseTo(1_204_664.0, 2);
    expect(agosto.resumo.divergenciaTotal).toBeCloseTo(0.11, 2);
  });

  /**
   * A ponte com as outras duas abas.
   *
   * Este é o teste que amarra a aba nova às que já existiam: o que os conjuntos
   * apuram **é** a frota de cavalos mais a de carretas, sem sobra e sem falta.
   * Uma regra de escopo que mudasse de um lado e não do outro apareceria aqui —
   * e em nenhum outro lugar, porque as três telas leem vigências diferentes do
   * mesmo motor.
   */
  it("apura exatamente a frota de cavalos mais a de carretas", async () => {
    const cavalos = (await getVisaoDeFrota(ctx.db, "CAVALO", { period: AGOSTO }))!;
    const carretas = (await getVisaoDeFrota(ctx.db, "CARRETA", { period: AGOSTO }))!;
    expect(agosto.resumo.apuradoTotal).toBeCloseTo(
      cavalos.resumo.mensalTotal + carretas.resumo.mensalTotal,
      2,
    );
  });

  it("mostra de que componentes cada lado é feito", () => {
    const pareado = agosto.linhas.find((l) => l.natureza === "PAREADO")!;
    expect(pareado.cavalo!.componentes.map((c) => c.code)).toContain("cavalo.finame_cavalo");
    expect(pareado.carreta!.componentes.map((c) => c.code)).toContain(
      "carreta.finame_implemento",
    );
    /* O total declarado nunca é uma leitura solta: sai de `aprovados`, que é o
       que passou pelo portão da semântica. */
    expect(pareado.declaradoCode).toBe("carreta.custo_fixo");
    expect(pareado.fonte).toBe("EMPURRADA_1_8_2026");
  });

  it("acende o farol por movimento, e não pela carreta ser órfã", () => {
    const orfas = agosto.linhas.filter((l) => l.natureza === "CARRETA_ORFA");
    expect(orfas).toHaveLength(9);
    /* Uma carreta que ninguém puxa é o estado normal de 9 das 71 desta base.
       Se ela acendesse alerta, o alerta seria ruído em toda vigência. */
    for (const orfa of orfas) {
      expect(orfa.status.motivos.join(" ")).not.toContain("sem cavalo");
    }
    expect(agosto.resumo.porFarol.INCOMPLETO).toBe(0);
  });
});

describe("a série inteira", () => {
  /**
   * A identidade nas 9 vigências, e não só na medida.
   *
   * 657 conjuntos ao todo. **Nenhum diverge.** Este é o contrato que a aba
   * publica na tela a cada leitura: quando um deles divergir, será porque a
   * fonte mudou de regra — e a tela vai dizer qual conjunto e de quanto.
   */
  it("fecha a conferência em todas as vigências", async () => {
    let conjuntos = 0;
    let conferidos = 0;
    for (const vigencia of agosto.vigencias) {
      const view = (await getVisaoDeConjuntos(ctx.db, { period: vigencia.effectiveDate }))!;
      expect(view.resumo.divergem).toBe(0);
      expect(view.resumo.vinculosQuebrados).toBe(0);
      expect(view.resumo.conferidos).toBe(view.resumo.conjuntos);
      conjuntos += view.resumo.conjuntos;
      conferidos += view.resumo.conferidos;
    }
    expect(conjuntos).toBe(657);
    expect(conferidos).toBe(657);
  }, 300_000);

  /**
   * Maio/2026 é a vigência em que a frota se mexeu, e é ela que exercita o que
   * só a visão de conjunto enxerga: **cinco cavalos trocaram de carreta**, e
   * quatro conjuntos saíram da frota. Nenhuma das duas coisas aparece na ficha
   * do cavalo nem na da carreta, porque nenhuma das duas vê o outro lado.
   */
  it("vê a troca de carreta e a saída de conjunto em maio/2026", async () => {
    const vigencia = agosto.vigencias.find((v) => v.periodLabel === "maio/2026")!;
    const maio = (await getVisaoDeConjuntos(ctx.db, { period: vigencia.effectiveDate }))!;
    expect(maio.resumo.trocaramDeCarreta).toBe(5);
    expect(maio.resumo.conjuntos).toBe(71);
    expect(maio.linhas).toHaveLength(75);

    const trocaram = maio.linhas.filter((l) => l.carretaAnterior !== null);
    expect(trocaram).toHaveLength(5);
    for (const linha of trocaram) {
      expect(linha.carretaAnterior).not.toBe(linha.placaApontada);
      expect(linha.status.motivos.join(" ")).toContain("trocou de carreta");
    }

    const sairam = maio.linhas.filter((l) => !l.presente);
    expect(sairam).toHaveLength(4);
    for (const linha of sairam) {
      expect(linha.status.farol).toBe("INCOMPLETO");
      expect(linha.status.motivos.join(" ")).toContain("saiu da frota");
    }
  }, 120_000);

  it("não inventa variação na primeira vigência da série", async () => {
    const primeira = agosto.vigencias[0];
    const view = (await getVisaoDeConjuntos(ctx.db, { period: primeira.effectiveDate }))!;
    expect(view.anterior).toBeNull();
    expect(view.resumo.variacaoTotal).toBeNull();
    expect(view.linhas.every((l) => l.variacao === null)).toBe(true);
  }, 120_000);
});

describe("os filtros", () => {
  it("recortam a lista sem mexer no resumo da frota", async () => {
    const semPar = (await getVisaoDeConjuntos(ctx.db, {
      period: AGOSTO,
      filtros: { semPar: true },
    }))!;
    expect(semPar.linhas).toHaveLength(9);
    expect(semPar.totalSemFiltro).toBe(71);
    /* O resumo descreve a frota, não o recorte — o total do mês não encolhe
       porque alguém filtrou. */
    expect(semPar.resumo.declaradoTotal).toBeCloseTo(agosto.resumo.declaradoTotal!, 2);

    const divergentes = (await getVisaoDeConjuntos(ctx.db, {
      period: AGOSTO,
      filtros: { comDivergencia: true },
    }))!;
    expect(divergentes.linhas).toHaveLength(0);

    const busca = (await getVisaoDeConjuntos(ctx.db, {
      period: AGOSTO,
      filtros: { busca: agosto.linhas[0].rotulo.slice(0, 7) },
    }))!;
    expect(busca.linhas.length).toBeGreaterThan(0);
    expect(busca.linhas.length).toBeLessThan(71);
  }, 120_000);
});
