import { describe, expect, it } from "vitest";
import {
  AMBIENTES,
  ambienteDaOperacao,
  ambienteDe,
  baseDaOperacao,
  nomeDoFechamentoDa,
  OPERACAO_DO_AMBIENTE,
  operacaoDoFechamento,
  baseDoFechamento,
  BASES_DE_FECHAMENTO,
  descricaoDoAmbiente,
  destinoDaRaiz,
  ehFechamento,
  ENTRADA_DA_AUDITORIA,
  RESUMO_EXECUTIVO,
} from "../ambiente";

/**
 * A regra que separa os espaços de trabalho é uma só — cada base de fechamento
 * manda no que vive abaixo dela, o resto é Auditoria — e este teste a guarda
 * nos pontos onde ela quebraria em silêncio: o prefixo que casa por engano
 * (`/fechamentos` não é o ambiente), a base da Empurrada, que começa com a do
 * Rota sem ser ela, e a raiz exata.
 */
describe("ambienteDe", () => {
  it("lê a raiz do Rota e tudo abaixo dela como Fechamento Rota", () => {
    expect(ambienteDe("/fechamento")).toBe("fechamento-rota");
    expect(ambienteDe("/fechamento/apuracao")).toBe("fechamento-rota");
    expect(ambienteDe("/fechamento/competencias")).toBe("fechamento-rota");
  });

  /*
    `/fechamento-empurrada` começa com `/fechamento`, e é por isso que a
    comparação do módulo é exata ou seguida de barra: com `startsWith` cru a
    Empurrada inteira seria lida como Rota — mesmo endereço, menu errado e
    nenhum erro na tela.
  */
  it("lê a base da Empurrada como Fechamento Empurrada, e não como Rota", () => {
    expect(ambienteDe("/fechamento-empurrada")).toBe("fechamento-empurrada");
    expect(ambienteDe("/fechamento-empurrada/apuracao")).toBe("fechamento-empurrada");
    expect(ambienteDe("/fechamento-empurrada/competencias/abc")).toBe("fechamento-empurrada");
  });

  it("lê todo o resto como Auditoria — inclusive o quase-prefixo", () => {
    expect(ambienteDe("/")).toBe("auditoria");
    expect(ambienteDe("/alteracoes")).toBe("auditoria");
    expect(ambienteDe("/dre/abc-123")).toBe("auditoria");
    expect(ambienteDe("/fechamentos")).toBe("auditoria");
  });
});

/**
 * A base é o que faz o mesmo componente servir aos dois fechamentos: toda tela
 * monta os próprios links a partir dela (`lib/base-do-fechamento.ts`).
 */
describe("baseDoFechamento", () => {
  it("devolve a base do ambiente em que o endereço está", () => {
    expect(baseDoFechamento("/fechamento/competencias/abc")).toBe("/fechamento");
    expect(baseDoFechamento("/fechamento-empurrada/competencias/abc")).toBe(
      "/fechamento-empurrada",
    );
  });

  it("fora dos fechamentos devolve a do Rota, que ninguém chega a usar", () => {
    expect(baseDoFechamento("/alteracoes")).toBe("/fechamento");
  });

  it("é a base de cada ambiente, e não uma segunda lista", () => {
    for (const [id, base] of Object.entries(BASES_DE_FECHAMENTO)) {
      expect(ambienteDe(base)).toBe(id);
      expect(baseDoFechamento(`${base}/qualquer/coisa`)).toBe(base);
    }
  });
});

describe("ehFechamento", () => {
  it("separa a Auditoria dos dois fechamentos", () => {
    expect(ehFechamento("auditoria")).toBe(false);
    expect(ehFechamento("fechamento-rota")).toBe(true);
    expect(ehFechamento("fechamento-empurrada")).toBe(true);
  });
});

describe("os ambientes", () => {
  it("são três, e a home de cada um vive no ambiente que ela abre", () => {
    expect(AMBIENTES.map((a) => a.id)).toEqual([
      "auditoria",
      "fechamento-rota",
      "fechamento-empurrada",
    ]);
    for (const ambiente of AMBIENTES) {
      expect(ambienteDe(ambiente.home)).toBe(ambiente.id);
    }
  });

  it("descreve cada id com o próprio registro", () => {
    expect(descricaoDoAmbiente("auditoria").nome).toBe("Auditoria Empurrada");
    expect(descricaoDoAmbiente("fechamento-rota").nome).toBe("Fechamento Rota");
    expect(descricaoDoAmbiente("fechamento-empurrada").nome).toBe("Fechamento Empurrada");
  });

  /*
    Os dois ambientes abrem na mesma altura — o conjunto antes da unidade —, e é
    isso que este teste guarda. Ele quebra no dia em que a home da Auditoria
    voltar a ser uma tela de unidade, que é exatamente a regressão que a mudança
    de entrada existiu para desfazer.
  */
  it("abre a Auditoria pela Visão Gerencial, como os fechamentos", () => {
    expect(descricaoDoAmbiente("auditoria").home).toBe(ENTRADA_DA_AUDITORIA);
    expect(descricaoDoAmbiente("fechamento-rota").home).toBe("/fechamento");
    expect(descricaoDoAmbiente("fechamento-empurrada").home).toBe("/fechamento-empurrada");
  });
});

/**
 * A porta e o contrato dos links antigos.
 *
 * As duas metades da regra estão aqui porque só juntas ela faz sentido: a raiz
 * nua abre o acervo, e a raiz com recorte devolve quem chegou ao Resumo
 * executivo — que era o dono do endereço quando o link foi colado.
 */
describe("destinoDaRaiz", () => {
  it("sem consulta, abre a Visão Gerencial", () => {
    expect(destinoDaRaiz("")).toBe(ENTRADA_DA_AUDITORIA);
  });

  it("com recorte, encaminha ao Resumo executivo sem perder um parâmetro", () => {
    expect(destinoDaRaiz("period=2026-08-01&scopeHash=abc")).toBe(
      `${RESUMO_EXECUTIVO}?period=2026-08-01&scopeHash=abc`,
    );
  });

  /*
    O `?` de abertura entra ou não conforme quem chama: `useSearch` do wouter
    entrega a consulta sem ele, `location.search` entrega com. Repetido, o
    endereço sairia com `??` e a primeira chave viraria "?period" — o recorte
    chegaria à tela como se ninguém o tivesse escrito.
  */
  it("aceita a consulta com e sem o ponto de interrogação", () => {
    expect(destinoDaRaiz("?period=2026-08-01")).toBe(
      `${RESUMO_EXECUTIVO}?period=2026-08-01`,
    );
    expect(destinoDaRaiz("?")).toBe(ENTRADA_DA_AUDITORIA);
  });

  it("manda para dentro da Auditoria, nunca de volta para a raiz", () => {
    for (const busca of ["", "?", "period=2026-08-01", "?scopeHash=abc"]) {
      const destino = destinoDaRaiz(busca);
      expect(destino).not.toBe("/");
      expect(ambienteDe(destino.split("?")[0])).toBe("auditoria");
    }
  });
});

/**
 * A operação de cada ambiente — o recorte que faz Rota e Empurrada serem dois
 * acervos e não o mesmo acervo com dois nomes.
 *
 * O que este bloco guarda é a regressão que motivou o mapa: enquanto a operação
 * não vinha do endereço, as listas do fechamento traziam as competências das
 * duas operações nos dois ambientes — e excluir uma importação na Empurrada a
 * apagava do Rota, porque era a mesma linha vista duas vezes.
 */
describe("operacaoDoFechamento", () => {
  it("dá a operação de cada base, e só ela", () => {
    expect(operacaoDoFechamento("/fechamento")).toBe("ROTA");
    expect(operacaoDoFechamento("/fechamento/competencias")).toBe("ROTA");
    expect(operacaoDoFechamento("/fechamento-empurrada")).toBe("EMPURRADA");
    expect(operacaoDoFechamento("/fechamento-empurrada/apuracoes")).toBe(
      "EMPURRADA",
    );
  });

  /*
    A mesma armadilha de `ambienteDe`: `/fechamento-empurrada` começa com
    `/fechamento`, e um `startsWith` cru faria a Empurrada apurar como rota.
  */
  it("não confunde a base da Empurrada com a do Rota", () => {
    expect(operacaoDoFechamento("/fechamento-empurrada")).not.toBe(
      operacaoDoFechamento("/fechamento"),
    );
  });

  it("nenhum ambiente compartilha operação com o outro", () => {
    const operacoes = Object.values(OPERACAO_DO_AMBIENTE);
    expect(new Set(operacoes).size).toBe(operacoes.length);
  });
});

describe("ambienteDaOperacao", () => {
  it("é a volta exata do mapa", () => {
    for (const [id, operacao] of Object.entries(OPERACAO_DO_AMBIENTE)) {
      expect(ambienteDaOperacao(operacao)).toBe(id);
      expect(baseDaOperacao(operacao)).toBe(
        BASES_DE_FECHAMENTO[id as keyof typeof BASES_DE_FECHAMENTO],
      );
    }
  });

  it("aceita o tipo como o acervo o escreve, em qualquer caixa", () => {
    expect(ambienteDaOperacao(" rota ")).toBe("fechamento-rota");
    expect(ambienteDaOperacao("Empurrada")).toBe("fechamento-empurrada");
  });

  /*
    `NAO_INFORMADO` é o carimbo do backfill da `0046`: ele não é de nenhum dos
    dois fechamentos, e é por isso que a resposta é `null` em vez de um palpite.
  */
  it("a operação sem ambiente volta nula, e o nome volta cru", () => {
    expect(ambienteDaOperacao("NAO_INFORMADO")).toBeNull();
    expect(nomeDoFechamentoDa("NAO_INFORMADO")).toBe("NAO_INFORMADO");
    expect(baseDaOperacao("NAO_INFORMADO")).toBe(BASES_DE_FECHAMENTO["fechamento-rota"]);
  });

  it("nomeia o fechamento como o seletor do topo o nomeia", () => {
    expect(nomeDoFechamentoDa("ROTA")).toBe(
      descricaoDoAmbiente("fechamento-rota").nome,
    );
    expect(nomeDoFechamentoDa("EMPURRADA")).toBe(
      descricaoDoAmbiente("fechamento-empurrada").nome,
    );
  });
});
