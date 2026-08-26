import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TrechoDoRadar, Veredito } from "@/pages/radar-trechos";

/**
 * O diagnóstico de um trecho — o painel que abre ao clicar "Ver diagnóstico".
 *
 * Mostra só o que o Radar já consolidou (veredito, impacto, cobertura,
 * contribuições) — não recalcula nada e não lista as alterações uma a uma.
 * "Ver todas as alterações" é o único lugar que leva à tabela linha-por-linha,
 * reaproveitando Trecho 360° (`?placa=`), a mesma tela que já existe para
 * isso. Recriar essa tabela aqui dentro duplicaria a fonte da verdade que
 * `docs/ARQUITETURA.md` já centraliza em `lib/comparison`.
 */

const APARENCIA: Record<Veredito, { rotulo: string; emoji: string; badge: "destructive" | "success" | "secondary" | "warning" | "outline" }> = {
  PIOROU: { rotulo: "Piorou", emoji: "🔴", badge: "destructive" },
  MELHOROU: { rotulo: "Melhorou", emoji: "🟢", badge: "success" },
  IGUAL: { rotulo: "Igual", emoji: "⚪", badge: "outline" },
  MISTO: { rotulo: "Misto", emoji: "🟡", badge: "warning" },
  INCONCLUSIVO: { rotulo: "Inconclusivo", emoji: "⚫", badge: "secondary" },
};

function brl(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export function DiagnosticoDoTrecho({
  trecho,
  context,
  aoFechar,
}: {
  trecho: TrechoDoRadar | null;
  context: { scopeHash: string; channel: string | null } | null;
  aoFechar: () => void;
}) {
  if (!trecho) return null;
  const r = trecho.resumo;
  const a = APARENCIA[r.veredito];

  const favoraveis = r.contribuicoes.filter((c) => c.impactoAssinado > 0);
  const desfavoraveis = r.contribuicoes
    .filter((c) => c.impactoAssinado < 0)
    .sort((x, y) => x.impactoAssinado - y.impactoAssinado);

  const linkDasAlteracoes = (() => {
    const params = new URLSearchParams({ placa: trecho.entityLabel ?? "" });
    if (context?.scopeHash) params.set("scopeHash", context.scopeHash);
    if (context?.channel) params.set("canal", context.channel);
    return `/trecho-360?${params}`;
  })();

  return (
    <Sheet open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col gap-0">
        <header className="px-7 pt-7 pb-5 border-b shrink-0">
          <SheetTitle className="text-2xl font-extrabold tracking-tight pr-8">
            {trecho.entityLabel ?? "Trecho sem identificação"}
          </SheetTitle>
          <SheetDescription className="mt-2">
            <Badge variant={a.badge} className="gap-1">
              <span>{a.emoji}</span> {a.rotulo.toUpperCase()}
            </Badge>
          </SheetDescription>
        </header>

        <div className="px-7 py-5 space-y-6 overflow-y-auto flex-1">
          <div>
            <div className="text-sm text-muted-foreground">Impacto conhecido</div>
            <div
              className={cn(
                "text-2xl font-bold tabular-nums",
                r.impactoLiquido === null
                  ? "text-muted-foreground"
                  : r.impactoLiquido < 0
                    ? "text-red-700"
                    : "text-emerald-700",
              )}
            >
              {r.impactoLiquido === null ? "—" : brl(r.impactoLiquido)}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {r.totalAlteracoes} alteração{r.totalAlteracoes === 1 ? "" : "ões"} nesta vigência
            </div>
          </div>

          {desfavoraveis.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-red-700 mb-2">O que fez piorar</h3>
              <ul className="space-y-1.5">
                {desfavoraveis.map((c) => (
                  <li key={c.attributeCode} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{c.attributeName}</span>
                    <span className="text-red-700 tabular-nums font-medium">{brl(c.impactoAssinado)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {favoraveis.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-emerald-700 mb-2">O que compensou</h3>
              <ul className="space-y-1.5">
                {favoraveis.map((c) => (
                  <li key={c.attributeCode} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{c.attributeName}</span>
                    <span className="text-emerald-700 tabular-nums font-medium">
                      +{brl(c.impactoAssinado)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
            <div className="font-medium">Cobertura</div>
            <div className="text-muted-foreground mt-0.5">
              {r.alteracoesClassificadas} de {r.alteracoesMateriais} alterações com interpretação
              conhecida
              {r.confiabilidade !== null && ` (${Math.round(r.confiabilidade * 100)}%)`}
            </div>
            {r.coberturaPorImpacto === null && r.alteracoesMateriais > 0 && (
              <div className="text-xs text-muted-foreground mt-1">
                Cobertura por materialidade não apurável — nenhuma alteração tem impacto em
                reais confirmado; a cobertura acima é por quantidade.
              </div>
            )}
          </div>
        </div>

        <footer className="px-7 py-4 border-t shrink-0">
          <Link
            href={linkDasAlteracoes}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Ver todas as {r.totalAlteracoes} alterações
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </footer>
      </SheetContent>
    </Sheet>
  );
}
