import {
  ArrowRightLeft,
  BadgeCheck,
  Bot,
  Briefcase,
  Calculator,
  CalendarDays,
  ChartColumn,
  ChartNoAxesCombined,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  CloudDownload,
  Container,
  Database,
  FileCheck2,
  FileSearch,
  FileSpreadsheet,
  FileText,
  FolderTree,
  Forklift,
  Gauge,
  Gavel,
  GitCompareArrows,
  Handshake,
  HardHat,
  History,
  House,
  Layers,
  LayoutDashboard,
  Radar,
  Receipt,
  RefreshCcwDot,
  Route,
  Scale,
  ScanSearch,
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
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import {
  DASHBOARD,
  ENTRADA_DA_AUDITORIA,
  LINHA_DO_TEMPO,
  RESUMO_EXECUTIVO,
  type AmbienteDeAuditoria,
} from "@/lib/ambiente";
import {
  EQUIPAMENTOS_DO_AMBIENTE,
  TELA_DO_EQUIPAMENTO,
  temTrecho,
  type Equipamento,
} from "@/lib/frota";
import { GRUPO_ADMINISTRACAO } from "./nav-administracao";
import type { NavGroup } from "./nav";

/**
 * A lateral do ambiente Auditoria — as onze seções, e a ordem em que se lê o
 * trabalho de um dia.
 *
 * A lista morava em `sidebar.tsx`, como constante, e saiu de lá pela mesma razão
 * que a do Fechamento mora em `nav-fechamento.ts`: **agora ela é uma função**,
 * porque agora há quatro auditorias. Empurrada, Rota, AS e Apoio são o mesmo
 * processo sobre operações diferentes (`lib/ambiente.ts`), e por isso a lateral
 * das quatro é a mesma lateral: as mesmas seções, na mesma ordem, com os mesmos
 * rótulos e os mesmos endereços. Quatro listas escritas à mão divergiriam no
 * primeiro item que alguém acrescentasse a uma e esquecesse nas outras.
 *
 * **O que muda entre elas é uma seção só: a Frota.** É ali que a operação
 * aparece — cavalo e carreta na empurrada, caminhão e carroceria na rota e no
 * AS, empilhadeira no apoio, que não puxa carreta nem roda trecho. E muda
 * porque o ativo é outro, não porque o nome é outro: ver
 * `EQUIPAMENTOS_DO_AMBIENTE`, em `lib/frota.ts`, onde essa distinção está
 * escrita por extenso.
 *
 * **Os endereços continuam sem prefixo, e isso é o desenho, não um esquecimento.**
 * `/alteracoes` é `/alteracoes` nas quatro; quem põe `/auditoria-rota` na frente
 * é o roteador aninhado do wouter (`App.tsx`), na hora de resolver o link. É o
 * que permite a esta lista ser uma só, e é o que impede a regressão silenciosa
 * que `lib/base-do-fechamento.ts` descreve do outro lado — um `href` literal que
 * devolve para a Empurrada quem clicou dentro do Rota.
 *
 * A ordem é a de uma auditoria completa, de cima para baixo: vê-se a vigilância
 * (**Dashboard**), o retrato (**Visão executiva**), libera-se o que precisa ser
 * comprado hoje (**Compras**), registra-se o que mudou (**Plano de Ação**),
 * procura-se o desvio (**Auditoria**), cobra-se o desvio achado
 * (**Recuperação**), confere-se o quadro de gente que o modelo remunera
 * (**QLP**), desce-se ao ativo que o sofreu (**Frota**), pergunta-se ao
 * assistente o que sobrou (**Inteligência**), e por baixo de tudo estão o
 * material (**Dados & governança**) e a casa (**Administração**).
 *
 * A regra antiga da lateral continua acima de tudo: **nenhum item daqui leva a
 * lugar nenhum, e nenhum leva a um número inventado.** Os itens que ainda não
 * têm tela abrem uma página que diz o que falta no banco para respondê-los e
 * para onde ir enquanto isso — ver `pages/telas-em-preparo.ts`.
 */
export function navGroupsAuditoria(ambiente: AmbienteDeAuditoria): NavGroup[] {
  return [
    {
      /*
        O Dashboard abre a lista, na frente da Visão executiva: é a tela de
        vigilância — o que a Ambev mudou de uma vigência para a outra, antes de
        se aprofundar em qualquer outra ferramenta. Um item só, como Compras:
        quem entra aqui vem checar mudança, não navegar uma seção inteira.
      */
      titulo: "Dashboard",
      descricao: "O que mudou desde a última competência, antes de tudo",
      icon: Radar,
      cor: "text-nav-executiva",
      itens: [{ href: DASHBOARD, label: "Dashboard", icon: Radar }],
    },
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
        { href: ENTRADA_DA_AUDITORIA, label: "Painel de Unidades", icon: LayoutDashboard },
        { href: RESUMO_EXECUTIVO, label: "Resumo executivo", icon: House },
        /*
          A Linha do tempo vem logo abaixo do Resumo executivo: era um cartão
          dentro dele ("Impacto líquido ao longo do tempo") e virou tela
          própria, porque a pergunta que responde — como o impacto se moveu
          vigência a vigência, e o que mudou em cada uma — é uma leitura de
          todo o histórico, e não do instante atual que o Resumo executivo
          mostra.
        */
        { href: LINHA_DO_TEMPO, label: "Linha do Tempo", icon: History },
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
      /*
        Plano de Ação fica logo depois de Compras porque é o mesmo tipo de
        trabalho de mesa: alguém olhou o que mudou de uma vigência para a outra
        e precisa registrar, placa a placa, por que aquilo mudou — antes de a
        alteração seguir para Auditoria ou Recuperação.
      */
      titulo: "Plano de Ação",
      descricao: "O que mudou por placa, e a justificativa de cada mudança",
      icon: FileCheck2,
      cor: "text-nav-plano-de-acao",
      itens: [{ href: "/justificativas", label: "Justificativas", icon: FileCheck2 }],
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
    /*
      A Frota é a única seção que a operação muda — ver `secaoDaFrota`, no fim
      deste arquivo.
    */
    secaoDaFrota(ambiente),
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
    /*
      A casa fecha a lista, e é a mesma lista que fecha a lateral do Fechamento —
      ver `nav-administracao.ts`. O grupo saiu daqui para lá quando deixou de ser
      exclusivo da Auditoria: unidades, usuários e ajustes da instalação são o que
      os três ambientes consomem, e escondê-los ao trocar de ambiente tirava da
      mão de quem fecha a competência o cadastro de que o fechamento depende.
    */
    GRUPO_ADMINISTRACAO,
  ];
}

/**
 * O ícone de cada ativo — o desenho que o olho reconhece antes do rótulo.
 *
 * Mora aqui, e não em `TELA_DO_EQUIPAMENTO`, porque é escolha de menu:
 * `lib/frota.ts` é vocabulário puro, sem React e sem lucide, e é o que permite
 * testá-lo sem montar tela nenhuma.
 */
const ICONE_DO_EQUIPAMENTO: Record<Equipamento, LucideIcon> = {
  CAVALO: Tractor,
  CARRETA: Container,
  CAMINHAO: Truck,
  CARROCERIA: Container,
  EMPILHADEIRA: Forklift,
  /*
    O trecho não é veículo, e o ícone diz isso: entre dois desenhos de metal, um
    terceiro caminhão faria a entrada parecer um terceiro equipamento — quando o
    que ela traz é o outro lado da conta, o variável que se paga por rodar.
  */
  TRECHO: Route,
};

/**
 * A seção **Frota** — a única que muda de uma auditoria para outra.
 *
 * Ela reúne as duas alturas da mesma pergunta: a Análise de frota olha a
 * categoria, e as telas 360° olham o ativo individual. Por isso abre pela
 * análise — lê-se a frota inteira, e só então se desce à placa —, e por isso o
 * ícone da seção é o do ativo que a operação usa: o olho reconhece o assunto
 * antes de ler o rótulo, e no Apoio o assunto é uma empilhadeira.
 *
 * As telas 360° saem de `EQUIPAMENTOS_DO_AMBIENTE`, na ordem em que estão lá, e
 * o **Radar de Trechos** só entra onde há trecho: ele é a camada gerencial acima
 * do Trecho 360° — "de centenas, quais preciso olhar" —, e num ambiente sem
 * trecho ele seria um veredito sobre uma população vazia.
 */
function secaoDaFrota(ambiente: AmbienteDeAuditoria): NavGroup {
  const equipamentos = EQUIPAMENTOS_DO_AMBIENTE[ambiente];

  return {
    titulo: "Frota",
    descricao: "Do comportamento da frota à placa",
    icon: equipamentos.includes("EMPILHADEIRA") ? Forklift : Truck,
    cor: "text-nav-frota",
    itens: [
      { href: "/analise-equipamentos", label: "Análise de frota", icon: Truck },
      ...equipamentos.map((equipamento) => ({
        href: TELA_DO_EQUIPAMENTO[equipamento].href,
        label: TELA_DO_EQUIPAMENTO[equipamento].titulo,
        icon: ICONE_DO_EQUIPAMENTO[equipamento],
      })),
      ...(temTrecho(ambiente)
        ? [{ href: "/radar-trechos", label: "Radar de Trechos", icon: Gauge }]
        : []),
      { href: "/dre-veiculo", label: "DRE do veículo", icon: FileSpreadsheet },
      { href: "/benchmark-unidades", label: "Benchmark de unidades", icon: ChartColumn },
    ],
  };
}
