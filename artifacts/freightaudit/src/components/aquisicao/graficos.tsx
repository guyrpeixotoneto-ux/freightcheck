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
import type { EstadoDaLinhaDeAquisicao } from "@workspace/comparison/aquisicao";
import { formatBrl, formatBrlShort, formatNumber } from "@/lib/format";
import {
  ROTULO_DO_TIPO,
  ROTULO_DO_VEREDITO_DA_ENTRADA,
  SELO_DO_VEREDITO_DA_ENTRADA,
  escreverData,
  type ComparacaoDeAquisicao,
  type TotaisDeAquisicao,
} from "@/lib/aquisicao";
import { cn } from "@/lib/utils";

/**
 * Os cinco painéis, e a regra que vale para os cinco: **nenhum deles soma o que
 * o núcleo não somou.**
 *
 * Cada um recebe a série já agregada — `totaisDeAquisicaoPorVigencia`,
 * `conferenciaDaEntrada`, `resumirCoerenciaDoCadastro`,
 * `alteracoesPorVariavelDeAquisicao`, `distribuicaoPorEstadoDeAquisicao` — e
 * desenha. Agregação em componente de gráfico é como o cartão e o gráfico da
 * mesma tela passam a mostrar números diferentes.
 */

const COR_DO_ESTADO: Record<EstadoDaLinhaDeAquisicao, string> = {
  SEM_ALTERACAO: "hsl(var(--success))",
  ALTERADO: "hsl(var(--warning))",
  NOVO_NA_VIGENCIA: "hsl(var(--brand))",
  AUSENTE_NA_COMPARADA: "hsl(var(--destructive))",
  DADO_INCOMPLETO: "hsl(var(--muted-foreground))",
  CONFLITO: "hsl(var(--brand-red))",
};

/**
 * O rótulo do eixo Y — abreviado, e só nesta tela.
 *
 * `formatBrlShort` escreve "R$ 45.000.000" por extenso, e é o certo nas outras
 * rubricas, cujos totais têm seis dígitos. Aqui o eixo é a **frota somada**:
 * quarenta milhões no cavalo. Com catorze caracteres, o rótulo não cabe na
 * largura do eixo e o Recharts o corta pela esquerda — três marcas diferentes
 * apareceram no print como "1.000.000", "1.000.000" e "1.000.000".
 *
 * Um eixo que mostra o mesmo número três vezes é pior do que um eixo sem
 * número, então ele abrevia. O valor exato continua inteiro no `Tooltip` e nas
 * frases abaixo do gráfico, que é onde alguém lê o número para usar.
 */
function rotuloDoEixo(valor: number): string {
  const absoluto = Math.abs(valor);
  const sinal = valor < 0 ? "−" : "";
  if (absoluto >= 1_000_000) return `${sinal}R$ ${formatNumber(absoluto / 1_000_000, 0)} mi`;
  if (absoluto >= 1_000) return `${sinal}R$ ${formatNumber(absoluto / 1_000, 0)} mil`;
  return formatBrlShort(valor);
}

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
function porTipo(totais: TotaisDeAquisicao["totais"]) {
  const mapa = new Map<
    string,
    {
      tipo: string;
      base: number;
      comparada: number;
      ativosBase: number;
      ativosComparada: number;
      zeradosComparada: number;
    }
  >();
  for (const t of totais) {
    const atual = mapa.get(t.entityType) ?? {
      tipo: ROTULO_DO_TIPO[t.entityType] ?? t.entityType,
      base: 0,
      comparada: 0,
      ativosBase: 0,
      ativosComparada: 0,
      zeradosComparada: 0,
    };
    if (t.ponta === "BASE") {
      atual.base = t.total;
      atual.ativosBase = t.ativos;
    } else {
      atual.comparada = t.total;
      atual.ativosComparada = t.ativos;
      atual.zeradosComparada = t.zerados;
    }
    mapa.set(t.entityType, atual);
  }
  return [...mapa.values()];
}

/**
 * Painel 1 — o valor de nota da frota em cada ponta.
 *
 * **Isto é patrimônio, não custo do período**, e o título diz isso porque a
 * barra sozinha não diria: é o que a frota custou para ser comprada, somado. Um
 * leitor que o some a uma rubrica mensal terá somado um estoque a um fluxo, que
 * é o erro que o balde `PONTUAL` existe para impedir do lado do motor.
 *
 * A barra muda quando a **frota** muda — não quando o preço muda, porque o preço
 * não muda. É a leitura certa desta rubrica, e o rodapé a escreve.
 */
export function ValorDeNotaPorVigencia({
  totais,
  rotuloBase,
  rotuloComparada,
}: {
  totais: TotaisDeAquisicao["totais"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const dados = porTipo(totais);

  return (
    <Painel
      titulo="Valor de nota da frota, por vigência"
      fonte="Soma das notas de compra dos ativos lidos em cada ponta. É patrimônio adquirido, não custo do período — e por isso nunca se soma a uma rubrica mensal."
    >
      {dados.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma nota lida nas duas vigências.
        </p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dados} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="tipo" tick={{ fontSize: 11 }} />
              <YAxis
                tickFormatter={rotuloDoEixo}
                tick={{ fontSize: 11 }}
                width={72}
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
              <b className="text-foreground">{d.tipo}</b>: {formatNumber(d.ativosBase, 0)} ativos
              na base e {formatNumber(d.ativosComparada, 0)} na comparada
              {d.zeradosComparada > 0 && (
                <>
                  {" · "}
                  {formatNumber(d.zeradosComparada, 0)}{" "}
                  {d.zeradosComparada === 1 ? "com nota zerada" : "com nota zerada"} — frota
                  alugada, e não lacuna
                </>
              )}
              . A diferença entre as duas barras é a frota que entrou ou saiu, não o preço que
              mudou.
            </p>
          ))}
        </>
      )}
    </Painel>
  );
}

/**
 * Painel 2 — o percentual de entrada, e o que ele revela.
 *
 * `CONSTANTE_DO_MODELO` é âmbar e não verde, pela mesma razão que o
 * `FORMULA_UNICA` do IPVA é: todos os ativos no mesmo percentual não é
 * conferência passando — é ninguém tendo calculado caso a caso. Quem orçar um
 * ativo supondo que a entrada dele foi negociada vai orçar errado.
 */
export function ConferenciaDaEntradaPainel({
  entrada,
  rotuloBase,
  rotuloComparada,
}: {
  entrada: TotaisDeAquisicao["entrada"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const rotuloDaPonta = (ponta: "BASE" | "COMPARADA") =>
    ponta === "BASE" ? rotuloBase : rotuloComparada;
  const mensuraveis = entrada.filter((e) => e.ativos > 0);

  return (
    <Painel
      titulo="A entrada foi negociada, ou é constante do modelo?"
      fonte="Conta os percentuais distintos declarados em cada ponta. O zero não conta como um percentual: ele é frota alugada, que não tem aquisição."
    >
      {mensuraveis.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum ativo declarou percentual de entrada nestas vigências.
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
                  Percentual
                </th>
                <th scope="col" className="px-3 py-2 text-right font-bold">
                  Sem entrada
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
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold tabular-nums">
                    {c.percentuais.length === 0
                      ? "—"
                      : c.percentuais.length === 1
                        ? `${formatNumber(c.percentuais[0], 2)}%`
                        : `${formatNumber(c.percentuais.length, 0)} distintos`}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                    {c.zerados === 0 ? "—" : formatNumber(c.zerados, 0)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        SELO_DO_VEREDITO_DA_ENTRADA[c.veredito],
                      )}
                    >
                      {ROTULO_DO_VEREDITO_DA_ENTRADA[c.veredito]}
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
          <b className="text-foreground">Percentual único não quer dizer errado.</b> Quer dizer
          que a entrada não foi calculada ativo a ativo — foi aplicada em bloco. Quem orçar um
          ativo supondo entrada negociada estará supondo uma conta que ninguém fez.
        </span>
      </p>
    </Painel>
  );
}

/**
 * Painel 3 — a coerência do cadastro: `data`, `ano` e `mes_de_entrada`.
 *
 * É a única conferência que **só esta tela** consegue fazer, porque é a única
 * que tem as três colunas na mesma tabela. No acervo de hoje ela fecha em 100%
 * das linhas, e é esse o resultado publicado — dizer "nenhuma divergência" é uma
 * afirmação, não uma tela vazia.
 *
 * Quando uma divergir, a leitura certa não é "duas alterações": é defeito de
 * cadastro numa placa, e o painel diz qual, o que a data diz e o que a coluna
 * declara.
 */
export function CoerenciaDoCadastro({
  coerencia,
  rotuloBase,
  rotuloComparada,
}: {
  coerencia: TotaisDeAquisicao["coerencia"] | undefined;
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const rotuloDaPonta = (ponta: "BASE" | "COMPARADA") =>
    ponta === "BASE" ? rotuloBase : rotuloComparada;

  return (
    <Painel
      titulo="O cadastro fecha consigo mesmo?"
      fonte="O ano e o mês de entrada são derivados da data. Este painel confere os três, ativo a ativo, nas duas pontas."
    >
      {!coerencia || coerencia.conferidos === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum ativo tem data de entrada legível — sem ela não há o que conferir.
        </p>
      ) : coerencia.divergencias.length === 0 ? (
        <div className="flex flex-col gap-2 py-4">
          <p className="text-sm">
            <b className="text-success">As três colunas concordam</b> em{" "}
            {formatNumber(coerencia.coerentes, 0)} de {formatNumber(coerencia.conferidos, 0)}{" "}
            leituras de ativo.
          </p>
          <p className="text-[0.7rem] text-muted-foreground">
            É o resultado esperado: o ano e o mês de entrada são o ano e o mês da data de
            entrada em todas as linhas do acervo. Uma divergência aqui seria defeito de
            cadastro, e apareceria nesta lista com a placa e os dois valores.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
                <th scope="col" className="px-3 py-2 text-left font-bold">
                  Placa
                </th>
                <th scope="col" className="px-3 py-2 text-left font-bold">
                  Vigência
                </th>
                <th scope="col" className="px-3 py-2 text-left font-bold">
                  Data de entrada
                </th>
                <th scope="col" className="px-3 py-2 text-left font-bold">
                  Ano declarado
                </th>
                <th scope="col" className="px-3 py-2 text-left font-bold">
                  Mês declarado
                </th>
              </tr>
            </thead>
            <tbody>
              {coerencia.divergencias.map((d, i) => (
                <tr
                  key={`${d.entityLabel}${d.ponta}${i}`}
                  className="border-b border-superficie-borda last:border-0"
                >
                  <td className="whitespace-nowrap px-3 py-2 font-semibold">
                    {d.entityLabel ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {rotuloDaPonta(d.ponta)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono tabular-nums">
                    {escreverData(d.dataDeEntrada)}
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-3 py-2 font-mono tabular-nums",
                      d.divergencia !== "MES" && "text-destructive font-semibold",
                    )}
                  >
                    {d.anoDeclarado ?? "—"}
                    {d.divergencia !== "MES" && (
                      <span className="text-muted-foreground"> · a data diz {d.anoDaData}</span>
                    )}
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-3 py-2 font-mono tabular-nums",
                      d.divergencia !== "ANO" && "text-destructive font-semibold",
                    )}
                  >
                    {d.mesDeclarado ?? "—"}
                    {d.divergencia !== "ANO" && (
                      <span className="text-muted-foreground"> · a data diz {d.mesDaData}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {coerencia && coerencia.semDataLegivel > 0 && (
        <p className="text-[0.7rem] text-muted-foreground">
          {formatNumber(coerencia.semDataLegivel, 0)} leituras ficaram fora da conferência por
          não ter data legível. Elas não contam como divergência — não há com o que comparar.
        </p>
      )}
    </Painel>
  );
}

/** Painel 4 — quantas alterações cada variável teve. */
export function AlteracoesPorVariavel({
  dados,
}: {
  dados: ComparacaoDeAquisicao["alteracoesPorVariavel"];
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
          Nenhuma coluna da aquisição se moveu entre as duas vigências — o que é o esperado: uma
          compra já feita não muda de preço.
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
            <Bar dataKey="alteracoes" fill="hsl(var(--warning))" radius={[0, 4, 4, 0]}>
              <LabelList dataKey="alteracoes" position="right" style={{ fontSize: 11 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Painel>
  );
}

/**
 * Painel 5 — os ativos por status.
 *
 * Um ativo aparece numa fatia só: quem tem conflito conta como conflito ainda
 * que também tenha uma variável alterada. A regra mora no núcleo, e é ela que
 * faz as fatias fecharem no total.
 */
export function DistribuicaoPorEstado({
  dados,
}: {
  dados: ComparacaoDeAquisicao["distribuicaoPorEstado"];
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
