import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * A marca, num lugar só.
 *
 * Ela aparece em dois fundos — a faixa marinho do topo e do login, e o branco
 * da coluna estreita do login — e é por isso que este componente existe em vez
 * de duas cópias: o símbolo é o mesmo nos dois, e só a metade branca do nome
 * troca de cor. Duas cópias divergiam na primeira vez que o símbolo mudasse.
 *
 * **O símbolo é desenhado aqui, e não carregado como arquivo.** Ele tem trinta
 * e poucos números e nenhum detalhe que um `.svg` externo resolveria melhor —
 * e, inline, ele herda o `currentColor` do texto quando precisa e some junto
 * com a faixa quando o tema muda. Um arquivo custaria uma requisição e um
 * cache para desenhar a mesma coisa.
 *
 * O que o desenho diz, e por que ele é assim: o anel é a auditoria que fecha o
 * ciclo, o "certo" é a conferência, e o traço longo dele não para no anel — sai
 * pela abertura e vira seta. É a leitura do produto em uma figura: conferir não
 * é só carimbar o que veio; é apurar para onde o número está indo.
 */
export function Logotipo({
  tom = "claro",
  className,
}: {
  /** `claro` = nome branco sobre a faixa marinho. `escuro` = nome marinho sobre o branco. */
  tom?: "claro" | "escuro";
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2.5 shrink-0", className)}>
      <Simbolo />
      <span className="text-2xl leading-none tracking-tight whitespace-nowrap">
        <span
          className={cn(
            "font-extrabold italic",
            tom === "claro" ? "text-white" : "text-topbar",
          )}
        >
          Freight
        </span>
        {/*
          "Check" não é itálico e não é negrito, e é a única parte colorida.
          As três diferenças ao mesmo tempo é o que faz o nome se ler como duas
          palavras coladas em vez de uma só — à distância em que o peso sozinho
          já não se distingue, a cor ainda se distingue.
        */}
        <span className="font-normal text-topbar-accent">Check</span>
      </span>
    </span>
  );
}

/**
 * O anel, o "certo" e a seta.
 *
 * Os três são um traço só de 4,2 de espessura com ponta arredondada, e o
 * `viewBox` de 40 é o que dá folga para a seta sair do anel sem encostar na
 * borda da caixa. A abertura do anel vai de -58° a +18°; o traço longo do
 * "certo" o cruza a -34°, dentro dela. Mexer num dos dois sem o outro põe a
 * seta atravessando o anel em vez de passando pela abertura.
 *
 * **O `id` do gradiente vem do `useId`, e não é uma constante.** `url(#id)` é
 * resolvido no documento inteiro, não dentro do `<svg>` que o escreve: com um
 * `id` fixo, a segunda marca da página aponta para o `<defs>` da primeira. No
 * login isso apagava o símbolo — as duas versões convivem no DOM, uma delas sob
 * `display:none`, e a visível herdava o gradiente da escondida.
 */
function Simbolo() {
  const gradiente = `fc-marca-${useId()}`;

  return (
    <svg
      viewBox="0 0 40 40"
      className="w-9 h-9 shrink-0"
      fill="none"
      role="img"
      aria-label="FreightCheck"
    >
      <defs>
        <linearGradient id={gradiente} gradientUnits="userSpaceOnUse" x1="5" y1="34" x2="35" y2="6">
          <stop offset="0" stopColor="#2563EB" />
          <stop offset="1" stopColor="#4DA3FF" />
        </linearGradient>
      </defs>

      {/* O anel, aberto no alto à direita para a seta passar. */}
      <path
        d="M 24.9 10.0 A 13 13 0 1 0 30.4 25.0"
        stroke={`url(#${gradiente})`}
        strokeWidth="4.2"
        strokeLinecap="round"
      />

      {/* O "certo", cujo traço longo não para no anel. */}
      <path
        d="M 10.0 21.2 L 16.4 27.6 L 30.8 11.9"
        stroke={`url(#${gradiente})`}
        strokeWidth="4.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* A ponta da seta, já fora do anel. */}
      <path d="M 35.5 6.0 L 33.8 14.5 L 27.2 8.7 Z" fill={`url(#${gradiente})`} />
    </svg>
  );
}
