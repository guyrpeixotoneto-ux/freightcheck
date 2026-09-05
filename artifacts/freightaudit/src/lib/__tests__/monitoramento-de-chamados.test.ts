import { describe, expect, it } from "vitest";
import {
  COLUNAS_DA_RELACAO,
  diaLegivel,
  diaPorExtenso,
  envioForaDaJanela,
  fraseDoDia,
  janelaDoEnvioFora,
  linhasDaPagina,
  posicaoDaRegua,
  emCaixaDeTitulo,
  gravarColunasDaRelacao,
  lerColunasDaRelacao,
  situacaoDoPrazo,
  type DiaDaRegua,
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
  chamadosNoEnvio: 1218,
  situacoesNoEnvio: {
    aprovados: 900,
    emAnalise: 200,
    reprovados: 100,
    outras: 18,
    total: 1218,
    detalheDeOutras: [{ statusBucket: "CANCELADO", total: 18 }],
  },
  alteracoesDeCampo: [{ tipo: "PRAZO", total: 7 }],
  pontosDeAtencao: {
    criticos: 6,
    atrasados: 9,
    prazosAlterados: 7,
    trocasDeResponsavel: 3,
  },
  porUnidade: [{ unidade: "Recife", total: 31 }],
  avisos: [],
};

describe("datas — sem `Date`, para não haver fuso a errar", () => {
  it("formata o dia sem atravessar meia-noite", () => {
    expect(diaLegivel("2026-09-02")).toBe("02/09/2026");
    expect(diaPorExtenso("2026-09-02")).toBe("02 de setembro de 2026");
    expect(posicaoDaRegua("2026-09-02")).toEqual({ numero: "02", mes: "set" });
  });
});

describe("linhasDaPagina — a espera tem a altura da lista que vem", () => {
  it("com o total conhecido, reserva exatamente o que a página vai trazer", () => {
    expect(linhasDaPagina({ total: 1051, pagina: 1, porPagina: 25 })).toBe(25);
    expect(linhasDaPagina({ total: 1051, pagina: 1, porPagina: 100 })).toBe(100);
    expect(linhasDaPagina({ total: 12, pagina: 1, porPagina: 25 })).toBe(12);
  });

  it("a última página é mais curta, e a espera dela também", () => {
    // 1.051 chamados de 25 em 25: a página 43 traz uma linha só.
    expect(linhasDaPagina({ total: 1051, pagina: 43, porPagina: 25 })).toBe(1);
  });

  it("uma página além do fim não reserva altura negativa", () => {
    expect(linhasDaPagina({ total: 12, pagina: 9, porPagina: 25 })).toBe(0);
  });

  it("o dia sem nada é zero, e não uma página cheia de promessa", () => {
    expect(linhasDaPagina({ total: 0, pagina: 1, porPagina: 25 })).toBe(0);
  });

  it("sem total nenhum, assume a página cheia", () => {
    /*
      É o único instante em que se chuta, e o chute é para o lado de a tela já
      nascer do tamanho que vai ter: o defeito que esta função existe para tirar
      é a tela curta que dá um salto quando a resposta chega.
    */
    expect(linhasDaPagina({ total: null, pagina: 1, porPagina: 25 })).toBe(25);
    expect(linhasDaPagina({ total: null, pagina: 7, porPagina: 100 })).toBe(100);
  });
});

describe("fraseDoDia — as três frases do arquivo, e o silêncio nas outras duas", () => {
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

  it("nada mudou diz **quantos** vieram — senão se lê como se nada tivesse vindo", () => {
    // A reclamação que fez a tela ganhar a relação de chamados: a frase estava
    // certa e era lida ao contrário. Dizer o tamanho da fila na mesma linha
    // separa "nada mudou" de "nada chegou".
    const f = fraseDoDia({ ...RESUMO, estado: "SEM_MOVIMENTACAO", movimentacoes: 0 })!;
    expect(f.detalhe).toContain("1.218 chamados vieram no arquivo");
    expect(f.detalhe).toContain("nenhum deles mudou");
  });

  it("sem contagem de fila, a frase não inventa um zero", () => {
    // Um envio que chegou vazio, ou um banco sem a contagem: "0 chamados
    // vieram no arquivo" trocaria uma frase certa por uma que parece defeito.
    const f = fraseDoDia({
      ...RESUMO,
      estado: "SEM_MOVIMENTACAO",
      movimentacoes: 0,
      chamadosNoEnvio: 0,
    })!;
    expect(f.detalhe).toBe("Os chamados vieram iguais aos da importação anterior.");
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

  it("os dois estados da revisão não falam — a revisão saiu da tela", () => {
    /*
      Diziam "3.400 movimentações aguardando revisão" e "dia revisado". A faixa
      existe para o dia que **não** tem lista; num dia com movimentação, o que
      há a dizer já está dito por número, na tira e no resumo do dia.
    */
    expect(fraseDoDia({ ...RESUMO, estado: "PENDENTE" })).toBeNull();
    expect(
      fraseDoDia({ ...RESUMO, estado: "REVISADO", revisadas: 70, pendentes: 0 }),
    ).toBeNull();
  });

  it("sem resumo, a tela não afirma nada", () => {
    expect(fraseDoDia(null)).toBeNull();
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
    chamadosNoEnvio: 0,
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

describe("situacaoDoPrazo — a régua do SLA é a do servidor", () => {
  const com = (prazoPrevisto: string | null, encerradoEm: string | null) => ({
    prazoPrevisto,
    encerradoEm,
  });

  it("atrasado é o chamado com prazo vencido que segue em aberto", () => {
    expect(situacaoDoPrazo(com("2026-08-15", null), "2026-08-16")).toBe("ATRASADO");
    expect(situacaoDoPrazo(com("2026-08-16", null), "2026-08-16")).toBe("NO_PRAZO");
  });

  it("um chamado encerrado nunca aparece atrasado — é a régua aprovada", () => {
    /*
      Mesmo tendo fechado depois do prazo. Inventar uma segunda régua aqui faria
      esta coluna discordar do "atrasados" que o resumo do dia dá, e a mesma
      palavra passaria a contar duas populações.
    */
    expect(
      situacaoDoPrazo(com("2026-08-01", "2026-08-20T12:00:00.000Z"), "2026-08-30"),
    ).toBe("NO_PRAZO");
  });

  it("sem prazo no arquivo não há selo nenhum a mostrar", () => {
    expect(situacaoDoPrazo(com(null, null), "2026-08-16")).toBeNull();
  });

  it("a régua é o dia da relação, e não o relógio de quem lê", () => {
    // O mesmo chamado, lido no dia dele e um mês depois: a tela não repinta o
    // passado.
    expect(situacaoDoPrazo(com("2026-08-20", null), "2026-08-16")).toBe("NO_PRAZO");
    expect(situacaoDoPrazo(com("2026-08-20", null), "2026-09-16")).toBe("ATRASADO");
  });
});

describe("emCaixaDeTitulo — o grito do arquivo, legível", () => {
  it("dobra o que vem todo em caixa alta", () => {
    expect(emCaixaDeTitulo("CAMAÇARI")).toBe("Camaçari");
    expect(emCaixaDeTitulo("OPERALOG")).toBe("Operalog");
    expect(emCaixaDeTitulo("CARREGAMENTO - ESTACIONÁRIA")).toBe(
      "Carregamento - Estacionária",
    );
  });

  it("não reescreve o que a fonte já escreveu misturado", () => {
    expect(emCaixaDeTitulo("Camaçari")).toBe("Camaçari");
    expect(emCaixaDeTitulo("freteReaisViagem")).toBe("freteReaisViagem");
  });
});

describe("as colunas da relação — preferência de quem olha", () => {
  const todas = COLUNAS_DA_RELACAO.map((c) => c.chave);

  it("o assunto é a primeira coluna, colada no número do chamado", () => {
    /*
      A ordem desta lista é a ordem da tabela, e a primeira posição é a única
      que fica encostada na coluna do número — a que a tabela escreve antes de
      percorrer esta lista. O assunto é a única frase que a fonte escreve sobre
      o chamado, e é por ela que quem confere sabe do que a linha trata; ela
      atrás do status era a resposta ao "por quê" depois da resposta ao "como
      está".
    */
    expect(todas[0]).toBe("assunto");
  });

  /*
    Um `localStorage` de mentira, porque o de verdade não existe aqui.

    O ambiente destes testes é Node, e sem armazenamento as duas funções são
    no-op silencioso — que é o comportamento certo em janela privada, e é o que
    o primeiro caso abaixo mede. Para medir o resto é preciso haver onde
    guardar, e um objeto de três métodos é isso.
  */
  const guardaDeVerdade = () => {
    const dados = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => dados.get(k) ?? null,
        setItem: (k: string, v: string) => void dados.set(k, v),
        removeItem: (k: string) => void dados.delete(k),
      },
    });
  };

  it("sem armazenamento nenhum, todas as colunas aparecem", () => {
    expect(lerColunasDaRelacao()).toEqual(todas);
  });

  it("uma preferência antiga não devolve a ordem antiga", () => {
    /*
      A ordem é do produto, e não da pessoa: a engrenagem escolhe o que fica à
      vista, nunca onde cada coluna cai. Quem já usou a tela tem gravada uma
      lista na ordem de antes — se a leitura respeitasse a ordem do que está
      guardado, o assunto voltaria para trás do status para todo mundo que já
      abriu a relação, e a mudança valeria só para quem nunca a viu.
    */
    guardaDeVerdade();
    gravarColunasDaRelacao(["status", "assunto", "unidade"] as never);
    const lidas = lerColunasDaRelacao();
    expect(lidas.indexOf("assunto")).toBeLessThan(lidas.indexOf("status"));
  });

  it("a escolha volta na próxima abertura", () => {
    guardaDeVerdade();
    gravarColunasDaRelacao(todas.filter((c) => c !== "operador"));
    expect(lerColunasDaRelacao()).toEqual(todas.filter((c) => c !== "operador"));
  });

  it("uma coluna nova nasce visível, e uma que não existe mais é descartada", () => {
    /*
      O que está guardado é de uma versão anterior da tela: `assunto` estava
      escondida, `unidade` idem, e `coluna-que-nao-existe` sumiu do produto. A
      leitura tem de manter as escondidas, ignorar a que não existe e deixar
      visível qualquer coluna nascida depois — senão uma coluna nova nasce
      escondida para todo mundo que já usou a tela, e ninguém descobre que ela
      existe.
    */
    guardaDeVerdade();
    const guardado = todas.filter((c) => c !== "assunto" && c !== "unidade");
    gravarColunasDaRelacao([...guardado, "coluna-que-nao-existe"] as never);
    const lidas = lerColunasDaRelacao();
    expect(lidas).not.toContain("assunto");
    expect(lidas).not.toContain("unidade");
    expect(lidas).toContain("status");
    expect(lidas).toEqual(todas.filter((c) => lidas.includes(c)));
  });
});
