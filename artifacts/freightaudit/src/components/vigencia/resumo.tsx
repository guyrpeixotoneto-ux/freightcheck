import { useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  FileText,
  Star,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import type { CockpitView } from "@/components/inicio/types";

/**
 * O resumo executivo — cinco cartões e uma faixa.
 *
 * Cinco grandezas, e **as cinco são coisas diferentes**: linha de alteração,
 * ponto da remuneração, ativo, dinheiro apurado e indício de formato. A tela
 * antiga escondia as três primeiras dentro de uma frase ("o cliente mexeu em 15
 * pontos… 244 alterações"), e quem lia rápido saía com um número só na cabeça —
 * quase sempre o errado.
 *
 * Cada grandeza mora no seu próprio cartão, com um ícone que a identifica antes
 * da leitura: cinco números numa faixa contínua se leem como uma série, e estes
 * não são uma série — são cinco perguntas separadas.
 *
 * O que esta faixa recusa a fazer:
 *
 * - **Somar periodicidades.** R$/mês e R$/ano aparecem empilhados, com o
 *   sufixo em cada um.
 * - **Escrever R$ 0,00 quando não há preço.** Sem valor apurado o cartão diz
 *   "Não calculado", e a nota de baixo diz quantas alterações estão sem preço.
 * - **Dizer "nenhum valor apurável" como resposta da vigência.** O risco
 *   encontrado é o assunto; a ausência de preço é uma qualificação dele.
 */
export function ResumoExecutivo({ cockpit }: { cockpit: CockpitView }) {
  const { kpis } = cockpit;
  const impacto = Object.entries(kpis.impact.byPeriodicity).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <section className="grid gap-4 grid-cols-2 lg:grid-cols-5">
      {/*
        O total continua sendo o total — subtrair as de formato aqui faria o
        número do topo não fechar com a lista abaixo. O que muda é a nota, que
        diz quantas dessas linhas não são mudança de valor.
      */}
      <Cartao
        icone={FileText}
        tom="vermelho"
        rotulo="Alterações"
        nota={
          kpis.anomalies.formatOnlyChanges > 0
            ? `linhas alteradas · ${kpis.anomalies.formatOnlyChanges.toLocaleString(
                "pt-BR",
              )} só de formato`
            : "linhas alteradas"
        }
      >
        <Numero>{kpis.changes.toLocaleString("pt-BR")}</Numero>
      </Cartao>

      <Cartao
        icone={Star}
        tom="ambar"
        rotulo="Pontos prioritários"
        nota={`${kpis.attention === 1 ? "exige" : "exigem"} atenção, de ${kpis.parameters.toLocaleString(
          "pt-BR",
        )} ${kpis.parameters === 1 ? "ponto" : "pontos"}`}
      >
        <Numero destaque={kpis.attention > 0}>
          {kpis.attention.toLocaleString("pt-BR")}
        </Numero>
      </Cartao>

      <Cartao
        icone={Truck}
        tom="azul"
        rotulo="Veículos afetados"
        nota={
          kpis.fleet > 0
            ? `de ${kpis.fleet.toLocaleString("pt-BR")} na frota comparada`
            : "ativos com alguma alteração"
        }
      >
        <Numero>{kpis.vehicles.toLocaleString("pt-BR")}</Numero>
      </Cartao>

      <Cartao
        icone={CircleDollarSign}
        tom="cinza"
        rotulo="Impacto apurado"
        nota={
          impacto.length === 0
            ? "impacto financeiro"
            : `${cockpit.panorama.pricing.calculatedChanges.toLocaleString(
                "pt-BR",
              )} com valor · ${cockpit.panorama.pricing.notCalculableChanges.toLocaleString(
                "pt-BR",
              )} sem preço`
        }
      >
        {impacto.length === 0 ? (
          <div className="text-2xl font-bold leading-tight text-muted-foreground">
            Não calculado
          </div>
        ) : (
          <div className="space-y-0.5">
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
        )}
      </Cartao>

      {/*
        O alerta só acende quando formato e valor mudaram na mesma célula. Um
        ponto de formato puro é notícia de importação, não de risco: pintá-lo
        de vermelho aqui devolveria ao painel o susto que a classificação
        acabou de tirar da fila.
      */}
      <Cartao
        icone={AlertTriangle}
        tom="violeta"
        rotulo="Anomalias"
        nota={
          kpis.anomalies.groups === 0
            ? "nenhum indício de formato"
            : kpis.anomalies.formatOnlyGroups === kpis.anomalies.groups
              ? "só troca de formato, sem mudança de valor"
              : `${kpis.anomalies.groups - kpis.anomalies.formatOnlyGroups} com mudança de valor junto`
        }
      >
        <Numero alerta={kpis.anomalies.groups > kpis.anomalies.formatOnlyGroups}>
          {kpis.anomalies.groups.toLocaleString("pt-BR")}
        </Numero>
      </Cartao>
    </section>
  );
}

const TONS: Record<string, string> = {
  vermelho: "bg-red-50 text-red-600",
  ambar: "bg-amber-50 text-amber-600",
  azul: "bg-sky-50 text-sky-600",
  cinza: "bg-zinc-100 text-zinc-600",
  violeta: "bg-violet-50 text-violet-600",
};

function Cartao({
  icone: Icone,
  tom,
  rotulo,
  nota,
  children,
}: {
  icone: LucideIcon;
  tom: keyof typeof TONS;
  rotulo: string;
  nota: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border rounded-xl shadow-sm px-4 py-4">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center shrink-0",
            TONS[tom],
          )}
          aria-hidden
        >
          <Icone className="w-[1.125rem] h-[1.125rem]" />
        </span>
        <span className="text-sm font-semibold text-muted-foreground leading-tight">
          {rotulo}
        </span>
      </div>
      <div className="mt-3">{children}</div>
      <p className="text-xs text-muted-foreground mt-1 leading-snug">{nota}</p>
    </div>
  );
}

function Numero({
  children,
  destaque,
  alerta,
}: {
  children: React.ReactNode;
  destaque?: boolean;
  alerta?: boolean;
}) {
  return (
    <div
      className={cn(
        "text-4xl font-bold tabular-nums leading-none",
        destaque && "text-brand-red",
        alerta && "text-amber-700",
      )}
    >
      {children}
    </div>
  );
}

/**
 * A faixa que amarra os cinco números.
 *
 * É a frase da vigência reduzida ao que se lê de relance — quantos pontos
 * pedem atenção, quantos veículos, quantas anomalias, quanto custa. A leitura
 * longa não sumiu: ela abre aqui dentro, porque um resumo que não pode ser
 * conferido é só uma afirmação.
 */
export function FaixaResumo({ cockpit }: { cockpit: CockpitView }) {
  const [aberto, setAberto] = useState(false);
  const { kpis } = cockpit;

  const impacto = Object.entries(kpis.impact.byPeriodicity).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  const partes: string[] = [];
  if (kpis.attention > 0) {
    partes.push(
      `${kpis.attention} ${kpis.attention === 1 ? "ponto exige" : "pontos exigem"} atenção`,
    );
  }
  if (kpis.vehicles > 0) {
    partes.push(
      `${kpis.vehicles} ${kpis.vehicles === 1 ? "veículo afetado" : "veículos afetados"}`,
    );
  }
  if (kpis.anomalies.groups > 0) {
    partes.push(
      `${kpis.anomalies.groups} ${kpis.anomalies.groups === 1 ? "anomalia" : "anomalias"}`,
    );
  }
  partes.push(
    impacto.length === 0
      ? "impacto ainda não calculado"
      : `impacto de ${impacto
          .map(([p, valor]) => `${formatBrlShort(valor)}${periodicitySuffix(p)}`)
          .join(" e ")}`,
  );

  /*
    A cor é do conteúdo, não do lugar: uma vigência sem ponto em atenção e sem
    anomalia de valor não ganha uma tarja vermelha só porque a tarja existe.
  */
  const alerta =
    kpis.attention > 0 || kpis.anomalies.groups > kpis.anomalies.formatOnlyGroups;

  return (
    <section
      className={cn(
        "border rounded-xl overflow-hidden",
        alerta ? "border-red-200 bg-red-50/70" : "border-border bg-muted/40",
      )}
    >
      <button
        onClick={() => setAberto(!aberto)}
        aria-expanded={aberto}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <span
          className={cn(
            "w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white",
            alerta ? "bg-brand-red" : "bg-muted-foreground",
          )}
          aria-hidden
        >
          <CircleAlert className="w-4 h-4" />
        </span>
        <span className="text-sm font-semibold min-w-0 flex-1">
          {partes.join("  ·  ")}
        </span>
        <ChevronRight
          className={cn(
            "w-4 h-4 shrink-0 text-muted-foreground transition-transform",
            aberto && "rotate-90",
          )}
        />
      </button>

      {aberto && (
        <div className="px-4 pb-4 pl-14">
          <p className="text-sm font-bold">{cockpit.narrative.headline}</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-5xl leading-relaxed">
            {cockpit.narrative.sentences.join(" ")}
          </p>
        </div>
      )}
    </section>
  );
}
