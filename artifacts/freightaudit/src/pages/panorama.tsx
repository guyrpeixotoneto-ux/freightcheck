import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { BarChart3, Clock, FileSearch, History } from "lucide-react";
import { rotuloDaVigencia } from "@workspace/comparison/labels";
import { Layout } from "@/components/layout/layout";
import {
  CabecalhoDePagina,
  CorpoDaPagina,
} from "@/components/layout/cabecalho-de-pagina";
import { Superficie, CabecalhoDaSuperficie } from "@/components/ui/superficie";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { ApiErrorNotice } from "@/components/api-error";
import { EmAtualizacao, classeDeAtualizacao } from "@/components/ui/em-atualizacao";
import { cn } from "@/lib/utils";
import { fetchJson, fetchJsonOrNull } from "@/lib/api";
import { GESTAO_A_VISTA, LINHA_DO_TEMPO, PANORAMA } from "@/lib/ambiente";
import { consultaDoRecorte, opcoesDaVigencia } from "@/lib/leitura-da-vigencia";
import { LEITURA_DE_APURACAO } from "@/lib/frescor-das-leituras";
import { contextoAberto, useContextosDaCasca } from "@/lib/contextos";
import { useFamiliesOverviewQuery } from "@/lib/families-overview";
import {
  useJanelaDesenhada,
  useSerieDeImpacto,
  useSerieDeImpactoGeral,
} from "@/lib/serie-de-impacto";
import { JANELA_PADRAO, type Janela } from "@/lib/janela-de-vigencias";
import { recorteDaJanela } from "@/components/dashboard/grafico-de-impacto";
import { lerRecorte, nomeDaUnidade, type Recorte } from "@/lib/recorte";
import { travessiaDoQuadro, type LinhaDaTravessia } from "@/lib/travessia-do-quadro";
import type { AuditoriaDoQuadro } from "@/lib/qlp-auditoria";
import {
  detalheDaFamilia,
  detalheDoImpacto,
  impactoPorFamilia,
  variacao,
} from "@/lib/visao-geral";
import {
  DECOMPOSICOES,
  filtroDeMudancaValido,
  mudancasRelevantes,
  ponteDoImpacto,
  type FiltroDeMudanca,
} from "@/lib/impacto-apurado";
import {
  estadoDaProcedencia,
  graoValido,
  janelaDoImpacto,
  procedenciaDoPanorama,
  leituraDaUnidade,
  leituraDaVisaoGeral,
  mapaDoPanorama,
  placarDoPanorama,
  rankingPorFamilia,
  rankingPorParametro,
  vereditoDoPanorama,
  type EstadoDaProcedencia,
  type GraoDoRanking,
  type JanelaDoImpacto,
  type LeituraDoPanorama,
  type Veredito as DadosDoVeredito,
} from "@/lib/panorama";
import {
  MenuDaGestaoAVista,
  SeletorDeUnidade,
} from "@/components/dashboard/controles-do-recorte";
import {
  BOTAO_DE_TROCA,
  SeletorDeVigenciaGeral,
} from "@/components/vigencia/seletor-de-vigencia";
import { SeletorDoParDoPanorama } from "@/components/panorama/seletor-do-par";
import { TravessiaDoQuadro } from "@/components/panorama/travessia-do-quadro";
import { OQuePuxou } from "@/components/panorama/o-que-puxou";
import { motivoSemNumeros, useResumoPorVigencia } from "@/hooks/use-resumo-por-vigencia";
import {
  aoEscolherDe,
  aoEscolherPara,
  aoInverter,
  baseNoEndereco,
  consultaDoPar,
  opcoesDoPar,
  parEmTela,
} from "@/lib/par-do-panorama";
import { FaixaSemAlteracao } from "@/components/impacto-apurado/faixa-de-cobertura";
import { PonteDoImpactoGrafico } from "@/components/impacto-apurado/ponte-do-impacto";
import { Veredito } from "@/components/panorama/veredito";
import { Ranking } from "@/components/panorama/ranking";
import { Mapa } from "@/components/panorama/mapa";
import { Procedencia } from "@/components/panorama/procedencia";
import { GraficoDeImpacto } from "@/components/dashboard/grafico-de-impacto";
import { DetalheDaFamilia } from "@/components/inicio/detalhe-da-familia";
import { DetalheDoImpacto } from "@/components/inicio/detalhe-do-impacto";
import { unidadesPorImpacto } from "@/components/inicio/visao-geral-consolidada";
import type { UnidadeDoDrill } from "@/lib/drill-da-familia";
import type { BalancoDoRecorte } from "@/components/balanco/tipos";
import type { FamiliesOverview, FamiliesView, GroupedView } from "@/components/inicio/types";

/**
 * O Panorama Executivo — a leitura executiva inteira, numa tela só.
 *
 * A seção *Visão executiva* tinha quatro módulos de leitura — Impacto Líquido,
 * Impacto Apurado, Resumo executivo e Linha do Tempo — que liam **a mesma
 * resposta do servidor, sob as mesmas chaves de cache**, e publicavam três
 * blocos idênticos nos quatro. Não eram quatro perguntas: eram quatro formatos,
 * cada um herdado de um momento diferente da história do produto, e nenhum
 * deles desenhado contra os outros três. `docs/PROPOSTA-PANORAMA-EXECUTIVO.md`
 * mede a sobreposição nos arquivos.
 *
 * Esta tela é o quinto módulo, e ela **não é os quatro empilhados** — empilhar
 * trocaria quatro telas redundantes por uma tela longa e redundante. Onde três
 * módulos desenhavam a mesma coisa de três jeitos, aqui se desenha o melhor dos
 * três, uma vez.
 *
 * São **três dobras**, e a ordem é a das perguntas que uma diretoria faz:
 *
 * | # | Pergunta | O que responde |
 * |---|---|---|
 * | 1 | Quanto custou, e dá para confiar? | a manchete: veredito, régua de medidas, cobertura |
 * | 2 | É um mês comum? E onde aconteceu? | a trajetória e o ranking dos tipos de ativo |
 * | 3 | De onde vem esse número? | a ponte por família e o ranking do dinheiro |
 * | — | Posso confiar no dado? | a procedência, no rodapé |
 * | — | E o pessoal? | a travessia para o quadro, a última linha |
 *
 * **Eram nove blocos em coluna única, em outra ordem.** Os seis andares
 * originais — veredito, placar, composição, trajetória, mapa, procedência —
 * eram as perguntas certas e custavam cinco telas de rolagem, com o líquido
 * apurado impresso seis vezes. As dobras agrupam cada pergunta com o seu par de
 * cartões; a composição desceu para a terceira porque a segunda pergunta de
 * quem abre a tela de manhã não é "de onde vem", é "isto é normal?" — e quem
 * responde essa é o histórico.
 *
 * **A fila ("o que eu faço agora") saiu.** Ela era o único andar que não
 * respondia sobre a vigência lida: fundia três listas de trabalho e mandava
 * embora — para a Curadoria, para as alterações sem preço, para o Cockpit —,
 * o que faz dela uma tela de execução dentro de uma tela de leitura. Os três
 * destinos continuam existindo e continuam alcançáveis de onde a pergunta
 * nasce (a faixa de cobertura leva às alterações sem preço; o mapa e o pódio
 * abrem a família). `filaDoPanorama` fica em `lib/panorama.ts`, testada, para
 * quando a fila voltar a ter uma tela sua.
 *
 * **Nada aqui apura dinheiro.** A aritmética inteira mora em `lib/panorama.ts`,
 * que é projeção de `ExecutiveSummary` por funções que já existiam e já eram
 * testadas fora do JSX (`lib/visao-geral.ts`, `lib/impacto-apurado.ts`). Não há
 * endpoint novo. Se o Panorama publicasse um líquido diferente do Impacto
 * Apurado sobre a mesma vigência, seria a quinta verdade sobre o mesmo dado —
 * o defeito que ele existe para curar.
 *
 * **Os quatro módulos continuam existindo, e os endereços deles não mudaram.**
 * O Panorama abre a seção e eles descem na lateral, assumindo a função que já
 * exerciam de fato: a exploração detalhada de um andar. Nenhum link colado em
 * e-mail morreu — a mesma regra que manteve a Auditoria Empurrada na raiz
 * (`lib/ambiente.ts`).
 *
 * **O custo de abertura é o de zero requisições novas** quando se chega de
 * qualquer módulo vizinho: a vigência e a série já estão em cache sob as mesmas
 * chaves (`lib/leitura-da-vigencia.ts`, `lib/serie-de-impacto.ts`). Vindo de
 * fora, são as mesmas leituras que qualquer um dos quatro já fazia, mais as
 * duas da procedência — que saem sozinhas, sem segurar o conteúdo principal.
 */
export default function Panorama() {
  const search = useSearch();
  const [, navegar] = useLocation();
  const parametros = new URLSearchParams(search);
  const consulta = consultaDoRecorte(search);
  const visaoGeral = parametros.get("visaoGeral") === "1";

  /*
    A volta — e por que ela é a única coisa que troca de rota.

    `?base=` guarda a ponta de partida (ver `lib/par-do-panorama.ts`; o nome não
    é `de` porque `?de=` já é o recorte de janela do contexto, do lado da API).
    Enquanto ela for anterior ao `?period=`, o par é o natural e a tela continua
    lendo `/changes/families`, na mesma chave de cache em que o Impacto Apurado
    e o Dashboard já o têm — ir e voltar entre os módulos continua não custando
    requisição nenhuma.

    Quando ela é **posterior**, o par é a volta: um par que a importação não
    gravou e que nenhuma régua de data alcança. Aí a leitura sai por
    `/changes/families/par`, que manda o motor calcular B×A e responde o mesmo
    corpo. A comparação da ida e a da volta são duas chaves diferentes porque
    são duas respostas diferentes — não simétricas, que é o motivo de o botão
    existir.

    A conta é textual de propósito (`base > period`, ISO): ela decide **qual
    consulta sai**, e depender da lista de vigências para isso faria a primeira
    leitura esperar por outra leitura. As duas chaves só são escritas juntas —
    quem inverte escreve as duas —, e um `?base=` sem `?period=` é ignorado,
    como qualquer endereço que descreva meio par.
  */
  const dePedido = parametros.get("base");
  const paraPedido = parametros.get("period");
  const emPar =
    !visaoGeral && dePedido !== null && paraPedido !== null && dePedido > paraPedido;

  const vigencia = useQuery({ ...opcoesDaVigencia(consulta), enabled: !visaoGeral && !emPar });
  const invertida = useQuery({
    ...opcoesDoPar(
      consultaDoPar(consulta, { de: dePedido ?? "", para: paraPedido ?? "" }),
    ),
    enabled: emPar,
  });
  const principal = emPar ? invertida : vigencia;
  const view = visaoGeral ? null : (principal.data ?? null);

  const contextos = useContextosDaCasca();
  const periodosOverview = useMemo(
    () =>
      Array.from(new Set(contextos.contextos.flatMap((c) => c.periodosDisponiveis))).sort((a, b) =>
        b.localeCompare(a),
      ),
    [contextos.contextos],
  );
  /* Sem `?period=`, a Visão Geral abre na competência mais recente — a mesma
     régua dos outros módulos, e a que quem abre a tela veio ver. */
  const periodoOverviewEfetivo = parametros.get("period") ?? periodosOverview[0] ?? null;
  const overviewQuery = useFamiliesOverviewQuery(periodoOverviewEfetivo, { enabled: visaoGeral });
  const overview = visaoGeral ? (overviewQuery.data ?? null) : null;

  const recorte = lerRecorte(search);
  /*
    As vigências que a casca já conhece — a lista de reserva do seletor do par.

    Ela existe para o estado em que a leitura principal **não** respondeu: uma
    volta recusada pelo motor deixa a tela sem `view`, e com ela iria embora a
    lista de vigências, junto com a única forma de desfazer a escolha sem o
    botão do navegador. `/contexts` já está em memória (é a mesma consulta da
    lateral), e a unidade aberta é a mesma que ela nomeia.
  */
  const periodosDoContexto = useMemo(
    () => contextoAberto(contextos.contextos, recorte.scopeHash)?.periodosDisponiveis ?? [],
    [contextos.contextos, recorte.scopeHash],
  );
  const atualizadoEm = visaoGeral ? overviewQuery.dataUpdatedAt : principal.dataUpdatedAt;
  const atualizando = visaoGeral ? overviewQuery.isPlaceholderData : principal.isPlaceholderData;

  /*
    A vigência anterior — só para a variação do andar 1, e só quando existe.

    `/changes/grouped` e não `/changes/families`: daqui sai um resumo executivo
    e nada mais, e pedir a árvore de famílias inteira seria trabalho de servidor
    para um dado que a tela não usa. É a mesma consulta, com a mesma justificativa,
    que o Resumo executivo já fazia.

    Não existe na Visão Geral: o overview responde por uma competência de cada
    vez, e "a anterior de cada unidade" não é uma competência — somá-las daria
    uma base que nenhuma unidade tem.

    **E não existe no par invertido.** A variação do andar 1 é "esta vigência
    custou mais ou menos que a anterior" — uma comparação entre dois passos
    consecutivos na direção em que o histórico anda. Lida a volta, o número em
    tela é o desfazimento de um passo, e a vigência anterior à de chegada não é
    a base de nada: publicá-la ali daria uma variação entre duas leituras que
    não se sucedem. O andar mostra o líquido do par, sem a linha de variação,
    que é o que ele já faz na primeira vigência de um histórico.
  */
  const anterior = useMemo(() => {
    if (!view || emPar) return null;
    const ordenadas = [...view.periods].sort((a, b) => a.date.localeCompare(b.date));
    const indice = ordenadas.findIndex((p) => p.date === view.period);
    return indice > 0 ? ordenadas[indice - 1] : null;
  }, [view, emPar]);

  const comparacao = useQuery({
    queryKey: ["grouped", "panorama-anterior", anterior?.date, consulta.toString()],
    enabled: anterior !== null,
    ...LEITURA_DE_APURACAO,
    queryFn: async () => {
      const query = new URLSearchParams(consulta);
      query.set("period", anterior!.date);
      return await fetchJson<GroupedView>(`/changes/grouped?${query}`);
    },
  });

  /*
    A procedência. Sai **depois** do conteúdo principal, pela mesma razão medida
    em `docs/AUDITORIA-ZERO-LOADING.md` para a série geral: não alimenta a
    resposta que traz alguém à tela, e disputaria o mesmo pool de conexões com a
    leitura que alimenta.

    **Uma consulta, e recortada.** Eram duas — `/balance` e `/imports` —, as duas
    sem recorte nenhum: o andar publicava a cobertura do acervo inteiro debaixo
    do cabeçalho de uma unidade, e a última importação do sistema como se fosse a
    desta competência. `/balance/recorte` responde as duas coisas sobre o mesmo
    recorte dos outros andares, e o servidor deriva a operação do ambiente em vez
    de aceitar a que o cliente mandou (`lib/ambiente-da-auditoria.ts`).

    **E ela não engole mais a falha.** Saíam com `.catch(() => null)`, e o `null`
    fazia o andar sumir — de modo que "a API caiu", "você não tem acesso", "ainda
    estou lendo" e "não há importação conferida" terminavam no mesmo nada, num
    andar cuja pergunta é *"posso confiar nisto?"*. Quem separa os quatro é
    `estadoDaProcedencia`, em `lib/panorama.ts`.

    Na Visão Geral ela **não sai**: o recorte é de uma unidade, e pedi-la sem
    `scopeHash` cairia na unidade padrão do servidor — a procedência de **uma**
    debaixo de números que somaram todas. É a mesma recusa de `comDestino`.
  */
  const principalPronto = visaoGeral ? !overviewQuery.isLoading : !principal.isLoading;
  const periodoDaProcedencia = view?.period ?? null;
  const consultaDaProcedencia = useMemo(() => {
    const query = new URLSearchParams(consulta);
    if (periodoDaProcedencia !== null) query.set("period", periodoDaProcedencia);
    return query.toString();
  }, [consulta, periodoDaProcedencia]);

  const recorteDaProcedencia = useQuery({
    queryKey: ["balance-recorte", "panorama", consultaDaProcedencia],
    enabled: principalPronto && !visaoGeral && periodoDaProcedencia !== null,
    ...LEITURA_DE_APURACAO,
    queryFn: () => fetchJson<BalancoDoRecorte>(`/balance/recorte?${consultaDaProcedencia}`),
  });

  /*
    O quadro de pessoal — a faixa de travessia do rodapé.

    **Sai depois do conteúdo principal**, pela mesma razão da procedência: não
    alimenta a resposta que traz alguém à tela, e disputaria o mesmo pool de
    conexões com a leitura que alimenta.

    **E sai sem o recorte desta tela.** O QLP é da família `QUADRO_DE_PESSOAL`,
    que tem os seus próprios contextos: mandar o `scopeHash` de um contexto de
    equipamento pediria uma unidade que aquela lista não tem. Sem ele, a rota
    resolve o contexto do quadro — que é consolidado entre unidades por desenho
    (`lib/qlp/src/contexto.ts`) —, e a faixa diz isso em vez de fingir que o
    número é da unidade do cabeçalho.

    A chave de cache é a mesma que a tela do QLP usa para a mesma consulta
    (`["qlp", "auditoria", "quadro=X"]`, em `components/qlp-auditoria`): quem
    clica na faixa abre o módulo sem pedir nada de novo ao servidor.

    404 aqui não é falha: é "este quadro não tem vigência importada", e
    `fetchJsonOrNull` o traduz em `null` — o quadro não vira linha, e sem linha
    nenhuma não há faixa.

    **E não há como saber antes se há quadro.** A casca lista contextos só da
    família de equipamento, de propósito (`lib/comparison/src/series.ts`), então
    as duas perguntas saem sem portão — o custo delas e as alternativas estão
    pesados no cabeçalho de `lib/travessia-do-quadro.ts`.
  */
  const administrativo = useQuery({
    queryKey: ["qlp", "auditoria", "quadro=ADMINISTRATIVO"],
    enabled: principalPronto,
    retry: false,
    ...LEITURA_DE_APURACAO,
    queryFn: () => fetchJsonOrNull<AuditoriaDoQuadro>("/qlp/auditoria?quadro=ADMINISTRATIVO"),
  });
  const operacional = useQuery({
    queryKey: ["qlp", "auditoria", "quadro=OPERACIONAL"],
    enabled: principalPronto,
    retry: false,
    ...LEITURA_DE_APURACAO,
    queryFn: () => fetchJsonOrNull<AuditoriaDoQuadro>("/qlp/auditoria?quadro=OPERACIONAL"),
  });
  const travessia = useMemo(
    () =>
      travessiaDoQuadro({
        ADMINISTRATIVO: administrativo.data ?? null,
        OPERACIONAL: operacional.data ?? null,
      }),
    [administrativo.data, operacional.data],
  );

  const serieDaUnidade = useSerieDeImpacto(visaoGeral ? null : view, consulta, !visaoGeral);
  const serieGeral = useSerieDeImpactoGeral(
    periodosOverview,
    periodoOverviewEfetivo,
    overview,
    visaoGeral && !overviewQuery.isLoading,
  );

  /*
    Trocar qualquer coisa que não seja o par **apaga o par**.

    `?base=` só faz sentido ao lado do `?period=` com que foi escrito: levá-lo
    numa troca de unidade apontaria para uma data que a outra unidade pode não
    ter, e numa troca de competência montaria um par salteado. Quem escolhe o
    par escreve as duas chaves na mesma troca — e é só nesse caso que `base`
    sobrevive, porque veio na própria mudança.
  */
  const trocarPara = (mudancas: Record<string, string | null>) => {
    const proxima = new URLSearchParams(search);
    if (!("base" in mudancas)) proxima.delete("base");
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null) proxima.delete(chave);
      else proxima.set(chave, valor);
    }
    const texto = proxima.toString();
    navegar(texto ? `${PANORAMA}?${texto}` : PANORAMA);
  };

  const paraGestaoAVista = consulta.toString() ? `${GESTAO_A_VISTA}?${consulta}` : GESTAO_A_VISTA;
  const unidade = view ? nomeDaUnidade(view.context) : null;
  const periodoAtual = visaoGeral ? (overview?.period ?? null) : (view?.period ?? null);

  /*
    `isPending` e não `isLoading`: enquanto `enabled` é falso — o conteúdo
    principal ainda não chegou — a consulta não está carregando, mas também não
    tem resposta, e tratá-la como decidida publicaria "não há importação
    conferida" sobre uma pergunta que ninguém fez ainda.
  */
  const procedencia = estadoDaProcedencia(
    [
      {
        rota: "/balance/recorte",
        carregando: recorteDaProcedencia.isPending,
        dados: recorteDaProcedencia.data,
        erro: recorteDaProcedencia.error,
        erroEm: recorteDaProcedencia.errorUpdatedAt,
      },
    ],
    procedenciaDoPanorama(recorteDaProcedencia.data),
  );

  const relerProcedencia = () => {
    void recorteDaProcedencia.refetch();
  };

  return (
    <Layout>
      {/*
        O cabeçalho é o da casca (`components/layout/cabecalho-de-pagina.tsx`),
        e não mais um `<header>` desta tela: a trilha, a régua de largura, o
        corpo do título e o lugar da linha de "atualizado às" passaram a ser
        decisão de um lugar só, para que a quadragésima tela do produto não
        precise reinventá-los — e para que esta não fique órfã quando eles
        evoluírem.

        O que continua sendo desta tela é o que só ela sabe: o nome do recorte
        aberto, a frase que indexa as dobras e os três controles.
      */}
      <CabecalhoDePagina
        titulo={`Panorama — ${visaoGeral ? "Visão Geral" : (unidade ?? "")}`}
        atualizando={atualizando}
        /*
          A frase é o índice dos andares, e por isso ela muda quando eles
          mudam. Terminava em "e o que fazer agora" — o andar que respondia
          isso era a fila, que saiu por não ser leitura. A promessa ficou
          sem entrega, que é a mesma classe de defeito que o Panorama veio
          curar: a tela dizendo uma coisa e mostrando outra.

          Termina na procedência porque é ali que a tela termina, e porque
          "posso confiar nisto" é a última pergunta de quem vai levar o
          número para uma reunião.
        */
        descricao="A leitura executiva inteira desta competência: quanto custou, de onde vem, como chegou aqui, onde aconteceu e o quanto dá para confiar no número."
        contexto={<UltimaAtualizacao quando={atualizadoEm} />}
        acoes={
          <>
            {contextos.contextos.length > 1 && (
              <SeletorDeUnidade
                contextos={contextos.contextos}
                visaoGeral={visaoGeral}
                periodoAtual={periodoAtual}
                onTrocar={trocarPara}
              />
            )}
            {visaoGeral ? (
              <SeletorDeVigenciaGeral
                periodos={periodosOverview}
                ativa={overview?.period ?? null}
                onTrocar={trocarPara}
                className={BOTAO_DE_TROCA}
              />
            ) : null}
            {/*
              Na leitura de unidade **não há** seletor de vigência aqui: quem
              escolhe a vigência é o par, no corpo da tela, e ele escolhe as
              duas pontas. Dois controles para a mesma escolha, na mesma tela,
              seriam duas perguntas disputando o mesmo gesto — e a coluna de
              números que fazia este menu valer a abertura mudou de endereço
              junto, para dentro das duas caixas.

              A Visão Geral continua com o dela: lá não há par a escolher — o
              overview responde por uma competência somando todas as unidades,
              e "a anterior de cada uma" não é uma competência.
            */}
            <MenuDaGestaoAVista paraGestaoAVista={paraGestaoAVista} />
          </>
        }
      />

      <CorpoDaPagina>
        {visaoGeral ? (
          <>
            {overviewQuery.isLoading && <Carregando />}
            {overviewQuery.error && (
              <ApiErrorNotice error={overviewQuery.error} what="Não foi possível montar o Panorama." />
            )}
            {!overviewQuery.isLoading && !overviewQuery.error && overview === null && <SemVigencia />}
            {overview && (
              <div className={cn("space-y-5", classeDeAtualizacao(overviewQuery.isPlaceholderData))}>
                <Corpo
                  leitura={leituraDaVisaoGeral(overview)}
                  view={null}
                  overview={overview}
                  recorte={recorte}
                  consulta={consulta}
                  anterior={null}
                  pontos={serieGeral}
                  periodicityDaSerie={null}
                  serieCarregando={overviewQuery.isLoading}
                  vigenciaAberta={overview.period}
                  parametros={parametros}
                  onTrocar={trocarPara}
                  procedencia={procedencia}
                  onRelerProcedencia={relerProcedencia}
                  travessia={travessia}
                />
              </div>
            )}
          </>
        ) : (
          <>
            {/*
              O par vem **antes** de tudo, e fica em tela em todos os estados —
              inclusive no de erro.

              É o único controle desta leitura, e ele é também a saída: uma
              volta que o motor recuse (coberturas diferentes, canais
              diferentes) deixa a tela sem corpo, e um seletor que sumisse
              junto prenderia quem clicou num endereço sem gesto de retorno
              além do botão do navegador. Enquanto a lista de vigências não
              chegou, ele desenha o esqueleto das duas caixas; sem leitura
              nenhuma, ele se vira com as vigências que a casca já conhece.
            */}
            <ParDaLeitura
              view={view}
              consulta={consulta}
              periodosDoContexto={periodosDoContexto}
              dePedido={dePedido}
              paraPedido={paraPedido}
              carregando={principal.isLoading || principal.isFetching}
              onTrocar={trocarPara}
            />
            {principal.isLoading && <Carregando />}
            {principal.error && (
              <ApiErrorNotice error={principal.error} what="Não foi possível montar o Panorama." />
            )}
            {!principal.isLoading && !principal.error && view === null && <SemVigencia />}
            {view && (
              <div className={cn("space-y-5", classeDeAtualizacao(principal.isPlaceholderData))}>
                <Corpo
                  leitura={leituraDaUnidade(view)}
                  view={view}
                  overview={null}
                  recorte={recorte}
                  consulta={consulta}
                  /*
                    `emPar` corta aqui também, e não só no `enabled` da
                    consulta: desligada, ela **guarda** a última resposta, e o
                    que chegava ao andar 1 na volta era a variação da ida, em
                    cache, contra um líquido que já tinha trocado de sinal —
                    "−R$ 11.917/mês" com "+2% vs vigência anterior" embaixo.
                  */
                  anterior={emPar ? null : (comparacao.data ?? null)}
                  pontos={serieDaUnidade.pontos}
                  periodicityDaSerie={serieDaUnidade.periodicity}
                  serieCarregando={serieDaUnidade.carregando}
                  vigenciaAberta={view.period}
                  parametros={parametros}
                  onTrocar={trocarPara}
                  procedencia={procedencia}
                  onRelerProcedencia={relerProcedencia}
                  travessia={travessia}
                />
              </div>
            )}
          </>
        )}
      </CorpoDaPagina>
    </Layout>
  );
}

/**
 * O par em tela — a lista, os números de cada vigência e o que cada gesto muda
 * no endereço.
 *
 * Componente, e não um trecho do corpo da página, por causa do hook: os números
 * da lista saem de `useResumoPorVigencia`, a mesma leitura de `/changes/range`
 * que a Linha do Tempo já faz e que o menu do cabeçalho usava — servida do cache
 * quando qualquer uma delas já a pediu. Chamá-lo lá em cima obrigaria a página a
 * carregá-lo também na Visão Geral, onde não há par a escolher.
 *
 * Ele decide **o que vai para o endereço**, e não o que a tela lê: quem lê é a
 * página, olhando o endereço. É o que mantém o par colável — o mesmo `?period=`
 * de sempre, com `?de=` ao lado só quando ele diz algo que o padrão não diria.
 */
function ParDaLeitura({
  view,
  consulta,
  periodosDoContexto,
  dePedido,
  paraPedido,
  carregando,
  onTrocar,
}: {
  view: FamiliesView | null;
  consulta: URLSearchParams;
  /** As vigências que a casca conhece — a reserva de quando não há leitura. */
  periodosDoContexto: string[];
  dePedido: string | null;
  paraPedido: string | null;
  carregando: boolean;
  onTrocar: (mudancas: Record<string, string | null>) => void;
}) {
  const resumo = useResumoPorVigencia(view, consulta);

  /*
    A lista sai da leitura quando há uma, e da casca quando não há.

    Os rótulos da leitura vêm prontos do servidor (`view.periods[].label`), que
    é a mesma função que nomeia a vigência no resto da casa. Na reserva eles são
    montados aqui, com a lista inteira do contexto servindo de régua de
    desempate — a mesma regra, aplicada no navegador, para que a vigência não
    mude de nome conforme o estado em que a tela está.
  */
  const opcoes = useMemo(() => {
    const numeros = (data: string) => ({
      ...(resumo.porVigencia.get(data) ?? { alteracoes: null, impacto: null }),
      // Sem números, a linha diz por quê. Em branco ela é lida como "não teve
      // importação" — a única coisa que não pode ser, já que a lista sai das
      // vigências importadas do contexto.
      nota: motivoSemNumeros(data, resumo),
    });
    if (view) {
      return [...view.periods]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((periodo) => ({
          data: periodo.date,
          rotulo: periodo.label,
          ...numeros(periodo.date),
        }));
    }
    return [...periodosDoContexto]
      .sort((a, b) => b.localeCompare(a))
      .map((data) => ({
        data,
        rotulo: rotuloDaVigencia(data, periodosDoContexto),
        ...numeros(data),
      }));
  }, [view, periodosDoContexto, resumo]);

  const datas = useMemo(() => opcoes.map((o) => o.data), [opcoes]);
  const par = parEmTela(datas, { para: view?.period ?? paraPedido, de: dePedido });

  /* Uma vigência só no histórico não é falha: é o acervo dizendo que ainda não
     há o que comparar, e a frase diz o que falta. */
  const indisponivel =
    datas.length === 1
      ? "Esta unidade tem uma vigência só no histórico — não há par a comparar. Importe a vigência seguinte para ler o que mudou entre as duas."
      : null;

  /* Escrever `?base=` só quando ele muda alguma coisa — ver `baseNoEndereco`. */
  const irPara = (destino: { period: string; de: string } | null) => {
    if (!destino) return;
    onTrocar({
      period: destino.period,
      base: baseNoEndereco(datas, { para: destino.period, de: destino.de }),
    });
  };

  return (
    <SeletorDoParDoPanorama
      opcoes={opcoes}
      par={par}
      periodicidade={resumo.periodicidade}
      carregando={carregando}
      indisponivel={indisponivel}
      onEscolherDe={(data) => irPara(aoEscolherDe(datas, data))}
      onEscolherPara={(data) => irPara(aoEscolherPara(datas, data))}
      onInverter={() => irPara(aoInverter(par))}
    />
  );
}

/**
 * As três dobras — **iguais nas duas leituras**.
 *
 * A Visão Geral e a unidade desenham o mesmo corpo, e não duas telas parecidas:
 * `LeituraDoPanorama` é o que as duas respostas do servidor têm em comum, e os
 * dois adaptadores (`leituraDaUnidade`, `leituraDaVisaoGeral`) são o único
 * lugar onde a diferença entre elas é resolvida. O que muda daqui para baixo é
 * só **o que cada leitura sabe responder** — a Visão Geral não tem a árvore de
 * parâmetros nem uma unidade a quem abrir gaveta —, e cada andar declara isso
 * na cara em vez de silenciosamente publicar meio dado.
 */
function Corpo({
  leitura,
  view,
  overview,
  recorte,
  consulta,
  anterior,
  pontos,
  periodicityDaSerie,
  serieCarregando,
  vigenciaAberta,
  parametros,
  onTrocar,
  procedencia,
  onRelerProcedencia,
  travessia,
}: {
  leitura: LeituraDoPanorama;
  /** A unidade aberta — `null` na Visão Geral. */
  view: FamiliesView | null;
  overview: FamiliesOverview | null;
  recorte: Recorte;
  consulta: URLSearchParams;
  /** A vigência anterior, para a variação do andar 1. `null` sem anterior. */
  anterior: GroupedView | null;
  pontos: ReturnType<typeof useSerieDeImpacto>["pontos"];
  periodicityDaSerie: string | null;
  serieCarregando: boolean;
  vigenciaAberta: string | null;
  parametros: URLSearchParams;
  onTrocar: (mudancas: Record<string, string | null>) => void;
  procedencia: EstadoDaProcedencia;
  onRelerProcedencia: () => void;
  /** O quadro de pessoal alcançável daqui — vazio quando não há QLP importado. */
  travessia: LinhaDaTravessia[];
}) {
  const daVigencia: Recorte = { ...recorte, period: vigenciaAberta };
  const comDestino = view !== null;

  const veredito = vereditoDoPanorama(leitura, anterior);
  const lados = veredito.situacao.estado === "com_movimento" ? veredito.situacao.lados : null;
  const periodicidade = lados?.periodicity ?? null;

  const placar = placarDoPanorama(leitura, veredito, {
    recorte: daVigencia,
    comDestino,
    variacaoDeAlteracoes: variacao(leitura.alteracoes, anterior?.totals.changes),
  });

  const ponte = ponteDoImpacto(leitura.resumo, periodicidade);
  const mudancas = mudancasRelevantes(leitura.resumo, periodicidade);

  /*
    O pódio sai daqui, e não de dentro de cada cartão: as duas colunas (o que
    somou e o que tirou) são dois recortes da **mesma** lista de famílias, e
    calculá-la duas vezes é onde as duas leituras começariam a divergir —
    bastaria uma delas escolher outra periodicidade. É a mesma `periodicidade`
    que o veredito publicou lá em cima e que a ponte do andar 3 desenha, pela
    mesma razão: quatro números sobre a mesma vigência em grandezas diferentes
    seriam quatro verdades.
  */
  const podio = impactoPorFamilia(leitura.resumo, periodicidade);

  const mapa = mapaDoPanorama(
    leitura,
    view,
    overview
      ? unidadesPorImpacto(overview).map(({ unidade, impacto }) => ({
          chave: unidade.contexts[0]?.scopeHash ?? unidade.unidade,
          label: unidade.label,
          impacto:
            impacto && impacto.periodicity !== null
              ? { periodicity: impacto.periodicity, amount: impacto.amount }
              : null,
          alteracoes: unidade.summary.changes,
        }))
      : [],
    /* O recorte é o mesmo dos outros cartões, e o destino segue a regra do
       placar: na Visão Geral a linha não aponta para tela de unidade. */
    { recorte: daVigencia, comDestino },
  );

  const familiaAberta = parametros.get("familia");
  const impactoAberto = parametros.get("impacto");

  /*
    O ranking da dobra 2 — o grão e o lado, lidos do endereço.

    Os dois são chave de URL porque os dois são leitura, e não preferência de
    quem está na frente da tela: um link colado abre o mesmo recorte que quem
    colou estava lendo. `familia` é o padrão e não vai ao endereço — a URL
    descreve o que foge do padrão, como no resto do produto.

    As contagens saem da **mesma** função que monta a lista, sem limite: é ela
    que decide quem participa de cada lado, e contar aqui por fora daria um
    botão habilitado sobre uma lista vazia no dia em que a regra mudasse.
  */
  const pedidoDeGrao = parametros.get("grao");
  const grao: GraoDoRanking = graoValido(pedidoDeGrao) ? pedidoDeGrao : "familia";
  const filtro = filtroAberto(parametros);
  const doGrao = (f: FiltroDeMudanca, limite: number) =>
    grao === "familia"
      ? rankingPorFamilia(podio, f, limite)
      : rankingPorParametro(mudancas, f, limite);
  const linhasDoRanking = doGrao(filtro, LINHAS_DO_RANKING);
  const contagensDoRanking: Record<FiltroDeMudanca, number> = {
    todos: doGrao("todos", Infinity).length,
    ganhos: doGrao("ganhos", Infinity).length,
    perdas: doGrao("perdas", Infinity).length,
  };


  /*
    A janela do gráfico — **uma, para os dois cartões da dobra 2.**

    O seletor (3 · 6 · 12 vigências ou meses) era estado do gráfico, e agora é
    da página: o cartão ao lado lê o mesmo intervalo por parâmetro, e um seletor
    que mudasse só o desenho deixaria os dois falando de janelas diferentes lado
    a lado — seis vigências no gráfico e nove no cartão, sem nada acusando. Foi
    exatamente o que aconteceu na primeira versão desta dobra.
  */
  const [janelaAberta, setJanelaAberta] = useState<Janela>(JANELA_PADRAO);
  const desenhados = useMemo(() => recorteDaJanela(pontos, janelaAberta), [pontos, janelaAberta]);
  /*
    O rollup por parâmetro é somado **pelo servidor** sobre o intervalo pedido,
    e não se corta no navegador: `byParameter` traz o total de cada parâmetro na
    janela, não a fatia dele por vigência. Então o cartão pede o recorte que o
    gráfico desenha — e quando o desenhado é o carregado (quem tem menos
    vigências que o teto da série), a chave é a mesma e nada sai para a rede.
    Ver `opcoesDoIntervalo`.
  */
  const intervalo = useJanelaDesenhada(
    consulta,
    desenhados[0]?.periodo ?? null,
    vigenciaAberta,
    /* Na Visão Geral não há rollup a pedir: `/changes/range/overview` soma
       unidade a unidade e não traz parâmetro. */
    view !== null && desenhados.length > 0,
  );
  const janela = janelaDoImpacto(intervalo.movimentos, periodicidade, LINHAS_DO_RANKING);
  /*
    A coluna da direita existe onde a leitura **tem** janela — na unidade, sempre
    (mesmo carregando, e aí o cartão desenha o esqueleto); na Visão Geral, nunca.
    Metade de uma faixa em fundo de página se lê como cartão que não carregou.
  */
  const comJanela = view !== null;
  const detalheFamilia = detalheDaFamilia(leitura.resumo, familiaAberta, periodicidade);
  const detalheImpacto = detalheDoImpacto(view, impactoAberto, periodicidade);

  const unidadesDoDrill: UnidadeDoDrill[] = view
    ? [
        {
          chave: view.context.scopeHash,
          label: nomeDaUnidade(view.context),
          contexts: [{ scopeHash: view.context.scopeHash, channel: view.context.channel }],
          summary: view.summary,
        },
      ]
    : [];

  return (
    <>
      {/* ---- Dobra 1 · a manchete ---- */}
      {/*
        Eram três blocos: o cartão do veredito, a faixa de cobertura de largura
        inteira e a fileira de cinco cartões do placar. O primeiro cartão do
        placar era o número da manchete outra vez, e dois outros eram os números
        da faixa outra vez — ~700px, três molduras e o mesmo líquido impresso
        duas vezes a 200px de distância. Agora é um cartão com três linhas, e
        `components/panorama/veredito.tsx` explica a hierarquia delas.
      */}
      <Veredito
        veredito={veredito}
        medidas={placar}
        verDetalhes={
          comDestino
            ? linkDasSemPreco(daVigencia)
            : /* Na Visão Geral o destino cairia na unidade padrão do servidor. */
              null
        }
      />

      {/*
        Sem cobertura a medir a manchete não tem a linha de confiança, e aí a
        faixa continua: as duas causas disso — nada mudou, ou não há vigência
        anterior — são a notícia da tela, e não uma nota de pé de cartão.
      */}
      {!veredito.cobertura && (
        <FaixaSemAlteracao temAnterior={view ? view.cockpit.baseline.hasBaseline : true} />
      )}

      {/* ---- Dobra 2 · a janela ---- */}
      {/*
        **A dobra da janela: as duas metades falam das mesmas vigências.** À
        esquerda o gráfico — ganhos e perdas por vigência, "esta competência é
        fora do normal?" —, e à direita quem vem puxando esse movimento, por
        parâmetro, no mesmo intervalo. Antes o lado direito era o cartão dos
        tipos de ativo, que pareava por ser curto e não por responder a mesma
        pergunta: ele fala da competência aberta, e desceu para a faixa depois
        da dobra 3, junto das outras leituras dela.

        **Ela vem antes da composição, e a ordem é de leitura.** As duas dobras
        já foram na ordem inversa: a composição — de onde vem o número — subia
        colada na manchete, e o histórico ficava para o fim. Quem abre a tela de
        manhã não pergunta "de onde vem" antes de saber se a vigência é fora do
        normal, e é o gráfico que responde isso: um líquido de R$ 11.917 não
        diz nada sozinho, e dito ao lado de seis vigências passa a dizer se é
        um mês comum ou o maior movimento do semestre. A decomposição é o
        degrau seguinte — e continua a um rolar de distância, na dobra 3.
      */}
      {/*
        As colunas esticam juntas, e o cartão de lista preenche a sua.

        Elas já pararam na altura do próprio conteúdo, e ali o custo aparecia
        embaixo da coluna curta: um gráfico de 300px ao lado de uma lista de três
        linhas deixava ~200px de fundo de página entre a lista e a faixa
        seguinte. Esticar sozinho seria pior — vão dentro da borda do cartão —, e
        é por isso que as duas coisas andam juntas: a coluna estica **e** a lista
        reparte a folga entre as linhas (ver `components/panorama/ranking.tsx`).
      */}
      <div className={cn("grid gap-5", comJanela && "xl:grid-cols-2")}>
        <Superficie className="px-6 py-5 min-w-0">
          {/*
            Barras divergentes, e não a linha do líquido sozinha.

            A linha respondia "estamos melhorando ou piorando" e parava aí: uma
            vigência de líquido zero desenhava o mesmo ponto tendo havido R$ 0 de
            movimento ou R$ 120 mil somados contra R$ 120 mil tirados — e são
            duas vigências completamente diferentes de se administrar. Aqui os
            dois lados aparecem inteiros, cada um crescendo do zero para o seu
            lado, com o líquido passando por cima.

            Uma barra por vigência **entregue**, e não por mês de calendário: duas
            vigências no mesmo mês aparecem pelo dia, uma ao lado da outra, nunca
            somadas — somá-las inventaria uma vigência que ninguém entregou.

            É o gráfico do Dashboard, o mesmo componente e a mesma série — esta
            dobra não é uma quinta verdade sobre o mesmo dado.
          */}
          {/*
            Só o título aqui. O gráfico escreve a própria linha de subtítulo, e a
            que havia neste lugar começava com as mesmas três palavras.
          */}
          <CabecalhoDaSuperficie titulo="Impacto das alterações por vigência" className="mb-1" />
          <GraficoDeImpacto
            pontos={pontos}
            periodicity={periodicityDaSerie ?? periodicidade}
            carregando={serieCarregando}
            vigenciaAtiva={vigenciaAberta}
            onEscolherVigencia={(periodo) => onTrocar({ period: periodo })}
            janela={janelaAberta}
            onJanela={setJanelaAberta}
          />
          {/*
            A leitura por tipo de ativo — cavalo, carreta, trecho — **não** é um
            controle deste cartão, e essa é uma correção à proposta original.

            Trocar o tipo troca a **população** de todo número, e não o recorte de
            um gráfico: com "Carreta" ligado aqui, esta dobra falaria de carretas
            enquanto o resto da tela continuaria falando da frota inteira, sem
            nada acusando a divergência — exatamente a classe de defeito que o
            Panorama existe para desfazer.

            A Linha do Tempo pode fazê-lo porque lá o tipo é aba **de página**: a
            tela inteira troca de população junto. Daí o link, e não a pastilha.
          */}
          <p className="text-xs text-muted-foreground mt-4 pt-4 border-t flex items-center gap-1.5 flex-wrap">
            <History className="w-3.5 h-3.5 shrink-0" />
            Para ler este mesmo histórico por tipo de ativo — a população inteira trocada, e não só
            este gráfico —
            <Link
              href={consulta.toString() ? `${LINHA_DO_TEMPO}?${consulta}` : LINHA_DO_TEMPO}
              className="font-semibold text-brand hover:underline"
            >
              abra a Linha do Tempo
            </Link>
            .
          </p>
        </Superficie>

        {/*
          À direita do gráfico, a leitura da **mesma** janela — e não a da
          competência aberta, que mora na dobra 3. As duas podem discordar, e é
          bom que discordem: o parâmetro que dominou esta quinzena pode ser
          estreante, e o que sangra há seis vigências pode não ter se mexido
          nesta. Ver `components/panorama/o-que-puxou.tsx`.

          Sem janela a faixa vira uma coluna só: é o caso da Visão Geral, onde o
          intervalo soma unidade a unidade e não tem rollup de parâmetro para
          oferecer.
        */}
        {comJanela && (
          <OQuePuxou janela={janela} carregando={serieCarregando || intervalo.carregando} />
        )}
      </div>
      {/* ---- Dobra 3 · de onde vem ---- */}
      {/*
        Duas colunas, e cada uma responde uma metade da pergunta: a ponte diz
        **como o número se formou** (a escada de famílias até o líquido), e o
        ranking ao lado diz **onde ele se mexeu**, em dois grãos.

        Eram três cartões de largura inteira aqui: a ponte, os dois pódios de
        família e a lista de parâmetros — quatro blocos, ~1.900px, todos lendo a
        mesma lista de famílias. Os três últimos viraram um
        (`components/panorama/ranking.tsx`), porque o que os separava eram duas
        escolhas, e escolha é chave: `?grao=` e `?mudancas=`.

        Esta é a **última** dobra de leitura, e é onde ela pertence: quem desce
        até aqui já sabe quanto custou (dobra 1) e se a vigência é fora do
        normal (dobra 2), e o que vem agora é a decomposição — o degrau em que
        se para de ler e se começa a investigar, com as gavetas abrindo daqui.

        3 e 2 de cinco, e não a metade: a ponte é um desenho com escala e
        rótulos de eixo, e o ranking é uma lista de texto — dar a mesma largura
        às duas faria a escada apertar para sobrar espaço em branco na lista.
      */}
      {/*
        As colunas esticam juntas, e o cartão de lista preenche a sua.

        Esticá-las foi a primeira tentativa e deu errado — a lista de duas linhas
        ganhava um vão dentro da própria borda —, então elas passaram a parar na
        altura do próprio conteúdo, e aí o custo apareceu embaixo da coluna
        curta: ~200px de fundo de página entre a lista e a faixa seguinte.

        O conserto são as duas coisas juntas, e não uma delas: a coluna estica
        **e** a lista reparte a folga entre as linhas (ver
        `components/panorama/ranking.tsx`). Nenhuma das duas sozinha resolve.
      */}
      <div className="grid gap-5 xl:grid-cols-5">
        <Superficie className="px-6 py-5 min-w-0 xl:col-span-3">
          <CabecalhoDaSuperficie
            titulo="Composição do impacto líquido"
            descricao="De onde vem o resultado apurado desta vigência"
            acao={<span className={cn(BOTAO_DE_TROCA, "cursor-default")}>{DECOMPOSICOES.familia}</span>}
          />
          {ponte && ponte.degraus.length > 0 ? (
            <PonteDoImpactoGrafico
              ponte={ponte}
              onAbrirFamilia={view ? (code) => onTrocar({ familia: code, impacto: null }) : null}
              /*
                A regra de densidade: a altura segue o que há para desenhar.

                300px é a altura de uma escada de oito ou dez degraus. Uma
                vigência com uma família apurada desenha duas barras — a família
                e o líquido —, e ali 300px é altura gasta em branco entre o topo
                das barras e a borda do cartão.
              */
              altura={ponte.degraus.length <= 2 ? 220 : 300}
              className="mt-5"
            />
          ) : (
            /*
              O vazio deixou de ser uma linha cinza no meio de uma faixa alta de
              cartão. Uma frase solta em `py-20` é lida como carregamento que não
              terminou; um bloco com ícone, título e explicação é lido como o que
              é — a tela inteira, sem dado a desenhar.
            */
            <EstadoVazio
              icone={BarChart3}
              titulo="Nenhuma família tem valor apurado nesta vigência"
              descricao="Quando houver alterações com impacto financeiro, a composição aparece aqui por família da remuneração, com o quanto cada uma somou ou tirou do resultado."
            />
          )}
        </Superficie>

        <Ranking
          className="xl:col-span-2"
          linhas={linhasDoRanking}
          grao={grao}
          filtro={filtro}
          periodicidade={periodicidade}
          contagens={contagensDoRanking}
          chaveAberta={grao === "familia" ? familiaAberta : impactoAberto}
          onGrao={(g) => onTrocar({ grao: g === "familia" ? null : g })}
          onFiltro={(f) => onTrocar({ mudancas: f === "todos" ? null : f })}
          onAbrir={
            view
              ? (chave) =>
                  onTrocar(
                    grao === "familia"
                      ? { familia: chave, impacto: null }
                      : { impacto: chave, familia: null },
                  )
              : null
          }
          nota={view ? undefined : NOTA_DA_VISAO_GERAL[grao]}
        />
      </div>
      {/* ---- A faixa dos tipos de ativo ---- */}
      {/*
        "Onde aconteceu" em largura inteira, e não mais ao lado do gráfico.

        Ele pareava com a trajetória por ser curto, não por responder a mesma
        pergunta: a trajetória fala da janela de vigências e ele fala da
        competência aberta. Com o cartão da janela ocupando aquele lugar — a
        leitura da mesma população do gráfico —, este desce para depois da
        decomposição, junto das outras leituras da competência, e ganha a faixa
        inteira: são duas a quatro linhas com um rodapé de frota, que numa
        coluna estreita deixavam o nome do tipo apertado contra a contagem.

        Na Visão Geral é o ranking de unidades que desenha aqui — o mesmo cartão,
        o outro eixo (`mapaDoPanorama`).
      */}
      <Mapa
        mapa={mapa}
        onAbrirUnidade={
          overview ? (chave) => onTrocar({ visaoGeral: null, scopeHash: chave }) : null
        }
      />

      {/* ---- O rodapé · a procedência ---- */}
      {/*
        Dentro de uma unidade o cartão desenha nos seis desfechos — é justamente o
        sumiço calado dele que `estadoDaProcedencia` desfaz. Na Visão Geral ele
        não existe: a procedência é de um recorte, e não há recorte de uma
        unidade debaixo de números que somaram todas.
      */}
      {view !== null && (
        <Procedencia estado={procedencia} onTentarDeNovo={onRelerProcedencia} />
      )}

      {/*
        E a última linha da tela: a travessia para o quadro de pessoal.

        Depois da procedência porque é o fim da leitura — respondidas as seis
        perguntas desta competência, o que sobra é para onde ir. Ela é faixa e
        não cartão, e cada linha traz a vigência do próprio quadro colada no
        número: ver `lib/travessia-do-quadro.ts` para o motivo de o QLP não ser
        uma linha do ranking do "onde aconteceu".
      */}
      <TravessiaDoQuadro linhas={travessia} />

      {/* As gavetas — as mesmas do Impacto Apurado, sobre o mesmo recorte. */}
      {view && detalheFamilia && (
        <DetalheDaFamilia
          detalhe={detalheFamilia}
          period={view.period}
          periodLabel={view.periodLabel}
          recorte={{ ...recorte, period: view.period }}
          unidades={unidadesDoDrill}
          vigencia={view.period}
          onFechar={() => onTrocar({ familia: null })}
        />
      )}
      {view && detalheImpacto && (
        <DetalheDoImpacto
          detalhe={detalheImpacto}
          period={view.period}
          periodLabel={view.periodLabel}
          recorte={{ ...recorte, period: view.period }}
          onFechar={() => onTrocar({ impacto: null })}
        />
      )}
    </>
  );
}

/**
 * Por que o ranking não abre em Visão Geral — **uma frase por grão**.
 *
 * A gaveta de uma família (`DetalheDaFamilia`) desce até o parâmetro e, dentro
 * dele, até a placa — e placa é de uma unidade. Somadas as unidades, o número da
 * linha é verdadeiro e a gaveta dele não teria a quem perguntar. A linha deixa
 * de ser botão, e o cartão diz por quê em vez de deixar o clique morrer em
 * silêncio.
 *
 * As duas frases não são a mesma porque o que falta não é o mesmo: no grão da
 * família falta o contexto da placa; no do parâmetro falta a árvore inteira, que
 * o overview não responde.
 */
const NOTA_DA_VISAO_GERAL: Record<GraoDoRanking, string> = {
  familia:
    "Em Visão Geral os números somam as unidades e não abrem por dentro: de onde vem o impacto de uma família só existe dentro de um contexto.",
  parametro:
    "Em Visão Geral a lista soma as unidades e não abre por dentro: o detalhe de um parâmetro só existe dentro de um contexto.",
};

/**
 * Quantas linhas o ranking publica.
 *
 * Cinco era o teto dos pódios e seis o da lista de parâmetros — dois tetos para
 * a mesma lista, herdados de dois cartões. Seis aqui porque o cartão agora
 * divide a dobra com a ponte, e é a altura da escada que ele precisa acompanhar
 * para as duas colunas fecharem juntas.
 */
const LINHAS_DO_RANKING = 6;

/** O endereço das alterações sem preço — a população que a faixa de cobertura conta. */
function linkDasSemPreco(recorte: Recorte): string {
  const params = new URLSearchParams();
  if (recorte.period) params.set("period", recorte.period);
  if (recorte.scopeHash) params.set("scopeHash", recorte.scopeHash);
  if (recorte.canal !== null) params.set("canal", recorte.canal);
  params.set("impactConfidence", "NOT_CALCULABLE");
  return `/alteracoes?${params}`;
}

/** O recorte da lista de mudanças, lido da URL — colável, como o resto do produto. */
function filtroAberto(parametros: URLSearchParams): FiltroDeMudanca {
  const pedido = parametros.get("mudancas");
  return filtroDeMudancaValido(pedido) ? pedido : "todos";
}

/**
 * Quando os dados em tela foram buscados.
 *
 * `dataUpdatedAt` da própria consulta, e nunca um `new Date()` fabricado aqui:
 * ele diz quando a resposta chegou, e não que horas são agora — a mesma leitura
 * que a Gestão à Vista e os outros módulos publicam.
 */
function UltimaAtualizacao({ quando }: { quando: number }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground mt-3">
      <Clock className="w-3.5 h-3.5 shrink-0" />
      {quando === 0
        ? "aguardando a primeira resposta…"
        : `Dados atualizados às ${new Date(quando).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}`}
    </p>
  );
}

/**
 * O carregamento — o esqueleto dos andares, e não uma frase.
 *
 * "Carregando o Panorama…" numa página em branco não diz o que vem: quem abre
 * a tela fica sem saber se o que chega é um número, uma tabela ou um erro, e a
 * página salta inteira quando o conteúdo entra. O esqueleto desenha a forma dos
 * duas primeiras dobras — a manchete e as duas colunas da composição —, de modo
 * que a chegada do dado preenche uma silhueta que já estava no lugar certo.
 *
 * Ele é `aria-hidden` com um `role="status"` ao lado: para quem lê a tela por
 * áudio, seis retângulos cinzas não são informação nenhuma — a frase é.
 */
function Carregando() {
  return (
    <div className="space-y-5">
      <span role="status" className="sr-only">
        Carregando o Panorama…
      </span>
      <div aria-hidden className="superficie px-6 py-6 md:px-7 md:py-7">
        <div className="flex gap-5">
          <div className="w-14 h-14 rounded-2xl bg-muted animate-pulse shrink-0 hidden sm:block" />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="h-3 w-40 rounded bg-muted animate-pulse" />
            <div className="h-10 w-64 max-w-full rounded bg-muted animate-pulse" />
            <div className="h-3 w-52 rounded bg-muted animate-pulse" />
          </div>
        </div>
      </div>
      <div aria-hidden className="grid gap-5 xl:grid-cols-5">
        <div className="superficie px-6 py-5 space-y-4 xl:col-span-3">
          <div className="h-3 w-48 rounded bg-muted animate-pulse" />
          <div className="h-[220px] rounded-md bg-muted/40 animate-pulse" />
        </div>
        <div className="superficie px-6 py-5 space-y-4 xl:col-span-2">
          <div className="h-3 w-40 rounded bg-muted animate-pulse" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 w-32 rounded bg-muted animate-pulse" />
              <div className="h-1.5 w-full rounded-full bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SemVigencia() {
  return (
    <Superficie>
      <EstadoVazio
        icone={FileSearch}
        titulo="Nenhuma vigência para ler ainda."
        descricao="Envie a primeira planilha em Importações — sem duas vigências não há o que comparar, e sem comparação não há panorama a montar."
      />
    </Superficie>
  );
}
