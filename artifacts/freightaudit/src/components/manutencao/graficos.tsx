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
import type { EstadoDaLinhaDeManutencao } from "@workspace/comparison/manutencao";
import { formatNumber } from "@/lib/format";
import {
  ROTULO_DA_ORIGEM,
  SELO_DA_ORIGEM,
  escreverReaisPorKm,
  type ComparacaoDeManutencao,
  type TotaisDeManutencao,
} from "@/lib/manutencao";
import { cn } from "@/lib/utils";

/**
 * Os cinco painéis, e a regra que vale para os cinco: **nenhum deles soma o que
 * o núcleo não somou.**
 *
 * E uma regra a mais, que só esta tela precisa: **nenhum deles escreve reais.**
 * O eixo, o tooltip e as linhas saem em R$/km, que é a unidade em que a rubrica
 * foi medida. Um gráfico de manutenção com "R$" no eixo é a forma mais rápida de
 * alguém somar a coluna no Excel e publicar um custo que não existe.
 */

const COR_DO_ESTADO: Record<EstadoDaLinhaDeManutencao, string> = {
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
function porTipo(totais: TotaisDeManutencao["totais"]) {
  const mapa = new Map<
    string,
    {
      tipo: string;
      base: number;
      comparada: number;
      bidBase: number;
      veiculos: number;
      zerados: number;
      comContrato: number;
    }
  >();
  for (const t of totais) {
    const atual = mapa.get(t.entityType) ?? {
      tipo: ROTULO_DO_TIPO[t.entityType] ?? t.entityType,
      base: 0,
      comparada: 0,
      bidBase: 0,
      veiculos: 0,
      zerados: 0,
      comContrato: 0,
    };
    if (t.ponta === "BASE") {
      atual.base = t.mediaReaisKm;
      atual.bidBase = t.mediaBid;
      atual.veiculos = t.veiculos;
      atual.zerados = t.zerados;
      atual.comContrato = t.comContrato;
    } else {
      atual.comparada = t.mediaReaisKm;
    }
    mapa.set(t.entityType, atual);
  }
  return [...mapa.values()];
}

/**
 * Painel 1 — o R$/km médio de cada ponta.
 *
 * ---------------------------------------------------------------------------
 * Média, e nunca soma
 * ---------------------------------------------------------------------------
 * Somar R$/km entre caminhões daria um número sem significado: dois caminhões a
 * R$ 0,30/km não custam R$ 0,60 por quilômetro. A média é a única leitura que
 * sobrevive à agregação — e mesmo ela precisa do denominador ao lado, que é por
 * isso que a nota de rodapé diz quantos caminhões sustentam cada barra.
 *
 * **Os zeros entram na média e saem contados.** Um R$/km zero é quase sempre
 * free maintenance, que é um caminhão de verdade custando zero de manutenção:
 * tirá-lo da média inflaria o custo da frota. Mas uma média que embute 122 zeros
 * é outra notícia que uma que não embute nenhum.
 */
export function MediaDoReaisKm({
  totais,
  rotuloBase,
  rotuloComparada,
}: {
  totais: TotaisDeManutencao["totais"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const dados = porTipo(totais);

  return (
    <Painel
      titulo="R$/km médio por vigência"
      fonte="Média entre os caminhões do recorte — nunca a soma, que não teria significado."
    >
      {dados.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma linha de manutenção lida nas duas vigências.
        </p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dados} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="tipo" tick={{ fontSize: 11 }} />
              <YAxis
                tickFormatter={(v: number) => escreverReaisPorKm(v)}
                tick={{ fontSize: 10 }}
                width={82}
              />
              <Tooltip
                formatter={(v: number) => `${escreverReaisPorKm(v)}/km`}
                contentStyle={{ fontSize: 12 }}
              />
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
              <b className="text-foreground">{d.tipo}</b>, na base:{" "}
              {formatNumber(d.veiculos, 0)}{" "}
              {d.veiculos === 1 ? "caminhão" : "caminhões"} · {formatNumber(d.zerados, 0)} com
              R$/km zerado · {formatNumber(d.comContrato, 0)} com contrato · média do BID{" "}
              {escreverReaisPorKm(d.bidBase)}/km.
            </p>
          ))}
        </>
      )}
    </Painel>
  );
}

/** Painel 2 — quantas alterações cada variável teve. */
export function AlteracoesPorVariavel({
  dados,
}: {
  dados: ComparacaoDeManutencao["alteracoesPorVariavel"];
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
          Nenhuma variável de manutenção se moveu entre as duas vigências.
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
 * que também tenha uma variável alterada.
 */
export function DistribuicaoPorEstado({
  dados,
}: {
  dados: ComparacaoDeManutencao["distribuicaoPorEstado"];
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
 * Painel 4 — DE ONDE VEM O R$/KM, que é a razão de esta tela existir.
 *
 * ---------------------------------------------------------------------------
 * O que ele responde que nenhum delta responde
 * ---------------------------------------------------------------------------
 * O R$/km resolvido é o número que resume cada caminhão. Um número que resume
 * sem dizer de onde vem é a forma mais fácil de uma auditoria ser contestada — e
 * no acervo ele vem de dois lugares diferentes, sendo que um deles não é lugar
 * nenhum:
 *
 * - nos caminhões **com contrato**, o resolvido é exatamente o R$/km do
 *   contrato, em 126 de 126;
 * - nos **sem contrato**, ele não é o do contrato nem o do BID. É um terceiro
 *   número, e nenhuma coluna do export diz o que é.
 *
 * O painel mede isso e escreve `MISTO`. Ele **não escolhe uma fórmula** para os
 * que sobram: publicar uma regra inventada aqui faria com que ela passasse a
 * valer como se fosse do cliente, e o produto perderia justamente a pergunta que
 * precisa ser feita à Ambev.
 */
export function OrigemDoReaisKm({
  origens,
  rotuloBase,
  rotuloComparada,
}: {
  origens: TotaisDeManutencao["origens"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const rotuloDaPonta = (ponta: "BASE" | "COMPARADA") =>
    ponta === "BASE" ? rotuloBase : rotuloComparada;
  const mensuraveis = origens.filter((o) => o.ativos > 0);
  const semOrigem = mensuraveis.reduce((acc, o) => acc + o.semOrigem, 0);

  return (
    <Painel
      titulo="De onde vem o R$/km que vale?"
      fonte="Compara o R$/km resolvido de cada caminhão com o do contrato e o do BID."
    >
      {mensuraveis.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum caminhão tem ao mesmo tempo R$/km resolvido, R$/km do BID e R$/km do contrato —
          sem os três não há o que conferir.
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
                  Caminhões
                </th>
                <th scope="col" className="px-3 py-2 text-right font-bold">
                  Do contrato
                </th>
                <th scope="col" className="px-3 py-2 text-right font-bold">
                  Do BID
                </th>
                <th scope="col" className="px-3 py-2 text-right font-bold">
                  Sem origem
                </th>
                <th scope="col" className="px-3 py-2 text-left font-bold">
                  Leitura
                </th>
              </tr>
            </thead>
            <tbody>
              {mensuraveis.map((o) => (
                <tr
                  key={`${o.ponta}${o.entityType}`}
                  className="border-b border-superficie-borda last:border-0"
                >
                  <td className="whitespace-nowrap px-3 py-2">{rotuloDaPonta(o.ponta)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {ROTULO_DO_TIPO[o.entityType] ?? o.entityType}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                    {formatNumber(o.ativos, 0)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                    {formatNumber(o.doContrato, 0)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                    {formatNumber(o.doBid, 0)}
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-3 py-2 text-right font-mono font-semibold tabular-nums",
                      o.semOrigem > 0 && "text-destructive",
                    )}
                  >
                    {formatNumber(o.semOrigem, 0)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        SELO_DA_ORIGEM[o.veredito],
                      )}
                    >
                      {ROTULO_DA_ORIGEM[o.veredito]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {semOrigem > 0 && (
        <p className="flex items-start gap-2 text-[0.7rem] text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
          <span>
            <b className="text-foreground">Sem origem não quer dizer errado.</b> Quer dizer que o
            R$/km desses caminhões não é o do contrato nem o do BID, e que nenhuma coluna deste
            export explica como ele foi formado. É a pergunta a fazer à Ambev — e o produto não
            inventa uma fórmula no lugar dela.
          </span>
        </p>
      )}
      <p className="text-[0.7rem] text-muted-foreground">
        Os caminhões com R$/km zerado ficam fora da conferência: eles são free maintenance, e
        perguntar de onde vem um zero que ninguém cobrou não é a pergunta.
      </p>
    </Painel>
  );
}

/** Painel 5 — a diferença de cada tipo, da média da base para a da comparada. */
export function EvolucaoEntreVigencias({
  totais,
  rotuloBase,
  rotuloComparada,
}: {
  totais: TotaisDeManutencao["totais"];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  const linhas = porTipo(totais);

  return (
    <Painel
      titulo="Evolução entre as duas vigências"
      fonte="A diferença de cada tipo, da média de R$/km da base para a da comparada."
    >
      {linhas.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Sem média para comparar.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {linhas.map((l) => {
            const delta = l.comparada - l.base;
            const variacao = l.base === 0 ? null : (delta / Math.abs(l.base)) * 100;
            return (
              <li key={l.tipo} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="w-16 text-xs font-semibold text-muted-foreground">{l.tipo}</span>
                <span className="font-mono text-sm tabular-nums">
                  {escreverReaisPorKm(l.base)}/km
                </span>
                <span aria-hidden="true" className="text-muted-foreground">
                  →
                </span>
                <span className="font-mono text-sm font-semibold tabular-nums">
                  {escreverReaisPorKm(l.comparada)}/km
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
                  {escreverReaisPorKm(Math.abs(delta))}/km
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
