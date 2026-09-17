import { ArrowRightLeft, Equal, LogIn, LogOut, Receipt, Truck } from "lucide-react";
import { CartaoDeIndicador } from "@/components/ui/cartao-de-indicador";
import { formatNumber } from "@/lib/format";
import type { ComparacaoDeAquisicao } from "@/lib/aquisicao";

/**
 * Os seis indicadores do topo.
 *
 * Nenhum deles é calculado aqui: todos vêm de `resumirAquisicao`, no núcleo, que
 * é o mesmo que alimenta os gráficos e a tabela. O que este componente decide é
 * ordem, ícone e cor.
 *
 * **O sexto cartão nunca mostra reais, e isso é o desenho.** A base de compra
 * não tem módulo dono — `finame.ts`, `ipva.ts` e `impostos.ts` recusam somá-la
 * com a mesma frase, "preço do ativo não é custo fixo", e um teste-portão prende
 * essa recusa. Ganhar tela própria não muda a natureza da coluna: esta tela é
 * onde a nota é **conferida**, não onde ela é somada.
 *
 * Então o cartão conta em vez de somar — quantas notas se moveram —, e no acervo
 * de hoje esse número é zero, porque cada ativo tem um único valor de nota ao
 * longo das 18 vigências (`docs/ACHADO-AQUISICAO.md`). Um cartão que parasse em
 * "R$ 0,00" seria lido como "as notas mudaram e se anularam", que é outra coisa.
 */
export function CartoesDeAquisicao({ resumo }: { resumo: ComparacaoDeAquisicao["resumo"] }) {
  const { notasAlteradas } = resumo.impacto;
  const fracaoSemAlteracao =
    resumo.veiculosComparados === 0
      ? null
      : (resumo.semAlteracao / resumo.veiculosComparados) * 100;
  const entradasESaidas = resumo.novosNaVigencia + resumo.ausentesNaComparada;

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
        ajuda="Comparados em que nenhuma coluna de aquisição se moveu. Nesta rubrica é o caso esperado: uma compra já feita não muda de preço."
        icone={Equal}
        corDoIcone="bg-success/10 text-success"
      />
      <CartaoDeIndicador
        rotulo="Ativos com alteração"
        valor={formatNumber(resumo.veiculosComAlteracao, 0)}
        nota={`${formatNumber(resumo.variaveisAlteradas, 0)} ${
          resumo.variaveisAlteradas === 1 ? "variável alterada" : "variáveis alteradas"
        }`}
        ajuda="Qualquer número diferente de zero aqui é achado: no acervo inteiro nenhuma coluna de aquisição mudou de valor."
        icone={ArrowRightLeft}
        corDoIcone="bg-warning/15 text-warning-foreground"
        corDoValor={resumo.veiculosComAlteracao > 0 ? "text-warning-foreground" : undefined}
      />
      <CartaoDeIndicador
        rotulo="Novos na vigência"
        valor={formatNumber(resumo.novosNaVigencia, 0)}
        nota="entraram na comparada"
        ajuda="Cada ativo que entra traz uma nota nova ao acervo — e ela entra sem vigência anterior com que ser conferida. É o movimento que esta tela de fato acompanha."
        icone={LogIn}
      />
      <CartaoDeIndicador
        rotulo="Ausentes na comparada"
        valor={formatNumber(resumo.ausentesNaComparada, 0)}
        nota="saíram desde a base"
        ajuda="Ao sair, a nota do ativo deixa de compor o valor da frota — e o IPVA, o ICMS, o PIS/COFINS e o FINAME dela saem junto."
        icone={LogOut}
        corDoIcone="bg-destructive/10 text-destructive"
        corDoValor={resumo.ausentesNaComparada > 0 ? "text-destructive" : undefined}
      />
      <CartaoDeIndicador
        destaque
        rotulo="Notas de compra alteradas"
        valor={formatNumber(notasAlteradas, 0)}
        corDoValor={notasAlteradas > 0 ? "text-warning-foreground" : undefined}
        nota={
          notasAlteradas > 0
            ? "a base do IPVA, do ICMS, do PIS/COFINS e do FINAME mudou nestes ativos"
            : entradasESaidas > 0
              ? `nenhuma nota mudou de valor · ${formatNumber(entradasESaidas, 0)} ${
                  entradasESaidas === 1
                    ? "ativo entrou ou saiu da frota"
                    : "ativos entraram ou saíram da frota"
                }`
              : "nem o preço nem a frota se moveram entre estas duas vigências"
        }
        ajuda={
          "Esta rubrica conta em vez de somar: o preço de compra do ativo não é custo do " +
          "período, e nenhum módulo do produto o soma — nem este. O que a tela vigia é se " +
          "ele muda, porque uma nota que se mexe move quatro rubricas de uma vez."
        }
        icone={Receipt}
      />
    </div>
  );
}
