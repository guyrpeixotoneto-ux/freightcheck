import { TriangleAlert } from "lucide-react";
import type { LinhaDeFiname } from "@workspace/comparison/finame";
import { VARIAVEIS_DE_DETALHE } from "@workspace/comparison/finame";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  ROTULO_DO_ESTADO,
  SELO_DO_ESTADO,
  corDaDiferenca,
  escreverDiferenca,
  escreverValor,
  escreverVariacao,
} from "@/lib/finame";

const ROTULO_DO_TIPO: Record<string, string> = { CAVALO: "Cavalo", CARRETA: "Carreta" };

/**
 * Um valor absoluto, sem o sinal que a frase já diz.
 *
 * `escreverDiferenca` carimba o sinal de propósito — numa coluna de números ele
 * é a única coisa que separa uma alta de uma queda. Na frase, a direção já está
 * na palavra, e o sinal volta como contradição: "a parcela desceu +R$ 5.169,50"
 * foi o que a primeira renderização mostrou.
 */
function semSinal(texto: string): string {
  return texto.replace(/^[+−-]/, "");
}

/** Uma frase que já termina em pontuação não ganha outro ponto. */
function comPonto(frase: string): string {
  return /[.!?…]$/.test(frase.trim()) ? frase.trim() : `${frase.trim()}.`;
}

/**
 * Frases determinísticas sobre o que mudou neste veículo.
 *
 * Regras, não modelo de linguagem: cada frase é uma leitura direta dos deltas
 * que o motor já gravou. Uma frase gerada seria a única coisa nesta tela sem
 * lastro — e a primeira a ser citada numa reunião.
 *
 * A frase da parcela e a das partes dela vêm juntas quando as duas se moveram,
 * porque é assim que a conta fecha na cabeça de quem lê: a parcela subiu 310, e
 * 121,40 disso é juro.
 */
export function diagnosticoDoVeiculo(linhas: readonly LinhaDeFiname[]): string[] {
  const frases: string[] = [];
  const por = (chave: string) => linhas.find((l) => l.variavel === chave);

  const parcela = por("parcela");
  if (parcela?.diferenca != null && parcela.diferenca !== 0) {
    const juros = por("juros");
    const direcao = parcela.diferenca > 0 ? "subiu" : "desceu";
    let frase = `A parcela ${direcao} ${semSinal(
      escreverDiferenca(Math.abs(parcela.diferenca), "DINHEIRO"),
    )} (${escreverVariacao(parcela.variacao)})`;
    if (juros?.diferenca != null && juros.diferenca !== 0) {
      frase += `, e os juros respondem por ${semSinal(
        escreverDiferenca(Math.abs(juros.diferenca), "DINHEIRO"),
      )} dela`;
    }
    frases.push(comPonto(frase));
  }

  const taxa = por("taxa");
  if (taxa?.diferenca != null && taxa.diferenca !== 0) {
    frases.push(
      `A taxa ${taxa.diferenca > 0 ? "subiu" : "caiu"} ${semSinal(
        escreverDiferenca(Math.abs(taxa.diferenca), "PERCENTUAL"),
      )} — de ${escreverValor(taxa.base, "PERCENTUAL")} para ${escreverValor(
        taxa.comparada,
        "PERCENTUAL",
      )}.`,
    );
  }

  const prazo = por("prazo");
  if (prazo?.diferenca != null && prazo.diferenca !== 0) {
    frases.push(
      `O prazo ${prazo.diferenca > 0 ? "aumentou" : "encurtou"} ${semSinal(
        escreverDiferenca(Math.abs(prazo.diferenca), "MESES"),
      )}.`,
    );
  }

  const incomparaveis = linhas.filter(
    (l) => l.estado === "CONFLITO" || l.estado === "DADO_INCOMPLETO",
  );
  for (const l of incomparaveis) {
    frases.push(comPonto(`${l.rotuloDaVariavel}: ${l.motivo ?? ROTULO_DO_ESTADO[l.estado]}`));
  }

  if (frases.length === 0) {
    frases.push("Nenhuma variável de FINAME se moveu neste veículo entre as duas vigências.");
  }
  return frases;
}

const CHAVES_DE_DETALHE = new Set(VARIAVEIS_DE_DETALHE.map((v) => v.chave));

/**
 * O detalhe de um veículo — as variáveis lado a lado, na mesma gaveta.
 *
 * Recebe as linhas que a comparação já trouxe para aquele veículo; não faz uma
 * segunda consulta e não recalcula nada. O total composto da carreta aparece
 * aqui, dito por extenso, e continua fora de toda soma.
 */
export function DetalheDoVeiculo({
  veiculo,
  linhas,
  rotuloBase,
  rotuloComparada,
  onFechar,
}: {
  veiculo: { entityLabel: string | null; entityType: string } | null;
  linhas: LinhaDeFiname[];
  rotuloBase: string;
  rotuloComparada: string;
  onFechar: () => void;
}) {
  if (!veiculo) return null;
  const doVeiculo = linhas.filter(
    (l) => l.entityLabel === veiculo.entityLabel && l.entityType === veiculo.entityType,
  );
  const naTabela = doVeiculo.filter((l) => !CHAVES_DE_DETALHE.has(l.variavel));
  const soDetalhe = doVeiculo.filter((l) => CHAVES_DE_DETALHE.has(l.variavel));
  const frases = diagnosticoDoVeiculo(doVeiculo);

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
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
              {frases.map((frase) => (
                <li key={frase}>{frase}</li>
              ))}
            </ul>
            <p className="mt-2 text-[0.7rem] text-muted-foreground">
              Regras determinísticas sobre os deltas gravados pelo motor.
            </p>
          </section>

          <section>
            <h3 className="text-sm font-bold">As variáveis, lado a lado</h3>
            <p className="mb-2 text-[0.7rem] text-muted-foreground">
              Só as variáveis que se moveram. Ligue “Mostrar veículos sem alteração” na
              tabela para ver também as que chegaram iguais nas duas vigências.
            </p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[30rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
                    <th scope="col" className="px-3 py-2 text-left font-bold">Variável</th>
                    <th scope="col" className="px-3 py-2 text-right font-bold">De</th>
                    <th scope="col" className="px-3 py-2 text-right font-bold">Para</th>
                    <th scope="col" className="px-3 py-2 text-right font-bold">Δ</th>
                    <th scope="col" className="px-3 py-2 text-left font-bold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {naTabela.map((l, i) => (
                    <tr key={`${l.variavel}-${i}`} className="border-b last:border-0">
                      <td className="px-3 py-1.5">{l.rotuloDaVariavel}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                        {escreverValor(l.base, l.medida)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                        {escreverValor(l.comparada, l.medida)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-1.5 text-right font-mono tabular-nums",
                          corDaDiferenca(l.diferenca, l.medida),
                        )}
                      >
                        {escreverVariacao(l.variacao)}
                      </td>
                      <td className="px-3 py-1.5">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-[0.7rem] font-semibold",
                            SELO_DO_ESTADO[l.estado],
                          )}
                        >
                          {ROTULO_DO_ESTADO[l.estado]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {soDetalhe.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-bold">Só no detalhe</h3>
              <ul className="flex flex-col gap-2 text-sm">
                {soDetalhe.map((l, i) => (
                  <li key={`${l.variavel}-${i}`} className="flex flex-wrap items-baseline gap-2">
                    <span className="font-semibold">{l.rotuloDaVariavel}</span>
                    <span className="font-mono tabular-nums">
                      {escreverValor(l.base, l.medida)} → {escreverValor(l.comparada, l.medida)}
                    </span>
                    <span className={cn("font-mono text-xs tabular-nums", corDaDiferenca(l.diferenca, l.medida))}>
                      {escreverDiferenca(l.diferenca, l.medida)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-r-lg border-l-[3px] border-warning bg-warning/10 px-3 py-2.5 text-xs">
            <p className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
              <span>
                <strong className="font-semibold">
                  Taxa, prazo, carência, ano e data não viram dinheiro.
                </strong>{" "}
                A semântica confirmada não os declara monetários e somáveis, então eles não
                entram no impacto — aparecem na própria unidade, nunca convertidos em reais.
                O total composto da carreta também fica fora de toda soma.
              </span>
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
