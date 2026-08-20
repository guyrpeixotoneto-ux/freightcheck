import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";
import { COLUNA } from "../colunas";
import { LinhaDaPlanilhaInvalida, PlanilhaVazia } from "../planilha";
import {
  ContextNotFoundError,
  copiarPlanilhaDaUnidade,
  gravarPlanilhaDaUnidade,
  lerCadastroDaUnidade,
  lerPlanilhaDaUnidade,
  lerSituacaoDasUnidades,
  VigenciaDoCadastroNaoEncontrada,
} from "../leitura";

/**
 * A planilha informada contra um banco de verdade.
 *
 * `informado.test.ts` exercita a aritmética da fusão em memória; este arquivo
 * exercita o que ela não alcança — a **ida e volta pelo Postgres**, e o que
 * acontece com o cadastro montado depois dela. É onde moram os defeitos que
 * nenhum teste puro vê: o `numeric` que volta como texto e vira `NaN`, a
 * unicidade que não vale para a série sem canal porque `NULL` não colide com
 * `NULL`, a escrita que grava numa vigência que a unidade não tem.
 *
 * A fixtura é a de `leitura.test.ts`, reduzida: uma unidade com duas vigências,
 * cavalos numa e trechos na outra. Duas vigências porque é o mínimo para provar
 * que a planilha de uma não vaza para a outra — que é a promessa que sustenta
 * "sem herança silenciosa".
 */

let ctx: TestDb;

const ESCOPO = "escopo-planilha";
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

beforeAll(async () => {
  ctx = await createTestDatabase("remuneracao_planilha");
  await seedTaxonomy(ctx.db, "test");

  await buildFixture(
    ctx.db,
    [{ code: COLUNA.ativo.code, dataType: "TEXT", semanticsStatus: "CONFIRMED" }],
    [
      {
        label: "EMPURRADA_1_7_2026",
        effectiveDate: ANTERIOR,
        data: { AAA1A11: { [COLUNA.ativo.code]: "ATIVO" } },
      },
      {
        label: "EMPURRADA_1_8_2026",
        effectiveDate: VIGENCIA,
        data: {
          AAA1A11: { [COLUNA.ativo.code]: "ATIVO" },
          BBB2B22: { [COLUNA.ativo.code]: "ATIVO" },
          CCC3C33: { [COLUNA.ativo.code]: "PARADO" },
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
        data: { "TRECHO-FORA": { ...FORA } },
      },
    ],
    { entityType: "TRECHO", scopeHash: ESCOPO, canal: "trechos" },
  );
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

/** Grava e devolve a planilha resultante. */
function gravar(
  celulas: { chave: string; valor: number | null; observacao?: string | null }[],
  period = VIGENCIA,
) {
  return gravarPlanilhaDaUnidade(ctx.db, {
    ...CONTEXTO,
    period,
    celulas,
    autor: { id: null, nome: "Guy" },
  });
}

async function cadastro(period = VIGENCIA) {
  const lido = await lerCadastroDaUnidade(ctx.db, { ...CONTEXTO, period });
  expect(lido, `cadastro de ${period}`).not.toBeNull();
  return lido!;
}

function linhaDe(lido: Awaited<ReturnType<typeof cadastro>>, chave: string) {
  const linha = lido.blocos.flatMap((b) => b.linhas).find((l) => l.chave === chave);
  expect(linha, chave).toBeDefined();
  return linha!;
}

describe("a planilha informada, ida e volta", () => {
  it("grava, lê e devolve o número com as casas que a linha mede", async () => {
    await gravar([
      { chave: "van_custo_fixo", valor: 4693.85, observacao: "célula D31 da aba de agosto" },
      { chave: "van_quantidade_ativas", valor: 7 },
    ]);

    const planilha = await lerPlanilhaDaUnidade(ctx.db, { ...CONTEXTO, period: VIGENCIA });
    expect(planilha?.linhas).toHaveLength(2);

    const custo = planilha!.linhas.find((l) => l.chave === "van_custo_fixo")!;
    /*
      O `numeric` volta do driver como texto, e é aqui que ele vira número. Sem
      esta conversão a linha chegaria à tela como `"4693.85"`, a soma do bloco
      concatenaria em vez de somar, e o total sairia com dezoito dígitos.
    */
    expect(custo.valor).toBe(4693.85);
    expect(typeof custo.valor).toBe("number");
    expect(custo.observacao).toBe("célula D31 da aba de agosto");
    expect(custo.autor).toBe("Guy");
    expect(custo.rotulo).toBe("Custo Fixo");
  });

  it("devolve as linhas na ordem do catálogo, e não na do banco", async () => {
    const planilha = await lerPlanilhaDaUnidade(ctx.db, { ...CONTEXTO, period: VIGENCIA });
    expect(planilha!.linhas.map((l) => l.chave)).toEqual([
      "van_quantidade_ativas",
      "van_custo_fixo",
    ]);
  });

  it("reinformar reescreve a mesma linha, e não cria uma segunda", async () => {
    await gravar([{ chave: "van_custo_fixo", valor: 4700 }]);
    const planilha = await lerPlanilhaDaUnidade(ctx.db, { ...CONTEXTO, period: VIGENCIA });
    expect(planilha!.linhas.filter((l) => l.chave === "van_custo_fixo")).toHaveLength(1);
    expect(planilha!.linhas.find((l) => l.chave === "van_custo_fixo")!.valor).toBe(4700);
  });

  /*
    O corpo diz o que mudou; as chaves ausentes ficam como estavam. Um
    `replace` apagaria em silêncio o que a pessoa preencheu na semana passada e
    não estava editando agora.
  */
  it("não apaga o que o corpo não menciona", async () => {
    await gravar([{ chave: "van_custo_equipe", valor: 4250.45 }]);
    const planilha = await lerPlanilhaDaUnidade(ctx.db, { ...CONTEXTO, period: VIGENCIA });
    expect(planilha!.linhas.map((l) => l.chave).sort()).toEqual([
      "van_custo_equipe",
      "van_custo_fixo",
      "van_quantidade_ativas",
    ]);
  });

  it("apaga a linha mandada com valor nulo", async () => {
    await gravar([{ chave: "van_custo_equipe", valor: null }]);
    const planilha = await lerPlanilhaDaUnidade(ctx.db, { ...CONTEXTO, period: VIGENCIA });
    expect(planilha!.linhas.map((l) => l.chave)).not.toContain("van_custo_equipe");
  });

  it("recusa a escrita inteira quando uma célula não serve", async () => {
    await expect(
      gravar([
        { chave: "van_quantidade_inativas", valor: 6 },
        { chave: "aliquota_iss", valor: 900 },
      ]),
    ).rejects.toThrow(LinhaDaPlanilhaInvalida);

    /*
      A boa não pode ter passado: metade gravada com uma mensagem de erro
      deixaria quem digitou sem saber qual metade valeu.
    */
    const planilha = await lerPlanilhaDaUnidade(ctx.db, { ...CONTEXTO, period: VIGENCIA });
    expect(planilha!.linhas.map((l) => l.chave)).not.toContain("van_quantidade_inativas");
  });

  it("recusa salvar sem célula nenhuma", async () => {
    await expect(gravar([])).rejects.toThrow(PlanilhaVazia);
  });

  it("recusa gravar numa vigência que a unidade não entregou", async () => {
    await expect(
      gravar([{ chave: "van_custo_fixo", valor: 1 }], "2020-01-01"),
    ).rejects.toThrow(VigenciaDoCadastroNaoEncontrada);
  });
});

describe("a planilha dentro do cadastro montado", () => {
  it("dá número à linha que o acervo não sustenta, marcada como informada", async () => {
    const lido = await cadastro();
    const linha = linhaDe(lido, "van_custo_fixo");
    expect(linha.estado).toBe("INFORMADO");
    expect(linha.valor).toBe(4700);
    expect(linha.declarado?.autor).toBe("Guy");
    expect(lido.material.linhasInformadas).toBeGreaterThan(0);
  });

  it("não deixa o declarado sobrescrever o que o acervo mede", async () => {
    await gravar([{ chave: "frota_fixa_ativos", valor: 5 }]);
    const linha = linhaDe(await cadastro(), "frota_fixa_ativos");
    expect(linha.estado).toBe("APURADO");
    expect(linha.valor).toBe(2);
    expect(linha.conferencia).toMatchObject({ cadastro: 2, planilha: 5, bate: false });
  });

  /*
    A promessa que sustenta "sem herança silenciosa": a planilha de agosto não
    responde por julho. Uma leitura que juntasse as vigências pela unidade faria
    a aba de um mês descrever o outro para sempre, inclusive depois de a
    operação mudar.
  */
  it("não vaza de uma vigência para a outra", async () => {
    const anterior = await cadastro(ANTERIOR);
    expect(linhaDe(anterior, "van_custo_fixo").estado).toBe("SEM_LASTRO");
    expect(anterior.material.linhasInformadas).toBe(0);
  });
});

describe("copiar de uma vigência para outra", () => {
  it("traz o que falta e não sobrescreve o que já existe", async () => {
    await gravar([{ chave: "van_custo_fixo", valor: 1 }], ANTERIOR);

    const copiada = await copiarPlanilhaDaUnidade(ctx.db, {
      ...CONTEXTO,
      de: VIGENCIA,
      para: ANTERIOR,
      autor: { id: null, nome: "Outra pessoa" },
    });

    const porChave = new Map(copiada!.linhas.map((l) => [l.chave, l]));
    // O que já existia em julho fica como estava, com o autor de quem o digitou.
    expect(porChave.get("van_custo_fixo")!.valor).toBe(1);
    expect(porChave.get("van_custo_fixo")!.autor).toBe("Guy");
    // O que só existia em agosto chega, no nome de quem copiou.
    expect(porChave.get("van_quantidade_ativas")!.valor).toBe(7);
    expect(porChave.get("van_quantidade_ativas")!.autor).toBe("Outra pessoa");
  });

  it("recusa copiar de uma vigência que a unidade não tem", async () => {
    await expect(
      copiarPlanilhaDaUnidade(ctx.db, { ...CONTEXTO, de: "2019-01-01", para: VIGENCIA }),
    ).rejects.toThrow(VigenciaDoCadastroNaoEncontrada);
  });
});

/*
  A aba de ROTA existe antes de o export de ROTA chegar, e é justamente nesse
  intervalo que digitá-la vale a pena. Estes três casos são a prova de que o
  canal da planilha não precisa do acervo — e de que a unidade precisa.
*/
describe("um canal que o acervo não entregou", () => {
  const ROTA = { scopeHash: ESCOPO, channel: "ROTA" };

  it("aceita a planilha, e as vigências oferecidas são as da unidade", async () => {
    const gravada = await gravarPlanilhaDaUnidade(ctx.db, {
      ...ROTA,
      period: VIGENCIA,
      celulas: [{ chave: "van_custo_fixo", valor: 999 }],
      autor: { id: null, nome: "Guy" },
    });
    expect(gravada?.canal).toBe("ROTA");
    expect(gravada?.linhas).toHaveLength(1);
  });

  it("passa a existir como unidade própria na lista, sem lastro nenhum", async () => {
    const situacao = await lerSituacaoDasUnidades(ctx.db);
    const rota = situacao.unidades.find((u) => u.channel === "ROTA");
    expect(rota, "a unidade de ROTA").toBeDefined();

    // Herda a unidade — é a mesma —, e o rótulo troca o canal.
    expect(rota!.scopeHash).toBe(ESCOPO);
    expect(rota!.label).toContain("ROTA");
    expect(rota!.label).not.toContain("EMPURRADA");

    /*
      E não herda material nenhum: o acervo de fato não diz nada sobre ROTA. É
      o que separa "a unidade existe" de "o canal foi medido" — e é por isso que
      o estado continua SEM_LASTRO mesmo com a planilha preenchida.
    */
    expect(rota!.material.cavalos).toBe(0);
    expect(rota!.material.trechos).toBe(0);
    expect(rota!.cadastro.estado).toBe("SEM_LASTRO");
    expect(rota!.cadastro.comLastro).toBe(0);
    expect(rota!.cadastro.informadas).toBe(1);
  });

  it("abre o cadastro do canal novo antes da primeira célula, e só sob pedido", async () => {
    const NOVO = { scopeHash: ESCOPO, channel: "TRANSFERENCIA" };

    // A leitura de sempre recusa: canal digitado errado num link é 404.
    await expect(lerCadastroDaUnidade(ctx.db, { ...NOVO, period: VIGENCIA })).rejects.toThrow(
      ContextNotFoundError,
    );

    // A tela que cadastra pede explicitamente, e recebe as trinta em branco.
    const emBranco = await lerCadastroDaUnidade(ctx.db, {
      ...NOVO,
      period: VIGENCIA,
      aceitarCanalNovo: true,
    });
    expect(emBranco!.resumo.linhas).toBe(30);
    expect(emBranco!.resumo.comLastro).toBe(0);
    expect(emBranco!.contexto.channel).toBe("TRANSFERENCIA");
  });

  it("continua recusando uma unidade que não existe, mesmo para escrever", async () => {
    await expect(
      gravarPlanilhaDaUnidade(ctx.db, {
        scopeHash: "escopo-que-ninguem-importou",
        channel: "ROTA",
        period: VIGENCIA,
        celulas: [{ chave: "van_custo_fixo", valor: 1 }],
      }),
    ).rejects.toThrow(ContextNotFoundError);
  });
});

describe("a lista de unidades", () => {
  /*
    O estado das quatro palavras é sobre o que a unidade **entregou**, e a
    planilha informada não pode mexer nele: uma unidade sem arquivo nenhum e com
    a aba transcrita apareceria "Frota e alíquotas", mandando quem opera parar
    de procurar o arquivo que falta.
  */
  it("conta o informado ao lado do lastro, e nunca dentro dele", async () => {
    const situacao = await lerSituacaoDasUnidades(ctx.db);
    const unidade = situacao.unidades.find((u) => u.scopeHash === ESCOPO)!;

    expect(unidade.effectiveDate).toBe(VIGENCIA);
    expect(unidade.cadastro.informadas).toBeGreaterThan(0);
    expect(unidade.cadastro.divergentes).toBe(1);
    expect(unidade.cadastro.estado).toBe("FROTA_E_ALIQUOTAS");

    const montado = await cadastro();
    expect(unidade.cadastro.comLastro).toBe(
      montado.resumo.apuradas + montado.resumo.emConjunto,
    );
    expect(unidade.cadastro.comLastro + unidade.cadastro.informadas).toBeLessThanOrEqual(
      unidade.cadastro.linhas,
    );
  });
});
