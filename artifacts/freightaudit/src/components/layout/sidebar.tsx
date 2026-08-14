import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Activity,
  ArrowDownToLine,
  BookOpen,
  CloudDownload,
  CalendarRange,
  Database,
  FileSearch,
  Gauge,
  GitBranch,
  GitCompareArrows,
  HelpCircle,
  LayoutGrid,
  Search,
  Settings,
  Sparkles,
  Truck,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A lateral do Freightech.
 *
 * Branca, o botão laranja de seleção de unidades no topo, a busca de
 * funcionalidades logo abaixo, e a lista em caixa alta com o ícone à esquerda.
 * Quem usa o Freightech encontra cada item onde a mão já vai.
 *
 * Duas decisões que não são cosméticas:
 *
 * 1. **A busca filtra de verdade.** No Freightech a lista é longa e a busca é o
 *    caminho mais curto. Aqui ela filtra por rótulo e por sinônimo — quem digita
 *    "chamado" acha Curadoria, quem digita "exportação" acha Importações — porque
 *    o vocabulário aprendido lá não bate item a item com o daqui.
 * 2. **Um item que não funciona não entra na lista.** É a mesma regra de antes
 *    do espelho, e ela vale acima da fidelidade visual: parecer o Freightech não
 *    autoriza prometer uma tela que não existe.
 */

interface NavItem {
  href: string;
  label: string;
  icon: typeof Activity;
  /** O que o usuário talvez digite na busca procurando por este item. */
  sinonimos?: string[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Pagina inicial", icon: Gauge, sinonimos: ["home", "início"] },
  {
    href: "/dados",
    label: "Dados",
    icon: Database,
    sinonimos: ["cobertura", "o que tem", "o que falta", "planilhas", "importado", "inventário"],
  },
  {
    href: "/vigencia",
    label: "Acompanhamento de vigência",
    icon: Activity,
    sinonimos: ["dashboard", "resumo", "impacto", "acompanhamento exportações"],
  },
  {
    href: "/parametros",
    label: "Parâmetros",
    icon: LayoutGrid,
    /*
      "book operador" saiu daqui. Era um apelido emprestado enquanto o Book não
      existia como tela; agora que existe, deixá-lo apontando para Parâmetros
      mandaria quem digita o nome exato para o lugar errado — e é justamente
      quem sabe o nome que menos merece isso.
    */
    sinonimos: ["segmento", "escolha de segmento", "família"],
  },
  {
    href: "/book-operador",
    label: "Book do Operador",
    icon: BookOpen,
    sinonimos: [
      "book",
      "regras",
      "remuneração",
      "modelo de precificação",
      "planilha aberta",
      "contrato",
      "manual",
    ],
  },
  {
    href: "/assistente",
    label: "Assistente de IA",
    icon: Sparkles,
    sinonimos: [
      "ia",
      "inteligencia artificial",
      "assistente",
      "perguntar",
      "duvida",
      "ajuda",
      "chat",
      "o que significa",
    ],
  },
  {
    href: "/alteracoes",
    label: "Alterações",
    icon: Activity,
    sinonimos: ["mudanças", "chamados", "linha a linha"],
  },
  {
    href: "/comparar",
    label: "Comparar vigências",
    icon: GitCompareArrows,
    sinonimos: ["diff", "retroativo", "dissídio"],
  },
  {
    href: "/vigencias",
    label: "Vigências",
    icon: CalendarRange,
    sinonimos: ["histórico", "datas", "dimensionamento"],
  },
  {
    href: "/curadoria",
    label: "Curadoria",
    icon: FileSearch,
    sinonimos: ["semântica", "atributos", "limpa pautas"],
  },
  {
    href: "/versoes",
    label: "Versões",
    icon: GitBranch,
    sinonimos: ["correção", "fonte", "outros custos"],
  },
  {
    href: "/importacoes",
    label: "Importações",
    icon: CloudDownload,
    sinonimos: ["exportação", "arquivo", "planilha", "upload"],
  },
  {
    href: "/analise-equipamentos",
    label: "Análise de frota",
    icon: Truck,
    sinonimos: ["equipamentos", "cavalo", "carreta", "legado"],
  },
  {
    href: "/configuracoes",
    label: "Usuário",
    icon: Users,
    sinonimos: ["configurações", "acesso", "senha", "conta"],
  },
];

export function Sidebar({ open }: { open: boolean }) {
  const [location] = useLocation();
  const [busca, setBusca] = useState("");

  const itens = useMemo(() => {
    const termo = normalizar(busca.trim());
    if (!termo) return NAV_ITEMS;
    return NAV_ITEMS.filter((item) =>
      [item.label, ...(item.sinonimos ?? [])].some((texto) =>
        normalizar(texto).includes(termo),
      ),
    );
  }, [busca]);

  if (!open) return null;

  return (
    /*
     * A lateral rola dentro de si, e nunca empurra a página.
     *
     * Antes ela era `self-stretch` num flex que crescia: com onze itens, o menu
     * ficava mais alto que a tela e alongava o documento inteiro. O efeito era
     * o pior possível de diagnosticar — a página inicial cabia (584px de
     * conteúdo), mas a barra de rolagem aparecia mesmo assim, e a impressão era
     * de que a interface estava grande demais quando o problema era outro.
     *
     * Agora ela é da altura da tela menos a faixa vermelha, gruda ali, e o que
     * não couber rola aqui dentro — como no Freightech.
     */
    <aside className="w-72 bg-sidebar text-sidebar-foreground border-r border-sidebar-border shrink-0 flex flex-col sticky top-16 h-[calc(100dvh-4rem)]">
      <div className="p-4">
        <Link
          href="/parametros"
          className="block w-full bg-brand text-brand-foreground text-center text-[0.8125rem] font-bold uppercase tracking-wide py-3 rounded-sm hover:brightness-95 transition-[filter]"
        >
          Seleção de unidades
        </Link>
      </div>

      <div className="px-4 pb-4">
        <label
          htmlFor="busca-funcionalidades"
          className="block text-[0.9375rem] font-bold text-foreground mb-2"
        >
          Funcionalidades
        </label>
        <div className="relative">
          <input
            id="busca-funcionalidades"
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            className="w-full border border-input rounded-sm h-11 pl-3 pr-10 text-sm outline-none focus:border-brand"
          />
          <Search className="w-5 h-5 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto pb-6">
        {itens.length === 0 && (
          <p className="px-6 text-xs text-muted-foreground">
            Nenhuma funcionalidade com esse nome.
          </p>
        )}

        {itens.map((item) => {
          const ativo =
            location === item.href ||
            (item.href !== "/" && location.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-4 px-6 py-3 text-[0.8125rem] font-semibold uppercase tracking-wide transition-colors",
                ativo
                  ? "bg-sidebar-accent text-brand"
                  : "text-sidebar-foreground hover:bg-sidebar-accent",
              )}
            >
              <item.icon
                className={cn("w-5 h-5 shrink-0", ativo ? "text-brand" : "text-muted-foreground")}
              />
              <span className="min-w-0">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border">
        <Link
          href="/configuracoes"
          className="flex items-center gap-4 px-6 py-3 text-[0.8125rem] font-semibold uppercase tracking-wide text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          <Settings className="w-5 h-5 shrink-0 text-muted-foreground" />
          Configurações
        </Link>
        <a
          href="https://github.com/guyrpeixotoneto-ux/freightcheck"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-4 px-6 py-3 text-[0.8125rem] font-semibold uppercase tracking-wide text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          <HelpCircle className="w-5 h-5 shrink-0 text-muted-foreground" />
          Ajuda
        </a>
        <div className="px-6 py-3 flex items-center gap-2 text-[0.6875rem] text-muted-foreground">
          <ArrowDownToLine className="w-3.5 h-3.5" />
          FreightCheck — espelho do Freightech
        </div>
      </div>
    </aside>
  );
}

/** Busca sem acento e sem caixa: ninguém digita "vigência" com o acento certo. */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
