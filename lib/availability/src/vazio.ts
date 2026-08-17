import type { ContextoDisponivel } from "./modelo";

/**
 * O vocabulário do vazio — quatro estados, e "sem dados" é só um deles.
 *
 * ---------------------------------------------------------------------------
 * Por que quatro, e por que aqui
 * ---------------------------------------------------------------------------
 *
 * Um módulo que não tem o que mostrar está numa de quatro situações, e elas têm
 * consertos opostos. Mandar importar planilha quando o problema é curadoria faz
 * alguém reimportar o mesmo arquivo três vezes; dizer "não há dados" quando o
 * dado está noutra unidade faz procurar defeito onde há filtro. A frase única —
 * `404 "Nenhuma vigência importada ainda."` — é a forma mais convincente de
 * mentir que uma tela tem, porque ela é verdadeira num dos quatro casos.
 *
 * O vocabulário mora na autoridade de disponibilidade porque o primeiro estado
 * é dela: **só ela responde se o dado existe**. Os outros três são do módulo, e
 * é justamente por isso que precisam nascer ao lado do primeiro — um módulo que
 * inventasse o próprio "não existe" estaria de novo com opinião própria sobre o
 * censo, que é o que esta auditoria passou dezesseis PRs desfazendo.
 *
 * ---------------------------------------------------------------------------
 * A regra de ouro
 * ---------------------------------------------------------------------------
 *
 * > **Um módulo só pode dizer "não há dados" quando `NAO_EXISTE`.**
 *
 * `NAO_SE_APLICA` e `NAO_CALCULAVEL` jamais são traduzidos como ausência de
 * dado. O dado está lá nos dois casos — o que falta é pertinência num, e
 * informação no outro.
 *
 * A máquina de estados, na ordem em que se pergunta (`Parte F.3` do baseline):
 *
 * ```
 *   existe?      ──não──▶  NAO_EXISTE       "nenhum dado importado"
 *      │ sim
 *   se aplica?   ──não──▶  NAO_SE_APLICA    "não se aplica, e por quê"
 *      │ sim
 *   é calculável?──não──▶  NAO_CALCULAVEL   "existe, e falta isto"
 *      │ sim
 *   tem linha?   ──não──▶  FORA_DO_RECORTE  "existe, e não neste recorte"
 *      │ sim
 *   o número
 * ```
 */
export type Vazio =
  /**
   * Não há dado. **O único caso em que "não há dados" é verdade.**
   *
   * Quem responde é a autoridade: `verificarDisponibilidade` com
   * `VAZIO_GLOBAL`, ou a ausência de contexto resolvível. Um módulo não chega
   * a esta conclusão sozinho.
   */
  | { estado: "NAO_EXISTE"; frase: string }
  /**
   * O dado existe e este módulo não fala dele.
   *
   * O caso desta auditoria em forma pura: um equipamento sem coluna numérica no
   * dicionário não sustenta a matriz de Impacto — e a resposta antiga era
   * "nenhuma vigência importada ainda", sobre um banco com nove vigências
   * promovidas e visíveis em Cobertura.
   */
  | { estado: "NAO_SE_APLICA"; frase: string }
  /**
   * O dado existe, é pertinente, e falta informação para a conta.
   *
   * Semântica não confirmada, periodicidade não declarada, ponta anterior
   * ausente. `oQueFalta` é separado da frase porque é a parte acionável: é o
   * que alguém precisa fazer, e a tela pode transformá-lo em link.
   */
  | { estado: "NAO_CALCULAVEL"; frase: string; oQueFalta: string }
  /**
   * O dado existe e está fora do recorte pedido.
   *
   * `existemEm` diz **onde** ele está — sem isso a tela repete "não há dados"
   * com outras palavras, e quem lê continua sem saber para onde ir.
   */
  | { estado: "FORA_DO_RECORTE"; frase: string; existemEm: ContextoDisponivel[] };

/**
 * Um resultado que pode ser vazio **com nome**.
 *
 * Substitui `T | null` nas leituras de módulo. O `null` era barato de escrever
 * e caro de ler: quem recebia não tinha como distinguir as quatro causas, e a
 * tradução para a tela virava uma frase só — a que a rota escolheu no dia em
 * que foi escrita.
 */
export type ComVazio<T> = { ok: true; valor: T } | { ok: false; vazio: Vazio };

export const comValor = <T>(valor: T): ComVazio<T> => ({ ok: true, valor });

export const naoExiste = (frase: string): ComVazio<never> => ({
  ok: false,
  vazio: { estado: "NAO_EXISTE", frase },
});

export const naoSeAplica = (frase: string): ComVazio<never> => ({
  ok: false,
  vazio: { estado: "NAO_SE_APLICA", frase },
});

export const naoCalculavel = (frase: string, oQueFalta: string): ComVazio<never> => ({
  ok: false,
  vazio: { estado: "NAO_CALCULAVEL", frase, oQueFalta },
});

export const foraDoRecorte = (
  frase: string,
  existemEm: ContextoDisponivel[],
): ComVazio<never> => ({
  ok: false,
  vazio: { estado: "FORA_DO_RECORTE", frase, existemEm },
});

/**
 * O código HTTP de cada estado — a tradução, num lugar só.
 *
 * Os quatro continuam sendo 404: para quem chama, o recurso "a matriz deste
 * recorte" não existe em nenhum dos casos, e mudar o código quebraria as telas
 * sem melhorar a resposta. O que muda é o **corpo**, que passa a carregar a
 * frase certa e o estado legível por máquina.
 *
 * A função existe para que a escolha seja uma decisão registrada, e não uma
 * coincidência de quatro rotas terem escrito o mesmo número.
 */
export function statusDoVazio(_vazio: Vazio): 404 {
  return 404;
}

/** O corpo que uma rota devolve para um vazio. A frase primeiro, sempre. */
export function corpoDoVazio(vazio: Vazio): Record<string, unknown> {
  return {
    // `error` é o campo que as telas já leem. Ele passa a trazer a frase certa
    // sem que nenhuma delas mude uma linha — e as que quiserem tratar os casos
    // de forma diferente têm `estado` ao lado.
    error: vazio.frase,
    estado: vazio.estado,
    ...(vazio.estado === "NAO_CALCULAVEL" ? { oQueFalta: vazio.oQueFalta } : {}),
    ...(vazio.estado === "FORA_DO_RECORTE"
      ? { existemEm: vazio.existemEm.map((c) => ({ chave: c.chave, rotulo: c.rotulo })) }
      : {}),
  };
}
