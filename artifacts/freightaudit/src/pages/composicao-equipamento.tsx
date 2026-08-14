import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams, useSearch } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FileSearch,
  Link2,
  Search,
  ShieldQuestion,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
import { formatBrl, formatBrlShort, formatValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Farolete, VariacaoMensal } from "@/components/composicao/farol";
import {
  NOTA_DA_GAVETA,
  ROTULO_DA_GAVETA,
  SUFIXO_DA_GAVETA,
  type Alteracoes,
  type Composicao,
  type ComponenteNaoApurado,
  type Gaveta,
  type Historico,
  type LinhaCalculavel,
  type MotivoDeExclusao,
} from "@/components/composicao/tipos";

/**
 * A ficha do equipamento — a memória de cálculo da remuneração dele.
 *
 * Quatro abas, e a ordem é a das perguntas: **quanto e por quê** (Composição),
 * **o que mais existe neste ativo** (Parâmetros), **sempre foi assim?**
 * (Histórico), **o que mexeu desde o mês passado** (Alterações).
 *
 * A regra visual que atravessa as quatro: o número aparece com a conta ao lado,
 * ou não aparece. Onde não há conta que se sustente, o lugar do número é
 * ocupado pelo motivo — nunca por um zero.
 */

type Aba = "composicao" | "parametros" | "historico" | "alteracoes";

const ABAS: { chave: Aba; rotulo: string }[] = [
  { chave: "composicao", rotulo: "Composição" },
  { chave: "parametros", rotulo: "Parâmetros" },
  { chave: "historico", rotulo: "Histórico" },
  { chave: "alteracoes", rotulo: "Alterações" },
];

export default function ComposicaoEquipamento() {
  const { entityId } = useParams<{ entityId: string }>();
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const period = params.get("period") ?? "";
  const aba = (params.get("aba") as Aba) ?? "composicao";

  const contexto = useMemo(() => {
    const q = new URLSearchParams();
    if (period) q.set("period", period);
    const scopeHash = params.get("scopeHash");
    if (scopeHash) q.set("scopeHash", scopeHash);
    const canal = params.get("canal");
    if (canal !== null) q.set("canal", canal);
    return q.toString();
  }, [search]);

  const composicao = useQuery({
    queryKey: ["composition", "equipment", entityId, contexto],
    queryFn: () => fetchJson<Composicao>(`/composition/equipment/${entityId}?${contexto}`),
  });

  const historico = useQuery({
    queryKey: ["composition", "history", entityId, contexto],
    queryFn: () =>
      fetchJson<Historico>(`/composition/equipment/${entityId}/history?${contexto}`),
    enabled: aba === "historico",
  });

  const alteracoes = useQuery({
    queryKey: ["composition", "changes", entityId, contexto],
    queryFn: () =>
      fetchJson<Alteracoes>(`/composition/equipment/${entityId}/changes?${contexto}`),
    enabled: aba === "alteracoes",
  });

  const irPara = (mudancas: Record<string, string>) => {
    const next = new URLSearchParams(search);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === "") next.delete(chave);
      else next.set(chave, valor);
    }
    navigate(`/composicao/${entityId}?${next}`);
  };

  const c = composicao.data;

  return (
    <Layout>
      <header className="border-b bg-card px-8 pt-5">
        <Link
          href={`/composicao?tipo=${c?.entityType ?? "CAVALO"}${period ? `&period=${period}` : ""}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Voltar para a frota
        </Link>

        {c && <Cabecalho composicao={c} />}

        <nav className="flex items-end gap-1 mt-5 -mb-px" aria-label="Seções da ficha">
          {ABAS.map((item) => (
            <button
              key={item.chave}
              type="button"
              onClick={() => irPara({ aba: item.chave })}
              className={cn(
                "px-5 py-2.5 text-sm font-semibold uppercase tracking-wide border-b-2 transition-colors",
                item.chave === aba
                  ? "border-brand-red text-brand-red"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {item.rotulo}
            </button>
          ))}
          {/*
            A auditoria financeira — esperado contra recebido — é o destino
            deste módulo, e não tem dado ainda. A aba aparece desligada porque
            omiti-la esconderia a direção do produto; ligada e vazia, ela
            prometeria um confronto que não existe.
          */}
          <span
            className="ml-2 px-3 py-2.5 text-xs text-muted-foreground/70 inline-flex items-center gap-1.5 cursor-help"
            title={
              "Vai confrontar a remuneração que o FreightCheck apura com a que a " +
              "Freightec efetivamente pagou. O valor pago ainda não existe no banco, " +
              "e inventar a diferença é o oposto do que este módulo faz."
            }
          >
            <ShieldQuestion className="w-3.5 h-3.5" />
            Auditoria · em breve
          </span>
        </nav>
      </header>

      <div className="px-8 py-6">
        {composicao.error && (
          <ApiErrorNotice
            error={composicao.error}
            what="A composição deste equipamento não pôde ser carregada."
          />
        )}
        {composicao.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

        {c && aba === "composicao" && <AbaComposicao composicao={c} />}
        {c && aba === "parametros" && <AbaParametros composicao={c} />}
        {aba === "historico" && (
          <AbaHistorico
            historico={historico.data}
            carregando={historico.isLoading}
            erro={historico.error}
            onVigencia={(v) => irPara({ period: v })}
          />
        )}
        {aba === "alteracoes" && (
          <AbaAlteracoes
            alteracoes={alteracoes.data}
            carregando={alteracoes.isLoading}
            erro={alteracoes.error}
          />
        )}
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// Cabeçalho
// ---------------------------------------------------------------------------

function Cabecalho({ composicao }: { composicao: Composicao }) {
  const mensal = composicao.totais.find((t) => t.gaveta === "MENSAL");

  return (
    <div className="flex items-start justify-between gap-10 mt-3 flex-wrap">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-baseline gap-3">
          <span className="uppercase text-muted-foreground text-base font-semibold tracking-widest">
            {composicao.rotuloDoTipo}
          </span>
          <span className="font-mono">{composicao.placa ?? "sem placa"}</span>
        </h1>
        <div className="text-sm text-muted-foreground mt-1 uppercase tracking-wide">
          {composicao.unidade ?? composicao.contextLabel}
          {composicao.operacao && ` · ${composicao.operacao}`}
        </div>
        <div className="text-sm text-muted-foreground mt-0.5">
          Vigência: <strong className="text-foreground">{composicao.periodLabel}</strong>
          <span className="ml-2 font-mono text-xs">{composicao.sourceLabels.join(", ")}</span>
        </div>
        <div className="mt-2 flex items-center gap-4">
          <Farolete farol={composicao.status.farol} />
          {composicao.vinculo && (
            <Link
              href={
                composicao.vinculo.carretaEntityId
                  ? `/composicao/${composicao.vinculo.carretaEntityId}?period=${composicao.effectiveDate}`
                  : "#"
              }
              className={cn(
                "inline-flex items-center gap-1.5 text-sm",
                composicao.vinculo.carretaEntityId
                  ? "text-brand-red hover:underline"
                  : "text-muted-foreground pointer-events-none",
              )}
            >
              <Link2 className="w-3.5 h-3.5" />
              Carreta {composicao.vinculo.placaCarreta}
            </Link>
          )}
        </div>
      </div>

      <div className="text-right pb-1">
        <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
          {composicao.completude.parcial
            ? "Remuneração parcialmente apurada"
            : "Remuneração apurada"}
        </div>
        {mensal === undefined ? (
          <div className="text-2xl font-semibold text-muted-foreground mt-1">
            não apurada nesta vigência
          </div>
        ) : (
          /*
            Com centavos, e não abreviado. Um agregado de frota pode arredondar;
            o número de **um** equipamento não pode, porque a mesma tela mostra
            logo abaixo o total apurado com centavos — e "R$ 4.678" em cima de
            "R$ 4.677,85" é a discrepância que faz quem audita parar e conferir
            qual dos dois é o certo.
          */
          <div className="text-4xl font-bold tabular-nums tracking-tight mt-0.5">
            {formatBrl(mensal.valor)}
            <span className="text-lg font-normal text-muted-foreground">/mês</span>
          </div>
        )}
        <div className="mt-1 text-sm">
          <VariacaoMensal variacao={composicao.variacaoMensal} semSinalNulo />
          {composicao.anterior && (
            <span className="text-muted-foreground text-xs ml-1.5">
              vs {composicao.anterior.periodLabel}
            </span>
          )}
        </div>
        {composicao.completude.semRegraFinanceira > 0 && (
          <div className="text-xs text-muted-foreground mt-1">
            {composicao.completude.calculaveis} componentes apurados ·{" "}
            {composicao.completude.semRegraFinanceira} ainda sem regra financeira
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba Composição
// ---------------------------------------------------------------------------

function AbaComposicao({ composicao }: { composicao: Composicao }) {
  const gavetas: Gaveta[] = ["MENSAL", "ANUAL", "AQUISICAO"];

  return (
    <div className="space-y-8 max-w-5xl">
      {composicao.integridade.length > 0 && (
        <section className="bg-card border border-l-[6px] border-l-brand-red rounded-md px-6 py-4 space-y-2">
          <h2 className="text-sm font-bold flex items-center gap-2 text-brand-red">
            <AlertTriangle className="w-4 h-4" />
            {composicao.integridade.length === 1
              ? "1 inconsistência encontrada"
              : `${composicao.integridade.length} inconsistências encontradas`}
          </h2>
          {composicao.integridade.map((alerta, i) => (
            <p key={i} className="text-sm text-muted-foreground">
              {alerta.mensagem}
            </p>
          ))}
        </section>
      )}

      {gavetas.map((gaveta) => {
        const total = composicao.totais.find((t) => t.gaveta === gaveta);
        const linhas = composicao.linhas.filter((l) => l.gaveta === gaveta);
        if (linhas.length === 0) return null;
        return (
          <BlocoDaGaveta
            key={gaveta}
            gaveta={gaveta}
            linhas={linhas}
            total={total?.valor ?? 0}
          />
        );
      })}

      {composicao.linhas.length === 0 && (
        <p className="text-sm text-muted-foreground bg-card border rounded-md px-6 py-8 text-center">
          Nenhum componente deste equipamento pôde ser apurado com segurança nesta vigência. Os
          parâmetros continuam abaixo, com o motivo de cada um.
        </p>
      )}

      <SemImpactoApurado componentes={composicao.naoApurados} />
    </div>
  );
}

/**
 * Uma gaveta de periodicidade, como memória de cálculo.
 *
 * Linhas empilhadas e um total ao pé, no lugar de uma tabela: a leitura aqui é
 * vertical e cumulativa — cada linha soma à anterior — e uma tabela sugere que
 * as linhas são itens comparáveis entre si, que é outra leitura.
 */
function BlocoDaGaveta({
  gaveta,
  linhas,
  total,
}: {
  gaveta: Gaveta;
  linhas: LinhaCalculavel[];
  total: number;
}) {
  return (
    <section>
      <header className="mb-3">
        <h2 className="text-sm font-bold uppercase tracking-wider">
          {ROTULO_DA_GAVETA[gaveta]}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
          {NOTA_DA_GAVETA[gaveta]}
        </p>
      </header>

      <div className="bg-card border rounded-md divide-y">
        {linhas.map((linha) => (
          <LinhaDaComposicao key={linha.code} linha={linha} />
        ))}

        <div className="flex items-baseline justify-between px-6 py-4 bg-muted/40">
          <span className="text-sm font-bold uppercase tracking-wider">
            Total {gaveta === "MENSAL" ? "apurado" : ROTULO_DA_GAVETA[gaveta].toLowerCase()}
          </span>
          <span className="text-2xl font-bold tabular-nums tracking-tight">
            {formatBrl(total)}
            <span className="text-sm font-normal text-muted-foreground">
              {SUFIXO_DA_GAVETA[gaveta]}
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}

function LinhaDaComposicao({ linha }: { linha: LinhaCalculavel }) {
  const [aberta, setAberta] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setAberta((v) => !v)}
        className="w-full flex items-baseline gap-4 px-6 py-3.5 text-left hover:bg-muted/30 transition-colors"
      >
        {aberta ? (
          <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground self-center" />
        ) : (
          <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground self-center" />
        )}
        <span className="flex-1 min-w-0">
          <span className="font-medium">{linha.titulo}</span>
          {/*
            Taxonomia e parâmetro, e não a família no meio: "Seguros e tributos ·
            Tributos e seguros · IPVA e licenciamento" diz a mesma coisa duas
            vezes com palavras trocadas de lugar. A família continua disponível
            como agrupamento na aba Parâmetros, que é onde ela serve.
          */}
          <span className="block text-[0.6875rem] text-muted-foreground">
            {[linha.taxonomyName, linha.parametro].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className="text-lg font-semibold tabular-nums shrink-0">
          {formatBrl(linha.valor)}
        </span>
      </button>

      {aberta && <ComoChegamos linha={linha} />}
    </div>
  );
}

/**
 * "Como chegamos neste valor?" — a resposta inteira, sem pular degraus.
 *
 * Parâmetro de origem, valor original, unidade, periodicidade, regra, fórmula,
 * resultado, semântica e a célula da planilha. É a exigência §10 do briefing, e
 * é o que separa este módulo de mais uma tela de parâmetros: um número que não
 * pode ser refeito por quem lê não é auditável.
 */
function ComoChegamos({ linha }: { linha: LinhaCalculavel }) {
  const item = (rotulo: string, valor: React.ReactNode) => (
    <div>
      <dt className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">
        {rotulo}
      </dt>
      <dd className="text-sm mt-0.5">{valor}</dd>
    </div>
  );

  return (
    <div className="px-6 pb-5 pt-1 bg-muted/20 border-t">
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
        Como chegamos neste valor
      </h3>

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        {item(
          "Parâmetro de origem",
          <span className="font-mono text-xs">{linha.sourceName}</span>,
        )}
        {item("Valor original", formatValue(linha.valor, linha.unit))}
        {item("Unidade", linha.unit ?? "—")}
        {item("Periodicidade", linha.periodicity ?? "—")}
        {item("Agregação", linha.aggregation ?? "—")}
        {item(
          "Semântica",
          <span>
            {linha.semanticsStatus === "CONFIRMED" ? "confirmada" : linha.semanticsStatus}
            {linha.semanticsVersion !== null && (
              <span className="text-muted-foreground"> · versão {linha.semanticsVersion}</span>
            )}
          </span>,
        )}
        {item("Classe de custo", linha.costClass ?? "—")}
        {item("Código interno", <span className="font-mono text-xs">{linha.code}</span>)}
      </dl>

      <div className="text-sm space-y-2">
        <p className="text-muted-foreground leading-relaxed">{linha.explicacao.regra}</p>

        {linha.calculationBasis && (
          <p className="text-muted-foreground">
            <strong className="text-foreground">Base de cálculo da fonte:</strong>{" "}
            {linha.calculationBasis}
          </p>
        )}

        {linha.explicacao.parcelas.length > 0 && (
          <div className="bg-card border rounded-md p-4 mt-3">
            <div className="text-[0.625rem] uppercase tracking-wider text-muted-foreground mb-2">
              Parcelas que compõem este total
            </div>
            <table className="w-full text-sm">
              <tbody>
                {linha.explicacao.parcelas.map((parcela) => (
                  <tr key={parcela.code} className="border-b last:border-0">
                    <td className="py-1.5">{parcela.titulo}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {parcela.valor === null ? (
                        <span className="text-muted-foreground text-xs">
                          {parcela.ausencia}
                        </span>
                      ) : (
                        formatBrl(parcela.valor)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {linha.explicacao.formula && (
              <div className="mt-3 pt-3 border-t text-sm">
                <span className="text-muted-foreground">Fórmula: </span>
                <span className="font-mono">{linha.explicacao.formula}</span>
                <span className="text-muted-foreground"> = </span>
                <span className="font-mono font-semibold">{formatBrl(linha.valor)}</span>
              </div>
            )}

            {linha.explicacao.divergencia !== null &&
              Math.abs(linha.explicacao.divergencia) > 0.01 && (
                <p className="mt-2 text-sm text-brand-red">
                  As parcelas não fecham com o total: diferença de{" "}
                  {formatBrl(Math.abs(linha.explicacao.divergencia))}. O valor exibido é o da
                  fonte.
                </p>
              )}
          </div>
        )}

        {linha.origem && (
          <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
            <strong className="text-foreground">Origem:</strong> {linha.origem.sourceLabel}
            {linha.origem.sheetName && ` · aba ${linha.origem.sheetName}`}
            {linha.origem.rowIndex !== null && ` · linha ${linha.origem.rowIndex}`}
            {linha.origem.columnLetter && ` · coluna ${linha.origem.columnLetter}`}
            {linha.origem.columnHeader && ` (${linha.origem.columnHeader})`}
            {linha.origem.rawValue !== null && ` · valor bruto "${linha.origem.rawValue}"`}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Os componentes que não viraram dinheiro, com o motivo de cada um.
 *
 * Só os que **parecem** dinheiro entram aqui. Chassi, modelo e câmbio são
 * parâmetros do equipamento, não componentes de remuneração que faltaram: eles
 * moram na aba Parâmetros, que é a lista completa. Misturar os dois faria a
 * seção listar sessenta itens e esconder os cinco que importam.
 */
function SemImpactoApurado({ componentes }: { componentes: ComponenteNaoApurado[] }) {
  const relevantes = componentes.filter(
    (c) => c.monetarioPotencial || c.motivo === "ESCOPO_DE_CONJUNTO",
  );
  if (relevantes.length === 0) return null;

  return (
    <section>
      <header className="mb-3">
        <h2 className="text-sm font-bold uppercase tracking-wider">
          Componentes sem impacto financeiro apurado
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
          Existem no dado, parecem dinheiro, e ficaram fora do total. Cada um diz por quê — e é
          o que a curadoria tem a resolver para o número acima crescer.
        </p>
      </header>

      <div className="bg-card border rounded-md overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-4 py-2.5 font-semibold">Parâmetro</th>
              <th className="text-right px-4 py-2.5 font-semibold">Valor</th>
              <th className="text-left px-4 py-2.5 font-semibold">Unidade</th>
              <th className="text-left px-4 py-2.5 font-semibold">Motivo</th>
              <th className="text-left px-4 py-2.5 font-semibold">Explicação</th>
            </tr>
          </thead>
          <tbody>
            {relevantes.map((componente) => (
              <tr key={componente.code} className="border-b last:border-0 align-top">
                <td className="px-4 py-3">
                  <div className="font-medium">{componente.titulo}</div>
                  <div className="text-[0.6875rem] text-muted-foreground font-mono">
                    {componente.sourceName}
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                  {componente.valorNumerico !== null
                    ? formatValue(componente.valorNumerico, componente.unit)
                    : (componente.valorExibido ?? (
                        <span className="text-muted-foreground text-xs">sem valor</span>
                      ))}
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {componente.unit ?? componente.dataType.toLowerCase()}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="text-xs font-medium">{componente.motivoRotulo}</span>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground max-w-xl">
                  {componente.explicacao}
                  {componente.baseQueFalta && componente.motivo !== "ESCOPO_DE_CONJUNTO" && (
                    <div className="mt-1">
                      <strong className="text-foreground">Destravaria o cálculo:</strong>{" "}
                      {componente.baseQueFalta}.
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Aba Parâmetros
// ---------------------------------------------------------------------------

interface ItemDeParametro {
  code: string;
  titulo: string;
  sourceName: string;
  valor: string;
  /** Número apurado da fonte — decide se a célula alinha como dinheiro ou como texto. */
  numerico: boolean;
  unit: string | null;
  periodicity: string | null;
  taxonomia: string;
  familia: string;
  semantica: string;
  financeiro: boolean;
  motivo: MotivoDeExclusao | null;
  motivoRotulo: string | null;
  explicacao: string | null;
}

type Agrupamento = "taxonomia" | "familia" | "nenhum";

/** "todos" | "financeiros" | "fora" | "motivo:NAO_MONETARIO" — uma dimensão só. */
type Recorte = string;

const SEM_CATEGORIA = "Sem categoria";

function rotuloDaSemantica(status: string): string {
  if (status === "CONFIRMED") return "confirmada";
  if (status === "PRESUMED") return "presumida";
  return "desconhecida";
}

/** Busca que ignora acento e caixa — "combustivel" acha "Combustível". */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function noRecorte(item: ItemDeParametro, recorte: Recorte): boolean {
  if (recorte === "todos") return true;
  if (recorte === "financeiros") return item.financeiro;
  if (recorte === "fora") return !item.financeiro;
  return !item.financeiro && `motivo:${item.motivo}` === recorte;
}

/**
 * O raio-X: todos os atributos do ativo naquela vigência, financeiros ou não.
 *
 * É a resposta ao §19 do briefing — separar **atributo do equipamento** de
 * **componente da remuneração** — e a separação é a coluna "Financeiro", não uma
 * omissão: nada é escondido, e o que não participa da remuneração diz que não
 * participa.
 *
 * O problema de layout desta aba não é falta de informação, é excesso de
 * repetição: setenta e cinco linhas em que "—", "desconhecida" e "Semântica não
 * confirmada" se repetem coluna abaixo. O desenho aqui parte disso:
 *
 * - **coluna que não varia não é coluna.** Unidade já viaja dentro do valor
 *   (`formatValue`), e periodicidade e semântica só ganham coluna quando há mais
 *   de um valor distinto para ler. Quando não há, a informação é dita uma vez,
 *   em texto, acima da tabela;
 * - **o resumo é o filtro.** Contar 8 financeiros num cartão e obrigar quem lê a
 *   procurar os 8 na lista é dar o número e esconder as linhas. Os números do
 *   topo são botões, e cada um é o recorte que ele conta;
 * - **os 8 que entram no total** ficam marcados na linha, porque são a razão de
 *   a tela existir e são 11% dela.
 */
function AbaParametros({ composicao }: { composicao: Composicao }) {
  const [agrupar, setAgrupar] = useState<Agrupamento>("taxonomia");
  const [recorte, setRecorte] = useState<Recorte>("todos");
  const [busca, setBusca] = useState("");
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set());

  const itens: ItemDeParametro[] = useMemo(() => {
    const deLinhas: ItemDeParametro[] = composicao.linhas.map((l) => ({
      code: l.code,
      titulo: l.titulo,
      sourceName: l.sourceName,
      valor: formatValue(l.valor, l.unit),
      numerico: true,
      unit: l.unit,
      periodicity: l.periodicity,
      taxonomia: l.taxonomyName ?? SEM_CATEGORIA,
      familia: l.familia,
      semantica: l.semanticsStatus,
      financeiro: true,
      motivo: null,
      motivoRotulo: null,
      explicacao: l.explicacao.regra,
    }));
    const deNaoApurados: ItemDeParametro[] = composicao.naoApurados.map((n) => ({
      code: n.code,
      titulo: n.titulo,
      sourceName: n.sourceName,
      valor:
        n.valorNumerico !== null
          ? formatValue(n.valorNumerico, n.unit)
          : (n.valorExibido ?? "—"),
      numerico: n.valorNumerico !== null,
      unit: n.unit,
      periodicity: n.periodicity,
      taxonomia: n.taxonomyName ?? SEM_CATEGORIA,
      familia: n.familia,
      semantica: n.semanticsStatus,
      financeiro: false,
      motivo: n.motivo,
      motivoRotulo: n.motivoRotulo,
      explicacao: n.explicacao,
    }));
    return [...deLinhas, ...deNaoApurados].sort((a, b) =>
      a.titulo.localeCompare(b.titulo, "pt-BR"),
    );
  }, [composicao]);

  /** Os motivos de exclusão, com quanto cada um pesa. Particionam os não financeiros. */
  const motivos = useMemo(() => {
    const mapa = new Map<string, { chave: string; rotulo: string; quantos: number }>();
    for (const item of itens) {
      if (item.financeiro || item.motivo === null) continue;
      const atual = mapa.get(item.motivo) ?? {
        chave: `motivo:${item.motivo}`,
        rotulo: item.motivoRotulo ?? item.motivo,
        quantos: 0,
      };
      atual.quantos += 1;
      mapa.set(item.motivo, atual);
    }
    return [...mapa.values()].sort((a, b) => b.quantos - a.quantos);
  }, [itens]);

  const financeiros = itens.filter((i) => i.financeiro).length;

  /*
    Colunas decididas sobre o conjunto inteiro, e não sobre o que o filtro
    deixou passar: uma coluna que aparece e some conforme se digita na busca
    faz a tabela pular embaixo do cursor.
  */
  const variaPeriodicidade = new Set(itens.map((i) => i.periodicity ?? "")).size > 1;
  const semanticas = new Set(itens.map((i) => i.semantica));
  const variaSemantica = semanticas.size > 1;

  const visiveis = useMemo(() => {
    const termo = normalizar(busca.trim());
    return itens.filter((item) => {
      if (!noRecorte(item, recorte)) return false;
      if (termo === "") return true;
      return normalizar(
        `${item.titulo} ${item.sourceName} ${item.valor} ${item.taxonomia} ${item.familia}`,
      ).includes(termo);
    });
  }, [itens, recorte, busca]);

  const grupos = useMemo(() => {
    if (agrupar === "nenhum") {
      return [{ chave: "__tudo", rotulo: null as string | null, lista: visiveis }];
    }
    const mapa = new Map<string, ItemDeParametro[]>();
    for (const item of visiveis) {
      const chave = agrupar === "taxonomia" ? item.taxonomia : item.familia;
      const lista = mapa.get(chave) ?? [];
      lista.push(item);
      mapa.set(chave, lista);
    }
    return [...mapa.entries()]
      .sort(([a], [b]) => {
        // A gaveta do "não classificado" desce: ela não ensina nada sobre o
        // que está dentro dela, e no topo empurra as categorias reais para baixo.
        if (a === SEM_CATEGORIA) return 1;
        if (b === SEM_CATEGORIA) return -1;
        return a.localeCompare(b, "pt-BR");
      })
      .map(([chave, lista]) => ({ chave, rotulo: chave, lista }));
  }, [visiveis, agrupar]);

  const alternarGrupo = (chave: string) =>
    setRecolhidos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(chave)) proximo.delete(chave);
      else proximo.add(chave);
      return proximo;
    });

  return (
    <div className="space-y-4 max-w-6xl">
      <p className="text-sm text-muted-foreground max-w-3xl">
        Todos os parâmetros deste equipamento em{" "}
        <strong className="text-foreground">{composicao.periodLabel}</strong>, financeiros ou
        não. A coluna <strong className="text-foreground">Financeiro</strong> diz quais
        participam da remuneração — a maioria não participa, e é isso que a tela mostra.
      </p>

      {/*
        O resumo e o filtro são a mesma coisa. Cada número é o recorte que ele
        conta, e a lista abaixo responde no clique — em vez de informar "8
        financeiros" e deixar quem lê caçar os oito entre setenta e cinco linhas.
      */}
      <div className="bg-card border rounded-md">
        <div className="flex flex-wrap items-stretch divide-x">
          <BotaoDeRecorte
            ativo={recorte === "todos"}
            onClick={() => setRecorte("todos")}
            quantos={itens.length}
            rotulo="Parâmetros"
            nota="tudo que a vigência entregou"
          />
          <BotaoDeRecorte
            ativo={recorte === "financeiros"}
            onClick={() => setRecorte("financeiros")}
            quantos={financeiros}
            rotulo="Entram no total"
            nota="viram remuneração apurada"
            destaque
          />
          <BotaoDeRecorte
            ativo={recorte === "fora"}
            onClick={() => setRecorte("fora")}
            quantos={itens.length - financeiros}
            rotulo="Fora do total"
            nota="cada um com o motivo ao lado"
          />
        </div>

        {motivos.length > 0 && (
          <div className="border-t px-4 py-3 flex flex-wrap items-center gap-2">
            <span className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground mr-1">
              Por que ficaram fora
            </span>
            {motivos.map((motivo) => (
              <button
                key={motivo.chave}
                type="button"
                aria-pressed={recorte === motivo.chave}
                onClick={() => setRecorte(recorte === motivo.chave ? "fora" : motivo.chave)}
                className={cn(
                  "px-2.5 py-1 text-xs rounded-md border transition-colors",
                  recorte === motivo.chave
                    ? "border-brand-red bg-brand-red/[0.07] text-brand-red font-medium"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {motivo.rotulo}
                <span className="ml-1.5 tabular-nums font-semibold">{motivo.quantos}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome, código de origem ou valor"
            className="pl-9 w-72"
          />
        </div>

        <Select value={agrupar} onValueChange={(v) => setAgrupar(v as Agrupamento)}>
          <SelectTrigger className="w-60 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="taxonomia">Agrupar pela taxonomia</SelectItem>
            <SelectItem value="familia">Agrupar por família Freightech</SelectItem>
            <SelectItem value="nenhum">Sem agrupamento</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground tabular-nums ml-auto">
          {visiveis.length === itens.length
            ? `${itens.length} parâmetros`
            : `${visiveis.length} de ${itens.length} parâmetros`}
        </span>
      </div>

      {/*
        O que não varia sai da tabela e é dito uma vez. Setenta e cinco células
        escritas "desconhecida" não informam setenta e cinco vezes: informam uma
        vez e ocupam uma coluna.
      */}
      {(!variaSemantica || !variaPeriodicidade) && itens.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {!variaSemantica && (
            <>
              Semântica{" "}
              <strong className="text-foreground">
                {rotuloDaSemantica([...semanticas][0] ?? "")}
              </strong>{" "}
              em todos eles.{" "}
            </>
          )}
          {!variaPeriodicidade && "Nenhum declara periodicidade nesta vigência."}
        </p>
      )}

      {visiveis.length === 0 ? (
        <div className="bg-card border rounded-md px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum parâmetro com o recorte e a busca atuais.
          </p>
          <button
            type="button"
            onClick={() => {
              setRecorte("todos");
              setBusca("");
            }}
            className="mt-2 text-sm text-brand-red hover:underline"
          >
            Ver os {itens.length} parâmetros
          </button>
        </div>
      ) : (
        <TabelaDeParametros
          grupos={grupos}
          recolhidos={recolhidos}
          onAlternarGrupo={alternarGrupo}
          comPeriodicidade={variaPeriodicidade}
          comSemantica={variaSemantica}
        />
      )}
    </div>
  );
}

/** Um número do resumo que também é o filtro daquele número. */
function BotaoDeRecorte({
  ativo,
  onClick,
  quantos,
  rotulo,
  nota,
  destaque,
}: {
  ativo: boolean;
  onClick: () => void;
  quantos: number;
  rotulo: string;
  nota: string;
  destaque?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "flex-1 min-w-[12rem] px-5 py-4 text-left transition-colors",
        ativo ? "bg-brand-red/[0.06]" : "hover:bg-muted/40",
      )}
    >
      <div
        className={cn(
          "text-[0.6875rem] uppercase tracking-wider",
          ativo ? "text-brand-red font-semibold" : "text-muted-foreground",
        )}
      >
        {rotulo}
      </div>
      <div
        className={cn(
          "text-2xl font-bold tabular-nums tracking-tight mt-0.5",
          destaque && "text-brand-red",
        )}
      >
        {quantos}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">{nota}</div>
    </button>
  );
}

interface GrupoDeParametros {
  chave: string;
  /** `null` quando não há agrupamento — a tabela sai sem faixas. */
  rotulo: string | null;
  lista: ItemDeParametro[];
}

/**
 * Uma tabela só, com faixas de categoria dentro — e não uma tabela por categoria.
 *
 * Doze tabelas independentes repetiam o cabeçalho doze vezes e, pior, cada uma
 * media a largura das colunas pelo próprio conteúdo: "Valor" caía num x
 * diferente a cada bloco, e comparar duas categorias virava ler duas tabelas.
 * Uma tabela só resolve os dois: um cabeçalho, e a coluna no mesmo lugar do
 * começo ao fim.
 */
function TabelaDeParametros({
  grupos,
  recolhidos,
  onAlternarGrupo,
  comPeriodicidade,
  comSemantica,
}: {
  grupos: GrupoDeParametros[];
  recolhidos: Set<string>;
  onAlternarGrupo: (chave: string) => void;
  comPeriodicidade: boolean;
  comSemantica: boolean;
}) {
  const colunas = 3 + (comPeriodicidade ? 1 : 0) + (comSemantica ? 1 : 0);

  return (
    <div className="bg-card border rounded-md overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
            {/*
              A largura é declarada, e não deixada ao conteúdo: sem isto o nome do
              parâmetro estica até o fim e abre um vão de meia tela entre ele e o
              próprio valor — o olho perde a linha no meio do caminho.
            */}
            <th className="text-left px-4 py-2 font-semibold border-l-[3px] border-l-transparent w-[38%]">
              Parâmetro
            </th>
            <th className="text-right px-4 py-2 font-semibold w-40">Valor</th>
            {comPeriodicidade && (
              <th className="text-left px-4 py-2 font-semibold w-36">Periodicidade</th>
            )}
            {comSemantica && (
              <th className="text-left px-4 py-2 font-semibold w-32">Semântica</th>
            )}
            <th className="text-left px-4 py-2 font-semibold">Financeiro</th>
          </tr>
        </thead>
        {grupos.map((grupo) => {
          const recolhido = recolhidos.has(grupo.chave);
          const noTotal = grupo.lista.filter((i) => i.financeiro).length;
          return (
            <tbody key={grupo.chave} className="border-b last:border-0">
              {grupo.rotulo !== null && (
                <tr className="border-b bg-muted/25">
                  <td colSpan={colunas} className="p-0 border-l-[3px] border-l-transparent">
                    <button
                      type="button"
                      onClick={() => onAlternarGrupo(grupo.chave)}
                      aria-expanded={!recolhido}
                      className="w-full flex items-center gap-2 px-4 py-2 text-left group hover:bg-muted/40 transition-colors"
                    >
                      {recolhido ? (
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                      <h2 className="text-[0.6875rem] font-bold uppercase tracking-wider group-hover:text-brand-red transition-colors">
                        {grupo.rotulo}
                      </h2>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {grupo.lista.length}{" "}
                        {grupo.lista.length === 1 ? "parâmetro" : "parâmetros"}
                        {noTotal > 0 && ` · ${noTotal} no total`}
                      </span>
                    </button>
                  </td>
                </tr>
              )}

              {!recolhido &&
                grupo.lista.map((item) => (
                  <tr
                    key={item.code}
                    className={cn(
                      "border-b last:border-0 hover:bg-muted/30 transition-colors",
                      item.financeiro && "bg-brand-red/[0.035]",
                    )}
                  >
                    {/* A régua vermelha na borda: os que viram dinheiro, achados sem ler. */}
                    <td
                      className={cn(
                        "px-4 py-2 border-l-[3px]",
                        item.financeiro ? "border-l-brand-red" : "border-l-transparent",
                      )}
                    >
                      <div className={cn(item.financeiro && "font-medium")}>{item.titulo}</div>
                      <div className="text-[0.6875rem] text-muted-foreground font-mono">
                        {item.sourceName}
                      </div>
                    </td>
                    {/*
                Número alinha à direita e conta como grandeza; texto — "AUTOMATICO",
                um chassi, "Sim" — sai em mono discreto, porque alinhar string à
                direita num bloco de números faz o olho tentar somá-la.
              */}
                    <td
                      className={cn(
                        "px-4 py-2 whitespace-nowrap",
                        item.numerico
                          ? "text-right tabular-nums font-medium"
                          : "text-right font-mono text-xs text-muted-foreground",
                      )}
                    >
                      {item.valor}
                      {!item.numerico && item.unit && (
                        <span className="ml-1 text-muted-foreground">
                          {item.unit.toLowerCase()}
                        </span>
                      )}
                    </td>
                    {comPeriodicidade && (
                      <td className="px-4 py-2 text-muted-foreground text-xs">
                        {item.periodicity ?? "—"}
                      </td>
                    )}
                    {comSemantica && (
                      <td className="px-4 py-2 text-xs">
                        <span
                          className={cn(
                            item.semantica === "CONFIRMED"
                              ? "text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {rotuloDaSemantica(item.semantica)}
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-2 text-xs">
                      {item.financeiro ? (
                        <span className="inline-flex items-center gap-1.5 font-medium text-brand-red">
                          <span className="w-1.5 h-1.5 rounded-full bg-brand-red" />
                          entra no total
                        </span>
                      ) : (
                        <span
                          className="text-muted-foreground cursor-help"
                          title={item.explicacao ?? undefined}
                        >
                          {item.motivoRotulo}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba Histórico
// ---------------------------------------------------------------------------

function AbaHistorico({
  historico,
  carregando,
  erro,
  onVigencia,
}: {
  historico: Historico | undefined;
  carregando: boolean;
  erro: unknown;
  onVigencia: (effectiveDate: string) => void;
}) {
  const [componente, setComponente] = useState<string>("");

  if (erro) {
    return <ApiErrorNotice error={erro} what="O histórico não pôde ser carregado." />;
  }
  if (carregando || !historico) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }

  const serie = historico.componentes.find((c) => c.code === componente);

  const dados = historico.pontos.map((p) => ({
    periodo: p.periodLabel,
    mensal: p.mensal,
    componente: serie?.pontos.find((s) => s.effectiveDate === p.effectiveDate)?.valor ?? null,
  }));

  return (
    <div className="space-y-6 max-w-5xl">
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider mb-1">
          Evolução da remuneração apurada
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Só a gaveta mensal. Um ponto ausente é uma vigência em que o equipamento não estava
          na frota ou não teve componente apurável — nunca um zero.
        </p>
        <div className="bg-card border rounded-md p-4">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={dados} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                vertical={false}
              />
              <XAxis
                dataKey="periodo"
                tick={{ fontSize: 11 }}
                stroke="hsl(var(--muted-foreground))"
              />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke="hsl(var(--muted-foreground))"
                tickFormatter={(v: number) => formatBrlShort(v)}
                width={90}
              />
              <Tooltip
                formatter={(v) => (typeof v === "number" ? formatBrl(v) : "não apurado")}
                contentStyle={{ fontSize: 12 }}
              />
              <Line
                type="monotone"
                dataKey="mensal"
                name="Remuneração mensal"
                stroke="hsl(var(--brand-red))"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
              />
              {serie && (
                <Line
                  type="monotone"
                  dataKey="componente"
                  name={serie.titulo}
                  stroke="hsl(var(--nav-executiva))"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={{ r: 3 }}
                  connectNulls={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-4 mb-2">
          <h2 className="text-sm font-bold uppercase tracking-wider">Vigência a vigência</h2>
          <Select
            value={componente || "NENHUM"}
            onValueChange={(v) => setComponente(v === "NENHUM" ? "" : v)}
          >
            <SelectTrigger className="w-80">
              <SelectValue placeholder="Sobrepor um componente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NENHUM">Sem componente sobreposto</SelectItem>
              {historico.componentes
                .filter((c) => c.pontos.some((p) => p.valor !== null))
                .map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.titulo}
                    {c.financeiro ? " · entra no total" : ""}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        <div className="bg-card border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-4 py-2 font-semibold">Vigência</th>
                <th className="text-right px-4 py-2 font-semibold">Remuneração apurada</th>
                <th className="text-right px-4 py-2 font-semibold">Δ anterior</th>
                <th className="text-right px-4 py-2 font-semibold">Componentes alterados</th>
                {serie && (
                  <th className="text-right px-4 py-2 font-semibold">{serie.titulo}</th>
                )}
                <th className="text-right px-4 py-2 font-semibold">Sem regra</th>
              </tr>
            </thead>
            <tbody>
              {historico.pontos.map((ponto) => {
                const valorDoComponente = serie?.pontos.find(
                  (p) => p.effectiveDate === ponto.effectiveDate,
                );
                return (
                  <tr
                    key={ponto.effectiveDate}
                    className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                    onClick={() => onVigencia(ponto.effectiveDate)}
                  >
                    <td className="px-4 py-2 font-medium">{ponto.periodLabel}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {ponto.mensal === null ? (
                        <span className="text-muted-foreground text-xs">
                          {ponto.presente ? "não apurado" : "fora da frota"}
                        </span>
                      ) : (
                        formatBrl(ponto.mensal)
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <VariacaoMensal variacao={ponto.variacao} semSinalNulo />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {ponto.componentesAlterados || "—"}
                    </td>
                    {serie && (
                      <td className="px-4 py-2 text-right tabular-nums">
                        {valorDoComponente?.exibicao ?? (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {ponto.semRegraFinanceira}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba Alterações
// ---------------------------------------------------------------------------

function AbaAlteracoes({
  alteracoes,
  carregando,
  erro,
}: {
  alteracoes: Alteracoes | undefined;
  carregando: boolean;
  erro: unknown;
}) {
  if (erro) {
    return <ApiErrorNotice error={erro} what="As alterações não puderam ser carregadas." />;
  }
  if (carregando || !alteracoes) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }
  if (alteracoes.de === null) {
    return (
      <p className="text-sm text-muted-foreground bg-card border rounded-md px-6 py-8 text-center max-w-3xl">
        <FileSearch className="w-5 h-5 mx-auto mb-2 opacity-50" />
        {alteracoes.para.periodLabel} é a primeira vigência desta série. Não há anterior com
        que comparar.
      </p>
    );
  }

  const noTotal = alteracoes.alteracoes.filter((a) => a.entraNoTotal);
  const foraDoTotal = alteracoes.alteracoes.filter((a) => !a.entraNoTotal);

  return (
    <div className="space-y-6 max-w-5xl">
      <section className="bg-card border rounded-md px-6 py-5">
        <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
          {alteracoes.de.periodLabel} → {alteracoes.para.periodLabel}
        </div>
        <div className="flex items-baseline gap-8 mt-2 flex-wrap">
          <div>
            <div className="text-xs text-muted-foreground">Variação da remuneração mensal</div>
            <div className="text-3xl font-bold tabular-nums tracking-tight mt-0.5">
              <VariacaoMensal variacao={alteracoes.variacaoMensal} semSinalNulo />
            </div>
          </div>
          {alteracoes.explicado !== null && (
            <div>
              <div className="text-xs text-muted-foreground">Explicado pelos componentes</div>
              <div className="text-xl font-semibold tabular-nums mt-0.5">
                {comSinal(alteracoes.explicado)}
              </div>
            </div>
          )}
          {alteracoes.naoAtribuido !== null && Math.abs(alteracoes.naoAtribuido) > 0.01 && (
            <div>
              <div className="text-xs text-muted-foreground">Não atribuído</div>
              <div className="text-xl font-semibold tabular-nums mt-0.5 text-brand-red">
                {comSinal(alteracoes.naoAtribuido)}
              </div>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-3 max-w-2xl">
          {alteracoes.alteracoes.length} alterações nesta placa. A decomposição fecha quando o
          explicado é igual à variação — o resto aparece como não atribuído, e nunca é
          escondido dentro de uma das linhas.
        </p>
      </section>

      <ListaDeAlteracoes
        titulo="Alterações que mexem na remuneração"
        nota="Estas entram no total mensal. A soma delas é a variação acima."
        itens={noTotal}
        vazio="Nenhuma alteração desta placa tocou um componente que entra no total."
      />

      <ListaDeAlteracoes
        titulo="Alterações sem impacto financeiro apurado"
        nota="Mudaram, e não mexem no total — cada uma diz por quê."
        itens={foraDoTotal}
        vazio="Nenhuma."
      />
    </div>
  );
}

/**
 * Dinheiro com sinal explícito, no mesmo traço que `VariacaoMensal` usa.
 *
 * `formatBrl(-5169.5)` devolve "-R$ 5.169,50" com hífen; o resto do módulo
 * escreve "−R$ 5.169,50" com sinal de menos. Lado a lado no mesmo cartão, a
 * diferença de dois pixels no traço faz o olho conferir se são o mesmo número.
 */
function comSinal(valor: number): string {
  const sinal = valor > 0 ? "+" : valor < 0 ? "\u2212" : "";
  return `${sinal}${formatBrl(Math.abs(valor))}`;
}

function ListaDeAlteracoes({
  titulo,
  nota,
  itens,
  vazio,
}: {
  titulo: string;
  nota: string;
  itens: Alteracoes["alteracoes"];
  vazio: string;
}) {
  return (
    <section>
      <header className="mb-3">
        <h2 className="text-sm font-bold uppercase tracking-wider">{titulo}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{nota}</p>
      </header>

      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground bg-card border rounded-md px-6 py-6 text-center">
          {vazio}
        </p>
      ) : (
        <div className="bg-card border rounded-md divide-y">
          {itens.map((item) => (
            <div key={item.id} className="px-6 py-4">
              <div className="flex items-baseline justify-between gap-6 flex-wrap">
                <div className="min-w-0">
                  <div className="font-medium">{item.attributeName ?? item.attributeCode}</div>
                  <div className="text-[0.6875rem] text-muted-foreground">
                    {[item.taxonomyName, item.parametro].filter(Boolean).join(" · ")}
                  </div>
                </div>

                <div className="flex items-baseline gap-3 tabular-nums shrink-0">
                  <span className="text-muted-foreground">
                    {item.isNullBefore ? "sem valor" : (item.valueBefore ?? "—")}
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-semibold">
                    {item.isNullAfter ? "sem valor" : (item.valueAfter ?? "—")}
                  </span>
                </div>
              </div>

              <div className="mt-2 text-sm">
                {item.entraNoTotal && item.deltaAbsolute !== null ? (
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      item.deltaAbsolute > 0 ? "text-brand-red" : "text-emerald-600",
                    )}
                  >
                    {item.deltaAbsolute > 0 ? "+" : "−"}
                    {formatBrl(Math.abs(item.deltaAbsolute))}
                    {item.impactPeriodicity === "MENSAL" && "/mês"}
                  </span>
                ) : (
                  <span className="text-muted-foreground text-xs">
                    Impacto financeiro não apurado
                    {item.motivoRotulo && ` · ${item.motivoRotulo}`}
                  </span>
                )}
              </div>

              {(item.explicacao ?? item.impactReason) && (
                <p className="text-xs text-muted-foreground mt-1.5 max-w-3xl">
                  {item.explicacao ?? item.impactReason}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
