import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import {
  ArrowRightLeft,
  Building2,
  Bot,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  CloudDownload,
  Cog,
  Database,
  FileSearch,
  FileText,
  GitCompareArrows,
  House,
  Layers,
  MapPin,
  Scale,
  ScanSearch,
  SlidersVertical,
  Sparkles,
  TrendingUp,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  useAlteracoesDaVigencia,
  useCuradoriaPendente,
  useImportacoesEmAndamento,
} from "./contadores";

/**
 * A lateral do produto.
 *
 * Três blocos, de cima para baixo: **onde estou** (a unidade aberta), **para
 * onde vou** (as telas, em cinco seções) e **o que posso perguntar** (o
 * assistente). A ordem é a da pergunta que a pessoa traz ao abrir o sistema.
 *
 * O que mudou em relação à lista única que existia aqui, e por quê:
 *
 * 1. **Cinco seções no lugar de quinze itens soltos.** Quinze itens em lista
 *    corrida se leem um a um, sempre; agrupados por trabalho — o que a diretoria
 *    olha, o que a auditoria abre, o que a inteligência responde, o que a
 *    governança alimenta, o que a administração ajusta — o olho pula ao bloco e
 *    lê três. Foi isso que substituiu a busca por funcionalidade que morava
 *    aqui: com quinze itens visíveis e agrupados, o campo de busca era um passo
 *    a mais para chegar ao que já estava na tela.
 * 2. **A unidade saiu do botão e virou estado.** O botão laranja "Seleção de
 *    unidades" não dizia qual unidade estava aberta — e essa é a primeira coisa
 *    que precisa estar dita, porque todo número da tela depende dela. Agora o
 *    topo mostra unidade, canal e vigência lidos de `/contexts`, que é o que o
 *    banco de fato tem.
 * 3. **Os números vêm junto com os itens.** Alterações, Importações e Curadoria
 *    mostram quanto há para fazer antes de a pessoa clicar. Bolinha com zero não
 *    aparece: contagem que não conta nada ensina o olho a ignorar o lugar.
 *
 * A regra antiga continua acima de tudo: **item que não funciona não entra na
 * lista.** Nenhum item daqui aponta para uma tela que não existe.
 */

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** O número à direita, quando há um para mostrar. */
  contador?: "alteracoes" | "importacoes" | "curadoria";
  /** A tarja de novidade, que expira sozinha — ver `NOVIDADE_ATE`. */
  novidade?: boolean;
}

interface NavGroup {
  titulo: string;
  icon: LucideIcon;
  /** A classe de cor da seção — ver o bloco `--nav-*` em `index.css`. */
  cor: string;
  itens: NavItem[];
}

/**
 * Até quando "Novo" ainda é verdade.
 *
 * Uma tarja de novidade fixa no código vira mentira por decurso de prazo: seis
 * meses depois ela ainda chama de novo o que todo mundo já usa, e a próxima
 * novidade de verdade nasce sem poder ser anunciada, porque o lugar do anúncio
 * está gasto. Esta some sozinha na data.
 */
const NOVIDADE_ATE = "2026-12-31";

const NAV_GROUPS: NavGroup[] = [
  {
    titulo: "Visão executiva",
    icon: ChartNoAxesCombined,
    cor: "text-nav-executiva",
    itens: [
      { href: "/", label: "Visão geral", icon: House },
      { href: "/vigencia", label: "Acompanhamento", icon: TrendingUp },
      { href: "/analise-equipamentos", label: "Análise de frota", icon: Truck },
    ],
  },
  {
    titulo: "Auditoria",
    icon: ScanSearch,
    cor: "text-nav-auditoria",
    itens: [
      { href: "/alteracoes", label: "Alterações", icon: ArrowRightLeft, contador: "alteracoes" },
      { href: "/comparar", label: "Comparar vigências", icon: GitCompareArrows },
      { href: "/parametros", label: "Parâmetros", icon: SlidersVertical },
      { href: "/vigencias", label: "Vigências", icon: CalendarDays },
    ],
  },
  {
    titulo: "Inteligência",
    icon: Sparkles,
    cor: "text-nav-inteligencia",
    itens: [
      { href: "/assistente", label: "Assistente IA", icon: Bot, novidade: true },
      { href: "/book-operador", label: "Book do Operador", icon: FileText },
    ],
  },
  {
    titulo: "Dados & governança",
    icon: Database,
    cor: "text-nav-dados",
    itens: [
      { href: "/importacoes", label: "Importações", icon: CloudDownload, contador: "importacoes" },
      /*
        O Balanço de Massa vem logo depois de Importações porque é a conferência
        dela: a pergunta que ele faz — toda célula que o arquivo trouxe chegou a
        algum lugar? — só existe a respeito do arquivo que acabou de entrar.
      */
      { href: "/balanco-massa", label: "Balanço de massa", icon: Scale },
      { href: "/curadoria", label: "Curadoria", icon: FileSearch, contador: "curadoria" },
      /*
        Cobertura de dados não estava no desenho do menu, e entrou aqui porque a
        tela existe e funciona: tirá-la da lista não a apagaria, apenas a
        tornaria inalcançável por navegação.
      */
      { href: "/dados", label: "Cobertura de dados", icon: ClipboardList },
      { href: "/versoes", label: "Versões", icon: Layers },
    ],
  },
  {
    titulo: "Administração",
    icon: Cog,
    cor: "text-nav-admin",
    itens: [
      { href: "/unidades", label: "Unidades", icon: Building2 },
      { href: "/configuracoes", label: "Usuários", icon: Users },
    ],
  },
];

export function Sidebar({ open }: { open: boolean }) {
  const [location] = useLocation();
  const alteracoes = useAlteracoesDaVigencia();
  const importacoes = useImportacoesEmAndamento();
  const curadoria = useCuradoriaPendente();

  const contadores = { alteracoes, importacoes, curadoria };

  if (!open) return null;

  return (
    /*
     * A lateral rola dentro de si, e nunca empurra a página.
     *
     * Ela é da altura da tela menos a faixa vermelha, gruda ali, e o que não
     * couber rola aqui dentro. Enquanto era `self-stretch` num flex que crescia,
     * o menu mais alto que a tela alongava o documento inteiro — e a barra de
     * rolagem aparecia numa página que cabia, o que é o defeito mais difícil de
     * atribuir à causa certa.
     */
    <aside className="w-[19rem] bg-sidebar text-sidebar-foreground border-r border-sidebar-border shrink-0 flex flex-col sticky top-16 h-[calc(100dvh-4rem)]">
      <div className="overflow-y-auto flex-1">
        <SeletorDeUnidade />

        <nav className="pb-2">
          {NAV_GROUPS.map((grupo, indice) => (
            <div
              key={grupo.titulo}
              className={cn("py-2.5", indice > 0 && "border-t border-sidebar-border")}
            >
              <div
                className={cn(
                  "flex items-center gap-2 px-4 pb-2 text-[0.6875rem] font-bold uppercase tracking-[0.08em]",
                  grupo.cor,
                )}
              >
                <grupo.icon className="w-4 h-4 shrink-0" strokeWidth={2.25} />
                {grupo.titulo}
              </div>

              {grupo.itens.map((item) => (
                <ItemDoMenu
                  key={item.href}
                  item={item}
                  ativo={estaAtivo(location, item.href)}
                  contagem={item.contador ? contadores[item.contador] : 0}
                />
              ))}
            </div>
          ))}
        </nav>
      </div>

      <ChamadaDoAssistente />
    </aside>
  );
}

/**
 * O item ativo é o da rota atual, e prefixo só conta abaixo da raiz — sem essa
 * exceção "/" ficaria aceso em toda tela do produto.
 */
function estaAtivo(location: string, href: string): boolean {
  if (href === "/") return location === "/";
  return location === href || location.startsWith(`${href}/`);
}

function ItemDoMenu({
  item,
  ativo,
  contagem,
}: {
  item: NavItem;
  ativo: boolean;
  contagem: number;
}) {
  return (
    <Link
      href={item.href}
      aria-current={ativo ? "page" : undefined}
      className={cn(
        /*
          A borda esquerda existe nos dois estados — transparente quando o item
          está apagado — porque uma borda que só nasce no item aceso empurraria
          o texto três pixels para a direita a cada clique.
        */
        "flex items-center gap-3 border-l-[3px] pl-[calc(1rem-3px)] pr-3 py-2 text-sm transition-colors",
        ativo
          ? "border-brand-red bg-brand-red/[0.07] text-brand-red font-semibold"
          : "border-transparent text-sidebar-foreground hover:bg-sidebar-accent",
      )}
    >
      <item.icon
        className={cn("w-[1.125rem] h-[1.125rem] shrink-0", !ativo && "text-muted-foreground")}
      />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {contagem > 0 && <Contador valor={contagem} tipo={item.contador!} />}
      {item.novidade && dentroDoPrazo() && (
        <span className="rounded-full bg-nav-inteligencia px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-white">
          Novo
        </span>
      )}
    </Link>
  );
}

/**
 * A bolinha do número.
 *
 * Vermelha em Alterações, laranja em Importações e Curadoria — e a diferença
 * não é enfeite: alteração é fato consumado da vigência aberta, e as outras
 * duas são fila de trabalho de quem está olhando. Cores iguais fariam as três
 * pedirem a mesma coisa.
 */
function Contador({ valor, tipo }: { valor: number; tipo: NonNullable<NavItem["contador"]> }) {
  return (
    <span
      className={cn(
        "min-w-6 h-6 px-1.5 rounded-full text-[0.6875rem] font-bold flex items-center justify-center tabular-nums shrink-0",
        tipo === "alteracoes"
          ? "bg-brand-red text-brand-red-foreground"
          : "bg-brand text-brand-foreground",
      )}
    >
      {valor > 99 ? "99+" : valor}
    </span>
  );
}

/** Hoje, em `AAAA-MM-DD`, sem fuso: a comparação é de calendário, não de instante. */
function dentroDoPrazo(): boolean {
  const hoje = new Date();
  const iso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(
    hoje.getDate(),
  ).padStart(2, "0")}`;
  return iso <= NOVIDADE_ATE;
}

// ---------------------------------------------------------------------------
// A unidade aberta
// ---------------------------------------------------------------------------

interface Contexto {
  scopeHash: string;
  channel: string | null;
  label: string;
  scopes: { scopeType: string; code: string; name: string | null }[];
  latestPeriod: string;
  periods: number;
}

/**
 * A unidade, o canal e a vigência mais recente da seleção aberta.
 *
 * Lê `/contexts` — as unidades e canais que **já entregaram vigência**, não uma
 * lista de cadastro. Trocar a seleção leva a Parâmetros com `scopeHash` e
 * `canal` na URL, que é a tela que de fato filtra por eles; mandar para
 * qualquer outra faria o seletor mudar de rótulo sem mudar um número sequer.
 *
 * Com um contexto só, o campo não vira seletor: fica um cartão que informa. Um
 * menu de uma opção é uma promessa de variedade que o dado não tem — e obriga
 * um clique para descobrir que não havia escolha.
 */
function SeletorDeUnidade() {
  const search = useSearch();
  const { data, isLoading } = useQuery({
    queryKey: ["contexts"],
    queryFn: async () => {
      const response = await fetch(getApiUrl("/contexts"));
      if (!response.ok) return [] as Contexto[];
      const body: unknown = await response.json();
      return Array.isArray(body) ? (body as Contexto[]) : [];
    },
    staleTime: 60_000,
    retry: false,
  });

  const contextos = data ?? [];
  /*
    Qual contexto está aberto: o que a URL pede, quando pede. Fora de Parâmetros
    ninguém pede, e o produto lê o mais recente — que é a ordem que `/contexts`
    já devolve.
  */
  const pedido = new URLSearchParams(search).get("scopeHash");
  const atual = contextos.find((c) => c.scopeHash === pedido) ?? contextos[0];

  return (
    <div className="p-4 pb-3">
      <div className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-muted-foreground mb-2">
        Unidade atual
      </div>

      {atual === undefined ? (
        <CaixaDaUnidade
          titulo={isLoading ? "Carregando…" : "Nenhuma vigência importada"}
          detalhe={
            isLoading ? "" : "Envie a primeira planilha em Importações para abrir uma unidade."
          }
        />
      ) : contextos.length === 1 ? (
        <CaixaDaUnidade titulo={unidadeDe(atual)} detalhe={detalheDe(atual)} />
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger className="w-full text-left rounded-lg border border-sidebar-border bg-sidebar px-3 py-2.5 hover:border-brand transition-colors">
            <CaixaDaUnidade
              titulo={unidadeDe(atual)}
              detalhe={detalheDe(atual)}
              seta
              semMoldura
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {contextos.length} unidades com vigência importada
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {contextos.map((contexto) => (
              <DropdownMenuItem key={`${contexto.scopeHash}|${contexto.channel ?? ""}`} asChild>
                <Link href={enderecoDe(contexto)} className="flex flex-col items-start gap-0.5">
                  <span className="font-semibold">{unidadeDe(contexto)}</span>
                  <span className="text-xs text-muted-foreground">{detalheDe(contexto)}</span>
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function CaixaDaUnidade({
  titulo,
  detalhe,
  seta,
  semMoldura,
}: {
  titulo: string;
  detalhe: string;
  seta?: boolean;
  semMoldura?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5",
        !semMoldura && "rounded-lg border border-sidebar-border px-3 py-2.5",
      )}
    >
      <MapPin className="w-4 h-4 shrink-0 text-brand-red" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold truncate">{titulo}</span>
        {/*
          O detalhe quebra em vez de cortar: aqui mora tanto "EMPURRADA ·
          ago/2026", que cabe, quanto a frase que explica um banco sem vigência
          nenhuma — e essa, cortada em "Envie a primeira planilha em
          Importações…", perde justamente a instrução.
        */}
        {detalhe !== "" && (
          <span className="block text-[0.6875rem] leading-tight text-muted-foreground">
            {detalhe}
          </span>
        )}
      </span>
      {seta && <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />}
    </div>
  );
}

/** O nome da unidade; sem escopo cadastrado sobra o rótulo que o servidor montou. */
function unidadeDe(contexto: Contexto): string {
  const unidade = contexto.scopes.find((s) => s.scopeType === "UNIDADE");
  return unidade?.name ?? unidade?.code ?? contexto.label;
}

/** `EMPURRADA · ago/2026` — o canal do rótulo e a vigência mais recente dele. */
function detalheDe(contexto: Contexto): string {
  const canal = contexto.channel ?? "sem canal no rótulo";
  return `${canal} · ${mesAbreviado(contexto.latestPeriod)}`;
}

function enderecoDe(contexto: Contexto): string {
  const query = new URLSearchParams({ scopeHash: contexto.scopeHash });
  if (contexto.channel !== null) query.set("canal", contexto.channel);
  return `/parametros?${query}`;
}

const MESES = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

/** `2026-08-01` → `ago/2026`. Sem `Date`, para o fuso não recuar o mês. */
function mesAbreviado(data: string): string {
  const [ano, mes] = data.split("-");
  const indice = Number(mes) - 1;
  return indice >= 0 && indice < 12 ? `${MESES[indice]}/${ano}` : data;
}

/**
 * O convite ao assistente, no pé da lateral.
 *
 * Fica fora da área que rola, colado embaixo, porque a pergunta que ele responde
 * costuma ser a que sobra depois de a pessoa procurar a tela certa e não achar.
 */
function ChamadaDoAssistente() {
  return (
    <div className="p-4 border-t border-sidebar-border">
      <Link
        href="/assistente"
        className="flex items-center gap-2.5 rounded-lg border border-nav-inteligencia/30 bg-nav-inteligencia/[0.06] px-3 py-2.5 hover:bg-nav-inteligencia/[0.12] transition-colors"
      >
        <span className="w-8 h-8 rounded-full bg-nav-inteligencia/15 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-nav-inteligencia" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.75rem] font-bold text-nav-inteligencia">
            Pergunte ao FreightCheck
          </span>
          <span className="block text-[0.6875rem] leading-tight text-muted-foreground">
            Analise seus dados e documentos
          </span>
        </span>
        <ChevronRight className="w-4 h-4 shrink-0 text-nav-inteligencia" />
      </Link>
    </div>
  );
}
