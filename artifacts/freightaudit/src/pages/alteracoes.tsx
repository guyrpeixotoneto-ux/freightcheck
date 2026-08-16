import { useEffect, useRef, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useSearch } from "wouter";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  ChevronRight,
  Clock,
  Columns3,
  DollarSign,
  FileSpreadsheet,
  Folder,
  Headset,
  HelpCircle,
  Layers,
  Loader2,
  Lock,
  SlidersHorizontal,
  Trash2,
  TrendingDown,
  Truck,
  Upload,
  Zap,
} from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error";
import { Layout } from "@/components/layout/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { erroDaResposta, fetchJson, getApiUrl, readJson } from "@/lib/api";
import { primeiraPagina, type Janela } from "@/lib/paginacao";
import { cn } from "@/lib/utils";
import {
  ChangeTable,
  FilterBar,
  QuickFilters,
  type AttributeRollup,
  type ChangeRow,
  type Breakdown,
  type Filters,
  emptyFilters,
  toQuery,
} from "@/components/changes/change-table";
import {
  TicketChangeTable,
  TicketFilterPanel,
  emptyTicketFilters,
  toTicketQuery,
  type OrdemChamados,
  type TicketChangeRow,
  type TicketFilters as TicketFilterState,
  type TicketTotals,
} from "@/components/changes/ticket-table";
import { TicketClassification } from "@/components/changes/ticket-classification";
import { ImpactoQuinzenas } from "@/components/changes/impacto-quinzenas";

/**
 * Alterações — o que mudou, pelos caminhos por onde a mudança chega, e quanto
 * cada ativo custa em cada vigência.
 *
 * **Planilha** é a comparação entre vigências: o que a Ambev mexeu no cadastro
 * entre um export e o seguinte, apurado célula a célula. **Chamados** é o
 * outro lado da mesma história — o que nós pedimos pelo Freightech e o que
 * voltou aplicado.
 *
 * As duas nunca somam nada uma com a outra, e isso é a decisão de projeto
 * central desta tela. O impacto da planilha é uma diferença apurada entre dois
 * estados fechados; o do chamado é a distância entre um pedido e uma resposta,
 * ambos declarados pela própria fonte. Adicioná-los daria um número que não se
 * sustenta em lugar nenhum — e contaria em dobro toda mudança que foi pedida
 * por chamado e depois apareceu na planilha. Duas contas, duas réguas, lado a
 * lado.
 *
 * **Impacto** é a terceira, e é a única que não parte da alteração. Ela mostra
 * o valor de cada ativo em cada quinzena e deixa a alteração aparecer como a
 * diferença entre duas colunas. Existe porque as outras duas, por construção,
 * não conseguem mostrar o ativo que **não** mudou — ele não está em lista de
 * alteração nenhuma — e sem ele o total da coluna não fecha com o que a Ambev
 * pagou. Ela também não soma com as outras: é o estado, não o movimento.
 */

type Aba = "planilha" | "chamados" | "impacto";

const ABAS: Aba[] = ["planilha", "chamados", "impacto"];

const abaValida = (valor: string | null): valor is Aba =>
  valor !== null && (ABAS as string[]).includes(valor);

/**
 * Em qual aba a tela abre.
 *
 * `abaInicial` é de quem entrou por outro endereço: `/impacto-financeiro`, no
 * menu de Auditoria, é a mesma tela aberta no Impacto — a pergunta "quanto isso
 * custou" tem entrada própria no menu, e não podia depender de alguém saber que
 * a resposta mora numa aba de Alterações.
 *
 * `?aba=` vence os dois, e existe para que um link colado no chat leve ao mesmo
 * lugar de quem o mandou. É estado inicial, não trava: clicar nas abas continua
 * mandando daí em diante.
 */
export default function Alteracoes({
  abaInicial = "planilha",
}: {
  abaInicial?: Aba;
} = {}) {
  const pedida = new URLSearchParams(useSearch()).get("aba");
  const [aba, setAba] = useState<Aba>(abaValida(pedida) ? pedida : abaInicial);

  // Só a contagem, para a aba dizer o tamanho do assunto antes de ser aberta.
  // `limit=1` porque a lista em si é da aba; o que interessa aqui é o total.
  const resumoChamados = useQuery({
    queryKey: ["tickets", "resumo"],
    queryFn: () =>
      fetchJson<{ totals: TicketTotals | null }>("/tickets?limit=1"),
  });

  return (
    <Layout>
      <div className="border-b bg-card px-8 pt-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Activity className="w-6 h-6 text-primary" />
          Alterações
        </h1>
        <p className="text-muted-foreground text-sm mt-1 max-w-3xl">
          A remuneração muda por dois caminhos, e cada um se confere de um
          jeito — os números de uma aba nunca somam com os da outra. Impacto é a
          terceira leitura: quanto cada ativo custa em cada quinzena.
        </p>

        <nav className="flex items-center gap-1 mt-4" role="tablist">
          <AbaBotao
            active={aba === "planilha"}
            onClick={() => setAba("planilha")}
            icon={<FileSpreadsheet className="w-4 h-4" />}
            label="Planilha"
            hint="o que a Ambev mexeu entre duas vigências"
          />
          <AbaBotao
            active={aba === "chamados"}
            onClick={() => setAba("chamados")}
            icon={<Headset className="w-4 h-4" />}
            label="Chamados"
            hint="o que pedimos e o que voltou aplicado"
            count={resumoChamados.data?.totals?.changes}
          />
          <AbaBotao
            active={aba === "impacto"}
            onClick={() => setAba("impacto")}
            icon={<DollarSign className="w-4 h-4" />}
            label="Impacto"
            hint="quanto cada ativo custa em cada quinzena"
          />
        </nav>
      </div>

      {aba === "planilha" && <AbaPlanilha />}
      {aba === "chamados" && <AbaChamados />}
      {aba === "impacto" && (
        <div className="p-8">
          <ImpactoQuinzenas />
        </div>
      )}
    </Layout>
  );
}

function AbaBotao({
  active,
  onClick,
  icon,
  label,
  hint,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
  count?: number;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      title={hint}
      className={cn(
        "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground hover:border-input",
      )}
    >
      {icon}
      {label}
      {count !== undefined && (
        <span
          className={cn(
            "text-xs tabular-nums rounded-full px-1.5 py-0.5",
            active ? "bg-primary/10 text-primary" : "bg-muted",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Aba Planilha
// ---------------------------------------------------------------------------

interface ConsolidatedResponse {
  view: {
    period: string;
    present: {
      entityTypeSet: string;
      sourceLabel: string;
      previousLabel: string | null;
      reason: string | null;
    }[];
    missing: string[];
    complete: boolean;
    totals: {
      valueChanges: number;
      entitiesAdded: number;
      entitiesRemoved: number;
      attributesAdded: number;
      attributesRemoved: number;
      inconclusive: number;
      impactNotCalculable: number;
    };
    impactByPeriodicity: Record<string, number>;
  };
  breakdown: Breakdown;
  periods: { effective_date: string; series: string[] }[];
  total: number;
  rows: ChangeRow[];
}

interface LatestResponse {
  set: {
    id: string;
    snapshotALabel: string;
    snapshotBLabel: string;
    valueChanges: number;
    entitiesAdded: number;
    entitiesRemoved: number;
    attributesAdded: number;
    attributesRemoved: number;
    unchanged: number;
    inconclusive: number;
    calculatedImpactByPeriodicity: Record<string, number>;
    impactNotCalculable: number;
  };
  breakdown: Breakdown;
  series: { entityTypeSet: string; vigencias: number; latestLabel: string }[];
  selectedSeries: string;
  total: number;
  rows: ChangeRow[];
}

/**
 * Qual disclosure da aba Planilha está aberta abaixo da fileira de avisos.
 *
 * Mesma regra da aba Chamados: um só de cada vez, nenhuma por padrão. O aviso
 * diz o tamanho do problema em uma linha; o detalhe — que é longo — só ocupa a
 * tela de quem pediu para vê-lo.
 */
type PainelPlanilha = "parcial" | "semPreco" | null;

/**
 * A tela responde, em ordem: o que mudou, de quanto para quanto, quanto isso
 * vale, em que parte da remuneração, e de onde veio. Materialidade ordena a
 * lista; nunca a filtra por conta própria.
 *
 * A forma é a da aba Chamados — cartões grandes, avisos em fileira, filtros
 * rápidos com o resto atrás de um botão, os dois painéis de concentração, e a
 * lista por último. Duas telas que respondem à mesma pergunta por caminhos
 * diferentes não deviam obrigar a reaprender onde ficam as coisas. O que
 * continua diferente é o único lugar onde a diferença é real: as réguas. Lá o
 * impacto é uma soma só; aqui é uma linha por periodicidade, porque R$/mês e
 * R$/ano não somam.
 */
function AbaPlanilha() {
  /*
    `?search=` chega preenchido quando alguém vem do Acompanhamento pedindo a
    lista de um parâmetro específico. É estado inicial, não filtro fixo: a
    barra de filtros continua mandando daí em diante, e limpar o campo devolve
    a lista inteira. O termo cobre código, nome do atributo e placa — ver
    `buildWhere` em `lib/comparison/src/query.ts`.
  */
  const buscaInicial = new URLSearchParams(useSearch()).get("search") ?? "";
  const [filters, setFilters] = useState<Filters>({
    ...emptyFilters,
    search: buscaInicial,
  });
  /** null = visão consolidada da frota; caso contrário, uma série. */
  const [series, setSeries] = useState<string | null>(null);
  const [janela, setJanela] = useState<Janela>(primeiraPagina);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [painel, setPainel] = useState<PainelPlanilha>(null);

  /*
    Filtrar ou trocar de série encurta a lista, e a página em que se estava
    pode deixar de existir — a tabela ficaria vazia com o rodapé afirmando que
    há resultados. Voltar para a primeira é o que não mente.
  */
  useEffect(() => {
    setJanela((atual) => (atual.pagina === 1 ? atual : { ...atual, pagina: 1 }));
  }, [filters, series]);

  const consolidated = useQuery({
    queryKey: ["changes", "consolidated", filters, janela],
    queryFn: () =>
      fetchJson<ConsolidatedResponse>(
        `/changes/consolidated?${toQuery(filters, {}, janela)}`,
      ),
    enabled: series === null,
  });

  const single = useQuery({
    queryKey: ["changes", "latest", filters, series, janela],
    queryFn: () =>
      fetchJson<LatestResponse>(
        `/changes/latest?${toQuery(filters, {}, janela)}&entityTypeSet=${series}`,
      ),
    enabled: series !== null,
  });

  const isLoading = series === null ? consolidated.isLoading : single.isLoading;
  const error = series === null ? consolidated.error : single.error;
  const cv = consolidated.data?.view;
  const data = single.data;

  // Séries conhecidas, para os botões. Vêm do consolidado, que enxerga todas.
  const known = [
    ...(cv?.present.map((p) => p.entityTypeSet) ?? []),
    ...(cv?.missing ?? []),
    ...(data?.series.map((s) => s.entityTypeSet) ?? []),
  ].filter((v, i, a) => a.indexOf(v) === i).sort();

  const rows = series === null ? consolidated.data?.rows : data?.rows;
  const total = series === null ? consolidated.data?.total : data?.total;
  const breakdown = series === null ? consolidated.data?.breakdown : data?.breakdown;
  const totals =
    series === null
      ? cv?.totals
      : data && {
          valueChanges: data.set.valueChanges,
          entitiesAdded: data.set.entitiesAdded,
          entitiesRemoved: data.set.entitiesRemoved,
          attributesAdded: data.set.attributesAdded,
          attributesRemoved: data.set.attributesRemoved,
          inconclusive: data.set.inconclusive,
          impactNotCalculable: data.set.impactNotCalculable,
        };
  const impact =
    series === null
      ? (cv?.impactByPeriodicity ?? {})
      : (data?.set.calculatedImpactByPeriodicity ?? {});

  const parcial = series === null && cv !== undefined && !cv.complete;
  const semPreco = totals?.impactNotCalculable ?? 0;
  const temAviso = parcial || semPreco > 0;

  const abrirPainel = (alvo: PainelPlanilha) =>
    setPainel((atual) => (atual === alvo ? null : alvo));

  const filtrarPorAtributo = (attributeCode: string) =>
    setFilters({
      ...filters,
      attributeCode:
        filters.attributeCode === attributeCode ? "" : attributeCode,
    });

  return (
    <div className="p-8 space-y-5">
      {/* De onde saiu tudo o que está abaixo, e sobre que recorte da frota.
          Fica numa linha, e não num cartão: é a procedência da tela, não um
          número dela. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground flex flex-wrap items-center gap-2">
            {series === null ? (
              cv && <span className="font-mono">período {cv.period}</span>
            ) : (
              data && (
                <>
                  <span className="font-mono">{data.set.snapshotALabel}</span>
                  <ArrowRight className="w-4 h-4" />
                  <span className="font-mono">{data.set.snapshotBLabel}</span>
                </>
              )
            )}
          </p>

          {series === null && cv && cv.present.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Consolidado de{" "}
              {cv.present
                .map((p) =>
                  p.previousLabel
                    ? `${p.entityTypeSet.toLowerCase()} (${p.previousLabel} → ${p.sourceLabel})`
                    : `${p.entityTypeSet.toLowerCase()} (${p.reason})`,
                )
                .join(" · ")}
              . Cada série é comparada com a anterior dela mesma; nada é fundido.
            </p>
          )}
        </div>

        {/* Consolidado é agrupamento de tela e API: soma as séries que
            entregaram no período. Nenhuma vigência é fundida no banco. */}
        {known.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <SerieChip active={series === null} onClick={() => setSeries(null)}>
              frota
            </SerieChip>
            {known.map((s) => (
              <SerieChip
                key={s}
                active={series === s}
                onClick={() => setSeries(s)}
              >
                {s.replace("+", " · ").toLowerCase()}
              </SerieChip>
            ))}
          </div>
        )}
      </div>

      {error && (
        <ApiErrorNotice
          error={error}
          what="As alterações da planilha não puderam ser carregadas."
        />
      )}

      {totals && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            tone="blue"
            icon={<SlidersHorizontal className="w-6 h-6" />}
            label="Valores alterados"
            value={totals.valueChanges.toLocaleString("pt-BR")}
            hint="célula a célula, entre as vigências"
          />
          <MetricCard
            tone="green"
            icon={<Truck className="w-6 h-6" />}
            label="Ativos entraram / saíram"
            value={`+${totals.entitiesAdded} / −${totals.entitiesRemoved}`}
            hint="entradas e saídas da frota"
          />
          <MetricCard
            tone="purple"
            icon={<Columns3 className="w-6 h-6" />}
            label="Colunas novas / removidas"
            value={`+${totals.attributesAdded} / −${totals.attributesRemoved}`}
            hint="mudanças no layout do arquivo"
          />
          {/*
            Impacto da planilha — uma linha por periodicidade, e nunca um número
            só: R$/mês e R$/ano são grandezas diferentes, e somá-las seria
            exatamente o erro que este produto existe para pegar. É também por
            isso que este cartão **não** soma com o de Impacto da aba Chamados:
            lá a régua é a distância entre um pedido e uma resposta.
          */}
          <MetricCard
            tone="red"
            icon={<TrendingDown className="w-6 h-6" />}
            label="Impacto apurado"
            value={<ImpactoPorPeriodicidade buckets={impact} />}
            hint={`${semPreco.toLocaleString("pt-BR")} alterações fora destes valores`}
          />
          <MetricCard
            tone="orange"
            icon={<HelpCircle className="w-6 h-6" />}
            label="Inconclusivas"
            value={totals.inconclusive.toLocaleString("pt-BR")}
            hint="listadas, não escondidas"
            valueTone={totals.inconclusive > 0 ? "warn" : "muted"}
          />
        </div>
      )}

      {/* Os avisos da comparação, em uma linha cada: o tamanho do problema à
          vista, e o detalhe atrás de um clique. Nenhum deles some quando é
          inconveniente — some quando não existe. */}
      {(temAviso || painel !== null) && (
        <Card className="rounded-2xl p-5 space-y-4">
          <div className={cn("gap-4 md:grid-cols-2", temAviso ? "grid" : "hidden")}>
            {parcial && cv && (
              <Aviso
                tone="red"
                titulo="Visão consolidada parcial"
                detalhe={`Falta ${cv.missing.join(", ").toLowerCase()} no período ${cv.period}`}
                acao="Revisar"
                aberto={painel === "parcial"}
                onClick={() => abrirPainel("parcial")}
              />
            )}
            {semPreco > 0 && (
              <Aviso
                tone="amber"
                icone={<Lock className="w-6 h-6" />}
                titulo={`${semPreco.toLocaleString("pt-BR")} alterações fora da soma de impacto`}
                detalhe="Continuam na lista — o que falta é o preço, não o fato"
                acao="Ver detalhes"
                aberto={painel === "semPreco"}
                onClick={() => abrirPainel("semPreco")}
              />
            )}
          </div>

          {painel === "parcial" && cv && (
            <div className="rounded-xl border bg-muted/30 p-4 text-sm">
              Para o período <span className="font-mono">{cv.period}</span>{" "}
              chegou apenas{" "}
              {cv.present.map((p) => p.entityTypeSet.toLowerCase()).join(", ")}.
              Falta <strong>{cv.missing.join(", ").toLowerCase()}</strong> — os
              números acima cobrem só o que foi entregue, e a série ausente não
              está contada como zero.
            </div>
          )}

          {painel === "semPreco" && (
            <div className="rounded-xl border bg-muted/30 p-4 text-sm">
              <strong>{semPreco.toLocaleString("pt-BR")}</strong> alterações
              estão fora da soma de impacto porque a semântica do atributo ainda
              não foi confirmada, ou porque ele não é um montante somável. Elas
              continuam na lista — o que falta é o preço, não o fato.
            </div>
          )}
        </Card>
      )}

      <Card className="rounded-2xl p-4 space-y-4">
        <QuickFilters
          filters={filters}
          onChange={setFilters}
          breakdown={breakdown}
          avancadoAberto={filtrosAbertos}
          onToggleAvancado={() => setFiltrosAbertos((v) => !v)}
        />
        {filtrosAbertos && (
          <FilterBar
            avancada
            filters={filters}
            onChange={setFilters}
            breakdown={breakdown}
          />
        )}
      </Card>

      {breakdown && breakdown.byAttribute.length > 0 && (
        <Card className="rounded-2xl">
          <div className="grid md:grid-cols-2 md:divide-x">
            <AtributosMaisAlterados
              itens={breakdown.byAttribute}
              selecionado={filters.attributeCode}
              onSelecionar={filtrarPorAtributo}
            />
            <ImpactosPorAtributo
              itens={breakdown.byAttribute}
              selecionado={filters.attributeCode}
              naoApuradas={semPreco}
              onSelecionar={filtrarPorAtributo}
            />
          </div>
        </Card>
      )}

      <Card className="rounded-2xl overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 border-b">
          <CardTitle className="text-sm font-semibold">
            {total !== undefined
              ? `${total.toLocaleString("pt-BR")} alterações`
              : "Alterações"}
          </CardTitle>
          <p
            className="text-xs text-muted-foreground"
            title="Materialidade ordena a lista; nunca a filtra por conta própria."
          >
            Ordenadas por materialidade: primeiro o que tem impacto apurado,
            depois pelo tamanho da variação · nada é omitido por ser pequeno
          </p>
        </div>
        {isLoading && (
          <p className="p-6 text-sm text-muted-foreground">Comparando…</p>
        )}
        {rows && total !== undefined && (
          <ChangeTable
            rows={rows}
            total={total}
            janela={janela}
            onJanela={setJanela}
          />
        )}
      </Card>
    </div>
  );
}

/** O recorte da frota — a pílula que troca o assunto da tela inteira. */
function SerieChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-9 rounded-full border px-4 text-sm font-medium transition-colors",
        active
          ? "bg-blue-600 border-blue-600 text-white shadow-sm"
          : "bg-background border-input text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Aba Chamados
// ---------------------------------------------------------------------------

interface TicketImportSummary {
  id: string;
  filename: string;
  status: string;
  receivedAt: string;
  receivedBy: string | null;
  rowCount: number;
  ticketCount: number;
  ignoredRowCount: number;
  unmappedColumns: string[];
  parameterColumns: string[];
  columnMapping: Record<string, { header: string; match: string; reason: string }>;
  failureReason: string | null;
}

/** Quanta coisa uma exclusão tira — a mesma conta que a API faz antes e depois. */
interface TicketImportDeletionCounts {
  tickets: number;
  ticketChanges: number;
  duplicateAttempts: number;
  storedFile: number;
}

interface TicketImportDeletionPlan {
  ticketImportId: string;
  filename: string;
  status: string;
  /** Por que não dá para excluir agora — null quando dá. */
  refusal: string | null;
  removes: TicketImportDeletionCounts;
}

interface TicketImportDeletionResult extends TicketImportDeletionPlan {
  removed: TicketImportDeletionCounts;
}

interface TicketsResponse {
  import: TicketImportSummary | null;
  imports: TicketImportSummary[];
  totals: TicketTotals | null;
  byParameter: {
    parameterLabel: string;
    attributeCode: string | null;
    count: number;
    impactSum: number | null;
  }[];
  total: number;
  rows: TicketChangeRow[];
}

/** Os nomes dos campos, para a tela explicar o mapeamento sem jargão. */
const NOMES_DE_CAMPO: Record<string, string> = {
  externalId: "número do chamado",
  openedAt: "abertura",
  closedAt: "fechamento",
  statusRaw: "status",
  parameterLabel: "parâmetro",
  entityLabel: "placa",
  entityType: "tipo de equipamento",
  requestedValueRaw: "valor pedido",
  appliedValueRaw: "valor aplicado",
  requestedBy: "solicitante",
  subject: "assunto",
};

/**
 * Chamados — os parâmetros que os chamados mexeram.
 *
 * O grão é o mesmo da aba Planilha: um parâmetro que mudou. Um chamado que
 * mexe em oito parâmetros produz oito linhas — o export vem no formato largo,
 * com dezenas de colunas de parâmetro por linha, e cada célula preenchida é
 * uma alteração.
 *
 * A régua é que é outra. Lá o "antes" é a vigência anterior, apurada célula a
 * célula; aqui ele é declarado pelo chamado ou lido da vigência em vigor, e a
 * tela marca qual dos dois. E o impacto só é afirmado depois de o chamado ser
 * atendido — antes disso existe variação, não dinheiro que mudou de mãos.
 */
/**
 * Qual disclosure está aberta abaixo da fileira de avisos.
 *
 * Um só de cada vez, e nenhuma por padrão: os avisos dizem o tamanho do
 * problema em uma linha, e o detalhe — que é longo — só ocupa a tela de quem
 * pediu para vê-lo.
 */
type Painel = "falhas" | "colunas" | "ignoradas" | null;

/**
 * As duas visões da aba, e a divisão de trabalho entre elas.
 *
 * **Resumo** é a lista: o que mudou, ordenado por materialidade, com filtro,
 * busca e a linha de cada alteração. **Por tipo** é a mesma população dobrada
 * pelos componentes da remuneração — fixo, variável, variável diesel —, que é a
 * pergunta que vem antes: *o mês mexeu em quê?*
 *
 * São visões e não abas novas de propósito: o arquivo é o mesmo, os avisos de
 * leitura são os mesmos, e a procedência no topo é a mesma. O que muda é por
 * onde se entra nos números.
 */
type Visao = "resumo" | "tipos";

function AbaChamados() {
  const [filters, setFilters] = useState<TicketFilterState>(emptyTicketFilters);
  const [visao, setVisao] = useState<Visao>("resumo");
  const [envio, setEnvio] = useState<string | null>(null);
  // O erro inteiro, e não a frase dele: `ApiErrorNotice` precisa do status e do
  // `code` para separar "o arquivo não serve" de "o banco deste ambiente ainda
  // não tem as tabelas".
  const [erroUpload, setErroUpload] = useState<unknown>(null);
  const [painel, setPainel] = useState<Painel>(null);
  const [janela, setJanela] = useState<Janela>(primeiraPagina);
  /*
    A ordem pedida no cabeçalho da tabela vive aqui, e não lá dentro, porque
    quem ordena é o servidor: com a lista paginada, ordenar as cem linhas que
    chegaram diria "o maior desta página" com a cara de "o maior de todos".
  */
  const [ordem, setOrdem] = useState<OrdemChamados>(null);
  /** O envio que a caixa de confirmação está prestes a apagar. */
  const [excluindo, setExcluindo] = useState<TicketImportSummary | null>(null);
  const [excluido, setExcluido] = useState<string | null>(null);
  const [erroExclusao, setErroExclusao] = useState<unknown>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Filtrar, trocar de envio ou trocar a régua de ordenação muda o tamanho ou a
  // sequência da lista — e a página em que se estava pode não existir mais, ou
  // já não conter o que continha do outro lado da troca.
  useEffect(() => {
    setJanela((atual) => (atual.pagina === 1 ? atual : { ...atual, pagina: 1 }));
  }, [filters, envio, ordem]);

  const query = useQuery({
    queryKey: ["tickets", filters, envio, janela, ordem],
    queryFn: () =>
      fetchJson<TicketsResponse>(
        `/tickets?${toTicketQuery(
          filters,
          envio ? { ticketImportId: envio } : {},
          janela,
          ordem,
        )}`,
      ),
    /*
      Virar a página não pode apagar a tabela: sem isto o `rows` some enquanto a
      página seguinte não chega, a lista pisca em branco a cada clique, e a
      seleção acumulada — que existe justamente para atravessar páginas — vai
      junto, porque a tabela desmonta.
    */
    placeholderData: keepPreviousData,
    /**
     * A leitura roda fora da requisição que recebeu o arquivo, então quem
     * acabou de enviar veria a tela parada em "está sendo lido" até apertar
     * F5. Enquanto houver envio em leitura a tela pergunta de novo sozinha; no
     * resto do tempo não pergunta nada.
     */
    refetchInterval: (query) => {
      const lendo = query.state.data?.imports.some(
        (i) => i.status === "PENDING" || i.status === "READING",
      );
      return lendo ? 1500 : false;
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      // base64 dentro de JSON, igual à importação de vigência: é a requisição
      // mais banal da web, e nenhum proxy a recusa.
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      const CHUNK = 32768;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      const response = await fetch(getApiUrl("/ticket-imports"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentBase64: btoa(binary),
        }),
      });
      const body = await readJson(response);
      /*
        `erroDaResposta` e não um `ApiError` montado aqui: esta linha construía
        o erro com status e `code` e deixava `contexto` e `diagnostico` para
        trás. Era justamente neste caminho — o do upload de chamados — que o
        diagnóstico estruturado se perdia, e a tela voltava a mostrar o texto
        cru da rota ao lado do aviso do `/healthz`, dizendo coisas diferentes.
      */
      if (!response.ok) throw erroDaResposta(response, body, file.name);
      return body.ticketImportId as string;
    },
    onSuccess: () => {
      setErroUpload(null);
      // A leitura roda fora da requisição, então o resultado ainda não está
      // pronto quando isto volta. Recarregar já mostra o envio em leitura, e o
      // `refetchInterval` abaixo cuida do resto.
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
    },
    onError: (err: unknown) => setErroUpload(err),
  });

  /**
   * Excluir apaga de verdade — e o que sai daqui não sai de mais lugar nenhum.
   *
   * `invalidateQueries` só de `["tickets"]`, e não sem chave como na tela de
   * Importações: um envio de chamados não escreve fato canônico nem vigência,
   * então nada em Dados, Início ou na aba Planilha muda por causa desta
   * exclusão. Invalidar a tela inteira daria a impressão contrária.
   */
  const excluir = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const response = await fetch(getApiUrl(`/ticket-imports/${id}`), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await readJson(response);
      if (!response.ok) throw erroDaResposta(response, body);
      return body as unknown as TicketImportDeletionResult;
    },
    onSuccess: (result) => {
      setErroExclusao(null);
      setExcluindo(null);
      setPainel(null);
      // O envio escolhido à mão pode ser justamente o que acabou de sair; sem
      // isto a tela pediria um envio que não existe mais e mostraria o vazio
      // como se não houvesse chamado nenhum.
      setEnvio((atual) => (atual === result.ticketImportId ? null : atual));
      setExcluido(
        `"${result.filename}" foi excluído: ${result.removed.ticketChanges} ` +
          `alteraç${result.removed.ticketChanges === 1 ? "ão" : "ões"} em ` +
          `${result.removed.tickets} chamado${result.removed.tickets === 1 ? "" : "s"} ` +
          `saíram do sistema.` +
          (result.removed.storedFile > 0
            ? " Este arquivo pode ser enviado de novo."
            : ""),
      );
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
    },
    /*
      O erro fica **na caixa**, e não na faixa da tela: a recusa mais comum aqui
      — "este envio ainda está sendo lido" — chega quando a caixa está aberta e
      cobrindo a página. Escrevê-la atrás do modal seria o mesmo que não
      escrever, e quem clicou veria só o botão voltar ao normal.
    */
    onError: (err: unknown) => {
      setExcluido(null);
      setErroExclusao(err);
    },
  });

  const data = query.data;
  const run = data?.import ?? null;
  const totals = data?.totals ?? null;

  const escolherArquivo = () => fileInput.current?.click();

  const falhas = data?.imports.filter((i) => i.status === "FAILED") ?? [];
  const emLeitura =
    data?.imports.filter((i) => i.status === "PENDING" || i.status === "READING") ??
    [];
  const naoMapeadas = run?.unmappedColumns ?? [];
  const ignoradas = run?.ignoredRowCount ?? 0;
  const temAviso =
    falhas.length > 0 || emLeitura.length > 0 || naoMapeadas.length > 0 || ignoradas > 0;

  /*
    O dinheiro pinta os dois cartões que falam dele. "Com impacto" é uma
    contagem, mas é a contagem das linhas que custaram — e mostrá-la em preto
    ao lado de um total vermelho faria o olho procurar duas vezes onde está o
    problema.
  */
  const tomDoDinheiro =
    totals && totals.calculated > 0
      ? totals.impactSum < 0
        ? "bad"
        : totals.impactSum > 0
          ? "good"
          : "muted"
      : "muted";

  const abrirPainel = (alvo: Painel) =>
    setPainel((atual) => (atual === alvo ? null : alvo));

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = "";
        }}
      />

      <div className="p-8 space-y-5">
        {/* De que arquivo saiu tudo o que está abaixo. Fica numa linha, e não
            num cartão: é a procedência da tela, não um número dela. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {run ? (
              <>
                <span className="font-mono">{run.filename}</span> · lido em{" "}
                {new Date(run.receivedAt).toLocaleDateString("pt-BR")}
                {run.receivedBy && <> · enviado por {run.receivedBy}</>}
              </>
            ) : (
              "Nenhum export de chamados importado ainda."
            )}
          </p>

          <div className="flex items-center gap-2">
            {run && Object.keys(run.columnMapping).length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => abrirPainel("colunas")}
                aria-expanded={painel === "colunas"}
                className={cn(
                  painel === "colunas" ? "text-blue-700" : "text-muted-foreground",
                )}
              >
                <Columns3 className="w-4 h-4 mr-1.5" />
                Mapeamento de colunas
              </Button>
            )}
            {data && data.imports.length > 1 && (
              <select
                value={envio ?? run?.id ?? ""}
                onChange={(e) => setEnvio(e.target.value || null)}
                className="text-xs h-8 rounded-md border border-input bg-background px-2"
              >
                {data.imports
                  .filter((i) => i.status === "READ")
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.filename} · {new Date(i.receivedAt).toLocaleDateString("pt-BR")}
                    </option>
                  ))}
              </select>
            )}
            {/*
              Excluir fica ao lado de Importar, e não escondido atrás de um
              menu: mandar o arquivo errado é banal — o export de teste, a fila
              com o filtro trocado — e esconder o desfazer é o que faz alguém
              conviver com o erro. O que protege não é a dificuldade de achar o
              botão, e sim a caixa seguinte, que diz quantos chamados saem antes
              de perguntar.
            */}
            {run && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setExcluindo(run)}
                className="text-red-700 hover:text-red-800 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4 mr-1.5" />
                Excluir
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={escolherArquivo}
              disabled={upload.isPending}
            >
              <Upload className="w-4 h-4 mr-1.5" />
              {upload.isPending ? "Enviando…" : "Importar chamados"}
            </Button>
          </div>
        </div>

        {/* As duas visões do mesmo arquivo. Fica logo abaixo da procedência
            porque é a primeira escolha de quem chega: ver a lista, ou ver em
            que valor da remuneração o mês mexeu. */}
        {run && (
          <div
            role="tablist"
            aria-label="visão dos chamados"
            className="inline-flex rounded-xl border bg-muted/50 p-1"
          >
            <VisaoBotao
              active={visao === "resumo"}
              onClick={() => setVisao("resumo")}
              label="Resumo"
              hint="a lista das alterações, ordenada por materialidade"
            />
            <VisaoBotao
              active={visao === "tipos"}
              onClick={() => setVisao("tipos")}
              label="Por tipo"
              hint="as mesmas alterações dobradas por valor fixo, variável e diesel"
              icon={<Layers className="w-4 h-4" />}
            />
          </div>
        )}

        {excluido && (
          <p className="text-sm text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            {excluido}
          </p>
        )}

        {/*
          O upload falha por dois motivos muito diferentes — o arquivo não
          serve, ou o banco deste ambiente não tem onde guardar — e a frase do
          servidor sozinha não os distingue. `ApiErrorNotice` pergunta ao
          /healthz e escreve a diferença.
        */}
        {erroUpload != null && (
          <ApiErrorNotice
            error={erroUpload}
            what="O export de chamados não pôde ser enviado."
          />
        )}

        {query.error && (
          <ApiErrorNotice
            error={query.error}
            what="Os chamados não puderam ser carregados."
          />
        )}

        {totals && visao === "resumo" && (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              tone="blue"
              icon={<SlidersHorizontal className="w-6 h-6" />}
              label="Parâmetros alterados"
              value={totals.changes.toLocaleString("pt-BR")}
              hint={`em ${totals.tickets.toLocaleString("pt-BR")} chamado${totals.tickets === 1 ? "" : "s"}`}
            />
            <MetricCard
              tone="green"
              icon={<Folder className="w-6 h-6" />}
              label="Em aberto"
              value={totals.stillOpen.toLocaleString("pt-BR")}
              hint="chamados sem data de fechamento"
              valueTone={totals.stillOpen > 0 ? "warn" : "muted"}
            />
            <MetricCard
              tone="orange"
              icon={<Zap className="w-6 h-6" />}
              label="Com impacto"
              value={totals.calculated.toLocaleString("pt-BR")}
              hint={`${totals.notCalculable.toLocaleString("pt-BR")} sem impacto apurado`}
              valueTone={tomDoDinheiro}
            />
            {/*
              Impacto dos chamados — uma soma só, e por que ela é diferente da
              outra. Aqui não há periodicidade a separar: `aplicado − pedido` é
              uma diferença entre duas quantias declaradas na mesma unidade pelo
              próprio arquivo. É por isso que este número **não** entra no
              cartão da aba Planilha: lá a régua é outra.
            */}
            <MetricCard
              tone="red"
              icon={<TrendingDown className="w-6 h-6" />}
              label="Impacto"
              value={
                totals.calculated === 0
                  ? "não calculável"
                  : `${totals.impactSum > 0 ? "+" : ""}${brl0(totals.impactSum)}`
              }
              hint={`${totals.notCalculable.toLocaleString("pt-BR")} alterações fora desta soma`}
              valueTone={totals.calculated === 0 ? "muted" : tomDoDinheiro}
            />
            <MetricCard
              tone="purple"
              icon={<Clock className="w-6 h-6" />}
              label="TMA"
              value={
                totals.averageDaysToClose === null
                  ? "—"
                  : `${totals.averageDaysToClose} d`
              }
              hint={
                totals.averageDaysToClose === null
                  ? "sem chamado fechado com as duas datas"
                  : "tempo médio, só os que já fecharam"
              }
            />
          </div>
        )}

        {/* Os avisos do arquivo, em uma linha cada: o tamanho do problema à
            vista, e o detalhe atrás de um clique. Nenhum deles some quando é
            inconveniente — some quando não existe. */}
        {/* O cartão também aparece sem aviso nenhum quando alguém pede o
            mapeamento de colunas pelo botão do topo: o painel aberto precisa de
            onde morar, e um arquivo perfeito não tem faixa vermelha. */}
        {(temAviso || painel !== null) && (
          <Card className="rounded-2xl p-5 space-y-4">
            <div className={cn("gap-4 md:grid-cols-2", temAviso ? "grid" : "hidden")}>
              {falhas.length > 0 && (
                <Aviso
                  tone="red"
                  titulo={`${falhas.length} arquivo${falhas.length === 1 ? "" : "s"} com problema`}
                  detalhe={falhas[0].failureReason ?? "O arquivo não pôde ser lido."}
                  acao="Revisar"
                  aberto={painel === "falhas"}
                  onClick={() => abrirPainel("falhas")}
                />
              )}
              {naoMapeadas.length > 0 && (
                <Aviso
                  tone="amber"
                  icone={<Columns3 className="w-6 h-6" />}
                  titulo={`${naoMapeadas.length} colunas não mapeadas`}
                  detalhe="Dados preservados no arquivo original"
                  acao="Ver detalhes"
                  aberto={painel === "colunas"}
                  onClick={() => abrirPainel("colunas")}
                />
              )}
              {ignoradas > 0 && run && (
                <Aviso
                  tone="amber"
                  titulo={`${ignoradas.toLocaleString("pt-BR")} linhas fora da leitura`}
                  detalhe="Sem número de chamado — e a conta fecha"
                  acao="Ver detalhes"
                  aberto={painel === "ignoradas"}
                  onClick={() => abrirPainel("ignoradas")}
                />
              )}
              {emLeitura.length > 0 && (
                <Aviso
                  tone="sky"
                  icone={<Loader2 className="w-6 h-6 animate-spin" />}
                  titulo={`${emLeitura.length} envio${emLeitura.length === 1 ? "" : "s"} em leitura`}
                  detalhe={emLeitura.map((i) => i.filename).join(", ")}
                />
              )}
            </div>

            {painel === "falhas" && (
              <div className="rounded-xl border bg-muted/30 p-4 space-y-2 text-sm">
                {falhas.map((i) => (
                  <div key={i.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono font-medium">{i.filename}</span>
                    <span className="text-muted-foreground">
                      · {new Date(i.receivedAt).toLocaleDateString("pt-BR")}
                      {i.receivedBy && ` · ${i.receivedBy}`}
                    </span>
                    {/*
                      Um envio que falhou não aparece no seletor do topo — ele
                      lista só os lidos —, então este é o único lugar de onde
                      ele pode sair. Sem o botão aqui, o aviso do arquivo que
                      não serviu ficaria na tela para sempre.
                    */}
                    <button
                      onClick={() => setExcluindo(i)}
                      className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-red-700 underline underline-offset-2 hover:no-underline"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Excluir
                    </button>
                    <p className="w-full text-muted-foreground">
                      {i.failureReason ?? "Sem motivo registrado."}
                    </p>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground pt-1">
                  Nada deste envio foi gravado — o arquivo continua inteiro onde
                  estava, e reenviá-lo corrigido não duplica nada.
                </p>
              </div>
            )}

            {painel === "colunas" && run && (
              <div className="rounded-xl border bg-muted/30 p-4 space-y-4 text-sm">
                {naoMapeadas.length > 0 && (
                  <div>
                    <div className="font-medium">
                      {naoMapeadas.length} colunas do arquivo não têm campo
                      correspondente aqui
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {naoMapeadas.map((coluna) => (
                        <span
                          key={coluna}
                          className="rounded border bg-background px-2 py-0.5 font-mono text-xs text-muted-foreground"
                        >
                          {coluna}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Elas continuam inteiras na linha de origem — abra qualquer
                      chamado para vê-las.
                    </p>
                  </div>
                )}

                {/* A conta que protege o modo de falha desta leitura: um
                    mapeamento errado não estoura, só produz menos alterações —
                    e "menos" é indistinguível de "o chamado mexeu em pouca
                    coisa" a olho nu. */}
                {run.parameterColumns.length > 0 && totals && (
                  <div>
                    <div className="font-medium">
                      {run.parameterColumns.length} colunas de parâmetro
                      reconhecidas, com {totals.changes.toLocaleString("pt-BR")}{" "}
                      células preenchidas em{" "}
                      {totals.tickets.toLocaleString("pt-BR")} chamados
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {run.parameterColumns.map((coluna) => (
                        <span
                          key={coluna}
                          className="rounded border bg-background px-2 py-0.5 font-mono text-xs text-muted-foreground"
                        >
                          {coluna}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Uma célula vazia quer dizer que aquele chamado não mexeu
                      naquele parâmetro — é o normal, e por isso nenhuma
                      alteração é criada para ela. As colunas com{" "}
                      <span className="font-mono">↔</span> são pares
                      antes/depois que o próprio arquivo trouxe.
                    </p>
                  </div>
                )}

                {Object.keys(run.columnMapping).length > 0 && (
                  <div>
                    <div className="font-medium">
                      De que coluna do arquivo saiu cada campo
                    </div>
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
                      {Object.entries(run.columnMapping).map(([campo, ligacao]) => (
                        <div key={campo} className="flex items-baseline gap-2 min-w-0">
                          <span className="text-muted-foreground shrink-0">
                            {NOMES_DE_CAMPO[campo] ?? campo}:
                          </span>
                          <span className="font-mono text-xs truncate">
                            {ligacao.header}
                          </span>
                          {ligacao.match === "aproximado" && (
                            <span
                              className="text-xs text-amber-700 shrink-0"
                              title={ligacao.reason}
                            >
                              por aproximação
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {painel === "ignoradas" && run && (
              <div className="rounded-xl border bg-muted/30 p-4 text-sm">
                O arquivo trazia{" "}
                <strong>{run.rowCount.toLocaleString("pt-BR")}</strong> linhas de
                dados;{" "}
                <strong>{run.ticketCount.toLocaleString("pt-BR")}</strong>{" "}
                viraram chamado e{" "}
                <strong>{run.ignoredRowCount.toLocaleString("pt-BR")}</strong>{" "}
                ficaram de fora por não terem número de chamado. A conta fecha, e
                nada foi descartado em silêncio.
              </div>
            )}
          </Card>
        )}

        {!run && !query.isLoading && (
          <Card className="rounded-2xl">
            <CardContent className="p-10 text-center space-y-3">
              <Headset className="w-8 h-8 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground max-w-lg mx-auto">
                Esta aba mostra o que foi pedido pelo Freightech e o que voltou
                aplicado. Ela vive de um export da fila de chamados —{" "}
                <strong>.xlsx</strong> ou <strong>.csv</strong> — e o único
                requisito é ter uma coluna que identifique o chamado
                (&quot;Chamado&quot;, &quot;Nº do chamado&quot;,
                &quot;Protocolo&quot;). As demais colunas são reconhecidas pelo
                nome, e o que não for reconhecido aparece listado em vez de
                sumir.
              </p>
              <Button onClick={escolherArquivo} disabled={upload.isPending}>
                <Upload className="w-4 h-4 mr-1.5" />
                {upload.isPending ? "Enviando…" : "Importar export de chamados"}
              </Button>
            </CardContent>
          </Card>
        )}

        {run && visao === "tipos" && (
          <TicketClassification envio={envio ?? run.id} />
        )}

        {run && visao === "resumo" && (
          <Card className="rounded-2xl p-4 space-y-4">
            <TicketFilterPanel
              filters={filters}
              onChange={setFilters}
              totals={totals ?? undefined}
            />
          </Card>
        )}

        {data && data.byParameter.length > 0 && visao === "resumo" && (
          <Card className="rounded-2xl">
            <div className="grid md:grid-cols-2 md:divide-x">
              <ParametrosMaisPedidos
                itens={data.byParameter}
                selecionado={filters.parameterLabel}
                onSelecionar={(parameterLabel) =>
                  setFilters({
                    ...filters,
                    parameterLabel:
                      filters.parameterLabel === parameterLabel ? "" : parameterLabel,
                  })
                }
              />
              <ImpactosRelevantes
                itens={data.byParameter}
                selecionado={filters.parameterLabel}
                naoApuradas={totals?.notCalculable ?? 0}
                onSelecionar={(parameterLabel) =>
                  setFilters({
                    ...filters,
                    parameterLabel:
                      filters.parameterLabel === parameterLabel ? "" : parameterLabel,
                  })
                }
              />
            </div>
          </Card>
        )}

        {run && visao === "resumo" && (
          <Card className="rounded-2xl overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 border-b">
              <CardTitle className="text-sm font-semibold">
                {data
                  ? `${data.total.toLocaleString("pt-BR")} alterações de chamado`
                  : "Alterações de chamado"}
              </CardTitle>
              <p
                className="text-xs text-muted-foreground"
                title="Um chamado que altera oito parâmetros aparece em oito linhas. Nada é omitido por ser pequeno."
              >
                Uma linha por parâmetro que um chamado mexeu ·{" "}
                {ordem
                  ? "ordenadas pela coluna que você escolheu, na lista inteira"
                  : "sem ordenação pedida, vêm por materialidade"}
              </p>
            </div>
            {query.isLoading && (
              <p className="p-6 text-sm text-muted-foreground">Lendo…</p>
            )}
            {data && (
              // Enquanto a página pedida não chega, o que está na tela é a
              // anterior. Apagá-la seria pior, e deixá-la firme diria que já é
              // a nova — a opacidade é o meio-termo honesto.
              <div className={cn(query.isPlaceholderData && "opacity-50")}>
                <TicketChangeTable
                  rows={data.rows}
                  total={data.total}
                  janela={janela}
                  onJanela={setJanela}
                  ordem={ordem}
                  onOrdem={setOrdem}
                />
              </div>
            )}
          </Card>
        )}
      </div>

      <ExcluirEnvioDialog
        envio={excluindo}
        erro={erroExclusao}
        onClose={() => {
          setExcluindo(null);
          setErroExclusao(null);
        }}
        onConfirm={(reason) =>
          excluindo && excluir.mutate({ id: excluindo.id, reason })
        }
        excluindo={excluir.isPending}
      />
    </>
  );
}

/**
 * Um dos dois botões de visão.
 *
 * Controle segmentado, e não uma segunda fileira de abas: as abas de cima
 * separam duas fontes de dado que nunca somam uma com a outra, e repetir a
 * mesma forma aqui sugeriria que Resumo e Por tipo também são populações
 * diferentes. São a mesma, vista de dois jeitos.
 */
function VisaoBotao({
  active,
  onClick,
  label,
  hint,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      title={hint}
      className={cn(
        "flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * A caixa que transforma "tem certeza?" numa decisão.
 *
 * Ela pergunta ao servidor o que sairia **antes** de perguntar à pessoa, porque
 * quem está na tela não tem como saber que aquele arquivo sustenta 1.218
 * alterações em 1.218 chamados. "Isto apaga 1.218 alterações" é uma frase sobre
 * a qual dá para decidir; "tem certeza?" não é.
 *
 * A prévia também é onde a recusa aparece: um envio ainda em leitura não pode
 * ser apagado por baixo de quem o lê, e o motivo chega escrito em vez de virar
 * um botão que não funciona.
 */
function ExcluirEnvioDialog({
  envio,
  erro,
  onClose,
  onConfirm,
  excluindo,
}: {
  envio: TicketImportSummary | null;
  /** A recusa do servidor, quando o botão já foi apertado. */
  erro: unknown;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  excluindo: boolean;
}) {
  const [reason, setReason] = useState("");

  const { data: plano, error } = useQuery({
    queryKey: ["ticket-imports", envio?.id, "deletion"],
    queryFn: () =>
      fetchJson<TicketImportDeletionPlan>(
        `/ticket-imports/${envio!.id}/deletion`,
      ),
    enabled: envio !== null,
    // O que sai depende do resto do banco — outro envio do mesmo arquivo no
    // meio-tempo muda a conta. Sem cache: esta prévia é lida uma vez e agida
    // em seguida.
    staleTime: 0,
    gcTime: 0,
  });

  const linhas: [string, number][] = plano
    ? (
        [
          ["Chamados", plano.removes.tickets],
          ["Alterações de parâmetro", plano.removes.ticketChanges],
          ["Tentativas recusadas como duplicata", plano.removes.duplicateAttempts],
        ] as [string, number][]
      ).filter(([, valor]) => valor > 0)
    : [];

  return (
    <Dialog open={envio !== null} onOpenChange={(open) => !open && onClose()}>
      {envio && (
        <>
          <DialogHeader>
            <DialogTitle>Excluir "{envio.filename}"?</DialogTitle>
            <DialogDescription>
              Isto apaga o envio e os chamados que só ele trouxe. Não há
              desfazer: fica o registro de que foi excluído — quem, quando e o
              que saiu —, não os dados. A aba Planilha não é tocada.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p className="text-sm text-red-900 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              Não foi possível calcular o que sairia: {(error as Error).message}
            </p>
          )}

          {!plano && !error && (
            <p className="text-sm text-muted-foreground">
              Calculando o que sairia…
            </p>
          )}

          {plano?.refusal && (
            <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              {plano.refusal}
            </p>
          )}

          {plano && !plano.refusal && (
            <div className="space-y-4">
              {linhas.length > 0 ? (
                <dl className="rounded-xl border divide-y overflow-hidden text-sm">
                  {linhas.map(([label, valor]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between gap-4 px-4 py-2 bg-muted/30"
                    >
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-semibold tabular-nums">
                        {valor.toLocaleString("pt-BR")}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Este envio não chegou a produzir chamado nenhum — sai só o
                  registro dele.
                </p>
              )}

              {plano.removes.storedFile > 0 && (
                <p className="text-sm text-muted-foreground">
                  O arquivo sai do registro de recebidos, então o mesmo conteúdo
                  poderá ser enviado de novo — hoje ele é recusado como
                  duplicata pelo SHA-256.
                </p>
              )}

              <label className="block space-y-1.5">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  Motivo (opcional)
                </span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="ex.: export de teste enviado por engano"
                  className="w-full rounded-lg border px-3 py-2 text-sm bg-background"
                />
                <span className="text-xs text-muted-foreground">
                  Vai para o registro da exclusão, ao lado do seu nome.
                </span>
              </label>
            </div>
          )}

          {erro != null && (
            <div className="mt-4">
              <ApiErrorNotice
                error={erro}
                what="O envio de chamados não pôde ser excluído."
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={!plano || plano.refusal !== null || excluindo}
              onClick={() => onConfirm(reason)}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              {excluindo ? "Excluindo…" : "Excluir envio"}
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}

/** Reais sem centavos — a régua dos cartões, onde o centavo não decide nada. */
const brl0 = (valor: number) =>
  valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });

const LADRILHO: Record<string, string> = {
  blue: "bg-blue-50 text-blue-600",
  green: "bg-emerald-50 text-emerald-600",
  orange: "bg-orange-50 text-orange-600",
  red: "bg-red-50 text-red-600",
  purple: "bg-violet-50 text-violet-600",
};

/**
 * Um número do topo: o ícone que o identifica, o nome, o valor, e a ressalva.
 *
 * A ressalva é a linha pequena, e ela não é enfeite: um total de impacto sem
 * "quantas alterações ficaram de fora desta soma" é um número que parece cobrir
 * o arquivo inteiro quando cobre uma parte dele. Toda soma desta tela carrega o
 * seu complemento junto.
 */
function MetricCard({
  icon,
  tone,
  label,
  value,
  hint,
  valueTone = "muted",
}: {
  icon: React.ReactNode;
  tone: keyof typeof LADRILHO;
  label: string;
  /**
   * Um número, ou o que não cabe em um. O impacto da planilha é uma linha por
   * periodicidade, e um cartão que só aceitasse texto obrigaria a escolher uma
   * delas para caber — que é a decisão que este produto não deixa ninguém tomar
   * por descuido.
   */
  value: React.ReactNode;
  hint?: string;
  valueTone?: "good" | "bad" | "warn" | "muted";
}) {
  return (
    <div className="rounded-2xl border bg-card shadow-sm px-5 py-5 flex items-center gap-4">
      <div
        className={cn(
          "h-14 w-14 rounded-2xl grid place-content-center shrink-0",
          LADRILHO[tone],
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        <div
          className={cn(
            "text-3xl font-bold tracking-tight tabular-nums mt-1 min-w-0",
            valueTone === "good" && "text-emerald-700",
            valueTone === "bad" && "text-red-600",
            valueTone === "warn" && "text-amber-600",
          )}
        >
          {/* Texto continua cortando com reticências; o que vem montado cuida
              da própria altura. */}
          {typeof value === "string" ? (
            <span className="block truncate">{value}</span>
          ) : (
            value
          )}
        </div>
        {hint && (
          <div className="text-xs text-muted-foreground mt-1">{hint}</div>
        )}
      </div>
    </div>
  );
}

/**
 * Impacto apurado, uma linha por periodicidade.
 *
 * Nunca um número só: R$/mês e R$/ano são grandezas diferentes, e somá-las
 * seria exatamente o erro que este produto existe para pegar. Anualizar as duas
 * numa figura comparável é trabalho de F4, com regras próprias.
 */
function ImpactoPorPeriodicidade({
  buckets,
}: {
  buckets: Record<string, number>;
}) {
  const entries = Object.entries(buckets);
  if (entries.length === 0) {
    return <span className="block truncate text-muted-foreground">não calculável</span>;
  }
  return (
    /*
      `whitespace-nowrap` não é estética. Um sinal de menos que cai sozinho na
      linha de cima transforma "-R$ 594" em algo que se lê como número positivo,
      e este é o cartão em que essa leitura custa dinheiro. É a mesma razão pela
      qual `ImpactCell` o carrega na tabela.

      O tamanho cede antes da quebra: com duas periodicidades cabem duas linhas
      no lugar de uma, e o texto encolhe para que nenhuma delas quebre no meio.
    */
    <div
      className={cn(
        "leading-tight",
        entries.length > 1 ? "text-lg space-y-0.5" : "text-2xl",
      )}
    >
      {entries.map(([periodicity, amount]) => (
        <div key={periodicity} className="flex items-baseline gap-1 whitespace-nowrap">
          <span className={amount < 0 ? "text-red-600" : "text-emerald-700"}>
            {brl0(amount)}
          </span>
          <span className="text-xs font-medium text-muted-foreground">
            /{periodicity.toLowerCase()}
          </span>
        </div>
      ))}
    </div>
  );
}

const AVISO: Record<string, { caixa: string; bolha: string; titulo: string }> = {
  red: {
    caixa: "border-red-100 bg-red-50",
    bolha: "bg-red-600 text-white",
    titulo: "text-red-600",
  },
  amber: {
    caixa: "border-amber-100 bg-amber-50",
    bolha: "bg-amber-500 text-white",
    titulo: "text-amber-700",
  },
  sky: {
    caixa: "border-sky-100 bg-sky-50",
    bolha: "bg-sky-500 text-white",
    titulo: "text-sky-700",
  },
};

/** Um problema do arquivo em uma linha: o quê, o quanto, e por onde ver. */
function Aviso({
  tone,
  icone,
  titulo,
  detalhe,
  acao,
  aberto,
  onClick,
}: {
  tone: keyof typeof AVISO;
  icone?: React.ReactNode;
  titulo: string;
  detalhe: string;
  acao?: string;
  aberto?: boolean;
  onClick?: () => void;
}) {
  const estilo = AVISO[tone];
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-xl border px-5 py-4",
        estilo.caixa,
      )}
    >
      <div
        className={cn(
          "h-12 w-12 rounded-full grid place-content-center shrink-0",
          estilo.bolha,
        )}
      >
        {icone ?? <AlertTriangle className="w-6 h-6" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn("font-bold", estilo.titulo)}>{titulo}</div>
        <div className="text-sm text-muted-foreground line-clamp-1" title={detalhe}>
          {detalhe}
        </div>
      </div>
      {acao && onClick && (
        <button
          onClick={onClick}
          aria-expanded={aberto}
          className={cn(
            "inline-flex items-center gap-1 text-sm font-medium shrink-0 hover:underline",
            estilo.titulo,
          )}
        >
          {acao}
          <ChevronRight
            className={cn("w-4 h-4 transition-transform", aberto && "rotate-90")}
          />
        </button>
      )}
    </div>
  );
}

function TituloDePainel({
  icone,
  children,
}: {
  icone: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 grid place-content-center shrink-0">
        {icone}
      </div>
      <h3 className="text-lg font-bold tracking-tight">{children}</h3>
    </div>
  );
}

type ParametroRollup = {
  parameterLabel: string;
  attributeCode: string | null;
  count: number;
  impactSum: number | null;
};

/**
 * Onde os chamados se concentram.
 *
 * Contagem, e só contagem: é a pergunta "o que mais se pede", que não tem nada
 * a ver com "o que mais custa" — o painel ao lado responde essa, e os dois
 * quase nunca têm o mesmo primeiro colocado.
 */
function ParametrosMaisPedidos({
  itens,
  selecionado,
  onSelecionar,
}: {
  itens: ParametroRollup[];
  selecionado: string;
  onSelecionar: (parameterLabel: string) => void;
}) {
  const topo = itens.slice(0, 5);
  return (
    <div className="p-6">
      <TituloDePainel icone={<BarChart3 className="w-5 h-5" />}>
        Parâmetros mais pedidos
      </TituloDePainel>

      <div className="mt-4">
        {topo.map((p, i) => (
          <button
            key={`${p.parameterLabel}-${p.attributeCode}`}
            onClick={() => onSelecionar(p.parameterLabel)}
            title={`filtrar a lista por ${p.parameterLabel}`}
            className={cn(
              "w-full flex items-center gap-4 px-2 py-3 text-left border-b last:border-b-0 rounded-md transition-colors",
              selecionado === p.parameterLabel
                ? "bg-blue-50 text-blue-800"
                : "hover:bg-muted/50",
            )}
          >
            <span className="w-4 shrink-0 text-blue-600 font-semibold tabular-nums">
              {i + 1}
            </span>
            <span className="flex-1 truncate">{p.parameterLabel}</span>
            <span className="font-bold tabular-nums shrink-0">
              {p.count.toLocaleString("pt-BR")}
            </span>
          </button>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Um parâmetro que aparece aqui <em>e</em> na aba Planilha é a mesma
        história contada dos dois lados.
      </p>
    </div>
  );
}

/**
 * O que os chamados custaram, por parâmetro.
 *
 * Só entra aqui o que tem impacto apurado — e a linha do rodapé diz quantas
 * alterações ficaram de fora por não terem. Uma lista de "impactos relevantes"
 * que cala o tamanho do que não sabe medir é a que faz alguém concluir que o
 * resto é zero.
 */
function ImpactosRelevantes({
  itens,
  selecionado,
  naoApuradas,
  onSelecionar,
}: {
  itens: ParametroRollup[];
  selecionado: string;
  naoApuradas: number;
  onSelecionar: (parameterLabel: string) => void;
}) {
  const comImpacto = itens
    .filter((p) => p.impactSum !== null && p.impactSum !== 0)
    .sort((a, b) => Math.abs(b.impactSum ?? 0) - Math.abs(a.impactSum ?? 0))
    .slice(0, 5);

  return (
    <div className="p-6">
      <TituloDePainel icone={<DollarSign className="w-5 h-5" />}>
        Impactos relevantes
      </TituloDePainel>

      {comImpacto.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Nenhum parâmetro deste envio tem impacto apurado. Não quer dizer que
          os chamados não custaram nada — quer dizer que o valor pedido e o
          aplicado não permitiram apurar a diferença.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {comImpacto.map((p) => {
            const soma = p.impactSum ?? 0;
            const perda = soma < 0;
            return (
              <button
                key={`${p.parameterLabel}-${p.attributeCode}`}
                onClick={() => onSelecionar(p.parameterLabel)}
                title={`filtrar a lista por ${p.parameterLabel}`}
                className={cn(
                  "w-full flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors",
                  perda ? "bg-red-50 hover:bg-red-100" : "bg-emerald-50 hover:bg-emerald-100",
                  selecionado === p.parameterLabel &&
                    (perda ? "ring-1 ring-red-300" : "ring-1 ring-emerald-300"),
                )}
              >
                <span
                  className={cn(
                    "h-8 w-8 rounded-full grid place-content-center shrink-0 bg-card border",
                    perda ? "text-red-600 border-red-200" : "text-emerald-600 border-emerald-200",
                  )}
                >
                  {perda ? (
                    <ArrowDown className="w-4 h-4" />
                  ) : (
                    <ArrowUp className="w-4 h-4" />
                  )}
                </span>
                <span className="flex-1 truncate">{p.parameterLabel}</span>
                <span
                  className={cn(
                    "font-bold tabular-nums shrink-0",
                    perda ? "text-red-600" : "text-emerald-700",
                  )}
                >
                  {soma > 0 ? "+" : ""}
                  {brl0(soma)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {naoApuradas > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {naoApuradas.toLocaleString("pt-BR")} alterações não têm impacto
          apurado e não entram nesta lista.
        </p>
      )}
    </div>
  );
}

/**
 * Onde as alterações da planilha se concentram.
 *
 * Contagem, e só contagem: é a pergunta "o que mais mexeram", que não tem nada
 * a ver com "o que mais custou" — o painel ao lado responde essa, e os dois
 * quase nunca têm o mesmo primeiro colocado. É o mesmo par de leituras da aba
 * Chamados, sobre a mesma frota, por um caminho diferente.
 */
function AtributosMaisAlterados({
  itens,
  selecionado,
  onSelecionar,
}: {
  itens: AttributeRollup[];
  selecionado: string;
  onSelecionar: (attributeCode: string) => void;
}) {
  const topo = [...itens].sort((a, b) => b.count - a.count).slice(0, 5);

  return (
    <div className="p-6">
      <TituloDePainel icone={<BarChart3 className="w-5 h-5" />}>
        Atributos mais alterados
      </TituloDePainel>

      <div className="mt-4">
        {topo.map((a, i) => (
          <button
            key={a.attributeCode}
            onClick={() => onSelecionar(a.attributeCode)}
            title={`filtrar a lista por ${a.attributeCode}`}
            className={cn(
              "w-full flex items-center gap-4 px-2 py-3 text-left border-b last:border-b-0 rounded-md transition-colors",
              selecionado === a.attributeCode
                ? "bg-blue-50 text-blue-800"
                : "hover:bg-muted/50",
            )}
          >
            <span className="w-4 shrink-0 text-blue-600 font-semibold tabular-nums">
              {i + 1}
            </span>
            <span className="flex-1 truncate">
              {a.attributeName ?? a.attributeCode}
            </span>
            <span className="font-bold tabular-nums shrink-0">
              {a.count.toLocaleString("pt-BR")}
            </span>
          </button>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Um atributo que aparece aqui <em>e</em> na aba Chamados é a mesma
        história contada dos dois lados.
      </p>
    </div>
  );
}

/**
 * O que a vigência custou, por atributo.
 *
 * Uma linha por atributo **e periodicidade**, e não por atributo: um mesmo
 * atributo com impacto mensal e anual são duas quantias que não se somam, e
 * fundi-las para caber numa linha só produziria o número que este produto
 * existe para não deixar passar.
 *
 * Só entra aqui o que tem preço apurado — e o rodapé diz quantas alterações
 * ficaram de fora por não terem. Uma lista de "impactos relevantes" que cala o
 * tamanho do que não sabe medir é a que faz alguém concluir que o resto é zero.
 */
function ImpactosPorAtributo({
  itens,
  selecionado,
  naoApuradas,
  onSelecionar,
}: {
  itens: AttributeRollup[];
  selecionado: string;
  naoApuradas: number;
  onSelecionar: (attributeCode: string) => void;
}) {
  const comImpacto = itens
    .flatMap((a) => a.impact.map((i) => ({ atributo: a, ...i })))
    .filter((linha) => linha.amount !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 5);

  return (
    <div className="p-6">
      <TituloDePainel icone={<DollarSign className="w-5 h-5" />}>
        Impactos relevantes
      </TituloDePainel>

      {comImpacto.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Nenhum atributo desta comparação tem impacto apurado. Não quer dizer
          que a vigência não custou nada — quer dizer que a semântica dos
          atributos que mudaram ainda não permite pôr preço na diferença.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {comImpacto.map((linha) => {
            const perda = linha.amount < 0;
            const { atributo } = linha;
            return (
              <button
                key={`${atributo.attributeCode}-${linha.periodicity}`}
                onClick={() => onSelecionar(atributo.attributeCode)}
                title={`filtrar a lista por ${atributo.attributeCode}`}
                className={cn(
                  "w-full flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors",
                  perda ? "bg-red-50 hover:bg-red-100" : "bg-emerald-50 hover:bg-emerald-100",
                  selecionado === atributo.attributeCode &&
                    (perda ? "ring-1 ring-red-300" : "ring-1 ring-emerald-300"),
                )}
              >
                <span
                  className={cn(
                    "h-8 w-8 rounded-full grid place-content-center shrink-0 bg-card border",
                    perda ? "text-red-600 border-red-200" : "text-emerald-600 border-emerald-200",
                  )}
                >
                  {perda ? (
                    <ArrowDown className="w-4 h-4" />
                  ) : (
                    <ArrowUp className="w-4 h-4" />
                  )}
                </span>
                <span className="flex-1 truncate">
                  {atributo.attributeName ?? atributo.attributeCode}
                </span>
                <span
                  className={cn(
                    "font-bold tabular-nums shrink-0",
                    perda ? "text-red-600" : "text-emerald-700",
                  )}
                >
                  {linha.amount > 0 ? "+" : ""}
                  {brl0(linha.amount)}
                  <span className="ml-1 text-xs font-medium text-muted-foreground">
                    /{linha.periodicity.toLowerCase()}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {naoApuradas > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {naoApuradas.toLocaleString("pt-BR")} alterações não têm impacto
          apurado e não entram nesta lista.
        </p>
      )}
    </div>
  );
}
