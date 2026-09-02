import { Info } from "lucide-react";
import { Link } from "wouter";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { MedidaDoPlacar } from "@/lib/panorama";
import type { Tom } from "@/lib/visao-geral";

/**
 * Andar 2 — o placar. *"E os outros números?"*
 *
 * Cinco medidas na mesma régua: o superconjunto dos quatro cartões do Impacto
 * Líquido e dos cinco do Resumo executivo, publicado uma vez só.
 *
 * **Cinco cartões do mesmo tamanho, e um deles em destaque.** O destaque é o
 * líquido, e existe porque ele é o número que o andar de cima acabou de
 * anunciar: sem ele, a régua igual faria "impacto líquido" e "veículos
 * afetados" parecerem duas medidas do mesmo peso, quando uma é o resultado e a
 * outra é contexto dele.
 *
 * **Medida sem dado não aparece.** `valor === null` faz o cartão sumir e a
 * grade fechar — nada aqui mostra "0" para preencher lugar. É a mesma recusa
 * que o Resumo executivo já declarava, e a razão pela qual a Visão Geral não
 * desenha um cartão vazio onde a soma não sustenta resposta.
 *
 * **A definição de cada número vive no ⓘ, e não numa legenda.** Foi o que
 * permitiu, no andar de baixo, separar as duas coberturas que o produto tinha
 * com nomes parecidos: quem passa o mouse aqui lê que esta é a da **apuração**,
 * e que a auditada — percentual de célula de planilha — mora na procedência, no
 * fim da tela.
 */
export function Placar({ medidas }: { medidas: MedidaDoPlacar[] }) {
  const visiveis = medidas.filter((m) => m.valor !== null);
  if (visiveis.length === 0) return null;

  return (
    <div
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"
      aria-label="O placar da vigência"
      role="group"
    >
      {visiveis.map((medida) => (
        <Medida key={medida.chave} medida={medida} />
      ))}
    </div>
  );
}

/*
  A mesma paleta de tom que `OndeAgirAgora` usa, e pelo mesmo motivo: os dois
  andares publicam severidade lida da mesma régua (`qualidadeDaCobertura`,
  `Tom`), e duas escalas de cor para a mesma severidade fariam o placar e a fila
  discordarem sobre a gravidade do mesmo fato.
*/
const COR_DO_TOM: Record<Tom, string> = {
  grave: "text-red-700",
  atencao: "text-amber-700",
  ok: "text-emerald-700",
};

function Medida({ medida }: { medida: MedidaDoPlacar }) {
  const corpo = (
    <>
      <div className="flex items-start gap-2">
        <h3 className="text-[0.8125rem] font-bold min-w-0 flex-1 leading-tight">
          {medida.rotulo}
        </h3>
        <Ajuda texto={medida.ajuda} />
      </div>

      <p
        className={cn(
          "text-2xl font-extrabold tabular-nums leading-none mt-3",
          medida.tom ? COR_DO_TOM[medida.tom] : "text-foreground",
        )}
      >
        {medida.valor}
      </p>

      {medida.nota && (
        <p className="text-xs text-muted-foreground mt-2 leading-snug">{medida.nota}</p>
      )}
    </>
  );

  const classes = cn(
    "bg-card border rounded-xl shadow-sm px-5 py-4 flex flex-col relative",
    medida.destaque && "border-brand ring-1 ring-brand/20",
    medida.href && "hover:border-brand transition-colors",
  );

  /*
    O cartão inteiro é o alvo do clique quando há destino, e não um "ver mais"
    no rodapé: a área de toque de um cartão é o cartão. O ⓘ sobrevive por cima
    graças ao `relative z-10` dele — sem essa camada, tocar na definição
    navegaria em vez de explicar o número.
  */
  if (medida.href === null) {
    return <section className={classes}>{corpo}</section>;
  }

  return (
    <Link href={medida.href} className={classes}>
      {corpo}
    </Link>
  );
}

function Ajuda({ texto }: { texto: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={texto}
          className="relative z-10 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Info className="w-4 h-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-snug">{texto}</TooltipContent>
    </Tooltip>
  );
}
