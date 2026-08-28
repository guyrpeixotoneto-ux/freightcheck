import { Building2, ChevronRight, Info, Layers } from "lucide-react";
import { formatBrlCompacto, periodicitySuffix } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GroupCard } from "@/components/inicio/group-card";
import type { ChangeGroup, OrigemDoGrupo } from "@/components/inicio/types";

/**
 * O que a Visão Geral desenha onde uma unidade desenhava o seu detalhe.
 *
 * A grade de Parâmetros inteira funciona somada — os cartões, a busca, a
 * ordenação, os ladrilhos — porque o servidor devolve a mesma `FamiliesView` de
 * sempre (`lib/comparison/src/visao-geral-de-parametros.ts`). O que **não**
 * atravessa a soma é o nível 2: a lista de veículos, a série do atributo, a
 * célula da planilha e a análise de intervalo são todas leituras *dentro de um
 * contexto*, e um contexto é uma unidade e um canal.
 *
 * Este arquivo é a resposta a isso, e a resposta não é esconder: é **abrir por
 * unidade**. Cada pedaço do grupo consolidado vira o cartão de sempre, com o
 * recorte da unidade de onde ele veio — as placas listadas são as daquela
 * unidade, e o rastro até a planilha continua existindo. Nada é inventado no
 * meio do caminho, e nada é engolido.
 */

/** Uma unidade dentro do detalhe — o rótulo acima do cartão dela. */
function Etiqueta({ origem, total }: { origem: OrigemDoGrupo; total: number }) {
  return (
    <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
      <Building2 className="w-3.5 h-3.5 shrink-0" />
      <span className="font-semibold text-foreground">{origem.label}</span>
      <span>
        · {origem.group.changes} de {total}{" "}
        {total === 1 ? "alteração" : "alterações"}
      </span>
    </div>
  );
}

/**
 * O detalhe de um atributo em Visão Geral — uma unidade de cada vez.
 *
 * A ordem é a do tamanho: a unidade que mais mexeu no ponto vem primeiro, que é
 * a mesma régua da fila de investigação. Empate resolvido pelo rótulo, para a
 * lista não trocar de ordem entre duas cargas da mesma tela.
 *
 * Com uma unidade só na lista o resultado é indistinguível da tela de sempre —
 * e é assim que tem de ser: "só CAMAÇARI mexeu neste ponto" é uma resposta
 * completa, não um caso degenerado.
 */
export function AlteracaoPorUnidade({
  grupo,
  period,
}: {
  grupo: ChangeGroup;
  period: string;
}) {
  const origens = [...(grupo.porUnidade ?? [])].sort(
    (a, b) =>
      b.group.changes - a.group.changes ||
      Math.abs(b.group.impact.amount ?? 0) - Math.abs(a.group.impact.amount ?? 0) ||
      a.label.localeCompare(b.label, "pt-BR"),
  );

  if (origens.length === 0) return null;

  return (
    <div className="space-y-5">
      {origens.length > 1 && (
        <>
          <Total grupo={grupo} unidades={origens.length} />
          <p className="text-sm text-muted-foreground flex gap-2 max-w-4xl">
            <Layers className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <strong className="text-foreground">
                {origens.length} unidades mexeram neste ponto.
              </strong>{" "}
              Os veículos, a série do atributo e a célula da planilha são de dentro de uma
              unidade — abaixo cada uma abre a sua, com o número dela, e o total acima é a
              soma das {origens.length}.
            </span>
          </p>
        </>
      )}

      {origens.map((origem) => (
        <div key={`${origem.scopeHash}|${origem.channel ?? ""}`} className="space-y-2">
          {origens.length > 1 && <Etiqueta origem={origem} total={grupo.changes} />}
          <GroupCard
            group={origem.group}
            period={period}
            recorte={{
              period,
              scopeHash: origem.scopeHash,
              canal: origem.channel,
            }}
            inicialmenteAberto={origens.length === 1}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * O total do ponto, somado — o cabeçalho que a lista por unidade explica.
 *
 * Sem ele o detalhe perdia o número que a grade mostrava: quem clicou num
 * cartão de R$ 750/mês caía numa pilha de três cartões menores e tinha de somar
 * de cabeça justamente o que a tela acabara de somar. Ele não é um `GroupCard`
 * — um cartão abre veículos, e veículo se abre dentro de um contexto —, é o
 * total e o que ele cobre, com a lista logo abaixo respondendo por cada parte.
 *
 * Sem valor apurado não vira zero: diz-se que não há, que é o que o produto faz
 * em toda parte.
 */
function Total({ grupo, unidades }: { grupo: ChangeGroup; unidades: number }) {
  const valor = grupo.impact.amount;

  return (
    <div className="rounded-xl border bg-card px-5 py-4 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Somado nas {unidades} unidades
        </div>
        <div className="text-sm mt-1">
          {grupo.changes} {grupo.changes === 1 ? "alteração" : "alterações"} ·{" "}
          <span title={grupo.coverageLabel}>{grupo.coverageLabel}</span>
        </div>
      </div>
      <div className="text-right">
        {valor === null ? (
          <div
            className="text-sm text-muted-foreground"
            title={grupo.impact.reason ?? undefined}
          >
            impacto não calculável
          </div>
        ) : (
          <div className={cn("text-2xl font-bold", valor < 0 ? "text-red-600" : "text-emerald-700")}>
            {formatBrlCompacto(valor)}
            <span className="text-sm font-normal text-muted-foreground">
              {periodicitySuffix(grupo.impact.periodicity)}
            </span>
          </div>
        )}
        {grupo.impact.excludedVehicles > 0 && (
          <div className="text-xs text-muted-foreground" title={grupo.impact.excludedReason ?? undefined}>
            {grupo.impact.excludedVehicles} de {grupo.vehicles} fora do total
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A recusa honesta: o que só existe dentro de uma unidade.
 *
 * Vale para o cadastro do Freightech (o inventário e as tabelas de domínio) e
 * para a análise de intervalo. As três leem *um* contexto no servidor, e a
 * Visão Geral não tem um — somá-las no cliente seria inventar uma tela que o
 * dado não sustenta, que é o que o resto desta página já se recusa a fazer.
 *
 * A saída não é um beco: a lista abaixo é o caminho, uma unidade por linha, e
 * clicar leva à mesma gaveta com o recorte daquela unidade.
 */
export function SoDentroDeUmaUnidade({
  oQue,
  contextos,
  onUnidade,
}: {
  /** O que não some, escrito como a tela o chama: "A análise de intervalo". */
  oQue: string;
  contextos: { unidade: string; label: string; scopeHash: string; channel: string | null }[];
  onUnidade: (scopeHash: string, canal: string | null) => void;
}) {
  return (
    <div className="mt-5 rounded-xl border border-l-[6px] border-l-brand bg-card px-6 py-5 max-w-4xl">
      <p className="text-sm flex gap-3">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-brand" />
        <span>
          <strong>{oQue} é lida dentro de uma unidade.</strong> Ela desce até a linha da
          planilha e ao cadastro de um contexto — unidade e canal —, e não existe versão
          somada disso: juntar o cadastro de duas unidades produziria uma ficha que não é de
          nenhuma. Escolha por onde começar.
        </span>
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {contextos.map((contexto) => (
          <button
            key={`${contexto.scopeHash}|${contexto.channel ?? ""}`}
            type="button"
            onClick={() => onUnidade(contexto.scopeHash, contexto.channel)}
            className="inline-flex items-center gap-1.5 rounded-full border border-input bg-background h-10 px-4 text-sm font-medium transition-colors hover:bg-muted"
          >
            {contexto.label}
            <ChevronRight className="w-4 h-4" />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * A faixa que abre a tela em Visão Geral — quantas unidades, e o que a soma faz.
 *
 * Existe pela mesma razão que `ComposicaoDaTela` existe para uma unidade: o
 * recorte tem de estar escrito **antes** do primeiro número. Sem ela, uma grade
 * somada é visualmente idêntica à grade de uma unidade, e quem chegou por um
 * link não teria como saber qual das duas está lendo.
 */
export function FaixaDaVisaoGeral({
  unidades,
  contextos,
  veiculos,
  alteracoes,
}: {
  unidades: number;
  contextos: { label: string }[];
  /** Ativos distintos — a união, e é por isso que ela é dita. */
  veiculos: number;
  alteracoes: number;
}) {
  return (
    <div className="mt-6 border-l-[6px] border-l-brand bg-card px-6 py-4">
      <p className="text-sm flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Layers className="w-4 h-4 self-center shrink-0 text-brand" />
        <strong>Visão Geral</strong>
        <span className="text-muted-foreground">
          soma {unidades} {unidades === 1 ? "unidade" : "unidades"} nesta vigência —{" "}
          {contextos.map((c) => c.label).join(" · ")}.
        </span>
      </p>
      <p className="text-xs text-muted-foreground mt-2">
        {alteracoes.toLocaleString("pt-BR")}{" "}
        {alteracoes === 1 ? "alteração" : "alterações"} ·{" "}
        {veiculos.toLocaleString("pt-BR")} {veiculos === 1 ? "veículo" : "veículos"}{" "}
        distintos — o mesmo ativo em duas unidades conta uma vez. O impacto soma dentro de
        cada periodicidade, nunca entre elas.
      </p>
    </div>
  );
}
