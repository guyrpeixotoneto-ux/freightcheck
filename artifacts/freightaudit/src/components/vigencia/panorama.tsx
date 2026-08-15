import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import type { CockpitView, Severity } from "@/components/inicio/types";
import type { FiltroCockpit } from "@/lib/cockpit";

/**
 * O panorama — a composição do risco, em quatro leituras.
 *
 * Fica entre o resumo e a fila porque responde a pergunta que nasce depois do
 * "quanto" e antes do "por onde começo": *de que tipo é este risco*. Quatro
 * recortes, e cada um deles é uma **partição de coisas diferentes** — por isso
 * a unidade vai escrita no pé de cada cartão:
 *
 * - **criticidade** conta pontos (grupos);
 * - **natureza do sinal** conta pontos, com o selo que o motor já atribuía;
 * - **frota** conta alterações, porque é assim que cavalo e carreta se comparam
 *   sem que uma frota maior pareça um problema maior;
 * - **impacto** conta alterações, e mantém separadas as três situações que a
 *   tela antiga fundia: apurado, fora do total por dupla contagem, e sem preço.
 *
 * Cada linha é um filtro da lista de baixo. Clicar não esconde nada do
 * panorama: só recorta a fila, e o recorte aparece escrito lá.
 */
export function Panorama({
  cockpit,
  filtro,
  aoFiltrar,
}: {
  cockpit: CockpitView;
  filtro: FiltroCockpit;
  aoFiltrar: (mudanca: Partial<FiltroCockpit>) => void;
}) {
  const { panorama } = cockpit;
  const totalPontos = cockpit.kpis.parameters;
  const totalAlteracoes = cockpit.kpis.changes;
  const pricing = panorama.pricing;

  const impacto = Object.entries(cockpit.kpis.impact.byPeriodicity).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  const rodapePontos = `${totalPontos.toLocaleString("pt-BR")} ${
    totalPontos === 1 ? "ponto no total" : "pontos no total"
  }`;
  const rodapeAlteracoes = `${totalAlteracoes.toLocaleString("pt-BR")} ${
    totalAlteracoes === 1 ? "alteração no total" : "alterações no total"
  }`;

  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Bloco titulo="Por criticidade" rodape={rodapePontos}>
        {panorama.bySeverity.map((b) => (
          <Linha
            key={b.severity}
            rotulo={b.label}
            valor={b.groups}
            total={totalPontos}
            cor={COR_SEVERIDADE[b.severity]}
            ativo={filtro.severidade === b.severity}
            titulo={`${b.changes.toLocaleString("pt-BR")} alterações`}
            aoClicar={
              b.groups === 0
                ? undefined
                : () =>
                    aoFiltrar({
                      severidade: filtro.severidade === b.severity ? null : b.severity,
                    })
            }
          />
        ))}
      </Bloco>

      <Bloco titulo="Natureza do sinal" rodape={rodapePontos}>
        {panorama.byBadge.map((b) => (
          <Linha
            key={b.badge}
            rotulo={b.label}
            valor={b.groups}
            total={totalPontos}
            cor={COR_SELO[b.badge] ?? "bg-zinc-400"}
            ativo={filtro.selo === b.badge}
            titulo={`${b.changes.toLocaleString("pt-BR")} alterações`}
            aoClicar={() => aoFiltrar({ selo: filtro.selo === b.badge ? null : b.badge })}
          />
        ))}
      </Bloco>

      <Bloco titulo="Por frota" rodape={rodapeAlteracoes}>
        {panorama.byEquipment.map((b) => (
          <Linha
            key={b.entityType ?? "sem"}
            rotulo={b.equipment}
            valor={b.changes}
            total={totalAlteracoes}
            cor="bg-sky-600"
            ativo={filtro.equipamento === b.entityType}
            titulo={
              b.fleet === null
                ? `${b.groups} pontos`
                : `${b.groups} pontos · frota de ${b.fleet}`
            }
            aoClicar={
              b.entityType === null
                ? undefined
                : () =>
                    aoFiltrar({
                      equipamento: filtro.equipamento === b.entityType ? null : b.entityType,
                    })
            }
          />
        ))}
      </Bloco>

      {/*
        O rodapé deste bloco é o único que não conta: quando não há preço, ele
        diz isso com todas as letras, e o motivo — que é a pergunta seguinte de
        quem lê "sem preço: 244" — fica no ícone, sem ocupar a coluna inteira.
      */}
      <Bloco
        titulo="Impacto financeiro"
        rodape={
          impacto.length === 0
            ? "Impacto não calculado"
            : impacto
                .map(([p, valor]) => `${formatBrlShort(valor)}${periodicitySuffix(p)}`)
                .join(" · ")
        }
        nota={pricing.reasons.length > 0 ? motivoDoPreco(pricing.reasons) : undefined}
      >
        <Linha
          rotulo="Com valor apurado"
          valor={pricing.calculatedChanges}
          total={totalAlteracoes}
          cor="bg-emerald-600"
          ativo={filtro.foco === "IMPACTO"}
          aoClicar={
            pricing.calculatedChanges === 0
              ? undefined
              : () => aoFiltrar({ foco: filtro.foco === "IMPACTO" ? "TODOS" : "IMPACTO" })
          }
        />
        <Linha
          rotulo="Fora do total (parcelas)"
          valor={pricing.excludedChanges}
          total={totalAlteracoes}
          cor="bg-violet-500"
          titulo="Já contadas dentro de outro parâmetro"
        />
        <Linha
          rotulo="Sem preço"
          valor={pricing.notCalculableChanges}
          total={totalAlteracoes}
          cor="bg-zinc-400"
          ativo={filtro.foco === "SEM_PRECO"}
          aoClicar={
            pricing.notCalculableChanges === 0
              ? undefined
              : () => aoFiltrar({ foco: filtro.foco === "SEM_PRECO" ? "TODOS" : "SEM_PRECO" })
          }
        />
      </Bloco>
    </section>
  );
}

function motivoDoPreco(reasons: { reason: string; groups: number; changes: number }[]): string {
  const extras =
    reasons.length > 1
      ? ` (+${reasons.length - 1} ${reasons.length === 2 ? "outro motivo" : "outros motivos"})`
      : "";
  return `Por que falta preço: ${reasons[0].reason}${extras}`;
}

const COR_SEVERIDADE: Record<Severity, string> = {
  CRITICO: "bg-red-700",
  ALTO: "bg-amber-500",
  MEDIO: "bg-sky-600",
  BAIXO: "bg-zinc-400",
};

const COR_SELO: Record<string, string> = {
  DINHEIRO: "bg-emerald-600",
  RUPTURA: "bg-red-700",
  COBERTURA: "bg-sky-600",
  MOVIMENTO: "bg-violet-500",
  TRAVADO: "bg-zinc-500",
  FORMATO: "bg-slate-400",
  SEM_SINAL: "bg-zinc-300",
};

function Bloco({
  titulo,
  rodape,
  nota,
  children,
}: {
  titulo: string;
  rodape: string;
  /** O que o ícone do rodapé conta quando alguém para o cursor nele. */
  nota?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border rounded-xl shadow-sm px-4 py-4 flex flex-col">
      <h3 className="text-[0.9375rem] font-bold mb-3">{titulo}</h3>
      <div className="space-y-2.5 flex-1">{children}</div>
      <p className="text-[0.6875rem] text-muted-foreground mt-3 pt-2.5 border-t flex items-center gap-1">
        {rodape}
        {nota && (
          <span title={nota} className="inline-flex cursor-help">
            <Info className="w-3 h-3" />
            <span className="sr-only">{nota}</span>
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * Uma linha do panorama: rótulo, contagem e barra proporcional.
 *
 * A barra é proporcional ao total do bloco, e nunca a um máximo local — uma
 * barra cheia porque é a maior de três valores pequenos faria "3 de 244" ocupar
 * a mesma largura que "221 de 244".
 */
function Linha({
  rotulo,
  valor,
  total,
  cor,
  titulo,
  ativo,
  aoClicar,
}: {
  rotulo: string;
  valor: number;
  total: number;
  cor: string;
  titulo?: string;
  ativo?: boolean;
  aoClicar?: () => void;
}) {
  const fatia = total > 0 ? (valor / total) * 100 : 0;
  const conteudo = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={cn(
            "text-[0.8125rem] truncate",
            valor === 0 ? "text-muted-foreground" : "font-medium",
          )}
        >
          {rotulo}
        </span>
        <span className="text-[0.8125rem] font-bold tabular-nums shrink-0">
          {valor.toLocaleString("pt-BR")}
        </span>
      </div>
      <div className="h-[3px] bg-muted rounded-full mt-1.5 overflow-hidden">
        <div className={cn("h-full rounded-full", cor)} style={{ width: `${fatia}%` }} />
      </div>
    </>
  );

  if (!aoClicar) {
    return (
      <div className="px-1" title={titulo}>
        {conteudo}
      </div>
    );
  }

  return (
    <button
      onClick={aoClicar}
      aria-pressed={ativo}
      title={titulo}
      className={cn(
        "w-full text-left px-1 py-0.5 -my-0.5 rounded-md transition-colors hover:bg-muted/60",
        ativo && "bg-accent ring-1 ring-brand",
      )}
    >
      {conteudo}
    </button>
  );
}
