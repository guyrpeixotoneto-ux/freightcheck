import { TriangleAlert } from "lucide-react";
import type { LinhaDePneu, ValorDePneu } from "@workspace/comparison/pneu";
import {
  conferenciaDoTrechoDePneu,
  reconstituicaoDoPneu,
  ROTULO_DO_VEREDITO_DO_PNEU,
  VARIAVEIS_DE_DETALHE_DE_PNEU,
} from "@workspace/comparison/pneu";
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
  escreverKmDeVida,
  escreverReaisPorKm,
  escreverValor,
  escreverVariacao,
} from "@/lib/pneu";

/** As variáveis que só aparecem na seção "só no detalhe". */
const CHAVES_DE_DETALHE = new Set(VARIAVEIS_DE_DETALHE_DE_PNEU.map((v) => v.chave));

/**
 * Um valor absoluto, sem o sinal que a frase já diz.
 *
 * `escreverDiferenca` carimba o sinal de propósito — numa coluna de números ele é
 * a única coisa que separa uma alta de uma queda. Na frase, a direção já está na
 * palavra, e o sinal volta como contradição: "o custo desceu +0,0036 R$/km".
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
 * Existe para que a gaveta chame **as mesmas** funções do núcleo que a régua da
 * vigência chama, em vez de reescrever as contas aqui. Uma segunda cópia da regra
 * divergiria da primeira no dia em que a tolerância mudasse num lugar só — e a
 * frase da gaveta passaria a contradizer o veredito da tabela logo acima dela.
 */
export function valorDaPonta(
  linhas: readonly LinhaDePneu[],
  ponta: "BASE" | "COMPARADA",
): ValorDePneu {
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
    custoReaisKm: de("custo_reais_km"),
    freteReaisKm: de("frete_reais_km"),
    freteReaisViagem: de("frete_reais_viagem"),
    quantidade: de("quantidade"),
    valorMedioPneus: de("valor_medio_pneus"),
    valorMedioRecapagem: de("valor_medio_recapagem"),
    valorVendaCarcaca: de("valor_venda_carcaca"),
    vidaUtil: de("vida_util"),
    vidaUtilAjustada: de("vida_util_ajustada"),
    kmCiclo: de("km_ciclo"),
  };
}

/**
 * Frases determinísticas sobre o que mudou neste trecho.
 *
 * Regras, não modelo de linguagem: cada frase é uma leitura direta dos deltas que
 * o motor já gravou, ou uma das contas que o núcleo faz.
 *
 * **A ordem das frases é a ordem da pergunta**, e não a ordem das colunas:
 *
 * 1. **O custo do quilômetro**, que é a resposta à pergunta que traz alguém aqui.
 * 2. **A vida útil**, porque ela é o denominador: uma carcaça que passou a durar
 *    menos encarece o quilômetro sem que nenhum preço tenha subido.
 * 3. **Os componentes**, que explicam as duas primeiras.
 * 4. **A conferência**, que vale mesmo quando nada mudou.
 * 5. O que o motor recusou comparar, com a frase dele.
 */
export function diagnosticoDoTrecho(linhas: readonly LinhaDePneu[]): string[] {
  const frases: string[] = [];

  /* 1. O custo do quilômetro. */
  const razoes = linhas.filter(
    (l) => l.papel === "RAZAO" && l.estado === "ALTERADO" && l.diferenca !== null,
  );
  for (const l of razoes) {
    const direcao = (l.diferenca ?? 0) > 0 ? "subiu" : "desceu";
    frases.push(
      comPonto(
        `${l.rotuloDaVariavel} ${direcao} ${semSinal(
          escreverDiferenca(l.diferenca, l.medida),
        )}${l.variacao === null ? "" : ` (${escreverVariacao(l.variacao)})`}`,
      ),
    );
  }

  /* 2. A vida útil — o denominador, e o único número desta tela cuja alta é boa. */
  const vidas = linhas.filter(
    (l) => l.papel === "VIDA" && l.estado === "ALTERADO" && l.diferenca !== null,
  );
  for (const l of vidas) {
    const subiu = (l.diferenca ?? 0) > 0;
    frases.push(
      comPonto(
        `${l.rotuloDaVariavel} ${subiu ? "cresceu" : "encolheu"} ${semSinal(
          escreverDiferenca(l.diferenca, l.medida),
        )} — a carcaça ${subiu ? "dilui o custo por mais quilômetros" : "dilui o custo por menos quilômetros"}`,
      ),
    );
  }

  /* 3. Os componentes que explicam as duas primeiras. */
  const unitarios = linhas.filter(
    (l) => l.papel === "UNITARIO" && l.estado === "ALTERADO" && l.diferenca !== null,
  );
  for (const l of unitarios) {
    frases.push(
      comPonto(
        `${l.rotuloDaVariavel}: ${escreverValor(l.base, l.medida)} → ${escreverValor(
          l.comparada,
          l.medida,
        )}`,
      ),
    );
  }
  const quantidade = linhas.find(
    (l) => l.papel === "QUANTIDADE" && l.estado === "ALTERADO" && l.diferenca !== null,
  );
  if (quantidade) {
    frases.push(
      comPonto(
        `O conjunto passou a levar ${escreverValor(
          quantidade.comparada,
          quantidade.medida,
        )} — era ${escreverValor(quantidade.base, quantidade.medida)}`,
      ),
    );
  }

  /* 4. A conferência, que vale mesmo quando nada mudou. */
  const conferencia = conferenciaDoTrechoDePneu(valorDaPonta(linhas, "COMPARADA"));
  if (conferencia.veredito === "PRECO_DIVERGE_DO_CUSTO") {
    frases.push(
      comPonto(
        conferencia.abaixoDoCusto
          ? `O preço cobra ${semSinal(
              escreverReaisPorKm(Math.abs(conferencia.diferencaDoPreco ?? 0)),
            )} a menos do que o custo apurado — é desgaste que ninguém está cobrando`
          : `O preço cobra ${semSinal(
              escreverReaisPorKm(Math.abs(conferencia.diferencaDoPreco ?? 0)),
            )} a mais do que o custo apurado`,
      ),
    );
  } else if (conferencia.veredito === "PRECO_USA_OUTRO_KM") {
    frases.push(
      comPonto(
        `O R$/viagem de pneu embute ${escreverKmDeVida(
          conferencia.kmImplicito,
        )}, e o ciclo declarado é ${escreverKmDeVida(conferencia.kmDeclarado)}`,
      ),
    );
  } else if (conferencia.veredito === "CONFERE") {
    frases.push("O preço de pneu é o custo apurado, e sobre o km que o trecho declara.");
  }

  /* 5. O que o motor recusou comparar, com a frase dele. */
  for (const l of linhas) {
    if ((l.estado === "CONFLITO" || l.estado === "DADO_INCOMPLETO") && l.motivo) {
      frases.push(comPonto(`${l.rotuloDaVariavel}: ${l.motivo}`));
    }
  }

  if (frases.length === 0) {
    frases.push("Nenhuma variável de pneu deste trecho se moveu entre as duas vigências.");
  }
  return frases;
}

/**
 * A gaveta de um trecho — o diagnóstico, a conferência, a reconstituição e as
 * variáveis lado a lado.
 *
 * Ela lê o que a tabela já tem em mãos: não faz consulta nenhuma e não recalcula
 * nada. As duas contas saem das mesmas funções do núcleo que a régua da vigência
 * usa.
 */
export function DetalheDoTrecho({
  trecho,
  linhas,
  rotuloBase,
  rotuloComparada,
  onFechar,
}: {
  trecho: { entityLabel: string | null } | null;
  linhas: LinhaDePneu[];
  rotuloBase: string;
  rotuloComparada: string;
  onFechar: () => void;
}) {
  if (!trecho) return null;
  const doTrecho = linhas.filter((l) => l.entityLabel === trecho.entityLabel);
  const naTabela = doTrecho.filter((l) => !CHAVES_DE_DETALHE.has(l.variavel));
  const soDetalhe = doTrecho.filter((l) => CHAVES_DE_DETALHE.has(l.variavel));
  const frases = diagnosticoDoTrecho(doTrecho);
  const valor = valorDaPonta(doTrecho, "COMPARADA");
  const conferencia = conferenciaDoTrechoDePneu(valor);
  const reconstituicao = reconstituicaoDoPneu(valor);
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
              Regras determinísticas sobre os deltas gravados pelo motor, e as duas contas do
              pneu — preço contra custo apurado, e R$/viagem ÷ R$/km contra o ciclo declarado.
            </p>
          </section>

          <section className="rounded-lg border p-3">
            <h3 className="mb-2 text-sm font-bold">
              A conferência do pneu, na vigência comparada
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-[0.7rem] text-muted-foreground">Custo apurado</dt>
                <dd className="font-mono tabular-nums">
                  {escreverReaisPorKm(conferencia.custoReaisKm)}
                </dd>
              </div>
              <div>
                <dt className="text-[0.7rem] text-muted-foreground">No preço do frete</dt>
                <dd className="font-mono tabular-nums">
                  {escreverReaisPorKm(conferencia.freteReaisKm)}
                </dd>
              </div>
              <div>
                <dt className="text-[0.7rem] text-muted-foreground">Km embutido no preço</dt>
                <dd className="font-mono tabular-nums">
                  {escreverKmDeVida(conferencia.kmImplicito)}
                </dd>
              </div>
              <div>
                <dt className="text-[0.7rem] text-muted-foreground">Leitura</dt>
                <dd className="text-xs font-semibold">
                  {ROTULO_DO_VEREDITO_DO_PNEU[conferencia.veredito]}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border p-3">
            <h3 className="mb-1 text-sm font-bold">A reconstituição, componente a componente</h3>
            <p className="mb-2 font-mono text-[0.7rem] text-muted-foreground">
              quantidade × (pneu novo + recapagem − carcaça) ÷ vida útil ajustada
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-[0.7rem] text-muted-foreground">Reconstituído</dt>
                <dd className="font-mono tabular-nums">
                  {escreverReaisPorKm(reconstituicao.reconstituido)}
                </dd>
              </div>
              <div>
                <dt className="text-[0.7rem] text-muted-foreground">Apurado</dt>
                <dd className="font-mono tabular-nums">
                  {escreverReaisPorKm(reconstituicao.apurado)}
                </dd>
              </div>
              <div>
                <dt className="text-[0.7rem] text-muted-foreground">Distância</dt>
                <dd className="font-mono tabular-nums">
                  {escreverReaisPorKm(reconstituicao.diferenca)}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-[0.7rem] text-muted-foreground">
              {reconstituicao.componentesAusentes.length > 0 ? (
                <>
                  A conta não sai neste trecho: falta{" "}
                  {reconstituicao.componentesAusentes.join(", ")}.
                </>
              ) : (
                <>
                  <strong className="font-semibold">
                    Supõe uma recapagem por carcaça, e o acervo não declara quantas são.
                  </strong>{" "}
                  Por isso esta distância não produz veredito — ela informa.
                </>
              )}
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
                  Isto é o pneu contratado, não o pneu consumido.
                </strong>{" "}
                O acervo traz a tabela de preço por trecho; o apontamento de trocas e recapagens
                da quinzena não chega neste export. R$/km não soma com R$/viagem — é o mesmo
                dinheiro em duas formas —, e o valor de um pneu não soma com um R$/km: a ponte
                entre os dois é a vida útil.
              </span>
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
