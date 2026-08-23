import { Link, useLocation, useSearch } from "wouter";
import {
  ArrowRightLeft,
  BadgeCheck,
  Building2,
  Bot,
  Briefcase,
  Calculator,
  Receipt,
  CalendarDays,
  ChartColumn,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  CloudDownload,
  Cog,
  Container,
  Database,
  FileSearch,
  FolderTree,
  FileSpreadsheet,
  FileText,
  Gavel,
  GitCompareArrows,
  Handshake,
  HardHat,
  History,
  House,
  LayoutDashboard,
  Layers,
  MapPin,
  Plug,
  RefreshCcwDot,
  Route,
  Scale,
  ScanSearch,
  Settings2,
  Shield,
  ShieldCheck,
  ShoppingCart,
  SlidersVertical,
  Sparkles,
  SquareActivity,
  SquareTerminal,
  Tags,
  Tractor,
  TrendingUp,
  TriangleAlert,
  Truck,
  Users,
  UsersRound,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ambienteDe,
  BASES_DE_FECHAMENTO,
  descricaoDoAmbiente,
  ehFechamento,
  ENTRADA_DA_AUDITORIA,
  RESUMO_EXECUTIVO,
  type Ambiente,
} from "@/lib/ambiente";
import { useAuth } from "@/lib/auth";
import { useContextosDaCasca, type Contexto } from "@/lib/contextos";
import { cn } from "@/lib/utils";
import { enderecoDoAssistente } from "@/lib/entrada-do-assistente";
import {
  useAlteracoesDaVigencia,
  useCuradoriaPendente,
  useImportacoesEmAndamento,
} from "./contadores";
import type { NavGroup, NavItem } from "./nav";
import { navGroupsFechamento } from "./nav-fechamento";
import { useSecoesRecolhidas } from "./preferencias";

/**
 * A lateral do produto.
 *
 * Três blocos, de cima para baixo: **onde estou** (a unidade aberta), **para
 * onde vou** (as telas, em nove seções) e **quem sou** (a pessoa logada, no
 * rodapé). A ordem é a da pergunta que a pessoa traz ao abrir o sistema.
 *
 * O que mudou em relação à lista única que existia aqui, e por quê:
 *
 * 1. **Um cartão por seção, no lugar de uma lista corrida.** Quarenta e dois
 *    itens em lista corrida se leem um a um, sempre; agrupados por trabalho — o
 *    que a diretoria olha, o que a compra libera, o que a auditoria abre, o que
 *    a recuperação cobra, o que a frota detalha, o que a inteligência responde,
 *    o que a governança alimenta, o que a administração ajusta — o olho pula ao
 *    cartão e lê cinco. Cada seção é um cartão de borda arredondada, e a lista
 *    de telas mora dentro dele: fechado, o menu inteiro cabe numa tela sem
 *    rolar.
 * 2. **A unidade saiu do botão e virou estado.** O botão laranja "Seleção de
 *    unidades" não dizia qual unidade estava aberta — e essa é a primeira coisa
 *    que precisa estar dita, porque todo número da tela depende dela. Agora o
 *    topo mostra unidade, canal e vigência lidos de `/contexts`, que é o que o
 *    banco de fato tem.
 * 3. **Os números vêm junto com os itens.** Alterações, Importações e Curadoria
 *    mostram quanto há para fazer antes de a pessoa clicar. Bolinha com zero não
 *    aparece: contagem que não conta nada ensina o olho a ignorar o lugar.
 * 4. **As seções nascem fechadas e abrem sob clique.** O retrato de descanso é
 *    o dos cartões fechados; quem passa o dia em Auditoria abre a sua e a
 *    escolha fica — para o navegador, não para a página, ver
 *    `useSecoesRecolhidas`. Fechar esconde a lista, nunca a informação: o
 *    cartão fechado que contém a tela aberta fica aceso com a barra marinho, e
 *    o que esconde fila de trabalho traz a soma no cabeçalho.
 * 5. **O rodapé é de quem entrou.** Avatar com as iniciais, nome e e-mail, com
 *    Configurações e Sair no menu — o mesmo par que a faixa do topo oferece,
 *    ao alcance de onde o olho já está quando navega.
 *
 * A regra antiga continua acima de tudo, com o alcance dito por extenso:
 * **nenhum item daqui leva a lugar nenhum, e nenhum leva a um número
 * inventado.** Os dezoito itens que ainda não têm tela abrem uma página que
 * diz o que falta no banco para respondê-los e para onde ir enquanto isso — ver
 * o comentário de `NAV_GROUPS` e `pages/telas-em-preparo.ts`.
 */

/*
  `NavItem` e `NavGroup` moram em `nav.ts`: a mesma forma descreve a lista da
  Auditoria (abaixo) e a do Fechamento (`nav-fechamento.ts`), e qual das duas a
  lateral mostra é decidido pelo ambiente que a URL declara — ver
  `lib/ambiente.ts`.
*/

/**
 * As nove seções, e a ordem em que se lê o trabalho de um dia.
 *
 * A lista dobrou — de dezessete itens em cinco seções para trinta e cinco em sete —
 * e nenhum item saiu: as duas seções novas, **Recuperação** e **Frota**, e os
 * itens acrescentados às cinco antigas nomeiam trabalho que o produto vai
 * fazer; nada do que já existia mudou de nome, de lugar relativo ou de endereço.
 *
 * A ordem é a de uma auditoria completa, de cima para baixo: vê-se o retrato
 * (**Visão executiva**), libera-se o que precisa ser comprado hoje
 * (**Compras**), procura-se o desvio (**Auditoria**), cobra-se o desvio achado
 * (**Recuperação**), confere-se o quadro de gente que o modelo remunera
 * (**QLP**), desce-se ao ativo que o sofreu (**Frota**),
 * pergunta-se ao assistente o que sobrou (**Inteligência**), e por baixo de
 * tudo estão o material (**Dados & governança**) e a casa (**Administração**).
 *
 * Dezessete destes itens ainda não têm tela — e é aqui que a regra antiga desta
 * lateral, *item que não funciona não entra na lista*, precisou de uma emenda
 * em vez de uma exceção. Todos eles **abrem**, e o que abrem diz a verdade: a
 * pergunta que a tela vai responder, o dado que falta no banco para respondê-la
 * e a tela que hoje chega mais perto — ver `pages/telas-em-preparo.ts`. O que a
 * regra proíbe continua proibido, e ficou mais explícito: não há, em nenhuma
 * dessas telas, um número de exemplo. Clicar leva a algum lugar; o que aquele
 * lugar informa é o que ainda não se sabe.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    titulo: "Visão executiva",
    descricao: "O retrato do conjunto e o valor apurado",
    icon: ChartNoAxesCombined,
    cor: "text-nav-executiva",
    itens: [
      /*
        A Visão Gerencial abre a seção porque é a leitura mais alta que o
        ambiente tem: todas as unidades de uma vez, em ordem do que falta
        auditar. O Resumo executivo vem logo abaixo e responde pela unidade
        aberta — é a mesma escada da lateral do Fechamento, onde a Visão
        Gerencial também é o primeiro item.

        As duas ficam coladas, e nesta ordem, porque são a mesma pergunta em
        duas alturas: o conjunto e a unidade. Separá-las por três itens faria
        parecer que falam de coisas diferentes.

        A ordem do menu agora é também a ordem da entrada: `/` encaminha para o
        primeiro destes dois itens, e o segundo tem endereço próprio desde que
        deixou a raiz. Ver `lib/ambiente.ts`.
      */
      { href: ENTRADA_DA_AUDITORIA, label: "Visão Gerencial", icon: LayoutDashboard },
      { href: RESUMO_EXECUTIVO, label: "Resumo executivo", icon: House },
      { href: "/vigencia", label: "Acompanhamento", icon: TrendingUp },
      /*
        A Análise de frota saiu daqui e passou a abrir a seção **Frota**, ao lado
        das telas que descem ao ativo: é o mesmo assunto lido de duas alturas, e
        o olho procura as duas no mesmo bloco.

        A Composição ficou. Ela continua sendo o drill-down da análise — a
        análise diz como a frota se comporta, e a composição responde, para um
        equipamento, por que ele recebe o que recebe —, mas mora na visão
        executiva, e não na auditoria nem na Frota, por ser a porta de entrada:
        quem abre procura um valor, e só depois procura a inconsistência dele.
      */
      { href: "/composicao", label: "Composição", icon: Calculator },
      /*
        A DRE vem depois da Composição porque é a pergunta seguinte. A Composição
        responde "por que este equipamento recebe este valor"; a DRE responde "o
        que sobra depois dos custos" — e usa exatamente a mesma apuração, com as
        linhas reorganizadas em seções contábeis. Duas telas e um motor.

        Fica aqui, e não na seção **Frota**, pelo mesmo motivo que a Composição:
        as duas partem de um valor apurado e só então descem ao ativo — entra-se
        nelas pela conta, não pela placa. Na Frota vive o `/dre-veiculo` ainda em
        preparo, que continua em preparo porque o que falta a ele é custo
        operacional, e não esta apuração.
      */
      { href: "/dre", label: "DRE", icon: Receipt },
    ],
  },
  {
    /*
      Compras fica entre a Visão executiva e a Auditoria, e a posição é a do
      gesto que ela serve: alguém está com um pedido de compra parado na mesa e
      precisa saber, agora, quanto a Ambev remunera aquele produto. Não é
      auditoria — auditar é descobrir o que mudou, e aqui nada mudou; é um
      portão antes de o dinheiro sair, e por isso vem antes.

      Um item só, como a seção Remuneração da lateral do Fechamento. A seção
      existe mesmo assim porque o trabalho é outro: quem passa o dia comprando
      não abre nenhuma das sete telas de Auditoria, e um item de compra perdido
      no meio delas seria encontrado por quem já sabia que ele existia.
    */
    titulo: "Compras",
    descricao: "Quanto a Ambev remunera o que se vai comprar",
    icon: ShoppingCart,
    cor: "text-nav-compras",
    itens: [{ href: "/remunerado", label: "Remunerado", icon: Tags }],
  },
  {
    titulo: "Auditoria",
    descricao: "O que mudou na vigência e quanto custou",
    icon: ScanSearch,
    cor: "text-nav-auditoria",
    itens: [
      { href: "/alteracoes", label: "Alterações", icon: ArrowRightLeft, contador: "alteracoes" },
      { href: "/comparar", label: "Comparar vigências", icon: GitCompareArrows },
      { href: "/parametros", label: "Parâmetros", icon: SlidersVertical },
      { href: "/vigencias", label: "Vigências", icon: CalendarDays },
      /*
        Os três novos vêm depois dos quatro que funcionam, e nessa ordem, porque
        é a ordem da pergunta: o que mudou (Alterações) vira quanto custou
        (Impacto financeiro), quanto custou vira o que disso é anormal
        (Anomalias), e o anormal vira um caso com dono (Auditorias).
      */
      { href: "/impacto-financeiro", label: "Impacto financeiro", icon: CircleDollarSign },
      { href: "/anomalias", label: "Anomalias", icon: TriangleAlert },
      { href: "/auditorias", label: "Auditorias", icon: ClipboardCheck },
    ],
  },
  {
    /*
      Recuperação é seção própria, e não a cauda da Auditoria, porque é outro
      trabalho e quase sempre outra pessoa: auditar é descobrir, recuperar é
      cobrar. Quem passa o dia numa das duas fecha a outra.
    */
    titulo: "Recuperação",
    descricao: "A cobrança do desvio já apurado",
    icon: RefreshCcwDot,
    cor: "text-nav-recuperacao",
    itens: [
      { href: "/contestacao", label: "Contestação & Recuperação", icon: Gavel },
      { href: "/reconciliacao", label: "Reconciliação", icon: Handshake },
      { href: "/risco-materialidade", label: "Risco & Materialidade", icon: ShieldCheck },
    ],
  },
  {
    /*
      QLP — o quadro de lotação de pessoal que o modelo remunera — é seção
      própria, acima da Frota, porque é a outra metade da mesma conta: a Frota
      carrega o custo do ativo, e o QLP carrega o custo da estrutura de gente,
      lida nas duas alturas em que o Freightech a publica — a operação e a
      administração. Os dois itens abrem telas em preparo: a regra vive no Book,
      mas o export que abastece este banco ainda não traz os valores de QLP —
      ver `pages/telas-em-preparo.ts`, onde cada um diz o que falta.
    */
    titulo: "QLP",
    descricao: "O quadro de gente que o modelo remunera",
    icon: UsersRound,
    cor: "text-nav-qlp",
    itens: [
      { href: "/qlp-operacional", label: "QLP Operacional", icon: HardHat },
      { href: "/qlp-administrativo", label: "QLP Administrativo", icon: Briefcase },
    ],
  },
  {
    /*
      A seção reúne as duas alturas da mesma pergunta: a Análise de frota olha a
      categoria, e as telas 360° olham o ativo individual. Por isso ela abre pela
      análise — lê-se a frota inteira, e só então se desce à placa —, e por isso
      o ícone da seção é o mesmo caminhão do item que a abre: o olho reconhece o
      assunto, e a posição na lista diz de que altura ele está sendo visto.
    */
    titulo: "Frota",
    descricao: "Do comportamento da frota à placa",
    icon: Truck,
    cor: "text-nav-frota",
    itens: [
      { href: "/analise-equipamentos", label: "Análise de frota", icon: Truck },
      { href: "/cavalo-360", label: "Cavalo 360°", icon: Tractor },
      { href: "/carreta-360", label: "Carreta 360°", icon: Container },
      /*
        O trecho fecha a fileira, e fecha por ser o outro lado da conta: cavalo
        e carreta carregam o fixo — o que se paga por o ativo existir —, e o
        trecho carrega o variável, o que se paga por ele rodar. O ícone não é
        veículo de propósito; três caminhões seguidos fariam a terceira entrada
        parecer um terceiro equipamento.
      */
      { href: "/trecho-360", label: "Trecho 360°", icon: Route },
      { href: "/dre-veiculo", label: "DRE do veículo", icon: FileSpreadsheet },
      { href: "/benchmark-unidades", label: "Benchmark de unidades", icon: ChartColumn },
    ],
  },
  {
    titulo: "Inteligência",
    descricao: "Perguntas ao assistente e o Book do Operador",
    icon: Sparkles,
    cor: "text-nav-inteligencia",
    itens: [
      { href: "/assistente", label: "Assistente IA", icon: Bot },
      { href: "/book-operador", label: "Book do Operador", icon: FileText },
      { href: "/monitor-ia", label: "Monitor de IA", icon: SquareActivity },
    ],
  },
  {
    titulo: "Dados & governança",
    descricao: "De onde vêm os números e o que os sustenta",
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
      { href: "/categorias", label: "Categorias", icon: FolderTree },
      /*
        Cobertura de dados não estava no desenho do menu, e entrou aqui porque a
        tela existe e funciona: tirá-la da lista não a apagaria, apenas a
        tornaria inalcançável por navegação.
      */
      { href: "/dados", label: "Cobertura de dados", icon: ClipboardList },
      { href: "/versoes", label: "Versões", icon: Layers },
      { href: "/qualidade-dados", label: "Qualidade de dados", icon: BadgeCheck },
      { href: "/fontes-dados", label: "Fontes de dados", icon: Database },
      { href: "/historico-decisoes", label: "Histórico de decisões", icon: History },
      { href: "/logs-sistema", label: "Logs de sistema", icon: SquareTerminal },
    ],
  },
  {
    titulo: "Administração",
    descricao: "Unidades, usuários e ajustes da instalação",
    icon: Cog,
    cor: "text-nav-admin",
    itens: [
      { href: "/unidades", label: "Unidades", icon: Building2 },
      /*
        "Usuários" continua em `/configuracoes`, que é onde a tela sempre esteve
        e para onde o menu da faixa vermelha e o assistente já apontam. A
        Configurações desta lista — os ajustes da instalação — nasce em
        `/ajustes` por isso: mudar o endereço de uma tela que funciona, para dar
        o nome bonito a uma que ainda não existe, quebraria os dois links por
        uma questão de nomenclatura.
      */
      { href: "/configuracoes", label: "Usuários", icon: Users },
      { href: "/ajustes", label: "Configurações", icon: Settings2 },
      { href: "/integracoes", label: "Integrações", icon: Plug },
      { href: "/seguranca", label: "Segurança", icon: Shield },
    ],
  },
];

export function Sidebar({ open }: { open: boolean }) {
  const [location] = useLocation();
  /*
    O recorte de onde a pessoa está, para o atalho do Assistente levá-lo junto.

    Ver `lib/entrada-do-assistente.ts`: sem `scopeHash` no link, o servidor cai
    no primeiro contexto do banco, e quem clicava no atalho olhando uma unidade
    passava a conversar sobre outra.
  */
  const busca = useSearch();
  const paraOAssistente = enderecoDoAssistente(busca);
  const alteracoes = useAlteracoesDaVigencia();
  const importacoes = useImportacoesEmAndamento();
  const curadoria = useCuradoriaPendente();
  const { recolhido, alternar } = useSecoesRecolhidas();

  const contadores = { alteracoes, importacoes, curadoria };

  /*
    A lateral é a mesma nos dois ambientes; o conteúdo é que troca. Quem decide
    é a URL (`lib/ambiente.ts`): sob a base de um dos fechamentos — Rota ou
    Empurrada —, as cinco seções do processo, com o nome do ambiente na
    primeira; em todo o resto, as oito da Auditoria de sempre.
  */
  const ambiente = ambienteDe(location);
  const grupos = ehFechamento(ambiente)
    ? navGroupsFechamento(BASES_DE_FECHAMENTO[ambiente], descricaoDoAmbiente(ambiente).nome)
    : NAV_GROUPS;

  if (!open) {
    return <FaixaDeIcones location={location} grupos={grupos} ambiente={ambiente} contadores={contadores} paraOAssistente={paraOAssistente} />;
  }

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
    <aside className="hidden md:flex w-[19rem] bg-sidebar text-sidebar-foreground border-r border-sidebar-border shrink-0 flex-col sticky top-16 h-[calc(100dvh-4rem)]">
      <div className="overflow-y-auto flex-1">
        <SeletorDeUnidade ambiente={ambiente} />

        <nav className="px-4 pb-4 space-y-3">
          {grupos.map((grupo) => {
            const aberto = !recolhido(grupo.titulo);
            const contemAtivo = grupo.itens.some((item) => estaAtivo(location, item.href));
            const escondido = aberto
              ? 0
              : grupo.itens.reduce(
                  (soma, item) => soma + (item.contador ? contadores[item.contador] : 0),
                  0,
                );

            return (
              /*
                Cada seção é um cartão. O canto arredondado com `overflow-hidden`
                é o que deixa a barra marinho do cabeçalho ativo acompanhar a
                curva em vez de vazar dela.
              */
              <div
                key={grupo.titulo}
                className="rounded-xl border border-sidebar-border overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => alternar(grupo.titulo)}
                  aria-expanded={aberto}
                  aria-controls={idDaSecao(grupo.titulo)}
                  className={cn(
                    /*
                      A borda esquerda do cabeçalho existe nos dois estados, pela
                      mesma razão que a dos itens: nascer só quando a seção se
                      fecha empurraria o título quatro pixels a cada clique.
                    */
                    "w-full flex items-center gap-3 border-l-4 pl-[calc(1.125rem-4px)] pr-3.5 py-3.5 text-left text-[0.8125rem] font-bold uppercase tracking-[0.08em] transition-colors",
                    grupo.cor,
                    /*
                      Cartão fechado com a tela aberta dentro dele fica aceso —
                      barra marinho e fundo azul-claro: fechar uma seção é
                      escolher não ver a lista, e nunca deixar de saber onde se
                      está. Aberto, quem acende é o próprio item ativo.
                    */
                    !aberto && contemAtivo
                      ? "border-brand bg-sidebar-accent"
                      : "border-transparent hover:bg-muted",
                  )}
                >
                  <grupo.icon className="w-5 h-5 shrink-0" strokeWidth={2} />
                  <span className="flex-1 min-w-0 truncate">{grupo.titulo}</span>
                  {/*
                    O que a seção fechada esconde de trabalho vem para o
                    cabeçalho. Recolher é escolher não ver a lista; não é
                    autorização para o produto parar de dizer que há fila.
                  */}
                  {escondido > 0 && (
                    <span className="min-w-6 h-6 px-2 rounded-full bg-current text-[0.6875rem] font-bold flex items-center justify-center tabular-nums">
                      <span className="text-sidebar">{escondido > 99 ? "99+" : escondido}</span>
                    </span>
                  )}
                  <ChevronRight
                    className={cn(
                      "w-4 h-4 shrink-0 transition-transform",
                      aberto && "rotate-90",
                    )}
                  />
                </button>

                {aberto && (
                  <div
                    id={idDaSecao(grupo.titulo)}
                    className="border-t border-sidebar-border py-1"
                  >
                    {grupo.itens.map((item) => (
                      <ItemDoMenu
                        href={item.href === "/assistente" ? paraOAssistente : item.href}
                        key={item.href}
                        item={item}
                        ativo={estaAtivo(location, item.href)}
                        contagem={item.contador ? contadores[item.contador] : 0}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>

      {/*
        O rodapé é de quem entrou, e quem entrou é o mesmo nos dois ambientes —
        por isso ele fica, ao contrário do convite ao assistente que morava
        aqui e era da Auditoria.
      */}
      <RodapeDoUsuario />
    </aside>
  );
}

// ---------------------------------------------------------------------------
// A faixa de ícones
// ---------------------------------------------------------------------------

type Contadores = Record<NonNullable<NavItem["contador"]>, number>;

/**
 * A lateral recolhida pelo hambúrguer.
 *
 * **Ela encolhe; não desaparece.** Antes o hambúrguer removia a lateral inteira,
 * e o preço era alto para quem só queria ler uma tabela larga: com a lateral
 * fora, ir para a próxima tela custava trazê-la de volta, clicar e recolher de
 * novo. A faixa devolve 225px ao conteúdo e mantém todas as telas a um clique.
 *
 * O que sobrevive ao encolhimento, e por quê:
 *
 * - **A unidade aberta**, porque todo número da tela depende dela — some o nome,
 *   fica o alfinete, e o nome inteiro volta no rótulo ao passar o mouse.
 * - **Os contadores**, em bolinha sobre o ícone. Trabalho pendente não é
 *   detalhe de decoração para se perder na primeira economia de espaço.
 * - **Os grupos**, como linhas separadoras. A ordem dos ícones é a mesma da
 *   lista, então a mão que aprendeu o lugar de cada um continua acertando.
 *
 * Cada ícone tem `aria-label` além do rótulo visual: um link cujo conteúdo é só
 * um desenho não tem nome para quem usa leitor de tela.
 */
function FaixaDeIcones({
  location,
  grupos,
  ambiente,
  contadores,
  paraOAssistente,
}: {
  location: string;
  grupos: NavGroup[];
  ambiente: Ambiente;
  contadores: Contadores;
  /** O endereço do Assistente já com o recorte da tela de onde se clica. */
  paraOAssistente: string;
}) {
  return (
    <aside className="hidden md:flex w-16 bg-sidebar text-sidebar-foreground border-r border-sidebar-border shrink-0 flex-col sticky top-16 h-[calc(100dvh-4rem)]">
      <div className="overflow-y-auto flex-1 py-2">
        <UnidadeNaFaixa />

        {grupos.map((grupo, indice) => (
          <div
            key={grupo.titulo}
            className={cn("py-1.5", indice > 0 && "border-t border-sidebar-border")}
          >
            {grupo.itens.map((item) => (
              <IconeDaFaixa
                href={item.href === "/assistente" ? paraOAssistente : item.href}
                key={item.href}
                item={item}
                ativo={estaAtivo(location, item.href)}
                contagem={item.contador ? contadores[item.contador] : 0}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Mesma regra da lateral inteira: o atalho ao assistente é da Auditoria. */}
      {ambiente === "auditoria" && (
        <div className="p-2 border-t border-sidebar-border">
          <Rotulo texto="Pergunte ao FreightCheck">
            <Link
              href={paraOAssistente}
              aria-label="Pergunte ao FreightCheck"
              className="w-11 h-11 mx-auto rounded-lg border border-nav-inteligencia/30 bg-nav-inteligencia/[0.06] flex items-center justify-center hover:bg-nav-inteligencia/[0.12] transition-colors"
            >
              <Sparkles className="w-[1.125rem] h-[1.125rem] text-nav-inteligencia" />
            </Link>
          </Rotulo>
        </div>
      )}
    </aside>
  );
}

function IconeDaFaixa({
  item,
  href,
  ativo,
  contagem,
}: {
  item: NavItem;
  /** O endereço já resolvido — ver `enderecoDoAssistente`. Omitido, é o do item. */
  href?: string;
  ativo: boolean;
  contagem: number;
}) {
  return (
    <Rotulo texto={contagem > 0 ? `${item.label} · ${contagem}` : item.label}>
      <Link
        href={href ?? item.href}
        aria-label={contagem > 0 ? `${item.label}: ${contagem}` : item.label}
        aria-current={ativo ? "page" : undefined}
        className={cn(
          "relative flex items-center justify-center h-11 border-l-[3px] transition-colors",
          ativo
            ? "border-brand bg-sidebar-accent text-brand"
            : "border-transparent text-muted-foreground hover:bg-muted",
        )}
      >
        <item.icon className="w-[1.125rem] h-[1.125rem]" />
        {contagem > 0 && (
          <span
            className={cn(
              "absolute top-1.5 right-2 min-w-4 h-4 px-1 rounded-full text-[0.5625rem] font-bold flex items-center justify-center tabular-nums",
              item.contador === "alteracoes"
                ? "bg-brand text-brand-foreground"
                : "bg-warning text-warning-foreground",
            )}
          >
            {contagem > 99 ? "99+" : contagem}
          </span>
        )}
      </Link>
    </Rotulo>
  );
}

/** A unidade aberta, reduzida ao alfinete — o nome inteiro fica no rótulo. */
function UnidadeNaFaixa() {
  /*
    A consulta é a de `lib/contextos.ts`, e a `queryFn` daqui deixou de existir.

    Ela traduzia `!response.ok` em `[]`. Parecia inofensivo — a casca não deve
    mesmo mostrar erro —, e não era: a `queryFn` pertence ao **cache**, não ao
    componente, e esta chave é compartilhada com `pages/unidades.tsx`. Engolir
    aqui engolia para lá também, e foi assim que a API fora do ar virou "nenhuma
    vigência importada ainda" na tela que responde pela lista.

    O erro continua sem aparecer nesta faixa, mas agora por decisão de leitura:
    `useContextosDaCasca` entrega a lista e o estado, e quem desenha escolhe
    calar. Ver `layout/contadores.ts`, que já sufixava as chaves dele com
    "casca" justamente para não compartilhar cache com as telas.
  */
  const { contextos, indisponivel } = useContextosDaCasca();

  const atual = contextos[0];

  return (
    <div className="px-2 pb-2 mb-1 border-b border-sidebar-border">
      {/*
        "Nenhuma vigência importada" é afirmação sobre o acervo, e só vale
        quando o servidor respondeu. Sem resposta, a faixa diz que não sabe —
        calar é o que a casca deve fazer com uma falha, e mentir não é calar.
      */}
      <Rotulo
        texto={
          atual !== undefined
            ? `${unidadeDe(atual)} · ${detalheDe(atual)}`
            : indisponivel
              ? "Unidade indisponível no momento"
              : "Nenhuma vigência importada"
        }
      >
        <div className="w-11 h-11 mx-auto rounded-lg border border-sidebar-border flex items-center justify-center">
          <MapPin className="w-4 h-4 text-brand" />
        </div>
      </Rotulo>
    </div>
  );
}

/**
 * O nome que o ícone perdeu, de volta ao passar o mouse ou ao chegar pelo Tab.
 *
 * O fundo é o marinho quase preto do texto, e não o `--brand`: na faixa o rótulo
 * é a única forma de ler o nome do item, e um tooltip com a cor de ação se lê
 * como algo clicável, que ele não é. `--foreground` deixa branco em 15:1 e não
 * promete clique nenhum.
 */
function Rotulo({ texto, children }: { texto: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" className="bg-foreground text-background">
        {texto}
      </TooltipContent>
    </Tooltip>
  );
}

/** O `id` que o cabeçalho aponta em `aria-controls`. */
function idDaSecao(titulo: string): string {
  return `secao-${normalizar(titulo).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

/** Sem acento e sem caixa: o `id` não pode depender de como o título é escrito. */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * O item ativo é o da rota atual, e prefixo só conta abaixo da raiz — sem essa
 * exceção "/" ficaria aceso em toda tela do produto. A base de cada fechamento
 * é a raiz do ambiente dele e tem a mesma exceção pela mesma razão: todo
 * endereço daquele Fechamento começa com ela.
 *
 * A exceção de "/" continua aqui mesmo depois de a raiz ter deixado de ser item
 * de menu: ela custa uma comparação e é o que impede a lateral inteira de
 * acender no dia em que alguém reaproveitar "/" como href de algum item.
 */
export function estaAtivo(location: string, href: string): boolean {
  const raizes: string[] = ["/", ...Object.values(BASES_DE_FECHAMENTO)];
  if (raizes.includes(href)) return location === href;
  return location === href || location.startsWith(`${href}/`);
}

function ItemDoMenu({
  item,
  href,
  ativo,
  contagem,
}: {
  item: NavItem;
  /** O endereço já resolvido — ver `enderecoDoAssistente`. Omitido, é o do item. */
  href?: string;
  ativo: boolean;
  contagem: number;
}) {
  return (
    <Link
      href={href ?? item.href}
      aria-current={ativo ? "page" : undefined}
      className={cn(
        /*
          A borda esquerda existe nos dois estados — transparente quando o item
          está apagado — porque uma borda que só nasce no item aceso empurraria
          o texto três pixels para a direita a cada clique.
        */
        "flex items-center gap-3 border-l-[3px] pl-[calc(1.125rem-3px)] pr-3.5 py-2 text-sm transition-colors",
        ativo
          ? "border-brand bg-sidebar-accent text-brand font-semibold"
          : "border-transparent text-sidebar-foreground hover:bg-muted",
      )}
    >
      <item.icon
        className={cn("w-[1.125rem] h-[1.125rem] shrink-0", !ativo && "text-muted-foreground")}
      />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {/*
        O contador é o único enfeite que sobrou à direita do rótulo, e agora ele
        é o único que se lê.

        Aqui havia também a tarja "Novo". Ela nasceu para dezoito itens ao mesmo
        tempo, e é aí que ela se desfaz: uma tarja que aparece em metade da lista
        não distingue nada — vira uma segunda coluna de manchas que o olho
        aprende a pular, e leva o contador junto, porque ele mora no mesmo lugar
        e tem o mesmo formato. A que sobrou diz quanto trabalho há, que é a única
        informação daquela borda que muda de um dia para o outro.
      */}
      {contagem > 0 && <Contador valor={contagem} tipo={item.contador!} />}
    </Link>
  );
}

/**
 * A bolinha do número.
 *
 * Marinho em Alterações, laranja em Importações e Curadoria — e a diferença
 * não é enfeite: alteração é fato consumado da vigência aberta, e as outras
 * duas são fila de trabalho de quem está olhando. Cores iguais fariam as três
 * pedirem a mesma coisa.
 *
 * A distinção é a mesma de antes; o que mudou foi passar a dizê-la com as duas
 * cores que o resto da interface já usa nesse sentido. Fila de trabalho é
 * exatamente o que `--warning` marca em toda parte — algo aqui espera por você
 * —, e fato consumado é conteúdo do produto, que é o marinho. Antes o par era
 * vermelho e laranja, e vermelho aqui competia com o vermelho de prejuízo.
 */
function Contador({ valor, tipo }: { valor: number; tipo: NonNullable<NavItem["contador"]> }) {
  return (
    <span
      className={cn(
        "min-w-6 h-6 px-1.5 rounded-full text-[0.6875rem] font-bold flex items-center justify-center tabular-nums shrink-0",
        tipo === "alteracoes"
          ? "bg-brand text-brand-foreground"
          : "bg-warning text-warning-foreground",
      )}
    >
      {valor > 99 ? "99+" : valor}
    </span>
  );
}

// ---------------------------------------------------------------------------
// A unidade aberta
// ---------------------------------------------------------------------------

/**
 * O que a barra lateral diz sobre unidade — e são duas coisas diferentes.
 *
 * Na Auditoria, a unidade aberta: a pergunta de lá é sobre uma série, e o
 * cartão diz de qual. No Fechamento, o alcance: a quinzena é de várias
 * unidades, e afirmar uma seria afirmar um recorte que nenhuma tela honra.
 *
 * **Os dois ramos são componentes, e não um `if` dentro de um.** O da
 * Auditoria chama `useSearch` e `useContextosDaCasca`; o do Fechamento não
 * chama nenhum dos dois, e a barra lateral não remonta ao navegar entre os
 * ambientes. Um
 * `return` antecipado antes dos hooks mudaria a ordem deles no meio da vida do
 * componente, que é o erro que o React não perdoa.
 */
function SeletorDeUnidade({ ambiente }: { ambiente: Ambiente }) {
  return ehFechamento(ambiente) ? <AlcanceDoFechamento /> : <UnidadeAberta />;
}

/**
 * O Fechamento não tem unidade aberta — e o cartão passou a dizer isso.
 *
 * Ele mostrava uma unidade, a da URL ou a mais recente, como se o ambiente
 * estivesse preso a ela. Não está: das dez telas do Fechamento, oito nunca
 * mencionam `scopeHash`, e as duas que mencionam são a lista de unidades, que
 * monta um link por linha, e o cadastro de uma unidade, que lê o parâmetro da
 * URL depois do clique. Nenhuma delas lia este cartão.
 *
 * A justificativa antiga era que "todo número do fechamento também depende
 * dela", e ela deixou de valer: quem fecha a quinzena fecha as trinta, não
 * uma. Um cartão que afirma um recorte que nenhuma tela honra não é decoração
 * inofensiva — este foi lido, em uso, como "só consigo cadastrar a planilha de
 * CAMAÇARI porque estou nela", que é a conclusão errada sobre uma tela que
 * sempre listou todas.
 *
 * Nada aqui lê `/contexts`, e não é só economia de uma chamada: o que ele
 * mostrasse a partir dela seria de novo uma unidade escolhida por quem não vai
 * usá-la. Uma contagem também não serve — tirada do acervo, ela passaria a
 * mentir por baixo no dia em que existir unidade cadastrada à mão, que não tem
 * vigência importada para ser contada.
 */
function AlcanceDoFechamento() {
  return (
    <div className="p-4 pb-3">
      <div className="text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-muted-foreground mb-2.5">
        Alcance
      </div>
      <CaixaDaUnidade
        icone={Layers}
        titulo="Todas as unidades"
        detalhe={
          "O Fechamento não se prende a uma: cada tela lista as unidades que existem, e " +
          "você escolhe na linha."
        }
      />
    </div>
  );
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
function UnidadeAberta() {
  const search = useSearch();
  // A mesma consulta única de `lib/contextos.ts` — ver `UnidadeNaFaixa`.
  const { contextos, carregando, indisponivel } = useContextosDaCasca();
  /*
    Qual contexto está aberto: o que a URL pede, quando pede. Fora de Parâmetros
    ninguém pede, e o produto lê o mais recente — que é a ordem que `/contexts`
    já devolve.
  */
  const pedido = new URLSearchParams(search).get("scopeHash");
  const atual = contextos.find((c) => c.scopeHash === pedido) ?? contextos[0];

  return (
    <div className="p-4 pb-3">
      <div className="text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-muted-foreground mb-2.5">
        Unidade atual
      </div>

      {atual === undefined ? (
        /*
          Três estados, e não dois. Carregando, indisponível e vazio de verdade
          diziam todos "Nenhuma vigência importada" — o do meio é falso, e era o
          que a casca escrevia enquanto a API estava fora do ar.
        */
        <CaixaDaUnidade
          titulo={
            carregando
              ? "Carregando…"
              : indisponivel
                ? "Não foi possível ler as unidades"
                : "Nenhuma vigência importada"
          }
          detalhe={
            carregando
              ? ""
              : indisponivel
                ? "A lista volta sozinha quando a chamada completar."
                : "Envie a primeira planilha em Importações para abrir uma unidade."
          }
        />
      ) : contextos.length === 1 ? (
        <CaixaDaUnidade
          titulo={unidadeDe(atual)}
          detalhe={canalDe(atual)}
          vigencia={mesAbreviado(atual.latestPeriod)}
        />
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger className="w-full text-left rounded-xl border border-sidebar-border bg-sidebar p-3.5 hover:border-brand transition-colors">
            <CaixaDaUnidade
              titulo={unidadeDe(atual)}
              detalhe={canalDe(atual)}
              vigencia={mesAbreviado(atual.latestPeriod)}
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
  vigencia,
  seta,
  semMoldura,
  icone: Icone = MapPin,
}: {
  titulo: string;
  detalhe: string;
  /** `ago/2026` — vira a etiqueta com o calendário. Sem vigência, sem etiqueta. */
  vigencia?: string;
  seta?: boolean;
  semMoldura?: boolean;
  /**
   * O desenho dentro do círculo. O alfinete diz "você está aqui", e é por isso
   * que ele não serve ao Fechamento: lá não se está em unidade nenhuma.
   */
  icone?: typeof MapPin;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3",
        !semMoldura && "rounded-xl border border-sidebar-border p-3.5",
      )}
    >
      {/*
        O alfinete ganhou um círculo azul-claro atrás: é o mesmo desenho do
        cartão de seção aceso, e diz a mesma coisa — este é o lugar onde você
        está.
      */}
      <span className="w-12 h-12 rounded-full bg-sidebar-accent flex items-center justify-center shrink-0">
        <Icone className="w-5 h-5 text-brand" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block font-bold truncate",
            /*
              O nome da unidade fala alto — caixa alta e corpo grande — mas só
              ele: "Carregando…" e "Nenhuma vigência importada" gritados em
              maiúsculas leriam como erro, e não como estado.
            */
            vigencia !== undefined ? "text-lg leading-tight uppercase tracking-wide" : "text-sm",
          )}
        >
          {titulo}
        </span>
        {/*
          O detalhe quebra em vez de cortar: aqui mora tanto o canal, que cabe,
          quanto a frase que explica um banco sem vigência nenhuma — e essa,
          cortada em "Envie a primeira planilha em Importações…", perde
          justamente a instrução.
        */}
        {detalhe !== "" && (
          <span className="block text-[0.8125rem] leading-snug text-muted-foreground tracking-wide">
            {detalhe}
          </span>
        )}
        {vigencia !== undefined && (
          <span className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground">
            <CalendarDays className="w-3.5 h-3.5" />
            {vigencia}
          </span>
        )}
      </span>
      {seta && <ChevronDown className="w-4 h-4 shrink-0 mt-1 text-muted-foreground" />}
    </div>
  );
}

/** O nome da unidade; sem escopo cadastrado sobra o rótulo que o servidor montou. */
export function unidadeDe(contexto: Contexto): string {
  const unidade = contexto.scopes.find((s) => s.scopeType === "UNIDADE");
  return unidade?.name ?? unidade?.code ?? contexto.label;
}

/** O canal do rótulo — a linha sob o nome da unidade. */
function canalDe(contexto: Contexto): string {
  return contexto.channel ?? "sem canal no rótulo";
}

/** `EMPURRADA · ago/2026` — canal e vigência numa linha, para rótulo e menu. */
export function detalheDe(contexto: Contexto): string {
  return `${canalDe(contexto)} · ${mesAbreviado(contexto.latestPeriod)}`;
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
 * Quem entrou, no pé da lateral.
 *
 * Fica fora da área que rola, colado embaixo. O convite ao assistente que
 * morava aqui saiu no redesenho dos cartões: o assistente continua a um clique,
 * dentro de **Inteligência**, e o pé passou a responder a pergunta que sobrava
 * sem lugar no menu — *como quem estou vendo estes números?* O par
 * Configurações/Sair é o mesmo do menu da faixa vermelha, ao alcance de onde o
 * olho já está quando navega.
 *
 * A segunda linha é o e-mail, não um papel: este produto deliberadamente não
 * tem papéis — ver o comentário de `lib/db/src/schema/auth.ts` — e escrever
 * "Administrador" aqui prometeria uma permissão que o sistema não confere.
 */
function RodapeDoUsuario() {
  const { user, logout, isSubmitting } = useAuth();

  if (!user) return null;

  return (
    <div className="p-4 border-t border-sidebar-border">
      <DropdownMenu>
        <DropdownMenuTrigger className="w-full flex items-center gap-3 rounded-lg p-1.5 -m-1.5 text-left hover:bg-muted transition-colors">
          <span className="w-10 h-10 rounded-full bg-brand text-brand-foreground text-sm font-bold flex items-center justify-center shrink-0">
            {iniciaisDe(user.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold truncate">{user.name}</span>
            <span className="block text-xs text-muted-foreground truncate">{user.email}</span>
          </span>
          <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-64">
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
    </div>
  );
}

/** `Guy Peixoto` → `GP`; nome de uma palavra só rende uma letra. */
function iniciaisDe(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primeira = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return `${primeira}${ultima}`.toUpperCase();
}
