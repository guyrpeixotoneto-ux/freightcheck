import { FileText, Paperclip, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BlocoBook } from "@/lib/book-operador";
import type { BookEntryCurrent } from "./types";

/**
 * O cartão de um bloco do Book do Operador.
 *
 * A forma é a do Freightech: régua laranja em cima, categoria em laranja,
 * título em negrito, descrição em cinza, e a estrela no canto. Quem já usa a
 * base de lá reconhece a grade antes de ler qualquer palavra.
 *
 * **O cartão abre, e o rodapé diz o que vai encontrar.** Enquanto o Book era só
 * índice, abrir levaria a uma tela vazia — e quem clicasse concluiria que o
 * assunto não está coberto, quando o que faltava era o conteúdo. Agora o
 * conteúdo entra por aqui, então o cartão declara antes do clique se este bloco
 * tem regra escrita, documento anexado ou nada ainda. Um cartão sem regra abre
 * do mesmo jeito: é justamente ali que se registra a primeira.
 *
 * **A categoria usa `--brand-dark`, não `--brand`.** No Freightech ela é o
 * laranja claro da marca, que sobre branco dá 2,3:1 — reprova em AA com folga,
 * e é texto de 12px. A régua de cima fica no laranja original, porque é enfeite
 * e não tem o que ler. É a mesma troca que o `index.css` já documenta para o
 * cartão sob o cursor.
 *
 * **O cartão com documento anexado se distingue de longe.** O rodapé já dizia
 * qual bloco tem o quê, mas dizia em 12px, no fim do cartão — e a pergunta que
 * se faz varrendo a grade ("quais já têm o documento?") virava leitura de seis
 * rodapés por página. Um bloco com documento troca a régua de cima pelo verde e
 * ganha o clipe no canto: a resposta chega antes de qualquer palavra ser lida.
 * A régua laranja continua sendo a de todos os outros — a marca do Freightech
 * segue no lugar, e o verde só significa uma coisa nesta tela.
 */
export function BlocoCard({
  bloco,
  vigente,
  favorito,
  onAbrir,
  onAlternarFavorito,
}: {
  bloco: BlocoBook;
  vigente: BookEntryCurrent | undefined;
  favorito: boolean;
  onAbrir: () => void;
  onAlternarFavorito: () => void;
}) {
  const comDocumento = vigente?.kind === "DOCUMENTO";

  return (
    <article
      className={cn(
        "relative rounded-md bg-card border border-t-0 shadow-sm flex flex-col",
        comDocumento && "border-emerald-200",
      )}
    >
      <div
        className={cn(
          "h-1 rounded-t-md",
          comDocumento ? "bg-emerald-600" : "bg-brand",
        )}
        aria-hidden="true"
      />

      {comDocumento && (
        /*
          O clipe fica ao lado da estrela, e não sobre a régua: no canto de cima
          já mora o controle de favorito, e dois enfeites disputando o mesmo
          ponto fariam um deles parecer clicável sem ser. O `title` traz o nome
          do arquivo porque é a primeira coisa que se quer saber depois de ver
          que há um.
        */
        <span
          className="absolute top-4 right-12 inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-600 text-white"
          title={`Documento anexado: ${vigente?.filename ?? "documento"}`}
        >
          <Paperclip className="w-4 h-4" aria-hidden="true" />
          <span className="sr-only">
            Este bloco tem documento anexado
            {vigente?.filename ? `: ${vigente.filename}` : ""}.
          </span>
        </span>
      )}

      <button
        type="button"
        onClick={onAbrir}
        className={cn(
          "text-left p-6 flex flex-col gap-3 flex-1 rounded-b-md hover:bg-muted/40 transition-colors",
          // O texto para antes do canto ocupado: com o clipe, são dois.
          comDocumento ? "pr-20" : "pr-12",
        )}
      >
        <span className="text-sm text-brand-dark">{bloco.categoria}</span>

        <h3 className="text-lg font-bold leading-snug text-foreground">
          {bloco.titulo}
        </h3>

        {bloco.ocorrencia && bloco.ocorrencia > 1 && (
          /*
            Sem esta linha, a base repetida produz dois cartões visualmente
            idênticos e ninguém consegue dizer em qual anexou o quê. Marcar a
            segunda aparição é o mínimo — e dizer que a repetição é *de lá*
            evita a conclusão natural e errada de que a duplicata é nossa.
          */
          <p className="text-xs text-muted-foreground">
            {bloco.ocorrencia}ª aparição deste bloco na base do Freightech — a
            base o lista duas vezes, e cada uma guarda a sua regra.
          </p>
        )}

        <p className="text-sm text-muted-foreground leading-relaxed">
          {bloco.descricao}
        </p>

        {bloco.truncada && (
          /*
            O aviso de transcrição incompleta. Fica no cartão, e não numa nota de
            rodapé da página, porque quem lê esta descrição precisa saber que ela
            acaba antes do fim — a nota lá embaixo chegaria tarde.
          */
          <p className="text-xs text-amber-800">
            Descrição cortada na captura da tela do Freightech; o texto de lá
            continua.
          </p>
        )}

        <div className="mt-auto pt-3">
          <EstadoDaRegra vigente={vigente} />
        </div>
      </button>

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

/**
 * A linha que diz o que este bloco tem — e "nada" é uma resposta, escrita.
 *
 * O estado vazio não é cinza-neutro por acaso: um bloco sem regra não é um
 * defeito nem um alerta, é trabalho que ainda não foi feito, e pintá-lo de
 * vermelho faria 63 cartões gritarem no primeiro dia de uso.
 */
function EstadoDaRegra({ vigente }: { vigente: BookEntryCurrent | undefined }) {
  if (!vigente) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground border rounded-full px-2.5 py-1">
        Sem regra registrada
      </span>
    );
  }

  const documento = vigente.kind === "DOCUMENTO";
  const rotulo = documento ? (vigente.filename ?? "documento") : "Regra escrita";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-emerald-900 border rounded-full px-2.5 py-1 max-w-full",
        // O documento anexado é o estado mais forte dos três, e a pílula
        // acompanha o resto do cartão em vez de contradizê-lo.
        documento
          ? "bg-emerald-100 border-emerald-300 font-medium"
          : "bg-emerald-50 border-emerald-200",
      )}
    >
      {documento ? (
        <Paperclip className="w-3.5 h-3.5 shrink-0" />
      ) : (
        <FileText className="w-3.5 h-3.5 shrink-0" />
      )}
      <span className="truncate">{rotulo}</span>
      {vigente.revisions > 1 && (
        <span className="shrink-0 text-emerald-800">
          · {vigente.revisions} revisões
        </span>
      )}
    </span>
  );
}
