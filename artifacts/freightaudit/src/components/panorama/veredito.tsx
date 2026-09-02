import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { comSinal } from "@/lib/impacto-apurado";
import { escreverVariacao } from "@/lib/visao-geral";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Veredito as DadosDoVeredito } from "@/lib/panorama";

/**
 * Andar 1 — o veredito. *"Quanto custou esta vigência?"*
 *
 * **Um número em corpo grande, e só ele.** É a diferença entre este andar e a
 * manchete do Impacto Apurado, que publica o líquido ao lado de quatro
 * indicadores do mesmo tamanho: ali os quatro competem com o número pelo olho
 * de quem abre, e aqui eles descem inteiros para o andar 2, onde são cinco e
 * têm a régua de um placar. Um andar, uma pergunta.
 *
 * O que fica ao lado do número são as duas parcelas que o produzem — ganhos e
 * perdas — e a variação contra a vigência anterior. As três em corpo pequeno,
 * porque nenhuma delas é a resposta: são o que explica a resposta.
 *
 * **A periodicidade nunca some.** Ela viaja colada no número, e as outras
 * periodicidades da vigência saem em linha própria embaixo — R$/mês e R$/ano
 * não somam, aqui nem em lugar nenhum do produto. Uma vigência com valor anual
 * cujo mensal pesa mais publicaria só o mensal, e o anual desapareceria da tela
 * sem que nada dissesse que ele existe.
 *
 * A faixa de confiança não está aqui: é a `FaixaDeCobertura` do Impacto
 * Apurado, desenhada logo abaixo pela tela. Ela já existia, já tinha as frases
 * e já tinha a régua de cor — reescrevê-la seria a duplicação que este módulo
 * veio desfazer.
 */
export function Veredito({ veredito }: { veredito: DadosDoVeredito }) {
  const { situacao } = veredito;
  const lados = situacao.estado === "com_movimento" ? situacao.lados : null;

  const sufixo = lados
    ? periodicitySuffix(lados.periodicity)
    : situacao.estado === "apurado_em_zero"
      ? periodicitySuffix(situacao.periodicity)
      : "";

  return (
    <section
      className="bg-card border rounded-xl shadow-sm px-6 py-6"
      aria-label="O veredito da vigência"
    >
      <p className="text-[11px] font-bold tracking-[0.14em] uppercase text-muted-foreground">
        Impacto líquido apurado
      </p>

      <div className="mt-3 flex items-end justify-between gap-x-10 gap-y-5 flex-wrap">
        <div className="min-w-0">
          {lados || situacao.estado === "apurado_em_zero" ? (
            <p className="flex items-baseline gap-2 flex-wrap">
              <span
                className={cn(
                  "text-4xl sm:text-5xl font-extrabold tabular-nums leading-none whitespace-nowrap",
                  lados && lados.liquido < 0 ? "text-brand-red" : "text-success",
                )}
              >
                {comSinal(lados ? lados.liquido : 0)}
              </span>
              {sufixo && (
                <span className="text-base font-semibold text-muted-foreground">{sufixo}</span>
              )}
            </p>
          ) : (
            <p className="text-3xl font-extrabold leading-tight">
              {situacao.estado === "sem_alteracao" ? "Nada mudou" : "Nenhum valor apurado"}
            </p>
          )}

          <Variacao variacao={veredito.variacaoDoLiquido} />
        </div>

        {lados && (
          <div className="flex gap-8">
            <Parcela rotulo="ganhos" valor={comSinal(lados.ganhos)} className="text-success" />
            <Parcela
              rotulo="perdas"
              valor={formatBrlShort(lados.perdas)}
              className="text-brand-red"
            />
          </div>
        )}
      </div>

      {/*
        Líquido zero tem duas causas, e elas pedem conversas diferentes: ganho e
        perda que se anularam, ou linhas apuradas em R$ 0,00. A primeira é dita
        aqui porque o número sozinho não a mostra — a mesma frase que a manchete
        do Impacto Apurado escreve, pela mesma razão.
      */}
      {lados && lados.liquido === 0 && lados.ganhos > 0 && (
        <p className="text-xs text-muted-foreground mt-4 leading-snug">
          Ganhos e perdas se compensaram: {formatBrlShort(lados.ganhos)} de um lado e{" "}
          {formatBrlShort(lados.perdas)} do outro.
        </p>
      )}

      {veredito.outras.length > 0 && (
        <p className="text-xs text-muted-foreground mt-4 leading-snug border-t pt-3">
          Esta vigência também tem{" "}
          {veredito.outras
            .map((l) => `${formatBrlShort(l.liquido)}${periodicitySuffix(l.periodicity)}`)
            .join(" e ")}{" "}
          — grandezas que não somam com a de cima.
        </p>
      )}
    </section>
  );
}

/**
 * A variação contra a vigência anterior — **e o silêncio quando não há uma**.
 *
 * `null` chega em três casos que a tela não distingue de propósito, porque a
 * consequência dos três é a mesma: não há comparação honesta a escrever. São
 * eles a primeira vigência da série, a vigência sem líquido apurado, e o par
 * cujas periodicidades não batem — ver `vereditoDoPanorama`. Escrever "—" ou
 * "0%" em qualquer um deles seria inventar uma comparação.
 */
function Variacao({ variacao }: { variacao: number | null }) {
  if (variacao === null) return null;

  /*
    O sinal do percentual não diz se a notícia é boa: uma variação positiva sobre
    um líquido negativo é uma perda que aumentou. Por isso a seta descreve o
    movimento (subiu/desceu) e a cor fica de fora — quem qualifica o resultado é
    o número grande logo acima, que já sai vermelho ou verde.
  */
  const Icone = variacao > 0 ? ArrowUpRight : variacao < 0 ? ArrowDownRight : Minus;

  return (
    <p className="text-sm font-semibold text-muted-foreground mt-2 flex items-center gap-1">
      <Icone className="w-4 h-4" />
      {escreverVariacao(variacao)} vs vigência anterior
    </p>
  );
}

function Parcela({
  rotulo,
  valor,
  className,
}: {
  rotulo: string;
  valor: string;
  className: string;
}) {
  return (
    <div>
      <p className={cn("text-xl font-extrabold tabular-nums leading-none", className)}>{valor}</p>
      <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground mt-1.5">
        {rotulo}
      </p>
    </div>
  );
}
