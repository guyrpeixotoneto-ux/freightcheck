import { describe, expect, it } from "vitest";

import { basesDaQuinzena } from "../persistencia";
import {
  memoriaDaIndisponibilidade,
  memoriaDeOutrosCustos,
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

/** Um diário com movimento e nenhuma marca de indisponibilidade. */
const SEM_MARCA = diarioDe(viagem({ valorFaturado: 285.16 }), viagem({ valorFaturado: 310.4 }));

describe("basesDaQuinzena", () => {
  it("o frete mínimo é o complementar negativo — a 2ª quinzena fecha ao centavo", () => {
    const bases = basesDaQuinzena(DESCONTOS_2A, ROTA, SEM_MARCA, null);

    expect(bases.devolucao).toBe(15763.61);
    /* Os quatro da disponibilidade somados, como o bloco do relatório os traz. */
    expect(bases.disponibilidade).toBe(91642.5);
    /* `Mapa Rota!AH140` traz exatamente este número, digitado à mão. */
    expect(bases.complementarNegativo).toBe(14050.54);
  });

  it("na 1ª quinzena não há bloco de disponibilidade, e ela fica null", () => {
    const bases = basesDaQuinzena(DESCONTOS_1A, ROTA, SEM_MARCA, null);

    expect(bases.devolucao).toBe(13328.3);
    /*
      `null`, e não zero: o relatório da 1ª quinzena não traz o bloco
      `DESCONTO DISPONIBILIDADE`, e "não veio" é outra afirmação que "valeu
      zero". A planilha põe 11.649,87 nesta linha — o frete mínimo, que é o
      complementar —, e é essa discordância que a coluna `Diferença` mostra.
    */
    expect(bases.disponibilidade).toBeNull();
    expect(bases.complementarNegativo).toBe(11649.87);
  });

  it("sem demonstrativo, nenhuma base de desconto é inventada", () => {
    const bases = basesDaQuinzena(null, ROTA, SEM_MARCA, null);

    expect(bases.devolucao).toBeNull();
    expect(bases.disponibilidade).toBeNull();
    expect(bases.complementarNegativo).toBeNull();
  });

  it("não empresta desconto de outro canal", () => {
    const bases = basesDaQuinzena(DESCONTOS_2A, "AS", SEM_MARCA, null);

    expect(bases.devolucao).toBeNull();
    expect(bases.disponibilidade).toBeNull();
    expect(bases.complementarNegativo).toBeNull();
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

    const b = basesDaQuinzena(DESCONTOS_2A, ROTA, diario, null);
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
      basesDaQuinzena(DESCONTOS_2A, ROTA, diario, null).indisponibilidade!,
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

    const b = basesDaQuinzena(DESCONTOS_2A, ROTA, diario, null);
    expect(valorDaIndisponibilidade(b.indisponibilidade!)).toBe(400);
  });

  it("diário sem marca nenhuma vale zero **medido**, e a memória diz sobre quantas", () => {
    const b = basesDaQuinzena(DESCONTOS_2A, ROTA, SEM_MARCA, null);

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
    const b = basesDaQuinzena(DESCONTOS_2A, ROTA, [], null);
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
  it("não é o desconto de disponibilidade do 03.08.20 — fontes e sinais diferentes", () => {
    const diario = diarioDe(viagem({ valorFaturado: 400, tipoDeIndisponibilidade: "Manutenção" }));
    const b = basesDaQuinzena(DESCONTOS_2A, ROTA, diario, null);

    /* A parcela sai do diário e vale o faturado das viagens com marca. */
    expect(valorDaIndisponibilidade(b.indisponibilidade!)).toBe(400);
    /* O desconto sai do 03.08.20 e vale o bloco inteiro — outro número. */
    expect(b.disponibilidade).toBe(91642.5);
    expect(valorDaIndisponibilidade(b.indisponibilidade!)).not.toBe(b.disponibilidade);

    /*
      E a independência é nos dois sentidos: sem o bloco do demonstrativo a
      parcela continua de pé, porque ela nunca dependeu dele.
    */
    const semBloco = basesDaQuinzena(DESCONTOS_1A, ROTA, diario, null);
    expect(semBloco.disponibilidade).toBeNull();
    expect(valorDaIndisponibilidade(semBloco.indisponibilidade!)).toBe(400);
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
    { canal: ROTA, status: "Aprovada", valor: 300000 },
    { canal: ROTA, status: "Aprovada", valor: 58530.22 },
    { canal: ROTA, status: "Pendente", valor: 12000 },
    { canal: ROTA, status: "Reprovada", valor: 9000 },
    { canal: "AS" as const, status: "Aprovada", valor: 77000 },
  ];

  it("soma só as aprovadas, e só as do canal", () => {
    const b = basesDaQuinzena(DESCONTOS_2A, ROTA, SEM_MARCA, REQUISICOES);
    expect(valorDeOutrosCustos(b.outrosCustos!)).toBe(358530.22);
  });

  it("a memória traz o denominador — quantas aprovadas de quantas recebidas", () => {
    const b = basesDaQuinzena(DESCONTOS_2A, ROTA, SEM_MARCA, REQUISICOES);
    expect(memoriaDeOutrosCustos(b.outrosCustos!)).toContain("2 de 4 requisições");
  });

  it("o status é lido sem depender de caixa nem de espaço", () => {
    const b = basesDaQuinzena(DESCONTOS_2A, ROTA, SEM_MARCA, [
      { canal: ROTA, status: "  APROVADA ", valor: 100 },
    ]);
    expect(valorDeOutrosCustos(b.outrosCustos!)).toBe(100);
  });

  it("relatório sem nenhuma aprovada vale zero **medido**, não ausência", () => {
    const b = basesDaQuinzena(DESCONTOS_2A, ROTA, SEM_MARCA, [
      { canal: ROTA, status: "Pendente", valor: 5000 },
    ]);
    expect(valorDeOutrosCustos(b.outrosCustos!)).toBe(0);
    expect(memoriaDeOutrosCustos(b.outrosCustos!)).toContain("nenhuma das 1 requisições");
  });

  it("relatório sem requisição deste canal vale zero, e a frase diz que ele chegou", () => {
    const b = basesDaQuinzena(DESCONTOS_2A, ROTA, SEM_MARCA, [
      { canal: "AS" as const, status: "Aprovada", valor: 77000 },
    ]);
    expect(valorDeOutrosCustos(b.outrosCustos!)).toBe(0);
    expect(memoriaDeOutrosCustos(b.outrosCustos!)).toContain("não traz requisição deste canal");
  });

  it("sem 03.08.12.09, é null e não zero — falta arquivo, não falta despesa", () => {
    const b = basesDaQuinzena(DESCONTOS_2A, ROTA, SEM_MARCA, null);
    expect(b.outrosCustos).toBeNull();
  });
});
