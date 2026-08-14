import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import {
  ArrowUp,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Sparkles,
  Terminal,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Mensagem } from "@/components/assistente/mensagem";
import type {
  Capacidades,
  ConversaResumo,
  Resposta,
  Turno,
} from "@/components/assistente/tipos";
import { fetchJson, getApiUrl, readJson } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Assistente — conversar com o FreightCheck.
 *
 * **Conversa, não formulário.** A tela anterior era um campo de busca acima de
 * um relatório: cada pergunta apagava a anterior, e a resposta vinha como um
 * painel de cartões. Aqui a conversa é a tela — o que foi perguntado continua
 * visível, o composer fica embaixo, e a resposta ocupa a largura em que se lê
 * texto, não a largura em que cabem cartões.
 *
 * **O que saiu de vista de propósito.** O selo "redação em código" era detalhe
 * de implementação exibido como se fosse informação de confiança. O que importa
 * a quem lê é de onde veio o que está escrito, e isso está nas fontes. O modo de
 * redação continua acessível no painel técnico, para quem desenvolve.
 *
 * **O recorte aparece acima da resposta.** Uma resposta com número descreve uma
 * unidade, um canal e uma vigência; dizê-lo ali é a mesma regra que toda tela
 * deste produto segue — escolher por padrão é aceitável, escolher em silêncio
 * não.
 */

const SUGESTOES_INICIAIS = [
  {
    categoria: "Entender um parâmetro",
    pergunta: "Como funciona o preço de combustível?",
  },
  {
    categoria: "Analisar alterações",
    pergunta: "O que mais mudou na última vigência?",
  },
  { categoria: "Impacto financeiro", pergunta: "Onde tivemos maior perda?" },
  { categoria: "Book do Operador", pergunta: "O que o Book diz sobre IPVA?" },
];

export default function Assistente() {
  const search = useSearch();
  const cliente = useQueryClient();

  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [painelTecnico, setPainelTecnico] = useState(false);

  const campo = useRef<HTMLTextAreaElement>(null);
  const fim = useRef<HTMLDivElement>(null);

  const recorte = useMemo(() => {
    const p = new URLSearchParams(search);
    return {
      scopeHash: p.get("scopeHash") ?? undefined,
      canal: p.get("canal") ?? undefined,
      period: p.get("period") ?? undefined,
    };
  }, [search]);

  const capacidades = useQuery({
    queryKey: ["assistant-capabilities"],
    queryFn: () => fetchJson<Capacidades>("/assistant/capabilities"),
  });

  const conversas = useQuery({
    queryKey: ["assistant-conversations"],
    queryFn: () => fetchJson<ConversaResumo[]>("/assistant/conversations"),
  });

  const perguntar = useMutation({
    mutationFn: async (pergunta: string) => {
      const resposta = await fetch(getApiUrl("/assistant/ask"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pergunta,
          ...(conversaId ? { conversationId: conversaId } : {}),
          ...recorte,
        }),
      });
      const corpo = await readJson(resposta);
      if (!resposta.ok) {
        throw new Error(
          typeof corpo.error === "string" ? corpo.error : `O servidor respondeu ${resposta.status}.`,
        );
      }
      return corpo as unknown as Resposta;
    },
    onSuccess: (r) => {
      setConversaId(r.conversationId);
      setTurnos((atuais) => [
        ...atuais,
        { papel: "RESPOSTA", texto: r.texto, resposta: r },
      ]);
      void cliente.invalidateQueries({ queryKey: ["assistant-conversations"] });
    },
  });

  const enviar = (texto: string) => {
    const limpa = texto.trim();
    if (!limpa || perguntar.isPending) return;
    setTurnos((atuais) => [...atuais, { papel: "PERGUNTA", texto: limpa }]);
    setRascunho("");
    perguntar.mutate(limpa);
  };

  const novaConversa = () => {
    setTurnos([]);
    setConversaId(null);
    perguntar.reset();
    campo.current?.focus();
  };

  const abrirConversa = async (id: string) => {
    const dados = await fetchJson<{
      mensagens: { role: string; content: string; evidence: unknown }[];
    }>(`/assistant/conversations/${id}`);
    setConversaId(id);
    setTurnos(
      dados.mensagens.map((m) => ({
        papel: m.role === "PERGUNTA" ? "PERGUNTA" : "RESPOSTA",
        texto: m.content,
        // O dossiê guardado é a citação, não o objeto inteiro: uma conversa
        // reaberta mostra as fontes daquele dia sem refazer as consultas.
        ...(m.role === "RESPOSTA" && m.evidence
          ? { resposta: { ...(m.evidence as object), texto: m.content } as Resposta }
          : {}),
      })),
    );
  };

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turnos, perguntar.isPending]);

  const ultima = [...turnos].reverse().find((t) => t.papel === "RESPOSTA")?.resposta;
  const vazia = turnos.length === 0;

  return (
    <Layout>
      <div className="flex flex-1 min-h-0">
        <Historico
          conversas={conversas.data ?? []}
          atual={conversaId}
          aoAbrir={abrirConversa}
          aoNova={novaConversa}
          aoMudar={() => void cliente.invalidateQueries({ queryKey: ["assistant-conversations"] })}
        />

        <main className="flex-1 flex flex-col min-w-0">
          <header className="border-b bg-card px-8 py-4 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                Assistente FreightCheck
              </h1>
              <p className="text-sm text-muted-foreground">
                Pergunte sobre parâmetros, alterações, impactos e o Book do Operador.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPainelTecnico((v) => !v)}
              title="Painel técnico"
              className={cn(
                "p-2 rounded-sm transition-colors",
                painelTecnico ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              <Terminal className="w-4 h-4" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-4xl mx-auto px-8 py-6 space-y-6">
              {vazia && <Abertura aoEscolher={enviar} />}

              {turnos.map((turno, i) => (
                <Mensagem key={i} turno={turno} />
              ))}

              {perguntar.isPending && <Trabalhando />}

              {perguntar.error && (
                <ApiErrorNotice
                  error={perguntar.error}
                  what="A pergunta não pôde ser respondida."
                />
              )}

              {painelTecnico && ultima && <PainelTecnico resposta={ultima} />}

              {!perguntar.isPending && ultima && ultima.sugestoes.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {ultima.sugestoes.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => enviar(s)}
                      className="text-xs border border-input rounded-full px-3 py-1.5 hover:border-brand hover:bg-muted/40 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              <div ref={fim} />
            </div>
          </div>

          <Composer
            valor={rascunho}
            onChange={setRascunho}
            onEnviar={() => enviar(rascunho)}
            ocupado={perguntar.isPending}
            campo={campo}
            aviso={
              capacidades.data && !capacidades.data.ia
                ? "Sem modelo de linguagem configurado neste ambiente — as respostas saem do mesmo material, redigidas em código."
                : null
            }
          />
        </main>
      </div>
    </Layout>
  );
}

// ── Abertura ────────────────────────────────────────────────────────────────

function Abertura({ aoEscolher }: { aoEscolher: (p: string) => void }) {
  return (
    <div className="py-10">
      <h2 className="text-xl font-semibold mb-1">Sobre o que você quer saber?</h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-xl">
        Pergunte com suas palavras. Não é preciso saber o nome técnico do parâmetro
        nem em que tela ele mora.
      </p>
      <div className="grid gap-2 sm:grid-cols-2 max-w-3xl">
        {SUGESTOES_INICIAIS.map((s) => (
          <button
            key={s.pergunta}
            type="button"
            onClick={() => aoEscolher(s.pergunta)}
            className="text-left border border-input rounded-sm px-4 py-3 hover:border-brand hover:bg-muted/30 transition-colors"
          >
            <span className="block text-[0.6875rem] uppercase tracking-wide text-muted-foreground mb-1">
              {s.categoria}
            </span>
            <span className="text-sm">{s.pergunta}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Indicador de processamento ──────────────────────────────────────────────

/**
 * As etapas que estão realmente rodando.
 *
 * O texto avança sozinho porque a resposta é uma requisição só — o servidor
 * devolve as etapas executadas junto com o resultado, e mostrá-las depois não
 * serviria de nada. O que se vê aqui é a sequência que a orquestração percorre,
 * no ritmo em que ela costuma percorrer.
 */
const PASSOS = [
  "Analisando sua pergunta",
  "Identificando o parâmetro",
  "Consultando o conhecimento do produto",
  "Consultando os dados",
  "Calculando impacto",
];

function Trabalhando() {
  const [passo, setPasso] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setPasso((p) => Math.min(p + 1, PASSOS.length - 1)), 900);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="w-4 h-4 animate-spin" />
      {PASSOS[passo]}…
    </div>
  );
}

// ── Composer ────────────────────────────────────────────────────────────────

function Composer({
  valor,
  onChange,
  onEnviar,
  ocupado,
  campo,
  aviso,
}: {
  valor: string;
  onChange: (v: string) => void;
  onEnviar: () => void;
  ocupado: boolean;
  campo: React.RefObject<HTMLTextAreaElement | null>;
  aviso: string | null;
}) {
  useEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [valor, campo]);

  return (
    <div className="border-t bg-card px-8 py-4">
      <div className="max-w-4xl mx-auto">
        <div className="relative border border-input rounded-lg focus-within:border-brand transition-colors">
          <textarea
            ref={campo}
            value={valor}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onEnviar();
              }
            }}
            rows={1}
            maxLength={1000}
            placeholder="Pergunte sobre o FreightCheck..."
            className="w-full resize-none bg-transparent py-3 pl-4 pr-14 text-[0.9375rem] outline-none max-h-[200px]"
          />
          <button
            type="button"
            onClick={onEnviar}
            disabled={ocupado || valor.trim().length === 0}
            aria-label="Enviar"
            className="absolute right-2 bottom-2 w-9 h-9 rounded-md bg-brand text-brand-foreground flex items-center justify-center hover:brightness-95 transition-[filter] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {ocupado ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowUp className="w-4 h-4" />
            )}
          </button>
        </div>
        <p className="text-[0.6875rem] text-muted-foreground mt-2">
          {aviso ?? "Enter envia · Shift+Enter quebra linha"}
        </p>
      </div>
    </div>
  );
}

// ── Histórico ───────────────────────────────────────────────────────────────

function agrupar(conversas: ConversaResumo[]): { titulo: string; itens: ConversaResumo[] }[] {
  const hoje = new Date();
  const ehMesmoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);

  const grupos = new Map<string, ConversaResumo[]>();
  for (const c of conversas) {
    const data = new Date(c.updatedAt);
    const chave = ehMesmoDia(data, hoje)
      ? "Hoje"
      : ehMesmoDia(data, ontem)
        ? "Ontem"
        : data.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
    grupos.set(chave, [...(grupos.get(chave) ?? []), c]);
  }
  return [...grupos].map(([titulo, itens]) => ({ titulo, itens }));
}

function Historico({
  conversas,
  atual,
  aoAbrir,
  aoNova,
  aoMudar,
}: {
  conversas: ConversaResumo[];
  atual: string | null;
  aoAbrir: (id: string) => void;
  aoNova: () => void;
  aoMudar: () => void;
}) {
  const [menuAberto, setMenuAberto] = useState<string | null>(null);

  const renomear = async (c: ConversaResumo) => {
    const titulo = window.prompt("Novo título da conversa", c.title);
    if (!titulo?.trim()) return;
    await fetch(getApiUrl(`/assistant/conversations/${c.id}`), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: titulo.trim() }),
    });
    setMenuAberto(null);
    aoMudar();
  };

  const arquivar = async (c: ConversaResumo) => {
    if (!window.confirm(`Arquivar "${c.title}"? A conversa sai da lista e nada é apagado.`)) return;
    await fetch(getApiUrl(`/assistant/conversations/${c.id}/archive`), { method: "POST" });
    setMenuAberto(null);
    aoMudar();
  };

  return (
    <aside className="w-64 border-r bg-card shrink-0 hidden lg:flex flex-col">
      <div className="p-3">
        <button
          type="button"
          onClick={aoNova}
          className="w-full flex items-center gap-2 text-sm border border-input rounded-sm px-3 py-2 hover:border-brand transition-colors"
        >
          <MessageSquarePlus className="w-4 h-4" />
          Nova conversa
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {conversas.length === 0 && (
          <p className="px-2 text-xs text-muted-foreground">Nenhuma conversa ainda.</p>
        )}
        {agrupar(conversas).map((grupo) => (
          <div key={grupo.titulo} className="mb-3">
            <p className="px-2 py-1 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
              {grupo.titulo}
            </p>
            {grupo.itens.map((c) => (
              <div key={c.id} className="relative group">
                <button
                  type="button"
                  onClick={() => aoAbrir(c.id)}
                  className={cn(
                    "w-full text-left text-sm rounded-sm px-2 py-1.5 pr-7 truncate transition-colors",
                    atual === c.id ? "bg-muted font-medium" : "hover:bg-muted/60",
                  )}
                >
                  {c.title}
                </button>
                <button
                  type="button"
                  onClick={() => setMenuAberto(menuAberto === c.id ? null : c.id)}
                  aria-label="Opções da conversa"
                  className="absolute right-1 top-1.5 p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
                {menuAberto === c.id && (
                  <div className="absolute right-1 top-8 z-10 bg-card border rounded-sm shadow-md text-xs w-32">
                    <button
                      type="button"
                      onClick={() => void renomear(c)}
                      className="block w-full text-left px-3 py-2 hover:bg-muted"
                    >
                      Renomear
                    </button>
                    <button
                      type="button"
                      onClick={() => void arquivar(c)}
                      className="block w-full text-left px-3 py-2 hover:bg-muted"
                    >
                      Arquivar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

// ── Painel técnico ──────────────────────────────────────────────────────────

/**
 * O que a orquestração decidiu — para quem desenvolve, não para quem lê.
 *
 * Aqui vive o que saiu da tela: a intenção classificada, o que foi herdado da
 * conversa, as ferramentas chamadas, e quem redigiu o texto. Fica atrás de um
 * botão porque é diagnóstico, e diagnóstico exibido o tempo todo vira ruído
 * para quem só queria a resposta.
 */
function PainelTecnico({ resposta }: { resposta: Resposta }) {
  const t = resposta.tecnico;
  return (
    <div className="border border-input rounded-sm p-3 text-xs font-mono space-y-1 bg-muted/30">
      <p>
        <span className="text-muted-foreground">intenção:</span> {t.intencao}{" "}
        <span className="text-muted-foreground">({t.porque})</span>
      </p>
      <p>
        <span className="text-muted-foreground">herdado:</span>{" "}
        {t.herdado.length > 0 ? t.herdado.join(", ") : "—"}
      </p>
      <p>
        <span className="text-muted-foreground">ferramentas:</span>{" "}
        {t.ferramentas.length > 0 ? t.ferramentas.join(", ") : "—"}
      </p>
      <p>
        <span className="text-muted-foreground">redação:</span> {resposta.redacao}
        {resposta.modelo ? ` · ${resposta.modelo}` : ""}
      </p>
      {t.numerosRecusados.length > 0 && (
        <p className="text-destructive">
          números sem lastro recusados: {t.numerosRecusados.join(", ")}
        </p>
      )}
    </div>
  );
}
