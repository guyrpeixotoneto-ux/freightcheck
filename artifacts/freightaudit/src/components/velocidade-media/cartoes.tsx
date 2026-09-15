import { ArrowRightLeft, Equal, Gauge, LogIn, LogOut, Route } from "lucide-react";
import { CartaoDeIndicador } from "@/components/ui/cartao-de-indicador";
import { formatNumber } from "@/lib/format";
import type { ComparacaoDeVelocidade } from "@/lib/velocidade-media";

/**
 * Os seis indicadores do topo.
 *
 * Nenhum deles é calculado aqui: todos vêm de `resumirVelocidade`, no núcleo, que
 * é o mesmo que alimenta os gráficos e a tabela. O que este componente decide é
 * ordem, ícone e cor.
 *
 * **O sexto cartão não mostra dinheiro, e nesta tela isso é literal.** Nenhuma
 * coluna daqui é moeda: minuto é tempo, km/h é razão, km é distância e fator
 * motorista é uma contagem de gente por conjunto. O tempo vira custo pela jornada
 * e pelo fator motorista, que é outra conta — e que depende de quantas viagens a
 * operação rodou, que este export não traz.
 *
 * Então o cartão mostra **o que de fato se moveu**: quantas paradas e quantas
 * velocidades. Um cartão que parasse em "R$ 0,00" seria lido como "nada mudou no
 * tempo", que é o oposto do que costuma acontecer nesta rubrica.
 */
export function CartoesDeVelocidade({
  resumo,
}: {
  resumo: ComparacaoDeVelocidade["resumo"];
}) {
  const { paradasAlteradas, velocidadesAlteradas, versaoLucroAlterada } = resumo.impacto;
  const fracaoSemAlteracao =
    resumo.trechosComparados === 0
      ? null
      : (resumo.semAlteracao / resumo.trechosComparados) * 100;

  const oQueMudou = [
    paradasAlteradas > 0
      ? `${formatNumber(paradasAlteradas, 0)} ${
          paradasAlteradas === 1 ? "tempo parado" : "tempos parados"
        }`
      : null,
    velocidadesAlteradas > 0
      ? `${formatNumber(velocidadesAlteradas, 0)} ${
          velocidadesAlteradas === 1 ? "velocidade" : "velocidades"
        }`
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
        ajuda="Comparados em que nenhum tempo e nenhuma velocidade se moveram."
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
        rotulo="O que se moveu no tempo"
        valor={
          oQueMudou.length > 0
            ? formatNumber(paradasAlteradas + velocidadesAlteradas, 0)
            : "Nada se moveu"
        }
        corDoValor={paradasAlteradas > 0 ? "text-warning-foreground" : undefined}
        nota={
          oQueMudou.length > 0 ? (
            <span>
              {oQueMudou.join(" e ")}
              {versaoLucroAlterada > 0 && (
                <>
                  {" · "}
                  {`${formatNumber(versaoLucroAlterada, 0)} ${
                    versaoLucroAlterada === 1
                      ? "alteração só no tempo que remunera"
                      : "alterações só no tempo que remunera"
                  }`}
                </>
              )}
            </span>
          ) : (
            "nenhum tempo e nenhuma velocidade mudaram entre as duas vigências"
          )
        }
        ajuda={
          "Esta tela não tem cartão de impacto financeiro porque nenhuma coluna dela é " +
          "dinheiro: minuto é tempo, km/h é razão e fator motorista é gente por conjunto. " +
          "O tempo vira custo pela jornada e pelo fator motorista — e essa conta depende " +
          "das viagens realizadas, que este export não traz."
        }
        icone={Gauge}
      />
    </div>
  );
}
