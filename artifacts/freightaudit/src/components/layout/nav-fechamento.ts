import {
  BadgeCheck,
  CalendarDays,
  Calculator,
  ClipboardCheck,
  History,
  House,
  ListTodo,
  Lock,
  PenLine,
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
 * fecha-se o período — que então vira registro. As quatro seções são esses
 * quatro momentos, na ordem em que o trabalho acontece, pela mesma razão que
 * as oito da Auditoria seguem a ordem de uma auditoria completa.
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
 *    abrir o período e enviar os cinco relatórios que a Ambev exporta na
 *    quinzena. A lista é o que sobra depois de importar; nomear a tela por ela
 *    escondia o gesto que a enche.
 *
 * Nenhum item tem `contador` ainda: contador sem fila de verdade atrás é
 * bolinha decorativa, e a regra da lateral — nenhum número inventado — vale
 * aqui desde o primeiro dia.
 */
export const NAV_GROUPS_FECHAMENTO: NavGroup[] = [
  {
    /*
      A competência continua sendo o eixo do ambiente — toda tela do Fechamento
      responde sobre **uma** competência, como toda tela da Auditoria responde
      sobre uma vigência —, mas a seção que abre o menu leva o nome do processo,
      e não o do seu eixo: quem abre a lateral procura onde se fecha, não como o
      período se chama. É a seção do começo do trabalho — a visão do período em
      andamento e a porta por onde os períodos entram.
    */
    titulo: "Fechamento",
    icon: CalendarDays,
    cor: "text-nav-fechamento",
    itens: [
      { href: "/fechamento", label: "Visão do fechamento", icon: House },
      { href: "/fechamento/competencias", label: "Importações", icon: CalendarDays },
      { href: "/fechamento/apuracoes", label: "Apurações", icon: Table2 },
    ],
  },
  {
    titulo: "Apuração",
    icon: Calculator,
    cor: "text-nav-fechamento",
    itens: [
      { href: "/fechamento/apuracao", label: "Apuração", icon: Calculator },
      { href: "/fechamento/pendencias", label: "Pendências", icon: ListTodo },
      { href: "/fechamento/conferencias", label: "Conferências", icon: ClipboardCheck },
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
    icon: Stamp,
    cor: "text-nav-fechamento",
    itens: [
      { href: "/fechamento/ajustes", label: "Ajustes", icon: PenLine },
      { href: "/fechamento/aprovacoes", label: "Aprovações", icon: BadgeCheck },
      { href: "/fechamento/encerramento", label: "Encerramento", icon: Lock },
    ],
  },
  {
    titulo: "Registro",
    icon: History,
    cor: "text-nav-fechamento",
    itens: [{ href: "/fechamento/historico", label: "Histórico", icon: History }],
  },
];
