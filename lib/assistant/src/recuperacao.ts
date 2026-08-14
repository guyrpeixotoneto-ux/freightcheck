/**
 * Qual artigo responde esta pergunta — e quando nenhum responde.
 *
 * A parte que importa aqui não é achar o artigo certo; é o limiar. Uma busca
 * que sempre devolve o melhor colocado nunca diz "não sei", e um assistente que
 * nunca diz "não sei" responde com a mesma segurança quando sabe e quando não
 * sabe. `LIMIAR` existe para que a pergunta fora do assunto caia fora, em vez de
 * ser respondida com o artigo menos distante dela.
 */

import { ARTIGOS, type Area, type Artigo } from "./conhecimento";
import { pontuar } from "./normalizar";

export interface ArtigoRelevante {
  artigo: Artigo;
  pontos: number;
}

/**
 * Abaixo disto, o casamento é ruído.
 *
 * O valor saiu de calibragem sobre as perguntas de exemplo dos próprios artigos
 * — cada uma tem de recuperar o artigo que a declarou — e sobre perguntas
 * deliberadamente fora do assunto, que não podem recuperar nada. Os dois casos
 * estão nos testes; mexer neste número sem rodá-los é mexer no que o produto
 * afirma saber.
 */
export const LIMIAR = 0.28;

/**
 * O piso para um artigo acompanhar uma resposta que já tem dado.
 *
 * Quando o banco respondeu, o artigo é pano de fundo, e pano de fundo fraco é
 * ruído. "Quanto mudou no financiamento?" recuperava o artigo de navegação —
 * porque uma das perguntas de exemplo dele é "onde vejo o que mudou" — e a
 * resposta saía com o número certo seguido do menu inteiro do produto. O dobro
 * do limiar é o que separa "este artigo é sobre isto" de "este artigo tem uma
 * palavra em comum com isto".
 */
export const LIMIAR_DE_APOIO = LIMIAR * 2;

/**
 * Os artigos que respondem a pergunta, do mais relevante para o menos.
 *
 * A pontuação de um artigo é a melhor entre duas leituras: o quanto a pergunta
 * casa com o vocabulário dele (`termos`) e o quanto casa com alguma pergunta de
 * exemplo. As duas existem porque quem digita "book operador" e quem digita
 * "como substituo um documento" chegam ao mesmo artigo por caminhos diferentes,
 * e exigir os dois ao mesmo tempo deixaria ambos de fora.
 */
export function buscar(pergunta: string, limite = 3): ArtigoRelevante[] {
  const encontrados: ArtigoRelevante[] = [];

  for (const artigo of ARTIGOS) {
    const porTermo = pontuar(pergunta, artigo.termos);
    const porPergunta = Math.max(
      0,
      ...artigo.perguntas.map((exemplo) => pontuar(pergunta, exemplo.split(/\s+/))),
    );
    const porTitulo = pontuar(pergunta, artigo.titulo.split(/\s+/)) * 0.5;

    const pontos = Math.max(porTermo, porPergunta, porTitulo);
    if (pontos >= LIMIAR) encontrados.push({ artigo, pontos });
  }

  return encontrados.sort((a, b) => b.pontos - a.pontos).slice(0, limite);
}

/** As áreas que a pergunta tocou — usado para decidir que dado ir buscar. */
export function areasDaPergunta(relevantes: ArtigoRelevante[]): Area[] {
  const vistas = new Set<Area>();
  for (const { artigo } of relevantes) vistas.add(artigo.area);
  return [...vistas];
}
