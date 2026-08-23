import { useEffect, useRef, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Clock,
  Columns3,
  DollarSign,
  Folder,
  Headset,
  Layers,
  Loader2,
  SlidersHorizontal,
  Trash2,
  TrendingDown,
  Upload,
  Zap,
} from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error";
import {
  LimparRecorte,
  SeletorDeJanela,
  type JanelaDeVigencias,
} from "@/components/changes/janela-vigencias";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Aviso,
  brl0,
  MetricCard,
  TituloDePainel,
} from "@/components/changes/cartoes";
import { TicketClassification } from "@/components/changes/ticket-classification";
import {
  TicketChangeTable,
  TicketFilterPanel,
  emptyTicketFilters,
  toTicketQuery,
  type OrdemChamados,
  type TicketChangeRow,
  type TicketFilters as TicketFilterState,
  type TicketTotals,
} from "@/components/changes/ticket-table";
import { impactEntries } from "@/lib/format";
import { erroDaResposta, fetchJson, getApiUrl, readJson } from "@/lib/api";
import { paramsDoEscopo, type EscopoDeFrota } from "@/lib/frota";
import { primeiraPagina, type Janela } from "@/lib/paginacao";
import { cn } from "@/lib/utils";

interface TicketImportSummary {
  id: string;
  filename: string;
  status: string;
  receivedAt: string;
  receivedBy: string | null;
  rowCount: number;
  ticketCount: number;
  ignoredRowCount: number;
  unmappedColumns: string[];
  parameterColumns: string[];
  columnMapping: Record<
    string,
    { header: string; match: string; reason: string }
  >;
  failureReason: string | null;
}

/** Quanta coisa uma exclusão tira — a mesma conta que a API faz antes e depois. */
interface TicketImportDeletionCounts {
  tickets: number;
  ticketChanges: number;
  duplicateAttempts: number;
  storedFile: number;
}

interface TicketImportDeletionPlan {
  ticketImportId: string;
  filename: string;
  status: string;
  /** Por que não dá para excluir agora — null quando dá. */
  refusal: string | null;
  removes: TicketImportDeletionCounts;
}

interface TicketImportDeletionResult extends TicketImportDeletionPlan {
  removed: TicketImportDeletionCounts;
}

interface TicketsResponse {
  import: TicketImportSummary | null;
  imports: TicketImportSummary[];
  totals: TicketTotals | null;
  byParameter: {
    parameterLabel: string;
    attributeCode: string | null;
    count: number;
    impactSum: number | null;
  }[];
  /**
   * As vigências que os chamados deste envio nomeiam — o eixo do recorte.
   *
   * Sai do próprio envio, e não do contexto de vigências: chamado não tem
   * unidade nem canal em lugar nenhum deste produto, e montar as opções a partir
   * de uma unidade escolhida por padrão faria a aba recortar por algo que
   * ninguém pediu. O que o chamado tem é a coluna `Vig. Abertura`.
   */
  vigencias: {
    disponiveis: string[];
    rotulos: Record<string, string>;
    /** Alterações sem vigência legível — fora de qualquer recorte, por construção. */
    semVigencia: number;
  };
  janela: { de?: string; ate?: string } | null;
  /** Quantas vigências o recorte de fato alcançou neste envio. */
  vigenciasNoRecorte: number;
  total: number;
  rows: TicketChangeRow[];
}

/** Os nomes dos campos, para a tela explicar o mapeamento sem jargão. */
const NOMES_DE_CAMPO: Record<string, string> = {
  externalId: "número do chamado",
  openedAt: "abertura",
  closedAt: "fechamento",
  statusRaw: "status",
  parameterLabel: "parâmetro",
  entityLabel: "placa",
  entityType: "tipo de equipamento",
  requestedValueRaw: "valor pedido",
  appliedValueRaw: "valor aplicado",
  requestedBy: "solicitante",
  subject: "assunto",
};

/**
 * Chamados — os parâmetros que os chamados mexeram.
 *
 * O grão é o mesmo da aba Planilha: um parâmetro que mudou. Um chamado que
 * mexe em oito parâmetros produz oito linhas — o export vem no formato largo,
 * com dezenas de colunas de parâmetro por linha, e cada célula preenchida é
 * uma alteração.
 *
 * A régua é que é outra. Lá o "antes" é a vigência anterior, apurada célula a
 * célula; aqui ele é declarado pelo chamado ou lido da vigência em vigor, e a
 * tela marca qual dos dois. E o impacto só é afirmado depois de o chamado ser
 * atendido — antes disso existe variação, não dinheiro que mudou de mãos.
 */
/**
 * Qual disclosure está aberta abaixo da fileira de avisos.
 *
 * Um só de cada vez, e nenhuma por padrão: os avisos dizem o tamanho do
 * problema em uma linha, e o detalhe — que é longo — só ocupa a tela de quem
 * pediu para vê-lo.
 */
type Painel = "falhas" | "colunas" | "ignoradas" | null;

/**
 * As duas visões da aba, e a divisão de trabalho entre elas.
 *
 * **Resumo** é a lista: o que mudou, ordenado por materialidade, com filtro,
 * busca e a linha de cada alteração. **Por tipo** é a mesma população dobrada
 * pelos componentes da remuneração — fixo, variável, variável diesel —, que é a
 * pergunta que vem antes: *o mês mexeu em quê?*
 *
 * São visões e não abas novas de propósito: o arquivo é o mesmo, os avisos de
 * leitura são os mesmos, e a procedência no topo é a mesma. O que muda é por
 * onde se entra nos números.
 */
type Visao = "resumo" | "tipos";

/**
 * `escopo` é o que torna esta aba reaproveitável pelas telas 360°.
 *
 * Ele não é mais um filtro — ver `lib/frota.ts`. Aqui a diferença é a mais
 * gritante do produto: o arquivo de chamados tem 1.218 alterações, e uma tela
 * chamada "Cavalo 360°" com esse número no cartão em cima de uma lista de
 * cavalos seria a mentira mais visível que dá para escrever. Por isso o escopo
 * vai também para `/tickets`, que reconta os cartões, os painéis e a árvore por
 * tipo — nenhum filtro desta aba faz isso, e é essa a distinção.
 *
 * O que **não** muda com o escopo é a importação: enviar e excluir um export
 * continuam sendo do arquivo inteiro, porque é isso que eles são. Um botão de
 * excluir dentro de Cavalo 360° que apagasse só os chamados do cavalo não
 * existe do outro lado — o envio é indivisível —, e a caixa de confirmação
 * continua dizendo quantos chamados saem, do arquivo todo.
 */
export function AbaChamados({
  escopo,
  vigencias = {},
  onVigencias,
}: {
  escopo?: EscopoDeFrota;
  /** O recorte De/Até, partilhado com as outras abas de Alterações. */
  vigencias?: JanelaDeVigencias;
  /** Ausente nas telas 360°, que não oferecem o recorte. */
  onVigencias?: (j: JanelaDeVigencias) => void;
} = {}) {
  const [filters, setFilters] = useState<TicketFilterState>(emptyTicketFilters);
  const [visao, setVisao] = useState<Visao>("resumo");
  const [envio, setEnvio] = useState<string | null>(null);
  // O erro inteiro, e não a frase dele: `ApiErrorNotice` precisa do status e do
  // `code` para separar "o arquivo não serve" de "o banco deste ambiente ainda
  // não tem as tabelas".
  const [erroUpload, setErroUpload] = useState<unknown>(null);
  const [painel, setPainel] = useState<Painel>(null);
  const [janela, setJanela] = useState<Janela>(primeiraPagina);
  /*
    A ordem pedida no cabeçalho da tabela vive aqui, e não lá dentro, porque
    quem ordena é o servidor: com a lista paginada, ordenar as cem linhas que
    chegaram diria "o maior desta página" com a cara de "o maior de todos".
  */
  const [ordem, setOrdem] = useState<OrdemChamados>(null);
  /** O envio que a caixa de confirmação está prestes a apagar. */
  const [excluindo, setExcluindo] = useState<TicketImportSummary | null>(null);
  const [excluido, setExcluido] = useState<string | null>(null);
  const [erroExclusao, setErroExclusao] = useState<unknown>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const recortado = vigencias.de !== undefined || vigencias.ate !== undefined;

  // Filtrar, recortar, trocar de envio ou trocar a régua de ordenação muda o
  // tamanho ou a sequência da lista — e a página em que se estava pode não
  // existir mais, ou já não conter o que continha do outro lado da troca.
  useEffect(() => {
    setJanela((atual) =>
      atual.pagina === 1 ? atual : { ...atual, pagina: 1 },
    );
  }, [filters, envio, ordem, vigencias.de, vigencias.ate]);

  /** O escopo como a API o recebe. Vazio fora das telas 360°. */
  const escopoNaConsulta = escopo ? paramsDoEscopo(escopo) : null;

  const query = useQuery({
    queryKey: [
      "tickets",
      filters,
      envio,
      janela,
      ordem,
      escopoNaConsulta?.toString() ?? null,
      vigencias.de,
      vigencias.ate,
    ],
    queryFn: () => {
      const consulta = new URLSearchParams(
        toTicketQuery(
          filters,
          {
            ...(envio ? { ticketImportId: envio } : {}),
            // O mesmo `de`/`ate` das outras abas. Aqui ele vira a lista de
            // rótulos que os chamados declaram — ver `rotulosNaJanela`.
            ...(vigencias.de ? { de: vigencias.de } : {}),
            ...(vigencias.ate ? { ate: vigencias.ate } : {}),
          },
          janela,
          ordem,
        ),
      );
      for (const [chave, valor] of escopoNaConsulta ?? [])
        consulta.set(chave, valor);
      return fetchJson<TicketsResponse>(`/tickets?${consulta}`);
    },
    /*
      Virar a página não pode apagar a tabela: sem isto o `rows` some enquanto a
      página seguinte não chega, a lista pisca em branco a cada clique, e a
      seleção acumulada — que existe justamente para atravessar páginas — vai
      junto, porque a tabela desmonta.
    */
    placeholderData: keepPreviousData,
    /**
     * A leitura roda fora da requisição que recebeu o arquivo, então quem
     * acabou de enviar veria a tela parada em "está sendo lido" até apertar
     * F5. Enquanto houver envio em leitura a tela pergunta de novo sozinha; no
     * resto do tempo não pergunta nada.
     */
    refetchInterval: (query) => {
      const lendo = query.state.data?.imports.some(
        (i) => i.status === "PENDING" || i.status === "READING",
      );
      return lendo ? 1500 : false;
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      // base64 dentro de JSON, igual à importação de vigência: é a requisição
      // mais banal da web, e nenhum proxy a recusa.
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      const CHUNK = 32768;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      const response = await fetch(getApiUrl("/ticket-imports"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentBase64: btoa(binary),
        }),
      });
      const body = await readJson(response);
      /*
        `erroDaResposta` e não um `ApiError` montado aqui: esta linha construía
        o erro com status e `code` e deixava `contexto` e `diagnostico` para
        trás. Era justamente neste caminho — o do upload de chamados — que o
        diagnóstico estruturado se perdia, e a tela voltava a mostrar o texto
        cru da rota ao lado do aviso do `/healthz`, dizendo coisas diferentes.
      */
      if (!response.ok) throw erroDaResposta(response, body, file.name);
      return body.ticketImportId as string;
    },
    onSuccess: () => {
      setErroUpload(null);
      // A leitura roda fora da requisição, então o resultado ainda não está
      // pronto quando isto volta. Recarregar já mostra o envio em leitura, e o
      // `refetchInterval` abaixo cuida do resto.
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
    },
    onError: (err: unknown) => setErroUpload(err),
  });

  /**
   * Excluir apaga de verdade — e o que sai daqui não sai de mais lugar nenhum.
   *
   * `invalidateQueries` só de `["tickets"]`, e não sem chave como na tela de
   * Importações: um envio de chamados não escreve fato canônico nem vigência,
   * então nada em Dados, Início ou na aba Planilha muda por causa desta
   * exclusão. Invalidar a tela inteira daria a impressão contrária.
   */
  const excluir = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const response = await fetch(getApiUrl(`/ticket-imports/${id}`), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await readJson(response);
      if (!response.ok) throw erroDaResposta(response, body);
      return body as unknown as TicketImportDeletionResult;
    },
    onSuccess: (result) => {
      setErroExclusao(null);
      setExcluindo(null);
      setPainel(null);
      // O envio escolhido à mão pode ser justamente o que acabou de sair; sem
      // isto a tela pediria um envio que não existe mais e mostraria o vazio
      // como se não houvesse chamado nenhum.
      setEnvio((atual) => (atual === result.ticketImportId ? null : atual));
      setExcluido(
        `"${result.filename}" foi excluído: ${result.removed.ticketChanges} ` +
          `alteraç${result.removed.ticketChanges === 1 ? "ão" : "ões"} em ` +
          `${result.removed.tickets} chamado${result.removed.tickets === 1 ? "" : "s"} ` +
          `saíram do sistema.` +
          (result.removed.storedFile > 0
            ? " Este arquivo pode ser enviado de novo."
            : ""),
      );
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
    },
    /*
      O erro fica **na caixa**, e não na faixa da tela: a recusa mais comum aqui
      — "este envio ainda está sendo lido" — chega quando a caixa está aberta e
      cobrindo a página. Escrevê-la atrás do modal seria o mesmo que não
      escrever, e quem clicou veria só o botão voltar ao normal.
    */
    onError: (err: unknown) => {
      setExcluido(null);
      setErroExclusao(err);
    },
  });

  const data = query.data;
  const run = data?.import ?? null;
  const totals = data?.totals ?? null;

  const escolherArquivo = () => fileInput.current?.click();

  const falhas = data?.imports.filter((i) => i.status === "FAILED") ?? [];
  const emLeitura =
    data?.imports.filter(
      (i) => i.status === "PENDING" || i.status === "READING",
    ) ?? [];
  const naoMapeadas = run?.unmappedColumns ?? [];
  const ignoradas = run?.ignoredRowCount ?? 0;
  const temAviso =
    falhas.length > 0 ||
    emLeitura.length > 0 ||
    naoMapeadas.length > 0 ||
    ignoradas > 0;

  /*
    O dinheiro pinta os dois cartões que falam dele. "Com impacto" é uma
    contagem, mas é a contagem das linhas que custaram — e mostrá-la em preto
    ao lado de um total vermelho faria o olho procurar duas vezes onde está o
    problema.
  */
  /*
    O tom sai do balde de maior módulo — nunca de uma soma entre baldes, que
    seria somar mensal com anual pela porta do CSS.
  */
  const baldes = totals ? Object.values(totals.impacto.porPeriodicidade) : [];
  const maiorBalde = baldes.length
    ? baldes.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a))
    : 0;
  const tomDoDinheiro =
    totals && totals.impacto.alteracoesSomadas > 0
      ? maiorBalde < 0
        ? "bad"
        : maiorBalde > 0
          ? "good"
          : "muted"
      : "muted";

  const abrirPainel = (alvo: Painel) =>
    setPainel((atual) => (atual === alvo ? null : alvo));

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = "";
        }}
      />

      <div className="p-8 space-y-5">
        {/* De que arquivo saiu tudo o que está abaixo. Fica numa linha, e não
            num cartão: é a procedência da tela, não um número dela. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {run ? (
              <>
                <span className="font-mono">{run.filename}</span> · lido em{" "}
                {new Date(run.receivedAt).toLocaleDateString("pt-BR")}
                {run.receivedBy && <> · enviado por {run.receivedBy}</>}
                {/* O arquivo é o mesmo de Alterações; o que muda é o recorte
                    desta tela. Dizê-lo aqui evita a pergunta "por que este
                    export tem menos chamados do que o outro". */}
                {escopo && (
                  <>
                    {" "}
                    · só o que é de{" "}
                    <strong className="text-foreground">
                      {escopo.placa ?? escopo.entityType.toLowerCase()}
                    </strong>
                  </>
                )}
              </>
            ) : (
              "Nenhum export de chamados importado ainda."
            )}
          </p>

          <div className="flex items-center gap-2">
            {run && Object.keys(run.columnMapping).length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => abrirPainel("colunas")}
                aria-expanded={painel === "colunas"}
                className={cn(
                  painel === "colunas"
                    ? "text-blue-700"
                    : "text-muted-foreground",
                )}
              >
                <Columns3 className="w-4 h-4 mr-1.5" />
                Mapeamento de colunas
              </Button>
            )}
            {data && data.imports.length > 1 && (
              <select
                value={envio ?? run?.id ?? ""}
                onChange={(e) => setEnvio(e.target.value || null)}
                className="text-xs h-8 rounded-md border border-input bg-background px-2"
              >
                {data.imports
                  .filter((i) => i.status === "READ")
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.filename} ·{" "}
                      {new Date(i.receivedAt).toLocaleDateString("pt-BR")}
                    </option>
                  ))}
              </select>
            )}
            {/*
              Excluir fica ao lado de Importar, e não escondido atrás de um
              menu: mandar o arquivo errado é banal — o export de teste, a fila
              com o filtro trocado — e esconder o desfazer é o que faz alguém
              conviver com o erro. O que protege não é a dificuldade de achar o
              botão, e sim a caixa seguinte, que diz quantos chamados saem antes
              de perguntar.
            */}
            {run && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setExcluindo(run)}
                className="text-red-700 hover:text-red-800 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4 mr-1.5" />
                Excluir
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={escolherArquivo}
              disabled={upload.isPending}
            >
              <Upload className="w-4 h-4 mr-1.5" />
              {upload.isPending ? "Enviando…" : "Importar chamados"}
            </Button>
          </div>
        </div>

        {/*
          O recorte De/Até — o mesmo das outras três abas, sobre outro eixo.

          Aqui a vigência não vem do contexto: vem do que **o chamado declara**
          (`Vig. Abertura`), que é a mesma string de `snapshot.source_label` e é
          o que a importação já usa para achar o valor anterior de um parâmetro.
          É o único recorte temporal que esta população sustenta sem ser
          inventado — chamado não tem unidade nem canal, e datar pela abertura
          responderia por quando alguém abriu o chamado, não por que vigência ele
          mexeu.

          Fora das telas 360°, que não passam `onVigencias`: lá a tela já tem um
          recorte por assunto, e um segundo eixo de escolha ao lado dele diria
          que a página responde por duas coisas ao mesmo tempo.
        */}
        {run && data && onVigencias && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <SeletorDeJanela
              disponiveis={data.vigencias.disponiveis}
              rotulos={data.vigencias.rotulos}
              janela={vigencias}
              onJanela={onVigencias}
              noRecorte={data.vigenciasNoRecorte}
              // Aqui uma vigência só é um recorte legítimo: o chamado não é uma
              // comparação entre duas, é um pedido e uma resposta dentro de uma.
              precisaDePar={false}
            />
            {/*
              O que nenhum recorte alcança, dito antes de alguém procurar.

              Um chamado sem `Vig. Abertura` legível não tem onde ser posto num
              eixo de vigências, e some da lista assim que se recorta. Some por
              construção, e não por defeito — mas a diferença entre as duas
              coisas não aparece numa lista que encolheu. Só quando há recorte:
              sem ele nada está sendo escondido, e a frase seria ruído.
            */}
            {recortado && data.vigencias.semVigencia > 0 && (
              <span className="text-xs text-warning-foreground">
                {data.vigencias.semVigencia.toLocaleString("pt-BR")} alteraç
                {data.vigencias.semVigencia === 1 ? "ão" : "ões"} sem vigência
                declarada ficam fora de qualquer recorte
              </span>
            )}
          </div>
        )}

        {/* As duas visões do mesmo arquivo. Fica logo abaixo da procedência
            porque é a primeira escolha de quem chega: ver a lista, ou ver em
            que valor da remuneração o mês mexeu. */}
        {run && (
          <div
            role="tablist"
            aria-label="visão dos chamados"
            className="inline-flex rounded-xl border bg-muted/50 p-1"
          >
            <VisaoBotao
              active={visao === "resumo"}
              onClick={() => setVisao("resumo")}
              label="Resumo"
              hint="a lista das alterações, ordenada por materialidade"
            />
            <VisaoBotao
              active={visao === "tipos"}
              onClick={() => setVisao("tipos")}
              label="Por tipo"
              hint="as mesmas alterações dobradas por valor fixo, variável e diesel"
              icon={<Layers className="w-4 h-4" />}
            />
          </div>
        )}

        {excluido && (
          <p className="text-sm text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            {excluido}
          </p>
        )}

        {/*
          O upload falha por dois motivos muito diferentes — o arquivo não
          serve, ou o banco deste ambiente não tem onde guardar — e a frase do
          servidor sozinha não os distingue. `ApiErrorNotice` pergunta ao
          /readyz e escreve a diferença.
        */}
        {erroUpload != null && (
          <ApiErrorNotice
            error={erroUpload}
            what="O export de chamados não pôde ser enviado."
          />
        )}

        {query.error && (
          <div className="space-y-2">
            <ApiErrorNotice
              error={query.error}
              what="Os chamados não puderam ser carregados."
            />
            {recortado && onVigencias && (
              <LimparRecorte onLimpar={() => onVigencias({})} />
            )}
          </div>
        )}

        {totals && visao === "resumo" && (
          <div
            /*
              A linha é medida pela largura que sobra, não pelo tamanho da janela.

              `xl:grid-cols-5` contava a janela inteira e ignorava os 304px da
              lateral: numa tela de 1440 com o menu aberto, os cinco cartões
              ficavam com 202px cada, dos quais 112 vão para o ladrilho do ícone e
              para os respiros. O que sobrava não cabia um valor em reais, e o
              impacto saía com o fim comido pelas reticências — `R$ 11.9…` no
              cartão que existe para dizer quanto o mês custou.

              `auto-fit` com piso de 14rem inverte a conta: cada cartão tem uma
              largura mínima em que o seu conteúdo cabe, e quando não cabem cinco
              na linha, o que muda é o número de colunas — não o tamanho do que
              está escrito dentro delas.
            */
            className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]"
          >
            <MetricCard
              tone="blue"
              icon={<SlidersHorizontal className="w-6 h-6" />}
              label="Parâmetros alterados"
              value={totals.changes.toLocaleString("pt-BR")}
              hint={`em ${totals.tickets.toLocaleString("pt-BR")} chamado${totals.tickets === 1 ? "" : "s"}`}
            />
            <MetricCard
              tone="green"
              icon={<Folder className="w-6 h-6" />}
              label="Em aberto"
              value={totals.stillOpen.toLocaleString("pt-BR")}
              hint="chamados sem data de fechamento"
              valueTone={totals.stillOpen > 0 ? "warn" : "muted"}
            />
            <MetricCard
              tone="orange"
              icon={<Zap className="w-6 h-6" />}
              label="Com impacto"
              value={totals.calculated.toLocaleString("pt-BR")}
              hint={`${totals.notCalculable.toLocaleString("pt-BR")} sem impacto apurado`}
              valueTone={tomDoDinheiro}
            />
            {/*
              Impacto dos chamados — na régua financeira do produto, por
              periodicidade. O escalar que morava aqui somava mensal com anual
              e monetário com o que nem dinheiro é: "aplicado − pedido é a
              mesma unidade" vale por linha, e é falso na soma entre linhas.
              Quem decide o que entra é a MESMA `viraDinheiro` da Planilha, e
              o que não passa é contado no hint em vez de somado.
            */}
            <MetricCard
              tone="red"
              icon={<TrendingDown className="w-6 h-6" />}
              label="Impacto"
              value={
                totals.impacto.alteracoesSomadas === 0
                  ? "não calculável"
                  : impactEntries(totals.impacto.porPeriodicidade)
                      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
                      .map((e) => e.label)
                      .join(" · ")
              }
              hint={`${(
                totals.notCalculable + totals.impacto.foraDaRegua
              ).toLocaleString(
                "pt-BR",
              )} alterações fora desta soma — sem apuração ou fora da régua financeira`}
              valueTone={
                totals.impacto.alteracoesSomadas === 0 ? "muted" : tomDoDinheiro
              }
            />
            <MetricCard
              tone="purple"
              icon={<Clock className="w-6 h-6" />}
              label="TMA"
              value={
                totals.averageDaysToClose === null
                  ? "—"
                  : `${totals.averageDaysToClose} d`
              }
              hint={
                totals.averageDaysToClose === null
                  ? "sem chamado fechado com as duas datas"
                  : "tempo médio, só os que já fecharam"
              }
            />
          </div>
        )}

        {/* Os avisos do arquivo, em uma linha cada: o tamanho do problema à
            vista, e o detalhe atrás de um clique. Nenhum deles some quando é
            inconveniente — some quando não existe. */}
        {/* O cartão também aparece sem aviso nenhum quando alguém pede o
            mapeamento de colunas pelo botão do topo: o painel aberto precisa de
            onde morar, e um arquivo perfeito não tem faixa vermelha. */}
        {(temAviso || painel !== null) && (
          <Card className="p-5 space-y-4">
            <div
              className={cn(
                "gap-4 md:grid-cols-2",
                temAviso ? "grid" : "hidden",
              )}
            >
              {falhas.length > 0 && (
                <Aviso
                  tone="red"
                  titulo={`${falhas.length} arquivo${falhas.length === 1 ? "" : "s"} com problema`}
                  detalhe={
                    falhas[0].failureReason ?? "O arquivo não pôde ser lido."
                  }
                  acao="Revisar"
                  aberto={painel === "falhas"}
                  onClick={() => abrirPainel("falhas")}
                />
              )}
              {naoMapeadas.length > 0 && (
                <Aviso
                  tone="amber"
                  icone={<Columns3 className="w-6 h-6" />}
                  titulo={`${naoMapeadas.length} colunas não mapeadas`}
                  detalhe="Dados preservados no arquivo original"
                  acao="Ver detalhes"
                  aberto={painel === "colunas"}
                  onClick={() => abrirPainel("colunas")}
                />
              )}
              {ignoradas > 0 && run && (
                <Aviso
                  tone="amber"
                  titulo={`${ignoradas.toLocaleString("pt-BR")} linhas fora da leitura`}
                  detalhe="Sem número de chamado — e a conta fecha"
                  acao="Ver detalhes"
                  aberto={painel === "ignoradas"}
                  onClick={() => abrirPainel("ignoradas")}
                />
              )}
              {emLeitura.length > 0 && (
                <Aviso
                  tone="sky"
                  icone={<Loader2 className="w-6 h-6 animate-spin" />}
                  titulo={`${emLeitura.length} envio${emLeitura.length === 1 ? "" : "s"} em leitura`}
                  detalhe={emLeitura.map((i) => i.filename).join(", ")}
                />
              )}
            </div>

            {painel === "falhas" && (
              <div className="rounded-xl border bg-muted/30 p-4 space-y-2 text-sm">
                {falhas.map((i) => (
                  <div
                    key={i.id}
                    className="flex flex-wrap items-baseline gap-x-2"
                  >
                    <span className="font-mono font-medium">{i.filename}</span>
                    <span className="text-muted-foreground">
                      · {new Date(i.receivedAt).toLocaleDateString("pt-BR")}
                      {i.receivedBy && ` · ${i.receivedBy}`}
                    </span>
                    {/*
                      Um envio que falhou não aparece no seletor do topo — ele
                      lista só os lidos —, então este é o único lugar de onde
                      ele pode sair. Sem o botão aqui, o aviso do arquivo que
                      não serviu ficaria na tela para sempre.
                    */}
                    <button
                      onClick={() => setExcluindo(i)}
                      className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-red-700 underline underline-offset-2 hover:no-underline"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Excluir
                    </button>
                    <p className="w-full text-muted-foreground">
                      {i.failureReason ?? "Sem motivo registrado."}
                    </p>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground pt-1">
                  Nada deste envio foi gravado — o arquivo continua inteiro onde
                  estava, e reenviá-lo corrigido não duplica nada.
                </p>
              </div>
            )}

            {painel === "colunas" && run && (
              <div className="rounded-xl border bg-muted/30 p-4 space-y-4 text-sm">
                {naoMapeadas.length > 0 && (
                  <div>
                    <div className="font-medium">
                      {naoMapeadas.length} colunas do arquivo não têm campo
                      correspondente aqui
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {naoMapeadas.map((coluna) => (
                        <span
                          key={coluna}
                          className="rounded border bg-background px-2 py-0.5 font-mono text-xs text-muted-foreground"
                        >
                          {coluna}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Elas continuam inteiras na linha de origem — abra qualquer
                      chamado para vê-las.
                    </p>
                  </div>
                )}

                {/* A conta que protege o modo de falha desta leitura: um
                    mapeamento errado não estoura, só produz menos alterações —
                    e "menos" é indistinguível de "o chamado mexeu em pouca
                    coisa" a olho nu. */}
                {run.parameterColumns.length > 0 && totals && (
                  <div>
                    <div className="font-medium">
                      {run.parameterColumns.length} colunas de parâmetro
                      reconhecidas, com {totals.changes.toLocaleString("pt-BR")}{" "}
                      células preenchidas em{" "}
                      {totals.tickets.toLocaleString("pt-BR")} chamados
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {run.parameterColumns.map((coluna) => (
                        <span
                          key={coluna}
                          className="rounded border bg-background px-2 py-0.5 font-mono text-xs text-muted-foreground"
                        >
                          {coluna}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Uma célula vazia quer dizer que aquele chamado não mexeu
                      naquele parâmetro — é o normal, e por isso nenhuma
                      alteração é criada para ela. As colunas com{" "}
                      <span className="font-mono">↔</span> são pares
                      antes/depois que o próprio arquivo trouxe.
                    </p>
                  </div>
                )}

                {Object.keys(run.columnMapping).length > 0 && (
                  <div>
                    <div className="font-medium">
                      De que coluna do arquivo saiu cada campo
                    </div>
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
                      {Object.entries(run.columnMapping).map(
                        ([campo, ligacao]) => (
                          <div
                            key={campo}
                            className="flex items-baseline gap-2 min-w-0"
                          >
                            <span className="text-muted-foreground shrink-0">
                              {NOMES_DE_CAMPO[campo] ?? campo}:
                            </span>
                            <span className="font-mono text-xs truncate">
                              {ligacao.header}
                            </span>
                            {ligacao.match === "aproximado" && (
                              <span
                                className="text-xs text-amber-700 shrink-0"
                                title={ligacao.reason}
                              >
                                por aproximação
                              </span>
                            )}
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {painel === "ignoradas" && run && (
              <div className="rounded-xl border bg-muted/30 p-4 text-sm">
                O arquivo trazia{" "}
                <strong>{run.rowCount.toLocaleString("pt-BR")}</strong> linhas
                de dados;{" "}
                <strong>{run.ticketCount.toLocaleString("pt-BR")}</strong>{" "}
                viraram chamado e{" "}
                <strong>{run.ignoredRowCount.toLocaleString("pt-BR")}</strong>{" "}
                ficaram de fora por não terem número de chamado. A conta fecha,
                e nada foi descartado em silêncio.
              </div>
            )}
          </Card>
        )}

        {!run && !query.isLoading && (
          <Card>
            <CardContent className="p-10 text-center space-y-3">
              <Headset className="w-8 h-8 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground max-w-lg mx-auto">
                Esta aba mostra o que foi pedido pelo Freightech e o que voltou
                aplicado. Ela vive de um export da fila de chamados —{" "}
                <strong>.xlsx</strong> ou <strong>.csv</strong> — e o único
                requisito é ter uma coluna que identifique o chamado
                (&quot;Chamado&quot;, &quot;Nº do chamado&quot;,
                &quot;Protocolo&quot;). As demais colunas são reconhecidas pelo
                nome, e o que não for reconhecido aparece listado em vez de
                sumir.
              </p>
              <Button onClick={escolherArquivo} disabled={upload.isPending}>
                <Upload className="w-4 h-4 mr-1.5" />
                {upload.isPending ? "Enviando…" : "Importar export de chamados"}
              </Button>
            </CardContent>
          </Card>
        )}

        {run && visao === "tipos" && (
          <TicketClassification
            envio={envio ?? run.id}
            escopo={escopo}
            vigencias={vigencias}
          />
        )}

        {run && visao === "resumo" && (
          <Card className="p-4 space-y-4">
            <TicketFilterPanel
              filters={filters}
              onChange={setFilters}
              totals={totals ?? undefined}
            />
          </Card>
        )}

        {data && data.byParameter.length > 0 && visao === "resumo" && (
          <Card>
            <div className="grid md:grid-cols-2 md:divide-x">
              <ParametrosMaisPedidos
                itens={data.byParameter}
                selecionado={filters.parameterLabel}
                onSelecionar={(parameterLabel) =>
                  setFilters({
                    ...filters,
                    parameterLabel:
                      filters.parameterLabel === parameterLabel
                        ? ""
                        : parameterLabel,
                  })
                }
              />
              <ImpactosRelevantes
                itens={data.byParameter}
                selecionado={filters.parameterLabel}
                naoApuradas={totals?.notCalculable ?? 0}
                onSelecionar={(parameterLabel) =>
                  setFilters({
                    ...filters,
                    parameterLabel:
                      filters.parameterLabel === parameterLabel
                        ? ""
                        : parameterLabel,
                  })
                }
              />
            </div>
          </Card>
        )}

        {run && visao === "resumo" && (
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 border-b">
              <CardTitle className="text-sm font-semibold">
                {data
                  ? `${data.total.toLocaleString("pt-BR")} alterações de chamado`
                  : "Alterações de chamado"}
              </CardTitle>
              <p
                className="text-xs text-muted-foreground"
                title="Um chamado que altera oito parâmetros aparece em oito linhas. Nada é omitido por ser pequeno."
              >
                Uma linha por parâmetro que um chamado mexeu ·{" "}
                {ordem
                  ? "ordenadas pela coluna que você escolheu, na lista inteira"
                  : "sem ordenação pedida, vêm por materialidade"}
              </p>
            </div>
            {query.isLoading && (
              <p className="p-6 text-sm text-muted-foreground">Lendo…</p>
            )}
            {/*
              Zero sob escopo não é o mesmo zero de sempre. Sem esta linha, uma
              tabela vazia dentro de Cavalo 360° se lê como "não há chamados" —
              e o que há é um arquivo com 1.218 deles, nenhum sobre este
              recorte. A diferença muda o que a pessoa faz em seguida.
            */}
            {escopo && data?.total === 0 && !query.isLoading && (
              <p className="p-6 text-sm text-muted-foreground">
                O export tem chamados, e nenhum deles é de{" "}
                <strong className="text-foreground">
                  {escopo.placa ?? escopo.entityType.toLowerCase()}
                </strong>
                . O arquivo está inteiro em Alterações › Chamados.
              </p>
            )}
            {data && (
              // Enquanto a página pedida não chega, o que está na tela é a
              // anterior. Apagá-la seria pior, e deixá-la firme diria que já é
              // a nova — a opacidade é o meio-termo honesto.
              <div className={cn(query.isPlaceholderData && "opacity-50")}>
                <TicketChangeTable
                  rows={data.rows}
                  total={data.total}
                  janela={janela}
                  onJanela={setJanela}
                  ordem={ordem}
                  onOrdem={setOrdem}
                />
              </div>
            )}
          </Card>
        )}
      </div>

      <ExcluirEnvioDialog
        envio={excluindo}
        erro={erroExclusao}
        onClose={() => {
          setExcluindo(null);
          setErroExclusao(null);
        }}
        onConfirm={(reason) =>
          excluindo && excluir.mutate({ id: excluindo.id, reason })
        }
        excluindo={excluir.isPending}
      />
    </>
  );
}

/**
 * Um dos dois botões de visão.
 *
 * Controle segmentado, e não uma segunda fileira de abas: as abas de cima
 * separam duas fontes de dado que nunca somam uma com a outra, e repetir a
 * mesma forma aqui sugeriria que Resumo e Por tipo também são populações
 * diferentes. São a mesma, vista de dois jeitos.
 */
function VisaoBotao({
  active,
  onClick,
  label,
  hint,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
  icon?: React.ReactNode;
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
    </button>
  );
}

/**
 * A caixa que transforma "tem certeza?" numa decisão.
 *
 * Ela pergunta ao servidor o que sairia **antes** de perguntar à pessoa, porque
 * quem está na tela não tem como saber que aquele arquivo sustenta 1.218
 * alterações em 1.218 chamados. "Isto apaga 1.218 alterações" é uma frase sobre
 * a qual dá para decidir; "tem certeza?" não é.
 *
 * A prévia também é onde a recusa aparece: um envio ainda em leitura não pode
 * ser apagado por baixo de quem o lê, e o motivo chega escrito em vez de virar
 * um botão que não funciona.
 */
function ExcluirEnvioDialog({
  envio,
  erro,
  onClose,
  onConfirm,
  excluindo,
}: {
  envio: TicketImportSummary | null;
  /** A recusa do servidor, quando o botão já foi apertado. */
  erro: unknown;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  excluindo: boolean;
}) {
  const [reason, setReason] = useState("");

  const { data: plano, error } = useQuery({
    queryKey: ["ticket-imports", envio?.id, "deletion"],
    queryFn: () =>
      fetchJson<TicketImportDeletionPlan>(
        `/ticket-imports/${envio!.id}/deletion`,
      ),
    enabled: envio !== null,
    // O que sai depende do resto do banco — outro envio do mesmo arquivo no
    // meio-tempo muda a conta. Sem cache: esta prévia é lida uma vez e agida
    // em seguida.
    staleTime: 0,
    gcTime: 0,
  });

  const linhas: [string, number][] = plano
    ? (
        [
          ["Chamados", plano.removes.tickets],
          ["Alterações de parâmetro", plano.removes.ticketChanges],
          [
            "Tentativas recusadas como duplicata",
            plano.removes.duplicateAttempts,
          ],
        ] as [string, number][]
      ).filter(([, valor]) => valor > 0)
    : [];

  return (
    <Dialog open={envio !== null} onOpenChange={(open) => !open && onClose()}>
      {envio && (
        <>
          <DialogHeader>
            <DialogTitle>Excluir "{envio.filename}"?</DialogTitle>
            <DialogDescription>
              Isto apaga o envio e os chamados que só ele trouxe. Não há
              desfazer: fica o registro de que foi excluído — quem, quando e o
              que saiu —, não os dados. A aba Planilha não é tocada.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p className="text-sm text-red-900 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              Não foi possível calcular o que sairia: {(error as Error).message}
            </p>
          )}

          {!plano && !error && (
            <p className="text-sm text-muted-foreground">
              Calculando o que sairia…
            </p>
          )}

          {plano?.refusal && (
            <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              {plano.refusal}
            </p>
          )}

          {plano && !plano.refusal && (
            <div className="space-y-4">
              {linhas.length > 0 ? (
                <dl className="rounded-xl border divide-y overflow-hidden text-sm">
                  {linhas.map(([label, valor]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between gap-4 px-4 py-2 bg-muted/30"
                    >
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-semibold tabular-nums">
                        {valor.toLocaleString("pt-BR")}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Este envio não chegou a produzir chamado nenhum — sai só o
                  registro dele.
                </p>
              )}

              {plano.removes.storedFile > 0 && (
                <p className="text-sm text-muted-foreground">
                  O arquivo sai do registro de recebidos, então o mesmo conteúdo
                  poderá ser enviado de novo — hoje ele é recusado como
                  duplicata pelo SHA-256.
                </p>
              )}

              <label className="block space-y-1.5">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  Motivo (opcional)
                </span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="ex.: export de teste enviado por engano"
                  className="w-full rounded-lg border px-3 py-2 text-sm bg-background"
                />
                <span className="text-xs text-muted-foreground">
                  Vai para o registro da exclusão, ao lado do seu nome.
                </span>
              </label>
            </div>
          )}

          {erro != null && (
            <div className="mt-4">
              <ApiErrorNotice
                error={erro}
                what="O envio de chamados não pôde ser excluído."
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={!plano || plano.refusal !== null || excluindo}
              onClick={() => onConfirm(reason)}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              {excluindo ? "Excluindo…" : "Excluir envio"}
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}

type ParametroRollup = {
  parameterLabel: string;
  attributeCode: string | null;
  count: number;
  impactSum: number | null;
};

/**
 * Onde os chamados se concentram.
 *
 * Contagem, e só contagem: é a pergunta "o que mais se pede", que não tem nada
 * a ver com "o que mais custa" — o painel ao lado responde essa, e os dois
 * quase nunca têm o mesmo primeiro colocado.
 */
function ParametrosMaisPedidos({
  itens,
  selecionado,
  onSelecionar,
}: {
  itens: ParametroRollup[];
  selecionado: string;
  onSelecionar: (parameterLabel: string) => void;
}) {
  const topo = itens.slice(0, 5);
  return (
    <div className="p-6">
      <TituloDePainel icone={<BarChart3 className="w-5 h-5" />}>
        Parâmetros mais pedidos
      </TituloDePainel>

      <div className="mt-4">
        {topo.map((p, i) => (
          <button
            key={`${p.parameterLabel}-${p.attributeCode}`}
            onClick={() => onSelecionar(p.parameterLabel)}
            title={`filtrar a lista por ${p.parameterLabel}`}
            className={cn(
              "w-full flex items-center gap-4 px-2 py-3 text-left border-b last:border-b-0 rounded-md transition-colors",
              selecionado === p.parameterLabel
                ? "bg-blue-50 text-blue-800"
                : "hover:bg-muted/50",
            )}
          >
            <span className="w-4 shrink-0 text-blue-600 font-semibold tabular-nums">
              {i + 1}
            </span>
            <span className="flex-1 truncate">{p.parameterLabel}</span>
            <span className="font-bold tabular-nums shrink-0">
              {p.count.toLocaleString("pt-BR")}
            </span>
          </button>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Um parâmetro que aparece aqui <em>e</em> na aba Planilha é a mesma
        história contada dos dois lados.
      </p>
    </div>
  );
}

/**
 * O que os chamados custaram, por parâmetro.
 *
 * Só entra aqui o que tem impacto apurado — e a linha do rodapé diz quantas
 * alterações ficaram de fora por não terem. Uma lista de "impactos relevantes"
 * que cala o tamanho do que não sabe medir é a que faz alguém concluir que o
 * resto é zero.
 */
function ImpactosRelevantes({
  itens,
  selecionado,
  naoApuradas,
  onSelecionar,
}: {
  itens: ParametroRollup[];
  selecionado: string;
  naoApuradas: number;
  onSelecionar: (parameterLabel: string) => void;
}) {
  const comImpacto = itens
    .filter((p) => p.impactSum !== null && p.impactSum !== 0)
    .sort((a, b) => Math.abs(b.impactSum ?? 0) - Math.abs(a.impactSum ?? 0))
    .slice(0, 5);

  return (
    <div className="p-6">
      <TituloDePainel icone={<DollarSign className="w-5 h-5" />}>
        Impactos relevantes
      </TituloDePainel>

      {comImpacto.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Nenhum parâmetro deste envio tem impacto apurado. Não quer dizer que
          os chamados não custaram nada — quer dizer que o valor pedido e o
          aplicado não permitiram apurar a diferença.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {comImpacto.map((p) => {
            const soma = p.impactSum ?? 0;
            const perda = soma < 0;
            return (
              <button
                key={`${p.parameterLabel}-${p.attributeCode}`}
                onClick={() => onSelecionar(p.parameterLabel)}
                title={`filtrar a lista por ${p.parameterLabel}`}
                className={cn(
                  "w-full flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors",
                  perda
                    ? "bg-red-50 hover:bg-red-100"
                    : "bg-emerald-50 hover:bg-emerald-100",
                  selecionado === p.parameterLabel &&
                    (perda ? "ring-1 ring-red-300" : "ring-1 ring-emerald-300"),
                )}
              >
                <span
                  className={cn(
                    "h-8 w-8 rounded-full grid place-content-center shrink-0 bg-card border",
                    perda
                      ? "text-red-600 border-red-200"
                      : "text-emerald-600 border-emerald-200",
                  )}
                >
                  {perda ? (
                    <ArrowDown className="w-4 h-4" />
                  ) : (
                    <ArrowUp className="w-4 h-4" />
                  )}
                </span>
                <span className="flex-1 truncate">{p.parameterLabel}</span>
                <span
                  className={cn(
                    "font-bold tabular-nums shrink-0",
                    perda ? "text-red-600" : "text-emerald-700",
                  )}
                >
                  {soma > 0 ? "+" : ""}
                  {brl0(soma)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {naoApuradas > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {naoApuradas.toLocaleString("pt-BR")} alterações não têm impacto
          apurado e não entram nesta lista.
        </p>
      )}
    </div>
  );
}
