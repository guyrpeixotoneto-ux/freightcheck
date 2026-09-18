import { TriangleAlert } from "lucide-react";
import type { LinhaDeIpva } from "@workspace/comparison/ipva";
import { VARIAVEIS_DE_DETALHE_DE_IPVA } from "@workspace/comparison/ipva";
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
  escreverAliquota,
  escreverDiferenca,
  escreverValor,
  escreverVariacao,
  temValorNegativo,
} from "@/lib/ipva";

const ROTULO_DO_TIPO: Record<string, string> = { CAVALO: "Cavalo", CARRETA: "Carreta" };

/**
 * Um valor absoluto, sem o sinal que a frase já diz.
 *
 * `escreverDiferenca` carimba o sinal de propósito — numa coluna de números ele
 * é a única coisa que separa uma alta de uma queda. Na frase, a direção já está
 * na palavra, e o sinal volta como contradição: "o IPVA desceu +R$ 1.570,00" foi
 * o defeito que a tela de FINAME mostrou na primeira renderização sobre dado
 * real, e é o mesmo risco aqui.
 */
function semSinal(texto: string): string {
  return texto.replace(/^[+−-]/, "");
}

/** Uma frase que já termina em pontuação não ganha outro ponto. */
function comPonto(frase: string): string {
  return /[.!?…]$/.test(frase.trim()) ? frase.trim() : `${frase.trim()}.`;
}

/** Texto do acervo virando número; nulo e lixo continuam nulos, nunca zero. */
function numero(valor: string | null): number | null {
  if (valor === null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * A alíquota implícita deste veículo numa das pontas — ou `null`.
 *
 * `null` quando falta o IPVA, falta a nota, ou a nota é zero. Nenhum dos três
 * vira 0%: uma nota em branco tratada como zero produziria uma divisão inválida
 * ou uma alíquota inventada, e o número inventado é o que esta tela existe para
 * não mostrar.
 */
export function aliquotaDaPonta(
  ipva: number | null,
  valorNf: number | null,
): number | null {
  if (ipva === null || valorNf === null || valorNf === 0) return null;
  return (ipva / valorNf) * 100;
}

/**
 * Frases determinísticas sobre o que mudou neste veículo.
 *
 * Regras, não modelo de linguagem: cada frase é uma leitura direta dos deltas
 * que o motor já gravou, ou uma divisão entre dois valores que vieram no mesmo
 * par de linhas. Uma frase gerada seria a única coisa nesta tela sem lastro — e
 * a primeira a ser citada numa reunião.
 *
 * **A frase da alíquota vem colada na do IPVA**, quando a nota está nas duas
 * pontas, porque é ela que responde à pergunta seguinte. "O IPVA caiu R$
 * 1.570,00" não diz se o veículo ficou mais barato ou se o critério mudou; "de
 * 1,000% para 0,651% da nota" diz. Foi a diferença entre ler uma queda de R$ 720
 * mil como economia e lê-la como troca de fórmula.
 */
export function diagnosticoDoVeiculo(linhas: readonly LinhaDeIpva[]): string[] {
  const frases: string[] = [];
  const por = (chave: string) => linhas.find((l) => l.variavel === chave);

  const ipva = por("ipva");
  const nota = por("valor_nf");

  if (ipva?.diferenca != null && ipva.diferenca !== 0) {
    const direcao = ipva.diferenca > 0 ? "subiu" : "desceu";
    let frase = `O IPVA ${direcao} ${semSinal(
      escreverDiferenca(Math.abs(ipva.diferenca), "DINHEIRO"),
    )} (${escreverVariacao(ipva.variacao)})`;

    const antes = aliquotaDaPonta(numero(ipva.base), numero(nota?.base ?? null));
    const depois = aliquotaDaPonta(numero(ipva.comparada), numero(nota?.comparada ?? null));
    if (antes !== null && depois !== null) {
      frase += `, de ${escreverAliquota(antes)} para ${escreverAliquota(depois)} do valor de nota`;
    }
    frases.push(comPonto(frase));
  }

  /*
    A nota que se move sozinha é um caso próprio, e não um detalhe: o tributo
    ficou igual em reais e a alíquota mudou, ou o contrário. Sem esta frase, um
    veículo cuja nota foi corrigida apareceria como "nada mudou no IPVA" — que é
    verdade em reais e falso como conferência.
  */
  if (
    nota?.diferenca != null &&
    nota.diferenca !== 0 &&
    (ipva?.diferenca == null || ipva.diferenca === 0)
  ) {
    const antes = aliquotaDaPonta(numero(ipva?.base ?? null), numero(nota.base));
    const depois = aliquotaDaPonta(numero(ipva?.comparada ?? null), numero(nota.comparada));
    let frase = `O valor de nota ${nota.diferenca > 0 ? "subiu" : "caiu"} ${semSinal(
      escreverDiferenca(Math.abs(nota.diferenca), "DINHEIRO"),
    )} sem que o IPVA em reais mudasse`;
    if (antes !== null && depois !== null) {
      frase += `, então a alíquota implícita foi de ${escreverAliquota(
        antes,
      )} para ${escreverAliquota(depois)}`;
    }
    frases.push(comPonto(frase));
  }

  for (const l of linhas) {
    if (!temValorNegativo(l)) continue;
    frases.push(
      comPonto(
        `${l.rotuloDaVariavel} tem valor negativo em uma das pontas — ou é estorno, ou é erro ` +
          "de cadastro, e nos dois casos entra na soma",
      ),
    );
  }

  for (const l of linhas) {
    if (!l.foraDaSoma || l.estado !== "ALTERADO") continue;
    frases.push(comPonto(`${l.rotuloDaVariavel} mudou, e não entra em soma nenhuma`));
  }

  const incomparaveis = linhas.filter(
    (l) => l.estado === "CONFLITO" || l.estado === "DADO_INCOMPLETO",
  );
  for (const l of incomparaveis) {
    frases.push(comPonto(`${l.rotuloDaVariavel}: ${l.motivo ?? ROTULO_DO_ESTADO[l.estado]}`));
  }

  if (frases.length === 0) {
    frases.push("Nenhuma variável de IPVA se moveu neste veículo entre as duas vigências.");
  }
  return frases;
}

const CHAVES_DE_DETALHE = new Set(VARIAVEIS_DE_DETALHE_DE_IPVA.map((v) => v.chave));

/**
 * O detalhe de um veículo — as variáveis lado a lado, na mesma gaveta.
 *
 * Recebe as linhas que a comparação já trouxe para aquele veículo; não faz uma
 * segunda consulta e não recalcula nada além da alíquota, que é uma divisão
 * entre dois valores que já estão à mão.
 */
export function DetalheDoVeiculo({
  veiculo,
  linhas,
  rotuloBase,
  rotuloComparada,
  onFechar,
}: {
  veiculo: { entityLabel: string | null; entityType: string } | null;
  linhas: LinhaDeIpva[];
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
              Regras determinísticas sobre os deltas gravados pelo motor, e a alíquota como
              divisão direta entre o IPVA e o valor de nota do próprio ativo.
            </p>
          </section>

          <section>
            <h3 className="text-sm font-bold">As variáveis, lado a lado</h3>
            <p className="mb-2 text-[0.7rem] text-muted-foreground">
              Só as variáveis que se moveram. Para ver a frota inteira — inclusive as placas
              que chegaram iguais nas duas vigências —, ligue “Comparar % alíquotas” na
              tabela.
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
              <h3 className="mb-2 text-sm font-bold">Só no detalhe, e fora de toda soma</h3>
              <ul className="flex flex-col gap-2 text-sm">
                {soDetalhe.map((l, i) => (
                  <li key={`${l.variavel}-${i}`} className="flex flex-col gap-0.5">
                    <span className="flex flex-wrap items-baseline gap-2">
                      <span className="font-semibold">{l.rotuloDaVariavel}</span>
                      <span className="font-mono tabular-nums">
                        {escreverValor(l.base, l.medida)} → {escreverValor(l.comparada, l.medida)}
                      </span>
                      <span
                        className={cn(
                          "font-mono text-xs tabular-nums",
                          corDaDiferenca(l.diferenca, l.medida),
                        )}
                      >
                        {escreverDiferenca(l.diferenca, l.medida)}
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
              <span>
                <strong className="font-semibold">
                  O valor de nota está aqui para conferir o IPVA, não para somar com ele.
                </strong>{" "}
                Um é o preço de compra do ativo, o outro é o tributo sobre ele; os dois no mesmo
                total não seriam de rubrica nenhuma. Ano e data também não viram dinheiro, e a
                coluna “mensal” da carreta fica fora de toda soma porque não é 1/12 da anual.
              </span>
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
