import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PainelDaEtapa } from "@/components/fluxos/painel-da-etapa";
import { VisaoLista, vizinhaNaOrdem } from "@/components/fluxos/visao-lista";
import { montarProjecao } from "@/lib/fluxos-canvas";
import {
  analisarFluxo,
  edicaoNaLista,
  filtrarLinhas,
  linhasDaLista,
  ordenarLinhas,
  slaDaEtapa,
  valoresDaColuna,
} from "@/lib/fluxos-analise";
import {
  normalizarPreferencia,
  numeracaoDoFluxo,
  ordemDeLeitura,
  posicoesDoFluxo,
  posicoesDoMapa,
  projetarRaias,
  resumoDeResponsabilidade,
  VISUALIZACOES,
} from "@/lib/fluxos-visoes";
import { corpoDaEtapa } from "@/lib/fluxos";
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
 * 9. a Lista edita na célula — e só onde editar a célula é gravar a verdade.
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
    observacoes: null,
    status: "ATIVO",
    posX: 0,
    posY: 0,
    chaveMonitoramento: null,
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
    });
    expect(normalizarPreferencia({ visualizacao: "raias", agrupamento: "sistema" })).toEqual({
      visualizacao: "raias",
      orientacao: "vertical",
      agrupamento: "sistema",
    });
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
      observacoes: "Rodopar × Unidox",
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
      observacoes: "Rodopar × Unidox",
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
      caminho próprio no servidor e não entram neste PUT.
    */
    const completa = etapa({ id: "e1", nome: "Etapa" });
    const forasDoCorpo = ["id", "fluxoId", "itens", "indicadores", "acoes"];
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
