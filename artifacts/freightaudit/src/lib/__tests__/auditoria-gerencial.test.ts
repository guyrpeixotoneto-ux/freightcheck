import { describe, expect, it } from "vitest";
import {
  anosComVigencia,
  nomeDoEscopo,
  impactoDominante,
  impactosOrdenados,
  quinzenasDoAno,
  resumirEscopo,
  resumirUnidades,
  resumoExecutivo,
  subtituloDoCartao,
  type ComparacaoDaVigencia,
  type VigenciaDaAuditoria,
} from "../auditoria-gerencial";

/**
 * O que a Visão Gerencial da Auditoria decide sozinha.
 *
 * É uma home: a tela responde antes de perguntar, com um percentual por unidade
 * lido por quem tem menos contexto. Nada aqui testa pixel. O que roda são as
 * decisões que, se errarem, fazem a tela mentir com aparência de total:
 *
 * 1. a diferença entre a vigência que ninguém comparou e a que não mudou nada —
 *    as duas dão zero numa contagem ingênua, e são opostas;
 * 2. a diferença entre a quinzena sem vigência (o cadastro parado) e a vigência
 *    pendente (o trabalho parado), porque só a segunda é alarme;
 * 3. o denominador do percentual, que são as vigências **comparáveis** e não as
 *    do ano — a primeira de uma série não tem anterior;
 * 4. a separação por canal, que o motor de comparação recusa-se a atravessar;
 * 5. o impacto, somado dentro de cada periodicidade e nunca entre elas.
 */

const HOJE = "2026-08-19";

const CONTEXTO = {
  scopeHash: "scope-camacari",
  channel: "EMPURRADA" as string | null,
  label: "CAMAÇARI · EMPURRADA",
  scopes: [{ scopeType: "UNIDADE", code: "0123", name: "CAMAÇARI" }],
};

/** Uma vigência com o mínimo que os testes precisam nomear. */
function vigencia(entrada: {
  unidade?: string;
  nome?: string | null;
  canal?: string | null;
  data?: string;
  cobertura?: string;
  ativos?: number;
  /** A data da anterior da série. `null` é a primeira — não há o que comparar. */
  anterior?: string | null;
  comparacao?: Partial<ComparacaoDaVigencia> | null;
}): VigenciaDaAuditoria {
  const codigo = entrada.unidade ?? CONTEXTO.scopeHash;
  const canal = entrada.canal === undefined ? CONTEXTO.channel : entrada.canal;
  const nome = entrada.nome === undefined ? "CAMAÇARI" : entrada.nome;
  const data = entrada.data ?? "2026-08-01";
  const cobertura = entrada.cobertura ?? "CAVALO";
  const anterior = entrada.anterior === undefined ? "2026-07-16" : entrada.anterior;

  return {
    contexto: {
      scopeHash: codigo,
      channel: canal,
      label: canal ? `${nome ?? codigo} · ${canal}` : (nome ?? codigo),
      scopes: nome === null ? [] : [{ scopeType: "UNIDADE", code: "0123", name: nome }],
    },
    snapshotId: `${codigo}|${canal}|${cobertura}|${data}`,
    sourceLabel: `${canal ?? "SEM_CANAL"}_${Number(data.slice(8, 10))}_${Number(data.slice(5, 7))}_${data.slice(0, 4)}`,
    effectiveDate: data,
    entityTypeSet: cobertura,
    ativos: entrada.ativos ?? 0,
    anterior:
      anterior === null
        ? null
        : {
            snapshotId: `${codigo}|${canal}|${cobertura}|${anterior}`,
            sourceLabel: `${canal ?? "SEM_CANAL"}_anterior`,
            effectiveDate: anterior,
          },
    comparacao:
      entrada.comparacao === undefined || entrada.comparacao === null
        ? null
        : {
            id: `cs|${codigo}|${data}`,
            status: "DONE",
            alteracoes: 0,
            entrantes: 0,
            saintes: 0,
            inconclusivas: 0,
            semPreco: 0,
            foraDoTotal: 0,
            impacto: {},
            ...entrada.comparacao,
          },
  };
}

describe("a faixa do ano", () => {
  /*
    A quinzena em que a fonte não publicou nada é o ritmo do cliente, e ela só
    aparece se houver uma casa vazia esperando por ela. Montar a faixa a partir
    do que existe faria a pausa desaparecer.
  */
  it("tem 24 casas em ordem de calendário, mesmo sem vigência nenhuma", () => {
    const faixa = quinzenasDoAno([], 2026, HOJE);

    expect(faixa).toHaveLength(24);
    expect(faixa[0].chave).toBe("2026-01-Q1");
    expect(faixa[23].chave).toBe("2026-12-Q2");
    expect(faixa.every((q) => q.vigencias.length === 0)).toBe(true);
  });

  it("põe a vigência na casa que contém a data dela", () => {
    const faixa = quinzenasDoAno(
      [
        vigencia({ data: "2026-03-01" }),
        vigencia({ data: "2026-03-15", cobertura: "CARRETA" }),
        vigencia({ data: "2026-04-16" }),
        vigencia({ data: "2026-05-31" }),
      ],
      2026,
      HOJE,
    );
    const em = (chave: string) => faixa.find((q) => q.chave === chave)!.vigencias.length;

    expect(em("2026-03-Q1")).toBe(2);
    expect(em("2026-03-Q2")).toBe(0);
    expect(em("2026-04-Q2")).toBe(1);
    expect(em("2026-05-Q2")).toBe(1);
  });

  it("separa a quinzena que passou sem publicação da que ainda não venceu", () => {
    const faixa = quinzenasDoAno([], 2026, HOJE);
    const em = (chave: string) => faixa.find((q) => q.chave === chave)!.situacao;

    expect(em("2026-07-Q2")).toBe("SEM_VIGENCIA");
    // 16 a 31/08 ainda corre em 19/08: não é ausência, é calendário.
    expect(em("2026-08-Q2")).toBe("FUTURA");
    expect(em("2026-12-Q2")).toBe("FUTURA");
  });

  /*
    O defeito que este caso guarda é o mais caro da tela: uma vigência que
    chegou e nunca foi comparada tem zero alteração gravada, exatamente como
    uma vigência em que o cliente não mexeu em nada. Se as duas caíssem na
    mesma casa, a faixa diria "auditado" sobre o que ninguém olhou.
  */
  it("distingue a vigência sem comparação da vigência sem alteração", () => {
    const naoComparada = quinzenasDoAno([vigencia({ data: "2026-07-01" })], 2026, HOJE);
    const semAlteracao = quinzenasDoAno(
      [vigencia({ data: "2026-07-01", comparacao: { alteracoes: 0 } })],
      2026,
      HOJE,
    );

    expect(naoComparada.find((q) => q.chave === "2026-07-Q1")!.situacao).toBe("PENDENTE");
    expect(semAlteracao.find((q) => q.chave === "2026-07-Q1")!.situacao).toBe("AUDITADA");
  });

  it("não cobra comparação da primeira vigência da série", () => {
    const faixa = quinzenasDoAno(
      [vigencia({ data: "2026-02-01", anterior: null })],
      2026,
      HOJE,
    );

    expect(faixa.find((q) => q.chave === "2026-02-Q1")!.situacao).toBe("INICIAL");
  });

  /*
    Uma quinzena pode receber mais de uma vigência — uma por série entregue.
    Basta uma sem comparação para a casa ser pendente: dá-la por auditada
    porque a outra série foi comparada é declarar olhado o que ninguém olhou.
  */
  it("dá a casa por pendente quando qualquer vigência dela está sem comparação", () => {
    const faixa = quinzenasDoAno(
      [
        vigencia({ data: "2026-06-01", cobertura: "CAVALO", comparacao: { alteracoes: 9 } }),
        vigencia({ data: "2026-06-02", cobertura: "CARRETA" }),
      ],
      2026,
      HOJE,
    );

    expect(faixa.find((q) => q.chave === "2026-06-Q1")!.situacao).toBe("PENDENTE");
  });

  /*
    `STALE` é a comparação que a migration do impacto oficial marcou como
    inservível: os totais dela são zero. Lê-la como número publicaria "nenhuma
    alteração" sobre uma vigência que ninguém recomparou.
  */
  it("trata a comparação obsoleta como pendência, e não como número", () => {
    const faixa = quinzenasDoAno(
      [
        vigencia({
          data: "2026-06-01",
          comparacao: { status: "STALE", alteracoes: 0, impacto: {} },
        }),
      ],
      2026,
      HOJE,
    );
    const casa = faixa.find((q) => q.chave === "2026-06-Q1")!;

    expect(casa.situacao).toBe("PENDENTE");
    expect(casa.auditadas).toBe(0);
  });

  it("soma na casa só o que a comparação pronta gravou", () => {
    const faixa = quinzenasDoAno(
      [
        vigencia({
          data: "2026-06-01",
          comparacao: { alteracoes: 12, semPreco: 3, impacto: { MENSAL: 100 } },
        }),
        vigencia({ data: "2026-06-10", cobertura: "CARRETA", comparacao: { status: "PENDING", alteracoes: 999 } }),
      ],
      2026,
      HOJE,
    );
    const casa = faixa.find((q) => q.chave === "2026-06-Q1")!;

    expect(casa.alteracoes).toBe(12);
    expect(casa.semPreco).toBe(3);
    expect(casa.impacto).toEqual({ MENSAL: 100 });
  });
});

describe("o resumo de uma unidade", () => {
  /*
    O denominador são as vigências que tinham com que ser comparadas. Dividir
    pelas vigências do ano faria uma unidade que estreou em fevereiro aparecer
    eternamente atrasada por uma comparação que não existe.
  */
  it("mede o percentual sobre as vigências comparáveis, e não sobre todas", () => {
    const [unidade] = resumirUnidades(
      [
        vigencia({ data: "2026-02-01", anterior: null }),
        vigencia({ data: "2026-03-01", comparacao: { alteracoes: 4 } }),
        vigencia({ data: "2026-04-01", comparacao: { alteracoes: 2 } }),
        vigencia({ data: "2026-05-01" }),
      ],
      2026,
      HOJE,
    );

    expect(unidade.vigencias).toBe(4);
    expect(unidade.iniciais).toBe(1);
    expect(unidade.comparaveis).toBe(3);
    expect(unidade.auditadas).toBe(2);
    expect(unidade.pendentes).toBe(1);
    expect(Math.round(unidade.percentualAuditado!)).toBe(67);
  });

  /*
    Uma unidade cuja única vigência do ano é a primeira da série não está com 0%
    de auditoria: não há transição nenhuma a auditar. Zero ali seria lido como
    fracasso, e a única frase honesta é a que a tela escreve — "nenhuma com
    anterior a comparar".
  */
  it("devolve nulo, e não zero, quando não havia nada comparável", () => {
    const [unidade] = resumirUnidades(
      [vigencia({ data: "2026-02-01", anterior: null })],
      2026,
      HOJE,
    );

    expect(unidade.percentualAuditado).toBeNull();
    expect(unidade.pendentes).toBe(0);
  });

  /*
    Duas séries da mesma unidade em canais diferentes descrevem remunerações que
    não se sucedem — o motor recusa-se a compará-las. Um cartão só somaria dois
    universos e anunciaria um total que o produto não calcula.
  */
  it("mantém canais da mesma unidade em cartões separados", () => {
    const unidades = resumirUnidades(
      [
        vigencia({ canal: "EMPURRADA", comparacao: { alteracoes: 10 } }),
        vigencia({ canal: "ROTA", comparacao: { alteracoes: 3 } }),
      ],
      2026,
      HOJE,
    );

    expect(unidades).toHaveLength(2);
    expect(unidades.map((u) => u.channel).sort()).toEqual(["EMPURRADA", "ROTA"]);
    expect(unidades.map((u) => u.alteracoes).sort((a, b) => a - b)).toEqual([3, 10]);
  });

  it("soma o impacto dentro de cada periodicidade, e nunca entre elas", () => {
    const [unidade] = resumirUnidades(
      [
        vigencia({ data: "2026-03-01", comparacao: { impacto: { MENSAL: 1_000, ANUAL: 500 } } }),
        vigencia({ data: "2026-04-01", comparacao: { impacto: { MENSAL: -250 } } }),
      ],
      2026,
      HOJE,
    );

    expect(unidade.impacto).toEqual({ MENSAL: 750, ANUAL: 500 });
  });

  /*
    A comparação de janeiro é contra dezembro do ano anterior, e ela pertence a
    janeiro: a alteração aconteceu quando a vigência nova chegou. Contá-la
    também em dezembro faria a mesma alteração aparecer em dois anos.
  */
  it("conta a transição no ano da vigência nova", () => {
    const linhas = [
      vigencia({ data: "2026-01-01", anterior: "2025-12-16", comparacao: { alteracoes: 7 } }),
      vigencia({ data: "2025-12-16", anterior: "2025-12-01", comparacao: { alteracoes: 5 } }),
    ];

    expect(resumirUnidades(linhas, 2026, HOJE)[0].alteracoes).toBe(7);
    expect(resumirUnidades(linhas, 2025, HOJE)[0].alteracoes).toBe(5);
  });

  /*
    A frota da unidade é a que a vigência mais recente declarou, somando as
    séries daquela data — cavalos e carretas chegam em snapshots separados.
    Somar todas as vigências do ano contaria o mesmo caminhão a cada quinzena.
  */
  it("lê a frota da vigência mais recente, somando as séries daquela data", () => {
    const [unidade] = resumirUnidades(
      [
        vigencia({ data: "2026-03-01", cobertura: "CAVALO", ativos: 50 }),
        vigencia({ data: "2026-04-01", cobertura: "CAVALO", ativos: 64 }),
        vigencia({ data: "2026-04-01", cobertura: "CARRETA", ativos: 80 }),
      ],
      2026,
      HOJE,
    );

    expect(unidade.ultimaVigencia).toBe("2026-04-01");
    expect(unidade.ativos).toBe(144);
    expect(unidade.coberturas).toEqual(["CARRETA", "CAVALO"]);
  });

  /*
    Uma casca de TRECHO (`entityTypeSet === "TRECHO"`, sem frota) mais recente
    que a vigência de equipamento não pode virar `ultimaVigencia`: o cartão
    linkaria para uma data que o Parâmetros não reconhece como período — a
    mesma exclusão de `naoEhSoTrecho` em `lib/comparison/src/series.ts`,
    refeita aqui em JS.
  */
  it("ignora a casca de TRECHO ao escolher a última vigência do cartão", () => {
    const [unidade] = resumirUnidades(
      [
        vigencia({ data: "2026-07-16", cobertura: "CAVALO", ativos: 50 }),
        vigencia({ data: "2026-08-02", cobertura: "TRECHO", ativos: 0 }),
      ],
      2026,
      HOJE,
    );

    expect(unidade.ultimaVigencia).toBe("2026-07-16");
    expect(unidade.ativos).toBe(50);
  });

  it("conta como lacuna a quinzena vencida em que a unidade não publicou", () => {
    const [unidade] = resumirUnidades(
      [vigencia({ data: "2026-08-01", comparacao: { alteracoes: 1 } })],
      2026,
      HOJE,
    );

    // Quinze quinzenas venceram até 19/08 (jan a jul, mais 01–15/08); a de
    // agosto tem vigência, então quatorze ficaram sem publicação.
    expect(unidade.lacunas).toBe(14);
  });

  /*
    A ordem é a do trabalho que falta, e não a alfabética: a tela existe para
    dizer onde ir.
  */
  it("põe na frente quem tem vigência sem comparação, e depois quem tem inconclusiva", () => {
    const unidades = resumirUnidades(
      [
        vigencia({ unidade: "u-a", nome: "AAA", comparacao: { alteracoes: 1 } }),
        vigencia({
          unidade: "u-b",
          nome: "BBB",
          comparacao: { alteracoes: 1, inconclusivas: 9 },
        }),
        vigencia({ unidade: "u-c", nome: "CCC" }),
      ],
      2026,
      HOJE,
    );

    expect(unidades.map((u) => u.nome)).toEqual(["CCC", "BBB", "AAA"]);
  });
});

describe("o resumo executivo", () => {
  it("soma as unidades e distingue contexto de unidade", () => {
    const total = resumoExecutivo(
      resumirUnidades(
        [
          vigencia({ canal: "EMPURRADA", comparacao: { alteracoes: 10, semPreco: 2 } }),
          vigencia({ canal: "ROTA", comparacao: { alteracoes: 3, semPreco: 1 } }),
          vigencia({ unidade: "u-b", nome: "OUTRA", comparacao: { alteracoes: 5 } }),
        ],
        2026,
        HOJE,
      ),
    );

    expect(total.contextos).toBe(3);
    expect(total.unidades).toBe(2);
    expect(total.alteracoes).toBe(18);
    expect(total.semPreco).toBe(3);
    expect(total.auditadas).toBe(3);
    expect(total.percentualAuditado).toBe(100);
  });

  it("devolve percentual nulo quando o ano não teve nada comparável", () => {
    const total = resumoExecutivo(
      resumirUnidades([vigencia({ data: "2026-02-01", anterior: null })], 2026, HOJE),
    );

    expect(total.percentualAuditado).toBeNull();
    expect(total.vigencias).toBe(1);
  });
});

describe("o impacto", () => {
  /*
    Por módulo e não por sinal: o que decide a atenção de quem lê é o tamanho do
    número, e um ano pode muito bem ter o maior movimento a favor.
  */
  it("ordena por tamanho, e não por sinal", () => {
    expect(impactosOrdenados({ MENSAL: 100, ANUAL: -5_000 })).toEqual([
      { periodicity: "ANUAL", amount: -5_000 },
      { periodicity: "MENSAL", amount: 100 },
    ]);
    expect(impactoDominante({ MENSAL: 100, ANUAL: -5_000 })!.periodicity).toBe("ANUAL");
  });

  it("não inventa periodicidade quando não há impacto apurado", () => {
    expect(impactosOrdenados({})).toEqual([]);
    expect(impactoDominante({})).toBeNull();
  });
});

describe("os anos", () => {
  it("oferece só os anos que têm vigência, do mais recente ao mais antigo", () => {
    expect(
      anosComVigencia([
        vigencia({ data: "2026-01-01" }),
        vigencia({ data: "2024-05-16" }),
        vigencia({ data: "2026-08-01" }),
      ]),
    ).toEqual([2026, 2024]);
  });
});

/**
 * O arquivo EMPURRADA_Cavalo, como a home o lê depois da garantia da promoção.
 *
 * Cinco unidades, seis vigências quinzenais de junho a agosto, e portanto 25
 * transições. Antes de a promoção garantir as comparações, a tela publicava
 * "4% · 1 de 25 vigências comparada" — não porque algo tivesse falhado, mas
 * porque `change_set` só nascia quando alguém abria a tela de Alterações, uma
 * unidade e um par de cada vez. O que muda aqui é o insumo, não a aritmética:
 * as mesmas funções, alimentadas com o que a promoção agora deixa gravado.
 *
 * O outro lado desta prova continua valendo, e é o que este caso não pode
 * deixar de dizer: **as quinzenas anteriores a junho continuam sem vigência**.
 * A fonte não publicou nada de janeiro a maio, e garantir comparação nenhuma
 * as inventa — elas seguem como ausência de histórico (casa apagada), nunca
 * como trabalho atrasado.
 */
describe("cinco unidades, seis vigências — o caso EMPURRADA_Cavalo", () => {
  const HOJE_REAL = "2026-08-24";

  const UNIDADES = ["CAMAÇARI", "PERNAMBUCO", "CDD CEBRASA", "EQUATORIAL", "MANAUS"];
  /** As datas das seis quinzenas, como o rótulo `EMPURRADA_<q>_<mês>_2026` as gera. */
  const DATAS = ["2026-06-01", "2026-06-02", "2026-07-01", "2026-07-02", "2026-08-01", "2026-08-02"];

  /** O acervo com todas as transições materializadas — o depois da garantia. */
  const comparadas = UNIDADES.flatMap((nome) =>
    DATAS.map((data, i) =>
      vigencia({
        unidade: `scope-${nome}`,
        nome,
        data,
        ativos: 15,
        anterior: i === 0 ? null : DATAS[i - 1],
        comparacao: i === 0 ? null : { alteracoes: 4 },
      }),
    ),
  );

  it("sai de 1 de 25 para 25 de 25, sem mexer no denominador", () => {
    const unidades = resumirUnidades(comparadas, 2026, HOJE_REAL);
    const total = resumoExecutivo(unidades);

    expect(unidades).toHaveLength(5);
    expect(total).toMatchObject({
      unidades: 5,
      vigencias: 30,
      // As cinco primeiras de série não entram no denominador: elas não têm
      // anterior, e contá-las faria toda unidade estrear reprovada.
      comparaveis: 25,
      auditadas: 25,
      pendentes: 0,
      iniciais: 5,
      percentualAuditado: 100,
    });
    for (const unidade of unidades) {
      expect(unidade).toMatchObject({ comparaveis: 5, auditadas: 5, pendentes: 0, iniciais: 1 });
    }
  });

  it("as quinzenas anteriores a junho continuam sem vigência", () => {
    const [unidade] = resumirUnidades(comparadas, 2026, HOJE_REAL);
    const em = (chave: string) => unidade.quinzenas.find((q) => q.chave === chave)!.situacao;

    // Dez casas de janeiro a maio, mais as duas segundas quinzenas que a fonte
    // pulou: doze quinzenas sem vigência, e nenhuma delas em vermelho.
    expect(unidade.lacunas).toBe(12);
    expect(em("2026-01-Q1")).toBe("SEM_VIGENCIA");
    expect(em("2026-05-Q2")).toBe("SEM_VIGENCIA");
    expect(em("2026-06-Q2")).toBe("SEM_VIGENCIA");
    // Onde a fonte publicou, a casa está auditada — e agosto/Q2 ainda corre.
    expect(em("2026-06-Q1")).toBe("AUDITADA");
    expect(em("2026-08-Q1")).toBe("AUDITADA");
    expect(em("2026-08-Q2")).toBe("FUTURA");
    expect(unidade.quinzenas.filter((q) => q.situacao === "PENDENTE")).toHaveLength(0);
  });

  it("sem a garantia, as mesmas seis vigências ficam pendentes — e as lacunas não mudam", () => {
    // O estado que a tela mostrava: vigência com anterior e sem comparação.
    const semComparacao = comparadas.map((v) => ({ ...v, comparacao: null }));
    const unidades = resumirUnidades(semComparacao, 2026, HOJE_REAL);
    const total = resumoExecutivo(unidades);

    expect(total).toMatchObject({ comparaveis: 25, auditadas: 0, pendentes: 25, percentualAuditado: 0 });
    // A diferença entre os dois estados é só a comparação: a ausência de
    // vigência de janeiro a maio é a mesma nos dois, porque ela é da fonte.
    expect(unidades.every((u) => u.lacunas === 12)).toBe(true);
  });
});

/**
 * O Painel de Unidades aberto numa unidade só.
 *
 * A lateral sempre escreveu `scopeHash` no endereço do Painel, e o Painel sempre
 * resumiu o acervo inteiro: o filtro era prometido e não aplicado. O que roda
 * aqui são as decisões que a correção tomou, e que erradas fariam a tela mentir
 * com aparência de recorte:
 *
 * 1. o cartão é **da unidade**, e o canal não o parte — pedir CAMAÇARI e receber
 *    "CAMAÇARI · ROTA", com a metade EMPURRADA fora da tela e sem uma palavra,
 *    responde outra pergunta;
 * 2. a unidade sem vigência no ano devolve lista vazia, e não um cartão zerado:
 *    a tela precisa distinguir "não publicou" de "publicou e não mudou nada";
 * 3. o resto do acervo fica de fora inteiro — inclusive da aritmética, porque a
 *    faixa do topo se calcula da mesma lista.
 */
describe("o Painel aberto numa unidade", () => {
  const acervo = [
    vigencia({ data: "2026-08-01", comparacao: { alteracoes: 10 } }),
    vigencia({ data: "2026-07-16", anterior: null }),
    vigencia({
      unidade: "scope-manaus",
      nome: "MANAUS",
      data: "2026-08-01",
      comparacao: { alteracoes: 99 },
    }),
  ];

  /* O requisito 1: sem escopo, o acervo inteiro. É a porta de entrada. */
  it("sem escopo, resume todas as unidades", () => {
    const todas = resumirUnidades(acervo, 2026, HOJE);

    expect(todas.map((u) => u.nome).sort()).toEqual(["CAMAÇARI", "MANAUS"]);
  });

  /* O requisito 2: com escopo, só ela. */
  it("com escopo, resume só a unidade pedida", () => {
    const so = resumirEscopo(acervo, 2026, HOJE, "scope-camacari");

    expect(so).toHaveLength(1);
    expect(so[0].nome).toBe("CAMAÇARI");
    expect(so[0].alteracoes).toBe(10);
  });

  /*
    O requisito 3, pelo lado da aritmética: a faixa do topo lê a mesma lista que
    os cartões, então filtrar os cartões e não a conta produziria um cartão de
    CAMAÇARI sob um total que inclui MANAUS.
  */
  it("deixa o resto do acervo fora também da soma", () => {
    const total = resumoExecutivo(resumirEscopo(acervo, 2026, HOJE, "scope-camacari"));

    expect(total.unidades).toBe(1);
    expect(total.alteracoes).toBe(10);
  });

  /* O requisito 5. Lista vazia, e não um cartão de zeros que pareceria dado. */
  it("devolve nada quando a unidade não publicou no ano pedido", () => {
    const deDoisAnos = [
      vigencia({ data: "2026-08-01", comparacao: { alteracoes: 10 } }),
      vigencia({
        unidade: "scope-manaus",
        nome: "MANAUS",
        data: "2025-08-01",
        anterior: "2025-07-16",
        comparacao: { alteracoes: 4 },
      }),
    ];

    expect(resumirEscopo(deDoisAnos, 2026, HOJE, "scope-manaus")).toEqual([]);
    /* E o vazio sabe de quem está falando, mesmo sem cartão de onde tirar o nome. */
    expect(nomeDoEscopo(deDoisAnos, "scope-manaus")).toBe("MANAUS");
    /* O acervo continua tendo o ano — é o que separa os dois textos de vazio. */
    expect(resumirUnidades(deDoisAnos, 2026, HOJE)).toHaveLength(1);
  });

  it("chama a unidade desconhecida pelo que ela é, e não pelo scopeHash", () => {
    expect(nomeDoEscopo([], "scope-fantasma")).toBe("A unidade");
  });
});

/**
 * O requisito 6 — a unidade com mais de um canal.
 *
 * Na Visão Geral o cartão é do contexto, e dois canais são dois cartões: o motor
 * recusa-se a comparar uma série com a outra, e é a decisão que `resumirUnidades`
 * documenta. No modo unidade a pergunta é outra — "como está CAMAÇARI" —, e a
 * resposta é um cartão só. Nada aqui compara canal com canal: soma resultados
 * que já estavam prontos, como a faixa do topo sempre somou os contextos do
 * acervo inteiro.
 */
describe("a unidade com dois canais", () => {
  const doisCanais = [
    vigencia({
      canal: "EMPURRADA",
      data: "2026-08-01",
      ativos: 100,
      comparacao: { alteracoes: 10, impacto: { MONTHLY: -1000 } },
    }),
    vigencia({
      canal: "ROTA",
      data: "2026-07-16",
      anterior: "2026-07-01",
      ativos: 30,
      comparacao: { alteracoes: 5, impacto: { MONTHLY: -500 } },
    }),
  ];

  it("continua sendo dois cartões na Visão Geral", () => {
    expect(resumirUnidades(doisCanais, 2026, HOJE)).toHaveLength(2);
  });

  it("vira um cartão só quando a unidade é o recorte", () => {
    const [cartao] = resumirEscopo(doisCanais, 2026, HOJE, "scope-camacari");

    expect(cartao.nome).toBe("CAMAÇARI");
    expect(cartao.canais).toEqual(["EMPURRADA", "ROTA"]);
    expect(cartao.alteracoes).toBe(15);
    expect(cartao.impacto).toEqual({ MONTHLY: -1500 });
    expect(cartao.comparaveis).toBe(2);
  });

  /*
    O cartão não pode esconder de quantos canais ele veio: o rodapé é o único
    lugar em que "esta soma tem duas origens" cabe escrito, e sem ele o número
    parece de uma partição só.
  */
  it("declara no rótulo os canais que somou", () => {
    const [cartao] = resumirEscopo(doisCanais, 2026, HOJE, "scope-camacari");

    expect(cartao.label).toBe("CAMAÇARI · EMPURRADA + ROTA");
    /* `channel` nulo é o que impede o link de abrir Parâmetros numa das metades. */
    expect(cartao.channel).toBeNull();
  });

  /*
    A frota é a última **de cada canal**, somada. Filtrar pela data mais recente
    entre os dois zeraria quem publicou antes — CAMAÇARI apareceria com 100
    ativos em vez de 130 por um detalhe de calendário.
  */
  it("soma a última frota de cada canal, e não só a do que publicou por último", () => {
    const [cartao] = resumirEscopo(doisCanais, 2026, HOJE, "scope-camacari");

    expect(cartao.ativos).toBe(130);
  });

  /* Com um canal só, `canais` tem um item e nada muda em relação ao de sempre. */
  it("não mexe no cartão de quem tem um canal só", () => {
    const [cartao] = resumirEscopo([doisCanais[0]], 2026, HOJE, "scope-camacari");

    expect(cartao.canais).toEqual(["EMPURRADA"]);
    expect(cartao.channel).toBe("EMPURRADA");
    expect(cartao.label).toBe("CAMAÇARI · EMPURRADA");
    expect(cartao.ativos).toBe(100);
  });
});

describe("o subtítulo do cartão", () => {
  /*
    O nome está no título, em corpo maior, uma linha acima. Repetido embaixo ele
    gastava metade da linha dizendo o que ninguém precisava reler — e num
    telefone era a cobertura, no fim da frase, que pagava a conta.
  */
  it("tira o nome da unidade do rótulo e deixa o que qualifica", () => {
    expect(
      subtituloDoCartao({
        nome: "CAMAÇARI",
        label: "CAMAÇARI · EMPURRADA",
        coberturas: ["CARRETA+CAVALO+TRECHO"],
      }),
    ).toBe("EMPURRADA · CARRETA+CAVALO+TRECHO");
  });

  it("mantém os dois canais quando o cartão soma mais de um", () => {
    expect(
      subtituloDoCartao({
        nome: "CAMAÇARI",
        label: "CAMAÇARI · EMPURRADA + ROTA",
        coberturas: ["CAVALO"],
      }),
    ).toBe("EMPURRADA + ROTA · CAVALO");
  });

  /* Sem escopo cadastrado o rótulo **é** o nome: não há canal a anunciar. */
  it("fica só com a cobertura quando o rótulo é o próprio nome", () => {
    expect(
      subtituloDoCartao({ nome: "scope-x", label: "scope-x", coberturas: ["CAVALO"] }),
    ).toBe("CAVALO");
  });

  /* Um rótulo que não começa pelo nome não é adivinhado — vai inteiro. */
  it("preserva o rótulo que não começa pelo nome", () => {
    expect(
      subtituloDoCartao({ nome: "CAMAÇARI", label: "BA · EMPURRADA", coberturas: [] }),
    ).toBe("BA · EMPURRADA");
  });
});
