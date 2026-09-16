import { ArrowRightLeft, Equal, Gauge, LogIn, LogOut, Truck } from "lucide-react";
import { CartaoDeIndicador } from "@/components/ui/cartao-de-indicador";
import { formatNumber } from "@/lib/format";
import { escreverVariacaoDoReaisKm, type ComparacaoDeManutencao } from "@/lib/manutencao";

/**
 * Os seis indicadores do topo.
 *
 * Nenhum deles é calculado aqui: todos vêm de `resumirManutencao`, no núcleo,
 * que é o mesmo que alimenta os gráficos e a tabela.
 *
 * ---------------------------------------------------------------------------
 * O sexto cartão não é "impacto financeiro", e não podia ser
 * ---------------------------------------------------------------------------
 * As outras cinco auditorias fecham num cartão de reais. Esta fecha num cartão
 * de **R$/km**, e a diferença não é de rótulo: R$/km só vira dinheiro
 * multiplicado por quilômetro rodado, e o quilômetro é de outra leitura
 * (`km-rodado.ts`), de outro grão e de outra vigência. Um "impacto em reais"
 * aqui seria um número que nenhuma outra tela do produto conseguiria
 * reproduzir — e seria o mais lido da tela.
 *
 * **O líquido vem com quantos subiram e quantos caíram**, e isso também não é
 * enfeite. No acervo há uma comparação em que dois caminhões foram de
 * R$ 0,40/km para zero e outros dois de zero para R$ 0,40/km: líquido
 * exatamente zero, e quatro contratos mexidos. Um cartão que mostrasse só o
 * líquido diria que nada aconteceu.
 */
export function CartoesDeManutencao({
  resumo,
}: {
  resumo: ComparacaoDeManutencao["resumo"];
}) {
  const reaisKm = escreverVariacaoDoReaisKm(resumo.reaisKm);
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
        ajuda={
          "Ativos com fato nas duas pontas. Só o cavalo tem contrato de manutenção: o " +
          "Modelo_Carreta não declara nenhuma dessas colunas — não é que venham zeradas, é " +
          "que não existem."
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
        ajuda="Comparados em que nenhuma variável de manutenção se moveu."
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
            {resumo.impacto.alteracoesDeReaisKm > 0 && (
              <>
                {" · "}
                <b className="text-foreground">
                  {formatNumber(resumo.impacto.alteracoesDeReaisKm, 0)}
                </b>
                {resumo.impacto.alteracoesDeReaisKm === 1 ? " em R$/km" : " em R$/km"}
              </>
            )}
          </span>
        }
        ajuda={
          "A vida em meses anda sozinha com o calendário e se move em quase toda " +
          "comparação. O que custa dinheiro é o R$/km — por isso ele vem contado à " +
          "parte, e tem um alternador só dele na barra de filtros."
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
        rotulo="Variação do R$/km"
        valor={resumo.reaisKm.veiculos === 0 ? "Nenhum contrato mexido" : reaisKm.valor}
        corDoValor={
          resumo.reaisKm.veiculos === 0
            ? undefined
            : resumo.reaisKm.soma > 0
              ? "text-success"
              : resumo.reaisKm.soma < 0
                ? "text-destructive"
                : undefined
        }
        nota={reaisKm.detalhe}
        ajuda={
          "A soma do que o custo por quilômetro se moveu, somada sobre os caminhões do " +
          "recorte — e dita em R$/km, que é a unidade em que foi medida. Multiplicar " +
          "por uma quilometragem daria reais, e daria um número que nem a Auditoria de " +
          "Km Rodado nem o fechamento reconheceriam: a quilometragem que entraria na " +
          "conta é de outro grão e de outra vigência."
        }
        icone={Gauge}
      />
    </div>
  );
}
