import { CalendarDays } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAlteracoesPorVigencia } from "@/hooks/use-alteracoes-por-vigencia";
import type { FamiliesView } from "@/components/inicio/types";

/**
 * O seletor de vigência do cabeçalho — data à esquerda, quantas alterações
 * aquela vigência trouxe à direita.
 *
 * A contagem é o que faz a lista valer a abertura: entre seis datas iguais,
 * "714 alterações" e "6 alterações" são a diferença entre a vigência que
 * mudou o contrato e a que corrigiu um cadastro. Quem abre o menu já está
 * procurando *onde* algo aconteceu, e a data sozinha não responde isso.
 *
 * A contagem vem de `/changes/range` (o mesmo dado da Linha do Tempo) e é
 * opcional por construção: enquanto ela não chega — ou para a vigência mais
 * antiga do histórico, que não tem anterior contra a qual ser comparada —, a
 * linha mostra só a data. Nada aqui inventa "0 alterações" para preencher a
 * coluna.
 *
 * Estava escrito três vezes (Visão Geral, Linha do Tempo, Dashboard) e nas
 * três com uma diferença: no Dashboard a contagem simplesmente não existia.
 * Um menu que se abre igual em três telas e responde diferente em uma delas é
 * um bug de leitura, não uma variação de estilo — daí este componente.
 */
export function SeletorDeVigencia({
  view,
  consulta,
  onTrocar,
  className,
  rotulo = "Trocar vigência",
}: {
  view: FamiliesView | null;
  consulta: URLSearchParams;
  onTrocar: (mudancas: Record<string, string | null>) => void;
  className?: string;
  rotulo?: string;
}) {
  // O hook vem antes do corte: um `return null` acima dele mudaria a ordem
  // dos hooks entre renderizações quando a vigência ainda está carregando.
  const alteracoesPorVigencia = useAlteracoesPorVigencia(view, consulta);

  // Com uma vigência só não há troca a oferecer.
  if (!view || view.periods.length <= 1) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={className}>
        <CalendarDays className="w-4 h-4" />
        {rotulo}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 max-h-80 overflow-y-auto">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {view.periods.length} vigências no histórico
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {[...view.periods]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((periodo) => {
            const alteracoes = alteracoesPorVigencia.get(periodo.date) ?? null;
            return (
              <DropdownMenuItem
                key={periodo.date}
                onSelect={() => onTrocar({ period: periodo.date })}
                className={cn(
                  "flex items-center justify-between gap-2",
                  periodo.date === view.period && "font-bold text-brand",
                )}
              >
                <span>{periodo.label}</span>
                {alteracoes !== null && (
                  <span className="text-xs font-normal text-muted-foreground tabular-nums">
                    {alteracoes.toLocaleString("pt-BR")}{" "}
                    {alteracoes === 1 ? "alteração" : "alterações"}
                  </span>
                )}
              </DropdownMenuItem>
            );
          })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
