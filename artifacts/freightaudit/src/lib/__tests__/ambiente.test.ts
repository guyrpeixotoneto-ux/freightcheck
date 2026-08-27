import { describe, expect, it } from "vitest";
import {
  AMBIENTES,
  ambienteDaOperacao,
  ambienteDe,
  baseDaOperacao,
  nomeDoFechamentoDa,
  OPERACAO_DO_AMBIENTE,
  operacaoDoFechamento,
  baseDaAuditoria,
  baseDoFechamento,
  BASES_DE_AUDITORIA,
  BASES_DE_FECHAMENTO,
  ehAuditoria,
  homeDaAuditoria,
  OPERACAO_DA_AUDITORIA,
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
 * (`/fechamentos` não é o ambiente), as bases da Empurrada, do AS e do Apoio,
 * que começam com a do Rota sem serem ela, e a raiz exata.
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

  /*
    AS e Apoio entram pela mesma porta e caem na mesma armadilha: as três bases
    novas começam com `/fechamento`, e nenhuma delas é o Rota.
  */
  it("lê as bases de AS e Apoio como os ambientes delas, e não como Rota", () => {
    expect(ambienteDe("/fechamento-as")).toBe("fechamento-as");
    expect(ambienteDe("/fechamento-as/apuracao")).toBe("fechamento-as");
    expect(ambienteDe("/fechamento-apoio")).toBe("fechamento-apoio");
    expect(ambienteDe("/fechamento-apoio/competencias/abc")).toBe("fechamento-apoio");
  });

  /*
    As auditorias prefixadas caem na mesma armadilha do outro lado: `/auditoria-rota`
    e `/auditoria-rotas` são endereços diferentes, e ler o segundo como o primeiro
    abriria o menu de uma operação sobre o acervo de outra — sem erro na tela.
  */
  it("lê as bases das auditorias novas como os ambientes delas", () => {
    expect(ambienteDe("/auditoria-rota")).toBe("auditoria-rota");
    expect(ambienteDe("/auditoria-rota/alteracoes")).toBe("auditoria-rota");
    expect(ambienteDe("/auditoria-as")).toBe("auditoria-as");
    expect(ambienteDe("/auditoria-as/caminhao-360")).toBe("auditoria-as");
    expect(ambienteDe("/auditoria-apoio")).toBe("auditoria-apoio");
    expect(ambienteDe("/auditoria-apoio/empilhadeira-360")).toBe("auditoria-apoio");
  });

  it("lê todo o resto como Auditoria Empurrada — inclusive os quase-prefixos", () => {
    expect(ambienteDe("/")).toBe("auditoria");
    expect(ambienteDe("/alteracoes")).toBe("auditoria");
    expect(ambienteDe("/dre/abc-123")).toBe("auditoria");
    expect(ambienteDe("/fechamentos")).toBe("auditoria");
    expect(ambienteDe("/auditoria-rotas")).toBe("auditoria");
    expect(ambienteDe("/auditoria")).toBe("auditoria");
  });
});

/**
 * A base da auditoria é o par da do fechamento, com uma diferença que é o
 * desenho inteiro: a da Empurrada é **vazia**, porque ela ficou nos endereços
 * que já estavam em uso.
 */
describe("baseDaAuditoria", () => {
  it("devolve a base do ambiente em que o endereço está", () => {
    expect(baseDaAuditoria("/alteracoes")).toBe("");
    expect(baseDaAuditoria("/auditoria-rota/alteracoes")).toBe("/auditoria-rota");
    expect(baseDaAuditoria("/auditoria-apoio")).toBe("/auditoria-apoio");
  });

  it("fora das auditorias devolve a da Empurrada, que ninguém chega a usar", () => {
    expect(baseDaAuditoria("/fechamento/competencias")).toBe("");
  });

  it("é a base de cada ambiente, e não uma segunda lista", () => {
    for (const [id, base] of Object.entries(BASES_DE_AUDITORIA)) {
      expect(ambienteDe(base === "" ? "/" : base)).toBe(id);
      expect(baseDaAuditoria(`${base}/qualquer/coisa`)).toBe(base);
    }
  });

  /*
    A home de cada auditoria é a Visão Gerencial **dela**: quem troca de ambiente
    no seletor do topo tem de cair no ambiente que escolheu, e não na Empurrada
    com outro nome escrito no botão.
  */
  it("põe a home de cada auditoria dentro do ambiente dela", () => {
    for (const id of Object.keys(BASES_DE_AUDITORIA)) {
      const home = homeDaAuditoria(id as keyof typeof BASES_DE_AUDITORIA);
      expect(ambienteDe(home)).toBe(id);
      expect(home.endsWith(ENTRADA_DA_AUDITORIA)).toBe(true);
    }
  });

  /* Uma operação por auditoria, e as quatro distintas — o eixo dos acervos. */
  it("nomeia a operação de cada auditoria, sem repetir nenhuma", () => {
    expect(OPERACAO_DA_AUDITORIA.auditoria).toBe("EMPURRADA");
    expect(OPERACAO_DA_AUDITORIA["auditoria-rota"]).toBe("ROTA");
    expect(new Set(Object.values(OPERACAO_DA_AUDITORIA)).size).toBe(4);
  });
});

/**
 * A base é o que faz o mesmo componente servir a todos os fechamentos: toda tela
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
  it("separa as auditorias de todos os fechamentos", () => {
    expect(ehFechamento("auditoria")).toBe(false);
    expect(ehFechamento("auditoria-rota")).toBe(false);
    expect(ehFechamento("auditoria-as")).toBe(false);
    expect(ehFechamento("auditoria-apoio")).toBe(false);
    expect(ehFechamento("fechamento-rota")).toBe(true);
    expect(ehFechamento("fechamento-empurrada")).toBe(true);
    expect(ehFechamento("fechamento-as")).toBe(true);
    expect(ehFechamento("fechamento-apoio")).toBe(true);
  });

  /*
    Os dois lados cobrem os oito ambientes e não se sobrepõem: um ambiente que
    não fosse nenhum dos dois cairia da lateral — nem a lista da Auditoria nem a
    do Fechamento o atenderiam.
  */
  it("é o complemento exato de ehAuditoria", () => {
    for (const ambiente of AMBIENTES) {
      expect(ehAuditoria(ambiente.id)).toBe(!ehFechamento(ambiente.id));
    }
  });
});

describe("os ambientes", () => {
  it("são oito, e a home de cada um vive no ambiente que ela abre", () => {
    expect(AMBIENTES.map((a) => a.id)).toEqual([
      "auditoria",
      "auditoria-rota",
      "auditoria-as",
      "auditoria-apoio",
      "fechamento-rota",
      "fechamento-empurrada",
      "fechamento-as",
      "fechamento-apoio",
    ]);
    for (const ambiente of AMBIENTES) {
      expect(ambienteDe(ambiente.home)).toBe(ambiente.id);
    }
  });

  it("descreve cada id com o próprio registro", () => {
    expect(descricaoDoAmbiente("auditoria").nome).toBe("Auditoria Empurrada");
    expect(descricaoDoAmbiente("auditoria-rota").nome).toBe("Auditoria Rota");
    expect(descricaoDoAmbiente("auditoria-as").nome).toBe("Auditoria AS");
    expect(descricaoDoAmbiente("auditoria-apoio").nome).toBe("Auditoria Apoio");
    expect(descricaoDoAmbiente("auditoria-rota").nomeCompleto).toBe(
      "Auditoria de Remuneração — Rota",
    );
    expect(descricaoDoAmbiente("auditoria-apoio").nomeCompleto).toBe(
      "Auditoria de Remuneração — Apoio",
    );
    expect(descricaoDoAmbiente("fechamento-rota").nome).toBe("Fechamento Rota");
    expect(descricaoDoAmbiente("fechamento-empurrada").nome).toBe("Fechamento Empurrada");
    expect(descricaoDoAmbiente("fechamento-as").nome).toBe("Fechamento AS");
    expect(descricaoDoAmbiente("fechamento-apoio").nome).toBe("Fechamento Apoio");
  });

  /*
    O seletor do topo escreve o nome por extenso, e é ele que diz de qual
    remuneração o ambiente fala. "Fechamento de Remuneração — AS" é o nome do
    produto; "Fechamento AS", o rótulo curto do botão.
  */
  it("nomeia cada fechamento por extenso, como o seletor do topo o lista", () => {
    expect(descricaoDoAmbiente("fechamento-rota").nomeCompleto).toBe(
      "Fechamento de Remuneração — Rota",
    );
    expect(descricaoDoAmbiente("fechamento-as").nomeCompleto).toBe(
      "Fechamento de Remuneração — AS",
    );
    expect(descricaoDoAmbiente("fechamento-apoio").nomeCompleto).toBe(
      "Fechamento de Remuneração — Apoio",
    );
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
    expect(descricaoDoAmbiente("fechamento-as").home).toBe("/fechamento-as");
    expect(descricaoDoAmbiente("fechamento-apoio").home).toBe("/fechamento-apoio");
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
    expect(operacaoDoFechamento("/fechamento-as")).toBe("AS");
    expect(operacaoDoFechamento("/fechamento-as/competencias")).toBe("AS");
    expect(operacaoDoFechamento("/fechamento-apoio")).toBe("APOIO");
    expect(operacaoDoFechamento("/fechamento-apoio/apuracoes")).toBe("APOIO");
  });

  /*
    A mesma armadilha de `ambienteDe`: `/fechamento-empurrada` começa com
    `/fechamento`, e um `startsWith` cru faria a Empurrada apurar como rota.
  */
  it("não confunde nenhuma das bases derivadas com a do Rota", () => {
    for (const base of ["/fechamento-empurrada", "/fechamento-as", "/fechamento-apoio"]) {
      expect(operacaoDoFechamento(base)).not.toBe(operacaoDoFechamento("/fechamento"));
    }
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
    expect(ambienteDaOperacao(" as ")).toBe("fechamento-as");
    expect(ambienteDaOperacao("Apoio")).toBe("fechamento-apoio");
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
    expect(nomeDoFechamentoDa("AS")).toBe(descricaoDoAmbiente("fechamento-as").nome);
    expect(nomeDoFechamentoDa("APOIO")).toBe(
      descricaoDoAmbiente("fechamento-apoio").nome,
    );
  });
});
