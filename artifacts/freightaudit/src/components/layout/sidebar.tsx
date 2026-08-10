import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Calculator,
  Database,
  FileDown,
  FileSearch,
  GitCompareArrows,
  LayoutDashboard,
  Lock,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getApiUrl } from "@/lib/api";

/**
 * The menu, ordered by what the product is for.
 *
 * Two rules here, and the first one matters more than it looks:
 *
 * 1. **A menu item that does not work is not presented as if it did.** Five of
 *    the eight original entries pointed at endpoints removed with the old
 *    schema, so clicking them landed on an error state. Advertising a
 *    capability the product does not have is the same failure as showing a
 *    number it cannot back up — and this product exists to not do that.
 *    They stay visible, because the roadmap is worth seeing, but they are
 *    inert and say so.
 *
 * 2. **Order follows the work, not the org chart.** "O que mudou" is the
 *    reason the product exists, so it comes first; the meaning of a variable
 *    is what makes the change measurable, so it comes second.
 */

interface NavItem {
  href: string;
  label: string;
  icon: typeof Activity;
  /** Why it is not available yet. Present = the item is inert. */
  pending?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

/**
 * Each group is a question the product answers, in the order someone actually
 * asks them: what moved, what it means, what it costs, where it came from.
 *
 * The labels use the domain's words rather than the schema's. Internally these
 * are `snapshot` rows; to anyone reading the export they are *vigências*, and
 * every screen and document already says so. "Comparar Modelos" is gone for a
 * different reason — in a fleet product "modelo" reads as vehicle model, when
 * what is being compared is two remuneration vigências.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    title: "O que mudou",
    items: [
      { href: "/alteracoes", label: "Alterações", icon: Activity },
      { href: "/comparar", label: "Comparar Vigências", icon: GitCompareArrows },
    ],
  },
  {
    title: "O que significa",
    items: [{ href: "/curadoria", label: "Curadoria", icon: FileSearch }],
  },
  {
    title: "Quanto custa",
    items: [
      {
        href: "/",
        label: "Painel de Impacto",
        icon: LayoutDashboard,
        pending:
          "Depende do motor financeiro (F4) e da comparação já entregue. " +
          "Hoje o impacto apurado vive na tela de Alterações.",
      },
      {
        href: "/simulacao",
        label: "Simulação",
        icon: Calculator,
        pending: "Depende do motor financeiro, que é F4.",
      },
    ],
  },
  {
    title: "De onde veio",
    items: [
      { href: "/analise-equipamentos", label: "Análise de Frota", icon: Truck },
      {
        href: "/snapshots",
        label: "Vigências",
        icon: Database,
        pending:
          "Será reconstruída sobre o modelo canônico em F5. As vigências já " +
          "existem no banco — falta a tela.",
      },
      {
        href: "/importacoes",
        label: "Importações",
        icon: FileDown,
        pending:
          "Será reconstruída sobre o modelo canônico em F5. O pipeline de " +
          "ingestão já roda por linha de comando.",
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
              if (item.pending) {
                return (
                  <div
                    key={item.label}
                    title={item.pending}
                    aria-disabled="true"
                    className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-sidebar-foreground/30 cursor-not-allowed select-none"
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    <Lock className="w-3 h-3 shrink-0" />
                  </div>
                );
              }

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
                  <span className="flex-1">{item.label}</span>
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

      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center text-xs font-bold">
            AD
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium truncate">Admin User</span>
            <span className="text-xs text-sidebar-foreground/50 truncate">
              admin@freightaudit.com
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
