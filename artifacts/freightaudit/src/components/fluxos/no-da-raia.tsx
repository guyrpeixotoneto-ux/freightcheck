import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { DadosDaRaia } from "@/lib/fluxos-canvas";

/**
 * A FAIXA DA RAIA — cenário, e não conteúdo.
 *
 * É um nó do canvas porque precisa andar junto com o pan e com o zoom: uma
 * camada em HTML por cima do canvas ficaria parada enquanto o desenho se move,
 * e o rótulo "FISCAL" apareceria ao lado da etapa errada no primeiro arrasto.
 *
 * O que ele **não** é: uma entidade. A raia não existe no banco — ela é a
 * leitura da área, do responsável ou do sistema que já estão na etapa. Por isso
 * a faixa não seleciona, não arrasta e não abre painel: editar a raia é editar
 * o campo da etapa, no mesmo painel de detalhe de sempre.
 */
export const NoDaRaia = memo(function NoDaRaia({ data }: NodeProps & { data: DadosDaRaia }) {
  const { raia, etapas } = data;

  return (
    <div
      className={cn(
        "pointer-events-none h-full w-full border-b border-dashed",
        raia.semInformacao ? "bg-muted/50" : "bg-muted/20",
      )}
      style={{ height: raia.altura }}
    >
      <div className="sticky left-0 flex h-full w-[180px] flex-col justify-center border-r bg-card/80 px-4 py-2 backdrop-blur-sm">
        <p
          className={cn(
            "text-xs font-semibold uppercase leading-tight tracking-wide",
            raia.semInformacao ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {raia.rotulo}
        </p>
        <p className="mt-0.5 text-2xs text-muted-foreground">
          {etapas} {etapas === 1 ? "etapa" : "etapas"}
        </p>
      </div>
    </div>
  );
});
