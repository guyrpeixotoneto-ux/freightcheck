import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, Check, FileSpreadsheet, Info, Minus } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  CATALOGO_FREIGHTECH,
  chaveDoCartao,
  ligarParametros,
} from "@/lib/freightech-catalogo";
import type { FamiliesView, SeriesContext } from "@/components/inicio/types";

/**
 * Dados — o que já entrou no sistema, e o que ainda falta.
 *
 * A tela de Parâmetros mostra as 75 gavetas do Freightech, e a maioria delas
 * está vazia. Isso levanta uma pergunta que aquela tela não responde bem, porque
 * lá a resposta está espalhada em 75 cartões: **a planilha que eu importei traz
 * tudo, ou preciso pedir outras?**
 *
 * Esta tela existe para responder isso de uma olhada, e a resposta tem duas
 * metades que não podem ser confundidas:
 *
 * 1. **O que entrou** — quais arquivos, quantas vigências, quais unidades e
 *    canais, e quais séries (cavalo, carreta). É o inventário do que o sistema
 *    tem.
 * 2. **O que falta** — quais cartões do catálogo continuam sem dado, listados
 *    pelo nome, para virar pedido de planilha. Um total como "10 de 75" diz o
 *    tamanho do buraco; só a lista diz o que pedir.
 *
 * **A cobertura é medida sobre todas as vigências, não sobre a aberta.** Um
 * cartão que recebeu dado em julho e não em agosto tem dado no sistema — dizer
 * que falta faria pedir de novo uma planilha que já foi entregue. Por isso a
 * tela consulta cada contexto e une os resultados.
 *
 * **Ela não inventa cobertura.** Se a resposta de um contexto falhar, o que
 * aquele contexto traria não entra na conta de "tem", e a tela diz que a
 * medição está incompleta — um número de cobertura otimista mandaria alguém
 * parar de procurar dado que existe.
 */
export default function Dados() {
  const contextos = useQuery({
    queryKey: ["contexts"],
    queryFn: async () => {
      const response = await fetch(getApiUrl("/contexts"));
      if (!response.ok) return [] as SeriesContext[];
      return (await response.json()) as SeriesContext[];
    },
    retry: false,
  });

  const vistas = useQueries({
    queries: (contextos.data ?? []).map((contexto) => ({
      queryKey: ["families", "dados", contexto.scopeHash, contexto.channel],
      queryFn: async () => {
        const query = new URLSearchParams({ scopeHash: contexto.scopeHash });
        if (contexto.channel) query.set("canal", contexto.channel);
        const response = await fetch(getApiUrl(`/changes/families?${query}`));
        if (!response.ok) return null;
        return (await response.json()) as FamiliesView;
      },
      retry: false,
    })),
  });

  const importacoes = useQuery({
    queryKey: ["imports", "dados"],
    queryFn: async () => {
      const response = await fetch(getApiUrl("/imports"));
      if (!response.ok) return [] as ImportRun[];
      const body: unknown = await response.json();
      return Array.isArray(body) ? (body as ImportRun[]) : [];
    },
    retry: false,
  });

  const carregando = contextos.isLoading || vistas.some((v) => v.isLoading);
  const respondidas = vistas.filter((v) => v.data).map((v) => v.data as FamiliesView);
  const falharam = vistas.filter((v) => !v.isLoading && !v.data).length;

  const cobertura = useMemo(() => medirCobertura(respondidas), [respondidas]);

  return (
    <Layout>
      <div className="px-10 py-6 max-w-[1600px]">
        <h1 className="text-3xl font-bold uppercase tracking-tight">Cobertura de dados</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tudo o que já entrou no sistema — e, do catálogo do Freightech, o que ainda não
          chegou.
        </p>

        {carregando && <p className="mt-8 text-sm text-muted-foreground">Carregando…</p>}

        {!carregando && (
          <>
            <Placar
              cobertura={cobertura}
              contextos={contextos.data ?? []}
              vistas={respondidas}
              importacoes={importacoes.data ?? []}
            />

            {falharam > 0 && (
              <Aviso tom="alerta">
                <strong>Medição incompleta.</strong> {falharam}{" "}
                {falharam === 1 ? "contexto não respondeu" : "contextos não responderam"}. O
                que eles trariam não está contado como "tem dado" — a cobertura abaixo é o
                piso, não o retrato completo.
              </Aviso>
            )}

            <SeriesFaltando vistas={respondidas} />

            <Cobertura cobertura={cobertura} />

            <Importacoes importacoes={importacoes.data ?? []} />

            <ForaDoCatalogo cobertura={cobertura} />
          </>
        )}
      </div>
    </Layout>
  );
}

/* ------------------------------------------------------------------ */
/* A medição                                                           */
/* ------------------------------------------------------------------ */

interface CoberturaSecao {
  titulo: string;
  comDado: string[];
  semDado: string[];
}

interface Cobertura {
  secoes: CoberturaSecao[];
  total: number;
  comDado: number;
  /** Parâmetros nossos sem cartão no Freightech — cobertura que só temos aqui. */
  soNossos: string[];
  /** Todos os nomes de parâmetro vistos em qualquer vigência de qualquer contexto. */
  parametros: string[];
}

/**
 * Une o que todas as vigências de todos os contextos trouxeram e confronta com
 * o catálogo.
 *
 * O critério de "tem dado" é o parâmetro **existir** na resposta, não ter
 * mudado nela: um parâmetro que veio na planilha e não mudou é dado presente, e
 * contá-lo como ausente mandaria pedir de novo um arquivo que já chegou.
 */
function medirCobertura(vistas: FamiliesView[]): Cobertura {
  const nomes = new Set<string>();
  for (const vista of vistas) {
    for (const familia of vista.families) {
      for (const parametro of familia.parameters) nomes.add(parametro.name);
    }
  }

  const { porCartao, usados } = ligarParametros([...nomes]);

  const secoes = CATALOGO_FREIGHTECH.map((secao) => {
    const comDado: string[] = [];
    const semDado: string[] = [];
    for (const cartao of secao.cartoes) {
      const chave = chaveDoCartao(secao.titulo, cartao.nome);
      (porCartao.has(chave) ? comDado : semDado).push(cartao.nome);
    }
    return { titulo: secao.titulo, comDado, semDado };
  });

  return {
    secoes,
    total: secoes.reduce((soma, s) => soma + s.comDado.length + s.semDado.length, 0),
    comDado: secoes.reduce((soma, s) => soma + s.comDado.length, 0),
    soNossos: [...nomes].filter((n) => !usados.has(n)).sort((a, b) => a.localeCompare(b)),
    parametros: [...nomes].sort((a, b) => a.localeCompare(b)),
  };
}

/* ------------------------------------------------------------------ */
/* O placar                                                            */
/* ------------------------------------------------------------------ */

function Placar({
  cobertura,
  contextos,
  vistas,
  importacoes,
}: {
  cobertura: Cobertura;
  contextos: SeriesContext[];
  vistas: FamiliesView[];
  importacoes: ImportRun[];
}) {
  const vigencias = new Set<string>();
  for (const vista of vistas) for (const p of vista.periods) vigencias.add(`${p.date}`);

  const promovidas = importacoes.filter((i) => i.status === "PROMOTED").length;

  return (
    <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
      <Numero
        valor={`${cobertura.comDado} de ${cobertura.total}`}
        rotulo="cartões do Freightech com dado"
        detalhe={`${cobertura.total - cobertura.comDado} ainda sem`}
        destaque
      />
      <Numero
        valor={String(importacoes.length)}
        rotulo={importacoes.length === 1 ? "planilha importada" : "planilhas importadas"}
        detalhe={
          promovidas === importacoes.length
            ? "todas promovidas"
            : `${promovidas} promovidas · ${importacoes.length - promovidas} não`
        }
      />
      <Numero
        valor={String(vigencias.size)}
        rotulo={vigencias.size === 1 ? "vigência no sistema" : "vigências no sistema"}
        detalhe={intervaloDeVigencias(vistas)}
      />
      <Numero
        valor={String(new Set(contextos.map((c) => c.scopeHash)).size)}
        rotulo="unidades"
        detalhe={contextos.map((c) => c.label).join(" · ") || "nenhuma"}
      />
    </div>
  );
}

function intervaloDeVigencias(vistas: FamiliesView[]): string {
  const datas = vistas.flatMap((v) => v.periods.map((p) => p));
  if (datas.length === 0) return "nenhuma";
  const ordenadas = [...datas].sort((a, b) => a.date.localeCompare(b.date));
  const primeira = ordenadas[0].label;
  const ultima = ordenadas[ordenadas.length - 1].label;
  return primeira === ultima ? primeira : `${primeira} → ${ultima}`;
}

function Numero({
  valor,
  rotulo,
  detalhe,
  destaque,
}: {
  valor: string;
  rotulo: string;
  detalhe: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={cn(
        "bg-card border border-t-[3px] p-5",
        destaque ? "border-t-brand" : "border-t-border",
      )}
    >
      <div className="text-3xl font-bold tabular-nums">{valor}</div>
      <div className="text-sm mt-1">{rotulo}</div>
      <div className="text-xs text-muted-foreground mt-2 pt-2 border-t truncate" title={detalhe}>
        {detalhe}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* As séries que faltam na vigência                                    */
/* ------------------------------------------------------------------ */

/**
 * Cavalo veio, carreta não — ou o contrário.
 *
 * É o buraco de dado mais caro que existe aqui, e o mais fácil de não perceber:
 * a tela de parâmetros continua mostrando números, só que sobre metade da frota.
 * Por isso ele fica em cima, antes da cobertura por cartão.
 */
function SeriesFaltando({ vistas }: { vistas: FamiliesView[] }) {
  const incompletas = vistas.filter((v) => !v.complete);
  if (incompletas.length === 0) return null;

  return (
    <Aviso tom="alerta">
      <strong>Falta uma série inteira na vigência mais recente.</strong>{" "}
      {incompletas.map((v) => (
        <span key={v.context.scopeHash + v.period}>
          Em <strong>{v.context.label}</strong>, {v.periodLabel} trouxe apenas{" "}
          {v.series.map((s) => s.equipment.toLowerCase()).join(", ")} — falta{" "}
          <strong>{v.missingSeries.join(", ").toLowerCase()}</strong>.{" "}
        </span>
      ))}
      Nenhum número desta vigência cobre a série ausente, e ela não está contada como zero.
      É uma planilha a pedir, não um cartão a preencher.
    </Aviso>
  );
}

/* ------------------------------------------------------------------ */
/* A cobertura, seção por seção                                        */
/* ------------------------------------------------------------------ */

function Cobertura({ cobertura }: { cobertura: Cobertura }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold uppercase tracking-wide">
        Cobertura do catálogo do Freightech
      </h2>
      <div className="border-b-2 border-brand mt-2" />
      <p className="text-xs text-muted-foreground mt-3 max-w-4xl">
        Medido sobre todas as vigências de todas as unidades, não só sobre a aberta: um
        cartão que recebeu dado em qualquer vigência já importada conta como "tem". A
        coluna da direita é o que virar pedido de planilha.
      </p>

      <div className="mt-5 space-y-4">
        {cobertura.secoes.map((secao) => (
          <LinhaCobertura key={secao.titulo} secao={secao} />
        ))}
      </div>
    </section>
  );
}

function LinhaCobertura({ secao }: { secao: CoberturaSecao }) {
  const total = secao.comDado.length + secao.semDado.length;
  const proporcao = total === 0 ? 0 : (secao.comDado.length / total) * 100;

  return (
    <div className="bg-card border px-6 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 className="font-bold uppercase tracking-wide text-sm">{secao.titulo}</h3>
        <span className="text-sm tabular-nums">
          <strong>{secao.comDado.length}</strong>
          <span className="text-muted-foreground"> de {total} com dado</span>
        </span>
      </div>

      {/* A barra é a leitura de relance; as listas abaixo são o que se faz com ela. */}
      <div className="h-2 bg-muted mt-2 overflow-hidden" role="presentation">
        <div className="h-full bg-brand" style={{ width: `${proporcao}%` }} />
      </div>

      <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2 mt-3">
        <ListaDeCartoes
          titulo="Tem dado"
          nomes={secao.comDado}
          icone={<Check className="w-3.5 h-3.5 text-success shrink-0" />}
          vazio="nenhum cartão desta seção recebeu dado ainda"
        />
        <ListaDeCartoes
          titulo="Falta dado"
          nomes={secao.semDado}
          icone={<Minus className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
          vazio="seção completa — todos os cartões têm dado"
        />
      </div>
    </div>
  );
}

function ListaDeCartoes({
  titulo,
  nomes,
  icone,
  vazio,
}: {
  titulo: string;
  nomes: string[];
  icone: React.ReactNode;
  vazio: string;
}) {
  return (
    <div>
      <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground mb-1">
        {titulo} ({nomes.length})
      </div>
      {nomes.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{vazio}</p>
      ) : (
        <ul className="text-xs space-y-0.5">
          {nomes.map((nome) => (
            <li key={nome} className="flex items-center gap-1.5">
              {icone}
              <span className={titulo === "Falta dado" ? "text-muted-foreground" : ""}>
                {nome}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* O que foi importado                                                 */
/* ------------------------------------------------------------------ */

interface ImportRun {
  id: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  filename: string;
  byteSize: number | null;
  sheets: number | null;
  rawRows: number | null;
  stagedFacts: number | null;
  snapshots: number | null;
  errors: number | null;
  warnings: number | null;
  labels: string[] | null;
  failureReason: string | null;
}

function Importacoes({ importacoes }: { importacoes: ImportRun[] }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold uppercase tracking-wide">Planilhas importadas</h2>
      <div className="border-b-2 border-brand mt-2" />

      {importacoes.length === 0 ? (
        <p className="text-sm text-muted-foreground mt-4">
          Nenhuma planilha importada ainda.{" "}
          <Link href="/importacoes" className="text-brand font-semibold hover:underline">
            Enviar a primeira
          </Link>
          .
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm bg-card border">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <Cabecalho>Arquivo</Cabecalho>
                <Cabecalho>Situação</Cabecalho>
                <Cabecalho>Vigências que trouxe</Cabecalho>
                <Cabecalho alinhar="right">Abas</Cabecalho>
                <Cabecalho alinhar="right">Linhas</Cabecalho>
                <Cabecalho alinhar="right">Fatos</Cabecalho>
                <Cabecalho alinhar="right">Erros</Cabecalho>
              </tr>
            </thead>
            <tbody>
              {importacoes.map((run) => (
                <tr key={run.id} className="border-b last:border-b-0 align-top">
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <FileSpreadsheet className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="font-medium break-all">{run.filename}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatarData(run.finishedAt ?? run.startedAt)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Situacao status={run.status} motivo={run.failureReason} />
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {run.labels && run.labels.length > 0 ? (
                      <span className="font-mono">{run.labels.join(", ")}</span>
                    ) : (
                      <span className="text-muted-foreground">nenhuma</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{run.sheets ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatarNumero(run.rawRows)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatarNumero(run.stagedFacts)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {run.errors ? (
                      <span className="text-brand-red font-semibold">{run.errors}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
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

function Cabecalho({
  children,
  alinhar,
}: {
  children: React.ReactNode;
  alinhar?: "right";
}) {
  return (
    <th
      className={cn(
        "px-4 py-2.5 text-[0.6875rem] uppercase tracking-wider font-semibold text-muted-foreground",
        alinhar === "right" && "text-right",
      )}
    >
      {children}
    </th>
  );
}

/**
 * O estado de uma importação, com a palavra que o banco usa.
 *
 * "Promovida" é a única que significa que o dado está valendo nas telas. Uma
 * importação que parou antes disso ocupa lugar na lista e não alimenta cartão
 * nenhum — e é uma explicação possível para "importei e não apareceu".
 */
function Situacao({ status, motivo }: { status: string; motivo: string | null }) {
  const promovida = status === "PROMOTED";
  const falhou = status === "FAILED";
  return (
    <div className="min-w-0">
      <span
        className={cn(
          "text-xs font-semibold uppercase tracking-wide px-2 py-0.5 border",
          promovida && "text-success border-success/40 bg-success/10",
          falhou && "text-brand-red border-brand-red/40 bg-brand-red/10",
          !promovida && !falhou && "text-muted-foreground",
        )}
      >
        {promovida ? "promovida" : falhou ? "falhou" : status.toLowerCase()}
      </span>
      {!promovida && !falhou && (
        <div className="text-xs text-muted-foreground mt-1">
          ainda não alimenta as telas
        </div>
      )}
      {motivo && <div className="text-xs text-brand-red mt-1">{motivo}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* O que só o FreightCheck tem                                         */
/* ------------------------------------------------------------------ */

/**
 * Os parâmetros que chegaram e não têm gaveta no Freightech.
 *
 * Aparecem aqui porque respondem à outra metade da pergunta: além do que falta,
 * o que sobra. Aquisição, financiamento e tributos estão neste grupo — é onde
 * está a maior parte do dinheiro deste export, e nenhum cartão do Freightech
 * cobre.
 */
function ForaDoCatalogo({ cobertura }: { cobertura: Cobertura }) {
  if (cobertura.soNossos.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold uppercase tracking-wide">
        Dado que o Freightech não tem gaveta para mostrar
      </h2>
      <div className="border-b-2 border-brand mt-2" />
      <p className="text-xs text-muted-foreground mt-3 max-w-4xl">
        {cobertura.soNossos.length}{" "}
        {cobertura.soNossos.length === 1 ? "parâmetro veio" : "parâmetros vieram"} no export e
        não {cobertura.soNossos.length === 1 ? "corresponde" : "correspondem"} a nenhum
        cartão das telas do Freightech que conhecemos. Eles aparecem em Parâmetros, em seção
        própria.
      </p>
      <ul className="grid gap-x-8 gap-y-1 sm:grid-cols-3 lg:grid-cols-4 mt-3 text-xs">
        {cobertura.soNossos.map((nome) => (
          <li key={nome} className="flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-success shrink-0" />
            {nome}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Miudezas                                                            */
/* ------------------------------------------------------------------ */

function Aviso({
  tom,
  children,
}: {
  tom: "alerta" | "neutro";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mt-6 bg-card border border-l-[6px] px-6 py-4 text-sm flex gap-3",
        tom === "alerta" ? "border-l-brand-red" : "border-l-brand",
      )}
    >
      {tom === "alerta" ? (
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-brand-red" />
      ) : (
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-brand" />
      )}
      <p className="max-w-4xl">{children}</p>
    </div>
  );
}

function formatarNumero(valor: number | null): string {
  if (valor === null || valor === undefined) return "—";
  return valor.toLocaleString("pt-BR");
}

function formatarData(valor: string | null): string {
  if (!valor) return "—";
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return "—";
  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
