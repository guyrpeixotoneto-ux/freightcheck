import { Check, AlertTriangle, Circle, FileWarning, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EstadoDaEtapa } from "@/pages/fechamento/status-da-etapa";
import type { EtapaDoRoteiro } from "@/pages/fechamento/roteiro";

/**
 * A TRILHA — as oito etapas do fechamento, na ordem, com o estado de cada uma.
 *
 * **O que ela responde, e o que ela deliberadamente não faz.** Responde "em que
 * pé está esta quinzena" de uma olhada. Não é navegação por passos e não trava
 * nada: clicar abre aquela etapa, e uma etapa com divergência não impede as
 * seguintes. Um fechamento real avança com pendência em aberto — quem confere
 * volta nela —, e uma trilha que bloqueasse obrigaria a operação a contornar o
 * produto para trabalhar.
 *
 * **Marcar a aberta não é o mesmo que declarar uma "atual".** O destaque diz
 * onde a pessoa está olhando agora — foi ela quem clicou, ou foi a tela que
 * abriu a primeira que pedia alguma coisa. O que a trilha continua não fazendo
 * é afirmar que aquela é a etapa em que o trabalho *deveria* estar: as oito
 * seguem com o mesmo peso, e o que distingue uma da outra é o estado.
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
  aberta,
  aoEscolher,
}: {
  etapas: { etapa: EtapaDoRoteiro; estado: EstadoDaEtapa }[];
  /** O número da etapa aberta agora — a trilha a marca, sem chamá-la de "atual". */
  aberta: number;
  aoEscolher: (numero: number) => void;
}) {
  return (
    /*
      Rola na horizontal em vez de quebrar em duas linhas: a trilha é uma
      sequência, e uma sequência partida ao meio deixa de ser lida como ordem.
    */
    <nav aria-label="Etapas do fechamento" className="overflow-x-auto -mx-1 px-1">
      <ol className="flex items-stretch min-w-max">
        {etapas.map(({ etapa, estado }, i) => {
          const { rotulo, ponto } = APARENCIA_DO_ESTADO[estado];
          const estaAberta = etapa.numero === aberta;
          return (
            <li key={etapa.numero} className="flex items-stretch">
              {/*
                Botão, e não âncora: clicar **abre** a etapa, e um `#hash` que
                rolasse até um bloco fechado levaria a pessoa a um cabeçalho e
                nada mais. A rolagem continua acontecendo, depois de abrir.
              */}
              <button
                type="button"
                onClick={() => aoEscolher(etapa.numero)}
                aria-current={estaAberta ? "step" : undefined}
                title={`${etapa.titulo} — ${rotulo}`}
                className={cn(
                  "group flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors",
                  estaAberta ? "bg-muted" : "hover:bg-muted",
                )}
              >
                <span
                  className={cn("w-2 h-2 rounded-full shrink-0", ponto)}
                  aria-hidden
                />
                <span className="text-xs whitespace-nowrap">
                  <span className="text-muted-foreground tabular-nums">
                    {etapa.numero}.
                  </span>{" "}
                  <span
                    className={cn(
                      "group-hover:underline underline-offset-4",
                      estaAberta ? "font-semibold" : "font-medium",
                    )}
                  >
                    {etapa.curto}
                  </span>
                </span>
                {/* O estado por extenso, para quem lê com leitor de tela. */}
                <span className="sr-only">— {rotulo}</span>
              </button>
              {i < etapas.length - 1 && (
                <span
                  className="self-center text-muted-foreground/40 text-xs px-0.5"
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
