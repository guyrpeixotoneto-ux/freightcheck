import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BarraMobile } from "./barra-mobile";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { useMenuAberto } from "./preferencias";
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
 */
export function Layout({
  children,
  semReservaDaBarra,
}: {
  children: ReactNode;
  /**
   * Desliga o espaço reservado para a barra do celular.
   *
   * Serve para a página que já tem altura própria de janela e rola por dentro
   * — o fluxo é a única hoje. Nela a reserva não empurrava nada para cima:
   * ficava como uma faixa cinza vazia entre o fim da área que rola e a barra,
   * cortando o último cartão em troca de espaço em branco. Quem pedir isto
   * assume a conta: precisa descontar a barra da própria altura.
   */
  semReservaDaBarra?: boolean;
}) {
  const { aberto, alternar } = useMenuAberto();
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

  return (
    <div className="flex flex-col bg-background">
      <Topbar menuAberto={aberto} onToggleSidebar={alternar} />
      {/*
        Sem `min-h-[100dvh]` no contêiner de fora nem `flex-1` nesta faixa:
        página longa já cresce sozinha, sem precisar de altura mínima nenhuma —
        era só a curta (poucas linhas, sem gráfico) que sobrava esticada até o
        fim da viewport, trocando conteúdo por fundo cinza vazio embaixo do
        último cartão. O `body` já tem o mesmo `bg-background` (`index.css`),
        então terminar a casca no fim do conteúdo não deixa costura de cor.
      */}
      <div className="flex min-h-0">
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
            !semReservaDaBarra && "pb-[calc(5.5rem+env(safe-area-inset-bottom))]",
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
