import { Activity, CircleDot } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_LABELS } from "@/components/changes/ticket-table";
import { cn } from "@/lib/utils";
import {
  diaDaOperacaoDe,
  diaLegivel,
  type AlteracaoDoChamado,
  type ChamadoNaFila,
} from "@/lib/monitoramento-de-chamados";

/**
 * CHAMADOS DO ENVIO — a relação que o arquivo trouxe.
 *
 * A lista irmã de `lista-de-movimentacoes.tsx`, e diferente dela no que mostra:
 * ali cada linha é um **antes → depois** apurado pelo motor; aqui cada linha é
 * o chamado como a planilha o escreveu, tenha ele se mexido ou não. Quem quiser
 * saber o que mudou troca de visão, e o selo "movimentou hoje" diz onde
 * procurar.
 *
 * Uma linha e não uma tabela, pela mesma razão da lista de movimentações: os
 * campos que importam variam por chamado — uns têm placa, outros têm cargo;
 * uns têm prazo, outros não — e uma tabela pagaria colunas vazias em todos
 * eles. A tabela larga do envio já existe, e é a da aba Chamados.
 *
 * ---------------------------------------------------------------------------
 * Por que a linha mostra tanto
 * ---------------------------------------------------------------------------
 *
 * Porque a pergunta desta visão é "o que veio no arquivo?", e uma linha que
 * responde com número, situação e assunto obriga quem confere a abrir a
 * planilha ao lado para todo o resto — que é justamente o trabalho que esta
 * tela existe para poupar. O export real tem 26 colunas; a linha mostra as que
 * identificam o chamado (quem pediu, quem opera, quem aprova), as quatro datas
 * que o domínio distingue e **o que foi pedido em cada parâmetro**, que é o
 * conteúdo do chamado e antes só aparecia como a contagem "1 parâmetro".
 *
 * Campo vazio não vira linha vazia: cada bloco só entra quando tem valor, pelo
 * mesmo motivo que a tira de identificação não escreve "• • •" — uma relação de
 * 1.218 linhas com buracos parece defeituosa quando está certa.
 *
 * Não há botão de revisar: revisão é ato sobre **movimentação**, e oferecer o
 * carimbo aqui criaria um segundo estado de "revisado" que a régua não conta —
 * dois números certos e a leitura errada.
 */
export function ListaDeChamados({
  chamados,
  carregando,
}: {
  chamados: ChamadoNaFila[];
  carregando: boolean;
}) {
  if (carregando && chamados.length === 0) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-xl border bg-card">
      {chamados.map((c) => (
        <li key={c.id} className="flex gap-4 px-4 py-4">
          <div
            className={cn(
              "h-9 w-9 rounded-lg grid place-content-center shrink-0",
              c.movimentou
                ? "bg-amber-50 text-amber-600"
                : "bg-muted text-muted-foreground",
            )}
            title={
              c.movimentou
                ? "este chamado se mexeu neste dia — veja o antes → depois em Movimentações"
                : "veio no arquivo e não mudou em relação à importação anterior"
            }
          >
            {c.movimentou ? (
              <Activity className="h-4 w-4" />
            ) : (
              <CircleDot className="h-4 w-4" />
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-bold text-primary tabular-nums">
                {c.externalId}
              </span>
              <span className="text-[10px] uppercase tracking-wide font-semibold rounded px-1.5 py-0.5 bg-muted text-muted-foreground">
                {c.statusRaw ?? STATUS_LABELS[c.statusBucket] ?? "sem status"}
              </span>
              {c.movimentou && (
                <span className="text-[10px] uppercase tracking-wide font-semibold rounded px-1.5 py-0.5 bg-amber-50 text-amber-700">
                  Movimentou hoje
                </span>
              )}
              {/*
                O assunto sem `truncate`: ele é a única frase que a fonte
                escreve sobre o chamado — em produção é a `Justificativa
                Abertura` — e cortá-la na largura do cartão para caber numa
                linha escondia justamente o que quem lê a relação procura.
              */}
              <span className="text-sm">
                {c.assunto ?? "Sem assunto no arquivo"}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {/*
                A tira de identificação: onde o chamado acontece, e sobre o quê.
                Os campos entram só quando existem, e o separador vem junto do
                campo — um "• • •" de campos vazios é o que faz uma lista de
                1.218 linhas parecer defeituosa quando ela está certa.
              */}
              {[
                c.unidade,
                c.area,
                c.entidade,
                c.categoria,
                `linha ${c.linhaDoArquivo} do arquivo`,
              ]
                .filter((campo): campo is string => Boolean(campo))
                /*
                  A chave carrega a posição porque dois campos podem trazer o
                  mesmo texto — uma unidade que se chama como a área, e a lista
                  passaria a ter chave repetida.
                */
                .map((campo, i) => (
                  <span key={`${i}-${campo}`} className="flex items-center gap-2">
                    {i > 0 && <span aria-hidden>•</span>}
                    <span>{campo}</span>
                  </span>
                ))}
            </div>

            {/*
              O `Item` inteiro, e só quando ele não é o que a tira já mostrou.

              Nas linhas de placa, `entidade` é a placa e este texto traz a
              carreta junto; nas de cargo, `entidade` **é** este texto, e
              repeti-lo faria a linha dizer duas vezes a mesma coisa.
            */}
            {c.item && c.item !== c.entidade && (
              <div className="text-xs text-muted-foreground">{c.item}</div>
            )}

            <Campos chamado={c} />

            {/*
              `?? []` porque a tela e o servidor não sobem no mesmo instante:
              durante um deploy, uma resposta gravada antes desta mudança chega
              sem o campo, e um `.length` em `undefined` aqui apagaria a lista
              inteira em vez de mostrar uma linha a menos.
            */}
            <Parametros alteracoes={c.alteracoes ?? []} total={c.parametros} />
          </div>

          <div className="shrink-0 text-right text-xs text-muted-foreground">
            {/*
              A situação do chamado, e não a hora do import: quem desce a
              relação está perguntando "este ainda está aberto?", e a hora do
              arquivo é a mesma em todas as 1.218 linhas.
            */}
            {c.encerradoEm ? (
              /*
                A data no fuso da operação, e não o recorte cru do ISO: um
                fechamento das 21h de 02/09 vira `2026-09-03` em UTC, e a linha
                mostraria o chamado encerrado um dia depois do que a Ambev
                escreveu. É a mesma conversão que a régua e a hora usam.
              */
              <span title="data de fechamento declarada no arquivo">
                encerrado em {diaLegivel(diaDaOperacaoDe(c.encerradoEm))}
              </span>
            ) : (
              <span className="text-amber-700">em aberto</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Os campos do arquivo, rotulados.
 *
 * Grade de rótulo sobre valor, e não mais uma tira de "•": estes campos não se
 * explicam sozinhos — três e-mails em sequência não dizem qual é o solicitante
 * e qual é o aprovador, e três datas em sequência não dizem qual é a abertura.
 * Sem o rótulo, mostrar mais informação deixaria a linha mais cheia e menos
 * legível, que é o oposto do pedido.
 *
 * As quatro datas do domínio aparecem com o nome que as distingue. `Aberto em`
 * é `Data Solicitação`; `Alterado na fonte` é `Data Alteração` — quando a
 * **Ambev** mexeu, e não quando **nós** lemos o arquivo, que é a régua de dias
 * lá em cima. Confundi-las é o defeito que esta tela existe para não cometer.
 */
function Campos({ chamado }: { chamado: ChamadoNaFila }) {
  const dataDoArquivo = (iso: string | null) =>
    iso ? diaLegivel(diaDaOperacaoDe(iso)) : null;

  const campos: { rotulo: string; valor: string | null; dica?: string }[] = [
    { rotulo: "Solicitante", valor: chamado.solicitante, dica: "quem abriu o chamado" },
    { rotulo: "Operador", valor: chamado.operador, dica: "quem toca o chamado" },
    {
      rotulo: "Responsável",
      valor: chamado.responsavel,
      dica: "o aprovador declarado no arquivo",
    },
    {
      rotulo: "Aberto em",
      valor: dataDoArquivo(chamado.abertoEm),
      dica: "Data Solicitação, como o arquivo a escreveu",
    },
    {
      rotulo: "Prazo previsto",
      valor: chamado.prazoPrevisto ? diaLegivel(chamado.prazoPrevisto) : null,
      dica: "Previsão Análise",
    },
    {
      rotulo: "Alterado na fonte",
      valor: dataDoArquivo(chamado.alteradoEmFonte),
      dica: "Data Alteração — quando a Ambev mexeu, não quando lemos o arquivo",
    },
    { rotulo: "Vigência", valor: chamado.vigencia, dica: "Vig. Abertura" },
    { rotulo: "SLA", valor: chamado.sla, dica: "SLA, como a fonte escreveu" },
  ].filter((c) => Boolean(c.valor));

  if (campos.length === 0) return null;

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-4">
      {campos.map((c) => (
        <div key={c.rotulo} className="min-w-0" title={c.dica}>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {c.rotulo}
          </dt>
          <dd className="truncate text-xs" title={c.valor ?? undefined}>
            {c.valor}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Quantos parâmetros a linha mostra antes de dizer só quantos faltam. */
const PARAMETROS_EM_TELA = 6;

/**
 * O que o chamado pediu, parâmetro a parâmetro.
 *
 * É o conteúdo do chamado, e era o que a linha mais escondia: "1 parâmetro"
 * dizia que havia algo a ver sem dizer o quê, e quem conferia tinha de abrir a
 * planilha para descobrir que o pedido era `quantidadeOrdenado: 4 → 7`.
 *
 * A alteração sem valores não é buraco: num export real a maioria não é `SET` —
 * é `FORM_THIS`, troca de fórmula, que muda a remuneração sem existir "de 10
 * para 12". Por isso a operação aparece ao lado do parâmetro, e o par de
 * valores só quando há par: uma seta com dois traços diria que o dado se
 * perdeu.
 */
function Parametros({
  alteracoes,
  total,
}: {
  alteracoes: AlteracaoDoChamado[];
  total: number;
}) {
  if (alteracoes.length === 0) {
    // Sem a relação, ainda há a contagem que o envio gravou — e ela é o que a
    // linha sempre mostrou. Some quando é zero: um "0 parâmetros" em toda linha
    // de um arquivo que não os traz é ruído em 1.218 linhas.
    if (total <= 0) return null;
    return (
      <div className="text-xs text-muted-foreground">
        {total} {total === 1 ? "parâmetro" : "parâmetros"}
      </div>
    );
  }

  const emTela = alteracoes.slice(0, PARAMETROS_EM_TELA);
  const restantes = alteracoes.length - emTela.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {emTela.map((a, i) => (
        <span
          key={`${i}-${a.parametro}`}
          className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs"
        >
          <span className="font-medium">{a.parametro}</span>
          {a.operacao && (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {a.operacao}
            </span>
          )}
          {temValores(a) && (
            <span className="tabular-nums text-muted-foreground">
              {a.de ?? "—"} <span aria-hidden>→</span> {a.para ?? "—"}
            </span>
          )}
        </span>
      ))}
      {restantes > 0 && (
        <span className="text-xs text-muted-foreground">
          + {restantes} {restantes === 1 ? "parâmetro" : "parâmetros"}
        </span>
      )}
    </div>
  );
}

/**
 * Há um par de valores para mostrar?
 *
 * O `-` do export conta como ausência: é como o Freightech escreve "não se
 * aplica" nas linhas que não são `SET`, e mostrá-lo como valor faria a linha
 * dizer "de - para -", que parece dado corrompido e não é.
 */
function temValores(a: AlteracaoDoChamado): boolean {
  const valor = (v: string | null) => v !== null && v.trim() !== "" && v.trim() !== "-";
  return valor(a.de) || valor(a.para);
}
