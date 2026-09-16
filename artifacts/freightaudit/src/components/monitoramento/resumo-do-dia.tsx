import { AlertTriangle, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  avisosPorDizer,
  type ResumoDoDia,
} from "@/lib/monitoramento-de-chamados";

/**
 * O RESUMO DO DIA — a faixa larga logo acima da relação.
 *
 * Não é a duplicação dos cartões: os cartões dizem **quanto**, e esta faixa diz
 * **onde olhar primeiro**. Por isso ela mostra o que os cartões não mostram —
 * os pontos de atenção, a concentração por unidade e o que houve de estranho na
 * importação.
 *
 * **Todo número aqui vem do resumo do servidor.** Nenhum é contado na tela, e
 * nenhum tem valor de reserva: uma linha sem dado não aparece, em vez de
 * aparecer com zero. Um zero inventado num painel de atenção é a pior espécie de
 * número — ele afirma que se procurou e não se achou.
 *
 * ---------------------------------------------------------------------------
 * Ela já foi uma coluna de 320px, e já teve um cartão a mais
 * ---------------------------------------------------------------------------
 *
 * O painel morava à direita da tela e abria com um cartão "Resumo do dia": o
 * total de movimentações e o tamanho do envio. Os dois números subiram para o
 * topo — as movimentações viraram o quarto cartão, e o tamanho do envio é o que
 * a taxa de aprovação cita —, e repeti-los aqui seria dar a eles um segundo
 * lugar de onde divergir.
 *
 * O que sobrou é o que sempre foi próprio daqui, e cresce com o dia: quatro
 * pontos de atenção, oito unidades, os avisos da importação. Numa coluna
 * estreita isso descia muito abaixo do resto e deixava um buraco branco ao
 * lado; na faixa larga a mesma cauda cabe em duas ou três colunas, imediatamente
 * acima da lista — que é de onde se olha para ela.
 *
 * **Enquanto o dia não chegou, nada aqui é desenhado** — nem esqueleto. É a
 * regra do módulo: durante a espera não se afirma.
 */

/** Se há o que mostrar — quem monta a faixa pergunta antes de criá-la. */
export function temComplementos(resumo: ResumoDoDia | null): boolean {
  if (resumo === null) return false;
  const { criticos, atrasados, prazosAlterados, trocasDeResponsavel } =
    resumo.pontosDeAtencao;
  return (
    criticos + atrasados + prazosAlterados + trocasDeResponsavel > 0 ||
    resumo.porUnidade.length > 0 ||
    avisosPorDizer(resumo).length > 0
  );
}

export function ResumoDoDiaPainel({ resumo }: { resumo: ResumoDoDia | null }) {
  if (resumo === null) return null;

  const { pontosDeAtencao: pontos, porUnidade } = resumo;
  /*
    Os avisos que a frase do dia ainda não disse — ver `avisosPorDizer`. Sem
    isso, a primeira carga escrevia o mesmo parágrafo duas vezes seguidas: uma
    na faixa azul acima, outra aqui em âmbar.
  */
  const avisos = avisosPorDizer(resumo);
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
    Um cartão por coluna, e não um número fixo delas: os complementos são dois
    ou três conforme o dia — os avisos da importação só existem quando há algo
    a avisar —, e `grid-cols-3` deixaria a terceira vazia justamente nos dias
    de dois. `items-start` porque os cartões têm alturas diferentes e esticar o
    mais curto até o mais alto só produz um cartão com um vão dentro.
  */
  return (
    <div className="grid gap-4 items-start sm:grid-flow-col sm:auto-cols-fr">
      {atencao.length > 0 && (
        <div className="superficie p-5">
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

      {porUnidade.length > 0 && (
        <div className="superficie p-5">
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

      {avisos.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <h3 className="text-sm font-bold text-amber-800">Sobre a importação</h3>
          </div>
          <ul className="space-y-2">
            {avisos.map((a, i) => (
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
