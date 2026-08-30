import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBrl, formatBrlShort, periodicitySuffix } from "@/lib/format";
import {
  ROTULO_DA_TENDENCIA,
  serieDaPlaca,
  type AtivoNaEvolucao,
  type EvolucaoPorPlaca,
} from "@/lib/evolucao-por-placa";
import { ComposicaoNoTempoDoPar } from "@/components/evolucao-por-placa/composicao";
import { SeloDePrioridade } from "@/components/evolucao-por-placa/ranking";

/**
 * O detalhe de uma placa — a história inteira de um ativo, num painel.
 *
 * No desktop ele mora à direita da matriz; no celular vira uma folha que sobe
 * por cima, porque um painel de 24rem ao lado de uma matriz num telefone não é
 * um painel, é uma coluna de uma palavra.
 *
 * **A distinção que este painel existe para manter**: o gráfico desenha o
 * *impacto acumulado* (a linha que responde "quanto esta placa está perdendo
 * hoje"), e a tabela do histórico mostra o *impacto de cada vigência* (o
 * movimento). Misturar as duas é o erro clássico desta leitura — uma placa que
 * perdeu em julho e não mexeu em agosto tem movimento zero e acumulado
 * intacto, e as duas coisas precisam continuar dizíveis.
 *
 * O histórico completo desce até a rubrica: do acumulado à vigência, e da
 * vigência às rubricas que a explicam.
 */

export function PainelDaPlaca({
  ativo,
  evolucao,
  onFechar,
}: {
  ativo: AtivoNaEvolucao;
  evolucao: EvolucaoPorPlaca;
  onFechar: () => void;
}) {
  const [historico, setHistorico] = useState(false);
  const sufixo = periodicitySuffix(evolucao.periodicidade);
  const serie = serieDaPlaca(ativo, evolucao.colunas);

  return (
    <aside className="bg-card border rounded-xl shadow-sm p-5 lg:sticky lg:top-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold leading-none">{ativo.rotulo}</h2>
            <SeloDePrioridade prioridade={ativo.prioridade} />
          </div>
          {ativo.componentes && (
            <p className="mt-1 text-xs text-muted-foreground">
              Cavalo {ativo.componentes.cavalo?.plate ?? "—"} · Carreta{" "}
              {ativo.componentes.carreta?.plate ?? "—"}
            </p>
          )}
          {ativo.placasAnteriores.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Também apareceu como {ativo.placasAnteriores.join(", ")} — é o mesmo ativo,
              numa linha só.
            </p>
          )}
        </div>
        <button
          onClick={onFechar}
          aria-label="Fechar o detalhe da placa"
          className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="mt-4">
        <p className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
          Impacto acumulado
        </p>
        <p
          className={cn(
            "text-2xl font-bold tabular-nums leading-none mt-1",
            ativo.acumulado === null
              ? "text-amber-700"
              : ativo.acumulado < 0
                ? "text-red-700"
                : "text-emerald-700",
          )}
        >
          {ativo.acumulado === null ? "sem valoração" : formatBrlShort(ativo.acumulado)}
          {ativo.acumulado !== null && (
            <span className="text-base font-normal text-muted-foreground">{sufixo}</span>
          )}
        </p>
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        <Linha rotulo="Alterações" valor={String(ativo.alteracoes)} />
        <Linha
          rotulo="Vigências afetadas"
          valor={`${ativo.vigenciasAfetadas} de ${evolucao.colunas.length}`}
        />
        {ativo.componentes && (
          /*
            "Vigências juntos" e "vigências afetadas" respondem coisas
            diferentes, e as duas ficam à vista: a primeira é quanto tempo esta
            composição existiu, a segunda é em quantas dessas ela se mexeu. Um
            conjunto que existiu em duas de oito vigências e mudou nas duas não
            é o mesmo caso de um que existiu nas oito e mudou em duas.
          */
          <Linha
            rotulo="Vigências juntos"
            valor={`${ativo.vigenciasJuntos} de ${evolucao.colunas.length}`}
          />
        )}
        <Linha
          rotulo="Tendência"
          valor={ROTULO_DA_TENDENCIA[ativo.tendencia]}
          classe={
            ativo.tendencia === "PIORANDO"
              ? "text-red-700"
              : ativo.tendencia === "MELHORANDO"
                ? "text-emerald-700"
                : ativo.tendencia === "SEM_VALORACAO"
                  ? "text-amber-700"
                  : undefined
          }
        />
        {ativo.semValoracao > 0 && (
          <Linha
            rotulo="Sem valoração"
            valor={`${ativo.semValoracao} ${ativo.semValoracao === 1 ? "alteração" : "alterações"}`}
            classe="text-amber-700"
          />
        )}
        <Linha rotulo="Unidade" valor={nomeDaUnidadeDoContexto(evolucao)} />
        <Linha
          rotulo="Tipo"
          valor={
            /*
              Um conjunto não tem `entity_type` — ele é o par, e não uma
              entidade. Mostrar "—" aqui daria a impressão de dado faltando onde
              a resposta existe e é outra.
            */
            ativo.componentes
              ? `Conjunto (${ativo.componentes.cavalo ? "cavalo" : "sem cavalo"} + ${ativo.componentes.carreta ? "carreta" : "sem carreta"})`
              : rotuloDoTipo(ativo.entityType)
          }
        />
        <Linha rotulo="Canal" valor={evolucao.context.channel ?? "—"} />
      </dl>

      {/* ---- por que esta placa está na fila --------------------------------- */}
      {ativo.motivos.length > 0 && (
        <div className="mt-4 rounded-lg border bg-muted/40 px-3 py-2.5">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
            Por que ela tem prioridade {ativo.score.toFixed(0)}/100
          </p>
          <ul className="mt-1.5 space-y-1">
            {ativo.motivos.map((motivo) => (
              <li key={motivo.chave} className="text-xs flex gap-2">
                <span className="font-semibold tabular-nums w-9 shrink-0">
                  +{motivo.pontos}
                </span>
                <span className="text-muted-foreground">{motivo.detalhe}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- o gráfico do acumulado ----------------------------------------- */}
      <div className="mt-5">
        <p className="text-sm font-semibold">Impacto acumulado (R${sufixo})</p>
        <p className="text-xs text-muted-foreground">
          A linha é o acumulado do período — não o movimento de cada vigência, que está
          no histórico abaixo.
        </p>
        <div className="h-40 mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={serie} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => formatBrlShort(v).replace("R$ ", "")}
              />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              <Tooltip
                formatter={(valor: number) => [`${formatBrl(valor)}${sufixo}`, "Acumulado"]}
                labelFormatter={(rotulo: string) => `Até ${rotulo}`}
              />
              <Line
                type="monotone"
                dataKey="acumulado"
                stroke={
                  (ativo.acumulado ?? 0) < 0 ? "hsl(0 72% 51%)" : "hsl(160 84% 32%)"
                }
                strokeWidth={2}
                dot={{ r: 2.5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <button
        onClick={() => setHistorico((aberto) => !aberto)}
        className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        {historico ? "Ocultar histórico" : "Ver histórico completo"}
        <ArrowRight className="w-4 h-4" />
      </button>

      {ativo.componentes && (
        <ComposicaoNoTempoDoPar composicao={ativo.composicao} ativo={ativo} />
      )}

      {historico && <HistoricoCompleto ativo={ativo} evolucao={evolucao} />}
    </aside>
  );
}

function Linha({
  rotulo,
  valor,
  classe,
}: {
  rotulo: string;
  valor: string;
  classe?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b pb-2 last:border-0">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className={cn("font-medium tabular-nums text-right", classe)}>{valor}</dd>
    </div>
  );
}

/**
 * A história cronológica da placa, vigência a vigência, com as rubricas.
 *
 * A vigência sem alteração aparece escrita ("Sem alteração") em vez de sumir:
 * é o que separa "esta placa esteve quieta em março" de "março não existe" — e
 * é a mesma recusa que a matriz pratica ao desenhar um travessão no lugar de um
 * R$ 0.
 */
function HistoricoCompleto({
  ativo,
  evolucao,
}: {
  ativo: AtivoNaEvolucao;
  evolucao: EvolucaoPorPlaca;
}) {
  const sufixo = periodicitySuffix(evolucao.periodicidade);
  const porPeriodo = new Map(ativo.celulas.map((c) => [c.period, c]));

  return (
    <div className="mt-4 border-t pt-4">
      <p className="text-sm font-semibold">Histórico completo</p>
      <ol className="mt-3 space-y-3">
        {[...evolucao.colunas].reverse().map((coluna) => {
          const celula = porPeriodo.get(coluna.period);
          return (
            <li key={coluna.period} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{coluna.label}</span>
                <span
                  className={cn(
                    "tabular-nums font-semibold",
                    celula === undefined
                      ? "text-muted-foreground"
                      : celula.net === null
                        ? "text-amber-700"
                        : celula.net < 0
                          ? "text-red-700"
                          : celula.net > 0
                            ? "text-emerald-700"
                            : "text-muted-foreground",
                  )}
                >
                  {celula === undefined
                    ? "Sem alteração"
                    : celula.net === null
                      ? "Sem valoração"
                      : `${formatBrlShort(celula.net)}${sufixo}`}
                </span>
              </div>
              {celula !== undefined && (
                <>
                  <p className="text-xs text-muted-foreground">
                    {celula.alteracoes}{" "}
                    {celula.alteracoes === 1 ? "alteração" : "alterações"}
                    {celula.semValoracao > 0 && ` · ${celula.semValoracao} sem valoração`}
                    {celula.outraPeriodicidade > 0 &&
                      ` · ${celula.outraPeriodicidade} em outra grandeza`}
                  </p>
                  {/*
                    O degrau final: a vigência aberta nas rubricas que a
                    explicam. É o que permite sair do "−R$ 3.200 em agosto" e
                    chegar em "Produtividade −R$ 2.100, Diária −R$ 1.100" sem
                    trocar de tela.
                  */}
                  <ul className="mt-1 ml-3 space-y-0.5 border-l pl-2">
                    {celula.rubricas.slice(0, 5).map((rubrica) => (
                      <li
                        key={rubrica.parameterKey}
                        className="flex items-baseline justify-between gap-2 text-xs"
                      >
                        <span className="truncate text-muted-foreground">
                          {rubrica.nome}
                          {rubrica.alteracoes > 1 && ` (${rubrica.alteracoes})`}
                        </span>
                        <span
                          className={cn(
                            "tabular-nums shrink-0",
                            rubrica.impacto === null
                              ? "text-amber-700"
                              : rubrica.impacto < 0
                                ? "text-red-700"
                                : "text-emerald-700",
                          )}
                        >
                          {rubrica.impacto === null
                            ? "sem valoração"
                            : formatBrlShort(rubrica.impacto)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </li>
          );
        })}
      </ol>

      <p className="mt-4 text-sm font-semibold">Rubricas desta placa no período</p>
      <ul className="mt-2 space-y-1.5">
        {ativo.rubricas.slice(0, 10).map((rubrica) => (
          <li
            key={rubrica.parameterKey}
            className="flex items-baseline justify-between gap-3 text-sm"
          >
            <span className="min-w-0">
              <span className="block truncate">{rubrica.nome}</span>
              <span className="block text-xs text-muted-foreground">
                {rubrica.alteracoes}{" "}
                {rubrica.alteracoes === 1 ? "alteração" : "alterações"} em{" "}
                {rubrica.vigencias}{" "}
                {rubrica.vigencias === 1 ? "vigência" : "vigências"}
              </span>
            </span>
            <span
              className={cn(
                "tabular-nums font-medium shrink-0",
                rubrica.impacto === null
                  ? "text-amber-700"
                  : rubrica.impacto < 0
                    ? "text-red-700"
                    : "text-emerald-700",
              )}
            >
              {rubrica.impacto === null
                ? "sem valoração"
                : formatBrlShort(rubrica.impacto)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function nomeDaUnidadeDoContexto(evolucao: EvolucaoPorPlaca): string {
  // "CAMAÇARI · EMPURRADA" — o canal já aparece na linha de baixo.
  return evolucao.context.label.split(" · ")[0] ?? evolucao.context.label;
}

function rotuloDoTipo(entityType: string | null): string {
  if (entityType === null) return "—";
  const primeira = entityType.charAt(0) + entityType.slice(1).toLowerCase();
  return primeira;
}
