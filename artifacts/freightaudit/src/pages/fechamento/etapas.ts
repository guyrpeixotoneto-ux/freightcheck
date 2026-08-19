import {
  BadgeCheck,
  CalendarDays,
  Calculator,
  ClipboardCheck,
  History,
  ListTodo,
  Lock,
  PenLine,
  type LucideIcon,
} from "lucide-react";

/**
 * O catálogo das telas do Fechamento — todas ainda sem número.
 *
 * O ambiente nasce inteiro de estrutura e vazio de valores, e isso é decisão,
 * não pressa: a mesma regra que rege as telas em preparo da Auditoria
 * (`pages/telas-em-preparo.ts`) vale aqui desde o primeiro dia — **nenhuma
 * tela mostra um número que o banco não sustente.** Cada entrada é o mesmo
 * contrato em três partes: a pergunta que a tela vai responder, o que precisa
 * existir antes — sempre um dado, nunca um prazo — e onde olhar hoje.
 *
 * A diferença em relação ao catálogo da Auditoria é que "onde olhar hoje"
 * quase sempre atravessa a fronteira: o Fechamento apura o que a Auditoria
 * confere, então a metade que já existe da resposta costuma morar no outro
 * ambiente. O atalho diz isso por extenso (`ambiente: "auditoria"`) para que
 * ninguém mude de espaço de trabalho sem saber que mudou.
 *
 * Construir uma tela de verdade é o mesmo movimento de lá: a entrada sai
 * daqui, a rota em `App.tsx` passa a apontar para a tela real, e o menu
 * (`components/layout/nav-fechamento.ts`) não muda uma vírgula.
 */

export interface EtapaFechamento {
  href: string;
  label: string;
  icon: LucideIcon;
  /** A pergunta que a tela vai responder, numa frase. */
  pergunta: string;
  /** O que precisa existir antes — sempre um dado, nunca um prazo. */
  depende: string[];
  /** Onde olhar hoje: telas que já funcionam e chegam perto. */
  hoje: { href: string; label: string; porque: string; ambiente?: "auditoria" }[];
}

export const ETAPAS_FECHAMENTO: EtapaFechamento[] = [
  // -------------------------------------------------------------------------
  // Competência
  // -------------------------------------------------------------------------
  {
    href: "/fechamento/competencias",
    label: "Competências",
    icon: CalendarDays,
    pergunta:
      "Que períodos existem, em que estado está cada um — aberto, em apuração, aprovado, fechado — e qual é o que está sendo trabalhado agora.",
    depende: [
      "A competência como registro próprio no banco: hoje existe a vigência, que é o retrato que o Freightec exporta, e não o período de apuração com estado, dono e ciclo de vida.",
      "A regra que liga competência a vigência — qual retrato da base remunerada vale para qual período — decidida e escrita, porque é ela que diz sobre o que o fechamento fecha.",
    ],
    hoje: [
      {
        href: "/vigencias",
        label: "Vigências",
        porque: "Os períodos que a base já conhece: cada vigência importada, com o que ela cobre.",
        ambiente: "auditoria",
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Apuração
  // -------------------------------------------------------------------------
  {
    href: "/fechamento/apuracao",
    label: "Apuração",
    icon: Calculator,
    pergunta:
      "Quanto a remuneração da competência vale — o total apurado, aberto por equipamento e por rubrica, com a origem de cada parcela.",
    depende: [
      "A competência aberta (ver Competências): apuração é sempre a de um período, e o período ainda não existe como registro.",
      "O realizado da operação — viagens, quilometragem, disponibilidade. A base remunerada diz o preço contratado de cada coisa; sem o volume que aconteceu, o que se soma é tabela, não remuneração devida.",
    ],
    hoje: [
      {
        href: "/composicao",
        label: "Composição",
        porque:
          "O valor montado de cada equipamento na vigência — a metade contratada da conta, que o banco já sustenta.",
        ambiente: "auditoria",
      },
      {
        href: "/dre",
        label: "DRE",
        porque: "A mesma apuração lida em seções contábeis, com a cobertura medida.",
        ambiente: "auditoria",
      },
    ],
  },
  {
    href: "/fechamento/pendencias",
    label: "Pendências",
    icon: ListTodo,
    pergunta:
      "O que impede esta competência de fechar — dado que não chegou, valor que não fecha, divergência sem resposta — e de quem é cada item.",
    depende: [
      "A apuração rodando (ver Apuração): pendência é o que ela não conseguiu apurar ou apurou com ressalva, e sem a conta não há fila.",
      "A pendência como registro com dono e desfecho, para que a lista seja fila de trabalho e não relatório — o mesmo que separa um achado de auditoria de uma anotação.",
    ],
    hoje: [
      {
        href: "/curadoria",
        label: "Curadoria",
        porque:
          "A fila que já existe hoje: o que a importação não soube classificar e espera decisão humana.",
        ambiente: "auditoria",
      },
      {
        href: "/balanco-massa",
        label: "Balanço de massa",
        porque: "A conferência de que tudo que o arquivo trouxe chegou a algum lugar.",
        ambiente: "auditoria",
      },
    ],
  },
  {
    href: "/fechamento/conferencias",
    label: "Conferências",
    icon: ClipboardCheck,
    pergunta:
      "O apurado se sustenta? — as checagens da competência: contra o período anterior, contra a tabela contratada, contra o que a operação registrou.",
    depende: [
      "O valor apurado (ver Apuração), que é o que as checagens conferem.",
      "O catálogo de conferências decidido e versionado — que checagens rodam, com que tolerância, e o resultado de cada uma gravado por competência, para que a tela mostre histórico e não só o estado de agora.",
    ],
    hoje: [
      {
        href: "/comparar",
        label: "Comparar vigências",
        porque:
          "A conferência contra o período anterior que já funciona, item a item, para o olho humano.",
        ambiente: "auditoria",
      },
      {
        href: "/alteracoes",
        label: "Alterações",
        porque: "O que mudou na vigência aberta — o primeiro lugar onde uma conferência falharia.",
        ambiente: "auditoria",
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Decisão
  // -------------------------------------------------------------------------
  {
    href: "/fechamento/ajustes",
    label: "Ajustes",
    icon: PenLine,
    pergunta:
      "O que foi corrigido à mão nesta competência — cada ajuste com valor, justificativa, autor e a pendência ou conferência que o motivou.",
    depende: [
      "O valor apurado sobre o qual ajustar (ver Apuração).",
      "O ajuste como lançamento próprio, separado do valor apurado e nunca por cima dele: fechamento que edita a apuração destrói a trilha que a Auditoria existe para conferir.",
    ],
    hoje: [
      {
        href: "/curadoria",
        label: "Curadoria",
        porque:
          "O registro de decisão humana sobre dado que já existe — com autor e carimbo, como os ajustes terão.",
        ambiente: "auditoria",
      },
    ],
  },
  {
    href: "/fechamento/aprovacoes",
    label: "Aprovações",
    icon: BadgeCheck,
    pergunta:
      "Quem precisa aprovar esta competência, quem já aprovou, quando — e o que cada um viu na tela ao aprovar.",
    depende: [
      "A alçada decidida em produto: quem aprova o quê, por unidade e por valor — regra que hoje não existe escrita em lugar nenhum do sistema.",
      "A aprovação como registro imutável, com o retrato do que foi aprovado: aprovar um total que depois muda sem novo aval não é aprovação, é assinatura em branco.",
    ],
    hoje: [
      {
        href: "/configuracoes",
        label: "Usuários",
        porque: "Quem existe no sistema — a metade de 'quem aprova' que já está cadastrada.",
        ambiente: "auditoria",
      },
    ],
  },
  {
    href: "/fechamento/encerramento",
    label: "Encerramento",
    icon: Lock,
    pergunta:
      "Podemos fechar? — a lista final do que está conferido, aprovado e pendente, e o ato de congelar a competência.",
    depende: [
      "Tudo que vem antes: apuração, pendências zeradas ou aceitas com registro, conferências passadas, aprovações completas. Encerrar é o ato que só existe quando o resto existe.",
      "O fechamento como estado irreversível-com-registro: fechado não se edita; reabre-se, com autor e motivo, e a reabertura fica no Histórico.",
    ],
    hoje: [
      {
        href: "/vigencia",
        label: "Acompanhamento",
        porque: "O retrato da vigência aberta — o mais perto que existe hoje de 'como está o período'.",
        ambiente: "auditoria",
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Registro
  // -------------------------------------------------------------------------
  {
    href: "/fechamento/historico",
    label: "Histórico",
    icon: History,
    pergunta:
      "O registro imutável dos fechamentos: cada competência fechada, com valor final, ajustes, quem aprovou, quando fechou — e as reaberturas, se houve.",
    depende: [
      "Competências fechadas (ver Encerramento): o histórico é consequência, não construção própria.",
      "O vínculo do fechamento com o que a Auditoria encontrou depois dele — é aqui que o valor apurado encontra a divergência e a recuperação, sem que uma tela invada a outra.",
    ],
    hoje: [
      {
        href: "/versoes",
        label: "Versões",
        porque: "O registro imutável que o produto já mantém: o que entrou em cada versão, em ordem.",
        ambiente: "auditoria",
      },
    ],
  },
];
