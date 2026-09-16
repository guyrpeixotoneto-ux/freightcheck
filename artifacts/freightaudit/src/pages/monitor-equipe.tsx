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
import { AbasDoMonitorDeEquipe } from "@/components/monitor-equipe/abas";
import { CartoesDoMonitorDeEquipe } from "@/components/monitor-equipe/cartoes";
import { AlteracoesPorModuloDeEquipe } from "@/components/monitor-equipe/por-modulo";
import { TabelaDoMonitorDeEquipe } from "@/components/monitor-equipe/tabela";
import { DetalheDaAlteracaoDeEquipe } from "@/components/monitor-equipe/detalhe";
import { FiltrosDoMonitorDeEquipeGlobais } from "@/components/monitor-equipe/filtros";
import { useCandidatosDoPar, useTextoAdiado } from "@/hooks/use-candidatos-do-par";
import { fetchJson } from "@/lib/api";
import { lerRecorte } from "@/lib/recorte";
import {
  ORDENACAO_PADRAO,
  enderecoDaOrigem,
  escreverFiltros,
  escreverRecorteDoMenuDeEquipe,
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
 * Duas abas, porque são duas séries
 * ---------------------------------------------------------------------------
 * O administrativo e o operacional são séries próprias dentro da mesma família:
 * o motor recusa um par entre coberturas diferentes, cada um tem o par dele e
 * catálogos de coluna que nem se parecem. Lidos juntos, os cartões do topo
 * somariam duas populações num total que nenhuma das duas telas publica, e cada
 * linha da tabela precisaria da coluna "Quadro" para dizer de quem ela fala.
 *
 * Então a tela abre **uma população de cada vez**, na mesma aba que o QLP já
 * usa, e cada aba carrega o seletor de par dela, os cartões dela e a tabela
 * dela. A aba não é um segundo estado: ela é o filtro `?quadro=` que a tela já
 * tinha, agora com uma escolha de cada vez — um link mandado continua abrindo
 * na população de quem mandou. O quadro sem par abre dizendo por quê, em vez de
 * abrir vazio.
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
    A aba aberta é a população que o endereço pede — e o endereço já tinha onde
    dizê-la: `?quadro=`, o filtro por quadro do Monitor. A aba não cria um
    segundo estado para a mesma pergunta; ela restringe aquele filtro a uma
    escolha de cada vez.

    Sem quadro no endereço, abre o operacional — que é a população maior e a que
    quase sempre se move. A exceção é quando só o administrativo tem vigência
    importada: abrir na aba que não tem o que mostrar faria a tela parecer vazia
    quando o que falta é só a outra importação.
  */
  const abaPadrao: QuadroDeQlp =
    porQuadro.OPERACIONAL.length === 0 && porQuadro.ADMINISTRATIVO.length > 0
      ? "ADMINISTRATIVO"
      : "OPERACIONAL";
  const aba: QuadroDeQlp = filtros.quadros[0] ?? abaPadrao;

  /*
    O que vai para o servidor é sempre **uma** população: enquanto o endereço não
    traz `quadro=`, a consulta já pede a da aba aberta. Pedir as duas e escolher
    uma depois publicaria, por um instante, cartões somando o operacional com o
    administrativo — o total que nenhuma das duas telas tem.
  */
  const filtrosDaAba = useMemo(
    () => ({ ...filtros, quadros: [aba] }),
    [filtros, aba],
  );

  const parDaAba =
    aba === "OPERACIONAL"
      ? { base: filtros.baseOperacional, comparada: filtros.comparadaOperacional }
      : { base: filtros.baseAdministrativo, comparada: filtros.comparadaAdministrativo };

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
    /*
      E a aba aberta desce para o endereço, para que o link mandado carregue a
      população que quem mandou estava lendo — e não a que o próximo leitor
      abriria por padrão.
    */
    if (filtros.quadros.length !== 1 || filtros.quadros[0] !== aba) {
      proximos.quadros = [aba];
      mudou = true;
    }
    if (mudou) aplicar(proximos);
  }, [vigencias.data, porQuadro, filtros, aba]);

  const consulta = useQuery({
    queryKey: ["monitor-equipe", filtrosDaAba, recorte.scopeHash, recorte.canal],
    enabled: parDaAba.base !== "" && parDaAba.comparada !== "",
    queryFn: () => {
      const q = new URLSearchParams(escreverFiltros(filtrosDaAba));
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
  useEffect(() => setPagina(1), [filtrosDaAba, ordem]);

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
        descricao="Acompanhe todas as alterações do quadro de pessoal, um quadro de cada vez."
        atualizando={consulta.isFetching}
      />

      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 pb-10 sm:px-8">
        <AbasDoMonitorDeEquipe
          aba={aba}
          onTrocar={(quadro) => aplicar({ ...filtros, quadros: [quadro] })}
        />

        <Superficie className="flex flex-col gap-4 px-4 py-4">
          {/*
            O seletor é o da aba aberta, e só dele: o par do outro quadro
            continua no endereço, intacto, e volta a aparecer quando a aba dele
            for aberta. Mostrar os dois aqui obrigaria a ler qual das duas caixas
            manda na tabela logo abaixo.
          */}
          <SeletorDoQuadro
            quadro={aba}
            vigencias={porQuadro[aba]}
            filtros={filtros}
            aplicar={aplicar}
            carregando={vigencias.isLoading}
            escopo={recorte.scopeHash}
          />

          <FiltrosDoMonitorDeEquipeGlobais
            filtros={filtrosDaAba}
            modulos={modulos}
            onMudar={aplicar}
            ignorados={consulta.data?.ignorados ?? []}
          />
        </Superficie>

        {!consulta.isLoading &&
          !vigencias.isLoading &&
          !vigencias.error &&
          (parDaAba.base === "" || parDaAba.comparada === "") && (
            <Superficie className="px-4 py-8">
              <EstadoVazio
                icone={SearchX}
                titulo={`O ${ROTULO_DO_QUADRO[aba]} não tem par nesta leitura`}
                descricao={
                  porQuadro[aba].length === 0
                    ? "Nenhuma vigência deste quadro foi importada ainda — ele entra na leitura quando a primeira chegar. A outra aba continua disponível."
                    : "Escolha as duas vigências deste quadro acima para comparar. A outra aba continua disponível."
                }
              />
            </Superficie>
          )}

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
            <CartoesDoMonitorDeEquipe resumo={consulta.data.resumo} quadro={aba} />

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
                  descricao="O par escolhido para este quadro não tem alteração de quadro de pessoal que atenda aos filtros aplicados. Afrouxar o filtro de módulo ou de situação costuma ser o caminho — e um recorte vazio também é uma resposta: pode não ter havido mudança."
                />
              ) : (
                <>
                  {/*
                    Sem a coluna "Quadro": dentro da aba ela repetiria a mesma
                    palavra em todas as linhas, e a repetição é ruído onde o que
                    se procura é o cargo.
                  */}
                  <TabelaDoMonitorDeEquipe
                    linhas={daPagina}
                    mostrarQuadro={false}
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
 * ---------------------------------------------------------------------------
 * A coluna do menu conta alterações, e **não escreve dinheiro**
 * ---------------------------------------------------------------------------
 * É o mesmo seletor das outras oito telas, com a mesma coluna à direita de cada
 * vigência: ela é o que faz escolher, e sem ela esta tela era a única do produto
 * em que o menu abria mudo — sete linhas de `agosto/2026 · 1ª quinzena` e nada
 * ao lado, que neste seletor é a forma de dizer *ainda não calculei*.
 *
 * O que ela **não** tem é o `R$ 0,00` que a ausência da coluna existia para
 * evitar: `/monitor-equipe/candidatos` devolve `semImpacto` com a frase do
 * travamento, e a linha sai com a contagem sozinha. A recusa de somar reais no
 * QLP continua inteira — o que mudou é que agora ela é dita, em vez de ser
 * cumprida pelo silêncio de uma coluna que não existia.
 *
 * O recorte da tela vai junto na pergunta: o número do menu é o número que o
 * clique entrega, e não a contagem de um quadro que ninguém está lendo.
 */
function SeletorDoQuadro({
  quadro,
  vigencias,
  filtros,
  aplicar,
  carregando,
  escopo,
}: {
  quadro: QuadroDeQlp;
  vigencias: VigenciaEscolhivel[];
  filtros: FiltrosDoMonitorDeEquipe;
  aplicar: (proximos: FiltrosDoMonitorDeEquipe) => void;
  carregando: boolean;
  /** A unidade aberta na lateral — trocar de unidade é pergunta nova. */
  escopo: string | null;
}) {
  const chaveBase = quadro === "OPERACIONAL" ? "baseOperacional" : "baseAdministrativo";
  const chaveComparada =
    quadro === "OPERACIONAL" ? "comparadaOperacional" : "comparadaAdministrativo";
  const rotulos = rotulosDasVigencias(vigencias);

  /*
    A busca chega adiada: ela escreve no endereço a cada tecla, e o recorte vai
    na chave da consulta. Sem a espera, "gerente" dispararia sete rodadas, e as
    seis primeiras são perguntas que ninguém queria fazer. Enquanto o texto está
    em trânsito o menu mostra esqueleto, e não os números do recorte anterior —
    eles não estariam desatualizados, estariam respondendo outra pergunta.
  */
  const busca = useTextoAdiado(filtros.busca);
  const candidatos = useCandidatosDoPar(
    "monitor-equipe",
    filtros[chaveComparada],
    escopo,
    escreverRecorteDoMenuDeEquipe(filtros, quadro, busca.valor),
  );

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Vigências comparadas
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
          candidatos={busca.emTransito ? undefined : candidatos.data}
          carregandoCandidatos={busca.emTransito || candidatos.isFetching}
          erroDosCandidatos={
            candidatos.error instanceof Error ? candidatos.error.message : null
          }
        />
      )}
    </div>
  );
}
