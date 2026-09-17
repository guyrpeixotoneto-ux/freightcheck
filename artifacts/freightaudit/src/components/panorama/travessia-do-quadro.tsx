import { ChevronRight, Users } from "lucide-react";
import { Link } from "wouter";
import type { LinhaDaTravessia } from "@/lib/travessia-do-quadro";

/**
 * A faixa de travessia para o quadro de pessoal — o rodapé da tela.
 *
 * Ela responde a uma pergunta que o Panorama não pode responder por dentro: *e o
 * pessoal?* O porquê de ser uma travessia, e não linhas do ranking do "onde
 * aconteceu", está em `lib/travessia-do-quadro.ts` — QLP é outra família de
 * dados, com vigência própria e consolidação entre unidades.
 *
 * O desenho carrega essa recusa na cara:
 *
 * - **faixa, e não cartão.** Os cartões desta tela publicam a competência lida;
 *   um cartão aqui poria o QLP no mesmo plano deles;
 * - **a vigência do quadro vem antes do número**, sempre, e é a dele — não a da
 *   tela. É a única forma de uma contagem de outra competência aparecer aqui sem
 *   ser lida como desta;
 * - **nenhuma soma.** Nada nesta faixa entra em total nenhum da tela, e nenhum
 *   número dela é comparável aos de cima.
 *
 * Sem quadro importado a faixa não existe — a página não a monta. Não há aqui
 * um estado de "nenhum QLP": um convite para um módulo vazio é pior que
 * silêncio, e Importações é quem diz o que falta importar.
 */
export function TravessiaDoQuadro({ linhas }: { linhas: LinhaDaTravessia[] }) {
  if (linhas.length === 0) return null;

  return (
    <section
      className="rounded-xl border bg-muted/30 px-5 py-4"
      aria-label="O quadro de pessoal desta unidade"
    >
      <p className="flex items-center gap-2 text-xs font-bold">
        <Users className="w-4 h-4 shrink-0 text-brand" />
        Esta operação também tem quadro de pessoal
      </p>
      <p className="text-xs text-muted-foreground mt-1 leading-snug">
        Outra família de dados, com vigência própria e consolidada entre unidades — os números
        abaixo não entram em nada acima.
      </p>

      <ul className="mt-3 flex flex-col gap-1.5">
        {linhas.map((linha) => (
          <li key={linha.quadro}>
            <Link
              href={linha.href}
              className="group flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 -mx-2 py-1.5 text-xs hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand transition-colors"
            >
              <span className="font-bold">{linha.rotulo}</span>
              {/*
                A vigência do quadro, em pastilha e antes do número. Ela é a
                ressalva que deixa a contagem honesta nesta tela, e por isso não
                é uma nota de rodapé da faixa: está colada no número que ela
                qualifica.
              */}
              <span className="rounded bg-card border px-1.5 py-0.5 font-semibold tabular-nums">
                {linha.vigencia}
              </span>
              {linha.contagem && (
                <span className="text-muted-foreground tabular-nums">{linha.contagem}</span>
              )}
              {linha.ressalva && <span className="text-muted-foreground">{linha.ressalva}</span>}
              <span className="ml-auto flex items-center gap-1 font-bold text-brand shrink-0">
                abrir
                <ChevronRight className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 transition-opacity" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
