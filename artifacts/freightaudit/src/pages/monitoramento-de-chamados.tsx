import { useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  CalendarSearch,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileSpreadsheet,
  Headset,
  Layers,
  MapPin,
  RefreshCw,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { AbaBotao, MetricCard } from "@/components/changes/cartoes";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Paginacao } from "@/components/ui/paginacao";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReguaDeDias } from "@/components/monitoramento/regua-de-dias";
import { ResumoDoDiaPainel } from "@/components/monitoramento/resumo-do-dia";
import { ListaDeMovimentacoes } from "@/components/monitoramento/lista-de-movimentacoes";
import { ListaDeChamados } from "@/components/monitoramento/lista-de-chamados";
import { STATUS_LABELS } from "@/components/changes/ticket-table";
import { cn } from "@/lib/utils";
import {
  contextoAberto,
  unidadeDe,
  useContextosDaCasca,
} from "@/lib/contextos";
import { visaoGeralAtiva } from "@/lib/navegacao-do-escopo";
import {
  recorteDeChamados,
  serieDaUnidade,
  type RecorteDeChamados,
} from "@/lib/serie-da-unidade";
import {
  ABAS,
  ROTULO_DA_ABA,
  ROTULO_DO_TIPO,
  contagemDaAba,
  diaLegivel,
  diaPorExtenso,
  envioForaDaJanela,
  fraseDoDia,
  hojeNaOperacao,
  horaLegivel,
  janelaDoEnvioFora,
  procedenciaDaFila,
  progressoDoDia,
  SEM_SERIE,
  useFilaDoDia,
  useMovimentacoes,
  useResumoDoDia,
  useReguaDeDias,
  useRevisao,
  useSeries,
  type Aba,
  type EnvioForaDaJanela,
  type FiltrosDaTela,
  type Movimentacao,
} from "@/lib/monitoramento-de-chamados";

/**
 * MONITORAMENTO DE CHAMADOS.
 *
 * Os chamados da Ambev entram por importação (`/importacoes?secao=chamados`) e
 * a aba Chamados mostra a fila de **um** envio. Esta tela responde a outra
 * pergunta, que é a que se faz todo dia: **o que mudou desde ontem, e o que
 * disso eu ainda não olhei.**
 *
 * ---------------------------------------------------------------------------
 * O que manda no desenho
 * ---------------------------------------------------------------------------
 *
 * 1. **A régua é a data da importação**, no fuso da operação. Clicar em 02/09 é
 *    pedir as movimentações que as importações daquele dia produziram — não os
 *    chamados abertos naquele dia, que é outra data e outra pergunta.
 *
 * 2. **A unidade da tela é a movimentação**, e uma movimentação é *o chamado que
 *    se mexeu num dia*. Um chamado com três campos alterados é uma linha com
 *    três diferenças; um que se mexeu três vezes hoje é uma linha com três
 *    passos. É o que faz "70 movimentações" querer dizer 70 chamados.
 *
 * 3. **O antes → depois fica na linha.** Escondê-lo atrás de um clique
 *    transformaria revisar setenta movimentações em setenta cliques.
 *
 * 4. **Nada é revisado pela importação.** O selo de revisão só aparece depois de
 *    alguém clicar, e a tela sempre diz quem clicou.
 *
 * A tela abre em três consultas — régua, dia, primeira página —, e nenhuma delas
 * compara nada: o motor já comparou na importação. É o que permite esta ser a
 * página mais acessada do produto sem ser a mais cara.
 *
 * O estado que precisa sobreviver a ir e voltar mora na URL — o dia, a série, a
 * aba —, como as vigências das outras telas e pelo mesmo motivo: um link para
 * "02/09, não revisados" tem de abrir em 02/09, não revisados.
 *
 * ---------------------------------------------------------------------------
 * A unidade é a da lateral, e não a de um seletor só desta tela
 * ---------------------------------------------------------------------------
 *
 * A tela recorta por **série** — a unidade que o export da Ambev nomeia —, e
 * durante um tempo esse recorte só existia aqui dentro: a lateral escrevia
 * PERNAMBUCO e a tela somava as unidades todas, e trocar de unidade na lateral
 * jogava para Parâmetros, porque a tela estava fora de
 * `TELAS_QUE_HONRAM_ESCOPO`. A reclamação, nas palavras de quem a fez: *"eu
 * mudo de PERNAMBUCO para CAMAÇARI e muda o módulo, mas eu quero ver justamente
 * os chamados que importei de Camaçari"*.
 *
 * Agora a unidade aberta na lateral **é** o recorte, e quem casa os dois
 * vocabulários é `lib/serie-da-unidade.ts`. As três consequências, todas
 * visíveis em tela:
 *
 * 1. **Trocar de unidade na lateral não sai daqui** — troca a série, mantém o
 *    dia, e a régua e a lista voltam recortadas.
 * 2. **A unidade sem envio de chamados diz isso** em vez de mostrar o acervo
 *    inteiro embaixo do nome dela. É o mesmo desencontro que a Cobertura de
 *    dados tinha, e a mesma correção.
 * 3. **A soma continua existindo, como escolha**: é a Visão Geral da lateral,
 *    que aqui é `visaoGeral=1` e nada mais — não é o que sobra de não ter
 *    escolhido.
 *
 * O seletor da própria tela continua, porque há série que a lateral não alcança
 * — a do envio **sem unidade no arquivo**, e a da unidade que mandou chamados
 * sem nunca ter mandado vigência. Escolher nele escreve `serie` na URL, que
 * vence a lateral; quando os dois discordam, a tela diz qual está valendo.
 *
 * ---------------------------------------------------------------------------
 * O dia sem movimentação não é um dia sem chamado
 * ---------------------------------------------------------------------------
 *
 * A tela nasceu respondendo só **o que mudou**, e essa é a pergunta certa em
 * quase todo dia. Num dia em que a comparação não achou diferença nenhuma ela
 * era a pergunta errada, e a tela dizia a verdade de um jeito que se lia ao
 * contrário: *"Importação concluída às 07:25. Nenhuma movimentação
 * identificada."* sobre uma lista vazia — enquanto o arquivo daquela manhã
 * tinha trazido 1.218 chamados de CAMAÇARI. Quem opera lia "o import não
 * trouxe nada", que é o oposto do que aconteceu.
 *
 * Daí a segunda visão, no controle segmentado acima da lista:
 *
 * - **Movimentações** — o que mudou. Continua sendo o padrão, e continua sendo
 *   a fila de trabalho revisável.
 * - **Chamados do envio** — a relação inteira que a planilha trouxe, tenha se
 *   mexido ou não, com a procedência do arquivo em cima dela.
 *
 * **As duas não somam.** A segunda é a população de onde a primeira sai, e cada
 * linha da relação diz se aquele chamado está entre as movimentações do dia —
 * que é o que torna conferível, a olho, a afirmação de que vieram 1.218 e
 * nenhum se mexeu. É a mesma disciplina de grãos que a aba Chamados mantém
 * entre parâmetros alterados e chamados.
 *
 * A relação é buscada **só quando alguém a abre**: ela é do tamanho do arquivo,
 * e a abertura da tela continua custando as mesmas três consultas. O número que
 * rotula a visão vem do resumo, que já lê os envios do dia — é assim que a tela
 * consegue oferecer a relação sem antes carregá-la.
 *
 * ---------------------------------------------------------------------------
 * O topo conta a fila, e não o delta
 * ---------------------------------------------------------------------------
 *
 * Pelo mesmo motivo, e uma camada acima: os três cartões contavam
 * movimentações, revisadas e pendentes, e num dia sem movimentação eles eram
 * três zeros sobre o mesmo arquivo de 1.218 chamados. Hoje contam o desfecho
 * que o arquivo declara — **aprovados, em análise, reprovados** —, que é a
 * pergunta que tem resposta em todo dia em que chegou arquivo.
 *
 * O delta não sumiu do topo: a faixa abaixo dos cartões continua trazendo a
 * frase do dia, a barra de progresso e o botão de continuar a revisão, e o
 * painel da direita mantém movimentações e "aguardando revisão". O que mudou é
 * qual dos dois grãos ocupa os três números grandes.
 */

const POR_PAGINA = 25;

/**
 * Os tamanhos que a relação oferece.
 *
 * Menores que os `TAMANHOS_DE_PAGINA` das tabelas de alterações (50/100/300),
 * e de propósito: lá cada linha é um parâmetro e a pessoa varre; aqui cada
 * linha abre em detalhe, e 300 linhas abertas não são uma tela — são um
 * arquivo.
 */
const TAMANHOS_DA_RELACAO = [25, 50, 100];

/**
 * As duas leituras do mesmo dia.
 *
 * `movimentacoes` é **o que mudou** — a fila de trabalho, e a razão de a tela
 * existir. `chamados` é **o que veio no arquivo**, a relação inteira, tenha se
 * mexido ou não.
 *
 * Não são dois recortes da mesma população: a segunda é a população de onde a
 * primeira sai. Somá-las seria contar o mesmo chamado duas vezes, e é por isso
 * que a tela mostra uma de cada vez, com o nome de cada uma no controle.
 */
type Visao = "movimentacoes" | "chamados";

export default function MonitoramentoDeChamados() {
  const [pathname, navegar] = useLocation();
  const busca = useSearch();
  const parametros = useMemo(() => new URLSearchParams(busca), [busca]);

  const hoje = hojeNaOperacao();
  const dia = parametros.get("dia") ?? hoje;
  const fimDaRegua = parametros.get("regua") ?? hoje;
  const serieBruta = parametros.get("serie");
  const aba = ((ABAS as readonly string[]).includes(parametros.get("aba") ?? "")
    ? parametros.get("aba")
    : "TODOS") as Aba;
  /*
    Qual das duas leituras está em tela. Mora na URL como o dia e a aba, e pelo
    mesmo motivo: um link para "16/08, chamados do envio" tem de abrir nos
    chamados do envio. O padrão é `movimentacoes` porque a pergunta de quem abre
    a tela todo dia continua sendo "o que mudou".
  */
  const visao: Visao =
    parametros.get("visao") === "chamados" ? "chamados" : "movimentacoes";

  const [pagina, setPagina] = useState(1);
  /*
    O tamanho da página é escolha de quem olha, e só da relação.

    A lista de movimentações continua com os 25 de sempre: ela é fila de
    trabalho, e quem revisa desce uma página por vez. A relação é conferência
    contra a planilha, e ali abrir 100 de uma vez é o que encurta o trabalho.
  */
  const [porPaginaDaFila, setPorPaginaDaFila] = useState(POR_PAGINA);
  const [filtros, setFiltros] = useState<FiltrosDaTela>({});
  const [ocupadas, setOcupadas] = useState<Set<string>>(new Set());

  const trocar = (mudancas: Record<string, string | null>) => {
    const proximos = new URLSearchParams(parametros);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null) proximos.delete(chave);
      else proximos.set(chave, valor);
    }
    navegar(`/monitoramento-de-chamados?${proximos.toString()}`);
  };

  const series = useSeries();
  /*
    A unidade que a lateral nomeia — a mesma resolução que a caixa "Unidade
    atual" faz (`contextoAberto`), porque as duas têm de responder a mesma
    coisa. Sem contexto nenhum não há unidade, e aí não há o que recortar.
  */
  const { contextos } = useContextosDaCasca();
  const contexto = contextoAberto(contextos, parametros.get("scopeHash"));
  const unidade = contexto === undefined ? null : unidadeDe(contexto);

  /*
    O recorte inteiro decidido num lugar só, e fora do JSX — ver
    `lib/serie-da-unidade.ts`, onde estão a ordem das autoridades e o que
    acontece quando a unidade não casa com série nenhuma.

    `undefined` é "todas as séries" e `null` é a série sem unidade — duas coisas
    diferentes, e é por isso que a URL as distingue por um rótulo (`@sem-serie`)
    em vez de por um parâmetro vazio.
  */
  const recorte = recorteDeChamados({
    serieNaUrl: serieBruta,
    visaoGeral: visaoGeralAtiva(pathname, busca),
    unidade,
    series: series.dados?.series,
  });
  const serie = recorte.serie;

  const regua = useReguaDeDias({
    ate: fimDaRegua,
    serie,
    habilitado: recorte.pronto,
  });
  const resumoConsulta = useResumoDoDia({ dia, serie, habilitado: recorte.pronto });
  const lista = useMovimentacoes({
    dia,
    serie,
    aba,
    filtros,
    pagina,
    porPagina: POR_PAGINA,
    habilitado: recorte.pronto,
  });
  /*
    A fila só é buscada quando alguém a abre: ela é do tamanho do arquivo, e
    carregá-la junto com o resumo faria todo dia pagar por uma lista que a
    maioria dos dias não vai olhar. O número que rotula a visão vem do resumo
    (`chamadosNoEnvio`), que já lê os envios do dia — é isso que permite a tela
    oferecer a relação sem antes carregá-la.
  */
  const fila = useFilaDoDia({
    dia,
    serie,
    filtros,
    pagina,
    porPagina: porPaginaDaFila,
    habilitado: recorte.pronto && visao === "chamados",
  });
  const revisao = useRevisao(dia);

  const resumo = resumoConsulta.dados ?? null;
  /*
    `null` enquanto o resumo não chegou, e nunca um objeto zerado: os cartões
    escrevem "—" na espera, e um zero ali diria "o arquivo não trouxe nenhum
    aprovado" sobre um dia que ainda não foi lido. É a mesma disciplina de
    `dadosDaFila`, e a razão de os três cartões nunca mostrarem número antes de
    haver número.
  */
  const situacoes = resumo?.situacoesNoEnvio ?? null;
  const frase = fraseDoDia(resumo);
  const progresso = progressoDoDia(resumo);
  const movimentacoes = lista.dados?.rows ?? [];
  /*
    `null` enquanto a fila não chegou, e nunca um objeto vazio: os cartões e os
    filtros abaixo perguntam "há relação?" e um zero durante a espera
    responderia que não — a mesma disciplina que `fraseDoDia` mantém do lado das
    movimentações.
  */
  const dadosDaFila = fila.dados ?? null;
  const chamados = dadosDaFila?.rows ?? [];
  const procedencia = procedenciaDaFila(dadosDaFila?.envios ?? []);
  /*
    O total da relação vem da fila quando ela está carregada, e do resumo antes
    disso. Os dois contam a mesma coisa pela mesma regra — o último envio de
    cada série do dia —, e preferir o da fila evita a piscada de um rótulo que
    muda de número ao abrir a visão.
  */
  const chamadosNoEnvio = dadosDaFila?.total ?? resumo?.chamadosNoEnvio ?? 0;

  /*
    A escrita marca a linha como ocupada enquanto está em voo: sem isso, dois
    cliques rápidos disparam duas requisições, e a segunda volta com o 409 de
    "esta movimentação mudou" — um erro que a tela criou sozinha.
  */
  const comOcupada = async (id: string, acao: () => Promise<unknown>) => {
    setOcupadas((atual) => new Set(atual).add(id));
    try {
      await acao();
    } finally {
      setOcupadas((atual) => {
        const proximo = new Set(atual);
        proximo.delete(id);
        return proximo;
      });
    }
  };

  const revisar = (m: Movimentacao) =>
    comOcupada(m.id, () =>
      revisao.revisar.mutateAsync({ id: m.id, revisao: m.revisao }),
    );
  const desfazer = (m: Movimentacao) =>
    comOcupada(m.id, () => revisao.desfazer.mutateAsync(m.id));

  /*
    Trocar de visão zera a página pelo mesmo motivo que trocar de aba zera:
    a página 3 de setenta movimentações não é a página 3 de mil e duzentos
    chamados, e herdar o número abriria a lista nova num vazio que existe só
    porque o offset sobrou da lista anterior.

    Os filtros, ao contrário, atravessam: unidade, área e responsável são a
    mesma pergunta nas duas leituras, e zerá-los faria "ver a relação" custar
    refazer o recorte. O tipo de alteração não atravessa porque não existe do
    outro lado — a relação não tem alteração nenhuma a tipificar —, e por isso
    o seletor dele some junto com a visão em vez de ficar prometendo um recorte
    que não é aplicado.
  */
  const trocarDeVisao = (proxima: Visao) => {
    setPagina(1);
    trocar({ visao: proxima === "chamados" ? "chamados" : null });
  };

  /** "Continuar revisão" — as pendentes da página, de uma vez. */
  const continuar = () => {
    const pendentes = movimentacoes.filter((m) => !m.revisada).map((m) => m.id);
    if (pendentes.length > 0) revisao.emLote.mutate(pendentes);
  };

  const seriesDisponiveis = series.dados?.series ?? [];
  /*
    O seletor da tela existe para as séries que a lateral não alcança: a do
    envio sem unidade no arquivo, e a da unidade que mandou chamados sem nunca
    ter mandado vigência. Com uma série só, e ela casando com a unidade aberta,
    não há escolha nenhuma a oferecer — um menu de uma opção é ruído.
  */
  const mostrarSeletorDeSerie =
    seriesDisponiveis.length > 1 || recorte.motivo === "UNIDADE_SEM_ENVIO";

  /*
    Enquanto o recorte não está decidido as três consultas estão paradas de
    propósito, e `carregando` delas é `false` — dizer "nenhuma movimentação"
    nesse instante seria afirmar uma resposta que ninguém pediu ainda.
  */
  const decidindo = !recorte.pronto;

  /*
    A janela da régua é de nove dias e termina em hoje. Quando ela sai inteira
    cinza e o recorte **tem** envio fora dela, a tela aponta para o dia em que
    ele está — ver `envioForaDaJanela`. Sem isso, nove frases verdadeiras
    ("nenhuma importação neste dia") somavam uma falsa, que é a de que a unidade
    não tem chamado nenhum.
  */
  const foraDaJanela = envioForaDaJanela({
    dias: regua.dados?.dias ?? [],
    series: seriesDisponiveis,
    serie,
    hoje: regua.dados?.hoje ?? hoje,
  });

  const indisponivel =
    resumoConsulta.indisponivel ||
    lista.indisponivel ||
    regua.indisponivel ||
    fila.indisponivel;

  return (
    <Layout>
      <div className="p-6 space-y-5 max-w-[1600px] mx-auto">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-blue-50 text-blue-600 grid place-content-center shrink-0">
                <Headset className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                {/*
                  O título é o mesmo rótulo curto da lateral —
                  **"Monitoramento"** — e não "Monitoramento de Chamados": a
                  tela é a que o menu acende, e um cabeçalho que diz um nome
                  diferente do item clicado faz duvidar de que se chegou onde
                  se queria. O assunto já está dito de dois lados: a seção da
                  lateral se chama "Chamados Ambev", e a linha abaixo do título
                  é o dia dos chamados. Ver `layout/nav-auditoria.ts`.
                */}
                <h1 className="text-2xl font-bold tracking-tight">
                  Monitoramento
                </h1>
                <p className="text-sm text-muted-foreground">
                  {diaPorExtenso(dia)}
                  {resumo?.ultimaImportacao && (
                    <>
                      {" · "}
                      Última importação {horaLegivel(resumo.ultimaImportacao)}
                    </>
                  )}
                </p>
                <RecorteEmTela recorte={recorte} />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {mostrarSeletorDeSerie && (
              <Select
                value={valorDoSeletor(recorte, serieBruta)}
                onValueChange={(v) => {
                  setPagina(1);
                  trocar(mudancaDoSeletor(v));
                }}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Unidade" />
                </SelectTrigger>
                <SelectContent>
                  {/*
                    A unidade da lateral é a primeira opção porque é o padrão —
                    escolhê-la é apagar a série da URL, não escrever outra.
                    Some quando não há unidade aberta: uma opção que não recorta
                    nada é uma promessa vazia.
                  */}
                  {recorte.unidade !== null && (
                    <SelectItem value={DA_UNIDADE}>
                      {recorte.unidade} (unidade aberta)
                    </SelectItem>
                  )}
                  <SelectItem value={TODAS_AS_SERIES}>
                    Todas as unidades
                  </SelectItem>
                  {seriesDisponiveis.map((s) => (
                    <SelectItem
                      key={s.serie ?? SEM_SERIE}
                      value={s.serie ?? SEM_SERIE}
                    >
                      {s.serie ?? "Sem unidade no arquivo"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                resumoConsulta.tentarDeNovo();
                lista.tentarDeNovo();
                regua.tentarDeNovo();
                fila.tentarDeNovo();
              }}
              title="Atualizar"
            >
              <RefreshCw
                className={cn("h-4 w-4", lista.atualizando && "animate-spin")}
              />
            </Button>
          </div>
        </header>

        {indisponivel && (
          <ApiErrorNotice
            error={resumoConsulta.erro ?? lista.erro ?? regua.erro ?? fila.erro}
            what="o monitoramento de chamados"
            tentando={
              lista.atualizando || resumoConsulta.atualizando || fila.atualizando
            }
            onTentarDeNovo={() => {
              resumoConsulta.tentarDeNovo();
              lista.tentarDeNovo();
              regua.tentarDeNovo();
              fila.tentarDeNovo();
            }}
          />
        )}

        <AvisoDoRecorte
          recorte={recorte}
          series={seriesDisponiveis}
          onTodas={() => {
            setPagina(1);
            trocar(mudancaDoSeletor(TODAS_AS_SERIES));
          }}
          onUnidade={() => {
            setPagina(1);
            trocar(mudancaDoSeletor(DA_UNIDADE));
          }}
        />

        <AvisoDeEnvioForaDaJanela
          envio={foraDaJanela}
          recorte={recorte}
          onVer={(d) => {
            setPagina(1);
            trocar({ dia: d, regua: d });
          }}
        />

        <ReguaDeDias
          dias={regua.dados?.dias ?? []}
          diaAberto={dia}
          hoje={regua.dados?.hoje ?? hoje}
          carregando={regua.carregando || decidindo}
          onDia={(d) => {
            setPagina(1);
            trocar({ dia: d });
          }}
          onDeslocar={(passos) => {
            const base = new Date(`${fimDaRegua}T12:00:00.000Z`);
            base.setUTCDate(base.getUTCDate() + passos);
            trocar({ regua: base.toISOString().slice(0, 10) });
          }}
        />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5 min-w-0">
            {/*
              Os três cartões contam a **fila do dia**, e não o delta.

              Contavam movimentações, revisadas e pendentes — e num dia sem
              movimentação, que é a maioria dos dias, isso eram três zeros no
              topo de uma tela que acabara de ler 1.218 chamados. Três zeros
              certos que não respondem nada é o pior número que uma tela pode
              mostrar, e era o que estava ali.

              O progresso da revisão não se perdeu com a troca: a faixa logo
              abaixo traz a barra e o botão de continuar, e o painel da direita
              mantém movimentações e "aguardando revisão" — que são o grão do
              delta, e ficam do lado de quem pergunta por ele.
            */}
            <div className="grid gap-4 sm:grid-cols-3">
              <MetricCard
                icon={<CheckCircle2 className="h-6 w-6" />}
                tone="green"
                label="Aprovados"
                value={situacoes?.aprovados ?? "—"}
                valueTone="good"
                hint="o que o arquivo deu por aprovado"
              />
              <MetricCard
                icon={<Clock className="h-6 w-6" />}
                tone="orange"
                label="Em análise"
                value={situacoes?.emAnalise ?? "—"}
                valueTone={situacoes && situacoes.emAnalise > 0 ? "warn" : "muted"}
                hint="ainda em curso na Ambev"
              />
              <MetricCard
                icon={<XCircle className="h-6 w-6" />}
                tone="red"
                label="Reprovados"
                value={situacoes?.reprovados ?? "—"}
                valueTone={situacoes && situacoes.reprovados > 0 ? "bad" : "muted"}
                hint="recusados pela Ambev"
              />
            </div>

            {/*
              A tira que fecha a conta dos cartões.

              Os três somam o envio inteiro **menos** o que não cai em nenhuma
              das três caixas — um chamado cancelado, um sem status. Sem esta
              linha, três números certos dariam um total errado, que é
              exatamente o defeito que este produto existe para pegar. Ela cita
              o total contado nos chamados, e é por ele que os quatro fecham.
            */}
            {situacoes !== null && situacoes.total > 0 && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm px-1">
                {situacoes.outras > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-slate-400" />
                    <span className="font-semibold tabular-nums">
                      {situacoes.outras.toLocaleString("pt-BR")}
                    </span>
                    <span className="text-muted-foreground">
                      em outras situações
                      {situacoes.detalheDeOutras.length > 0 &&
                        ` (${situacoes.detalheDeOutras
                          .map(
                            (o) =>
                              `${STATUS_LABELS[o.statusBucket] ?? o.statusBucket}: ${o.total.toLocaleString("pt-BR")}`,
                          )
                          .join(", ")})`}
                    </span>
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  = {situacoes.total.toLocaleString("pt-BR")} chamados no envio
                  deste dia
                </span>
              </div>
            )}

            {/*
              O detalhamento por classe. As quatro somam exatamente o total —
              é a propriedade que o motor garante, e a tela a mostra somada para
              que ela seja conferível a olho.
            */}
            {resumo !== null && resumo.movimentacoes > 0 && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm px-1">
                {[
                  ["novos", resumo.novos, "bg-blue-500"],
                  ["alterados", resumo.alterados, "bg-amber-500"],
                  ["encerrados", resumo.encerrados, "bg-emerald-500"],
                  ["saíram da fila", resumo.removidos, "bg-slate-400"],
                ].map(([rotulo, total, cor]) => (
                  <span key={rotulo as string} className="flex items-center gap-1.5">
                    <span className={cn("h-2 w-2 rounded-full", cor as string)} />
                    <span className="font-semibold tabular-nums">{total as number}</span>
                    <span className="text-muted-foreground">{rotulo as string}</span>
                  </span>
                ))}
                <span className="text-xs text-muted-foreground">
                  = {resumo.movimentacoes} movimentações
                </span>
              </div>
            )}

            {frase && (
              <div
                className={cn(
                  "rounded-xl border px-5 py-4 flex flex-wrap items-center justify-between gap-4",
                  frase.tom === "pendente" && "border-red-200 bg-red-50",
                  frase.tom === "concluido" && "border-emerald-200 bg-emerald-50",
                  frase.tom === "informativo" && "border-blue-200 bg-blue-50",
                  frase.tom === "neutro" && "bg-card",
                )}
              >
                <div className="min-w-0">
                  <div className="font-bold">{frase.titulo}</div>
                  <div className="text-sm text-muted-foreground">{frase.detalhe}</div>
                  {progresso && (
                    <Progress
                      value={progresso.percentual}
                      className="mt-3 h-2 w-full max-w-md"
                    />
                  )}
                </div>
                {progresso && progresso.revisadas < progresso.total && (
                  <Button onClick={continuar} disabled={revisao.emLote.isPending}>
                    Continuar revisão
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}

            {/*
              O lote pode recusar linhas: se um envio novo reescreveu uma
              movimentação entre a lista carregar e o clique, ela não é revisada
              em silêncio. A tela diz quantas ficaram.
            */}
            {revisao.emLote.data && revisao.emLote.data.recusadas.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {revisao.emLote.data.recusadas.length}{" "}
                {revisao.emLote.data.recusadas.length === 1
                  ? "movimentação mudou"
                  : "movimentações mudaram"}{" "}
                desde que a lista carregou e não foram revisadas. Atualize para ver
                o que mudou.
              </div>
            )}

            <div>
              {/*
                As duas leituras do mesmo dia, e a escolha entre elas.

                Controle segmentado, e não uma terceira fileira de abas: as abas
                de baixo recortam **uma** população — as movimentações —, e
                repetir a forma delas aqui sugeriria que "Chamados do envio" é
                mais um recorte da mesma coisa. Não é: é a população de onde as
                movimentações saíram, e os dois números nunca somam.
              */}
              <div
                role="tablist"
                aria-label="o que a lista mostra"
                className="inline-flex rounded-xl border bg-muted/50 p-1"
              >
                <VisaoBotao
                  active={visao === "movimentacoes"}
                  onClick={() => trocarDeVisao("movimentacoes")}
                  icon={<TrendingUp className="h-4 w-4" />}
                  label="Movimentações"
                  hint="o que mudou entre a importação anterior e a deste dia"
                  count={resumo?.movimentacoes}
                />
                <VisaoBotao
                  active={visao === "chamados"}
                  onClick={() => trocarDeVisao("chamados")}
                  icon={<FileSpreadsheet className="h-4 w-4" />}
                  label="Chamados do envio"
                  hint="a relação inteira que a planilha importada trouxe, tenha se mexido ou não"
                  count={chamadosNoEnvio}
                />
              </div>

              {visao === "movimentacoes" ? (
                <>
                  <div className="flex items-center gap-1 border-b overflow-x-auto mt-4">
                    {ABAS.map((nome) => (
                      <AbaBotao
                        key={nome}
                        active={aba === nome}
                        onClick={() => {
                          setPagina(1);
                          trocar({ aba: nome });
                        }}
                        label={ROTULO_DA_ABA[nome].label}
                        hint={ROTULO_DA_ABA[nome].hint}
                        count={contagemDaAba(resumo, nome)}
                      />
                    ))}
                  </div>

                  {resumo !== null && resumo.movimentacoes > 0 && (
                    <div className="flex flex-wrap gap-2 py-3">
                      <FiltroSelect
                        rotulo="Unidade"
                        valor={filtros.unidade}
                        opcoes={resumo.filtros.unidades}
                        onChange={(v) => {
                          setPagina(1);
                          setFiltros((f) => ({ ...f, unidade: v }));
                        }}
                      />
                      <FiltroSelect
                        rotulo="Área"
                        valor={filtros.area}
                        opcoes={resumo.filtros.areas}
                        onChange={(v) => {
                          setPagina(1);
                          setFiltros((f) => ({ ...f, area: v }));
                        }}
                      />
                      <FiltroSelect
                        rotulo="Responsável"
                        valor={filtros.responsavel}
                        opcoes={resumo.filtros.responsaveis}
                        onChange={(v) => {
                          setPagina(1);
                          setFiltros((f) => ({ ...f, responsavel: v }));
                        }}
                      />
                      <FiltroSelect
                        rotulo="Tipo de alteração"
                        valor={filtros.tipoDeAlteracao}
                        opcoes={resumo.filtros.tiposDeAlteracao}
                        rotuloDaOpcao={(t) => ROTULO_DO_TIPO[t] ?? t}
                        onChange={(v) => {
                          setPagina(1);
                          setFiltros((f) => ({ ...f, tipoDeAlteracao: v }));
                        }}
                      />
                    </div>
                  )}

                  <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground pt-3 pb-2">
                    Alterações do dia
                  </h2>

                  {movimentacoes.length === 0 && !lista.carregando && !decidindo ? (
                    <div className="rounded-xl border bg-card px-5 py-10 text-center text-sm text-muted-foreground space-y-3">
                      <div>
                        {resumo?.movimentacoes === 0
                          ? (frase?.titulo ?? "Nenhuma movimentação neste dia.")
                          : "Nenhuma movimentação com estes filtros."}
                      </div>
                      {/*
                        O caminho para fora do vazio, e a razão desta tela ter
                        ganhado uma segunda visão: um dia sem movimentação **não
                        é** um dia sem chamado, e a frase acima, sozinha, era
                        lida como "o import não trouxe nada". O botão só aparece
                        quando há relação a mostrar — um convite para uma lista
                        vazia seria a mesma promessa quebrada em outro lugar.
                      */}
                      {chamadosNoEnvio > 0 && (
                        <Button
                          variant="outline"
                          onClick={() => trocarDeVisao("chamados")}
                        >
                          <FileSpreadsheet className="h-4 w-4" />
                          Ver {chamadosNoEnvio.toLocaleString("pt-BR")} chamados do
                          envio
                        </Button>
                      )}
                    </div>
                  ) : (
                    <>
                      <ListaDeMovimentacoes
                        movimentacoes={movimentacoes}
                        carregando={lista.carregando || decidindo}
                        ocupadas={ocupadas}
                        onRevisar={revisar}
                        onDesfazer={desfazer}
                      />
                      {(lista.dados?.total ?? 0) > POR_PAGINA && (
                        <Paginacao
                          pagina={pagina}
                          porPagina={POR_PAGINA}
                          total={lista.dados?.total ?? 0}
                          onPagina={setPagina}
                          unidade="movimentações"
                          className="pt-3"
                        />
                      )}
                    </>
                  )}
                </>
              ) : (
                <>
                  {/*
                    A procedência antes da lista, como na aba Chamados: esta é a
                    relação do arquivo de outra pessoa, e mostrá-la sem dizer de
                    que arquivo ela é seria pedir confiança sem dar conferência.
                  */}
                  {procedencia && (
                    <div className="pt-4 font-mono text-xs text-muted-foreground">
                      {procedencia}
                    </div>
                  )}

                  {dadosDaFila !== null && dadosDaFila.total > 0 && (
                    <div className="flex flex-wrap gap-2 py-3">
                      <FiltroSelect
                        rotulo="Unidade"
                        valor={filtros.unidade}
                        opcoes={dadosDaFila.filtros.unidades}
                        onChange={(v) => {
                          setPagina(1);
                          setFiltros((f) => ({ ...f, unidade: v }));
                        }}
                      />
                      <FiltroSelect
                        rotulo="Área"
                        valor={filtros.area}
                        opcoes={dadosDaFila.filtros.areas}
                        onChange={(v) => {
                          setPagina(1);
                          setFiltros((f) => ({ ...f, area: v }));
                        }}
                      />
                      <FiltroSelect
                        rotulo="Responsável"
                        valor={filtros.responsavel}
                        opcoes={dadosDaFila.filtros.responsaveis}
                        onChange={(v) => {
                          setPagina(1);
                          setFiltros((f) => ({ ...f, responsavel: v }));
                        }}
                      />
                      <FiltroSelect
                        rotulo="Situação"
                        valor={filtros.statusBucket}
                        opcoes={dadosDaFila.filtros.status}
                        rotuloDaOpcao={(s) => STATUS_LABELS[s] ?? s}
                        onChange={(v) => {
                          setPagina(1);
                          setFiltros((f) => ({ ...f, statusBucket: v }));
                        }}
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pt-3 pb-2">
                    <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                      Chamados do envio
                    </h2>
                    {/*
                      As duas contagens que a relação sustenta, e que a lista de
                      movimentações não sabe dar: quantos seguem em aberto, e
                      quantos destes se mexeram hoje. A segunda é a ponte —
                      é ela que casa este número com o da outra visão.
                    */}
                    {dadosDaFila !== null && dadosDaFila.total > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {dadosDaFila.emAberto.toLocaleString("pt-BR")} em aberto ·{" "}
                        {dadosDaFila.movimentaram.toLocaleString("pt-BR")}{" "}
                        {dadosDaFila.movimentaram === 1
                          ? "se mexeu"
                          : "se mexeram"}{" "}
                        neste dia
                      </span>
                    )}
                  </div>

                  {chamados.length === 0 && !fila.carregando && !decidindo ? (
                    <div className="rounded-xl border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
                      {(dadosDaFila?.total ?? 0) === 0
                        ? "Nenhum arquivo de chamados foi lido neste dia."
                        : "Nenhum chamado com estes filtros."}
                    </div>
                  ) : (
                    /*
                      O rodapé mora dentro da tabela, e não abaixo dela: a
                      contagem, as páginas e o tamanho são a moldura da mesma
                      lista, e é assim que a tabela da aba Chamados os mostra.
                    */
                    <ListaDeChamados
                      chamados={chamados}
                      carregando={fila.carregando || decidindo}
                      dia={dia}
                      pagina={pagina}
                      porPagina={porPaginaDaFila}
                      total={dadosDaFila?.totalFiltrado ?? 0}
                      onPagina={setPagina}
                      onPorPagina={(quantos) => {
                        setPagina(1);
                        setPorPaginaDaFila(quantos);
                      }}
                      tamanhos={TAMANHOS_DA_RELACAO}
                      procedencia={
                        dadosDaFila?.envios[0]?.filename ?? "chamados-do-envio"
                      }
                    />
                  )}
                </>
              )}
            </div>
          </div>

          <aside className="min-w-0">
            <ResumoDoDiaPainel
              resumo={resumo}
              carregando={resumoConsulta.carregando || decidindo}
            />
          </aside>
        </div>
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// O recorte em tela
// ---------------------------------------------------------------------------

/**
 * Os dois rótulos que **não** são séries — e por que eles não viajam na URL.
 *
 * "A unidade aberta" é a ausência de `serie` no endereço, e "todas as unidades"
 * é `visaoGeral=1`: os dois já têm nome na URL, e inventar um terceiro faria a
 * mesma pergunta ter duas respostas escritas. Aqui eles são só o valor que o
 * `Select` do Radix precisa ter para cada item — vocabulário do componente, e
 * não do endereço.
 */
const DA_UNIDADE = "__unidade__";
const TODAS_AS_SERIES = "__todas__";

/** O item marcado no seletor — o que a tela está de fato lendo. */
function valorDoSeletor(
  recorte: RecorteDeChamados,
  serieNaUrl: string | null,
): string {
  if (serieNaUrl !== null) return serieNaUrl;
  return recorte.motivo === "TODAS" ? TODAS_AS_SERIES : DA_UNIDADE;
}

/**
 * O que cada escolha do seletor escreve no endereço.
 *
 * `serie` e `visaoGeral` são apagados um pelo outro sempre: deixar os dois na
 * URL faria o link carregar um recorte que a tela não está aplicando, e é
 * exatamente esse tipo de sobra que faz um endereço colado abrir diferente do
 * que quem o copiou estava vendo.
 */
function mudancaDoSeletor(escolha: string): Record<string, string | null> {
  if (escolha === DA_UNIDADE) return { serie: null, visaoGeral: null };
  if (escolha === TODAS_AS_SERIES) return { serie: null, visaoGeral: "1" };
  return { serie: escolha, visaoGeral: null };
}

/**
 * Um dos dois botões de leitura.
 *
 * Controle segmentado, e não abas: as abas desta tela recortam **uma**
 * população — as movimentações do dia —, e usar a mesma forma aqui diria que
 * "Chamados do envio" é mais um recorte delas. É a mesma distinção, e a mesma
 * solução, que a aba Chamados faz entre suas abas e o par Resumo/Por tipo.
 */
function VisaoBotao({
  active,
  onClick,
  icon,
  label,
  hint,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
  /** `undefined` enquanto o número não chegou — nunca zero durante a espera. */
  count?: number;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      title={hint}
      className={cn(
        "flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
      {count !== undefined && (
        <span
          className={cn(
            "text-xs tabular-nums rounded-full px-1.5 py-0.5",
            active ? "bg-primary/10 text-primary" : "bg-muted-foreground/10",
          )}
        >
          {count.toLocaleString("pt-BR")}
        </span>
      )}
    </button>
  );
}

/**
 * A etiqueta que diz de quem são os números da tela.
 *
 * Os cartões mudam de valor conforme o recorte, e um número que muda sem dizer
 * de quem é vale menos do que nenhum. A etiqueta fica colada ao título, e não
 * na lateral: quem lê "70 movimentações" está olhando para cá.
 */
function RecorteEmTela({ recorte }: { recorte: RecorteDeChamados }) {
  if (recorte.motivo === "TODAS") {
    return (
      <span className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
        <Layers className="h-3.5 w-3.5" />
        Todas as unidades
      </span>
    );
  }
  const nome =
    recorte.motivo === "ESCOLHA"
      ? (recorte.serie ?? "Sem unidade no arquivo")
      : recorte.unidade;
  return (
    <span className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
      <MapPin className="h-3.5 w-3.5" />
      {nome}
    </span>
  );
}

/**
 * Os dois desencontros possíveis entre a lateral e a tela, ditos por extenso.
 *
 * **A unidade sem envio.** Nenhum arquivo de chamados nomeia a unidade aberta.
 * Mostrar o acervo inteiro embaixo do nome dela seria o desencontro que esta
 * tela acabou de sair de ter; mostrar vazio sem explicar seria pior ainda, que
 * é confundir "não achei" com "não há". A tela nomeia as séries que existem, e
 * oferece a soma.
 *
 * **A série escolhida à mão.** Quem escreveu `serie` na URL vence a lateral —
 * e a lateral continua escrita com outro nome, a cinco centímetros daqui. A
 * tira diz qual dos dois está valendo e devolve o caminho de volta num clique.
 */
function AvisoDoRecorte({
  recorte,
  series,
  onTodas,
  onUnidade,
}: {
  recorte: RecorteDeChamados;
  series: { serie: string | null }[];
  onTodas: () => void;
  onUnidade: () => void;
}) {
  if (recorte.motivo === "UNIDADE_SEM_ENVIO") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="font-bold text-amber-900">
            Nenhum chamado importado para {recorte.unidade}.
          </div>
          <div className="text-sm text-amber-900/80">{ondeEstaoOsEnvios(series)}</div>
        </div>
        <Button variant="outline" onClick={onTodas}>
          Ver todas as unidades
        </Button>
      </div>
    );
  }

  /*
    A divergência só é afirmável depois de a lista de séries chegar: com ela
    vazia, `serieDaUnidade` devolve `null` para toda unidade, e a tira apareceria
    em toda escolha durante a primeira carga — dizendo divergência onde só há
    espera.
  */
  const divergente =
    recorte.motivo === "ESCOLHA" &&
    recorte.unidade !== null &&
    series.length > 0 &&
    recorte.serie !== serieDaUnidade(recorte.unidade, series);
  if (!divergente) return null;

  return (
    <div className="rounded-xl border bg-card px-5 py-3 flex flex-wrap items-center justify-between gap-4 text-sm">
      <div className="min-w-0">
        Esta tela está lendo{" "}
        <span className="font-semibold">
          {recorte.serie ?? "os envios sem unidade no arquivo"}
        </span>
        , e a lateral está em{" "}
        <span className="font-semibold">{recorte.unidade}</span>.
      </div>
      <Button variant="outline" size="sm" onClick={onUnidade}>
        Voltar para {recorte.unidade}
      </Button>
    </div>
  );
}

/**
 * Onde os chamados estão, para quem abriu a unidade que não tem nenhum.
 *
 * Nomear as séries que existem é o que transforma "está vazio" em "está vazio
 * **porque**" — e cobre o caso mais provável de todos, que é a mesma unidade
 * escrita de outro jeito no arquivo da Ambev. A lista é cortada em cinco: o
 * aviso é uma frase, não um segundo seletor.
 */
function ondeEstaoOsEnvios(series: { serie: string | null }[]): string {
  const nomeadas = series
    .map((s) => s.serie)
    .filter((s): s is string => s !== null);
  if (nomeadas.length === 0) {
    return "Nenhum arquivo de chamados foi importado ainda.";
  }
  const mostradas = nomeadas.slice(0, 5).join(", ");
  const resto = nomeadas.length - 5;
  return (
    `Os arquivos importados nomeiam ${mostradas}` +
    (resto > 0 ? ` e mais ${resto}` : "") +
    ". Se for a mesma unidade com outro nome no arquivo, escolha-a no seletor acima."
  );
}

/**
 * O envio que está fora dos nove dias — a tira que aponta para ele.
 *
 * A régua é de nove dias e termina em hoje, que é a janela certa para quem abre
 * a tela todo dia e a errada para quem importou uma unidade uma vez, há três
 * semanas. Sem esta tira, os nove cinzas somam "esta unidade não tem chamados"
 * — e cada um deles, sozinho, estava dizendo a verdade.
 *
 * A tira **não desloca a régua sozinha**. Mover o recorte de quem está olhando,
 * sem que a pessoa tenha pedido, é a mesma mentira de conveniência que
 * `serie-da-unidade.ts` recusa quando o nome não bate: o que a tela deve é
 * dizer onde o dado está e deixar o clique com quem opera — inclusive porque
 * chegar aqui pela unidade errada é um dos caminhos possíveis, e nele o dia
 * apontado não é o que a pessoa quer ver.
 *
 * Sem `envio`, nada é renderizado: a tira existe só quando há um dia concreto
 * para oferecer, nunca como um lamento sobre o vazio.
 */
function AvisoDeEnvioForaDaJanela({
  envio,
  recorte,
  onVer,
}: {
  envio: EnvioForaDaJanela | null;
  recorte: RecorteDeChamados;
  onVer: (dia: string) => void;
}) {
  if (envio === null) return null;

  /*
    O nome do recorte entra na frase só quando há um: em "todas as unidades" a
    frase corre melhor sem ele, e escrever "o último envio de todas as unidades"
    diria que as unidades importaram juntas.
  */
  const nome =
    recorte.motivo === "TODAS"
      ? null
      : (recorte.serie ?? recorte.unidade ?? "esta unidade");

  return (
    <div className="rounded-xl border bg-card px-5 py-4 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0">
        <div className="h-9 w-9 rounded-lg bg-blue-50 text-blue-600 grid place-content-center shrink-0">
          <CalendarSearch className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="font-bold">
            Nenhuma importação nos dias que a régua mostra.
          </div>
          <div className="text-sm text-muted-foreground">
            {nome === null ? (
              <>O último envio foi em </>
            ) : (
              <>
                O último envio de <span className="font-semibold">{nome}</span>{" "}
                foi em{" "}
              </>
            )}
            <span className="font-semibold">{diaLegivel(envio.dia)}</span>
            {janelaDoEnvioFora(envio)}
          </div>
        </div>
      </div>
      <Button variant="outline" onClick={() => onVer(envio.dia)}>
        Ver {diaLegivel(envio.dia)}
      </Button>
    </div>
  );
}

const TODOS = "__todos__";

/** Um filtro que só existe quando há mais de uma opção para escolher. */
function FiltroSelect({
  rotulo,
  valor,
  opcoes,
  onChange,
  rotuloDaOpcao = (o) => o,
}: {
  rotulo: string;
  valor: string | undefined;
  opcoes: string[];
  onChange: (valor: string | undefined) => void;
  rotuloDaOpcao?: (opcao: string) => string;
}) {
  // Um seletor com uma opção só não é uma escolha — é ruído entre os que são.
  if (opcoes.length < 2) return null;
  return (
    <Select
      value={valor ?? TODOS}
      onValueChange={(v) => onChange(v === TODOS ? undefined : v)}
    >
      <SelectTrigger className="w-auto min-w-[150px] h-9">
        <SelectValue placeholder={rotulo} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TODOS}>{rotulo}: todos</SelectItem>
        {opcoes.map((o) => (
          <SelectItem key={o} value={o}>
            {rotuloDaOpcao(o)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
