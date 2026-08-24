import { Check, AlertTriangle, Circle, FileWarning, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EstadoDaEtapa } from "@/pages/fechamento/status-da-etapa";
import type { EtapaDoRoteiro } from "@/pages/fechamento/roteiro";

/**
 * A TRILHA — as oito etapas do fechamento, na ordem, com o estado de cada uma.
 *
 * **O que ela responde, e o que ela deliberadamente não faz.** Responde "em que
 * pé está esta quinzena" de uma olhada. Não é navegação por passos e não trava
 * nada: clicar leva à etapa na mesma página, e uma etapa com divergência não
 * impede as seguintes. Um fechamento real avança com pendência em aberto — quem
 * confere volta nela —, e uma trilha que bloqueasse obrigaria a operação a
 * contornar o produto para trabalhar.
 *
 * Por isso não há "etapa atual": as oito são mostradas com o mesmo peso, e o
 * que distingue uma da outra é só o estado. Marcar uma como "a de agora" seria
 * uma afirmação sobre a ordem de trabalho de quem fecha, e essa ordem é dela.
 */

/**
 * O vocabulário visual dos cinco estados — um lugar só.
 *
 * Ícone **e** cor, nunca cor sozinha: quem não distingue verde de âmbar precisa
 * ler a mesma coisa que os outros. O rótulo acompanha pelo mesmo motivo.
 */
export const APARENCIA_DO_ESTADO: Record<
  EstadoDaEtapa,
  { rotulo: string; icone: typeof Check; classe: string; ponto: string }
> = {
  CONCLUIDA: {
    rotulo: "Conferida",
    icone: Check,
    classe: "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10",
    ponto: "bg-emerald-500",
  },
  DIVERGENCIA: {
    rotulo: "Divergência",
    icone: AlertTriangle,
    classe: "text-amber-700 dark:text-amber-400 bg-amber-500/10",
    ponto: "bg-amber-500",
  },
  COM_RECUSA: {
    rotulo: "Linhas recusadas",
    icone: FileWarning,
    classe: "text-red-700 dark:text-red-400 bg-red-500/10",
    ponto: "bg-red-500",
  },
  PENDENTE: {
    rotulo: "Falta arquivo",
    icone: Circle,
    classe: "text-muted-foreground bg-muted",
    ponto: "bg-muted-foreground/40",
  },
  NAO_DISPONIVEL: {
    rotulo: "Sem conferência automática",
    icone: Minus,
    classe: "text-muted-foreground bg-muted",
    ponto: "bg-muted-foreground/20",
  },
};

/** O selo de uma etapa — ícone, rótulo e cor, do mesmo vocabulário da trilha. */
export function SeloDaEtapa({ estado }: { estado: EstadoDaEtapa }) {
  const { rotulo, icone: Icone, classe } = APARENCIA_DO_ESTADO[estado];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        classe,
      )}
    >
      <Icone className="w-3 h-3 shrink-0" />
      {rotulo}
    </span>
  );
}

export function TrilhaDoRoteiro({
  etapas,
}: {
  etapas: { etapa: EtapaDoRoteiro; estado: EstadoDaEtapa }[];
}) {
  return (
    /*
      Rola na horizontal em vez de quebrar em duas linhas: a trilha é uma
      sequência, e uma sequência partida ao meio deixa de ser lida como ordem.
    */
    <nav aria-label="Etapas do fechamento" className="overflow-x-auto -mx-1 px-1">
      <ol className="flex items-stretch gap-1 min-w-max">
        {etapas.map(({ etapa, estado }, i) => {
          const { rotulo, ponto } = APARENCIA_DO_ESTADO[estado];
          return (
            <li key={etapa.numero} className="flex items-stretch gap-1">
              <a
                href={`#etapa-${etapa.numero}`}
                title={`${etapa.titulo} — ${rotulo}`}
                className="group flex items-center gap-2 rounded-md px-2.5 py-1.5 hover:bg-muted transition-colors"
              >
                <span
                  className={cn("w-2 h-2 rounded-full shrink-0", ponto)}
                  aria-hidden
                />
                <span className="text-xs">
                  <span className="text-muted-foreground tabular-nums">
                    {etapa.numero}.
                  </span>{" "}
                  <span className="font-medium group-hover:underline underline-offset-4">
                    {etapa.curto}
                  </span>
                </span>
                {/* O estado por extenso, para quem lê com leitor de tela. */}
                <span className="sr-only">— {rotulo}</span>
              </a>
              {i < etapas.length - 1 && (
                <span
                  className="self-center text-muted-foreground/40 text-xs"
                  aria-hidden
                >
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
