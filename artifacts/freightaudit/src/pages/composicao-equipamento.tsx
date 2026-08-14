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
  ReferenceLine,
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
            atual={c?.effectiveDate ?? period}
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
// Peças compartilhadas pelas abas
// ---------------------------------------------------------------------------

/**
 * Um número do resumo que também é o filtro daquele número.
 *
 * As três abas de lista repetem a mesma regra: contar "8 financeiros" e deixar
 * quem lê procurar os oito é dar o número e esconder a linha. Aqui o número é o
 * botão, e a lista abaixo responde ao clique.
 */
function BotaoDeRecorte({
  ativo,
  onClick,
  numero,
  rotulo,
  nota,
  destaque,
}: {
  ativo: boolean;
  onClick: () => void;
  numero: React.ReactNode;
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
        {numero}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">{nota}</div>
    </button>
  );
}

interface ContagemDeMotivo {
  chave: string;
  rotulo: string;
  quantos: number;
}

/** Os motivos de exclusão com o peso de cada um. Particionam a lista recebida. */
function contarMotivos(
  itens: { motivo: MotivoDeExclusao | null; motivoRotulo: string | null }[],
): ContagemDeMotivo[] {
  const mapa = new Map<string, ContagemDeMotivo>();
  for (const item of itens) {
    if (item.motivo === null) continue;
    const atual = mapa.get(item.motivo) ?? {
      chave: `motivo:${item.motivo}`,
      rotulo: item.motivoRotulo ?? item.motivo,
      quantos: 0,
    };
    atual.quantos += 1;
    mapa.set(item.motivo, atual);
  }
  return [...mapa.values()].sort((a, b) => b.quantos - a.quantos);
}

/** A linha de motivos, clicável — o detalhe do "fora do total". */
function ChipsDeMotivo({
  motivos,
  ativo,
  onEscolher,
  rotulo = "Por que ficaram fora",
  className,
}: {
  motivos: ContagemDeMotivo[];
  ativo: string;
  /** Recebe a chave do motivo, ou `null` quando o clique desmarca. */
  onEscolher: (chave: string | null) => void;
  rotulo?: string;
  className?: string;
}) {
  if (motivos.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground mr-1">
        {rotulo}
      </span>
      {motivos.map((motivo) => (
        <button
          key={motivo.chave}
          type="button"
          aria-pressed={ativo === motivo.chave}
          onClick={() => onEscolher(ativo === motivo.chave ? null : motivo.chave)}
          className={cn(
            "px-2.5 py-1 text-xs rounded-md border transition-colors",
            ativo === motivo.chave
              ? "border-brand-red bg-brand-red/[0.07] text-brand-red font-medium"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {motivo.rotulo}
          <span className="ml-1.5 tabular-nums font-semibold">{motivo.quantos}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Um valor da fonte, alinhado pelo que ele é.
 *
 * Número à direita, tabular, para que a coluna se compare de cima a baixo; texto
 * — "AUTOMATICO", um chassi, "Sim" — em mono discreto, porque alinhar string à
 * direita num bloco de números faz o olho tentar somá-la.
 */
function ValorDaFonte({
  numerico,
  children,
}: {
  numerico: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        numerico ? "tabular-nums font-medium" : "font-mono text-xs text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Aba Composição
// ---------------------------------------------------------------------------

const GAVETAS: Gaveta[] = ["MENSAL", "ANUAL", "AQUISICAO"];

/**
 * A memória de cálculo — e, ao lado dela, o que não virou cálculo.
 *
 * Mesmo tratamento da aba Parâmetros, pela mesma razão: o topo conta as gavetas
 * e o "fora do total", e cada número abre exatamente o que ele conta. Antes, o
 * total anual e o de aquisição só existiam no pé do próprio bloco — para saber
 * que existiam era preciso rolar até eles.
 */
function AbaComposicao({ composicao }: { composicao: Composicao }) {
  const [recorte, setRecorte] = useState<string>("tudo");
  const [abertas, setAbertas] = useState<Set<string>>(new Set());

  const foraDoTotal = composicao.naoApurados.filter(
    (c) => c.monetarioPotencial || c.motivo === "ESCOPO_DE_CONJUNTO",
  );

  const comLinhas = GAVETAS.map((gaveta) => ({
    gaveta,
    linhas: composicao.linhas.filter((l) => l.gaveta === gaveta),
    total: composicao.totais.find((t) => t.gaveta === gaveta)?.valor ?? 0,
  })).filter((g) => g.linhas.length > 0);

  const visiveis = comLinhas.filter(
    (g) => recorte === "tudo" || recorte === `gaveta:${g.gaveta}`,
  );
  const mostrarFora = recorte === "tudo" || recorte.startsWith("motivo:");

  const todasAbertas =
    composicao.linhas.length > 0 && abertas.size === composicao.linhas.length;

  const alternarLinha = (code: string) =>
    setAbertas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(code)) proximo.delete(code);
      else proximo.add(code);
      return proximo;
    });

  return (
    <div className="space-y-6 max-w-5xl">
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

      {(comLinhas.length > 0 || foraDoTotal.length > 0) && (
        <div className="bg-card border rounded-md">
          <div className="flex flex-wrap items-stretch divide-x">
            <BotaoDeRecorte
              ativo={recorte === "tudo"}
              onClick={() => setRecorte("tudo")}
              numero={composicao.linhas.length + foraDoTotal.length}
              rotulo="Componentes"
              nota="tudo que a vigência entregou como dinheiro"
            />
            {comLinhas.map((g) => (
              <BotaoDeRecorte
                key={g.gaveta}
                ativo={recorte === `gaveta:${g.gaveta}`}
                onClick={() => setRecorte(`gaveta:${g.gaveta}`)}
                numero={
                  <>
                    {formatBrl(g.total)}
                    <span className="text-sm font-normal text-muted-foreground">
                      {SUFIXO_DA_GAVETA[g.gaveta]}
                    </span>
                  </>
                }
                rotulo={ROTULO_DA_GAVETA[g.gaveta]}
                nota={`${g.linhas.length} ${g.linhas.length === 1 ? "componente" : "componentes"}`}
                destaque={g.gaveta === "MENSAL"}
              />
            ))}
            {foraDoTotal.length > 0 && (
              <BotaoDeRecorte
                ativo={recorte === "fora" || recorte.startsWith("motivo:")}
                onClick={() => setRecorte("fora")}
                numero={foraDoTotal.length}
                rotulo="Fora do total"
                nota="parecem dinheiro e não entraram"
              />
            )}
          </div>

          <ChipsDeMotivo
            motivos={contarMotivos(foraDoTotal)}
            ativo={recorte}
            onEscolher={(chave) => setRecorte(chave ?? "fora")}
            className="border-t px-4 py-3"
          />
        </div>
      )}

      {composicao.linhas.length > 1 &&
        recorte !== "fora" &&
        !recorte.startsWith("motivo:") && (
          <div className="flex justify-end -mb-2">
            <button
              type="button"
              onClick={() =>
                setAbertas(
                  todasAbertas ? new Set() : new Set(composicao.linhas.map((l) => l.code)),
                )
              }
              className="text-xs text-muted-foreground hover:text-brand-red transition-colors inline-flex items-center gap-1.5"
            >
              {todasAbertas ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              {todasAbertas ? "Fechar todos os cálculos" : "Abrir todos os cálculos"}
            </button>
          </div>
        )}

      {recorte !== "fora" &&
        !recorte.startsWith("motivo:") &&
        visiveis.map((g) => (
          <BlocoDaGaveta
            key={g.gaveta}
            gaveta={g.gaveta}
            linhas={g.linhas}
            total={g.total}
            abertas={abertas}
            onAlternar={alternarLinha}
          />
        ))}

      {composicao.linhas.length === 0 && (
        <p className="text-sm text-muted-foreground bg-card border rounded-md px-6 py-8 text-center">
          Nenhum componente deste equipamento pôde ser apurado com segurança nesta vigência. Os
          parâmetros continuam abaixo, com o motivo de cada um.
        </p>
      )}

      {mostrarFora || recorte === "fora" ? (
        <SemImpactoApurado
          componentes={composicao.naoApurados}
          motivoFiltrado={recorte.startsWith("motivo:") ? recorte : null}
        />
      ) : null}
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
  abertas,
  onAlternar,
}: {
  gaveta: Gaveta;
  linhas: LinhaCalculavel[];
  total: number;
  abertas: Set<string>;
  onAlternar: (code: string) => void;
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
          <LinhaDaComposicao
            key={linha.code}
            linha={linha}
            aberta={abertas.has(linha.code)}
            onAlternar={() => onAlternar(linha.code)}
          />
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

/**
 * O estado de aberta mora na aba, e não aqui.
 *
 * "Abrir todos os cálculos" é o gesto de quem vai conferir a memória inteira —
 * a auditoria de §10 — e com o estado dentro de cada linha esse gesto exigiria
 * oito cliques e, depois, oito de volta.
 */
function LinhaDaComposicao({
  linha,
  aberta,
  onAlternar,
}: {
  linha: LinhaCalculavel;
  aberta: boolean;
  onAlternar: () => void;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={aberta}
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
function SemImpactoApurado({
  componentes,
  motivoFiltrado,
}: {
  componentes: ComponenteNaoApurado[];
  /** "motivo:NAO_MONETARIO", vindo da faixa do topo. `null` mostra todos. */
  motivoFiltrado: string | null;
}) {
  const relevantes = componentes.filter(
    (c) => c.monetarioPotencial || c.motivo === "ESCOPO_DE_CONJUNTO",
  );
  if (relevantes.length === 0) return null;

  const visiveis =
    motivoFiltrado === null
      ? relevantes
      : relevantes.filter((c) => `motivo:${c.motivo}` === motivoFiltrado);

  /*
    A coluna "Unidade" imprimia `dataType` quando não havia unidade — "number",
    "text" — que é o tipo do dado no banco, e não uma grandeza. Ela some: a
    unidade real já viaja dentro do valor, por `formatValue`.
  */
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
              <th className="text-left px-4 py-2.5 font-semibold w-[26%]">Parâmetro</th>
              <th className="text-right px-4 py-2.5 font-semibold w-36">Valor</th>
              <th className="text-left px-4 py-2.5 font-semibold w-48">Motivo</th>
              <th className="text-left px-4 py-2.5 font-semibold">Explicação</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((componente) => (
              <tr key={componente.code} className="border-b last:border-0 align-top">
                <td className="px-4 py-3">
                  <div className="font-medium">{componente.titulo}</div>
                  <div className="text-[0.6875rem] text-muted-foreground font-mono">
                    {componente.sourceName}
                  </div>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <ValorDaFonte numerico={componente.valorNumerico !== null}>
                    {componente.valorNumerico !== null
                      ? formatValue(componente.valorNumerico, componente.unit)
                      : (componente.valorExibido ?? (
                          <span className="text-muted-foreground text-xs">sem valor</span>
                        ))}
                  </ValorDaFonte>
                </td>
                <td className="px-4 py-3">
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

  const motivos = useMemo(() => contarMotivos(itens.filter((i) => !i.financeiro)), [itens]);

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
            numero={itens.length}
            rotulo="Parâmetros"
            nota="tudo que a vigência entregou"
          />
          <BotaoDeRecorte
            ativo={recorte === "financeiros"}
            onClick={() => setRecorte("financeiros")}
            numero={financeiros}
            rotulo="Entram no total"
            nota="viram remuneração apurada"
            destaque
          />
          <BotaoDeRecorte
            ativo={recorte === "fora"}
            onClick={() => setRecorte("fora")}
            numero={itens.length - financeiros}
            rotulo="Fora do total"
            nota="cada um com o motivo ao lado"
          />
        </div>

        <ChipsDeMotivo
          motivos={motivos}
          ativo={recorte}
          onEscolher={(chave) => setRecorte(chave ?? "fora")}
          className="border-t px-4 py-3"
        />
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
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <ValorDaFonte numerico={item.numerico}>
                        {item.valor}
                        {!item.numerico && item.unit && (
                          <span className="ml-1">{item.unit.toLowerCase()}</span>
                        )}
                      </ValorDaFonte>
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

/**
 * A série da placa, vigência a vigência.
 *
 * Mesmo tratamento das outras duas abas. O topo conta a série — quantas
 * vigências, quantas apuradas, quantas mexeram — e cada número filtra a tabela;
 * o gráfico nunca filtra, porque uma linha do tempo com buracos escolhidos a
 * dedo mente sobre a forma da curva.
 *
 * E a vigência aberta na ficha aparece marcada, no gráfico e na tabela: sem
 * isso, a tabela é uma lista de nove linhas iguais e quem lê perde de onde veio.
 */
function AbaHistorico({
  historico,
  carregando,
  erro,
  onVigencia,
  atual,
}: {
  historico: Historico | undefined;
  carregando: boolean;
  erro: unknown;
  onVigencia: (effectiveDate: string) => void;
  /** A vigência aberta na ficha — a linha que fica marcada. */
  atual: string;
}) {
  const [componente, setComponente] = useState<string>("");
  const [recorte, setRecorte] = useState<"todas" | "apuradas" | "alteradas">("todas");

  if (erro) {
    return <ApiErrorNotice error={erro} what="O histórico não pôde ser carregado." />;
  }
  if (carregando || !historico) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }

  const serie = historico.componentes.find((c) => c.code === componente);
  const pontos = historico.pontos;

  const dados = pontos.map((p) => ({
    periodo: p.periodLabel,
    mensal: p.mensal,
    componente: serie?.pontos.find((s) => s.effectiveDate === p.effectiveDate)?.valor ?? null,
  }));

  const apurados = pontos.filter((p) => p.mensal !== null);
  const alterados = pontos.filter((p) => p.componentesAlterados > 0);

  /*
    A variação do período inteiro — do primeiro ao último apurado — que a coluna
    "Δ anterior" não dá: ela compara com o vizinho, e nove saltos pequenos na
    mesma direção somam um salto grande que nenhuma linha mostra.
  */
  const primeiro = apurados[0];
  const ultimo = apurados[apurados.length - 1];
  const acumulada =
    primeiro && ultimo && primeiro !== ultimo && primeiro.mensal !== null
      ? {
          absoluta: (ultimo.mensal ?? 0) - primeiro.mensal,
          percentual:
            primeiro.mensal === 0
              ? null
              : (((ultimo.mensal ?? 0) - primeiro.mensal) / primeiro.mensal) * 100,
        }
      : null;

  const visiveis = pontos.filter((p) => {
    if (recorte === "apuradas") return p.mensal !== null;
    if (recorte === "alteradas") return p.componentesAlterados > 0;
    return true;
  });

  // Colunas decididas sobre a série inteira — ver a mesma regra na aba Parâmetros.
  const variaAlterados = new Set(pontos.map((p) => p.componentesAlterados)).size > 1;
  const semRegra = new Set(pontos.map((p) => p.semRegraFinanceira));
  const variaSemRegra = semRegra.size > 1;
  const marcada = pontos.find((p) => p.effectiveDate === atual);

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="bg-card border rounded-md flex flex-wrap items-stretch divide-x">
        <BotaoDeRecorte
          ativo={recorte === "todas"}
          onClick={() => setRecorte("todas")}
          numero={pontos.length}
          rotulo="Vigências na série"
          nota="o que o histórico alcança"
        />
        <BotaoDeRecorte
          ativo={recorte === "apuradas"}
          onClick={() => setRecorte("apuradas")}
          numero={apurados.length}
          rotulo="Com valor apurado"
          nota="nas outras, não havia conta que se sustentasse"
          destaque
        />
        <BotaoDeRecorte
          ativo={recorte === "alteradas"}
          onClick={() => setRecorte("alteradas")}
          numero={alterados.length}
          rotulo="Com componente alterado"
          nota="algo mudou em relação à vigência anterior"
        />
      </div>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-4 mb-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-1">
              Evolução da remuneração apurada
            </h2>
            <p className="text-xs text-muted-foreground max-w-2xl">
              Só a gaveta mensal. Um ponto ausente é uma vigência em que o equipamento não
              estava na frota ou não teve componente apurável — nunca um zero.
              {acumulada && (
                <>
                  {" "}
                  De {primeiro?.periodLabel} a {ultimo?.periodLabel}:{" "}
                  <VariacaoMensal variacao={acumulada} className="text-xs" semSinalNulo />.
                </>
              )}
            </p>
          </div>
          {/*
            O seletor mora aqui, e não sobre a tabela: o que ele muda primeiro é a
            segunda linha do gráfico. A coluna que ele acrescenta à tabela é o
            efeito colateral, não o efeito.
          */}
          <Select
            value={componente || "NENHUM"}
            onValueChange={(v) => setComponente(v === "NENHUM" ? "" : v)}
          >
            <SelectTrigger className="w-80 shrink-0">
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
              {marcada && (
                <ReferenceLine
                  x={marcada.periodLabel}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="2 3"
                  label={{
                    value: "vigência aberta",
                    position: "insideTopRight",
                    fontSize: 10,
                    fill: "hsl(var(--muted-foreground))",
                  }}
                />
              )}
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
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-2">
          <h2 className="text-sm font-bold uppercase tracking-wider">Vigência a vigência</h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {visiveis.length === pontos.length
              ? `${pontos.length} vigências`
              : `${visiveis.length} de ${pontos.length} vigências`}
          </span>
        </div>

        {/* O que não varia sai da tabela e é dito uma vez. */}
        {(!variaAlterados || !variaSemRegra) && (
          <p className="text-xs text-muted-foreground mb-2">
            {!variaAlterados &&
              (alterados.length === 0
                ? "Nenhuma vigência registrou componente alterado. "
                : `${pontos[0]?.componentesAlterados} componentes alterados em todas as vigências. `)}
            {!variaSemRegra &&
              `${[...semRegra][0]} componentes sem regra financeira em todas elas.`}
          </p>
        )}

        <div className="bg-card border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-4 py-2 font-semibold border-l-[3px] border-l-transparent">
                  Vigência
                </th>
                <th className="text-right px-4 py-2 font-semibold w-48">
                  Remuneração apurada
                </th>
                <th className="text-right px-4 py-2 font-semibold w-44">Δ anterior</th>
                {variaAlterados && (
                  <th className="text-right px-4 py-2 font-semibold w-40">
                    Componentes alterados
                  </th>
                )}
                {serie && (
                  <th className="text-right px-4 py-2 font-semibold w-40">{serie.titulo}</th>
                )}
                {variaSemRegra && (
                  <th className="text-right px-4 py-2 font-semibold w-28">Sem regra</th>
                )}
              </tr>
            </thead>
            <tbody>
              {visiveis.map((ponto) => {
                const valorDoComponente = serie?.pontos.find(
                  (p) => p.effectiveDate === ponto.effectiveDate,
                );
                const aberta = ponto.effectiveDate === atual;
                return (
                  <tr
                    key={ponto.effectiveDate}
                    className={cn(
                      "border-b last:border-0 hover:bg-muted/40 cursor-pointer transition-colors",
                      aberta && "bg-brand-red/[0.035]",
                    )}
                    onClick={() => onVigencia(ponto.effectiveDate)}
                    title={`Abrir a ficha de ${ponto.periodLabel}`}
                  >
                    <td
                      className={cn(
                        "px-4 py-2 font-medium border-l-[3px]",
                        aberta ? "border-l-brand-red" : "border-l-transparent",
                      )}
                    >
                      {ponto.periodLabel}
                      {aberta && (
                        <span className="ml-2 text-[0.6875rem] font-normal uppercase tracking-wider text-brand-red">
                          vigência aberta
                        </span>
                      )}
                    </td>
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
                    {variaAlterados && (
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {ponto.componentesAlterados || "—"}
                      </td>
                    )}
                    {serie && (
                      <td className="px-4 py-2 text-right tabular-nums">
                        {valorDoComponente?.exibicao ?? (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                    )}
                    {variaSemRegra && (
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {ponto.semRegraFinanceira}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {visiveis.length === 0 && (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              Nenhuma vigência com este recorte.{" "}
              <button
                type="button"
                onClick={() => setRecorte("todas")}
                className="text-brand-red hover:underline"
              >
                Ver as {pontos.length}
              </button>
            </p>
          )}
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
