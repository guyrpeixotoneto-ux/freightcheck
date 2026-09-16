import { describe, expect, it } from "vitest";
import {
  CODIGOS_DO_DETALHE,
  impactoPorPeriodicidade,
  linhasDeFiname,
  variavelDoCodigo,
} from "../finame";
import {
  CODIGOS_DO_DETALHE_DE_IPVA,
  impactoDeIpva,
  linhasDeIpva,
  variavelDeIpvaDoCodigo,
} from "../ipva";
import {
  CODIGOS_DO_DETALHE_DE_IMPOSTOS,
  impactoDeImpostos,
  linhasDeImpostos,
  variavelDeImpostosDoCodigo,
} from "../impostos";
import {
  CODIGOS_DO_DETALHE_DE_LUCRO_FIXO,
  impactoDeLucroFixo,
  linhasDeLucroFixo,
  variavelDeLucroFixoDoCodigo,
} from "../lucro-fixo";
import type { AlteracaoDoMotor } from "../recorte-de-rubrica";

/**
 * O PORTÃO: cada valor financeiro tem **um** módulo que o soma.
 *
 * ---------------------------------------------------------------------------
 * Por que este arquivo existe
 * ---------------------------------------------------------------------------
 * Porque os quatro recortes de custo fixo compartilham colunas — e compartilhar
 * a coluna não é defeito nenhum: o valor de nota confere a parcela, confere o
 * IPVA e confere os tributos, e as três telas precisam mostrá-lo. O defeito é
 * **somar** a mesma coluna em mais de um módulo, porque aí o Monitor Custo
 * Fixo, que é só a composição das respostas dos módulos, publica o mesmo
 * dinheiro duas vezes sem que ninguém tenha decidido isso.
 *
 * Foi o que aconteceu com `valor_pis_cofins`: FINAME e Impostos somavam os dois
 * a mesma alteração, com a mesma periodicidade e o mesmo valor. A medição, a
 * decisão e o que mudou estão em `docs/ACHADO-DUPLA-CONTAGEM-CUSTO-FIXO.md`.
 *
 * ---------------------------------------------------------------------------
 * Como ele mede
 * ---------------------------------------------------------------------------
 * Não lendo catálogos — lendo **comportamento**. Para cada código que qualquer
 * um dos quatro conhece, monta-se uma alteração precificada e pergunta-se a
 * cada módulo: "isto entra no seu total?". Quem responde que sim é dono. Dois
 * donos é falha, e a mensagem diz qual coluna e quais módulos, porque um teste
 * de invariante que só diz "esperava 1, recebeu 2" manda alguém procurar.
 *
 * A pergunta é feita pelas funções de impacto que as telas usam, e não por uma
 * cópia da regra: uma segunda leitura do catálogo passaria neste teste e
 * divergiria na tela, que é exatamente o modo de falhar que ele existe para
 * impedir.
 */

type Modulo = "FINAME" | "IPVA" | "IMPOSTOS" | "LUCRO_FIXO";

/** Uma alteração precificada nesse código, no tipo de equipamento que o declara. */
function alteracaoDe(codigo: string): AlteracaoDoMotor {
  return {
    id: 1,
    changeType: "VALUE_CHANGED",
    attributeCode: codigo,
    entityLabel: "ABC1D23",
    entityType: codigo.startsWith("carreta.") ? "CARRETA" : "CAVALO",
    valueBefore: "100",
    valueAfter: "200",
    deltaAbsolute: 100,
    deltaPercent: 100,
    comparability: "COMPARABLE",
    impactConfidence: "CALCULATED",
    impactAmount: 100,
    impactPeriodicity: "PONTUAL",
  };
}

/** Este módulo põe esta coluna no total dele? */
const SOMA: Record<Modulo, (a: AlteracaoDoMotor) => boolean> = {
  FINAME: (a) =>
    Object.keys(impactoPorPeriodicidade(linhasDeFiname([a])).porPeriodicidade).length > 0,
  IPVA: (a) => Object.keys(impactoDeIpva(linhasDeIpva([a])).porPeriodicidade).length > 0,
  IMPOSTOS: (a) =>
    Object.keys(impactoDeImpostos(linhasDeImpostos([a])).porPeriodicidade).length > 0,
  LUCRO_FIXO: (a) =>
    Object.keys(impactoDeLucroFixo(linhasDeLucroFixo([a])).porPeriodicidade).length > 0,
};

const CATALOGOS: Record<Modulo, readonly string[]> = {
  FINAME: CODIGOS_DO_DETALHE,
  IPVA: CODIGOS_DO_DETALHE_DE_IPVA,
  IMPOSTOS: CODIGOS_DO_DETALHE_DE_IMPOSTOS,
  LUCRO_FIXO: CODIGOS_DO_DETALHE_DE_LUCRO_FIXO,
};

const MODULOS = Object.keys(CATALOGOS) as Modulo[];

/**
 * A coluna é candidata a dinheiro em algum dos quatro catálogos?
 *
 * O recorte existe porque a sonda **força** `CALCULATED`, e o motor não faz
 * isso: `assessImpact` só precifica o que a curadoria confirmou como monetário
 * e somável. Sem o recorte, a sonda perguntaria "o FINAME soma o prazo?" com um
 * prazo precificado na mão — uma situação que não existe em produção — e o
 * teste passaria a cobrar uma posse sobre colunas que nunca viram dinheiro.
 */
function ehCandidataADinheiro(codigo: string): boolean {
  return (
    variavelDoCodigo(codigo)?.medida === "DINHEIRO" ||
    variavelDeIpvaDoCodigo(codigo)?.medida === "DINHEIRO" ||
    variavelDeImpostosDoCodigo(codigo)?.medida === "DINHEIRO" ||
    variavelDeLucroFixoDoCodigo(codigo)?.medida === "DINHEIRO"
  );
}

/** Todos os códigos monetários que algum dos quatro conhece, sem repetição. */
const TODOS = [...new Set(MODULOS.flatMap((m) => CATALOGOS[m]))]
  .filter(ehCandidataADinheiro)
  .sort();

function donosDe(codigo: string): Modulo[] {
  const a = alteracaoDe(codigo);
  return MODULOS.filter((m) => SOMA[m](a));
}

describe("a posse da soma no custo fixo", () => {
  it("dá no máximo um módulo dono a cada coluna", () => {
    const disputadas = TODOS.map((codigo) => ({ codigo, donos: donosDe(codigo) }))
      .filter((c) => c.donos.length > 1)
      .map((c) => `${c.codigo} somada por ${c.donos.join(" e ")}`);
    expect(disputadas).toEqual([]);
  });

  it("nomeia o dono de cada coluna que vira dinheiro em alguma tela", () => {
    const donoPorCodigo = Object.fromEntries(
      TODOS.map((codigo) => [codigo, donosDe(codigo)[0] ?? null]).filter(
        ([, dono]) => dono !== null,
      ),
    );
    /*
      O retrato de quem soma o quê, prendido como contrato. Ele não é decoração:
      é o que faz uma mudança de posse — a de `valor_pis_cofins` foi uma —
      aparecer no diff como decisão, e não como efeito colateral de mexer num
      catálogo.
    */
    expect(donoPorCodigo).toEqual({
      "carreta.amortizacao_implemento": "FINAME",
      "carreta.finame_implemento": "FINAME",
      "carreta.ipva_licenciamento": "IPVA",
      "carreta.juros_finame_implemento": "FINAME",
      "carreta.lucro_fixomodelo_novo_ciclo_carreta": "LUCRO_FIXO",
      "carreta.valor_pis_cofins": "IMPOSTOS",
      "cavalo.amortizacao_cavalo": "FINAME",
      "cavalo.finame_cavalo": "FINAME",
      "cavalo.ipva_licenciamento": "IPVA",
      "cavalo.juros_finame_cavalo": "FINAME",
      "cavalo.lucro_fixomodelo_novo_ciclo_cavalo": "LUCRO_FIXO",
      "cavalo.valor_pis_cofins": "IMPOSTOS",
    });
  });

  it("deixa a base de compra sem dono nenhum — preço do ativo não é custo fixo", () => {
    for (const codigo of ["cavalo.valor_nf_compra", "carreta.valor_nf_compra"]) {
      expect(donosDe(codigo)).toEqual([]);
    }
  });

  it("deixa o ICMS da compra sem dono enquanto a coluna não tiver dado", () => {
    // Impostos a recusa por ser zero nas 1.215 linhas; FINAME, por ser de
    // Impostos. Quando a fonte a preencher, o dono é Impostos — e este teste é
    // que vai obrigar alguém a dizer isso por escrito.
    for (const codigo of ["cavalo.valor_icms", "carreta.valor_icms"]) {
      expect(donosDe(codigo)).toEqual([]);
    }
  });
});
