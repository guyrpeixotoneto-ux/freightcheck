import { ArrowRightLeft, Equal, Key, LogIn, LogOut, Truck } from "lucide-react";
import { CartaoDeIndicador } from "@/components/ui/cartao-de-indicador";
import { formatNumber } from "@/lib/format";
import { escreverImpacto, type ComparacaoDeAluguel } from "@/lib/aluguel";

/**
 * Os seis indicadores do topo.
 *
 * Nenhum deles é calculado aqui: todos vêm de `resumirAluguel`, no núcleo, que é
 * o mesmo que alimenta os gráficos e a tabela. O que este componente decide é
 * ordem, ícone e cor.
 *
 * **O sexto cartão mostra reais, diferente do da Aquisição** — e a diferença tem
 * motivo: o aluguel é dinheiro do mês, confirmado MENSAL pela curadoria, e este
 * módulo é quem o soma. Quando o número aparece, um aluguel que sobe é despesa
 * que sobe, e por isso ele é vermelho quando positivo — a régua inversa das
 * rubricas de remuneração, onde subir é receita.
 */
export function CartoesDeAluguel({ resumo }: { resumo: ComparacaoDeAluguel["resumo"] }) {
  const impacto = escreverImpacto(resumo.impacto.porPeriodicidade);
  const principal = impacto[0];
  const { alugueisAlterados } = resumo.impacto;
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
        rotulo="Ativos comparados"
        valor={formatNumber(resumo.veiculosComparados, 0)}
        nota="presentes nas duas vigências"
        ajuda="Cavalos e carretas com fato nas duas pontas. Quem entrou ou saiu conta nos cartões ao lado."
        icone={Truck}
      />
      <CartaoDeIndicador
        rotulo="Sem alteração"
        valor={formatNumber(resumo.semAlteracao, 0)}
        nota={
          fracaoSemAlteracao === null
            ? "nenhum ativo comparado"
            : `${formatNumber(fracaoSemAlteracao, 1)}% dos comparados`
        }
        ajuda="Comparados em que nenhuma coluna de aluguel se moveu. A maioria da frota não é alugada, e para ela esta rubrica não tem o que mover."
        icone={Equal}
        corDoIcone="bg-success/10 text-success"
      />
      <CartaoDeIndicador
        rotulo="Ativos com alteração"
        valor={formatNumber(resumo.veiculosComAlteracao, 0)}
        nota={`${formatNumber(resumo.variaveisAlteradas, 0)} ${
          resumo.variaveisAlteradas === 1 ? "variável alterada" : "variáveis alteradas"
        }`}
        ajuda="Placas em que o aluguel, ou a parcela que o contém, se moveu entre as duas vigências."
        icone={ArrowRightLeft}
        corDoIcone="bg-warning/15 text-warning-foreground"
        corDoValor={resumo.veiculosComAlteracao > 0 ? "text-warning-foreground" : undefined}
      />
      <CartaoDeIndicador
        rotulo="Novos na vigência"
        valor={formatNumber(resumo.novosNaVigencia, 0)}
        nota="entraram na comparada"
        ajuda="Um implemento alugado que entra traz um custo mensal novo, sem vigência anterior com que ser comparado."
        icone={LogIn}
      />
      <CartaoDeIndicador
        rotulo="Ausentes na comparada"
        valor={formatNumber(resumo.ausentesNaComparada, 0)}
        nota="saíram desde a base"
        ajuda="Um implemento alugado que sai leva embora o custo mensal dele."
        icone={LogOut}
        corDoIcone="bg-destructive/10 text-destructive"
        corDoValor={resumo.ausentesNaComparada > 0 ? "text-destructive" : undefined}
      />
      <CartaoDeIndicador
        destaque
        rotulo="Impacto no aluguel"
        valor={principal ? principal.valor : "Nenhum aluguel se moveu"}
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
          ) : alugueisAlterados > 0 ? (
            `${formatNumber(alugueisAlterados, 0)} ${
              alugueisAlterados === 1 ? "aluguel mudou" : "aluguéis mudaram"
            } sem que o motor os precificasse`
          ) : (
            "nenhum contrato de locação mudou de valor entre estas duas vigências"
          )
        }
        ajuda={
          "O aluguel é MENSAL, confirmado pela curadoria, e este módulo é quem o soma. A " +
          "parcela FINAME que o contém fica fora deste total e sai do total da Auditoria " +
          "de FINAME quando o aluguel se move — as duas são o mesmo dinheiro."
        }
        icone={Key}
      />
    </div>
  );
}
