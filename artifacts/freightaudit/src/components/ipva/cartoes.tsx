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
import { escreverImpacto, type ComparacaoDeIpva } from "@/lib/ipva";

/**
 * Os seis indicadores do topo.
 *
 * Nenhum deles é calculado aqui: todos vêm de `resumirIpva`, no núcleo, que é o
 * mesmo que alimenta os gráficos e a tabela. O que este componente decide é
 * ordem, ícone e cor.
 *
 * **O sexto cartão é o único que pode mostrar mais de um número, e é de
 * propósito.** O impacto sai por periodicidade porque o IPVA do cavalo é anual —
 * 1% do valor da nota ao ano; mensal daria 12% a.a., que não existe — e somar
 * baldes diferentes exigiria anualizar um deles, que é decisão de quem lê.
 * Quando não há nada precificável, o cartão diz isso por extenso em vez de
 * mostrar R$ 0,00, que é um número diferente de "não há como precificar".
 */
export function CartoesDeIpva({ resumo }: { resumo: ComparacaoDeIpva["resumo"] }) {
  const impacto = escreverImpacto(resumo.impacto.porPeriodicidade);
  const principal = impacto[0];
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
        ajuda="Comparados em que nenhuma variável de IPVA se moveu."
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
            </span>
          ) : (
            "nenhuma rubrica monetária confirmada se moveu"
          )
        }
        ajuda={
          "Só a coluna de IPVA, separada por periodicidade. O valor de nota está na " +
          "tabela para conferir a alíquota, não para somar com o tributo sobre ele; a " +
          "coluna “mensal” da carreta não entra em soma nenhuma; e ano e data não são " +
          "dinheiro."
        }
        icone={CircleDollarSign}
      />
    </div>
  );
}
