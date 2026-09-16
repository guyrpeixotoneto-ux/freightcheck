import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { LineChart, SearchX } from "lucide-react";
import type { LinhaDoMonitor, ResumoDoMonitor } from "@workspace/comparison/monitor-custo-fixo";
import {
  motivoSemPar,
  parReconciliado,
  rotulosDasVigencias,
  TIPOS_DE_EQUIPAMENTO,
  vigenciasDaUnidade,
  vigenciasQueCobrem,
} from "@workspace/comparison/recorte-de-rubrica";
import { Layout } from "@/components/layout/layout";
import { CabecalhoDePagina } from "@/components/layout/cabecalho-de-pagina";
import { ApiErrorNotice } from "@/components/api-error";
import { Skeleton } from "@/components/ui/skeleton";
import { Superficie } from "@/components/ui/superficie";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Paginacao } from "@/components/ui/paginacao";
import { SeletorDoPar, type VigenciaEscolhivel } from "@/components/comparacao/seletor-do-par";
import { CartoesDoMonitor } from "@/components/monitor/cartoes";
import { AlteracoesPorModulo } from "@/components/monitor/por-modulo";
import { TabelaDoMonitor } from "@/components/monitor/tabela";
import { DetalheDaAlteracao } from "@/components/monitor/detalhe";
import { FiltrosDoMonitorGlobais } from "@/components/monitor/filtros";
import { fetchJson } from "@/lib/api";
import { useCandidatosDoPar, useTextoAdiado } from "@/hooks/use-candidatos-do-par";
import { avisoDoParImpossivel } from "@/lib/par-de-vigencias";
import { lerRecorte } from "@/lib/recorte";
import { contextoAberto, unidadeDe, useContextosDaCasca } from "@/lib/contextos";
import {
  enderecoDaAuditoria,
  escreverFiltros,
  escreverRecorte,
  lerFiltros,
  ordenar,
  paginar,
  ORDENACAO_PADRAO,
  type ColunaOrdenavel,
  type Ordenacao,
} from "@/lib/monitor-custo-fixo";

/**
 * MONITOR CUSTO FIXO — o que mudou hoje no custo fixo inteiro.
 *
 * ---------------------------------------------------------------------------
 * O que esta tela é, e o que ela não substitui
 * ---------------------------------------------------------------------------
 * Ela é a **primeira leitura do dia**: quatro rubricas numa tabela, para que
 * ninguém precise abrir quatro telas para saber se algo se moveu. E ela para
 * onde a profundidade começa — quem quiser o catálogo do financiamento, a
 * conferência de alíquotas ou a virada de ciclo continua indo à auditoria do
 * módulo, que este Monitor não copia e não pretende substituir. Todo caminho
 * daqui para lá é um clique, com o par de vigências junto.
 *
 * ---------------------------------------------------------------------------
 * Nenhuma conta mora neste arquivo
 * ---------------------------------------------------------------------------
 * Nem soma, nem subtração, nem conversão de periodicidade, nem derivação de
 * impacto a partir do valor anterior e do atual. O que a página faz é escolher
 * o par, escrever os filtros no endereço, ordenar, paginar e desenhar. Os
 * números vêm prontos de `/monitor-custo-fixo/consolidado`, que por sua vez os
 * pediu às quatro auditorias — ver o cabeçalho de
 * `lib/comparison/src/monitor-custo-fixo.ts`.
 *
 * Isso tem uma consequência visível e deliberada: **filtrar refaz a consulta**.
 * Recortar no navegador seria mais rápido e obrigaria a tela a recompor os
 * cartões sozinha — que é exatamente a segunda régua que este produto recusa.
 *
 * ---------------------------------------------------------------------------
 * O estado vive no endereço
 * ---------------------------------------------------------------------------
 * Porque o caminho normal é *ver → abrir a auditoria → voltar*, e com o estado
 * só na memória o "voltar" devolvia a tela zerada. No endereço, ele devolve o
 * que se estava lendo — e o endereço ainda vira link para outra pessoa.
 */
export default function MonitorCustoFixo() {
  const search = useSearch();
  const [, navegar] = useLocation();

  const filtros = useMemo(() => lerFiltros(search), [search]);
  const recorte = lerRecorte(search);

  const [ordem, setOrdem] = useState<Ordenacao>(ORDENACAO_PADRAO);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(50);
  const [aberta, setAberta] = useState<LinhaDoMonitor | null>(null);

  /** Mudar de filtro é mudar de endereço — o estado não tem segunda cópia. */
  const aplicar = (proximos: typeof filtros) => {
    const query = escreverFiltros(proximos);
    navegar(query === "" ? "/monitor-custo-fixo" : `/monitor-custo-fixo?${query}`, {
      replace: true,
    });
  };

  const vigencias = useQuery({
    queryKey: ["snapshots"],
    queryFn: () => fetchJson<VigenciaEscolhivel[]>("/snapshots"),
  });

  /*
    A unidade aberta, lida como as quatro auditorias a leem: o `scopeHash` do
    endereço quando há um, e o contexto que a lateral nomeia quando não há.
    Sem isso, o par de partida poderia casar duas unidades diferentes — o único
    par que o motor recusa por construção.
  */
  const { contextos, carregando: contextosCarregando } = useContextosDaCasca();
  const nomePorEscopo = useMemo(() => {
    const nomes = new Map<string, string>();
    for (const c of contextos) nomes.set(c.scopeHash, unidadeDe(c));
    return nomes;
  }, [contextos]);
  const escopoAberto = contextoAberto(contextos, recorte.scopeHash)?.scopeHash ?? null;
  const unidadeResolvida = recorte.scopeHash !== null || !contextosCarregando;

  /**
   * As vigências que o seletor oferece: as da unidade aberta que cobrem
   * equipamento.
   *
   * O segundo filtro não é refinamento. Os quatro módulos leem placa, e o
   * acervo entrega o arquivo de trecho como vigência separada — oferecer uma
   * ponta de trecho aqui seria oferecer a recusa do motor em tela.
   */
  const daUnidade = useMemo(
    () =>
      unidadeResolvida
        ? vigenciasQueCobrem(
            vigenciasDaUnidade(vigencias.data ?? [], escopoAberto),
            TIPOS_DE_EQUIPAMENTO,
          )
        : [],
    [vigencias.data, escopoAberto, unidadeResolvida],
  );

  const rotulos = useMemo(
    () => rotulosDasVigencias(daUnidade, (hash) => nomePorEscopo.get(hash) ?? null),
    [daUnidade, nomePorEscopo],
  );

  /*
    O par aberto, mantido dentro da unidade aberta — a mesma regra das quatro
    auditorias: o que está na lista fica, o que não está é substituído pelo par
    de partida, e escolha de quem escolheu nunca é desfeita.
  */
  useEffect(() => {
    if (!vigencias.data || !unidadeResolvida) return;
    const par = parReconciliado(daUnidade, {
      base: filtros.base,
      comparada: filtros.comparada,
    });
    if (par.base !== filtros.base || par.comparada !== filtros.comparada) {
      aplicar({ ...filtros, base: par.base, comparada: par.comparada });
    }
  }, [vigencias.data, daUnidade, unidadeResolvida, filtros.base, filtros.comparada]);

  /**
   * Os números de cada candidata a "De", contra o "Para" aberto — **sob os
   * filtros que estão ligados**.
   *
   * A coluna existe nas quatro auditorias desde sempre, e faltava justamente na
   * tela que consolida as quatro: aqui o menu oferecia dez vigências mudas, e
   * um recorte que devolve zero não tinha como dizer qual outro par teria
   * devolvido alguma coisa. Era escolher às cegas na única tela cujo trabalho é
   * dizer o que se moveu.
   *
   * O recorte vai junto (`escreverRecorte`) porque a pergunta do menu é a
   * pergunta da tela: com "IPVA" e "Aumentos" ligados, o número ao lado de cada
   * vigência é o que aquele par mostraria **com eles ligados**. Sem isso, o
   * menu prometeria um número que o clique não entrega — a mesma contradição
   * entre cartão e tabela que esta tela evita pedindo o recorte ao servidor em
   * vez de recortar no navegador.
   */
  /*
    Só a busca é adiada, e só ela precisa: módulo, equipamento, situação e
    periodicidade são um clique cada, e adiar um clique seria piscar esqueleto
    onde não havia hesitação nenhuma. A busca é a única que chega tecla a tecla.
  */
  const busca = useTextoAdiado(filtros.busca);
  const candidatos = useCandidatosDoPar(
    "monitor-custo-fixo",
    filtros.comparada,
    escopoAberto,
    escreverRecorte({ ...filtros, busca: busca.valor }),
  );

  const semPar = useMemo(() => motivoSemPar(daUnidade), [daUnidade]);
  const aviso = semPar ? avisoDoParImpossivel(semPar) : null;

  const consulta = useQuery({
    queryKey: ["monitor-custo-fixo", filtros, recorte.scopeHash, recorte.canal],
    enabled: filtros.base !== "" && filtros.comparada !== "",
    queryFn: () => {
      const q = new URLSearchParams(escreverFiltros(filtros));
      if (recorte.scopeHash) q.set("scopeHash", recorte.scopeHash);
      if (recorte.canal) q.set("canal", recorte.canal);
      return fetchJson<{
        changeSetId: string;
        resumo: ResumoDoMonitor;
        linhas: LinhaDoMonitor[];
        ignorados: string[];
      }>(`/monitor-custo-fixo/consolidado?${q.toString()}`);
    },
  });

  /* Trocar o recorte recomeça a leitura da primeira página, e não no meio. */
  useEffect(() => setPagina(1), [filtros, ordem]);

  const linhas = consulta.data?.linhas ?? [];
  const ordenadas = useMemo(() => ordenar(linhas, ordem), [linhas, ordem]);
  const daPagina = useMemo(
    () => paginar(ordenadas, pagina, porPagina),
    [ordenadas, pagina, porPagina],
  );

  /** As periodicidades que **este** recorte devolveu. A tela não as inventa. */
  const periodicidades = useMemo(
    () => (consulta.data?.resumo.baldes ?? []).map((b) => b.periodicidade),
    [consulta.data],
  );

  const contexto = { scopeHash: recorte.scopeHash, canal: recorte.canal };
  const ordenarPor = (coluna: ColunaOrdenavel) =>
    setOrdem((atual) =>
      atual.coluna === coluna
        ? { coluna, ascendente: !atual.ascendente }
        : { coluna, ascendente: false },
    );

  return (
    <Layout>
      <CabecalhoDePagina
        titulo="Monitor Custo Fixo"
        icone={LineChart}
        descricao="Acompanhe todas as alterações nos custos fixos da operação."
        atualizando={consulta.isFetching}
      />

      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 pb-10 sm:px-8">
        <Superficie className="flex flex-col gap-4 px-4 py-4">
          <SeletorDoPar
            vigencias={daUnidade}
            rotulos={rotulos}
            base={filtros.base}
            comparada={filtros.comparada}
            onBase={(base) => aplicar({ ...filtros, base })}
            onComparada={(comparada) => aplicar({ ...filtros, comparada })}
            onInverter={() =>
              aplicar({ ...filtros, base: filtros.comparada, comparada: filtros.base })
            }
            /*
              Enquanto a busca não assenta, o menu não mostra número: o que ele
              tem na mão é a resposta do texto anterior, e escrevê-la seria
              responder com um número uma pergunta que já mudou. O esqueleto diz
              "está vindo", que é o que de fato está acontecendo.
            */
            candidatos={busca.emTransito ? undefined : candidatos.data}
            carregandoCandidatos={busca.emTransito || candidatos.isFetching}
            erroDosCandidatos={
              candidatos.error instanceof Error ? candidatos.error.message : null
            }
            carregando={vigencias.isLoading}
            idPrefixo="monitor"
          />

          <FiltrosDoMonitorGlobais
            filtros={filtros}
            periodicidades={periodicidades}
            onMudar={aplicar}
            ignorados={consulta.data?.ignorados ?? []}
          />
        </Superficie>

        {aviso && (
          <EstadoVazio
            icone={SearchX}
            titulo={aviso.titulo}
            descricao={aviso.descricao}
            tom="atencao"
          />
        )}

        {consulta.isLoading && (
          <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
            <span className="sr-only">Carregando o consolidado do custo fixo…</span>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        )}

        {consulta.isError && (
          <ApiErrorNotice
            error={consulta.error}
            what="o consolidado do custo fixo"
            onTentarDeNovo={() => void consulta.refetch()}
            tentando={consulta.isFetching}
          />
        )}

        {consulta.data && (
          <>
            <CartoesDoMonitor resumo={consulta.data.resumo} />

            <AlteracoesPorModulo
              resumos={consulta.data.resumo.porModulo}
              moduloAberto={filtros.modulos.length === 1 ? filtros.modulos[0]! : null}
              onFiltrar={(modulo) =>
                aplicar({
                  ...filtros,
                  modulos: filtros.modulos.length === 1 && filtros.modulos[0] === modulo
                    ? []
                    : [modulo],
                })
              }
              enderecoDaAuditoria={(r) =>
                enderecoDaAuditoria({ modulo: r.modulo, par: r.par }, contexto)
              }
            />

            <Superficie className="flex flex-col gap-3 px-4 py-4">
              <h2 className="text-sm font-semibold">Todas as alterações</h2>

              {ordenadas.length === 0 ? (
                <EstadoVazio
                  icone={SearchX}
                  titulo="Nenhuma alteração neste recorte"
                  descricao="As duas vigências escolhidas não têm alteração de custo fixo que atenda aos filtros aplicados. Afrouxar o filtro de situação ou de módulo costuma ser o caminho — e um recorte vazio também é uma resposta: pode não ter havido mudança."
                />
              ) : (
                <>
                  <TabelaDoMonitor
                    linhas={daPagina}
                    ordem={ordem}
                    onOrdenar={ordenarPor}
                    selecionada={aberta?.id ?? null}
                    onSelecionar={setAberta}
                  />
                  <Paginacao
                    pagina={pagina}
                    porPagina={porPagina}
                    total={ordenadas.length}
                    onPagina={setPagina}
                    onPorPagina={setPorPagina}
                    unidade="alterações"
                    unidadeSingular="alteração"
                  />
                </>
              )}
            </Superficie>
          </>
        )}
      </div>

      <DetalheDaAlteracao
        linha={aberta}
        enderecoDaAuditoria={(l) => enderecoDaAuditoria(l, contexto)}
        onFechar={() => setAberta(null)}
      />
    </Layout>
  );
}
