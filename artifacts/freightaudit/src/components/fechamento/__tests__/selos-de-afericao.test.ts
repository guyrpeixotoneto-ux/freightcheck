import { describe, expect, it } from "vitest";

import { faixa, motivoDaFalta, percentual, temPendenciaAMostrar } from "../selos-de-afericao";
import type { Aferibilidade, FonteFaltante } from "@/lib/fechamento";

/**
 * OS SELOS — o que a tela decide sobre um número que ela não calcula.
 *
 * Os dois percentuais vêm prontos do servidor, e é lá que eles são provados
 * (`afericao.test.ts`). O que sobra para esta tela são duas decisões de leitura,
 * e as duas já erraram em produtos parecidos:
 *
 * 1. **Razão sem denominador não é zero.** Um canal cujo painel ninguém
 *    transcreveu não tem precisão ruim — tem precisão indefinida. Mostrar
 *    `0,0%` ali afirmaria que a conta está errada quando ninguém a fez, e as
 *    duas afirmações pedem coisas opostas de quem lê.
 * 2. **A cor é categórica, não gradiente.** Quem varre a tela precisa de três
 *    faixas legíveis; um verde que escurece devagar não é leitura, é decoração.
 */

describe("um percentual que não existe não é zero por cento", () => {
  it("`null` vira traço", () => {
    expect(percentual(null)).toBe("—");
  });

  it("zero vira zero — que é uma afirmação, e diferente de traço", () => {
    expect(percentual(0)).toBe("0,0%");
  });

  it("escreve com uma casa e vírgula, como o resto da tela escreve número", () => {
    expect(percentual(0.99127)).toBe("99,1%");
    expect(percentual(1)).toBe("100,0%");
  });
});

describe("a faixa que decide a cor", () => {
  it("sem medida é a sua própria faixa, e não a pior delas", () => {
    /* Cinza, não vermelho: não medido e medido mal são coisas diferentes. */
    expect(faixa(null)).toBe("SEM_MEDIDA");
  });

  it("os cortes são 99% e 90%", () => {
    expect(faixa(0.9913)).toBe("BOA");
    expect(faixa(0.99)).toBe("BOA");
    expect(faixa(0.9899)).toBe("ATENCAO");
    expect(faixa(0.9)).toBe("ATENCAO");
    expect(faixa(0.8999)).toBe("BAIXA");
    expect(faixa(0)).toBe("BAIXA");
  });

  it("fechamento incompleto tem faixa própria, e ela não é a pior", () => {
    /*
      **A decisão de leitura mais importante desta tela.** Vermelho diz "a
      remuneração está errada"; âmbar diz "faltam documentos". Um mês pela
      metade pintado de vermelho manda quem lê discutir valores quando o que
      falta é importar arquivo — e foi exatamente o que aconteceu.

      A completude ganha do percentual: mesmo que a razão tivesse saído baixa,
      o que se comunica primeiro é que ela não devia ter sido calculada.
    */
    expect(faixa(null, "INCOMPLETO")).toBe("INCOMPLETO");
    expect(faixa(0, "INCOMPLETO")).toBe("INCOMPLETO");
    expect(faixa(0.5, "INCOMPLETO")).toBe("INCOMPLETO");

    /* E completo volta a mandar: divergência real continua vermelha. */
    expect(faixa(0.5, "COMPLETO")).toBe("BAIXA");
    expect(faixa(null, "NAO_APLICAVEL")).toBe("SEM_MEDIDA");
  });

  it("a causa da falta vira a palavra de quem vai resolver", () => {
    /*
      Duas causas, duas ações: uma pede upload, a outra pede abrir a competência
      antes. Um texto só mandaria metade das pessoas ao lugar errado.
    */
    const falta = (motivo: FonteFaltante["motivo"]): FonteFaltante => ({
      tipo: "OPERACAO",
      quinzena: 2,
      rotina: "2Art",
      nome: "Relatório operacional",
      motivo,
    });
    expect(motivoDaFalta(falta("NAO_IMPORTADO"))).toBe("não importado");
    expect(motivoDaFalta(falta("QUINZENA_NAO_ABERTA"))).toBe("quinzena não aberta");
  });

  it("os mesmos cortes valem para os dois selos", () => {
    /*
      Precisão e lastro são a mesma grandeza — fração do dinheiro do fechamento
      —, e cortes diferentes fariam a mesma cor significar coisas diferentes em
      dois selos lado a lado. Por isso `faixa` não recebe qual selo é.
    */
    expect(faixa(0.5)).toBe("BAIXA");
    expect(faixa(0.995)).toBe("BOA");
  });
});


/**
 * QUANDO A CAIXA DE PENDÊNCIAS APARECE.
 *
 * O caso que a motivou: as duas quinzenas abertas, os seis relatórios
 * importados nas duas, e a 2ª sem contrato. `faltando` fica vazio — não falta
 * relatório nenhum —, e a caixa não aparecia. A tela ficava com meia coluna em
 * branco e nenhuma explicação em lugar nenhum.
 */
describe("a caixa de pendências olha as duas ausências, não só os relatórios", () => {
  const base = (parcial: Partial<Aferibilidade>): Aferibilidade => ({
    completude: "INCOMPLETO",
    faltando: [],
    semContrato: [],
    porque: null,
    ...parcial,
  });

  const fonte: FonteFaltante = {
    tipo: "OPERACAO",
    quinzena: 2,
    rotina: "2Art",
    nome: "Diário de operação",
    motivo: "NAO_IMPORTADO",
  };

  const contrato = { quinzena: 2 as const, estado: "SEM_VIGENCIA", problema: "x", conserto: "y" };

  it("aparece quando falta relatório", () => {
    expect(temPendenciaAMostrar(base({ faltando: [fonte] }))).toBe(true);
  });

  it("aparece quando falta contrato — o caso que ela não pegava", () => {
    expect(temPendenciaAMostrar(base({ semContrato: [contrato] }))).toBe(true);
  });

  it("aparece quando faltam os dois", () => {
    expect(temPendenciaAMostrar(base({ faltando: [fonte], semContrato: [contrato] }))).toBe(true);
  });

  it("não aparece no fechamento completo, nem sem aferibilidade", () => {
    expect(temPendenciaAMostrar(base({ completude: "COMPLETO" }))).toBe(false);
    expect(temPendenciaAMostrar(base({ completude: "NAO_APLICAVEL" }))).toBe(false);
    expect(temPendenciaAMostrar(null)).toBe(false);
  });

  it("incompleto sem nada nomeado não abre caixa vazia", () => {
    /*
      O estado da quinzena que nem linha tem: é incompleto e não há item para
      listar. Uma caixa vazia com título seria pior que nenhuma.
    */
    expect(temPendenciaAMostrar(base({}))).toBe(false);
  });
});
