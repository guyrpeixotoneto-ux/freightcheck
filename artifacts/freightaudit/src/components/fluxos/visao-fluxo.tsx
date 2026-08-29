import { useMemo } from "react";
import { CanvasDoFluxo } from "@/components/fluxos/canvas";
import {
  numeracaoDoFluxo,
  posicoesDoFluxo,
  projetarFases,
  projetarFluxoHorizontal,
  type AgrupamentoDeRaia,
  type Orientacao,
} from "@/lib/fluxos-visoes";
import type { PropsDaVisaoNoCanvas } from "@/components/fluxos/visao";

/**
 * VISUALIZAÇÃO 1 — O FLUXO, vertical ou horizontal.
 *
 * É a evolução do que já existia, e não uma tela nova: mesmos cartões, mesmas
 * setas, mesmo arrastar, mesmo ligar. O que se acrescenta é a orientação.
 *
 * **Vertical** desenha o que está gravado — o arranjo que a pessoa arrastou.
 * **Horizontal** recalcula o desenho da esquerda para a direita, na hora, sem
 * gravar nada: ninguém deveria reposicionar cem cartões à mão para ler o mesmo
 * processo deitado, e ninguém deveria perder o arranjo vertical por ter olhado
 * o horizontal. Por isso, no horizontal, o arrasto fica desligado — o que ele
 * gravaria seria uma coordenada derivada por cima da coordenada real.
 *
 * Retornos e exceções continuam sendo o que sempre foram nas duas orientações:
 * a seta tracejada e animada que o catálogo define, desenhada por cima do
 * caminho normal.
 *
 * ---------------------------------------------------------------------------
 * O que o horizontal ganhou: trilho, faixa, quebra e fases
 * ---------------------------------------------------------------------------
 *
 * O desenho deitado era uma fila só: caminho feliz e tratamento de exceção
 * lado a lado, numa linha que crescia até o `fitView` afastar a câmera e o
 * texto do cartão sumir. Agora `projetarFluxoHorizontal` separa o trilho da
 * faixa de desvios, quebra em linhas a cada oito colunas e devolve as colunas
 * de leitura — e é sobre elas que `projetarFases` monta o cabeçalho colorido de
 * capítulos do processo.
 *
 * As duas projeções continuam puras e continuam sem gravar nada: o que muda
 * entre vertical e horizontal é onde o cartão é desenhado, nunca o que está no
 * banco.
 */
export function VisaoFluxo({
  completo,
  catalogo,
  etapaSelecionada,
  onSelecionarEtapa,
  somenteLeitura,
  onMoverEtapas,
  onConectar,
  onAbrirConexao,
  onSoltarElemento,
  orientacao,
  agrupamento = "area",
}: PropsDaVisaoNoCanvas & {
  orientacao: Orientacao;
  /** Por qual campo as fases são agrupadas — o mesmo das Raias. */
  agrupamento?: AgrupamentoDeRaia;
}) {
  const projecao = useMemo(() => {
    const numeracao = numeracaoDoFluxo(completo);
    if (orientacao === "vertical") {
      return { posicoes: posicoesDoFluxo(completo, "vertical"), numeracao };
    }
    /*
      Uma montagem só para as duas coisas: as fases se apoiam nas colunas que o
      layout acabou de calcular. Recalcular o layout dentro de `projetarFases`
      seria a segunda chance de as faixas discordarem dos cartões que elas
      cobrem — e uma faixa deslocada meia coluna é pior do que faixa nenhuma.
    */
    const horizontal = projetarFluxoHorizontal(completo);
    return {
      posicoes: horizontal.posicoes,
      numeracao,
      fases: projetarFases(completo, horizontal, agrupamento),
    };
  }, [completo, orientacao, agrupamento]);

  return (
    <CanvasDoFluxo
      completo={completo}
      catalogo={catalogo}
      etapaSelecionada={etapaSelecionada}
      onSelecionarEtapa={onSelecionarEtapa}
      somenteLeitura={somenteLeitura}
      onMoverEtapas={onMoverEtapas}
      onConectar={onConectar}
      onAbrirConexao={onAbrirConexao}
      onSoltarElemento={onSoltarElemento}
      projecao={projecao}
      posicoesPersistidas={orientacao === "vertical"}
      mostrarLegenda
      chaveDoEnquadramento={`${completo.fluxo.id}:fluxo:${orientacao}:${agrupamento}`}
    />
  );
}
