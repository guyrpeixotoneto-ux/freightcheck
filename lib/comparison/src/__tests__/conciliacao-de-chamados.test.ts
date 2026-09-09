import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  ticketChangeTable,
  ticketImportTable,
  ticketTable,
} from "@workspace/db";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { computeChangeSet } from "../engine";
import {
  linhasDaConciliacao,
  linhasPorParametro,
  resumoDaConciliacao,
  resumoPorParametro,
  tiposDaConciliacao,
} from "../conciliacao-de-chamados";
import { buildFixture, type AttributeSpec } from "../testing";

/**
 * A Conciliação de Chamados — a planilha e a fila contam a mesma história?
 *
 * O que este arquivo prende são as quatro afirmações que a tela faz na cara de
 * quem opera, e as três armadilhas de contagem que as fariam mentir sem que
 * nada denunciasse:
 *
 * 1. **A armadilha do envio.** `ticket` é append-only e cada importação
 *    reinsere a fila inteira. Um segundo envio com os mesmos chamados **não
 *    pode** dobrar nada — e é o primeiro teste do bloco de contagem.
 * 2. **A armadilha da chave.** O parâmetro que o dicionário não reconheceu não
 *    é conciliável, e não pode virar "sem alteração": ele sai das quatro
 *    situações e aparece contado à parte.
 * 3. **A armadilha da placa repetida.** Duas alterações da mesma comparação no
 *    mesmo par — duas identidades canônicas com a mesma placa — não podem
 *    multiplicar o outro lado do `FULL OUTER JOIN`.
 *
 * A fixture é montada para que cada uma das quatro situações tenha exatamente
 * um par, o que faz cada asserção falhar por um motivo só.
 */

let ctx: TestDb;
let changeSetId: string;
let envioId: string;
/** Um segundo envio, idêntico ao primeiro — a armadilha do append-only. */
let envioRepetidoId: string;

const ATRIBUTOS: AttributeSpec[] = [
  { code: "cavalo.frete_peso", dataType: "NUMERIC", semanticsStatus: "PRESUMED" },
  { code: "cavalo.pedagio", dataType: "NUMERIC", semanticsStatus: "PRESUMED" },
  { code: "cavalo.seguro", dataType: "NUMERIC", semanticsStatus: "PRESUMED" },
  { code: "cavalo.rastreador", dataType: "NUMERIC", semanticsStatus: "PRESUMED" },
];

/** O rótulo da vigência anterior — o que o chamado nomeia em `Vig. Abertura`. */
const VIGENCIA_A = "2026-07";
const VIGENCIA_B = "2026-08";

async function semearEnvio(
  filename: string,
  sha: string,
  vigencia: string | null,
): Promise<string> {
  const [envio] = await ctx.db
    .insert(ticketImportTable)
    .values({
      filename,
      contentSha256: sha,
      byteSize: 1,
      status: "READ",
      serie: "CAMACARI",
      serieOrigem: "ARQUIVO",
      rowCount: 4,
      ticketCount: 4,
    })
    .returning();

  const [conciliado, divergente, semAlteracao, semPlaca] = await ctx.db
    .insert(ticketTable)
    .values([
      {
        ticketImportId: envio.id,
        externalId: `${sha}-CH-1`,
        statusBucket: "ATENDIDO",
        entityLabel: "AAA1A11",
        entityType: "CAVALO",
        vigenciaLabel: vigencia,
        sourceRowIndex: 1,
        changedParameterCount: 1,
      },
      {
        ticketImportId: envio.id,
        externalId: `${sha}-CH-2`,
        statusBucket: "ATENDIDO",
        entityLabel: "AAA1A11",
        entityType: "CAVALO",
        vigenciaLabel: vigencia,
        sourceRowIndex: 2,
        changedParameterCount: 1,
      },
      {
        ticketImportId: envio.id,
        externalId: `${sha}-CH-3`,
        statusBucket: "ABERTO",
        entityLabel: "BBB2B22",
        entityType: "CAVALO",
        vigenciaLabel: vigencia,
        sourceRowIndex: 3,
        changedParameterCount: 2,
      },
      /*
        O chamado que não nomeia placa — o caso normal do export real, em que
        `Item` vem com `-` em 3.394 das 3.400 linhas. Ele é invisível para o
        grão por ativo (não há placa por que cruzar) e conciliável pelo grão
        por parâmetro. Os dois blocos abaixo medem exatamente essa diferença.
      */
      {
        ticketImportId: envio.id,
        externalId: `${sha}-CH-4`,
        statusBucket: "ATENDIDO",
        entityLabel: null,
        entityType: null,
        vigenciaLabel: vigencia,
        sourceRowIndex: 4,
        changedParameterCount: 1,
      },
    ])
    .returning();

  await ctx.db.insert(ticketChangeTable).values([
    /* CONCILIADA — o chamado pediu 111 e a planilha aplicou 111. */
    {
      ticketId: conciliado.id,
      ticketImportId: envio.id,
      parameterLabel: "Frete peso",
      attributeCode: "cavalo.frete_peso",
      entityLabel: "AAA1A11",
      entityType: "CAVALO",
      changeKind: "SET",
      beforeSource: "ARQUIVO",
      valueBeforeRaw: "100",
      valueBeforeNumeric: "100",
      valueAfterRaw: "111",
      valueAfterNumeric: "111",
      sourceColumnIndex: 0,
      impactConfidence: "CALCULATED",
    },
    /* DIVERGENTE — o chamado pediu 30, a planilha aplicou 25. */
    {
      ticketId: divergente.id,
      ticketImportId: envio.id,
      parameterLabel: "Pedágio",
      attributeCode: "cavalo.pedagio",
      entityLabel: "AAA1A11",
      entityType: "CAVALO",
      changeKind: "SET",
      beforeSource: "ARQUIVO",
      valueBeforeRaw: "20",
      valueBeforeNumeric: "20",
      valueAfterRaw: "30",
      valueAfterNumeric: "30",
      sourceColumnIndex: 1,
      impactConfidence: "CALCULATED",
    },
    /* SEM_ALTERACAO — o chamado pediu e a planilha não mexeu no seguro. */
    {
      ticketId: semAlteracao.id,
      ticketImportId: envio.id,
      parameterLabel: "Seguro",
      attributeCode: "cavalo.seguro",
      entityLabel: "BBB2B22",
      entityType: "CAVALO",
      changeKind: "SET",
      beforeSource: "VIGENCIA",
      valueBeforeRaw: "50",
      valueBeforeNumeric: "50",
      valueAfterRaw: "60",
      valueAfterNumeric: "60",
      sourceColumnIndex: 2,
      impactConfidence: "CALCULATED",
    },
    /* FORA DA CONCILIAÇÃO — parâmetro que o dicionário não reconheceu. Sem
       `attribute_code` não há chave, e sem chave não há situação. */
    {
      ticketId: semAlteracao.id,
      ticketImportId: envio.id,
      parameterLabel: "Coluna que ninguém mapeou",
      attributeCode: null,
      entityLabel: "BBB2B22",
      entityType: "CAVALO",
      changeKind: "SET",
      beforeSource: "AUSENTE",
      valueAfterRaw: "9",
      valueAfterNumeric: "9",
      sourceColumnIndex: 3,
      impactConfidence: "NOT_CALCULABLE",
    },
    /* Sem placa, mas com parâmetro: pede o rastreador que a planilha mudou. */
    {
      ticketId: semPlaca.id,
      ticketImportId: envio.id,
      parameterLabel: "Rastreador",
      attributeCode: "cavalo.rastreador",
      entityLabel: null,
      entityType: null,
      changeKind: "SET",
      beforeSource: "ARQUIVO",
      valueBeforeRaw: "5",
      valueBeforeNumeric: "5",
      valueAfterRaw: "7",
      valueAfterNumeric: "7",
      sourceColumnIndex: 4,
      impactConfidence: "CALCULATED",
    },
  ]);

  return envio.id;
}

beforeAll(async () => {
  ctx = await createTestDatabase("conciliacao_de_chamados");

  const { snapshotIds } = await buildFixture(
    ctx.db,
    ATRIBUTOS,
    [
      {
        label: VIGENCIA_A,
        effectiveDate: "2026-07-01",
        data: {
          AAA1A11: {
            "cavalo.frete_peso": 100,
            "cavalo.pedagio": 20,
            "cavalo.rastreador": 5,
          },
          BBB2B22: { "cavalo.seguro": 50 },
        },
      },
      {
        label: VIGENCIA_B,
        effectiveDate: "2026-08-01",
        data: {
          AAA1A11: {
            /* CONCILIADA: bate com o chamado. */
            "cavalo.frete_peso": 111,
            /* DIVERGENTE: o chamado pediu 30. */
            "cavalo.pedagio": 25,
            /* SEM_CHAMADO: mudou e ninguém pediu. */
            "cavalo.rastreador": 7,
          },
          /* O seguro fica igual — é o que faz o chamado dele ser SEM_ALTERACAO. */
          BBB2B22: { "cavalo.seguro": 50 },
        },
      },
    ],
    { entityType: "CAVALO" },
  );

  const [a, b] = Object.values(snapshotIds);
  changeSetId = (await computeChangeSet(ctx.db, a, b, { force: true })).id;

  envioId = await semearEnvio("chamados-1.xlsx", "sha-envio-1", VIGENCIA_A);
  envioRepetidoId = await semearEnvio("chamados-2.xlsx", "sha-envio-2", VIGENCIA_A);
}, 120_000);

afterAll(async () => {
  await ctx?.drop();
});

const recorte = () => ({ changeSetId, ticketImportId: envioId });

describe("as quatro situações", () => {
  it("classifica cada par em exatamente uma, e as quatro somam o total", async () => {
    const resumo = await resumoDaConciliacao(ctx.db, recorte());

    expect(resumo.conciliadas).toBe(1);
    expect(resumo.divergentes).toBe(1);
    expect(resumo.semChamado).toBe(1);
    expect(resumo.semAlteracao).toBe(1);
    expect(
      resumo.conciliadas +
        resumo.divergentes +
        resumo.semChamado +
        resumo.semAlteracao,
    ).toBe(resumo.pares);
  });

  it("nomeia os dois lados de cada par, e a divergência traz a diferença", async () => {
    const { linhas } = await linhasDaConciliacao(ctx.db, recorte());
    const por = new Map(linhas.map((l) => [l.attributeCode, l]));

    const conciliada = por.get("cavalo.frete_peso")!;
    expect(conciliada.situacao).toBe("CONCILIADA");
    expect(conciliada.base).toBe("VALOR");
    expect(conciliada.externalId).toBe("sha-envio-1-CH-1");
    expect(conciliada.diferencaDeValor).toBe(0);

    const divergente = por.get("cavalo.pedagio")!;
    expect(divergente.situacao).toBe("DIVERGENTE");
    expect(divergente.planilhaDepoisNumerico).toBe(25);
    expect(divergente.chamadoDepoisNumerico).toBe(30);
    expect(divergente.diferencaDeValor).toBe(-5);

    const semChamado = por.get("cavalo.rastreador")!;
    expect(semChamado.situacao).toBe("SEM_CHAMADO");
    expect(semChamado.externalId).toBeNull();
    expect(semChamado.changeId).not.toBeNull();
    /* Sem os dois lados não há veredito sobre valor — e o campo diz isso. */
    expect(semChamado.base).toBeNull();

    const semAlteracao = por.get("cavalo.seguro")!;
    expect(semAlteracao.situacao).toBe("SEM_ALTERACAO");
    expect(semAlteracao.changeId).toBeNull();
    expect(semAlteracao.externalId).toBe("sha-envio-1-CH-3");
  });

  it("abre a lista pela divergência, que é o achado", async () => {
    const { linhas } = await linhasDaConciliacao(ctx.db, recorte());
    expect(linhas[0].situacao).toBe("DIVERGENTE");
    expect(linhas[linhas.length - 1].situacao).toBe("CONCILIADA");
  });
});

describe("as armadilhas de contagem", () => {
  /**
   * A do append-only. Um segundo envio traz a fila inteira de novo, e conciliar
   * contra ele tem de dar exatamente o mesmo número — a fila não dobrou, ela
   * foi retratada duas vezes.
   */
  it("não dobra ao existir um segundo envio com os mesmos chamados", async () => {
    const primeiro = await resumoDaConciliacao(ctx.db, recorte());
    const segundo = await resumoDaConciliacao(ctx.db, {
      changeSetId,
      ticketImportId: envioRepetidoId,
    });

    expect(segundo.chamados.alteracoes).toBe(primeiro.chamados.alteracoes);
    expect(segundo.pares).toBe(primeiro.pares);
    expect(segundo.conciliadas).toBe(primeiro.conciliadas);
  });

  /**
   * A da chave. A alteração de chamado sem `attribute_code` — e, neste grão,
   * também a sem placa — é contada à parte, e **não** aparece como par nenhum:
   * se virasse SEM_ALTERACAO, a tela cobraria de alguém uma alteração que
   * nunca foi pedida.
   */
  it("conta à parte o que não tem chave, e não o transforma em situação", async () => {
    const resumo = await resumoDaConciliacao(ctx.db, recorte());

    /* Duas: o parâmetro que o dicionário não reconheceu e o chamado sem placa. */
    expect(resumo.chamados.foraDaConciliacao).toBe(2);
    expect(resumo.chamados.alteracoes).toBe(3);
    expect(resumo.pares).toBe(4);

    const { linhas } = await linhasDaConciliacao(ctx.db, recorte());
    expect(linhas.some((l) => l.attributeCode === "")).toBe(false);
  });

  /**
   * A da placa repetida. Duas alterações da mesma comparação caindo no mesmo
   * par — o que acontece quando duas identidades canônicas carregam a mesma
   * placa — **não** podem multiplicar o lado dos chamados no `FULL OUTER JOIN`.
   * Se multiplicassem, as quatro situações deixariam de somar o total, e nada
   * na tela denunciaria.
   */
  it("não multiplica o par quando duas alterações caem na mesma placa e parâmetro", async () => {
    const antes = await resumoDaConciliacao(ctx.db, recorte());

    /* A cópia entra à mão: o motor emite uma alteração por (entidade,
       atributo), e é justamente a colisão de placa entre duas entidades que
       este caso simula. */
    await ctx.db.execute(sql`
      INSERT INTO change (
        change_set_id, category, change_type, nature, entity_id, attribute_id,
        value_before, value_after, numeric_before, numeric_after,
        comparability, impact_confidence, attribute_code, attribute_name,
        entity_label, entity_type
      )
      SELECT change_set_id, category, change_type, nature, entity_id, attribute_id,
             value_before, value_after, numeric_before, numeric_after,
             comparability, impact_confidence, attribute_code, attribute_name,
             lower(entity_label), entity_type
        FROM change
       WHERE change_set_id = ${changeSetId}::uuid
         AND attribute_code = 'cavalo.frete_peso'
    `);

    const depois = await resumoDaConciliacao(ctx.db, recorte());

    /* O lado da planilha ganhou uma alteração — e isso é publicado. */
    expect(depois.planilha.alteracoes).toBe(antes.planilha.alteracoes + 1);
    /* O par não. E o cruzamento inteiro continua o mesmo. */
    expect(depois.planilha.pares).toBe(antes.planilha.pares);
    expect(depois.pares).toBe(antes.pares);
    expect(depois.conciliadas).toBe(antes.conciliadas);
    expect(
      depois.conciliadas + depois.divergentes + depois.semChamado + depois.semAlteracao,
    ).toBe(depois.pares);

    const { linhas } = await linhasDaConciliacao(ctx.db, recorte());
    const par = linhas.find((l) => l.attributeCode === "cavalo.frete_peso")!;
    expect(par.alteracoesNoPar).toBe(2);

    /* A fixture volta ao estado dos outros casos — eles não pediram esta
       colisão, e um teste que a deixasse para trás mudaria o vizinho. */
    await ctx.db.execute(sql`
      DELETE FROM change
       WHERE change_set_id = ${changeSetId}::uuid
         AND entity_label = lower(entity_label)
    `);
  });

  /**
   * A conta que dá nome ao módulo: quantas alterações a planilha trouxe menos
   * quantas os chamados trouxeram.
   */
  it("publica a diferença de contagem entre os dois lados", async () => {
    const resumo = await resumoDaConciliacao(ctx.db, recorte());

    expect(resumo.planilha.alteracoes).toBe(3);
    expect(resumo.chamados.alteracoes).toBe(3);
    expect(resumo.diferenca).toBe(0);
    /* Uma placa está dos dois lados (AAA1A11); BBB2B22 tem chamado sem
       alteração, e por isso não conta como comum. */
    expect(resumo.placasEmComum).toBe(1);
  });
});

describe("os recortes", () => {
  it("filtra por situação, e o total acompanha", async () => {
    const pagina = await linhasDaConciliacao(ctx.db, recorte(), {
      situacao: "DIVERGENTE",
    });
    expect(pagina.total).toBe(1);
    expect(pagina.linhas).toHaveLength(1);
    expect(pagina.linhas[0].attributeCode).toBe("cavalo.pedagio");
  });

  it("busca por placa, parâmetro e número de chamado", async () => {
    const porPlaca = await linhasDaConciliacao(ctx.db, recorte(), {
      search: "BBB2B22",
    });
    expect(porPlaca.total).toBe(1);

    const porChamado = await linhasDaConciliacao(ctx.db, recorte(), {
      search: "CH-1",
    });
    expect(porChamado.linhas.map((l) => l.attributeCode)).toEqual([
      "cavalo.frete_peso",
    ]);
  });

  it("pagina sem perder o total", async () => {
    const pagina = await linhasDaConciliacao(ctx.db, recorte(), {}, {
      limit: 2,
      offset: 0,
    });
    expect(pagina.total).toBe(4);
    expect(pagina.linhas).toHaveLength(2);
  });

  /**
   * O recorte por vigência comparada. Os chamados desta fixture nomeiam a
   * vigência A (`Vig. Abertura`), que é uma das duas comparadas — então ligá-lo
   * não muda nada. É o que se quer provar: o filtro alcança o que deve, e o
   * teste ao lado prova que ele **exclui** quem não nomeia nenhuma.
   */
  it("respeita o recorte pela vigência que o chamado nomeia", async () => {
    const comRecorte = await resumoDaConciliacao(ctx.db, {
      ...recorte(),
      somenteVigenciaComparada: true,
    });
    expect(comRecorte.chamados.alteracoes).toBe(3);

    const outroEnvio = await semearEnvio(
      "chamados-3.xlsx",
      "sha-envio-3",
      "2099-12",
    );
    const foraDaVigencia = await resumoDaConciliacao(ctx.db, {
      changeSetId,
      ticketImportId: outroEnvio,
      somenteVigenciaComparada: true,
    });
    expect(foraDaVigencia.chamados.alteracoes).toBe(0);
    /* Sem chamado nenhum, toda alteração da planilha fica sem chamado — e
       nenhuma vira conciliada por acidente. */
    expect(foraDaVigencia.semChamado).toBe(3);
    expect(foraDaVigencia.conciliadas).toBe(0);
  });

  it("lista os tipos de ativo da união dos dois lados", async () => {
    const tipos = await tiposDaConciliacao(ctx.db, recorte());
    expect(tipos).toEqual([{ entityType: "CAVALO", pares: 4 }]);
  });
});

/**
 * O SEGUNDO GRÃO — por parâmetro, que é o que o export real alcança.
 *
 * O chamado do export do Freightech quase nunca nomeia placa: `Item` vem com
 * `-` em 3.394 das 3.400 linhas. Para o grão por ativo esses chamados não
 * existem, e o efeito não é uma tela vazia — é a tela afirmando que a planilha
 * mudou coisas que ninguém pediu, sobre um envio de milhares de pedidos que ela
 * não conseguiu ler.
 *
 * A fixture tem um chamado desses: `CH-4` pede `cavalo.rastreador`, sem placa,
 * e a planilha mudou o rastreador de AAA1A11. É a mesma linha vista pelos dois
 * grãos, e o que se prende aqui é que ela é invisível num e conciliada no outro.
 */
describe("o grão por parâmetro", () => {
  it("concilia o chamado sem placa, que o grão por ativo não enxerga", async () => {
    const porAtivo = await linhasDaConciliacao(ctx.db, recorte());
    const rastreadorPorAtivo = porAtivo.linhas.find(
      (l) => l.attributeCode === "cavalo.rastreador",
    )!;
    /* Sem placa não há par: para este grão, ninguém pediu. */
    expect(rastreadorPorAtivo.situacao).toBe("SEM_CHAMADO");

    const { linhas } = await linhasPorParametro(ctx.db, recorte());
    const rastreador = linhas.find(
      (l) => l.attributeCode === "cavalo.rastreador",
    )!;
    expect(rastreador.situacao).toBe("CONCILIADA");
    expect(rastreador.alteracoesNaPlanilha).toBe(1);
    expect(rastreador.chamados).toBe(1);
    /* E a tela diz que nenhum dos chamados dele nomeia placa — que é o motivo
       de o veredito valer menos que o do outro grão, e não uma nota de rodapé. */
    expect(rastreador.chamadosComPlaca).toBe(0);
  });

  /**
   * O veredito deste grão é sobre **contagem**, e a diferença aparece no
   * pedágio: o chamado pediu 30, a planilha aplicou 25. Por ativo isso é
   * DIVERGENTE — os dois valores foram confrontados. Por parâmetro é
   * CONCILIADA, porque um pedido produziu uma alteração e é só isso que este
   * grão sabe. Confundir os dois faria a tela afirmar uma conferência de valor
   * que não houve.
   */
  it("concilia por contagem, e não por valor", async () => {
    const porAtivo = await linhasDaConciliacao(ctx.db, recorte());
    expect(
      porAtivo.linhas.find((l) => l.attributeCode === "cavalo.pedagio")!
        .situacao,
    ).toBe("DIVERGENTE");

    const { linhas } = await linhasPorParametro(ctx.db, recorte());
    const pedagio = linhas.find((l) => l.attributeCode === "cavalo.pedagio")!;
    expect(pedagio.situacao).toBe("CONCILIADA");
    expect(pedagio.alteracoesNaPlanilha).toBe(1);
    expect(pedagio.chamados).toBe(1);
  });

  it("classifica cada parâmetro em exatamente uma situação, e as quatro somam o total", async () => {
    const r = await resumoPorParametro(ctx.db, recorte());

    expect(r.conciliados + r.divergentes + r.semChamado + r.semAlteracao).toBe(
      r.parametros,
    );
    /* frete_peso e pedágio (os dois lados), rastreador (o sem placa) e seguro
       (pedido e não aplicado). */
    expect(r.parametros).toBe(4);
    expect(r.conciliados).toBe(3);
    expect(r.semAlteracao).toBe(1);
    expect(r.semChamado).toBe(0);
  });

  it("acusa a divergência de contagem quando os dois lados não têm o mesmo número", async () => {
    /* Um segundo chamado pedindo o mesmo seguro da mesma vigência: dois pedidos
       para nenhuma alteração continua SEM_ALTERACAO, mas dois pedidos para uma
       alteração é DIVERGENTE — e é a contagem que o diz. */
    const [extra] = await ctx.db
      .insert(ticketTable)
      .values({
        ticketImportId: envioId,
        externalId: "sha-envio-1-CH-5",
        statusBucket: "ATENDIDO",
        entityLabel: null,
        vigenciaLabel: VIGENCIA_A,
        sourceRowIndex: 5,
        changedParameterCount: 1,
      })
      .returning();
    await ctx.db.insert(ticketChangeTable).values({
      ticketId: extra.id,
      ticketImportId: envioId,
      parameterLabel: "Rastreador",
      attributeCode: "cavalo.rastreador",
      changeKind: "SET",
      beforeSource: "ARQUIVO",
      valueAfterRaw: "7",
      valueAfterNumeric: "7",
      sourceColumnIndex: 5,
      impactConfidence: "CALCULATED",
    });

    const { linhas } = await linhasPorParametro(ctx.db, recorte());
    const rastreador = linhas.find(
      (l) => l.attributeCode === "cavalo.rastreador",
    )!;
    expect(rastreador.situacao).toBe("DIVERGENTE");
    expect(rastreador.chamados).toBe(2);
    expect(rastreador.alteracoesNaPlanilha).toBe(1);
    expect(rastreador.diferenca).toBe(-1);

    /* A fixture volta ao estado dos outros casos — a alteração antes do
       chamado, que é a ordem que a FK aceita. */
    await ctx.db.execute(
      sql`DELETE FROM ticket_change WHERE ticket_id = ${extra.id}::uuid`,
    );
    await ctx.db.execute(sql`DELETE FROM ticket WHERE id = ${extra.id}::uuid`);
  });

  /**
   * A mesma armadilha do append-only, neste grão: um segundo envio com a fila
   * inteira não pode dobrar contagem nenhuma.
   */
  it("não dobra ao existir um segundo envio com os mesmos chamados", async () => {
    const primeiro = await resumoPorParametro(ctx.db, recorte());
    const segundo = await resumoPorParametro(ctx.db, {
      changeSetId,
      ticketImportId: envioRepetidoId,
    });
    expect(segundo.chamados).toBe(primeiro.chamados);
    expect(segundo.parametros).toBe(primeiro.parametros);
    expect(segundo.conciliados).toBe(primeiro.conciliados);
  });

  it("publica à parte o chamado cujo parâmetro o dicionário não reconheceu", async () => {
    const r = await resumoPorParametro(ctx.db, recorte());
    /* A "Coluna que ninguém mapeou". Ela não vira parâmetro nenhum — some das
       quatro situações e aparece contada, que é o oposto de sumir. */
    expect(r.chamadosForaDaConciliacao).toBe(1);
    expect(r.chamados).toBe(4);
  });

  it("abre a lista pela divergência e filtra por situação", async () => {
    const pagina = await linhasPorParametro(ctx.db, recorte(), {
      situacao: "SEM_ALTERACAO",
    });
    expect(pagina.total).toBe(1);
    expect(pagina.linhas[0].attributeCode).toBe("cavalo.seguro");
    /* O rótulo cru do arquivo vem junto: é por ele que quem opera procura. */
    expect(pagina.linhas[0].parameterLabel).toBe("Seguro");
    expect(pagina.linhas[0].operacoes).toEqual([
      { changeKind: "SET", chamados: 1 },
    ]);
  });

  it("busca pelo código, pelo nome na base e pelo rótulo do arquivo", async () => {
    for (const termo of ["rastreador", "Rastreador"]) {
      const pagina = await linhasPorParametro(ctx.db, recorte(), {
        search: termo,
      });
      expect(pagina.linhas.map((l) => l.attributeCode)).toContain(
        "cavalo.rastreador",
      );
    }
  });

  it("respeita o recorte pela vigência que o chamado nomeia", async () => {
    const dentro = await resumoPorParametro(ctx.db, {
      ...recorte(),
      somenteVigenciaComparada: true,
    });
    expect(dentro.chamados).toBe(4);

    /* Um envio cuja vigência não é nenhuma das duas comparadas: com o recorte
       ligado, nenhum chamado alcança a comparação — e o que sobra é a planilha
       inteira em SEM_CHAMADO, dito com todas as letras em vez de por omissão. */
    const forA = await semearEnvio("chamados-3.xlsx", "sha-envio-3", "2026-01");
    const fora = await resumoPorParametro(ctx.db, {
      changeSetId,
      ticketImportId: forA,
      somenteVigenciaComparada: true,
    });
    expect(fora.chamados).toBe(0);
    expect(fora.semAlteracao).toBe(0);
    expect(fora.semChamado).toBe(fora.parametros);
  });
});
