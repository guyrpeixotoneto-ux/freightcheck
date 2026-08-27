import { useMemo } from "react";
import { CanvasDoFluxo } from "@/components/fluxos/canvas";
import { numeracaoDoFluxo, posicoesDoMapa } from "@/lib/fluxos-visoes";
import type { PropsDaVisaoNoCanvas } from "@/components/fluxos/visao";

/**
 * VISUALIZAÇÃO 4 — O MAPA: o processo inteiro de uma vez.
 *
 * O problema que ela resolve é o de escala. Um processo de cem etapas desenhado
 * com o cartão do Fluxo obriga a navegar por partes: quem abre nunca vê a
 * forma do todo — onde começa, onde termina, onde ramifica, onde volta.
 *
 * A resposta é a mesma topologia com cartão compacto e passo curto: número,
 * nome e tipo, sem responsável e sem contador de detalhes. O minimapa fica
 * sempre ligado aqui, porque é a visualização em que a câmera está mais longe.
 *
 * Clicar abre o mesmo painel de detalhe das outras cinco.
 */
export function VisaoMapa({
  completo,
  catalogo,
  etapaSelecionada,
  onSelecionarEtapa,
  somenteLeitura,
  onMoverEtapas,
  onConectar,
  onAbrirConexao,
  onSoltarElemento,
}: PropsDaVisaoNoCanvas) {
  const projecao = useMemo(
    () => ({
      posicoes: posicoesDoMapa(completo),
      numeracao: numeracaoDoFluxo(completo),
      variante: "compacto" as const,
    }),
    [completo],
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
      posicoesPersistidas={false}
      chaveDoEnquadramento={`${completo.fluxo.id}:mapa`}
      mostrarMinimapa
    />
  );
}
