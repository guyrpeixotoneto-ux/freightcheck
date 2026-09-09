import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CircleAlert, Gauge, Info, TriangleAlert } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/lib/api";
import {
  JANELAS,
  avisoDeCobertura,
  comSinal,
  numeroOuTraco,
  percentual,
  pontosDoGrafico,
  rotuloLongo,
  sentido,
  ultimaMedida,
  type JanelaDeQuinzenas,
  type QuinzenaDaFrota,
  type SerieDeAtivosEParados,
} from "@/lib/ativos-e-parados";

/**
 * ATIVOS E PARADOS — a frota do Promax, quinzena a quinzena.
 *
 * A tela responde uma pergunta, e responde a série dela: **quantos veículos
 * estão ativos e quantos estão parados em cada quinzena?**
 *
 * ---------------------------------------------------------------------------
 * O que "parado" quer dizer aqui, escrito na própria tela
 * ---------------------------------------------------------------------------
 *
 * Parado é o que o Promax marca como **inativo** no 01.22.08.00, contra o
 * 01.22.02.00 da frota ativa. É um retrato de cadastro, e não de operação: um
 * veículo ativo pode não ter rodado na quinzena, e um parado não gera desconto
 * por isso. Quem responde por viagem é o 2Art; quem responde por desconto é a
 * disponibilidade (03.08.18). As três leituras convivem neste acervo e
 * discordam de propósito — por isso a definição está impressa no rodapé da
 * tela, e não só neste comentário.
 *
 * ---------------------------------------------------------------------------
 * A tela não soma nada, e não desenha o que não foi medido
 * ---------------------------------------------------------------------------
 *
 * Todos os números chegam prontos do servidor (`GET /fechamento/frota/quinzenas`),
 * apurados por função pura. Aqui há filtro, ordem e desenho.
 *
 * E há uma regra que atravessa tudo: **`null` não vira zero**. A quinzena cujo
 * relatório não chegou não tem barra no gráfico, mostra `—` na tabela, não
 * produz variação — e ganha o aviso dizendo qual arquivo faltou e de qual
 * unidade. Uma frota que parece encolher porque um CDD não enviou o arquivo é o
 * erro mais caro que esta tela poderia cometer, e é o único contra o qual ela se
 * defende em quatro lugares diferentes.
 */

/**
 * Azul para os ativos, âmbar para os parados — e a escolha não é estética.
 *
 * O âmbar é a cor de atenção do produto inteiro (é a do farol `AMARELO`, em
 * `lib/fluxos`), e parado é o que se olha nesta tela: a barra que cresce é a que
 * puxa o olho. O contrário — ativos em âmbar — pintaria de alerta a parte normal
 * da frota.
 *
 * **Âmbar aqui não quer dizer "errado".** Uma operação que encolheu de propósito
 * tem mais veículos parados e está certa. A cor destaca; quem julga é quem lê, e
 * a tela não escreve juízo nenhum ao lado do número.
 */
const CORES = {
  ativos: "hsl(var(--chart-5))",
  parados: "hsl(var(--chart-2))",
};

function useSerie(unidade: string | null, janela: JanelaDeQuinzenas) {
  return useQuery({
    queryKey: ["frota-quinzenas", unidade, janela],
    queryFn: () => {
      const busca = new URLSearchParams({ limite: String(janela) });
      if (unidade) busca.set("unidade", unidade);
      /*
        Caminho nu, sem `getApiUrl`: `fetchJson` já o chama por dentro, e é ele
        que carimba a operação da auditoria aberta na consulta. Passar o
        endereço já montado produziria `/api/api/...` — 404 silencioso na tela.
      */
      return fetchJson<SerieDeAtivosEParados>(
        `/fechamento/frota/quinzenas?${busca.toString()}`,
      );
    },
  });
}

export default function AtivosEParados() {
  const [unidade, setUnidade] = useState<string | null>(null);
  const [janela, setJanela] = useState<JanelaDeQuinzenas>(12);
  const serie = useSerie(unidade, janela);

  const quinzenas = serie.data?.quinzenas ?? [];
  const ultima = useMemo(() => ultimaMedida(quinzenas), [quinzenas]);
  const pontos = useMemo(() => pontosDoGrafico(quinzenas), [quinzenas]);

  return (
    <Layout>
      <div className="space-y-6 p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <Gauge className="h-5 w-5" /> Ativos e Parados
            </h1>
            <p className="text-sm text-muted-foreground">
              A frota que o Promax reporta em cada quinzena — quantos veículos
              ativos e quantos parados, e o que mudou de uma quinzena para a
              seguinte.
            </p>
          </div>

          <div className="flex items-end gap-3">
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>Unidade</span>
              <Select
                value={unidade ?? "todas"}
                onValueChange={(valor) =>
                  setUnidade(valor === "todas" ? null : valor)
                }
              >
                <SelectTrigger className="w-64" aria-label="Unidade">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as unidades</SelectItem>
                  {(serie.data?.unidades ?? []).map((u) => (
                    <SelectItem key={u.codigo} value={u.codigo}>
                      {u.nome ? `${u.codigo} — ${u.nome}` : u.codigo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="space-y-1 text-xs text-muted-foreground">
              <span>Janela</span>
              <Select
                value={String(janela)}
                onValueChange={(valor) =>
                  setJanela(Number(valor) as JanelaDeQuinzenas)
                }
              >
                <SelectTrigger className="w-40" aria-label="Janela">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JANELAS.map((j) => (
                    <SelectItem key={j} value={String(j)}>
                      {j} quinzenas
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
        </div>

        {serie.isError && (
          <ApiErrorNotice
            error={serie.error}
            what="a série de frota"
            onTentarDeNovo={() => void serie.refetch()}
            tentando={serie.isFetching}
          />
        )}

        {serie.isLoading && (
          <div className="space-y-4">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-80 w-full" />
          </div>
        )}

        {serie.data && quinzenas.length === 0 && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Não há competência de fechamento neste recorte ainda. Esta leitura
              nasce dos relatórios de frota do Promax (01.22.02.00 e
              01.22.08.00) importados no Fechamento — sem eles não há série, e
              um zero aqui seria invenção.
            </AlertDescription>
          </Alert>
        )}

        {serie.data && quinzenas.length > 0 && (
          <>
            <Manchete quinzena={ultima} />

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Evolução da frota</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={pontos}
                      margin={{ top: 8, right: 8, bottom: 8, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="rotulo"
                        tick={{ fontSize: 11 }}
                        interval={0}
                        angle={-30}
                        height={56}
                        textAnchor="end"
                      />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip
                        formatter={(valor: unknown, nome: unknown) => [
                          numeroOuTraco(
                            typeof valor === "number" ? valor : null,
                          ),
                          String(nome),
                        ]}
                      />
                      <Legend />
                      {/*
                        Empilhado, e não lado a lado: a soma das duas é a frota
                        reportada, e é ela que se lê de relance. A barra de uma
                        situação sem relatório simplesmente não existe — o
                        recharts não desenha `null`, que é exatamente o que se
                        quer aqui.
                      */}
                      <Bar
                        dataKey="ativos"
                        name="Ativos"
                        stackId="frota"
                        fill={CORES.ativos}
                        radius={[0, 0, 0, 0]}
                      />
                      <Bar
                        dataKey="parados"
                        name="Parados"
                        stackId="frota"
                        fill={CORES.parados}
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Quinzena a quinzena</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Tabela quinzenas={[...quinzenas].reverse()} />
              </CardContent>
            </Card>

            <Rodape />
          </>
        )}
      </div>
    </Layout>
  );
}

/** Os quatro números da última quinzena que mediu alguma coisa. */
function Manchete({ quinzena }: { quinzena: QuinzenaDaFrota | null }) {
  if (!quinzena) {
    return (
      <Alert>
        <TriangleAlert className="h-4 w-4" />
        <AlertDescription>
          Há competências no recorte e nenhuma delas recebeu relatório de frota.
          Não é uma frota vazia — é a ausência dos dois arquivos do Promax.
        </AlertDescription>
      </Alert>
    );
  }

  const cartoes = [
    {
      titulo: "Ativos",
      valor: numeroOuTraco(quinzena.ativos),
      variacao: quinzena.variacao?.ativos ?? null,
    },
    {
      titulo: "Parados",
      valor: numeroOuTraco(quinzena.parados),
      variacao: quinzena.variacao?.parados ?? null,
    },
    {
      titulo: "Frota reportada",
      valor: numeroOuTraco(quinzena.total),
      variacao: quinzena.variacao?.total ?? null,
    },
    {
      titulo: "% parada",
      valor: percentual(quinzena.percentualParado),
      variacao: null,
      nota:
        quinzena.variacao?.pontosDeParado === null || quinzena.variacao === null
          ? null
          : `${comSinal(Number(quinzena.variacao.pontosDeParado.toFixed(1)))} p.p.`,
    },
  ];

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Última quinzena com relatório: <strong>{rotuloLongo(quinzena)}</strong>
        {quinzena.variacao && (
          <> — variação contra {quinzena.variacao.contra}</>
        )}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cartoes.map((c) => (
          <Card key={c.titulo}>
            <CardContent className="space-y-1 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {c.titulo}
              </p>
              <p className="text-2xl font-semibold tabular-nums">{c.valor}</p>
              <p className={cn("text-xs", corDoSentido(c.variacao))}>
                {c.nota ?? comSinal(c.variacao) ?? "sem comparação"}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      {avisoDeCobertura(quinzena) && (
        <Alert>
          <CircleAlert className="h-4 w-4" />
          <AlertDescription>{avisoDeCobertura(quinzena)}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function corDoSentido(valor: number | null): string {
  switch (sentido(valor)) {
    case "subiu":
      return "text-emerald-600";
    case "desceu":
      return "text-amber-600";
    case "igual":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

function Tabela({ quinzenas }: { quinzenas: QuinzenaDaFrota[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="p-3 text-left font-medium">Quinzena</th>
            <th className="p-3 text-right font-medium">Ativos</th>
            <th className="p-3 text-right font-medium">Parados</th>
            <th className="p-3 text-right font-medium">Frota</th>
            <th className="p-3 text-right font-medium">% parada</th>
            <th className="p-3 text-left font-medium">Variação</th>
          </tr>
        </thead>
        <tbody>
          {quinzenas.map((q) => {
            const aviso = avisoDeCobertura(q);
            return (
              <tr
                key={q.competencia}
                className="border-b last:border-0 align-top"
              >
                <td className="p-3">
                  <div className="font-medium">{rotuloLongo(q)}</div>
                  {aviso && (
                    <div className="mt-1 text-xs text-amber-600">{aviso}</div>
                  )}
                  {q.emAmbasAsSituacoes > 0 && (
                    <div className="mt-1 text-xs text-rose-600">
                      {q.emAmbasAsSituacoes} placa(s) aparecem como ativa e
                      parada na mesma quinzena — o relatório se contradiz, e
                      nada foi escolhido por ele.
                    </div>
                  )}
                </td>
                <td className="p-3 text-right tabular-nums">
                  {numeroOuTraco(q.ativos)}
                </td>
                <td className="p-3 text-right tabular-nums">
                  {numeroOuTraco(q.parados)}
                </td>
                <td className="p-3 text-right tabular-nums">
                  {numeroOuTraco(q.total)}
                </td>
                <td className="p-3 text-right tabular-nums">
                  {percentual(q.percentualParado)}
                </td>
                <td className="p-3">
                  {q.variacao ? (
                    <div className="flex flex-wrap gap-1">
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-normal",
                          corDoSentido(q.variacao.ativos),
                        )}
                      >
                        ativos {comSinal(q.variacao.ativos) ?? "—"}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-normal",
                          corDoSentido(q.variacao.parados),
                        )}
                      >
                        parados {comSinal(q.variacao.parados) ?? "—"}
                      </Badge>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      primeira da janela — sem anterior com que comparar
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** O que esta tela afirma, e o que ela não afirma — impresso, não subentendido. */
function Rodape() {
  return (
    <Alert>
      <Info className="h-4 w-4" />
      <AlertDescription className="space-y-1 text-xs">
        <p>
          <strong>Parado</strong> é o veículo que o Promax marca como inativo no
          relatório 01.22.08.00 da quinzena; <strong>ativo</strong>, o que ele
          lista no 01.22.02.00. É um retrato de cadastro.
        </p>
        <p>
          Não é <em>“não rodou”</em> — viagem é o diário 2Art —, nem o gap da
          disponibilidade (03.08.18), que é o que gera desconto no fixo. Um
          veículo ativo pode passar a quinzena sem rodar, e um parado não
          desconta por estar parado.
        </p>
        <p>
          Contagem de placas distintas, sobre o documento vigente de cada
          competência. Quinzena sem o relatório aparece como <strong>—</strong>,
          e nunca como zero.
        </p>
      </AlertDescription>
    </Alert>
  );
}
