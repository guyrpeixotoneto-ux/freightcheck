import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O teste que guarda a única promessa que a lateral faz: **clicar leva a algum
 * lugar.**
 *
 * A lista tem cinquenta itens e o roteador atende cinquenta e quatro endereços,
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

/** Os `href:` da lateral da Auditoria — os itens do menu, sem os atalhos internos. */
function hrefsDoMenu(): string[] {
  const texto = fonte("components/layout/sidebar.tsx");
  const lista = texto.slice(
    texto.indexOf("const NAV_GROUPS"),
    texto.indexOf("export function Sidebar"),
  );
  return [...lista.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
}

/** Os `href:` da lateral do Fechamento, que vive em arquivo próprio. */
function hrefsDoMenuDoFechamento(): string[] {
  const texto = fonte("components/layout/nav-fechamento.ts");
  return [...texto.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Os `path=` do roteador, mais as rotas que os dois catálogos geram — o de
 * telas em preparo da Auditoria e o de etapas do Fechamento.
 */
function rotasRegistradas(): Set<string> {
  const app = fonte("App.tsx");
  const catalogo = fonte("pages/telas-em-preparo.ts");
  const etapas = fonte("pages/fechamento/etapas.ts");

  return new Set([
    ...[...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]),
    ...[...catalogo.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]),
    ...[...etapas.matchAll(/^\s{4}href:\s*"([^"]+)"/gm)].map((m) => m[1]),
  ]);
}

describe("a lateral", () => {
  it("não oferece nenhum item que o roteador não atenda", () => {
    const rotas = rotasRegistradas();
    const orfaos = [...hrefsDoMenu(), ...hrefsDoMenuDoFechamento()].filter(
      (href) => !rotas.has(href),
    );

    expect(orfaos).toEqual([]);
  });

  it("não repete um endereço em dois itens", () => {
    const hrefs = [...hrefsDoMenu(), ...hrefsDoMenuDoFechamento()];

    expect(hrefs).toHaveLength(new Set(hrefs).size);
  });

  it("mantém as nove seções do desenho, na ordem", () => {
    const texto = fonte("components/layout/sidebar.tsx");
    const lista = texto.slice(
      texto.indexOf("const NAV_GROUPS"),
      texto.indexOf("export function Sidebar"),
    );

    expect([...lista.matchAll(/titulo:\s*"([^"]+)"/g)].map((m) => m[1])).toEqual([
      "Visão executiva",
      /*
        Compras vem antes de Auditoria porque é um portão antes de o dinheiro
        sair, e não uma descoberta sobre o que já saiu — ver o comentário da
        seção em `sidebar.tsx`.
      */
      "Compras",
      "Auditoria",
      "Recuperação",
      "QLP",
      "Frota",
      "Inteligência",
      "Dados & governança",
      "Administração",
    ]);
  });

  /*
    A lateral do Fechamento segue a ordem do processo — o fechamento que se
    abre, a apuração dele, a decisão sobre o que foi apurado, o registro do que
    fechou.
    O teste guarda a ordem pela mesma razão do teste acima: ela é desenho, não
    acaso.

    Remuneração é a exceção que confirma a regra, e por isso está no meio e não
    no fim: ela não é um momento do processo, é a base contra a qual ele roda —
    o cadastro da unidade, que a apuração consome. Entre Fechamento e Apuração é
    onde ela é consultada, e é onde ela fica.
  */
  it("mantém as cinco seções do Fechamento, na ordem do processo", () => {
    const texto = fonte("components/layout/nav-fechamento.ts");

    expect([...texto.matchAll(/titulo:\s*"([^"]+)"/g)].map((m) => m[1])).toEqual([
      "Fechamento",
      "Remuneração",
      "Apuração",
      "Decisão",
      "Registro",
    ]);
  });

  /*
    Todo item do menu do Fechamento vive sob `/fechamento` — é o prefixo que
    define o ambiente (`lib/ambiente.ts`). Um item fora dele mudaria de
    ambiente ao ser clicado, e a lateral trocaria embaixo do clique.
  */
  it("não põe, no menu do Fechamento, nenhum endereço fora de /fechamento", () => {
    const fora = hrefsDoMenuDoFechamento().filter(
      (href) => href !== "/fechamento" && !href.startsWith("/fechamento/"),
    );

    expect(fora).toEqual([]);
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

describe("o catálogo de etapas do Fechamento", () => {
  /*
    As mesmas garantias do catálogo da Auditoria, porque a regra é a mesma:
    tela sem número diz o que falta, e o atalho de "onde olhar hoje" só vale
    quando leva a uma tela que já responde — nunca a outra tela em preparo,
    de nenhum dos dois catálogos.
  */
  it("só manda, em 'onde olhar hoje', para telas que já funcionam", () => {
    const etapas = fonte("pages/fechamento/etapas.ts");
    const catalogo = fonte("pages/telas-em-preparo.ts");
    const emPreparo = new Set([
      ...[...etapas.matchAll(/^\s{4}href:\s*"([^"]+)"/gm)].map((m) => m[1]),
      ...[...catalogo.matchAll(/^\s{4}href:\s*"([^"]+)"/gm)].map((m) => m[1]),
    ]);
    const atalhos = [...etapas.matchAll(/^\s{8}href:\s*"([^"]+)"/gm)].map((m) => m[1]);

    expect(atalhos.length).toBeGreaterThan(0);
    expect(atalhos.filter((href) => emPreparo.has(href))).toEqual([]);
  });

  it("descreve, para cada etapa, o que falta antes de ela mostrar um número", () => {
    const etapas = fonte("pages/fechamento/etapas.ts");
    const telas = [...etapas.matchAll(/^\s{4}href:\s*"([^"]+)"/gm)].length;

    /*
      Sete, e não as oito do desenho original: **Importações** saiu do
      catálogo quando virou tela de verdade — a competência existe no banco,
      recebe os relatórios da quinzena e apura. Este número cai a cada
      etapa construída, e chegar a zero é o catálogo ter cumprido o seu papel.
    */
    expect(telas).toBe(7);
    expect([...etapas.matchAll(/^\s{4}depende:\s*\[/gm)]).toHaveLength(telas);
    expect([...etapas.matchAll(/^\s{4}pergunta:/gm)]).toHaveLength(telas);
  });
});
