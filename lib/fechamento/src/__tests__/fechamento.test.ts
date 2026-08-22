import { describe, expect, it } from "vitest";
import {
  abrirDia,
  apurar,
  competencia,
  competenciaDaChave,
  competenciaDoDia,
  diaDeDDMMAAAA,
  diasDaCompetencia,
  diaDeSerial,
  diaDeTextoBR,
  lerCanal,
  lerConciliacao,
  lerCtes,
  lerDisponibilidade,
  lerFrota,
  lerNumero,
  lerOperacao,
  lerPagamento,
  lerRequisicoes,
  medirAliquotas,
  valorDe,
  FONTES_DA_QUINZENA,
  FONTES_OPCIONAIS_DA_QUINZENA,
  QUINZENAS_DA_FONTE,
  QUINZENAS_OPCIONAIS_DA_FONTE,
  fonteEsperadaNaQuinzena,
  fonteOpcionalNaQuinzena,
} from "../index";
import {
  FATOR,
  SERIAL_16_07_2026,
  fixtureConciliacao,
  fixtureCtes,
  fixtureDisponibilidade,
  fixtureOperacao,
  fixtureOperacaoComCabecalhoEspacado,
  fixturePagamento,
  fixturePagamentoDoPainel,
  fixtureRequisicoes,
} from "./fixtures";

describe("as três formas de escrever uma data", () => {
  it("lê o serial do Excel com o bug do ano bissexto de 1900", () => {
    expect(diaDeSerial(SERIAL_16_07_2026)).toBe("2026-07-16");
    expect(diaDeSerial(46204)).toBe("2026-07-01");
  });

  it("recusa serial que é quantidade disfarçada de data", () => {
    /* A coluna `Data` do 03.08.15 vem como número puro; um `1` ali é erro de
       origem, e virar 31/12/1899 poria a viagem numa competência inexistente. */
    expect(diaDeSerial(1)).toBeNull();
    expect(diaDeSerial(999_999)).toBeNull();
  });

  it("lê o ddmmaaaa colado do 2Art e o dd/mm/aaaa do CSV", () => {
    expect(diaDeDDMMAAAA(16072026)).toBe("2026-07-16");
    expect(diaDeTextoBR("16/07/2026")).toBe("2026-07-16");
  });

  it("lê os sete dígitos de 01/07 — o zero à esquerda que o Excel come", () => {
    /* A coluna `Data` do 2Art é numérica, e todo número perde o zero da frente.
       Exigir oito dígitos recusava a operação inteira dos dias 1 a 9. */
    expect(diaDeDDMMAAAA(1072026)).toBe("2026-07-01");
    expect(diaDeDDMMAAAA("9082026")).toBe("2026-08-09");
    /* O zero do mês fica no meio do número, e o Excel não corta dígito
       interno: dez de julho continua tendo oito dígitos. */
    expect(diaDeDDMMAAAA(10072026)).toBe("2026-07-10");
    expect(diaDeDDMMAAAA(107202)).toBeNull();
  });

  it("recusa data impossível em vez de deixá-la transbordar", () => {
    /* `new Date(2026, 1, 31)` devolve 03/03 em silêncio. */
    expect(diaDeDDMMAAAA("31022026")).toBeNull();
    expect(diaDeTextoBR("31/02/2026")).toBeNull();
  });
});

describe("a competência", () => {
  it("parte o mês em duas quinzenas e rotula pelo primeiro dia", () => {
    const segunda = competencia(2026, 7, 2);
    expect(segunda.inicio).toBe("2026-07-16");
    expect(segunda.fim).toBe("2026-07-31");
    expect(segunda.rotulo).toBe("16/07/2026");
    expect(competencia(2026, 2, 2).fim).toBe("2026-02-28");
  });

  it("vai e volta pela chave, e sabe a de um dia", () => {
    expect(competenciaDaChave("2026-07-Q2")?.chave).toBe("2026-07-Q2");
    expect(competenciaDaChave("2026-13-Q1")).toBeNull();
    expect(competenciaDoDia("2026-07-15").quinzena).toBe(1);
    expect(competenciaDoDia("2026-07-16").quinzena).toBe(2);
  });
});

describe("o vocabulário das fontes", () => {
  it("traduz canal e frota, e devolve null para o que não reconhece", () => {
    expect(lerCanal("Rota")).toBe("ROTA");
    expect(lerCanal("AS  ")).toBe("AS");
    expect(lerCanal("Entrega?")).toBeNull();
    expect(lerFrota("Espec.")).toBe("ESPECIAL");
    expect(lerFrota("Padrao")).toBe("PADRAO");
    expect(lerFrota("")).toBeNull();
  });

  it("lê número em pt-BR sem confundir ausência com zero", () => {
    expect(lerNumero("7.049,93")).toBe(7049.93);
    expect(lerNumero(1234.56)).toBe(1234.56);
    expect(lerNumero("")).toBeNull();
    expect(lerNumero("n/d")).toBeNull();
  });
});

describe("o 2Art", () => {
  const lido = lerOperacao(fixtureOperacao());

  it("lê as viagens e recusa a que tem canal ilegível, com a linha e o texto", () => {
    /* Cinco: quatro da 2ª quinzena e a de 01/07, cuja data vem com sete
       dígitos. A recusada é a do canal ilegível, e só ela. */
    expect(lido.linhas).toHaveLength(5);
    expect(lido.recusas).toEqual([
      { linha: 4, motivo: "O canal da viagem não é Rota nem AS.", original: "Entrega?" },
    ]);
    expect(lido.linhas.map((v) => v.dia)).toContain("2026-07-01");
  });

  it("reproduz o total do dia por tipo de frota — o que as abas 01..31 da planilha faziam", () => {
    const doDia = (frota: string) =>
      lido.linhas
        .filter((v) => v.dia === "2026-07-16" && v.canal === "ROTA" && v.frota === frota)
        .reduce((s, v) => s + v.valorFaturado, 0);
    expect(doDia("PADRAO")).toBe(1500);
    expect(doDia("SPOT")).toBe(300);
  });

  it("traz a linha inteira, e não só as colunas que a conta soma", () => {
    /* É o que a tela do dia mostra: veículo, horários, laço, equipe. Sem isto,
       conferir uma viagem continuaria exigindo reabrir o 2Art. */
    const primeira = lido.linhas[0];
    expect(primeira.detalhe).toMatchObject({
      veiculo: "63",
      cargaAtual: "Roteriz",
      ocupacao: 55.23,
      horaDeSaida: "16/07/2026 7:39",
      kmDeSaida: 995,
      tipoDeImposto: "CTRC-ICMS",
      tempoPrevisto: "9:14",
      kmPrevisto: 124.87,
      valorDaEquipeDeEntregaMotorista: 15,
      unidadeDeOrigem: "30229",
      matriculaDoMotorista: "450",
    });
  });

  it("deixa nulo o que a exportação não trouxe, em vez de zerar", () => {
    /* A segunda viagem declara só o que a conta usa. `0` ali afirmaria que ela
       não pagou equipe nenhuma — que é diferente de não sabermos. */
    const segunda = lido.linhas[1];
    expect(segunda.detalhe?.valorDaEquipeDeEntregaMotorista).toBeNull();
    expect(segunda.detalhe?.ocupacao).toBeNull();
    expect(segunda.detalhe?.horaDeSaida).toBe("");
    /* E o que ela declara continua chegando. */
    expect(segunda.valorFaturado).toBe(500);
  });

  it("lê o mesmo relatório com o cabeçalho espaçado da pasta de fechamento", () => {
    /* `CX CARREG` e `CxCarreg` são a mesma coluna; sem isso o arquivo salvo de
       dentro da planilha seria recusado inteiro, no cabeçalho. */
    const espacado = lerOperacao(fixtureOperacaoComCabecalhoEspacado());
    expect(espacado.recusas).toEqual([]);
    expect(espacado.linhas).toHaveLength(1);
    expect(espacado.linhas[0].caixasCarregadas).toBe(200);
    expect(espacado.linhas[0].valorFaturado).toBe(1000);
    expect(espacado.linhas[0].detalhe?.ocupacao).toBe(55.23);
  });
});

describe("o diário da quinzena", () => {
  const viagens = lerOperacao(fixtureOperacao()).linhas;
  const segunda = competencia(2026, 7, 2);

  it("traz um dia por dia do período, inclusive os que não rodaram", () => {
    const dias = diasDaCompetencia(segunda, viagens);
    expect(dias).toHaveLength(16);
    expect(dias[0].dia).toBe("2026-07-16");
    expect(dias.at(-1)?.dia).toBe("2026-07-31");
    /* 16/07 rodou; 18/07 não rodou e continua na grade, com zero. */
    expect(dias[0].totais.viagens).toBe(3);
    expect(dias[2].totais.viagens).toBe(0);
    expect(dias[2].totais.freteComImposto).toBe(0);
  });

  it("deixa de fora a viagem da outra quinzena, e não a soma em lugar nenhum", () => {
    /* O 2Art é mensal e a competência é meio mês: 01/07 pertence à 1ª. */
    const dias = diasDaCompetencia(segunda, viagens);
    expect(dias.reduce((s, d) => s + d.totais.viagens, 0)).toBe(4);
    const primeira = diasDaCompetencia(competencia(2026, 7, 1), viagens);
    expect(primeira[0].dia).toBe("2026-07-01");
    expect(primeira[0].totais.viagens).toBe(1);
    expect(primeira[0].totais.freteComImposto).toBe(150);
  });

  it("abre o dia com os totais por frota — o TOTAL PADRAO e o TOTAL SPOT da aba", () => {
    const dia = abrirDia("2026-07-16", viagens);
    expect(dia.viagens).toHaveLength(3);
    expect(dia.totais.freteComImposto).toBe(1800);
    expect(dia.porFrota).toEqual([
      expect.objectContaining({ frota: "PADRAO", viagens: 2, freteComImposto: 1500 }),
      expect.objectContaining({ frota: "SPOT", viagens: 1, freteComImposto: 300 }),
    ]);
    /* A ordem é a da planilha: os Padrao juntos, depois o spot. */
    expect(dia.viagens.map((v) => v.frota)).toEqual(["PADRAO", "PADRAO", "SPOT"]);
  });

  it("dá o número e o dia da semana que o ladrilho mostra", () => {
    const dia = abrirDia("2026-07-16", viagens);
    expect(dia.numeroDoDia).toBe(16);
    /* 16/07/2026 é quinta-feira. */
    expect(dia.diaDaSemana).toBe(4);
  });
});

describe("o 03.08.15", () => {
  const lido = lerCtes(fixtureCtes());

  it("acha o cabeçalho abaixo das linhas de total e classifica a verba pela VBZ", () => {
    expect(lido.recusas).toEqual([]);
    expect(lido.linhas).toHaveLength(5);
    const freteiro = lido.linhas.find((l) => l.verba.vbz === 7);
    expect(freteiro?.verba.nome).toBe("Freteiro");
    expect(freteiro?.canal).toBe("ROTA");
    expect(freteiro?.verba.natureza).toBe("VARIAVEL");
  });

  it("guarda a base sem imposto que o próprio documento declara", () => {
    const outras = lido.linhas.find((l) => l.verba.vbz === 9);
    expect(outras?.valorCte).toBe(500);
    expect(outras?.valorFrete).toBe(400);
  });
});

describe("o 03.08.12.09", () => {
  const lido = lerRequisicoes(fixtureRequisicoes());

  it("decodifica latin-1: o acento chega inteiro", () => {
    expect(lido.recusas).toEqual([]);
    expect(lido.linhas.map((r) => r.descricao)).toContain("Incentivo de operação");
    expect(lido.linhas.find((r) => r.numero === "3004")?.tipoDeDespesa.nome).toBe("Pedágio");
  });

  it("guarda a trilha de aprovação, que a planilha jogava fora", () => {
    const primeira = lido.linhas[0];
    expect(primeira.solicitante).toBe("00000000001");
    expect(primeira.aprovadorRegional).toBe("00000000002");
    expect(primeira.enviadaEm).toBe("2026-07-27");
    expect(primeira.decididaEm).toBe("2026-07-28");
  });

  it("lê a reprovada sem descartá-la — quem decide se paga é a apuração", () => {
    const reprovada = lido.linhas.find((r) => r.numero === "3005");
    expect(reprovada?.status).toBe("Reprovada");
    expect(reprovada?.valor).toBe(9999);
  });
});

describe("o 03.08.18", () => {
  const lido = lerDisponibilidade(fixtureDisponibilidade());

  it("lê as duas abas e marca o tipo de frota de cada linha", () => {
    expect(lido.recusas).toEqual([]);
    expect(lido.linhas.map((d) => d.tipoDeFrota).sort()).toEqual(["FF", "FF", "VAN"]);
  });

  it("separa o gap da Ambev do gap da transportadora — a distinção que é dinheiro", () => {
    const dia = lido.linhas.find((d) => d.tipoDeFrota === "FF" && d.dia === "2026-07-16");
    expect(dia?.gapDaCia).toBe(1);
    expect(dia?.gapDaTransportadora.frotaNaoCancelada).toBe(1);
    expect(dia?.descontos.total).toBe(300);
  });
});

describe("o 03.02.59.02", () => {
  const lido = lerConciliacao(fixtureConciliacao());

  it("lê o cabeçalho que se repete a cada página", () => {
    expect(lido.transportadora).toEqual({ codigo: "36", nome: "TRANSPORTES FICTICIA LTDA" });
    expect(lido.periodo).toEqual({ inicio: "2026-07-16", fim: "2026-07-31" });
    expect(lido.opcao).toBe("Sintetico");
  });

  it("decide a coluna pela posição, não pela contagem de números na linha", () => {
    /* Um número só na linha: `Desconto Frete Minimo` é do calculado... */
    expect(valorDe(lido, { secao: "ROTA", rubrica: "Desconto Frete Minimo", coluna: "CALCULADO" })).toBe(200);
    expect(valorDe(lido, { secao: "ROTA", rubrica: "Desconto Frete Minimo", coluna: "EMITIDO" })).toBeNull();
    /* ...e `CT-es Recebidos` é do emitido. Contar números confundiria os dois. */
    expect(valorDe(lido, { secao: "GERAL", rubrica: "CT-es Recebidos", coluna: "EMITIDO" })).toBe(1700);
    expect(valorDe(lido, { secao: "GERAL", rubrica: "CT-es Recebidos", coluna: "CALCULADO" })).toBeNull();
  });

  it("separa a mesma rubrica em blocos diferentes", () => {
    /* `Frota Fixa` aparece na quinzena atual e no complementar, com valores
       diferentes; sem o bloco, a apuração somaria a linha errada. */
    expect(valorDe(lido, { secao: "ROTA", rubrica: "Frota Fixa", bloco: "RESUMO DA QUINZENA ATUAL", coluna: "EMITIDO" })).toBe(1000);
    expect(valorDe(lido, { secao: "ROTA", rubrica: "Frota Fixa", bloco: "(Quinzena Atual)", coluna: "EMITIDO" })).toBe(100);
  });

  it("guarda o aviso de rodapé, que na planilha sumia", () => {
    expect(lido.avisos).toEqual(["Encontrado Notas Fiscais sem Vinculo com CT-e."]);
  });

  it("distingue rubrica ausente de rubrica zerada", () => {
    expect(valorDe(lido, { secao: "AS", rubrica: "Desconto Frete Minimo", coluna: "CALCULADO" })).toBeNull();
    expect(valorDe(lido, { secao: "ROTA", rubrica: "S.Diversos/Comodatos/Eventos", bloco: "RESUMO DA QUINZENA ATUAL", coluna: "EMITIDO" })).toBe(0);
  });
});

describe("a alíquota é medida, não presumida", () => {
  it("mede o fator nas verbas cujo CT-e só pode ter vindo de requisição", () => {
    const ctes = lerCtes(fixtureCtes()).linhas;
    const requisicoes = lerRequisicoes(fixtureRequisicoes()).linhas.filter((r) => r.status === "Aprovada");
    const medidas = medirAliquotas(ctes, requisicoes);
    const rota = medidas.find((a) => a.canal === "ROTA");
    expect(rota?.fator).toBeCloseTo(FATOR, 6);
    expect(rota?.percentual).toBeCloseTo(20, 6);
    /* A régua é a VBZ 9: complementar, e sem rubrica na conciliação. */
    expect(rota?.medida.vbzs).toEqual([9]);
  });
});

describe("o catálogo de cada quinzena", () => {
  it("espera quatro relatórios na primeira e seis na segunda", () => {
    expect(FONTES_DA_QUINZENA[1]).toEqual([
      "OPERACAO",
      "CTE",
      "PAGAMENTO",
      "DISPONIBILIDADE",
    ]);
    expect(FONTES_DA_QUINZENA[2]).toHaveLength(6);
  });

  it("admite o 03.08.12.09 na primeira sem cobrá-lo dela", () => {
    /* A requisição aprovada entre os dias 1 e 15 sai no relatório daquela
       quinzena: ele **pode** existir ali. O que não dá para afirmar é o
       contrário — quinzena sem requisição nenhuma não gera arquivo —, e por
       isso ele é opcional e não esperado. As duas listas não se cruzam: o que
       é esperado não é opcional, e vice-versa. */
    expect(FONTES_OPCIONAIS_DA_QUINZENA[1]).toEqual(["REQUISICOES"]);
    expect(FONTES_OPCIONAIS_DA_QUINZENA[2]).toEqual([]);
    expect(fonteOpcionalNaQuinzena(1, "REQUISICOES")).toBe(true);
    expect(fonteEsperadaNaQuinzena(1, "REQUISICOES")).toBe(false);
    /* A conciliação continua sendo a única que não existe na primeira. */
    expect(fonteOpcionalNaQuinzena(1, "CONCILIACAO")).toBe(false);
  });

  it("diz, por fonte, em que quinzenas ela é esperada e em quais é opcional", () => {
    /* São estas duas formas que a API publica e a tela lê — e as duas são
       derivadas das listas por quinzena, para que não possam discordar delas.
       Ficam em campos separados de propósito: um decide se a casinha de envio
       aparece, o outro se a ausência é pendência. */
    expect(QUINZENAS_DA_FONTE.CTE).toEqual([1, 2]);
    expect(QUINZENAS_DA_FONTE.REQUISICOES).toEqual([2]);
    expect(QUINZENAS_DA_FONTE.CONCILIACAO).toEqual([2]);
    expect(QUINZENAS_OPCIONAIS_DA_FONTE.REQUISICOES).toEqual([1]);
    expect(QUINZENAS_OPCIONAIS_DA_FONTE.CONCILIACAO).toEqual([]);
    expect(QUINZENAS_OPCIONAIS_DA_FONTE.CTE).toEqual([]);
    expect(fonteEsperadaNaQuinzena(1, "CONCILIACAO")).toBe(false);
    expect(fonteEsperadaNaQuinzena(2, "CONCILIACAO")).toBe(true);
  });
});

describe("a apuração", () => {
  const fontes = {
    operacao: lerOperacao(fixtureOperacao()).linhas,
    ctes: lerCtes(fixtureCtes()).linhas,
    requisicoes: lerRequisicoes(fixtureRequisicoes()).linhas,
    disponibilidade: lerDisponibilidade(fixtureDisponibilidade()).linhas,
    conciliacao: lerConciliacao(fixtureConciliacao()),
  };
  const apuracao = apurar(competencia(2026, 7, 2), fontes);
  const verba = (vbz: number) => apuracao.verbas.find((v) => v.verba.vbz === vbz);

  it("reconstrói a verba somada de conciliação e complementar", () => {
    /* 1.000,00 do SRTrans + 100,00 de complementar = 1.100,00 emitidos. */
    const v = verba(5);
    expect(v?.emitido).toBe(1100);
    expect(v?.esperado).toBe(1100);
    expect(v?.diferenca).toBe(0);
    expect(v?.memoria).toHaveLength(2);
  });

  it("reconstrói a verba que soma as três parcelas", () => {
    /* 500,00 do SRTrans + 200,00 de requisição × 1,25 = 750,00. */
    const v = verba(7);
    expect(v?.emitido).toBe(750);
    expect(v?.esperado).toBe(750);
    const daRequisicao = v?.memoria.find((m) => m.origem === "REQUISICOES");
    expect(daRequisicao?.semImposto).toBe(200);
    expect(daRequisicao?.comImposto).toBe(250);
    expect(daRequisicao?.fator).toBeCloseTo(FATOR, 6);
  });

  it("ignora a requisição reprovada", () => {
    /* Só as aprovadas (250 + 150 = 400) entram; a reprovada de 9.999 não. */
    const v = verba(9);
    expect(v?.memoria.find((m) => m.origem === "REQUISICOES")?.semImposto).toBe(400);
    expect(v?.esperado).toBe(500);
    expect(v?.diferenca).toBe(0);
  });

  it("não inventa origem para o fixo: marca como não conferido e o diz", () => {
    const v = verba(1);
    expect(v?.emitido).toBe(2000);
    expect(v?.esperado).toBeNull();
    expect(v?.diferenca).toBeNull();
    expect(apuracao.totais.naoConferido).toBe(2000);
    expect(apuracao.divergencias.some((d) => d.tipo === "VERBA_SEM_ORIGEM" && d.valor === 2000)).toBe(true);
  });

  it("levanta o desconto de frete mínimo e o saldo que atravessa", () => {
    const frete = apuracao.divergencias.find((d) => d.tipo === "DESCONTO_FRETE_MINIMO");
    expect(frete?.valor).toBe(200);
    expect(frete?.sentido).toBe("A_RECEBER");
    expect(apuracao.divergencias.find((d) => d.tipo === "SALDO_ATRAVESSANDO")?.valor).toBe(325);
  });

  it("levanta o desconto por indisponibilidade das duas abas", () => {
    /* 300,00 da FF + 50,00 da van, só os dias dentro da competência. */
    const d = apuracao.divergencias.find((x) => x.tipo === "DESCONTO_DE_DISPONIBILIDADE");
    expect(d?.valor).toBe(350);
  });

  it("confere o 2Art contra o que o SRTrans calculou", () => {
    /* Rota: o 2Art soma 1.800,00 e o SRTrans calculou 1.300,00 — abre 500,00. */
    const rota = apuracao.divergencias.find((d) => d.tipo === "OPERACAO_NAO_FECHA" && d.canal === "ROTA");
    expect(rota?.valor).toBe(500);
    /* AS fecha ao centavo, e por isso não vira divergência. */
    expect(apuracao.divergencias.some((d) => d.tipo === "OPERACAO_NAO_FECHA" && d.canal === "AS")).toBe(false);
  });

  it("não cobra da 1ª quinzena o que a 1ª quinzena não espera", () => {
    /* A primeira quinzena espera quatro relatórios: a conciliação (03.02.59.02)
       chega com o fechamento da segunda e as requisições (03.08.12.09) podem
       nem existir. Nomeá-las como ausentes ali seria cobrar arquivo que ninguém
       tem para enviar — e a tela passaria a quinzena inteira pedindo o que pode
       não haver. */
    const primeira = apurar(competencia(2026, 7, 1), { ctes: fontes.ctes });
    expect(primeira.fontesAusentes).toEqual(["OPERACAO", "PAGAMENTO", "DISPONIBILIDADE"]);

    /* A mesma falta, na segunda quinzena, são cinco: lá as duas existem. */
    const segunda = apurar(competencia(2026, 7, 2), { ctes: fontes.ctes });
    expect(segunda.fontesAusentes).toEqual([
      "OPERACAO",
      "PAGAMENTO",
      "DISPONIBILIDADE",
      "REQUISICOES",
      "CONCILIACAO",
    ]);
  });

  it("apura o 03.08.12.09 que chegou na 1ª quinzena, sem tê-lo cobrado antes", () => {
    /* Opcional é "pode existir", não "não vale": quando o relatório chega, ele
       entra na conta da primeira quinzena como entraria na da segunda. O que a
       lista de opcionais compra é a assimetria — presente conta, ausente não
       cobra —, e é ela que faz o complementar dos dias 1 a 15 poder existir sem
       fazer toda primeira quinzena do ano nascer devendo um arquivo. */
    const semRequisicoes = apurar(competencia(2026, 7, 1), { ctes: fontes.ctes });
    expect(semRequisicoes.fontesAusentes).not.toContain("REQUISICOES");
    expect(semRequisicoes.fontesPresentes).not.toContain("REQUISICOES");

    const comRequisicoes = apurar(competencia(2026, 7, 1), {
      ctes: fontes.ctes,
      requisicoes: fontes.requisicoes,
    });
    expect(comRequisicoes.fontesPresentes).toContain("REQUISICOES");
    expect(comRequisicoes.fontesAusentes).not.toContain("REQUISICOES");
    /* E o complementar da VBZ 9, que só nasce de requisição, aparece. */
    expect(comRequisicoes.verbas.find((v) => v.verba.vbz === 9)?.esperado).not.toBeNull();
  });

  it("conta como presente o que chegou fora da quinzena dele", () => {
    /* A lista da quinzena diz o que se espera, não o que se admite: uma
       conciliação enviada a uma primeira quinzena é lida e apurada como
       qualquer outra fonte. Presente é presente. */
    const primeira = apurar(competencia(2026, 7, 1), {
      ctes: fontes.ctes,
      conciliacao: fontes.conciliacao,
    });
    expect(primeira.fontesPresentes).toContain("CONCILIACAO");
    expect(primeira.fontesAusentes).not.toContain("CONCILIACAO");
  });

  it("roda com o que há e nomeia a fonte que falta", () => {
    const semConciliacao = apurar(competencia(2026, 7, 2), { ...fontes, conciliacao: undefined });
    /* `fontes` não traz o 03.08.20: ele é a fonte do bloco abaixo, e as duas
       ausências saem nomeadas na ordem do catálogo. */
    expect(semConciliacao.fontesAusentes).toEqual(["PAGAMENTO", "CONCILIACAO"]);
    /* Sem a conciliação, a verba 5 perde a origem — e vira não conferida, não zero. */
    expect(semConciliacao.verbas.find((v) => v.verba.vbz === 5)?.esperado).toBeNull();
    expect(semConciliacao.totais.emitido).toBe(apuracao.totais.emitido);
  });

  it("soma o emitido de todas as verbas, conferidas ou não", () => {
    expect(apuracao.totais.emitido).toBe(1100 + 750 + 500 + 2000 + 100);
    expect(apuracao.totais.diferenca).toBe(0);
  });

  describe("com o 03.08.20", () => {
    const comPagamento = apurar(competencia(2026, 7, 2), {
      ...fontes,
      pagamento: lerPagamento(fixturePagamento()),
    });
    const daConta = (vbz: number) => comPagamento.verbas.find((v) => v.verba.vbz === vbz);

    it("sustenta o fixo, que nenhuma das outras cinco alcança", () => {
      /* Sem ele o mesmo fechamento deixava 2.000,00 sem quem conferisse. */
      expect(apuracao.totais.naoConferido).toBe(2000);
      expect(comPagamento.totais.naoConferido).toBe(0);

      const fixa = daConta(1);
      expect(fixa?.esperado).toBe(2000);
      expect(fixa?.diferenca).toBe(0);
      expect(fixa?.memoria.map((m) => m.origem)).toEqual(["PAGAMENTO"]);
      expect(fixa?.memoria[0]?.semImposto).toBe(1600);
      expect(
        comPagamento.divergencias.some((d) => d.tipo === "VERBA_SEM_ORIGEM"),
      ).toBe(false);
    });

    it("nas variáveis é segunda opinião: discordar vira divergência, não parcela", () => {
      const variavel = daConta(5);
      /* Continua reconstruída pelas outras fontes — nada de quarta parcela. */
      expect(variavel?.esperado).toBe(1100);
      expect(variavel?.memoria.some((m) => m.origem === "PAGAMENTO")).toBe(false);

      const perguntas = comPagamento.divergencias.filter(
        (d) => d.tipo === "PAGAMENTO_DIVERGE_DO_CTE",
      );
      /* Só a VBZ 5 discorda (1.100,00 emitidos contra 1.000,00 no
         demonstrativo). A 9 diz o mesmo nos dois, e silêncio é a resposta
         certa para concordância. */
      expect(perguntas).toHaveLength(1);
      expect(perguntas[0]?.valor).toBe(100);
      expect(perguntas[0]?.sentido).toBe("A_PAGAR");
      expect(perguntas[0]?.onde).toContain("VBZ 5");
    });

    it("não muda o emitido: o 03.08.15 continua sendo quem diz o que foi faturado", () => {
      expect(comPagamento.totais.emitido).toBe(apuracao.totais.emitido);
    });
  });
});

describe("o 03.08.20", () => {
  const pagamento = lerPagamento(fixturePagamento());

  it("lê o período que o próprio arquivo declara — e é o único que declara", () => {
    expect(pagamento.periodo).toEqual({ inicio: "2026-07-16", fim: "2026-07-31" });
    expect(pagamento.transportadora).toEqual({
      codigo: "36",
      nome: "TRANSPORTES FICTICIA LTDA",
    });
  });

  it("lê as seis colunas de cada verba, nos dois blocos", () => {
    expect(pagamento.itens.map((i) => i.verba.vbz)).toEqual([1, 5, 9]);
    const fixa = pagamento.itens.find((i) => i.verba.vbz === 1)!;
    expect(fixa.bloco).toBe("FRETE");
    expect(fixa.semImposto).toBe(1600);
    expect(fixa.ctrcIcms).toBe(2000);
    expect(fixa.valorFaturado).toBe(2000);
    expect(pagamento.itens.find((i) => i.verba.vbz === 9)?.bloco).toBe("OUTROS_CUSTOS");
  });

  it("guarda base e percentual só onde eles existem", () => {
    const devolucao = pagamento.descontos.find((d) => d.tipo === "DEVOLUCAO")!;
    expect(devolucao.base).toBe(2400);
    expect(devolucao.percentual).toBe(1.5);
    expect(devolucao.valor).toBe(36);
    /* O rótulo inteiro fica: é ele que diz de qual VBZ o desconto já saiu. */
    expect(devolucao.rotulo).toContain("Desconto Devolucao");

    const equipe = pagamento.descontos.find((d) => d.tipo === "DISPONIBILIDADE_EQUIPE")!;
    expect(equipe.valor).toBe(200);
    expect(equipe.base).toBeNull();
    expect(equipe.percentual).toBeNull();

    /* O rótulo cita a VBZ 02: pegar o primeiro número da linha daria 2. */
    expect(pagamento.descontos.find((d) => d.tipo === "FRETE_MINIMO")?.valor).toBe(50);
  });

  it("fecha o total do canal, com o acento que só o latin-1 entrega", () => {
    expect(pagamento.totais).toEqual([{ canal: "ROTA", total: 3500 }]);
  });
});


/**
 * O 03.08.20 passa a registrar por que uma linha de verba não entrou.
 *
 * Era o único leitor, junto com o da conciliação, a devolver recusa nenhuma — e
 * o preço apareceu em produção: um demonstrativo gravou catorze descontos e
 * nenhuma verba, e não havia como saber por quê. O fechamento **não guarda o
 * arquivo** (ver `receberDocumento`, que decodifica os bytes, lê e os
 * descarta), então a recusa é a única evidência que sobrevive ao envio.
 */
describe("as recusas do demonstrativo", () => {
  /** O fixture bom, com uma coluna de valor a menos em cada linha de verba. */
  function comUmaColunaAMenos(): Buffer {
    const texto = fixturePagamentoDoPainel().toString("utf8");
    return Buffer.from(
      texto
        .split(/\r?\n/)
        .map((l) => {
          const m = /^(\s*\d{1,3}\s*-\s*.+?\s{2,})((?:-?[\d.]+,\d{2}\s+){5})(-?[\d.]+,\d{2})\s*$/.exec(l);
          return m ? `${m[1]}${m[2]!.trimEnd()}` : l;
        })
        .join("\r\n"),
      "utf8",
    );
  }

  /** O fixture bom, sem os cabeçalhos de seção que tornam a verba elegível. */
  function semCabecalhoDeSecao(): Buffer {
    const texto = fixturePagamentoDoPainel().toString("utf8");
    return Buffer.from(texto.replace("FRETE\r\n", "").replace("OUTROS CUSTOS\r\n", ""), "utf8");
  }

  it("um arquivo íntegro não recusa nada", () => {
    const lido = lerPagamento(fixturePagamentoDoPainel());
    expect(lido.itens.length).toBeGreaterThan(0);
    expect(lido.recusas).toEqual([]);
  });

  it("coluna a menos: recusa nomeia quantas colunas vieram e quantas se espera", () => {
    const lido = lerPagamento(comUmaColunaAMenos());
    expect(lido.itens).toEqual([]);
    /* Os descontos continuam entrando — é o que produz o sintoma confuso. */
    expect(lido.descontos.length).toBeGreaterThan(0);
    expect(lido.recusas.length).toBeGreaterThan(0);
    expect(lido.recusas[0]?.motivo).toContain("5 coluna(s) de valor");
    expect(lido.recusas[0]?.motivo).toContain("traz 6");
  });

  it("sem cabeçalho de seção: recusa aponta o recorte, não o layout", () => {
    const lido = lerPagamento(semCabecalhoDeSecao());
    expect(lido.itens).toEqual([]);
    expect(lido.recusas[0]?.motivo).toContain("fora de uma seção");
  });

  /**
   * `Recusa.original` existe para que a decisão possa ser revista sem reabrir o
   * arquivo — e como o arquivo não é guardado, "sem reabrir" aqui quer dizer
   * "sem pedir de volta a quem enviou".
   */
  it("a recusa carrega o texto original da linha", () => {
    const lido = lerPagamento(comUmaColunaAMenos());
    expect(lido.recusas[0]?.original).toContain("Frota Fixa Ativa");
    expect(lido.recusas[0]?.linha).toBeGreaterThan(0);
  });

  it("linha que não parece verba não vira recusa — o registro não é lixeira", () => {
    const lido = lerPagamento(
      Buffer.from("ROTA\r\nFRETE\r\ncabecalho qualquer\r\nrodape 1.234,56\r\n", "utf8"),
    );
    expect(lido.recusas).toEqual([]);
  });
});
