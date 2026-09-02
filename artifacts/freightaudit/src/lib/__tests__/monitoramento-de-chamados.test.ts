import { describe, expect, it } from "vitest";
import {
  contagemDaAba,
  diaLegivel,
  diaPorExtenso,
  fraseDoDia,
  oscilouEVoltou,
  posicaoDaRegua,
  progressoDoDia,
  rotuloDaDiferenca,
  valorLegivel,
  type Movimentacao,
  type ResumoDoDia,
} from "@/lib/monitoramento-de-chamados";

/**
 * As regras da tela do Monitoramento, sem montar tela nenhuma.
 *
 * O que se prende aqui é o que a página **afirma** quando não tem número para
 * mostrar — que é onde as telas deste produto costumam mentir sem querer: um
 * `0%` durante o carregamento, um "dia revisado" num dia sem importação, um
 * contador ao lado de um filtro que não bate com a lista.
 */

const RESUMO: ResumoDoDia = {
  dia: "2026-09-02",
  estado: "PENDENTE",
  ultimaImportacao: "2026-09-02T11:15:00.000Z", // 08:15 em São Paulo
  movimentacoes: 70,
  novos: 27,
  alterados: 31,
  encerrados: 10,
  removidos: 2,
  revisadas: 52,
  pendentes: 18,
  alteracoesDeCampo: [{ tipo: "PRAZO", total: 7 }],
  pontosDeAtencao: {
    criticos: 6,
    atrasados: 9,
    prazosAlterados: 7,
    trocasDeResponsavel: 3,
  },
  porUnidade: [{ unidade: "Recife", total: 31 }],
  avisos: [],
  filtros: { unidades: [], areas: [], responsaveis: [], status: [], tiposDeAlteracao: [] },
};

describe("datas — sem `Date`, para não haver fuso a errar", () => {
  it("formata o dia sem atravessar meia-noite", () => {
    expect(diaLegivel("2026-09-02")).toBe("02/09/2026");
    expect(diaPorExtenso("2026-09-02")).toBe("02 de setembro de 2026");
    expect(posicaoDaRegua("2026-09-02")).toEqual({ numero: "02", mes: "set" });
  });
});

describe("valorLegivel — o vazio tem nome", () => {
  it("um campo esvaziado aparece como traço, não como célula em branco", () => {
    expect(valorLegivel(null)).toBe("—");
    expect(valorLegivel("   ")).toBe("—");
  });

  it("uma data do banco vira data de gente", () => {
    expect(valorLegivel("2026-09-15")).toBe("15/09/2026");
    expect(valorLegivel("Em análise")).toBe("Em análise");
  });
});

describe("rotuloDaDiferenca — o cabeçalho da fonte quando é o que se tem", () => {
  it("usa o nome da coluna no que não tem rótulo próprio", () => {
    expect(rotuloDaDiferenca({ tipo: "PRAZO", campo: "Previsão Análise", antes: null, depois: null }))
      .toBe("Prazo");
    // Aqui o cabeçalho é a única informação sobre o que mudou.
    expect(rotuloDaDiferenca({ tipo: "OUTRO", campo: "Evidência Reprovada", antes: null, depois: null }))
      .toBe("Evidência Reprovada");
    expect(rotuloDaDiferenca({ tipo: "VALOR_SOLICITADO", campo: "Pedágio", antes: null, depois: null }))
      .toBe("Pedágio");
  });
});

describe("contagemDaAba — o número ao lado do filtro é o que a lista devolve", () => {
  it("cada aba lê a mesma conta que a lista aplica", () => {
    expect(contagemDaAba(RESUMO, "TODOS")).toBe(70);
    expect(contagemDaAba(RESUMO, "NAO_REVISADOS")).toBe(18);
    expect(contagemDaAba(RESUMO, "NOVOS")).toBe(27);
    expect(contagemDaAba(RESUMO, "ALTERADOS")).toBe(31);
    expect(contagemDaAba(RESUMO, "ENCERRADOS")).toBe(10);
    expect(contagemDaAba(RESUMO, "REMOVIDOS")).toBe(2);
    expect(contagemDaAba(RESUMO, "CRITICOS")).toBe(6);
  });

  it("sem resumo, nenhum número — e nunca zero", () => {
    // Um `0` no meio do carregamento se lê como "não há nada", que é uma
    // afirmação, e uma afirmação falsa.
    expect(contagemDaAba(null, "TODOS")).toBeUndefined();
  });

  it("as quatro classes somam o total, e é isso que a tela publica", () => {
    expect(RESUMO.novos + RESUMO.alterados + RESUMO.encerrados + RESUMO.removidos).toBe(
      RESUMO.movimentacoes,
    );
    expect(RESUMO.revisadas + RESUMO.pendentes).toBe(RESUMO.movimentacoes);
  });
});

describe("progressoDoDia — a barra só existe quando há o que medir", () => {
  it("mede o que foi revisado", () => {
    expect(progressoDoDia(RESUMO)).toEqual({ revisadas: 52, total: 70, percentual: 74 });
  });

  it("dia sem movimentação não tem barra — nem 0%, nem 100%", () => {
    // "0 de 0 · 100%" celebraria um trabalho que ninguém fez; "0%" cobraria um
    // trabalho que não existe.
    expect(progressoDoDia({ ...RESUMO, movimentacoes: 0, revisadas: 0, pendentes: 0 })).toBeNull();
    expect(progressoDoDia(null)).toBeNull();
  });
});

describe("fraseDoDia — os cinco estados, e por que três deles não são o mesmo", () => {
  it("dia sem importação não é dia sem movimentação", () => {
    const f = fraseDoDia({ ...RESUMO, estado: "SEM_IMPORTACAO", movimentacoes: 0 })!;
    expect(f.tom).toBe("neutro");
    expect(f.titulo).toBe("Nenhuma importação realizada neste dia.");
    // A distinção que a tela precisa fazer, escrita por extenso.
    expect(f.detalhe).toContain("não é que nada tenha mudado");
  });

  it("importou e nada mudou traz a hora, para não parecer que ninguém mandou nada", () => {
    const f = fraseDoDia({ ...RESUMO, estado: "SEM_MOVIMENTACAO", movimentacoes: 0 })!;
    expect(f.titulo).toContain("Importação concluída às 08:15");
    expect(f.titulo).toContain("Nenhuma movimentação identificada");
  });

  it("a primeira carga diz o tamanho dela, e não vira fila de novos", () => {
    const f = fraseDoDia({
      ...RESUMO,
      estado: "PRIMEIRA_CARGA",
      movimentacoes: 0,
      avisos: [{ tipo: "BASELINE", texto: "Primeira importação desta série: 5.214 chamados." }],
    })!;
    expect(f.titulo).toContain("Primeira importação");
    expect(f.detalhe).toContain("5.214 chamados");
  });

  it("dia revisado fecha a conta", () => {
    const f = fraseDoDia({ ...RESUMO, estado: "REVISADO", revisadas: 70, pendentes: 0 })!;
    expect(f.tom).toBe("concluido");
    expect(f.titulo).toBe("Dia revisado.");
    expect(f.detalhe).toBe("70 de 70 movimentações analisadas.");
  });

  it("uma pendência sozinha fala no singular", () => {
    const f = fraseDoDia({ ...RESUMO, pendentes: 1, revisadas: 69 })!;
    expect(f.titulo).toBe("1 movimentação aguardando revisão.");
  });

  it("sem resumo, a tela não afirma nada", () => {
    expect(fraseDoDia(null)).toBeNull();
  });
});

describe("oscilouEVoltou — o chamado que foi e voltou continua na fila", () => {
  const base: Movimentacao = {
    id: "1", dia: "2026-09-02", serie: "Recife", externalId: "CH-1",
    classe: "ALTERADO", revisao: 1, passos: 2, unidade: "Recife", area: null,
    responsavel: null, solicitante: null, statusRaw: null, statusBucket: null,
    assunto: null, entidade: null, prazoPrevisto: null, abertoEm: null,
    encerradoEm: null, alteradoEmFonte: null, criticidade: "NORMAL",
    criticidadeMotivo: null, criticidadeOrigem: "DERIVADA", atrasado: false,
    movidaEm: "2026-09-02T20:00:00.000Z", revisada: false, revisadaPor: null,
    revisadaEm: null, diferencas: [],
  };

  it("zero diferenças com passos é oscilação, e a linha diz isso", () => {
    expect(oscilouEVoltou(base)).toBe(true);
  });

  it("um novo sem diferenças não é oscilação — ele apareceu", () => {
    expect(oscilouEVoltou({ ...base, classe: "NOVO" })).toBe(false);
  });

  it("com saldo, não é oscilação: há antes → depois para mostrar", () => {
    expect(
      oscilouEVoltou({
        ...base,
        diferencas: [{ tipo: "PRAZO", campo: "Previsão Análise", antes: "a", depois: "b" }],
      }),
    ).toBe(false);
  });
});
