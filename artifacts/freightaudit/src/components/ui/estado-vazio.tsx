import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Medalhao } from "./superficie";

/**
 * O estado vazio — "não há o que mostrar aqui, e este é o motivo".
 *
 * O produto tinha três formatos para a mesma situação, e nenhum deles decidido:
 * uma frase cinza solta no meio do cartão (`py-20 text-center`), um cartão
 * inteiro com título em negrito e parágrafo, e o `Empty` do shadcn, usado em
 * dois lugares. A frase solta é a pior das três, e é a mais comum: ela ocupa
 * uma faixa alta de cartão com uma linha de texto pequeno, o que faz o vazio
 * parecer defeito de carregamento.
 *
 * Aqui o vazio é um bloco composto, e a composição é sempre a mesma:
 *
 * - **um medalhão** com o ícone do assunto — é ele que diz, antes da leitura,
 *   que a tela está inteira e só não tem dado;
 * - **uma frase-título** que responde *o que não há*;
 * - **uma explicação** que responde *por quê*, ou *o que fazer para haver*;
 * - **uma ação**, quando existe uma que resolva. Quando não existe, não se
 *   inventa botão.
 *
 * Ele **não** desenha cartão em volta: quem tem cartão é o bloco onde ele mora,
 * e um cartão dentro do outro é a moldura dupla que esta rodada veio desfazer.
 * Para o vazio que ocupa a página inteira, envolva-o numa `Superficie`.
 *
 * `tom` é a única cor que entra, e ela é semântica: `neutro` para o vazio
 * normal — ninguém errou nada, só não há dado —, `atencao` para o vazio que é
 * pendência, `erro` para o que é falha. O padrão é neutro de propósito: pintar
 * de laranja toda tabela vazia gastaria a cor de atenção no caso mais comum do
 * produto, e ela deixaria de significar alguma coisa nos casos em que
 * significa.
 */
export function EstadoVazio({
  icone,
  titulo,
  descricao,
  acao,
  tom = "neutro",
  compacto = false,
  className,
}: {
  icone: ComponentType<{ className?: string }>;
  titulo: ReactNode;
  descricao?: ReactNode;
  acao?: ReactNode;
  tom?: "neutro" | "atencao" | "erro";
  /** Metade do respiro vertical — para o vazio que mora dentro de um cartão pequeno. */
  compacto?: boolean;
  className?: string;
}) {
  const cor = {
    neutro: "bg-muted text-muted-foreground",
    atencao: "bg-warning/12 text-warning-foreground",
    erro: "bg-destructive/10 text-destructive",
  }[tom];

  return (
    <div
      className={cn(
        "flex flex-col items-center text-center",
        compacto ? "py-8 px-4" : "py-14 px-6",
        className,
      )}
    >
      <Medalhao icone={icone} tamanho="lg" className={cn(cor, "rounded-2xl")} />
      <p className="text-[0.9375rem] font-bold mt-5 max-w-md text-balance">{titulo}</p>
      {descricao && (
        <p className="text-sm text-muted-foreground mt-2 max-w-lg leading-relaxed text-balance">
          {descricao}
        </p>
      )}
      {acao && <div className="mt-5 flex items-center gap-2.5 flex-wrap justify-center">{acao}</div>}
    </div>
  );
}
