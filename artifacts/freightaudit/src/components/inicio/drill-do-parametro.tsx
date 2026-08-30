import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, MapPin, Truck } from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error";
import { cn } from "@/lib/utils";
import { fetchJsonOrNull, getApiUrl } from "@/lib/api";
import { paramsDosVeiculosDoGrupo } from "@/lib/recorte";
import { formatPercent, formatValue } from "@/lib/format";
import { escreverImpacto, type Lado } from "@/lib/visao-geral";
import {
  gruposDoParametro,
  porPlaca,
  unidadesDoParametro,
  type LinhaDeUnidade,
  type UnidadeDoDrill,
} from "@/lib/drill-da-familia";
import type { FamiliesView, GroupVehicle } from "@/components/inicio/types";

/**
 * Os dois degraus abaixo do parâmetro: **em que unidade**, e **em que placa**.
 *
 * A gaveta da família parava no parâmetro — "Financiamento, −R$ 76.318/mês, 21
 * alterações em 19 veículos" — e quem lê a Visão Geral está olhando a soma de
 * todas as unidades. As duas perguntas seguintes são sempre as mesmas, e antes
 * disto a única forma de respondê-las era sair da tela, reencontrar a unidade
 * pelo seletor, reabrir a mesma família e torcer para o número bater.
 *
 * Agora o parâmetro abre por dentro, sem trocar de tela e sem perder a conta de
 * cima de vista:
 *
 * 1. **Por unidade**, lido da mesma resposta que desenhou o pódio — cada
 *    unidade da Visão Geral já traz o seu próprio resumo executivo
 *    (`OverviewUnitIncluded.summary`), então este degrau não pede nada ao
 *    servidor e não tem como discordar do número que ele abre.
 * 2. **Por placa**, com o antes e o depois de cada uma. Este pede — a árvore de
 *    parâmetros e a tabela de veículos só existem **dentro de um contexto** —, e
 *    pede exatamente onde as outras telas pedem: `/changes/families` para achar
 *    os grupos do parâmetro naquela unidade, e `/changes/grouped/vehicles` para
 *    as linhas de cada grupo, com `scopeHash` e canal em todas as chamadas.
 *
 * Os dois degraus fecham com o número que abriram, e quando não fecham eles
 * escrevem a diferença — a mesma disciplina do `resto` de `DetalheDeImpacto`.
 */
export function DrillDoParametro({
  parametro,
  lado,
  periodicity,
  unidades,
  period,
}: {
  parametro: { key: string; name: string; amount: number };
  lado: Lado;
  periodicity: string;
  unidades: UnidadeDoDrill[];
  /** A competência aberta. Sem ela não há o que perguntar ao servidor. */
  period: string | null;
}) {
  const [unidadeAberta, setUnidadeAberta] = useState<string | null>(null);
  const aberto = unidadesDoParametro(unidades, {
    parameterKey: parametro.key,
    periodicity,
    lado,
    esperado: parametro.amount,
  });

  if (aberto.linhas.length === 0) {
    return (
      <p className="mt-3 rounded-lg border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        Não foi possível abrir este parâmetro por unidade nesta leitura — o resumo de cada
        unidade não veio com esta competência. O número acima continua valendo: ele é a soma
        que o servidor apurou.
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-lg border bg-muted/20 px-4 py-3.5">
      <p className="text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <MapPin className="w-3.5 h-3.5" />
        {parametro.name} · por unidade
      </p>

      <ul className="mt-2.5 space-y-1.5">
        {aberto.linhas.map((linha) => (
          <li key={linha.chave}>
            <LinhaDaUnidade
              linha={linha}
              lado={lado}
              periodicity={periodicity}
              aberta={unidadeAberta === linha.chave}
              onAlternar={() =>
                setUnidadeAberta((atual) => (atual === linha.chave ? null : linha.chave))
              }
            />
            {unidadeAberta === linha.chave && (
              <PlacasDaUnidade
                linha={linha}
                parameterKey={parametro.key}
                periodicity={periodicity}
                lado={lado}
                period={period}
              />
            )}
          </li>
        ))}
      </ul>

      {/*
        A soma das unidades é o número de cima, ou a tela diz de quanto é a
        diferença. Um degrau que publica a própria soma no lugar do número que
        ele abriu é como duas telas do mesmo produto passam a discordar.
      */}
      {aberto.resto !== 0 && (
        <p className="mt-2.5 text-[0.6875rem] leading-snug text-amber-800">
          As unidades listadas somam {escreverImpacto({ periodicity, amount: aberto.total })}, e o
          parâmetro acima afirma {escreverImpacto({ periodicity, amount: aberto.esperado })} —
          faltam {escreverImpacto({ periodicity, amount: aberto.resto })}. A diferença costuma ser
          unidade que não entrou na consolidação desta competência.
        </p>
      )}
    </div>
  );
}

function LinhaDaUnidade({
  linha,
  lado,
  periodicity,
  aberta,
  onAlternar,
}: {
  linha: LinhaDeUnidade;
  lado: Lado;
  periodicity: string;
  aberta: boolean;
  onAlternar: () => void;
}) {
  const negativo = lado === "perdas";
  return (
    <button
      type="button"
      onClick={onAlternar}
      aria-expanded={aberta}
      className={cn(
        "w-full flex items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors",
        aberta ? "bg-card border" : "hover:bg-card/70",
      )}
    >
      {aberta ? (
        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="w-36 shrink-0 min-w-0">
        <span className="block text-xs font-semibold truncate" title={linha.label}>
          {linha.label}
        </span>
        <span className="block text-[0.625rem] text-muted-foreground">
          {linha.changes.toLocaleString("pt-BR")}{" "}
          {linha.changes === 1 ? "alteração" : "alterações"} ·{" "}
          {linha.vehicles.toLocaleString("pt-BR")}{" "}
          {linha.vehicles === 1 ? "veículo" : "veículos"}
        </span>
      </span>
      <span className="flex-1 h-1.5 bg-muted overflow-hidden min-w-6 rounded-sm">
        <span
          className={cn("block h-full", negativo ? "bg-red-600" : "bg-emerald-600")}
          style={{ width: `${Math.max(2, linha.proporcao * 100)}%` }}
        />
      </span>
      <span
        className={cn(
          "text-xs font-bold tabular-nums shrink-0 text-right w-24",
          negativo ? "text-red-700" : "text-emerald-700",
        )}
      >
        {escreverImpacto({ periodicity, amount: linha.amount })}
      </span>
    </button>
  );
}

/**
 * As placas de uma unidade, dentro de um parâmetro — o degrau mais fundo.
 *
 * Duas leituras encadeadas, e as duas com o contexto da unidade em todas as
 * chamadas: primeiro a vigência daquela unidade (`/changes/families`), de onde
 * saem os grupos do parâmetro; depois os veículos de cada grupo
 * (`/changes/grouped/vehicles`), que é onde moram o "antes", o "depois" e o
 * impacto de cada linha. Uma chamada sem `scopeHash` cai em `contexts[0]` no
 * servidor e devolve placas de outra unidade — ver `paramsDosVeiculosDoGrupo`.
 *
 * Uma unidade com dois canais tem dois contextos, e os dois são lidos: o número
 * dela no degrau de cima é a soma deles, então a lista de placas também tem de
 * ser.
 */
function PlacasDaUnidade({
  linha,
  parameterKey,
  periodicity,
  lado,
  period,
}: {
  linha: LinhaDeUnidade;
  parameterKey: string;
  periodicity: string;
  lado: Lado;
  period: string | null;
}) {
  /*
    Unidade e canal na forma que a API recebe, uma vez só para as duas leituras
    desta unidade. O contexto entra também na `queryKey`, e não só na URL: sem
    ele, duas unidades na mesma competência dividiriam a mesma entrada de cache,
    e abrir a segunda serviria as placas da primeira sem ir ao servidor.
  */
  const contextos = linha.contexts.map((contexto) => {
    const params = new URLSearchParams();
    params.set("scopeHash", contexto.scopeHash);
    if (contexto.channel !== null) params.set("canal", contexto.channel);
    return params;
  });

  const vigencias = useQueries({
    queries: contextos.map((contexto) => {
      const consulta = new URLSearchParams(contexto);
      if (period !== null) consulta.set("period", period);
      return {
        // A mesma chave que o resto do produto usa para esta resposta: quem já
        // abriu esta unidade nesta competência não paga uma segunda leitura.
        queryKey: ["families", "drill-por-placa", consulta.toString()],
        queryFn: () => fetchJsonOrNull<FamiliesView>(`/changes/families?${consulta}`),
        enabled: period !== null,
        staleTime: 60_000,
      };
    }),
  });

  /*
    Um pedido por (contexto × grupo). A lista precisa ser estável entre
    renderizações — `useQueries` monta um observador por item, e uma ordem que
    dança faria cada refetch reembaralhar o cache. Ela é derivada das respostas
    acima, na ordem em que elas chegam, e por isso é.
  */
  const pedidos = vigencias.flatMap((consulta, indice) =>
    gruposDoParametro(consulta.data, parameterKey, periodicity).map((grupo) => ({
      contexto: contextos[indice],
      grupo,
    })),
  );

  const veiculos = useQueries({
    queries: pedidos.map(({ contexto, grupo }) => {
      const params = paramsDosVeiculosDoGrupo(contexto, period ?? "", grupo);
      return {
        queryKey: ["group-vehicles", period, grupo.key, contexto.toString()],
        queryFn: async () => {
          const resposta = await fetch(getApiUrl(`/changes/grouped/vehicles?${params}`));
          if (!resposta.ok) return [];
          return (await resposta.json()) as GroupVehicle[];
        },
        enabled: period !== null,
        staleTime: 60_000,
      };
    }),
  });

  const carregando =
    vigencias.some((c) => c.isLoading) || veiculos.some((c) => c.isLoading);
  const erro = vigencias.find((c) => c.error)?.error ?? veiculos.find((c) => c.error)?.error;

  if (period === null) {
    return (
      <p className="ml-6 mt-1.5 rounded-md border bg-card px-3 py-2 text-[0.6875rem] text-muted-foreground">
        Sem competência aberta não há o que perguntar por placa.
      </p>
    );
  }

  if (erro) {
    return (
      <div className="ml-6 mt-1.5">
        <ApiErrorNotice error={erro} what="Não foi possível abrir as placas desta unidade." />
      </div>
    );
  }

  if (carregando) {
    return (
      <p className="ml-6 mt-1.5 text-[0.6875rem] text-muted-foreground">
        Carregando as placas de {linha.label}…
      </p>
    );
  }

  const aberto = porPlaca(
    pedidos.map(({ grupo }, indice) => ({ grupo, veiculos: veiculos[indice]?.data ?? [] })),
    { periodicity, lado, esperado: linha.amount },
  );

  if (aberto.linhas.length === 0) {
    return (
      <p className="ml-6 mt-1.5 rounded-md border bg-card px-3 py-2 text-[0.6875rem] text-muted-foreground">
        Nenhuma linha deste parâmetro em {linha.label} compõe este lado nesta periodicidade.
      </p>
    );
  }

  const negativo = lado === "perdas";

  return (
    <div className="ml-6 mt-1.5 rounded-md border bg-card overflow-hidden">
      <p className="border-b bg-muted/40 px-3 py-1.5 text-[0.625rem] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <Truck className="w-3.5 h-3.5" />
        {linha.label} · placa a placa, antes e depois
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[0.6875rem]">
          <thead>
            <tr className="bg-muted/20 text-muted-foreground">
              <th className="text-left px-3 py-1.5 font-medium">Placa</th>
              <th className="text-left px-3 py-1.5 font-medium">O que mudou</th>
              <th className="text-right px-3 py-1.5 font-medium">Antes</th>
              <th className="text-right px-3 py-1.5 font-medium">Depois</th>
              <th className="text-right px-3 py-1.5 font-medium">Variação</th>
              <th className="text-right px-3 py-1.5 font-medium">Impacto</th>
            </tr>
          </thead>
          <tbody>
            {aberto.linhas.map((placa) => (
              <tr key={placa.changeId} className="border-t">
                <td className="px-3 py-1.5 font-mono">{placa.plate}</td>
                <td className="px-3 py-1.5 text-muted-foreground max-w-[12rem] truncate" title={placa.titulo}>
                  {placa.titulo}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                  {placa.numericAntes !== null
                    ? formatValue(placa.numericAntes, placa.unit)
                    : (placa.textoAntes ?? "—")}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                  {placa.numericDepois !== null
                    ? formatValue(placa.numericDepois, placa.unit)
                    : (placa.textoDepois ?? "—")}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {placa.deltaPercent === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className={placa.deltaPercent < 0 ? "text-red-700" : "text-emerald-700"}>
                      {formatPercent(placa.deltaPercent)}
                    </span>
                  )}
                </td>
                <td
                  className={cn(
                    "px-3 py-1.5 text-right font-bold tabular-nums",
                    negativo ? "text-red-700" : "text-emerald-700",
                  )}
                >
                  {escreverImpacto({ periodicity, amount: placa.amount })}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/20">
              <td className="px-3 py-1.5 font-semibold" colSpan={5}>
                {aberto.linhas.length === 1 ? "1 alteração" : `${aberto.linhas.length} alterações`}{" "}
                nesta unidade
              </td>
              <td
                className={cn(
                  "px-3 py-1.5 text-right font-extrabold tabular-nums",
                  negativo ? "text-red-700" : "text-emerald-700",
                )}
              >
                {escreverImpacto({ periodicity, amount: aberto.total })}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {aberto.resto !== 0 && (
        <p className="border-t px-3 py-1.5 text-[0.625rem] leading-snug text-amber-800">
          A soma das placas é {escreverImpacto({ periodicity, amount: aberto.total })} e a unidade
          afirma {escreverImpacto({ periodicity, amount: aberto.esperado })} — faltam{" "}
          {escreverImpacto({ periodicity, amount: aberto.resto })}. Nada foi ajustado para
          esconder a diferença.
        </p>
      )}

      {/*
        Nada some: o que não compõe este número continua existindo dentro do
        parâmetro, e é dito pelo nome. Sem esta linha, quem abrisse a tabela do
        grupo contaria mais alterações do que as daqui e não teria como saber
        qual das duas leituras acreditar.
      */}
      {(aberto.foraDesteLado.outroLado > 0 ||
        aberto.foraDesteLado.semPreco > 0 ||
        aberto.foraDesteLado.jaContadas > 0) && (
        <p className="border-t px-3 py-1.5 text-[0.625rem] leading-snug text-muted-foreground">
          Fora deste número, no mesmo parâmetro:{" "}
          {[
            aberto.foraDesteLado.outroLado > 0 &&
              `${aberto.foraDesteLado.outroLado} ${aberto.foraDesteLado.outroLado === 1 ? "alteração andou" : "alterações andaram"} para o outro lado`,
            aberto.foraDesteLado.semPreco > 0 &&
              `${aberto.foraDesteLado.semPreco} sem preço apurado`,
            aberto.foraDesteLado.jaContadas > 0 &&
              `${aberto.foraDesteLado.jaContadas} já contada${aberto.foraDesteLado.jaContadas === 1 ? "" : "s"} nas parcelas de outro parâmetro`,
          ]
            .filter(Boolean)
            .join(" · ")}
          .
        </p>
      )}
    </div>
  );
}
