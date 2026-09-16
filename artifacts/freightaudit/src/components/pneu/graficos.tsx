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
import { Info, TriangleAlert } from "lucide-react";
import { COLUNAS_DE_EQUIPAMENTO_DE_PNEU } from "@workspace/comparison/pneu";
import type { EstadoDaLinhaDePneu } from "@workspace/comparison/pneu";
import { formatNumber } from "@/lib/format";
import {
  escreverKmDeVida,
  escreverReaisPorKm,
  type ComparacaoDePneu,
  type TotaisDePneu,
} from "@/lib/pneu";
import { cn } from "@/lib/utils";

/**
 * Os cinco painéis, e a regra que vale para os cinco: **nenhum deles soma o que
 * o núcleo não somou.**
 *
 * Cada um recebe a série já agregada — `custoDoPneuPorVigencia`,
 * `reconstituicaoPorVigencia`, `alteracoesPorVariavelDePneu`,
 * `distribuicaoPorEstadoDePneu`, `conferenciaDoPneu` — e desenha. Agregação em
 * componente de gráfico é como o cartão e o gráfico da mesma tela passam a
 * mostrar números diferentes: um soma a página, o outro soma o recorte.
 */

const COR_DO_ESTADO: Record<EstadoDaLinhaDePneu, string> = {
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
 * Painel 1 — o custo do pneu em cada ponta.
 *
 * Vem da leitura das duas vigências, e não do change set, porque uma média tem de
 * incluir quem **não** mudou.
 *
 * **É média simples entre trechos, e o rodapé diz isso.** O R$/km de pneu da
 * operação seria o dinheiro total de pneu dividido pela quilometragem total, e
 * nenhum dos dois existe no acervo.
 */
export function CustoDoPneu({
  custo,
  rotuloBase,
  rotuloComparada,
}: {
  custo: TotaisDePneu["custo"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const rotuloDaPonta = (ponta: "BASE" | "COMPARADA") =>
    ponta === "BASE" ? rotuloBase : rotuloComparada;

  return (
    <Painel
      titulo="Custo do pneu, por vigência"
      fonte="Média simples entre os trechos da vigência — não é o R$/km de pneu da operação, que exigiria a quilometragem realizada."
    >
      {custo.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum trecho com custo de pneu apurado nas duas vigências.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[38rem] border-collapse text-sm">
            <caption className="sr-only">
              Custo médio do pneu por vigência, com a parcela do preço ao lado.
            </caption>
            <thead>
              <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
                <th scope="col" className="px-3 py-2 text-left font-bold">Vigência</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Trechos</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Custo médio</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">No preço</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Mín.</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Máx.</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Vida média</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Pneus</th>
              </tr>
            </thead>
            <tbody>
              {custo.map((c) => (
                <tr key={c.ponta} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{rotuloDaPonta(c.ponta)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {formatNumber(c.trechos, 0)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                    {escreverReaisPorKm(c.custoMedio)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {escreverReaisPorKm(c.freteMedio)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {escreverReaisPorKm(c.custoMinimo)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {escreverReaisPorKm(c.custoMaximo)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {escreverKmDeVida(c.vidaMedia)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {c.quantidadeMedia === null ? "—" : formatNumber(c.quantidadeMedia, 2)}
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

/**
 * Painel 2 — A RECONSTITUIÇÃO, que informa e nunca julga.
 *
 * Os cinco componentes do pneu montam um R$/km:
 *
 *     quantidade × (pneu novo + recapagem − carcaça) ÷ vida útil ajustada
 *
 * **E a conta supõe uma recapagem por carcaça, que o acervo não declara.** É por
 * isso que este painel é o único da tela sem veredito: ele põe o número
 * reconstituído ao lado do apurado e mostra a distância, deixando a leitura para
 * quem conhece o contrato. Duas recapagens em vez de uma mudam o resultado em
 * dezenas de por cento, e transformar essa suposição em acusação seria trocar uma
 * medição por um palpite.
 */
export function ReconstituicaoDoPneu({
  reconstituicao,
  rotuloBase,
  rotuloComparada,
}: {
  reconstituicao: TotaisDePneu["reconstituicao"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const rotuloDaPonta = (ponta: "BASE" | "COMPARADA") =>
    ponta === "BASE" ? rotuloBase : rotuloComparada;

  return (
    <section className="superficie flex min-w-0 flex-col gap-3 p-4">
      <div>
        <h3 className="text-sm font-bold">
          A reconstituição do R$/km — os cinco componentes contra a coluna apurada
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="font-mono">
            quantidade × (pneu novo + recapagem − carcaça) ÷ vida útil ajustada
          </span>
        </p>
      </div>

      {reconstituicao.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nenhum trecho com os cinco componentes do pneu declarados.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <caption className="sr-only">
              R$/km reconstituído contra o apurado, por vigência.
            </caption>
            <thead>
              <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
                <th scope="col" className="px-3 py-2 text-left font-bold">Vigência</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Reconstituídos</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Sem os cinco</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Reconstituído</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Apurado</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Distantes</th>
              </tr>
            </thead>
            <tbody>
              {reconstituicao.map((r) => (
                <tr key={r.ponta} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{rotuloDaPonta(r.ponta)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {formatNumber(r.trechosReconstituidos, 0)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {r.trechosIncompletos > 0 ? formatNumber(r.trechosIncompletos, 0) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {escreverReaisPorKm(r.mediaReconstituida)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                    {escreverReaisPorKm(r.mediaApurada)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-mono tabular-nums",
                      r.trechosDistantes > 0
                        ? "text-warning-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {r.trechosDistantes > 0 ? formatNumber(r.trechosDistantes, 0) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="flex items-start gap-2 rounded-r-lg border-l-[3px] border-brand bg-brand/5 px-3 py-2 text-[0.7rem]">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
        <span>
          <strong className="font-semibold">
            Esta conta supõe uma recapagem por carcaça, e o acervo não declara quantas são.
          </strong>{" "}
          Por isso ela não produz veredito nenhum: um trecho longe da reconstituição continua
          conferindo na régua acima. As duas médias saem dos <em>mesmos</em> trechos — comparar
          a de duzentos com a de quatrocentos mediria a diferença entre as amostras, e não entre
          as contas.
        </span>
      </p>
    </section>
  );
}

/** Painel 3 — quantas alterações cada variável teve. */
export function AlteracoesPorVariavel({
  dados,
}: {
  dados: ComparacaoDePneu["alteracoesPorVariavel"];
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
          Nenhuma variável de pneu se moveu entre as duas vigências.
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
  dados: ComparacaoDePneu["distribuicaoPorEstado"];
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
 * Painel 5 — A CONFERÊNCIA DO PNEU, que é a razão de esta tela existir.
 *
 * Duas contas, e as duas saem de colunas que o acervo já declara:
 *
 * 1. **O R$/km de pneu do preço tem de ser o custo de pneus e câmaras.** São duas
 *    colunas independentes sobre o mesmo dinheiro. Quando divergem, o preço
 *    daquele trecho carrega um pneu diferente do que o modelo apurou — e a
 *    direção importa: preço abaixo do custo é desgaste que ninguém está cobrando.
 * 2. **R$/viagem ÷ R$/km tem de dar o km do ciclo.** A identidade que o
 *    dicionário da tabela de frete publica, aqui sobre a parcela de pneu.
 *
 * **O que ele não faz é fingir o realizado.** Nenhuma destas contas diz quanto a
 * operação gastou em pneu; elas dizem se a tabela de preço é consistente consigo
 * mesma.
 */
export function ConferenciaDoPneu({
  conferencias,
  rotuloBase,
  rotuloComparada,
}: {
  conferencias: TotaisDePneu["conferencias"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const rotuloDaPonta = (ponta: "BASE" | "COMPARADA") =>
    ponta === "BASE" ? rotuloBase : rotuloComparada;

  return (
    <section className="superficie flex min-w-0 flex-col gap-3 p-4">
      <div>
        <h3 className="text-sm font-bold">
          Conferência do pneu — as duas contas que a tabela de frete permite fechar
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          O R$/km de pneu que entra no preço tem de ser o custo de pneus e câmaras que o modelo
          apurou, e o R$/viagem dividido por esse R$/km tem de devolver o km do ciclo. A primeira
          conta é a que enxerga desgaste cobrado a menos — coisa que o delta de uma coluna
          sozinha nunca mostra.
        </p>
      </div>

      {conferencias.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nenhum trecho com as duas colunas de R$/km — sem elas, não há o que conferir.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[48rem] border-collapse text-sm">
            <caption className="sr-only">
              Conferência do pneu por vigência: quantos trechos fecham as duas contas.
            </caption>
            <thead>
              <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
                <th scope="col" className="px-3 py-2 text-left font-bold">Vigência</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Trechos</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Fecham</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Preço ≠ custo</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Abaixo do custo</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Preço com outro km</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Sem base</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Maior desvio</th>
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
                  {/* Zero fica em travessão, e não em "0": numa coluna que quase
                      sempre está vazia, o zero repetido rouba o olho do número
                      que importa ao lado. */}
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-mono tabular-nums",
                      c.divergeDoCusto > 0 ? "text-warning-foreground" : "text-muted-foreground",
                    )}
                  >
                    {c.divergeDoCusto > 0 ? formatNumber(c.divergeDoCusto, 0) : "—"}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-mono tabular-nums",
                      c.abaixoDoCusto > 0 ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {c.abaixoDoCusto > 0 ? formatNumber(c.abaixoDoCusto, 0) : "—"}
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
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {escreverReaisPorKm(c.maiorDivergenciaDoPreco)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[0.7rem] text-muted-foreground">
        A folga do preço é meio centavo por quilômetro — o arredondamento com que a fonte escreve
        cada R$/km. A do km é de um por cento, porque o quilômetro embutido sai de uma divisão
        entre dois valores já arredondados.{" "}
        <strong className="font-semibold">
          E nenhuma destas contas diz o que a operação gastou em pneu:
        </strong>{" "}
        elas dizem se a tabela de preço é consistente consigo mesma.
      </p>
    </section>
  );
}

/**
 * O aviso das três colunas de pneu que moram no equipamento.
 *
 * Elas vinham da Auditoria de Manutenção, e são a razão de o pneu nunca ter tido
 * tela própria até aqui: `cavalo.valor_pneu` e `carreta.valor_pneus` são zero em
 * 100% das linhas, e a medida do pneu é a mesma para a frota inteira.
 *
 * O aviso existe para que ninguém conclua que este produto não sabe que elas
 * existem — e para dizer, no mesmo lugar, por que a tabela acima não as tem: são
 * de outro grão. O texto de cada uma vem do núcleo, e não daqui.
 */
export function ColunasDoEquipamento() {
  return (
    <section className="superficie flex flex-col gap-2 p-4">
      <h3 className="flex items-center gap-2 text-sm font-bold">
        <TriangleAlert className="h-4 w-4 text-warning-foreground" aria-hidden="true" />
        As três colunas de pneu do equipamento — declaradas, e fora desta tabela
      </h3>
      <p className="text-xs text-muted-foreground">
        O <code className="font-mono">Modelo_Cavalo</code> e o{" "}
        <code className="font-mono">Modelo_Carreta</code> também declaram pneu. São de outro grão
        — placa, e não trecho — e a tabela acima não as mistura com o percurso. Ficam aqui, com o
        que se mediu sobre cada uma.
      </p>
      <ul className="flex flex-col gap-2 text-sm">
        {COLUNAS_DE_EQUIPAMENTO_DE_PNEU.map((c) => (
          <li key={c.code} className="flex flex-col gap-0.5 border-l-[3px] border-border pl-3">
            <span className="flex flex-wrap items-baseline gap-2">
              <span className="font-semibold">{c.rotulo}</span>
              <code className="font-mono text-[0.7rem] text-muted-foreground">{c.code}</code>
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[0.65rem] font-semibold">
                {c.entityType}
              </span>
            </span>
            <span className="text-[0.7rem] text-muted-foreground">{c.achado}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
