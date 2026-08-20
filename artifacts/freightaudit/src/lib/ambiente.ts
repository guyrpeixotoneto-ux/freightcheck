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
 * 1. **A Auditoria não foi movida para um prefixo.** As rotas atuais
 *    (`/alteracoes`, `/comparar`, `/dre`…) são o produto em uso — favoritos,
 *    links colados em e-mail, o histórico do navegador de quem trabalha nele
 *    todo dia. Movê-las para `/auditoria/...` daria simetria bonita ao custo de
 *    quebrar todos esses links, e simetria não paga esse preço. O prefixo
 *    explícito fica para o domínio que nasce agora, onde ele não custa nada.
 *
 *    A porta mudou depois disso, e sob esta mesma regra: o Resumo executivo
 *    saiu de `/` para `/resumo-executivo` e a raiz virou a entrada da Visão
 *    Gerencial — mas `/` continua atendendo, e continua levando ao Resumo
 *    executivo todo link que chegar com recorte na consulta. Nenhum endereço
 *    guardado morreu. Ver `destinoDaRaiz`, no fim deste arquivo.
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

/**
 * A porta de entrada da Auditoria — e por que ela deixou de ser `/`.
 *
 * Quem abre o produto abre pelo conjunto: **a Visão Gerencial**, todas as
 * unidades de uma vez, em ordem do que falta auditar. O Resumo executivo
 * responde pela unidade *aberta*, e responder por uma unidade é a segunda
 * pergunta de quem chegou — não a primeira. Enquanto ele era a home, toda
 * entrada no sistema começava já dentro de um recorte que ninguém escolheu, e o
 * retrato do acervo dependia de alguém saber que existia um segundo item no
 * menu.
 *
 * É também a simetria que faltava com o Fechamento, cuja home (`/fechamento`)
 * sempre foi a Visão Gerencial dele. Os dois ambientes passam a abrir na mesma
 * altura: o conjunto primeiro, a unidade depois.
 */
export const ENTRADA_DA_AUDITORIA = "/visao-gerencial";

/**
 * O Resumo executivo, que agora tem endereço próprio.
 *
 * Ele morava em `/` — não por decisão, mas por ter sido a primeira tela do
 * produto. Sair da raiz é o que permite à raiz ser uma porta, e é o que dá a
 * ele o mesmo tratamento de qualquer outra tela: um endereço que diz o nome
 * dela.
 */
export const RESUMO_EXECUTIVO = "/resumo-executivo";

export const AMBIENTES: DescricaoDeAmbiente[] = [
  {
    id: "auditoria",
    nome: "Auditoria",
    nomeCompleto: "Auditoria de Remuneração",
    descricao: "O que mudou, se está correto e o que há para recuperar.",
    home: ENTRADA_DA_AUDITORIA,
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

/**
 * O que a raiz faz agora — e o que ela deve aos links que já existem.
 *
 * `/` deixou de ser tela e virou porta, mas continua sendo o endereço que os
 * links colados por aí carregam: *toda* volta ao Resumo executivo
 * do produto se escrevia `/?period=…&scopeHash=…`, porque era ali que ele
 * morava. Mandar essa gente para a Visão Gerencial abriria a tela certa do
 * ponto de vista de hoje e a errada do ponto de vista de quem clicou — o
 * recorte que o link carrega existe justamente para não ser reescolhido.
 *
 * Daí a regra, que é uma só e cabe numa linha: **a raiz sem recorte abre a
 * Visão Gerencial; a raiz com recorte encaminha para o Resumo executivo, com a
 * consulta intacta.** É a mesma solução que `/fechamento/remuneracao` já usa
 * para os links antigos do cadastro — quem chega com a unidade na query é
 * levado à tela que sabe o que fazer com ela —, e ela vale porque as duas
 * telas nunca dividiram um parâmetro: o que a Visão Gerencial lê da URL é
 * `ano`, que nenhum link de `/` jamais escreveu.
 *
 * Nada aqui é fallback provisório. Um endereço que alguém guardou é contrato, e
 * este é o preço, permanente e barato, de mudar a porta sem quebrar o contrato.
 */
export function destinoDaRaiz(busca: string): string {
  const consulta = busca.startsWith("?") ? busca.slice(1) : busca;
  return consulta ? `${RESUMO_EXECUTIVO}?${consulta}` : ENTRADA_DA_AUDITORIA;
}
