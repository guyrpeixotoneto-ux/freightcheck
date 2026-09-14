import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { ArrowLeftRight, Gauge, Route, Ruler, ScanSearch, TriangleAlert } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { CabecalhoDePagina } from "@/components/layout/cabecalho-de-pagina";
import { ApiErrorNotice } from "@/components/api-error";
import { CartaoDeIndicador } from "@/components/ui/cartao-de-indicador";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Paginacao } from "@/components/ui/paginacao";
import { LoadingSpinner } from "@/components/ui/loading";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { fetchJson } from "@/lib/api";
import { lerRecorte, paramsDoRecorte } from "@/lib/recorte";

/**
 * Km Rodado — quanto de quilometragem a tabela de frete contrata nesta vigência.
 *
 * **Contratado, não realizado.** O número desta tela sai da tabela de frete:
 * é o km que o contrato declara para cada trecho, e é o que multiplica todo
 * R$/viagem e divide todo R$/km. Não é hodômetro e não é GPS — nada disso
 * existe neste acervo, e a tela escreve "contratado" em toda parte para que
 * ninguém a leia como medição de operação.
 *
 * **A tela não calcula.** Todo número vem pronto de `GET /km-rodado`, que chama
 * `@workspace/comparison#montarPanorama`. Somar aqui o que o servidor já somou
 * criaria duas contas do mesmo km, e a que discordasse seria descoberta pelo
 * cliente. O que esta tela faz é ordenar, paginar e escrever.
 *
 * **Zero não substitui ausência.** Um recorte sem trecho válido responde "Sem
 * dado" com o motivo ao lado, nunca "0 km". As duas frases se parecem na tela e
 * significam o oposto uma da outra.
 */

type MotivoDeExclusao = "SEM_KM" | "KM_NAO_POSITIVO" | "CICLO_NAO_FECHA" | "SEM_IDENTIDADE";

const MOTIVO_CURTO: Record<MotivoDeExclusao, string> = {
  SEM_KM: "Sem km no export",
  KM_NAO_POSITIVO: "Km zero ou negativo",
  CICLO_NAO_FECHA: "Ciclo não fecha",
  SEM_IDENTIDADE: "Sem chave de trecho",
};

const MOTIVO_LONGO: Record<MotivoDeExclusao, string> = {
  SEM_KM: "O export não trouxe km para este trecho.",
  KM_NAO_POSITIVO: "Distância não é grandeza negativa, e zero aqui é ausência.",
  CICLO_NAO_FECHA: "kmRodado não é kmIda + kmVolta: as três colunas se contradizem.",
  SEM_IDENTIDADE: "Sem chave de trecho não há como dizer de que trecho é este km.",
};

interface CorteDeKm {
  chave: string | null;
  trechos: number;
  kmTotal: number;
  kmMedio: number;
}

interface LinhaDeKm {
  entityId: string;
  chaveTrecho: string | null;
  unidade: string | null;
  operador: string | null;
  regional: string | null;
  origem: string | null;
  destino: string | null;
  capacidade: string | null;
  kmIda: number | null;
  kmVolta: number | null;
  km: number | null;
  kmMes: number | null;
  assimetria: number | null;
  exclusao: MotivoDeExclusao | null;
}

interface Divergencia {
  percurso: string;
  unidade: string | null;
  destino: string | null;
  porCapacidade: { capacidade: string | null; pallets: number | null; km: number }[];
  amplitude: number;
  amplitudeRelativa: number;
}

interface RespostaDeKm {
  vigencia: {
    snapshotId: string;
    effectiveDate: string;
    sourceLabel: string;
    scopeHash: string;
    channel: string | null;
  };
  filtros: Record<string, string | undefined>;
  opcoes: {
    unidades: string[];
    operadores: string[];
    capacidades: string[];
    regionais: string[];
  };
  resumo: {
    trechos: number;
    trechosNoExport: number;
    cobertura: number | null;
    kmTotal: number | null;
    media: number | null;
    mediana: number | null;
    p90: number | null;
    minimo: number | null;
    maximo: number | null;
    excluidos: Record<MotivoDeExclusao, number>;
    colapsadas: number;
  };
  porUnidade: CorteDeKm[];
  porOperador: CorteDeKm[];
  porCapacidade: CorteDeKm[];
  porRegional: CorteDeKm[];
  assimetria: {
    simetricos: number;
    assimetricos: number;
    indeterminados: number;
    maiorDiferenca: number | null;
  };
  divergencias: Divergencia[];
  conflitos: { entityId: string; chaveTrecho: string | null; km: number | null }[][];
  linhas: LinhaDeKm[];
}

/** Km com separador de milhar e uma casa — a precisão que o export tem. */
function km(valor: number | null, casas = 1): string {
  if (valor === null) return "—";
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

function percentual(valor: number | null): string {
  if (valor === null) return "—";
  return `${(valor * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

/** O rótulo do que não tem valor — uma frase só, em toda a tela. */
const SEM_INFORMACAO = "Sem informação";

function Segmentacao({ titulo, cortes, total }: { titulo: string; cortes: CorteDeKm[]; total: number | null }) {
  const maior = cortes.reduce((m, c) => Math.max(m, c.kmTotal), 0);
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold mb-1">{titulo}</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Só dimensões que a vigência declara. As parcelas somam o total.
      </p>
      {cortes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem dado neste recorte.</p>
      ) : (
        <ul className="space-y-3">
          {cortes.map((c) => (
            <li key={c.chave ?? "∅"} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 items-center">
              <span className={`text-sm truncate ${c.chave === null ? "text-muted-foreground italic" : ""}`}>
                {c.chave ?? SEM_INFORMACAO}
              </span>
              <span className="text-sm tabular-nums font-medium">{km(c.kmTotal, 0)} km</span>
              <span className="col-span-2 h-1.5 rounded-full bg-muted overflow-hidden">
                <span
                  className="block h-full rounded-full bg-brand"
                  style={{ width: maior === 0 ? "0%" : `${(c.kmTotal / maior) * 100}%` }}
                />
              </span>
              <span className="col-span-2 text-xs text-muted-foreground">
                {c.trechos} trecho{c.trechos === 1 ? "" : "s"} · média {km(c.kmMedio)} km
                {total !== null && total > 0 ? ` · ${percentual(c.kmTotal / total)} do total` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const POR_PAGINA = 25;

export default function KmRodado() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);

  const unidade = params.get("unidade") ?? "";
  const operador = params.get("operador") ?? "";
  const capacidade = params.get("capacidade") ?? "";
  const regional = params.get("regional") ?? "";
  const pagina = Math.max(Number(params.get("pagina") ?? "1"), 1);
  const [mostrarDescartadas, setMostrarDescartadas] = useState(false);

  function atualizar(mudancas: Record<string, string | null>) {
    const novo = new URLSearchParams(search);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null || valor === "") novo.delete(chave);
      else novo.set(chave, valor);
    }
    if (!("pagina" in mudancas)) novo.delete("pagina");
    setLocation(`/km-rodado?${novo}`, { replace: true });
  }

  /*
    O par scopeHash/canal sai da URL — o mesmo que a barra lateral lê para
    decidir "unidade atual". Sem ele o servidor resolveria a vigência mais
    recente por conta própria, que pode não ser a que a lateral mostra.
  */
  const recorte = lerRecorte(search);
  const contexto = paramsDoRecorte(recorte, { comPeriodo: false });

  const queryParams = new URLSearchParams(contexto);
  if (unidade) queryParams.set("unidade", unidade);
  if (operador) queryParams.set("operador", operador);
  if (capacidade) queryParams.set("capacidade", capacidade);
  if (regional) queryParams.set("regional", regional);

  const consulta = useQuery({
    queryKey: ["km-rodado", queryParams.toString()],
    queryFn: ({ signal }) => fetchJson<RespostaDeKm>(`/km-rodado?${queryParams}`, { signal }),
  });

  const dados = consulta.data;
  const temFiltro = Boolean(unidade || operador || capacidade || regional);

  const linhasVisiveis = useMemo(() => {
    if (!dados) return [];
    const base = mostrarDescartadas ? dados.linhas : dados.linhas.filter((l) => l.exclusao === null);
    return [...base].sort((a, b) => (b.km ?? -1) - (a.km ?? -1));
  }, [dados, mostrarDescartadas]);

  const totalDescartadas = dados
    ? Object.values(dados.resumo.excluidos).reduce((s, n) => s + n, 0)
    : 0;

  const paginaAtual = linhasVisiveis.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  return (
    <Layout>
      <CabecalhoDePagina
        icone={Ruler}
        titulo="Km Rodado"
        descricao={
          <>
            A quilometragem que a tabela de frete <strong>contrata</strong> por trecho nesta
            vigência — ida mais volta. É o que multiplica todo R$/viagem e divide todo R$/km.
            Não é hodômetro nem GPS: este acervo não tem km realizado.
          </>
        }
        contexto={
          dados ? (
            <div className="text-right text-xs space-y-0.5">
              <div>
                Vigência: <strong>{dados.vigencia.sourceLabel}</strong>
              </div>
              <div className="text-muted-foreground">
                Efetiva em {new Date(`${dados.vigencia.effectiveDate}T12:00:00`).toLocaleDateString("pt-BR")}
              </div>
            </div>
          ) : undefined
        }
      />

      <div className="p-8 space-y-6">
        {consulta.isLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <LoadingSpinner className="w-5 h-5" />
            Lendo a quilometragem da vigência…
          </div>
        )}

        {consulta.isError && !dados && (
          <ApiErrorNotice
            error={consulta.error}
            what="Não foi possível ler o Km Rodado."
            onTentarDeNovo={() => consulta.refetch()}
            tentando={consulta.isFetching}
          />
        )}

        {dados && (
          <>
            {/* ---------------------------------------------------------- */}
            {/* Os filtros — aplicados no servidor, sempre.                 */}
            {/* ---------------------------------------------------------- */}
            <Card className="p-4 flex flex-wrap gap-3 items-end">
              {(
                [
                  ["Unidade", unidade, dados.opcoes.unidades, "unidade"],
                  ["Operador", operador, dados.opcoes.operadores, "operador"],
                  ["Capacidade", capacidade, dados.opcoes.capacidades, "capacidade"],
                  ["Regional", regional, dados.opcoes.regionais, "regional"],
                ] as const
              ).map(([rotulo, valor, opcoes, chave]) => (
                <div key={chave} className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    {rotulo}
                  </label>
                  <Select
                    value={valor === "" ? "__todas__" : valor}
                    onValueChange={(v) => atualizar({ [chave]: v === "__todas__" ? null : v })}
                  >
                    <SelectTrigger className="w-[190px]" id={`filtro-${chave}`}>
                      <SelectValue placeholder="Todas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__todas__">Todas</SelectItem>
                      {opcoes.map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              <div className="ml-auto text-xs text-muted-foreground">
                Filtros aplicados no servidor
                {temFiltro && (
                  <button
                    type="button"
                    className="ml-3 underline underline-offset-2 hover:text-foreground"
                    onClick={() =>
                      atualizar({ unidade: null, operador: null, capacidade: null, regional: null })
                    }
                  >
                    Limpar
                  </button>
                )}
              </div>
            </Card>

            {/* ---------------------------------------------------------- */}
            {/* Vazio e filtro-sem-resultado são respostas diferentes.      */}
            {/* ---------------------------------------------------------- */}
            {dados.resumo.trechos === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Route />
                  </EmptyMedia>
                  <EmptyTitle>
                    {temFiltro ? "Nenhum trecho com esses filtros" : "Sem dado nesta vigência"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {temFiltro ? (
                      <>
                        A vigência <strong>{dados.vigencia.sourceLabel}</strong> tem{" "}
                        {dados.resumo.trechosNoExport} trecho(s), mas nenhum atende ao recorte
                        escolhido. Limpe um filtro para voltar a ver.
                      </>
                    ) : totalDescartadas > 0 ? (
                      <>
                        Os {totalDescartadas} trechos desta vigência ficaram todos fora da conta —
                        veja os motivos na tabela. Nenhum km foi somado, e por isso a tela não
                        mostra zero.
                      </>
                    ) : (
                      <>
                        A vigência <strong>{dados.vigencia.sourceLabel}</strong> não trouxe nenhum
                        trecho. Confira em Importações se o arquivo de trecho subiu.
                      </>
                    )}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <>
                {/* -------------------------------------------------- */}
                {/* Os indicadores. Denominador sempre junto do número. */}
                {/* -------------------------------------------------- */}
                <div className="grid gap-4 md:grid-cols-3">
                  <CartaoDeIndicador
                    destaque
                    icone={Ruler}
                    rotulo="Km contratado no ciclo"
                    valor={`${km(dados.resumo.kmTotal, 0)} km`}
                    nota={`Soma de ${dados.resumo.trechos} trechos · ida + volta`}
                    ajuda="kmRodado = kmIda + kmVolta, somado sobre os trechos que entraram na conta."
                  />
                  <CartaoDeIndicador
                    icone={Gauge}
                    rotulo="Ciclo mediano"
                    valor={`${km(dados.resumo.mediana)} km`}
                    nota={`Média ${km(dados.resumo.media)} · p90 ${km(dados.resumo.p90)} km`}
                    ajuda="A mediana, e não a média, porque um trecho de 10.376 km desloca a média e não desloca a mediana."
                  />
                  <CartaoDeIndicador
                    icone={ScanSearch}
                    rotulo="Cobertura do cálculo"
                    valor={percentual(dados.resumo.cobertura)}
                    nota={`${dados.resumo.trechos} de ${dados.resumo.trechosNoExport} trechos do export`}
                    ajuda="Quantos trechos entraram na conta sobre quantos a vigência trouxe."
                  />
                  <CartaoDeIndicador
                    icone={Route}
                    rotulo="Faixa do ciclo"
                    valor={`${km(dados.resumo.minimo)} – ${km(dados.resumo.maximo, 0)} km`}
                    nota="Menor e maior ciclo contratado"
                  />
                  <CartaoDeIndicador
                    icone={ArrowLeftRight}
                    rotulo="Ida diferente da volta"
                    valor={`${dados.assimetria.assimetricos}`}
                    nota={
                      dados.assimetria.maiorDiferenca === null
                        ? "Todos os ciclos voltam pelo mesmo caminho"
                        : `Maior diferença ${km(dados.assimetria.maiorDiferenca)} km · ${dados.assimetria.simetricos} simétricos`
                    }
                    ajuda="A volta pode diferir da ida por rota, sinergia (F-MOV) ou retorno vazio — e uma diferença muito grande costuma ser cadastro."
                  />
                  <CartaoDeIndicador
                    icone={TriangleAlert}
                    rotulo="Fora da conta"
                    valor={totalDescartadas === 0 ? "Nenhum" : String(totalDescartadas)}
                    corDoIcone={
                      totalDescartadas === 0
                        ? "bg-success/10 text-success"
                        : "bg-warning/10 text-warning"
                    }
                    nota={
                      totalDescartadas === 0
                        ? `Nenhum trecho descartado${dados.resumo.colapsadas > 0 ? ` · ${dados.resumo.colapsadas} linha(s) duplicada(s) colapsada(s)` : ""}`
                        : (Object.entries(dados.resumo.excluidos) as [MotivoDeExclusao, number][])
                            .filter(([, n]) => n > 0)
                            .map(([m, n]) => `${n} ${MOTIVO_CURTO[m].toLowerCase()}`)
                            .join(" · ")
                    }
                  />
                </div>

                {/* -------------------------------------------------- */}
                {/* Dados parciais: dito na tela, não escondido.        */}
                {/* -------------------------------------------------- */}
                {dados.resumo.cobertura !== null && dados.resumo.cobertura < 1 && (
                  <Card className="p-4 border-l-4 border-l-warning">
                    <p className="text-sm">
                      <strong>Dados parciais.</strong> {totalDescartadas} de{" "}
                      {dados.resumo.trechosNoExport} trechos ficaram fora do total acima. Eles não
                      viraram zero: saíram do numerador e do denominador, e estão listados na
                      tabela com o motivo.
                    </p>
                    <ul className="mt-2 text-xs text-muted-foreground space-y-1">
                      {(Object.entries(dados.resumo.excluidos) as [MotivoDeExclusao, number][])
                        .filter(([, n]) => n > 0)
                        .map(([m, n]) => (
                          <li key={m}>
                            <strong>{n}</strong> — {MOTIVO_LONGO[m]}
                          </li>
                        ))}
                    </ul>
                  </Card>
                )}

                {/* -------------------------------------------------- */}
                {/* Conflito de identidade — contradição da fonte.      */}
                {/* -------------------------------------------------- */}
                {dados.conflitos.length > 0 && (
                  <Card className="p-4 border-l-4 border-l-destructive">
                    <p className="text-sm">
                      <strong>{dados.conflitos.length} trecho(s) com km contraditório.</strong> A
                      mesma identidade aparece mais de uma vez na vigência, com distâncias
                      diferentes. Nenhuma das linhas foi escolhida: as duas estão na tabela, e
                      qual vale é decisão de quem negocia.
                    </p>
                  </Card>
                )}

                <div className="grid gap-4 lg:grid-cols-2">
                  <Segmentacao titulo="Km por unidade" cortes={dados.porUnidade} total={dados.resumo.kmTotal} />
                  <Segmentacao titulo="Km por operador" cortes={dados.porOperador} total={dados.resumo.kmTotal} />
                  <Segmentacao titulo="Km por capacidade" cortes={dados.porCapacidade} total={dados.resumo.kmTotal} />
                  <Segmentacao titulo="Km por regional" cortes={dados.porRegional} total={dados.resumo.kmTotal} />
                </div>

                {/* -------------------------------------------------- */}
                {/* A divergência de km entre capacidades.             */}
                {/* -------------------------------------------------- */}
                <Card className="overflow-hidden">
                  <div className="p-5 border-b">
                    <h2 className="text-sm font-semibold">
                      Mesmo percurso, km diferente por capacidade
                    </h2>
                    <p className="text-xs text-muted-foreground mt-1">
                      A distância entre duas portas não depende de quantos pallets o caminhão leva.
                      Quando depende, uma das linhas está errada — a tela mostra as duas e não
                      elege vencedor.
                    </p>
                  </div>
                  {dados.divergencias.length === 0 ? (
                    <p className="p-5 text-sm text-muted-foreground">
                      Nenhum percurso diverge entre capacidades neste recorte.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Percurso</TableHead>
                            <TableHead>Unidade</TableHead>
                            <TableHead>Km por capacidade</TableHead>
                            <TableHead className="text-right">Amplitude</TableHead>
                            <TableHead className="text-right">%</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {dados.divergencias.slice(0, 20).map((d) => (
                            <TableRow key={d.percurso}>
                              <TableCell className="max-w-[320px] truncate" title={d.percurso}>
                                {d.percurso}
                              </TableCell>
                              <TableCell>{d.unidade ?? SEM_INFORMACAO}</TableCell>
                              <TableCell className="space-x-2 whitespace-nowrap">
                                {d.porCapacidade.map((c) => (
                                  <Badge key={c.capacidade ?? "∅"} variant="outline" className="tabular-nums">
                                    {c.pallets ?? "?"}p: {km(c.km)}
                                  </Badge>
                                ))}
                              </TableCell>
                              <TableCell className="text-right tabular-nums font-medium">
                                {km(d.amplitude)} km
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {percentual(d.amplitudeRelativa)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {dados.divergencias.length > 20 && (
                        <p className="p-4 text-xs text-muted-foreground border-t">
                          Mostrando os 20 de maior amplitude, de {dados.divergencias.length}.
                        </p>
                      )}
                    </div>
                  )}
                </Card>

                {/* -------------------------------------------------- */}
                {/* A tabela analítica — o agregado é a soma dela.      */}
                {/* -------------------------------------------------- */}
                <Card className="overflow-hidden">
                  <div className="p-5 border-b flex flex-wrap gap-3 items-center">
                    <div>
                      <h2 className="text-sm font-semibold">Os trechos que formaram o número</h2>
                      <p className="text-xs text-muted-foreground mt-1">
                        O total dos cartões é a soma desta tabela, e nada mais.
                      </p>
                    </div>
                    {totalDescartadas > 0 && (
                      <label className="ml-auto text-xs flex items-center gap-2 cursor-pointer">
                        <input
                          id="mostrar-descartadas"
                          type="checkbox"
                          checked={mostrarDescartadas}
                          onChange={(e) => setMostrarDescartadas(e.target.checked)}
                        />
                        Mostrar os {totalDescartadas} trechos fora da conta
                      </label>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Trecho</TableHead>
                          <TableHead>Unidade</TableHead>
                          <TableHead>Operador</TableHead>
                          <TableHead>Capacidade</TableHead>
                          <TableHead className="text-right">Km ida</TableHead>
                          <TableHead className="text-right">Km volta</TableHead>
                          <TableHead className="text-right">Km ciclo</TableHead>
                          <TableHead className="text-right">Km/mês por equipe</TableHead>
                          <TableHead>Situação</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginaAtual.map((l) => (
                          <TableRow key={l.entityId} className={l.exclusao !== null ? "opacity-70" : ""}>
                            <TableCell className="max-w-[300px] truncate" title={l.chaveTrecho ?? ""}>
                              {l.chaveTrecho ?? SEM_INFORMACAO}
                            </TableCell>
                            <TableCell>{l.unidade ?? SEM_INFORMACAO}</TableCell>
                            <TableCell>{l.operador ?? SEM_INFORMACAO}</TableCell>
                            <TableCell className="whitespace-nowrap">{l.capacidade ?? SEM_INFORMACAO}</TableCell>
                            <TableCell className="text-right tabular-nums">{km(l.kmIda)}</TableCell>
                            <TableCell className="text-right tabular-nums">{km(l.kmVolta)}</TableCell>
                            <TableCell className="text-right tabular-nums font-medium">
                              {l.km === null ? (
                                <span className="text-muted-foreground">Sem dado</span>
                              ) : (
                                km(l.km)
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{km(l.kmMes, 0)}</TableCell>
                            <TableCell>
                              {l.exclusao === null ? (
                                l.assimetria !== null && l.assimetria > 0.01 ? (
                                  <Badge variant="outline" title="Ida e volta têm distâncias diferentes">
                                    Ida ≠ volta
                                  </Badge>
                                ) : (
                                  <Badge variant="success">Na conta</Badge>
                                )
                              ) : (
                                <Badge variant="destructive" title={MOTIVO_LONGO[l.exclusao]}>
                                  {MOTIVO_CURTO[l.exclusao]}
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="p-4 border-t flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      {linhasVisiveis.length} trecho(s) nesta lista · {dados.resumo.trechos} na conta ·{" "}
                      {totalDescartadas} fora
                      {dados.resumo.colapsadas > 0 && ` · ${dados.resumo.colapsadas} duplicata(s) colapsada(s)`}
                    </span>
                    <div className="ml-auto">
                      <Paginacao
                        pagina={pagina}
                        porPagina={POR_PAGINA}
                        total={linhasVisiveis.length}
                        onPagina={(p) => atualizar({ pagina: String(p) })}
                      />
                    </div>
                  </div>
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
