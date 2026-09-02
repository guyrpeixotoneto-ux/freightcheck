import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import type { ItemDaFila } from "@/lib/panorama";
import type { Tom } from "@/lib/visao-geral";

/*
  A mesma paleta de `OndeAgirAgora` e do placar. Ver a nota em `placar.tsx`:
  duas escalas de cor para a mesma severidade fariam dois andares da mesma tela
  discordarem sobre a gravidade do mesmo fato.
*/
const TOM: Record<Tom, string> = {
  grave: "text-red-700 bg-red-50",
  atencao: "text-amber-700 bg-amber-50",
  ok: "text-emerald-700 bg-emerald-50",
};

/**
 * Andar 6 — a fila. *"O que eu faço agora?"*
 *
 * **O maior ganho da consolidação**, e o defeito de diagnóstico mais difícil
 * que a seção tinha: "Onde agir agora" (Impacto Apurado), "O que merece sua
 * atenção" (Resumo executivo) e "Principais alterações" (Impacto Líquido) liam
 * a mesma `FamiliesView` e ordenavam por critérios ligeiramente diferentes.
 * Quem lia os três módulos recebia três respostas para *por onde começo*, sem
 * nenhuma pista de qual seguir.
 *
 * A fusão e o critério moram em `filaDoPanorama` — aqui só se desenha o
 * veredito dela. É a mesma separação do resto do módulo, e ela é o que permite
 * testar a ordem da fila sem montar tela nenhuma.
 *
 * **Toda linha tem um destino, ou diz por que não tem.** Um item que não abre
 * nada é um item que a pessoa aprende a ignorar; e na Visão Geral, onde as
 * telas de destino recortam por unidade, o botão some em vez de apontar para a
 * lista de **uma** unidade debaixo de um número que somou todas.
 */
export function Fila({ itens, nota }: { itens: ItemDaFila[]; nota?: string }) {
  return (
    <section
      className="bg-card border rounded-xl shadow-sm px-6 py-5"
      aria-label="O que fazer agora"
    >
      <h2 className="text-base font-bold">O que fazer agora</h2>
      <p className="text-xs text-muted-foreground mt-0.5">
        Em ordem de consequência — o que é grave antes do que é atenção
      </p>

      {nota && <p className="text-sm text-muted-foreground mt-4">{nota}</p>}

      {!nota && itens.length === 0 && (
        /*
          A fila vazia é uma resposta, e uma boa: toda alteração tem preço, a
          cobertura está na régua e nenhuma perda foi marcada como crítica.
          Dita uma vez, numa frase — e não como um item verde na lista, que era
          o que `pontosDeAtencao` fazia e o que faz uma fila de trabalho deixar
          de ser lida.
        */
        <p className="text-sm text-muted-foreground py-10 text-center">
          Nada nesta vigência exige ação: toda alteração tem preço apurado, a cobertura está na
          régua e nenhuma perda foi marcada como crítica.
        </p>
      )}

      {!nota && itens.length > 0 && (
        <ol className="mt-4 space-y-2.5">
          {itens.map((item, indice) => (
            <li key={item.chave}>
              <Linha item={item} posicao={indice + 1} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Linha({ item, posicao }: { item: ItemDaFila; posicao: number }) {
  const corpo = (
    <>
      <span
        className={cn(
          "shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold tabular-nums",
          TOM[item.tom],
        )}
      >
        {posicao}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-snug">{item.titulo}</span>
        <span className="block text-xs text-muted-foreground mt-0.5 leading-snug">
          {item.detalhe}
        </span>
      </span>
      {item.href !== null && (
        <ArrowRight className="w-4 h-4 shrink-0 text-muted-foreground mt-1" />
      )}
    </>
  );

  const classes = "flex items-start gap-3 rounded-lg border px-4 py-3 w-full text-left";

  if (item.href === null) {
    return <div className={classes}>{corpo}</div>;
  }

  return (
    <Link href={item.href} className={cn(classes, "hover:border-brand transition-colors")}>
      {corpo}
    </Link>
  );
}
