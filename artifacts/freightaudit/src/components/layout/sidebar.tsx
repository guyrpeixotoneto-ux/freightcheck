import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Database, 
  GitCompareArrows, 
  Calculator, 
  FileDown,
  Activity,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/snapshots", label: "Snapshots", icon: Database },
  { href: "/alteracoes", label: "Alterações", icon: Activity },
  { href: "/comparar", label: "Comparar Modelos", icon: GitCompareArrows },
  { href: "/simulacao", label: "Simulação", icon: Calculator },
  { href: "/importacoes", label: "Importações", icon: FileDown },
  { href: "/analise-equipamentos", label: "Análise de Frota", icon: Truck },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <aside className="w-64 bg-sidebar text-sidebar-foreground min-h-[100dvh] flex flex-col border-r border-sidebar-border shrink-0 sticky top-0">
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border">
        <div className="font-bold text-xl tracking-tight flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-primary text-primary-foreground flex items-center justify-center">
            <span className="font-sans font-bold">F</span>
          </div>
          FREIGHTAUDIT
        </div>
      </div>
      
      <div className="px-4 py-6 flex-1 flex flex-col gap-1">
        <div className="text-xs font-semibold text-sidebar-foreground/50 tracking-wider mb-2 px-2 uppercase">Menu Principal</div>
        {NAV_ITEMS.map((item) => {
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          return (
            <Link 
              key={item.href} 
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200",
                isActive 
                  ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center text-xs font-bold">
            AD
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium">Admin User</span>
            <span className="text-xs text-sidebar-foreground/50">admin@freightaudit.com</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
