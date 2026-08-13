import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch, useLocation } from "wouter";
import { AlertTriangle, ChevronLeft, Info, Lock, Search, Star } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { GroupCard } from "@/components/inicio/group-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useFavoritos } from "@/lib/favoritos";
import { formatBrlShort, impactEntries, periodicitySuffix } from "@/lib/format";
import type {
  FamiliesView,
  FamilyView,
  ImpactSummary,
  ParameterView,
} from "@/components/inicio/types";

/**
 * Escolha de segmento — a tela do Freightech, com o dado que ele não mostra.
 *
 * Tudo o que a mão já sabe fazer continua igual: os quatro campos na ordem
 * **Canal/Segmento → Vigência → Unidade → Parâmetro**, o botão FILTRAR que só
 * acende quando há o que aplicar, as seções em caixa alta com a régua laranja,
 * a grade de cartões com a barra na lateral e a estrela de favorito.
 *
 * O que muda é o que está escrito dentro do cartão. No Freightech ele traz o
 * nome do parâmetro e nada mais — para descobrir se algo mudou é preciso abrir,
 * exportar e comparar à mão. Aqui cada cartão já diz **quantas alterações, em
 * quantos veículos e quanto isso vale**; e quando não dá para valorar, diz o
 * motivo em vez de mostrar um traço.
 *
 * Três recusas que a fidelidade visual não afrouxa:
 *
 * 1. **Nunca somar periodicidades.** R$/mês e R$/ano em linhas próprias, sempre.
 * 2. **Nunca um cartão vazio.** O que o Freightech publica e este export não
 *    traz vira nota de rodapé, não cartão que promete assunto sem dado.
 * 3. **Nunca "impacto a verificar".** Sem preço é sem preço, com o motivo junto.
 */
export default function Parametros() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);

  const query = new URLSearchParams();
  for (const key of ["period", "scopeHash", "canal"]) {
    const value = params.get(key);
    if (value !== null) query.set(key, value);
  }

  const parametroAberto = params.get("parametro");

  /**
   * A busca por nome de parâmetro fica aqui, e não dentro da grade, porque o
   * campo dela mora na barra de filtro — que é irmã da grade, não filha.
   */
  const [busca, setBusca] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["families", query.toString()],
    queryFn: async () => {
      const suffix = query.toString() ? `?${query}` : "";
      const response = await fetch(getApiUrl(`/changes/families${suffix}`));
      if (!response.ok) throw new Error((await response.json()).error ?? "Falha ao carregar");
      return (await response.json()) as FamiliesView;
    },
  });

  const aplicar = (selecao: { scopeHash: string; canal: string | null; period: string }) => {
    const next = new URLSearchParams();
    next.set("scopeHash", selecao.scopeHash);
    if (selecao.canal) next.set("canal", selecao.canal);
    if (selecao.period) next.set("period", selecao.period);
    navigate(`/parametros?${next}`);
  };

  const abrirParametro = (chave: string | null) => {
    const next = new URLSearchParams(search);
    if (chave) next.set("parametro", chave);
    else next.delete("parametro");
    navigate(`/parametros?${next}`);
  };

  const parametro = useMemo(() => {
    if (!data || !parametroAberto) return null;
    for (const familia of data.families) {
      const encontrado = familia.parameters.find((p) => p.key === parametroAberto);
      if (encontrado) return { familia, parametro: encontrado };
    }
    return null;
  }, [data, parametroAberto]);

  return (
    <Layout>
      <div className="px-10 py-8 max-w-[1600px]">
        <h1 className="text-3xl font-bold uppercase tracking-tight">Escolha de segmento</h1>

        {data && (
          <BarraFiltro
            view={data}
            onFiltrar={aplicar}
            busca={busca}
            onBuscar={setBusca}
            buscaAtiva={!parametro}
          />
        )}

        {isLoading && <p className="mt-8 text-sm text-muted-foreground">Carregando…</p>}
        {error && (
          <div className="mt-8 bg-card border border-l-[6px] border-l-brand-red px-6 py-4 text-sm">
            {(error as Error).message}
          </div>
        )}

        {data && parametro && (
          <DetalheParametro
            familia={parametro.familia}
            parametro={parametro.parametro}
            period={data.period}
            onVoltar={() => abrirParametro(null)}
          />
        )}

        {data && !parametro && (
          <Grade view={data} busca={busca} onAbrir={(chave) => abrirParametro(chave)} />
        )}
      </div>
    </Layout>
  );
}

/**
 * Os quatro campos e o botão, na ordem e no formato do Freightech.
 *
 * O botão FILTRAR fica apagado enquanto a seleção na tela for igual à aplicada
 * — é o mesmo comportamento de lá, e ele é honesto: clicar não faria nada. O
 * campo Parâmetro, que lá só habilita depois de filtrar, aqui filtra a grade em
 * tempo real, porque a grade já está na tela e não custa uma viagem ao servidor.
 *
 * Campo com uma opção só aparece preenchido e desabilitado, com a razão escrita
 * embaixo: um seletor de um item é promessa de variedade que o dado não tem.
 */
function BarraFiltro({
  view,
  onFiltrar,
  busca,
  onBuscar,
  buscaAtiva,
}: {
  view: FamiliesView;
  onFiltrar: (selecao: { scopeHash: string; canal: string | null; period: string }) => void;
  busca: string;
  onBuscar: (valor: string) => void;
  /** Com um parâmetro aberto não há grade para filtrar; o campo desabilita. */
  buscaAtiva: boolean;
}) {
  const contextos = [view.context, ...view.otherContexts];
  const unidades = [...new Map(contextos.map((c) => [c.scopeHash, c])).values()];

  const [scopeHash, setScopeHash] = useState(view.context.scopeHash);
  const [canal, setCanal] = useState<string | null>(view.context.channel);
  const [period, setPeriod] = useState(view.period);

  // A resposta manda: trocar de unidade pela URL tem de refletir nos campos.
  useEffect(() => {
    setScopeHash(view.context.scopeHash);
    setCanal(view.context.channel);
    setPeriod(view.period);
  }, [view.context.scopeHash, view.context.channel, view.period]);

  const canais = contextos.filter((c) => c.scopeHash === scopeHash);
  const sujo =
    scopeHash !== view.context.scopeHash ||
    canal !== view.context.channel ||
    period !== view.period;

  return (
    <div className="mt-6 flex flex-wrap items-end gap-4">
      <Campo
        rotulo="Canal/Segmento"
        nota={canais.length > 1 ? null : "único canal importado"}
      >
        {canais.length > 1 ? (
          <Select value={canal ?? ""} onValueChange={(valor) => setCanal(valor || null)}>
            <SelectTrigger className="w-56 h-12 rounded-sm bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {canais.map((c) => (
                <SelectItem key={c.channel ?? "sem-canal"} value={c.channel ?? ""}>
                  {c.channel ?? "sem canal no rótulo"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <CampoFixo valor={canal ?? "sem canal no rótulo"} largura="w-56" />
        )}
      </Campo>

      <Campo rotulo="Vigência" nota={`${view.periods.length} no histórico`}>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-56 h-12 rounded-sm bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {view.periods.map((p) => (
              <SelectItem key={p.date} value={p.date}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Campo>

      <Campo
        rotulo="Unidade"
        nota={unidades.length > 1 ? null : "única unidade importada"}
      >
        {unidades.length > 1 ? (
          <Select
            value={scopeHash}
            onValueChange={(valor) => {
              setScopeHash(valor);
              setCanal(contextos.find((c) => c.scopeHash === valor)?.channel ?? null);
            }}
          >
            <SelectTrigger className="w-56 h-12 rounded-sm bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {unidades.map((c) => (
                <SelectItem key={c.scopeHash} value={c.scopeHash}>
                  {nomeDaUnidade(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <CampoFixo valor={nomeDaUnidade(view.context)} largura="w-56" />
        )}
      </Campo>

      <button
        type="button"
        disabled={!sujo}
        onClick={() => onFiltrar({ scopeHash, canal, period })}
        className={cn(
          "h-12 px-8 rounded-sm text-[13px] font-bold uppercase tracking-wide transition-colors",
          sujo
            ? "bg-brand text-brand-foreground hover:brightness-95"
            : "bg-brand/40 text-white cursor-not-allowed",
        )}
      >
        Filtrar
      </button>

      <Campo rotulo="Parametro" nota={null}>
        <div className="relative">
          <input
            value={busca}
            disabled={!buscaAtiva}
            onChange={(event) => onBuscar(event.target.value)}
            aria-label="Buscar parâmetro pelo nome"
            className="w-60 h-12 rounded-sm border border-input bg-card pl-3 pr-10 text-sm outline-none focus:border-brand disabled:bg-muted/60"
          />
          <Search className="w-5 h-5 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </Campo>
    </div>
  );
}

function Campo({
  rotulo,
  nota,
  children,
}: {
  rotulo: string;
  nota: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-sm text-muted-foreground mb-1.5">{rotulo}</div>
      {children}
      {nota && <div className="text-[11px] text-muted-foreground mt-1">{nota}</div>}
    </div>
  );
}

function CampoFixo({ valor, largura }: { valor: string; largura: string }) {
  return (
    <div
      className={cn(
        "h-12 rounded-sm border border-input bg-muted/60 px-3 flex items-center text-sm truncate",
        largura,
      )}
    >
      {valor}
    </div>
  );
}

function nomeDaUnidade(context: FamiliesView["context"]): string {
  const unidade = context.scopes.find((s) => s.scopeType === "UNIDADE");
  return unidade?.name ?? unidade?.code ?? context.scopeHash;
}

/**
 * A grade: um bloco por família, cartões de quatro em quatro.
 *
 * Os favoritos sobem para um bloco próprio no topo, como no Freightech — quem
 * marcou cinco parâmetros não quer rolar a página inteira todo dia para achá-los.
 */
function Grade({
  view,
  busca,
  onAbrir,
}: {
  view: FamiliesView;
  busca: string;
  onAbrir: (chave: string) => void;
}) {
  const { favoritos, alternar } = useFavoritos();

  const termo = normalizar(busca.trim());
  const familias = view.families
    .map((familia) => ({
      ...familia,
      parameters: termo
        ? familia.parameters.filter((p) => normalizar(p.name).includes(termo))
        : familia.parameters,
    }))
    .filter((familia) => familia.parameters.length > 0);

  const marcados = view.families
    .flatMap((f) => f.parameters.map((p) => ({ familia: f, parametro: p })))
    .filter((item) => favoritos.includes(item.parametro.key))
    .filter((item) => !termo || normalizar(item.parametro.name).includes(termo));

  return (
    <>
      <div className="mt-8">
        <Resumo view={view} />
      </div>

      {!view.complete && (
        <div className="mt-6 bg-card border border-l-[6px] border-l-brand flex gap-3 px-6 py-4 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-brand" />
          <p>
            <strong>Visão parcial.</strong> Nesta vigência chegou apenas{" "}
            {view.series.map((s) => s.equipment.toLowerCase()).join(", ")}. Falta{" "}
            <strong>{view.missingSeries.join(", ").toLowerCase()}</strong> — a série
            ausente não está contada como zero.
          </p>
        </div>
      )}

      {marcados.length > 0 && (
        <Secao titulo="Favoritos">
          {marcados.map(({ familia, parametro }) => (
            <CartaoParametro
              key={`fav-${parametro.key}`}
              parametro={parametro}
              familia={familia}
              favorito
              onFavoritar={() => alternar(parametro.key)}
              onAbrir={() => onAbrir(parametro.key)}
            />
          ))}
        </Secao>
      )}

      {familias.length === 0 && (
        <p className="mt-10 text-sm text-muted-foreground">
          Nenhum parâmetro com esse nome nesta vigência.
        </p>
      )}

      {familias.map((familia) => (
        <Secao
          key={familia.code}
          titulo={familia.name}
          origem={familia.origin}
          nota={familia.note}
          resumo={
            familia.changes === 0
              ? "Sem alterações nesta vigência."
              : `${familia.parametersChanged} de ${familia.parametersWithData} ${
                  familia.parametersWithData === 1 ? "parâmetro" : "parâmetros"
                } · ${familia.changes} ${
                  familia.changes === 1 ? "alteração" : "alterações"
                } · ${familia.vehicles} ${familia.vehicles === 1 ? "veículo" : "veículos"}`
          }
          travados={familia.locked}
        >
          {familia.parameters.map((parametro) => (
            <CartaoParametro
              key={parametro.key}
              parametro={parametro}
              familia={familia}
              favorito={favoritos.includes(parametro.key)}
              onFavoritar={() => alternar(parametro.key)}
              onAbrir={() => onAbrir(parametro.key)}
            />
          ))}
        </Secao>
      ))}

      <Rodape view={view} />
    </>
  );
}

/** O título de seção do Freightech: caixa alta, negrito, régua laranja embaixo. */
function Secao({
  titulo,
  origem,
  nota,
  resumo,
  travados,
  children,
}: {
  titulo: string;
  origem?: "FREIGHTECH" | "FREIGHTCHECK";
  nota?: string;
  resumo?: string;
  travados?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-bold uppercase tracking-wide">{titulo}</h2>
        {origem && (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground border rounded-full px-2 py-0.5">
            {origem === "FREIGHTECH" ? "Freightech" : "FreightCheck"}
          </span>
        )}
        {resumo && <span className="text-xs text-muted-foreground">{resumo}</span>}
        {travados ? (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <Lock className="w-3 h-3" />
            {travados} com preço travado
          </span>
        ) : null}
      </div>
      <div className="border-b-2 border-brand mt-2" />
      {nota && <p className="text-xs text-muted-foreground mt-3">{nota}</p>}
      <div className="grid gap-6 mt-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {children}
      </div>
    </section>
  );
}

/**
 * O cartão do Freightech: barra laranja na lateral esquerda, nome em caixa
 * alta, estrela no rodapé. O miolo entre os dois é o que este produto acrescenta.
 */
function CartaoParametro({
  parametro,
  familia,
  favorito,
  onFavoritar,
  onAbrir,
}: {
  parametro: ParameterView;
  familia: FamilyView;
  favorito: boolean;
  onFavoritar: () => void;
  onAbrir: () => void;
}) {
  const mudou = parametro.changes > 0;

  return (
    <div className="bg-card border border-l-[5px] border-l-brand shadow-sm hover:shadow-md transition-shadow flex flex-col">
      <button
        type="button"
        onClick={onAbrir}
        className="text-left px-5 pt-5 pb-3 flex-1 flex flex-col gap-2"
      >
        <span className="text-[15px] font-semibold uppercase tracking-wide leading-snug">
          {parametro.name}
        </span>
        <span className="text-xs text-muted-foreground">{familia.name}</span>

        <span className="text-sm mt-1">
          {mudou ? (
            <ImpactoResumido impact={parametro.impact} className="block" />
          ) : (
            <span className="text-xs text-muted-foreground">
              Sem alterações nesta vigência
            </span>
          )}
        </span>

        {mudou && (
          <span className="text-xs text-muted-foreground">
            {parametro.changes} {parametro.changes === 1 ? "alteração" : "alterações"} ·{" "}
            {parametro.vehicles} {parametro.vehicles === 1 ? "veículo" : "veículos"}
          </span>
        )}

        {parametro.pending && (
          <span className="text-xs text-brand-red flex gap-1.5 mt-1">
            <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
            {parametro.pending}
          </span>
        )}
      </button>

      <div className="px-4 pb-3">
        <button
          type="button"
          onClick={onFavoritar}
          aria-pressed={favorito}
          aria-label={favorito ? "Remover dos favoritos" : "Marcar como favorito"}
          title={favorito ? "Remover dos favoritos" : "Marcar como favorito"}
          className="p-1 -ml-1 text-brand hover:scale-110 transition-transform"
        >
          <Star className="w-7 h-7" strokeWidth={1.5} fill={favorito ? "currentColor" : "none"} />
        </button>
      </div>
    </div>
  );
}

/**
 * O parâmetro aberto — a página que o Freightech abre depois do FILTRAR, com o
 * que ele mostra lá dentro (o valor) e o que ele não mostra (o que mudou nele).
 */
function DetalheParametro({
  familia,
  parametro,
  period,
  onVoltar,
}: {
  familia: FamilyView;
  parametro: ParameterView;
  period: string;
  onVoltar: () => void;
}) {
  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={onVoltar}
        className="inline-flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wide text-brand hover:underline"
      >
        <ChevronLeft className="w-4 h-4" />
        Todos os parâmetros
      </button>

      <div className="mt-4 bg-card border border-l-[5px] border-l-brand px-7 py-6">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {familia.name}
        </div>
        <h2 className="text-2xl font-bold uppercase tracking-tight mt-1">
          {parametro.name}
        </h2>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3 text-sm">
          <ImpactoResumido impact={parametro.impact} />
          <span className="text-muted-foreground">
            {parametro.changes} {parametro.changes === 1 ? "alteração" : "alterações"} ·{" "}
            {parametro.vehicles} {parametro.vehicles === 1 ? "veículo" : "veículos"}
          </span>
        </div>
        {parametro.pending && (
          <p className="text-sm text-brand-red flex gap-2 mt-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            {parametro.pending}
          </p>
        )}
      </div>

      <div className="mt-6 space-y-3">
        {parametro.groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma alteração neste parâmetro nesta vigência.
          </p>
        ) : (
          parametro.groups.map((group) => (
            <GroupCard key={group.key} group={group} period={period} />
          ))
        )}
      </div>
    </div>
  );
}

/** O resumo executivo, compactado para caber ao lado da busca. */
function Resumo({ view }: { view: FamiliesView }) {
  const { summary } = view;
  const liquido = impactEntries(summary.impact.byPeriodicity);

  return (
    <div className="min-w-0">
      <p className="text-lg">
        {summary.changes === 0 ? (
          <>O cliente não mexeu em nada nesta vigência.</>
        ) : (
          <>
            O cliente mexeu em <strong>{summary.groups}</strong>{" "}
            {summary.groups === 1 ? "ponto" : "pontos"} da sua remuneração, em{" "}
            <strong>{view.families.filter((f) => f.changes > 0).length}</strong>{" "}
            {view.families.filter((f) => f.changes > 0).length === 1
              ? "família"
              : "famílias"}
            .
          </>
        )}
      </p>

      {liquido.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 mt-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Impacto líquido
          </span>
          {liquido.map((e) => (
            <span
              key={e.periodicity}
              className={cn(
                "text-2xl font-bold tabular-nums",
                e.amount < 0 ? "text-brand-red" : "text-success",
              )}
            >
              {formatBrlShort(e.amount)}
              <span className="text-sm font-normal text-muted-foreground">
                {periodicitySuffix(e.periodicity)}
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground mt-2">
        <span>
          <strong className="text-foreground">{summary.changes}</strong> alterações
        </span>
        <span>
          <strong className="text-foreground">{summary.critical}</strong> críticas
        </span>
        <span>
          <strong className="text-foreground">{summary.locked}</strong> com preço travado
        </span>
        <span>
          <strong className="text-foreground">{summary.notCalculable}</strong> sem preço
        </span>
        <span>
          <strong className="text-foreground">{summary.vehiclesTouched}</strong> veículos
          tocados
        </span>
      </div>

      {impactEntries(summary.impact.excludedByPeriodicity).length > 0 && (
        <p className="text-xs text-muted-foreground flex gap-2 mt-2 max-w-2xl">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            {impactEntries(summary.impact.excludedByPeriodicity)
              .map((e) => e.label)
              .join(" · ")}{" "}
            ficaram fora do líquido por já estarem contados nas parcelas —{" "}
            {summary.impact.excludedChanges}{" "}
            {summary.impact.excludedChanges === 1 ? "alteração" : "alterações"}.
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * O impacto dito pelo motivo certo. Três estados diferentes de "sem número", e
 * confundi-los seria mentir com a melhor das intenções:
 *
 * - **tem impacto** → os valores, um por periodicidade;
 * - **já contado nas parcelas** → o valor existe e é calculável, mas somá-lo de
 *   novo inflaria o total;
 * - **não calculável** → aí sim, e o cartão de dentro traz o motivo por escrito.
 */
function ImpactoResumido({
  impact,
  className,
}: {
  impact: ImpactSummary;
  className?: string;
}) {
  const entries = impactEntries(impact.byPeriodicity);
  if (entries.length > 0) {
    return (
      <>
        {entries.map((e) => (
          <span
            key={e.periodicity}
            className={cn(
              "font-bold tabular-nums",
              e.amount < 0 ? "text-brand-red" : "text-success",
              className,
            )}
          >
            {e.label}
          </span>
        ))}
      </>
    );
  }

  const excluded = impactEntries(impact.excludedByPeriodicity);
  if (excluded.length > 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {excluded.map((e) => e.label).join(" · ")} — já contado nas parcelas
      </span>
    );
  }

  if (impact.notCalculable > 0) {
    return <span className="text-xs text-muted-foreground">Impacto não calculável</span>;
  }
  return <span className="text-xs text-muted-foreground">Sem impacto apurado</span>;
}

/**
 * O que o Freightech publica e este export não traz. Fica no rodapé, escrito,
 * em vez de virar 25 cartões vazios.
 */
function Rodape({ view }: { view: FamiliesView }) {
  if (view.freightechSemDado.length === 0) return null;
  return (
    <footer className="mt-12 border-t pt-6 text-sm text-muted-foreground space-y-2">
      <p className="max-w-4xl">
        O Freightech também publica{" "}
        <strong>{view.freightechSemDado.map((f) => f.family).join(", ")}</strong>. Esses
        parâmetros não vêm no export de equipamento que o FreightCheck recebe hoje, e por
        isso não aparecem acima — um cartão vazio prometeria um assunto que este produto
        ainda não pode auditar.
      </p>
      <details>
        <summary className="cursor-pointer text-xs hover:text-foreground">
          ver a lista completa
        </summary>
        <ul className="mt-2 space-y-1 text-xs">
          {view.freightechSemDado.map((f) => (
            <li key={f.family}>
              <strong>{f.family}:</strong> {f.parameters.join(" · ")}
            </li>
          ))}
        </ul>
      </details>
    </footer>
  );
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
