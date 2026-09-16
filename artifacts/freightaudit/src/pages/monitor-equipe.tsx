import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SearchX, Users } from "lucide-react";
import type {
  LinhaDoMonitorDeEquipe,
  QuadroDeQlp,
  ResumoDoMonitorDeEquipe,
} from "@workspace/comparison/monitor-equipe";
import { ROTULO_DO_QUADRO } from "@workspace/comparison/monitor-equipe";
import { TIPO_DO_QUADRO } from "@workspace/comparison/qlp";
import {
  parReconciliado,
  rotulosDasVigencias,
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
import { CartoesDoMonitorDeEquipe } from "@/components/monitor-equipe/cartoes";
import { AlteracoesPorModuloDeEquipe } from "@/components/monitor-equipe/por-modulo";
import { TabelaDoMonitorDeEquipe } from "@/components/monitor-equipe/tabela";
import { DetalheDaAlteracaoDeEquipe } from "@/components/monitor-equipe/detalhe";
import { FiltrosDoMonitorDeEquipeGlobais } from "@/components/monitor-equipe/filtros";
import { fetchJson } from "@/lib/api";
import { lerRecorte } from "@/lib/recorte";
import {
  ORDENACAO_PADRAO,
  enderecoDaOrigem,
  escreverFiltros,
  lerFiltros,
  ordenar,
  paginar,
  type ColunaOrdenavel,
  type FiltrosDoMonitorDeEquipe,
  type Ordenacao,
} from "@/lib/monitor-equipe";

/**
 * MONITOR EQUIPE — o que mudou hoje no quadro de pessoal inteiro.
 *
 * ---------------------------------------------------------------------------
 * O que esta tela é, e o que ela não substitui
 * ---------------------------------------------------------------------------
 * Ela é a **primeira leitura do dia** da seção Equipe: os dois quadros e todos
 * os módulos por assunto numa tabela, para que ninguém precise abrir dezesseis
 * telas para saber se algo se moveu. E ela para onde a profundidade começa —
 * quem quiser o cargo inteiro, a rosca de estados, a conferência do benchmark
 * ou a exportação continua indo ao módulo ou ao quadro, que este Monitor não
 * copia e não pretende substituir. Todo caminho daqui para lá é um clique, com
 * o par de vigências junto.
 *
 * É o irmão do Monitor Custo Fixo, e de propósito: mesma forma, mesma fila de
 * prioridade, mesmos cartões, mesmo painel lateral. O que muda é o que a seção
 * Equipe permite dizer.
 *
 * ---------------------------------------------------------------------------
 * Nenhuma conta mora neste arquivo — e, aqui, nenhuma conta de dinheiro existe
 * ---------------------------------------------------------------------------
 * A página escolhe os pares, escreve os filtros no endereço, ordena, pagina e
 * desenha. Os números vêm prontos de `/monitor-equipe/consolidado`, que os
 * pediu à comparação por cargo. E onde o outro Monitor mostra reais, esta tela
 * mostra a frase que diz por que eles não existem: as colunas do QLP chegam sem
 * semântica confirmada, e somar o que a curadoria não confirmou seria
 * adivinhação.
 *
 * ---------------------------------------------------------------------------
 * Dois seletores, porque são duas séries
 * ---------------------------------------------------------------------------
 * O administrativo e o operacional são séries próprias dentro da mesma família:
 * o motor recusa um par entre coberturas diferentes. Um seletor só obrigaria a
 * casar as duas séries por posição — e a casaria em silêncio, na tela cujo
 * trabalho é dizer o que se moveu. Cada quadro escolhe as duas pontas dele, e o
 * quadro que não tem par aparece dizendo por quê.
 */
export default function MonitorEquipe() {
  const search = useSearch();
  const [, navegar] = useLocation();

  const filtros = useMemo(() => lerFiltros(search), [search]);
  const recorte = lerRecorte(search);

  const [ordem, setOrdem] = useState<Ordenacao>(ORDENACAO_PADRAO);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(50);
  const [aberta, setAberta] = useState<LinhaDoMonitorDeEquipe | null>(null);

  /** Mudar de filtro é mudar de endereço — o estado não tem segunda cópia. */
  const aplicar = (proximos: FiltrosDoMonitorDeEquipe) => {
    const query = escreverFiltros(proximos);
    navegar(query === "" ? "/monitor-equipe" : `/monitor-equipe?${query}`, {
      replace: true,
    });
  };

  /*
    A família é pedida ao servidor, e não recortada depois: `/snapshots` responde
    pela de equipamento quando ninguém pede outra, e é o que faria uma quinzena
    de placas entrar na leitura de cargos. A constante é escrita à mão porque
    `@workspace/ingest` carrega o pipeline inteiro, que não tem por que ir para
    o bundle do navegador — a mesma escolha da comparação por cargo.
  */
  const vigencias = useQuery({
    queryKey: ["snapshots", "QUADRO_DE_PESSOAL"],
    queryFn: () =>
      fetchJson<VigenciaEscolhivel[]>("/snapshots?datasetFamily=QUADRO_DE_PESSOAL"),
  });

  /*
    Só as vigências que cobrem **aquele** quadro entram em cada seletor: o motor
    recusa um par entre coberturas diferentes, e um seletor que as oferecesse
    juntas produziria essa recusa depois do clique.
  */
  const porQuadro = useMemo(() => {
    const todas = vigencias.data ?? [];
    return {
      OPERACIONAL: vigenciasQueCobrem(todas, TIPO_DO_QUADRO.OPERACIONAL),
      ADMINISTRATIVO: vigenciasQueCobrem(todas, TIPO_DO_QUADRO.ADMINISTRATIVO),
    } satisfies Record<QuadroDeQlp, VigenciaEscolhivel[]>;
  }, [vigencias.data]);

  /*
    O par de partida de cada quadro — e a guarda que faz o par do endereço
    sobreviver: `/snapshots` chega depois da primeira renderização, e sem ela o
    efeito rodaria contra a lista vazia e limparia as duas pontas de um link que
    as nomeava.
  */
  useEffect(() => {
    if (!vigencias.data) return;
    const proximos = { ...filtros };
    let mudou = false;
    for (const quadro of ["OPERACIONAL", "ADMINISTRATIVO"] as const) {
      const lista = porQuadro[quadro];
      if (lista.length === 0) continue;
      const chaveBase = quadro === "OPERACIONAL" ? "baseOperacional" : "baseAdministrativo";
      const chaveComparada =
        quadro === "OPERACIONAL" ? "comparadaOperacional" : "comparadaAdministrativo";
      const par = parReconciliado(lista, {
        base: filtros[chaveBase],
        comparada: filtros[chaveComparada],
      });
      if (par.base !== filtros[chaveBase] || par.comparada !== filtros[chaveComparada]) {
        proximos[chaveBase] = par.base;
        proximos[chaveComparada] = par.comparada;
        mudou = true;
      }
    }
    if (mudou) aplicar(proximos);
  }, [vigencias.data, porQuadro, filtros]);

  const consulta = useQuery({
    queryKey: ["monitor-equipe", filtros, recorte.scopeHash, recorte.canal],
    enabled:
      (filtros.baseOperacional !== "" && filtros.comparadaOperacional !== "") ||
      (filtros.baseAdministrativo !== "" && filtros.comparadaAdministrativo !== ""),
    queryFn: () => {
      const q = new URLSearchParams(escreverFiltros(filtros));
      if (recorte.scopeHash) q.set("scopeHash", recorte.scopeHash);
      if (recorte.canal) q.set("canal", recorte.canal);
      return fetchJson<{
        changeSets: Record<string, string>;
        resumo: ResumoDoMonitorDeEquipe;
        linhas: LinhaDoMonitorDeEquipe[];
        rotulos: Record<string, string>;
        ignorados: string[];
      }>(`/monitor-equipe/consolidado?${q.toString()}`);
    },
  });

  /* Trocar o recorte recomeça a leitura da primeira página, e não no meio. */
  useEffect(() => setPagina(1), [filtros, ordem]);

  const rotulos = consulta.data?.rotulos ?? {};
  const linhas = consulta.data?.linhas ?? [];
  const ordenadas = useMemo(
    () => ordenar(linhas, ordem, rotulos),
    [linhas, ordem, rotulos],
  );
  const daPagina = useMemo(
    () => paginar(ordenadas, pagina, porPagina),
    [ordenadas, pagina, porPagina],
  );

  /** Os módulos que **este** recorte devolveu. A tela não os inventa. */
  const modulos = useMemo(
    () => (consulta.data?.resumo.porModulo ?? []).map((m) => m.modulo),
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
        titulo="Monitor Equipe"
        icone={Users}
        descricao="Acompanhe todas as alterações do quadro de pessoal, nos dois quadros."
        atualizando={consulta.isFetching}
      />

      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 pb-10 sm:px-8">
        <Superficie className="flex flex-col gap-4 px-4 py-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {(["OPERACIONAL", "ADMINISTRATIVO"] as const).map((quadro) => (
              <SeletorDoQuadro
                key={quadro}
                quadro={quadro}
                vigencias={porQuadro[quadro]}
                filtros={filtros}
                aplicar={aplicar}
                carregando={vigencias.isLoading}
              />
            ))}
          </div>

          <FiltrosDoMonitorDeEquipeGlobais
            filtros={filtros}
            modulos={modulos}
            onMudar={aplicar}
            ignorados={consulta.data?.ignorados ?? []}
          />
        </Superficie>

        {vigencias.error && (
          <ApiErrorNotice
            error={vigencias.error}
            what="As vigências do quadro não puderam ser carregadas."
          />
        )}

        {consulta.isLoading && (
          <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
            <span className="sr-only">Carregando o consolidado do quadro de pessoal…</span>
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
            what="o consolidado do quadro de pessoal"
            onTentarDeNovo={() => void consulta.refetch()}
            tentando={consulta.isFetching}
          />
        )}

        {consulta.data && (
          <>
            <CartoesDoMonitorDeEquipe resumo={consulta.data.resumo} />

            <AlteracoesPorModuloDeEquipe
              resumos={consulta.data.resumo.porModulo}
              moduloAberto={filtros.modulos.length === 1 ? filtros.modulos[0]! : null}
              onFiltrar={(modulo) =>
                aplicar({
                  ...filtros,
                  modulos:
                    filtros.modulos.length === 1 && filtros.modulos[0] === modulo
                      ? []
                      : [modulo],
                })
              }
              enderecoDoModulo={(r) => {
                /*
                  O endereço leva o par **do quadro em que o módulo se moveu**.
                  Um módulo que acendeu só no operacional não pode abrir na aba
                  administrativa: a tela de destino mostraria a aba certa vazia
                  e quem clicou leria "nada mudou".
                */
                const quadro = r.quadros[0] ?? "OPERACIONAL";
                const par = consulta.data.resumo.porQuadro.find(
                  (q) => q.quadro === quadro,
                )?.par;
                if (!par) return `/qlp/${r.modulo}`;
                return enderecoDaOrigem({ modulo: r.modulo, quadro, par }, contexto);
              }}
            />

            <Superficie className="flex flex-col gap-3 px-4 py-4">
              <h2 className="text-sm font-semibold">Todas as alterações</h2>

              {ordenadas.length === 0 ? (
                <EstadoVazio
                  icone={SearchX}
                  titulo="Nenhuma alteração neste recorte"
                  descricao="Os pares escolhidos não têm alteração de quadro de pessoal que atenda aos filtros aplicados. Afrouxar o filtro de módulo ou de situação costuma ser o caminho — e um recorte vazio também é uma resposta: pode não ter havido mudança."
                />
              ) : (
                <>
                  <TabelaDoMonitorDeEquipe
                    linhas={daPagina}
                    rotulos={rotulos}
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

      <DetalheDaAlteracaoDeEquipe
        linha={aberta}
        rotulos={rotulos}
        enderecoDaOrigem={(l) => enderecoDaOrigem(l, contexto)}
        onFechar={() => setAberta(null)}
      />
    </Layout>
  );
}

/**
 * O seletor de um quadro — o par daquela série, e só dela.
 *
 * Sem coluna de números ao lado de cada vigência, e a ausência é deliberada:
 * aquela coluna escreve dinheiro, e a resposta dela para um par sem movimento é
 * `R$ 0,00`. Numa tela que recusa somar reais no QLP, um `R$ 0,00` ao lado de
 * cada vigência seria a porta dos fundos por onde o número que a seção não tem
 * entraria — dito, ainda por cima, onde não cabe a ressalva.
 */
function SeletorDoQuadro({
  quadro,
  vigencias,
  filtros,
  aplicar,
  carregando,
}: {
  quadro: QuadroDeQlp;
  vigencias: VigenciaEscolhivel[];
  filtros: FiltrosDoMonitorDeEquipe;
  aplicar: (proximos: FiltrosDoMonitorDeEquipe) => void;
  carregando: boolean;
}) {
  const chaveBase = quadro === "OPERACIONAL" ? "baseOperacional" : "baseAdministrativo";
  const chaveComparada =
    quadro === "OPERACIONAL" ? "comparadaOperacional" : "comparadaAdministrativo";
  const rotulos = rotulosDasVigencias(vigencias);

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {ROTULO_DO_QUADRO[quadro]}
      </h2>
      {vigencias.length === 0 && !carregando ? (
        <p className="text-xs text-muted-foreground">
          Nenhuma vigência deste quadro foi importada ainda — ele entra na leitura
          quando a primeira chegar.
        </p>
      ) : (
        <SeletorDoPar
          vigencias={vigencias}
          rotulos={rotulos}
          base={filtros[chaveBase]}
          comparada={filtros[chaveComparada]}
          onBase={(base) => aplicar({ ...filtros, [chaveBase]: base })}
          onComparada={(comparada) => aplicar({ ...filtros, [chaveComparada]: comparada })}
          onInverter={() =>
            aplicar({
              ...filtros,
              [chaveBase]: filtros[chaveComparada],
              [chaveComparada]: filtros[chaveBase],
            })
          }
          carregando={carregando}
          idPrefixo={`monitor-equipe-${quadro.toLowerCase()}`}
        />
      )}
    </div>
  );
}
