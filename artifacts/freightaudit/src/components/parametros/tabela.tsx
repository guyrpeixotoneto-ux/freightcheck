import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Columns3, Menu, RotateCcw, Table2, X } from "lucide-react";
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
  /**
   * Coluna presa à esquerda: fica parada enquanto o resto rola na horizontal.
   *
   * No Freightech quem fica preso é o AÇÕES, na ponta direita — a coluna dos
   * ícones de editar e excluir. Aqui não existe AÇÕES: o produto lê planilha
   * exportada e não escreve no Freightech, e prender uma coluna vazia seria
   * gastar a única coluna sempre visível com nada. Prendemos a identidade, à
   * esquerda: numa tabela de setenta e cinco colunas, quem rola até
   * TAXAFINAME precisa continuar sabendo de qual placa é a linha.
   */
  fixa?: boolean;
}

/** A cor do cabeçalho, opaca — célula presa não pode deixar ver o que passa por baixo. */
const FUNDO_CABECALHO = "color-mix(in srgb, hsl(var(--brand)) 25%, hsl(var(--card)))";

/**
 * O que a pessoa arrumou nesta tabela e não quer arrumar de novo amanhã.
 *
 * O Freightech chama isto de "Estado Tabela" e guarda; aqui vale o mesmo, no
 * navegador, por tabela. É preferência de quem está na máquina — não merece
 * tabela no banco, e falhar em gravá-la não pode derrubar a tela.
 */
interface EstadoTabela {
  ordem: { coluna: number; desc: boolean } | null;
  filtros: Record<number, string>;
  ocultas: number[];
}

const ESTADO_VAZIO: EstadoTabela = { ordem: null, filtros: {}, ocultas: [] };

function chaveDoEstado(id: string): string {
  return `freightcheck:tabela:${id}`;
}

function lerEstado(id: string | undefined): EstadoTabela {
  if (!id) return ESTADO_VAZIO;
  try {
    const bruto = window.localStorage.getItem(chaveDoEstado(id));
    if (!bruto) return ESTADO_VAZIO;
    return { ...ESTADO_VAZIO, ...(JSON.parse(bruto) as Partial<EstadoTabela>) };
  } catch {
    return ESTADO_VAZIO;
  }
}

export function TabelaFreightech<L>({
  id,
  colunas,
  linhas,
  chave,
  aoClicar,
  vazio,
}: {
  /**
   * Identidade da tabela, para o estado sobreviver ao ir e voltar. Sem ela a
   * tabela funciona igual e esquece tudo ao sair — que é o certo para uma
   * tabela efêmera, e errado para a tela de um cartão que se visita todo dia.
   */
  id?: string;
  colunas: ColunaTabela<L>[];
  linhas: L[];
  chave: (linha: L) => string;
  /** Quando existe, a linha inteira vira clicável. */
  aoClicar?: (linha: L) => void;
  /** O que dizer quando não há linha nenhuma. */
  vazio: React.ReactNode;
}) {
  const [estado, setEstado] = useState<EstadoTabela>(() => lerEstado(id));
  const [filtroAberto, setFiltroAberto] = useState<number | null>(null);
  const [painel, setPainel] = useState<"colunas" | "estado" | null>(null);

  const { ordem, filtros, ocultas } = estado;
  const setOrdem = (
    proxima: (atual: EstadoTabela["ordem"]) => EstadoTabela["ordem"],
  ) => setEstado((e) => ({ ...e, ordem: proxima(e.ordem) }));

  useEffect(() => {
    if (!id) return;
    try {
      window.localStorage.setItem(chaveDoEstado(id), JSON.stringify(estado));
    } catch {
      // Armazenamento bloqueado: a tabela deixa de lembrar, e nada além disso.
    }
  }, [id, estado]);

  const mostradas = colunas.filter((_, indice) => !ocultas.includes(indice));

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

  const arrumada =
    ordem !== null || Object.values(filtros).some((f) => f.trim()) || ocultas.length > 0;

  return (
    <div className="flex items-stretch">
      <div className="overflow-x-auto border bg-card flex-1 min-w-0">
        <table className="w-full text-sm">
        <thead>
          <tr className="bg-brand/25">
            {colunas.map((coluna, indice) => {
              if (ocultas.includes(indice)) return null;
              const ordenavel = Boolean(coluna.valor);
              const ativa = ordem?.coluna === indice;
              return (
                <th
                  key={coluna.titulo}
                  className={cn(
                    "px-4 py-3 font-bold uppercase tracking-wide text-[0.8125rem] text-foreground",
                    "border-r last:border-r-0 border-white/60 align-middle",
                    coluna.fixa && "sticky left-0 z-20 shadow-[1px_0_0_0_hsl(var(--border))]",
                    coluna.largura,
                  )}
                  style={coluna.fixa ? { backgroundColor: FUNDO_CABECALHO } : undefined}
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
                        // O `uppercase` do <th> não desce até aqui: o reset de
                        // formulário zera `text-transform` no <button>, e o
                        // rótulo saía em caixa mista onde o Freightech usa
                        // caixa alta. É o cabeçalho inteiro que a mão reconhece.
                        "flex items-center gap-2 min-w-0 uppercase",
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
                        setEstado((e) => ({
                          ...e,
                          filtros: { ...e.filtros, [indice]: event.target.value },
                        }))
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
              <td colSpan={mostradas.length} className="px-6 py-10 text-center">
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
                {colunas.map((coluna, indice) =>
                  ocultas.includes(indice) ? null : (
                  <td
                    key={coluna.titulo}
                    className={cn(
                      "px-4 py-3 align-top",
                      coluna.fixa &&
                        "sticky left-0 z-10 bg-card shadow-[1px_0_0_0_hsl(var(--border))]",
                      coluna.alinhar === "left" && "text-left",
                      coluna.alinhar === "right" && "text-right tabular-nums",
                      (coluna.alinhar ?? "center") === "center" && "text-center",
                    )}
                  >
                    {coluna.celula(linha)}
                  </td>
                  ),
                )}
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

      {/*
        O trilho da direita, como no Freightech: duas abas na vertical, coladas
        na borda da tabela. Lá elas são "Colunas" e "Estado Tabela", e aqui
        fazem o que os nomes dizem — escolher o que aparece, e ver e desfazer o
        que foi arrumado.
      */}
      <div className="border border-l-0 bg-card flex flex-col items-stretch shrink-0">
        <AbaVertical
          rotulo="Colunas"
          icone={<Columns3 className="w-4 h-4" />}
          ativa={painel === "colunas"}
          marcada={ocultas.length > 0}
          onClick={() => setPainel((a) => (a === "colunas" ? null : "colunas"))}
        />
        <AbaVertical
          rotulo="Estado Tabela"
          icone={<Table2 className="w-4 h-4" />}
          ativa={painel === "estado"}
          marcada={arrumada}
          onClick={() => setPainel((a) => (a === "estado" ? null : "estado"))}
        />
      </div>

      {painel === "colunas" && (
        <Painel titulo="Colunas" onFechar={() => setPainel(null)}>
          <p className="text-xs text-muted-foreground mb-3">
            O que aparece na tabela. Esconder uma coluna não filtra nada — as linhas
            continuam as mesmas.
          </p>
          <ul className="space-y-1">
            {colunas.map((coluna, indice) => {
              const visivel = !ocultas.includes(indice);
              const ultima = mostradas.length === 1 && visivel;
              return (
                <li key={coluna.titulo}>
                  <button
                    type="button"
                    disabled={ultima}
                    title={ultima ? "A última coluna visível não pode ser escondida." : undefined}
                    onClick={() =>
                      setEstado((e) => ({
                        ...e,
                        ocultas: visivel
                          ? [...e.ocultas, indice]
                          : e.ocultas.filter((i) => i !== indice),
                      }))
                    }
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 text-sm text-left rounded-sm",
                      ultima ? "opacity-50 cursor-not-allowed" : "hover:bg-accent",
                    )}
                  >
                    <span
                      className={cn(
                        "w-4 h-4 border flex items-center justify-center shrink-0",
                        visivel ? "bg-brand border-brand text-white" : "border-input",
                      )}
                    >
                      {visivel && <Check className="w-3 h-3" strokeWidth={3} />}
                    </span>
                    <span className="truncate">{coluna.titulo}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Painel>
      )}

      {painel === "estado" && (
        <Painel titulo="Estado Tabela" onFechar={() => setPainel(null)}>
          {!arrumada ? (
            <p className="text-sm text-muted-foreground">
              A tabela está como veio: sem ordenação, sem filtro, todas as colunas à
              mostra.
            </p>
          ) : (
            <>
              <dl className="text-sm space-y-2">
                {ordem && (
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                      Ordenação
                    </dt>
                    <dd>
                      {colunas[ordem.coluna]?.titulo}, {ordem.desc ? "maior primeiro" : "menor primeiro"}
                    </dd>
                  </div>
                )}
                {Object.entries(filtros)
                  .filter(([, termo]) => termo.trim())
                  .map(([indice, termo]) => (
                    <div key={indice}>
                      <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                        Filtro em {colunas[Number(indice)]?.titulo}
                      </dt>
                      <dd className="font-mono">{termo}</dd>
                    </div>
                  ))}
                {ocultas.length > 0 && (
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                      Colunas escondidas
                    </dt>
                    <dd>{ocultas.map((i) => colunas[i]?.titulo).join(", ")}</dd>
                  </div>
                )}
              </dl>

              <button
                type="button"
                onClick={() => setEstado(ESTADO_VAZIO)}
                className="mt-4 inline-flex items-center gap-2 text-[0.8125rem] font-bold uppercase tracking-wide text-brand hover:underline"
              >
                <RotateCcw className="w-4 h-4" />
                Voltar ao estado original
              </button>
            </>
          )}

          {id && (
            <p className="text-xs text-muted-foreground mt-4 pt-3 border-t">
              Fica guardado neste navegador, para esta tabela. Não é preferência de
              conta — quem abrir em outra máquina vê a tabela como ela vem.
            </p>
          )}
        </Painel>
      )}
    </div>
  );
}

/** Uma aba do trilho, com o rótulo na vertical como no Freightech. */
function AbaVertical({
  rotulo,
  icone,
  ativa,
  marcada,
  onClick,
}: {
  rotulo: string;
  icone: React.ReactNode;
  ativa: boolean;
  /** Há alguma coisa arrumada por baixo desta aba. */
  marcada: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativa}
      className={cn(
        "px-2 py-4 flex flex-col items-center gap-2 border-b last:border-b-0 transition-colors",
        ativa ? "bg-brand/25" : "hover:bg-accent",
      )}
    >
      <span className={cn("relative", marcada ? "text-brand-red" : "text-muted-foreground")}>
        {icone}
        {marcada && (
          <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-brand-red" />
        )}
      </span>
      <span
        className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground whitespace-nowrap"
        style={{ writingMode: "vertical-rl" }}
      >
        {rotulo}
      </span>
    </button>
  );
}

function Painel({
  titulo,
  onFechar,
  children,
}: {
  titulo: string;
  onFechar: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="w-72 shrink-0 border border-l-0 bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[0.8125rem] font-bold uppercase tracking-wide">{titulo}</h3>
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {children}
    </div>
  );
}
