import {
  ArrowRightLeft,
  BadgeCheck,
  Bot,
  Briefcase,
  Calculator,
  CalendarDays,
  ChartColumn,
  CircleDollarSign,
  Compass,
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
  GitCompareArrows,
  HardHat,
  Headset,
  History,
  House,
  Layers,
  LayoutDashboard,
  Plug,
  Radar,
  Receipt,
  RefreshCcwDot,
  Route,
  Scale,
  ScanSearch,
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
  Workflow,
  type LucideIcon,
} from "lucide-react";
import {
  DASHBOARD,
  ENTRADA_DA_AUDITORIA,
  IMPACTO_APURADO,
  EVOLUCAO_POR_PLACA,
  LINHA_DO_TEMPO,
  PANORAMA,
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
 * A lateral do ambiente Auditoria — as dez seções, e a ordem em que se lê o
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
 * A ordem é a de uma auditoria completa, de cima para baixo: abre-se o dia pelo
 * que a fila da Ambev fez desde ontem e pela justificativa de cada mudança
 * (**Chamados Ambev**, o cartão que reúne o monitoramento, a conciliação com a
 * planilha, a fila de justificativas e o painel de cobertura dela), vê-se a
 * vigilância e o retrato
 * do conjunto (**Visão executiva**, que reúne os dois desde que as duas seções
 * viraram uma), libera-se o que precisa ser comprado
 * hoje (**Compras**), procura-se o desvio (**Auditoria**), cobra-se o desvio achado
 * (**Processos**), confere-se o quadro de gente que o modelo remunera
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
        CHAMADOS AMBEV abre a lista porque é por onde o dia começa — e é um
        cartão só desde que as justificativas vieram morar aqui dentro.

        **Eram duas seções.** "Justificativas" — a fila de mesa onde se
        registra, placa a placa, por que a vigência mudou — abria a lateral, e
        os chamados que a Ambev exporta vinham logo abaixo, num cartão de um
        item só. A separação tinha razão de população, e a população continua
        sendo outra: aqui é `ticket`, o export do Freightech que a Ambev manda
        por unidade; ali é `change` e `justificativa`, a alteração de vigência
        por placa.

        O que mudou é que a diferença não valia um segundo cartão. As telas
        são o mesmo trabalho da manhã — abrir o que a fila da Ambev fez desde
        ontem e responder por isso —, e quem trabalha nelas alternava entre dois
        cartões vizinhos para percorrer um único caminho. Um cartão de item
        único no topo da lateral, colado a outro do mesmo assunto, é divisão que
        o menu cobra e ninguém usa.

        **A ordem dentro dela é a do caminho**: o monitoramento primeiro, que é
        o que mudou nos chamados desde a última importação; a conciliação em
        seguida, onde se confere se o que mudou nos chamados é o que mudou na
        planilha; depois a fila, onde se justifica o que mudou; e o painel por
        último, onde se confere o que ainda falta justificar.

        **Continua sem o atalho de importar chamados, e o motivo é a chave de
        permissão.** A tela de importação existe (`/importacoes?secao=chamados`),
        e um atalho para ela aqui pareceria natural — mas a chave de permissão
        de um item é o `href` (`lib/permissoes.ts`), e
        `/importacoes?secao=chamados` seria uma chave **diferente** de
        `/importacoes`: desligar Importações não desligaria o atalho, e quem
        administrasse acessos veria dois módulos onde há uma tela. Um atalho que
        fura o controle de acesso não é conveniência.
      */
      titulo: "Chamados Ambev",
      descricao:
        "O que mudou nos chamados, se bate com a planilha, e a justificativa de cada mudança",
      icon: Headset,
      cor: "text-nav-chamados",
      itens: [
        /*
          O item chama-se **"Monitoramento"**, e não "Monitoramento de
          Chamados": o cartão em que ele vive já diz "Chamados Ambev" logo
          acima, e repetir o assunto no item fazia o rótulo estourar a largura
          da lateral — quem abria o menu lia "Monitoramento de Chama…", que é
          justamente a parte redundante ocupando o espaço da parte que
          distingue. O endereço (`/monitoramento-de-chamados`) não mudou: ele é
          a chave de permissão do módulo (`lib/permissoes.ts`) e trocá-lo
          desligaria o acesso de quem já o tem.
        */
        {
          href: "/monitoramento-de-chamados",
          label: "Monitoramento",
          icon: Headset,
        },
        /*
          A Conciliação vem **colada** no Monitoramento porque é a pergunta
          seguinte à dele, e sobre o mesmo material: o Monitoramento diz o que
          mudou nos chamados desde o último envio; a Conciliação pergunta se o
          que mudou nos chamados é o que mudou na planilha de vigência — para
          cada alteração que a planilha trouxe, existe o chamado que a pediu?

          Ela é a única tela do produto que confronta as duas superfícies. É de
          propósito que fique aqui e não na Auditoria: quem abre a seção de
          manhã já está com os dois lados na cabeça, e a resposta que ela dá é
          sobre a fila da Ambev — não sobre a vigência.

          **Confrontar não é somar.** O impacto do chamado continua nunca sendo
          adicionado ao da planilha; a tela põe os dois lado a lado e diz se
          batem, que é o oposto de fundi-los.
        */
        {
          href: "/conciliacao-de-chamados",
          /*
            **"Conciliação"**, curto, pela mesma razão do item acima: o cartão
            já diz "Chamados Ambev", e o rótulo longo gastaria na repetição o
            espaço da palavra que distingue. O endereço continua inteiro, que é
            a chave de permissão.
          */
          label: "Conciliação",
          icon: Scale,
        },
        { href: "/justificativas", label: "Justificativas", icon: FileCheck2 },
        /*
          O painel vem **depois** da fila, e não antes: a fila é onde se
          trabalha, o painel é onde se confere. Quem abre a seção todo dia vem
          justificar; quem vem cobrar o que falta é quem desce um item.
        */
        {
          href: "/painel-de-justificativas",
          label: "Painel de Justificativas",
          icon: ClipboardList,
        },
      ],
    },
    {
      /*
        A Visão executiva vem logo depois dos Chamados, e é a seção inteira
        da leitura executiva: o que a Ambev mudou de uma vigência para a outra
        **e** o retrato do que existe hoje — o acervo, a unidade, o histórico
        dela e o valor apurado.

        Eram duas seções, Dashboard e Visão executiva, e viraram uma — e o nome
        que ficou é o da leitura, não o do primeiro módulo dela: "Dashboard"
        dizia o formato da tela, e quem procura na lateral procura o assunto.
        A divisão
        não era de assunto, era de história: os dois módulos de vigilância
        nasceram depois das telas executivas e ganharam cartão próprio ao lado
        delas. Quem chega, porém, lê tudo isto na mesma sentada — quanto a
        vigência custou, como está a unidade, como chegou até aqui, de onde vem
        o valor —, e dois cartões para uma leitura só escondiam metade dela
        atrás de um segundo clique.

        A ordem, desde o Panorama, é a da **altitude da leitura**: primeiro a
        tela que responde tudo de uma vez, depois o acervo inteiro, depois os
        quatro módulos que aprofundam um andar do Panorama cada um, e por fim as
        telas que descem ao valor (Acompanhamento, Composição e DRE).
      */
      titulo: "Visão executiva",
      descricao: "O que mudou desde a última competência, e o retrato do conjunto",
      icon: Radar,
      cor: "text-nav-executiva",
      itens: [
        /*
          O **Panorama Executivo** abre a seção, e é o quinto módulo dela.

          Os quatro que vinham aqui — Impacto Líquido, Impacto Apurado, Resumo
          executivo e Linha do Tempo — liam a mesma resposta do servidor, sob as
          mesmas chaves de cache, e publicavam três blocos idênticos nos quatro.
          Não eram quatro perguntas: eram quatro formatos, cada um herdado de um
          momento diferente da história do produto, e nenhum desenhado contra os
          outros três. `docs/PROPOSTA-PANORAMA-EXECUTIVO.md` mede essa
          sobreposição nos arquivos e mostra onde ela deixou de ser desperdício e
          virou risco — duas coberturas com nome parecido, populações diferentes,
          o mesmo anel e a mesma régua de cor em dois módulos vizinhos.

          O Panorama responde às sete perguntas numa tela só, na ordem em que uma
          diretoria as faz. Ele vem primeiro porque é a leitura que serve a quem
          abre a seção sem saber ainda o que procura — e os quatro continuam logo
          abaixo, para quem já sabe.
        */
        { href: PANORAMA, label: "Panorama Executivo", icon: Compass },
        /*
          O Painel de Unidades vem em segundo porque é a única leitura **mais
          alta** que o Panorama: ele responde pelo ano inteiro, unidade a unidade,
          e por onde falta auditar; o Panorama responde por uma vigência. São
          eixos diferentes, e por isso os dois ficam colados no topo — é a mesma
          escada da lateral do Fechamento, onde a Visão Gerencial também abre.

          `/` continua encaminhando para ele quando chega sem recorte, e para o
          Resumo executivo quando chega com recorte. Ver `destinoDaRaiz`, em
          `lib/ambiente.ts`: é essa segunda regra que mantém vivo todo endereço
          guardado, e mudá-la agora quebraria links que ninguém pediu para
          quebrar.
        */
        { href: ENTRADA_DA_AUDITORIA, label: "Painel de Unidades", icon: LayoutDashboard },
        /*
          Daqui para baixo vêm os quatro módulos que o Panorama consolida, **e
          eles ficam**. É a decisão do caminho B da proposta: o Panorama entra
          como porta, e os quatro assumem a função que já exerciam de fato — a
          exploração detalhada de um andar dele.

          Ficam pelos endereços, antes de tudo. `/dashboard`, `/impacto-apurado`,
          `/resumo-executivo` e `/linha-do-tempo` são o produto em uso: favoritos,
          links colados em e-mail, o histórico de quem trabalha nisto todo dia.
          Aposentá-los é o destino declarado, e não o primeiro passo — sem medida
          de uso não se sabe qual dos quatro alguém abre toda manhã.

          A ordem entre eles é a de antes, e cada um aprofunda um andar:

          - **Impacto Líquido** — a exploração do que mudou, andar 2 e 5;
          - **Impacto Apurado** — a decomposição do valor, andar 1 e 3;
          - **Resumo executivo** — o retrato da unidade, andar 2 e 7;
          - **Linha do Tempo** — o histórico, andar 4, e o único que sabe trocar
            a população inteira por tipo de ativo (cavalo, carreta, trecho), que
            é a razão de o Panorama linkar para cá em vez de embutir a pastilha.
        */
        { href: DASHBOARD, label: "Impacto Líquido", icon: Radar },
        { href: IMPACTO_APURADO, label: "Impacto Apurado", icon: CircleDollarSign },
        { href: RESUMO_EXECUTIVO, label: "Resumo executivo", icon: House },
        { href: LINHA_DO_TEMPO, label: "Linha do Tempo", icon: History },
        /*
          A Evolução por Placa vem colada na Linha do Tempo porque é a mesma
          leitura vista de lado: as duas percorrem o mesmo intervalo, uma
          agrupando por vigência e a outra por ativo. Quem está lendo "julho
          custou R$ 20 mil" pergunta em seguida "em quais placas?", e é este o
          item que responde — daí a vizinhança, e não uma seção nova.
        */
        { href: EVOLUCAO_POR_PLACA, label: "Evolução por Placa", icon: Truck },
        { href: "/vigencia", label: "Acompanhamento", icon: TrendingUp },
        /*
          A Análise de frota saiu daqui e passou a abrir a seção **Frota**, ao lado
          das telas que descem ao ativo: é o mesmo assunto lido de duas alturas, e
          o olho procura as duas no mesmo bloco.

          A Composição ficou. Ela continua sendo o drill-down da análise — a
          análise diz como a frota se comporta, e a composição responde, para um
          equipamento, por que ele recebe o que recebe —, mas mora na leitura
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
        Processos é seção própria, e não a cauda da Auditoria, porque é outro
        trabalho e quase sempre outra pessoa: auditar é descobrir, desenhar o
        processo é dizer como se trabalha. Quem passa o dia numa das duas fecha
        a outra.

        A seção tinha três telas em preparo — Contestação & Recuperação,
        Reconciliação e Risco & Materialidade — e elas saíram junto com as
        entradas de `pages/telas-em-preparo.ts` que as sustentavam: um menu que
        anuncia três telas e entrega três avisos de "ainda não" é ruído para
        quem trabalha aqui todo dia. Voltam quando forem telas de verdade.
      */
      titulo: "Processos",
      descricao: "O mapa dos processos da empresa",
      icon: RefreshCcwDot,
      cor: "text-nav-recuperacao",
      itens: [
        /*
          Fluxos Operacionais saiu da Administração: o mapa dos processos não é
          cadastro da casa, é o desenho do trabalho. O endereço continua sem
          prefixo, como o resto desta lista: é o roteador aninhado que põe a
          base do ambiente na frente (`App.tsx`), e `/fluxos` está no mesmo
          `Switch` das outras telas da auditoria.
        */
        { href: "/fluxos", label: "Fluxos Operacionais", icon: Workflow },
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
          O Rastreio de Dados vem logo depois de Importações porque é a conferência
          dela: a pergunta que ele faz — toda célula que o arquivo trouxe chegou a
          algum lugar? — só existe a respeito do arquivo que acabou de entrar.
        */
        { href: "/rastreio-de-dados", label: "Rastreio de Dados", icon: Scale },
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
        /*
          Integrações fecha a seção, abaixo dos Logs, e a posição é a do assunto:
          é a porta pela qual o dado pode entrar sem passar por Importações — e
          por onde outro sistema pode ler o que apuramos. Fica em Dados &
          governança, e não na Administração, porque o que se governa aqui é o
          **material**: quem escreve no acervo, com que credencial e o que já
          escreveu. Conta e senha de gente é a casa; chave de máquina é dado.

          Vem por último porque é a leitura mais rara da seção: quem abre esta
          tela ou está configurando uma integração nova, ou veio conferir por que
          a de ontem parou.
        */
        { href: "/integracoes", label: "Integrações", icon: Plug },
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
 * o **Radar de Trechos** só entra onde há trecho — hoje, só na Empurrada: ele é
 * a camada gerencial acima do Trecho 360° — "de centenas, quais preciso olhar"
 * —, e num ambiente sem trecho ele seria um veredito sobre uma população vazia.
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
