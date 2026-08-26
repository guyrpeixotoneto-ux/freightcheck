import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";
import { LINHAS_DO_CADASTRO } from "../catalogo";
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
  VigenciaForaDaQuinzena,
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
    const deRota = situacao.cadastros.filter((c) => c.channel === "ROTA");
    const rota = deRota[0];
    expect(rota, "a unidade de ROTA").toBeDefined();

    /*
      Uma linha, e não uma por vigência da unidade: as quinzenas de ROTA são as
      que a planilha tem. As do irmão importado continuam sendo as do
      formulário — a quinzena é do calendário do cliente —, e trazê-las para cá
      encheria a lista de linhas de um canal que ninguém entregou.
    */
    expect(deRota.map((c) => c.effectiveDate)).toEqual([VIGENCIA]);

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

    /*
      A tela que cadastra pede explicitamente, e recebe a aba inteira em branco.

      O número sai de `LINHAS_DO_CADASTRO`, e não de um literal: o que se afirma
      aqui é "a aba **toda**, e nenhuma linha a menos" — quantas linhas a aba tem
      é assunto do catálogo. Escrito à mão, o literal envelheceu na primeira
      linha nova e reprovou uma mudança correta, dizendo `expected 33 to be 30`
      sobre um catálogo que havia crescido de propósito.
    */
    const emBranco = await lerCadastroDaUnidade(ctx.db, {
      ...NOVO,
      period: VIGENCIA,
      aceitarCanalNovo: true,
    });
    expect(emBranco!.resumo.linhas).toBe(LINHAS_DO_CADASTRO.length);
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
    const unidade = situacao.cadastros.find(
      (c) => c.scopeHash === ESCOPO && c.channel === "EMPURRADA" && c.effectiveDate === VIGENCIA,
    )!;

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

/**
 * A QUINZENA QUE AINDA NÃO EXISTE — a aba que chegou antes do export.
 *
 * A escrita sempre exigiu que a vigência estivesse na lista da unidade, e a
 * lista vinha do acervo. É a régua certa para a leitura e era uma parede para
 * quem cadastra: a aba da quinzena nova chega antes do arquivo dela — é a
 * premissa do módulo inteiro —, e não havia onde digitá-la. Na unidade
 * cadastrada à mão a parede era total: as vigências dela são a declarada no
 * registro mais as que ganharam planilha, e ganhar planilha era justamente o
 * que a recusa impedia.
 *
 * A bandeira `aceitarVigenciaNova` é o irmão de `aceitarCanalNovo`: opt-in,
 * pedida só pela tela que cadastra, e limitada pela régua da quinzena — dia 1
 * ou dia 16. O que ela **não** faz é gravar sozinha: a vigência passa a existir
 * quando a primeira célula é salva nela.
 */
describe("a quinzena que ainda não existe", () => {
  const SEGUNDA = "2026-08-16";
  const NO_MEIO_DO_MES = "2026-09-07";

  it("continua recusada sem a bandeira — um link com data errada é 404, não cadastro vazio", async () => {
    await expect(
      lerCadastroDaUnidade(ctx.db, { ...CONTEXTO, period: SEGUNDA }),
    ).rejects.toThrow(VigenciaDoCadastroNaoEncontrada);

    await expect(
      gravarPlanilhaDaUnidade(ctx.db, {
        ...CONTEXTO,
        period: SEGUNDA,
        celulas: [{ chave: "aliquota_pis", valor: 1.65 }],
      }),
    ).rejects.toThrow(VigenciaDoCadastroNaoEncontrada);
  });

  it("recusa criar o que não é começo de quinzena, com a bandeira e tudo", async () => {
    await expect(
      gravarPlanilhaDaUnidade(ctx.db, {
        ...CONTEXTO,
        period: NO_MEIO_DO_MES,
        aceitarVigenciaNova: true,
        celulas: [{ chave: "aliquota_pis", valor: 1.65 }],
      }),
    ).rejects.toThrow(VigenciaForaDaQuinzena);

    // E o ano de um dedo a mais também não passa.
    await expect(
      gravarPlanilhaDaUnidade(ctx.db, {
        ...CONTEXTO,
        period: "20226-09-01",
        aceitarVigenciaNova: true,
        celulas: [{ chave: "aliquota_pis", valor: 1.65 }],
      }),
    ).rejects.toThrow(VigenciaForaDaQuinzena);
  });

  it("abre o formulário em branco, e nomeia as duas quinzenas do mês", async () => {
    const aberto = await lerCadastroDaUnidade(ctx.db, {
      ...CONTEXTO,
      period: SEGUNDA,
      aceitarVigenciaNova: true,
    });

    expect(aberto!.effectiveDate).toBe(SEGUNDA);
    expect(aberto!.resumo.informadas).toBe(0);

    /*
      A quinzena criada entra na lista de vigências, e é por isso que ela entra:
      o rótulo sai do que existe naquele mês. Sem ela na lista, a de 1º de
      agosto continuaria se chamando "agosto/2026" e as duas apareceriam com
      textos que não se distinguem no mesmo seletor.
    */
    const doMes = aberto!.vigencias.filter((v) => v.effectiveDate.startsWith("2026-08"));
    expect(doMes).toEqual([
      { effectiveDate: VIGENCIA, periodLabel: "1ª quinzena de agosto/2026" },
      { effectiveDate: SEGUNDA, periodLabel: "2ª quinzena de agosto/2026" },
    ]);
  });

  it("passa a existir quando a primeira linha é salva — e aí não precisa mais da bandeira", async () => {
    const gravada = await gravarPlanilhaDaUnidade(ctx.db, {
      ...CONTEXTO,
      period: SEGUNDA,
      aceitarVigenciaNova: true,
      celulas: [{ chave: "aliquota_pis", valor: 1.65 }],
      autor: { id: null, nome: "Guy" },
    });
    expect(gravada?.linhas).toHaveLength(1);

    const lido = await lerCadastroDaUnidade(ctx.db, { ...CONTEXTO, period: SEGUNDA });
    expect(lido!.effectiveDate).toBe(SEGUNDA);
    expect(lido!.vigencias.map((v) => v.effectiveDate)).toEqual([ANTERIOR, VIGENCIA, SEGUNDA]);
  });

  /*
    E a quinzena digitada aparece na lista, que é o que separa "gravou" de
    "tem onde ser vista". Era a metade que faltava: a planilha de uma quinzena
    que o export não trouxe ficava no banco sem tela nenhuma, porque a lista
    respondia só pelas vigências do acervo.
  */
  it("aparece na lista de cadastros, ao lado das que vieram de arquivo", async () => {
    const { cadastros } = await lerSituacaoDasUnidades(ctx.db);
    const daUnidade = cadastros.filter(
      (c) => c.scopeHash === ESCOPO && c.channel === "EMPURRADA",
    );

    expect(daUnidade.map((c) => c.effectiveDate)).toEqual([SEGUNDA, VIGENCIA, ANTERIOR]);

    const nova = daUnidade.find((c) => c.effectiveDate === SEGUNDA)!;
    expect(nova.cadastro.informadas).toBe(1);
    // Sem arquivo nenhum naquela quinzena, e a lista diz isso em vez de
    // emprestar o lastro da quinzena vizinha.
    expect(nova.cadastro.estado).toBe("SEM_LASTRO");
    expect(nova.material).toEqual({
      cavalos: 0,
      trechos: 0,
      trechosEntregues: false,
      linhasInformadas: 1,
    });
  });

  it("copiar da quinzena passada é o primeiro gesto — e vale para a que ainda não existe", async () => {
    const TERCEIRA = "2026-09-01";

    const copiada = await copiarPlanilhaDaUnidade(ctx.db, {
      ...CONTEXTO,
      de: VIGENCIA,
      para: TERCEIRA,
      aceitarVigenciaNova: true,
      autor: { id: null, nome: "Guy" },
    });
    expect(copiada!.linhas.length).toBeGreaterThan(0);

    // A origem, não: copiar de uma quinzena que não existe é copiar de nada.
    await expect(
      copiarPlanilhaDaUnidade(ctx.db, {
        ...CONTEXTO,
        de: "2026-10-01",
        para: TERCEIRA,
        aceitarVigenciaNova: true,
      }),
    ).rejects.toThrow(VigenciaDoCadastroNaoEncontrada);
  });
});
