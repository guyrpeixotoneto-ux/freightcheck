import { DATASET_FAMILY_QUADRO_DE_PESSOAL } from "@workspace/ingest/tipos";
import { ROTULO_DO_QUADRO, type AuditoriaDoQuadro, type QuadroDeQlp } from "./qlp-auditoria";
import type { Contexto } from "./contextos";

/**
 * A TRAVESSIA PARA O QUADRO DE PESSOAL — por que ela é uma faixa, e não um
 * número dentro de um cartão do Panorama.
 *
 * A pergunta que a produziu foi direta: *o cartão do "onde aconteceu" não
 * poderia ranquear trecho, QLP administrativo e QLP operacional junto do cavalo
 * e da carreta?* Para o trecho, sim — e ele já entra sozinho, porque é da
 * **mesma família** do cavalo (`REMUNERACAO_EQUIPAMENTO`, em
 * `lib/ingest/src/tipos.ts`) e `byEquipment` é montado a partir dos tipos que a
 * vigência trouxe. Para os dois QLPs, não, e por três razões que não são de
 * gosto:
 *
 * 1. **Vigência própria.** O QLP é da família `QUADRO_DE_PESSOAL` e forma
 *    quinzenas próprias na mesma unidade e canal do equipamento —
 *    `lib/qlp/src/contexto.ts` resolve o contexto só dessa família justamente
 *    porque oferecer as vigências do equipamento faria o seletor prometer o que
 *    a leitura não sabe responder. O par desta tela pode simplesmente não
 *    existir lá.
 * 2. **Consolidação por desenho.** O quadro atravessa unidades (uma planilha de
 *    QLP traz várias), então um número de QLP debaixo de um cabeçalho de uma
 *    unidade é o número de várias sob o título de uma.
 * 3. **Grão e população diferentes.** A linha do QLP é unidade + cargo, não
 *    placa; "alteração" ali não é comparável com alteração de equipamento, e o
 *    dinheiro dela não está na manchete nem na ponte desta tela.
 *
 * Somar isso ao ranking publicaria, na mesma lista, contagens de duas
 * competências diferentes debaixo de um cabeçalho só — que é exatamente a classe
 * de defeito que o Panorama existe para desfazer.
 *
 * O que esta faixa faz é o contrário: ela **atravessa**, e diz o que está
 * atravessando. Uma linha por quadro que responde, cada uma com a **sua**
 * vigência escrita na frente do número, e o caminho para o módulo. Nenhuma
 * contagem entra em soma nenhuma da tela.
 */

/**
 * O acervo tem quadro de pessoal? — **a pergunta que evita duas perguntas.**
 *
 * A faixa custa duas leituras (uma por quadro), e num acervo que só tem
 * equipamento as duas respondem 404. Isso não quebra nada — `fetchJsonOrNull` as
 * lê como "não há" —, mas são dois pedidos e dois 404 no console a cada abertura
 * da tela mais aberta do produto, para desenhar nada.
 *
 * A casca já sabe a resposta: `/contexts` lista os contextos de **todas** as
 * famílias, e a lista já está em memória (é a mesma consulta da lateral). Um
 * contexto da família do quadro é a prova de que existe quadro a atravessar; sem
 * nenhum, a tela não pergunta.
 *
 * **Sem `datasetFamily` a resposta é sim.** Uma resposta anterior ainda em cache
 * não traz o campo, e ali a ausência quer dizer "não sei": tratá-la como "não
 * tem" esconderia a faixa de quem tem o quadro importado. Perguntar e ouvir 404
 * é o custo aceitável da dúvida; esconder dado por causa de um cache velho, não.
 */
export function acervoTemQuadro(contextos: Contexto[]): boolean {
  return contextos.some(
    (c) => c.datasetFamily == null || c.datasetFamily === DATASET_FAMILY_QUADRO_DE_PESSOAL,
  );
}

/** Os dois quadros, na ordem em que a faixa os publica. */
export const QUADROS_DA_TRAVESSIA: QuadroDeQlp[] = ["ADMINISTRATIVO", "OPERACIONAL"];

/** O endereço do módulo de cada quadro — as rotas que já existem. */
const ROTA_DO_QUADRO: Record<QuadroDeQlp, string> = {
  ADMINISTRATIVO: "/qlp-administrativo",
  OPERACIONAL: "/qlp-operacional",
};

export interface LinhaDaTravessia {
  quadro: QuadroDeQlp;
  /** "QLP Administrativo" — o rótulo canônico, o mesmo do módulo. */
  rotulo: string;
  /** A vigência **deste** quadro, escrita. Nunca a da tela que pergunta. */
  vigencia: string;
  /** Cargos e efetivo, já escritos — `null` quando o quadro não os sustenta. */
  contagem: string | null;
  /**
   * A ressalva desta linha, quando há uma.
   *
   * O caso que ela existe para cobrir é o que `serieEntregue` distingue: o
   * acervo tem este quadro, mas **a vigência aberta do QLP não o entregou** —
   * chegou o administrativo e não o operacional, na mesma quinzena. A linha
   * continua em tela, porque o quadro existe e o módulo abre; o que ela não faz
   * é publicar uma contagem de outra quinzena como se fosse desta.
   */
  ressalva: string | null;
  href: string;
}

/**
 * A faixa a partir das respostas — uma linha por quadro que respondeu.
 *
 * `null` no lugar de uma resposta é o caso comum e não é falha: é "este quadro
 * não tem vigência importada", que a rota devolve como 404 e o cliente lê como
 * `null` (o mesmo desenho das telas de QLP). Quadro sem resposta não vira linha,
 * e sem nenhuma linha não há faixa — em vez de uma faixa que anuncia um módulo
 * vazio.
 */
export function travessiaDoQuadro(
  respostas: Partial<Record<QuadroDeQlp, AuditoriaDoQuadro | null>>,
): LinhaDaTravessia[] {
  const linhas: LinhaDaTravessia[] = [];

  for (const quadro of QUADROS_DA_TRAVESSIA) {
    const dados = respostas[quadro];
    if (!dados) continue;
    /*
      Sem a vigência escrita não há linha — e esta guarda não é paranoia de
      tipo.

      A faixa publica uma contagem de **outra competência** dentro de uma tela
      que tem a sua; o rótulo da vigência é o que impede essa contagem de ser
      lida como desta. Uma resposta sem ele (uma versão anterior da rota ainda
      em cache, que não a devolvia) desenharia a linha com a vigência em branco
      — a contagem certa, sem a única ressalva que a torna honesta aqui. Melhor
      não atravessar do que atravessar sem dizer para quando.
    */
    if (typeof dados.periodLabel !== "string" || dados.periodLabel === "") continue;

    linhas.push({
      quadro,
      rotulo: ROTULO_DO_QUADRO[quadro],
      vigencia: dados.periodLabel,
      contagem: dados.serieEntregue ? contagem(dados) : null,
      ressalva: dados.serieEntregue
        ? null
        : "esta vigência do quadro não trouxe o arquivo deste quadro",
      href: ROTA_DO_QUADRO[quadro],
    });
  }

  return linhas;
}

/**
 * Cargos e efetivo — **e a distinção entre os dois**, que é a primeira coisa
 * que o dicionário do QLP ensina: cada linha é um cargo, não uma pessoa; quem
 * diz quantas pessoas há é a coluna de quantidade.
 *
 * Efetivo nulo não vira zero: o quadro pode não trazer a coluna, e "0 pessoas"
 * seria uma afirmação sobre a operação que o dado não sustenta.
 */
function contagem(dados: AuditoriaDoQuadro): string | null {
  const { cargos, efetivo } = dados.resumo;
  if (cargos === 0) return null;

  const partes = [`${cargos.toLocaleString("pt-BR")} ${cargos === 1 ? "cargo" : "cargos"}`];
  if (efetivo !== null) {
    partes.push(`efetivo de ${efetivo.toLocaleString("pt-BR")}`);
  }
  return partes.join(" · ");
}
