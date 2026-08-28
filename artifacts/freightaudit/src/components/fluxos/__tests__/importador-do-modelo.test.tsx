import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  BotaoDeImportarModelo,
  DialogoDaImportacao,
  useImportadorDoModelo,
  type Importador,
} from "@/components/fluxos/importador-do-modelo";
import type { FluxoCompleto } from "@/lib/fluxos";

/**
 * ONDE O DIÁLOGO DA IMPORTAÇÃO MORA — e por que isso é afirmado em teste.
 *
 * O gatilho de "Importar modelo" aparece em dois lugares da barra do fluxo, e
 * cada um deles vive dentro de um contêiner que existe só numa faixa de largura
 * (`hidden md:flex` na barra larga, `md:hidden` em "Mais ações"). Enquanto o
 * diálogo era montado **dentro** do gatilho, ele herdava essa condição: quem
 * estivesse revisando a prévia e estreitasse a janela via a prévia sumir — o
 * contêiner virava `display:none`, o componente seguia montado e aberto, e a
 * trava de rolagem que todo modal aplica no `body` continuava lá. Sobrava uma
 * tela sem prévia, sem rolagem e sem explicação.
 *
 * A correção foi estrutural: o estado vem de `useImportadorDoModelo`, chamado
 * uma vez pela página, e o diálogo é montado uma vez, no nível dela. O que este
 * arquivo guarda é exatamente isso — **o gatilho não monta diálogo nenhum**. É
 * uma afirmação de estrutura, e é a única forma de a regressão aparecer aqui em
 * vez de aparecer para quem estiver arrastando a borda da janela.
 */

const FLUXO = {
  fluxo: {
    id: "f1",
    empresaId: "e1",
    nome: "Operação Empurrada",
    slug: "operacao-empurrada",
    descricao: null,
    objetivo: null,
    categoria: "Faturamento",
    status: "RASCUNHO",
    versao: 1,
    dono: null,
    criadoEm: "",
    atualizadoEm: "",
    criadoPor: null,
    atualizadoPor: null,
  },
  etapas: [],
  conexoes: [],
} as unknown as FluxoCompleto;

/** Monta o que o teste pedir, com o importador que a página criaria. */
function comImportador(desenhar: (importador: Importador) => React.ReactNode): string {
  function Tela() {
    const importador = useImportadorDoModelo({
      completo: FLUXO,
      catalogo: undefined,
      empresaId: "e1",
      aoConcluir: () => {},
    });
    return <>{desenhar(importador)}</>;
  }
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Tela />
    </QueryClientProvider>,
  );
}

describe("o gatilho de importar", () => {
  it("é só o botão — não monta o diálogo nem o campo de arquivo", () => {
    const html = comImportador((importador) => (
      <BotaoDeImportarModelo importador={importador} />
    ));

    expect(html).toContain("Importar modelo");
    /*
      Se um `input[type=file]` voltar a sair daqui, o diálogo voltou para dentro
      do contêiner responsivo junto com ele — que é a regressão inteira.
    */
    expect(html).not.toContain('type="file"');
  });

  it("respeita o modo de leitura", () => {
    const html = comImportador((importador) => (
      <BotaoDeImportarModelo importador={importador} desabilitado />
    ));

    expect(html).toContain("disabled");
  });
});

describe("o diálogo da importação", () => {
  it("é quem monta o campo de arquivo, uma vez, no nível da página", () => {
    const html = comImportador((importador) => <DialogoDaImportacao importador={importador} />);

    expect(html.match(/type="file"/g)).toHaveLength(1);
    /* Sem arquivo escolhido não há prévia nem erro na tela. */
    expect(html).not.toContain("Importar o modelo preenchido");
    expect(html).not.toContain("Não deu para ler a planilha");
  });

  it("aceita só planilha no campo de arquivo", () => {
    const html = comImportador((importador) => <DialogoDaImportacao importador={importador} />);

    expect(html).toContain(".xlsx");
  });

  it("a página monta um gatilho e um diálogo, e um campo de arquivo só", () => {
    /* O arranjo da barra: o botão numa faixa, o diálogo fora dela. */
    const html = comImportador((importador) => (
      <>
        <div className="hidden md:flex">
          <BotaoDeImportarModelo importador={importador} />
        </div>
        <DialogoDaImportacao importador={importador} />
      </>
    ));

    expect(html.match(/type="file"/g)).toHaveLength(1);
    /* E o campo de arquivo está fora do contêiner que some por largura. */
    const dentroDaFaixa = html.slice(
      html.indexOf('class="hidden md:flex"'),
      html.indexOf("</div>", html.indexOf('class="hidden md:flex"')),
    );
    expect(dentroDaFaixa).not.toContain('type="file"');
  });
});
