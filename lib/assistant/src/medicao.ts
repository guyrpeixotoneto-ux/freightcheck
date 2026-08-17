/**
 * O que aconteceu com esta resposta — medido, não deduzido.
 *
 * **O buraco que este módulo fecha.** A resposta já dizia `redacao:
 * "DETERMINISTICA"`, e essa palavra cobria cinco situações que exigem ações
 * opostas: não há chave configurada; a chamada foi desligada por quem chamou; o
 * modelo escreveu e a trava descartou; o modelo recusou; a API falhou. Pior:
 * `tecnico.ia` ficava `null` nas duas primeiras, então nem "houve chamada?" era
 * respondível pela resposta — só por quem estivesse lendo o servidor no
 * instante. Um produto que existe para tornar número auditável não pode ser
 * opaco sobre quem escreveu o texto ao lado do número.
 *
 * **Nada aqui muda comportamento.** Este módulo só observa: ele não decide
 * redação, não altera o dossiê, não chama o modelo. Ele lê o que já foi
 * decidido e escreve por extenso. É condição para a migração ao agente — sem
 * uma régua de antes, "o agente melhorou" seria opinião.
 *
 * **A conta do contexto é feita pela função que monta o contexto de verdade.**
 * `contextoParaOModelo` chama `dossieEmTexto`, a mesma de `llm.ts`. Reimplementar
 * a renderização aqui produziria uma medição que concorda com o código no dia em
 * que foi escrita e diverge em silêncio na primeira mudança — que é exatamente o
 * defeito que a numeração de citações já teve, em três cópias.
 */

import {
  CARACTERES_DA_INSTRUCAO,
  LIMITE_DO_TURNO,
  TURNOS_NO_HISTORICO,
  dossieEmTexto,
  type TurnoAnterior,
} from "./llm";
import { itensCitaveis, type Dossie } from "./orquestrador";

// ── Por que este texto foi escrito por quem escreveu ────────────────────────

/**
 * A causa exata da redação, em código fechado.
 *
 * `IA_DESLIGADA` e `SEM_CHAVE` são coisas diferentes e chegavam iguais à tela:
 * a primeira é uma escolha de quem chamou (as evals e o painel passam
 * `semIa`), a segunda é ambiente faltando. A primeira não é defeito nenhum; a
 * segunda é meia hora de configuração.
 */
export type CausaDaRedacao =
  /** O modelo escreveu e o texto passou inteiro. */
  | "IA_OK"
  /** O modelo escreveu, uma frase ou outra saiu, o resto valeu. */
  | "IA_PODADA"
  /** O modelo escreveu e a trava descartou tudo: sobrou pouco demais. */
  | "DESCARTADA"
  /** O classificador da API recusou o pedido. */
  | "RECUSA"
  /** A chamada falhou — rede, cota, erro do provedor. */
  | "ERRO"
  /** Não há chave no processo. */
  | "SEM_CHAVE"
  /** Quem chamou pediu para não usar modelo. */
  | "IA_DESLIGADA";

export interface MotorDaResposta {
  /** Quem escreveu o texto que a pessoa leu. */
  redigiu: "IA" | "DETERMINISTICA";
  /** Houve uma chamada de verdade à Anthropic nesta pergunta? */
  houveChamada: boolean;
  codigo: CausaDaRedacao;
  /** A causa em português, com os números que a sustentam. */
  causa: string;
}

/** As causas em que o produto respondeu sem nunca ter falado com o modelo. */
export const SEM_CHAMADA: ReadonlySet<CausaDaRedacao> = new Set<CausaDaRedacao>([
  "SEM_CHAVE",
  "IA_DESLIGADA",
]);

export function explicarRedacao(entrada: {
  codigo: CausaDaRedacao;
  frasesPodadas: number;
  frasesTotais: number;
  numerosRecusados: string[];
  erro: string | null;
}): MotorDaResposta {
  const { codigo, frasesPodadas, frasesTotais, numerosRecusados, erro } = entrada;
  const recusados = numerosRecusados.length > 0 ? ` — recusados: ${numerosRecusados.join(", ")}` : "";

  const causa: Record<CausaDaRedacao, string> = {
    IA_OK: "o modelo escreveu e o texto passou inteiro pela trava de lastro",
    IA_PODADA:
      `o modelo escreveu; ${frasesPodadas} de ${frasesTotais} frases saíram por número ` +
      `sem lastro ou citação sem fonte${recusados}`,
    DESCARTADA:
      `o modelo escreveu e a trava descartou tudo: ${frasesPodadas} de ${frasesTotais} ` +
      `frases não se sustentavam (o limite é um terço)${recusados}`,
    RECUSA: "o classificador da API recusou o pedido; nenhum texto voltou",
    ERRO: `a chamada falhou: ${erro ?? "sem detalhe"}`,
    SEM_CHAVE:
      "não há ANTHROPIC_API_KEY nem ANTHROPIC_AUTH_TOKEN neste processo — " +
      "nenhuma chamada foi feita",
    IA_DESLIGADA: "quem chamou pediu para não usar modelo (semIa)",
  };

  return {
    redigiu: codigo === "IA_OK" || codigo === "IA_PODADA" ? "IA" : "DETERMINISTICA",
    houveChamada: !SEM_CHAMADA.has(codigo),
    codigo,
    causa: causa[codigo],
  };
}

// ── O que foi (ou teria sido) entregue ao modelo ────────────────────────────

export interface ContextoParaOModelo {
  /** Quantos itens citáveis, por tipo. É o material que sustenta afirmação. */
  itens: { conceito: number; book: number; dado: number; arquivo: number; total: number };
  /**
   * Quantos **fatos visíveis** as evidências trazem.
   *
   * Separado da contagem de evidências de propósito: uma consulta que devolve
   * três agregados e uma que devolve quarenta linhas contam como "1 evidência"
   * e não respondem a mesma pergunta. É esta contagem que mostra um dossiê
   * chegando magro ao modelo.
   */
  fatos: number;
  /** As seções que o dossiê teve, na ordem em que o modelo as lê. */
  secoes: string[];
  caracteres: {
    /** A instrução do sistema — igual em toda pergunta, e com cache. */
    instrucao: number;
    /** O dossiê desta pergunta. */
    dossie: number;
    /** Os turnos anteriores, já cortados pelos limites de `llm.ts`. */
    historico: number;
  };
  /** Turnos efetivamente enviados, depois do corte. */
  turnos: number;
  /** Arquivos que vão como bloco nativo (PDF, imagem). */
  anexos: number;
  /** Lacunas declaradas no dossiê, por tipo. */
  lacunas: string[];
  /**
   * O dossiê inteiro, como texto — só quando quem chamou pediu.
   *
   * Fica atrás de opção porque é grande e porque é material interno: a rota
   * comum devolve as contagens, que respondem "o modelo tinha com que
   * responder?"; a bateria pede o texto, que responde "com o quê, exatamente?".
   */
  dossie: string | null;
}

const ORDEM_DAS_SECOES: [keyof ContextoParaOModelo["itens"] | "lacunas", string][] = [
  ["conceito", "CONCEITO"],
  ["book", "BOOK DO OPERADOR"],
  ["dado", "EVIDÊNCIA"],
  ["arquivo", "ARQUIVOS"],
];

export function contextoParaOModelo(
  dossie: Dossie,
  opcoes: { historico?: TurnoAnterior[]; incluirTexto?: boolean } = {},
): ContextoParaOModelo {
  const itens = itensCitaveis(dossie);
  const contagem = {
    conceito: itens.filter((i) => i.tipo === "CONCEITO").length,
    book: itens.filter((i) => i.tipo === "BOOK").length,
    /*
      A mesma regra de `emTexto`: uma evidência cujos fatos são todos internos
      não chega ao modelo. Contá-la aqui faria a medição afirmar um material
      que o modelo nunca viu.
    */
    dado: itens.filter(
      (i) => i.tipo === "DADO" && i.evidencia.fatos.some((f) => !f.interno),
    ).length,
    arquivo: itens.filter((i) => i.tipo === "ARQUIVO").length,
    total: 0,
  };
  contagem.total = contagem.conceito + contagem.book + contagem.dado + contagem.arquivo;

  const secoes = ORDEM_DAS_SECOES.filter(([chave]) => {
    if (chave === "lacunas") return dossie.lacunas.length > 0;
    return contagem[chave as keyof typeof contagem] > 0;
  }).map(([, rotulo]) => rotulo);
  if (dossie.lacunas.length > 0) secoes.push("O QUE FALTA");

  const texto = dossieEmTexto(dossie);

  /*
    O histórico é contado como `montarMensagens` o envia — os últimos N turnos,
    cada um cortado. Contar o histórico inteiro diria ao leitor que o modelo viu
    uma conversa que ele não viu.
  */
  const enviados = (opcoes.historico ?? [])
    .slice(-TURNOS_NO_HISTORICO)
    .map((t) => t.texto.trim())
    .filter(Boolean)
    .map((t) => t.slice(0, LIMITE_DO_TURNO));

  return {
    itens: contagem,
    fatos: dossie.evidencias.reduce(
      (soma, e) => soma + e.fatos.filter((f) => !f.interno).length,
      0,
    ),
    secoes,
    caracteres: {
      instrucao: CARACTERES_DA_INSTRUCAO,
      dossie: texto.length,
      historico: enviados.reduce((soma, t) => soma + t.length, 0),
    },
    turnos: enviados.length,
    anexos: dossie.anexos.length,
    lacunas: dossie.lacunas.map((l) => l.tipo),
    dossie: opcoes.incluirTexto ? texto : null,
  };
}

// ── Quantas investigações diferentes aconteceram ────────────────────────────

/**
 * A trajetória de um caso, como assinatura comparável.
 *
 * **A ordem é a informação.** `recortes → alteracoes` é descobrir que vigências
 * existem e então olhar uma; `alteracoes → recortes` é olhar o que mudou e
 * então perguntar de quando isso é. São duas investigações, e a segunda só
 * acontece quando o modelo percebeu que precisava situar o que já tinha visto.
 *
 * **A repetição também.** Uma consulta feita duas vezes com argumentos
 * diferentes — `alteracoes(grupos)` e depois `alteracoes(linhas)` — é o gesto
 * que separa "listou" de "investigou". Colapsá-la apaga exatamente o
 * comportamento que a métrica existe para enxergar.
 *
 * A versão anterior fazia `consultas.slice().sort().join(",")`, e as duas
 * perdas aconteciam de uma vez. O efeito não foi contar um pouco menos: foi
 * **inverter o diagnóstico**. A métrica relatou trajetórias caindo de 2 para 1
 * numa rodada em que o relatório de trajetórias, ao lado, mostrava nove
 * caminhos distintos com até onze chamadas encadeadas. Lida sozinha, ela dizia
 * que o agente havia convergido para uma consulta só — a conclusão oposta à
 * verdade, sobre a única pergunta que a bateria existe para responder.
 */
export function assinaturaDeTrajetoria(consultas: readonly string[]): string {
  return consultas.join(" → ");
}

/**
 * Quantas trajetórias distintas houve num conjunto de casos.
 *
 * É a medida de "perguntas diferentes produzem investigações diferentes" — a
 * tese inteira do caminho do agente. Um caminho determinístico tende ao número
 * de intenções que ele sabe distinguir; um agente que investiga tende ao número
 * de perguntas.
 */
export function trajetoriasDistintas(casos: readonly (readonly string[])[]): number {
  return new Set(casos.map(assinaturaDeTrajetoria)).size;
}
