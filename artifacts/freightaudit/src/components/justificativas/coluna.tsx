import { MessageSquarePlus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AlvoDaJustificativa } from "@/components/justificativas/justificar-dialog";
import type { Justificativa } from "@/lib/justificativas";

/**
 * A coluna de justificativa das tabelas de rubrica — uma só, para todas elas.
 *
 * Ela nasceu dentro da tabela do FINAME, e ficou lá enquanto era de uma tela
 * só. Passou a valer para IPVA, Impostos, Lucro Fixo, Km Rodado e Velocidade
 * Média, que são a mesma tabela com outra rubrica: mesmo grão (um veículo, uma
 * variável, os dois lados), mesmo `change.id`, mesmos seis estados. Copiada
 * cinco vezes, a célula concordaria no dia em que fosse copiada e discordaria
 * no seguinte — e a discordância apareceria como "Justificar" aparecendo numa
 * tela em linha que outra recusa, que é a diferença entre cobrar uma pendência
 * e inventá-la.
 *
 * O que ela **não** sabe fazer é gravar: a tabela abre o diálogo que a página
 * já sabe gravar (`useJustificarNaTabela`), e é a mesma caixa de Chamados.
 */

/**
 * O que a coluna precisa de uma linha — e só isso.
 *
 * É o recorte que `LinhaDeIpva`, `LinhaDeImpostos`, `LinhaDeLucroFixo`,
 * `LinhaDeKmRodado`, `LinhaDeVelocidadeMedia` e `LinhaDeFiname` já satisfazem
 * sem conversão nenhuma. Pedir a linha inteira de uma delas obrigaria as outras
 * a inventar campos que não têm — que é o mesmo motivo de `AlvoDaJustificativa`
 * não ser `ChangeRow`.
 */
export interface LinhaJustificavel {
  /** O `change.id`. Nulo na linha "sem alteração", que não tem o que justificar. */
  id: number | null;
  entityLabel: string | null;
  attributeCode: string | null;
  rotuloDaVariavel: string;
  estado: string;
  /** Os dois lados, como a linha já os escreve — o diálogo os mostra sem reformatar. */
  base?: string | null;
  comparada?: string | null;
  diferenca?: number | null;
  variacao?: number | null;
}

/**
 * Justificar a partir da tabela — o que o componente pede de fora.
 *
 * A tabela não grava nada: ela **abre o diálogo** que a página já sabe gravar.
 * `alvos` são as alterações que vão receber a justificativa (uma, ou todas as
 * da placa), e `atual` é o que já está gravado, quando se está reescrevendo — o
 * diálogo abre com ele nos campos, porque quem reabre uma linha explicada quase
 * sempre quer corrigir, não redigir do zero.
 */
export type AbrirJustificativa = (
  alvos: AlvoDaJustificativa[],
  atual?: Justificativa | null,
) => void;

/** Uma linha do motor como o diálogo de justificar a enxerga. */
export const alvoDaLinha = (l: LinhaJustificavel): AlvoDaJustificativa => ({
  id: l.id!,
  entityLabel: l.entityLabel,
  attributeCode: l.attributeCode,
  attributeName: l.rotuloDaVariavel,
  valueBefore: l.base ?? null,
  valueAfter: l.comparada ?? null,
  deltaAbsolute: l.diferenca ?? null,
  deltaPercent: l.variacao ?? null,
});

/** A linha é justificável quando o motor afirmou que houve alteração nela. */
export const justificavel = (l: LinhaJustificavel): boolean =>
  l.id !== null && l.estado === "ALTERADO";

/** O título da coluna, para os cabeçalhos montarem a lista de colunas. */
export const COLUNA_DE_JUSTIFICATIVA = "Justificativa";

/**
 * A justificativa de uma alteração — lida e escrita na mesma célula.
 *
 * Três estados, e nenhum deles é decorativo:
 *
 * - **sem `change.id`** (a linha "sem alteração", que o alternador traz): não há
 *   o que justificar, e a célula fica vazia;
 * - **sem texto**: um botão "Justificar", porque a pendência é a informação;
 * - **com texto**: o texto, clicável para reescrever. Gravar de novo não edita a
 *   anterior — o histórico é o que torna a justificativa auditável —, e por isso
 *   o diálogo abre com o que está gravado à vista, dizendo o que vai substituir.
 *
 * **Só a linha alterada ganha botão.** Um conflito ou um dado incompleto é a
 * recusa do motor em afirmar que houve alteração, e o que ele pede é o conserto
 * do dado, não uma explicação. O texto já gravado numa dessas linhas continua à
 * vista, só de leitura, porque apagá-lo da tela seria esconder o histórico.
 *
 * Sem `onJustificar` a célula é só de leitura: é o que mantém a tabela usável
 * onde justificar não faz sentido, sem um botão que não grava.
 */
export function CelulaDeJustificativa({
  linha: l,
  justificativa,
  onJustificar,
}: {
  linha: LinhaJustificavel;
  justificativa: Justificativa | undefined;
  onJustificar?: AbrirJustificativa;
}) {
  /* Nem toda linha é justificável: ver o cabeçalho. A que não é não escreve
     "Sem justificativa" — não há pendência ali para ser cobrada. */
  if (l.id === null) return null;
  const alterada = l.estado === "ALTERADO";
  const abrir = alterada ? onJustificar : undefined;
  const veiculo = l.entityLabel ?? "veículo sem placa";

  if (!justificativa) {
    if (!alterada) return null;
    if (!abrir) return <span className="text-muted-foreground/70">Sem justificativa</span>;
    return (
      <button
        type="button"
        onClick={(e) => {
          /* A linha inteira costuma abrir o detalhe; este clique é da célula. */
          e.stopPropagation();
          abrir([alvoDaLinha(l)]);
        }}
        aria-label={`Justificar ${l.rotuloDaVariavel} de ${veiculo}`}
        className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[0.7rem] font-semibold hover:bg-muted"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
        Justificar
      </button>
    );
  }

  const texto = (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block max-w-[16rem] truncate text-left">{justificativa.texto}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm text-xs">
        {justificativa.texto}
        <span className="mt-1 block text-muted-foreground">{justificativa.criadoPor}</span>
      </TooltipContent>
    </Tooltip>
  );

  if (!abrir) return texto;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        abrir([alvoDaLinha(l)], justificativa);
      }}
      aria-label={`Reescrever a justificativa de ${l.rotuloDaVariavel} de ${veiculo}`}
      className="max-w-full text-left underline decoration-dotted underline-offset-2 hover:text-foreground"
    >
      {texto}
    </button>
  );
}
