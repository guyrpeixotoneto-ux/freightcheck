import type { Etapa } from "./tipos";

/**
 * A camada que separa o que o agente faz do que a pessoa vê.
 *
 * **O defeito que este arquivo existe para corrigir.** A tela mostrava, uma
 * abaixo da outra, cada evento que a orquestração emitia: "Investigando ·
 * rodada 3", "Consultando alteracoes", "Decidindo o que consultar", a frase que
 * o modelo escreve antes de pedir uma consulta. Cada uma delas é verdadeira e
 * cada uma delas é útil — para quem desenvolve. Para quem perguntou onde houve
 * a maior perda, a soma das doze é um log de execução acima da resposta: parece
 * defeito, parece lentidão, e nomeia máquina numa tela cuja regra é não nomear.
 *
 * **O desenho.** Os eventos internos continuam saindo do servidor exatamente
 * como saíam — o tracing, a lista `etapas` da resposta e o painel técnico não
 * perdem nada. O que muda é que a tela deixa de renderizá-los: aqui eles são
 * reduzidos a **uma** macroetapa, e a macroetapa vira **uma** frase escrita por
 * nós. Nenhum rótulo vindo do servidor chega ao usuário.
 *
 * **Por que o `rotulo` nunca é lido.** Ele é texto de origem interna — nome de
 * ferramenta, número de rodada, narração do modelo — e qualquer regra que o
 * filtrasse por conteúdo seria uma lista de proibições que envelhece a cada
 * ferramenta nova. Ler só `nome`, que é um identificador estável e curado aqui,
 * torna o vazamento impossível por construção: uma etapa nova que ninguém
 * mapeou não aparece, em vez de aparecer errada.
 */

/** As macroetapas que a tela sabe dizer — três, e nenhuma delas nomeia máquina. */
export type Macroetapa = "ENTENDER" | "CONSULTAR" | "APROFUNDAR";

/** O único status visível de cada vez. */
export interface StatusVisivel {
  titulo: string;
  /** Uma frase de contexto, ou `null` quando não há o que acrescentar. */
  detalhe: string | null;
}

/**
 * A ordem em que as macroetapas avançam.
 *
 * Serve para o status não andar para trás: o laço do agente intercala rodadas e
 * consultas com aprofundamentos, e sem esta ordem a linha oscilaria entre duas
 * frases — que é a mesma poluição visual, só que piscando.
 */
const ORDEM: Macroetapa[] = ["ENTENDER", "CONSULTAR", "APROFUNDAR"];

const FALA: Record<Macroetapa, StatusVisivel> = {
  ENTENDER: {
    titulo: "Analisando sua pergunta",
    detalhe: "Entendendo o que você quer saber.",
  },
  CONSULTAR: {
    titulo: "Analisando os dados",
    detalhe: "Comparando unidades, canais e principais impactos.",
  },
  APROFUNDAR: {
    titulo: "Identificando a principal causa",
    detalhe: "Medindo onde o impacto se concentra.",
  },
};

/**
 * De que macroetapa cada evento interno faz parte.
 *
 * `narracao` está deliberadamente fora: ela carrega a frase que o modelo escreve
 * enquanto decide o que consultar — raciocínio, e o que menos deve chegar à
 * tela. Fora dela ficam também os nomes que ainda não existem: o padrão de quem
 * não está no mapa é não mudar nada.
 */
const MACROETAPA: Record<string, Macroetapa> = {
  interpretar: "ENTENDER",
  reconhecerAssunto: "ENTENDER",
  planejar: "ENTENDER",
  resolverContexto: "ENTENDER",
  book: "CONSULTAR",
  consultar: "CONSULTAR",
  ferramenta: "CONSULTAR",
  buscarConceito: "CONSULTAR",
  anexar: "CONSULTAR",
  rodada: "CONSULTAR",
  calcular: "APROFUNDAR",
  aprofundar: "APROFUNDAR",
  segundoSalto: "APROFUNDAR",
};

/** Onde a tela começa enquanto nenhum evento chegou. */
export const MACROETAPA_INICIAL: Macroetapa = "ENTENDER";

/**
 * A macroetapa depois de um evento interno — que quase sempre é a mesma.
 *
 * Substituir, nunca acumular: o retorno é o estado inteiro, e a tela não guarda
 * histórico nenhum do caminho.
 */
export function avancar(atual: Macroetapa, etapa: Pick<Etapa, "nome">): Macroetapa {
  const proxima = MACROETAPA[etapa.nome];
  if (!proxima) return atual;
  return ORDEM.indexOf(proxima) > ORDEM.indexOf(atual) ? proxima : atual;
}

/** A frase que a tela mostra para uma macroetapa. */
export function frase(macroetapa: Macroetapa): StatusVisivel {
  return FALA[macroetapa];
}

/**
 * O que fica visível neste instante — e é só uma coisa de cada vez.
 *
 * Está aqui, e não espalhado em condicionais dentro do componente, porque as
 * três exclusões que importam são a mesma regra: o status some quando a
 * resposta começa a aparecer, some quando ela termina, e some quando falha.
 */
export function telaDoTurno(entrada: {
  /** A pergunta ainda está em curso. */
  pendente: boolean;
  macroetapa: Macroetapa;
  /** O texto que já chegou do servidor nesta pergunta. */
  parcial: string;
  /** A pergunta falhou. */
  erro: boolean;
}): { status: StatusVisivel | null; parcial: string | null } {
  if (entrada.erro || !entrada.pendente) return { status: null, parcial: null };
  if (entrada.parcial) return { status: null, parcial: entrada.parcial };
  return { status: frase(entrada.macroetapa), parcial: null };
}
