import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Banknote, Download, Search, SlidersHorizontal } from "lucide-react";
import type { LinhaDeFiname } from "@workspace/comparison/finame";
import { VARIAVEIS_DE_FINAME } from "@workspace/comparison/finame";
import { Layout } from "@/components/layout/layout";
import { CabecalhoDePagina } from "@/components/layout/cabecalho-de-pagina";
import { ApiErrorNotice } from "@/components/api-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Paginacao } from "@/components/ui/paginacao";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SeletorDoPar, type VigenciaEscolhivel } from "@/components/finame/seletor-do-par";
import { CartoesDeFiname } from "@/components/finame/cartoes";
import {
  AlteracoesPorVariavel,
  DistribuicaoPorEstado,
  EvolucaoEntreVigencias,
  TotalPorVigencia,
} from "@/components/finame/graficos";
import { TabelaDeFiname } from "@/components/finame/tabela";
import { DetalheDoVeiculo } from "@/components/finame/detalhe";
import { fetchJson, salvarArquivo } from "@/lib/api";
import { csvComoBlob, paraNomeDeArquivo } from "@/lib/csv";
import { formatNumber } from "@/lib/format";
import {
  ABAS_DE_ESTADO,
  FILTROS_VAZIOS,
  contagemPorAba,
  filtrar,
  linhasDoCsv,
  type ComparacaoDeFiname,
  type FiltrosDeFiname,
  type TotaisDeFiname,
} from "@/lib/finame";
import { cn } from "@/lib/utils";

/**
 * AUDITORIA DE FINAME — o que mudou no financiamento entre duas vigências.
 *
 * ---------------------------------------------------------------------------
 * A pergunta desta tela, e a razão de ela abrir mostrando só o que mudou
 * ---------------------------------------------------------------------------
 * Quem a abre quer saber **o que se moveu** de uma planilha para a outra. O
 * acervo tem centenas de veículos e catorze variáveis de FINAME; listar as
 * ~4.000 linhas iguais ao lado das que mudaram esconderia o achado dentro da
 * massa. Por isso a tabela abre no recorte das alterações, e "Mostrar veículos
 * sem alteração" é um alternador desligado — quando ligado, o servidor lê as
 * duas vigências inteiras e devolve também as linhas iguais.
 *
 * **Nenhuma conta mora neste arquivo.** Estado, diferença, variação, impacto e
 * agregados vêm de `@workspace/comparison/finame`, que o servidor importa do
 * mesmo jeito. O que a página faz é escolher o par, filtrar, paginar e exportar
 * — e mesmo o filtro é uma função só, compartilhada com a contagem das abas,
 * para que a aba nunca prometa doze linhas e a tabela mostre nove.
 *
 * **A comparação é sempre do motor.** `/finame/comparacao` reaproveita o change
 * set quando ele existe e manda calcular quando não existe: é o mesmo caminho
 * de Comparar vigências, de modo que as duas telas respondem o mesmo número
 * para o mesmo par. As recusas do motor — escopo diferente, cobertura diferente,
 * canal diferente — chegam com a frase dele.
 */
export default function AuditoriaDeFiname() {
  const [base, setBase] = useState("");
  const [comparada, setComparada] = useState("");
  const [filtros, setFiltros] = useState<FiltrosDeFiname>(FILTROS_VAZIOS);
  const [comSemAlteracao, setComSemAlteracao] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(50);
  const [aberto, setAberto] = useState<{
    entityLabel: string | null;
    entityType: string;
  } | null>(null);

  const vigencias = useQuery({
    queryKey: ["snapshots"],
    queryFn: () => fetchJson<VigenciaEscolhivel[]>("/snapshots"),
  });

  /**
   * O par de partida: as duas vigências mais recentes **da mesma série**.
   *
   * Pegar as duas últimas linhas da lista emparelharia cavalo com carreta assim
   * que as duas séries existirem — elas compartilham as mesmas datas. O motor
   * recusaria o par, corretamente, e a tela abriria num erro que não é do
   * usuário. A mesma correção já foi feita em Comparar.
   */
  useEffect(() => {
    const lista = vigencias.data;
    if (!lista || lista.length < 2 || base || comparada) return;
    const ordenadas = [...lista].sort((a, b) =>
      b.effectiveDate.localeCompare(a.effectiveDate),
    );
    const ultima = ordenadas[0];
    const anterior = ordenadas.find(
      (v) => v.entityTypeSet === ultima.entityTypeSet && v.id !== ultima.id,
    );
    if (!anterior) return;
    setBase(anterior.id);
    setComparada(ultima.id);
  }, [vigencias.data, base, comparada]);

  const comparacao = useQuery({
    queryKey: ["finame", "comparacao", base, comparada, comSemAlteracao],
    enabled: Boolean(base && comparada),
    queryFn: () =>
      fetchJson<ComparacaoDeFiname>(
        `/finame/comparacao?base=${base}&comparada=${comparada}` +
          (comSemAlteracao ? "&semAlteracao=true" : ""),
      ),
  });

  const totais = useQuery({
    queryKey: ["finame", "totais", base, comparada],
    enabled: Boolean(base && comparada),
    queryFn: () => fetchJson<TotaisDeFiname>(`/finame/totais?base=${base}&comparada=${comparada}`),
  });

  const linhas = useMemo(() => comparacao.data?.linhas ?? [], [comparacao.data]);
  const filtradas = useMemo(() => filtrar(linhas, filtros), [linhas, filtros]);
  const contagens = useMemo(
    () => contagemPorAba(linhas, { ...filtros, estado: "TODAS" }),
    [linhas, filtros],
  );
  const naPagina = useMemo(
    () => filtradas.slice((pagina - 1) * porPagina, pagina * porPagina),
    [filtradas, pagina, porPagina],
  );

  // Filtrar encurta a lista; a página em que se estava pode não existir mais.
  useEffect(() => setPagina(1), [filtros, base, comparada, comSemAlteracao]);

  const rotuloBase =
    vigencias.data?.find((v) => v.id === base)?.sourceLabel ?? "Vigência Base";
  const rotuloComparada =
    vigencias.data?.find((v) => v.id === comparada)?.sourceLabel ?? "Vigência Comparada";

  function exportar() {
    const blob = csvComoBlob(linhasDoCsv(filtradas));
    salvarArquivo(
      blob,
      `finame-${paraNomeDeArquivo(rotuloBase)}-para-${paraNomeDeArquivo(rotuloComparada)}.csv`,
    );
  }

  return (
    <Layout>
      <CabecalhoDePagina
        titulo={
          <span className="flex flex-wrap items-center gap-2.5">
            Auditoria de FINAME
            <span className="rounded-full border border-brand/25 bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
              Comparação entre vigências
            </span>
          </span>
        }
        icone={Banknote}
        descricao="O que mudou no financiamento de cada veículo entre duas vigências: parcela, juros, amortização, taxa, prazo, carência, entrada e base de compra."
        atualizando={comparacao.isFetching && !comparacao.isLoading}
      />

      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 pb-10 sm:px-8">
        {vigencias.error ? (
          <ApiErrorNotice
            error={vigencias.error}
            what="a lista de vigências"
            onTentarDeNovo={() => void vigencias.refetch()}
          />
        ) : (
          <SeletorDoPar
            vigencias={vigencias.data ?? []}
            base={base}
            comparada={comparada}
            onBase={setBase}
            onComparada={setComparada}
            onInverter={() => {
              setBase(comparada);
              setComparada(base);
            }}
            carregando={comparacao.isFetching}
          />
        )}

        {comparacao.isLoading && (
          <div className="flex flex-col gap-4" aria-busy="true">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-96 rounded-xl" />
          </div>
        )}

        {comparacao.error && (
          <ApiErrorNotice
            error={comparacao.error}
            what="a comparação de FINAME"
            onTentarDeNovo={() => void comparacao.refetch()}
            tentando={comparacao.isFetching}
          />
        )}

        {comparacao.data && (
          <>
            <CartoesDeFiname resumo={comparacao.data.resumo} />

            {comparacao.data.resumo.impacto.cobertasPorParcelas > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatNumber(comparacao.data.resumo.impacto.cobertasPorParcelas, 0)}{" "}
                {comparacao.data.resumo.impacto.cobertasPorParcelas === 1
                  ? "parcela saiu"
                  : "parcelas saíram"}{" "}
                do total por já estarem representadas nas partes — o mesmo dinheiro não é
                contado duas vezes.
              </p>
            )}

            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              <TotalPorVigencia
                totais={totais.data?.totais ?? []}
                rotuloBase={rotuloBase}
                rotuloComparada={rotuloComparada}
              />
              <AlteracoesPorVariavel dados={comparacao.data.alteracoesPorVariavel} />
              <DistribuicaoPorEstado dados={comparacao.data.distribuicaoPorEstado} />
            </div>

            <EvolucaoEntreVigencias
              totais={totais.data?.totais ?? []}
              rotuloBase={rotuloBase}
              rotuloComparada={rotuloComparada}
            />

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b">
              {ABAS_DE_ESTADO.map((aba) => (
                <button
                  key={aba.chave}
                  type="button"
                  role="tab"
                  aria-selected={filtros.estado === aba.chave}
                  onClick={() => setFiltros((f) => ({ ...f, estado: aba.chave }))}
                  className={cn(
                    "border-b-2 py-2 text-sm font-semibold",
                    filtros.estado === aba.chave
                      ? "border-brand text-brand"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {/* Com o alternador ligado a lista deixa de ser só de
                      alterações — chamar 1.589 linhas iguais de "alterações"
                      seria o rótulo contradizendo a própria coluna Status. */}
                  {aba.chave === "TODAS" && comSemAlteracao ? "Todas as linhas" : aba.rotulo} (
                  {formatNumber(contagens[aba.chave] ?? 0, 0)})
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative min-w-[13rem] flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="finame-busca"
                  value={filtros.busca}
                  onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
                  placeholder="Buscar placa ou variável…"
                  aria-label="Buscar placa ou variável"
                  className="pl-9"
                />
              </div>

              <Select
                value={filtros.tipo}
                onValueChange={(tipo) => setFiltros((f) => ({ ...f, tipo }))}
              >
                <SelectTrigger className="w-[9.5rem]" aria-label="Tipo de equipamento">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">Todos os tipos</SelectItem>
                  <SelectItem value="CAVALO">Cavalo</SelectItem>
                  <SelectItem value="CARRETA">Carreta</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filtros.variavel}
                onValueChange={(variavel) => setFiltros((f) => ({ ...f, variavel }))}
              >
                <SelectTrigger className="w-[13rem]" aria-label="Variável de FINAME">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODAS">Todas as variáveis</SelectItem>
                  {VARIAVEIS_DE_FINAME.map((v) => (
                    <SelectItem key={v.chave} value={v.chave}>
                      {v.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <label
                htmlFor="finame-sem-alteracao"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="finame-sem-alteracao"
                  checked={comSemAlteracao}
                  onCheckedChange={setComSemAlteracao}
                />
                Mostrar veículos sem alteração
              </label>

              <Button
                type="button"
                variant="outline"
                onClick={exportar}
                disabled={filtradas.length === 0}
                className="ml-auto gap-2"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Exportar CSV
              </Button>
            </div>

            {filtradas.length === 0 ? (
              linhas.length === 0 ? (
                <EstadoVazio
                  icone={Banknote}
                  titulo="Nenhuma variável de FINAME mudou entre as duas vigências"
                  descricao={`${formatNumber(
                    comparacao.data.resumo.veiculosComparados,
                    0,
                  )} veículos comparados, e o financiamento de todos eles chegou igual nas duas planilhas.`}
                />
              ) : (
                <EstadoVazio
                  icone={SlidersHorizontal}
                  titulo="Nenhuma linha para este filtro"
                  descricao="O recorte atual não tem nenhuma alteração. Limpe os filtros para ver as demais."
                  acao={
                    <Button type="button" variant="outline" onClick={() => setFiltros(FILTROS_VAZIOS)}>
                      Limpar filtros
                    </Button>
                  }
                />
              )
            ) : (
              <>
                <TabelaDeFiname
                  linhas={naPagina}
                  onAbrir={(l) =>
                    setAberto({ entityLabel: l.entityLabel, entityType: l.entityType })
                  }
                />
                <Paginacao
                  pagina={pagina}
                  porPagina={porPagina}
                  total={filtradas.length}
                  onPagina={setPagina}
                  onPorPagina={setPorPagina}
                  tamanhos={[50, 100, 300]}
                  unidade="linhas"
                  unidadeSingular="linha"
                />
              </>
            )}

            <DetalheDoVeiculo
              veiculo={aberto}
              linhas={linhas as LinhaDeFiname[]}
              rotuloBase={rotuloBase}
              rotuloComparada={rotuloComparada}
              onFechar={() => setAberto(null)}
            />
          </>
        )}
      </div>
    </Layout>
  );
}
