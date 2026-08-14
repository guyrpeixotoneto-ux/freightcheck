import { describe, expect, it } from "vitest";
import { CATALOGO_FREIGHTECH } from "@workspace/knowledge";
import { parameterKeysOfNames, scopeFilter } from "../families";

/**
 * O escopo de um cartão, traduzido do catálogo para o nosso vocabulário.
 *
 * O catálogo do Freightech descreve cada cartão pelo **nome** do parâmetro
 * ("Caminhão") ou pela lista de **colunas** da tela (CAVALO, CARRETA). Nenhuma
 * das duas formas é a nossa chave `FAMÍLIA|Parâmetro`, e a tradução vive aqui.
 *
 * O que estes testes protegem é uma frase que a tela publicava e que não era
 * verdade: *"este cartão não tem parâmetro nenhum alimentado pelo export"*.
 * Ela aparecia sempre que o cartão não se mexera na vigência aberta — porque o
 * escopo saía do mês, e não do catálogo — e no CAVALO ela era dita sobre uma
 * tabela de setenta colunas que chega em toda planilha.
 */

describe("nomes de parâmetro → chaves", () => {
  it("acha a família de um nome do catálogo", () => {
    expect(parameterKeysOfNames(["Caminhão"])).toEqual(["FROTA|Caminhão"]);
  });

  it("ignora acento e caixa — as duas fontes são transcrições independentes", () => {
    expect(parameterKeysOfNames(["CAMINHAO"])).toEqual(["FROTA|Caminhão"]);
  });

  it("um nome desconhecido não some: cai em SEM_FAMILIA, como todo o resto", () => {
    expect(parameterKeysOfNames(["Gaveta que a Ambev inventar amanhã"])).toEqual([
      "SEM_FAMILIA|Gaveta que a Ambev inventar amanhã",
    ]);
  });

  it("traduz todo parâmetro que o catálogo declara — nenhum cartão fica sem escopo", () => {
    const declarados = [
      ...new Set(
        CATALOGO_FREIGHTECH.flatMap((secao) =>
          secao.cartoes.flatMap((cartao) => cartao.parametros ?? []),
        ),
      ),
    ];

    /*
      Um nome declarado no catálogo e não encontrado no dicionário viraria
      `SEM_FAMILIA|<nome>`, que não casa com atributo nenhum: o cartão pediria
      um recorte e receberia o vazio, sem nada na tela dizendo por quê. Se este
      teste quebrar, o catálogo e o dicionário passaram a escrever o mesmo nome
      de dois jeitos — e é isso que precisa ser reconciliado, não este teste.
    */
    for (const nome of declarados) {
      expect(parameterKeysOfNames([nome])).not.toEqual([`SEM_FAMILIA|${nome}`]);
    }
  });
});

describe("o filtro de escopo", () => {
  it("sem recorte nenhum não filtra — é o que a visão geral pede", () => {
    expect(scopeFilter([], [])).toBeNull();
    expect(scopeFilter()).toBeNull();
  });

  it("soma as duas formas, e nunca as cruza", () => {
    const dentro = scopeFilter(["FROTA|Combustível"], ["cavalo.amortizacao_cavalo"])!;

    expect(dentro("cavalo.combustivel_capacidade")).toBe(true); // pelo parâmetro
    expect(dentro("cavalo.amortizacao_cavalo")).toBe(true); // pela coluna
    expect(dentro("cavalo.chassi")).toBe(false); // por nenhum dos dois
  });

  it("uma coluna que o dicionário não conhece entra pelo próprio código", () => {
    const dentro = scopeFilter([], ["cavalo.coluna_nova_da_ambev"])!;
    expect(dentro("cavalo.coluna_nova_da_ambev")).toBe(true);
    expect(dentro(null)).toBe(false);
  });
});
