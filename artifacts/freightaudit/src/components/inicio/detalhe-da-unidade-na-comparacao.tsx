import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FileText, TrendingUp, Truck, type LucideIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { ApiError, fetchJson } from "@/lib/api";
import { ApiErrorNotice } from "@/components/api-error";
import { cn } from "@/lib/utils";
import { periodicitySuffix } from "@/lib/format";
import {
  detalheDaAlteracao,
  detalheDoImpacto,
  escreverImpacto,
  maioresImpactos,
  ultimasAlteracoes,
} from "@/lib/visao-geral";
import { nomeDaUnidade, RECORTE_VAZIO, type Recorte } from "@/lib/recorte";
import { DetalheDoImpacto } from "@/components/inicio/detalhe-do-impacto";
import {
  COR_DA_LINHA,
  DetalheDaAlteracao,
  ICONE_DA_LINHA,
} from "@/components/inicio/detalhe-da-alteracao";
import type { FamiliesView, OverviewContextRef } from "@/components/inicio/types";

const CARTAO = "bg-card border rounded-xl shadow-sm";

/**
 * A 2ª etapa da comparação por unidade: o resumo executivo de uma unidade
 * sozinha, empilhado sobre a comparação em vez de trocar de tela.
 *
 * Pede a mesma resposta que o Resumo Executivo pede quando alguém abre uma
 * unidade pelo seletor da lateral (`/changes/families`), só que sem navegar —
 * a comparação continua atrás, e fechar esta gaveta volta para ela em vez de
 * para a Visão Geral. Os dois ranques (maiores impactos, alterações em
 * destaque) abrem a 3ª etapa: o mesmo par de gavetas (`DetalheDoImpacto`,
 * `DetalheDaAlteracao`) que a tela de uma unidade já usa, para que o clique
 * dentro da comparação responda exatamente o que o mesmo clique responderia
 * lá.
 */
export function DetalheDaUnidadeNaComparacao({
  contexto,
  label,
  period,
  onFechar,
}: {
  contexto: OverviewContextRef;
  label: string;
  /** A competência da comparação — a mesma vigência que os números ali somam. */
  period: string;
  onFechar: () => void;
}) {
  const [impactoAberto, setImpactoAberto] = useState<{
    key: string;
    periodicidade: string | null;
  } | null>(null);
  const [alteracaoAberta, setAlteracaoAberta] = useState<string | null>(null);

  const consulta = new URLSearchParams({ period, scopeHash: contexto.scopeHash });
  if (contexto.channel !== null) consulta.set("canal", contexto.channel);

  const vigencia = useQuery({
    queryKey: ["families", "unidade-na-comparacao", consulta.toString()],
    queryFn: async () => {
      try {
        return await fetchJson<FamiliesView>(`/changes/families?${consulta}`);
      } catch (erro) {
        if (erro instanceof ApiError && erro.status === 404) return null;
        throw erro;
      }
    },
  });

  const view = vigencia.data ?? null;
  const ranking = view ? maioresImpactos(view.summary) : null;
  const recorte: Recorte = {
    ...RECORTE_VAZIO,
    scopeHash: contexto.scopeHash,
    canal: contexto.channel,
  };
  const linhasDeDestaque = view ? ultimasAlteracoes(view, 4) : [];

  const detalheDoImpactoAberto = view
    ? detalheDoImpacto(view, impactoAberto?.key ?? null, impactoAberto?.periodicidade ?? null)
    : null;
  const alteracaoAbertaDetalhe = view
    ? detalheDaAlteracao(view, alteracaoAberta, recorte)
    : null;

  return (
    <Sheet open onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col gap-0">
        <header className="px-7 pt-7 pb-5 border-b shrink-0">
          <SheetTitle className="text-2xl font-extrabold tracking-tight">
            {view ? nomeDaUnidade(view.context) : label}
          </SheetTitle>
          <SheetDescription className="mt-2 max-w-xl leading-snug">
            O resumo executivo desta unidade sozinha, nesta competência — famílias,
            maiores impactos e as alterações em destaque que a soma de todas juntas
            não sabia de onde vinham.
          </SheetDescription>
        </header>

        <div className="flex-1 overflow-y-auto px-7 py-6 space-y-5">
          {vigencia.isLoading && (
            <p className="text-sm text-muted-foreground">Carregando o resumo da unidade…</p>
          )}

          {vigencia.error && (
            <ApiErrorNotice
              error={vigencia.error}
              what="Não foi possível montar o resumo desta unidade."
            />
          )}

          {!vigencia.isLoading && !vigencia.error && view === null && (
            <p className="text-sm text-muted-foreground">
              Esta unidade não tem vigência nesta competência.
            </p>
          )}

          {view && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <CartaoNumero
                  icone={TrendingUp}
                  titulo="Impacto líquido"
                  valor={
                    ranking
                      ? escreverImpacto({ periodicity: ranking.periodicity, amount: view.impact.byPeriodicity[ranking.periodicity] ?? 0 })
                      : "—"
                  }
                />
                <CartaoNumero
                  icone={FileText}
                  titulo="Alterações"
                  valor={String(view.totals.changes)}
                />
                <CartaoNumero
                  icone={Truck}
                  titulo="Veículos afetados"
                  valor={String(view.totals.vehiclesTouched)}
                />
              </div>

              <section className={cn(CARTAO, "px-6 py-5")}>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold">Maiores impactos</h2>
                  {ranking && (
                    <span className="text-xs font-semibold text-muted-foreground">
                      em R${periodicitySuffix(ranking.periodicity)}
                    </span>
                  )}
                </div>

                {ranking === null ? (
                  <p className="text-sm text-muted-foreground mt-3">
                    Nenhum parâmetro tem impacto apurado nesta vigência.
                  </p>
                ) : (
                  <ol className="mt-4 space-y-3">
                    {ranking.linhas.map((linha) => (
                      <li key={linha.key}>
                        <button
                          type="button"
                          onClick={() =>
                            setImpactoAberto({ key: linha.key, periodicidade: ranking.periodicity })
                          }
                          className="w-full flex items-center gap-3 text-left rounded-lg px-2 -mx-2 py-1.5 -my-1.5 hover:bg-muted/60 transition-colors group"
                        >
                          <span
                            className="w-40 shrink-0 min-w-0 text-sm font-semibold truncate group-hover:underline"
                            title={linha.name}
                          >
                            {linha.name}
                          </span>
                          <span className="flex-1 h-2.5 bg-muted overflow-hidden min-w-8">
                            <span
                              className={cn(
                                "block h-full",
                                linha.amount < 0 ? "bg-red-600" : "bg-emerald-600",
                              )}
                              style={{ width: `${Math.max(2, linha.proporcao * 100)}%` }}
                            />
                          </span>
                          <span
                            className={cn(
                              "text-sm font-bold tabular-nums w-28 text-right",
                              linha.amount < 0 ? "text-red-700" : "text-emerald-700",
                            )}
                          >
                            {escreverImpacto({ periodicity: ranking.periodicity, amount: linha.amount })}
                          </span>
                          <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground opacity-40 group-hover:opacity-100 transition-opacity" />
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section className={cn(CARTAO, "px-6 py-5")}>
                <h2 className="text-base font-bold">Alterações em destaque</h2>

                {linhasDeDestaque.length === 0 ? (
                  <p className="text-sm text-muted-foreground mt-3">
                    O cliente não mexeu em nada nesta vigência.
                  </p>
                ) : (
                  <ol className="mt-3 divide-y">
                    {linhasDeDestaque.map((linha, indice) => {
                      const Icone = ICONE_DA_LINHA[linha.tipo];
                      return (
                        <li key={linha.chave}>
                          <button
                            type="button"
                            onClick={() => setAlteracaoAberta(linha.chave)}
                            className="w-full text-left group flex items-start gap-3 py-3 -mx-2 px-2 rounded-lg hover:bg-accent/40 transition-colors"
                          >
                            <span
                              className={cn(
                                "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                                COR_DA_LINHA[linha.tipo],
                              )}
                            >
                              <Icone className="w-4 h-4" />
                            </span>
                            <span className="text-sm font-bold text-muted-foreground tabular-nums shrink-0 pt-1">
                              {indice + 1}.
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold leading-snug group-hover:text-brand transition-colors">
                                {linha.titulo}
                              </span>
                              <span className="block text-xs text-muted-foreground mt-1 leading-snug">
                                {linha.detalhe}
                              </span>
                            </span>
                            <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground opacity-40 group-hover:opacity-100 transition-opacity mt-1.5" />
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
            </>
          )}
        </div>
      </SheetContent>

      {view && (
        <>
          <DetalheDoImpacto
            detalhe={detalheDoImpactoAberto}
            period={view.period}
            periodLabel={view.periodLabel}
            recorte={recorte}
            onFechar={() => setImpactoAberto(null)}
          />
          <DetalheDaAlteracao
            detalhe={alteracaoAbertaDetalhe}
            period={view.period}
            periodLabel={view.periodLabel}
            onFechar={() => setAlteracaoAberta(null)}
          />
        </>
      )}
    </Sheet>
  );
}

function CartaoNumero({
  icone: Icone,
  titulo,
  valor,
}: {
  icone: LucideIcon;
  titulo: string;
  valor: string;
}) {
  return (
    <div className={cn(CARTAO, "px-5 py-4")}>
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icone className="w-4 h-4" />
        <span className="text-xs font-semibold uppercase tracking-wide">{titulo}</span>
      </div>
      <p className="text-2xl font-extrabold mt-2">{valor}</p>
    </div>
  );
}
