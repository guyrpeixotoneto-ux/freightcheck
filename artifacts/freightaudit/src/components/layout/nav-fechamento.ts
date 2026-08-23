import {
  BadgeCheck,
  CalendarDays,
  Calculator,
  ClipboardCheck,
  FileSpreadsheet,
  History,
  House,
  ListTodo,
  Lock,
  PenLine,
  Scale,
  ScrollText,
  Stamp,
  Table2,
} from "lucide-react";
import type { NavGroup } from "./nav";

/**
 * A lateral do ambiente Fechamento.
 *
 * O Fechamento de Remuneração é um processo com começo, meio e fim: abre-se a
 * competência, apura-se quanto a remuneração daquela quinzena/mês vale,
 * resolve-se o que impede a conta de fechar, decide-se sobre o que sobrou, e
 * fecha-se o período — que então vira registro. Quatro das cinco seções são
 * esses quatro momentos, na ordem em que o trabalho acontece, pela mesma razão
 * que as oito da Auditoria seguem a ordem de uma auditoria completa.
 *
 * **Remuneração entrou depois, e entrou no meio.** Ela não é um momento do
 * processo: é a base contra a qual o processo roda — as alíquotas, o tamanho da
 * frota, quanto vale cada parcela por veículo. Fica entre Fechamento e Apuração
 * porque é essa a ordem de quem trabalha: abre-se o período e recebem-se os
 * relatórios, confere-se o cadastro da unidade, e só então se apura. Não foi
 * para o topo porque a primeira linha da lateral é a home do ambiente, e
 * trocá-la faria "voltar ao início" deixar de ser o primeiro item.
 *
 * O desenho partiu da lista pedida (Visão, Competência, Pendências, Apuração,
 * Conferências, Ajustes, Aprovações, Fechamento, Histórico) com três mudanças
 * deliberadas:
 *
 * 1. **A ordem dentro da apuração é Apuração → Pendências → Conferências**, e
 *    não Pendências antes da Apuração: pendência é o que a apuração não
 *    conseguiu apurar — sem rodar a conta primeiro, não há o que estar
 *    pendente. A tela de Pendências é a fila de trabalho que a Apuração
 *    produz, e a de Conferências é a prova de que o que foi apurado se
 *    sustenta.
 * 2. **A primeira seção chama-se "Fechamento", e o ato final, "Encerramento"**:
 *    o nome do processo fica onde o processo começa, e o item que o conclui não
 *    pode levá-lo também — o menu diria a mesma palavra duas vezes com dois
 *    sentidos. Encerrar é o ato: conferido e aprovado, congela-se a
 *    competência.
 * 3. **A lista de competências chama-se "Importações"**: o que se faz nela é
 *    abrir o período e enviar os relatórios que a Ambev exporta na
 *    quinzena. A lista é o que sobra depois de importar; nomear a tela por ela
 *    escondia o gesto que a enche.
 *
 * Nenhum item tem `contador` ainda: contador sem fila de verdade atrás é
 * bolinha decorativa, e a regra da lateral — nenhum número inventado — vale
 * aqui desde o primeiro dia.
 */
/**
 * A lista é uma função, e não uma constante, porque há dois fechamentos.
 *
 * Rota e Empurrada são o mesmo processo sobre operações diferentes
 * (`lib/ambiente.ts`), e por isso a lateral dos dois é a mesma lateral: as
 * mesmas cinco seções, na mesma ordem, com os mesmos rótulos. O que muda é a
 * base dos endereços — e o nome da primeira seção, que é onde o menu diz em
 * qual dos dois se está. Duas listas escritas à mão divergiriam no primeiro
 * item que alguém acrescentasse a uma e esquecesse na outra; uma função sobre
 * a base não tem como divergir.
 */
export function navGroupsFechamento(base: string, nome: string): NavGroup[] {
  return [
    {
      /*
        A competência continua sendo o eixo do ambiente — toda tela do Fechamento
        responde sobre **uma** competência, como toda tela da Auditoria responde
        sobre uma vigência —, mas a seção que abre o menu leva o nome do processo,
        e não o do seu eixo: quem abre a lateral procura onde se fecha, não como o
        período se chama. É a seção do começo do trabalho — o retrato do ano por
        unidade e a porta por onde os períodos entram.

        **A home chama-se "Visão Gerencial", e não "Visão do fechamento".** A
        primeira versão listava as seis competências mais recentes: respondia "o
        que aconteceu por último", que é uma pergunta de quem opera, e a home do
        ambiente é lida por quem responde pelo número. A pergunta dela passou a
        ser "quanto do ano já fechou, em quais unidades, e onde está o atraso" — e
        o nome mudou junto, porque um menu que promete visão e entrega lista gasta
        o clique de quem procurava o total.
      */
      titulo: nome,
      descricao: "Onde o período entra e o ano é lido",
      icon: CalendarDays,
      cor: "text-nav-fechamento",
      itens: [
        { href: base, label: "Visão Gerencial", icon: House },
        { href: `${base}/competencias`, label: "Importações", icon: CalendarDays },
        { href: `${base}/apuracoes`, label: "Apurações", icon: Table2 },
        { href: `${base}/resumo`, label: "Resumo geral", icon: FileSpreadsheet },
        /*
          A Conciliação fecha a seção porque é o último gesto do começo do
          trabalho: importado o mês e lido o resumo, confere-se o que se tem
          contra a planilha que a operação mantém. Ela não é uma aba do Resumo —
          tem gesto próprio (anexar a régua, versioná-la, trocar de versão),
          procedência própria e um estado normal que é "ainda não há planilha".
        */
        { href: `${base}/conciliacao`, label: "Conciliação", icon: Scale },
      ],
    },
    {
      /*
        O cadastro da planilha de remuneração, por unidade — a aba que abre a
        pasta de Excel e de onde todas as outras puxam. É a única seção do
        Fechamento que lê o acervo da Auditoria em vez de uma competência, e o
        motivo está em `pages/fechamento/remuneracao.tsx`: o que ela mostra é o
        que a Ambev **contratou**, e o contratado mora no modelo canônico.

        Um item só, hoje, e a seção existe assim mesmo: é aqui que as outras telas
        de cadastro por unidade vão cair, e diluí-las em "Competência" faria a
        seção do período falar de duas coisas.

        O item aponta para a **lista das unidades**, e não para o cadastro de
        uma delas: são duas telas — `/fechamento/remuneracao` responde quais
        unidades já têm cadastro de pé, e `/fechamento/remuneracao/unidade`, os
        parâmetros de uma. Um item de menu que abrisse direto o cadastro teria de
        escolher a unidade por conta própria, e escolher em silêncio é o que este
        produto não faz. O rótulo continua "Cadastro" porque é o nome do que se
        vai fazer ali; a lista é a porta.
      */
      titulo: "Remuneração",
      descricao: "O cadastro por unidade que a apuração consome",
      icon: ScrollText,
      cor: "text-nav-fechamento",
      itens: [{ href: `${base}/remuneracao`, label: "Cadastro", icon: FileSpreadsheet }],
    },
    {
      titulo: "Apuração",
      descricao: "A conta da competência e o que a impede de fechar",
      icon: Calculator,
      cor: "text-nav-fechamento",
      itens: [
        { href: `${base}/apuracao`, label: "Apuração", icon: Calculator },
        { href: `${base}/pendencias`, label: "Pendências", icon: ListTodo },
        { href: `${base}/conferencias`, label: "Conferências", icon: ClipboardCheck },
      ],
    },
    {
      /*
        Decisão é seção própria, separada da apuração, porque é outro trabalho e
        outra alçada: apurar e conferir é de quem opera; ajustar, aprovar e
        encerrar é de quem responde pelo número. A mesma razão que separa
        Recuperação de Auditoria no outro ambiente.
      */
      titulo: "Decisão",
      descricao: "Ajustar, aprovar e encerrar o período",
      icon: Stamp,
      cor: "text-nav-fechamento",
      itens: [
        { href: `${base}/ajustes`, label: "Ajustes", icon: PenLine },
        { href: `${base}/aprovacoes`, label: "Aprovações", icon: BadgeCheck },
        { href: `${base}/encerramento`, label: "Encerramento", icon: Lock },
      ],
    },
    {
      titulo: "Registro",
      descricao: "O que já fechou, competência a competência",
      icon: History,
      cor: "text-nav-fechamento",
      itens: [{ href: `${base}/historico`, label: "Histórico", icon: History }],
    },
  ];
}
