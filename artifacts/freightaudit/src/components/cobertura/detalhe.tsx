import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, X } from "lucide-react";
import { fetchJson } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Lacunas } from "./lacunas";
import {
  APARENCIA,
  numero,
  percentual,
  type DetalheDaCelula,
  type DetalheDaLacuna,
  type Lacuna,
  type PontoDoHistorico,
  type Proveniencia,
} from "./tipos";

/**
 * O terceiro e o quarto degraus: o detalhe e a origem.
 *
 * A hierarquia da tela é resumo → matriz → exceções → detalhe, e estes painéis
 * são os dois últimos. Eles só existem depois de um clique — nada disto é
 * carregado com a página, porque quase ninguém desce até aqui e quem desce quer
 * uma coisa específica.
 */

export function DetalheDaCelulaPainel({
  snapshotId,
  entityType,
  aoFechar,
  aoAbrirLacuna,
}: {
  snapshotId: string;
  entityType: string;
  aoFechar: () => void;
  aoAbrirLacuna: (lacuna: Lacuna) => void;
}) {
  const consulta = useQuery({
    queryKey: ["coverage", "cell", snapshotId, entityType],
    queryFn: () =>
      fetchJson<DetalheDaCelula>(`/coverage/cell/${snapshotId}/${entityType}`),
    retry: false,
  });

  return (
    <section className="mt-8 border-2 border-brand bg-card">
      <header className="flex items-start justify-between gap-4 px-6 py-4 border-b bg-muted/40">
        <div className="min-w-0">
          <h2 className="text-lg font-bold uppercase tracking-wide">
            {consulta.data
              ? `${consulta.data.familiaLabel} de ${consulta.data.equipamentoLabel}s`
              : "Detalhe do conjunto"}
          </h2>
          {consulta.data && (
            <p className="text-sm text-muted-foreground">
              {consulta.data.vigencia.periodo} · {consulta.data.scopeLabel}
              {consulta.data.canal ? ` · ${consulta.data.canal}` : ""} · revisão{" "}
              {consulta.data.vigencia.revision} ({consulta.data.vigencia.sourceLabel})
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={aoFechar}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Fechar o detalhe"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      <div className="px-6 py-5">
        {consulta.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {consulta.isError && (
          <p className="text-sm text-brand-red">
            Não foi possível abrir este conjunto. A matriz acima continua válida.
          </p>
        )}

        {consulta.data && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Medida
                rotulo="Cobertura"
                valor={percentual(consulta.data.conta.percentual)}
                destaque
              />
              <Medida
                rotulo="Cobertura crítica"
                valor={
                  consulta.data.contaCritica.combinacoesEsperadas === 0
                    ? "—"
                    : percentual(consulta.data.contaCritica.percentual)
                }
              />
              <Medida
                rotulo="Entidades"
                valor={numero(consulta.data.conta.entidadesEncontradas)}
                nota={`${numero(consulta.data.conta.entidadesEsperadas)} esperadas`}
              />
              <Medida
                rotulo="Atributos"
                valor={`${numero(consulta.data.conta.atributosEncontrados)} de ${numero(
                  consulta.data.conta.atributosEsperados,
                )}`}
                nota="encontrados de esperados"
              />
              <Medida
                rotulo="Combinações esperadas"
                valor={numero(consulta.data.conta.combinacoesEsperadas)}
                nota="entidades × atributos"
              />
              <Medida
                rotulo="Combinações encontradas"
                valor={numero(consulta.data.conta.combinacoesEncontradas)}
              />
              <Medida
                rotulo="Dados faltantes"
                valor={numero(
                  Math.max(
                    0,
                    consulta.data.conta.combinacoesEsperadas -
                      consulta.data.conta.combinacoesNaoAplicaveis -
                      consulta.data.conta.combinacoesEncontradas,
                  ),
                )}
                alerta
              />
              <Medida
                rotulo="Não aplicáveis"
                valor={numero(consulta.data.conta.combinacoesNaoAplicaveis)}
                nota="fora da conta dos dois lados"
              />
            </div>

            <Contribuintes contribuintes={consulta.data.contribuintes} />

            {consulta.data.inesperados.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-bold uppercase tracking-wide">
                  Chegou sem ser esperado ({consulta.data.inesperados.length})
                </h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-3xl">
                  Atributos presentes nesta vigência que nenhum contrato declara e que o histórico
                  ainda não sustenta como expectativa. Não contam como cobertura — o denominador é
                  o esperado.
                </p>
                <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 text-xs">
                  {consulta.data.inesperados.slice(0, 30).map((i) => (
                    <li key={i.attributeCode} className="flex justify-between gap-2">
                      <span className="truncate" title={i.attributeCode}>
                        {i.attributeLabel}
                      </span>
                      <span className="text-muted-foreground tabular-nums shrink-0">
                        {numero(i.entidades)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {consulta.data.entidadesAusentes.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-bold uppercase tracking-wide">
                  Equipamentos que não vieram ({consulta.data.entidadesAusentes.length})
                </h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-3xl">
                  Estavam em vigências anteriores deste mesmo recorte e não estão nesta. Contam
                  como falta em todos os atributos esperados — é o que separa "o arquivo veio com
                  menos colunas" de "o arquivo veio com menos equipamentos". Se a saída foi
                  legítima, registrar a baixa em Curadoria encerra a cobrança; enquanto ninguém
                  registrar, ela continua.
                </p>
                <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 text-xs">
                  {consulta.data.entidadesAusentes.slice(0, 30).map((e) => (
                    <li key={e.entityId} className="flex justify-between gap-2">
                      <span className="truncate font-mono" title={e.entityId}>
                        {e.rotulo}
                      </span>
                      <span className="text-muted-foreground tabular-nums shrink-0">
                        até {e.ultimaVigencia}
                      </span>
                    </li>
                  ))}
                </ul>
                {consulta.data.entidadesAusentes.length > 30 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    e mais {consulta.data.entidadesAusentes.length - 30} não listados aqui.
                  </p>
                )}
              </div>
            )}

            <div className="mt-2">
              <Lacunas lacunas={consulta.data.lacunas as Lacuna[]} aoAbrir={aoAbrirLacuna} />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Medida({
  rotulo,
  valor,
  nota,
  destaque,
  alerta,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  destaque?: boolean;
  alerta?: boolean;
}) {
  return (
    <div className="border-l-2 pl-3 border-border">
      <div
        className={cn(
          "text-2xl font-bold tabular-nums",
          destaque && "text-brand",
          alerta && valor !== "0" && "text-brand-red",
        )}
      >
        {valor}
      </div>
      <div className="text-xs mt-0.5">{rotulo}</div>
      {nota && <div className="text-[0.6875rem] text-muted-foreground">{nota}</div>}
    </div>
  );
}

/**
 * Quais arquivos formaram esta vigência.
 *
 * Responde a metade da pergunta de proveniência que a matriz levanta: uma
 * vigência costuma ser feita de mais de um arquivo, e "quantos fatos vieram
 * herdados" é o que distingue um componente que chegou agora de um que a
 * revisão anterior carregou adiante.
 */
function Contribuintes({
  contribuintes,
}: {
  contribuintes: DetalheDaCelula["contribuintes"];
}) {
  if (contribuintes.length === 0) return null;
  return (
    <div className="mt-6">
      <h3 className="text-sm font-bold uppercase tracking-wide">
        De onde veio esta vigência ({contribuintes.length}{" "}
        {contribuintes.length === 1 ? "arquivo" : "arquivos"})
      </h3>
      <ul className="mt-2 space-y-2">
        {contribuintes.map((c) => (
          <li key={c.importRunId} className="flex items-start gap-2 text-xs border px-3 py-2">
            <FileSpreadsheet className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="font-medium break-all">{c.arquivo}</div>
              <div className="text-muted-foreground">
                {numero(c.fatos)} fatos
                {c.herdados > 0 && ` · ${numero(c.herdados)} herdados da revisão anterior`} ·{" "}
                {c.equipamentos.join(", ").toLowerCase()}
              </div>
              <code className="text-[0.625rem] text-muted-foreground break-all">
                sha256 {c.contentSha256.slice(0, 16)}…
              </code>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * O último degrau: quais equipamentos, e de onde veio o que existe.
 *
 * Mostra tanto quem está sem o dado quanto o histórico do atributo, porque as
 * duas perguntas chegam juntas: "quem está faltando?" e "desde quando?".
 */
export function DetalheDaLacunaPainel({
  snapshotId,
  attributeCode,
  aoFechar,
}: {
  snapshotId: string;
  attributeCode: string;
  aoFechar: () => void;
}) {
  const lacuna = useQuery({
    queryKey: ["coverage", "gap", snapshotId, attributeCode],
    queryFn: () =>
      fetchJson<DetalheDaLacuna>(
        `/coverage/gap/${snapshotId}/${encodeURIComponent(attributeCode)}`,
      ),
    retry: false,
  });

  const historico = useQuery({
    queryKey: ["coverage", "history", attributeCode],
    queryFn: () =>
      fetchJson<PontoDoHistorico[]>(
        `/coverage/history/${encodeURIComponent(attributeCode)}`,
      ),
    retry: false,
  });

  return (
    <section className="mt-6 border-2 border-brand-red bg-card">
      <header className="flex items-start justify-between gap-4 px-6 py-4 border-b bg-muted/40">
        <div className="min-w-0">
          <h2 className="text-lg font-bold uppercase tracking-wide">
            {lacuna.data?.attributeLabel ?? attributeCode}
          </h2>
          <p className="text-sm text-muted-foreground">
            <code>{attributeCode}</code>
            {lacuna.data && ` · ${lacuna.data.vigencia.periodo} · ${lacuna.data.entityType.toLowerCase()}`}
          </p>
        </div>
        <button
          type="button"
          onClick={aoFechar}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Fechar o detalhe da lacuna"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      <div className="px-6 py-5">
        {historico.data && historico.data.length > 0 && <Historico pontos={historico.data} />}

        {lacuna.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {lacuna.data && (
          <div className="mt-6">
            <h3 className="text-sm font-bold uppercase tracking-wide">
              Equipamentos sem o dado ({numero(lacuna.data.entidades.length)}
              {lacuna.data.naoListadas > 0 && ` de ${numero(
                lacuna.data.entidades.length + lacuna.data.naoListadas,
              )}`}
              )
            </h3>
            {lacuna.data.naoListadas > 0 && (
              <p className="text-xs text-warning-foreground mt-1">
                {numero(lacuna.data.naoListadas)} não aparecem nesta lista. Ela é limitada de
                propósito — o que está acima é amostra, não o conjunto.
              </p>
            )}
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {lacuna.data.entidades.map((e) => (
                <li
                  key={e.entityId}
                  className={cn(
                    "text-xs px-2 py-1 border font-mono",
                    e.estado === "AUSENTE" && "border-brand-red/40 bg-brand-red/5",
                    e.estado === "VAZIO" && "border-warning/40 bg-warning/5",
                  )}
                  title={
                    e.estado === "AUSENTE"
                      ? "A coluna não veio para este equipamento."
                      : `Coluna entregue e sem valor (${e.nullReason ?? "sem motivo declarado"}).`
                  }
                >
                  {e.identificador}
                </li>
              ))}
            </ul>
            {lacuna.data.entidades.length === 0 && (
              <p className="text-sm text-muted-foreground mt-2">
                Nenhum equipamento sem o dado nesta vigência.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * A série do atributo, vigência a vigência.
 *
 * Barras em vez de linha, e a vigência sem a coluna aparece vazia em vez de
 * sumir: uma linha que pula o buraco esconde exatamente a quebra de padrão que
 * se veio ver.
 */
function Historico({ pontos }: { pontos: PontoDoHistorico[] }) {
  const maximo = Math.max(...pontos.map((p) => p.percentual), 100);
  return (
    <div>
      <h3 className="text-sm font-bold uppercase tracking-wide">Histórico</h3>
      <p className="text-xs text-muted-foreground mt-1">
        Proporção dos equipamentos daquela vigência com o dado presente.
      </p>
      <ol className="mt-3 flex items-end gap-2 overflow-x-auto pb-2">
        {pontos.map((p) => (
          <li key={p.snapshotId} className="flex flex-col items-center gap-1 min-w-[3.25rem]">
            <span className="text-[0.625rem] tabular-nums text-muted-foreground">
              {p.noLayout ? `${Math.round(p.percentual)}%` : "—"}
            </span>
            <div
              className="w-full bg-muted flex items-end"
              style={{ height: "3.5rem" }}
              title={`${p.periodo}: ${
                p.noLayout
                  ? `${numero(p.comValor)} de ${numero(p.entidadesNaVigencia)} com dado`
                  : "a coluna não veio nesta vigência"
              }`}
            >
              <div
                className={cn(
                  "w-full",
                  !p.noLayout
                    ? "bg-brand-red/30"
                    : p.percentual >= 100
                      ? "bg-success"
                      : p.percentual >= 50
                        ? "bg-warning"
                        : "bg-brand-red",
                )}
                style={{
                  height: p.noLayout ? `${(p.percentual / maximo) * 100}%` : "100%",
                }}
              />
            </div>
            <span className="text-[0.625rem] text-muted-foreground whitespace-nowrap">
              {p.periodo}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A cadeia inteira de um valor, do número ao arquivo. */
export function ProvenienciaPainel({ factId }: { factId: number }) {
  const consulta = useQuery({
    queryKey: ["coverage", "provenance", factId],
    queryFn: () => fetchJson<Proveniencia>(`/coverage/provenance/${factId}`),
    retry: false,
  });

  if (!consulta.data) return null;
  const p = consulta.data;

  return (
    <dl className="mt-4 text-xs grid gap-x-6 gap-y-1 sm:grid-cols-2">
      <Par termo="Valor" valor={p.isNull ? `ausente (${p.nullReason})` : (p.valor ?? "—")} />
      <Par termo="Atributo" valor={`${p.atributo.label} (${p.atributo.code})`} />
      <Par termo="Entidade" valor={`${p.entidade.identificador} · ${p.entidade.entityType}`} />
      <Par
        termo="Vigência"
        valor={`${p.vigencia.sourceLabel} · revisão ${p.vigencia.revision}`}
      />
      <Par termo="Escopo" valor={`${p.vigencia.scopeLabel} · ${p.vigencia.canal}`} />
      <Par
        termo="Célula"
        valor={`aba ${p.celula.aba}, linha ${p.celula.linha}, coluna ${p.celula.coluna}`}
      />
      <Par termo="Arquivo" valor={p.importacao.arquivo} />
      <Par termo="SHA-256" valor={p.importacao.contentSha256} />
      {p.herdadoDe && (
        <Par
          termo="Herdado de"
          valor={`${p.herdadoDe.sourceLabel} — o fato veio junto numa revisão parcial`}
        />
      )}
    </dl>
  );
}

function Par({ termo, valor }: { termo: string; valor: string }) {
  return (
    <div className="flex gap-2 min-w-0">
      <dt className="text-muted-foreground shrink-0">{termo}:</dt>
      <dd className="font-medium break-all">{valor}</dd>
    </div>
  );
}
