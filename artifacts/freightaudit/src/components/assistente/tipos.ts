/** O que a rota do assistente devolve. Espelha `lib/assistant/src/resposta.ts`. */

export interface Fonte {
  id: string;
  tipo: "CATALOGO" | "BOOK" | "ARTIGO" | "DADO";
  titulo: string;
  origem: string;
  detalhe?: string;
  tela?: { label: string; href: string };
}

export interface Lacuna {
  tipo: "NAO_ENCONTREI" | "NAO_EXISTE_NO_PRODUTO" | "CONCEITO_SEM_DADO" | "DADO_SEM_PRECO";
  explicacao: string;
}

export interface Etapa {
  nome: string;
  rotulo: string;
}

export interface Resposta {
  pergunta: string;
  texto: string;
  redacao: "IA" | "DETERMINISTICA";
  modelo: string | null;
  intencao: string;
  recorte: string | null;
  fontes: Fonte[];
  etapas: Etapa[];
  lacunas: Lacuna[];
  sugestoes: string[];
  desambiguacao: { termo: string; opcoes: string[] } | null;
  tecnico: {
    intencao: string;
    porque: string;
    herdado: string[];
    ferramentas: string[];
    numerosRecusados: string[];
    /**
     * A investigação do agente — `null` no caminho determinístico.
     *
     * A API devolve este campo desde o PR 2 e o tipo da tela não o tinha: a
     * trajetória que decide se o agente investiga ou só consulta muito — quantas
     * rodadas, quais argumentos, e qual consulta derivou de qual — chegava ao
     * navegador e era descartada na fronteira do TypeScript. Avaliar um canário
     * sem isso é opinar sobre a prosa.
     */
    agente: {
      rodadas: number;
      consultas: number;
      parou: string;
      chamadas: {
        nome: string;
        argumentos: Record<string, unknown>;
        ok: boolean;
        erro: string | null;
        evidencias: number;
        /** Índice da consulta de cujo resultado esta saiu. */
        derivaDe: number | null;
      }[];
    } | null;
    /** O rastro que explica esta resposta depois que ela aconteceu. */
    rastro: {
      assunto: string | null;
      comoReconheceu: string | null;
      necessidades: string[];
      book: { candidatos: number; selecionados: number; melhorPontuacao: number };
      etapas: { nome: string; ms: number }[];
      orquestracaoMs: number;
      frasesPodadas: number;
      frasesTotais: number;
    };
    /** Quem escreveu o texto e por quê — sempre presente, inclusive sem chamada. */
    motor: {
      redigiu: "IA" | "DETERMINISTICA";
      houveChamada: boolean;
      codigo:
        | "IA_OK" | "IA_PODADA" | "DESCARTADA"
        | "RECUSA" | "ERRO" | "SEM_CHAVE" | "IA_DESLIGADA";
      causa: string;
    };
    /** O material que foi entregue ao modelo — ou que teria sido. */
    contexto: {
      itens: { conceito: number; book: number; dado: number; arquivo: number; total: number };
      fatos: number;
      secoes: string[];
      caracteres: { instrucao: number; dossie: number; historico: number };
      turnos: number;
      anexos: number;
      lacunas: string[];
      /** Só vem preenchido quando a chamada pediu diagnóstico. */
      dossie: string | null;
    };
    /** O que aconteceu com a chamada ao modelo — `null` quando não houve uma. */
    ia: {
      desfecho: "IA" | "PODADA" | "DESCARTADA" | "RECUSA" | "ERRO" | "SEM_CHAVE";
      modelo: string;
      latenciaMs: number;
      erro: string | null;
      tokensEntrada: number;
      tokensSaida: number;
      origemDosTokens: "usage" | "estimativa";
      custoUsd: number;
    } | null;
  };
  conversationId: string;
  conversationTitle: string;
  /** O id da resposta gravada — o que a tela usa para votar. */
  messageId?: string | null;
}

/** Uma linha da conversa na tela. */
export interface Turno {
  /** O id da mensagem no banco — só existe depois de ela ser gravada. */
  mensagemId?: string;
  conversaId?: string;
  papel: "PERGUNTA" | "RESPOSTA";
  texto: string;
  resposta?: Resposta;
}

export interface ConversaResumo {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
}

export interface Capacidades {
  ia: boolean;
  modelo: string | null;
  /**
   * Qual cérebro responde a quem está perguntando: AGENTE ou PLANEJADOR.
   *
   * A rota devolve isto desde que a flag por usuário existe, e sem ele quem
   * testa não tem como saber qual dos dois avaliou — as duas respostas chegam
   * pela mesma rota, com a mesma cara. Uma avaliação de experiência feita sobre
   * o caminho errado é pior do que nenhuma.
   */
  cerebro: "AGENTE" | "PLANEJADOR";
  trechos: number;
  corpora: { catalogo: number; book: number; artigos: number };
}
