import type { FamiliesOverview } from "@/components/inicio/types";
import { unidadesPorImpacto } from "@/components/inicio/visao-geral-consolidada";

/**
 * A rotação automática da Gestão à Vista — o telão sem alguém do outro lado
 * do controle remoto.
 *
 * Um wallboard fica ligado sem ninguém trocando de unidade na mão, e antes
 * disto existir o mesmo scopeHash/canal ficava preso na tela até alguém
 * reabrir o endereço com outro recorte. `?autoplay=1` liga a rotação:
 * primeiro a Visão Geral (a soma de todas as unidades), depois cada unidade
 * incluída na soma, uma por vez, voltando ao início ao fim da volta.
 *
 * As duas funções abaixo não leem URL nem React de propósito — são a mesma
 * separação de `lib/recorte.ts` e `lib/visao-geral.ts`: a regra testável sem
 * montar tela, e a página só lê o resultado.
 */

// ---------------------------------------------------------------------------
// A sequência de slides
// ---------------------------------------------------------------------------

export interface SlideDaVisaoGeral {
  tipo: "geral";
}

export interface SlideDeUnidade {
  tipo: "unidade";
  label: string;
  scopeHash: string;
  canal: string | null;
}

export type SlideDoAutoplay = SlideDaVisaoGeral | SlideDeUnidade;

/**
 * A ordem da volta: a Visão Geral primeiro, sempre — é o resumo que quem
 * chega de longe precisa ver antes de qualquer unidade —, e depois as
 * unidades incluídas na soma, no mesmo ranking de impacto que a tabela
 * "Unidades em atenção" já mostra (`unidadesPorImpacto`), para que a ordem
 * da rotação e a ordem da tabela contem a mesma história.
 *
 * Uma unidade com mais de um contexto (dois canais, por exemplo) vira um
 * slide por contexto — é o que o endereço da tela sabe abrir, um
 * scopeHash/canal de cada vez — e o rótulo ganha o canal ao lado para dizer
 * qual dos dois está na tela.
 *
 * Sem overview ainda carregado, a volta é só a Visão Geral: é o primeiro
 * slide por definição, e não há unidade nenhuma para somar a ele.
 */
export function montarSequenciaDoAutoplay(
  overview: FamiliesOverview | null | undefined,
): SlideDoAutoplay[] {
  const geral: SlideDaVisaoGeral = { tipo: "geral" };
  if (!overview) return [geral];

  const slides: SlideDoAutoplay[] = [geral];
  for (const { unidade } of unidadesPorImpacto(overview)) {
    const maisDeUmContexto = unidade.contexts.length > 1;
    for (const contexto of unidade.contexts) {
      slides.push({
        tipo: "unidade",
        label:
          maisDeUmContexto && contexto.channel
            ? `${unidade.label} · ${contexto.channel}`
            : unidade.label,
        scopeHash: contexto.scopeHash,
        canal: contexto.channel,
      });
    }
  }
  return slides;
}

// ---------------------------------------------------------------------------
// O intervalo entre slides
// ---------------------------------------------------------------------------

export const INTERVALO_PADRAO_SEGUNDOS = 20;
const INTERVALO_MINIMO_SEGUNDOS = 5;

/**
 * `?intervalo=` em segundos, com um piso — um telão trocando de unidade a
 * cada 1s não dá tempo de ler nada, e vira uma tela ilegível em vez de um
 * wallboard. Fora do intervalo válido, ou ausente, vale o padrão.
 */
export function lerIntervaloSegundos(valor: string | null): number {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < INTERVALO_MINIMO_SEGUNDOS) {
    return INTERVALO_PADRAO_SEGUNDOS;
  }
  return numero;
}
