import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PainelDaEtapa } from "@/components/fluxos/painel-da-etapa";
import { VisaoJornada } from "@/components/fluxos/visao-jornada";
import { VisaoLista, vizinhaNaOrdem } from "@/components/fluxos/visao-lista";
import { montarProjecao } from "@/lib/fluxos-canvas";
import {
  analisarFluxo,
  cartaoDaJornada,
  CAMPOS_DO_PAINEL,
  camposVaziosDoPainel,
  corpoDasLinhas,
  linhaNovaDoPainel,
  linhasDaListaDoPainel,
  listaDoPainelPorChave,
  listasDoPainel,
  listasVaziasDoPainel,
  edicaoNaLista,
  etapaNovaVazia,
  filtrarLinhas,
  linhasDaLista,
  ordenarLinhas,
  podeCriarEtapaNaLista,
  resumoDaLente,
  slaDaEtapa,
  tipoSugeridoNaLista,
  valorDoCampo,
  valoresDaColuna,
} from "@/lib/fluxos-analise";
import {
  LENTES_DA_JORNADA,
  normalizarPreferencia,
  numeracaoDoFluxo,
  ordemDeLeitura,
  posicoesDoFluxo,
  posicoesDoMapa,
  projetarRaias,
  resumoDeResponsabilidade,
  VISUALIZACOES,
} from "@/lib/fluxos-visoes";
import { corpoDaEtapa, subfluxoDaEtapa } from "@/lib/fluxos";
import type { Catalogo, Conexao, Etapa, FluxoCompleto } from "@/lib/fluxos";

/**
 * A PROVA DE QUE EXISTE UMA FONTE DE VERDADE SÓ.
 *
 * O que este arquivo cobre não é aparência: é a afirmação central do módulo —
 * seis visualizações, um processo. Cada caso abaixo é um dos critérios de
 * aceite escritos como código:
 *
 * 1. alternar entre visualizações não muda o dado;
 * 2. o que se edita numa aparece nas outras;
 * 3. o mesmo, pelo caminho do responsável e das raias;
 * 4. excluir uma etapa a tira de todas;
 * 5. criar conexão aparece em todas as projeções que usam conexão;
 * 6. alternar visualização não escreve — provado no texto-fonte;
 * 7. só-leitura vale em todas, porque o painel é um só;
 * 8. um fluxo legado (sem posição, sem área, sem prazo) abre sem migração;
 * 9. a Lista edita na célula — e só onde editar a célula é gravar a verdade;
 * 10. o painel edita campo a campo, sem abrir o editor — e sem passar a gravar
 *     por conta própria;
 * 11. as listas da etapa também se editam no painel, e a linha que vai ao
 *     servidor é a que está na tela.
 *
 * As projeções são funções puras, e é por isso que tudo isto cabe num teste sem
 * DOM e sem servidor: se elas precisassem de canvas para serem verificadas, a
 * garantia de SSOT não teria como ser provada.
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
    falhas: null,
    gargalos: null,
    informacoes: null,
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

function conexao(
  parcial: Partial<Conexao> & { id: string; origemEtapaId: string; destinoEtapaId: string },
): Conexao {
  return { fluxoId: "f", tipo: "SEQUENCIA", rotulo: null, ordem: 0, ...parcial };
}

function item(especie: string, nome: string, ordem = 0) {
  return { id: `${especie}-${nome}`, especie, nome, descricao: null, obrigatorio: null, link: null, ordem };
}

const CATALOGO = {
  tiposDeEtapa: [
    { valor: "PROCESSO", rotulo: "Processo", descricao: "", forma: "retangulo" as const, classe: "c", icone: "Square" },
    { valor: "INICIO", rotulo: "Início", descricao: "", forma: "pilula" as const, classe: "c", icone: "Play" },
    { valor: "FIM", rotulo: "Fim", descricao: "", forma: "pilula" as const, classe: "c", icone: "Flag" },
  ],
  tiposDeConexao: [
    { valor: "SEQUENCIA", rotulo: "Sequência", descricao: "", tracejada: false, classe: "s" },
    { valor: "RETRABALHO", rotulo: "Retrabalho", descricao: "", tracejada: true, classe: "s" },
  ],
  especiesDeItem: [
    { valor: "SISTEMA", rotulo: "Sistema", titulo: "Sistemas", descricao: "", icone: "Server", usaLink: true, usaObrigatorio: false },
    { valor: "PRAZO", rotulo: "Prazo", titulo: "Prazos e SLA", descricao: "", icone: "Hourglass", usaLink: false, usaObrigatorio: false },
    { valor: "FALHA", rotulo: "Falha", titulo: "Falhas possíveis", descricao: "", icone: "AlertTriangle", usaLink: false, usaObrigatorio: false },
  ],
  statusDoFluxo: [],
  statusDaEtapa: [{ valor: "ATIVO", rotulo: "Ativa", descricao: "" }],
  sentidosDoIndicador: [],
  modelos: [],
} as unknown as Catalogo;

/**
 * O processo do critério de aceite: quinze etapas, dezesseis conexões — a
 * corrente do processo mais um retorno, que é o que o torna um grafo e não uma
 * lista.
 */
const AREAS = [
  "Operação",
  "Operação",
  "Fiscal",
  "Fiscal",
  "Financeiro",
  "Financeiro",
  "Operação",
  "Sistema",
  "Sistema",
  "Fiscal",
  "Financeiro",
  "Financeiro",
  "Banco",
  "Banco",
  "Operação",
];

function fluxoDeQuinze(): FluxoCompleto {
  const etapas = AREAS.map((area, i) =>
    etapa({
      id: `e${i + 1}`,
      nome: `Etapa ${i + 1}`,
      ordem: i,
      area,
      responsavel: `Analista ${area}`,
      sistemaPrincipal: i % 3 === 0 ? "SAP" : "TMS",
      descricao: "Descrição da etapa.",
      tipo: i === 0 ? "INICIO" : i === 14 ? "FIM" : "PROCESSO",
      posX: 0,
      posY: i * 150,
      itens: [item("PRAZO", "4 horas")],
    }),
  );
  const conexoes = etapas
    .slice(0, -1)
    .map((e, i) => conexao({ id: `c${i + 1}`, origemEtapaId: e.id, destinoEtapaId: etapas[i + 1].id }));
  /* As duas últimas: o retorno do Fiscal e o desvio de exceção. */
  conexoes.push(
    conexao({ id: "c15", origemEtapaId: "e4", destinoEtapaId: "e2", tipo: "RETRABALHO" }),
    conexao({ id: "c16", origemEtapaId: "e10", destinoEtapaId: "e3", tipo: "EXCECAO" }),
  );
  return {
    fluxo: {
      id: "f",
      empresaId: "u",
      nome: "Operação Empurrada",
      slug: "operacao-empurrada",
      descricao: null,
      objetivo: null,
      categoria: "Faturamento",
      status: "RASCUNHO",
      versao: 1,
      dono: "Operação",
      criadoEm: "2026-01-01T00:00:00Z",
      atualizadoEm: "2026-01-01T00:00:00Z",
      criadoPor: null,
      atualizadoPor: null,
    },
    etapas,
    conexoes,
  };
}

/** Todas as projeções, calculadas de uma vez — o "alternar" do critério 1. */
function projetarTudo(completo: FluxoCompleto) {
  return {
    fluxo: montarProjecao(completo, CATALOGO, {
      posicoes: posicoesDoFluxo(completo, "vertical"),
    }),
    horizontal: montarProjecao(completo, CATALOGO, {
      posicoes: posicoesDoFluxo(completo, "horizontal"),
    }),
    raias: projetarRaias(completo, "area"),
    jornada: ordemDeLeitura(completo),
    mapa: montarProjecao(completo, CATALOGO, { posicoes: posicoesDoMapa(completo) }),
    lista: linhasDaLista(completo),
    gargalos: analisarFluxo(completo),
  };
}

describe("caso 1 — alternar visualização não muda o processo", () => {
  it("mantém as mesmas quinze etapas e dezesseis conexões em todas as projeções", () => {
    const completo = fluxoDeQuinze();
    expect(completo.etapas).toHaveLength(15);
    expect(completo.conexoes).toHaveLength(16);

    const antes = JSON.stringify(completo);

    /* Fluxo → Raias → Lista → Gargalos → Fluxo, na ordem do critério. */
    const primeira = projetarTudo(completo);
    projetarRaias(completo, "responsavel");
    linhasDaLista(completo);
    analisarFluxo(completo);
    const ultima = projetarTudo(completo);

    /* O objeto não foi tocado por nenhuma projeção. */
    expect(JSON.stringify(completo)).toBe(antes);

    for (const projecao of [primeira, ultima]) {
      expect(projecao.fluxo.nos).toHaveLength(15);
      expect(projecao.fluxo.setas).toHaveLength(16);
      expect(projecao.horizontal.nos).toHaveLength(15);
      expect(projecao.mapa.nos).toHaveLength(15);
      expect(projecao.lista).toHaveLength(15);
      expect(projecao.jornada).toHaveLength(15);
      expect(projecao.gargalos.porEtapa.size).toBe(15);
      expect(projecao.raias.posicoes.size).toBe(15);
      expect(projecao.raias.raias.flatMap((r) => r.etapas)).toHaveLength(15);
    }

    /* E voltar para o Fluxo devolve exatamente o mesmo desenho de antes. */
    expect(ultima.fluxo.nos.map((n) => n.position)).toEqual(
      primeira.fluxo.nos.map((n) => n.position),
    );
  });

  it("o fluxo horizontal não sobrescreve o arranjo gravado", () => {
    const completo = fluxoDeQuinze();
    const horizontais = posicoesDoFluxo(completo, "horizontal");
    /* Ele anda no eixo X, que no arranjo gravado é sempre zero. */
    expect([...horizontais.values()].some((p) => p.x > 0)).toBe(true);
    /* E o gravado continua o gravado. */
    expect(completo.etapas.every((e) => e.posX === 0)).toBe(true);
    expect(posicoesDoFluxo(completo, "vertical").get("e3")).toEqual({ x: 0, y: 300 });
  });
});

describe("caso 2 — editar o nome pela Lista aparece no Fluxo", () => {
  it("o cartão do canvas carrega o nome novo", () => {
    const completo = fluxoDeQuinze();
    /* É o que a mutação faz: o cache passa a ter outro objeto, com o novo nome. */
    const depois: FluxoCompleto = {
      ...completo,
      etapas: completo.etapas.map((e) =>
        e.id === "e3" ? { ...e, nome: "Validação da tarifa" } : e,
      ),
    };

    expect(linhasDaLista(depois).find((l) => l.etapa.id === "e3")?.etapa.nome).toBe(
      "Validação da tarifa",
    );
    const no = montarProjecao(depois, CATALOGO, {}).nos.find((n) => n.id === "e3");
    expect(no?.data.resumo.nome).toBe("Validação da tarifa");
    expect(ordemDeLeitura(depois)[2].nome).toBe("Validação da tarifa");
  });
});

describe("caso 3 — editar o responsável pelo detalhe muda as Raias", () => {
  it("a etapa troca de raia e a contagem de handoffs acompanha", () => {
    const completo = fluxoDeQuinze();
    const antes = projetarRaias(completo, "area");
    const raiaDaTerceira = antes.raias.find((r) => r.etapas.includes("e3"));
    expect(raiaDaTerceira?.rotulo).toBe("Fiscal");

    const depois: FluxoCompleto = {
      ...completo,
      etapas: completo.etapas.map((e) => (e.id === "e3" ? { ...e, area: "Financeiro" } : e)),
    };
    const projetada = projetarRaias(depois, "area");
    expect(projetada.raias.find((r) => r.etapas.includes("e3"))?.rotulo).toBe("Financeiro");
    expect(resumoDeResponsabilidade(depois, "area").trocas).not.toBe(
      resumoDeResponsabilidade(completo, "area").trocas,
    );
  });

  it("agrupar por sistema usa o sistema principal e, na falta dele, o item cadastrado", () => {
    const completo = fluxoDeQuinze();
    const comItem: FluxoCompleto = {
      ...completo,
      etapas: completo.etapas.map((e) =>
        e.id === "e2"
          ? { ...e, sistemaPrincipal: null, itens: [...e.itens, item("SISTEMA", "Unidox")] }
          : e,
      ),
    };
    const projetada = projetarRaias(comItem, "sistema");
    expect(projetada.raias.find((r) => r.etapas.includes("e2"))?.rotulo).toBe("Unidox");
  });

  it("a raia do não preenchido existe, é nomeada e vai para o fim", () => {
    const completo = fluxoDeQuinze();
    const semArea: FluxoCompleto = {
      ...completo,
      etapas: completo.etapas.map((e) => (e.id === "e5" ? { ...e, area: null } : e)),
    };
    const projetada = projetarRaias(semArea, "area");
    const ultima = projetada.raias[projetada.raias.length - 1];
    expect(ultima.semInformacao).toBe(true);
    expect(ultima.rotulo).toBe("Sem área definida");
    expect(ultima.etapas).toContain("e5");
  });
});

describe("caso 4 — excluir uma etapa a tira de todas as visualizações", () => {
  it("some do canvas, das raias, da jornada, da lista e da análise", () => {
    const completo = fluxoDeQuinze();
    const semSetima: FluxoCompleto = {
      ...completo,
      etapas: completo.etapas.filter((e) => e.id !== "e7"),
      /* O servidor apaga as conexões em cascata; o cliente vê o mesmo. */
      conexoes: completo.conexoes.filter(
        (c) => c.origemEtapaId !== "e7" && c.destinoEtapaId !== "e7",
      ),
    };
    const projecao = projetarTudo(semSetima);
    expect(projecao.fluxo.nos.map((n) => n.id)).not.toContain("e7");
    expect(projecao.mapa.nos.map((n) => n.id)).not.toContain("e7");
    expect(projecao.lista.map((l) => l.etapa.id)).not.toContain("e7");
    expect(projecao.jornada.map((e) => e.id)).not.toContain("e7");
    expect(projecao.gargalos.porEtapa.has("e7")).toBe(false);
    expect(projecao.raias.raias.flatMap((r) => r.etapas)).not.toContain("e7");
  });

  it("uma conexão órfã não vira seta para o nada em nenhuma projeção", () => {
    const completo = fluxoDeQuinze();
    const orfa: FluxoCompleto = { ...completo, etapas: completo.etapas.filter((e) => e.id !== "e7") };
    const projecao = montarProjecao(orfa, CATALOGO, {});
    expect(projecao.setas.some((s) => s.source === "e7" || s.target === "e7")).toBe(false);
    expect(projetarRaias(orfa, "area").handoffs.every((h) => h.conexaoId !== "c6")).toBe(true);
  });
});

describe("caso 5 — criar conexão aparece em todas as projeções que a usam", () => {
  it("vira seta, vira entrada/saída na lista e conta como handoff quando troca de raia", () => {
    const completo = fluxoDeQuinze();
    const nova: FluxoCompleto = {
      ...completo,
      conexoes: [
        ...completo.conexoes,
        conexao({ id: "c99", origemEtapaId: "e1", destinoEtapaId: "e13" }),
      ],
    };

    expect(montarProjecao(nova, CATALOGO, {}).setas.map((s) => s.id)).toContain("c99");

    const linhas = linhasDaLista(nova);
    expect(linhas.find((l) => l.etapa.id === "e13")?.entradas).toContain("Etapa 1");
    expect(linhas.find((l) => l.etapa.id === "e1")?.saidas).toContain("Etapa 13");

    /* Operação → Banco é troca de responsabilidade, e é contada como tal. */
    const raias = projetarRaias(nova, "area");
    expect(raias.handoffs.some((h) => h.conexaoId === "c99")).toBe(true);
    expect(resumoDeResponsabilidade(nova, "area").trocas).toBe(
      resumoDeResponsabilidade(completo, "area").trocas + 1,
    );
  });
});

describe("caso 6 — alternar visualização não escreve no banco", () => {
  /*
    A prova é no texto-fonte, e não numa espiã: uma espiã provaria que **esta**
    chamada não gravou; o texto prova que não existe caminho de código por onde
    gravar. É a mesma técnica de `corpo-json.test.ts`, e pela mesma razão.
  */
  const raiz = path.resolve(import.meta.dirname, "..", "..");
  const PROJECOES = [
    "lib/fluxos-visoes.ts",
    "lib/fluxos-analise.ts",
    "lib/fluxos-canvas.ts",
    "components/fluxos/visao-fluxo.tsx",
    "components/fluxos/visao-raias.tsx",
    "components/fluxos/visao-jornada.tsx",
    "components/fluxos/visao-mapa.tsx",
    "components/fluxos/visao-lista.tsx",
    "components/fluxos/visao-gargalos.tsx",
    "components/fluxos/seletor-de-visualizacao.tsx",
  ];

  it.each(PROJECOES)("%s não chama escrita nenhuma", (arquivo) => {
    const texto = readFileSync(path.join(raiz, arquivo), "utf8");
    expect(texto).not.toMatch(/\bescritas\./);
    expect(texto).not.toMatch(/\bfetchJson\b/);
    expect(texto).not.toMatch(/useMutation/);
  });

  /*
    Quem edita alguma coisa por si tem de respeitar o interruptor: as quatro do
    canvas, que arrastam e ligam, e a Lista, que edita célula. A Jornada fica de
    fora porque o que ela abre é o painel de detalhe, e é a página que decide
    ali se ele pode editar — cobrar `somenteLeitura` dela seria cobrar uma
    propriedade que não teria o que fazer.
  */
  const NO_CANVAS = [
    "components/fluxos/visao-fluxo.tsx",
    "components/fluxos/visao-raias.tsx",
    "components/fluxos/visao-mapa.tsx",
    "components/fluxos/visao-gargalos.tsx",
    "components/fluxos/visao-lista.tsx",
  ];

  it("toda visualização que edita repassa o modo de leitura", () => {
    for (const arquivo of NO_CANVAS) {
      const texto = readFileSync(path.join(raiz, arquivo), "utf8");
      expect(texto, arquivo).toMatch(/somenteLeitura/);
    }
  });

  it("o seletor oferece exatamente as seis visualizações", () => {
    expect(VISUALIZACOES.map((v) => v.valor)).toEqual([
      "fluxo",
      "raias",
      "jornada",
      "mapa",
      "lista",
      "gargalos",
    ]);
  });

  it("uma preferência guardada por outra versão não quebra a tela", () => {
    expect(normalizarPreferencia({ visualizacao: "inventada" }).visualizacao).toBe("fluxo");
    expect(normalizarPreferencia(null)).toEqual({
      visualizacao: "fluxo",
      orientacao: "vertical",
      agrupamento: "area",
      lente: "operacao",
    });
    expect(normalizarPreferencia({ visualizacao: "raias", agrupamento: "sistema" })).toEqual({
      visualizacao: "raias",
      orientacao: "vertical",
      agrupamento: "sistema",
      lente: "operacao",
    });
    /* Um tipo de jornada inventado cai no padrão em vez de esvaziar o cartão. */
    expect(normalizarPreferencia({ lente: "inventada" }).lente).toBe("operacao");
    expect(normalizarPreferencia({ lente: "falhas" }).lente).toBe("falhas");
  });
});

describe("caso 7 — só leitura vale em todas, porque o painel é um só", () => {
  const alvo = etapa({ id: "e1", nome: "Validação da tarifa", area: "Fiscal" });

  it("sem permissão, o painel não oferece editar, excluir nem etapa seguinte", () => {
    const html = renderToStaticMarkup(
      <PainelDaEtapa
        etapa={alvo}
        catalogo={CATALOGO}
        podeEditar={false}
        onEditar={() => undefined}
        onSeguinte={() => undefined}
        onExcluir={() => undefined}
        onFechar={() => undefined}
      />,
    );
    expect(html).toContain("Validação da tarifa");
    expect(html).not.toContain("Editar etapa");
    expect(html).not.toContain("Excluir");
    expect(html).not.toContain("Etapa seguinte");
  });

  it("com permissão, os mesmos comandos aparecem", () => {
    const html = renderToStaticMarkup(
      <PainelDaEtapa
        etapa={alvo}
        catalogo={CATALOGO}
        podeEditar
        onEditar={() => undefined}
        onSeguinte={() => undefined}
        onExcluir={() => undefined}
        onFechar={() => undefined}
      />,
    );
    expect(html).toContain("Editar etapa");
    expect(html).toContain("Excluir");
  });

  it("o painel dos Gargalos explica por que a etapa está destacada", () => {
    const completo = fluxoDeQuinze();
    const analise = analisarFluxo(completo);
    const html = renderToStaticMarkup(
      <PainelDaEtapa
        etapa={completo.etapas[1]}
        catalogo={CATALOGO}
        podeEditar={false}
        diagnostico={analise.porEtapa.get("e2")}
        onEditar={() => undefined}
        onSeguinte={() => undefined}
        onExcluir={() => undefined}
        onFechar={() => undefined}
      />,
    );
    expect(html).toContain("Por que esta etapa está destacada?");
    expect(html).toContain("retorno chega a esta etapa");
  });
});

describe("caso 8 — um fluxo legado abre sem migração nenhuma", () => {
  /* Sem posição, sem área, sem responsável, sem sistema, sem item nenhum. */
  const legado: FluxoCompleto = {
    ...fluxoDeQuinze().fluxo,
  } as never as FluxoCompleto;

  const completo: FluxoCompleto = {
    fluxo: fluxoDeQuinze().fluxo,
    etapas: [
      etapa({ id: "a", nome: "Recebe o pedido", ordem: 0 }),
      etapa({ id: "b", nome: "Fatura", ordem: 1 }),
    ],
    conexoes: [conexao({ id: "x", origemEtapaId: "a", destinoEtapaId: "b" })],
  };

  it("as seis projeções funcionam com etapas na origem e sem cadastro", () => {
    expect(legado).toBeTruthy();
    const projecao = projetarTudo(completo);
    expect(projecao.fluxo.nos).toHaveLength(2);
    expect(projecao.raias.raias).toHaveLength(1);
    expect(projecao.raias.raias[0].semInformacao).toBe(true);
    expect(projecao.lista.map((l) => l.numero)).toEqual([1, 2]);
    expect(projecao.horizontal.nos.map((n) => n.position.x)).toEqual([0, 260]);
  });

  it("etapa sem cadastro nenhum é “sem avaliação”, e não “normal”", () => {
    const analise = analisarFluxo(completo);
    expect(analise.porEtapa.get("a")?.severidade).toBe("sem-avaliacao");
    expect(analise.contagem["sem-avaliacao"]).toBe(2);
  });

  it("sem prazo cadastrado, o SLA é ausência declarada e não um número", () => {
    expect(slaDaEtapa(completo.etapas[0])).toBeNull();
    expect(slaDaEtapa(etapa({ id: "z", nome: "Z", itens: [item("PRAZO", "4 horas")] }))).toBe(
      "4 horas",
    );
  });
});

describe("a análise conta o que existe, e só", () => {
  it("aponta falha registrada, retorno, ausência de prazo e de sistema", () => {
    const completo: FluxoCompleto = {
      fluxo: fluxoDeQuinze().fluxo,
      etapas: [
        etapa({ id: "a", nome: "A", area: "Operação", descricao: "faz", itens: [item("PRAZO", "1h"), item("SISTEMA", "SAP")] }),
        etapa({
          id: "b",
          nome: "B",
          area: "Fiscal",
          descricao: "confere",
          itens: [item("FALHA", "Nota rejeitada")],
        }),
      ],
      conexoes: [
        conexao({ id: "1", origemEtapaId: "a", destinoEtapaId: "b" }),
        conexao({ id: "2", origemEtapaId: "b", destinoEtapaId: "a", tipo: "RETRABALHO" }),
      ],
    };
    const analise = analisarFluxo(completo);

    const a = analise.porEtapa.get("a")!;
    expect(a.severidade).toBe("critico");
    expect(a.sinais.map((s) => s.chave)).toContain("retorno");

    const b = analise.porEtapa.get("b")!;
    expect(b.sinais.map((s) => s.chave)).toEqual(
      expect.arrayContaining(["problema", "sem-sistema", "sem-prazo"]),
    );
    /* Nada de atraso ou SLA estourado: não há dado de execução para isso. */
    expect(b.sinais.map((s) => s.chave)).not.toContain("atraso");
  });
});

describe("a Lista filtra, ordena e numera pelo processo", () => {
  const completo = fluxoDeQuinze();

  it("numera pela topologia, e não pela ordem de cadastro", () => {
    const numeros = numeracaoDoFluxo(completo);
    expect(numeros.get("e1")).toBe(1);
    expect(numeros.get("e15")).toBe(15);
  });

  it("filtra por área, por busca e pelos recortes de auditoria", () => {
    const linhas = linhasDaLista(completo);
    expect(filtrarLinhas(linhas, { area: "Fiscal" })).toHaveLength(3);
    expect(filtrarLinhas(linhas, { busca: "etapa 1" }).length).toBeGreaterThan(0);
    expect(filtrarLinhas(linhas, { semSla: true })).toHaveLength(0);

    const semResponsavel = linhasDaLista({
      ...completo,
      etapas: completo.etapas.map((e) =>
        e.id === "e9" ? { ...e, area: null, responsavel: null } : e,
      ),
    });
    expect(filtrarLinhas(semResponsavel, { semResponsavel: true }).map((l) => l.etapa.id)).toEqual([
      "e9",
    ]);
  });

  it("ordena por coluna e joga o vazio para o fim nos dois sentidos", () => {
    const linhas = linhasDaLista({
      ...completo,
      etapas: completo.etapas.map((e) => (e.id === "e2" ? { ...e, area: null } : e)),
    });
    expect(ordenarLinhas(linhas, "area", true).at(-1)?.etapa.id).toBe("e2");
    expect(ordenarLinhas(linhas, "area", false).at(-1)?.etapa.id).toBe("e2");
    expect(ordenarLinhas(linhas, "numero", true).map((l) => l.numero)[0]).toBe(1);
  });

  it("o filtro só oferece valores que existem no processo", () => {
    const linhas = linhasDaLista(completo);
    expect(valoresDaColuna(linhas, "area")).toEqual([
      "Banco",
      "Financeiro",
      "Fiscal",
      "Operação",
      "Sistema",
    ]);
  });
});

describe("a Jornada lê o mesmo caminho por uma lente de cada vez", () => {
  /*
    Três etapas com cadastros diferentes de propósito: uma documentada, uma com
    falha e gargalo, e uma em que só o nome foi preenchido. É o que distingue
    uma lente que mostra o campo certo de uma que mostra o que estiver à mão.
  */
  function fluxoDeTres(): FluxoCompleto {
    const etapas = [
      etapa({
        id: "e1",
        nome: "Origem da tarifa",
        ordem: 0,
        tipo: "INICIO",
        area: "Operação",
        responsavel: "Faturamento",
        sistemaPrincipal: "TMS",
        objetivo: "Garantir que a tarifa aplicada é a vigente.",
        regras: "Tarifa fora da tabela volta para a Operação.",
        informacoesConsultadas: "Tabela de frete mínimo no SAP",
        itens: [item("PRAZO", "4 horas"), item("DOCUMENTO", "Tabela vigente")],
      }),
      etapa({
        id: "e2",
        nome: "Auditoria fiscal",
        ordem: 1,
        area: "Fiscal",
        status: "ATENCAO",
        itens: [item("FALHA", "CT-e sem XML"), item("GARGALO", "Conferência manual")],
        indicadores: [
          {
            id: "i1",
            nome: "CT-e conferidos",
            descricao: null,
            unidade: "%",
            sentido: "MAIOR_MELHOR" as const,
            origem: null,
            ordem: 0,
          },
        ],
      }),
      etapa({ id: "e3", nome: "Fechamento", ordem: 2, tipo: "FIM" }),
    ];
    const conexoes = [
      conexao({ id: "c1", origemEtapaId: "e1", destinoEtapaId: "e2" }),
      conexao({ id: "c2", origemEtapaId: "e2", destinoEtapaId: "e3" }),
    ];
    return { fluxo: fluxoDeQuinze().fluxo, etapas, conexoes };
  }

  it("o seletor oferece cinco tipos de jornada, e a Operação é o padrão", () => {
    expect(LENTES_DA_JORNADA.map((l) => l.valor)).toEqual([
      "operacao",
      "documentacao",
      "falhas",
      "gargalos",
      "informacoes",
    ]);
    expect(normalizarPreferencia({}).lente).toBe("operacao");
  });

  it("trocar de lente não muda o processo, a ordem nem a numeração", () => {
    const completo = fluxoDeTres();
    const antes = JSON.stringify(completo);
    const linhas = linhasDaLista(completo);

    for (const lente of LENTES_DA_JORNADA) {
      const cartoes = linhas.map((linha) => cartaoDaJornada(linha, lente.valor));
      /*
        Sempre três cartões, e sempre pelo menos uma linha desenhada em cada um:
        a jornada não muda de forma, e nenhuma lente devolve cartão mudo. O
        número de campos é da lente — as Informações têm quatro, com o que a
        etapa consulta na frente e as pontas do grafo como apoio.
      */
      expect(cartoes).toHaveLength(3);
      for (const cartao of cartoes) {
        expect(cartao.campos.length).toBeGreaterThanOrEqual(3);
        expect(cartao.visiveis.length).toBeGreaterThanOrEqual(1);
      }
    }

    expect(linhas.map((l) => l.numero)).toEqual([1, 2, 3]);
    expect(linhas.map((l) => l.etapa.nome)).toEqual([
      "Origem da tarifa",
      "Auditoria fiscal",
      "Fechamento",
    ]);
    expect(JSON.stringify(completo)).toBe(antes);
  });

  it("cada lente mostra o campo dela — e não o da vizinha", () => {
    const linhas = linhasDaLista(fluxoDeTres());
    const valores = (indice: number, lente: Parameters<typeof cartaoDaJornada>[1]) =>
      cartaoDaJornada(linhas[indice], lente).campos.flatMap((c) => c.valores).join(" | ");

    expect(valores(0, "operacao")).toContain("Operação · Faturamento");
    expect(valores(0, "operacao")).toContain("TMS");
    expect(valores(0, "operacao")).toContain("4 horas");

    expect(valores(0, "documentacao")).toContain("Garantir que a tarifa aplicada é a vigente.");
    expect(valores(0, "documentacao")).toContain("Tabela vigente");
    /* A documentação não mostra o prazo: prazo é operação. */
    expect(valores(0, "documentacao")).not.toContain("4 horas");

    expect(valores(1, "falhas")).toContain("CT-e sem XML");
    expect(valores(1, "falhas")).toContain("Etapa marcada como atenção");
    expect(valores(1, "falhas")).not.toContain("Conferência manual");

    expect(valores(1, "gargalos")).toContain("Conferência manual");
    expect(valores(1, "gargalos")).not.toContain("CT-e sem XML");

    expect(valores(1, "informacoes")).toContain("Origem da tarifa");
    expect(valores(1, "informacoes")).toContain("Fechamento");
    expect(valores(1, "informacoes")).toContain("CT-e conferidos (%)");

    /*
      O que a etapa consulta abre a lente das Informações — é o campo do editor
      que nenhuma lente mostrava, e a pergunta que ela existe para responder.
    */
    const informacoes = cartaoDaJornada(linhas[0], "informacoes");
    expect(informacoes.campos[0].chave).toBe("consulta");
    expect(informacoes.campos[0].valores).toEqual(["Tabela de frete mínimo no SAP"]);
    /*
      E a etapa que não consulta nada e não mede nada diz as duas coisas, em vez
      de esconder as linhas. O apoio segue a regra de sempre: a última etapa não
      tem "segue para", então a linha não é desenhada.
    */
    expect(cartaoDaJornada(linhas[2], "informacoes").visiveis.map((c) => c.chave)).toEqual([
      "consulta",
      /* "Contexto" é o campo Informações da etapa — o que é preciso saber. */
      "contexto",
      "indicadores",
      "entradas",
    ]);
  });

  /*
    Os dois testes acima provam a lente na função pura. Este prova o que quem
    usa de fato vê: o **cartão renderizado** muda de conteúdo ao trocar o tipo
    de jornada. É a diferença entre `cartaoDaJornada` estar certo e a Jornada
    estar passando a lente adiante — um `lente` esquecido no caminho entre o
    seletor e o cartão deixaria os dois primeiros testes verdes e a tela parada.
  */
  it("trocar o tipo de jornada troca o que o cartão mostra na tela", () => {
    const completo = fluxoDeTres();
    const html = (lente: Parameters<typeof cartaoDaJornada>[1]) =>
      renderToStaticMarkup(
        <VisaoJornada
          completo={completo}
          catalogo={CATALOGO}
          etapaSelecionada={null}
          onSelecionarEtapa={() => undefined}
          somenteLeitura
          onEditarCampoDaEtapa={async () => undefined}
          lente={lente}
        />,
      );

    const operacao = html("operacao");
    const documentacao = html("documentacao");
    const falhas = html("falhas");
    const gargalos = html("gargalos");
    const informacoes = html("informacoes");

    /* A operação mostra quem, onde e em quanto tempo — e só isso. */
    expect(operacao).toContain("Operação · Faturamento");
    expect(operacao).toContain("4 horas");
    expect(operacao).not.toContain("CT-e sem XML");

    expect(documentacao).toContain("Garantir que a tarifa aplicada é a vigente.");
    expect(documentacao).toContain("Tabela vigente");

    expect(falhas).toContain("CT-e sem XML");
    expect(falhas).not.toContain("Conferência manual");

    expect(gargalos).toContain("Conferência manual");
    expect(gargalos).not.toContain("CT-e sem XML");

    expect(informacoes).toContain("CT-e conferidos (%)");

    /* Cinco lentes, cinco leituras: nenhuma repete a de outra. */
    expect(new Set([operacao, documentacao, falhas, gargalos, informacoes]).size).toBe(5);

    /*
      E o que a lente troca é só o miolo: a sequência, a numeração e os nomes
      continuam os mesmos em todas.
    */
    for (const saida of [operacao, documentacao, falhas, gargalos, informacoes]) {
      expect(saida).toContain("Origem da tarifa");
      expect(saida).toContain("Auditoria fiscal");
      expect(saida).toContain("Fechamento");
      expect(saida).toContain("01");
      expect(saida).toContain("03");
    }
  });

  it("o que não foi cadastrado é ausência declarada, nunca um valor inventado", () => {
    const linhas = linhasDaLista(fluxoDeTres());
    const cartao = cartaoDaJornada(linhas[2], "documentacao");

    expect(cartao.achados).toBe(0);
    expect(cartao.campos.every((c) => c.valores.length === 0)).toBe(true);
    expect(cartao.campos.map((c) => c.vazio)).toEqual([
      "sem objetivo descrito",
      "sem regras registradas",
      "sem documentos cadastrados",
    ]);
    /*
      E, no cartão focado, o que sobra é o assunto da lente: a linha dos
      documentos, dizendo que não há nenhum. O apoio vazio não vira placeholder.
    */
    expect(cartao.visiveis.map((c) => c.chave)).toEqual(["documentos"]);
    expect(cartao.visiveis[0].vazio).toBe("sem documentos cadastrados");
  });

  /*
    A promessa da lente focada, e o seu centro. Quem troca para "Documentação"
    quer ler os documentos do processo **e** ver onde eles faltam: a linha do
    assunto aparece em toda etapa, cadastrada ou não. O que some é o apoio
    vazio — o "sem regras registradas" de uma etapa que tem objetivo e documento
    é ruído numa jornada lida de relance, e sai do desenho sem sair do dado.
  */
  it("o cartão mostra o assunto da lente sempre, e o apoio só quando existe", () => {
    const linhas = linhasDaLista(fluxoDeTres());
    const cartao = cartaoDaJornada(linhas[1], "falhas");

    /* A etapa tem falha e está marcada como atenção, mas nada volta para ela. */
    expect(cartao.campos.map((c) => c.chave)).toEqual(["falhas", "retorno", "status"]);
    expect(cartao.visiveis.map((c) => c.chave)).toEqual(["falhas", "status"]);

    /* A etapa 01 não tem falha nenhuma — e ainda assim mostra a linha delas. */
    const semFalha = cartaoDaJornada(linhas[0], "falhas");
    expect(semFalha.visiveis.map((c) => c.chave)).toEqual(["falhas"]);

    /* O mesmo na documentação: a etapa 02 não tem documento, e diz isso. */
    const semDocumento = cartaoDaJornada(linhas[1], "documentacao");
    expect(semDocumento.visiveis.map((c) => c.chave)).toEqual(["documentos"]);

    const completo = fluxoDeTres();
    const html = renderToStaticMarkup(
      <VisaoJornada
        completo={completo}
        catalogo={CATALOGO}
        etapaSelecionada={null}
        onSelecionarEtapa={() => undefined}
        somenteLeitura
        onEditarCampoDaEtapa={async () => undefined}
        lente="documentacao"
      />,
    );

    expect(html).toContain("Garantir que a tarifa aplicada é a vigente.");
    expect(html).toContain("Tabela vigente");
    /* O apoio vazio não vira placeholder: a etapa 01 tem regras, as outras não. */
    expect(html).not.toContain("sem regras registradas");
    /* Mas o assunto da lente aparece — as etapas 02 e 03 não têm documento. */
    expect(html).toContain("sem documentos cadastrados");

    /* E a mesma regra vale para as outras lentes. */
    const falhas = renderToStaticMarkup(
      <VisaoJornada
        completo={completo}
        catalogo={CATALOGO}
        etapaSelecionada={null}
        onSelecionarEtapa={() => undefined}
        somenteLeitura
        onEditarCampoDaEtapa={async () => undefined}
        lente="falhas"
      />,
    );
    expect(falhas).toContain("CT-e sem XML");
    /* A linha das falhas em toda etapa; o apoio vazio, em nenhuma. */
    expect(falhas).toContain("sem falhas registradas");
    expect(falhas).not.toContain("nenhum retrabalho chega aqui");
    expect(falhas).not.toContain("etapa não marcada como atenção");
  });

  it("o resumo conta as etapas cadastradas, e o que vem do grafo não conta", () => {
    const linhas = linhasDaLista(fluxoDeTres());

    expect(resumoDaLente(linhas, "documentacao")).toEqual({ etapas: 1, total: 3, achados: 3 });
    expect(resumoDaLente(linhas, "falhas").etapas).toBe(1);
    /*
      Duas etapas têm alguma coisa: uma consulta uma tabela, a outra mede um
      indicador. Se "vem de"/"segue para" contassem, o resumo diria "3 de 3" num
      fluxo sem indicador nenhum — o oposto do que o número existe para revelar.
    */
    expect(resumoDaLente(linhas, "informacoes")).toEqual({ etapas: 2, total: 3, achados: 2 });
  });
});

describe("desempenho — o processo grande continua sendo uma passada", () => {
  it("projeta duzentas e cinquenta etapas sem estourar tempo", () => {
    const etapas = Array.from({ length: 250 }, (_, i) =>
      etapa({ id: `e${i}`, nome: `Etapa ${i}`, ordem: i, area: `Área ${i % 7}` }),
    );
    const conexoes = etapas
      .slice(0, -1)
      .map((e, i) => conexao({ id: `c${i}`, origemEtapaId: e.id, destinoEtapaId: etapas[i + 1].id }));
    const completo: FluxoCompleto = { fluxo: fluxoDeQuinze().fluxo, etapas, conexoes };

    const inicio = Date.now();
    const projecao = projetarTudo(completo);
    const gasto = Date.now() - inicio;

    expect(projecao.lista).toHaveLength(250);
    expect(projecao.raias.raias).toHaveLength(7);
    expect(projecao.fluxo.setas).toHaveLength(249);
    /*
      O limite é folgado de propósito: o que ele protege não é o milissegundo, é
      a ordem de grandeza. Uma projeção que voltasse a varrer o grafo por etapa
      passaria de quadrática e estouraria isto por muito.
    */
    expect(gasto).toBeLessThan(2000);
  });
});

describe("caso 9 — a Lista edita na célula, e só onde a edição é verdade", () => {
  /*
    A regra vive fora da tela porque é regra: qual célula aceita edição não
    depende de pixel nenhum, depende do que está gravado na etapa. É o que
    permite prová-la aqui, sem DOM.
  */
  it("nome, tipo e área são campos da etapa — sempre editáveis", () => {
    const e = etapa({ id: "e1", nome: "Auditoria fiscal", tipo: "PROCESSO", area: " Fiscal " });
    expect(edicaoNaLista(e, "nome")).toEqual({ editavel: true, valor: "Auditoria fiscal" });
    expect(edicaoNaLista(e, "tipo")).toEqual({ editavel: true, valor: "PROCESSO" });
    expect(edicaoNaLista(e, "area")).toEqual({ editavel: true, valor: "Fiscal" });
  });

  it("responsável e sistema editam a coluna da etapa quando é ela que aparece", () => {
    const e = etapa({
      id: "e1",
      nome: "Emissão",
      responsavel: "Fiscal",
      sistemaPrincipal: "SAP",
      itens: [item("SISTEMA", "Unidox")],
    });
    expect(edicaoNaLista(e, "responsavel").editavel).toBe(true);
    expect(edicaoNaLista(e, "responsavel").valor).toBe("Fiscal");
    /* O item existe, mas quem aparece na coluna é o sistema principal. */
    expect(edicaoNaLista(e, "sistema")).toEqual({ editavel: true, valor: "SAP" });
  });

  it("o valor que vem da lista de itens não é editável na célula", () => {
    const e = etapa({ id: "e1", nome: "Emissão", itens: [item("SISTEMA", "Unidox")] });
    const edicao = edicaoNaLista(e, "sistema");
    expect(edicao.editavel).toBe(false);
    /*
      Editar aqui gravaria `sistemaPrincipal` e a tabela continuaria mostrando
      "Unidox" — a pessoa veria a edição não pegar. O motivo escrito é o que
      manda ela para o painel, onde a lista inteira aparece.
    */
    expect(edicao.motivo).toMatch(/lista de sistemas/i);
  });

  it("a célula vazia é editável — é ela que preenche a coluna", () => {
    const e = etapa({ id: "e1", nome: "Emissão" });
    expect(edicaoNaLista(e, "responsavel")).toEqual({ editavel: true, valor: "" });
    expect(edicaoNaLista(e, "sla")).toEqual({ editavel: true, valor: "" });
  });

  it("o prazo é editável enquanto for um só, e some da célula quando são dois", () => {
    const um = etapa({ id: "e1", nome: "Emissão", itens: [item("PRAZO", "24 h úteis")] });
    expect(edicaoNaLista(um, "sla")).toEqual({ editavel: true, valor: "24 h úteis" });

    const dois = etapa({
      id: "e2",
      nome: "Emissão",
      itens: [item("PRAZO", "24 h úteis"), item("PRAZO", "D+2", 1)],
    });
    expect(edicaoNaLista(dois, "sla").editavel).toBe(false);
    expect(slaDaEtapa(dois)).toBe("24 h úteis · D+2");
  });

  it("gravar um campo manda a etapa inteira — a rota é substituição", () => {
    /*
      A prova do defeito que `corpoDaEtapa` existe para impedir: um PUT com
      `{ area }` só apagaria descrição, objetivo, regras, observações e a
      posição do cartão, sem erro nenhum na tela.
    */
    const e = etapa({
      id: "e1",
      nome: "Auditoria fiscal",
      area: "Fiscal",
      descricao: "Confere XML contra o pedido",
      objetivo: "Não pagar frete indevido",
      regras: "Divergência acima de 2% volta",
      informacoes: "Rodopar × Unidox",
      chaveMonitoramento: "auditoria",
      ordem: 7,
      posX: 120,
      posY: 480,
    });

    const corpo = { ...corpoDaEtapa(e), area: "Contas a pagar" };

    expect(corpo).toMatchObject({
      nome: "Auditoria fiscal",
      area: "Contas a pagar",
      descricao: "Confere XML contra o pedido",
      objetivo: "Não pagar frete indevido",
      regras: "Divergência acima de 2% volta",
      informacoes: "Rodopar × Unidox",
      chaveMonitoramento: "auditoria",
      ordem: 7,
      posX: 120,
      posY: 480,
    });
    /* As listas não entram: elas têm caminho próprio no servidor. */
    expect(corpo).not.toHaveProperty("itens");
    expect(corpo).not.toHaveProperty("indicadores");
  });

  function listaRenderizada(somenteLeitura: boolean): string {
    const completo = fluxoDeQuinze();
    return renderToStaticMarkup(
      <VisaoLista
        completo={completo}
        catalogo={CATALOGO}
        etapaSelecionada={null}
        onSelecionarEtapa={() => undefined}
        onEditarCampoDaEtapa={async () => undefined}
        somenteLeitura={somenteLeitura}
      />,
    );
  }

  it("com edição liberada, a célula anuncia que edita", () => {
    const html = listaRenderizada(false);
    expect(html).toContain("clique numa célula para editar");
    expect(html).toContain("aria-label=\"Editar Área da etapa");
    expect(html).toContain("aria-label=\"Editar Tipo da etapa");
  });

  it("em modo de leitura, nenhuma célula abre", () => {
    const html = listaRenderizada(true);
    /* O dado continua todo lá — o que some é o convite a mexer nele. */
    expect(html).toContain("Etapa 1");
    expect(html).toContain("Analista Fiscal");
    expect(html).not.toContain("clique numa célula para editar");
    expect(html).not.toContain("aria-label=\"Editar ");
  });

  /*
    Um fluxo de duas etapas montado para o caso do Tab: na segunda, o sistema
    vem da lista de itens e há dois prazos — as duas células que a Lista não
    pode editar sem mentir sobre o que grava.
  */
  function fluxoComListaDeItens(): FluxoCompleto {
    const etapas = [
      etapa({ id: "e1", nome: "Etapa 1", ordem: 0, area: "Operação", sistemaPrincipal: "SAP" }),
      etapa({
        id: "e2",
        nome: "Etapa 2",
        ordem: 1,
        area: "Fiscal",
        itens: [item("SISTEMA", "Unidox"), item("PRAZO", "24 h"), item("PRAZO", "D+2", 1)],
      }),
    ];
    return { fluxo: fluxoDeQuinze().fluxo, etapas, conexoes: [] };
  }

  const marcadas = (html: string) => html.split("data-celula-editavel").length - 1;

  it("só as células que editam de verdade entram na ordem do Tab", () => {
    const html = renderToStaticMarkup(
      <VisaoLista
        completo={fluxoComListaDeItens()}
        catalogo={CATALOGO}
        etapaSelecionada={null}
        onSelecionarEtapa={() => undefined}
        onEditarCampoDaEtapa={async () => undefined}
        somenteLeitura={false}
      />,
    );
    /*
      Seis por linha (nome, tipo, área, responsável, sistema, prazo), menos as
      duas da segunda etapa que vêm de lista. Número, entrada, saída e sinais
      nunca entram: não são campos, e um Tab que parasse neles prometeria uma
      edição que não existe.
    */
    expect(marcadas(html)).toBe(10);

    /*
      E cada uma diz o que é: o `Tab` abre a de texto já digitável e apenas
      **foca** a de escolha. Abrir um menu suspenso por causa de um `Tab`
      prenderia o foco dentro dele e acabaria com a corrida pela linha.
    */
    expect(html.split('data-celula-editavel="escolha"').length - 1).toBe(2);
    expect(html.split('data-celula-editavel="texto"').length - 1).toBe(8);
  });

  it("em modo de leitura não há célula nenhuma na ordem do Tab", () => {
    const html = renderToStaticMarkup(
      <VisaoLista
        completo={fluxoComListaDeItens()}
        catalogo={CATALOGO}
        etapaSelecionada={null}
        onSelecionarEtapa={() => undefined}
        onEditarCampoDaEtapa={async () => undefined}
        somenteLeitura
      />,
    );
    expect(marcadas(html)).toBe(0);
  });

  it("a etapa detalhada mostra a marca do subfluxo, com a contagem, e o link para ele", () => {
    /*
      A afirmação é a do módulo inteiro, um nível abaixo: o cartão diz que há
      um processo ali dentro **e** quanto ele tem. "Abrir" sem a contagem é um
      clique no escuro — e a contagem vem do fluxo, não de uma segunda ida ao
      servidor por cartão.
    */
    const base = fluxoDeQuinze();
    const completo: FluxoCompleto = {
      ...base,
      etapas: base.etapas.map((e) => (e.id === "e4" ? { ...e, subfluxoId: "sub" } : e)),
      subfluxos: [
        {
          id: "sub",
          nome: "Emissão do documento",
          slug: "emissao-do-documento",
          categoria: "Faturamento",
          status: "RASCUNHO",
          etapas: 8,
        },
      ],
    };

    /*
      O `Router` com `ssrPath` existe porque a marca do subfluxo é um link, e
      fora do navegador o wouter não tem de onde ler o endereço atual. Nada aqui
      depende do caminho declarado — só de haver um.
    */
    const html = renderToStaticMarkup(
      <Router ssrPath="/fluxos/f">
        <VisaoJornada
          completo={completo}
          catalogo={CATALOGO}
          etapaSelecionada={null}
          onSelecionarEtapa={() => undefined}
          onEditarCampoDaEtapa={async () => undefined}
          somenteLeitura={false}
          lente="operacao"
        />
      </Router>,
    );
    expect(html).toContain('href="/fluxos/sub"');
    expect(html).toContain("Emissão do documento");
    expect(html).toContain(">8<");
  });

  it("em só-leitura o convite de detalhar some e o link continua — ler não é escrever", () => {
    const completo = fluxoDeQuinze();
    const comEscrita = renderToStaticMarkup(
      <VisaoJornada
        completo={completo}
        catalogo={CATALOGO}
        etapaSelecionada={null}
        onSelecionarEtapa={() => undefined}
        onDetalharEtapa={() => undefined}
        onEditarCampoDaEtapa={async () => undefined}
        somenteLeitura={false}
        lente="operacao"
      />,
    );
    const semEscrita = renderToStaticMarkup(
      <VisaoJornada
        completo={completo}
        catalogo={CATALOGO}
        etapaSelecionada={null}
        onSelecionarEtapa={() => undefined}
        onDetalharEtapa={() => undefined}
        onEditarCampoDaEtapa={async () => undefined}
        somenteLeitura
        lente="operacao"
      />,
    );
    const convites = (html: string) => html.split("Detalhar a etapa").length - 1;
    expect(convites(comEscrita)).toBe(completo.etapas.length);
    expect(convites(semEscrita)).toBe(0);
  });

  it("o painel oferece detalhar quando não há subfluxo, e abrir quando há", () => {
    const etapaQualquer = fluxoDeQuinze().etapas[3];
    const semDetalhe = renderToStaticMarkup(
      <PainelDaEtapa
        etapa={etapaQualquer}
        catalogo={CATALOGO}
        podeEditar
        onEditar={() => undefined}
        onSeguinte={() => undefined}
        onExcluir={() => undefined}
        onFechar={() => undefined}
        onDetalhar={() => undefined}
      />,
    );
    expect(semDetalhe).toContain("Detalhar num subfluxo");

    const comDetalhe = renderToStaticMarkup(
      <Router ssrPath="/fluxos/f">
      <PainelDaEtapa
        etapa={{ ...etapaQualquer, subfluxoId: "sub" }}
        catalogo={CATALOGO}
        podeEditar
        onEditar={() => undefined}
        onSeguinte={() => undefined}
        onExcluir={() => undefined}
        onFechar={() => undefined}
        onDetalhar={() => undefined}
        onDesligarSubfluxo={() => undefined}
        subfluxo={{
          id: "sub",
          nome: "Emissão do documento",
          slug: "emissao-do-documento",
          categoria: "Faturamento",
          status: "RASCUNHO",
          etapas: 8,
        }}
      />
      </Router>,
    );
    expect(comDetalhe).toContain('href="/fluxos/sub"');
    expect(comDetalhe).toContain("8 etapas");
    /*
      Desfazer a ligação, e não excluir: o botão do painel de uma etapa não pode
      destruir um processo inteiro que pode ter dez etapas escritas.
    */
    expect(comDetalhe).toContain("Desfazer a ligação");
    expect(comDetalhe).not.toContain("Detalhar num subfluxo");
  });

  it("a página liga o detalhar de verdade — nas visualizações e no painel", () => {
    /*
      O caso que este teste existe para não voltar: o cartão sabia oferecer o
      detalhe, o painel sabia oferecer, a escrita existia e a mutação existia —
      e mesmo assim não havia ícone nenhum na tela, porque a página nunca
      passava `onDetalharEtapa` para as visualizações nem `onDetalhar` para o
      painel. Com as pontas soltas, `podeDetalhar` era falso em todo cartão e o
      recurso inteiro ficava invisível sem que nada quebrasse.

      Por isso a cobrança é no texto-fonte da página: é lá, e só lá, que as
      pontas se encontram.
    */
    const raiz = path.resolve(import.meta.dirname, "..", "..");
    const pagina = readFileSync(path.join(raiz, "pages/fluxo.tsx"), "utf8");
    expect(pagina).toMatch(/escritas\.detalharEtapa\(/);
    expect(pagina).toMatch(/onDetalharEtapa=\{aoDetalharEtapa\}/);
    expect(pagina).toMatch(/detalhando=\{detalhandoAgora\}/);
    expect(pagina).toMatch(/onDetalhar=\{/);
    expect(pagina).toMatch(/onDesligarSubfluxo=\{/);
  });

  it("na Jornada o ícone fica no canto de cima à direita do cartão", () => {
    /*
      O canto é o pedido, e é o que faz o ícone ser achado: no mesmo lugar em
      todos os cartões, e não na altura em que o texto de cada um terminou.
    */
    const base = fluxoDeQuinze();
    const html = renderToStaticMarkup(
      <Router ssrPath="/fluxos/f">
        <VisaoJornada
          completo={base}
          catalogo={CATALOGO}
          etapaSelecionada={null}
          onSelecionarEtapa={() => undefined}
          onEditarCampoDaEtapa={async () => undefined}
          somenteLeitura={false}
          lente="documentacao"
          onDetalharEtapa={() => undefined}
        />
      </Router>,
    );
    expect(html).toContain("Detalhar a etapa");
    expect(html).toMatch(/class="[^"]*absolute right-2 top-2/);
  });

  it("subfluxoDaEtapa tolera a projeção sem a lista — e não inventa detalhe", () => {
    const semLista = fluxoDeQuinze();
    expect(subfluxoDaEtapa(semLista, { subfluxoId: "sub" })).toBeNull();
    expect(subfluxoDaEtapa(semLista, { subfluxoId: null })).toBeNull();
  });

  it("o Tab anda uma célula por vez e para nas pontas", () => {
    const celulas = ["a", "b", "c"];
    expect(vizinhaNaOrdem(celulas, "a", 1)).toBe("b");
    expect(vizinhaNaOrdem(celulas, "b", -1)).toBe("a");
    /*
      Na última, `null` — e o componente devolve o Tab ao navegador em vez de
      segurá-lo: sair da tabela pelo teclado continua possível.
    */
    expect(vizinhaNaOrdem(celulas, "c", 1)).toBeNull();
    expect(vizinhaNaOrdem(celulas, "a", -1)).toBeNull();
    expect(vizinhaNaOrdem(celulas, "fora", 1)).toBeNull();
  });

  it("o campo de texto sugere, mas não fecha o vocabulário", () => {
    const html = renderToStaticMarkup(
      <VisaoLista
        completo={fluxoDeQuinze()}
        catalogo={CATALOGO}
        etapaSelecionada={null}
        onSelecionarEtapa={() => undefined}
        onEditarCampoDaEtapa={async () => undefined}
        somenteLeitura={false}
      />,
    );
    /*
      Área, responsável e sistema são vocabulário da operação, não catálogo
      fechado: a célula é um campo de texto com sugestões (o `datalist` só
      aparece com o campo aberto), e nunca um seletor que recusaria uma área
      nova legítima. O tipo é o contrário, e por isso é `Select`.
    */
    expect(html).toContain("aria-label=\"Editar Área da etapa");
    expect(html).not.toContain("aria-label=\"Área da etapa");
  });

  it("corpoDaEtapa leva TODO campo gravável — inclusive os que ainda não existem", () => {
    /*
      A guarda contra o defeito futuro: no dia em que a etapa ganhar uma coluna
      nova, este teste falha se `corpoDaEtapa` não a levar junto — e falhar aqui
      é muito melhor do que descobrir em produção que editar a área apaga a
      coluna nova de todo mundo, em silêncio, porque a rota é substituição.

      As três listas ficam de fora por contrato: itens, indicadores e ações têm
      caminho próprio no servidor e não entram neste PUT. `subfluxoId` fica de
      fora pela mesma razão — quem o grava é `PUT …/subfluxo` e
      `POST …/detalhar`, e o `paraColunasDeEtapa` do servidor não o inclui, de
      modo que gravar a etapa inteira **preserva** a ligação em vez de apagá-la.
      Mandá-lo aqui faria o caminho da célula desfazer um detalhamento sem que
      ninguém tivesse pedido.
    */
    const completa = etapa({ id: "e1", nome: "Etapa" });
    const forasDoCorpo = ["id", "fluxoId", "itens", "indicadores", "acoes", "subfluxoId"];
    const gravaveis = Object.keys(completa).filter((c) => !forasDoCorpo.includes(c));
    expect(Object.keys(corpoDaEtapa(completa)).sort()).toEqual(gravaveis.sort());
  });

  it("editar na célula e editar no painel passam pela MESMA porta", () => {
    /*
      A pergunta é de auditoria, não de estilo: se a Lista tivesse um caminho de
      gravação próprio, a mesma alteração passaria a ter dois comportamentos
      conforme o lugar em que foi feita — dois corpos, dois pontos de validação
      e, no dia em que houver carimbo de autor, dois registros diferentes.

      Existe uma função só que monta o caminho da etapa (`escritas.atualizarEtapa`,
      em `lib/fluxos.ts`), e tanto o editor quanto a página chamam ela. O teste
      varre o pacote inteiro atrás de qualquer outro que monte o caminho por
      fora.
    */
    const raiz = path.resolve(import.meta.dirname, "..", "..");
    const editor = readFileSync(path.join(raiz, "components/fluxos/editor-da-etapa.tsx"), "utf8");
    const pagina = readFileSync(path.join(raiz, "pages/fluxo.tsx"), "utf8");
    expect(editor).toMatch(/escritas\.atualizarEtapa\(/);
    expect(pagina).toMatch(/escritas\.atualizarEtapa\(/);

    const fontes: string[] = [];
    const varrer = (dir: string) => {
      for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        const caminho = path.join(dir, entrada.name);
        if (entrada.isDirectory()) varrer(caminho);
        else if (/\.tsx?$/.test(entrada.name)) fontes.push(caminho);
      }
    };
    varrer(raiz);

    const montamOCaminho = fontes.filter((f) =>
      /etapas\/\$\{/.test(readFileSync(f, "utf8")),
    );
    expect(montamOCaminho.map((f) => path.relative(raiz, f))).toEqual(["lib/fluxos.ts"]);
  });

  it("a Lista continua sem gravar por conta própria", () => {
    const raiz = path.resolve(import.meta.dirname, "..", "..");
    const texto = readFileSync(path.join(raiz, "components/fluxos/visao-lista.tsx"), "utf8");
    /*
      A célula edita, e mesmo assim a projeção não escreve: ela recebe
      `onEditarCampoDaEtapa` e devolve a promessa. É o que mantém as escritas
      num lugar só — e o teste de texto-fonte acima é quem cobra isso.
    */
    expect(texto).toMatch(/onEditarCampoDaEtapa/);
    expect(texto).not.toMatch(/\bescritas\./);
  });
});

/**
 * CASO 10 — A LISTA CADASTRA, e o fluxo vazio abre nela.
 *
 * O critério de aceite tem duas metades e as duas são cobradas aqui: um fluxo
 * recém-criado abre na tabela (e não num canvas em branco), e a tabela tem por
 * onde cadastrar a primeira etapa com as colunas que a etapa vai precisar.
 *
 * A parte de tela é renderizada; a parte de regra é função pura; e a parte de
 * arquitetura — a Lista continua sem gravar — é texto-fonte, como no caso 6.
 */
describe("caso 10 — cadastrar etapa na própria Lista", () => {
  const fluxoVazio = (): FluxoCompleto => ({
    fluxo: fluxoDeQuinze().fluxo,
    etapas: [],
    conexoes: [],
  });

  const listaDoVazio = (props: Partial<React.ComponentProps<typeof VisaoLista>> = {}) =>
    renderToStaticMarkup(
      <VisaoLista
        completo={fluxoVazio()}
        catalogo={CATALOGO}
        etapaSelecionada={null}
        onSelecionarEtapa={() => undefined}
        onEditarCampoDaEtapa={async () => undefined}
        onCriarEtapa={async () => undefined}
        somenteLeitura={false}
        {...props}
      />,
    );

  it("o fluxo sem etapa nenhuma abre a tabela, com o convite para cadastrar", () => {
    const html = listaDoVazio();
    /* O cabeçalho das colunas continua lá: é ele que diz o que a etapa pede. */
    for (const rotulo of ["Etapa", "Tipo", "Área", "Responsável", "Sistema", "Prazo (SLA)"]) {
      expect(html).toContain(rotulo);
    }
    expect(html).toContain("Adicionar nova etapa");
    expect(html).toContain("Nenhuma etapa ainda. Adicione a primeira acima.");
  });

  it("em modo de leitura não há convite nenhum para cadastrar", () => {
    const html = listaDoVazio({ somenteLeitura: true });
    expect(html).not.toContain("Adicionar nova etapa");
    expect(html).toContain("Este fluxo ainda não tem etapas.");
  });

  it("sem uma página que saiba gravar, a linha nova não aparece", () => {
    /*
      A projeção não inventa caminho de escrita: sem `onCriarEtapa` ela é a
      tabela de sempre — que é o que mantém os testes do caso 9 valendo.
    */
    const html = listaDoVazio({ onCriarEtapa: undefined });
    expect(html).not.toContain("Adicionar nova etapa");
  });

  it("a linha nova não entra na ordem do Tab das células", () => {
    /*
      As células do Tab são as que **gravam um campo de uma etapa que existe**.
      A linha nova tem campos próprios e um botão de cadastrar: marcá-la como
      célula editável faria o Tab da última linha cair num formulário de
      criação, que não é a próxima coisa a corrigir.
    */
    const html = renderToStaticMarkup(
      <VisaoLista
        completo={fluxoDeQuinze()}
        catalogo={CATALOGO}
        etapaSelecionada={null}
        onSelecionarEtapa={() => undefined}
        onEditarCampoDaEtapa={async () => undefined}
        onCriarEtapa={async () => undefined}
        somenteLeitura={false}
      />,
    );
    const semLinhaNova = renderToStaticMarkup(
      <VisaoLista
        completo={fluxoDeQuinze()}
        catalogo={CATALOGO}
        etapaSelecionada={null}
        onSelecionarEtapa={() => undefined}
        onEditarCampoDaEtapa={async () => undefined}
        somenteLeitura={false}
      />,
    );
    const marcadas = (texto: string) => texto.split("data-celula-editavel").length - 1;
    expect(marcadas(html)).toBe(marcadas(semLinhaNova));
  });

  it("a linha nova só pede o que a Lista sabe gravar", () => {
    /*
      A guarda contra o formulário de seis abas deitado: os campos da linha nova
      são exatamente os seis que a célula edita. No dia em que alguém acrescentar
      "objetivo" aqui, este teste falha — e o lugar do objetivo continua sendo o
      painel da etapa.
    */
    expect(Object.keys(etapaNovaVazia([])).sort()).toEqual(
      ["area", "nome", "responsavel", "sistema", "sla", "tipo"].sort(),
    );
  });

  it("a primeira etapa de um fluxo vazio já nasce como Início", () => {
    expect(tipoSugeridoNaLista([])).toBe("INICIO");
    expect(tipoSugeridoNaLista(fluxoDeQuinze().etapas)).toBe("PROCESSO");
    expect(etapaNovaVazia([]).tipo).toBe("INICIO");
  });

  it("só o nome é obrigatório — o resto é o que a auditoria aponta depois", () => {
    const vazia = etapaNovaVazia([]);
    expect(podeCriarEtapaNaLista(vazia)).toBe(false);
    expect(podeCriarEtapaNaLista({ ...vazia, nome: "   " })).toBe(false);
    expect(podeCriarEtapaNaLista({ ...vazia, nome: "Receber a NF" })).toBe(true);
    /* Sem tipo o servidor recusaria — e a linha nem chega a pedir. */
    expect(podeCriarEtapaNaLista({ ...vazia, nome: "Receber a NF", tipo: "" })).toBe(false);
  });

  it("cadastrar pela tabela passa pela MESMA porta de criar etapa", () => {
    /*
      Mesma pergunta do caso 9, do outro lado: se a Lista tivesse um caminho de
      criação próprio, a etapa nascida na tabela e a nascida no editor teriam
      dois corpos e dois pontos de validação. A página é quem chama
      `escritas.criarEtapa`, e a projeção continua sem saber o que é `escritas`.
    */
    const raiz = path.resolve(import.meta.dirname, "..", "..");
    const pagina = readFileSync(path.join(raiz, "pages/fluxo.tsx"), "utf8");
    const lista = readFileSync(path.join(raiz, "components/fluxos/visao-lista.tsx"), "utf8");
    expect(pagina).toMatch(/escritas\.criarEtapa\(/);
    expect(lista).toMatch(/onCriarEtapa/);
    expect(lista).not.toMatch(/\bescritas\./);

    /* E a página é quem decide que o fluxo vazio abre na Lista. */
    expect(pagina).toMatch(/sugerirVisualizacao\("lista"\)/);
    /* Criar um fluxo leva direto para ele — sem procurar a linha na lista. */
    const listaDeFluxos = readFileSync(path.join(raiz, "pages/fluxos.tsx"), "utf8");
    expect(listaDeFluxos).toMatch(/navegar\(`\/fluxos\/\$\{gravado\.id\}`\)/);
  });
});


describe("caso 10 — o painel edita campo a campo, sem abrir o editor", () => {
  const preenchida = etapa({
    id: "e1",
    nome: "Origem da tarifa",
    area: "Operação",
    responsavel: "Faturamento",
    objetivo: "Definir trecho, tarifa e parâmetros.",
    falhas: "A tarifa vem sem tabela e o faturamento refaz o cálculo à mão.",
    gargalos: "A conferência espera o retorno da Operação, que responde por e-mail.",
    informacoes: "A VALIDAR: quais tabelas originam a tarifa.",
  });

  const painel = (props: Record<string, unknown>) =>
    renderToStaticMarkup(
      <PainelDaEtapa
        etapa={preenchida}
        catalogo={CATALOGO}
        podeEditar
        onEditar={() => undefined}
        onSeguinte={() => undefined}
        onExcluir={() => undefined}
        onFechar={() => undefined}
        {...props}
      />,
    );

  it("cada campo mostrado vira um alvo de edição quando há como gravar", () => {
    const html = painel({ onSalvarCampo: async () => undefined });
    expect(html).toContain("Editar Nome da etapa");
    expect(html).toContain("Editar Objetivo da etapa");
    expect(html).toContain("Editar Falhas");
    expect(html).toContain("Editar Gargalos");
    expect(html).toContain("Editar Informações");
    expect(html).toContain("Editar Área");
    expect(html).toContain("Editar Responsável");
    /* E o editor completo continua onde estava — um não substitui o outro. */
    expect(html).toContain("Editar etapa");
  });

  it("sem quem grave, o painel volta a ser o de leitura — nada de alvo clicável", () => {
    const html = painel({});
    expect(html).toContain("Origem da tarifa");
    expect(html).not.toContain("Editar Objetivo da etapa");
    expect(html).not.toContain("Ainda em branco");
  });

  it("só-leitura não ganha edição no lugar nem com quem grave", () => {
    const html = painel({ podeEditar: false, onSalvarCampo: async () => undefined });
    expect(html).not.toContain("Editar Objetivo da etapa");
    expect(html).not.toContain("Ainda em branco");
  });

  it("o que está em branco vira convite — e some conforme é preenchido", () => {
    const vazia = etapa({ id: "e2", nome: "Sem nada" });
    const faltando = camposVaziosDoPainel(vazia).map((c) => c.campo);
    /* Nome, área e responsável ficam de fora: o cabeçalho já os oferece. */
    expect(faltando).not.toContain("nome");
    expect(faltando).not.toContain("area");
    expect(faltando).not.toContain("responsavel");
    expect(faltando).toContain("objetivo");
    expect(faltando).toContain("falhas");
    expect(faltando).toContain("gargalos");
    expect(faltando).toContain("informacoes");

    const depois = camposVaziosDoPainel({ ...vazia, objetivo: "Definir o trecho." });
    expect(depois.map((c) => c.campo)).not.toContain("objetivo");

    const html = renderToStaticMarkup(
      <PainelDaEtapa
        etapa={vazia}
        catalogo={CATALOGO}
        podeEditar
        onEditar={() => undefined}
        onSalvarCampo={async () => undefined}
        onSeguinte={() => undefined}
        onExcluir={() => undefined}
        onFechar={() => undefined}
      />,
    );
    expect(html).toContain("Ainda em branco");
    expect(html).toContain("Objetivo da etapa");
  });

  it("tipo e status viram etiqueta-menu — e voltam a ser selo em leitura", () => {
    const html = painel({ onSalvarCampo: async () => undefined });
    expect(html).toContain("Trocar tipo da etapa");
    expect(html).toContain("Trocar status da etapa");
    /*
      Em edição o status aparece mesmo sendo "Ativa": uma etiqueta que só
      existe depois de mudada não tem por onde ser mudada.
    */
    expect(html).toContain("Ativa");

    const leitura = painel({ podeEditar: false });
    expect(leitura).not.toContain("Trocar tipo da etapa");
    expect(leitura).not.toContain("Ativa");
    expect(leitura).toContain("Processo");

    /* Sem catálogo não há lista de opções — as duas voltam a ser selo. */
    const semCatalogo = painel({ catalogo: undefined, onSalvarCampo: async () => undefined });
    expect(semCatalogo).not.toContain("Trocar tipo da etapa");
  });

  it("os rótulos da lista são os mesmos títulos das seções — um nome por campo", () => {
    const rotulos = new Map(CAMPOS_DO_PAINEL.map((c) => [c.campo, c.rotulo]));
    const fonte = readFileSync(
      path.resolve(import.meta.dirname, "..", "..", "components/fluxos/painel-da-etapa.tsx"),
      "utf8",
    );
    /*
      A seção não escreve mais o título à mão: ele vem de `CAMPOS_DO_PAINEL`.
      É o que impede o título da seção e o botão do rodapé de divergirem — foi
      exatamente assim que "Observações" e "Falhas, gargalos e informações"
      poderiam ter virado dois nomes para o mesmo campo.
    */
    expect(fonte).not.toMatch(/Secao titulo="Objetivo da etapa"/);
    expect(rotulos.get("falhas")).toBe("Falhas");
    expect(rotulos.get("gargalos")).toBe("Gargalos");
    expect(rotulos.get("informacoes")).toBe("Informações");
    expect(valorDoCampo(preenchida, "informacoes")).toContain("A VALIDAR");
    expect(valorDoCampo(preenchida, "gargalos")).toContain("espera o retorno");
    expect(valorDoCampo(preenchida, "regras")).toBe("");
  });

  it("falhas, gargalos e informações são três seções — e o texto antigo não some", () => {
    const html = painel({ onSalvarCampo: async () => undefined });

    /*
      Três seções, três títulos, três alvos de edição. Um textarea só com os
      três nomes no rótulo seria o que havia antes com outro nome — e a
      pergunta "onde estão os maiores gargalos do processo" continuaria sem
      resposta, porque gargalo não seria campo.
    */
    for (const titulo of ["Falhas", "Gargalos", "Informações"]) {
      expect(html).toContain(`Editar ${titulo}`);
    }
    expect(html).not.toContain("Falhas, gargalos e informações<");

    /* E os três são campos independentes na camada pura. */
    const campos = CAMPOS_DO_PAINEL.map((c) => c.campo);
    expect(campos).toContain("falhas");
    expect(campos).toContain("gargalos");
    expect(campos).toContain("informacoes");
    /* `observacoes` não é campo de tela: é o backup do texto de antes. */
    expect(campos).not.toContain("observacoes");

    /*
      E é justamente por não ser campo de tela que ele precisa continuar no
      corpo: a rota da etapa é substituição, e um `corpoDaEtapa` sem
      `observacoes` faria a primeira edição de qualquer campo apagar o
      original que a migration `0072` preservou. O mesmo vale para o editor,
      que guarda o valor recebido e o devolve intocado.
    */
    expect(Object.keys(corpoDaEtapa(preenchida))).toContain("observacoes");
    const editor = readFileSync(
      path.resolve(import.meta.dirname, "..", "..", "components/fluxos/editor-da-etapa.tsx"),
      "utf8",
    );
    expect(editor).toMatch(/observacoes: observacoesPreservadas/);
  });

  it("quem grava continua sendo a página — o painel não conhece `escritas`", () => {
    const raiz = path.resolve(import.meta.dirname, "..", "..");
    const painelFonte = readFileSync(
      path.join(raiz, "components/fluxos/painel-da-etapa.tsx"),
      "utf8",
    );
    const pagina = readFileSync(path.join(raiz, "pages/fluxo.tsx"), "utf8");
    expect(painelFonte).not.toMatch(/\bescritas\.[a-z]/);
    expect(painelFonte).toMatch(/onSalvarCampo/);
    /*
      E a página grava do jeito que a rota exige: relendo a etapa e mandando o
      corpo inteiro. Mandar só o campo apagaria todos os outros, sem erro
      nenhum na tela.
    */
    expect(pagina).toMatch(/editarCampoNoPainel/);
    expect(pagina).toMatch(/lerFluxoAgora\(empresaId, fluxoId\)/);
    expect(pagina).toMatch(/corpoDaEtapa\(etapa\),\s*\[campo\]/);
  });
});


describe("caso 11 — as listas da etapa se editam no painel", () => {
  const comItens = etapa({
    id: "e1",
    nome: "Conferência do CT-e",
    itens: [item("SISTEMA", "Freitec", 0), item("SISTEMA", "Promax", 1), item("PRAZO", "D+1")],
    indicadores: [
      {
        id: "i1",
        nome: "CT-e sem conferência",
        descricao: null,
        unidade: "%",
        sentido: "NEUTRO",
        origem: null,
        ordem: 0,
      },
    ],
    acoes: [
      { id: "a1", titulo: "Ver alterações", descricao: null, rota: "/alteracoes", parametros: null, icone: null, ordem: 0 },
    ],
  });

  const listas = listasDoPainel(CATALOGO);

  it("cada espécie do catálogo vira uma lista — e o catálogo é quem manda", () => {
    /*
      A pergunta arquitetural: acrescentar uma espécie no servidor precisa de
      quantas linhas de interface? Nenhuma — e é isso que este teste trava.
    */
    expect(listas.map((l) => l.chave)).toEqual([
      "itens:SISTEMA",
      "itens:PRAZO",
      "itens:FALHA",
      "indicadores",
      "acoes",
    ]);
    /* Sistema usa link; prazo não. A forma da linha sai da espécie. */
    const sistema = listaDoPainelPorChave(CATALOGO, "itens:SISTEMA")!;
    const prazo = listaDoPainelPorChave(CATALOGO, "itens:PRAZO")!;
    expect(sistema.campos.map((c) => c.campo)).toContain("link");
    expect(prazo.campos.map((c) => c.campo)).not.toContain("link");
    /* Sem catálogo não há lista nenhuma — e nada explode. */
    expect(listasDoPainel(undefined)).toEqual([]);
  });

  it("as linhas saem da etapa na ordem gravada", () => {
    const sistema = listaDoPainelPorChave(CATALOGO, "itens:SISTEMA")!;
    expect(linhasDaListaDoPainel(comItens, sistema).map((l) => l.nome)).toEqual([
      "Freitec",
      "Promax",
    ]);
    const indicadores = listaDoPainelPorChave(CATALOGO, "indicadores")!;
    expect(linhasDaListaDoPainel(comItens, indicadores)[0].unidade).toBe("%");
    const acoes = listaDoPainelPorChave(CATALOGO, "acoes")!;
    expect(linhasDaListaDoPainel(comItens, acoes)[0].rota).toBe("/alteracoes");
  });

  it("o corpo que vai ao servidor numera a ordem pela posição na tela", () => {
    const sistema = listaDoPainelPorChave(CATALOGO, "itens:SISTEMA")!;
    const atuais = linhasDaListaDoPainel(comItens, sistema);
    /* Remover a primeira: a segunda vira ordem 0, sem renumeração à mão. */
    const semAPrimeira = corpoDasLinhas(sistema, atuais.slice(1)) as { nome: string; ordem: number }[];
    expect(semAPrimeira).toEqual([
      { nome: "Promax", descricao: "", link: "", obrigatorio: false, ordem: 0 },
    ]);

    /* Linha nova entra no fim, com os campos que a espécie tem. */
    const comNova = corpoDasLinhas(sistema, [
      ...atuais,
      { ...linhaNovaDoPainel(sistema), nome: "Unidox", link: "https://unidox" },
    ]) as { nome: string; ordem: number }[];
    expect(comNova.map((l) => [l.nome, l.ordem])).toEqual([
      ["Freitec", 0],
      ["Promax", 1],
      ["Unidox", 2],
    ]);

    /* Linha sem o campo obrigatório não vira item sem nome: some da gravação. */
    expect(corpoDasLinhas(sistema, [{ nome: "   ", descricao: "sobra" }])).toEqual([]);

    /* O indicador sem sentido escolhido cai no neutro, e não em vazio. */
    const indicadores = listaDoPainelPorChave(CATALOGO, "indicadores")!;
    const corpo = corpoDasLinhas(indicadores, [{ nome: "Reprovações", sentido: "" }]) as {
      sentido: string;
    }[];
    expect(corpo[0].sentido).toBe("NEUTRO");
  });

  it("lista sem nenhuma linha vira convite, e some quando ganha a primeira", () => {
    const vazia = etapa({ id: "e2", nome: "Sem nada" });
    expect(listasVaziasDoPainel(vazia, CATALOGO).map((l) => l.chave)).toEqual([
      "itens:SISTEMA",
      "itens:PRAZO",
      "itens:FALHA",
      "indicadores",
      "acoes",
    ]);
    expect(listasVaziasDoPainel(comItens, CATALOGO).map((l) => l.chave)).toEqual([
      "itens:FALHA",
    ]);
  });

  it("o painel só oferece a edição de lista para quem tem como gravá-la", () => {
    const comum = {
      etapa: comItens,
      catalogo: CATALOGO,
      onEditar: () => undefined,
      onSeguinte: () => undefined,
      onExcluir: () => undefined,
      onFechar: () => undefined,
    };
    const html = renderToStaticMarkup(
      <Router ssrPath="/fluxos/f">
        <PainelDaEtapa {...comum} podeEditar onSalvarLista={async () => undefined} />
      </Router>,
    );
    expect(html).toContain("Editar Sistema Freitec");
    expect(html).toContain("Editar indicador CT-e sem conferência");
    expect(html).toContain("Editar consulta Ver alterações");
    expect(html).toContain("Adicionar sistema");
    /* A espécie sem nenhuma linha aparece como convite, não como seção vazia. */
    expect(html).toContain("Falhas possíveis");

    const leitura = renderToStaticMarkup(
      <Router ssrPath="/fluxos/f">
        <PainelDaEtapa {...comum} podeEditar={false} />
      </Router>,
    );
    expect(leitura).toContain("Freitec");
    expect(leitura).not.toContain("Editar Sistema Freitec");
    expect(leitura).not.toContain("Adicionar sistema");
    expect(leitura).not.toContain("Ainda em branco");
  });

  it("quem grava a lista continua sendo a página, pelo caminho de cada uma", () => {
    const raiz = path.resolve(import.meta.dirname, "..", "..");
    const pagina = readFileSync(path.join(raiz, "pages/fluxo.tsx"), "utf8");
    expect(pagina).toMatch(/escritas\.salvarItens\(empresaId, fluxoId, etapaId, lista\.especie/);
    expect(pagina).toMatch(/escritas\.salvarIndicadores\(/);
    expect(pagina).toMatch(/escritas\.salvarAcoes\(/);
    /* E o corpo sai da função pura, não de um objeto montado à mão na página. */
    expect(pagina).toMatch(/corpoDasLinhas\(lista, linhas\)/);
  });
});
