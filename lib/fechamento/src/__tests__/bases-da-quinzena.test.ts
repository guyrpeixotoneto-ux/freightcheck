import { describe, expect, it } from "vitest";

import { basesDaQuinzena } from "../persistencia";
import {
  memoriaDaDisponibilidade,
  memoriaDaIndisponibilidade,
  memoriaDeOutrosCustos,
  valorDaDisponibilidade,
  valorDaIndisponibilidade,
  valorDeOutrosCustos,
  type ViagemDoMapa,
} from "../mapa-rota";

/**
 * De onde saem as bases que o motor desconta — sem banco.
 *
 * `basesDaQuinzena` é aritmética sobre listas, e é a única coisa que decide
 * **qual documento alimenta qual linha da planilha**. O resto de
 * `persistencia.ts` precisa de Postgres; esta função não, e é ela que carrega a
 * decisão. Foi para preservar isso que as duas fontes novas — o 2Art e o
 * 03.08.12.09 — entram por parâmetro já lidas, em vez de a função ir ao banco.
 *
 * Os números são os de julho/2026 — CDD Belém · Horizonte —, lidos do próprio
 * demonstrativo. Ver `docs/MAPA-ROTA.md` para o elo entre eles e as células
 * digitadas à mão no `Mapa Rota`.
 */
const ROTA = "ROTA" as const;

const DESCONTOS_1A = [
  { canal: ROTA, tipo: "DEVOLUCAO", valor: 13328.3 },
  { canal: ROTA, tipo: "FRETE_MINIMO", valor: 11649.87 },
];

const DESCONTOS_2A = [
  { canal: ROTA, tipo: "DEVOLUCAO", valor: 15763.61 },
  { canal: ROTA, tipo: "DISPONIBILIDADE_CUSTO_FIXO", valor: 0 },
  { canal: ROTA, tipo: "DISPONIBILIDADE_EQUIPE", valor: 91321.65 },
  { canal: ROTA, tipo: "DISPONIBILIDADE_INDIRETO", valor: 0 },
  { canal: ROTA, tipo: "DISPONIBILIDADE_FATOR_AJUDANTE", valor: 320.85 },
  { canal: ROTA, tipo: "FRETE_MINIMO", valor: 14050.54 },
];

const viagem = (p: Partial<ViagemDoMapa> = {}): ViagemDoMapa => ({
  frota: "Padrao",
  cargaAtual: "Roteriz",
  tipoDeImposto: "CTRC-ICMS",
  valorFaturado: 0,
  caixasDeRota: 100,
  caixasDeAs: 0,
  tipoDeIndisponibilidade: "",
  ...p,
});

/** Um diário de um dia — a forma que o motor consome. */
const diarioDe = (...viagens: ViagemDoMapa[]) => [{ viagens }];

/** O 03.08.18 do mês não foi importado — a disponibilidade fica `null`. */
const SEM_DISP = null;

/**
 * O 03.08.18 do mês, somado — como `disponibilidadeDoMes` o entrega.
 *
 * Os números são os reais de julho/2026: `FF` + `Van`, dias 1 a 31, canal Rota.
 */
const doMes = (quinzena: 1 | 2, total = 91642.5, dias = 29) => ({
  quinzena,
  doMes: {
    total,
    parcelas: { custoFixo: 21388.36, equipe: 69933.29, indiretos: 0, fatorAjudante: 320.85 },
    agrupadoComoNoDemonstrativo: 91321.65,
    dias,
    periodo: { de: "2026-07-01", ate: "2026-07-31" },
  },
});

/** Um diário com movimento e nenhuma marca de indisponibilidade. */
const SEM_MARCA = diarioDe(viagem({ valorFaturado: 285.16 }), viagem({ valorFaturado: 310.4 }));

describe("basesDaQuinzena", () => {
  it("o frete mínimo é o complementar negativo — a 2ª quinzena fecha ao centavo", () => {
    const bases = basesDaQuinzena(DESCONTOS_2A, ROTA, SEM_MARCA, null, SEM_DISP);

    expect(bases.devolucao).toBe(15763.61);
    /* `Mapa Rota!AH140` traz exatamente este número, digitado à mão. */
    expect(bases.complementarNegativo).toBe(14050.54);
  });

  it("sem demonstrativo, nenhuma base de desconto é inventada", () => {
    const bases = basesDaQuinzena(null, ROTA, SEM_MARCA, null, SEM_DISP);

    expect(bases.devolucao).toBeNull();
    expect(bases.complementarNegativo).toBeNull();
  });

  it("não empresta desconto de outro canal", () => {
    const bases = basesDaQuinzena(DESCONTOS_2A, "AS", SEM_MARCA, null, SEM_DISP);

    expect(bases.devolucao).toBeNull();
    expect(bases.complementarNegativo).toBeNull();
  });
});

/**
 * A DISPONIBILIDADE — do 03.08.18, do mês, aplicada na 2ª quinzena.
 *
 * A base saía do 03.08.20, o que dava o número certo na 2ª e `null` na 1ª —
 * porque o demonstrativo daquela metade não traz o bloco. A regra é outra: o
 * desconto é acumulado no mês e aplicado uma vez, no fechamento da 2ª. Ver
 * `descontoDeDisponibilidadeDoMes`, em `leitores/disponibilidade.ts`.
 */
describe("o desconto de disponibilidade sai do 03.08.18, e é do mês", () => {
  it("na 2ª quinzena entra o mês inteiro", () => {
    const bases = basesDaQuinzena(DESCONTOS_2A, ROTA, SEM_MARCA, null, doMes(2));
    expect(bases.disponibilidade).not.toBeNull();
    expect(valorDaDisponibilidade(bases.disponibilidade!)).toBe(91642.5);
  });

  /*
    Zero, e não `null`. `null` diria "falta o documento" e mandaria alguém
    procurar o que não existe; zero diz o que é verdade — não há abatimento
    nesta metade do mês.
  */
  it("na 1ª quinzena vale zero **por regra**, com o acumulado à vista", () => {
    const bases = basesDaQuinzena(DESCONTOS_1A, ROTA, SEM_MARCA, null, doMes(1));
    expect(bases.disponibilidade).not.toBeNull();
    expect(valorDaDisponibilidade(bases.disponibilidade!)).toBe(0);

    const memoria = memoriaDaDisponibilidade(bases.disponibilidade!);
    expect(memoria).toContain("zero por regra");
    expect(memoria).toContain("2ª quinzena");
    /* O acumulado do mês aparece mesmo sem descontar — é o que torna o zero conferível. */
    expect(memoria).toContain("91.642,50");
  });

  it("sem o 03.08.18 do mês a linha fica `null`", () => {
    const bases = basesDaQuinzena(DESCONTOS_2A, ROTA, SEM_MARCA, null, SEM_DISP);
    expect(bases.disponibilidade).toBeNull();
  });

  /*
    O 03.08.20 vira conferência: ele não entra na conta, e é guardado para a
    divergência aparecer sem uma segunda leitura do banco.
  */
  it("o bloco do 03.08.20 entra como conferência, e confere ao centavo", () => {
    const bases = basesDaQuinzena(DESCONTOS_2A, ROTA, SEM_MARCA, null, doMes(2));
    const memoria = memoriaDaDisponibilidade(bases.disponibilidade!);
    expect(memoria).toContain("29 dias do mês");
    expect(memoria).toContain("confere ao centavo");
  });

  it("quando o 03.08.20 discorda, a memória diz de quanto", () => {
    const bases = basesDaQuinzena(DESCONTOS_2A, ROTA, SEM_MARCA, null, doMes(2, 90000));
    const memoria = memoriaDaDisponibilidade(bases.disponibilidade!);
    expect(memoria).toContain("divergência");
  });

  it("sem o 03.08.20 a conferência fica em aberto, e o devido não muda", () => {
    const bases = basesDaQuinzena(null, ROTA, SEM_MARCA, null, doMes(2));
    expect(valorDaDisponibilidade(bases.disponibilidade!)).toBe(91642.5);
    expect(memoriaDaDisponibilidade(bases.disponibilidade!)).toContain("sem o 03.08.20");
  });
});


/**
 * A INDISPONIBILIDADE — a linha que estava sem lastro, e a fonte que a sustenta.
 *
 * `docs/MAPA-ROTA.md` rastreia `INDISPONIBILIDADE` até `Mapa Rota!132`, que soma
 * a coluna `BP` das abas diárias: o faturado das viagens com tipo de
 * indisponibilidade. A coluna existe no 2Art (`TipoIndisp`) e o banco já a
 * guardava — o que faltava era ligá-la.
 */
describe("a indisponibilidade sai do 2Art", () => {
  it("soma o faturado só das viagens que trazem marca", () => {
    const diario = diarioDe(
      viagem({ valorFaturado: 1000 }),
      viagem({ valorFaturado: 400, tipoDeIndisponibilidade: "Manutenção" }),
      viagem({ valorFaturado: 250, tipoDeIndisponibilidade: "Sinistro" }),
    );

    const b = basesDaQuinzena(DESCONTOS_2A, ROTA, diario, null, SEM_DISP);
    expect(b.indisponibilidade).not.toBeNull();
    expect(valorDaIndisponibilidade(b.indisponibilidade!)).toBe(650);
  });

  it("a memória nomeia os motivos e o denominador — é conferível contra o 2Art", () => {
    const diario = diarioDe(
      viagem({ valorFaturado: 1000 }),
      viagem({ valorFaturado: 400, tipoDeIndisponibilidade: "Manutenção" }),
      viagem({ valorFaturado: 250, tipoDeIndisponibilidade: "Sinistro" }),
    );

    const memoria = memoriaDaIndisponibilidade(
      basesDaQuinzena(DESCONTOS_2A, ROTA, diario, null, SEM_DISP).indisponibilidade!,
    );
    expect(memoria).toContain("2 de 3 viagens");
    expect(memoria).toContain("Manutenção");
    expect(memoria).toContain("Sinistro");
  });

  it("a viagem que rodou AS não entra — o corte é o mesmo do variável", () => {
    const diario = diarioDe(
      viagem({ valorFaturado: 400, tipoDeIndisponibilidade: "Manutenção" }),
      viagem({
        valorFaturado: 900,
        tipoDeIndisponibilidade: "Manutenção",
        caixasDeRota: 0,
        caixasDeAs: 500,
      }),
    );

    const b = basesDaQuinzena(DESCONTOS_2A, ROTA, diario, null, SEM_DISP);
    expect(valorDaIndisponibilidade(b.indisponibilidade!)).toBe(400);
  });

  it("diário sem marca nenhuma vale zero **medido**, e a memória diz sobre quantas", () => {
    const b = basesDaQuinzena(DESCONTOS_2A, ROTA, SEM_MARCA, null, SEM_DISP);

    expect(valorDaIndisponibilidade(b.indisponibilidade!)).toBe(0);
    /*
      É o caso de julho/2026: a planilha escreve 0 nas duas quinzenas. O que o
      produto acrescenta é o denominador — um zero sobre duas viagens é uma
      afirmação que o 2Art aberto ao lado derruba num filtro.
    */
    expect(memoriaDaIndisponibilidade(b.indisponibilidade!)).toContain(
      "nenhuma das 2 viagens de Rota",
    );
  });

  it("sem diário, é null e não zero — falta arquivo, não falta indisponibilidade", () => {
    const b = basesDaQuinzena(DESCONTOS_2A, ROTA, [], null, SEM_DISP);
    expect(b.indisponibilidade).toBeNull();
  });

  /**
   * O teste que existe para impedir a confusão que o rótulo convida.
   *
   * `INDISPONIBILIDADE` (parcela, quadro do fixo, do 2Art) e `DESCONTO
   * DISPONIBILIDADE` (desconto, do 03.08.20) têm nomes quase iguais e são
   * dinheiro em direções opostas. Um dia alguém vai olhar as duas e achar que
   * uma pode preencher a outra; este teste é a resposta.
   */
  it("não é o desconto de disponibilidade — fontes, arquivos e sinais diferentes", () => {
    const diario = diarioDe(viagem({ valorFaturado: 400, tipoDeIndisponibilidade: "Manutenção" }));
    const b = basesDaQuinzena(DESCONTOS_2A, ROTA, diario, null, doMes(2));

    /* A parcela sai do **2Art** e vale o faturado das viagens com marca. */
    expect(valorDaIndisponibilidade(b.indisponibilidade!)).toBe(400);
    /* O desconto sai do **03.08.18**, do mês inteiro — outro arquivo, outro número. */
    expect(valorDaDisponibilidade(b.disponibilidade!)).toBe(91642.5);
    expect(valorDaIndisponibilidade(b.indisponibilidade!)).not.toBe(
      valorDaDisponibilidade(b.disponibilidade!),
    );

    /*
      E a independência é nos dois sentidos: sem o 03.08.18 a parcela continua
      de pé, porque ela nunca dependeu dele.
    */
    const semDisp = basesDaQuinzena(DESCONTOS_1A, ROTA, diario, null, SEM_DISP);
    expect(semDisp.disponibilidade).toBeNull();
    expect(valorDaIndisponibilidade(semDisp.indisponibilidade!)).toBe(400);
  });
});

/**
 * OS OUTROS CUSTOS — a segunda linha que estava permanentemente sem devido.
 *
 * `Outros Custos!F4` declara a origem: o 03.08.12.09. A amostra de julho/2026
 * fecha a prova — a 2ª quinzena traz 358.530,22 na célula, e a tabela "De onde
 * vem o dinheiro do mês" atribui exatamente R$ 358.530,22 ao 03.08.12.09.
 */
describe("os outros custos saem do 03.08.12.09", () => {
  const REQUISICOES = [
    { canal: ROTA, status: "Aprovada", valor: 300000, vbz: 9 },
    { canal: ROTA, status: "Aprovada", valor: 58530.22, vbz: 9 },
    { canal: ROTA, status: "Pendente", valor: 12000, vbz: 9 },
    { canal: ROTA, status: "Reprovada", valor: 9000, vbz: 9 },
    { canal: "AS" as const, status: "Aprovada", valor: 77000, vbz: 9 },
  ];

  it("soma só as aprovadas, e só as do canal", () => {
    const b = basesDaQuinzena(DESCONTOS_2A, ROTA, SEM_MARCA, REQUISICOES, SEM_DISP);
    expect(valorDeOutrosCustos(b.outrosCustos!)).toBe(358530.22);
  });

  it("a memória traz o denominador — quantas aprovadas de quantas recebidas", () => {
    const b = basesDaQuinzena(DESCONTOS_2A, ROTA, SEM_MARCA, REQUISICOES, SEM_DISP);
    expect(memoriaDeOutrosCustos(b.outrosCustos!)).toContain("2 de 4 requisições");
  });

  it("o status é lido sem depender de caixa nem de espaço", () => {
    const b = basesDaQuinzena(DESCONTOS_2A, ROTA, SEM_MARCA, [
      { canal: ROTA, status: "  APROVADA ", valor: 100, vbz: 9 },
    ], SEM_DISP);
    expect(valorDeOutrosCustos(b.outrosCustos!)).toBe(100);
  });

  it("relatório sem nenhuma aprovada vale zero **medido**, não ausência", () => {
    const b = basesDaQuinzena(DESCONTOS_2A, ROTA, SEM_MARCA, [
      { canal: ROTA, status: "Pendente", valor: 5000, vbz: 9 },
    ], SEM_DISP);
    expect(valorDeOutrosCustos(b.outrosCustos!)).toBe(0);
    expect(memoriaDeOutrosCustos(b.outrosCustos!)).toContain("nenhuma das 1 requisições");
  });

  it("relatório sem requisição deste canal vale zero, e a frase diz que ele chegou", () => {
    const b = basesDaQuinzena(DESCONTOS_2A, ROTA, SEM_MARCA, [
      { canal: "AS" as const, status: "Aprovada", valor: 77000, vbz: 9 },
    ], SEM_DISP);
    expect(valorDeOutrosCustos(b.outrosCustos!)).toBe(0);
    expect(memoriaDeOutrosCustos(b.outrosCustos!)).toContain("não traz requisição deste canal");
  });

  it("sem 03.08.12.09, é null e não zero — falta arquivo, não falta despesa", () => {
    const b = basesDaQuinzena(DESCONTOS_2A, ROTA, SEM_MARCA, null, SEM_DISP);
    expect(b.outrosCustos).toBeNull();
  });
});
