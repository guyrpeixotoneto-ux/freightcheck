import { describe, expect, it } from "vitest";
import {
  CATALOGO,
  ESPECIES_DE_ITEM,
  TIPOS_DE_CONEXAO,
  TIPOS_DE_ETAPA,
  ehTipoDeEtapa,
  rotuloDe,
  STATUS_DO_FLUXO,
} from "../catalogo";
import {
  comoSlug,
  enderecoDaAcao,
  RecusaDeFluxo,
  validarAcao,
  validarEntradaDeConexao,
  validarEntradaDeEtapa,
  validarEntradaDeFluxo,
  validarItem,
  validarParametros,
  validarRotaInterna,
} from "../validacao";

/**
 * O vocabulário e a porta de entrada — provados sem banco e sem HTTP.
 *
 * Tudo aqui é função pura, e é de propósito: a regra que decide o que este
 * módulo aceita não pode depender de haver um Postgres por perto para ser
 * exercitada. As provas de isolamento entre empresas, que precisam de banco,
 * estão em `isolamento.test.ts`.
 */

function recusa(f: () => unknown): RecusaDeFluxo {
  try {
    f();
  } catch (erro) {
    if (erro instanceof RecusaDeFluxo) return erro;
    throw erro;
  }
  throw new Error("esperava uma RecusaDeFluxo, e nada foi recusado");
}

describe("o catálogo é a única lista de valores válidos", () => {
  it("todo tipo de etapa tem rótulo, forma, classe e ícone", () => {
    for (const tipo of TIPOS_DE_ETAPA) {
      expect(tipo.rotulo).not.toBe("");
      expect(tipo.descricao).not.toBe("");
      expect(["retangulo", "losango", "pilula"]).toContain(tipo.forma);
      expect(tipo.classe).not.toBe("");
      expect(tipo.icone).not.toBe("");
    }
  });

  it("os oito tipos pedidos existem", () => {
    const valores = TIPOS_DE_ETAPA.map((t) => t.valor);
    expect(valores).toEqual([
      "INICIO",
      "PROCESSO",
      "DECISAO",
      "VALIDACAO",
      "DOCUMENTO",
      "SISTEMA",
      "PENDENCIA",
      "FIM",
    ]);
  });

  it("os cinco tipos de conexão pedidos existem", () => {
    expect(TIPOS_DE_CONEXAO.map((t) => t.valor)).toEqual([
      "SEQUENCIA",
      "DECISAO_SIM",
      "DECISAO_NAO",
      "EXCECAO",
      "RETRABALHO",
    ]);
  });

  it("nenhum valor se repete em nenhuma lista", () => {
    for (const lista of Object.values(CATALOGO)) {
      const valores = lista.map((e) => e.valor);
      expect(new Set(valores).size).toBe(valores.length);
    }
  });

  it("só DOCUMENTO usa obrigatório e só SISTEMA usa link", () => {
    const comObrigatorio = ESPECIES_DE_ITEM.filter((e) => e.usaObrigatorio).map((e) => e.valor);
    const comLink = ESPECIES_DE_ITEM.filter((e) => e.usaLink).map((e) => e.valor);
    expect(comObrigatorio).toEqual(["DOCUMENTO"]);
    expect(comLink).toEqual(["SISTEMA"]);
  });

  it("o que não está no catálogo não é reconhecido", () => {
    expect(ehTipoDeEtapa("PROCESSO")).toBe(true);
    expect(ehTipoDeEtapa("SUBPROCESSO")).toBe(false);
    expect(ehTipoDeEtapa(undefined)).toBe(false);
  });

  it("um valor fora do catálogo aparece como ele mesmo, e não some", () => {
    // Uma linha antiga com um tipo que saiu do catálogo continua legível.
    expect(rotuloDe(STATUS_DO_FLUXO, "ATIVO")).toBe("Ativo");
    expect(rotuloDe(STATUS_DO_FLUXO, "SUSPENSO")).toBe("SUSPENSO");
  });
});

describe("o slug", () => {
  it("tira acento, caixa e pontuação", () => {
    expect(comoSlug("Emissão de CTe até Recebimento")).toBe("emissao-de-cte-ate-recebimento");
  });

  it("é estável — semear duas vezes produz o mesmo endereço", () => {
    expect(comoSlug("NF até pagamento")).toBe(comoSlug("NF  até   pagamento!!"));
  });

  it("não deixa hífen sobrando nas pontas", () => {
    expect(comoSlug("  --- Fechamento ---  ")).toBe("fechamento");
  });
});

describe("a entrada de um fluxo", () => {
  it("aceita o mínimo e completa o resto", () => {
    const fluxo = validarEntradaDeFluxo({ nome: "Conciliação bancária", categoria: "Financeiro" });
    expect(fluxo.slug).toBe("conciliacao-bancaria");
    expect(fluxo.status).toBe("RASCUNHO");
    expect(fluxo.descricao).toBeNull();
  });

  it("recusa nome em branco, e diz qual campo é", () => {
    expect(recusa(() => validarEntradaDeFluxo({ nome: "   ", categoria: "X" })).codigo).toBe(
      "FLUXO_SEM_NOME",
    );
  });

  it("recusa categoria em branco", () => {
    expect(recusa(() => validarEntradaDeFluxo({ nome: "X" })).codigo).toBe("FLUXO_SEM_CATEGORIA");
  });

  it("recusa status inventado em vez de trocá-lo em silêncio", () => {
    expect(
      recusa(() => validarEntradaDeFluxo({ nome: "X", categoria: "Y", status: "PUBLICADO" }))
        .codigo,
    ).toBe("FLUXO_STATUS_INVALIDO");
  });

  it("recusa um nome que não produz slug nenhum", () => {
    expect(recusa(() => validarEntradaDeFluxo({ nome: "!!!", categoria: "Y" })).codigo).toBe(
      "FLUXO_SLUG_INVALIDO",
    );
  });

  it("texto vazio vira nulo, e não string vazia", () => {
    const fluxo = validarEntradaDeFluxo({ nome: "X", categoria: "Y", descricao: "  ", dono: "" });
    expect(fluxo.descricao).toBeNull();
    expect(fluxo.dono).toBeNull();
  });
});

describe("a entrada de uma etapa", () => {
  it("nasce PROCESSO, ATIVA e na origem do canvas", () => {
    const etapa = validarEntradaDeEtapa({ nome: "Conferir" });
    expect(etapa.tipo).toBe("PROCESSO");
    expect(etapa.status).toBe("ATIVO");
    expect(etapa.posX).toBe(0);
    expect(etapa.posY).toBe(0);
  });

  it("recusa tipo fora do catálogo", () => {
    expect(recusa(() => validarEntradaDeEtapa({ nome: "X", tipo: "SUBPROCESSO" })).codigo).toBe(
      "ETAPA_TIPO_INVALIDO",
    );
  });

  it("arredonda a posição, porque meio pixel não é posição", () => {
    const etapa = validarEntradaDeEtapa({ nome: "X", posX: 120.4, posY: -80.6 });
    expect(etapa.posX).toBe(120);
    expect(etapa.posY).toBe(-81);
  });

  it("recusa posição que não é número, em vez de gravar zero", () => {
    // Gravar zero mandaria o cartão para o canto sem ninguém ter pedido.
    expect(recusa(() => validarEntradaDeEtapa({ nome: "X", posX: "muito à direita" })).codigo).toBe(
      "ETAPA_POSICAO_INVALIDA",
    );
  });
});

describe("a conexão", () => {
  it("nasce SEQUENCIA", () => {
    const conexao = validarEntradaDeConexao({ origemEtapaId: "a", destinoEtapaId: "b" });
    expect(conexao.tipo).toBe("SEQUENCIA");
  });

  it("recusa o laço de uma etapa nela mesma", () => {
    expect(
      recusa(() => validarEntradaDeConexao({ origemEtapaId: "a", destinoEtapaId: "a" })).codigo,
    ).toBe("CONEXAO_EM_LACO");
  });

  it("aceita a volta do retrabalho — o ciclo é permitido de propósito", () => {
    const volta = validarEntradaDeConexao({
      origemEtapaId: "correcao",
      destinoEtapaId: "validacao",
      tipo: "RETRABALHO",
      rotulo: "Corrigido, revalidar",
    });
    expect(volta.tipo).toBe("RETRABALHO");
    expect(volta.rotulo).toBe("Corrigido, revalidar");
  });

  it("recusa tipo de conexão fora do catálogo", () => {
    expect(
      recusa(() =>
        validarEntradaDeConexao({ origemEtapaId: "a", destinoEtapaId: "b", tipo: "TALVEZ" }),
      ).codigo,
    ).toBe("CONEXAO_TIPO_INVALIDO");
  });
});

describe("os itens da etapa", () => {
  it("herdam a ordem da posição na lista quando ninguém a declara", () => {
    const item = validarItem({ especie: "FALHA", nome: "Rejeição" }, 3);
    expect(item.ordem).toBe(3);
  });

  it("recusam espécie fora do catálogo", () => {
    expect(recusa(() => validarItem({ especie: "CONTROLE", nome: "X" }, 0)).codigo).toBe(
      "ITEM_ESPECIE_INVALIDA",
    );
  });

  it("aceitam o link https de um sistema", () => {
    const item = validarItem(
      { especie: "SISTEMA", nome: "SEFAZ", link: "https://www.cte.fazenda.gov.br" },
      0,
    );
    expect(item.link).toBe("https://www.cte.fazenda.gov.br");
  });

  it("recusam javascript: como link de sistema", () => {
    expect(
      recusa(() =>
        validarItem({ especie: "SISTEMA", nome: "X", link: "javascript:alert(1)" }, 0),
      ).codigo,
    ).toBe("ITEM_LINK_INVALIDO");
  });
});

describe("a ação que navega dentro do FreightCheck", () => {
  it("aceita um caminho interno", () => {
    const acao = validarAcao({ titulo: "Ver unidades", rota: "/unidades" }, 0);
    expect(acao.rota).toBe("/unidades");
  });

  it("recusa endereço externo", () => {
    expect(
      recusa(() => validarAcao({ titulo: "X", rota: "https://exemplo.com" }, 0)).codigo,
    ).toBe("ACAO_ROTA_INVALIDA");
  });

  it("recusa `//host`, que o navegador lê como outro domínio", () => {
    // A armadilha do "começa com barra": `//evil.com` começa com barra.
    expect(recusa(() => validarRotaInterna("//evil.com/x")).codigo).toBe("ACAO_ROTA_INVALIDA");
  });

  it("recusa javascript:", () => {
    expect(recusa(() => validarRotaInterna("javascript:alert(1)")).codigo).toBe(
      "ACAO_ROTA_INVALIDA",
    );
  });

  it("recusa rota com espaço", () => {
    expect(recusa(() => validarRotaInterna("/alteracoes ver tudo")).codigo).toBe(
      "ACAO_ROTA_INVALIDA",
    );
  });
});

describe("os parâmetros de uma ação", () => {
  it("aceitam um objeto raso e convertem escalares em texto", () => {
    expect(validarParametros({ status: "REJEITADO", pagina: 2, ativo: true })).toEqual({
      status: "REJEITADO",
      pagina: "2",
      ativo: "true",
    });
  });

  it("objeto vazio vira nulo — não vale a pena guardar `{}`", () => {
    expect(validarParametros({})).toBeNull();
  });

  it("recusam aninhamento, que query string não representa", () => {
    expect(recusa(() => validarParametros({ filtro: { de: 1 } })).codigo).toBe(
      "ACAO_PARAMETROS_INVALIDOS",
    );
  });

  it("recusam lista no lugar do objeto", () => {
    expect(recusa(() => validarParametros(["a"])).codigo).toBe("ACAO_PARAMETROS_INVALIDOS");
  });
});

describe("o endereço final de uma ação — a autoridade única da navegação", () => {
  it("sem parâmetros, é a própria rota", () => {
    expect(enderecoDaAcao({ rota: "/unidades" })).toBe("/unidades");
  });

  it("com parâmetros, monta a query string", () => {
    expect(enderecoDaAcao({ rota: "/alteracoes", parametros: { status: "REJEITADO" } })).toBe(
      "/alteracoes?status=REJEITADO",
    );
  });

  it("é determinístico: a ordem das chaves não muda o endereço", () => {
    const a = enderecoDaAcao({ rota: "/x", parametros: { b: "2", a: "1" } });
    const b = enderecoDaAcao({ rota: "/x", parametros: { a: "1", b: "2" } });
    expect(a).toBe(b);
    expect(a).toBe("/x?a=1&b=2");
  });

  it("preserva a query que já está na rota", () => {
    expect(enderecoDaAcao({ rota: "/x?ja=1", parametros: { b: "2" } })).toBe("/x?ja=1&b=2");
  });

  it("escapa o que precisa ser escapado", () => {
    expect(enderecoDaAcao({ rota: "/x", parametros: { q: "CDD Belém" } })).toBe(
      "/x?q=CDD+Bel%C3%A9m",
    );
  });

  it("recusa navegar para fora, mesmo com a rota vindo do banco", () => {
    // Segunda linha de defesa: mesmo que uma linha antiga tenha rota inválida,
    // a tela não monta o endereço.
    expect(recusa(() => enderecoDaAcao({ rota: "//evil.com" })).codigo).toBe(
      "ACAO_ROTA_INVALIDA",
    );
  });
});
