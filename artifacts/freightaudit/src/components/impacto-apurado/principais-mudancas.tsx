import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import {
  FILTROS_DE_MUDANCA,
  ROTULO_DO_FILTRO,
  filtrarMudancas,
  valorDaMudanca,
  type FiltroDeMudanca,
  type MudancaRelevante,
} from "@/lib/impacto-apurado";

/**
 * Principais mudanças — onde está o dinheiro desta vigência.
 *
 * Um ranking só, com ganhos e perdas na mesma lista, porque a pergunta
 * executiva é uma só: *o que mais mexeu no resultado?* Duas tabelas lado a lado
 * obrigariam a comparar de cabeça duas escalas, e a terceira maior perda
 * apareceria acima do maior ganho por acaso de posição.
 *
 * **A ordem é pelo dinheiro, nunca pela quantidade.** Uma alteração de R$ 3 em
 * cem veículos fica abaixo de uma de R$ 30 mil em um — a régua é `movimento`,
 * de `mudancasRelevantes`, e a razão de ela não ser o saldo está escrita lá.
 *
 * Cada linha abre o parâmetro por dentro: quais grupos de alteração somam
 * naquele número, quantos veículos entraram, o que ficou de fora. É o painel
 * que a Visão executiva já usa (`DetalheDoImpacto`), e não um segundo caminho
 * escrito aqui.
 */
export function PrincipaisMudancas({
  linhas,
  periodicity,
  filtro,
  onFiltro,
  onAbrir,
  limite = 6,
  nota,
}: {
  linhas: MudancaRelevante[];
  periodicity: string | null;
  filtro: FiltroDeMudanca;
  onFiltro: (filtro: FiltroDeMudanca) => void;
  /** `null` quando não há painel a abrir — a Visão Geral não tem a árvore de parâmetros. */
  onAbrir: ((key: string) => void) | null;
  limite?: number;
  nota?: string;
}) {
  const visiveis = filtrarMudancas(linhas, filtro).slice(0, limite);
  const sufixo = periodicitySuffix(periodicity);
  const contagens: Record<FiltroDeMudanca, number> = {
    todos: linhas.length,
    ganhos: filtrarMudancas(linhas, "ganhos").length,
    perdas: filtrarMudancas(linhas, "perdas").length,
  };

  return (
    <section className="bg-card border rounded-xl shadow-sm px-6 py-5" aria-label="Principais mudanças">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-base font-bold">Principais mudanças</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Parâmetros com maior impacto financeiro{sufixo ? ` (R$${sufixo})` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0" role="group" aria-label="Recorte da lista">
          {FILTROS_DE_MUDANCA.map((opcao) => (
            <button
              key={opcao}
              type="button"
              onClick={() => onFiltro(opcao)}
              aria-pressed={filtro === opcao}
              disabled={contagens[opcao] === 0 && opcao !== "todos"}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-bold transition-colors",
                filtro === opcao
                  ? "bg-brand text-brand-foreground"
                  : "text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent",
              )}
            >
              {ROTULO_DO_FILTRO[opcao]}
            </button>
          ))}
        </div>
      </div>

      {visiveis.length === 0 ? (
        <p className="text-sm text-muted-foreground py-10 text-center">
          {linhas.length === 0
            ? "Nenhuma alteração desta vigência tem valor apurado — não há o que ranquear."
            : "Nenhuma mudança neste recorte."}
        </p>
      ) : (
        <ol className="mt-4 divide-y">
          {visiveis.map((linha, indice) => (
            <Linha
              key={linha.key}
              posicao={indice + 1}
              linha={linha}
              filtro={filtro}
              sufixo={sufixo}
              onAbrir={onAbrir}
            />
          ))}
        </ol>
      )}

      {nota && <p className="text-xs text-muted-foreground mt-4">{nota}</p>}
    </section>
  );
}

function Linha({
  posicao,
  linha,
  filtro,
  sufixo,
  onAbrir,
}: {
  posicao: number;
  linha: MudancaRelevante;
  filtro: FiltroDeMudanca;
  sufixo: string;
  onAbrir: ((key: string) => void) | null;
}) {
  const valor = valorDaMudanca(linha, filtro);
  const ganho = linha.classificacao === "ganho";
  const Conteudo = (
    <>
      <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">{posicao}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold truncate">{linha.name}</span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide shrink-0",
              ganho ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700",
            )}
          >
            {ganho ? "Ganho" : "Perda"}
          </span>
        </span>
        <span className="block text-xs text-muted-foreground truncate mt-0.5">
          {linha.familyName}
          {" · "}
          {linha.alteracoes.toLocaleString("pt-BR")}{" "}
          {linha.alteracoes === 1 ? "alteração" : "alterações"}
          {linha.veiculos > 0 && (
            <>
              {" · "}
              {linha.veiculos.toLocaleString("pt-BR")}{" "}
              {linha.veiculos === 1 ? "veículo" : "veículos"}
            </>
          )}
          {/*
            Um parâmetro que se mexeu nos dois sentidos diz isso na própria
            linha: o saldo esconde as duas parcelas, e é justamente onde elas
            se anulam que a leitura fica interessante.
          */}
          {filtro === "todos" && linha.doisLados && (
            <>
              {" · "}
              {formatBrlShort(linha.ganhos)} / {formatBrlShort(linha.perdas)}
            </>
          )}
        </span>
        <span className="mt-2 block h-1.5 rounded-full bg-muted overflow-hidden">
          <span
            className={cn("block h-full rounded-full", ganho ? "bg-emerald-600" : "bg-red-600")}
            style={{ width: `${Math.max(2, linha.proporcao * 100)}%` }}
          />
        </span>
      </span>
      <span
        className={cn(
          "text-sm font-extrabold tabular-nums shrink-0 text-right",
          ganho ? "text-emerald-700" : "text-red-700",
        )}
      >
        {formatBrlShort(valor)}
        {sufixo && <span className="block text-[10px] font-normal text-muted-foreground">{sufixo}</span>}
      </span>
      {onAbrir && <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
    </>
  );

  return (
    <li>
      {onAbrir ? (
        <button
          type="button"
          onClick={() => onAbrir(linha.key)}
          className="flex w-full items-center gap-3 py-3 text-left hover:bg-accent/60 transition-colors rounded-lg px-2 -mx-2"
        >
          {Conteudo}
        </button>
      ) : (
        <div className="flex items-center gap-3 py-3 px-2 -mx-2">{Conteudo}</div>
      )}
    </li>
  );
}
