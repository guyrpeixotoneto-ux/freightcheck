import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, ChevronRight, Info } from "lucide-react";
import { getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatBrl, formatBrlShort, formatPercent, periodicitySuffix } from "@/lib/format";
import {
  fatosDoIntervalo,
  porPeriodicidade,
  type EndToEndEntry,
  type Fato,
  type Movimentos,
  type PontaAPonta,
  type RangeEntry,
} from "@/lib/analise";
import { GroupCard } from "@/components/inicio/group-card";
import { TabelaFreightech, type ColunaTabela } from "@/components/parametros/tabela";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ChangeGroup } from "@/components/inicio/types";

/**
 * A aba Análise — a metade do cartão que o Freightech não tem.
 *
 * A primeira aba é o espelho: a tela de lá, respondendo "como está hoje". Esta
 * responde o que lá exige exportar duas planilhas e comparar à mão: **entre
 * estas duas vigências, o que a Ambev mexeu, quanto custou, onde, quando, e o
 * que merece ser questionado.**
 *
 * **O escopo é o do cartão, e nunca escapa dele.** CAVALO analisa CAVALO;
 * IPVA analisa IPVA. Quando o cartão não tem impacto apurado no intervalo, a
 * tela diz exatamente isso — *10 alterações, 0 com impacto calculado, e o
 * motivo* — em vez de buscar número em outro cartão para não parecer vazia. Um
 * cartão vazio é informação de auditoria; um cartão preenchido com dado alheio
 * é um erro que ninguém pega olhando.
 *
 * **Duas leituras, e nenhuma deriva da outra.** MOVIMENTOS soma as transições
 * do caminho; PONTA A PONTA compara o estado das duas vigências. Um valor que
 * foi de 10 a 20 e voltou a 10 aparece na primeira como duas alterações e na
 * segunda como nada. A subtração entre elas é o que permite dizer, sem chutar,
 * **o que foi revertido**.
 *
 * A ordem da tela é a ordem da pergunta: o que aconteceu → quanto vale → o que
 * merece atenção → quando aconteceu → onde estão os maiores → o que não dá para
 * valorar → a evidência.
 *
 * As recusas de sempre, inteiras:
 *
 * 1. **Nunca somar periodicidades.** R$/mês e R$/ano têm blocos, rankings e
 *    escalas de barra próprios, sempre.
 * 2. **Prejuízo e ganho nunca viram um líquido.** Meio milhão saindo e meio
 *    milhão entrando não é "vinte mil de prejuízo".
 * 3. **"Não calculável" nunca vira zero**, e nesta base é a maioria — por isso
 *    tem bloco de alerta, e não nota de rodapé.
 * 4. **Vigência sem comparação é nomeada**, nunca contada como zero.
 * 5. **Entrada e saída de frota ficam fora do dinheiro.** Frota maior não é
 *    preço maior.
 */

export function AnaliseCartao({
  nomeDoCartao,
  parametros,
  contexto,
  periodo,
}: {
  nomeDoCartao: string;
  /** Os nossos parâmetros por trás deste cartão. Vazio = sem dado no export. */
  parametros: { key: string; name: string }[];
  /** Unidade e canal. A vigência não entra: quem escolhe o intervalo é esta aba. */
  contexto: URLSearchParams;
  /** A vigência aberta na outra aba — a ponta final do intervalo. */
  periodo: string | null;
}) {
  const [de, setDe] = useState<string | null>(null);
  const [ate, setAte] = useState<string | null>(null);
  const [leitura, setLeitura] = useState<"movimentos" | "ponta">("movimentos");
  const [aberto, setAberto] = useState<string | null>(null);

  /*
    A ponta final segue a vigência de cima **até** alguém escolher outra.

    O FILTRAR preserva o cartão aberto, então a vigência do topo pode mudar com
    esta aba montada. Guardar `periodo` no estado inicial congelaria a escolha
    do primeiro render: quem trocasse de agosto para julho lá em cima
    continuaria vendo agosto aqui, e os dois seletores diriam coisas
    diferentes sobre a mesma tela. Guardar só a escolha explícita resolve os
    dois casos — sem escolha, acompanha; com escolha, fica.
  */
  const ateEfetivo = ate ?? periodo;

  const base = new URLSearchParams(contexto);
  base.delete("period");
  if (de) base.set("from", de);
  if (ateEfetivo) base.set("to", ateEfetivo);

  /*
    O recorte do cartão vai nas duas consultas, e não num filtro da tela.

    Não é economia de tráfego: a tela sabe quantos veículos cada grupo tocou,
    mas não *quais*, e somar os grupos daria 182 numa frota de 144 — o mesmo
    caminhão conta em cada parâmetro que mudou. O conjunto de ativos distintos
    só existe no servidor.
  */
  const recorte = new URLSearchParams(base);
  if (parametros.length > 0) {
    recorte.set("parameters", parametros.map((p) => p.key).join(","));
  }

  const movimentos = useQuery({
    queryKey: ["intervalo", recorte.toString()],
    queryFn: async () => buscar<Movimentos>(`/changes/range?${recorte}`),
  });

  /*
    As duas leituras carregam juntas, e não só a que está à mostra.

    Não é desperdício: "o que foi revertido" é a subtração de uma pela outra, e
    o resumo executivo mostra quantos parâmetros continuam alterados hoje. Uma
    aba que só busca o que exibe teria de esconder as duas coisas ou inventá-las.
    O recorte do cartão vai na query para a resposta não trazer a remuneração
    inteira de volta.
  */
  const ponta = useQuery({
    queryKey: ["ponta-a-ponta", recorte.toString()],
    queryFn: async () => buscar<PontaAPonta>(`/changes/end-to-end?${recorte}`),
    enabled: parametros.length > 0,
  });

  if (movimentos.isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }
  if (movimentos.error) {
    return (
      <div className="bg-card border border-l-[6px] border-l-brand-red px-6 py-4 text-sm">
        {(movimentos.error as Error).message}
      </div>
    );
  }
  const mov = movimentos.data;
  if (!mov) {
    return (
      <div className="bg-card border border-l-[6px] border-l-brand px-6 py-4 text-sm">
        Nenhuma vigência importada neste contexto — não há intervalo para ler.
      </div>
    );
  }

  const doCartao = mov.entries;
  const p2p = ponta.data ?? null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <Intervalo
          periodos={mov.periods}
          de={mov.from}
          ate={mov.to}
          onDe={setDe}
          onAte={setAte}
        />
        <Leitura leitura={leitura} onLeitura={setLeitura} />
      </div>

      <ExplicacaoDaLeitura
        leitura={leitura}
        mov={mov}
        p2p={p2p}
        carregandoPonta={ponta.isLoading}
      />

      {mov.from === mov.to ? (
        /*
          As duas pontas iguais não são um intervalo. Antes isto tinha resposta
          — a vigência sozinha — porque a ponta inicial entrava na soma; agora
          que ela é só o ponto de partida, "de agosto até agosto" é um trecho
          de comprimento zero. Dizer isso é melhor do que devolver tudo zerado
          e deixar quem lê concluir que não houve alteração nenhuma.
        */
        <div className="bg-card border border-l-[6px] border-l-brand px-6 py-4 text-sm">
          As duas pontas são a mesma vigência. Não há intervalo entre{" "}
          {mov.fromLabel} e ela mesma — escolha uma vigência inicial anterior.
        </div>
      ) : parametros.length === 0 ? (
        <div className="bg-card border border-l-[6px] border-l-brand px-6 py-4 text-sm">
          Este cartão não tem parâmetro nenhum alimentado pelo export, e por isso não
          há alteração para analisar. A aba Freightech continua mostrando o que a
          planilha traz.
        </div>
      ) : leitura === "movimentos" ? (
        <LeituraMovimentos
          mov={mov}
          p2p={p2p}
          doCartao={doCartao}
          nome={nomeDoCartao}
          aberto={aberto}
          onAbrir={setAberto}
        />
      ) : (
        <LeituraPonta
          p2p={p2p}
          carregando={ponta.isLoading}
          erro={ponta.error as Error | null}
          nome={nomeDoCartao}
          aberto={aberto}
          onAbrir={setAberto}
        />
      )}
    </div>
  );
}

async function buscar<T>(caminho: string): Promise<T | null> {
  const resposta = await fetch(getApiUrl(caminho));
  if (resposta.status === 404) return null;
  if (!resposta.ok) throw new Error((await resposta.json()).error ?? "Falha ao carregar");
  return (await resposta.json()) as T;
}

/* ------------------------------------------------------------------ */
/* Barra: o intervalo e a leitura                                      */
/* ------------------------------------------------------------------ */

function Intervalo({
  periodos,
  de,
  ate,
  onDe,
  onAte,
}: {
  periodos: { date: string; label: string }[];
  de: string;
  ate: string;
  onDe: (v: string) => void;
  onAte: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Campo rotulo="De">
        <Seletor valor={de} periodos={periodos} onChange={onDe} />
      </Campo>
      <ArrowRight className="w-4 h-4 text-muted-foreground mb-3.5 shrink-0" />
      <Campo rotulo="Até">
        <Seletor valor={ate} periodos={periodos} onChange={onAte} />
      </Campo>
    </div>
  );
}

function Seletor({
  valor,
  periodos,
  onChange,
}: {
  valor: string;
  periodos: { date: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Select value={valor} onValueChange={onChange}>
      <SelectTrigger className="w-48 h-11 rounded-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {periodos.map((p) => (
          <SelectItem key={p.date} value={p.date}>
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm text-muted-foreground mb-1">{rotulo}</div>
      {children}
    </div>
  );
}

/** As duas leituras. Pílulas, e não abas: as abas de cima já são outra coisa. */
function Leitura({
  leitura,
  onLeitura,
}: {
  leitura: "movimentos" | "ponta";
  onLeitura: (v: "movimentos" | "ponta") => void;
}) {
  return (
    <div className="inline-flex border">
      {(
        [
          ["movimentos", "Movimentos do período"],
          ["ponta", "Ponta a ponta"],
        ] as const
      ).map(([valor, rotulo]) => (
        <button
          key={valor}
          type="button"
          aria-pressed={leitura === valor}
          onClick={() => onLeitura(valor)}
          className={cn(
            "px-4 h-11 text-[0.8125rem] font-bold uppercase tracking-wide transition-colors",
            leitura === valor
              ? "bg-brand text-brand-foreground"
              : "bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          {rotulo}
        </button>
      ))}
    </div>
  );
}

/**
 * A diferença entre as duas leituras, em duas linhas.
 *
 * Precisa estar na tela e não num tooltip: quem lê "−R$ 43 mil" sem saber qual
 * das duas perguntas foi respondida vai levar o número para uma reunião e
 * defender a resposta errada.
 */
function ExplicacaoDaLeitura({
  leitura,
  mov,
  p2p,
  carregandoPonta,
}: {
  leitura: "movimentos" | "ponta";
  mov: Movimentos;
  p2p: PontaAPonta | null;
  carregandoPonta: boolean;
}) {
  return (
    <p className="text-xs text-muted-foreground flex gap-2 max-w-3xl -mt-4">
      <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      {leitura === "movimentos" ? (
        <span>
          <strong className="text-foreground">O que a Ambev foi mexendo no caminho.</strong>{" "}
          Cada vigência já é uma comparação com a anterior; o intervalo soma as{" "}
          {mov.totals.comparisons}{" "}
          {mov.totals.comparisons === 1 ? "comparação" : "comparações"} que saem de{" "}
          {mov.fromLabel} e chegam em {mov.toLabel}. Um valor que subiu e voltou
          conta duas vezes aqui — e some na outra leitura.
        </span>
      ) : (
        <span>
          <strong className="text-foreground">Como {mov.toLabel} está diferente de {mov.fromLabel}.</strong>{" "}
          Comparação ativo a ativo, sobre quem está nas duas pontas
          {p2p ? ` (${p2p.entitiesCompared} ativos)` : carregandoPonta ? "" : ""}. O que
          mexeu e voltou não aparece; entrada e saída de frota ficam fora do dinheiro.
        </span>
      )}
    </p>
  );
}

function Lacunas({ gaps }: { gaps: { label: string; reason: string }[] }) {
  return (
    <div className="bg-card border border-l-[6px] border-l-brand-red px-6 py-4 text-sm">
      <p className="font-medium flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-brand-red shrink-0" />
        {gaps.length}{" "}
        {gaps.length === 1
          ? "vigência do intervalo ficou de fora"
          : "vigências do intervalo ficaram de fora"}
      </p>
      <p className="text-muted-foreground mt-1">
        {gaps.map((g) => g.label).join(", ")} — {gaps[0].reason}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Leitura 1 — movimentos do período                                   */
/* ------------------------------------------------------------------ */

function LeituraMovimentos({
  mov,
  p2p,
  doCartao,
  nome,
  aberto,
  onAbrir,
}: {
  mov: Movimentos;
  p2p: PontaAPonta | null;
  doCartao: RangeEntry[];
  nome: string;
  aberto: string | null;
  onAbrir: (chave: string | null) => void;
}) {
  const comPreco = doCartao.filter(
    (e) => e.confidence === "CALCULATED" && e.amount !== null && e.amount !== 0,
  );
  const semPreco = doCartao.filter((e) => e.confidence !== "CALCULATED" || e.amount === null);

  const fatos = useMemo(
    () =>
      fatosDoIntervalo(mov, p2p, {
        dinheiro: (valor, periodicidade) =>
          `${formatBrlShort(valor)}${periodicitySuffix(periodicidade)}`,
        percentual: (valor) => formatPercent(valor),
      }),
    [mov, p2p],
  );

  const parametrosAlterados = new Set(doCartao.map((e) => e.attributeCode ?? e.title)).size;

  return (
    <div className="space-y-8">
      {/*
        A lacuna é desta leitura e não da outra: aqui dezembro/2025 é uma
        vigência cujo movimento não existe e ficou fora da soma. Na leitura
        ponta a ponta ela é a ponta inicial — está sendo usada, e repetir o
        aviso ali diria que o dado de partida está faltando quando ele é
        justamente o que sustenta a comparação.
      */}
      {mov.gaps.length > 0 && <Lacunas gaps={mov.gaps} />}

      <Resumo
        titulo={`${mov.fromLabel} → ${mov.toLabel}`}
        perdas={somar(comPreco, (v) => v < 0)}
        ganhos={somar(comPreco, (v) => v > 0)}
        parametros={parametrosAlterados}
        veiculos={mov.totals.vehiclesTouched}
        alteracoes={doCartao.length}
        comImpacto={comPreco.length}
        semImpacto={semPreco.length}
        motivo={motivoMaisComum(semPreco)}
        nome={nome}
      />

      {fatos.length > 0 && <Atencao fatos={fatos} onAbrir={onAbrir} />}

      <QuandoAconteceu movimentos={mov.movements} doCartao={doCartao} />

      {comPreco.length > 0 && (
        <Rankings entradas={comPreco} aoAbrir={onAbrir} />
      )}

      {semPreco.length > 0 && (
        <PrecisamDeAnalise entradas={semPreco} aoAbrir={onAbrir} />
      )}

      {aberto && (
        <Detalhe
          entrada={doCartao.find((e) => e.key === aberto) ?? null}
          onFechar={() => onAbrir(null)}
        />
      )}
    </div>
  );
}

function somar(entradas: RangeEntry[] | EndToEndEntry[], filtro: (v: number) => boolean) {
  const baldes: Record<string, number> = {};
  for (const entrada of entradas as RangeEntry[]) {
    const valor = entrada.amount ?? 0;
    if (!filtro(valor)) continue;
    const balde = entrada.periodicity ?? "SEM_PERIODICIDADE";
    baldes[balde] = (baldes[balde] ?? 0) + valor;
  }
  return baldes;
}

function motivoMaisComum(entradas: { reason: string | null }[]): string | null {
  const contagem = new Map<string, number>();
  for (const entrada of entradas) {
    if (!entrada.reason) continue;
    contagem.set(entrada.reason, (contagem.get(entrada.reason) ?? 0) + 1);
  }
  return [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Resumo executivo                                                    */
/* ------------------------------------------------------------------ */

/**
 * A primeira área: quanto perdi, quanto ganhei, onde e o que falta valorar.
 *
 * O líquido não está aqui e não vai estar. E quando não há nada valorado, esta
 * área não fica vazia nem some: ela passa a dizer o que **de fato** aconteceu —
 * "10 alterações, 0 com impacto calculado" — e por quê. Numa auditoria, saber
 * que a Ambev mexeu em dez pontos que ninguém consegue precificar é tão
 * acionável quanto um número.
 */
function Resumo({
  titulo,
  perdas,
  ganhos,
  parametros,
  veiculos,
  alteracoes,
  comImpacto,
  semImpacto,
  motivo,
  nome,
}: {
  titulo: string;
  perdas: Record<string, number>;
  ganhos: Record<string, number>;
  parametros: number;
  veiculos: number;
  alteracoes: number;
  comImpacto: number;
  semImpacto: number;
  motivo: string | null;
  nome: string;
}) {
  const nadaValorado = comImpacto === 0;

  return (
    <section className="space-y-3">
      <Cabecalho titulo="Resumo" complemento={titulo} />

      {nadaValorado ? (
        <div className="bg-card border border-l-[6px] border-l-brand px-6 py-5">
          <p className="text-2xl font-bold">
            {alteracoes} {alteracoes === 1 ? "alteração identificada" : "alterações identificadas"} neste cartão
          </p>
          <p className="text-2xl font-bold text-muted-foreground">
            0 com impacto financeiro calculado
          </p>
          {motivo && (
            <p className="text-sm text-muted-foreground mt-3 max-w-3xl">
              <strong className="text-foreground">Por quê:</strong> {motivo}
            </p>
          )}
          <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
            A Ambev mexeu em {nome} e o valor disso ainda não é apurável com este
            export — o que é diferente de não ter havido impacto. As alterações
            estão listadas abaixo, com veículo, valor anterior e valor novo.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Bloco titulo="Prejuízos identificados" tom="perda">
            <Valores buckets={perdas} tom="perda" />
          </Bloco>
          <Bloco titulo="Ganhos identificados" tom="ganho">
            <Valores buckets={ganhos} tom="ganho" />
          </Bloco>
          <Bloco titulo="Parâmetros alterados">
            <div className="text-2xl font-bold">{parametros}</div>
            <p className="text-xs text-muted-foreground mt-1">em {nome}</p>
          </Bloco>
          <Bloco titulo="Veículos afetados">
            <div className="text-2xl font-bold">{veiculos}</div>
            <p className="text-xs text-muted-foreground mt-1">
              ativos distintos — o mesmo caminhão não conta duas vezes
            </p>
          </Bloco>
        </div>
      )}

      {semImpacto > 0 && !nadaValorado && (
        <p className="text-sm flex items-start gap-2 text-brand-red">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <strong>{semImpacto}</strong>{" "}
            {semImpacto === 1 ? "alteração precisa" : "alterações precisam"} de análise —
            o impacto financeiro ainda não é calculável. Não é zero.
          </span>
        </p>
      )}
    </section>
  );
}

function Valores({
  buckets,
  tom,
}: {
  buckets: Record<string, number>;
  tom: "perda" | "ganho";
}) {
  const linhas = porPeriodicidade(buckets);
  if (linhas.length === 0) {
    return <div className="text-2xl font-bold text-muted-foreground">—</div>;
  }
  return (
    <div className="space-y-0.5">
      {linhas.map(({ periodicity, amount }) => (
        <div
          key={periodicity}
          className={cn(
            "text-2xl font-bold leading-tight",
            tom === "perda" ? "text-brand-red" : "text-success",
          )}
        >
          {formatBrlShort(amount)}
          <span className="text-sm font-normal">{periodicitySuffix(periodicity)}</span>
        </div>
      ))}
    </div>
  );
}

function Bloco({
  titulo,
  tom,
  children,
}: {
  titulo: string;
  tom?: "perda" | "ganho";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "bg-card border border-l-[5px] px-5 py-4",
        tom === "perda" && "border-l-brand-red",
        tom === "ganho" && "border-l-success",
        tom === undefined && "border-l-brand",
      )}
    >
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{titulo}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Cabecalho({ titulo, complemento }: { titulo: string; complemento?: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <h3 className="text-[0.8125rem] font-bold uppercase tracking-wide">{titulo}</h3>
      {complemento && (
        <span className="text-xs text-muted-foreground">{complemento}</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* O que merece sua atenção                                            */
/* ------------------------------------------------------------------ */

const ROTULO_DO_FATO: Record<Fato["tipo"], string> = {
  prejuizo: "Maior prejuízo",
  ganho: "Maior ganho",
  concentracao: "Concentrado numa vigência",
  recorrencia: "Repete vigência após vigência",
  reversao: "Mexeu e voltou",
  "sem-valor": "Sem valoração",
  variacao: "Variação relevante",
};

function Atencao({
  fatos,
  onAbrir,
}: {
  fatos: Fato[];
  onAbrir: (chave: string | null) => void;
}) {
  return (
    <section className="space-y-3">
      <Cabecalho titulo="O que merece sua atenção" complemento="por regra fixa, sobre o dado do intervalo" />
      <div className="grid sm:grid-cols-2 gap-4">
        {fatos.map((fato) => {
          const clicavel = fato.entrada !== null;
          const Elemento = clicavel ? "button" : "div";
          return (
            <Elemento
              key={`${fato.tipo}-${fato.attributeCode ?? fato.titulo}`}
              {...(clicavel
                ? { type: "button" as const, onClick: () => onAbrir(fato.entrada) }
                : {})}
              className={cn(
                "bg-card border border-l-[5px] px-5 py-4 text-left w-full",
                fato.tipo === "prejuizo" && "border-l-brand-red",
                fato.tipo === "ganho" && "border-l-success",
                !["prejuizo", "ganho"].includes(fato.tipo) && "border-l-brand",
                clicavel && "hover:bg-accent transition-colors",
              )}
            >
              <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                {ROTULO_DO_FATO[fato.tipo]}
              </div>
              <div className="flex items-baseline justify-between gap-3 mt-1">
                <span className="font-medium">{fato.titulo}</span>
                {fato.valor && (
                  <span
                    className={cn(
                      "font-bold tabular-nums shrink-0",
                      fato.tipo === "ganho" ? "text-success" : "text-brand-red",
                    )}
                  >
                    {fato.valor}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{fato.detalhe}</p>
              {clicavel && (
                <span className="text-xs text-brand font-bold uppercase tracking-wide inline-flex items-center gap-1 mt-2">
                  Investigar <ChevronRight className="w-3 h-3" />
                </span>
              )}
            </Elemento>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Quando aconteceu                                                    */
/* ------------------------------------------------------------------ */

/**
 * A linha do tempo do intervalo, em barras divergentes.
 *
 * É o único desenho da aba, e existe por uma diferença que texto não entrega:
 * "caiu tudo em junho" e "vem caindo desde março" são as mesmas oito linhas de
 * tabela e duas conversas diferentes com o cliente.
 *
 * Uma escala por periodicidade, nunca uma só. Uma barra de R$/ano ao lado de
 * uma de R$/mês, no mesmo eixo, faria a segunda parecer irrelevante quando ela
 * pode ser doze vezes maior no ano.
 */
function QuandoAconteceu({
  movimentos,
  doCartao,
}: {
  movimentos: { period: string; label: string; comparisons: number }[];
  doCartao: RangeEntry[];
}) {
  const porVigencia = movimentos.map((movimento) => {
    const linhas = doCartao.filter((e) => e.period === movimento.period);
    const baldes: Record<string, number> = {};
    for (const linha of linhas) {
      if (linha.confidence !== "CALCULATED" || linha.amount === null) continue;
      const balde = linha.periodicity ?? "SEM_PERIODICIDADE";
      baldes[balde] = (baldes[balde] ?? 0) + linha.amount;
    }
    return {
      period: movimento.period,
      label: movimento.label,
      grupos: linhas.length,
      semPreco: linhas.filter((e) => e.confidence !== "CALCULATED").length,
      baldes,
    };
  });

  const periodicidades = [
    ...new Set(porVigencia.flatMap((v) => Object.keys(v.baldes))),
  ].sort();

  return (
    <section className="space-y-3">
      <Cabecalho titulo="Quando aconteceu" complemento="mais antiga em cima" />

      {periodicidades.length === 0 ? (
        /*
          Sem dinheiro apurado, a pergunta "quando aconteceu" continua de pé — e
          é a única que ainda tem resposta. As barras passam a contar
          alterações, em cinza, com o rótulo dizendo que a escala mudou. A
          alternativa seria um bloco vazio dizendo "nada a mostrar" numa
          vigência em que a Ambev mexeu em setenta lugares.
        */
        <ContagemPorVigencia linhas={[...porVigencia].reverse()} />
      ) : (
        periodicidades.map((periodicidade) => {
          const linhas = [...porVigencia].reverse();
          const teto = Math.max(
            ...linhas.map((v) => Math.abs(v.baldes[periodicidade] ?? 0)),
            1,
          );
          const maior = linhas.reduce((a, b) =>
            Math.abs(b.baldes[periodicidade] ?? 0) > Math.abs(a.baldes[periodicidade] ?? 0)
              ? b
              : a,
          );
          return (
            <div key={periodicidade} className="bg-card border px-5 py-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                Impacto em R${periodicitySuffix(periodicidade)}
              </div>
              <div className="space-y-1.5">
                {linhas.map((vigencia) => {
                  const valor = vigencia.baldes[periodicidade];
                  const largura = valor === undefined ? 0 : (Math.abs(valor) / teto) * 100;
                  const destaque =
                    vigencia.period === maior.period && Math.abs(maior.baldes[periodicidade] ?? 0) > 0;
                  return (
                    <div
                      key={vigencia.period}
                      className="grid grid-cols-[7rem_1fr_10rem] items-center gap-3 text-sm"
                    >
                      <span
                        className={cn(
                          "truncate",
                          destaque ? "font-bold" : "text-muted-foreground",
                        )}
                      >
                        {vigencia.label}
                      </span>

                      {/* O zero fica no meio; perda cresce para a esquerda. */}
                      <div className="flex items-center h-4 relative">
                        <span className="absolute left-1/2 top-0 bottom-0 w-px bg-border" />
                        <div className="w-1/2 flex justify-end">
                          {valor !== undefined && valor < 0 && (
                            <span
                              className="h-2.5 bg-brand-red"
                              style={{ width: `${largura}%` }}
                            />
                          )}
                        </div>
                        <div className="w-1/2">
                          {valor !== undefined && valor > 0 && (
                            <span
                              className="h-2.5 bg-success block"
                              style={{ width: `${largura}%` }}
                            />
                          )}
                        </div>
                      </div>

                      <span className="text-right tabular-nums text-xs">
                        {valor === undefined ? (
                          <span
                            className="text-muted-foreground italic"
                            title={
                              vigencia.grupos === 0
                                ? "Nenhuma alteração deste cartão nesta vigência."
                                : `${vigencia.semPreco} ${vigencia.semPreco === 1 ? "alteração" : "alterações"} sem impacto calculável.`
                            }
                          >
                            {vigencia.grupos === 0 ? "sem alteração" : "sem valoração"}
                          </span>
                        ) : (
                          <span className={valor < 0 ? "text-brand-red" : "text-success"}>
                            {formatBrlShort(valor)}
                            {destaque && (
                              <span className="text-muted-foreground font-normal">
                                {" "}
                                ← maior
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}

/** Quando não há dinheiro apurado: a mesma linha do tempo, contando alterações. */
function ContagemPorVigencia({
  linhas,
}: {
  linhas: { period: string; label: string; grupos: number; semPreco: number }[];
}) {
  const teto = Math.max(...linhas.map((l) => l.grupos), 1);
  const maior = linhas.reduce((a, b) => (b.grupos > a.grupos ? b : a));
  return (
    <div className="bg-card border px-5 py-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
        Alterações por vigência — nenhuma com impacto apurado
      </div>
      <div className="space-y-1.5">
        {linhas.map((linha) => {
          const destaque = linha.period === maior.period && maior.grupos > 0;
          return (
            <div
              key={linha.period}
              className="grid grid-cols-[7rem_1fr_10rem] items-center gap-3 text-sm"
            >
              <span className={cn("truncate", destaque ? "font-bold" : "text-muted-foreground")}>
                {linha.label}
              </span>
              <div className="h-4 flex items-center">
                {linha.grupos > 0 && (
                  <span
                    className="h-2.5 bg-muted-foreground/40"
                    style={{ width: `${(linha.grupos / teto) * 100}%` }}
                  />
                )}
              </div>
              <span className="text-right tabular-nums text-xs text-muted-foreground">
                {linha.grupos === 0 ? (
                  <span className="italic">sem alteração</span>
                ) : (
                  <>
                    {linha.grupos} {linha.grupos === 1 ? "grupo" : "grupos"}
                    {destaque && <span> ← maior</span>}
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rankings                                                            */
/* ------------------------------------------------------------------ */

function Rankings({
  entradas,
  aoAbrir,
}: {
  entradas: (RangeEntry | EndToEndEntry)[];
  aoAbrir: (chave: string) => void;
}) {
  const periodicidades = [
    ...new Set(entradas.map((e) => e.periodicity ?? "SEM_PERIODICIDADE")),
  ].sort();

  return (
    <section className="space-y-3">
      <Cabecalho titulo="Onde estão os maiores impactos" />
      {periodicidades.map((periodicidade) => {
        const doBalde = entradas.filter(
          (e) => (e.periodicity ?? "SEM_PERIODICIDADE") === periodicidade,
        );
        return (
          <div key={periodicidade} className="grid lg:grid-cols-2 gap-4">
            <Ranking
              titulo="Maiores prejuízos"
              periodicidade={periodicidade}
              tom="perda"
              entradas={doBalde.filter((e) => (e.amount ?? 0) < 0)}
              aoAbrir={aoAbrir}
            />
            <Ranking
              titulo="Maiores ganhos"
              periodicidade={periodicidade}
              tom="ganho"
              entradas={doBalde.filter((e) => (e.amount ?? 0) > 0)}
              aoAbrir={aoAbrir}
            />
          </div>
        );
      })}
    </section>
  );
}

function Ranking({
  titulo,
  periodicidade,
  tom,
  entradas,
  aoAbrir,
}: {
  titulo: string;
  periodicidade: string;
  tom: "perda" | "ganho";
  entradas: (RangeEntry | EndToEndEntry)[];
  aoAbrir: (chave: string) => void;
}) {
  const [tudo, setTudo] = useState(false);
  const ordenadas = [...entradas].sort(
    (a, b) => Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0),
  );
  const teto = Math.abs(ordenadas[0]?.amount ?? 0);
  const TOPO = 6;
  const visiveis = tudo ? ordenadas : ordenadas.slice(0, TOPO);
  const sufixo = periodicitySuffix(periodicidade);

  return (
    <div className="bg-card border">
      <div className="px-5 py-3 border-b flex items-baseline justify-between gap-3">
        <h4 className="text-[0.8125rem] font-bold uppercase tracking-wide">{titulo}</h4>
        <span className="text-xs text-muted-foreground">
          {sufixo ? `R$${sufixo}` : "sem periodicidade"}
        </span>
      </div>

      {ordenadas.length === 0 ? (
        <p className="px-5 py-8 text-sm text-muted-foreground text-center">
          Nenhum {tom === "perda" ? "prejuízo" : "ganho"} apurado neste intervalo.
        </p>
      ) : (
        <ul className="divide-y">
          {visiveis.map((entrada) => (
            <li key={entrada.key}>
              <button
                type="button"
                onClick={() => aoAbrir(entrada.key)}
                className="w-full text-left px-5 py-3 hover:bg-accent transition-colors"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{entrada.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {"periodLabel" in entrada ? `${entrada.periodLabel} · ` : ""}
                      {entrada.vehicles}{" "}
                      {entrada.vehicles === 1 ? "veículo" : "veículos"} ·{" "}
                      {entrada.equipment}
                    </div>
                  </div>
                  <div
                    className={cn(
                      "text-sm font-bold tabular-nums shrink-0",
                      tom === "perda" ? "text-brand-red" : "text-success",
                    )}
                  >
                    {formatBrl(entrada.amount ?? 0)}
                  </div>
                </div>
                <span className="mt-2 block h-1.5 bg-muted overflow-hidden" role="presentation">
                  <span
                    className={cn(
                      "block h-full",
                      tom === "perda" ? "bg-brand-red" : "bg-success",
                    )}
                    style={{
                      width: `${teto === 0 ? 0 : (Math.abs(entrada.amount ?? 0) / teto) * 100}%`,
                    }}
                  />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {ordenadas.length > TOPO && (
        <button
          type="button"
          onClick={() => setTudo((v) => !v)}
          className="w-full px-5 py-3 border-t text-[0.8125rem] font-bold uppercase tracking-wide text-brand hover:bg-accent transition-colors"
        >
          {tudo ? `Mostrar só os ${TOPO} maiores` : `Ver todos os ${ordenadas.length}`}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Precisam de análise                                                 */
/* ------------------------------------------------------------------ */

/**
 * O que mudou e ainda não se sabe quanto vale.
 *
 * Nesta base são 89% das alterações, e por isso não é rodapé: é um bloco de
 * alerta, fechado por padrão para não engolir a tela, e que abre com parâmetro,
 * vigência, veículos, valor anterior, valor novo, unidade e **o motivo**. A
 * distinção que ele existe para manter de pé: *não houve impacto* e *houve
 * alteração e ainda não sabemos valorar* são coisas diferentes, e a segunda é a
 * que manda alguém trabalhar.
 */
function PrecisamDeAnalise({
  entradas,
  aoAbrir,
}: {
  entradas: (RangeEntry | EndToEndEntry)[];
  aoAbrir: (chave: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const veiculos = entradas.reduce((s, e) => s + e.vehicles, 0);

  type Linha = (RangeEntry | EndToEndEntry) & { periodLabel?: string };
  const colunas: ColunaTabela<Linha>[] = [
    {
      titulo: "Parâmetro",
      alinhar: "left",
      valor: (l) => l.title,
      celula: (l) => (
        <div className="min-w-0">
          <div className="font-medium">{l.title}</div>
          {l.attributeCode && (
            <div className="text-xs text-muted-foreground font-mono">{l.attributeCode}</div>
          )}
        </div>
      ),
    },
    {
      titulo: "Vigência",
      valor: (l) => l.periodLabel ?? "",
      celula: (l) => l.periodLabel ?? <span className="text-muted-foreground">—</span>,
    },
    { titulo: "Equipamento", valor: (l) => l.equipment, celula: (l) => l.equipment },
    {
      titulo: "Veículos",
      alinhar: "right",
      valor: (l) => l.vehicles,
      celula: (l) => <span className="tabular-nums">{l.vehicles}</span>,
    },
    {
      titulo: "Unidade",
      valor: (l) => l.unit ?? "",
      celula: (l) =>
        l.unit ? (
          <span className="font-mono text-xs">{l.unit}</span>
        ) : (
          <span className="text-muted-foreground text-xs">não declarada</span>
        ),
    },
    {
      titulo: "Por que não dá para valorar",
      alinhar: "left",
      valor: (l) => l.reason ?? "",
      celula: (l) => (
        <span className="text-xs text-muted-foreground">{l.reason ?? "sem motivo registrado"}</span>
      ),
    },
  ];

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="w-full bg-card border border-l-[6px] border-l-brand-red px-6 py-4 text-left hover:bg-accent transition-colors"
      >
        <div className="flex items-center justify-between gap-4">
          <p className="font-medium flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-brand-red shrink-0" />
            {entradas.length}{" "}
            {entradas.length === 1 ? "alteração precisa" : "alterações precisam"} de análise
          </p>
          <ChevronRight
            className={cn("w-4 h-4 shrink-0 transition-transform", aberto && "rotate-90")}
          />
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Impacto financeiro ainda não calculável · {veiculos} veículos somados por
          grupo. Não é zero: é o que este export ainda não permite precificar.
        </p>
      </button>

      {aberto && (
        <TabelaFreightech
          id="analise:sem-valoracao"
          colunas={colunas}
          linhas={entradas as Linha[]}
          chave={(l) => l.key}
          aoClicar={(l) => aoAbrir(l.key)}
          vazio={<span className="text-sm text-muted-foreground">Nada aqui.</span>}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Leitura 2 — ponta a ponta                                           */
/* ------------------------------------------------------------------ */

function LeituraPonta({
  p2p,
  carregando,
  erro,
  nome,
  aberto,
  onAbrir,
}: {
  p2p: PontaAPonta | null;
  carregando: boolean;
  erro: Error | null;
  nome: string;
  aberto: string | null;
  onAbrir: (chave: string | null) => void;
}) {
  if (carregando) return <p className="text-sm text-muted-foreground">Comparando as duas pontas…</p>;
  if (erro) {
    return (
      <div className="bg-card border border-l-[6px] border-l-brand-red px-6 py-4 text-sm">
        {erro.message}
      </div>
    );
  }
  if (!p2p) {
    return (
      <div className="bg-card border border-l-[6px] border-l-brand px-6 py-4 text-sm">
        Não há duas vigências com que comparar as pontas neste contexto.
      </div>
    );
  }

  const comPreco = p2p.entries.filter(
    (e) => e.confidence === "CALCULATED" && e.amount !== null && e.amount !== 0,
  );
  const semPreco = p2p.entries.filter((e) => e.confidence !== "CALCULATED" || e.amount === null);

  return (
    <div className="space-y-8">
      <Resumo
        titulo={`${p2p.fromLabel} → ${p2p.toLabel}`}
        perdas={somar(p2p.entries, (v) => v < 0)}
        ganhos={somar(p2p.entries, (v) => v > 0)}
        parametros={new Set(p2p.entries.map((e) => e.attributeCode ?? e.title)).size}
        veiculos={p2p.totals.vehiclesTouched}
        alteracoes={p2p.entries.length}
        comImpacto={comPreco.length}
        semImpacto={semPreco.length}
        motivo={motivoMaisComum(semPreco)}
        nome={nome}
      />

      <Frota p2p={p2p} />

      {p2p.reverted.length > 0 && <Revertidos p2p={p2p} />}

      {comPreco.length > 0 && <Rankings entradas={comPreco} aoAbrir={onAbrir} />}

      {semPreco.length > 0 && <PrecisamDeAnalise entradas={semPreco} aoAbrir={onAbrir} />}

      {aberto && (
        <DetalhePonta
          entrada={p2p.entries.find((e) => e.key === aberto) ?? null}
          p2p={p2p}
          onFechar={() => onAbrir(null)}
        />
      )}
    </div>
  );
}

/**
 * O eixo da frota, à parte do dinheiro.
 *
 * Existe porque a alternativa é o erro mais caro desta tela. Na base real, o
 * FINAME dos cavalos soma −R$ 52.223,90 de movimento entre dezembro e agosto, e
 * o total da frota vai de R$ 887.408,65 para R$ 867.860,23 — R$ 32.675 de
 * diferença que não é erro de nenhuma das contas: **entraram dois cavalos**.
 * Comparar total com total daria "economizamos R$ 19 mil" a quem na verdade
 * teve R$ 52 mil cortados e dois caminhões a mais para rodar.
 */
function Frota({ p2p }: { p2p: PontaAPonta }) {
  return (
    <section className="space-y-3">
      <Cabecalho titulo="A frota nas duas pontas" complemento="fora do dinheiro, sempre" />
      <div className="bg-card border px-5 py-4 text-sm space-y-2">
        {p2p.series.map((serie) => (
          <div key={serie.entityTypeSet} className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-medium">{serie.entityTypeSet}</span>
            <span className="tabular-nums">
              {serie.fleetFrom} → {serie.fleetTo} ativos
            </span>
            <span className="text-xs text-muted-foreground font-mono">
              {serie.fromLabel} → {serie.toLabel}
            </span>
          </div>
        ))}
        <p className="text-xs text-muted-foreground pt-1">
          {p2p.entitiesCompared} ativos estão nas duas pontas e são o que esta leitura
          compara. {p2p.fleet.added} {p2p.fleet.added === 1 ? "entrou" : "entraram"} e{" "}
          {p2p.fleet.removed} {p2p.fleet.removed === 1 ? "saiu" : "saíram"} no intervalo —
          contados aqui e nunca somados ao impacto, porque frota maior não é preço maior.
        </p>
        {p2p.missingSeries.length > 0 && (
          <p className="text-xs text-brand-red pt-1">
            {p2p.missingSeries.map((s) => `${s.entityTypeSet}: ${s.reason}`).join(" ")}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Mexeu e voltou.
 *
 * A única coisa da tela que exige as duas leituras: o que aparece nos
 * movimentos e não aparece nas pontas foi revertido. Não é palpite nem
 * heurística — é a subtração de um conjunto pelo outro.
 */
function Revertidos({ p2p }: { p2p: PontaAPonta }) {
  return (
    <section className="space-y-3">
      <Cabecalho
        titulo="Mexeu no caminho e voltou"
        complemento={`hoje está como estava em ${p2p.fromLabel}`}
      />
      <div className="bg-card border divide-y">
        {p2p.reverted.map((item) => (
          <div
            key={`${item.attributeCode}`}
            className="px-5 py-3 flex items-baseline justify-between gap-4"
          >
            <div className="min-w-0">
              <div className="font-medium truncate">
                {item.title}
                <span className="text-muted-foreground font-normal"> · {item.equipment}</span>
              </div>
              <div className="text-xs text-muted-foreground font-mono">{item.attributeCode}</div>
            </div>
            <div className="text-sm text-right shrink-0">
              <div className="tabular-nums font-medium">{item.entities} ativos</div>
              <div className="text-xs text-muted-foreground">
                mexeram em até {item.periods}{" "}
                {item.periods === 1 ? "vigência" : "vigências"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Detalhe — a ponte para a evidência                                  */
/* ------------------------------------------------------------------ */

/**
 * O detalhe de um movimento: o mesmo cartão do resto do produto.
 *
 * Reaproveitado inteiro, e não reescrito: ele já traz o antes → depois, a lista
 * de veículos com o valor de cada um, a série do atributo nas vigências e a
 * célula da planilha que originou o número. É onde a análise encosta na
 * evidência — e a evidência tem de ser a mesma que a aba Freightech mostra, ou
 * são duas verdades.
 */
function Detalhe({
  entrada,
  onFechar,
}: {
  entrada: RangeEntry | null;
  onFechar: () => void;
}) {
  if (!entrada) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <Cabecalho titulo="Detalhe" complemento={entrada.periodLabel} />
        <button
          type="button"
          onClick={onFechar}
          className="text-[0.8125rem] font-bold uppercase tracking-wide text-brand hover:underline"
        >
          Fechar
        </button>
      </div>
      <GroupCard group={entrada.group as unknown as ChangeGroup} period={entrada.period} />
    </section>
  );
}

/**
 * O detalhe de uma diferença ponta a ponta.
 *
 * Aqui **não** dá para reaproveitar o cartão de sempre, e a razão é a mesma que
 * fez esta leitura existir: ele busca os veículos de um `change_set` gravado, e
 * o par abril→agosto não é um. Os ativos vêm com a resposta, e a tabela abaixo
 * é o que existe deles — placa, valor na ponta inicial, valor na final,
 * variação e impacto. A proveniência célula a célula continua na aba Freightech
 * de cada uma das duas vigências.
 */
function DetalhePonta({
  entrada,
  p2p,
  onFechar,
}: {
  entrada: EndToEndEntry | null;
  p2p: PontaAPonta;
  onFechar: () => void;
}) {
  if (!entrada) return null;

  type Linha = EndToEndEntry["vehiclesDetail"][number];
  const colunas: ColunaTabela<Linha>[] = [
    {
      titulo: "Placa",
      alinhar: "left",
      fixa: true,
      valor: (l) => l.plate ?? "",
      celula: (l) => <span className="font-mono font-medium">{l.plate ?? "—"}</span>,
    },
    {
      titulo: p2p.fromLabel,
      valor: (l) => l.valueBefore ?? "",
      celula: (l) => l.valueBefore ?? <span className="text-muted-foreground italic text-xs">sem valor</span>,
    },
    {
      titulo: p2p.toLabel,
      valor: (l) => l.valueAfter ?? "",
      celula: (l) => l.valueAfter ?? <span className="text-muted-foreground italic text-xs">sem valor</span>,
    },
    {
      titulo: "Variação",
      alinhar: "right",
      valor: (l) => l.deltaPercent,
      celula: (l) =>
        l.deltaPercent === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className={cn("tabular-nums", l.deltaPercent < 0 ? "text-brand-red" : "text-success")}>
            {formatPercent(l.deltaPercent)}
          </span>
        ),
    },
    {
      titulo: "Impacto",
      alinhar: "right",
      valor: (l) => l.impactAmount,
      celula: (l) =>
        l.impactConfidence !== "CALCULATED" || l.impactAmount === null ? (
          <span
            className="text-muted-foreground italic text-xs"
            title={l.inconclusiveReason ?? "Impacto não calculável."}
          >
            não calculável
          </span>
        ) : (
          <span
            className={cn(
              "tabular-nums font-medium",
              l.impactAmount < 0 ? "text-brand-red" : "text-success",
            )}
          >
            {formatBrl(l.impactAmount)}
            <span className="text-xs font-normal">
              {periodicitySuffix(l.impactPeriodicity)}
            </span>
          </span>
        ),
    },
  ];

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <Cabecalho
          titulo={entrada.title}
          complemento={`${entrada.vehicles} ativos diferentes entre ${p2p.fromLabel} e ${p2p.toLabel}`}
        />
        <button
          type="button"
          onClick={onFechar}
          className="text-[0.8125rem] font-bold uppercase tracking-wide text-brand hover:underline"
        >
          Fechar
        </button>
      </div>
      {entrada.reason && (
        <p className="text-xs text-muted-foreground max-w-3xl">{entrada.reason}</p>
      )}
      <TabelaFreightech
        id={`ponta:${entrada.attributeCode}`}
        colunas={colunas}
        linhas={entrada.vehiclesDetail}
        // A placa identifica o ativo; sem ela, o par de valores é o que resta
        // de identidade — e continua estável entre renderizações.
        chave={(l) => l.plate ?? `${l.valueBefore}→${l.valueAfter}`}
        vazio={<span className="text-sm text-muted-foreground">Nenhum ativo diferente.</span>}
      />
    </section>
  );
}
