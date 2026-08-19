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
 * Conferências, Ajustes, Aprovações, Fechamento, Histórico) com duas mudanças
 * deliberadas:
 *
 * 1. **A ordem dentro da apuração é Apuração → Pendências → Conferências**, e
 *    não Pendências antes da Apuração: pendência é o que a apuração não
 *    conseguiu apurar — sem rodar a conta primeiro, não há o que estar
 *    pendente. A tela de Pendências é a fila de trabalho que a Apuração
 *    produz, e a de Conferências é a prova de que o que foi apurado se
 *    sustenta.
 * 2. **"Fechamento" virou "Encerramento"**: um item "Fechamento" dentro do
 *    ambiente Fechamento faria o menu dizer o nome do ambiente duas vezes com
 *    dois sentidos. Encerrar é o ato — conferido e aprovado, congela-se a
 *    competência.
 *
 * Nenhum item tem `contador` ainda: contador sem fila de verdade atrás é
 * bolinha decorativa, e a regra da lateral — nenhum número inventado — vale
 * aqui desde o primeiro dia.
 */
export const NAV_GROUPS_FECHAMENTO: NavGroup[] = [
  {
    /*
      A competência é o eixo do ambiente inteiro: toda tela do Fechamento
      responde sobre **uma** competência, como toda tela da Auditoria responde
      sobre uma vigência. Por isso a seção que abre o menu é ela — a visão do
      período em andamento e a lista dos períodos.
    */
    titulo: "Competência",
    icon: CalendarDays,
    cor: "text-nav-fechamento",
    itens: [
      { href: "/fechamento", label: "Visão do fechamento", icon: House },
      { href: "/fechamento/competencias", label: "Competências", icon: CalendarDays },
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
