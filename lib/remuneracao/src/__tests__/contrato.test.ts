import { describe, expect, it } from "vitest";

import {
  CHAVES_OBRIGATORIAS,
  contratoDaPlanilha,
  vigenciaQueResponde,
} from "../contrato";

/**
 * A aba `Cadastro` de julho/2026 — CDD Belém · Horizonte — como a **tela** a
 * guarda.
 *
 * Os números são os mesmos da `.xlsb` que a transportadora usa hoje, e a
 * diferença de escala é o ponto do teste: a aba de Excel escreve `0,1784` e a
 * tela de cadastro escreve `17,84`, porque `conferirCelula` recusa percentual
 * em fração. Se a conversão se perder, o fator de imposto sai cem vezes errado
 * e o `CUSTO FIXO PADRONIZADO` deixa de fechar — que é exatamente a classe de
 * erro que este arquivo existe para tornar impossível de passar despercebida.
 *
 * O que o contrato produzido tem de valer está provado do outro lado, em
 * `@workspace/fechamento` (`mapa-rota.test.ts`): com estes parâmetros o motor
 * imprime o `RESUMO GERAL` da planilha real. Aqui se prova só a tradução.
 */
const DIGITADO_1A_QUINZENA = new Map<string, number>([
  ["aliquota_pis", 0.65],
  ["aliquota_cofins", 8.6],
  ["aliquota_icms", 17.84],
  ["aliquota_iss", 5.9],
  ["rota_percentual_iss", 3.16],
  ["frota_fixa_ativos", 56],
  ["frota_fixa_inativos", 8],
  ["ativo_remuneracao_fixa_frota", 1424.91],
  ["ativo_remuneracao_fixa_equipe", 8919.38],
  ["ativo_custo_variavel", 5176.53],
  ["ativo_remuneracao_fixa_qlp", 4427.53],
  ["ativo_outras_despesas", 4361.07],
  ["inativo_remuneracao_fixa", 1650.97],
  ["van_quantidade_ativas", 7],
  ["van_custo_fixo", 4693.85],
  ["van_custo_equipe", 4250.45],
  ["van_quantidade_inativas", 6],
  ["van_remuneracao_inativas", 3195.18],
  ["noturna_quantidade_rotas", 1],
  ["noturna_custo_sem_impostos", 8697.88],
  ["marketing_sem_impostos", 0],
]);

describe("contratoDaPlanilha", () => {
  it("traduz a aba de julho/2026 nos parâmetros que o motor consome", () => {
    const { contrato, faltam } = contratoDaPlanilha(DIGITADO_1A_QUINZENA);

    expect(faltam).toEqual([]);
    expect(contrato).not.toBeNull();

    const p = contrato!.parametros;
    /* Percentual em pontos vira fração — a conversão que o motor não faz. */
    expect(p.aliquotas.pis).toBeCloseTo(0.0065, 10);
    expect(p.aliquotas.cofins).toBeCloseTo(0.086, 10);
    expect(p.aliquotas.icms).toBeCloseTo(0.1784, 10);
    expect(p.aliquotas.iss).toBeCloseTo(0.059, 10);
    expect(p.parcelaDentroDoMunicipio).toBeCloseTo(0.0316, 10);

    /* Dinheiro e quantidade atravessam sem escala: o contrato é mensal. */
    expect(p.frotaFixaAtiva).toBe(56);
    expect(p.frotaFixaInativa).toBe(8);
    expect(p.remuneracaoFixaDaFrotaAtiva).toBe(1424.91);
    expect(p.remuneracaoDaEquipeDeEntrega).toBe(8919.38);
    expect(p.remuneracaoDoQlpAdministrativo).toBe(4427.53);
    expect(p.remuneracaoDeOutrasDespesas).toBe(4361.07);
    expect(p.remuneracaoDaFrotaInativa).toBe(1650.97);
    expect(p.vansAtivas).toBe(7);
    expect(p.custoFixoDaVan).toBe(4693.85);
    expect(p.custoDaEquipeDeEntregaDaVan).toBe(4250.45);
    expect(p.vansInativas).toBe(6);
    expect(p.remuneracaoDasVansInativas).toBe(3195.18);
    expect(p.rotasNoturnas).toBe(1);
    expect(p.custoDaNoturnaSemImposto).toBe(8697.88);
    expect(p.custoDeMarketingSemImposto).toBe(0);
  });

  it("soma o lucro previsto na base do variável, que é como a aba a usa", () => {
    const com = new Map(DIGITADO_1A_QUINZENA).set("ativo_lucro_operacional", 1000);
    expect(contratoDaPlanilha(com).contrato!.custoVariavelPrevistoPor25Viagens).toBe(6176.53);
    /* Sem a linha do lucro, a base é o custo variável sozinho. */
    expect(
      contratoDaPlanilha(DIGITADO_1A_QUINZENA).contrato!.custoVariavelPrevistoPor25Viagens,
    ).toBe(5176.53);
  });

  it("não devolve contrato quando falta uma obrigatória, e diz qual", () => {
    const semFrota = new Map(DIGITADO_1A_QUINZENA);
    semFrota.delete("frota_fixa_ativos");

    const lido = contratoDaPlanilha(semFrota);
    expect(lido.contrato).toBeNull();
    expect(lido.faltam).toEqual([
      { chave: "frota_fixa_ativos", rotulo: "Total Frota Fixa Ativos" },
    ]);
  });

  it("uma aba vazia falta todas as obrigatórias, e nenhuma a mais", () => {
    const lido = contratoDaPlanilha(new Map());
    expect(lido.contrato).toBeNull();
    expect(lido.faltam.map((f) => f.chave)).toEqual(CHAVES_OBRIGATORIAS);
    expect(lido.faltam.every((f) => f.rotulo !== f.chave)).toBe(true);
  });

  it("marketing e lucro em branco entram como zero — e são ditos", () => {
    const sem = new Map(DIGITADO_1A_QUINZENA);
    sem.delete("marketing_sem_impostos");

    const lido = contratoDaPlanilha(sem);
    expect(lido.contrato).not.toBeNull();
    expect(lido.contrato!.parametros.custoDeMarketingSemImposto).toBe(0);
    expect(lido.assumidasComoZero.map((a) => a.chave).sort()).toEqual([
      "ativo_lucro_operacional",
      "marketing_sem_impostos",
    ]);
  });
});

describe("vigenciaQueResponde", () => {
  it("responde com a planilha da própria quinzena", () => {
    expect(vigenciaQueResponde("2026-07-16", ["2026-07-01", "2026-07-16"])).toEqual({
      vigenteDe: "2026-07-16",
    });
    expect(vigenciaQueResponde("2026-07-01", ["2026-07-01", "2026-07-16"])).toEqual({
      vigenteDe: "2026-07-01",
    });
  });

  it("NÃO herda a aba da outra quinzena — nos dois sentidos", () => {
    /*
      A regra que este bloco defendia era a oposta, e ela pagava uma quinzena com
      o contrato da outra em silêncio. Em julho/2026 seis parâmetros mudam entre
      as metades, e a herança deu R$ 14.817,52 de diferença numa linha só, num
      número que a tela apresentava como qualquer outro.

      Sem a aba da quinzena não se sabe o que foi contratado nela. `null` aqui é
      o que faz a tela pedir o cadastro em vez de exibir um número emprestado.
    */
    expect(vigenciaQueResponde("2026-07-16", ["2026-07-01"])).toBeNull();
    expect(vigenciaQueResponde("2026-07-01", ["2026-07-16"])).toBeNull();
  });

  it("não atravessa o mês: junho não responde por julho", () => {
    expect(vigenciaQueResponde("2026-07-01", ["2026-06-01", "2026-06-16"])).toBeNull();
    expect(vigenciaQueResponde("2026-07-16", ["2026-08-01"])).toBeNull();
  });

  it("duas vigências na mesma metade do mês: vale a mais recente", () => {
    /*
      O que sobrou da regra antiga, e continua certo: duas abas na mesma metade
      são correção, não contrato diferente — a mais nova é a que vale.
    */
    expect(vigenciaQueResponde("2026-07-01", ["2026-07-01", "2026-07-08"])).toEqual({
      vigenteDe: "2026-07-08",
    });
  });

  it("a régua da quinzena é a do produto: o dia 15 ainda é a primeira", () => {
    /*
      E por isso a aba de 15/07 **não** responde pela 2ª quinzena: ela é da
      primeira metade. Antes respondia, por herança.
    */
    expect(vigenciaQueResponde("2026-07-16", ["2026-07-15"])).toBeNull();
    expect(vigenciaQueResponde("2026-07-01", ["2026-07-15"])).toEqual({
      vigenteDe: "2026-07-15",
    });
  });

  it("sem planilha nenhuma, ninguém responde", () => {
    expect(vigenciaQueResponde("2026-07-01", [])).toBeNull();
  });
});
