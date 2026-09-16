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
import { escreverImpacto, type ComparacaoDeSeguro } from "@/lib/seguro";

/**
 * Os seis indicadores do topo.
 *
 * Nenhum deles é calculado aqui: todos vêm de `resumirSeguro`, no núcleo, que é
 * o mesmo que alimenta os gráficos e a tabela. O que este componente decide é
 * ordem, ícone e cor.
 *
 * **O cartão de impacto costuma dizer "sem impacto precificável", e isso é o
 * dado.** Três das cinco colunas desta rubrica são taxa fixa — revestimento,
 * faixa refletiva e tacógrafo têm um valor só para a frota inteira —, e uma
 * comparação em que elas não se moveram não tem impacto nenhum. Dizer isso por
 * extenso é diferente de mostrar R$ 0,00, que afirmaria que houve movimento e
 * ele foi nulo.
 *
 * **Quando há alteração de taxa, o cartão avisa.** Uma tabela que muda move
 * todas as placas de uma vez: 657 alterações não são 657 negociações, e sem o
 * aviso o número do meio vira uma notícia que não aconteceu.
 */
export function CartoesDeSeguro({ resumo }: { resumo: ComparacaoDeSeguro["resumo"] }) {
  const impacto = escreverImpacto(resumo.impacto.porPeriodicidade);
  const principal = impacto[0];
  const fracaoSemAlteracao =
    resumo.veiculosComparados === 0
      ? null
      : (resumo.semAlteracao / resumo.veiculosComparados) * 100;
  const deTaxa = resumo.impacto.alteracoesDeTaxa;

  return (
    <div
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      aria-label="Indicadores da comparação"
    >
      <CartaoDeIndicador
        rotulo="Veículos comparados"
        valor={formatNumber(resumo.veiculosComparados, 0)}
        nota="presentes nas duas vigências"
        ajuda={
          "Ativos com fato nas duas pontas. Só a carreta declara as colunas desta " +
          "rubrica — o cavalo não tem nenhuma delas."
        }
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
          "Comparados em que nenhuma coluna do aparato se moveu. Nesta rubrica é o " +
          "caso comum, e não um sinal de que falta dado: três das cinco colunas são " +
          "taxa fixa. Ligue “Mostrar veículos sem alteração” para ver quanto cada " +
          "carreta paga."
        }
        icone={Equal}
        corDoIcone="bg-success/10 text-success"
      />
      <CartaoDeIndicador
        rotulo="Veículos com alteração"
        valor={formatNumber(resumo.veiculosComAlteracao, 0)}
        nota={
          <span>
            {`${formatNumber(resumo.variaveisAlteradas, 0)} ${
              resumo.variaveisAlteradas === 1 ? "variável alterada" : "variáveis alteradas"
            }`}
            {deTaxa > 0 && (
              <>
                {" · "}
                <b className="text-foreground">{formatNumber(deTaxa, 0)}</b>
                {deTaxa === 1 ? " é de taxa" : " são de taxa"}
              </>
            )}
          </span>
        }
        ajuda={
          "Alteração de taxa é mudança de tabela, e não negociação: revestimento, " +
          "faixa refletiva e tacógrafo têm um valor só para a frota inteira, e quando " +
          "um deles muda, muda em todas as placas de uma vez. Só o seguro é negociado " +
          "por ativo."
        }
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
          "As quatro colunas que têm valor, separadas por periodicidade. O rastreador " +
          "não entra — é zero em todas as linhas do acervo, e somá-lo afirmaria que " +
          "rastrear custa R$ 0,00. O custo fixo do conjunto também não: ele é total, e " +
          "já contém o FINAME e o lucro fixo."
        }
        icone={CircleDollarSign}
      />
    </div>
  );
}
