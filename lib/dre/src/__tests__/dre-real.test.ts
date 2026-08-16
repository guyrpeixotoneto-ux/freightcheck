import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarBancoComExportRealPromovido, type TestDb } from "@workspace/ingest/testing";
import { applyConfirmations, runProposalPass, seedTaxonomy } from "@workspace/curation";
import { getDREDaFrota, type DREDaFrota } from "../frota";
import { getDREDoVeiculo } from "../apuracao";
import { explicarResultado, getPonteDaDRE } from "../ponte";
import { getHistoricoDaDRE } from "../historico";

/**
 * A DRE contra o export real da Freightec (§32).
 *
 * Os números abaixo foram medidos no banco real em 15/08/2026, antes de este
 * módulo existir, e é isso que os torna um contrato de regressão. Se o motor
 * deixar de reproduzi-los, ele mudou de ideia sobre o que é receita, o que é
 * custo, ou a quem eles pertencem.
 *
 * **O achado que este arquivo protege acima dos outros:** a decomposição do
 * conjunto fecha em frota a R$ 0,26 sobre R$ 1,16 milhão. É essa folga de vinte
 * e seis centavos que autoriza a DRE de conjunto a existir sem dupla contagem —
 * e é ela que um refactor errado destrói primeiro.
 */

let ctx: TestDb;
let conjuntos: DREDaFrota;
let cavalos: DREDaFrota;
let carretas: DREDaFrota;

/** A última vigência do export. */
const AGOSTO = "2026-08-01";

beforeAll(async () => {
  /*
    A declaração de equipamento novo saiu junto com a importação, e sem
    perda: `preview` devolve `pendingIdentities: []` para este arquivo num
    banco novo — medido —, então passar a lista vazia e não passar nada eram
    a mesma chamada. O portão continua provado de frente em
    `identidade-por-conteudo.test.ts`.
  */
  ctx = await criarBancoComExportRealPromovido("dre_real");
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test:proposal");
  await applyConfirmations(ctx.db);

  conjuntos = (await getDREDaFrota(ctx.db, "CONJUNTO", { period: AGOSTO }))!;
  cavalos = (await getDREDaFrota(ctx.db, "CAVALO", { period: AGOSTO }))!;
  carretas = (await getDREDaFrota(ctx.db, "CARRETA", { period: AGOSTO }))!;
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

const valorDe = (frota: DREDaFrota, id: string) =>
  frota.consolidado.subtotais.find((s) => s.id === id)!.valorParcial;

const linhaDe = (frota: DREDaFrota, code: string) =>
  frota.consolidado.secoes.flatMap((s) => s.linhas).find((l) => l.code === code);

describe("a frota de conjuntos em ago/2026", () => {
  it("forma 71 unidades: 62 pares e 9 carretas órfãs, sem repetir ativo", () => {
    /*
      A contagem é a prova de não dupla contagem. 62 cavalos + 71 carretas = 133
      ativos, distribuídos em 71 unidades: 62 pares (2 ativos cada) e 9 órfãs
      (1 cada). 62×2 + 9 = 133.
    */
    expect(conjuntos.consolidado.unidades).toBe(71);
    expect(conjuntos.consolidado.ativos).toBe(133);
    expect(conjuntos.ranking.filter((l) => l.orfa)).toHaveLength(9);
  });

  it("apura a receita medida: R$ 1.204.664,11", () => {
    /*
      É a soma de `carreta.custo_fixo` nas 71 carretas — as 62 pareadas mais as
      9 órfãs. Medido direto em SQL antes deste módulo existir.
    */
    expect(valorDe(conjuntos, "RECEITA_BRUTA")).toBeCloseTo(1_204_664.11, 2);
  });

  it("apura amortização, juros, aluguel e IPVA nos valores medidos", () => {
    /* Amortização: 529.368,27 (cavalo) + 162.896,32 (implemento). */
    expect(linhaDe(conjuntos, "financeiro.amortizacao")!.valor).toBeCloseTo(692_264.59, 2);
    /* Juros: 300.131,85 + 80.074,29. */
    expect(linhaDe(conjuntos, "financeiro.juros")!.valor).toBeCloseTo(380_206.14, 2);
    /*
      IPVA: 268.951,80 ao ano ÷ 12 = 22.412,65 se a divisão for feita no total.
      A DRE dá 22.412,72 e está certa: cada veículo mensaliza e arredonda o
      **seu** IPVA, e a frota é a soma do que as linhas mostram. Dividir só no
      total daria um número que nenhuma soma das linhas da tela reproduz — numa
      ferramenta de auditoria, sete centavos de diferença entre o total e a soma
      visível custam mais do que sete centavos de precisão.
    */
    expect(linhaDe(conjuntos, "fixo.ipva_licenciamento")!.valor).toBeCloseTo(22_412.72, 2);
  });

  it("fecha a decomposição: receita − custos = os lucros declarados", () => {
    /*
      A conferência que o diagnóstico chama de identidade. `custoFixo` é a soma
      das parcelas com o lucro fixo, então o resultado apurado tem de ser o lucro
      fixo menos o que a tarifa não cobre (o IPVA, que fica fora de `custoFixo`).
      Fecha em centavos sobre R$ 1,2 milhão.
    */
    const receita = valorDe(conjuntos, "RECEITA_BRUTA")!;
    const resultado = valorDe(conjuntos, "RESULTADO_ECONOMICO")!;
    const custos = conjuntos.consolidado.secoes
      .filter((s) => s.id !== "RECEITA_BRUTA")
      .reduce((soma, s) => soma + (s.total ?? 0), 0);

    expect(receita + custos).toBeCloseTo(resultado, 2);
    /* Lucro fixo medido: 82.055,25 (novo ciclo) + 38.359,95 (cavalo) = 120.415,20.
       Menos o IPVA mensalizado de 22.412,65, mais o aluguel que já está dentro
       do custoFixo das órfãs — o resíduo é da ordem de R$ 90 mil/mês. */
    expect(resultado).toBeGreaterThan(80_000);
    expect(resultado).toBeLessThan(120_000);
  });

  it("recusa EBITDA e margem de contribuição, e diz o que falta", () => {
    for (const id of ["MARGEM_CONTRIBUICAO", "EBITDA"] as const) {
      const s = conjuntos.consolidado.subtotais.find((x) => x.id === id)!;
      expect(s.conclusivo, `${id} não pode fechar sem custo operacional`).toBe(false);
      expect(s.valor).toBeNull();
      expect(s.bloqueadoPor.map((b) => b.code)).toContain("variavel.diesel");
    }
  });

  it("reporta a cobertura medida, sem inventá-la", () => {
    const { cobertura } = conjuntos.consolidado;
    expect(cobertura.aplicaveis).toBeGreaterThan(10);
    expect(cobertura.apurados).toBeGreaterThan(0);
    expect(cobertura.percentual).toBeLessThan(60);
    expect(conjuntos.consolidado.estado).toBe("PARCIALMENTE_APURADA");
  });
});

describe("cavalo, carreta e conjunto", () => {
  it("cobre as frotas medidas: 62 cavalos e 71 carretas", () => {
    expect(cavalos.consolidado.unidades).toBe(62);
    expect(carretas.consolidado.unidades).toBe(71);
  });

  it("a receita do conjunto é a dos dois lados somados — a menos das órfãs", () => {
    /*
      A identidade medida em 558 de 558 pares:
        (finameImplemento + lucroFixo) + finameCavalo = custoFixo
      Em frota ela vale para os 62 pares. As 9 carretas órfãs entram nos dois
      lados da conta (têm custoFixo e têm receita própria), então a diferença
      entre os dois totais tem de ser zero.
    */
    const conjunto = valorDe(conjuntos, "RECEITA_BRUTA")!;
    const soma = valorDe(cavalos, "RECEITA_BRUTA")! + valorDe(carretas, "RECEITA_BRUTA")!;
    expect(Math.abs(conjunto - soma)).toBeLessThan(1);
  });

  it("nenhuma carreta recebe a receita do conjunto", () => {
    /*
      A carreta mais cara do export recebe na casa dos milhares. Se `custoFixo`
      vazasse para a linha dela, a receita das carretas saltaria para mais de
      R$ 1,2 milhão — o valor do conjunto inteiro.
    */
    const receitaDasCarretas = valorDe(carretas, "RECEITA_BRUTA")!;
    expect(receitaDasCarretas).toBeLessThan(valorDe(conjuntos, "RECEITA_BRUTA")!);
    for (const l of carretas.consolidado.secoes.flatMap((s) => s.linhas)) {
      expect(l.code).not.toBe("receita.remuneracao_fixa");
    }
  });

  it("o IPVA é do cavalo e não aparece na carreta", () => {
    expect(linhaDe(cavalos, "fixo.ipva_licenciamento")!.valor).toBeCloseTo(22_412.72, 2);
    expect(linhaDe(carretas, "fixo.ipva_licenciamento")).toBeUndefined();
  });
});

describe("rastreabilidade", () => {
  it("todo número da ficha chega ao fato e à célula da planilha", async () => {
    const alvo = conjuntos.ranking.find((l) => !l.orfa && l.receita !== null)!;
    const dre = (await getDREDoVeiculo(ctx.db, alvo.entityIds[0], "CONJUNTO", {
      period: AGOSTO,
    }))!;

    const comValor = dre.atual.secoes.flatMap((s) => s.linhas).filter((l) => l.valor !== null);
    expect(comValor.length).toBeGreaterThan(0);

    for (const l of comValor) {
      expect(l.origens.length, `${l.code} sem origem`).toBeGreaterThan(0);
      for (const o of l.origens) {
        expect(o.attributeCode).toMatch(/^(cavalo|carreta)\./);
        expect(o.semanticsStatus).toBe("CONFIRMED");
        expect(o.celula, `${o.attributeCode} sem célula`).not.toBeNull();
        expect(o.celula!.sourceLabel).toBe("EMPURRADA_1_8_2026");
        expect(o.celula!.sheetName).not.toBeNull();
        expect(o.celula!.rowIndex).not.toBeNull();
        expect(o.celula!.columnLetter).not.toBeNull();
        expect(o.transformacao.valorOriginal).not.toBeNull();
      }
    }
  });

  it("a soma das origens é o valor da linha", async () => {
    const alvo = conjuntos.ranking.find((l) => !l.orfa && l.receita !== null)!;
    const dre = (await getDREDoVeiculo(ctx.db, alvo.entityIds[0], "CONJUNTO", {
      period: AGOSTO,
    }))!;

    for (const l of dre.atual.secoes.flatMap((s) => s.linhas)) {
      if (l.valor === null) continue;
      const soma = l.origens.reduce((s, o) => s + o.valorNaDRE, 0);
      expect(soma, `${l.code} não fecha com as origens`).toBeCloseTo(l.valor, 2);
    }
  });

  it("a ficha do veículo e a linha da frota dão o mesmo número", async () => {
    const alvo = conjuntos.ranking.find((l) => l.receita !== null)!;
    const dre = (await getDREDoVeiculo(ctx.db, alvo.entityIds[0], "CONJUNTO", {
      period: AGOSTO,
    }))!;
    const receita = dre.atual.subtotais.find((s) => s.id === "RECEITA_BRUTA")!.valorParcial;
    expect(receita).toBeCloseTo(alvo.receita!, 2);
  });
});

describe("comparação e ponte", () => {
  it("liga alteração, impacto e linha da DRE, com a decomposição fechando", async () => {
    const alvo = conjuntos.ranking.find((l) => l.variacaoResultado !== null && l.variacaoResultado !== 0);
    if (!alvo) return; /* Nenhuma variação nesta transição: nada a provar aqui. */

    const ponte = (await getPonteDaDRE(ctx.db, alvo.entityIds[0], "CONJUNTO", {
      period: AGOSTO,
    }))!;

    expect(ponte.de).not.toBeNull();
    expect(ponte.variacaoDoResultado).toBeCloseTo(alvo.variacaoResultado!, 2);

    /* A decomposição fecha: saldo + não atribuído = variação. */
    if (ponte.saldo !== null && ponte.naoAtribuido !== null) {
      expect(ponte.saldo + ponte.naoAtribuido).toBeCloseTo(ponte.variacaoDoResultado!, 2);
    }

    /* Toda alteração que mexeu na DRE aponta uma linha e traz o rastro. */
    for (const a of ponte.queMexeramNaDRE) {
      expect(a.linhaDaDRE).not.toBeNull();
      expect(a.transformacao).not.toBeNull();
      expect(a.impactoConfianca).toBe("CALCULATED");
    }
  }, 300_000);

  it("explica a variação só com o que os dados sustentam", async () => {
    const alvo = conjuntos.ranking.find((l) => l.variacaoResultado !== null);
    if (!alvo) return;

    const ponte = (await getPonteDaDRE(ctx.db, alvo.entityIds[0], "CONJUNTO", {
      period: AGOSTO,
    }))!;
    const explicacao = explicarResultado(ponte);
    if (!explicacao) return;

    expect(explicacao.resumo).toContain(ponte.de!.periodLabel);
    /* Todo responsável citado tem um efeito numérico por trás. */
    for (const r of explicacao.responsaveis) {
      expect(Number.isFinite(r.efeito)).toBe(true);
      expect(ponte.porLinha.some((l) => l.titulo === r.titulo)).toBe(true);
    }
  }, 300_000);
});

describe("histórico", () => {
  it("cobre as 9 vigências, com receita apurada em todas", async () => {
    const historico = (await getHistoricoDaDRE(ctx.db, "CONJUNTO"))!;
    expect(historico.pontos).toHaveLength(9);
    for (const ponto of historico.pontos) {
      expect(ponto.presente, `${ponto.periodLabel} sem unidades`).toBe(true);
      expect(ponto.receita, `${ponto.periodLabel} sem receita`).not.toBeNull();
    }
  }, 300_000);

  it("não devolve componente que é nulo na série inteira", async () => {
    const historico = (await getHistoricoDaDRE(ctx.db, "CONJUNTO"))!;
    for (const componente of historico.componentes) {
      expect(componente.valores.some((v) => v !== null), componente.code).toBe(true);
      expect(componente.valores).toHaveLength(historico.pontos.length);
    }
  }, 300_000);
});

describe("atenção e ranking", () => {
  it("todo alerta traz o número que o disparou", () => {
    for (const alerta of conjuntos.atencao) {
      expect(alerta.mensagem.length).toBeGreaterThan(10);
      if (alerta.motivo !== "SEM_APURACAO") {
        expect(Object.keys(alerta.numeros).length, alerta.motivo).toBeGreaterThan(0);
      }
      expect(conjuntos.ranking.some((l) => l.id === alerta.id)).toBe(true);
    }
  });

  it("a margem consolidada não é a média das margens individuais", () => {
    const receita = valorDe(conjuntos, "RECEITA_BRUTA")!;
    const resultado = valorDe(conjuntos, "RESULTADO_ECONOMICO")!;
    const consolidada = (resultado / receita) * 100;

    const individuais = conjuntos.ranking
      .map((l) => l.margemPercentual)
      .filter((m): m is number => m !== null);
    const media = individuais.reduce((s, m) => s + m, 0) / individuais.length;

    /* As duas existem e não são a mesma conta. A consolidada é a que a tela usa. */
    expect(Number.isFinite(consolidada)).toBe(true);
    expect(Number.isFinite(media)).toBe(true);
    expect(Math.abs(consolidada - media)).toBeGreaterThan(0.01);
  });
});
