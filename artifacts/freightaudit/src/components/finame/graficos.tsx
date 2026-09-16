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
import { Fragment } from "react";
import { formatBrl, formatBrlShort, formatNumber } from "@/lib/format";
import type { ComparacaoDeFiname, TotaisDeFiname } from "@/lib/finame";
import {
  ROTULO_DO_TIPO,
  corDaDiferenca,
  escreverDiferenca,
  escreverVariacao,
} from "@/lib/finame";
/* Apelidados: `Tooltip` já é o do recharts, três importações acima, e são duas
   coisas diferentes — a dica do gráfico e a dica de um botão. */
import {
  Tooltip as Dica,
  TooltipContent as DicaConteudo,
  TooltipTrigger as DicaGatilho,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { EstadoDaLinhaDeFiname, EvolucaoDoTipo } from "@workspace/comparison/finame";

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
 * Gráfico 4 — a evolução entre as duas vigências, por tipo, **aberta**.
 *
 * Duas pontas ligadas por uma reta: é o formato que responde "para onde foi",
 * que é a pergunta desta tela. Uma série temporal com doze pontos responderia
 * outra — e o par escolhido pode nem ser de meses vizinhos.
 *
 * ---------------------------------------------------------------------------
 * Por que a diferença vem decomposta
 * ---------------------------------------------------------------------------
 * O total de cada ponta inclui quem não mudou, quem só a base tem e quem só a
 * comparada tem. A tabela, abaixo, só mostra diferença para quem está nas duas
 * — um veículo ausente aparece com `—` na coluna Diferença. Somar aquela coluna
 * nunca dava o número deste painel, e a pergunta chegou assim: *"esses valores
 * e o que está na tabela não deveriam bater?"*.
 *
 * Batem, desde que a conta esteja escrita: `alterados + entradas − saídas`. As
 * três parcelas vêm do servidor, da mesma leitura que produziu os totais, e o
 * painel só as escreve — somar aqui seria a tela dando a segunda resposta para
 * a diferença que o servidor já deu.
 *
 * Cada parcela é um botão: leva a tabela para o recorte que a sustenta, que é o
 * que transforma o número em algo que se confere.
 */
export function EvolucaoEntreVigencias({
  evolucao,
  rotuloBase,
  rotuloComparada,
  onRecorte,
}: {
  evolucao: EvolucaoDoTipo[];
  rotuloBase: string;
  rotuloComparada: string;
  /** Leva a tabela para o recorte de uma parcela. Ausente, os chips não clicam. */
  onRecorte?: (recorte: RecorteDaParcela) => void;
}) {
  return (
    <Painel
      titulo="Evolução entre as duas vigências"
      fonte={
        "A diferença de cada tipo, do total da base para o total da comparada. As três parcelas " +
        "somam a diferença: o que se moveu em quem está nas duas vigências, o que entrou de frota " +
        "e o que saiu. Só a primeira aparece como diferença na tabela abaixo."
      }
    >
      {evolucao.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Sem total para comparar.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {evolucao.map((e, i) => {
            const delta = e.comparada - e.base;
            const variacao = e.base === 0 ? null : (delta / Math.abs(e.base)) * 100;
            return (
              <li
                key={e.entityType}
                className={i > 0 ? "flex flex-col gap-2 border-t pt-3" : "flex flex-col gap-2"}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="w-16 text-xs font-semibold text-muted-foreground">
                    {ROTULO_DO_TIPO[e.entityType] ?? e.entityType}
                  </span>
                  <span className="font-mono text-sm tabular-nums">{formatBrl(e.base)}</span>
                  <span aria-hidden="true" className="text-muted-foreground">
                    →
                  </span>
                  <span className="font-mono text-sm font-semibold tabular-nums">
                    {formatBrl(e.comparada)}
                  </span>
                  {/* As mesmas réguas da tabela — sinal, unidade e cor saem de
                      `lib/finame`, e não de uma segunda escrita aqui. */}
                  <span
                    className={cn(
                      "font-mono text-xs tabular-nums",
                      corDaDiferenca(delta, "DINHEIRO"),
                    )}
                  >
                    {escreverDiferenca(delta, "DINHEIRO")}
                    {variacao === null ? " · base zero" : ` · ${escreverVariacao(variacao)}`}
                  </span>
                  <span className="sr-only">
                    {rotuloBase} para {rotuloComparada}
                  </span>
                </div>
                <ParcelasDaDiferenca evolucao={e} onRecorte={onRecorte} />
              </li>
            );
          })}
        </ul>
      )}
    </Painel>
  );
}

/** Para onde um chip leva a tabela — o recorte que sustenta aquela parcela. */
export interface RecorteDaParcela {
  tipo: string;
  estado: "TODAS" | EstadoDaLinhaDeFiname;
  variavel: string;
}

/**
 * As três parcelas, e o que cada chip abre na tabela.
 *
 * O primeiro não abre a aba "Alterados": abre **a variável Parcela**, em todos
 * os estados. É o recorte que contém exatamente os veículos que ele conta —
 * quem está nas duas vigências e teve a parcela mexida. A aba Alterados conta
 * alteração de qualquer variável, e mandaria para lá um número que não é o dela.
 * Por isso o rótulo também é "Parcela alterada", e não "Alterados": um chip
 * promete o que entrega.
 *
 * Os outros dois abrem Novos e Ausentes sem filtrar variável, porque entrada e
 * saída de ativo não citam atributo — o motor as grava uma vez por veículo, com
 * a variável em branco, e filtrar por Parcela esvaziaria a tabela.
 */
function ParcelasDaDiferenca({
  evolucao: e,
  onRecorte,
}: {
  evolucao: EvolucaoDoTipo;
  onRecorte?: (recorte: RecorteDaParcela) => void;
}) {
  const parcelas: {
    rotulo: string;
    valor: number;
    veiculos: number;
    operador: string;
    /** O sinal com que a parcela entra na soma — a saída é escrita positiva. */
    negativa?: boolean;
    explicacao: string;
    recorte: RecorteDaParcela;
  }[] = [
    {
      rotulo: "Parcela alterada",
      valor: e.alterados,
      veiculos: e.veiculosAlterados,
      operador: "",
      explicacao:
        "Veículos presentes nas duas vigências cuja parcela se moveu. É a única " +
        "das três que a coluna Diferença da tabela mostra.",
      recorte: { tipo: e.entityType, estado: "TODAS", variavel: "parcela" },
    },
    {
      rotulo: "Entradas",
      valor: e.entradas,
      veiculos: e.veiculosEntradas,
      operador: "+",
      explicacao:
        "Parcela de quem só a vigência comparada tem. Conta veículo com parcela, " +
        "então pode diferir da aba Novos, que conta veículo.",
      recorte: { tipo: e.entityType, estado: "NOVO_NA_VIGENCIA", variavel: "TODAS" },
    },
    {
      rotulo: "Saídas",
      valor: e.saidas,
      veiculos: e.veiculosSaidas,
      operador: "−",
      negativa: true,
      explicacao:
        "Parcela de quem só a vigência base tem — dinheiro que deixou o total. " +
        "Conta veículo com parcela, então pode diferir da aba Ausentes, que conta veículo.",
      recorte: { tipo: e.entityType, estado: "AUSENTE_NA_COMPARADA", variavel: "TODAS" },
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 sm:pl-16">
      {parcelas.map((p) => (
        <Fragment key={p.rotulo}>
          {p.operador && (
            <span aria-hidden="true" className="text-xs text-muted-foreground">
              {p.operador}
            </span>
          )}
          <Dica>
            <DicaGatilho asChild>
              {/* A parcela zerada continua escrita — é ela que deixa a soma
                  conferível —, mas não clica: levaria a uma tabela vazia, e uma
                  tabela vazia depois de um clique se lê como defeito. */}
              <button
                type="button"
                disabled={!onRecorte || p.veiculos === 0}
                onClick={() => onRecorte?.(p.recorte)}
                className={cn(
                  "flex items-baseline gap-2 rounded-lg border bg-muted/50 px-2.5 py-1 text-left",
                  onRecorte &&
                    p.veiculos > 0 &&
                    "transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <span className="text-[0.7rem] font-semibold text-muted-foreground">
                  {p.rotulo}
                </span>
                {/* A saída é escrita positiva e pintada de perda: o operador
                    "−" ao lado já diz que ela sai, e "−R$ 17.798,77" depois de
                    um "−" se lê como dois sinais sobre o mesmo número. */}
                <span
                  className={cn(
                    "font-mono text-xs tabular-nums",
                    corDaDiferenca(p.negativa ? -p.valor : p.valor, "DINHEIRO"),
                  )}
                >
                  {p.negativa ? formatBrl(p.valor) : escreverDiferenca(p.valor, "DINHEIRO")}
                </span>
                <span className="font-mono text-[0.7rem] text-muted-foreground">
                  {formatNumber(p.veiculos, 0)} veíc.
                </span>
              </button>
            </DicaGatilho>
            <DicaConteudo className="max-w-xs">
              {p.explicacao}
              {onRecorte && p.veiculos > 0 && " Clique para ver na tabela."}
            </DicaConteudo>
          </Dica>
        </Fragment>
      ))}
    </div>
  );
}
