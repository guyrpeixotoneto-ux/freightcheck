import { describe, expect, it } from "vitest";
import {
  agruparPorVeiculoDeManutencao,
  codigosDoRecorteDeManutencao,
  conferenciaDaOrigem,
  impactoDeManutencao,
  resumirManutencao,
  totaisDeManutencaoPorVigencia,
  UNIDADE_NO_CSV,
  variacaoDoReaisKm,
  VARIAVEIS_DE_MANUTENCAO,
  celulasDoCsvDeManutencao,
  type LinhaDeManutencao,
  type ValorDeManutencao,
} from "../manutencao";

/**
 * A AUDITORIA DE MANUTENÇÃO.
 *
 * O que estes casos prendem é a recusa central desta rubrica — **R$/km não vira
 * reais aqui** — e o achado da origem: onde há contrato, o R$/km resolvido é o
 * do contrato; onde não há, ele não é o do BID e o export não explica o que é.
 *
 * Desde que o pneu saiu para `pneu.ts`, prendem também o que a separação
 * afirmou: esta rubrica é **do cavalo, e só dele**.
 */

const linha = (over: Partial<LinhaDeManutencao> = {}): LinhaDeManutencao => ({
  id: 1,
  entityLabel: "RPG0C44",
  entityType: "CAVALO",
  variavel: "reais_km",
  rotuloDaVariavel: "Manutenção R$/km",
  medida: "REAIS_POR_KM",
  attributeCode: "cavalo.manutencao_reais_km",
  base: "0.40",
  comparada: "0",
  diferenca: -0.4,
  variacao: -100,
  estado: "ALTERADO",
  motivo: null,
  impactoAmount: null,
  impactoPeriodicidade: null,
  impactoCalculado: false,
  foraDaSoma: null,
  ...over,
});

const valor = (over: Partial<ValorDeManutencao> = {}): ValorDeManutencao => ({
  ponta: "BASE",
  entityType: "CAVALO",
  entityLabel: "RPG0C44",
  reaisKm: 0.34,
  bid: 0.18,
  contrato: 0.34,
  vidaMeses: 59.8,
  freeMaintenance: 0,
  ...over,
});

describe("o catálogo — a manutenção é do cavalo, e só dele", () => {
  /*
    Enquanto o pneu morava aqui, esta era a única variável com código de carreta
    — e era a zerada. Com ele em `pneu.ts`, nenhuma sobrou, e o catálogo passou a
    dizer por estrutura o que o cabeçalho sempre disse por extenso: o
    `Modelo_Carreta` não declara coluna de manutenção nenhuma.
  */
  it("nenhuma variável tem código de carreta", () => {
    expect(VARIAVEIS_DE_MANUTENCAO.filter((v) => v.codigo.CARRETA)).toEqual([]);
  });

  it("o recorte de carreta devolve lista vazia, e isso é a resposta certa", () => {
    expect(codigosDoRecorteDeManutencao("CARRETA")).toEqual([]);
  });

  /* E o que saiu não voltou por engano: nenhum código de pneu continua no
     recorte que esta tela pede ao motor. */
  it("nenhum código de pneu sobrou no recorte", () => {
    const codigos = codigosDoRecorteDeManutencao("TODOS");
    expect(codigos.some((c) => c.includes("pneu"))).toBe(false);
  });
});

describe("o impacto — R$/km não vira reais", () => {
  /*
    A recusa central. O motor não precifica R$/km, e esta tela não multiplica por
    quilometragem nenhuma: o quilômetro é de outra leitura, de outro grão e de
    outra vigência.
  */
  it("o R$/km não entra em periodicidade, e sai contado à parte", () => {
    const impacto = impactoDeManutencao([linha()]);
    expect(impacto.porPeriodicidade).toEqual({});
    expect(impacto.alteracoesDeReaisKm).toBe(1);
  });

  /* Meses não são falha de cálculo: não são dinheiro, e dizer que faltou
     precificá-los prometeria uma conversão que não existe. */
  it("a vida em meses não conta como não precificada", () => {
    const impacto = impactoDeManutencao([
      linha({
        variavel: "vida_meses",
        rotuloDaVariavel: "Vida em meses",
        medida: "MESES",
        diferenca: -1,
      }),
    ]);
    expect(impacto.naoCalculavel).toBe(0);
    expect(impacto.alteracoesDeReaisKm).toBe(0);
  });

  it("as duplicatas saem pelo foraDaSoma", () => {
    const impacto = impactoDeManutencao([
      linha({ variavel: "reaiskm_solto", foraDaSoma: "Não se sabe o que ela é." }),
      linha({ variavel: "valor_reajustado", foraDaSoma: "É o contrato com outro nome." }),
    ]);
    expect(impacto.foraDaSoma).toBe(2);
    expect(impacto.alteracoesDeReaisKm).toBe(0);
  });
});

describe("a variação do R$/km — o número que a tela publica", () => {
  /*
    O caso medido no acervo: dois caminhões de R$ 0,40/km para zero e dois de
    zero para R$ 0,40/km. Líquido exatamente zero, e quatro contratos mexidos —
    um cartão que mostrasse só o líquido diria que nada aconteceu.
  */
  it("o líquido pode ser zero com quatro contratos mexidos", () => {
    const v = variacaoDoReaisKm([
      linha({ entityLabel: "A", diferenca: -0.4 }),
      linha({ entityLabel: "B", diferenca: -0.4 }),
      linha({ entityLabel: "C", diferenca: 0.4 }),
      linha({ entityLabel: "D", diferenca: 0.4 }),
    ]);
    expect(v.soma).toBe(0);
    expect(v.veiculos).toBe(4);
    expect(v.subiram).toBe(2);
    expect(v.cairam).toBe(2);
  });

  it("só conta a variável resolvida, e não o BID nem o contrato", () => {
    const v = variacaoDoReaisKm([
      linha(),
      linha({ variavel: "bid", diferenca: 0.1 }),
      linha({ variavel: "contrato", diferenca: 0.2 }),
    ]);
    expect(v.veiculos).toBe(1);
    expect(v.soma).toBe(-0.4);
  });
});

describe("a conferência da origem do R$/km", () => {
  it("com contrato, o resolvido é o do contrato", () => {
    const [o] = conferenciaDaOrigem([valor()]);
    expect(o.veredito).toBe("DO_CONTRATO");
    expect(o.doContrato).toBe(1);
  });

  it("sem contrato, o resolvido que bate com o BID é do BID", () => {
    const [o] = conferenciaDaOrigem([valor({ contrato: 0, reaisKm: 0.18 })]);
    expect(o.veredito).toBe("DO_BID");
    expect(o.doBid).toBe(1);
  });

  /* O achado: 432 caminhões do acervo caem aqui. */
  it("o que não é nem um nem outro fica sem origem", () => {
    const [o] = conferenciaDaOrigem([valor({ contrato: 0, reaisKm: 0.27 })]);
    expect(o.veredito).toBe("NAO_EXPLICADO");
    expect(o.semOrigem).toBe(1);
  });

  it("uns do contrato e outros sem origem dá MISTO — o caso do acervo", () => {
    const [o] = conferenciaDaOrigem([
      valor({ entityLabel: "A" }),
      valor({ entityLabel: "B", contrato: 0, reaisKm: 0.27 }),
    ]);
    expect(o.veredito).toBe("MISTO");
    expect(o.doContrato).toBe(1);
    expect(o.semOrigem).toBe(1);
  });

  /* Perguntar de onde vem um zero que ninguém cobrou não é a pergunta: o
     caminhão zerado é free maintenance. */
  it("o caminhão de R$/km zerado fica fora da conferência", () => {
    const [o] = conferenciaDaOrigem([valor({ reaisKm: 0, contrato: 0 })]);
    expect(o.veredito).toBe("BASE_INSUFICIENTE");
    expect(o.ativos).toBe(0);
  });
});

describe("os totais — média, e nunca soma", () => {
  /* Dois caminhões a R$ 0,30/km não custam R$ 0,60 por quilômetro. */
  it("a média é a única leitura que sobrevive à agregação", () => {
    const [t] = totaisDeManutencaoPorVigencia([
      valor({ entityLabel: "A", reaisKm: 0.2 }),
      valor({ entityLabel: "B", reaisKm: 0.4 }),
    ]);
    expect(t.mediaReaisKm).toBe(0.3);
    expect(t.veiculos).toBe(2);
  });

  it("os zeros entram na média e saem contados", () => {
    const [t] = totaisDeManutencaoPorVigencia([
      valor({ entityLabel: "A", reaisKm: 0 }),
      valor({ entityLabel: "B", reaisKm: 0.4 }),
    ]);
    expect(t.mediaReaisKm).toBe(0.2);
    expect(t.zerados).toBe(1);
  });

  it("conta quantos têm contrato — a origem que o export explica", () => {
    const [t] = totaisDeManutencaoPorVigencia([
      valor({ entityLabel: "A" }),
      valor({ entityLabel: "B", contrato: 0 }),
    ]);
    expect(t.comContrato).toBe(1);
  });
});

describe("o CSV leva a unidade junto", () => {
  /*
    A coluna que só este arquivo tem. Sem ela, o Excel mostra R$/km, meses e
    percentual como quatro números da mesma natureza — e foi assim que a coluna
    "mensal" do IPVA virou soma na planilha de outra pessoa.
  */
  it("escreve a unidade de cada linha", () => {
    expect(celulasDoCsvDeManutencao(linha())[3]).toBe("R$/km");
    expect(celulasDoCsvDeManutencao(linha({ medida: "MESES" }))[3]).toBe("meses");
    expect(celulasDoCsvDeManutencao(linha({ medida: "PERCENTUAL" }))[3]).toBe("%");
    expect(UNIDADE_NO_CSV.DINHEIRO).toBe("R$");
  });
});

describe("o agrupamento e o resumo", () => {
  it("o destaque da placa é o R$/km resolvido", () => {
    const [veiculo] = agruparPorVeiculoDeManutencao([
      linha(),
      linha({ id: 2, variavel: "bid", rotuloDaVariavel: "R$/km do BID", diferenca: 0.02 }),
    ]);
    expect(veiculo.destaque?.base).toBe(0.4);
    expect(veiculo.alteracoes).toBe(2);
  });

  it("o resumo carrega a variação do R$/km junto", () => {
    const resumo = resumirManutencao([linha()], { comparados: 60, novos: 0, ausentes: 0 });
    expect(resumo.reaisKm.veiculos).toBe(1);
    expect(resumo.reaisKm.cairam).toBe(1);
    expect(resumo.semAlteracao).toBe(59);
  });
});
