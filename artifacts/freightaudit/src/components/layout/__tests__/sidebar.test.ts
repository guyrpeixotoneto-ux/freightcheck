import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GRUPO_ADMINISTRACAO } from "../nav-administracao";
import { navGroupsAuditoria } from "../nav-auditoria";
import { modulosDoQlp } from "@workspace/comparison/qlp-comparacao";
import { navGroupsFechamento } from "../nav-fechamento";
import { barraMobile } from "../nav-mobile";
import { etapasDoFechamento } from "@/pages/fechamento/etapas";
import {
  ATIVOS_E_PARADOS,
  BASES_DE_AUDITORIA,
  BASES_DE_FECHAMENTO,
  DASHBOARD,
  ENTRADA_DA_AUDITORIA,
  EVOLUCAO_POR_PLACA,
  GESTAO_A_VISTA,
  IMPACTO_APURADO,
  LINHA_DO_TEMPO,
  PANORAMA,
  RESUMO_EXECUTIVO,
  type AmbienteDeAuditoria,
} from "@/lib/ambiente";
import { EQUIPAMENTOS_DO_AMBIENTE, TELA_DO_EQUIPAMENTO } from "@/lib/frota";

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

/**
 * Os `href` da lateral da Auditoria, lidos do módulo.
 *
 * Eram lidos do texto de `sidebar.tsx` enquanto a lista era uma constante
 * escrita ali. Desde que ela virou função do ambiente — porque há quatro
 * auditorias, e a seção Frota mostra o ativo da operação (`nav-auditoria.ts`) —,
 * ler o texto conferiria a grafia de um template e não o endereço que sai dele,
 * que é a mesma razão pela qual a lista do Fechamento sempre foi lida assim.
 * `nav-auditoria.ts` só importa ícones e vocabulário, então lê-lo não traz React
 * nem roteador para esta suíte.
 *
 * O `~` da Administração é a marca de endereço absoluto do wouter
 * (`nav-administracao.ts`), e não faz parte do endereço: some aqui, para que a
 * conferência seja contra a rota que o roteador registra.
 */
const semTil = (href: string) => (href.startsWith("~") ? href.slice(1) : href);

function hrefsDoMenu(ambiente: AmbienteDeAuditoria = "auditoria"): string[] {
  return navGroupsAuditoria(ambiente).flatMap((grupo) =>
    grupo.itens.map((item) => semTil(item.href)),
  );
}

/** Os títulos das seções da lateral da Auditoria, na ordem em que ela as mostra. */
function secoesDaAuditoria(ambiente: AmbienteDeAuditoria = "auditoria"): string[] {
  return navGroupsAuditoria(ambiente).map((grupo) => grupo.titulo);
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
    grupo.itens.map((item) => semTil(item.href)),
  );
}

/**
 * Os `path=` do roteador, mais as rotas que os dois catálogos geram — o de
 * telas em preparo da Auditoria e o de etapas do Fechamento.
 */
/**
 * Os `href` da barra do celular, nos três ambientes.
 *
 * Ela promete o mesmo que a lateral — clicar leva a algum lugar —, e promete
 * mais uma coisa: **não inventa destino**. Todo atalho da barra é um item que a
 * lateral já lista, com o mesmo endereço; é por isso que os dois testes abaixo
 * conferem contra o roteador *e* contra a lista lateral do mesmo ambiente. Um
 * atalho só da barra seria uma tela que só existe no telefone, e este produto
 * não tem nenhuma.
 */
function atalhosDaBarra(ambiente: Parameters<typeof barraMobile>[0]): string[] {
  const barra = barraMobile(ambiente);
  return [...barra.esquerda, barra.centro, ...barra.direita].map((a) => a.href);
}

/** As constantes de endereço que o roteador usa no lugar do literal. */
const CONSTANTES_DE_ROTA: Record<string, string> = {
  ATIVOS_E_PARADOS,
  DASHBOARD,
  PANORAMA,
  EVOLUCAO_POR_PLACA,
  GESTAO_A_VISTA,
  IMPACTO_APURADO,
  LINHA_DO_TEMPO,
  RESUMO_EXECUTIVO,
  ENTRADA_DA_AUDITORIA,
};

function rotasRegistradas(): Set<string> {
  const app = fonte("App.tsx");
  const catalogo = fonte("pages/telas-em-preparo.ts");

  return new Set([
    ...[...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]),
    /*
      Cinco rotas da Auditoria são escritas com a constante, e não com o
      literal — `<Route path={DASHBOARD}>`, `{IMPACTO_APURADO}` e as irmãs
      delas. Traduzi-las
      aqui é o que faz este teste conferir endereços, e não grafias: a lateral
      também as escreve pela constante, e as duas só podem discordar se alguém
      trocar o valor num lugar só — que é exatamente o que não existe, porque o
      valor é um.
    */
    ...[...app.matchAll(/<Route\s+path=\{([A-Z_]+)\}/g)].map(
      (m) => CONSTANTES_DE_ROTA[m[1]] ?? m[1],
    ),
    ...rotasDoFechamentoNoRoteador(),
    ...[...catalogo.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]),
    ...etapasDoFechamento(BASE).map((etapa) => etapa.href),
  ]);
}

/**
 * As rotas que o roteador atende **por padrão**, e não por literal.
 *
 * Nasceu com a seção QLP, a primeira em que os itens do menu são derivados de
 * um catálogo: são dezesseis endereços — `/qlp/salario`, `/qlp/saude`… — que
 * `App.tsx` atende com uma `<Route path="/qlp/:modulo">` só. Escrever dezesseis
 * rotas para satisfazer a leitura literal deste teste seria a lista à mão que o
 * menu deixou de ter, e ela discordaria do catálogo no primeiro export que
 * trouxesse uma coluna nova.
 *
 * O que o teste guarda continua sendo o mesmo: nenhum item leva a lugar nenhum.
 * O que muda é que um item pode ser atendido por um padrão — e o padrão é lido
 * do roteador, como os literais, e não escrito aqui.
 */
function rotasComParametro(): RegExp[] {
  const app = fonte("App.tsx");
  return [...app.matchAll(/<Route\s+path="([^"]*:[^"]+)"/g)].map(
    (m) => new RegExp(`^${m[1].replace(/:[^/]+/g, "[^/]+")}$`),
  );
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
    const padroes = rotasComParametro();
    const daAuditoria = Object.keys(BASES_DE_AUDITORIA).flatMap((ambiente) =>
      hrefsDoMenu(ambiente as AmbienteDeAuditoria),
    );
    const orfaos = [...daAuditoria, ...hrefsDoMenuDoFechamento()].filter(
      (href) => !rotas.has(href) && !padroes.some((padrao) => padrao.test(href)),
    );

    expect(orfaos).toEqual([]);
  });

  /*
    A seção QLP é a primeira derivada de um catálogo, e é isso que este caso
    prende: os itens dela **são** os módulos que as rubricas dos dois quadros
    sustentam, nem um a mais nem um a menos.

    Escrita à mão, a lista concordaria com o catálogo no dia em que fosse
    escrita — e no dia em que a Ambev mandar o export administrativo
    decomposto, continuaria dizendo que plano de saúde só existe no operacional.
    Derivada, ela acende sozinha; este teste é o que impede alguém de voltar a
    escrevê-la.
  */
  it("lista na seção QLP exatamente os módulos que o catálogo sustenta", () => {
    const secao = navGroupsAuditoria("auditoria").find((g) => g.id === "modulos-do-qlp");
    expect(secao, "a seção QLP precisa existir na lateral").toBeTruthy();

    expect(secao!.itens.map((i) => i.href)).toEqual(
      modulosDoQlp().map((m) => `/qlp/${m.chave}`),
    );

    /* E os três que o usuário procura estão entre eles, com nome de gente. */
    const porHref = new Map(secao!.itens.map((i) => [i.href, i.label]));
    expect(porHref.get("/qlp/salario")).toBe("Salário");
    expect(porHref.get("/qlp/transporte")).toBe("Vale-transporte");
    expect(porHref.get("/qlp/saude")).toBe("Plano de saúde");

    /* Subtotal e benchmark não são assunto: são eixo de leitura. */
    expect(porHref.has("/qlp/subtotais")).toBe(false);
    expect(porHref.has("/qlp/benchmark")).toBe(false);
  });

  it("não oferece, na barra do celular, endereço que o roteador não atenda", () => {
    const rotas = rotasRegistradas();
    /*
      Confere-se sobre a base do Rota, pela mesma razão de `BASE`: o roteador
      escreve as rotas do Fechamento sobre uma base, e a Empurrada é a mesma
      lista com o prefixo trocado — o que o teste de simetria, mais abaixo,
      guarda.
    */
    const orfaos = [
      ...atalhosDaBarra("auditoria"),
      ...atalhosDaBarra("fechamento-rota"),
    ].filter((href) => !rotas.has(href));

    expect(orfaos).toEqual([]);
  });

  /*
    A barra do celular é atalho para quatro linhas da lateral, e nunca um
    segundo menu: o mesmo endereço, o mesmo destino. Se um atalho escapar para
    um endereço que a lateral não lista, o telefone passa a ter uma tela que o
    computador não alcança — e é aqui que isso aparece.
  */
  it("só põe, na barra do celular, endereços que a lateral já lista", () => {
    /*
      `hrefsDoMenu` lê os literais do arquivo, e os itens da Visão executiva são
      constantes de `lib/ambiente.ts` — o literal deles não está escrito na
      lista. Somá-los aqui é o que faz o teste comparar endereços, e não
      grafias.
    */
    const daAuditoria = new Set([...hrefsDoMenu(), ENTRADA_DA_AUDITORIA]);
    const doFechamento = new Set(hrefsDoMenuDoFechamento());

    expect(atalhosDaBarra("auditoria").filter((href) => !daAuditoria.has(href))).toEqual([]);
    expect(atalhosDaBarra("fechamento-rota").filter((href) => !doFechamento.has(href))).toEqual([]);
  });

  /*
    Rota e Empurrada são o mesmo produto também no telefone — a barra de um é a
    do outro com a base trocada, pela mesma razão que a lateral.
  */
  it("dá às duas bases a mesma barra de celular", () => {
    const empurrada = BASES_DE_FECHAMENTO["fechamento-empurrada"];

    expect(atalhosDaBarra("fechamento-empurrada")).toEqual(
      atalhosDaBarra("fechamento-rota").map((href) => href.replace(BASE, empurrada)),
    );
  });

  /*
    A conferência é por lateral, e não sobre as duas somadas: a Administração é
    de propósito a mesma seção nas duas (`nav-administracao.ts`), então os
    endereços dela aparecem nos dois lados. O que não pode haver é o mesmo
    endereço em dois itens *da mesma lista* — aí um dos dois é engano.
  */
  it("não repete um endereço em dois itens da mesma lateral", () => {
    for (const hrefs of [hrefsDoMenu(), hrefsDoMenuDoFechamento()]) {
      expect(hrefs).toHaveLength(new Set(hrefs).size);
    }
  });

  /*
    A seção Visão executiva é a leitura executiva inteira, e a ordem dela é a da
    **altitude**: o Panorama Executivo primeiro, porque responde às sete
    perguntas de uma vez; o Painel de Unidades logo depois, porque é a única
    leitura mais alta que ele (o ano inteiro, unidade a unidade); e então os
    quatro módulos que o Panorama consolida, que ficam pelos endereços — ver
    `nav-auditoria.ts` e `docs/PROPOSTA-PANORAMA-EXECUTIVO.md`.

    Este teste guarda a lista item a item porque é o tipo de coisa que se perde
    calada: um item que some do menu não quebra typecheck nem build — some da
    lateral, e quem usava aquela tela descobre no dia em que procura por ela.

    **E guarda os quatro consolidados nominalmente**, que é o ponto do caminho B:
    o Panorama entrou como porta e eles continuam existindo, com os endereços
    intactos. Aposentá-los é uma decisão que se toma com medida de uso na mão, e
    este teste é o que faz ela ter de ser tomada de propósito em vez de
    acontecer por descuido numa refatoração.
  */
  it("põe, na Visão executiva, o Panorama à frente dos quatro que ele consolida", () => {
    for (const ambiente of Object.keys(BASES_DE_AUDITORIA)) {
      const executiva = navGroupsAuditoria(ambiente as AmbienteDeAuditoria).find(
        (grupo) => grupo.titulo === "Visão executiva",
      )!;

      expect(executiva.itens.map((item) => item.label)).toEqual([
        "Panorama Executivo",
        "Painel de Unidades",
        "Impacto Líquido",
        "Impacto Apurado",
        "Resumo executivo",
        "Linha do Tempo",
        "Evolução por Placa",
        "Ativos e Parados",
        "Acompanhamento",
        "Composição",
        "DRE",
      ]);
      expect(executiva.itens.slice(0, 7).map((item) => item.href)).toEqual([
        PANORAMA,
        ENTRADA_DA_AUDITORIA,
        DASHBOARD,
        IMPACTO_APURADO,
        RESUMO_EXECUTIVO,
        LINHA_DO_TEMPO,
        EVOLUCAO_POR_PLACA,
      ]);
    }
  });

  /*
    A fusão das duas seções deixou uma só, e o nome dela é o do assunto: "Visão
    executiva", e não "Dashboard". Este caso guarda os dois lados do
    renomeio — que a seção está lá com o nome novo, e que o antigo não voltou
    como um segundo cartão ao lado dela.
  */
  it("chama a seção de Visão executiva, e não mais de Dashboard", () => {
    expect(secoesDaAuditoria()).toContain("Visão executiva");
    expect(secoesDaAuditoria()).not.toContain("Dashboard");
  });

  /*
    Os dois módulos são duas telas, e não uma com aba: cada um tem endereço
    próprio no roteador. Uma aba faria a lateral acender o item errado — a razão
    está em `lib/ambiente.ts`.
  */
  it("registra uma rota própria para cada módulo da Visão executiva", () => {
    const rotas = rotasRegistradas();

    expect(rotas.has(PANORAMA)).toBe(true);
    expect(rotas.has(DASHBOARD)).toBe(true);
    expect(rotas.has(IMPACTO_APURADO)).toBe(true);
    expect(rotas.has(RESUMO_EXECUTIVO)).toBe(true);
    expect(rotas.has(LINHA_DO_TEMPO)).toBe(true);

    /*
      Os cinco são endereços distintos, e é isso que faz a lateral acender o
      item certo: um módulo que fosse aba dentro de outro acenderia o vizinho.
    */
    expect(new Set([PANORAMA, DASHBOARD, IMPACTO_APURADO, RESUMO_EXECUTIVO, LINHA_DO_TEMPO]).size).toBe(5);
  });

  /*
    A seção dos chamados reúne as quatro telas da manhã, e a ordem delas é a do
    caminho: o monitoramento, que diz o que mudou nos chamados desde a última
    importação; a conciliação, que confere se o que mudou nos chamados é o que
    mudou na planilha; a fila, onde se justifica cada mudança; e o painel, onde
    se confere o que ainda falta justificar.

    O caso guarda os dois lados da fusão — as quatro no mesmo cartão, na ordem,
    e a seção "Justificativas" que não voltou como um segundo cartão ao lado
    dela. Um item que escorregue de lugar aqui não quebra typecheck nem build:
    aparece no dia em que alguém abre a lateral e não acha a fila onde ela
    estava.

    A conciliação vem em segundo, e não no fim: ela é a pergunta seguinte à do
    monitoramento e sobre o mesmo material, e a fila de justificativas já
    pressupõe saber o que mudou.
  */
  it("põe, em Chamados Ambev, o monitoramento e a conciliação à frente da fila e do painel", () => {
    for (const ambiente of Object.keys(BASES_DE_AUDITORIA)) {
      const chamados = navGroupsAuditoria(ambiente as AmbienteDeAuditoria).find(
        (grupo) => grupo.titulo === "Chamados Ambev",
      )!;

      expect(chamados.itens.map((item) => item.href)).toEqual([
        "/monitoramento-de-chamados",
        "/conciliacao-de-chamados",
        "/justificativas",
        "/painel-de-justificativas",
      ]);
      expect(chamados.itens.map((item) => item.label)).toEqual([
        /*
          Os dois primeiros são curtos: a seção acima já diz "Chamados Ambev", e
          o rótulo longo era truncado na lateral ("Monitoramento de Chama…") —
          ver `nav-auditoria.ts`. Os hrefs continuam inteiros porque são a chave
          de permissão do módulo.
        */
        "Monitoramento",
        "Conciliação",
        "Justificativas",
        "Painel de Justificativas",
      ]);
    }

    expect(secoesDaAuditoria()).not.toContain("Justificativas");
  });

  it("mantém as onze seções do desenho, na ordem", () => {
    expect(secoesDaAuditoria()).toEqual([
      /*
        A Visão executiva abre a lista, e é a leitura executiva inteira: o que
        mudou desde a última competência e o retrato do conjunto, que era a
        seção ao lado até as duas virarem uma. Abre-se pelo retrato antes de
        descer ao trabalho da manhã — ver `nav-auditoria.ts`.
      */
      "Visão executiva",
      /*
        Chamados Ambev vem logo abaixo, porque é por onde o dia de trabalho
        começa: o que a fila da Ambev fez desde ontem, e a justificativa, placa
        a placa, de cada mudança.

        **Eram duas seções, e viraram uma.** "Justificativas" abria a lateral e
        os chamados vinham logo abaixo, num cartão de um item só; as três telas
        são o mesmo trabalho da manhã, e a divisão obrigava a alternar entre
        dois cartões vizinhos para percorrer um caminho só.
      */
      "Chamados Ambev",
      /*
        Compras vem antes das contas de custo porque é um portão antes de o
        dinheiro sair, e não uma descoberta sobre o que já saiu — ver o
        comentário da seção em `sidebar.tsx`.
      */
      "Compras",
      /*
        **Processos saiu da lateral.** Era uma seção de um item — Fluxos
        Operacionais —, e o item saiu com ela; as rotas continuam de pé em
        `App.tsx`, para quem tem o link, mas não há mais caminho de menu até
        elas.
      */
      /*
        **As duas telas de quadro do QLP são linhas de Custo Fixo**, e não
        seção: elas respondem à mesma pergunta das rubricas do ativo — o que se
        paga independente do quanto se rodou. Ver `nav-auditoria.ts`.
      */
      "Custo Fixo",
      /*
        **E o QLP volta a ser seção, por outra pergunta.** As duas linhas acima
        são por **quadro**: cada uma mostra a população inteira de uma altura do
        quadro de pessoal. Esta seção é por **assunto** — o que mudou no
        vale-transporte, no plano de saúde —, com as duas populações em abas
        dentro de cada módulo.

        Os itens dela saem do catálogo (`modulosDoQlp`), e não de uma lista
        escrita: é o que faz um módulo acender no quadro em que a coluna existe
        e dizer por que não existe no outro. A chave da seção é
        `modulos-do-qlp`, e não o `#qlp` de antes — aquela chave guarda a
        decisão de quem desligou **a outra** seção, e reaproveitá-la
        ressuscitaria em silêncio uma escolha feita sobre outra coisa.
      */
      "QLP",
      /*
        E o Custo Variável logo abaixo dele, porque é a outra metade da mesma
        conta: ali o que se paga por ter o ativo, aqui o que se paga por rodar
        com ele — ver `nav-auditoria.ts`.
      */
      "Custo Variável",
      /*
        A Auditoria vem depois das duas metades da conta: procura-se o desvio no
        que o Custo Fixo e o Custo Variável mudaram, e não antes de os ver — ver
        `nav-auditoria.ts`.
      */
      "Auditoria",
      "Frota",
      "Inteligência",
      "Dados & governança",
      "Administração",
    ]);

    /* As quatro auditorias têm as mesmas seções, na mesma ordem. */
    for (const ambiente of Object.keys(BASES_DE_AUDITORIA)) {
      expect(secoesDaAuditoria(ambiente as AmbienteDeAuditoria)).toEqual(
        secoesDaAuditoria(),
      );
    }
  });

  /*
    As quatro auditorias são o mesmo produto — o mesmo menu, item a item —, e a
    única diferença é a seção Frota, que mostra o ativo da operação. Este teste
    guarda as duas metades: tudo o que não é Frota é idêntico, e a Frota é a
    lista de `EQUIPAMENTOS_DO_AMBIENTE`.
  */
  it("dá às quatro auditorias o mesmo menu, menos a Frota", () => {
    const foraDaFrota = (ambiente: AmbienteDeAuditoria) =>
      navGroupsAuditoria(ambiente)
        .filter((grupo) => grupo.titulo !== "Frota")
        .flatMap((grupo) => grupo.itens.map((item) => item.href));

    for (const ambiente of Object.keys(BASES_DE_AUDITORIA)) {
      expect(foraDaFrota(ambiente as AmbienteDeAuditoria)).toEqual(foraDaFrota("auditoria"));
    }
  });

  it("põe, na Frota de cada auditoria, as telas 360° da operação dela", () => {
    const frotaDe = (ambiente: AmbienteDeAuditoria) =>
      navGroupsAuditoria(ambiente)
        .find((grupo) => grupo.titulo === "Frota")!
        .itens.map((item) => item.href);

    for (const ambiente of Object.keys(BASES_DE_AUDITORIA) as AmbienteDeAuditoria[]) {
      const doAmbiente = EQUIPAMENTOS_DO_AMBIENTE[ambiente].map(
        (equipamento) => TELA_DO_EQUIPAMENTO[equipamento].href,
      );
      const das360 = frotaDe(ambiente).filter((href) => href.endsWith("-360"));

      expect(das360).toEqual(doAmbiente);
    }

    /*
      Rota e AS trocam cavalo e carreta por caminhão e carroceria; o Apoio troca
      por empilhadeira e perde carreta e trecho — e com o trecho perde o Radar,
      que é a camada gerencial acima dele.
    */
    expect(frotaDe("auditoria-rota")).toContain("/caminhao-360");
    expect(frotaDe("auditoria-rota")).toContain("/carroceria-360");
    expect(frotaDe("auditoria-rota")).not.toContain("/cavalo-360");
    expect(frotaDe("auditoria-as")).toEqual(frotaDe("auditoria-rota"));
    expect(frotaDe("auditoria-apoio")).toContain("/empilhadeira-360");
    expect(frotaDe("auditoria-apoio")).not.toContain("/carreta-360");
    expect(frotaDe("auditoria-apoio")).not.toContain("/trecho-360");
    expect(frotaDe("auditoria-apoio")).not.toContain("/radar-trechos");
  });

  /*
    A lateral do Fechamento segue a ordem do processo — o fechamento que se
    abre, a apuração dele, a conferência do que a operação entregou, a decisão
    sobre o que foi apurado, o registro do que fechou.
    O teste guarda a ordem pela mesma razão do teste acima: ela é desenho, não
    acaso.

    Remuneração é a exceção que confirma a regra, e por isso está no meio e não
    no fim: ela não é um momento do processo, é a base contra a qual ele roda —
    o cadastro da unidade, que a apuração consome. Entre Fechamento e Apuração é
    onde ela é consultada, e é onde ela fica.
  */
  it("mantém as seis seções do Fechamento, na ordem do processo, e a casa no fim", () => {
    /*
      A primeira seção leva o nome do ambiente: é ali que o menu diz em qual dos
      dois fechamentos se está, já que as outras quatro são idênticas nos dois.
    */
    expect(navGroupsFechamento(BASE, "Fechamento Rota").map((g) => g.titulo)).toEqual([
      "Fechamento Rota",
      "Remuneração",
      "Apuração",
      /*
        Frota vem depois de Apuração e não dentro dela: as duas telas são
        conferência operacional — quantos veículos existem, quantos rodaram — e
        nenhuma entra em cálculo de remuneração. Enquanto a conferência de
        frota era um item solto na seção da conta, o menu dizia o contrário.
      */
      "Frota",
      "Decisão",
      "Registro",
      /*
        A sexta não é do processo: é a casa, a mesma seção que fecha a lateral
        da Auditoria. Ela fica no fim porque é onde ela está lá — quem aprendeu
        que Administração é a última linha continua achando na última linha,
        troque de ambiente quantas vezes trocar.
      */
      "Administração",
    ]);
  });

  /*
    Todo item do processo vive sob a base do ambiente — é o prefixo que o define
    (`lib/ambiente.ts`). Um item fora dela mudaria de ambiente ao ser clicado, e
    a lateral trocaria embaixo do clique.

    A Administração é a única exceção, e é exceção por desenho: as telas dela
    não têm versão por ambiente (`nav-administracao.ts`), então os endereços são
    absolutos e sair do fechamento ao abrir uma delas é o comportamento
    pretendido. O teste confere as duas metades da regra — nenhuma seção do
    processo escapa da base, e a única que escapa é a casa.
  */
  it("não põe, nas seções do processo, nenhum endereço fora da base", () => {
    const grupos = navGroupsFechamento(BASE, "Fechamento Rota");
    const doProcesso = grupos.filter((g) => g.titulo !== GRUPO_ADMINISTRACAO.titulo);
    const fora = doProcesso
      .flatMap((g) => g.itens.map((item) => item.href))
      .filter((href) => href !== BASE && !href.startsWith(`${BASE}/`));

    expect(fora).toEqual([]);
    expect(doProcesso).toHaveLength(grupos.length - 1);
  });

  /*
    A casa é a mesma em todos os ambientes: os mesmos itens, na mesma ordem, com
    os mesmos endereços. Era isso que faltava enquanto ela vivia só na lista da
    Auditoria — trocar para um fechamento escondia o cadastro de que o
    fechamento depende.
  */
  it("põe a mesma Administração em todos os ambientes", () => {
    const daAuditoria = GRUPO_ADMINISTRACAO.itens.map((item) => item.href);

    for (const base of Object.values(BASES_DE_FECHAMENTO)) {
      const casa = navGroupsFechamento(base, "Fechamento").find(
        (g) => g.titulo === GRUPO_ADMINISTRACAO.titulo,
      );

      expect(casa?.itens.map((item) => item.href)).toEqual(daAuditoria);
    }

    /* E os itens dela continuam sendo os que a lista da Auditoria oferece. */
    expect(daAuditoria.map(semTil).filter((href) => !hrefsDoMenu().includes(href))).toEqual([]);
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
      g.itens.map((item) => semTil(item.href)),
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
    `pages/qlp-administrativo.tsx`. As três da antiga Recuperação —
    `/contestacao`, `/reconciliacao` e `/risco-materialidade` — saíram por outra
    razão, e é a única baixa deste número que não é uma tela entregue: os itens
    delas saíram do menu (`nav-auditoria.ts`), e uma tela em preparo sem item
    que a alcance é catálogo que ninguém lê. `/ajustes` — os ajustes da
    instalação — saiu pela mesma razão: o item de Configurações que a alcançava
    deixou o menu da Administração, e o nome passou a designar a tela que existe
    (`/configuracoes`, hoje um índice de seções). As rotas passaram a ser `<Route>` de
    verdade em `App.tsx`, e o teste acima, o dos órfãos, garante que nenhum item do
    menu ficou apontando para o vazio na troca. Baixá-lo aqui é o último passo
    de entregar uma tela; subi-lo sem acrescentar `pergunta` e `depende` é o que
    este caso recusa.

    E subiu de doze para vinte quando nasceram as duas seções da conta do ativo,
    com quatro módulos cada uma: **Custo Fixo** — Finame, Juros Finame, IPVA e
    Lucro Fixo — e **Custo Variável** — Km Rodado, Velocidade Média, TMA e
    Salário Variável. Os oito estão no menu com o nome, e nenhum deles tem
    número para mostrar: no fixo, cada rubrica precisa estar separada na base e
    ligada ao ativo e à vigência; no variável, falta antes disso o realizado da
    operação. É exatamente a subida que este caso aceita — com `pergunta`,
    `depende` e `hoje` em cada uma —, e não a que ele recusa.

    Ele já tinha subido uma vez, de doze para dezesseis, e por um motivo que o
    caso aceita: Configurações virou índice, e as quatro seções da casa que o banco
    ainda não sustentava — Minha Empresa, Cargos, Negócio e Departamento —
    entraram no catálogo com `pergunta`, `depende` e `hoje`, em vez de virarem
    quatro formulários que não gravam. É a diferença que o catálogo existe para
    manter: anunciar o que vem, sem fingir que já veio.

    E caiu de novo, de dezesseis para treze, quando três daquelas quatro
    ficaram prontas: o cadastro da casa nasceu — `cargo`, `negocio` e
    `departamento` no banco, com identidade canônica por nome —, e Cargos,
    Negócio e Departamento passaram a ser `<Route>` de verdade em `App.tsx`,
    com formulário que grava. É a baixa que este número existe para medir; o
    que cada uma **ainda** não faz — faixa salarial vigente, negócio como base
    de fechamento, rateio por departamento — está escrito na própria tela, que
    é onde a ressalva serve para alguma coisa. Minha Empresa é a que fica.

    E caiu para doze quando **Integrações** ficou pronta. O verbete pedia
    "credencial guardada e resultado da última execução", e é o que a tela
    mostra hoje: chave por sistema, escopo por chave e o registro de cada
    chamada que a porta de API atendeu (`pages/integracoes.tsx`, sobre
    `/api/v1`). Ela também trocou de seção no caminho — saiu da Administração e
    foi para Dados & governança, ao lado de Importações, porque o que ela
    governa é o material e não a casa.

    O que aquele verbete pedia e continua não existindo é a busca ativa — nós
    chamando o fornecedor numa agenda. Isso não voltou ao catálogo: não é uma
    tela que falta, é uma capacidade, e ela está descrita em
    `docs/INTEGRACOES.md` em vez de virar item de menu que promete o que não faz.

    E caiu de vinte para dezenove quando **Finame** ficou pronta — a baixa mais
    instrutiva das que este número já mediu, porque o verbete não foi atendido:
    o contrato por trás da parcela continua não existindo no acervo, e por isso
    a tela não diz quanto ainda se deve. O que mudou foi a pergunta. "Quanto do
    principal esta vigência carrega" precisa do contrato; "o que mudou no
    financiamento deste veículo entre duas vigências" precisa de duas planilhas
    e do motor de comparação, e as duas coisas já estavam aqui. A tela nasceu da
    segunda pergunta, e escreve na própria cara o que a primeira ainda espera.

    E subiu de dezenove para vinte e um com **Impostos**, no Custo Fixo, e
    **Lucro Variável**, no Custo Variável. Os dois entram como o catálogo manda:
    com o nome no menu e o verbete aqui dizendo o que falta. No de Impostos o
    que falta é a alíquota medida, e não a declarada — o export traz as duas e
    elas discordam; no de Lucro Variável é o realizado da operação, porque a
    base traz a previsão, e previsão apresentada como resultado é exatamente o
    número que este produto não mostra.

    E caiu de vinte e um para vinte quando **Juros Finame** saiu do menu. Não é
    tela entregue, é módulo que não se sustentava: o juro do financiamento é
    coluna dentro da Auditoria de FINAME — que já compara juros, amortização e
    taxa parcela a parcela —, e não rubrica ao lado dela. Saiu o item
    (`nav-auditoria.ts`) e saiu o verbete, pela mesma regra das três da antiga
    Recuperação: tela em preparo sem item que a alcance é catálogo que ninguém
    lê.

    E de vinte para dezenove quando **IPVA** ficou pronta — esta por entrega, e
    não por baixa de menu, pelo caminho que o Finame abriu e com a mesma
    ressalva: o verbete pedia a conferência contra ano, categoria e UF do
    emplacamento, e categoria e UF continuam não existindo no acervo. A tela não
    passou a afirmar nada sobre elas. O que mudou é que o acervo já sustentava a
    outra metade — o IPVA sobre o valor de nota é uma alíquota, e é ela que
    distingue um IPVA alto de um IPVA errado. O que falta continua dito na
    própria tela, e não aqui.

    E de dezenove para dezoito com **Lucro Fixo**, a terceira rubrica a sair por
    entrega. O padrão das três é o mesmo, e já dá para nomeá-lo: o verbete pedia
    a régua que confere o valor — o contrato do financiamento, a UF do
    emplacamento, o percentual contratado —, e nenhuma das três chegou. O que
    chegou foi a pergunta comparativa, que o acervo sempre sustentou, mais uma
    leitura própria de cada rubrica que o dado real ofereceu de graça: a
    alíquota implícita no IPVA, a virada de ciclo aqui. Nenhuma das três afirma
    o que ainda não sabe, e as três dizem na própria tela o que falta.

    E de dezoito para dezessete com **Impostos**, a quarta. Ela é a primeira que
    atende metade do verbete e **recusa a outra metade por escrito**: entrega a
    alíquota medida — o tributo sobre o valor de nota, dinheiro sobre dinheiro —
    conferida contra a declarada, e diz que o imposto do frete não está aqui,
    porque mora na tabela de trecho, que não é a fonte que este banco apura.
    Somá-lo ao imposto da compra do ativo daria o total de duas grandezas
    diferentes, que é o que o próprio verbete pedia para evitar. E trouxe o
    achado que o verbete não previa: o montante de ICMS é zero nas 1.215 linhas
    do acervo, com as alíquotas declaradas em todas elas — coluna sem dado, e não
    imposto zero.

    E de dezessete para dezesseis com **Km Rodado**, a quinta — e a primeira de
    **custo variável**, que é o que a torna diferente das quatro anteriores: o
    grão deixa de ser a placa e passa a ser o trecho, porque custo variável é
    provocado por rodar e o que roda é um percurso. A metade que falta é a mesma
    que o verbete anunciava, e ela não encolheu: a quilometragem **realizada** por
    quinzena continua não existindo, e a tela recusa multiplicar R$/km por uma
    distância que ninguém importou. O que o acervo já sustentava são duas contas
    do próprio dicionário da tabela de frete que ninguém tinha conferido — ida +
    volta contra o km do ciclo, e R$/viagem ÷ R$/km contra esse mesmo km.

    E de dezesseis para quinze com **Velocidade Média**, a sexta — e a primeira
    em que o verbete foi atendido quase por inteiro. Ele pedia distância e tempo
    na mesma linha e a separação entre tempo rodando e tempo parado; a tabela de
    frete declara o ciclo como deslocamento mais TMA de origem, TMA de destino e
    refeição, e subtrair as paradas devolve exatamente essa separação. O que
    continua faltando é outra coisa do que o verbete imaginava: o tempo e a
    distância aqui são os **contratados**, e não os que um motorista praticou na
    quinzena.

    E de quinze para catorze com **QLP Operacional**, a sétima — e a única que
    saiu **sem o arquivo**. O verbete pedia as linhas de QLP dentro da
    importação, e elas continuam não chegando; a tela abre dizendo isso, em vez
    de mostrar um quadro vazio que pareceria uma operação sem gente. O que mudou
    é que o grão, as colunas e as **contas** estão declarados no dicionário da
    tabela de equipe — nove colunas são subtotais das outras, e a cadeia que as
    liga está lá como proposta, não medida. A tela que confere essa cadeia é o
    instrumento que a confirma no dia em que o export entrar, e a mesma
    auditoria virou aba no QLP Administrativo, onde o arquivo já existe.

    E de catorze para treze com **TMA**, a oitava — e a primeira que sai com
    **metade** do verbete atendida, dito assim. A regra do que conta como
    atendimento existe, e são duas: carregar e descarregar têm definições
    diferentes no dicionário, e a tela nunca junta as duas médias. O registro de
    cada atendimento com começo e fim continua faltando, e por isso o que está na
    tela é o TMA **parametrizado** — o tempo que o contrato reconhece, não o que
    o caminhão esperou. Que é, ainda assim, o número que remunera.
  */
  it("descreve, para cada tela, o que falta antes de ela mostrar um número", () => {
    const catalogo = fonte("pages/telas-em-preparo.ts");
    const telas = [...catalogo.matchAll(/^\s{4}href:\s*"([^"]+)"/gm)].length;

    expect(telas).toBe(13);
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
