import {
  ArrowRightLeft,
  Equal,
  Gauge,
  LogIn,
  LogOut,
  Route,
} from "lucide-react";
import { CartaoDeIndicador } from "@/components/ui/cartao-de-indicador";
import { formatNumber } from "@/lib/format";
import { escreverImpacto, type ComparacaoDeKm } from "@/lib/km-rodado";

/**
 * Os seis indicadores do topo.
 *
 * Nenhum deles é calculado aqui: todos vêm de `resumirKm`, no núcleo, que é o
 * mesmo que alimenta os gráficos e a tabela. O que este componente decide é
 * ordem, ícone e cor.
 *
 * **O sexto cartão é o único diferente dos das quatro telas de custo fixo, e a
 * diferença é a tela inteira.** Lá ele mostra dinheiro; aqui ele mostra, quase
 * sempre, "sem impacto precificável" — e isso não é uma falha de cálculo, é o
 * que a rubrica é. R$/km é razão, R$/viagem é o mesmo dinheiro noutra forma, km
 * é distância e viagem prevista é previsão: nenhuma delas é dinheiro do período,
 * porque o período exigiria as viagens realizadas, que o acervo não tem.
 *
 * Um cartão que parasse em "R$ 0,00" seria lido como "nada mudou no preço". Por
 * isso ele diz, na nota, **o que de fato mudou**: quantas parcelas do preço por
 * quilômetro se moveram, e quantas distâncias.
 */
export function CartoesDeKm({ resumo }: { resumo: ComparacaoDeKm["resumo"] }) {
  const impacto = escreverImpacto(resumo.impacto.porPeriodicidade);
  const principal = impacto[0];
  const razoes = resumo.impacto.razoesAlteradas;
  const distancias = resumo.impacto.distanciasAlteradas;
  const fracaoSemAlteracao =
    resumo.trechosComparados === 0
      ? null
      : (resumo.semAlteracao / resumo.trechosComparados) * 100;

  const oQueMudou = [
    razoes > 0
      ? `${formatNumber(razoes, 0)} ${razoes === 1 ? "parcela de R$/km" : "parcelas de R$/km"}`
      : null,
    distancias > 0
      ? `${formatNumber(distancias, 0)} ${distancias === 1 ? "distância" : "distâncias"}`
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
        ajuda="Comparados em que nenhuma variável de km rodado se moveu."
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
          principal ? (principal.bruto > 0 ? "text-destructive" : "text-success") : undefined
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
            `mudaram ${oQueMudou.join(" e ")} — preço contratado, não custo de operação`
          ) : (
            "nenhuma parcela do preço por quilômetro se moveu"
          )
        }
        ajuda={
          "Nesta rubrica nenhuma coluna é dinheiro do período: R$/km é razão, R$/viagem " +
          "é o mesmo dinheiro multiplicado pelo km do ciclo, km é distância e viagem " +
          "prevista é previsão. Transformar qualquer uma delas em custo exigiria as " +
          "viagens realizadas na quinzena, que este export não traz."
        }
        icone={Gauge}
      />
    </div>
  );
}
