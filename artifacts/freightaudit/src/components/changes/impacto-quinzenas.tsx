import { Fragment, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Coins,
  Truck,
  Wallet,
} from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error";
import {
  ImpactoPanorama,
  type Corte,
  type EscolhaDeParametro,
} from "@/components/changes/impacto-panorama";
import { Card } from "@/components/ui/card";
import { fetchJson } from "@/lib/api";
import { formatBrlShort, formatNumber, formatValue } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Impacto — o que cada ativo custa em cada quinzena.
 *
 * As outras duas abas partem da alteração e chegam ao dinheiro. Esta parte do
 * dinheiro: uma linha por ativo, uma coluna por vigência, e a alteração
 * aparecendo como a diferença entre duas colunas vizinhas. É a tabela dinâmica
 * que o cliente monta no Excel — `Soma de finameCavalo`, dobrada pela data de
 * entrada —, com três coisas que a dele não tem.
 *
 * **A primeira é a célula vazia.** No Excel, ativo fora da vigência e ativo que
 * passou a custar zero produzem a mesma coisa: em branco, ou `R$ -`. Aqui são
 * estados diferentes e parecem diferentes, porque a diferença entre uma frota
 * menor e um desconto é toda a diferença.
 *
 * **A segunda é o movimento.** A cor não é pintada à mão célula a célula: ela é
 * a comparação com a vigência anterior, feita pelo servidor sobre a lista
 * inteira. O vermelho de uma queda não pode depender de alguém ter lembrado de
 * pintá-la.
 *
 * **A terceira é a decomposição da variação.** O total da última coluna menos o
 * da primeira responde errado sempre que entrou ou saiu ativo. Os cartões do
 * topo separam o que foi preço do que foi frota, e a conta fecha à vista.
 */

type EstadoDaCelula = "VALOR" | "SEM_VALOR" | "FORA_DA_FROTA" | "NAO_ENTREGUE";
type Movimento = "SUBIU" | "CAIU" | "IGUAL" | "ENTROU" | "SAIU" | null;

interface QuinzenaCell {
  value: number | null;
  state: EstadoDaCelula;
  delta: number | null;
  movimento: Movimento;
}

interface QuinzenaRow {
  entityId: string;
  plate: string | null;
  cells: QuinzenaCell[];
  total: number | null;
  first: number | null;
  last: number | null;
  delta: number | null;
  periods: number;
}

interface QuinzenaGroup {
  key: string;
  label: string;
  rows: QuinzenaRow[];
  totals: (number | null)[];
  total: number | null;
}

interface QuinzenaPeriod {
  effectiveDate: string;
  sourceLabel: string;
  delivered: boolean;
  entities: number;
  withValue: number;
  total: number | null;
}

interface ImpactoParametro {
  code: string;
  title: string;
  sourceName: string;
  entityType: string;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  isMonetary: boolean | null;
  semanticsStatus: string;
  somavel: boolean;
}

interface PontaAPonta {
  from: string;
  fromLabel: string;
  to: string;
  toLabel: string;
  comparados: { entities: number; delta: number };
  entraram: { entities: number; amount: number; foraDaFrota: number };
  sairam: { entities: number; amount: number; foraDaFrota: number };
  totalFrom: number;
  totalTo: number;
  delta: number;
}

interface QuinzenaMatrix {
  entityType: string;
  equipment: string;
  entityTypes: string[];
  attribute: ImpactoParametro;
  parameters: ImpactoParametro[];
  groupedBy: { code: string; title: string } | null;
  periods: QuinzenaPeriod[];
  groups: QuinzenaGroup[];
  totals: (number | null)[];
  grandTotal: number | null;
  entities: number;
  pontaAPonta: PontaAPonta | null;
}

const EQUIPAMENTO: Record<string, string> = {
  CAVALO: "Cavalos",
  CARRETA: "Carretas",
};

/**
 * O cavalo primeiro, e não em ordem alfabética.
 *
 * É o equipamento em que a tela abre — o custo fixo dele é o maior da frota — e
 * o botão selecionado não pode ser o segundo da fileira. O que não estiver
 * nomeado aqui vem depois, em ordem, para que um terceiro tipo de ativo apareça
 * sozinho sem precisar de mudança nenhuma.
 */
const ORDEM_DOS_EQUIPAMENTOS = ["CAVALO", "CARRETA"];

const ordemDe = (tipo: string) => {
  const i = ORDEM_DOS_EQUIPAMENTOS.indexOf(tipo);
  return i === -1 ? ORDEM_DOS_EQUIPAMENTOS.length : i;
};

/** "MENSAL" → "por mês" — a periodicidade dita como se lê, não como se guarda. */
const POR_PERIODO: Record<string, string> = {
  MENSAL: "por mês",
  ANUAL: "por ano",
  PONTUAL: "em valor único",
};

/**
 * O fundo das células presas, opaco.
 *
 * `bg-muted/40` é a mesma cor com 40% de alfa, e alfa não serve aqui: a coluna
 * da placa fica parada enquanto nove colunas de vigência passam por baixo dela,
 * e o que se via era o número de agosto atravessando a placa. O `color-mix`
 * produz a mesma cor **sem** transparência — é a mesma solução, e pela mesma
 * razão, de `components/parametros/tabela.tsx`.
 */
const FUNDO_CABECALHO =
  "color-mix(in srgb, hsl(var(--muted)) 40%, hsl(var(--card)))";
const FUNDO_GRUPO =
  "color-mix(in srgb, hsl(var(--muted)) 20%, hsl(var(--card)))";

/**
 * A aba, em dois níveis.
 *
 * O primeiro responde *o que mudou* — todos os parâmetros, os dois
 * equipamentos, dois rankings. O segundo é esta tabela, alcançada clicando numa
 * linha de lá.
 *
 * A ordem foi invertida em 16/08/2026, e a razão está nos dados: abrir direto
 * na tabela do FINAME afirmava, sem dizer, que o FINAME tinha sido a alteração
 * da quinzena. Ele é o décimo em número de alterações no cavalo, e na carreta
 * os três maiores nem sustentam soma de dinheiro. O seletor de parâmetro
 * continua existindo no segundo nível, como navegação lateral — o que ele
 * deixou de ser é a única porta para descobrir o que mudou.
 *
 * `escolhaInicial` é de quem chegou de outra aba com o parâmetro já em mente —
 * a aba Cliente manda para cá quando alguém pede "ver por placa e vigência". É
 * estado inicial, não trava: o botão de voltar leva ao panorama como sempre.
 */
export function ImpactoQuinzenas({
  escolhaInicial = null,
}: {
  escolhaInicial?: EscolhaDeParametro | null;
} = {}) {
  const [escolha, setEscolha] = useState<EscolhaDeParametro | null>(escolhaInicial);
  /*
    O corte de custo do panorama mora aqui, e não lá dentro, para sobreviver à
    ida e à volta: quem filtrou por custo variável e abriu um parâmetro está a
    meio caminho de uma pergunta, e voltar para a lista inteira o obrigaria a
    refazer o filtro a cada linha que quisesse conferir.
  */
  const [corte, setCorte] = useState<Corte>("TUDO");

  if (escolha === null) {
    return (
      <ImpactoPanorama onEscolher={setEscolha} corte={corte} onCorte={setCorte} />
    );
  }
  return (
    <MatrizDeQuinzenas
      inicial={escolha}
      onVoltar={() => setEscolha(null)}
      key={`${escolha.entityType}:${escolha.code}`}
    />
  );
}

function MatrizDeQuinzenas({
  inicial,
  onVoltar,
}: {
  inicial: EscolhaDeParametro;
  onVoltar: () => void;
}) {
  const [entityType, setEntityType] = useState<string | null>(inicial.entityType);
  const [attributeCode, setAttributeCode] = useState<string | null>(inicial.code);
  /** Grupos fechados. Nenhum por padrão: a tabela abre inteira, como a do Excel. */
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const [soComMovimento, setSoComMovimento] = useState(false);

  const query = useQuery({
    queryKey: ["impacto", "quinzenas", entityType, attributeCode],
    queryFn: () => {
      const params = new URLSearchParams();
      if (entityType) params.set("entityType", entityType);
      if (attributeCode) params.set("attributeCode", attributeCode);
      const qs = params.toString();
      return fetchJson<QuinzenaMatrix>(
        `/impacto/quinzenas${qs ? `?${qs}` : ""}`,
      );
    },
    // Trocar de equipamento ou de parâmetro não pode apagar a tabela: sem isto
    // a tela pisca em branco a cada clique, e a posição da rolagem — que numa
    // tabela de nove colunas é onde a pessoa estava lendo — se perde junto.
    placeholderData: keepPreviousData,
  });

  if (query.error) {
    return (
      <ApiErrorNotice
        error={query.error}
        what="A tabela de impacto não pôde ser carregada."
      />
    );
  }

  const data = query.data;
  if (!data) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">Lendo as vigências…</p>
      </Card>
    );
  }

  const unidade = data.attribute.unit;
  const brl = unidade === "BRL";

  return (
    <div className={cn("space-y-5", query.isPlaceholderData && "opacity-60")}>
      {/*
        A volta é a primeira coisa da tela, e não um link no rodapé: quem chegou
        aqui clicando numa linha do panorama está a meio caminho de uma
        pergunta, e o caminho de volta faz parte da resposta.
      */}
      <button
        onClick={onVoltar}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Tudo que mudou
      </button>

      {/* O que a tabela está mostrando, e as duas escolhas que a mudam. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div
          role="tablist"
          aria-label="equipamento"
          className="inline-flex rounded-xl border bg-muted/50 p-1"
        >
          {[...data.entityTypes]
            .sort((a, b) => ordemDe(a) - ordemDe(b))
            .map((tipo) => (
              <button
                key={tipo}
                role="tab"
                aria-selected={tipo === data.entityType}
                onClick={() => {
                  setEntityType(tipo);
                  // O parâmetro é de um equipamento só: `cavalo.finame_cavalo`
                  // não existe na carreta. Carregar a escolha anterior faria a
                  // troca cair no padrão sem dizer, ou pior, num erro.
                  setAttributeCode(null);
                }}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
                  tipo === data.entityType
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Truck className="w-4 h-4" />
                {EQUIPAMENTO[tipo] ?? tipo.toLowerCase()}
              </button>
            ))}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Parâmetro</span>
          <select
            value={data.attribute.code}
            onChange={(e) => setAttributeCode(e.target.value)}
            className="h-9 min-w-[18rem] rounded-lg border border-input bg-background px-2 text-sm"
          >
            {/* Os dois grupos só existem quando têm alguém: um `optgroup` vazio
                é um rótulo prometendo opções que não estão ali. */}
            {[
              { label: "sustentam soma de dinheiro", somavel: true },
              { label: "ainda sem semântica confirmada", somavel: false },
            ].map(({ label, somavel }) => {
              const doGrupo = data.parameters.filter(
                (p) => p.somavel === somavel,
              );
              if (doGrupo.length === 0) return null;
              return (
                <optgroup key={label} label={label}>
                  {doGrupo.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.title}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </label>
      </div>

      {/*
        O parâmetro escolhido pode não sustentar dinheiro, e a tela continua
        mostrando a tabela — o dado existe e é ele que a pessoa foi ver. O que
        não pode é a soma aparecer com cara de dinheiro apurado: o aviso diz o
        que falta, e é curadoria que o resolve, não esta tela.
      */}
      {!data.attribute.somavel && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>{data.attribute.title}</strong> ainda não passa na régua do
          impacto — {motivoDaRessalva(data.attribute)}. Os valores abaixo são os
          do arquivo, e as somas são aritmética sobre eles; não são impacto
          financeiro apurado.
        </p>
      )}

      {data.pontaAPonta && (
        <CartoesDeVariacao ponta={data.pontaAPonta} brl={brl} />
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">
              {data.attribute.title} · {data.equipment.toLowerCase()}
            </h3>
            <p className="text-xs text-muted-foreground">
              {data.entities} ativos em {data.periods.length} vigências
              {data.groupedBy && (
                <> · agrupados por {data.groupedBy.title.toLowerCase()}</>
              )}
              {unidade && (
                <> · valores em {unidade === "BRL" ? "R$" : unidade}</>
              )}
              {data.attribute.periodicity && (
                <>
                  {" "}
                  {POR_PERIODO[data.attribute.periodicity] ??
                    `por ${data.attribute.periodicity.toLowerCase()}`}
                </>
              )}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={soComMovimento}
              onChange={(e) => setSoComMovimento(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            só os ativos que mexeram
          </label>
        </div>

        <TabelaQuinzenas
          matriz={data}
          brl={brl}
          fechados={fechados}
          onAlternar={(key) =>
            setFechados((atual) => {
              const proximo = new Set(atual);
              if (proximo.has(key)) proximo.delete(key);
              else proximo.add(key);
              return proximo;
            })
          }
          soComMovimento={soComMovimento}
        />
      </Card>

      <p className="text-xs text-muted-foreground">
        A coluna <strong>Total Geral</strong> soma as vigências, como a tabela
        dinâmica do cliente. Ela serve para ordenar e para conferir contra a
        planilha — <em>não</em> é o custo de um período: somar nove quinzenas de
        um valor mensal não produz o valor de nenhum mês. A variação está nos
        cartões acima e na coluna <strong>Δ</strong>.
      </p>
    </div>
  );
}

/** Por que um parâmetro não sustenta soma de dinheiro, na ordem em que a régua pergunta. */
function motivoDaRessalva(p: ImpactoParametro): string {
  if (p.semanticsStatus !== "CONFIRMED") {
    return p.semanticsStatus === "PRESUMED"
      ? "o significado da coluna ainda é presumido, não confirmado na curadoria"
      : "o significado da coluna ainda é desconhecido";
  }
  if (p.isMonetary !== true) return "a coluna não é um montante financeiro";
  if (p.aggregation !== "SUM") {
    return `a agregação declarada é ${(p.aggregation ?? "indefinida").toLowerCase()}, e não soma`;
  }
  return "falta pelo menos uma confirmação da curadoria";
}

/**
 * A variação entre as duas pontas, dividida em preço e frota.
 *
 * Os quatro cartões são uma identidade escrita na horizontal: o primeiro é o
 * ponto de chegada, e os três seguintes são as parcelas que explicam a distância
 * até o ponto de partida. Um total isolado no topo não distinguiria "ficou mais
 * caro" de "tem mais caminhão", que é o erro que esta tela existe para não
 * cometer.
 */
function CartoesDeVariacao({
  ponta,
  brl,
}: {
  ponta: PontaAPonta;
  brl: boolean;
}) {
  const dinheiro = (v: number) =>
    brl ? formatBrlShort(v) : formatNumber(v, 2);
  const comSinal = (v: number) => `${v > 0 ? "+" : ""}${dinheiro(v)}`;

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        tone="blue"
        icon={<Wallet className="w-6 h-6" />}
        label={`Total em ${ponta.toLabel}`}
        value={dinheiro(ponta.totalTo)}
        hint={`era ${dinheiro(ponta.totalFrom)} em ${ponta.fromLabel}`}
      />
      <Tile
        tone={ponta.delta < 0 ? "red" : "green"}
        icon={
          ponta.delta < 0 ? (
            <ArrowDownRight className="w-6 h-6" />
          ) : (
            <ArrowUpRight className="w-6 h-6" />
          )
        }
        label="Variação no período"
        value={comSinal(ponta.delta)}
        hint="a distância entre as duas pontas, frota inclusa"
        valueTone={ponta.delta < 0 ? "bad" : ponta.delta > 0 ? "good" : "muted"}
      />
      <Tile
        tone="orange"
        icon={<Coins className="w-6 h-6" />}
        label="Disso, preço"
        value={comSinal(ponta.comparados.delta)}
        hint={`nos ${ponta.comparados.entities} ativos presentes nas duas pontas`}
        valueTone={
          ponta.comparados.delta < 0
            ? "bad"
            : ponta.comparados.delta > 0
              ? "good"
              : "muted"
        }
      />
      <Tile
        tone="purple"
        icon={<Truck className="w-6 h-6" />}
        label="Disso, frota"
        value={comSinal(ponta.entraram.amount - ponta.sairam.amount)}
        hint={`${ponta.entraram.entities} entraram, ${ponta.sairam.entities} saíram — não é preço`}
      />
    </div>
  );
}

const LADRILHO: Record<string, string> = {
  blue: "bg-brand/10 text-brand",
  green: "bg-emerald-50 text-emerald-600",
  orange: "bg-orange-50 text-orange-600",
  red: "bg-red-50 text-red-600",
  purple: "bg-violet-50 text-violet-600",
};

function Tile({
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
  value: string;
  hint?: string;
  valueTone?: "good" | "bad" | "muted";
}) {
  return (
    <div className="rounded-xl border bg-card shadow-sm px-5 py-5 flex items-center gap-4">
      <div
        className={cn(
          "h-12 w-12 rounded-xl grid place-content-center shrink-0",
          LADRILHO[tone],
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        <div
          className={cn(
            "text-2xl font-bold tracking-tight tabular-nums mt-0.5 truncate",
            valueTone === "good" && "text-emerald-700",
            valueTone === "bad" && "text-red-600",
          )}
        >
          {value}
        </div>
        {hint && (
          <div className="text-xs text-muted-foreground mt-1">{hint}</div>
        )}
      </div>
    </div>
  );
}

/**
 * A tabela em si.
 *
 * A placa fica presa à esquerda: em nove colunas de vigência, quem rola até
 * agosto precisa continuar sabendo de qual ativo é a linha — é a mesma decisão
 * de `components/parametros/tabela.tsx`, pela mesma razão.
 */
function TabelaQuinzenas({
  matriz,
  brl,
  fechados,
  onAlternar,
  soComMovimento,
}: {
  matriz: QuinzenaMatrix;
  brl: boolean;
  fechados: Set<string>;
  onAlternar: (key: string) => void;
  soComMovimento: boolean;
}) {
  const mexeu = (linha: QuinzenaRow) =>
    linha.cells.some(
      (c) =>
        c.movimento === "SUBIU" ||
        c.movimento === "CAIU" ||
        c.movimento === "ENTROU" ||
        c.movimento === "SAIU",
    );

  /*
    Filtrar reescreve os subtotais, e não pode ser de outro jeito.

    Um subtotal de cinco ativos em cima de quatro linhas é um número que não
    fecha com nada do que está à vista — o defeito exato que esta tela existe
    para não cometer. Fora do filtro quem soma é o servidor, que enxerga o
    `numeric(18,6)` inteiro; sob filtro a soma é destas linhas, feita aqui, e o
    rodapé diz que os totais seguem o recorte.
  */
  const somar = (linhas: QuinzenaRow[], i: number): number | null => {
    const comValor = linhas.filter((l) => l.cells[i].state === "VALOR");
    if (comValor.length === 0) return null;
    const soma = comValor.reduce(
      (total, l) => total + (l.cells[i].value ?? 0),
      0,
    );
    return Math.round(soma * 100) / 100;
  };

  const somarTudo = (totais: (number | null)[]): number | null => {
    const presentes = totais.filter((t): t is number => t !== null);
    if (presentes.length === 0) return null;
    return Math.round(presentes.reduce((a, b) => a + b, 0) * 100) / 100;
  };

  const grupos = matriz.groups
    .map((g) => {
      if (!soComMovimento) return { ...g, escondidas: 0 };
      const rows = g.rows.filter(mexeu);
      const totals = matriz.periods.map((_, i) => somar(rows, i));
      return {
        ...g,
        rows,
        totals,
        total: somarTudo(totals),
        escondidas: g.rows.length - rows.length,
      };
    })
    .filter((g) => g.rows.length > 0);

  const linhasVisiveis = grupos.flatMap((g) => g.rows);
  const totals = soComMovimento
    ? matriz.periods.map((_, i) => somar(linhasVisiveis, i))
    : matriz.totals;
  const grandTotal = soComMovimento ? somarTudo(totals) : matriz.grandTotal;

  if (grupos.length === 0) {
    return (
      <p className="px-5 py-8 text-sm text-muted-foreground">
        {soComMovimento
          ? "Nenhum ativo mexeu neste parâmetro no período — e isso é uma resposta, não uma tabela vazia."
          : "Nenhum ativo deste equipamento tem valor neste parâmetro."}
      </p>
    );
  }

  return (
    <>
      {soComMovimento && (
        <p className="border-b bg-amber-50/60 px-4 py-2 text-xs text-amber-900">
          Mostrando {linhasVisiveis.length} dos {matriz.entities} ativos — os
          que mexeram neste parâmetro.{" "}
          <strong>Os totais seguem o recorte</strong>, e por isso não fecham com
          os cartões acima, que são da frota inteira.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b bg-muted/40">
              <th
                style={{ background: FUNDO_CABECALHO }}
                className="sticky left-0 z-20 px-3 py-2 text-left font-semibold min-w-[9rem] shadow-[1px_0_0_0_hsl(var(--border))]"
              >
                {matriz.groupedBy ? matriz.groupedBy.title : "Ativo"} / placa
              </th>
              {matriz.periods.map((p) => (
                <th
                  key={p.effectiveDate}
                  title={`${p.entities} ativos na vigência, ${p.withValue} com valor`}
                  className={cn(
                    "px-3 py-2 text-right font-semibold whitespace-nowrap",
                    !p.delivered && "text-muted-foreground",
                  )}
                >
                  {p.sourceLabel}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap border-l">
                Total Geral
              </th>
              <th
                className="px-3 py-2 text-right font-semibold whitespace-nowrap"
                title="a distância entre o primeiro e o último valor do ativo"
              >
                Δ
              </th>
            </tr>
          </thead>

          <tbody>
            {grupos.map((grupo) => {
              const aberto = !fechados.has(grupo.key);
              // Fragment com key: um grupo rende duas famílias de linhas — o
              // cabeçalho dele e as dos ativos — e nenhum outro elemento cabe
              // entre <tbody> e <tr> sem quebrar a semântica da tabela.
              return (
                <Fragment key={grupo.key}>
                  <tr className="border-b bg-muted/20 font-semibold">
                    <th
                      scope="row"
                      style={{ background: FUNDO_GRUPO }}
                      className="sticky left-0 z-10 px-2 py-1.5 text-left shadow-[1px_0_0_0_hsl(var(--border))]"
                    >
                      <button
                        onClick={() => onAlternar(grupo.key)}
                        aria-expanded={aberto}
                        className="flex items-center gap-1 hover:underline"
                      >
                        {aberto ? (
                          <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                        )}
                        {grupo.label}
                        <span className="font-normal text-muted-foreground">
                          ({grupo.rows.length}
                          {grupo.escondidas > 0 &&
                            ` de ${grupo.rows.length + grupo.escondidas}`}
                          )
                        </span>
                      </button>
                    </th>
                    {grupo.totals.map((total, i) => (
                      <td
                        key={i}
                        className="px-3 py-1.5 text-right tabular-nums"
                      >
                        {total === null
                          ? ""
                          : numero(total, brl, matriz.attribute.unit)}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right tabular-nums border-l">
                      {grupo.total === null
                        ? ""
                        : numero(grupo.total, brl, matriz.attribute.unit)}
                    </td>
                    <td />
                  </tr>

                  {aberto &&
                    grupo.rows.map((linha) => (
                      <tr
                        key={linha.entityId}
                        className="border-b hover:bg-muted/30"
                      >
                        <th
                          scope="row"
                          className="sticky left-0 z-10 bg-card px-3 py-1.5 text-left font-mono font-normal shadow-[1px_0_0_0_hsl(var(--border))]"
                        >
                          {linha.plate ?? "sem placa"}
                        </th>
                        {linha.cells.map((celula, i) => (
                          <Celula
                            key={i}
                            celula={celula}
                            brl={brl}
                            unidade={matriz.attribute.unit}
                            periodo={matriz.periods[i]}
                          />
                        ))}
                        <td className="px-3 py-1.5 text-right tabular-nums border-l font-medium">
                          {linha.total === null
                            ? "—"
                            : numero(linha.total, brl, matriz.attribute.unit)}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-1.5 text-right tabular-nums",
                            linha.delta !== null &&
                              linha.delta < 0 &&
                              "text-red-600",
                            linha.delta !== null &&
                              linha.delta > 0 &&
                              "text-emerald-700",
                          )}
                        >
                          {linha.delta === null
                            ? "—"
                            : `${linha.delta > 0 ? "+" : ""}${numero(linha.delta, brl, matriz.attribute.unit)}`}
                        </td>
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="border-t-2 bg-muted/40 font-bold">
              <th
                style={{ background: FUNDO_CABECALHO }}
                className="sticky left-0 z-10 px-3 py-2 text-left shadow-[1px_0_0_0_hsl(var(--border))]"
              >
                Total Geral
              </th>
              {totals.map((total, i) => (
                <td key={i} className="px-3 py-2 text-right tabular-nums">
                  {total === null
                    ? ""
                    : numero(total, brl, matriz.attribute.unit)}
                </td>
              ))}
              <td className="px-3 py-2 text-right tabular-nums border-l">
                {grandTotal === null
                  ? ""
                  : numero(grandTotal, brl, matriz.attribute.unit)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

/**
 * Uma célula, e os quatro estados que ela pode estar.
 *
 * O vazio de "não está na frota" e o zero de "passou a custar nada" não podem
 * se parecer: o primeiro é um travessão apagado, o segundo é um número. É a
 * regra que o Excel do cliente não consegue cumprir, porque lá os dois são a
 * mesma célula em branco.
 */
function Celula({
  celula,
  brl,
  unidade,
  periodo,
}: {
  celula: QuinzenaCell;
  brl: boolean;
  unidade: string | null;
  periodo: QuinzenaPeriod;
}) {
  if (celula.state === "NAO_ENTREGUE") {
    return (
      <td
        className="px-3 py-1.5 text-right text-muted-foreground/50 bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,hsl(var(--muted))_4px,hsl(var(--muted))_8px)]"
        title={`${periodo.sourceLabel} não trouxe o arquivo deste equipamento — não é frota vazia`}
      >
        <span className="sr-only">vigência sem este equipamento</span>
      </td>
    );
  }

  if (celula.state === "FORA_DA_FROTA") {
    return (
      <td
        className={cn(
          "px-3 py-1.5 text-right text-muted-foreground/60",
          celula.movimento === "SAIU" && "bg-red-50/60",
        )}
        title={
          celula.movimento === "SAIU"
            ? `saiu da frota em ${periodo.sourceLabel}`
            : "não estava na frota nesta vigência"
        }
      >
        —
      </td>
    );
  }

  if (celula.state === "SEM_VALOR") {
    return (
      <td
        className="px-3 py-1.5 text-right text-muted-foreground/60"
        title="o ativo estava na vigência e esta coluna veio vazia"
      >
        ·
      </td>
    );
  }

  const caiu = celula.movimento === "CAIU";
  const subiu = celula.movimento === "SUBIU";
  const entrou = celula.movimento === "ENTROU";

  return (
    <td
      className={cn(
        "px-3 py-1.5 text-right tabular-nums",
        caiu && "bg-red-50 text-red-700 font-medium",
        subiu && "bg-emerald-50 text-emerald-800 font-medium",
        entrou && "bg-emerald-50/60 text-emerald-800",
      )}
      title={
        celula.delta !== null
          ? `${celula.delta > 0 ? "+" : ""}${numero(celula.delta, brl, unidade)} em relação à vigência anterior`
          : entrou
            ? `entrou na frota em ${periodo.sourceLabel}`
            : undefined
      }
    >
      {/* Seta só onde houve variação de preço. A entrada de ativo fica no fundo
          claro e no `title`: dar-lhe uma seta a colocaria na mesma família de
          "subiu", e frota maior não é preço maior. */}
      <span className="inline-flex items-center gap-1 justify-end">
        {caiu && <ArrowDownRight className="w-3 h-3 shrink-0" />}
        {subiu && <ArrowUpRight className="w-3 h-3 shrink-0" />}
        {numero(celula.value!, brl, unidade)}
      </span>
    </td>
  );
}

/**
 * O número na célula.
 *
 * Sem o `R$` repetido em novecentas células — a unidade está dita uma vez no
 * cabeçalho da tabela, e repeti-la aqui empurra as colunas para fora da tela
 * sem acrescentar informação. Fora do real, quem manda é a unidade declarada:
 * `formatValue` existe para impedir que um percentual vire dinheiro por ser
 * numérico.
 */
function numero(valor: number, brl: boolean, unidade: string | null): string {
  return brl ? formatNumber(valor, 2) : formatValue(valor, unidade);
}
