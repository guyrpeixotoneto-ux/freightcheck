import {
  ArrowRight,
  CheckCircle2,
  CirclePlus,
  CircleSlash,
  Pencil,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ROTULO_DA_CLASSE,
  horaLegivel,
  oscilouEVoltou,
  rotuloDaDiferenca,
  valorLegivel,
  type ClasseDaMovimentacao,
  type Movimentacao,
} from "@/lib/monitoramento-de-chamados";

/**
 * ALTERAÇÕES DO DIA — a fila de trabalho.
 *
 * A decisão que manda nesta lista: **o antes → depois fica na própria linha.**
 * Ele é a informação central da tela, e escondê-lo atrás de um clique
 * transformaria a revisão de setenta movimentações em setenta cliques. Uma linha
 * mostra o que mudou, e só o encadeamento intradia — que quase ninguém abre —
 * mora numa rota separada.
 *
 * A segunda decisão é o **selo de revisão à direita**: é o estado do trabalho, e
 * é o que o olho procura ao descer a lista. Ele é um botão, e não um ícone: o
 * caminho para revisar tem de ser o mesmo lugar onde se lê que falta revisar.
 */

const ICONE: Record<ClasseDaMovimentacao, { icone: typeof Pencil; cor: string }> = {
  NOVO: { icone: CirclePlus, cor: "bg-blue-50 text-blue-600" },
  ALTERADO: { icone: Pencil, cor: "bg-amber-50 text-amber-600" },
  ENCERRADO: { icone: CheckCircle2, cor: "bg-emerald-50 text-emerald-600" },
  REMOVIDO: { icone: CircleSlash, cor: "bg-slate-100 text-slate-500" },
};

function Diferencas({ m }: { m: Movimentacao }) {
  if (oscilouEVoltou(m)) {
    /*
      O chamado que foi e voltou no mesmo dia. Não há "antes → depois" a mostrar
      — o saldo é zero —, e sumir com ele da fila esconderia exatamente o ruído
      que esta tela existe para pegar. A linha diz o que aconteceu em vez de
      ficar vazia.
    */
    return (
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <RotateCcw className="h-3.5 w-3.5 shrink-0" />
        <span>
          Mudou {m.passos === 1 ? "uma vez" : `${m.passos} vezes`} e voltou ao
          estado do início do dia.
        </span>
      </div>
    );
  }

  if (m.classe === "NOVO") {
    return (
      <div className="text-sm text-muted-foreground">
        Chamado não existia na importação anterior.
      </div>
    );
  }

  if (m.classe === "REMOVIDO") {
    return (
      <div className="text-sm text-muted-foreground">
        Não veio nesta importação. Pode ter saído da fila na origem.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {m.diferencas.map((d) => (
        <div key={`${d.tipo}-${d.campo}`} className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="text-muted-foreground shrink-0">
            {rotuloDaDiferenca(d)}:
          </span>
          <span className="tabular-nums">{valorLegivel(d.antes)}</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="font-semibold tabular-nums">{valorLegivel(d.depois)}</span>
        </div>
      ))}
    </div>
  );
}

export function ListaDeMovimentacoes({
  movimentacoes,
  carregando,
  ocupadas,
  onRevisar,
  onDesfazer,
}: {
  movimentacoes: Movimentacao[];
  carregando: boolean;
  /** Ids com escrita em voo — o botão não pode ser clicado duas vezes. */
  ocupadas: Set<string>;
  onRevisar: (m: Movimentacao) => void;
  onDesfazer: (m: Movimentacao) => void;
}) {
  if (carregando && movimentacoes.length === 0) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-xl border bg-card">
      {movimentacoes.map((m) => {
        const { icone: Icone, cor } = ICONE[m.classe];
        const ocupada = ocupadas.has(m.id);
        return (
          <li key={m.id} className="flex gap-4 px-4 py-4">
            <div
              className={cn(
                "h-9 w-9 rounded-lg grid place-content-center shrink-0",
                cor,
              )}
              title={ROTULO_DA_CLASSE[m.classe]}
            >
              <Icone className="h-4 w-4" />
            </div>

            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-bold text-primary tabular-nums">
                  {m.externalId}
                </span>
                <span className="text-[10px] uppercase tracking-wide font-semibold rounded px-1.5 py-0.5 bg-muted text-muted-foreground">
                  {ROTULO_DA_CLASSE[m.classe]}
                </span>
                <span className="truncate text-sm">
                  {m.assunto ?? "Sem assunto no arquivo"}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {/* Unidade • Área — o recorte que o gestor reconhece primeiro. */}
                {m.unidade && <span>{m.unidade}</span>}
                {m.unidade && m.area && <span>•</span>}
                {m.area && <span>{m.area}</span>}
                {(m.unidade || m.area) && <span>•</span>}
                <span title="hora da importação que produziu esta movimentação">
                  {horaLegivel(m.movidaEm)}
                </span>
                {m.passos > 1 && (
                  <>
                    <span>•</span>
                    <span title="o chamado se mexeu mais de uma vez neste dia; abra para ver o encadeamento">
                      {m.passos} movimentações hoje
                    </span>
                  </>
                )}
                {m.responsavel && (
                  <>
                    <span>•</span>
                    <span>{m.responsavel}</span>
                  </>
                )}
              </div>

              <Diferencas m={m} />
            </div>

            <div className="flex flex-col items-end gap-2 shrink-0">
              {m.criticidade === "CRITICO" && (
                <span
                  className="text-[10px] uppercase tracking-wide font-semibold rounded px-1.5 py-0.5 bg-red-50 text-red-700"
                  /* A procedência vai junto do selo, sempre: ele é nosso, e não
                     da Ambev. Ver `criticidadeDoChamado`, no motor. */
                  title={`${m.criticidadeMotivo ?? ""} (classificação derivada por nós — a Ambev não envia prioridade)`}
                >
                  Crítico
                </span>
              )}

              {m.revisada ? (
                <button
                  onClick={() => onDesfazer(m)}
                  disabled={ocupada}
                  title={
                    m.revisadaPor
                      ? `Revisado por ${m.revisadaPor}${
                          m.revisadaEm ? ` às ${horaLegivel(m.revisadaEm)}` : ""
                        } — clique para desfazer`
                      : "Clique para desfazer"
                  }
                  className="inline-flex items-center gap-1 text-xs font-semibold rounded px-2 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Revisado
                  <Undo2 className="h-3 w-3 opacity-60" />
                </button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={ocupada}
                  onClick={() => onRevisar(m)}
                  className="h-7 text-xs"
                >
                  Marcar revisado
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
