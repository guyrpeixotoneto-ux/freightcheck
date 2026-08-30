import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { iconeDoCatalogo } from "@/lib/fluxos-icones";
import { ALTURA_DO_ROTULO_DO_GRUPO } from "@/lib/fluxos-visoes";
import type { DadosDoGrupo } from "@/lib/fluxos-canvas";

/**
 * A CAIXA DO QUE ACONTECE EM PARALELO.
 *
 * Duas integrações que saem do mesmo passo e voltam para o mesmo passo, dentro
 * de uma moldura tracejada com um título. A moldura responde uma pergunta que
 * os cartões soltos não respondem — **as duas acontecem, ou é uma ou outra?**
 * Empilhadas na mesma coluna, sem nada em volta, elas parecem as saídas de uma
 * decisão que não existe.
 *
 * Tracejada, e não sólida: o traço contínuo é o contorno de uma **coisa** — um
 * cartão, uma etapa que se clica. A caixa não é uma etapa; não seleciona, não
 * arrasta e não abre painel. É a mesma regra da raia e da fase, e o tracejado é
 * como um fluxograma de parede sempre disse "isto é um agrupamento, não um
 * passo".
 *
 * O rótulo é o plural do tipo que as etapas compartilham — "Sistemas",
 * "Documentos" —, e ele vem do catálogo (`plural`), não de uma regra que tente
 * pluralizar em português e escreva "Decisãos" no primeiro tipo terminado em
 * `ão`. Sem tipo comum, o rótulo é o que a caixa de fato afirma: "Em paralelo".
 */
export const NoDoGrupo = memo(function NoDoGrupo({ data }: NodeProps & { data: DadosDoGrupo }) {
  const { grupo, tipo } = data;
  const Icone = iconeDoCatalogo(tipo?.icone);
  const quantas = grupo.etapas.length;

  return (
    <div className="pointer-events-none h-full w-full rounded-xl border border-dashed border-muted-foreground/40 bg-muted/20">
      <div
        className="flex items-center gap-1.5 px-3"
        style={{ height: ALTURA_DO_ROTULO_DO_GRUPO }}
      >
        {Icone && <Icone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        <p className="truncate text-2xs font-medium text-muted-foreground">
          {tipo?.plural ?? "Em paralelo"}
        </p>
        <span className="shrink-0 text-2xs text-muted-foreground/70">· {quantas}</span>
      </div>
    </div>
  );
});
