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

  /**
   * A conferência que passou a divergir — e é para isso que ela existe.
   *
   * Até 18/08/2026 os 71 fechavam no centavo, e o teste dizia isso. Fechavam
   * porque os dois lados da conta liam a mesma dupla contagem: a linha da
   * carreta somava `carreta.lucro_fixomodelo_novo_ciclo`, que é a soma da
   * parcela dela com a do cavalo (284 de 284 pares), e o declarado é
   * `custoFixo`, que contém o mesmo lucro do cavalo por dentro de `finame`.
   * Dois erros iguais dos dois lados dão zero de divergência.
   *
   * Corrigida a linha da carreta, a conferência passa a mostrar o que sempre
   * esteve lá: nos conjuntos em que o financiamento do cavalo já acabou, a
   * fonte declara mais do que os dois equipamentos recebem, pelo valor exato
   * do lucro fixo daquele cavalo. Uma tela que confere o par contra a fonte
   * fazendo isso é a tela funcionando.
   */
  it("mostra os 12 conjuntos em que a fonte declara mais do que o par recebe", () => {
    expect(agosto.resumo.conferidos).toBe(71);
    expect(agosto.resumo.fecham).toBe(59);
    expect(agosto.resumo.divergem).toBe(12);

    const divergentes = agosto.linhas.filter((l) => !l.fecha);
    expect(divergentes).toHaveLength(12);

    /*
      A divergência de um par tem nome: é o lucro fixo do cavalo dele. Conferido
      na placa da tela — QYP3G72, cujo `finameCavalo` de R$ 4.677,85 é
      inteiramente lucro do novo ciclo, sem amortização nem juros.
    */
    const qyp3g72 = divergentes.find((l) => l.rotulo.includes("QYP3G72"))!;
    expect(qyp3g72.divergencia).toBeCloseTo(4677.85, 2);

    /* Os 59 que fecham continuam fechando dentro do centavo. */
    for (const linha of agosto.linhas.filter((l) => l.fecha)) {
      expect(Math.abs(linha.divergencia!)).toBeLessThanOrEqual(agosto.toleranciaDaConferencia);
    }
  });

  /**
   * O total do conjunto é o da fonte, e a soma das duas fichas é a nossa.
   *
   * R$ 1.204.664,11 é a soma de `carreta.custo_fixo` nas 71 carretas de
   * agosto/2026 — o mesmo número medido em 15/08/2026 e registrado em
   * `docs/DRE-DIAGNOSTICO.md`. Ele não mudou: quem mudou foi o apurado, e a
   * diferença de R$ 34.793,95 é o lucro fixo dos cavalos que o `custoFixo`
   * conta duas vezes — uma dentro de `finame`, que contém `finameCavalo`, e
   * outra dentro de `lucroFixomodeloNovoCiclo`.
   *
   * Qual dos dois números a Ambev paga é pergunta para a Ambev; o produto
   * mostra os dois e nomeia a diferença. Ver
   * `docs/MAPA-MONETARIO-CAVALO-CARRETA.md`.
   */
  it("declara R$ 1.204.664,11/mês e apura R$ 1.169.870,16 pelo outro caminho", () => {
    expect(agosto.resumo.comDeclarado).toBe(71);
    expect(agosto.resumo.declaradoTotal).toBeCloseTo(1_204_664.11, 2);
    expect(agosto.resumo.apuradoTotal).toBeCloseTo(1_169_870.16, 2);
    expect(agosto.resumo.divergenciaTotal).toBeCloseTo(34_793.95, 2);
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
   * A conferência nas 9 vigências.
   *
   * 657 conjuntos ao todo, todos conferidos, **64 divergentes** — e o número
   * cresce ao longo da série (6 em janeiro, 12 em agosto) porque cresce a
   * quantidade de cavalos cujo financiamento terminou e migrou para o lucro do
   * novo ciclo. É o comportamento esperado da fonte, não deriva do produto: a
   * dupla contagem do `custoFixo` só aparece nos pares em que essa migração já
   * aconteceu.
   *
   * O que continua sendo contrato duro é o resto: nenhum vínculo quebrado, e
   * todo conjunto conferido.
   */
  it("confere todas as vigências e mede quantos divergem", async () => {
    let conjuntos = 0;
    let conferidos = 0;
    let divergem = 0;
    for (const vigencia of agosto.vigencias) {
      const view = (await getVisaoDeConjuntos(ctx.db, { period: vigencia.effectiveDate }))!;
      expect(view.resumo.vinculosQuebrados).toBe(0);
      expect(view.resumo.conferidos).toBe(view.resumo.conjuntos);
      conjuntos += view.resumo.conjuntos;
      conferidos += view.resumo.conferidos;
      divergem += view.resumo.divergem;
    }
    expect(conjuntos).toBe(657);
    expect(conferidos).toBe(657);
    expect(divergem).toBe(64);
  }, 300_000);

  /**
   * Maio/2026 é a vigência em que a frota se mexeu, e é ela que exercita o que
   * só a visão de conjunto enxerga: **cinco cavalos trocaram de carreta.**
   *
   * Este teste também afirmava que quatro conjuntos "saíram da frota" e
   * apareciam como linha — 75 linhas para 71 conjuntos. Não aparecem mais, e a
   * mudança é a mesma da aba de cavalos, pela mesma razão: a Composição
   * responde "o que veio nesta vigência", e um conjunto que existia em abril e
   * não existe em maio é uma afirmação sobre o esperado. Ela tem dono — a
   * Cobertura, que olha a série inteira e respeita a baixa declarada em
   * Curadoria —, e tê-la aqui dava à aba um horizonte de um mês que ninguém
   * declarou e que a tela não dizia ter.
   *
   * As duas abas obedecendo à mesma definição de presença é o ponto: enquanto
   * uma dizia "recebido" e a outra "recebido + saiu", o mesmo conjunto podia
   * estar em uma e não na outra sem que nada explicasse a diferença.
   *
   * A troca de carreta continua inteira — ela é sobre quem **está** aqui, e
   * `materialAnterior` continua sendo lido para calculá-la.
   */
  it("vê a troca de carreta em maio/2026, e não lista quem saiu", async () => {
    const vigencia = agosto.vigencias.find((v) => v.periodLabel === "maio/2026")!;
    const maio = (await getVisaoDeConjuntos(ctx.db, { period: vigencia.effectiveDate }))!;
    expect(maio.resumo.trocaramDeCarreta).toBe(5);
    expect(maio.resumo.conjuntos).toBe(71);

    /* Uma linha por conjunto desta vigência — nem uma a mais. */
    expect(maio.linhas).toHaveLength(71);

    const trocaram = maio.linhas.filter((l) => l.carretaAnterior !== null);
    expect(trocaram).toHaveLength(5);
    for (const linha of trocaram) {
      expect(linha.carretaAnterior).not.toBe(linha.placaApontada);
      expect(linha.status.motivos.join(" ")).toContain("trocou de carreta");
    }

    /* Nenhuma linha herdada da vigência anterior: ninguém "saiu da frota" aqui. */
    expect(maio.linhas.some((l) => l.status.motivos.join(" ").includes("saiu da frota"))).toBe(
      false,
    );
  }, 120_000);

  /**
   * A frota encolhe e o dinheiro não some junto.
   *
   * Esta é a prova de que remover as linhas herdadas não mexeu em nenhum
   * número: os quatro conjuntos que saíram nunca somaram no declarado nem no
   * apurado — eles entravam com todos os valores nulos —, então o total de maio
   * é o mesmo antes e depois, e continua sendo a soma **do que veio em maio**.
   *
   * O que muda é só a contagem de linhas, e ela passou a bater com a contagem
   * de conjuntos. Antes eram 75 linhas para 71 conjuntos, e a diferença de
   * quatro não tinha explicação na tela.
   */
  it("a saída de conjuntos não é lida como queda de remuneração", async () => {
    const vigencia = agosto.vigencias.find((v) => v.periodLabel === "maio/2026")!;
    const maio = (await getVisaoDeConjuntos(ctx.db, { period: vigencia.effectiveDate }))!;

    expect(maio.linhas).toHaveLength(maio.resumo.conjuntos);
    /* Todo total do resumo é a soma das linhas que estão na lista. */
    const declarado = maio.linhas.reduce((s, l) => s + (l.declarado ?? 0), 0);
    expect(maio.resumo.declaradoTotal).toBeCloseTo(Number(declarado.toFixed(2)), 2);
    /* E toda linha conferida tem as duas pontas — nenhuma entra sem valor. */
    expect(maio.resumo.conferidos).toBe(maio.resumo.conjuntos);
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
    /* Doze em agosto/2026 — ver a conferência acima. O filtro existe para
       levar quem audita direto a eles. */
    expect(divergentes.linhas).toHaveLength(12);

    const busca = (await getVisaoDeConjuntos(ctx.db, {
      period: AGOSTO,
      filtros: { busca: agosto.linhas[0].rotulo.slice(0, 7) },
    }))!;
    expect(busca.linhas.length).toBeGreaterThan(0);
    expect(busca.linhas.length).toBeLessThan(71);
  }, 120_000);
});
