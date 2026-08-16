import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { ChevronRight, Info, Layers, Search } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchJson } from "@/lib/api";
import { formatBrl, formatBrlShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Bolinha, VariacaoMensal } from "@/components/composicao/farol";
import {
  ROTULO_DO_FAROL,
  type Farol,
  type VisaoDeFrota,
} from "@/components/composicao/tipos";

/**
 * Composição — a frota, por tipo de equipamento.
 *
 * A tela responde, de cima para baixo: **quanto a frota recebe por mês**,
 * **quanto disso mudou**, e **quem mudou**. A tabela é o conteúdo; os números
 * do topo são o resumo dela, e não cartões decorativos — cada um deles é uma
 * contagem que a própria lista reproduz.
 *
 * Duas abas hoje, CAVALOS e CARRETAS, e a terceira — CONJUNTOS — aparece
 * desligada com o motivo escrito, em vez de não existir. Ver `MotivoDosConjuntos`.
 */

/** As abas. A terceira está declarada e desativada — ver o rodapé da barra. */
const TIPOS = [
  { entityType: "CAVALO", rotulo: "Cavalos" },
  { entityType: "CARRETA", rotulo: "Carretas" },
] as const;

interface Filtros {
  busca: string;
  status: Farol | "";
  comAlteracao: boolean;
  comAlerta: boolean;
  comNaoCalculavel: boolean;
}

const SEM_FILTRO: Filtros = {
  busca: "",
  status: "",
  comAlteracao: false,
  comAlerta: false,
  comNaoCalculavel: false,
};

export default function Composicao() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);

  const entityType = params.get("tipo") === "CARRETA" ? "CARRETA" : "CAVALO";
  const period = params.get("period") ?? "";
  const [filtros, setFiltros] = useState<Filtros>(SEM_FILTRO);

  const query = useMemo(() => {
    const q = new URLSearchParams({ entityType });
    if (period) q.set("period", period);
    if (filtros.busca) q.set("busca", filtros.busca);
    if (filtros.status) q.set("status", filtros.status);
    if (filtros.comAlteracao) q.set("comAlteracao", "1");
    if (filtros.comAlerta) q.set("comAlerta", "1");
    if (filtros.comNaoCalculavel) q.set("comNaoCalculavel", "1");
    const scopeHash = params.get("scopeHash");
    if (scopeHash) q.set("scopeHash", scopeHash);
    const canal = params.get("canal");
    if (canal !== null) q.set("canal", canal);
    return q.toString();
  }, [entityType, period, filtros, search]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["composition", "fleet", query],
    queryFn: () => fetchJson<VisaoDeFrota>(`/composition/fleet?${query}`),
  });

  const irPara = (mudancas: Record<string, string>) => {
    const next = new URLSearchParams(search);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === "") next.delete(chave);
      else next.set(chave, valor);
    }
    navigate(`/composicao?${next}`);
  };

  return (
    <Layout>
      <header className="border-b bg-card px-8 pt-6">
        <div className="flex items-start justify-between gap-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Composição</h1>
            <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
              Quanto cada equipamento recebe nesta vigência, de onde vem cada valor, e o
              que o produto ainda não consegue apurar com segurança.
            </p>
          </div>
          {data && (
            <div className="text-right shrink-0">
              <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                {data.context.label}
              </div>
              <VigenciaSelect
                vigencias={data.vigencias}
                atual={data.effectiveDate}
                onEscolher={(v) => irPara({ period: v })}
              />
            </div>
          )}
        </div>

        <nav className="flex items-end gap-1 mt-5 -mb-px" aria-label="Tipo de equipamento">
          {TIPOS.map((tipo) => (
            <button
              key={tipo.entityType}
              type="button"
              onClick={() => irPara({ tipo: tipo.entityType })}
              className={cn(
                "px-5 py-2.5 text-sm font-semibold uppercase tracking-wide border-b-2 transition-colors",
                tipo.entityType === entityType
                  ? "border-brand text-brand"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tipo.rotulo}
            </button>
          ))}
          <MotivoDosConjuntos />
        </nav>
      </header>

      <div className="px-8 py-6 space-y-6">
        {error && (
          <ApiErrorNotice error={error} what="A frota desta vigência não pôde ser carregada." />
        )}

        {data && <Resumo view={data} />}

        <BarraDeFiltros
          filtros={filtros}
          onMudar={setFiltros}
          resultado={data ? `${data.linhas.length} de ${data.totalSemFiltro}` : ""}
        />

        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

        {data && !data.serieEntregue && (
          <div className="bg-card border border-l-[6px] border-l-brand px-6 py-4 text-sm flex gap-3">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-brand" />
            <p>
              A vigência <strong>{data.periodLabel}</strong> não entregou a série de{" "}
              {data.rotuloDoTipo.toLowerCase()}. O que aparece abaixo, se aparecer, veio da
              vigência anterior — são equipamentos que saíram da frota.
            </p>
          </div>
        )}

        {data && <Tabela view={data} />}
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------

function VigenciaSelect({
  vigencias,
  atual,
  onEscolher,
}: {
  vigencias: { effectiveDate: string; periodLabel: string }[];
  atual: string;
  onEscolher: (v: string) => void;
}) {
  return (
    <Select value={atual} onValueChange={onEscolher}>
      <SelectTrigger className="w-52 mt-1 font-semibold">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {[...vigencias].reverse().map((v) => (
          <SelectItem key={v.effectiveDate} value={v.effectiveDate}>
            {v.periodLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A aba que ainda não existe, dita em vez de omitida.
 *
 * O vínculo cavalo–carreta está no dado e é confiável — `Placa Carreta` casa um
 * a um com as carretas do banco nas 9 vigências. O que falta não é o vínculo: é
 * a pergunta que a aba responderia. A remuneração do conjunto já vem pronta da
 * fonte em `custoFixo`, e uma aba que repetisse essa coluna não diria nada que a
 * ficha da carreta não diga. Ela passa a valer contra a remuneração **paga**,
 * que é a auditoria financeira — e esse dado ainda não existe no FreightCheck.
 */
function MotivoDosConjuntos() {
  return (
    <span
      className="ml-2 px-3 py-2.5 text-xs text-muted-foreground/70 inline-flex items-center gap-1.5 cursor-help"
      title={
        "O vínculo cavalo–carreta existe e é confiável (Placa Carreta casa um a um nas " +
        "9 vigências). A aba espera o que ela vai confrontar: a remuneração efetivamente " +
        "paga. Sem isso, ela repetiria a coluna custoFixo que a ficha da carreta já mostra."
      }
    >
      <Layers className="w-3.5 h-3.5" />
      Conjuntos · em breve
    </span>
  );
}

/**
 * Os números da frota.
 *
 * Sem moldura de cartão: quatro colunas separadas por uma linha vertical fina.
 * Um cartão por número transformaria o resumo em quatro objetos a examinar, e
 * eles são um só — a mesma frota, lida de quatro ângulos.
 */
function Resumo({ view }: { view: VisaoDeFrota }) {
  const { resumo } = view;
  return (
    <section className="bg-card border rounded-md">
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0">
        <div className="px-6 py-5">
          <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
            Remuneração mensal apurada
          </div>
          <div className="text-3xl font-bold tabular-nums mt-1 tracking-tight">
            {formatBrlShort(resumo.mensalTotal)}
            <span className="text-base font-normal text-muted-foreground">/mês</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {resumo.comValorApurado} de {resumo.equipamentos}{" "}
            {view.rotuloDoTipo.toLowerCase()}s com valor apurado
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
            Contra {view.anterior?.periodLabel ?? "a vigência anterior"}
          </div>
          <div className="text-3xl font-bold tabular-nums mt-1 tracking-tight">
            <VariacaoMensal
              variacao={
                resumo.variacaoTotal === null
                  ? null
                  : { absoluta: resumo.variacaoTotal, percentual: null }
              }
            />
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {resumo.comAumento} com aumento · {resumo.comReducao} com redução
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
            Situação da frota
          </div>
          <div className="flex items-center gap-4 mt-2.5 flex-wrap">
            {(["CRITICO", "ATENCAO", "NORMAL", "INCOMPLETO"] as Farol[]).map((farol) => (
              <span key={farol} className="inline-flex items-center gap-1.5 text-sm">
                <Bolinha farol={farol} />
                <span className="tabular-nums font-semibold">{resumo.porFarol[farol]}</span>
                <span className="text-muted-foreground text-xs">
                  {ROTULO_DO_FAROL[farol].toLowerCase()}
                </span>
              </span>
            ))}
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
            Ainda sem regra financeira
          </div>
          <div className="text-3xl font-bold tabular-nums mt-1 tracking-tight">
            {resumo.componentesSemRegra}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            componentes monetários que a curadoria ainda não confirmou
          </div>
        </div>
      </div>
    </section>
  );
}

function BarraDeFiltros({
  filtros,
  onMudar,
  resultado,
}: {
  filtros: Filtros;
  onMudar: (f: Filtros) => void;
  resultado: string;
}) {
  const alternar = (chave: "comAlteracao" | "comAlerta" | "comNaoCalculavel") =>
    onMudar({ ...filtros, [chave]: !filtros[chave] });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filtros.busca}
          onChange={(e) => onMudar({ ...filtros, busca: e.target.value })}
          placeholder="Placa ou chassi"
          className="pl-9 w-64"
        />
      </div>

      <Select
        value={filtros.status === "" ? "TODOS" : filtros.status}
        onValueChange={(v) =>
          onMudar({ ...filtros, status: v === "TODOS" ? "" : (v as Farol) })
        }
      >
        <SelectTrigger className="w-44">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="TODOS">Todos os status</SelectItem>
          {(["CRITICO", "ATENCAO", "NORMAL", "INCOMPLETO"] as Farol[]).map((f) => (
            <SelectItem key={f} value={f}>
              {ROTULO_DO_FAROL[f]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {(
        [
          ["comAlteracao", "Com alteração na vigência"],
          ["comAlerta", "Com alerta"],
          ["comNaoCalculavel", "Com componente não calculável"],
        ] as const
      ).map(([chave, rotulo]) => (
        <button
          key={chave}
          type="button"
          onClick={() => alternar(chave)}
          className={cn(
            "px-3 py-2 text-sm rounded-md border transition-colors",
            filtros[chave]
              ? "border-brand bg-accent text-brand font-medium"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {rotulo}
        </button>
      ))}

      {resultado && (
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">
          {resultado} equipamentos
        </span>
      )}
    </div>
  );
}

/**
 * A tabela.
 *
 * `R$ 0,00` e "não apurado" nunca ocupam a mesma célula: o primeiro é um zero
 * que o produto conferiu, o segundo é a ausência de conta. Um equipamento sem
 * valor apurado mostra a frase, e não o zero — é a regra §5 do briefing e é a
 * diferença entre uma frota de graça e uma frota que não sabemos ler.
 */
function Tabela({ view }: { view: VisaoDeFrota }) {
  if (view.linhas.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center border rounded-md bg-card">
        Nenhum equipamento nesta vigência com os filtros aplicados.
      </p>
    );
  }

  return (
    <div className="bg-card border rounded-md overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
            <th className="w-8 px-4 py-2.5" />
            <th className="text-left px-2 py-2.5 font-semibold">Equipamento</th>
            <th className="text-left px-4 py-2.5 font-semibold">Unidade · Operação</th>
            <th className="text-left px-4 py-2.5 font-semibold">Vigência</th>
            <th className="text-right px-4 py-2.5 font-semibold">Remuneração apurada</th>
            <th className="text-right px-4 py-2.5 font-semibold">Variação</th>
            <th className="text-left px-4 py-2.5 font-semibold">Alertas</th>
            <th className="w-8 px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {view.linhas.map((linha) => (
            <tr
              key={linha.entityId}
              className="border-b last:border-0 hover:bg-muted/40 transition-colors"
            >
              <td className="px-4 py-3">
                <Bolinha farol={linha.status.farol} titulo={linha.status.motivos.join(" ")} />
              </td>
              <td className="px-2 py-3">
                <Link
                  href={`/composicao/${linha.entityId}?period=${linha.effectiveDate}`}
                  className="font-semibold font-mono tracking-wide hover:text-brand transition-colors"
                >
                  {linha.placa ?? "sem placa"}
                </Link>
                <div className="text-[0.6875rem] text-muted-foreground font-mono">
                  {linha.chassi ?? ""}
                </div>
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground uppercase tracking-wide">
                {linha.unidade ?? "—"}
                {linha.operacao && ` · ${linha.operacao}`}
              </td>
              <td className="px-4 py-3 text-muted-foreground">{linha.periodLabel}</td>
              <td className="px-4 py-3 text-right">
                {linha.mensal === null ? (
                  <span className="text-muted-foreground text-xs">
                    {linha.presente ? "não apurado" : "fora da vigência"}
                  </span>
                ) : (
                  <>
                    <span className="font-semibold tabular-nums text-base">
                      {formatBrl(linha.mensal)}
                    </span>
                    <span className="text-muted-foreground text-xs">/mês</span>
                    {linha.semRegraFinanceira > 0 && (
                      <div className="text-[0.6875rem] text-muted-foreground">
                        + {linha.semRegraFinanceira} sem regra financeira
                      </div>
                    )}
                  </>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <VariacaoMensal variacao={linha.variacao} semSinalNulo />
              </td>
              <td className="px-4 py-3">
                {linha.status.alertas === 0 ? (
                  <span className="text-muted-foreground text-xs">—</span>
                ) : (
                  <span className="text-xs" title={linha.status.motivos.join("\n")}>
                    {linha.status.alertas} {linha.status.alertas === 1 ? "alerta" : "alertas"}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <Link href={`/composicao/${linha.entityId}?period=${linha.effectiveDate}`}>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
