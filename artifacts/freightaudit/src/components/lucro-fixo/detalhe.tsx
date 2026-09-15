import { TriangleAlert } from "lucide-react";
import type { LinhaDeLucroFixo } from "@workspace/comparison/lucro-fixo";
import { VARIAVEIS_DE_DETALHE_DE_LUCRO_FIXO } from "@workspace/comparison/lucro-fixo";
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
} from "@/lib/lucro-fixo";

const ROTULO_DO_TIPO: Record<string, string> = { CAVALO: "Cavalo", CARRETA: "Carreta" };

/**
 * Um valor absoluto, sem o sinal que a frase já diz.
 *
 * `escreverDiferenca` carimba o sinal de propósito — numa coluna de números ele
 * é a única coisa que separa uma alta de uma queda. Na frase, a direção já está
 * na palavra, e o sinal volta como contradição.
 */
function semSinal(texto: string): string {
  return texto.replace(/^[+−-]/, "");
}

/** Uma frase que já termina em pontuação não ganha outro ponto. */
function comPonto(frase: string): string {
  return /[.!?…]$/.test(frase.trim()) ? frase.trim() : `${frase.trim()}.`;
}

/** Texto do acervo virando inteiro; branco e lixo continuam nulos, nunca zero. */
function inteiro(valor: string | null): number | null {
  if (valor === null || valor.trim() === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Frases determinísticas sobre o que mudou neste veículo.
 *
 * Regras, não modelo de linguagem: cada frase é uma leitura direta dos deltas
 * que o motor já gravou. Uma frase gerada seria a única coisa nesta tela sem
 * lastro — e a primeira a ser citada numa reunião.
 *
 * **A frase da virada de ciclo vem primeiro quando há uma**, e engole as outras
 * duas: quando um ativo termina de amortizar, o lucro fixo que entra e a
 * amortização que sai não são três notícias, são uma só contada por três
 * ângulos. Listá-las separadas faria o leitor procurar a relação que a tela já
 * conhece.
 */
export function diagnosticoDoVeiculo(linhas: readonly LinhaDeLucroFixo[]): string[] {
  const frases: string[] = [];
  const por = (chave: string) => linhas.find((l) => l.variavel === chave);

  const ciclo = por("ciclo");
  const lucro = por("lucro_fixo");
  const amortizacao = por("amortizacao");

  const de = inteiro(ciclo?.base ?? null);
  const para = inteiro(ciclo?.comparada ?? null);
  const virou = ciclo?.estado === "ALTERADO" && de !== null && para !== null && de !== para;

  if (virou && de === 1 && para === 2) {
    let frase = "Terminou de amortizar e entrou no segundo ciclo";
    if (amortizacao?.diferenca != null && amortizacao.diferenca !== 0) {
      frase += `: saíram ${semSinal(
        escreverDiferenca(Math.abs(amortizacao.diferenca), "DINHEIRO"),
      )} de amortização`;
    }
    if (lucro?.diferenca != null && lucro.diferenca !== 0) {
      frase += `${amortizacao?.diferenca ? " e entraram " : ": entraram "}${semSinal(
        escreverDiferenca(Math.abs(lucro.diferenca), "DINHEIRO"),
      )} de lucro fixo`;
    }
    frases.push(comPonto(frase));
  } else if (virou && de === 2 && para === 1) {
    frases.push(
      comPonto(
        "Voltou do segundo ciclo para o primeiro — um ativo não desamortiza, então ou houve " +
          "reclassificação, ou houve defeito de cadastro",
      ),
    );
  } else if (virou) {
    frases.push(comPonto(`O ciclo mudou de ${de} para ${para}`));
  }

  /*
    Sem virada, o lucro fixo que se move é a notícia por si só — e aí a direção
    importa: esta rubrica é receita, então subir é ganhar.
  */
  if (!virou && lucro?.diferenca != null && lucro.diferenca !== 0) {
    frases.push(
      comPonto(
        `O lucro fixo ${lucro.diferenca > 0 ? "subiu" : "caiu"} ${semSinal(
          escreverDiferenca(Math.abs(lucro.diferenca), "DINHEIRO"),
        )} (${escreverVariacao(lucro.variacao)}), sem troca de ciclo`,
      ),
    );
  }

  if (!virou && amortizacao?.diferenca != null && amortizacao.diferenca !== 0) {
    frases.push(
      comPonto(
        `A amortização ${amortizacao.diferenca > 0 ? "subiu" : "caiu"} ${semSinal(
          escreverDiferenca(Math.abs(amortizacao.diferenca), "DINHEIRO"),
        )}, e o ciclo continua o mesmo`,
      ),
    );
  }

  /*
    A coexistência, dita no detalhe do próprio ativo. É a mesma medição do painel
    da tela, olhada de perto: aqui não há como dizer "zero em 558", há como dizer
    "neste veículo, os dois".
  */
  const lucroFinal = Number(lucro?.comparada);
  const amortizacaoFinal = Number(amortizacao?.comparada);
  if (
    Number.isFinite(lucroFinal) &&
    Number.isFinite(amortizacaoFinal) &&
    lucroFinal > 0 &&
    amortizacaoFinal > 0
  ) {
    frases.push(
      comPonto(
        "Este ativo declara amortização e lucro fixo ao mesmo tempo — o acervo mede zero " +
          "coexistências em 558 linhas, então é para ser olhado",
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
    frases.push("Nenhuma variável de lucro fixo se moveu neste veículo entre as duas vigências.");
  }
  return frases;
}

const CHAVES_DE_DETALHE = new Set(VARIAVEIS_DE_DETALHE_DE_LUCRO_FIXO.map((v) => v.chave));

/**
 * O detalhe de um veículo — as variáveis lado a lado, na mesma gaveta.
 *
 * Recebe as linhas que a comparação já trouxe para aquele veículo; não faz uma
 * segunda consulta e não recalcula nada.
 */
export function DetalheDoVeiculo({
  veiculo,
  linhas,
  rotuloBase,
  rotuloComparada,
  onFechar,
}: {
  veiculo: { entityLabel: string | null; entityType: string } | null;
  linhas: LinhaDeLucroFixo[];
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
              Só as variáveis que se moveram. Ligue “Mostrar veículos sem alteração” na tabela
              para ver também as que chegaram iguais nas duas vigências.
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
                  A amortização está aqui para explicar o lucro fixo, não para somar com ele.
                </strong>{" "}
                Uma é custo e o outro é receita; no mesmo total, o número não é de lado nenhum da
                DRE. O ciclo e o ano também não viram dinheiro, e a coluna do conjunto fica fora
                de toda soma porque embute a parcela do cavalo vinculado.
              </span>
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
