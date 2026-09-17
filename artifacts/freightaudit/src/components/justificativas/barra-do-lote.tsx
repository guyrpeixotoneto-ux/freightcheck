import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";

/**
 * A BARRA DO MODO EM LOTE — entre os filtros e a tabela, e só enquanto ele
 * estiver ligado.
 *
 * ---------------------------------------------------------------------------
 * Por que uma barra, e não um cartão
 * ---------------------------------------------------------------------------
 * Porque ela não é uma etapa: é o estado da seleção, e o trabalho continua
 * sendo na tabela logo abaixo. Um bloco alto empurraria a primeira linha para
 * fora da tela justamente enquanto se escolhe linha — e quem escolhe precisa
 * ver o que está escolhendo. Daí a altura curta, a borda azul suave e o fundo
 * quase branco: presente, e não no caminho.
 *
 * ---------------------------------------------------------------------------
 * As duas frases da esquerda dizem coisas diferentes
 * ---------------------------------------------------------------------------
 * "5 selecionados" é o que está marcado agora. O link ao lado é **outra
 * operação**, e não um atalho da mesma: ele troca a lista pelo recorte — todos
 * os resultados dos filtros ativos, inclusive os que não estão nesta página. É
 * por isso que ele escreve o número do recorte inteiro, e não o da página: um
 * link que dissesse "todos os 50" sobre uma tabela de 206 mentiria sobre o que
 * o clique faz.
 *
 * Ligado o recorte inteiro, a frase muda para dizer isso por extenso, e o
 * mesmo lugar passa a oferecer o caminho de volta. Um recorte selecionado que
 * continuasse escrito "206 selecionados" seria indistinguível de alguém ter
 * marcado 206 caixas — e as duas coisas gravam registros diferentes.
 */
export function BarraDoLote({
  selecionadas,
  totalDoRecorte,
  todosOsResultados,
  recorteMudou,
  iguais,
  onTodosOsResultados,
  onIguais,
  onCancelar,
  onJustificar,
}: {
  selecionadas: number;
  /** Quantas alterações os filtros ativos entregam — o número do link. */
  totalDoRecorte: number;
  todosOsResultados: boolean;
  /** Os filtros mudaram com o recorte inteiro selecionado — ver o hook. */
  recorteMudou: boolean;
  /** Quantas alterações têm o mesmo contexto do que está marcado. */
  iguais: number;
  onTodosOsResultados: () => void;
  onIguais: () => void;
  onCancelar: () => void;
  onJustificar: () => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-brand/30 bg-brand/[0.04] px-4 py-2"
      role="region"
      aria-label="Seleção para justificar em lote"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold" aria-live="polite">
          {todosOsResultados
            ? `Todos os ${formatNumber(selecionadas, 0)} resultados selecionados`
            : `${formatNumber(selecionadas, 0)} selecionado${selecionadas === 1 ? "" : "s"}`}
        </span>

        {todosOsResultados ? (
          <span className="text-xs text-muted-foreground">
            A justificativa será gravada pelo recorte dos filtros ativos, e não
            por uma lista de linhas.
          </span>
        ) : (
          selecionadas < totalDoRecorte && (
            <button
              type="button"
              onClick={onTodosOsResultados}
              className="text-sm font-medium text-brand underline-offset-4 hover:underline"
            >
              Selecionar todos os {formatNumber(totalDoRecorte, 0)} resultados
            </button>
          )
        )}

        {/* A seleção rápida só aparece quando tem resposta: com dois contextos
            marcados, "iguais a quê?" não tem uma — ver `alteracoesIguais`. */}
        {!todosOsResultados && iguais > 0 && (
          <button
            type="button"
            onClick={onIguais}
            className="text-sm font-medium text-brand underline-offset-4 hover:underline"
          >
            Selecionar alterações iguais ({formatNumber(iguais, 0)})
          </button>
        )}

        {recorteMudou && (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-foreground">
            Os filtros mudaram — a seleção de todos os resultados foi desfeita.
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={selecionadas === 0}
          onClick={onJustificar}
        >
          Justificar selecionados
        </Button>
      </div>
    </div>
  );
}
