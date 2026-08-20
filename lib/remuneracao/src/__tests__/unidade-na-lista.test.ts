import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashScopeSet } from "@workspace/ingest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";
import { sql } from "drizzle-orm";
import { COLUNA } from "../colunas";
import { lerCadastroDaUnidade, lerSituacaoDasUnidades } from "../leitura";
import { gravarPlanilha } from "../planilha";
import { descritorDeEscopo, registrarUnidade } from "../unidade";

/**
 * A unidade registrada à mão, vista pela lista — e a ordem de procedência.
 *
 * O arquivo `unidade.test.ts` prova a escrita: o hash certo, as recusas, o que
 * a leitura devolve. O que sobra, e é o que quebra em produção, é a costura com
 * `contextosDoModulo`: uma unidade registrada tem de **aparecer** na lista, tem
 * de abrir o formulário com a quinzena que foi declarada, e tem de **sumir**
 * como linha própria no dia em que o acervo passar a responder por ela.
 *
 * Esse último é o caso que ninguém testa e todo mundo descobre tarde. Se a
 * registrada continuasse ao lado da importada, a tela mostraria duas CAMAÇARI
 * — uma com planilha e sem frota, outra com frota e sem planilha — e nada em
 * tela diria que são a mesma. É a forma exata do defeito que este caminho
 * inteiro existe para não cometer.
 */

let ctx: TestDb;

const CODIGO = "12345678000199";
const ESCOPO = hashScopeSet([descritorDeEscopo("UNIDADE", CODIGO)]);
const VIGENCIA = "2026-08-01";

const ATIVO: AttributeSpec = {
  code: COLUNA.ativo.code,
  dataType: "TEXT",
  semanticsStatus: "CONFIRMED",
};

beforeAll(async () => {
  ctx = await createTestDatabase("remuneracao_unidade_lista");
  await seedTaxonomy(ctx.db, "test");
}, 300_000);

afterAll(async () => {
  await ctx?.drop().catch(() => {});
}, 60_000);

async function registrar(canal: string | null = "EMPURRADA") {
  return registrarUnidade(ctx.db, {
    scopeHash: ESCOPO,
    scopeType: "UNIDADE",
    codigo: CODIGO,
    nome: "CAMAÇARI",
    canal,
    vigenciaInicial: VIGENCIA,
    autor: { id: null, nome: "Guy" },
  });
}

describe("a unidade sem acervo nenhum", () => {
  beforeAll(async () => {
    await ctx.db.execute(sql`TRUNCATE remuneracao_unidade`);
    await registrar();
  });

  it("aparece na lista, que antes só mostrava quem tinha importado", async () => {
    const { cadastros } = await lerSituacaoDasUnidades(ctx.db);
    const nossa = cadastros.find((c) => c.scopeHash === ESCOPO);

    expect(nossa).toBeDefined();
    expect(nossa!.label).toBe("CAMAÇARI · EMPURRADA");
    // Na quinzena declarada, que é a única que ela tem antes de qualquer
    // planilha — a lista responde por vigência, e esta é a dela.
    expect(nossa!.effectiveDate).toBe(VIGENCIA);
  });

  it("aparece sem lastro, porque é a verdade: o acervo não mede nada dela", async () => {
    const { cadastros } = await lerSituacaoDasUnidades(ctx.db);
    const nossa = cadastros.find((c) => c.scopeHash === ESCOPO)!;

    // Nem frota nem alíquotas — e o estado nomeia isso em vez de fingir
    // um cadastro pela metade.
    expect(nossa.cadastro.estado).toBe("SEM_LASTRO");
    expect(nossa.cadastro.comLastro).toBe(0);
  });

  it("abre o formulário na quinzena declarada, e não em lista vazia", async () => {
    /*
      É o ponto inteiro da `vigencia_inicial`: sem ela o seletor não teria uma
      opção sequer, e a tela que este caminho existe para destravar continuaria
      inalcançável — só que por outro motivo.
    */
    const cadastro = await lerCadastroDaUnidade(ctx.db, {
      scopeHash: ESCOPO,
      channel: "EMPURRADA",
    });

    expect(cadastro).not.toBeNull();
    expect(cadastro!.effectiveDate).toBe(VIGENCIA);
    expect(cadastro!.vigencias.map((v) => v.effectiveDate)).toEqual([VIGENCIA]);
  });

  it("passa a oferecer também as quinzenas que a planilha ganhou", async () => {
    await gravarPlanilha(ctx.db, {
      scopeHash: ESCOPO,
      canal: "EMPURRADA",
      effectiveDate: "2026-08-16",
      celulas: [{ chave: "aliquota_pis", valor: 1.65 }],
      autor: { id: null, nome: "Guy" },
    });

    const cadastro = await lerCadastroDaUnidade(ctx.db, {
      scopeHash: ESCOPO,
      channel: "EMPURRADA",
    });

    expect(cadastro!.vigencias.map((v) => v.effectiveDate)).toEqual([
      VIGENCIA,
      "2026-08-16",
    ]);
  });
});

/**
 * A quinzena preenchida não some quando chega uma mais nova e vazia.
 *
 * É o caso que trouxe a lista por vigência, e ele apareceu em produção: alguém
 * cadastrou a unidade à mão declarando agosto, preencheu a planilha de julho e
 * abriu a lista — que mostrava uma linha só, a de agosto, com "nada informado"
 * e "sem lastro". O trabalho de julho estava no banco, com autor e data, e não
 * havia tela nenhuma em que ele aparecesse.
 *
 * A unidade tem código próprio de propósito: as duas acima dividem o mesmo
 * escopo, e uma delas já ganhou acervo — o que faria esta deixar de ser
 * registrada à mão no meio do teste.
 */
describe("a unidade com planilha numa vigência que não é a mais recente", () => {
  const OUTRO_CODIGO = "99999999000188";
  const OUTRO_ESCOPO = hashScopeSet([descritorDeEscopo("UNIDADE", OUTRO_CODIGO)]);
  const JULHO = "2026-07-01";

  beforeAll(async () => {
    await ctx.db.execute(sql`TRUNCATE remuneracao_unidade`);
    await ctx.db.execute(sql`TRUNCATE remuneracao_planilha`);

    await registrarUnidade(ctx.db, {
      scopeHash: OUTRO_ESCOPO,
      scopeType: "UNIDADE",
      codigo: OUTRO_CODIGO,
      nome: "CDD BELÉM",
      canal: "ROTA",
      vigenciaInicial: VIGENCIA,
      autor: { id: null, nome: "Guy" },
    });

    await gravarPlanilha(ctx.db, {
      scopeHash: OUTRO_ESCOPO,
      canal: "ROTA",
      effectiveDate: JULHO,
      celulas: [
        { chave: "aliquota_pis", valor: 1.65 },
        { chave: "aliquota_cofins", valor: 7.6 },
      ],
      autor: { id: null, nome: "Guy" },
    });
  });

  it("traz as duas vigências, e não só a mais recente", async () => {
    const { cadastros } = await lerSituacaoDasUnidades(ctx.db);
    const dela = cadastros.filter((c) => c.scopeHash === OUTRO_ESCOPO);

    expect(dela.map((c) => c.effectiveDate)).toEqual([VIGENCIA, JULHO]);
  });

  it("e a planilha de julho aparece na linha de julho, não na de agosto", async () => {
    const { cadastros } = await lerSituacaoDasUnidades(ctx.db);
    const dela = cadastros.filter((c) => c.scopeHash === OUTRO_ESCOPO);
    const agosto = dela.find((c) => c.effectiveDate === VIGENCIA)!;
    const julho = dela.find((c) => c.effectiveDate === JULHO)!;

    expect(julho.cadastro.informadas).toBe(2);
    expect(julho.material.linhasInformadas).toBe(2);

    // A quinzena declarada continua em branco — e dizer isso é o certo: ela
    // está mesmo, e é ela que falta preencher.
    expect(agosto.cadastro.informadas).toBe(0);
  });

  it("as duas contam como uma unidade só no resumo", async () => {
    const { resumo } = await lerSituacaoDasUnidades(ctx.db);

    expect(resumo.unidades).toBe(1);
    expect(resumo.cadastros).toBe(2);
  });
});

describe("o dia em que o export finalmente chega", () => {
  beforeAll(async () => {
    await ctx.db.execute(sql`TRUNCATE remuneracao_unidade`);
    await registrar();

    /*
      A importação de verdade calcularia este mesmo `scope_hash` a partir do
      código — é o que `unidade.test.ts` prende. Aqui a fixtura o recebe pronto
      para montar o snapshot **sobre o mesmo escopo**, que é a situação a ser
      exercitada.
    */
    await buildFixture(
      ctx.db,
      [ATIVO],
      [
        {
          label: "EMPURRADA_1_8_2026",
          effectiveDate: VIGENCIA,
          data: {
            AAA1A11: { [COLUNA.ativo.code]: "ATIVO" },
            BBB2B22: { [COLUNA.ativo.code]: "ATIVO" },
          },
        },
      ],
      { entityType: "CAVALO", scopeHash: ESCOPO, canal: "cavalos" },
    );
  });

  it("a unidade não vira duas — o acervo responde no lugar da registrada", async () => {
    const { cadastros } = await lerSituacaoDasUnidades(ctx.db);
    const nossas = cadastros.filter((c) => c.scopeHash === ESCOPO);

    /*
      Uma unidade, e não duas: é isto que o `scope_hash` calculado compra. A
      contagem é de unidades distintas, e não de linhas — a lista responde por
      vigência, e duas linhas da mesma unidade em quinzenas diferentes seriam o
      certo, não o defeito.
    */
    const distintas = new Set(nossas.map((c) => `${c.label}|${c.channel ?? ""}`));
    expect(distintas.size).toBe(1);
  });

  it("e a linha que sobra é a do acervo, com a frota contada", async () => {
    const { cadastros } = await lerSituacaoDasUnidades(ctx.db);
    const nossa = cadastros.find((c) => c.scopeHash === ESCOPO)!;

    // Medição vence declaração: a frota agora tem número, e o cadastro deixou
    // de estar sem lastro sem ninguém ter mexido em nada.
    expect(nossa.cadastro.frota).toBe(true);
    expect(nossa.cadastro.estado).not.toBe("SEM_LASTRO");
  });

  it("a planilha digitada antes continua na unidade, e não ficou órfã", async () => {
    await gravarPlanilha(ctx.db, {
      scopeHash: ESCOPO,
      canal: "EMPURRADA",
      effectiveDate: VIGENCIA,
      celulas: [{ chave: "aliquota_pis", valor: 1.65 }],
      autor: { id: null, nome: "Guy" },
    });

    const cadastro = await lerCadastroDaUnidade(ctx.db, {
      scopeHash: ESCOPO,
      channel: "EMPURRADA",
      period: VIGENCIA,
    });

    const pis = cadastro!.blocos
      .flatMap((b) => b.linhas)
      .find((l) => l.chave === "aliquota_pis");

    expect(pis?.declarado?.valor).toBe(1.65);
  });
});
