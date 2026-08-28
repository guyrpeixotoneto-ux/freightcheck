import { describe, expect, it } from "vitest";
import {
  acentoDaCategoria,
  categoriasDaLista,
  comoData,
  comoTempoRelativo,
  ordenarPorAtualizacao,
  enderecoDaAcao,
  etapasDoRoteiro,
  filtrarFluxos,
  itensPorEspecie,
  montarCanvas,
  resumoDoCartao,
  resumoDoFluxo,
  type Catalogo,
  type Conexao,
  type Etapa,
  type FluxoCompleto,
  type FluxoNaLista,
} from "@/lib/fluxos";

/**
 * O que a tela de Fluxos Operacionais **decide** — provado sem DOM.
 *
 * Este pacote testa lógica, não pixel (ver `vitest.config.ts`), e o módulo foi
 * escrito para caber nessa régua: a montagem do fluxograma, o recorte do que o
 * cartão mostra, o agrupamento do painel lateral, o endereço de cada botão de
 * consulta e os filtros da lista são todos função pura em `lib/fluxos.ts`.
 *
 * As afirmações abaixo são as do critério de aceite, traduzidas: o fluxo
 * renderiza (todo cartão e toda seta), a etapa selecionada mostra o que
 * cadastraram, e o botão de consulta leva ao endereço certo do FreightCheck.
 */

function etapa(parcial: Partial<Etapa> & { id: string; nome: string }): Etapa {
  return {
    fluxoId: "f",
    descricao: null,
    tipo: "PROCESSO",
    ordem: 0,
    responsavel: null,
    area: null,
    objetivo: null,
    sistemaPrincipal: null,
    regras: null,
    informacoesConsultadas: null,
    observacoes: null,
    status: "ATIVO",
    posX: 0,
    posY: 0,
    chaveMonitoramento: null,
    subfluxoId: null,
    itens: [],
    indicadores: [],
    acoes: [],
    ...parcial,
  };
}

function conexao(parcial: Partial<Conexao> & { id: string; origemEtapaId: string; destinoEtapaId: string }): Conexao {
  return { fluxoId: "f", tipo: "SEQUENCIA", rotulo: null, ordem: 0, ...parcial };
}

const CATALOGO: Catalogo = {
  tiposDeEtapa: [
    {
      valor: "PROCESSO",
      rotulo: "Processo",
      descricao: "",
      forma: "retangulo",
      classe: "border-border",
      icone: "Square",
    },
    {
      valor: "DECISAO",
      rotulo: "Decisão",
      descricao: "",
      forma: "losango",
      classe: "border-amber-300",
      icone: "GitBranch",
    },
  ],
  tiposDeConexao: [
    { valor: "SEQUENCIA", rotulo: "Sequência", descricao: "", tracejada: false, classe: "" },
    { valor: "RETRABALHO", rotulo: "Retrabalho", descricao: "", tracejada: true, classe: "" },
  ],
  especiesDeItem: [
    {
      valor: "SISTEMA",
      rotulo: "Sistema",
      titulo: "Sistemas",
      descricao: "",
      icone: "Server",
      usaLink: true,
      usaObrigatorio: false,
    },
    {
      valor: "FALHA",
      rotulo: "Falha possível",
      titulo: "Falhas possíveis",
      descricao: "",
      icone: "AlertTriangle",
      usaLink: false,
      usaObrigatorio: false,
    },
  ],
  statusDoFluxo: [],
  statusDaEtapa: [],
  sentidosDoIndicador: [],
  modelos: [],
};

const FLUXO: FluxoCompleto = {
  fluxo: {
    id: "f",
    empresaId: "e",
    nome: "Emissão de CTe até Recebimento",
    slug: "cte-ate-recebimento",
    descricao: null,
    objetivo: null,
    categoria: "Faturamento",
    status: "ATIVO",
    versao: 1,
    dono: "Faturamento",
    criadoEm: "2026-08-01T10:00:00.000Z",
    atualizadoEm: "2026-08-27T10:00:00.000Z",
    criadoPor: null,
    atualizadoPor: null,
  },
  etapas: [
    etapa({ id: "validacao", nome: "Validação das regras", ordem: 0, posX: 0, posY: 0 }),
    etapa({
      id: "decide",
      nome: "Passou?",
      tipo: "DECISAO",
      ordem: 1,
      posX: 0,
      posY: 150,
    }),
    etapa({ id: "correcao", nome: "Correção", ordem: 2, posX: 200, posY: 300, status: "ATENCAO" }),
  ],
  conexoes: [
    conexao({ id: "c1", origemEtapaId: "validacao", destinoEtapaId: "decide" }),
    conexao({
      id: "c2",
      origemEtapaId: "decide",
      destinoEtapaId: "correcao",
      tipo: "DECISAO_NAO",
      rotulo: "Não",
    }),
    conexao({
      id: "c3",
      origemEtapaId: "correcao",
      destinoEtapaId: "validacao",
      tipo: "RETRABALHO",
      rotulo: "Corrigido",
    }),
  ],
};

describe("o fluxo renderiza — todo cartão e toda seta", () => {
  it("uma etapa cadastrada vira um nó, na posição gravada", () => {
    const { nos } = montarCanvas(FLUXO, CATALOGO);
    expect(nos).toHaveLength(3);
    expect(nos.map((n) => n.id)).toEqual(["validacao", "decide", "correcao"]);
    expect(nos[1].position).toEqual({ x: 0, y: 150 });
  });

  it("cada nó carrega o tipo do catálogo, e não uma cópia local", () => {
    const { nos } = montarCanvas(FLUXO, CATALOGO);
    expect(nos[1].data.tipo?.forma).toBe("losango");
    expect(nos[1].data.tipo?.rotulo).toBe("Decisão");
  });

  it("um tipo que a tela não conhece não derruba o desenho", () => {
    // O catálogo vem do servidor; um tipo novo lá e um bundle antigo aqui é
    // exatamente o caso em que a tela não pode quebrar.
    const comTipoNovo: FluxoCompleto = {
      ...FLUXO,
      etapas: [etapa({ id: "x", nome: "X", tipo: "SUBPROCESSO" })],
      conexoes: [],
    };
    const { nos } = montarCanvas(comTipoNovo, CATALOGO);
    expect(nos).toHaveLength(1);
    expect(nos[0].data.tipo).toBeUndefined();
    expect(nos[0].data.resumo.tipo).toBe("SUBPROCESSO");
  });

  it("a volta do retrabalho vira seta, e não some", () => {
    const { setas } = montarCanvas(FLUXO, CATALOGO);
    const volta = setas.find((s) => s.id === "c3")!;
    expect(volta.source).toBe("correcao");
    expect(volta.target).toBe("validacao");
    expect(volta.label).toBe("Corrigido");
    expect(volta.style.strokeDasharray).toBe("6 4");
    expect(volta.animated).toBe(true);
  });

  it("as saídas de uma decisão saem em cores diferentes", () => {
    const { setas } = montarCanvas(FLUXO, CATALOGO);
    const nao = setas.find((s) => s.id === "c2")!;
    const normal = setas.find((s) => s.id === "c1")!;
    expect(nao.style.stroke).not.toBe(normal.style.stroke);
    expect(nao.markerEnd.color).toBe(nao.style.stroke);
  });

  it("uma seta cuja etapa não existe mais é descartada, não desenhada para o nada", () => {
    const quebrado: FluxoCompleto = {
      ...FLUXO,
      conexoes: [...FLUXO.conexoes, conexao({ id: "c9", origemEtapaId: "decide", destinoEtapaId: "fantasma" })],
    };
    const { setas } = montarCanvas(quebrado, CATALOGO);
    expect(setas.map((s) => s.id)).not.toContain("c9");
    expect(setas).toHaveLength(3);
  });

  it("sem catálogo (ainda carregando) o desenho sai, sem cor de tipo", () => {
    const { nos, setas } = montarCanvas(FLUXO, undefined);
    expect(nos).toHaveLength(3);
    expect(setas).toHaveLength(3);
  });

  it("o resumo do cabeçalho diz que o processo tem retorno", () => {
    expect(resumoDoFluxo(FLUXO)).toBe("3 etapas · 3 conexões · com retorno");
  });

  it("um processo linear não é anunciado como tendo retorno", () => {
    const linear: FluxoCompleto = { ...FLUXO, conexoes: [FLUXO.conexoes[0]] };
    expect(resumoDoFluxo(linear)).toBe("3 etapas · 1 conexão");
  });
});

describe("o cartão mostra pouco, de propósito", () => {
  it("nome, tipo e quem responde — e o resto vira um contador", () => {
    const cheia = etapa({
      id: "sefaz",
      nome: "Autorização SEFAZ",
      tipo: "SISTEMA",
      area: "Faturamento",
      responsavel: "Analista",
      itens: Array.from({ length: 10 }, (_, i) => ({
        id: `i${i}`,
        especie: "FALHA",
        nome: `Falha ${i}`,
        descricao: null,
        obrigatorio: null,
        link: null,
        ordem: i,
      })),
      acoes: [
        {
          id: "a1",
          titulo: "Ver rejeitados",
          descricao: null,
          rota: "/alteracoes",
          parametros: null,
          icone: null,
          ordem: 0,
        },
      ],
    });

    const resumo = resumoDoCartao(cheia);
    expect(resumo.nome).toBe("Autorização SEFAZ");
    expect(resumo.quemResponde).toBe("Faturamento · Analista");
    expect(resumo.detalhes).toBe(11);
    /* O cartão não recebe as dez falhas — só o número. */
    expect(Object.keys(resumo).sort()).toEqual([
      "atencao",
      "detalhes",
      "nome",
      "quemResponde",
      "tipo",
    ]);
  });

  it("sem área e sem responsável, a linha não aparece em branco", () => {
    expect(resumoDoCartao(etapa({ id: "x", nome: "X" })).quemResponde).toBeNull();
  });

  it("só a área basta", () => {
    expect(resumoDoCartao(etapa({ id: "x", nome: "X", area: "Financeiro" })).quemResponde).toBe(
      "Financeiro",
    );
  });

  it("a etapa marcada como atenção é sinalizada", () => {
    expect(resumoDoCartao(FLUXO.etapas[2]).atencao).toBe(true);
    expect(resumoDoCartao(FLUXO.etapas[0]).atencao).toBe(false);
  });
});

describe("o painel lateral agrupa o material por espécie", () => {
  const comMaterial = etapa({
    id: "sefaz",
    nome: "Autorização SEFAZ",
    itens: [
      {
        id: "f2",
        especie: "FALHA",
        nome: "Rejeição por tributação",
        descricao: null,
        obrigatorio: null,
        link: null,
        ordem: 1,
      },
      {
        id: "s1",
        especie: "SISTEMA",
        nome: "SEFAZ",
        descricao: "Ambiente autorizador",
        obrigatorio: null,
        link: "https://www.cte.fazenda.gov.br",
        ordem: 0,
      },
      {
        id: "f1",
        especie: "FALHA",
        nome: "Rejeição por cadastro",
        descricao: null,
        obrigatorio: null,
        link: null,
        ordem: 0,
      },
    ],
  });

  it("agrupa na ordem do catálogo, e ordena dentro do grupo", () => {
    const grupos = itensPorEspecie(comMaterial, CATALOGO.especiesDeItem);
    expect(grupos.map((g) => g.especie.valor)).toEqual(["SISTEMA", "FALHA"]);
    expect(grupos[1].itens.map((i) => i.nome)).toEqual([
      "Rejeição por cadastro",
      "Rejeição por tributação",
    ]);
  });

  it("espécie sem item não vira seção vazia", () => {
    const so = etapa({
      id: "x",
      nome: "X",
      itens: [
        {
          id: "s",
          especie: "SISTEMA",
          nome: "ERP",
          descricao: null,
          obrigatorio: null,
          link: null,
          ordem: 0,
        },
      ],
    });
    expect(itensPorEspecie(so, CATALOGO.especiesDeItem).map((g) => g.especie.valor)).toEqual([
      "SISTEMA",
    ]);
  });

  it("etapa sem material nenhum não produz seção alguma", () => {
    expect(itensPorEspecie(etapa({ id: "x", nome: "X" }), CATALOGO.especiesDeItem)).toEqual([]);
  });
});

describe("a navegação por ação interna", () => {
  it("um caminho simples vira o próprio endereço", () => {
    expect(enderecoDaAcao({ rota: "/fechamento/conciliacao" })).toBe("/fechamento/conciliacao");
  });

  it("os parâmetros viram query string, sempre na mesma ordem", () => {
    expect(
      enderecoDaAcao({ rota: "/alteracoes", parametros: { status: "REJEITADO", pagina: "2" } }),
    ).toBe("/alteracoes?pagina=2&status=REJEITADO");
  });

  it("preserva a query que já vinha na rota", () => {
    expect(enderecoDaAcao({ rota: "/dre?ano=2026", parametros: { unidade: "belem" } })).toBe(
      "/dre?ano=2026&unidade=belem",
    );
  });

  it("escapa acento e espaço", () => {
    expect(enderecoDaAcao({ rota: "/x", parametros: { q: "CDD Belém" } })).toBe(
      "/x?q=CDD+Bel%C3%A9m",
    );
  });

  it("um endereço externo devolve nulo — a tela não oferece o botão", () => {
    expect(enderecoDaAcao({ rota: "https://exemplo.com" })).toBeNull();
  });

  it("`//host` devolve nulo — é outro domínio para o navegador", () => {
    expect(enderecoDaAcao({ rota: "//evil.com/x" })).toBeNull();
  });

  it("javascript: devolve nulo", () => {
    expect(enderecoDaAcao({ rota: "javascript:alert(1)" })).toBeNull();
  });

  it("parâmetros vazios não deixam um `?` solto no fim", () => {
    expect(enderecoDaAcao({ rota: "/x", parametros: {} })).toBe("/x");
  });
});

describe("a lista", () => {
  const linhas: FluxoNaLista[] = [
    {
      ...FLUXO.fluxo,
      id: "1",
      nome: "Emissão de CTe até Recebimento",
      categoria: "Faturamento",
      dono: "Faturamento",
      descricao: "Da negociação ao extrato.",
      etapas: 16,
      conexoes: 20,
    },
    {
      ...FLUXO.fluxo,
      id: "2",
      nome: "NF até pagamento",
      categoria: "Financeiro",
      dono: "Contas a pagar",
      descricao: null,
      etapas: 7,
      conexoes: 7,
    },
    {
      ...FLUXO.fluxo,
      id: "3",
      nome: "Conciliação bancária",
      categoria: "Financeiro",
      dono: null,
      descricao: null,
      etapas: 4,
      conexoes: 3,
    },
  ];

  it("as categorias saem sem repetição e em ordem", () => {
    expect(categoriasDaLista(linhas)).toEqual(["Faturamento", "Financeiro"]);
  });

  it("o filtro por categoria recorta", () => {
    expect(filtrarFluxos(linhas, { categoria: "Financeiro" }).map((f) => f.id)).toEqual(["2", "3"]);
  });

  it("a busca acha por nome, por categoria e por dono", () => {
    expect(filtrarFluxos(linhas, { busca: "cte" }).map((f) => f.id)).toEqual(["1"]);
    expect(filtrarFluxos(linhas, { busca: "financeiro" }).map((f) => f.id)).toEqual(["2", "3"]);
    expect(filtrarFluxos(linhas, { busca: "contas a pagar" }).map((f) => f.id)).toEqual(["2"]);
  });

  it("busca em branco não esconde nada", () => {
    expect(filtrarFluxos(linhas, { busca: "   " })).toHaveLength(3);
  });

  it("os dois filtros se combinam", () => {
    expect(
      filtrarFluxos(linhas, { busca: "conciliação", categoria: "Faturamento" }),
    ).toHaveLength(0);
  });
});

describe("a data", () => {
  it("sai no formato do produto, sem recuar o dia pelo fuso", () => {
    expect(comoData("2026-08-27T02:00:00.000Z")).toBe("27/08/2026");
  });
});

/**
 * O contador do roteiro — a única coisa que a tela sabe sobre o texto colado.
 *
 * A gramática mora no servidor (`interpretarRoteiro`, em `@workspace/fluxos`), e
 * é lá que ela é validada. Aqui só se conta o que vai virar etapa, para a caixa
 * dizer "13 etapas" enquanto se digita. A regra de "linha que conta" é a mesma
 * dos dois lados, e o teste gêmeo deste vive em
 * `lib/fluxos/src/__tests__/roteiro.test.ts` — as duas contagens precisam
 * concordar, e é por isso que ambas são afirmadas.
 */
describe("o contador do roteiro", () => {
  it("conta uma etapa por linha", () => {
    expect(etapasDoRoteiro("Primeira\nSegunda\nTerceira")).toBe(3);
  });

  it("linha em branco e comentário não contam", () => {
    expect(etapasDoRoteiro("# nota\n\nPrimeira\n   \nSegunda\n")).toBe(2);
  });

  it("a linha paralela conta como etapa — ela é uma", () => {
    expect(etapasDoRoteiro("Emissão\nRodopar\n+ Connect")).toBe(3);
  });

  it("texto vazio conta zero, sem reclamar — a caixa começa vazia", () => {
    expect(etapasDoRoteiro("")).toBe(0);
    expect(etapasDoRoteiro("  \n\n  ")).toBe(0);
  });
});

/**
 * O tempo relativo — a etiqueta que a lista mostra no lugar da data exata.
 *
 * A conta é de dias de calendário, e não de horas: o fluxo salvo ontem às 23h
 * precisa continuar sendo "ontem" para quem abre a tela às 8h da manhã. É a
 * diferença entre uma etiqueta que se lê de relance e uma que muda de texto
 * enquanto a pessoa olha.
 */
describe("o tempo desde a última mudança", () => {
  const agora = new Date(2026, 7, 27); // 27/08/2026, hora local

  it("hoje e ontem têm nome, não número", () => {
    expect(comoTempoRelativo("2026-08-27T23:30:00.000Z", agora)).toBe("hoje");
    expect(comoTempoRelativo("2026-08-26T23:30:00.000Z", agora)).toBe("ontem");
  });

  it("dentro da semana conta em dias", () => {
    expect(comoTempoRelativo("2026-08-25T10:00:00.000Z", agora)).toBe("há 2 dias");
    expect(comoTempoRelativo("2026-08-21T10:00:00.000Z", agora)).toBe("há 6 dias");
  });

  it("passando da semana, do mês e do ano, a unidade sobe — e o singular é singular", () => {
    expect(comoTempoRelativo("2026-08-20T10:00:00.000Z", agora)).toBe("há 1 semana");
    expect(comoTempoRelativo("2026-08-06T10:00:00.000Z", agora)).toBe("há 3 semanas");
    expect(comoTempoRelativo("2026-07-20T10:00:00.000Z", agora)).toBe("há 1 mês");
    expect(comoTempoRelativo("2025-01-10T10:00:00.000Z", agora)).toBe("há 1 ano");
  });

  it("data futura não vira número negativo", () => {
    expect(comoTempoRelativo("2026-09-10T10:00:00.000Z", agora)).toBe("hoje");
  });
});

/**
 * A cor da categoria sai do nome, e não do sorteio nem da posição: a mesma
 * categoria precisa ficar com a mesma tarja depois de recarregar a página e
 * depois de reordenar a lista, senão a cor não serve para achar nada.
 */
describe("o acento da categoria", () => {
  it("a mesma categoria dá sempre a mesma cor", () => {
    expect(acentoDaCategoria("Financeiro")).toEqual(acentoDaCategoria("Financeiro"));
  });

  it("maiúscula e espaço em volta não mudam a cor", () => {
    expect(acentoDaCategoria("  financeiro ")).toEqual(acentoDaCategoria("Financeiro"));
  });

  it("categorias diferentes do módulo não caem todas na mesma cor", () => {
    const cores = new Set(
      ["Faturamento", "Financeiro", "Operação", "Fiscal"].map((c) => acentoDaCategoria(c).barra),
    );
    expect(cores.size).toBeGreaterThan(1);
  });
});

/**
 * A ordem da lista é a da última mexida — quem entra aqui volta ao que estava
 * editando. Arquivado vai para o fim: continua no acervo, sai do caminho.
 */
describe("a ordem da lista", () => {
  const em = (id: string, atualizadoEm: string, status: FluxoNaLista["status"] = "ATIVO") => ({
    ...FLUXO.fluxo,
    id,
    status,
    atualizadoEm,
    etapas: 1,
    conexoes: 0,
  });

  it("o mais recente vem primeiro", () => {
    const lista = [
      em("antigo", "2026-01-02T00:00:00.000Z"),
      em("novo", "2026-08-20T00:00:00.000Z"),
      em("meio", "2026-05-05T00:00:00.000Z"),
    ];
    expect(ordenarPorAtualizacao(lista).map((f) => f.id)).toEqual(["novo", "meio", "antigo"]);
  });

  it("o arquivado desce, mesmo tendo sido mexido ontem", () => {
    const lista = [
      em("arquivado", "2026-08-26T00:00:00.000Z", "ARQUIVADO"),
      em("ativo", "2026-01-01T00:00:00.000Z"),
    ];
    expect(ordenarPorAtualizacao(lista).map((f) => f.id)).toEqual(["ativo", "arquivado"]);
  });

  it("não mexe na lista que recebeu", () => {
    const lista = [em("a", "2026-01-01T00:00:00.000Z"), em("b", "2026-08-01T00:00:00.000Z")];
    ordenarPorAtualizacao(lista);
    expect(lista.map((f) => f.id)).toEqual(["a", "b"]);
  });
});
