import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { iconeDoCatalogo } from "@/lib/fluxos-icones";
import { COR_DA_CONEXAO, COR_PADRAO, type Catalogo } from "@/lib/fluxos";

/**
 * A LEGENDA — o que a forma e o traço querem dizer.
 *
 * O desenho comunica por forma (losango decide, pílula abre e fecha), por cor
 * (o tipo da etapa) e por traço (a seta cheia é o caminho, a tracejada é o
 * desvio). Quem montou o processo sabe disso; quem o recebeu pronto — o
 * auditor, o gerente novo, o cliente na reunião — não sabe, e sem a legenda
 * cada um inventa a própria leitura das cores.
 *
 * Ela é montada **do catálogo**, e não escrita à mão: é a mesma lista que a
 * paleta oferece e que o cartão pinta. Um tipo novo servido pela API aparece
 * aqui sozinho, com o rótulo e a descrição que o servidor deu — o que impede o
 * caso clássico de uma legenda que continua explicando o desenho de dois meses
 * atrás.
 *
 * Fica recolhida por padrão. Aberta o tempo todo, ela come o canto inferior do
 * canvas justamente onde um processo comprido costuma continuar; recolhida, é
 * um botão que diz o que é e some do caminho.
 */
export function LegendaDoFluxo({ catalogo }: { catalogo: Catalogo | undefined }) {
  const [aberta, setAberta] = useState(false);
  const tipos = catalogo?.tiposDeEtapa ?? [];
  const conexoes = catalogo?.tiposDeConexao ?? [];
  if (tipos.length === 0 && conexoes.length === 0) return null;

  return (
    <div
      className={cn(
        "max-w-[min(420px,calc(100vw-2rem))] rounded-lg border bg-card/95",
        "shadow-sm backdrop-blur-sm",
      )}
    >
      <button
        type="button"
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-foreground"
      >
        Legenda
        {aberta ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {aberta && (
        <div className="grid gap-3 border-t px-3 py-2.5 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              Elementos
            </p>
            <ul className="grid gap-1">
              {tipos.map((tipo) => {
                const Icone = iconeDoCatalogo(tipo.icone);
                return (
                  <li key={tipo.valor} className="flex items-center gap-2 text-[11px]">
                    <span
                      className={cn(
                        "flex h-4 w-6 shrink-0 items-center justify-center border",
                        tipo.classe,
                        tipo.forma === "pilula" && "rounded-full",
                        tipo.forma === "retangulo" && "rounded-sm",
                        /* O losango da legenda é o mesmo quadrado girado do cartão. */
                        tipo.forma === "losango" && "h-3.5 w-3.5 rotate-45 rounded-[3px]",
                      )}
                    >
                      {Icone && tipo.forma !== "losango" && (
                        <Icone className="h-2.5 w-2.5 text-muted-foreground" aria-hidden />
                      )}
                    </span>
                    <span className="truncate text-foreground" title={tipo.descricao}>
                      {tipo.rotulo}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              Ligações
            </p>
            <ul className="grid gap-1">
              {conexoes.map((conexao) => (
                <li key={conexao.valor} className="flex items-center gap-2 text-[11px]">
                  <svg width="24" height="8" viewBox="0 0 24 8" aria-hidden className="shrink-0">
                    <line
                      x1="0"
                      y1="4"
                      x2="20"
                      y2="4"
                      stroke={COR_DA_CONEXAO[conexao.valor] ?? COR_PADRAO}
                      strokeWidth="1.5"
                      strokeDasharray={conexao.tracejada ? "4 3" : undefined}
                    />
                    <path
                      d="M20 1 L24 4 L20 7 Z"
                      fill={COR_DA_CONEXAO[conexao.valor] ?? COR_PADRAO}
                    />
                  </svg>
                  <span className="truncate text-foreground" title={conexao.descricao}>
                    {conexao.rotulo}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
