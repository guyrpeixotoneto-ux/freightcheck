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
  ROTULO_DO_TRIBUTO,
  ROTULO_DO_VEREDITO_DO_TRIBUTO,
  SELO_DO_VEREDITO,
  escreverAliquota,
  type ComparacaoDeImpostos,
  type TotaisDeImpostos,
} from "@/lib/impostos";
import type { EstadoDaLinhaDeImpostos, Tributo } from "@workspace/comparison/impostos";
import { cn } from "@/lib/utils";

/**
 * Os cinco painéis, e a regra que vale para os cinco: **nenhum deles soma o que
 * o núcleo não somou.**
 *
 * Cada um recebe a série já agregada — `totaisDeImpostosPorVigencia`,
 * `alteracoesPorVariavelDeImpostos`, `distribuicaoPorEstadoDeImpostos`,
 * `conferenciaDeAliquotas` — e desenha. Agregação em componente de gráfico é como
 * o cartão e o gráfico da mesma tela passam a mostrar números diferentes: um soma
 * a página, o outro soma o recorte.
 */

const COR_DO_ESTADO: Record<EstadoDaLinhaDeImpostos, string> = {
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

/**
 * As duas pontas de cada tipo, **dentro de um tributo**, na forma que os
 * gráficos de barra pedem.
 *
 * O recorte por tributo não é um filtro de conveniência: ICMS e PIS/COFINS não
 * somam entre si, e uma barra que juntasse os dois mostraria o total de duas
 * grandezas diferentes sob um rótulo só.
 */
function porTipo(totais: TotaisDeImpostos["totais"], tributo: Tributo) {
  const mapa = new Map<string, { tipo: string; base: number; comparada: number }>();
  for (const t of totais) {
    if (t.tributo !== tributo) continue;
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
 * Painel 1 — o total de cada tributo em cada ponta.
 *
 * Vem da leitura das duas vigências, e não do change set, porque um total tem de
 * incluir quem **não** mudou — e nesta rubrica quase ninguém muda.
 *
 * **Um gráfico por tributo, nunca um só.** E o gráfico do ICMS é o mais
 * importante dos dois, ainda que todas as barras dele sejam zero: é o retrato de
 * uma coluna que ninguém preencheu ao lado de alíquotas que alguém declarou. Uma
 * tela que simplesmente omitisse o ICMS por ele "não ter valor" apagaria
 * exatamente isso, e o aviso abaixo das barras é o que impede que o zero seja
 * lido como isenção.
 */
export function TotalPorVigencia({
  totais,
  tributo,
  rotuloBase,
  rotuloComparada,
}: {
  totais: TotaisDeImpostos["totais"];
  tributo: Tributo;
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const dados = porTipo(totais, tributo);
  const doTributo = totais.filter((t) => t.tributo === tributo);
  const zerados = doTributo.reduce((acc, t) => acc + t.zerados, 0);
  const ativos = doTributo.reduce((acc, t) => acc + t.ativos, 0);
  const tudoZerado = ativos > 0 && zerados === ativos;

  return (
    <Painel
      titulo={`Total de ${ROTULO_DO_TRIBUTO[tributo]} por vigência`}
      fonte="Soma do montante declarado por equipamento, em cada ponta. Alíquota não entra."
    >
      {dados.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma linha de {ROTULO_DO_TRIBUTO[tributo]} lida nas duas vigências.
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
          {zerados > 0 && (
            /*
              Zero não é valor: é a coluna que ninguém preencheu. Quando todas as
              linhas são zero, dizê-lo é o achado inteiro — o gráfico sozinho
              pareceria uma frota isenta.
            */
            <p className="flex items-start gap-2 text-[0.7rem] text-warning-foreground">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
              <span>
                {tudoZerado
                  ? `Os ${formatNumber(ativos, 0)} lançamentos deste tributo vêm zerados nas duas vigências. Isso não é imposto zero: é coluna sem dado — as alíquotas existem e são declaradas, e o montante nunca foi preenchido.`
                  : `${formatNumber(zerados, 0)} de ${formatNumber(ativos, 0)} lançamentos vêm zerados. Zero aqui é ausência de preenchimento, não isenção declarada.`}
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
  dados: ComparacaoDeImpostos["alteracoesPorVariavel"];
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
            )} alterações no recorte — montantes e alíquotas contados na mesma barra de cada coluna, nunca somados entre si.`
      }
    >
      {dados.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma variável de imposto se moveu entre as duas vigências.
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
 * que também tenha uma variável alterada. A regra mora no núcleo, e é ela que faz
 * as fatias fecharem no total — uma rosca cujas partes somam 113% é um gráfico
 * em que ninguém acredita.
 */
export function DistribuicaoPorEstado({
  dados,
}: {
  dados: ComparacaoDeImpostos["distribuicaoPorEstado"];
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
 * Painel 4 — A CONFERÊNCIA DA ALÍQUOTA, que é a razão de esta tela existir.
 *
 * ---------------------------------------------------------------------------
 * O que ele responde que nenhum total em reais responde
 * ---------------------------------------------------------------------------
 * O verbete desta rota pedia a alíquota **medida**, e não a declarada, porque as
 * duas discordam. Este painel põe as duas lado a lado: o que o ativo declara e o
 * que o dinheiro dele revela — o montante dividido pelo valor de nota. A razão
 * entre dois valores em reais não tem ambiguidade de escala; uma coluna de
 * percentual pode vir em pontos ou em fração sem que se saiba qual.
 *
 * As duas leituras que ele produz são as duas metades do achado:
 *
 * - **Alíquota declarada, montante ausente.** É o ICMS deste acervo: as taxas
 *   existem em toda linha, e o montante é zero nas 1.215. Não é isenção — é
 *   coluna sem dado, e o veredito recusa chamá-la de 0%.
 * - **Declarada diverge da medida.** É a discordância que o verbete anunciava, e
 *   ela aparece ativo a ativo, com a maior distância medida ao lado.
 *
 * **O que ele não faz é fingir a conferência fiscal que falta.** Saber se 9,250%
 * é a alíquota devida exigiria o regime tributário do ativo e o estado da
 * operação, que o acervo não tem. A nota diz isso por extenso, em vez de deixar o
 * número parecer um veredito fiscal.
 */
export function ConferenciaDeAliquotas({
  conferencias,
  rotuloBase,
  rotuloComparada,
}: {
  conferencias: TotaisDeImpostos["conferencias"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const rotuloDaPonta = (ponta: "BASE" | "COMPARADA") =>
    ponta === "BASE" ? rotuloBase : rotuloComparada;

  return (
    <section className="superficie flex min-w-0 flex-col gap-3 p-4">
      <div>
        <h3 className="text-sm font-bold">
          Conferência da alíquota — a declarada contra a medida sobre a nota
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          A medida é o montante do tributo dividido pelo valor de nota do próprio ativo: dinheiro
          sobre dinheiro, sem ambiguidade de escala. A declarada é a coluna de percentual que o
          ativo traz. Quando as duas discordam, é a declarada que precisa de explicação — e
          quando há taxa declarada sem um centavo de montante, o que existe é uma coluna sem
          dado, nunca um imposto de zero por cento.
        </p>
      </div>

      {conferencias.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nenhum ativo com montante ou alíquota nas duas pontas — sem base, não há o que
          conferir.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[52rem] border-collapse text-sm">
            <caption className="sr-only">
              Alíquota declarada e alíquota medida por vigência, tributo e tipo de equipamento.
            </caption>
            <thead>
              <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
                <th scope="col" className="px-3 py-2 text-left font-bold">Vigência</th>
                <th scope="col" className="px-3 py-2 text-left font-bold">Tributo</th>
                <th scope="col" className="px-3 py-2 text-left font-bold">Tipo</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Ativos</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Zerados</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Declarada</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Medida</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Desvio</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Divergem</th>
                <th scope="col" className="px-3 py-2 text-left font-bold">Leitura</th>
              </tr>
            </thead>
            <tbody>
              {conferencias.map((c) => (
                <tr
                  key={`${c.ponta}-${c.tributo}-${c.entityType}`}
                  className="border-b last:border-0"
                >
                  <td className="px-3 py-1.5">{rotuloDaPonta(c.ponta)}</td>
                  <td className="px-3 py-1.5 text-xs font-semibold">
                    {ROTULO_DO_TRIBUTO[c.tributo]}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">
                    {ROTULO_DO_TIPO[c.entityType] ?? c.entityType}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {formatNumber(c.ativos, 0)}
                  </td>
                  {/*
                    Zero zerado fica em travessão, e não em "0": numa coluna que
                    quase sempre está vazia, o zero repetido linha após linha
                    rouba o olho do número que importa ao lado.
                  */}
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-mono tabular-nums",
                      c.zerados > 0 ? "text-warning-foreground" : "text-muted-foreground",
                    )}
                  >
                    {c.zerados > 0 ? formatNumber(c.zerados, 0) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {escreverAliquota(c.declaradaMedia)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                    {escreverAliquota(c.medidaMedia)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {escreverAliquota(c.medidaDesvio)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-mono tabular-nums",
                      c.divergentes > 0 ? "text-warning-foreground" : "text-muted-foreground",
                    )}
                  >
                    {c.conferidos === 0
                      ? "—"
                      : `${formatNumber(c.divergentes, 0)}/${formatNumber(c.conferidos, 0)}`}
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        SELO_DO_VEREDITO[c.veredito],
                      )}
                    >
                      {ROTULO_DO_VEREDITO_DO_TRIBUTO[c.veredito]}
                    </span>
                    {c.maiorDiferenca !== null && c.divergentes > 0 && (
                      <span className="ml-2 font-mono text-[0.7rem] text-muted-foreground">
                        até {escreverAliquota(c.maiorDiferenca)} de distância
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[0.7rem] text-muted-foreground">
        Ativos sem valor de nota, ou com nota zero, ficam de fora da medida: dividir por zero não
        produz alíquota, e tratá-los como 0% faria a média cair por um cadastro em branco.{" "}
        <strong className="font-semibold">Os montantes zerados também ficam fora da régua</strong>{" "}
        — zero dividido pela nota é 0%, e uma frota inteira em 0% não é uma alíquota: é uma
        coluna em branco fingindo uma medição. Eles continuam contados na coluna ao lado e no
        total da vigência.{" "}
        <strong className="font-semibold">
          O que falta para isto virar conferência fiscal continua faltando:
        </strong>{" "}
        o regime tributário do ativo e o estado da operação, que são o que diria se o percentual
        medido é o devido — e, do outro lado da conta, o imposto sobre a{" "}
        <strong className="font-semibold">prestação</strong>, que mora na tabela de trecho e não
        neste acervo.
      </p>
    </section>
  );
}

/**
 * Painel 5 — a evolução entre as duas vigências, por tributo e tipo.
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
  totais: TotaisDeImpostos["totais"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const linhas = (["PIS_COFINS", "ICMS"] as const).flatMap((tributo) =>
    porTipo(totais, tributo).map((l) => ({ ...l, tributo })),
  );

  return (
    <Painel
      titulo="Evolução entre as duas vigências"
      fonte="A diferença de cada tributo em cada tipo, do total da base para o total da comparada. Os dois tributos nunca somam entre si."
    >
      {linhas.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Sem total para comparar.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {linhas.map((l) => {
            const delta = l.comparada - l.base;
            const variacao = l.base === 0 ? null : (delta / Math.abs(l.base)) * 100;
            return (
              <li
                key={`${l.tributo}-${l.tipo}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
              >
                <span className="w-28 text-xs font-semibold text-muted-foreground">
                  {ROTULO_DO_TRIBUTO[l.tributo]} · {l.tipo}
                </span>
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
                      ? "text-destructive"
                      : delta < 0
                        ? "text-success"
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
