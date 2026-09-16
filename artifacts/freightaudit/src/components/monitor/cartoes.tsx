import { ArrowDownRight, ArrowUpRight, CircleSlash, Layers, ListChecks, Users } from "lucide-react";
import type { ResumoDoMonitor } from "@workspace/comparison/monitor-custo-fixo";
import { ROTULO_DA_NATUREZA } from "@workspace/comparison/monitor-custo-fixo";
import { CartaoDeIndicador } from "@/components/ui/cartao-de-indicador";
import { Superficie } from "@/components/ui/superficie";
import { formatBrl, formatNumber } from "@/lib/format";
import {
  baldesVisiveis,
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
 * impacto mora no bloco abaixo dos cartões, um quadro por periodicidade, e cada
 * quadro separa custo de receita.
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
          rotulo="Aumentos"
          valor={formatNumber(resumo.aumentos, 0)}
          nota="Alterações em que a rubrica subiu"
          icone={ArrowUpRight}
          corDoIcone="bg-destructive/10 text-destructive"
        />
        <CartaoDeIndicador
          rotulo="Reduções"
          valor={formatNumber(resumo.reducoes, 0)}
          nota="Alterações em que a rubrica caiu"
          icone={ArrowDownRight}
          corDoIcone="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
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
 * O impacto, um quadro por periodicidade, com custo e receita separados.
 *
 * **É aqui que a tela recusa o número único.** Cada quadro diz a sua
 * periodicidade no título e repete o sufixo em cada valor, de modo que nem a
 * leitura rápida nem a cópia para uma planilha consigam juntar dois quadros
 * sem perceber.
 *
 * Dentro do quadro, custo e receita são duas linhas, e `resultado` é a terceira
 * — com a conta escrita ao lado, em vez de pedir confiança.
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
      {baldes.map((balde) => {
        const sufixo = SUFIXO_DA_PERIODICIDADE[balde.periodicidade] ?? "";
        const temReceita = balde.receita.liquido !== 0;
        return (
          <Superficie key={balde.periodicidade} className="flex flex-col gap-2 px-4 py-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Impacto {rotuloDaPeriodicidade(balde.periodicidade).toLowerCase()}
            </h3>

            <LinhaDoQuadro
              rotulo={ROTULO_DA_NATUREZA.CUSTO}
              valor={balde.custo.liquido}
              sufixo={sufixo}
              aumentos={balde.custo.aumentos}
              reducoes={balde.custo.reducoes}
              /* Mais custo é pior: o vermelho é legítimo aqui. */
              inverso={false}
            />

            {temReceita && (
              <LinhaDoQuadro
                rotulo={ROTULO_DA_NATUREZA.RECEITA}
                valor={balde.receita.liquido}
                sufixo={sufixo}
                aumentos={balde.receita.aumentos}
                reducoes={balde.receita.reducoes}
                /* Mais receita é melhor: o mesmo sinal, o outro sentido. */
                inverso
              />
            )}

            {temReceita && (
              <div className="mt-1 border-t pt-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium">Efeito no resultado</span>
                  <span className="font-mono text-sm font-semibold tabular-nums">
                    {formatBrl(balde.resultado)}
                    {sufixo}
                  </span>
                </div>
                <p className="mt-0.5 text-[0.7rem] leading-snug text-muted-foreground">
                  Receita − custo, nesta periodicidade. Os dois componentes estão
                  acima; esta linha não substitui nenhum deles.
                </p>
              </div>
            )}
          </Superficie>
        );
      })}
    </div>
  );
}

function LinhaDoQuadro({
  rotulo,
  valor,
  sufixo,
  aumentos,
  reducoes,
  inverso,
}: {
  rotulo: string;
  valor: number;
  sufixo: string;
  aumentos: number;
  reducoes: number;
  inverso: boolean;
}) {
  /*
    A cor diz se o movimento é bom ou ruim, e o sentido depende do lado da DRE:
    custo que sobe é vermelho, receita que sobe é verde. O sinal do número não
    é tocado — o que muda é só a cor, e nunca sozinha: o rótulo "Custo" ou
    "Receita" está ao lado, e a decomposição abaixo diz para que lado foi.
  */
  const ruim = inverso ? valor < 0 : valor > 0;
  const bom = inverso ? valor > 0 : valor < 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{rotulo}</span>
        <span
          className={cn(
            "font-mono text-base font-semibold tabular-nums",
            ruim && "text-destructive",
            bom && "text-emerald-700 dark:text-emerald-400",
          )}
        >
          {formatBrl(valor)}
          {sufixo}
        </span>
      </div>
      <p className="mt-0.5 flex items-center gap-2 text-[0.7rem] text-muted-foreground">
        <Layers className="h-3 w-3" aria-hidden="true" />
        <span>
          {formatBrl(aumentos)} de aumentos e {formatBrl(reducoes)} de reduções
        </span>
      </p>
    </div>
  );
}
