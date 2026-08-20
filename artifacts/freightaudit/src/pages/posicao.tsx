import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Numero } from "@/components/gerencial/executivo";
import { BlocoDoEquipamento } from "@/components/posicao/bloco";
import { fetchJson } from "@/lib/api";
import { lerRecorte, linkDaVisaoGeral, paramsDoRecorte } from "@/lib/recorte";
import { formatBrlCompacto, formatNumber, periodicitySuffix } from "@/lib/format";
import { porPeriodicidade, type PontaAPonta } from "@/lib/analise";
import { blocosDaPosicao, totaisDaPosicao } from "@/lib/posicao";

/**
 * Posição — como estava a remuneração no início do período e como está hoje.
 *
 * **A pergunta é do dono da operação, e não tinha tela.** Quem responde pela
 * unidade não quer o extrato do ano: quer o saldo. "O que mexeu entre março e
 * abril" é a pergunta do auditor, e Alterações e Acompanhamento já a servem. Esta
 * responde outra — *o que está diferente hoje do que estava em janeiro, variável
 * a variável* —, e a diferença entre as duas não é de apresentação: um valor que
 * subiu e voltou é duas alterações lá e nada aqui, e as duas contas estão certas.
 *
 * **Esta tela não é a decomposição do cartão anual.** O cartão da Visão Gerencial
 * soma `impacto_oficial_by_periodicity` gravado por comparação canônica; esta lê
 * `GET /changes/end-to-end`, que compara dois snapshots em memória e não grava
 * nada. Somar uma para chegar à outra é impossível por construção — entrou frota
 * no caminho, houve ida e volta —, e por isso a tela **não usa a palavra
 * "alterações"** para o que publica. Ela publica posição.
 *
 * Cinco decisões que o desenho materializa, e as razões de cada uma:
 *
 * 1. **O bloco é o equipamento; a linha é o atributo.** O parâmetro não serve de
 *    linha porque atravessa tipos — `carreta.custo_aluguel` e
 *    `cavalo.custo_aluguel` moram na mesma gaveta —, e um rollup dele não caberia
 *    em bloco nenhum. O parâmetro fica como agrupador visual dentro do bloco.
 * 2. **Nenhum número de dinheiro é calculado aqui.** Cada linha traz o impacto
 *    oficial que a autoridade apurou para as linhas dela, por periodicidade. A
 *    tela não soma linhas, não soma blocos e não soma periodicidades: a exclusão
 *    por dupla contagem é por ativo e olha para fora do par, e uma soma feita
 *    aqui produziria um número plausível que a autoridade não assinou.
 * 3. **Delta zero nunca esconde movimento.** O que voltou ao valor inicial tem
 *    linha própria, marcada, com as vigências em que se mexeu. Sem isso a leitura
 *    de posição apagaria sozinha exactamente o que ela deveria denunciar.
 * 4. **Conjunto não é bloco, é selo.** O valor que cobre cavalo e carreta juntos
 *    aparece na linha com o motivo da exclusão vindo do deduplicador — nunca uma
 *    segunda leitura da regra, nunca um sexto bloco que contaria o mesmo dinheiro
 *    outra vez.
 * 5. **"Não mudou" não é "conferido".** Esta primeira versão mostra apenas os
 *    atributos que mudaram, e diz isso: o contador do bloco é "X de Y", com Y
 *    saído do universo canônico do recorte. Um bloco que pintasse de verde o que
 *    não mexeu afirmaria uma conferência que ninguém fez.
 */
export default function Posicao() {
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const recorte = useMemo(() => lerRecorte(params), [params]);
  const de = params.get("de");
  const ate = params.get("ate");

  const consulta = useMemo(() => {
    const q = paramsDoRecorte(recorte, { comPeriodo: false });
    if (de !== null) q.set("from", de);
    if (ate !== null) q.set("to", ate);
    return q.toString();
  }, [recorte, de, ate]);

  const ponta = useQuery({
    queryKey: ["posicao", consulta],
    queryFn: () => fetchJson<PontaAPonta>(`/changes/end-to-end?${consulta}`),
  });

  const dados = ponta.data;
  const impactos = porPeriodicidade(dados?.impact.byPeriodicity ?? {});
  const dominante = impactos[0] ?? null;

  const { blocos, semEquipamento } = useMemo(
    () => blocosDaPosicao(dados?.universo ?? [], dados?.byAttribute ?? []),
    [dados],
  );
  const totais = useMemo(() => totaisDaPosicao(dados?.universo ?? []), [dados]);

  return (
    <Layout>
      <header className="border-b bg-card">
        <div className="px-8 py-6">
          <Link
            href={linkDaVisaoGeral({ ...recorte, period: null })}
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" />
            Visão Gerencial
          </Link>
          <h1 className="text-2xl font-bold mt-2">Posição da remuneração</h1>
          {dados && (
            <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
              Como estava em {dados.fromLabel} e como está em {dados.toLabel},
              parâmetro a parâmetro. É posição, e não movimento: o que subiu e
              voltou aparece sem diferença, com a marca de que houve mexida no
              caminho.
            </p>
          )}
        </div>
      </header>

      <div className="p-8 space-y-6">
        {ponta.isError && (
          <ApiErrorNotice
            error={ponta.error}
            what="A posição desta unidade não pôde ser carregada."
          />
        )}
        {ponta.isLoading && (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}

        {dados && (
          <>
            <div className="rounded-lg border bg-card">
              <div className="flex flex-wrap divide-x divide-y sm:divide-y-0">
                <Numero
                  rotulo="Parâmetros diferentes"
                  valor={`${formatNumber(totais.alterados, 0)} de ${formatNumber(totais.atributos, 0)}`}
                  detalhe={
                    totais.atributos === 0
                      ? "nenhum atributo no universo desta unidade"
                      : `continuam diferentes da ponta inicial · ${formatNumber(totais.atributos, 0)} atributos no universo do recorte`
                  }
                />
                <Numero
                  rotulo="Voltaram ao inicial"
                  valor={formatNumber(totais.revertidos, 0)}
                  detalhe={
                    totais.revertidos === 0
                      ? "nada mexeu e voltou no caminho"
                      : "mexeram no caminho e hoje estão como estavam"
                  }
                />
                <Numero
                  rotulo="Ativos nas duas pontas"
                  valor={formatNumber(dados.entitiesCompared, 0)}
                  detalhe={`${dados.fleet.added} ${dados.fleet.added === 1 ? "entrou" : "entraram"}, ${dados.fleet.removed} ${dados.fleet.removed === 1 ? "saiu" : "saíram"} — fora do dinheiro, sempre`}
                />
                <Numero
                  rotulo="Impacto da posição"
                  valor={dominante === null ? "—" : formatBrlCompacto(dominante.amount)}
                  sufixo={
                    dominante === null
                      ? undefined
                      : periodicitySuffix(dominante.periodicity)
                  }
                  detalhe={
                    dominante === null
                      ? "nada apurável entre as duas pontas"
                      : impactos.length === 1
                        ? "o dinheiro contado uma vez só, já deduplicado"
                        : `e mais ${impactos.length - 1} periodicidade${impactos.length === 2 ? "" : "s"} — nunca somadas entre si`
                  }
                />
              </div>
            </div>

            {/*
              Os cinco tipos aparecem sempre, e na mesma ordem. Um que não tenha
              dado nesta unidade diz isso — sumir seria deixar quem lê concluir
              que a unidade não tem trechos, quando o que não há é export.
            */}
            <div className="space-y-6">
              {blocos.map((bloco) => (
                <BlocoDoEquipamento
                  key={bloco.tipo.entityType}
                  tipo={bloco.tipo}
                  universo={bloco.universo}
                  linhas={bloco.linhas}
                />
              ))}
            </div>

            {semEquipamento.length > 0 && (
              <p className="text-sm text-muted-foreground max-w-3xl">
                {formatNumber(semEquipamento.length, 0)}{" "}
                {semEquipamento.length === 1
                  ? "parâmetro está diferente e não declara equipamento"
                  : "parâmetros estão diferentes e não declaram equipamento"}
                , então não cabem em bloco nenhum:{" "}
                {semEquipamento.map((l) => l.title).join(", ")}. É defeito de
                classificação na origem, e fica escrito em vez de sumir.
              </p>
            )}

            <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground space-y-3 max-w-4xl">
              <h2 className="text-base font-bold text-foreground">
                O que esta tela conta
              </h2>
              <p>
                <strong className="text-foreground">Posição, e não movimento.</strong>{" "}
                Cada linha compara o valor de {dados.fromLabel} com o de{" "}
                {dados.toLabel}, ativo a ativo, sobre quem está nas duas pontas.
                Entrada e saída de frota ficam num eixo próprio: frota maior não é
                preço maior.
              </p>
              <p>
                <strong className="text-foreground">
                  Isto não é a decomposição do cartão anual.
                </strong>{" "}
                O cartão soma o movimento de cada vigência; esta tela mede a
                distância entre duas pontas. Um valor que subiu e voltou conta lá
                duas vezes e aqui nenhuma — as duas contas estão certas, e nenhuma
                se deriva da outra.
              </p>
              <p>
                <strong className="text-foreground">
                  Só aparece o que ficou diferente.
                </strong>{" "}
                Esta primeira versão lista os atributos que mudaram e os que
                voltaram ao valor inicial. Um atributo que não se mexeu não está
                aqui — e isso não quer dizer que ele foi conferido, apenas que a
                posição dele não mudou. Quanto ao dado existir ou não, quem
                responde é{" "}
                <Link href="/dados" className="text-primary hover:underline">
                  Cobertura de dados
                </Link>
                .
              </p>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
