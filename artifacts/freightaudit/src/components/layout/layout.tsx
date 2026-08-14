import { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { useMenuAberto } from "./preferencias";

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
 */
export function Layout({ children }: { children: ReactNode }) {
  const { aberto, alternar } = useMenuAberto();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <Topbar menuAberto={aberto} onToggleSidebar={alternar} />
      <div className="flex flex-1 min-h-0">
        <Sidebar open={aberto} />
        <main className="flex-1 flex flex-col min-w-0">{children}</main>
      </div>
    </div>
  );
}
