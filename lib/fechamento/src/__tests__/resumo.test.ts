import { describe, expect, it } from "vitest";
import { montarResumo, type QuinzenaApurada } from "../resumo";
import { montarMapaDaQuinzena, type ParametrosDoCadastro } from "../mapa-rota";
import { conferirDePara } from "../de-para";
import { lerPagamento } from "../leitores/pagamento";
import { fixturePagamentoDoPainel } from "./fixtures";

/**
 * O resumo do mês — a aritmética das três colunas, sem banco.
 *
 * O que estes testes prendem não é a soma (somar dois números não precisa de
 * teste): é a **ausência**. Meio mês importado é o estado normal de quem está
 * trabalhando, e a diferença entre "esta quinzena valeu zero" e "esta quinzena
 * não foi apurada" é a única coisa que a planilha não sabe dizer e que esta
 * tela existe para dizer.
 */

const unidade = { codigo: "443", nome: "CDD FICTICIO" };
const transportadora = { codigo: "36", nome: "TRANSPORTES FICTICIA LTDA" };

function quinzena(n: 1 | 2, dados: Partial<QuinzenaApurada> = {}): QuinzenaApurada {
  return {
    quinzena: n,
    competenciaId: `id-${n}`,
    chave: `2026-07-Q${n}`,
    estado: "APURADA",
    verbas: [
      { vbz: 1, canal: "ROTA", nome: "Frota Fixa Ativa", natureza: "FIXO", emitido: 100 * n, esperado: 100 * n },
      { vbz: 5, canal: "ROTA", nome: "Frota Fixa Variável", natureza: "VARIAVEL", emitido: 50 * n, esperado: null },
    ],
    demonstrativo: [{ canal: "ROTA", total: 140 * n }],
    descontos: [
      { canal: "ROTA", tipo: "FRETE_MINIMO", valor: 10 * n },
      { canal: "ROTA", tipo: "DISPONIBILIDADE_CUSTO_FIXO", valor: 0 },
    ],
    ...dados,
  };
}

const montar = (quinzenas: QuinzenaApurada[]) =>
  montarResumo({ ano: 2026, mes: 7, unidade, transportadora, quinzenas });

/**
 * O painel do 03.08.20 da quinzena, como `lerResumoDoMes` o entrega.
 *
 * A coluna do demonstrativo sai do mesmo objeto de propósito: no leitor, as
 * duas somam `valor_faturado` dos mesmos itens — `somarDemonstrativo` para a
 * conferência por verba e `lerDeParaDaCompetencia` para o painel. Alimentar o
 * teste com dois números diferentes testaria uma montagem que não existe.
 */
const comPainel = (n: 1 | 2) => {
  const conferido = conferirDePara(lerPagamento(fixturePagamentoDoPainel()));
  return quinzena(n, {
    paineis: [conferido],
    demonstrativo: [{ canal: "ROTA", total: conferido.totalDoRelatorio! }],
  });
};

describe("o resumo do mês", () => {
  it("põe as duas quinzenas lado a lado e soma o total", () => {
    const resumo = montar([quinzena(1), quinzena(2)]);
    const rota = resumo.canais.find((c) => c.canal === "ROTA")!;
    const fixo = rota.blocos.find((b) => b.natureza === "FIXO")!;

    expect(fixo.linhas[0]?.emitido).toEqual({ primeira: 100, segunda: 200, total: 300 });
    expect(rota.emitido).toEqual({ primeira: 150, segunda: 300, total: 450 });
    /* Só a VBZ 1 é reconstruída; a 5 entrou sem origem. */
    expect(rota.conferido).toEqual({ primeira: 100, segunda: 200, total: 300 });
    expect(rota.semFonte).toEqual({ primeira: 50, segunda: 100, total: 150 });
  });

  it("a quinzena que falta é traço, e não zero — inclusive no total", () => {
    const resumo = montar([quinzena(2)]);
    const rota = resumo.canais.find((c) => c.canal === "ROTA")!;

    /* O total do mês é o que existe, e a coluna vazia continua vazia: somar
       `null` como zero apresentaria meio mês com cara de mês inteiro. */
    expect(rota.emitido).toEqual({ primeira: null, segunda: 300, total: 300 });
    expect(resumo.quinzenas.find((q) => q.quinzena === 1)).toMatchObject({
      competenciaId: null,
      apurada: false,
      temDemonstrativo: false,
    });
  });

  it("competência aberta e não apurada não é competência que valeu zero", () => {
    const resumo = montar([quinzena(1, { verbas: null, demonstrativo: null, descontos: null }), quinzena(2)]);
    const rota = resumo.canais.find((c) => c.canal === "ROTA")!;

    expect(rota.emitido.primeira).toBeNull();
    expect(resumo.quinzenas.find((q) => q.quinzena === 1)).toMatchObject({
      competenciaId: "id-1",
      apurada: false,
    });
  });

  it("fecha contra o demonstrativo, e cala quando ele não foi importado", () => {
    const comEle = montar([quinzena(1), quinzena(2)]);
    const rota = comEle.canais.find((c) => c.canal === "ROTA")!;
    expect(rota.demonstrativo).toEqual({ primeira: 140, segunda: 280, total: 420 });
    /* 450 emitidos contra 420 assinados: a linha `DIFERENÇA` da planilha. */
    expect(rota.diferenca).toEqual({ primeira: 10, segunda: 20, total: 30 });

    const semEle = montar([quinzena(1, { demonstrativo: null }), quinzena(2, { demonstrativo: null })]);
    const semDemonstrativo = semEle.canais.find((c) => c.canal === "ROTA")!;
    expect(semDemonstrativo.demonstrativo.total).toBeNull();
    /* Sem os dois lados não há diferença nenhuma a afirmar. */
    expect(semDemonstrativo.diferenca.total).toBeNull();
  });

  it("mostra os descontos que existem e omite os que o relatório traz zerados", () => {
    const rota = montar([quinzena(1), quinzena(2)]).canais[0]!;
    expect(rota.descontos.map((d) => d.tipo)).toEqual(["FRETE_MINIMO"]);
    expect(rota.descontos[0]?.valores).toEqual({ primeira: 10, segunda: 20, total: 30 });
  });

  it("uma verba que só apareceu numa quinzena ainda é linha do mês", () => {
    const so_na_segunda = quinzena(2, {
      verbas: [
        { vbz: 1, canal: "ROTA", nome: "Frota Fixa Ativa", natureza: "FIXO", emitido: 200, esperado: 200 },
        { vbz: 9, canal: "ROTA", nome: "Outras Despesas", natureza: "COMPLEMENTAR", emitido: 7, esperado: 7 },
      ],
    });
    const rota = montar([quinzena(1), so_na_segunda]).canais[0]!;
    const complementar = rota.blocos.find((b) => b.natureza === "COMPLEMENTAR")!;
    expect(complementar.linhas[0]?.emitido).toEqual({ primeira: null, segunda: 7, total: 7 });
  });

  it("o mês sem competência nenhuma responde vazio, e não erro", () => {
    const resumo = montar([]);
    expect(resumo.canais).toEqual([]);
    expect(resumo.quinzenas.map((q) => q.apurada)).toEqual([false, false]);
  });
});

/**
 * O painel da planilha no mês — a segunda aba da mesma tela.
 *
 * O que estes testes prendem é a costura entre as duas leituras. Elas partem de
 * recortes diferentes (verba contra linha da planilha) e não podem chegar a
 * lugares diferentes: o `Total Remuneração` do 03.08.20 é o número que as duas
 * mostram, e é por ele que quem confere sabe que trocou de aba e não de conta.
 */
describe("o painel da planilha no resumo do mês", () => {
  it("bate com a conferência por verba no `Total Remuneração` do 03.08.20", () => {
    const rota = montar([comPainel(1), comPainel(2)]).canais.find((c) => c.canal === "ROTA")!;
    expect(rota.painel).not.toBeNull();
    /* O mesmo número nas duas abas — é isso, e só isso, que as amarra. */
    expect(rota.painel!.demonstrativo).toEqual(rota.demonstrativo);
    expect(rota.demonstrativo).toEqual({ primeira: 340000, segunda: 340000, total: 680000 });
  });

  it("fecha cada quadro: soma mais imposto é o total do relatório", () => {
    const painel = montar([comPainel(1), comPainel(2)]).canais.find(
      (c) => c.canal === "ROTA",
    )!.painel!;
    for (const coluna of ["primeira", "segunda", "total"] as const) {
      expect(painel.soma[coluna]! + painel.imposto[coluna]!).toBe(painel.demonstrativo[coluna]);
    }
  });

  it("escreve as linhas da planilha, na ordem dela e como se escreve", () => {
    const painel = montar([comPainel(1)]).canais.find((c) => c.canal === "ROTA")!.painel!;
    expect(painel.quadros.map((q) => q.quadro)).toEqual([
      "REMUNERACAO",
      "VARIAVEL",
      "OUTROS_CUSTOS",
    ]);
    expect(painel.quadros[0]!.linhas.map((l) => l.nome)).toEqual([
      "Total remuneração rota DVS",
      "Custo fixo padronizado",
      "Custo fixo inativos",
      "Custo vans inativas",
      "Indisponibilidade",
      "Custo fixo — especiais",
      "Custo fixo — vans",
      "Desconto de devolução %",
      "Desconto de disponibilidade",
      "Desconto complementar negativo",
      "Total remuneração rota",
    ]);
  });

  it("mostra o número do conjunto uma vez, e não uma vez por linha que o divide", () => {
    const quadro = montar([comPainel(1), comPainel(2)]).canais
      .find((c) => c.canal === "ROTA")!
      .painel!.quadros.find((q) => q.quadro === "REMUNERACAO")!;

    expect(quadro.conjuntos).toHaveLength(1);
    expect(quadro.conjuntos[0]!.valores).toEqual({
      primeira: 208675,
      segunda: 208675,
      total: 417350,
    });
    /* As seis linhas apontam para ele e não repetem o valor. */
    const doConjunto = quadro.linhas.filter((l) => l.conjunto === quadro.conjuntos[0]!.chave);
    expect(doConjunto).toHaveLength(6);
    expect(doConjunto.every((l) => l.valores.total === null)).toBe(true);
  });

  it("a quinzena sem 03.08.20 deixa a coluna dela vazia, e não zerada", () => {
    const painel = montar([quinzena(1), comPainel(2)]).canais.find(
      (c) => c.canal === "ROTA",
    )!.painel!;
    expect(painel.demonstrativo.primeira).toBeNull();
    expect(painel.demonstrativo.segunda).toBe(340000);
    expect(painel.quadros[0]!.total.primeira).toBeNull();
  });

  it("cala sobre o canal cujos rótulos ninguém transcreveu", () => {
    /* O AS tem painel na planilha e não tem tradução aqui — e `null` diz isso. */
    const resumo = montar([comPainel(1), comPainel(2)]);
    expect(resumo.canais.find((c) => c.canal === "AS")?.painel ?? null).toBeNull();
  });
});

/**
 * As duas razões para um painel vazio.
 *
 * O sintoma é o mesmo — a aba `Planilha` sem números — e o que cada uma pede de
 * quem está olhando é oposto. Antes desta distinção a tela dizia "ainda não foi
 * transcrito" nas duas, inclusive para a Rota, que está transcrita: quem só
 * precisava subir o 03.08.20 era mandado procurar no código.
 */
describe("por que um canal fica sem painel", () => {
  it("a Rota sem o 03.08.20 é arquivo que falta, não transcrição", () => {
    const canal = montar([quinzena(1), quinzena(2)]).canais.find((c) => c.canal === "ROTA");
    expect(canal?.painel).toBeNull();
    expect(canal?.semPainel).toBe("SEM_DEMONSTRATIVO");
  });

  it("um canal fora do catálogo é transcrição que falta", () => {
    const doAs = quinzena(1, {
      verbas: [
        { vbz: 1, canal: "AS", nome: "Frota Fixa Ativa", natureza: "FIXO", emitido: 100, esperado: 100 },
      ],
    });
    const canal = montar([doAs]).canais.find((c) => c.canal === "AS");
    expect(canal?.painel).toBeNull();
    expect(canal?.semPainel).toBe("CANAL_SEM_CATALOGO");
  });

  it("com o painel montado, não há razão nenhuma a dar", () => {
    const canal = montar([comPainel(1), comPainel(2)]).canais.find((c) => c.canal === "ROTA");
    expect(canal?.painel).not.toBeNull();
    expect(canal?.semPainel).toBeNull();
  });
});


/**
 * O contrato de julho/2026 — CDD Belém, como a aba `Cadastro` o traz.
 *
 * Mora no escopo do módulo porque dois blocos o usam: o do painel comparado e
 * o da transição do fallback. Duplicá-lo daria dois contratos que divergem no
 * dia em que alguém corrigir só um.
 */
const PARAMETROS: ParametrosDoCadastro = {
  aliquotas: { pis: 0.0065, cofins: 0.086, icms: 0.1784, iss: 0.059 },
  parcelaDentroDoMunicipio: 0.0316,
  frotaFixaAtiva: 56,
  frotaFixaInativa: 8,
  remuneracaoFixaDaFrotaAtiva: 1424.91,
  remuneracaoDaEquipeDeEntrega: 8919.38,
  remuneracaoDoQlpAdministrativo: 4427.53,
  remuneracaoDeOutrasDespesas: 4361.07,
  remuneracaoDaFrotaInativa: 1650.97,
  vansAtivas: 7,
  custoFixoDaVan: 4693.85,
  custoDaEquipeDeEntregaDaVan: 4250.45,
  vansInativas: 6,
  remuneracaoDasVansInativas: 3195.18,
  rotasNoturnas: 1,
  custoDaNoturnaSemImposto: 8697.88,
  custoDeMarketingSemImposto: 0,
};

const mapa = (q: 1 | 2) =>
  montarMapaDaQuinzena({
    quinzena: q,
    parametros: PARAMETROS,
    variavel: { frotaFixa: 100, agregado: 50, recargaENoturna: 0, vans: 0 },
    bases: {
      devolucao: 13328.3,
      disponibilidade: { fonte: "PLANILHA", valor: 11649.87 },
      complementarNegativo: 0,
      outrosCustos: { fonte: "PLANILHA", valor: 0 },
      indisponibilidade: { fonte: "PLANILHA", valor: 0 },
    },
  });


/**
 * O devido ao lado do demonstrado — a inversão que o motor tornou possível.
 *
 * O que estes testes prendem não é a subtração: é que o painel **só** apareça
 * quando houver contrato, e que a ausência de contrato deixe o produto
 * exatamente como estava. Uma coluna nova que nasce cheia de zeros é pior do
 * que uma coluna que não nasce.
 */
describe("o painel comparado", () => {
  const comCadastro = (n: 1 | 2) =>
    quinzena(n, {
      calculados: [{ canal: "ROTA", mapa: mapa(n) }],
      cadastroUsado: { cadastroId: "cad-1", vigenteDe: "2026-07-01" },
    });

  it("sem cadastro, o painel comparado não existe — nada muda no produto", () => {
    const canal = montar([quinzena(1), quinzena(2)]).canais.find((c) => c.canal === "ROTA");
    expect(canal?.comparado).toBeNull();
  });

  it("com cadastro, o devido sai do contrato e fecha no valor conhecido", () => {
    const canal = montar([comCadastro(1)]).canais.find((c) => c.canal === "ROTA");
    const linha = canal?.comparado?.quadros
      .flatMap((q) => q.linhas)
      .find((l) => l.chave === "custo_fixo_padronizado");
    expect(linha?.devido.primeira).toBe(731502.84);
  });

  it("a diferença fica vazia enquanto não houver os dois lados", () => {
    const canal = montar([comCadastro(1)]).canais.find((c) => c.canal === "ROTA");
    const linha = canal?.comparado?.quadros
      .flatMap((q) => q.linhas)
      .find((l) => l.chave === "custo_fixo_padronizado");
    /* Sem 03.08.20 não há demonstrado, e subtrair de nada não dá zero. */
    expect(linha?.demonstrado.primeira).toBeNull();
    expect(linha?.diferenca.primeira).toBeNull();
  });

  it("diz de qual cadastro veio cada quinzena", () => {
    const canal = montar([comCadastro(1), comCadastro(2)]).canais.find((c) => c.canal === "ROTA");
    expect(canal?.comparado?.cadastro.primeira?.vigenteDe).toBe("2026-07-01");
    expect(canal?.comparado?.cadastro.segunda?.cadastroId).toBe("cad-1");
  });

  it("cada linha carrega a conta que a produziu", () => {
    const canal = montar([comCadastro(1)]).canais.find((c) => c.canal === "ROTA");
    const linha = canal?.comparado?.quadros
      .flatMap((q) => q.linhas)
      .find((l) => l.chave === "custo_fixo_padronizado");
    expect(linha?.memoria.primeira).toContain("56 veículos ativos");
  });
});

/**
 * A TRANSIÇÃO — sair do fallback e passar a comparar, sem que nada se perca.
 *
 * É a promessa inteira deste trabalho numa frase: **cadastro válido mais
 * vigência válida faz o painel deixar de ser uma releitura do 03.08.20 e virar
 * a comparação**, com o devido linha a linha nas seis que o demonstrativo só
 * traz em conjunto. E, no mesmo movimento, sem inventar o rateio que o
 * relatório não tem.
 */
describe("do fallback para o painel comparado", () => {
  /** A quinzena com os dois lados: o 03.08.20 importado e o contrato resolvido. */
  const comOsDois = (n: 1 | 2) => {
    const doPainel = comPainel(n);
    return quinzena(n, {
      ...doPainel,
      calculados: [{ canal: "ROTA", mapa: mapa(n) }],
      cadastroUsado: { cadastroId: "cad-1", vigenteDe: "2026-07-01" },
      diagnosticoDoCadastro: [
        {
          canal: "ROTA",
          diagnostico: {
            estado: "RESPONDEU",
            unidade: {
              codigoProcurado: "0443",
              cadastradas: 1,
              candidatas: 1,
              comoCasou: "EXATO",
              codigoNoCadastro: "0443",
              codigosCadastrados: [],
              identidade: null,
              sugestoes: [],
            },
            vigencia: {
              doMes: ["2026-07-01"],
              todas: ["2026-07-01"],
              vigenteDe: "2026-07-01",
              herdadaDaOutraQuinzena: false,
            },
            contrato: { faltam: [], assumidasComoZero: [], lidas: 22 },
          },
        },
      ],
    });
  };

  /** As seis linhas que o 03.08.20 traz somadas — ver `GRUPOS_DA_PLANILHA`. */
  const DO_CONJUNTO = [
    "rota_dvs",
    "custo_fixo_padronizado",
    "custo_fixo_inativos",
    "custo_vans_inativas",
    "custo_fixo_especiais",
    "custo_fixo_vans",
  ];

  it("só o 03.08.20: o painel é a releitura, e o comparado não existe", () => {
    const canal = montar([comPainel(1)]).canais.find((c) => c.canal === "ROTA")!;

    expect(canal.painel).not.toBeNull();
    expect(canal.comparado).toBeNull();
    /* No fallback, as seis não têm número próprio — é o estado da tela hoje. */
    const linha = canal.painel!.quadros.flatMap((q) => q.linhas).find(
      (l) => l.chave === "custo_fixo_padronizado",
    );
    expect(linha?.valores.primeira).toBeNull();
    expect(linha?.conjunto).not.toBeNull();
  });

  it("com cadastro e vigência, o comparado aparece e as seis ganham devido próprio", () => {
    const canal = montar([comOsDois(1)]).canais.find((c) => c.canal === "ROTA")!;

    expect(canal.comparado).not.toBeNull();
    const linhas = canal.comparado!.quadros.flatMap((q) => q.linhas);
    for (const chave of DO_CONJUNTO) {
      const linha = linhas.find((l) => l.chave === chave);
      expect(linha, chave).toBeDefined();
      expect(linha!.devido.primeira, `${chave} sem devido`).not.toBeNull();
    }
  });

  /**
   * O contrato que o usuário pediu por escrito: o demonstrado **continua** em
   * conjunto. Nada aqui reparte o número do relatório entre as seis.
   */
  it("o demonstrado das seis continua em conjunto — o 03.08.20 não é rateado", () => {
    const canal = montar([comOsDois(1)]).canais.find((c) => c.canal === "ROTA")!;
    const linhas = canal.comparado!.quadros.flatMap((q) => q.linhas);

    for (const chave of DO_CONJUNTO) {
      const linha = linhas.find((l) => l.chave === chave)!;
      expect(linha.demonstrado.primeira, `${chave} recebeu rateio`).toBeNull();
      /* E a tela sabe **por que** está vazio: não falta arquivo, falta partição. */
      expect(linha.conjunto, `${chave} sem conjunto`).not.toBeNull();
      expect(linha.conjunto!.linhas.length).toBe(6);
      /* Sem os dois lados, a diferença da linha não existe — e não é zero. */
      expect(linha.diferenca.primeira).toBeNull();
    }
  });

  it("a comparação do conjunto existe, e é a soma do devido contra o agregado", () => {
    const canal = montar([comOsDois(1)]).canais.find((c) => c.canal === "ROTA")!;
    const quadro = canal.comparado!.quadros.find((q) => q.quadro === "REMUNERACAO")!;
    const conjunto = quadro.conjuntos.find((c) => c.chave === "fixo_bruto");

    expect(conjunto).toBeDefined();
    expect(conjunto!.linhas.length).toBe(6);

    /* O devido do conjunto é exatamente a soma do devido das seis linhas. */
    const somaDasSeis = DO_CONJUNTO.reduce((total, chave) => {
      const l = quadro.linhas.find((x) => x.chave === chave)!;
      return total + (l.devido.primeira ?? 0);
    }, 0);
    expect(conjunto!.devido.primeira).toBeCloseTo(somaDasSeis, 2);

    /* E o demonstrado é o número que o relatório traz para todas juntas. */
    expect(conjunto!.demonstrado.primeira).not.toBeNull();
    expect(conjunto!.diferenca.primeira).toBeCloseTo(
      conjunto!.devido.primeira! - conjunto!.demonstrado.primeira!,
      2,
    );
  });

  it("faltando o devido de uma linha do conjunto, a soma do conjunto não existe", () => {
    /* Sem diário não há `rota_dvs`, que é uma das seis. */
    const semDiario = montarMapaDaQuinzena({
      quinzena: 1,
      parametros: PARAMETROS,
      variavel: { frotaFixa: null, agregado: null, recargaENoturna: null, vans: null },
      bases: {
        devolucao: 13328.3,
        disponibilidade: { fonte: "PLANILHA", valor: 11649.87 },
        complementarNegativo: 0,
        outrosCustos: null,
        indisponibilidade: null,
      },
    });
    const doPainel = comPainel(1);
    const canal = montar([
      quinzena(1, {
        ...doPainel,
        calculados: [{ canal: "ROTA", mapa: semDiario }],
        cadastroUsado: { cadastroId: "cad-1", vigenteDe: "2026-07-01" },
      }),
    ]).canais.find((c) => c.canal === "ROTA")!;

    const quadro = canal.comparado!.quadros.find((q) => q.quadro === "REMUNERACAO")!;
    const conjunto = quadro.conjuntos.find((c) => c.chave === "fixo_bruto")!;

    /* Cinco sextos de uma soma não é a soma — e comparar isso mediria a nossa lacuna. */
    expect(quadro.linhas.find((l) => l.chave === "rota_dvs")?.devido.primeira).toBeNull();
    expect(conjunto.devido.primeira).toBeNull();
    expect(conjunto.diferenca.primeira).toBeNull();
    /* O demonstrado do conjunto continua lá: ele não dependia do nosso lado. */
    expect(conjunto.demonstrado.primeira).not.toBeNull();
  });

  it("o diagnóstico do cadastro chega à tela com o texto já escrito", () => {
    const canal = montar([comOsDois(1)]).canais.find((c) => c.canal === "ROTA")!;

    expect(canal.cadastro.primeira?.estado).toBe("RESPONDEU");
    /* Respondeu: não há o que destravar, e a tela não inventa um aviso. */
    expect(canal.cadastro.primeira?.destrava).toBeNull();
    /* A 2ª quinzena não existe neste mês — que é diferente de não ter cadastro. */
    expect(canal.cadastro.segunda).toBeNull();
  });

  it("parando numa porta, o texto do conserto vem junto", () => {
    const canal = montar([
      quinzena(1, {
        diagnosticoDoCadastro: [
          {
            canal: "ROTA",
            diagnostico: {
              estado: "CONTRATO_INCOMPLETO",
              unidade: {
                codigoProcurado: "0443",
                cadastradas: 1,
                candidatas: 1,
                comoCasou: "ESPACO",
                codigoNoCadastro: " 0443 ",
                codigosCadastrados: [],
                identidade: null,
                sugestoes: [],
              },
              vigencia: {
                doMes: ["2026-07-01"],
                todas: ["2026-07-01"],
                vigenteDe: "2026-07-01",
                herdadaDaOutraQuinzena: false,
              },
              contrato: {
                faltam: [{ chave: "van_custo_fixo", rotulo: "Custo fixo da van" }],
                assumidasComoZero: [],
                lidas: 22,
              },
            },
          },
        ],
      }),
    ]).canais.find((c) => c.canal === "ROTA")!;

    expect(canal.cadastro.primeira?.destrava?.problema).toContain("Custo fixo da van");
    expect(canal.cadastro.primeira?.destrava?.conserto).toContain("Digite estas linhas");
  });
});
