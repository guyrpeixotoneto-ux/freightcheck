import { describe, expect, it } from "vitest";
import { abaDaEtapa, abaDeInstrucoes, modeloDoFluxo, nomeDaAbaDaEtapa } from "@/lib/fluxos-modelo";
import {
  arquivosDaPasta,
  crc32,
  escaparXml,
  letraDaColuna,
  nomeDePlanilha,
  planilhaComoXml,
  zipArmazenado,
} from "@/lib/xlsx-minimo";
import type { Catalogo, Etapa, FluxoCompleto } from "@/lib/fluxos";

/**
 * O MODELO EM EXCEL — o que sai na planilha, provado sem Excel.
 *
 * Duas afirmações carregam este arquivo, e são as duas que quebram na cara de
 * quem usa se ninguém as guardar:
 *
 * 1. **Toda etapa vira uma aba, e toda aba tem os campos do painel lateral.**
 *    Um modelo que perde uma etapa, ou que esquece um campo, circula numa
 *    reunião como se fosse o formulário completo — e o que ficou de fora não é
 *    levantado por ninguém.
 * 2. **O arquivo é um ZIP válido.** Não há navegador aqui para abrir o `.xlsx`,
 *    mas a estrutura do contêiner é bytes, e bytes se afirmam: assinaturas,
 *    contagem de entradas, CRC e o deslocamento do diretório central.
 */

const CATALOGO: Catalogo = {
  tiposDeEtapa: [
    {
      valor: "PROCESSO",
      rotulo: "Processo",
      descricao: "Um passo de trabalho.",
      forma: "retangulo",
      classe: "",
      icone: "Square",
    },
    {
      valor: "PENDENCIA",
      rotulo: "Pendência",
      descricao: "O que trava.",
      forma: "retangulo",
      classe: "",
      icone: "AlertTriangle",
    },
  ],
  tiposDeConexao: [
    { valor: "SEQUENCIA", rotulo: "Sequência", descricao: "Segue.", tracejada: false, classe: "" },
  ],
  especiesDeItem: [
    {
      valor: "SISTEMA",
      rotulo: "Sistema",
      titulo: "Sistemas",
      descricao: "Onde a etapa acontece.",
      icone: "Server",
      usaLink: true,
      usaObrigatorio: false,
    },
    {
      valor: "DOCUMENTO",
      rotulo: "Documento",
      titulo: "Documentos",
      descricao: "O que a etapa exige.",
      icone: "FileText",
      usaLink: false,
      usaObrigatorio: true,
    },
  ],
  statusDoFluxo: [{ valor: "RASCUNHO", rotulo: "Rascunho", descricao: "Em levantamento." }],
  statusDaEtapa: [
    { valor: "ATIVO", rotulo: "Ativo", descricao: "Normal." },
    { valor: "ATENCAO", rotulo: "Atenção", descricao: "Precisa de olhar." },
  ],
  sentidosDoIndicador: [{ valor: "NEUTRO", rotulo: "Neutro", descricao: "Sem direção boa." }],
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

const FLUXO: FluxoCompleto = {
  fluxo: {
    id: "f1",
    empresaId: "e1",
    nome: "Operação Empurrada",
    slug: "operacao-empurrada",
    descricao: "Do faturamento ao recebimento.",
    objetivo: "Receber no prazo.",
    categoria: "Faturamento",
    status: "RASCUNHO",
    versao: 1,
    dono: "Faturamento",
    criadoEm: "2026-01-01T00:00:00.000Z",
    atualizadoEm: "2026-01-01T00:00:00.000Z",
    criadoPor: null,
    atualizadoPor: null,
  },
  etapas: [
    etapa({
      id: "e1",
      nome: "Origem da tarifa",
      area: "Operação",
      responsavel: "Analista",
      sistemaPrincipal: "TMS",
      descricao: "A tarifa chega do contrato.",
      itens: [
        {
          id: "i1",
          especie: "SISTEMA",
          nome: "Promax",
          descricao: "TMS",
          obrigatorio: null,
          link: "https://promax",
          ordem: 0,
        },
        {
          id: "i2",
          especie: "DOCUMENTO",
          nome: "Contrato",
          descricao: null,
          obrigatorio: true,
          link: null,
          ordem: 0,
        },
      ],
      indicadores: [
        {
          id: "k1",
          nome: "Tarifas divergentes",
          descricao: null,
          unidade: "%",
          sentido: "NEUTRO",
          origem: "SAP",
          ordem: 0,
        },
      ],
      acoes: [
        {
          id: "a1",
          titulo: "Ver alterações",
          descricao: null,
          rota: "/alteracoes",
          parametros: null,
          icone: null,
          ordem: 0,
        },
      ],
    }),
    etapa({ id: "e2", nome: "Pendências", tipo: "PENDENCIA", status: "ATENCAO" }),
  ],
  conexoes: [
    {
      id: "c1",
      fluxoId: "f1",
      origemEtapaId: "e1",
      destinoEtapaId: "e2",
      tipo: "SEQUENCIA",
      rotulo: "sem retorno",
      ordem: 0,
    },
  ],
};

/** Todo texto escrito numa planilha, sem estrutura — para afirmar presença. */
function textos(planilha: { linhas: unknown[][] }): string[] {
  return planilha.linhas
    .flat()
    .map((celula) =>
      celula === null || celula === undefined
        ? ""
        : typeof celula === "string"
          ? celula
          : String((celula as { valor: string }).valor),
    )
    .filter((t) => t !== "");
}

describe("o modelo do fluxo", () => {
  it("dá uma aba a cada etapa, além da capa e das instruções", () => {
    const pasta = modeloDoFluxo(FLUXO, CATALOGO, { exportadoEm: "2026-08-27T10:00:00.000Z" });

    expect(pasta.planilhas.map((p) => p.nome)).toEqual([
      "Fluxo",
      "Como preencher",
      "01 Origem da tarifa",
      "02 Pendências",
    ]);
  });

  it("traz na aba da etapa todo campo que o painel lateral mostra", () => {
    const conteudo = textos(abaDaEtapa(FLUXO.etapas[0], 0, FLUXO, CATALOGO));

    for (const rotulo of [
      "Nome da etapa",
      "Tipo",
      "Status",
      "Área",
      "Responsável",
      "Sistema principal",
      "O que acontece aqui",
      "Objetivo da etapa",
      "Regras de negócio",
      "Dados",
      "Observações (texto antigo)",
      "Chave de monitoramento",
    ]) {
      expect(conteudo).toContain(rotulo);
    }

    /* As listas do catálogo — título e colunas — e as duas fixas do editor. */
    expect(conteudo).toContain("Sistemas");
    expect(conteudo).toContain("Documentos");
    expect(conteudo).toContain("Link");
    expect(conteudo).toContain("Obrigatório (sim/não)");
    expect(conteudo).toContain("Indicadores");
    expect(conteudo).toContain("Consultar no FreightCheck");
  });

  it("já vem preenchida com o que a etapa tem cadastrado", () => {
    const conteudo = textos(abaDaEtapa(FLUXO.etapas[0], 0, FLUXO, CATALOGO));

    expect(conteudo).toContain("Origem da tarifa");
    expect(conteudo).toContain("A tarifa chega do contrato.");
    expect(conteudo).toContain("Promax");
    expect(conteudo).toContain("https://promax");
    expect(conteudo).toContain("Contrato");
    expect(conteudo).toContain("sim");
    expect(conteudo).toContain("Tarifas divergentes");
    expect(conteudo).toContain("/alteracoes");
    /* O rótulo do catálogo, e não o valor cru do banco. */
    expect(conteudo).toContain("Processo");
    expect(conteudo).not.toContain("PROCESSO");
  });

  it("mostra na aba as setas que chegam e saem da etapa", () => {
    const conteudo = textos(abaDaEtapa(FLUXO.etapas[1], 1, FLUXO, CATALOGO));

    expect(conteudo).toContain("Vem de");
    expect(conteudo).toContain("Origem da tarifa");
    expect(conteudo).toContain("sem retorno");
  });

  it("indexa as abas na capa, com o nome final de cada uma", () => {
    const pasta = modeloDoFluxo(FLUXO, CATALOGO, {});
    const capa = textos(pasta.planilhas[0]);

    expect(capa).toContain("Operação Empurrada");
    expect(capa).toContain("01 Origem da tarifa");
    expect(capa).toContain("02 Pendências");
    /* O status fora do normal aparece junto do nome — é o que a tela destaca. */
    expect(capa).toContain("Pendências (Atenção)");
  });

  it("imprime os valores aceitos, porque a planilha não valida lista", () => {
    const instrucoes = textos(abaDeInstrucoes(CATALOGO));

    expect(instrucoes).toContain("Processo");
    expect(instrucoes).toContain("Pendência");
    expect(instrucoes).toContain("Atenção");
    expect(instrucoes).toContain("Neutro");
    expect(instrucoes).toContain("Sequência");
  });

  it("produz arquivo mesmo sem etapa nenhuma", () => {
    const pasta = modeloDoFluxo({ ...FLUXO, etapas: [], conexoes: [] }, CATALOGO, {});

    expect(pasta.planilhas.map((p) => p.nome)).toEqual(["Fluxo", "Como preencher"]);
  });

  it("sobrevive a um catálogo que ainda não chegou", () => {
    const pasta = modeloDoFluxo(FLUXO, undefined, {});

    expect(pasta.planilhas).toHaveLength(4);
    /* Sem catálogo não há espécies, mas os campos próprios da etapa continuam. */
    expect(textos(pasta.planilhas[2])).toContain("Sistema principal");
  });
});

describe("o nome da aba", () => {
  it("numera pela ordem do processo", () => {
    expect(nomeDaAbaDaEtapa({ nome: "Emissão" }, 0, [])).toBe("01 Emissão");
    expect(nomeDaAbaDaEtapa({ nome: "Emissão" }, 11, [])).toBe("12 Emissão");
  });

  it("cabe nos 31 caracteres do Excel", () => {
    const nome = nomeDaAbaDaEtapa(
      { nome: "Solicitação de emissão do documento fiscal no Unidox" },
      2,
      [],
    );
    expect(nome.length).toBeLessThanOrEqual(31);
    expect(nome.startsWith("03 ")).toBe(true);
  });

  it("troca os caracteres que o Excel recusa e desempata os repetidos", () => {
    expect(nomeDePlanilha("SAP / Unidox: emissão", [])).toBe("SAP Unidox emissão");
    expect(nomeDePlanilha("Emissão", ["emissão"])).toBe("Emissão (2)");
    expect(nomeDePlanilha("", [])).toBe("Aba");
  });
});

describe("o arquivo .xlsx", () => {
  it("escreve texto em célula, com estilo e coluna certos", () => {
    const xml = planilhaComoXml({
      nome: "X",
      linhas: [[{ valor: "Título", estilo: "titulo" }], [null, "valor"]],
    });

    expect(xml).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Título</t>');
    expect(xml).toContain('<c r="B2" s="0"');
    /* A célula vazia e sem estilo não vira XML nenhum. */
    expect(xml).not.toContain('r="A2"');
  });

  it("escapa o que estragaria o XML, e some com controle que o invalidaria", () => {
    expect(escaparXml('Tarifa & "frete" <mín>')).toBe(
      "Tarifa &amp; &quot;frete&quot; &lt;mín&gt;",
    );
    expect(escaparXml("a\u0000b\u0007c")).toBe("abc");
    expect(escaparXml("uma\nlinha")).toBe("uma\nlinha");
  });

  it("numera as colunas em base-26 bijetiva", () => {
    expect(letraDaColuna(0)).toBe("A");
    expect(letraDaColuna(25)).toBe("Z");
    expect(letraDaColuna(26)).toBe("AA");
    expect(letraDaColuna(701)).toBe("ZZ");
  });

  it("declara uma parte por aba, e a relação que a liga", () => {
    const arquivos = arquivosDaPasta(modeloDoFluxo(FLUXO, CATALOGO, {}));
    const caminhos = arquivos.map((a) => a.caminho);

    expect(caminhos).toContain("[Content_Types].xml");
    expect(caminhos).toContain("_rels/.rels");
    expect(caminhos).toContain("xl/workbook.xml");
    expect(caminhos).toContain("xl/styles.xml");
    expect(caminhos.filter((c) => c.startsWith("xl/worksheets/"))).toHaveLength(4);

    const texto = (caminho: string) =>
      new TextDecoder().decode(arquivos.find((a) => a.caminho === caminho)!.conteudo);

    expect(texto("xl/workbook.xml")).toContain('name="01 Origem da tarifa"');
    for (let i = 1; i <= 4; i += 1) {
      expect(texto("[Content_Types].xml")).toContain(`/xl/worksheets/sheet${i}.xml`);
      expect(texto("xl/_rels/workbook.xml.rels")).toContain(`worksheets/sheet${i}.xml`);
    }
    expect(texto("xl/_rels/workbook.xml.rels")).toContain('Id="rId5" Type');
  });

  it("empacota num ZIP que se lê pelo diretório central", () => {
    const arquivos = arquivosDaPasta(modeloDoFluxo(FLUXO, CATALOGO, {}));
    const zip = zipArmazenado(arquivos);
    const visao = new DataView(zip.buffer);

    /* Começa por um cabeçalho local, e termina pelo fim do diretório central. */
    expect(visao.getUint32(0, true)).toBe(0x04034b50);
    const fim = zip.length - 22;
    expect(visao.getUint32(fim, true)).toBe(0x06054b50);
    expect(visao.getUint16(fim + 10, true)).toBe(arquivos.length);

    /* O diretório está onde o fim diz que está, e é mesmo um diretório. */
    const inicioDoCentral = visao.getUint32(fim + 16, true);
    expect(visao.getUint32(inicioDoCentral, true)).toBe(0x02014b50);
    expect(visao.getUint32(fim + 12, true)).toBe(fim - inicioDoCentral);

    /* A primeira entrada guarda o CRC e o tamanho do que foi escrito. */
    expect(visao.getUint32(14, true)).toBe(crc32(arquivos[0].conteudo));
    expect(visao.getUint32(18, true)).toBe(arquivos[0].conteudo.length);
  });

  it("sai byte a byte igual quando o fluxo é o mesmo", () => {
    const um = zipArmazenado(arquivosDaPasta(modeloDoFluxo(FLUXO, CATALOGO, {})));
    const outro = zipArmazenado(arquivosDaPasta(modeloDoFluxo(FLUXO, CATALOGO, {})));

    expect(Array.from(um)).toEqual(Array.from(outro));
  });

  it("calcula o CRC-32 que o formato espera", () => {
    /* O valor canônico de "123456789", que toda implementação de CRC-32 cita. */
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});
