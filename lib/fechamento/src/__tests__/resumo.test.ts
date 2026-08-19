import { describe, expect, it } from "vitest";
import { montarResumo, type QuinzenaApurada } from "../resumo";

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
