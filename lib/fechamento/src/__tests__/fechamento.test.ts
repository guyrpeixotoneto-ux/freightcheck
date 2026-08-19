import { describe, expect, it } from "vitest";
import {
  apurar,
  competencia,
  competenciaDaChave,
  competenciaDoDia,
  diaDeDDMMAAAA,
  diaDeSerial,
  diaDeTextoBR,
  lerCanal,
  lerConciliacao,
  lerCtes,
  lerDisponibilidade,
  lerFrota,
  lerNumero,
  lerOperacao,
  lerRequisicoes,
  medirAliquotas,
  valorDe,
} from "../index";
import {
  FATOR,
  SERIAL_16_07_2026,
  fixtureConciliacao,
  fixtureCtes,
  fixtureDisponibilidade,
  fixtureOperacao,
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
    expect(lido.linhas).toHaveLength(4);
    expect(lido.recusas).toEqual([
      { linha: 4, motivo: "O canal da viagem não é Rota nem AS.", original: "Entrega?" },
    ]);
  });

  it("reproduz o total do dia por tipo de frota — o que as abas 01..31 da planilha faziam", () => {
    const doDia = (frota: string) =>
      lido.linhas
        .filter((v) => v.dia === "2026-07-16" && v.canal === "ROTA" && v.frota === frota)
        .reduce((s, v) => s + v.valorFaturado, 0);
    expect(doDia("PADRAO")).toBe(1500);
    expect(doDia("SPOT")).toBe(300);
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

  it("roda com o que há e nomeia a fonte que falta", () => {
    const semConciliacao = apurar(competencia(2026, 7, 2), { ...fontes, conciliacao: undefined });
    expect(semConciliacao.fontesAusentes).toEqual(["CONCILIACAO"]);
    /* Sem a conciliação, a verba 5 perde a origem — e vira não conferida, não zero. */
    expect(semConciliacao.verbas.find((v) => v.verba.vbz === 5)?.esperado).toBeNull();
    expect(semConciliacao.totais.emitido).toBe(apuracao.totais.emitido);
  });

  it("soma o emitido de todas as verbas, conferidas ou não", () => {
    expect(apuracao.totais.emitido).toBe(1100 + 750 + 500 + 2000 + 100);
    expect(apuracao.totais.diferenca).toBe(0);
  });
});
