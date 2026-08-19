import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O teste que guarda a única promessa que a lateral faz: **clicar leva a algum
 * lugar.**
 *
 * A lista tem trinta e cinco itens e o roteador atende trinta e sete endereços,
 * em dois arquivos que ninguém edita ao mesmo tempo. Um `href` com um traço a
 * mais não quebra typecheck, não quebra build e não aparece em revisão — ele
 * aparece no dia em que alguém clica no item e recebe a tela de "não
 * encontrado", que é a forma mais cara de descobrir um erro de digitação.
 *
 * A leitura é do texto dos dois arquivos, e não dos módulos, de propósito:
 * importar a lateral traria React, o Tanstack Query e o roteador para dentro de
 * uma suíte que roda em Node sem DOM, e o que se quer verificar aqui não é o
 * comportamento de nenhum dos três — é que duas listas de textos coincidam.
 */

const raiz = path.resolve(import.meta.dirname, "../../..");

const fonte = (relativo: string) =>
  readFileSync(path.join(raiz, relativo), "utf8");

/** Os `href:` da lateral — os itens do menu, sem os atalhos internos das telas. */
function hrefsDoMenu(): string[] {
  const texto = fonte("components/layout/sidebar.tsx");
  const lista = texto.slice(
    texto.indexOf("const NAV_GROUPS"),
    texto.indexOf("export function Sidebar"),
  );
  return [...lista.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
}

/** Os `path=` do roteador, mais as rotas que o catálogo de telas em preparo gera. */
function rotasRegistradas(): Set<string> {
  const app = fonte("App.tsx");
  const catalogo = fonte("pages/telas-em-preparo.ts");

  return new Set([
    ...[...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]),
    ...[...catalogo.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]),
  ]);
}

describe("a lateral", () => {
  it("não oferece nenhum item que o roteador não atenda", () => {
    const rotas = rotasRegistradas();
    const orfaos = hrefsDoMenu().filter((href) => !rotas.has(href));

    expect(orfaos).toEqual([]);
  });

  it("não repete um endereço em dois itens", () => {
    const hrefs = hrefsDoMenu();

    expect(hrefs).toHaveLength(new Set(hrefs).size);
  });

  it("mantém as oito seções do desenho, na ordem", () => {
    const texto = fonte("components/layout/sidebar.tsx");
    const lista = texto.slice(
      texto.indexOf("const NAV_GROUPS"),
      texto.indexOf("export function Sidebar"),
    );

    expect([...lista.matchAll(/titulo:\s*"([^"]+)"/g)].map((m) => m[1])).toEqual([
      "Visão executiva",
      "Auditoria",
      "Recuperação",
      "QLP",
      "Frota",
      "Inteligência",
      "Dados & governança",
      "Administração",
    ]);
  });
});

describe("o catálogo de telas em preparo", () => {
  /*
    Uma tela em preparo cujo "onde olhar hoje" aponta para outra tela em preparo
    manda quem abriu para a mesma frase, escrita com outras palavras. O atalho só
    vale quando leva a algo que já responde.
  */
  it("só manda, em 'onde olhar hoje', para telas que já funcionam", () => {
    const catalogo = fonte("pages/telas-em-preparo.ts");
    const emPreparo = new Set(
      [...catalogo.matchAll(/^\s{4}href:\s*"([^"]+)"/gm)].map((m) => m[1]),
    );
    const atalhos = [...catalogo.matchAll(/^\s{8}href:\s*"([^"]+)"/gm)].map((m) => m[1]);

    expect(atalhos.length).toBeGreaterThan(0);
    expect(atalhos.filter((href) => emPreparo.has(href))).toEqual([]);
  });

  /*
    O número cai quando uma tela fica pronta, e é isso que ele mede.

    Eram dezoito; `/impacto-financeiro` saiu ao virar Alterações › Impacto,
    `/cavalo-360` e `/carreta-360` saíram ao virar `pages/frota-360.tsx`, e
    `/qlp-administrativo` saiu quando a importação passou a receber o export
    próprio do QLP ADM e a tela de verdade nasceu em
    `pages/qlp-administrativo.tsx`. As rotas passaram a ser `<Route>` de
    verdade em `App.tsx`, e o teste acima, o dos órfãos, garante que nenhum item do
    menu ficou apontando para o vazio na troca. Baixá-lo aqui é o último passo
    de entregar uma tela; subi-lo sem acrescentar `pergunta` e `depende` é o que
    este caso recusa.
  */
  it("descreve, para cada tela, o que falta antes de ela mostrar um número", () => {
    const catalogo = fonte("pages/telas-em-preparo.ts");
    const telas = [...catalogo.matchAll(/^\s{4}href:\s*"([^"]+)"/gm)].length;

    expect(telas).toBe(16);
    expect([...catalogo.matchAll(/^\s{4}depende:\s*\[/gm)]).toHaveLength(telas);
    expect([...catalogo.matchAll(/^\s{4}pergunta:/gm)]).toHaveLength(telas);
  });
});
