import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
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
import { SeletorDeRecorte, type RecorteEscolhido } from "@/components/assistente/recorte";
import type {
  Capacidades,
  ConversaResumo,
  Etapa,
  Resposta,
  Turno,
} from "@/components/assistente/tipos";
import { erroDaResposta, fetchJson, getApiUrl, readJson } from "@/lib/api";
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
  const [, navegar] = useLocation();
  const cliente = useQueryClient();

  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [painelTecnico, setPainelTecnico] = useState(false);
  /** As etapas que já rodaram nesta pergunta — vindas do servidor, não do relógio. */
  const [etapas, setEtapas] = useState<Etapa[]>([]);
  /**
   * O texto que está chegando enquanto o modelo escreve.
   *
   * Só entra aqui o que o servidor já conferiu contra as evidências — a trava
   * de lastro roda por frase, antes do envio, de modo que nada sem lastro chega
   * a ser exibido. Quando a resposta fecha, este texto dá lugar ao da resposta
   * final: se a conferência da resposta inteira descartar a redação do modelo,
   * o que estava sendo lido é substituído pela redação em código.
   */
  const [emCurso, setEmCurso] = useState("");

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

  /*
    Trocar o recorte reescreve a URL, e é só isso que ele faz.

    O estado do recorte não é `useState`: ele é o endereço. Assim a escolha
    sobrevive a um F5, volta pelo botão de voltar, e vai junto quando alguém
    manda o link — que é a mesma regra das outras telas deste produto. E é o
    que permite ao atalho da barra lateral carregar a unidade de onde a pessoa
    estava, sem nenhum estado global.
  */
  const trocarRecorte = (novo: RecorteEscolhido) => {
    const p = new URLSearchParams();
    if (novo.scopeHash) p.set("scopeHash", novo.scopeHash);
    if (novo.canal) p.set("canal", novo.canal);
    if (novo.period) p.set("period", novo.period);
    const qs = p.toString();
    navegar(qs ? `/assistente?${qs}` : "/assistente");
  };

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
      setEtapas([]);
      setEmCurso("");
      const resposta = await fetch(getApiUrl("/assistant/ask"), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({
          pergunta,
          ...(conversaId ? { conversationId: conversaId } : {}),
          ...recorte,
        }),
      });

      if (!resposta.ok) {
        throw erroDaResposta(resposta, await readJson(resposta));
      }

      /*
        Sem `text/event-stream` o servidor devolve o JSON de sempre — um proxy
        que não repasse o cabeçalho não quebra a tela, só a deixa sem passos.
      */
      if (!resposta.headers.get("content-type")?.includes("text/event-stream")) {
        return (await readJson(resposta)) as unknown as Resposta;
      }
      return lerEventos(
        resposta,
        (etapa) => setEtapas((as) => [...as, etapa]),
        (pedaco) => setEmCurso((texto) => texto + pedaco),
      );
    },
    onSuccess: (r) => {
      setConversaId(r.conversationId);
      setEtapas([]);
      setEmCurso("");
      setTurnos((atuais) => [
        ...atuais,
        {
          papel: "RESPOSTA",
          texto: r.texto,
          resposta: r,
          ...(r.messageId ? { mensagemId: r.messageId } : {}),
          conversaId: r.conversationId,
        },
      ]);
      void cliente.invalidateQueries({ queryKey: ["assistant-conversations"] });
    },
    onError: () => {
      // O texto parcial não sobrevive à falha: ele era a resposta que não veio,
      // e deixá-lo na tela ao lado do aviso de erro sugeriria o contrário.
      setEmCurso("");
      setEtapas([]);
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
      mensagens: { id: string; role: string; content: string; evidence: unknown }[];
    }>(`/assistant/conversations/${id}`);
    setConversaId(id);
    setTurnos(
      dados.mensagens.map((m) => ({
        papel: m.role === "PERGUNTA" ? "PERGUNTA" : "RESPOSTA",
        mensagemId: m.id,
        conversaId: id,
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
  }, [turnos, perguntar.isPending, emCurso]);

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
            <div className="flex items-center gap-3">
              <SeletorDeRecorte recorte={recorte} aoTrocar={trocarRecorte} />
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
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-4xl mx-auto px-8 py-6 space-y-6">
              {/*
                A saudação é escrita aqui dentro, e por isso ela não prova nada
                sobre o servidor.

                `Abertura` e as quatro sugestões iniciais são constantes deste
                arquivo: a tela abre igual com a API de pé e com a API fora. As
                duas chamadas que **poderiam** denunciar a diferença —
                capacidades e a lista de conversas — falhavam em silêncio, uma
                caindo em `?? []` e a outra num `&&` que só olha `data`. O
                resultado é o pior estado de diagnóstico possível: tudo parece
                normal até alguém perguntar, e aí a única falha visível é a da
                pergunta — que manda procurar o defeito no Assistente quando ele
                está na camada que serve `/api`.

                Mostrar isto aqui não é enfeite: é a diferença entre "o
                Assistente falhou" e "esta tela não está falando com o
                servidor", que apontam para lugares opostos.
              */}
              {capacidades.error && (
                <ApiErrorNotice
                  error={capacidades.error}
                  what="Esta tela não está conseguindo falar com o servidor."
                />
              )}

              {vazia && <Abertura aoEscolher={enviar} />}

              {turnos.map((turno, i) => (
                <Mensagem key={i} turno={turno} />
              ))}

              {/*
                Enquanto não há texto, o que se mostra são as etapas; quando o
                primeiro pedaço chega, elas saem de cena e a resposta começa a
                aparecer. As duas coisas juntas seriam ruído: ninguém lê "o que
                está sendo consultado" enquanto lê a resposta da consulta.
              */}
              {perguntar.isPending &&
                (emCurso ? (
                  <Mensagem turno={{ papel: "RESPOSTA", texto: emCurso }} />
                ) : (
                  <Trabalhando etapas={etapas} />
                ))}

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
 * Lê o stream e devolve a resposta do último evento.
 *
 * O servidor emite `etapa` a cada passo da orquestração, `texto` a cada pedaço
 * de resposta já conferido, e `resposta` no fim. Um `erro` no meio vira exceção
 * aqui, porque num stream o cabeçalho já saiu como 200 e não há status para
 * trocar.
 *
 * O texto do evento final é a versão que vale — não a soma dos pedaços. Quando
 * a conferência da resposta inteira descarta a redação do modelo, os dois
 * diferem, e é o final que a tela adota.
 */
async function lerEventos(
  resposta: Response,
  aoAvancar: (etapa: Etapa) => void,
  aoTexto: (pedaco: string) => void,
): Promise<Resposta> {
  const leitor = resposta.body?.getReader();
  if (!leitor) throw new Error("O servidor não devolveu corpo.");

  const decodificador = new TextDecoder();
  let sobra = "";
  let final: Resposta | null = null;

  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    sobra += decodificador.decode(value, { stream: true });

    // Um evento SSE termina em linha em branco; o resto fica para a próxima volta.
    const blocos = sobra.split("\n\n");
    sobra = blocos.pop() ?? "";

    for (const bloco of blocos) {
      const nome = /^event: (.+)$/m.exec(bloco)?.[1];
      const dados = /^data: (.+)$/m.exec(bloco)?.[1];
      if (!nome || !dados) continue;
      const carga = JSON.parse(dados);
      if (nome === "etapa") aoAvancar(carga as Etapa);
      else if (nome === "texto") aoTexto(String(carga.pedaco ?? ""));
      else if (nome === "resposta") final = carga as Resposta;
      else if (nome === "erro") throw new Error(String(carga.error ?? "Falha no servidor."));
    }
  }

  if (!final) throw new Error("O servidor fechou a conexão sem responder.");
  return final;
}

/**
 * O que está acontecendo — e só o que está mesmo acontecendo.
 *
 * A versão anterior animava uma lista fixa por tempo: anunciava "calculando
 * impacto" numa pergunta conceitual que nunca calcula impacto. Cada linha aqui
 * chegou do servidor no instante em que a etapa começou. Enquanto o primeiro
 * evento não chega, o texto é neutro — não há o que afirmar ainda.
 *
 * Só a etapa corrente fica em destaque; as anteriores encolhem para o lado,
 * porque o que importa é onde está, não a lista do que já passou.
 */
function Trabalhando({ etapas }: { etapas: Etapa[] }) {
  const corrente = etapas[etapas.length - 1];
  const anteriores = etapas.slice(0, -1);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
        {corrente ? `${corrente.rotulo}…` : "Trabalhando…"}
      </div>
      {anteriores.length > 0 && (
        <p className="pl-6 text-xs text-muted-foreground/70">
          {anteriores.map((e) => e.rotulo).join(" · ")}
        </p>
      )}
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
/**
 * O desfecho da chamada, em português — e o que ele manda fazer.
 *
 * São as cinco saídas de `llm.ts`, e cada frase diz o que aconteceu com o
 * texto, não como o código chama o caso.
 */
const MOTIVO_DA_REDACAO: Record<
  NonNullable<Resposta["tecnico"]["ia"]>["desfecho"],
  string
> = {
  IA: "escreveu esta resposta",
  PODADA: "escreveu, e a trava de lastro tirou uma frase sem lastro",
  DESCARTADA: "escreveu, e a trava de lastro descartou o texto",
  RECUSA: "recusou a pergunta",
  ERRO: "não respondeu — a chamada falhou",
  SEM_CHAVE: "não foi chamado — não há chave configurada",
};

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
      {/*
        O plano inteiro, e não só a necessidade que deu nome.

        Desde que a classificação virou plano, uma pergunta pode precisar de
        duas coisas — e ver só a primeira esconde exatamente a decisão que
        passou a ser possível.
      */}
      <p>
        <span className="text-muted-foreground">plano:</span>{" "}
        {t.rastro.necessidades.join(" + ")}
      </p>
      <p>
        <span className="text-muted-foreground">assunto:</span>{" "}
        {t.rastro.assunto
          ? `${t.rastro.assunto}${t.rastro.comoReconheceu ? ` (${t.rastro.comoReconheceu.toLowerCase().replace(/_/g, " ")})` : ""}`
          : "nenhum reconhecido"}
      </p>
      <p>
        <span className="text-muted-foreground">ferramentas:</span>{" "}
        {t.ferramentas.length > 0 ? t.ferramentas.join(", ") : "—"}
      </p>
      {/*
        A trajetória do agente — o que separa investigar de consultar muito.

        Rodadas e consultas são contagens diferentes de propósito: seis rodadas
        com seis consultas é uma investigação funda e estreita; duas rodadas com
        onze é uma varredura larga e rasa. `derivaDe` é a coluna que decide: uma
        consulta cujo argumento saiu do resultado de outra é uma decisão tomada
        **depois** de ver o dado.
      */}
      {t.agente && (
        <div className="border-t border-input/60 pt-1 mt-1 space-y-0.5">
          <p>
            <span className="text-muted-foreground">agente:</span> {t.agente.rodadas} rodada(s) ·{" "}
            {t.agente.consultas} consulta(s) ·{" "}
            {t.agente.chamadas.filter((c) => c.derivaDe !== null).length} encadeada(s) · parou:{" "}
            {t.agente.parou}
          </p>
          {t.agente.chamadas.map((c, i) => (
            <p key={i} className="pl-3 text-muted-foreground">
              <span className="text-foreground">#{i + 1}</span> {c.nome}
              {Object.keys(c.argumentos).length > 0 ? ` ${JSON.stringify(c.argumentos)}` : ""}
              {c.derivaDe !== null ? ` ← #${c.derivaDe + 1}` : ""}
              {c.ok ? "" : ` · falhou: ${c.erro ?? "sem motivo"}`}
            </p>
          ))}
        </div>
      )}
      {/*
        Quantos candidatos havia e quantos passaram — a pergunta que se faz
        quando a resposta trouxe o documento errado, ou nenhum.
      */}
      <p>
        <span className="text-muted-foreground">Book:</span>{" "}
        {t.rastro.book.candidatos} candidatos · {t.rastro.book.selecionados} acima do limiar
        {t.rastro.book.candidatos > 0
          ? ` · melhor ${t.rastro.book.melhorPontuacao.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`
          : ""}
      </p>
      <p>
        <span className="text-muted-foreground">cérebro:</span>{" "}
        {t.agente ? "AGENTE" : "PLANEJADOR"}
      </p>
      <p>
        <span className="text-muted-foreground">redação:</span> {resposta.redacao}
        {resposta.modelo ? ` · ${resposta.modelo}` : ""}
      </p>
      {/*
        Por que a redação foi essa.

        "DETERMINISTICA" sozinho dizia a mesma palavra para três situações
        opostas: não há chave, o modelo respondeu e a trava descartou, a
        chamada falhou. A primeira se resolve na configuração, a segunda no
        dossiê, a terceira esperando a API voltar — e quem olhava a tela não
        tinha como saber em qual delas estava.
      */}
      {/*
        E o caso que continuava invisível: quando **não houve chamada**.

        Este bloco dependia de `t.ia`, que é nulo justamente aí — então a tela
        ficava muda nas duas situações mais comuns de uma resposta em código.
        `t.motor` existe em toda resposta e diz qual das cinco causas foi.
      */}
      <p className={t.motor.redigiu === "IA" ? undefined : "text-destructive"}>
        <span className="text-muted-foreground">modelo:</span>{" "}
        {t.ia ? MOTIVO_DA_REDACAO[t.ia.desfecho] : t.motor.causa}
        {t.ia
          ? ` · ${t.ia.modelo} · ${(t.ia.latenciaMs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s` +
            ` · ${(t.ia.tokensEntrada + t.ia.tokensSaida).toLocaleString("pt-BR")} tokens`
          : ""}
        {t.ia?.erro ? ` · ${t.ia.erro}` : ""}
      </p>
      {/*
        Com que material o modelo trabalhou.

        É a pergunta que separa "o modelo respondeu mal" de "o dossiê chegou
        magro", e as duas se consertam em lugares opostos. Sem esta linha, a
        primeira hipótese é a única visível — e é a errada na maioria das vezes.
      */}
      <p>
        <span className="text-muted-foreground">material:</span>{" "}
        {t.contexto.itens.total} fonte(s) · {t.contexto.fatos} fato(s) ·{" "}
        {t.contexto.caracteres.dossie.toLocaleString("pt-BR")} caracteres
        {t.contexto.turnos > 0 ? ` · ${t.contexto.turnos} turno(s) de histórico` : ""}
      </p>
      {t.numerosRecusados.length > 0 && (
        <p className="text-destructive">
          o que a trava recusou: {t.numerosRecusados.join(", ")}
          {t.rastro.frasesPodadas > 0
            ? ` · ${t.rastro.frasesPodadas} de ${t.rastro.frasesTotais} frases removidas`
            : ""}
        </p>
      )}
      {/*
        Onde o tempo foi.

        Cada etapa com o instante em que começou, e o total da orquestração
        separado da chamada ao modelo — que são as duas metades de uma resposta
        lenta, e pedem correções diferentes.
      */}
      <p>
        <span className="text-muted-foreground">tempo:</span>{" "}
        {t.rastro.orquestracaoMs} ms de orquestração
        {t.ia ? ` + ${t.ia.latenciaMs} ms de modelo` : ""}
      </p>
      <p className="text-muted-foreground break-all">
        {t.rastro.etapas.map((e) => `${e.nome}@${e.ms}`).join(" → ")}
      </p>
    </div>
  );
}
