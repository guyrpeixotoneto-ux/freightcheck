/**
 * O que a próxima pergunta herda da anterior.
 *
 * **Estado estruturado, não histórico reenviado.** "E julho?" não precisa das
 * mensagens anteriores — precisa saber que o assunto era IPVA, que a intenção
 * era evolução, e em que unidade e canal aquilo foi lido. Guardar isso em
 * campos nomeados tem três vantagens sobre reenviar a conversa inteira ao
 * modelo: funciona sem modelo, é testável sem rede, e não cresce sem limite.
 *
 * **O que não fica aqui.** Nenhum número. O estado carrega *sobre o que* se
 * falava, nunca *o que se respondeu* — com uma exceção nomeada, as evidências
 * da última resposta, que existem para que "por quê?" possa apontar a origem do
 * que acabou de ser dito. Guardar o número respondido e reusá-lo na próxima
 * pergunta seria servir dado velho com cara de consulta nova.
 */

import type { Intencao, PeriodoPedido } from "./interpretacao";
import type { Evidencia } from "./ferramentas";
import type { Dossie } from "./orquestrador";

export interface EstadoDaConversa {
  /** O que se estava perguntando. */
  intencao: Intencao | null;
  /** O termo que nomeava a gaveta, como a pessoa o escreveu. */
  termoDoParametro: string | null;
  /** A gaveta resolvida — para a tela poder mostrá-la. */
  parametro: string | null;
  periodo: PeriodoPedido | null;
  intervalo: { de: PeriodoPedido; ate: PeriodoPedido | null } | null;
  /**
   * O bloco do Book de que a conversa estava falando.
   *
   * É o que faz "qual a frequência?" continuar dentro do QLP ADM. Sem ele, a
   * pergunta de continuidade — que por definição não repete o assunto — casa
   * "mensal" em qualquer bloco que fale de periodicidade, e a resposta é
   * verdadeira sobre outro documento. `termoDoParametro` não resolve isto: ele
   * guarda o que a pessoa **escreveu**, e o bloco é o que a busca **encontrou**.
   */
  blocoDoBook: string | null;
  /** O recorte em que a conversa está. */
  scopeHash: string | null;
  canal: string | null;
  contexto: string | null;
  /**
   * As evidências da última resposta.
   *
   * Só isto, e só para "por quê?" / "de onde veio esse número?". Não são
   * reusadas para responder outra coisa: uma pergunta nova refaz as consultas.
   */
  evidenciasAnteriores: Evidencia[];
}

export const ESTADO_VAZIO: EstadoDaConversa = {
  intencao: null,
  termoDoParametro: null,
  parametro: null,
  blocoDoBook: null,
  periodo: null,
  intervalo: null,
  scopeHash: null,
  canal: null,
  contexto: null,
  evidenciasAnteriores: [],
};

/**
 * O estado depois desta resposta.
 *
 * A regra é herdar o que a pergunta não contradisse: se ela nomeou um
 * parâmetro, o assunto passa a ser esse; se não nomeou nenhum, o assunto
 * continua o de antes. É o que faz "E julho?" manter o IPVA e "E o pneu?"
 * trocá-lo — sem nenhum caso especial para essas duas frases.
 */
export function avancarEstado(
  anterior: EstadoDaConversa | null,
  dossie: Dossie,
): EstadoDaConversa {
  const base = anterior ?? ESTADO_VAZIO;
  const { plano, leitura } = dossie;

  /*
    A vigência do fio sobrevive à pergunta que não a menciona.

    A regra anterior zerava o período sempre que a frase não fosse detectada
    como continuação — e a conversa voltava para a vigência mais recente no
    meio do caminho. Numa sequência real isso aparecia assim: alguém falava de
    julho, perguntava "qual foi o impacto?" (julho, correto), e a seguinte,
    "quais veículos mais sofreram?", respondia sobre agosto sem avisar.

    Guardar não é usar: só as intenções que pedem recorte consultam este campo,
    e a resposta sempre declara qual vigência descreveu. Trocar de vigência em
    silêncio é o que este produto não faz em nenhuma tela.
  */
  const periodo = leitura.entidades.periodo ?? base.periodo;
  const intervalo = leitura.entidades.intervalo ?? base.intervalo;

  return {
    /*
      Cumprimentar no meio da conversa não muda de assunto.

      Sem a ressalva, um "obrigado" no meio de uma investigação sobre o IPVA
      deixaria SAUDACAO no estado, e o "e julho?" seguinte herdaria uma intenção
      que não consulta nada — o fio da conversa se perderia por uma gentileza.
      Vale a mesma regra de DESCONHECIDA: o que não traz assunto não apaga o
      que estava em pé.
    */
    intencao:
      plano.intencao === "DESCONHECIDA" || plano.intencao === "SAUDACAO"
        ? base.intencao
        : plano.intencao,
    termoDoParametro: leitura.entidades.termoDoParametro ?? base.termoDoParametro,
    parametro: plano.alvo?.parametro ?? (leitura.entidades.termoDoParametro ? null : base.parametro),
    /*
      O bloco do fio é o do documento que mais pesou nesta resposta — e ele só
      é trocado quando esta resposta teve documento. Uma pergunta de dado no
      meio de uma conversa sobre o QLP ADM não apaga o assunto do Book.
    */
    blocoDoBook: dossie.documentos[0]?.trecho.bloco ?? base.blocoDoBook,
    periodo,
    intervalo,
    scopeHash: plano.contexto?.contexto.scopeHash ?? base.scopeHash,
    canal: plano.contexto?.contexto.channel ?? base.canal,
    contexto: plano.contexto?.info.label ?? base.contexto,
    /*
      As evidências guardadas são as desta resposta, e só quando houve alguma.
      Uma pergunta conceitual não apaga a origem da anterior — é justamente
      depois dela que alguém pergunta "e de onde veio aquele número?".
    */
    evidenciasAnteriores:
      dossie.evidencias.length > 0 ? dossie.evidencias : base.evidenciasAnteriores,
  };
}

/** O estado em JSON, para a coluna da conversa. */
export function serializarEstado(estado: EstadoDaConversa): unknown {
  return {
    ...estado,
    // As evidências não são persistidas: elas descrevem uma consulta feita num
    // instante, e reidratá-las num outro dia faria "de onde veio esse número?"
    // apontar para um recorte que pode não ser mais o que o banco tem.
    evidenciasAnteriores: [],
  };
}

export function desserializarEstado(bruto: unknown): EstadoDaConversa {
  if (!bruto || typeof bruto !== "object") return ESTADO_VAZIO;
  const o = bruto as Record<string, unknown>;
  return {
    intencao: (o.intencao as Intencao) ?? null,
    termoDoParametro: (o.termoDoParametro as string) ?? null,
    parametro: (o.parametro as string) ?? null,
    blocoDoBook: (o.blocoDoBook as string) ?? null,
    periodo: (o.periodo as PeriodoPedido) ?? null,
    intervalo: (o.intervalo as EstadoDaConversa["intervalo"]) ?? null,
    scopeHash: (o.scopeHash as string) ?? null,
    canal: (o.canal as string) ?? null,
    contexto: (o.contexto as string) ?? null,
    evidenciasAnteriores: [],
  };
}
