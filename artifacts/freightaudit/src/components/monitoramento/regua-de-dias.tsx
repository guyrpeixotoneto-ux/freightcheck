import { ChevronLeft, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  posicaoDaRegua,
  type DiaDaRegua,
  type EstadoDoDia,
} from "@/lib/monitoramento-de-chamados";

/**
 * A RÉGUA DE DIAS — por onde o dia começa.
 *
 * Cada posição é um dia da operação, e o que ela mostra é **o estado do
 * trabalho**, não o volume: a cor responde "preciso olhar isto?" antes de
 * qualquer número. Um dia com 300 movimentações todas revisadas é verde e não
 * pede nada; um com 3 pendentes é vermelho e pede.
 *
 * **Os cinco estados, e por que os dois azuis existem.** "Chegou arquivo e nada
 * mudou" e "foi a primeira importação desta unidade" dão os dois zero
 * movimentações, e são coisas diferentes — mas nenhuma das duas é trabalho. Por
 * isso compartilham a cor e se separam pela frase, que aparece no dia aberto.
 * Cinza é a terceira ausência: ninguém mandou arquivo.
 *
 * **O número na posição é o de pendências**, e não o de movimentações. É o que
 * a cor promete: um `18` vermelho quer dizer "dezoito para olhar", e trocá-lo
 * pelo total faria a régua prometer trabalho já feito.
 */

const CORES: Record<EstadoDoDia, string> = {
  /* Ninguém mandou arquivo: a ausência não é um estado do trabalho. */
  SEM_IMPORTACAO: "border-border bg-card text-muted-foreground",
  /* Chegou e não há o que revisar — ver o cabeçalho sobre os dois azuis. */
  PRIMEIRA_CARGA: "border-blue-200 bg-blue-50 text-blue-700",
  SEM_MOVIMENTACAO: "border-blue-200 bg-blue-50 text-blue-700",
  PENDENTE: "border-red-200 bg-red-50 text-red-700",
  REVISADO: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const DESCRICAO: Record<EstadoDoDia, string> = {
  SEM_IMPORTACAO: "nenhuma importação neste dia",
  PRIMEIRA_CARGA: "primeira importação da unidade — estado inicial registrado",
  SEM_MOVIMENTACAO: "importação concluída, nenhuma movimentação identificada",
  PENDENTE: "há movimentações aguardando revisão",
  REVISADO: "todas as movimentações do dia foram revisadas",
};

export function ReguaDeDias({
  dias,
  diaAberto,
  hoje,
  carregando,
  onDia,
  onDeslocar,
}: {
  dias: DiaDaRegua[];
  diaAberto: string;
  hoje: string;
  carregando: boolean;
  onDia: (dia: string) => void;
  /** Passos na janela: negativo anda para trás. */
  onDeslocar: (passos: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-3">
      <button
        onClick={() => onDeslocar(-7)}
        aria-label="Semana anterior"
        className="h-10 w-10 shrink-0 rounded-lg border grid place-content-center text-muted-foreground hover:text-foreground hover:bg-muted"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <div className="flex flex-1 gap-2 overflow-x-auto">
        {carregando && dias.length === 0
          ? Array.from({ length: 9 }, (_, i) => (
              <Skeleton key={i} className="h-16 flex-1 min-w-[64px] rounded-lg" />
            ))
          : dias.map((d) => {
              const { numero, mes } = posicaoDaRegua(d.dia);
              const aberto = d.dia === diaAberto;
              const ehHoje = d.dia === hoje;
              return (
                <button
                  key={d.dia}
                  onClick={() => onDia(d.dia)}
                  aria-current={aberto ? "date" : undefined}
                  title={`${numero}/${mes} — ${DESCRICAO[d.estado]}${
                    d.enviosComFalha > 0 ? " · há importação com falha neste dia" : ""
                  }`}
                  className={cn(
                    "flex-1 min-w-[64px] rounded-lg border px-2 py-2 transition-colors",
                    CORES[d.estado],
                    aberto && "ring-2 ring-primary ring-offset-1",
                    /*
                      A importação que falhou ganha contorno tracejado, e não uma
                      sexta cor: ela não é um estado do trabalho — é um aviso
                      sobre o dado que sustenta o estado. Ver `resumoDoDia`, que
                      escreve a frase inteira.
                    */
                    d.enviosComFalha > 0 && "border-dashed border-amber-400",
                  )}
                >
                  <div className="text-lg font-bold leading-none tabular-nums">
                    {numero}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide mt-0.5 opacity-80">
                    {mes}
                  </div>
                  {ehHoje ? (
                    <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide">
                      Hoje
                    </div>
                  ) : (
                    /*
                      Só o que pede trabalho ganha número. Um `0` em cada dia
                      revisado encheria a régua de zeros e faria o olho procurar
                      diferença onde não há.
                    */
                    <div className="mt-1 h-4 text-[11px] font-semibold tabular-nums">
                      {d.pendentes > 0 ? d.pendentes : ""}
                    </div>
                  )}
                </button>
              );
            })}
      </div>

      <button
        onClick={() => onDeslocar(7)}
        aria-label="Semana seguinte"
        className="h-10 w-10 shrink-0 rounded-lg border grid place-content-center text-muted-foreground hover:text-foreground hover:bg-muted"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
