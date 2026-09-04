import {
  AlertTriangle,
  Building2,
  Clock,
  FileSpreadsheet,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResumoDoDia } from "@/lib/monitoramento-de-chamados";

/**
 * O RESUMO DO DIA — o painel da direita.
 *
 * Não é a duplicação dos cartões: os cartões dizem **quanto**, e este painel diz
 * **onde olhar primeiro**. Por isso ele mostra o que os cartões não mostram —
 * os pontos de atenção e a concentração por unidade.
 *
 * **Todo número aqui vem do resumo do servidor.** Nenhum é contado na tela, e
 * nenhum tem valor de reserva: uma linha sem dado não aparece, em vez de
 * aparecer com zero. Um zero inventado num painel de atenção é a pior espécie de
 * número — ele afirma que se procurou e não se achou.
 *
 * ---------------------------------------------------------------------------
 * O painel só existe quando há delta
 * ---------------------------------------------------------------------------
 *
 * Ele é o painel do **que mudou**, e tudo aqui dentro sai da mesma tabela de
 * movimentações do dia: os dois números grandes, os pontos de atenção, a
 * concentração por unidade. Num dia sem movimentação — que é a maioria dos
 * dias — isso deixava em tela "0 movimentações" e "0 aguardando revisão", que
 * são exatamente os zeros de que os três cartões do topo foram livrados quando
 * passaram a contar aprovados, em análise e reprovados; e embaixo deles a
 * única linha com número, "1.218 chamados vieram no arquivo deste dia", já
 * estava dita duas vezes na mesma tela — na tira sob os cartões e na frase da
 * importação.
 *
 * Então, sem movimentação, o painel não é montado: `temResumoDoDia` responde
 * por ele, e a tela inteira fica na largura cheia. O que sobrevive é o aviso da
 * importação, que existe sem movimentação nenhuma e não está dito em outro
 * lugar — ele sai pela faixa dos complementos.
 *
 * **Enquanto o dia não chegou, nada aqui é desenhado** — nem esqueleto. A
 * existência deste painel depende do número que ainda está vindo, e um
 * esqueleto seria a tela prometendo um painel que, na maioria dos dias, não vai
 * existir. É a mesma regra do resto do módulo: durante a espera não se afirma.
 */

/**
 * Se há painel a montar: o dia tem movimentação.
 *
 * A pergunta é do lado de fora porque a resposta muda a **grade** da página, e
 * não só o conteúdo de uma coluna — sem painel não há segunda coluna, e o que
 * dela dependia (o `col-span-2` da faixa e o da lista) deixa de valer junto.
 */
export function temResumoDoDia(resumo: ResumoDoDia | null): boolean {
  return resumo !== null && resumo.movimentacoes > 0;
}

/**
 * As duas partes do painel, e por que ele sabe se partir.
 *
 * O cartão do topo tem a altura do cabeçalho ao lado dele; os outros três
 * crescem com o dia — quatro pontos de atenção, oito unidades — e é essa cauda
 * que, numa coluna de 320px, descia muito abaixo dos cartões e deixava um
 * buraco branco à esquerda dela. Partido, o resumo fica onde sempre esteve e a
 * cauda vira uma faixa larga acima da lista, com o mesmo conteúdo.
 */
export type ParteDoResumo = "tudo" | "principal" | "complementos";

/** Se há cauda a mostrar — quem monta a faixa pergunta antes de criá-la. */
export function temComplementos(resumo: ResumoDoDia | null): boolean {
  if (resumo === null) return false;
  const { criticos, atrasados, prazosAlterados, trocasDeResponsavel } =
    resumo.pontosDeAtencao;
  return (
    criticos + atrasados + prazosAlterados + trocasDeResponsavel > 0 ||
    resumo.porUnidade.length > 0 ||
    resumo.avisos.length > 0
  );
}

export function ResumoDoDiaPainel({
  resumo,
  parte = "tudo",
}: {
  resumo: ResumoDoDia | null;
  parte?: ParteDoResumo;
}) {
  if (resumo === null) return null;

  const { pontosDeAtencao: pontos, porUnidade } = resumo;
  const maior = porUnidade[0]?.total ?? 0;

  /*
    Os quatro pontos de atenção, e a razão de cada um estar aqui.

    `criticos` e `atrasados` são **derivados por nós** — nenhuma das 26 colunas
    do export da Ambev é prioridade —, e por isso carregam a frase que diz de
    onde vieram. Sem ela a tela afirmaria uma classificação que a fonte não fez.
    Os outros dois são fatos da fonte: um prazo mudou, ou um responsável mudou.
  */
  const atencao = [
    {
      chave: "criticos",
      total: pontos.criticos,
      texto: pontos.criticos === 1 ? "chamado crítico" : "chamados críticos",
      cor: "bg-red-500",
      titulo:
        "Criticidade derivada por nós: prazo vencido em chamado aberto, ou prazo remarcado duas vezes no mesmo dia. A Ambev não envia prioridade.",
    },
    {
      chave: "atrasados",
      total: pontos.atrasados,
      texto: pontos.atrasados === 1 ? "atrasado" : "atrasados",
      cor: "bg-orange-500",
      titulo:
        "Prazo previsto (coluna Previsão Análise) já vencido, com o chamado ainda em aberto. Cálculo nosso.",
    },
    {
      chave: "prazos",
      total: pontos.prazosAlterados,
      texto: pontos.prazosAlterados === 1 ? "prazo alterado" : "prazos alterados",
      cor: "bg-blue-500",
      titulo: "Movimentações em que a Previsão Análise mudou.",
    },
    {
      chave: "responsavel",
      total: pontos.trocasDeResponsavel,
      texto:
        pontos.trocasDeResponsavel === 1
          ? "troca de responsável"
          : "trocas de responsável",
      cor: "bg-amber-500",
      titulo: "Movimentações em que o Aprovador mudou.",
    },
  ].filter((p) => p.total > 0);

  /*
    Empilhado na coluna, lado a lado na faixa.

    Uma coluna por cartão, e não um número fixo delas: os complementos são dois
    ou três conforme o dia — os avisos da importação só existem quando há algo
    a avisar —, e `grid-cols-3` deixaria a terceira vazia justamente nos dias
    de dois. `items-start` porque os cartões têm alturas diferentes e esticar o
    mais curto até o mais alto só produz um cartão com um vão dentro.
  */
  const moldura =
    parte === "complementos"
      ? "grid gap-4 items-start sm:grid-flow-col sm:auto-cols-fr"
      : "space-y-4";

  return (
    <div className={moldura}>
      {parte !== "complementos" && (
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Resumo do dia
          </h3>

          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-blue-50 text-blue-600 grid place-content-center shrink-0">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-2xl font-bold tabular-nums leading-none">
                {resumo.movimentacoes}
              </div>
              <div className="text-sm text-muted-foreground">
                {resumo.movimentacoes === 1 ? "movimentação" : "movimentações"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div
              className={cn(
                "h-11 w-11 rounded-xl grid place-content-center shrink-0",
                resumo.pendentes > 0
                  ? "bg-red-50 text-red-600"
                  : "bg-emerald-50 text-emerald-600",
              )}
            >
              <Clock className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div
                className={cn(
                  "text-2xl font-bold tabular-nums leading-none",
                  resumo.pendentes > 0 ? "text-red-600" : "text-emerald-700",
                )}
              >
                {resumo.pendentes}
              </div>
              <div className="text-sm text-muted-foreground">aguardando revisão</div>
            </div>
          </div>

          {/*
            O tamanho da fila, separado dos dois de cima por uma linha — e a
            separação é a informação.

            Movimentação e chamado são grãos diferentes, e este painel nunca os
            soma: os dois números grandes contam **o que se mexeu**, e este conta
            **o que veio no arquivo**. Ele está aqui porque, sem ele, um dia sem
            movimentação mostrava "0" e "0" um embaixo do outro e se lia como "o
            import não trouxe nada" — enquanto o arquivo daquela manhã tinha
            trazido a fila inteira.

            Some quando não há contagem: uma linha dizendo "0 chamados" seria
            justamente a afirmação errada que ela existe para desfazer.
          */}
          {resumo.chamadosNoEnvio > 0 && (
            <div
              className="flex items-center gap-2.5 border-t pt-4 text-sm text-muted-foreground"
              title="Os chamados que a planilha importada trouxe neste dia, tenham se mexido ou não. Não soma com as movimentações — é a população de onde elas saem."
            >
              <FileSpreadsheet className="h-4 w-4 shrink-0" />
              <span>
                <span className="font-semibold tabular-nums text-foreground">
                  {resumo.chamadosNoEnvio.toLocaleString("pt-BR")}
                </span>{" "}
                {resumo.chamadosNoEnvio === 1 ? "chamado veio" : "chamados vieram"} no
                arquivo deste dia
              </span>
            </div>
          )}
        </div>
      )}

      {parte !== "principal" && atencao.length > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3">
            Pontos de atenção
          </h3>
          <ul className="space-y-2">
            {atencao.map((p) => (
              <li key={p.chave} className="flex items-center gap-2.5 text-sm" title={p.titulo}>
                <span className={cn("h-2 w-2 rounded-full shrink-0", p.cor)} />
                <span className="font-semibold tabular-nums">{p.total}</span>
                <span className="text-muted-foreground">{p.texto}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            Crítico e atrasado são <strong>calculados por nós</strong> a partir do
            prazo — a Ambev não envia prioridade nos chamados.
          </p>
        </div>
      )}

      {parte !== "principal" && porUnidade.length > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3">
            Maior movimentação por unidade
          </h3>
          <ul className="space-y-3">
            {porUnidade.map((u) => (
              <li key={u.unidade ?? "sem-unidade"}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate flex items-center gap-1.5">
                    {u.unidade === null && (
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    {/* A unidade é o texto do arquivo, não o cadastro canônico —
                        e a ausência dela é um estado, não um espaço em branco. */}
                    {u.unidade ?? "Sem unidade no arquivo"}
                  </span>
                  <span className="font-semibold tabular-nums shrink-0">{u.total}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${maior === 0 ? 0 : (u.total / maior) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {parte !== "principal" && resumo.avisos.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <h3 className="text-sm font-bold text-amber-800">Sobre a importação</h3>
          </div>
          <ul className="space-y-2">
            {resumo.avisos.map((a, i) => (
              <li key={`${a.tipo}-${i}`} className="text-xs leading-snug text-amber-900">
                {a.texto}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
