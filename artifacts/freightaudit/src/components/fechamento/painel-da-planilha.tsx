import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { formatBrl } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PainelDaPlanilha, QuadroDoPainel, TresColunas } from "@/lib/fechamento";

/**
 * A aba `Planilha` — o mesmo fechamento nas linhas com que ele é discutido.
 *
 * A aba `Verbas` mostra o recorte com que o sistema apura: a VBZ, que é o que
 * os arquivos sustentam um a um. Esta mostra o recorte com que a Ambev e a
 * transportadora conversam: `Custo fixo padronizado`, `Custo variável
 * (agregado)`, `Desconto de devolução`. É a mesma conta cortada de dois jeitos,
 * e ter as duas na mesma tela é o que dispensa casar de cabeça o `.xlsb` aberto
 * ao lado.
 *
 * **As duas abas fecham no mesmo número, e ele está escrito.** O `Total
 * remuneração (03.08.20)` do rodapé daqui é o mesmo do rodapé de lá — os dois
 * saem da mesma soma do mesmo relatório. O que os separa no meio do caminho é o
 * imposto, porque a planilha escreve sem ele e o CT-e sai com ele; por isso o
 * rodapé mostra os três números, e a diferença entre a soma dos quadros e o
 * total é **medida** ali, não convertida por um fator digitado.
 *
 * **Por que o número compartilhado aparece uma vez só.** As seis linhas do
 * quadro do fixo dividem um número que o 03.08.20 traz somado — o rateio por
 * tipo de frota não existe no relatório. Repetir o valor em cada uma delas
 * seria multiplicá-lo na tela; escrevê-lo uma vez, na linha do conjunto, é
 * dizer o que se sabe sem afirmar o que não se sabe.
 *
 * **Nada é recomposto aqui.** As três colunas vêm montadas de
 * `@workspace/fechamento`, como todo o resto do fechamento: uma soma feita no
 * navegador seria uma segunda opinião sobre remuneração.
 */

/** Uma coluna da tabela: como se chama e qual das três colunas ela lê. */
export interface ColunaDoPainel {
  rotulo: string;
  de: (valores: TresColunas) => number | null;
}

/** `null` é ausência e aparece como traço — nunca como `R$ 0,00`. */
function dinheiro(valor: number | null): string {
  return valor === null ? "—" : formatBrl(valor);
}

export function PainelDaPlanilhaTabela({
  painel,
  colunas,
}: {
  painel: PainelDaPlanilha;
  colunas: ColunaDoPainel[];
}) {
  /* Qual linha está aberta é estado desta tabela: há duas nesta tela. */
  const [aberta, setAberta] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs tracking-wide text-muted-foreground">
              <th className="py-2 text-left font-medium">Linha da planilha</th>
              {colunas.map((c) => (
                <th key={c.rotulo} className="py-2 text-right font-medium min-w-32">
                  {c.rotulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {painel.quadros.map((quadro) => (
              <Quadro
                key={quadro.quadro}
                quadro={quadro}
                colunas={colunas}
                aberta={aberta}
                onAbrir={(chave) => setAberta(aberta === chave ? null : chave)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <Fecho painel={painel} colunas={colunas} />
    </div>
  );
}

function Quadro({
  quadro,
  colunas,
  aberta,
  onAbrir,
}: {
  quadro: QuadroDoPainel;
  colunas: ColunaDoPainel[];
  aberta: string | null;
  onAbrir: (chave: string) => void;
}) {
  /*
    O conjunto aparece logo depois da última linha que o divide — é onde a
    planilha o teria escrito se ela soubesse que aquelas linhas compartilham
    um número. Pô-lo no fim do quadro afastaria o valor das linhas a que ele
    se refere justamente onde a leitura é linha a linha.
  */
  const ultimaDoConjunto = new Map<string, string>();
  for (const linha of quadro.linhas) {
    if (linha.conjunto) ultimaDoConjunto.set(linha.conjunto, linha.chave);
  }

  /*
    Só se olha para as colunas que estão na tela: uma sobra na 2ª quinzena não
    é notícia de quem está lendo a 1ª, e anunciá-la mandaria procurar o número
    numa coluna que não está visível.
  */
  const naoFecha = colunas.some((c) => {
    const valor = c.de(quadro.residuo);
    return valor !== null && valor !== 0;
  });

  return (
    <Fragment>
      <tr className="border-b bg-muted/40">
        <td colSpan={colunas.length + 1} className="py-1.5 text-xs font-semibold">
          {quadro.titulo}
        </td>
      </tr>

      {quadro.linhas.map((linha) => {
        const total = linha.papel === "TOTAL";
        const emConjunto = linha.conjunto !== null;
        const conjunto = quadro.conjuntos.find((c) => c.chave === linha.conjunto) ?? null;
        return (
          <Fragment key={linha.chave}>
            <tr
              className={cn(
                "border-b cursor-pointer hover:bg-muted/50",
                total && "font-semibold",
              )}
              onClick={() => onAbrir(linha.chave)}
              aria-expanded={aberta === linha.chave}
            >
              <td className="py-2">
                <span className="inline-flex items-center gap-1.5">
                  <ChevronRight
                    className={cn(
                      "w-3.5 h-3.5 text-muted-foreground transition-transform",
                      aberta === linha.chave && "rotate-90",
                    )}
                  />
                  {linha.nome}
                </span>
              </td>
              {colunas.map((c) => {
                const valor = c.de(linha.valores);
                return (
                  <td
                    key={c.rotulo}
                    className="py-2 text-right font-mono tabular-nums text-xs sm:text-sm"
                  >
                    {valor === null ? (
                      <span className="text-xs text-muted-foreground font-sans">
                        {emConjunto ? "em conjunto" : linha.ausencia ? "sem lastro" : "—"}
                      </span>
                    ) : (
                      /* O desconto sai com o sinal com que a planilha o escreve. */
                      dinheiro(linha.papel === "DESCONTO" ? -valor : valor)
                    )}
                  </td>
                );
              })}
            </tr>

            {aberta === linha.chave && (
              <tr className="border-b bg-muted/30">
                <td colSpan={colunas.length + 1} className="py-3 px-8 space-y-2">
                  <p className="text-sm text-muted-foreground">{linha.porque}</p>
                  {linha.ausencia && (
                    <div className="text-sm">
                      <p className="text-muted-foreground">{linha.ausencia.motivo}</p>
                      <p className="mt-1">
                        <span className="font-medium">O que destrava: </span>
                        <span className="text-muted-foreground">{linha.ausencia.destrava}</span>
                      </p>
                    </div>
                  )}
                  {conjunto && (
                    <p className="text-sm text-muted-foreground">
                      Divide o número de <strong>{conjunto.nome}</strong> com{" "}
                      {conjunto.linhas.filter((l) => l !== linha.nome).join(", ")}.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Na planilha: <code>{linha.rotulo}</code>
                  </p>
                </td>
              </tr>
            )}

            {conjunto && ultimaDoConjunto.get(conjunto.chave) === linha.chave && (
              <tr className="border-b bg-muted/20">
                <td className="py-2 pl-8 text-xs text-muted-foreground italic">
                  {conjunto.nome} — o número que as {conjunto.linhas.length} linhas acima
                  dividem
                </td>
                {colunas.map((c) => (
                  <td
                    key={c.rotulo}
                    className="py-2 text-right font-mono tabular-nums text-xs sm:text-sm"
                  >
                    {dinheiro(c.de(conjunto.valores))}
                  </td>
                ))}
              </tr>
            )}
          </Fragment>
        );
      })}

      {naoFecha && (
        <Fragment>
          <tr className="border-b">
            <td className="py-2 text-muted-foreground">Sobra sem explicação</td>
            {colunas.map((c) => (
              <td
                key={c.rotulo}
                className="py-2 text-right font-mono tabular-nums text-xs sm:text-sm text-muted-foreground"
              >
                {dinheiro(c.de(quadro.residuo))}
              </td>
            ))}
          </tr>
          <tr className="border-b">
            <td colSpan={colunas.length + 1} className="pb-2 text-xs text-muted-foreground">
              {quadro.semLastro.length > 0 && (
                <>Do lado da planilha, {quadro.semLastro.join(" e ")} não têm de onde sair. </>
              )}
              {quadro.verbasSemLinha.length > 0 && (
                <>
                  Do lado do relatório sobra{" "}
                  {quadro.verbasSemLinha.map((v) => `${v.nome} (VBZ ${v.vbz})`).join(", ")}, que
                  nenhuma linha da planilha nomeia.{" "}
                </>
              )}
              A sobra é o que essas duas listas somam — e é uma afirmação que a
              planilha aberta ao lado derruba numa subtração, se estiver errada.
            </td>
          </tr>
        </Fragment>
      )}
    </Fragment>
  );
}

/**
 * O fecho — os três números que amarram esta aba à outra.
 *
 * A soma dos quadros está na moeda da planilha; o total do 03.08.20 está na do
 * CT-e; e o que os separa é o imposto, que sai da subtração dos dois e não de
 * um fator. É de propósito que a linha do meio seja uma conta e não uma
 * conversão: o produto recusa reproduzir o 1,366960 digitado da planilha.
 */
function Fecho({
  painel,
  colunas,
}: {
  painel: PainelDaPlanilha;
  colunas: ColunaDoPainel[];
}) {
  const linhas: { rotulo: string; valores: TresColunas; forte?: boolean; nota?: string }[] = [
    { rotulo: "Soma dos quadros", valores: painel.soma, nota: "Sem imposto — a moeda em que a planilha escreve." },
    {
      rotulo: "Imposto",
      valores: painel.imposto,
      nota: "Medido: a distância entre a coluna sem imposto e o total que o relatório fecha.",
    },
    {
      rotulo: "Total remuneração (03.08.20)",
      valores: painel.demonstrativo,
      forte: true,
      nota: "O mesmo número que a aba Verbas mostra no fecho dela.",
    },
  ];

  return (
    <table className="w-full text-sm border-t-2">
      <tbody>
        {linhas.map((l) => (
          <tr key={l.rotulo} className={cn("border-b last:border-0", l.forte && "font-bold")}>
            <td className="py-2">
              {l.rotulo}
              {l.nota && (
                <span className="block text-xs font-normal text-muted-foreground">{l.nota}</span>
              )}
            </td>
            {colunas.map((c) => (
              <td
                key={c.rotulo}
                className="py-2 text-right font-mono tabular-nums min-w-32 align-top"
              >
                {dinheiro(c.de(l.valores))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
