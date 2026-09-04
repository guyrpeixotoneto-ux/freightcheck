/**
 * O vocabulário do acesso — escrito uma vez, lido pelos dois lados.
 *
 * O produto decide acesso em três eixos, e todos os três moram na mesma tabela
 * porque os três respondem a mesma forma de pergunta — "o que esta chave
 * alcança":
 *
 * · **o módulo**, que é o endereço do item no menu (`/curadoria`);
 * · **o ambiente de trabalho**, que é `@` mais o id (`@fechamento-as`);
 * · **a seção do menu**, que é `#` mais o id (`#visao-executiva`).
 *
 * Os três prefixos são disjuntos por construção: módulo começa por barra,
 * porque é endereço; os outros dois têm marca própria. É isso que permite as
 * três decisões conviverem numa coluna de texto sem coluna de tipo.
 *
 * ---------------------------------------------------------------------------
 * Por que a seção passou a ter chave
 * ---------------------------------------------------------------------------
 * Ela não tinha, e a razão escrita era boa: "desligar Processos é desligar os
 * módulos dela, e a seção some sozinha quando fica vazia". O que essa razão não
 * previu é o **tempo**. Desligar a seção gravava as chaves dos módulos que
 * existiam naquele instante, e mais nada; um módulo novo dentro da seção nascia
 * ligado — chave sem linha é chave ligada, que é o silêncio que concede em toda
 * esta camada — e devolvia a seção inteira ao menu de quem a tinha desligado.
 * Aconteceu três vezes em quatro dias, em setembro de 2026.
 *
 * A seção agora é decisão própria, e a precedência é a única que resolve o
 * problema pela raiz: **seção desligada vence módulo ligado**. Para um módulo
 * daquela seção voltar a aparecer, a seção precisa primeiro estar ligada — o
 * que é exatamente o que "a casa não usa esta parte do produto" quer dizer.
 *
 * ---------------------------------------------------------------------------
 * Por que este pacote existe
 * ---------------------------------------------------------------------------
 * Porque a regra de precedência agora tem **dois** leitores que precisam
 * concordar, e eles moram em pacotes diferentes: a lateral, que esconde, e o
 * portão de escrita do servidor, que recusa. Enquanto a decisão era só sobre o
 * módulo, os dois liam a mesma chave e não tinham como divergir. Com a seção,
 * quem lê precisa saber **de que seção é aquele módulo** — e uma segunda cópia
 * dessa regra, escrita em cada lado, concorda no dia em que é escrita e discorda
 * no dia em que alguém move um módulo de seção, sem erro nenhum, que é a forma
 * mais cara de isto aparecer.
 *
 * Aqui não há catálogo de menu: o menu continua sendo o catálogo, e ele vive na
 * interface (`lib/permissoes.ts`, montado a partir das laterais). O que mora
 * aqui é o **vocabulário** — a forma das chaves e a regra que as compõe — mais
 * a única tabela que o servidor não tem como derivar sozinho: a seção dos
 * módulos cuja escrita ele sabe reconhecer. Essa tabela é curta, é conferida
 * contra o menu de verdade por um teste da interface, e é o preço honesto de o
 * servidor não importar a tela.
 */

export const NIVEIS = ["EDITAR", "VISUALIZAR", "SEM_ACESSO"] as const;
export type Nivel = (typeof NIVEIS)[number];

/**
 * O que vale para quem nunca teve uma decisão tomada a respeito.
 *
 * A ausência concede, nas três camadas e nos três eixos. É o que toda conta
 * tinha antes de existir permissão, e é o que faz cada migration desta família
 * nascer sem mudar o menu de ninguém.
 */
export const NIVEL_PADRAO: Nivel = "EDITAR";

export function ehNivel(valor: unknown): valor is Nivel {
  return typeof valor === "string" && (NIVEIS as readonly string[]).includes(valor);
}

/**
 * O mais fechado entre dois níveis.
 *
 * `SEM_ACESSO` vence tudo, `VISUALIZAR` vence `EDITAR`. É a composição de dois
 * eixos, e ela só pode ser esta: o mais permissivo dos dois faria qualquer eixo
 * em padrão desfazer a decisão tomada no outro — e "em padrão" é o estado normal
 * de quase toda chave.
 */
export function maisRestritivo(a: Nivel, b: Nivel): Nivel {
  if (a === "SEM_ACESSO" || b === "SEM_ACESSO") return "SEM_ACESSO";
  if (a === "VISUALIZAR" || b === "VISUALIZAR") return "VISUALIZAR";
  return "EDITAR";
}

/* =========================================================================
 * As três formas de chave
 * ====================================================================== */

/** A chave de uma seção do menu — `#` mais o id estável dela. */
export function chaveDaSecao(id: string): string {
  return `#${id}`;
}

/** A chave de um ambiente de trabalho — `@` mais o id dele. */
export function chaveDoAmbiente(id: string): string {
  return `@${id}`;
}

export function ehChaveDeSecao(chave: string): boolean {
  return chave.startsWith("#");
}

export function ehChaveDeAmbiente(chave: string): boolean {
  return chave.startsWith("@");
}

/** Chave de módulo é endereço, e endereço começa por barra. */
export function ehChaveDeModulo(chave: string): boolean {
  return chave.startsWith("/");
}

/* =========================================================================
 * A precedência — a regra que os dois lados leem
 * ====================================================================== */

/**
 * O nível de um módulo, com a seção dele já pesada.
 *
 * A ordem é: **a seção primeiro**. Desligada, acabou — `SEM_ACESSO`, e nenhuma
 * decisão sobre o módulo a devolve. É a diferença entre "a casa não usa esta
 * parte do produto" e "escrevi N decisões de uma vez": só a primeira sobrevive
 * ao módulo que nasce amanhã.
 *
 * Ligada — ou inexistente, que é o caso de todo módulo fora de seção — vale o
 * que valia antes: a decisão sobre o módulo, e o padrão que concede quando não
 * há decisão nenhuma.
 *
 * `secao` é `null` para o que não pertence a seção nenhuma. Não é o mesmo que
 * "seção ligada" por acidente: é a afirmação de que aquela chave não tem essa
 * dimensão, e tratá-la como bloqueável inventaria uma decisão que ninguém tomou.
 */
export function nivelDoModulo(
  permissoes: Readonly<Record<string, Nivel>>,
  chaveDoModulo: string,
  secao: string | null,
): Nivel {
  if (secao !== null && permissoes[chaveDaSecao(secao)] === "SEM_ACESSO") {
    return "SEM_ACESSO";
  }
  return permissoes[chaveDoModulo] ?? NIVEL_PADRAO;
}

/* =========================================================================
 * A seção dos módulos que o servidor sabe gatear
 * ====================================================================== */

/**
 * A seção de cada módulo com escrita reconhecida pelo servidor.
 *
 * O portão de escrita (`middlewares/portao-de-permissao.ts`) mapeia prefixo de
 * API para módulo, e precisa agora de um passo a mais: **de que seção é esse
 * módulo**, para recusar a escrita de um módulo cuja seção a casa desligou.
 * Sem isto, desligar uma seção esconderia as telas e continuaria aceitando a
 * escrita delas por chamada direta — uma decisão administrativa que vale só
 * enquanto ninguém tenta.
 *
 * **Só os módulos que o servidor gateia entram aqui**, e não o menu inteiro. A
 * lista é a mesma de `ESCRITAS_POR_MODULO`, chave a chave: o que não escreve
 * nada, ou escreve por endpoint compartilhado, não tem o que ser recusado.
 *
 * **Ela é conferida contra o menu de verdade.** O teste vive na interface, que
 * é onde o menu está (`lib/__tests__/permissoes.test.ts`), e ele reprova se um
 * módulo daqui não existir no catálogo ou estiver em outra seção. É o que
 * transforma "escrito nos dois lados" em "escrito uma vez e provado".
 */
export const SECAO_DO_MODULO_GOVERNADO: Readonly<Record<string, string>> = {
  "/categorias": "dados-governanca",
  "/curadoria": "dados-governanca",
  "/importacoes": "dados-governanca",
  "/integracoes": "dados-governanca",
  "/fluxos": "processos",
  "/book-operador": "inteligencia",
  "/assistente": "inteligencia",
  "/dados": "dados-governanca",
  "/alteracoes": "auditoria",
  "/justificativas": "chamados-ambev",
  "/remunerado": "compras",
  "/configuracoes": "administracao",
};

/** A seção de um módulo governado, ou `null` quando ele não é governado aqui. */
export function secaoGovernadaDe(chaveDoModulo: string): string | null {
  return SECAO_DO_MODULO_GOVERNADO[chaveDoModulo] ?? null;
}
