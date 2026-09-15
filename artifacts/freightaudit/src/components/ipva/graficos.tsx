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
  ROTULO_DO_VEREDITO,
  SELO_DO_VEREDITO,
  escreverAliquota,
  type ComparacaoDeIpva,
  type TotaisDeIpva,
} from "@/lib/ipva";
import type { EstadoDaLinhaDeIpva } from "@workspace/comparison/ipva";
import { cn } from "@/lib/utils";

/**
 * Os quatro painéis, e a regra que vale para os quatro: **nenhum deles soma o
 * que o núcleo não somou.**
 *
 * Cada um recebe a série já agregada — `totaisDeIpvaPorVigencia`,
 * `alteracoesPorVariavelDeIpva`, `distribuicaoPorEstadoDeIpva`,
 * `aliquotaImplicita` — e desenha. Agregação em componente de gráfico é como o
 * cartão e o gráfico da mesma tela passam a mostrar números diferentes: um soma
 * a página, o outro soma o recorte.
 */

const COR_DO_ESTADO: Record<EstadoDaLinhaDeIpva, string> = {
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

/** As duas pontas de cada tipo, na forma que os gráficos de barra pedem. */
function porTipo(totais: TotaisDeIpva["totais"]) {
  const mapa = new Map<string, { tipo: string; base: number; comparada: number }>();
  for (const t of totais) {
    const atual = mapa.get(t.entityType) ?? {
      tipo: ROTULO_DO_TIPO[t.entityType] ?? t.entityType,
      base: 0,
      comparada: 0,
    };
    if (t.ponta === "BASE") atual.base = t.total;
    else atual.comparada = t.total;
    mapa.set(t.entityType, atual);
  }
  return [...mapa.values()];
}

/**
 * Painel 1 — o total de IPVA de cada ponta.
 *
 * Vem da leitura das duas vigências, e não do change set, porque um total tem de
 * incluir quem **não** mudou. Soma só a coluna anual: a "mensal" da carreta não
 * é 1/12 dela, e juntá-las daria o total de duas grandezas diferentes.
 */
export function TotalPorVigencia({
  totais,
  rotuloBase,
  rotuloComparada,
}: {
  totais: TotaisDeIpva["totais"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const dados = porTipo(totais);
  const negativos = totais.reduce((acc, t) => acc + t.negativos, 0);

  return (
    <Painel
      titulo="Valor total de IPVA por vigência"
      fonte="Soma da coluna anual de cada equipamento — sem a coluna “mensal” da carreta."
    >
      {dados.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma linha de IPVA lida nas duas vigências.
        </p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={220}>
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
          {negativos > 0 && (
            /*
              O negativo entra na soma — a planilha declarou aquele valor, e
              retirá-lo seria maquiar —, mas um total que embute estorno é um
              número diferente de um que não embute, e quem lê tem direito de
              saber em qual dos dois está olhando.
            */
            <p className="flex items-start gap-2 text-[0.7rem] text-warning-foreground">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
              <span>
                {formatNumber(negativos, 0)}{" "}
                {negativos === 1 ? "linha entrou negativa" : "linhas entraram negativas"} nestes
                totais. Continuam somando, como a planilha as declarou — mas um licenciamento
                negativo ou é estorno, ou é erro de cadastro.
              </span>
            </p>
          )}
        </>
      )}
    </Painel>
  );
}

/** Painel 2 — quantas alterações cada variável teve. */
export function AlteracoesPorVariavel({
  dados,
}: {
  dados: ComparacaoDeIpva["alteracoesPorVariavel"];
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
          Nenhuma variável de IPVA se moveu entre as duas vigências.
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

/**
 * Painel 3 — os veículos por status.
 *
 * Um veículo aparece numa fatia só: quem tem conflito conta como conflito ainda
 * que também tenha uma variável alterada. A regra mora no núcleo, e é ela que faz
 * as fatias fecharem no total — uma rosca cujas partes somam 113% é um gráfico
 * em que ninguém acredita.
 */
export function DistribuicaoPorEstado({
  dados,
}: {
  dados: ComparacaoDeIpva["distribuicaoPorEstado"];
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
 * Painel 4 — A ALÍQUOTA IMPLÍCITA, que é a razão de esta tela existir.
 *
 * ---------------------------------------------------------------------------
 * O que ele responde que nenhum delta em reais responde
 * ---------------------------------------------------------------------------
 * O IPVA dividido pelo valor de nota é uma alíquota, e ela distingue as duas
 * coisas que um total em reais confunde: um IPVA **alto** e um IPVA **errado**.
 *
 * Foi assim que o achado do acervo apareceu. De Janeiro a Junho de 2026, as 62
 * placas de cavalo ficaram em exatamente 1,000% da nota, com desvio zero; em
 * Julho, a média caiu para 0,651% e voltou a variar. A linha de IPVA da frota
 * caiu de R$ 989.844 para R$ 268.952 — e chamar isso de economia seria ler como
 * queda de preço o que é troca de fórmula. O painel diz qual dos dois regimes
 * cada ponta está usando, e o rótulo de aviso no percentual único não é engano:
 * desvio zero significa que ninguém calculou placa a placa.
 *
 * **O que ele não faz é fingir a conferência que falta.** Ano-modelo, categoria
 * e UF do emplacamento não estão no acervo, e é com eles que se saberia se
 * 1,000% é a alíquota certa daquele estado. A nota diz isso por extenso, em vez
 * de deixar o número parecer um veredito fiscal.
 *
 * **E os estornos aparecem numa coluna própria, fora da régua.** Um IPVA
 * negativo é crédito, não alíquota baixa; deixá-lo medir dispersão fazia dois
 * lançamentos inverterem o veredito de 71 carretas. Ele sai da medida e continua
 * visível aqui — a coluna existe justamente para que "62 ativos" nunca seja
 * lido como "a vigência só tem 62 linhas".
 */
export function AliquotaImplicita({
  aliquotas,
  rotuloBase,
  rotuloComparada,
}: {
  aliquotas: TotaisDeIpva["aliquotas"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const rotuloDaPonta = (ponta: "BASE" | "COMPARADA") =>
    ponta === "BASE" ? rotuloBase : rotuloComparada;

  return (
    <section className="superficie flex min-w-0 flex-col gap-3 p-4">
      <div>
        <h3 className="text-sm font-bold">Alíquota implícita — o IPVA sobre o valor de nota</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          É o que separa um IPVA alto de um IPVA errado com o que o acervo tem hoje. Quando
          todas as placas caem no mesmo percentual, com desvio praticamente zero, aquilo não é
          dado: é uma fórmula aplicada em bloco — e uma queda ao lado dela é troca de critério,
          não economia.
        </p>
      </div>

      {aliquotas.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nenhum ativo com IPVA e valor de nota nas duas pontas — sem base, não há alíquota.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[42rem] border-collapse text-sm">
            <caption className="sr-only">
              Alíquota implícita de IPVA por vigência e tipo de equipamento.
            </caption>
            <thead>
              <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
                <th scope="col" className="px-3 py-2 text-left font-bold">Vigência</th>
                <th scope="col" className="px-3 py-2 text-left font-bold">Tipo</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Ativos</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Estornos</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Mín.</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Média</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Máx.</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Desvio</th>
                <th scope="col" className="px-3 py-2 text-left font-bold">Leitura</th>
              </tr>
            </thead>
            <tbody>
              {aliquotas.map((a) => (
                <tr key={`${a.ponta}-${a.entityType}`} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{rotuloDaPonta(a.ponta)}</td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">
                    {ROTULO_DO_TIPO[a.entityType] ?? a.entityType}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {formatNumber(a.veiculos, 0)}
                  </td>
                  {/*
                    Zero estorno fica em travessão, e não em "0": numa coluna que
                    quase sempre está vazia, o zero repetido linha após linha
                    rouba o olho do número que importa ao lado.
                  */}
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-mono tabular-nums",
                      a.estornos > 0 ? "text-warning-foreground" : "text-muted-foreground",
                    )}
                  >
                    {a.estornos > 0 ? formatNumber(a.estornos, 0) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {escreverAliquota(a.minima)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                    {escreverAliquota(a.media)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {escreverAliquota(a.maxima)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {escreverAliquota(a.desvio)}
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        SELO_DO_VEREDITO[a.veredito],
                      )}
                    >
                      {ROTULO_DO_VEREDITO[a.veredito]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[0.7rem] text-muted-foreground">
        Ativos sem valor de nota, ou com nota zero, ficam de fora: dividir por zero não produz
        alíquota, e tratá-los como 0% faria a média cair por um cadastro em branco.{" "}
        <strong className="font-semibold">Os estornos também ficam fora da régua</strong> — um
        IPVA negativo é crédito, não alíquota baixa, e dois deles bastavam para inverter o
        veredito de uma frota inteira. Eles continuam somando no impacto e contados no indicador
        de negativos.{" "}
        <strong className="font-semibold">
          O que falta para isto virar conferência fiscal continua faltando:
        </strong>{" "}
        ano-modelo, categoria e a UF do emplacamento, que são o que diria se este percentual é o
        do estado em que a placa está.
      </p>
    </section>
  );
}

/**
 * Painel 5 — a evolução entre as duas vigências, por tipo.
 *
 * Duas pontas ligadas por uma reta: é o formato que responde "para onde foi", que
 * é a pergunta desta tela. Uma série temporal com doze pontos responderia outra —
 * e o par escolhido pode nem ser de meses vizinhos.
 */
export function EvolucaoEntreVigencias({
  totais,
  rotuloBase,
  rotuloComparada,
}: {
  totais: TotaisDeIpva["totais"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const linhas = porTipo(totais);

  return (
    <Painel
      titulo="Evolução entre as duas vigências"
      fonte="A diferença de cada tipo, do total da base para o total da comparada."
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
