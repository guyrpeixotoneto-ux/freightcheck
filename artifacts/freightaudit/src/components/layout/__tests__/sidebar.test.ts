import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { navGroupsFechamento } from "../nav-fechamento";
import { etapasDoFechamento } from "@/pages/fechamento/etapas";
import { BASES_DE_FECHAMENTO } from "@/lib/ambiente";

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

/**
 * A base sobre a qual este teste confere os dois lados.
 *
 * Rota e Empurrada montam menu e rotas da mesma função sobre bases diferentes
 * (`lib/ambiente.ts`), então conferir as duas seria conferir o mesmo desenho
 * duas vezes. Confere-se sobre uma — a do Rota, por ser a que os textos do
 * roteador escrevem por extenso —, e o que vale para ela vale para a outra por
 * construção. Os dois testes de simetria, mais abaixo, guardam a construção.
 */
const BASE = BASES_DE_FECHAMENTO["fechamento-rota"];

/**
 * Os `href` da lateral do Fechamento, que vive em arquivo próprio.
 *
 * Aqui se lê o módulo, e não o texto dele: desde que a lista virou função da
 * base, o `href` deixou de ser literal no arquivo — e uma expressão regular
 * sobre `` `${base}/...` `` conferiria a grafia do template, não o endereço que
 * sai dele. `nav-fechamento.ts` só importa ícones, então lê-lo não traz React
 * nem roteador para esta suíte.
 */
function hrefsDoMenuDoFechamento(): string[] {
  return navGroupsFechamento(BASE, "Fechamento Rota").flatMap((grupo) =>
    grupo.itens.map((item) => item.href),
  );
}

/**
 * Os `path=` do roteador, mais as rotas que os dois catálogos geram — o de
 * telas em preparo da Auditoria e o de etapas do Fechamento.
 */
function rotasRegistradas(): Set<string> {
  const app = fonte("App.tsx");
  const catalogo = fonte("pages/telas-em-preparo.ts");

  return new Set([
    ...[...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]),
    ...rotasDoFechamentoNoRoteador(),
    ...[...catalogo.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]),
    ...etapasDoFechamento(BASE).map((etapa) => etapa.href),
  ]);
}

/**
 * As rotas que `rotasDoFechamento`, em `App.tsx`, monta sobre a base.
 *
 * Elas são escritas como `path={base}` e `` path={`${base}/...`} `` — o
 * roteador é um só para os dois fechamentos —, e é isso que esta leitura
 * traduz de volta para endereço. Continua sendo leitura de texto, e não import,
 * porque importar `App.tsx` traria React, o Tanstack Query e o roteador inteiro
 * para uma suíte que roda em Node sem DOM.
 */
function rotasDoFechamentoNoRoteador(): string[] {
  const app = fonte("App.tsx");
  const raiz = /path=\{base\}/.test(app) ? [BASE] : [];
  const filhas = [...app.matchAll(/path=\{`\$\{base\}([^`]*)`\}/g)].map(
    (m) => `${BASE}${m[1]}`,
  );

  return [...raiz, ...filhas];
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
    /*
      A primeira seção leva o nome do ambiente: é ali que o menu diz em qual dos
      dois fechamentos se está, já que as outras quatro são idênticas nos dois.
    */
    expect(navGroupsFechamento(BASE, "Fechamento Rota").map((g) => g.titulo)).toEqual([
      "Fechamento Rota",
      "Remuneração",
      "Apuração",
      "Decisão",
      "Registro",
    ]);
  });

  /*
    Todo item do menu do Fechamento vive sob a base do ambiente — é o prefixo
    que o define (`lib/ambiente.ts`). Um item fora dela mudaria de ambiente ao
    ser clicado, e a lateral trocaria embaixo do clique.
  */
  it("não põe, no menu do Fechamento, nenhum endereço fora da base", () => {
    const fora = hrefsDoMenuDoFechamento().filter(
      (href) => href !== BASE && !href.startsWith(`${BASE}/`),
    );

    expect(fora).toEqual([]);
  });

  /*
    O que garante que Rota e Empurrada são o mesmo produto: o menu de um é o do
    outro com a base trocada. Se algum dia um item escapar para um endereço
    literal, é aqui que ele aparece — o menu da Empurrada teria um endereço do
    Rota no meio dele, que é a regressão silenciosa que
    `lib/base-do-fechamento.ts` existe para impedir.
  */
  it("dá às duas bases o mesmo menu, item a item", () => {
    const empurrada = BASES_DE_FECHAMENTO["fechamento-empurrada"];
    const daEmpurrada = navGroupsFechamento(empurrada, "Fechamento Empurrada").flatMap((g) =>
      g.itens.map((item) => item.href),
    );

    expect(daEmpurrada).toEqual(
      hrefsDoMenuDoFechamento().map((href) => href.replace(BASE, empurrada)),
    );
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
    const etapas = etapasDoFechamento(BASE);
    const catalogo = fonte("pages/telas-em-preparo.ts");
    const emPreparo = new Set([
      ...etapas.map((etapa) => etapa.href),
      ...[...catalogo.matchAll(/^\s{4}href:\s*"([^"]+)"/gm)].map((m) => m[1]),
    ]);
    const atalhos = etapas.flatMap((etapa) => etapa.hoje.map((atalho) => atalho.href));

    expect(atalhos.length).toBeGreaterThan(0);
    expect(atalhos.filter((href) => emPreparo.has(href))).toEqual([]);
  });

  it("descreve, para cada etapa, o que falta antes de ela mostrar um número", () => {
    const etapas = etapasDoFechamento(BASE);
    const telas = etapas.length;

    /*
      Sete, e não as oito do desenho original: **Importações** saiu do
      catálogo quando virou tela de verdade — a competência existe no banco,
      recebe os relatórios da quinzena e apura. Este número cai a cada
      etapa construída, e chegar a zero é o catálogo ter cumprido o seu papel.
    */
    expect(telas).toBe(7);
    expect(etapas.filter((etapa) => etapa.depende.length > 0)).toHaveLength(telas);
    expect(etapas.filter((etapa) => etapa.pergunta.length > 0)).toHaveLength(telas);
  });

  /*
    As sete etapas existem nos dois fechamentos, cada uma no endereço do seu: a
    Empurrada não herda nenhuma rota do Rota, e é isso que este teste guarda —
    uma etapa que escapasse com endereço literal apontaria as duas para a mesma
    tela.
  */
  it("dá a cada base o seu próprio conjunto de etapas", () => {
    const empurrada = BASES_DE_FECHAMENTO["fechamento-empurrada"];

    expect(etapasDoFechamento(empurrada).map((etapa) => etapa.href)).toEqual(
      etapasDoFechamento(BASE).map((etapa) => etapa.href.replace(BASE, empurrada)),
    );
  });
});
