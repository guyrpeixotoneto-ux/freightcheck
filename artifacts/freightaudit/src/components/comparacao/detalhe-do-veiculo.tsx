import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import type { LinhaAgrupavel } from "@workspace/comparison/agrupamento-por-veiculo";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { EscritaDaRubrica } from "@/components/comparacao/tabela-por-veiculo";

/**
 * A GAVETA DE DETALHE DE UM VEÍCULO — a mesma nas auditorias de rubrica.
 *
 * ---------------------------------------------------------------------------
 * O que ela mostra, e em que ordem
 * ---------------------------------------------------------------------------
 * **O diagnóstico primeiro.** Quem abre a gaveta já viu os números na tabela; o
 * que falta é a frase que os liga — "a amortização zerou e o contrato terminou
 * em março" diz numa linha o que três colunas deixam para o leitor deduzir. As
 * frases vêm prontas da rubrica, e são determinísticas: regras sobre os deltas
 * que o motor já gravou, nunca texto gerado.
 *
 * **As variáveis da tabela depois**, lado a lado. É a mesma lista da expansão,
 * repetida aqui porque a gaveta também se abre de outros lugares.
 *
 * **As do detalhe por último**, com o motivo de estarem fora da soma escrito
 * embaixo de cada uma. São elas que justificam a gaveta existir: a coluna que
 * não soma não cabe na tabela e não pode sumir do produto.
 *
 * ---------------------------------------------------------------------------
 * Por que uma gaveta, e não uma por rubrica
 * ---------------------------------------------------------------------------
 * Porque a estrutura é a mesma nas seis telas, e o que muda — como se escreve um
 * valor, qual é a cor de uma queda, quais variáveis são "só do detalhe" e o que
 * o aviso do rodapé diz — já viaja em {@link EscritaDaRubrica}, que a tabela por
 * veículo também usa. Duas descrições do mesmo vocabulário, uma na tabela e
 * outra na gaveta, é como a mesma placa passa a ser lida de dois jeitos na mesma
 * tela.
 *
 * As quatro auditorias mais antigas — FINAME, IPVA, Lucro Fixo e Impostos —
 * ainda têm gaveta própria, porque cada uma carrega uma seção que só ela tem (a
 * tabela de alíquotas do IPVA, as viradas de ciclo do lucro fixo). Migrá-las é
 * uma mudança à parte, e a `secaoExtra` abaixo é o encaixe que ela vai usar.
 */

const ROTULO_DO_TIPO: Record<string, string> = { CAVALO: "Cavalo", CARRETA: "Carreta" };

/** O que a rubrica diz sobre si para a gaveta, além do que a tabela já pede. */
export interface DetalheDaRubrica<L> {
  /**
   * As frases do diagnóstico, na ordem em que a gaveta as lê.
   *
   * Determinísticas, sobre os deltas que o motor gravou — e nunca texto gerado.
   * Lista vazia é resposta válida: a placa em que nada se moveu não tem
   * diagnóstico, e inventar uma frase para ela seria ruído com cara de achado.
   */
  diagnostico: (linhas: readonly L[]) => string[];
  /** A nota de rodapé do diagnóstico — de onde as frases saem. */
  notaDoDiagnostico: string;
  /** As chaves de variável que só aparecem na seção de baixo. */
  chavesDeDetalhe: readonly string[];
  /** O aviso âmbar do rodapé — o que não se soma nesta rubrica, e por quê. */
  aviso: ReactNode;
  /** Uma seção a mais, entre o diagnóstico e a tabela. Opcional. */
  secaoExtra?: (linhas: readonly L[]) => ReactNode;
}

export function DetalheDoVeiculo<
  L extends LinhaAgrupavel & {
    id: number | null;
    rotuloDaVariavel: string;
    motivo: string | null;
    foraDaSoma: string | null;
    attributeCode: string | null;
  },
>({
  veiculo,
  linhas,
  escrita,
  detalhe,
  rotuloBase,
  rotuloComparada,
  onFechar,
}: {
  veiculo: { entityLabel: string | null; entityType: string } | null;
  linhas: readonly L[];
  escrita: EscritaDaRubrica<L, never>;
  detalhe: DetalheDaRubrica<L>;
  rotuloBase: string;
  rotuloComparada: string;
  onFechar: () => void;
}) {
  if (!veiculo) return null;

  const doVeiculo = linhas.filter(
    (l) => l.entityLabel === veiculo.entityLabel && l.entityType === veiculo.entityType,
  );
  const chaves = new Set(detalhe.chavesDeDetalhe);
  const naTabela = doVeiculo.filter((l) => !chaves.has(l.variavel));
  const soDetalhe = doVeiculo.filter((l) => chaves.has(l.variavel));
  const frases = detalhe.diagnostico(doVeiculo);

  return (
    <Sheet open onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2 font-mono">
            {veiculo.entityLabel ?? "Veículo sem placa"}
            <span className="rounded-full bg-brand/10 px-2.5 py-0.5 font-sans text-xs font-semibold text-brand">
              {ROTULO_DO_TIPO[veiculo.entityType] ?? veiculo.entityType}
            </span>
          </SheetTitle>
          <SheetDescription>
            {rotuloBase} → {rotuloComparada}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 flex flex-col gap-5">
          <section>
            <h3 className="mb-2 text-sm font-bold">Diagnóstico</h3>
            {frases.length === 0 ? (
              /* Nada se moveu nesta placa — e dizer isso é melhor do que uma
                 lista vazia, que se parece com uma falha de carregamento. */
              <p className="text-sm text-muted-foreground">
                Nenhuma variável desta rubrica se moveu neste veículo entre as duas vigências.
              </p>
            ) : (
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
                {frases.map((frase) => (
                  <li key={frase}>{frase}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[0.7rem] text-muted-foreground">
              {detalhe.notaDoDiagnostico}
            </p>
          </section>

          {detalhe.secaoExtra?.(doVeiculo)}

          <section>
            <h3 className="text-sm font-bold">As variáveis, lado a lado</h3>
            <p className="mb-2 text-[0.7rem] text-muted-foreground">
              Só as variáveis que se moveram. Ligue “Mostrar veículos sem alteração” na tabela
              para ver também as que chegaram iguais nas duas vigências.
            </p>
            {naTabela.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[30rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
                      <th scope="col" className="px-3 py-2 text-left font-bold">
                        Variável
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-bold">
                        De
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-bold">
                        Para
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-bold">
                        Δ
                      </th>
                      <th scope="col" className="px-3 py-2 text-left font-bold">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {naTabela.map((l, i) => (
                      <tr key={`${l.variavel}-${i}`} className="border-b last:border-0">
                        <td className="px-3 py-1.5">{l.rotuloDaVariavel}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                          {escrita.escreverValor(l.base, l.medida)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                          {escrita.escreverValor(l.comparada, l.medida)}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-1.5 text-right font-mono tabular-nums",
                            escrita.corDaDiferenca(l.diferenca, l.medida),
                          )}
                        >
                          {escrita.escreverDiferenca(l.diferenca, l.medida)}
                        </td>
                        <td className="px-3 py-1.5">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-[0.7rem] font-semibold",
                              escrita.selo[l.estado],
                            )}
                          >
                            {escrita.rotuloDoEstado[l.estado]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {soDetalhe.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-bold">Só no detalhe, e fora de toda soma</h3>
              <ul className="flex flex-col gap-2 text-sm">
                {soDetalhe.map((l, i) => (
                  <li key={`${l.variavel}-${i}`} className="flex flex-col gap-0.5">
                    <span className="flex flex-wrap items-baseline gap-2">
                      <span className="font-semibold">{l.rotuloDaVariavel}</span>
                      <span className="font-mono tabular-nums">
                        {escrita.escreverValor(l.base, l.medida)} →{" "}
                        {escrita.escreverValor(l.comparada, l.medida)}
                      </span>
                      <span
                        className={cn(
                          "font-mono text-xs tabular-nums",
                          escrita.corDaDiferenca(l.diferenca, l.medida),
                        )}
                      >
                        {escrita.escreverDiferenca(l.diferenca, l.medida)}
                      </span>
                    </span>
                    {l.foraDaSoma && (
                      <span className="text-[0.7rem] text-muted-foreground">{l.foraDaSoma}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-r-lg border-l-[3px] border-warning bg-warning/10 px-3 py-2.5 text-xs">
            <p className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
              <span>{detalhe.aviso}</span>
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
