import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedTaxonomy } from "@workspace/curation";
import { medirAlteracoesDoAtivo } from "@workspace/comparison";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { getRecomendacoesAoCliente } from "../motor";

/**
 * A pauta recortada num ativo — e o que o recorte **não** pode alcançar.
 *
 * A aba Cliente é lida de dois lugares. Em Alterações ela fala da frota, e é
 * disso que ela sempre falou. Dentro de `Cavalo 360° · QYP3G72` ela precisa
 * falar daquele cavalo, ou a tela promete um ativo e entrega outra coisa —
 * enquanto as outras três abas ao lado respondem pela placa.
 *
 * O que este arquivo fixa é que as duas exigências convivem, e a divisão exata
 * entre elas:
 *
 * 1. **A placa escolhe quais parâmetros são assunto.** Só entram na lista os que
 *    se moveram naquele ativo. Sem isso, a pauta do QYP3G72 seria idêntica à de
 *    qualquer outra placa da frota.
 * 2. **A placa não encolhe número nenhum.** O alcance de cada item continua
 *    sendo o da frota, porque é ele que sustenta o pedido: "caiu em 41 veículos"
 *    é pauta de reunião, e "caiu em 1" é a mesma alteração com o argumento
 *    desmontado. Este é o teste que quebra se alguém, com a melhor das intenções,
 *    passar a recalcular o panorama por placa.
 * 3. **Placa que o recorte não tem não vira lista vazia nem erro.** A leitura
 *    volta à do equipamento, e a resposta diz que voltou — `placa: null` é o que
 *    permite à tela não afirmar sobre um ativo o que apurou sobre a frota.
 * 4. **Ativo sem alteração nenhuma devolve lista vazia com a placa resolvida.**
 *    É a única forma de a tela distinguir "este cavalo não mexeu" de "esta placa
 *    não existe aqui" — duas respostas que uma lista vazia sozinha confunde.
 */

let ctx: TestDb;

const CAVALO: AttributeSpec[] = [
  {
    code: "cavalo.finame",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
  },
  {
    code: "cavalo.ipva",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "ANUAL",
    aggregation: "SUM",
    isMonetary: true,
  },
];

/*
  Três cavalos, e cada um existe para provar uma linha diferente:

  - `AAA1A11` mexeu no FINAME (junto com o BBB2B22) e não mexeu no IPVA;
  - `BBB2B22` mexeu nos dois — é ele que dá ao FINAME um alcance de dois ativos,
    que é o número que precisa sobreviver ao recorte na placa do primeiro;
  - `CCC3C33` atravessa as duas vigências inteiro, e é o ativo sobre o qual não
    há o que propor nem o que investigar.
*/
beforeAll(async () => {
  ctx = await createTestDatabase("pauta_do_ativo");
  await seedTaxonomy(ctx.db, "test");

  await buildFixture(
    ctx.db,
    CAVALO,
    [
      {
        label: "CAV_JAN",
        effectiveDate: "2026-01-01",
        data: {
          AAA1A11: { "cavalo.finame": 5000, "cavalo.ipva": 12000 },
          BBB2B22: { "cavalo.finame": 4000, "cavalo.ipva": 8000 },
          CCC3C33: { "cavalo.finame": 3000, "cavalo.ipva": 6000 },
        },
      },
      {
        label: "CAV_FEV",
        effectiveDate: "2026-02-01",
        data: {
          AAA1A11: { "cavalo.finame": 5500, "cavalo.ipva": 12000 },
          BBB2B22: { "cavalo.finame": 4400, "cavalo.ipva": 9000 },
          CCC3C33: { "cavalo.finame": 3000, "cavalo.ipva": 6000 },
        },
      },
    ],
    { entityType: "CAVALO" },
  );
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

const codigos = (r: { recomendacoes: { code: string }[] }) =>
  r.recomendacoes.map((x) => x.code).sort();

describe("a pauta recortada num ativo", () => {
  it("lista só os parâmetros que se moveram naquela placa", async () => {
    const resposta = await getRecomendacoesAoCliente(ctx.db, { placa: "AAA1A11" });
    expect(resposta).not.toBeNull();

    expect(resposta!.placa).toBe("AAA1A11");
    // O IPVA mudou na frota — mas não neste cavalo, e não é pauta dele.
    expect(codigos(resposta!)).toEqual(["cavalo.finame"]);
  });

  it("mantém o alcance de frota dentro do item — não recorta o número", async () => {
    const daFrota = await getRecomendacoesAoCliente(ctx.db, {});
    const doAtivo = await getRecomendacoesAoCliente(ctx.db, { placa: "AAA1A11" });

    const naFrota = daFrota!.recomendacoes.find((r) => r.code === "cavalo.finame")!;
    const noAtivo = doAtivo!.recomendacoes.find((r) => r.code === "cavalo.finame")!;

    /*
      Dois ativos mexeram no FINAME, e o item continua dizendo dois mesmo lido
      pela placa de um deles. É a asserção que o recorte por placa existe para
      não violar — a lista estreita, a evidência não.
    */
    expect(naFrota.veiculosAfetados).toBe(2);
    expect(noAtivo.veiculosAfetados).toBe(naFrota.veiculosAfetados);
    expect(noAtivo.impacto?.valor).toBe(naFrota.impacto?.valor);
    expect(noAtivo.oQueAconteceu?.entidades).toBe(naFrota.oQueAconteceu?.entidades);
  });

  it("placa fora do recorte volta à pauta do equipamento, e diz que voltou", async () => {
    const resposta = await getRecomendacoesAoCliente(ctx.db, { placa: "ZZZ9Z99" });

    expect(resposta!.placa).toBeNull();
    expect(codigos(resposta!)).toEqual(["cavalo.finame", "cavalo.ipva"]);
  });

  it("ativo sem alteração devolve lista vazia com a placa resolvida", async () => {
    const resposta = await getRecomendacoesAoCliente(ctx.db, { placa: "CCC3C33" });

    expect(resposta!.placa).toBe("CCC3C33");
    expect(resposta!.recomendacoes).toEqual([]);
    expect(resposta!.totais.analisadas).toBe(0);
  });

  it("a placa chega como a pessoa a digitou, e é resolvida assim mesmo", async () => {
    const resposta = await getRecomendacoesAoCliente(ctx.db, { placa: " aaa1a11 " });

    expect(resposta!.placa).toBe("AAA1A11");
    expect(codigos(resposta!)).toEqual(["cavalo.finame"]);
  });

  it("o equipamento e a placa se compõem em vez de se anularem", async () => {
    const resposta = await getRecomendacoesAoCliente(ctx.db, {
      entityType: "CAVALO",
      placa: "BBB2B22",
    });

    expect(resposta!.entityType).toBe("CAVALO");
    expect(resposta!.placa).toBe("BBB2B22");
    expect(codigos(resposta!)).toEqual(["cavalo.finame", "cavalo.ipva"]);
  });
});

/**
 * A camada do ativo dentro do item — "neste cavalo, de 5000 para 5500".
 *
 * O item traz os dois níveis ao mesmo tempo, e o que estes testes fixam é que
 * eles não se contaminam: `noAtivo` é do cavalo, e `veiculosAfetados`,
 * `impacto` e `oQueAconteceu` continuam sendo da frota, no mesmo objeto.
 *
 * A regra que mais importa está no último teste: a **avaliação não vê o ativo**.
 * Situação, confiança e pedido têm de sair iguais lidos da frota ou lidos de
 * dentro de um cavalo — se a placa aberta mudasse a decisão, duas pessoas com a
 * mesma base levariam propostas diferentes à mesma reunião.
 */
describe("o movimento do próprio ativo", () => {
  it("traz o par do cavalo, e não o da frota", async () => {
    const resposta = await getRecomendacoesAoCliente(ctx.db, { placa: "AAA1A11" });
    const finame = resposta!.recomendacoes.find((r) => r.code === "cavalo.finame")!;

    // O AAA1A11 foi de 5000 para 5500; o BBB2B22, de 4000 para 4400.
    expect(finame.noAtivo).toMatchObject({
      placa: "AAA1A11",
      antes: 5000,
      depois: 5500,
    });
    // E o alcance ao lado continua sendo o dos dois.
    expect(finame.veiculosAfetados).toBe(2);
  });

  it("cada placa lê o seu próprio par no mesmo item", async () => {
    const doOutro = await getRecomendacoesAoCliente(ctx.db, { placa: "BBB2B22" });
    const finame = doOutro!.recomendacoes.find((r) => r.code === "cavalo.finame")!;

    expect(finame.noAtivo).toMatchObject({ antes: 4000, depois: 4400 });
  });

  it("sem placa aberta, a camada do ativo não existe", async () => {
    const daFrota = await getRecomendacoesAoCliente(ctx.db, {});
    expect(daFrota!.recomendacoes.every((r) => r.noAtivo === null)).toBe(true);
  });

  it("a placa aberta não muda a avaliação do item", async () => {
    const daFrota = await getRecomendacoesAoCliente(ctx.db, {});
    const doAtivo = await getRecomendacoesAoCliente(ctx.db, { placa: "AAA1A11" });

    const naFrota = daFrota!.recomendacoes.find((r) => r.code === "cavalo.finame")!;
    const noAtivo = doAtivo!.recomendacoes.find((r) => r.code === "cavalo.finame")!;

    expect(noAtivo.situacao).toBe(naFrota.situacao);
    expect(noAtivo.confianca).toBe(naFrota.confianca);
    expect(noAtivo.porque).toBe(naFrota.porque);
    expect(noAtivo.oQuePerguntar).toBe(naFrota.oQuePerguntar);
  });
});

describe("medirAlteracoesDoAtivo", () => {
  it("devolve os códigos que mudaram naquele ativo", async () => {
    const { db } = ctx;
    const contexto = (await getRecomendacoesAoCliente(db, {}))!.context;

    const medido = await medirAlteracoesDoAtivo(db, contexto, "BBB2B22");
    expect(medido.placa).toBe("BBB2B22");
    expect([...medido.codigos].sort()).toEqual(["cavalo.finame", "cavalo.ipva"]);
  });

  it("placa desconhecida não é erro — é `null` com conjunto vazio", async () => {
    const { db } = ctx;
    const contexto = (await getRecomendacoesAoCliente(db, {}))!.context;

    const medido = await medirAlteracoesDoAtivo(db, contexto, "ZZZ9Z99");
    expect(medido.placa).toBeNull();
    expect(medido.codigos.size).toBe(0);
  });
});
