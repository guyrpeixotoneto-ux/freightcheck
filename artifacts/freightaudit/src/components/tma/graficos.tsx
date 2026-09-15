import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TriangleAlert } from "lucide-react";
import { formatNumber } from "@/lib/format";
import {
  escreverDiferencaDeTempo,
  escreverFracao,
  escreverMinutos,
  type EvolucaoDoLocal,
  type LocalDeTma,
  type TrechoDeTma,
} from "@/lib/tma";

/**
 * Os quatro painéis — e a regra que vale para os quatro: **nenhum deles agrega o
 * que o núcleo não agregou.**
 *
 * Cada um recebe a lista já pronta de `@workspace/comparison/tma` — os locais,
 * os trechos, a evolução — e no máximo ordena e corta os primeiros. Ordenar e
 * cortar é decisão de tela; média, soma e veredito são do núcleo.
 */

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

function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Quantos itens cabem num painel sem virar uma lista para rolar. */
const NO_PAINEL = 12;

/** O eixo de tempo escrito em horas quando a escala pede. */
function eixoDeMinutos(v: number): string {
  return v >= 120 ? `${formatNumber(v / 60, 1)}h` : `${formatNumber(v, 0)}`;
}

/**
 * Painel 1 — ONDE O MESMO LOCAL SE CONTRADIZ.
 *
 * ---------------------------------------------------------------------------
 * É o achado que só existe neste grão
 * ---------------------------------------------------------------------------
 * Cada barra é uma porta de um local, e o que ela mede é a **amplitude**: a
 * distância entre o maior e o menor tempo que os trechos daquele lugar declaram.
 * Uma doca com 90 minutos num trecho e 150 noutro aparece aqui com uma hora de
 * amplitude — e não aparece em tela nenhuma por trecho, porque as duas linhas,
 * separadamente, estão certas.
 *
 * O painel mostra os doze maiores porque a fila de trabalho é essa: quem vai
 * perguntar à Ambev começa pelo lugar em que a contradição é maior, não pelo
 * primeiro em ordem alfabética.
 */
export function OndeOLocalSeContradiz({ locais }: { locais: readonly LocalDeTma[] }) {
  const comVariacao = locais
    .filter((l) => l.veredito === "VARIA_POR_TRECHO" && l.amplitude !== null)
    .sort((a, b) => b.amplitude! - a.amplitude!)
    .slice(0, NO_PAINEL)
    .map((l) => ({
      nome: `${l.local} · ${l.porta === "ORIGEM" ? "carga" : "descarga"}`,
      Amplitude: l.amplitude!,
      minimo: l.minimo,
      maximo: l.maximo,
      trechos: l.trechos,
    }));

  return (
    <Painel
      titulo="Onde o mesmo local é declarado de dois jeitos"
      fonte="Amplitude entre o maior e o menor tempo declarado para a mesma porta do mesmo lugar, na vigência comparada. Diferenças de até um minuto são arredondamento e não contam."
    >
      {comVariacao.length === 0 ? (
        <Vazio>
          Nenhum local desta vigência é declarado com tempos diferentes conforme o trecho. É a
          resposta boa desta pergunta.
        </Vazio>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(220, comVariacao.length * 28)}>
          <BarChart
            data={comVariacao}
            layout="vertical"
            margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={eixoDeMinutos}
              tick={{ fontSize: 11 }}
              label={{ value: "minutos", position: "insideBottomRight", fontSize: 10 }}
            />
            <YAxis
              type="category"
              dataKey="nome"
              width={190}
              tick={{ fontSize: 10 }}
              interval={0}
            />
            <Tooltip
              formatter={(v: number) => escreverMinutos(v)}
              labelFormatter={(nome: string) => {
                const item = comVariacao.find((c) => c.nome === nome);
                if (!item) return nome;
                return `${nome} — de ${escreverMinutos(item.minimo)} a ${escreverMinutos(
                  item.maximo,
                )} em ${formatNumber(item.trechos, 0)} trechos`;
              }}
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Bar dataKey="Amplitude" fill="hsl(var(--warning))" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Painel>
  );
}

/**
 * Painel 2 — QUANTO DO CICLO CADA TRECHO PASSA PARADO EM PORTA.
 *
 * É a leitura do outro grão, e a razão de ele existir: quem negocia um contrato
 * negocia trechos, e a pergunta *"quanto deste ciclo é espera?"* é do percurso.
 *
 * O peso é a **soma das duas portas sobre o ciclo** — a única soma que esta tela
 * faz entre elas, e aqui ela descreve algo real: é o mesmo caminhão, no mesmo
 * ciclo, parado nas duas pontas.
 */
export function PesoDaPortaNoCiclo({ trechos }: { trechos: readonly TrechoDeTma[] }) {
  const dados = trechos
    .filter((t) => t.pesoNoCiclo !== null)
    .slice(0, NO_PAINEL)
    .map((t) => ({
      nome: t.entityLabel ?? "—",
      Peso: Number((t.pesoNoCiclo! * 100).toFixed(2)),
      tempoDePorta: t.tempoDePorta,
      ciclo: t.ciclo,
    }));

  return (
    <Painel
      titulo="Os trechos em que a porta pesa mais no ciclo"
      fonte="Tempo de porta — as duas pontas somadas — sobre o ciclo declarado. Ordenado pelo peso, que é a fila de quem tem espera demais."
    >
      {dados.length === 0 ? (
        <Vazio>
          Nenhum trecho desta vigência trouxe as duas portas e o ciclo na mesma linha. Sem as
          três, o peso não se calcula — e meia soma não é um tempo de porta menor, é um tempo
          de porta que não se sabe.
        </Vazio>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(220, dados.length * 28)}>
          <BarChart
            data={dados}
            layout="vertical"
            margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(v: number) => `${formatNumber(v, 0)}%`}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              type="category"
              dataKey="nome"
              width={190}
              tick={{ fontSize: 10 }}
              interval={0}
            />
            <Tooltip
              formatter={(v: number) => `${formatNumber(v, 1)}%`}
              labelFormatter={(nome: string) => {
                const item = dados.find((d) => d.nome === nome);
                if (!item) return nome;
                return `${nome} — ${escreverMinutos(item.tempoDePorta)} de porta em ${escreverMinutos(
                  item.ciclo,
                )} de ciclo`;
              }}
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Bar dataKey="Peso" radius={[0, 4, 4, 0]}>
              {dados.map((d) => (
                <Cell
                  key={d.nome}
                  fill={d.Peso >= 40 ? "hsl(var(--warning))" : "hsl(var(--brand))"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Painel>
  );
}

/**
 * Painel 3 — O QUE O TEMPO DE PORTA DE CADA LUGAR FEZ ENTRE AS DUAS VIGÊNCIAS.
 *
 * ---------------------------------------------------------------------------
 * E por que este painel não é uma comparação do motor
 * ---------------------------------------------------------------------------
 * O motor canônico pareia **entidades**, e um local não é uma entidade do
 * acervo: é um nome que aparece em duas colunas de trecho. O que este painel põe
 * lado a lado são os dois agregados, cada um lido da sua vigência — o mesmo
 * caminho de `/ipva/totais` e `/km-rodado/totais`.
 *
 * O que mudou **em cada coluna de cada trecho** continua sendo do motor, em
 * Alterações e na Auditoria de Velocidade Média.
 */
export function EvolucaoDoTempoDePorta({
  evolucao,
  rotuloBase,
  rotuloComparada,
}: {
  evolucao: readonly EvolucaoDoLocal[];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const dados = evolucao
    .filter((e) => e.diferenca !== null && e.diferenca !== 0)
    .sort((a, b) => Math.abs(b.diferenca!) - Math.abs(a.diferenca!))
    .slice(0, NO_PAINEL)
    .map((e) => ({
      nome: `${e.local} · ${e.porta === "ORIGEM" ? "carga" : "descarga"}`,
      [rotuloBase]: e.base ?? 0,
      [rotuloComparada]: e.comparada ?? 0,
      diferenca: e.diferenca!,
    }));

  const soNumaPonta = evolucao.filter((e) => e.base === null || e.comparada === null).length;

  return (
    <Painel
      titulo="O tempo de porta que se moveu entre as vigências"
      fonte="Média do local em cada vigência, posta lado a lado. Não é comparação do motor: um local não é entidade do acervo. O que mudou em cada coluna de cada trecho está em Alterações."
    >
      {dados.length === 0 ? (
        <Vazio>
          Nenhum local mudou de tempo médio entre as duas vigências — ou não há dois lados para
          comparar.
        </Vazio>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={Math.max(240, dados.length * 30)}>
            <BarChart
              data={dados}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                horizontal={false}
              />
              <XAxis type="number" tickFormatter={eixoDeMinutos} tick={{ fontSize: 11 }} />
              <YAxis
                type="category"
                dataKey="nome"
                width={190}
                tick={{ fontSize: 10 }}
                interval={0}
              />
              <Tooltip
                formatter={(v: number) => escreverMinutos(v)}
                labelFormatter={(nome: string) => {
                  const item = dados.find((d) => d.nome === nome);
                  if (!item) return nome;
                  return `${nome} — ${escreverDiferencaDeTempo(item.diferenca)}`;
                }}
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey={rotuloBase} fill="hsl(var(--muted-foreground))" radius={[0, 4, 4, 0]} />
              <Bar dataKey={rotuloComparada} fill="hsl(var(--brand))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {soNumaPonta > 0 && (
            <p className="flex items-start gap-1.5 text-[0.7rem] text-muted-foreground">
              <TriangleAlert
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-foreground"
                aria-hidden="true"
              />
              {formatNumber(soNumaPonta, 0)}{" "}
              {soNumaPonta === 1
                ? "porta de local existe em uma vigência só e ficou fora deste painel"
                : "portas de local existem em uma vigência só e ficaram fora deste painel"}
              . Elas aparecem na tabela com a outra ponta em branco — e não em zero, que seria
              uma doca que passou a atender instantaneamente.
            </p>
          )}
        </>
      )}
    </Painel>
  );
}

/**
 * Painel 4 — O TEMPO PAGO CONTRA O PRATICADO.
 *
 * ---------------------------------------------------------------------------
 * Nenhum dos dois lados é vermelho, e é de propósito
 * ---------------------------------------------------------------------------
 * As colunas `…Lucro` existem porque o tempo que remunera pode não ser o tempo
 * que a operação pratica. Pagar mais pode ser folga negociada; pagar menos pode
 * ser espera que a operação absorve sem reconhecimento. Nenhum dos dois é um
 * erro, e pintar um de vermelho afirmaria um juízo que esta tela não sustenta.
 *
 * O que ela sustenta é o tamanho e o lado — e é isso que o painel mostra.
 */
export function PagoContraPraticado({ locais }: { locais: readonly LocalDeTma[] }) {
  const dados = locais
    .filter((l) => l.folgaMedia !== null && l.folgaMedia !== 0)
    .sort((a, b) => Math.abs(b.folgaMedia!) - Math.abs(a.folgaMedia!))
    .slice(0, NO_PAINEL)
    .map((l) => ({
      nome: `${l.local} · ${l.porta === "ORIGEM" ? "carga" : "descarga"}`,
      Folga: l.folgaMedia!,
      praticado: l.medio,
      pago: l.pagoMedio,
      trechos: l.trechosComFolga,
    }));

  const semComparacao = locais.filter((l) => l.folgaMedia === null).length;

  return (
    <Painel
      titulo="Onde o tempo pago não é o tempo praticado"
      fonte="Tempo que remunera menos tempo praticado, por porta de local. Para a direita paga-se mais espera do que se pratica; para a esquerda, menos."
    >
      {dados.length === 0 ? (
        <Vazio>
          {semComparacao === locais.length && locais.length > 0
            ? "Nenhum local desta vigência trouxe as duas versões do tempo de porta — sem as duas, não há folga a medir."
            : "Em todos os locais com as duas versões, o tempo pago é o tempo praticado."}
        </Vazio>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(220, dados.length * 28)}>
          <BarChart
            data={dados}
            layout="vertical"
            margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${formatNumber(v, 0)}`}
              tick={{ fontSize: 11 }}
              label={{ value: "minutos", position: "insideBottomRight", fontSize: 10 }}
            />
            <YAxis
              type="category"
              dataKey="nome"
              width={190}
              tick={{ fontSize: 10 }}
              interval={0}
            />
            <Tooltip
              formatter={(v: number) => escreverDiferencaDeTempo(v)}
              labelFormatter={(nome: string) => {
                const item = dados.find((d) => d.nome === nome);
                if (!item) return nome;
                return `${nome} — pratica ${escreverMinutos(item.praticado)}, paga ${escreverMinutos(
                  item.pago,
                )}`;
              }}
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Bar dataKey="Folga" radius={[0, 4, 4, 0]}>
              {dados.map((d) => (
                <Cell
                  key={d.nome}
                  fill={d.Folga > 0 ? "hsl(var(--brand))" : "hsl(var(--warning))"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Painel>
  );
}

/**
 * A recusa escrita — o que esta tela **não** mede, dito antes que alguém suponha.
 *
 * O verbete desta rota pede *"o registro de cada atendimento com começo e fim"*,
 * e ele continua faltando. O acervo tem o TMA **parametrizado** — o tempo que o
 * modelo de remuneração reconhece para aquela porta —, e não o medido.
 *
 * É uma pergunta menor? Não: é o número que remunera. Mas afirmar que um
 * caminhão esperou noventa minutos porque a tabela diz noventa seria inventar
 * uma medição, e este produto não faz isso.
 */
export function OQueEstaTelaNaoMede({ pesoNoCiclo }: { pesoNoCiclo: number | null }) {
  return (
    <section className="superficie flex flex-col gap-2 border-dashed p-4">
      <h3 className="text-sm font-bold">O que está nesta tela é o TMA parametrizado</h3>
      <p className="text-sm text-muted-foreground">
        Todos os tempos aqui são os que o <strong className="font-semibold">modelo de
        remuneração</strong> reconhece para cada porta. O acervo não tem o registro de cada
        atendimento com começo e fim, e sem os dois carimbos não existe tempo médio medido —
        média de tempo sem eles é média de nada. A tela não afirma quanto um caminhão esperou;
        afirma quanto o contrato reconhece que ele espera.
      </p>
      <p className="text-sm text-muted-foreground">
        E isso já é uma conversa:{" "}
        {pesoNoCiclo === null ? (
          <>o tempo de porta é parcela do ciclo que remunera cada viagem</>
        ) : (
          <>
            <strong className="font-semibold">{escreverFracao(pesoNoCiclo)}</strong> do ciclo é
            tempo de porta
          </>
        )}
        . Um TMA parametrizado acima do praticado é tempo pago que não acontece; abaixo, é
        operação absorvendo espera que ninguém reconhece. As duas existem hoje, com o dado que
        já chegou.
      </p>
    </section>
  );
}
