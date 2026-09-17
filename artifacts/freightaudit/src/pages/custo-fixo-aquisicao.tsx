import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Download, Search, ShoppingCart, SlidersHorizontal } from "lucide-react";
import type { LinhaDeAquisicao } from "@workspace/comparison/aquisicao";
import {
  agruparPorVeiculoDeAquisicao,
  VARIAVEIS_DE_AQUISICAO,
  VARIAVEIS_DE_DETALHE_DE_AQUISICAO,
} from "@workspace/comparison/aquisicao";
import {
  motivoSemPar,
  parReconciliado,
  rotulosDasVigencias,
  vigenciasDaUnidade,
  vigenciasQueCobrem,
  TIPOS_DE_EQUIPAMENTO,
} from "@workspace/comparison/recorte-de-rubrica";
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
import {
  RecorteDeEquipamento,
  type RecorteDeTipo,
} from "@/components/comparacao/recorte-de-equipamento";
import { useCandidatosDoPar } from "@/hooks/use-candidatos-do-par";
import { avisoDoParImpossivel } from "@/lib/par-de-vigencias";
import { CartoesDeAquisicao } from "@/components/aquisicao/cartoes";
import {
  AlteracoesPorVariavel,
  CoerenciaDoCadastro,
  ConferenciaDaEntradaPainel,
  DistribuicaoPorEstado,
  ValorDeNotaPorVigencia,
} from "@/components/aquisicao/graficos";
import { TabelaDeAquisicao } from "@/components/aquisicao/tabela";
import { DetalheDoVeiculo } from "@/components/aquisicao/detalhe";
import { JustificarDialog } from "@/components/justificativas/justificar-dialog";
import { useJustificarNaTabela } from "@/lib/justificar-na-tabela";
import { fetchJson, salvarArquivo } from "@/lib/api";
import { csvComoBlob, paraNomeDeArquivo } from "@/lib/csv";
import { formatNumber } from "@/lib/format";
import {
  ABAS_DE_ESTADO,
  FILTROS_VAZIOS,
  contagemPorAba,
  filtrar,
  linhasDoCsv,
  type ComparacaoDeAquisicao,
  type FiltrosDeAquisicao,
  type TotaisDeAquisicao,
} from "@/lib/aquisicao";
import { lerRecorte } from "@/lib/recorte";
import { PainelDaEvolucao } from "@/components/comparacao/evolucao/painel";
import { EVOLUCAO_DA_AQUISICAO } from "@/components/aquisicao/evolucao";
import {
  ehModoDaAuditoria,
  ehRecorteDeTipo,
  trocaNaRota,
  type ModoDaAuditoria,
} from "@/lib/modo-da-auditoria";
import { contextoAberto, unidadeDe, useContextosDaCasca } from "@/lib/contextos";
import { cn } from "@/lib/utils";

/**
 * AUDITORIA DE AQUISIÇÃO — o que se pagou pelo ativo, e o que essa nota explica.
 *
 * ---------------------------------------------------------------------------
 * A tela que existe para o dia em que a nota mudar
 * ---------------------------------------------------------------------------
 * O valor de nota de compra já era lido por três telas — Finame, IPVA e
 * Impostos —, em todas como **base** do próprio número, e em nenhuma como
 * rubrica. Pela regra de desempate de `modulos-de-justificativa.ts`, um código
 * reivindicado por várias não é rubrica de nenhuma: a coluna que explica quatro
 * rubricas não tinha onde ser cobrada. Esta tela é esse lugar.
 *
 * E ela nasce sabendo que **a rubrica não se move**: medido nos dois caminhos em
 * `docs/ACHADO-AQUISICAO.md`, cada ativo tem um único valor de nota, de
 * percentual de entrada e de data ao longo das 18 vigências do acervo, e as 8
 * comparações calculadas não produziram uma linha de `change`.
 *
 * Isso decide o desenho da tela, e é o que a separa das outras quatro do Custo
 * Fixo:
 *
 * 1. **A conferência da base vem antes da comparação.** Os três painéis do topo
 *    — o valor de nota da frota, o veredito do percentual de entrada e a
 *    coerência do cadastro — são o que esta tela tem a dizer hoje, e são
 *    leituras das duas vigências inteiras, não do `change_set`.
 * 2. **O alternador "mostrar ativos sem alteração" é o conteúdo**, e não um
 *    conforto: é por ele que a tabela mostra a base que se quer conferir.
 * 3. **A aba de Evolução abre, quase sempre, na tela de "nada se moveu"** — e é
 *    essa a leitura que ela publica. Houve aqui a decisão oposta, de não ter a
 *    aba para não prometer movimento onde não há; ela deixava sem lugar quem
 *    precisa **afirmar** que a base de compra não se mexeu no ano, e obrigava a
 *    reabrir a comparação par a par para dizer isso. A tela vazia diz o mesmo em
 *    uma tela, com as vigências do ano nomeadas — e no dia em que uma nota for
 *    retificada, a matriz mostra qual ativo e em que vigência.
 *
 * **Nenhuma conta mora neste arquivo.** Estado, diferença, variação, impacto,
 * total de nota, conferência da entrada e coerência do cadastro vêm de
 * `@workspace/comparison/aquisicao`, que o servidor importa do mesmo jeito.
 */
/**
 * A rota desta auditoria — uma só, para os dois modos.
 *
 * `trocarNoEndereco` preserva tudo que não foi pedido: entrar na Evolução e
 * voltar devolve a comparação exatamente como estava — mesma unidade, mesmo
 * canal, mesmo par de vigências, mesmo recorte de equipamento.
 */
const ROTA = "/custo-fixo-aquisicao";
const trocarNoEndereco = trocaNaRota(ROTA);

export default function AuditoriaDeAquisicao() {
  const [base, setBase] = useState("");
  const [comparada, setComparada] = useState("");
  const [filtros, setFiltros] = useState<FiltrosDeAquisicao>(FILTROS_VAZIOS);
  /*
    Ligado por padrão, e é a única tela do produto em que isso acontece.

    Nas outras a pergunta é o que mudou, e o `change_set` responde. Aqui ele
    responde "nada" em todo par do acervo — e uma tela que abre vazia, por
    correta que esteja, é lida como defeito. Ligado, ela abre mostrando a base
    que existe para conferir, e as abas de estado continuam dizendo, com
    números, que nenhuma linha está alterada.
  */
  const [comSemAlteracao, setComSemAlteracao] = useState(true);
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

  /** A unidade aberta na lateral — sem isto, trocar de unidade trocaria de tela. */
  const busca = useSearch();
  const recorte = lerRecorte(busca);

  /**
   * O modo aberto, e o recorte **da evolução** — duas chaves próprias no mesmo
   * endereço.
   *
   * São chaves separadas de `filtros.tipo` de propósito, e é isso que faz a ida
   * e volta não custar nada: entrar na Evolução não toca no recorte da
   * comparação, que continua no estado e volta como estava ao sair. Unidade,
   * canal, `scopeHash` e o par de vigências nem são mencionados aqui.
   *
   * Valor adulterado cai no padrão em vez de quebrar: `comparacao` para o modo,
   * que é a tela que sempre existiu, e `TODOS` para o recorte da evolução.
   */
  const [, navegar] = useLocation();
  const parametrosDaUrl = useMemo(() => new URLSearchParams(busca), [busca]);
  const modoPedido = parametrosDaUrl.get("modo");
  const modo: ModoDaAuditoria = ehModoDaAuditoria(modoPedido) ? modoPedido : "comparacao";
  const recortePedido = parametrosDaUrl.get("recorteEvolucao");
  const recorteDaEvolucao: RecorteDeTipo = ehRecorteDeTipo(recortePedido)
    ? recortePedido
    : "TODOS";
  const anoDaEvolucao = parametrosDaUrl.get("ano");

  const trocarNaUrl = (mudancas: Record<string, string | null>) =>
    navegar(trocarNoEndereco(busca, mudancas));

  /** O contexto da unidade aberta, que atravessa os dois modos sem ser tocado. */
  const consultaDoContexto = useMemo(() => {
    const q = new URLSearchParams();
    for (const chave of ["scopeHash", "canal", "operacao"]) {
      const valor = parametrosDaUrl.get(chave);
      if (valor !== null && valor !== "") q.set(chave, valor);
    }
    return q;
  }, [parametrosDaUrl]);

  const { contextos, carregando: contextosCarregando } = useContextosDaCasca();
  const nomePorEscopo = useMemo(() => {
    const nomes = new Map<string, string>();
    for (const c of contextos) nomes.set(c.scopeHash, unidadeDe(c));
    return nomes;
  }, [contextos]);

  const escopoAberto = contextoAberto(contextos, recorte.scopeHash)?.scopeHash ?? null;
  const unidadeResolvida = recorte.scopeHash !== null || !contextosCarregando;

  /** A série aberta — cavalo, carreta, ou as duas. É ela que recorta a lista. */
  const recorteDeTipo = (filtros.tipo === "TODOS" ? "TODOS" : filtros.tipo) as RecorteDeTipo;

  /**
   * As vigências de equipamento da unidade — **antes** da aba.
   *
   * Duas coisas precisam do acervo inteiro da unidade, e não do recorte de uma
   * aba: o rótulo de cada vigência e quais abas habilitar.
   */
  const daUnidadeTodas = useMemo(
    () =>
      unidadeResolvida
        ? vigenciasQueCobrem(
            vigenciasDaUnidade(vigencias.data ?? [], escopoAberto),
            TIPOS_DE_EQUIPAMENTO,
          )
        : [],
    [vigencias.data, escopoAberto, unidadeResolvida],
  );

  /**
   * As datas da unidade — o eixo do ano, na Evolução.
   *
   * Sai de `daUnidadeTodas` (o acervo da unidade, antes da aba): quais anos
   * existem é pergunta sobre a unidade, e não sobre o recorte aberto. Recortada
   * pela aba, a lista de anos mudaria ao trocar de equipamento.
   */
  const datasDaUnidade = useMemo(
    () => [...new Set(daUnidadeTodas.map((v) => v.effectiveDate))],
    [daUnidadeTodas],
  );

  /** A lista que o seletor do par oferece — a da aba aberta. */
  const daUnidade = useMemo(
    () =>
      recorteDeTipo === "TODOS"
        ? daUnidadeTodas
        : vigenciasQueCobrem(daUnidadeTodas, [recorteDeTipo]),
    [daUnidadeTodas, recorteDeTipo],
  );

  /** Quais séries esta unidade tem — o que habilita cada aba. */
  const disponiveis = useMemo(
    () =>
      ({
        TODOS: true,
        CAVALO: vigenciasQueCobrem(daUnidadeTodas, ["CAVALO"]).length > 0,
        CARRETA: vigenciasQueCobrem(daUnidadeTodas, ["CARRETA"]).length > 0,
      }) as Record<RecorteDeTipo, boolean>,
    [daUnidadeTodas],
  );

  const rotulos = useMemo(
    () => rotulosDasVigencias(daUnidadeTodas, (hash) => nomePorEscopo.get(hash) ?? null),
    [daUnidadeTodas, nomePorEscopo],
  );

  /** Os números de cada candidata a "De", contra o "Para" aberto. */
  const candidatos = useCandidatosDoPar("aquisicao", comparada, escopoAberto);

  /** O par aberto, mantido dentro da lista que o seletor oferece — e só ele. */
  useEffect(() => {
    if (!vigencias.data || !unidadeResolvida) return;
    const par = parReconciliado(daUnidade, { base, comparada });
    if (par.base !== base) setBase(par.base);
    if (par.comparada !== comparada) setComparada(par.comparada);
  }, [vigencias.data, daUnidade, unidadeResolvida, base, comparada]);

  const semPar =
    Boolean(vigencias.data) && unidadeResolvida ? motivoSemPar(daUnidade) : null;
  const parImpossivel = semPar ? avisoDoParImpossivel(semPar) : null;
  const semParPossivel = semPar !== null && !(base && comparada);

  const comparacao = useQuery({
    queryKey: ["aquisicao", "comparacao", base, comparada, comSemAlteracao],
    enabled: Boolean(base && comparada),
    queryFn: () =>
      fetchJson<ComparacaoDeAquisicao>(
        `/aquisicao/comparacao?base=${base}&comparada=${comparada}` +
          (comSemAlteracao ? "&semAlteracao=true" : ""),
      ),
  });

  const totais = useQuery({
    queryKey: ["aquisicao", "totais", base, comparada],
    enabled: Boolean(base && comparada),
    queryFn: () =>
      fetchJson<TotaisDeAquisicao>(`/aquisicao/totais?base=${base}&comparada=${comparada}`),
  });

  const linhas = useMemo(() => comparacao.data?.linhas ?? [], [comparacao.data]);
  const filtradas = useMemo(() => filtrar(linhas, filtros), [linhas, filtros]);

  /** Os agregados do recorte aberto — calculados no servidor, nunca aqui. */
  const agregados =
    recorteDeTipo === "TODOS" ? comparacao.data : comparacao.data?.porTipo?.[recorteDeTipo];

  /** Os totais e as conferências do recorte aberto — as séries já vêm por tipo. */
  const totaisDoRecorte = useMemo(() => {
    const todos = totais.data?.totais ?? [];
    return recorteDeTipo === "TODOS"
      ? todos
      : todos.filter((t) => t.entityType === recorteDeTipo);
  }, [totais.data, recorteDeTipo]);

  const entradaDoRecorte = useMemo(() => {
    const todas = totais.data?.entrada ?? [];
    return recorteDeTipo === "TODOS"
      ? todas
      : todas.filter((e) => e.entityType === recorteDeTipo);
  }, [totais.data, recorteDeTipo]);

  const contagens = useMemo(
    () => contagemPorAba(linhas, { ...filtros, estado: "TODAS" }),
    [linhas, filtros],
  );

  /**
   * As placas — o que a tabela lista.
   *
   * **Agrupa depois de filtrar, e não antes.** As abas, a busca e os seletores
   * continuam sendo sobre a linha — é ali que moram o estado e a variável —, e a
   * placa entra na lista quando sobra alguma linha dela no recorte.
   */
  const veiculos = useMemo(() => agruparPorVeiculoDeAquisicao(filtradas), [filtradas]);
  const naPagina = useMemo(
    () => veiculos.slice((pagina - 1) * porPagina, pagina * porPagina),
    [veiculos, pagina, porPagina],
  );

  // Filtrar encurta a lista; a página em que se estava pode não existir mais.
  useEffect(() => setPagina(1), [filtros, base, comparada, comSemAlteracao]);

  const rotuloBase =
    rotulos.get(base) ?? vigencias.data?.find((v) => v.id === base)?.sourceLabel ?? "De";
  const rotuloComparada =
    rotulos.get(comparada) ??
    vigencias.data?.find((v) => v.id === comparada)?.sourceLabel ??
    "Para";

  const justificar = useJustificarNaTabela(
    comparacao.data?.changeSetId,
    `comparação ${rotuloBase} → ${rotuloComparada}`,
  );

  function exportar() {
    const blob = csvComoBlob(linhasDoCsv(filtradas, justificar.justificadaPor));
    salvarArquivo(
      blob,
      `aquisicao-${paraNomeDeArquivo(rotuloBase)}-para-${paraNomeDeArquivo(
        rotuloComparada,
      )}.csv`,
    );
  }

  return (
    <Layout>
      <CabecalhoDePagina
        titulo={
          <span className="flex flex-wrap items-center gap-2.5">
            Auditoria de Aquisição
            <span className="rounded-full border border-brand/25 bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
              {modo === "evolucao" ? "Evolução anual" : "Conferência da base · por ativo"}
            </span>
          </span>
        }
        icone={ShoppingCart}
        descricao={
          modo === "evolucao"
            ? "Se a base de compra de cada ativo se moveu ao longo do ano — valor de nota, percentual de entrada e data de entrada, uma coluna por vigência. Nada se mover é o resultado esperado, e é o que esta aba afirma de uma vez."
            : "Quanto o ativo custou, com que entrada e em que data — a nota que serve de base ao FINAME, ao IPVA, ao ICMS e ao PIS/COFINS, e que nenhuma outra tela cobra."
        }
        atualizando={
          modo === "comparacao" && comparacao.isFetching && !comparacao.isLoading
        }
      />

      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 pb-10 sm:px-8">
        {vigencias.error ? (
          <ApiErrorNotice
            error={vigencias.error}
            what="a lista de vigências"
            onTentarDeNovo={() => void vigencias.refetch()}
          />
        ) : (
          <>
            <RecorteDeEquipamento
              valor={recorteDeTipo}
              onValor={(tipo) => {
                /* Escolher um equipamento é sair da Evolução: os três primeiros
                   botões são da comparação, e clicar num deles é pedir a tela
                   deles. O recorte da evolução fica guardado para a volta. */
                setFiltros((f) => ({ ...f, tipo }));
                if (modo !== "comparacao") trocarNaUrl({ modo: null });
              }}
              disponiveis={disponiveis}
              idPrefixo="aquisicao"
              abaExtra={{
                rotulo: "Evolução",
                ativa: modo === "evolucao",
                onAbrir: () => trocarNaUrl({ modo: "evolucao" }),
                ...(daUnidadeTodas.length === 0
                  ? {
                      indisponivel:
                        "Esta unidade ainda não tem vigência de equipamento importada — não há ano para acompanhar.",
                    }
                  : {}),
              }}
            />
            {modo === "evolucao" && (
              <PainelDaEvolucao
                rubrica={EVOLUCAO_DA_AQUISICAO}
                consulta={consultaDoContexto}
                datas={datasDaUnidade}
                recorte={recorteDaEvolucao}
                onRecorte={(r) => trocarNaUrl({ recorteEvolucao: r === "TODOS" ? null : r })}
                ano={anoDaEvolucao}
                onAno={(a) => trocarNaUrl({ ano: a })}
                disponiveis={disponiveis}
              />
            )}
            {modo === "comparacao" && (
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
              idPrefixo="aquisicao"
              candidatos={candidatos.data}
              carregandoCandidatos={candidatos.isFetching}
              erroDosCandidatos={
                candidatos.error instanceof Error ? candidatos.error.message : null
              }
            />
            )}
          </>
        )}

        {/*
          Tudo abaixo é da comparação: a tela vazia, os cartões, os gráficos, a
          tabela e a gaveta. Na Evolução o painel acima responde sozinho, e
          deixar esta metade no ar poria a matriz do ano sob os cartões de um par
          de vigências — o número de um recorte sob o título de outro.
        */}
        {modo === "comparacao" && (
          <>
        {semParPossivel && (
          <EstadoVazio
            icone={ShoppingCart}
            titulo={
              parImpossivel
                ? parImpossivel.titulo
                : "Esta unidade não tem duas vigências de equipamento para comparar"
            }
            descricao={
              parImpossivel
                ? parImpossivel.descricao
                : "A conferência da aquisição precisa de duas vigências da mesma unidade. Escolha outra unidade na lateral ou importe a vigência seguinte."
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
            what="a comparação de aquisição"
            onTentarDeNovo={() => void comparacao.refetch()}
            tentando={comparacao.isFetching}
          />
        )}

        {comparacao.data && (
          <>
            <CartoesDeAquisicao resumo={(agregados ?? comparacao.data).resumo} />

            {totais.error && (
              <ApiErrorNotice
                error={totais.error}
                what="a conferência da base"
                onTentarDeNovo={() => void totais.refetch()}
                tentando={totais.isFetching}
              />
            )}

            {/*
              As duas conferências vêm em largura inteira, e antes dos gráficos da
              comparação, porque são a leitura própria desta tela — a única que
              nenhuma outra do produto faz. Espremê-las numa coluna de gráfico as
              deixaria com cara de painel auxiliar, e elas são o painel principal.
            */}
            <ConferenciaDaEntradaPainel
              entrada={entradaDoRecorte}
              rotuloBase={rotuloBase}
              rotuloComparada={rotuloComparada}
            />

            <CoerenciaDoCadastro
              coerencia={totais.data?.coerencia}
              rotuloBase={rotuloBase}
              rotuloComparada={rotuloComparada}
            />

            <div className="grid gap-3 lg:grid-cols-2">
              <ValorDeNotaPorVigencia
                totais={totaisDoRecorte}
                rotuloBase={rotuloBase}
                rotuloComparada={rotuloComparada}
              />
              <AlteracoesPorVariavel
                dados={(agregados ?? comparacao.data).alteracoesPorVariavel}
              />
              <DistribuicaoPorEstado
                dados={(agregados ?? comparacao.data).distribuicaoPorEstado}
              />
            </div>

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
                      alterações — e nesta tela ele nasce ligado, então chamar as
                      linhas iguais de "alterações" seria o rótulo contradizendo a
                      coluna Status já na primeira renderização. */}
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
                  id="aquisicao-busca"
                  value={filtros.busca}
                  onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
                  placeholder="Buscar placa ou variável…"
                  aria-label="Buscar placa ou variável"
                  className="pl-9"
                />
              </div>

              {/*
                O filtro de papel é o que esta tabela não pode não ter: a mesma
                coluna de valores mistura reais, percentual e data, e ler uma
                grandeza de cada vez é o que a torna comparável linha a linha.
              */}
              <Select
                value={filtros.papel}
                onValueChange={(papel) =>
                  setFiltros((f) => ({ ...f, papel: papel as FiltrosDeAquisicao["papel"] }))
                }
              >
                <SelectTrigger className="w-[12rem]" aria-label="Papel da coluna">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">Todos os papéis</SelectItem>
                  <SelectItem value="MONTANTE">Montante (R$)</SelectItem>
                  <SelectItem value="ALIQUOTA">Alíquota (%)</SelectItem>
                  <SelectItem value="CADASTRO">Cadastro</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filtros.variavel}
                onValueChange={(variavel) => setFiltros((f) => ({ ...f, variavel }))}
              >
                <SelectTrigger className="w-[16rem]" aria-label="Variável de aquisição">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODAS">Todas as variáveis</SelectItem>
                  {[...VARIAVEIS_DE_AQUISICAO, ...VARIAVEIS_DE_DETALHE_DE_AQUISICAO].map(
                    (v) => (
                      <SelectItem key={v.chave} value={v.chave}>
                        {v.rotulo}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>

              <label
                htmlFor="aquisicao-so-nota"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="aquisicao-so-nota"
                  checked={filtros.soNota}
                  onCheckedChange={(soNota) => setFiltros((f) => ({ ...f, soNota }))}
                />
                Só o valor de nota
              </label>

              <label
                htmlFor="aquisicao-sem-alteracao"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="aquisicao-sem-alteracao"
                  checked={comSemAlteracao}
                  onCheckedChange={setComSemAlteracao}
                />
                Mostrar ativos sem alteração
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

            {veiculos.length === 0 ? (
              linhas.length === 0 ? (
                <EstadoVazio
                  icone={ShoppingCart}
                  titulo="Nenhuma coluna de aquisição mudou entre as duas vigências"
                  descricao={`${formatNumber(
                    (agregados ?? comparacao.data).resumo.veiculosComparados,
                    0,
                  )} ativos comparados, e a nota de todos eles chegou igual nas duas vigências — que é o esperado de uma compra já feita. Ligue "Mostrar ativos sem alteração" para conferir a base, ou leia as duas conferências acima, que não olham o que mudou.`}
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
                <TabelaDeAquisicao
                  veiculos={naPagina}
                  justificadaPor={justificar.justificadaPor}
                  onAbrir={(v) => setAberto(v)}
                  onJustificar={justificar.abrir}
                />
                <Paginacao
                  pagina={pagina}
                  porPagina={porPagina}
                  total={veiculos.length}
                  onPagina={setPagina}
                  onPorPagina={setPorPagina}
                  tamanhos={[50, 100, 300]}
                  unidade="ativos"
                  unidadeSingular="ativo"
                />
              </>
            )}

            <JustificarDialog {...justificar.propsDoDialogo} />

            <DetalheDoVeiculo
              veiculo={aberto}
              linhas={linhas as LinhaDeAquisicao[]}
              rotuloBase={rotuloBase}
              rotuloComparada={rotuloComparada}
              onFechar={() => setAberto(null)}
            />
          </>
        )}
          </>
        )}
      </div>
    </Layout>
  );
}
