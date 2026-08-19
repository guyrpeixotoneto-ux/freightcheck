import * as XLSX from "xlsx";

/**
 * Fixtures sintéticas: os cinco layouts, com números pequenos e conferíveis à
 * mão.
 *
 * São sintéticas de propósito. Os arquivos reais de um fechamento carregam
 * placa, CNPJ, chave de CT-e e matrícula de quem aprovou — dado de cliente, que
 * não entra em repositório. O que os testes precisam guardar não é o dado: é o
 * **layout** (o cabeçalho três linhas abaixo do topo, a data em serial, o CSV
 * em latin-1 com ponto e vírgula, o TXT de largura fixa em duas colunas) e a
 * **aritmética** que liga as cinco fontes.
 *
 * Os valores foram escolhidos para que a igualdade central do fechamento feche
 * exatamente, com um fator de conversão redondo (1,25 = alíquota de 20%):
 *
 * ```
 * CT-e da verba = SRTrans calculado + complementar + requisições × fator
 * ```
 */

/** Serial do Excel para 16/07/2026, a data das fixtures. */
export const SERIAL_16_07_2026 = 46219;
/** O fator que as fixtures usam: 20% de alíquota. */
export const FATOR = 1.25;

function planilha(abas: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [nome, matriz] of Object.entries(abas)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matriz), nome);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/**
 * As colunas do 2Art, na ordem em que o Promax as exporta.
 *
 * A lista está inteira — e não só as que a conta usa — porque é ela que a tela
 * do dia reproduz: o layout **é** o que o teste precisa guardar. Os nomes são
 * os do relatório, colados e sem acento, que é a grafia da exportação direta;
 * `fixtureOperacaoComCabecalhoEspacado` guarda a outra.
 */
const COLUNAS_DO_2ART = [
  "Data", "Transp", "Entrega", "CargaAtual", "Frota", "CustoSpot", "Regiao", "Veiculo", "Placa",
  "VeiculoIndisp", "PlacaIndisp", "FrotaIndisp", "TipoIndisp", "Mapa", "Entregas", "CxCarreg",
  "CxEntreg", "Ocupacao", "CxRota", "CxAS", "VeicBM", "RShow", "EntrVol", "HrSaida", "HrEntrada",
  "KmSaida", "KmEntrada", "CustoVariavel", "Lucro", "LucroUnit", "ValorFrete", "TipoImposto",
  "PercImposto", "ValorImposto", "ValorFaturado", "ValorUnitCxEntregue", "ValorPgCxEntregSemImp",
  "ValorPgCxEntregComImp", "TempoPrevistoRoad", "KmPrevistoRoad", "ValorUnitPontoMot",
  "ValorUnitPontoAjd", "ValorEquipeEntrMot", "ValorEquipeEntrAjd", "CustoVariavelCEDBZ",
  "LucroUnitCEDBZ", "LucroVariavelCxEntregueFFCEDBZ", "TempoInterno", "ValorDropdown", "VeicCadDD",
  "KmLaco", "KmDeslocamento", "TempoLaco", "TempoDeslocamento", "SitMultiCDD", "UnbOrigem",
  "MatricMotorista", "MatricAjudante1", "MatricAjudante2",
];

/** Uma linha do 2Art: o que a viagem declara, e `null` no que ela não traz. */
function viagem(declarado: Record<string, unknown>): unknown[] {
  const desconhecida = Object.keys(declarado).filter((c) => !COLUNAS_DO_2ART.includes(c));
  if (desconhecida.length > 0) {
    throw new Error(`A fixture do 2Art não tem estas colunas: ${desconhecida.join(", ")}`);
  }
  return COLUNAS_DO_2ART.map((coluna) => declarado[coluna] ?? null);
}

/**
 * O 2Art. Cinco viagens da 2ª quinzena e uma da 1ª, mais uma recusa.
 *
 * A primeira linha vem com o **retrato inteiro** — veículo, horários, laço,
 * remuneração da equipe —, porque é ela que prova que a tela do dia recebe a
 * linha completa. As demais trazem só o que a conta usa: coluna ausente tem de
 * continuar ausente, e não virar zero.
 *
 * A linha do canal ilegível está aqui para provar que ela vira recusa nomeada.
 * A do dia `1072026` — sete dígitos, o zero à esquerda que o Excel come em
 * 01/07 — está aqui porque exigir oito recusava a operação dos dias 1 a 9.
 */
export function fixtureOperacao(): Buffer {
  return planilha({
    "2Art_07": [
      COLUNAS_DO_2ART,
      viagem({
        Data: 16072026, Transp: 36, Entrega: "Rota", CargaAtual: "Roteriz", Frota: "Padrao",
        CustoSpot: 0, Regiao: 1, Veiculo: 63, Placa: "AAA1A11", Mapa: "1001",
        Entregas: 10, CxCarreg: 200, CxEntreg: 200, Ocupacao: 55.23, CxRota: 200, CxAS: 0,
        VeicBM: 0.37, RShow: 2, EntrVol: "Entrega",
        HrSaida: "16/07/2026 7:39", HrEntrada: "16/07/2026 17:30", KmSaida: 995, KmEntrada: 1100,
        CustoVariavel: 800, Lucro: 120, LucroUnit: 0.6,
        ValorFrete: 800, TipoImposto: "CTRC-ICMS", PercImposto: 20, ValorImposto: 200,
        ValorFaturado: 1000,
        ValorUnitCxEntregue: 4, ValorPgCxEntregSemImp: 4, ValorPgCxEntregComImp: 5,
        TempoPrevistoRoad: "  9:14", KmPrevistoRoad: 124.87,
        ValorUnitPontoMot: 1.5, ValorUnitPontoAjd: 1.1, ValorEquipeEntrMot: 15,
        ValorEquipeEntrAjd: 11,
        CustoVariavelCEDBZ: 1000, LucroUnitCEDBZ: 0.5,
        LucroVariavelCxEntregueFFCEDBZ: 0.25,
        TempoInterno: "00:37", ValorDropdown: 0, VeicCadDD: "N",
        KmLaco: 19.42, KmDeslocamento: 105.45, TempoLaco: "  5:22", TempoDeslocamento: "  3:52",
        SitMultiCDD: 0, UnbOrigem: 30229,
        MatricMotorista: 450, MatricAjudante1: 5282, MatricAjudante2: 0,
      }),
      viagem({
        Data: 16072026, Transp: 36, Entrega: "Rota", Frota: "Padrao", Placa: "BBB2B22",
        Mapa: "1002", Entregas: 8, CxCarreg: 150, CxEntreg: 140,
        ValorFrete: 400, PercImposto: 20, ValorImposto: 100, ValorFaturado: 500,
      }),
      viagem({
        Data: 16072026, Transp: 36, Entrega: "Entrega?", Frota: "Padrao", Placa: "CCC3C33",
        Mapa: "1003", Entregas: 1, CxCarreg: 10, CxEntreg: 10,
        ValorFrete: 99, PercImposto: 20, ValorImposto: 24.75, ValorFaturado: 123.75,
      }),
      viagem({
        Data: 16072026, Transp: 36, Entrega: "Rota", Frota: "Spot", CustoSpot: 240,
        Placa: "DDD4D44", Mapa: "1004", Entregas: 5, CxCarreg: 100, CxEntreg: 100,
        ValorFrete: 240, PercImposto: 20, ValorImposto: 60, ValorFaturado: 300,
      }),
      viagem({
        Data: 17072026, Transp: 36, Entrega: "AS", Frota: "Padrao", Placa: "EEE5E55",
        Mapa: "2001", Entregas: 3, CxCarreg: 90, CxEntreg: 90,
        ValorFrete: 160, PercImposto: 20, ValorImposto: 40, ValorFaturado: 200,
      }),
      viagem({
        Data: 1072026, Transp: 36, Entrega: "Rota", Frota: "Padrao", Placa: "FFF6F66",
        Mapa: "0101", Entregas: 4, CxCarreg: 80, CxEntreg: 80,
        ValorFrete: 120, PercImposto: 20, ValorImposto: 30, ValorFaturado: 150,
      }),
    ],
  });
}

/**
 * O mesmo 2Art salvo de dentro da pasta de fechamento: cabeçalho com espaços.
 *
 * `CX CARREG` e `VALOR FRETE` são as mesmas colunas que `CxCarreg` e
 * `ValorFrete`, e um leitor que só reconhecesse uma das grafias recusaria o
 * arquivo inteiro — o cabeçalho é procurado por essas colunas.
 */
export function fixtureOperacaoComCabecalhoEspacado(): Buffer {
  const espacado = COLUNAS_DO_2ART.map((c) =>
    c.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase(),
  );
  return planilha({
    "2Art_07": [
      espacado,
      viagem({
        Data: 16072026, Transp: 36, Entrega: "Rota", Frota: "Padrao", Placa: "AAA1A11",
        Mapa: "1001", Entregas: 10, CxCarreg: 200, CxEntreg: 200, Ocupacao: 55.23,
        ValorFrete: 800, PercImposto: 20, ValorImposto: 200, ValorFaturado: 1000,
      }),
    ],
  });
}

/**
 * O 03.08.15. O cabeçalho vem na quarta linha, como na exportação feita de
 * dentro da pasta de fechamento — é o caso que a busca de cabeçalho existe para
 * cobrir.
 */
export function fixtureCtes(): Buffer {
  const cabecalho = ["Transportadora", "Desc Transportadora", "Data", "VBZ", "Desc VBZ", "Nr CT-e", "Sr CT-e", "Nr Documento", "Sr Documento", "Valor CT-e", "Vlr. Frete", "Vlr. ICMS", "Vlr. PIS", "Vlr. COFINS", "Vlr. Imposto", "Nr Controle"];
  const linha = (vbz: number, desc: string, cte: string, doc: string, valor: number) => {
    const frete = Math.round((valor / 1.25) * 100) / 100;
    const imposto = Math.round((valor - frete) * 100) / 100;
    return [36, "TRANSPORTES FICTICIA LTDA", SERIAL_16_07_2026, vbz, desc, cte, 0, doc, 0, valor, frete, imposto, 0, 0, imposto, "'0000"];
  };
  return planilha({
    "03.08.15": [
      [], [], [],
      cabecalho,
      /* Frota Fixa Variável: SRTrans 1.000,00 + complementar 100,00. */
      linha(5, "Rota - Frota Fixa Vari vel", "9001", "8001", 1100),
      /* Freteiro: SRTrans 500,00 + complementar 0 + requisição 200 × 1,25. */
      linha(7, "Rota - Freteiro", "9002", "8002", 750),
      /* Outras Despesas: só requisição — 400 × 1,25. É a régua da alíquota. */
      linha(9, "Rota - Outras Despesas", "9003", "8003", 500),
      /* Fixo: emitido e sem fonte que o sustente. */
      linha(1, "Rota - Frota Fixa Ativa", "9004", "8004", 2000),
      /* AS: só requisição — 80 × 1,25. */
      linha(30, "AS - Outras Despesas", "9005", "8005", 100),
    ],
  });
}

/** O 03.08.18, as duas abas. */
export function fixtureDisponibilidade(): Buffer {
  const cabecalho = ["Cód.Filial", "Nome Filial", "Geografia", "Transportadora", "Data", "Canal", "Frota Total", "Contratada", "Meta Indisp.", "Real 1º Viagem", "Real 2º Viagem", "Gap FF TT", "Gap Cia.", "Gap TP Frota Canc.", "Gap TP Outros Canc.", "Gap TP Frota N.Canc.", "Gap TP Outros N.Canc.", "Desc.Transp.Canc.", "Desc.Transp.N.Canc.", "Desc.FF Custo Fixo", "Desc.FF Equipe", "Desc.FF Indiretos", "% Utilização 1º Viagem", "% Utilização 2º Viagem", "% Utilização Total", "% Disponib.", "Ajudantes Contratados", "Ajudantes Real", "FA Contratado", "FA Real", "Gap FA", "Desconto FA", "Desconto Total", "Frota Disp.", "Freteiro Disp.", "Frota"];
  const dia = (data: number, contratada: number, real: number, gapCia: number, gapTp: number, custoFixo: number, equipe: number, total: number) =>
    [229, "CDD FICTICIO", "GEO NO", "036-TRANSPORTES FICTICIA", data, "Rota", 10, contratada, 0, real, 0, contratada - real, gapCia, 0, 0, gapTp, 0, 0, gapTp, custoFixo, equipe, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, total, 0, 0, "Padrao"];
  return planilha({
    FF: [cabecalho, dia(SERIAL_16_07_2026, 8, 6, 1, 1, 100, 200, 300), dia(SERIAL_16_07_2026 + 1, 8, 8, 0, 0, 0, 0, 0)],
    Van: [cabecalho, dia(SERIAL_16_07_2026, 2, 1, 0, 1, 40, 10, 50)],
  });
}

/**
 * O 03.08.12.09 — CSV com ponto e vírgula, em latin-1.
 *
 * O `Descrição Despesa` com cedilha e til existe para que o teste prove a
 * decodificação: em UTF-8 esses bytes viriam quebrados.
 */
export function fixtureRequisicoes(): Buffer {
  const linhas = [
    "Cod Filial;Nome Filial;Geografia;Requisição;Quinzena Pagamento;Canal;Preço;Segurança;Cod Transportadora;Transportadora;Cod Tipo Despesa;Tipo Despesa;Cod. VBZ;VBZ;Descrição Despesa;Status;Valor;Data Envio Requisição;Hora Envio Requisição;Data Decisão Regional;Hora Decisão Regional;Data Decisão AC;Hora Decisão AC;ID Solicitante;ID Aprovador RG;ID Aprovador AC;Justificativa;Data Decisão CDD;Hora Decisão CDD;ID Aprovador CDD;",
    /* Outras Despesas: 250,00 + 150,00 = 400,00 — a régua do fator. */
    "443;CDD FICTICIO;GEO NO;3001;16/07/2026;Rota;Não;Não;036;TRANSPORTES FICTICIA;013;Incentivo;000009;Rota - Outras Despesas;Incentivo de operação;Aprovada;250,00;27/07/2026;21:21;28/07/2026;15:45;;;00000000001;00000000002;;;;;;",
    "443;CDD FICTICIO;GEO NO;3002;16/07/2026;Rota;Não;Não;036;TRANSPORTES FICTICIA;012;Hora Extra;000009;Rota - Outras Despesas;Hora extra da equipe;Aprovada;150,00;27/07/2026;21:21;28/07/2026;15:45;;;00000000001;00000000002;;;;;;",
    /* Freteiro: 200,00, que soma ao que o SRTrans calculou. */
    "443;CDD FICTICIO;GEO NO;3003;16/07/2026;Rota;Não;Não;036;TRANSPORTES FICTICIA;041;Outras - Freteiro;000007;Rota - Freteiro;Freteiro avulso;Aprovada;200,00;27/07/2026;21:21;28/07/2026;15:45;;;00000000001;00000000002;;;;;;",
    /* AS Outras Despesas: 80,00. */
    "443;CDD FICTICIO;GEO NO;3004;16/07/2026;AS;Não;Não;036;TRANSPORTES FICTICIA;060;Pedágio;000030;AS - Outras Despesas;Pedágio;Aprovada;80,00;27/07/2026;21:21;28/07/2026;15:45;;;00000000001;00000000002;;;;;;",
    /* Reprovada: não entra na conta, e o teste guarda isso. */
    "443;CDD FICTICIO;GEO NO;3005;16/07/2026;Rota;Não;Não;036;TRANSPORTES FICTICIA;013;Incentivo;000009;Rota - Outras Despesas;Incentivo negado;Reprovada;9.999,00;27/07/2026;21:21;28/07/2026;15:45;;;00000000001;00000000002;;;;;;",
  ];
  return Buffer.from(linhas.join("\r\n"), "latin1");
}

/**
 * O 03.02.59.02 — largura fixa, duas colunas de valor.
 *
 * As colunas são montadas com a mesma régua do relatório real: o emitido
 * termina na coluna 75 e o calculado na 88.
 */
export function fixtureConciliacao(): string {
  const emitido = (rotulo: string, marca: string, valor: string) =>
    rotulo.padEnd(61) + marca.padEnd(4) + valor.padStart(10);
  const duas = (rotulo: string, marca: string, a: string, b: string) =>
    rotulo.padEnd(61) + marca.padEnd(4) + a.padStart(10) + "   " + b.padStart(10);
  const soCalculado = (rotulo: string, valor: string) => rotulo.padEnd(79 - valor.length) + valor;

  return [
    "PW02551R-j-Promax Web                        (930 )  Rel. Valores Conciliacao CT-e - Por Nota Fiscal                04/08/2026                              Pag.   1",
    "CRBS SA - CDD Ficticio                                                                                                   16:46",
    "Versao: 12.22.00.04      Rotina: 03.02.59.02.00      Usuario: 00000000001",
    "",
    "Selecao - Data: 16/07/2026 a 31/07/2026",
    "Transportadora:     36 - TRANSPORTES FICTICIA LTDA",
    "Opcao: Sintetico",
    "",
    "                                                     Conciliado     R$ CT-e   R$ SRTrans",
    "                                                                   (Emitido) (Calculado)",
    "RESUMO CT-e ROTA",
    "----------------------------------------------------------------------------------------",
    "RESUMO PENDENCIAS",
    soCalculado("Saldo Quinzenas Anteriores", "300,00"),
    soCalculado("NF-e sem CT-e na Quinzena", "25,00"),
    soCalculado("Saldo Proxima Quinzena", "325,00"),
    "",
    "RESUMO DA QUINZENA ATUAL",
    duas("Frota Fixa", "S", "1.000,00", "1.000,00"),
    duas("Freteiro", "S", "500,00", "500,00"),
    duas("S.Diversos/Comodatos/Eventos", "", "0,00", "0,00"),
    duas("Total Variavel Rota", "S", "1.500,00", "1.500,00"),
    "",
    soCalculado("Desconto Frete Minimo", "200,00"),
    duas("Total Variavel Calculado SRTRANS", "N", "1.500,00", "1.300,00"),
    "",
    "RESUMO PAGAMENTO COMPLEMENTAR VARIAVEL (Alteracao Perfil\\Cancelamento)",
    "(Quinzena Atual)",
    emitido("Frota Fixa", "", "100,00"),
    emitido("Freteiro", "", "0,00"),
    emitido("S. Diversos/Comodatos/Eventos", "", "0,00"),
    emitido("Sub-total Complementar Variavel", "", "100,00"),
    "",
    "RESUMO CT-e AS",
    "----------------------------------------------------------------------------------------",
    "RESUMO DA QUINZENA ATUAL",
    duas("Total Variavel AS", "S", "200,00", "200,00"),
    "",
    duas("Total Variavel Calculado SRTRANS", "N", "200,00", "200,00"),
    "",
    "TOTAL GERAL (ROTA + AS)",
    "----------------------------------------------------------------------------------------",
    soCalculado("Total Variavel Calculado SRTRANS", "1.500,00"),
    emitido("CT-es Recebidos", "", "1.700,00"),
    soCalculado("Saldo Proxima Quinzena", "325,00"),
    "",
    "Encontrado Notas Fiscais sem Vinculo com CT-e.",
    "",
  ].join("\n");
}
