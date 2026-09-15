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
  escreverFracao,
  escreverMinutos,
  escreverVelocidade,
  type ComparacaoDeVelocidade,
  type TotaisDeVelocidade,
} from "@/lib/velocidade-media";
import type { EstadoDaLinhaDeVelocidade } from "@workspace/comparison/velocidade-media";
import { cn } from "@/lib/utils";

/**
 * Os cinco painéis, e a regra que vale para os cinco: **nenhum deles soma o que
 * o núcleo não somou.**
 *
 * Cada um recebe a série já agregada — `particaoDoCicloPorVigencia`,
 * `velocidadePorVigencia`, `tempoPagoPorVigencia`,
 * `alteracoesPorVariavelDeVelocidade`, `distribuicaoPorEstadoDeVelocidade` — e
 * desenha.
 */

const COR_DO_ESTADO: Record<EstadoDaLinhaDeVelocidade, string> = {
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
 * Painel 1 — A PARTIÇÃO DO CICLO, que é a resposta ao que o verbete pedia.
 *
 * ---------------------------------------------------------------------------
 * "O ativo esperando carga não abaixa a velocidade de quem dirigiu"
 * ---------------------------------------------------------------------------
 * Era a segunda coisa de que esta rota dizia depender, e é exatamente o que este
 * painel separa. O ciclo médio abre em quatro barras: o tempo rodando e as três
 * esperas que o modelo declara — TMA na origem, TMA no destino e refeição.
 *
 * A decomposição não é uma suposição nossa: o dicionário da tabela de frete
 * define o ciclo assim, por extenso. O que a tela faz é subtrair, e recusar a
 * conta quando qualquer das parcelas não veio — uma parada ausente lida como zero
 * inflaria o tempo rodando e produziria uma velocidade alta e falsa.
 *
 * As médias são **simples entre trechos**: um ciclo médio ponderado exigiria
 * saber quantas viagens cada trecho roda, que é o realizado que não existe.
 */
export function ParticaoDoCiclo({
  particao,
  rotuloBase,
  rotuloComparada,
}: {
  particao: TotaisDeVelocidade["particao"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const dados = particao.map((p) => ({
    vigencia: p.ponta === "BASE" ? rotuloBase : rotuloComparada,
    Rodando: p.rodandoMedio ?? 0,
    "TMA origem": p.tmaOrigemMedio ?? 0,
    "TMA destino": p.tmaDestinoMedio ?? 0,
    Refeição: p.refeicaoMedia ?? 0,
  }));
  const semDecomposicao = particao.reduce((acc, p) => acc + p.trechosSemDecomposicao, 0);

  return (
    <Painel
      titulo="O ciclo médio, aberto entre rodar e esperar"
      fonte="Média simples entre trechos, em minutos. A decomposição é a do próprio dicionário: ciclo menos TMA de origem, TMA de destino e refeição."
    >
      {dados.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum trecho com o ciclo e as três paradas nas duas vigências.
        </p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={dados} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="vigencia" tick={{ fontSize: 11 }} />
              <YAxis
                tickFormatter={(v: number) => `${formatNumber(v / 60, 0)}h`}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                formatter={(v: number) => escreverMinutos(v)}
                contentStyle={{ fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Rodando" stackId="ciclo" fill="hsl(var(--brand))" />
              <Bar dataKey="TMA origem" stackId="ciclo" fill="hsl(var(--warning))" />
              <Bar
                dataKey="TMA destino"
                stackId="ciclo"
                fill="hsl(var(--warning))"
                fillOpacity={0.6}
              />
              <Bar
                dataKey="Refeição"
                stackId="ciclo"
                fill="hsl(var(--muted-foreground))"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>

          <ul className="flex flex-col gap-1 text-xs">
            {particao.map((p) => (
              <li key={p.ponta} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold text-muted-foreground">
                  {p.ponta === "BASE" ? rotuloBase : rotuloComparada}
                </span>
                <span className="font-mono tabular-nums">
                  ciclo {escreverMinutos(p.cicloMedio)}
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="font-mono tabular-nums">
                  {escreverFracao(p.fracaoRodandoMedia)} rodando
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">
                  {formatNumber(p.trechos, 0)} trechos
                </span>
              </li>
            ))}
          </ul>

          {semDecomposicao > 0 && (
            /*
              Um ciclo que não comporta as próprias paradas não é um trecho lento:
              é uma linha que discorda de si mesma. Ele sai da média — entrar
              produziria um tempo rodando negativo — e é contado aqui, porque
              sumir com ele seria esconder o achado.
            */
            <p className="flex items-start gap-2 text-[0.7rem] text-destructive">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
              <span>
                {formatNumber(semDecomposicao, 0)}{" "}
                {semDecomposicao === 1
                  ? "trecho declara paradas que somam mais do que o ciclo inteiro"
                  : "trechos declaram paradas que somam mais do que o ciclo inteiro"}
                . Eles ficam fora destas médias — um tempo rodando negativo não é uma média —
                e aparecem na conferência ao lado.
              </span>
            </p>
          )}
        </>
      )}
    </Painel>
  );
}

/**
 * Painel 2 — A CONFERÊNCIA DA VELOCIDADE.
 *
 * O dicionário diz que a velocidade média, com o km, produz o tempo de
 * deslocamento. Invertendo: o tempo rodando — o ciclo menos as três paradas — com
 * o km do ciclo produz uma velocidade, e ela tem de ser a declarada.
 *
 * Quando não é, há duas leituras possíveis e a tela não escolhe entre elas: ou o
 * ciclo foi montado com outro tempo de deslocamento, ou a velocidade declarada
 * não é a que o modelo usou. As duas são perguntas para quem publica a tabela.
 *
 * **A base do tempo de trajeto é medida, não suposta.** O dicionário não diz se
 * `tempoTrajetoFabricaCDMinuto` cobre a ida ou o ciclo; a tela multiplica a
 * velocidade pelo tempo e vê em qual das duas distâncias o resultado cai. A
 * contagem está na última coluna, e ela é informação sobre a tabela — não um erro.
 */
export function ConferenciaDaVelocidade({
  velocidade,
  rotuloBase,
  rotuloComparada,
}: {
  velocidade: TotaisDeVelocidade["velocidade"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const rotuloDaPonta = (ponta: "BASE" | "COMPARADA") =>
    ponta === "BASE" ? rotuloBase : rotuloComparada;

  return (
    <section className="superficie flex min-w-0 flex-col gap-3 p-4">
      <div>
        <h3 className="text-sm font-bold">
          Conferência da velocidade — a declarada contra a do ciclo
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          O tempo rodando é o ciclo menos as três paradas; com o km do ciclo, ele produz uma
          velocidade. Ela tem de ser a que o trecho declara — e quando não é, ou o ciclo foi
          montado com outro tempo de deslocamento, ou a velocidade declarada não é a que o
          modelo usou.
        </p>
      </div>

      {velocidade.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nenhum trecho com ciclo, paradas e quilometragem — sem os três, não há velocidade a
          medir.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[52rem] border-collapse text-sm">
            <caption className="sr-only">
              Conferência da velocidade por vigência: quantos trechos fecham a conta.
            </caption>
            <thead>
              <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
                <th scope="col" className="px-3 py-2 text-left font-bold">Vigência</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Trechos</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Declarada</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Medida</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Mín.</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Máx.</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Fecham</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Divergem</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Paradas &gt; ciclo</th>
                <th scope="col" className="px-3 py-2 text-left font-bold">Trajeto calculado</th>
              </tr>
            </thead>
            <tbody>
              {velocidade.map((v) => (
                <tr key={v.ponta} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{rotuloDaPonta(v.ponta)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {formatNumber(v.trechos, 0)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {escreverVelocidade(v.declaradaMedia)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                    {escreverVelocidade(v.medidaMedia)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {escreverVelocidade(v.medidaMinima)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {escreverVelocidade(v.medidaMaxima)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums text-success">
                    {formatNumber(v.confere, 0)}
                  </td>
                  {/*
                    Zero fica em travessão, e não em "0": numa coluna que quase
                    sempre está vazia, o zero repetido rouba o olho do número que
                    importa ao lado.
                  */}
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-mono tabular-nums",
                      v.divergem > 0 ? "text-warning-foreground" : "text-muted-foreground",
                    )}
                  >
                    {v.divergem > 0 ? formatNumber(v.divergem, 0) : "—"}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-mono tabular-nums",
                      v.cicloNaoComportaParadas > 0
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {v.cicloNaoComportaParadas > 0
                      ? formatNumber(v.cicloNaoComportaParadas, 0)
                      : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">
                    {[
                      v.trajetoSobreIda > 0
                        ? `${formatNumber(v.trajetoSobreIda, 0)} sobre a ida`
                        : null,
                      v.trajetoSobreCiclo > 0
                        ? `${formatNumber(v.trajetoSobreCiclo, 0)} sobre o ciclo`
                        : null,
                      v.trajetoSobreOutra > 0
                        ? `${formatNumber(v.trajetoSobreOutra, 0)} sobre outra distância`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[0.7rem] text-muted-foreground">
        A folga é de dois por cento: o tempo rodando sai de uma subtração entre quatro tempos
        arredondados em minutos, e a velocidade declarada costuma vir com uma casa decimal — os
        arredondamentos somados ficam bem abaixo disso, e um ciclo montado sobre o trajeto de
        ida em vez do de ida e volta erra por um fator de dois.{" "}
        <strong className="font-semibold">
          As médias de velocidade são simples entre trechos:
        </strong>{" "}
        a média de duas velocidades não é a velocidade média de dois percursos, e ponderá-las
        exigiria saber quanto cada trecho rodou — o realizado que este acervo não tem.
      </p>
    </section>
  );
}

/**
 * Painel 3 — o tempo que remunera contra o tempo que a operação pratica.
 *
 * Existe porque o dicionário da tabela de frete pede que ele exista, com todas as
 * letras: os pares `…Lucro` estão lá porque o tempo pago e o tempo real podem
 * divergir, e *"a diferença entre os dois é exatamente onde a conversa comercial
 * acontece — não a apague escolhendo um só"*.
 *
 * **A diferença não tem lado bom por si.** Um ciclo pago maior que o operacional
 * pode ser uma folga negociada ou um tempo que a operação deixou de praticar; a
 * tela mostra os dois lados e o tamanho, e não chama nenhum deles de erro.
 */
export function TempoPagoContraPraticado({
  tempoPago,
  rotuloBase,
  rotuloComparada,
}: {
  tempoPago: TotaisDeVelocidade["tempoPago"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const rotuloDaPonta = (ponta: "BASE" | "COMPARADA") =>
    ponta === "BASE" ? rotuloBase : rotuloComparada;

  return (
    <Painel
      titulo="O tempo que remunera, contra o que a operação pratica"
      fonte="A diferença entre o ciclo da versão lucro e o operacional. Positiva quer dizer que se paga mais tempo do que se roda — e ela não é um erro, é a conversa comercial."
    >
      {tempoPago.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum trecho declarou as duas versões do ciclo.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {tempoPago.map((t) => (
            <li key={t.ponta} className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted-foreground">
                {rotuloDaPonta(t.ponta)} · {formatNumber(t.trechos, 0)} trechos
              </span>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                <span className="font-mono tabular-nums">
                  folga média{" "}
                  <strong
                    className={cn(
                      "font-semibold",
                      (t.folgaMediaDoCiclo ?? 0) > 0
                        ? "text-warning-foreground"
                        : (t.folgaMediaDoCiclo ?? 0) < 0
                          ? "text-brand"
                          : "",
                    )}
                  >
                    {t.folgaMediaDoCiclo === null
                      ? "—"
                      : `${t.folgaMediaDoCiclo > 0 ? "+" : ""}${escreverMinutos(
                          t.folgaMediaDoCiclo,
                        )}`}
                  </strong>
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatNumber(t.pagaMais, 0)} pagam mais · {formatNumber(t.pagaMenos, 0)} pagam
                  menos · {formatNumber(t.iguais, 0)} iguais
                </span>
                {t.maiorFolga !== null && (
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    maior: {t.maiorFolga > 0 ? "+" : ""}
                    {escreverMinutos(t.maiorFolga)}
                  </span>
                )}
                {t.folgaMediaDosTmas !== null && (
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    TMA: {t.folgaMediaDosTmas > 0 ? "+" : ""}
                    {escreverMinutos(t.folgaMediaDosTmas)}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Painel>
  );
}

/** Painel 4 — quantas alterações cada variável teve. */
export function AlteracoesPorVariavel({
  dados,
}: {
  dados: ComparacaoDeVelocidade["alteracoesPorVariavel"];
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
            )} alterações no recorte — cada barra conta linhas, e não minutos: as unidades desta tela não somam entre si.`
      }
    >
      {dados.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma variável de tempo ou velocidade se moveu entre as duas vigências.
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
              width={180}
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
 * Painel 5 — os trechos por status.
 *
 * Um trecho aparece numa fatia só: quem tem conflito conta como conflito ainda
 * que também tenha uma variável alterada. A regra mora no núcleo, e é ela que faz
 * as fatias fecharem no total.
 */
export function DistribuicaoPorEstado({
  dados,
}: {
  dados: ComparacaoDeVelocidade["distribuicaoPorEstado"];
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
