import { useMemo } from "react";
import { CanvasDoFluxo } from "@/components/fluxos/canvas";
import {
  numeracaoDoFluxo,
  projetarRaias,
  resumoDeResponsabilidade,
  type AgrupamentoDeRaia,
} from "@/lib/fluxos-visoes";
import type { PropsDaVisaoNoCanvas } from "@/components/fluxos/visao";

/**
 * VISUALIZAÇÃO 2 — AS RAIAS, e o que elas existem para revelar.
 *
 * Um fluxograma responde "o que acontece". As raias respondem "**quem** faz o
 * quê, e quantas vezes a bola troca de mão" — que é a pergunta de quem quer
 * melhorar o processo, não só documentá-lo. A etapa é a mesma etapa; o que
 * muda é que a linha em que ela cai passa a ser a área (ou o responsável, ou o
 * sistema) que já estava cadastrada nela.
 *
 * Nada é duplicado para isso existir: não há tabela de raia, não há campo de
 * raia, não há segunda posição gravada. `projetarRaias` é uma função pura sobre
 * o mesmo `FluxoCompleto`, e mudar o agrupamento é recalculá-la.
 *
 * **Os handoffs são o produto.** Toda conexão cujas pontas caem em raias
 * diferentes é uma troca de responsabilidade, e é desenhada com mais peso. O
 * contador em cima diz quantas são — contando o que está cadastrado, sem
 * estimar nada.
 *
 * O arrasto fica desligado aqui de propósito: a posição nas raias é derivada da
 * área da etapa, e mover o cartão para outra linha não mudaria a área — seria
 * um gesto que parece editar e não edita. Quem quiser trocar a área abre o
 * painel de detalhe, que é o mesmo das outras cinco visualizações.
 */
export function VisaoRaias({
  completo,
  catalogo,
  etapaSelecionada,
  onSelecionarEtapa,
  somenteLeitura,
  onMoverEtapas,
  onConectar,
  onAbrirConexao,
  onSoltarElemento,
  agrupamento,
}: PropsDaVisaoNoCanvas & { agrupamento: AgrupamentoDeRaia }) {
  const { projecao, resumo, raias } = useMemo(() => {
    const projetada = projetarRaias(completo, agrupamento);
    return {
      raias: projetada,
      resumo: resumoDeResponsabilidade(completo, agrupamento),
      projecao: {
        posicoes: projetada.posicoes,
        numeracao: numeracaoDoFluxo(completo),
        raias: { raias: projetada.raias, largura: projetada.largura },
        handoffs: new Set(projetada.handoffs.map((h) => h.conexaoId)),
      },
    };
  }, [completo, agrupamento]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b bg-card px-4 py-2 text-xs text-muted-foreground">
        <span>
          <strong className="font-semibold text-foreground">{raias.raias.length}</strong>{" "}
          {raias.raias.length === 1 ? "raia" : "raias"}
        </span>
        <span>
          <strong className="font-semibold text-foreground">{resumo.trocas}</strong>{" "}
          {resumo.trocas === 1 ? "troca de responsabilidade" : "trocas de responsabilidade"}
        </span>
        <span>
          <strong className="font-semibold text-foreground">{resumo.areas}</strong>{" "}
          {resumo.areas === 1 ? "área envolvida" : "áreas envolvidas"}
        </span>
        <span>
          <strong className="font-semibold text-foreground">{resumo.sistemas}</strong>{" "}
          {resumo.sistemas === 1 ? "sistema envolvido" : "sistemas envolvidos"}
        </span>
        {/*
          O aviso aparece só quando ele é verdade: uma raia do "não preenchido"
          significa que o cadastro está incompleto, e é melhor dizer isso do que
          desenhar uma raia anônima como se fosse uma área da empresa.
        */}
        {raias.raias.some((r) => r.semInformacao) && (
          <span className="text-amber-600 dark:text-amber-500">
            há etapas sem esta informação cadastrada
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1">
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
          chaveDoEnquadramento={`${completo.fluxo.id}:raias:${agrupamento}`}
        />
      </div>
    </div>
  );
}
