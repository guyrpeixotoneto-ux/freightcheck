import { FileText, ReceiptText } from "lucide-react";

import { SEMANTICA_DA_FONTE, type FonteDeFiname } from "@workspace/comparison/fonte-de-finame";
import { cn } from "@/lib/utils";

/**
 * DADOS ANALISADOS — qual fonte a tela está lendo.
 *
 * ---------------------------------------------------------------------------
 * Por que ele mora dentro da barra das abas
 * ---------------------------------------------------------------------------
 * Porque as duas perguntas são da mesma decisão, e a barra é onde ela é tomada:
 * à esquerda **o que** se analisa (cavalo, carreta, os dois, a evolução), à
 * direita **de onde** vem o dado. Postos em lugares diferentes da página, os
 * dois eixos pareceriam independentes — e um deles, o de baixo, pareceria um
 * filtro de tabela.
 *
 * O que separa os dois grupos é um fio e um rótulo, e não um segundo bloco: o
 * fio diz que o que vem depois não é mais um recorte, e o rótulo diz o que é.
 * Foi a mesma solução que a aba Evolução recebeu na outra ponta da barra, pela
 * mesma razão.
 *
 * ---------------------------------------------------------------------------
 * As três recusas de desenho
 * ---------------------------------------------------------------------------
 * **Não é um switch.** Um liga/desliga tem um estado padrão e um estado "outro",
 * e essas duas fontes não são isso: são duas leituras legítimas, mutuamente
 * exclusivas, e nenhuma é o desvio da outra. Um segmento fechado mostra as duas
 * o tempo todo, com uma marcada.
 *
 * **Não é um banner.** A fonte não muda a estrutura da tela, muda o dado — e um
 * bloco no cabeçalho custaria altura em toda visita para dizer o que o próprio
 * segmento já diz, marcado.
 *
 * **Não é uma terceira opção disfarçada.** Duas, e só duas: a marcada e a outra.
 *
 * ---------------------------------------------------------------------------
 * O peso visual é assimétrico de propósito
 * ---------------------------------------------------------------------------
 * A marcada tem fundo claro, borda da marca, texto da marca e uma sombra de um
 * pixel; a outra é só texto acinzentado. É o suficiente para se achar de
 * relance e pouco o bastante para não competir com as abas, que são a decisão
 * primária da tela. Um segmento com dois botões igualmente preenchidos faria a
 * barra parecer ter seis abas.
 */

const ICONE: Record<FonteDeFiname, typeof FileText> = {
  REMUNERADO: ReceiptText,
  REAL: FileText,
};

const FONTES: readonly FonteDeFiname[] = ["REMUNERADO", "REAL"];

export function SeletorDeFonte({
  valor,
  onValor,
  idPrefixo = "finame",
}: {
  valor: FonteDeFiname;
  onValor: (fonte: FonteDeFiname) => void;
  idPrefixo?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      {/* O fio que diz "o que vem a seguir não é mais um recorte". Em tela
          estreita o grupo inteiro cai para a segunda linha, e o fio some com
          ele: um fio vertical no começo de uma linha não separa nada. */}
      <span
        aria-hidden="true"
        className="hidden self-stretch border-l border-border/70 sm:block"
      />
      <span
        id={`${idPrefixo}-fonte-rotulo`}
        className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        Dados analisados
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${idPrefixo}-fonte-rotulo`}
        className="inline-flex items-center gap-1"
      >
        {FONTES.map((fonte) => {
          const Icone = ICONE[fonte];
          const marcada = valor === fonte;
          return (
            <button
              key={fonte}
              id={`${idPrefixo}-fonte-${fonte.toLowerCase()}`}
              type="button"
              role="radio"
              aria-checked={marcada}
              onClick={() => onValor(fonte)}
              title={SEMANTICA_DA_FONTE[fonte].linhaDeContexto}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-semibold transition-colors",
                marcada
                  ? "border border-brand/60 bg-background text-brand shadow-sm"
                  : /* A não marcada não tem borda **nem** ganha uma no hover: uma
                       borda que aparece ao passar o mouse parece a marcada, e por
                       um instante as duas parecem valer. */
                    "border border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icone
                aria-hidden="true"
                className={cn("h-3.5 w-3.5", marcada ? "opacity-90" : "opacity-60")}
              />
              {SEMANTICA_DA_FONTE[fonte].rotulo}
            </button>
          );
        })}
      </div>
    </div>
  );
}
