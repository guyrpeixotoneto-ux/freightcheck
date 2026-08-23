import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  ClipboardPen,
  FileSearch,
  Lock,
  ShieldCheck,
  Sparkles,
  Undo2,
  WifiOff,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { PlanilhaDeAtributos } from "@/components/curadoria/planilha-de-atributos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ComboboxCriavel } from "@/components/ui/combobox-criavel";
import {
  familiaDaCategoria,
  leituraDe,
  leituraDoSintetico,
  oQueFalta,
  podeConfirmar,
  podeRepetirNoAnalitico,
  precisaDoPeriodo,
  previaDaCriacao,
  resumo,
  significadoAtual,
  vigenciaDoDado,
  type CampoEmConfirmacao,
  type Escolhas,
  type OpcaoDeCategoria,
  type OpcaoDeSignificado,
  type OpcaoDeSintetico,
} from "@/lib/interpretacao";
import {
  PERIODOS_EM_ABERTO,
  significadoPara,
} from "@workspace/curation/significado";
import { fetchJson, getApiUrl } from "@/lib/api";
import {
  abasDeEquipamento,
  enderecoDaAba,
  equipamentoDoAtributo,
  estaDescrito,
  filtrarPorEquipamento,
  normalizarEquipamento,
} from "@/lib/curadoria";
import { rotuloDoTipo } from "@/lib/frota";
import { useConsultaResiliente } from "@/lib/consulta-resiliente";
import { cn } from "@/lib/utils";

/**
 * Curadoria de Atributos (F2).
 *
 * O que esta tela existe para impedir: um número com aparência de certo.
 * Enquanto um atributo não é confirmado aqui, ele aparece nas telas de
 * mudança mas não entra em nenhuma soma financeira — e o banco recusa
 * qualquer tentativa de confirmar sem responsável.
 */

interface QueueItem {
  code: string;
  sourceName: string;
  displayName: string | null;
  entityType: string;
  dataType: string;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  isMonetary: boolean | null;
  semanticsStatus: string;
  semanticsRationale: string | null;
  definition: string | null;
  calculationBasis: string | null;
  meaningCode: string | null;
  meaningLabel: string | null;
  taxonomyCode: string | null;
  taxonomyPath: string | null;
  taxonomyName: string | null;
  costClass: string | null;
  changeRule: string | null;
  valueCount: number;
  nullCount: number;
  magnitude: number | null;
}

interface AttributeDetail extends QueueItem {
  samples: {
    snapshotLabel: string;
    effectiveDate: string;
    value: string | null;
    isNull: boolean;
    nullReason: string | null;
    sheet: string;
    row: number;
    column: string;
    columnHeader: string | null;
    originalValue: string | null;
    originalType: string;
  }[];
  history: { snapshotLabel: string; effectiveDate: string; sum: number | null; count: number }[];
  events: {
    field: string;
    valueBefore: string | null;
    valueAfter: string | null;
    actor: string;
    reason: string | null;
    createdAt: string;
  }[];
}

interface StatusCount {
  status: string;
  count: number;
  monetary: number;
}

interface CurationSummary {
  byStatus: StatusCount[];
  unclassified: number;
  /** O mesmo recorte, por equipamento — é o que as abas leem. */
  byEntity: { entityType: string; byStatus: StatusCount[]; unclassified: number }[];
}

/**
 * O valor da aba "Todos" dentro do `Tabs`, que não aceita string vazia.
 *
 * Fora do componente ele é `null` — "sem recorte" —, e é `null` que some do
 * endereço. Traduzir na fronteira do componente é mais barato do que deixar a
 * palavra "TODOS" virar um tipo de equipamento que não existe.
 */
const TODOS = "__todos__";

const brl = (value: number) =>
  value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

function StatusBadge({ status }: { status: string }) {
  if (status === "CONFIRMED") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-100">
        <ShieldCheck className="w-3 h-3 mr-1" />
        Confirmado
      </Badge>
    );
  }
  if (status === "PRESUMED") {
    return (
      <Badge className="bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-100">
        <CircleHelp className="w-3 h-3 mr-1" />
        Presumido
      </Badge>
    );
  }
  /* Vermelho, e não o cinza de antes: a falta de semântica é o que trava a
     fila, e um selo neutro fazia dela um detalhe do card em vez do motivo
     de ele estar ali. Verde quando confirma, acima. */
  return (
    <Badge className="bg-red-100 text-red-800 border-red-300 hover:bg-red-100">
      <AlertTriangle className="w-3 h-3 mr-1" />
      Desconhecido
    </Badge>
  );
}

/**
 * A rota da fila, escrita uma vez.
 *
 * É o endpoint **sem** os filtros, e isso é a decisão: o registro de falhas se
 * organiza por esta chave, e incluir `includeConfirmed` faria o mesmo episódio
 * de rede aparecer como dois endpoints diferentes conforme o estado de um
 * checkbox. A query string continua onde sempre esteve, na chamada.
 */
const ENDPOINT_DA_FILA = "/curation/queue";

export default function Curadoria() {
  const queryClient = useQueryClient();
  const search = useSearch();
  const [, navegar] = useLocation();

  /*
    O atributo aberto mora no endereço; o recorte da fila, no estado.

    A divisão é a mesma da aba Planilha, e pela mesma razão. **Qual atributo se
    está lendo** é o que as outras telas apontam: seis lugares do produto dizem
    "falta confirmar isto" e mandavam para cá sem dizer o quê — a pessoa chegava
    numa fila de 121 itens e tinha de procurar o nome que acabara de ler. Agora
    o endereço carrega o código, e a mesma URL leva outra pessoa ao mesmo lugar.

    **Como a fila é encurtada** — o texto do filtro e o botão Pendentes/Todos —
    continua em `useState`: ninguém aponta para "a fila filtrada por 'ipva'", e
    reescrever o endereço a cada tecla encheria o histórico sem que nada tivesse
    sido lido.
  */
  const selected = new URLSearchParams(search).get("atributo");
  /*
    O equipamento também mora no endereço, e pelo primeiro dos dois motivos: é
    para uma aba que se manda alguém. "Confira as colunas da carreta" vira um
    link, e o mesmo link abre a mesma fila amanhã.
  */
  const equipamento = normalizarEquipamento(
    new URLSearchParams(search).get("equipamento"),
  );
  /*
    E a gaveta de cadastro também: ela é o formulário de **um** atributo, e a
    razão de o atributo aberto morar no endereço vale inteira para ela — "vá
    cadastrar a interpretação de `cavalo.ipva`" precisa ser um link, e não uma
    instrução para procurar a linha na fila e clicar no ícone certo.

    Param separado de `atributo` de propósito: abrir a gaveta a partir da linha
    não pode trocar o que o painel da direita está mostrando. São duas leituras
    do mesmo atributo — o painel mostra os valores reais, a gaveta recebe as
    respostas — e uma não é o estado da outra.
  */
  const emCadastro = new URLSearchParams(search).get("cadastro");

  const irPara = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(search);
    for (const [chave, valor] of Object.entries(patch)) {
      if (valor) params.set(chave, valor);
      else params.delete(chave);
    }
    // `replace`: escolher outro item da fila não é uma tela nova, e voltar tem
    // de sair da Curadoria em vez de percorrer os atributos já abertos.
    navegar(params.toString() ? `/curadoria?${params}` : "/curadoria", {
      replace: true,
    });
  };

  const setSelected = (code: string | null) => irPara({ atributo: code });
  const setEquipamento = (tipo: string | null) => irPara({ equipamento: tipo });
  const setCadastro = (code: string | null) => irPara({ cadastro: code });

  const [filter, setFilter] = useState("");
  const [showConfirmed, setShowConfirmed] = useState(false);

  const { data: summary } = useQuery({
    queryKey: ["curation", "summary"],
    queryFn: () => fetchJson<CurationSummary>("/curation/summary"),
  });

  /*
    A fila é a única query desta tela que sustenta o conteúdo inteiro: sem ela
    não há cards, não há abas, não há o que filtrar. Era ela que sumia atrás do
    painel amarelo quando um refetch de fundo não completava.

    Esta tela chegou a montar a política à mão — espalhar as opções, guardar a
    última fila num `ref`, assinar o `onlineManager`, escrever a regra do painel.
    Quatro coisas para copiar são quatro coisas para copiar pela metade, e foi
    assim que Competências acabou com um tratamento diferente para a mesma
    falha. Agora é `useConsultaResiliente`, e o que sobra aqui é desenho.
  */
  const fila = useConsultaResiliente<QueueItem[]>({
    queryKey: ["curation", "queue", showConfirmed],
    endpoint: ENDPOINT_DA_FILA,
    buscar: () =>
      fetchJson<QueueItem[]>(
        `${ENDPOINT_DA_FILA}?includeConfirmed=${showConfirmed}`,
      ),
  });

  /*
    `?? []` é conveniência de renderização, e **não** a autoridade sobre haver
    dado. Quem responde isso é `fila.houveResposta`, dentro do hook: uma fila
    legitimamente vazia — tudo curado — é uma resposta, e a versão anterior, que
    perguntava `queue.length > 0`, trocava essa boa notícia pelo painel de
    indisponibilidade na primeira falha seguinte.
  */
  const queue = fila.dados ?? [];
  const isLoading = fila.carregando;
  const error = fila.erro;

  const { data: detail } = useQuery({
    queryKey: ["curation", "attribute", selected],
    queryFn: () => fetchJson<AttributeDetail>(`/curation/attributes/${selected}`),
    enabled: selected !== null,
  });

  /*
    O texto primeiro, o equipamento depois.

    A ordem decide o que os números das abas prometem. Contadas sobre a fila já
    filtrada por texto, elas dizem quantos cards **este** clique abre; contadas
    sobre a fila inteira, uma aba escrita `Carreta 41` abriria três resultados
    porque o filtro "ipva" continuava valendo, e o número viraria decoração.
  */
  const filtradosPorTexto = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return queue;
    return queue.filter(
      (item) =>
        item.code.toLowerCase().includes(needle) ||
        item.sourceName.toLowerCase().includes(needle) ||
        (item.displayName?.toLowerCase().includes(needle) ?? false),
    );
  }, [queue, filter]);

  const abas = useMemo(() => abasDeEquipamento(filtradosPorTexto), [filtradosPorTexto]);
  const visible = useMemo(
    () => filtrarPorEquipamento(filtradosPorTexto, equipamento),
    [filtradosPorTexto, equipamento],
  );

  /*
    Quem chegou por link a um atributo já confirmado precisa vê-lo na fila.

    A fila abre em "Pendentes", e um atributo confirmado não está nela: o painel
    da direita mostrava o atributo pedido enquanto a lista da esquerda não o
    continha, e a tela se contradizia em silêncio. O botão vira "Todos" uma vez,
    só quando o endereço pediu alguém que a fila atual não tem — trocá-lo por
    conta própria em qualquer outra situação seria desfazer uma escolha de quem
    está lendo.

    Vale para os dois pedidos do endereço, e não só para o painel: fechar a
    gaveta de cadastro de um atributo confirmado devolveria a pessoa a uma lista
    onde a linha de onde ela veio não existe.
  */
  useEffect(() => {
    if (showConfirmed || queue.length === 0) return;
    const pedidos = [selected, emCadastro].filter((c): c is string => c !== null);
    if (pedidos.some((code) => !queue.some((item) => item.code === code))) {
      setShowConfirmed(true);
    }
  }, [selected, emCadastro, queue, showConfirmed]);

  /*
    E a aba segue o atributo — **na chegada pelo link, e só nela.**

    Um link para `cavalo.ipva` aberto com a aba `Carreta` no endereço mostrava o
    painel de um atributo que a lista ao lado não continha: a contradição que o
    efeito acima já resolvia para o botão Pendentes. A correção era mover a aba,
    e ela custou caro em silêncio — como o efeito observava a aba junto com o
    atributo, ele não distinguia "cheguei por um link torto" de "acabei de
    clicar numa aba". Com um atributo de cavalo aberto, clicar em Carreta punha
    `CARRETA` no endereço, o efeito lia o desencontro e escrevia `CAVALO` de
    volta antes de a tela repintar. As abas Carreta, Trecho e QLP simplesmente
    não selecionavam, sem erro nenhum, e a única que "funcionava" era a do
    equipamento do atributo já aberto.

    O `ref` é o que separa as duas situações. Ele guarda o atributo que já foi
    conciliado; a conciliação acontece uma vez por atributo, na primeira vez em
    que a fila contém o código pedido, e nunca mais. Clicar numa aba continua
    sendo escolha de quem clicou — e quem clicou já não tem contradição para
    ver, porque `escolherEquipamento` fecha o atributo que não pertence à aba
    escolhida.

    Enquanto a fila não chega, nada é marcado: `undefined` é "ainda não sei de
    que equipamento este código é", e decidir por ausência de resposta
    consumiria a única conciliação sem ter conciliado nada.
  */
  const atributoConciliado = useRef<string | null>(null);
  useEffect(() => {
    if (selected === null) {
      atributoConciliado.current = null;
      return;
    }
    if (atributoConciliado.current === selected) return;
    const tipo = equipamentoDoAtributo(queue, selected);
    if (tipo === undefined) return;
    atributoConciliado.current = selected;
    if (equipamento === null) return;
    if (tipo !== null && tipo !== equipamento) setEquipamento(tipo);
    /* `setEquipamento` fica fora das dependências de propósito: ele nasce a
       cada render, porque lê o endereço. O que este efeito observa é o
       endereço, que é o que ele escreve. */
  }, [selected, equipamento, queue]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
    A outra metade da correção: trocar de aba fecha o atributo que não é dela.

    É o que mantém a tela coerente sem desfazer o clique — a lista da esquerda
    passa a ser de carreta, e o painel da direita não continua mostrando uma
    coluna de cavalo que a lista não contém. A regra é `enderecoDaAba`, em
    `lib/curadoria.ts`, com o resto do que responde em vez de pintar.
  */
  const escolherEquipamento = (tipo: string | null) =>
    irPara(enderecoDaAba(queue, tipo, selected));

  /*
    Os números do topo falam da aba aberta.

    Contá-los sempre sobre a base inteira era a contradição óbvia: "73
    aguardando confirmação" acima de uma lista de 41 colunas de carreta. O
    recorte por equipamento vem do servidor, e não da fila da tela, porque a
    fila em "Pendentes" não tem os confirmados — contar daqui zeraria o primeiro
    quadro justamente na aba de quem mais curou.
  */
  const recorte: { byStatus: StatusCount[]; unclassified: number } | undefined =
    summary === undefined
      ? undefined
      : equipamento === null
        ? summary
        : // Equipamento sem nenhuma linha no resumo é zero de verdade, e não
          // ausência de resposta: o resumo chegou e não o listou.
          (summary.byEntity.find((e) => e.entityType === equipamento) ?? {
            byStatus: [],
            unclassified: 0,
          });

  /*
    Quantas colunas o recorte tem na base, de qualquer status — o número que
    separa "este equipamento não existe aqui" de "as colunas dele já estão
    todas confirmadas". `null` enquanto o resumo não chegou: as duas frases
    afirmam coisas sobre a base, e nenhuma pode ser dita por falta de resposta.
  */
  const colunasNaBase =
    recorte === undefined
      ? null
      : recorte.byStatus.reduce((sum, s) => sum + s.count, 0);

  // Aggregate across every non-confirmed status rather than picking one row:
  // the summary is grouped, not ordered, so "the first pending row" is
  // whichever the database happened to return — and PRESUMED and UNKNOWN both
  // count as pending.
  const notConfirmed = recorte?.byStatus.filter((s) => s.status !== "CONFIRMED") ?? [];
  const pendingCount = notConfirmed.reduce((sum, s) => sum + s.count, 0);
  const pendingMonetary = notConfirmed.reduce((sum, s) => sum + s.monetary, 0);
  const confirmedCount =
    recorte?.byStatus.find((s) => s.status === "CONFIRMED")?.count ?? 0;

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <FileSearch className="w-6 h-6 text-primary" />
              Curadoria de Atributos
            </h1>
            <p className="text-muted-foreground mt-1 max-w-3xl">
              O Freightec não diz o que cada variável significa. Enquanto você não
              confirmar aqui, o atributo aparece nas telas de mudança mas{" "}
              <strong>não entra em nenhum cálculo financeiro</strong>.
            </p>
          </div>
          {/* A planilha fica no topo, ao lado do título, e não dentro da fila:
              ela descreve a base inteira de uma vez, e não o atributo aberto. */}
          <PlanilhaDeAtributos equipamento={equipamento} />
        </div>

        {/* As abas vêm antes dos quadros porque mandam neles: primeiro se
            escolhe de que equipamento se está falando, depois se lê quanto
            falta nele. Na ordem inversa, os números apareceriam antes de a
            tela dizer sobre o que eles são. */}
        <Tabs
          value={equipamento ?? TODOS}
          onValueChange={(valor) =>
            escolherEquipamento(valor === TODOS ? null : valor)
          }
          className="mt-5"
        >
          <TabsList>
            {abas.map((aba) => (
              <TabsTrigger key={aba.tipo ?? TODOS} value={aba.tipo ?? TODOS}>
                {aba.rotulo}
                <span className="ml-1.5 tabular-nums text-xs text-muted-foreground">
                  {aba.total}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <SummaryTile
            label="Confirmados"
            value={confirmedCount}
            tone="good"
            icon={<CheckCircle2 className="w-4 h-4" />}
          />
          <SummaryTile
            label="Aguardando confirmação"
            value={pendingCount}
            tone="warn"
            icon={<CircleHelp className="w-4 h-4" />}
          />
          <SummaryTile
            label="Monetários sem confirmar"
            value={pendingMonetary}
            tone="warn"
            icon={<Lock className="w-4 h-4" />}
          />
          <SummaryTile
            label="Fora da taxonomia"
            value={recorte?.unclassified ?? 0}
            tone="neutral"
            icon={<AlertTriangle className="w-4 h-4" />}
          />
        </div>
      </header>

      {fila.indisponivel && (
        <div className="px-8 pt-6">
          <ApiErrorNotice
            error={error}
            what="A fila de curadoria não pôde ser carregada."
            onTentarDeNovo={fila.tentarDeNovo}
            tentando={fila.atualizando}
          />
        </div>
      )}

      {/*
        A falha que **não** substitui a tela.

        Quando há fila em tela, uma chamada que não completou é um recado de
        rodapé, não um diagnóstico de produto: o que se vê continua sendo o que
        o servidor mandou, e a única coisa que mudou é a hora. Dizer a hora é o
        que faz esta tira ser honesta — "de 14h02" é verificável, "pode estar
        desatualizado" é uma desculpa.

        Era aqui que a tela mentia por omissão de forma: qualquer falha, mesmo
        a que passaria sozinha, virava o mesmo painel amarelo com a mesma
        recomendação de plataforma, sobre uma fila que estava logo ali embaixo,
        inteira e correta.
      */}
      {fila.avisarSobreDadoGuardado && (
        <div className="px-8 pt-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-200 bg-amber-50/70 px-4 py-2 text-sm text-amber-900">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>
              A atualização da fila não completou. O que está em tela é de{" "}
              {new Date(fila.respondidoEm ?? 0).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
              , e continua válido.
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              disabled={fila.atualizando}
              onClick={fila.tentarDeNovo}
            >
              {fila.atualizando ? "Tentando…" : "Tentar de novo"}
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-6 p-8 items-start">
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {/* O título repete a aba porque a lista é o que ela recorta, e
                  quem rolou a página até aqui já não vê as abas lá em cima. */}
              {equipamento === null
                ? "Fila de curadoria"
                : `Fila de curadoria · ${rotuloDoTipo(equipamento)}`}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Ordenada por materialidade. A soma exibida é bruta e não auditada —
              serve para priorizar, não é resultado. Em verde, o que já tem nome,
              descrição e fórmula escritos — descrever não é confirmar.
            </p>
            <div className="flex gap-2 pt-2">
              <Input
                placeholder="Filtrar por nome ou código…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="h-9"
              />
              <Button
                variant={showConfirmed ? "default" : "outline"}
                size="sm"
                onClick={() => setShowConfirmed((v) => !v)}
                className="shrink-0"
              >
                {showConfirmed ? "Todos" : "Pendentes"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0 max-h-[70vh] overflow-y-auto">
            {isLoading && (
              <p className="text-sm text-muted-foreground p-4">Carregando…</p>
            )}
            {visible.map((item) => {
              const descrito = estaDescrito(item);
              const nome = item.displayName ?? item.sourceName;
              return (
                /*
                  Duas ações no mesmo card, e por isso ele deixou de ser um
                  botão só: ler o atributo (o painel da direita, com os valores
                  reais) e cadastrar a interpretação dele (a gaveta). Botão
                  dentro de botão não é HTML válido — o card virou a linha, e
                  cada ação ganhou o próprio alvo dentro dela.
                */
                <div
                  key={item.code}
                  /* A faixa da esquerda existe em todo card, transparente
                     quando não há o que marcar: assim o verde acende sem
                     empurrar o texto 4px para o lado. */
                  className={cn(
                    "flex items-stretch border-b border-l-4 border-l-transparent transition-colors",
                    descrito
                      ? "border-l-emerald-500 bg-emerald-50/70 hover:bg-emerald-100/70"
                      : "hover:bg-muted/60",
                    selected === item.code &&
                      (descrito ? "bg-emerald-100" : "bg-muted"),
                    emCadastro === item.code && "ring-1 ring-inset ring-primary/40",
                  )}
                >
                  <button
                    onClick={() => setSelected(item.code)}
                    className="min-w-0 flex-1 text-left px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-muted-foreground truncate">
                          {item.displayName ? `${item.sourceName} · ` : ""}
                          {item.code}
                        </div>
                        <div className="font-medium text-sm truncate">
                          {nome}
                        </div>
                      </div>
                      <StatusBadge status={item.semanticsStatus} />
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                      <span className="font-mono">{item.unit ?? "sem unidade"}</span>
                      <span>·</span>
                      <span className="font-mono">{item.aggregation ?? "sem agregação"}</span>
                      {item.magnitude !== null && item.magnitude !== 0 && (
                        <>
                          <span>·</span>
                          <span className="font-mono tabular-nums">{brl(item.magnitude)}</span>
                        </>
                      )}
                      {/* O verde sozinho não diz do que é o verde — e neste
                          card, ao lado de um selo de status, seria lido como
                          "confirmado". A palavra impede a leitura errada. */}
                      {descrito && (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                            <CheckCircle2 className="w-3 h-3" />
                            descrito
                          </span>
                        </>
                      )}
                    </div>
                  </button>

                  {/*
                    O ícone de cadastro, em toda linha da fila.

                    Ele existe porque as perguntas que destravam o dinheiro —
                    significado, linha da DRE e detalhe dentro dela — ficavam a
                    três rolagens de distância: era preciso escolher o atributo,
                    descer o painel da direita passando pela tabela de valores e
                    pelo card de nome, e só então chegar aos campos. Quem já sabe
                    o que a coluna é não deveria percorrer isso para dizê-lo.

                    Prancheta com caneta, e não um "+": não se está criando um
                    atributo — ele já existe, veio da importação. O que se
                    cadastra é a interpretação dele.
                  */}
                  <button
                    onClick={() => setCadastro(item.code)}
                    aria-label={`Cadastrar a interpretação de ${nome}`}
                    title="Cadastrar a interpretação — abre a gaveta com os campos"
                    className={cn(
                      "flex w-11 shrink-0 items-center justify-center border-l text-muted-foreground transition-colors hover:bg-background hover:text-foreground",
                      emCadastro === item.code && "bg-background text-foreground",
                    )}
                  >
                    <ClipboardPen className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
            {/*
              "A fila está vazia" e "a fila não pôde ser carregada" não podem
              aparecer juntas. Fila vazia é uma afirmação sobre a base — não há
              coluna pendente —, e quando a chamada nem completou não se sabe
              disso: o zero em tela é a ausência de resposta, não um resultado.
              Era o que acontecia, e é a mesma classe de defeito que
              `apresentar-erro.ts` fecha no eixo do erro: duas vozes sobre o
              mesmo fato, livres para dizer coisas diferentes.
            */}
            {!isLoading && !fila.indisponivel && visible.length === 0 && (
              <FilaVazia
                equipamento={equipamento}
                filtrando={filter.trim() !== ""}
                mostrandoConfirmados={showConfirmed}
                colunasNaBase={colunasNaBase}
              />
            )}
          </CardContent>
        </Card>

        {detail ? (
          /* Chaveado pelo código: sem isto o painel é a mesma instância ao
             trocar de atributo, e os campos — que nascem de `useState(detail…)`
             — continuariam mostrando as respostas do atributo anterior. */
          <AttributePanel
            key={detail.code}
            detail={detail}
            onConfirmed={() => {
              queryClient.invalidateQueries({ queryKey: ["curation"] });
            }}
          />
        ) : (
          <Card className="h-full">
            <CardContent className="p-12 text-center text-muted-foreground">
              Selecione um atributo para ver os valores reais e confirmar o que
              ele significa. Para responder direto o que ele representa, use o
              ícone de cadastro na linha da fila.
            </CardContent>
          </Card>
        )}
      </div>

      <GavetaDeCadastro
        codigo={emCadastro}
        aoFechar={() => setCadastro(null)}
        aoConfirmar={() => {
          queryClient.invalidateQueries({ queryKey: ["curation"] });
        }}
      />
    </Layout>
  );
}

/**
 * A fila vazia, dita pelo motivo de estar vazia.
 *
 * Eram quatro situações debaixo de uma frase só — "Nada pendente com esse
 * filtro" —, e as abas acrescentaram a mais confusa delas: a aba `Trecho` numa
 * base que só tem cavalo e carreta abria vazia, e a frase sobre o filtro
 * mandava conferir um campo de busca que estava em branco. Cada motivo diz o
 * que fazer em seguida, e o de equipamento inexistente diz de onde o tipo vem —
 * é a única resposta que não está na tela.
 */
function FilaVazia({
  equipamento,
  filtrando,
  mostrandoConfirmados,
  colunasNaBase,
}: {
  equipamento: string | null;
  filtrando: boolean;
  mostrandoConfirmados: boolean;
  colunasNaBase: number | null;
}) {
  const rotulo = equipamento === null ? null : rotuloDoTipo(equipamento);

  const texto = filtrando
    ? rotulo
      ? `Nenhuma coluna de ${rotulo} com esse filtro.`
      : "Nada pendente com esse filtro."
    : rotulo === null
      ? mostrandoConfirmados
        ? "Nenhum atributo importado nesta base."
        : "Nada aguardando confirmação — a fila está limpa."
      : colunasNaBase === 0
        ? `Nenhuma coluna de ${rotulo} foi importada nesta base. O tipo é ` +
          `declarado na tela de Importações: uma planilha enviada pela aba ` +
          `"${rotulo}" de lá abre esta fila sozinha.`
        : mostrandoConfirmados
          ? `Nenhuma coluna de ${rotulo} nesta base.`
          : `Nada aguardando confirmação em ${rotulo}` +
            (colunasNaBase === null
              ? "."
              : ` — as ${colunasNaBase} colunas deste equipamento já estão confirmadas.`);

  return <p className="text-sm text-muted-foreground p-4">{texto}</p>;
}

function SummaryTile({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "good" | "warn" | "neutral";
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div
        className={cn(
          "flex items-center gap-1.5 text-xs font-medium",
          tone === "good" && "text-emerald-700",
          tone === "warn" && "text-amber-700",
          tone === "neutral" && "text-muted-foreground",
        )}
      >
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums mt-1">{value}</div>
    </div>
  );
}

function AttributePanel({
  detail,
  onConfirmed,
}: {
  detail: AttributeDetail;
  onConfirmed: () => void;
}) {
  const conflicted = detail.semanticsRationale?.startsWith("CONFLITO");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              {/* O nome gerencial manda no título quando existe; o de origem
                  nunca some, porque é por ele que se acha a coluna no export. */}
              <CardTitle className={cn("text-lg", !detail.displayName && "font-mono")}>
                {detail.displayName ?? detail.sourceName}
              </CardTitle>
              <p className="font-mono text-xs text-muted-foreground mt-1">
                {detail.displayName && <>{detail.sourceName} · </>}
                {detail.code} · {detail.entityType} · tipo {detail.dataType}
              </p>
            </div>
            <StatusBadge status={detail.semanticsStatus} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {detail.semanticsRationale && (
            <div
              className={cn(
                "rounded-md border-l-4 px-4 py-3 text-sm",
                conflicted
                  ? "bg-red-50 border-red-500 text-red-900"
                  : "bg-muted border-primary",
              )}
            >
              {/* `semanticsRationale` é a proposta do motor até que alguém
                  escreva por cima dela — o que hoje só acontece por fora desta
                  tela, que deixou de pedir justificativa. Chamar as duas de
                  "proposta do sistema" atribuiria ao motor uma frase que pode
                  ter sido escrita por uma pessoa, e é justamente a confusão
                  entre os campos em prosa que o card "Significado" desfaz. */}
              <div className="font-semibold text-xs uppercase tracking-wide mb-1">
                {conflicted
                  ? "Conflito detectado"
                  : detail.semanticsStatus === "CONFIRMED"
                    ? "Justificativa da confirmação"
                    : "Proposta do sistema"}
              </div>
              {detail.semanticsRationale}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Metric label="Valores" value={detail.valueCount.toLocaleString("pt-BR")} />
            <Metric label="Ausentes" value={detail.nullCount.toLocaleString("pt-BR")} />
            <Metric label="Categoria DRE" value={detail.taxonomyName ?? "—"} />
            <Metric label="Classe" value={detail.costClass ?? "—"} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Valores reais e origem</CardTitle>
          <p className="text-xs text-muted-foreground">
            Decida olhando o dado, não o nome da coluna.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">Vigência</th>
                  <th className="text-right px-4 py-2 font-medium">Valor</th>
                  <th className="text-left px-4 py-2 font-medium">Origem</th>
                  <th className="text-left px-4 py-2 font-medium">Original</th>
                </tr>
              </thead>
              <tbody>
                {detail.samples.map((sample, index) => (
                  <tr key={index} className="border-b last:border-0">
                    <td className="px-4 py-2 font-mono text-xs">{sample.snapshotLabel}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {sample.isNull ? (
                        <span className="text-muted-foreground italic">
                          {sample.nullReason}
                        </span>
                      ) : (
                        sample.value
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {sample.sheet} · L{sample.row} · {sample.column}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {sample.originalValue} <span className="opacity-60">({sample.originalType})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <MeaningCard detail={detail} onSaved={onConfirmed} />

      <ConfirmarInterpretacao detail={detail} onConfirmed={onConfirmed} />

      {detail.events.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Histórico de curadoria</CardTitle>
            <p className="text-xs text-muted-foreground">
              Alterações nossas, registradas como CURATION_CHANGE. Nenhuma delas
              toca um fato da Ambev.
            </p>
          </CardHeader>
          <CardContent className="p-0 max-h-72 overflow-y-auto">
            {detail.events.map((event, index) => (
              <div key={index} className="px-4 py-2 border-b last:border-0 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-xs">{event.field}</span>
                  <span className="text-xs text-muted-foreground">{event.actor}</span>
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {event.valueBefore ?? "—"} → {event.valueAfter ?? "—"}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Confirmar interpretação do campo — o ato que destrava dinheiro.
 *
 * ---------------------------------------------------------------------------
 * O que este card deixou de perguntar, e por quê
 * ---------------------------------------------------------------------------
 * Ele pedia quatro respostas técnicas: unidade, periodicidade, agregação e
 * "é um montante financeiro (entra em somas)". Só a primeira era uma pergunta
 * de verdade — e nem essa, do jeito que estava escrita. Quem sabe que
 * `manutencaoReaisKm` vale R$ 0,38 por quilômetro rodado já disse, com isso,
 * que a unidade é uma razão monetária, que não há periodicidade, que a soma
 * entre veículos não produz grandeza nenhuma e que aquilo não é montante. As
 * outras três eram pedir à pessoa que derivasse à mão o que o sistema deriva —
 * e quatro campos independentes são quatro portas para a contradição entrar.
 *
 * Agora são duas perguntas, e as duas são de negócio:
 *
 * - **O que este valor representa?** — o significado econômico, do cadastro.
 * - **Categoria** — onde ele entra na conta.
 *
 * A derivação é de `@workspace/curation/significado`, **a mesma função que a
 * API usa para gravar**. A tela não tem uma cópia da regra: se tivesse, ela
 * seria a primeira a sair de sincronia, mostrando uma coisa enquanto o banco
 * grava outra.
 *
 * ---------------------------------------------------------------------------
 * A terceira pergunta, que aparece uma vez em muitas
 * ---------------------------------------------------------------------------
 * `R$ por veículo` é dinheiro, é somável na frota, e não diz de que período —
 * e o período decide em qual dos três totais da composição ele cai. Escolher um
 * por conta própria seria inventar; recusar o significado empurraria a pessoa a
 * mentir num rótulo mais específico. Então a tela pergunta, em português, só
 * nesse caso. É estritamente menos do que antes, quando a periodicidade era
 * perguntada para **todas** as colunas.
 */
function ConfirmarInterpretacao({
  detail,
  onConfirmed,
  emGaveta = false,
}: {
  detail: AttributeDetail;
  onConfirmed: () => void;
  /**
   * As mesmas perguntas, sem a moldura do card.
   *
   * A gaveta já tem cabeçalho, título e nome do atributo — repetir a moldura
   * dentro dela colocaria um card com borda dentro de um painel com borda, e o
   * botão de IA cairia num terceiro nível de cabeçalho. O que muda é só o
   * envelope: as perguntas, a derivação e a confirmação são as mesmas, porque
   * duas cópias do formulário seriam duas oportunidades de discordarem sobre o
   * que a confirmação grava.
   */
  emGaveta?: boolean;
}) {
  const queryClient = useQueryClient();

  const { data: catalogo = [] } = useQuery({
    queryKey: ["curation", "significados"],
    queryFn: () => fetchJson<OpcaoDeSignificado[]>("/curation/significados"),
  });
  const { data: categorias = [] } = useQuery({
    queryKey: ["curation", "categorias"],
    queryFn: () => fetchJson<OpcaoDeCategoria[]>("/curation/categorias"),
  });
  /*
    As linhas da DRE vêm do servidor, e não das categorias.

    Derivá-las das categorias — que era o que esta tela fazia — dá a lista certa
    enquanto ninguém cria nada, e some com a linha nova exatamente quando ela
    importa: recém-criada, ela ainda não tem analítico dentro, e uma linha que
    desaparece no instante seguinte ao do clique é indistinguível de uma criação
    que falhou.
  */
  const { data: sinteticos = [] } = useQuery({
    queryKey: ["curation", "sinteticos"],
    queryFn: () => fetchJson<OpcaoDeSintetico[]>("/curation/sinteticos"),
  });

  const campo: CampoEmConfirmacao = {
    meaningCode: detail.meaningCode,
    unit: detail.unit,
    periodicity: detail.periodicity,
    aggregation: detail.aggregation,
    isMonetary: detail.isMonetary,
    taxonomyCode: detail.taxonomyCode,
    semanticsStatus: detail.semanticsStatus,
    dataType: detail.dataType,
    history: detail.history,
  };

  /*
    O significado abre preenchido com o que já se sabe — gravado, ou lido de
    volta dos quatro campos técnicos de quem foi curado antes desta tela
    existir. É o que impede a mudança de interface de parecer, para quem opera,
    perda da curadoria de 10/08/2026.
  */
  const jaSabido = significadoAtual(campo, catalogo);
  const [meaningCode, setMeaningCode] = useState<string | null>(
    detail.meaningCode ?? null,
  );
  const [taxonomyCode, setTaxonomyCode] = useState<string | null>(
    detail.taxonomyCode ?? null,
  );
  /**
   * A linha da DRE escolhida **antes** de haver categoria — e só isso.
   *
   * Quando `taxonomyCode` existe, a classe sai dele; este estado só vale no
   * intervalo entre escolher o sintético e escolher o analítico. É por isso que
   * ele não entra em `Escolhas` nem sobe na confirmação: não é uma resposta, é
   * o filtro da segunda lista enquanto a resposta não existe.
   */
  const [sinteticoPendente, setSinteticoPendente] = useState<string | null>(null);
  /**
   * A regra pela qual este valor muda — e por que ela é texto, e não lista.
   *
   * Esta pergunta ocupa o lugar em que a tela perguntava a classe de custo
   * ("como este valor se comporta?", fixo ou variável). A troca não é de
   * rótulo: a classe é uma escolha entre três, e o que quem cura de fato sabe
   * sobre uma coluna como o IPVA é uma frase — "revisão semestral" — que
   * nenhuma das três guarda. A classe continua existindo em
   * `attribute.cost_class`, proposta pela família da categoria; o que saiu foi
   * a pergunta, não a coluna.
   *
   * Texto livre pelo mesmo motivo de `calculation_basis`: o vocabulário das
   * regras de reajuste é da operação do cliente, e uma lista fechada faria quem
   * sabe a regra escolher a opção menos errada.
   */
  const [changeRule, setChangeRule] = useState(detail.changeRule ?? "");
  const [periodicity, setPeriodicity] = useState<string | null>(detail.periodicity);
  const [error, setError] = useState<string | null>(null);
  const [erroDoCadastro, setErroDoCadastro] = useState<string | null>(null);
  const [verAnalise, setVerAnalise] = useState(false);

  /*
    A leitura por IA continua existindo — o que mudou é onde ela cai.

    Antes ela preenchia quatro selects técnicos. Agora ela responde nos mesmos
    quatro campos (é o vocabulário do modelo, e trocá-lo é outra entrega), e é a
    **autoridade** que traduz a resposta em significado: `significadoPara` é a
    mesma função que o servidor usa para reler semântica antiga. O modelo não
    ganhou voto sobre unidade nem agregação; ele opina sobre o campo, e a
    tradução é uma só.

    A categoria continua fora do alcance dela: não se lê no número em que
    linha da DRE o valor cai.
  */
  const [sugestao, setSugestao] = useState<SugestaoDeSemantica | null>(null);
  const [motivoSemSugestao, setMotivoSemSugestao] = useState<string | null>(null);
  const [antes, setAntes] = useState<{
    meaningCode: string | null;
    periodicity: string | null;
  } | null>(null);

  const sugerirComIA = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        getApiUrl(`/curation/attributes/${detail.code}/semantica/sugestao`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Falha ao sugerir");
      return body as { sugestao: SugestaoDeSemantica | null; motivo: string };
    },
    onSuccess: (body) => {
      if (!body.sugestao) {
        setSugestao(null);
        setAntes(null);
        setMotivoSemSugestao(body.motivo);
        return;
      }
      setMotivoSemSugestao(null);
      setAntes({ meaningCode, periodicity });
      setSugestao(body.sugestao);

      const lido = significadoPara({
        unit: body.sugestao.unidade,
        periodicity: body.sugestao.periodicidade,
        aggregation: body.sugestao.agregacao,
        isMonetary: body.sugestao.ehMonetario,
      });
      // Campo que o modelo não soube não apaga o que a pessoa já escolheu — a
      // franqueza dele não pode custar o trabalho dela.
      if (lido) setMeaningCode(lido.code);
      if (body.sugestao.periodicidade) setPeriodicity(body.sugestao.periodicidade);
    },
  });

  /*
    A pré-seleção pela leitura de volta espera o catálogo chegar — e só age
    enquanto ninguém escolheu nada. Sobrescrever depois apagaria a escolha de
    quem está na tela por causa de uma resposta de rede que chegou tarde.
  */
  useEffect(() => {
    if (meaningCode === null && jaSabido) setMeaningCode(jaSabido.code);
  }, [jaSabido, meaningCode]);

  const escolhas: Escolhas = {
    meaningCode,
    taxonomyCode,
    periodicity,
  };
  const escolhido = catalogo.find((o) => o.code === meaningCode) ?? null;
  const categoriaEscolhida = categorias.find((c) => c.code === taxonomyCode) ?? null;

  /*
    Os dois níveis da Categoria DRE — e **uma** escolha por baixo deles.

    O que se grava continua sendo `taxonomyCode`, o nó em que o caminho termina.
    O sintético não é um segundo campo guardado: é a classe daquele nó, e a única
    razão de ele existir na tela é filtrar a segunda lista. Guardá-lo em separado
    criaria o dia em que os dois discordam, e aí nenhum dos dois responde em que
    linha da DRE o valor cai.

    `sinteticoPendente` cobre o instante entre escolher a linha da DRE e escolher
    o detalhe dentro dela — enquanto nada foi classificado, não há nó de onde
    derivar a classe.
  */
  const sinteticoAtivo = categoriaEscolhida?.sintetico ?? sinteticoPendente;
  /*
    O sintético continua sendo guardado como nome — é o que a categoria devolve
    em `sintetico`, e é por nome que a lista do analítico é filtrada. O objeto
    inteiro é achado aqui porque a criação precisa do código da família.

    Não há mais a pergunta "esta linha decide lado da conta?": nenhuma decide. A
    classe de custo saiu da árvore e virou coluna do atributo, e por isso a
    categoria nova pode nascer dentro de qualquer família sem classificar nada.
  */
  const sinteticoEscolhido =
    sinteticos.find((s) => s.nome === sinteticoAtivo) ?? null;
  const analiticasVisiveis = useMemo(
    () =>
      sinteticoAtivo === null
        ? categorias
        : categorias.filter((c) => c.sintetico === sinteticoAtivo),
    [categorias, sinteticoAtivo],
  );
  /*
    A repetição do sintético no analítico — oferecida só na linha cadastral.

    A linha que não remunera não se desdobra: placa, CNPJ e vigência não somam
    em total nenhum, e o detalhe dentro dela não muda número em tela alguma.
    Exigir um analítico ali é obrigar quem cura a inventar um nível que a DRE
    não tem — e o que se inventa por obrigação é a aproximação silenciosa que
    esta tela existe para não pedir. Nas outras linhas o homônimo continua
    recusado: dois nós de mesmo nome em alturas diferentes não se distinguem em
    relatório nenhum.
  */
  const repeteOSintetico = podeRepetirNoAnalitico(sinteticoEscolhido, analiticasVisiveis);
  const quadro = resumo(campo, escolhas, catalogo);
  const falta = oQueFalta(escolhas, catalogo);
  const pedePeriodo = precisaDoPeriodo(escolhas, catalogo);

  const confirm = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        getApiUrl(`/curation/attributes/${detail.code}/confirm`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          /*
            Só o significado, a categoria e — quando o significado deixa o
            período em aberto — o período. Unidade, agregação e natureza
            monetária não sobem: elas são derivadas no servidor, e mandá-las
            daqui reabriria pela API a porta que esta tela fechou.

            `actor` continua não indo: quem assina é a sessão.
          */
          body: JSON.stringify({
            meaningCode,
            periodicity: pedePeriodo ? periodicity : undefined,
            taxonomyCode: taxonomyCode ?? undefined,
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Falha ao confirmar");

      /*
        A regra de alteração vai numa chamada própria, e de propósito.

        Ela não é um dos campos que a confirmação assina: confirmar destrava
        soma de dinheiro — unidade, periodicidade, agregação —, e escrever por
        que o valor muda não destrava nada. É prosa, e prosa vai pela mesma rota
        que grava o nome gerencial e o "o que é": `saveMeaning`, que por
        contrato não toca `semantics_status`.

        Só sobe se mudou. Mandá-la em toda confirmação faria a caixa em que
        ninguém tocou chegar ao servidor como uma escrita, e um evento de
        curadoria por confirmação para um texto que ninguém digitou.

        Nenhuma das duas pede justificativa em prosa: a tela deixou de ter o
        campo, e quem assina as duas é a mesma sessão.
      */
      if (changeRule.trim() !== (detail.changeRule ?? "").trim()) {
        const regra = await fetch(
          getApiUrl(`/curation/attributes/${detail.code}/meaning`),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ changeRule }),
          },
        );
        const corpo = await regra.json();
        if (!regra.ok) {
          throw new Error(corpo.error ?? "Falha ao gravar a regra de alteração");
        }
      }
      return body;
    },
    onSuccess: () => {
      setError(null);
      onConfirmed();
    },
    onError: (err: Error) => setError(err.message),
  });

  /** Cadastrar um significado sem sair daqui. Ver `ComboboxCriavel`. */
  const criarSignificadoInline = async (
    label: string,
  ): Promise<OpcaoDeSignificado | null> => {
    setErroDoCadastro(null);
    const response = await fetch(getApiUrl("/curation/significados"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    const body = await response.json();
    if (!response.ok) {
      setErroDoCadastro(body.error ?? "Não consegui cadastrar este significado.");
      return null;
    }
    // `JA_EXISTE` não é erro: quem clicou queria aquilo escolhido no campo, e é
    // o que acontece. A frase explica por que o rótulo mudou de "R$/litro" para
    // "R$ por litro" debaixo do dedo dela.
    if (body.desfecho === "JA_EXISTE") setErroDoCadastro(body.mensagem);
    await queryClient.invalidateQueries({ queryKey: ["curation", "significados"] });
    return body.item as OpcaoDeSignificado | null;
  };

  /**
   * Cadastrar uma linha da DRE sem sair daqui.
   *
   * Mesmo motivo da criação de categoria, um nível acima: um primeiro nível
   * fechado obriga quem cura a pendurar o que ela quer dizer na linha *mais
   * parecida* que existe, e a DRE passa a somar numa linha que ninguém
   * escolheu. A linha nasce sem classe de custo — de que lado da conta ela cai
   * não se lê no nome, e nada abaixo dela entra num total até que se decida.
   */
  const criarSinteticoInline = async (
    name: string,
  ): Promise<OpcaoDeSintetico | null> => {
    setErroDoCadastro(null);
    const response = await fetch(getApiUrl("/curation/sinteticos"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = await response.json();
    if (!response.ok) {
      setErroDoCadastro(body.error ?? "Não consegui cadastrar esta linha da DRE.");
      return null;
    }
    if (body.desfecho === "JA_EXISTE") setErroDoCadastro(body.mensagem);
    await queryClient.invalidateQueries({ queryKey: ["curation", "sinteticos"] });
    return body.item as OpcaoDeSintetico | null;
  };

  const criarCategoriaInline = async (
    texto: string,
  ): Promise<OpcaoDeCategoria | null> => {
    setErroDoCadastro(null);
    /*
      Texto em branco é a linha de criação que aparece antes da primeira letra,
      e ela só é oferecida no cadastral (ver `podeRepetirNoAnalitico`): ali o
      que se cria é o analítico que repete o sintético, e o nome dele é o nome
      da linha escolhida. Sem esta substituição o clique subiria `name: ""` e o
      servidor recusaria pedindo um nome que a tela nunca perguntou.
    */
    const name = texto.trim() === "" ? (sinteticoAtivo ?? "") : texto;
    if (!name) return null;
    const response = await fetch(getApiUrl("/curation/categorias"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      /*
        A linha escolhida vai junto, e o cadastro decide se atende: nas três
        casas em que classificar decide dinheiro (custo fixo, variável e
        cadastral) a categoria nova entra sob "Não classificado", porque nascer
        lá dentro seria classificar sem justificativa. A prévia do combobox diz
        isso antes do clique, e o item devolvido traz o sintético real.
      */
      body: JSON.stringify({ name, sintetico: sinteticoEscolhido?.code ?? null }),
    });
    const body = await response.json();
    if (!response.ok) {
      setErroDoCadastro(body.error ?? "Não consegui cadastrar esta categoria.");
      return null;
    }
    if (body.desfecho === "JA_EXISTE") setErroDoCadastro(body.mensagem);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["curation", "categorias"] }),
      // A contagem de cada linha muda com a categoria nova, e é ela que a
      // segunda linha de cada opção mostra.
      queryClient.invalidateQueries({ queryKey: ["curation", "sinteticos"] }),
    ]);
    return body.item as OpcaoDeCategoria | null;
  };

  const vigencia = vigenciaDoDado(detail.history);

  /*
    O ícone de IA, uma vez só, exibido nos dois envelopes.

    Ele não é decoração do card: é a ação que responde "não sei o que preencher
    aqui". Por isso ele acompanha as perguntas para dentro da gaveta em vez de
    ficar no cabeçalho que a gaveta não tem — e por isso é um só, e não uma
    cópia por lugar: duas cópias divergem no dia em que uma ganhar estado de
    carregamento e a outra não.
  */
  const botaoDeIA = (
    <Button
      variant="outline"
      size="icon"
      className="shrink-0"
      onClick={() => sugerirComIA.mutate()}
      disabled={sugerirComIA.isPending}
      aria-label="Sugerir com IA o que preencher"
      title="Sugerir com IA o que preencher"
    >
      <Sparkles
        className={cn("h-4 w-4", sugerirComIA.isPending && "animate-pulse")}
      />
    </Button>
  );

  const corpo = (
    <>
      {/* 1. Resumo — o que já se sabe de um lado, o que falta do outro. Uma
          lista única faria a pessoa ler tudo para descobrir onde ela entra. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Resumo
          titulo="IA identificou"
          itens={quadro.identificado}
          tone="good"
          vazio="Nada foi identificado a partir dos valores."
        />
        <Resumo
          titulo="Falta confirmar"
          itens={quadro.faltaConfirmar}
          tone="warn"
          vazio="Nada — está tudo preenchido."
        />
      </div>

      {/* 2. O que a IA entendeu. Curto, e com o textão recolhido atrás de uma
          ação secundária: a análise completa é útil e não pode dominar a
          tela que existe para receber duas respostas.

          A caixa deixou de depender só de `semanticsRationale`. Ela era a
          única condição, e por isso a resposta ao clique no ícone de IA —
          a leitura, o motivo de não haver leitura, o erro da chamada — não
          tinha onde aparecer numa coluna que o motor nunca analisou: o botão
          respondia em silêncio, e "não deu nada" ficava indistinguível de
          "não fez nada". Agora a caixa aparece quando há o que dizer, venha
          do motor ou do clique. */}
      {(detail.semanticsRationale ||
        sugestao ||
        motivoSemSugestao ||
        sugerirComIA.isError) && (
        <div className="rounded-md border bg-muted/40 px-3 py-3 space-y-2">
          {detail.semanticsRationale && (
            <>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                O que a IA entendeu
              </div>
              <p className="text-sm">{entendimentoCurto(detail, jaSabido)}</p>
            </>
          )}
          <div className="flex flex-wrap items-center gap-2 empty:hidden">
            {detail.semanticsRationale && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setVerAnalise((v) => !v)}
              >
                {verAnalise ? "Ocultar análise completa" : "Ver análise completa da IA"}
              </Button>
            )}
            {/* O `Desfazer` só existe enquanto os campos ainda contêm o que a
                IA deixou. Depois de a pessoa mexer, restaurar apagaria a
                escolha dela, e não a do modelo. */}
            {antes &&
              sugestao &&
              (antes.meaningCode !== meaningCode ||
                antes.periodicity !== periodicity) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setMeaningCode(antes.meaningCode);
                    setPeriodicity(antes.periodicity);
                    setSugestao(null);
                    setAntes(null);
                  }}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  Desfazer a leitura da IA
                </Button>
              )}
          </div>
          {verAnalise && detail.semanticsRationale && (
            <p className="whitespace-pre-line border-t pt-2 text-sm text-muted-foreground">
              {detail.semanticsRationale}
            </p>
          )}
          {sugerirComIA.isError && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {sugerirComIA.error.message}
            </p>
          )}
          {motivoSemSugestao && (
            <p className="text-sm text-muted-foreground">
              {MOTIVO_SEM_SUGESTAO[motivoSemSugestao] ?? MOTIVO_SEM_SUGESTAO.ERRO}
            </p>
          )}
          {sugestao && <LeituraDaIA sugestao={sugestao} />}
        </div>
      )}

      {/* 3. Confirmado pela IA — só o que já se sabe. "Pode ser somado entre
          veículos?" saiu daqui de propósito: a agregação é consequência da
          semântica, e não uma pergunta nem uma resposta a exibir. */}
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Confirmado pela IA
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Metric label="Vigência do dado" value={vigencia ?? "—"} />
          <Metric
            label="Natureza do campo"
            value={
              jaSabido?.isMonetary === true || jaSabido?.unit?.startsWith("BRL")
                ? "Valor financeiro"
                : jaSabido
                  ? leituraDe(jaSabido).natureza
                  : "—"
            }
          />
        </div>
      </div>

      {/* 4. As duas perguntas. */}
      <div className="space-y-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Precisa da sua confirmação
        </div>

        <Field
          label="O que este valor representa?"
          hint="Escolha a interpretação econômica do valor. O FreightCheck deriva os campos técnicos automaticamente."
        >
          <ComboboxCriavel
            itens={catalogo}
            valor={escolhido}
            aoEscolher={(item) => {
              setMeaningCode(item.code);
              setErroDoCadastro(null);
            }}
            aoCriar={criarSignificadoInline}
            rotuloDe={(item) => item.label}
            chaveDe={(item) => item.code}
            detalheDe={(item) => leituraDe(item).natureza}
            previaDe={(texto) =>
              previaDaCriacao(texto)?.natureza ??
              "Não consegui entender esse formato — tente “R$ por hora”, “Percentual” ou “Quantidade”."
            }
            placeholder="Pesquisar ou cadastrar…"
            erro={erroDoCadastro}
          />
          {escolhido && (
            // A consequência da escolha, dita antes de confirmar. É onde a
            // regra de agregação aparece — como leitura, nunca como campo.
            <p className="text-xs text-muted-foreground">
              {leituraDe(escolhido).agregacao}
            </p>
          )}
        </Field>

        {pedePeriodo && (
          <Field
            label="De quanto em quanto tempo este valor é pago?"
            hint="Este significado é dinheiro que se acumula, e não diz de que período. Sem isso não há em que total colocá-lo."
          >
            <div className="space-y-1.5">
              {PERIODOS_EM_ABERTO.map((opcao) => (
                <label
                  key={opcao.periodicity}
                  className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
                >
                  <input
                    type="radio"
                    name="periodo"
                    className="mt-1"
                    checked={periodicity === opcao.periodicity}
                    onChange={() => setPeriodicity(opcao.periodicity)}
                  />
                  <span>
                    <span className="font-medium">{opcao.rotulo}</span>
                    <span className="block text-xs text-muted-foreground">
                      {opcao.ajuda}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </Field>
        )}

        {/* "Categoria DRE", e não "Categoria": são os mesmos campos que as
            colunas de mesmo nome da planilha de atributos preenchem, e dois
            nomes para o mesmo campo fazem quem preenche a planilha procurar
            na tela um campo que não existe. O nome também diz o que a escolha
            decide — em que linha da DRE a coluna cai. */}
        <Field
          label="Categoria DRE - Sintético"
          hint="A linha da DRE que totaliza. Sozinha ela não classifica: escolher aqui filtra a lista do analítico. Pesquise ou cadastre uma nova."
        >
          {/*
            Criável, como o analítico, e pelo mesmo motivo: um primeiro nível
            fechado obriga quem cura a pendurar o que ela quer dizer na linha
            *mais parecida* que existe, e aí a DRE soma numa linha que ninguém
            escolheu, sem que tela nenhuma acuse.
          */}
          <ComboboxCriavel
            itens={sinteticos}
            valor={sinteticoEscolhido}
            aoEscolher={(item) => {
              setSinteticoPendente(item.nome);
              /*
                Trocar a linha da DRE derruba o analítico que pertencia à
                anterior. É a diferença que importa: sem isto a tela ficaria
                mostrando "Custo Fixo" com "Combustível" embaixo, e o par que
                a confirmação gravaria seria o antigo — o sintético é derivado
                do nó, e é o nó que manda.
              */
              if (categoriaEscolhida && categoriaEscolhida.sintetico !== item.nome) {
                setTaxonomyCode(null);
              }
              setErroDoCadastro(null);
            }}
            aoCriar={criarSinteticoInline}
            rotuloDe={(item) => item.nome}
            detalheDe={(item) => leituraDoSintetico(item)}
            previaDe={() =>
              "Entra como linha nova da DRE, ainda sem lado da conta — de que lado ela cai não se lê no nome. " +
              "Até que se decida, o que estiver dentro dela fica fora dos totais de custo fixo e variável."
            }
            rotuloDeCriacao={(texto) => `Criar linha da DRE “${texto}”`}
            placeholder="Escolher ou cadastrar a linha da DRE…"
            erro={erroDoCadastro}
          />
        </Field>

        <Field
          label="Categoria DRE - Analítico"
          hint={
            sinteticoAtivo === null
              ? "Onde este valor entra na conta. Pesquise ou cadastre uma nova — escolher aqui preenche o sintético sozinho."
              : repeteOSintetico
                ? `O detalhe dentro de ${sinteticoAtivo}. Como esta linha não remunera, o analítico pode repetir o próprio sintético.`
                : `O detalhe dentro de ${sinteticoAtivo}. Pesquise ou cadastre uma nova.`
          }
        >
          <ComboboxCriavel
            /*
              Filtrada pelo sintético, e a lista inteira enquanto nenhum foi
              escolhido: quem já sabe o nome do analítico não deve ser obrigado
              a responder a classe antes para poder digitá-lo. Escolher pela
              lista cheia preenche o sintético sozinho, porque ele é derivado.
            */
            itens={analiticasVisiveis}
            valor={categoriaEscolhida}
            aoEscolher={(item) => {
              setTaxonomyCode(item.code);
              setSinteticoPendente(item.sintetico);
              setErroDoCadastro(null);
            }}
            aoCriar={criarCategoriaInline}
            rotuloDe={(item) => item.analitico || item.caminho}
            detalheDe={(item) =>
              sinteticoAtivo === null
                ? `${item.sintetico} · ${familiaDaCategoria(item)}`
                : familiaDaCategoria(item)
            }
            /*
              A prévia diz onde a categoria vai cair de verdade, antes do
              clique. Eram dois destinos possíveis enquanto três famílias
              decidiam lado da conta e por isso não recebiam categoria nova; a
              classe saiu da árvore, e agora a categoria nasce onde quem
              escolheu mandou — ou no limbo, quando ninguém escolheu.
            */
            previaDe={(texto) =>
              texto === ""
                ? `Cria “${sinteticoAtivo}” também como analítico, dentro dela mesma. ` +
                  "A linha cadastral não soma em total nenhum, e o par sintético/analítico " +
                  "fica completo sem inventar um detalhe que a DRE não tem."
                : sinteticoEscolhido
                  ? `Entra em ${sinteticoAtivo}. Dizer o que a coluna é não diz o que a faz mudar — ` +
                    "isso é o campo abaixo, e é por atributo."
                  : "Entra como categoria nova, sob “Não classificado” — escolha a família acima " +
                    "para que ela nasça no lugar certo."
            }
            rotuloDeCriacao={(texto) => `Criar categoria “${texto}”`}
            /*
              A linha de criação antes da primeira letra, e só no cadastral: é
              o "repetir o sintético" do pedido. Sem ela, o único caminho seria
              digitar de novo, à mão e sem errar acento nem parêntese, o nome
              que já está escrito no campo de cima.
            */
            rotuloDeCriacaoVazia={
              repeteOSintetico ? `Repetir “${sinteticoAtivo}” no analítico` : undefined
            }
            placeholder="Pesquisar ou cadastrar…"
            erro={erroDoCadastro}
          />
        </Field>

        {/* A regra de alteração fica **depois** da categoria e é outra
            pergunta: a de cima diz o que o valor é, esta diz o que o faz
            mudar. Aqui ficava a classe de custo — fixo ou variável —, e a
            troca não é de rótulo: o que quem cura sabe sobre uma coluna como
            o IPVA é uma frase, e nenhuma das três opções guardava frase
            nenhuma. */}
        <Field
          label="Regra de Alteração"
          hint="O que faz esta coluna mudar de valor: revisão semestral, reajuste anual por índice, renegociação de tabela. Não é a fórmula do número de hoje — é o que faz a fórmula de hoje deixar de valer."
        >
          <Textarea
            value={changeRule}
            onChange={(e) => setChangeRule(e.target.value)}
            placeholder="Ex.: revisão semestral do percentual sobre o valor da nota de compra."
            rows={2}
          />
          {/* A consequência da escrita, dita antes de confirmar — a mesma
              honestidade do rodapé do card "Significado". É prosa: entra no
              cadastro do atributo e não move `semantics_status`. */}
          <p className="text-xs text-muted-foreground">
            Texto livre, e não destrava cálculo: é o registro de por que este
            número muda, para quem for ler a série depois.
          </p>
        </Field>
      </div>

      {/* 8. Estado incompleto — dito por extenso, e não por um botão cinza
          que não explica o que falta. */}
      {falta && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {falta}
        </p>
      )}
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <Button
        onClick={() => confirm.mutate()}
        disabled={confirm.isPending || !podeConfirmar(escolhas, catalogo)}
      >
        {confirm.isPending ? "Confirmando…" : "Confirmar interpretação"}
      </Button>
    </>
  );

  if (emGaveta) {
    return (
      <div className="space-y-6">
        {/* A oferta da IA vem antes das perguntas, e dita por extenso: um ícone
            sozinho no alto de um formulário não diz o que ele faria com os
            campos, e o que ele faz é escrever dentro deles. */}
        <div className="flex items-start justify-between gap-3 rounded-md border border-dashed px-3 py-3">
          <p className="text-xs text-muted-foreground">
            Não sabe o que preencher? A IA lê os valores já importados desta
            coluna e propõe o significado — é palpite, e nada é gravado enquanto
            você não confirmar.
          </p>
          {botaoDeIA}
        </div>
        {corpo}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="text-base">
              Confirmar interpretação do campo
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              A IA analisou os dados e preencheu o que conseguiu. Revise os itens
              abaixo antes de confirmar.
            </p>
          </div>
          {botaoDeIA}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">{corpo}</CardContent>
    </Card>
  );
}

/**
 * A gaveta de cadastro — as perguntas da curadoria, abertas pela linha da fila.
 *
 * ---------------------------------------------------------------------------
 * Por que gaveta, e não a mesma coluna da direita
 * ---------------------------------------------------------------------------
 * O painel da direita é para **ler** o atributo: a proposta do motor, a tabela
 * de valores reais com a origem de cada um, o nome gerencial, o histórico de
 * curadoria. As perguntas que destravam o dinheiro ficam no fim dessa leitura,
 * e é a ordem certa para quem ainda não sabe o que a coluna é.
 *
 * Só que quem cura uma fila de 121 colunas quase sempre já sabe: reconhece o
 * nome, sabe em que linha da DRE aquilo cai, e o que ela precisa é dizer isso e
 * passar para a próxima. Para essa pessoa, o caminho até os campos era três
 * rolagens por atributo — e a tela cobrava esse pedágio 121 vezes.
 *
 * A gaveta abre por cima, com a fila atrás e visível: fechar devolve o dedo
 * exatamente na linha seguinte. É a mesma escolha da gaveta da Cobertura, pelo
 * mesmo motivo — o que se está respondendo é sobre **uma** linha, e a linha não
 * pode sair do campo de visão.
 *
 * ---------------------------------------------------------------------------
 * A gaveta não carrega o formulário; ela o pede
 * ---------------------------------------------------------------------------
 * A linha da fila tem `QueueItem`, que é o resumo. O formulário precisa do
 * atributo inteiro — o histórico decide a vigência exibida, `semanticsRationale`
 * decide o que a caixa da IA mostra — e por isso a gaveta faz a **mesma**
 * consulta do painel da direita, com a **mesma** chave. Duas chaves para o
 * mesmo atributo dariam duas cópias livres para divergir; com uma, abrir a
 * gaveta do atributo já aberto não custa uma chamada, e confirmar por um lado
 * atualiza o outro.
 *
 * E o formulário é literalmente o mesmo componente do painel — em `emGaveta`,
 * que troca só o envelope. Uma segunda cópia dos campos seria a primeira coisa
 * a sair de sincronia com o que a confirmação grava.
 */
function GavetaDeCadastro({
  codigo,
  aoFechar,
  aoConfirmar,
}: {
  codigo: string | null;
  aoFechar: () => void;
  aoConfirmar: () => void;
}) {
  const consulta = useQuery({
    queryKey: ["curation", "attribute", codigo],
    queryFn: () => fetchJson<AttributeDetail>(`/curation/attributes/${codigo}`),
    enabled: codigo !== null,
  });

  const detail = consulta.data;

  return (
    <Sheet open={codigo !== null} onOpenChange={(aberto) => !aberto && aoFechar()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        <header className="shrink-0 border-b px-6 pb-4 pt-6">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <ClipboardPen className="h-3.5 w-3.5" />
            Cadastro do atributo
          </div>

          {/* O nome gerencial manda quando existe; sem ele, o código — que é o
              que a linha da fila mostrava, e trocar o rótulo entre o clique e a
              gaveta faria duvidar de qual atributo abriu. */}
          <SheetTitle
            className={cn(
              "mt-1.5 pr-8 text-lg font-bold tracking-tight",
              !detail?.displayName && "font-mono",
            )}
          >
            {detail?.displayName ?? detail?.sourceName ?? codigo}
          </SheetTitle>

          <SheetDescription className="mt-1 font-mono text-xs">
            {detail?.displayName && <>{detail.sourceName} · </>}
            {codigo}
            {detail && (
              <>
                {" · "}
                {detail.entityType} · tipo {detail.dataType}
              </>
            )}
          </SheetDescription>

          {detail && (
            <div className="mt-2.5">
              <StatusBadge status={detail.semanticsStatus} />
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {consulta.isLoading && (
            <p className="text-sm text-muted-foreground">Carregando o atributo…</p>
          )}

          {/*
            A falha não vira formulário em branco. Um cadastro que abre com
            todos os campos vazios porque a chamada não voltou é indistinguível
            de um atributo que ninguém curou — e a diferença decide se o que se
            responder aqui vai por cima de uma curadoria que já existe.
          */}
          {consulta.isError && (
            <div className="space-y-2 rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800">
              <p>
                Não consegui abrir o cadastro deste atributo. Sem a resposta do
                servidor não dá para dizer o que já está preenchido nele, e por
                isso os campos não abrem.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                disabled={consulta.isFetching}
                onClick={() => consulta.refetch()}
              >
                {consulta.isFetching ? "Tentando…" : "Tentar de novo"}
              </Button>
            </div>
          )}

          {detail && (
            /* Chaveado pelo código pelo mesmo motivo do painel da direita: os
               campos nascem de `useState(detail…)`, e sem a chave a gaveta
               reaberta em outro atributo mostraria as respostas do anterior. */
            <ConfirmarInterpretacao
              key={detail.code}
              detail={detail}
              emGaveta
              onConfirmed={() => {
                aoConfirmar();
                /* Fecha ao confirmar: a gaveta existe para responder e seguir
                   para a próxima linha, e deixá-la aberta sobre o formulário já
                   assinado convida a confirmar duas vezes o mesmo atributo. */
                aoFechar();
              }}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Uma coluna do quadro-resumo. Sem item, diz que não há — nunca fica vazia. */
function Resumo({
  titulo,
  itens,
  tone,
  vazio,
}: {
  titulo: string;
  itens: string[];
  tone: "good" | "warn";
  vazio: string;
}) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div
        className={cn(
          "text-xs font-semibold uppercase tracking-wide",
          tone === "good" ? "text-emerald-700" : "text-amber-700",
        )}
      >
        {titulo}
      </div>
      {itens.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">{vazio}</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-sm">
          {itens.map((item, indice) => (
            <li key={indice} className="flex items-start gap-1.5">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current opacity-40" />
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * "O que a IA entendeu", em duas frases.
 *
 * Escrito daqui, e não copiado de `semanticsRationale`: aquele texto é a
 * justificativa técnica do motor — cita unidade, agregação e classe da
 * taxonomia — e é exatamente o vocabulário que esta tela deixou de expor. Ele
 * continua inteiro, atrás de "Ver análise completa".
 *
 * A segunda frase é a mais importante da tela e é uma confissão: dizer o que a
 * IA **não** conseguiu decidir é o que evita a confirmação por inércia de um
 * palpite plausível.
 */
function entendimentoCurto(
  detail: AttributeDetail,
  significado: OpcaoDeSignificado | null,
): string {
  const nome = detail.displayName ?? detail.sourceName;
  const entidade = detail.entityType.toLowerCase();

  const primeira = significado
    ? `Este campo parece representar ${leituraDe(significado).natureza.toLowerCase().replace(/\.$/, "")} por ${entidade}.`
    : `Não foi possível ler, a partir dos valores, que grandeza "${nome}" mede.`;

  if (detail.semanticsStatus === "CONFIRMED") {
    return `${primeira} A interpretação já foi confirmada; alterá-la exige uma nova confirmação assinada.`;
  }

  return (
    `${primeira} Não foi possível identificar o significado econômico exato do valor — por exemplo, se ` +
    `representa R$ por litro, R$ por km, R$ por mês, um valor total ou outro formato — nem a qual ` +
    `categoria ele pertence.`
  );
}

interface SugestaoDeSemantica {
  unidade: string | null;
  periodicidade: string | null;
  agregacao: string | null;
  ehMonetario: boolean | null;
  confianca: "ALTA" | "MEDIA" | "BAIXA";
  justificativa: string;
  duvidas: string[];
}

/**
 * O que a IA leu, dito por extenso — ao lado dos campos, nunca dentro deles.
 *
 * Três coisas precisam aparecer aqui, e nenhuma delas cabe num select:
 *
 * - **A confiança**, porque um palpite de confiança baixa preenchido do mesmo
 *   jeito que um de confiança alta é uma armadilha. Ela sai em cor, que é o que
 *   se lê antes de ler.
 * - **O que sustentou o palpite**, para dar o que conferir contra a tabela de
 *   valores logo acima nesta mesma tela.
 * - **O que ela não soube**, com o que resolveria. É a parte mais útil da
 *   resposta e a que um formulário preenchido esconderia: um campo em branco não
 *   diz se ninguém olhou ou se ninguém conseguiu decidir.
 */
function LeituraDaIA({ sugestao }: { sugestao: SugestaoDeSemantica }) {
  return (
    <div className="rounded-md border bg-muted/40 px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
          Leitura da IA
        </span>
        <span
          className={cn(
            "text-xs font-medium",
            sugestao.confianca === "ALTA" && "text-emerald-700",
            sugestao.confianca === "MEDIA" && "text-amber-700",
            sugestao.confianca === "BAIXA" && "text-red-700",
          )}
        >
          confiança {sugestao.confianca.toLowerCase()}
        </span>
      </div>

      <p className="text-sm whitespace-pre-line">{sugestao.justificativa}</p>

      {sugestao.duvidas.length > 0 && (
        <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
          {sugestao.duvidas.map((duvida, index) => (
            <li key={index}>{duvida}</li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Escrita por IA a partir dos valores importados. É um palpite, não uma
        apuração: não confirma nada, não destrava cálculo e não substitui a
        confirmação assinada.
      </p>
    </div>
  );
}

/**
 * Por que não houve sugestão, dito para quem está curando a coluna.
 *
 * Nenhuma destas frases é erro do curador, e nenhuma pede ação dele sobre os
 * campos — por isso saem em texto normal, e não em vermelho de erro.
 */
const MOTIVO_SEM_SUGESTAO: Record<string, string> = {
  SEM_DADOS:
    "Este atributo não tem nenhum valor importado. Sem dado, sugerir semântica seria adivinhar pelo nome da coluna — que é justamente o que esta tela existe para não fazer.",
  SEM_CHAVE:
    "A sugestão por IA não está configurada neste ambiente. Os campos continuam funcionando normalmente.",
  RECUSA:
    "O modelo não quis opinar sobre esta coluna. Preencha os campos à mão, olhando os valores acima.",
  ERRO: "Não consegui ler agora. Tente de novo em alguns instantes.",
};


/**
 * Como a coluna se chama e o que ela significa — o passo barato da curadoria.
 *
 * Fica **acima** de "Confirmar semântica" porque são as perguntas que se
 * respondem primeiro: dizer "vidaCombustivel é a vida útil considerada em
 * contrato" não exige ter decidido se o número é mensal, e nem chamá-la de
 * "Vida útil do combustível". O card abaixo continua exigindo, como deve — a
 * diferença é que agora não é preciso passar por ele para registrar o que se
 * sabe.
 *
 * O nome mora aqui, e não no card de baixo, pela mesma razão: batizar é
 * vocabulário, não é afirmação sobre aritmética. `sourceName` nunca é
 * substituído — é por ele que a importação casa a coluna, e ele continua à
 * vista ao lado do apelido em toda tela.
 *
 * Salvar aqui não confirma nada e não destrava cálculo nenhum. O texto ao pé do
 * botão diz isso na tela, e não só aqui, porque um campo que parece destravar
 * dinheiro e não destrava é pior do que campo nenhum.
 */
function MeaningCard({
  detail,
  onSaved,
}: {
  detail: AttributeDetail;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(detail.displayName ?? "");
  const [definition, setDefinition] = useState(detail.definition ?? "");
  const [basis, setBasis] = useState(detail.calculationBasis ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /*
    O que o servidor gravou pela metade, e por quê. Hoje é um caso só: a fórmula
    de cálculo num atributo sem semântica versionada. Não sai em vermelho porque
    não é recusa do que a pessoa fez — o nome e o significado do mesmo clique
    foram salvos, e o texto da fórmula continua na caixa acima, à espera do
    backfill.
  */
  const [pendente, setPendente] = useState<string | null>(null);

  /*
    Só sobe o que a pessoa mexeu. Mandar os três campos em toda gravação fazia
    uma caixa vazia em que ninguém tocou chegar ao servidor como "apague isto",
    e a base de cálculo é o único dos três que exige semântica versionada — era
    por aí que dar um nome legível a uma coluna terminava numa recusa sobre
    backfill, um assunto que não é o de quem está batizando a coluna.

    `undefined` some no JSON.stringify, e é exatamente o que o servidor lê como
    "não mexa neste campo". Limpar continua possível: campo apagado difere do
    guardado e sobe como "", que vira NULL do outro lado.
  */
  const edits: {
    displayName?: string;
    definition?: string;
    calculationBasis?: string;
  } = {};
  if (displayName.trim() !== (detail.displayName ?? "").trim())
    edits.displayName = displayName;
  if (definition.trim() !== (detail.definition ?? "").trim())
    edits.definition = definition;
  if (basis.trim() !== (detail.calculationBasis ?? "").trim())
    edits.calculationBasis = basis;

  const dirty = Object.keys(edits).length > 0;

  const save = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        getApiUrl(`/curation/attributes/${detail.code}/meaning`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(edits),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Falha ao salvar");
      return body as { notWritten: { message: string } | null };
    },
    onSuccess: (body) => {
      setError(null);
      setSaved(true);
      setPendente(body.notWritten?.message ?? null);
      onSaved();
    },
    onError: (err: Error) => {
      setSaved(false);
      setPendente(null);
      setError(err.message);
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Significado</CardTitle>
        <p className="text-xs text-muted-foreground">
          Como esta coluna se chama e o que ela é, nas suas palavras. Pode ser
          escrito antes de saber a unidade ou a periodicidade — e é independente
          da confirmação.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field
          label="Nome gerencial"
          hint={`Um apelido de leitura, e só isso. A coluna importada continua sendo ${detail.sourceName} — é por ela que a importação encontra o dado, e ela nunca é renomeada nem sai das telas. Em branco, aparece o nome de origem.`}
        >
          <Input
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setSaved(false);
            }}
            placeholder={detail.sourceName}
          />
          {/* O apelido ao lado da origem, como a tela mostra de verdade: dizer
              "o nome importado continua vinculado" convence menos do que ver o
              par enquanto se digita. */}
          <p className="text-xs text-muted-foreground">
            Nas telas:{" "}
            <span className="font-medium text-foreground">
              {displayName.trim() || detail.sourceName}
            </span>
            {displayName.trim() && (
              <span className="font-mono"> · {detail.sourceName}</span>
            )}
          </p>
        </Field>

        <Field
          label="O que é"
          hint="A descrição que você daria a alguém que nunca viu esta planilha."
        >
          <Textarea
            value={definition}
            onChange={(e) => {
              setDefinition(e.target.value);
              setSaved(false);
            }}
            placeholder="Ex.: vida útil, em meses, considerada em contrato para o pneu."
            rows={3}
          />
          <DefinicaoPeloNome
            detail={detail}
            nome={displayName}
            formula={basis}
            definicao={definition}
            onEscrever={(texto) => {
              setDefinition(texto);
              setSaved(false);
            }}
          />
        </Field>

        <Field
          label="Fórmula de cálculo"
          hint="Quando se sabe. É o campo que faltava no caso do IPVA, que trocou de base de cálculo duas vezes sem mudar de unidade."
        >
          <Textarea
            value={basis}
            onChange={(e) => {
              setBasis(e.target.value);
              setSaved(false);
            }}
            placeholder="Ex.: 1,000% do valor da nota de compra."
            rows={2}
          />
          <FormulaSugerida
            detail={detail}
            nome={displayName}
            definicao={definition}
            formula={basis}
            onEscrever={(texto) => {
              setBasis(texto);
              setSaved(false);
            }}
          />
        </Field>

        {error && (
          <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        {pendente && !error && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            {pendente} O texto da fórmula continua na caixa acima.
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => save.mutate()}
            disabled={save.isPending || !dirty}
          >
            {save.isPending ? "Salvando…" : "Salvar nome e significado"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {saved && !dirty ? (
              <span className="text-emerald-700 font-medium">
                Salvo. O status não mudou — isto não é uma confirmação.
              </span>
            ) : (
              <>Não confirma nem destrava cálculo financeiro.</>
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * "Escreva isso por mim", a partir do nome que a pessoa acabou de dar.
 *
 * Quem escreve "Vida útil do pneu em contrato" no campo de cima já sabe o que a
 * coluna é — só ainda não escreveu a frase. O campo "O que é" ficava em branco
 * por isso: redigir a mesma coisa uma segunda vez, com sujeito e verbo, é
 * digitação, não curadoria. Este botão faz a digitação.
 *
 * Três decisões que a tela precisa deixar claras:
 *
 * - **Escreve no campo, não numa caixa ao lado.** O resultado é rascunho de
 *   quem clicou: entra no textarea aberto, dá para cortar, corrigir e reescrever
 *   antes de salvar. Uma sugestão em caixa separada, com botão "usar", seria um
 *   passo a mais para chegar ao mesmo lugar.
 * - **O que havia antes volta com um clique.** Um botão que apaga texto alheio
 *   sem volta não é ajuda. `Desfazer` fica à vista enquanto o texto for o que a
 *   IA escreveu, e some assim que a pessoa mexe nele — a partir daí restaurar
 *   apagaria o trabalho dela, não o da IA.
 * - **Lê o nome digitado, não o salvo.** O nome sobe no corpo do pedido. Pedir
 *   para salvar antes faria o rascunho custar o ato que ele existe para
 *   adiantar.
 *
 * Nada aqui grava: o campo continua precisando de "Salvar nome e significado",
 * e salvar continua não confirmando semântica nenhuma.
 */
function DefinicaoPeloNome({
  detail,
  nome,
  formula,
  definicao,
  onEscrever,
}: {
  detail: AttributeDetail;
  nome: string;
  formula: string;
  definicao: string;
  onEscrever: (texto: string) => void;
}) {
  /** O que estava escrito antes do rascunho, e o rascunho que o substituiu. */
  const [troca, setTroca] = useState<{ antes: string; depois: string } | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);

  const rascunhar = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        getApiUrl(`/curation/attributes/${detail.code}/definicao/rascunho`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: nome, calculationBasis: formula }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Falha ao escrever o rascunho");
      return body as { texto: string | null; motivo: string };
    },
    onSuccess: (body) => {
      if (!body.texto) {
        setMotivo(body.motivo);
        return;
      }
      setMotivo(null);
      setTroca({ antes: definicao, depois: body.texto });
      onEscrever(body.texto);
    },
  });

  const semNome = !nome.trim();
  // O `Desfazer` só vale enquanto o campo ainda contém o que a IA escreveu:
  // depois de a pessoa mexer, restaurar apagaria o texto dela.
  const podeDesfazer = troca !== null && definicao === troca.depois;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => rascunhar.mutate()}
          disabled={semNome || rascunhar.isPending}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {rascunhar.isPending ? "Escrevendo…" : "Escrever a partir do nome"}
        </Button>
        <p className="text-xs text-muted-foreground">
          {semNome
            ? "Dê o nome gerencial acima para a IA escrever esta descrição."
            : definicao.trim()
              ? "Reescreve o campo acima a partir do nome. Dá para desfazer."
              : "Preenche o campo acima a partir do nome. Nada é gravado."}
        </p>
      </div>

      {rascunhar.isError && (
        <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {rascunhar.error.message}
        </p>
      )}

      {motivo && (
        <p className="text-sm text-muted-foreground bg-muted/40 border rounded-md px-3 py-2">
          {MOTIVO_SEM_RASCUNHO[motivo] ?? MOTIVO_SEM_RASCUNHO.ERRO}
        </p>
      )}

      {podeDesfazer && (
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              onEscrever(troca.antes);
              setTroca(null);
            }}
          >
            <Undo2 className="h-3.5 w-3.5" />
            Desfazer
          </Button>
          <p className="text-xs text-muted-foreground">
            {troca.antes.trim()
              ? "Rascunho de IA, escrito por cima do texto anterior. Revise antes de salvar."
              : "Rascunho de IA a partir do nome acima. É um texto seu — corrija o que não estiver certo."}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Por que não houve rascunho, dito para quem está curando a coluna.
 *
 * `SEM_NOME` não deveria chegar pela tela — o botão fica desligado sem nome —,
 * mas a rota também é chamável com o nome guardado em branco, e uma frase é
 * mais barata do que descobrir por que a caixa não apareceu.
 */
const MOTIVO_SEM_RASCUNHO: Record<string, string> = {
  SEM_NOME: "Sem nome gerencial escrito, não há do que partir.",
  SEM_CHAVE:
    "A escrita por IA não está configurada neste ambiente. O campo continua funcionando normalmente.",
  RECUSA: "O modelo não quis escrever sobre este nome. Escreva a descrição à mão.",
  ERRO: "Não consegui escrever agora. Tente de novo em alguns instantes.",
};

/**
 * "Escreva a conta por mim", a partir do que a coluna já é.
 *
 * O campo "Fórmula de cálculo" é o que faltava no caso do IPVA: a coluna trocou
 * de base de cálculo duas vezes sem mudar de unidade, e nada na tela registrava
 * isso. Ele fica em branco porque quem cura já disse o que a coluna é nos dois
 * campos de cima e ainda precisa de um segundo ato de redação para escrever
 * como o número sai. Este botão escreve o primeiro rascunho dessa conta, com o
 * mesmo desenho do botão de "O que é" — e pelas mesmas decisões, que a tela
 * precisa deixar claras:
 *
 * - **Escreve no campo, não numa caixa ao lado.** O resultado é rascunho de
 *   quem clicou: entra no textarea aberto, dá para cortar, corrigir e
 *   reescrever antes de salvar. Uma sugestão em caixa separada, com botão
 *   "usar", seria um passo a mais para chegar ao mesmo lugar.
 * - **O que havia antes volta com um clique.** `Desfazer` fica à vista enquanto
 *   o texto for o que a IA escreveu, e some assim que a pessoa mexe nele — a
 *   partir daí restaurar apagaria o trabalho dela, não o da IA.
 * - **Lê o que está digitado, não o que está salvo.** Nome e descrição sobem no
 *   corpo do pedido. Pedir para salvar antes faria a sugestão custar o ato que
 *   ela existe para adiantar — e num atributo sem semântica versionada a base
 *   de cálculo nem pode ser gravada ainda.
 * - **É proposta, não apuração.** O modelo não lê contrato e não sabe qual
 *   percentual foi negociado: onde falta número, a frase vem com a lacuna
 *   nomeada, para a pessoa perguntar à fonte. O rodapé diz isso na tela, e não
 *   só aqui.
 *
 * Nada aqui grava: o campo continua precisando de "Salvar nome e significado",
 * e salvar continua não confirmando semântica nenhuma.
 */
function FormulaSugerida({
  detail,
  nome,
  definicao,
  formula,
  onEscrever,
}: {
  detail: AttributeDetail;
  nome: string;
  definicao: string;
  formula: string;
  onEscrever: (texto: string) => void;
}) {
  /** O que estava escrito antes da sugestão, e a sugestão que a substituiu. */
  const [troca, setTroca] = useState<{ antes: string; depois: string } | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);

  const sugerir = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        getApiUrl(`/curation/attributes/${detail.code}/formula/sugestao`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: nome, definition: definicao }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Falha ao sugerir a fórmula");
      return body as { texto: string | null; motivo: string };
    },
    onSuccess: (body) => {
      if (!body.texto) {
        setMotivo(body.motivo);
        return;
      }
      setMotivo(null);
      setTroca({ antes: formula, depois: body.texto });
      onEscrever(body.texto);
    },
  });

  // Nome **ou** descrição basta, como na rota: são os dois caminhos reais —
  // quem acabou de batizar a coluna, e quem abriu um atributo que outra pessoa
  // descreveu sem apelidar. Exigir os dois desligaria o botão nos dois casos em
  // que ele é mais útil.
  const semBase = !nome.trim() && !definicao.trim();
  // O `Desfazer` só vale enquanto o campo ainda contém o que a IA escreveu:
  // depois de a pessoa mexer, restaurar apagaria o texto dela.
  const podeDesfazer = troca !== null && formula === troca.depois;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => sugerir.mutate()}
          disabled={semBase || sugerir.isPending}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {sugerir.isPending ? "Sugerindo…" : "Sugerir fórmula"}
        </Button>
        <p className="text-xs text-muted-foreground">
          {semBase
            ? "Dê o nome gerencial ou a descrição acima para a IA propor a conta."
            : formula.trim()
              ? "Reescreve o campo acima a partir do que a coluna é. Dá para desfazer."
              : "Propõe a conta a partir do que a coluna é. Nada é gravado."}
        </p>
      </div>

      {sugerir.isError && (
        <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {sugerir.error.message}
        </p>
      )}

      {motivo && (
        <p className="text-sm text-muted-foreground bg-muted/40 border rounded-md px-3 py-2">
          {MOTIVO_SEM_FORMULA[motivo] ?? MOTIVO_SEM_FORMULA.ERRO}
        </p>
      )}

      {podeDesfazer && (
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              onEscrever(troca.antes);
              setTroca(null);
            }}
          >
            <Undo2 className="h-3.5 w-3.5" />
            Desfazer
          </Button>
          <p className="text-xs text-muted-foreground">
            {troca.antes.trim()
              ? "Fórmula proposta por IA, escrita por cima do texto anterior. Revise na fonte antes de salvar."
              : "Fórmula proposta por IA a partir do nome e da descrição acima. É uma hipótese, não uma conferência: onde falta número, a frase diz o que perguntar à fonte."}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Por que não houve fórmula sugerida, dito para quem está curando a coluna.
 *
 * `SEM_BASE` não deveria chegar pela tela — o botão fica desligado sem nome e
 * sem descrição —, mas a rota também é chamável com os dois guardados em
 * branco, e uma frase é mais barata do que descobrir por que a caixa não
 * apareceu.
 */
const MOTIVO_SEM_FORMULA: Record<string, string> = {
  SEM_BASE:
    "Sem nome gerencial e sem descrição, não há do que partir para propor a conta.",
  SEM_CHAVE:
    "A sugestão por IA não está configurada neste ambiente. O campo continua funcionando normalmente.",
  RECUSA: "O modelo não quis propor uma fórmula aqui. Escreva-a à mão.",
  ERRO: "Não consegui sugerir agora. Tente de novo em alguns instantes.",
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}
