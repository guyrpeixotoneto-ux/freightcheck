import { TriangleAlert } from "lucide-react";
import type { LinhaDeKm, ValorDeKm } from "@workspace/comparison/km-rodado";
import {
  COMPONENTES_DO_PRECO,
  conferenciaDoTrecho,
  ROTULO_DO_VEREDITO_DO_KM,
  VARIAVEIS_DE_DETALHE_DE_KM,
} from "@workspace/comparison/km-rodado";
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
  UNIDADE_DO_PAPEL,
  corDaDiferenca,
  escreverDiferenca,
  escreverKm,
  escreverValor,
  escreverVariacao,
} from "@/lib/km-rodado";

/**
 * Um valor absoluto, sem o sinal que a frase já diz.
 *
 * `escreverDiferenca` carimba o sinal de propósito — numa coluna de números ele
 * é a única coisa que separa uma alta de uma queda. Na frase, a direção já está
 * na palavra, e o sinal volta como contradição: "o preço desceu +0,07 R$/km" foi
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
 * As linhas de um trecho viram o valor de uma das pontas.
 *
 * Existe para que a gaveta chame **a mesma** `conferenciaDoTrecho` do núcleo que
 * a régua da vigência chama, em vez de reescrever as duas contas aqui. Uma
 * segunda cópia da regra divergiria da primeira no dia em que a tolerância
 * mudasse num lugar só — e a frase da gaveta passaria a contradizer o veredito
 * da tabela logo acima dela.
 */
export function valorDaPonta(
  linhas: readonly LinhaDeKm[],
  ponta: "BASE" | "COMPARADA",
): ValorDeKm {
  const de = (chave: string): number | null => {
    const linha = linhas.find((l) => l.variavel === chave);
    if (!linha) return null;
    return numero(ponta === "BASE" ? linha.base : linha.comparada);
  };
  const texto = (chave: string): string | null => {
    const linha = linhas.find((l) => l.variavel === chave);
    if (!linha) return null;
    return ponta === "BASE" ? linha.base : linha.comparada;
  };

  const razoes: Record<string, number | null> = {};
  const viagens: Record<string, number | null> = {};
  for (const c of COMPONENTES_DO_PRECO) {
    razoes[c.chave] = de(`reais_km_${c.chave}`);
    viagens[c.chave] = de(`reais_viagem_${c.chave}`);
  }

  return {
    ponta,
    entityLabel: linhas[0]?.entityLabel ?? null,
    origem: texto("origem"),
    destino: texto("destino"),
    kmCiclo: de("km_ciclo"),
    kmIda: de("km_ida"),
    kmVolta: de("km_volta"),
    viagensPrevistas: de("previsao_viagens"),
    razoes,
    viagens,
  };
}

/**
 * Frases determinísticas sobre o que mudou neste trecho.
 *
 * Regras, não modelo de linguagem: cada frase é uma leitura direta dos deltas
 * que o motor já gravou, ou uma das duas contas que o núcleo faz. Uma frase
 * gerada seria a única coisa nesta tela sem lastro — e a primeira a ser citada
 * numa reunião.
 *
 * **A ordem das frases é a ordem da pergunta**, e não a ordem das colunas:
 *
 * 1. **O preço do quilômetro**, somando só as parcelas que de fato se moveram —
 *    é a resposta à pergunta que traz alguém a esta tela.
 * 2. **A distância**, porque ela é o eixo: um R$/km parado sobre um ciclo que
 *    cresceu é mais dinheiro por viagem sem que nenhuma parcela tenha subido.
 * 3. **A conferência**, que vale mesmo quando nada mudou — ida mais volta tem de
 *    dar o ciclo, e `R$/viagem ÷ R$/km` tem de dar esse mesmo ciclo.
 * 4. O que o motor recusou comparar, com a frase dele.
 */
export function diagnosticoDoTrecho(linhas: readonly LinhaDeKm[]): string[] {
  const frases: string[] = [];

  /* 1. O preço do quilômetro, pelas parcelas que se moveram. */
  const razoesAlteradas = linhas.filter(
    (l) => l.papel === "RAZAO" && l.estado === "ALTERADO" && l.diferenca !== null,
  );
  if (razoesAlteradas.length > 0) {
    const delta = razoesAlteradas.reduce((acc, l) => acc + (l.diferenca ?? 0), 0);
    const direcao = delta > 0 ? "subiu" : delta < 0 ? "desceu" : "não se moveu no total";
    const quantas = `${razoesAlteradas.length} ${
      razoesAlteradas.length === 1 ? "parcela" : "parcelas"
    }`;
    frases.push(
      comPonto(
        delta === 0
          ? `${quantas} do preço por quilômetro mudaram e se anularam: o total ficou igual`
          : `O preço do quilômetro ${direcao} ${semSinal(
              escreverDiferenca(Math.abs(delta), "REAIS_POR_KM"),
            )}, somando ${quantas} que se ${razoesAlteradas.length === 1 ? "moveu" : "moveram"}`,
      ),
    );

    /*
      A maior parcela vem nomeada, e não como "a principal": quem lê precisa
      saber qual componente puxou o número, e é a única forma de a frase virar
      uma pergunta ao fornecedor em vez de um dado a mais.
    */
    const maior = [...razoesAlteradas].sort(
      (a, b) => Math.abs(b.diferenca ?? 0) - Math.abs(a.diferenca ?? 0),
    )[0];
    frases.push(
      comPonto(
        `A maior delas é ${maior.rotuloDaVariavel}: ${escreverValor(
          maior.base,
          maior.medida,
        )} → ${escreverValor(maior.comparada, maior.medida)} (${escreverVariacao(
          maior.variacao,
        )})`,
      ),
    );
  }

  /* 2. A distância, que é o eixo da rubrica. */
  const ciclo = linhas.find((l) => l.variavel === "km_ciclo");
  if (ciclo?.diferenca != null && ciclo.diferenca !== 0) {
    frases.push(
      comPonto(
        `O km do ciclo ${ciclo.diferenca > 0 ? "cresceu" : "encurtou"} ${semSinal(
          escreverDiferenca(Math.abs(ciclo.diferenca), "DISTANCIA"),
        )} (${escreverVariacao(ciclo.variacao)}) — o mesmo R$/km passa a valer sobre ` +
          "outra distância, e o custo por viagem muda sem que nenhuma parcela tenha mudado",
      ),
    );
  }

  /* 3. A conferência, na ponta comparada. */
  const conferencia = conferenciaDoTrecho(valorDaPonta(linhas, "COMPARADA"));
  if (conferencia.veredito === "CICLO_NAO_FECHA") {
    frases.push(
      comPonto(
        `Ida mais volta dá ${escreverKm(conferencia.kmDasPontas)} e o ciclo declara ` +
          `${escreverKm(conferencia.kmDeclarado)} — a própria linha discorda sobre a ` +
          "distância que ela cobra",
      ),
    );
  } else if (conferencia.veredito === "PRECO_USA_OUTRO_KM") {
    frases.push(
      comPonto(
        `O preço deste trecho foi montado sobre ${escreverKm(
          conferencia.kmImplicito,
        )}, e o ciclo declara ${escreverKm(conferencia.kmDeclarado)}: dividindo o ` +
          "R$/viagem pelo R$/km de cada componente, a distância que aparece não é a declarada",
      ),
    );
  } else if (conferencia.veredito === "CONFERE" && conferencia.componentesConferidos > 0) {
    frases.push(
      comPonto(
        `As duas contas fecham: ida mais volta dá o ciclo, e o R$/viagem dividido pelo ` +
          `R$/km devolve ${escreverKm(conferencia.kmImplicito)} em ` +
          `${conferencia.componentesConferidos} ${
            conferencia.componentesConferidos === 1 ? "componente" : "componentes"
          }`,
      ),
    );
  }
  if (conferencia.componentesDivergentes > 0 && conferencia.veredito === "CONFERE") {
    frases.push(
      comPonto(
        `${conferencia.componentesDivergentes} ${
          conferencia.componentesDivergentes === 1 ? "componente aponta" : "componentes apontam"
        } uma distância diferente da do ciclo, contra a maioria que aponta a declarada`,
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
      "Nenhuma variável de km rodado se moveu neste trecho, e a comparação não trouxe " +
        "distância nem R$/viagem com que conferir o km. Ligue “Mostrar trechos sem " +
        "alteração” para ler as duas contas deste trecho.",
    );
  }
  return frases;
}

const CHAVES_DE_DETALHE = new Set(VARIAVEIS_DE_DETALHE_DE_KM.map((v) => v.chave));

/**
 * O detalhe de um trecho — as variáveis lado a lado, na mesma gaveta.
 *
 * Recebe as linhas que a comparação já trouxe para aquele trecho; não faz uma
 * segunda consulta e não recalcula nada: as duas contas do km saem da mesma
 * função do núcleo que a régua da vigência usa.
 */
export function DetalheDoTrecho({
  trecho,
  linhas,
  rotuloBase,
  rotuloComparada,
  onFechar,
}: {
  trecho: { entityLabel: string | null } | null;
  linhas: LinhaDeKm[];
  rotuloBase: string;
  rotuloComparada: string;
  onFechar: () => void;
}) {
  if (!trecho) return null;
  const doTrecho = linhas.filter((l) => l.entityLabel === trecho.entityLabel);
  const naTabela = doTrecho.filter((l) => !CHAVES_DE_DETALHE.has(l.variavel));
  const soDetalhe = doTrecho.filter((l) => CHAVES_DE_DETALHE.has(l.variavel));
  const frases = diagnosticoDoTrecho(doTrecho);
  const conferencia = conferenciaDoTrecho(valorDaPonta(doTrecho, "COMPARADA"));
  const percurso = doTrecho.find((l) => l.variavel === "origem");
  const destino = doTrecho.find((l) => l.variavel === "destino");

  return (
    <Sheet open onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {percurso?.comparada && destino?.comparada ? (
              <span>
                {percurso.comparada} → {destino.comparada}
              </span>
            ) : (
              <span className="font-mono text-base">
                {trecho.entityLabel ?? "Trecho sem chave"}
              </span>
            )}
            <span className="rounded-full bg-brand/10 px-2.5 py-0.5 font-sans text-xs font-semibold text-brand">
              Trecho
            </span>
          </SheetTitle>
          <SheetDescription>
            {rotuloBase} → {rotuloComparada}
            {percurso?.comparada && (
              <>
                {" · "}
                <span className="font-mono">{trecho.entityLabel}</span>
              </>
            )}
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
              Regras determinísticas sobre os deltas gravados pelo motor, e as duas contas do km
              — ida + volta contra o ciclo, e R$/viagem ÷ R$/km contra esse mesmo ciclo.
            </p>
          </section>

          <section className="rounded-lg border p-3">
            <h3 className="mb-2 text-sm font-bold">
              A conferência do km, na vigência comparada
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-[0.7rem] text-muted-foreground">Ciclo declarado</dt>
                <dd className="font-mono tabular-nums">
                  {escreverKm(conferencia.kmDeclarado)}
                </dd>
              </div>
              <div>
                <dt className="text-[0.7rem] text-muted-foreground">Ida + volta</dt>
                <dd className="font-mono tabular-nums">{escreverKm(conferencia.kmDasPontas)}</dd>
              </div>
              <div>
                <dt className="text-[0.7rem] text-muted-foreground">Km embutido no preço</dt>
                <dd className="font-mono tabular-nums">{escreverKm(conferencia.kmImplicito)}</dd>
              </div>
              <div>
                <dt className="text-[0.7rem] text-muted-foreground">Leitura</dt>
                <dd className="text-xs font-semibold">
                  {ROTULO_DO_VEREDITO_DO_KM[conferencia.veredito]}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-[0.7rem] text-muted-foreground">
              O pedágio fica fora do km embutido: quando o trecho não tem R$/km de pedágio, o
              valor por viagem vem do pedágio por eixo da tabela ANTT, e a divisão entre os dois
              não é uma quilometragem.
            </p>
          </section>

          <section>
            <h3 className="text-sm font-bold">As variáveis, lado a lado</h3>
            <p className="mb-2 text-[0.7rem] text-muted-foreground">
              Só as variáveis que se moveram. Ligue “Mostrar trechos sem alteração” na tabela
              para ver também as que chegaram iguais nas duas vigências.
            </p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[32rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
                    <th scope="col" className="px-3 py-2 text-left font-bold">Variável</th>
                    <th scope="col" className="px-3 py-2 text-left font-bold">Unidade</th>
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
                      <td className="px-3 py-1.5 font-mono text-[0.7rem] text-muted-foreground">
                        {UNIDADE_DO_PAPEL[l.papel]}
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
                          corDaDiferenca(l.diferenca, l.papel),
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
                          corDaDiferenca(l.diferenca, l.papel),
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
                  Isto é o quilômetro contratado, não o quilômetro rodado.
                </strong>{" "}
                O acervo traz a tabela de preço por trecho; o apontamento de viagens da quinzena
                não chega neste export. Multiplicar o R$/km por uma quilometragem que ninguém
                importou inventaria exatamente o número que esta tela existiria para mostrar.
                R$/km não soma com R$/viagem — é o mesmo dinheiro em duas formas —, e o lucro
                variável é margem, não custo.
              </span>
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
