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
  /**
   * O assunto **reconhecido** da conversa — nunca o resíduo da frase.
   *
   * Chamava-se `termoDoParametro` e guardava o que a interpretação tinha
   * sobrado da pergunta, resolvesse ou não. Numa sequência real isso aparecia
   * assim: o terceiro turno ("qual teve maior impacto?") gravava `"maior"`, e
   * o quarto e o quinto herdavam essa palavra, não resolviam nada e paravam de
   * consultar. Um turno ruim envenenava todos os seguintes, e a conversa não se
   * recuperava sem recomeçar.
   *
   * Aqui só entra o que `reconhecerAssunto` reconheceu. Um turno que não
   * reconheceu nada não escreve — e, por não escrever, preserva o assunto que
   * estava em pé.
   */
  assunto: string | null;
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
  /**
   * O tipo de ativo em foco — o filtro que não atravessava um turno.
   *
   * "E somente cavalos" era lido corretamente pela interpretação e morria ali:
   * o estado guardava *sobre o quê* se falava (assunto, período, bloco) e não
   * *como se estava recortando*. O turno seguinte voltava à frota inteira, e a
   * única pista disso era o número mudar.
   */
  equipamento: "CAVALO" | "CARRETA" | null;
  /**
   * Onde a última lista parou, e de que tamanho ela era.
   *
   * É o que "me mostre os 5 seguintes" precisa saber. Guardar só o deslocamento
   * não bastaria: sem o tamanho da página, "mostre mais" — sem número — não tem
   * como continuar do mesmo jeito.
   */
  pagina: { apartirDe: number; tamanho: number } | null;
  /** O recorte em que a conversa está. */
  scopeHash: string | null;
  /**
   * Como a unidade deste fio foi escolhida — e por que isso precisa ser guardado.
   *
   * Uma unidade que a pessoa **digitou** ("só Camaçari") e uma que veio junto do
   * link da tela são as duas um recorte, e não valem o mesmo na hora de decidir
   * o turno seguinte. Sem esta coluna, "e somente cavalos" — que não nomeia
   * unidade — perdia para o `scopeHash` que a tela continuava mandando, e a
   * conversa voltava sozinha para a unidade de onde a pessoa saiu dois turnos
   * antes.
   */
  origemDoRecorte: "PERGUNTA" | "TELA" | "CONVERSA" | "PADRAO" | null;
  /**
   * O que a tela mandou no turno anterior.
   *
   * É o que permite distinguir "a tela continua na mesma unidade" de "a pessoa
   * acabou de trocar o seletor". Sem essa distinção, uma unidade fixada pela
   * conversa venceria para sempre — inclusive depois de alguém escolher outra
   * no seletor, que é uma declaração tão explícita quanto a frase.
   */
  telaScopeHash: string | null;
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
  assunto: null,
  parametro: null,
  blocoDoBook: null,
  periodo: null,
  intervalo: null,
  equipamento: null,
  pagina: null,
  scopeHash: null,
  origemDoRecorte: null,
  telaScopeHash: null,
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

/** Quantos itens uma página tem quando ninguém disse. O padrão das ferramentas. */
const TAMANHO_PADRAO_DA_PAGINA = 20;

/**
 * Onde a próxima lista começa.
 *
 * Três estados, e o terceiro é o que faltava. Sem pedido de continuação e sem
 * lista em curso: nada. Com pedido de continuação: avança do ponto em que a
 * anterior parou. Sem pedido, mas com lista em curso: **volta ao começo**,
 * porque a pergunta mudou e a lista dela é outra.
 */
function paginaSeguinte(
  base: EstadoDaConversa,
  dossie: Dossie,
): EstadoDaConversa["pagina"] {
  const pedido = dossie.leitura.entidades.paginacao;
  if (!pedido) return null;
  const anterior = base.pagina;
  const tamanho = pedido.quantos ?? anterior?.tamanho ?? TAMANHO_PADRAO_DA_PAGINA;
  const apartirDe = (anterior?.apartirDe ?? 0) + (anterior?.tamanho ?? TAMANHO_PADRAO_DA_PAGINA);
  return { apartirDe, tamanho };
}

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
    /*
      Só conhecimento resolvido, e só quando houve.

      `plano.assunto` é o que o produto reconheceu nesta pergunta. Quando não
      reconheceu nada, o assunto do fio continua o de antes: uma pergunta de
      continuidade ("qual teve maior impacto?", "por quê?") não muda de assunto
      — ela pergunta outra coisa **sobre o mesmo**.
    */
    assunto: plano.assunto ?? base.assunto,
    parametro: plano.alvo?.parametro ?? (plano.assunto ? null : base.parametro),
    /*
      O bloco do fio é o do documento que mais pesou nesta resposta — e ele só
      é trocado quando esta resposta teve documento. Uma pergunta de dado no
      meio de uma conversa sobre o QLP ADM não apaga o assunto do Book.
    */
    blocoDoBook: dossie.documentos[0]?.trecho.bloco ?? base.blocoDoBook,
    periodo,
    intervalo,
    /*
      O equipamento do fio: quem nomeou um, troca; quem não nomeou, mantém.

      É a mesma regra do assunto, e pelo mesmo motivo — "qual teve maior
      perda?", logo depois de "e somente cavalos", continua sendo sobre cavalos.
      Trocar para `null` a cada turno que não nomeia equipamento faria o filtro
      durar exatamente uma pergunta, que é o comportamento que esta linha
      existe para acabar.
    */
    equipamento: leitura.entidades.equipamento ?? base.equipamento,
    /*
      A página anda quando a pergunta pede a continuação, e **zera** quando a
      pergunta é outra.

      Zerar é a metade que se esquece: sem ela, uma nova pergunta depois de
      "mostre os 5 seguintes" começaria no sexto item de uma lista que não é
      mais a mesma. O deslocamento só sobrevive enquanto a conversa está
      percorrendo uma lista.
    */
    pagina: paginaSeguinte(base, dossie),
    scopeHash: plano.contexto?.contexto.scopeHash ?? base.scopeHash,
    /*
      A origem só é rebaixada quando outra a substitui.

      Um turno conceitual, que não resolve contexto nenhum, não pode apagar o
      fato de que a unidade foi escolhida a dedo dois turnos antes — senão a
      precedência se perde no primeiro "o que é IPVA?" no meio da investigação.
    */
    origemDoRecorte:
      plano.origemDoRecorte === "PERGUNTA" || plano.origemDoRecorte === "TELA"
        ? plano.origemDoRecorte
        : base.origemDoRecorte,
    telaScopeHash: dossie.telaScopeHash ?? base.telaScopeHash,
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
    assunto: (o.assunto as string) ?? null,
    parametro: (o.parametro as string) ?? null,
    blocoDoBook: (o.blocoDoBook as string) ?? null,
    periodo: (o.periodo as PeriodoPedido) ?? null,
    intervalo: (o.intervalo as EstadoDaConversa["intervalo"]) ?? null,
    equipamento: (o.equipamento as EstadoDaConversa["equipamento"]) ?? null,
    pagina: (o.pagina as EstadoDaConversa["pagina"]) ?? null,
    origemDoRecorte: (o.origemDoRecorte as EstadoDaConversa["origemDoRecorte"]) ?? null,
    telaScopeHash: (o.telaScopeHash as string) ?? null,
    scopeHash: (o.scopeHash as string) ?? null,
    canal: (o.canal as string) ?? null,
    contexto: (o.contexto as string) ?? null,
    evidenciasAnteriores: [],
  };
}
