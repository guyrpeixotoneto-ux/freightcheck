import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EmAtualizacao } from "@/components/ui/em-atualizacao";
import { Medalhao } from "@/components/ui/superficie";
import { Trilha, useTrilha } from "./trilha";

/**
 * O cabeçalho de página — a mesma abertura em toda tela do produto.
 *
 * Quinze páginas escreviam `px-8 pt-7 pb-2` com um `<h1>` de `text-[2rem]` e um
 * parágrafo cinza embaixo; outras seis escreviam `px-8 pt-6` com um `<h1>` de
 * `text-2xl`; e o resto inventava. Nenhuma dessas diferenças queria dizer
 * alguma coisa — elas são a idade de cada tela, e não a importância dela. Uma
 * casca executiva se reconhece justamente por isso: a página troca e a moldura
 * não.
 *
 * O que este cabeçalho fixa, e que estava solto:
 *
 * 1. **A trilha**, no alto e à esquerda, dizendo de que seção do menu esta tela
 *    é. Ela sai da mesma árvore que a lateral desenha (`trilha.tsx`) e, por
 *    isso, nasce em toda página que use este cabeçalho sem que nenhuma delas
 *    precise escrevê-la.
 * 2. **A linha de contexto**, no alto e à direita — "Dados atualizados às
 *    20:19", "3 unidades no recorte". Ela vinha depois do título, embaixo dos
 *    botões, onde competia com o subtítulo; aqui ela ocupa o canto que estava
 *    vazio e sai do caminho da leitura.
 * 3. **O título e o subtítulo**, com a mesma escala e o mesmo respiro em toda
 *    parte.
 * 4. **As ações**, alinhadas ao título e nunca abaixo dele, porque é a altura
 *    em que o olho já está quando termina de ler o nome da tela.
 * 5. **A faixa branca com borda embaixo**, que vinte e cinco telas desenhavam
 *    (`border-b bg-card px-8 py-6`) e que a leitura executiva já havia
 *    abandonado, some. Ela punha uma segunda barra logo abaixo da faixa
 *    marinho do topo e empurrava o primeiro número da página para baixo da
 *    dobra em tela de 13 polegadas — e o que qualifica um título é o texto, não
 *    o fundo atrás dele. Agora todas as telas abrem sobre o mesmo cinza.
 *
 * O que ele **não** faz: decidir o que a página diz. Título, subtítulo, ações e
 * contexto continuam vindo de quem conhece a tela. E não há `<Layout>` aqui
 * dentro — a casca continua sendo montada pela página, como sempre foi.
 *
 * `largura` acompanha o corpo da página. As telas do produto usam
 * `max-w-[1600px]` (leitura executiva) ou `max-w-[1400px]` (operação); o
 * cabeçalho precisa da mesma régua, senão o título e o primeiro cartão da
 * página não começam na mesma coluna.
 */
export function CabecalhoDePagina({
  titulo,
  icone,
  descricao,
  rodape,
  voltar,
  acoes,
  contexto,
  atualizando = false,
  trilha = "automatica",
  largura = "1600px",
  className,
}: {
  titulo: ReactNode;
  /**
   * O ícone da tela, num medalhão à esquerda do título.
   *
   * Vinte e poucas telas o desenhavam **dentro** do `<h1>`, colado à primeira
   * letra e da altura da caixa alta: ali ele é lido como parte da palavra, e
   * cresce junto com ela. No medalhão ele volta a ser o que é — a marca do
   * assunto —, e as telas que não têm um não ganham buraco: o título
   * simplesmente começa na margem.
   */
  icone?: ComponentType<{ className?: string }>;
  descricao?: ReactNode;
  /**
   * O caminho de volta, quando ele é **específico** — "‹ 01/08 a 15/08", e não
   * "‹ Competências".
   *
   * Ele ocupa o lugar da trilha, e não um lugar ao lado dela. As telas que o
   * têm são as de terceiro nível (um dia dentro de uma competência, uma placa
   * dentro de uma unidade), e nelas a trilha do menu nomeia a seção — o que é
   * verdade, e é menos útil do que o pai concreto de onde a pessoa veio. Os
   * dois juntos seriam duas navegações na mesma linha dizendo quase a mesma
   * coisa.
   */
  voltar?: ReactNode;
  /**
   * O que a tela precisa dizer logo abaixo do título e antes do conteúdo — uma
   * contagem, um aviso de pendência, uma faixa de estado. Fica dentro do
   * cabeçalho para acompanhar a régua de largura dele.
   */
  rodape?: ReactNode;
  /** Botões e seletores, à direita do título. */
  acoes?: ReactNode;
  /** A linha do canto superior direito — quando os dados chegaram, o recorte. */
  contexto?: ReactNode;
  /** Liga a etiqueta "atualizando" ao lado do título. */
  atualizando?: boolean;
  /**
   * `automatica` lê a trilha do menu. `null` desliga — para a tela que não é
   * item de menu e cuja migalha seria invenção.
   */
  trilha?: "automatica" | { secao: string; tela: string } | null;
  largura?: "1600px" | "1400px" | "none";
  className?: string;
}) {
  const doMenu = useTrilha();
  const migalhas = trilha === "automatica" ? doMenu : trilha;

  return (
    <header className={cn("px-8 pt-6 pb-1", className)}>
      <div
        className={cn(
          largura === "1600px" && "max-w-[1600px]",
          largura === "1400px" && "max-w-[1400px]",
        )}
      >
        {(voltar || migalhas || contexto) && (
          <div className="flex items-center justify-between gap-4 flex-wrap mb-4 min-h-[1.25rem]">
            {voltar ? (
              voltar
            ) : migalhas ? (
              <Trilha secao={migalhas.secao} tela={migalhas.tela} />
            ) : (
              <span />
            )}
            {contexto && (
              <div className="text-xs text-muted-foreground flex items-center gap-1.5 shrink-0">
                {contexto}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="min-w-0 flex gap-4">
            {icone && (
              <Medalhao
                icone={icone}
                tamanho="lg"
                className="bg-brand/10 text-brand hidden sm:flex mt-0.5"
              />
            )}
            <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              {/*
                `text-[1.75rem]` e não os `2rem` de antes.

                O título competia com o número do primeiro cartão — o veredito
                do Panorama sai em `text-5xl` —, e dois corpos grandes na mesma
                dobra brigam pelo mesmo olho. O que dá autoridade ao título
                aqui é o peso e o espaço em volta dele, não mais um degrau de
                corpo.
              */}
              <h1 className="text-[1.75rem] font-extrabold tracking-[-0.02em] leading-tight break-words">
                {titulo}
              </h1>
              <EmAtualizacao ativo={atualizando} />
            </div>
            {descricao && (
              <p className="text-sm text-muted-foreground mt-2 max-w-3xl leading-relaxed">
                {descricao}
              </p>
            )}
            </div>
          </div>

          {acoes && <div className="flex items-center gap-2.5 shrink-0 flex-wrap">{acoes}</div>}
        </div>

        {rodape && <div className="mt-4">{rodape}</div>}
      </div>
    </header>
  );
}

/**
 * O corpo da página — o par do cabeçalho acima.
 *
 * Mesma régua de largura, mesmo `px-8`, e o espaço entre os blocos num lugar
 * só. Ele existe pela mesma razão que o cabeçalho: `px-8 py-6 space-y-5` estava
 * escrito à mão em quarenta telas, com o `space-y` variando entre 4, 5 e 6 sem
 * que a variação quisesse dizer nada.
 */
export function CorpoDaPagina({
  children,
  largura = "1600px",
  className,
}: {
  children: ReactNode;
  largura?: "1600px" | "1400px" | "none";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "px-8 py-6 space-y-5",
        largura === "1600px" && "max-w-[1600px]",
        largura === "1400px" && "max-w-[1400px]",
        className,
      )}
    >
      {children}
    </div>
  );
}
