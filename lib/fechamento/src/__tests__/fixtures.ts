import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as XLSX from "xlsx";

/**
 * Fixtures sintéticas: os seis layouts, com números pequenos e conferíveis à
 * mão.
 *
 * São sintéticas de propósito. Os arquivos reais de um fechamento carregam
 * placa, CNPJ, chave de CT-e e matrícula de quem aprovou — dado de cliente, que
 * não entra em repositório. O que os testes precisam guardar não é o dado: é o
 * **layout** (o cabeçalho três linhas abaixo do topo, a data em serial, o CSV
 * em latin-1 com ponto e vírgula, o TXT de largura fixa em duas colunas) e a
 * **aritmética** que liga as seis fontes.
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
 * O 03.08.18 do **mês inteiro** — a exportação que atravessa as duas quinzenas.
 *
 * É o formato real: a exportação da 2ª quinzena costuma vir com o mês todo, e a
 * da 1ª às vezes também. Anexar este mesmo arquivo nas duas competências é o
 * que o produto tem de tolerar sem dobrar o desconto — e é o que
 * `disponibilidadeDoMes` resolve cortando cada competência pelo seu período.
 *
 * `10/07` cai na 1ª quinzena e `20/07` na 2ª. Os totais das duas metades são
 * diferentes de propósito: com números iguais, um corte trocado passaria
 * despercebido.
 */
export function fixtureDisponibilidadeDoMesInteiro(): Buffer {
  const cabecalho = ["Cód.Filial", "Nome Filial", "Geografia", "Transportadora", "Data", "Canal", "Frota Total", "Contratada", "Meta Indisp.", "Real 1º Viagem", "Real 2º Viagem", "Gap FF TT", "Gap Cia.", "Gap TP Frota Canc.", "Gap TP Outros Canc.", "Gap TP Frota N.Canc.", "Gap TP Outros N.Canc.", "Desc.Transp.Canc.", "Desc.Transp.N.Canc.", "Desc.FF Custo Fixo", "Desc.FF Equipe", "Desc.FF Indiretos", "% Utilização 1º Viagem", "% Utilização 2º Viagem", "% Utilização Total", "% Disponib.", "Ajudantes Contratados", "Ajudantes Real", "FA Contratado", "FA Real", "Gap FA", "Desconto FA", "Desconto Total", "Frota Disp.", "Freteiro Disp.", "Frota"];
  const dia = (data: number, custoFixo: number, equipe: number, total: number) =>
    [229, "CDD FICTICIO", "GEO NO", "036-TRANSPORTES FICTICIA", data, "Rota", 10, 8, 0, 6, 0, 2, 1, 0, 0, 1, 0, 0, 1, custoFixo, equipe, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, total, 0, 0, "Padrao"];
  return planilha({
    /* 10/07 — 1ª quinzena; 20/07 — 2ª. Ver `SERIAL_16_07_2026`. */
    FF: [cabecalho, dia(SERIAL_16_07_2026 - 6, 100, 200, 300), dia(SERIAL_16_07_2026 + 4, 30, 70, 100)],
    Van: [cabecalho, dia(SERIAL_16_07_2026 - 6, 40, 10, 50), dia(SERIAL_16_07_2026 + 4, 5, 2, 7)],
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

/**
 * O 03.08.20 — o demonstrativo de pagamento, em largura fixa e latin-1.
 *
 * Os números conversam com os do 03.08.15 de propósito, e de três jeitos
 * diferentes, porque são os três desfechos que a apuração precisa distinguir:
 *
 * - **VBZ 01** (fixo) traz 2.000,00 na coluna CTRC-ICMS, que é exatamente o que
 *   o CT-e emitiu. É a linha que faz o "sem fonte" de 2.000,00 virar zero — o
 *   motivo de esta fonte existir.
 * - **VBZ 05** (variável) traz 1.000,00 contra os 1.100,00 emitidos. Não vira
 *   parcela (a verba já é reconstruída pela conciliação e pelas requisições);
 *   vira divergência de 100,00.
 * - **VBZ 09** (complementar) traz 500,00, igual ao emitido: concordância, e
 *   portanto silêncio.
 *
 * O cabeçalho declara `Periodo: 16/07/2026 a 31/07/2026`, que é o que permite
 * recusar o arquivo aberto na competência de outro mês. Os acentos de
 * `Remuneração` e `mínimo` estão aqui para provar a decodificação latin-1.
 */
export function fixturePagamento(): Buffer {
  const regua = "-".repeat(130);
  const colunas = [
    "VBZ                                             S/Imposto         NF-ISS       CTRC-ICMS          Valor     Valor VLC    Valor VLC",
    "                                                                   0,00%         100,00%       Faturado        NF-ISS    CTRC-ICMS",
  ];
  const item = (rotulo: string, sem: string, ctrc: string, vlc: string) =>
    [`${rotulo.padEnd(45)}${sem.padStart(9)}${"0,00".padStart(15)}${ctrc.padStart(16)}${ctrc.padStart(15)}${"0,00".padStart(14)}${vlc.padStart(13)}`,
     "      (71027001 BRALLLV234)", ""];

  const linhas = [
    "PW02581R-  -p-Promax Web          (050 )  Remuneracao de Transportadoras   *** Pagamento ***     01/08/2026    Pag.   1",
    "CDD FICTICIO                             Periodo: 16/07/2026 a 31/07/2026                             15:37",
    "Versao: 12.22.00.04      Rotina: 03.08.20.00.00      Usuario: 00099783515",
    "",
    "Transportadora  36 TRANSPORTES FICTICIA LTDA",
    "",
    "Entregas para 081-0443 - CDD FICTICIO",
    "",
    "ROTA",
    "",
    "FRETE",
    regua,
    ...colunas,
    ...item(" 01 - Frota Fixa Ativa", "1.600,00", "2.000,00", "1.800,00"),
    ...item(" 05 - Frota Fixa Variavel", "800,00", "1.000,00", "900,00"),
    "",
    "Total Frete                                      2.400,00           0,00        3.000,00       3.000,00         0,00     2.700,00",
    "",
    "",
    "DESCONTO DEVOLUCAO",
    regua,
    "Valor S/Imposto (Todas VBZ's exceto Rem. Var. Equipe Ent. e despesas de Outros Custos)         2.400,00",
    "% Dev. Resp. Transportadora                                                                        1,50 %",
    "Desconto Devolucao                                                                                36,00",
    "*Desconto Liquido Devolucao ja subtraido da VBZ Frota Fixa Ativa",
    "",
    "DESCONTO DISPONIBILIDADE",
    regua,
    "Desconto FF - Custo Fixo (Desconto Liquido ja subtraido da VBZ 01 - Frota Fixa Ativa)            100,00",
    "Desconto FF - Equipe Entrega (Desconto Liquido ja subtraido da VBZ 02 - Equipe Entrega)          200,00",
    "Desconto FF - Custo Indireto (Desconto Liquido ja subtraido da VBZ 03 - Despesas Adm.)             0,00",
    "Desconto FF - Fator Ajudante (Desconto Liquido ja subtraido da VBZ 02 - Equipe Entrega)            0,00",
    "",
    "DESCONTO FRETE MINIMO",
    regua,
    "Desconto Frete m\u00ednimo (Desconto L\u00edquido j\u00e1 subtra\u00eddo das VBZs de custo Fixo coluna ICMS)          50,00",
    "",
    "OUTROS CUSTOS",
    regua,
    ...colunas,
    ...item(" 09 - Rota - Outras Despesas", "400,00", "500,00", "450,00"),
    "",
    "Total Outros Custos                                400,00           0,00          500,00         500,00         0,00       450,00",
    "",
    regua,
    "Total Remunera\u00e7\u00e3o                                                                              3.500,00",
    "",
    "     Para efeito do calculo de remuneracao a ser paga a transportadora",
    "     declaramos estar de acordo com os valores acima.",
  ];
  return Buffer.from(linhas.join("\r\n"), "latin1");
}

/**
 * Um 03.08.20 com o painel da Rota inteiro — o material do de-para.
 *
 * `fixturePagamento` é deliberadamente magra: três verbas, o bastante para
 * provar que o fixo passa a ter fonte. O de-para precisa do contrário — de um
 * arquivo em que **todas** as figuras do painel existam ao mesmo tempo, porque
 * o que ele afirma é uma identidade entre quadros, e identidade não se prova
 * com um termo só.
 *
 * Os números são redondos e escolhidos para que a conta possa ser conferida a
 * olho:
 *
 * ```
 * FRETE          fixo/adm  01+02+03+04 = 200.000,00   (já líquidos)
 *                variável     05 + 07  = 120.000,00
 *                complementar      06  =   5.000,00
 * OUTROS CUSTOS               09 + 07  =  15.000,00
 * ```
 *
 * E os descontos, todos com a frase de origem que o relatório escreve:
 * devolução de 4.875,00 (1,50% sobre 325.000,00, saída da VBZ 01), 3.800,00 de
 * disponibilidade repartidos entre as VBZs 01, 02 e 03, e 700,00 de frete
 * mínimo — o único cujo rótulo não nomeia VBZ nenhuma.
 *
 * Com esse material, o quadro do fixo fecha em zero, o do variável sobra
 * exatamente a VBZ 06 — que o painel da planilha não nomeia — e o de outros
 * custos fecha em zero. É a conta que o teste do de-para verifica.
 */
export function fixturePagamentoDoPainel(): Buffer {
  const regua = "-".repeat(130);
  const colunas = [
    "VBZ                                             S/Imposto         NF-ISS       CTRC-ICMS          Valor     Valor VLC    Valor VLC",
    "                                                                   0,00%         100,00%       Faturado        NF-ISS    CTRC-ICMS",
  ];
  /* As seis colunas na ordem do relatório; só a primeira interessa ao de-para. */
  const item = (rotulo: string, sem: string) => [
    `${rotulo.padEnd(45)}${sem.padStart(12)}${"0,00".padStart(15)}${sem.padStart(16)}${sem.padStart(15)}${"0,00".padStart(14)}${sem.padStart(13)}`,
    "      (71027001 BRALLLV234)",
    "",
  ];
  const desconto = (rotulo: string, valor: string) => `${rotulo.padEnd(100)}${valor.padStart(12)}`;

  const linhas = [
    "PW02581R-  -p-Promax Web          (050 )  Remuneracao de Transportadoras   *** Pagamento ***     01/08/2026    Pag.   1",
    "CDD FICTICIO                             Periodo: 16/07/2026 a 31/07/2026                             15:37",
    "Versao: 12.22.00.04      Rotina: 03.08.20.00.00      Usuario: 00099783515",
    "",
    "Transportadora  36 TRANSPORTES FICTICIA LTDA",
    "",
    "Entregas para 081-0443 - CDD FICTICIO",
    "",
    "ROTA",
    "",
    "FRETE",
    regua,
    ...colunas,
    ...item(" 01 - Frota Fixa Ativa", "100.000,00"),
    ...item(" 02 - Equipe Entrega Ativa", "60.000,00"),
    ...item(" 03 - Despesa Administrativa", "30.000,00"),
    ...item(" 04 - Frota Fixa Inativa", "10.000,00"),
    ...item(" 05 - Frota Fixa Variavel", "80.000,00"),
    ...item(" 06 - Rem. Variavel Equipe Entrega", "5.000,00"),
    ...item(" 07 - Freteiro", "40.000,00"),
    "",
    "Total Frete                                    325.000,00           0,00      325.000,00     325.000,00         0,00   325.000,00",
    "",
    "",
    "DESCONTO DEVOLUCAO",
    regua,
    desconto(
      "Valor S/Imposto (Todas VBZ's exceto Rem. Var. Equipe Ent. e despesas de Outros Custos)",
      "325.000,00",
    ),
    desconto("% Dev. Resp. Transportadora", "1,50 %"),
    desconto("Desconto Devolucao", "4.875,00"),
    "*Desconto Liquido Devolucao ja subtraido da VBZ Frota Fixa Ativa",
    "",
    "DESCONTO DISPONIBILIDADE",
    regua,
    desconto("Desconto FF - Custo Fixo (Desconto Liquido ja subtraido da VBZ 01 - Frota Fixa Ativa)", "1.000,00"),
    desconto("Desconto FF - Equipe Entrega (Desconto Liquido ja subtraido da VBZ 02 - Equipe Entrega)", "2.000,00"),
    desconto("Desconto FF - Custo Indireto (Desconto Liquido ja subtraido da VBZ 03 - Despesas Adm.)", "500,00"),
    desconto("Desconto FF - Fator Ajudante (Desconto Liquido ja subtraido da VBZ 02 - Equipe Entrega)", "300,00"),
    "",
    "DESCONTO FRETE MINIMO",
    regua,
    desconto(
      "Desconto Frete mínimo (Desconto Líquido já subtraído das VBZs de custo Fixo coluna ICMS)",
      "700,00",
    ),
    "",
    "OUTROS CUSTOS",
    regua,
    ...colunas,
    ...item(" 07 - Rota - Freteiro", "3.000,00"),
    ...item(" 09 - Rota - Outras Despesas", "12.000,00"),
    "",
    "Total Outros Custos                             15.000,00           0,00       15.000,00      15.000,00         0,00    15.000,00",
    "",
    regua,
    "Total Remuneração                                                                            340.000,00",
    "",
    "     Para efeito do calculo de remuneracao a ser paga a transportadora",
    "     declaramos estar de acordo com os valores acima.",
  ];
  return Buffer.from(linhas.join("\r\n"), "latin1");
}

/* ==========================================================================
   As mesmas seis fontes, nos outros formatos em que elas chegam.

   O que estas fixtures guardam não é um dado novo: é **o mesmo dado**, escrito
   como o outro exportador o escreve. É por isso que os testes de formato
   comparam leitura contra leitura em vez de contra números literais — o que
   precisa ficar provado é que o formato não muda a conta, e um número copiado
   nos dois lados provaria só que alguém copiou certo.
   ========================================================================== */

/**
 * Um número como as fontes brasileiras o escrevem: `1.100,00`.
 *
 * Escrito à mão em vez de por `toLocaleString` porque o separador de milhar
 * que o ICU escolhe depende de como o Node foi compilado, e uma fixture que
 * muda de forma conforme o ambiente não guarda layout nenhum.
 */
export function emPtBr(valor: number): string {
  const negativo = valor < 0;
  const centavos = Math.round(Math.abs(valor) * 100);
  const inteiro = String(Math.floor(centavos / 100));
  const decimais = String(centavos % 100).padStart(2, "0");
  const comMilhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}${comMilhar},${decimais}`;
}

/** Uma matriz escrita como CSV de ponto e vírgula em latin-1, como o SRTrans. */
function csv(matriz: (string | number | null)[][], opcoes?: { bom?: boolean }): Buffer {
  const texto = matriz
    .map((linha) => linha.map((c) => (c == null ? "" : String(c))).join(";"))
    .join("\r\n");
  if (opcoes?.bom) {
    /* O que o Excel grava em "CSV UTF-8": a BOM na frente e o texto em UTF-8. */
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(texto, "utf8")]);
  }
  return Buffer.from(texto, "latin1");
}

/** As linhas do 03.08.15, em valores — a mesma aritmética das duas fixtures. */
const CTES: { vbz: number; desc: string; cte: string; doc: string; valor: number }[] = [
  { vbz: 5, desc: "Rota - Frota Fixa Vari vel", cte: "9001", doc: "8001", valor: 1100 },
  { vbz: 7, desc: "Rota - Freteiro", cte: "9002", doc: "8002", valor: 750 },
  { vbz: 9, desc: "Rota - Outras Despesas", cte: "9003", doc: "8003", valor: 500 },
  { vbz: 1, desc: "Rota - Frota Fixa Ativa", cte: "9004", doc: "8004", valor: 2000 },
  { vbz: 30, desc: "AS - Outras Despesas", cte: "9005", doc: "8005", valor: 100 },
];

const CABECALHO_DO_0308_15 = [
  "Transportadora", "Desc Transportadora", "Data", "VBZ", "Desc VBZ", "Nr CT-e", "Sr CT-e",
  "Nr Documento", "Sr Documento", "Valor CT-e", "Vlr. Frete", "Vlr. ICMS", "Vlr. PIS",
  "Vlr. COFINS", "Vlr. Imposto", "Nr Controle",
];

/**
 * O 03.08.15 em CSV — o mesmo relatório da `fixtureCtes`, no outro formato.
 *
 * Três diferenças com a planilha, e todas são do exportador e não do teste:
 * a data vem em `dd/mm/aaaa` (num CSV não existe serial), o dinheiro vem em
 * `1.100,00` (num CSV não existe número nativo) e as três linhas em branco de
 * antes do cabeçalho viram três linhas de ponto e vírgula. As três precisam
 * atravessar o leitor e sair no mesmo lugar.
 */
export function fixtureCtesEmCsv(opcoes?: { bom?: boolean }): Buffer {
  const linha = ({ vbz, desc, cte, doc, valor }: (typeof CTES)[number]) => {
    const frete = Math.round((valor / FATOR) * 100) / 100;
    const imposto = Math.round((valor - frete) * 100) / 100;
    return [
      "36", "TRANSPORTES FICTICIA LTDA", "16/07/2026", String(vbz), desc, cte, "0", doc, "0",
      emPtBr(valor), emPtBr(frete), emPtBr(imposto), "0,00", "0,00", emPtBr(imposto), "'0000",
    ];
  };
  const vazia = CABECALHO_DO_0308_15.map(() => "");
  return csv([vazia, vazia, vazia, CABECALHO_DO_0308_15, ...CTES.map(linha)], opcoes);
}

/**
 * O 2Art em CSV, com a data em `dd/mm/aaaa`.
 *
 * São as **mesmas seis viagens** da `fixtureOperacao` — inclusive a de canal
 * ilegível e a da outra quinzena —, escritas como um exportador de texto as
 * escreve: data por extenso (num CSV não existe `ddmmaaaa` numérico) e dinheiro
 * em `1.000,00` (num CSV não existe número nativo). É essa igualdade que
 * permite comparar a apuração inteira de um formato com a do outro.
 *
 * O retrato da viagem (veículo, horários, laço) fica de fora: ele não entra em
 * conta nenhuma, e o que esta fixture existe para provar é a conta.
 */
export function fixtureOperacaoEmCsv(): Buffer {
  const linha = (declarado: Record<string, string>) =>
    COLUNAS_DO_2ART.map((coluna) => declarado[coluna] ?? "");
  const viagemEmTexto = (
    data: string, entrega: string, frota: string, placa: string, mapa: string,
    entregas: number, carregadas: number, entregues: number, frete: number, faturado: number,
    custoSpot?: number,
  ) =>
    linha({
      Data: data, Transp: "36", Entrega: entrega, Frota: frota, Placa: placa, Mapa: mapa,
      Entregas: String(entregas), CxCarreg: String(carregadas), CxEntreg: String(entregues),
      ValorFrete: emPtBr(frete), PercImposto: "20", ValorImposto: emPtBr(faturado - frete),
      ValorFaturado: emPtBr(faturado),
      ...(custoSpot === undefined ? {} : { CustoSpot: emPtBr(custoSpot) }),
    });

  return csv([
    COLUNAS_DO_2ART,
    viagemEmTexto("16/07/2026", "Rota", "Padrao", "AAA1A11", "1001", 10, 200, 200, 800, 1000),
    viagemEmTexto("16/07/2026", "Rota", "Padrao", "BBB2B22", "1002", 8, 150, 140, 400, 500),
    viagemEmTexto("16/07/2026", "Entrega?", "Padrao", "CCC3C33", "1003", 1, 10, 10, 99, 123.75),
    viagemEmTexto("16/07/2026", "Rota", "Spot", "DDD4D44", "1004", 5, 100, 100, 240, 300, 240),
    viagemEmTexto("17/07/2026", "AS", "Padrao", "EEE5E55", "2001", 3, 90, 90, 160, 200),
    viagemEmTexto("01/07/2026", "Rota", "Padrao", "FFF6F66", "0101", 4, 80, 80, 120, 150),
  ]);
}

/**
 * O 03.08.12.09 em planilha — o mesmo CSV da `fixtureRequisicoes`, salvo pelo
 * Excel.
 *
 * Acontece toda vez que alguém abre o arquivo para conferir e usa "Salvar
 * como". O conteúdo é o mesmo; o que muda é que a linha deixa de existir e a
 * célula passa a ser número nativo.
 */
export function fixtureRequisicoesEmPlanilha(): Buffer {
  const linhas = new TextDecoder("latin1")
    .decode(fixtureRequisicoes())
    .split("\r\n")
    .map((l) => l.split(";"));
  return planilha({ "03.08.12.09": linhas });
}

/** O 03.08.12.09 regravado pelo Excel como "CSV UTF-8": com BOM, em UTF-8. */
export function fixtureRequisicoesEmUtf8(): Buffer {
  const texto = new TextDecoder("latin1").decode(fixtureRequisicoes());
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(texto, "utf8")]);
}

/**
 * O 03.08.18 em CSV, com a coluna que diz de que frota é a linha.
 *
 * O relatório em planilha diz isso pelo nome da aba, e um CSV não tem abas. A
 * coluna `Tipo Frota` é o que o exportador escreve no lugar — e sem ela o
 * leitor recusa o arquivo, que é o outro caso que os testes guardam.
 */
export function fixtureDisponibilidadeEmCsv(opcoes?: { comTipoDeFrota?: boolean }): Buffer {
  const comTipo = opcoes?.comTipoDeFrota ?? true;
  const cabecalho = [
    "Cód.Filial", "Nome Filial", "Geografia", "Transportadora", "Data", "Canal", "Frota Total",
    "Contratada", "Meta Indisp.", "Real 1º Viagem", "Real 2º Viagem", "Gap FF TT", "Gap Cia.",
    "Gap TP Frota Canc.", "Gap TP Outros Canc.", "Gap TP Frota N.Canc.", "Gap TP Outros N.Canc.",
    "Desc.Transp.Canc.", "Desc.Transp.N.Canc.", "Desc.FF Custo Fixo", "Desc.FF Equipe",
    "Desc.FF Indiretos", "% Utilização 1º Viagem", "% Utilização 2º Viagem", "% Utilização Total",
    "% Disponib.", "Ajudantes Contratados", "Ajudantes Real", "FA Contratado", "FA Real", "Gap FA",
    "Desconto FA", "Desconto Total", "Frota Disp.", "Freteiro Disp.", "Frota",
    ...(comTipo ? ["Tipo Frota"] : []),
  ];
  const dia = (
    data: string, tipo: string, contratada: number, real: number, gapCia: number,
    gapTp: number, custoFixo: number, equipe: number, total: number,
  ) => [
    "229", "CDD FICTICIO", "GEO NO", "036-TRANSPORTES FICTICIA", data, "Rota", "10",
    String(contratada), "0", String(real), "0", String(contratada - real), String(gapCia), "0", "0",
    String(gapTp), "0", "0", String(gapTp), emPtBr(custoFixo), emPtBr(equipe), "0,00", "0", "0",
    "0", "0", "0", "0", "1", "1", "0", "0,00", emPtBr(total), "0", "0", "Padrao",
    ...(comTipo ? [tipo] : []),
  ];
  return csv([
    cabecalho,
    dia("16/07/2026", "FF", 8, 6, 1, 1, 100, 200, 300),
    dia("17/07/2026", "FF", 8, 8, 0, 0, 0, 0, 0),
    dia("16/07/2026", "Van", 2, 1, 0, 1, 40, 10, 50),
  ]);
}

/**
 * O 03.02.59.02 delimitado — o mesmo relatório da `fixtureConciliacao`.
 *
 * As quatro colunas são as do relatório: rubrica, `Conciliado`, emitido e
 * calculado. É a fonte em que o formato pesa de verdade, porque a régua de
 * caracteres não existe aqui — e é por isso que a fixture traz o cabeçalho
 * `(Emitido)` / `(Calculado)`, que é o que permite ao leitor saber qual coluna
 * é qual sem inventar nada. A versão sem cabeçalho está logo abaixo.
 */
export function fixtureConciliacaoEmCsv(opcoes?: { comCabecalho?: boolean }): Buffer {
  const comCabecalho = opcoes?.comCabecalho ?? true;
  const emitido = (rubrica: string, marca: string, valor: string) => [rubrica, marca, valor, ""];
  const duas = (rubrica: string, marca: string, a: string, b: string) => [rubrica, marca, a, b];
  const soCalculado = (rubrica: string, valor: string) => [rubrica, "", "", valor];
  const solta = (texto: string) => [texto, "", "", ""];

  return csv([
    solta("PW02551R-j-Promax Web  Rel. Valores Conciliacao CT-e - Por Nota Fiscal  04/08/2026"),
    solta("CRBS SA - CDD Ficticio"),
    solta("Versao: 12.22.00.04      Rotina: 03.02.59.02.00      Usuario: 00000000001"),
    solta("Selecao - Data: 16/07/2026 a 31/07/2026"),
    solta("Transportadora:     36 - TRANSPORTES FICTICIA LTDA"),
    solta("Opcao: Sintetico"),
    ...(comCabecalho
      ? [
          ["", "Conciliado", "R$ CT-e", "R$ SRTrans"],
          ["", "", "(Emitido)", "(Calculado)"],
        ]
      : []),
    solta("RESUMO CT-e ROTA"),
    solta("-".repeat(40)),
    solta("RESUMO PENDENCIAS"),
    soCalculado("Saldo Quinzenas Anteriores", "300,00"),
    soCalculado("NF-e sem CT-e na Quinzena", "25,00"),
    soCalculado("Saldo Proxima Quinzena", "325,00"),
    solta("RESUMO DA QUINZENA ATUAL"),
    duas("Frota Fixa", "S", "1.000,00", "1.000,00"),
    duas("Freteiro", "S", "500,00", "500,00"),
    duas("S.Diversos/Comodatos/Eventos", "", "0,00", "0,00"),
    duas("Total Variavel Rota", "S", "1.500,00", "1.500,00"),
    soCalculado("Desconto Frete Minimo", "200,00"),
    duas("Total Variavel Calculado SRTRANS", "N", "1.500,00", "1.300,00"),
    solta("RESUMO PAGAMENTO COMPLEMENTAR VARIAVEL (Alteracao Perfil\\Cancelamento)"),
    solta("(Quinzena Atual)"),
    emitido("Frota Fixa", "", "100,00"),
    emitido("Freteiro", "", "0,00"),
    emitido("S. Diversos/Comodatos/Eventos", "", "0,00"),
    emitido("Sub-total Complementar Variavel", "", "100,00"),
    solta("RESUMO CT-e AS"),
    solta("-".repeat(40)),
    solta("RESUMO DA QUINZENA ATUAL"),
    duas("Total Variavel AS", "S", "200,00", "200,00"),
    duas("Total Variavel Calculado SRTRANS", "N", "200,00", "200,00"),
    solta("TOTAL GERAL (ROTA + AS)"),
    solta("-".repeat(40)),
    soCalculado("Total Variavel Calculado SRTRANS", "1.500,00"),
    emitido("CT-es Recebidos", "", "1.700,00"),
    soCalculado("Saldo Proxima Quinzena", "325,00"),
    solta("Encontrado Notas Fiscais sem Vinculo com CT-e."),
  ]);
}

/**
 * O 03.08.20 delimitado.
 *
 * As mesmas seis colunas na mesma ordem — que é o que faz este relatório
 * atravessar a mudança de formato sem uma segunda gramática: juntar os campos
 * com dois espaços devolve a linha de largura fixa que o leitor já lia.
 */
export function fixturePagamentoEmCsv(): Buffer {
  const solta = (texto: string) => [texto, "", "", "", "", "", ""];
  const item = (rotulo: string, sem: string, ctrc: string, vlc: string) => [
    rotulo, sem, "0,00", ctrc, ctrc, "0,00", vlc,
  ];
  return csv([
    solta("PW02581R-  -p-Promax Web  Remuneracao de Transportadoras  *** Pagamento ***"),
    solta("CDD FICTICIO   Periodo: 16/07/2026 a 31/07/2026"),
    solta("Versao: 12.22.00.04      Rotina: 03.08.20.00.00      Usuario: 00099783515"),
    solta("Transportadora  36 TRANSPORTES FICTICIA LTDA"),
    solta("Entregas para 081-0443 - CDD FICTICIO"),
    solta("ROTA"),
    solta("FRETE"),
    ["VBZ", "S/Imposto", "NF-ISS", "CTRC-ICMS", "Valor Faturado", "Valor VLC NF-ISS", "Valor VLC CTRC-ICMS"],
    item(" 01 - Frota Fixa Ativa", "1.600,00", "2.000,00", "1.800,00"),
    item(" 05 - Frota Fixa Variavel", "800,00", "1.000,00", "900,00"),
    solta("DESCONTO DEVOLUCAO"),
    solta("Valor S/Imposto (Todas VBZ's exceto Rem. Var. Equipe Ent.)   2.400,00"),
    solta("% Dev. Resp. Transportadora   1,50 %"),
    solta("Desconto Devolucao   36,00"),
    solta("DESCONTO DISPONIBILIDADE"),
    solta("Desconto FF - Custo Fixo (Desconto Liquido ja subtraido da VBZ 01 - Frota Fixa Ativa)   100,00"),
    solta("Desconto FF - Equipe Entrega (Desconto Liquido ja subtraido da VBZ 02 - Equipe Entrega)   200,00"),
    solta("Desconto FF - Custo Indireto (Desconto Liquido ja subtraido da VBZ 03 - Despesas Adm.)   0,00"),
    solta("Desconto FF - Fator Ajudante (Desconto Liquido ja subtraido da VBZ 02 - Equipe Entrega)   0,00"),
    solta("DESCONTO FRETE MINIMO"),
    solta("Desconto Frete mínimo (Desconto Líquido já subtraído das VBZs de custo Fixo coluna ICMS)   50,00"),
    solta("OUTROS CUSTOS"),
    ["VBZ", "S/Imposto", "NF-ISS", "CTRC-ICMS", "Valor Faturado", "Valor VLC NF-ISS", "Valor VLC CTRC-ICMS"],
    item(" 09 - Rota - Outras Despesas", "400,00", "500,00", "450,00"),
    solta("Total Remuneração   3.500,00"),
  ]);
}

/**
 * O 03.08.20 de uma 1ª quinzena real — o arquivo que veio do campo.
 *
 * **Por que este entra no repositório, contra a regra do topo deste arquivo.**
 * A regra existe pelo dado de cliente: placa, CNPJ, chave de CT-e, matrícula.
 * Este relatório não traz nenhum dos três primeiros, e o quarto — a matrícula de
 * quem exportou, no `Usuario:` do cabeçalho — foi substituída por zeros da mesma
 * largura, para que nenhuma coluna se desloque. O que sobra é layout e dinheiro
 * de fechamento, que os `docs/` deste módulo já citam nominalmente.
 *
 * **E por que ele precisa existir.** As fixtures sintéticas foram escritas a
 * partir do layout, e provam o layout que quem as escreveu conhecia. Este
 * arquivo prova o layout que o Promax de fato exporta numa 1ª quinzena — que
 * difere do sintético em três coisas que só se descobrem olhando um de verdade:
 *
 * - **não há bloco `OUTROS CUSTOS`**, nem `DESCONTO DISPONIBILIDADE`: a 1ª
 *   quinzena fecha só com frete, devolução e frete mínimo;
 * - **cada verba é seguida de uma linha de centro de custo** entre parênteses
 *   (`(71027001 BRALLLV234)`), que não é verba nem desconto e não pode virar
 *   nenhum dos dois;
 * - **o relatório vem paginado**, com o cabeçalho inteiro repetido no meio do
 *   arquivo, e a segunda página abre o outro canal (`AS`).
 *
 * Dez verbas — seis na Rota, quatro no AS —, quatro descontos e dois totais.
 * `linhas_lidas` = 14, que é o número que a tela mostra.
 */
export function fixturePagamento1aQuinzenaReal(): Buffer {
  /* Lido do disco pelo mesmo caminho da amostra de `reconciliacao.test.ts`: a
     amostra é dado de teste, não módulo, e mantê-la fora do grafo de compilação
     evita que o `tsconfig` do pacote precise conhecer um arquivo que só o teste
     abre. Em bytes, sem codificação: o arquivo é latin-1, e quem decide isso é
     o leitor. */
  return readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "amostras", "03.08.20-2026-07-Q1.txt"),
  );
}
