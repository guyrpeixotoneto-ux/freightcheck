import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { DoorOpen, Download, Search, SlidersHorizontal } from "lucide-react";
import {
  TIPO_DA_FONTE_DO_TMA,
  type PortaDoTma,
  type VereditoDoLocal,
} from "@workspace/comparison/tma";
import {
  motivoSemPar,
  parReconciliado,
  rotulosDasVigencias,
  vigenciasDaUnidade,
  vigenciasQueCobrem,
} from "@workspace/comparison/recorte-de-rubrica";
import { avisoDoParImpossivel } from "@/lib/par-de-vigencias";
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
import { SeletorDoPar, type VigenciaEscolhivel } from "@/components/comparacao/seletor-do-par";
import { CartoesDeTma } from "@/components/tma/cartoes";
import {
  EvolucaoDoTempoDePorta,
  OQueEstaTelaNaoMede,
  OndeOLocalSeContradiz,
  PagoContraPraticado,
  PesoDaPortaNoCiclo,
} from "@/components/tma/graficos";
import { TabelaDeLocais, TabelaDeTrechos } from "@/components/tma/tabelas";
import { fetchJson, salvarArquivo } from "@/lib/api";
import { csvComoBlob, paraNomeDeArquivo } from "@/lib/csv";
import { formatNumber } from "@/lib/format";
import {
  FILTROS_VAZIOS,
  ROTULO_DA_PORTA,
  ROTULO_DO_VEREDITO_DO_LOCAL,
  contagemPorVeredito,
  filtrarLocais,
  filtrarTrechos,
  linhasDoCsvDeLocais,
  linhasDoCsvDeTrechos,
  type ComparacaoDeTma,
  type FiltrosDeTma,
  type GraoDaTela,
} from "@/lib/tma";
import { lerRecorte } from "@/lib/recorte";
import { contextoAberto, unidadeDe, useContextosDaCasca } from "@/lib/contextos";
import { cn } from "@/lib/utils";

/**
 * AUDITORIA DE TMA — o tempo de porta, por local e por trecho.
 *
 * ---------------------------------------------------------------------------
 * Por que esta tela tem dois grãos, e não um
 * ---------------------------------------------------------------------------
 * O verbete desta rota pede o tempo médio de atendimento **por unidade**, e é o
 * grão de **local** que responde a isso. O acervo declara o TMA por trecho, e o
 * TMA é uma propriedade do lugar — a doca, a portaria, a fila daquele CDD. A
 * mesma origem aparece em dezenas de trechos, e é preciso virar a tabela do
 * avesso para perguntar o óbvio: *o mesmo local está declarado com o mesmo tempo
 * em todos os trechos que passam por ele?* Nenhuma tela por trecho enxerga isso,
 * porque cada linha, separadamente, está certa.
 *
 * Mas quem negocia um contrato negocia **trechos**, e a pergunta *"quanto deste
 * ciclo é porta?"* é do percurso. É o grão de trecho que a responde, e é dele
 * que sai a fila de quem tem espera demais no ciclo.
 *
 * Os dois saem da **mesma leitura** — a mesma linha lida uma vez —, e é isso que
 * garante que nunca discordem: o tempo de um local é a média dos mesmos números
 * que aparecem no grão de trecho. O alternador no topo da tabela troca a
 * pergunta, e não a fonte.
 *
 * ---------------------------------------------------------------------------
 * O que esta tela não repete da Auditoria de Velocidade Média
 * ---------------------------------------------------------------------------
 * Lá as duas colunas de TMA aparecem como duas parcelas de tempo parado dentro
 * do ciclo. Aqui elas são a conta: o tempo de porta somado, a folga entre o pago
 * e o praticado, o peso no ciclo — e, sobretudo, o local declarado de dois
 * jeitos, que é um achado que só existe depois da inversão.
 *
 * **Nenhuma conta mora neste arquivo.** Tudo vem de `@workspace/comparison/tma`,
 * que o servidor importa igual.
 */
export default function AuditoriaDeTma() {
  const [base, setBase] = useState("");
  const [comparada, setComparada] = useState("");
  const [grao, setGrao] = useState<GraoDaTela>("LOCAL");
  const [filtros, setFiltros] = useState<FiltrosDeTma>(FILTROS_VAZIOS);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(50);

  const vigencias = useQuery({
    queryKey: ["snapshots"],
    queryFn: () => fetchJson<VigenciaEscolhivel[]>("/snapshots"),
  });

  /** A unidade aberta na lateral — sem isto, trocar de unidade trocaria de tela. */
  const recorte = lerRecorte(useSearch());

  const { contextos, carregando: contextosCarregando } = useContextosDaCasca();
  const nomePorEscopo = useMemo(() => {
    const nomes = new Map<string, string>();
    for (const c of contextos) nomes.set(c.scopeHash, unidadeDe(c));
    return nomes;
  }, [contextos]);

  const escopoAberto = contextoAberto(contextos, recorte.scopeHash)?.scopeHash ?? null;
  const unidadeResolvida = recorte.scopeHash !== null || !contextosCarregando;

  /**
   * As vigências que cobrem trecho, e só elas.
   *
   * O mesmo filtro da Auditoria de Km Rodado e da de Velocidade Média, pela mesma
   * razão: equipamento e trecho chegam em vigências separadas, e sem isto o par
   * de partida cai numa vigência de cavalo e a tela abre vazia — correta e
   * inexplicável.
   */
  const daUnidade = useMemo(
    () =>
      unidadeResolvida
        ? vigenciasQueCobrem(
            vigenciasDaUnidade(vigencias.data ?? [], escopoAberto),
            TIPO_DA_FONTE_DO_TMA,
          )
        : [],
    [vigencias.data, escopoAberto, unidadeResolvida],
  );

  const rotulos = useMemo(
    () => rotulosDasVigencias(daUnidade, (hash) => nomePorEscopo.get(hash) ?? null),
    [daUnidade, nomePorEscopo],
  );

  /**
   * O par aberto, mantido dentro da lista que o seletor oferece — e só ele.
   *
   * `parReconciliado` preserva a ponta que continua na lista e nunca desfaz
   * escolha de quem escolheu; quem some da lista — ao trocar de unidade — é que
   * dá lugar ao par de partida.
   */
  useEffect(() => {
    if (!vigencias.data || !unidadeResolvida) return;
    const par = parReconciliado(daUnidade, { base, comparada });
    if (par.base !== base) setBase(par.base);
    if (par.comparada !== comparada) setComparada(par.comparada);
  }, [vigencias.data, daUnidade, unidadeResolvida, base, comparada]);

  /**
   * Por que esta lista não dá par — quando não dá.
   *
   * Sai da lista, e não de "as duas pontas estão vazias": o par é escolhido num
   * efeito, que roda **depois** da renderização — ler o estado aqui piscaria a
   * tela vazia por um quadro em toda unidade que tem par.
   */
  const semPar =
    Boolean(vigencias.data) && unidadeResolvida ? motivoSemPar(daUnidade) : null;
  /** Há lista e mesmo assim não há par: a frase da tela vazia é outra. */
  const parImpossivel = semPar ? avisoDoParImpossivel(semPar) : null;
  /**
   * A tela vazia fala enquanto ninguém escolheu o par inteiro.
   *
   * Com as duas pontas escolhidas à mão — o que `parReconciliado` agora
   * preserva —, quem responde é a comparação, ou a recusa do servidor sobre
   * aquele par. Manter a frase no ar ao lado do resultado negaria o que está
   * logo abaixo dela.
   */
  const semParPossivel = semPar !== null && !(base && comparada);
  const semTrechoNaUnidade = semPar?.motivo === "LISTA_VAZIA";

  const comparacao = useQuery({
    queryKey: ["tma", "comparacao", base, comparada],
    enabled: Boolean(base && comparada),
    queryFn: () =>
      fetchJson<ComparacaoDeTma>(`/tma/comparacao?base=${base}&comparada=${comparada}`),
  });

  const locais = useMemo(() => comparacao.data?.locais ?? [], [comparacao.data]);
  const trechos = useMemo(() => comparacao.data?.trechos ?? [], [comparacao.data]);

  const locaisFiltrados = useMemo(() => filtrarLocais(locais, filtros), [locais, filtros]);
  const trechosFiltrados = useMemo(() => filtrarTrechos(trechos, filtros), [trechos, filtros]);
  const contagens = useMemo(() => contagemPorVeredito(locais, filtros), [locais, filtros]);

  const total = grao === "LOCAL" ? locaisFiltrados.length : trechosFiltrados.length;
  const locaisNaPagina = useMemo(
    () => locaisFiltrados.slice((pagina - 1) * porPagina, pagina * porPagina),
    [locaisFiltrados, pagina, porPagina],
  );
  const trechosNaPagina = useMemo(
    () => trechosFiltrados.slice((pagina - 1) * porPagina, pagina * porPagina),
    [trechosFiltrados, pagina, porPagina],
  );

  // Filtrar e trocar de grão encurtam a lista; a página em que se estava pode
  // não existir mais.
  useEffect(() => setPagina(1), [filtros, base, comparada, grao]);

  const rotuloBase = vigencias.data?.find((v) => v.id === base)?.sourceLabel ?? "De";
  const rotuloComparada =
    vigencias.data?.find((v) => v.id === comparada)?.sourceLabel ?? "Para";

  const daComparada = comparacao.data?.resumo.find((r) => r.ponta === "COMPARADA") ?? null;

  /** Os locais da vigência comparada — o recorte dos painéis, sempre. */
  const locaisDaComparada = useMemo(
    () => locais.filter((l) => l.ponta === "COMPARADA"),
    [locais],
  );
  const trechosDaComparada = useMemo(
    () => trechos.filter((t) => t.ponta === "COMPARADA"),
    [trechos],
  );

  /**
   * A exportação segue o grão aberto — dois arquivos, e não um com tudo.
   *
   * O grão do local tem doze colunas sobre portas e o do trecho tem doze sobre
   * ciclos. Um arquivo só teria vinte e quatro, metade vazia em cada linha.
   */
  function exportar() {
    const linhas =
      grao === "LOCAL"
        ? linhasDoCsvDeLocais(locaisFiltrados)
        : linhasDoCsvDeTrechos(trechosFiltrados);
    salvarArquivo(
      csvComoBlob(linhas),
      `tma-por-${grao === "LOCAL" ? "local" : "trecho"}-${paraNomeDeArquivo(
        rotuloBase,
      )}-para-${paraNomeDeArquivo(rotuloComparada)}.csv`,
    );
  }

  return (
    <Layout>
      <CabecalhoDePagina
        titulo={
          <span className="flex flex-wrap items-center gap-2.5">
            Auditoria de TMA
            <span className="rounded-full border border-brand/25 bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
              Tempo de porta · por local e por trecho
            </span>
          </span>
        }
        icone={DoorOpen}
        descricao="Quanto tempo o modelo reconhece em cada porta — e se o mesmo lugar está declarado do mesmo jeito em todos os trechos que passam por ele."
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
            vigencias={daUnidade}
            base={base}
            comparada={comparada}
            onBase={setBase}
            onComparada={setComparada}
            onInverter={() => {
              setBase(comparada);
              setComparada(base);
            }}
            rotulos={rotulos}
            carregando={comparacao.isFetching}
            idPrefixo="tma"
          />
        )}

        {semParPossivel && (
          <EstadoVazio
            icone={DoorOpen}
            titulo={
              parImpossivel
                ? parImpossivel.titulo
                : semTrechoNaUnidade
                  ? "Esta unidade não tem vigência de trecho importada"
                  : "Esta unidade não tem duas vigências de trecho para comparar"
            }
            descricao={
              parImpossivel
                ? parImpossivel.descricao
                : semTrechoNaUnidade
                  ? "O tempo de porta é declarado na tabela de frete, por trecho, e a desta unidade ainda não chegou ao acervo. As vigências de cavalo e carreta que ela tem alimentam as telas de custo fixo, não esta."
                  : "A leitura do tempo de porta precisa de duas vigências de trecho da mesma unidade. Escolha outra unidade na lateral ou importe a tabela de frete seguinte."
            }
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
            what="o tempo de porta das duas vigências"
            onTentarDeNovo={() => void comparacao.refetch()}
            tentando={comparacao.isFetching}
          />
        )}

        {comparacao.data && (
          <>
            <CartoesDeTma
              resumo={comparacao.data.resumo}
              rotuloComparada={rotuloComparada}
            />

            <OQueEstaTelaNaoMede pesoNoCiclo={daComparada?.pesoDasPortasNoCiclo ?? null} />

            {/*
              A contradição vem primeiro porque é a leitura que só esta tela faz.
              O peso no ciclo ao lado dela é o outro grão respondendo à mesma
              pergunta de outro ângulo: um local que se contradiz e um trecho que
              passa metade do ciclo parado são duas conversas diferentes, e as
              duas começam aqui.
            */}
            <div className="grid gap-3 lg:grid-cols-2">
              <OndeOLocalSeContradiz locais={locaisDaComparada} />
              <PesoDaPortaNoCiclo trechos={trechosDaComparada} />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <PagoContraPraticado locais={locaisDaComparada} />
              <EvolucaoDoTempoDePorta
                evolucao={comparacao.data.evolucaoDosLocais}
                rotuloBase={rotuloBase}
                rotuloComparada={rotuloComparada}
              />
            </div>

            {/*
              O alternador de grão é uma aba, e não um filtro: as duas tabelas
              têm colunas diferentes e respondem a perguntas diferentes. Tratá-lo
              como filtro sugeriria que uma é o recorte da outra.
            */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b">
              {(["LOCAL", "TRECHO"] as const).map((chave) => (
                <button
                  key={chave}
                  type="button"
                  role="tab"
                  aria-selected={grao === chave}
                  onClick={() => setGrao(chave)}
                  className={cn(
                    "border-b-2 py-2 text-sm font-semibold",
                    grao === chave
                      ? "border-brand text-brand"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {chave === "LOCAL" ? "Por local" : "Por trecho"} (
                  {formatNumber(
                    chave === "LOCAL" ? locaisFiltrados.length : trechosFiltrados.length,
                    0,
                  )}
                  )
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
                  id="tma-busca"
                  value={filtros.busca}
                  onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
                  placeholder={grao === "LOCAL" ? "Buscar local…" : "Buscar trecho…"}
                  aria-label={grao === "LOCAL" ? "Buscar local" : "Buscar trecho"}
                  className="pl-9"
                />
              </div>

              {grao === "LOCAL" && (
                <>
                  <Select
                    value={filtros.porta}
                    onValueChange={(porta) =>
                      setFiltros((f) => ({ ...f, porta: porta as "TODAS" | PortaDoTma }))
                    }
                  >
                    <SelectTrigger className="w-[15rem]" aria-label="Qual das duas portas">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TODAS">As duas portas</SelectItem>
                      <SelectItem value="ORIGEM">{ROTULO_DA_PORTA.ORIGEM}</SelectItem>
                      <SelectItem value="DESTINO">{ROTULO_DA_PORTA.DESTINO}</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select
                    value={filtros.veredito}
                    onValueChange={(veredito) =>
                      setFiltros((f) => ({
                        ...f,
                        veredito: veredito as "TODOS" | VereditoDoLocal,
                      }))
                    }
                  >
                    <SelectTrigger className="w-[17rem]" aria-label="Leitura do local">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TODOS">
                        Todas as leituras ({formatNumber(contagens.TODOS ?? 0, 0)})
                      </SelectItem>
                      {(["VARIA_POR_TRECHO", "TMA_UNICO", "UM_TRECHO_SO"] as const).map(
                        (v) => (
                          <SelectItem key={v} value={v}>
                            {ROTULO_DO_VEREDITO_DO_LOCAL[v]} (
                            {formatNumber(contagens[v] ?? 0, 0)})
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </>
              )}

              <label
                htmlFor="tma-duas-pontas"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="tma-duas-pontas"
                  checked={filtros.ponta === "TODAS"}
                  onCheckedChange={(duas) =>
                    setFiltros((f) => ({ ...f, ponta: duas ? "TODAS" : "COMPARADA" }))
                  }
                />
                Mostrar também a vigência base
              </label>

              <Button
                type="button"
                variant="outline"
                onClick={exportar}
                disabled={total === 0}
                className="ml-auto gap-2"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Exportar CSV
              </Button>
            </div>

            {total === 0 ? (
              (grao === "LOCAL" ? locais.length : trechos.length) === 0 ? (
                <EstadoVazio
                  icone={DoorOpen}
                  titulo={
                    grao === "LOCAL"
                      ? "Nenhum trecho destas vigências trouxe nome de origem ou de destino"
                      : "Nenhum trecho nestas vigências"
                  }
                  descricao={
                    grao === "LOCAL"
                      ? "Sem o nome do lugar não há tempo de porta por local — agrupar os anônimos sob um rótulo qualquer criaria um lugar que não existe e misturaria docas de unidades diferentes numa linha só. A leitura por trecho, na outra aba, continua valendo."
                      : "A tabela de frete destas vigências chegou sem linhas de trecho."
                  }
                />
              ) : (
                <EstadoVazio
                  icone={SlidersHorizontal}
                  titulo="Nenhuma linha para este filtro"
                  descricao="O recorte atual não tem nenhuma linha. Limpe os filtros para ver as demais."
                  acao={
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setFiltros(FILTROS_VAZIOS)}
                    >
                      Limpar filtros
                    </Button>
                  }
                />
              )
            ) : (
              <>
                {grao === "LOCAL" ? (
                  <TabelaDeLocais
                    locais={locaisNaPagina}
                    duasPontas={filtros.ponta === "TODAS"}
                    rotuloBase={rotuloBase}
                    rotuloComparada={rotuloComparada}
                  />
                ) : (
                  <TabelaDeTrechos
                    trechos={trechosNaPagina}
                    duasPontas={filtros.ponta === "TODAS"}
                    rotuloBase={rotuloBase}
                    rotuloComparada={rotuloComparada}
                  />
                )}
                <Paginacao
                  pagina={pagina}
                  porPagina={porPagina}
                  total={total}
                  onPagina={setPagina}
                  onPorPagina={setPorPagina}
                  tamanhos={[50, 100, 300]}
                  unidade={grao === "LOCAL" ? "portas de local" : "trechos"}
                  unidadeSingular={grao === "LOCAL" ? "porta de local" : "trecho"}
                />
              </>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
