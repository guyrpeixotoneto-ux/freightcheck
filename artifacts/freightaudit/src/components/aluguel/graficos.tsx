import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Info } from "lucide-react";
import type { EstadoDaLinhaDeAluguel } from "@workspace/comparison/aluguel";
import { formatBrl, formatNumber } from "@/lib/format";
import {
  ROTULO_DO_TIPO,
  ROTULO_DO_VEREDITO_DO_ALUGUEL,
  SELO_DO_VEREDITO,
  type ComparacaoDeAluguel,
  type TotaisDeAluguel,
} from "@/lib/aluguel";
import { cn } from "@/lib/utils";

/**
 * Os quatro painéis, e a regra que vale para os quatro: **nenhum deles soma o
 * que o núcleo não somou.**
 *
 * Cada um recebe a série já agregada — `totaisDeAluguelPorVigencia`,
 * `conferenciaDoAluguel`, `alteracoesPorVariavelDeAluguel`,
 * `distribuicaoPorEstadoDeAluguel` — e desenha. Agregação em componente de
 * gráfico é como o cartão e o gráfico da mesma tela passam a mostrar números
 * diferentes.
 */

const COR_DO_ESTADO: Record<EstadoDaLinhaDeAluguel, string> = {
  SEM_ALTERACAO: "hsl(var(--success))",
  ALTERADO: "hsl(var(--warning))",
  NOVO_NA_VIGENCIA: "hsl(var(--brand))",
  AUSENTE_NA_COMPARADA: "hsl(var(--destructive))",
  DADO_INCOMPLETO: "hsl(var(--muted-foreground))",
  CONFLITO: "hsl(var(--brand-red))",
};

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
function porTipo(totais: TotaisDeAluguel["totais"]) {
  const mapa = new Map<
    string,
    {
      tipo: string;
      base: number;
      comparada: number;
      alugadosBase: number;
      alugadosComparada: number;
      ativosComparada: number;
      fracaoComparada: number;
    }
  >();
  for (const t of totais) {
    const atual = mapa.get(t.entityType) ?? {
      tipo: ROTULO_DO_TIPO[t.entityType] ?? t.entityType,
      base: 0,
      comparada: 0,
      alugadosBase: 0,
      alugadosComparada: 0,
      ativosComparada: 0,
      fracaoComparada: 0,
    };
    if (t.ponta === "BASE") {
      atual.base = t.total;
      atual.alugadosBase = t.alugados;
    } else {
      atual.comparada = t.total;
      atual.alugadosComparada = t.alugados;
      atual.ativosComparada = t.ativos;
      atual.fracaoComparada = t.fracaoAlugada;
    }
    mapa.set(t.entityType, atual);
  }
  return [...mapa.values()];
}

/**
 * Painel 1 — o aluguel mensal de cada ponta.
 *
 * **É por mês, e o título diz isso.** O número é o que a frota alugada custa no
 * mês daquela vigência — não no ano e não no contrato —, e é assim que a
 * curadoria confirmou a coluna.
 *
 * A fração alugada vem escrita embaixo porque o total sozinho não se lê:
 * R$ 11.777,92 pode ser duas carretas de oitenta ou vinte de oitenta, e as duas
 * leituras pedem conversas diferentes com o cliente.
 */
export function AluguelPorVigencia({
  totais,
  rotuloBase,
  rotuloComparada,
}: {
  totais: TotaisDeAluguel["totais"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const dados = porTipo(totais).filter((d) => d.base > 0 || d.comparada > 0);

  return (
    <Painel
      titulo="Aluguel mensal da frota, por vigência"
      fonte="Soma dos aluguéis declarados em cada ponta, por mês. Confirmado MENSAL pela curadoria — não se soma ao IPVA anual nem à nota pontual."
    >
      {dados.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum implemento alugado nestas duas vigências — a frota deste recorte é toda
          financiada ou própria.
        </p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dados} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="tipo" tick={{ fontSize: 11 }} />
              <YAxis
                tickFormatter={(v: number) => formatBrl(v, 0)}
                tick={{ fontSize: 11 }}
                width={84}
              />
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
          {dados.map((d) => (
            <p key={d.tipo} className="text-[0.7rem] text-muted-foreground">
              <b className="text-foreground">{d.tipo}</b>: {formatNumber(d.alugadosComparada, 0)} de{" "}
              {formatNumber(d.ativosComparada, 0)} ativos alugados na comparada —{" "}
              {formatNumber(d.fracaoComparada * 100, 1)}% da frota lida
              {d.alugadosBase !== d.alugadosComparada && (
                <> · eram {formatNumber(d.alugadosBase, 0)} na base</>
              )}
              .
            </p>
          ))}
        </>
      )}
    </Painel>
  );
}

/**
 * Painel 2 — a conferência da parcela.
 *
 * É a leitura própria desta tela, e a única que nenhuma outra do produto faz: no
 * implemento alugado não há financiamento, então amortização e juros são zero e
 * a parcela FINAME **é** o aluguel, ao centavo.
 *
 * `MISTO` é o veredito que mais importa e o menos provável. Um implemento que
 * declarasse aluguel **e** financiamento ao mesmo tempo quebraria a identidade
 * das três parcelas — e, com ela, a regra que impede a dupla contagem entre esta
 * tela e a de FINAME. Por isso ele tem a cor mais grave dos quatro.
 */
export function ConferenciaDaParcela({
  conferencias,
  rotuloBase,
  rotuloComparada,
}: {
  conferencias: TotaisDeAluguel["conferencias"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const rotuloDaPonta = (ponta: "BASE" | "COMPARADA") =>
    ponta === "BASE" ? rotuloBase : rotuloComparada;
  const comAluguel = conferencias.filter((c) => c.alugados > 0);

  return (
    <Painel
      titulo="Nos alugados, a parcela FINAME é o aluguel?"
      fonte="Compara, ativo a ativo, a parcela do implemento com o aluguel dele. Só olha quem declara aluguel — cobrar essa identidade de um implemento financiado seria cobrar uma conta que não é a dele."
    >
      {comAluguel.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum implemento deste recorte declara aluguel — sem alugados não há o que conferir.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
                <th scope="col" className="px-3 py-2 text-left font-bold">
                  Vigência
                </th>
                <th scope="col" className="px-3 py-2 text-left font-bold">
                  Tipo
                </th>
                <th scope="col" className="px-3 py-2 text-right font-bold">
                  Alugados
                </th>
                <th scope="col" className="px-3 py-2 text-right font-bold">
                  Parcela = aluguel
                </th>
                <th scope="col" className="px-3 py-2 text-right font-bold">
                  Por mês
                </th>
                <th scope="col" className="px-3 py-2 text-left font-bold">
                  Leitura
                </th>
              </tr>
            </thead>
            <tbody>
              {comAluguel.map((c) => (
                <tr
                  key={`${c.ponta}${c.entityType}`}
                  className="border-b border-superficie-borda last:border-0"
                >
                  <td className="whitespace-nowrap px-3 py-2">{rotuloDaPonta(c.ponta)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {ROTULO_DO_TIPO[c.entityType] ?? c.entityType}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                    {formatNumber(c.alugados, 0)}
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums",
                      c.parcelaEhOAluguel < c.alugados && "font-semibold text-destructive",
                    )}
                  >
                    {formatNumber(c.parcelaEhOAluguel, 0)} de {formatNumber(c.alugados, 0)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold tabular-nums">
                    {formatBrl(c.totalMensal)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        SELO_DO_VEREDITO[c.veredito],
                      )}
                    >
                      {ROTULO_DO_VEREDITO_DO_ALUGUEL[c.veredito]}
                    </span>
                    {c.mistos > 0 && (
                      <span className="ml-2 text-xs text-destructive">
                        {formatNumber(c.mistos, 0)} com financiamento junto
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="flex items-start gap-2 text-[0.7rem] text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
        <span>
          <b className="text-foreground">Esta identidade é o que impede a dupla contagem.</b> A
          parcela FINAME é amortização + juros + aluguel, e nos alugados os dois primeiros são
          zero. É por o aluguel ser parcela que a parcela sai do total da Auditoria de FINAME
          quando ele se move — e é por isso que um veredito &ldquo;misto&rdquo; aqui exige olhar
          placa a placa antes de ler qualquer total.
        </span>
      </p>
    </Painel>
  );
}

/** Painel 3 — quantas alterações cada variável teve. */
export function AlteracoesPorVariavel({
  dados,
}: {
  dados: ComparacaoDeAluguel["alteracoesPorVariavel"];
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
          Nenhuma coluna do aluguel se moveu entre as duas vigências.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(160, dados.length * 40)}>
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
              width={148}
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
 * Painel 4 — os ativos por status.
 *
 * Um ativo aparece numa fatia só: quem tem conflito conta como conflito ainda
 * que também tenha uma variável alterada. A regra mora no núcleo, e é ela que
 * faz as fatias fecharem no total.
 */
export function DistribuicaoPorEstado({
  dados,
}: {
  dados: ComparacaoDeAluguel["distribuicaoPorEstado"];
}) {
  const total = dados.reduce((acc, d) => acc + d.veiculos, 0);
  return (
    <Painel titulo="Ativos por status" fonte={`${formatNumber(total, 0)} ativos no recorte.`}>
      {total === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum ativo neste recorte.
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
                formatter={(v: number, nome: string) => [`${formatNumber(v, 0)} ativos`, nome]}
                contentStyle={{ fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
          <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
            {dados.map((d) => (
              <li key={d.estado} className="flex items-center gap-2 text-xs">
                <span
                  className="h-2.5 w-2.5 flex-none rounded-full"
                  style={{ backgroundColor: COR_DO_ESTADO[d.estado] }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">{d.rotulo}</span>
                <span className="font-mono tabular-nums">{formatNumber(d.veiculos, 0)}</span>
                <span className="w-12 text-right font-mono tabular-nums text-muted-foreground">
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
