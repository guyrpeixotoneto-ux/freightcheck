import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch, useLocation } from "wouter";
import { AlertTriangle, ChevronDown, ChevronRight, Info, Lock } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ContextBar, type ContextSelection } from "@/components/contexto/context-bar";
import { GroupCard } from "@/components/inicio/group-card";
import { getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatBrlShort, impactEntries, periodicitySuffix } from "@/lib/format";
import type {
  FamiliesView,
  FamilyView,
  ImpactSummary,
  ParameterView,
} from "@/components/inicio/types";

/**
 * Parâmetros — a vigência lida como no Freightech.
 *
 * A tela existe para uma frase: *"eu sei onde estou e reconheço essas
 * informações"*. As famílias e os nomes vêm do vocabulário que o usuário já
 * aprendeu — Frota, Combustível, Pneu, Manutenção Cavalo — e o que cada um
 * carrega é o que o Freightech nunca mostra: **o que mudou, quanto vale, e o
 * que ainda não dá para afirmar.**
 *
 * Três recusas herdadas, e nenhuma delas afrouxa aqui:
 *
 * 1. **Nunca um número só somando periodicidades.** R$/mês e R$/ano aparecem em
 *    linhas próprias, sempre.
 * 2. **Nunca uma família vazia.** O que o Freightech publica e este export não
 *    traz está no rodapé, escrito — não como cartão que promete um assunto que
 *    o produto não cobre.
 * 3. **Nunca "impacto a verificar".** Quando não dá para calcular, o motivo é
 *    dito com as palavras que o motor já usa.
 *
 * E uma diferença deliberada em relação ao Freightech: **não há botão Filtrar**,
 * e o parâmetro abre no lugar em vez de virar outra página. Familiaridade é de
 * vocabulário e de hierarquia; o número de cliques não precisa ser herdado.
 */

export default function Parametros() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);

  const query = new URLSearchParams();
  for (const key of ["period", "scopeHash", "canal"]) {
    const value = params.get(key);
    if (value !== null) query.set(key, value);
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ["families", query.toString()],
    queryFn: async () => {
      const suffix = query.toString() ? `?${query}` : "";
      const response = await fetch(getApiUrl(`/changes/families${suffix}`));
      if (!response.ok) throw new Error((await response.json()).error ?? "Falha ao carregar");
      return (await response.json()) as FamiliesView;
    },
  });

  /** A seleção vive na URL: o endereço volta ao mesmo lugar e pode ser enviado. */
  const applySelection = (selection: ContextSelection) => {
    const next = new URLSearchParams(search);
    if (selection.scopeHash !== undefined) next.set("scopeHash", selection.scopeHash);
    if (selection.canal !== undefined) {
      if (selection.canal === null) next.delete("canal");
      else next.set("canal", selection.canal);
    }
    // Trocar de unidade ou de canal invalida a vigência escolhida: a data da
    // outra unidade pode nem existir aqui, e insistir nela devolveria vazio.
    if (selection.period !== undefined) next.set("period", selection.period);
    else if (selection.scopeHash !== undefined || selection.canal !== undefined)
      next.delete("period");
    navigate(`/parametros?${next}`);
  };

  return (
    <Layout>
      {data && <ContextBar view={data} onChange={applySelection} />}

      <div className="p-8 space-y-8 max-w-6xl">
        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
            {(error as Error).message}
          </div>
        )}

        {data && (
          <>
            <Resumo view={data} />

            {!data.complete && (
              <div className="flex gap-3 rounded-md border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <p>
                  <strong>Visão parcial.</strong> Nesta vigência chegou apenas{" "}
                  {data.series.map((s) => s.equipment.toLowerCase()).join(", ")}. Falta{" "}
                  <strong>{data.missingSeries.join(", ").toLowerCase()}</strong> — a série
                  ausente não está contada como zero.
                </p>
              </div>
            )}

            <section className="space-y-4">
              {data.families.map((family) => (
                <Familia key={family.code} family={family} period={data.period} />
              ))}
            </section>

            <Rodape view={data} />
          </>
        )}
      </div>
    </Layout>
  );
}

/**
 * O resumo executivo.
 *
 * Perdas e ganhos separados **dentro de cada periodicidade**, porque somar um
 * ganho mensal a uma perda anual produziria um líquido que não descreve nem uma
 * coisa nem outra.
 */
function Resumo({ view }: { view: FamiliesView }) {
  const { summary } = view;
  const liquido = impactEntries(summary.impact.byPeriodicity);
  const excluido = impactEntries(summary.impact.excludedByPeriodicity);

  return (
    <section className="rounded-lg border bg-card px-6 py-5 space-y-5">
      <p className="text-lg">
        {summary.changes === 0 ? (
          <>O cliente não mexeu em nada nesta vigência.</>
        ) : (
          <>
            O cliente mexeu em <strong>{summary.groups}</strong>{" "}
            {summary.groups === 1 ? "ponto" : "pontos"} da sua remuneração, em{" "}
            <strong>{view.families.filter((f) => f.changes > 0).length}</strong>{" "}
            {view.families.filter((f) => f.changes > 0).length === 1 ? "família" : "famílias"}.
          </>
        )}
      </p>

      {liquido.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Bloco titulo="Impacto líquido">
            {liquido.map((e) => (
              <Valor key={e.periodicity} amount={e.amount} periodicity={e.periodicity} />
            ))}
          </Bloco>
          <Bloco titulo="Perdas">
            {Object.entries(summary.lossesByPeriodicity).length === 0 ? (
              <span className="text-sm text-muted-foreground">nenhuma apurada</span>
            ) : (
              Object.entries(summary.lossesByPeriodicity).map(([p, amount]) => (
                <Valor key={p} amount={amount} periodicity={p} />
              ))
            )}
          </Bloco>
          <Bloco titulo="Ganhos">
            {Object.entries(summary.gainsByPeriodicity).length === 0 ? (
              <span className="text-sm text-muted-foreground">nenhum apurado</span>
            ) : (
              Object.entries(summary.gainsByPeriodicity).map(([p, amount]) => (
                <Valor key={p} amount={amount} periodicity={p} />
              ))
            )}
          </Bloco>
        </div>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
        <span>
          <strong className="text-foreground">{summary.changes}</strong> alterações
        </span>
        <span>
          <strong className="text-foreground">{summary.critical}</strong> críticas
        </span>
        <span>
          <strong className="text-foreground">{summary.locked}</strong> com preço travado
        </span>
        <span>
          <strong className="text-foreground">{summary.notCalculable}</strong> sem preço
        </span>
        <span>
          <strong className="text-foreground">{summary.vehiclesTouched}</strong> veículos
          tocados
        </span>
      </div>

      {excluido.length > 0 && (
        <p className="text-xs text-muted-foreground flex gap-2">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            {excluido.map((e) => e.label).join(" · ")} ficaram fora do líquido por já
            estarem contados nas parcelas — {summary.impact.excludedChanges}{" "}
            {summary.impact.excludedChanges === 1 ? "alteração" : "alterações"}.
          </span>
        </p>
      )}

      {(summary.topParameters.length > 0 || summary.topVehicles.length > 0) && (
        <div className="grid gap-6 sm:grid-cols-2 pt-1">
          <Ranking
            titulo="Parâmetros mais impactados"
            itens={summary.topParameters.map((p) => ({
              nome: `${p.familyName} › ${p.name}`,
              detalhe: `${p.changes} ${p.changes === 1 ? "alteração" : "alterações"}`,
              byPeriodicity: p.byPeriodicity,
            }))}
          />
          <Ranking
            titulo="Veículos mais impactados"
            itens={summary.topVehicles.map((v) => ({
              nome: v.plate,
              detalhe: `${v.changes} ${v.changes === 1 ? "alteração" : "alterações"}`,
              byPeriodicity: v.byPeriodicity,
            }))}
          />
        </div>
      )}
    </section>
  );
}

/**
 * O impacto de uma família ou de um parâmetro, dito pelo motivo certo.
 *
 * Três estados diferentes que um "sem número" pode ter, e confundi-los seria
 * mentir com a melhor das intenções:
 *
 * - **tem impacto** → os valores, um por periodicidade;
 * - **já contado nas parcelas** → `carreta.custo_fixo` mudou R$ 16.594,54/mês em
 *   agosto/2026 e ficou **fora** da soma porque `finame` e `lucroFixo` também
 *   mudaram nos mesmos ativos. O valor existe e é calculável; escrever
 *   "impacto não calculável" aqui seria falso, e escrever o valor de novo
 *   inflaria o total em 71%, que é o defeito que originou essa exclusão;
 * - **não calculável** → aí sim, e o cartão de dentro traz o motivo por escrito.
 */
function ImpactoResumido({
  impact,
  className,
}: {
  impact: ImpactSummary;
  className?: string;
}) {
  const entries = impactEntries(impact.byPeriodicity);
  if (entries.length > 0) {
    return (
      <>
        {entries.map((e) => (
          <span
            key={e.periodicity}
            className={cn(
              "font-semibold tabular-nums",
              e.amount < 0 ? "text-red-700" : "text-emerald-700",
              className,
            )}
          >
            {e.label}
          </span>
        ))}
      </>
    );
  }

  const excluded = impactEntries(impact.excludedByPeriodicity);
  if (excluded.length > 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {excluded.map((e) => e.label).join(" · ")} — já contado nas parcelas
      </span>
    );
  }

  if (impact.notCalculable > 0) {
    return <span className="text-xs text-muted-foreground">Impacto não calculável</span>;
  }
  return <span className="text-xs text-muted-foreground">Sem impacto apurado</span>;
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Valor({ amount, periodicity }: { amount: number; periodicity: string }) {
  return (
    <div
      className={cn(
        "text-xl font-semibold tabular-nums",
        amount < 0 ? "text-red-700" : amount > 0 ? "text-emerald-700" : "",
      )}
    >
      {formatBrlShort(amount)}
      <span className="text-sm font-normal text-muted-foreground">
        {periodicitySuffix(periodicity)}
      </span>
    </div>
  );
}

/**
 * Um ranking por periodicidade.
 *
 * A ordem usa o maior valor absoluto **numa só** periodicidade — somar mês com
 * ano para ordenar daria uma posição que nenhuma das duas grandezas justifica.
 */
function Ranking({
  titulo,
  itens,
}: {
  titulo: string;
  itens: { nome: string; detalhe: string; byPeriodicity: Record<string, number> }[];
}) {
  if (itens.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</div>
      <ul className="space-y-1.5">
        {itens.map((item) => (
          <li key={item.nome} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0">
              <span className="truncate">{item.nome}</span>
              <span className="text-xs text-muted-foreground ml-2">{item.detalhe}</span>
            </span>
            <span className="tabular-nums shrink-0 text-right">
              {impactEntries(item.byPeriodicity).map((e) => (
                <span
                  key={e.periodicity}
                  className={cn("block", e.amount < 0 ? "text-red-700" : "text-emerald-700")}
                >
                  {e.label}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Familia({ family, period }: { family: FamilyView; period: string }) {
  const [open, setOpen] = useState(family.changes > 0);

  return (
    <div className="rounded-lg border bg-card">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left px-5 py-4 flex gap-4 items-start hover:bg-muted/40 rounded-lg"
      >
        <span className="mt-1 text-muted-foreground shrink-0">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="font-semibold uppercase tracking-wide text-sm">{family.name}</h2>
            {/*
              De onde o nome veio. É o ponto da tela inteira: o que é vocabulário
              do Freightech aparece como tal, e o que é nosso não se disfarça.
            */}
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground border rounded-full px-1.5 py-0.5">
              {family.origin === "FREIGHTECH" ? "Freightech" : "FreightCheck"}
            </span>
          </div>

          <p className="text-sm text-muted-foreground mt-1">
            {family.changes === 0 ? (
              "Sem alterações nesta vigência."
            ) : (
              <>
                {family.parametersChanged} de {family.parametersWithData}{" "}
                {family.parametersWithData === 1 ? "parâmetro" : "parâmetros"} ·{" "}
                {family.changes} {family.changes === 1 ? "alteração" : "alterações"} ·{" "}
                {family.vehicles} {family.vehicles === 1 ? "veículo" : "veículos"}
              </>
            )}
          </p>

          {family.changes > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm">
              <ImpactoResumido impact={family.impact} />
              {family.locked > 0 && (
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  {family.locked} com preço travado
                </span>
              )}
              {family.impact.notCalculable > 0 && (
                <span className="text-xs text-muted-foreground">
                  {family.impact.notCalculable} sem preço
                </span>
              )}
            </div>
          )}
        </div>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-3 border-t pt-4">
          <p className="text-xs text-muted-foreground">{family.note}</p>
          {family.parameters.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum parâmetro desta família mudou nesta vigência.
            </p>
          ) : (
            family.parameters.map((parameter) => (
              <Parametro key={parameter.key} parameter={parameter} period={period} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Parametro({ parameter, period }: { parameter: ParameterView; period: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-md border bg-background">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left px-4 py-3 flex gap-3 items-start hover:bg-muted/40 rounded-md"
      >
        <span className="mt-0.5 text-muted-foreground shrink-0">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-medium">{parameter.name}</span>
            <span className="text-xs text-muted-foreground">
              {parameter.changes} {parameter.changes === 1 ? "alteração" : "alterações"} ·{" "}
              {parameter.vehicles} {parameter.vehicles === 1 ? "veículo" : "veículos"}
            </span>
          </div>
          {parameter.pending && (
            <p className="text-xs text-amber-800 mt-1 flex gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
              {parameter.pending}
            </p>
          )}
        </div>
        <span className="shrink-0 text-right text-sm max-w-56">
          <ImpactoResumido impact={parameter.impact} className="block" />
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {parameter.groups.map((group) => (
            <GroupCard key={group.key} group={group} period={period} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * O que o Freightech publica e este export não traz.
 *
 * Fica no rodapé, escrito, em vez de virar 25 cartões vazios. Responde "onde
 * está o resto?" sem simular uma cobertura que o produto não tem.
 */
function Rodape({ view }: { view: FamiliesView }) {
  if (view.freightechSemDado.length === 0) return null;
  return (
    <footer className="border-t pt-5 text-sm text-muted-foreground space-y-2">
      <p>
        O Freightech também publica{" "}
        <strong>{view.freightechSemDado.map((f) => f.family).join(", ")}</strong>. Esses
        parâmetros não vêm no export de equipamento que o FreightCheck recebe hoje, e por
        isso não aparecem acima — um cartão vazio prometeria um assunto que este produto
        ainda não pode auditar.
      </p>
      <details>
        <summary className="cursor-pointer text-xs hover:text-foreground">
          ver a lista completa
        </summary>
        <ul className="mt-2 space-y-1 text-xs">
          {view.freightechSemDado.map((f) => (
            <li key={f.family}>
              <strong>{f.family}:</strong> {f.parameters.join(" · ")}
            </li>
          ))}
        </ul>
      </details>
    </footer>
  );
}
