import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BarraMobile } from "./barra-mobile";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { useMenuAberto } from "./preferencias";
import { FaixaDeVisualizacao } from "./visualizacao-como";
import {
  SemAcesso,
  TiraDeSomenteLeitura,
  useAcessoDoModulo,
} from "./acesso-do-modulo";

/**
 * A casca do Freightech: faixa vermelha em cima, lateral recolhível à esquerda,
 * conteúdo sobre fundo cinza.
 *
 * O hambúrguer da faixa encolhe a lateral para a faixa de ícones — em tela de 13
 * polegadas com uma tabela de 12 colunas, esses 225px são a diferença entre ler
 * e rolar. Ele **não** a faz sumir: com a lateral fora, ir para a próxima tela
 * custava trazê-la de volta, clicar e recolher outra vez.
 *
 * A escolha vive no `localStorage` e não aqui, e a razão é esta casca: cada
 * página monta a sua própria `Layout`, então este componente é remontado a cada
 * navegação. Em `useState` puro, a lateral recolhida voltaria inteira no
 * primeiro item clicado — e o botão pareceria não funcionar.
 *
 * **No celular a casca é outra, e a troca é de CSS.** Abaixo de `md` a lateral
 * não existe (`hidden md:flex`, em `sidebar.tsx`) e quem navega é a barra da
 * borda de baixo, com a folha "Mais" (`barra-mobile.tsx`) — ver lá por que a
 * lateral não serve num telefone. Os dois menus são montados sempre, e é a
 * media query que decide qual aparece: decidir em JavaScript, com
 * `useIsMobile`, custaria um primeiro quadro sem menu nenhum a cada montagem
 * da casca — e a casca remonta a cada navegação.
 *
 * **Ninguém aqui embaixo conta quantos rems existem acima.** O cabeçalho da
 * casca — a faixa do topo mais a da visualização, quando ela existe — se mede
 * sozinho e publica a própria altura em `--casca-topo`; ver `MEDIDA_DO_TOPO`.
 */
export function Layout({
  children,
  alturaDeJanela,
}: {
  children: ReactNode;
  /**
   * A tela mede uma janela e rola por dentro, em vez de crescer e rolar a
   * página. Hoje pedem isto o fluxo e o assistente.
   *
   * Quem pede não faz conta nenhuma: a casca passa a medir a janela, o
   * cabeçalho e a barra do celular saem da conta aqui, e o conteúdo recebe o
   * que sobrou. Enquanto a conta era da página — `100dvh` menos `4rem`
   * chutados de cabeçalho —, bastava a faixa "visualizando como" aparecer para
   * a tela ficar mais alta que a janela: a página inteira ganhava rolagem, e o
   * fim do conteúdo caía abaixo da dobra.
   *
   * Também desliga o espaço reservado para a barra do celular, porque a barra
   * já está descontada da altura da casca. Com a reserva ligada, o desconto
   * acontecia duas vezes: sobrava uma faixa cinza vazia acima da barra, e o
   * último cartão ficava cortado ao meio para pagá-la.
   */
  alturaDeJanela?: boolean;
}) {
  const { aberto, alternar } = useMenuAberto();
  const casca = useRef<HTMLDivElement>(null);
  const topo = useRef<HTMLDivElement>(null);
  /*
    O acesso ao módulo é decidido na casca, e não em cada tela.

    São quarenta e poucas telas; pedir a cada uma que se pergunte se pode ser
    aberta é pedir que uma esqueça. Aqui é um lugar só, e ele já sabe qual é o
    endereço aberto — ver `acesso-do-modulo.tsx`.

    A pergunta cobre os dois eixos: o módulo e o ambiente de trabalho de onde a
    tela foi aberta. Uma tela fora de módulo nenhum — que antes escapava por
    `modulo === null` — continua livre quando o ambiente também está livre, e
    passa a ser recusada quando o ambiente inteiro é de outra pessoa: um
    endereço solto dentro do Fechamento AS não é menos Fechamento AS por não
    estar no menu.
  */
  const acesso = useAcessoDoModulo();

  /*
    MEDIDA DO TOPO — a única fonte de "quanto tem acima".

    O cabeçalho da casca não tem altura fixa: são `4rem` quando é só a faixa do
    topo, e mais a faixa da visualização quando alguém está vendo o produto por
    outra conta — que ainda quebra em duas linhas em tela estreita. Tudo o que
    precisa saber essa altura (a lateral, que gruda logo abaixo dela e mede a
    janela menos ela) lia `4rem` escritos à mão, e ficava errado exatamente nos
    casos em que o cabeçalho não media `4rem`.

    Então quem sabe a altura passou a ser quem a tem. O `ResizeObserver` cobre
    as duas mudanças que existem: a faixa aparecendo ou saindo, e ela mudando de
    uma linha para duas quando a janela estreita.

    `useLayoutEffect` e não `useEffect`: a medida entra antes da pintura, senão
    o primeiro quadro de cada navegação sai com a lateral no lugar errado.
  */
  useLayoutEffect(() => {
    const cabecalho = topo.current;
    const raiz = casca.current;
    if (!cabecalho || !raiz) return;

    const medir = () =>
      raiz.style.setProperty("--casca-topo", `${cabecalho.offsetHeight}px`);

    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(cabecalho);
    return () => observador.disconnect();
  }, []);

  return (
    /*
      Sem `min-h-[100dvh]` aqui e sem `flex-1` na faixa do conteúdo: página
      longa já cresce sozinha, sem precisar de altura mínima nenhuma — era só a
      curta (poucas linhas, sem gráfico) que sobrava esticada até o fim da
      viewport, trocando conteúdo por fundo cinza vazio embaixo do último
      cartão. O `body` já tem o mesmo `bg-background` (`index.css`), então
      terminar a casca no fim do conteúdo não deixa costura de cor.

      Quem pede `alturaDeJanela` é o contrário disto, e por isso é opt-in: a
      casca passa a medir exatamente uma janela — menos a barra do celular, que
      é `fixed` e cobriria o fim do conteúdo — e nada dentro dela rola a página.
    */
    <div
      ref={casca}
      style={{ "--casca-topo": "4rem" } as CSSProperties}
      className={cn(
        "flex flex-col bg-background",
        alturaDeJanela &&
          "h-[calc(100dvh-5.5rem-env(safe-area-inset-bottom))] md:h-[100dvh]",
      )}
    >
      {/*
        O cabeçalho da casca é um bloco só, e gruda como um só.

        As duas faixas eram `sticky` separadas, a de baixo pendurada num
        `top-16` que repetia a altura da de cima. Juntas num bloco, a de baixo
        não precisa saber a altura da de cima, e o bloco inteiro é o que a
        `--casca-topo` mede.

        A faixa da visualização vem depois da do topo e antes de todo o resto, e
        é de propósito: ela muda o significado de cada número da tela — quem
        está vendo não é quem está logado. Ver `visualizacao-como.tsx`.
      */}
      <div ref={topo} className="sticky top-0 z-40 shrink-0">
        <Topbar menuAberto={aberto} onToggleSidebar={alternar} />
        <FaixaDeVisualizacao />
      </div>
      <div className={cn("flex min-h-0", alturaDeJanela && "flex-1")}>
        <Sidebar open={aberto} />
        {/*
          O espaço reservado embaixo é a altura da barra do celular, que é
          `fixed`: sem ele, a última linha de toda tela nasce por baixo dela — e
          a última linha de uma tabela é onde costuma estar o total.

          São 5,5rem, e não os 4rem da barra: o botão redondo do meio sobe 1,5rem
          acima dela, e era exatamente essa faixa que ficava por cima do texto da
          última linha.
        */}
        <main
          className={cn(
            "flex-1 flex flex-col min-w-0 md:pb-0",
            alturaDeJanela
              ? "min-h-0"
              : "pb-[calc(5.5rem+env(safe-area-inset-bottom))]",
          )}
        >
          {acesso.nivel === "VISUALIZAR" && (
            <TiraDeSomenteLeitura acesso={acesso} />
          )}
          {acesso.nivel === "SEM_ACESSO" ? (
            <SemAcesso acesso={acesso} />
          ) : (
            children
          )}
        </main>
      </div>
      <BarraMobile />
    </div>
  );
}
