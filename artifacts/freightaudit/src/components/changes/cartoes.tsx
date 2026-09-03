import { AlertTriangle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Os pedaços de tela que as quatro leituras compartilham.
 *
 * Saíram de `pages/alteracoes.tsx` no dia em que Cavalo 360° e Carreta 360°
 * passaram a fazer as mesmas perguntas sobre uma frota recortada: um cartão
 * escrito duas vezes é um cartão que amanhã diz duas coisas, e a régua do
 * impacto — uma linha por periodicidade, nunca uma soma — é justamente a que
 * não pode divergir entre telas.
 *
 * Aqui só mora forma. Nenhum destes componentes busca nada nem decide o que é
 * verdade; quem sabe disso são as abas, e é lá que continuam as decisões.
 */

export function AbaBotao({
  active,
  onClick,
  icon,
  label,
  hint,
  count,
}: {
  active: boolean;
  onClick: () => void;
  /**
   * Opcional porque nem toda fileira de abas se distingue por ícone.
   *
   * As abas de tipo da Linha do Tempo e do Painel de Justificativas são Cavalo,
   * Carreta e Trecho lado a lado: três caminhõezinhos iguais não separam nada e
   * ainda empurram para longe a única coisa que separa — a palavra.
   */
  icon?: React.ReactNode;
  label: string;
  hint: string;
  count?: number;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      title={hint}
      className={cn(
        "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground hover:border-input",
      )}
    >
      {icon}
      {label}
      {count !== undefined && (
        <span
          className={cn(
            "text-xs tabular-nums rounded-full px-1.5 py-0.5",
            active ? "bg-primary/10 text-primary" : "bg-muted",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** Reais sem centavos — a régua dos cartões, onde o centavo não decide nada. */
export const brl0 = (valor: number) =>
  valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });

const LADRILHO: Record<string, string> = {
  blue: "bg-blue-50 text-blue-600",
  green: "bg-emerald-50 text-emerald-600",
  orange: "bg-orange-50 text-orange-600",
  red: "bg-red-50 text-red-600",
  purple: "bg-violet-50 text-violet-600",
};

/**
 * Um número do topo: o ícone que o identifica, o nome, o valor, e a ressalva.
 *
 * A ressalva é a linha pequena, e ela não é enfeite: um total de impacto sem
 * "quantas alterações ficaram de fora desta soma" é um número que parece cobrir
 * o arquivo inteiro quando cobre uma parte dele. Toda soma desta tela carrega o
 * seu complemento junto.
 */
export function MetricCard({
  icon,
  tone,
  label,
  value,
  hint,
  valueTone = "muted",
  destaque = false,
}: {
  icon: React.ReactNode;
  tone: keyof typeof LADRILHO;
  label: string;
  /**
   * Um número, ou o que não cabe em um. O impacto da planilha é uma linha por
   * periodicidade, e um cartão que só aceitasse texto obrigaria a escolher uma
   * delas para caber — que é a decisão que este produto não deixa ninguém tomar
   * por descuido.
   */
  value: React.ReactNode;
  hint?: string;
  valueTone?: "good" | "bad" | "warn" | "muted";
  /**
   * O cartão que responde a pergunta da tela, desenhado como tal.
   *
   * Cinco cartões do mesmo tamanho dizem que os cinco números pesam igual, e
   * nesta tela eles não pesam: quatro contam alterações e um conta dinheiro, e
   * é o dinheiro que decide se alguém abre um chamado. O destaque é maior, tem
   * fundo próprio e a ressalva separada por um fio — a mesma ressalva de
   * sempre, porque um total de impacto sem "quantas ficaram de fora" continua
   * sendo um número que parece cobrir o arquivo inteiro.
   */
  destaque?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border shadow-sm flex items-center",
        destaque
          ? "h-full gap-5 border-blue-200 bg-blue-50/50 px-6 py-6"
          : "gap-4 bg-card px-5 py-5",
      )}
    >
      <div
        className={cn(
          "rounded-xl grid place-content-center shrink-0",
          LADRILHO[tone],
          destaque ? "h-16 w-16 rounded-full" : "h-14 w-14",
        )}
      >
        {icon}
      </div>
      {/*
        `flex-1` e `@container`: a coluna toma a largura que sobra do ladrilho
        do ícone, e passa a ser a régua que o valor consulta para escolher o
        próprio corpo. Sem os dois, `ImpactoPorPeriodicidade` mediria a janela
        inteira e escreveria um número do tamanho da tela dentro de um cartão
        de 230px.
      */}
      <div className="min-w-0 flex-1 @container">
        <div
          className={cn(
            "font-medium text-muted-foreground",
            destaque ? "text-base" : "text-sm",
          )}
        >
          {label}
        </div>
        <div
          className={cn(
            "font-bold tracking-tight tabular-nums mt-1 min-w-0",
            destaque ? "text-4xl" : "text-3xl",
            valueTone === "good" && "text-emerald-700",
            valueTone === "bad" && "text-red-600",
            valueTone === "warn" && "text-amber-600",
          )}
        >
          {/* Texto continua cortando com reticências; o que vem montado cuida
              da própria altura. */}
          {typeof value === "string" ? (
            <span className="block truncate">{value}</span>
          ) : (
            value
          )}
        </div>
        {hint && (
          <div
            className={cn(
              "text-muted-foreground",
              destaque
                ? "mt-4 border-t border-blue-200/80 pt-3 text-sm"
                : "mt-1 text-xs",
            )}
          >
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Largura aproximada de um texto, em múltiplos do próprio corpo da fonte.
 *
 * Responde a uma pergunta só: *em que tamanho este número cabe na largura que o
 * cartão tem?* As larguras são as da Montserrat em negrito com `tabular-nums` —
 * medidas uma vez, arredondadas para cima — e a conta é grosseira de propósito.
 * O erro dela cai sempre para o mesmo lado: sobra alguns pixels, nunca falta.
 */
export function larguraAproximada(texto: string): number {
  let ems = 0;
  for (const c of texto) {
    if (c >= "0" && c <= "9") ems += 0.68;
    else if (c === "." || c === "," || c === "/" || c === ":") ems += 0.3;
    else if (c === " " || c === "\u00a0") ems += 0.24;
    else if (c === "\u2212" || c === "-" || c === "+") ems += 0.58;
    else if (c === "m" || c === "w") ems += 1.05;
    else if (c !== c.toLowerCase() && c === c.toUpperCase()) ems += 0.75;
    else ems += 0.67;
  }
  return ems;
}

/**
 * Os lugares onde o impacto aparece, e o corpo de letra que cada um comporta: o
 * cartão em destaque da aba Planilha, o cartão comum do topo das abas, e o
 * ladrilho estreito das telas de comparação. Em todos o número desce até o piso
 * e para ali — abaixo dele o valor deixa de competir com o rótulo e vira
 * legenda.
 *
 * O teto do destaque é grande porque ali o impacto é a resposta da tela, e não
 * um número entre cinco; continua sendo um teto, e não um tamanho fixo — quem
 * decide é a largura que a coluna tem, pela mesma conta de sempre.
 */
const CORPO = {
  destaque: { teto: "3rem", tetoVarias: "1.75rem", piso: "1rem" },
  cartao: { teto: "1.5rem", tetoVarias: "1.125rem", piso: "0.875rem" },
  ladrilho: { teto: "1.25rem", tetoVarias: "1rem", piso: "0.75rem" },
} as const;

/**
 * Impacto apurado, uma linha por periodicidade.
 *
 * Nunca um número só: R$/mês e R$/ano são grandezas diferentes, e somá-las
 * seria exatamente o erro que este produto existe para pegar. Anualizar as duas
 * numa figura comparável é trabalho de F4, com regras próprias.
 */
export function ImpactoPorPeriodicidade({
  buckets,
  escala = "cartao",
  colorido = true,
}: {
  buckets: Record<string, number>;
  /** Onde este impacto está sendo escrito — é o que decide o teto do corpo. */
  escala?: keyof typeof CORPO;
  /**
   * Ganho e perda ditos pela cor. Os ladrilhos das telas de comparação escrevem
   * todos os seus números em tinta única, e um verde solitário lá dentro leria
   * como destaque em vez de sinal.
   */
  colorido?: boolean;
}) {
  const entries = Object.entries(buckets);
  if (entries.length === 0) {
    /*
      Em `text-2xl` a frase não cabe no cartão e sai cortada — "não c…", que se
      lê como defeito. Deixá-la no tamanho do texto comum é o que a mantém
      legível, e é a leitura certa: aqui não há número, e um espaço em branco do
      tamanho de um número prometeria que um dia haverá.

      O caso ficou comum com as telas 360°: um ativo sozinho costuma não ter
      alteração com preço apurado, e antes disso a soma vazia era rara o
      bastante para ninguém ter visto o corte.
    */
    return <span className="block text-base text-muted-foreground">não calculável</span>;
  }

  const linhas = entries.map(([periodicity, amount]) => ({
    periodicity,
    amount,
    valor: brl0(amount),
    sufixo: `/${periodicity.toLowerCase()}`,
  }));

  /*
    O corpo do número sai da largura que o cartão tem, e não de um tamanho fixo
    escolhido no escuro.

    O tamanho fixo é o que produzia o defeito: `R$ 11.917/mensal` em `text-2xl`
    pede 170px, e a coluna de texto do cartão — cinco cartões numa linha, menos
    o ladrilho do ícone — oferece 120px numa tela de 1600. O que passava disso
    era pintado por cima do cartão vizinho, e o sufixo saía cortado no meio.

    `100cqw` é a largura real desta coluna (o `@container` de `MetricCard`, ou o
    ladrilho em `comparar`/QLP); dividida pela largura que a linha mais larga
    pede em "ems", dá o corpo em que ela cabe inteira. O `clamp` põe as duas
    ressalvas: nunca maior que o tamanho do desenho, nunca menor que o piso em
    que o número ainda se lê como número.

    Estreitar antes de quebrar é a regra desta tela — `whitespace-nowrap` abaixo
    é o outro lado dela. Um sinal de menos que cai sozinho na linha de cima
    transforma "−R$ 594" em algo que se lê como número positivo, e este é o
    cartão em que essa leitura custa dinheiro. É a mesma razão pela qual
    `ImpactCell` o carrega na tabela.
  */
  const { teto, tetoVarias, piso } = CORPO[escala];
  const ems = Math.max(
    ...linhas.map(
      (l) => larguraAproximada(l.valor) + 0.2 + larguraAproximada(l.sufixo) / 2,
    ),
  );
  const corpo = `clamp(${piso}, calc(100cqw / ${ems.toFixed(2)}), ${
    linhas.length > 1 ? tetoVarias : teto
  })`;

  return (
    <div
      className={cn("leading-tight", linhas.length > 1 && "space-y-0.5")}
      style={{ fontSize: corpo }}
    >
      {linhas.map((l) => (
        <div
          key={l.periodicity}
          className="flex items-baseline gap-1 whitespace-nowrap"
        >
          {/*
            A válvula do piso. Nas larguras que este produto usa hoje o número
            cabe inteiro em algum corpo acima do piso — mas o piso existe, e um
            valor grande o bastante com uma periodicidade de nome longo acaba
            por encontrá-lo. Quando isso acontece, cede o fim do número, com
            reticências e o valor inteiro no `title`: fica contido no cartão e
            se anuncia como corte, em vez de ser pintado sobre o vizinho. O que
            **não** cede é a unidade — um número truncado que perdesse o
            "/mensal" junto viraria uma grandeza sem nome.
          */}
          <span
            title={l.valor}
            className={cn(
              "min-w-0 truncate",
              colorido && (l.amount < 0 ? "text-red-600" : "text-emerald-700"),
            )}
          >
            {l.valor}
          </span>
          {/* Meio corpo do número, e não um tamanho próprio: o sufixo encolhe
              junto, e a proporção entre os dois é a mesma em qualquer cartão. */}
          <span
            className="font-medium text-muted-foreground shrink-0"
            style={{ fontSize: "0.5em" }}
          >
            {l.sufixo}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Um número de apoio, e o recorte que ele abre na lista.
 *
 * A fileira de baixo do topo da aba Planilha: contagens que fazem parte da
 * leitura mas não são a resposta dela — quantas colunas o arquivo ganhou ou
 * perdeu, quantas alterações ficaram inconclusivas. Ficam menores que os
 * cartões de cima de propósito; o que elas **não** ficam é escondidas.
 *
 * A seta só aparece quando o número leva a algum lugar, e ela leva sempre ao
 * mesmo lugar: o recorte correspondente na lista abaixo. Um chevron que não
 * abre nada é uma promessa que a tela não cumpre — por isso `onClick` é
 * opcional e um zero não recebe seta nenhuma.
 */
export interface MetricaCompacta {
  id: string;
  icon: React.ReactNode;
  tone: keyof typeof LADRILHO;
  label: string;
  value: string;
  valueTone?: "warn" | "muted";
  /** O que fica escrito no `title` — a ressalva que o cartão grande mostraria. */
  hint?: string;
  /** O recorte que este número abre; ausente quando não há linha para ver. */
  onClick?: () => void;
  /** Se o recorte deste número já está ligado. */
  ativo?: boolean;
}

export function MetricasCompactas({ itens }: { itens: MetricaCompacta[] }) {
  return (
    // `@container` próprio: quem decide se os dois números cabem lado a lado é
    // a largura desta fileira, não a da janela — a mesma régua que o resto do
    // topo usa, e a razão de nenhum deles contar os 304px da lateral.
    <div className="@container">
      <div className="grid divide-y overflow-hidden rounded-xl border bg-card shadow-sm @lg:grid-cols-2 @lg:divide-x @lg:divide-y-0">
        {itens.map((item) => {
          const corpo = (
            <>
              <div
                className={cn(
                  "h-10 w-10 rounded-xl grid place-content-center shrink-0",
                  LADRILHO[item.tone],
                )}
              >
                {item.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-muted-foreground truncate">
                  {item.label}
                </div>
                <div
                  className={cn(
                    "text-2xl font-bold tracking-tight tabular-nums truncate",
                    item.valueTone === "warn" && "text-amber-600",
                  )}
                >
                  {item.value}
                </div>
              </div>
              {item.onClick && (
                <ChevronRight
                  className={cn(
                    "w-5 h-5 shrink-0 transition-transform",
                    item.ativo ? "rotate-90 text-brand" : "text-muted-foreground",
                  )}
                />
              )}
            </>
          );

          return item.onClick ? (
            <button
              key={item.id}
              type="button"
              onClick={item.onClick}
              aria-pressed={item.ativo}
              title={item.hint}
              className={cn(
                "flex items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/50",
                item.ativo && "bg-accent/40",
              )}
            >
              {corpo}
            </button>
          ) : (
            <div
              key={item.id}
              title={item.hint}
              className="flex items-center gap-3 px-5 py-4"
            >
              {corpo}
            </div>
          );
        })}
      </div>
    </div>
  );
}


const AVISO: Record<
  string,
  { caixa: string; bolha: string; titulo: string; fio: string }
> = {
  red: {
    caixa: "border-red-100 bg-red-50",
    bolha: "bg-red-600 text-white",
    titulo: "text-red-600",
    fio: "border-red-200",
  },
  amber: {
    caixa: "border-amber-100 bg-amber-50",
    bolha: "bg-amber-500 text-white",
    titulo: "text-amber-700",
    fio: "border-amber-200",
  },
  sky: {
    caixa: "border-sky-100 bg-sky-50",
    bolha: "bg-sky-500 text-white",
    titulo: "text-sky-700",
    fio: "border-sky-200",
  },
};

/** Um problema do arquivo em uma linha: o quê, o quanto, e por onde ver. */
export function Aviso({
  tone,
  icone,
  titulo,
  detalhe,
  acao,
  aberto,
  onClick,
}: {
  tone: keyof typeof AVISO;
  icone?: React.ReactNode;
  titulo: string;
  detalhe: string;
  acao?: string;
  aberto?: boolean;
  onClick?: () => void;
}) {
  const estilo = AVISO[tone];
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-xl border px-5 py-4",
        estilo.caixa,
      )}
    >
      <div
        className={cn(
          "h-12 w-12 rounded-full grid place-content-center shrink-0",
          estilo.bolha,
        )}
      >
        {icone ?? <AlertTriangle className="w-6 h-6" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn("font-bold", estilo.titulo)}>{titulo}</div>
        <div className="text-sm text-muted-foreground line-clamp-1" title={detalhe}>
          {detalhe}
        </div>
      </div>
      {acao && onClick && (
        <button
          onClick={onClick}
          aria-expanded={aberto}
          className={cn(
            "inline-flex items-center gap-1 text-sm font-medium shrink-0 hover:underline",
            estilo.titulo,
          )}
        >
          {acao}
          <ChevronRight
            className={cn("w-4 h-4 transition-transform", aberto && "rotate-90")}
          />
        </button>
      )}
    </div>
  );
}

/**
 * As pendências da comparação, numa faixa só.
 *
 * Elas eram um cartão cada, lado a lado, e a fileira dizia a coisa errada: um
 * problema por caixa, do tamanho de um cartão de número, competindo com os
 * totais logo acima. São ressalvas do mesmo total — o que ficou fora da soma e
 * o que já está contado noutra linha —, e lidas juntas elas se explicam: a
 * primeira diz que falta preço, a segunda que o dinheiro existe mas mora em
 * outro lugar.
 *
 * Nenhuma some quando é inconveniente; somem quando não existem. O detalhe
 * continua atrás de um clique e continua um de cada vez — cada pendência abre o
 * próprio painel, e o botão da direita abre a primeira quando nada está aberto
 * e fecha o que estiver.
 */
export interface Pendencia {
  id: string;
  /** O tamanho do problema, quando ele é contável. */
  quantidade?: number;
  titulo: string;
  detalhe: string;
}

export function FaixaDePendencias({
  tone,
  itens,
  ativo,
  onEscolher,
  onAlternar,
}: {
  tone: keyof typeof AVISO;
  itens: Pendencia[];
  /** Qual pendência está com o painel aberto — `null` quando nenhuma. */
  ativo: string | null;
  onEscolher: (id: string) => void;
  onAlternar: () => void;
}) {
  const estilo = AVISO[tone];
  if (itens.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-5 gap-y-4 rounded-xl border px-5 py-4",
        estilo.caixa,
      )}
    >
      <div
        className={cn(
          "h-12 w-12 rounded-full grid place-content-center shrink-0",
          estilo.bolha,
        )}
      >
        <AlertTriangle className="w-6 h-6" />
      </div>

      <div className="min-w-0 flex-[1_1_20rem] flex flex-wrap items-center">
        {itens.map((item, i) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onEscolher(item.id)}
            aria-expanded={ativo === item.id}
            className={cn(
              "min-w-0 flex-1 basis-64 rounded-lg px-2 py-1 text-left transition-colors hover:bg-background/40",
              // O fio entre duas pendências, e não uma borda em volta de cada
              // uma: a caixa já é uma só, e caixinhas dentro dela devolveriam a
              // fileira de cartões que esta faixa substituiu.
              i > 0 && cn("ml-3 border-l pl-5", estilo.fio),
              ativo === item.id && "bg-background/60",
            )}
          >
            <div className="leading-snug">
              {item.quantidade !== undefined && (
                <strong
                  className={cn(
                    "mr-1.5 text-lg font-bold tabular-nums",
                    estilo.titulo,
                  )}
                >
                  {item.quantidade.toLocaleString("pt-BR")}
                </strong>
              )}
              <span className="font-medium text-foreground">{item.titulo}</span>
            </div>
            <div
              className="text-sm text-muted-foreground line-clamp-1"
              title={item.detalhe}
            >
              {item.detalhe}
            </div>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={ativo !== null}
        className={cn(
          "shrink-0 inline-flex items-center gap-1.5 rounded-full border bg-background/60 px-4 py-2 text-sm font-semibold transition-colors hover:bg-background",
          estilo.fio,
          estilo.titulo,
        )}
      >
        Ver pendências
        <ChevronRight
          className={cn(
            "w-4 h-4 transition-transform",
            ativo !== null && "rotate-90",
          )}
        />
      </button>
    </div>
  );
}

export function TituloDePainel({
  icone,
  children,
}: {
  icone: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 grid place-content-center shrink-0">
        {icone}
      </div>
      <h3 className="text-lg font-bold tracking-tight">{children}</h3>
    </div>
  );
}
