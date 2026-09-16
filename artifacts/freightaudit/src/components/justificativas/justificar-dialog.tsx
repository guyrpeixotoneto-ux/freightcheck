import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Lock,
  Maximize2,
  Minimize2,
  Sigma,
  Sparkles,
  Truck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ApiErrorNotice } from "@/components/api-error";
import {
  faltamNaJustificativa,
  type JustificativaEstruturada,
  type RascunhoDaJustificativa,
} from "@workspace/comparison/justificativa-estruturada";
import {
  formulaDoTotalDerivado,
  separarTotaisDerivados,
  totalDerivado,
} from "@workspace/comparison/totais-derivados";
import type { Justificativa } from "@/lib/justificativas";
import {
  apagarRascunho,
  gravarRascunho,
  lerRascunho,
  rascunhoVazio,
} from "@/lib/rascunho-de-justificativa";
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

const VAZIO: RascunhoDaJustificativa = {
  formula: "",
  regra: "",
  conforme: null,
  motivoExcecao: "",
  responsavelAprovacao: "",
};

/** O que já está gravado, aberto nos campos para ser corrigido. */
function comoRascunho(j: Justificativa | null | undefined): RascunhoDaJustificativa {
  if (!j) return VAZIO;
  /*
    Justificativa anterior a `0098` tem `texto` e não tem os campos: ela abre
    com a fórmula e a regra em branco, e é o que se quer — a frase antiga não
    é uma regra, e copiá-la para o campo "Regra" afirmaria que alguém a
    escreveu como tal.
  */
  return {
    formula: j.formula ?? "",
    regra: j.regra ?? "",
    conforme: j.conforme,
    motivoExcecao: j.motivoExcecao ?? "",
    responsavelAprovacao: j.responsavelAprovacao ?? "",
  };
}

const completa = (r: RascunhoDaJustificativa): JustificativaEstruturada => ({
  formula: (r.formula ?? "").trim(),
  regra: (r.regra ?? "").trim(),
  conforme: r.conforme === true,
  motivoExcecao: r.conforme ? null : (r.motivoExcecao ?? "").trim(),
  responsavelAprovacao: r.conforme ? null : (r.responsavelAprovacao ?? "").trim(),
});

/**
 * O formulário de justificar — uma variável de cada vez, ainda que se tenha
 * aberto quatro. Compartilhado entre a lista de Justificativas, a tela de
 * detalhe por placa, o Painel e as seis rubricas: nenhuma delas muda o que
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
 * ---------------------------------------------------------------------------
 * De uma justificativa para várias — por que virou um assistente
 * ---------------------------------------------------------------------------
 * Abrir quatro alterações gravava **a mesma** fórmula e a mesma regra nas
 * quatro. Mas quatro variáveis alteradas na mesma placa não têm uma fórmula
 * só: a Parcela FINAME se calcula de um jeito, os Juros de outro, e o Fim do
 * contrato não se calcula — é uma data. A justificativa em lote era, na
 * prática, a mesma frase genérica repetida quatro vezes, que é exatamente o
 * que os campos vieram acabar.
 *
 * Então a lista virou uma fila: a lateral mostra as variáveis, quantas já
 * foram concluídas, e o painel da direita pergunta por **uma** delas. Cada
 * "Salvar e próxima" é um POST daquela variável — quem fechar no meio deixou
 * gravadas as que concluiu, e não perdeu o trabalho inteiro por causa da
 * quarta. O que ainda não está completo cabe em "Salvar rascunho", que fica no
 * navegador (ver `lib/rascunho-de-justificativa.ts`) e **não** conta como
 * explicação dada em lugar nenhum.
 *
 * Quem decide se está completo é `faltamNaJustificativa`, a mesma função que a
 * rota usa para recusar o POST. Duas listas do que é obrigatório concordariam
 * no dia em que fossem escritas e discordariam no seguinte — e a discordância
 * apareceria como um botão que se acende e um 400 logo depois, com o texto
 * todo perdido.
 *
 * `contexto` e `justificativas` são o que as telas acrescentam. Na fila,
 * justificar é sempre na vigência que o seletor mostra; na grade por placa o
 * clique pode cair em qualquer coluna, e um diálogo que não diz **em que
 * vigência** se está gravando deixa a decisão sem a metade que a torna
 * verificável. `justificativas` é o que já está gravado, por `change.id`: a
 * variável que já tem justificativa abre marcada como concluída e com o texto
 * nos campos, porque quem reabre uma célula explicada quase sempre quer
 * corrigir o que escreveu, e não redigir do zero sem saber o que substitui.
 */
export function JustificarDialog({
  alvo,
  contexto,
  justificativas,
  pendente,
  erro,
  onClose,
  onConfirmar,
}: {
  alvo: readonly AlvoDaJustificativa[] | null;
  /** Onde isto vai ser gravado — "vigência 01/08/26". Opcional: a fila não precisa. */
  contexto?: string;
  /** O que já está gravado, por `change.id` — para reescrever e para contar o que falta. */
  justificativas?: ReadonlyMap<number, Justificativa>;
  pendente: boolean;
  erro: unknown;
  onClose: () => void;
  /**
   * Grava **uma** variável. A promessa é o que diz ao assistente que pode
   * avançar: uma gravação que falhou não pode empurrar a fila para a próxima
   * variável, senão o texto recusado some da tela junto com o erro.
   */
  onConfirmar: (
    alvo: AlvoDaJustificativa,
    justificativa: JustificativaEstruturada,
  ) => Promise<unknown> | void;
}) {
  /*
    O total que é a conta das suas parcelas não entra na fila.

    A Parcela FINAME é juros mais amortização: perguntar a fórmula das três
    pede a mesma coisa duas vezes, e abre espaço para a resposta do total
    contradizer a das parcelas. Ela é gravada pelo servidor a partir delas
    (`gravarJustificativasDerivadas`) assim que as parcelas que se moveram
    estiverem justificadas — por isso sair da fila aqui não é sair da cobrança.

    Aberta **sozinha**, ela continua sendo perguntada: ali não há de onde
    deduzir nada. Ver `separarTotaisDerivados`.
  */
  const { fila, derivados } = useMemo(
    () => separarTotaisDerivados(alvo ?? []),
    [alvo],
  );

  const [indice, setIndice] = useState(0);
  const [respostas, setRespostas] = useState<Map<number, RascunhoDaJustificativa>>(new Map());
  const [salvas, setSalvas] = useState<Set<number>>(new Set());
  /**
   * O que esta abertura veio fazer — as variáveis que a fila vai percorrer.
   *
   * Normalmente são as que ainda não têm justificativa: salvar uma avança para
   * a próxima que falta, e quando não falta nenhuma a caixa fecha. Mas quando
   * **todas** já estão justificadas, a abertura é deliberadamente uma
   * reescrita (é o clique numa célula inteira verde, na grade por placa), e aí
   * a fila é a lista inteira — senão a caixa gravaria a primeira e fecharia,
   * abandonando as outras três que quem clicou foi reescrever.
   */
  const [porFazer, setPorFazer] = useState<Set<number>>(new Set());
  const [rascunhadas, setRascunhadas] = useState<Set<number>>(new Set());
  const [formulaExpandida, setFormulaExpandida] = useState(false);
  const [avisoDeRascunho, setAvisoDeRascunho] = useState(false);

  /*
    Os campos são semeados quando o alvo muda, e não a cada render: semear a
    cada render apagaria o que está sendo digitado. `alvo` é estado da tela que
    abre o diálogo, então trocar de célula troca a referência — que é
    exatamente quando o texto deve ser resemeado. `justificativas` de propósito
    fica fora das dependências: ele se renova a cada gravação (a consulta é
    invalidada), e resemear ali jogaria fora o que já estivesse digitado na
    variável seguinte.
  */
  useEffect(() => {
    if (alvo === null) return;
    const iniciais = new Map<number, RascunhoDaJustificativa>();
    const comRascunho = new Set<number>();
    for (const a of fila) {
      const rascunho = lerRascunho(a.id);
      if (rascunho && !rascunhoVazio(rascunho)) comRascunho.add(a.id);
      iniciais.set(a.id, rascunho ?? comoRascunho(justificativas?.get(a.id)));
    }
    const pendentes = fila.filter((a) => !justificativas?.has(a.id)).map((a) => a.id);
    setPorFazer(new Set(pendentes.length > 0 ? pendentes : fila.map((a) => a.id)));
    setRespostas(iniciais);
    setRascunhadas(comRascunho);
    setSalvas(new Set());
    setFormulaExpandida(false);
    setAvisoDeRascunho(false);
    /* Abre na primeira que ainda não tem justificativa: quem abriu "4
       pendentes" não quer começar relendo a que já explicou. */
    const primeiraPendente = fila.findIndex((a) => !justificativas?.has(a.id));
    setIndice(primeiraPendente === -1 ? 0 : primeiraPendente);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo]);

  const total = fila.length;
  const atual = indice < total ? fila[indice] : null;
  const resposta = (atual && respostas.get(atual.id)) ?? VAZIO;

  const concluida = useMemo(() => {
    const ids = new Set(salvas);
    for (const a of fila) if (justificativas?.has(a.id)) ids.add(a.id);
    return ids;
  }, [fila, justificativas, salvas]);

  /*
    A placa, uma vez só.

    A fila é **de uma placa**: é assim que ela se abre em toda tela deste
    produto — a linha da tabela da rubrica, o card de Chamados, a célula da
    grade. Repetir "QYX1E98" em cada uma das quatro etapas é escrever quatro
    vezes o que não muda entre elas, e o que não muda entre as etapas pertence
    ao cabeçalho, ao lado da vigência.
    
    A exceção é a seleção do Painel, que atravessa placas de propósito: ali o
    cabeçalho não pode afirmar uma placa, e cada etapa diz a sua.
  */
  const placaUnica = useMemo(() => {
    const placas = new Set(fila.map((a) => a.entityLabel ?? ""));
    const [unica] = [...placas];
    return placas.size === 1 && unica ? unica : null;
  }, [fila]);

  const faltam = faltamNaJustificativa(resposta);
  const excecao = resposta.conforme === false;
  const varias = total > 1;

  const alterar = (mudanca: Partial<RascunhoDaJustificativa>) => {
    if (!atual) return;
    setAvisoDeRascunho(false);
    setRespostas((anterior) => {
      const proximo = new Map(anterior);
      proximo.set(atual.id, { ...(anterior.get(atual.id) ?? VAZIO), ...mudanca });
      return proximo;
    });
  };

  /** A próxima que ainda falta, a partir da atual e dando a volta — `null` quando não há. */
  const proximaPendente = (jaSalvas: Set<number>): number | null => {
    for (let passo = 1; passo <= total; passo++) {
      const i = (indice + passo) % total;
      const id = fila[i].id;
      if (porFazer.has(id) && !jaSalvas.has(id)) return i;
    }
    return null;
  };

  const temProxima = proximaPendente(salvas) !== null;

  const confirmar = async () => {
    if (!atual || faltam.length > 0) return;
    try {
      await onConfirmar(atual, completa(resposta));
    } catch {
      /* A recusa já chega em `erro`; o que importa aqui é não avançar. */
      return;
    }
    apagarRascunho(atual.id);
    const jaSalvas = new Set(salvas).add(atual.id);
    setSalvas(jaSalvas);
    setRascunhadas((anterior) => {
      const proximo = new Set(anterior);
      proximo.delete(atual.id);
      return proximo;
    });
    const proxima = proximaPendente(jaSalvas);
    if (proxima === null) {
      onClose();
      return;
    }
    setIndice(proxima);
    setFormulaExpandida(false);
    setAvisoDeRascunho(false);
  };

  const salvarRascunho = () => {
    if (!atual) return;
    gravarRascunho(atual.id, resposta);
    setRascunhadas((anterior) => new Set(anterior).add(atual.id));
    setAvisoDeRascunho(true);
  };

  const rotuloDeSalvar = varias
    ? temProxima
      ? "Salvar e próxima"
      : "Salvar e concluir"
    : excecao
      ? "Salvar exceção"
      : "Salvar justificativa";

  return (
    <Dialog
      open={alvo !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className={cn("p-0 overflow-hidden", varias ? "max-w-4xl" : "max-w-2xl")}
    >
      {alvo && atual && (
        <>
          <header className="relative border-b px-6 pt-6 pb-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Justificativa de alterações
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">
              {varias
                ? `Justificar ${total} alterações`
                : `Justificar alteração — ${atual.attributeName ?? atual.attributeCode ?? "atributo"}`}
            </h2>
            {(placaUnica || contexto) && (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                {placaUnica && (
                  <span className="inline-flex items-center gap-1.5">
                    <Truck className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="font-mono font-semibold text-foreground">{placaUnica}</span>
                  </span>
                )}
                {placaUnica && contexto && <span aria-hidden="true">·</span>}
                {contexto && (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {contexto}
                  </span>
                )}
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="absolute right-4 top-4 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          <div
            className={cn(
              "grid",
              varias && "md:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]",
            )}
          >
            {varias && (
              <ListaDeVariaveis
                alvo={fila}
                derivados={derivados}
                indice={indice}
                concluida={concluida}
                salvas={salvas}
                rascunhadas={rascunhadas}
                onIr={(i) => {
                  setIndice(i);
                  setFormulaExpandida(false);
                  setAvisoDeRascunho(false);
                }}
              />
            )}

            <section className="px-6 py-5">
              {varias && (
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Variável {indice + 1} de {total}
                </p>
              )}
              <h3 className="mt-1 text-xl font-bold tracking-tight">
                {atual.attributeName ?? atual.attributeCode ?? "Atributo"}
              </h3>
              {/* Só quando o cabeçalho não pôde afirmar a placa — ver `placaUnica`. */}
              {!placaUnica && atual.entityLabel && (
                <p className="text-sm text-muted-foreground">
                  Alteração em <span className="font-mono font-semibold">{atual.entityLabel}</span>
                </p>
              )}

              <div className="mt-4 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
                <span className="mt-0.5 shrink-0 rounded-md bg-primary/10 p-1.5 text-primary">
                  <Sparkles className="h-4 w-4" />
                </span>
                <p className="text-sm">
                  {varias
                    ? "Informe a lógica específica desta variável."
                    : "Informe a fórmula, a regra esperada e se esta alteração seguiu o padrão."}
                </p>
              </div>

              {!varias && <NotaDosTotais derivados={derivados} />}

              <AlteracaoRealizada alvo={atual} />

              {justificativas?.get(atual.id) && (
                <p className="mt-4 text-xs text-muted-foreground">
                  Reescrevendo a justificativa de {justificativas.get(atual.id)!.criadoPor} de{" "}
                  {new Date(justificativas.get(atual.id)!.criadoEm).toLocaleString("pt-BR")}. A
                  anterior não é apagada — fica no histórico.
                </p>
              )}

              <div className="mt-4 space-y-4">
                <Campo
                  rotulo="Fórmula de cálculo"
                  obrigatorio
                  nota={varias ? atual.attributeName : null}
                  /*
                      A fórmula é o campo que às vezes tem uma linha e às vezes
                      tem dez — cadeias de cálculo do FINAME não cabem em duas.
                      Expandir é da fórmula só, e não do diálogo: crescer a
                      caixa inteira empurraria os botões para fora da tela
                      justamente quando se está escrevendo o campo mais longo.
                  */
                  acao={
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                      onClick={() => setFormulaExpandida((v) => !v)}
                    >
                      {formulaExpandida ? (
                        <Minimize2 className="h-3.5 w-3.5" />
                      ) : (
                        <Maximize2 className="h-3.5 w-3.5" />
                      )}
                      {formulaExpandida ? "Recolher" : "Expandir"}
                    </button>
                  }
                >
                  <Textarea
                    value={resposta.formula ?? ""}
                    onChange={(e) => alterar({ formula: e.target.value })}
                    placeholder="Descreva como o valor deve ser calculado."
                    rows={formulaExpandida ? 10 : 3}
                    autoFocus
                  />
                </Campo>

                <Campo
                  rotulo="Regra para alteração do valor"
                  obrigatorio
                  nota={varias ? atual.attributeName : null}
                >
                  <Textarea
                    value={resposta.regra ?? ""}
                    onChange={(e) => alterar({ regra: e.target.value })}
                    placeholder="Explique quando esta variável pode ser alterada."
                    rows={3}
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
                <Campo
                  rotulo="Esta alteração seguiu a regra?"
                  obrigatorio
                  grupo
                  nota={varias ? atual.attributeName : null}
                >
                  <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
                    <OpcaoDeConformidade
                      marcada={resposta.conforme === true}
                      onSelecionar={() => alterar({ conforme: true })}
                    >
                      Sim, está conforme
                    </OpcaoDeConformidade>
                    <OpcaoDeConformidade
                      marcada={resposta.conforme === false}
                      onSelecionar={() => alterar({ conforme: false })}
                    >
                      Não, foi uma exceção
                    </OpcaoDeConformidade>
                  </div>
                </Campo>

                {/*
                    Motivo e responsável aparecem juntos, e só na exceção:
                    pedi-los de quem marcou "conforme" seria pedir a explicação
                    de uma exceção que não houve.
                */}
                {excecao && (
                  <>
                    <Campo rotulo="Motivo da exceção" obrigatorio>
                      <Textarea
                        value={resposta.motivoExcecao ?? ""}
                        onChange={(e) => alterar({ motivoExcecao: e.target.value })}
                        placeholder="Explique por que o valor foi alterado mesmo não atendendo à regra definida."
                        rows={2}
                      />
                    </Campo>

                    <Campo rotulo="Responsável pela aprovação" obrigatorio>
                      <Input
                        value={resposta.responsavelAprovacao ?? ""}
                        onChange={(e) => alterar({ responsavelAprovacao: e.target.value })}
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
            </section>
          </div>

          <footer className="sticky bottom-0 flex flex-col gap-3 border-t bg-background px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              {avisoDeRascunho
                ? "Rascunho salvo neste navegador — ainda não conta como justificativa."
                : varias
                  ? "Cada justificativa será registrada individualmente."
                  : "A regra e as exceções ficarão registradas para orientar futuras alterações."}
            </p>
            <div className="flex gap-2 sm:justify-end">
              <Button variant="outline" size="sm" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={rascunhoVazio(resposta) || pendente}
                onClick={salvarRascunho}
              >
                Salvar rascunho
              </Button>
              <Button size="sm" disabled={faltam.length > 0 || pendente} onClick={confirmar}>
                {pendente ? "Salvando…" : rotuloDeSalvar}
              </Button>
            </div>
          </footer>
        </>
      )}
    </Dialog>
  );
}

/**
 * A lateral: o que falta justificar, e onde se está.
 *
 * Ela existe para responder, sem fechar a caixa, as duas perguntas de quem
 * abriu quatro alterações de uma vez — "quantas ainda faltam?" e "posso
 * escrever a Amortização antes da Parcela?". A ordem não é imposta: clicar em
 * qualquer variável leva até ela, e o que estava digitado na anterior continua
 * lá (em memória enquanto a caixa estiver aberta; no navegador, se tiver sido
 * salvo como rascunho).
 */
function ListaDeVariaveis({
  alvo,
  derivados,
  indice,
  concluida,
  salvas,
  rascunhadas,
  onIr,
}: {
  alvo: readonly AlvoDaJustificativa[];
  /** Os totais que saíram da fila, e de que parcelas eles saem. */
  derivados: readonly { total: AlvoDaJustificativa; parcelas: AlvoDaJustificativa[] }[];
  indice: number;
  /** O que tem justificativa gravada — a de antes de abrir, ou a desta sentada. */
  concluida: ReadonlySet<number>;
  /** O que foi gravado agora: a etapa em que se está só deixa de ser "em preenchimento" depois disso. */
  salvas: ReadonlySet<number>;
  rascunhadas: ReadonlySet<number>;
  onIr: (i: number) => void;
}) {
  const feitas = alvo.filter((a) => concluida.has(a.id)).length;
  const percentual = Math.round((feitas / alvo.length) * 100);

  return (
    <aside className="border-b bg-muted/30 px-6 py-5 md:border-b-0 md:border-r">
      <h3 className="text-lg font-bold tracking-tight">Variáveis alteradas</h3>
      <p className="text-sm text-muted-foreground">Justifique cada alteração</p>

      <div className="mt-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-semibold">
            {feitas} de {alvo.length} concluída{alvo.length === 1 ? "" : "s"}
          </span>
          <span className="text-muted-foreground">{percentual}%</span>
        </div>
        <div
          className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={percentual}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Justificativas concluídas"
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${percentual}%` }} />
        </div>
      </div>

      <ol className="mt-4 space-y-2">
        {alvo.map((a, i) => {
          const feita = concluida.has(a.id);
          const atual = i === indice;
          /* O sinal segue o texto: a etapa em que se está mostra o número,
             mesmo quando ela já tinha justificativa — um certo verde ao lado de
             "Em preenchimento" diz duas coisas ao mesmo tempo. */
          const marcada = salvas.has(a.id) || (feita && !atual);
          const estado = salvas.has(a.id)
            ? "Concluída"
            : atual
              ? "Em preenchimento"
              : feita
                ? "Concluída"
                : rascunhadas.has(a.id)
                  ? "Rascunho salvo"
                  : "Pendente";
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onIr(i)}
                aria-current={atual ? "step" : undefined}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  atual ? "border-primary bg-primary/5" : "bg-background hover:bg-muted/60",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    marcada
                      ? "bg-emerald-600 text-white"
                      : atual
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {marcada ? <Check className="h-4 w-4" aria-hidden="true" /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  {/* Duas linhas, e não uma cortada: "Lucro variável previsto
                      (carreta)" e "Lucro variável previsto" viram a mesma
                      etiqueta truncada, e a lista passa a ter duas entradas
                      indistinguíveis. */}
                  <span
                    className="block line-clamp-2 text-sm font-semibold"
                    title={a.attributeName ?? a.attributeCode ?? undefined}
                  >
                    {a.attributeName ?? a.attributeCode ?? "Atributo"}
                  </span>
                  <span className="block text-xs text-muted-foreground">{estado}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>

      <NotaDosTotais derivados={derivados} />
    </aside>
  );
}

/**
 * O que saiu da fila, dito por extenso.
 *
 * Sem esta nota, quem selecionou quatro alterações abriria uma caixa escrita
 * "Justificar 3 alterações" e passaria o resto do dia procurando a quarta. Ela
 * responde as duas perguntas de quem conta: qual sumiu, e por que não é uma
 * pendência escondida — o total é gravado a partir das parcelas, e a cobertura
 * fecha com ele.
 */
function NotaDosTotais({
  derivados,
}: {
  derivados: readonly { total: AlvoDaJustificativa; parcelas: AlvoDaJustificativa[] }[];
}) {
  if (derivados.length === 0) return null;
  const nome = (a: AlvoDaJustificativa) => a.attributeName ?? a.attributeCode ?? "—";
  return (
    <section className="mt-4 rounded-lg border border-dashed px-3 py-2.5">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Sigma className="h-3.5 w-3.5" aria-hidden="true" />
        Total calculado
      </h4>
      <ul className="mt-1.5 space-y-1.5 text-xs text-muted-foreground">
        {derivados.map(({ total, parcelas }) => (
          <li key={total.id}>
            <span className="font-medium text-foreground">
              {formulaDoTotalDerivado(
                nome(total),
                totalDerivado(total.attributeCode)?.forma ?? "SOMA",
                parcelas.map(nome),
              )}
            </span>
            . Não é perguntado aqui: será registrado a partir das justificativas das
            parcelas.
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Rótulo com o asterisco do obrigatório — o desenho de todos os campos daqui. */
function Campo({
  rotulo,
  obrigatorio,
  grupo,
  nota,
  acao,
  children,
}: {
  rotulo: string;
  obrigatorio?: boolean;
  /** Um grupo de opções em vez de um controle só — ver a chamada. */
  grupo?: boolean;
  /**
   * O nome da variável a que esta resposta pertence, quando há mais de uma em
   * jogo. É a frase que impede o engano central do assistente: a caixa parece
   * a mesma em todas as etapas, e sem ela é fácil escrever a fórmula dos Juros
   * achando que vale para as quatro.
   */
  nota?: string | null;
  /** Um comando do campo — hoje só o "Expandir" da fórmula. */
  acao?: ReactNode;
  children: ReactNode;
}) {
  const Envolucro = grupo ? "div" : "label";
  return (
    <Envolucro className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold">
        {rotulo}
        {obrigatorio && <span className="ml-1 text-destructive">*</span>}
      </span>
      {children}
      {(nota || acao) && (
        <span className="flex items-start justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {nota && `Esta resposta será associada somente à variável ${nota}.`}
          </span>
          {acao}
        </span>
      )}
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
    <section className="mt-4">
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Alteração realizada
      </h4>
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
    <div className="rounded-lg border bg-background px-3 py-2">
      <p className="text-[0.7rem] uppercase tracking-wider text-muted-foreground">{rotulo}</p>
      <p className="text-base font-semibold tabular-nums">{children}</p>
    </div>
  );
}
