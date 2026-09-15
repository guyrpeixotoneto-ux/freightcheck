import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  LabelList,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TriangleAlert } from "lucide-react";
import { formatBrl, formatBrlShort, formatNumber } from "@/lib/format";
import {
  ROTULO_DO_SENTIDO,
  SELO_DO_SENTIDO,
  escreverDiferenca,
  type ComparacaoDeLucroFixo,
  type TotaisDeLucroFixo,
  type ViradaDeCiclo,
} from "@/lib/lucro-fixo";
import type { EstadoDaLinhaDeLucroFixo } from "@workspace/comparison/lucro-fixo";
import { cn } from "@/lib/utils";

/**
 * Os painéis, e a regra que vale para todos: **nenhum deles soma o que o núcleo
 * não somou.**
 *
 * Cada um recebe a série já agregada e desenha. Agregação em componente de
 * gráfico é como o cartão e o gráfico da mesma tela passam a mostrar números
 * diferentes: um soma a página, o outro soma o recorte.
 */

const COR_DO_ESTADO: Record<EstadoDaLinhaDeLucroFixo, string> = {
  SEM_ALTERACAO: "hsl(var(--success))",
  ALTERADO: "hsl(var(--warning))",
  NOVO_NA_VIGENCIA: "hsl(var(--brand))",
  AUSENTE_NA_COMPARADA: "hsl(var(--destructive))",
  DADO_INCOMPLETO: "hsl(var(--muted-foreground))",
  CONFLITO: "hsl(var(--brand-red))",
};

const ROTULO_DO_TIPO: Record<string, string> = { CAVALO: "Cavalo", CARRETA: "Carreta" };

function Painel({
  titulo,
  fonte,
  children,
}: {
  titulo: string;
  fonte?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="superficie flex min-w-0 flex-col gap-3 p-4">
      <h3 className="text-sm font-bold">{titulo}</h3>
      {children}
      {fonte && <p className="text-[0.7rem] text-muted-foreground">{fonte}</p>}
    </section>
  );
}

/** As duas pontas de cada tipo, na forma que o gráfico de barra pede. */
function porTipo(totais: TotaisDeLucroFixo["totais"]) {
  const mapa = new Map<
    string,
    { tipo: string; base: number; comparada: number; ciclo2Base: number; ciclo2Comparada: number }
  >();
  for (const t of totais) {
    const atual = mapa.get(t.entityType) ?? {
      tipo: ROTULO_DO_TIPO[t.entityType] ?? t.entityType,
      base: 0,
      comparada: 0,
      ciclo2Base: 0,
      ciclo2Comparada: 0,
    };
    if (t.ponta === "BASE") {
      atual.base = t.total;
      atual.ciclo2Base = t.noSegundoCiclo;
    } else {
      atual.comparada = t.total;
      atual.ciclo2Comparada = t.noSegundoCiclo;
    }
    mapa.set(t.entityType, atual);
  }
  return [...mapa.values()];
}

/**
 * Painel 1 — o total de lucro fixo de cada ponta.
 *
 * Vem da leitura das duas vigências, e não do change set, porque um total tem de
 * incluir quem **não** mudou. Soma só a parcela própria: a coluna do conjunto
 * embute a parcela do cavalo vinculado.
 *
 * A linha de baixo — quantos ativos estão no segundo ciclo — não é decoração. Um
 * total que cresce com a mesma quantidade de ativos no segundo ciclo é uma
 * renegociação; um total que cresce porque mais ativos entraram no segundo ciclo
 * é a frota envelhecendo. As duas notícias são diferentes e o total sozinho não
 * as separa.
 */
export function TotalPorVigencia({
  totais,
  rotuloBase,
  rotuloComparada,
}: {
  totais: TotaisDeLucroFixo["totais"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const dados = porTipo(totais);

  return (
    <Painel
      titulo="Lucro fixo total por vigência"
      fonte="Soma da parcela própria de cada equipamento — sem a coluna do conjunto."
    >
      {dados.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma linha de lucro fixo lida nas duas vigências.
        </p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dados} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="tipo" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v: number) => formatBrlShort(v)} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => formatBrl(v)} contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                dataKey="base"
                name={rotuloBase}
                fill="hsl(var(--brand))"
                fillOpacity={0.35}
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="comparada"
                name={rotuloComparada}
                fill="hsl(var(--brand))"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
          <ul className="flex flex-col gap-1 text-[0.7rem] text-muted-foreground">
            {dados.map((d) => (
              <li key={d.tipo}>
                <strong className="font-semibold text-foreground">{d.tipo}</strong>: no segundo
                ciclo, {formatNumber(d.ciclo2Base, 0)} → {formatNumber(d.ciclo2Comparada, 0)}{" "}
                {d.ciclo2Comparada === 1 ? "ativo" : "ativos"} — são eles que de fato recebem.
              </li>
            ))}
          </ul>
        </>
      )}
    </Painel>
  );
}

/** Painel 2 — quantas alterações cada variável teve. */
export function AlteracoesPorVariavel({
  dados,
}: {
  dados: ComparacaoDeLucroFixo["alteracoesPorVariavel"];
}) {
  return (
    <Painel
      titulo="Alterações por variável"
      fonte={
        dados.length === 0
          ? undefined
          : `${formatNumber(
              dados.reduce((acc, d) => acc + d.alteracoes, 0),
              0,
            )} alterações no recorte.`
      }
    >
      {dados.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma variável de lucro fixo se moveu entre as duas vigências.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(160, dados.length * 34)}>
          <BarChart
            data={dados}
            layout="vertical"
            margin={{ top: 4, right: 32, left: 8, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="rotulo"
              width={132}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              formatter={(v: number) => [`${formatNumber(v, 0)}`, "alterações"]}
              contentStyle={{ fontSize: 12 }}
            />
            <Bar dataKey="alteracoes" fill="hsl(var(--brand))" radius={[0, 4, 4, 0]}>
              <LabelList dataKey="alteracoes" position="right" style={{ fontSize: 11 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Painel>
  );
}

/** Painel 3 — os veículos por status. Um veículo numa fatia só, pela gravidade. */
export function DistribuicaoPorEstado({
  dados,
}: {
  dados: ComparacaoDeLucroFixo["distribuicaoPorEstado"];
}) {
  const total = dados.reduce((acc, d) => acc + d.veiculos, 0);
  return (
    <Painel titulo="Veículos por status" fonte={`${formatNumber(total, 0)} veículos no recorte.`}>
      {total === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum veículo neste recorte.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <ResponsiveContainer width="100%" height={188} className="!w-[188px] flex-none">
            <PieChart>
              <Pie
                data={dados}
                dataKey="veiculos"
                nameKey="rotulo"
                innerRadius={52}
                outerRadius={82}
                paddingAngle={1}
                stroke="none"
              >
                {dados.map((d) => (
                  <Cell key={d.estado} fill={COR_DO_ESTADO[d.estado]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v: number, nome: string) => [`${formatNumber(v, 0)} veículos`, nome]}
                contentStyle={{ fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
          <ul className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs">
            {dados.map((d) => (
              <li key={d.estado} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 flex-none rounded-sm"
                  style={{ background: COR_DO_ESTADO[d.estado] }}
                />
                <span className="truncate">{d.rotulo}</span>
                <span className="ml-auto font-mono font-semibold tabular-nums">
                  {formatNumber(d.veiculos, 0)}
                </span>
                <span className="w-12 text-right text-muted-foreground">
                  {formatNumber(d.fracao * 100, 1)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Painel>
  );
}

/**
 * Painel 4 — AS VIRADAS DE CICLO, que é a razão de esta tela existir.
 *
 * ---------------------------------------------------------------------------
 * O que ele responde que nenhum delta em reais responde
 * ---------------------------------------------------------------------------
 * O lucro fixo e a amortização nunca coexistem — 558 linhas, zero coexistências
 * —, e o ciclo diz qual dos dois está valendo. Quando um ativo termina de
 * amortizar, ele sai do ciclo 1 e entra no 2: a amortização vira zero e a
 * remuneração fixa começa. **A linha de lucro fixo da frota sobe sem que ninguém
 * tenha renegociado coisa alguma.**
 *
 * Um recorte que só mostrasse o delta em reais chamaria isso de aumento. Este
 * painel diz o que de fato aconteceu, ativo a ativo, com o dinheiro dos dois
 * lados: quanto de amortização saiu e quanto de lucro fixo entrou.
 *
 * E ele mostra o sentido inverso quando ele aparece. Um ativo não desamortiza;
 * se um voltou ao ciclo 1, ou houve reclassificação ou houve defeito de
 * cadastro. A tela não afirma qual — ela mostra a linha e deixa quem sabe
 * decidir.
 */
export function ViradasDeCiclo({
  viradas,
  rotuloBase,
  rotuloComparada,
}: {
  viradas: readonly ViradaDeCiclo[];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  return (
    <section className="superficie flex min-w-0 flex-col gap-3 p-4">
      <div>
        <h3 className="text-sm font-bold">
          Quem virou o ciclo — de {rotuloBase} para {rotuloComparada}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Lucro fixo e amortização nunca coexistem: 558 linhas medidas, zero coexistências. Quando
          um ativo termina de amortizar, ele entra no segundo ciclo e a remuneração fixa começa —
          e a linha da frota sobe sem que ninguém tenha renegociado nada.
        </p>
      </div>

      {viradas.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nenhum ativo trocou de ciclo entre as duas vigências.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <caption className="sr-only">
              Ativos que trocaram de ciclo entre as duas vigências, com o dinheiro que entrou e o
              que saiu.
            </caption>
            <thead>
              <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
                <th scope="col" className="px-3 py-2 text-left font-bold">Veículo</th>
                <th scope="col" className="px-3 py-2 text-left font-bold">Tipo</th>
                <th scope="col" className="px-3 py-2 text-left font-bold">Ciclo</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Amortização</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Lucro fixo</th>
                <th scope="col" className="px-3 py-2 text-left font-bold">Leitura</th>
              </tr>
            </thead>
            <tbody>
              {viradas.map((v) => (
                <tr
                  key={`${v.entityLabel}-${v.entityType}`}
                  className="border-b last:border-0"
                >
                  <td className="px-3 py-1.5 font-mono font-semibold">{v.entityLabel ?? "—"}</td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">
                    {ROTULO_DO_TIPO[v.entityType] ?? v.entityType}
                  </td>
                  <td className="px-3 py-1.5 font-mono tabular-nums">
                    {v.de} → {v.para}
                  </td>
                  {/*
                    As duas colunas são remuneração e seguem a mesma régua:
                    subir é verde, cair é vermelho. Uma amortização que cai é
                    rubrica deixando de ser paga — piora, não economia. Ver
                    `corDaDiferenca` em `@/lib/lucro-fixo`.
                  */}
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-mono tabular-nums",
                      v.amortizacaoDiferenca === null || v.amortizacaoDiferenca === 0
                        ? ""
                        : v.amortizacaoDiferenca > 0
                          ? "text-success"
                          : "text-destructive",
                    )}
                  >
                    {escreverDiferenca(v.amortizacaoDiferenca, "DINHEIRO")}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-mono font-semibold tabular-nums",
                      v.lucroFixoDiferenca === null || v.lucroFixoDiferenca === 0
                        ? ""
                        : v.lucroFixoDiferenca > 0
                          ? "text-success"
                          : "text-destructive",
                    )}
                  >
                    {escreverDiferenca(v.lucroFixoDiferenca, "DINHEIRO")}
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        SELO_DO_SENTIDO[v.sentido],
                      )}
                    >
                      {ROTULO_DO_SENTIDO[v.sentido]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Painel 5 — as coexistências, que o acervo diz não existirem.
 *
 * Fica escondido quando não há nenhuma, e é de propósito: um painel vazio
 * repetindo "está tudo certo" em toda vigência treina o olho a pular a região
 * onde o achado vai aparecer. Quando aparecer, ele entra com o aviso.
 *
 * Uma medição de zero é a mais frágil que existe — basta uma linha nova para
 * derrubá-la —, e é por isso que a tela pergunta toda vez em vez de confiar na
 * frase escrita em `regras.ts`.
 */
export function Coexistencias({
  coexistencias,
  rotuloComparada,
}: {
  coexistencias: TotaisDeLucroFixo["coexistencias"];
  rotuloComparada: string;
}) {
  if (coexistencias.length === 0) return null;

  return (
    <section className="superficie flex min-w-0 flex-col gap-3 border-warning/40 p-4">
      <div className="flex items-start gap-2">
        <TriangleAlert
          className="mt-0.5 h-4 w-4 flex-none text-warning-foreground"
          aria-hidden="true"
        />
        <div>
          <h3 className="text-sm font-bold">
            {formatNumber(coexistencias.length, 0)}{" "}
            {coexistencias.length === 1 ? "ativo declara" : "ativos declaram"} amortização e lucro
            fixo ao mesmo tempo
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Em {rotuloComparada}. O acervo diz que isto não acontece — 558 linhas medidas, zero
            coexistências —, então ou o modelo mudou, ou o cadastro errou. Nos dois casos, o total
            que esta tela soma está em dúvida para estes ativos.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[32rem] border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
              <th scope="col" className="px-3 py-2 text-left font-bold">Veículo</th>
              <th scope="col" className="px-3 py-2 text-left font-bold">Tipo</th>
              <th scope="col" className="px-3 py-2 text-left font-bold">Ciclo</th>
              <th scope="col" className="px-3 py-2 text-right font-bold">Amortização</th>
              <th scope="col" className="px-3 py-2 text-right font-bold">Lucro fixo</th>
            </tr>
          </thead>
          <tbody>
            {coexistencias.map((c) => (
              <tr key={`${c.entityLabel}-${c.entityType}`} className="border-b last:border-0">
                <td className="px-3 py-1.5 font-mono font-semibold">{c.entityLabel ?? "—"}</td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">
                  {ROTULO_DO_TIPO[c.entityType] ?? c.entityType}
                </td>
                <td className="px-3 py-1.5 font-mono tabular-nums">
                  {c.ciclo === null ? "—" : `Ciclo ${c.ciclo}`}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                  {formatBrl(c.amortizacao)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                  {formatBrl(c.lucroFixo)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Painel 6 — a evolução entre as duas vigências, por tipo. */
export function EvolucaoEntreVigencias({
  totais,
  rotuloBase,
  rotuloComparada,
}: {
  totais: TotaisDeLucroFixo["totais"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const linhas = porTipo(totais);

  return (
    <Painel
      titulo="Evolução entre as duas vigências"
      fonte="A diferença de cada tipo, do total da ponta De para o da ponta Para."
    >
      {linhas.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Sem total para comparar.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {linhas.map((l) => {
            const delta = l.comparada - l.base;
            const variacao = l.base === 0 ? null : (delta / Math.abs(l.base)) * 100;
            return (
              <li key={l.tipo} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="w-16 text-xs font-semibold text-muted-foreground">{l.tipo}</span>
                <span className="font-mono text-sm tabular-nums">{formatBrl(l.base)}</span>
                <span aria-hidden="true" className="text-muted-foreground">
                  →
                </span>
                <span className="font-mono text-sm font-semibold tabular-nums">
                  {formatBrl(l.comparada)}
                </span>
                {/* Receita: subir é verde. */}
                <span
                  className={`font-mono text-xs tabular-nums ${
                    delta > 0
                      ? "text-success"
                      : delta < 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }`}
                >
                  {delta > 0 ? "+" : delta < 0 ? "−" : ""}
                  {formatBrl(Math.abs(delta))}
                  {variacao === null
                    ? " · base zero"
                    : ` · ${variacao > 0 ? "+" : variacao < 0 ? "−" : ""}${formatNumber(
                        Math.abs(variacao),
                        2,
                      )}%`}
                </span>
                <span className="sr-only">
                  {rotuloBase} para {rotuloComparada}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Painel>
  );
}
