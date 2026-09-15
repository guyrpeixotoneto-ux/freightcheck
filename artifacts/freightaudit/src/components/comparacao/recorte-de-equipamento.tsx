import { rotuloDaCobertura } from "@workspace/comparison/recorte-de-rubrica";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

/** O recorte aberto: os dois tipos, ou os dois juntos. */
export type RecorteDeTipo = "TODOS" | "CAVALO" | "CARRETA";

export const RECORTES: readonly RecorteDeTipo[] = ["TODOS", "CAVALO", "CARRETA"];

/**
 * O RECORTE POR EQUIPAMENTO — CAVALO, CARRETA, OU OS DOIS.
 *
 * ---------------------------------------------------------------------------
 * Por que ele subiu para o topo da tela
 * ---------------------------------------------------------------------------
 * Porque ele já existia e ninguém o achava. As quatro auditorias de grão
 * equipamento tinham um seletor "Tipo de equipamento" na fileira de filtros, ao
 * lado da busca e abaixo dos cartões — e o relato que originou esta peça foi
 * *"não seria melhor termos a aba Cavalo e a aba Carreta?"*, de quem estava com
 * a tela aberta e o seletor a um palmo do cursor. Um eixo de leitura escondido
 * entre refinamentos de tabela é um eixo que não se usa.
 *
 * E ele filtrava pouco: alcançava a tabela e a contagem das abas de estado, não
 * os cartões nem os gráficos, que vêm prontos do servidor. Quem achasse o
 * seletor lia a tabela de cavalo sob os cartões de cavalo **mais** carreta — o
 * número de um recorte sob o título de outro, que é o defeito que este produto
 * persegue em toda parte.
 *
 * ---------------------------------------------------------------------------
 * Por que não é uma segunda fileira de abas
 * ---------------------------------------------------------------------------
 * Porque a tela já tem uma — Todas as alterações, Alterados, Novos, Ausentes,
 * Dado incompleto, Conflito, Sem alteração —, e ela é sobre a tabela. Duas
 * fileiras iguais empilhadas seriam duas perguntas disputando o mesmo gesto,
 * sem nada na forma dizendo qual manda em quê. Este controle é um segmento
 * fechado, acima dos cartões: a posição e o desenho dizem que ele governa a
 * tela inteira, e a fileira de abas continua governando a lista.
 */
export function RecorteDeEquipamento({
  valor,
  onValor,
  contagens,
  idPrefixo,
}: {
  valor: RecorteDeTipo;
  onValor: (v: RecorteDeTipo) => void;
  /**
   * Quantos veículos cada recorte tem — o que decide se ele é oferecido.
   *
   * Uma aba "Carreta" clicável sobre uma vigência que não tem carreta nenhuma
   * leva a uma tela vazia que não explica nada, e é a mesma falha que o seletor
   * de vigências tinha: oferecer o que não produz resposta. Aqui o botão fica
   * desabilitado e diz por quê — a ausência é a notícia, e ela tem de estar
   * escrita, não deduzida de uma tabela em branco.
   */
  contagens: Record<RecorteDeTipo, number>;
  idPrefixo: string;
}) {
  const rotulo = (r: RecorteDeTipo) =>
    r === "TODOS" ? "Cavalo + Carreta" : rotuloDaCobertura(r);

  return (
    <div
      role="tablist"
      aria-label="Recorte por equipamento"
      className="inline-flex flex-wrap items-center gap-1 rounded-lg border bg-muted/40 p-1"
    >
      {RECORTES.map((r) => {
        const quantos = contagens[r] ?? 0;
        const vazio = quantos === 0 && r !== "TODOS";
        return (
          <button
            key={r}
            id={`${idPrefixo}-recorte-${r.toLowerCase()}`}
            type="button"
            role="tab"
            aria-selected={valor === r}
            disabled={vazio}
            title={
              vazio
                ? `Esta comparação não tem ${rotulo(r).toLowerCase()}. Importe o arquivo correspondente nas duas vigências para auditá-lo aqui.`
                : undefined
            }
            onClick={() => onValor(r)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
              valor === r
                ? "bg-background text-brand shadow-sm"
                : "text-muted-foreground hover:text-foreground",
              vazio && "cursor-not-allowed opacity-40 hover:text-muted-foreground",
            )}
          >
            {rotulo(r)}
            <span className="ml-1.5 font-normal tabular-nums opacity-70">
              {formatNumber(quantos, 0)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
