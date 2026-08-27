import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Link, Route, Router, Switch } from "wouter";

import { BASES_DE_AUDITORIA, type Ambiente } from "../ambiente";
import { useAmbiente, useLocalizacaoDoAmbiente } from "../ambiente-aberto";

/**
 * O mecanismo em que as quatro auditorias se apoiam, testado sem navegador.
 *
 * As telas da Auditoria escrevem os endereços delas **sem base** — `/alteracoes`
 * é `/alteracoes` nas quatro —, e quem põe `/auditoria-rota` na frente é o
 * roteador aninhado que `App.tsx` monta sobre cada base. Toda a garantia de que
 * um clique não troca de ambiente está aí, e ela é do wouter: se a semântica de
 * `<Route nest>`, do `~` ou da localização relativa mudar, o produto passa a
 * devolver para a Empurrada quem clicou dentro do Rota — sem erro na tela, que é
 * o pior jeito de essa regressão aparecer.
 *
 * Daí este teste renderizar o roteador de verdade, e não simular strings.
 * `renderToStaticMarkup` roda em Node sem DOM, que é o que esta suíte tem (ver
 * `vitest.config.ts`), e `ssrPath` é como o wouter recebe o endereço fora do
 * navegador.
 */

/** A casca mínima com a forma de `App.tsx`: uma rota aninhada por base. */
function Casca({ endereco }: { endereco: string }) {
  return (
    <Router ssrPath={endereco}>
      <Switch>
        {Object.values(BASES_DE_AUDITORIA)
          .filter((base) => base !== "")
          .map((base) => (
            <Route key={base} path={base} nest>
              <Telas />
            </Route>
          ))}
        <Route>
          <Telas />
        </Route>
      </Switch>
    </Router>
  );
}

function Telas() {
  return (
    <Switch>
      <Route path="/alteracoes">
        <Sonda tela="alteracoes" />
      </Route>
      <Route path="/">
        <Sonda tela="raiz" />
      </Route>
      <Route>
        <Sonda tela="nao-encontrada" />
      </Route>
    </Switch>
  );
}

/**
 * O que se observa: em que tela se caiu, qual ambiente a casca lê, e para onde
 * os dois tipos de link resolvem — o de dentro do ambiente e o da casa.
 */
function Sonda({ tela }: { tela: string }) {
  return (
    <div data-tela={tela} data-ambiente={useAmbiente()} data-local={useLocalizacaoDoAmbiente()}>
      <Link href="/alteracoes">dentro</Link>
      <Link href="~/unidades">a casa</Link>
    </div>
  );
}

const ler = (endereco: string) => {
  const html = renderToStaticMarkup(<Casca endereco={endereco} />);
  const atributo = (nome: string) => new RegExp(`data-${nome}="([^"]*)"`).exec(html)?.[1];
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

  return {
    tela: atributo("tela"),
    ambiente: atributo("ambiente") as Ambiente,
    local: atributo("local"),
    dentro: hrefs[0],
    casa: hrefs[1],
  };
};

describe("a auditoria aberta", () => {
  it("abre a mesma tela nas quatro, cada uma sob a base dela", () => {
    expect(ler("/alteracoes").tela).toBe("alteracoes");
    expect(ler("/auditoria-rota/alteracoes").tela).toBe("alteracoes");
    expect(ler("/auditoria-as/alteracoes").tela).toBe("alteracoes");
    expect(ler("/auditoria-apoio/alteracoes").tela).toBe("alteracoes");
  });

  /*
    A base é a porta do ambiente: `/auditoria-rota` sozinho é a raiz dele, e a
    raiz encaminha para a Visão Gerencial (`destinoDaRaiz`, em `lib/ambiente.ts`).
  */
  it("trata a base sozinha como a raiz do ambiente", () => {
    expect(ler("/").tela).toBe("raiz");
    expect(ler("/auditoria-rota").tela).toBe("raiz");
  });

  /*
    O ambiente lido pela casca — é ele que escolhe o menu e o nome no topo. Sem
    `useLocalizacaoDoAmbiente`, a leitura crua da localização diria "Empurrada"
    nas quatro, porque dentro do roteador aninhado ela chega sem a base.
  */
  it("diz de qual auditoria é a tela aberta", () => {
    expect(ler("/alteracoes").ambiente).toBe("auditoria");
    expect(ler("/auditoria-rota/alteracoes").ambiente).toBe("auditoria-rota");
    expect(ler("/auditoria-as/alteracoes").ambiente).toBe("auditoria-as");
    expect(ler("/auditoria-apoio/alteracoes").ambiente).toBe("auditoria-apoio");

    expect(ler("/auditoria-rota/alteracoes").local).toBe("/auditoria-rota/alteracoes");
    expect(ler("/auditoria-apoio").local).toBe("/auditoria-apoio");
  });

  /*
    **A garantia inteira, em duas linhas.** O mesmo `href` escrito na tela leva
    ao endereço do ambiente em que ela está — e é por isso que a lateral da
    Auditoria é uma lista só (`components/layout/nav-auditoria.ts`).
  */
  it("resolve o endereço da tela dentro do ambiente aberto", () => {
    expect(ler("/alteracoes").dentro).toBe("/alteracoes");
    expect(ler("/auditoria-rota/alteracoes").dentro).toBe("/auditoria-rota/alteracoes");
    expect(ler("/auditoria-apoio/alteracoes").dentro).toBe("/auditoria-apoio/alteracoes");
  });

  /*
    E a casa continua sendo uma só: o `~` diz que o endereço é absoluto, e é o
    que faz "Unidades" abrir a mesma tela venha-se de onde vier
    (`nav-administracao.ts`).
  */
  it("deixa a Administração fora das bases, em todos os ambientes", () => {
    expect(ler("/alteracoes").casa).toBe("/unidades");
    expect(ler("/auditoria-rota/alteracoes").casa).toBe("/unidades");
    expect(ler("/auditoria-apoio/alteracoes").casa).toBe("/unidades");
  });
});
