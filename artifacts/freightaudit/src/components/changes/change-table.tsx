import { Fragment, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarRange,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Paginacao } from "@/components/ui/paginacao";
import { getApiUrl } from "@/lib/api";
import {
  TAMANHOS_DE_PAGINA,
  aplicarJanela,
  primeiraPagina,
  type Janela,
} from "@/lib/paginacao";
import { cn } from "@/lib/utils";

/**
 * The changes table, shared by Alterações and Comparar.
 *
 * Columns follow the question order: Atributo | Antes | Agora | Variação |
 * Impacto | Classificação | Origem. Expanding a row shows both sides down to
 * the originating cell.
 */

export interface ChangeRow {
  id: number;
  category: string;
  changeType: string;
  nature: string | null;
  attributeCode: string | null;
  attributeName: string | null;
  entityLabel: string | null;
  entityType: string | null;
  valueBefore: string | null;
  valueAfter: string | null;
  deltaAbsolute: number | null;
  deltaPercent: number | null;
  comparability: string;
  inconclusiveReason: string | null;
  impactConfidence: string;
  impactAmount: number | null;
  impactPeriodicity: string | null;
  impactReason: string | null;
  costClass: string | null;
  taxonomyName: string | null;
  semanticsStatus: string | null;
  semanticsVersionA: number | null;
  semanticsVersionB: number | null;
  semanticsEffectiveFrom: string | null;
}

/**
 * Um atributo e as duas perguntas que se fazem sobre ele: quantas vezes mudou,
 * e quanto isso custou. `impact` é uma lista por periodicidade porque R$/mês e
 * R$/ano não somam — ver `AttributeRollup` em `lib/comparison/src/query.ts`.
 */
export interface AttributeRollup {
  attributeCode: string;
  attributeName: string | null;
  count: number;
  calculated: number;
  impact: { periodicity: string; amount: number }[];
}

export interface Breakdown {
  byCostClass: { costClass: string; count: number; impact: number | null }[];
  byType: { changeType: string; count: number }[];
  /** Quantas têm preço apurado, e quantas não têm. */
  byImpactConfidence: { impactConfidence: string; count: number }[];
  bySemantics: { semanticsStatus: string; count: number }[];
  byAttribute: AttributeRollup[];
}

export interface Filters {
  costClass: string;
  changeType: string;
  semanticsStatus: string;
  comparability: string;
  impactConfidence: string;
  attributeCode: string;
  /**
   * `CAVALO` | `CARRETA` — o equipamento da linha, dentro da vigência lida.
   *
   * Não é o mesmo que trocar de série nas pastilhas acima da lista: lá se
   * escolhe **qual comparação** ler, e a comparação de uma série é sempre a
   * mais recente dela; aqui se escolhe **quais linhas** de uma leitura já feita
   * ficam à vista. Com a vigência fixada — quem chegou da Visão geral —, só o
   * segundo responde "o que mudou no cavalo *neste* mês".
   */
  entityType: string;
  search: string;
  minAbsImpact: string;
}

export const emptyFilters: Filters = {
  costClass: "",
  changeType: "",
  semanticsStatus: "",
  comparability: "",
  impactConfidence: "",
  attributeCode: "",
  entityType: "",
  search: "",
  minAbsImpact: "",
};

/**
 * O número que alguém digitou, à brasileira ou à americana.
 *
 * A rota faz `Number(valor)` e descarta o que der `NaN` — sem dizer nada. Quem
 * escreve `1.500,50`, que é como se escreve dinheiro em português, via o filtro
 * simplesmente não acontecer: a lista continuava inteira e nenhum aviso
 * explicava por quê. A conversão é feita aqui, de um lado só: com vírgula, o
 * ponto é separador de milhar; sem vírgula, o ponto é o decimal.
 */
export function numeroDigitado(texto: string): number | null {
  const bruto = texto.trim().replace(/\s/g, "").replace("R$", "");
  if (bruto === "") return null;
  const normalizado = bruto.includes(",")
    ? bruto.replace(/\./g, "").replace(",", ".")
    : bruto;
  const valor = Number(normalizado);
  // O corte é por tamanho do impacto, e não por sinal: uma alteração que tirou
  // R$ 300 é tão material quanto uma que pôs R$ 300.
  return Number.isFinite(valor) ? Math.abs(valor) : null;
}

/**
 * O corte de materialidade que está de fato ligado.
 *
 * `0` não é um corte — deixa tudo passar —, e texto que não é número também
 * não. Nos dois casos o filtro não vai ao servidor e não se anuncia como
 * ativo, para o painel não afirmar um recorte que ninguém aplicou.
 */
export function materialidadeMinima(filters: Filters): number | null {
  const valor = numeroDigitado(filters.minAbsImpact);
  return valor !== null && valor > 0 ? valor : null;
}

export function toQuery(
  filters: Filters,
  extra: Record<string, string> = {},
  janela: Janela = primeiraPagina,
) {
  const params = new URLSearchParams();
  const minimo = materialidadeMinima(filters);
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    // Os dois passam por tratamento logo abaixo; mandar o texto cru aqui seria
    // mandá-lo duas vezes, e a segunda ganharia.
    if (key === "minAbsImpact" || key === "search") continue;
    if (value) params.set(key, value);
  }
  const busca = filters.search.trim();
  if (busca) params.set("search", busca);
  if (minimo !== null) params.set("minAbsImpact", String(minimo));
  aplicarJanela(params, janela);
  return params.toString();
}

const brl = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function ImpactCell({ row }: { row: ChangeRow }) {
  if (row.impactConfidence === "CALCULATED" && row.impactAmount !== null) {
    return (
      <span
        className={cn(
          // whitespace-nowrap: a minus sign wrapping onto its own line turns
          // "-R$ 7.700,16" into something that reads as a positive figure.
          "font-mono tabular-nums font-medium whitespace-nowrap",
          row.impactAmount < 0 ? "text-red-700" : "text-emerald-700",
        )}
        title={row.impactReason ?? undefined}
      >
        {brl(row.impactAmount)}
        {row.impactPeriodicity && (
          <span className="text-muted-foreground font-normal whitespace-nowrap">
            {" "}
            /{row.impactPeriodicity.toLowerCase()}
          </span>
        )}
      </span>
    );
  }
  return (
    <span
      className="text-xs text-muted-foreground inline-flex items-center gap-1"
      title={row.impactReason ?? undefined}
    >
      <HelpCircle className="w-3 h-3" />
      não calculável
    </span>
  );
}

function CostClassBadge({ costClass }: { costClass: string | null }) {
  if (costClass === "FIXO")
    return <Badge className="bg-blue-100 text-blue-900 border-blue-300 hover:bg-blue-100">Fixo</Badge>;
  if (costClass === "VARIAVEL")
    return <Badge className="bg-violet-100 text-violet-900 border-violet-300 hover:bg-violet-100">Variável</Badge>;
  return (
    <Badge variant="outline" className="text-muted-foreground">
      sem classe
    </Badge>
  );
}

function NatureBadge({ row }: { row: ChangeRow }) {
  const map: Record<string, { label: string; className: string }> = {
    ENTITY_ADDED: { label: "ativo entrou", className: "bg-emerald-100 text-emerald-900 border-emerald-300" },
    ENTITY_REMOVED: { label: "ativo saiu", className: "bg-red-100 text-red-900 border-red-300" },
    ATTRIBUTE_ADDED: { label: "coluna nova", className: "bg-emerald-100 text-emerald-900 border-emerald-300" },
    ATTRIBUTE_REMOVED: { label: "coluna removida", className: "bg-red-100 text-red-900 border-red-300" },
    SEMANTICS_CHANGED: {
      label: "significado mudou",
      className: "bg-violet-100 text-violet-900 border-violet-300",
    },
  };
  const byType = map[row.changeType];
  if (byType) {
    return <Badge className={cn(byType.className, "hover:opacity-100")}>{byType.label}</Badge>;
  }
  const natures: Record<string, string> = {
    NUMERIC: "valor",
    TEXT: "texto",
    BOOLEAN: "booleano",
    DATE: "data",
    ZEROING: "zerou",
    FROM_ZERO: "saiu de zero",
    APPEARED: "passou a existir",
    DISAPPEARED: "deixou de existir",
    NULL_REASON: "motivo da ausência",
    TYPE_CHANGE: "mudou de tipo",
    SEMANTICS_DRIFT: "significado mudou",
    UNIT: "unidade",
    PERIODICITY: "periodicidade",
    AGGREGATION: "agregação",
    IS_MONETARY: "natureza",
    CALCULATION_BASIS: "base de cálculo",
  };
  return (
    <Badge variant="outline" className="text-muted-foreground font-normal">
      {natures[row.nature ?? ""] ?? row.nature ?? "—"}
    </Badge>
  );
}

/**
 * A travessia de uma linha desta lista para a matriz por quinzena.
 *
 * A placa vai junto e **não** é recorte: a matriz continua sendo a da frota
 * inteira, e a placa é só onde a leitura começa — ver `placaEmFoco` em
 * `impacto-quinzenas.tsx`. Reduzi-la ao ativo responderia outra pergunta: o
 * total da coluna deixaria de fechar com o que a Ambev pagou, que é a razão de
 * a matriz existir.
 */
export interface TravessiaParaQuinzenas {
  entityType: string;
  code: string;
  /** O ativo de onde se partiu; `null` quando a alteração não é de um ativo. */
  placa: string | null;
}

/**
 * Se esta alteração tem para onde abrir, e com o quê.
 *
 * Precisa das duas coisas que a matriz recebe — o parâmetro e o equipamento — e
 * quem não tem as duas não ganha o botão: uma coluna que entrou ou saiu do
 * layout chega aqui sem `attributeCode`, e um link que abrisse a matriz no
 * parâmetro que o servidor escolheria por padrão levaria a pessoa a uma tabela
 * de outro assunto sem nada dizendo isso.
 *
 * **Uma mudança de significado atravessa**, e não é descuido: o parâmetro existe
 * e a série dele também, e ver os nove valores lado a lado é justamente o que
 * mostra o degrau que a troca de régua produziu. Um parâmetro sem série numérica
 * nesta leitura não é filtrado aqui — quem sabe disso é o servidor, e a matriz
 * diz, ao abrir, que abriu em outro.
 */
export function travessiaDaAlteracao(
  row: ChangeRow,
): TravessiaParaQuinzenas | null {
  if (!row.attributeCode || !row.entityType) return null;
  return {
    entityType: row.entityType,
    code: row.attributeCode,
    placa: row.entityLabel,
  };
}

const NATURE_LABELS: Record<string, string> = {
  UNIT: "unidade",
  PERIODICITY: "periodicidade",
  AGGREGATION: "agregação",
  IS_MONETARY: "natureza monetária",
  CALCULATION_BASIS: "base de cálculo",
};

function natureLabel(nature: string | null) {
  return NATURE_LABELS[nature ?? ""] ?? nature ?? "";
}

export function ChangeTable({
  rows,
  total,
  janela,
  onJanela,
  onVerQuinzenas,
}: {
  rows: ChangeRow[];
  total: number;
  /** Sem estes dois a tabela é a página única de antes — usada por quem a embute. */
  janela?: Janela;
  onJanela?: (janela: Janela) => void;
  /**
   * Abrir o parâmetro da linha na matriz por placa e vigência.
   *
   * Opcional porque quem embute esta tabela pode não ter para onde levar: em
   * Comparar não há aba Impacto ao lado, e um botão que não leva a lugar nenhum
   * é pior do que a sua ausência. Onde existe, é o mesmo destino a que uma linha
   * do panorama leva — a alteração é a diferença entre duas colunas, e esta é a
   * tela que mostra as duas.
   */
  onVerQuinzenas?: (travessia: TravessiaParaQuinzenas) => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (rows.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Nenhuma alteração com esses filtros.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
            <th className="w-8" />
            <th className="text-left px-4 py-2 font-medium">Atributo</th>
            <th className="text-right px-4 py-2 font-medium">Antes</th>
            <th className="text-right px-4 py-2 font-medium">Agora</th>
            <th className="text-right px-4 py-2 font-medium">Variação</th>
            <th className="text-right px-4 py-2 font-medium">Impacto</th>
            <th className="text-left px-4 py-2 font-medium">Classificação</th>
            <th className="text-left px-4 py-2 font-medium">Origem</th>
          </tr>
        </thead>
        <tbody>
          {/* Fragment com key: cada alteração rende duas famílias de linhas — a
              dela e a do detalhe —, e um fragmento sem key numa lista deixa o
              React reconciliando pela posição. */}
          {rows.map((row) => (
            <Fragment key={row.id}>
              <tr
                className={cn(
                  "border-b hover:bg-muted/40 cursor-pointer",
                  row.comparability === "INCONCLUSIVE" && "bg-amber-50/50",
                  // Mudança de significado não é uma linha entre outras: ela é
                  // a razão de várias outras estarem bloqueadas.
                  row.category === "SEMANTICS_CHANGE" &&
                    "bg-violet-50 border-l-4 border-l-violet-500",
                )}
                onClick={() => setExpanded(expanded === row.id ? null : row.id)}
              >
                <td className="pl-3 text-muted-foreground">
                  {expanded === row.id ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </td>
                <td className="px-4 py-2">
                  {/* O nome vem primeiro: é por ele que se reconhece a linha.
                      O código fica embaixo, como endereço de quem precisa
                      conferir de onde o número saiu. */}
                  <NomeDoAtributo row={row} onVerQuinzenas={onVerQuinzenas} />
                  <div className="font-mono text-xs text-muted-foreground">
                    {row.attributeCode ?? "—"}
                  </div>
                  {row.category === "SEMANTICS_CHANGE" && (
                    <div className="text-xs text-violet-800 mt-0.5">
                      {natureLabel(row.nature)}
                      {row.semanticsEffectiveFrom && (
                        <> · desde {row.semanticsEffectiveFrom}</>
                      )}
                      {row.semanticsVersionA !== null && (
                        <> · v{row.semanticsVersionA} → v{row.semanticsVersionB}</>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {row.valueBefore ?? <span className="text-muted-foreground italic">—</span>}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {row.valueAfter ?? <span className="text-muted-foreground italic">—</span>}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {row.deltaAbsolute === null ? (
                    <span className="text-xs text-amber-800">inconclusiva</span>
                  ) : (
                    <>
                      <div className={row.deltaAbsolute < 0 ? "text-red-700" : "text-emerald-700"}>
                        {row.deltaAbsolute > 0 ? "+" : ""}
                        {row.deltaAbsolute.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
                      </div>
                      {row.deltaPercent !== null && (
                        <div className="text-xs text-muted-foreground">
                          {row.deltaPercent > 0 ? "+" : ""}
                          {row.deltaPercent.toFixed(1)}%
                        </div>
                      )}
                    </>
                  )}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <ImpactCell row={row} />
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-col gap-1 items-start">
                    <CostClassBadge costClass={row.costClass} />
                    <NatureBadge row={row} />
                  </div>
                </td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                  {row.entityLabel ?? "—"}
                  {row.entityType && (
                    <div className="opacity-70">{row.entityType}</div>
                  )}
                </td>
              </tr>
              {expanded === row.id && (
                <tr className="border-b bg-muted/30">
                  <td />
                  <td colSpan={7} className="px-4 py-4">
                    <ChangeDetail row={row} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {janela && onJanela ? (
        <Paginacao
          total={total}
          pagina={janela.pagina}
          porPagina={janela.porPagina}
          onPagina={(pagina) => onJanela({ ...janela, pagina })}
          // Trocar o tamanho da página volta para a primeira: a linha que
          // estava no alto da página 4 de 300 em 300 não está na página 4 de
          // 50 em 50, e fingir que está é perder o lugar sem avisar.
          onPorPagina={(porPagina) => onJanela({ porPagina, pagina: 1 })}
          tamanhos={TAMANHOS_DE_PAGINA}
          unidade="alterações"
        />
      ) : (
        total > rows.length && (
          <p className="px-4 py-3 text-xs text-muted-foreground border-t">
            Mostrando {rows.length} de {total}. Use os filtros para chegar ao
            restante — nada foi descartado.
          </p>
        )
      )}
    </div>
  );
}

/**
 * O nome do atributo — e a porta para as nove vigências dele.
 *
 * A linha inteira continua abrindo o detalhe de procedência: é a pergunta "de
 * onde saiu este número", e ela era a única que esta tabela respondia. O nome do
 * atributo passa a responder a outra, que é a que se faz depois de ler a
 * variação: *isso vinha acontecendo, ou foi agora?* Uma linha com duas colunas —
 * antes e agora — não tem como responder isso, e a matriz por quinzena tem: são
 * as mesmas nove colunas que sustentam o número do panorama.
 *
 * As duas convivem porque são dois destinos, e o clique é de quem escolhe: o
 * `stopPropagation` é o que impede que abrir a matriz abra também o detalhe da
 * linha por baixo dela, deixando o expandido aceso numa tela que já mudou.
 */
function NomeDoAtributo({
  row,
  onVerQuinzenas,
}: {
  row: ChangeRow;
  onVerQuinzenas?: (travessia: TravessiaParaQuinzenas) => void;
}) {
  const travessia = travessiaDaAlteracao(row);

  if (!onVerQuinzenas || travessia === null) {
    return <div className="font-medium">{row.attributeName ?? "—"}</div>;
  }

  /*
    Sem nome de exibição, o botão é o código — que a linha de baixo já mostra em
    cinza. A repetição é preferível a um travessão clicável: o alvo do clique
    precisa dizer o que se vai abrir.
  */
  const nome = row.attributeName ?? travessia.code;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onVerQuinzenas(travessia);
      }}
      title={`ver ${nome} em todas as vigências, por placa`}
      className="group inline-flex items-start gap-1.5 text-left font-medium text-brand hover:underline"
    >
      <span>{nome}</span>
      <CalendarRange
        className="mt-0.5 w-3.5 h-3.5 shrink-0 opacity-50 transition-opacity group-hover:opacity-100"
        aria-hidden
      />
    </button>
  );
}

function ChangeDetail({ row }: { row: ChangeRow }) {
  const { data } = useQuery({
    queryKey: ["change", row.id, "provenance"],
    queryFn: async () => {
      const response = await fetch(getApiUrl(`/changes/${row.id}/provenance`));
      if (!response.ok) return null;
      return (await response.json()) as Record<string, string | number | null>;
    },
  });

  return (
    <div className="space-y-3 text-sm">
      {row.category === "SEMANTICS_CHANGE" && (
        <div className="rounded-md border-l-4 border-violet-500 bg-violet-50 px-3 py-2 text-violet-900">
          <strong className="text-xs uppercase tracking-wide block mb-1">
            A Freightec mudou o significado desta coluna
          </strong>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
            <div className="rounded border bg-white/70 px-3 py-2">
              <div className="text-xs uppercase tracking-wide opacity-70">
                antes {row.semanticsVersionA && `(versão ${row.semanticsVersionA})`}
              </div>
              <div className="font-mono">{row.valueBefore ?? "—"}</div>
            </div>
            <div className="rounded border bg-white/70 px-3 py-2">
              <div className="text-xs uppercase tracking-wide opacity-70">
                agora {row.semanticsVersionB && `(versão ${row.semanticsVersionB})`}
                {row.semanticsEffectiveFrom && `, desde ${row.semanticsEffectiveFrom}`}
              </div>
              <div className="font-mono">{row.valueAfter ?? "—"}</div>
            </div>
          </div>
          <p className="mt-2">
            Enquanto essa diferença existir entre as duas vigências, os valores
            deste atributo <strong>não são comparáveis</strong>: a diferença
            numérica mediria a troca de regra, não o custo.
          </p>
        </div>
      )}

      {row.inconclusiveReason && (
        <div className="rounded-md border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-amber-900">
          <strong className="text-xs uppercase tracking-wide block mb-0.5">
            Comparação inconclusiva
          </strong>
          {row.inconclusiveReason}
        </div>
      )}
      {row.impactReason && (
        <div className="text-muted-foreground">
          <strong className="text-foreground">Impacto:</strong> {row.impactReason}
        </div>
      )}
      <div className="text-muted-foreground">
        <strong className="text-foreground">Semântica:</strong>{" "}
        {row.semanticsStatus ?? "—"}
        {row.taxonomyName && <> · {row.taxonomyName}</>}
      </div>

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ProvenanceSide
            title={`Antes — ${data.snapshot_before}`}
            sheet={data.sheet_before}
            row={data.row_before}
            column={data.column_before}
            header={data.header_before}
            raw={data.raw_before}
            type={data.type_before}
          />
          <ProvenanceSide
            title={`Agora — ${data.snapshot_after}`}
            sheet={data.sheet_after}
            row={data.row_after}
            column={data.column_after}
            header={data.header_after}
            raw={data.raw_after}
            type={data.type_after}
          />
        </div>
      )}
    </div>
  );
}

function ProvenanceSide({
  title,
  sheet,
  row,
  column,
  header,
  raw,
  type,
}: {
  title: string;
  sheet: unknown;
  row: unknown;
  column: unknown;
  header: unknown;
  raw: unknown;
  type: unknown;
}) {
  if (!sheet) {
    return (
      <div className="rounded-md border bg-card px-3 py-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
          {title}
        </div>
        <div className="text-sm text-muted-foreground italic">
          Sem célula de origem deste lado.
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-md border bg-card px-3 py-2 font-mono text-xs">
      <div className="uppercase tracking-wide text-muted-foreground mb-1 font-sans">
        {title}
      </div>
      <div>
        aba <strong>{String(sheet)}</strong> · linha <strong>{String(row)}</strong> ·
        coluna <strong>{String(column)}</strong>
      </div>
      <div className="text-muted-foreground">cabeçalho: {String(header)}</div>
      <div className="text-muted-foreground">
        valor original: {String(raw)} ({String(type)})
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * O filtro da aba Planilha
 * ------------------------------------------------------------------ */

/** A classe do custo, na ordem em que a conta se lê — e o rótulo de cada uma. */
const CLASSES: [string, string][] = [
  ["FIXO", "Custo fixo"],
  ["VARIAVEL", "Custo variável"],
  ["SEM_CLASSE", "Sem classe"],
];

const TIPOS: [string, string][] = [
  ["VALUE_CHANGED", "valor mudou"],
  ["ENTITY_ADDED", "ativo entrou"],
  ["ENTITY_REMOVED", "ativo saiu"],
  ["ATTRIBUTE_ADDED", "coluna nova"],
  ["ATTRIBUTE_REMOVED", "coluna removida"],
  ["SEMANTICS_CHANGED", "significado mudou"],
];

const SEMANTICAS = ["CONFIRMED", "PRESUMED", "UNKNOWN"];

const CLASSE_LABELS = Object.fromEntries(CLASSES);
const TIPO_LABELS = Object.fromEntries(TIPOS);

const IMPACTO_LABELS: Record<string, string> = {
  CALCULATED: "com impacto",
  NOT_CALCULABLE: "sem impacto",
};

/** Espelha `equipmentLabel` do servidor — o mesmo nome que a Visão geral usa. */
const EQUIPAMENTO_LABELS: Record<string, string> = {
  CAVALO: "Cavalo",
  CARRETA: "Carreta",
};

/**
 * Um recorte ligado, em palavras — o suficiente para ser lido e desfeito.
 *
 * `avancado` separa os que vivem atrás do botão Filtros dos que se leem na
 * própria fileira da frente. Só os primeiros precisam ser repetidos quando o
 * painel está fechado; repetir os outros seria dizer duas vezes a mesma coisa.
 */
export interface FiltroAtivo {
  id: string;
  grupo: string;
  valor: string;
  avancado: boolean;
  /** O que zerar para tirar só este, sem levar os outros junto. */
  patch: Partial<Filters>;
}

export function filtrosAtivos(filters: Filters): FiltroAtivo[] {
  const lista: FiltroAtivo[] = [];

  if (filters.costClass) {
    lista.push({
      id: "costClass",
      grupo: "classe",
      valor: (CLASSE_LABELS[filters.costClass] ?? filters.costClass).toLowerCase(),
      avancado: false,
      patch: { costClass: "" },
    });
  }
  if (filters.impactConfidence) {
    lista.push({
      id: "impactConfidence",
      grupo: "impacto",
      valor:
        IMPACTO_LABELS[filters.impactConfidence] ?? filters.impactConfidence,
      avancado: false,
      patch: { impactConfidence: "" },
    });
  }
  if (filters.search.trim()) {
    lista.push({
      id: "search",
      grupo: "busca",
      valor: `“${filters.search.trim()}”`,
      avancado: false,
      patch: { search: "" },
    });
  }
  if (filters.changeType) {
    lista.push({
      id: "changeType",
      grupo: "tipo",
      valor: TIPO_LABELS[filters.changeType] ?? filters.changeType,
      avancado: true,
      patch: { changeType: "" },
    });
  }
  if (filters.semanticsStatus) {
    lista.push({
      id: "semanticsStatus",
      grupo: "semântica",
      valor: filters.semanticsStatus.toLowerCase(),
      avancado: true,
      patch: { semanticsStatus: "" },
    });
  }
  if (filters.comparability) {
    lista.push({
      id: "comparability",
      grupo: "comparação",
      valor: "só inconclusivas",
      avancado: true,
      patch: { comparability: "" },
    });
  }
  const minimo = materialidadeMinima(filters);
  if (minimo !== null) {
    lista.push({
      id: "minAbsImpact",
      grupo: "impacto de pelo menos",
      valor: brl(minimo),
      avancado: true,
      patch: { minAbsImpact: "" },
    });
  }
  // O atributo vem dos cartões de baixo, e não de nenhum chip desta barra — o
  // que faz dele o recorte mais fácil de esquecer que está ligado.
  if (filters.attributeCode) {
    lista.push({
      id: "attributeCode",
      grupo: "atributo",
      valor: filters.attributeCode,
      avancado: true,
      patch: { attributeCode: "" },
    });
  }
  // O equipamento não tem chip na barra: ele chega por link, da Visão geral. É
  // por isso que aparece aqui — um recorte que ninguém ligou nesta tela é o que
  // mais precisa estar escrito nela, com o × ao lado.
  if (filters.entityType) {
    lista.push({
      id: "entityType",
      grupo: "equipamento",
      valor: (EQUIPAMENTO_LABELS[filters.entityType] ?? filters.entityType).toLowerCase(),
      avancado: true,
      patch: { entityType: "" },
    });
  }

  return lista;
}

/**
 * Um campo de texto que só vira filtro quando quem digita faz uma pausa.
 *
 * `filters` é a chave da consulta, então cada tecla era uma ida ao servidor:
 * escrever "bomba" pedia a lista cinco vezes e mostrava quatro resultados que
 * ninguém pediu. O rascunho fica aqui e só sobe depois da pausa.
 *
 * O `useEffect` de cima é o caminho de volta: quando o filtro muda por fora —
 * um chip removido, "limpar tudo" — o campo acompanha em vez de continuar
 * exibindo o que já não está valendo.
 */
function useCampoAdiado(
  valorExterno: string,
  aplicar: (valor: string) => void,
  atraso = 300,
) {
  const [rascunho, setRascunho] = useState(valorExterno);
  const aplicarRef = useRef(aplicar);
  aplicarRef.current = aplicar;

  useEffect(() => {
    setRascunho(valorExterno);
  }, [valorExterno]);

  useEffect(() => {
    if (rascunho === valorExterno) return;
    const id = setTimeout(() => aplicarRef.current(rascunho), atraso);
    return () => clearTimeout(id);
  }, [rascunho, valorExterno, atraso]);

  /**
   * Manda agora o que estiver escrito, sem esperar a pausa.
   *
   * É o que o `onBlur` chama. Sem isto, digitar um número e fechar o painel no
   * mesmo movimento perdia o número: o campo desmonta, o `clearTimeout` da
   * limpeza cancela o envio, e nada na tela diz que o corte não foi aplicado.
   */
  const aplicarAgora = () => {
    if (rascunho !== valorExterno) aplicarRef.current(rascunho);
  };

  return [rascunho, setRascunho, aplicarAgora] as const;
}

/**
 * Os filtros da aba Planilha, em três faixas.
 *
 * **A da frente** tem os dois cortes que se fazem antes de qualquer outro, e
 * tem-nos separados: a *classe* do custo e se a alteração tem *impacto*
 * apurado são duas perguntas independentes que se combinam — `custo fixo`
 * **e** `sem impacto` é o recorte de quem procura o que ficou por apurar onde
 * mais dói. Desenhados como uma fileira só de pastilhas iguais, liam-se como
 * abas mutuamente exclusivas, e quem lia concluía que escolher uma desfazia a
 * outra.
 *
 * **A do meio** só aparece quando há recorte escondido: repete em palavras o
 * que o painel fechado está filtrando, com um × em cada. Sem ela, fechar o
 * botão Filtros escondia a razão de a lista estar curta atrás de um número.
 *
 * **A de baixo** é o painel — tipo, semântica, comparação e materialidade —,
 * que continua fechado por padrão porque quatro grupos de chips abertos de uma
 * vez são uma tela que se lê antes de se usar.
 */
export function ChangeFilterPanel({
  filters,
  onChange,
  breakdown,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  breakdown?: Breakdown;
}) {
  const [avancadoAberto, setAvancadoAberto] = useState(false);

  const ativos = filtrosAtivos(filters);
  const avancados = ativos.filter((f) => f.avancado);

  const naClasse = (costClass: string) =>
    breakdown?.byCostClass.find((c) => c.costClass === costClass)?.count;

  const noImpacto = (impactConfidence: string) =>
    breakdown?.byImpactConfidence.find(
      (i) => i.impactConfidence === impactConfidence,
    )?.count;

  // Toda alteração cai numa classe — `SEM_CLASSE` inclusive, que o servidor
  // preenche —, então esta soma é o tamanho do conjunto inteiro.
  const total = breakdown?.byCostClass.reduce((soma, c) => soma + c.count, 0);

  const alterna = (key: "costClass" | "impactConfidence", value: string) =>
    onChange({ ...filters, [key]: filters[key] === value ? "" : value });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <GrupoRapido label="Classe">
          <QuickChip
            active={!filters.costClass}
            onClick={() => onChange({ ...filters, costClass: "" })}
          >
            Todos
            <Contagem n={total} />
          </QuickChip>
          {CLASSES.map(([value, label]) => (
            <QuickChip
              key={value}
              active={filters.costClass === value}
              onClick={() => alterna("costClass", value)}
            >
              {label}
              <Contagem n={naClasse(value)} />
            </QuickChip>
          ))}
        </GrupoRapido>

        {/* A divisória é o que diz que daqui para a frente é outra pergunta. */}
        <span className="hidden h-7 w-px bg-border sm:block" aria-hidden />

        <GrupoRapido label="Impacto">
          <QuickChip
            active={filters.impactConfidence === "CALCULATED"}
            onClick={() => alterna("impactConfidence", "CALCULATED")}
          >
            Com impacto
            <Contagem n={noImpacto("CALCULATED")} />
          </QuickChip>
          <QuickChip
            active={filters.impactConfidence === "NOT_CALCULABLE"}
            onClick={() => alterna("impactConfidence", "NOT_CALCULABLE")}
          >
            Sem impacto
            <Contagem n={noImpacto("NOT_CALCULABLE")} />
          </QuickChip>
        </GrupoRapido>

        {/*
          `flex-1` e não `ml-auto`: empurrado para a direita, o grupo mantinha
          essa margem ao quebrar de linha, e a segunda fileira nascia com um
          rombo à esquerda e a busca encolhida contra a borda. Esticando, ele
          preenche a folga da linha em que estiver — na mesma da fileira, quando
          cabe, e sozinho na de baixo, quando não cabe.
        */}
        <div className="flex min-w-[18rem] flex-1 flex-wrap items-center gap-2">
          <CampoDeBusca
            valor={filters.search}
            onChange={(search) => onChange({ ...filters, search })}
          />
          <Button
            variant="outline"
            onClick={() => setAvancadoAberto((v) => !v)}
            aria-expanded={avancadoAberto}
            className={cn(
              "h-11 rounded-xl gap-2",
              (avancadoAberto || avancados.length > 0) &&
                "border-brand text-brand",
            )}
          >
            Filtros
            {avancados.length > 0 && (
              <span className="rounded-full bg-brand px-1.5 text-xs tabular-nums text-brand-foreground">
                {avancados.length}
              </span>
            )}
            <SlidersHorizontal className="w-4 h-4" />
          </Button>
          {ativos.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => onChange(emptyFilters)}
              className="h-11 rounded-xl text-muted-foreground"
            >
              limpar tudo
            </Button>
          )}
        </div>
      </div>

      {!avancadoAberto && avancados.length > 0 && (
        <ResumoDeFiltros
          itens={avancados}
          onRemover={(item) => onChange({ ...filters, ...item.patch })}
        />
      )}

      {avancadoAberto && (
        <FilterBar filters={filters} onChange={onChange} breakdown={breakdown} />
      )}
    </div>
  );
}

/** A busca, com o × que a desfaz sem ter de apagar letra a letra. */
function CampoDeBusca({
  valor,
  onChange,
}: {
  valor: string;
  onChange: (valor: string) => void;
}) {
  const [rascunho, setRascunho, aplicarAgora] = useCampoAdiado(valor, onChange);

  const limpar = () => {
    // Os dois juntos de propósito: o × é uma decisão pronta, e esperar a pausa
    // do `useCampoAdiado` para uma decisão pronta é só atraso.
    setRascunho("");
    onChange("");
  };

  return (
    <div className="relative min-w-[14rem] flex-1">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      <Input
        value={rascunho}
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={aplicarAgora}
        placeholder="Buscar atributo ou placa"
        aria-label="buscar atributo ou placa"
        title="encontra também pelo código do atributo"
        className="h-11 pl-9 pr-9 rounded-xl bg-background"
      />
      {rascunho !== "" && (
        <button
          type="button"
          onClick={limpar}
          // Sem o `preventDefault` o campo perde o foco antes do clique, o
          // `onBlur` manda a busca que o × veio justamente desfazer, e a lista
          // é pedida duas vezes para acabar no mesmo lugar.
          onMouseDown={(e) => e.preventDefault()}
          aria-label="limpar a busca"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

/** O que o painel fechado está filtrando, em palavras e com um × em cada. */
function ResumoDeFiltros({
  itens,
  onRemover,
}: {
  itens: FiltroAtivo[];
  onRemover: (item: FiltroAtivo) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Filtrando também por</span>
      {itens.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onRemover(item)}
          aria-label={`remover o filtro ${item.grupo} ${item.valor}`}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-brand/30 bg-brand/[0.07] py-1 pl-2.5 pr-1.5 text-brand transition-colors hover:bg-brand/[0.12]"
        >
          <span className="text-brand/70">{item.grupo}</span>
          <span className="truncate font-medium">{item.valor}</span>
          <X className="w-3 h-3 shrink-0" />
        </button>
      ))}
    </div>
  );
}

/**
 * A barra de chips inteira.
 *
 * Serve a dois donos, e é por isso que ela não tem fileira da frente nem busca:
 * dentro de `ChangeFilterPanel` ela é o painel de trás do botão Filtros, onde
 * classe, impacto e busca já estão na frente; em Comparar ela é a barra toda —
 * lá não há fileira da frente, e os cortes de classe e impacto entram pelos
 * grupos abaixo como quaisquer outros.
 */
export function FilterBar({
  filters,
  onChange,
  breakdown,
  /** Comparar mostra classe e impacto aqui; a aba Planilha, na fileira. */
  comClasse = false,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  breakdown?: Breakdown;
  comClasse?: boolean;
}) {
  const set = (key: keyof Filters, value: string) =>
    onChange({ ...filters, [key]: filters[key] === value ? "" : value });

  const ativos = filtrosAtivos(filters);

  return (
    <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        {comClasse && (
          <FilterGroup label="Classe">
            {CLASSES.map(([value, label]) => (
              <Chip
                key={value}
                active={filters.costClass === value}
                onClick={() => set("costClass", value)}
              >
                {label}
                <Contagem
                  n={
                    breakdown?.byCostClass.find((c) => c.costClass === value)
                      ?.count
                  }
                />
              </Chip>
            ))}
          </FilterGroup>
        )}

        <FilterGroup label="Tipo">
          {TIPOS.map(([value, label]) => (
            <Chip
              key={value}
              active={filters.changeType === value}
              onClick={() => set("changeType", value)}
            >
              {label}
              <Contagem
                n={breakdown?.byType.find((t) => t.changeType === value)?.count}
              />
            </Chip>
          ))}
        </FilterGroup>

        <FilterGroup label="Semântica">
          {SEMANTICAS.map((value) => (
            <Chip
              key={value}
              active={filters.semanticsStatus === value}
              onClick={() => set("semanticsStatus", value)}
            >
              {value.toLowerCase()}
              <Contagem
                n={
                  breakdown?.bySemantics.find(
                    (s) => s.semanticsStatus === value,
                  )?.count
                }
              />
            </Chip>
          ))}
        </FilterGroup>

        <FilterGroup label="Comparação">
          <Chip
            active={filters.comparability === "INCONCLUSIVE"}
            onClick={() => set("comparability", "INCONCLUSIVE")}
          >
            só inconclusivas
          </Chip>
          {comClasse && (
            <Chip
              active={filters.impactConfidence === "CALCULATED"}
              onClick={() => set("impactConfidence", "CALCULATED")}
            >
              só com impacto apurado
              <Contagem
                n={
                  breakdown?.byImpactConfidence.find(
                    (i) => i.impactConfidence === "CALCULATED",
                  )?.count
                }
              />
            </Chip>
          )}
        </FilterGroup>
      </div>

      <CampoDeMaterialidade filters={filters} onChange={onChange} />

      {comClasse && (
        <CampoDeBuscaSimples
          valor={filters.search}
          onChange={(search) => onChange({ ...filters, search })}
        />
      )}

      {/* O corte que veio de um clique nos cartões, e não de um chip daqui: sem
          isto ele seria um filtro sem controle visível na tela. Com o painel
          fechado é a fileira do resumo, acima, que o diz. */}
      {filters.attributeCode && (
        <FilterGroup label="Atributo">
          <Chip active onClick={() => onChange({ ...filters, attributeCode: "" })}>
            <span className="font-mono">{filters.attributeCode}</span>
            <X className="ml-1 inline w-3 h-3 align-[-1px]" />
          </Chip>
        </FilterGroup>
      )}

      {/* Só em Comparar, que não tem a fileira do resumo onde ele mora. */}
      {comClasse && ativos.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(emptyFilters)}
          className="text-muted-foreground"
        >
          limpar tudo
        </Button>
      )}
    </div>
  );
}

/**
 * O corte de materialidade.
 *
 * Aqui o rótulo fala em reais porque é o que o servidor compara — o próprio
 * `impactAmount` apurado da alteração, e não a variação do parâmetro. Um campo
 * sem rótulo, encostado à direita de um grupo de chips com que nada tinha a
 * ver, deixava a régua por adivinhar.
 */
function CampoDeMaterialidade({
  filters,
  onChange,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
}) {
  const [rascunho, setRascunho, aplicarAgora] = useCampoAdiado(
    filters.minAbsImpact,
    (minAbsImpact) => onChange({ ...filters, minAbsImpact }),
  );

  const naoEhNumero = rascunho.trim() !== "" && numeroDigitado(rascunho) === null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <label
        htmlFor="materialidade-minima"
        className="text-xs uppercase tracking-wide text-muted-foreground mr-1"
      >
        Materialidade mínima
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          R$
        </span>
        <Input
          id="materialidade-minima"
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          onBlur={aplicarAgora}
          placeholder="0"
          inputMode="decimal"
          aria-describedby="materialidade-minima-ajuda"
          aria-invalid={naoEhNumero}
          className={cn(
            "h-9 w-32 pl-8 tabular-nums",
            naoEhNumero && "border-amber-500 focus-visible:ring-amber-500",
          )}
        />
      </div>
      <p
        id="materialidade-minima-ajuda"
        className={cn(
          "text-xs",
          naoEhNumero ? "text-amber-700" : "text-muted-foreground",
        )}
      >
        {naoEhNumero
          ? `“${rascunho.trim()}” não é um número — nada está sendo cortado.`
          : "esconde o que custou menos que isto. O que não tem preço apurado sai junto."}
      </p>
    </div>
  );
}

/** A busca de Comparar, que não tem fileira da frente onde a pôr. */
function CampoDeBuscaSimples({
  valor,
  onChange,
}: {
  valor: string;
  onChange: (valor: string) => void;
}) {
  const [rascunho, setRascunho, aplicarAgora] = useCampoAdiado(valor, onChange);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <label
        htmlFor="busca-alteracoes"
        className="text-xs uppercase tracking-wide text-muted-foreground mr-1"
      >
        Busca
      </label>
      <Input
        id="busca-alteracoes"
        value={rascunho}
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={aplicarAgora}
        placeholder="atributo, placa ou código"
        className="h-9 w-64"
      />
    </div>
  );
}

/**
 * Os dois grupos da fileira da frente, sem rótulo pintado.
 *
 * O rótulo existia para dizer que ali começa outra pergunta, e dizia — mas
 * custava a fileira: com ele e as contagens, a barra não cabia numa linha e a
 * busca descia sozinha para a de baixo. Quem separa é a divisória, e as
 * palavras dos próprios chips fazem o resto — "Custo fixo" e "Com impacto" não
 * se confundem. O `aria-label` fica, porque quem ouve a tela não vê divisória
 * nenhuma.
 */
function GrupoRapido({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap items-center gap-1.5"
    >
      {children}
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center gap-1.5 flex-wrap"
    >
      <span className="text-xs uppercase tracking-wide text-muted-foreground mr-1">
        {label}
      </span>
      {children}
    </div>
  );
}

/** A pastilha grande da fileira da frente. */
function QuickChip({
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
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-11 items-center rounded-full border px-3.5 text-sm font-medium transition-colors",
        active
          ? "bg-brand border-brand text-brand-foreground shadow-sm"
          : "bg-background border-input text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

/** A pastilha pequena do painel. */
function Chip({
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
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "text-xs px-2.5 py-1 rounded-full border transition-colors",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background hover:bg-muted border-input text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Quantas linhas existem daquele lado — na comparação inteira, e não no que
 * sobrou.
 *
 * É o que o servidor devolve, de propósito: `getChangeSetBreakdown` não recebe
 * filtro nenhum. Uma contagem que encolhe a cada clique deixa de dizer "quanto
 * existe" e passa a dizer "quanto sobrou", que é a pergunta que o cabeçalho da
 * lista já responde. O `title` diz isso, porque um número ao lado de um filtro
 * é lido como previsão do resultado.
 */
function Contagem({ n }: { n?: number }) {
  if (n === undefined) return null;
  return (
    <span
      className="ml-1.5 opacity-60 tabular-nums"
      title="quantas existem na comparação inteira — os outros filtros não mexem nesta conta"
    >
      {n.toLocaleString("pt-BR")}
    </span>
  );
}
