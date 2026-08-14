import { createContext, useContext } from "react";

/**
 * O pouco de markdown que as respostas usam — e só ele.
 *
 * Parágrafos, listas, tabelas, negrito e código. Não é um renderizador de
 * markdown e não deve virar um: o texto é montado por este produto ou escrito
 * por um modelo sob instrução dele, e ampliar o que a tela aceita renderizar
 * amplia o que uma resposta consegue fazer aparecer aqui. Tudo entra como
 * texto — nada é injetado como HTML.
 *
 * A tabela existe porque comparação entre vigências realmente pede colunas. Ela
 * não é o formato padrão de nada: quando o modelo devolve prosa, a prosa fica.
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
  const blocos = texto.split(/\n{2,}/);

  return (
    <Citar.Provider value={aoCitar}>
      <div className="space-y-3 text-[0.9375rem] leading-relaxed">
        {blocos.map((bloco, i) => (
          <Bloco key={i} texto={bloco} />
        ))}
      </div>
    </Citar.Provider>
  );
}

function Bloco({ texto }: { texto: string }) {
  const linhas = texto.split("\n").filter((l) => l.trim().length > 0);
  if (linhas.length === 0) return null;

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
