import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { absent, buildFixture, type AttributeSpec } from "@workspace/comparison/testing";
import { COLUNA } from "../colunas";
import { lerCadastroDaUnidade, VigenciaDoCadastroNaoEncontrada } from "../leitura";

/**
 * A leitura do acervo, contra um banco de verdade.
 *
 * Os outros dois arquivos exercitam a aritmética sobre material sintético em
 * memória; este exercita a única coisa que eles não alcançam — **o SQL**. E o
 * SQL é justamente onde o defeito silencioso mora: um código de atributo com um
 * sublinhado a mais (`trecho.icms_iss` virando `trecho.icmsiss`) não quebra
 * typecheck, não quebra build, e produz um cadastro inteiro sem alíquota que se
 * lê exatamente como uma vigência que não trouxe a coluna.
 *
 * Por isso a fixtura usa **os códigos reais**, os mesmos que `colunas.ts`
 * declara: um teste com nomes inventados exercitaria um caminho que a produção
 * nunca percorre.
 *
 * As duas séries — cavalos e trechos — entram como duas chamadas de fixtura com
 * o mesmo `scopeHash` e o mesmo rótulo de vigência, e canais de identidade
 * distintos. É o que `lib/composition/src/__tests__/motor.test.ts` faz pela
 * mesma razão: o canal do contexto sai do rótulo (`EMPURRADA_1_8_2026`), e o
 * `canal` da fixtura só separa a identidade canônica das duas entregas.
 */

let ctx: TestDb;

const ESCOPO = "escopo-cadastro";
const CONTEXTO = { scopeHash: ESCOPO, channel: "EMPURRADA" };
const VIGENCIA = "2026-08-01";
const ANTERIOR = "2026-07-01";

const numerico = (code: string): AttributeSpec => ({
  code,
  dataType: "NUMERIC",
  semanticsStatus: "CONFIRMED",
  unit: "BRL",
  periodicity: "MENSAL",
  aggregation: "SUM",
  isMonetary: true,
  taxonomyCode: "trib_prestacao",
});

/**
 * O cavalo entra com duas colunas, e a segunda não é enfeite.
 *
 * `ipvaLicenciamento` é o que faz existir um veículo **sem nenhum fato de
 * `ativo`**: é ele que prova que a lista de quem existe sai de todos os fatos
 * da vigência, e não só dos das colunas pedidas. Com uma coluna só, o veículo
 * sem ela simplesmente não teria linha nenhuma no banco, e o caso que a
 * contagem precisa cobrir — a frota encolher em silêncio — não poderia sequer
 * ser montado.
 */
const ATRIBUTOS_DO_CAVALO: AttributeSpec[] = [
  { code: COLUNA.ativo.code, dataType: "TEXT", semanticsStatus: "CONFIRMED" },
  {
    code: "cavalo.ipva_licenciamento",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "ANUAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "trib_ipva_licenciamento",
  },
];

const IPVA = { "cavalo.ipva_licenciamento": 4_200 };

const ATRIBUTOS_DO_TRECHO: AttributeSpec[] = [
  { code: COLUNA.tributo.code, dataType: "TEXT", semanticsStatus: "CONFIRMED" },
  numerico(COLUNA.percentualDeclarado.code),
  numerico(COLUNA.freteCtrc.code),
  numerico(COLUNA.imposto.code),
  numerico(COLUNA.pisCofins.code),
  numerico(COLUNA.previsaoViagens.code),
];

/** Um trecho fora do município: ICMS a 17,84%, PIS+COFINS a 9,25%. */
const FORA = {
  [COLUNA.tributo.code]: "ICMS",
  [COLUNA.percentualDeclarado.code]: 17.84,
  [COLUNA.freteCtrc.code]: 10_000,
  [COLUNA.imposto.code]: 1_784,
  [COLUNA.pisCofins.code]: 925,
  [COLUNA.previsaoViagens.code]: 62,
};

/** Um trecho dentro do município: ISS a 5,90%, PIS+COFINS a 9,25%. */
const DENTRO = {
  [COLUNA.tributo.code]: "ISS",
  [COLUNA.percentualDeclarado.code]: 5.9,
  [COLUNA.freteCtrc.code]: 1_000,
  [COLUNA.imposto.code]: 59,
  [COLUNA.pisCofins.code]: 92.5,
  [COLUNA.previsaoViagens.code]: 2,
};

beforeAll(async () => {
  ctx = await createTestDatabase("remuneracao_leitura");
  await seedTaxonomy(ctx.db, "test");

  await buildFixture(
    ctx.db,
    ATRIBUTOS_DO_CAVALO,
    [
      {
        label: "EMPURRADA_1_7_2026",
        effectiveDate: ANTERIOR,
        data: { AAA1A11: { ...IPVA, [COLUNA.ativo.code]: "SIM" } },
      },
      {
        label: "EMPURRADA_1_8_2026",
        effectiveDate: VIGENCIA,
        data: {
          AAA1A11: { ...IPVA, [COLUNA.ativo.code]: "SIM" },
          BBB2B22: { ...IPVA, [COLUNA.ativo.code]: "SIM" },
          CCC3C33: { ...IPVA, [COLUNA.ativo.code]: "NAO" },
          /*
            Os dois últimos existem na vigência e não dizem se estão ativos, de
            duas formas diferentes — e as duas acontecem no export real:

            - `DDD4D44` traz a célula **vazia**: há fato, com `is_null` e o
              motivo junto.
            - `EEE5E55` não traz a coluna de jeito nenhum: não há fato.

            Nenhum dos dois pode virar inativo. É essa distinção que separa "a
            frota tem cinco" de "três responderam", e é dinheiro: um veículo
            contado como parado é remunerado como parado.
          */
          DDD4D44: { ...IPVA, [COLUNA.ativo.code]: absent("EMPTY") },
          EEE5E55: { ...IPVA },
        },
      },
    ],
    { entityType: "CAVALO", scopeHash: ESCOPO, canal: "cavalos" },
  );

  await buildFixture(
    ctx.db,
    ATRIBUTOS_DO_TRECHO,
    [
      {
        label: "EMPURRADA_1_8_2026",
        effectiveDate: VIGENCIA,
        data: { "TRECHO-FORA": { ...FORA }, "TRECHO-DENTRO": { ...DENTRO } },
      },
    ],
    { entityType: "TRECHO", scopeHash: ESCOPO, canal: "trechos" },
  );
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

async function cadastro(period = VIGENCIA) {
  const lido = await lerCadastroDaUnidade(ctx.db, { ...CONTEXTO, period });
  expect(lido, `cadastro de ${period}`).not.toBeNull();
  return lido!;
}

function valorDe(
  lido: Awaited<ReturnType<typeof cadastro>>,
  chave: string,
): number | null {
  const linha = lido.blocos.flatMap((b) => b.linhas).find((l) => l.chave === chave);
  expect(linha, chave).toBeDefined();
  return linha!.valor;
}

describe("a leitura do acervo", () => {
  it("encontra as duas séries da mesma unidade na mesma vigência", async () => {
    const lido = await cadastro();

    expect(lido.material).toEqual({ cavalos: 5, trechos: 2, trechosEntregues: true });
    expect(lido.contexto.scopeHash).toBe(ESCOPO);
    expect(lido.contexto.channel).toBe("EMPURRADA");
    expect(lido.effectiveDate).toBe(VIGENCIA);
  });

  /*
    O caso que justifica este arquivo existir. Se qualquer um dos seis códigos
    de `colunas.ts` estiver errado, as alíquotas somem — e somem exatamente como
    sumiriam numa vigência que não trouxe as colunas, sem erro nenhum na tela.
  */
  it("mede as alíquotas a partir das colunas reais do export", async () => {
    const lido = await cadastro();

    expect(valorDe(lido, "aliquota_icms")).toBeCloseTo(17.84, 4);
    expect(valorDe(lido, "aliquota_iss")).toBeCloseTo(5.9, 4);
    expect(valorDe(lido, "resumo_ctrc")).toBeCloseTo(72.91, 4);
    expect(valorDe(lido, "resumo_iss")).toBeCloseTo(84.85, 4);
  });

  it("lê o par PIS + COFINS das mesmas linhas", async () => {
    const lido = await cadastro();
    const pis = lido.blocos
      .flatMap((b) => b.linhas)
      .find((l) => l.chave === "aliquota_pis")!;

    expect(pis.estado).toBe("EM_CONJUNTO");
    expect(pis.conjunto!.valor).toBeCloseTo(9.25, 4);
  });

  it("conta a frota pela coluna `ativo`, inclusive quando ela vem como texto", async () => {
    const lido = await cadastro();

    // `SIM` e `NAO` — o export escreve assim, e o canônico guarda em `value_text`.
    expect(valorDe(lido, "frota_fixa_ativos")).toBe(2);
    expect(valorDe(lido, "frota_fixa_inativos")).toBe(1);
    // Cinco veículos, três respostas. Os dois calados não engrossam os inativos.
    expect(valorDe(lido, "frota_fixa_operacao")).toBe(3);
  });

  it("proporciona os documentos pelas viagens previstas dos trechos", async () => {
    const lido = await cadastro();

    // 2 de 64 viagens previstas ficam dentro do município.
    expect(valorDe(lido, "rota_percentual_iss")).toBeCloseTo(3.125, 4);
    expect(valorDe(lido, "rota_percentual_ctrc")).toBeCloseTo(96.875, 4);
  });

  /*
    A vigência anterior tem cavalos e não tem trechos. É o caso que prova que a
    leitura respeita a data pedida em vez de varrer a série inteira — e o que
    faz a tela dizer "esta vigência não entregou trechos" com propriedade.
  */
  it("responde a vigência pedida, e não sempre a mais recente", async () => {
    const anterior = await cadastro(ANTERIOR);

    expect(anterior.effectiveDate).toBe(ANTERIOR);
    expect(anterior.material).toEqual({ cavalos: 1, trechos: 0, trechosEntregues: false });
    expect(valorDe(anterior, "frota_fixa_ativos")).toBe(1);
    expect(valorDe(anterior, "aliquota_icms")).toBeNull();
  });

  it("oferece no seletor exatamente as vigências que a unidade entregou", async () => {
    const lido = await cadastro();

    expect(lido.vigencias.map((v) => v.effectiveDate)).toEqual([ANTERIOR, VIGENCIA]);
  });

  it("recusa por escrito a vigência que não existe, em vez de aproximar", async () => {
    await expect(
      lerCadastroDaUnidade(ctx.db, { ...CONTEXTO, period: "2026-01-01" }),
    ).rejects.toBeInstanceOf(VigenciaDoCadastroNaoEncontrada);
  });
});
