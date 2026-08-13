import { useMemo, useState } from "react";
import { ChevronsUpDown, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A tabela que o Freightech abre ao clicar num cartão.
 *
 * O desenho é o de lá, porque é o que a mão já sabe operar: cabeçalho bege em
 * caixa alta, os dois ícones de coluna à direita do rótulo, filetes verticais
 * separando, linhas brancas centradas.
 *
 * **Os dois ícones não são enfeite, e não fazem a mesma coisa.** No Freightech
 * o primeiro ordena e o segundo abre o menu da coluna. Aqui o primeiro ordena —
 * clicar no cabeçalho inteiro também — e o segundo abre o filtro de texto
 * daquela coluna. Copiar os ícones sem ligar nada atrás seria o pior dos dois
 * mundos: a familiaridade convida ao clique e o clique não responde.
 *
 * A ordenação é estável e entende número: `12` vem depois de `9`, e não antes,
 * como viria numa comparação de texto. Numa tabela de valores essa diferença é
 * a distância entre ordenar por preço e ordenar pelo primeiro dígito.
 */

export interface ColunaTabela<L> {
  /** O rótulo como o Freightech escreve, inclusive grudado. */
  titulo: string;
  /** O que a célula mostra. */
  celula: (linha: L) => React.ReactNode;
  /** O que ordena e o que o filtro procura. Sem isto a coluna não ordena. */
  valor?: (linha: L) => string | number | null;
  alinhar?: "left" | "center" | "right";
  /** Largura sugerida, quando a coluna precisa de mais ou de menos. */
  largura?: string;
}

export function TabelaFreightech<L>({
  colunas,
  linhas,
  chave,
  aoClicar,
  vazio,
}: {
  colunas: ColunaTabela<L>[];
  linhas: L[];
  chave: (linha: L) => string;
  /** Quando existe, a linha inteira vira clicável. */
  aoClicar?: (linha: L) => void;
  /** O que dizer quando não há linha nenhuma. */
  vazio: React.ReactNode;
}) {
  const [ordem, setOrdem] = useState<{ coluna: number; desc: boolean } | null>(null);
  const [filtros, setFiltros] = useState<Record<number, string>>({});
  const [filtroAberto, setFiltroAberto] = useState<number | null>(null);

  const visiveis = useMemo(() => {
    let resultado = linhas;

    for (const [indice, termo] of Object.entries(filtros)) {
      const coluna = colunas[Number(indice)];
      const alvo = termo.trim().toLowerCase();
      if (!alvo || !coluna?.valor) continue;
      resultado = resultado.filter((linha) =>
        String(coluna.valor?.(linha) ?? "")
          .toLowerCase()
          .includes(alvo),
      );
    }

    if (ordem) {
      const coluna = colunas[ordem.coluna];
      if (coluna?.valor) {
        resultado = [...resultado].sort((a, b) => {
          const x = coluna.valor?.(a);
          const y = coluna.valor?.(b);
          // Vazio sempre por último, nas duas direções: quem ordena por valor
          // está procurando o maior ou o menor, não a ausência de valor.
          if (x === null || x === undefined) return 1;
          if (y === null || y === undefined) return -1;
          const comparacao =
            typeof x === "number" && typeof y === "number"
              ? x - y
              : String(x).localeCompare(String(y), "pt-BR", { numeric: true });
          return ordem.desc ? -comparacao : comparacao;
        });
      }
    }

    return resultado;
  }, [linhas, colunas, ordem, filtros]);

  return (
    <div className="overflow-x-auto border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-brand/25">
            {colunas.map((coluna, indice) => {
              const ordenavel = Boolean(coluna.valor);
              const ativa = ordem?.coluna === indice;
              return (
                <th
                  key={coluna.titulo}
                  className={cn(
                    "px-4 py-3 font-bold uppercase tracking-wide text-[0.8125rem] text-foreground",
                    "border-r last:border-r-0 border-white/60 align-middle",
                    coluna.largura,
                  )}
                >
                  <div className="flex items-center justify-center gap-2">
                    <button
                      type="button"
                      disabled={!ordenavel}
                      onClick={() =>
                        setOrdem((atual) =>
                          atual?.coluna === indice
                            ? { coluna: indice, desc: !atual.desc }
                            : { coluna: indice, desc: false },
                        )
                      }
                      className={cn(
                        "flex items-center gap-2 min-w-0",
                        ordenavel ? "cursor-pointer" : "cursor-default",
                      )}
                      title={ordenavel ? `Ordenar por ${coluna.titulo}` : undefined}
                    >
                      <span className="truncate">{coluna.titulo}</span>
                      {ordenavel && (
                        <ChevronsUpDown
                          className={cn(
                            "w-3.5 h-3.5 shrink-0",
                            ativa ? "text-brand-red" : "text-foreground/50",
                          )}
                        />
                      )}
                    </button>
                    {ordenavel && (
                      <button
                        type="button"
                        onClick={() =>
                          setFiltroAberto((atual) => (atual === indice ? null : indice))
                        }
                        title={`Filtrar ${coluna.titulo}`}
                        aria-label={`Filtrar ${coluna.titulo}`}
                        className={cn(
                          "shrink-0",
                          filtros[indice] ? "text-brand-red" : "text-foreground/50",
                        )}
                      >
                        <Menu className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {filtroAberto === indice && (
                    <input
                      autoFocus
                      value={filtros[indice] ?? ""}
                      onChange={(event) =>
                        setFiltros((atual) => ({ ...atual, [indice]: event.target.value }))
                      }
                      placeholder={`filtrar ${coluna.titulo.toLowerCase()}`}
                      className="mt-2 w-full h-8 px-2 text-xs font-normal normal-case tracking-normal border border-input bg-card outline-none focus:border-brand"
                    />
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {visiveis.length === 0 ? (
            <tr>
              <td colSpan={colunas.length} className="px-6 py-10 text-center">
                {vazio}
              </td>
            </tr>
          ) : (
            visiveis.map((linha) => (
              <tr
                key={chave(linha)}
                onClick={aoClicar ? () => aoClicar(linha) : undefined}
                className={cn(
                  "border-b last:border-b-0",
                  aoClicar && "cursor-pointer hover:bg-accent",
                )}
              >
                {colunas.map((coluna) => (
                  <td
                    key={coluna.titulo}
                    className={cn(
                      "px-4 py-3 align-top",
                      coluna.alinhar === "left" && "text-left",
                      coluna.alinhar === "right" && "text-right tabular-nums",
                      (coluna.alinhar ?? "center") === "center" && "text-center",
                    )}
                  >
                    {coluna.celula(linha)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {linhas.length > 0 && visiveis.length !== linhas.length && (
        <div className="px-4 py-2 text-xs text-muted-foreground border-t">
          {visiveis.length} de {linhas.length} linhas — o resto está escondido por um
          filtro de coluna.
        </div>
      )}
    </div>
  );
}
