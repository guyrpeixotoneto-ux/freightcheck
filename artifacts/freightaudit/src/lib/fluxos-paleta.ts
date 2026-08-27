import type { Catalogo, Etapa, TipoDeEtapaNoCatalogo } from "@/lib/fluxos";
import { PASSO_Y } from "@/lib/fluxos-visoes";

/** A caixa do cartão no canvas. Espelha o CSS de `no-da-etapa.tsx`. */
const LARGURA_DO_CARTAO = 200;
const ALTURA_DO_CARTAO = 72;

/**
 * A PALETA DE ELEMENTOS — a regra por trás da janela de seleção.
 *
 * A tela nova é uma coluna à esquerda do canvas com os elementos do processo
 * agrupados e buscáveis: escolhe-se um, arrasta-se para o desenho, e nasce uma
 * etapa daquele tipo no ponto onde o dedo soltou. É a experiência de quadro
 * branco que o pedido citou, e ela vive **aqui** — em funções puras — porque a
 * parte que decide o que aparece, em que grupo e com que nome é exatamente a
 * parte que dá para provar num teste.
 *
 * ---------------------------------------------------------------------------
 * Os elementos são os do catálogo, e não uma lista desenhada nesta tela
 * ---------------------------------------------------------------------------
 *
 * Uma paleta com formas soltas — "retângulo", "losango", "cilindro" — seria
 * bonita e inútil: o que este produto grava não é uma forma, é uma **etapa de
 * um tipo**, com cor, ícone e significado que o servidor conhece
 * (`TIPOS_DE_ETAPA` em `@workspace/fluxos`). Por isso a paleta é montada a
 * partir do catálogo servido pela API. Um tipo novo no servidor aparece na
 * janela sozinho; nenhum tipo pode existir na janela e ser recusado na
 * gravação.
 *
 * O agrupamento é o único juízo que esta tela acrescenta, e ele é por
 * **intenção de leitura** — onde começa e termina, o que executa, o que decide
 * e o que trava. Um tipo que o servidor passe a servir e que não esteja em
 * nenhum grupo cai em "Outros elementos" em vez de sumir: um elemento
 * cadastrado e invisível é pior do que um elemento no grupo errado, porque
 * ninguém descobre que ele existe.
 */

export interface GrupoDaPaleta {
  valor: string;
  rotulo: string;
  /** A frase curta que explica o grupo — o subtítulo da seção. */
  descricao: string;
  itens: TipoDeEtapaNoCatalogo[];
}

interface DefinicaoDeGrupo {
  valor: string;
  rotulo: string;
  descricao: string;
  tipos: readonly string[];
}

export const GRUPOS_DA_PALETA: readonly DefinicaoDeGrupo[] = [
  {
    valor: "marcos",
    rotulo: "Começo e fim",
    descricao: "As pontas do processo.",
    tipos: ["INICIO", "FIM"],
  },
  {
    valor: "execucao",
    rotulo: "Execução",
    descricao: "O que alguém — ou algum sistema — faz.",
    tipos: ["PROCESSO", "SISTEMA", "DOCUMENTO"],
  },
  {
    valor: "controle",
    rotulo: "Decisão e controle",
    descricao: "Onde o caminho se divide, se confere ou trava.",
    tipos: ["DECISAO", "VALIDACAO", "PENDENCIA"],
  },
];

const GRUPO_DE_SOBRA: DefinicaoDeGrupo = {
  valor: "outros",
  rotulo: "Outros elementos",
  descricao: "Tipos servidos pelo catálogo que ainda não têm grupo.",
  tipos: [],
};

/**
 * O texto comparável de uma busca: sem acento, sem caixa, sem sobra.
 *
 * "decisao" precisa achar "Decisão" — quem digita rápido não põe til, e uma
 * busca que ignora isso faz a pessoa concluir que o elemento não existe.
 */
export function normalizarBusca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Os grupos que a janela desenha, já filtrados pela busca.
 *
 * A busca varre rótulo **e** descrição: quem procura "aprova" chega em
 * "Validação" pela frase que a explica, e não só por um nome que ela teria que
 * adivinhar. Grupo que ficou sem item some da lista — uma seção vazia com um
 * título é ruído entre os resultados.
 */
export function montarPaleta(
  catalogo: Pick<Catalogo, "tiposDeEtapa"> | undefined,
  busca = "",
): GrupoDaPaleta[] {
  const tipos = catalogo?.tiposDeEtapa ?? [];
  const termo = normalizarBusca(busca);

  const combina = (tipo: TipoDeEtapaNoCatalogo) =>
    termo === "" ||
    normalizarBusca(`${tipo.rotulo} ${tipo.descricao} ${tipo.valor}`).includes(
      termo,
    );

  const agrupados = new Set<string>();
  const grupos: GrupoDaPaleta[] = [];

  for (const definicao of GRUPOS_DA_PALETA) {
    const itens: TipoDeEtapaNoCatalogo[] = [];
    for (const valor of definicao.tipos) {
      const tipo = tipos.find((t) => t.valor === valor);
      if (!tipo) continue;
      agrupados.add(valor);
      if (combina(tipo)) itens.push(tipo);
    }
    if (itens.length > 0) grupos.push({ ...definicao, itens });
  }

  const sobra = tipos.filter((t) => !agrupados.has(t.valor)).filter(combina);
  if (sobra.length > 0) grupos.push({ ...GRUPO_DE_SOBRA, itens: sobra });

  return grupos;
}

/**
 * Quantos elementos a busca encontrou — para dizer "nada aqui" com precisão.
 */
export function totalDaPaleta(grupos: GrupoDaPaleta[]): number {
  return grupos.reduce((soma, grupo) => soma + grupo.itens.length, 0);
}

// ---------------------------------------------------------------------------
// O arrasto — o que atravessa do botão da paleta até o canvas
// ---------------------------------------------------------------------------

/**
 * O tipo MIME do arrasto.
 *
 * Um tipo próprio, e não só `text/plain`: assim o canvas aceita o que saiu
 * desta paleta e ignora um texto qualquer arrastado de outra janela do
 * navegador, que de outro modo viraria uma etapa sem que ninguém pedisse.
 */
export const MIME_DO_ELEMENTO = "application/x-freightcheck-elemento";

export function escreverArrasto(dados: DataTransfer, tipo: string): void {
  dados.setData(MIME_DO_ELEMENTO, tipo);
  dados.effectAllowed = "copy";
}

/** O tipo de etapa que veio no arrasto, ou `null` quando não é coisa nossa. */
export function lerArrasto(dados: DataTransfer): string | null {
  const tipo = dados.getData(MIME_DO_ELEMENTO);
  return tipo === "" ? null : tipo;
}

// ---------------------------------------------------------------------------
// O que a etapa recém-nascida traz consigo
// ---------------------------------------------------------------------------

/**
 * O nome de quem acabou de nascer — e por que ele não é vazio.
 *
 * O servidor recusa etapa sem nome (`ETAPA_SEM_NOME`), e é bom que recuse. Mas
 * um formulário aberto a cada elemento arrastado mataria o gesto: no quadro
 * branco a forma cai primeiro e o texto vem depois. Então a etapa nasce com o
 * rótulo do próprio tipo, numerado quando repete — "Decisão", "Decisão 2" —, e
 * quem arrastou renomeia no painel de detalhe, que já abre selecionado.
 */
export function nomeSugerido(
  tipo: TipoDeEtapaNoCatalogo,
  etapas: Etapa[],
): string {
  const base = tipo.rotulo;
  const usados = new Set(etapas.map((e) => e.nome.trim()));
  if (!usados.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidato = `${base} ${n}`;
    if (!usados.has(candidato)) return candidato;
  }
  return base;
}

/**
 * Onde o elemento cai quando ninguém disse onde.
 *
 * Clicar num elemento (em vez de arrastá-lo) e soltar num desenho cujas
 * posições são **calculadas** — o horizontal, as raias, o mapa — são os dois
 * casos em que não existe um ponto do canvas para obedecer. Nesses, a etapa
 * nasce abaixo da última, na coluna dela: é onde o olho já está e é o único
 * lugar que não cobre um cartão existente.
 *
 * O empilhamento na origem, que é o que aconteceria com `(0, 0)`, é justamente
 * o defeito que o botão "Organizar" existe para consertar — não vale a pena
 * criá-lo de novo aqui.
 */
export function proximaPosicaoLivre(etapas: Etapa[]): {
  posX: number;
  posY: number;
} {
  if (etapas.length === 0) return { posX: 0, posY: 0 };
  const fundo = etapas.reduce((maior, etapa) =>
    etapa.posY > maior.posY ? etapa : maior,
  );
  return { posX: fundo.posX, posY: fundo.posY + PASSO_Y };
}

/**
 * O ponto solto no canvas, ajustado para o cursor ficar no meio do cartão.
 *
 * `screenToFlowPosition` devolve onde o dedo soltou; o React Flow posiciona o
 * nó pelo canto superior esquerdo. Sem esta correção o cartão aparece deslocado
 * para baixo e para a direita do lugar onde foi solto — pequeno o bastante para
 * ninguém saber explicar, grande o bastante para o desenho sair torto.
 */
export function ajustarSolto(ponto: { x: number; y: number }): {
  posX: number;
  posY: number;
} {
  return {
    posX: Math.round(ponto.x - LARGURA_DO_CARTAO / 2),
    posY: Math.round(ponto.y - ALTURA_DO_CARTAO / 2),
  };
}
