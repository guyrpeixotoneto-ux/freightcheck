import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import {
  atributosDisponiveis,
  classificarValor,
  contextosDisponiveis,
  equipamentosDisponiveis,
  estadoDoValor,
  serieDe,
  seriesDisponiveis,
  verificarDisponibilidade,
  vigenciaAnterior,
  vigenciasDisponiveis,
} from "../index";
import {
  COLUNAS_DE_CARRETA,
  COLUNAS_DE_CAVALO,
  carretas,
  importarEPromover,
  importarSemPromover,
} from "./fixtures";

/**
 * A autoridade de disponibilidade, contra os quinze casos que o export real não
 * tem.
 *
 * Um banco por cenário, e não um banco com tudo dentro. É mais lento e é a
 * única forma de cada prova afirmar sobre um mundo que ela controla: com um
 * banco compartilhado, "não há vigência nenhuma" deixaria de ser testável no
 * segundo teste, e é justamente ele o único caso em que "não há dados" é
 * verdade.
 */

async function comBanco(nome: string, prova: (ctx: TestDb) => Promise<void>) {
  const ctx = await createTestDatabase(`disp_${nome}`);
  try {
    await prova(ctx);
  } finally {
    await ctx.drop().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// A fonte de verdade: promoção, e nada antes dela
// ---------------------------------------------------------------------------

describe("a fonte de verdade é a vigência promovida", () => {
  it("11 · o que está em raw/staging e não foi promovido não existe", async () => {
    await comBanco("staging", async (ctx) => {
      await importarSemPromover(ctx.db, carretas("EMPURRADA_1_1_2026", ["AAA1A11"]));

      // O arquivo foi lido: raw e staging estão cheios, e o run foi conferido.
      const { rows } = await ctx.db.execute<{ raw: number; staged: number; estado: string }>(sql`
        SELECT (SELECT count(*)::int FROM raw_cell)    AS raw,
               (SELECT count(*)::int FROM staged_fact) AS staged,
               (SELECT status::text FROM import_run LIMIT 1) AS estado`);
      expect(Number(rows[0].raw)).toBeGreaterThan(0);
      expect(Number(rows[0].staged)).toBeGreaterThan(0);
      expect(rows[0].estado).toBe("PREVIEWED");

      // E mesmo assim não há disponibilidade nenhuma.
      expect(await vigenciasDisponiveis(ctx.db)).toEqual([]);
      expect(await contextosDisponiveis(ctx.db)).toEqual([]);
      expect((await verificarDisponibilidade(ctx.db)).estado).toBe("VAZIO_GLOBAL");
    });
  });

  it("12 · depois do promote, passa a existir", async () => {
    await comBanco("promote", async (ctx) => {
      expect((await verificarDisponibilidade(ctx.db)).estado).toBe("VAZIO_GLOBAL");

      await importarEPromover(ctx.db, carretas("EMPURRADA_1_1_2026", ["AAA1A11"]));

      const vigencias = await vigenciasDisponiveis(ctx.db);
      expect(vigencias).toHaveLength(1);
      expect(vigencias[0].effectiveDate).toBe("2026-01-01");
      expect(vigencias[0].fatos).toBeGreaterThan(0);
      expect((await verificarDisponibilidade(ctx.db)).estado).toBe("DISPONIVEL");
    });
  });

  it("uma revisão substituída sai de cena, e a que a substituiu fica", async () => {
    await comBanco("revisao", async (ctx) => {
      await importarEPromover(ctx.db, carretas("EMPURRADA_1_1_2026", ["AAA1A11"]));
      await importarEPromover(ctx.db, carretas("EMPURRADA_1_1_2026", ["AAA1A11", "AAA2A22"]));

      const vigencias = await vigenciasDisponiveis(ctx.db);
      expect(vigencias).toHaveLength(1);
      expect(vigencias[0].revision).toBe(2);

      // A anterior continua no banco — ela é história, não disponibilidade.
      const { rows } = await ctx.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM snapshot WHERE status = 'SUPERSEDED'`,
      );
      expect(Number(rows[0].n)).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// A série
// ---------------------------------------------------------------------------

describe("a série e a vigência anterior", () => {
  it("1 · série contínua: cada vigência tem a de antes", async () => {
    await comBanco("continua", async (ctx) => {
      for (const mes of [1, 2, 3]) {
        await importarEPromover(ctx.db, carretas(`EMPURRADA_1_${mes}_2026`, ["AAA1A11"]));
      }
      const vigencias = await vigenciasDisponiveis(ctx.db);
      expect(vigencias.map((v) => v.effectiveDate)).toEqual([
        "2026-01-01",
        "2026-02-01",
        "2026-03-01",
      ]);

      const anterior = await vigenciaAnterior(ctx.db, vigencias[2].snapshotId);
      expect(anterior.encontrada).toBe(true);
      if (!anterior.encontrada) return;
      expect(anterior.vigencia.effectiveDate).toBe("2026-02-01");
    });
  });

  it("2 · série com lacuna: a anterior é a última entregue, não a do mês passado", async () => {
    await comBanco("lacuna", async (ctx) => {
      // Janeiro e abril. Fevereiro e março não existem, e isso não é buraco a
      // ser preenchido: é a série tendo três meses de intervalo.
      for (const mes of [1, 4]) {
        await importarEPromover(ctx.db, carretas(`EMPURRADA_1_${mes}_2026`, ["AAA1A11"]));
      }
      const vigencias = await vigenciasDisponiveis(ctx.db);
      const anterior = await vigenciaAnterior(ctx.db, vigencias[1].snapshotId);
      expect(anterior.encontrada).toBe(true);
      if (!anterior.encontrada) return;
      expect(anterior.vigencia.effectiveDate).toBe("2026-01-01");

      // E a série declara o buraco em vez de escondê-lo.
      const [serie] = await seriesDisponiveis(ctx.db);
      expect(serie.periodos).toEqual(["2026-01-01", "2026-04-01"]);
    });
  });

  it("3 · a primeira da série não tem anterior — e a resposta diz isso", async () => {
    await comBanco("primeira", async (ctx) => {
      await importarEPromover(ctx.db, carretas("EMPURRADA_1_1_2026", ["AAA1A11"]));
      const [vigencia] = await vigenciasDisponiveis(ctx.db);

      const anterior = await vigenciaAnterior(ctx.db, vigencia.snapshotId);
      expect(anterior.encontrada).toBe(false);
      if (anterior.encontrada) return;
      // `null` mudo é o que fez "é a primeira" e "a série se partiu" virarem a
      // mesma frase na tela.
      expect(anterior.motivo).toBe("PRIMEIRA_DA_SERIE");
      expect(anterior.frase).toContain("primeira vigência da série");
    });
  });

  it("a guarda de cobertura de equipamento é opção, e diz por que recusou", async () => {
    await comBanco("guarda_cobertura", async (ctx) => {
      // Janeiro só carretas; fevereiro carretas e cavalos.
      await importarEPromover(ctx.db, carretas("EMPURRADA_1_1_2026", ["AAA1A11"]));
      await importarEPromover(ctx.db, {
        vigencia: "EMPURRADA_1_2_2026",
        abas: [
          { nome: "carretas", placas: ["AAA1A11"], colunas: COLUNAS_DE_CARRETA },
          { nome: "cavalos", placas: ["BBB1B11"], colunas: COLUNAS_DE_CAVALO },
        ],
      });
      const vigencias = await vigenciasDisponiveis(ctx.db);
      const fevereiro = vigencias[1];

      // A definição correta encontra a anterior: a série é (escopo, canal), e a
      // cobertura de equipamento é atributo da entrega.
      const semGuarda = await vigenciaAnterior(ctx.db, fevereiro.snapshotId);
      expect(semGuarda.encontrada).toBe(true);
      if (semGuarda.encontrada) {
        expect(semGuarda.vigencia.effectiveDate).toBe("2026-01-01");
      }

      /*
        Com a guarda — o que o produto ainda aplica, até o PR-9 — a resposta é
        recusa. O que muda desde já é a **frase**: ela diz que existe uma
        anterior e que a cobertura é outra, em vez de afirmar que esta é a
        primeira da série. A afirmação antiga era falsa, e era o que a tela
        mostrava.
      */
      const comGuarda = await vigenciaAnterior(ctx.db, fevereiro.snapshotId, {
        exigirMesmoEntityTypeSet: true,
      });
      expect(comGuarda.encontrada).toBe(false);
      if (comGuarda.encontrada) return;
      expect(comGuarda.motivo).toBe("COBERTURA_DE_EQUIPAMENTO_DIFERENTE");
      expect(comGuarda.frase).toContain("EMPURRADA_1_1_2026");
      expect(comGuarda.motivo).not.toBe("PRIMEIRA_DA_SERIE");
    });
  });

  it("com a guarda ligada, a primeira da série continua sendo a primeira", async () => {
    // A guarda não pode transformar todo caso em "cobertura diferente": quando
    // não há anterior nenhuma, o motivo continua sendo o certo.
    await comBanco("guarda_primeira", async (ctx) => {
      await importarEPromover(ctx.db, carretas("EMPURRADA_1_1_2026", ["AAA1A11"]));
      const [vigencia] = await vigenciasDisponiveis(ctx.db);
      const anterior = await vigenciaAnterior(ctx.db, vigencia.snapshotId, {
        exigirMesmoEntityTypeSet: true,
      });
      expect(anterior.encontrada).toBe(false);
      if (anterior.encontrada) return;
      expect(anterior.motivo).toBe("PRIMEIRA_DA_SERIE");
    });
  });

  it("com a guarda ligada, a busca pula a entrega de outra cobertura em vez de parar nela", async () => {
    /*
      Jan CARRETA, Fev CARRETA+CAVALO, Mar CARRETA.

      A anterior de março, sob a guarda, é **janeiro** — e não "nenhuma". Filtrar
      em memória o que a consulta trouxe daria o resultado errado: o `LIMIT 1`
      teria devolvido fevereiro e o filtro o descartaria, encerrando a busca. É a
      diferença entre pular a que não serve e desistir na primeira que não serve.
    */
    await comBanco("guarda_pula", async (ctx) => {
      await importarEPromover(ctx.db, carretas("EMPURRADA_1_1_2026", ["AAA1A11"]));
      await importarEPromover(ctx.db, {
        vigencia: "EMPURRADA_1_2_2026",
        abas: [
          { nome: "carretas", placas: ["AAA1A11"], colunas: COLUNAS_DE_CARRETA },
          { nome: "cavalos", placas: ["BBB1B11"], colunas: COLUNAS_DE_CAVALO },
        ],
      });
      await importarEPromover(ctx.db, carretas("EMPURRADA_1_3_2026", ["AAA1A11"]));

      const vigencias = await vigenciasDisponiveis(ctx.db);
      const marco = vigencias[2];
      const anterior = await vigenciaAnterior(ctx.db, marco.snapshotId, {
        exigirMesmoEntityTypeSet: true,
      });
      expect(anterior.encontrada).toBe(true);
      if (!anterior.encontrada) return;
      expect(anterior.vigencia.effectiveDate).toBe("2026-01-01");
    });
  });

  it("uma vigência que não existe é distinguida da primeira da série", async () => {
    await comBanco("desconhecida", async (ctx) => {
      await importarEPromover(ctx.db, carretas("EMPURRADA_1_1_2026", ["AAA1A11"]));
      const anterior = await vigenciaAnterior(
        ctx.db,
        "00000000-0000-0000-0000-000000000000",
      );
      expect(anterior.encontrada).toBe(false);
      if (anterior.encontrada) return;
      expect(anterior.motivo).toBe("VIGENCIA_DESCONHECIDA");
    });
  });

  it("7 · equipamento que entra e sai não parte a série", async () => {
    await comBanco("equipamento", async (ctx) => {
      // Janeiro só carretas; fevereiro carretas e cavalos; março só carretas.
      await importarEPromover(ctx.db, carretas("EMPURRADA_1_1_2026", ["AAA1A11"]));
      await importarEPromover(ctx.db, {
        vigencia: "EMPURRADA_1_2_2026",
        abas: [
          { nome: "carretas", placas: ["AAA1A11"], colunas: COLUNAS_DE_CARRETA },
          { nome: "cavalos", placas: ["BBB1B11"], colunas: COLUNAS_DE_CAVALO },
        ],
      });
      await importarEPromover(ctx.db, carretas("EMPURRADA_1_3_2026", ["AAA1A11"]));

      const vigencias = await vigenciasDisponiveis(ctx.db);
      expect(vigencias).toHaveLength(3);

      /*
        A prova central desta suíte, e a diferença para o que o produto faz hoje:
        as três vigências são da **mesma** série, ainda que a cobertura de
        equipamento mude entre elas. `entity_type_set` é rótulo, e é ele na
        identidade da série que faz Alterações responder "não há anterior" para
        uma vigência que tem anterior no banco (D3 da auditoria).
      */
      expect(new Set(vigencias.map((v) => v.serie)).size).toBe(1);
      for (const v of vigencias.slice(1)) {
        const anterior = await vigenciaAnterior(ctx.db, v.snapshotId);
        expect(anterior.encontrada, `${v.effectiveDate} ficou sem anterior`).toBe(true);
      }

      // E o equipamento entregue por vigência continua visível, um a um.
      expect(vigencias.map((v) => v.equipamentos.map((e) => e.entityType).sort())).toEqual([
        ["CARRETA"],
        ["CARRETA", "CAVALO"],
        ["CARRETA"],
      ]);
      expect(
        (await equipamentosDisponiveis(ctx.db)).map((e) => [e.entityType, e.vigencias]),
      ).toEqual([
        ["CARRETA", 3],
        ["CAVALO", 1],
      ]);
    });
  });
});

// ---------------------------------------------------------------------------
// O recorte
// ---------------------------------------------------------------------------

describe("existir globalmente não é existir no recorte", () => {
  it("4 · a data existe no sistema e não existe naquela unidade", async () => {
    await comBanco("recorte", async (ctx) => {
      // Duas unidades. A segunda só entrega em fevereiro.
      await importarEPromover(ctx.db, carretas("EMPURRADA_1_1_2026", ["AAA1A11"]));
      await importarEPromover(ctx.db, carretas("EMPURRADA_1_2_2026", ["AAA1A11"]));
      await importarEPromover(ctx.db, {
        ...carretas("EMPURRADA_1_2_2026", ["CCC1C11"], "11.222.333/0001-44"),
        unidade: "JUIZ DE FORA",
      });

      const contextos = await contextosDisponiveis(ctx.db);
      expect(contextos).toHaveLength(2);

      const jf = contextos.find((c) => c.rotulo.startsWith("JUIZ"))!;
      expect(jf.periodos).toBe(1);

      /*
        O veredito é o coração desta autoridade. Perguntar por janeiro em Juiz de
        Fora devolve vazio — e a resposta **não** é "não há dados": é "não aqui,
        e o dado está ali". Um módulo que escrevesse "nenhum dado importado"
        estaria mentindo, e agora ele tem como saber disso.
      */
      const veredito = await verificarDisponibilidade(ctx.db, {
        contexto: jf.chave,
        antesDe: "2026-02-01",
      });
      expect(veredito.estado).toBe("VAZIO_NO_RECORTE");
      if (veredito.estado !== "VAZIO_NO_RECORTE") return;
      expect(veredito.existemEm.length).toBeGreaterThan(0);
      expect(veredito.motivo).toContain("CAMACARI");
    });
  });

  it("14 · os contextos não se contaminam", async () => {
    await comBanco("isolamento", async (ctx) => {
      await importarEPromover(ctx.db, carretas("EMPURRADA_1_1_2026", ["AAA1A11", "AAA2A22"]));
      await importarEPromover(ctx.db, {
        ...carretas("EMPURRADA_1_1_2026", ["CCC1C11"], "11.222.333/0001-44"),
        unidade: "JUIZ DE FORA",
      });

      const contextos = await contextosDisponiveis(ctx.db);
      expect(contextos).toHaveLength(2);

      for (const contexto of contextos) {
        const doContexto = await vigenciasDisponiveis(ctx.db, { contexto: contexto.chave });
        expect(doContexto).toHaveLength(1);
        expect(doContexto[0].contexto).toBe(contexto.chave);
      }

      // As duas unidades entregaram a mesma data e continuam sendo duas.
      const camacari = contextos.find((c) => c.rotulo.startsWith("CAMACARI"))!;
      const jf = contextos.find((c) => c.rotulo.startsWith("JUIZ"))!;
      expect(camacari.chave).not.toBe(jf.chave);
      const [vc] = await vigenciasDisponiveis(ctx.db, { contexto: camacari.chave });
      expect(vc.entidades).toBe(2);
    });
  });

  it("5 · um contexto que aparece no meio da série é visto a partir dali", async () => {
    await comBanco("contexto_novo", async (ctx) => {
      await importarEPromover(ctx.db, carretas("EMPURRADA_1_1_2026", ["AAA1A11"]));
      await importarEPromover(ctx.db, carretas("EMPURRADA_1_2_2026", ["AAA1A11"]));
      await importarEPromover(ctx.db, {
        ...carretas("EMPURRADA_1_2_2026", ["CCC1C11"], "11.222.333/0001-44"),
        unidade: "JUIZ DE FORA",
      });
      await importarEPromover(ctx.db, carretas("EMPURRADA_1_3_2026", ["AAA1A11"]));
      await importarEPromover(ctx.db, {
        ...carretas("EMPURRADA_1_3_2026", ["CCC1C11"], "11.222.333/0001-44"),
        unidade: "JUIZ DE FORA",
      });

      const jf = (await contextosDisponiveis(ctx.db)).find((c) =>
        c.rotulo.startsWith("JUIZ"),
      )!;
      expect(jf.primeiraVigencia).toBe("2026-02-01");
      expect(jf.ultimaVigencia).toBe("2026-03-01");
      expect(jf.periodos).toBe(2);

      // A primeira dele não tem anterior, mesmo com janeiro existindo no sistema.
      const [primeira] = await vigenciasDisponiveis(ctx.db, { contexto: jf.chave });
      const anterior = await vigenciaAnterior(ctx.db, primeira.snapshotId);
      expect(anterior.encontrada).toBe(false);
      if (anterior.encontrada) return;
      expect(anterior.motivo).toBe("PRIMEIRA_DA_SERIE");
    });
  });

  it("6 · um contexto que some da série continua existindo até onde entregou", async () => {
    await comBanco("contexto_some", async (ctx) => {
      for (const mes of [1, 2]) {
        await importarEPromover(ctx.db, carretas(`EMPURRADA_1_${mes}_2026`, ["AAA1A11"]));
        await importarEPromover(ctx.db, {
          ...carretas(`EMPURRADA_1_${mes}_2026`, ["CCC1C11"], "11.222.333/0001-44"),
          unidade: "JUIZ DE FORA",
        });
      }
      // Março só de Camaçari.
      await importarEPromover(ctx.db, carretas("EMPURRADA_1_3_2026", ["AAA1A11"]));

      const jf = (await contextosDisponiveis(ctx.db)).find((c) =>
        c.rotulo.startsWith("JUIZ"),
      )!;
      expect(jf.ultimaVigencia).toBe("2026-02-01");

      // Perguntar por março em Juiz de Fora é vazio no recorte, não vazio.
      const veredito = await verificarDisponibilidade(ctx.db, { contexto: jf.chave });
      expect(veredito.estado).toBe("DISPONIVEL");
      if (veredito.estado !== "DISPONIVEL") return;
      expect(veredito.vigencias.map((v) => v.effectiveDate)).toEqual([
        "2026-01-01",
        "2026-02-01",
      ]);
    });
  });
});

// ---------------------------------------------------------------------------
// O valor: inexistente, não aplicável, nulo, zero
// ---------------------------------------------------------------------------

describe("ausência, nulo e zero são três coisas", () => {
  it("a classificação pura separa os cinco estados", () => {
    const base = { atributoDoEquipamento: true, colunaNoLayout: true };
    expect(
      classificarValor({ ...base, fato: { isNull: false, nullReason: null, valueNumeric: "12.5" } })
        .estado,
    ).toBe("VALOR");
    // Zero é valor: o ativo custa zero. Somá-lo está certo; tratá-lo como
    // ausência baixaria a média da frota inteira sem deixar rastro.
    expect(
      classificarValor({ ...base, fato: { isNull: false, nullReason: null, valueNumeric: "0" } })
        .estado,
    ).toBe("ZERO");
    expect(
      classificarValor({ ...base, fato: { isNull: true, nullReason: "EMPTY", valueNumeric: null } })
        .estado,
    ).toBe("NULO");
    expect(classificarValor({ ...base, fato: null }).estado).toBe("INEXISTENTE");
    expect(
      classificarValor({ ...base, colunaNoLayout: false, fato: null }).estado,
    ).toBe("NAO_ENTREGUE");
    expect(
      classificarValor({ ...base, atributoDoEquipamento: false, fato: null }).estado,
    ).toBe("NAO_APLICAVEL");
  });

  it("nenhum estado de ausência devolve zero como valor", () => {
    // A regra que o produto existe para não quebrar: ausência não é zero.
    for (const entrada of [
      { atributoDoEquipamento: false, colunaNoLayout: true, fato: null },
      { atributoDoEquipamento: true, colunaNoLayout: false, fato: null },
      { atributoDoEquipamento: true, colunaNoLayout: true, fato: null },
      {
        atributoDoEquipamento: true,
        colunaNoLayout: true,
        fato: { isNull: true, nullReason: "EMPTY", valueNumeric: null },
      },
    ]) {
      expect(classificarValor(entrada).valor).toBeNull();
    }
  });

  it("8 e 9 · a vigência é válida com zero e com nulo, e a célula sabe a diferença", async () => {
    await comBanco("valores", async (ctx) => {
      await importarEPromover(ctx.db, {
        vigencia: "EMPURRADA_1_1_2026",
        abas: [
          {
            nome: "carretas",
            placas: ["AAA1A11"],
            colunas: COLUNAS_DE_CARRETA,
            // Coluna 0 zero, coluna 1 vazia, o resto com valor.
            valores: (i) => (i === 0 ? 0 : i === 1 ? null : 100 + i),
          },
        ],
      });

      const [vigencia] = await vigenciasDisponiveis(ctx.db);
      // A vigência é válida: nem o zero nem o vazio a tiram do censo.
      expect(vigencia.fatos).toBeGreaterThan(0);
      const carreta = vigencia.equipamentos.find((e) => e.entityType === "CARRETA")!;
      expect(carreta.comValor).toBeGreaterThan(0);
      expect(carreta.vazios).toBeGreaterThan(0);

      const { rows } = await ctx.db.execute<{ entity_id: string }>(
        sql`SELECT id::text AS entity_id FROM entity LIMIT 1`,
      );
      const entityId = rows[0].entity_id;

      const zero = await estadoDoValor(
        ctx.db,
        vigencia.snapshotId,
        entityId,
        "carreta.custo_carreta_0",
      );
      expect(zero.estado).toBe("ZERO");
      expect(zero.valor).toBe(0);

      const nulo = await estadoDoValor(
        ctx.db,
        vigencia.snapshotId,
        entityId,
        "carreta.custo_carreta_1",
      );
      expect(nulo.estado).toBe("NULO");
      expect(nulo.valor).toBeNull();
      expect(nulo.motivo).toBeTruthy();

      const valor = await estadoDoValor(
        ctx.db,
        vigencia.snapshotId,
        entityId,
        "carreta.custo_carreta_2",
      );
      expect(valor.estado).toBe("VALOR");
      expect(valor.valor).toBe(102);
    });
  });

  it("um atributo de outro equipamento é `NAO_APLICAVEL`, e não ausência", async () => {
    await comBanco("nao_aplicavel", async (ctx) => {
      await importarEPromover(ctx.db, {
        vigencia: "EMPURRADA_1_1_2026",
        abas: [
          { nome: "carretas", placas: ["AAA1A11"], colunas: COLUNAS_DE_CARRETA },
          { nome: "cavalos", placas: ["BBB1B11"], colunas: COLUNAS_DE_CAVALO },
        ],
      });
      const [vigencia] = await vigenciasDisponiveis(ctx.db);
      const { rows } = await ctx.db.execute<{ id: string }>(
        sql`SELECT id::text FROM entity WHERE entity_type = 'CARRETA' LIMIT 1`,
      );

      const resultado = await estadoDoValor(
        ctx.db,
        vigencia.snapshotId,
        rows[0].id,
        "cavalo.custo_cavalo_0",
      );
      expect(resultado.estado).toBe("NAO_APLICAVEL");
      expect(resultado.valor).toBeNull();
    });
  });

  it("10 · uma vigência sem fato daquele atributo não deixa de existir", async () => {
    await comBanco("sem_fato", async (ctx) => {
      // Janeiro traz 20 colunas; fevereiro traz 20 colunas **diferentes**, do
      // mesmo equipamento. Nenhuma das duas some do censo por causa disso.
      await importarEPromover(ctx.db, carretas("EMPURRADA_1_1_2026", ["AAA1A11"]));
      await importarEPromover(ctx.db, {
        vigencia: "EMPURRADA_1_2_2026",
        abas: [
          {
            nome: "carretas",
            placas: ["AAA1A11"],
            colunas: [...COLUNAS_DE_CARRETA.slice(0, 10), "Custo Carreta Novo"],
          },
        ],
      });

      const vigencias = await vigenciasDisponiveis(ctx.db);
      expect(vigencias).toHaveLength(2);

      // A coluna que fevereiro não trouxe é `NAO_ENTREGUE` naquela vigência —
      // e a vigência continua disponível.
      const { rows } = await ctx.db.execute<{ id: string }>(
        sql`SELECT id::text FROM entity LIMIT 1`,
      );
      const resultado = await estadoDoValor(
        ctx.db,
        vigencias[1].snapshotId,
        rows[0].id,
        "carreta.custo_carreta_19",
      );
      expect(["NAO_ENTREGUE", "INEXISTENTE"]).toContain(resultado.estado);
      expect(resultado.valor).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Consistência
// ---------------------------------------------------------------------------

describe("13 · as funções da autoridade concordam entre si", () => {
  it("dois consumidores, duas APIs, a mesma resposta", async () => {
    await comBanco("consistencia", async (ctx) => {
      for (const mes of [1, 2, 3]) {
        await importarEPromover(ctx.db, carretas(`EMPURRADA_1_${mes}_2026`, ["AAA1A11"]));
      }
      await importarEPromover(ctx.db, {
        ...carretas("EMPURRADA_1_2_2026", ["CCC1C11"], "11.222.333/0001-44"),
        unidade: "JUIZ DE FORA",
      });

      const vigencias = await vigenciasDisponiveis(ctx.db);
      const contextos = await contextosDisponiveis(ctx.db);
      const series = await seriesDisponiveis(ctx.db);

      // O censo é um só, seja qual for a porta de entrada da pergunta.
      const porContexto = contextos.flatMap((c) => c.series);
      expect(new Set(porContexto).size).toBe(series.length);
      expect(series.reduce((n, s) => n + s.periodos.length, 0)).toBe(vigencias.length);
      expect(contextos.reduce((n, c) => n + c.periodos, 0)).toBe(vigencias.length);

      // `serieDe` concorda com a série que a vigência carrega.
      for (const v of vigencias) {
        expect(await serieDe(ctx.db, v.snapshotId)).toBe(v.serie);
      }

      // Recortar por contexto e por série dá o mesmo que filtrar o censo.
      for (const contexto of contextos) {
        const pelaApi = await vigenciasDisponiveis(ctx.db, { contexto: contexto.chave });
        const peloCenso = vigencias.filter((v) => v.contexto === contexto.chave);
        expect(pelaApi.map((v) => v.snapshotId).sort()).toEqual(
          peloCenso.map((v) => v.snapshotId).sort(),
        );
      }
      for (const serie of series) {
        const pelaApi = await vigenciasDisponiveis(ctx.db, { serie: serie.chave });
        expect(pelaApi.map((v) => v.effectiveDate).sort()).toEqual([...serie.periodos].sort());
      }

      // E o veredito concorda com a lista.
      const veredito = await verificarDisponibilidade(ctx.db, {
        contexto: contextos[0].chave,
      });
      expect(veredito.estado).toBe("DISPONIVEL");
      if (veredito.estado !== "DISPONIVEL") return;
      expect(veredito.vigencias.length).toBe(contextos[0].periodos);
    });
  });

  it("a cadeia de anteriores percorre a série inteira, sem pular nem repetir", async () => {
    await comBanco("cadeia", async (ctx) => {
      for (const mes of [1, 2, 4, 5]) {
        await importarEPromover(ctx.db, carretas(`EMPURRADA_1_${mes}_2026`, ["AAA1A11"]));
      }
      const vigencias = await vigenciasDisponiveis(ctx.db);
      const caminho: string[] = [];
      let atual = vigencias[vigencias.length - 1];
      for (;;) {
        caminho.push(atual.effectiveDate);
        const anterior = await vigenciaAnterior(ctx.db, atual.snapshotId);
        if (!anterior.encontrada) break;
        atual = anterior.vigencia;
      }
      expect(caminho).toEqual(["2026-05-01", "2026-04-01", "2026-02-01", "2026-01-01"]);
    });
  });
});
