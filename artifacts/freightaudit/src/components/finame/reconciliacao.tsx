import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import type {
  DegrauDaReconciliacao,
  ReconciliacaoPorPeriodicidade,
} from "@workspace/comparison/reconciliacao-de-finame";
import { formatBrl, formatNumber } from "@/lib/format";
import { ROTULO_DO_TIPO, corDaDiferenca, escreverDiferenca } from "@/lib/finame";
import {
  Tooltip as Dica,
  TooltipContent as DicaConteudo,
  TooltipTrigger as DicaGatilho,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * A RECONCILIAÇÃO — o painel que liga o cartão do topo ao saldo da frota.
 *
 * ---------------------------------------------------------------------------
 * Por que ele existe
 * ---------------------------------------------------------------------------
 * A tela publicava −R$ 17.171,54 no cartão "Impacto financeiro" e +R$ 90.844,71
 * no painel da evolução, a um palmo um do outro, e explicava a distância com
 * uma **observação**: "os dois somam coisas diferentes". A observação era
 * verdadeira e não servia para conferir nada — quem fecha o mês precisa sair do
 * número do topo e chegar ao de baixo somando linhas, e abrir cada linha até a
 * placa quando ela não convencer.
 *
 * ---------------------------------------------------------------------------
 * O que este componente **não** faz
 * ---------------------------------------------------------------------------
 * Conta. Nenhuma soma acontece aqui: os degraus chegam prontos de
 * `reconciliarFiname`, com valor, contagem e abertura, e o que este arquivo
 * decide é indentação, cor e qual linha é clicável. Somar na tela seria a
 * terceira régua da mesma pergunta — e a terceira a discordar das outras duas.
 *
 * ---------------------------------------------------------------------------
 * As decisões de leitura
 * ---------------------------------------------------------------------------
 * **Os saldos são níveis, os demais são movimentos.** Os dois níveis ficam em
 * negrito, com régua acima e abaixo; os movimentos, indentados e com sinal
 * sempre escrito. Quem lê de cima para baixo soma a coluna e chega ao saldo
 * final, sem trocar sinal no meio: a saída de frota é negativa **e escrita
 * negativa**, que é a convenção da escada inteira.
 *
 * **"Diferença não explicada" aparece mesmo valendo zero** — e é a única linha
 * que muda de cor quando deixa de valer. Escondê-la quando é zero faria a tela
 * não ter onde escrever o dia em que ela não for: o resíduo apareceria como uma
 * escada que simplesmente não fecha, sem nome e sem dono.
 *
 * **Cada degrau abre no lugar.** Placa, rubrica, valor na vigência base, valor
 * na comparada e a contribuição assinada — que é o que transforma o número em
 * algo que se confere contra a planilha.
 */
export function ReconciliacaoDoImpacto({
  reconciliacao,
  rotuloBase,
  rotuloComparada,
}: {
  reconciliacao: ReconciliacaoPorPeriodicidade[];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  return (
    <section className="superficie flex min-w-0 flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-bold">Reconciliação do impacto</h3>
        <p className="text-xs text-muted-foreground">
          Do saldo de {rotuloBase} ao de {rotuloComparada}, linha a linha. O cartão
          “Impacto financeiro” é o segundo degrau; o saldo de baixo é o mesmo do painel
          “Evolução entre as duas vigências”. Nenhuma diferença fica fora de uma linha
          com nome.
        </p>
      </div>

      {reconciliacao.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Sem leitura para reconciliar neste recorte.
        </p>
      ) : (
        reconciliacao.map((p) => (
          <EscadaDaPeriodicidade
            key={p.periodicidade}
            escada={p}
            rotuloBase={rotuloBase}
            rotuloComparada={rotuloComparada}
            /* Uma periodicidade só não precisa se anunciar: o cabeçalho já diz
               qual é, no rodapé, e um título "MENSAL" sozinho sugeriria que há
               outro balde escondido em algum lugar. */
            comTitulo={reconciliacao.length > 1}
          />
        ))
      )}
    </section>
  );
}

const ROTULO_DA_PERIODICIDADE: Record<string, string> = {
  MENSAL: "Mensal",
  ANUAL: "Anual",
  PONTUAL: "Aquisição (valor único)",
  SEM_PERIODICIDADE: "Sem periodicidade declarada",
};

function EscadaDaPeriodicidade({
  escada,
  rotuloBase,
  rotuloComparada,
  comTitulo,
}: {
  escada: ReconciliacaoPorPeriodicidade;
  rotuloBase: string;
  rotuloComparada: string;
  comTitulo: boolean;
}) {
  const [aberto, setAberto] = useState<string | null>(null);
  const nome = ROTULO_DA_PERIODICIDADE[escada.periodicidade] ?? escada.periodicidade;

  return (
    <div className="flex flex-col gap-1.5">
      {comTitulo && (
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {nome}
          {!escada.temSaldo && " · sem saldo de frota nesta periodicidade"}
        </h4>
      )}

      <ul className="flex flex-col">
        {escada.degraus.map((d) => (
          <Fragment key={d.chave}>
            <li>
              <LinhaDoDegrau
                degrau={d}
                aberto={aberto === d.chave}
                onAbrir={() => setAberto(aberto === d.chave ? null : d.chave)}
              />
            </li>
            {aberto === d.chave && (
              <li>
                <AberturaDoDegrau
                  degrau={d}
                  rotuloBase={rotuloBase}
                  rotuloComparada={rotuloComparada}
                />
              </li>
            )}
          </Fragment>
        ))}
      </ul>

      <p
        className={cn(
          "text-[0.7rem]",
          escada.fecha ? "text-muted-foreground" : "text-destructive",
        )}
      >
        {escada.fecha ? (
          escada.temSaldo ? (
            <>
              Fecha: saldo de {rotuloBase} mais os movimentos é exatamente o saldo de{" "}
              {rotuloComparada}.
            </>
          ) : (
            <>
              Não há total de frota nesta periodicidade — a parcela é de outra. O que se
              moveu aqui está dito acima, com o módulo que o soma.
            </>
          )
        ) : (
          <>
            <TriangleAlert aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
            A escada não fechou: sobram {formatBrl(escada.residuo)}. Confira a linha
            “Diferença não explicada”.
          </>
        )}
        {escada.semEfeitoFinanceiro > 0 && (
          <>
            {" "}
            {formatNumber(escada.semEfeitoFinanceiro, 0)}{" "}
            {escada.semEfeitoFinanceiro === 1 ? "alteração" : "alterações"} sem efeito
            financeiro (prazo, taxa, datas) ficaram de fora — contadas, nunca somadas.
          </>
        )}
        {escada.naoPrecificadas > 0 && (
          <>
            {" "}
            {formatNumber(escada.naoPrecificadas, 0)} em dinheiro que o motor não soube
            precificar não entrou em degrau nenhum.
          </>
        )}
      </p>
    </div>
  );
}

function LinhaDoDegrau({
  degrau: d,
  aberto,
  onAbrir,
}: {
  degrau: DegrauDaReconciliacao;
  aberto: boolean;
  onAbrir: () => void;
}) {
  const nivel = d.tipo === "NIVEL";
  const subtotal = d.tipo === "SUBTOTAL";
  const alerta = d.chave === "NAO_EXPLICADO" && Math.abs(d.valor) >= 0.01;
  const podeAbrir = d.itens.length > 0;

  return (
    <Dica>
      <DicaGatilho asChild>
        <button
          type="button"
          disabled={!podeAbrir}
          onClick={onAbrir}
          aria-expanded={podeAbrir ? aberto : undefined}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
            podeAbrir && "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            nivel && "border-y bg-muted/40 font-semibold",
            subtotal && "border-t border-dashed font-semibold",
            alerta && "bg-destructive/10",
          )}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
            {podeAbrir &&
              (aberto ? (
                <ChevronDown aria-hidden="true" className="h-4 w-4" />
              ) : (
                <ChevronRight aria-hidden="true" className="h-4 w-4" />
              ))}
          </span>
          <span className={cn("min-w-0 flex-1 text-xs", !nivel && !subtotal && "pl-3")}>
            {/*
              Os movimentos não levam operador antes do rótulo, e os saldos e o
              subtotal levam.

              A primeira versão escrevia "− Alterações em veículos comparados …
              −R$ 17.171,54", com o sinal duas vezes na mesma linha — e um "−"
              antes de um número já negativo se lê como subtração de uma perda.
              O valor assinado basta: é a convenção da escada inteira, e é o que
              permite somar a coluna de cima para baixo sem converter nada.
            */}
            {subtotal && (
              <span aria-hidden="true" className="mr-1 text-muted-foreground">
                =
              </span>
            )}
            {d.rotulo}
          </span>
          <span
            className={cn(
              "shrink-0 font-mono text-xs tabular-nums",
              nivel ? "" : corDaDiferenca(d.valor, "DINHEIRO"),
              alerta && "text-destructive",
            )}
          >
            {nivel ? formatBrl(d.valor) : escreverDiferenca(d.valor, "DINHEIRO")}
          </span>
          <span className="w-20 shrink-0 text-right font-mono text-[0.7rem] text-muted-foreground">
            {d.veiculos > 0 ? `${formatNumber(d.veiculos, 0)} veíc.` : ""}
          </span>
        </button>
      </DicaGatilho>
      <DicaConteudo className="max-w-xs">
        {d.explicacao}
        {podeAbrir && " Clique para abrir por placa."}
      </DicaConteudo>
    </Dica>
  );
}

/** A abertura de um degrau — placa, rubrica e as duas vigências. */
function AberturaDoDegrau({
  degrau: d,
  rotuloBase,
  rotuloComparada,
}: {
  degrau: DegrauDaReconciliacao;
  rotuloBase: string;
  rotuloComparada: string;
}) {
  /*
    Uma abertura longa é cortada, e o corte é dito.

    O saldo de uma ponta tem uma linha por veículo do acervo — 133 no par que
    originou este painel. Listar as 133 dentro de uma escada empurraria os
    degraus de baixo para fora da tela, e quem quer as 133 tem a tabela e o CSV
    logo abaixo. O que a abertura precisa provar é que o número tem lastro, e
    para isso as maiores contribuições bastam.
  */
  const TETO = 12;
  const ordenados = [...d.itens].sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  const visiveis = ordenados.slice(0, TETO);
  const restantes = ordenados.length - visiveis.length;
  const somaDosRestantes = ordenados
    .slice(TETO)
    .reduce((s, i) => s + i.valor, 0);

  return (
    <div className="ml-6 mb-2 overflow-x-auto rounded-md border bg-muted/20">
      <table className="w-full text-[0.7rem]">
        <thead className="text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="px-2 py-1 text-left font-semibold">Placa</th>
            <th scope="col" className="px-2 py-1 text-left font-semibold">Rubrica</th>
            <th scope="col" className="px-2 py-1 text-right font-semibold">{rotuloBase}</th>
            <th scope="col" className="px-2 py-1 text-right font-semibold">{rotuloComparada}</th>
            <th scope="col" className="px-2 py-1 text-right font-semibold">No degrau</th>
          </tr>
        </thead>
        <tbody>
          {visiveis.map((i, indice) => (
            <tr key={`${i.placa}-${i.variavel}-${indice}`} className="border-b last:border-0">
              <td className="px-2 py-1 font-mono">
                {i.placa ?? "—"}
                {i.entityType && (
                  <span className="ml-1 text-muted-foreground">
                    {ROTULO_DO_TIPO[i.entityType] ?? i.entityType}
                  </span>
                )}
              </td>
              <td className="px-2 py-1">
                {i.rubrica}
                {i.nota && (
                  <span className="ml-1 text-muted-foreground">· {i.nota}</span>
                )}
              </td>
              {/* Nulo é "aquela vigência não tinha o veículo", e é escrito como
                  travessão: zero ali diria que a parcela era zero. */}
              <td className="px-2 py-1 text-right font-mono tabular-nums">
                {i.base === null ? "—" : formatBrl(i.base)}
              </td>
              <td className="px-2 py-1 text-right font-mono tabular-nums">
                {i.comparada === null ? "—" : formatBrl(i.comparada)}
              </td>
              <td
                className={cn(
                  "px-2 py-1 text-right font-mono tabular-nums",
                  corDaDiferenca(i.valor, "DINHEIRO"),
                )}
              >
                {escreverDiferenca(i.valor, "DINHEIRO")}
              </td>
            </tr>
          ))}
          {restantes > 0 && (
            <tr>
              <td colSpan={4} className="px-2 py-1 text-muted-foreground">
                mais {formatNumber(restantes, 0)}{" "}
                {restantes === 1 ? "linha" : "linhas"} — a lista inteira está na tabela
                abaixo e no CSV
              </td>
              <td className="px-2 py-1 text-right font-mono tabular-nums text-muted-foreground">
                {escreverDiferenca(Number(somaDosRestantes.toFixed(2)), "DINHEIRO")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
