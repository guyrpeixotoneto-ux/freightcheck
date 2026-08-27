import type { Conexao, Etapa, PosicaoDaEtapa } from "./modelo";

/**
 * O layout automático — onde as etapas ficam quando ninguém as arrastou ainda.
 *
 * Um fluxo recém-criado, ou recém-importado de uma declaração, tem todas as
 * etapas em (0, 0). Sem isto, a primeira abertura mostraria dezesseis cartões
 * empilhados no canto e a única saída seria arrastar um por um — que é
 * exatamente a fricção que faz um cadastro nunca ser usado.
 *
 * O algoritmo é o mais simples que produz um desenho legível, e a escolha é
 * deliberada: **níveis por distância da origem** (uma busca em largura sobre o
 * grafo), um nível por linha vertical, os irmãos distribuídos na horizontal.
 * Não é dot, não é Sugiyama, não minimiza cruzamento de arestas. Ele acerta os
 * dois casos que este módulo tem: o processo em corrente com alguns desvios, e
 * a decisão que abre dois ramos.
 *
 * **É puro, e nunca sobrescreve o que alguém posicionou.** Quem chama decide
 * (`somenteSemPosicao`); o padrão é aplicar só a quem está na origem, para que
 * "organizar" não desmanche o arranjo que alguém montou à mão. Ser função pura
 * é o que o torna testável sem banco e sem tela — e é onde a prova de que o
 * desenho não é uma lista vertical disfarçada realmente cabe.
 */

/** A largura de um cartão mais o respiro. Espelha o CSS do nó no canvas. */
export const PASSO_X = 260;
/** A altura de uma faixa. Sobra para o rótulo da seta caber entre duas. */
export const PASSO_Y = 150;

export interface OpcoesDeLayout {
  /** Só reposiciona quem está exatamente em (0,0). Padrão: `true`. */
  somenteSemPosicao?: boolean;
}

/**
 * Ordena a lista de etapas em níveis a partir das raízes do grafo.
 *
 * Raiz é quem não recebe nenhuma conexão. Um fluxo que só tem ciclo — todo
 * mundo recebe alguma seta — não tem raiz, e aí a raiz é a etapa de menor
 * `ordem`: sem esse desempate a busca em largura não começaria e o layout
 * devolveria a pilha no canto, que é o defeito que ele existe para não ter.
 */
export function niveisDoFluxo(etapas: Etapa[], conexoes: Conexao[]): string[][] {
  if (etapas.length === 0) return [];

  const existe = new Set(etapas.map((e) => e.id));
  const saidas = new Map<string, string[]>();
  const grauDeEntrada = new Map<string, number>();
  for (const etapa of etapas) {
    saidas.set(etapa.id, []);
    grauDeEntrada.set(etapa.id, 0);
  }
  for (const conexao of conexoes) {
    if (!existe.has(conexao.origemEtapaId) || !existe.has(conexao.destinoEtapaId)) continue;
    saidas.get(conexao.origemEtapaId)!.push(conexao.destinoEtapaId);
    grauDeEntrada.set(conexao.destinoEtapaId, (grauDeEntrada.get(conexao.destinoEtapaId) ?? 0) + 1);
  }

  const porOrdem = [...etapas].sort(
    (a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"),
  );

  const raizes = porOrdem.filter((e) => (grauDeEntrada.get(e.id) ?? 0) === 0).map((e) => e.id);
  const fila: string[] = raizes.length > 0 ? [...raizes] : [porOrdem[0].id];

  const nivelDe = new Map<string, number>();
  for (const id of fila) nivelDe.set(id, 0);

  /*
    Largura, e não profundidade: numa decisão que abre dois ramos, a busca em
    profundidade empurraria o primeiro ramo inteiro para baixo antes de olhar o
    segundo, e os dois lados da mesma decisão apareceriam em alturas
    completamente diferentes. Em largura eles ficam lado a lado, que é como uma
    decisão se lê.

    Um nó já visitado não é revisitado — é o que faz o ciclo do retrabalho
    terminar. A volta continua desenhada como seta; ela só não empurra a etapa
    de destino para um nível novo, porque ela já tem o dela.
  */
  for (let i = 0; i < fila.length; i += 1) {
    const atual = fila[i];
    const nivel = nivelDe.get(atual)!;
    for (const destino of saidas.get(atual) ?? []) {
      if (nivelDe.has(destino)) continue;
      nivelDe.set(destino, nivel + 1);
      fila.push(destino);
    }
  }

  /*
    O que sobrou não é alcançável a partir de raiz nenhuma — uma etapa
    desconectada, ou uma ilha de etapas ligadas só entre si. Vai para o fim, em
    níveis próprios, em vez de sumir: uma etapa cadastrada e não desenhada é
    pior do que uma etapa desenhada solta, porque quem cadastrou não descobre
    que esqueceu de ligá-la.
  */
  let proximo = Math.max(-1, ...nivelDe.values()) + 1;
  for (const etapa of porOrdem) {
    if (!nivelDe.has(etapa.id)) {
      nivelDe.set(etapa.id, proximo);
      proximo += 1;
    }
  }

  const niveis: string[][] = [];
  for (const etapa of porOrdem) {
    const nivel = nivelDe.get(etapa.id)!;
    (niveis[nivel] ??= []).push(etapa.id);
  }
  return niveis.map((n) => n ?? []);
}

/** As posições calculadas, prontas para o `PUT /fluxos/:id/posicoes`. */
export function posicionarEtapas(
  etapas: Etapa[],
  conexoes: Conexao[],
  opcoes: OpcoesDeLayout = {},
): PosicaoDaEtapa[] {
  const somenteSemPosicao = opcoes.somenteSemPosicao ?? true;
  const niveis = niveisDoFluxo(etapas, conexoes);
  const porId = new Map(etapas.map((e) => [e.id, e]));

  const posicoes: PosicaoDaEtapa[] = [];
  niveis.forEach((idsDoNivel, indiceDoNivel) => {
    /*
      Centralizado: um nível com três irmãos fica simétrico em torno do eixo do
      nível de um só, em vez de todos crescerem para a direita. É a diferença
      entre um fluxograma e uma escada.
    */
    const deslocamento = ((idsDoNivel.length - 1) * PASSO_X) / 2;
    idsDoNivel.forEach((id, indice) => {
      const etapa = porId.get(id);
      if (!etapa) return;
      if (somenteSemPosicao && (etapa.posX !== 0 || etapa.posY !== 0)) return;
      posicoes.push({
        etapaId: id,
        posX: Math.round(indice * PASSO_X - deslocamento),
        posY: indiceDoNivel * PASSO_Y,
      });
    });
  });
  return posicoes;
}

/**
 * O fluxo tem ciclo? Responde sim para o retrabalho, e a resposta é informação,
 * não recusa.
 *
 * A tela usa isto para dizer "este processo tem retorno" no cabeçalho; nada
 * neste módulo impede um ciclo (ver `validarEntradaDeConexao`). Existe como
 * função separada, e testada, porque "ciclos são permitidos" é uma decisão
 * explícita deste projeto e uma decisão explícita merece uma prova.
 */
export function temCiclo(etapas: Etapa[], conexoes: Conexao[]): boolean {
  const saidas = new Map<string, string[]>();
  for (const etapa of etapas) saidas.set(etapa.id, []);
  for (const conexao of conexoes) {
    saidas.get(conexao.origemEtapaId)?.push(conexao.destinoEtapaId);
  }

  const BRANCO = 0;
  const CINZA = 1;
  const PRETO = 2;
  const cor = new Map<string, number>(etapas.map((e) => [e.id, BRANCO]));

  /* Iterativo, e não recursivo: um fluxo grande não pode estourar a pilha. */
  for (const raiz of etapas) {
    if (cor.get(raiz.id) !== BRANCO) continue;
    const pilha: Array<{ id: string; i: number }> = [{ id: raiz.id, i: 0 }];
    cor.set(raiz.id, CINZA);
    while (pilha.length > 0) {
      const topo = pilha[pilha.length - 1];
      const vizinhos = saidas.get(topo.id) ?? [];
      if (topo.i >= vizinhos.length) {
        cor.set(topo.id, PRETO);
        pilha.pop();
        continue;
      }
      const destino = vizinhos[topo.i];
      topo.i += 1;
      const corDoDestino = cor.get(destino);
      if (corDoDestino === CINZA) return true;
      if (corDoDestino === BRANCO) {
        cor.set(destino, CINZA);
        pilha.push({ id: destino, i: 0 });
      }
    }
  }
  return false;
}
