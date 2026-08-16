import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { faixaDaPagina, numerosDePagina } from "@/lib/paginacao";
import { cn } from "@/lib/utils";

/**
 * O rodapé que diz onde a lista está e deixa ir para o resto dela.
 *
 * Ele nasceu no Book do Operador e agora é de todas as listas longas, porque a
 * alternativa que existia nas tabelas de Alterações era pior do que parecia:
 * elas carregavam as primeiras 300 linhas e escreviam "Mostrando 300 de 1218.
 * Use os filtros para chegar ao restante". A frase é honesta — nada foi
 * descartado —, mas ela transformava "ver a alteração 400" numa charada de
 * filtros, e não havia filtro nenhum que significasse *a próxima página*. As
 * 918 restantes existiam no banco, a API já aceitava `offset`, e só faltava
 * esta barra.
 *
 * A forma é a do Freightech, de propósito: contagem à esquerda, páginas no
 * meio, tamanho à direita. Quem navega os dois sistemas lado a lado não deveria
 * ter de aprender dois rodapés.
 */
export function Paginacao({
  pagina,
  porPagina,
  total,
  onPagina,
  onPorPagina,
  tamanhos,
  unidade = "resultados",
  className,
}: {
  /** 1-based, como as pessoas contam páginas. */
  pagina: number;
  porPagina: number;
  /** O total **sem** paginação — é ele que diz quantas páginas existem. */
  total: number;
  onPagina: (pagina: number) => void;
  /** Sem isto, e sem `tamanhos`, o seletor de tamanho não aparece. */
  onPorPagina?: (porPagina: number) => void;
  tamanhos?: number[];
  unidade?: string;
  className?: string;
}) {
  // A página pedida pode não existir mais — um filtro que encurtou a lista, um
  // envio trocado. `faixaDaPagina` a prende no que existe: mostrar a última é o
  // que não mente sobre o que está na tela.
  const { atual, primeiro, ultimo, totalPaginas } = faixaDaPagina(
    pagina,
    porPagina,
    total,
  );

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 border-t px-4 py-3",
        className,
      )}
    >
      <p className="text-sm text-muted-foreground">
        {total === 0
          ? "Nenhum resultado"
          : `Mostrando ${primeiro} - ${ultimo} de ${total} ${unidade}`}
      </p>

      {/* Uma página só não tem para onde ir, e um rodapé com o botão "1" aceso
          e as setas apagadas só ocupa espaço dizendo isso. */}
      {totalPaginas > 1 && (
        <nav className="flex items-center gap-1" aria-label="Paginação">
          <BotaoPagina
            onClick={() => onPagina(atual - 1)}
            desabilitado={atual <= 1}
            rotuloAcessivel="Página anterior"
          >
            <ChevronLeft className="w-4 h-4" />
          </BotaoPagina>

          {numerosDePagina(atual, totalPaginas).map((numero, indice) =>
            numero === null ? (
              <span
                key={`reticencia-${indice}`}
                className="px-2 text-muted-foreground"
              >
                …
              </span>
            ) : (
              <BotaoPagina
                key={numero}
                onClick={() => onPagina(numero)}
                ativo={numero === atual}
                rotuloAcessivel={`Página ${numero}`}
              >
                {numero}
              </BotaoPagina>
            ),
          )}

          <BotaoPagina
            onClick={() => onPagina(atual + 1)}
            desabilitado={atual >= totalPaginas}
            rotuloAcessivel="Próxima página"
          >
            <ChevronRight className="w-4 h-4" />
          </BotaoPagina>
        </nav>
      )}

      {onPorPagina && tamanhos && tamanhos.length > 0 && (
        <label className="text-sm text-muted-foreground flex items-center gap-2">
          Por página
          <select
            value={porPagina}
            onChange={(evento) => onPorPagina(Number(evento.target.value))}
            className="border border-input rounded-sm h-9 px-2 bg-card text-foreground outline-none focus:border-brand"
          >
            {tamanhos.map((tamanho) => (
              <option key={tamanho} value={tamanho}>
                {tamanho}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function BotaoPagina({
  children,
  onClick,
  ativo,
  desabilitado,
  rotuloAcessivel,
}: {
  children: ReactNode;
  onClick: () => void;
  ativo?: boolean;
  desabilitado?: boolean;
  rotuloAcessivel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      aria-label={rotuloAcessivel}
      aria-current={ativo ? "page" : undefined}
      className={cn(
        "min-w-9 h-9 px-2 rounded-sm text-sm font-medium inline-flex items-center justify-center transition-colors",
        ativo
          ? "bg-brand text-brand-foreground"
          : "text-muted-foreground hover:bg-muted",
        desabilitado && "opacity-40 pointer-events-none",
      )}
    >
      {children}
    </button>
  );
}
