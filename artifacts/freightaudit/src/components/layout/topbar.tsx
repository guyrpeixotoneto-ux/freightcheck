import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Bell, ChevronDown, CloudDownload, Menu, SlidersHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getApiUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/**
 * A faixa vermelha do Freightech.
 *
 * É o primeiro elemento que o usuário reconhece, e por isso é o primeiro que
 * este produto passou a ter: o mesmo lugar para o menu, a mesma marca à
 * esquerda, os mesmos três indicadores à direita, o mesmo e-mail com a seta.
 *
 * A diferença é o que os indicadores contam. No Freightech eles são
 * notificações do sistema; aqui cada um é um número do próprio trabalho e leva
 * à tela que o resolve:
 *
 * - a nuvem → importações em andamento;
 * - o filtro → a seleção de contexto (unidade, canal, vigência);
 * - o sino → atributos monetários ainda sem semântica confirmada, que é o que
 *   segura impacto financeiro em "não calculável".
 *
 * Um badge que não conta nada não aparece. Bolinha com zero é ruído que ensina
 * o olho a ignorar o lugar onde o número importante vai aparecer depois.
 */
export function Topbar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const { user, logout, isSubmitting } = useAuth();
  const importsRunning = useImportsRunning();
  const backlog = useCurationBacklog();

  return (
    <header className="h-16 bg-brand-red text-brand-red-foreground flex items-center gap-4 px-4 shrink-0 sticky top-0 z-40">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Abrir ou fechar o menu"
        className="p-2 -ml-1 rounded hover:bg-white/10 transition-colors"
      >
        <Menu className="w-6 h-6" />
      </button>

      <Link href="/" className="flex items-center gap-2 shrink-0">
        <Logotipo />
      </Link>

      <div className="flex-1" />

      <Indicador
        href="/importacoes"
        titulo="Importações em andamento"
        contagem={importsRunning}
        alwaysShowCount
      >
        <CloudDownload className="w-6 h-6" />
      </Indicador>

      <Indicador href="/parametros" titulo="Escolha de segmento" contagem={0}>
        <SlidersHorizontal className="w-6 h-6" />
      </Indicador>

      <Indicador
        href="/curadoria"
        titulo="Atributos monetários sem semântica confirmada"
        contagem={backlog}
      >
        <Bell className="w-6 h-6" />
      </Indicador>

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

/** Ícone com a bolinha laranja. A bolinha só existe quando há o que contar. */
function Indicador({
  href,
  titulo,
  contagem,
  alwaysShowCount,
  children,
}: {
  href: string;
  titulo: string;
  contagem: number;
  alwaysShowCount?: boolean;
  children: React.ReactNode;
}) {
  const mostra = contagem > 0 || alwaysShowCount;
  return (
    <Link
      href={href}
      title={titulo}
      aria-label={`${titulo}${contagem > 0 ? `: ${contagem}` : ""}`}
      className="flex items-center gap-1.5 px-2 py-2 rounded hover:bg-white/10 transition-colors"
    >
      {children}
      {mostra && (
        <span className="min-w-7 h-7 px-1.5 rounded-full bg-brand text-brand-foreground text-[0.8125rem] font-bold flex items-center justify-center tabular-nums">
          {contagem}
        </span>
      )}
    </Link>
  );
}

/** Importações que ainda não terminaram. Zero é um estado legítimo e aparece. */
function useImportsRunning(): number {
  const { data } = useQuery({
    queryKey: ["imports", "topbar"],
    queryFn: async () => {
      const response = await fetch(getApiUrl("/imports"));
      if (!response.ok) return [] as { status: string }[];
      const body = (await response.json()) as { status: string }[] | { imports?: unknown };
      return Array.isArray(body) ? body : [];
    },
    staleTime: 30_000,
    retry: false,
  });
  return (data ?? []).filter((i) => i.status !== "PROMOTED" && i.status !== "FAILED").length;
}

/** O gargalo do produto, dito em número no lugar mais visível da tela. */
function useCurationBacklog(): number {
  const { data } = useQuery({
    queryKey: ["curation", "summary", "topbar"],
    queryFn: async () => {
      const response = await fetch(getApiUrl("/curation/summary"));
      if (!response.ok) return 0;
      const data = (await response.json()) as {
        byStatus: { status: string; count: number; monetary: number }[];
      };
      return data.byStatus
        .filter((s) => s.status !== "CONFIRMED")
        .reduce((sum, s) => sum + s.monetary, 0);
    },
    staleTime: 60_000,
    retry: false,
  });
  return data ?? 0;
}
