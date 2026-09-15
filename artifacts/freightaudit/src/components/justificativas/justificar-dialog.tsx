import { useEffect, useState, type ReactNode } from "react";
import { Lock, Maximize2, Minimize2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ApiErrorNotice } from "@/components/api-error";
import {
  faltamNaJustificativa,
  type JustificativaEstruturada,
} from "@workspace/comparison/justificativa-estruturada";
import type { Justificativa } from "@/lib/justificativas";
import { cn } from "@/lib/utils";

/**
 * O que o diálogo precisa saber da alteração que se vai justificar — e só isso.
 *
 * Era `ChangeRow` inteiro, que é a linha da Planilha de Alterações com as suas
 * vinte e cinco colunas. Nenhuma delas entra aqui: o diálogo escreve a placa e
 * o nome do atributo no título, e manda os ids. Pedir a linha inteira obrigava
 * quem tem a alteração noutro formato — o Painel de Justificativas, que a lê
 * paginada do servidor — a inventar as vinte e duas colunas que não usa só para
 * abrir a mesma caixa de texto. `ChangeRow` continua servindo, porque satisfaz
 * esta forma.
 *
 * Os quatro campos do valor são **opcionais** pelo mesmo motivo: eles montam o
 * bloco "Alteração realizada", e quem não os tem em mãos continua abrindo o
 * diálogo sem o bloco, em vez de inventar um antes e um depois.
 */
export interface AlvoDaJustificativa {
  id: number;
  entityLabel: string | null;
  attributeCode: string | null;
  attributeName: string | null;
  /** O valor antes, já formatado para leitura — é assim que a comparação o guarda. */
  valueBefore?: string | null;
  valueAfter?: string | null;
  deltaAbsolute?: number | null;
  deltaPercent?: number | null;
}

/**
 * O formulário de justificar — uma ou várias alterações de uma vez, mesma
 * justificativa para todas. Compartilhado entre a lista de Justificativas, a
 * tela de detalhe por placa, o Painel e o FINAME: nenhuma delas muda o que
 * significa justificar, só de onde a lista de alterações-alvo vem.
 *
 * ---------------------------------------------------------------------------
 * De uma frase para uma regra
 * ---------------------------------------------------------------------------
 * A caixa era um campo de texto livre. O que se escrevia nela explicava
 * *aquela* alteração e morria ali: no mês seguinte o mesmo atributo mudava de
 * novo, e quem justificava recomeçava do zero — sem ter onde ler o que já
 * tinha sido decidido, e sem ninguém poder perguntar "esta alteração seguiu a
 * regra?", porque a regra não estava escrita em lugar nenhum.
 *
 * Agora a caixa pergunta quatro coisas, e a ordem delas é o raciocínio: como o
 * valor se calcula, sob que condição ele pode mudar, se esta alteração seguiu
 * essa condição e — só quando não seguiu — por que e com o aval de quem. O
 * motivo e o responsável aparecem juntos e só na exceção: exceção sem
 * responsável não é exceção, é alteração sem dono.
 *
 * Quem decide se está completo é `faltamNaJustificativa`, a mesma função que a
 * rota usa para recusar o POST. Duas listas do que é obrigatório concordariam
 * no dia em que fossem escritas e discordariam no seguinte — e a discordância
 * apareceria como um botão que se acende e um 400 logo depois, com o texto
 * todo perdido.
 *
 * `contexto` e `justificativaAtual` são o que a grade da tela de placa
 * precisou acrescentar. Na fila, justificar é sempre na vigência que o
 * seletor mostra; na grade, o clique pode cair em qualquer coluna, e um
 * diálogo que não diz **em que vigência** se está gravando deixa a decisão sem
 * a metade que a torna verificável. `justificativaAtual` aparece quando se
 * clica numa célula já verde: o que já está gravado abre nos campos, porque
 * quem reabre uma célula explicada quase sempre quer corrigir o que escreveu,
 * e não redigir do zero sem saber o que está substituindo.
 */
export function JustificarDialog({
  alvo,
  contexto,
  justificativaAtual,
  pendente,
  erro,
  onClose,
  onConfirmar,
}: {
  alvo: readonly AlvoDaJustificativa[] | null;
  /** Onde isto vai ser gravado — "vigência 01/08/26". Opcional: a fila não precisa. */
  contexto?: string;
  /** A justificativa que já existe para o alvo, quando se está reescrevendo. */
  justificativaAtual?: Justificativa | null;
  pendente: boolean;
  erro: unknown;
  onClose: () => void;
  onConfirmar: (justificativa: JustificativaEstruturada) => void;
}) {
  const [formula, setFormula] = useState("");
  const [regra, setRegra] = useState("");
  const [conforme, setConforme] = useState<boolean | null>(null);
  const [motivoExcecao, setMotivoExcecao] = useState("");
  const [responsavelAprovacao, setResponsavelAprovacao] = useState("");
  const [formulaExpandida, setFormulaExpandida] = useState(false);

  /*
    Os campos são semeados quando o alvo muda, e não a cada render: semear a
    cada render apagaria o que está sendo digitado. `alvo` é estado da tela que
    abre o diálogo, então trocar de célula troca a referência — que é
    exatamente quando o texto deve ser resemeado.

    Justificativa anterior a `0098` tem `texto` e não tem os campos: ela abre
    com a fórmula e a regra em branco, e é o que se quer — a frase antiga não
    é uma regra, e copiá-la para o campo "Regra" afirmaria que alguém a
    escreveu como tal.
  */
  useEffect(() => {
    if (alvo === null) return;
    setFormula(justificativaAtual?.formula ?? "");
    setRegra(justificativaAtual?.regra ?? "");
    setConforme(justificativaAtual?.conforme ?? null);
    setMotivoExcecao(justificativaAtual?.motivoExcecao ?? "");
    setResponsavelAprovacao(justificativaAtual?.responsavelAprovacao ?? "");
    setFormulaExpandida(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo]);

  const faltam = faltamNaJustificativa({
    formula,
    regra,
    conforme,
    motivoExcecao,
    responsavelAprovacao,
  });
  const excecao = conforme === false;

  const confirmar = () => {
    if (faltam.length > 0 || conforme === null) return;
    onConfirmar({
      formula: formula.trim(),
      regra: regra.trim(),
      conforme,
      motivoExcecao: conforme ? null : motivoExcecao.trim(),
      responsavelAprovacao: conforme ? null : responsavelAprovacao.trim(),
    });
  };

  const unico = alvo && alvo.length === 1 ? alvo[0] : null;

  return (
    <Dialog
      open={alvo !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="max-w-2xl"
    >
      {alvo && (
        <>
          <DialogHeader className="border-b pb-4">
            <DialogTitle className="text-xl">
              {unico
                ? `Justificar alteração — ${unico.attributeName ?? unico.attributeCode ?? "atributo"}`
                : `Justificar ${alvo.length} alterações`}
            </DialogTitle>
            <DialogDescription className="text-base">
              {[unico?.entityLabel, contexto].filter(Boolean).join(" • ") ||
                "O mesmo texto vale para todas as alterações selecionadas, uma justificativa por alteração."}
            </DialogDescription>
          </DialogHeader>

          {alvo.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {alvo.map((change) => (
                <Badge key={change.id} variant="secondary" className="font-mono">
                  {change.entityLabel} · {change.attributeName ?? change.attributeCode ?? "—"}
                </Badge>
              ))}
            </div>
          )}

          {unico && <AlteracaoRealizada alvo={unico} />}

          <div className="mb-4 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
            <span className="mt-0.5 rounded-md bg-primary/10 p-1.5 text-primary">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="text-sm">
              <p className="font-semibold">Ajude o sistema a aprender</p>
              <p className="text-muted-foreground">
                Informe a fórmula, a regra esperada e se esta alteração seguiu o padrão.
              </p>
            </div>
          </div>

          {justificativaAtual && (
            <p className="mb-4 text-xs text-muted-foreground">
              Reescrevendo a justificativa de {justificativaAtual.criadoPor} de{" "}
              {new Date(justificativaAtual.criadoEm).toLocaleString("pt-BR")}. A anterior
              não é apagada — fica no histórico.
            </p>
          )}

          <div className="space-y-4">
            <Campo rotulo="Fórmula de cálculo" obrigatorio>
              <Textarea
                value={formula}
                onChange={(e) => setFormula(e.target.value)}
                placeholder="Ex.: Amortização mensal = Valor amortizável ÷ Prazo de amortização"
                rows={formulaExpandida ? 10 : 2}
                autoFocus
              />
              {/*
                  A fórmula é o campo que às vezes tem uma linha e às vezes tem
                  dez — cadeias de cálculo do FINAME não cabem em duas. Expandir
                  é da fórmula só, e não do diálogo: crescer a caixa inteira
                  empurraria os botões para fora da tela justamente quando se
                  está escrevendo o campo mais longo.
              */}
              <button
                type="button"
                className="ml-auto flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                onClick={() => setFormulaExpandida((v) => !v)}
              >
                {formulaExpandida ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
                {formulaExpandida ? "Recolher" : "Expandir"}
              </button>
            </Campo>

            <Campo rotulo="Regra para alteração do valor" obrigatorio>
              <Textarea
                value={regra}
                onChange={(e) => setRegra(e.target.value)}
                placeholder="Ex.: O valor somente pode ser alterado quando houver mudança no prazo ou no valor amortizável aprovado."
                rows={2}
              />
            </Campo>

            {/*
                Este campo é um grupo de opções, e não uma caixa de texto: por
                isso não é um `<label>`. Envolver dois botões de opção num
                rótulo faz o nome acessível de cada um virar o texto inteiro do
                grupo — os dois passam a se chamar a mesma coisa, e nem um
                leitor de tela nem um teste conseguem distinguir "sim" de
                "não".
            */}
            <Campo rotulo="Esta alteração foi realizada conforme a regra?" obrigatorio grupo>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
                <OpcaoDeConformidade
                  marcada={conforme === true}
                  onSelecionar={() => setConforme(true)}
                >
                  Sim, está conforme a regra
                </OpcaoDeConformidade>
                <OpcaoDeConformidade
                  marcada={conforme === false}
                  onSelecionar={() => setConforme(false)}
                >
                  Não, foi realizada como exceção
                </OpcaoDeConformidade>
              </div>
            </Campo>

            {/*
                Motivo e responsável aparecem juntos, e só na exceção: pedi-los
                de quem marcou "conforme" seria pedir a explicação de uma
                exceção que não houve.
            */}
            {excecao && (
              <>
                <Campo rotulo="Motivo da exceção" obrigatorio>
                  <Textarea
                    value={motivoExcecao}
                    onChange={(e) => setMotivoExcecao(e.target.value)}
                    placeholder="Explique por que o valor foi alterado mesmo não atendendo à regra definida."
                    rows={2}
                  />
                </Campo>

                <Campo rotulo="Responsável pela aprovação" obrigatorio>
                  <Input
                    value={responsavelAprovacao}
                    onChange={(e) => setResponsavelAprovacao(e.target.value)}
                    placeholder="Nome de quem autorizou a exceção"
                  />
                </Campo>
              </>
            )}
          </div>

          {erro != null && (
            <div className="mt-4">
              <ApiErrorNotice error={erro} what="A justificativa não pôde ser salva." />
            </div>
          )}

          <DialogFooter className="items-center border-t sm:justify-between">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              A regra e as exceções ficarão registradas para orientar futuras alterações.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                Cancelar
              </Button>
              <Button size="sm" disabled={faltam.length > 0 || pendente} onClick={confirmar}>
                {pendente ? "Salvando…" : excecao ? "Salvar exceção" : "Salvar justificativa"}
              </Button>
            </div>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}

/** Rótulo em caixa alta com o asterisco do obrigatório — o desenho de todos os campos daqui. */
function Campo({
  rotulo,
  obrigatorio,
  grupo,
  children,
}: {
  rotulo: string;
  obrigatorio?: boolean;
  /** Um grupo de opções em vez de um controle só — ver a chamada. */
  grupo?: boolean;
  children: ReactNode;
}) {
  const Envolucro = grupo ? "div" : "label";
  return (
    <Envolucro className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {rotulo}
        {obrigatorio && <span className="ml-1 text-destructive">*</span>}
      </span>
      {children}
    </Envolucro>
  );
}

function OpcaoDeConformidade({
  marcada,
  onSelecionar,
  children,
}: {
  marcada: boolean;
  onSelecionar: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={marcada}
      onClick={onSelecionar}
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
        marcada ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted/50",
      )}
    >
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
          marcada ? "border-primary" : "border-muted-foreground/40",
        )}
      >
        {marcada && <span className="h-2 w-2 rounded-full bg-primary" />}
      </span>
      {children}
    </button>
  );
}

/**
 * O antes, o depois e a variação — o que se está justificando, à vista.
 *
 * Quem abre a caixa a partir da grade por placa clicou numa célula colorida, e
 * a célula não diz de quanto para quanto: a pergunta "por que mudou?" sem os
 * dois números ao lado é respondida de memória. Some inteiro quando a
 * alteração não traz valor nenhum — um bloco com dois travessões não informa
 * mais do que a sua ausência.
 */
function AlteracaoRealizada({ alvo }: { alvo: AlvoDaJustificativa }) {
  const temValores = alvo.valueBefore != null || alvo.valueAfter != null;
  if (!temValores) return null;

  const delta = alvo.deltaAbsolute ?? null;
  const percentual = alvo.deltaPercent ?? null;

  return (
    <section className="mb-4">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Alteração realizada
      </h3>
      <div className="grid gap-2 sm:grid-cols-3">
        <Valor rotulo="Valor anterior">{alvo.valueBefore ?? "—"}</Valor>
        <Valor rotulo="Novo valor">{alvo.valueAfter ?? "—"}</Valor>
        <Valor rotulo="Variação">
          {delta === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className={delta < 0 ? "text-red-700" : "text-emerald-700"}>
              {delta > 0 ? "+" : ""}
              {delta.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
              {percentual !== null && (
                <span className="ml-1.5 text-sm font-normal">
                  ({percentual > 0 ? "+" : ""}
                  {percentual.toFixed(1)}%)
                </span>
              )}
            </span>
          )}
        </Valor>
      </div>
    </section>
  );
}

function Valor({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <p className="text-[0.7rem] uppercase tracking-wider text-muted-foreground">{rotulo}</p>
      <p className="text-base font-semibold tabular-nums">{children}</p>
    </div>
  );
}
