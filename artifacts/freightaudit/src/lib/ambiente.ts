/**
 * Os cinco ambientes de trabalho do FreightCheck.
 *
 * O produto é um só — mesmo login, mesma unidade, mesma base de frota, mesma
 * infraestrutura — mas os processos que ele atende são cinco, e cada um tem a
 * sua pergunta:
 *
 * - **Auditoria de Remuneração — Empurrada**: o que mudou? está correto? qual
 *   o impacto? existe valor a recuperar?
 * - **Fechamento Rota**: quanto devemos receber nesta competência?
 *   o que está pendente? o que precisa ser conferido? podemos fechar?
 * - **Fechamento Empurrada**: a mesma pergunta, sobre a operação de empurrada.
 * - **Fechamento AS**: a mesma pergunta, sobre a operação de AS.
 * - **Fechamento Apoio**: a mesma pergunta, sobre a operação de apoio.
 *
 * **Os fechamentos são o mesmo processo sobre operações diferentes.**
 * Abre-se a competência, apura-se, resolve-se o que impede a conta de fechar,
 * decide-se e encerra-se — a ordem do trabalho é uma só, e por isso a lateral,
 * as telas e o desenho são os mesmos em todos. O que muda entre eles é o
 * racional da apuração, não a forma de trabalhar; e é justamente por serem a
 * mesma forma que eles não são quatro códigos, e sim o mesmo código montado sob
 * quatro bases de endereço. Ver `BASES_DE_FECHAMENTO`, abaixo, e as rotas em
 * `App.tsx`, que nascem de um laço sobre essas bases — um fechamento novo é
 * uma linha naquele mapa, e nasce inteiro.
 *
 * **A URL é a única fonte da verdade sobre o ambiente aberto.** Tudo o que
 * vive sob `/fechamento` é Fechamento Rota; tudo sob `/fechamento-empurrada`,
 * `/fechamento-as` e `/fechamento-apoio` é o fechamento que o próprio endereço
 * nomeia; todo o resto é a Auditoria de sempre. Essa regra tem
 * três consequências deliberadas:
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
 * 2. **O Fechamento Rota ficou em `/fechamento`, e não em `/fechamento/rota`.**
 *    Pela mesma razão da Auditoria: quando a Empurrada nasceu, o Rota já era o
 *    produto em uso, com endereços guardados por aí. Quem paga o prefixo é
 *    sempre quem chega agora — a Empurrada nasceu dizendo o próprio nome no
 *    endereço, o AS e o Apoio nascem do mesmo jeito, e nenhum link existente
 *    muda de significado.
 * 3. **Não há estado paralelo de ambiente** — nada em `localStorage`, nada em
 *    contexto React que possa divergir do endereço. Compartilhar um link é
 *    compartilhar o ambiente; voltar no histórico volta o ambiente junto. Um
 *    estado guardado seria uma segunda fonte da verdade, e a errada — a mesma
 *    razão pela qual a sessão não vive no navegador (`lib/auth.tsx`).
 *
 * Por isso este módulo não tem hook nem provider: é uma função pura sobre a
 * localização, e quem precisa do ambiente a chama com o `useLocation` que já
 * tem. O atalho para as telas, que é o mesmo `useLocation` embrulhado, mora em
 * `lib/base-do-fechamento.ts` para que este arquivo continue puro.
 */

export type Ambiente =
  | "auditoria"
  | "fechamento-rota"
  | "fechamento-empurrada"
  | "fechamento-as"
  | "fechamento-apoio";

/**
 * Os ambientes que rodam o processo de fechamento — Rota, Empurrada, AS e Apoio.
 *
 * São quatro porque são quatro as operações que se fecha, e não porque o
 * processo tenha quatro formas: ele tem uma só (ver a nota do topo). O tipo é
 * derivado de {@link Ambiente} em vez de escrito à mão para que acrescentar a
 * quinta operação seja acrescentar uma linha lá, e não duas em lugares que
 * podem discordar.
 */
export type AmbienteDeFechamento = Exclude<Ambiente, "auditoria">;

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
 * É também a simetria que faltava com o Fechamento, cuja home sempre foi a
 * Visão Gerencial dele. Os ambientes passam a abrir na mesma altura: o
 * conjunto primeiro, a unidade depois.
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

/**
 * A Linha do tempo — o histórico de vigências da unidade aberta, uma tela
 * própria e não mais um cartão dentro do Resumo executivo.
 *
 * Separada porque a pergunta que ela responde ("como o impacto se moveu ao
 * longo das vigências, e o que mudou em cada uma") é uma leitura de todo o
 * histórico, não do instante atual que o Resumo executivo mostra — e as duas
 * disputavam a mesma rolagem.
 */
export const LINHA_DO_TEMPO = "/linha-do-tempo";

/**
 * O Dashboard — a tela de vigilância de mudanças, Geral ou por unidade.
 *
 * É onde a pergunta "a Ambev mudou algo sem avisar?" tem resposta em um
 * clique, e a porta para a Gestão à Vista. Endereço próprio, como o Resumo
 * executivo e a Linha do Tempo, porque a lateral aponta para ele.
 */
export const DASHBOARD = "/dashboard";

/** A Gestão à Vista — o mesmo recorte do Dashboard, em formato de telão. */
export const GESTAO_A_VISTA = "/gestao-a-vista";

/**
 * A base de endereço de cada fechamento — a única coisa que os separa.
 *
 * Toda tela do fechamento monta os próprios links a partir da base do ambiente
 * em que está (`lib/base-do-fechamento.ts`), e é só por isso que o mesmo
 * componente serve a todos: `${base}/competencias` é a lista de importações do
 * Rota, da Empurrada, do AS ou do Apoio conforme a porta pela qual se entrou.
 * Uma tela que escrevesse `/fechamento/...` à mão jogaria quem está em qualquer
 * um dos outros de volta para o Rota no primeiro clique — e sem erro nenhum na
 * tela, que é o pior jeito de essa regressão aparecer.
 */
export const BASES_DE_FECHAMENTO: Record<AmbienteDeFechamento, string> = {
  "fechamento-rota": "/fechamento",
  "fechamento-empurrada": "/fechamento-empurrada",
  /*
    AS e Apoio nascem com o nome no endereço, como a Empurrada nasceu — e pela
    mesma razão da regra 2, acima: quem paga o prefixo é sempre quem chega
    agora. Nenhum link guardado de `/fechamento` muda de significado por causa
    delas.
  */
  "fechamento-as": "/fechamento-as",
  "fechamento-apoio": "/fechamento-apoio",
};

/** A base do ambiente aberto quando não se está em fechamento nenhum. */
export const BASE_PADRAO_DE_FECHAMENTO = BASES_DE_FECHAMENTO["fechamento-rota"];

/**
 * A operação de cada fechamento — o recorte que separa os acervos.
 *
 * O tipo de operação entra na chave da competência desde a `0046`
 * (`lib/db/migrations/0046_tipo_de_operacao.sql`): a mesma unidade, com a mesma
 * transportadora, na mesma quinzena, fecha EMPURRADA, ROTA, AS e APOIO como
 * fechamentos **separados**, cada um com a sua planilha, os seus relatórios e a
 * sua conta. Este mapa é o que liga aquele eixo do banco a este eixo da tela.
 *
 * **Sem ele os ambientes seriam o mesmo acervo com nomes diferentes.** As listas
 * pediam o Fechamento inteiro, então o Rota mostrava as competências da
 * Empurrada e vice-versa — e excluir uma importação num ambiente a apagava do
 * outro, que é a mesma linha vista duas vezes e apagada uma vez só. O que muda
 * entre um fechamento e outro nunca foi só o endereço: é de qual operação é a
 * conta.
 *
 * A Administração é a exceção conhecida, e continua sendo: unidades,
 * transportadoras e usuários valem para o produto inteiro, e é por isso que elas
 * vivem fora dos prefixos de fechamento.
 */
export const OPERACAO_DO_AMBIENTE: Record<AmbienteDeFechamento, string> = {
  "fechamento-rota": "ROTA",
  "fechamento-empurrada": "EMPURRADA",
  /*
    `AS` colide com o `Canal` (`ROTA` | `AS`) das verbas, e a colisão é só de
    palavra: lá ele diz de qual canal é a **verba** dentro de uma planilha;
    aqui, de qual operação é o **fechamento**. É a mesma ambiguidade que `ROTA`
    já carrega desde a `0046`, e ela se resolve do mesmo jeito — pelo eixo em
    que o valor está, nunca pelo texto.
  */
  "fechamento-as": "AS",
  "fechamento-apoio": "APOIO",
};

/**
 * A operação do fechamento aberto nesta localização.
 *
 * Fora dos fechamentos devolve a do Rota, pela mesma razão de
 * {@link baseDoFechamento}: quem chama isto é tela de fechamento, e tela de
 * fechamento só existe sob uma das bases.
 */
export function operacaoDoFechamento(location: string): string {
  const id = ambienteDe(location);
  return ehFechamento(id)
    ? OPERACAO_DO_AMBIENTE[id]
    : OPERACAO_DO_AMBIENTE["fechamento-rota"];
}

/** O ambiente em que uma operação é fechada — o caminho de volta do mapa acima. */
export function ambienteDaOperacao(
  tipoDeOperacao: string,
): AmbienteDeFechamento | null {
  const alvo = tipoDeOperacao.trim().toUpperCase();
  const achado = Object.entries(OPERACAO_DO_AMBIENTE).find(
    ([, operacao]) => operacao === alvo,
  );
  return achado ? (achado[0] as AmbienteDeFechamento) : null;
}

export const AMBIENTES: DescricaoDeAmbiente[] = [
  {
    id: "auditoria",
    /*
      O nome diz a operação, como o dos fechamentos. O acervo que esta Auditoria
      lê é o da empurrada, e o seletor é o único lugar do produto onde isso cabe
      escrito: um menu que diz só "Auditoria" ao lado de fechamentos que dizem
      qual operação são deixa a pergunta "de qual delas?" sem resposta na
      tela. O `id` continua `auditoria` — ele é a chave do ambiente, não o
      rótulo, e trocá-lo seria renomear o eixo por causa do nome.
    */
    nome: "Auditoria Empurrada",
    nomeCompleto: "Auditoria de Remuneração — Empurrada",
    descricao: "O que mudou, se está correto e o que há para recuperar.",
    home: ENTRADA_DA_AUDITORIA,
  },
  {
    id: "fechamento-rota",
    nome: "Fechamento Rota",
    nomeCompleto: "Fechamento de Remuneração — Rota",
    descricao:
      "Apurar a competência da rota, resolver pendências e fechar o período.",
    home: BASES_DE_FECHAMENTO["fechamento-rota"],
  },
  {
    id: "fechamento-empurrada",
    nome: "Fechamento Empurrada",
    nomeCompleto: "Fechamento de Remuneração — Empurrada",
    descricao: "O mesmo processo sobre a operação de empurrada.",
    home: BASES_DE_FECHAMENTO["fechamento-empurrada"],
  },
  {
    id: "fechamento-as",
    nome: "Fechamento AS",
    nomeCompleto: "Fechamento de Remuneração — AS",
    descricao: "O mesmo processo sobre a operação de AS.",
    home: BASES_DE_FECHAMENTO["fechamento-as"],
  },
  {
    id: "fechamento-apoio",
    nome: "Fechamento Apoio",
    nomeCompleto: "Fechamento de Remuneração — Apoio",
    descricao: "O mesmo processo sobre a operação de apoio.",
    home: BASES_DE_FECHAMENTO["fechamento-apoio"],
  },
];

/**
 * A leitura do endereço, do prefixo mais específico para o mais geral.
 *
 * A comparação é exata ou seguida de barra, e nunca `startsWith` cru: sem isso
 * `/fechamentos` — que não existe, mas poderia — cairia no fechamento, e
 * `/fechamento-empurrada`, `/fechamento-as` e `/fechamento-apoio` cairiam todos
 * no Rota, que é o engano que este produto não pode cometer em silêncio. Três
 * bases começam com a do Rota; nenhuma delas *é* a do Rota.
 */
function sobA(base: string, location: string): boolean {
  return location === base || location.startsWith(`${base}/`);
}

export function ambienteDe(location: string): Ambiente {
  for (const [id, base] of Object.entries(BASES_DE_FECHAMENTO)) {
    if (sobA(base, location)) return id as AmbienteDeFechamento;
  }
  return "auditoria";
}

/** Se o ambiente é um dos fechamentos — a pergunta que a lateral e o topo fazem. */
export function ehFechamento(id: Ambiente): id is AmbienteDeFechamento {
  return id !== "auditoria";
}

/**
 * A base de endereço do fechamento aberto nesta localização.
 *
 * Fora dos fechamentos ela devolve a do Rota. Não é fallback silencioso: quem
 * chama isto é tela de fechamento, e tela de fechamento só existe sob uma das
 * bases — o valor de fora nunca chega a ser usado para navegar.
 */
export function baseDoFechamento(location: string): string {
  const id = ambienteDe(location);
  return ehFechamento(id) ? BASES_DE_FECHAMENTO[id] : BASE_PADRAO_DE_FECHAMENTO;
}

/**
 * A base de endereço do fechamento que trata de uma operação.
 *
 * É o que permite oferecer "abrir no outro ambiente" sem escrever `/fechamento`
 * à mão: a tela sabe de qual operação é a competência e pergunta por onde se
 * chega nela. Operação sem ambiente cai na base padrão, que é o que já vale em
 * {@link baseDoFechamento}.
 */
export function baseDaOperacao(tipoDeOperacao: string): string {
  const id = ambienteDaOperacao(tipoDeOperacao);
  return id ? BASES_DE_FECHAMENTO[id] : BASE_PADRAO_DE_FECHAMENTO;
}

/**
 * O nome do fechamento que trata de uma operação — "Fechamento Rota", e não "ROTA".
 *
 * É como a tela chama o ambiente no seletor do topo, e é o nome que a pessoa
 * reconhece. Uma operação sem ambiente (o `NAO_INFORMADO` do backfill, ou um
 * tipo que ainda não tem tela) volta com o rótulo cru, que é o mais honesto que
 * se pode dizer dela.
 */
export function nomeDoFechamentoDa(tipoDeOperacao: string): string {
  const id = ambienteDaOperacao(tipoDeOperacao);
  return id ? descricaoDoAmbiente(id).nome : tipoDeOperacao;
}

export function descricaoDoAmbiente(id: Ambiente): DescricaoDeAmbiente {
  // A lista é fixa e cobre os ids possíveis; o fallback nunca roda.
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
