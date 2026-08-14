import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import type { CockpitView } from "@/components/inicio/types";

/**
 * O resumo executivo — a faixa de números e a frase da vigência.
 *
 * Cinco grandezas, e **as cinco são coisas diferentes**: linha de alteração,
 * ponto da remuneração, ativo, dinheiro apurado e indício de formato. A tela
 * antiga escondia as três primeiras dentro de uma frase ("o cliente mexeu em 15
 * pontos… 244 alterações"), e quem lia rápido saía com um número só na cabeça —
 * quase sempre o errado.
 *
 * O que esta faixa recusa a fazer:
 *
 * - **Somar periodicidades.** R$/mês e R$/ano aparecem empilhados, com o
 *   sufixo em cada um.
 * - **Escrever R$ 0,00 quando não há preço.** Sem valor apurado o número é
 *   `—`, e a linha de baixo diz quantas alterações estão sem preço e por quê.
 * - **Dizer "nenhum valor apurável" como resposta da vigência.** O risco
 *   encontrado é o assunto; a ausência de preço é uma qualificação dele.
 */
export function ResumoExecutivo({ cockpit }: { cockpit: CockpitView }) {
  const { kpis } = cockpit;
  const impacto = Object.entries(kpis.impact.byPeriodicity).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <section className="bg-card border shadow-sm">
      <div className="grid grid-cols-2 lg:grid-cols-5 divide-x divide-y lg:divide-y-0">
        <Numero
          rotulo="Alterações"
          valor={kpis.changes.toLocaleString("pt-BR")}
          nota="linhas encontradas nesta vigência"
        />
        <Numero
          rotulo="Pontos em atenção"
          valor={kpis.attention.toLocaleString("pt-BR")}
          nota={`de ${kpis.parameters.toLocaleString("pt-BR")} ${
            kpis.parameters === 1 ? "ponto alterado" : "pontos alterados"
          }`}
          destaque={kpis.attention > 0}
        />
        <Numero
          rotulo="Veículos afetados"
          valor={kpis.vehicles.toLocaleString("pt-BR")}
          nota={
            kpis.fleet > 0
              ? `de ${kpis.fleet.toLocaleString("pt-BR")} na frota comparada`
              : "ativos com alguma alteração"
          }
        />
        <div className="px-5 py-4">
          <Rotulo>Impacto apurado</Rotulo>
          {impacto.length === 0 ? (
            <>
              <div className="mt-1 text-3xl font-bold tabular-nums text-muted-foreground">
                —
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">
                {kpis.changes.toLocaleString("pt-BR")} alterações sem impacto financeiro
                calculado
              </p>
            </>
          ) : (
            <>
              <div className="mt-1 space-y-0.5">
                {impacto.map(([periodicity, amount]) => (
                  <div
                    key={periodicity}
                    className={cn(
                      "text-2xl font-bold tabular-nums leading-tight",
                      amount < 0 ? "text-red-700" : "text-emerald-700",
                    )}
                  >
                    {formatBrlShort(amount)}
                    <span className="text-xs font-normal text-muted-foreground">
                      {periodicitySuffix(periodicity)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">
                {cockpit.panorama.pricing.calculatedChanges.toLocaleString("pt-BR")} com valor ·{" "}
                {cockpit.panorama.pricing.notCalculableChanges.toLocaleString("pt-BR")} sem preço
              </p>
            </>
          )}
        </div>
        <Numero
          rotulo="Anomalias"
          valor={kpis.anomalies.groups.toLocaleString("pt-BR")}
          nota={
            kpis.anomalies.groups === 0
              ? "nenhum indício de troca de formato"
              : `pontos com indício de formato · ${kpis.anomalies.changes.toLocaleString(
                  "pt-BR",
                )} linhas`
          }
          alerta={kpis.anomalies.groups > 0}
        />
      </div>

      <div className="border-t px-5 py-4">
        <p className="text-base font-bold">{cockpit.narrative.headline}</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-5xl leading-relaxed">
          {cockpit.narrative.sentences.join(" ")}
        </p>
      </div>
    </section>
  );
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  nota,
  destaque,
  alerta,
}: {
  rotulo: string;
  valor: string;
  nota: string;
  destaque?: boolean;
  alerta?: boolean;
}) {
  return (
    <div className="px-5 py-4">
      <Rotulo>{rotulo}</Rotulo>
      <div
        className={cn(
          "mt-1 text-3xl font-bold tabular-nums leading-tight",
          destaque && "text-brand-red",
          alerta && "text-amber-700",
        )}
      >
        {alerta && <AlertTriangle className="inline w-5 h-5 mr-1.5 -mt-1" />}
        {valor}
      </div>
      <p className="text-xs text-muted-foreground mt-1 leading-snug">{nota}</p>
    </div>
  );
}
