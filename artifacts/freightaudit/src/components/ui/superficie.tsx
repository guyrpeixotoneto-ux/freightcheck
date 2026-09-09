import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A superfície — o cartão do FreightCheck como componente.
 *
 * A classe `.superficie` (em `index.css`) já dava um nome ao traço, ao raio e à
 * elevação. O que ela não resolvia é o que vem **dentro** de um cartão de
 * leitura, e que também estava copiado tela a tela: o título em corpo pequeno e
 * negrito, a linha de subtítulo em cinza logo abaixo, e o controle solto no
 * canto direito. Três telas escreviam `text-base font-bold`, duas
 * `text-[0.9375rem] font-semibold`, e o resultado é que dois cartões vizinhos
 * anunciavam-se em pesos diferentes sem que a diferença quisesse dizer nada.
 *
 * Aqui o cabeçalho é um componente e o corpo é o `children`. **Nada disto
 * decide conteúdo**: quem passa título, subtítulo e ação continua sendo a tela,
 * que é quem sabe o que a seção diz.
 *
 * `as` existe porque metade destes cartões é `<section>` — um bloco de leitura
 * com rótulo próprio —, e a outra metade é `<div>` de agrupamento. Trocar a
 * etiqueta sem trocar de componente é o que impede que a semântica se perca no
 * caminho da padronização.
 */
export function Superficie({
  as: Tag = "section",
  variante = "padrao",
  interativa = false,
  className,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  as?: "section" | "div" | "article" | "aside";
  /**
   * `destaque` é o primeiro andar de uma tela de leitura — o véu do marinho da
   * marca. Uma por tela; ver `.superficie-destaque`.
   */
  variante?: "padrao" | "destaque";
  /** O cartão inteiro é alvo de clique: ele levanta sob o cursor. */
  interativa?: boolean;
}) {
  return (
    <Tag
      className={cn(
        variante === "destaque" ? "superficie-destaque" : "superficie",
        interativa && "superficie-interativa",
        className,
      )}
      {...props}
    />
  );
}

/**
 * O cabeçalho de uma superfície: título à esquerda, controle à direita.
 *
 * O subtítulo é opcional e fica **abaixo** do título, nunca ao lado: os dois na
 * mesma linha faziam o olho ler uma frase só, e um subtítulo que se lê junto do
 * título não é subtítulo — é ruído no meio do título.
 *
 * `rotulo` é o versalete acima do título (`.rotulo-secao`), para o cartão em
 * que o título é um número e não uma frase — o veredito, o placar. Ele não é o
 * padrão porque um versalete em cima de toda seção é a mesma coisa que nenhum.
 */
export function CabecalhoDaSuperficie({
  rotulo,
  titulo,
  descricao,
  acao,
  className,
}: {
  rotulo?: React.ReactNode;
  titulo: React.ReactNode;
  descricao?: React.ReactNode;
  /** Botão, seletor ou link no canto direito. */
  acao?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 flex-wrap", className)}>
      <div className="min-w-0">
        {rotulo && <p className="rotulo-secao mb-1.5">{rotulo}</p>}
        <h2 className="text-[0.9375rem] font-bold tracking-tight leading-tight">{titulo}</h2>
        {descricao && (
          <p className="text-xs text-muted-foreground mt-1 leading-snug">{descricao}</p>
        )}
      </div>
      {acao && <div className="shrink-0 flex items-center gap-2">{acao}</div>}
    </div>
  );
}

/**
 * O medalhão do ícone.
 *
 * Ele abre o cartão de indicador, o estado vazio e a superfície de destaque, e
 * era desenhado à mão em cada um deles — `w-12 h-12 rounded-full`,
 * `size-10 rounded-lg`, `w-11 h-11 rounded-xl` —, o que fazia três blocos com o
 * mesmo papel parecerem três invenções diferentes.
 *
 * A cor vem de fora, em `className`, e é de propósito: aqui ela é semântica
 * (marinho é o produto, laranja é atenção, vermelho é perda) e semântica não
 * pode morar numa classe de forma.
 */
export function Medalhao({
  icone: Icone,
  tamanho = "md",
  className,
}: {
  icone: React.ComponentType<{ className?: string }>;
  tamanho?: "sm" | "md" | "lg";
  className?: string;
}) {
  const caixa = { sm: "w-8 h-8", md: "w-10 h-10", lg: "w-14 h-14" }[tamanho];
  const glifo = { sm: "w-4 h-4", md: "w-5 h-5", lg: "w-7 h-7" }[tamanho];

  return (
    <span aria-hidden className={cn("medalhao", caixa, className)}>
      <Icone className={glifo} />
    </span>
  );
}
