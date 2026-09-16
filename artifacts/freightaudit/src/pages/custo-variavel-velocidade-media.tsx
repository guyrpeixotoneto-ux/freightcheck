import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Download, Gauge, Search, SlidersHorizontal } from "lucide-react";
import type { LinhaDeVelocidade } from "@workspace/comparison/velocidade-media";
import {
  TIPO_DA_VELOCIDADE,
  VARIAVEIS_DE_DETALHE_DE_VELOCIDADE,
  VARIAVEIS_DE_VELOCIDADE,
} from "@workspace/comparison/velocidade-media";
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
  motivoSemPar,
  parReconciliado,
  rotulosDasVigencias,
  vigenciasDaUnidade,
  vigenciasQueCobrem,
} from "@workspace/comparison/recorte-de-rubrica";
import { avisoDoParImpossivel } from "@/lib/par-de-vigencias";
import { CartoesDeVelocidade } from "@/components/velocidade-media/cartoes";
import {
  AlteracoesPorVariavel,
  ConferenciaDaVelocidade,
  DistribuicaoPorEstado,
  ParticaoDoCiclo,
  TempoPagoContraPraticado,
} from "@/components/velocidade-media/graficos";
import { TabelaDeVelocidade } from "@/components/velocidade-media/tabela";
import { JustificarDialog } from "@/components/justificativas/justificar-dialog";
import { useJustificarNaTabela } from "@/lib/justificar-na-tabela";
import { DetalheDoTrecho } from "@/components/velocidade-media/detalhe";
import { fetchJson, salvarArquivo } from "@/lib/api";
import { csvComoBlob, paraNomeDeArquivo } from "@/lib/csv";
import { formatNumber } from "@/lib/format";
import {
  ABAS_DE_ESTADO,
  FILTROS_VAZIOS,
  contagemPorAba,
  filtrar,
  linhasDoCsv,
  type ComparacaoDeVelocidade,
  type FiltrosDeVelocidade,
  type TotaisDeVelocidade,
} from "@/lib/velocidade-media";
import { lerRecorte } from "@/lib/recorte";
import { contextoAberto, unidadeDe, useContextosDaCasca } from "@/lib/contextos";
import { cn } from "@/lib/utils";

/**
 * AUDITORIA DE VELOCIDADE MÉDIA — o tempo do ciclo do trecho, aberto.
 *
 * ---------------------------------------------------------------------------
 * O verbete pedia duas coisas, e o grão trecho dá as duas
 * ---------------------------------------------------------------------------
 * Esta rota dizia depender de **distância e tempo na mesma linha** e da
 * **separação entre tempo rodando e tempo parado** — "o ativo esperando carga
 * não abaixa a velocidade de quem dirigiu". As duas existem na tabela de frete, e
 * é isso que torna a tela possível sem uma coluna nova no banco: o ciclo é
 * declarado como deslocamento mais TMA de origem, TMA de destino e refeição, e
 * cada parcela tem coluna própria. Subtraindo as paradas sobra o tempo rodando.
 *
 * **O que continua faltando é o realizado, e é outra coisa.** Estes são o tempo e
 * a distância **contratados**: o que o modelo de remuneração parametriza, não o
 * que um motorista praticou numa quinzena. A tela não afirma a que velocidade
 * alguém dirigiu — afirma a que velocidade o contrato supõe que se dirija. A
 * distinção está no cartão, no rodapé da conferência e na gaveta de cada trecho.
 *
 * ---------------------------------------------------------------------------
 * As duas leituras próprias desta tela
 * ---------------------------------------------------------------------------
 * **A partição do ciclo** responde ao segundo `depende`: quanto do tempo é rodar
 * e quanto é esperar, e em que espera o tempo se vai.
 *
 * **A conferência da velocidade** inverte a identidade que o dicionário publica —
 * "com o km, a velocidade produz o tempo de deslocamento" — e pergunta se o tempo
 * rodando do ciclo devolve a velocidade declarada. Quando não devolve, ou o ciclo
 * foi montado com outro tempo, ou a velocidade declarada não é a que o modelo
 * usou.
 *
 * E há um terceiro painel que o dicionário pede em voz alta: **o tempo pago
 * contra o praticado.** Os pares `…Lucro` existem porque os dois podem divergir,
 * e apagá-los escolhendo um só é o que o próprio dicionário proíbe.
 *
 * **Nenhuma conta mora neste arquivo.** Tudo vem de
 * `@workspace/comparison/velocidade-media`, que o servidor importa igual.
 */
export default function AuditoriaDeVelocidadeMedia() {
  const [base, setBase] = useState("");
  const [comparada, setComparada] = useState("");
  const [filtros, setFiltros] = useState<FiltrosDeVelocidade>(FILTROS_VAZIOS);
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
   * Estar em `TELAS_QUE_HONRAM_ESCOPO` é uma promessa, e o que a cumpre é o
   * recorte abaixo.
   */
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
   * As vigências que o seletor oferece: as da unidade aberta **que cobrem
   * trecho**.
   *
   * O segundo filtro é o mesmo da Auditoria de Km Rodado, e pela mesma razão: no
   * acervo, o arquivo de equipamento e o de trecho chegam em vigências separadas.
   * Sem ele, o par de partida cai na vigência de cavalo mais recente e a tela
   * abre com zero linhas — correta e inexplicável.
   */
  const daUnidade = useMemo(
    () =>
      unidadeResolvida
        ? vigenciasQueCobrem(
            vigenciasDaUnidade(vigencias.data ?? [], escopoAberto),
            TIPO_DA_VELOCIDADE,
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
  /** Nenhuma vigência de trecho na unidade — outra frase, outra causa. */
  const semTrechoNaUnidade = semPar?.motivo === "LISTA_VAZIA";

  const comparacao = useQuery({
    queryKey: ["velocidade-media", "comparacao", base, comparada, comSemAlteracao],
    enabled: Boolean(base && comparada),
    queryFn: () =>
      fetchJson<ComparacaoDeVelocidade>(
        `/velocidade-media/comparacao?base=${base}&comparada=${comparada}` +
          (comSemAlteracao ? "&semAlteracao=true" : ""),
      ),
  });

  const totais = useQuery({
    queryKey: ["velocidade-media", "totais", base, comparada],
    enabled: Boolean(base && comparada),
    queryFn: () =>
      fetchJson<TotaisDeVelocidade>(
        `/velocidade-media/totais?base=${base}&comparada=${comparada}`,
      ),
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
      `velocidade-media-${paraNomeDeArquivo(rotuloBase)}-para-${paraNomeDeArquivo(
        rotuloComparada,
      )}.csv`,
    );
  }

  const versaoLucro = comparacao.data?.resumo.impacto.versaoLucroAlterada ?? 0;

  return (
    <Layout>
      <CabecalhoDePagina
        titulo={
          <span className="flex flex-wrap items-center gap-2.5">
            Auditoria de Velocidade Média
            <span className="rounded-full border border-brand/25 bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
              Comparação entre vigências · por trecho
            </span>
          </span>
        }
        icone={Gauge}
        descricao="Quanto do ciclo de cada trecho é rodar e quanto é esperar — e se a velocidade que o trecho declara é a que o ciclo dele produz."
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
            idPrefixo="velocidade-media"
          />
        )}

        {semParPossivel && (
          <EstadoVazio
            icone={Gauge}
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
                  ? "O tempo de ciclo é do trecho, e a tabela de frete desta unidade ainda não chegou ao acervo. As vigências de cavalo e carreta que ela tem alimentam as telas de custo fixo, não esta."
                  : "A comparação de velocidade precisa de duas vigências de trecho da mesma unidade. Escolha outra unidade na lateral ou importe a tabela de frete seguinte."
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
            what="a comparação de velocidade média"
            onTentarDeNovo={() => void comparacao.refetch()}
            tentando={comparacao.isFetching}
          />
        )}

        {comparacao.data && (
          <>
            <CartoesDeVelocidade resumo={comparacao.data.resumo} />

            {comparacao.data.resumo.impacto.foraDaSoma > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatNumber(comparacao.data.resumo.impacto.foraDaSoma, 0)}{" "}
                {comparacao.data.resumo.impacto.foraDaSoma === 1
                  ? "alteração ficou"
                  : "alterações ficaram"}{" "}
                fora de toda soma: o ciclo já contém as parcelas que o compõem, as colunas da
                versão lucro são o mesmo minuto medido na régua da remuneração, e as projeções
                de dia e mês são o ciclo multiplicado por uma frequência esperada.
              </p>
            )}

            {/*
              A conferência e a partição vêm em largura inteira, logo abaixo dos
              indicadores, por serem as leituras próprias desta tela — as únicas
              que nenhuma outra do produto faz. A partição vem primeiro porque é
              ela que responde ao verbete; a conferência, logo em seguida, é o que
              diz se dá para confiar na partição.
            */}
            <div className="grid gap-3 lg:grid-cols-2">
              <ParticaoDoCiclo
                particao={totais.data?.particao ?? []}
                rotuloBase={rotuloBase}
                rotuloComparada={rotuloComparada}
              />
              <TempoPagoContraPraticado
                tempoPago={totais.data?.tempoPago ?? []}
                rotuloBase={rotuloBase}
                rotuloComparada={rotuloComparada}
              />
            </div>

            <ConferenciaDaVelocidade
              velocidade={totais.data?.velocidade ?? []}
              rotuloBase={rotuloBase}
              rotuloComparada={rotuloComparada}
            />

            <div className="grid gap-3 lg:grid-cols-2">
              <AlteracoesPorVariavel dados={comparacao.data.alteracoesPorVariavel} />
              <DistribuicaoPorEstado dados={comparacao.data.distribuicaoPorEstado} />
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
                  id="velocidade-media-busca"
                  value={filtros.busca}
                  onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
                  placeholder="Buscar trecho ou variável…"
                  aria-label="Buscar trecho ou variável"
                  className="pl-9"
                />
              </div>

              {/*
                O filtro de papel é o que separa a pergunta desta tela em partes
                legíveis: ver só o tempo parado é a fila de trabalho de quem
                negocia TMA, e ver só a velocidade é a de quem parametriza o
                trecho.
              */}
              <Select
                value={filtros.papel}
                onValueChange={(papel) =>
                  setFiltros((f) => ({ ...f, papel: papel as FiltrosDeVelocidade["papel"] }))
                }
              >
                <SelectTrigger className="w-[13rem]" aria-label="O que a variável mede">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">Tudo o que o ciclo tem</SelectItem>
                  <SelectItem value="VELOCIDADE">Velocidade</SelectItem>
                  <SelectItem value="TEMPO_TOTAL">Tempo de ciclo</SelectItem>
                  <SelectItem value="TEMPO_RODANDO">Tempo rodando</SelectItem>
                  <SelectItem value="TEMPO_PARADO">Tempo parado</SelectItem>
                  <SelectItem value="DISTANCIA">Distância</SelectItem>
                  <SelectItem value="FATOR">Fator motorista</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filtros.variavel}
                onValueChange={(variavel) => setFiltros((f) => ({ ...f, variavel }))}
              >
                <SelectTrigger className="w-[17rem]" aria-label="Variável de velocidade">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODAS">Todas as variáveis</SelectItem>
                  {[...VARIAVEIS_DE_VELOCIDADE, ...VARIAVEIS_DE_DETALHE_DE_VELOCIDADE].map(
                    (v) => (
                      <SelectItem key={v.chave} value={v.chave}>
                        {v.rotulo}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>

              <label
                htmlFor="velocidade-media-so-lucro"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="velocidade-media-so-lucro"
                  checked={filtros.soVersaoLucro}
                  onCheckedChange={(soVersaoLucro) =>
                    setFiltros((f) => ({ ...f, soVersaoLucro }))
                  }
                />
                Só o tempo que remunera
                {versaoLucro > 0 && (
                  <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">
                    {formatNumber(versaoLucro, 0)}
                  </span>
                )}
              </label>

              <label
                htmlFor="velocidade-media-sem-alteracao"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="velocidade-media-sem-alteracao"
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
                  icone={Gauge}
                  titulo="Nenhum tempo e nenhuma velocidade mudaram entre as duas vigências"
                  descricao={`${formatNumber(
                    comparacao.data.resumo.trechosComparados,
                    0,
                  )} trechos comparados, e o ciclo de todos eles chegou igual nas duas tabelas. A partição do ciclo e a conferência da velocidade, acima, continuam valendo — elas não olham o que mudou, olham se cada trecho fecha as próprias contas.`}
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
                <TabelaDeVelocidade
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
              linhas={linhas as LinhaDeVelocidade[]}
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
