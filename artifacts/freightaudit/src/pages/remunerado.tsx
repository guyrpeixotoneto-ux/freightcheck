import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Info,
  Link2,
  Search,
  TriangleAlert,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Input } from "@/components/ui/input";
import { fetchJson } from "@/lib/api";
import { formatNumber, formatValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SUFIXO_DA_GAVETA } from "@/components/composicao/tipos";
import { formatarValor } from "@/components/qlp/apresentacao";
import { TabelaDaMatriz } from "@/components/compras/matriz-da-frota";
import {
  ROTULO_DA_NATUREZA,
  ROTULO_DA_RESSALVA,
  ROTULO_DO_PAPEL,
  type ConsultaDaPlaca,
  type ConsultaDoQlp,
  type MatrizDaFrota,
  type LinhaDoProduto,
  type PlacaEncontrada,
  type ProdutoConsultado,
  type ProdutoDeCompra,
  type ProdutoDoQlp,
} from "@/components/compras/tipos";

/**
 * Remunerado — o que a Ambev paga por um produto, antes de o pedido ser liberado.
 *
 * A tela responde a uma pergunta só, e responde depressa: **quanto a Ambev
 * remunera isto?** Quem a abre tem um pedido de compra parado na mesa e precisa
 * do número para dar o ok. Por isso não há filtro, não há gráfico, e a primeira
 * coisa em foco é o campo de busca.
 *
 * **O que ela deliberadamente não faz: comparar com o preço do pedido.** O
 * pedido não está no banco. Uma tela que dissesse "pode comprar" estaria
 * opinando sobre um preço que ela não conhece — e a decisão continua sendo de
 * quem assina.
 *
 * Dois balcões, porque a pergunta chega por dois caminhos e eles pedem chaves
 * diferentes: o da **frota** abre por placa (pneu, manutenção, combustível), e o
 * do **QLP administrativo** abre pela estrutura (uniforme, telefonia, frota
 * leve, benefício). Um uniforme não tem placa, e um pneu não tem cargo.
 *
 * A regra visual que atravessa as duas: **a ressalva vem antes do número.**
 * `valorPneu` é zero em toda a série do export, e um "R$ 0,00" solo ao lado de
 * *Pneus* faria quem está com pressa concluir que a Ambev não remunera pneu.
 * O que a fonte diz é outra coisa — que a coluna não é preenchida —, e é isso
 * que se lê primeiro.
 */

type Aba = "frota" | "qlp";

const ABAS: { chave: Aba; rotulo: string; nota: string }[] = [
  {
    chave: "frota",
    rotulo: "Frota",
    nota: "Pneu, manutenção, combustível e o que mais se compra para um veículo. Abre na frota inteira; a placa abre a ficha.",
  },
  {
    chave: "qlp",
    rotulo: "QLP administrativo",
    nota: "Uniforme, telefonia, frota leve e benefício — com o valor unitário que a fonte declara.",
  },
];

export default function Remunerado() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const aba = (params.get("aba") as Aba) ?? "frota";
  const placa = params.get("placa") ?? "";

  /* O contexto viaja na URL, como no resto do produto — ver `composicao-equipamento.tsx`. */
  const contexto = useMemo(() => {
    const q = new URLSearchParams();
    const period = params.get("period");
    if (period) q.set("period", period);
    const scopeHash = params.get("scopeHash");
    if (scopeHash) q.set("scopeHash", scopeHash);
    const canal = params.get("canal");
    if (canal !== null) q.set("canal", canal);
    return q.toString();
  }, [search]);

  const irPara = (mudancas: Record<string, string>) => {
    const next = new URLSearchParams(search);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === "") next.delete(chave);
      else next.set(chave, valor);
    }
    navigate(`/remunerado?${next}`);
  };

  return (
    <Layout>
      <header className="border-b bg-card px-8 pt-5">
        <h1 className="text-xl font-bold tracking-tight">Remunerado</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          O que a Ambev paga por um produto nesta vigência. A tela devolve o remunerado; a
          comparação com o preço do pedido é de quem assina.
        </p>

        <nav className="flex items-end gap-1 mt-5 -mb-px" aria-label="Balcões">
          {ABAS.map((a) => (
            <button
              key={a.chave}
              type="button"
              onClick={() => irPara({ aba: a.chave })}
              className={cn(
                "px-5 py-2.5 text-sm font-semibold uppercase tracking-wide border-b-2 transition-colors",
                aba === a.chave
                  ? "border-brand text-brand"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {a.rotulo}
            </button>
          ))}
        </nav>
      </header>

      <div className="flex-1 min-h-0 overflow-auto px-8 py-6">
        <p className="text-xs text-muted-foreground mb-5 max-w-3xl">
          {ABAS.find((a) => a.chave === aba)!.nota}
        </p>
        {aba === "frota" ? (
          <BalcaoDaFrota
            placa={placa}
            contexto={contexto}
            onEscolher={(p) => irPara({ placa: p })}
          />
        ) : (
          <BalcaoDoQlp contexto={contexto} />
        )}
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// Balcão da frota
// ---------------------------------------------------------------------------

function BalcaoDaFrota({
  placa,
  contexto,
  onEscolher,
}: {
  placa: string;
  contexto: string;
  onEscolher: (placa: string) => void;
}) {
  /*
    O termo digitado sobe até aqui porque ele serve a duas coisas ao mesmo
    tempo: escolher uma placa (Enter, ou um clique na sugestão) e **estreitar a
    matriz enquanto se digita**. Era o gesto que faltava — a tela pedia a placa
    inteira antes de responder qualquer coisa, e quem tem quinze pedidos na mesa
    não quer quinze consultas, quer a lista.
  */
  const [termo, setTermo] = useState(placa);

  const consulta = useQuery({
    queryKey: ["compras", "frota", placa, contexto],
    queryFn: () =>
      fetchJson<ConsultaDaPlaca>(
        `/compras/remunerado/frota?placa=${encodeURIComponent(placa)}&${contexto}`,
      ),
    enabled: placa !== "",
  });

  /*
    A matriz não é buscada enquanto uma placa está aberta: a ficha ocupa a tela
    inteira, e uma consulta de frota rodando por trás dela é uma leitura que
    ninguém vai ver. Ao voltar, o cache do react-query devolve a tabela sem uma
    segunda ida ao servidor.
  */
  const matriz = useQuery({
    queryKey: ["compras", "matriz", contexto],
    queryFn: () => fetchJson<MatrizDaFrota>(`/compras/remunerado/frota/matriz?${contexto}`),
    enabled: placa === "",
  });

  return (
    <div className={cn("space-y-6", placa === "" ? "max-w-none" : "max-w-5xl")}>
      <BuscaDePlaca valor={placa} termo={termo} onTermo={setTermo} onEscolher={onEscolher} />

      {placa === "" && (
        <>
          {matriz.isError && (
            <ApiErrorNotice error={matriz.error} what="o remunerado da frota" />
          )}
          {matriz.data && (
            <>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                <span>{matriz.data.periodLabel}</span>
                <span>{matriz.data.contextLabel}</span>
              </div>
              <TabelaDaMatriz matriz={matriz.data} termo={termo} contexto={contexto} />
            </>
          )}
        </>
      )}

      {consulta.isError && (
        <ApiErrorNotice error={consulta.error} what="o remunerado desta placa" />
      )}

      {consulta.data && (
        <>
          <button
            type="button"
            onClick={() => {
              setTermo("");
              onEscolher("");
            }}
            className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Voltar para a frota inteira
          </button>
          <CabecalhoDaPlaca consulta={consulta.data} />
          {!consulta.data.presente ? (
            <p className="text-sm text-muted-foreground bg-card border rounded-md px-6 py-8 text-center">
              Este veículo não tem nenhum dado na vigência {consulta.data.periodLabel}. Não é
              erro: ele não estava na frota que a fonte entregou.
            </p>
          ) : (
            <div className="space-y-4">
              {consulta.data.produtos.map((p) => (
                <CartaoDoProduto key={p.produto.chave} consultado={p} />
              ))}
            </div>
          )}
          <ForaDoCatalogo consulta={consulta.data} />
        </>
      )}
    </div>
  );
}

/**
 * O campo de busca, com as placas que casam com o prefixo.
 *
 * O que ele **não** faz: buscar sozinho a cada tecla contra a rota da consulta.
 * A lista de placas é barata; a consulta de um veículo não é, e disparar uma a
 * cada letra faria a tela responder três vezes antes da placa terminar de ser
 * digitada.
 *
 * O termo é do balcão, e não deste componente: ele filtra a matriz **enquanto**
 * se digita, e só vira consulta quando a pessoa escolhe uma placa. É o que
 * permite ao mesmo campo servir aos dois gestos — procurar na frota e abrir um
 * veículo — sem que a tela tenha duas caixas de busca dizendo coisas parecidas.
 */
function BuscaDePlaca({
  valor,
  termo,
  onTermo,
  onEscolher,
}: {
  valor: string;
  termo: string;
  onTermo: (termo: string) => void;
  onEscolher: (placa: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => onTermo(valor), [valor]);

  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);

  const sugestoes = useQuery({
    queryKey: ["compras", "placas", termo],
    queryFn: () =>
      fetchJson<{ placas: PlacaEncontrada[] }>(
        `/compras/placas?termo=${encodeURIComponent(termo)}`,
      ),
    enabled: termo.trim().length >= 2,
  });

  const escolher = (p: string) => {
    setAberto(false);
    onEscolher(p);
  };

  return (
    <div ref={caixa} className="relative">
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          /*
            O foco automático é só quando não há placa escolhida. Com uma placa
            na URL — que é como se chega aqui por um link compartilhado ou pelo
            atalho da carreta — focar abriria a lista de sugestões por cima do
            resultado que a pessoa veio ver.
          */
          autoFocus={valor === ""}
          value={termo}
          placeholder="Placa do veículo — filtra a lista; Enter abre a ficha"
          aria-label="Placa do veículo"
          className="pl-10 h-12 text-base font-mono tracking-wider"
          onChange={(e) => {
            onTermo(e.target.value);
            setAberto(true);
          }}
          /*
            Abre ao focar **só** quando o campo já foi editado. Clicar de volta
            num campo que já resolveu uma placa não é um pedido de trocar de
            veículo, e abrir a lista ali tapa a resposta.
          */
          onFocus={() => setAberto(termo !== valor)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const primeira = sugestoes.data?.placas[0];
            escolher(primeira ? primeira.placa : termo.trim());
          }}
        />
      </div>

      {aberto && (sugestoes.data?.placas.length ?? 0) > 0 && (
        <ul className="absolute z-20 mt-1 w-full bg-card border rounded-md shadow-lg overflow-hidden">
          {sugestoes.data!.placas.map((p) => (
            <li key={p.placa}>
              <button
                type="button"
                onClick={() => escolher(p.placa)}
                className="w-full flex items-baseline gap-3 px-4 py-2.5 text-left hover:bg-muted/50 transition-colors"
              >
                <span className="font-mono font-medium tracking-wider">{p.placaLegivel}</span>
                <span className="text-xs text-muted-foreground">{p.entityType}</span>
                {!p.corrente && (
                  <span className="text-[0.6875rem] text-amber-700 dark:text-amber-500 ml-auto">
                    placa encerrada
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CabecalhoDaPlaca({ consulta }: { consulta: ConsultaDaPlaca }) {
  return (
    <div className="bg-card border rounded-md px-6 py-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-2xl font-bold font-mono tracking-wider">
          {consulta.placa.placaLegivel}
        </span>
        <span className="text-sm text-muted-foreground">{consulta.rotuloDoTipo}</span>
        {!consulta.placa.corrente && (
          <span className="text-xs text-amber-700 dark:text-amber-500">
            placa encerrada — o veículo é este, a placa mudou
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>{consulta.periodLabel}</span>
        <span>{consulta.contextLabel}</span>
        {consulta.unidade && <span>{consulta.unidade}</span>}
        {consulta.chassi && <span className="font-mono">chassi {consulta.chassi}</span>}
      </div>
      {consulta.vinculo && (
        <Link
          href={`/remunerado?aba=frota&placa=${consulta.vinculo.placa}`}
          className="inline-flex items-center gap-1.5 mt-3 text-xs text-brand hover:underline"
        >
          <Link2 className="w-3.5 h-3.5" />
          Carreta do conjunto: {consulta.vinculo.placa}
        </Link>
      )}
    </div>
  );
}

/**
 * O cartão de um produto.
 *
 * A ordem de leitura é fixa e é a do gesto: **o que é** (rótulo e o que se
 * compra), **a ressalva** quando há uma, **o número** quando há um só que
 * responda, e por último **as linhas** que o sustentam. A ressalva antes do
 * número não é decoração — é o que impede o zero do pneu de ser lido como
 * preço.
 */
function CartaoDoProduto({ consultado }: { consultado: ProdutoConsultado }) {
  const [aberto, setAberto] = useState(false);
  const { produto, linhas, destaque } = consultado;
  const apuradas = linhas.filter((l) => l.apurado);

  return (
    <section className="bg-card border rounded-md overflow-hidden">
      <div className="px-6 py-4">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
              {produto.rotulo}
              <span className="text-[0.625rem] font-normal normal-case tracking-normal px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {ROTULO_DA_NATUREZA[produto.natureza]}
              </span>
            </h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">{produto.compra}</p>
          </div>

          {destaque !== null && (
            <div className="text-right shrink-0">
              <div className="text-3xl font-bold tabular-nums tracking-tight">
                {formatValue(destaque.valor, destaque.unit)}
                {destaque.gaveta && (
                  <span className="text-base font-normal text-muted-foreground">
                    {SUFIXO_DA_GAVETA[destaque.gaveta]}
                  </span>
                )}
              </div>
              <div className="text-[0.6875rem] text-muted-foreground mt-0.5">
                {destaque.titulo}
              </div>
            </div>
          )}
        </div>

        {produto.ressalva && <Ressalva ressalva={produto.ressalva} />}

        {linhas.length === 0 && (
          <p className="text-sm text-muted-foreground mt-3">
            A fonte não trouxe nenhuma coluna deste produto nesta vigência.
          </p>
        )}

        {linhas.length > 0 && destaque === null && apuradas.length > 1 && (
          <p className="text-xs text-muted-foreground mt-3">
            {apuradas.length} colunas respondem por este produto e medem coisas diferentes —
            não há uma soma delas que responda à pergunta. Abra abaixo para ver cada uma.
          </p>
        )}
      </div>

      {linhas.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setAberto(!aberto)}
            className="w-full flex items-center gap-2 px-6 py-2.5 text-left text-xs text-muted-foreground hover:bg-muted/30 border-t transition-colors"
          >
            {aberto ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            {linhas.length} {linhas.length === 1 ? "coluna" : "colunas"} da fonte
          </button>

          {aberto && (
            <div className="divide-y border-t bg-muted/20">
              {linhas.map((linha) => (
                <LinhaDaFonte key={linha.code} linha={linha} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Ressalva({ ressalva }: { ressalva: NonNullable<ProdutoDeCompra["ressalva"]> }) {
  return (
    <div className="mt-3 flex gap-2.5 rounded-md border border-l-[4px] border-l-amber-500 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3">
      <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-500" />
      <div className="min-w-0">
        <div className="text-xs font-bold text-amber-800 dark:text-amber-400">
          {ROTULO_DA_RESSALVA[ressalva.motivo]}
        </div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{ressalva.texto}</p>
      </div>
    </div>
  );
}

function LinhaDaFonte({ linha }: { linha: LinhaDoProduto }) {
  return (
    <div className="px-6 py-3">
      <div className="flex items-baseline gap-4">
        <span className="flex-1 min-w-0">
          <span className="text-sm font-medium">{linha.titulo}</span>
          <span className="block font-mono text-[0.6875rem] text-muted-foreground">
            {linha.sourceName}
          </span>
        </span>
        <span className="text-base font-semibold tabular-nums shrink-0">
          {linha.exibicao ?? formatValue(linha.valor, linha.unit)}
          {linha.apurado && linha.gaveta && (
            <span className="text-xs font-normal text-muted-foreground">
              {SUFIXO_DA_GAVETA[linha.gaveta]}
            </span>
          )}
        </span>
      </div>
      {linha.motivo && (
        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed max-w-3xl">
          {linha.motivo}
        </p>
      )}
    </div>
  );
}

/**
 * As rubricas que apareceram no veículo e não pertencem a produto nenhum.
 *
 * Aparecem contadas, e não escondidas: sem esta linha, uma rubrica que o
 * catálogo não reclamasse sumiria da tela sem deixar rastro, e a lista de
 * produtos pareceria o todo.
 */
function ForaDoCatalogo({ consulta }: { consulta: ConsultaDaPlaca }) {
  const [aberto, setAberto] = useState(false);
  if (consulta.foraDoCatalogo.length === 0) return null;
  const colunas = consulta.foraDoCatalogo.reduce((n, r) => n + r.colunas, 0);

  return (
    <section className="bg-card border rounded-md">
      <button
        type="button"
        onClick={() => setAberto(!aberto)}
        className="w-full flex items-center gap-2 px-6 py-3 text-left text-xs text-muted-foreground hover:bg-muted/30 transition-colors"
      >
        {aberto ? (
          <ChevronDown className="w-3.5 h-3.5" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5" />
        )}
        <Info className="w-3.5 h-3.5" />
        {colunas} colunas deste veículo descrevem o ativo e não correspondem a nada que se
        compre
      </button>
      {aberto && (
        <ul className="border-t divide-y">
          {consulta.foraDoCatalogo.map((r) => (
            <li key={r.rubrica} className="flex items-baseline gap-4 px-6 py-2 text-sm">
              <span className="flex-1">{r.rubrica}</span>
              <span className="text-xs text-muted-foreground">{r.familia}</span>
              <span className="tabular-nums text-muted-foreground w-8 text-right">
                {r.colunas}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Balcão do QLP
// ---------------------------------------------------------------------------

function BalcaoDoQlp({ contexto }: { contexto: string }) {
  const consulta = useQuery({
    queryKey: ["compras", "qlp", contexto],
    queryFn: () => fetchJson<ConsultaDoQlp>(`/compras/remunerado/qlp?${contexto}`),
  });

  if (consulta.isError)
    return <ApiErrorNotice error={consulta.error} what="o remunerado da estrutura" />;
  if (!consulta.data) return null;
  const c = consulta.data;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="bg-card border rounded-md px-6 py-4">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>{c.periodLabel}</span>
          <span>{c.contextLabel}</span>
        </div>
        {c.registrosFaltando > 0 && (
          <p className="mt-3 flex items-start gap-2 text-xs text-brand-red">
            <CircleAlert className="w-4 h-4 shrink-0 mt-0.5" />
            {c.registrosFaltando}{" "}
            {c.registrosFaltando === 1 ? "registro ficou" : "registros ficaram"} em quarentena
            nesta vigência. Este quadro está incompleto — ver Inconsistências em QLP
            Administrativo.
          </p>
        )}
      </div>

      <div className="space-y-4">
        {c.produtos.map((p) => (
          <CartaoDoQlp key={p.produto.chave} produto={p} />
        ))}
      </div>

      <section className="bg-card border border-dashed rounded-md px-6 py-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          QLP operacional
        </h2>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed max-w-3xl">
          {c.operacional.falta}
        </p>
        <p className="text-xs text-muted-foreground mt-3">
          {c.operacional.hoje}{" "}
          <Link href="/book-operador" className="text-brand hover:underline">
            Abrir o Book do Operador
          </Link>
        </p>
      </section>
    </div>
  );
}

function CartaoDoQlp({ produto }: { produto: ProdutoDoQlp }) {
  return (
    <section className="bg-card border rounded-md overflow-hidden">
      <div className="px-6 py-4">
        <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          {produto.produto.rotulo}
          <span className="text-[0.625rem] font-normal normal-case tracking-normal px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {ROTULO_DA_NATUREZA[produto.produto.natureza]}
          </span>
        </h2>
        <p className="text-xs text-muted-foreground mt-1 max-w-xl">{produto.produto.compra}</p>
        {produto.produto.ressalva && <Ressalva ressalva={produto.produto.ressalva} />}
      </div>

      {produto.semColuna ? (
        <p className="px-6 pb-5 text-sm text-muted-foreground">
          A fonte não trouxe nenhuma coluna deste produto nesta vigência.
        </p>
      ) : produto.linhas.length === 0 ? (
        <p className="px-6 pb-5 text-sm text-muted-foreground">
          Nenhum cargo tem valor deste produto nesta vigência.
        </p>
      ) : (
        <div className="overflow-x-auto border-t">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 text-[0.625rem] uppercase tracking-wider text-muted-foreground">
                <th className="text-left font-bold px-6 py-2">Cargo</th>
                {produto.colunas.map((coluna) => (
                  <th key={coluna.code} className="text-right font-bold px-4 py-2">
                    {ROTULO_DO_PAPEL[coluna.papel]}
                  </th>
                ))}
                <th className="text-right font-bold px-6 py-2">Confere</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {produto.linhas.map((linha) => (
                <tr key={linha.entityId}>
                  <td className="px-6 py-2.5">
                    <span className="font-medium">{linha.cargo}</span>
                    <span className="block text-[0.6875rem] text-muted-foreground">
                      {linha.unidadeNome ?? linha.unidadeCnpjLegivel}
                    </span>
                  </td>
                  {produto.colunas.map((coluna) => {
                    const celula = linha.celulas.find((c) => c.code === coluna.code);
                    return (
                      <td
                        key={coluna.code}
                        className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap"
                      >
                        {formatarValor(celula?.valor ?? null, celula)}
                      </td>
                    );
                  })}
                  <td className="px-6 py-2.5 text-right whitespace-nowrap">
                    <Conferencia linha={linha} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * A conferência da fonte contra ela mesma: `despesa ≟ unitário × quantidade`.
 *
 * Quando não fecha, **o número da tabela continua sendo o da fonte** — é ele
 * que a Ambev paga. Esta coluna informa; ela não corrige. Um travessão quer
 * dizer que falta um dos três fatores, e não é alarme: vale-transporte não tem
 * quantidade por desenho da fonte.
 */
function Conferencia({ linha }: { linha: ProdutoDoQlp["linhas"][number] }) {
  if (linha.conferencia === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (linha.conferencia.fecha) {
    return <span className="text-xs text-muted-foreground">fecha</span>;
  }
  return (
    <span
      className="text-xs text-brand-red"
      title={`Esperado ${formatNumber(linha.conferencia.esperado)} pelo unitário × quantidade; a fonte declara ${formatNumber(linha.conferencia.declarado)}.`}
    >
      não fecha ({linha.conferencia.diferenca > 0 ? "+" : "−"}
      {formatNumber(Math.abs(linha.conferencia.diferenca))})
    </span>
  );
}
