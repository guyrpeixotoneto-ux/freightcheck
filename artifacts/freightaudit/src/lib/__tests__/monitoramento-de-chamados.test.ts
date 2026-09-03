import { describe, expect, it } from "vitest";
import {
  contagemDaAba,
  diaLegivel,
  diaPorExtenso,
  envioForaDaJanela,
  fraseDoDia,
  janelaDoEnvioFora,
  oscilouEVoltou,
  posicaoDaRegua,
  progressoDoDia,
  rotuloDaDiferenca,
  valorLegivel,
  type DiaDaRegua,
  type Movimentacao,
  type ResumoDoDia,
  type Serie,
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

describe("envioForaDaJanela — nove cinzas não são um acervo vazio", () => {
  /*
    O caso que trouxe a função, com as datas dele: 1.218 chamados de CAMAÇARI
    lidos em 16/08, a tela aberta em 03/09, e a régua de nove dias parando em
    26/08. Nenhum dos dois lados errado, e a tela dizendo o contrário do que há.
  */
  const JANELA = [
    "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30",
    "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03",
  ];
  const VAZIA: DiaDaRegua[] = JANELA.map((dia) => ({
    dia,
    estado: "SEM_IMPORTACAO",
    envios: 0,
    enviosComFalha: 0,
    movimentacoes: 0,
    revisadas: 0,
    pendentes: 0,
    ultimaImportacao: null,
  }));

  const CAMACARI: Serie = {
    serie: "CAMAÇARI",
    origem: "ARQUIVO",
    envios: 1,
    ultimaImportacao: "2026-08-16T10:25:43.000Z", // 07:25 em São Paulo
  };
  /*
    Recife também está fora da janela, e tem de estar: a régua desta suíte está
    toda cinza, e uma série que tivesse importado em 02/09 contradiria isso — o
    dia teria envio. Um fixture que se contradiz prende o comportamento errado.
  */
  const RECIFE: Serie = {
    serie: "Recife",
    origem: "ARQUIVO",
    envios: 4,
    ultimaImportacao: "2026-08-20T11:00:00.000Z",
  };

  const chamar = (extra: Partial<Parameters<typeof envioForaDaJanela>[0]> = {}) =>
    envioForaDaJanela({
      dias: VAZIA,
      series: [CAMACARI],
      serie: "CAMAÇARI",
      hoje: "2026-09-03",
      ...extra,
    });

  it("aponta o dia do envio e a distância até hoje", () => {
    expect(chamar()).toEqual({
      dia: "2026-08-16",
      diasAtras: 18,
      de: "2026-08-26",
      ate: "2026-09-03",
    });
  });

  it("o dia é o da operação, não o do UTC de quem olha", () => {
    /* 03:00Z de 17/08 são 00:00 de 17/08 em São Paulo — e 21:00 de 16/08 é 16. */
    expect(
      chamar({
        series: [{ ...CAMACARI, ultimaImportacao: "2026-08-17T00:30:00.000Z" }],
      })?.dia,
    ).toBe("2026-08-16");
  });

  it("com envio na janela, a régua já responde e a tira cala", () => {
    const comEnvio = VAZIA.map((d, i) =>
      i === 4 ? { ...d, envios: 1, estado: "PRIMEIRA_CARGA" as const } : d,
    );
    expect(chamar({ dias: comEnvio })).toBeNull();
  });

  it("uma importação que falhou também é um envio: a régua já a mostra", () => {
    const comFalha = VAZIA.map((d, i) => (i === 4 ? { ...d, enviosComFalha: 1 } : d));
    expect(chamar({ dias: comFalha })).toBeNull();
  });

  it("sem régua ainda, não há janela sobre a qual afirmar nada", () => {
    expect(chamar({ dias: [] })).toBeNull();
  });

  it("recorte que nunca importou nada cala — quem responde é o AvisoDoRecorte", () => {
    expect(chamar({ serie: "PERNAMBUCO" })).toBeNull();
    expect(chamar({ series: [] })).toBeNull();
  });

  it("aponta o envio do recorte, nunca o de outra unidade", () => {
    /* Recife importou depois; com CAMAÇARI aberta, é 16/08 que se oferece. */
    expect(chamar({ series: [CAMACARI, RECIFE] })?.dia).toBe("2026-08-16");
  });

  it("em todas as unidades, é o envio mais recente do acervo", () => {
    expect(chamar({ series: [CAMACARI, RECIFE], serie: undefined })?.dia).toBe(
      "2026-08-20",
    );
  });

  it("a série sem unidade no arquivo é uma série, e não todas", () => {
    const semUnidade: Serie = { ...CAMACARI, serie: null };
    expect(chamar({ series: [semUnidade], serie: null })?.dia).toBe("2026-08-16");
    expect(chamar({ series: [CAMACARI], serie: null })).toBeNull();
  });

  it("envio dentro da janela nunca é anunciado como fora dela", () => {
    expect(
      chamar({
        series: [{ ...CAMACARI, ultimaImportacao: "2026-08-28T12:00:00.000Z" }],
      }),
    ).toBeNull();
  });

  it("com a régua deslocada para trás, o envio à frente também é apontado", () => {
    const julho: DiaDaRegua[] = VAZIA.map((d, i) => ({
      ...d,
      dia: `2026-07-0${i + 1}`,
    }));
    expect(chamar({ dias: julho })).toEqual({
      dia: "2026-08-16",
      diasAtras: 18,
      de: "2026-07-01",
      ate: "2026-07-09",
    });
  });
});

describe("janelaDoEnvioFora — o fim da frase da tira", () => {
  const base = { dia: "2026-08-16", de: "2026-08-26", ate: "2026-09-03" };

  it("diz a distância e a janela, com o ponto colado no número", () => {
    expect(janelaDoEnvioFora({ ...base, diasAtras: 18 })).toBe(
      " — 18 dias atrás. A régua está em 26/08/2026–03/09/2026.",
    );
  });

  it("um dia sozinho fala no singular", () => {
    expect(janelaDoEnvioFora({ ...base, diasAtras: 1 })).toContain(" — 1 dia atrás.");
  });

  it("distância nenhuma não é '0 dias atrás' — é nada", () => {
    expect(janelaDoEnvioFora({ ...base, diasAtras: 0 })).toBe(
      ". A régua está em 26/08/2026–03/09/2026.",
    );
  });
});
