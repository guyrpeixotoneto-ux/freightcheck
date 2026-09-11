import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Columns3,
  Filter,
  Headset,
  Layers,
  SlidersHorizontal,
  Table2,
  MapPin,
  Trash2,
  Upload,
  Wrench,
} from "lucide-react";

import { ApiErrorNotice } from "@/components/api-error";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Metric,
  Procedencia,
  SeloDeEstado,
  TONS,
} from "@/components/importacoes/cartao";
import { erroDaResposta, fetchJson, getApiUrl, readJson } from "@/lib/api";
import { unidadeDe, useContextos, type Contexto } from "@/lib/contextos";
import { serieDaUnidade } from "@/lib/serie-da-unidade";
import {
  contaDaLeitura,
  emAndamento,
  envioQueLeu,
  estadoDoEnvio,
  leituraSemChamados,
  mesmoConteudo,
  nomeDoCampo,
  origemDaSerie,
  type TicketImportDeletionPlan,
  type TicketImportDeletionResult,
  type TicketImportSummary,
} from "@/lib/chamados-recebidos";
import { cn } from "@/lib/utils";

/**
 * Chamados, em Importações — cada export recebido, e o que saiu dele.
 *
 * Esta aba mostrava `AbaChamados`, o painel analítico de Alterações, inteiro:
 * os cartões de parâmetros alterados, impacto e TMA de **um** envio escolhido
 * num `select`. Era uma resposta certa à pergunta errada. O cabeçalho da tela
 * promete "cada arquivo recebido, o que saiu dele e o que o pipeline apontou", a
 * aba Planilha entrega exatamente isso — um cartão por arquivo, com o SHA-256 à
 * vista —, e a aba ao lado entregava o painel de outra tela. Três consequências
 * concretas, todas vistas:
 *
 * 1. O histórico sumia. O `select` listava só os envios com status `READ`, então
 *    o arquivo que falhou não tinha linha nenhuma — existia só como o número de
 *    uma faixa vermelha agregada, "1 arquivo com problema".
 * 2. A procedência sumia. `ticket_import` guarda `content_sha256` desde a `0012`,
 *    e é ele que recusa o mesmo arquivo duas vezes; a única aba do módulo que
 *    não o mostrava era justamente a que fala de arquivos.
 * 3. A análise estava em duplicidade. A tabela de chamados, o panorama de
 *    impacto e o recorte por vigência são de Alterações, e apareciam aqui.
 *
 * O que esta aba responde é o que a irmã responde: chegou, foi lido, produziu
 * isto, e aqui está a prova de qual arquivo era. O que os chamados **pediram** e
 * o que voltou aplicado continua em Alterações › Chamados, com o arquivo
 * inteiro — e é para lá que a linha do topo aponta.
 */
export function ChamadosRecebidos() {
  const [aberto, setAberto] = useState<string | null>(null);
  /**
   * A unidade que este envio declara — escolhida antes de escolher o arquivo.
   *
   * Mora aqui, e não dentro do dropzone, porque ela precisa sobreviver ao
   * arrastar: o `onDrop` dispara o upload na hora, e um estado que nascesse
   * junto com o seletor não estaria montado quando a mutação lesse o valor.
   * `null` é "não declarar", que continua sendo o padrão.
   */
  const [unidadeDoEnvio, setUnidadeDoEnvio] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<TicketImportSummary | null>(null);
  const [excluido, setExcluido] = useState<string | null>(null);
  // O erro inteiro, e não a frase dele: `ApiErrorNotice` precisa do status e do
  // `code` para separar "o arquivo não serve" de "o banco deste ambiente ainda
  // não tem as tabelas".
  const [erroUpload, setErroUpload] = useState<unknown>(null);
  const [erroExclusao, setErroExclusao] = useState<unknown>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["ticket-imports"],
    queryFn: () => fetchJson<TicketImportSummary[]>("/ticket-imports"),
    /**
     * A leitura roda fora da requisição que recebeu o arquivo, então quem acabou
     * de enviar veria a lista parada em "na fila" até apertar F5. Enquanto
     * houver envio em andamento a tela pergunta de novo sozinha; no resto do
     * tempo não pergunta nada.
     */
    refetchInterval: (q) =>
      q.state.data?.some((envio) => emAndamento(envio.status)) ? 1500 : false,
  });

  const envios = query.data ?? [];

  /**
   * Enviar e excluir invalidam as duas chaves, e não só a desta lista.
   *
   * `["ticket-imports"]` é o histórico que esta aba mostra; `["tickets"]` é a
   * população que Alterações e as telas 360° leem do mesmo envio. Invalidar uma
   * só deixaria a outra tela afirmando um total que acabou de deixar de existir
   * — e como as duas vivem na mesma sessão, a divergência aparece na primeira
   * troca de tela, não numa recarga futura.
   */
  const recarregar = () => {
    queryClient.invalidateQueries({ queryKey: ["ticket-imports"] });
    queryClient.invalidateQueries({ queryKey: ["tickets"] });
  };

  const upload = useMutation({
    mutationFn: async (file: File) => {
      /*
        A unidade é lida aqui dentro, no momento do envio, e não capturada num
        parâmetro: quem arrasta o arquivo nunca passa pelo botão, e o valor que
        vale é o que está no seletor quando o arquivo chega.
      */
      const unidade = unidadeDoEnvio;
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
          ...(unidade === null ? {} : { unidade }),
        }),
      });
      const body = await readJson(response);
      if (!response.ok) throw erroDaResposta(response, body, file.name);
      return body.ticketImportId as string;
    },
    onSuccess: () => {
      setErroUpload(null);
      setExcluido(null);
      recarregar();
    },
    onError: (err: unknown) => setErroUpload(err),
  });

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
      setExcluido(
        `"${result.filename}" foi excluído: ${result.removed.ticketChanges} ` +
          `alteraç${result.removed.ticketChanges === 1 ? "ão" : "ões"} em ` +
          `${result.removed.tickets} chamado${result.removed.tickets === 1 ? "" : "s"} ` +
          `saíram do sistema.` +
          (result.removed.storedFile > 0
            ? " Este arquivo pode ser enviado de novo."
            : ""),
      );
      recarregar();
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
        <DropzoneDeChamados
          busy={upload.isPending}
          onFile={(file) => upload.mutate(file)}
          onPick={() => fileInput.current?.click()}
        />

        <UnidadeDoEnvio valor={unidadeDoEnvio} onChange={setUnidadeDoEnvio} />

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
          <ApiErrorNotice
            error={query.error}
            what="O histórico de envios de chamados não pôde ser carregado."
          />
        )}

        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Lendo o histórico…</p>
        )}

        {!query.isLoading && !query.error && envios.length === 0 && (
          <SemEnvios />
        )}

        {envios.map((envio) => (
          <CartaoDoEnvio
            key={envio.id}
            envio={envio}
            todos={envios}
            expandido={aberto === envio.id}
            onToggle={() =>
              setAberto((atual) => (atual === envio.id ? null : envio.id))
            }
            onDelete={() => {
              setExcluido(null);
              setExcluindo(envio);
            }}
          />
        ))}
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
 * O alvo do envio: um retângulo tracejado que clica e recebe arrasto.
 *
 * Diferente do da Planilha em duas coisas, e as duas são verdade sobre o
 * pipeline e não escolha de desenho. Um arquivo por vez, porque a rota recebe um
 * arquivo por requisição — e dois exports de unidades diferentes são duas séries
 * diferentes, não um lote. E nenhuma promessa de aprovação: aqui ler é o passo
 * inteiro, porque um chamado lido não escreve fato canônico nenhum, e dizer
 * "nada entra antes de você aprovar" seria descrever a outra aba.
 */
function DropzoneDeChamados({
  busy,
  onFile,
  onPick,
}: {
  busy: boolean;
  onFile: (file: File) => void;
  onPick: () => void;
}) {
  const [over, setOver] = useState(false);
  const aceita = (nome: string) =>
    nome.toLowerCase().endsWith(".xlsx") || nome.toLowerCase().endsWith(".csv");

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
        const file = Array.from(e.dataTransfer.files).find((f) =>
          aceita(f.name),
        );
        if (file) onFile(file);
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
          {busy ? "Enviando…" : "Escolher o export da fila de chamados"}
        </p>
        <p className="text-sm text-muted-foreground">
          Um <strong className="text-foreground">.xlsx</strong> ou{" "}
          <strong className="text-foreground">.csv</strong> do Freightech, um por
          vez. O único requisito é ter uma coluna que identifique o chamado
          (&quot;Chamado&quot;, &quot;Nº do chamado&quot;,
          &quot;Protocolo&quot;); as demais são reconhecidas pelo nome, e o que
          não for reconhecido aparece listado em vez de sumir. Ler é o passo
          inteiro — não há aprovação, porque um chamado não escreve fato
          canônico nem vigência.
        </p>
      </div>
    </button>
  );
}

/**
 * O conserto de um envio cuja série não alcança ninguém.
 *
 * ---------------------------------------------------------------------------
 * Por que um botão, e não um aviso
 * ---------------------------------------------------------------------------
 *
 * A série é decidida **uma vez**, na leitura do arquivo. Melhorar a derivação
 * depois disso — passar a ler a coluna `Unidade` de `payload`, passar a achar a
 * unidade dentro de `Chamados Agosto Camaçari.xlsx` — não alcança nada que já
 * esteja no banco: o envio lido pelo build antigo continua exatamente onde
 * estava, e a única saída era excluir o arquivo e reimportá-lo, perdendo a régua
 * de dias que ele sustenta.
 *
 * Aparece em dois estados, e só neles:
 *
 * 1. **Série indeterminada.** O envio não pertence a fila nenhuma, e um acervo
 *    todo assim faz o Monitoramento somar todas as unidades. É o caso que doeu.
 * 2. **Série que não é do cadastro.** `Agosto Camaçari` é uma série — separa
 *    este envio dos outros — e não casa com unidade nenhuma da lateral, então o
 *    recorte que sai dela nunca chega a ninguém. Tecnicamente particionado,
 *    praticamente invisível.
 *
 * No envio cuja série **já** é uma unidade do cadastro não há o que consertar, e
 * oferecer o botão ali convidaria a mexer numa partição que está certa.
 */
function RepararSerie({ envio }: { envio: TicketImportSummary }) {
  const [unidade, setUnidade] = useState<string | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const contextos = useContextos();

  const unidades = unidadesDaLateral(contextos.dados);

  /*
    "A série casa com uma unidade da lateral?" é a mesma pergunta que o
    Monitoramento faz, e é por isso que a resposta sai de `serieDaUnidade`, e não
    de uma comparação escrita aqui: duas réguas de igualdade divergem no dia em
    que uma delas muda, e no dia da divergência esta tela ofereceria conserto
    para um envio certo, ou o esconderia de um errado.
  */
  const series = [{ serie: envio.serie }];
  const alcancaAlguem =
    envio.serie !== null && unidades.some((u) => serieDaUnidade(u, series) !== null);

  /*
    Duas condições para dizer "esta série não chega a ninguém", e as duas são
    sobre o que se **sabe**, não sobre o que se vê:

    - a lista de unidades tem de ter chegado. Enquanto ela não chegou, nenhuma
      unidade casa com nada, e sem esta guarda a tira piscaria "não chega a
      ninguém" por cima de um envio certo antes de sumir sozinha;
    - e tem de haver cadastro. Numa instalação sem unidade nenhuma o casamento
      falha por não haver com quem casar, e oferecer conserto ali acusaria de
      quebrado todo envio do acervo.

    O envio **sem série** não depende de nenhuma das duas: ele está quebrado com
    cadastro ou sem, e é o caso que doeu.
  */
  const daParaJulgarASerie = contextos.houveResposta && unidades.length > 0;

  const reparar = useMutation({
    mutationFn: async (declarar: string | null) => {
      const response = await fetch(getApiUrl(`/ticket-imports/${envio.id}/serie`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(declarar === null ? {} : { unidade: declarar }),
      });
      const body = await readJson(response);
      if (!response.ok) throw erroDaResposta(response, body);
      return body as unknown as { serie: string | null; enviosRecalculados: number };
    },
    onSuccess: (r) => {
      setErro(null);
      setFeito(
        r.serie === null
          ? "A série continua indeterminada: nem o arquivo nem o nome dele nomeiam unidade. Escolha a unidade acima para declará-la."
          : `Série "${r.serie}". ${r.enviosRecalculados} envio${
              r.enviosRecalculados === 1 ? "" : "s"
            } tiveram a comparação refeita.`,
      );
      queryClient.invalidateQueries({ queryKey: ["ticket-imports"] });
      /*
        O Monitoramento lê a mesma série por outras chaves, e é lá que o efeito
        deste botão aparece. Não invalidá-las deixaria a tela vizinha afirmando
        um recorte que acabou de deixar de existir.
      */
      queryClient.invalidateQueries({ queryKey: ["monitoramento-chamados"] });
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
    },
    onError: (err: unknown) => {
      setFeito(null);
      setErro(err);
    },
  });

  /*
    O envio MISTA não entra. Ele não é um envio que calou: é um que nomeou
    **várias** unidades, e o motor já sabe o que fazer com isso — compara por
    (unidade, número do chamado), linha a linha. Oferecer o conserto aqui
    escreveria "este envio não diz de que unidade veio" sobre um arquivo que
    disse de mais, que é a frase errada e o convite errado.
  */
  if (envio.serieOrigem === "MISTA") return null;

  const precisaDeConserto =
    envio.serie === null || (daParaJulgarASerie && !alcancaAlguem);
  if (!precisaDeConserto && feito === null) return null;

  return (
    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 space-y-2">
      <p className="text-xs text-amber-900">
        {envio.serie === null ? (
          <>
            Este envio não diz de que unidade veio, e enquanto o acervo inteiro
            estiver assim o Monitoramento soma <strong>todas</strong> as unidades.
          </>
        ) : (
          <>
            A série <strong>{envio.serie}</strong> não é nenhuma das unidades
            cadastradas, então o recorte que sai dela não chega a ninguém.
          </>
        )}{" "}
        Declare a unidade — ou recalcule, se a coluna do arquivo passou a ser
        lida desde o envio.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {unidades.length > 0 && (
          <Select
            value={unidade ?? SEM_DECLARAR}
            onValueChange={(v) => setUnidade(v === SEM_DECLARAR ? null : v)}
          >
            <SelectTrigger className="w-[220px] h-8 bg-white">
              <SelectValue placeholder="Unidade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_DECLARAR}>Escolher a unidade…</SelectItem>
              {unidades.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-8 bg-white"
          disabled={reparar.isPending}
          onClick={() => reparar.mutate(unidade)}
        >
          <Wrench className="w-3.5 h-3.5 mr-1.5" />
          {reparar.isPending
            ? "Recalculando…"
            : unidade === null
              ? "Recalcular a série"
              : `Declarar ${unidade}`}
        </Button>
      </div>

      {feito && <p className="text-xs text-emerald-900">{feito}</p>}
      {erro != null && (
        <ApiErrorNotice error={erro} what="A série do envio não pôde ser refeita." />
      )}
    </div>
  );
}

/** O valor com que "não declarar" viaja no `Select`, que não aceita `""`. */
const SEM_DECLARAR = "__sem_declarar__";

/**
 * As unidades como a lateral as nomeia — a lista que os dois seletores daqui
 * oferecem.
 *
 * `unidadeDe` é a mesma função que a barra lateral usa, e é de propósito: é com
 * esse texto que o Monitoramento casa a unidade aberta com a série do envio
 * (`lib/serie-da-unidade.ts`). Oferecer um vocabulário diferente aqui produziria
 * declarações que não casam com tela nenhuma — o mesmo desencontro que este
 * trabalho existe para desfazer, agora escrito por nós.
 *
 * `dados` e não `data`: a consulta dos contextos é resiliente, e o que ela
 * devolve é a última resposta válida — `undefined` só quando nunca houve uma.
 */
function unidadesDaLateral(contextos: Contexto[] | undefined): string[] {
  return [
    ...new Set(
      (contextos ?? []).map(unidadeDe).filter((u) => u.trim() !== ""),
    ),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/**
 * A unidade deste envio — declarada por quem importa, e opcional.
 *
 * ---------------------------------------------------------------------------
 * Por que a pergunta existe
 * ---------------------------------------------------------------------------
 *
 * A série de um envio é a unidade, e ela é derivada: sai da coluna `Unidade`
 * das linhas ou do nome do arquivo. O export real do Freightech nem sempre traz
 * a coluna, e o nome é o que a pessoa salvou. Quando as duas calam, a série fica
 * indeterminada — e um acervo inteiro indeterminado faz o Monitoramento de
 * Chamados **somar todas as unidades** embaixo do nome da que está aberta na
 * lateral, avisando na tira que é isso que está fazendo.
 *
 * Medido: `Chamados Agosto Camaçari.xlsx`, 2.349 chamados, coluna vazia em todas
 * as linhas, e a tela mostrando o envio inteiro para quem tinha PERNAMBUCO
 * aberto. Este seletor é o caminho que não depende de o arquivo colaborar.
 *
 * **Opcional, e não obrigatório.** Exigir a unidade aqui recusaria o arquivo de
 * quem não sabe qual escolher — trocaria um recorte ruim por nenhum arquivo. Sem
 * declaração o caminho é o de sempre, e o envio continua reparável depois, no
 * cartão dele.
 *
 * A lista é a da lateral, e é de propósito: é com esse texto que o
 * Monitoramento casa a unidade aberta com a série do envio
 * (`lib/serie-da-unidade.ts`), e oferecer um vocabulário diferente aqui
 * produziria declarações que não casam com tela nenhuma — o mesmo desencontro,
 * agora escrito por nós.
 */
function UnidadeDoEnvio({
  valor,
  onChange,
}: {
  valor: string | null;
  onChange: (valor: string | null) => void;
}) {
  const contextos = useContextos();
  const unidades = unidadesDaLateral(contextos.dados);

  /*
    Sem cadastro não há o que oferecer, e um seletor vazio é pior do que nenhum:
    ele promete uma escolha que não existe e ocupa o lugar onde a explicação
    caberia. A instalação que ainda não importou vigência nenhuma cai aqui.
  */
  if (unidades.length === 0) return null;

  return (
    <div className="superficie px-6 py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
        <MapPin className="w-5 h-5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-sm">Unidade deste envio (opcional)</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          O export nem sempre diz de que unidade veio. Declarando aqui, o
          Monitoramento mostra estes chamados só para quem abrir esta unidade —
          em vez de somá-los a todas. Dá para declarar depois, no cartão do
          arquivo.
        </p>
      </div>
      <Select
        value={valor ?? SEM_DECLARAR}
        onValueChange={(v) => onChange(v === SEM_DECLARAR ? null : v)}
      >
        <SelectTrigger className="w-[240px]">
          <SelectValue placeholder="Unidade" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SEM_DECLARAR}>Deixar o arquivo dizer</SelectItem>
          {unidades.map((u) => (
            <SelectItem key={u} value={u}>
              {u}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** A lista vazia, dizendo o que ela vai passar a mostrar. */
function SemEnvios() {
  return (
    <div className="superficie px-6 py-5 flex items-start gap-4">
      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0">
        <Headset className="w-5 h-5 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <p className="font-semibold">Nenhum export de chamados recebido</p>
        <p className="text-sm text-muted-foreground mt-0.5">
          Cada arquivo enviado aqui vira uma linha desta lista, com o SHA-256 que
          o identifica e o que a leitura produziu. O que os chamados pediram e o
          que voltou aplicado é outra pergunta, e ela se responde em{" "}
          <strong className="text-foreground">Alterações › Chamados</strong>.
        </p>
      </div>
    </div>
  );
}

/**
 * Um arquivo recebido — a mesma forma do cartão da Planilha, com os contadores
 * que este pipeline de fato produz.
 *
 * Os seis ladrilhos não são os seis de lá, e não deveriam ser: chamado não tem
 * célula RAW, não tem fato, não tem vigência. O que ele tem é o destino de cada
 * linha do arquivo e o reconhecimento de cada coluna — e é isso que a conta
 * `linhas = chamados + ignoradas` sustenta, à vista, no lugar onde a outra aba
 * mostra erros e avisos.
 */
function CartaoDoEnvio({
  envio,
  todos,
  expandido,
  onToggle,
  onDelete,
}: {
  envio: TicketImportSummary;
  /** A lista inteira: é dela que sai a história do conteúdo deste envio. */
  todos: TicketImportSummary[];
  expandido: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const estado = estadoDoEnvio(envio.status);
  const conta = contaDaLeitura(envio);
  const semChamados = leituraSemChamados(envio);
  const serie = origemDaSerie(envio);
  const repetidos = mesmoConteudo(todos, envio);
  const leuAntes = envioQueLeu(todos, envio);
  const reconhecidas = Object.keys(envio.columnMapping).length;
  /** O envio chegou a ser lido — é dele que a série e a conta falam. */
  const leu = semChamados !== "FALHOU" && semChamados !== "DUPLICATA";
  const temDetalhe =
    reconhecidas > 0 ||
    envio.unmappedColumns.length > 0 ||
    envio.parameterColumns.length > 0;

  return (
    <div className="superficie px-6 py-5 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-center shrink-0">
            <Headset className="w-6 h-6 text-sky-600" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold truncate">{envio.filename}</h2>
            {/* `receivedAt` e não `finishedAt`: a data que responde por "este
                arquivo chegou" é a do recebimento, e ela é a mesma em todos os
                estados — inclusive no do envio que nunca terminou de ser lido,
                que é justamente quando a outra faltaria. Quando a leitura
                terminou é dito abaixo, onde diz algo que esta não diz. */}
            <Procedencia
              sha256={envio.contentSha256}
              byteSize={envio.byteSize}
              quando={new Date(envio.receivedAt).toLocaleString("pt-BR")}
              quem={envio.receivedBy}
            />

            {/* A série é o que separa "reenvio da mesma fila" de "a fila de
                outra unidade" — dois arquivos do mesmo dia com contagens
                diferentes se parecem exatamente, e comparar Recife com Camaçari
                produziria movimentação falsa em massa.

                Só sobre o envio que chegou a ser lido: um arquivo recusado ou
                que falhou nunca entrou em série nenhuma, e dizer dele "série
                indeterminada — comparado só consigo mesmo" descreve uma
                comparação que não vai acontecer. A frase estava certa e no
                cartão errado. */}
            {leu && (
              <p className="text-xs text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-foreground">Série</span>
                {serie ? (
                  <>
                    <span className="font-mono text-[0.6875rem] px-2 py-0.5 rounded-md border bg-muted/50">
                      {serie.serie}
                    </span>
                    <span className={cn(!serie.confiavel && "text-amber-700")}>
                      {serie.origem}
                    </span>
                  </>
                ) : (
                  <span>
                    indeterminada — este envio é comparado só consigo mesmo,
                    nunca às cegas com outro
                  </span>
                )}
              </p>
            )}
            {leu && <RepararSerie envio={envio} />}
          </div>
        </div>
        <SeloDeEstado estado={estado} />
      </div>

      {/* A duplicata aponta para o envio que de fato leu este conteúdo: sem
          isso, "arquivo já recebido" manda quem lê procurar na lista qual dos
          arquivos com o mesmo nome foi o bom. */}
      {semChamados === "DUPLICATA" && (
        <p className="text-sm border border-slate-200 bg-slate-50 text-slate-700 rounded-xl px-4 py-3">
          Este conteúdo já havia entrado, e por isso o arquivo não foi lido de
          novo — é o SHA-256 fazendo o trabalho dele, não um erro.
          {leuAntes ? (
            <>
              {" "}
              Quem o leu foi{" "}
              <strong>
                {leuAntes.filename}
              </strong>, em{" "}
              {new Date(leuAntes.receivedAt).toLocaleDateString("pt-BR")}.
            </>
          ) : (
            <> O envio que o leu já foi excluído desde então.</>
          )}
        </p>
      )}

      {semChamados === "LIDO_SEM_CHAMADOS" && (
        <p className="text-sm border border-amber-200 bg-amber-50 text-amber-900 rounded-xl px-4 py-3">
          Nenhum chamado saiu deste arquivo. Ele trazia{" "}
          {envio.rowCount.toLocaleString("pt-BR")} linha
          {envio.rowCount === 1 ? "" : "s"} de dados, e nenhuma delas tinha
          número de chamado que a leitura reconhecesse — abra{" "}
          <strong>Ver as colunas do arquivo</strong> abaixo para conferir de que
          coluna a leitura tentou tirá-lo.
        </p>
      )}

      {/* O motivo gravado no envio. A duplicata já o diz por extenso no bloco
          acima, com o envio que leu o conteúdo junto; repeti-lo aqui seria a
          mesma frase duas vezes no mesmo cartão — e a segunda cópia é a versão
          com o sha256 cru no meio, que é a pior das duas de se ler. */}
      {envio.failureReason && semChamados !== "DUPLICATA" && (
        <p
          className={cn(
            "text-sm border rounded-xl px-4 py-3",
            TONS[estado.tom],
          )}
        >
          {envio.failureReason}
        </p>
      )}

      {/* A conta que fecha, dita só quando não fecha: toda linha do arquivo teve
          um destino, e uma linha que sumiu sem ser contada é a única coisa que
          esses três números não conseguem esconder. */}
      {conta.aferivel && !conta.fecha && (
        <p className="text-sm border border-red-200 bg-red-50 text-red-800 rounded-xl px-4 py-3">
          A conta das linhas não fecha:{" "}
          {envio.rowCount.toLocaleString("pt-BR")} de dados, mas{" "}
          {envio.ticketCount.toLocaleString("pt-BR")} viraram chamado e{" "}
          {envio.ignoredRowCount.toLocaleString("pt-BR")} ficaram de fora —{" "}
          {Math.abs(conta.diferenca).toLocaleString("pt-BR")} linha
          {Math.abs(conta.diferenca) === 1 ? "" : "s"} sem destino registrado.
        </p>
      )}

      {repetidos.length > 0 && semChamados !== "DUPLICATA" && (
        <p className="text-xs text-muted-foreground">
          O mesmo conteúdo aparece em {repetidos.length + 1} envios desta lista —
          o SHA-256 é o mesmo nos {repetidos.length + 1}.
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Metric
          icon={Table2}
          accent="indigo"
          label="Linhas"
          value={envio.rowCount.toLocaleString("pt-BR")}
        />
        <Metric
          icon={Headset}
          accent="blue"
          label="Chamados"
          value={envio.ticketCount.toLocaleString("pt-BR")}
        />
        <Metric
          icon={SlidersHorizontal}
          accent="violet"
          label="Parâmetros"
          value={envio.parameterColumns.length.toLocaleString("pt-BR")}
        />
        <Metric
          icon={Columns3}
          accent="emerald"
          label="Campos lidos"
          value={reconhecidas.toLocaleString("pt-BR")}
        />
        <Metric
          icon={Filter}
          accent="slate"
          label="Ignoradas"
          value={envio.ignoredRowCount.toLocaleString("pt-BR")}
          tone={envio.ignoredRowCount > 0 ? "warn" : "muted"}
        />
        <Metric
          icon={Layers}
          accent="amber"
          label="Não mapeadas"
          value={envio.unmappedColumns.length.toLocaleString("pt-BR")}
          tone={envio.unmappedColumns.length > 0 ? "warn" : "muted"}
        />
      </div>

      {envio.finishedAt && (
        <p className="text-xs text-muted-foreground">
          Leitura terminada em{" "}
          {new Date(envio.finishedAt).toLocaleString("pt-BR")}.
        </p>
      )}

      <div className="flex items-center justify-between gap-4 pt-1">
        {temDetalhe ? (
          <button
            onClick={onToggle}
            className="text-sm text-primary hover:underline inline-flex items-center gap-1.5 font-medium"
          >
            {expandido ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            Ver as colunas do arquivo e como cada uma foi lida
          </button>
        ) : (
          <span />
        )}
        {/*
          Excluir fica à vista, e não escondido atrás de um menu: mandar o
          arquivo errado é banal — o export de teste, a fila com o filtro
          trocado — e esconder o desfazer é o que faz alguém conviver com o
          erro. O que protege não é a dificuldade de achar o botão, e sim a
          caixa seguinte, que diz quantos chamados saem antes de perguntar.
        */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-red-700 hover:text-red-800 hover:bg-red-50 shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5 mr-1.5" />
          Excluir
        </Button>
      </div>

      {expandido && temDetalhe && <ColunasDoArquivo envio={envio} />}
    </div>
  );
}

/**
 * De que coluna do arquivo saiu cada campo — por envio, e não da tela toda.
 *
 * Este painel existia uma vez só, no topo da aba, e falava sempre do envio
 * escolhido no `select`. Aqui ele é do cartão: quem compara dois exports da
 * mesma unidade está justamente atrás da coluna que mudou de nome entre um e
 * outro, e um painel único obrigaria a trocar de envio no topo para ver o
 * segundo — sem nunca ver os dois lado a lado.
 */
function ColunasDoArquivo({ envio }: { envio: TicketImportSummary }) {
  return (
    <div className="rounded-xl border bg-muted/30 p-4 space-y-4 text-sm">
      {envio.unmappedColumns.length > 0 && (
        <div>
          <div className="font-medium">
            {envio.unmappedColumns.length} colunas do arquivo não têm campo
            correspondente aqui
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {envio.unmappedColumns.map((coluna) => (
              <span
                key={coluna}
                className="rounded border bg-background px-2 py-0.5 font-mono text-xs text-muted-foreground"
              >
                {coluna}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Elas continuam inteiras na linha de origem — abra qualquer chamado
            para vê-las.
          </p>
        </div>
      )}

      {/* A conta que protege o modo de falha desta leitura: um mapeamento errado
          não estoura, só produz menos alterações — e "menos" é indistinguível de
          "o chamado mexeu em pouca coisa" a olho nu. */}
      {envio.parameterColumns.length > 0 && (
        <div>
          <div className="font-medium">
            {envio.parameterColumns.length} colunas de parâmetro reconhecidas
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {envio.parameterColumns.map((coluna) => (
              <span
                key={coluna}
                className="rounded border bg-background px-2 py-0.5 font-mono text-xs text-muted-foreground"
              >
                {coluna}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Uma célula vazia quer dizer que aquele chamado não mexeu naquele
            parâmetro — é o normal, e por isso nenhuma alteração é criada para
            ela. As colunas com <span className="font-mono">↔</span> são pares
            antes/depois que o próprio arquivo trouxe.
          </p>
        </div>
      )}

      {Object.keys(envio.columnMapping).length > 0 && (
        <div>
          <div className="font-medium">
            De que coluna do arquivo saiu cada campo
          </div>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
            {Object.entries(envio.columnMapping).map(([campo, ligacao]) => (
              <div key={campo} className="flex items-baseline gap-2 min-w-0">
                <span className="text-muted-foreground shrink-0">
                  {nomeDoCampo(campo)}:
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
            ))}
          </div>
        </div>
      )}

      {/* A conta das linhas, por extenso: os três números do cartão dizem o
          quanto, e esta frase diz que eles fecham. */}
      <p className="text-xs text-muted-foreground">
        O arquivo trazia{" "}
        <strong>{envio.rowCount.toLocaleString("pt-BR")}</strong> linhas de
        dados; <strong>{envio.ticketCount.toLocaleString("pt-BR")}</strong>{" "}
        viraram chamado e{" "}
        <strong>{envio.ignoredRowCount.toLocaleString("pt-BR")}</strong> ficaram
        de fora por não terem número de chamado. Nada foi descartado em silêncio.
      </p>
    </div>
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
