import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { absent, buildFixture, type AttributeSpec } from "@workspace/comparison/testing";
import { COLUNA } from "../colunas";
import {
  ComparacaoSemDuasVigencias,
  lerCadastroDaUnidade,
  lerComparacaoDeCadastros,
  lerSituacaoDasUnidades,
  VigenciaDoCadastroNaoEncontrada,
} from "../leitura";

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
        data: { AAA1A11: { ...IPVA, [COLUNA.ativo.code]: "ATIVO" } },
      },
      {
        label: "EMPURRADA_1_8_2026",
        effectiveDate: VIGENCIA,
        data: {
          /*
            `ATIVO` e `PARADO` são as duas palavras do export real — medidas no
            acervo de CAMAÇARI em 19/08/2026, 442 e 116 linhas nas nove
            vigências. É por elas que a contagem tem de responder; `SIM` está
            junto porque a mesma coluna chega assim em outros exports, e o
            cadastro não pode depender de qual variante veio no mês.
          */
          AAA1A11: { ...IPVA, [COLUNA.ativo.code]: "ATIVO" },
          BBB2B22: { ...IPVA, [COLUNA.ativo.code]: "SIM" },
          CCC3C33: { ...IPVA, [COLUNA.ativo.code]: "PARADO" },
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

    expect(lido.material).toEqual({ cavalos: 5, trechos: 2, trechosEntregues: true, linhasInformadas: 0 });
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

  it("conta a frota pelas palavras que a coluna `ativo` de fato usa", async () => {
    const lido = await cadastro();

    // `ATIVO`/`PARADO` no export real, `SIM` numa variante — todas em `value_text`.
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
    expect(anterior.material).toEqual({ cavalos: 1, trechos: 0, trechosEntregues: false, linhasInformadas: 0 });
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

describe("as duas quinzenas lado a lado", () => {
  async function comparacao(pedido: { de?: string; ate?: string } = {}) {
    const lida = await lerComparacaoDeCadastros(ctx.db, { ...CONTEXTO, ...pedido });
    expect(lida).not.toBeNull();
    return lida!;
  }

  it("sem pedido, compara as duas vigências mais recentes", async () => {
    const par = await comparacao();

    expect(par.esquerda.effectiveDate).toBe(ANTERIOR);
    expect(par.direita.effectiveDate).toBe(VIGENCIA);
    expect(par.blocos.flatMap((b) => b.linhas)).toHaveLength(33);
  });

  /*
    A ordem é do calendário, não do clique. Sem isto, escolher a quinzena nova
    no seletor da esquerda faria a mesma tela dizer "subiu" e "desceu" sobre o
    mesmo movimento, conforme a ordem em que alguém mexeu nos dois campos.
  */
  it("ordena as pontas cronologicamente, mesmo pedidas ao contrário", async () => {
    const par = await comparacao({ de: VIGENCIA, ate: ANTERIOR });

    expect(par.esquerda.effectiveDate).toBe(ANTERIOR);
    expect(par.direita.effectiveDate).toBe(VIGENCIA);
  });

  /*
    Julho tem cavalos e nenhum trecho; agosto tem os dois. As alíquotas de
    agosto **ganharam lastro** — e ganhar lastro não é subir de zero. É a mesma
    regra de `comparacao.test.ts`, aqui atravessando o banco de ponta a ponta.
  */
  it("não transforma cobertura que apareceu em aumento de valor", async () => {
    const par = await comparacao();
    const icms = par.blocos
      .flatMap((b) => b.linhas)
      .find((l) => l.chave === "aliquota_icms")!;

    expect(icms.movimento).toBe("GANHOU_LASTRO");
    expect(icms.variacao).toBeNull();
    expect(icms.direita.valor).toBeCloseTo(17.84, 4);
  });

  it("mostra o crescimento da frota entre as duas quinzenas", async () => {
    const par = await comparacao();
    const ativos = par.blocos
      .flatMap((b) => b.linhas)
      .find((l) => l.chave === "frota_fixa_ativos")!;

    // Julho tinha um cavalo ativo; agosto tem dois.
    expect(ativos.movimento).toBe("SUBIU");
    expect(ativos.esquerda.valor).toBe(1);
    expect(ativos.direita.valor).toBe(2);
    expect(ativos.variacao).toEqual({ absoluta: 1, percentual: 100 });
  });

  it("traz o material das duas pontas, para a tela dizer o que cada uma entregou", async () => {
    const par = await comparacao();

    expect(par.esquerda.material).toEqual({ cavalos: 1, trechos: 0, trechosEntregues: false, linhasInformadas: 0 });
    expect(par.direita.material).toEqual({ cavalos: 5, trechos: 2, trechosEntregues: true, linhasInformadas: 0 });
  });

  it("recusa a ponta que não existe, como a leitura de uma vigência", async () => {
    await expect(
      lerComparacaoDeCadastros(ctx.db, { ...CONTEXTO, de: "2026-01-01" }),
    ).rejects.toBeInstanceOf(VigenciaDoCadastroNaoEncontrada);
  });

  /*
    Uma unidade com uma vigência só não tem par a mostrar, e a recusa é
    própria: não é 404 (a unidade está lá), não é 400 (o pedido está certo) — é
    o acervo que ainda não tem duas quinzenas.
  */
  it("recusa comparar quando a unidade só entregou uma vigência", async () => {
    await buildFixture(
      ctx.db,
      ATRIBUTOS_DO_CAVALO,
      [
        {
          label: "SOZINHA_1_9_2026",
          effectiveDate: "2026-09-01",
          data: { ZZZ9Z99: { ...IPVA, [COLUNA.ativo.code]: "ATIVO" } },
        },
      ],
      { entityType: "CAVALO", scopeHash: "escopo-de-uma-vigencia", canal: "sozinha" },
    );

    await expect(
      lerComparacaoDeCadastros(ctx.db, {
        scopeHash: "escopo-de-uma-vigencia",
        channel: "SOZINHA",
      }),
    ).rejects.toBeInstanceOf(ComparacaoSemDuasVigencias);
  });
});

/**
 * A lista dos cadastros — e o defeito que só o banco pega.
 *
 * A leitura da lista pergunta por **todas** as unidades de uma vez, e por
 * todas as vigências de cada uma. É aí que mora o erro que nenhum teste em
 * memória alcança: um predicado que cruzasse a lista de unidades com a lista
 * de datas — `scope IN (…) AND date IN (…)` — devolveria número plausível para
 * todo mundo e somaria a quinzena de uma na conta da outra. O mesmo vale do
 * lado de cá do SQL: sem a data na chave que junta a linha lida ao alvo, julho
 * e agosto da mesma unidade caem no mesmo balde e as duas linhas mostram a
 * soma das duas.
 *
 * As duas unidades abaixo existem para armar exatamente esse cruzamento. Uma
 * tem **julho** e só julho; a outra tem julho **e** agosto, com trechos
 * diferentes em cada uma — três e um. Lidas certo, são três linhas com 2, 3 e
 * 1 trecho; misturadas, quatro aparece em toda parte.
 */
describe("a lista dos cadastros", () => {
  /** Só trechos, e só em julho — a unidade cuja vigência mais recente é julho. */
  const SO_TRECHOS = "escopo-so-trechos";
  /** Trechos em julho e em agosto, em entidades distintas — a isca do cruzamento. */
  const DUAS_VIGENCIAS = "escopo-de-duas-vigencias";

  beforeAll(async () => {
    await buildFixture(
      ctx.db,
      ATRIBUTOS_DO_TRECHO,
      [
        {
          label: "SOTRECHO_1_7_2026",
          effectiveDate: ANTERIOR,
          data: { "T-FORA": { ...FORA }, "T-DENTRO": { ...DENTRO } },
        },
      ],
      { entityType: "TRECHO", scopeHash: SO_TRECHOS, canal: "trechos" },
    );

    await buildFixture(
      ctx.db,
      ATRIBUTOS_DO_TRECHO,
      [
        {
          label: "DUASVIG_1_7_2026",
          effectiveDate: ANTERIOR,
          data: {
            "D-JUL-1": { ...FORA },
            "D-JUL-2": { ...FORA },
            "D-JUL-3": { ...DENTRO },
          },
        },
        {
          label: "DUASVIG_1_8_2026",
          effectiveDate: VIGENCIA,
          data: { "D-AGO-1": { ...FORA } },
        },
      ],
      { entityType: "TRECHO", scopeHash: DUAS_VIGENCIAS, canal: "trechos" },
    );
  }, 300_000);

  /** As linhas de uma unidade, na ordem em que a lista as devolve. */
  async function unidade(scopeHash: string) {
    const lista = await lerSituacaoDasUnidades(ctx.db);
    const achadas = lista.cadastros.filter((c) => c.scopeHash === scopeHash);
    expect(achadas.length, `unidade ${scopeHash} na lista`).toBeGreaterThan(0);
    return achadas;
  }

  /** A linha de uma unidade numa vigência — o cadastro daquela quinzena. */
  async function daVigencia(scopeHash: string, effectiveDate: string) {
    const linhas = await unidade(scopeHash);
    const achada = linhas.find((c) => c.effectiveDate === effectiveDate);
    expect(achada, `${scopeHash} em ${effectiveDate}`).toBeDefined();
    return achada!;
  }

  it("responde por vigência: uma linha por quinzena, da mais recente para a mais antiga", async () => {
    const camacari = await unidade(ESCOPO);

    expect(camacari.map((c) => c.effectiveDate)).toEqual([VIGENCIA, ANTERIOR]);
    expect(camacari[0]!.periodLabel).toBe("agosto/2026");
    expect(camacari[0]!.channel).toBe("EMPURRADA");
  });

  /*
    O caso que trouxe esta forma: a planilha preenchida numa quinzena antiga
    continua na tela, na vigência dela, em vez de sumir quando a unidade passa
    a ter uma vigência mais nova e vazia.
  */
  it("mostra a vigência antiga ao lado da nova, e não só a última", async () => {
    const julho = await daVigencia(DUAS_VIGENCIAS, ANTERIOR);
    const agosto = await daVigencia(DUAS_VIGENCIAS, VIGENCIA);

    expect(julho.material.trechos).toBe(3);
    expect(agosto.material.trechos).toBe(1);
  });

  /*
    O caso que o cruzamento de listas quebraria. A unidade das duas vigências
    tem três trechos em julho e um em agosto; agosto é a mais recente dela, e a
    resposta é um. Se a data de outra unidade — a de julho, logo acima —
    entrasse no predicado desta, seriam quatro, e o número apareceria plausível
    em toda a coluna.
  */
  it("não mistura o material de uma unidade com o da vigência de outra", async () => {
    const camacari = await daVigencia(ESCOPO, VIGENCIA);
    const soTrechos = await unidade(SO_TRECHOS);
    const duasVigencias = await unidade(DUAS_VIGENCIAS);

    expect(camacari.material).toEqual({ cavalos: 5, trechos: 2, trechosEntregues: true, linhasInformadas: 0 });

    expect(soTrechos.map((c) => c.effectiveDate)).toEqual([ANTERIOR]);
    expect(soTrechos[0]!.material).toEqual({ cavalos: 0, trechos: 2, trechosEntregues: true, linhasInformadas: 0 });

    /*
      As duas quinzenas desta unidade, cada uma com o que **ela** entregou.
      Quatro em qualquer das duas seria a soma das duas — o cruzamento que
      este bloco existe para pegar.
    */
    expect(duasVigencias.map((c) => c.effectiveDate)).toEqual([VIGENCIA, ANTERIOR]);
    expect(duasVigencias[0]!.material).toEqual({ cavalos: 0, trechos: 1, trechosEntregues: true, linhasInformadas: 0 });
    expect(duasVigencias[1]!.material).toEqual({ cavalos: 0, trechos: 3, trechosEntregues: true, linhasInformadas: 0 });
  });

  it("diz qual metade do cadastro cada unidade sustenta", async () => {
    expect((await daVigencia(ESCOPO, VIGENCIA)).cadastro).toMatchObject({
      estado: "FROTA_E_ALIQUOTAS",
      frota: true,
      aliquotas: true,
    });
    expect((await daVigencia(SO_TRECHOS, ANTERIOR)).cadastro).toMatchObject({
      estado: "SO_ALIQUOTAS",
      frota: false,
      aliquotas: true,
    });
  });

  /*
    A promessa que justifica a lista montar o cadastro em vez de deduzi-lo do
    material: o que ela conta é o que a tela da unidade mostra. Se um dia os
    dois divergirem, é aqui que aparece.
  */
  it("conta o mesmo lastro que a tela daquela unidade mostra", async () => {
    const daLista = await daVigencia(ESCOPO, VIGENCIA);
    const lido = await cadastro();

    expect(daLista.cadastro.linhas).toBe(lido.resumo.linhas);
    expect(daLista.cadastro.comLastro).toBe(lido.resumo.apuradas + lido.resumo.emConjunto);
    expect(daLista.cadastro.semLastro).toBe(lido.resumo.semLastro);
  });

  it("resume os cadastros pelos estados que eles de fato têm", async () => {
    const lista = await lerSituacaoDasUnidades(ctx.db);
    const { resumo } = lista;

    expect(resumo.cadastros).toBe(lista.cadastros.length);
    expect(
      resumo.frotaEAliquotas + resumo.soFrota + resumo.soAliquotas + resumo.semLastro,
    ).toBe(resumo.cadastros);
    expect(resumo.frotaEAliquotas).toBeGreaterThanOrEqual(1);
    expect(resumo.soAliquotas).toBeGreaterThanOrEqual(1);
  });

  /*
    Os dois números do resumo são de grãos diferentes, e a unidade de duas
    vigências é a prova: ela é uma unidade e dois cadastros. Deduzir o primeiro
    do tamanho da lista — como a frase "nenhuma das N unidades tem este código"
    fazia — contaria a mesma unidade duas vezes.
  */
  it("conta unidades e cadastros como coisas diferentes", async () => {
    const { resumo, cadastros } = await lerSituacaoDasUnidades(ctx.db);

    const unidadesDistintas = new Set(cadastros.map((c) => `${c.scopeHash}|${c.channel ?? ""}`));
    expect(resumo.unidades).toBe(unidadesDistintas.size);
    expect(resumo.cadastros).toBeGreaterThan(resumo.unidades);
  });
});

/**
 * As duas quinzenas do mesmo mês — a unidade que entrega dia 1 e dia 16.
 *
 * É como a planilha de remuneração chega, e é o caso que o rótulo genérico não
 * distinguia: `2026-08-01` e `2026-08-16` saíam as duas como "agosto/2026", no
 * seletor do formulário, nos títulos da comparação e na coluna da lista. Quem
 * ia digitar a segunda quinzena escolhia entre dois itens iguais.
 *
 * A régua está provada linha a linha em `vigencia.test.ts`; o que este bloco
 * garante é a **ligação** — que as três leituras do módulo usam a régua, e não
 * só a que alguém lembrou de trocar.
 */
describe("as duas quinzenas do mesmo mês", () => {
  const QUINZENAL = "escopo-quinzenal";
  const SEGUNDA = "2026-08-16";
  const PEDIDO = { scopeHash: QUINZENAL, channel: "QUINZENAL" };

  beforeAll(async () => {
    await buildFixture(
      ctx.db,
      ATRIBUTOS_DO_CAVALO,
      [
        {
          label: "QUINZENAL_1_8_2026",
          effectiveDate: VIGENCIA,
          data: { "Q-1": { ...IPVA, [COLUNA.ativo.code]: "ATIVO" } },
        },
        {
          label: "QUINZENAL_16_8_2026",
          effectiveDate: SEGUNDA,
          data: {
            "Q-1": { ...IPVA, [COLUNA.ativo.code]: "ATIVO" },
            "Q-2": { ...IPVA, [COLUNA.ativo.code]: "ATIVO" },
          },
        },
      ],
      { entityType: "CAVALO", scopeHash: QUINZENAL, canal: "cavalos" },
    );
  }, 300_000);

  it("nomeia cada uma no seletor do cadastro", async () => {
    const lido = await lerCadastroDaUnidade(ctx.db, PEDIDO);

    expect(lido!.effectiveDate).toBe(SEGUNDA);
    expect(lido!.periodLabel).toBe("2ª quinzena de agosto/2026");
    expect(lido!.vigencias).toEqual([
      { effectiveDate: VIGENCIA, periodLabel: "1ª quinzena de agosto/2026" },
      { effectiveDate: SEGUNDA, periodLabel: "2ª quinzena de agosto/2026" },
    ]);
  });

  it("dá títulos diferentes às duas colunas da comparação", async () => {
    const par = await lerComparacaoDeCadastros(ctx.db, PEDIDO);

    expect(par!.esquerda.periodLabel).toBe("1ª quinzena de agosto/2026");
    expect(par!.direita.periodLabel).toBe("2ª quinzena de agosto/2026");
  });

  /*
    E a lista traz as duas, cada uma com o nome e o material dela. É a mesma
    régua da tela do cadastro, aplicada a linhas que agora convivem: sem ela, as
    duas quinzenas de agosto seriam dois "agosto/2026" um embaixo do outro, e
    nada diria qual é qual.
  */
  it("traz as duas quinzenas do mês, cada uma com o seu nome e o seu material", async () => {
    const { cadastros } = await lerSituacaoDasUnidades(ctx.db);
    const daUnidade = cadastros.filter((c) => c.scopeHash === QUINZENAL);

    expect(daUnidade.map((c) => c.effectiveDate)).toEqual([SEGUNDA, VIGENCIA]);
    expect(daUnidade.map((c) => c.periodLabel)).toEqual([
      "2ª quinzena de agosto/2026",
      "1ª quinzena de agosto/2026",
    ]);
    expect(daUnidade.map((c) => c.material.cavalos)).toEqual([2, 1]);
  });

  /*
    A outra ponta da régua, no banco: a unidade que entrega uma vez por mês
    continua com o rótulo do mês. O grão da quinzena é o que os arquivos
    mostram, não o que este módulo prefere.
  */
  it("não chama de quinzena o mês que veio inteiro", async () => {
    const camacari = await lerCadastroDaUnidade(ctx.db, CONTEXTO);
    expect(camacari!.periodLabel).toBe("agosto/2026");
    expect(camacari!.vigencias.map((v) => v.periodLabel)).toEqual(["julho/2026", "agosto/2026"]);
  });
});
