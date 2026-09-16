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
import { formatBrl, formatBrlShort, formatNumber } from "@/lib/format";
import type { ComparacaoDeFiname, TotaisDeFiname } from "@/lib/finame";
import type { EstadoDaLinhaDeFiname } from "@workspace/comparison/finame";

/**
 * Os quatro gráficos, e a regra que vale para os quatro: **nenhum deles soma o
 * que o núcleo não somou.**
 *
 * Cada um recebe a série já agregada — `totaisPorVigencia`,
 * `alteracoesPorVariavel`, `distribuicaoPorEstado` — e desenha. Agregação em
 * componente de gráfico é como o cartão e o gráfico da mesma tela passam a
 * mostrar números diferentes: um soma a página, o outro soma o recorte.
 */

const COR_DO_ESTADO: Record<EstadoDaLinhaDeFiname, string> = {
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

/**
 * Gráfico 1 — o total de parcela FINAME de cada ponta.
 *
 * Vem da leitura das duas vigências, e não do change set, porque um total tem
 * de incluir quem **não** mudou. Soma só a parcela: juros e amortização são as
 * partes dela, e o total composto da carreta embute a parcela do cavalo.
 */
export function TotalPorVigencia({
  totais,
  rotuloBase,
  rotuloComparada,
}: {
  totais: TotaisDeFiname["totais"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const porTipo = new Map<string, { tipo: string; base: number; comparada: number }>();
  for (const t of totais) {
    const atual = porTipo.get(t.entityType) ?? {
      tipo: t.entityType === "CAVALO" ? "Cavalo" : "Carreta",
      base: 0,
      comparada: 0,
    };
    if (t.ponta === "BASE") atual.base = t.total;
    else atual.comparada = t.total;
    porTipo.set(t.entityType, atual);
  }
  const dados = [...porTipo.values()];

  return (
    <Painel
      titulo="Valor total de FINAME por vigência"
      fonte="Soma da parcela de cada equipamento — sem juros, sem amortização e sem total composto."
    >
      {dados.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma parcela lida nas duas vigências.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={dados} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="tipo" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v: number) => formatBrlShort(v)} tick={{ fontSize: 11 }} />
            <Tooltip
              formatter={(v: number) => formatBrl(v)}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="base" name={rotuloBase} fill="hsl(var(--brand))" fillOpacity={0.35} radius={[4, 4, 0, 0]} />
            <Bar dataKey="comparada" name={rotuloComparada} fill="hsl(var(--brand))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Painel>
  );
}

/** Gráfico 2 — quantas alterações cada variável teve. */
export function AlteracoesPorVariavel({
  dados,
}: {
  dados: ComparacaoDeFiname["alteracoesPorVariavel"];
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
          Nenhuma variável de FINAME se moveu entre as duas vigências.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(160, dados.length * 28)}>
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
              width={112}
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
 * Gráfico 3 — os veículos por status.
 *
 * Um veículo aparece numa fatia só: quem tem conflito conta como conflito ainda
 * que também tenha uma variável alterada. A regra mora no núcleo
 * (`distribuicaoPorEstado`), e é ela que faz as fatias fecharem no total — uma
 * rosca cujas partes somam 113% é um gráfico em que ninguém acredita.
 */
export function DistribuicaoPorEstado({
  dados,
}: {
  dados: ComparacaoDeFiname["distribuicaoPorEstado"];
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
          {/*
            A legenda tem largura mínima, e é ela que conserta o rótulo cortado.

            `min-w-0` deixava a lista encolher até o fim: ao lado da rosca de
            188px, num painel de três colunas, sobravam uns 120px para o rótulo
            disputar com a contagem e o percentual — e "Sem alteração" saía
            como "S…". Um estado de auditoria abreviado a uma letra não é
            legenda; é um enigma ao lado de um gráfico colorido.

            Com um piso de 13rem, o `flex-wrap` do contêiner faz o que ele já
            sabia fazer: quando não cabe do lado, a legenda desce para a linha
            de baixo e ocupa a largura inteira do painel. Nada é escondido em
            nenhuma das duas larguras.
          */}
          <ul className="flex min-w-[13rem] flex-1 flex-col gap-1.5 text-xs">
            {dados.map((d) => (
              <li key={d.estado} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 flex-none rounded-sm"
                  style={{ background: COR_DO_ESTADO[d.estado] }}
                />
                {/* Sem `truncate`: o rótulo quebra em duas linhas antes de sumir. */}
                <span className="leading-tight">{d.rotulo}</span>
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
 * Gráfico 4 — a evolução entre as duas vigências, por tipo.
 *
 * Duas pontas ligadas por uma reta: é o formato que responde "para onde foi",
 * que é a pergunta desta tela. Uma série temporal com doze pontos responderia
 * outra — e o par escolhido pode nem ser de meses vizinhos.
 */
export function EvolucaoEntreVigencias({
  totais,
  rotuloBase,
  rotuloComparada,
}: {
  totais: TotaisDeFiname["totais"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const porTipo = new Map<string, { tipo: string; base: number; comparada: number }>();
  for (const t of totais) {
    const atual = porTipo.get(t.entityType) ?? {
      tipo: t.entityType === "CAVALO" ? "Cavalo" : "Carreta",
      base: 0,
      comparada: 0,
    };
    if (t.ponta === "BASE") atual.base = t.total;
    else atual.comparada = t.total;
    porTipo.set(t.entityType, atual);
  }
  const linhas = [...porTipo.values()];

  return (
    <Painel
      titulo="Evolução entre as duas vigências"
      fonte="A diferença de cada tipo, do total da base para o total da comparada."
    >
      {linhas.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Sem total para comparar.
        </p>
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
                    delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground"
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
