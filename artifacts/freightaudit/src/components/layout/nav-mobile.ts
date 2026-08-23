import {
  ArrowRightLeft,
  Calculator,
  CalendarDays,
  CloudDownload,
  House,
  LayoutDashboard,
  ListTodo,
  Sparkles,
} from "lucide-react";
import {
  BASES_DE_FECHAMENTO,
  ehFechamento,
  ENTRADA_DA_AUDITORIA,
  type Ambiente,
} from "@/lib/ambiente";
import type { NavItem } from "./nav";

/**
 * Os atalhos da barra de baixo, no celular.
 *
 * **Por que uma lista curta, e não a lateral encolhida.** A lateral tem
 * cinquenta itens em nove seções e mora à esquerda porque lá ela custa 225px de
 * uma tela de 1400 — no celular ela custaria a tela inteira, e a faixa de
 * ícones custaria um quarto dela para mostrar cinquenta desenhos sem nome. O
 * telefone se navega com o polegar, na borda de baixo, e o que cabe ali são
 * quatro destinos e a porta para o resto.
 *
 * **Quais quatro.** Os que se abrem todo dia, na ordem do trabalho: onde se
 * chega (a home do ambiente), a fila que se olha primeiro, o que se está
 * fazendo agora, e a porta do resto. Nenhum deles é novo e nenhum deles é
 * exclusivo daqui: são os mesmos itens da lateral, com o mesmo endereço e o
 * mesmo rótulo — a barra é um atalho para quatro linhas da lista, nunca um
 * segundo menu com nomes próprios. Quem aprendeu o produto no computador não
 * reaprende nada no telefone.
 *
 * **O do meio é destacado, e por quê.** No lugar do polegar em repouso fica o
 * gesto que não é "ir a uma tela": na Auditoria, perguntar ao assistente — a
 * única coisa que se faz em qualquer tela, sobre qualquer tela; no Fechamento,
 * a apuração, que é o ato que o ambiente inteiro existe para produzir. O
 * destaque é do gesto, não da tela: ele é o que a pessoa veio fazer.
 *
 * **Não há atalho novo aqui.** A regra da lateral vale igual: todo `href` desta
 * lista é um `href` que já está lá, e o teste de `sidebar.test.ts` confere os
 * dois contra o roteador — no celular, um item que não leva a lugar nenhum é
 * ainda pior, porque não há tooltip nem lista ao lado que explique.
 */

export interface AtalhoMobile extends NavItem {
  /** A frase do rótulo longo — lida por quem usa leitor de tela. */
  descricao?: string;
}

export interface BarraMobile {
  /** Os dois primeiros slots, à esquerda do destaque. */
  esquerda: AtalhoMobile[];
  /** O gesto do meio, no botão redondo. */
  centro: AtalhoMobile;
  /** O slot entre o destaque e o "Mais". */
  direita: AtalhoMobile[];
}

export function barraMobile(ambiente: Ambiente): BarraMobile {
  if (ehFechamento(ambiente)) {
    const base = BASES_DE_FECHAMENTO[ambiente];

    return {
      esquerda: [
        { href: base, label: "Visão", icon: House, descricao: "Visão Gerencial do fechamento" },
        {
          href: `${base}/competencias`,
          label: "Importar",
          icon: CalendarDays,
          descricao: "Importações da competência",
        },
      ],
      /*
        A apuração é o ato do ambiente: abre-se a competência para apurá-la, e
        todo o resto — pendência, conferência, ajuste — é consequência do que
        ela produziu.
      */
      centro: {
        href: `${base}/apuracao`,
        label: "Apuração",
        icon: Calculator,
        descricao: "Apurar a competência",
      },
      direita: [
        {
          href: `${base}/pendencias`,
          label: "Pendências",
          icon: ListTodo,
          descricao: "O que impede a conta de fechar",
        },
      ],
    };
  }

  return {
    esquerda: [
      {
        href: ENTRADA_DA_AUDITORIA,
        label: "Início",
        icon: LayoutDashboard,
        descricao: "Visão Gerencial de todas as unidades",
      },
      /*
        Alterações é a primeira tela de quem audita e a única da barra que
        carrega contador: é a fila que diz se há trabalho hoje, e ela precisa
        dizê-lo antes do toque.
      */
      {
        href: "/alteracoes",
        label: "Alterações",
        icon: ArrowRightLeft,
        contador: "alteracoes",
        descricao: "O que mudou na vigência aberta",
      },
    ],
    centro: {
      href: "/assistente",
      label: "Perguntar",
      icon: Sparkles,
      descricao: "Pergunte ao FreightCheck",
    },
    direita: [
      {
        href: "/importacoes",
        label: "Importações",
        icon: CloudDownload,
        contador: "importacoes",
        descricao: "As importações em andamento",
      },
    ],
  };
}
