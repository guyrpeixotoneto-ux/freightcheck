import {
  ArrowRightLeft,
  CircleDollarSign,
  Equal,
  RefreshCw,
  TriangleAlert,
  Truck,
} from "lucide-react";
import { CartaoDeIndicador } from "@/components/ui/cartao-de-indicador";
import { formatNumber } from "@/lib/format";
import { escreverImpacto, type ComparacaoDeLucroFixo } from "@/lib/lucro-fixo";

/**
 * Os seis indicadores do topo.
 *
 * Nenhum deles é calculado aqui: todos vêm de `resumirLucroFixo`, no núcleo, que
 * é o mesmo que alimenta os gráficos e a tabela.
 *
 * **Dois cartões são próprios desta rubrica**, e substituem os de "novos" e
 * "ausentes na comparada" que as telas de FINAME e IPVA usam. A entrada e a
 * saída de frota continuam contadas — elas aparecem na rosca de status e na
 * tabela —, mas não são a pergunta daqui. A pergunta daqui é o ciclo: quem
 * terminou de amortizar e passou a ser remunerado. Repetir os seis cartões das
 * outras duas telas seria gastar os dois lugares mais visíveis da página com o
 * que ela responde de passagem.
 *
 * **O sinal do impacto é de receita.** Positivo é mais dinheiro entrando, e por
 * isso a cor de um impacto positivo aqui é verde — o contrário do que ela
 * significa nas telas de custo.
 */
export function CartoesDeLucroFixo({
  resumo,
  coexistencias,
}: {
  resumo: ComparacaoDeLucroFixo["resumo"];
  /** Quantos ativos declaram amortização e lucro fixo ao mesmo tempo. */
  coexistencias: number;
}) {
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
        ajuda="Ativos com fato nas duas pontas. Quem entrou ou saiu da frota conta na rosca de status."
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
        ajuda="Comparados em que nenhuma variável de lucro fixo se moveu."
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
        rotulo="Entraram no 2º ciclo"
        valor={formatNumber(resumo.entraramNoSegundoCiclo, 0)}
        nota="terminaram de amortizar"
        ajuda={
          "Ativos que passaram do ciclo 1 para o 2 entre as duas vigências: o financiamento " +
          "acabou e a remuneração fixa começou. É o que explica a linha subir sem ninguém ter " +
          "renegociado nada."
        }
        icone={RefreshCw}
        corDoIcone="bg-success/10 text-success"
        corDoValor={resumo.entraramNoSegundoCiclo > 0 ? "text-success" : undefined}
      />
      <CartaoDeIndicador
        rotulo="Fora do esperado"
        valor={formatNumber(resumo.voltaramAoPrimeiroCiclo + coexistencias, 0)}
        nota={
          resumo.voltaramAoPrimeiroCiclo + coexistencias === 0
            ? "nada a olhar"
            : `${formatNumber(resumo.voltaramAoPrimeiroCiclo, 0)} voltaram ao 1º · ${formatNumber(
                coexistencias,
                0,
              )} com os dois`
        }
        ajuda={
          "Duas coisas que o acervo diz não acontecer: um ativo voltar ao primeiro ciclo — " +
          "ninguém desamortiza — e um ativo declarar amortização e lucro fixo ao mesmo tempo, " +
          "que são zero coexistências em 558 linhas medidas. Quando aparecem, é reclassificação " +
          "ou defeito de cadastro."
        }
        icone={TriangleAlert}
        corDoIcone="bg-warning/15 text-warning-foreground"
        corDoValor={
          resumo.voltaramAoPrimeiroCiclo + coexistencias > 0
            ? "text-warning-foreground"
            : undefined
        }
      />
      <CartaoDeIndicador
        destaque
        rotulo="Impacto na receita"
        valor={principal ? principal.valor : "Sem impacto precificável"}
        corDoValor={
          /* Receita: subir é verde. O oposto das telas de custo — ver `corDaDiferenca`. */
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
            "nenhuma parcela de lucro fixo se moveu"
          )
        }
        ajuda={
          "Só a parcela própria de cada equipamento, separada por periodicidade. A coluna do " +
          "conjunto não entra: ela embute a parcela do cavalo vinculado. A amortização também " +
          "não — ela é custo, e está na tabela para explicar o lucro fixo, não para somar com ele."
        }
        icone={CircleDollarSign}
      />
    </div>
  );
}
