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
 * **Duas colunas, e um risco entre elas.** À esquerda a resposta; à direita, sob
 * o rótulo *Composição*, as duas parcelas e a barra que as põe em proporção. A
 * divisória existe porque as duas colunas respondem a perguntas diferentes —
 * "quanto sobrou" e "de onde saiu" —, e sem ela os quatro números do cartão se
 * leem como uma fileira só, em que o olho procura qual é o principal. Abaixo de
 * `md` as duas empilham e o risco vira o traço horizontal entre elas: o líquido
 * em corpo grande e a composição ao lado não cabem juntos num cartão estreito
 * sem que um dos dois quebre no meio.
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
      <div className="flex flex-col gap-5 md:flex-row md:items-stretch md:gap-10">
        <div className="min-w-0 md:flex-1">
          <Rotulo>Impacto líquido apurado</Rotulo>

          {lados || situacao.estado === "apurado_em_zero" ? (
            <p className="mt-3 flex items-baseline gap-2 flex-wrap">
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
            <p className="mt-3 text-3xl font-extrabold leading-tight">
              {situacao.estado === "sem_alteracao" ? "Nada mudou" : "Nenhum valor apurado"}
            </p>
          )}

          <Variacao variacao={veredito.variacaoDoLiquido} />
        </div>

        {lados && (
          <div className="border-t pt-5 md:border-t-0 md:pt-0 md:border-l md:pl-10 md:w-[21rem] md:shrink-0">
            <Rotulo>Composição</Rotulo>

            <div className="mt-3 grid grid-cols-2">
              <Parcela rotulo="ganhos" valor={comSinal(lados.ganhos)} tom="text-success" />
              <Parcela
                rotulo="perdas"
                valor={formatBrlShort(lados.perdas)}
                tom="text-brand-red"
                className="border-l pl-5"
              />
            </div>

            <Balanca fatiaDeGanho={lados.fatiaDeGanho} />
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
 * O rótulo de uma coluna. Os dois são iguais de propósito: nenhuma das duas
 * colunas manda na outra, e o que separa a resposta da explicação é o tamanho
 * dos números embaixo, não o peso do título.
 */
function Rotulo({ children }: { children: string }) {
  return (
    <p className="text-[11px] font-bold tracking-[0.14em] uppercase text-muted-foreground">
      {children}
    </p>
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
    o número grande logo acima, que já sai vermelho ou verde. A pílula é cinza
    pela mesma razão: um fundo verde ou vermelho aqui é a mesma opinião que a
    cor da letra daria, com mais tinta.
  */
  const Icone = variacao > 0 ? ArrowUpRight : variacao < 0 ? ArrowDownRight : Minus;

  return (
    <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-sm font-semibold text-muted-foreground">
      <Icone className="w-4 h-4 shrink-0" />
      {escreverVariacao(variacao)} vs vigência anterior
    </p>
  );
}

function Parcela({
  rotulo,
  valor,
  tom,
  className,
}: {
  rotulo: string;
  valor: string;
  tom: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className={cn("text-xl font-extrabold tabular-nums leading-none", tom)}>{valor}</p>
      <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground mt-1.5">
        {rotulo}
      </p>
    </div>
  );
}

/**
 * A barra dos dois lados — verde à esquerda, vermelho à direita.
 *
 * Ela mede **movimento**, e não saldo: a fatia verde é `ganhos ÷ (ganhos +
 * |perdas|)`, a mesma conta da balança da Composição do impacto e do cartão da
 * família. O que ela acrescenta ao par de números logo acima é a proporção
 * entre eles, que dois valores lado a lado obrigam a estimar de cabeça.
 *
 * Sem movimento nenhum a barra não é desenhada: meia barra cinza seria a figura
 * de um empate que não aconteceu. As duas fatias são as cores dos dois números
 * que elas explicam — as mesmas `success` e `brand-red` das parcelas, e não o
 * `emerald`/`red` cru das outras balanças, que dentro deste cartão leria como
 * um terceiro verde.
 */
function Balanca({ fatiaDeGanho }: { fatiaDeGanho: number | null }) {
  if (fatiaDeGanho === null) return null;
  const verde = Math.round(Math.max(0, Math.min(1, fatiaDeGanho)) * 100);

  return (
    <div
      className="mt-5 flex h-1.5 w-full gap-1"
      aria-hidden="true"
      title={`Do que se mexeu nesta vigência, ${verde}% foi para cima.`}
    >
      {/*
        A fatia de 0% não vira um traço de 1px: ela não é desenhada. Uma vigência
        só de ganhos tem uma barra verde inteira, e não uma barra verde com um
        cisco vermelho na ponta que ninguém sabe medir.
      */}
      {verde > 0 && (
        <span className="h-full rounded-full bg-success" style={{ width: `${verde}%` }} />
      )}
      {verde < 100 && (
        <span className="h-full rounded-full bg-brand-red" style={{ width: `${100 - verde}%` }} />
      )}
    </div>
  );
}
