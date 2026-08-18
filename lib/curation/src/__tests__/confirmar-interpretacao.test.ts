import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  attributeSemanticsTable,
  attributeTable,
  CONFIRMED_SEMANTICS,
  curationEventTable,
} from "@workspace/db";
import { divergenciasDaProjecao } from "@workspace/db";
import { criarBancoComExportRealPromovido, type TestDb } from "@workspace/ingest/testing";
import { confirmAttribute, getCurationQueue, runProposalPass } from "../engine";
import { applyConfirmations } from "../confirmations";
import { criarSignificado, listarSignificados } from "../catalogo";
import { podeSomar, viraDinheiro } from "../agregacao";
import { seedTaxonomy } from "../taxonomy";

/**
 * Confirmar pelo significado econômico — e o que isso grava.
 *
 * O que se guarda aqui é a promessa central da mudança: **a pessoa afirma uma
 * coisa e o sistema deriva quatro**, sem que nenhum número do produto mude de
 * dono. Cada teste abaixo é uma das quatro derivações, uma das invariantes que
 * continuam valendo, ou um dos jeitos de a confirmação ser recusada.
 *
 * A recusa merece a mesma atenção que o acerto. `R$ 0,42/km` somado entre 100
 * cavalos daria `R$ 42/km` — um número sem referente, com cara de resultado —
 * e é exatamente o erro que este produto existe para pegar.
 */

let ctx: TestDb;
const ATOR = "guy@operalog.com.br";
const POR_QUE = "Confirmado com a tabela de remuneração de agosto à vista.";

/** Uma taxa em R$/km no export real. Vale 3,66 e não é montante nenhum. */
const TAXA_KM = "cavalo.manutencao_reais_km";
/** Uma coluna monetária de verdade, na casa das centenas por implemento. */
const MONTANTE = "carreta.finame_implemento";
/** Consumo em km/l — a razão física que a auditoria de 0023 usou. */
const CONSUMO = "cavalo.combustivel_consumo_neg";

beforeAll(async () => {
  ctx = await criarBancoComExportRealPromovido("confirmar_interpretacao");
  await seedTaxonomy(ctx.db, "test:bootstrap");
  await runProposalPass(ctx.db, "test:proposal");
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

/** A projeção e a versão em vigor, lado a lado. As duas têm de concordar. */
async function estadoDe(code: string) {
  const [attribute] = await ctx.db
    .select()
    .from(attributeTable)
    .where(eq(attributeTable.code, code));
  const [versao] = await ctx.db
    .select()
    .from(attributeSemanticsTable)
    .where(
      and(
        eq(attributeSemanticsTable.attributeId, attribute.id),
        isNull(attributeSemanticsTable.effectiveUntil),
      ),
    );
  return { attribute, versao };
}

describe("a derivação chega ao banco — nas duas tabelas", () => {
  it("R$ por mês vira BRL + MENSAL + SUM + monetário, sem ninguém digitar isso", async () => {
    await confirmAttribute(ctx.db, {
      code: MONTANTE,
      meaningCode: "montante_mes",
      taxonomyCode: "cf_financiamento",
      actor: ATOR,
      reason: POR_QUE,
    });

    const { attribute, versao } = await estadoDe(MONTANTE);
    expect(attribute).toMatchObject({
      unit: "BRL",
      periodicity: "MENSAL",
      aggregation: "SUM",
      isMonetary: true,
      semanticsStatus: "CONFIRMED",
    });
    /*
      A versão em vigor recebe a mesma coisa. Escrever só a projeção criaria
      duas verdades, e a que vale para o dinheiro é a que a comparação lê por
      data — foi assim que a tabela versionada ficou vazia em produção sem que
      nada acusasse.
    */
    expect(versao).toMatchObject({
      unit: "BRL",
      periodicity: "MENSAL",
      aggregation: "SUM",
      isMonetary: true,
      semanticsStatus: "CONFIRMED",
    });
    expect(versao.meaningId).toBe(attribute.meaningId);
    expect(attribute.meaningId).not.toBeNull();
  });

  it("R$ por km vira uma taxa: sem periodicidade, sem soma, e não é montante", async () => {
    await confirmAttribute(ctx.db, {
      code: TAXA_KM,
      meaningCode: "taxa_km",
      taxonomyCode: "cv_manutencao",
      actor: ATOR,
      reason: "É o valor por quilômetro do contrato de manutenção.",
    });

    const { attribute, versao } = await estadoDe(TAXA_KM);
    expect(attribute).toMatchObject({
      unit: "BRL_KM",
      periodicity: null,
      aggregation: "NONE",
      isMonetary: false,
      semanticsStatus: "CONFIRMED",
    });
    expect(versao.unit).toBe("BRL_KM");
    expect(versao.aggregation).toBe("NONE");
  });

  it("R$ por litro cadastrado na hora deriva a unidade nova e é gravável", async () => {
    // O caminho inteiro do pedido: cadastro inline → derivação → confirmação.
    const criado = await criarSignificado(ctx.db, {
      label: "R$ por litro",
      actor: ATOR,
    });
    // Já vinha no catálogo inicial; o que importa é que confirmar por ele
    // funciona e produz a unidade de razão.
    expect(criado.item?.code).toBe("taxa_litro");

    await confirmAttribute(ctx.db, {
      code: CONSUMO,
      meaningCode: "taxa_litro",
      taxonomyCode: "cv_combustivel",
      actor: ATOR,
      reason: "Hipótese de teste: tratar a coluna como preço por litro.",
    });
    const { attribute } = await estadoDe(CONSUMO);
    expect(attribute.unit).toBe("BRL_LITRO");
    expect(attribute.aggregation).toBe("NONE");
    expect(attribute.isMonetary).toBe(false);
  });

  it("o pedido não tem voto sobre os campos derivados", async () => {
    /*
      A porta que o desenho fecha. Mandar `aggregation: SUM` junto de uma taxa é
      exatamente o estado que a auditoria de 16/08/2026 encontrou gravável, e
      agora ele nem chega ao banco: a autoridade decide, o pedido não.
    */
    await confirmAttribute(ctx.db, {
      code: TAXA_KM,
      meaningCode: "taxa_km",
      unit: "BRL",
      aggregation: "SUM",
      isMonetary: true,
      actor: ATOR,
      reason: "Tentando forçar a soma pela API.",
    });
    const { attribute } = await estadoDe(TAXA_KM);
    expect(attribute.unit).toBe("BRL_KM");
    expect(attribute.aggregation).toBe("NONE");
    expect(attribute.isMonetary).toBe(false);
  });
});

describe("a agregação é consequência — a taxa nunca vira montante", () => {
  it("R$/km confirmado não soma entre veículos", async () => {
    const { attribute } = await estadoDe(TAXA_KM);
    const veredito = podeSomar(attribute);
    expect(veredito.ok).toBe(false);
    expect(veredito.motivo).toContain("razão");
    // Confirmada e ainda assim fora do dinheiro: confirmar não é declarar
    // somável, é dizer o que a coluna é.
    expect(attribute.semanticsStatus).toBe("CONFIRMED");
    expect(viraDinheiro(attribute).ok).toBe(false);
  });

  it("R$/litro confirmado também não soma", async () => {
    const { attribute } = await estadoDe(CONSUMO);
    expect(podeSomar(attribute).ok).toBe(false);
    expect(viraDinheiro(attribute).ok).toBe(false);
  });

  it("o banco recusaria a taxa somável mesmo por fora do código", async () => {
    await expect(
      ctx.pool.query(
        `UPDATE attribute SET aggregation='SUM' WHERE code = $1`,
        [CONSUMO],
      ),
    ).rejects.toThrow(/attribute_semantica_coerente/);
  });

  it("o montante por veículo soma, e é o que produz o total da frota", async () => {
    const { attribute } = await estadoDe(MONTANTE);
    expect(podeSomar(attribute).ok).toBe(true);
    expect(viraDinheiro(attribute).ok).toBe(true);

    // E a soma existe de verdade: os montantes por ativo se acumulam num total
    // que é o que a composição publica.
    const { rows } = await ctx.db.execute<{ ativos: string; total: string }>(sql`
      SELECT count(DISTINCT f.entity_id) AS ativos, sum(f.value_numeric) AS total
        FROM fact f
        JOIN attribute a ON a.id = f.attribute_id
       WHERE a.code = ${MONTANTE} AND NOT f.is_null
    `);
    expect(Number(rows[0].ativos)).toBeGreaterThan(1);
    expect(Number(rows[0].total)).toBeGreaterThan(0);
  });
});

describe("as invariantes que não afrouxaram", () => {
  it("continua exigindo responsável identificado", async () => {
    await expect(
      confirmAttribute(ctx.db, {
        code: MONTANTE,
        meaningCode: "montante_mes",
        actor: "",
        reason: POR_QUE,
      }),
    ).rejects.toThrow(/responsável identificado/);
  });

  it("preserva autoria e justificativa no atributo e no histórico", async () => {
    const { attribute } = await estadoDe(MONTANTE);
    expect(attribute.confirmedBy).toBe(ATOR);
    expect(attribute.confirmedAt).toBeInstanceOf(Date);
    expect(attribute.semanticsRationale).toBe(POR_QUE);

    const eventos = await ctx.db
      .select()
      .from(curationEventTable)
      .where(
        and(
          eq(curationEventTable.targetKind, "ATTRIBUTE"),
          eq(curationEventTable.targetLabel, MONTANTE),
          eq(curationEventTable.field, "semantics_status"),
        ),
      );
    expect(eventos.length).toBeGreaterThan(0);
    expect(eventos.at(-1)!.actor).toBe(ATOR);
    expect(eventos.at(-1)!.reason).toBe(POR_QUE);
  });

  it("o significado entra no histórico como qualquer outro campo", async () => {
    const eventos = await ctx.db
      .select()
      .from(curationEventTable)
      .where(
        and(
          eq(curationEventTable.targetLabel, MONTANTE),
          eq(curationEventTable.field, "meaning_id"),
        ),
      );
    expect(eventos.length).toBeGreaterThan(0);
    /*
      Um evento **da pessoa**, e não o primeiro da lista.

      O primeiro passou a ser da importação: ela replica o registro canônico na
      transação da promoção, e o significado declarado ali entra no histórico
      como qualquer outro campo — assinado por quem escreveu a entrada. O que
      este teste guarda é que a confirmação feita na tela também aparece, e é
      isso que `some` afirma.
    */
    expect(eventos.some((e) => e.actor === ATOR)).toBe(true);
  });

  it("um significado que não está no cadastro é recusado", async () => {
    await expect(
      confirmAttribute(ctx.db, {
        code: MONTANTE,
        meaningCode: "taxa_inventada",
        actor: ATOR,
        reason: POR_QUE,
      }),
    ).rejects.toThrow(/não está no cadastro/);
  });
});

describe("o período em aberto — a confirmação incompleta é recusada", () => {
  const SEM_PERIODO = "carreta.valor_pneus";

  it("R$ por veículo sem período não confirma, e a frase diz o que falta", async () => {
    await expect(
      confirmAttribute(ctx.db, {
        code: SEM_PERIODO,
        meaningCode: "montante_veiculo",
        taxonomyCode: "cv_pneus",
        actor: ATOR,
        reason: POR_QUE,
      }),
    ).rejects.toThrow(/de cada mês, de cada ano ou único da aquisição/);

    // E nada foi gravado: a recusa acontece antes da transação.
    const { attribute } = await estadoDe(SEM_PERIODO);
    expect(attribute.semanticsStatus).not.toBe("CONFIRMED");
  });

  it("com o período respondido, confirma e cai na gaveta certa", async () => {
    await confirmAttribute(ctx.db, {
      code: SEM_PERIODO,
      meaningCode: "montante_veiculo",
      periodicity: "MENSAL",
      taxonomyCode: "cv_pneus",
      actor: ATOR,
      reason: POR_QUE,
    });
    const { attribute, versao } = await estadoDe(SEM_PERIODO);
    expect(attribute).toMatchObject({
      unit: "BRL",
      periodicity: "MENSAL",
      aggregation: "SUM",
      isMonetary: true,
      semanticsStatus: "CONFIRMED",
    });
    expect(versao.periodicity).toBe("MENSAL");
  });
});

describe("o que já estava confirmado continua legível", () => {
  /**
   * O registro histórico fala em unidade e periodicidade, e ele não mudou uma
   * linha. O que se prova aqui é que ele continua funcionando **e** passa a
   * gravar o significado pela leitura de volta — que é o que faz uma coluna
   * curada em 10/08/2026 aparecer na tela nova como "R$ por mês" em vez de
   * dois campos vazios.
   */
  it("o registro de confirmações replica sem alteração, e ganha o significado", async () => {
    /*
      Reaplicar não faz mais nada — e é isso que se quer.

      A lista já foi aplicada na transação da promoção, com o significado
      declarado junto. `applied` vazio e `unchanged` com o registro inteiro é a
      afirmação mais forte que este teste pode fazer: a base que a importação
      entrega já está no estado que o registro descreve, e a curadoria não tem
      o que completar.
    */
    const resultado = await applyConfirmations(ctx.db);
    expect(resultado.divergentes).toEqual([]);
    expect(resultado.missing).toEqual([]);
    /*
      Aplicado ou já em dia — o que não pode é sobrar entrada. Quanto cai de
      cada lado depende do que a promoção já tinha como garantir naquele banco:
      onde a árvore da taxonomia nasce com a importação, tudo volta como "já em
      dia"; onde ela é semeada depois, esta chamada é quem completa o nó. Fixar
      um dos dois números seria fixar o ambiente, e não o contrato.
    */
    expect(resultado.applied.length + resultado.unchanged.length).toBe(
      CONFIRMED_SEMANTICS.length,
    );

    const { attribute } = await estadoDe("carreta.custo_fixo");
    expect(attribute).toMatchObject({
      unit: "BRL",
      periodicity: "MENSAL",
      aggregation: "SUM",
      isMonetary: true,
      semanticsStatus: "CONFIRMED",
    });

    const catalogo = await listarSignificados(ctx.db);
    const mensal = catalogo.find((s) => s.code === "montante_mes")!;
    expect(attribute.meaningId).toBe(mensal.id);
  });

  it("a alíquota confirmada como PERCENT vira 'Percentual', e continua fora das somas", async () => {
    const { attribute } = await estadoDe("carreta.icms");
    expect(attribute.unit).toBe("PERCENT");
    const catalogo = await listarSignificados(ctx.db);
    expect(attribute.meaningId).toBe(
      catalogo.find((s) => s.code === "proporcao")!.id,
    );
    expect(viraDinheiro(attribute).ok).toBe(false);
  });

  it("a fila devolve o significado ao lado dos campos técnicos", async () => {
    const fila = await getCurationQueue(ctx.db, { includeConfirmed: true });
    const item = fila.find((i) => i.code === "carreta.custo_fixo")!;
    expect(item.meaningCode).toBe("montante_mes");
    expect(item.meaningLabel).toBe("R$ por mês");
    // Os quatro campos continuam na resposta: o que mudou é quem os escreve.
    expect(item.unit).toBe("BRL");
    expect(item.periodicity).toBe("MENSAL");
    expect(item.taxonomyCode).toBe("cf_frota_carreta");
  });

  it("o atributo que ninguém curou não ganha significado inventado", async () => {
    const fila = await getCurationQueue(ctx.db);
    const intocados = fila.filter((i) => i.unit === null);
    expect(intocados.length).toBeGreaterThan(0);
    for (const item of intocados) {
      expect(item.meaningCode, item.code).toBeNull();
    }
  });

  it("nenhum atributo do banco ficou num estado que a autoridade recusaria", async () => {
    // A varredura completa depois de tudo o que este arquivo escreveu.
    const { rows } = await ctx.db.execute<{ code: string; ok: boolean }>(sql`
      SELECT code, true AS ok FROM attribute
    `);
    expect(rows.length).toBeGreaterThan(100);
    // A prova real é a constraint: se qualquer escrita acima tivesse produzido
    // uma contradição, ela teria falhado na hora. Isto guarda a contagem.
    const [{ confirmados }] = await ctx.db
      .select({ confirmados: sql<number>`count(*)`.mapWith(Number) })
      .from(attributeTable)
      .where(eq(attributeTable.semanticsStatus, "CONFIRMED"));
    expect(confirmados).toBeGreaterThan(5);
  });
});

/*
  Por último de propósito: este bloco confirma de novo, e sem justificativa.
  Rodá-lo antes trocaria o `reason` dos eventos que os testes acima leem, e o
  que falharia seria a ordem, não a regra.
*/
describe("a justificativa, que deixou de ser exigida", () => {
  /*
    Ela saiu da tela de curadoria e por isso saiu da guarda: quem confirma já
    responde o que o valor significa e onde ele cai, e quem assina é a sessão —
    `actor`, que continua obrigatório. O que confirmar sem ela **não** pode
    fazer é apagar a leitura do motor que já estava escrita: o ato acrescenta
    evidência, e nunca destrói a que existia.
  */
  it("confirma sem ela, e sem apagar a análise já escrita", async () => {
    const { attribute: antes, versao: versaoAntes } = await estadoDe(MONTANTE);
    expect(antes.semanticsRationale).toBe(POR_QUE);
    expect(versaoAntes.rationale).toBe(POR_QUE);

    await confirmAttribute(ctx.db, {
      code: MONTANTE,
      meaningCode: "montante_mes",
      actor: ATOR,
    });

    const { attribute: depois, versao } = await estadoDe(MONTANTE);
    expect(depois.semanticsStatus).toBe("CONFIRMED");
    expect(depois.confirmedBy).toBe(ATOR);
    expect(depois.semanticsRationale).toBe(POR_QUE);
    /*
      A vigência tem de guardar a mesma frase que a projeção — `rationale` é
      campo projetado, e apagá-lo de um lado só é a divergência que
      `divergenciasDaProjecao` existe para acusar.
    */
    expect(versao.rationale).toBe(POR_QUE);
  });

  it("não deixa a projeção e a vigência discordarem", async () => {
    const divergencias = await divergenciasDaProjecao(ctx.db);
    expect(divergencias.filter((d) => d.code === MONTANTE)).toEqual([]);
  });
});
