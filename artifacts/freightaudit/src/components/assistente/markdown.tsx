import { createContext, useContext, useState } from "react";
import { segmentar } from "./segmentos";
import { Check, CircleDashed, Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * O pouco de markdown que as respostas usam — e só ele.
 *
 * Parágrafos, listas, tabelas, negrito, código, e quatro blocos que o texto
 * corrido não dá conta: régua, destaque, cartões e abas. Não é um renderizador
 * de markdown e não deve virar um: o texto é montado por este produto ou
 * escrito por um modelo sob instrução dele, e ampliar o que a tela aceita
 * renderizar amplia o que uma resposta consegue fazer aparecer aqui. Tudo entra
 * como texto — nada é injetado como HTML.
 *
 * **Por que quatro blocos a mais, e não uma resposta em JSON.** O texto continua
 * sendo a resposta: é ele que sai em fluxo enquanto o modelo escreve, é sobre
 * ele que a trava de lastro confere número e citação, e é ele que fica gravado
 * na conversa. Uma resposta estruturada em objeto obrigaria a refazer as três
 * coisas para ganhar layout. O que estes blocos fazem é dar ao modelo um
 * vocabulário de forma — "isto aqui é um destaque", "isto é o par temos/falta",
 * "isto tem uma variante por iniciativa" — mantendo tudo como texto.
 *
 * **Bloco desconhecido nunca vira lixo na tela.** Uma cerca que a tela não
 * reconhece é renderizada como o conteúdo dela, sem os marcadores: o pior caso
 * de um modelo inventando sintaxe é perder a moldura, nunca mostrar `:::algo`
 * para quem perguntou.
 */

interface Props {
  texto: string;
  /** Chamado quando alguém clica numa citação `[n]`. */
  aoCitar?: (n: number) => void;
}

/**
 * De onde saiu cada frase — sem tirar a frase do caminho.
 *
 * O contexto leva o `aoCitar` até o `Inline`, no fundo da árvore, porque a
 * citação aparece dentro de parágrafo, de item de lista e de célula de tabela.
 * Passá-lo por prop em cada um desses saltos encheria três componentes de um
 * argumento que nenhum deles usa.
 */
const Citar = createContext<((n: number) => void) | undefined>(undefined);

export function Markdown({ texto, aoCitar }: Props) {
  const segmentos = segmentar(texto);

  return (
    <Citar.Provider value={aoCitar}>
      <div className="space-y-3 text-[0.9375rem] leading-relaxed">
        {segmentos.map((segmento, i) =>
          segmento.tipo === "cerca" ? (
            <Cerca key={i} nome={segmento.nome} corpo={segmento.corpo} />
          ) : (
            <Corrido key={i} texto={segmento.corpo} />
          ),
        )}
      </div>
    </Citar.Provider>
  );
}

function Corrido({ texto }: { texto: string }) {
  return (
    <div className="space-y-3">
      {texto.split(/\n{2,}/).map((bloco, i) => (
        <Bloco key={i} texto={bloco} />
      ))}
    </div>
  );
}

/**
 * As duas cercas que a tela conhece: `cards` e `abas`.
 *
 * Ambas se organizam por `###` — cada título abre um cartão ou uma aba. É a
 * mesma marcação de sempre dentro de uma moldura, e não uma linguagem nova: um
 * modelo que erre a cerca acerta o conteúdo, e o conteúdo é o que importa.
 */
function Cerca({ nome, corpo }: { nome: string; corpo: string }) {
  const partes = corpo
    .split(/^###\s+/m)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [titulo, ...resto] = p.split("\n");
      return { titulo: titulo.trim(), corpo: resto.join("\n").trim() };
    });

  if (partes.length === 0) return <Corrido texto={corpo} />;
  if (nome === "abas") return <Abas partes={partes} />;
  if (nome === "cards" || nome === "cartoes") return <Cartoes partes={partes} />;
  return <Corrido texto={corpo} />;
}

/**
 * O par "o que temos / o que falta", e qualquer outro par que a resposta peça.
 *
 * O ícone é escolhido pelo título, não declarado pelo modelo: um cartão que
 * fala de falta ou pendência ganha o círculo aberto; os outros, o visto. É uma
 * heurística de aparência — errar nela troca um ícone, nunca o conteúdo — e ela
 * poupa o modelo de decorar mais uma marcação.
 */
function Cartoes({ partes }: { partes: { titulo: string; corpo: string }[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {partes.map((parte, i) => {
        const pendente = /falta|pendente|ausente|não temos|nao temos/i.test(parte.titulo);
        const Icone = pendente ? CircleDashed : Check;
        return (
          <div key={i} className="border border-input rounded-sm p-4 space-y-2">
            <div className="flex items-center gap-2 font-semibold">
              <Icone
                className={cn("w-4 h-4 shrink-0", pendente ? "text-muted-foreground" : "text-brand")}
              />
              <Inline texto={parte.titulo} />
            </div>
            <Corrido texto={parte.corpo} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Uma regra com variantes — iniciativa de abastecimento, canal, tipo de
 * equipamento.
 *
 * Existe porque a alternativa é pior de ler: quatro seções seguidas dizendo
 * "no modelo A…", "no modelo B…" fazem quem procura a sua variante rolar por
 * três que não interessam. A primeira aba abre selecionada, e todas continuam
 * presentes no texto — quem copia a resposta leva as quatro.
 */
function Abas({ partes }: { partes: { titulo: string; corpo: string }[] }) {
  const [atual, setAtual] = useState(0);
  const escolhida = partes[Math.min(atual, partes.length - 1)];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {partes.map((parte, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setAtual(i)}
            className={cn(
              "px-3 py-1.5 rounded-sm border text-[0.8125rem] transition-colors",
              i === atual
                ? "bg-brand text-brand-foreground border-brand font-medium"
                : "border-input hover:bg-muted",
            )}
          >
            {parte.titulo}
          </button>
        ))}
      </div>
      <div className="border-l-2 border-brand bg-muted/40 rounded-sm px-4 py-3">
        <Corrido texto={escolhida.corpo} />
      </div>
    </div>
  );
}

function Bloco({ texto }: { texto: string }) {
  const linhas = texto.split("\n").filter((l) => l.trim().length > 0);
  if (linhas.length === 0) return null;

  /*
    ---- régua ----------------------------------------------------------------

    Separa seções de uma resposta longa sem gastar um título. Numa resposta
    curta ela não aparece, porque não há o que separar.
  */
  if (/^\s*(---|___|\*\*\*)\s*$/.test(texto)) {
    return <hr className="border-input" />;
  }

  /*
    ---- destaque -------------------------------------------------------------

    A regra que decide, tirada do corrido. `> [!info]` pinta a caixa de
    informação; `>` sozinho é o destaque discreto, com a barra à esquerda — o
    "na prática:" que fecha uma explicação.

    O destaque não é enfeite: numa resposta sobre como um preço é apurado, a
    frase que diz qual dos dois vale é a que a pessoa veio buscar, e ela se
    perde no meio de três parágrafos com a mesma tipografia.
  */
  if (linhas.every((l) => /^\s*>/.test(l))) {
    const cru = linhas.map((l) => l.replace(/^\s*>\s?/, "")).join("\n");
    const marcado = /^\[!(info|nota|atencao|atenção)\]\s*/i.exec(cru);
    const conteudo = marcado ? cru.slice(marcado[0].length) : cru;

    if (marcado) {
      return (
        <div className="flex gap-3 rounded-sm bg-muted/60 px-4 py-3">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-brand" />
          <div className="space-y-2">
            <Corrido texto={conteudo} />
          </div>
        </div>
      );
    }

    return (
      <div className="border-l-2 border-brand pl-4 space-y-2">
        <Corrido texto={conteudo} />
      </div>
    );
  }

  /*
    ---- título ---------------------------------------------------------------

    O conteúdo do Book chega com a hierarquia do documento — "Frequência",
    "Critérios" — e uma resposta longa às vezes precisa de um mapa. Sem esta
    ramificação a tela imprimia os sustenidos literalmente, que é a marca de um
    renderizador que não conhece o texto que recebe.

    Dois níveis apenas, e nenhum deles compete com o título da página: o que
    chega aqui é seção de resposta, não capítulo.
  */
  const titulo = /^(#{1,6})\s+(.*)$/.exec(linhas[0]);
  if (titulo && linhas.length === 1) {
    const nivel = titulo[1].length;
    return nivel <= 2 ? (
      <h3 className="text-[1.0625rem] font-semibold leading-snug pt-1">
        <Inline texto={titulo[2]} />
      </h3>
    ) : (
      <h4 className="text-[0.9375rem] font-semibold leading-snug">
        <Inline texto={titulo[2]} />
      </h4>
    );
  }

  // ---- tabela ---------------------------------------------------------------
  const ehTabela =
    linhas.length >= 2 &&
    linhas[0].trim().startsWith("|") &&
    /^\s*\|[\s:|-]+\|\s*$/.test(linhas[1]);

  if (ehTabela) {
    const celulas = (linha: string) =>
      linha.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const cabecalho = celulas(linhas[0]);
    const corpo = linhas.slice(2).map(celulas);

    return (
      <div className="overflow-x-auto border border-input rounded-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
              {cabecalho.map((c, i) => (
                <th key={i} className="text-left px-3 py-2 font-medium whitespace-nowrap">
                  <Inline texto={c} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {corpo.map((linha, i) => (
              <tr key={i} className="border-b last:border-0">
                {linha.map((c, j) => (
                  <td
                    key={j}
                    className={
                      // Coluna de número alinha à direita e tabula: é o que
                      // permite comparar duas linhas de olho.
                      /^[+\-−]?[R$\s]*[\d.,]+%?$/.test(c)
                        ? "px-3 py-2 text-right tabular-nums whitespace-nowrap"
                        : "px-3 py-2"
                    }
                  >
                    <Inline texto={c} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ---- lista ----------------------------------------------------------------
  if (linhas.every((l) => /^\s*[-*]\s+/.test(l))) {
    return (
      <ul className="space-y-1 pl-1">
        {linhas.map((l, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-brand shrink-0 leading-relaxed">·</span>
            <span>
              <Inline texto={l.replace(/^\s*[-*]\s+/, "")} />
            </span>
          </li>
        ))}
      </ul>
    );
  }

  if (linhas.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
    return (
      <ol className="space-y-1 pl-5 list-decimal">
        {linhas.map((l, i) => (
          <li key={i}>
            <Inline texto={l.replace(/^\s*\d+[.)]\s+/, "")} />
          </li>
        ))}
      </ol>
    );
  }

  // ---- parágrafo -------------------------------------------------------------
  return (
    <p>
      {linhas.map((l, i) => (
        <span key={i}>
          {i > 0 && <br />}
          <Inline texto={l} />
        </span>
      ))}
    </p>
  );
}

/** Negrito, itálico, código e citação, nesta ordem de precedência. */
function Inline({ texto }: { texto: string }) {
  const aoCitar = useContext(Citar);
  const partes = texto.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[\d{1,2}\])/g);
  return (
    <>
      {partes.map((parte, i) => {
        if (parte.startsWith("**") && parte.endsWith("**")) {
          return <strong key={i}>{parte.slice(2, -2)}</strong>;
        }
        if (parte.startsWith("`") && parte.endsWith("`")) {
          return (
            <code key={i} className="text-[0.85em] bg-muted px-1 py-0.5 rounded-sm">
              {parte.slice(1, -1)}
            </code>
          );
        }
        if (/^\[\d{1,2}\]$/.test(parte)) {
          const n = Number(parte.slice(1, -1));
          return <Citacao key={i} n={n} aoCitar={aoCitar} />;
        }
        if (parte.startsWith("*") && parte.endsWith("*") && parte.length > 2) {
          return <em key={i}>{parte.slice(1, -1)}</em>;
        }
        return <span key={i}>{parte}</span>;
      })}
    </>
  );
}

/**
 * O número que leva à fonte.
 *
 * Discreto de propósito: sobrescrito, do tamanho de um índice, sem cor de link.
 * A promessa dele é poder conferir, não chamar atenção — uma citação que
 * disputa a leitura com a frase que ela sustenta atrapalha as duas.
 */
function Citacao({ n, aoCitar }: { n: number; aoCitar?: (n: number) => void }) {
  if (!aoCitar) {
    return <sup className="text-[0.7em] text-muted-foreground ml-0.5">{n}</sup>;
  }
  return (
    <button
      type="button"
      onClick={() => aoCitar(n)}
      aria-label={`Ver a fonte ${n}`}
      className="align-super text-[0.7em] text-muted-foreground ml-0.5 px-1 rounded-sm hover:bg-muted hover:text-foreground transition-colors"
    >
      {n}
    </button>
  );
}
