import {
  ArrowRightLeft,
  CircleDot,
  Equal,
  LogIn,
  LogOut,
  Route,
} from "lucide-react";
import { CartaoDeIndicador } from "@/components/ui/cartao-de-indicador";
import { formatNumber } from "@/lib/format";
import { escreverImpacto, type ComparacaoDePneu } from "@/lib/pneu";

/**
 * Os seis indicadores do topo.
 *
 * Nenhum deles é calculado aqui: todos vêm de `resumirPneu`, no núcleo, que é o
 * mesmo que alimenta os gráficos e a tabela. O que este componente decide é
 * ordem, ícone e cor.
 *
 * **O sexto cartão diz, quase sempre, "sem impacto precificável"** — e isso não
 * é falha de cálculo, é o que a rubrica é. R$/km é razão, R$/viagem é o mesmo
 * dinheiro noutra forma, o valor do pneu é reais **por pneu** e a vida útil é
 * distância: nenhuma delas é dinheiro do período, porque o período exigiria as
 * viagens realizadas, que o acervo não tem.
 *
 * Um cartão que parasse em "R$ 0,00" seria lido como "nada mudou no pneu". Por
 * isso ele diz, na nota, **o que de fato mudou**: quantas parcelas de R$/km,
 * quantos valores unitários e quantas vidas úteis se moveram.
 */
export function CartoesDePneu({ resumo }: { resumo: ComparacaoDePneu["resumo"] }) {
  const impacto = escreverImpacto(resumo.impacto.porPeriodicidade);
  const principal = impacto[0];
  const { razoesAlteradas, unitariosAlterados, vidasAlteradas } = resumo.impacto;
  const fracaoSemAlteracao =
    resumo.trechosComparados === 0
      ? null
      : (resumo.semAlteracao / resumo.trechosComparados) * 100;

  const oQueMudou = [
    razoesAlteradas > 0
      ? `${formatNumber(razoesAlteradas, 0)} ${
          razoesAlteradas === 1 ? "parcela de R$/km" : "parcelas de R$/km"
        }`
      : null,
    unitariosAlterados > 0
      ? `${formatNumber(unitariosAlterados, 0)} ${
          unitariosAlterados === 1 ? "valor unitário" : "valores unitários"
        }`
      : null,
    vidasAlteradas > 0
      ? `${formatNumber(vidasAlteradas, 0)} ${
          vidasAlteradas === 1 ? "vida útil" : "vidas úteis"
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
        ajuda="Comparados em que nenhuma variável de pneu se moveu."
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
            `mudaram ${oQueMudou.join(", ")} — custo contratado, não gasto de operação`
          ) : (
            "nenhuma variável do pneu se moveu"
          )
        }
        ajuda={
          "Nesta rubrica nenhuma coluna é dinheiro do período: R$/km é razão, o valor do " +
          "pneu é reais por pneu, a vida útil é distância e o R$/viagem é o R$/km " +
          "multiplicado pelo km do ciclo. Transformar qualquer uma delas em custo do " +
          "período exigiria as viagens realizadas na quinzena, que este export não traz."
        }
        icone={CircleDot}
      />
    </div>
  );
}
