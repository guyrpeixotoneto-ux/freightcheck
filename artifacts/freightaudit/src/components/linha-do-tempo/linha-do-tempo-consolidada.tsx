import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Layers, MapPin, TriangleAlert } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import { linkDeAlteracoes } from "@/lib/recorte";
import { opcoesDoIntervaloGeral } from "@/lib/intervalo-da-linha-do-tempo";
import { ApiErrorNotice } from "@/components/api-error";
import {
  CARTAO,
  CartoesDeResumo,
  ContagemPorVigencia,
  EvolucaoDasVigencias,
  Narrativa,
  OndeEstaOImpacto,
  PendenciasDeValoracao,
  contar,
  rankingDeUnidades,
} from "@/components/linha-do-tempo/linha-do-tempo-de-impacto";
import type {
  RangeMovement,
  RangeOverview,
  RangeOverviewPoint,
  ResumoDoIntervalo,
} from "@/lib/analise";

/**
 * A Linha do Tempo em Visão Geral — o mesmo histórico, somado entre unidades.
 *
 * Trocar a unidade por "Visão Geral" mostrava três números de uma competência
 * só: o histórico, o mês crítico, o acumulado, o que falta valorar e o ranking
 * de unidades — tudo o que a tela existe para responder — sumiam justamente
 * quando a pergunta deixava de ser sobre uma unidade. Esta seção responde a
 * mesma coisa que a de uma unidade, com o mesmo desenho, sobre a soma.
 *
 * Não é leitura nova: sai de `/changes/range/overview`, que já roda a análise
 * do intervalo unidade a unidade para alimentar o "Onde está o impacto?" da
 * tela de uma unidade e o gráfico do Dashboard. O que ela soma são os
 * `movements` de cada unidade — o mesmo número que cada unidade publica na
 * própria linha do tempo —, e nunca as linhas de alteração: assim a soma entre
 * unidades é a soma do que cada uma mostra, e não uma segunda contabilidade.
 *
 * **O que a Visão Geral não faz, e por quê.** Não há "Atributos de maior
 * impacto" nem gaveta por parâmetro: parâmetro não se soma entre unidades na
 * v1 (ver `getFamiliesOverview`/`getRangeOverview` no servidor), e um ranking
 * de atributos consolidado seria um número que ninguém pode conferir. O clique
 * numa vigência também não vai para as Alterações — "todas as unidades" não é
 * recorte que aquela tela saiba honrar (`lib/recorte.ts`) — e abre, em vez
 * disso, o passo que falta: de quem é aquele mês, unidade a unidade, e dali o
 * endereço de cada uma.
 */
export function LinhaDoTempoConsolidada({
  periodos,
  ate,
}: {
  /** A união das competências de todas as unidades, da mais recente para a mais antiga. */
  periodos: string[];
  /** A ponta final — a competência aberta no seletor. */
  ate: string | null;
}) {
  const de = periodos[periodos.length - 1] ?? null;

  /*
    A mesma chave de `opcoesDoIntervaloGeral` que a tela de uma unidade usa
    para o ranking e que o Dashboard usa para o gráfico: quem já leu este
    intervalo nesta sessão não o lê de novo.
  */
  const consulta = useQuery({
    ...opcoesDoIntervaloGeral(de, ate),
    enabled: de !== null && ate !== null,
  });

  const [aberta, setAberta] = useState<RangeOverviewPoint | null>(null);
  const [periodicidadeDaAba, setPeriodicidadeDaAba] = useState<string | null>(null);

  const overview = consulta.data ?? null;
  const leitura = useMemo(() => (overview ? lerOverview(overview) : null), [overview]);

  if (consulta.isLoading) {
    return (
      <section className={cn(CARTAO, "p-5")}>
        <p className="text-sm text-muted-foreground">Carregando o histórico consolidado…</p>
      </section>
    );
  }

  if (consulta.error) {
    return (
      <ApiErrorNotice
        error={consulta.error}
        what="Não foi possível montar o histórico consolidado."
      />
    );
  }

  if (!leitura || leitura.linhas.length === 0) {
    return (
      <section className={cn(CARTAO, "p-8 text-center text-sm text-muted-foreground")}>
        Nenhuma unidade tem duas vigências para comparar neste intervalo — a linha do tempo
        compara vigência com vigência.
      </section>
    );
  }

  const { resumo, linhas, periodicidades } = leitura;
  const principal = [...periodicidades].sort(
    (a, b) =>
      Math.abs(resumo.impact.byPeriodicity[b] ?? 0) - Math.abs(resumo.impact.byPeriodicity[a] ?? 0),
  )[0] as string | undefined;
  const periodicidade = periodicidadeDaAba ?? principal ?? periodicidades[0];

  const ranking = rankingDeUnidades(overview, periodicidade ?? null);
  const temLateral = ranking.length > 0 || resumo.impact.notCalculable > 0;

  return (
    <>
      {periodicidade !== undefined && (
        <CartoesDeResumo
          dados={resumo}
          periodicidade={periodicidade}
          avisoDeAtivos="soma simples entre unidades, não deduplicada por placa"
        />
      )}

      <div
        className={cn(
          "grid gap-5 xl:items-start",
          temLateral && "xl:grid-cols-[minmax(0,1fr)_21rem]",
        )}
      >
        <section className={cn(CARTAO, "p-5")}>
          {periodicidades.length === 0 ? (
            <ContagemPorVigencia
              linhas={linhas}
              recorteBase={null}
              onAbrirVigencia={(linha) => setAberta(pontoDe(overview, linha.period))}
            />
          ) : (
            <EvolucaoDasVigencias
              dados={resumo}
              linhas={linhas}
              periodicidades={periodicidades}
              periodicidade={periodicidade as string}
              onPeriodicidade={setPeriodicidadeDaAba}
              recorteBase={null}
              onAbrirVigencia={(linha) => setAberta(pontoDe(overview, linha.period))}
              rotuloDeAbrir="Ver esta vigência unidade a unidade"
            />
          )}
        </section>

        {temLateral && (
          <div className="space-y-4">
            <PendenciasDeValoracao dados={resumo} recorteBase={null} />
            <OndeEstaOImpacto ranking={ranking} />
          </div>
        )}
      </div>

      {periodicidade !== undefined && (
        <Narrativa dados={resumo} periodicidade={periodicidade} linhas={linhas} />
      )}

      {aberta && overview && periodicidade !== undefined && (
        <DetalheDaVigenciaConsolidada
          ponto={aberta}
          overview={overview}
          periodicidade={periodicidade}
          onFechar={() => setAberta(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// A leitura — de `RangeOverview` para o que a linha do tempo desenha
// ---------------------------------------------------------------------------

export interface LeituraConsolidada {
  resumo: ResumoDoIntervalo;
  /** Da mais antiga para a mais recente, como a janela da linha do tempo espera. */
  linhas: RangeMovement[];
  periodicidades: string[];
}

/**
 * O intervalo somado, na forma que os componentes da linha do tempo pedem.
 *
 * Duas somas diferentes, de propósito:
 *
 * - o **placar** (`resumo`) sai de `unitsIncluded`, onde cada unidade já traz
 *   o intervalo inteiro apurado pelo motor, com o índice de composição que
 *   evita dupla contagem dentro dela;
 * - a **evolução** (`linhas`) sai de `serie`, competência a competência.
 *
 * As duas fecham porque a régua é a mesma dos dois lados (`summariseImpact`
 * por comparação), mas nenhuma é derivada da outra: derivar o total da série
 * faria a tela refazer no navegador uma conta que o motor já fez, e é aí que
 * telas passam a discordar do servidor sem ninguém notar.
 *
 * `vehiclesTouched` é soma simples entre unidades, não deduplicada por placa —
 * a mesma ressalva que a Visão Geral já publica no cartão de veículos. Aqui
 * ele só alimenta a linha "em N ativos" do cartão de alterações.
 */
export function lerOverview(overview: RangeOverview): LeituraConsolidada {
  const somar = (registros: Record<string, number>[]): Record<string, number> => {
    const total: Record<string, number> = {};
    for (const registro of registros) {
      for (const [chave, valor] of Object.entries(registro)) {
        total[chave] = Number(((total[chave] ?? 0) + valor).toFixed(2));
      }
    }
    return total;
  };

  const resumo: ResumoDoIntervalo = {
    fromLabel: overview.fromLabel,
    toLabel: overview.toLabel,
    impact: {
      byPeriodicity: somar(overview.unitsIncluded.map((u) => u.impact.byPeriodicity)),
      notCalculable: overview.unitsIncluded.reduce((soma, u) => soma + u.notCalculable, 0),
    },
    gainsByPeriodicity: somar(overview.unitsIncluded.map((u) => u.gainsByPeriodicity)),
    lossesByPeriodicity: somar(overview.unitsIncluded.map((u) => u.lossesByPeriodicity)),
    totals: {
      changes: overview.unitsIncluded.reduce((soma, u) => soma + u.changes, 0),
      vehiclesTouched: overview.unitsIncluded.reduce((soma, u) => soma + u.vehiclesTouched, 0),
    },
    /*
      Vigência sem comparação é um conceito de uma unidade só: no consolidado,
      a mesma competência pode faltar numa unidade e existir noutra, e chamar
      isso de "vigência sem comparação" da soma seria inventar um buraco que
      não existe. Quem ficou de fora do intervalo inteiro está nomeado em
      `unitsExcluded`, que a tela publica acima da linha do tempo.
    */
    gaps: [],
  };

  const linhas: RangeMovement[] = overview.serie.map((ponto) => ({
    period: ponto.period,
    label: ponto.label,
    comparisons: 0,
    changes: ponto.changes,
    // Ativos por competência não vêm somados da série — e não são usados na
    // linha do tempo, que conta alterações e dinheiro.
    vehicles: 0,
    impact: ponto.impact,
  }));

  const periodicidades = [
    ...new Set(linhas.flatMap((l) => Object.keys(l.impact.byPeriodicity))),
  ].sort();

  return { resumo, linhas, periodicidades };
}

function pontoDe(overview: RangeOverview | null, period: string): RangeOverviewPoint | null {
  return overview?.serie.find((p) => p.period === period) ?? null;
}

// ---------------------------------------------------------------------------
// A gaveta — uma competência, unidade a unidade
// ---------------------------------------------------------------------------

/**
 * De quem é o mês.
 *
 * É o passo que a Visão Geral devia a quem clicava numa vigência: a soma sabe
 * quanto a competência pesou, mas não onde — e o endereço das Alterações só
 * existe para uma unidade de cada vez. A gaveta decompõe o número, lista as
 * unidades da que mais moveu para a que menos, e só então oferece o link de
 * cada uma, já com a vigência aplicada.
 *
 * Tudo sai de `overview`, que a tela já tem em memória: nenhuma leitura nova.
 */
function DetalheDaVigenciaConsolidada({
  ponto,
  overview,
  periodicidade,
  onFechar,
}: {
  ponto: RangeOverviewPoint;
  overview: RangeOverview;
  periodicidade: string;
  onFechar: () => void;
}) {
  const contextosDaUnidade = new Map(
    overview.unitsIncluded.map((u) => [u.unidade, u.contexts] as const),
  );
  const valor = ponto.impact.byPeriodicity[periodicidade];
  const negativo = (valor ?? 0) < 0;
  const teto = Math.max(
    ...ponto.porUnidade.map((u) => Math.abs(u.impact.byPeriodicity[periodicidade] ?? 0)),
    1,
  );

  return (
    <Sheet open onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col gap-0">
        <header className="px-7 pt-7 pb-5 border-b shrink-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Vigência consolidada
          </p>
          <SheetTitle className="text-2xl font-extrabold tracking-tight mt-1 pr-8">
            {ponto.label}
          </SheetTitle>

          {valor === undefined ? (
            <p className="text-lg font-bold text-muted-foreground mt-4">Sem valoração</p>
          ) : (
            <p
              className={cn(
                "text-[2rem] font-extrabold tabular-nums leading-none mt-4",
                negativo ? "text-red-700" : "text-emerald-700",
              )}
            >
              {formatBrlShort(valor)}
              <span className="text-base font-semibold text-muted-foreground">
                {periodicitySuffix(periodicidade)}
              </span>
            </p>
          )}

          <SheetDescription className="mt-2.5 max-w-xl leading-snug">
            {contar(ponto.changes, "alteração", "alterações")} nesta competência, somadas entre as
            unidades incluídas — abaixo, de quem é cada parcela.
          </SheetDescription>
        </header>

        <div className="flex-1 overflow-y-auto px-7 py-6 space-y-6">
          <section>
            <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              Por unidade
            </h3>
            <div className="mt-3 space-y-1.5">
              {ponto.porUnidade.map((unidade) => {
                const contextos = contextosDaUnidade.get(unidade.unidade) ?? [];
                const parcela = unidade.impact.byPeriodicity[periodicidade];
                return (
                  <Link
                    key={unidade.unidade}
                    href={linkDeAlteracoes({
                      recorte: {
                        period: ponto.period,
                        scopeHash: contextos[0]?.scopeHash ?? null,
                        canal: contextos[0]?.channel ?? null,
                      },
                    })}
                    aria-label={`Ver as alterações de ${unidade.label} em ${ponto.label}`}
                    title="Ver as alterações desta unidade nesta vigência"
                    className="block rounded px-1.5 py-1 -mx-1.5 hover:bg-accent transition-colors"
                  >
                    <span className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-semibold truncate" title={unidade.label}>
                        {unidade.label}
                      </span>
                      <span
                        className={cn(
                          "text-xs font-bold tabular-nums shrink-0",
                          parcela === undefined
                            ? "text-muted-foreground"
                            : parcela < 0
                              ? "text-red-700"
                              : "text-emerald-700",
                        )}
                      >
                        {parcela === undefined ? "sem valoração" : formatBrlShort(parcela)}
                      </span>
                    </span>
                    <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <span
                        className={cn(
                          "block h-full",
                          (parcela ?? 0) < 0 ? "bg-red-600" : "bg-emerald-600",
                        )}
                        style={{
                          width: `${Math.max(2, (Math.abs(parcela ?? 0) / teto) * 100)}%`,
                        }}
                      />
                    </span>
                    <span className="mt-1 block text-[0.6875rem] text-muted-foreground">
                      {contar(unidade.changes, "alteração", "alterações")}
                      {unidade.impact.notCalculable > 0 &&
                        ` · ${unidade.impact.notCalculable.toLocaleString("pt-BR")} sem valoração`}
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>

          {ponto.impact.notCalculable > 0 && (
            <p className="flex gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3">
              <TriangleAlert className="w-4 h-4 shrink-0 mt-px" />
              <span>
                {contar(ponto.impact.notCalculable, "alteração", "alterações")} desta competência
                ainda sem impacto apurado — não entram na soma acima, e não estão contadas como
                zero.
              </span>
            </p>
          )}

          <p className="flex gap-2 text-xs text-muted-foreground">
            <Layers className="w-4 h-4 shrink-0 mt-px" />
            <span>
              O detalhamento por família e por parâmetro só existe dentro de uma unidade — o link
              de cada linha acima abre as alterações daquela unidade nesta vigência.
            </span>
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
