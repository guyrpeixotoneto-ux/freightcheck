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
}

export function Markdown({ texto }: Props) {
  const blocos = texto.split(/\n{2,}/);

  return (
    <div className="space-y-3 text-[0.9375rem] leading-relaxed">
      {blocos.map((bloco, i) => (
        <Bloco key={i} texto={bloco} />
      ))}
    </div>
  );
}

function Bloco({ texto }: { texto: string }) {
  const linhas = texto.split("\n").filter((l) => l.trim().length > 0);
  if (linhas.length === 0) return null;

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

/** Negrito, itálico e código, nesta ordem de precedência. */
function Inline({ texto }: { texto: string }) {
  const partes = texto.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);
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
        if (parte.startsWith("*") && parte.endsWith("*") && parte.length > 2) {
          return <em key={i}>{parte.slice(1, -1)}</em>;
        }
        return <span key={i}>{parte}</span>;
      })}
    </>
  );
}
