/**
 * O que a tela de Categorias decide — sem React.
 *
 * A tela responde uma pergunta só: **de que lado da conta esta categoria cai?**
 * O que mora aqui é o que sustenta a resposta — quem ainda precisa dela, em que
 * ordem, o que muda quando alguém decide, e quando o botão pode habilitar.
 *
 * Mesma razão de `cockpit.ts`, `curadoria.ts` e `interpretacao.ts`: cada uma
 * dessas respostas é uma frase que alguém lê antes de mexer em classificação de
 * dinheiro, e nenhuma delas deveria precisar de um DOM montado para ser
 * conferida.
 */

export interface Categoria {
  id: string;
  code: string;
  name: string;
  /** "Custo Variável › Manutenção" — a hierarquia dita em linguagem de negócio. */
  caminho: string;
  /** A linha da DRE em que a categoria mora — o primeiro degrau do caminho. */
  sintetico: string;
  costClass: string | null;
  /** `custo_fixo` | `custo_variavel` | `cadastral` | `nao_classificado`. */
  classeCode: string | null;
  /** Quantas colunas estão nesta categoria hoje. É a materialidade. */
  atributos: number;
  isSeed: boolean;
}

export type Classe = "FIXO" | "VARIAVEL" | "NAO_E_CUSTO";

/**
 * As três casas, com o nó da árvore que cada uma é.
 *
 * O `no` é o que liga esta lista à taxonomia de verdade — é por ele que
 * `classeCode` responde "já está classificada". Escrever a lista aqui sem o nó
 * faria a tela ter uma quarta opinião sobre uma árvore que já tem dono.
 */
export const CLASSES: {
  classe: Classe;
  no: string;
  rotulo: string;
  ajuda: string;
}[] = [
  {
    classe: "FIXO",
    no: "custo_fixo",
    rotulo: "Custo fixo",
    ajuda:
      "O que se paga por ter o equipamento, rode ele ou não: financiamento, depreciação, seguros, tributos, remuneração de capital.",
  },
  {
    classe: "VARIAVEL",
    no: "custo_variavel",
    rotulo: "Custo variável",
    ajuda:
      "O que se paga por rodar: combustível, manutenção, pneus, pedágio, e o lucro variável previsto.",
  },
  {
    classe: "NAO_E_CUSTO",
    no: "cadastral",
    rotulo: "Não é custo",
    ajuda:
      "Descreve o equipamento e não entra em conta nenhuma: identificação, especificação técnica, contrato, escopo.",
  },
];

/** O nó da árvore de onde se sai — nunca um destino. */
export const SEM_CLASSE = "nao_classificado";

/** A classe em que a categoria está hoje, ou `null` quando ainda não tem. */
export function classeAtual(categoria: Categoria): Classe | null {
  return CLASSES.find((c) => c.no === categoria.classeCode)?.classe ?? null;
}

/**
 * As categorias que moram numa linha da DRE cadastrada por quem opera.
 *
 * Elas existem desde que a linha sintética passou a ser criável na tela de
 * confirmação, e sem esta função sumiriam da tela: não estão em nenhuma das
 * três casas, e não estão em "Não classificado". Uma categoria invisível é uma
 * categoria que ninguém consegue mover, e as colunas dentro dela ficariam fora
 * de todo total sem nenhuma tela dizendo onde foram parar.
 *
 * Ficam **fora** da fila de propósito, pelo mesmo motivo que uma categoria
 * cadastral fica: quem a pôs em "Receita de frete" decidiu alguma coisa, e
 * cobrar classe de custo dela seria cobrar para sempre uma decisão já tomada.
 * O que a tela oferece continua sendo mover — classificar é mover, e daqui
 * também se move.
 */
export function emOutrasLinhas(
  categorias: Categoria[],
): { linha: string; itens: Categoria[] }[] {
  const fora = categorias.filter(
    (c) =>
      c.classeCode !== null &&
      c.classeCode !== SEM_CLASSE &&
      !CLASSES.some((classe) => classe.no === c.classeCode),
  );
  const linhas = [...new Set(fora.map((c) => c.sintetico))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
  return linhas.map((linha) => ({
    linha,
    itens: fora
      .filter((c) => c.sintetico === linha)
      .sort((a, b) => b.atributos - a.atributos || a.name.localeCompare(b.name, "pt-BR")),
  }));
}

/**
 * As que ainda precisam de classe, mais pesada primeiro.
 *
 * A ordem é por quantas colunas dependem da decisão, e não alfabética: decidir
 * a classe de uma categoria com dezoito colunas dentro move dezoito colunas de
 * lado na conta; decidir a de uma categoria vazia não move nada ainda. É o
 * mesmo critério da fila de curadoria, que ordena por materialidade — o tempo
 * de quem cura vale mais onde há mais em jogo.
 *
 * Desempate pelo nome, e não pela ordem que o banco devolveu: uma lista que
 * troca de ordem entre dois carregamentos faz quem está lendo perder o lugar.
 */
export function precisamDeClasse(categorias: Categoria[]): Categoria[] {
  return categorias
    .filter((c) => c.classeCode === SEM_CLASSE)
    .sort((a, b) => b.atributos - a.atributos || a.name.localeCompare(b.name, "pt-BR"));
}

/** As já classificadas, agrupadas pela casa em que moram. */
export function jaClassificadas(
  categorias: Categoria[],
): { classe: Classe; rotulo: string; itens: Categoria[] }[] {
  return CLASSES.map(({ classe, no, rotulo }) => ({
    classe,
    rotulo,
    itens: categorias
      .filter((c) => c.classeCode === no)
      .sort((a, b) => b.atributos - a.atributos || a.name.localeCompare(b.name, "pt-BR")),
  })).filter((g) => g.itens.length > 0);
}

/**
 * A frase do topo: quantas faltam e quanto está em jogo.
 *
 * `null` quando não falta nenhuma — e a ausência é o sinal. Um texto dizendo
 * "está tudo classificado" ocuparia o mesmo espaço para não pedir nada.
 */
export function oQueFalta(categorias: Categoria[]): string | null {
  const pendentes = precisamDeClasse(categorias);
  if (pendentes.length === 0) return null;

  const colunas = pendentes.reduce((soma, c) => soma + c.atributos, 0);
  const quantas =
    pendentes.length === 1
      ? "1 categoria ainda não tem classe"
      : `${pendentes.length} categorias ainda não têm classe`;

  if (colunas === 0) {
    // Sem coluna dentro, a decisão ainda não move número nenhum — e dizer
    // "0 colunas" alarmaria à toa quem abriu a tela.
    return `${quantas}. Nenhuma coluna depende delas ainda.`;
  }
  return `${quantas}, e ${
    colunas === 1 ? "1 coluna depende" : `${colunas} colunas dependem`
  } dessa decisão para entrar do lado certo da conta.`;
}

/**
 * O que muda quando alguém classifica — dito antes de clicar.
 *
 * As duas metades importam, e a segunda é a que costuma faltar numa tela assim:
 * **o que muda daqui para a frente** e **o que não muda no que já foi
 * calculado**. `change.cost_class` é materializada quando a comparação roda;
 * reescrevê-la aqui seria a curadoria editando um resultado apurado, que é
 * exatamente o que este produto não faz.
 */
export function consequenciaDe(categoria: Categoria, classe: Classe): string {
  const rotulo = CLASSES.find((c) => c.classe === classe)!.rotulo.toLowerCase();
  const colunas =
    categoria.atributos === 0
      ? "Nenhuma coluna está nesta categoria hoje, então nada muda de lugar agora."
      : categoria.atributos === 1
        ? "1 coluna passa a entrar por aí nas telas de custo."
        : `${categoria.atributos} colunas passam a entrar por aí nas telas de custo.`;

  return (
    `"${categoria.name}" passa a viver em ${rotulo}. ${colunas} ` +
    `As comparações já calculadas seguem com a classe que tinham quando rodaram, ` +
    `e passam a refletir esta quando forem recalculadas.`
  );
}

/**
 * O botão habilita?
 *
 * A justificativa é obrigatória pela mesma régua da confirmação de semântica: a
 * classe decide de que lado da conta o dinheiro cai, e um `parent_id` que mudou
 * sem razão escrita não sustenta a auditoria que este produto existe para
 * permitir. Escolher a classe em que a categoria já está também não conta —
 * não há o que decidir ali.
 */
export function podeClassificar(
  categoria: Categoria,
  escolha: { classe: Classe | null; justificativa: string },
): boolean {
  if (!escolha.classe) return false;
  if (!escolha.justificativa.trim()) return false;
  return escolha.classe !== classeAtual(categoria);
}

/** Por que o botão está desligado, para quem não adivinha. */
export function motivoDeNaoPoder(
  categoria: Categoria,
  escolha: { classe: Classe | null; justificativa: string },
): string | null {
  if (!escolha.classe) return "Escolha uma classe.";
  if (escolha.classe === classeAtual(categoria)) {
    return `"${categoria.name}" já está aí. Escolha outra classe ou deixe como está.`;
  }
  if (!escolha.justificativa.trim()) {
    return "Escreva por que esta é a classe certa — fica registrado com a sua assinatura.";
  }
  return null;
}

/** Filtro por texto, sobre nome e caminho. Sem acento e sem caixa. */
export function filtrar(categorias: Categoria[], termo: string): Categoria[] {
  const alvo = termo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!alvo) return categorias;
  const sem = (texto: string) =>
    texto
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  return categorias.filter(
    (c) => sem(c.name).includes(alvo) || sem(c.caminho).includes(alvo),
  );
}
