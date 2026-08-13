import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BlocoBook } from "@/lib/book-operador";

/**
 * O cartão de um bloco do Book do Operador.
 *
 * A forma é a do Freightech: régua laranja em cima, categoria em laranja,
 * título em negrito, descrição em cinza, e a estrela no canto. Quem já usa a
 * base de lá reconhece a grade antes de ler qualquer palavra, e é isso que o
 * cartão precisa entregar.
 *
 * **Duas decisões que não são cosméticas.**
 *
 * 1. **O cartão não abre.** Em toda esta interface, cartão que abre promete
 *    conteúdo — e o conteúdo destes blocos é o documento do Freightech, que
 *    ainda não foi importado. Uma tela de detalhe vazia seria pior do que não
 *    ter tela: quem clicasse concluiria que o assunto não está coberto, quando
 *    o que falta é o arquivo. Enquanto não houver documento, o cartão é o
 *    índice, e diz o que é. Quando houver, ele abre.
 * 2. **A categoria usa `--brand-dark`, não `--brand`.** No Freightech ela é o
 *    laranja claro da marca, que sobre branco dá 2,3:1 — reprova em AA com
 *    folga, e é texto de 12px. A régua de cima fica no laranja original, porque
 *    é enfeite e não tem o que ler; o rótulo escurece. É a mesma troca que o
 *    `index.css` já documenta para o cartão sob o cursor.
 */
export function BlocoCard({
  bloco,
  favorito,
  onAlternarFavorito,
}: {
  bloco: BlocoBook;
  favorito: boolean;
  onAlternarFavorito: () => void;
}) {
  return (
    <article className="relative rounded-md bg-card border border-t-0 shadow-sm flex flex-col">
      <div className="h-1 bg-brand rounded-t-md" aria-hidden="true" />

      <div className="p-6 pr-12 flex flex-col gap-3 flex-1">
        <span className="text-sm text-brand-dark">{bloco.categoria}</span>

        <h3 className="text-lg font-bold leading-snug text-foreground">
          {bloco.titulo}
        </h3>

        <p className="text-sm text-muted-foreground leading-relaxed">
          {bloco.descricao}
        </p>

        {bloco.truncada && (
          /*
            O aviso de transcrição incompleta. Fica no cartão, e não numa nota de
            rodapé da página, porque quem lê esta descrição precisa saber que ela
            acaba antes do fim — a nota lá embaixo chegaria tarde.
          */
          <p className="text-xs text-amber-800 mt-auto pt-2">
            Descrição cortada na captura da tela do Freightech; o texto de lá
            continua.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onAlternarFavorito}
        aria-pressed={favorito}
        aria-label={
          favorito
            ? `Remover ${bloco.titulo} dos favoritos`
            : `Marcar ${bloco.titulo} como favorito`
        }
        title={favorito ? "Remover dos favoritos" : "Marcar como favorito"}
        className="absolute top-4 right-4 p-1 rounded hover:bg-muted transition-colors"
      >
        <Star
          className={cn(
            "w-5 h-5",
            favorito ? "fill-brand text-brand" : "text-muted-foreground",
          )}
        />
      </button>
    </article>
  );
}
