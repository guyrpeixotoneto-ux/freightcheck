import {
  ArrowRightLeft,
  CircleDollarSign,
  Equal,
  LogIn,
  LogOut,
  Truck,
} from "lucide-react";
import { CartaoDeIndicador } from "@/components/ui/cartao-de-indicador";
import { formatNumber } from "@/lib/format";
import { escreverImpacto, type ComparacaoDeImpostos } from "@/lib/impostos";

/**
 * Os seis indicadores do topo.
 *
 * Nenhum deles é calculado aqui: todos vêm de `resumirImpostos`, no núcleo, que
 * é o mesmo que alimenta os gráficos e a tabela. O que este componente decide é
 * ordem, ícone e cor.
 *
 * **O sexto cartão é o único que pode mostrar mais de um número, e é de
 * propósito.** O impacto sai por periodicidade porque o PIS/COFINS de aquisição
 * é PONTUAL — incide uma vez, sobre a nota de compra — e somá-lo a uma rubrica
 * mensal daria um número que não descreve nem o mês nem a compra.
 *
 * **E quando não há impacto, ele diz o que mudou mesmo assim.** Nesta rubrica
 * "R$ 0,00" é o resultado esperado — o montante de aquisição não varia entre
 * vigências —, e um cartão que parasse aí seria lido como "nada mudou no
 * imposto". O que muda são as **alíquotas declaradas**, que não são dinheiro e
 * por isso nunca entram na soma; elas aparecem na nota do cartão, porque uma
 * taxa que se move sem que um centavo se mova é exatamente o que esta tela
 * existe para mostrar.
 */
export function CartoesDeImpostos({
  resumo,
}: {
  resumo: ComparacaoDeImpostos["resumo"];
}) {
  const impacto = escreverImpacto(resumo.impacto.porPeriodicidade);
  const principal = impacto[0];
  const aliquotas = resumo.impacto.aliquotasAlteradas;
  const fracaoSemAlteracao =
    resumo.veiculosComparados === 0
      ? null
      : (resumo.semAlteracao / resumo.veiculosComparados) * 100;

  return (
    <div
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      aria-label="Indicadores da comparação"
    >
      <CartaoDeIndicador
        rotulo="Veículos comparados"
        valor={formatNumber(resumo.veiculosComparados, 0)}
        nota="presentes nas duas vigências"
        ajuda="Ativos com fato nas duas pontas. Quem entrou ou saiu conta nos cartões ao lado."
        icone={Truck}
      />
      <CartaoDeIndicador
        rotulo="Sem alteração"
        valor={formatNumber(resumo.semAlteracao, 0)}
        nota={
          fracaoSemAlteracao === null
            ? "nenhum veículo comparado"
            : `${formatNumber(fracaoSemAlteracao, 1)}% dos comparados`
        }
        ajuda={
          "Comparados em que nenhuma variável de imposto se moveu. Nesta rubrica é o " +
          "resultado esperado: o PIS/COFINS de aquisição não varia ao longo das vigências."
        }
        icone={Equal}
        corDoIcone="bg-success/10 text-success"
      />
      <CartaoDeIndicador
        rotulo="Veículos com alteração"
        valor={formatNumber(resumo.veiculosComAlteracao, 0)}
        nota={`${formatNumber(resumo.variaveisAlteradas, 0)} ${
          resumo.variaveisAlteradas === 1 ? "variável alterada" : "variáveis alteradas"
        }`}
        icone={ArrowRightLeft}
        corDoIcone="bg-warning/15 text-warning-foreground"
        corDoValor={resumo.veiculosComAlteracao > 0 ? "text-warning-foreground" : undefined}
      />
      <CartaoDeIndicador
        rotulo="Novos na vigência"
        valor={formatNumber(resumo.novosNaVigencia, 0)}
        nota="entraram na comparada"
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
              {aliquotas > 0 && (
                <>
                  {" · "}
                  {`${formatNumber(aliquotas, 0)} ${
                    aliquotas === 1 ? "alíquota mudou" : "alíquotas mudaram"
                  }, fora da soma`}
                </>
              )}
            </span>
          ) : aliquotas > 0 ? (
            `nenhum montante se moveu, e ${formatNumber(aliquotas, 0)} ${
              aliquotas === 1 ? "alíquota declarada mudou" : "alíquotas declaradas mudaram"
            }`
          ) : (
            "nenhuma rubrica monetária confirmada se moveu"
          )
        }
        ajuda={
          "Só os montantes, separados por periodicidade. Alíquota não é dinheiro e nunca " +
          "entra na soma; o valor de nota está na tabela para conferir o imposto, não para " +
          "somar com ele; e o montante de ICMS fica fora de toda soma por estar zerado nas " +
          "1.215 linhas do acervo."
        }
        icone={CircleDollarSign}
      />
    </div>
  );
}
