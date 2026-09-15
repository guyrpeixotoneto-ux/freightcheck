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
import { formatNumber } from "@/lib/format";
import {
  ROTULO_DO_VEREDITO_DO_KM,
  escreverKm,
  escreverReaisPorKm,
  type ComparacaoDeKm,
  type TotaisDeKm,
} from "@/lib/km-rodado";
import type { EstadoDaLinhaDeKm } from "@workspace/comparison/km-rodado";
import { cn } from "@/lib/utils";

/**
 * Os cinco painéis, e a regra que vale para os cinco: **nenhum deles soma o que
 * o núcleo não somou.**
 *
 * Cada um recebe a série já agregada — `precoPorKmPorVigencia`,
 * `composicaoDoPrecoPorKm`, `alteracoesPorVariavelDeKm`,
 * `distribuicaoPorEstadoDeKm`, `conferenciaDoKm` — e desenha. Agregação em
 * componente de gráfico é como o cartão e o gráfico da mesma tela passam a
 * mostrar números diferentes: um soma a página, o outro soma o recorte.
 */

const COR_DO_ESTADO: Record<EstadoDaLinhaDeKm, string> = {
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
 * Painel 1 — o preço do quilômetro em cada ponta.
 *
 * Vem da leitura das duas vigências, e não do change set, porque uma média tem de
 * incluir quem **não** mudou.
 *
 * **É média simples entre trechos, e o rodapé diz isso.** O R$/km da operação
 * seria o dinheiro total dividido pela quilometragem total, e nenhum dos dois
 * existe no acervo. Ponderar pelo km do ciclo pesaria um trecho de 900 km nove
 * vezes mais do que um de 100 km como se os dois rodassem o mesmo número de
 * viagens — que é a suposição que esta tela inteira recusa.
 */
export function PrecoPorKm({
  preco,
  rotuloBase,
  rotuloComparada,
}: {
  preco: TotaisDeKm["preco"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const rotuloDaPonta = (ponta: "BASE" | "COMPARADA") =>
    ponta === "BASE" ? rotuloBase : rotuloComparada;
  const incompletos = preco.reduce((acc, p) => acc + p.trechosIncompletos, 0);

  return (
    <Painel
      titulo="Preço do quilômetro, por vigência"
      fonte="Soma das nove parcelas de R$/km em cada trecho, e média simples entre os trechos da vigência — não é o R$/km da operação, que exigiria a quilometragem realizada."
    >
      {preco.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum trecho com parcela de R$/km nas duas vigências.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <caption className="sr-only">
                Preço médio do quilômetro por vigência, com custo e margem separados.
              </caption>
              <thead>
                <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
                  <th scope="col" className="px-3 py-2 text-left font-bold">Vigência</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold">Trechos</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold">Custo médio</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold">Margem média</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold">Preço médio</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold">Mín.</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold">Máx.</th>
                </tr>
              </thead>
              <tbody>
                {preco.map((p) => (
                  <tr key={p.ponta} className="border-b last:border-0">
                    <td className="px-3 py-1.5">{rotuloDaPonta(p.ponta)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {formatNumber(p.trechos, 0)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {escreverReaisPorKm(p.custoMedio)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                      {escreverReaisPorKm(p.margemMedia)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                      {escreverReaisPorKm(p.media)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {escreverReaisPorKm(p.minimo)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {escreverReaisPorKm(p.maximo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {incompletos > 0 && (
            /*
              Um preço montado com seis das nove parcelas é um número menor, e
              não um número errado — o que seria errado é não dizer que ele foi
              montado assim. Parcela ausente não virou zero em lugar nenhum.
            */
            <p className="flex items-start gap-2 text-[0.7rem] text-warning-foreground">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
              <span>
                {formatNumber(incompletos, 0)}{" "}
                {incompletos === 1
                  ? "trecho não declarou as nove parcelas"
                  : "trechos não declararam as nove parcelas"}
                . As que faltam não entraram como zero: o preço daqueles trechos é a soma do
                que eles de fato declararam.
              </span>
            </p>
          )}
        </>
      )}
    </Painel>
  );
}

/**
 * Painel 2 — a composição do preço, parcela a parcela.
 *
 * Cada barra é a média **sobre os trechos que declararam aquela parcela**, e é
 * por isso que a contagem viaja no tooltip: uma parcela declarada por dez
 * trechos e outra por duzentos não são comparáveis sem esse número.
 *
 * A margem fica noutra cor, e não junto das oito parcelas de custo: lucro
 * variável é o que o contrato remunera ao transportador, e somá-lo ao custo é o
 * terceiro aviso do dicionário da tabela de frete.
 */
export function ComposicaoDoPreco({
  composicao,
  rotuloBase,
  rotuloComparada,
}: {
  composicao: TotaisDeKm["composicao"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const porComponente = new Map<
    string,
    { rotulo: string; margem: boolean; base: number | null; comparada: number | null }
  >();
  for (const p of composicao) {
    const atual =
      porComponente.get(p.componente) ??
      { rotulo: p.rotulo, margem: p.margem, base: null, comparada: null };
    if (p.ponta === "BASE") atual.base = p.media;
    else atual.comparada = p.media;
    porComponente.set(p.componente, atual);
  }
  const dados = [...porComponente.values()];

  return (
    <Painel
      titulo="Composição do preço por quilômetro"
      fonte="Média de cada parcela entre os trechos que a declararam. A margem aparece separada — lucro variável não é custo."
    >
      {dados.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma parcela de R$/km lida nas duas vigências.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(220, dados.length * 34)}>
          <BarChart
            data={dados}
            layout="vertical"
            margin={{ top: 4, right: 36, left: 8, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis
              type="category"
              dataKey="rotulo"
              width={150}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              formatter={(v: number) => `${formatNumber(v, 4)} R$/km`}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar
              dataKey="base"
              name={rotuloBase}
              fill="hsl(var(--brand))"
              fillOpacity={0.35}
              radius={[0, 4, 4, 0]}
            />
            <Bar dataKey="comparada" name={rotuloComparada} radius={[0, 4, 4, 0]}>
              {dados.map((d) => (
                <Cell
                  key={d.rotulo}
                  fill={d.margem ? "hsl(var(--muted-foreground))" : "hsl(var(--brand))"}
                />
              ))}
              <LabelList
                dataKey="comparada"
                position="right"
                style={{ fontSize: 10 }}
                formatter={(v: number) => formatNumber(v, 2)}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Painel>
  );
}

/** Painel 3 — quantas alterações cada variável teve. */
export function AlteracoesPorVariavel({
  dados,
}: {
  dados: ComparacaoDeKm["alteracoesPorVariavel"];
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
            )} alterações no recorte — cada barra conta linhas, e não reais: as unidades desta tela não somam entre si.`
      }
    >
      {dados.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma variável de km rodado se moveu entre as duas vigências.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(160, dados.length * 30)}>
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
              width={168}
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
 * Painel 4 — os trechos por status.
 *
 * Um trecho aparece numa fatia só: quem tem conflito conta como conflito ainda
 * que também tenha uma variável alterada. A regra mora no núcleo, e é ela que faz
 * as fatias fecharem no total.
 */
export function DistribuicaoPorEstado({
  dados,
}: {
  dados: ComparacaoDeKm["distribuicaoPorEstado"];
}) {
  const total = dados.reduce((acc, d) => acc + d.trechos, 0);
  return (
    <Painel titulo="Trechos por status" fonte={`${formatNumber(total, 0)} trechos no recorte.`}>
      {total === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum trecho neste recorte.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <ResponsiveContainer width="100%" height={188} className="!w-[188px] flex-none">
            <PieChart>
              <Pie
                data={dados}
                dataKey="trechos"
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
                formatter={(v: number, nome: string) => [`${formatNumber(v, 0)} trechos`, nome]}
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
                  {formatNumber(d.trechos, 0)}
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
 * Painel 5 — A CONFERÊNCIA DO KM, que é a razão de esta tela existir.
 *
 * ---------------------------------------------------------------------------
 * As duas contas que o próprio acervo permite fazer
 * ---------------------------------------------------------------------------
 * O verbete desta rota pedia a quilometragem **realizada**, e ela não existe. O
 * que existe é a tabela de preço por trecho — e dentro dela, duas identidades
 * que o dicionário publica e que ninguém tinha conferido:
 *
 * 1. **Ida + volta = km do ciclo.** Quando não fecha, a própria linha discorda
 *    sobre a distância que ela cobra.
 * 2. **R$/viagem = R$/km × km do ciclo.** Dividindo de volta, aparece o
 *    quilômetro sobre o qual o preço foi montado — e quando ele não é o
 *    declarado, o preço daquele trecho saiu de outra distância.
 *
 * A segunda é a que só esta tela faz. Um recorte que mostrasse apenas o delta do
 * R$/km entre duas vigências nunca veria um preço calculado sobre a projeção
 * mensal em vez do ciclo: as duas colunas continuariam coerentes entre si, cada
 * uma na sua linha.
 *
 * **O que ele não faz é fingir o realizado.** Nenhuma destas contas diz quanto a
 * operação gastou; elas dizem se a tabela de preço é consistente consigo mesma. A
 * nota diz isso por extenso.
 */
export function ConferenciaDoKm({
  conferencias,
  rotuloBase,
  rotuloComparada,
}: {
  conferencias: TotaisDeKm["conferencias"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const rotuloDaPonta = (ponta: "BASE" | "COMPARADA") =>
    ponta === "BASE" ? rotuloBase : rotuloComparada;

  return (
    <section className="superficie flex min-w-0 flex-col gap-3 p-4">
      <div>
        <h3 className="text-sm font-bold">
          Conferência do km — as duas contas que a tabela de frete permite fechar
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Ida mais volta tem de dar o km do ciclo, e o R$/viagem dividido pelo R$/km tem de
          devolver esse mesmo km. A segunda conta é a que enxerga um preço montado sobre outra
          distância — a projeção mensal, o km de ida, a versão “lucro” —, coisa que o delta de
          uma coluna sozinha nunca mostra.
        </p>
      </div>

      {conferencias.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nenhum trecho com quilometragem declarada — sem o eixo, não há o que conferir.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <caption className="sr-only">
              Conferência do km por vigência: quantos trechos fecham as duas contas.
            </caption>
            <thead>
              <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
                <th scope="col" className="px-3 py-2 text-left font-bold">Vigência</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Trechos</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Fecham</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Ciclo não fecha</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Preço com outro km</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Sem base</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Maior desvio do ciclo</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Maior desvio do preço</th>
              </tr>
            </thead>
            <tbody>
              {conferencias.map((c) => (
                <tr key={c.ponta} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{rotuloDaPonta(c.ponta)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {formatNumber(c.trechos, 0)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums text-success">
                    {formatNumber(c.confere, 0)}
                  </td>
                  {/*
                    Zero fica em travessão, e não em "0": numa coluna que quase
                    sempre está vazia, o zero repetido rouba o olho do número que
                    importa ao lado.
                  */}
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-mono tabular-nums",
                      c.cicloNaoFecha > 0 ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {c.cicloNaoFecha > 0 ? formatNumber(c.cicloNaoFecha, 0) : "—"}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-mono tabular-nums",
                      c.precoUsaOutroKm > 0 ? "text-warning-foreground" : "text-muted-foreground",
                    )}
                  >
                    {c.precoUsaOutroKm > 0 ? formatNumber(c.precoUsaOutroKm, 0) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {c.baseInsuficiente > 0 ? formatNumber(c.baseInsuficiente, 0) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {escreverKm(c.maiorDiferencaDoCiclo)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {escreverKm(c.maiorDiferencaDoPreco)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[0.7rem] text-muted-foreground">
        A folga do ciclo é meio quilômetro — o arredondamento com que a fonte escreve cada
        distância. A do preço é de um por cento, porque o km embutido sai de uma divisão entre
        dois valores já arredondados.{" "}
        <strong className="font-semibold">O pedágio fica fora da segunda conta</strong>: quando
        o trecho não tem R$/km de pedágio, o valor por viagem vem do pedágio por eixo da tabela
        ANTT, e a divisão entre os dois não é uma quilometragem.{" "}
        <strong className="font-semibold">
          E nenhuma destas contas diz o que a operação gastou:
        </strong>{" "}
        elas dizem se a tabela de preço é consistente consigo mesma. O quilômetro realizado por
        quinzena continua não existindo neste acervo.
      </p>

      <p className="text-[0.7rem] text-muted-foreground">
        {conferencias
          .map(
            (c) =>
              `${rotuloDaPonta(c.ponta)}: ${formatNumber(c.confere, 0)} de ${formatNumber(
                c.trechos,
                0,
              )} ${ROTULO_DO_VEREDITO_DO_KM.CONFERE.toLowerCase()}.`,
          )
          .join(" ")}
      </p>
    </section>
  );
}
