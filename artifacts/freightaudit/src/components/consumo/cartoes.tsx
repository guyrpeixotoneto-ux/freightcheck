import { ArrowRightLeft, Equal, Fuel, LogIn, LogOut, Route } from "lucide-react";
import { CartaoDeIndicador } from "@/components/ui/cartao-de-indicador";
import { formatNumber } from "@/lib/format";
import { escreverImpacto, type ComparacaoDeConsumo } from "@/lib/consumo";

/**
 * Os seis indicadores do topo.
 *
 * Nenhum deles é calculado aqui: todos vêm de `resumirConsumo`, no núcleo, que é
 * o mesmo que alimenta os gráficos e a tabela. O que este componente decide é
 * ordem, ícone e cor.
 *
 * **O sexto cartão diz, quase sempre, "sem impacto precificável"**, e nesta
 * rubrica a frase da nota carrega a distinção que dá nome à tela inteira: o que
 * mudou foi **rendimento**, e rendimento só vira dinheiro multiplicado por um
 * preço do litro e por uma quilometragem rodada. O primeiro esta tela recupera; o
 * segundo não existe no acervo. Meia conta não é conta, e um cartão que parasse
 * em "R$ 0,00" seria lido como "nada mudou no diesel".
 */
export function CartoesDeConsumo({
  resumo,
}: {
  resumo: ComparacaoDeConsumo["resumo"];
}) {
  const impacto = escreverImpacto(resumo.impacto.porPeriodicidade);
  const principal = impacto[0];
  const { razoesAlteradas, rendimentosAlterados, perdasAlteradas } = resumo.impacto;
  const fracaoSemAlteracao =
    resumo.trechosComparados === 0
      ? null
      : (resumo.semAlteracao / resumo.trechosComparados) * 100;

  const oQueMudou = [
    rendimentosAlterados > 0
      ? `${formatNumber(rendimentosAlterados, 0)} ${
          rendimentosAlterados === 1 ? "rendimento" : "rendimentos"
        }`
      : null,
    razoesAlteradas > 0
      ? `${formatNumber(razoesAlteradas, 0)} ${
          razoesAlteradas === 1 ? "parcela de R$/km" : "parcelas de R$/km"
        }`
      : null,
    perdasAlteradas > 0
      ? `${formatNumber(perdasAlteradas, 0)} ${perdasAlteradas === 1 ? "perda" : "perdas"}`
      : null,
  ].filter((t): t is string => t !== null);

  return (
    <div
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      aria-label="Indicadores da comparação"
    >
      <CartaoDeIndicador
        rotulo="Trechos comparados"
        valor={formatNumber(resumo.trechosComparados, 0)}
        nota="presentes nas duas vigências"
        ajuda="Linhas da tabela de frete com fato nas duas pontas. Quem entrou ou saiu conta nos cartões ao lado."
        icone={Route}
      />
      <CartaoDeIndicador
        rotulo="Sem alteração"
        valor={formatNumber(resumo.semAlteracao, 0)}
        nota={
          fracaoSemAlteracao === null
            ? "nenhum trecho comparado"
            : `${formatNumber(fracaoSemAlteracao, 1)}% dos comparados`
        }
        ajuda="Comparados em que nenhuma variável de consumo se moveu."
        icone={Equal}
        corDoIcone="bg-success/10 text-success"
      />
      <CartaoDeIndicador
        rotulo="Trechos com alteração"
        valor={formatNumber(resumo.trechosComAlteracao, 0)}
        nota={`${formatNumber(resumo.variaveisAlteradas, 0)} ${
          resumo.variaveisAlteradas === 1 ? "variável alterada" : "variáveis alteradas"
        }`}
        icone={ArrowRightLeft}
        corDoIcone="bg-warning/15 text-warning-foreground"
        corDoValor={resumo.trechosComAlteracao > 0 ? "text-warning-foreground" : undefined}
      />
      <CartaoDeIndicador
        rotulo="Novos na vigência"
        valor={formatNumber(resumo.novosNaVigencia, 0)}
        nota="entraram na comparada"
        ajuda="Trechos que a malha ganhou desde a vigência base."
        icone={LogIn}
      />
      <CartaoDeIndicador
        rotulo="Ausentes na comparada"
        valor={formatNumber(resumo.ausentesNaComparada, 0)}
        nota="saíram desde a base"
        icone={LogOut}
        corDoIcone="bg-destructive/10 text-destructive"
        corDoValor={resumo.ausentesNaComparada > 0 ? "text-destructive" : undefined}
      />
      <CartaoDeIndicador
        destaque
        rotulo="Impacto financeiro"
        valor={principal ? principal.valor : "Sem impacto precificável"}
        corDoValor={
          principal ? (principal.bruto > 0 ? "text-success" : "text-destructive") : undefined
        }
        nota={
          principal ? (
            <span>
              {`por ${principal.rotulo}`}
              {impacto.length > 1 && (
                <>
                  {" · "}
                  {impacto
                    .slice(1)
                    .map((i) => `${i.valor} por ${i.rotulo}`)
                    .join(" · ")}
                </>
              )}
            </span>
          ) : oQueMudou.length > 0 ? (
            `mudaram ${oQueMudou.join(", ")} — consumo contratado, não diesel queimado`
          ) : (
            "nenhuma variável de consumo se moveu"
          )
        }
        ajuda={
          "Rendimento não vira dinheiro sozinho: um km/l que caiu 5% só vira reais " +
          "multiplicado por um preço do litro e por uma quilometragem rodada. O preço do " +
          "litro esta tela recupera — é o painel logo abaixo —, mas a quilometragem " +
          "realizada da quinzena não chega neste export."
        }
        icone={Fuel}
      />
    </div>
  );
}
