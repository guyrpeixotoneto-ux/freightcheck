import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ChevronDown,
  ChevronRight,
  GitCompareArrows,
  Info,
  ListFilter,
  Lock,
  TriangleAlert,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatBrl, formatValue, periodicitySuffix } from "@/lib/format";
import { lerRecorte, linkDeAlteracoes } from "@/lib/recorte";
import {
  HistoricoAtributo,
  TabelaVeiculos,
} from "@/components/changes/detalhe-alteracao";
import type {
  AttributeSeries,
  ChangeGroup,
  GroupVehicle,
  PriorityItem,
  Severity,
} from "@/components/inicio/types";
import type { ItemCockpit } from "@/lib/cockpit";

/**
 * Um item da fila de investigação.
 *
 * Três camadas, e a disciplina desta tela é não misturá-las:
 *
 * 1. **A linha da tabela** responde *o que é, em quanto da frota, e quanto
 *    custa* — em linguagem de auditor, e em colunas que se comparam de cima a
 *    baixo. Nada de `2028-07-01T12:00:00Z → 46935.5` aqui.
 * 2. **A investigação** abre a profundidade técnica, do tamanho para a prova:
 *    a abrangência, os dois lados como vieram — com os padrões colados neles —,
 *    o diagnóstico com suas ressalvas, os veículos, a série e a origem.
 * 3. **A conta da prioridade** fica visível no fim da investigação. Um ranking
 *    cujo critério não pode ser lido é indistinguível de um palpite; aqui a
 *    soma que produziu a posição está escrita, parcela por parcela.
 */

const CORES: Record<
  Severity,
  { barra: string; chip: string; texto: string }
> = {
  CRITICO: {
    barra: "bg-red-700",
    chip: "bg-red-50 text-red-800 border-red-300",
    texto: "text-red-800",
  },
  ALTO: {
    barra: "bg-amber-500",
    chip: "bg-amber-50 text-amber-900 border-amber-300",
    texto: "text-amber-800",
  },
  MEDIO: {
    barra: "bg-sky-600",
    chip: "bg-sky-50 text-sky-900 border-sky-300",
    texto: "text-sky-800",
  },
  BAIXO: {
    barra: "bg-zinc-300",
    chip: "bg-zinc-50 text-zinc-600 border-zinc-300",
    texto: "text-zinc-600",
  },
};

const ROTULO_SEVERIDADE: Record<Severity, string> = {
  CRITICO: "Crítico",
  ALTO: "Alto",
  MEDIO: "Médio",
  BAIXO: "Baixo",
};

/** As colunas da fila, para o `colSpan` da investigação não sair do lugar. */
export const COLUNAS_PRIORIDADE = 8;

/**
 * Uma linha da fila de investigação.
 *
 * A linha é uma leitura de tabela: posição, criticidade, parâmetro, frota,
 * alterações, anomalia, impacto e a ação. Oito colunas que se comparam de cima
 * a baixo — que é como se escolhe por onde começar. O diagnóstico e a prova
 * ficam na investigação, um clique abaixo.
 *
 * **A grandeza da coluna é alteração, e não ponto de prioridade.** A soma da
 * fila é o critério da ordem, não uma medida da vigência: `68` não tem unidade
 * que se compare com nada — nem com as 267 linhas do topo da tela, nem entre
 * dois pontos, porque a escala dela é interna. Quem lê a fila quer o tamanho do
 * que mudou, e esse número é `changes`. A conta continua inteira e auditável em
 * dois lugares: no `title` da posição, para quem quer a razão da ordem sem sair
 * da linha, e na investigação, em "Por que este ponto está nesta posição",
 * parcela por parcela.
 *
 * **E a coluna de veículos saiu junto.** Hoje há uma linha por (ativo,
 * atributo) — `grouped.ts` diz isso e a soma fecha —, então `Alterações` e
 * `Veículos` mostrariam o mesmo número em toda linha, e duas colunas iguais
 * fazem quem lê procurar a diferença que não existe. A abrangência continua
 * dita onde ela é lida: embaixo do parâmetro, em "10 de 71 carretas", onde ela
 * vem com o denominador que a torna interpretável.
 */
export function LinhaPrioridade({
  entry,
  period,
  contexto,
}: {
  entry: ItemCockpit;
  period: string;
  /** `scopeHash` e `canal` da leitura, para os links e para o nível 2. */
  contexto: URLSearchParams;
}) {
  const { item, group } = entry;
  const [aberto, setAberto] = useState(false);
  const cores = CORES[item.severity];
  const dinheiro = group.impact.amount !== null && group.impact.amount !== 0;

  return (
    <>
      <tr className={cn("border-t transition-colors", aberto ? "bg-muted/40" : "hover:bg-muted/30")}>
        <td
          className="pl-5 pr-2 py-3 align-middle text-[0.9375rem] font-bold tabular-nums text-muted-foreground"
          title={`Posição ${item.rank} · soma de prioridade ${item.score}: ${item.reasons
            .map((r) => `${r.label} +${r.points}`)
            .join(", ")}`}
        >
          {String(item.rank).padStart(2, "0")}
        </td>

        <td className="px-2 py-3 align-middle">
          <span
            className={cn(
              "inline-block text-[0.625rem] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 border rounded-md whitespace-nowrap",
              cores.chip,
            )}
          >
            {ROTULO_SEVERIDADE[item.severity]}
          </span>
        </td>

        <td className="px-2 py-3 align-middle max-w-md">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-[0.9375rem] truncate" title={group.title}>
              {group.title}
            </span>
            <span className="text-[0.6875rem] text-muted-foreground bg-muted rounded-md px-1.5 py-0.5 shrink-0">
              {group.badgeLabel}
            </span>
          </div>
          {/*
            A abrangência é a segunda pergunta de quem lê o nome do parâmetro, e
            cabe embaixo dele sem custar uma coluna: "62 de 82 cavalos" só faz
            sentido colado ao ponto a que se refere.
          */}
          <div className="text-[0.6875rem] text-muted-foreground mt-0.5 truncate">
            {item.shareLabel}
          </div>
        </td>

        <td className="px-2 py-3 align-middle text-[0.8125rem] text-muted-foreground whitespace-nowrap">
          {group.equipment}
        </td>

        {/*
          Sem cor de criticidade neste número. A contagem é tamanho, não risco:
          pintar 68 linhas de âmbar diria que a linha é grave por ser grande, e
          a criticidade já tem coluna própria duas casas à esquerda.
        */}
        <td
          className="px-2 py-3 align-middle text-right"
          title={`${group.changes} ${
            group.changes === 1 ? "linha alterada" : "linhas alteradas"
          } neste ponto · ${item.shareLabel}`}
        >
          <span className="text-[0.9375rem] font-bold tabular-nums">{group.changes}</span>
        </td>

        <td className="px-2 py-3 align-middle text-center">
          {item.hasAnomaly ? (
            <span
              className="inline-flex items-center justify-center"
              title={
                group.formatOnly
                  ? "Troca de formato, sem mudança de valor"
                  : "Possível anomalia de formato junto de mudança de valor"
              }
            >
              {group.formatOnly ? (
                <Info className="w-3.5 h-3.5 text-slate-500" />
              ) : (
                <TriangleAlert className="w-3.5 h-3.5 text-amber-600" />
              )}
              <span className="sr-only">
                {group.formatOnly ? "troca de formato" : "possível anomalia"}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground" aria-hidden>
              —
            </span>
          )}
        </td>

        <td className="px-2 py-3 align-middle text-right whitespace-nowrap">
          {dinheiro ? (
            <>
              <div
                className={cn(
                  "text-[0.9375rem] font-bold tabular-nums",
                  group.impact.amount! < 0 ? "text-red-700" : "text-emerald-700",
                )}
              >
                {formatBrl(group.impact.amount!)}
                <span className="text-[0.6875rem] font-normal text-muted-foreground">
                  {periodicitySuffix(group.impact.periodicity)}
                </span>
              </div>
              {group.impact.excludedVehicles > 0 && (
                <div className="text-[0.6875rem] text-violet-800">
                  {group.impact.excludedVehicles} de {group.vehicles} fora do total
                </div>
              )}
            </>
          ) : (
            <span
              className="text-[0.8125rem] text-muted-foreground"
              title={
                group.impact.reason ??
                "Sem valor apurado nesta vigência."
              }
            >
              Não calculado
            </span>
          )}
        </td>

        <td className="pl-2 pr-5 py-3 align-middle text-right">
          <button
            onClick={() => setAberto(!aberto)}
            aria-expanded={aberto}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-brand text-brand-foreground hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            {aberto ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            Investigar
          </button>
        </td>
      </tr>

      {aberto && (
        <tr className="border-t">
          <td colSpan={COLUNAS_PRIORIDADE} className="p-0">
            <Investigacao entry={entry} period={period} contexto={contexto} />
          </td>
        </tr>
      )}
    </>
  );
}

function LinkAcao({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 border border-border rounded-sm text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
    >
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Nível 2 — a investigação
// ---------------------------------------------------------------------------

function Investigacao({
  entry,
  period,
  contexto,
}: {
  entry: ItemCockpit;
  period: string;
  contexto: URLSearchParams;
}) {
  const { item, group } = entry;

  const vehicles = useQuery({
    queryKey: ["group-vehicles", period, group.key, contexto.toString()],
    queryFn: async () => {
      const params = new URLSearchParams(contexto);
      params.set("period", period);
      params.set("attributeCode", group.attributeCode ?? "");
      params.set("entityType", group.entityType ?? "");
      params.set("changeType", group.changeType);
      params.set("comparability", group.comparability);
      params.set("impactConfidence", group.impact.confidence);
      const response = await fetch(getApiUrl(`/changes/grouped/vehicles?${params}`));
      if (!response.ok) return [];
      return (await response.json()) as GroupVehicle[];
    },
  });

  const series = useQuery({
    queryKey: ["attribute-series", group.attributeCode, contexto.toString()],
    queryFn: async () => {
      const suffix = contexto.toString() ? `?${contexto}` : "";
      const response = await fetch(
        getApiUrl(
          `/attributes/${encodeURIComponent(group.attributeCode ?? "")}/series${suffix}`,
        ),
      );
      if (!response.ok) return null;
      return (await response.json()) as AttributeSeries;
    },
    enabled: group.attributeCode !== null,
  });

  return (
    <div className="bg-card px-6 py-5 space-y-5 text-sm">
      {/*
        As saídas para o resto do produto ficam no topo da investigação, e não
        na linha da fila: na fila elas competiam com a única ação que importa
        ali, que é abrir isto aqui.
      */}
      <div className="flex flex-wrap items-center gap-1.5">
        <LinkAcao href="/comparar">
          <GitCompareArrows className="w-3.5 h-3.5" />
          Comparar vigências
        </LinkAcao>
        {group.attributeCode && (
          /*
            `attributeCode` e não `search`, e a vigência junto.

            `search` é `ILIKE %termo%` sobre código, nome e placa — mandar
            `carreta.ipva_licenciamento` por lá trazia também
            `carreta.ipva_licenciamento_mensal`, que a curadoria já apontou como
            outra medida (`DISTINCT_BASES`): 147 linhas onde este ponto tem 71,
            sob um botão que promete "linha a linha" **deste** ponto. E sem o
            recorte a lista abria na vigência mais recente, que pode não ser a
            que está sendo investigada aqui.
          */
          <LinkAcao
            href={linkDeAlteracoes({
              recorte: { ...lerRecorte(contexto), period },
              filtros: {
                attributeCode: group.attributeCode,
                ...(group.entityType ? { entityType: group.entityType } : {}),
              },
            })}
          >
            <ListFilter className="w-3.5 h-3.5" />
            Ver linha a linha
          </LinkAcao>
        )}
      </div>

      {/*
        A abrangência abre a investigação, em vez de fechar uma segunda fileira
        de cartões.

        Ela é o tamanho do achado, e tudo abaixo é lido contra ela: "o valor foi
        zerado" em 10 de 71 carretas e em 71 de 71 é a mesma frase e dois
        problemas diferentes. Enquanto era meia coluna *embaixo* do diagnóstico,
        a escala chegava depois da conclusão que depende dela — e o leitor tinha
        de subir de novo para reler a frase com o peso certo.
      */}
      <Secao titulo="Abrangência">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <p>
            <span className="text-xl font-bold tabular-nums">{group.vehicles}</span>{" "}
            <span className="text-muted-foreground">
              de {group.fleet} {group.equipment.toLowerCase()}
              {group.fleet === 1 ? "" : "s"} da frota comparada
            </span>
          </p>
          {/*
            As duas grandezas na mesma linha, e cada uma dizendo o que conta:
            fatia da frota é veículo, "alterações neste ponto" é linha. A
            contagem de linhas não depende mais da fatia existir — ela é sabida
            sempre, e some da tela junto com a barra não fazia sentido.
          */}
          <p className="text-xs text-muted-foreground">
            {item.sharePercent !== null && (
              <>{item.sharePercent.toLocaleString("pt-BR")}% da frota · </>
            )}
            {group.changes} {group.changes === 1 ? "alteração" : "alterações"} neste ponto
          </p>
        </div>
        {/*
          A barra tem largura máxima: solta na largura inteira do painel, uma
          régua de 1,5px separando duas seções é lida como filete decorativo, e
          não como a frota medida. Presa a uma medida de leitura, ela volta a
          ser o desenho do "10 de 71".
        */}
        {item.sharePercent !== null && (
          <div className="h-1.5 max-w-2xl bg-muted overflow-hidden mt-2">
            <div
              className={cn("h-full", CORES[item.severity].barra)}
              style={{ width: `${item.sharePercent}%` }}
            />
          </div>
        )}
      </Secao>

      {/*
        Duas colunas de mesma largura, e não `1fr 1.2fr`: a fileira de baixo
        usava `md:grid-cols-2`, então a divisa entre as colunas mudava de lugar
        de uma fileira para a outra e os títulos de seção não se alinhavam na
        mesma tela. Um breakpoint só (`md`), uma divisa só.

        À esquerda a prova — o que a planilha entregou, e se ela entregou a
        mesma coisa em todos os veículos. À direita a leitura: o que o
        FreightCheck conclui, e o que ele se recusa a concluir.
      */}
      <div className="grid gap-5 md:grid-cols-2">
        <Secao titulo="O que mudou">
          <OQueMudou group={group} />
          <Padroes group={group} item={item} />
        </Secao>

        <Secao titulo="Diagnóstico FreightCheck">
          <p className="leading-snug">{item.diagnosis}</p>
          {group.anomalies.map((anomaly) => (
            <div
              key={`${anomaly.kind}-${anomaly.sameInstant}-${anomaly.differenceMs}`}
              className={cn(
                "mt-2 border-l-4 px-3 py-2",
                anomaly.formatOnly
                  ? "border-slate-400 bg-slate-50 text-slate-800"
                  : "border-amber-500 bg-amber-50 text-amber-900",
              )}
            >
              <div className="font-semibold text-[0.6875rem] uppercase tracking-wide mb-1 flex items-center gap-1.5">
                {anomaly.formatOnly ? (
                  <Info className="w-3.5 h-3.5" />
                ) : (
                  <TriangleAlert className="w-3.5 h-3.5" />
                )}
                {anomaly.formatOnly ? "Troca de formato" : "Possível anomalia de formato"} ·{" "}
                {anomaly.vehicles} {anomaly.vehicles === 1 ? "veículo" : "veículos"}
              </div>
              <p className="text-xs leading-snug">{anomaly.explanation}</p>
              <p className="mt-1 text-[0.6875rem]">
                Nada foi convertido nem corrigido. O valor original de cada lado continua
                guardado como veio da planilha — abra um veículo abaixo para conferir a célula.
              </p>
            </div>
          ))}
          {group.inconclusiveReason && (
            <div className="mt-2 border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-amber-900">
              <div className="font-semibold text-[0.6875rem] uppercase tracking-wide mb-1">
                Comparação inconclusiva
              </div>
              <p className="text-xs leading-snug">{group.inconclusiveReason}</p>
            </div>
          )}
          {group.impact.excludedReason && (
            <div className="mt-2 border-l-4 border-violet-500 bg-violet-50 px-3 py-2 text-violet-900">
              <div className="font-semibold text-[0.6875rem] uppercase tracking-wide mb-1 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5" />
                Fora do total desta vigência
              </div>
              <p className="text-xs leading-snug">{group.impact.excludedReason}</p>
              {group.composition && (
                <p className="mt-1.5 text-[0.6875rem]">
                  <span className="font-medium">Composição declarada:</span>{" "}
                  <span className="font-mono">{group.composition.total}</span> ={" "}
                  <span className="font-mono">{group.composition.parts.join(" + ")}</span>.{" "}
                  {group.composition.evidence}
                </p>
              )}
              {group.impact.excludedAmount !== null && (
                <p className="mt-1.5 text-[0.6875rem] tabular-nums">
                  Valor deixado de fora: {formatBrl(group.impact.excludedAmount)}
                  {periodicitySuffix(group.impact.periodicity)}
                  {group.impact.countedVehicles > 0 && (
                    <> · {group.impact.countedVehicles} veículo(s) continuam no total.</>
                  )}
                </p>
              )}
            </div>
          )}
          {group.impact.amount === null && group.impact.reason && (
            /*
              Mesma gramática das outras ressalvas — régua à esquerda, título
              curto com ícone, corpo em uma frase — e só a cor muda, porque só o
              peso muda. Esta era uma caixa cinza inteira, com outro tamanho de
              título: a informação que explica a coluna de dinheiro da fila
              dizer "Não calculado" era a que menos parecia pertencer ao grupo.
            */
            <div className="mt-2 border-l-4 border-slate-400 bg-muted/40 px-3 py-2">
              <div className="font-semibold text-[0.6875rem] uppercase tracking-wide mb-1 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" />
                Por que não há valor apurado
              </div>
              <p className="text-xs text-muted-foreground leading-snug">
                {group.impact.reason}
              </p>
            </div>
          )}
        </Secao>
      </div>

      {series.data && series.data.points.length > 0 && (
        <Secao titulo="Como esta linha se comportou nas vigências">
          <HistoricoAtributo series={series.data} semTitulo />
        </Secao>
      )}

      <div>
        {/*
          O título muda de palavra quando o grupo é troca de formato pura.
          "Veículos afetados" descreve dano, e é a mesma expressão que encima o
          IPVA que custou R$ 145 mil; usá-la aqui fazia o cabeçalho contradizer
          as 62 notas logo abaixo, que dizem que nada mudou.
        */}
        <Secao
          titulo={
            group.formatOnly
              ? `Veículos com a coluna reformatada (${group.vehicles} de ${group.fleet})`
              : `Veículos afetados (${group.vehicles} de ${group.fleet})`
          }
        >
          {vehicles.isLoading && <p className="text-muted-foreground">Carregando…</p>}
          {vehicles.data && <TabelaVeiculos rows={vehicles.data} group={group} />}
        </Secao>
      </div>

      <div className="grid gap-5 md:grid-cols-2 border-t pt-4">
        <Secao titulo="Contexto e origem">
          <ul className="text-xs text-muted-foreground space-y-0.5">
            <li>
              <span className="text-foreground font-medium">Classificação:</span>{" "}
              {group.costClass === "FIXO"
                ? "custo fixo"
                : group.costClass === "VARIAVEL"
                  ? "custo variável"
                  : "sem classificação"}
              {group.taxonomyName && <> · {group.taxonomyName}</>}
            </li>
            <li>
              <span className="text-foreground font-medium">Semântica:</span>{" "}
              {group.semanticsLabel}
            </li>
            <li>
              <span className="text-foreground font-medium">Natureza:</span>{" "}
              {group.natures.length > 0 ? group.natures.join(", ") : "—"}
            </li>
            {group.attributeCode && (
              <li>
                <span className="text-foreground font-medium">Coluna de origem:</span>{" "}
                <span className="font-mono">{group.attributeCode}</span>
              </li>
            )}
            <li>
              <span className="text-foreground font-medium">Unidade do valor:</span>{" "}
              {group.unit ?? "não declarada"}
            </li>
          </ul>
        </Secao>

        <Secao titulo="Por que este ponto está nesta posição">
          <ul className="text-xs space-y-0.5">
            {item.reasons.map((reason) => (
              <li key={reason.label} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{reason.label}</span>
                <span className="tabular-nums font-medium shrink-0">+{reason.points}</span>
              </li>
            ))}
            <li className="flex justify-between gap-3 border-t pt-1 mt-1 font-semibold">
              <span>
                Total · {ROTULO_SEVERIDADE[item.severity].toLowerCase()} (posição {item.rank})
              </span>
              <span className="tabular-nums">{item.score}</span>
            </li>
          </ul>
          <p className="text-[0.6875rem] text-muted-foreground mt-1.5 leading-snug">
            A fila é ordenada por esta soma. Nenhum critério é oculto: crítico a partir de 70,
            alto a partir de 45, médio a partir de 25.
          </p>
        </Secao>
      </div>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-muted-foreground mb-2">
        {titulo}
      </h4>
      {children}
    </div>
  );
}

/**
 * O par dominante *quando é ele* que "O que mudou" está mostrando como
 * ANTERIOR/ATUAL — e `null` quando o bloco de cima mostra outra coisa (os
 * totais da frota, ou uma faixa de variação por veículo).
 *
 * Uma função só, consultada nos dois lugares, porque a pergunta é a mesma nos
 * dois: *este par já está na tela?* Enquanto cada seção decidia por conta
 * própria, "Padrões encontrados" imprimia como chip o mesmo
 * `1843.23 → 6529.73` que "O que mudou" mostrava em caixa alta meia tela ao
 * lado — o mesmo fato em duas formas, fazendo o leitor procurar uma diferença
 * que não existe.
 */
function parDominanteNoTopo(group: ChangeGroup) {
  const a = group.aggregate;
  const totais = a.summable && a.totalBefore !== null && a.totalAfter !== null;
  return totais ? null : group.dominantPattern;
}

/**
 * Quantos comportamentos existem sob a mesma alteração, colado nas duas pontas.
 *
 * Era uma seção própria, na outra ponta de um grid de quatro cartões, separada
 * por uma fileira inteira do valor que ela descreve. A frase agora fica embaixo
 * do par e diz o que aquele par é — o padrão mais frequente, e em quantos
 * veículos —, o que também dispensa o "(3 de 10 veículos)" que a legenda de
 * cima repetia com outro substantivo.
 */
function Padroes({ group, item }: { group: ChangeGroup; item: PriorityItem }) {
  if (group.patterns <= 1) {
    return (
      <p className="text-xs text-muted-foreground mt-2">
        Um único comportamento em todos os veículos deste ponto.
      </p>
    );
  }

  return (
    <div className="mt-3 border-t pt-2.5">
      <p className="text-xs leading-snug">{item.patternsSummary}</p>
      {/*
        O chip só quando o par ainda não está visível acima — nos grupos
        somáveis (onde o topo mostra os totais da frota) e nos que só têm faixa
        de variação. Aí ele não repete nada: é a única aparição do par.
      */}
      {group.dominantPattern && !parDominanteNoTopo(group) && (
        <p className="mt-1.5 font-mono text-xs bg-muted/50 border px-2 py-1.5 inline-block">
          {group.dominantPattern.before ?? "—"} → {group.dominantPattern.after ?? "—"}
          <span className="font-sans text-muted-foreground">
            {" "}
            · {group.dominantPattern.vehicles} veículos
          </span>
        </p>
      )}
      <p className="text-xs text-muted-foreground mt-1.5">
        Os demais padrões aparecem veículo a veículo na tabela abaixo.
      </p>
    </div>
  );
}

/**
 * Os dois lados, como a fonte os entregou.
 *
 * É aqui — e só aqui — que o valor cru aparece. Na linha ele seria ruído; nesta
 * seção ele é a prova, e some dela seria pedir para confiar sem conferir.
 */
function OQueMudou({ group }: { group: ChangeGroup }) {
  const a = group.aggregate;

  if (a.summable && a.totalBefore !== null && a.totalAfter !== null) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Lado titulo="Total antes" valor={formatValue(a.totalBefore, group.unit)} />
        <Lado titulo="Total agora" valor={formatValue(a.totalAfter, group.unit)} forte />
        {a.perVehicle && (
          <p className="col-span-2 text-xs text-muted-foreground">
            Média por veículo: {formatValue(a.perVehicle.averageBefore, group.unit)} →{" "}
            {formatValue(a.perVehicle.averageAfter, group.unit)} ({a.perVehicle.denominator}{" "}
            veículos no cálculo). Uma soma maior com mais veículos não é preço maior.
          </p>
        )}
      </div>
    );
  }

  const par = parDominanteNoTopo(group);
  if (par) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Lado titulo="Anterior" valor={par.before ?? "—"} />
        <Lado titulo="Atual" valor={par.after ?? "—"} forte />
        {/*
          Só a procedência do número fica aqui. Em quantos veículos este par
          vale é a frase logo abaixo, escrita uma vez e com o substantivo da
          frota — esta legenda dizia "veículos" numa tela que, três linhas
          acima, chama os mesmos itens de carretas.
        */}
        <p className="col-span-2 text-xs text-muted-foreground">
          Valores como vieram da planilha, sem conversão, no padrão mais frequente do grupo.
        </p>
      </div>
    );
  }

  if (a.minPercent !== null && a.maxPercent !== null) {
    return (
      <p>
        Variação de{" "}
        <span className="font-mono font-medium">
          {a.minPercent.toLocaleString("pt-BR")}%
        </span>{" "}
        a{" "}
        <span className="font-mono font-medium">
          {a.maxPercent.toLocaleString("pt-BR")}%
        </span>{" "}
        por veículo.{" "}
        <span className="text-muted-foreground">
          Não somável ({a.aggregation ?? "agregação não definida"}) — a tabela abaixo mostra
          veículo a veículo.
        </span>
      </p>
    );
  }

  return (
    <p className="text-muted-foreground italic">
      Sem variação numérica a exibir; a mudança está nos valores veículo a veículo.
    </p>
  );
}

function Lado({ titulo, valor, forte }: { titulo: string; valor: string; forte?: boolean }) {
  return (
    <div className="border bg-muted/30 px-3 py-2">
      <div className="text-[0.625rem] uppercase tracking-wide text-muted-foreground">
        {titulo}
      </div>
      <div
        className={cn(
          "font-mono text-sm mt-0.5 break-all",
          forte ? "font-bold" : "text-muted-foreground",
        )}
      >
        {valor}
      </div>
    </div>
  );
}
