import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Coins,
  Layers,
  ListTree,
  TriangleAlert,
} from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error";
import { Card } from "@/components/ui/card";
import { fetchJson } from "@/lib/api";
import { formatBrlShort, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Panorama — a entrada da aba Impacto: **tudo que mudou**.
 *
 * A aba abria direto na tabela de um parâmetro. Abrir num parâmetro afirma, sem
 * dizer, que foi aquele que mudou — e nos dados reais o FINAME do cavalo é o
 * décimo em número de alterações, enquanto o IPVA muda em 62 das 64 placas. O
 * dropdown estava lá, mas descobrir o que mudou não pode custar quarenta
 * opções percorridas uma a uma.
 *
 * Duas decisões de tela seguem daí, e nenhuma é estética:
 *
 * **Dois rankings, nunca um.** "O que mais mudou" e "o que mais custou" são
 * perguntas diferentes, e um ranking só teria de escolher uma ordem para as
 * duas. `manutencao_vida_meses` muda 494 vezes e não é dinheiro nenhum;
 * `carreta.finame` muda 47 vezes e move R$ 225 mil. Ordenar por quantidade
 * enterra o segundo; ordenar por dinheiro esconde o primeiro.
 *
 * **Quem não passa na régua aparece com o motivo.** Um parâmetro que mudou e
 * que ainda não sabemos monetizar é informação, e escondê-lo faria a tela dizer
 * que nada mudou ali. Ele entra no ranking de alterações, fica fora do
 * financeiro, e a linha diz qual das três confirmações falta.
 */

type PapelEconomico = "TOTAL" | "PARCELA" | "CONJUNTO" | "SIMPLES";

interface Reconciliacao {
  linhas: number;
  fecham: number;
  percentual: number;
}

interface PontaDoParametro {
  effectiveDate: string;
  sourceLabel: string;
  total: number | null;
  withValue: number;
}

interface VariacaoDecomposta {
  total: number;
  preco: number;
  frota: number;
  entraram: { entities: number; amount: number };
  sairam: { entities: number; amount: number };
  comparados: number;
}

export interface ParametroAlterado {
  code: string;
  title: string;
  entityType: string;
  equipment: string;
  changes: number;
  entities: number;
  entitiesNaSerie: number;
  from: PontaDoParametro | null;
  to: PontaDoParametro | null;
  variacao: VariacaoDecomposta | null;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  isMonetary: boolean | null;
  semanticsStatus: string;
  impactoCalculavel: boolean;
  impactoMotivo: string;
  papel: PapelEconomico;
  dentroDe: string | null;
  parcelas: string[];
  contem: string | null;
  evidencia: string | null;
  reconciliacao: Reconciliacao | null;
}

interface PanoramaPeriodo {
  effectiveDate: string;
  sourceLabel: string;
  entityTypes: string[];
}

interface ImpactoPorPeriodicidade {
  periodicity: string | null;
  codes: string[];
}

interface Panorama {
  periods: PanoramaPeriodo[];
  parametros: ParametroAlterado[];
  maisAlterados: string[];
  maiorImpacto: string[];
  impactoPorPeriodicidade: ImpactoPorPeriodicidade[];
  semLeituraFinanceira: string[];
  visaoDeConjunto: string[];
  totais: {
    linhasEconomicas: number;
    parametrosAlterados: number;
    comImpacto: number;
    semImpacto: number;
    alteracoes: number;
    ativosAfetados: number;
  };
}

export interface EscolhaDeParametro {
  entityType: string;
  code: string;
}

const POR_PERIODO: Record<string, string> = {
  MENSAL: "por mês",
  ANUAL: "por ano",
  PONTUAL: "valor único",
};

/** A unidade como se lê, e não como se guarda. */
function unidadeCurta(p: ParametroAlterado): string {
  if (p.unit === "BRL") return "R$";
  if (p.unit === "PERCENT") return "%";
  return p.unit ?? "—";
}

export function ImpactoPanorama({
  onEscolher,
}: {
  onEscolher: (escolha: EscolhaDeParametro) => void;
}) {
  const query = useQuery({
    queryKey: ["impacto", "panorama"],
    queryFn: () => fetchJson<Panorama>("/impacto/panorama"),
  });

  if (query.error) {
    return (
      <ApiErrorNotice
        error={query.error}
        what="O panorama de alterações não pôde ser carregado."
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

  const porCodigo = new Map(data.parametros.map((p) => [p.code, p]));
  const lista = (codes: string[]) =>
    codes.map((c) => porCodigo.get(c)).filter((p): p is ParametroAlterado => !!p);

  const financeiros = lista(data.maiorImpacto);
  const alterados = lista(data.maisAlterados);
  const conjunto = lista(data.visaoDeConjunto);
  const primeira = data.periods[0];
  const ultima = data.periods[data.periods.length - 1];

  if (data.parametros.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">
          Nenhum parâmetro mudou de valor entre as {data.periods.length}{" "}
          vigências desta série.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Tudo que mudou</h2>
        <p className="text-sm text-muted-foreground">
          Entre <strong>{primeira?.sourceLabel}</strong> e{" "}
          <strong>{ultima?.sourceLabel}</strong> — {data.periods.length}{" "}
          vigências. Clique numa linha para abrir a tabela por placa e vigência.
        </p>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <Resumo
          tone="blue"
          icon={<ListTree className="w-6 h-6" />}
          label="Linhas econômicas"
          value={formatNumber(data.totais.linhasEconomicas, 0)}
          hint="parcelas de um total já contado ficam no drill-down"
        />
        <Resumo
          tone="slate"
          icon={<Layers className="w-6 h-6" />}
          label="Alterações de valor"
          value={formatNumber(data.totais.alteracoes, 0)}
          hint={`em até ${data.totais.ativosAfetados} veículos`}
        />
        <Resumo
          tone="green"
          icon={<Coins className="w-6 h-6" />}
          label="Com impacto apurável"
          value={formatNumber(data.totais.comImpacto, 0)}
          hint="semântica confirmada, monetária e somável"
        />
        <Resumo
          tone="amber"
          icon={<AlertTriangle className="w-6 h-6" />}
          label="Sem leitura financeira"
          value={formatNumber(data.totais.semImpacto, 0)}
          hint="mudaram, e ainda não sabemos quanto representam"
        />
      </div>

      {/* ---- ranking 1: o dinheiro ------------------------------------- */}
      <Card className="overflow-hidden">
        <Cabecalho
          titulo="Maior impacto financeiro"
          detalhe={
            financeiros.length > 0
              ? "Só os parâmetros cuja semântica sustenta soma de dinheiro. A variação já vem separada em preço e frota — frota maior não é preço maior. Uma lista por periodicidade: R$/mês e R$/ano não se ordenam juntos sem uma conversão que aqui não se faz."
              : "Nenhum parâmetro alterado passa na régua do impacto ainda."
          }
        />
        {data.impactoPorPeriodicidade.map((grupo) => (
          <div key={grupo.periodicity ?? "sem"}>
            <div className="border-b bg-muted/30 px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {grupo.periodicity
                ? (POR_PERIODO[grupo.periodicity] ?? grupo.periodicity.toLowerCase())
                : "sem periodicidade declarada"}
            </div>
            <TabelaFinanceira linhas={lista(grupo.codes)} onEscolher={onEscolher} />
          </div>
        ))}
      </Card>

      {/* ---- as colunas que já contêm o outro equipamento --------------- */}
      {conjunto.length > 0 && (
        <Card className="overflow-hidden">
          <Cabecalho
            titulo="Visão de conjunto"
            detalhe="Estas colunas já carregam o outro equipamento dentro delas — somá-las às linhas acima contaria cada cavalo duas vezes. Ficam aqui, fora dos rankings, porque quem confere a planilha vai encontrá-las e precisa saber por que não entraram."
          />
          <TabelaFinanceira linhas={conjunto} onEscolher={onEscolher} />
        </Card>
      )}

      {/* ---- ranking 2: a quantidade ----------------------------------- */}
      <Card className="overflow-hidden">
        <Cabecalho
          titulo="Mais alterados"
          detalhe="Por quantidade de mudanças de valor, monetário ou não — meses, km, km/l, R$/km e percentuais entram aqui. Quantidade de alterações não é impacto financeiro, e esta coluna nunca vira dinheiro."
        />
        <TabelaDeAlteracoes linhas={alterados} onEscolher={onEscolher} />
      </Card>

      <p className="text-xs text-muted-foreground">
        <strong>Por que a soma das linhas não bate com a frota.</strong> Um
        parâmetro que é parcela de outro — os juros dentro do FINAME, por
        exemplo — não aparece como linha própria nos rankings: ele é a mesma
        alteração vista de novo, e some do topo para reaparecer no drill-down do
        total. O mesmo vale para as colunas de conjunto, marcadas na tabela, que
        já carregam o outro equipamento dentro delas.
      </p>
    </div>
  );
}

function Cabecalho({ titulo, detalhe }: { titulo: string; detalhe: string }) {
  return (
    <div className="border-b px-4 py-3">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      <p className="text-xs text-muted-foreground mt-0.5 max-w-3xl">{detalhe}</p>
    </div>
  );
}

function TabelaFinanceira({
  linhas,
  onEscolher,
}: {
  linhas: ParametroAlterado[];
  onEscolher: (e: EscolhaDeParametro) => void;
}) {
  const dinheiro = (v: number | null) =>
    v === null ? "—" : formatBrlShort(v);
  const comSinal = (v: number) => `${v > 0 ? "+" : ""}${formatBrlShort(v)}`;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
            <th className="text-left font-medium px-4 py-2">Parâmetro</th>
            <th className="text-right font-medium px-3 py-2">Veículos</th>
            <th className="text-right font-medium px-3 py-2">Alterações</th>
            <th className="text-right font-medium px-3 py-2">Anterior</th>
            <th className="text-right font-medium px-3 py-2">Atual</th>
            <th className="text-right font-medium px-3 py-2">Variação</th>
            <th className="text-right font-medium px-3 py-2">Disso, preço</th>
            <th className="text-left font-medium px-3 py-2">Régua</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {linhas.map((p) => (
            <tr
              key={p.code}
              onClick={() => onEscolher({ entityType: p.entityType, code: p.code })}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onEscolher({ entityType: p.entityType, code: p.code });
                }
              }}
              className="border-b last:border-0 cursor-pointer hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
            >
              <td className="px-4 py-2.5">
                <NomeDoParametro p={p} />
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                {p.entities}
                <span className="text-muted-foreground">/{p.entitiesNaSerie}</span>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">{p.changes}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                {dinheiro(p.from?.total ?? null)}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                {dinheiro(p.to?.total ?? null)}
              </td>
              <td
                className={cn(
                  "px-3 py-2.5 text-right tabular-nums font-medium",
                  (p.variacao?.total ?? 0) < 0 && "text-red-600",
                  (p.variacao?.total ?? 0) > 0 && "text-emerald-700",
                )}
              >
                {p.variacao ? comSinal(p.variacao.total) : "—"}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                {p.variacao ? (
                  <>
                    <span
                      className={cn(
                        p.variacao.preco < 0 && "text-red-600",
                        p.variacao.preco > 0 && "text-emerald-700",
                      )}
                    >
                      {comSinal(p.variacao.preco)}
                    </span>
                    {p.variacao.frota !== 0 && (
                      <div className="text-[11px] text-muted-foreground">
                        frota {comSinal(p.variacao.frota)}
                      </div>
                    )}
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">
                <div className="whitespace-nowrap">
                  {unidadeCurta(p)}
                  {p.periodicity && (
                    <> · {POR_PERIODO[p.periodicity] ?? p.periodicity.toLowerCase()}</>
                  )}
                </div>
                {p.reconciliacao && (
                  <div className="text-[11px] whitespace-nowrap">
                    {formatNumber(p.reconciliacao.percentual, 1)}% reconciliado
                  </div>
                )}
                {/*
                  O traço nas colunas de dinheiro precisa de um porquê ao lado.
                  Uma coluna de conjunto sem semântica confirmada aparece aqui
                  com as somas do arquivo e sem variação apurada — sem esta
                  frase, o traço se pareceria com "não mudou".
                */}
                {!p.impactoCalculavel && (
                  <div className="mt-0.5 flex items-start gap-1 text-[11px] text-amber-700">
                    <TriangleAlert className="w-3 h-3 mt-px shrink-0" />
                    <span className="max-w-[16rem]">{p.impactoMotivo}</span>
                  </div>
                )}
              </td>
              <td className="px-2 text-muted-foreground">
                <ArrowRight className="w-4 h-4" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabelaDeAlteracoes({
  linhas,
  onEscolher,
}: {
  linhas: ParametroAlterado[];
  onEscolher: (e: EscolhaDeParametro) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
            <th className="text-left font-medium px-4 py-2">Parâmetro</th>
            <th className="text-right font-medium px-3 py-2">Alterações</th>
            <th className="text-right font-medium px-3 py-2">Veículos</th>
            <th className="text-left font-medium px-3 py-2">Unidade</th>
            <th className="text-left font-medium px-3 py-2">Periodicidade</th>
            <th className="text-left font-medium px-3 py-2">Impacto financeiro</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {linhas.map((p) => (
            <tr
              key={p.code}
              onClick={() => onEscolher({ entityType: p.entityType, code: p.code })}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onEscolher({ entityType: p.entityType, code: p.code });
                }
              }}
              className="border-b last:border-0 cursor-pointer hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
            >
              <td className="px-4 py-2.5">
                <NomeDoParametro p={p} />
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                {p.changes}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                {p.entities}
                <span className="text-muted-foreground">/{p.entitiesNaSerie}</span>
              </td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">
                {unidadeCurta(p)}
              </td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">
                {p.periodicity
                  ? (POR_PERIODO[p.periodicity] ?? p.periodicity.toLowerCase())
                  : "—"}
              </td>
              <td className="px-3 py-2.5 text-xs">
                {p.impactoCalculavel ? (
                  <span className="text-emerald-700">
                    {p.variacao
                      ? `${p.variacao.preco > 0 ? "+" : ""}${formatBrlShort(p.variacao.preco)} de preço`
                      : "apurável"}
                  </span>
                ) : (
                  <span className="inline-flex items-start gap-1.5 text-amber-700">
                    <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" />
                    <span className="max-w-xs">{p.impactoMotivo}</span>
                  </span>
                )}
              </td>
              <td className="px-2 text-muted-foreground">
                <ArrowRight className="w-4 h-4" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * O nome, o equipamento e o que a linha é dentro da árvore econômica.
 *
 * As etiquetas não são decoração: "contém o cavalo" é a diferença entre um
 * número que pode ser somado à frota de cavalos e um que já a contém.
 */
function NomeDoParametro({ p }: { p: ParametroAlterado }) {
  return (
    <div className="min-w-0">
      <div className="font-medium truncate">{p.title}</div>
      <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
        <span>{p.equipment.toLowerCase()}</span>
        {p.papel === "TOTAL" && (
          <Etiqueta tone="neutro">
            total de {p.parcelas.length} parcelas
          </Etiqueta>
        )}
        {p.papel === "CONJUNTO" && (
          <Etiqueta tone="conjunto" title={p.evidencia ?? undefined}>
            já contém o outro equipamento
          </Etiqueta>
        )}
        {p.papel === "PARCELA" && <Etiqueta tone="neutro">parcela</Etiqueta>}
        {p.semanticsStatus !== "CONFIRMED" && (
          <Etiqueta tone="atencao">
            {p.semanticsStatus === "PRESUMED" ? "presumido" : "sem semântica"}
          </Etiqueta>
        )}
      </div>
    </div>
  );
}

/**
 * As etiquetas saem dos tokens, e não de uma cor escolhida à mão.
 *
 * A paleta do produto virou marinho, branco e laranja; um roxo inventado aqui
 * ficaria fora dela na primeira tela que alguém abrisse. `brand` e `warning`
 * acompanham o tema — inclusive o escuro, onde uma cor fixa da paleta do
 * Tailwind não acompanha nada.
 */
const ETIQUETA = {
  neutro: "bg-muted text-muted-foreground",
  atencao: "bg-warning/15 text-warning-foreground",
  conjunto: "bg-brand/10 text-brand",
} as const;

function Etiqueta({
  tone,
  children,
  title,
}: {
  tone: keyof typeof ETIQUETA;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "rounded px-1.5 py-px text-[10px] font-medium uppercase tracking-wide",
        ETIQUETA[tone],
      )}
    >
      {children}
    </span>
  );
}

const LADRILHO = {
  blue: "bg-brand/10 text-brand",
  green: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  slate: "bg-slate-100 text-slate-600",
} as const;

function Resumo({
  icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  tone: keyof typeof LADRILHO;
  label: string;
  value: string;
  hint?: string;
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
        <div className="text-2xl font-bold tracking-tight tabular-nums mt-0.5 truncate">
          {value}
        </div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </div>
    </div>
  );
}
