import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FileText,
  History,
  Info,
  Loader2,
  Paperclip,
  PenLine,
  X,
} from "lucide-react";
import { fetchJson, getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { BlocoBook } from "@/lib/book-operador";
import { chaveDoBloco } from "@/lib/book-operador";
import {
  isUnchanged,
  type BookEntryCurrent,
  type BookEntryPostResult,
  type BookEntryRevision,
} from "./types";

/**
 * O painel de um bloco: a regra que vale, como escrevê-la, e o que já valeu.
 *
 * É aqui que o Book do Operador deixa de ser índice e vira conteúdo. A regra
 * entra de dois jeitos, e a escolha não é de gosto: **texto** quando ela cabe
 * escrita e não existe arquivo — o caso de metade dos blocos, cuja regra vive
 * hoje na cabeça de quem opera; **documento** quando existe o contrato, o
 * manual ou a planilha, que carregam tabela, formatação e assinatura que o
 * texto puro perderia.
 *
 * **O histórico fica à vista, não escondido atrás de um link.** Substituir uma
 * regra é o momento em que alguém mais precisa saber o que havia antes — uma
 * remuneração de seis meses atrás se explica pela regra daquele dia, não pela
 * de hoje. Nada aqui apaga: salvar cria a revisão seguinte.
 */
export function BlocoPainel({
  bloco,
  vigente,
  onFechar,
}: {
  bloco: BlocoBook;
  vigente: BookEntryCurrent | undefined;
  onFechar: () => void;
}) {
  const blockKey = chaveDoBloco(bloco);
  const queryClient = useQueryClient();
  const [aba, setAba] = useState<"TEXTO" | "DOCUMENTO">(
    vigente?.kind === "DOCUMENTO" ? "DOCUMENTO" : "TEXTO",
  );

  const historico = useQuery({
    queryKey: ["book-history", blockKey],
    queryFn: () =>
      fetchJson<BookEntryRevision[]>(
        `/book/entries/history?blockKey=${encodeURIComponent(blockKey)}`,
      ),
  });

  const salvar = useMutation({
    mutationFn: (corpo: Record<string, unknown>) =>
      fetchJson<BookEntryPostResult>("/book/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockKey,
          blockCategory: bloco.categoria,
          blockTitle: bloco.titulo,
          ...corpo,
        }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["book-entries"] }),
        queryClient.invalidateQueries({ queryKey: ["book-history", blockKey] }),
      ]);
    },
  });

  /* Esc fecha, como em qualquer sobreposição desta interface. */
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  const revisoes = historico.data ?? [];
  const anteriores = revisoes.slice(1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`Bloco ${bloco.titulo}`}
    >
      <div
        className="fixed inset-0 bg-black/50"
        onClick={onFechar}
        aria-hidden="true"
      />

      <div className="relative z-10 w-full max-w-3xl rounded-md bg-card shadow-xl border border-t-0 my-auto">
        <div className="h-1 bg-brand rounded-t-md" aria-hidden="true" />

        <header className="px-6 pt-5 pb-4 border-b flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <span className="text-sm text-brand-dark">{bloco.categoria}</span>
            <h2 className="text-xl font-bold leading-snug mt-0.5">
              {bloco.titulo}
            </h2>
            <p className="text-sm text-muted-foreground mt-2">
              {bloco.descricao}
            </p>
            {bloco.truncada && (
              <p className="text-xs text-amber-800 mt-1">
                Descrição cortada na captura da tela do Freightech; o texto de lá
                continua.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="p-1.5 rounded hover:bg-muted text-muted-foreground shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="px-6 py-5 space-y-6">
          <RegraVigente entrada={revisoes[0]} carregando={historico.isLoading} />

          <section>
            <h3 className="text-sm font-semibold mb-3">
              {vigente ? "Substituir a regra" : "Registrar a regra"}
            </h3>

            {/*
              O par aba/painel está completo de propósito: `role="tab"` sem um
              `role="tabpanel"` que lhe corresponda anuncia a existência de um
              painel que o leitor de tela depois não acha. Ou se implementa o
              padrão inteiro — `aria-controls` daqui, `aria-labelledby` de lá —
              ou se usa um botão comum. Meio padrão é pior que nenhum.
            */}
            <div className="flex gap-2 mb-4" role="tablist">
              <AbaBotao
                id="book-aba-texto"
                controla="book-painel-texto"
                ativa={aba === "TEXTO"}
                onClick={() => setAba("TEXTO")}
                icone={<PenLine className="w-4 h-4" />}
              >
                Escrever texto
              </AbaBotao>
              <AbaBotao
                id="book-aba-documento"
                controla="book-painel-documento"
                ativa={aba === "DOCUMENTO"}
                onClick={() => setAba("DOCUMENTO")}
                icone={<Paperclip className="w-4 h-4" />}
              >
                Anexar documento
              </AbaBotao>
            </div>

            {aba === "TEXTO" ? (
              <div
                id="book-painel-texto"
                role="tabpanel"
                aria-labelledby="book-aba-texto"
              >
                <FormularioTexto
                  textoAtual={revisoes[0]?.bodyText ?? ""}
                  enviando={salvar.isPending}
                  onEnviar={(bodyText, note) =>
                    salvar.mutate({ kind: "TEXTO", bodyText, note })
                  }
                />
              </div>
            ) : (
              <div
                id="book-painel-documento"
                role="tabpanel"
                aria-labelledby="book-aba-documento"
              >
                <FormularioDocumento
                  enviando={salvar.isPending}
                  onEnviar={(filename, contentBase64, note) =>
                    salvar.mutate({
                      kind: "DOCUMENTO",
                      filename,
                      contentBase64,
                      note,
                    })
                  }
                />
              </div>
            )}

            {salvar.error && (
              <p className="mt-3 text-sm text-red-700">
                {salvar.error.message}
              </p>
            )}
            {salvar.data && isUnchanged(salvar.data) && (
              <p className="mt-3 text-sm text-amber-800">
                {salvar.data.message}
              </p>
            )}
            {salvar.data && !isUnchanged(salvar.data) && (
              <p className="mt-3 text-sm text-emerald-700">
                Gravado como revisão {salvar.data.revision}. A anterior continua
                no histórico.
              </p>
            )}
          </section>

          {anteriores.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                <History className="w-4 h-4 text-muted-foreground" />O que já
                valeu ({anteriores.length})
              </h3>
              <ul className="space-y-2">
                {anteriores.map((revisao) => (
                  <li
                    key={revisao.id}
                    className="rounded border bg-muted/30 px-4 py-3 text-sm"
                  >
                    <LinhaEntrada entrada={revisao} />
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground mt-2">
                Nada aqui foi apagado nem sobrescrito. Uma remuneração antiga se
                confere pela regra que valia naquele dia.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** A regra que vale hoje — ou a declaração de que não há nenhuma. */
function RegraVigente({
  entrada,
  carregando,
}: {
  entrada: BookEntryRevision | undefined;
  carregando: boolean;
}) {
  if (carregando) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Carregando o que este bloco tem…
      </p>
    );
  }

  if (!entrada) {
    return (
      <div className="rounded-md border-l-4 border-sky-500 bg-sky-50 px-4 py-3 text-sky-900">
        <div className="font-semibold text-xs uppercase tracking-wide mb-1 flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5" />
          Sem regra registrada
        </div>
        <p className="text-sm">
          O FreightCheck sabe que este bloco existe — o nome veio da base do
          Freightech — mas não sabe o que ele diz. Escreva a regra abaixo ou
          anexe o documento que a contém.
        </p>
      </div>
    );
  }

  return (
    <section>
      <h3 className="text-sm font-semibold mb-2">A regra que vale</h3>
      <div className="rounded border bg-muted/30 px-4 py-3 text-sm">
        <LinhaEntrada entrada={entrada} />
        {entrada.kind === "TEXTO" && entrada.bodyText && (
          /*
            O texto sai em `whitespace-pre-wrap` e não em markdown renderizado.
            Renderizar exigiria um interpretador, e um interpretador de conteúdo
            que o usuário escreve é superfície que este produto não precisa
            abrir para entregar o que foi pedido. O que a pessoa escreveu é o
            que ela lê de volta, caractere por caractere.
          */
          <pre className="mt-3 whitespace-pre-wrap font-sans text-sm text-foreground border-t pt-3">
            {entrada.bodyText}
          </pre>
        )}
      </div>
    </section>
  );
}

/** A ficha de uma entrada: tipo, autor, data, tamanho e o botão de baixar. */
function LinhaEntrada({ entrada }: { entrada: BookEntryRevision }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-medium">
          {entrada.kind === "DOCUMENTO" ? (
            <Paperclip className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : (
            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <span className="break-all">
            {entrada.kind === "DOCUMENTO"
              ? entrada.filename
              : "Regra escrita no FreightCheck"}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          revisão {entrada.revision} · {formatarBytes(entrada.byteSize)} ·{" "}
          {entrada.createdBy} · {formatarData(entrada.createdAt)}
        </div>
        {entrada.note && (
          <p className="text-xs text-foreground mt-1.5 italic">
            “{entrada.note}”
          </p>
        )}
      </div>

      <a
        href={getApiUrl(`/book/entries/${entrada.id}/content`)}
        className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline shrink-0"
      >
        <Download className="w-4 h-4" />
        Baixar
      </a>
    </div>
  );
}

function AbaBotao({
  id,
  controla,
  ativa,
  onClick,
  icone,
  children,
}: {
  id: string;
  controla: string;
  ativa: boolean;
  onClick: () => void;
  icone: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-controls={controla}
      aria-selected={ativa}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 px-4 py-2 rounded-sm text-sm font-medium border transition-colors",
        ativa
          ? "bg-brand-dark text-brand-foreground border-brand-dark"
          : "bg-card hover:bg-muted text-muted-foreground",
      )}
    >
      {icone}
      {children}
    </button>
  );
}

function FormularioTexto({
  textoAtual,
  enviando,
  onEnviar,
}: {
  textoAtual: string;
  enviando: boolean;
  onEnviar: (bodyText: string, note: string) => void;
}) {
  const [texto, setTexto] = useState(textoAtual);
  const [nota, setNota] = useState("");

  /*
   * O campo começa com a regra atual dentro, e não em branco.
   *
   * Substituir uma regra quase sempre é editar uma frase dela; começar do zero
   * obrigaria a pessoa a copiar o texto de cima à mão, e a chance de perder um
   * parágrafo no caminho é alta demais para um conteúdo que existe justamente
   * para ser exato.
   */
  useEffect(() => {
    setTexto(textoAtual);
  }, [textoAtual]);

  return (
    <form
      onSubmit={(evento) => {
        evento.preventDefault();
        onEnviar(texto, nota);
      }}
      className="space-y-3"
    >
      <div>
        <label htmlFor="book-texto" className="block text-sm font-medium mb-1.5">
          A regra
        </label>
        <textarea
          id="book-texto"
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          rows={10}
          placeholder={
            "Como este item é remunerado, o que entra no cálculo, o que a " +
            "transportadora precisa entregar, e desde quando."
          }
          className="w-full border border-input rounded-sm p-3 text-sm font-mono outline-none focus:border-brand bg-card"
        />
        <p className="text-xs text-muted-foreground mt-1">
          {texto.length.toLocaleString("pt-BR")} de 50.000 caracteres. Acima
          disso, anexe o documento.
        </p>
      </div>

      <CampoNota nota={nota} onNota={setNota} />

      <button
        type="submit"
        disabled={enviando || texto.trim() === ""}
        className="inline-flex items-center gap-2 h-10 px-5 rounded-sm bg-brand-dark text-brand-foreground text-sm font-semibold disabled:opacity-50"
      >
        {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
        Salvar texto
      </button>
    </form>
  );
}

function FormularioDocumento({
  enviando,
  onEnviar,
}: {
  enviando: boolean;
  onEnviar: (filename: string, contentBase64: string, note: string) => void;
}) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [nota, setNota] = useState("");
  const [lendo, setLendo] = useState(false);
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const aceitos = useMemo(
    () =>
      ".pdf,.docx,.xlsx,.pptx,.doc,.xls,.ppt,.png,.jpg,.jpeg,.csv,.txt,.md",
    [],
  );

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!arquivo) return;
    setErroLocal(null);
    setLendo(true);
    try {
      onEnviar(arquivo.name, await lerComoBase64(arquivo), nota);
    } catch {
      // Ler o arquivo do disco pode falhar — o arquivo mudou, foi removido, o
      // navegador negou. Dizer isso é melhor do que um botão que não responde.
      setErroLocal(
        "Não foi possível ler o arquivo do seu computador. Escolha-o de novo.",
      );
    } finally {
      setLendo(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      <div>
        <label
          htmlFor="book-arquivo"
          className="block text-sm font-medium mb-1.5"
        >
          O documento
        </label>
        <input
          id="book-arquivo"
          ref={inputRef}
          type="file"
          accept={aceitos}
          onChange={(evento) => {
            setArquivo(evento.target.files?.[0] ?? null);
            setErroLocal(null);
          }}
          className="block w-full text-sm border border-input rounded-sm p-2.5 bg-card file:mr-3 file:rounded-sm file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
        <p className="text-xs text-muted-foreground mt-1">
          PDF, Word, Excel, PowerPoint, imagem ou texto, até 25 MB.
          {arquivo && ` Escolhido: ${arquivo.name} (${formatarBytes(arquivo.size)}).`}
        </p>
      </div>

      <CampoNota nota={nota} onNota={setNota} />

      {erroLocal && <p className="text-sm text-red-700">{erroLocal}</p>}

      <button
        type="submit"
        disabled={enviando || lendo || !arquivo}
        className="inline-flex items-center gap-2 h-10 px-5 rounded-sm bg-brand-dark text-brand-foreground text-sm font-semibold disabled:opacity-50"
      >
        {(enviando || lendo) && <Loader2 className="w-4 h-4 animate-spin" />}
        Enviar documento
      </button>
    </form>
  );
}

function CampoNota({
  nota,
  onNota,
}: {
  nota: string;
  onNota: (nota: string) => void;
}) {
  return (
    <div>
      <label htmlFor="book-nota" className="block text-sm font-medium mb-1.5">
        O que mudou <span className="font-normal text-muted-foreground">(opcional)</span>
      </label>
      <input
        id="book-nota"
        value={nota}
        onChange={(evento) => onNota(evento.target.value)}
        placeholder="ex.: versão assinada, vigente a partir de 08/2026"
        className="w-full border border-input rounded-sm h-10 px-3 text-sm outline-none focus:border-brand bg-card"
      />
    </div>
  );
}

/**
 * O arquivo em base64, que é como o corpo JSON o carrega.
 *
 * `readAsDataURL` devolve `data:<mime>;base64,<conteúdo>` e o que interessa é o
 * que vem depois da vírgula. O prefixo é descartado aqui e não no servidor
 * porque o servidor valida base64 puro — mandar a URL inteira faria a validação
 * recusar um arquivo perfeitamente bom.
 */
function lerComoBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(leitor.error ?? new Error("read failed"));
    leitor.onload = () => {
      const resultado = String(leitor.result);
      const virgula = resultado.indexOf(",");
      if (virgula === -1) {
        reject(new Error("data URL sem conteúdo"));
        return;
      }
      resolve(resultado.slice(virgula + 1));
    };
    leitor.readAsDataURL(arquivo);
  });
}

export function formatarBytes(total: number): string {
  if (total < 1024) return `${total} B`;
  if (total < 1024 * 1024) return `${Math.round(total / 1024)} KB`;
  return `${(total / (1024 * 1024)).toFixed(1)} MB`;
}

function formatarData(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return iso;
  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
