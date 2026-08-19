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
  icon: React.ReactNode;
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
}) {
  return (
    <div className="rounded-xl border bg-card shadow-sm px-5 py-5 flex items-center gap-4">
      <div
        className={cn(
          "h-14 w-14 rounded-xl grid place-content-center shrink-0",
          LADRILHO[tone],
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
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        <div
          className={cn(
            "text-3xl font-bold tracking-tight tabular-nums mt-1 min-w-0",
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
          <div className="text-xs text-muted-foreground mt-1">{hint}</div>
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
 * Os dois lugares onde o impacto aparece, e o corpo de letra que cada um
 * comporta: o cartão do topo das abas, e o ladrilho estreito das telas de
 * comparação. Em ambos o número desce até o piso e para ali — abaixo dele o
 * valor deixa de competir com o rótulo e vira legenda.
 */
const CORPO = {
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

const AVISO: Record<string, { caixa: string; bolha: string; titulo: string }> = {
  red: {
    caixa: "border-red-100 bg-red-50",
    bolha: "bg-red-600 text-white",
    titulo: "text-red-600",
  },
  amber: {
    caixa: "border-amber-100 bg-amber-50",
    bolha: "bg-amber-500 text-white",
    titulo: "text-amber-700",
  },
  sky: {
    caixa: "border-sky-100 bg-sky-50",
    bolha: "bg-sky-500 text-white",
    titulo: "text-sky-700",
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
