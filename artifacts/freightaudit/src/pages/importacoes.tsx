import { Fragment, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  EyeOff,
  FileDown,
  FileSpreadsheet,
  Headset,
  Layers,
  RefreshCw,
  ShieldCheck,
  Table2,
  Trash2,
  Upload,
} from "lucide-react";
import { type DefinicaoDeTipo } from "@workspace/ingest/tipos";
import {
  CHAVE_DA_APRESENTACAO,
  apresentacaoDoDetalhe,
} from "@workspace/ingest/apontamentos";
import {
  SecoesDaApresentacao,
  SeloDeSeveridade,
} from "@/components/apontamentos/apresentacao";
import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout/layout";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { erroDaResposta, fetchJson, getApiUrl, readJson } from "@/lib/api";
import {
  decisaoDaAprovacao,
  estadoDaImportacao,
  faceDoCartao,
  historicoDoArquivo,
  leituraDoRun,
  progressoDaLeitura,
  tiposDoAmbiente,
  type FaceDoCartao,
  type HistoricoDoArquivo,
  type PapelNoArquivo,
} from "@/lib/importacoes";
import { useAmbiente } from "@/lib/ambiente-aberto";
import { rotuloDoTipo } from "@/lib/frota";
import { cn } from "@/lib/utils";
import { AbaBotao } from "@/components/changes/cartoes";
import { ChamadosRecebidos } from "@/components/importacoes/chamados-recebidos";
import {
  Metric,
  Procedencia,
  SeloDeEstado,
  TONS,
} from "@/components/importacoes/cartao";

/**
 * Importações — o histórico do que entrou.
 *
 * Os números vêm do que cada execução de fato produziu, gravados pelo pipeline
 * enquanto rodava. O SHA-256 fica à vista porque é ele que transforma "esse
 * arquivo já entrou" em fato verificável, e não em opinião.
 */

/**
 * O valor da aba "Todas" dentro do `Tabs`, que não aceita string vazia.
 *
 * Fora do componente ele é `null` — "sem recorte" —, e é `null` que some do
 * endereço. A tradução acontece na fronteira, como na Curadoria: deixar a
 * palavra virar um tipo de importação que não existe sairia caro em toda
 * comparação daqui para baixo.
 */
const TODAS = "__todas__";

/**
 * O valor de "sem declaração" dentro do `select` do reprocessamento.
 *
 * Mesma tradução na fronteira que {@link TODAS}: fora do componente ele é
 * `null`, e é `null` que o servidor entende como "relê sem declarar, deduzindo
 * pelo conteúdo". Um `<option value="">` seria indistinguível de "nada
 * escolhido" no DOM.
 */
const SEM_DECLARACAO = "__sem_declaracao__";

/**
 * O tamanho mínimo do motivo, repetido do pipeline de propósito.
 *
 * O servidor é quem recusa — `reprocessImportRun` não confia no cliente. O
 * número aqui existe só para o botão já nascer desabilitado, em vez de deixar
 * a pessoa escrever "ok", clicar, e receber a recusa depois da ida ao servidor.
 * Se os dois divergirem, quem manda continua sendo o servidor.
 */
const MOTIVO_MINIMO = 12;

/**
 * Os estados em que a importação ainda não terminou de ser decidida.
 *
 * Mora fora do componente porque duas partes da tela precisam dele: a lista dos
 * que esperam aprovação, e o cartão que só pode dizer "não saiu fato nenhum"
 * depois que a leitura acabou. Contar isso antes do fim seria alarme sobre um
 * arquivo que ainda está sendo lido.
 */
const ESPERANDO_DECISAO = new Set([
  "PENDING",
  "READING",
  "STAGED",
  "PREVIEWED",
  "PROMOTING",
]);

interface ImportRun {
  importRunId: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  triggeredBy: string | null;
  failureReason: string | null;
  filename: string;
  byteSize: number;
  contentSha256: string;
  receivedAt: string;
  sheets: number;
  rawRows: number;
  rawCells: number;
  stagedFacts: number;
  snapshots: number;
  errors: number;
  warnings: number;
  labels: string[];
  /** Equipamentos que esta importação criaria e o dicionário não conhece. */
  pendingIdentities: string[];
  /** O tipo declarado no envio — a aba por onde o arquivo entrou. */
  declaredType: string | null;
  /** O que as vigências desta importação passaram a cobrir, herança incluída. */
  entityTypes: string[];
  /** Os tipos que este arquivo trouxe — `entityTypes` sem a parte herdada. */
  tiposDoArquivo: string[];
  /** O run que este releu, quando ele é um reprocessamento. */
  reprocessOfRunId: string | null;
  /** Por que se releu. Sempre junto com o campo acima. */
  reprocessReason: string | null;
  /** As releituras deste run, da mais antiga para a mais nova. */
  reprocessadoPor: string[];
  /** Quantas leituras este mesmo arquivo já teve, contando esta. */
  leiturasDoArquivo: number;
  /**
   * Quando não-nulo, esta importação está oculta: fora do dashboard, do
   * comparativo, da cobertura e do DRE — mas nada foi apagado, e o botão do
   * cartão a reexibe a qualquer momento.
   */
  hiddenAt: string | null;
  hiddenBy: string | null;
  hiddenReason: string | null;
}

/*
  O rótulo humano de um tipo — "Cavalo", "QLP Administrativo" — vem de
  `@/lib/frota`, e não de uma busca escrita aqui.

  Era uma busca escrita aqui, com o mesmo resultado, e a cópia ficou visível no
  dia em que a Curadoria precisou do mesmo nome: as abas de lá diziam
  `QLP_ADMINISTRATIVO` em caixa alta enquanto esta tela já escrevia
  "QLP Administrativo". Um nome de tipo é um só no produto inteiro.
*/

/**
 * O que veio no arquivo desta importação — e, por isso, a que aba ela pertence.
 *
 * Duas respostas, nesta ordem, e a ordem é o desenho: **o que foi declarado**
 * manda, porque é a aba em que a pessoa de fato enviou o arquivo; na falta da
 * declaração — toda importação anterior a ela —, valem **os fatos que o
 * arquivo produziu**, sem a parte herdada de revisões anteriores. A herança
 * fica de fora do recorte de propósito: o arquivo de carreta que regrava as
 * vigências preservando os cavalos não vira um upload de cavalos por isso —
 * essa metade da história é dita dentro do cartão ({@link TipoDaImportacao}),
 * não pela aba em que ele aparece.
 *
 * Uma importação sem declaração e sem fatos próprios legíveis — a que falhou
 * antes de promover, ou a anterior ao agregado por tipo que o backfill não
 * cobriu — não aparece em aba de tipo nenhuma, e é assim que deve ser:
 * classificá-la por palpite seria dizer que ela trouxe o que ninguém mediu.
 * Ela continua inteira na aba Todas, que existe também por isso.
 *
 * Exportada porque o recorte é um contrato da tela, e o teste dele mora em
 * `__tests__/importacoes-abas.test.ts`.
 */
export const tiposVindosDoArquivo = (run: TiposDaImportacao): string[] =>
  run.declaredType !== null ? [run.declaredType] : run.tiposDoArquivo;

/** O pedaço de {@link ImportRun} de que o recorte e as etiquetas dependem. */
export interface TiposDaImportacao {
  declaredType: string | null;
  entityTypes: string[];
  tiposDoArquivo: string[];
}

/**
 * O que a vigência resultante cobre além do arquivo — a herança das revisões
 * anteriores. Vazio no caso comum, em que a vigência é o arquivo; vazio também
 * quando não se sabe o que o arquivo trouxe, porque sem essa leitura apontar
 * herança seria dar nome errado a uma diferença que não dá para calcular.
 */
export const tiposHerdados = (run: TiposDaImportacao): string[] => {
  const doArquivo = new Set(tiposVindosDoArquivo(run));
  if (doArquivo.size === 0) return [];
  return run.entityTypes.filter((tipo) => !doArquivo.has(tipo));
};

/**
 * Um apontamento do pipeline, como a API o entrega.
 *
 * `detail` é o que o pipeline gravou junto do texto — a chave que colidiu, os
 * campos envolvidos, a vigência. Ele chega como objeto livre de propósito: cada
 * código anota o que o seu caso pede. A única chave com contrato é
 * `apresentacao` (`@workspace/ingest/apontamentos`), as seções que a leitura
 * principal desenha; o resto vai para os detalhes técnicos, como vier.
 */
interface IssueGroup {
  code: string;
  severity: string;
  count: number;
  ocorrencias: {
    message: string;
    detail: Record<string, unknown> | null;
    sheetName: string | null;
    rowIndex: number | null;
  }[];
}

interface RunDetail {
  sheets: {
    sheetName: string;
    role: string;
    roleReason: string | null;
    rowCount: number;
    columnCount: number;
    headerRowIndex: number | null;
  }[];
}

/**
 * O que sairia do sistema se esta importação fosse excluída.
 *
 * Vem do servidor, e não de uma conta feita aqui: os mesmos números que a
 * exclusão vai executar. Uma tela que estimasse a consequência por conta
 * própria estaria adivinhando exatamente na hora em que não pode.
 */
interface DeletionPlan {
  importRunId: string;
  filename: string;
  contentSha256: string;
  status: string;
  labels: string[];
  /** Revisões anteriores que voltam a valer quando esta sair. */
  restoredLabels: string[];
  /** Releituras que serão reancoradas quando esta importação sair. */
  reprocessamentosReancorados: string[];
  /** Por que não dá para excluir agora — null quando dá. */
  refusal: string | null;
  removes: {
    snapshots: number;
    facts: number;
    changeSets: number;
    changes: number;
    entities: number;
    /** Colunas que ficam sem dado — e que a exclusão não apaga. Nenhuma sai. */
    attributesKept: number;
    rawCells: number;
    rawRows: number;
    rawSheets: number;
    stagedFacts: number;
    validationIssues: number;
    columnMappings: number;
    sourceFile: number;
  };
}

/**
 * Os tipos da aba Planilha numa frase: "cavalo, carreta, trecho e QLP".
 *
 * Os ativos entram em minúscula, que é como se escrevem no meio de uma frase;
 * os dois QLPs viram uma palavra só — "QLP Administrativo, QLP Operacional"
 * dobraria o comprimento da dica para dizer o que as abas logo abaixo já
 * mostram separado.
 */
const dicaDosTipos = (tipos: DefinicaoDeTipo[]): string => {
  const ativos = tipos
    .filter((tipo) => !tipo.code.startsWith("QLP_"))
    .map((tipo) => tipo.rotulo.toLowerCase());
  const temQlp = ativos.length < tipos.length;
  return temQlp ? `${ativos.join(", ")} e QLP` : ativos.join(", ");
};

const n = (v: number) => v.toLocaleString("pt-BR");

const dateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR");

/** "1 aba", "2 abas" — o número é lido junto com a palavra, e concordam. */
const plural = (count: number, one: string, many: string) =>
  `${n(count)} ${count === 1 ? one : many}`;

interface RunStatus {
  importRunId: string;
  status: string;
  filename: string;
  failureReason: string | null;
  sheets: number;
  rawCells: number;
  facts: number;
  snapshots: number;
  /**
   * O total de apontamentos ERRO — um número do histórico, não uma decisão.
   *
   * Ele já foi a condição do botão de aprovar, e essa leitura é o defeito que
   * `decisaoDaAprovacao` fecha: nem todo ERRO impede promover. Aqui ele é o que
   * sempre foi — quantos apontamentos ERRO este run produziu.
   */
  errors: number;
  warnings: number;
  /** Quantos apontamentos impedem aprovar — a conta do pipeline, não o total. */
  blockingErrors: number;
  /** Quantas chaves ficarão de fora se este arquivo for aprovado. */
  chavesEmQuarentena: number;
  labels: string[];
  /** Equipamentos que esta importação criaria e o dicionário não conhece. */
  pendingIdentities: string[];
  /** O tipo declarado no envio — a aba por onde este arquivo entrou. */
  declaredType: string | null;
  /** Preenchido quando este run é uma releitura, e não um envio. */
  reprocessOfRunId: string | null;
  /**
   * Quanto da leitura já passou — medido pelo pipeline enquanto ele trabalha.
   *
   * É o único trio deste objeto que fala de trabalho em curso: todos os outros
   * contadores só existem depois que a etapa deles terminou. Nulo em
   * `progressStep` quer dizer "nenhum trecho medido agora", e é o que toda
   * importação anterior à `0062` responde. Quem traduz isso em barra é
   * `progressoDaLeitura`.
   */
  progressStep: string | null;
  progressDone: number;
  progressTotal: number;
}

/**
 * Read a response without assuming it is JSON.
 *
 * A proxy that times out, or any layer between the browser and the API,
 * answers with an empty body or an HTML error page. Calling `.json()` on that
 * throws "Unexpected end of JSON input", which tells the person nothing about
 * what went wrong. Reading the text first turns that into a message that at
 * least names the status.
 */
export default function Importacoes() {
  const search = useSearch();
  const [, navegar] = useLocation();

  /*
    Qual execução está aberta mora no endereço.

    O Rastreio de Dados nomeia a importação que não fechou — arquivo, células,
    resíduo — e a explicação de *por quê* está aqui: o mapeamento de colunas, os
    avisos de leitura, o que foi ignorado. Sem endereço, o Rastreio só podia
    mandar para a lista, e quem chegava tinha de reencontrar entre dezenas de
    envios o que acabara de ler o nome. `?run=` fecha essa ponta, e de quebra
    torna o cartão aberto compartilhável.

    `replace` ao abrir e fechar: expandir um cartão não é uma tela nova, e voltar
    tem de sair de Importações em vez de percorrer os cartões já abertos.
  */
  const expanded = new URLSearchParams(search).get("run");
  /*
    A aba também mora no endereço, e pelo mesmo motivo do cartão aberto: é para
    uma aba que se manda alguém. "Manda a planilha de trecho por aqui" vira um
    link, e o mesmo link abre a mesma aba amanhã.

    Um valor que não é tipo nenhum — endereço antigo, link editado à mão — cai
    em Todas em vez de deixar a tela numa aba que não existe.
  */
  const abaPedida = new URLSearchParams(search).get("tipo");
  /*
    As abas são as da **auditoria aberta**, e não as oito que o pipeline sabe
    ler: a Empurrada recebe cavalo, carreta e trecho; a Rota e o AS, caminhão e
    carroceria; o Apoio, empilhadeira — e os dois QLPs valem para as quatro. Ver
    `TIPOS_DO_AMBIENTE`, em `lib/importacoes.ts`, onde essa divisão está escrita
    com a razão dela.

    Um `?tipo=` que não é aba **deste** ambiente cai em Todas pela mesma regra
    que já valia para um tipo inexistente — um link de "manda a planilha de
    cavalo por aqui" aberto dentro da Auditoria Apoio abre no histórico inteiro,
    e não numa aba que declararia empurrada de dentro do apoio.
  */
  const tipos = tiposDoAmbiente(useAmbiente());
  const aba = tipos.find((t) => t.code === abaPedida)?.code ?? null;
  const tipoDaAba = tipos.find((t) => t.code === aba) ?? null;
  const setAba = (code: string | null) => {
    const params = new URLSearchParams(search);
    if (code) params.set("tipo", code);
    else params.delete("tipo");
    navegar(params.toString() ? `/importacoes?${params}` : "/importacoes", {
      replace: true,
    });
  };

  /*
    A seção mora no endereço pelo mesmo motivo da aba: um link para "Chamados"
    dentro de Importações tem que abrir em Chamados amanhã. Só duas seções
    existem — Planilha, o que já havia, e Chamados, que só lê e escreve por
    `/ticket-imports` — e qualquer outro valor cai em Planilha.
  */
  const secao =
    new URLSearchParams(search).get("secao") === "chamados"
      ? "chamados"
      : "planilha";
  const setSecao = (valor: "planilha" | "chamados") => {
    const params = new URLSearchParams(search);
    if (valor === "chamados") params.set("secao", valor);
    else params.delete("secao");
    navegar(params.toString() ? `/importacoes?${params}` : "/importacoes", {
      replace: true,
    });
  };
  const setExpanded = (importRunId: string | null) => {
    const params = new URLSearchParams(search);
    if (importRunId) params.set("run", importRunId);
    else params.delete("run");
    navegar(params.toString() ? `/importacoes?${params}` : "/importacoes", {
      replace: true,
    });
  };

  const [detailOf, setDetailOf] = useState<ImportRun | null>(null);
  const [deleteOf, setDeleteOf] = useState<ImportRun | null>(null);
  const [reprocessOf, setReprocessOf] = useState<ImportRun | null>(null);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const {
    data: runs = [],
    isLoading,
    error: listError,
  } = useQuery({
    queryKey: ["imports"],
    // `.json()` direto transformava a API fora do ar em lista vazia, e a tela
    // dizia "nenhuma importação ainda" — a mesma frase de um banco limpo. A
    // ausência de resposta passava por ausência de dados. `fetchJson` é essa
    // checagem, agora feita por toda a interface.
    queryFn: () => fetchJson<ImportRun[]>("/imports"),
  });

  /**
   * Uma importação esperando decisão continua esperando depois do F5.
   *
   * `pendingIds` só conhecia os envios feitos **nesta** aba: quem enviava a
   * planilha, recarregava a página e voltava depois não tinha mais botão de
   * aprovar em lugar nenhum. O arquivo ficava parado em PREVIEWED para sempre,
   * a API sabendo dele e a tela sem oferecer o passo que falta — e o cartão do
   * equipamento dizia "esperando aprovação" apontando para uma tela onde não
   * havia o que apertar.
   *
   * O estado de quem espera decisão é do servidor, então é dele que a lista
   * sai. Os ids da sessão continuam entrando porque um envio recém-feito ainda
   * não apareceu na listagem.
   */
  /*
    O histórico que a aba mostra.

    Recorte, e não filtro: a aba troca a população da lista inteira, e é por
    isso que o vazio dela diz "nenhuma importação de Trecho nesta base" em vez
    de "nenhuma importação". A distinção é a mesma de `lib/frota.ts`, e ela
    aparece aqui na contagem de cada aba, que conta o que o clique abre.
  */
  const doRecorte =
    aba === null
      ? runs
      : runs.filter((run) => tiposVindosDoArquivo(run).includes(aba));

  /*
    Oculta por padrão: é o que faz o botão do cartão cumprir o pedido de
    quem opera — importar as carretas sem ver os cartões do cavalo que já
    conferiu. "Mostrar ocultas" existe porque ocultar tem que dar para
    desfazer, e desfazer exige achar o cartão de novo.
  */
  const [mostrarOcultos, setMostrarOcultos] = useState(false);
  const ocultos = doRecorte.filter((run) => run.hiddenAt !== null);
  const visiveis = mostrarOcultos
    ? doRecorte
    : doRecorte.filter((run) => run.hiddenAt === null);

  const esperandoDecisao = [
    ...new Set([
      ...pendingIds,
      ...runs
        .filter((r) => ESPERANDO_DECISAO.has(r.status))
        .map((r) => r.importRunId),
    ]),
  ];

  /*
    O envio leva o tipo da aba junto.

    `declaredType` não é metadado de conveniência: é o que o servidor confere
    contra o conteúdo do arquivo antes de deixar qualquer coisa entrar. Enviar
    uma planilha de carreta pela aba do Cavalo passa a ser uma recusa com a
    conta escrita, e não uma importação silenciosa sob o tipo errado.
  */
  const upload = useMutation({
    mutationFn: async ({
      files,
      declaredType,
    }: {
      files: File[];
      declaredType: string;
    }) => {
      const ids: string[] = [];
      for (const file of files) {
        // base64 dentro de JSON: é a requisição mais banal da web, e nenhum
        // proxy recusa. O envio binário cru dava 502 sem chegar ao servidor.
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        const CHUNK = 32768;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }
        const response = await fetch(getApiUrl("/imports"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentBase64: btoa(binary),
            declaredType,
          }),
        });
        const body = await readJson(response);
        // Um `Error` de uma linha jogava fora o status, o `code` e o
        // diagnóstico — e com eles a diferença entre "este arquivo não serve" e
        // "este banco não tem onde guardar".
        if (!response.ok) throw erroDaResposta(response, body, file.name);
        ids.push(body.importRunId as string);
      }
      return ids;
    },
    onSuccess: (ids) => {
      setError(null);
      setPendingIds((current) => [...current, ...ids]);
    },
    onError: (err: Error) => {
      setError(err.message);
      // Uma duplicata recusada também vira um import_run. A tentativa é um
      // evento que vale registrar, então a lista é recarregada para mostrá-la
      // sem depender de o operador dar reload.
      queryClient.invalidateQueries({ queryKey: ["imports"] });
    },
  });

  /**
   * Reprocessar — reler um arquivo que já entrou, porque o leitor mudou.
   *
   * Não é um envio: nenhum byte sobe. O pedido nomeia a importação a reler, e o
   * servidor abre **outro** run sobre o mesmo `source_file`. Por isso ele não
   * mexe em `pendingIds` de outro jeito senão acrescentando o run novo: o run
   * antigo continua na lista, com o que ele produziu, exatamente como estava.
   *
   * `invalidateQueries` só da lista, e não geral: até aqui nada entrou na
   * camada canônica — o run novo nasce em PENDING e para em PREVIEWED. Quem
   * mexe no resto da interface é a aprovação, que continua sendo outro clique.
   */
  const reprocess = useMutation({
    mutationFn: async ({
      importRunId,
      reason,
      declaredType,
    }: {
      importRunId: string;
      reason: string;
      declaredType: string | null;
    }) => {
      const response = await fetch(
        getApiUrl(`/imports/${importRunId}/reprocess`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason, declaredType }),
        },
      );
      const body = await readJson(response);
      if (!response.ok) throw erroDaResposta(response, body);
      return body;
    },
    onSuccess: (body) => {
      setError(null);
      setRemoved(null);
      setReprocessOf(null);
      setPendingIds((current) => [...current, body.importRunId as string]);
      queryClient.invalidateQueries({ queryKey: ["imports"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const promote = useMutation({
    mutationFn: async ({
      importRunId,
      confirmNewEntityTypes,
    }: {
      importRunId: string;
      confirmNewEntityTypes: string[];
    }) => {
      const response = await fetch(
        getApiUrl(`/imports/${importRunId}/promote`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmNewEntityTypes }),
        },
      );
      const body = await readJson(response);
      if (!response.ok) throw erroDaResposta(response, body);
      return body;
    },
    onSuccess: (_result, { importRunId }) => {
      setError(null);
      setPendingIds((current) => current.filter((id) => id !== importRunId));
      queryClient.invalidateQueries();
    },
    onError: (err: Error) => setError(err.message),
  });

  /**
   * Excluir apaga de verdade — e mexe em tudo o que lia aquela importação.
   *
   * Por isso o `invalidateQueries()` sem chave: as vigências somem de Dados, as
   * comparações de Alterações, os equipamentos do Início. Invalidar só a lista
   * de importações deixaria o resto da interface mostrando números que já não
   * existem, e essa é a tela onde isso menos pode acontecer.
   */
  const remove = useMutation({
    mutationFn: async ({
      importRunId,
      reason,
    }: {
      importRunId: string;
      reason: string;
    }) => {
      const response = await fetch(getApiUrl(`/imports/${importRunId}`), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await readJson(response);
      if (!response.ok) throw erroDaResposta(response, body);
      return body as unknown as DeletionPlan;
    },
    onSuccess: (result) => {
      setError(null);
      setDeleteOf(null);
      setPendingIds((current) =>
        current.filter((id) => id !== result.importRunId),
      );
      setRemoved(
        `"${result.filename}" foi excluída: ${n(result.removes.facts)} fatos e ` +
          `${plural(result.removes.snapshots, "vigência", "vigências")} saíram do sistema.` +
          (result.removes.sourceFile > 0
            ? " Este arquivo pode ser enviado de novo."
            : ""),
      );
      queryClient.invalidateQueries();
    },
    onError: (err: Error) => {
      setRemoved(null);
      setError(err.message);
    },
  });

  /**
   * Ocultar/reexibir — reversível, ao contrário de `remove` acima.
   *
   * Sem diálogo de confirmação: a ação não tira nada do sistema, só de vista,
   * e o próprio botão vira "Reexibir" assim que o cartão está oculto.
   */
  const toggleHidden = useMutation({
    mutationFn: async ({
      importRunId,
      hidden,
    }: {
      importRunId: string;
      hidden: boolean;
    }) => {
      const response = await fetch(
        getApiUrl(`/imports/${importRunId}/hidden`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hidden }),
        },
      );
      const body = await readJson(response);
      if (!response.ok) throw erroDaResposta(response, body);
      return body;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <FileDown className="w-6 h-6 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight">Importações</h1>
            <p className="text-muted-foreground mt-1 max-w-3xl leading-relaxed">
              Cada arquivo recebido, o que saiu dele e o que o pipeline apontou.
              <br className="hidden sm:inline" /> Cada aba é um tipo: enviar por
              ela <em>declara</em> o que o arquivo traz, e a importação confere
              essa declaração contra o conteúdo antes de deixar entrar.
              <br className="hidden sm:inline" /> O mesmo arquivo reentregue é
              reconhecido pelo SHA-256. O mesmo <em>dado</em>, num arquivo
              diferente, é reconhecido pela identidade da vigência — e nenhum
              dos dois entra duas vezes.
            </p>
          </div>
        </div>

        {/*
          Planilha e Chamados são as duas seções do módulo — cada uma com o
          seu próprio pipeline, a sua própria dedup, e sem sentido nenhum de
          somar entre si. Por isso são abas de verdade, e não um recorte
          dentro de uma lista só: a mesma divisão que já existia em
          Alterações, agora do lado de quem envia o arquivo.
        */}
        <nav className="flex items-center gap-1 mt-4" role="tablist">
          <AbaBotao
            active={secao === "planilha"}
            onClick={() => setSecao("planilha")}
            icon={<FileSpreadsheet className="w-4 h-4" />}
            label="Planilha"
            /* Os tipos da operação aberta, e não uma lista escrita à mão: a
               dica dizia "cavalo, carreta, trecho e QLP" dentro da Auditoria
               Apoio, que não recebe nenhum dos três. */
            hint={`${dicaDosTipos(tipos)} — o pipeline com aprovação`}
          />
          <AbaBotao
            active={secao === "chamados"}
            onClick={() => setSecao("chamados")}
            icon={<Headset className="w-4 h-4" />}
            label="Chamados"
            hint="o export da fila de chamados do Freightech"
          />
        </nav>
      </header>

      {secao === "chamados" ? (
        <ChamadosRecebidos />
      ) : (
        <div className="p-8 space-y-5">
          {/* As abas vêm antes de tudo porque mandam em tudo: primeiro se escolhe
            de que tipo se está falando, depois se envia e se lê o histórico
            daquele tipo. Na ordem inversa, o botão de enviar apareceria antes
            de a tela dizer o que ele vai declarar. */}
          <Tabs
            value={aba ?? TODAS}
            onValueChange={(valor) => setAba(valor === TODAS ? null : valor)}
          >
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value={TODAS}>
                Todas
                <span className="ml-1.5 tabular-nums text-xs text-muted-foreground">
                  {n(runs.length)}
                </span>
              </TabsTrigger>
              {tipos.map((tipo) => (
                <TabsTrigger key={tipo.code} value={tipo.code}>
                  {tipo.rotulo}
                  <span className="ml-1.5 tabular-nums text-xs text-muted-foreground">
                    {n(
                      runs.filter((run) =>
                        tiposVindosDoArquivo(run).includes(tipo.code),
                      ).length,
                    )}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <input
            ref={fileInput}
            type="file"
            accept=".xlsx"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0 && tipoDaAba !== null) {
                upload.mutate({ files, declaredType: tipoDaAba.code });
              }
              e.target.value = "";
            }}
          />

          {/* Em Todas não há envio porque não há tipo declarado — e enviar sem
            declarar é justamente o que esta tela deixou de fazer. */}
          {tipoDaAba === null ? (
            <SemAbaEscolhida />
          ) : (
            <Dropzone
              tipo={tipoDaAba}
              busy={upload.isPending}
              onFiles={(files) =>
                upload.mutate({ files, declaredType: tipoDaAba.code })
              }
              onPick={() => fileInput.current?.click()}
            />
          )}

          {error && (
            <p className="text-sm text-red-900 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              {error}
            </p>
          )}

          {removed && (
            <p className="text-sm text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
              {removed}
            </p>
          )}

          {esperandoDecisao.map((id) => (
            <PendingRun
              key={id}
              importRunId={id}
              onDiscard={() => setPendingIds((c) => c.filter((x) => x !== id))}
              onPromote={(confirmNewEntityTypes) =>
                promote.mutate({ importRunId: id, confirmNewEntityTypes })
              }
              promoting={promote.isPending}
            />
          ))}

          {isLoading && (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          )}
          {!isLoading && listError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-5 text-sm text-red-900">
              Não foi possível ler o histórico de importações:{" "}
              {(listError as Error).message} Esta lista pode não estar vazia — o
              que falhou foi perguntar.
            </div>
          )}
          {/* "Nenhuma importação ainda" ao lado de um arquivo sendo lido é falso
            de um jeito que confunde: o que falta é aprovar, não enviar. */}
          {ocultos.length > 0 && (
            <button
              onClick={() => setMostrarOcultos((v) => !v)}
              className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
            >
              {mostrarOcultos ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              {mostrarOcultos
                ? "Esconder as ocultas de novo"
                : `Mostrar ${plural(ocultos.length, "importação oculta", "importações ocultas")}`}
            </button>
          )}

          {!isLoading &&
            !listError &&
            visiveis.length === 0 &&
            esperandoDecisao.length === 0 && (
              <div className="rounded-xl border bg-card px-8 py-10 text-center text-sm text-muted-foreground shadow-sm">
                {tipoDaAba === null ? (
                  <>
                    Nenhuma importação ainda. Escolha o tipo acima e use{" "}
                    <strong className="text-foreground">
                      Escolher planilhas
                    </strong>{" "}
                    para enviar o export do Freightec.
                  </>
                ) : (
                  <>
                    Nenhuma importação de{" "}
                    <strong className="text-foreground">
                      {tipoDaAba.rotulo}
                    </strong>{" "}
                    nesta base.
                    {runs.length > 0 && (
                      <>
                        {" "}
                        Há {plural(runs.length, "importação", "importações")} de
                        outros tipos — veja em{" "}
                        <strong className="text-foreground">Todas</strong>.
                      </>
                    )}
                  </>
                )}
              </div>
            )}

          {visiveis.map((run) => (
            <RunCard
              key={run.importRunId}
              run={run}
              /* A história do arquivo sai da lista inteira, não do recorte: o
               recebimento original de um arquivo pode ser de um tipo que a aba
               atual não mostra — foi assim no caso que originou isto, em que a
               tentativa recusada estava na aba do QLP e o recebimento, sem
               declaração nenhuma, só aparecia em Todas. */
              todos={runs}
              expanded={expanded === run.importRunId}
              onToggle={() =>
                setExpanded(
                  expanded === run.importRunId ? null : run.importRunId,
                )
              }
              onDetails={() => setDetailOf(run)}
              onDelete={() => {
                setRemoved(null);
                setDeleteOf(run);
              }}
              onReprocess={() => {
                setRemoved(null);
                setReprocessOf(run);
              }}
              onToggleHidden={() =>
                toggleHidden.mutate({
                  importRunId: run.importRunId,
                  hidden: run.hiddenAt === null,
                })
              }
              togglingHidden={
                toggleHidden.isPending &&
                toggleHidden.variables?.importRunId === run.importRunId
              }
            />
          ))}

          <div className="rounded-xl border bg-card px-6 py-5 shadow-sm flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-sm">Segurança e deduplicação</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Duas camadas. O SHA-256 reconhece o arquivo idêntico antes de
                lê-lo. A identidade canônica da vigência — unidade, canal, data
                e família, todas normalizadas — reconhece o mesmo dado ainda que
                o arquivo seja outro: rótulo escrito de outro jeito, CNPJ com ou
                sem máscara, placa com ou sem hífen, linhas ou abas em outra
                ordem. O banco garante uma única versão ativa por vigência.
              </p>
            </div>
          </div>
        </div>
      )}

      <RunDetailDialog run={detailOf} onClose={() => setDetailOf(null)} />
      <ReprocessDialog
        /* Uma caixa por importação, como na exclusão: o motivo digitado para
           uma não pode aparecer preenchido na próxima. */
        key={reprocessOf?.importRunId ?? "nenhuma"}
        run={reprocessOf}
        todos={runs}
        tipos={tipos}
        onClose={() => setReprocessOf(null)}
        onConfirm={(reason, declaredType) =>
          reprocessOf &&
          reprocess.mutate({
            importRunId: reprocessOf.importRunId,
            reason,
            declaredType,
          })
        }
        working={reprocess.isPending}
      />
      <DeleteDialog
        /* Uma caixa por importação: o motivo digitado para uma não pode
           aparecer preenchido na próxima. */
        key={deleteOf?.importRunId ?? "nenhuma"}
        run={deleteOf}
        onClose={() => setDeleteOf(null)}
        onConfirm={(reason) =>
          deleteOf &&
          remove.mutate({ importRunId: deleteOf.importRunId, reason })
        }
        deleting={remove.isPending}
      />
    </Layout>
  );
}

/**
 * De que tipo é esta importação — em duas afirmações que não se misturam.
 *
 * **Arquivo** é o que este arquivo trouxe: a declaração do envio quando
 * existe, senão o que os fatos dele dizem. **Vigência resultante** é o que as
 * vigências gravadas passaram a cobrir — que pode ser mais que o arquivo,
 * porque a revisão preserva os tipos que ele não toca: o arquivo de carreta
 * que entra numa vigência que já tinha cavalos grava uma revisão cobrindo os
 * dois. As duas moravam na mesma fileira de etiquetas, e foi isso que fez
 * "Cavalo + Carreta" parecer tipos detectados dentro de um arquivo só de
 * carretas. A segunda linha só aparece quando diz algo que a primeira não
 * disse; repetir o mesmo tipo nas duas seria ruído vestido de rigor.
 */
function TipoDaImportacao({ run }: { run: ImportRun }) {
  const doArquivo = tiposVindosDoArquivo(run);
  const herdados = tiposHerdados(run);
  if (doArquivo.length === 0 && run.entityTypes.length === 0) return null;

  const chip = (tipo: string) => (
    <span
      key={tipo}
      className="text-[0.6875rem] px-2 py-0.5 rounded-lg border bg-muted/40 text-foreground"
    >
      {rotuloDoTipo(tipo)}
    </span>
  );

  /*
    Importação antiga, promovida antes de o agregado por tipo existir e fora do
    backfill: não há como separar arquivo de herança, e inventar a separação
    seria pior que não fazê-la. Resta a cobertura, dita como cobertura.
  */
  if (doArquivo.length === 0) {
    return (
      <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[0.6875rem] text-muted-foreground">
          Vigências cobrem
        </span>
        {run.entityTypes.map(chip)}
        <span className="text-[0.6875rem] text-muted-foreground">
          lido das vigências que entraram
        </span>
      </p>
    );
  }

  return (
    <div className="mt-1.5 space-y-1">
      <p className="flex flex-wrap items-center gap-1.5">
        <span className="text-[0.6875rem] text-muted-foreground">Arquivo</span>
        {doArquivo.map(chip)}
        <span className="text-[0.6875rem] text-muted-foreground">
          {run.declaredType !== null
            ? "declarado no envio"
            : "lido do conteúdo do arquivo"}
        </span>
      </p>
      {herdados.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="text-[0.6875rem] text-muted-foreground">
            {run.snapshots === 1
              ? "Vigência resultante"
              : "Vigências resultantes"}
          </span>
          {run.entityTypes.map(chip)}
          <span className="text-[0.6875rem] text-muted-foreground">
            {herdados.map(rotuloDoTipo).join(" e ")} preservado
            {herdados.length > 1 ? "s" : ""} de revisões anteriores — não veio
            {herdados.length > 1 ? "ram" : ""} neste arquivo
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * A aba Todas não envia — e diz por quê.
 *
 * Um botão de enviar aqui teria de escolher um tipo sozinho, e escolher um tipo
 * sozinho é exatamente o que a declaração veio substituir. O que a tela pode
 * fazer é a coisa honesta: mostrar o histórico inteiro e apontar para onde o
 * envio acontece.
 */
function SemAbaEscolhida() {
  return (
    <div className="rounded-xl border bg-card px-6 py-5 shadow-sm flex items-start gap-4">
      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0">
        <Layers className="w-5 h-5 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <p className="font-semibold">Todo o histórico, de todos os tipos</p>
        <p className="text-sm text-muted-foreground mt-0.5">
          Para enviar uma planilha, escolha a aba do tipo dela acima. A aba é o
          que declara o tipo, e é contra essa declaração que a importação
          confere o que o arquivo traz — por isso não se envia daqui.
        </p>
      </div>
    </div>
  );
}

/**
 * The upload target: one dashed area that both clicks and receives a drop.
 *
 * The whole rectangle is the control, not a button inside it — the dashed edge
 * is a promise that dropping there works, and a decorative one would be a lie.
 *
 * O rótulo diz o tipo porque o botão **declara** o tipo: quem clica aqui está
 * afirmando que este arquivo é de cavalo, e a afirmação vai junto com os bytes.
 */
function Dropzone({
  tipo,
  busy,
  onFiles,
  onPick,
}: {
  tipo: DefinicaoDeTipo;
  busy: boolean;
  onFiles: (files: File[]) => void;
  onPick: () => void;
}) {
  const [over, setOver] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={onPick}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files).filter((f) =>
          f.name.toLowerCase().endsWith(".xlsx"),
        );
        if (files.length > 0) onFiles(files);
      }}
      className={cn(
        "w-full text-left rounded-xl border-2 border-dashed px-6 py-5",
        "flex items-center gap-4 transition-colors",
        "disabled:cursor-progress",
        over
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50 hover:bg-primary/[0.03]",
      )}
    >
      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
        <Upload className="w-5 h-5 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="font-semibold">
          {busy ? "Lendo…" : `Escolher planilhas de ${tipo.rotulo}`}
        </p>
        <p className="text-sm text-muted-foreground">
          {tipo.descricao} Pode enviar mais de uma de uma vez. O arquivo é lido
          e conferido contra o tipo desta aba, mas
          <strong className="text-foreground"> nada entra</strong> antes de você
          ver o resumo e aprovar.
        </p>
      </div>
    </button>
  );
}

function RunCard({
  run,
  todos,
  expanded,
  onToggle,
  onDetails,
  onDelete,
  onReprocess,
  onToggleHidden,
  togglingHidden,
}: {
  run: ImportRun;
  /** A lista inteira: é dela que sai a história do arquivo deste run. */
  todos: ImportRun[];
  expanded: boolean;
  onToggle: () => void;
  onDetails: () => void;
  onDelete: () => void;
  onReprocess: () => void;
  onToggleHidden: () => void;
  togglingHidden: boolean;
}) {
  const leitura = leituraDoRun(run);
  const historico = historicoDoArquivo(todos, run);
  const oculta = run.hiddenAt !== null;
  return (
    <div
      className={cn(
        "rounded-xl border bg-card px-6 py-5 shadow-sm space-y-5",
        oculta && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold truncate">{run.filename}</h2>
            {/*
              A data **desta** leitura, e não a do arquivo.

              Aqui ficava `receivedAt`, que é `source_file.received_at` — do
              arquivo, e portanto a mesma nos três cartões que o mesmo conteúdo
              produz. O efeito foi visto: uma tentativa recusada mostrava a data
              do recebimento original com os seis contadores em zero, e quem lia
              concluía que o envio daquele dia não tinha produzido nada. Eram
              duas coisas diferentes no mesmo lugar.

              A data do arquivo continua no cartão, quando ela diz algo que esta
              não diz — ver a linha do histórico do arquivo abaixo.
            */}
            <Procedencia
              sha256={run.contentSha256}
              byteSize={run.byteSize}
              quando={dateTime(run.startedAt)}
              quem={run.triggeredBy}
            />
            <PapelNoHistorico run={run} historico={historico} />
            <TipoDaImportacao run={run} />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {oculta && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-full border border-slate-300 bg-slate-100 text-slate-700 inline-flex items-center gap-1">
              <EyeOff className="w-3 h-3" />
              oculta
            </span>
          )}
          <StatusPill status={run.status} />
        </div>
      </div>

      {oculta && (
        <p className="text-sm border border-slate-200 bg-slate-50 text-slate-700 rounded-xl px-4 py-3">
          Esta importação está oculta: os fatos dela não entram no dashboard, no
          comparativo, na cobertura nem no DRE.
          {run.hiddenBy && <> Ocultada por {run.hiddenBy}.</>}
          {run.hiddenReason && <> Motivo: {run.hiddenReason}</>} Use{" "}
          <strong>Reexibir</strong> abaixo para voltar a contar.
        </p>
      )}

      {/* O que este run leu — e a frase precisa ser verdade sobre ele.

          Havia uma frase só, mostrada sempre que "fatos = 0": "as células foram
          gravadas, mas nenhuma aba foi reconhecida como fonte de fatos". Ela é
          verdadeira para o arquivo que entrou e não virou nada — o caso para o
          qual foi escrita, e um caso real: uma planilha de trecho inteira passou
          despercebida com 440 células gravadas, nenhum fato, nenhum erro.

          E é **falsa** para a duplicata, que não gravou célula nenhuma porque
          nem chegou a abrir o arquivo. A tela afirmava um trabalho que não
          houve, e mandava conferir as colunas de uma planilha que o leitor nunca
          viu. Quem decide qual frase cabe é `leituraDoRun`, a partir dos
          contadores do próprio run — ver `@/lib/importacoes`. */}
      {leitura.leitura === "LIDO_SEM_FATOS" && (
        <p className="text-sm border border-amber-200 bg-amber-50 text-amber-900 rounded-xl px-4 py-3">
          Nenhum fato saiu deste arquivo. As células foram gravadas, mas nenhuma
          aba dele foi reconhecida como fonte de fatos — abra{" "}
          <strong>Ver abas do arquivo</strong> abaixo para ler, aba por aba, o
          motivo que o leitor registrou.
        </p>
      )}

      {leitura.leitura === "NAO_ABERTO_DUPLICATA" && (
        <ArquivoNaoAberto
          run={run}
          historico={historico}
          onReprocess={onReprocess}
        />
      )}

      {/* O motivo gravado no run. A duplicata já o diz por extenso no bloco
          acima, com a saída junto; repeti-lo aqui seria a mesma frase duas
          vezes no mesmo cartão. */}
      {run.failureReason && leitura.leitura !== "NAO_ABERTO_DUPLICATA" && (
        <p
          className={cn(
            "text-sm border rounded-xl px-4 py-3",
            TONS[estadoDaImportacao(run.status).tom],
          )}
        >
          {run.failureReason}
        </p>
      )}

      {/* Uma releitura diz de quem é releitura e por quê, no próprio cartão:
          sem isso ela é só mais um cartão do mesmo arquivo, e o histórico volta
          a parecer o que era antes — envios repetidos sem explicação. */}
      {run.reprocessReason !== null && (
        <p className="text-sm border border-blue-200 bg-blue-50 text-blue-900 rounded-xl px-4 py-3">
          <RefreshCw className="w-3.5 h-3.5 inline-block mr-1.5 -mt-0.5" />
          <strong>Reprocessamento.</strong> Releitura do mesmo arquivo já
          recebido
          {historico.releu ? (
            <> — a leitura de {dateTime(historico.releu.startedAt)}</>
          ) : (
            // Reancorada ou órfã: a leitura relida foi excluída depois, o que é
            // o passo final legítimo de corrigir um arquivo lido sob o tipo
            // errado. A releitura continua sendo uma releitura.
            <>, cuja leitura anterior já foi excluída</>
          )}
          . Motivo declarado: <em>{run.reprocessReason}</em>
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Metric
          icon={Table2}
          accent="indigo"
          label="Abas"
          value={n(run.sheets)}
        />
        <Metric
          icon={Database}
          accent="emerald"
          label="Células RAW"
          value={n(run.rawCells)}
        />
        <Metric
          icon={Layers}
          accent="blue"
          label="Fatos"
          value={n(run.stagedFacts)}
        />
        <Metric
          icon={CalendarClock}
          accent="violet"
          label="Vigências"
          value={n(run.snapshots)}
        />
        <Metric
          icon={ShieldCheck}
          accent="red"
          label="Erros"
          value={n(run.errors)}
          tone={run.errors > 0 ? "bad" : "muted"}
        />
        <Metric
          icon={AlertTriangle}
          accent="amber"
          label="Avisos"
          value={n(run.warnings)}
          tone={run.warnings > 0 ? "warn" : "muted"}
        />
      </div>

      {run.labels.length > 0 && (
        <div className="space-y-2">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Vigências ({run.labels.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {run.labels.map((label) => (
              <span
                key={label}
                className="font-mono text-[0.6875rem] px-2.5 py-1 rounded-lg border bg-muted/50 text-muted-foreground"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 pt-1">
        <button
          onClick={onToggle}
          className="text-sm text-primary hover:underline inline-flex items-center gap-1.5 font-medium"
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          Ver abas do arquivo e como cada uma foi tratada
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {/*
            Excluir fica ao lado de "Ver detalhes", e não escondido atrás de um
            menu: é uma ação legítima — a planilha errada, o mês repetido — e
            esconder o desfazer é o que faz alguém conviver com o erro. O que a
            protege não é a dificuldade de achar o botão, e sim a tela seguinte,
            que diz quantos fatos e quais vigências saem antes de perguntar.
          */}
          {/*
            Reprocessar fica ao lado de Excluir porque as duas respondem à
            mesma pergunta — "este arquivo precisa entrar de novo" — e a
            resposta certa quase sempre é esta, não aquela. Enquanto só havia
            Excluir, releitura e apagamento eram a mesma tecla: para reler um
            arquivo era preciso apagar a prova de que ele havia chegado.
          */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onReprocess}
            className="text-blue-700 hover:text-blue-800 hover:bg-blue-50"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Reprocessar
          </Button>
          {/*
            Ocultar não pede confirmação, ao contrário de Excluir: nada sai do
            sistema, e o próprio botão desfaz a ação virando "Reexibir".
          */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleHidden}
            disabled={togglingHidden}
            className="text-slate-700 hover:text-slate-900 hover:bg-slate-100"
          >
            {oculta ? (
              <Eye className="w-3.5 h-3.5 mr-1.5" />
            ) : (
              <EyeOff className="w-3.5 h-3.5 mr-1.5" />
            )}
            {oculta ? "Reexibir" : "Ocultar"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="text-red-700 hover:text-red-800 hover:bg-red-50"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
            Excluir
          </Button>
          <Button variant="outline" size="sm" onClick={onDetails}>
            Ver detalhes
            <ChevronRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>
      </div>

      {expanded && <SheetList runId={run.importRunId} />}
    </div>
  );
}

/**
 * Onde este run se encaixa na história do seu arquivo.
 *
 * Só aparece quando o arquivo teve mais de uma leitura — no caso comum, de um
 * arquivo que entrou uma vez e pronto, dizer "1ª de 1 leitura" seria ruído com
 * cara de rigor. Quando há mais de uma, é esta linha que impede três cartões
 * quase iguais de parecerem três envios sem relação.
 */
function PapelNoHistorico({
  run,
  historico,
}: {
  run: ImportRun;
  historico: HistoricoDoArquivo<ImportRun>;
}) {
  if (historico.leituras.length < 2) return null;
  const posicao = historico.leituras.findIndex(
    (r) => r.importRunId === run.importRunId,
  );

  const PAPEL: Record<PapelNoArquivo, { texto: string; classe: string }> = {
    RECEBIMENTO: {
      texto: "Recebimento original",
      classe: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    TENTATIVA_RECUSADA: {
      texto: "Reenvio recusado",
      classe: "bg-slate-100 text-slate-700 border-slate-300",
    },
    REPROCESSAMENTO: {
      texto: "Reprocessamento",
      classe: "bg-blue-50 text-blue-700 border-blue-200",
    },
  };
  const papel = PAPEL[historico.papel];

  return (
    <p className="text-xs text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span
        className={cn(
          "rounded-md border px-1.5 py-0.5 font-medium",
          papel.classe,
        )}
      >
        {papel.texto}
      </span>
      <span>
        {posicao >= 0 ? `${posicao + 1}ª de ` : ""}
        {plural(historico.leituras.length, "leitura", "leituras")} deste arquivo
      </span>
      <span aria-hidden>·</span>
      <span>arquivo recebido em {dateTime(run.receivedAt)}</span>
    </p>
  );
}

/**
 * A duplicata, dita como ela é: o arquivo não foi aberto.
 *
 * O cartão mostrava seis contadores em zero ao lado de um aviso dizendo que as
 * células tinham sido gravadas e nenhuma aba reconhecida. Os zeros estavam
 * certos e a frase estava errada, e a combinação das duas fazia o operador
 * procurar o defeito nas colunas da planilha dele — quando o que havia
 * acontecido é que o leitor nunca abriu o arquivo.
 *
 * Aqui os zeros ganham a explicação que os torna informação: não houve leitura.
 * E a saída vem junto, porque a pergunta seguinte é sempre a mesma — "então
 * como eu faço para este arquivo entrar?".
 */
function ArquivoNaoAberto({
  run,
  historico,
  onReprocess,
}: {
  run: ImportRun;
  historico: HistoricoDoArquivo<ImportRun>;
  onReprocess: () => void;
}) {
  return (
    <div className="text-sm border border-slate-300 bg-slate-50 text-slate-800 rounded-xl px-4 py-3 space-y-2">
      <p>
        <strong>Nada foi lido: o arquivo não chegou a ser aberto.</strong> O
        SHA-256 reconheceu este conteúdo antes da leitura começar — ele já havia
        sido recebido, byte a byte. Os zeros abaixo são disso:{" "}
        <strong>nenhuma aba, nenhuma célula, nenhum fato</strong>. Não é que o
        leitor não tenha entendido a planilha; é que ele não a abriu.
      </p>
      {historico.recebimento ? (
        <p>
          O recebimento original é a importação de{" "}
          <strong>{dateTime(historico.recebimento.startedAt)}</strong>
          {/* O que aquela importação produziu decide a frase, e a diferença é
              a que mais importa aqui: um recebimento com vigências manda o
              operador para onde o dado está; um recebimento que não produziu
              nada é a causa provável de a tela dele estar vazia, e dizer
              "é lá que está o dado" seria mandá-lo procurar o que não existe. */}
          {historico.recebimento.labels.length > 0 ? (
            <>
              , que gravou{" "}
              {plural(
                historico.recebimento.labels.length,
                "vigência",
                "vigências",
              )}
              :{" "}
              <span className="font-mono text-xs">
                {historico.recebimento.labels.join(", ")}
              </span>
              . É lá que está o que este conteúdo produziu.
            </>
          ) : (
            <>
              {" "}
              — e ela <strong>não produziu vigência nenhuma</strong>. Se a tela
              deste tipo está vazia, é daí que vem: o conteúdo entrou uma vez, e
              aquela leitura não virou dado.
            </>
          )}
        </p>
      ) : (
        <p>
          O recebimento original não está nesta lista — procure em{" "}
          <strong>Todas</strong> pelo mesmo sha256{" "}
          <span className="font-mono text-xs">
            {run.contentSha256.slice(0, 16)}…
          </span>
          .
        </p>
      )}
      <p>
        Se o leitor mudou desde aquela importação — uma coluna que ele não
        entendia, um tipo que ele não sabia identificar —,{" "}
        <button
          onClick={onReprocess}
          className="text-primary font-medium hover:underline"
        >
          reprocesse o arquivo
        </button>
        : o mesmo conteúdo é lido de novo, numa importação nova, sem apagar nada
        do que já está aqui.
      </p>
    </div>
  );
}

/*
  Os nomes e tons de cada estado (ESTADOS, estadoDaImportacao) moram em
  `@/lib/importacoes`, junto com a cara do cartão de upload: é lógica que se
  testa sem desenhar, e o cartão e a pílula precisam contar a mesma história.
*/
/** O selo compartilhado, com a tradução de `import_run_status`. */
function StatusPill({ status }: { status: string }) {
  return <SeloDeEstado estado={estadoDaImportacao(status)} />;
}

/**
 * The whole record of one run, for when the summary is not enough.
 *
 * The SHA-256 appears here in full: truncated it identifies a file for a person
 * reading the list, but only the complete digest lets someone conferir contra o
 * arquivo que tem em mãos.
 */
function RunDetailDialog({
  run,
  onClose,
}: {
  run: ImportRun | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={run !== null} onOpenChange={(open) => !open && onClose()}>
      {run && (
        <>
          <DialogHeader>
            <DialogTitle>{run.filename}</DialogTitle>
            <DialogDescription>
              O registro completo desta execução, como o pipeline a gravou.
            </DialogDescription>
          </DialogHeader>

          <dl className="space-y-3 text-sm">
            <Field label="SHA-256">
              <span className="font-mono text-xs break-all">
                {run.contentSha256}
              </span>
            </Field>
            <Field label="Situação">{run.status.toLowerCase()}</Field>
            <Field label="Tamanho">{n(run.byteSize)} bytes</Field>
            <Field label="Recebido">{dateTime(run.receivedAt)}</Field>
            <Field label="Início">{dateTime(run.startedAt)}</Field>
            <Field label="Fim">
              {run.finishedAt ? dateTime(run.finishedAt) : "—"}
            </Field>
            <Field label="Enviado por">{run.triggeredBy ?? "—"}</Field>
            {/* A mesma distinção do cartão, com as mesmas palavras: o que o
                arquivo trouxe numa linha, o que a vigência resultante cobre na
                outra — e a segunda só quando difere da primeira. */}
            {tiposVindosDoArquivo(run).length > 0 && (
              <Field label="Arquivo">
                {tiposVindosDoArquivo(run).map(rotuloDoTipo).join(" + ")}
                <span className="text-muted-foreground">
                  {" "}
                  ·{" "}
                  {run.declaredType !== null
                    ? "declarado no envio"
                    : "lido do conteúdo do arquivo"}
                </span>
              </Field>
            )}
            {tiposHerdados(run).length > 0 && (
              <Field
                label={
                  run.snapshots === 1
                    ? "Vigência resultante"
                    : "Vigências resultantes"
                }
              >
                {run.entityTypes.map(rotuloDoTipo).join(" + ")}
                <span className="text-muted-foreground">
                  {" "}
                  · {tiposHerdados(run).map(rotuloDoTipo).join(" e ")} veio de
                  revisões anteriores, não deste arquivo
                </span>
              </Field>
            )}
            <Field label="Produziu">
              {plural(run.sheets, "aba", "abas")} ·{" "}
              {plural(run.rawRows, "linha", "linhas")} ·{" "}
              {plural(run.rawCells, "célula", "células")} ·{" "}
              {plural(run.stagedFacts, "fato", "fatos")} ·{" "}
              {plural(run.snapshots, "vigência", "vigências")}
            </Field>
            <Field label="Apontamentos">
              {plural(run.errors, "erro", "erros")} ·{" "}
              {plural(run.warnings, "aviso", "avisos")}
            </Field>
            {run.failureReason && (
              <Field label="Motivo da falha">
                <span className="text-red-800">{run.failureReason}</span>
              </Field>
            )}
          </dl>

          <Apontamentos importRunId={run.importRunId} />

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={onClose}>
              Fechar
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}

/**
 * O que o pipeline anotou, e onde — a evidência que já existia e ninguém lia.
 *
 * A tela mostrava a contagem de erros e avisos. Isso responde "deu problema?" e
 * não responde "qual, em que chave, em que campo", que é o que decide se a
 * origem está errada ou se a nossa leitura dela está. `validation_issue` sempre
 * teve a resposta; faltava alcançá-la.
 *
 * Três decisões que esta lista sustenta:
 *
 * - **A colisão que concorda aparece como as outras.** Duas linhas caindo na
 *   mesma chave e dizendo o mesmo não é erro nenhum, e é o sintoma mais cedo de
 *   um grão que não separa a origem. Ela entra como informação, com a chave e
 *   os campos, e não como um número no fim de um resumo.
 * - **A apresentação vem do pipeline; a tela só desenha.** Cada apontamento
 *   pode trazer, no `detail`, as seções que toda recusa levanta — o que
 *   aconteceu, onde, que registro, o que difere, como corrigir, por que — no
 *   contrato de `@workspace/ingest/apontamentos`. A tela desenha as seções que
 *   vierem; um apontamento sem elas (gravado antes do contrato existir) cai no
 *   fallback: a frase, e o `detail` cru sob "Detalhes técnicos". Nenhum código
 *   interno aparece na leitura principal — código, chave normalizada e o resto
 *   do `detail` moram nos detalhes técnicos, que abrem sob demanda.
 * - **Nada aqui é ação.** É leitura, e só se abre por dentro do detalhe da
 *   importação — o botão que promove continua sendo o do cartão.
 */
function Apontamentos({ importRunId }: { importRunId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["imports", importRunId, "issues"],
    queryFn: () => fetchJson<IssueGroup[]>(`/imports/${importRunId}/issues`),
  });

  const [aberto, setAberto] = useState<string | null>(null);

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Lendo os apontamentos…</p>
    );
  }
  if (error) {
    return (
      <p className="text-sm text-red-900 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
        Não foi possível ler os apontamentos: {(error as Error).message} Esta
        importação pode ter apontamentos — o que falhou foi perguntar.
      </p>
    );
  }
  if (!data || data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        O pipeline não anotou nada nesta importação.
      </p>
    );
  }

  const tom = (severity: string) =>
    severity === "ERROR"
      ? "border-red-200 bg-red-50 text-red-900"
      : severity === "WARNING"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-border bg-muted/30 text-foreground";

  return (
    <div className="space-y-2">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
        Apontamentos
      </p>
      {data.map((grupo) => {
        const id = `${grupo.severity}:${grupo.code}`;
        const expandido = aberto === id;
        /*
          O título do grupo é o do primeiro apontamento dele: dentro de um
          código o título não varia — o que varia (chave, linhas, valores) é
          de cada ocorrência. O código cru só aparece quando não há título,
          isto é, num apontamento gravado antes do contrato de apresentação.
        */
        const titulo = apresentacaoDoDetalhe(
          grupo.ocorrencias[0]?.detail ?? null,
        )?.titulo;
        return (
          <div
            key={id}
            className={cn("rounded-xl border", tom(grupo.severity))}
          >
            <button
              type="button"
              onClick={() => setAberto(expandido ? null : id)}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm"
            >
              {expandido ? (
                <ChevronDown className="w-4 h-4 shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 shrink-0" />
              )}
              {titulo ? (
                <span className="font-medium leading-snug">{titulo}</span>
              ) : (
                <span className="font-mono text-xs">{grupo.code}</span>
              )}
              <span className="ml-auto flex items-center gap-2 shrink-0">
                <SeloDeSeveridade severity={grupo.severity} code={grupo.code} />
                <span className="tabular-nums text-xs font-semibold">
                  {n(grupo.count)}
                </span>
              </span>
            </button>

            {expandido && (
              <ul className="px-4 pb-3 space-y-3 text-sm">
                {grupo.ocorrencias.map((o, i) => (
                  <li
                    key={i}
                    className="border-t border-current/10 pt-3 first:border-t-0 first:pt-0"
                  >
                    <Apontamento
                      ocorrencia={o}
                      code={grupo.code}
                      severity={grupo.severity}
                    />
                  </li>
                ))}
                {/* O corte é do servidor, e é dito: 40 mil células podem
                    produzir dezenas de milhares de apontamentos, e uma lista
                    que parasse sem avisar leria como "só tem estes". */}
                {grupo.count > grupo.ocorrencias.length && (
                  <li className="text-xs opacity-75 border-t border-current/10 pt-2.5">
                    Mostrando {n(grupo.ocorrencias.length)} de {n(grupo.count)}.
                  </li>
                )}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Um apontamento, nas seções do contrato — ou a frase, quando não há contrato.
 *
 * O desenho das seções mora em `components/apontamentos/apresentacao.tsx`,
 * porque a aba de Inconsistências do QLP mostra os mesmos apontamentos e as
 * duas telas não podem discordar sobre o que um conflito é. O que sobrou aqui é
 * o que é da importação: o fallback para o apontamento gravado antes do
 * contrato existir, e os detalhes técnicos com o `detail` cru.
 */
function Apontamento({
  ocorrencia,
  code,
  severity,
}: {
  ocorrencia: IssueGroup["ocorrencias"][number];
  code: string;
  severity: string;
}) {
  const apresentacao = apresentacaoDoDetalhe(ocorrencia.detail);

  if (!apresentacao) {
    return (
      <div className="space-y-2">
        <p className="leading-relaxed">{ocorrencia.message}</p>
        {(ocorrencia.sheetName || ocorrencia.rowIndex !== null) && (
          <p className="text-xs opacity-75">
            {ocorrencia.sheetName && <>aba {ocorrencia.sheetName}</>}
            {ocorrencia.sheetName && ocorrencia.rowIndex !== null && " · "}
            {ocorrencia.rowIndex !== null && <>linha {ocorrencia.rowIndex}</>}
          </p>
        )}
        <DetalhesTecnicos
          ocorrencia={ocorrencia}
          code={code}
          comMensagem={false}
        />
      </div>
    );
  }

  return (
    <SecoesDaApresentacao
      apresentacao={apresentacao}
      severity={severity}
      code={code}
      rodape={
        <DetalhesTecnicos ocorrencia={ocorrencia} code={code} comMensagem />
      }
    />
  );
}

/**
 * O que a leitura principal deixou de fora, atrás de um clique.
 *
 * Código do apontamento, chave normalizada, `detail` cru, a frase de log — tudo
 * continua alcançável, porque é com isso que se depura e é isso que um chamado
 * de suporte pede. O que mudou é o lugar: quem só quer corrigir a planilha não
 * atravessa mais nada disso para chegar ao que interessa.
 */
function DetalhesTecnicos({
  ocorrencia,
  code,
  comMensagem,
}: {
  ocorrencia: IssueGroup["ocorrencias"][number];
  code: string;
  /** A frase (`message`) repete o que as seções já disseram? Então ela é técnica. */
  comMensagem: boolean;
}) {
  const entradas = Object.entries(ocorrencia.detail ?? {}).filter(
    ([campo]) => campo !== CHAVE_DA_APRESENTACAO,
  );
  return (
    <details className="text-xs">
      <summary className="cursor-pointer select-none opacity-60 hover:opacity-100">
        Detalhes técnicos
      </summary>
      <div className="mt-1.5 space-y-1.5 border-l-2 border-current/15 pl-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <dt className="opacity-70">código</dt>
          <dd className="font-mono break-all">{code}</dd>
          {ocorrencia.sheetName && (
            <Fragment>
              <dt className="opacity-70">aba</dt>
              <dd className="font-mono break-all">{ocorrencia.sheetName}</dd>
            </Fragment>
          )}
          {ocorrencia.rowIndex !== null && (
            <Fragment>
              <dt className="opacity-70">linha</dt>
              <dd className="font-mono break-all">{ocorrencia.rowIndex}</dd>
            </Fragment>
          )}
          {entradas.map(([campo, valor]) => (
            <Fragment key={campo}>
              <dt className="opacity-70">{campo}</dt>
              <dd className="font-mono break-all">
                {Array.isArray(valor)
                  ? valor.join(", ")
                  : typeof valor === "object" && valor !== null
                    ? JSON.stringify(valor)
                    : String(valor)}
              </dd>
            </Fragment>
          ))}
        </dl>
        {comMensagem && (
          <p className="leading-relaxed opacity-70">{ocorrencia.message}</p>
        )}
      </div>
    </details>
  );
}

/**
 * A confirmação de uma exclusão, escrita com o que ela de fato apaga.
 *
 * "Tem certeza?" é uma pergunta que ninguém consegue responder: quem está aqui
 * não sabe de cabeça que aquele arquivo sustenta nove vigências e quarenta mil
 * fatos, nem que apagá-lo derruba as comparações que os usam. O servidor conta
 * isso antes — é a mesma conta que a exclusão vai executar —, e é essa lista
 * que vai para a tela. Só depois vem o botão vermelho.
 *
 * A caixa também é onde as recusas aparecem: uma vigência corrigida por uma
 * importação posterior não pode sair antes dela, e o motivo chega inteiro,
 * nomeando o arquivo mais novo em vez de dizer que não foi possível.
 */
function DeleteDialog({
  run,
  onClose,
  onConfirm,
  deleting,
}: {
  run: ImportRun | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  deleting: boolean;
}) {
  const [reason, setReason] = useState("");

  const { data: plan, error } = useQuery({
    queryKey: ["imports", run?.importRunId, "deletion"],
    queryFn: () =>
      fetchJson<DeletionPlan>(`/imports/${run!.importRunId}/deletion`),
    enabled: run !== null,
    // O que sai depende do resto do banco — outra importação promovida no
    // meio-tempo muda a conta. Sem cache: esta prévia é lida uma vez e agida
    // em seguida.
    staleTime: 0,
    gcTime: 0,
  });

  const linhas: [string, number][] = plan
    ? [
        ["Fatos", plan.removes.facts],
        ["Vigências", plan.removes.snapshots],
        ["Comparações já calculadas", plan.removes.changeSets],
        ["Alterações dentro delas", plan.removes.changes],
        ["Equipamentos que ficam sem nenhum dado", plan.removes.entities],
        ["Células RAW (a evidência do arquivo)", plan.removes.rawCells],
        ["Fatos em staging", plan.removes.stagedFacts],
        ["Apontamentos do pipeline", plan.removes.validationIssues],
      ].filter((linha): linha is [string, number] => (linha[1] as number) > 0)
    : [];

  return (
    <Dialog open={run !== null} onOpenChange={(open) => !open && onClose()}>
      {run && (
        <>
          <DialogHeader>
            <DialogTitle>Excluir "{run.filename}"?</DialogTitle>
            <DialogDescription>
              Isto apaga o dado que só esta importação sustenta. O dicionário de
              colunas fica — nenhuma coluna é apagada. Não há desfazer: fica o
              registro de que foi excluída — quem, quando e o que saiu —, não os
              dados.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p className="text-sm text-red-900 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              Não foi possível calcular o que sairia: {(error as Error).message}
            </p>
          )}

          {!plan && !error && (
            <p className="text-sm text-muted-foreground">
              Calculando o que sairia…
            </p>
          )}

          {plan?.refusal && (
            <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              {plan.refusal}
            </p>
          )}

          {plan && !plan.refusal && (
            <div className="space-y-4">
              {linhas.length > 0 ? (
                <dl className="rounded-xl border divide-y overflow-hidden text-sm">
                  {linhas.map(([label, value]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between gap-4 px-4 py-2 bg-muted/30"
                    >
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-semibold tabular-nums">{n(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Esta importação não chegou a produzir nada — nenhum fato,
                  nenhuma vigência. Sai só o registro dela.
                </p>
              )}

              {plan.labels.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    Vigências que somem
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {plan.labels.map((label) => (
                      <span
                        key={label}
                        className="font-mono text-[0.6875rem] px-2.5 py-1 rounded-lg border border-red-200 bg-red-50 text-red-900"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Excluir uma correção devolve ao ar o que ela tinha
                  substituído. É consequência, e não efeito colateral: quem
                  apaga a revisão 2 precisa saber que a 1 volta a valer. */}
              {plan.restoredLabels.length > 0 && (
                <p className="text-sm text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                  A revisão anterior de{" "}
                  <span className="font-mono">
                    {plan.restoredLabels.join(", ")}
                  </span>{" "}
                  volta a valer no lugar desta.
                </p>
              )}

              {/* O dicionário não sai, e quem exclui precisa saber disso tanto
                  quanto precisa saber o que sai: é o que separa "perdi o
                  arquivo" de "perdi a semana que passei descrevendo colunas".
                  Ver `attributeIdsLeftWithoutData` em
                  `lib/ingest/src/deletion.ts`. */}
              {plan.removes.attributesKept > 0 && (
                <p className="text-sm text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                  {plan.removes.attributesKept === 1 ? (
                    <>
                      Uma coluna fica sem dado nenhum —{" "}
                      <strong>ela não é apagada</strong>. Continua no dicionário
                      com tudo o que foi escrito e confirmado nela, e volta a
                      receber valores na próxima importação que a trouxer.
                    </>
                  ) : (
                    <>
                      {n(plan.removes.attributesKept)} colunas ficam sem dado
                      nenhum — <strong>elas não são apagadas</strong>. Continuam
                      no dicionário com tudo o que foi escrito e confirmado
                      nelas, e voltam a receber valores na próxima importação
                      que as trouxer.
                    </>
                  )}
                </p>
              )}

              {plan.removes.sourceFile > 0 && (
                <p className="text-sm text-muted-foreground">
                  O arquivo sai do registro de recebidos, então o mesmo conteúdo
                  poderá ser enviado de novo — hoje ele é recusado como
                  duplicata pelo SHA-256.
                </p>
              )}

              {/* Excluir uma leitura que foi relida é legítimo — é o passo
                  final de corrigir um arquivo lido sob o tipo errado. Mas quem
                  apaga precisa saber que mexe numa corrente: as releituras não
                  saem junto, elas passam a apontar para a leitura anterior. */}
              {plan.reprocessamentosReancorados.length > 0 && (
                <p className="text-sm text-blue-900 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                  {plan.reprocessamentosReancorados.length === 1 ? (
                    <>
                      Uma releitura deste arquivo aponta para esta importação.
                      Ela <strong>não sai junto</strong>: o que ela produziu
                      continua valendo, e ela passa a apontar para a leitura
                      anterior desta corrente.
                    </>
                  ) : (
                    <>
                      {n(plan.reprocessamentosReancorados.length)} releituras
                      deste arquivo apontam para esta importação. Elas{" "}
                      <strong>não saem junto</strong>: o que produziram continua
                      valendo, e passam a apontar para a leitura anterior desta
                      corrente.
                    </>
                  )}
                </p>
              )}

              <label className="block space-y-1.5">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  Motivo (opcional)
                </span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="ex.: planilha de teste enviada por engano"
                  className="w-full rounded-lg border px-3 py-2 text-sm bg-background"
                />
                <span className="text-xs text-muted-foreground">
                  Vai para o registro da exclusão, ao lado do seu nome.
                </span>
              </label>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={!plan || plan.refusal !== null || deleting}
              onClick={() => onConfirm(reason)}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              {deleting ? "Excluindo…" : "Excluir importação"}
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}

/**
 * Reprocessar — a caixa que transforma um clique numa decisão.
 *
 * Reprocessar contorna de propósito a defesa que impede o mesmo conteúdo de
 * entrar duas vezes, e uma ação assim não pode custar um clique. O que a
 * protege não é esconder o botão: é esta tela, que obriga a escrever o que
 * mudou desde a primeira leitura e mostra, antes de perguntar, o que a
 * releitura vai e o que ela **não** vai fazer.
 *
 * A redeclaração do tipo é o caso que originou tudo isto — o arquivo de QLP que
 * entrou quando a aba do QLP ainda não existia, e cuja releitura precisa dizer
 * o que ele é. Trocar o tipo muda a família do dataset, e por isso a vigência
 * nova não substitui a antiga: ela nasce ao lado. Isso está escrito aqui, e não
 * descoberto depois, na tela de Dados, por quem for somar.
 */
function ReprocessDialog({
  run,
  todos,
  tipos,
  onClose,
  onConfirm,
  working,
}: {
  run: ImportRun | null;
  todos: ImportRun[];
  /** As abas da auditoria aberta — as mesmas que o envio oferece. */
  tipos: DefinicaoDeTipo[];
  onClose: () => void;
  onConfirm: (reason: string, declaredType: string | null) => void;
  working: boolean;
}) {
  /*
    Quem será relido não é o cartão de onde se clicou.

    O clique quase sempre sai da tentativa recusada — é nela que a frase "este
    arquivo já havia sido recebido" aparece. Mas quem o servidor relê é a última
    leitura que abriu o arquivo, e é contra a declaração **dela** que a troca de
    tipo se mede. Comparar com o cartão clicado deixaria a tela calada
    exatamente no caso do QLP: a tentativa recusada foi enviada pela aba do QLP,
    o recebimento original não tinha declaração nenhuma, e a releitura muda a
    família do dataset sem ninguém ser avisado.
  */
  const alvo = run ? historicoDoArquivo(todos, run).alvoDaReleitura : null;
  const tipoDoAlvo = alvo?.declaredType ?? null;

  const [reason, setReason] = useState("");
  const [declaredType, setDeclaredType] = useState<string>(
    // O que a tela oferece por padrão é o que o operador provavelmente quer:
    // a declaração do cartão de onde ele clicou, que na dúvida é a mais
    // recente — e não a do run antigo que será relido.
    run?.declaredType ?? tipoDoAlvo ?? SEM_DECLARACAO,
  );

  /*
    O que a releitura pode declarar são as abas deste ambiente — a mesma lista
    do envio, pela mesma razão: reler declarando "Cavalo" de dentro da Auditoria
    Apoio criaria, na operação do apoio, uma vigência de um tipo que ela não
    tem.

    Com uma exceção, e ela é honestidade e não brecha: **o tipo que a leitura
    alvo já declara continua na lista**, mesmo fora deste ambiente. Ele é o
    valor selecionado por padrão, e um `select` sem a própria opção escolhida
    mostraria a primeira da lista como se fosse a declaração atual — a tela
    mentiria sobre o que está prestes a mudar, que é justamente o que o aviso de
    troca de tipo, logo abaixo, existe para não deixar acontecer.
  */
  const opcoesDeTipo: { code: string }[] = [
    ...tipos,
    ...(tipoDoAlvo !== null && !tipos.some((t) => t.code === tipoDoAlvo)
      ? [{ code: tipoDoAlvo }]
      : []),
  ];

  const tipoEscolhido = declaredType === SEM_DECLARACAO ? null : declaredType;
  const trocaDeTipo = tipoEscolhido !== tipoDoAlvo;
  const motivoCurto = reason.trim().length < MOTIVO_MINIMO;

  return (
    <Dialog open={run !== null} onOpenChange={(open) => !open && onClose()}>
      {run && (
        <>
          <DialogHeader>
            <DialogTitle>Reprocessar "{run.filename}"?</DialogTitle>
            <DialogDescription>
              O mesmo arquivo é lido de novo, do começo, numa importação nova.
              Nada do que já está no sistema é apagado ou reescrito.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <dl className="rounded-xl border divide-y overflow-hidden text-sm">
              {[
                ["O arquivo", "não é reenviado — o original guardado é relido"],
                [
                  "Esta importação",
                  "continua no histórico, com o que produziu",
                ],
                ["A releitura", "para em “conferida”; aprovar é outro clique"],
                ["Publicar", "nada entra na base sem essa aprovação"],
              ].map(([label, texto]) => (
                <div
                  key={label}
                  className="flex items-start justify-between gap-4 px-4 py-2 bg-muted/30"
                >
                  <dt className="text-muted-foreground shrink-0">{label}</dt>
                  <dd className="text-right">{texto}</dd>
                </div>
              ))}
            </dl>

            <label className="block space-y-1.5">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Tipo declarado nesta releitura
              </span>
              <select
                value={declaredType}
                onChange={(e) => setDeclaredType(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm bg-background"
              >
                <option value={SEM_DECLARACAO}>
                  Sem declaração — deduzir pelo conteúdo
                </option>
                {opcoesDeTipo.map((tipo) => (
                  <option key={tipo.code} value={tipo.code}>
                    {rotuloDoTipo(tipo.code)}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                {alvo === null ? (
                  "Este arquivo não tem nenhuma leitura para reler."
                ) : (
                  <>
                    A leitura que será relida é a de {dateTime(alvo.startedAt)},
                    que entrou{" "}
                    {tipoDoAlvo
                      ? `como ${rotuloDoTipo(tipoDoAlvo)}.`
                      : "sem declaração — o tipo saiu do conteúdo do arquivo."}
                  </>
                )}
              </span>
            </label>

            {/* A consequência que não é óbvia, dita antes e não depois.

                A identidade de uma vigência inclui a família do dataset, e o
                tipo declarado decide a família. Declarar outro tipo faz a
                vigência nova não ser revisão da antiga: as duas ficam ativas,
                cada uma na sua família. Para a tela do tipo novo isso é o certo
                — ela passa a ver o número. Para quem somar a família antiga, o
                engano continua lá até alguém excluí-lo. */}
            {trocaDeTipo && (
              <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <strong>A releitura muda o tipo declarado</strong>
                {tipoDoAlvo
                  ? ` — de ${rotuloDoTipo(tipoDoAlvo)} para ${
                      tipoEscolhido
                        ? rotuloDoTipo(tipoEscolhido)
                        : "sem declaração"
                    }.`
                  : `: a leitura anterior não declarava tipo, e esta declara ${
                      tipoEscolhido ? rotuloDoTipo(tipoEscolhido) : "nenhum"
                    }.`}{" "}
                {alvo !== null && alvo.labels.length > 0 ? (
                  <>
                    As vigências que a leitura anterior gravou (
                    <span className="font-mono text-xs">
                      {alvo.labels.join(", ")}
                    </span>
                    ) <strong>não são substituídas</strong>
                  </>
                ) : (
                  <>
                    O que a leitura anterior tiver gravado{" "}
                    <strong>não é substituído</strong>
                  </>
                )}
                : tipos diferentes vivem em famílias de dados diferentes, e a
                vigência nova nasce <em>ao lado</em> da antiga em vez de
                corrigi-la. Depois de aprovar a releitura, exclua a importação
                anterior para tirar do sistema o que ela gravou sob o tipo
                errado.
              </p>
            )}

            <label className="block space-y-1.5">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                O que mudou desde a primeira leitura?
              </span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="ex.: o leitor passou a reconhecer o grão do QLP Administrativo"
                className="w-full rounded-lg border px-3 py-2 text-sm bg-background"
              />
              <span className="text-xs text-muted-foreground">
                Obrigatório. Fica no histórico da importação, e é o que explica,
                daqui a meses, por que o mesmo arquivo foi lido duas vezes.
              </span>
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={motivoCurto || working}
              onClick={() => onConfirm(reason.trim(), tipoEscolhido)}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              {working ? "Abrindo releitura…" : "Reprocessar arquivo"}
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3">
      <dt className="text-xs uppercase tracking-wider text-muted-foreground pt-0.5">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/**
 * As cores de cada cara do cartão, no mesmo espírito de TONS: a recusa é
 * vermelha, a duplicata é neutra — pintá-la de vermelho ensina o operador a
 * procurar culpa onde não há —, e o que espera é âmbar.
 */
const CORES_DA_FACE: Record<
  FaceDoCartao["face"],
  { cartao: string; selo: string; icone: string; detalhe: string }
> = {
  lendo: {
    cartao: "border-amber-200 bg-amber-50",
    selo: "bg-amber-100",
    icone: "text-amber-700",
    detalhe: "text-amber-900",
  },
  conferida: {
    cartao: "border-amber-200 bg-amber-50",
    selo: "bg-amber-100",
    icone: "text-amber-700",
    detalhe: "text-amber-900",
  },
  recusada: {
    cartao: "border-red-200 bg-red-50",
    selo: "bg-red-100",
    icone: "text-red-700",
    detalhe: "text-red-900",
  },
  duplicata: {
    cartao: "border-slate-300 bg-slate-100",
    selo: "bg-slate-200",
    icone: "text-slate-700",
    detalhe: "text-slate-700",
  },
  aprovada: {
    cartao: "border-emerald-200 bg-emerald-50",
    selo: "bg-emerald-100",
    icone: "text-emerald-700",
    detalhe: "text-emerald-900",
  },
};

const ICONE_DA_FACE: Record<FaceDoCartao["face"], typeof Upload> = {
  lendo: Upload,
  conferida: CheckCircle2,
  recusada: AlertTriangle,
  duplicata: ShieldCheck,
  aprovada: CheckCircle2,
};

/**
 * One upload in flight: polls until the pipeline finishes reading it.
 *
 * The card shows what the run has produced so far, then the preview summary
 * and the approval button. Approving stays disabled while there are errors,
 * because an error is fixed at the source, not approved.
 *
 * Que cara fazer para cada estado é decisão de `faceDoCartao`, não daqui: o
 * cartão distinguia três estados à mão e todo o resto — a recusa por validação
 * inclusive — aparecia como se ainda estivesse lendo, com o enum cru na tela.
 */
function PendingRun({
  importRunId,
  onDiscard,
  onPromote,
  promoting,
}: {
  importRunId: string;
  onDiscard: () => void;
  onPromote: (confirmNewEntityTypes: string[]) => void;
  promoting: boolean;
}) {
  const { data } = useQuery({
    queryKey: ["imports", importRunId, "status"],
    queryFn: () => fetchJson<RunStatus>(`/imports/${importRunId}/status`),
    // Para em QUALQUER estado terminal. A lista era escrita à mão — PREVIEWED,
    // FAILED, PROMOTED — e um run recusado por validação, que não estava nela,
    // deixava o cartão consultando o servidor a cada 1,2s para sempre.
    refetchInterval: (query) => {
      const s = (query.state.data as RunStatus | undefined)?.status;
      // Quem decide é a face do cartão, e não uma lista de estados repetida
      // aqui: ABORTED — o desfecho que a varredura de órfãs grava quando um
      // reinício levou o processo que lia — é terminal lá, então o cartão para
      // de consultar sozinho, sem que ninguém precise lembrar de somá-lo a uma
      // segunda lista.
      return faceDoCartao(s).emAndamento ? 1200 : false;
    },
  });

  const cara = faceDoCartao(data?.status);
  const cores = CORES_DA_FACE[cara.face];
  const progresso = progressoDaLeitura(data);
  const Icone = ICONE_DA_FACE[cara.face];
  const ready = cara.face === "conferida";
  const recusada = cara.face === "recusada";

  /*
    A única coisa nesta tela que exige decisão, e não leitura.

    Um equipamento que o dicionário não conhece é o começo de uma frota
    paralela — foi assim que a mesma carreta passou a existir duas vezes, com
    dados certos e identidade errada, sem que nada falhasse. Criar equipamento
    continua permitido; o que deixa de existir é criá-lo sem que ninguém tenha
    dito que era isso. Enquanto a caixa não for marcada, aprovar fica travado,
    e a API recusaria de todo jeito: o pipeline exige a mesma declaração.
  */
  const identidadesNovas = data?.pendingIdentities ?? [];
  const [identidadeDeclarada, setIdentidadeDeclarada] = useState(false);

  /*
    Quem decide se dá para aprovar é `decisaoDaAprovacao`, e não este cartão.

    O botão perguntava `errors > 0` aqui mesmo, e foi assim que a tela passou a
    discordar do pipeline: um QLP conferido, com 11.760 fatos e 8 chaves em
    conflito, chegava desabilitado porque a conta de ERROs não é a conta do que
    impede. A regra mora em `lib/importacoes.ts` — testável sem desenhar, e no
    mesmo lugar onde os outros significados de estado deste cartão moram.

    `promoting` fica de fora dela de propósito: é estado da tela (a mutação em
    voo), e não do run.
  */
  const decisao = decisaoDaAprovacao({
    status: data?.status ?? "",
    blockingErrors: data?.blockingErrors ?? 0,
    chavesEmQuarentena: data?.chavesEmQuarentena ?? 0,
    identidadesNaoDeclaradas: identidadeDeclarada ? 0 : identidadesNovas.length,
  });

  return (
    <div className={cn("rounded-xl border px-6 py-5 space-y-4", cores.cartao)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
              cores.selo,
            )}
          >
            <Icone className={cn("w-5 h-5", cores.icone)} />
          </div>
          <div className="min-w-0">
            {/* O nome vem antes do estado: enviando dois arquivos de uma vez,
                dois cartões dizendo "Conferido" não dizem qual é qual. */}
            {data?.filename && (
              <p className="font-bold text-sm truncate">
                {data.filename}
                {/* O tipo declarado aparece aqui porque é agora que ele ainda
                    pode ser desfeito: depois de aprovar, corrigir a aba custa
                    excluir a importação. */}
                {data.declaredType && (
                  <span className="ml-2 font-normal text-xs text-amber-900/80">
                    {/* "enviado como" é falso para uma releitura: ninguém
                        enviou nada — o arquivo já estava aqui, e o tipo foi
                        declarado no pedido de reprocessamento. */}
                    {data.reprocessOfRunId ? "relido como" : "enviado como"}{" "}
                    {rotuloDoTipo(data.declaredType)}
                  </span>
                )}
              </p>
            )}
            <p className="font-semibold text-sm">{cara.titulo}</p>
            <p className={cn("text-xs mt-0.5", cores.detalhe)}>
              {cara.face === "lendo" ? (
                <>
                  {/* A etapa só é dita aqui quando não há barra — um estado
                      que `progressoDaLeitura` ainda não conhece. Com a barra
                      na tela, repeti-la deixava "lendo… lendo… 45%" em duas
                      linhas coladas; o que sobra nesta é a promessa, que a
                      barra não faz.

                      E é o rótulo de ESTADOS, nunca o enum cru: "na fila…",
                      "preparada…" — não "validation_error…". */}
                  {!progresso &&
                    (data
                      ? `${estadoDaImportacao(data.status).rotulo}… `
                      : "recebido… ")}
                  nada entra sem sua aprovação.
                </>
              ) : ready ? (
                <>
                  {/* O que entrou vem primeiro, e vem sempre: era a ressalva
                      que substituía o resumo, e um arquivo com 8 conflitos
                      aparecia sem os 11.760 fatos que ele traz — o que ficou de
                      fora escondendo o que entra. */}
                  {/* labels.length, não snapshots: o contador do run só é
                      preenchido na promoção, e antes dela seria sempre zero. */}
                  {n(data!.facts)} fatos · {data!.labels.length} vigências ·{" "}
                  {n(data!.warnings)} avisos
                  {data!.errors > 0
                    ? ` · ${plural(data!.errors, "erro", "erros")}.`
                    : ", nenhum erro."}{" "}
                  {/* Impedimento num run conferido não acontece hoje — a
                      pré-visualização não deixa um arquivo impeditivo chegar a
                      PREVIEWED. Está escrito porque o dia em que acontecer, o
                      cartão diz o que é, em vez de mostrar um botão morto. */}
                  {decisao.impedimento === "ERRO_BLOQUEANTE" ? (
                    <strong>
                      {plural(
                        data!.blockingErrors,
                        "erro bloqueante",
                        "erros bloqueantes",
                      )}{" "}
                      — corrija a origem antes de aprovar.
                    </strong>
                  ) : (
                    decisao.ressalva && (
                      <strong>{decisao.ressalva.frase}</strong>
                    )
                  )}
                </>
              ) : (
                // O motivo que o pipeline gravou no run — a recusa por
                // validação diz aqui qual conflito foi, em vez de sumir.
                (data?.failureReason ?? cara.motivoPadrao)
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {/* "descartar" prometia o que este botão nunca fez: ele só tira o
              cartão da frente, e a importação continua na lista abaixo,
              esperando decisão. Agora que existe excluir de verdade — no
              cartão de baixo, com a conta do que sai —, as duas palavras não
              podiam continuar sendo a mesma. */}
          <Button variant="ghost" size="sm" onClick={onDiscard}>
            ocultar
          </Button>
          <Button
            size="sm"
            disabled={!decisao.podeAprovar || promoting}
            onClick={() => onPromote(identidadesNovas)}
          >
            {promoting ? "Importando…" : "Aprovar e importar"}
          </Button>
        </div>
      </div>

      {/*
        Quanto da leitura já passou — em degraus, porque é assim que o pipeline
        publica o que fez (ver `progressoDaLeitura`).

        A barra só existe enquanto o cartão está lendo: nas outras caras o que
        importa já está escrito em palavras, e uma barra cheia ao lado de uma
        recusa diria que deu certo. O `aria-*` está aqui porque uma barra que
        só informa por cor e largura não informa quem usa leitor de tela — e o
        texto ao lado dela repete o mesmo número, para quem não vê a animação.
      */}
      {cara.face === "lendo" && progresso && (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 text-xs font-medium text-amber-900">
            <span>
              {progresso.rotulo}…
              {/* De onde sai a porcentagem, dito em números que a pessoa pode
                  conferir contra a planilha dela. Sem isto, "38%" é um número
                  de que ninguém sabe a origem; com isto, é 4.512 de 11.760
                  linhas. Só aparece quando há medida: no degrau por estado não
                  existem linhas a citar. */}
              {progresso.medido && data && data.progressTotal > 0 && (
                <span className="ml-2 font-normal text-amber-900/70">
                  {n(Math.min(data.progressDone, data.progressTotal))} de{" "}
                  {n(data.progressTotal)} linhas
                </span>
              )}
            </span>
            <span className="tabular-nums">{progresso.pct}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={progresso.pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Leitura do arquivo: ${progresso.rotulo}`}
            className="h-1.5 w-full overflow-hidden rounded-full bg-amber-200"
          >
            {/*
              A faixa clara que atravessa o trecho já andado é o que separa
              "processando" de "travado" para quem olha: entre um degrau e o
              seguinte a largura não muda por segundos, e sem movimento nenhum
              o cartão parece parado justamente quando está trabalhando.
            */}
            <div
              className="h-full rounded-full bg-amber-500 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.6),transparent)] bg-[length:40%_100%] bg-no-repeat animate-[shimmer_1.6s_linear_infinite] transition-[width] duration-700 ease-out motion-reduce:animate-none"
              style={{ width: `${progresso.pct}%` }}
            />
          </div>
        </div>
      )}

      {/*
        O preço de aprovar assim mesmo, à vista enquanto ainda dá para escolher.

        Um registro que ficou de fora não aparece como faltando — ele
        simplesmente não aparece, indistinguível na tabela do cargo que a
        unidade não tem. Dizer isso depois da aprovação seria dizer tarde: o
        caminho para ter a vigência inteira (corrigir a origem e importar de
        novo) é uma decisão que se toma agora.
      */}
      {ready && decisao.ressalva && (
        <div className="bg-white/70 border border-amber-300 rounded-lg px-4 py-3 text-sm">
          <strong>{decisao.ressalva.frase}</strong>{" "}
          {decisao.ressalva.consequencia}
        </div>
      )}

      {ready && identidadesNovas.length > 0 && (
        <label className="flex gap-3 items-start bg-white/70 border border-amber-300 rounded-lg px-4 py-3 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="mt-1"
            checked={identidadeDeclarada}
            onChange={(e) => setIdentidadeDeclarada(e.target.checked)}
          />
          <span>
            <strong>
              Esta importação criaria{" "}
              {identidadesNovas.length === 1
                ? "um equipamento novo"
                : "equipamentos novos"}
              : <span className="font-mono">{identidadesNovas.join(", ")}</span>
              .
            </strong>{" "}
            As colunas desta planilha não bateram com nenhum equipamento que já
            existe, então a identidade veio do nome da aba. Se for equipamento
            novo mesmo, confirme. Se for um que já existe com a aba nomeada de
            outro jeito, cancele e confira as colunas — aprovar aqui cria uma
            frota paralela, com os dados certos e a identidade errada.
          </span>
        </label>
      )}

      {ready && data!.labels.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data!.labels.map((label) => (
            <span
              key={label}
              className="font-mono text-[0.6875rem] px-2.5 py-1 rounded-lg bg-white/70 border border-amber-200 text-amber-900"
            >
              {label}
            </span>
          ))}
        </div>
      )}

      {/* Os apontamentos ficam **aqui**, e não só no detalhe de uma importação
          já aprovada: é neste cartão que a decisão acontece, e uma colisão de
          chave que só se pudesse ler depois de aprovar chegaria tarde. Vêm
          fechados por código porque um arquivo normal traz 1.300 avisos de um
          tipo só, e abrir tudo esconderia os três que importam. Nas recusas
          eles são o próprio motivo — a entidade duplicada, o tipo que diverge
          da declaração — então aparecem também. */}
      {(ready || recusada) && (
        <div className="rounded-xl border border-amber-200 bg-white/60 p-4">
          <Apontamentos importRunId={importRunId} />
        </div>
      )}
    </div>
  );
}

function SheetList({ runId }: { runId: string }) {
  const { data, error } = useQuery({
    queryKey: ["imports", runId],
    queryFn: () => fetchJson<RunDetail>(`/imports/${runId}`),
  });

  if (error) {
    return (
      <p className="text-xs text-red-700">
        As abas deste arquivo não puderam ser lidas: {error.message}
      </p>
    );
  }

  if (!data)
    return <p className="text-xs text-muted-foreground">Carregando…</p>;

  // Um run recusado como duplicata — ou que falhou antes da leitura — não tem
  // abas. Uma moldura vazia deixaria isso parecendo carregamento travado.
  if (data.sheets.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nenhuma aba foi lida: este arquivo não chegou a ser aberto.
      </p>
    );
  }

  return (
    <div className="rounded-xl border divide-y overflow-hidden">
      {data.sheets.map((sheet) => (
        <div key={sheet.sheetName} className="px-4 py-3 text-sm bg-muted/30">
          <div className="flex items-center gap-2">
            {sheet.role === "SOURCE" ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            )}
            <span className="font-mono text-xs">{sheet.sheetName}</span>
            <span className="text-xs text-muted-foreground">
              {sheet.rowCount} linhas · {sheet.columnCount} colunas
            </span>
          </div>
          {sheet.roleReason && (
            <p className="text-xs text-muted-foreground mt-1 ml-5.5 pl-0.5">
              {sheet.roleReason}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
