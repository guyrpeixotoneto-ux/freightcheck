import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Layers,
  Lock,
  Power,
  Search,
} from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AMBIENTES } from "@/lib/ambiente";
import { fetchJson } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  MODULOS,
  chaveDaSecao,
  chaveDoAmbiente,
  modulosPorGrupo,
} from "@/lib/permissoes";
import {
  CHAVE_DOS_MODULOS_UNIVERSAIS,
  useModulosUniversais,
  type ModuloDesligado,
  type ModulosUniversais,
} from "./modulos-universais-consulta";
import { cn } from "@/lib/utils";

/**
 * Módulos universais — o que esta casa usa, e o que ela não usa.
 *
 * As outras duas telas de acesso perguntam sobre gente: Permissões, sobre uma
 * conta; Papéis, sobre um grupo de contas. Esta pergunta sobre a **instalação**
 * — e é a pergunta que faltava. Uma casa que não trabalha com Processos, QLP e
 * Frota tinha de tirar as três de cada papel, uma a uma, e a decisão envelhecia
 * calada: o papel criado na semana seguinte nascia com as três de volta no
 * menu, e ninguém tinha como perceber.
 *
 * **Aqui há dois estados, e não três níveis.** Ligado ou desligado. Desligado
 * quer dizer *para todo mundo*: a chave sai `SEM_ACESSO` na sessão de qualquer
 * conta, nenhum papel a devolve, nenhuma exceção a devolve, e o portão do
 * servidor recusa a escrita dela. Ligado não diz nada — quem decide continua
 * sendo o papel e a exceção, como sempre foi. Dar três níveis a esta camada a
 * faria competir com as outras duas pela mesma resposta; com dois, ela responde
 * uma pergunta que nenhuma delas fazia.
 *
 * **A seção tem chave própria, e é ela que a seção grava.** Isto mudou, e mudou
 * porque a versão anterior tinha um defeito de fábrica: o botão da seção
 * gravava as chaves dos módulos que existiam **naquele instante**, e a seção
 * sumia da lateral por consequência — todos os itens caíam, e o grupo ficava
 * vazio. Bastava um módulo novo entrar na seção para ela voltar inteira ao menu
 * de quem a tinha desligado, porque chave sem linha é chave ligada. Aconteceu
 * três vezes em quatro dias, em setembro de 2026, nas duas seções do topo.
 *
 * Hoje a seção é `#<id>` — uma decisão só, sobre a seção como conceito — e a
 * precedência é: **seção desligada vence módulo ligado**. O módulo que nascer
 * amanhã dentro de uma seção desligada nasce invisível, sem ninguém precisar se
 * lembrar de nada; e para devolver um módulo ao menu, a seção precisa voltar
 * primeiro. O id da seção não sai do título dela (`nav.ts`): a mesma seção já se
 * chamou "Plano de Ação", "Chamados" e "Chamados Ambev" em um mês, e uma chave
 * derivada do rótulo teria apagado a decisão a cada renomeação.
 *
 * **A lista é o próprio menu**, montada em `lib/permissoes.ts` a partir das
 * mesmas funções que desenham as laterais — item novo aparece aqui sozinho, e
 * item que sai do menu deixa de ser oferecido.
 *
 * **Cada clique grava**, como em Permissões e pela mesma razão: desligar uma
 * parte do produto para a casa inteira é ato administrativo, e o histórico
 * abaixo mostra o ato, o autor e a hora assim que ele acontece. Um rascunho não
 * gravado seria uma tela mostrando um menu que ninguém tem.
 *
 * **Configurações não se desliga.** É onde esta tela mora, e uma casa que se
 * desligasse a si mesma só voltaria atrás por dentro do banco. O servidor
 * recusa, e aqui o botão nem é oferecido.
 *
 * ---------------------------------------------------------------------------
 * Por que esta seção voltou, e o que ela tem que a matriz não tem
 * ---------------------------------------------------------------------------
 *
 * Ela foi absorvida por Permissões, que passou a oferecer a mesma decisão como
 * a coluna **Inativar** de cada linha da matriz — e a coluna continua lá, com o
 * mesmo alcance. O que não cabia numa coluna é o que trouxe esta tela de volta:
 * a casa **inteira** num lugar só, com os quatro números do que está fora do
 * ar, o motivo que acompanha o desligamento, o histórico de quem decidiu, e
 * **arquivar** ao lado de cada interruptor.
 *
 * **Arquivar é a decisão sobre a lista, e não sobre o acesso.** Uma casa que
 * não usa dois terços do produto desliga dezenas de chaves e passa a rolar uma
 * lista em que quase tudo está riscado. A chave arquivada sai daqui, vai para a
 * gaveta do fim com quem a arquivou e quando, e volta com um clique — continua
 * fora do ar, e nada é apagado. É a mesma distinção que a `0078` escreveu para
 * a conta arquivada: a decisão é sobre a **vista**, e não sobre a linha.
 *
 * **Arquivar pressupõe estar desligado**, e por isso o botão só existe depois
 * do interruptor cair: o servidor recusa arquivar o que está no ar, e uma tela
 * que oferecesse o gesto ali estaria oferecendo o que ela sabe que será
 * recusado. Ligar de volta apaga a linha, o que desarquiva junto.
 */

const dateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR");

/*
  O catálogo agrupado é montado uma vez, no carregamento do módulo, como o
  próprio `MODULOS`: `modulosPorGrupo()` é pura e a lista não muda enquanto a
  aba estiver aberta. Chamá-la por linha de histórico — são até duzentas — era
  remontar noventa módulos para responder um rótulo.
*/
const SECOES_DO_CATALOGO = modulosPorGrupo();

/**
 * O nome de uma chave na tela — o ambiente por extenso, o módulo pelo rótulo, a
 * seção pelo título dela.
 *
 * O histórico é o principal leitor disto, e é ele que responde "por que esta
 * tela sumiu?" meses depois. Uma linha dizendo `#visao-executiva` obrigaria
 * quem lê a saber que aquilo é um id de seção; dizendo "Seção Visão executiva",
 * não obriga.
 */
function rotuloDaChave(chave: string): string {
  const ambiente = AMBIENTES.find((a) => chaveDoAmbiente(a.id) === chave);
  if (ambiente) return ambiente.nomeCompleto;
  const secao = SECOES_DO_CATALOGO.find((s) => chaveDaSecao(s.secao) === chave);
  if (secao) return `Seção ${secao.grupo}`;
  return MODULOS.find((m) => m.chave === chave)?.rotulo ?? chave;
}

export function PainelDeModulosUniversais() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const podeMexer = me?.role === "ADMIN";

  const consulta = useModulosUniversais();

  const desligadas = useMemo(
    () => new Set((consulta.data?.desligadas ?? []).map((d) => d.chave)),
    [consulta.data],
  );
  const protegidas = useMemo(
    () => new Set(consulta.data?.protegidas ?? []),
    [consulta.data],
  );
  /**
   * O que a casa arquivou — desligado **e** fora desta lista.
   *
   * É um `Map`, e não um `Set`, porque a gaveta não mostra só que a chave está
   * lá: ela diz quem a arquivou e quando, que é o que separa "arquivei" de
   * "sumiu" para quem abrir esta tela em dezembro.
   */
  const arquivadas = useMemo(
    () =>
      new Map(
        (consulta.data?.desligadas ?? [])
          .filter((d) => d.arquivadoEm !== null)
          .map((d) => [d.chave, d] as const),
      ),
    [consulta.data],
  );

  const definir = useMutation({
    /*
      Um escopo, e por isso uma fila: duas mutações do mesmo `scope` não correm
      juntas no React Query.

      Sem ele, cinco cliques em cinco segundos eram cinco `PUT` concorrentes, e
      o `onSuccess` de cada um escreve no cache a **lista inteira** que o
      servidor devolveu. A resposta que chegasse por último vencia, não a que
      tivesse partido por último — e a resposta mais antiga não conhece o
      desligamento mais novo. O efeito na tela é exatamente o sintoma relatado:
      um módulo que acabou de ser desligado volta a aparecer ligado, sem
      ninguém ter tocado nele, com o banco já correto por baixo. Os carimbos da
      captura de 13/09/2026 são de 17:48:22, :23, :24 e :25 — quatro decisões em
      quatro segundos, que é a janela em que isto acontece.

      Enfileirar é a correção certa aqui, e não um desempate por relógio: cada
      `PUT` lê o estado atual antes de decidir o que mudou, então ele precisa
      enxergar o anterior já gravado para o histórico não inventar uma decisão
      que ninguém tomou.
    */
    scope: { id: "modulos-universais" },
    mutationFn: (chaves: Record<string, boolean>) =>
      fetchJson<ModulosUniversais>("/modulos-universais", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chaves,
          motivo: motivo.trim() === "" ? null : motivo.trim(),
        }),
      }),
    onSuccess: (resposta) => {
      setErro(null);
      queryClient.setQueryData(CHAVE_DOS_MODULOS_UNIVERSAIS, resposta);
      /*
        O menu desta aba vem da sessão, e a sessão acabou de mudar de sentido:
        sem esta invalidação, quem desliga o QLP continua vendo o QLP na lateral
        até recarregar a página — e duvidaria, com razão, de que a decisão valeu.
      */
      void queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
    },
    onError: (err: Error) => setErro(err.message),
  });

  /**
   * Arquivar e desarquivar — a mesma fila de `definir`, e uma rota própria.
   *
   * O escopo é o mesmo porque a decisão é uma só para a instalação inteira, e a
   * rota é outra porque os dois gestos têm tamanhos diferentes: desligar muda o
   * menu de todo mundo; arquivar arruma esta lista e não muda o menu de
   * ninguém. É também por isso que a sessão **não** é invalidada aqui — não há
   * mudança de menu para ela refletir.
   */
  const arquivar = useMutation({
    scope: { id: "modulos-universais" },
    mutationFn: (chaves: Record<string, boolean>) =>
      fetchJson<ModulosUniversais>("/modulos-universais/arquivadas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chaves }),
      }),
    onSuccess: (resposta) => {
      setErro(null);
      queryClient.setQueryData(CHAVE_DOS_MODULOS_UNIVERSAIS, resposta);
    },
    onError: (err: Error) => setErro(err.message),
  });

  /**
   * As seções da tela, com os itens que a busca deixou passar.
   *
   * `itens` é o que se **mostra**; `total` é o tamanho real da seção. Os dois
   * existem separados de propósito: enquanto a ação da seção gravava as chaves
   * dos itens, ela agia sobre a lista filtrada — buscar "DRE" e clicar em
   * "Desligar a seção" desligava a DRE e dizia ter desligado a Visão executiva.
   *
   * Hoje a ação da seção é **uma chave só** (`#visao-executiva`), então o filtro
   * não tem como estreitar o alcance dela — nem por acidente nem por descuido de
   * quem mexer aqui depois. `total` continua sendo lido para a tela poder dizer
   * quantos itens a busca está escondendo, que é a outra metade do problema:
   * agir sobre a seção inteira é certo, e deixar isso implícito não é.
   */
  const secoes = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return SECOES_DO_CATALOGO
      /* A seção arquivada sai inteira, com os módulos dela: ela é uma chave só
         (`#<id>`), e foi essa chave que alguém tirou da vista. */
      .filter((secao) => !arquivadas.has(chaveDaSecao(secao.secao)))
      .map((secao) => {
        /*
          O módulo arquivado sai antes da busca, e antes do `total`.

          `total` é o denominador de duas frases desta tela — "N de M módulos
          ligados" e "a busca está escondendo N de M" —, e um M que contasse os
          arquivados faria as duas falarem de módulos que a tela não mostra em
          busca nenhuma. Arquivado não está escondido pela busca: está guardado
          na gaveta, e o interruptor da seção continua valendo sobre ele.
        */
        const naLista = secao.itens.filter((m) => !arquivadas.has(m.chave));
        return {
          ...secao,
          total: naLista.length,
          /** A seção como ela está na lista — a busca não a encolhe. */
          todos: naLista,
          itens: naLista.filter(
            (m) =>
              termo === "" ||
              m.rotulo.toLowerCase().includes(termo) ||
              m.chave.toLowerCase().includes(termo) ||
              secao.grupo.toLowerCase().includes(termo),
          ),
        };
      })
      .filter((secao) => secao.itens.length > 0);
  }, [arquivadas, busca]);

  const ambientesNaTela = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const naLista = AMBIENTES.filter((a) => !arquivadas.has(chaveDoAmbiente(a.id)));
    if (termo === "") return naLista;
    return naLista.filter(
      (a) =>
        a.nomeCompleto.toLowerCase().includes(termo) ||
        a.nome.toLowerCase().includes(termo) ||
        a.id.includes(termo),
    );
  }, [arquivadas, busca]);

  /*
    A contagem é do que está **fora do ar**, e não do que tem linha no banco: um
    módulo cuja seção foi desligada não aparece para ninguém, e contá-lo como
    ligado faria o número da tela discordar do menu que ela descreve.
  */
  const desligadasNoMenu = MODULOS.filter(
    (m) => desligadas.has(m.chave) || desligadas.has(chaveDaSecao(m.secao)),
  ).length;
  const secoesDesligadas = SECOES_DO_CATALOGO.filter((s) =>
    desligadas.has(chaveDaSecao(s.secao)),
  ).length;
  const ambientesDesligados = AMBIENTES.filter((a) =>
    desligadas.has(chaveDoAmbiente(a.id)),
  ).length;

  const bloqueado = !podeMexer || definir.isPending || arquivar.isPending;

  return (
    <div className="space-y-6 max-w-5xl">
      <p className="flex items-start gap-2 text-sm text-muted-foreground max-w-3xl">
        <Power className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
        <span>
          Esta é a decisão da <strong>casa</strong>, e não a de uma pessoa: o que
          for desligado aqui não aparece no menu de <strong>ninguém</strong> —
          nem de quem administra — e nenhuma permissão o devolve. O que fica
          ligado continua sendo decidido em Papéis e Permissões, como sempre.
          Desligar uma seção inteira desliga os módulos dela, e a seção some da
          lateral.
        </span>
      </p>

      {consulta.error !== null && (
        <ApiErrorNotice
          error={consulta.error}
          what="A lista de módulos da instalação não pôde ser carregada."
        />
      )}

      {erro && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-900">
          {erro}
        </p>
      )}

      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex items-center gap-4 text-sm">
              <Contagem
                numero={desligadasNoMenu}
                rotulo="módulos desligados"
                cor={desligadasNoMenu > 0 ? "text-rose-700" : "text-muted-foreground"}
              />
              <Contagem
                numero={MODULOS.length - desligadasNoMenu}
                rotulo="ligados"
                cor="text-emerald-700"
              />
              <Contagem
                numero={secoesDesligadas}
                rotulo="seções desligadas"
                cor={secoesDesligadas > 0 ? "text-rose-700" : "text-muted-foreground"}
              />
              <Contagem
                numero={ambientesDesligados}
                rotulo="ambientes desligados"
                cor={
                  ambientesDesligados > 0 ? "text-rose-700" : "text-muted-foreground"
                }
              />
              {/*
                O quinto número conta o que saiu **da lista**, e não do ar: os
                arquivados já estão dentro dos quatro de cima — arquivar não
                desliga nada. Ele existe para a lista encolhida não parecer
                perda: quem vê "12 arquivados" sabe onde os doze estão.
              */}
              <Contagem
                numero={arquivadas.size}
                rotulo="arquivados"
                cor={arquivadas.size > 0 ? "text-foreground" : "text-muted-foreground"}
              />
            </div>

            <span className="relative ml-auto">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar seção ou módulo…"
                className="h-9 w-56 pl-8"
              />
            </span>
          </div>

          {!podeMexer && (
            <p className="text-sm text-muted-foreground">
              A sua conta é de operador: esta lista é leitura. Quem liga e desliga
              partes do produto é um administrador.
            </p>
          )}

          {podeMexer && (
            /*
              O motivo acompanha o desligamento, e não a chave: quem desliga
              Processos, QLP e Frota na mesma sessão está dizendo a mesma coisa
              sobre as três. Ele é opcional porque a decisão vale sem ele — e
              existe porque a pergunta de meses depois ("por que esta tela
              sumiu?") é respondida por esta linha, e não pelo carimbo.
            */
            <div className="space-y-1.5 max-w-xl">
              <Label htmlFor="motivo">Motivo (opcional)</Label>
              <Input
                id="motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex.: esta operação não usa QLP nem Frota."
              />
              <p className="text-xs text-muted-foreground">
                Fica gravado com cada desligamento feito daqui em diante, no
                histórico do fim da página.
              </p>
            </div>
          )}

          {consulta.isLoading && (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          )}

          {/*
            Sem resposta do servidor, a tela não desenha interruptor nenhum.

            `desligadas` nasce de `consulta.data?.desligadas ?? []`, e um
            conjunto vazio faz **todo** interruptor aparecer ligado. Com a
            lista desenhada nesse estado, uma leitura que falhou é
            indistinguível de uma casa que não desligou nada — a interface
            afirmaria "tudo no ar" justamente quando não sabe. O aviso de erro
            acima continua dizendo o que aconteceu; o que sai daqui é o palpite.
          */}
          {!consulta.isLoading && consulta.data === undefined && (
            <p className="rounded-md border p-6 text-sm text-muted-foreground">
              O que esta casa desligou não pôde ser lido — e por isso nada é
              mostrado aqui. Um interruptor ligado nesta tela significaria que a
              decisão foi lida e é essa; sem a leitura, não há o que afirmar.
            </p>
          )}

          {!consulta.isLoading && consulta.data !== undefined && ambientesNaTela.length > 0 && (
            <div className="rounded-md border">
              <div className="flex items-center gap-2 bg-muted/50 px-4 py-2">
                <Layers className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Ambientes de trabalho
                </span>
                <span className="text-xs text-muted-foreground">
                  {ambientesNaTela.length} de {AMBIENTES.length}
                </span>
              </div>
              <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                Um ambiente desligado sai do seletor do topo para todo mundo, e
                nenhuma tela dele abre — é para a casa que não opera aquele
                processo.
              </p>
              {ambientesNaTela.map((ambiente) => {
                const chave = chaveDoAmbiente(ambiente.id);
                return (
                  <Linha
                    key={ambiente.id}
                    titulo={ambiente.nomeCompleto}
                    subtitulo={ambiente.descricao}
                    chave={chave}
                    ligado={!desligadas.has(chave)}
                    protegida={protegidas.has(chave)}
                    desabilitado={bloqueado}
                    desligamento={
                      consulta.data?.desligadas.find((d) => d.chave === chave) ??
                      null
                    }
                    aoAlternar={(ligado) => definir.mutate({ [chave]: ligado })}
                    aoArquivar={
                      podeMexer
                        ? () => arquivar.mutate({ [chave]: true })
                        : undefined
                    }
                  />
                );
              })}
            </div>
          )}

          {!consulta.isLoading &&
            consulta.data !== undefined &&
            secoes.map((secao) => {
              const chaveDela = chaveDaSecao(secao.secao);
              const secaoLigada = !desligadas.has(chaveDela);
              /*
                A seção protegida é a Administração, que tem `/configuracoes`
                dentro: desligá-la esconderia esta tela sem tocar na chave dele,
                e o servidor recusa com 409. O interruptor dela não é oferecido.
              */
              const secaoProtegida = protegidas.has(chaveDela);
              /*
                A contagem é sobre a seção inteira (`todos`), e não sobre o que a
                busca deixou na tela: um número que mudasse ao digitar diria que
                a decisão mudou junto.
              */
              const ligadosNaSecao = secao.todos.filter(
                (m) => !desligadas.has(m.chave),
              ).length;
              const escondidosPelaBusca = secao.total - secao.itens.length;
              return (
                <div key={`${secao.ambiente}|${secao.secao}`} className="rounded-md border">
                  <div className="flex flex-wrap items-center gap-2 bg-muted/50 px-4 py-2">
                    <span
                      className={cn(
                        "text-xs font-semibold uppercase tracking-wide",
                        secaoLigada ? "text-muted-foreground" : "text-rose-700 line-through",
                      )}
                    >
                      {secao.grupo}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {secao.ambiente} ·{" "}
                      {secaoLigada
                        ? `${ligadosNaSecao} de ${secao.total} módulos ligados`
                        : `${secao.total} módulos fora do ar pela seção`}
                    </span>
                    {secaoProtegida ? (
                      <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-muted-foreground">
                        <Lock className="h-2.5 w-2.5" />
                        Seção sempre ligada
                      </span>
                    ) : (
                      /*
                        Um interruptor, e não mais o botão que gravava as chaves
                        dos módulos um a um. A diferença é o que a decisão
                        alcança: o botão escrevia sobre os itens que existiam
                        naquele instante — e, com busca ativa, só sobre os que
                        estavam na tela. Este escreve `#<seção>`, que é a seção
                        como conceito: vale para o módulo que nasce amanhã dentro
                        dela e não tem como ser estreitado por um filtro visual.
                      */
                      <span className="ml-auto flex items-center gap-2">
                        {!secaoLigada && podeMexer && (
                          /*
                            Ao lado do interruptor, e só com ele em baixo: é a
                            ordem dos gestos — tira-se do ar, e só então se tira
                            da lista. A seção arquivada leva os módulos dela
                            junto, porque é a seção que sai da vista.
                          */
                          <BotaoArquivar
                            chave={chaveDela}
                            rotulo={`a seção ${secao.grupo}`}
                            desabilitado={bloqueado}
                            aoArquivar={() => arquivar.mutate({ [chaveDela]: true })}
                          />
                        )}
                        <span className="text-xs text-muted-foreground">
                          {secaoLigada ? "Seção no ar" : "Seção desligada"}
                        </span>
                        <Switch
                          checked={secaoLigada}
                          disabled={bloqueado}
                          aria-label={`${secaoLigada ? "Desligar" : "Ligar"} a seção ${secao.grupo} inteira para todos os usuários`}
                          onCheckedChange={(valor) =>
                            definir.mutate({ [chaveDela]: valor })
                          }
                          data-testid={`switch-secao-${secao.secao}`}
                        />
                      </span>
                    )}
                  </div>
                  {!secaoLigada && (
                    <p className="border-t bg-rose-50/60 px-4 py-2 text-xs text-rose-900">
                      A seção inteira está fora do ar — inclusive os módulos que
                      entrarem nela depois. Os interruptores abaixo continuam
                      guardando a decisão de cada módulo, e voltam a valer quando a
                      seção voltar.
                    </p>
                  )}
                  {escondidosPelaBusca > 0 && (
                    /*
                      A busca esconde itens, e a ação da seção não os poupa — ela
                      é sobre a seção. Dizer isso é o que impede a tela de
                      parecer que o filtro delimitou a decisão.
                    */
                    <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                      A busca está escondendo {escondidosPelaBusca} de{" "}
                      {secao.total} módulos desta seção. O interruptor da seção
                      vale para os {secao.total}.
                    </p>
                  )}
                  {secao.itens.map((modulo) => (
                    <Linha
                      key={modulo.chave}
                      titulo={modulo.rotulo}
                      subtitulo={modulo.chave}
                      chave={modulo.chave}
                      ligado={!desligadas.has(modulo.chave)}
                      protegida={protegidas.has(modulo.chave)}
                      /*
                        Com a seção desligada, o módulo não está no ar qualquer
                        que seja o interruptor dele — e a tela diz isso em vez de
                        oferecer um gesto que não muda nada. Para devolver um
                        módulo ao menu, a seção precisa voltar primeiro.
                      */
                      forcadoPelaSecao={!secaoLigada}
                      desabilitado={bloqueado}
                      desligamento={
                        consulta.data?.desligadas.find(
                          (d) => d.chave === modulo.chave,
                        ) ?? null
                      }
                      aoAlternar={(ligado) =>
                        definir.mutate({ [modulo.chave]: ligado })
                      }
                      aoArquivar={
                        podeMexer
                          ? () => arquivar.mutate({ [modulo.chave]: true })
                          : undefined
                      }
                    />
                  ))}
                </div>
              );
            })}

          {!consulta.isLoading &&
            consulta.data !== undefined &&
            secoes.length === 0 &&
            ambientesNaTela.length === 0 && (
            <p className="rounded-md border p-6 text-sm text-muted-foreground">
              Nenhuma seção ou módulo com esse nome.
            </p>
          )}

          {!consulta.isLoading && arquivadas.size > 0 && (
            <GavetaDeArquivados
              arquivadas={[...arquivadas.values()]}
              desabilitado={bloqueado}
              aoDesarquivar={
                podeMexer
                  ? (chave) => arquivar.mutate({ [chave]: false })
                  : undefined
              }
            />
          )}

          <Historico linhas={consulta.data?.historico ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}

function Linha({
  titulo,
  subtitulo,
  chave,
  ligado,
  protegida,
  forcadoPelaSecao = false,
  desabilitado,
  desligamento,
  aoAlternar,
  aoArquivar,
}: {
  titulo: string;
  subtitulo: string;
  chave: string;
  ligado: boolean;
  protegida: boolean;
  /**
   * A seção deste módulo está desligada — então ele não está no ar, qualquer
   * que seja o interruptor dele.
   *
   * O interruptor continua **mostrando** a decisão de módulo, e não é
   * sobrescrito: ela volta a valer quando a seção voltar, e apagá-la aqui faria
   * ligar a seção devolver ao menu módulos que alguém tinha tirado um a um. O
   * que ele não faz é aceitar clique — um gesto que não muda o que se vê é pior
   * do que um gesto ausente.
   */
  forcadoPelaSecao?: boolean;
  desabilitado: boolean;
  desligamento: ModuloDesligado | null;
  aoAlternar: (ligado: boolean) => void;
  /**
   * Tirar esta chave da lista. Ausente para quem não administra — e sem efeito
   * sobre o que está no ar, que é o que o servidor recusaria.
   */
  aoArquivar?: () => void;
}) {
  const noAr = ligado && !forcadoPelaSecao;
  return (
    <div className="flex flex-wrap items-center gap-3 border-t px-4 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "text-sm font-semibold",
              !noAr && "text-muted-foreground line-through",
            )}
          >
            {titulo}
          </span>
          {protegida && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-muted-foreground">
              <Lock className="h-2.5 w-2.5" />
              Sempre ligado
            </span>
          )}
        </span>
        <span className="block text-xs text-muted-foreground">{subtitulo}</span>
        {protegida && (
          <span className="block text-xs text-muted-foreground/80">
            É onde esta tela mora: desligá-lo tiraria de todo mundo a porta de
            voltar atrás.
          </span>
        )}
        {forcadoPelaSecao && (
          <span className="block text-xs text-rose-700">
            Fora do ar pela seção{ligado ? "" : ", e desligado por conta própria também"}
            {" "}· para devolvê-lo ao menu, ligue a seção primeiro
          </span>
        )}
        {!ligado && desligamento && (
          <span className="block text-xs text-rose-700">
            Desligado para todo mundo · {desligamento.desligadoPor} ·{" "}
            {dateTime(desligamento.desligadoEm)}
            {desligamento.motivo ? ` · ${desligamento.motivo}` : ""}
          </span>
        )}
      </span>
      {aoArquivar !== undefined && !ligado && !protegida && !forcadoPelaSecao && (
        /*
          Só sobre chave desligada, e à esquerda do interruptor: a ordem dos
          dois é a ordem dos gestos — tira-se do ar, e só então se tira da
          lista. Sobre um módulo que a seção derrubou o botão não aparece: a
          decisão dele não é dele, e arquivá-lo esconderia uma linha que volta
          ao ar assim que a seção voltar.
        */
        <BotaoArquivar
          chave={chave}
          rotulo={titulo}
          desabilitado={desabilitado}
          aoArquivar={aoArquivar}
        />
      )}
      <Switch
        checked={ligado}
        disabled={desabilitado || protegida || forcadoPelaSecao}
        aria-label={`${ligado ? "Desligar" : "Ligar"} ${titulo} para todos os usuários`}
        onCheckedChange={(valor) => aoAlternar(valor)}
        data-testid={`switch-universal-${chave}`}
      />
    </div>
  );
}

/**
 * Arquivar — a decisão sobre a **lista**, e não sobre o acesso.
 *
 * Discreto de propósito: ele não muda o menu de ninguém, não tira nada do ar e
 * não apaga linha nenhuma. O `title` diz isso inteiro, porque quem clica aqui
 * esperando "excluir" precisa descobrir antes, e não depois, que a decisão
 * continua guardada — e que ela volta com um clique.
 */
function BotaoArquivar({
  chave,
  rotulo,
  desabilitado,
  aoArquivar,
}: {
  chave: string;
  rotulo: string;
  desabilitado: boolean;
  aoArquivar: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 px-2 text-muted-foreground"
      disabled={desabilitado}
      title={`Arquivar ${rotulo}: sai desta lista e vai para a gaveta de arquivados. Continua fora do ar, nada é apagado, e volta com um clique.`}
      onClick={aoArquivar}
      data-testid={`arquivar-${chave}`}
    >
      <Archive className="mr-1.5 h-3.5 w-3.5" />
      Arquivar
    </Button>
  );
}

/**
 * A gaveta dos arquivados — o que saiu da lista, e o caminho de volta.
 *
 * Fechada por padrão, e com o número no rótulo: é o que faz a lista encolher de
 * verdade. Aberta, cada linha diz **o que era**, **quem arquivou** e **quando**
 * — sem isso, arquivar seria indistinguível de apagar para quem chegasse
 * depois, que é exatamente a dúvida que este gesto existe para não deixar no
 * ar. O motivo do desligamento vem junto, porque é ele que responde "por quê".
 *
 * Não há botão de esvaziar, e não é esquecimento: não existe apagar nesta
 * camada. Uma chave sai da gaveta de um jeito só — voltando para a lista.
 */
function GavetaDeArquivados({
  arquivadas,
  desabilitado,
  aoDesarquivar,
}: {
  arquivadas: readonly ModuloDesligado[];
  desabilitado: boolean;
  aoDesarquivar?: (chave: string) => void;
}) {
  const [aberta, setAberta] = useState(false);
  const emOrdem = [...arquivadas].sort((a, b) =>
    rotuloDaChave(a.chave).localeCompare(rotuloDaChave(b.chave), "pt-BR"),
  );

  return (
    <div className="rounded-md border">
      <button
        type="button"
        aria-expanded={aberta}
        onClick={() => setAberta((antes) => !antes)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/50"
        data-testid="gaveta-de-arquivados"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform",
            aberta && "rotate-90",
          )}
        />
        <Archive className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Arquivados
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {emOrdem.length}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          Fora da lista e fora do ar — nada foi apagado.
        </span>
      </button>

      {aberta && (
        <div className="divide-y border-t">
          {emOrdem.map((linha) => (
            <div
              key={linha.chave}
              className="flex flex-wrap items-center gap-3 px-4 py-2.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-muted-foreground">
                  {rotuloDaChave(linha.chave)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {linha.chave} · arquivado por {linha.arquivadoPor} ·{" "}
                  {linha.arquivadoEm === null ? "" : dateTime(linha.arquivadoEm)}
                  {linha.motivo ? ` · ${linha.motivo}` : ""}
                </span>
              </span>
              {aoDesarquivar !== undefined && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={desabilitado}
                  title={`Devolver ${rotuloDaChave(linha.chave)} à lista — ele continua fora do ar`}
                  onClick={() => aoDesarquivar(linha.chave)}
                  data-testid={`desarquivar-${linha.chave}`}
                >
                  <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" />
                  Desarquivar
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Contagem({
  numero,
  rotulo,
  cor,
}: {
  numero: number;
  rotulo: string;
  cor: string;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={cn("text-lg font-bold tabular-nums", cor)}>{numero}</span>
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </span>
    </span>
  );
}

/**
 * O que a casa ligou e desligou, com autor e hora.
 *
 * É a única resposta para "quem tirou o QLP do menu, e quando" — a pergunta que
 * aparece semanas depois, quando alguém não acha mais uma tela e ninguém lembra
 * de ter mexido. Não é apagado por nenhuma ação da interface.
 */
function Historico({
  linhas,
}: {
  linhas: ModulosUniversais["historico"];
}) {
  if (linhas.length === 0) {
    return (
      <p className="text-xs text-muted-foreground border-t pt-3">
        Nada foi desligado nesta instalação — o produto inteiro está no ar, e
        quem alcança o quê é decidido em Papéis e Permissões.
      </p>
    );
  }

  return (
    <div className="border-t pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        O que a casa ligou e desligou
      </p>
      <ul className="space-y-1.5">
        {linhas.slice(0, 12).map((linha, indice) => (
          <li
            key={`${linha.em}|${linha.chave}|${indice}`}
            className="text-xs text-muted-foreground"
          >
            <span className="font-medium text-foreground">
              {rotuloDaChave(linha.chave)}
            </span>{" "}
            {/*
              Quatro decisões cabem numa linha só, e `arquivado` é quem separa
              as duas famílias: nulo, o evento falou do ar; preenchido, falou da
              lista. Ler `ligado` sozinho diria "desligado" sobre um evento em
              que ninguém desligou nada.
            */}
            {linha.arquivado === null
              ? linha.ligado
                ? "ligado"
                : "desligado para todo mundo"
              : linha.arquivado
                ? "arquivado — fora da lista, e segue fora do ar"
                : "devolvido à lista"}{" "}
            · {linha.por}{" "}
            · {dateTime(linha.em)}
            {linha.motivo ? ` · ${linha.motivo}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
