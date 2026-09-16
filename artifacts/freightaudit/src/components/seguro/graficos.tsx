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
import type { EstadoDaLinhaDeSeguro } from "@workspace/comparison/seguro";
import { formatBrl, formatBrlShort, formatNumber } from "@/lib/format";
import {
  ROTULO_DO_VEREDITO_DO_APARATO,
  SELO_DO_VEREDITO,
  type ComparacaoDeSeguro,
  type TotaisDeSeguro,
} from "@/lib/seguro";
import { cn } from "@/lib/utils";

/**
 * Os cinco painéis, e a regra que vale para os cinco: **nenhum deles soma o que
 * o núcleo não somou.**
 *
 * Cada um recebe a série já agregada — `totaisDeSeguroPorVigencia`,
 * `alteracoesPorVariavelDeSeguro`, `distribuicaoPorEstadoDeSeguro`,
 * `conferenciaDoAparato` — e desenha. Agregação em componente de gráfico é como
 * o cartão e o gráfico da mesma tela passam a mostrar números diferentes: um
 * soma a página, o outro soma o recorte.
 */

const COR_DO_ESTADO: Record<EstadoDaLinhaDeSeguro, string> = {
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
function porTipo(totais: TotaisDeSeguro["totais"]) {
  const mapa = new Map<
    string,
    { tipo: string; base: number; comparada: number; seguroBase: number; taxasBase: number }
  >();
  for (const t of totais) {
    const atual = mapa.get(t.entityType) ?? {
      tipo: ROTULO_DO_TIPO[t.entityType] ?? t.entityType,
      base: 0,
      comparada: 0,
      seguroBase: 0,
      taxasBase: 0,
    };
    if (t.ponta === "BASE") {
      atual.base = t.total;
      atual.seguroBase = t.seguro;
      atual.taxasBase = t.taxas;
    } else {
      atual.comparada = t.total;
    }
    mapa.set(t.entityType, atual);
  }
  return [...mapa.values()];
}

/**
 * Painel 1 — o aparato total de cada ponta.
 *
 * Vem da leitura das duas vigências, e não do change set, porque um total tem de
 * incluir quem **não** mudou — e nesta rubrica isso é quase tudo: três das cinco
 * colunas são taxa fixa.
 *
 * **O rastreador não está na barra.** Somá-lo não mudaria o número — ele é zero
 * em toda parte — e mudaria o que o número afirma: uma barra que o inclui diz
 * que o rastreamento está contado.
 */
export function TotalPorVigencia({
  totais,
  rotuloBase,
  rotuloComparada,
}: {
  totais: TotaisDeSeguro["totais"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const dados = porTipo(totais);
  const semTacografo = totais
    .filter((t) => t.ponta === "COMPARADA")
    .reduce((acc, t) => acc + t.semTacografo, 0);

  return (
    <Painel
      titulo="Aparato total por vigência"
      fonte="Seguro, revestimento, faixa refletiva e tacógrafo. O rastreador é zero em todas as linhas e não entra."
    >
      {dados.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma linha de aparato lida nas duas vigências.
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
          {dados.map((d) => (
            <p key={d.tipo} className="text-[0.7rem] text-muted-foreground">
              <b className="text-foreground">{d.tipo}</b>, na base: {formatBrl(d.seguroBase)} de
              seguro negociado por ativo · {formatBrl(d.taxasBase)} de taxa igual para a frota.
            </p>
          ))}
          {semTacografo > 0 && (
            <p className="text-[0.7rem] text-muted-foreground">
              {formatNumber(semTacografo, 0)}{" "}
              {semTacografo === 1 ? "carreta declara" : "carretas declaram"} tacógrafo zerado na
              vigência comparada — é o único zero desta rubrica que convive com valor na mesma
              coluna.
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
  dados: ComparacaoDeSeguro["alteracoesPorVariavel"];
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
          Nenhuma coluna do aparato se moveu entre as duas vigências.
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
 * Painel 3 — os veículos por status.
 *
 * Um veículo aparece numa fatia só: quem tem conflito conta como conflito ainda
 * que também tenha uma variável alterada. A regra mora no núcleo, e é ela que
 * faz as fatias fecharem no total.
 */
export function DistribuicaoPorEstado({
  dados,
}: {
  dados: ComparacaoDeSeguro["distribuicaoPorEstado"];
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
          <ul className="flex min-w-[13rem] flex-1 flex-col gap-1.5 text-xs">
            {dados.map((d) => (
              <li key={d.estado} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 flex-none rounded-sm"
                  style={{ background: COR_DO_ESTADO[d.estado] }}
                />
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
 * Painel 4 — A CONFERÊNCIA CONTRA O CUSTO FIXO, que é a razão de esta tela
 * existir.
 *
 * ---------------------------------------------------------------------------
 * O que ele responde que nenhum total em reais responde
 * ---------------------------------------------------------------------------
 * A pergunta não é *quanto* custa o aparato — a barra ao lado responde isso. É
 * **se esse dinheiro está em algum total que a casa já usa**. E a resposta, no
 * acervo, é que não está: `carreta.custo_fixo` é, em 657 de 657 linhas e ao
 * centavo, `carreta.finame` + `carreta.lucro_fixomodelo_novo_ciclo`. Acrescente
 * o aparato à conta e ela deixa de fechar.
 *
 * O painel **mede** isso em vez de afirmá-lo: ele mostra o que sobra do custo
 * fixo depois das duas parcelas conhecidas, e compara essa sobra com o aparato
 * do mesmo ativo. Se um dia a Ambev mudar a composição do `custo_fixo`, esta
 * tela muda de veredito sozinha — que é a razão de ela medir.
 *
 * **`MISTO` é o veredito que mais importa e o menos provável.** Se o aparato
 * estivesse dentro em algumas carretas e fora em outras, nenhum total da casa
 * poderia ser somado sem olhar linha a linha — e é por isso que ele tem a cor
 * mais grave dos quatro.
 */
export function ConferenciaDoCustoFixo({
  conferencias,
  rotuloBase,
  rotuloComparada,
}: {
  conferencias: TotaisDeSeguro["conferencias"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const rotuloDaPonta = (ponta: "BASE" | "COMPARADA") =>
    ponta === "BASE" ? rotuloBase : rotuloComparada;
  const mensuraveis = conferencias.filter((c) => c.ativos > 0);

  return (
    <Painel
      titulo="O aparato está no custo fixo declarado?"
      fonte="Mede o que sobra do custo fixo depois do FINAME e do lucro fixo, e compara com o aparato do mesmo ativo."
    >
      {mensuraveis.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum ativo tem ao mesmo tempo custo fixo, as duas parcelas que o compõem e alguma
          coluna de aparato — sem os três não há o que conferir.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
                <th scope="col" className="px-3 py-2 text-left font-bold">
                  Vigência
                </th>
                <th scope="col" className="px-3 py-2 text-left font-bold">
                  Tipo
                </th>
                <th scope="col" className="px-3 py-2 text-right font-bold">
                  Ativos
                </th>
                <th scope="col" className="px-3 py-2 text-right font-bold">
                  Dentro
                </th>
                <th scope="col" className="px-3 py-2 text-right font-bold">
                  Fora, em R$
                </th>
                <th scope="col" className="px-3 py-2 text-left font-bold">
                  Leitura
                </th>
              </tr>
            </thead>
            <tbody>
              {mensuraveis.map((c) => (
                <tr
                  key={`${c.ponta}${c.entityType}`}
                  className="border-b border-superficie-borda last:border-0"
                >
                  <td className="whitespace-nowrap px-3 py-2">{rotuloDaPonta(c.ponta)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {ROTULO_DO_TIPO[c.entityType] ?? c.entityType}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                    {formatNumber(c.ativos, 0)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                    {formatNumber(c.dentro, 0)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold tabular-nums">
                    {c.foraEmReais === 0 ? "—" : formatBrl(c.foraEmReais)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        SELO_DO_VEREDITO[c.veredito],
                      )}
                    >
                      {ROTULO_DO_VEREDITO_DO_APARATO[c.veredito]}
                    </span>
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
          <b className="text-foreground">Fora do total não quer dizer errado.</b> Quer dizer que
          este dinheiro não está somado em lugar nenhum que o export entregue — e que quem
          orçar a carreta pelo custo fixo declarado vai orçá-la a menos. O que falta para
          fechar a conta é a Ambev dizer onde o aparato deveria entrar.
        </span>
      </p>
    </Painel>
  );
}

/** Painel 5 — a diferença de cada tipo, do total da base para o da comparada. */
export function EvolucaoEntreVigencias({
  totais,
  rotuloBase,
  rotuloComparada,
}: {
  totais: TotaisDeSeguro["totais"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const linhas = porTipo(totais);

  return (
    <Painel
      titulo="Evolução entre as duas vigências"
      fonte="A diferença de cada tipo, do aparato total da base para o da comparada."
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
