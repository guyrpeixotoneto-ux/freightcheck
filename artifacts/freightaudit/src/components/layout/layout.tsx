import { ReactNode, useState } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

/**
 * A casca do Freightech: faixa vermelha em cima, lateral branca recolhível à
 * esquerda, conteúdo sobre fundo cinza.
 *
 * O hambúrguer da faixa recolhe a lateral, como lá — em tela de 13 polegadas
 * com uma tabela de 12 colunas, esses 288px são a diferença entre ler e rolar.
 */
export function Layout({ children }: { children: ReactNode }) {
  const [menuAberto, setMenuAberto] = useState(true);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <Topbar onToggleSidebar={() => setMenuAberto((aberto) => !aberto)} />
      <div className="flex flex-1 min-h-0">
        <Sidebar open={menuAberto} />
        <main className="flex-1 flex flex-col min-w-0">{children}</main>
      </div>
    </div>
  );
}
