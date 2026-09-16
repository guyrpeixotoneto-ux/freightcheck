import { TriangleAlert } from "lucide-react";
import type { LinhaDeConsumo, ValorDeConsumo } from "@workspace/comparison/consumo";
import {
  conferenciaDoTrechoDeConsumo,
  ROTULO_DO_VEREDITO_DO_CONSUMO,
  VARIAVEIS_DE_DETALHE_DE_CONSUMO,
} from "@workspace/comparison/consumo";
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
  escreverPrecoDoLitro,
  escreverReaisPorKm,
  escreverValor,
  escreverVariacao,
} from "@/lib/consumo";
import { formatNumber } from "@/lib/format";

/** As variáveis que só aparecem na seção "só no detalhe". */
const CHAVES_DE_DETALHE = new Set(VARIAVEIS_DE_DETALHE_DE_CONSUMO.map((v) => v.chave));

/**
 * Um valor absoluto, sem o sinal que a frase já diz.
 *
 * `escreverDiferenca` carimba o sinal de propósito — numa coluna de números ele é
 * a única coisa que separa uma alta de uma queda. Na frase, a direção já está na
 * palavra, e o sinal volta como contradição.
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
 * Existe para que a gaveta chame **a mesma** `conferenciaDoTrechoDeConsumo` do
 * núcleo que a régua da vigência chama, em vez de reescrever as contas aqui. Uma
 * segunda cópia da regra divergiria da primeira no dia em que a tolerância mudasse
 * num lugar só — e a frase da gaveta passaria a contradizer o veredito da tabela
 * logo acima dela.
 */
export function valorDaPonta(
  linhas: readonly LinhaDeConsumo[],
  ponta: "BASE" | "COMPARADA",
): ValorDeConsumo {
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
    kmLitro: de("km_litro"),
    consumoAjustado: de("consumo_ajustado"),
    dieselReaisKm: de("diesel_reais_km"),
    freteReaisKmDiesel: de("frete_reais_km_diesel"),
    freteReaisViagemDiesel: de("frete_reais_viagem_diesel"),
    perdaKm: de("perda_km"),
    perdaRegiao: de("perda_regiao"),
    perdaDescartavel: de("perda_descartavel"),
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
 * 1. **O rendimento**, porque é o eixo da rubrica — e porque é o único número
 *    desta tela cuja alta é boa notícia.
 * 2. **O R$/km do diesel**, que é o rendimento virado dinheiro.
 * 3. **As perdas**, que explicam a distância entre os dois rendimentos.
 * 4. **O preço do litro embutido**, contra o da vigência.
 * 5. O que o motor recusou comparar, com a frase dele.
 */
export function diagnosticoDoTrecho(
  linhas: readonly LinhaDeConsumo[],
  precoDeReferencia: number | null,
): string[] {
  const frases: string[] = [];

  /* 1. O rendimento — e a inversão que só esta tela tem. */
  const rendimentos = linhas.filter(
    (l) => l.papel === "RENDIMENTO" && l.estado === "ALTERADO" && l.diferenca !== null,
  );
  for (const l of rendimentos) {
    const subiu = (l.diferenca ?? 0) > 0;
    frases.push(
      comPonto(
        `${l.rotuloDaVariavel} ${subiu ? "subiu" : "caiu"} ${semSinal(
          escreverDiferenca(l.diferenca, l.medida),
        )} — ${subiu ? "menos diesel" : "mais diesel"} no mesmo percurso`,
      ),
    );
  }

  /* 2. O R$/km do diesel. */
  const razoes = linhas.filter(
    (l) => l.papel === "RAZAO" && l.estado === "ALTERADO" && l.diferenca !== null,
  );
  for (const l of razoes) {
    frases.push(
      comPonto(
        `${l.rotuloDaVariavel} ${(l.diferenca ?? 0) > 0 ? "subiu" : "desceu"} ${semSinal(
          escreverDiferenca(l.diferenca, l.medida),
        )}${l.variacao === null ? "" : ` (${escreverVariacao(l.variacao)})`}`,
      ),
    );
  }

  /* 3. As perdas. */
  const perdas = linhas.filter(
    (l) => l.papel === "PERDA" && l.estado === "ALTERADO" && l.diferenca !== null,
  );
  for (const l of perdas) {
    frases.push(
      comPonto(
        `${l.rotuloDaVariavel}: ${escreverValor(l.base, l.medida)} → ${escreverValor(
          l.comparada,
          l.medida,
        )}`,
      ),
    );
  }

  /* 4. O preço do litro embutido — a leitura própria desta tela. */
  const conferencia = conferenciaDoTrechoDeConsumo(
    valorDaPonta(linhas, "COMPARADA"),
    precoDeReferencia,
  );
  if (conferencia.precoDoLitro !== null) {
    const base = `O diesel embutido neste trecho é ${escreverPrecoDoLitro(
      conferencia.precoDoLitro,
    )}`;
    if (conferencia.veredito === "PRECO_DO_LITRO_DESTOA") {
      frases.push(
        comPonto(
          `${base}, contra ${escreverPrecoDoLitro(
            conferencia.precoDeReferencia,
          )} na vigência — este trecho foi precificado sobre outra premissa de combustível`,
        ),
      );
    } else {
      frases.push(comPonto(`${base}, o mesmo que a vigência pratica`));
    }
    if (conferencia.rendimentoUsado === "DO_TRECHO") {
      frases.push(
        "O consumo ajustado pela carga não veio neste trecho: a conta do litro usou o rendimento do trecho, que produz um preço sistematicamente diferente.",
      );
    }
  }
  if (conferencia.veredito === "FRETE_DIVERGE_DO_CUSTO") {
    frases.push(
      comPonto(
        `O preço cobra ${semSinal(
          escreverReaisPorKm(Math.abs(conferencia.diferencaDoPreco ?? 0)),
        )} ${(conferencia.diferencaDoPreco ?? 0) < 0 ? "a menos" : "a mais"} de diesel do que o custo apurado`,
      ),
    );
  }
  if (conferencia.veredito === "PRECO_USA_OUTRO_KM") {
    frases.push(
      comPonto(
        `O R$/viagem de diesel embute ${formatNumber(
          conferencia.kmImplicito ?? 0,
          1,
        )} km, e o ciclo declarado é ${formatNumber(conferencia.kmDeclarado ?? 0, 1)} km`,
      ),
    );
  }

  /* 5. O que o motor recusou comparar, com a frase dele. */
  for (const l of linhas) {
    if ((l.estado === "CONFLITO" || l.estado === "DADO_INCOMPLETO") && l.motivo) {
      frases.push(comPonto(`${l.rotuloDaVariavel}: ${l.motivo}`));
    }
  }

  if (frases.length === 0) {
    frases.push("Nenhuma variável de consumo deste trecho se moveu entre as duas vigências.");
  }
  return frases;
}

/**
 * A gaveta de um trecho — o diagnóstico, o preço do litro e as variáveis lado a
 * lado.
 *
 * `precoDeReferencia` entra por parâmetro porque ele é **da vigência, e não do
 * trecho**: é a mediana entre todos os trechos da ponta, e um trecho não sabe
 * sozinho se destoa. Quem o calcula é o núcleo, na mesma função que a régua acima
 * usa.
 */
export function DetalheDoTrecho({
  trecho,
  linhas,
  precoDeReferencia,
  rotuloBase,
  rotuloComparada,
  onFechar,
}: {
  trecho: { entityLabel: string | null } | null;
  linhas: LinhaDeConsumo[];
  /** O diesel praticado na vigência comparada, vindo da régua. */
  precoDeReferencia: number | null;
  rotuloBase: string;
  rotuloComparada: string;
  onFechar: () => void;
}) {
  if (!trecho) return null;
  const doTrecho = linhas.filter((l) => l.entityLabel === trecho.entityLabel);
  const naTabela = doTrecho.filter((l) => !CHAVES_DE_DETALHE.has(l.variavel));
  const soDetalhe = doTrecho.filter((l) => CHAVES_DE_DETALHE.has(l.variavel));
  const frases = diagnosticoDoTrecho(doTrecho, precoDeReferencia);
  const conferencia = conferenciaDoTrechoDeConsumo(
    valorDaPonta(doTrecho, "COMPARADA"),
    precoDeReferencia,
  );
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
              Regras determinísticas sobre os deltas gravados pelo motor, e as três contas do
              diesel — preço contra custo apurado, litro embutido contra o da vigência, e
              R$/viagem ÷ R$/km contra o ciclo declarado.
            </p>
          </section>

          <section className="rounded-lg border p-3">
            <h3 className="mb-1 text-sm font-bold">
              O diesel embutido, na vigência comparada
            </h3>
            <p className="mb-2 font-mono text-[0.7rem] text-muted-foreground">
              preço do litro = R$/km do diesel × km por litro
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-[0.7rem] text-muted-foreground">Litro embutido</dt>
                <dd className="font-mono font-semibold tabular-nums">
                  {escreverPrecoDoLitro(conferencia.precoDoLitro)}
                </dd>
              </div>
              <div>
                <dt className="text-[0.7rem] text-muted-foreground">Praticado na vigência</dt>
                <dd className="font-mono tabular-nums">
                  {escreverPrecoDoLitro(conferencia.precoDeReferencia)}
                </dd>
              </div>
              <div>
                <dt className="text-[0.7rem] text-muted-foreground">Diesel apurado</dt>
                <dd className="font-mono tabular-nums">
                  {escreverReaisPorKm(conferencia.dieselReaisKm)}
                </dd>
              </div>
              <div>
                <dt className="text-[0.7rem] text-muted-foreground">Leitura</dt>
                <dd className="text-xs font-semibold">
                  {ROTULO_DO_VEREDITO_DO_CONSUMO[conferencia.veredito]}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-[0.7rem] text-muted-foreground">
              {conferencia.rendimentoUsado === "DO_TRECHO"
                ? "A conta usou o rendimento do trecho porque o ajustado pela carga não veio — e os dois produzem preços do litro diferentes."
                : "A conta usou o rendimento ajustado pela carga, que é o que o modelo usa como denominador do R$/km."}
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
                  Isto é o consumo parametrizado, não o diesel queimado.
                </strong>{" "}
                O acervo traz o rendimento que o modelo de remuneração reconhece para o trecho; o
                abastecimento da quinzena não chega neste export. Um rendimento parametrizado
                acima do praticado é diesel que a operação gasta e ninguém remunera; abaixo, é
                combustível pago que não foi queimado — e as duas conversas existem hoje.
              </span>
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
