import {
  CircleSlash,
  Info,
  ListChecks,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { Link } from "wouter";
import type {
  QuadroNoMonitor,
  ResumoDoMonitorDeEquipe,
} from "@workspace/comparison/monitor-equipe";
import { CartaoDeIndicador } from "@/components/ui/cartao-de-indicador";
import { Superficie } from "@/components/ui/superficie";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A primeira linha do Monitor Equipe — e a linha que **não** existe nela.
 *
 * Não há cartão de impacto em reais, e a ausência é o conteúdo. As colunas do
 * QLP chegam sem semântica confirmada, e um número em reais aqui seria a
 * primeira soma monetária do quadro de pessoal no produto inteiro, publicada
 * justamente na tela que consolida dezesseis recortes. No lugar dele vai a
 * frase do travamento, abaixo dos quadros, escrita por extenso — porque um
 * espaço em branco onde a outra seção mostra dinheiro seria lido como dado
 * faltando, e não como uma recusa.
 *
 * Os cartões de contagem ficam: alteração soma com alteração, e cargo com
 * cargo.
 */
export function CartoesDoMonitorDeEquipe({
  resumo,
}: {
  resumo: ResumoDoMonitorDeEquipe;
}) {
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
          rotulo="Cargos afetados"
          valor={formatNumber(resumo.cargosAfetados, 0)}
          nota="Distintos, sem contar o mesmo duas vezes"
          icone={Users}
          ajuda="O mesmo cargo aparece em salário e em encargos; aqui ele conta uma vez. Somar as contagens de cada módulo daria mais cargos do que o quadro tem."
        />
        <CartaoDeIndicador
          rotulo="Cargos que entraram"
          valor={formatNumber(resumo.cargosQueEntraram, 0)}
          nota="Novos no quadro da vigência"
          icone={UserPlus}
          corDoIcone="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
        />
        <CartaoDeIndicador
          rotulo="Cargos que saíram"
          valor={formatNumber(resumo.cargosQueSairam, 0)}
          nota="Ausentes na vigência comparada"
          icone={UserMinus}
          corDoIcone="bg-destructive/10 text-destructive"
        />
        <CartaoDeIndicador
          rotulo="Sem valoração"
          valor={formatNumber(resumo.porSituacao.SEM_VALORACAO, 0)}
          nota="Colunas de dinheiro que o QLP não precifica"
          icone={CircleSlash}
          corDoIcone="bg-amber-500/10 text-amber-700 dark:text-amber-400"
          ajuda="Alterações em coluna de dinheiro que não viraram número. Não são R$ 0,00: são a ausência de uma medição, e o motivo está no painel de cada linha."
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {resumo.porQuadro.map((quadro) => (
          <BlocoDoQuadro key={quadro.quadro} quadro={quadro} />
        ))}
      </div>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{resumo.semImpactoFinanceiro}</span>
      </p>
    </div>
  );
}

/**
 * Um quadro — o par dele, o que ele moveu e o efetivo das duas pontas.
 *
 * **O quadro sem par aparece assim mesmo, dizendo por quê.** Escondê-lo faria a
 * ausência parecer escolha da tela, e abri-lo zerado faria parecer que nada
 * mudou. A terceira saída é a única verdadeira, e é a mesma que a aba sem
 * coluna já adota nas telas por assunto.
 *
 * O efetivo é a **única** soma desta tela, e ela vem dos totais das duas pontas
 * inteiras — não da lista de alterações. Um cargo que sai do quadro é uma linha
 * só no motor, sem atributo: derivada da lista, a diferença mostrava −1 num
 * quadro que perdeu quatro posições.
 */
function BlocoDoQuadro({ quadro }: { quadro: QuadroNoMonitor }) {
  if (quadro.par === null) {
    return (
      <Superficie className="flex flex-col gap-1 px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {quadro.rotulo}
        </h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {quadro.ausente ?? "Este quadro não entrou nesta leitura."}
        </p>
        <Link
          href={quadro.rota}
          className="w-fit text-xs font-medium text-brand underline-offset-2 hover:underline"
        >
          Abrir o {quadro.rotulo}
        </Link>
      </Superficie>
    );
  }

  const efetivo = quadro.efetivo;
  return (
    <Superficie className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {quadro.rotulo}
        </h3>
        <span className="text-[0.7rem] text-muted-foreground">
          {quadro.par.baseRotulo ?? "—"} → {quadro.par.comparadaRotulo ?? "—"}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <Par rotulo="Alterações" valor={formatNumber(quadro.alteracoes, 0)} />
        <Par rotulo="Cargos afetados" valor={formatNumber(quadro.cargosAfetados, 0)} />
      </dl>

      {efetivo && (
        <div className="border-t pt-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium">Efetivo do quadro</span>
            <span
              className={cn(
                "font-mono text-sm font-semibold tabular-nums",
                efetivo.diferenca !== null &&
                  efetivo.diferenca > 0 &&
                  "text-destructive",
                efetivo.diferenca !== null &&
                  efetivo.diferenca < 0 &&
                  "text-emerald-700 dark:text-emerald-400",
              )}
            >
              {escreverEfetivo(efetivo.base)} → {escreverEfetivo(efetivo.comparada)}
              {efetivo.diferenca !== null && (
                <span className="ml-1">
                  ({efetivo.diferenca > 0 ? "+" : ""}
                  {formatNumber(efetivo.diferenca, 0)})
                </span>
              )}
            </span>
          </div>
          <p className="mt-0.5 text-[0.7rem] leading-snug text-muted-foreground">
            Posições, não reais. A diferença sai dos totais das duas vigências
            inteiras — {formatNumber(efetivo.cargosQueSubiram, 0)} cargos subiram e{" "}
            {formatNumber(efetivo.cargosQueDesceram, 0)} desceram na lista de
            alterações.
            {efetivo.semLeitura > 0 &&
              ` ${formatNumber(efetivo.semLeitura, 0)} linha(s) de efetivo o motor não pôs lado a lado.`}
          </p>
        </div>
      )}
    </Superficie>
  );
}

/** O efetivo de uma ponta. **Nulo não é zero** — é "não sabemos". */
function escreverEfetivo(valor: number | null): string {
  return valor === null ? "—" : formatNumber(valor, 0);
}

function Par({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="font-mono tabular-nums">{valor}</dd>
    </div>
  );
}
