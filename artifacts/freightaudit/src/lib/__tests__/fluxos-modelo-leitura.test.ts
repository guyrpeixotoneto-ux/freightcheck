import { describe, expect, it } from "vitest";
import { modeloDoFluxo } from "@/lib/fluxos-modelo";
import { arquivosDaPasta, zipArmazenado } from "@/lib/xlsx-minimo";
import {
  ArquivoIlegivel,
  colunaDaReferencia,
  conteudoDaEntrada,
  desescaparXml,
  entradasDoZip,
  lerPasta,
  linhasDaPlanilha,
  textosCompartilhados,
} from "@/lib/xlsx-leitura";
import {
  lerAbaDaEtapa,
  nomeSemNumero,
  numeroDaAba,
  planoDeImportacao,
  tamanhoDoPlano,
} from "@/lib/fluxos-modelo-leitura";
import type { PastaLida, PlanilhaLida } from "@/lib/xlsx-leitura";
import type { Catalogo, Etapa, FluxoCompleto } from "@/lib/fluxos";

/**
 * A VOLTA DO MODELO — o que a planilha preenchida muda, provado sem Excel.
 *
 * O teste central deste arquivo é a **ida e volta**: exporta o fluxo, lê o
 * arquivo exportado de novo e afirma que o plano não muda nada. É a única
 * afirmação que guarda o contrato dos rótulos: renomear um campo no escritor e
 * esquecer o leitor derruba este teste na hora, enquanto na produção derrubaria
 * só o campo — em silêncio, no meio de uma importação que diz "12 etapas
 * atualizadas".
 *
 * Depois dele vêm as três regras que evitam apagar o que ninguém mandou apagar
 * (branco não apaga, tabela vazia não apaga, aba desconhecida não vira etapa) e
 * o reconhecimento por id, por posição e por nome.
 */

const CATALOGO: Catalogo = {
  tiposDeEtapa: [
    {
      valor: "PROCESSO",
      rotulo: "Processo",
      descricao: "Um passo.",
      forma: "retangulo",
      classe: "",
      icone: "Square",
    },
    {
      valor: "VALIDACAO",
      rotulo: "Validação",
      descricao: "Confere.",
      forma: "retangulo",
      classe: "",
      icone: "Check",
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
      descricao: "Onde acontece.",
      icone: "Server",
      usaLink: true,
      usaObrigatorio: false,
    },
    {
      valor: "DOCUMENTO",
      rotulo: "Documento",
      titulo: "Documentos",
      descricao: "O que exige.",
      icone: "FileText",
      usaLink: false,
      usaObrigatorio: true,
    },
  ],
  statusDoFluxo: [{ valor: "RASCUNHO", rotulo: "Rascunho", descricao: "d" }],
  statusDaEtapa: [
    { valor: "ATIVO", rotulo: "Ativo", descricao: "d" },
    { valor: "ATENCAO", rotulo: "Atenção", descricao: "d" },
  ],
  sentidosDoIndicador: [
    { valor: "NEUTRO", rotulo: "Neutro", descricao: "d" },
    { valor: "MAIOR_MELHOR", rotulo: "Maior é melhor", descricao: "d" },
  ],
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
    posX: 10,
    posY: 20,
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
    descricao: null,
    objetivo: null,
    categoria: "Faturamento",
    status: "RASCUNHO",
    versao: 1,
    dono: null,
    criadoEm: "",
    atualizadoEm: "",
    criadoPor: null,
    atualizadoPor: null,
  },
  etapas: [
    etapa({
      id: "e1",
      nome: "Origem da tarifa",
      area: "Operação",
      responsavel: "Analista",
      descricao: "A tarifa chega do contrato.",
      sistemaPrincipal: "TMS",
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
          descricao: "",
          obrigatorio: true,
          link: null,
          ordem: 0,
        },
      ],
      indicadores: [
        {
          id: "k1",
          nome: "Tarifas divergentes",
          descricao: "",
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
          descricao: "",
          rota: "/alteracoes",
          parametros: null,
          icone: null,
          ordem: 0,
        },
      ],
    }),
    etapa({ id: "e2", nome: "Auditoria fiscal", tipo: "VALIDACAO", ordem: 1 }),
  ],
  conexoes: [
    {
      id: "c1",
      fluxoId: "f1",
      origemEtapaId: "e1",
      destinoEtapaId: "e2",
      tipo: "SEQUENCIA",
      rotulo: null,
      ordem: 0,
    },
  ],
};

/** O modelo exportado, lido de volta — o caminho inteiro, byte a byte. */
async function idaEVolta(fluxo: FluxoCompleto = FLUXO): Promise<PastaLida> {
  const bytes = zipArmazenado(arquivosDaPasta(modeloDoFluxo(fluxo, CATALOGO, {})));
  return lerPasta(bytes);
}

/** A aba de uma etapa dentro do que foi lido, pelo número do começo do nome. */
function aba(pasta: PastaLida, numero: string): PlanilhaLida {
  const achada = pasta.planilhas.find((p) => p.nome.startsWith(numero));
  if (!achada) throw new Error(`aba ${numero} não veio`);
  return achada;
}

/** Escreve um valor na coluna B da linha cujo rótulo está na coluna A. */
function preencher(planilha: PlanilhaLida, rotulo: string, valor: string): void {
  const linha = planilha.linhas.find((l) => (l[0] ?? "").trim() === rotulo);
  if (!linha) throw new Error(`rótulo "${rotulo}" não existe na aba`);
  linha[1] = valor;
}

describe("a ida e a volta", () => {
  it("lê de volta o que a exportação escreveu", async () => {
    const pasta = await idaEVolta();

    expect(pasta.planilhas.map((p) => p.nome)).toEqual([
      "Fluxo",
      "Como preencher",
      "01 Origem da tarifa",
      "02 Auditoria fiscal",
    ]);
  });

  it("não propõe mudança nenhuma quando nada foi preenchido", async () => {
    const plano = planoDeImportacao(await idaEVolta(), FLUXO, CATALOGO);

    expect(plano.mudancas).toEqual([]);
    expect(plano.naoReconhecidas).toEqual([]);
    expect(plano.avisos).toEqual([]);
    expect(plano.semMudanca).toEqual(["01 Origem da tarifa", "02 Auditoria fiscal"]);
  });

  it("reconhece a etapa pelo id do rodapé, e não pelo nome", async () => {
    const pasta = await idaEVolta();
    const planilha = aba(pasta, "01");
    preencher(planilha, "Nome da etapa", "Origem da tarifa e do trecho");

    const plano = planoDeImportacao(pasta, FLUXO, CATALOGO);

    expect(plano.mudancas).toHaveLength(1);
    expect(plano.mudancas[0].etapaId).toBe("e1");
    expect(plano.mudancas[0].reconhecidaPor).toBe("id");
    expect(plano.mudancas[0].campos).toEqual([
      { rotulo: "Nome da etapa", de: "Origem da tarifa", para: "Origem da tarifa e do trecho" },
    ]);
    expect(plano.mudancas[0].corpo.nome).toBe("Origem da tarifa e do trecho");
  });

  it("traduz o rótulo do catálogo para o valor que o banco guarda", async () => {
    const pasta = await idaEVolta();
    preencher(aba(pasta, "01"), "Tipo", "Validação");
    preencher(aba(pasta, "01"), "Status", "Atenção");

    const plano = planoDeImportacao(pasta, FLUXO, CATALOGO);

    expect(plano.mudancas[0].corpo.tipo).toBe("VALIDACAO");
    expect(plano.mudancas[0].corpo.status).toBe("ATENCAO");
  });

  it("recusa o valor que o catálogo não conhece, e diz isso", async () => {
    const pasta = await idaEVolta();
    preencher(aba(pasta, "01"), "Tipo", "Coisa");

    const plano = planoDeImportacao(pasta, FLUXO, CATALOGO);

    expect(plano.mudancas).toEqual([]);
    expect(plano.avisos.join(" ")).toContain('Tipo: "Coisa" não existe no catálogo');
  });

  it("preserva a posição do cartão no corpo que vai para o servidor", async () => {
    const pasta = await idaEVolta();
    preencher(aba(pasta, "01"), "Observações (texto antigo)", "Levantado com a Ana.");

    const { corpo } = planoDeImportacao(pasta, FLUXO, CATALOGO).mudancas[0];

    expect(corpo.posX).toBe(10);
    expect(corpo.posY).toBe(20);
    expect(corpo.ordem).toBe(0);
  });
});

describe("as regras que impedem apagar sem ordem", () => {
  it("campo em branco não apaga o que está cadastrado", async () => {
    const pasta = await idaEVolta();
    preencher(aba(pasta, "01"), "O que acontece aqui", "");
    preencher(aba(pasta, "01"), "Sistema principal", "");

    expect(planoDeImportacao(pasta, FLUXO, CATALOGO).mudancas).toEqual([]);
  });

  it("tabela sem linha preenchida não apaga a lista", async () => {
    const pasta = await idaEVolta();
    const planilha = aba(pasta, "01");
    /* Apaga as linhas de Sistemas — a lista continua como está no cadastro. */
    for (const linha of planilha.linhas) {
      if ((linha[0] ?? "") === "Promax") linha.length = 0;
    }

    expect(planoDeImportacao(pasta, FLUXO, CATALOGO).mudancas).toEqual([]);
  });

  it("tabela com linhas substitui a lista inteira", async () => {
    const pasta = await idaEVolta();
    const planilha = aba(pasta, "01");
    const promax = planilha.linhas.find((l) => (l[0] ?? "") === "Promax")!;
    promax[0] = "Promax";
    promax[1] = "TMS da operação";
    /* A linha em branco logo abaixo vira o segundo sistema. */
    const vazia = planilha.linhas[planilha.linhas.indexOf(promax) + 1];
    vazia[0] = "SAP";
    vazia[1] = "ERP";
    vazia[2] = "https://sap";

    const plano = planoDeImportacao(pasta, FLUXO, CATALOGO);
    const lista = plano.mudancas[0].listas.find((l) => l.titulo === "Sistemas")!;

    expect(lista.de).toBe(1);
    expect(lista.para).toBe(2);
    expect(lista.linhas).toEqual([
      { nome: "Promax", descricao: "TMS da operação", ordem: 0, link: "https://promax" },
      { nome: "SAP", descricao: "ERP", ordem: 1, link: "https://sap" },
    ]);
  });

  it("lê o sim/não da coluna de obrigatório", async () => {
    const pasta = await idaEVolta();
    const planilha = aba(pasta, "01");
    const contrato = planilha.linhas.find((l) => (l[0] ?? "") === "Contrato")!;
    contrato[2] = "não";

    const plano = planoDeImportacao(pasta, FLUXO, CATALOGO);
    const lista = plano.mudancas[0].listas.find((l) => l.titulo === "Documentos")!;

    expect(lista.linhas).toEqual([
      { nome: "Contrato", descricao: "", ordem: 0, obrigatorio: false },
    ]);
  });

  it("aba que não casa com etapa nenhuma é relatada, e não vira etapa", async () => {
    const pasta = await idaEVolta();
    pasta.planilhas.push({
      nome: "Etapa nova",
      linhas: [["Nome da etapa", "Conciliação bancária"]],
    });

    const plano = planoDeImportacao(pasta, FLUXO, CATALOGO);

    expect(plano.naoReconhecidas).toEqual(["Etapa nova"]);
    expect(plano.mudancas).toEqual([]);
  });

  it("ignora a seção de ligações, que é só leitura", async () => {
    const pasta = await idaEVolta();
    const planilha = aba(pasta, "01");
    const ligacao = planilha.linhas.find((l) => (l[0] ?? "") === "Vai para")!;
    ligacao[1] = "Outra etapa qualquer";

    expect(planoDeImportacao(pasta, FLUXO, CATALOGO).mudancas).toEqual([]);
  });

  it("relata a segunda aba que aponta para a mesma etapa", async () => {
    const pasta = await idaEVolta();
    const copia: PlanilhaLida = {
      nome: "01 Origem da tarifa (cópia)",
      linhas: aba(pasta, "01").linhas.map((l) => [...l]),
    };
    pasta.planilhas.push(copia);

    const plano = planoDeImportacao(pasta, FLUXO, CATALOGO);

    expect(plano.naoReconhecidas).toEqual(["01 Origem da tarifa (cópia)"]);
    expect(plano.avisos.join(" ")).toContain("Duas abas apontam para a etapa");
  });
});

describe("o reconhecimento sem o rodapé", () => {
  it("cai para a posição da aba quando o id sumiu", async () => {
    const pasta = await idaEVolta();
    const planilha = aba(pasta, "02");
    planilha.linhas = planilha.linhas.filter((l) => !(l[0] ?? "").startsWith("id da etapa"));
    preencher(planilha, "Responsável", "Fiscal");

    const plano = planoDeImportacao(pasta, FLUXO, CATALOGO);

    expect(plano.mudancas[0].etapaId).toBe("e2");
    expect(plano.mudancas[0].reconhecidaPor).toBe("numero");
  });

  it("cai para o nome quando não há id nem número", async () => {
    const pasta: PastaLida = {
      planilhas: [
        {
          nome: "Auditoria fiscal",
          linhas: [
            ["Identificação"],
            ["Responsável", "Fiscal"],
          ],
        },
      ],
    };

    const plano = planoDeImportacao(pasta, FLUXO, CATALOGO);

    expect(plano.mudancas[0].etapaId).toBe("e2");
    expect(plano.mudancas[0].reconhecidaPor).toBe("nome");
    expect(plano.mudancas[0].corpo.responsavel).toBe("Fiscal");
  });

  it("separa o número do nome da aba", () => {
    expect(numeroDaAba("01 Origem da tarifa")).toBe(1);
    expect(numeroDaAba("12 Fechamento")).toBe(12);
    expect(numeroDaAba("Fechamento")).toBeNull();
    expect(nomeSemNumero("01 Origem da tarifa")).toBe("Origem da tarifa");
    expect(nomeSemNumero("Fechamento")).toBe("Fechamento");
  });
});

describe("a leitura de uma aba solta", () => {
  it("entende rótulo com acento diferente, e coluna fora de ordem", () => {
    const lida = lerAbaDaEtapa(
      {
        nome: "03 Emissão",
        linhas: [
          ["Identificação"],
          ["RESPONSAVEL", "Fiscal"],
          ["Sistemas"],
          ["Link", "Nome", "Descrição"],
          ["https://sap", "SAP", "ERP"],
          ["id da etapa: e9"],
        ],
      },
      CATALOGO,
    );

    expect(lida.campos.responsavel).toBe("Fiscal");
    expect(lida.itens.SISTEMA).toEqual([
      { nome: "SAP", descricao: "ERP", link: "https://sap", obrigatorio: false },
    ]);
    expect(lida.idDeclarado).toBe("e9");
  });

  it("descarta a linha de tabela que ficou sem nome", () => {
    const lida = lerAbaDaEtapa(
      {
        nome: "03 Emissão",
        linhas: [
          ["Documentos"],
          ["Nome", "Descrição", "Obrigatório (sim/não)"],
          ["", "sem nome nenhum", "sim"],
          ["Contrato", "", "sim"],
        ],
      },
      CATALOGO,
    );

    expect(lida.itens.DOCUMENTO).toEqual([
      { nome: "Contrato", descricao: "", link: "", obrigatorio: true },
    ]);
  });

  it("conta o tamanho do plano para a tela prometer o que vai gravar", async () => {
    const pasta = await idaEVolta();
    preencher(aba(pasta, "01"), "Objetivo da etapa", "Cobrar certo.");
    preencher(aba(pasta, "02"), "Área", "Fiscal");

    expect(tamanhoDoPlano(planoDeImportacao(pasta, FLUXO, CATALOGO))).toEqual({
      etapas: 2,
      campos: 2,
      listas: 0,
    });
  });
});

describe("o leitor de .xlsx", () => {
  it("acha as entradas pelo diretório central", () => {
    const arquivos = arquivosDaPasta(modeloDoFluxo(FLUXO, CATALOGO, {}));
    const entradas = entradasDoZip(zipArmazenado(arquivos));

    expect(entradas.map((e) => e.nome)).toEqual(arquivos.map((a) => a.caminho));
    expect(entradas.every((e) => e.metodo === 0)).toBe(true);
  });

  it("recusa com frase o arquivo que não é planilha", async () => {
    const lixo = new TextEncoder().encode("isto aqui é um pdf, na verdade");

    expect(() => entradasDoZip(lixo)).toThrow(ArquivoIlegivel);
    await expect(lerPasta(lixo)).rejects.toThrow("não é uma planilha");
  });

  it("lê a célula pela referência, e não pela ordem das marcas", () => {
    const xml =
      '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Rótulo</t></is></c>' +
      '<c r="C1" t="inlineStr"><is><t>ajuda</t></is></c></row>' +
      '<row r="4"><c r="B4" t="s"><v>1</v></c></row>' +
      "</sheetData></worksheet>";

    const linhas = linhasDaPlanilha(xml, ["zero", "compartilhado"]);

    expect(linhas[0]).toEqual(["Rótulo", "", "ajuda"]);
    /* A linha 2 e a 3 não existem no XML, e continuam não existindo aqui. */
    expect(linhas[1]).toEqual([]);
    expect(linhas[3]).toEqual(["", "compartilhado"]);
  });

  it("junta os pedaços de um texto compartilhado com formatação", () => {
    const xml =
      "<sst><si><t>simples</t></si>" +
      "<si><r><t>Origem da </t></r><r><t>tarifa</t></r></si></sst>";

    expect(textosCompartilhados(xml)).toEqual(["simples", "Origem da tarifa"]);
  });

  it("desfaz o escape do XML, inclusive o numérico", () => {
    expect(desescaparXml("Tarifa &amp; &quot;frete&quot; &lt;m&#237;n&gt;")).toBe(
      'Tarifa & "frete" <mín>',
    );
  });

  it("descomprime a entrada que veio em deflate, como o Excel escreve", async () => {
    /*
      O nosso escritor guarda sem comprimir; toda outra ferramenta comprime. O
      caminho do `deflate` é o que decide se o arquivo que voltou de uma reunião
      abre ou não, então ele é exercitado aqui com uma entrada de verdade —
      comprimida pela API do navegador, e lida de volta pelo leitor.
    */
    const cru = new TextEncoder().encode("<worksheet/>".repeat(40));
    const comprimido = new Uint8Array(
      await new Response(
        new Blob([cru as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw")),
      ).arrayBuffer(),
    );

    const lido = await conteudoDaEntrada({ nome: "x.xml", metodo: 8, dados: comprimido });

    expect(comprimido.length).toBeLessThan(cru.length);
    expect(new TextDecoder().decode(lido)).toBe(new TextDecoder().decode(cru));
  });

  it("volta da referência para o número da coluna", () => {
    expect(colunaDaReferencia("A1")).toBe(0);
    expect(colunaDaReferencia("B12")).toBe(1);
    expect(colunaDaReferencia("AA3")).toBe(26);
  });
});
