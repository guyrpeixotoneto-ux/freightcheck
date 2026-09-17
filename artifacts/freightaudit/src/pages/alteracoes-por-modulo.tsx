import { useEffect, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { LayoutGrid } from "lucide-react";
import type { AreaNoCatalogo } from "@workspace/comparison/alteracoes-por-modulo";
import { ROTULO_DA_COBERTURA } from "@workspace/comparison/alteracoes-por-modulo";
import {
  TIPOS_DE_EQUIPAMENTO,
  parReconciliado,
  rotulosDasVigencias,
  vigenciasDaUnidade,
  vigenciasQueCobrem,
} from "@workspace/comparison/recorte-de-rubrica";
import { rotuloDaVigencia } from "@workspace/comparison/labels";
import { TIPO_DO_CONSUMO } from "@workspace/comparison/consumo";
import { TIPO_DO_QUADRO } from "@workspace/comparison/qlp";
import { Layout } from "@/components/layout/layout";
import { CabecalhoDePagina } from "@/components/layout/cabecalho-de-pagina";
import { ApiErrorNotice } from "@/components/api-error";
import { Skeleton } from "@/components/ui/skeleton";
import { Superficie } from "@/components/ui/superficie";
import { SeletorDoPar, type VigenciaEscolhivel } from "@/components/comparacao/seletor-do-par";
import { CatalogoDeAlteracoes } from "@/components/alteracoes-por-modulo/catalogo";
import { SeletorMestre } from "@/components/alteracoes-por-modulo/seletor-mestre";
import { fraseSemPar } from "@/lib/par-de-vigencias";
import { fetchJson } from "@/lib/api";
import { lerRecorte } from "@/lib/recorte";
import { contextoAberto, unidadeDe, useContextosDaCasca } from "@/lib/contextos";
import {
  COBERTURAS,
  enderecoDoCartao,
  escreverPares,
  lerPares,
  type ParesDoCatalogo,
} from "@/lib/alteracoes-por-modulo";
import {
  aplicarMestre,
  datasDoAcervo,
  inverterMestre,
  mestreDePartida,
  mestreDosPares,
  reancorarMestre,
  situacaoDasCoberturas,
  type ParMestre,
} from "@/lib/seletor-mestre";

/**
 * ALTERAÇÕES POR MÓDULO — o catálogo inteiro do produto, numa tela.
 *
 * ---------------------------------------------------------------------------
 * O que esta tela é, e o que ela não substitui
 * ---------------------------------------------------------------------------
 * Ela responde a pergunta que abre a Visão executiva: *das três famílias que
 * este produto audita, quais se moveram desde a última vigência?* Um cartão por
 * módulo de custo fixo, de custo variável e do quadro de pessoal, lado a lado,
 * no formato de cartão que os dois Monitores já publicam.
 *
 * E ela para onde a profundidade começa. Não há tabela, não há filtro e não há
 * painel lateral: quem viu um módulo se mover abre a auditoria dele, que esta
 * tela não copia e não pretende substituir. Todo caminho daqui para lá é um
 * clique, **com o par junto** — ver `enderecoDoCartao`.
 *
 * ---------------------------------------------------------------------------
 * Um seletor à frente de quatro
 * ---------------------------------------------------------------------------
 * O motor recusa um par entre coberturas diferentes, e esta leitura atravessa
 * quatro delas: equipamento, trecho e os dois quadros do QLP. Um seletor **só**
 * ofereceria, numa lista, vigências que não formam par entre si — a recusa do
 * motor chegando depois do clique, que é o defeito que o Monitor Equipe já
 * evitava com uma aba por quadro. Por isso os quatro seletores continuam
 * existindo, e continuam sendo a única coisa que escreve par no endereço.
 *
 * O que eles deixaram de ser é o gesto normal. Empilhados no topo, eles pediam
 * quatro vezes a pergunta que esta tela faz uma vez — *o que mudou desde a
 * última vigência?* — e, por `parDePartida` rodar uma vez por lista, abriam em
 * quatro pares **diferentes**, sem nada em tela dizendo por que diferem. No
 * celular isso empurrava o primeiro cartão do catálogo para fora da primeira
 * tela, que é o conteúdo.
 *
 * Em cima fica o par mestre (`lib/seletor-mestre.ts`): uma escolha só, aplicada
 * a toda cobertura que a aceita — casada por **data**, porque equipamento e
 * trecho vêm de `/snapshots` e os dois quadros de outra consulta, com outros
 * ids nas mesmas quinzenas. A cobertura que não forma o par do mestre fica com
 * o par dela e é **nomeada** ali mesmo; os quatro seletores esperam na gaveta
 * "Ajustar por cobertura". E cada cartão continua dizendo no pé contra que par
 * **ele** foi apurado, que é o que torna a divergência legível no catálogo.
 *
 * O mestre não é um quinto estado: ele é lido dos quatro pares e escrito de
 * volta neles. O endereço continua sendo `baseEquipamento`, `comparadaTrecho` e
 * os outros seis, e um link antigo com quatro pares divergentes abre
 * exatamente como abria — com a tela dizendo quais divergem.
 *
 * ---------------------------------------------------------------------------
 * Nenhuma conta mora neste arquivo
 * ---------------------------------------------------------------------------
 * Nem soma, nem conversão de periodicidade, nem derivação de impacto. A página
 * escolhe os pares, escreve-os no endereço e desenha. Os números vêm prontos de
 * `/alteracoes-por-modulo/consolidado`, que por sua vez os pediu às mesmas
 * funções que cada auditoria usa — e, no custo fixo, à **mesma função** que o
 * Monitor chama.
 */
export default function AlteracoesPorModulo() {
  const search = useSearch();
  const [, navegar] = useLocation();

  const pares = useMemo(() => lerPares(search), [search]);
  const recorte = lerRecorte(search);

  /** Mudar de par é mudar de endereço — o estado não tem segunda cópia. */
  const aplicar = (proximos: ParesDoCatalogo) => {
    const query = escreverPares(proximos);
    navegar(
      query === "" ? "/alteracoes-por-modulo" : `/alteracoes-por-modulo?${query}`,
      { replace: true },
    );
  };

  /*
    Duas listas de vigências, porque são duas famílias de dataset: `/snapshots`
    responde pela de equipamento quando ninguém pede outra, e o quadro de pessoal
    é pedido à parte — a mesma leitura que o Monitor Equipe faz, e pela mesma
    razão: uma quinzena de placas não entra na escolha de par de cargos.
  */
  const daFrota = useQuery({
    queryKey: ["snapshots"],
    queryFn: () => fetchJson<VigenciaEscolhivel[]>("/snapshots"),
  });
  const doQuadro = useQuery({
    queryKey: ["snapshots", "QUADRO_DE_PESSOAL"],
    queryFn: () =>
      fetchJson<VigenciaEscolhivel[]>("/snapshots?datasetFamily=QUADRO_DE_PESSOAL"),
  });

  /*
    A unidade aberta, lida como as auditorias a leem: o `scopeHash` do endereço
    quando há um, e o contexto que a lateral nomeia quando não há. Sem isso, um
    par de partida poderia casar duas unidades diferentes — o único par que o
    motor recusa por construção.
  */
  const { contextos, carregando: contextosCarregando } = useContextosDaCasca();
  const nomePorEscopo = useMemo(() => {
    const nomes = new Map<string, string>();
    for (const c of contextos) nomes.set(c.scopeHash, unidadeDe(c));
    return nomes;
  }, [contextos]);
  const escopoAberto = contextoAberto(contextos, recorte.scopeHash)?.scopeHash ?? null;
  const unidadeResolvida = recorte.scopeHash !== null || !contextosCarregando;

  /** As vigências que cada cobertura oferece — e só as dela. */
  const listas = useMemo(() => {
    const frota = unidadeResolvida
      ? vigenciasDaUnidade(daFrota.data ?? [], escopoAberto)
      : [];
    const quadro = doQuadro.data ?? [];
    return {
      EQUIPAMENTO: vigenciasQueCobrem(frota, TIPOS_DE_EQUIPAMENTO),
      TRECHO: vigenciasQueCobrem(frota, TIPO_DO_CONSUMO),
      QLP_OPERACIONAL: vigenciasQueCobrem(quadro, TIPO_DO_QUADRO.OPERACIONAL),
      QLP_ADMINISTRATIVO: vigenciasQueCobrem(quadro, TIPO_DO_QUADRO.ADMINISTRATIVO),
    };
  }, [daFrota.data, doQuadro.data, escopoAberto, unidadeResolvida]);

  const rotulos = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const cobertura of COBERTURAS) {
      for (const [id, texto] of rotulosDasVigencias(
        listas[cobertura],
        (hash) => nomePorEscopo.get(hash) ?? null,
      )) {
        mapa.set(id, texto);
      }
    }
    return mapa;
  }, [listas, nomePorEscopo]);

  /*
    O par de partida de cada cobertura, e a guarda que faz o par do endereço
    sobreviver: as duas listas chegam depois da primeira renderização, e sem ela
    o efeito rodaria contra listas vazias e limparia as pontas de um link que as
    nomeava. É a mesma reconciliação do Monitor Equipe, agora quatro vezes.

    O passo novo é o último, e só acontece para quem chega **sem par nenhum no
    endereço** — pelo menu, por um favorito: as quatro coberturas são alinhadas
    no par que serve a mais delas (`mestreDePartida`). Era exatamente aqui que a
    tela abria em quatro pares diferentes, cada `parDePartida` decidindo sozinho
    contra a lista dele. Quem chega por um link que nomeia par não passa por
    isso: o endereço é a escolha de alguém, e alinhar por cima dela seria
    reescrever o que o link dizia.
  */
  useEffect(() => {
    if (!daFrota.data || !doQuadro.data || !unidadeResolvida) return;
    const doEndereco = COBERTURAS.some((c) => pares[c].base || pares[c].comparada);
    let proximos = { ...pares };
    for (const cobertura of COBERTURAS) {
      const lista = listas[cobertura];
      if (lista.length === 0) continue;
      proximos[cobertura] = parReconciliado(lista, pares[cobertura]);
    }
    if (!doEndereco) proximos = aplicarMestre(mestreDePartida(listas), listas, proximos);
    const mudou = COBERTURAS.some(
      (c) =>
        proximos[c].base !== pares[c].base ||
        proximos[c].comparada !== pares[c].comparada,
    );
    if (mudou) aplicar(proximos);
  }, [daFrota.data, doQuadro.data, unidadeResolvida, listas, search]);

  /*
    O mestre, lido dos quatro pares — e não guardado ao lado deles.

    Ele é derivado de propósito: com uma cópia própria, um link que nomeia
    quatro pares abriria com o mestre dizendo um par que nenhum cartão usou, e
    haveria dois estados para manter de acordo. Lido, ele não pode divergir do
    que está em tela.
  */
  const datas = useMemo(() => datasDoAcervo(listas), [listas]);
  const rotuloDaData = (data: string) => rotuloDaVigencia(data, datas);
  const mestre = useMemo(() => mestreDosPares(pares, listas), [pares, listas]);
  const situacoes = useMemo(
    () => situacaoDasCoberturas(mestre, pares, listas),
    [mestre, pares, listas],
  );

  /*
    Mexer no mestre: reancorar, aplicar, escrever no endereço.

    `reancorarMestre` é o mesmo cuidado que o `SeletorDoPar` tem um nível
    abaixo — a ponta que a escolha invalidou vai para a mais próxima que ainda
    serve a alguma cobertura, em vez de deixar em tela um par que não aplica
    nada. `aplicarMestre` só escreve onde o motor aceita; o resto fica como
    está, e a frase do painel diz quem ficou.
  */
  const trocarMestre = (proposto: ParMestre, ancora: "de" | "para") => {
    const novo = reancorarMestre(proposto, listas, ancora);
    aplicar(aplicarMestre(novo, listas, pares));
  };

  const consulta = useQuery({
    queryKey: ["alteracoes-por-modulo", pares, recorte.scopeHash, recorte.canal],
    /*
      Sem nenhum par escolhido a pergunta não tem o que responder — e a tela não
      fica muda: o esqueleto some e o servidor não é chamado à toa.
    */
    enabled: COBERTURAS.some((c) => pares[c].base !== "" && pares[c].comparada !== ""),
    queryFn: () => {
      const q = new URLSearchParams(escreverPares(pares));
      if (recorte.scopeHash) q.set("scopeHash", recorte.scopeHash);
      if (recorte.canal) q.set("canal", recorte.canal);
      return fetchJson<{
        changeSets: Record<string, string>;
        areas: AreaNoCatalogo[];
      }>(`/alteracoes-por-modulo/consolidado?${q.toString()}`);
    },
  });

  const contexto = { scopeHash: recorte.scopeHash, canal: recorte.canal };
  const carregandoVigencias = daFrota.isLoading || doQuadro.isLoading;

  return (
    <Layout>
      <CabecalhoDePagina
        titulo="Alterações por Módulo"
        icone={LayoutGrid}
        descricao="Todos os módulos do produto num cartão cada — custo fixo, custo variável e equipe."
        atualizando={consulta.isFetching}
      />

      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 pb-10 sm:px-8">
        <Superficie className="flex flex-col gap-4 px-4 py-4">
          <div>
            <h2 className="text-sm font-semibold">Vigências comparadas</h2>
            <p className="text-xs text-muted-foreground">
              Um par, aplicado a toda cobertura que o aceita — o motor não compara
              vigências de coberturas diferentes, e cada cartão diz contra qual par
              ele foi apurado.
            </p>
          </div>

          <SeletorMestre
            datas={datas}
            rotuloDaData={rotuloDaData}
            mestre={mestre}
            situacoes={situacoes}
            rotulos={rotulos}
            onDe={(de) => trocarMestre({ ...mestre, de }, "de")}
            onPara={(para) => trocarMestre({ ...mestre, para }, "para")}
            onInverter={() => aplicar(aplicarMestre(inverterMestre(mestre), listas, pares))}
            carregando={carregandoVigencias}
          >
            {/*
              A gaveta mostra as quatro coberturas, inclusive as que não formam
              par. Elas sumiam da tela quando a lista vinha vazia, e sumir é a
              pior resposta possível para "e o quadro administrativo?": a linha
              morta diz o motivo, que o domínio já sabe (`motivoSemPar`).
            */}
            {situacoes.map((situacao) => {
              const cobertura = situacao.cobertura;
              const lista = listas[cobertura];
              if (situacao.estado === "SEM_PAR" && !carregandoVigencias) {
                return (
                  <div
                    key={cobertura}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-dashed px-3 py-2.5"
                  >
                    <span className="text-xs font-semibold text-muted-foreground">
                      {ROTULO_DA_COBERTURA[cobertura]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {situacao.motivo ? fraseSemPar(situacao.motivo) : "sem par"}
                    </span>
                  </div>
                );
              }
              return (
                <div key={cobertura} className="flex flex-col gap-2">
                  <h3 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    {ROTULO_DA_COBERTURA[cobertura]}
                    {situacao.estado === "PROPRIO" && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.65rem] font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                        par próprio
                      </span>
                    )}
                  </h3>
                  <SeletorDoPar
                    vigencias={lista}
                    rotulos={rotulos}
                    base={pares[cobertura].base}
                    comparada={pares[cobertura].comparada}
                    onBase={(base) =>
                      aplicar({
                        ...pares,
                        [cobertura]: { ...pares[cobertura], base },
                      })
                    }
                    onComparada={(comparada) =>
                      aplicar({
                        ...pares,
                        [cobertura]: { ...pares[cobertura], comparada },
                      })
                    }
                    onInverter={() =>
                      aplicar({
                        ...pares,
                        [cobertura]: {
                          base: pares[cobertura].comparada,
                          comparada: pares[cobertura].base,
                        },
                      })
                    }
                    carregando={carregandoVigencias}
                    idPrefixo={`catalogo-${cobertura.toLowerCase()}`}
                  />
                </div>
              );
            })}
          </SeletorMestre>
        </Superficie>

        {consulta.isLoading && (
          <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
            <span className="sr-only">Carregando o catálogo de módulos…</span>
            {Array.from({ length: 3 }).map((_, faixa) => (
              <div key={faixa} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-40 w-full" />
                ))}
              </div>
            ))}
          </div>
        )}

        {consulta.isError && (
          <ApiErrorNotice
            error={consulta.error}
            what="o catálogo de alterações por módulo"
            onTentarDeNovo={() => void consulta.refetch()}
            tentando={consulta.isFetching}
          />
        )}

        {consulta.data && (
          <CatalogoDeAlteracoes
            areas={consulta.data.areas}
            endereco={(cartao) => enderecoDoCartao(cartao, contexto)}
          />
        )}
      </div>
    </Layout>
  );
}
