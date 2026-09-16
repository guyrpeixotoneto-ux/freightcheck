import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CircleDot, Download, Search, SlidersHorizontal } from "lucide-react";
import type { LinhaDePneu } from "@workspace/comparison/pneu";
import {
  TIPO_DO_PNEU,
  VARIAVEIS_DE_DETALHE_DE_PNEU,
  VARIAVEIS_DE_PNEU,
} from "@workspace/comparison/pneu";
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
import { useCandidatosDoPar } from "@/hooks/use-candidatos-do-par";
import {
  motivoSemPar,
  parReconciliado,
  rotulosDasVigencias,
  vigenciasDaUnidade,
  vigenciasQueCobrem,
} from "@workspace/comparison/recorte-de-rubrica";
import { avisoDoParImpossivel } from "@/lib/par-de-vigencias";
import { CartoesDePneu } from "@/components/pneu/cartoes";
import {
  AlteracoesPorVariavel,
  ColunasDoEquipamento,
  ConferenciaDoPneu,
  CustoDoPneu,
  DistribuicaoPorEstado,
  ReconstituicaoDoPneu,
} from "@/components/pneu/graficos";
import { TabelaDePneu } from "@/components/pneu/tabela";
import { JustificarDialog } from "@/components/justificativas/justificar-dialog";
import { useJustificarNaTabela } from "@/lib/justificar-na-tabela";
import { DetalheDoTrecho } from "@/components/pneu/detalhe";
import { fetchJson, salvarArquivo } from "@/lib/api";
import { csvComoBlob, paraNomeDeArquivo } from "@/lib/csv";
import { formatNumber } from "@/lib/format";
import {
  ABAS_DE_ESTADO,
  FILTROS_VAZIOS,
  contagemPorAba,
  filtrar,
  linhasDoCsv,
  type ComparacaoDePneu,
  type FiltrosDePneu,
  type TotaisDePneu,
} from "@/lib/pneu";
import { lerRecorte } from "@/lib/recorte";
import { contextoAberto, unidadeDe, useContextosDaCasca } from "@/lib/contextos";
import { cn } from "@/lib/utils";

/**
 * AUDITORIA DE PNEU — o que a carcaça custa por quilômetro.
 *
 * ---------------------------------------------------------------------------
 * A tela que nasceu de uma linha zerada
 * ---------------------------------------------------------------------------
 * O pneu era a última linha da Auditoria de Manutenção e Pneu, e era a linha que
 * não tinha número: `cavalo.valor_pneu` e `carreta.valor_pneus` chegam zerados em
 * 100% das linhas do acervo, e a medida do pneu é a mesma para a frota inteira.
 * Com essas três colunas, pneu não dava tela — dava uma ressalva.
 *
 * O que ninguém tinha olhado é que **o pneu com dado deste acervo não está no
 * equipamento: está no trecho**. A tabela de frete declara sete colunas de pneu
 * por percurso — quantos pneus o conjunto leva, quanto custa cada um novo, quanto
 * custa a recapagem, quanto a carcaça é revendida, quantos quilômetros ela dura,
 * quantos ela dura ajustada, e o R$/km que sai disso —, e nenhuma delas aparecia
 * em tela nenhuma deste produto.
 *
 * Por isso a separação não é arrumação de menu: é uma tela que passou a existir.
 * A Manutenção ficou com um grão só (o cavalo, e o contrato dele) e esta nasceu
 * com o grão em que o pneu de fato é medido.
 *
 * ---------------------------------------------------------------------------
 * As duas contas que esta tela fecha, e a terceira que ela recusa fechar
 * ---------------------------------------------------------------------------
 * 1. **O R$/km de pneu do preço tem de ser o custo de pneus e câmaras.** Duas
 *    colunas independentes sobre o mesmo dinheiro; quando divergem, o preço
 *    daquele trecho carrega um pneu diferente do que o modelo apurou. Preço
 *    **abaixo** do custo sai contado à parte: é desgaste que ninguém cobra.
 * 2. **R$/viagem ÷ R$/km tem de dar o km do ciclo** — a identidade que o
 *    dicionário da tabela de frete publica.
 * 3. A **reconstituição** do R$/km pelos cinco componentes existe, aparece, e
 *    **não é veredito**: ela supõe uma recapagem por carcaça, e o acervo não
 *    declara quantas são. Ela informa a distância e deixa a leitura para quem
 *    conhece o contrato — a mesma postura da Manutenção diante do R$/km resolvido
 *    sem contrato.
 *
 * **Nenhuma conta mora neste arquivo.** Estado, diferença, variação, impacto,
 * custo por vigência, reconstituição e as duas conferências vêm de
 * `@workspace/comparison/pneu`, que o servidor importa do mesmo jeito.
 */
export default function AuditoriaDePneu() {
  const [base, setBase] = useState("");
  const [comparada, setComparada] = useState("");
  const [filtros, setFiltros] = useState<FiltrosDePneu>(FILTROS_VAZIOS);
  const [comSemAlteracao, setComSemAlteracao] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(50);
  const [aberto, setAberto] = useState<{ entityLabel: string | null } | null>(null);

  const vigencias = useQuery({
    queryKey: ["snapshots"],
    queryFn: () => fetchJson<VigenciaEscolhivel[]>("/snapshots"),
  });

  /**
   * A unidade aberta na lateral — e por que esta tela precisa saber dela.
   *
   * Sem isto, trocar de unidade aqui não trocaria o dado: trocaria de tela.
   * `enderecoDe` (`lib/navegacao-do-escopo.ts`) desvia para Parâmetros toda tela
   * que não sabe ler o recorte. Estar em `TELAS_QUE_HONRAM_ESCOPO` é uma promessa,
   * e o que a cumpre é o recorte abaixo.
   */
  const recorte = lerRecorte(useSearch());

  const { contextos, carregando: contextosCarregando } = useContextosDaCasca();
  const nomePorEscopo = useMemo(() => {
    const nomes = new Map<string, string>();
    for (const c of contextos) nomes.set(c.scopeHash, unidadeDe(c));
    return nomes;
  }, [contextos]);

  /** A unidade aberta — a mesma que a lateral nomeia, com ou sem `scopeHash`. */
  const escopoAberto = contextoAberto(contextos, recorte.scopeHash)?.scopeHash ?? null;

  /**
   * Os números de cada candidata a "De", contra o "Para" aberto.
   *
   * A pergunta, a chave e a cadência moram em `useCandidatosDoPar`, com as demais
   * rubricas: telas irmãs respondendo com fôlegos diferentes seria diferença sem
   * motivo.
   */
  const candidatos = useCandidatosDoPar("pneu", comparada, escopoAberto);

  const unidadeResolvida = recorte.scopeHash !== null || !contextosCarregando;

  /**
   * As vigências que o seletor oferece: as da unidade aberta **que cobrem
   * trecho**.
   *
   * O segundo filtro é o mesmo da Auditoria de Km Rodado, e não é refinamento: no
   * acervo, a mesma unidade entrega o arquivo de equipamento e o de trecho em
   * vigências separadas. Sem ele, o par de partida cai na vigência de cavalo mais
   * recente e a tela abre com zero linhas — correta e inexplicável.
   */
  const daUnidade = useMemo(
    () =>
      unidadeResolvida
        ? vigenciasQueCobrem(
            vigenciasDaUnidade(vigencias.data ?? [], escopoAberto),
            TIPO_DO_PNEU,
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
   * Ao trocar de unidade, o par anterior deixa de estar nela — e mantê-lo faria a
   * tela responder por Pernambuco sob a palavra CAMAÇARI. O que `parReconciliado`
   * nunca faz é desfazer escolha de quem escolheu.
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
  const parImpossivel = semPar ? avisoDoParImpossivel(semPar) : null;
  const semParPossivel = semPar !== null && !(base && comparada);
  const semTrechoNaUnidade = semPar?.motivo === "LISTA_VAZIA";

  const comparacao = useQuery({
    queryKey: ["pneu", "comparacao", base, comparada, comSemAlteracao],
    enabled: Boolean(base && comparada),
    queryFn: () =>
      fetchJson<ComparacaoDePneu>(
        `/pneu/comparacao?base=${base}&comparada=${comparada}` +
          (comSemAlteracao ? "&semAlteracao=true" : ""),
      ),
  });

  const totais = useQuery({
    queryKey: ["pneu", "totais", base, comparada],
    enabled: Boolean(base && comparada),
    queryFn: () =>
      fetchJson<TotaisDePneu>(`/pneu/totais?base=${base}&comparada=${comparada}`),
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

  const rotuloBase = vigencias.data?.find((v) => v.id === base)?.sourceLabel ?? "De";
  const rotuloComparada =
    vigencias.data?.find((v) => v.id === comparada)?.sourceLabel ?? "Para";

  /*
    Justificar sem sair daqui — a mesma caixa de Chamados, o mesmo POST, e a
    vigência escrita nela: quem justifica a partir desta tela escolheu o par no
    seletor acima, e um diálogo que não diz onde grava deixa a decisão sem a
    metade que a torna verificável.
  */
  const justificar = useJustificarNaTabela(
    comparacao.data?.changeSetId,
    `comparação ${rotuloBase} → ${rotuloComparada}`,
  );

  function exportar() {
    const blob = csvComoBlob(linhasDoCsv(filtradas, justificar.justificadaPor));
    salvarArquivo(
      blob,
      `pneu-${paraNomeDeArquivo(rotuloBase)}-para-${paraNomeDeArquivo(rotuloComparada)}.csv`,
    );
  }

  const razoes = comparacao.data?.resumo.impacto.razoesAlteradas ?? 0;

  return (
    <Layout>
      <CabecalhoDePagina
        titulo={
          <span className="flex flex-wrap items-center gap-2.5">
            Auditoria de Pneu
            <span className="rounded-full border border-brand/25 bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
              Comparação entre vigências · por trecho
            </span>
          </span>
        }
        icone={CircleDot}
        descricao="Quanto a carcaça custa por quilômetro em cada trecho — quantos pneus, quanto cada um, quanto dura — e se o preço do frete cobra o pneu que o modelo apurou."
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
            idPrefixo="pneu"
            candidatos={candidatos.data}
            carregandoCandidatos={candidatos.isFetching}
            erroDosCandidatos={
              candidatos.error instanceof Error ? candidatos.error.message : null
            }
          />
        )}

        {semParPossivel && (
          <EstadoVazio
            icone={CircleDot}
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
                  ? "O pneu com dado deste acervo é por trecho, e a tabela de frete desta unidade ainda não chegou. As vigências de cavalo e carreta que ela tem alimentam as telas de custo fixo, não esta."
                  : "A comparação de pneu precisa de duas vigências de trecho da mesma unidade. Escolha outra unidade na lateral ou importe a tabela de frete seguinte."
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
            what="a comparação de pneu"
            onTentarDeNovo={() => void comparacao.refetch()}
            tentando={comparacao.isFetching}
          />
        )}

        {comparacao.data && (
          <>
            <CartoesDePneu resumo={comparacao.data.resumo} />

            {/*
              A conferência vem em largura inteira, e logo abaixo dos indicadores,
              por ser a leitura própria desta tela — a única que nenhuma outra do
              produto faz. Espremê-la numa das colunas de gráfico a deixaria com
              cara de painel auxiliar.
            */}
            <ConferenciaDoPneu
              conferencias={totais.data?.conferencias ?? []}
              rotuloBase={rotuloBase}
              rotuloComparada={rotuloComparada}
            />

            <ReconstituicaoDoPneu
              reconstituicao={totais.data?.reconstituicao ?? []}
              rotuloBase={rotuloBase}
              rotuloComparada={rotuloComparada}
            />

            <div className="grid gap-3 lg:grid-cols-2">
              <CustoDoPneu
                custo={totais.data?.custo ?? []}
                rotuloBase={rotuloBase}
                rotuloComparada={rotuloComparada}
              />
              <AlteracoesPorVariavel dados={comparacao.data.alteracoesPorVariavel} />
              <DistribuicaoPorEstado dados={comparacao.data.distribuicaoPorEstado} />
              <ColunasDoEquipamento />
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
                      alterações — chamar centenas de linhas iguais de
                      "alterações" seria o rótulo contradizendo a coluna Status. */}
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
                  id="pneu-busca"
                  value={filtros.busca}
                  onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
                  placeholder="Buscar trecho ou variável…"
                  aria-label="Buscar trecho ou variável"
                  className="pl-9"
                />
              </div>

              {/*
                O filtro de unidade é o que esta tabela não pode não ter: a mesma
                coluna de valores mistura R$/km, reais por pneu, pneus e
                quilômetros de vida, e ler uma delas de cada vez é o que torna a
                tabela comparável linha a linha.
              */}
              <Select
                value={filtros.papel}
                onValueChange={(papel) =>
                  setFiltros((f) => ({ ...f, papel: papel as FiltrosDePneu["papel"] }))
                }
              >
                <SelectTrigger className="w-[12rem]" aria-label="Unidade da variável">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">Todas as unidades</SelectItem>
                  <SelectItem value="RAZAO">R$/km</SelectItem>
                  <SelectItem value="UNITARIO">R$ por pneu</SelectItem>
                  <SelectItem value="QUANTIDADE">Quantidade</SelectItem>
                  <SelectItem value="VIDA">Vida útil</SelectItem>
                  <SelectItem value="POR_VIAGEM">R$/viagem</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filtros.variavel}
                onValueChange={(variavel) => setFiltros((f) => ({ ...f, variavel }))}
              >
                <SelectTrigger className="w-[18rem]" aria-label="Variável de pneu">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODAS">Todas as variáveis</SelectItem>
                  {[...VARIAVEIS_DE_PNEU, ...VARIAVEIS_DE_DETALHE_DE_PNEU].map((v) => (
                    <SelectItem key={v.chave} value={v.chave}>
                      {v.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <label
                htmlFor="pneu-so-reais-km"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="pneu-so-reais-km"
                  checked={filtros.soReaisPorKm}
                  onCheckedChange={(soReaisPorKm) =>
                    setFiltros((f) => ({ ...f, soReaisPorKm }))
                  }
                />
                Só o custo por km
                {razoes > 0 && (
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-foreground">
                    {formatNumber(razoes, 0)}
                  </span>
                )}
              </label>

              <label
                htmlFor="pneu-sem-alteracao"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="pneu-sem-alteracao"
                  checked={comSemAlteracao}
                  onCheckedChange={setComSemAlteracao}
                />
                Mostrar trechos sem alteração
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
                  icone={CircleDot}
                  titulo="Nenhuma variável de pneu mudou entre as duas vigências"
                  descricao={`${formatNumber(
                    comparacao.data.resumo.trechosComparados,
                    0,
                  )} trechos comparados, e o pneu de todos eles chegou igual nas duas tabelas. A conferência acima continua valendo — ela não olha o que mudou, olha se cada trecho fecha as próprias contas.`}
                />
              ) : (
                <EstadoVazio
                  icone={SlidersHorizontal}
                  titulo="Nenhuma linha para este filtro"
                  descricao="O recorte atual não tem nenhuma alteração. Limpe os filtros para ver as demais."
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
                <TabelaDePneu
                  linhas={naPagina}
                  justificadaPor={justificar.justificadaPor}
                  onAbrir={(l) => setAberto({ entityLabel: l.entityLabel })}
                  onJustificar={justificar.abrir}
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

            <JustificarDialog {...justificar.propsDoDialogo} />

            <DetalheDoTrecho
              trecho={aberto}
              linhas={linhas as LinhaDePneu[]}
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
