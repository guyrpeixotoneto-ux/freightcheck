import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, Rows3, X } from "lucide-react";
import { Link } from "wouter";
import { fetchJson } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Lacunas } from "./lacunas";
import { caminhoDaFicha, tituloDaPlacaAusente } from "./ficha-da-entidade";
import {
  numero,
  percentual,
  type DetalheDaCelula,
  type Lacuna,
  type Proveniencia,
} from "./tipos";

/**
 * O terceiro degrau: o detalhe de um conjunto numa vigência.
 *
 * A hierarquia da tela é resumo → matriz → exceções → detalhe, e este painel é
 * o penúltimo. Ele só existe depois de um clique — nada disto é carregado com a
 * página, porque quase ninguém desce até aqui e quem desce quer uma coisa
 * específica.
 *
 * O último degrau — um atributo, numa vigência — saiu daqui para `gaveta.tsx`,
 * e virou painel lateral. A razão está escrita lá: a informação é sobre uma
 * célula, e uma seção que nascia abaixo da matriz tirava a célula clicada do
 * campo de visão exatamente quando ela precisava continuar à vista.
 */

export function DetalheDaCelulaPainel({
  snapshotId,
  entityType,
  atributosAbertos,
  aoVerAtributos,
  aoFechar,
  aoAbrirLacuna,
}: {
  snapshotId: string;
  entityType: string;
  /** A linha deste conjunto já está aberta por dentro, lá na matriz? */
  atributosAbertos: boolean;
  aoVerAtributos: () => void;
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
        <div className="flex items-center gap-3 shrink-0">
          {/*
            A ponte de volta para a matriz.

            Este painel responde "quanto falta nesta vigência" e lista as
            lacunas dela. A pergunta que ele levanta e não responde é se a mesma
            lacuna está nas vigências vizinhas — e essa é uma leitura de linha,
            não de célula. Em vez de repetir aqui uma tabela que a matriz já
            sabe desenhar alinhada às suas colunas, o botão abre a linha lá.
          */}
          <button
            type="button"
            onClick={aoVerAtributos}
            aria-pressed={atributosAbertos}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-brand text-brand hover:bg-brand/10 whitespace-nowrap"
          >
            <Rows3 className="w-3.5 h-3.5" aria-hidden />
            {atributosAbertos ? "Fechar os atributos" : "Ver atributo por atributo"}
          </button>
          <button
            type="button"
            onClick={aoFechar}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Fechar o detalhe"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
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
                    <li key={e.entityId}>
                      {/*
                        O mesmo destino da gaveta: a ficha na última vigência em
                        que a placa existiu. Ver `LinkParaAFicha` em `gaveta.tsx`
                        para por que não é a vigência desta célula.
                      */}
                      <Link
                        href={caminhoDaFicha(e, {
                          effectiveDate: consulta.data!.vigencia.effectiveDate,
                          scopeHash: consulta.data!.scopeHash,
                          canal: consulta.data!.canal,
                        })}
                        title={tituloDaPlacaAusente(e)}
                        className="flex justify-between gap-2 hover:text-brand transition-colors"
                      >
                        <span className="truncate font-mono">{e.rotulo}</span>
                        <span className="text-muted-foreground tabular-nums shrink-0">
                          {e.ultimaVigencia === null ? "nunca veio" : `até ${e.ultimaVigencia}`}
                        </span>
                      </Link>
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
