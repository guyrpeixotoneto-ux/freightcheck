import { useMemo } from "react";
import { CanvasDoFluxo } from "@/components/fluxos/canvas";
import { numeracaoDoFluxo, posicoesDoFluxo, type Orientacao } from "@/lib/fluxos-visoes";
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
}: PropsDaVisaoNoCanvas & { orientacao: Orientacao }) {
  const projecao = useMemo(
    () => ({
      posicoes: posicoesDoFluxo(completo, orientacao),
      numeracao: numeracaoDoFluxo(completo),
    }),
    [completo, orientacao],
  );

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
      chaveDoEnquadramento={`${completo.fluxo.id}:fluxo:${orientacao}`}
    />
  );
}
