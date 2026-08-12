import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Database,
  FileDown,
  FileSearch,
  GitBranch,
  GitCompareArrows,
  Home,
  LogOut,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getApiUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/**
 * O menu, na ordem do trabalho.
 *
 * Três regras, e a primeira vale mais do que parece:
 *
 * 1. **Um item que não funciona não é apresentado como se funcionasse.** A
 *    Simulação ficava aqui, travada, apontando para rotas removidas junto com o
 *    schema antigo. Um item inerte ainda ocupa atenção e ainda promete algo que
 *    o produto não entrega; saiu, e o desenho dela continua em
 *    `docs/PROPOSTA-SIMULACAO.md` até existir código atrás do clique.
 *
 * 2. **Uma tela é a tela.** "Início" é onde se decide, e por isso é a primeira
 *    e a única do primeiro grupo. Alterações e Comparar continuam existindo —
 *    são a lista linha a linha e o par escolhido à mão — mas passaram a ser o
 *    aprofundamento, não o ponto de partida.
 *
 * 3. **Ferramenta de decisão e ferramenta de operação não têm o mesmo peso.**
 *    Importações é operação. Análise de Frota lê a planilha do disco, fora do
 *    modelo canônico e sem rastreabilidade até a célula: continua acessível,
 *    sob o rótulo que ela merece.
 */

interface NavItem {
  href: string;
  label: string;
  icon: typeof Activity;
  /** Frase curta sob o item, quando ele precisa de contexto. */
  note?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Decidir",
    items: [{ href: "/", label: "Início", icon: Home }],
  },
  {
    title: "Aprofundar",
    items: [
      { href: "/alteracoes", label: "Alterações", icon: Activity },
      { href: "/comparar", label: "Comparar Vigências", icon: GitCompareArrows },
      { href: "/vigencias", label: "Vigências", icon: Database },
    ],
  },
  {
    title: "Destravar",
    items: [
      { href: "/curadoria", label: "Curadoria", icon: FileSearch },
      { href: "/versoes", label: "Versões", icon: GitBranch },
    ],
  },
  {
    title: "Operação",
    items: [
      { href: "/importacoes", label: "Importações", icon: FileDown },
      {
        href: "/analise-equipamentos",
        label: "Análise de Frota",
        icon: Truck,
        note: "legado — lê a planilha, não o modelo",
      },
    ],
  },
];

/**
 * Attributes that still block a financial number.
 *
 * The single most useful thing this menu can tell you: how much of the
 * product's value is still locked behind curation. It is the bottleneck, and
 * hiding it would not make it smaller.
 */
function useCurationBacklog() {
  return useQuery({
    queryKey: ["curation", "summary", "sidebar"],
    queryFn: async () => {
      const response = await fetch(getApiUrl("/curation/summary"));
      if (!response.ok) return null;
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
}

export function Sidebar() {
  const [location] = useLocation();
  const { data: backlog } = useCurationBacklog();

  return (
    <aside className="w-64 bg-sidebar text-sidebar-foreground min-h-[100dvh] flex flex-col border-r border-sidebar-border shrink-0 sticky top-0">
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border">
        <div className="font-bold text-xl tracking-tight flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-primary text-primary-foreground flex items-center justify-center">
            <span className="font-sans font-bold">F</span>
          </div>
          FREIGHTCHECK
        </div>
      </div>

      <nav className="px-4 py-5 flex-1 flex flex-col gap-5 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="flex flex-col gap-1">
            <div className="text-[11px] font-semibold text-sidebar-foreground/40 tracking-wider mb-1 px-2 uppercase">
              {group.title}
            </div>

            {group.items.map((item) => {
              const isActive =
                location === item.href ||
                (item.href !== "/" && location.startsWith(item.href));

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                  )}
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1">
                    {item.label}
                    {item.note && (
                      <span className="block text-[10px] font-normal opacity-60 leading-tight">
                        {item.note}
                      </span>
                    )}
                  </span>
                  {item.href === "/curadoria" && backlog ? (
                    <span
                      title={`${backlog} atributos monetários ainda sem semântica confirmada — cada um deles é um impacto financeiro que o produto não pode calcular.`}
                      className="text-[11px] tabular-nums px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300"
                    >
                      {backlog}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <SignedInAs />
    </aside>
  );
}

/**
 * Quem está logado — e é o mesmo nome que vai para o `actor` de cada
 * confirmação. Antes daqui havia um "Admin User" fixo no código, que dizia
 * exatamente nada sobre quem estava usando o sistema.
 */
function SignedInAs() {
  const { user, logout, isSubmitting } = useAuth();

  if (!user) return null;

  return (
    <div className="p-4 border-t border-sidebar-border">
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center text-xs font-bold shrink-0">
          {initials(user.name)}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-medium truncate">{user.name}</span>
          <span className="text-xs text-sidebar-foreground/50 truncate">
            {user.email}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          disabled={isSubmitting}
          title="Sair"
          aria-label="Sair"
          className="text-sidebar-foreground/50 hover:text-sidebar-foreground p-1.5 rounded-md hover:bg-sidebar-accent/50 transition-colors disabled:opacity-50"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/** Duas letras, e nunca uma string vazia — o nome é obrigatório no cadastro. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}
