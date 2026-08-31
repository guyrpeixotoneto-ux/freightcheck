import { Link } from "wouter";
import { ChevronRight, CircleAlert, FileWarning, Gauge, Layers, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AcaoAgora } from "@/lib/impacto-apurado";
import type { Tom } from "@/lib/visao-geral";

/**
 * Onde agir agora — a leitura virando gestão.
 *
 * Nenhum item nasce aqui: todos vêm de `ondeAgirAgora`
 * (`lib/impacto-apurado.ts`), onde cada um está amarrado a um campo do
 * contrato. Um alerta que a tela inventa é um alerta que ninguém pode
 * conferir, e que todo mundo aprende a ignorar.
 *
 * O bloco some quando não há nada a fazer, em vez de mostrar "tudo certo" —
 * um cartão vazio ocupa o lugar de uma resposta.
 */

const ICONE: Record<string, typeof TriangleAlert> = {
  "sem-preco": FileWarning,
  cobertura: Gauge,
  "perdas-para-auditar": TriangleAlert,
  "familias-criticas": Layers,
  "sem-baseline": CircleAlert,
};

const TOM: Record<Tom, string> = {
  grave: "text-red-700 bg-red-50",
  atencao: "text-amber-700 bg-amber-50",
  ok: "text-emerald-700 bg-emerald-50",
};

export function OndeAgirAgora({ acoes, nota }: { acoes: AcaoAgora[]; nota?: string }) {
  return (
    <section className="bg-card border rounded-xl shadow-sm px-6 py-5" aria-label="Onde agir agora">
      <h2 className="text-base font-bold">Onde agir agora</h2>
      <p className="text-xs text-muted-foreground mt-0.5">
        Oportunidades e riscos que exigem atenção
      </p>

      {acoes.length === 0 ? (
        <p className="text-sm text-muted-foreground py-10 text-center">
          Nada nesta vigência exige ação: toda alteração tem preço apurado e nenhuma perda foi
          marcada como crítica.
        </p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {acoes.map((acao) => (
            <li key={acao.chave}>
              <Item acao={acao} />
            </li>
          ))}
        </ul>
      )}

      {nota && <p className="text-xs text-muted-foreground mt-4">{nota}</p>}
    </section>
  );
}

function Item({ acao }: { acao: AcaoAgora }) {
  const Icone = ICONE[acao.chave] ?? CircleAlert;
  const corpo = (
    <>
      <span className={cn("rounded-lg p-2 shrink-0", TOM[acao.tom])}>
        <Icone className="w-4 h-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-snug">{acao.titulo}</span>
        <span className="block text-xs text-muted-foreground mt-0.5 leading-snug">
          {acao.detalhe}
        </span>
      </span>
      {acao.href && <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
    </>
  );

  return acao.href ? (
    <Link
      href={acao.href}
      className="flex items-start gap-3 rounded-lg border px-3 py-3 hover:bg-accent/60 transition-colors"
    >
      {corpo}
    </Link>
  ) : (
    <div className="flex items-start gap-3 rounded-lg border px-3 py-3">{corpo}</div>
  );
}
