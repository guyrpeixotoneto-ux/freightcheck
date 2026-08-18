import { cn } from "@/lib/utils";
import { formatBrl, formatBrlShort, formatPercent } from "@/lib/format";
import type { ApuracaoDaDRE, ConsolidadoDaDRE, LinhaDaDRE, SecaoId } from "./tipos";

/**
 * O resumo em três números — receita, custo, resultado — e o que forma cada um.
 *
 * Existe porque a cascata responde a pergunta errada primeiro. Quem chega aqui
 * vindo de uma linha do ranking já viu três números lá (`R$ 19.213,13`,
 * `R$ 19.934,92`, `−R$ 721,79`) e vem com uma pergunta só: **de onde saíram
 * esses três**. A cascata responde isso, mas depois de cinco seções fechadas,
 * cinco subtotais e vinte e uma linhas — e para chegar ao "R$ 19.934,92" da
 * tabela é preciso somar quatro seções de cabeça, porque nenhum subtotal da
 * demonstração é o custo total.
 *
 * Então este bloco é a mesma conta com a aritmética já feita, e nada mais: o
 * que entra, o que sai, e a diferença. Sem seção, sem subtotal intermediário,
 * sem "não apurável". A demonstração inteira continua logo abaixo para quem
 * quiser a conta contábil; o que este bloco não pode fazer é ser um segundo
 * lugar onde os números moram — ele deriva das mesmas linhas, pelas mesmas
 * regras que o ranking usa (`lib/dre/src/frota.ts`), e é por isso que os três
 * números batem com os da tabela de onde a pessoa veio.
 *
 * O que ele **não** esconde: as linhas sem dado. Um resumo que somasse só o que
 * existe e calasse sobre o resto seria a tela afirmando completude — o oposto
 * do produto. Elas viram uma frase no rodapé, com a direção do erro dita ("o
 * custo real é maior"), que é a única coisa que se pode afirmar sem o número.
 */

/** Um componente do resumo, já com o sinal desfeito: valor sempre positivo. */
interface ItemDoResumo {
  code: string;
  titulo: string;
  secao: SecaoId;
  valor: number;
  /** Fatia deste item dentro do seu grupo — receita ou custo. */
  fatia: number | null;
}

const ROTULO_CURTO_DA_SECAO: Record<SecaoId, string> = {
  RECEITA_BRUTA: "Receita",
  DEDUCOES: "Impostos",
  CUSTO_VARIAVEL: "Custo variável",
  CUSTO_FIXO: "Custo fixo",
  DEPRECIACAO_FINANCEIRO: "Depreciação e financeiro",
};

function itens(linhas: LinhaDaDRE[], total: number): ItemDoResumo[] {
  return linhas
    .map((l) => ({
      code: l.code,
      titulo: l.titulo,
      secao: l.secao,
      valor: Math.abs(l.contribuicao!),
      fatia: total === 0 ? null : (Math.abs(l.contribuicao!) / total) * 100,
    }))
    .sort((a, b) => b.valor - a.valor);
}

/**
 * A conta do resumo, derivada das linhas.
 *
 * `contribuicao` já é `valor × sinal`, então somar as seções de custo devolve um
 * número negativo e o custo é o oposto dele. É exatamente a conta que o ranking
 * faz (`custo = receita − resultado`), escrita do outro lado da igualdade — e a
 * razão de os dois nunca divergirem.
 */
export function resumir(dre: ApuracaoDaDRE | ConsolidadoDaDRE) {
  const todas = dre.secoes.flatMap((s) => s.linhas).filter((l) => l.contribuicao !== null);
  const daReceita = todas.filter((l) => l.secao === "RECEITA_BRUTA");
  const doCusto = todas.filter((l) => l.secao !== "RECEITA_BRUTA");

  const receita = Number(daReceita.reduce((s, l) => s + l.contribuicao!, 0).toFixed(2));
  const custo = Number(-doCusto.reduce((s, l) => s + l.contribuicao!, 0).toFixed(2));

  const semDado = dre.cobertura.itens.filter((i) => !i.apurado);

  return {
    receita,
    custo,
    resultado: Number((receita - custo).toFixed(2)),
    margem: receita === 0 ? null : ((receita - custo) / receita) * 100,
    itensDaReceita: itens(daReceita, receita),
    itensDoCusto: itens(doCusto, custo),
    receitaSemDado: semDado.filter((i) => i.secao === "RECEITA_BRUTA").length,
    custoSemDado: semDado.filter((i) => i.secao !== "RECEITA_BRUTA").length,
  };
}

/**
 * Uma frota ou uma unidade — o que está sendo somado.
 *
 * `unidades` é campo do consolidado e de mais nada: `consolidar` o preenche com
 * o número de apurações somadas, e `apurarUnidade` nunca o escreve. É o
 * discriminante que o próprio contrato oferece, e por isso vale em runtime e
 * não só no `tsc`.
 *
 * Existe nomeado, e testado, porque o erro que ele evita é mudo: sem ele o
 * bloco dizia "o que a unidade fatura" embaixo da soma de 71 delas, e uma
 * legenda que descreve a coisa errada é pior do que legenda nenhuma — quem lê
 * acredita, e não há número na tela que a desminta.
 */
export function ehConsolidado(
  dre: ApuracaoDaDRE | ConsolidadoDaDRE,
): dre is ConsolidadoDaDRE {
  return "unidades" in dre;
}

export function ResumoDaConta({
  dre,
  className,
}: {
  dre: ApuracaoDaDRE | ConsolidadoDaDRE;
  className?: string;
}) {
  const r = resumir(dre);
  const daFrota = ehConsolidado(dre);

  return (
    <div className={cn("border rounded-lg bg-card overflow-hidden", className)}>
      {/*
        A equação, e não três cartões soltos: os operadores entre os números são
        o que transforma "receita, custo, resultado" em "receita menos custo dá
        resultado". Em telas estreitas eles somem e viram três blocos empilhados,
        que é a leitura degradada aceitável — a ordem vertical diz o mesmo.
      */}
      <div className="grid sm:grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-x-4 gap-y-3 px-5 py-4">
        <Numero
          rotulo="Receita"
          valor={r.receita}
          detalhe={daFrota ? "o que a frota fatura" : "o que a unidade fatura"}
        />
        <Operador>−</Operador>
        <Numero rotulo="Custo" valor={r.custo} detalhe="o que ela consome" />
        <Operador>=</Operador>
        <Numero
          rotulo="Resultado"
          valor={r.resultado}
          detalhe={
            r.margem === null
              ? "sem receita para comparar"
              : `margem de ${formatPercent(r.margem, 1)}`
          }
          destaque
        />
      </div>

      <div className="grid md:grid-cols-2 border-t divide-y md:divide-y-0 md:divide-x">
        <Composicao
          titulo={daFrota ? "O que forma a receita da frota" : "O que forma a receita"}
          total={r.receita}
          itens={r.itensDaReceita}
          semDado={r.receitaSemDado}
          faltaDiz="A receita apurada pode estar abaixo da real."
        />
        <Composicao
          titulo={daFrota ? "O que forma o custo da frota" : "O que forma o custo"}
          total={r.custo}
          itens={r.itensDoCusto}
          comSecao
          semDado={r.custoSemDado}
          faltaDiz="O custo real é maior do que este — e o resultado, pior."
        />
      </div>
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  detalhe,
  destaque,
}: {
  rotulo: string;
  valor: number;
  detalhe: string;
  destaque?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
        {rotulo}
      </div>
      <div
        className={cn(
          "tabular-nums mt-1",
          destaque ? "text-2xl font-semibold" : "text-xl font-medium",
          destaque && valor < 0 && "text-brand-red",
        )}
      >
        {/*
          O sinal é o menos tipográfico, e não o hífen: em corpo grande o hífen
          encosta no cifrão e some, e uma perda lida como ganho é o erro mais
          caro que uma formatação pode cometer. Mesma regra de
          `formatBrlCompacto` em `lib/format.ts`.
        */}
        {valor < 0 ? "−" : ""}
        {formatBrlShort(Math.abs(valor))}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">{detalhe}</div>
    </div>
  );
}

function Operador({ children }: { children: React.ReactNode }) {
  return (
    <div className="hidden sm:block text-xl text-muted-foreground/60 tabular-nums" aria-hidden>
      {children}
    </div>
  );
}

/**
 * A lista de componentes — em ordem de tamanho, não de plano de contas.
 *
 * Quem pergunta "o que compõe este custo" está procurando o maior item, e a
 * ordem contábil o esconde no meio. A seção continua ao lado de cada linha,
 * em cinza, para quem precisa dela.
 */
function Composicao({
  titulo,
  total,
  itens,
  comSecao,
  semDado,
  faltaDiz,
}: {
  titulo: string;
  total: number;
  itens: ItemDoResumo[];
  comSecao?: boolean;
  semDado: number;
  faltaDiz: string;
}) {
  return (
    <section className="px-5 py-4">
      <div className="flex items-baseline justify-between gap-3 mb-2.5">
        <h3 className="text-sm font-semibold">{titulo}</h3>
        <span className="text-sm tabular-nums font-medium shrink-0">{formatBrl(total)}</span>
      </div>

      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum componente desta parte da conta tem valor nesta vigência.
        </p>
      ) : (
        <ul className="space-y-1">
          {itens.map((i) => (
            <li key={i.code} className="flex items-baseline gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {i.titulo}
                {comSecao && (
                  <span className="ml-2 text-[0.6875rem] text-muted-foreground">
                    {ROTULO_CURTO_DA_SECAO[i.secao]}
                  </span>
                )}
              </span>
              <span className="text-[0.6875rem] text-muted-foreground tabular-nums shrink-0 w-12 text-right">
                {i.fatia === null ? "—" : `${i.fatia.toFixed(0)}%`}
              </span>
              <span className="tabular-nums shrink-0 w-28 text-right">{formatBrl(i.valor)}</span>
            </li>
          ))}
        </ul>
      )}

      {semDado > 0 && (
        <p className="text-xs text-muted-foreground mt-3 pt-2.5 border-t">
          {semDado} {semDado === 1 ? "componente ficou" : "componentes ficaram"} de fora por não
          ter dado nesta vigência. {faltaDiz} A lista item a item está na cobertura, logo abaixo.
        </p>
      )}
    </section>
  );
}
