import { describe, expect, it } from "vitest";
import { contratoDaPlanilha, CHAVES_OBRIGATORIAS } from "../contrato";
import { montarCadastro, type MaterialDoCadastro } from "../montagem";
import { medirSituacao } from "../situacao";
import type { PlanilhaDeclarada } from "../informado";
import type { TrechoDaVigencia } from "../medicao";

/**
 * LASTRO E DEVIDO SÃO EIXOS INDEPENDENTES — e este arquivo é o que os prende.
 *
 * A regra de negócio, escrita para não voltar a ser confundida:
 *
 * - **cadastro** responde *qual é o parâmetro contratado* — sai da aba digitada;
 * - **lastro** responde *quanto disso eu consigo comprovar por documento* — sai
 *   do acervo;
 * - o **devido** depende do primeiro, e de mais nada.
 *
 * Documento aumenta auditabilidade. Não é, e não pode passar a ser, requisito
 * de cálculo: a planilha da transportadora chega antes do export todo mês, e um
 * produto que se recusasse a calcular até o arquivo chegar seria um produto que
 * não fecha quinzena nenhuma no prazo.
 *
 * O teste é puro de propósito — sem banco e sem porta. O caminho completo, com
 * Postgres, está em `cadastro-a-mao-sem-lastro.test.ts`, no api-server; aqui
 * prende-se a aritmética, que é onde um acoplamento acidental entraria.
 */

const trecho = (t: Partial<TrechoDaVigencia>): TrechoDaVigencia => ({
  tributo: null,
  percentualDeclarado: null,
  freteCtrc: null,
  imposto: null,
  pisCofins: null,
  previsaoViagens: null,
  ...t,
});

/** A aba digitada: as vinte obrigatórias e nada mais. */
const DIGITADA: [string, number][] = [
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
];

const declarados: PlanilhaDeclarada = new Map(
  DIGITADA.map(([chave, valor]) => [
    chave,
    { valor, observacao: null, autor: "quem digitou", informadoEm: "2026-07-20T12:00:00Z" },
  ]),
);

/** Nenhum arquivo: é a unidade cadastrada à mão do caso real. */
const SEM_ACERVO: MaterialDoCadastro = {
  cavalos: [],
  trechos: [],
  trechosEntregues: false,
  declarados,
};

/** O mesmo cadastro, agora com os dois exports importados. */
const COM_ACERVO: MaterialDoCadastro = {
  cavalos: [
    ...Array.from({ length: 56 }, (_, i) => ({ entityId: `ativo-${i}`, ativo: true })),
    ...Array.from({ length: 8 }, (_, i) => ({ entityId: `inativo-${i}`, ativo: false })),
  ],
  trechos: [
    trecho({
      tributo: "ISS",
      freteCtrc: 1000,
      imposto: 59,
      pisCofins: 92.5,
      previsaoViagens: 2,
      percentualDeclarado: 5.9,
    }),
    trecho({
      tributo: "ICMS",
      freteCtrc: 10_000,
      imposto: 1784,
      pisCofins: 925,
      previsaoViagens: 62,
      percentualDeclarado: 17.84,
    }),
  ],
  trechosEntregues: true,
  declarados,
};

const valores = new Map(DIGITADA);

describe("o devido não depende do lastro", () => {
  it("cadastro manual completo e zero documentos: o contrato sai", () => {
    const situacao = medirSituacao(montarCadastro(SEM_ACERVO));

    /* Zero de onze comprovadas — e vinte de vinte informadas. */
    expect(situacao.comLastro).toBe(0);
    expect(situacao.verificaveis).toBe(11);
    expect(situacao.estado).toBe("SEM_LASTRO");
    expect(situacao.obrigatoriasInformadas).toBe(situacao.obrigatorias);
    expect(situacao.suficienteParaCalcular).toBe(true);

    const { contrato, faltam } = contratoDaPlanilha(valores);
    expect(faltam).toEqual([]);
    expect(contrato).not.toBeNull();
    expect(contrato?.parametros.frotaFixaAtiva).toBe(56);
  });

  /**
   * O DOCUMENTO ACRESCENTA AUDITABILIDADE, E NÃO MUDA O NÚMERO.
   *
   * O mesmo contrato, byte a byte, com e sem os dois exports. O que muda é
   * quanto dele o acervo confirma — e é exatamente isso que lastro deve medir.
   */
  it("importar os documentos não muda o contrato — só quanto dele se comprova", () => {
    const semDocumento = medirSituacao(montarCadastro(SEM_ACERVO));
    const comDocumento = medirSituacao(montarCadastro(COM_ACERVO));

    /* A auditabilidade sobe... */
    expect(comDocumento.comLastro).toBeGreaterThan(semDocumento.comLastro);
    expect(comDocumento.conferenciasComAcervo).toBeGreaterThan(
      semDocumento.conferenciasComAcervo,
    );
    expect(comDocumento.estado).toBe("FROTA_E_ALIQUOTAS");

    /* ...e a capacidade de calcular não se mexe, porque não é dela que trata. */
    expect(comDocumento.suficienteParaCalcular).toBe(semDocumento.suficienteParaCalcular);
    expect(contratoDaPlanilha(valores).contrato).toEqual(contratoDaPlanilha(valores).contrato);
  });

  /**
   * FALTA DE LASTRO NUNCA VIRA FALTA DE CONTRATO.
   *
   * A recusa do contrato tem uma causa só, e ela é nominal: uma obrigatória sem
   * número. Tirar todo o acervo não produz recusa nenhuma; tirar uma
   * obrigatória produz uma recusa que **diz qual**.
   */
  it("sem lastro o contrato existe; sem uma obrigatória ele é recusado pelo nome", () => {
    expect(contratoDaPlanilha(valores).contrato).not.toBeNull();

    for (const obrigatoria of CHAVES_OBRIGATORIAS) {
      const semUma = new Map(DIGITADA.filter(([chave]) => chave !== obrigatoria));
      const lido = contratoDaPlanilha(semUma);

      expect(lido.contrato).toBeNull();
      expect(lido.faltam.map((f) => f.chave)).toEqual([obrigatoria]);
      /* E o nome da linha vem junto — quem lê procura o rótulo, não a chave. */
      expect(lido.faltam[0]?.rotulo).toBeTruthy();
    }
  });

  /**
   * A OPCIONAL EM BRANCO É PREMISSA, E A TELA TEM DE PODER DIZÊ-LO.
   *
   * `29 de 30` não é um cadastro incompleto quando a trigésima é opcional: a
   * própria planilha deixa aquelas duas células vazias e as soma como zero.
   */
  it("a opcional ausente entra como zero, contada à parte e sem travar", () => {
    const situacao = medirSituacao(montarCadastro(SEM_ACERVO));
    const lido = contratoDaPlanilha(valores);

    expect(lido.contrato).not.toBeNull();
    expect(lido.assumidasComoZero.map((c) => c.chave).sort()).toEqual([
      "ativo_lucro_operacional",
      "marketing_sem_impostos",
    ]);
    expect(situacao.opcionaisAssumidasComoZero).toBe(2);
    expect(situacao.suficienteParaCalcular).toBe(true);
  });
});
