import { Briefcase, HardHat, type LucideIcon } from "lucide-react";
import { ROTULO_DO_QUADRO, type QuadroDeQlp } from "@workspace/comparison/monitor-equipe";
import { QUADROS_DO_MONITOR } from "@/lib/monitor-equipe";
import { cn } from "@/lib/utils";

/**
 * AS ABAS DO MONITOR EQUIPE — uma população de cada vez.
 *
 * ---------------------------------------------------------------------------
 * Por que aba, e não dois blocos lado a lado
 * ---------------------------------------------------------------------------
 * O operacional e o administrativo são **duas séries**: pares próprios, change
 * sets próprios, catálogos de coluna que nem sequer se parecem — o export
 * administrativo traz benefício numa coluna só e o operacional o decompõe em
 * nove. Ler os dois na mesma tabela obriga quem audita a filtrar mentalmente a
 * coluna "Quadro" em cada linha, e faz os cartões do topo somarem duas
 * populações num número que não existe em lugar nenhum: nem o administrativo
 * publica aquele total, nem o operacional.
 *
 * Com a aba, cada número do topo pertence a **um** quadro, e é o mesmo número
 * que a tela daquele quadro publica. É o desenho que o QLP já usa — o mesmo
 * seletor de `components/qlp/seletor-de-quadro.tsx`, e as mesmas abas por
 * quadro da tela de módulo —, e esta tela passa a lê-lo igual.
 *
 * ---------------------------------------------------------------------------
 * A aba mora no endereço, no filtro que já existia
 * ---------------------------------------------------------------------------
 * `?quadro=` já era o recorte por quadro do Monitor. A aba não inventa um
 * segundo estado para a mesma pergunta: ela **é** aquele filtro, agora com uma
 * escolha de cada vez. Um link mandado continua abrindo na população que quem
 * mandou estava lendo.
 */
const ICONE: Record<QuadroDeQlp, LucideIcon> = {
  OPERACIONAL: HardHat,
  ADMINISTRATIVO: Briefcase,
};

export function AbasDoMonitorDeEquipe({
  aba,
  onTrocar,
}: {
  aba: QuadroDeQlp;
  onTrocar: (quadro: QuadroDeQlp) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Quadro de pessoal"
      className="flex w-fit flex-wrap items-center gap-1 rounded-full border bg-muted/40 p-1"
    >
      {QUADROS_DO_MONITOR.map((quadro) => {
        const ativo = quadro === aba;
        const Icone = ICONE[quadro];
        return (
          <button
            key={quadro}
            type="button"
            role="tab"
            aria-selected={ativo}
            onClick={() => onTrocar(quadro)}
            className={cn(
              "flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors",
              ativo
                ? "bg-background text-brand shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icone className="h-4 w-4" aria-hidden="true" />
            {ROTULO_DO_QUADRO[quadro].replace("QLP ", "")}
          </button>
        );
      })}
    </div>
  );
}
