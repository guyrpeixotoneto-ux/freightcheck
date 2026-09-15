import { TriangleAlert } from "lucide-react";
import type { LinhaDeImpostos } from "@workspace/comparison/impostos";
import {
  aliquotaMedida,
  conferenciaDoAtivo,
  VARIAVEIS_DE_DETALHE_DE_IMPOSTOS,
} from "@workspace/comparison/impostos";
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
  ROTULO_DO_TRIBUTO,
  SELO_DO_ESTADO,
  corDaDiferenca,
  escreverAliquota,
  escreverDiferenca,
  escreverValor,
  escreverVariacao,
} from "@/lib/impostos";

const ROTULO_DO_TIPO: Record<string, string> = { CAVALO: "Cavalo", CARRETA: "Carreta" };

/**
 * Um valor absoluto, sem o sinal que a frase já diz.
 *
 * `escreverDiferenca` carimba o sinal de propósito — numa coluna de números ele
 * é a única coisa que separa uma alta de uma queda. Na frase, a direção já está
 * na palavra, e o sinal volta como contradição: "o PIS/COFINS desceu +R$ 1.000"
 * foi o defeito que a tela de FINAME mostrou na primeira renderização sobre dado
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
 * Frases determinísticas sobre o que mudou neste veículo.
 *
 * Regras, não modelo de linguagem: cada frase é uma leitura direta dos deltas
 * que o motor já gravou, ou uma divisão entre dois valores que vieram no mesmo
 * par de linhas. Uma frase gerada seria a única coisa nesta tela sem lastro — e
 * a primeira a ser citada numa reunião.
 *
 * **A ordem das frases é a ordem da pergunta**, e não a ordem das colunas:
 *
 * 1. **A conferência**, que é o que esta tela existe para dizer: a taxa que o
 *    ativo declara contra a que o dinheiro dele revela. Ela vem primeiro porque
 *    é a única frase que vale mesmo quando nada mudou entre as vigências — e,
 *    nesta rubrica, nada mudar é o caso comum.
 * 2. **O montante que se moveu**, com a alíquota medida dos dois lados: "o
 *    PIS/COFINS subiu R$ 1.000" não diz se o ativo ficou mais caro ou se o
 *    critério mudou; "de 9,250% para 9,500% da nota" diz.
 * 3. **A taxa que se moveu sem o dinheiro se mover**, que é o achado que só esta
 *    tela enxerga: uma alíquota declarada que muda sozinha é ou uma taxa que
 *    ninguém aplicou, ou um montante que ficou para trás.
 * 4. **A nota que se moveu sozinha**, que muda a alíquota sem mudar um centavo
 *    do tributo.
 * 5. O que o motor recusou comparar, com a frase dele.
 */
export function diagnosticoDoVeiculo(linhas: readonly LinhaDeImpostos[]): string[] {
  const frases: string[] = [];
  const por = (chave: string) => linhas.find((l) => l.variavel === chave);

  const nota = por("valor_nf");
  const notaBase = numero(nota?.base ?? null);
  const notaComparada = numero(nota?.comparada ?? null);

  const tributos = [
    {
      rotulo: ROTULO_DO_TRIBUTO.PIS_COFINS,
      montante: por("pis_cofins"),
      declarada: por("percentual_pis_cofins"),
    },
    {
      rotulo: ROTULO_DO_TRIBUTO.ICMS,
      montante: por("icms"),
      declarada: por("percentual_icms"),
    },
  ];

  /* 1. A conferência, na ponta comparada — a leitura que vale sem nada ter mudado. */
  for (const { rotulo, montante, declarada } of tributos) {
    if (!montante && !declarada) continue;
    const valor = numero(montante?.comparada ?? null);
    const taxa = numero(declarada?.comparada ?? null);
    const conferido = conferenciaDoAtivo(valor, notaComparada, taxa);

    if (conferido) {
      frases.push(
        comPonto(
          conferido.divergem
            ? `${rotulo}: a alíquota declarada é ${escreverAliquota(
                conferido.declarada,
              )} e a medida sobre a nota é ${escreverAliquota(
                conferido.medida,
              )} — distância de ${escreverAliquota(conferido.distancia)}`
            : `${rotulo}: a alíquota declarada (${escreverAliquota(
                conferido.declarada,
              )}) confere com a medida sobre a nota (${escreverAliquota(conferido.medida)})`,
        ),
      );
      continue;
    }

    /*
      Taxa declarada sem um centavo de montante é o estado do ICMS no acervo
      inteiro — 1.215 linhas zeradas. Dizer "0% de imposto" ali seria afirmar uma
      isenção que ninguém declarou; o que há é uma coluna que ninguém preencheu.
    */
    if (taxa !== null && (valor === null || valor === 0)) {
      frases.push(
        comPonto(
          `${rotulo}: a alíquota declarada é ${escreverAliquota(taxa)} e o montante ` +
            `correspondente ${valor === 0 ? "vem zerado" : "não vem no acervo"} — ` +
            "alíquota sem montante não é imposto zero, é coluna sem dado",
        ),
      );
    }
  }

  /* 2. O montante que se moveu, com a alíquota medida dos dois lados. */
  for (const { rotulo, montante } of tributos) {
    if (montante?.diferenca == null || montante.diferenca === 0) continue;
    const direcao = montante.diferenca > 0 ? "subiu" : "desceu";
    let frase = `O ${rotulo} ${direcao} ${semSinal(
      escreverDiferenca(Math.abs(montante.diferenca), "DINHEIRO"),
    )} (${escreverVariacao(montante.variacao)})`;

    const antes = aliquotaDaPonta(numero(montante.base), notaBase);
    const depois = aliquotaDaPonta(numero(montante.comparada), notaComparada);
    if (antes !== null && depois !== null) {
      frase += `, de ${escreverAliquota(antes)} para ${escreverAliquota(depois)} do valor de nota`;
    }
    frases.push(comPonto(frase));
  }

  /* 3. A taxa que se moveu sem o dinheiro se mover. */
  for (const { rotulo, montante, declarada } of tributos) {
    if (declarada?.diferenca == null || declarada.diferenca === 0) continue;
    const dinheiroParado = montante?.diferenca == null || montante.diferenca === 0;
    frases.push(
      comPonto(
        `A alíquota declarada de ${rotulo} foi de ${escreverValor(
          declarada.base,
          "PERCENTUAL",
        )} para ${escreverValor(declarada.comparada, "PERCENTUAL")}` +
          (dinheiroParado
            ? " sem que o montante em reais mudasse — ou a taxa não foi aplicada, ou o montante ficou para trás"
            : ", ao lado do montante que também mudou"),
      ),
    );
  }

  /* 4. A nota que se moveu sozinha. */
  const montantesParados = tributos.every(
    ({ montante }) => montante?.diferenca == null || montante.diferenca === 0,
  );
  if (nota?.diferenca != null && nota.diferenca !== 0 && montantesParados) {
    frases.push(
      comPonto(
        `O valor de nota ${nota.diferenca > 0 ? "subiu" : "caiu"} ${semSinal(
          escreverDiferenca(Math.abs(nota.diferenca), "DINHEIRO"),
        )} sem que nenhum montante de imposto mudasse — a base mudou, e as alíquotas ` +
          "medidas mudaram com ela",
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
    frases.push(
      "Nenhuma variável de imposto se moveu neste veículo, e o acervo não trouxe " +
        "alíquota nem montante com que conferir.",
    );
  }
  return frases;
}

/**
 * A alíquota medida deste veículo numa das pontas — ou `null`.
 *
 * A conta é a do núcleo (`aliquotaMedida`), e esta função existe só para que o
 * diagnóstico a leia com o nome da ponta. `null` quando falta o montante, quando
 * ele é zero, quando falta a nota ou quando a nota é zero: nenhum dos quatro vira
 * 0%, porque uma coluna em branco tratada como zero por cento é justamente o
 * número inventado que esta tela existe para não mostrar.
 */
export function aliquotaDaPonta(
  montante: number | null,
  valorNf: number | null,
): number | null {
  return aliquotaMedida(montante, valorNf);
}

const CHAVES_DE_DETALHE = new Set(VARIAVEIS_DE_DETALHE_DE_IMPOSTOS.map((v) => v.chave));

/**
 * O detalhe de um veículo — as variáveis lado a lado, na mesma gaveta.
 *
 * Recebe as linhas que a comparação já trouxe para aquele veículo; não faz uma
 * segunda consulta e não recalcula nada além da alíquota medida, que é uma
 * divisão entre dois valores que já estão à mão — e pela mesma função do núcleo
 * que a régua da frota usa.
 */
export function DetalheDoVeiculo({
  veiculo,
  linhas,
  rotuloBase,
  rotuloComparada,
  onFechar,
}: {
  veiculo: { entityLabel: string | null; entityType: string } | null;
  linhas: LinhaDeImpostos[];
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
              divisão direta entre o montante do tributo e o valor de nota do próprio ativo.
            </p>
          </section>

          <section>
            <h3 className="text-sm font-bold">As variáveis, lado a lado</h3>
            <p className="mb-2 text-[0.7rem] text-muted-foreground">
              Só as variáveis que se moveram. Ligue “Mostrar veículos sem alteração” na tabela
              para ver também as que chegaram iguais nas duas vigências — nesta rubrica, quase
              todas.
            </p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[32rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
                    <th scope="col" className="px-3 py-2 text-left font-bold">Variável</th>
                    <th scope="col" className="px-3 py-2 text-left font-bold">Tributo</th>
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
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">
                        {l.tributo ? ROTULO_DO_TRIBUTO[l.tributo] : "—"}
                      </td>
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
              <p className="mt-2 text-[0.7rem] text-muted-foreground">
                A carreta declara duas alíquotas de ICMS — a da entrada do implemento e a do
                parâmetro da região. Com o montante zerado, nenhuma medida diz qual delas foi
                aplicada, e a tela não escolhe por conta própria.
              </p>
            </section>
          )}

          <section className="rounded-r-lg border-l-[3px] border-warning bg-warning/10 px-3 py-2.5 text-xs">
            <p className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
              <span>
                <strong className="font-semibold">
                  Este é o imposto da compra do ativo, não o da prestação do mês.
                </strong>{" "}
                O PIS/COFINS aqui incide sobre a nota de compra — é grandeza de aquisição,
                PONTUAL, e nunca se soma com rubrica mensal. A dedução de PIS/COFINS e de
                ICMS/ISS sobre o frete mora na tabela de trecho, que não é a fonte que este
                banco apura hoje. Alíquota não soma com dinheiro, e o valor de nota está aqui
                para conferir o imposto, não para somar com ele.
              </span>
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
