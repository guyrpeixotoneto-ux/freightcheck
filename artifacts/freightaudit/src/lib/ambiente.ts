/**
 * Os dois ambientes de trabalho do FreightCheck.
 *
 * O produto é um só — mesmo login, mesma unidade, mesma base de frota, mesma
 * infraestrutura — mas os processos que ele atende são dois, e cada um tem a
 * sua pergunta:
 *
 * - **Auditoria de Remuneração**: o que mudou? está correto? qual o impacto?
 *   existe valor a recuperar?
 * - **Fechamento de Remuneração**: quanto devemos receber nesta competência?
 *   o que está pendente? o que precisa ser conferido? podemos fechar?
 *
 * **A URL é a única fonte da verdade sobre o ambiente aberto.** Tudo o que
 * vive sob `/fechamento` é Fechamento; todo o resto é a Auditoria de sempre.
 * Essa regra tem duas consequências deliberadas:
 *
 * 1. **Nenhum endereço da Auditoria mudou.** As rotas atuais (`/alteracoes`,
 *    `/comparar`, `/dre`…) são o produto em uso — favoritos, links colados em
 *    e-mail, o histórico do navegador de quem trabalha nele todo dia. Movê-las
 *    para `/auditoria/...` daria simetria bonita ao custo de quebrar todos
 *    esses links, e simetria não paga esse preço. O prefixo explícito fica
 *    para o domínio que nasce agora, onde ele não custa nada.
 * 2. **Não há estado paralelo de ambiente** — nada em `localStorage`, nada em
 *    contexto React que possa divergir do endereço. Compartilhar um link é
 *    compartilhar o ambiente; voltar no histórico volta o ambiente junto. Um
 *    estado guardado seria uma segunda fonte da verdade, e a errada — a mesma
 *    razão pela qual a sessão não vive no navegador (`lib/auth.tsx`).
 *
 * Por isso este módulo não tem hook nem provider: é uma função pura sobre a
 * localização, e quem precisa do ambiente a chama com o `useLocation` que já
 * tem.
 */

export type Ambiente = "auditoria" | "fechamento";

export interface DescricaoDeAmbiente {
  id: Ambiente;
  /** O nome curto, como aparece no seletor do topo. */
  nome: string;
  /** O nome por extenso, como aparece na lista do seletor. */
  nomeCompleto: string;
  /** A pergunta que o ambiente responde, numa frase. */
  descricao: string;
  /** A tela que abre ao trocar para ele. */
  home: string;
}

export const AMBIENTES: DescricaoDeAmbiente[] = [
  {
    id: "auditoria",
    nome: "Auditoria",
    nomeCompleto: "Auditoria de Remuneração",
    descricao: "O que mudou, se está correto e o que há para recuperar.",
    home: "/",
  },
  {
    id: "fechamento",
    nome: "Fechamento",
    nomeCompleto: "Fechamento de Remuneração",
    descricao: "Apurar a competência, resolver pendências e fechar o período.",
    home: "/fechamento",
  },
];

/** O prefixo que define o ambiente Fechamento. Tudo fora dele é Auditoria. */
const PREFIXO_FECHAMENTO = "/fechamento";

export function ambienteDe(location: string): Ambiente {
  return location === PREFIXO_FECHAMENTO || location.startsWith(`${PREFIXO_FECHAMENTO}/`)
    ? "fechamento"
    : "auditoria";
}

export function descricaoDoAmbiente(id: Ambiente): DescricaoDeAmbiente {
  // A lista é fixa e cobre os dois ids possíveis; o fallback nunca roda.
  return AMBIENTES.find((a) => a.id === id) ?? AMBIENTES[0];
}
