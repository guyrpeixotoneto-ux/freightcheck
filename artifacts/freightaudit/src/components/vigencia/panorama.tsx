import { cn } from "@/lib/utils";
import type { CockpitView, Severity } from "@/components/inicio/types";
import type { FiltroCockpit } from "@/lib/cockpit";

/**
 * O panorama — a composição do risco, em quatro leituras.
 *
 * Fica entre o resumo e a fila porque responde a pergunta que nasce depois do
 * "quanto" e antes do "por onde começo": *de que tipo é este risco*. Quatro
 * recortes, e cada um deles é uma **partição de coisas diferentes** — por isso
 * a unidade vai escrita em cada bloco:
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

  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Bloco titulo="Por criticidade" unidade="pontos da remuneração">
        {panorama.bySeverity.map((b) => (
          <Linha
            key={b.severity}
            rotulo={b.label}
            valor={b.groups}
            total={totalPontos}
            cor={COR_SEVERIDADE[b.severity]}
            ativo={filtro.severidade === b.severity}
            aoClicar={
              b.groups === 0
                ? undefined
                : () =>
                    aoFiltrar({
                      severidade: filtro.severidade === b.severity ? null : b.severity,
                    })
            }
            detalhe={`${b.changes.toLocaleString("pt-BR")} alt.`}
          />
        ))}
      </Bloco>

      <Bloco titulo="Por natureza do sinal" unidade="pontos da remuneração">
        {panorama.byBadge.map((b) => (
          <Linha
            key={b.badge}
            rotulo={b.label}
            valor={b.groups}
            total={totalPontos}
            cor={COR_SELO[b.badge] ?? "bg-zinc-400"}
            ativo={filtro.selo === b.badge}
            aoClicar={() =>
              aoFiltrar({ selo: filtro.selo === b.badge ? null : b.badge })
            }
            detalhe={`${b.changes.toLocaleString("pt-BR")} alt.`}
          />
        ))}
      </Bloco>

      <Bloco titulo="Por frota" unidade="alterações">
        {panorama.byEquipment.map((b) => (
          <Linha
            key={b.entityType ?? "sem"}
            rotulo={b.equipment}
            valor={b.changes}
            total={totalAlteracoes}
            cor="bg-sky-600"
            ativo={filtro.equipamento === b.entityType}
            aoClicar={
              b.entityType === null
                ? undefined
                : () =>
                    aoFiltrar({
                      equipamento: filtro.equipamento === b.entityType ? null : b.entityType,
                    })
            }
            detalhe={
              b.fleet === null
                ? `${b.groups} pontos`
                : `${b.groups} pontos · frota de ${b.fleet}`
            }
          />
        ))}
      </Bloco>

      <Bloco titulo="Por impacto financeiro" unidade="alterações">
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
          rotulo="Fora do total (já nas parcelas)"
          valor={pricing.excludedChanges}
          total={totalAlteracoes}
          cor="bg-violet-500"
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
        {pricing.reasons.length > 0 && (
          <p className="text-[0.6875rem] text-muted-foreground leading-snug pt-1.5 border-t mt-1">
            <span className="font-semibold text-foreground">Por que falta preço:</span>{" "}
            {pricing.reasons[0].reason}
            {pricing.reasons.length > 1 && (
              <>
                {" "}
                (+{pricing.reasons.length - 1}{" "}
                {pricing.reasons.length === 2 ? "outro motivo" : "outros motivos"})
              </>
            )}
          </p>
        )}
      </Bloco>
    </section>
  );
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
  SEM_SINAL: "bg-zinc-300",
};

function Bloco({
  titulo,
  unidade,
  children,
}: {
  titulo: string;
  unidade: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border shadow-sm px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-2 mb-2.5">
        <h3 className="text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          {titulo}
        </h3>
        <span className="text-[0.625rem] text-muted-foreground">{unidade}</span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

/**
 * Uma linha do panorama: rótulo, barra proporcional e contagem.
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
  detalhe,
  ativo,
  aoClicar,
}: {
  rotulo: string;
  valor: number;
  total: number;
  cor: string;
  detalhe?: string;
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
          {detalhe && (
            <span className="ml-1.5 font-normal text-[0.6875rem] text-muted-foreground">
              {detalhe}
            </span>
          )}
        </span>
      </div>
      <div className="h-1 bg-muted mt-1 overflow-hidden">
        <div className={cn("h-full", cor)} style={{ width: `${fatia}%` }} />
      </div>
    </>
  );

  if (!aoClicar) return <div className="px-1 py-0.5">{conteudo}</div>;

  return (
    <button
      onClick={aoClicar}
      aria-pressed={ativo}
      className={cn(
        "w-full text-left px-1 py-0.5 rounded-sm transition-colors hover:bg-muted/60",
        ativo && "bg-accent ring-1 ring-brand",
      )}
    >
      {conteudo}
    </button>
  );
}
