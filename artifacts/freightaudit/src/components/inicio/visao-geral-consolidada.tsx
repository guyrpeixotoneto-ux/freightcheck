import { useState } from "react";
import { ChevronRight, FileText, Info, TrendingUp, Truck, type LucideIcon } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { periodicitySuffix } from "@/lib/format";
import { escreverImpacto, maioresImpactos, type Impacto } from "@/lib/visao-geral";
import { DetalheDaUnidadeNaComparacao } from "@/components/inicio/detalhe-da-unidade-na-comparacao";
import type {
  ExecutiveSummary,
  FamiliesOverview,
  MotivoExclusaoDaVisaoGeral,
  OverviewContextRef,
  OverviewUnitExcluded,
  OverviewUnitIncluded,
} from "@/components/inicio/types";

/**
 * O conteúdo da Visão Geral — compartilhado entre todas as telas que oferecem
 * a opção "Visão Geral" no seletor de unidade da lateral (Resumo executivo,
 * Linha do Tempo, e as que vierem depois).
 *
 * Nasceu no Resumo executivo e foi extraído para cá quando a Linha do Tempo
 * passou a precisar do mesmo bloco: mesmo `FamiliesOverview`, mesma régua de
 * cobertura, mesmos cartões. Duas cópias da mesma tela são a mesma doença que
 * `lib/contextos.ts` já resolveu do lado do dado — aqui é o lado da tela.
 */

const CARTAO = "bg-card border rounded-xl shadow-sm";

/** O maior movimento em módulo entre as periodicidades de um resumo — mesmo critério do cartão "Impacto líquido". */
export function impactoDominante(summary: ExecutiveSummary): Impacto | null {
  const impactos = Object.entries(summary.impact.byPeriodicity)
    .map(([periodicity, amount]) => ({ periodicity, amount }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return impactos[0] ?? null;
}

/**
 * As unidades incluídas, ranqueadas pelo mesmo critério do pódio da Visão
 * Geral — maior módulo de impacto primeiro.
 *
 * Extraída de `ComparacaoPorUnidade` para que a Gestão à Vista monte "Unidades
 * que exigem atenção" com a mesma conta, em vez de reordenar por conta própria.
 */
export function unidadesPorImpacto(
  overview: FamiliesOverview,
): { unidade: OverviewUnitIncluded; impacto: Impacto | null }[] {
  return overview.unitsIncluded
    .map((u) => ({ unidade: u, impacto: impactoDominante(u.summary) }))
    .sort((a, b) => Math.abs(b.impacto?.amount ?? 0) - Math.abs(a.impacto?.amount ?? 0));
}

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
 * drill-down por parâmetro abre aqui direto sobre o total somado. O que os
 * cartões abrem é a **comparação por unidade** (`ComparacaoPorUnidade`
 * abaixo): cada unidade já traz o seu próprio resumo executivo
 * (`OverviewUnitIncluded.summary`), então dá para ranquear unidade contra
 * unidade e, dali, entrar na tela de uma unidade específica — a mesma
 * experiência de clique que a Visão Geral não tinha antes, só que em duas
 * etapas em vez de uma, porque o total somado não sabe de onde cada
 * parcela veio. `notaExtra` deixa cada tela qualificar o que este resumo
 * cobre (ex.: a Linha do Tempo só soma o último passo comum, não o
 * histórico inteiro).
 */
export function VisaoGeralConteudo({
  overview,
  search,
  onTrocar,
  notaExtra,
}: {
  overview: FamiliesOverview;
  search: string;
  onTrocar: (mudancas: Record<string, string | null>) => void;
  notaExtra?: string;
}) {
  const semConsolidacaoSegura = overview.unitsIncluded.length === 0;
  const impactos = Object.entries(overview.summary.impact.byPeriodicity)
    .map(([periodicity, amount]) => ({ periodicity, amount }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const ranking = maioresImpactos(overview.summary);

  const comparando = new URLSearchParams(search).get("compararUnidades") === "1";
  const abrirComparacao = () => onTrocar({ compararUnidades: "1" });

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
              onClick={abrirComparacao}
            />
            <CartaoNumero
              icone={FileText}
              titulo="Alterações"
              valor={String(overview.summary.changes)}
              onClick={abrirComparacao}
            />
            <CartaoNumero
              icone={Truck}
              titulo="Veículos afetados"
              valor={String(overview.summary.vehiclesTouched)}
              nota="soma simples entre unidades, não deduplicada por placa"
              onClick={abrirComparacao}
            />
          </div>

          <button
            type="button"
            onClick={abrirComparacao}
            className={cn(CARTAO, "px-6 py-5 w-full text-left hover:bg-muted/40 transition-colors")}
          >
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold">Maiores impactos</h2>
              {ranking && (
                <span className="text-xs font-semibold text-muted-foreground">
                  em R${periodicitySuffix(ranking.periodicity)}
                </span>
              )}
              <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto" />
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
          </button>

          <p className="text-xs text-muted-foreground">
            Clique em qualquer cartão acima para comparar unidade a unidade e entrar no
            detalhe de uma delas — o detalhamento por família e o drill-down por parâmetro
            só existem dentro de uma unidade específica, nunca somados entre unidades.
            {notaExtra ? ` ${notaExtra}` : ""}
          </p>
        </>
      )}

      {comparando && (
        <ComparacaoPorUnidade
          overview={overview}
          onFechar={() => onTrocar({ compararUnidades: null })}
        />
      )}
    </>
  );
}

/**
 * A etapa intermediária entre o total somado e o detalhe de uma unidade.
 *
 * Ranqueia as unidades incluídas pelo mesmo critério do pódio da Visão
 * Geral — maior módulo de impacto primeiro —, mostra os três números que
 * também aparecem lá em cima, mas agora um por unidade, e cada linha abre o
 * resumo executivo daquela unidade sozinha **empilhado por cima desta
 * gaveta** (`DetalheDaUnidadeNaComparacao`), em vez de navegar para fora —
 * fechar o detalhe da unidade volta para a comparação, e fechar a
 * comparação continua fechando as duas de uma vez.
 */
function ComparacaoPorUnidade({
  overview,
  onFechar,
}: {
  overview: FamiliesOverview;
  onFechar: () => void;
}) {
  const unidades = unidadesPorImpacto(overview);
  const [unidadeAberta, setUnidadeAberta] = useState<{
    contexto: OverviewContextRef;
    label: string;
  } | null>(null);

  return (
    <Sheet open onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col gap-0">
        <header className="px-7 pt-7 pb-5 border-b shrink-0">
          <SheetTitle className="text-2xl font-extrabold tracking-tight">
            Comparação por unidade
          </SheetTitle>
          <SheetDescription className="mt-2 max-w-xl leading-snug">
            {unidades.length} unidade{unidades.length === 1 ? "" : "s"} entrou{unidades.length === 1 ? "" : "ram"} na
            soma desta competência. Clique numa delas para abrir o detalhe — famílias,
            alterações em destaque e o drill-down por parâmetro que a soma de todas juntas
            não tem como oferecer.
          </SheetDescription>
        </header>

        <div className="flex-1 overflow-y-auto px-7 py-6 space-y-2.5">
          {unidades.map(({ unidade, impacto }) => (
            <LinhaDaUnidade
              key={unidade.unidade}
              unidade={unidade}
              impacto={impacto}
              onEntrar={(contexto) => setUnidadeAberta({ contexto, label: unidade.label })}
            />
          ))}
        </div>
      </SheetContent>

      {unidadeAberta && (
        <DetalheDaUnidadeNaComparacao
          contexto={unidadeAberta.contexto}
          label={unidadeAberta.label}
          period={overview.period}
          onFechar={() => setUnidadeAberta(null)}
        />
      )}
    </Sheet>
  );
}

/**
 * Uma linha da comparação. A maioria das unidades tem um contexto só — a
 * linha inteira é o link. Quando há mais de um (dois canais, por exemplo),
 * o nome da unidade não navega sozinho: cada contexto ganha o seu próprio
 * botão, porque "entrar na unidade" sem dizer qual canal seria adivinhar.
 */
function LinhaDaUnidade({
  unidade,
  impacto,
  onEntrar,
}: {
  unidade: OverviewUnitIncluded;
  impacto: Impacto | null;
  onEntrar: (contexto: OverviewContextRef) => void;
}) {
  const numeros = (
    <div className="flex items-center gap-5 shrink-0 tabular-nums text-sm">
      <span
        className={cn(
          "font-bold w-32 text-right",
          impacto === null
            ? "text-muted-foreground font-normal"
            : impacto.amount < 0
              ? "text-red-700"
              : "text-emerald-700",
        )}
      >
        {impacto ? escreverImpacto(impacto) : "—"}
      </span>
      <span className="text-muted-foreground w-24 text-right">
        {unidade.summary.changes} alt.
      </span>
      <span className="text-muted-foreground w-24 text-right">
        {unidade.summary.vehiclesTouched} veíc.
      </span>
    </div>
  );

  if (unidade.contexts.length === 1) {
    return (
      <button
        type="button"
        onClick={() => onEntrar(unidade.contexts[0])}
        className={cn(CARTAO, "w-full px-4 py-3 flex items-center gap-4 text-left hover:bg-muted/40 transition-colors")}
      >
        <span className="font-semibold text-sm min-w-0 flex-1 truncate" title={unidade.label}>
          {unidade.label}
        </span>
        {numeros}
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>
    );
  }

  return (
    <div className={cn(CARTAO, "px-4 py-3")}>
      <div className="flex items-center gap-4">
        <span className="font-semibold text-sm min-w-0 flex-1 truncate" title={unidade.label}>
          {unidade.label}
        </span>
        {numeros}
      </div>
      <ul className="mt-2.5 space-y-1.5">
        {unidade.contexts.map((contexto) => (
          <li key={`${contexto.scopeHash}|${contexto.channel ?? ""}`}>
            <button
              type="button"
              onClick={() => onEntrar(contexto)}
              className="w-full flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
            >
              <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              {contexto.channel ?? "sem canal no rótulo"}
            </button>
          </li>
        ))}
      </ul>
    </div>
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
  onClick,
}: {
  icone: LucideIcon;
  titulo: string;
  valor: string;
  nota?: string;
  tom?: "favoravel" | "desfavoravel";
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(CARTAO, "px-5 py-4 text-left hover:bg-muted/40 transition-colors")}
    >
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
    </button>
  );
}
