import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SECOES_GERAIS, estaEmPreparo } from "../secoes";

/**
 * O índice de Configurações promete nove seções — este caso cobra as nove.
 *
 * A lista de `secoes.ts` é um menu como outro qualquer, e vale para ela a regra
 * que vale para a lateral: item que o roteador não atende é promessa que acaba
 * em 404. A diferença é que aqui há dois jeitos legítimos de atender — a
 * `<Route>` escrita em `App.tsx`, para a seção que existe, e a entrada do
 * catálogo de telas em preparo, para a que ainda não existe —, e o que este
 * caso recusa é a terceira: a linha que não tem nem uma nem outra.
 *
 * A leitura é do texto de `App.tsx`, e não do módulo, pela mesma razão da
 * suíte da lateral: importar o roteador traria React e o Tanstack Query para
 * uma suíte que roda em Node sem DOM.
 */

const raiz = path.resolve(import.meta.dirname, "../../..");

const app = readFileSync(path.join(raiz, "App.tsx"), "utf8");

const rotasDoApp = new Set(
  [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]),
);

describe("o índice de Configurações", () => {
  it("não oferece nenhuma seção que o roteador não atenda", () => {
    for (const secao of SECOES_GERAIS) {
      expect(
        rotasDoApp.has(secao.href) || estaEmPreparo(secao.href),
        `${secao.label} (${secao.href}) não tem rota nem entrada no catálogo`,
      ).toBe(true);
    }
  });

  it("dá tela de verdade às seções que não estão em preparo", () => {
    const sustentadas = SECOES_GERAIS.filter((s) => !estaEmPreparo(s.href));

    /*
      Dez hoje. Eram três — Meu Perfil, Unidades e Usuários —, viraram quatro
      quando Permissões ganhou endereço próprio, sete quando o cadastro da casa
      nasceu e Cargos, Negócio e Departamento saíram do catálogo de telas em
      preparo, oito quando a troca da senha saiu de Meu Perfil e virou Segurança,
      nove quando o papel deixou de ser dois valores no código e virou cadastro,
      e dez quando os Módulos Universais deram à casa a terceira camada — a que
      diz que partes do produto esta instalação usa, acima do papel e da
      exceção. É exatamente o efeito que este `expect` existe para produzir:
      ele cai no dia da mudança e obriga a olhar as duas listas juntas, em vez
      de deixar o catálogo prometendo o que já existe.
    */
    expect(sustentadas.map((s) => s.href)).toEqual([
      "/configuracoes/perfil",
      "/configuracoes/seguranca",
      "/configuracoes/unidades",
      "/configuracoes/usuarios",
      "/configuracoes/papeis",
      "/configuracoes/permissoes",
      "/configuracoes/modulos-universais",
      "/configuracoes/cargos",
      "/configuracoes/negocio",
      "/configuracoes/departamento",
    ]);
    for (const secao of sustentadas) {
      expect(rotasDoApp.has(secao.href)).toBe(true);
    }
  });

  it("não repete endereço", () => {
    const enderecos = SECOES_GERAIS.map((s) => s.href);
    expect(new Set(enderecos).size).toBe(enderecos.length);
  });
});
