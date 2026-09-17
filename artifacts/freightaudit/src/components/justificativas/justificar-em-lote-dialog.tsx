import { useEffect, useState, type ReactNode } from "react";
import { CalendarDays, Layers, Lock, ShieldAlert, X } from "lucide-react";
import {
  faltamNaJustificativa,
  montarJustificativa,
  type JustificativaEstruturada,
  type RascunhoDaJustificativa,
} from "@workspace/comparison/justificativa-estruturada";
import type { ResumoDoLote } from "@workspace/comparison/justificativa-em-lote";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ApiErrorNotice } from "@/components/api-error";
import { CamposDaJustificativa } from "@/components/justificativas/campos";
import { formatNumber } from "@/lib/format";
import { rotuloDoTipo } from "@/lib/frota";

/**
 * APLICAR UMA JUSTIFICATIVA A VÁRIAS ALTERAÇÕES.
 *
 * ---------------------------------------------------------------------------
 * Por que esta caixa existe ao lado da fila, e não no lugar dela
 * ---------------------------------------------------------------------------
 * A caixa de justificar virou uma **fila** — uma variável de cada vez — por um
 * motivo que continua valendo: quatro variáveis alteradas na mesma placa não
 * têm uma fórmula só, e perguntar uma vez pelas quatro produzia a frase
 * genérica que os campos vieram acabar.
 *
 * O caso desta caixa é o oposto, e é igualmente real: **a mesma alteração,
 * repetida em dezenas de placas**. Duzentos cavalos cujo IPVA foi de R$ 7.210,00
 * para R$ 4.145,26 pela mesma troca de alíquota têm uma fórmula, uma regra e
 * uma conformidade — e obrigar a digitá-las duzentas vezes não torna a
 * auditoria mais verdadeira, só mais cara. O que a fila protege é a diferença
 * entre variáveis; o que esta caixa reconhece é a igualdade entre placas.
 *
 * É por isso que o resumo do topo é o centro dela: ele mostra **o que o
 * conjunto tem em comum** e se cala no que não tem. Um cabeçalho que
 * escrevesse "R$ 7.210,00 → R$ 4.145,26" sobre uma seleção com valores
 * diferentes convidaria a explicar um fato que vale para parte do que vai ser
 * gravado — e é exatamente esse o risco que a justificativa em lote traz.
 *
 * ---------------------------------------------------------------------------
 * O que ela não faz
 * ---------------------------------------------------------------------------
 * Não inventa campo nenhum: são os mesmos de `campos.tsx`, cobrados pela mesma
 * `faltamNaJustificativa`, que é a função que a rota usa para recusar o POST.
 * Não grava uma justificativa "de lote": grava uma por alteração, como a fila
 * faz. E não sobrescreve o que já está explicado — a não ser que alguém marque
 * a caixa que diz isso em voz alta, e tenha papel para tanto.
 */

const VAZIO: RascunhoDaJustificativa = {
  formula: "",
  regra: "",
  conformidade: null,
  motivoExcecao: "",
  responsavelAprovacao: "",
};

export function JustificarEmLoteDialog({
  aberto,
  contexto,
  resumo,
  aplicaveis,
  podeSobrescrever,
  universo,
  todosOsResultados,
  pendente,
  erro,
  onFechar,
  onConfirmar,
}: {
  aberto: boolean;
  /** Onde isto vai ser gravado — "comparação julho/2026 → agosto/2026". */
  contexto?: string;
  resumo: ResumoDoLote;
  /** Quantas receberiam a justificativa sem substituir nada. */
  aplicaveis: number;
  podeSobrescrever: boolean;
  /** O universo por extenso, como ele vai ficar registrado. */
  universo: string;
  todosOsResultados: boolean;
  pendente: boolean;
  erro: unknown;
  onFechar: () => void;
  onConfirmar: (
    justificativa: JustificativaEstruturada,
    sobrescrever: boolean,
  ) => Promise<unknown> | void;
}) {
  const [resposta, setResposta] = useState<RascunhoDaJustificativa>(VAZIO);
  const [sobrescrever, setSobrescrever] = useState(false);

  /* Cada abertura começa em branco: o que se digitou para um conjunto não é
     rascunho do seguinte — e reaproveitá-lo é justamente como a frase de uma
     seleção acabaria gravada noutra. */
  useEffect(() => {
    if (!aberto) return;
    setResposta(VAZIO);
    setSobrescrever(false);
  }, [aberto]);

  const faltam = faltamNaJustificativa(resposta);
  /* Com a substituição ligada, o alvo passa a ser o conjunto inteiro. */
  const alvo = sobrescrever ? resumo.total : aplicaveis;

  const confirmar = async () => {
    if (faltam.length > 0 || alvo === 0) return;
    await onConfirmar(montarJustificativa(resposta), sobrescrever);
  };

  return (
    <Dialog
      open={aberto}
      onOpenChange={(open) => {
        if (!open) onFechar();
      }}
      className="max-w-2xl p-0 overflow-hidden"
    >
      <header className="relative border-b px-6 pt-6 pb-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Justificativa em lote
        </p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight">
          Aplicar justificativa a {formatNumber(resumo.total, 0)}{" "}
          {resumo.total === 1 ? "alteração" : "alterações"}
        </h2>
        {contexto && (
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
            {contexto}
          </p>
        )}
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar"
          className="absolute right-4 top-4 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
        <ResumoDoConjunto resumo={resumo} universo={universo} todos={todosOsResultados} />

        {resumo.jaJustificadas > 0 && (
          <JaJustificadas
            quantas={resumo.jaJustificadas}
            total={resumo.total}
            podeSobrescrever={podeSobrescrever}
            sobrescrever={sobrescrever}
            onSobrescrever={setSobrescrever}
          />
        )}

        <div className="mt-5">
          {/*
            Os mesmos campos da justificativa individual — ver `campos.tsx`. A
            nota é a frase que impede o engano desta caixa: aqui a resposta não
            é de uma variável, é de todas as alterações marcadas.
          */}
          <CamposDaJustificativa
            resposta={resposta}
            onAlterar={(mudanca) => setResposta((atual) => ({ ...atual, ...mudanca }))}
            nota={`Esta resposta será gravada em cada uma das ${formatNumber(alvo, 0)} alterações.`}
          />
        </div>

        {erro != null && (
          <div className="mt-4">
            <ApiErrorNotice error={erro} what="A justificativa em lote não pôde ser salva." />
          </div>
        )}
      </div>

      <footer className="sticky bottom-0 flex flex-col gap-3 border-t bg-background px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        {/*
          A frase que tem de estar à vista antes do clique: o que vai acontecer
          não é "uma justificativa do conjunto", é a mesma justificativa gravada
          em cada uma das alterações, individualmente — e é assim que cada uma
          delas fica auditável depois, com autor e carimbo próprios.
        */}
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Esta justificativa será aplicada individualmente a {formatNumber(alvo, 0)}{" "}
          {alvo === 1 ? "alteração selecionada" : "alterações selecionadas"}.
        </p>
        <div className="flex gap-2 sm:justify-end">
          <Button variant="outline" size="sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            size="sm"
            disabled={faltam.length > 0 || alvo === 0 || pendente}
            onClick={confirmar}
          >
            {pendente
              ? "Aplicando…"
              : `Aplicar a ${formatNumber(alvo, 0)} ${alvo === 1 ? "alteração" : "alterações"}`}
          </Button>
        </div>
      </footer>
    </Dialog>
  );
}

/**
 * O que o conjunto tem em comum — e o que ele não tem.
 *
 * Cada linha só aparece quando é verdade para **todas** as alterações
 * selecionadas: é `resumirConjuntoDoLote` quem decide, no núcleo, e um campo
 * nulo aqui significa "o conjunto tem mais de um valor", não "não sei". A
 * ausência da linha é informação: ela diz a quem vai escrever a fórmula que o
 * conjunto não é homogêneo naquele eixo.
 */
function ResumoDoConjunto({
  resumo,
  universo,
  todos,
}: {
  resumo: ResumoDoLote;
  universo: string;
  todos: boolean;
}) {
  return (
    <section className="rounded-lg border bg-muted/30 px-4 py-3">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Layers className="h-3.5 w-3.5" aria-hidden="true" />
        O conjunto selecionado
      </h3>
      <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        <Item rotulo="Alterações">{formatNumber(resumo.total, 0)}</Item>
        <Item rotulo="Veículos">{formatNumber(resumo.veiculos, 0)}</Item>
        {resumo.entityType && (
          <Item rotulo="Tipo de ativo">{rotuloDoTipo(resumo.entityType)}</Item>
        )}
        {resumo.variavel && <Item rotulo="Variável">{resumo.variavel}</Item>}
        {resumo.base !== null && (
          <Item rotulo="Valor anterior">
            <span className="font-mono tabular-nums">
              {resumo.baseEscrita ?? resumo.base}
            </span>
          </Item>
        )}
        {resumo.comparada !== null && (
          <Item rotulo="Valor atual">
            <span className="font-mono tabular-nums">
              {resumo.comparadaEscrita ?? resumo.comparada}
            </span>
          </Item>
        )}
        {resumo.jaJustificadas > 0 && (
          <Item rotulo="Já justificadas">{formatNumber(resumo.jaJustificadas, 0)}</Item>
        )}
      </dl>
      {resumo.mesmoContexto && resumo.total > 1 && (
        <p className="mt-2 text-xs text-muted-foreground">
          As {formatNumber(resumo.total, 0)} alterações têm o mesmo contexto — mesma
          variável, mesmo tipo de ativo e os mesmos dois valores.
        </p>
      )}
      {/* O universo por extenso: é ele que fica gravado em `justificativa_lote`,
          e mostrá-lo aqui é o que permite conferir o registro contra a tela. */}
      <p className="mt-2 text-xs text-muted-foreground">
        <span className="font-medium">
          {todos ? "Recorte gravado" : "Seleção gravada"}:
        </span>{" "}
        {universo}
      </p>
    </section>
  );
}

/**
 * As que já estão explicadas — e a porta, fechada por padrão, para substituí-las.
 *
 * Fechada porque regravar em lote a justificativa que outra pessoa escreveu,
 * uma a uma, com o nome dela, é o tipo de coisa que não pode acontecer por
 * alguém não ter reparado. Abri-la é uma caixa a marcar, e só para quem
 * administra contas: a rota recusa o resto com 403, e esconder a caixa de quem
 * não pode marcá-la evita o clique que terminaria nessa recusa.
 */
function JaJustificadas({
  quantas,
  total,
  podeSobrescrever,
  sobrescrever,
  onSobrescrever,
}: {
  quantas: number;
  total: number;
  podeSobrescrever: boolean;
  sobrescrever: boolean;
  onSobrescrever: (valor: boolean) => void;
}) {
  return (
    <section className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <ShieldAlert className="h-4 w-4 shrink-0 text-warning-foreground" aria-hidden="true" />
        {formatNumber(quantas, 0)} de {formatNumber(total, 0)}{" "}
        {quantas === 1 ? "já está justificada" : "já estão justificadas"}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Por padrão elas não são tocadas: a justificativa será aplicada apenas às{" "}
        {formatNumber(total - quantas, 0)} que ainda não têm explicação.
      </p>
      {podeSobrescrever ? (
        <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={sobrescrever}
            onChange={(e) => onSobrescrever(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-[hsl(var(--brand))]"
          />
          <span>
            Substituir também as {formatNumber(quantas, 0)} justificativas existentes. A
            anterior não é apagada — fica no histórico —, e a substituição é registrada
            com o seu nome.
          </span>
        </label>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Substituir justificativas já gravadas é uma ação de administrador.
        </p>
      )}
    </section>
  );
}

function Item({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-border/60 pb-1 last:border-0">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm font-semibold">{children}</dd>
    </div>
  );
}
