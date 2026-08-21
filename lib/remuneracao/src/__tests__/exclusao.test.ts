import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";
import { COLUNA } from "../colunas";
import {
  apagarPlanilhaDaUnidade,
  gravarPlanilhaDaUnidade,
  lerSituacaoDasUnidades,
  VigenciaDoCadastroNaoEncontrada,
} from "../leitura";
import {
  ExclusaoRecusada,
  excluirUnidadeRegistrada,
  registrarUnidade,
  UnidadeNaoRegistrada,
  unidadesRegistradas,
} from "../unidade";

/**
 * O DESFAZER — apagar a planilha de uma quinzena, e o cadastro de uma unidade.
 *
 * Tudo neste módulo tinha entrada e não tinha saída. Digitar a aba na quinzena
 * errada, criar uma quinzena que não existia ou cadastrar a unidade com o nome
 * errado deixava uma linha na lista para sempre: dava para zerar as trinta
 * células uma a uma, e nem isso removia a linha — ela ficava, vazia, sem
 * ninguém saber por que estava ali. Numa tela que é a fila do fechamento, uma
 * linha que não deveria existir é trabalho que alguém vai procurar.
 *
 * O que este arquivo prende são as duas metades do desfazer e, principalmente,
 * **o que cada uma não pode alcançar**:
 *
 * - apagar uma quinzena não toca a vizinha — nunca houve herança entre elas, e
 *   um `DELETE` sem a data seria a herança ao contrário;
 * - apagar a unidade é recusado enquanto houver planilha nela. Não é preciosismo
 *   de ordem: sem a recusa, as células ficariam no banco sem unidade que as
 *   explique, e a lista voltaria a mostrá-las como planilha órfã — "excluir a
 *   unidade" produziria uma linha nova em vez de nenhuma.
 */

let ctx: TestDb;

const ESCOPO = "escopo-exclusao";
const REGISTRADA = "escopo-exclusao-registrada";
const PRIMEIRA = "2026-08-01";
const SEGUNDA = "2026-08-16";

const ATIVO: AttributeSpec = {
  code: COLUNA.ativo.code,
  dataType: "TEXT",
  semanticsStatus: "CONFIRMED",
};

async function quantasCelulas(scopeHash: string, effectiveDate?: string): Promise<number> {
  const { rows } = await ctx.db.execute<{ total: number }>(sql`
    SELECT count(*)::int AS total
      FROM remuneracao_planilha
     WHERE scope_hash = ${scopeHash}
       ${effectiveDate ? sql`AND effective_date = ${effectiveDate}::date` : sql``}`);
  return rows[0]?.total ?? 0;
}

beforeAll(async () => {
  ctx = await createTestDatabase("remuneracao_exclusao");
  await seedTaxonomy(ctx.db, "test");

  await buildFixture(
    ctx.db,
    [ATIVO],
    [
      {
        label: "EMPURRADA_1_8_2026",
        effectiveDate: PRIMEIRA,
        data: { AAA1A11: { [COLUNA.ativo.code]: "ATIVO" } },
      },
      {
        label: "EMPURRADA_2_8_2026",
        effectiveDate: SEGUNDA,
        data: { AAA1A11: { [COLUNA.ativo.code]: "ATIVO" } },
      },
    ],
    { scopeHash: ESCOPO, canal: "exclusao", entityType: "CAVALO" },
  );
}, 300_000);

afterAll(async () => {
  await ctx?.drop().catch(() => {});
}, 60_000);

describe("apagar a planilha de uma quinzena", () => {
  beforeAll(async () => {
    for (const vigencia of [PRIMEIRA, SEGUNDA]) {
      await gravarPlanilhaDaUnidade(ctx.db, {
        scopeHash: ESCOPO,
        channel: "EMPURRADA",
        period: vigencia,
        celulas: [
          { chave: "aliquota_pis", valor: 1.65 },
          { chave: "aliquota_cofins", valor: 7.6 },
        ],
        autor: { id: null, nome: "Guy" },
      });
    }
  }, 300_000);

  it("apaga as células daquela vigência, e devolve quantas saíram", async () => {
    const apagadas = await apagarPlanilhaDaUnidade(ctx.db, {
      scopeHash: ESCOPO,
      channel: "EMPURRADA",
      period: PRIMEIRA,
    });

    expect(apagadas).toBe(2);
    expect(await quantasCelulas(ESCOPO, PRIMEIRA)).toBe(0);
  });

  it("não toca a quinzena vizinha", async () => {
    /*
      A promessa que sustenta o módulo inteiro: não há herança entre as duas
      quinzenas do mesmo mês, nem para escrever nem para apagar. Um `DELETE` sem
      a data seria a herança ao contrário, e a mais silenciosa das duas.
    */
    expect(await quantasCelulas(ESCOPO, SEGUNDA)).toBe(2);

    const { cadastros } = await lerSituacaoDasUnidades(ctx.db);
    const segunda = cadastros.find(
      (c) => c.scopeHash === ESCOPO && c.effectiveDate === SEGUNDA,
    );
    expect(segunda!.cadastro.informadas).toBe(2);
  });

  it("a linha do acervo continua — sem nada informado, que é o que ela era antes", async () => {
    /*
      A vigência veio de export: apagar o que alguém digitou não a remove da
      lista, e não deveria. O que some é a linha cuja quinzena só existia por
      causa da planilha — provado em `planilha-orfa.test.ts`.
    */
    const { cadastros } = await lerSituacaoDasUnidades(ctx.db);
    const primeira = cadastros.find(
      (c) => c.scopeHash === ESCOPO && c.effectiveDate === PRIMEIRA,
    );

    expect(primeira).toBeDefined();
    expect(primeira!.cadastro.informadas).toBe(0);
  });

  it("apagar de novo devolve zero, e não erro", async () => {
    /*
      Quem clicou já pediu "não quero nada informado aqui", e o estado responde
      por isso. Um erro na segunda vez faria a tela dizer que falhou o que já
      estava feito.
    */
    expect(
      await apagarPlanilhaDaUnidade(ctx.db, {
        scopeHash: ESCOPO,
        channel: "EMPURRADA",
        period: PRIMEIRA,
      }),
    ).toBe(0);
  });

  it("recusa uma vigência que a unidade não tem, em vez de apagar em silêncio", async () => {
    /*
      Sem a conferência, um endereço errado responderia "apaguei" sobre uma
      quinzena inexistente — e quem clicou concluiria que o trabalho sumiu,
      quando ele continua onde estava.
    */
    await expect(
      apagarPlanilhaDaUnidade(ctx.db, {
        scopeHash: ESCOPO,
        channel: "EMPURRADA",
        period: "2026-09-01",
      }),
    ).rejects.toBeInstanceOf(VigenciaDoCadastroNaoEncontrada);
  });
});

describe("excluir o cadastro de uma unidade registrada à mão", () => {
  beforeAll(async () => {
    await registrarUnidade(ctx.db, {
      scopeHash: REGISTRADA,
      scopeType: "UNIDADE",
      codigo: "",
      nome: "CDD BELÉM",
      canal: "ROTA",
      vigenciaInicial: PRIMEIRA,
      autor: { id: null, nome: "Guy" },
    });
  }, 300_000);

  it("recusa enquanto houver planilha, e a frase diz quanto e onde", async () => {
    await gravarPlanilhaDaUnidade(ctx.db, {
      scopeHash: REGISTRADA,
      channel: "ROTA",
      period: PRIMEIRA,
      celulas: [{ chave: "aliquota_pis", valor: 1.65 }],
      autor: { id: null, nome: "Guy" },
    });

    await expect(
      excluirUnidadeRegistrada(ctx.db, { scopeHash: REGISTRADA, canal: "ROTA" }),
    ).rejects.toBeInstanceOf(ExclusaoRecusada);

    /* E não apaga pela metade: a unidade continua lá depois da recusa. */
    const registradas = await unidadesRegistradas(ctx.db);
    expect(registradas.some((u) => u.scopeHash === REGISTRADA)).toBe(true);
  });

  it("apaga depois que a planilha sai, e a unidade some da lista", async () => {
    await apagarPlanilhaDaUnidade(ctx.db, {
      scopeHash: REGISTRADA,
      channel: "ROTA",
      period: PRIMEIRA,
    });

    const saiu = await excluirUnidadeRegistrada(ctx.db, {
      scopeHash: REGISTRADA,
      canal: "ROTA",
    });
    expect(saiu.nome).toBe("CDD BELÉM");

    const { cadastros } = await lerSituacaoDasUnidades(ctx.db);
    expect(cadastros.some((c) => c.scopeHash === REGISTRADA)).toBe(false);
    expect(await quantasCelulas(REGISTRADA)).toBe(0);
  });

  it("recusa com 'não registrada' o que nunca esteve na tabela", async () => {
    /*
      É o caso de quem clica duas vezes, e o de quem clica depois de o export
      ter chegado — a unidade passou a viver do arquivo, e apagar a linha daqui
      não a tiraria da tela. A frase da recusa manda recarregar a lista.
    */
    await expect(
      excluirUnidadeRegistrada(ctx.db, { scopeHash: ESCOPO, canal: "EMPURRADA" }),
    ).rejects.toBeInstanceOf(UnidadeNaoRegistrada);
  });
});
