import { Activity, CircleDot } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_LABELS } from "@/components/changes/ticket-table";
import { cn } from "@/lib/utils";
import {
  diaDaOperacaoDe,
  diaLegivel,
  type ChamadoNaFila,
} from "@/lib/monitoramento-de-chamados";

/**
 * CHAMADOS DO ENVIO — a relação que o arquivo trouxe.
 *
 * A lista irmã de `lista-de-movimentacoes.tsx`, e deliberadamente **mais
 * pobre** que ela: aqui não há antes → depois, porque não há mudança nenhuma a
 * mostrar — é a fila como o arquivo a escreveu. Quem quiser saber o que se
 * mexeu troca de visão, e o selo "movimentou hoje" diz onde procurar.
 *
 * Uma linha e não uma tabela, pela mesma razão da lista de movimentações: os
 * campos que importam variam por chamado — uns têm placa, outros têm cargo;
 * uns têm prazo, outros não — e uma tabela pagaria colunas vazias em todos
 * eles. A tabela larga do envio já existe, e é a da aba Chamados.
 *
 * Não há botão de revisar: revisão é ato sobre **movimentação**, e oferecer o
 * carimbo aqui criaria um segundo estado de "revisado" que a régua não conta —
 * dois números certos e a leitura errada.
 */
export function ListaDeChamados({
  chamados,
  carregando,
}: {
  chamados: ChamadoNaFila[];
  carregando: boolean;
}) {
  if (carregando && chamados.length === 0) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-xl border bg-card">
      {chamados.map((c) => (
        <li key={c.id} className="flex gap-4 px-4 py-3.5">
          <div
            className={cn(
              "h-9 w-9 rounded-lg grid place-content-center shrink-0",
              c.movimentou
                ? "bg-amber-50 text-amber-600"
                : "bg-muted text-muted-foreground",
            )}
            title={
              c.movimentou
                ? "este chamado se mexeu neste dia — veja o antes → depois em Movimentações"
                : "veio no arquivo e não mudou em relação à importação anterior"
            }
          >
            {c.movimentou ? (
              <Activity className="h-4 w-4" />
            ) : (
              <CircleDot className="h-4 w-4" />
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-bold text-primary tabular-nums">
                {c.externalId}
              </span>
              <span className="text-[10px] uppercase tracking-wide font-semibold rounded px-1.5 py-0.5 bg-muted text-muted-foreground">
                {c.statusRaw ?? STATUS_LABELS[c.statusBucket] ?? "sem status"}
              </span>
              {c.movimentou && (
                <span className="text-[10px] uppercase tracking-wide font-semibold rounded px-1.5 py-0.5 bg-amber-50 text-amber-700">
                  Movimentou hoje
                </span>
              )}
              <span className="truncate text-sm">
                {c.assunto ?? "Sem assunto no arquivo"}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {/*
                Os campos entram na linha só quando existem, e o separador vem
                junto do campo: um "• • •" de campos vazios é o que faz uma
                lista de 1.218 linhas parecer defeituosa quando ela está certa.
              */}
              {[
                c.unidade,
                c.area,
                c.responsavel,
                c.entidade,
                c.categoria,
                c.prazoPrevisto && `prazo ${diaLegivel(c.prazoPrevisto)}`,
                c.parametros > 0 &&
                  `${c.parametros} ${c.parametros === 1 ? "parâmetro" : "parâmetros"}`,
              ]
                .filter((campo): campo is string => Boolean(campo))
                /*
                  A chave carrega a posição porque dois campos podem trazer o
                  mesmo texto — uma unidade que se chama como a área, e a lista
                  passaria a ter chave repetida.
                */
                .map((campo, i) => (
                  <span key={`${i}-${campo}`} className="flex items-center gap-2">
                    {i > 0 && <span aria-hidden>•</span>}
                    <span>{campo}</span>
                  </span>
                ))}
            </div>
          </div>

          <div className="shrink-0 text-right text-xs text-muted-foreground">
            {/*
              A situação do chamado, e não a hora do import: quem desce a
              relação está perguntando "este ainda está aberto?", e a hora do
              arquivo é a mesma em todas as 1.218 linhas.
            */}
            {c.encerradoEm ? (
              /*
                A data no fuso da operação, e não o recorte cru do ISO: um
                fechamento das 21h de 02/09 vira `2026-09-03` em UTC, e a linha
                mostraria o chamado encerrado um dia depois do que a Ambev
                escreveu. É a mesma conversão que a régua e a hora usam.
              */
              <span title="data de fechamento declarada no arquivo">
                encerrado em {diaLegivel(diaDaOperacaoDe(c.encerradoEm))}
              </span>
            ) : (
              <span className="text-amber-700">em aberto</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
