import { describe, expect, it } from "vitest";
import {
  caixaDaEtapa,
  escaparXml,
  montarLegenda,
  montarPdfDeImagem,
  montarSvgDoFluxo,
  fluxoComoSvg,
  nomeDoArquivo,
  quebrarEmLinhas,
} from "@/lib/fluxos-exportar";
import type { Catalogo, Conexao, Etapa, FluxoCompleto } from "@/lib/fluxos";

/**
 * A EXPORTAÇÃO — o que sai no arquivo, provado sem navegador.
 *
 * Toda a decisão da exportação é função pura: o SVG montado do dado, a legenda
 * tirada das setas que o fluxo realmente usa, o nome do arquivo e a estrutura
 * do PDF. O que fica de fora destes testes é só a rasterização (`Image`,
 * `canvas`) — pixel, que este pacote não testa por decisão anterior a este
 * módulo (ver `vitest.config.ts`).
 *
 * A afirmação que mais importa é a primeira: **toda etapa e toda seta do fluxo
 * aparecem no arquivo.** Uma exportação que perde uma etapa em silêncio é pior
 * do que não ter exportação, porque o arquivo circula como se fosse o processo.
 */

const CATALOGO: Catalogo = {
  tiposDeEtapa: [
    { valor: "INICIO", rotulo: "Início", descricao: "", forma: "pilula", classe: "", icone: "Play" },
    {
      valor: "PROCESSO",
      rotulo: "Processo",
      descricao: "",
      forma: "retangulo",
      classe: "",
      icone: "Square",
    },
    {
      valor: "PENDENCIA",
      rotulo: "Pendência",
      descricao: "",
      forma: "retangulo",
      classe: "",
      icone: "AlertTriangle",
    },
  ],
  tiposDeConexao: [
    { valor: "SEQUENCIA", rotulo: "Sequência", descricao: "", tracejada: false, classe: "" },
    { valor: "RETRABALHO", rotulo: "Retrabalho", descricao: "", tracejada: true, classe: "" },
  ],
  especiesDeItem: [],
  statusDoFluxo: [],
  statusDaEtapa: [],
  sentidosDoIndicador: [],
  modelos: [],
};

function etapa(parcial: Partial<Etapa> & { id: string; nome: string }): Etapa {
  return {
    fluxoId: "f1",
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
  return { fluxoId: "f1", tipo: "SEQUENCIA", rotulo: null, ordem: 0, ...parcial };
}

const FLUXO: FluxoCompleto = {
  fluxo: {
    id: "f1",
    empresaId: "e1",
    nome: "Operação empurrada — do faturamento ao recebimento",
    slug: "operacao-empurrada",
    descricao: null,
    objetivo: null,
    categoria: "Faturamento",
    status: "ATIVO",
    versao: 2,
    dono: "Operação",
    criadoEm: "2026-08-01T00:00:00.000Z",
    atualizadoEm: "2026-08-20T00:00:00.000Z",
    criadoPor: null,
    atualizadoPor: null,
  },
  etapas: [
    etapa({ id: "a", nome: "Origem da tarifa", tipo: "INICIO", posX: 0, posY: 0, area: "Operação" }),
    etapa({
      id: "b",
      nome: "Validação da tarifa",
      posX: 0,
      posY: 150,
      area: "Ambev",
      responsavel: "Analista",
      itens: [{ id: "i1", especie: "SISTEMA", nome: "SAP", descricao: null, obrigatorio: null, link: null, ordem: 0 }],
    }),
    etapa({ id: "c", nome: "Pendências", tipo: "PENDENCIA", status: "ATENCAO", posX: 260, posY: 300 }),
  ],
  conexoes: [
    conexao({ id: "1", origemEtapaId: "a", destinoEtapaId: "b" }),
    conexao({ id: "2", origemEtapaId: "b", destinoEtapaId: "c", rotulo: "se divergente" }),
    conexao({ id: "3", origemEtapaId: "c", destinoEtapaId: "b", tipo: "RETRABALHO", rotulo: "corrigir" }),
  ],
};

describe("o SVG do fluxo", () => {
  const { svg, largura, altura } = montarSvgDoFluxo(FLUXO, CATALOGO, {
    exportadoEm: "2026-08-27T10:00:00.000Z",
    empresa: "Transportes Exemplo",
  });

  it("traz toda etapa cadastrada — nenhuma some no caminho", () => {
    for (const e of FLUXO.etapas) expect(svg).toContain(e.nome);
  });

  it("traz uma seta por conexão, a de retrabalho inclusive", () => {
    /* Uma seta é um `<path … marker-end>`; o cartão é `<rect>`. */
    const setas = svg.match(/<path [^>]*marker-end/g) ?? [];
    expect(setas).toHaveLength(FLUXO.conexoes.length);
    /* E o retrabalho sai tracejado e roxo, como na tela. */
    expect(svg).toContain('stroke="#8b5cf6"');
    expect(svg).toContain('stroke-dasharray="6 4"');
  });

  it("escreve o rótulo da condição, que é o que explica a seta", () => {
    expect(svg).toContain("se divergente");
    expect(svg).toContain("corrigir");
  });

  it("o cabeçalho identifica o processo sem depender do produto aberto", () => {
    expect(svg).toContain("Operação empurrada");
    expect(svg).toContain("Faturamento");
    expect(svg).toContain("3 etapas");
    expect(svg).toContain("Transportes Exemplo");
    expect(svg).toContain("Exportado em 27/08/2026");
  });

  it("o fundo é claro, mesmo para quem exporta no tema escuro", () => {
    expect(svg).toContain(`<rect width="${largura}" height="${altura}" fill="#ffffff"`);
  });

  it("a etapa marcada como atenção sai marcada no arquivo", () => {
    /* O triângulo de atenção é o único `path` com o âmbar da tela. */
    expect(svg).toContain('stroke="#d97706"');
  });

  it("o enquadramento cobre todos os cartões, com margem", () => {
    const direita = Math.max(...FLUXO.etapas.map((e) => e.posX)) + 200;
    expect(largura).toBeGreaterThan(direita);
    expect(altura).toBeGreaterThan(Math.max(...FLUXO.etapas.map((e) => e.posY)));
  });

  it("é um SVG bem formado e autossuficiente — sem `href` para fora", () => {
    expect(svg.startsWith("<svg xmlns=")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).not.toContain("http://exemplo");
    expect(svg).not.toMatch(/<image\b/);
    expect(svg).not.toMatch(/@import|<foreignObject/);
  });

  it("um nome com `&` ou `<` não quebra o XML", () => {
    const comSinal = {
      ...FLUXO,
      etapas: [etapa({ id: "x", nome: "Crédito & baixa <no Rodopar>" })],
      conexoes: [],
    };
    /* O nome quebra em duas linhas do cartão; o que importa é que sai escapado. */
    const saida = montarSvgDoFluxo(comSinal, CATALOGO).svg;
    expect(saida).toContain("Crédito &amp; baixa &lt;no");
    expect(saida).toContain("Rodopar&gt;");
    expect(saida).not.toContain("<no Rodopar>");
  });

  it("uma conexão cujas pontas sumiram não vira seta para o nada", () => {
    const orfã = {
      ...FLUXO,
      conexoes: [...FLUXO.conexoes, conexao({ id: "9", origemEtapaId: "a", destinoEtapaId: "sumida" })],
    };
    const setas = (montarSvgDoFluxo(orfã, CATALOGO).svg.match(/<path [^>]*marker-end/g) ?? []).length;
    expect(setas).toBe(FLUXO.conexoes.length);
  });

  it("um fluxo sem etapas ainda produz um arquivo, com o nome do processo", () => {
    const vazio = { ...FLUXO, etapas: [], conexoes: [] };
    const saida = montarSvgDoFluxo(vazio, CATALOGO);
    expect(saida.svg).toContain("Operação empurrada");
    expect(saida.largura).toBeGreaterThan(0);
    expect(saida.altura).toBeGreaterThan(0);
  });

  it("um tipo que o catálogo não conhece continua desenhado", () => {
    const estranho = {
      ...FLUXO,
      etapas: [etapa({ id: "z", nome: "Etapa de tipo novo", tipo: "CARIMBO" })],
      conexoes: [],
    };
    const saida = montarSvgDoFluxo(estranho, CATALOGO).svg;
    expect(saida).toContain("Etapa de tipo novo");
    expect(saida).toContain("CARIMBO");
  });

  it("sem catálogo — a consulta ainda não voltou — o desenho sai mesmo assim", () => {
    const saida = montarSvgDoFluxo(FLUXO, undefined).svg;
    for (const e of FLUXO.etapas) expect(saida).toContain(e.nome);
  });
});

describe("a volta longa — a seta que sobe várias etapas", () => {
  /*
    O caso que a primeira exportação de verdade revelou: num processo em
    corrente, o retrabalho que sobe seis etapas cortava o desenho em linha reta,
    passando por cima dos cartões, e o rótulo dele caía em cima de um deles.
  */
  const emCorrente: FluxoCompleto = {
    ...FLUXO,
    etapas: [
      etapa({ id: "a", nome: "Primeira", posX: 0, posY: 0 }),
      etapa({ id: "b", nome: "Segunda", posX: 0, posY: 150 }),
      etapa({ id: "c", nome: "Terceira", posX: 0, posY: 300 }),
      etapa({ id: "d", nome: "Quarta", posX: 0, posY: 450 }),
    ],
    conexoes: [
      conexao({ id: "1", origemEtapaId: "a", destinoEtapaId: "b" }),
      conexao({ id: "2", origemEtapaId: "b", destinoEtapaId: "c" }),
      conexao({ id: "3", origemEtapaId: "c", destinoEtapaId: "d" }),
      conexao({
        id: "4",
        origemEtapaId: "d",
        destinoEtapaId: "a",
        tipo: "RETRABALHO",
        rotulo: "divergência de valor",
      }),
    ],
  };

  const { svg, largura } = montarSvgDoFluxo(emCorrente, CATALOGO);

  it("sai por um canal à direita de todos os cartões, e não por cima deles", () => {
    const volta = /<path d="M [\d.]+ [\d.]+ L ([\d.]+) [^"]*" fill="none" stroke="#8b5cf6"/.exec(svg);
    expect(volta).not.toBeNull();
    const canal = Number(volta![1]);
    /* Os cartões terminam em 200 + margem; o canal fica depois disso. */
    expect(canal).toBeGreaterThan(232);
  });

  it("a folha cresce para caber o canal e o rótulo dele", () => {
    /*
      Com nome curto, quem manda na largura é o desenho — e é isso que este
      caso mede. Com o nome longo do fluxo real, o mínimo do cabeçalho encobre
      a diferença, que é o comportamento certo e é medido logo abaixo.
    */
    const curto = { ...emCorrente, fluxo: { ...emCorrente.fluxo, nome: "Ciclo", dono: null } };
    const comVolta = montarSvgDoFluxo(curto, CATALOGO);
    const semVolta = montarSvgDoFluxo(
      { ...curto, conexoes: curto.conexoes.slice(0, 3) },
      CATALOGO,
    );
    expect(comVolta.largura).toBeGreaterThan(semVolta.largura);
  });

  it("a volta curta continua em linha direta — não vale desviar por 150px", () => {
    const curta = {
      ...emCorrente,
      conexoes: [
        conexao({ id: "9", origemEtapaId: "b", destinoEtapaId: "a", tipo: "RETRABALHO" }),
      ],
    };
    /* Sem o canal, o caminho é uma cúbica: `C` no lugar do primeiro `L`. */
    expect(montarSvgDoFluxo(curta, CATALOGO).svg).toMatch(/stroke="#8b5cf6"/);
    expect(montarSvgDoFluxo(curta, CATALOGO).svg).toMatch(/<path d="M [\d.]+ [\d.]+ C /);
  });
});

describe("o cabeçalho manda na largura mínima da folha", () => {
  it("um processo estreito com nome longo não sai com o título cortado", () => {
    const estreito: FluxoCompleto = {
      ...FLUXO,
      fluxo: {
        ...FLUXO.fluxo,
        nome: "Operação empurrada — do faturamento ao recebimento, ponta a ponta",
      },
      etapas: [etapa({ id: "a", nome: "Única", posX: 0, posY: 0 })],
      conexoes: [],
    };
    const { largura } = montarSvgDoFluxo(estreito, CATALOGO, {
      exportadoEm: "2026-08-27T10:00:00Z",
    });
    /* O desenho tem 200px de cartão; a folha precisa caber o nome inteiro. */
    expect(largura).toBeGreaterThan(600);
  });
});

describe("a legenda", () => {
  it("traz só os tipos de seta que o fluxo usa", () => {
    expect(montarLegenda(FLUXO, CATALOGO).map((i) => i.rotulo)).toEqual([
      "Retrabalho",
      "Sequência",
    ]);
  });

  it("um fluxo só de sequência não ganha cinco entradas de enfeite", () => {
    const simples = { ...FLUXO, conexoes: [FLUXO.conexoes[0]] };
    expect(montarLegenda(simples, CATALOGO)).toHaveLength(1);
  });

  it("sem conexão nenhuma, não há legenda", () => {
    expect(montarLegenda({ ...FLUXO, conexoes: [] }, CATALOGO)).toEqual([]);
  });
});

describe("a quebra de linha do cartão", () => {
  it("quebra por palavra, e nunca no meio de uma", () => {
    const linhas = quebrarEmLinhas("Origem da tarifa e das informações do trecho", 176, 6.4, 3);
    expect(linhas.length).toBeGreaterThan(1);
    expect(linhas.join(" ")).toContain("informações");
    for (const linha of linhas) expect(linha.trim()).toBe(linha);
  });

  it("o que passa do limite de linhas vira reticências, e não um cartão gigante", () => {
    const linhas = quebrarEmLinhas(
      "Uma etapa com um nome absurdamente longo que ninguém deveria ter escrito mas alguém escreveu",
      176,
      6.4,
      3,
    );
    expect(linhas).toHaveLength(3);
    expect(linhas[2].endsWith("…")).toBe(true);
  });

  it("uma palavra maior que a linha fica sozinha, sem estourar o laço", () => {
    expect(quebrarEmLinhas("supercalifragilisticoexpialidoso", 40, 6.4, 3)).toHaveLength(1);
  });

  it("texto em branco não produz linha nenhuma", () => {
    expect(quebrarEmLinhas("   ", 176, 6.4, 3)).toEqual([]);
  });
});

describe("a caixa da etapa", () => {
  it("cresce com o nome, e o cartão de nome curto é o menor", () => {
    const curta = caixaDaEtapa(etapa({ id: "1", nome: "Emitir" }), undefined);
    const longa = caixaDaEtapa(
      etapa({ id: "2", nome: "Encontro de contas e tratativa das pendências abertas" }),
      undefined,
    );
    expect(longa.altura).toBeGreaterThan(curta.altura);
  });

  it("mostra o que o cartão da tela mostra: quem responde e quantos detalhes", () => {
    const caixa = caixaDaEtapa(
      etapa({
        id: "3",
        nome: "Auditoria",
        area: "Fiscal",
        responsavel: "Analista",
        itens: [
          { id: "i", especie: "SISTEMA", nome: "Rodopar", descricao: null, obrigatorio: null, link: null, ordem: 0 },
        ],
      }),
      undefined,
    );
    expect(caixa.quemResponde).toBe("Fiscal · Analista");
    expect(caixa.detalhes).toBe(1);
  });

  it("etapa sem área nem responsável não reserva a linha", () => {
    const sem = caixaDaEtapa(etapa({ id: "4", nome: "Etapa" }), undefined);
    const com = caixaDaEtapa(etapa({ id: "5", nome: "Etapa", area: "Fiscal" }), undefined);
    expect(sem.quemResponde).toBeNull();
    expect(com.altura).toBeGreaterThan(sem.altura);
  });
});

describe("o nome do arquivo", () => {
  it("usa o endereço do fluxo e a data", () => {
    expect(
      nomeDoArquivo({ nome: "Qualquer", slug: "operacao-empurrada" }, "png", "2026-08-27T10:00:00Z"),
    ).toBe("operacao-empurrada-2026-08-27.png");
  });

  it("sem endereço, deriva do nome — sem acento e sem espaço", () => {
    expect(nomeDoArquivo({ nome: "Operação Empurrada", slug: "" }, "pdf", "2026-08-27T10:00:00Z")).toBe(
      "operacao-empurrada-2026-08-27.pdf",
    );
  });

  it("um nome que não sobra nada ainda produz arquivo com nome", () => {
    expect(nomeDoArquivo({ nome: "···", slug: "" }, "png", "2026-08-27T10:00:00Z")).toBe(
      "fluxo-2026-08-27.png",
    );
  });
});

describe("o PDF", () => {
  const imagem = {
    dados: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    filtro: "FlateDecode" as const,
    largura: 1200,
    altura: 800,
    titulo: "Operação empurrada (v2)",
  };
  const pdf = montarPdfDeImagem(imagem);
  const texto = new TextDecoder("latin1").decode(pdf);

  it("é um PDF: cabeçalho, objetos e fim de arquivo", () => {
    expect(texto.startsWith("%PDF-1.4")).toBe(true);
    expect(texto.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(texto).toContain("/Type /Catalog");
    expect(texto).toContain("/Type /Pages");
    expect(texto).toContain("/Type /Page ");
    expect(texto).toContain("/Subtype /Image");
  });

  it("a tabela de deslocamentos aponta para o começo de cada objeto", () => {
    const inicio = Number(/startxref\n(\d+)/.exec(texto)![1]);
    expect(texto.slice(inicio, inicio + 4)).toBe("xref");

    const linhas = texto
      .slice(inicio)
      .split("\n")
      .filter((l) => /^\d{10} \d{5} n\s*$/.test(l));
    expect(linhas).toHaveLength(6);
    linhas.forEach((linha, indice) => {
      const deslocamento = Number(linha.slice(0, 10));
      /* No deslocamento gravado tem de começar exatamente aquele objeto. */
      expect(texto.slice(deslocamento).startsWith(`${indice + 1} 0 obj`)).toBe(true);
    });
  });

  it("embute os bytes da imagem sem tocá-los", () => {
    const marca = texto.indexOf("stream\n", texto.indexOf("/Subtype /Image")) + "stream\n".length;
    expect([...pdf.slice(marca, marca + imagem.dados.length)]).toEqual([...imagem.dados]);
    expect(texto).toContain(`/Length ${imagem.dados.length}`);
  });

  it("um desenho largo sai em paisagem, e um alto em retrato", () => {
    const larga = new TextDecoder("latin1").decode(montarPdfDeImagem(imagem));
    expect(larga).toContain("/MediaBox [0 0 841.89 595.28]");

    const alta = new TextDecoder("latin1").decode(
      montarPdfDeImagem({ ...imagem, largura: 800, altura: 1600 }),
    );
    expect(alta).toContain("/MediaBox [0 0 595.28 841.89]");
  });

  it("a imagem é encaixada na página inteira menos a margem, sem distorcer", () => {
    const desenho = /q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/.exec(texto)!;
    const [larguraNaPagina, alturaNaPagina, esquerda, base] = desenho.slice(1).map(Number);

    expect(larguraNaPagina / alturaNaPagina).toBeCloseTo(imagem.largura / imagem.altura, 2);
    expect(larguraNaPagina).toBeLessThanOrEqual(841.89 - 48);
    expect(alturaNaPagina).toBeLessThanOrEqual(595.28 - 48);
    /* E centralizada: as duas sobras laterais são iguais. */
    expect(esquerda * 2 + larguraNaPagina).toBeCloseTo(841.89, 1);
    expect(base * 2 + alturaNaPagina).toBeCloseTo(595.28, 1);
  });

  it("um parêntese no nome do fluxo não quebra a string do título", () => {
    expect(texto).toContain("/Title (Operacao empurrada \\(v2\\))");
  });

  it("o JPEG entra pelo outro filtro, quando o navegador não tem deflate", () => {
    const comJpeg = new TextDecoder("latin1").decode(
      montarPdfDeImagem({ ...imagem, filtro: "DCTDecode" }),
    );
    expect(comJpeg).toContain("/Filter /DCTDecode");
  });
});

describe("escaparXml", () => {
  it("cobre os quatro caracteres que quebram um atributo ou um nó", () => {
    expect(escaparXml('a & b < c > d "e"')).toBe("a &amp; b &lt; c &gt; d &quot;e&quot;");
  });
});

describe("o SVG como arquivo", () => {
  it("sai com o tipo que o navegador reconhece, e com o desenho dentro", async () => {
    const blob = fluxoComoSvg(FLUXO, CATALOGO, { exportadoEm: "2026-08-27T10:00:00Z" });
    expect(blob.type).toContain("image/svg+xml");
    const texto = await blob.text();
    expect(texto.startsWith("<svg xmlns=")).toBe(true);
    for (const e of FLUXO.etapas) expect(texto).toContain(e.nome);
  });
});
