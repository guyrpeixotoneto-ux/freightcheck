import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Layers,
  TriangleAlert,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { getApiUrl } from "@/lib/api";
import { formatBrl, formatBrlShort, formatValue, periodicitySuffix } from "@/lib/format";
import {
  paramsDoRecorte,
  paramsDosVeiculosDoGrupo,
  type Recorte,
} from "@/lib/recorte";
import { useLinkDeAlteracoes } from "@/lib/tipo-da-linha-do-tempo";
import type { Movimentos, RangeEntry } from "@/lib/analise";
import type { GroupVehicle } from "@/components/inicio/types";

/**
 * A gaveta dos números do intervalo — o mesmo endereço que `DetalheDoImpacto`
 * abre em Visão geral, para os dois números que a Linha do tempo publica e que
 * não valem para uma vigência só: o líquido consolidado, e cada linha de
 * "Atributos de maior impacto".
 *
 * A diferença que obriga um componente próprio: ambos são **somas do
 * intervalo inteiro**, não de uma vigência. Um clique que caísse direto na
 * Planilha filtraria por uma vigência que a soma já deixou de ser — por isso
 * o painel primeiro decompõe o número vigência a vigência, e só then oferece o
 * link para cada uma delas, igual à leitura que a `BarraDaPeriodicidade` já
 * mostra na tela de trás.
 *
 * Nada aqui pede dado novo ao servidor: tudo sai de `dados` (a resposta de
 * `/changes/range`) que a tela já tem em memória.
 */
export type AberturaDoIntervalo =
  | { tipo: "parametro"; parameterKey: string; periodicidade: string }
  | { tipo: "consolidado"; periodicidade: string }
  /** Uma vigência da linha do tempo — o que somou e o que tirou naquele mês. */
  | { tipo: "vigencia"; period: string; periodicidade: string };

export function DetalheDoIntervalo({
  abertura,
  dados,
  recorteBase,
  onFechar,
  onAbrirParametro,
}: {
  abertura: AberturaDoIntervalo | null;
  dados: Movimentos;
  recorteBase: Recorte;
  onFechar: () => void;
  onAbrirParametro: (parameterKey: string, periodicidade: string) => void;
}) {
  if (!abertura) return null;

  return (
    <Sheet open onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col gap-0">
        {abertura.tipo === "parametro" ? (
          <DetalheDoParametro
            dados={dados}
            recorteBase={recorteBase}
            parameterKey={abertura.parameterKey}
            periodicidade={abertura.periodicidade}
          />
        ) : abertura.tipo === "vigencia" ? (
          <DetalheDaVigencia
            dados={dados}
            recorteBase={recorteBase}
            period={abertura.period}
            periodicidade={abertura.periodicidade}
          />
        ) : (
          <DetalheDoConsolidado
            dados={dados}
            periodicidade={abertura.periodicidade}
            onAbrirParametro={onAbrirParametro}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetalheDoParametro({
  dados,
  recorteBase,
  parameterKey,
  periodicidade,
}: {
  dados: Movimentos;
  recorteBase: Recorte;
  parameterKey: string;
  periodicidade: string;
}) {
  const rollup = dados.byParameter.find((p) => p.parameterKey === parameterKey);
  const entradas = dados.entries.filter(
    (e) => e.parameterKey === parameterKey && e.periodicity === periodicidade,
  );
  const attributeCode = entradas.find((e) => e.attributeCode)?.attributeCode ?? null;
  const valor = rollup?.impact.byPeriodicity[periodicidade] ?? 0;
  const negativo = valor < 0;

  const porVigencia = new Map<
    string,
    { label: string; valor: number; changes: number; entradas: RangeEntry[] }
  >();
  let semPreco = 0;
  for (const entrada of entradas) {
    if (entrada.amount === null) {
      semPreco += 1;
      continue;
    }
    const atual = porVigencia.get(entrada.period) ?? {
      label: entrada.periodLabel,
      valor: 0,
      changes: 0,
      entradas: [],
    };
    atual.valor += entrada.amount;
    atual.changes += 1;
    atual.entradas.push(entrada);
    porVigencia.set(entrada.period, atual);
  }
  const linhas = [...porVigencia.entries()].sort(([a], [b]) => a.localeCompare(b));
  const teto = Math.max(...linhas.map(([, l]) => Math.abs(l.valor)), 1);

  return (
    <>
      <header className="px-7 pt-7 pb-5 border-b shrink-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {rollup?.familyName ?? ""}
        </p>
        <SheetTitle className="text-2xl font-extrabold tracking-tight mt-1 pr-8">
          {rollup?.parameterName ?? parameterKey}
        </SheetTitle>

        <p
          className={cn(
            "text-[2rem] font-extrabold tabular-nums leading-none mt-4",
            negativo ? "text-red-700" : "text-emerald-700",
          )}
        >
          {formatBrlShort(valor)}
          <span className="text-base font-semibold text-muted-foreground">
            {periodicitySuffix(periodicidade)}
          </span>
        </p>

        <SheetDescription className="mt-2.5 max-w-xl leading-snug">
          {negativo ? "Quanto este parâmetro tirou" : "Quanto este parâmetro somou"} entre{" "}
          {dados.fromLabel} e {dados.toLabel} — a soma das vigências abaixo.
        </SheetDescription>
      </header>

      <div className="flex-1 overflow-y-auto px-7 py-6 space-y-6">
        <section>
          <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
            <Layers className="w-4 h-4 text-muted-foreground" />
            Por vigência
          </h3>
          <div className="mt-3 space-y-1.5">
            {linhas.map(([period, linha]) => (
              <LinhaDaVigencia
                key={period}
                period={period}
                linha={linha}
                teto={teto}
                recorteBase={recorteBase}
                attributeCode={attributeCode}
                parameterName={rollup?.parameterName ?? null}
              />
            ))}
          </div>
        </section>

        {semPreco > 0 && (
          <p className="flex gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3">
            <TriangleAlert className="w-4 h-4 shrink-0 mt-px" />
            <span>
              {contar(semPreco, "alteração", "alterações")} deste parâmetro sem preço apurado —
              não entram na soma acima.
            </span>
          </p>
        )}
      </div>
    </>
  );
}

/**
 * Uma vigência da lista "Por vigência" — a barra de sempre, e por baixo dela
 * os veículos/equipamentos que compõem o valor daquele mês, um por grupo.
 *
 * O clique na barra continua abrindo a Planilha filtrada, como sempre; o
 * chevron é quem abre e fecha a relação, para não obrigar quem só quer
 * comparar meses a rolar por uma lista de placas que não pediu.
 */
function LinhaDaVigencia({
  period,
  linha,
  teto,
  recorteBase,
  attributeCode,
  parameterName,
}: {
  period: string;
  linha: { label: string; valor: number; changes: number; entradas: RangeEntry[] };
  teto: number;
  recorteBase: Recorte;
  attributeCode: string | null;
  parameterName: string | null;
}) {
  const [aberto, setAberto] = useState(false);
  const link = useLinkDeAlteracoes();
  const grupos = [...linha.entradas].sort(
    (a, b) => Math.abs((b.amount ?? 0)) - Math.abs((a.amount ?? 0)),
  );

  /*
    O corpo da linha é o mesmo com link e sem: o que muda é a etiqueta que o
    embrulha. Sem endereço em Alterações — a aba de trecho —, ele vira texto,
    e o cursor deixa de prometer um clique que não leva a lugar nenhum.
  */
  const rotuloDaVigencia = (
    <>
      <span className="truncate text-muted-foreground">{linha.label}</span>
      <span className="h-2 w-full block overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            "block h-full rounded-full",
            linha.valor < 0 ? "bg-red-600" : "bg-emerald-600",
          )}
          style={{ width: `${Math.max(4, (Math.abs(linha.valor) / teto) * 100)}%` }}
        />
      </span>
    </>
  );
  const classeDaVigencia =
    "col-span-2 grid items-center gap-3 px-1 -mx-1 py-1 rounded";
  const colunasDaVigencia = { gridTemplateColumns: "1fr 7rem" };

  return (
    <div className="rounded hover:bg-accent/60 transition-colors">
      <div className="grid grid-cols-[1.25rem_7rem_1fr_7rem] items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => setAberto(!aberto)}
          aria-label={aberto ? "Recolher veículos e equipamentos" : "Ver veículos e equipamentos"}
          className="text-muted-foreground hover:text-foreground"
        >
          {aberto ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        {link !== null ? (
          <Link
            href={link({
              recorte: { ...recorteBase, period },
              filtros: attributeCode ? { attributeCode } : {},
            })}
            aria-label={`Ver as alterações de ${parameterName ?? "este parâmetro"} em ${linha.label}`}
            title="Ver as alterações desta vigência"
            className={cn(classeDaVigencia, "hover:bg-accent transition-colors")}
            style={colunasDaVigencia}
          >
            {rotuloDaVigencia}
          </Link>
        ) : (
          <div className={classeDaVigencia} style={colunasDaVigencia}>
            {rotuloDaVigencia}
          </div>
        )}
        <span
          className={cn(
            "text-right tabular-nums text-xs font-semibold",
            linha.valor < 0 ? "text-red-700" : "text-emerald-700",
          )}
        >
          {formatBrlShort(linha.valor)}
        </span>
      </div>

      {aberto && (
        <div className="pl-6 pb-2 space-y-1">
          {grupos.length === 0 ? (
            <p className="text-xs text-muted-foreground py-1">
              Nenhum veículo ou equipamento apurado nesta vigência.
            </p>
          ) : (
            grupos.map((grupo) => (
              <div key={grupo.key} className="py-1.5 border-t first:border-t-0">
                <div className="grid grid-cols-[1fr_5rem_6rem] items-center gap-3 text-xs">
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-foreground">{grupo.title}</span>
                    <span className="text-muted-foreground"> — {grupo.equipment}</span>
                  </span>
                  <span className="text-muted-foreground text-right">
                    {contar(grupo.vehicles, "veículo", "veículos")}
                  </span>
                  <span
                    className={cn(
                      "text-right tabular-nums font-semibold",
                      (grupo.amount ?? 0) < 0 ? "text-red-700" : "text-emerald-700",
                    )}
                  >
                    {grupo.amount !== null ? formatBrlShort(grupo.amount) : "—"}
                  </span>
                </div>
                <PlacasDoGrupo period={period} entrada={grupo} recorte={recorteBase} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A relação de placas de um grupo — quem ganhou e quem perdeu, uma linha por
 * veículo.
 *
 * Busca o mesmo endpoint que o cartão de "De onde vem" usa em Visão geral
 * (`/changes/grouped/vehicles`), porque é o mesmo grupo — só muda de onde ele
 * é aberto. Carrega assim que a vigência é expandida, sem clique extra: é
 * exatamente a placa que quem está aqui veio ver.
 */
function PlacasDoGrupo({
  period,
  entrada,
  recorte,
}: {
  period: string;
  entrada: RangeEntry;
  /**
   * O mesmo recorte que produziu o total lá em cima.
   *
   * Sem ele a chamada abaixo não fica "sem filtro": o servidor cai em
   * `contexts[0]` — a unidade com a vigência mais recente — e a gaveta passava
   * a listar placas de outra unidade por baixo de um total que continuava certo,
   * porque `/changes/range` recebe o contexto e esta chamada não recebia. A
   * vigência daqui é `period`, a da linha aberta, e é ela que sobrescreve a do
   * recorte.
   */
  recorte: Recorte;
}) {
  const grupo = entrada.group;
  const contexto = paramsDoRecorte(recorte, { comPeriodo: false });
  const veiculos = useQuery({
    // O contexto entra na chave, e não só na URL: sem ele duas unidades na
    // mesma vigência dividiriam a mesma entrada de cache.
    queryKey: ["group-vehicles", period, grupo.key, contexto.toString()],
    queryFn: async () => {
      const params = paramsDosVeiculosDoGrupo(contexto, period, grupo);
      const response = await fetch(getApiUrl(`/changes/grouped/vehicles?${params}`));
      if (!response.ok) return [];
      return (await response.json()) as GroupVehicle[];
    },
  });

  if (veiculos.isLoading) {
    return <p className="text-xs text-muted-foreground py-1.5">Carregando placas…</p>;
  }
  if (!veiculos.data || veiculos.data.length === 0) {
    return null;
  }

  // Quem perdeu primeiro, quem ganhou por último — a ordem em que a
  // desconfiança normalmente pergunta "quem foi que perdeu mais".
  const linhas = [...veiculos.data].sort(
    (a, b) => (a.impactAmount ?? 0) - (b.impactAmount ?? 0),
  );

  return (
    <div className="mt-1.5 rounded border overflow-hidden">
      {linhas.map((veiculo) => (
        <div
          key={veiculo.changeId}
          className="px-2 py-1.5 border-t first:border-t-0 odd:bg-muted/20 text-xs"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono font-medium">{veiculo.plate ?? "—"}</span>
            <span
              className={cn(
                "text-right tabular-nums font-semibold whitespace-nowrap shrink-0",
                veiculo.foraDoTotal && "line-through opacity-60",
                veiculo.impactAmount === null
                  ? "text-muted-foreground font-normal"
                  : veiculo.impactAmount < 0
                    ? "text-red-700"
                    : "text-emerald-700",
              )}
              title={veiculo.foraDoTotal?.explicacao}
            >
              {veiculo.impactAmount !== null ? formatBrl(veiculo.impactAmount) : "sem preço"}
            </span>
          </div>
          <div className="text-muted-foreground font-mono tabular-nums mt-0.5">
            {veiculo.numericBefore !== null
              ? formatValue(veiculo.numericBefore, entrada.unit)
              : (veiculo.valueBefore ?? "—")}
            {" → "}
            {veiculo.numericAfter !== null
              ? formatValue(veiculo.numericAfter, entrada.unit)
              : (veiculo.valueAfter ?? "—")}
          </div>
          {veiculo.foraDoTotal && (
            <p className="text-[0.6875rem] text-amber-700 mt-0.5">
              Fora do total — {veiculo.foraDoTotal.explicacao}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Uma vigência da linha do tempo — o que somou e o que tirou naquele mês.
 *
 * É o degrau que faltava no clique. A coluna da linha do tempo diz "714
 * alterações, −R$ 302.261" e o clique ia direto para a Planilha: 714 linhas
 * cruas para responder uma pergunta que tem duas linhas de resposta — *o que*
 * puxou o mês para baixo, e o que puxou para cima. Aqui esse mês se abre em
 * dois lados, atributo a atributo, e a Planilha continua a um clique de
 * qualquer um deles (ou do rodapé, para a vigência inteira).
 *
 * O número do topo é o do motor (`movements[].impact`), o mesmo que a coluna
 * clicada mostra e que os cartões somam — já sem dupla contagem. As linhas
 * abaixo são os grupos apurados da vigência, somados por parâmetro: é a
 * decomposição do mesmo mês, na mesma régua que `DetalheDoParametro` usa do
 * outro eixo (um parâmetro, várias vigências).
 *
 * Nada aqui pede dado novo: tudo sai da resposta de `/changes/range` que a
 * tela já tem em memória.
 */
function DetalheDaVigencia({
  dados,
  recorteBase,
  period,
  periodicidade,
}: {
  dados: Movimentos;
  recorteBase: Recorte;
  period: string;
  periodicidade: string;
}) {
  const movimento = dados.movements.find((m) => m.period === period);
  const rotulo = movimento?.label ?? period;
  const liquido = movimento?.impact.byPeriodicity[periodicidade];
  const negativo = (liquido ?? 0) < 0;

  /*
    Um item por parâmetro, dentro desta vigência e desta periodicidade —
    R$/mês e R$/ano contam o mesmo mês de formas diferentes, e uma fila só com
    as duas somaria coisas que não se somam.
  */
  const porParametro = new Map<
    string,
    { parameterKey: string; nome: string; familia: string; valor: number; changes: number; attributeCode: string | null }
  >();
  let semValoracao = 0;
  for (const entrada of dados.entries) {
    if (entrada.period !== period) continue;
    if (entrada.amount === null || entrada.amount === 0 || entrada.periodicity !== periodicidade) {
      if (entrada.amount === null) semValoracao += 1;
      continue;
    }
    const atual = porParametro.get(entrada.parameterKey) ?? {
      parameterKey: entrada.parameterKey,
      nome: entrada.parameterName,
      familia: entrada.family,
      valor: 0,
      changes: 0,
      attributeCode: entrada.attributeCode,
    };
    atual.valor += entrada.amount;
    atual.changes += 1;
    porParametro.set(entrada.parameterKey, atual);
  }

  const link = useLinkDeAlteracoes();
  const itens = [...porParametro.values()];
  const positivos = itens.filter((i) => i.valor > 0).sort((a, b) => b.valor - a.valor);
  const negativos = itens.filter((i) => i.valor < 0).sort((a, b) => a.valor - b.valor);
  const teto = Math.max(...itens.map((i) => Math.abs(i.valor)), 1);
  const ganhos = positivos.reduce((soma, i) => soma + i.valor, 0);
  const perdas = negativos.reduce((soma, i) => soma + i.valor, 0);

  return (
    <>
      <header className="px-7 pt-7 pb-5 border-b shrink-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Vigência
        </p>
        <SheetTitle className="text-2xl font-extrabold tracking-tight mt-1 pr-8">
          {rotulo}
        </SheetTitle>

        {liquido === undefined ? (
          <p className="text-lg font-bold text-muted-foreground mt-4">Sem valoração</p>
        ) : (
          <p
            className={cn(
              "text-[2rem] font-extrabold tabular-nums leading-none mt-4",
              negativo ? "text-red-700" : "text-emerald-700",
            )}
          >
            {formatBrlShort(liquido)}
            <span className="text-base font-semibold text-muted-foreground">
              {periodicitySuffix(periodicidade)}
            </span>
          </p>
        )}

        <SheetDescription className="mt-2.5 max-w-xl leading-snug">
          {contar(movimento?.changes ?? 0, "alteração", "alterações")} nesta vigência —{" "}
          <span className="text-emerald-700 font-semibold">{formatBrlShort(ganhos)}</span> de ganho
          e <span className="text-red-700 font-semibold">{formatBrlShort(perdas)}</span> de perda,
          por atributo.
        </SheetDescription>
      </header>

      <div className="flex-1 overflow-y-auto px-7 py-6 space-y-6">
        <ColunaDaVigencia
          titulo="O que somou"
          ganho
          itens={positivos}
          teto={teto}
          period={period}
          rotulo={rotulo}
          recorteBase={recorteBase}
        />
        <ColunaDaVigencia
          titulo="O que tirou"
          ganho={false}
          itens={negativos}
          teto={teto}
          period={period}
          rotulo={rotulo}
          recorteBase={recorteBase}
        />

        {(movimento?.impact.notCalculable ?? semValoracao) > 0 && (
          <p className="flex gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3">
            <TriangleAlert className="w-4 h-4 shrink-0 mt-px" />
            <span>
              {contar(
                movimento?.impact.notCalculable ?? semValoracao,
                "alteração",
                "alterações",
              )}{" "}
              desta vigência sem impacto apurado — não estão nas listas acima, e não estão
              contadas como zero.
            </span>
          </p>
        )}

        {link !== null && (
          <Link
            href={link({ recorte: { ...recorteBase, period } })}
            aria-label={`Ver todas as alterações de ${rotulo}`}
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold hover:bg-accent transition-colors"
          >
            Ver todas as alterações desta vigência
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>
    </>
  );
}

/** Um dos dois lados da vigência — os atributos que somaram, ou os que tiraram. */
function ColunaDaVigencia({
  titulo,
  ganho,
  itens,
  teto,
  period,
  rotulo,
  recorteBase,
}: {
  titulo: string;
  ganho: boolean;
  itens: {
    parameterKey: string;
    nome: string;
    familia: string;
    valor: number;
    changes: number;
    attributeCode: string | null;
  }[];
  teto: number;
  period: string;
  rotulo: string;
  recorteBase: Recorte;
}) {
  const link = useLinkDeAlteracoes();

  return (
    <section>
      <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
        {ganho ? (
          <ArrowUpRight className="w-4 h-4 text-emerald-600" />
        ) : (
          <ArrowDownRight className="w-4 h-4 text-red-600" />
        )}
        {titulo}
      </h3>

      {itens.length === 0 ? (
        <p className="text-xs text-muted-foreground mt-2">
          Nenhum atributo {ganho ? "somou" : "tirou"} nesta vigência.
        </p>
      ) : (
        <div className="mt-3 space-y-1">
          {itens.map((item) => {
            const conteudo = (
              <>
              <span className="min-w-0">
                <span className="block font-semibold truncate" title={item.nome}>
                  {item.nome}
                </span>
                <span className="block text-[0.6875rem] text-muted-foreground truncate">
                  {contar(item.changes, "alteração", "alterações")}
                </span>
                <span className="mt-1.5 h-1.5 w-full block overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      ganho ? "bg-emerald-600" : "bg-red-600",
                    )}
                    style={{ width: `${Math.max(4, (Math.abs(item.valor) / teto) * 100)}%` }}
                  />
                </span>
              </span>
              <span
                className={cn(
                  "flex items-center justify-end gap-1 text-right tabular-nums text-xs font-bold",
                  ganho ? "text-emerald-700" : "text-red-700",
                )}
              >
                {formatBrlShort(item.valor)}
                {link !== null && (
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                )}
              </span>
              </>
            );
            const classe =
              "grid grid-cols-[1fr_7rem] items-center gap-3 text-sm rounded px-2 py-2 -mx-2";
            // Sem endereço em Alterações — a aba de trecho —, a linha é
            // leitura: ver `useLinkDeAlteracoes`.
            return link === null ? (
              <div key={item.parameterKey} className={classe}>
                {conteudo}
              </div>
            ) : (
              <Link
                key={item.parameterKey}
                href={link({
                  recorte: { ...recorteBase, period },
                  filtros: item.attributeCode ? { attributeCode: item.attributeCode } : {},
                })}
                aria-label={`Ver as alterações de ${item.nome} em ${rotulo}`}
                title="Ver as alterações deste atributo nesta vigência"
                className={cn(classe, "hover:bg-accent transition-colors")}
              >
                {conteudo}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function DetalheDoConsolidado({
  dados,
  periodicidade,
  onAbrirParametro,
}: {
  dados: Movimentos;
  periodicidade: string;
  onAbrirParametro: (parameterKey: string, periodicidade: string) => void;
}) {
  const liquido = dados.impact.byPeriodicity[periodicidade] ?? 0;
  const ganhos = dados.gainsByPeriodicity[periodicidade] ?? 0;
  const perdas = dados.lossesByPeriodicity[periodicidade] ?? 0;
  const negativo = liquido < 0;

  const itens = dados.byParameter
    .map((p) => ({ ...p, valor: p.impact.byPeriodicity[periodicidade] ?? 0 }))
    .filter((p) => p.impact.byPeriodicity[periodicidade] !== undefined && p.valor !== 0)
    .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  const teto = Math.max(...itens.map((p) => Math.abs(p.valor)), 1);

  return (
    <>
      <header className="px-7 pt-7 pb-5 border-b shrink-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {dados.fromLabel} → {dados.toLabel}
        </p>
        <SheetTitle className="text-2xl font-extrabold tracking-tight mt-1 pr-8">
          Líquido consolidado
        </SheetTitle>

        <p
          className={cn(
            "text-[2rem] font-extrabold tabular-nums leading-none mt-4",
            negativo ? "text-red-700" : "text-emerald-700",
          )}
        >
          {formatBrlShort(liquido)}
          <span className="text-base font-semibold text-muted-foreground">
            {periodicitySuffix(periodicidade)}
          </span>
        </p>

        <SheetDescription className="mt-2.5 max-w-xl leading-snug">
          Soma de {contar(dados.totals.changes, "alteração", "alterações")} no intervalo —{" "}
          <span className="text-emerald-700 font-semibold">{formatBrlShort(ganhos)}</span> de
          ganho e <span className="text-red-700 font-semibold">{formatBrlShort(perdas)}</span> de
          perda.
        </SheetDescription>
      </header>

      <div className="flex-1 overflow-y-auto px-7 py-6">
        <h3 className="text-sm font-bold uppercase tracking-wide mb-3">Por parâmetro</h3>
        <div className="space-y-1">
          {itens.map((item) => (
            <button
              key={item.parameterKey}
              type="button"
              onClick={() => onAbrirParametro(item.parameterKey, periodicidade)}
              className="w-full grid grid-cols-[1fr_7rem] items-center gap-3 text-left text-sm rounded px-2 py-2 -mx-2 hover:bg-accent transition-colors"
            >
              <span className="min-w-0">
                <span className="block font-semibold truncate">{item.parameterName}</span>
                <span className="mt-1.5 h-1.5 w-full block overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      item.valor < 0 ? "bg-red-600" : "bg-emerald-600",
                    )}
                    style={{ width: `${Math.max(4, (Math.abs(item.valor) / teto) * 100)}%` }}
                  />
                </span>
              </span>
              <span
                className={cn(
                  "flex items-center justify-end gap-1 text-right tabular-nums text-xs font-bold",
                  item.valor < 0 ? "text-red-700" : "text-emerald-700",
                )}
              >
                {formatBrlShort(item.valor)}
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/** `3 alterações`, `1 alteração` — o número por extenso com a palavra que ele rege. */
function contar(quantidade: number, singular: string, plural: string): string {
  return `${quantidade.toLocaleString("pt-BR")} ${quantidade === 1 ? singular : plural}`;
}
