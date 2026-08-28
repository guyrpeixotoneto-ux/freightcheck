import {
  montarCanvas,
  subfluxoDaEtapa,
  type Catalogo,
  type Etapa,
  type FluxoCompleto,
  type NoDoCanvas,
  type ResumoDeSubfluxo,
  type ResumoDoCartao,
  type SetaDoCanvas,
  type TipoDeEtapaNoCatalogo,
} from "@/lib/fluxos";
import { severidadeNoCatalogo, type Severidade } from "@/lib/fluxos-analise";
import type { Posicoes, Raia } from "@/lib/fluxos-visoes";

/**
 * DO FLUXO PARA O CANVAS — uma montagem só, para as três visualizações que
 * desenham.
 *
 * Fluxo, Raias, Mapa e Gargalos são o **mesmo** canvas com projeções
 * diferentes. O que muda entre eles é onde o cartão fica, quanto ele mostra e
 * se há uma camada por cima; o que **não** muda é a regra de que toda etapa
 * vira cartão e toda conexão vira seta — e ela continua morando em
 * `montarCanvas`, que já existia e já era testada.
 *
 * Por isso esta função **envolve** aquela em vez de substituí-la: a montagem
 * base é uma só, e o que se acrescenta aqui é apresentação — posição projetada,
 * variante do cartão, número de leitura, severidade e as faixas das raias. Um
 * segundo montador copiado seria a primeira porta para uma visualização deixar
 * de mostrar uma etapa que as outras mostram.
 */

export interface DadosDoNo {
  etapa: Etapa;
  resumo: ResumoDoCartao;
  tipo: TipoDeEtapaNoCatalogo | undefined;
  /** Quanto o cartão mostra. O mapa usa o compacto. */
  variante: "completo" | "compacto";
  /** A posição de leitura — `01`, `02` —, quando a visualização a mostra. */
  numero: number | null;
  /** A severidade analítica, só na visualização de Gargalos. */
  severidade: Severidade | null;
  /**
   * O fluxo que detalha esta etapa, quando existe. Resolvido aqui porque é
   * aqui que o `FluxoCompleto` inteiro está na mão — o cartão do canvas recebe
   * só `data`, e uma consulta por cartão não teria onde acontecer.
   */
  subfluxo: ResumoDeSubfluxo | null;
}

export interface DadosDaRaia {
  raia: Raia;
  /** Quantas etapas caem nesta raia — o contador do rótulo. */
  etapas: number;
}

export interface NoDaRaiaNoCanvas {
  id: string;
  type: "raia";
  position: { x: number; y: number };
  data: DadosDaRaia;
  draggable: false;
  selectable: false;
  focusable: false;
  zIndex: number;
  style: { width: number; height: number };
}

export interface ProjecaoDoCanvas {
  nos: (NoDoCanvas & { data: DadosDoNo })[];
  faixas: NoDaRaiaNoCanvas[];
  setas: SetaDoCanvas[];
}

export interface OpcoesDaProjecao {
  /** Onde cada cartão fica. Ausente, valem as posições gravadas na etapa. */
  posicoes?: Posicoes;
  variante?: "completo" | "compacto";
  numeracao?: Map<string, number>;
  /** Ligada, a visualização de Gargalos pinta o cartão pela severidade. */
  severidades?: Map<string, Severidade>;
  /** As faixas das raias, desenhadas atrás dos cartões. */
  raias?: { raias: Raia[]; largura: number };
  /** As conexões que trocam de raia — desenhadas com mais peso. */
  handoffs?: Set<string>;
}

/** Quanto uma seta de handoff engrossa em relação a uma seta comum. */
const ESPESSURA_DO_HANDOFF = 2.5;

export function montarProjecao(
  completo: FluxoCompleto,
  catalogo: Pick<Catalogo, "tiposDeEtapa" | "tiposDeConexao"> | undefined,
  opcoes: OpcoesDaProjecao = {},
): ProjecaoDoCanvas {
  const base = montarCanvas(completo, catalogo);
  const variante = opcoes.variante ?? "completo";

  const nos = base.nos.map((no) => {
    const projetada = opcoes.posicoes?.get(no.id);
    return {
      ...no,
      position: projetada ?? no.position,
      data: {
        ...no.data,
        variante,
        numero: opcoes.numeracao?.get(no.id) ?? null,
        severidade: opcoes.severidades?.get(no.id) ?? null,
        subfluxo: subfluxoDaEtapa(completo, no.data.etapa),
      },
    };
  });

  /*
    A seta de handoff engrossa, e não muda de cor: a cor da seta já diz o que
    ela é (sequência, decisão, retrabalho), e sobrescrevê-la nas Raias faria a
    mesma conexão significar coisas diferentes conforme a visualização — que é
    exatamente o que "a mesma fonte de verdade" existe para impedir.
  */
  const setas = opcoes.handoffs
    ? base.setas.map((seta) =>
        opcoes.handoffs!.has(seta.id)
          ? { ...seta, style: { ...seta.style, strokeWidth: ESPESSURA_DO_HANDOFF } }
          : seta,
      )
    : base.setas;

  const faixas: NoDaRaiaNoCanvas[] = (opcoes.raias?.raias ?? []).map((raia, indice) => ({
    id: `raia:${indice}:${raia.chave}`,
    type: "raia" as const,
    position: { x: 0, y: raia.y },
    data: { raia, etapas: raia.etapas.length },
    /*
      A faixa é cenário, não conteúdo: não arrasta, não seleciona, não recebe
      foco de teclado e fica atrás de tudo. Sem isso, clicar no fundo de uma
      raia "selecionaria a raia" — e uma raia não é uma coisa que se edita, é a
      leitura de um campo que já está na etapa.
    */
    draggable: false as const,
    selectable: false as const,
    focusable: false as const,
    zIndex: -1,
    style: { width: opcoes.raias?.largura ?? 0, height: raia.altura },
  }));

  return { nos, faixas, setas };
}

/** A cor da severidade, para quem precisa dela como valor e não como classe. */
export const corDaSeveridade = (severidade: Severidade): string =>
  severidadeNoCatalogo(severidade).cor;
