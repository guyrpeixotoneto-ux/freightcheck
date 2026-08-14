import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, BookOpen, ChevronDown, Database, FileText, Info } from "lucide-react";
import { Markdown } from "./markdown";
import { cn } from "@/lib/utils";
import type { Fonte, Lacuna, Resposta, Turno } from "./tipos";

/**
 * Uma linha da conversa.
 *
 * **A resposta é o principal; a fonte é secundária.** A versão anterior desta
 * tela dava a cartões de dado quase toda a altura, e o texto que respondia a
 * pergunta ficava espremido acima deles. Aqui as fontes vivem atrás de um
 * "Fontes · 3" que abre quando alguém quiser conferir — a promessa de
 * rastreabilidade continua inteira e para de disputar espaço com a leitura.
 *
 * **A pergunta e a resposta se distinguem pela forma, não por avatar.** A
 * pergunta é um bloco recuado com fundo; a resposta ocupa a largura de leitura.
 * Quem rola a conversa reconhece de quem é cada bloco sem precisar de rótulo.
 */

export function Mensagem({ turno }: { turno: Turno }) {
  if (turno.papel === "PERGUNTA") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-muted rounded-sm px-4 py-2.5 text-[0.9375rem]">
          {turno.texto}
        </div>
      </div>
    );
  }

  return <RespostaDoAssistente resposta={turno.resposta} texto={turno.texto} />;
}

function RespostaDoAssistente({
  resposta,
  texto,
}: {
  resposta?: Resposta;
  texto: string;
}) {
  return (
    <div className="max-w-[46rem] space-y-3">
      {resposta?.recorte && (
        <p className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
          {resposta.recorte}
        </p>
      )}

      <Markdown texto={texto} />

      <Lacunas lacunas={resposta?.lacunas ?? []} texto={texto} />

      {resposta && resposta.fontes.length > 0 && <Fontes fontes={resposta.fontes} />}
    </div>
  );
}

/**
 * O que o assistente não sabe — dito uma vez.
 *
 * A lacuna é obrigatória na resposta, e quem redige já a escreve no texto: a
 * redação em código a acrescenta, e o modelo é instruído a declará-la. Este
 * bloco existe para o caso em que ela **não** entrou na prosa, e por isso
 * confere antes de repetir. Sem a conferência, "nenhuma coluna da gaveta
 * Combustível trata de preço" aparecia duas vezes na mesma resposta, uma logo
 * abaixo da outra — e uma ressalva repetida lê-se como duas ressalvas.
 */
function Lacunas({ lacunas, texto }: { lacunas: Lacuna[]; texto: string }) {
  const normalizar = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const naProsa = normalizar(texto);

  const ausentes = lacunas.filter((l) => {
    // Um trecho longo o bastante para não casar por acaso, curto o bastante
    // para sobreviver a o modelo reescrever o resto da frase.
    const marca = normalizar(l.explicacao).slice(0, 60);
    return marca.length > 0 && !naProsa.includes(marca);
  });

  if (ausentes.length === 0) return null;

  return (
    <div className="space-y-2">
      {ausentes.map((l, i) => (
        <p
          key={i}
          className="text-[0.8125rem] text-muted-foreground border-l-2 border-input pl-3"
        >
          {l.explicacao}
        </p>
      ))}
    </div>
  );
}

const ICONE: Record<Fonte["tipo"], typeof BookOpen> = {
  BOOK: BookOpen,
  CATALOGO: FileText,
  ARTIGO: Info,
  DADO: Database,
};

const NOME: Record<Fonte["tipo"], string> = {
  BOOK: "Book do Operador",
  CATALOGO: "Catálogo Freightech",
  ARTIGO: "FreightCheck",
  DADO: "Banco FreightCheck",
};

function Fontes({ fontes }: { fontes: Fonte[] }) {
  const [aberto, setAberto] = useState(false);

  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", aberto && "rotate-180")} />
        Fontes · {fontes.length}
      </button>

      {aberto && (
        <ul className="mt-2 space-y-2 border-l-2 border-input pl-3">
          {fontes.map((f) => {
            const Icone = ICONE[f.tipo];
            return (
              <li key={f.id} className="text-xs">
                <div className="flex items-start gap-2">
                  <Icone className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <span className="font-semibold">{f.titulo}</span>
                    <span className="text-muted-foreground"> · {NOME[f.tipo]}</span>
                    {f.detalhe && (
                      <span className="block text-muted-foreground">{f.detalhe}</span>
                    )}
                    <span className="block font-mono text-[0.6875rem] text-muted-foreground">
                      {f.origem}
                    </span>
                    {f.tela && (
                      <Link
                        href={f.tela.href}
                        className="inline-flex items-center gap-1 text-primary hover:underline mt-0.5"
                      >
                        abrir {f.tela.label}
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
