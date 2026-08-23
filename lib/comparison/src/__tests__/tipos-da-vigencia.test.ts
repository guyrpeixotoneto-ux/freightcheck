import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import { criarBancoComExportRealPromovido, type TestDb } from "@workspace/ingest/testing";
import { escreverPlanilha } from "@workspace/ingest/testing/planilha";
import { getGroupedView } from "../grouped";
import { composicaoDaVigencia, contagensPorVigencia } from "../tipos-da-vigencia";
import { listContexts, resolveContext } from "../series";
import { rotuloDaVigencia } from "../labels";

/**
 * O eixo "o quê", provado sobre o export real.
 *
 * ---------------------------------------------------------------------------
 * O que aconteceu, e por que estes testes existem
 * ---------------------------------------------------------------------------
 * Uma planilha de TRECHO entrou declarando `EMPURRADA_2_8_2026`, que o parser lê
 * como **2026-08-02**. O acervo já tinha `EMPURRADA_1_8_2026` — 2026-08-01, com
 * 62 cavalos e 71 carretas. O pipeline se comportou como devia: identidade
 * canônica intacta, nada apagado, nada herdado errado. E mesmo assim a tela leu
 * como sumiço:
 *
 * - a vigência nova, só com trecho, virou a mais recente do contexto;
 * - a tela abre na mais recente, e mostrou zero veículo e zero alteração;
 * - as duas vigências de agosto se chamavam **"agosto/2026"** no seletor, de
 *   modo que nem trocando de opção era possível saber qual era qual.
 *
 * Nenhuma dessas três coisas é defeito de ingestão, e por isso nenhuma se
 * conserta lá. As três são a mesma falta: a tela usava **vigência** para
 * responder o que é pergunta de **tipo**.
 *
 * A base aqui é o acervo real — nove vigências de CAMAÇARI/EMPURRADA, cavalo e
 * carreta em cada uma — e não uma fixture sintética, porque metade do que estes
 * testes precisam provar é que o dado do cliente continua onde estava.
 */

let ctx: TestDb;

/**
 * O arquivo do começo ao fim, como o operador o manda: declarando o tipo na aba
 * da tela e confirmando o equipamento novo que a pré-visualização apontar.
 *
 * `confirmNewEntityTypes` é o portão real do produto — um equipamento que o
 * banco ainda não conhece não entra sem alguém dizer que é para entrar —, e
 * passá-lo a partir do que a própria `preview` apontou é o que se faz na tela.
 */
async function importar(arquivo: string, declaredType: string) {
  const recebido = await receiveFile(ctx.db, { filePath: arquivo, declaredType });
  await captureRaw(ctx.db, recebido.importRunId);
  await stage(ctx.db, recebido.importRunId);
  const relatorio = await preview(ctx.db, recebido.importRunId);
  return promote(ctx.db, recebido.importRunId, {
    confirmNewEntityTypes: relatorio.pendingIdentities,
  });
}

/**
 * O escopo do export real — repetido aqui porque é o que faz o arquivo novo
 * cair na **mesma unidade**.
 *
 * `scope_hash` é montado com o código como a planilha o escreve, e não com o
 * CNPJ normalizado: um trecho escrito `07.526.557/0015-05` seria outra unidade
 * na tela, com outra fileira de vigências, e o teste provaria outra coisa.
 */
const ESCOPO_REAL = {
  unidadeCnpj: "07526557001505_CERV",
  unidadeNome: "CAMAÇARI",
  regional: "Geo NE",
  operadorCnpj: "20618821000799",
  operadorNome: "OPERALOG",
};

const trechos = (vigencia: string, chaves: string[]) =>
  escreverPlanilha({
    vigencia,
    ...ESCOPO_REAL,
    abas: [
      {
        nome: "Sheet1",
        identificador: "chaveTrecho",
        linhas: chaves.map((placa) => ({ placa })),
      },
    ],
  });

/** O que existe no banco, por vigência e tipo — a prova de que nada sumiu. */
async function fatosPorTipo() {
  const { rows } = await ctx.db.execute<{
    vigencia: string;
    entity_type: string;
    entidades: number;
    fatos: number;
  }>(sql`
    SELECT s.effective_date::text AS vigencia, e.entity_type,
           count(DISTINCT e.id)::int AS entidades, count(*)::int AS fatos
      FROM snapshot s
      JOIN fact f   ON f.snapshot_id = s.id
      JOIN entity e ON e.id = f.entity_id
     WHERE s.status <> 'SUPERSEDED'
     GROUP BY 1, 2
     ORDER BY 1, 2`);
  return rows;
}

async function contexto() {
  const resolvido = await resolveContext(ctx.db);
  if (!resolvido) throw new Error("nenhum contexto — a fixture não importou nada");
  return resolvido;
}

/** A vigência do equipamento e a do trecho, como o relato as produziu. */
const EQUIPAMENTO = "2026-08-01";
const SO_TRECHO = "2026-08-02";

beforeAll(async () => {
  ctx = await criarBancoComExportRealPromovido("tipos_da_vigencia");
  await importar(trechos("EMPURRADA_2_8_2026", ["T1", "T2", "T3"]), "TRECHO");
}, 900_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("a ingestão continua fazendo o que fazia", () => {
  /**
   * 1 e 2. Cavalo e carreta na mesma vigência, e o trecho que chega depois não
   * apaga nenhum dos dois. É a garantia sobre a qual todo o resto se apoia: se a
   * fusão apagasse, a tela estaria certa em mostrar vazio.
   */
  it("mantém cavalo e carreta na vigência de equipamento, sem perder nem duplicar", async () => {
    const em0108 = (await fatosPorTipo()).filter((r) => r.vigencia === EQUIPAMENTO);

    expect(em0108.map((r) => r.entity_type)).toEqual(["CARRETA", "CAVALO"]);
    expect(em0108.find((r) => r.entity_type === "CAVALO")!.entidades).toBe(62);
    expect(em0108.find((r) => r.entity_type === "CARRETA")!.entidades).toBe(71);

    // Uma vigência ativa por identidade: nada duplicou ao lado.
    const { rows } = await ctx.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM snapshot
       WHERE status <> 'SUPERSEDED' AND effective_date = ${EQUIPAMENTO}::date`);
    expect(rows[0].n).toBe(1);
  });

  /** 3. A vigência nova, só com trecho — e o equipamento intacto na anterior. */
  it("abre vigência nova para o trecho de outra data, sem tocar na anterior", async () => {
    const porTipo = await fatosPorTipo();

    expect(porTipo.filter((r) => r.vigencia === SO_TRECHO)).toEqual([
      expect.objectContaining({ entity_type: "TRECHO", entidades: 3 }),
    ]);
    expect(
      porTipo.filter((r) => r.vigencia === EQUIPAMENTO).map((r) => r.entity_type),
    ).toEqual(["CARRETA", "CAVALO"]);
  });

  /**
   * 10. A leitura que depende de trecho **e** equipamento continua possível.
   *
   * O que garante isso não é uma asserção de tela: é o trecho continuar na mesma
   * família de dataset e no mesmo contexto do equipamento, que é o que faz os
   * dois caberem na mesma identidade canônica quando a data é a mesma. Separar
   * TRECHO em família própria arrumaria o seletor e quebraria a remuneração —
   * por isso o eixo novo é **tipo**, e não família.
   */
  it("mantém trecho e equipamento na mesma família e na mesma unidade", async () => {
    const { rows } = await ctx.db.execute<{ dataset_family: string; scope_hash: string }>(sql`
      SELECT DISTINCT s.dataset_family, s.scope_hash
        FROM snapshot s WHERE s.status <> 'SUPERSEDED'`);

    expect(rows.map((r) => r.dataset_family)).toEqual(["REMUNERACAO_EQUIPAMENTO"]);
    expect(new Set(rows.map((r) => r.scope_hash)).size).toBe(1);

    // E a unidade não se partiu em duas no seletor.
    const contextos = await listContexts(ctx.db);
    expect(contextos).toHaveLength(1);
    expect(contextos[0].periodosDisponiveis.slice(-2)).toEqual([EQUIPAMENTO, SO_TRECHO]);
  });
});

describe("a composição de cada vigência", () => {
  /** 4 e 8. O que existe é lido do banco, e "Todos" é a composição real. */
  it("conta cavalo, carreta, conjunto e trecho onde eles estão", async () => {
    const c = await contexto();

    const equipamento = await composicaoDaVigencia(ctx.db, c, EQUIPAMENTO, c.periodosDisponiveis);
    expect(equipamento.presentes.map((t) => [t.code, t.entidades])).toEqual([
      ["CAVALO", 62],
      ["CARRETA", 71],
      // O conjunto não é importado: são os pares que o vínculo daquela vigência
      // declara, e por isso ele acompanha o cavalo e não a carreta.
      ["CONJUNTO", 62],
    ]);
    expect(equipamento.vazia).toBe(false);

    const trecho = await composicaoDaVigencia(ctx.db, c, SO_TRECHO, c.periodosDisponiveis);
    expect(trecho.presentes.map((t) => [t.code, t.entidades])).toEqual([["TRECHO", 3]]);
  });

  /**
   * 5 e 6. Escolher Cavalo numa vigência que só tem trecho não produz zero: dá
   * ausência **com endereço** — e o endereço é uma vigência que continua
   * acessível, com o dado lá.
   */
  it("aponta a última vigência com o tipo, em vez de mostrar zero", async () => {
    const c = await contexto();
    const composicao = await composicaoDaVigencia(ctx.db, c, SO_TRECHO, c.periodosDisponiveis);

    const cavalo = composicao.tipos.find((t) => t.code === "CAVALO")!;
    expect(cavalo.presente).toBe(false);
    expect(cavalo.entidades).toBe(0);
    expect(cavalo.ultimaVigenciaComDado).toEqual({
      date: EQUIPAMENTO,
      label: "01/08/2026",
      entidades: 62,
    });

    // E a vigência apontada de fato abre, com os 62 cavalos lá.
    const anterior = await getGroupedView(ctx.db, EQUIPAMENTO);
    expect(anterior!.composicao.presentes.find((t) => t.code === "CAVALO")!.entidades).toBe(62);
  });

  /**
   * O tipo que nunca chegou não ganha endereço inventado.
   *
   * "Nunca foi importado aqui" e "está na vigência tal" pedem coisas diferentes
   * — uma é pedido de arquivo, a outra é um clique —, e a diferença entre as
   * duas é este `null`.
   */
  it("não inventa vigência para um tipo que nunca existiu no contexto", async () => {
    const c = await contexto();
    const composicao = await composicaoDaVigencia(ctx.db, c, SO_TRECHO, c.periodosDisponiveis);

    const qlp = composicao.tipos.find((t) => t.code === "QLP_ADMINISTRATIVO")!;
    expect(qlp.presente).toBe(false);
    expect(qlp.ultimaVigenciaComDado).toBeNull();
  });

  /** A ausência olha para trás, e não para a frente. */
  it("não manda para uma vigência posterior à aberta", async () => {
    const c = await contexto();
    const composicao = await composicaoDaVigencia(ctx.db, c, EQUIPAMENTO, c.periodosDisponiveis);

    const trecho = composicao.tipos.find((t) => t.code === "TRECHO")!;
    expect(trecho.presente).toBe(false);
    // O trecho existe — em 02/08, que é **depois**. Mandar para lá responderia
    // outra pergunta, sobre outro período.
    expect(trecho.ultimaVigenciaComDado).toBeNull();
  });

  /** 9. Trocar de tipo é leitura: não escreve, não reprocessa, não move dado. */
  it("ler a composição não altera nada no banco", async () => {
    const antes = await fatosPorTipo();
    const c = await contexto();

    for (const period of c.periodosDisponiveis) {
      await composicaoDaVigencia(ctx.db, c, period, c.periodosDisponiveis);
    }

    expect(await fatosPorTipo()).toEqual(antes);
  });
});

describe("o contrato que a tela consome", () => {
  /** 7. Duas vigências do mesmo mês nunca saem com o mesmo rótulo. */
  it("dá rótulos distinguíveis às duas vigências de agosto", async () => {
    const view = await getGroupedView(ctx.db);
    const rotulos = view!.periods.map((p) => p.label);

    expect(rotulos.slice(0, 2)).toEqual(["02/08/2026", "01/08/2026"]);
    expect(new Set(rotulos).size).toBe(rotulos.length);
    // E o mês com uma entrega só continua sendo o mês: a ordinal e o dia só
    // aparecem onde o dado os sustenta.
    expect(rotulos).toContain("julho/2026");
  });

  /** O seletor diz o que cada vigência tem, sem uma chamada por vigência. */
  it("leva os tipos de cada vigência junto com a opção do seletor", async () => {
    const view = await getGroupedView(ctx.db);
    const porData = new Map(view!.periods.map((p) => [p.date, p.tipos]));

    expect(porData.get(SO_TRECHO)!.map((t) => t.code)).toEqual(["TRECHO"]);
    expect(porData.get(EQUIPAMENTO)!.map((t) => [t.code, t.entidades])).toEqual([
      ["CAVALO", 62],
      ["CARRETA", 71],
      ["CONJUNTO", 62],
    ]);
  });

  /** A vigência aberta traz a própria composição, presentes e ausentes. */
  it("responde a composição da vigência aberta", async () => {
    const view = await getGroupedView(ctx.db, SO_TRECHO);

    expect(view!.periodLabel).toBe("02/08/2026");
    expect(view!.composicao.presentes.map((t) => t.code)).toEqual(["TRECHO"]);
    // Os seis vêm sempre — quem não está, está escrito como ausente.
    expect(view!.composicao.tipos).toHaveLength(6);
    expect(view!.composicao.tipos.filter((t) => !t.presente)).toHaveLength(5);
  });

  /**
   * A mesma vigência tem de se chamar a mesma coisa em toda parte.
   *
   * O rótulo do seletor e o da frase de ausência saem da mesma função e da mesma
   * lista de datas. Foi por discordarem — "agosto/2026" num lugar, outra coisa
   * noutro — que não se conseguia saber para onde ir.
   */
  it("escreve a vigência do mesmo jeito no seletor e na ausência", async () => {
    const c = await contexto();
    const view = await getGroupedView(ctx.db, SO_TRECHO);
    const cavalo = view!.composicao.tipos.find((t) => t.code === "CAVALO")!;

    expect(cavalo.ultimaVigenciaComDado!.label).toBe(
      rotuloDaVigencia(EQUIPAMENTO, c.periodosDisponiveis),
    );
    expect(view!.periods.find((p) => p.date === EQUIPAMENTO)!.label).toBe(
      cavalo.ultimaVigenciaComDado!.label,
    );
  });

  /** Uma consulta só serve o seletor inteiro — e é ela que a view usa. */
  it("apura o histórico inteiro numa leitura", async () => {
    const contagens = await contagensPorVigencia(ctx.db, await contexto());

    expect(contagens.size).toBe(10);
    expect(contagens.get(EQUIPAMENTO)!.get("CONJUNTO")).toBe(62);
    expect(contagens.get(SO_TRECHO)!.get("TRECHO")).toBe(3);
    expect(contagens.get(SO_TRECHO)!.get("CAVALO")).toBeUndefined();
  });
});
