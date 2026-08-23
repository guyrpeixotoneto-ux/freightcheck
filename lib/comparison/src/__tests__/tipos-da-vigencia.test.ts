import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import { criarBancoComExportRealPromovido, type TestDb } from "@workspace/ingest/testing";
import { escreverPlanilha } from "@workspace/ingest/testing/planilha";
import { getGroupedView } from "../grouped";
import { composicaoDaVigencia, contagensPorVigencia } from "../tipos-da-vigencia";
import { listContexts, resolveContext } from "../series";

/**
 * O eixo "o quê", provado sobre o export real — e a decisão que veio depois.
 *
 * ---------------------------------------------------------------------------
 * A primeira metade: expor o que existia
 * ---------------------------------------------------------------------------
 * Uma planilha de TRECHO entrou declarando `EMPURRADA_2_8_2026`, que o parser lê
 * como **2026-08-02**. O acervo já tinha `EMPURRADA_1_8_2026` — 2026-08-01, com
 * 62 cavalos e 71 carretas. O pipeline se comportou como devia: identidade
 * canônica intacta, nada apagado, nada herdado errado. A tela é que lia como
 * sumiço, porque usava **vigência** para responder o que é pergunta de **tipo**
 * — o eixo que `composicaoDaVigencia`/`contagensPorVigencia` (abaixo) apura.
 *
 * ---------------------------------------------------------------------------
 * A segunda metade: a casca não é uma vigência
 * ---------------------------------------------------------------------------
 * Depois de expor o eixo, a decisão de produto foi mais adiante: uma vigência
 * que só tem trecho — sem cavalo, sem carreta — não é uma **entrega própria**.
 * Ela é uma casca (`entity_type_set = 'TRECHO'`), e normalmente trecho chega
 * fundido à vigência de equipamento da mesma data; chegar sozinho é o caso
 * anômalo que este arquivo também cobre. `naoEhSoTrecho` (`series.ts`) tira
 * essa casca de tudo que lista "quando": `listContexts`, `listPeriods`, e por
 * herança `getGroupedView`. O efeito, visível nas duas telas do relato:
 *
 * - o Resumo executivo volta a abrir na vigência do equipamento — a casca não
 *   disputa mais "mais recente" com ela;
 * - agosto volta a ter **um** rótulo — "agosto/2026" —, porque só há uma
 *   entrega própria nesse mês; a desambiguação por quinzena/dia continua de
 *   pé para quando duas entregas *de verdade* caem no mesmo mês.
 *
 * **O que não muda:** o trecho continua no banco, com os mesmos três fatos, na
 * mesma vigência 2026-08-02, na mesma família de dataset. `composicaoDaVigencia`
 * e `contagensPorVigencia` não usam `naoEhSoTrecho` — respondem "o que existe
 * nesta data" diretamente dos fatos, e uma casca de trecho existe. O que muda é
 * só a navegação geral: essa data deixa de ser uma opção nos seletores de
 * vigência e deixa de ser alcançável por `getGroupedView` sem um caminho que já
 * a conheça.
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

/** A vigência do equipamento e a casca de trecho, como o relato as produziu. */
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

  /**
   * 3. A vigência nova, só com trecho — intacta no banco. Ela deixou de contar
   * como vigência de navegação (ver as duas próximas describe), mas os fatos
   * dela continuam lá, e o equipamento da vigência anterior não foi tocado.
   */
  it("grava o trecho de outra data como snapshot próprio, sem tocar no equipamento", async () => {
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
   * por isso o eixo de análise é **tipo**, e a navegação exclui só a casca
   * autônoma, não a família inteira.
   */
  it("mantém trecho e equipamento na mesma família e na mesma unidade", async () => {
    const { rows } = await ctx.db.execute<{ dataset_family: string; scope_hash: string }>(sql`
      SELECT DISTINCT s.dataset_family, s.scope_hash
        FROM snapshot s WHERE s.status <> 'SUPERSEDED'`);

    expect(rows.map((r) => r.dataset_family)).toEqual(["REMUNERACAO_EQUIPAMENTO"]);
    expect(new Set(rows.map((r) => r.scope_hash)).size).toBe(1);

    // A unidade continua uma só no seletor — ver o describe seguinte para o
    // que muda em `periodosDisponiveis`.
    const contextos = await listContexts(ctx.db);
    expect(contextos).toHaveLength(1);
  });
});

describe("a casca de trecho sozinho não conta como vigência de navegação", () => {
  /**
   * `listContexts` volta a apontar o equipamento como a vigência mais recente
   * — a casca não disputa mais esse posto. `periods` (a contagem) reflete as
   * nove entregas reais, sem a décima artificial.
   */
  it("não deixa a casca virar 'vigência mais recente' do contexto", async () => {
    const [contexto] = await listContexts(ctx.db);

    expect(contexto.latestPeriod).toBe(EQUIPAMENTO);
    expect(contexto.periodosDisponiveis).not.toContain(SO_TRECHO);
    expect(contexto.periodosDisponiveis[contexto.periodosDisponiveis.length - 1]).toBe(
      EQUIPAMENTO,
    );
    expect(contexto.periods).toBe(9);
  });

  /**
   * E o Resumo executivo — que abre sem `period` pedido, no contexto padrão —
   * volta a abrir no equipamento, com a frota inteira, e não numa vigência
   * zerada.
   */
  it("faz a leitura padrão (sem vigência pedida) abrir no equipamento", async () => {
    const view = await getGroupedView(ctx.db);

    expect(view!.period).toBe(EQUIPAMENTO);
    expect(view!.series.find((s) => s.entityTypeSet === "CAVALO")!.fleet).toBe(62);
  });

  /**
   * A casca fica **inalcançável** por este caminho: pedir explicitamente
   * `period: SO_TRECHO` não encontra vigência — não é um 500, é a resposta
   * honesta de "isto não é uma vigência que a navegação conhece".
   */
  it("não abre a casca mesmo quando pedida explicitamente pela data", async () => {
    const view = await getGroupedView(ctx.db, SO_TRECHO);
    expect(view).toBeNull();
  });

  /**
   * Agosto volta a ter **um** rótulo — a desambiguação por quinzena/dia só
   * aparece quando duas entregas de verdade caem no mesmo mês, e agora só há
   * uma.
   */
  it("devolve agosto a um rótulo só, sem a casca ao lado", async () => {
    const view = await getGroupedView(ctx.db);
    const rotulos = view!.periods.map((p) => p.label);

    expect(rotulos).not.toContain(SO_TRECHO);
    expect(view!.periods.find((p) => p.date === EQUIPAMENTO)!.label).toBe("agosto/2026");
    expect(new Set(rotulos).size).toBe(rotulos.length);
  });

  /** O seletor de vigência não oferece a casca como opção. */
  it("não lista a casca entre as vigências do seletor", async () => {
    const view = await getGroupedView(ctx.db);
    const datas = view!.periods.map((p) => p.date);

    expect(datas).not.toContain(SO_TRECHO);
    expect(datas).toContain(EQUIPAMENTO);
    expect(datas).toHaveLength(9);
  });
});

describe("a composição de uma vigência continua correta, mesmo para a casca", () => {
  /**
   * `composicaoDaVigencia`/`contagensPorVigencia` não usam `naoEhSoTrecho` —
   * respondem "o que existe nesta data" a partir dos fatos, e por isso
   * continuam vendo a casca. São a base do eixo Tipo dentro de uma vigência
   * navegável; não são elas que decidem se uma data é "uma vigência".
   */
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

    // Chamada direta, com uma data que não está mais em c.periodosDisponiveis:
    // a função ainda responde, porque ela lê fato, não lista de navegação.
    const trecho = await composicaoDaVigencia(ctx.db, c, SO_TRECHO, c.periodosDisponiveis);
    expect(trecho.presentes.map((t) => [t.code, t.entidades])).toEqual([["TRECHO", 3]]);
  });

  /**
   * A ausência de Cavalo na casca ainda aponta para o equipamento — e agora com
   * o rótulo do mês inteiro, já que a casca não desambigua mais agosto.
   */
  it("aponta a última vigência com o tipo, com o rótulo já sem a casca ao lado", async () => {
    const c = await contexto();
    const composicao = await composicaoDaVigencia(ctx.db, c, SO_TRECHO, c.periodosDisponiveis);

    const cavalo = composicao.tipos.find((t) => t.code === "CAVALO")!;
    expect(cavalo.presente).toBe(false);
    expect(cavalo.entidades).toBe(0);
    expect(cavalo.ultimaVigenciaComDado).toEqual({
      date: EQUIPAMENTO,
      label: "agosto/2026",
      entidades: 62,
    });
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

    // As nove entregas navegáveis, mais a casca, pedida direto pela data — as
    // duas formas de chamar são leitura pura.
    for (const period of [...c.periodosDisponiveis, SO_TRECHO]) {
      await composicaoDaVigencia(ctx.db, c, period, c.periodosDisponiveis);
    }

    expect(await fatosPorTipo()).toEqual(antes);
  });

  /**
   * `contagensPorVigencia` é a apuração bruta, por `scope_hash`+canal — sem a
   * exclusão de `naoEhSoTrecho`, que é regra de navegação e não de dado. A
   * casca aparece aqui como o que ela é: uma data com três trechos.
   */
  it("apura o histórico inteiro numa leitura, casca incluída", async () => {
    const contagens = await contagensPorVigencia(ctx.db, await contexto());

    expect(contagens.size).toBe(10);
    expect(contagens.get(EQUIPAMENTO)!.get("CONJUNTO")).toBe(62);
    expect(contagens.get(SO_TRECHO)!.get("TRECHO")).toBe(3);
    expect(contagens.get(SO_TRECHO)!.get("CAVALO")).toBeUndefined();
  });
});
