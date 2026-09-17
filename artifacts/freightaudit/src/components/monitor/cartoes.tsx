import { ArrowDownRight, ArrowUpRight, CircleSlash, Layers, ListChecks, Users } from "lucide-react";
import type { BaldeDoMonitor, ResumoDoMonitor } from "@workspace/comparison/monitor-custo-fixo";
import { CartaoDeIndicador } from "@/components/ui/cartao-de-indicador";
import { Superficie } from "@/components/ui/superficie";
import { formatBrl, formatNumber } from "@/lib/format";
import {
  baldesVisiveis,
  corDoValor,
  rotuloDaPeriodicidade,
  SUFIXO_DA_PERIODICIDADE,
} from "@/lib/monitor-custo-fixo";
import { cn } from "@/lib/utils";

/**
 * A primeira linha do Monitor — e a linha que **não** existe nela.
 *
 * Não há cartão de "Impacto líquido". Ele seria um escalar, e um escalar aqui
 * teria de escolher entre somar R$/mês com R$/ano — que é mentira — ou escolher
 * uma periodicidade e chamá-la de total — que é mentira mais silenciosa. O
 * impacto mora no bloco abaixo dos cartões, um quadro por periodicidade.
 *
 * Os cartões de contagem ficam: eles contam alterações, e alteração soma com
 * alteração em qualquer periodicidade.
 */
export function CartoesDoMonitor({ resumo }: { resumo: ResumoDoMonitor }) {
  const baldes = baldesVisiveis(resumo);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <CartaoDeIndicador
          rotulo="Alterações identificadas"
          valor={formatNumber(resumo.alteracoes, 0)}
          nota="Em todos os módulos do recorte"
          icone={ListChecks}
          destaque
        />
        <CartaoDeIndicador
          rotulo="Ganhos"
          valor={formatNumber(resumo.ganhos, 0)}
          nota="Alterações com valor positivo"
          icone={ArrowUpRight}
          corDoIcone="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
        />
        <CartaoDeIndicador
          rotulo="Perdas"
          valor={formatNumber(resumo.perdas, 0)}
          nota="Alterações com valor negativo"
          icone={ArrowDownRight}
          corDoIcone="bg-destructive/10 text-destructive"
        />
        <CartaoDeIndicador
          rotulo="Sem valoração"
          valor={formatNumber(resumo.porSituacao.SEM_VALORACAO, 0)}
          nota="Mudaram, e o motor não pôde precificar"
          icone={CircleSlash}
          corDoIcone="bg-amber-500/10 text-amber-700 dark:text-amber-400"
          ajuda="Alterações em coluna de dinheiro que não viraram número, cada uma com o motivo do motor. Não são R$ 0,00: são a ausência de uma medição."
        />
        <CartaoDeIndicador
          rotulo="Entidades afetadas"
          valor={formatNumber(resumo.entidadesAfetadas, 0)}
          nota="Distintas, sem contar a mesma duas vezes"
          icone={Users}
          ajuda="O mesmo cavalo aparece no FINAME e no IPVA; aqui ele conta uma vez. Somar as contagens de cada módulo daria mais veículos do que a frota tem."
        />
      </div>

      <BlocosDePeriodicidade resumo={resumo} baldes={baldes} />
    </div>
  );
}

/**
 * O impacto, um quadro por periodicidade — o líquido, aberto em ganho e perda.
 *
 * **É aqui que a tela recusa o número único.** Cada quadro diz a sua
 * periodicidade no título e repete o sufixo no valor, de modo que nem a leitura
 * rápida nem a cópia para uma planilha consigam juntar dois quadros sem
 * perceber.
 *
 * Dentro do quadro há **um** número em corpo grande: o líquido daquela
 * periodicidade. Ele lê-se pelo sinal e pela cor, pela mesma régua do resto do
 * produto — positivo é ganho e sai em verde, negativo é perda e sai em
 * vermelho, zero não é nem um nem outro e sai sem cor de direção.
 *
 * Houve aqui duas linhas, "Custo" e "Receita", e uma terceira somando as duas.
 * A linha do custo invertia a cor — custo que cai é bom —, e o que aparecia na
 * tela era `−R$ 144.874,50/ano` em verde: um número negativo pintado de
 * positivo, exatamente a leitura que o produto removeu do FINAME em
 * `docs/PROVA-DA-EVOLUCAO-DE-FINAME.md`. Com um idioma só, a inversão não tem
 * mais o que fazer e o quadro volta a ter um número.
 *
 * A abertura em ganho e perda fica logo abaixo, em corpo pequeno, e ela não é
 * um número novo: `ganho + perda` é o próprio líquido acima.
 */
function BlocosDePeriodicidade({
  resumo,
  baldes,
}: {
  resumo: ResumoDoMonitor;
  baldes: ReturnType<typeof baldesVisiveis>;
}) {
  if (baldes.length === 0) {
    return (
      <Superficie className="px-4 py-3 text-xs text-muted-foreground">
        Nenhuma alteração deste recorte virou dinheiro. As{" "}
        {formatNumber(resumo.alteracoes, 0)} alterações continuam na tabela, com a
        situação de cada uma.
      </Superficie>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
      {baldes.map((balde) => (
        <QuadroDaPeriodicidade key={balde.periodicidade} balde={balde} />
      ))}
    </div>
  );
}

function QuadroDaPeriodicidade({ balde }: { balde: BaldeDoMonitor }) {
  const sufixo = SUFIXO_DA_PERIODICIDADE[balde.periodicidade] ?? "";
  return (
    <Superficie className="flex flex-col gap-2 px-4 py-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Impacto {rotuloDaPeriodicidade(balde.periodicidade).toLowerCase()}
      </h3>

      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Impacto líquido</span>
        <span
          className={cn(
            "font-mono text-base font-semibold tabular-nums",
            corDoValor(balde.liquido),
          )}
        >
          {formatBrl(balde.liquido)}
          {sufixo}
        </span>
      </div>

      <p className="mt-0.5 flex items-center gap-2 text-[0.7rem] text-muted-foreground">
        <Layers className="h-3 w-3" aria-hidden="true" />
        <span>
          {formatBrl(balde.ganho)} de ganhos e {formatBrl(balde.perda)} de perdas
        </span>
      </p>
    </Superficie>
  );
}
