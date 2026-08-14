import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import {
  ArrowRight,
  BookOpen,
  CornerDownLeft,
  Database,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchJson, getApiUrl, readJson } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Assistente de IA — perguntar em português e receber resposta com lastro.
 *
 * **O que esta tela promete.** Toda resposta vem acompanhada do material que a
 * sustenta: os artigos do conhecimento do produto, com o arquivo onde cada um
 * pode ser conferido, e os números consultados no banco, com a origem de cada
 * consulta e o recorte em que ela rodou. Nada aparece no texto sem aparecer
 * também ao lado dele.
 *
 * É por isso que as fontes não ficam escondidas atrás de um "ver detalhes". Um
 * assistente cuja fonte custa um clique é um assistente cuja fonte ninguém
 * abre — e a promessa de rastreabilidade vira decoração. Aqui o texto e o
 * lastro chegam juntos, na mesma tela, sem interação nenhuma.
 *
 * **A tela diz quem escreveu.** Com modelo de linguagem configurado, ele redige
 * sobre o material recuperado. Sem modelo, a redação é montada em código do
 * mesmo material. O selo no topo da resposta diz qual dos dois foi, porque quem
 * lê merece saber se um modelo participou do texto que está lendo.
 *
 * **O recorte acompanha.** Se a pessoa chegou aqui de Parâmetros com uma
 * unidade, um canal e uma vigência na URL, a pergunta vai com eles. "Quanto
 * mudou" precisa saber mudou *onde* — responder pelo contexto mais recente do
 * banco daria um número certo sobre a operação errada.
 */

interface Fato {
  rotulo: string;
  valor: string;
  detalhe?: string;
}

interface BlocoDeDado {
  titulo: string;
  fatos: Fato[];
  nota?: string;
  origem: string;
  tela?: { label: string; href: string };
}

interface FonteDeConhecimento {
  id: string;
  titulo: string;
  area: string;
  fonte: string;
}

interface Resposta {
  pergunta: string;
  texto: string;
  redacao: "IA" | "DETERMINISTICA";
  modelo: string | null;
  conhecimento: FonteDeConhecimento[];
  dados: BlocoDeDado[];
  telas: { label: string; href: string }[];
  semResposta: boolean;
}

interface Capacidades {
  ia: boolean;
  modelo: string | null;
  artigos: number;
  areas: string[];
}

interface Sugestoes {
  sugestoes: { pergunta: string; area: string }[];
  indice: FonteDeConhecimento[];
}

const AREA_LABEL: Record<string, string> = {
  PARAMETROS: "Parâmetros",
  BOOK: "Book do Operador",
  CONCEITO: "Conceito",
  LEITURA: "Como ler",
  NAVEGACAO: "Navegação",
  RECUSA: "Limites",
};

export default function Assistente() {
  const search = useSearch();
  const [pergunta, setPergunta] = useState("");
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  /**
   * O recorte vem da URL, do mesmo jeito que em Parâmetros.
   *
   * Chegar aqui por um link de dentro de um cartão preserva a unidade, o canal e
   * a vigência que a pessoa estava olhando. Sem isso, "quanto mudou" trocaria de
   * assunto no meio do caminho.
   */
  const recorte = useMemo(() => {
    const params = new URLSearchParams(search);
    return {
      scopeHash: params.get("scopeHash") ?? undefined,
      canal: params.get("canal") ?? undefined,
      period: params.get("period") ?? undefined,
    };
  }, [search]);

  const temRecorte = Boolean(recorte.scopeHash || recorte.canal || recorte.period);

  const capacidades = useQuery({
    queryKey: ["assistant-capabilities"],
    queryFn: () => fetchJson<Capacidades>("/assistant/capabilities"),
  });

  const sugestoes = useQuery({
    queryKey: ["assistant-suggestions"],
    queryFn: () => fetchJson<Sugestoes>("/assistant/suggestions"),
  });

  const perguntar = useMutation({
    mutationFn: async (texto: string) => {
      const response = await fetch(getApiUrl("/assistant/ask"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pergunta: texto, ...recorte }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(
          typeof body.error === "string"
            ? body.error
            : `O servidor respondeu ${response.status}.`,
        );
      }
      return body as unknown as Resposta;
    },
    onSuccess: (dados) => setResposta(dados),
  });

  const enviar = (texto: string) => {
    const limpa = texto.trim();
    if (!limpa || perguntar.isPending) return;
    setPergunta(limpa);
    perguntar.mutate(limpa);
  };

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-primary" />
          Assistente de IA
        </h1>
        <p className="text-muted-foreground mt-1 max-w-3xl">
          Pergunte em português sobre o FreightCheck — principalmente sobre
          Parâmetros e Book do Operador. Toda resposta vem com o que a sustenta:
          o conhecimento registrado sobre o produto e as consultas feitas ao
          banco, com a origem de cada número.
        </p>
      </header>

      <div className="p-8 space-y-6">
        <ModoDeResposta capacidades={capacidades.data} />

        {temRecorte && (
          <p className="text-xs text-muted-foreground border-l-2 border-brand pl-3">
            Perguntas sobre números serão respondidas dentro do recorte que veio
            junto no link
            {recorte.canal && <> — canal <strong>{recorte.canal}</strong></>}
            {recorte.period && <> — vigência <strong>{recorte.period}</strong></>}.
          </p>
        )}

        <Card>
          <CardContent className="pt-6">
            <label htmlFor="pergunta" className="sr-only">
              Sua pergunta
            </label>
            <textarea
              id="pergunta"
              ref={campo}
              value={pergunta}
              onChange={(evento) => setPergunta(evento.target.value)}
              onKeyDown={(evento) => {
                // Enter envia; Shift+Enter quebra linha. Perguntas aqui são de
                // uma ou duas frases, e exigir um clique no botão em toda uma
                // delas é atrito sem contrapartida.
                if (evento.key === "Enter" && !evento.shiftKey) {
                  evento.preventDefault();
                  enviar(pergunta);
                }
              }}
              rows={3}
              maxLength={1000}
              placeholder="Ex.: por que a cobertura da apuração está em 0%?"
              className="w-full resize-none rounded-sm border border-input p-3 text-sm outline-none focus:border-brand"
            />
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <CornerDownLeft className="w-3 h-3" />
                Enter envia · Shift+Enter quebra linha
              </span>
              <button
                type="button"
                onClick={() => enviar(pergunta)}
                disabled={perguntar.isPending || pergunta.trim().length === 0}
                className="bg-brand text-brand-foreground text-[0.8125rem] font-bold uppercase tracking-wide px-6 py-2.5 rounded-sm hover:brightness-95 transition-[filter] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                {perguntar.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Perguntar
              </button>
            </div>
          </CardContent>
        </Card>

        {perguntar.error && (
          <ApiErrorNotice
            error={perguntar.error}
            what="A pergunta não pôde ser respondida."
          />
        )}

        {!resposta && !perguntar.isPending && (
          <Perguntas
            sugestoes={sugestoes.data?.sugestoes ?? []}
            aoEscolher={(texto) => {
              setPergunta(texto);
              enviar(texto);
              campo.current?.focus();
            }}
          />
        )}

        {resposta && <RespostaCompleta resposta={resposta} />}

        {resposta && (
          <Perguntas
            titulo="Outras perguntas"
            sugestoes={sugestoes.data?.sugestoes ?? []}
            aoEscolher={(texto) => {
              setPergunta(texto);
              enviar(texto);
            }}
          />
        )}
      </div>
    </Layout>
  );
}

/** O selo que diz quem redige as respostas neste ambiente. */
function ModoDeResposta({ capacidades }: { capacidades?: Capacidades }) {
  if (!capacidades) return null;

  return (
    <div
      className={cn(
        "border-l-4 bg-card p-4 text-sm",
        capacidades.ia ? "border-brand" : "border-muted-foreground/40",
      )}
    >
      {capacidades.ia ? (
        <p>
          <strong>Redação por modelo de linguagem.</strong> As respostas são
          escritas por <code className="text-xs">{capacidades.modelo}</code>{" "}
          <em>sobre o material recuperado</em> — os {capacidades.artigos} artigos
          do conhecimento do produto e as consultas ao banco. O modelo é
          instruído a não acrescentar nenhum número que não esteja nesse
          material, e o material vai junto na tela para conferência.
        </p>
      ) : (
        <p>
          <strong>Redação montada em código.</strong> Não há modelo de linguagem
          configurado neste ambiente, e o assistente continua respondendo: o
          material é o mesmo — os {capacidades.artigos} artigos do conhecimento
          do produto e as consultas ao banco —, e só a redação muda. Um modelo
          configurado reescreveria estas respostas na forma da pergunta; ele não
          acrescentaria conhecimento nenhum.
        </p>
      )}
    </div>
  );
}

function Perguntas({
  titulo = "Comece por aqui",
  sugestoes,
  aoEscolher,
}: {
  titulo?: string;
  sugestoes: { pergunta: string; area: string }[];
  aoEscolher: (pergunta: string) => void;
}) {
  if (sugestoes.length === 0) return null;

  return (
    <section>
      <h2 className="text-[0.8125rem] font-bold uppercase tracking-wide text-muted-foreground mb-3">
        {titulo}
      </h2>
      <div className="flex flex-wrap gap-2">
        {sugestoes.map((s) => (
          <button
            key={s.pergunta}
            type="button"
            onClick={() => aoEscolher(s.pergunta)}
            className="text-left text-sm border border-input rounded-sm px-3 py-2 hover:border-brand hover:bg-muted/40 transition-colors"
          >
            {s.pergunta}
            <span className="ml-2 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
              {AREA_LABEL[s.area] ?? s.area}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function RespostaCompleta({ resposta }: { resposta: Resposta }) {
  return (
    <section className="space-y-6">
      <Card className={cn(resposta.semResposta && "border-muted-foreground/40")}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 flex-wrap">
            <span className="text-muted-foreground font-normal">
              {resposta.pergunta}
            </span>
            <Badge
              variant="outline"
              className="text-[0.6875rem] uppercase tracking-wide"
            >
              {resposta.redacao === "IA"
                ? `redigido por ${resposta.modelo}`
                : "redação em código"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Texto conteudo={resposta.texto} />
        </CardContent>
      </Card>

      {resposta.dados.length > 0 && (
        <section>
          <h2 className="text-[0.8125rem] font-bold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
            <Database className="w-4 h-4" />
            Consultado no banco agora
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {resposta.dados.map((bloco) => (
              <Card key={bloco.titulo} className="border-l-4 border-l-brand">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{bloco.titulo}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {bloco.fatos.map((fato) => (
                    <div key={fato.rotulo} className="text-sm">
                      <span className="text-muted-foreground">{fato.rotulo}: </span>
                      <span className="font-semibold">{fato.valor}</span>
                      {fato.detalhe && (
                        <span className="block text-xs text-muted-foreground">
                          {fato.detalhe}
                        </span>
                      )}
                    </div>
                  ))}
                  {bloco.nota && (
                    <p className="text-xs text-muted-foreground border-t pt-2">
                      {bloco.nota}
                    </p>
                  )}
                  <p className="text-[0.6875rem] text-muted-foreground font-mono border-t pt-2">
                    {bloco.origem}
                  </p>
                  {bloco.tela && (
                    <Link
                      href={bloco.tela.href}
                      className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                    >
                      conferir em {bloco.tela.label}
                      <ArrowRight className="w-3 h-3" />
                    </Link>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {resposta.conhecimento.length > 0 && (
        <section>
          <h2 className="text-[0.8125rem] font-bold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
            <BookOpen className="w-4 h-4" />
            Conhecimento que sustenta a resposta
          </h2>
          <ul className="space-y-2">
            {resposta.conhecimento.map((fonte) => (
              <li key={fonte.id} className="text-sm border-l-2 border-input pl-3">
                <span className="font-semibold">{fonte.titulo}</span>
                <Badge
                  variant="outline"
                  className="ml-2 text-[0.6875rem] uppercase tracking-wide"
                >
                  {AREA_LABEL[fonte.area] ?? fonte.area}
                </Badge>
                <span className="block text-[0.6875rem] text-muted-foreground font-mono">
                  {fonte.fonte}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {resposta.telas.length > 0 && (
        <section className="flex flex-wrap gap-3">
          {resposta.telas.map((tela) => (
            <Link
              key={tela.href}
              href={tela.href}
              className="text-sm border border-input rounded-sm px-3 py-2 hover:border-brand transition-colors inline-flex items-center gap-2"
            >
              Abrir {tela.label}
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          ))}
        </section>
      )}
    </section>
  );
}

/**
 * O pouco de formatação que as respostas usam — e só ele.
 *
 * Parágrafos, listas com `- ` e negrito com `**`. Não é um renderizador de
 * markdown e não deve virar um: o texto é montado por este produto ou escrito
 * por um modelo sob instrução dele, e ampliar o que a tela aceita renderizar
 * amplia o que uma resposta consegue fazer aparecer aqui. Tudo entra como
 * texto — nada é injetado como HTML.
 */
function Texto({ conteudo }: { conteudo: string }) {
  const blocos = conteudo.split(/\n{2,}/);

  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocos.map((bloco, indice) => {
        const linhas = bloco.split("\n");
        const eLista = linhas.every((linha) => linha.trim().startsWith("- "));

        if (eLista) {
          return (
            <ul key={indice} className="list-disc pl-5 space-y-1">
              {linhas.map((linha, i) => (
                <li key={i}>
                  <Negrito texto={linha.trim().slice(2)} />
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={indice}>
            {linhas.map((linha, i) => (
              <span key={i}>
                {i > 0 && <br />}
                <Negrito texto={linha} />
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function Negrito({ texto }: { texto: string }) {
  const partes = texto.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {partes.map((parte, i) =>
        parte.startsWith("**") && parte.endsWith("**") ? (
          <strong key={i}>{parte.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{parte}</span>
        ),
      )}
    </>
  );
}
