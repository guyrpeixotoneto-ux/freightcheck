import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { ticketChangeTable, ticketImportTable, ticketTable } from "@workspace/db";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import {
  diaDaOperacao,
  processarEnvioDeChamados,
  recalcularSerie,
  serieDoNomeDoArquivo,
} from "../monitoramento-de-chamados";
import {
  listarMovimentacoes,
  registrarRevisao,
  desfazerRevisao,
  reguaDeDias,
  resumoDoDia,
  detalheDaMovimentacao,
  seriesDisponiveis,
  revisarEmLote,
} from "../monitoramento-de-chamados-leitura";

/**
 * O Monitoramento de Chamados, contra banco de verdade.
 *
 * A tela promete uma frase que este arquivo existe para tornar verdadeira: **o
 * que mudou desde ontem**. Cada bloco abaixo fixa uma das decisões que essa
 * frase esconde — e quase todas foram tomadas contra uma alternativa que
 * *parecia* certa:
 *
 * - a primeira carga não é "5.000 chamados novos";
 * - reimportar o mesmo arquivo não é movimentação;
 * - um chamado com três campos alterados é **uma** linha da fila, não três;
 * - três importações no mesmo dia são **uma** movimentação, não três;
 * - um campo que vai e volta no mesmo dia não aparece como alteração;
 * - duas unidades no mesmo dia não fazem uma "sumir" por causa da outra;
 * - o número do chamado se repete dentro do envio, e isso não multiplica nada.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("monitoramento_chamados");
}, 180_000);

afterAll(async () => {
  await ctx?.drop();
});

beforeEach(async () => {
  // Cada bloco monta o seu acervo do zero. A ordem respeita as chaves
  // estrangeiras; o resto sai por cascata da `0087`.
  await ctx.db.execute(sql`DELETE FROM ticket_change`);
  await ctx.db.execute(sql`DELETE FROM ticket`);
  await ctx.db.execute(sql`DELETE FROM ticket_import`);
});

// ---------------------------------------------------------------------------
// O andaime
// ---------------------------------------------------------------------------

interface ChamadoDeTeste {
  externalId: string;
  status?: string;
  statusBucket?: string;
  unidade?: string | null;
  area?: string | null;
  aprovador?: string | null;
  prazo?: string | null;
  categoria?: string | null;
  assunto?: string | null;
  solicitante?: string | null;
  /** `Campo Alteração` → valor solicitado. Uma linha de `ticket` por entrada. */
  parametros?: Record<string, string>;
}

/**
 * Um envio, como o leitor o teria gravado.
 *
 * O formato é o **real**: NARROW, uma linha de `ticket` por campo alterado. Um
 * chamado com três parâmetros vira três linhas com o mesmo `external_id` — que
 * é justamente a armadilha que o motor precisa desarmar, e por isso o andaime
 * não a esconde.
 */
async function enviar(
  chamados: ChamadoDeTeste[],
  {
    recebidoEm,
    filename = "Chamados_Recife.xlsx",
    status = "READ" as const,
  }: { recebidoEm: string; filename?: string; status?: "READ" | "FAILED" },
): Promise<string> {
  const [envio] = await ctx.db
    .insert(ticketImportTable)
    .values({
      filename,
      contentSha256: `sha-${filename}-${recebidoEm}`,
      byteSize: 1,
      status,
      receivedAt: new Date(recebidoEm),
      rowCount: chamados.length,
      ticketCount: chamados.length,
    })
    .returning();

  let linha = 0;
  for (const c of chamados) {
    const parametros = Object.entries(c.parametros ?? { "Frete peso": "100" });
    for (const [parametro, valor] of parametros) {
      linha++;
      const [t] = await ctx.db
        .insert(ticketTable)
        .values({
          ticketImportId: envio!.id,
          externalId: c.externalId,
          statusRaw: c.status ?? "Em análise",
          statusBucket: c.statusBucket ?? "EM_ANDAMENTO",
          unidadeRaw: c.unidade === undefined ? "Recife" : c.unidade,
          segmentoRaw: c.area === undefined ? "Operações" : c.area,
          aprovadorRaw: c.aprovador === undefined ? "João Silva" : c.aprovador,
          prazoPrevisto: c.prazo === undefined ? "2026-09-10" : c.prazo,
          categoriaRaw: c.categoria ?? null,
          subject: c.assunto ?? "Entrega do relatório mensal",
          requestedBy: c.solicitante ?? "Maria Costa",
          sourceRowIndex: linha,
          changedParameterCount: 1,
        })
        .returning();

      await ctx.db.insert(ticketChangeTable).values({
        ticketId: t!.id,
        ticketImportId: envio!.id,
        parameterLabel: parametro,
        valueAfterRaw: valor,
        beforeSource: "ARQUIVO",
        sourceColumnIndex: 0,
      });
    }
  }
  return envio!.id;
}

const DIA = "2026-09-02";
const ONTEM = "2026-09-01";
/** 09:00 em São Paulo (UTC-3) é 12:00 UTC. */
const as = (dia: string, hora: number) =>
  `${dia}T${String(hora + 3).padStart(2, "0")}:00:00.000Z`;

const movimentacoesDo = async (dia = DIA) =>
  (await listarMovimentacoes(ctx.db, { dia, filtros: { limit: 100 } })).rows;

// ---------------------------------------------------------------------------

describe("o dia da régua é o da importação, no fuso da operação", () => {
  it("um envio às 21h de 02/09 pertence a 02/09, e não a 03/09 em UTC", () => {
    // 21:00 em São Paulo = 00:00Z do dia seguinte. É o caso que um `::date` em
    // UTC erraria, e o único em que a escolha do fuso aparece.
    expect(diaDaOperacao(new Date("2026-09-03T00:00:00.000Z"))).toBe("2026-09-02");
    expect(diaDaOperacao(new Date("2026-09-02T12:00:00.000Z"))).toBe("2026-09-02");
  });

  it("a série sai do nome do arquivo quando as linhas não a nomeiam", () => {
    expect(serieDoNomeDoArquivo("Chamados_Recife.xlsx")).toBe("Recife");
    expect(serieDoNomeDoArquivo("chamados - camaçari.csv")).toBe("camaçari");
    expect(serieDoNomeDoArquivo("relatorio.xlsx")).toBeNull();
  });
});

describe("T01 · a primeira importação é estado inicial, não uma fila de novos", () => {
  it("registra a baseline e não produz movimentação nenhuma", async () => {
    const envio = await enviar(
      [{ externalId: "CH-1" }, { externalId: "CH-2" }, { externalId: "CH-3" }],
      { recebidoEm: as(DIA, 8) },
    );

    const r = await processarEnvioDeChamados(ctx.db, envio);
    expect(r.tipo).toBe("BASELINE");
    expect(r.movimentacoesNoDia).toBe(0);
    expect(await movimentacoesDo()).toHaveLength(0);

    const resumo = await resumoDoDia(ctx.db, { dia: DIA });
    expect(resumo.estado).toBe("PRIMEIRA_CARGA");
    expect(resumo.movimentacoes).toBe(0);
    expect(resumo.avisos.map((a) => a.tipo)).toContain("BASELINE");
    // A frase precisa dizer o tamanho da carga: é o que separa "nada aconteceu"
    // de "3 chamados entraram como estado inicial".
    expect(resumo.avisos[0]!.texto).toContain("3 chamados");
  });
});

describe("baseline e comparação no mesmo dia", () => {
  it("o dia conta a comparação, e ainda diz que ali houve a primeira carga", async () => {
    /*
      A unidade entra no produto de manhã e manda o segundo arquivo à tarde. O
      dia tem as duas coisas: uma baseline, que não produz movimentação, e um
      diff, que produz. Contar a baseline como movimentação encheria o primeiro
      dia da unidade com o acervo inteiro; escondê-la faria a tela não explicar
      por que só metade do dia virou comparação.
    */
    await processarEnvioDeChamados(
      ctx.db,
      await enviar([{ externalId: "CH-1", prazo: "2026-09-10" }, { externalId: "CH-2" }], {
        recebidoEm: as(DIA, 8),
      }),
    );
    await processarEnvioDeChamados(
      ctx.db,
      await enviar([{ externalId: "CH-1", prazo: "2026-09-20" }, { externalId: "CH-2" }], {
        recebidoEm: as(DIA, 14),
      }),
    );

    const movs = await movimentacoesDo();
    expect(movs.map((m) => m.externalId)).toEqual(["CH-1"]);
    expect(movs[0]!.diferencas[0]).toMatchObject({
      antes: "2026-09-10",
      depois: "2026-09-20",
    });

    const resumo = await resumoDoDia(ctx.db, { dia: DIA });
    expect(resumo.movimentacoes).toBe(1);
    // Há movimentação, então o estado é o do trabalho — e o aviso da primeira
    // carga continua ali para explicar o dia.
    expect(resumo.estado).toBe("PENDENTE");
    expect(resumo.avisos.map((a) => a.tipo)).toContain("BASELINE");
  });
});

describe("T02 · reimportar sem mudança não é movimentação", () => {
  it("o dia diz que houve importação e que nada mudou", async () => {
    const chamados = [{ externalId: "CH-1" }, { externalId: "CH-2" }];
    await processarEnvioDeChamados(
      ctx.db,
      await enviar(chamados, { recebidoEm: as(ONTEM, 8) }),
    );
    const segundo = await enviar(chamados, { recebidoEm: as(DIA, 8) });

    const r = await processarEnvioDeChamados(ctx.db, segundo);
    expect(r.tipo).toBe("DIFF");
    expect(r.movimentacoesNoDia).toBe(0);

    const resumo = await resumoDoDia(ctx.db, { dia: DIA });
    expect(resumo.estado).toBe("SEM_MOVIMENTACAO");
    expect(resumo.movimentacoes).toBe(0);
  });
});

describe("T03–T07 · as quatro classes, e a exclusividade delas", () => {
  beforeEach(async () => {
    await processarEnvioDeChamados(
      ctx.db,
      await enviar(
        [
          { externalId: "CH-ALT", prazo: "2026-09-10" },
          { externalId: "CH-FIM", statusBucket: "EM_ANDAMENTO", status: "Em análise" },
          { externalId: "CH-SUMIU" },
          { externalId: "CH-PARADO" },
          // Quatro fixos para o envio seguinte não encolher além do limiar.
          { externalId: "CH-X1" },
          { externalId: "CH-X2" },
          { externalId: "CH-X3" },
          { externalId: "CH-X4" },
        ],
        { recebidoEm: as(ONTEM, 8) },
      ),
    );
    await processarEnvioDeChamados(
      ctx.db,
      await enviar(
        [
          { externalId: "CH-ALT", prazo: "2026-09-15" },
          { externalId: "CH-FIM", statusBucket: "ATENDIDO", status: "Concluído" },
          { externalId: "CH-NOVO" },
          { externalId: "CH-PARADO" },
          { externalId: "CH-X1" },
          { externalId: "CH-X2" },
          { externalId: "CH-X3" },
          { externalId: "CH-X4" },
        ],
        { recebidoEm: as(DIA, 8) },
      ),
    );
  });

  it("classifica novo, alterado, encerrado e removido — e o parado fica de fora", async () => {
    const porChamado = new Map(
      (await movimentacoesDo()).map((m) => [m.externalId, m]),
    );

    expect(porChamado.get("CH-NOVO")?.classe).toBe("NOVO");
    expect(porChamado.get("CH-ALT")?.classe).toBe("ALTERADO");
    expect(porChamado.get("CH-FIM")?.classe).toBe("ENCERRADO");
    expect(porChamado.get("CH-SUMIU")?.classe).toBe("REMOVIDO");
    // O que não mudou não é movimentação — senão a fila do dia seria o acervo.
    expect(porChamado.has("CH-PARADO")).toBe(false);
  });

  it("o antes → depois aparece na própria linha", async () => {
    const alterado = (await movimentacoesDo()).find((m) => m.externalId === "CH-ALT")!;
    expect(alterado.diferencas).toContainEqual({
      tipo: "PRAZO",
      campo: "Previsão Análise",
      antes: "2026-09-10",
      depois: "2026-09-15",
    });
  });

  it("encerrar vence alterar: a mesma movimentação não é contada duas vezes", async () => {
    const resumo = await resumoDoDia(ctx.db, { dia: DIA });
    const fim = (await movimentacoesDo()).find((m) => m.externalId === "CH-FIM")!;

    expect(fim.classe).toBe("ENCERRADO");
    // O status mudou junto, e continua listado entre os campos: a classe é uma,
    // as diferenças são todas.
    expect(fim.diferencas.some((d) => d.tipo === "STATUS")).toBe(true);
    expect(resumo.alterados).toBe(1); // só CH-ALT
    expect(resumo.encerrados).toBe(1);
  });

  it("as quatro classes somam exatamente o total — a conta do mockup não fechava", async () => {
    const r = await resumoDoDia(ctx.db, { dia: DIA });
    expect(r.novos + r.alterados + r.encerrados + r.removidos).toBe(r.movimentacoes);
    expect(r.revisadas + r.pendentes).toBe(r.movimentacoes);
    expect(r.movimentacoes).toBe(4);
  });
});

describe("T05 · três campos numa comparação são UMA movimentação", () => {
  it("uma linha na fila, três diferenças dentro", async () => {
    await processarEnvioDeChamados(
      ctx.db,
      await enviar(
        [{ externalId: "CH-1", prazo: "2026-09-10", aprovador: "João", area: "TI" }],
        { recebidoEm: as(ONTEM, 8) },
      ),
    );
    await processarEnvioDeChamados(
      ctx.db,
      await enviar(
        [{ externalId: "CH-1", prazo: "2026-09-20", aprovador: "Maria", area: "Fiscal" }],
        { recebidoEm: as(DIA, 8) },
      ),
    );

    const movs = await movimentacoesDo();
    expect(movs).toHaveLength(1);
    expect(movs[0]!.diferencas.map((d) => d.tipo).sort()).toEqual([
      "AREA",
      "PRAZO",
      "RESPONSAVEL",
    ]);

    // O grão da contagem de campos é outro, e a tela nunca soma os dois.
    const resumo = await resumoDoDia(ctx.db, { dia: DIA });
    expect(resumo.movimentacoes).toBe(1);
    expect(
      resumo.alteracoesDeCampo.reduce((soma, t) => soma + t.total, 0),
    ).toBe(3);
  });
});

describe("T11 · o número do chamado se repete dentro do envio", () => {
  it("um B.O em três linhas é um chamado, não três", async () => {
    await processarEnvioDeChamados(
      ctx.db,
      await enviar(
        [{ externalId: "CH-1", parametros: { Pedágio: "10", Pneu: "20", Frete: "30" } }],
        { recebidoEm: as(ONTEM, 8) },
      ),
    );
    await processarEnvioDeChamados(
      ctx.db,
      await enviar(
        [
          {
            externalId: "CH-1",
            prazo: "2026-09-30",
            parametros: { Pedágio: "10", Pneu: "25", Frete: "30" },
          },
        ],
        { recebidoEm: as(DIA, 8) },
      ),
    );

    const movs = await movimentacoesDo();
    expect(movs).toHaveLength(1);
    // O valor de um parâmetro é mais um campo comparado — nunca a unidade da tela.
    expect(movs[0]!.diferencas).toContainEqual({
      tipo: "VALOR_SOLICITADO",
      campo: "Pneu",
      antes: "20",
      depois: "25",
    });
    expect(movs[0]!.diferencas.filter((d) => d.tipo === "VALOR_SOLICITADO")).toHaveLength(1);
  });
});

describe("T08/T09 · três importações no mesmo dia", () => {
  beforeEach(async () => {
    await processarEnvioDeChamados(
      ctx.db,
      await enviar([{ externalId: "CH-1", prazo: "2026-09-10" }, { externalId: "CH-2", area: "TI" }], {
        recebidoEm: as(ONTEM, 17),
      }),
    );
    for (const [hora, prazo, area] of [
      [8, "2026-09-11", "Fiscal"],
      [12, "2026-09-12", "Fiscal"],
      [17, "2026-09-13", "TI"],
    ] as const) {
      await processarEnvioDeChamados(
        ctx.db,
        await enviar(
          [{ externalId: "CH-1", prazo }, { externalId: "CH-2", area }],
          { recebidoEm: as(DIA, hora) },
        ),
      );
    }
  });

  it("A→B→C→D é UMA movimentação do dia, com o saldo A→D", async () => {
    const movs = await movimentacoesDo();
    const ch1 = movs.find((m) => m.externalId === "CH-1")!;

    expect(ch1.passos).toBe(3);
    expect(ch1.diferencas).toEqual([
      { tipo: "PRAZO", campo: "Previsão Análise", antes: "2026-09-10", depois: "2026-09-13" },
    ]);
  });

  it("o campo que vai e volta não aparece no saldo, mas fica nos passos", async () => {
    const movs = await movimentacoesDo();
    const ch2 = movs.find((m) => m.externalId === "CH-2")!;

    // TI → Fiscal → Fiscal → TI. O saldo do dia é honesto: nada mudou.
    expect(ch2.diferencas.filter((d) => d.tipo === "AREA")).toHaveLength(0);

    /*
      Mas o chamado **continua na fila**. Ele se mexeu duas vezes hoje, e o
      gestor abre esta tela justamente para pegar esse tipo de ruído — o campo
      que foi remarcado e desremarcado. Zero diferenças com passos é o par que a
      tela lê como "oscilou e voltou".
    */
    expect(ch2.classe).toBe("ALTERADO");
    expect(ch2.diferencas).toHaveLength(0);
    expect(ch2.passos).toBeGreaterThan(0);

    const detalhe = await detalheDaMovimentacao(ctx.db, ch2.id);
    const idas = detalhe!.passos.flatMap((p) => p.diferencas.filter((d) => d.tipo === "AREA"));
    expect(idas).toHaveLength(2); // a ida e a volta ficam registradas
  });

  it("o encadeamento inteiro fica acessível, com a hora de cada passo", async () => {
    const ch1 = (await movimentacoesDo()).find((m) => m.externalId === "CH-1")!;
    const detalhe = await detalheDaMovimentacao(ctx.db, ch1.id);
    expect(detalhe!.passos.map((p) => p.ordem)).toEqual([1, 2, 3]);
    expect(detalhe!.passos[0]!.diferencas[0]).toMatchObject({
      antes: "2026-09-10",
      depois: "2026-09-11",
    });
  });
});

describe("o detalhe responde pelo id, e não por uma busca de texto", () => {
  it("um número que é prefixo de outros abre a movimentação certa", async () => {
    /*
      `CH-1` é prefixo de `CH-10` e `CH-100`. Enquanto o detalhe procurava a
      movimentação numa busca livre pelo número, bastava a lista daquele texto
      passar de uma página para ele responder 404 sobre algo que existe.
    */
    const chamados = ["CH-1", "CH-10", "CH-100", "CH-1000"].map((externalId) => ({
      externalId,
    }));
    await processarEnvioDeChamados(
      ctx.db,
      await enviar(chamados, { recebidoEm: as(ONTEM, 8) }),
    );
    await processarEnvioDeChamados(
      ctx.db,
      await enviar(
        chamados.map((c) => ({ ...c, prazo: `2026-09-${c.externalId.length + 10}` })),
        { recebidoEm: as(DIA, 8) },
      ),
    );

    for (const m of await movimentacoesDo()) {
      const detalhe = await detalheDaMovimentacao(ctx.db, m.id);
      expect(detalhe, `detalhe de ${m.externalId}`).not.toBeNull();
      expect(detalhe!.movimentacao.id).toBe(m.id);
      expect(detalhe!.movimentacao.externalId).toBe(m.externalId);
      // As diferenças do detalhe são as mesmas da lista — uma montagem só.
      expect(detalhe!.movimentacao.diferencas).toEqual(m.diferencas);
    }
  });
});

describe("T10/T16 · duas unidades no mesmo dia são duas séries", () => {
  beforeEach(async () => {
    for (const unidade of ["Recife", "Camaçari"]) {
      await processarEnvioDeChamados(
        ctx.db,
        await enviar(
          [
            { externalId: `${unidade}-1`, unidade },
            { externalId: `${unidade}-2`, unidade },
          ],
          { recebidoEm: as(ONTEM, 8), filename: `Chamados_${unidade}.xlsx` },
        ),
      );
    }
    // Só Recife manda arquivo hoje. Camaçari não pode "sumir" por causa disso.
    await processarEnvioDeChamados(
      ctx.db,
      await enviar(
        [
          { externalId: "Recife-1", unidade: "Recife", prazo: "2026-09-30" },
          { externalId: "Recife-2", unidade: "Recife" },
        ],
        { recebidoEm: as(DIA, 8), filename: "Chamados_Recife.xlsx" },
      ),
    );
  });

  it("o envio de uma unidade não faz a outra desaparecer", async () => {
    const movs = await movimentacoesDo();
    expect(movs.map((m) => m.externalId)).toEqual(["Recife-1"]);
    expect(movs.every((m) => m.classe !== "REMOVIDO")).toBe(true);
  });

  it("o recorte por série não vaza, e uma série inexistente devolve vazio", async () => {
    expect(
      (await listarMovimentacoes(ctx.db, { dia: DIA, serie: "Recife" })).total,
    ).toBe(1);
    expect(
      (await listarMovimentacoes(ctx.db, { dia: DIA, serie: "Camaçari" })).total,
    ).toBe(0);
    // O que não existe devolve nada — nunca "sem filtro".
    expect(
      (await listarMovimentacoes(ctx.db, { dia: DIA, serie: "Belém" })).total,
    ).toBe(0);
  });

  /*
    O número que a régua escreve na posição é o tamanho do arquivo daquele dia,
    e o tamanho do dia não é a soma dos envios: uma unidade que reenvia mandou a
    mesma fila duas vezes. É a regra de `resumoDoDia`, e este teste existe
    porque a régua a implementa numa consulta própria — duas implementações da
    mesma regra são duas chances de ela divergir.
  */
  it("a régua escreve o tamanho do arquivo, e o reenvio não conta duas vezes", async () => {
    await processarEnvioDeChamados(
      ctx.db,
      await enviar(
        [
          { externalId: "Recife-1", unidade: "Recife", prazo: "2026-09-30" },
          { externalId: "Recife-2", unidade: "Recife" },
          { externalId: "Recife-3", unidade: "Recife" },
        ],
        { recebidoEm: as(DIA, 17), filename: "Chamados_Recife.xlsx" },
      ),
    );

    const porDia = new Map(
      (await reguaDeDias(ctx.db, { de: ONTEM, ate: DIA })).map((d) => [d.dia, d]),
    );
    // Ontem: um envio de cada unidade — as duas séries somam.
    expect(porDia.get(ONTEM)!.chamadosNoEnvio).toBe(4);
    // Hoje: dois envios da mesma unidade. Vale o último, e não a soma.
    expect(porDia.get(DIA)!.chamadosNoEnvio).toBe(3);

    // E, recortada por série, a régua diz o mesmo que o resumo daquele dia.
    const [comRecorte] = await reguaDeDias(ctx.db, {
      de: DIA,
      ate: DIA,
      serie: "Recife",
    });
    expect(comRecorte!.chamadosNoEnvio).toBe(
      (await resumoDoDia(ctx.db, { dia: DIA, serie: "Recife" })).chamadosNoEnvio,
    );
  });

  it("as séries aparecem para o seletor da tela", async () => {
    const series = await seriesDisponiveis(ctx.db);
    expect(series.map((s) => s.serie).sort()).toEqual(["Camaçari", "Recife"]);
  });
});

describe("T12–T15 · a revisão", () => {
  let movimentacaoId: string;

  beforeEach(async () => {
    await processarEnvioDeChamados(
      ctx.db,
      await enviar([{ externalId: "CH-1", prazo: "2026-09-10" }], {
        recebidoEm: as(ONTEM, 8),
      }),
    );
    await processarEnvioDeChamados(
      ctx.db,
      await enviar([{ externalId: "CH-1", prazo: "2026-09-20" }], {
        recebidoEm: as(DIA, 8),
      }),
    );
    movimentacaoId = (await movimentacoesDo())[0]!.id;
  });

  it("a importação nunca marca nada como revisado", async () => {
    const { rows } = await ctx.db.execute<{ n: string }>(
      sql`SELECT count(*) AS n FROM ticket_movement_review`,
    );
    expect(Number(rows[0]!.n)).toBe(0);
    expect((await resumoDoDia(ctx.db, { dia: DIA })).pendentes).toBe(1);
  });

  it("revisar baixa o pendente e grava quem e quando", async () => {
    await registrarRevisao(ctx.db, {
      movementId: movimentacaoId,
      revisor: { userId: null, email: "gestor@empresa.com" },
    });

    const resumo = await resumoDoDia(ctx.db, { dia: DIA });
    expect(resumo.revisadas).toBe(1);
    expect(resumo.pendentes).toBe(0);
    expect(resumo.estado).toBe("REVISADO");

    const mov = (await movimentacoesDo())[0]!;
    expect(mov.revisada).toBe(true);
    expect(mov.revisadaPor).toBe("gestor@empresa.com");
  });

  it("revisar duas vezes a mesma versão é um não-evento", async () => {
    const revisor = { userId: null, email: "gestor@empresa.com" };
    await registrarRevisao(ctx.db, { movementId: movimentacaoId, revisor });
    await registrarRevisao(ctx.db, { movementId: movimentacaoId, revisor });
    // Contar linhas de revisão em vez de existência faria o painel passar de 100%.
    expect((await resumoDoDia(ctx.db, { dia: DIA })).revisadas).toBe(1);
  });

  it("outra pessoa vê o dia como revisado — a revisão é da instalação", async () => {
    await registrarRevisao(ctx.db, {
      movementId: movimentacaoId,
      revisor: { userId: null, email: "primeiro@empresa.com" },
    });
    // Não há segunda fila: quem abre depois vê o trabalho já feito.
    const mov = (await movimentacoesDo())[0]!;
    expect(mov.revisada).toBe(true);
    expect(mov.revisadaPor).toBe("primeiro@empresa.com");
  });

  it("desfazer devolve a movimentação para a fila", async () => {
    await registrarRevisao(ctx.db, {
      movementId: movimentacaoId,
      revisor: { userId: null, email: "gestor@empresa.com" },
    });
    await desfazerRevisao(ctx.db, movimentacaoId);
    expect((await resumoDoDia(ctx.db, { dia: DIA })).pendentes).toBe(1);
  });

  it("recalcular sem mudança preserva a revisão", async () => {
    await registrarRevisao(ctx.db, {
      movementId: movimentacaoId,
      revisor: { userId: null, email: "gestor@empresa.com" },
    });
    // O mesmo dia recalculado — é o que todo envio novo faz. Se a revisão não
    // sobrevivesse a isto, "fechar o dia" seria impossível num dia com três
    // importações.
    await recalcularSerie(ctx.db, "Recife");
    expect((await resumoDoDia(ctx.db, { dia: DIA })).revisadas).toBe(1);
  });

  it("T13 · uma importação que muda a movimentação devolve-a para pendente", async () => {
    await registrarRevisao(ctx.db, {
      movementId: movimentacaoId,
      revisor: { userId: null, email: "gestor@empresa.com" },
    });
    expect((await resumoDoDia(ctx.db, { dia: DIA })).pendentes).toBe(0);

    await processarEnvioDeChamados(
      ctx.db,
      await enviar([{ externalId: "CH-1", prazo: "2026-09-25" }], {
        recebidoEm: as(DIA, 17),
      }),
    );

    const resumo = await resumoDoDia(ctx.db, { dia: DIA });
    expect(resumo.pendentes).toBe(1);
    const mov = (await movimentacoesDo())[0]!;
    expect(mov.revisada).toBe(false);
    expect(mov.revisao).toBe(2);
    // O saldo do dia é A→D: 10 → 25, e não 20 → 25.
    expect(mov.diferencas[0]).toMatchObject({ antes: "2026-09-10", depois: "2026-09-25" });
  });

  it("o lote recusa o que mudou desde que a lista carregou", async () => {
    const r = await revisarEmLote(ctx.db, {
      ids: [movimentacaoId, "00000000-0000-0000-0000-000000000000"],
      revisor: { userId: null, email: "gestor@empresa.com" },
    });
    expect(r.revisadas).toEqual([movimentacaoId]);
    expect(r.recusadas).toHaveLength(1);
  });
});

describe("T17/T18 · dia sem importação, e importação com falha", () => {
  it("dia sem importação não é dia sem movimentação", async () => {
    const regua = await reguaDeDias(ctx.db, { de: DIA, ate: DIA });
    expect(regua[0]!.estado).toBe("SEM_IMPORTACAO");
    expect((await resumoDoDia(ctx.db, { dia: DIA })).estado).toBe("SEM_IMPORTACAO");
  });

  it("um envio que falhou não entra em conta nenhuma, e aparece como aviso", async () => {
    await processarEnvioDeChamados(
      ctx.db,
      await enviar([{ externalId: "CH-1" }], { recebidoEm: as(ONTEM, 8) }),
    );
    const quebrado = await enviar([], { recebidoEm: as(DIA, 8), status: "FAILED" });
    const r = await processarEnvioDeChamados(ctx.db, quebrado);

    expect(r.tipo).toBe("IGNORADO");
    expect(await movimentacoesDo()).toHaveLength(0);

    const resumo = await resumoDoDia(ctx.db, { dia: DIA });
    expect(resumo.movimentacoes).toBe(0);
    expect(resumo.avisos.map((a) => a.tipo)).toContain("IMPORTACAO_COM_FALHA");
  });
});

describe("T19 · excluir um envio do meio da cadeia", () => {
  it("recalcular a série devolve o dia coerente, sem movimentação órfã", async () => {
    await processarEnvioDeChamados(
      ctx.db,
      await enviar([{ externalId: "CH-1", prazo: "2026-09-10" }], { recebidoEm: as(ONTEM, 8) }),
    );
    const meio = await enviar([{ externalId: "CH-1", prazo: "2026-09-15" }], {
      recebidoEm: as(DIA, 8),
    });
    await processarEnvioDeChamados(ctx.db, meio);
    await processarEnvioDeChamados(
      ctx.db,
      await enviar([{ externalId: "CH-1", prazo: "2026-09-20" }], { recebidoEm: as(DIA, 17) }),
    );

    await ctx.db.execute(sql`DELETE FROM ticket_change WHERE ticket_import_id = ${meio}::uuid`);
    await ctx.db.execute(sql`DELETE FROM ticket WHERE ticket_import_id = ${meio}::uuid`);
    await ctx.db.execute(sql`DELETE FROM ticket_import WHERE id = ${meio}::uuid`);
    await recalcularSerie(ctx.db, "Recife");

    const movs = await movimentacoesDo();
    expect(movs).toHaveLength(1);
    expect(movs[0]!.passos).toBe(1);
    expect(movs[0]!.diferencas[0]).toMatchObject({ antes: "2026-09-10", depois: "2026-09-20" });

    const { rows } = await ctx.db.execute<{ n: string }>(sql`
      SELECT count(*) AS n FROM ticket_movement_day m
       WHERE NOT EXISTS (SELECT 1 FROM ticket_import i WHERE i.id = m.ultimo_import_id)`);
    expect(Number(rows[0]!.n)).toBe(0);
  });
});

describe("T20/T21 · a régua, a paginação e os contadores", () => {
  beforeEach(async () => {
    const base = Array.from({ length: 12 }, (_, i) => ({ externalId: `CH-${i + 1}` }));
    await processarEnvioDeChamados(
      ctx.db,
      await enviar(base, { recebidoEm: as(ONTEM, 8) }),
    );
    await processarEnvioDeChamados(
      ctx.db,
      await enviar(
        base.map((c, i) => ({ ...c, prazo: i < 7 ? "2026-09-30" : undefined })),
        { recebidoEm: as(DIA, 8) },
      ),
    );
  });

  it("a paginação é estável: nenhuma linha repetida, nenhuma perdida", async () => {
    const p1 = await listarMovimentacoes(ctx.db, { dia: DIA, filtros: { limit: 3, offset: 0 } });
    const p2 = await listarMovimentacoes(ctx.db, { dia: DIA, filtros: { limit: 3, offset: 3 } });
    const p3 = await listarMovimentacoes(ctx.db, { dia: DIA, filtros: { limit: 3, offset: 6 } });

    expect(p1.total).toBe(7);
    const ids = [...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.id);
    expect(new Set(ids).size).toBe(7);
  });

  it("cada aba devolve exatamente o número do seu chip", async () => {
    const resumo = await resumoDoDia(ctx.db, { dia: DIA });
    for (const [aba, esperado] of [
      ["TODOS", resumo.movimentacoes],
      ["ALTERADOS", resumo.alterados],
      ["NOVOS", resumo.novos],
      ["ENCERRADOS", resumo.encerrados],
      ["REMOVIDOS", resumo.removidos],
      ["NAO_REVISADOS", resumo.pendentes],
      ["CRITICOS", resumo.pontosDeAtencao.criticos],
    ] as const) {
      const { total } = await listarMovimentacoes(ctx.db, {
        dia: DIA,
        filtros: { aba: aba as never },
      });
      expect(total, `aba ${aba}`).toBe(esperado);
    }
  });

  it("a régua marca o dia com pendência e o dia sem envio", async () => {
    const regua = await reguaDeDias(ctx.db, { de: "2026-08-31", ate: DIA });
    const porDia = new Map(regua.map((d) => [d.dia, d]));

    expect(porDia.get("2026-08-31")!.estado).toBe("SEM_IMPORTACAO");
    expect(porDia.get(ONTEM)!.estado).toBe("PRIMEIRA_CARGA");
    expect(porDia.get(DIA)!.estado).toBe("PENDENTE");
    expect(porDia.get(DIA)!.pendentes).toBe(7);
  });
});

describe("D10-C · um export truncado não vira 3.000 pendências", () => {
  it("acima do limiar os desaparecimentos são contados e não publicados", async () => {
    const dez = Array.from({ length: 10 }, (_, i) => ({ externalId: `CH-${i + 1}` }));
    await processarEnvioDeChamados(
      ctx.db,
      await enviar(dez, { recebidoEm: as(ONTEM, 8) }),
    );
    // Metade das linhas: encolhimento de 50%, acima dos 30% do limiar.
    const r = await processarEnvioDeChamados(
      ctx.db,
      await enviar(dez.slice(0, 5), { recebidoEm: as(DIA, 8) }),
    );

    expect(r.removidosSuprimidos).toBe(5);
    expect((await movimentacoesDo()).filter((m) => m.classe === "REMOVIDO")).toHaveLength(0);

    // Suprimir em silêncio seria a omissão que o produto recusa: o número e o
    // motivo aparecem como aviso do dia.
    const resumo = await resumoDoDia(ctx.db, { dia: DIA });
    expect(resumo.avisos.map((a) => a.tipo)).toContain("REMOVIDOS_SUPRIMIDOS");
    expect(resumo.avisos.find((a) => a.tipo === "REMOVIDOS_SUPRIMIDOS")!.texto).toContain("30%");
  });

  it("abaixo do limiar, o desaparecimento é publicado como movimentação", async () => {
    const dez = Array.from({ length: 10 }, (_, i) => ({ externalId: `CH-${i + 1}` }));
    await processarEnvioDeChamados(
      ctx.db,
      await enviar(dez, { recebidoEm: as(ONTEM, 8) }),
    );
    const r = await processarEnvioDeChamados(
      ctx.db,
      await enviar(dez.slice(0, 8), { recebidoEm: as(DIA, 8) }),
    );

    expect(r.removidosSuprimidos).toBe(0);
    expect((await movimentacoesDo()).filter((m) => m.classe === "REMOVIDO")).toHaveLength(2);
  });
});

describe("D2-B · a criticidade é derivada, e diz que é", () => {
  it("prazo vencido com chamado aberto vira crítico e atrasado", async () => {
    await processarEnvioDeChamados(
      ctx.db,
      await enviar([{ externalId: "CH-1", prazo: "2026-08-20" }], { recebidoEm: as(ONTEM, 8) }),
    );
    await processarEnvioDeChamados(
      ctx.db,
      await enviar([{ externalId: "CH-1", prazo: "2026-08-25", aprovador: "Outro" }], {
        recebidoEm: as(DIA, 8),
      }),
    );

    const mov = (await movimentacoesDo())[0]!;
    expect(mov.atrasado).toBe(true);
    expect(mov.criticidade).toBe("CRITICO");
    expect(mov.criticidadeOrigem).toBe("DERIVADA");
    expect(mov.criticidadeMotivo).toContain("2026-08-25");
  });

  it("chamado encerrado não fica atrasado, mesmo com prazo vencido", async () => {
    await processarEnvioDeChamados(
      ctx.db,
      await enviar([{ externalId: "CH-1", prazo: "2026-08-20" }], { recebidoEm: as(ONTEM, 8) }),
    );
    await processarEnvioDeChamados(
      ctx.db,
      await enviar(
        [
          {
            externalId: "CH-1",
            prazo: "2026-08-20",
            statusBucket: "ATENDIDO",
            status: "Concluído",
          },
        ],
        { recebidoEm: as(DIA, 8) },
      ),
    );

    const mov = (await movimentacoesDo())[0]!;
    expect(mov.classe).toBe("ENCERRADO");
    expect(mov.atrasado).toBe(false);
    expect(mov.criticidade).toBe("NORMAL");
  });
});
