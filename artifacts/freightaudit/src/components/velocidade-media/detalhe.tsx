import { TriangleAlert } from "lucide-react";
import type { LinhaDeVelocidade, ValorDeVelocidade } from "@workspace/comparison/velocidade-media";
import {
  leituraDoTrecho,
  ROTULO_DA_BASE_DO_TRAJETO,
  ROTULO_DO_VEREDITO_DA_VELOCIDADE,
  VARIAVEIS_DE_DETALHE_DE_VELOCIDADE,
} from "@workspace/comparison/velocidade-media";
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
  escreverFracao,
  escreverMinutos,
  escreverValor,
  escreverVariacao,
  escreverVelocidade,
} from "@/lib/velocidade-media";

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

/** Texto do acervo virando número; nulo e lixo continuam nulos, nunca zero. */
function numero(valor: string | null): number | null {
  if (valor === null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * As linhas de um trecho viram o valor de uma das pontas.
 *
 * Existe para que a gaveta chame **a mesma** `leituraDoTrecho` do núcleo que a
 * régua da vigência chama, em vez de reescrever a decomposição do ciclo aqui.
 * Uma segunda cópia da regra divergiria da primeira no dia em que a tolerância
 * mudasse num lugar só — e a frase da gaveta passaria a contradizer o veredito
 * do painel logo acima dela.
 */
export function valorDaPonta(
  linhas: readonly LinhaDeVelocidade[],
  ponta: "BASE" | "COMPARADA",
): ValorDeVelocidade {
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

  return {
    ponta,
    entityLabel: linhas[0]?.entityLabel ?? null,
    origem: texto("origem"),
    destino: texto("destino"),
    velocidade: de("velocidade"),
    ciclo: de("ciclo"),
    trajeto: de("trajeto"),
    tmaOrigem: de("tma_origem"),
    tmaDestino: de("tma_destino"),
    refeicao: de("refeicao"),
    kmCiclo: de("km_ciclo"),
    kmIda: de("km_ida"),
    cicloLucro: de("ciclo_lucro"),
    tmaOrigemLucro: de("tma_origem_lucro"),
    tmaDestinoLucro: de("tma_destino_lucro"),
  };
}

/**
 * Frases determinísticas sobre o que mudou neste trecho.
 *
 * Regras, não modelo de linguagem: cada frase é uma leitura direta dos deltas
 * que o motor já gravou, ou da decomposição que o núcleo faz. Uma frase gerada
 * seria a única coisa nesta tela sem lastro — e a primeira a ser citada numa
 * reunião.
 *
 * **A ordem das frases é a ordem da pergunta**, e não a ordem das colunas:
 *
 * 1. **A partição do ciclo**, que é a resposta ao que o verbete pedia: quanto
 *    deste tempo é rodar e quanto é esperar.
 * 2. **A conferência da velocidade**, que vale mesmo quando nada mudou.
 * 3. **O que se moveu** — o tempo parado primeiro, porque é o que tem dono, e a
 *    velocidade depois.
 * 4. **A folga do tempo pago**, que o dicionário pede que não se apague.
 * 5. O que o motor recusou comparar, com a frase dele.
 */
export function diagnosticoDoTrecho(linhas: readonly LinhaDeVelocidade[]): string[] {
  const frases: string[] = [];
  const leitura = leituraDoTrecho(valorDaPonta(linhas, "COMPARADA"));

  /* 1. A partição do ciclo — a separação que o verbete dizia faltar. */
  if (leitura.rodando !== null && leitura.parado !== null && leitura.fracaoRodando !== null) {
    frases.push(
      comPonto(
        `Do ciclo, ${escreverMinutos(leitura.rodando)} são rodando e ${escreverMinutos(
          leitura.parado,
        )} são esperando — ${escreverFracao(leitura.fracaoRodando)} do tempo é deslocamento`,
      ),
    );
  }

  /* 2. A conferência da velocidade. */
  if (leitura.veredito === "CICLO_NAO_COMPORTA_PARADAS") {
    frases.push(
      comPonto(
        "As paradas declaradas somam mais do que o ciclo inteiro: não sobra tempo de " +
          "deslocamento, e a linha discorda de si mesma sobre quanto ela dura",
      ),
    );
  } else if (leitura.veredito === "VELOCIDADE_DIVERGE") {
    frases.push(
      comPonto(
        `O tempo rodando e o km do ciclo dão ${escreverVelocidade(
          leitura.velocidadeMedida,
        )}, e o trecho declara ${escreverVelocidade(leitura.velocidadeDeclarada)} — ou o ` +
          "ciclo foi montado com outro tempo de deslocamento, ou a velocidade declarada não " +
          "é a que o modelo usou",
      ),
    );
  } else if (leitura.veredito === "CONFERE") {
    frases.push(
      comPonto(
        `A velocidade fecha: o tempo rodando sobre o km do ciclo dá ${escreverVelocidade(
          leitura.velocidadeMedida,
        )}, que é a declarada`,
      ),
    );
  }

  if (leitura.baseDoTrajeto === "OUTRA") {
    frases.push(
      comPonto(
        "O tempo de deslocamento declarado não foi calculado nem sobre o km de ida nem " +
          "sobre o do ciclo",
      ),
    );
  } else if (leitura.baseDoTrajeto !== "SEM_BASE") {
    frases.push(
      comPonto(
        `O tempo de deslocamento declarado foi calculado ${
          ROTULO_DA_BASE_DO_TRAJETO[leitura.baseDoTrajeto]
        }`,
      ),
    );
  }

  /* 3. O que se moveu: primeiro o tempo parado, que é o que tem dono. */
  const paradas = linhas.filter(
    (l) => l.papel === "TEMPO_PARADO" && !l.versaoLucro && l.estado === "ALTERADO",
  );
  for (const p of paradas) {
    if (p.diferenca === null || p.diferenca === 0) continue;
    frases.push(
      comPonto(
        `${p.rotuloDaVariavel} ${p.diferenca > 0 ? "cresceu" : "encurtou"} ${semSinal(
          escreverDiferenca(Math.abs(p.diferenca), "MINUTOS"),
        )} (${escreverVariacao(p.variacao)}) — é conjunto parado, e é o que o fator ` +
          "motorista transforma em custo de pessoal",
      ),
    );
  }

  const velocidade = linhas.find((l) => l.variavel === "velocidade");
  if (velocidade?.diferenca != null && velocidade.diferenca !== 0) {
    frases.push(
      comPonto(
        `A velocidade declarada ${velocidade.diferenca > 0 ? "subiu" : "caiu"} ${semSinal(
          escreverDiferenca(Math.abs(velocidade.diferenca), "VELOCIDADE"),
        )} — sobre o mesmo percurso, isso encurta ou alonga o ciclo inteiro`,
      ),
    );
  }

  /* 4. A folga entre o tempo pago e o praticado. */
  if (leitura.folgaDoCiclo !== null && leitura.folgaDoCiclo !== 0) {
    frases.push(
      comPonto(
        `O ciclo que remunera é ${escreverMinutos(Math.abs(leitura.folgaDoCiclo))} ${
          leitura.folgaDoCiclo > 0 ? "maior" : "menor"
        } que o operacional — é a diferença entre o tempo pago e o tempo praticado, e o ` +
          "dicionário pede que ela não seja apagada",
      ),
    );
  }

  for (const l of linhas) {
    if (!l.foraDaSoma || l.estado !== "ALTERADO" || !l.versaoLucro) continue;
    frases.push(
      comPonto(`${l.rotuloDaVariavel} mudou — é o tempo que remunera, e não soma com nada`),
    );
  }

  const incomparaveis = linhas.filter(
    (l) => l.estado === "CONFLITO" || l.estado === "DADO_INCOMPLETO",
  );
  for (const l of incomparaveis) {
    frases.push(comPonto(`${l.rotuloDaVariavel}: ${l.motivo ?? ROTULO_DO_ESTADO[l.estado]}`));
  }

  if (frases.length === 0) {
    frases.push(
      "Nenhum tempo e nenhuma velocidade se moveram neste trecho, e a comparação não " +
        "trouxe o ciclo nem as paradas com que abri-lo. Ligue “Mostrar trechos sem " +
        "alteração” para ler a partição do ciclo deste trecho.",
    );
  }
  return frases;
}

const CHAVES_DE_DETALHE = new Set(VARIAVEIS_DE_DETALHE_DE_VELOCIDADE.map((v) => v.chave));

/**
 * O detalhe de um trecho — as variáveis lado a lado, na mesma gaveta.
 *
 * Recebe as linhas que a comparação já trouxe para aquele trecho; não faz uma
 * segunda consulta e não recalcula nada: a partição do ciclo e a conferência da
 * velocidade saem da mesma função do núcleo que a régua da vigência usa.
 */
export function DetalheDoTrecho({
  trecho,
  linhas,
  rotuloBase,
  rotuloComparada,
  onFechar,
}: {
  trecho: { entityLabel: string | null } | null;
  linhas: LinhaDeVelocidade[];
  rotuloBase: string;
  rotuloComparada: string;
  onFechar: () => void;
}) {
  if (!trecho) return null;
  const doTrecho = linhas.filter((l) => l.entityLabel === trecho.entityLabel);
  const naTabela = doTrecho.filter((l) => !CHAVES_DE_DETALHE.has(l.variavel));
  const soDetalhe = doTrecho.filter((l) => CHAVES_DE_DETALHE.has(l.variavel));
  const frases = diagnosticoDoTrecho(doTrecho);
  const leitura = leituraDoTrecho(valorDaPonta(doTrecho, "COMPARADA"));
  const origem = doTrecho.find((l) => l.variavel === "origem");
  const destino = doTrecho.find((l) => l.variavel === "destino");

  return (
    <Sheet open onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {origem?.comparada && destino?.comparada ? (
              <span>
                {origem.comparada} → {destino.comparada}
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
            {origem?.comparada && (
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
              Regras determinísticas sobre os deltas gravados pelo motor, e a decomposição do
              ciclo como o próprio dicionário a define: ciclo menos TMA de origem, TMA de
              destino e refeição.
            </p>
          </section>

          <section className="rounded-lg border p-3">
            <h3 className="mb-2 text-sm font-bold">
              O ciclo aberto, na vigência comparada
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-[0.7rem] text-muted-foreground">Rodando</dt>
                <dd className="font-mono tabular-nums">{escreverMinutos(leitura.rodando)}</dd>
              </div>
              <div>
                <dt className="text-[0.7rem] text-muted-foreground">Esperando</dt>
                <dd className="font-mono tabular-nums">{escreverMinutos(leitura.parado)}</dd>
              </div>
              <div>
                <dt className="text-[0.7rem] text-muted-foreground">Velocidade medida</dt>
                <dd className="font-mono tabular-nums">
                  {escreverVelocidade(leitura.velocidadeMedida)}
                </dd>
              </div>
              <div>
                <dt className="text-[0.7rem] text-muted-foreground">Leitura</dt>
                <dd className="text-xs font-semibold">
                  {ROTULO_DO_VEREDITO_DA_VELOCIDADE[leitura.veredito]}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-[0.7rem] text-muted-foreground">
              Uma parada ausente não vira zero: sem as três, o tempo rodando é nulo e a
              velocidade não é medida — lê-las como zero produziria uma velocidade alta e falsa.
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
              <h3 className="mb-2 text-sm font-bold">
                Só no detalhe — o tempo que remunera, e as projeções
              </h3>
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
                  Esta é a velocidade do contrato, não a da viagem.
                </strong>{" "}
                O tempo e a distância aqui são os que o modelo de remuneração parametriza para o
                trecho — não o que um motorista praticou numa quinzena. O apontamento de viagens
                não chega neste export, e sem ele nenhuma destas linhas vira custo: o tempo vira
                dinheiro pela jornada e pelo fator motorista, que dependem do que a operação de
                fato rodou.
              </span>
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
