import { useMemo } from "react";
import { ChevronRight, Server, Timer, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { linhasDaLista } from "@/lib/fluxos-analise";
import type { PropsDaVisao } from "@/components/fluxos/visao";

/**
 * VISUALIZAÇÃO 3 — A JORNADA: o processo como linha do tempo.
 *
 * É a visão de reunião. O fluxograma é o instrumento de quem levanta o
 * processo; a jornada é o que se mostra para a diretoria: a sequência, quem
 * responde, em que sistema, em quanto tempo. Um cartão por macroetapa, na ordem
 * do processo, e nada mais.
 *
 * **Ela esconde de propósito.** Falhas, gargalos, regras, indicadores e ações
 * não aparecem aqui — não porque não importem, mas porque tudo junto é
 * exatamente o que faz uma tela de processo virar ilegível. Clicar abre o mesmo
 * painel de detalhe das outras visualizações, com tudo.
 *
 * O prazo aparece quando existe e diz "sem prazo definido" quando não existe.
 * Nunca um número estimado: o dia em que essa coluna mostrar um SLA que ninguém
 * acordou, ela deixa de servir para decidir qualquer coisa.
 *
 * No celular a jornada é a visualização que continua funcionando sem adaptação
 * nenhuma — cartões empilhados, um por linha, com o mesmo conteúdo.
 */
export function VisaoJornada({
  completo,
  catalogo,
  etapaSelecionada,
  onSelecionarEtapa,
}: PropsDaVisao) {
  const linhas = useMemo(() => linhasDaLista(completo), [completo]);

  return (
    <div className="h-full overflow-auto bg-muted/20 px-4 py-6 sm:px-8">
      <ol className="mx-auto flex max-w-6xl flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-stretch">
        {linhas.map((linha, indice) => {
          const tipo = catalogo?.tiposDeEtapa.find((t) => t.valor === linha.etapa.tipo);
          const aberta = etapaSelecionada === linha.etapa.id;
          return (
            /*
              Cartão e seta são **um** item de fluxo, e não dois: soltos, a
              quebra de linha jogaria a seta do último cartão da linha para o
              começo da linha seguinte, e a jornada passaria a começar com uma
              seta apontando para lugar nenhum.
            */
            <li key={linha.etapa.id} className="flex items-stretch gap-3">
              <button
                type="button"
                onClick={() => onSelecionarEtapa(aberta ? null : linha.etapa.id)}
                aria-pressed={aberta}
                className={cn(
                  "w-full rounded-lg border bg-card px-4 py-3 text-left shadow-sm transition-shadow hover:shadow-md lg:w-[236px]",
                  aberta && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                )}
                data-testid={`jornada-${linha.etapa.nome}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                    {String(linha.numero).padStart(2, "0")}
                  </span>
                  <Badge variant="secondary" className="font-normal">
                    {tipo?.rotulo ?? linha.etapa.tipo}
                  </Badge>
                  {linha.etapa.status === "ATENCAO" && (
                    <Badge variant="destructive" className="font-normal">
                      Atenção
                    </Badge>
                  )}
                </div>

                <p className="mt-2 text-sm font-medium leading-snug text-foreground">
                  {linha.etapa.nome}
                </p>

                <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Users className="h-3 w-3 shrink-0" />
                    <dt className="sr-only">Responsável</dt>
                    <dd className="truncate">
                      {[linha.area, linha.responsavel].filter(Boolean).join(" · ") || (
                        <span className="text-muted-foreground/60">sem responsável</span>
                      )}
                    </dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Server className="h-3 w-3 shrink-0" />
                    <dt className="sr-only">Sistema</dt>
                    <dd className="truncate">
                      {linha.sistema ?? <span className="text-muted-foreground/60">sem sistema</span>}
                    </dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Timer className="h-3 w-3 shrink-0" />
                    <dt className="sr-only">Prazo</dt>
                    <dd className="truncate">
                      {linha.sla ?? (
                        <span className="text-muted-foreground/60">sem prazo definido</span>
                      )}
                    </dd>
                  </div>
                </dl>
              </button>

              {/*
                A seta entre cartões é decoração e não conteúdo: some do leitor
                de tela e vira uma quebra vertical no celular, onde a jornada é
                uma pilha e não uma linha.
              */}
              {indice < linhas.length - 1 && (
                <span
                  aria-hidden
                  className="flex shrink-0 items-center justify-center text-muted-foreground/50"
                >
                  <ChevronRight className="h-4 w-4 rotate-90 lg:rotate-0" />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
