import { Link } from "wouter";
import { ChevronDown, Menu } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";

/**
 * A faixa vermelha do Freightech.
 *
 * É o primeiro elemento que o usuário reconhece, e por isso é o primeiro que
 * este produto passou a ter: o mesmo lugar para o menu, a mesma marca à
 * esquerda, o mesmo e-mail com a seta.
 *
 * **Os três indicadores saíram daqui.** A nuvem contava importações em
 * andamento, o sino contava atributos monetários sem semântica confirmada, e o
 * filtro levava à seleção de contexto — os três agora estão no menu, ao lado do
 * item que resolve cada um, e a unidade aberta está escrita no topo dele. O
 * mesmo número em dois lugares da mesma tela não é reforço: é a pergunta "estes
 * seis são os mesmos seis?" toda vez que os dois entram no campo de visão, e uma
 * defasagem de cache entre eles bastaria para a resposta ser não.
 *
 * O que fica aqui é o que não tem lugar melhor: a marca, o botão que recolhe a
 * lateral e quem está logado.
 */
export function Topbar({
  menuAberto,
  onToggleSidebar,
}: {
  menuAberto: boolean;
  onToggleSidebar: () => void;
}) {
  const { user, logout, isSubmitting } = useAuth();

  return (
    <header className="h-16 bg-brand-red text-brand-red-foreground flex items-center gap-4 px-4 shrink-0 sticky top-0 z-40">
      <button
        type="button"
        onClick={onToggleSidebar}
        /*
          O rótulo diz o que o clique faz, e não o que o botão é. "Abrir ou
          fechar o menu" obriga quem ouve a descobrir em qual dos dois estados
          está antes de decidir se quer clicar.
        */
        aria-label={menuAberto ? "Recolher o menu" : "Expandir o menu"}
        aria-expanded={menuAberto}
        className="p-2 -ml-1 rounded hover:bg-white/10 transition-colors"
      >
        <Menu className="w-6 h-6" />
      </button>

      <Link href="/" className="flex items-center gap-2 shrink-0">
        <Logotipo />
      </Link>

      <div className="flex-1" />

      {user && (
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1.5 text-[0.8125rem] font-semibold uppercase tracking-wide px-2 py-2 rounded hover:bg-white/10 transition-colors max-w-[22rem]">
            <span className="truncate">{user.email}</span>
            <ChevronDown className="w-4 h-4 shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="font-normal">
              <div className="font-semibold">{user.name}</div>
              <div className="text-xs text-muted-foreground truncate">{user.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/configuracoes">Configurações</Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={isSubmitting}
              onSelect={() => {
                void logout();
              }}
            >
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </header>
  );
}

/**
 * A marca, no mesmo desenho do Freightech: um símbolo quadrado à esquerda e o
 * nome em duas espessuras. O nome é o nosso — a casca é que é familiar, e um
 * produto que se apresenta com o nome de outro não é um espelho, é uma cópia.
 */
function Logotipo() {
  return (
    <>
      <span className="w-9 h-9 rounded-sm bg-white text-brand-red flex items-center justify-center font-extrabold text-xl italic shrink-0">
        F
      </span>
      <span className="text-2xl leading-none tracking-tight">
        <span className="font-extrabold italic">Freight</span>
        <span className="font-light">check</span>
      </span>
    </>
  );
}
