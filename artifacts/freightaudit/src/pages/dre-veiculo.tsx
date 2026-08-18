import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearch } from "wouter";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { fetchJson } from "@/lib/api";
import { formatBrl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AvisoDeCircularidade, Cascata } from "@/components/dre/cascata";
import { Cobertura, Indicadores } from "@/components/dre/indicadores";
import { ResumoDaConta } from "@/components/dre/resumo";
import { EvolucaoDoResultado, PonteDoResultado } from "@/components/dre/graficos";
import {
  ROTULO_DO_ESCOPO,
  type DREDoVeiculo,
  type EscopoApuravel,
  type HistoricoDaDRE,
  type PonteDaDRE,
} from "@/components/dre/tipos";

/**
 * O prontuário econômico de uma unidade (§26).
 *
 * A ordem da página é a hierarquia de §2, aplicada a um veículo: **quanto
 * deixou** (os indicadores), **por quê** (a DRE em cascata, com a origem de cada
 * número a um clique), **o que mudou** (a ponte de alterações e a explicação
 * derivada), e **para onde vai** (a evolução por vigência).
 *
 * Não há abas. Uma unidade econômica tem uma página, e a profundidade é vertical
 * — expansão progressiva, não navegação lateral.
 */

export default function DREVeiculo() {
  const { entityId } = useParams<{ entityId: string }>();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const escopo = (params.get("escopo") ?? "CONJUNTO") as EscopoApuravel;
  const period = params.get("period") ?? "";

  const query = new URLSearchParams({ escopo });
  if (period) query.set("period", period);
  const scopeHash = params.get("scopeHash");
  if (scopeHash) query.set("scopeHash", scopeHash);
  const canal = params.get("canal");
  if (canal !== null) query.set("canal", canal);
  const qs = query.toString();

  /*
    O recorte sem o `escopo`, para levar à Composição.

    `escopo` é vocabulário da DRE — CONJUNTO, CAVALO, CARRETA são regras de
    alocação —, e a Composição não o conhece. Já vigência, unidade e canal ela
    lê (`/composition/equipment/:id`), e não os recebia: sair da DRE de julho
    abria a composição mais recente do mesmo equipamento, com outros números e
    nada dizendo por quê.
  */
  const recorteDaComposicao = new URLSearchParams();
  if (period) recorteDaComposicao.set("period", period);
  if (scopeHash) recorteDaComposicao.set("scopeHash", scopeHash);
  if (canal !== null) recorteDaComposicao.set("canal", canal);

  const { data, isLoading, error } = useQuery({
    queryKey: ["dre", "unit", entityId, qs],
    queryFn: () => fetchJson<DREDoVeiculo>(`/dre/unit/${entityId}?${qs}`),
  });

  const ponte = useQuery({
    queryKey: ["dre", "bridge", entityId, qs],
    queryFn: () => fetchJson<PonteDaDRE>(`/dre/unit/${entityId}/bridge?${qs}`),
    enabled: Boolean(data),
  });

  const historico = useQuery({
    queryKey: ["dre", "unit-history", entityId, escopo],
    queryFn: () =>
      fetchJson<HistoricoDaDRE>(`/dre/unit/${entityId}/history?escopo=${escopo}`),
    enabled: Boolean(data),
  });

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <Link
          href={`/dre?escopo=${escopo}${period ? `&period=${period}` : ""}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          DRE da frota
        </Link>

        {data && (
          <div className="flex items-start justify-between gap-8 mt-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{data.unidade.rotulo}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {ROTULO_DO_ESCOPO[data.unidade.escopo]} ·{" "}
                {data.atual.periodLabel} · {data.contexto.label}
                {data.unidade.orfa && " · sem cavalo vinculado nesta vigência"}
              </p>
            </div>
            <div className="flex gap-4 text-right shrink-0">
              {data.unidade.lados.map((lado) => (
                <Link
                  key={lado.entityId}
                  href={`/composicao/${lado.entityId}${
                    recorteDaComposicao.toString() ? `?${recorteDaComposicao}` : ""
                  }`}
                  className="group"
                  title="Ver a composição da remuneração deste equipamento"
                >
                  <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                    {lado.entityType === "CAVALO" ? "Cavalo" : "Carreta"}
                  </div>
                  <div className="text-sm font-medium inline-flex items-center gap-1 group-hover:underline">
                    {lado.placa ?? "—"}
                    <ExternalLink className="w-3 h-3 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </header>

      <div className="px-8 py-6 space-y-6">
        {error && <ApiErrorNotice error={error} what="A DRE deste equipamento não pôde ser carregada." />}
        {isLoading && <Esqueleto />}

        {data && (
          <>
            {/*
              O resumo vem antes dos indicadores porque a pergunta que traz
              alguém a esta página vem do ranking — "por que este conjunto deu
              −R$ 721,79?" — e é a receita, o custo e a diferença entre os dois
              que respondem. Receita líquida e EBITDA são a leitura contábil da
              mesma unidade, e ela continua logo abaixo, no lugar de sempre.
            */}
            <section>
              <h2 className="text-sm font-semibold mb-3">Resumo da conta</h2>
              <ResumoDaConta dre={data.atual} />
            </section>

            <Indicadores dre={data.atual} anterior={data.anterior} />
            <Cobertura cobertura={data.atual.cobertura} estado={data.atual.estado} />
            <AvisoDeCircularidade texto={data.aviso} />

            <section>
              <h2 className="text-sm font-semibold mb-3">
                Demonstração
                <span className="ml-2 font-normal text-muted-foreground">
                  a mesma conta na ordem contábil, com a origem de cada número
                </span>
              </h2>
              <Cascata dre={data.atual} />
            </section>

            {ponte.data && <OQueAlterou ponte={ponte.data} />}

            {historico.data && historico.data.pontos.length > 1 && (
              <section>
                <h2 className="text-sm font-semibold mb-3">Evolução</h2>
                <EvolucaoDoResultado historico={historico.data} />
              </section>
            )}

            {data.atual.aguardandoCuradoria.length > 0 && (
              <AguardandoCuradoria itens={data.atual.aguardandoCuradoria} />
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

/**
 * O que alterou a DRE (§12, §13).
 *
 * A explicação vem do servidor já derivada dos números — nenhuma frase desta
 * seção é escrita na tela. O `naoAtribuido` aparece sempre que existe: uma
 * decomposição que não fecha e não diz que não fecha passa confiança falsa.
 */
function OQueAlterou({ ponte }: { ponte: PonteDaDRE }) {
  if (ponte.de === null) {
    return (
      <section>
        <h2 className="text-sm font-semibold mb-3">O que alterou sua DRE</h2>
        <div className="border rounded-lg bg-card px-6 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            Esta é a primeira vigência da série — não há período anterior contra o qual comparar.
          </p>
        </div>
      </section>
    );
  }

  const total = ponte.queMexeramNaDRE.length;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">
        O que alterou sua DRE
        <span className="ml-2 font-normal text-muted-foreground">
          {ponte.de.periodLabel} → {ponte.para.periodLabel}
        </span>
      </h2>

      {ponte.explicacao && (
        <div className="border rounded-lg bg-card px-5 py-4 space-y-2">
          <p className="text-sm">{ponte.explicacao.resumo}</p>
          {ponte.explicacao.responsaveis.length > 0 && (
            <ul className="text-sm text-muted-foreground space-y-1">
              {ponte.explicacao.responsaveis.map((r) => (
                <li key={r.titulo}>· {r.frase}</li>
              ))}
            </ul>
          )}
          {ponte.explicacao.ressalva && (
            <p className="text-xs text-muted-foreground border-t pt-2">
              {ponte.explicacao.ressalva}
            </p>
          )}
        </div>
      )}

      {total > 0 ? (
        <>
          <p className="text-xs text-muted-foreground">
            {total} {total === 1 ? "alteração impactou" : "alterações impactaram"} esta unidade,
            de {ponte.alteracoes.length} apuradas pelo motor de comparação.
          </p>
          <PonteDoResultado ponte={ponte} />
          {ponte.naoAtribuido !== null && Math.abs(ponte.naoAtribuido) >= 0.01 && (
            <p className="text-xs text-muted-foreground">
              A variação real do resultado foi{" "}
              <span className="tabular-nums text-foreground">
                {formatBrl(ponte.variacaoDoResultado ?? 0)}
              </span>
              . A diferença de{" "}
              <span className="tabular-nums text-foreground">
                {formatBrl(ponte.naoAtribuido)}
              </span>{" "}
              não foi atribuída a nenhuma alteração de parâmetro.
            </p>
          )}
          <Alteracoes ponte={ponte} />
        </>
      ) : (
        <div className="border rounded-lg bg-card px-6 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma das {ponte.alteracoes.length} alterações desta transição mexeu em linha da DRE.
          </p>
        </div>
      )}
    </section>
  );
}

/** A lista crua, para quem quiser conferir alteração por alteração. */
function Alteracoes({ ponte }: { ponte: PonteDaDRE }) {
  return (
    <details className="border rounded-lg bg-card">
      <summary className="px-5 py-3 text-sm cursor-pointer hover:bg-muted/40 transition-colors">
        Todas as {ponte.alteracoes.length} alterações desta transição
      </summary>
      <div className="border-t overflow-x-auto">
        <table className="w-full text-sm min-w-[44rem]">
          <thead>
            <tr className="border-b text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
              <th className="text-left font-medium px-4 py-2">Parâmetro</th>
              <th className="text-left font-medium px-4 py-2">Antes → depois</th>
              <th className="text-left font-medium px-4 py-2">Linha da DRE</th>
              <th className="text-right font-medium px-4 py-2">Efeito</th>
            </tr>
          </thead>
          <tbody>
            {ponte.alteracoes.map((a) => (
              <tr key={a.changeId} className="border-b last:border-b-0">
                <td className="px-4 py-2">
                  <span className="font-medium">{a.attributeName ?? a.attributeCode}</span>
                  {a.entityLabel && (
                    <span className="block text-[0.6875rem] text-muted-foreground">
                      {a.entityLabel}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-muted-foreground tabular-nums text-xs">
                  {a.valorAntes ?? "—"} → {a.valorDepois ?? "—"}
                </td>
                <td className="px-4 py-2 text-xs">
                  {a.linhaDaDRE ? (
                    a.linhaDaDRE.titulo
                  ) : (
                    <span className="text-muted-foreground">fora da DRE</span>
                  )}
                </td>
                <td
                  className={cn(
                    "px-4 py-2 text-right tabular-nums",
                    a.efeitoNoResultado !== null &&
                      (a.efeitoNoResultado < 0 ? "text-brand-red" : "text-emerald-600"),
                  )}
                  title={a.motivoDaExclusao ?? undefined}
                >
                  {a.efeitoNoResultado === null
                    ? "—"
                    : `${a.efeitoNoResultado > 0 ? "+" : "−"}${formatBrl(Math.abs(a.efeitoNoResultado))}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function AguardandoCuradoria({
  itens,
}: {
  itens: { code: string; titulo: string; oQueFalta: string }[];
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold mb-3">Aguardando curadoria</h2>
      {/* Cada item abre o seu atributo na Curadoria — ver o irmão em `dre.tsx`. */}
      <div className="border rounded-lg bg-card divide-y">
        {itens.map((i) => (
          <Link
            key={i.code}
            href={`/curadoria?atributo=${encodeURIComponent(i.code)}`}
            className="group block px-5 py-3 hover:bg-muted/40 transition-colors"
          >
            <div className="text-sm font-medium group-hover:text-brand transition-colors">
              {i.titulo}
            </div>
            <p className="text-xs text-muted-foreground mt-1 max-w-4xl">{i.oQueFalta}</p>
          </Link>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Estes componentes têm valor no export e ficam fora da conta porque ninguém confirmou o
        que a coluna mede. Confirmá-los na{" "}
        <Link href="/curadoria" className="underline">
          Curadoria
        </Link>{" "}
        os traz para a DRE.
      </p>
    </section>
  );
}

function Esqueleto() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="grid gap-px bg-border rounded-lg overflow-hidden md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-card px-5 py-4 space-y-2">
            <div className="h-3 w-24 rounded bg-muted animate-pulse" />
            <div className="h-7 w-32 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>
      <div className="h-12 rounded-lg bg-card border animate-pulse" />
      <div className="h-96 rounded-lg bg-card border animate-pulse" />
    </div>
  );
}
