import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  CircleDollarSign,
  Fuel,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Send,
  Sparkles,
  Terminal,
  TrendingUp,
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

/**
 * As quatro perguntas de abertura.
 *
 * Cada uma nomeia uma **categoria de pergunta**, não um atalho de tela: quem
 * abre o Assistente pela primeira vez não sabe o que ele responde, e a lista
 * existe para dizer isso. A frase de apoio descreve o que a resposta traz —
 * sem ela o cartão é só a pergunta repetida em corpo maior.
 */
const SUGESTOES_INICIAIS = [
  {
    categoria: "Entender um parâmetro",
    pergunta: "Como funciona o preço de combustível?",
    descricao: "Entenda como o parâmetro é calculado e quais fatores o influenciam.",
    icone: Fuel,
    tom: "bg-blue-50 text-blue-600",
  },
  {
    categoria: "Analisar alterações",
    pergunta: "O que mais mudou na última vigência?",
    descricao: "Veja as principais alterações e seus impactos na última vigência.",
    icone: TrendingUp,
    tom: "bg-emerald-50 text-emerald-600",
  },
  {
    categoria: "Impacto financeiro",
    pergunta: "Onde tivemos maior perda?",
    descricao: "Identifique os principais pontos de perda e seus impactos financeiros.",
    icone: CircleDollarSign,
    tom: "bg-rose-50 text-rose-600",
  },
  {
    categoria: "Book do Operador",
    pergunta: "O que o Book diz sobre IPVA?",
    descricao: "Consulte como o IPVA é tratado no Book do Operador.",
    icone: BookOpen,
    tom: "bg-violet-50 text-violet-600",
  },
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

        <main className="flex-1 flex flex-col min-w-0 bg-background">
          <header className="border-b bg-card px-8 py-5 flex items-start justify-between gap-6">
            <div className="flex items-start gap-3 min-w-0">
              <Sparkles className="w-7 h-7 text-brand shrink-0 mt-0.5" aria-hidden />
              <div className="min-w-0">
                <h1 className="text-2xl font-bold tracking-tight">Assistente FreightCheck</h1>
                <p className="text-sm text-muted-foreground max-w-md">
                  Pergunte sobre parâmetros, alterações, impactos e o Book do Operador.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 shrink-0">
              <SeletorDeRecorte recorte={recorte} aoTrocar={trocarRecorte} />
              <button
                type="button"
                onClick={() => setPainelTecnico((v) => !v)}
                title="Painel técnico"
                className={cn(
                  "p-2.5 rounded-lg border border-input transition-colors",
                  painelTecnico
                    ? "bg-muted text-foreground"
                    : "bg-card text-muted-foreground hover:bg-muted",
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
    <div className="py-8">
      <div className="flex items-center gap-6 mb-10">
        <div className="w-24 h-24 shrink-0 rounded-3xl bg-gradient-to-br from-topbar-accent to-brand flex items-center justify-center text-white">
          <MessageSquare className="w-10 h-10" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 className="text-3xl font-bold tracking-tight mb-2">
            Como posso te ajudar hoje?
          </h2>
          <p className="text-[0.9375rem] text-muted-foreground max-w-xl">
            Faça perguntas em linguagem natural sobre parâmetros, alterações, impactos
            financeiros e o Book do Operador.
          </p>
        </div>
      </div>

      <h3 className="text-base font-semibold mb-4">Perguntas frequentes</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {SUGESTOES_INICIAIS.map((s) => {
          const Icone = s.icone;
          return (
            <button
              key={s.pergunta}
              type="button"
              onClick={() => aoEscolher(s.pergunta)}
              className="group text-left bg-card border border-card-border rounded-xl p-5 flex items-start gap-4 hover:border-brand hover:shadow-sm transition-[border-color,box-shadow]"
            >
              <span
                className={cn(
                  "w-12 h-12 shrink-0 rounded-full flex items-center justify-center",
                  s.tom,
                )}
              >
                <Icone className="w-5 h-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.6875rem] uppercase tracking-wide font-semibold text-brand mb-1.5">
                  {s.categoria}
                </span>
                <span className="block text-[0.9375rem] font-semibold leading-snug mb-1.5">
                  {s.pergunta}
                </span>
                <span className="block text-[0.8125rem] text-muted-foreground leading-snug">
                  {s.descricao}
                </span>
              </span>
              <ArrowRight
                className="w-4 h-4 shrink-0 self-center text-muted-foreground group-hover:text-brand transition-colors"
                aria-hidden
              />
            </button>
          );
        })}
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
    <div className="px-8 pb-6 pt-2">
      <div className="max-w-4xl mx-auto">
        <div className="bg-card border border-input rounded-xl px-4 pt-3 pb-3 focus-within:border-brand transition-colors">
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
            placeholder="Digite sua pergunta aqui..."
            className="w-full resize-none bg-transparent text-[0.9375rem] outline-none max-h-[200px] placeholder:text-muted-foreground"
          />
          <div className="flex items-end justify-between gap-3 pt-2">
            <p className="text-[0.6875rem] text-muted-foreground">
              {aviso ?? "Enter envia · Shift+Enter quebra linha"}
            </p>
            <button
              type="button"
              onClick={onEnviar}
              disabled={ocupado || valor.trim().length === 0}
              aria-label="Enviar"
              className="w-10 h-10 shrink-0 rounded-lg bg-brand text-brand-foreground flex items-center justify-center hover:brightness-95 transition-[filter] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {ocupado ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
        {/*
          O aviso que a tela deve a quem lê a resposta.

          Ele não é rodapé decorativo: as respostas saem de um modelo, e dizer
          isso onde a pergunta é feita é a mesma honestidade que o resto da tela
          pratica ao mostrar recorte e fontes.
        */}
        <p className="text-[0.6875rem] text-muted-foreground text-center mt-3">
          As respostas podem conter imprecisões. Sempre valide as informações importantes.
        </p>
      </div>
    </div>
  );
}

// ── Histórico ───────────────────────────────────────────────────────────────

/**
 * A data de cada conversa, dita na própria linha dela.
 *
 * **Por que ela saiu do cabeçalho de grupo.** Agrupar por dia dava um título
 * para cada data, e numa lista em que quase toda conversa é de um dia diferente
 * o título repetia a linha seguinte — metade da barra virava cabeçalho. Aqui a
 * data acompanha o item, que é onde ela é lida: "esta conversa é de quando".
 * "Hoje" e "Ontem" continuam por extenso porque são as duas datas que ninguém
 * calcula de cabeça.
 */
export function rotuloDaData(iso: string, agora: Date = new Date()): string {
  const data = new Date(iso);
  const ehMesmoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const ontem = new Date(agora);
  ontem.setDate(agora.getDate() - 1);

  if (ehMesmoDia(data, agora)) return "Hoje";
  if (ehMesmoDia(data, ontem)) return "Ontem";
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
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
    <aside className="w-72 border-r bg-card shrink-0 hidden lg:flex flex-col">
      <div className="p-4">
        <button
          type="button"
          onClick={aoNova}
          className="w-full flex items-center justify-center gap-2 text-sm font-semibold bg-brand text-brand-foreground rounded-lg px-3 py-3 hover:brightness-95 transition-[filter]"
        >
          <Plus className="w-4 h-4" />
          Nova conversa
        </button>
      </div>

      <p className="px-4 pb-2 text-sm font-semibold">Conversas recentes</p>

      <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-1">
        {conversas.length === 0 && (
          <p className="px-1 text-xs text-muted-foreground">Nenhuma conversa ainda.</p>
        )}
        {conversas.map((c) => (
          <div key={c.id} className="relative group">
            <button
              type="button"
              onClick={() => aoAbrir(c.id)}
              className={cn(
                "w-full text-left rounded-lg px-3 py-2.5 pr-8 flex items-start gap-2.5 transition-colors",
                atual === c.id ? "bg-muted" : "hover:bg-muted/60",
              )}
            >
              <MessageSquare
                className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground"
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[0.625rem] uppercase tracking-wide font-semibold text-brand">
                  {rotuloDaData(c.updatedAt)}
                </span>
                <span
                  className={cn(
                    "block text-[0.8125rem] leading-snug line-clamp-2",
                    atual === c.id && "font-medium",
                  )}
                >
                  {c.title}
                </span>
              </span>
            </button>
            {/*
              A seta e o "…" ocupam o mesmo canto: a seta diz para onde o item
              leva, e some no instante em que o cursor traz o menu — duas
              affordances no mesmo pixel seriam duas miras para o mesmo clique.
            */}
            <ChevronRight
              className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none group-hover:opacity-0 transition-opacity"
              aria-hidden
            />
            <button
              type="button"
              onClick={() => setMenuAberto(menuAberto === c.id ? null : c.id)}
              aria-label="Opções da conversa"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-sm text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-muted transition-opacity"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {menuAberto === c.id && (
              <div className="absolute right-1 top-full z-10 bg-card border rounded-sm shadow-md text-xs w-32">
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
            {t.agente.encadeamentosReais} encadeada(s) · {t.agente.preplanejadas} pré-planejada(s) ·
            parou: {t.agente.parou}
          </p>
          {/*
            O porquê de cada encadeamento — e nunca o raciocínio do modelo.

            A linha diz que valor apareceu no resultado de qual consulta e em
            que argumento ele entrou. É o que aconteceu com os argumentos, lido
            do log; não é o que o modelo pensou, e não há como confundir os dois
            porque o log é a única fonte.
          */}
          {t.agente.porqueEncadeou.map((linha, i) => (
            <p key={`enc-${i}`} className="pl-3 text-muted-foreground">
              ↳ {linha}
            </p>
          ))}
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
        A descida do caminho determinístico.

        Ela responde a mesma pergunta que `agente.chamadas` responde no canário
        — a orquestração reagiu ao dado, ou executou um plano fechado? — para
        quem está no caminho em que o produto de fato roda hoje. Cada linha
        nomeia o valor que **não existia** antes da consulta anterior.
      */}
      {t.descida.length > 0 && (
        <div className="border-t border-input/60 pt-1 mt-1 space-y-0.5">
          <p>
            <span className="text-muted-foreground">descida:</span>{" "}
            {t.descida.filter((d) => d.derivaDe !== null).length} encadeamento(s) em{" "}
            {t.descida.length} passo(s)
          </p>
          {t.descida.map((d, i) => (
            <p key={`desc-${i}`} className="pl-3 text-muted-foreground">
              <span className="text-foreground">#{i + 1}</span> {d.ferramenta}
              {d.derivaDe !== null ? ` ← #${d.derivaDe + 1}` : ""} · {d.porque}
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
