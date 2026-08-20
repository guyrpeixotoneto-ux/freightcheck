import { describe, expect, it } from "vitest";
import { montarResumo, type QuinzenaApurada } from "../resumo";
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
