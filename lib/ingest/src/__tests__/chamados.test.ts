import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeParameterMovement,
  detectLayout,
  extractPlaca,
  normalizeStatus,
  pareceMesmoNumeroOutraFormatacao,
  parseTicketDate,
  parseTicketNumber,
  planParameterColumns,
  planTicketColumns,
  readTicketWorkbook,
  splitParameterRole,
} from "../chamados";

/** Um CSV em disco, para exercitar o leitor sem depender de um .xlsx binário. */
function csvTemporario(conteudo: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "chamados-test-"));
  const arquivo = path.join(dir, "chamados.csv");
  writeFileSync(arquivo, conteudo, "utf8");
  return arquivo;
}

/**
 * A leitura de um export de chamados, sem banco nenhum.
 *
 * O que se testa aqui é o único lugar deste caminho onde há julgamento: qual
 * coluna é qual campo, o que é número e o que é texto que *parece* número, e
 * quando um impacto pode ser afirmado. As três decisões são as que, se
 * erradas, produzem um número errado com cara de certo — que é o defeito que
 * este produto existe para não cometer.
 */

describe("planTicketColumns", () => {
  it("liga cada campo à coluna de nome exato antes de tentar aproximação", () => {
    const plan = planTicketColumns([
      "Chamado",
      "Data de abertura",
      "Status",
      "Parâmetro",
      "Valor pedido",
      "Valor aplicado",
    ]);
    expect(plan.bindings.externalId?.header).toBe("Chamado");
    expect(plan.bindings.externalId?.match).toBe("exato");
    expect(plan.bindings.openedAt?.header).toBe("Data de abertura");
    expect(plan.bindings.requestedValueRaw?.header).toBe("Valor pedido");
    expect(plan.bindings.appliedValueRaw?.header).toBe("Valor aplicado");
    expect(plan.unmapped).toEqual([]);
  });

  it("não deixa dois campos disputarem a mesma coluna", () => {
    // Sem a reserva, "Valor pedido pelo transportador" casaria por aproximação
    // com `requestedValueRaw` e com `appliedValueRaw` (que aceita "atendido"),
    // e o segundo campo apontaria para a coluna do primeiro.
    const plan = planTicketColumns([
      "Nº do chamado",
      "Valor pedido pelo transportador",
      "Valor aplicado na vigência",
    ]);
    const usados = Object.values(plan.bindings).map((b) => b.index);
    expect(new Set(usados).size).toBe(usados.length);
    expect(plan.bindings.requestedValueRaw?.header).toBe(
      "Valor pedido pelo transportador",
    );
    expect(plan.bindings.appliedValueRaw?.header).toBe(
      "Valor aplicado na vigência",
    );
  });

  it("prefere o alias mais específico quando dois casam por aproximação", () => {
    const plan = planTicketColumns(["Protocolo", "Valor aplicado (R$)"]);
    expect(plan.bindings.appliedValueRaw?.header).toBe("Valor aplicado (R$)");
    expect(plan.bindings.appliedValueRaw?.reason).toContain("valor aplicado");
  });

  it("reconhece o cabeçalho mais comum de todos: Nº do chamado", () => {
    // O indicador ordinal não é letra acentuada e sobrevive à decomposição:
    // sem tratá-lo, a coluna que mais aparece em export brasileiro seria a
    // única que nenhum nome conhecido casa.
    for (const escrita of ["Nº do chamado", "N° do chamado", "N. do chamado"]) {
      const plan = planTicketColumns([escrita, "Status"]);
      expect(plan.bindings.externalId?.header).toBe(escrita);
      expect(plan.bindings.externalId?.match).toBe("exato");
    }
  });

  it("lista o que não reconheceu em vez de deixá-lo sumir", () => {
    const plan = planTicketColumns(["Chamado", "Centro de custo", "SLA restante"]);
    expect(plan.unmapped).toEqual(["Centro de custo", "SLA restante"]);
  });

  it("escreve por que ligou cada coluna", () => {
    const plan = planTicketColumns(["Chamado", "Data de abertura do chamado"]);
    expect(plan.bindings.openedAt?.match).toBe("aproximado");
    expect(plan.bindings.openedAt?.reason).toContain("contém");
  });
});

describe("readTicketWorkbook", () => {
  it("lê um CSV — a fila do Freightech exporta nesse formato", () => {
    const arquivo = csvTemporario(
      [
        "Chamado,Status,Valor pedido",
        "CH-1,Concluído,1000",
        "CH-2,Aberto,250",
      ].join("\n"),
    );
    const sheet = readTicketWorkbook(arquivo);
    expect(sheet.headers).toEqual(["Chamado", "Status", "Valor pedido"]);
    expect(sheet.rows).toHaveLength(2);
    // A linha física é 1-based e conta o cabeçalho, como uma pessoa contaria.
    expect(sheet.rows[0].rowIndex).toBe(2);
  });

  it("não toma o título do relatório por cabeçalho", () => {
    // O título contém "chamados", e uma busca que aceitasse a primeira linha a
    // mencioná-lo pararia nele: o arquivo inteiro viraria dado sob nomes de
    // coluna que não existem. Uma coluna só nunca é cabeçalho.
    const arquivo = csvTemporario(
      [
        "Relatório de chamados — Freightech",
        "Extraído em 14/08/2026",
        "",
        "Nº do chamado,Status",
        "CH-9,Aberto",
      ].join("\n"),
    );
    const sheet = readTicketWorkbook(arquivo);
    expect(sheet.headers).toEqual(["Nº do chamado", "Status"]);
    expect(sheet.rows).toHaveLength(1);
    // A linha física conta as linhas puladas: o que a tela mostra como
    // "linha N do arquivo" precisa bater com o que se vê ao abri-lo.
    expect(sheet.rows[0].rowIndex).toBe(5);
  });

  it("preserva os acentos de um CSV em UTF-8", () => {
    // Entregue como bytes, o leitor adivinha a codificação e "Parâmetro" chega
    // como "ParÃ¢metro" — e aí a coluna deixa de ser reconhecida.
    const arquivo = csvTemporario("Nº do chamado,Parâmetro\nCH-1,Pedágio");
    const sheet = readTicketWorkbook(arquivo);
    expect(sheet.headers).toEqual(["Nº do chamado", "Parâmetro"]);
    expect(sheet.rows[0].cells[1]).toBe("Pedágio");
  });

  it("não deixa o leitor adivinhar data nem número num CSV", () => {
    /*
      Os dois defeitos que este caso trava, ambos produzindo número errado com
      cara de certo:

      - `01/07/2026` é 1º de julho, e o leitor o converteria para 7 de janeiro
        — enquanto deixaria `20/07/2026` como texto, porque 20 não pode ser
        mês. Metade das datas de um mesmo arquivo trocaria dia por mês.
      - `1.500,50` é mil e quinhentos, e o leitor o lê como um e meio.

      O texto tem de chegar como texto; quem o interpreta é `parseTicketDate` e
      `parseTicketNumber`, que sabem em que país estamos.
    */
    const arquivo = csvTemporario(
      [
        "Nº do chamado,Data de abertura,Valor pedido",
        'CH-1,01/07/2026,"1.500,50"',
      ].join("\n"),
    );
    const sheet = readTicketWorkbook(arquivo);
    expect(sheet.rows[0].cells[1]).toBe("01/07/2026");
    expect(parseTicketDate(sheet.rows[0].cells[1])?.toISOString()).toBe(
      "2026-07-01T00:00:00.000Z",
    );
    expect(parseTicketNumber(sheet.rows[0].cells[2])).toBe(1500.5);
  });

  it("recusa com uma frase útil quando não há coluna de chamado", () => {
    const arquivo = csvTemporario("Placa,Valor\nQYP3G72,100");
    expect(() => readTicketWorkbook(arquivo)).toThrow(
      /coluna do número do chamado/,
    );
  });
});

describe("parseTicketNumber", () => {
  it("lê dinheiro escrito à brasileira", () => {
    expect(parseTicketNumber("R$ 1.234,56")).toBe(1234.56);
    expect(parseTicketNumber("1.234,56")).toBe(1234.56);
    expect(parseTicketNumber("0,5")).toBe(0.5);
  });

  it("lê a forma americana quando os dois separadores aparecem", () => {
    expect(parseTicketNumber("1,234.56")).toBe(1234.56);
    expect(parseTicketNumber("1,234,567.89")).toBe(1234567.89);
  });

  it("trata ponto seguido de três dígitos como milhar", () => {
    // Numa fonte brasileira "1.234" é mil duzentos e trinta e quatro, não um
    // inteiro com três decimais.
    expect(parseTicketNumber("1.234")).toBe(1234);
    expect(parseTicketNumber("12.50")).toBe(12.5);
  });

  it("entende parênteses e sinal como negativo", () => {
    expect(parseTicketNumber("(120,00)")).toBe(-120);
    expect(parseTicketNumber("-42,5")).toBe(-42.5);
  });

  it("recusa o que não é inequivocamente número", () => {
    // O defeito que isto evita: "sob análise" virando 0 e entrando numa soma.
    expect(parseTicketNumber("sob análise")).toBeNull();
    expect(parseTicketNumber("a definir")).toBeNull();
    expect(parseTicketNumber("")).toBeNull();
    expect(parseTicketNumber(null)).toBeNull();
    expect(parseTicketNumber("12 unidades")).toBeNull();
  });

  it("aceita número que já veio número da planilha", () => {
    expect(parseTicketNumber(1234.56)).toBe(1234.56);
    expect(parseTicketNumber(Number.NaN)).toBeNull();
  });
});

describe("parseTicketDate", () => {
  it("lê o formato brasileiro, com e sem hora", () => {
    expect(parseTicketDate("15/03/2026")?.toISOString()).toBe(
      "2026-03-15T00:00:00.000Z",
    );
    expect(parseTicketDate("15/03/2026 14:30")?.toISOString()).toBe(
      "2026-03-15T14:30:00.000Z",
    );
  });

  it("lê ISO", () => {
    expect(parseTicketDate("2026-03-15")?.toISOString()).toBe(
      "2026-03-15T00:00:00.000Z",
    );
  });

  it("devolve null para o que não é data — nunca a data de hoje", () => {
    expect(parseTicketDate("em aberto")).toBeNull();
    expect(parseTicketDate("")).toBeNull();
    expect(parseTicketDate(null)).toBeNull();
  });
});

describe("normalizeStatus", () => {
  it("agrupa as escritas usuais de cada caixa", () => {
    expect(normalizeStatus("Aberto")).toBe("ABERTO");
    expect(normalizeStatus("Em atendimento")).toBe("EM_ANDAMENTO");
    expect(normalizeStatus("Concluído")).toBe("ATENDIDO");
    expect(normalizeStatus("Rejeitado")).toBe("RECUSADO");
    expect(normalizeStatus("Cancelado")).toBe("CANCELADO");
  });

  it("decide a negação antes da palavra que ela nega", () => {
    // "Não atendido" contém "atendido"; sem a ordem certa viraria o oposto.
    expect(normalizeStatus("Não atendido")).toBe("RECUSADO");
    expect(normalizeStatus("Nao aprovado")).toBe("RECUSADO");
  });

  it("não inventa caixa para o que não reconhece", () => {
    expect(normalizeStatus("Etapa 7")).toBe("DESCONHECIDO");
    expect(normalizeStatus(null)).toBe("DESCONHECIDO");
    expect(normalizeStatus("")).toBe("DESCONHECIDO");
  });
});

/**
 * O export real do Freightech, coluna por coluna.
 *
 * Estes nomes não são inventados: são os 26 cabeçalhos de
 * `Chamados_<unidade>.xlsx`, aba `<mês>_EXPORTACAO_HISTORICO`. Ficam aqui
 * porque foi a distância entre eles e os nomes que este leitor supunha que
 * fez a primeira importação de verdade ser recusada inteira.
 */
const CABECALHO_REAL = [
  "B.O",
  "Segmento",
  "Unidade",
  "Operador",
  "Data Solicitação",
  "SLA",
  "Item",
  "Operação",
  "Status",
  "Campo Alteração",
  "Valor Antigo",
  "Valor Solicitado",
  "Solicitante",
  "Aprovador",
  "Data Alteração",
  "Justificativa Abertura",
  "Observação Aprovação/Reprovação",
  "Categoria",
  "Vig. Abertura",
  "Previsão Análise",
  "Vig. Aplicação",
  "Vig. Sugestão",
  "Alt. Ambev",
  "Evidência Reprovada",
  "ID alteração lote",
  "Data Aprovação",
];

describe("o export real do Freightech", () => {
  it("é lido como formato estreito", () => {
    expect(detectLayout(CABECALHO_REAL)).toBe("NARROW");
  });

  it("liga todos os campos que importam, e por igualdade", () => {
    // Nenhum destes pode depender de aproximação: se um deles passar a casar
    // por conter uma palavra, o próximo export com uma coluna parecida rouba
    // a ligação sem que nada estoure.
    const plan = planTicketColumns(CABECALHO_REAL);
    const esperado: Record<string, string> = {
      externalId: "B.O",
      openedAt: "Data Solicitação",
      closedAt: "Data Aprovação",
      statusRaw: "Status",
      changeKind: "Operação",
      vigenciaLabel: "Vig. Abertura",
      parameterLabel: "Campo Alteração",
      entityDescription: "Item",
      valueBeforeRaw: "Valor Antigo",
      requestedValueRaw: "Valor Solicitado",
      requestedBy: "Solicitante",
      subject: "Justificativa Abertura",
      /*
        Os oito que a `0087` promoveu de `payload` para coluna. Estavam gravados
        desde sempre — `payload` guarda a linha inteira —, e sem serem coluna o
        Monitoramento de Chamados não conseguia filtrar por unidade, dizer "o
        responsável mudou", nem agrupar o dia por unidade.
      */
      unidadeRaw: "Unidade",
      segmentoRaw: "Segmento",
      operadorRaw: "Operador",
      aprovadorRaw: "Aprovador",
      slaRaw: "SLA",
      categoriaRaw: "Categoria",
      prazoPrevisto: "Previsão Análise",
      alteradoEmFonte: "Data Alteração",
    };
    for (const [campo, header] of Object.entries(esperado)) {
      const ligacao = plan.bindings[campo as keyof typeof plan.bindings];
      expect(ligacao?.header, `campo ${campo}`).toBe(header);
      expect(ligacao?.match, `campo ${campo}`).toBe("exato");
    }
  });

  /*
    As três datas deste domínio são três perguntas, e o export as traz em três
    colunas. Confundi-las é o defeito que o Monitoramento existe para não
    cometer — e o lugar onde ele começaria é aqui, num alias que roubasse a
    coluna do vizinho.
  */
  it("as três datas não se roubam", () => {
    const plan = planTicketColumns(CABECALHO_REAL);
    expect(plan.bindings.openedAt?.header).toBe("Data Solicitação");
    expect(plan.bindings.alteradoEmFonte?.header).toBe("Data Alteração");
    expect(plan.bindings.closedAt?.header).toBe("Data Aprovação");
  });

  /*
    `Solicitante` e `Aprovador` são pessoas diferentes: quem abriu e quem
    decide. O Monitoramento chama a segunda de Responsável, e mostra as duas.
    `requestedBy` aceita "responsavel" entre os aliases dele e vem antes na
    ordem de disputa — se `aprovadorRaw` também o aceitasse, o alias nunca
    casaria e prometeria um comportamento que o código não tem.
  */
  it("solicitante e aprovador continuam sendo duas colunas", () => {
    const plan = planTicketColumns(CABECALHO_REAL);
    expect(plan.bindings.requestedBy?.header).toBe("Solicitante");
    expect(plan.bindings.aprovadorRaw?.header).toBe("Aprovador");
  });

  it("reconhece B.O como o número do chamado", () => {
    // A coluna que faltava. Sem ela o arquivo inteiro era recusado com "não
    // achei a coluna do número do chamado" — foi a primeira importação real.
    for (const escrita of ["B.O", "B. O.", "BO"]) {
      const plan = planTicketColumns([escrita, "Campo Alteração"]);
      expect(plan.bindings.externalId?.header).toBe(escrita);
    }
  });
});

describe("extractPlaca", () => {
  it("acha a placa dentro da descrição composta do item", () => {
    expect(extractPlaca("Placa: QYW2D78 | Placa Carreta: QYW4C69")).toBe("QYW2D78");
  });

  it("fica com a primeira placa — a do ativo, não a do implemento", () => {
    // Casar com a segunda atribuiria a alteração ao reboque em vez do cavalo.
    expect(extractPlaca("Placa: ABC1D23 | Placa Carreta: XYZ9W88")).toBe("ABC1D23");
  });

  it("não inventa placa onde o item descreve outra coisa", () => {
    expect(
      extractPlaca("Cargo: Manobrista | Classificação: CARREGAMENTO | Quantidade: 10.0"),
    ).toBeNull();
    expect(extractPlaca(null)).toBeNull();
  });
});

describe("pareceMesmoNumeroOutraFormatacao", () => {
  it("pega a quantia escrita de dois jeitos", () => {
    /*
      Os casos são do arquivo real: `Valor Antigo` chega como 255873333 e
      `Valor Solicitado` como "255.87" — o mesmo 255,873333 com o separador
      decimal perdido de um dos lados. Subtraídos, davam −255 milhões, e a
      soma da tela ia a −2,7 bilhões.
    */
    expect(pareceMesmoNumeroOutraFormatacao(255873333, 255.87)).toBe(true);
    expect(pareceMesmoNumeroOutraFormatacao(383841386, 383.84)).toBe(true);
    expect(pareceMesmoNumeroOutraFormatacao(171251578, 171.25)).toBe(true);
    expect(pareceMesmoNumeroOutraFormatacao(9946842, 99.47)).toBe(true);
  });

  it("não confunde uma variação grande de verdade com artefato", () => {
    // Estes são do mesmo arquivo, e são alterações reais: têm de passar.
    expect(pareceMesmoNumeroOutraFormatacao(779.06, 654.8)).toBe(false);
    expect(pareceMesmoNumeroOutraFormatacao(10, 17)).toBe(false);
    expect(pareceMesmoNumeroOutraFormatacao(3.0, 3.09)).toBe(false);
    // Mil vezes maior, mas não os mesmos algarismos: variação real.
    expect(pareceMesmoNumeroOutraFormatacao(1000, 1.5)).toBe(false);
    expect(pareceMesmoNumeroOutraFormatacao(0, 500)).toBe(false);
  });
});

describe("detectLayout", () => {
  it("é estreito quando existe uma coluna Parâmetro", () => {
    expect(detectLayout(["Nº do chamado", "Parâmetro", "Valor pedido"])).toBe(
      "NARROW",
    );
    expect(detectLayout(["Chamado", "Atributo", "Valor aplicado"])).toBe("NARROW");
  });

  it("é largo quando os parâmetros estão nos cabeçalhos", () => {
    expect(detectLayout(["Nº do chamado", "Pedágio", "pneuMensal"])).toBe("WIDE");
  });

  it("não vira estreito por causa de um parâmetro que contém uma palavra conhecida", () => {
    /*
      O defeito real que este caso trava. Num export largo de verdade existe a
      coluna "Custo Variável Simulado", que *contém* "variável" — um dos nomes
      conhecidos da coluna `Parâmetro`. Por aproximação ela era tomada por
      aquele campo, o arquivo inteiro passava a ser lido como estreito, e o
      resultado não era um erro: era zero alteração, em silêncio, num arquivo
      cheio delas.
    */
    expect(
      detectLayout(["Nº do chamado", "Custo Variável Simulado", "Spread BNDES"]),
    ).toBe("WIDE");
    expect(detectLayout(["Chamado", "Campo de atuação", "Item de frota"])).toBe(
      "WIDE",
    );
  });
});

describe("planTicketColumns com régua de cobertura", () => {
  const largo = { minCoverage: 0.5 };

  it("não deixa um alias curto reclamar um cabeçalho comprido", () => {
    const plan = planTicketColumns(
      ["Nº do chamado", "Custo Variável Simulado"],
      largo,
    );
    expect(plan.bindings.parameterLabel).toBeUndefined();
    expect(plan.unmapped).toContain("Custo Variável Simulado");
  });

  it("continua aceitando a aproximação que cobre metade do cabeçalho", () => {
    const plan = planTicketColumns(
      ["Nº do chamado", "Data de abertura do chamado"],
      largo,
    );
    expect(plan.bindings.openedAt?.header).toBe("Data de abertura do chamado");
  });

  it("sem régua, a aproximação frouxa continua valendo — é o formato estreito", () => {
    const plan = planTicketColumns([
      "Nº do chamado",
      "Valor pedido pelo transportador",
    ]);
    expect(plan.bindings.requestedValueRaw?.header).toBe(
      "Valor pedido pelo transportador",
    );
  });
});

describe("splitParameterRole", () => {
  it("separa o marcador de lado do nome do parâmetro", () => {
    expect(splitParameterRole("Pedágio (antes)")).toEqual({
      base: "pedagio",
      role: "antes",
    });
    expect(splitParameterRole("Pedágio - Novo")).toEqual({
      base: "pedagio",
      role: "depois",
    });
    expect(splitParameterRole("Valor anterior Pneu")).toEqual({
      base: "valor pneu",
      role: "antes",
    });
  });

  it("só casa palavra inteira", () => {
    // "novo" dentro de "Renovação" não é marcador de lado nenhum.
    expect(splitParameterRole("Renovação de frota").role).toBeNull();
  });

  it("não trata um cabeçalho sem parâmetro como lado de coisa alguma", () => {
    expect(splitParameterRole("Anterior").role).toBeNull();
  });

  it("deixa de fora os marcadores ambíguos", () => {
    // "de" e "para" seriam os mais naturais em português, e é por isso que
    // estão fora: "Valor de pedágio" viraria o lado anterior de um parâmetro
    // chamado "Valor pedágio", e o engano pareceria um par bem formado.
    expect(splitParameterRole("Valor de pedágio").role).toBeNull();
    expect(splitParameterRole("Ajuste para pedágio").role).toBeNull();
  });
});

describe("planParameterColumns", () => {
  const semCampos = {};

  it("trata toda coluna não reconhecida como parâmetro no formato largo", () => {
    const headers = ["Pedágio", "Pneu", "Finame"];
    const colunas = planParameterColumns(headers, semCampos);
    expect(colunas.map((c) => c.label)).toEqual(["Pedágio", "Pneu", "Finame"]);
    expect(colunas.every((c) => c.beforeIndex === null)).toBe(true);
  });

  it("junta as duas pontas de um mesmo parâmetro num par só", () => {
    const headers = ["Pedágio (antes)", "Pedágio (novo)", "Pneu"];
    const colunas = planParameterColumns(headers, semCampos);
    expect(colunas).toHaveLength(2);
    const par = colunas.find((c) => c.label === "pedagio");
    expect(par?.beforeIndex).toBe(0);
    expect(par?.afterIndex).toBe(1);
    expect(par?.beforeHeader).toBe("Pedágio (antes)");
  });

  it("não desmonta um cabeçalho quando a outra ponta não existe", () => {
    // Sem o par não há como saber se "novo" era marcador de lado ou parte do
    // nome — e apagar a palavra por conta própria renomearia um parâmetro do
    // cliente.
    const colunas = planParameterColumns(["Pedágio (novo)", "Pneu"], semCampos);
    expect(colunas.map((c) => c.label)).toEqual(["Pedágio (novo)", "Pneu"]);
    expect(colunas[0].beforeIndex).toBeNull();
  });

  it("não toma as colunas do chamado por parâmetro", () => {
    const headers = ["Nº do chamado", "Status", "Pedágio"];
    const plan = planTicketColumns(headers);
    const colunas = planParameterColumns(headers, plan.bindings);
    expect(colunas.map((c) => c.label)).toEqual(["Pedágio"]);
  });
});

describe("computeParameterMovement", () => {
  it("apura variação e impacto quando o chamado já foi atendido", () => {
    const m = computeParameterMovement(1000, 800, "ATENDIDO", "1000", "800", "ARQUIVO");
    expect(m.deltaAbsolute).toBe(-200);
    expect(m.deltaPercent).toBe(-20);
    expect(m.impactConfidence).toBe("CALCULATED");
    expect(m.impactAmount).toBe(-200);
  });

  it("mostra a variação mas segura o impacto enquanto o chamado corre", () => {
    // A distinção que faz esta tela servir para chamado aberto: a variação é
    // aritmética e vale já; o impacto é afirmação sobre dinheiro que mudou de
    // mãos, e essa ainda não pode ser feita.
    const m = computeParameterMovement(1000, 800, "EM_ANDAMENTO", "1000", "800", "ARQUIVO");
    expect(m.deltaAbsolute).toBe(-200);
    expect(m.impactAmount).toBeNull();
    expect(m.impactConfidence).toBe("NOT_CALCULABLE");
    expect(m.impactReason).toMatch(/ainda não foi atendido/);
  });

  it("explica a ausência de antes pela procedência que faltou", () => {
    const m = computeParameterMovement(null, 800, "ATENDIDO", null, "800", "AUSENTE");
    expect(m.impactReason).toMatch(/vigência em vigor não tem este parâmetro/);
  });

  it("descreve a alteração de texto em vez de reclamar que não é número", () => {
    // `ativo` vai de "ATIVO" para "PARADO" e `dataFimContrato` de uma data
    // para outra. São alterações de verdade; dizer só "não é um número"
    // descreveria a nossa limitação em vez do que o chamado fez.
    const m = computeParameterMovement(
      null,
      null,
      "ATENDIDO",
      "ATIVO",
      "PARADO",
      "ARQUIVO",
      "SET",
    );
    expect(m.impactConfidence).toBe("NOT_CALCULABLE");
    expect(m.impactReason).toContain('mudou de "ATIVO" para "PARADO"');
    expect(m.impactReason).toMatch(/alteração de texto/);
  });

  it("recusa a apuração quando os dois lados são a mesma quantia mal formatada", () => {
    // Sem isto, os 17 casos assim do arquivo real somavam −2,7 bilhões no
    // cartão de impacto. Os dois valores continuam à vista; o que não existe
    // é o número inventado entre eles.
    const m = computeParameterMovement(
      255873333,
      255.87,
      "ATENDIDO",
      "255873333",
      "255.87",
      "ARQUIVO",
      "SET",
    );
    expect(m.impactConfidence).toBe("NOT_CALCULABLE");
    expect(m.deltaAbsolute).toBeNull();
    expect(m.impactReason).toMatch(/separador decimal/);
  });

  it("explica a alteração que não é sobre valor nenhum", () => {
    // 85% de um export real. Sem motivo escrito, a tabela inteira pareceria
    // uma tela que perdeu os números.
    const m = computeParameterMovement(
      null,
      null,
      "ATENDIDO",
      null,
      null,
      "AUSENTE",
      "FORM_THIS",
    );
    expect(m.impactConfidence).toBe("NOT_CALCULABLE");
    expect(m.impactReason).toMatch(/trocou a fórmula/);

    const add = computeParameterMovement(
      null, null, "ATENDIDO", null, null, "AUSENTE", "ADD",
    );
    expect(add.impactReason).toMatch(/incluiu este item/);
  });

  it("apura zero como zero — atendido pelo valor que já valia é um fato", () => {
    const m = computeParameterMovement(500, 500, "ATENDIDO", "500", "500", "VIGENCIA");
    expect(m.impactConfidence).toBe("CALCULATED");
    expect(m.impactAmount).toBe(0);
  });

  it("não divide por zero para inventar um percentual", () => {
    // Sair de zero é informação real, e quem a dá são os próprios valores —
    // não um ∞ na coluna de variação.
    const m = computeParameterMovement(0, 300, "ATENDIDO", "0", "300", "VIGENCIA");
    expect(m.deltaAbsolute).toBe(300);
    expect(m.deltaPercent).toBeNull();
  });

  it("diz que a diferença é contra a vigência quando o antes veio de lá", () => {
    const m = computeParameterMovement(900, 1000, "ATENDIDO", "900", "1000", "VIGENCIA");
    expect(m.impactReason).toMatch(/vigência em vigor/);
  });
});
