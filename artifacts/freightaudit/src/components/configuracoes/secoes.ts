import { Building2, Briefcase, IdCard, KeyRound, MapPin, Network, ShieldCheck, UserRound, Users, type LucideIcon } from "lucide-react";
import { TELAS_EM_PREPARO } from "@/pages/telas-em-preparo";

/**
 * As seções da casa, na ordem em que o índice de Configurações as lista.
 *
 * Configurações deixou de ser uma tela com duas abas e virou um índice: uma
 * lista de seções, cada uma no seu endereço. A troca não é estética. Com duas
 * abas, cabia; com oito seções, uma barra de abas obriga a ler tudo de uma vez
 * para achar uma — e cada aba nova estreita as outras. A lista cresce para
 * baixo, cada linha diz o que é sem ser aberta, e o endereço de cada seção é
 * compartilhável: `/configuracoes/usuarios` abre em Usuários, não em
 * "Configurações, e depois clique na segunda aba".
 *
 * **A lista mistura o que existe e o que não existe, de propósito — e diz qual
 * é qual.** Quatro destas oito seções não têm dado no banco (ver
 * `pages/telas-em-preparo.ts`, de onde sai o texto de cada uma). Escondê-las
 * até nascerem deixaria o índice mentindo por omissão sobre a forma da casa;
 * mostrá-las como cadastro vazio convidaria a preencher um formulário que não
 * grava. Elas aparecem marcadas, e abrir uma diz o que falta.
 *
 * O estado de cada linha — pronta, vazia ou em preparo — não mora aqui: ele sai
 * do dado, no índice, e não de um campo que alguém teria de lembrar de mudar.
 */

export interface SecaoDeConfiguracao {
  /** O endereço da seção, absoluto: estas telas não têm versão por ambiente. */
  href: string;
  label: string;
  icon: LucideIcon;
  /** O que se resolve ali, numa linha — lida sem abrir a seção. */
  descricao: string;
}

export const SECOES_GERAIS: SecaoDeConfiguracao[] = [
  {
    href: "/configuracoes/empresa",
    label: "Minha Empresa",
    icon: Building2,
    descricao: "A identidade da instalação: razão social, CNPJ e quem responde por ela.",
  },
  {
    href: "/configuracoes/perfil",
    label: "Meu Perfil",
    icon: UserRound,
    descricao: "A sua conta e o seu papel, como o produto os conhece.",
  },
  {
    href: "/configuracoes/seguranca",
    label: "Segurança",
    icon: KeyRound,
    descricao: "Altere sua senha e gerencie a segurança da sua conta.",
  },
  {
    href: "/configuracoes/unidades",
    label: "Unidades",
    icon: MapPin,
    descricao: "As seleções que entregaram vigência, com o que cada uma já mandou.",
  },
  {
    href: "/configuracoes/usuarios",
    label: "Usuários",
    icon: Users,
    descricao: "Quem entra, com que papel e desde quando.",
  },
  {
    href: "/configuracoes/permissoes",
    label: "Permissões",
    icon: ShieldCheck,
    descricao: "O que cada pessoa alcança, módulo a módulo — aqui se tira acesso.",
  },
  {
    href: "/configuracoes/cargos",
    label: "Cargos",
    icon: IdCard,
    descricao: "Os cargos do quadro, o que cada um custa e onde está lotado.",
  },
  {
    href: "/configuracoes/negocio",
    label: "Negócio",
    icon: Briefcase,
    descricao: "Os negócios atendidos e a regra que vale em cada um.",
  },
  {
    href: "/configuracoes/departamento",
    label: "Departamento",
    icon: Network,
    descricao: "A divisão interna e quem responde por cada gasto.",
  },
];

/**
 * A seção tem tela de verdade, ou é uma entrada do catálogo de telas em preparo?
 *
 * A pergunta é respondida pelo próprio catálogo, e não por um campo repetido
 * aqui: no dia em que Cargos nascer, tira-se a entrada de `TELAS_EM_PREPARO`,
 * escreve-se a `<Route>` — e esta lista não muda uma vírgula, como manda o
 * catálogo.
 */
export function estaEmPreparo(href: string): boolean {
  return TELAS_EM_PREPARO.some((tela) => tela.href === href);
}
