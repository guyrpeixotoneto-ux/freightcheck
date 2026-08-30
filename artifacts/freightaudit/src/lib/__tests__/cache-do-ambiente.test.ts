// @vitest-environment jsdom
import { QueryClient, hashKey } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { PADRAO_DAS_CONSULTAS } from "@/lib/chamada-resiliente";
import {
  CHAVES_DE_TODO_O_PRODUTO,
  hashDaChaveNoAmbiente,
} from "@/lib/cache-do-ambiente";
import { BASES_DE_AUDITORIA, BASES_DE_FECHAMENTO } from "@/lib/ambiente";
import { CHAVE_DOS_CONTEXTOS } from "@/lib/contextos";

/**
 * **O cache não atravessa a troca de ambiente.**
 *
 * O defeito que este arquivo prende foi relatado da tela: na Auditoria
 * Empurrada a lateral lista as unidades; troca-se para a Auditoria Rota, que
 * não tem vigência importada, e a lista some — legítimo; volta-se para a
 * Empurrada e ela **continua** sumida, porque a resposta vazia do Rota foi
 * gravada na mesma chave `["contexts"]`. Como o `Layout` nunca desmonta, nada
 * a refazia até o `staleTime` vencer com um foco de janela — daí "depois voltou,
 * mas demorou muito".
 *
 * A prova é feita sobre o `QueryClient` montado com `PADRAO_DAS_CONSULTAS`, que
 * é o objeto que roda no produto (`App.tsx`), e não sobre uma reescrita da
 * política: uma prova de isolamento que monta o próprio isolamento não prova
 * nada.
 */
function clienteDoProduto(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: PADRAO_DAS_CONSULTAS } });
}

/** O endereço de uma tela dentro de um ambiente, com a base dele na frente. */
function em(base: string): string {
  return base === "" ? "/contexts-da-tela" : `${base}/contexts-da-tela`;
}

describe("o cache por ambiente", () => {
  it("dá uma chave diferente a cada um dos oito ambientes", () => {
    const bases = [
      ...Object.values(BASES_DE_AUDITORIA),
      ...Object.values(BASES_DE_FECHAMENTO),
    ];
    const hashes = bases.map((base) =>
      hashDaChaveNoAmbiente(CHAVE_DOS_CONTEXTOS, em(base)),
    );

    expect(new Set(hashes).size).toBe(bases.length);
  });

  /*
    A Auditoria Rota e o Fechamento Rota carimbam a mesma operação e são
    ambientes distintos, com telas e acessos separados. Recortar o cache por
    operação os faria dividir respostas.
  */
  it("separa a auditoria do fechamento da mesma operação", () => {
    expect(hashDaChaveNoAmbiente(["dre"], "/auditoria-rota/dre")).not.toBe(
      hashDaChaveNoAmbiente(["dre"], "/fechamento/dre"),
    );
  });

  it("mantém a mesma chave dentro do mesmo ambiente", () => {
    expect(hashDaChaveNoAmbiente(["changes", { period: "2026-08-01" }], "/alteracoes")).toBe(
      hashDaChaveNoAmbiente(["changes", { period: "2026-08-01" }], "/dre"),
    );
  });

  /*
    A sessão vale igual nos oito. Isolá-la faria a troca de ambiente cair numa
    chave sem usuário e sem permissões — a tela de login por cima de uma sessão
    válida.
  */
  it("não recorta as chaves que valem para o produto inteiro", () => {
    for (const raiz of CHAVES_DE_TODO_O_PRODUTO) {
      expect(hashDaChaveNoAmbiente([raiz, "session"], "/auditoria-rota/dre")).toBe(
        hashKey([raiz, "session"]),
      );
    }
  });

  it("não confunde um recorte com uma chave que fale do ambiente", () => {
    expect(hashDaChaveNoAmbiente(["contexts"], "/auditoria-rota")).not.toBe(
      hashDaChaveNoAmbiente(["contexts", "auditoria-rota"], "/alteracoes"),
    );
  });

  /**
   * O caminho do defeito, ponta a ponta, sobre o cliente do produto: a Empurrada
   * grava a lista, o Rota grava o vazio dele, e a volta reencontra a lista —
   * na hora, e não quando o `staleTime` vencer.
   */
  it("devolve a lista da Empurrada depois de passar pelo Rota", () => {
    const cliente = clienteDoProduto();
    const unidades = [{ scopeHash: "abc", label: "PERNAMBUCO" }];

    historia("/alteracoes", () =>
      cliente.setQueryData(CHAVE_DOS_CONTEXTOS, unidades),
    );
    historia("/auditoria-rota/alteracoes", () =>
      cliente.setQueryData(CHAVE_DOS_CONTEXTOS, []),
    );

    expect(historia("/auditoria-rota/alteracoes", () =>
      cliente.getQueryData(CHAVE_DOS_CONTEXTOS),
    )).toEqual([]);
    expect(historia("/alteracoes", () =>
      cliente.getQueryData(CHAVE_DOS_CONTEXTOS),
    )).toEqual(unidades);
  });
});

/**
 * Roda um trecho como se o navegador estivesse naquele endereço.
 *
 * O `hashDaChave` do produto lê `window.location`, como `getApiUrl` lê — é a
 * mesma fonte da verdade, e é ela que o teste precisa mover para simular a
 * troca de ambiente. A função pura (`hashDaChaveNoAmbiente`) é o que os outros
 * casos exercitam; este aqui é o único que precisa do navegador, porque o que
 * ele prova é o `QueryClient` inteiro.
 */
function historia<T>(endereco: string, trecho: () => T): T {
  window.history.replaceState(null, "", endereco);
  return trecho();
}
