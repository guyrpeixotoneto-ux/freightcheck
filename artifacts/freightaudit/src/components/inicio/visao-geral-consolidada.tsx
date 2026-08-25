import { FileText, Info, TrendingUp, Truck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { periodicitySuffix } from "@/lib/format";
import { escreverImpacto, maioresImpactos } from "@/lib/visao-geral";
import type {
  FamiliesOverview,
  MotivoExclusaoDaVisaoGeral,
  OverviewUnitExcluded,
  OverviewUnitIncluded,
} from "@/components/inicio/types";

/**
 * O conteúdo da Visão Geral — compartilhado entre todas as telas que oferecem
 * a opção "Visão Geral" no dropdown "Trocar unidade" (Resumo executivo, Linha
 * do Tempo, e as que vierem depois).
 *
 * Nasceu no Resumo executivo e foi extraído para cá quando a Linha do Tempo
 * passou a precisar do mesmo bloco: mesmo `FamiliesOverview`, mesma régua de
 * cobertura, mesmos cartões. Duas cópias da mesma tela são a mesma doença que
 * `lib/contextos.ts` já resolveu do lado do dado — aqui é o lado da tela.
 */

const CARTAO = "bg-card border rounded-xl shadow-sm";

export const MOTIVO_EXCLUSAO_LABEL: Record<MotivoExclusaoDaVisaoGeral, string> = {
  sem_vigencia_na_competencia: "sem vigência nesta competência",
  contextos_sobrepostos_ambiguos:
    "dois ou mais contextos no mesmo canal — não dá para somar com segurança",
  vigencia_indisponivel_na_leitura: "a vigência ficou indisponível durante a leitura",
};

/**
 * Cobertura primeiro, sempre — e os cartões financeiros só quando há ao
 * menos uma unidade consolidada.
 *
 * A v1 não mescla `families`/`groups`/`series`/`movements` entre unidades
 * (ver `getFamiliesOverview` no servidor), então nenhuma gaveta de
 * drill-down abre aqui — só o resumo já somado e a lista de quem entrou e
 * quem ficou fora, com o motivo escrito. `notaExtra` deixa cada tela
 * qualificar o que este resumo cobre (ex.: a Linha do Tempo só soma o
 * último passo comum, não o histórico inteiro).
 */
export function VisaoGeralConteudo({
  overview,
  notaExtra,
}: {
  overview: FamiliesOverview;
  notaExtra?: string;
}) {
  const semConsolidacaoSegura = overview.unitsIncluded.length === 0;
  const impactos = Object.entries(overview.summary.impact.byPeriodicity)
    .map(([periodicity, amount]) => ({ periodicity, amount }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const ranking = maioresImpactos(overview.summary);

  return (
    <>
      <CoberturaDaVisaoGeral overview={overview} />

      {semConsolidacaoSegura ? (
        <div className={cn(CARTAO, "px-6 py-8 text-center")}>
          <p className="text-base font-bold">
            Nenhuma unidade pôde ser consolidada com segurança nesta competência.
          </p>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">
            A competência existe — a lista acima diz quais unidades ficaram de fora e por quê.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-3">
            <CartaoNumero
              icone={TrendingUp}
              titulo="Impacto líquido"
              valor={impactos[0] ? escreverImpacto(impactos[0]) : "—"}
              tom={impactos[0] ? (impactos[0].amount < 0 ? "desfavoravel" : "favoravel") : undefined}
            />
            <CartaoNumero
              icone={FileText}
              titulo="Alterações"
              valor={String(overview.summary.changes)}
            />
            <CartaoNumero
              icone={Truck}
              titulo="Veículos afetados"
              valor={String(overview.summary.vehiclesTouched)}
              nota="soma simples entre unidades, não deduplicada por placa"
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
                Nenhum parâmetro tem impacto apurado nesta consolidação.
              </p>
            ) : (
              <ol className="mt-4 space-y-3">
                {ranking.linhas.map((linha) => (
                  <li key={linha.key} className="flex items-center gap-3">
                    <span
                      className="w-40 shrink-0 min-w-0 text-sm font-semibold truncate"
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
                  </li>
                ))}
              </ol>
            )}
          </section>

          <p className="text-xs text-muted-foreground">
            Detalhamento por família, alterações em destaque e drill-down por parâmetro não
            estão disponíveis na Visão Geral nesta versão — troque para uma unidade específica
            em "Trocar unidade" para ver o detalhe.
            {notaExtra ? ` ${notaExtra}` : ""}
          </p>
        </>
      )}
    </>
  );
}

/** "N de M unidades incluídas", com a lista de quem ficou fora e por quê. */
function CoberturaDaVisaoGeral({ overview }: { overview: FamiliesOverview }) {
  const total = overview.unitsIncluded.length + overview.unitsExcluded.length;
  const parciais = overview.unitsIncluded.filter(
    (u): u is OverviewUnitIncluded & { coberturaParcial: NonNullable<OverviewUnitIncluded["coberturaParcial"]> } =>
      (u.coberturaParcial?.length ?? 0) > 0,
  );

  return (
    <section className={cn(CARTAO, "px-6 py-5")}>
      <div className="flex items-center gap-2">
        <Info className="w-4 h-4 text-muted-foreground shrink-0" />
        <h2 className="text-base font-bold">
          {overview.unitsIncluded.length} de {total} unidades incluídas
        </h2>
      </div>

      {parciais.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-amber-700">
          {parciais.map((u) => (
            <li key={u.unidade}>
              <span className="font-semibold">{u.label}</span>: cobertura parcial — um contexto
              elegível não pôde ser lido, a soma reflete só o que respondeu.
            </li>
          ))}
        </ul>
      )}

      {overview.unitsExcluded.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground font-medium">
            {overview.unitsExcluded.length} unidade(s) fora da soma
          </summary>
          <ul className="mt-2 space-y-1.5">
            {overview.unitsExcluded.map((u: OverviewUnitExcluded) => (
              <li key={u.unidade} className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{u.label}</span> —{" "}
                {MOTIVO_EXCLUSAO_LABEL[u.reason]}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function CartaoNumero({
  icone: Icone,
  titulo,
  valor,
  nota,
  tom,
}: {
  icone: LucideIcon;
  titulo: string;
  valor: string;
  nota?: string;
  tom?: "favoravel" | "desfavoravel";
}) {
  return (
    <div className={cn(CARTAO, "px-5 py-4")}>
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icone className="w-4 h-4" />
        <span className="text-xs font-semibold uppercase tracking-wide">{titulo}</span>
      </div>
      <p
        className={cn(
          "text-2xl font-extrabold mt-2",
          tom === "desfavoravel" && "text-red-700",
          tom === "favoravel" && "text-emerald-700",
        )}
      >
        {valor}
      </p>
      {nota && <p className="text-[0.6875rem] text-muted-foreground mt-1">{nota}</p>}
    </div>
  );
}
