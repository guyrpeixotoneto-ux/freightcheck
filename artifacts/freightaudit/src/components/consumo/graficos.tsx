import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TriangleAlert } from "lucide-react";
import { COLUNAS_DE_EQUIPAMENTO_DE_CONSUMO } from "@workspace/comparison/consumo";
import type { EstadoDaLinhaDeConsumo } from "@workspace/comparison/consumo";
import { formatNumber } from "@/lib/format";
import {
  escreverPrecoDoLitro,
  escreverReaisPorKm,
  escreverRendimento,
  type ComparacaoDeConsumo,
  type TotaisDeConsumo,
} from "@/lib/consumo";
import { cn } from "@/lib/utils";

/**
 * Os quatro painéis, e a regra que vale para os quatro: **nenhum deles soma o que
 * o núcleo não somou.**
 *
 * Cada um recebe a série já agregada — `rendimentoPorVigencia`,
 * `conferenciaDoConsumo`, `alteracoesPorVariavelDeConsumo`,
 * `distribuicaoPorEstadoDeConsumo` — e desenha.
 */

const COR_DO_ESTADO: Record<EstadoDaLinhaDeConsumo, string> = {
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
 * Painel 1 — O PREÇO DO LITRO, que é a razão de esta tela existir.
 *
 * ---------------------------------------------------------------------------
 * O número que não é coluna de lugar nenhum
 * ---------------------------------------------------------------------------
 * O acervo não declara quanto custa o litro de diesel. Mas declara o R$/km do
 * diesel e o rendimento do trecho, e a identidade que os liga é a própria
 * estrutura do modelo:
 *
 *     R$/km = preço do litro ÷ (km por litro)  ⟹  preço do litro = R$/km × km/l
 *
 * Multiplicando, o preço do combustível sobre o qual **aquele trecho** foi
 * precificado aparece. E daí vem o achado: numa mesma vigência, esse preço tem de
 * ser um só. Quando um punhado de trechos devolve outro, aqueles trechos foram
 * montados sobre outra premissa de diesel, e nenhuma coluna do export diz isso.
 *
 * Um delta entre vigências nunca veria essa divergência — as duas colunas de cada
 * trecho continuam coerentes entre si, cada uma na sua linha. Só o produto delas,
 * comparado **entre trechos da mesma vigência**, a enxerga.
 *
 * ---------------------------------------------------------------------------
 * As outras duas contas, e o que nenhuma delas afirma
 * ---------------------------------------------------------------------------
 * O R$/km de diesel do preço tem de ser o custo apurado, e o R$/viagem dividido
 * por ele tem de devolver o km do ciclo. Nenhuma das três diz quanto diesel a
 * operação queimou: elas dizem se a tabela de preço é consistente consigo mesma.
 */
export function ConferenciaDoConsumo({
  conferencias,
  rotuloBase,
  rotuloComparada,
}: {
  conferencias: TotaisDeConsumo["conferencias"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const rotuloDaPonta = (ponta: "BASE" | "COMPARADA") =>
    ponta === "BASE" ? rotuloBase : rotuloComparada;
  const semAjustado = conferencias.reduce((acc, c) => acc + c.semRendimentoAjustado, 0);

  return (
    <section className="superficie flex min-w-0 flex-col gap-3 p-4">
      <div>
        <h3 className="text-sm font-bold">
          O preço do litro embutido — e as duas contas que o cercam
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="font-mono">preço do litro = R$/km do diesel × km por litro</span>. Ele
          não é coluna de lugar nenhum: é o produto das duas que o trecho declara. Numa mesma
          vigência o diesel tem um preço só — quem devolve outro foi precificado sobre outra
          premissa de combustível.
        </p>
      </div>

      {conferencias.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nenhum trecho com R$/km de diesel e rendimento declarados — sem os dois, não há preço
          do litro.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[52rem] border-collapse text-sm">
            <caption className="sr-only">
              Preço do litro de referência e conferência do diesel, por vigência.
            </caption>
            <thead>
              <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
                <th scope="col" className="px-3 py-2 text-left font-bold">Vigência</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Trechos</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Diesel praticado</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Mín.</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Máx.</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Fecham</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Outro diesel</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Preço ≠ custo</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Outro km</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Sem base</th>
              </tr>
            </thead>
            <tbody>
              {conferencias.map((c) => (
                <tr key={c.ponta} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{rotuloDaPonta(c.ponta)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {formatNumber(c.trechos, 0)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                    {escreverPrecoDoLitro(c.precoDoLitroDeReferencia)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {escreverPrecoDoLitro(c.precoDoLitroMinimo)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {escreverPrecoDoLitro(c.precoDoLitroMaximo)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums text-success">
                    {formatNumber(c.confere, 0)}
                  </td>
                  {/* Zero fica em travessão, e não em "0": numa coluna que quase
                      sempre está vazia, o zero repetido rouba o olho do número
                      que importa ao lado. */}
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-mono tabular-nums",
                      c.litroDestoa > 0 ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {c.litroDestoa > 0 ? formatNumber(c.litroDestoa, 0) : "—"}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-mono tabular-nums",
                      c.divergeDoCusto > 0
                        ? "text-warning-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {c.divergeDoCusto > 0 ? formatNumber(c.divergeDoCusto, 0) : "—"}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-mono tabular-nums",
                      c.precoUsaOutroKm > 0
                        ? "text-warning-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {c.precoUsaOutroKm > 0 ? formatNumber(c.precoUsaOutroKm, 0) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {c.baseInsuficiente > 0 ? formatNumber(c.baseInsuficiente, 0) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[0.7rem] text-muted-foreground">
        O diesel praticado é a <strong className="font-semibold">mediana</strong> entre os
        trechos, e não a média: com um punhado de trechos sobre outra premissa, a média sairia no
        meio do caminho e passaria a acusar como desviantes justamente os corretos. A folga é de
        dois por cento, porque o preço sai de um produto entre dois valores já arredondados.
        {semAjustado > 0 && (
          <>
            {" "}
            {formatNumber(semAjustado, 0)}{" "}
            {semAjustado === 1 ? "trecho não declarou" : "trechos não declararam"} o consumo
            ajustado pela carga; neles a conta caiu no rendimento do trecho, que produz um preço
            do litro sistematicamente diferente.
          </>
        )}{" "}
        <strong className="font-semibold">
          E nenhuma destas contas diz quanto diesel a operação queimou:
        </strong>{" "}
        elas dizem se a tabela de preço é consistente consigo mesma.
      </p>
    </section>
  );
}

/**
 * Painel 2 — o rendimento em cada ponta, e a perda que ele mede.
 *
 * **A perda sai medida, e não somada.** O trecho declara três perdas — km, região
 * e descartável — e não declara em que ordem elas entram: somá-las produz um
 * número diferente de multiplicá-las, e nenhum dos dois é o que o modelo fez. A
 * distância entre o rendimento do trecho e o ajustado é o efeito que de fato
 * ficou, e essa não depende de suposição nenhuma.
 */
export function RendimentoPorVigencia({
  rendimento,
  rotuloBase,
  rotuloComparada,
}: {
  rendimento: TotaisDeConsumo["rendimento"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const rotuloDaPonta = (ponta: "BASE" | "COMPARADA") =>
    ponta === "BASE" ? rotuloBase : rotuloComparada;

  return (
    <Painel
      titulo="Rendimento, por vigência"
      fonte="Média simples entre os trechos da vigência. A perda é medida — a distância entre os dois rendimentos —, e não a soma das três colunas de perda, cuja ordem de aplicação o export não declara."
    >
      {rendimento.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum trecho com rendimento declarado nas duas vigências.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[38rem] border-collapse text-sm">
            <caption className="sr-only">
              Rendimento médio por vigência, com a perda medida e o R$/km do diesel.
            </caption>
            <thead>
              <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
                <th scope="col" className="px-3 py-2 text-left font-bold">Vigência</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Trechos</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Do trecho</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Ajustado</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Perda medida</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Mín.</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Máx.</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Diesel R$/km</th>
              </tr>
            </thead>
            <tbody>
              {rendimento.map((r) => (
                <tr key={r.ponta} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{rotuloDaPonta(r.ponta)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {formatNumber(r.trechos, 0)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {escreverRendimento(r.kmLitroMedio)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                    {escreverRendimento(r.ajustadoMedio)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {r.perdaMedidaEmPontos === null
                      ? "—"
                      : `${formatNumber(r.perdaMedidaEmPontos, 2)} p.p.`}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {escreverRendimento(r.kmLitroMinimo)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {escreverRendimento(r.kmLitroMaximo)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {escreverReaisPorKm(r.dieselReaisKmMedio)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Painel>
  );
}

/** Painel 3 — quantas alterações cada variável teve. */
export function AlteracoesPorVariavel({
  dados,
}: {
  dados: ComparacaoDeConsumo["alteracoesPorVariavel"];
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
            )} alterações no recorte — cada barra conta linhas, e não reais: rendimento e custo não somam entre si, e sobem em sentidos opostos.`
      }
    >
      {dados.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma variável de consumo se moveu entre as duas vigências.
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
              width={190}
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
  dados: ComparacaoDeConsumo["distribuicaoPorEstado"];
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
          {/* Piso de 13rem na legenda: sem ele, "Sem alteração" saía como "S…"
              ao lado da rosca. Com o piso, o `flex-wrap` desce a lista para a
              linha de baixo em vez de espremê-la. */}
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
 * O aviso das seis colunas de combustível que moram no cavalo.
 *
 * Elas são o modelo de consumo **do veículo** — a média de referência, a média
 * negociada, o desgaste que a idade impõe. O que precifica o frete é o rendimento
 * **do trecho**, e é ele que a tabela acima compara.
 *
 * O aviso existe para que ninguém conclua que este produto não sabe que elas
 * existem — e para dizer, no mesmo lugar, por que a tabela não as tem. O texto de
 * cada uma vem do núcleo, e não daqui.
 */
export function ColunasDoEquipamento() {
  return (
    <section className="superficie flex flex-col gap-2 p-4">
      <h3 className="flex items-center gap-2 text-sm font-bold">
        <TriangleAlert className="h-4 w-4 text-warning-foreground" aria-hidden="true" />
        As seis colunas de combustível do cavalo — declaradas, e de outro grão
      </h3>
      <p className="text-xs text-muted-foreground">
        O <code className="font-mono">Modelo_Cavalo</code> tem o seu próprio modelo de consumo.
        Ele explica por que dois trechos parecidos podem ter rendimentos diferentes, mas não é o
        que precifica o frete — e por isso não entra numa tabela por percurso.
      </p>
      <ul className="flex flex-col gap-2 text-sm">
        {COLUNAS_DE_EQUIPAMENTO_DE_CONSUMO.map((c) => (
          <li key={c.code} className="flex flex-col gap-0.5 border-l-[3px] border-border pl-3">
            <span className="flex flex-wrap items-baseline gap-2">
              <span className="font-semibold">{c.rotulo}</span>
              <code className="font-mono text-[0.7rem] text-muted-foreground">{c.code}</code>
            </span>
            <span className="text-[0.7rem] text-muted-foreground">{c.achado}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
