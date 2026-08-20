import { Link } from "wouter";
import { Layers, TriangleAlert, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatBrlShort,
  formatNumber,
  formatPercent,
  formatValue,
  periodicitySuffix,
} from "@/lib/format";
import { porPeriodicidade, type AtributoNaPonta, type UniversoDoTipo } from "@/lib/analise";
import { agruparPorParametro, type TipoDaRemuneracao } from "@/lib/posicao";

/** O valor de um lado, na grandeza que a coluna mede. */
function Valor({
  numero,
  unidade,
}: {
  numero: number | null;
  unidade: string | null;
}) {
  if (numero === null) return <span className="text-muted-foreground">—</span>;
  return <span className="tabular-nums">{formatValue(numero, unidade)}</span>;
}

/**
 * O impacto de uma linha — sempre por periodicidade, nunca somado.
 *
 * Uma linha pode ter mensal e anual, e um número só afirmaria que se somam. E
 * "sem preço" nunca vira zero: quando não há impacto apurado, o que aparece é o
 * motivo, que é informação de auditoria e não uma célula vazia.
 */
function Impacto({ linha }: { linha: AtributoNaPonta }) {
  const valores = porPeriodicidade(linha.impact.byPeriodicity);

  if (linha.foraDaSoma !== null && valores.length === 0) {
    return (
      <span className="text-muted-foreground text-xs">
        fora da soma
        <span className="block">
          {linha.foraDaSoma.motivo === "ESCOPO_DE_CONJUNTO"
            ? "escopo de conjunto"
            : "coberto por parcelas"}
        </span>
      </span>
    );
  }

  if (valores.length === 0) {
    return (
      <span className="text-muted-foreground text-xs">
        sem preço
        {linha.inconclusiveReason !== null && (
          <span className="block">{linha.inconclusiveReason}</span>
        )}
      </span>
    );
  }

  return (
    <span className="tabular-nums">
      {valores.map((v) => (
        <span key={v.periodicity} className="block">
          {formatBrlShort(v.amount)}
          <span className="text-muted-foreground font-normal">
            {periodicitySuffix(v.periodicity)}
          </span>
        </span>
      ))}
    </span>
  );
}

/** Uma linha da tabela: um atributo dentro de um equipamento. */
function Linha({ linha }: { linha: AtributoNaPonta }) {
  const revertido = linha.posicao === "REVERTIDO";
  const somavel = linha.aggregate?.summable === true;

  return (
    <>
      <tr className={cn("border-b", revertido && "bg-muted/30")}>
        <td className="py-2 pl-5 pr-3 align-top">
          <span className="font-medium">{linha.title}</span>
          {linha.foraDaSoma?.motivo === "ESCOPO_DE_CONJUNTO" && (
            <span
              title={linha.foraDaSoma.explicacao}
              className="ml-1.5 inline-flex items-center gap-1 text-[0.6875rem] uppercase tracking-wide text-muted-foreground"
            >
              <Layers className="w-3 h-3" />
              conjunto
            </span>
          )}
        </td>
        <td className="py-2 px-3 align-top text-right">
          {revertido ? (
            <span className="text-muted-foreground">—</span>
          ) : somavel ? (
            <Valor numero={linha.aggregate!.totalBefore} unidade={linha.unit} />
          ) : (
            <span className="text-xs">{linha.dominantPattern?.before ?? "—"}</span>
          )}
        </td>
        <td className="py-2 px-3 align-top text-right">
          {revertido ? (
            <span className="text-muted-foreground">—</span>
          ) : somavel ? (
            <Valor numero={linha.aggregate!.totalAfter} unidade={linha.unit} />
          ) : (
            <span className="text-xs">{linha.dominantPattern?.after ?? "—"}</span>
          )}
        </td>
        <td className="py-2 px-3 align-top text-right tabular-nums">
          {revertido ? (
            <span className="text-muted-foreground">0,0%</span>
          ) : linha.aggregate?.deltaPercent === null ||
            linha.aggregate === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            formatPercent(linha.aggregate.deltaPercent)
          )}
        </td>
        <td className="py-2 px-3 align-top text-right tabular-nums">
          {formatNumber(linha.vehicles, 0)}
        </td>
        <td className="py-2 px-3 align-top text-right font-medium">
          <Impacto linha={linha} />
        </td>
        <td className="py-2 px-3 align-top text-xs text-muted-foreground">
          {/*
            Abrangência, e não "cobertura": esta coluna diz quantos ativos da
            frota o valor mexeu. A cobertura de dados — "temos o dado?" — é outra
            pergunta, com vocabulário próprio, e mora em Cobertura de dados. Dar
            o mesmo nome às duas faria a tela responder uma e parecer responder a
            outra.
          */}
          {linha.coverageLabel ?? "—"}
        </td>
        <td className="py-2 pl-3 pr-5 align-top text-right text-xs">
          {linha.movimentacoes.vigencias === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span
              className={cn(revertido && "font-medium text-foreground")}
              title={`${formatNumber(linha.movimentacoes.ativos, 0)} ativos se mexeram neste atributo ao longo do período`}
            >
              {linha.movimentacoes.vigencias}{" "}
              {linha.movimentacoes.vigencias === 1 ? "vigência" : "vigências"}
            </span>
          )}
        </td>
      </tr>
      {revertido && (
        <tr className="border-b bg-muted/30">
          <td colSpan={8} className="pb-2 pl-4 text-xs text-muted-foreground">
            <span className="inline-flex items-start gap-1.5">
              <Undo2 className="w-3.5 h-3.5 shrink-0 mt-px" />
              Voltou ao valor inicial. Não há diferença entre as pontas — e houve
              movimento em {linha.movimentacoes.vigencias}{" "}
              {linha.movimentacoes.vigencias === 1 ? "vigência" : "vigências"}, em{" "}
              {formatNumber(linha.movimentacoes.ativos, 0)}{" "}
              {linha.movimentacoes.ativos === 1 ? "ativo" : "ativos"}.
            </span>
          </td>
        </tr>
      )}
      {linha.foraDaSoma !== null && !revertido && (
        <tr className="border-b">
          <td colSpan={8} className="pb-2 pl-4 text-xs text-muted-foreground">
            {linha.foraDaSoma.explicacao}
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * O bloco de um equipamento — o cabeçalho que se explica e a tabela.
 *
 * **O cabeçalho declara as duas vigências que ele comparou**, e não as da tela.
 * Elas podem ser diferentes: o QLP vive noutra família de dados e publica no
 * calendário dele, e um bloco que herdasse as datas do equipamento anunciaria
 * uma comparação que não houve.
 *
 * **O contador é "X de Y", com Y do universo canônico** — os atributos que a
 * vigência daquele tipo traz com valor. Contra o número de linhas da tabela, o
 * contador seria "X de X" e não informaria nada; contra o catálogo do Freightech
 * diria que uma unidade que recebe metade das colunas está metade auditada.
 */
export function BlocoDoEquipamento({
  tipo,
  universo,
  linhas,
}: {
  tipo: TipoDaRemuneracao;
  universo: UniversoDoTipo | null;
  linhas: AtributoNaPonta[];
}) {
  if (universo === null) {
    return (
      <section className="rounded-lg border bg-card p-5">
        <h2 className="font-bold">{tipo.titulo}</h2>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-3xl">
          {tipo.semDado}{" "}
          <Link href="/importacoes" className="text-primary hover:underline">
            Importações
          </Link>{" "}
          é onde se vê o que chegou.
        </p>
      </section>
    );
  }

  const porParametro = agruparPorParametro(linhas);

  return (
    <section className="rounded-lg border bg-card overflow-hidden">
      <header className="p-5 border-b">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-bold">{tipo.titulo}</h2>
          <span className="text-sm tabular-nums">
            <strong>
              {formatNumber(universo.alterados, 0)} de{" "}
              {formatNumber(universo.atributos, 0)}
            </strong>{" "}
            <span className="text-muted-foreground">
              {universo.alterados === 1 ? "parâmetro diferente" : "parâmetros diferentes"}
            </span>
            {universo.revertidos > 0 && (
              <span className="text-muted-foreground">
                {" · "}
                {formatNumber(universo.revertidos, 0)}{" "}
                {universo.revertidos === 1 ? "voltou" : "voltaram"} ao inicial
              </span>
            )}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {universo.reason === null ? (
            <>
              {formatNumber(universo.fleet, 0)} ativos · comparado{" "}
              {universo.fromLabel} → {universo.toLabel}
            </>
          ) : (
            <span className="inline-flex items-start gap-1.5 text-foreground">
              <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
              {universo.reason}
            </span>
          )}
        </p>
        {universo.vigencias.length > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            Vigências deste equipamento no período:{" "}
            {universo.vigencias.map((v) => v.label).join(", ")}.
          </p>
        )}
      </header>

      {linhas.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">
          Nenhum parâmetro deste equipamento está diferente entre as duas pontas.
          Isto não quer dizer que eles foram conferidos — quer dizer que a posição
          deles não mudou.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Posição dos parâmetros de {tipo.titulo} entre as duas vigências
              comparadas.
            </caption>
            <thead>
              <tr className="border-b bg-muted/50 text-left text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pl-5 pr-3 font-bold">Atributo</th>
                <th className="py-2 px-3 font-bold text-right">Início</th>
                <th className="py-2 px-3 font-bold text-right">Hoje</th>
                <th className="py-2 px-3 font-bold text-right">Δ</th>
                <th className="py-2 px-3 font-bold text-right">Ativos</th>
                <th className="py-2 px-3 font-bold text-right">Impacto</th>
                <th className="py-2 px-3 font-bold">Abrangência</th>
                <th className="py-2 pl-3 pr-5 font-bold text-right">No caminho</th>
              </tr>
            </thead>
            {porParametro.map(([parametro, doParametro]) => (
              <tbody key={parametro}>
                <tr className="border-b bg-muted/20">
                  <td
                    colSpan={8}
                    className="py-1.5 pl-5 text-[0.6875rem] uppercase tracking-wide font-bold text-muted-foreground"
                  >
                    {parametro}
                  </td>
                </tr>
                {doParametro.map((linha) => (
                  <Linha key={linha.key} linha={linha} />
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </section>
  );
}
