/**
 * O que justificar passou a perguntar — e a regra que decide se a resposta
 * está completa.
 *
 * Justificar era escrever uma frase. A frase explicava *aquela* alteração e
 * morria nela: no mês seguinte, o mesmo atributo mudava de novo e quem
 * justificava recomeçava do zero, sem ter onde ler o que já tinha sido
 * decidido. Ninguém conseguia perguntar "esta alteração seguiu a regra?",
 * porque a regra não estava escrita em lugar nenhum — estava dissolvida em
 * dezenas de frases livres.
 *
 * Agora o formulário pergunta quatro coisas, nesta ordem, e a ordem é o
 * raciocínio: **como o valor se calcula** (`formula`), **sob que condição ele
 * pode mudar** (`regra`), **se esta alteração seguiu essa condição**
 * (`conforme`) e, quando não seguiu, **por que e com o aval de quem**
 * (`motivoExcecao`, `responsavelAprovacao`). Uma exceção sem responsável não é
 * exceção, é alteração sem dono — por isso o responsável é exigido junto com o
 * motivo, e não oferecido como campo opcional.
 *
 * ---------------------------------------------------------------------------
 * Por que a regra mora aqui, e não no formulário nem na rota
 * ---------------------------------------------------------------------------
 * As duas pontas precisam concordar sobre o que é uma justificativa completa:
 * o diálogo, que desabilita o botão de salvar, e a rota, que recusa o POST. Se
 * discordarem, o efeito é um botão que se acende e um 400 logo depois — o
 * gestor escreveu tudo e perdeu o texto. Uma lista só, nos dois lados.
 *
 * Como `painel-de-justificativas-escopo.ts`, este arquivo não importa
 * `@workspace/db`: é essa ausência que o deixa importável pelo navegador.
 */

/** A justificativa completa, como o formulário a entrega e o banco a guarda. */
export interface JustificativaEstruturada {
  /** Como o valor é calculado — "Amortização mensal = valor amortizável ÷ prazo". */
  formula: string;
  /** Sob que condição este valor pode ser alterado. */
  regra: string;
  /** Esta alteração seguiu a regra acima? */
  conforme: boolean;
  /** Por que se alterou fora da regra. Nulo quando `conforme`. */
  motivoExcecao: string | null;
  /** Quem autorizou a exceção. Nulo quando `conforme`. */
  responsavelAprovacao: string | null;
}

export type CampoDaJustificativa = keyof JustificativaEstruturada;

/** O rascunho enquanto se digita: tudo opcional, porque nada ainda foi decidido. */
export interface RascunhoDaJustificativa {
  formula?: string;
  regra?: string;
  conforme?: boolean | null;
  motivoExcecao?: string;
  responsavelAprovacao?: string;
}

function preenchido(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * O que ainda falta preencher, na ordem em que a tela pergunta.
 *
 * Lista vazia é o único estado em que o botão salva e a rota aceita. Os dois
 * últimos campos só entram na conta quando a alteração é exceção: exigi-los de
 * quem marcou "conforme" seria pedir o motivo de uma exceção que não houve.
 */
export function faltamNaJustificativa(
  rascunho: RascunhoDaJustificativa,
): CampoDaJustificativa[] {
  const faltam: CampoDaJustificativa[] = [];
  if (!preenchido(rascunho.formula)) faltam.push("formula");
  if (!preenchido(rascunho.regra)) faltam.push("regra");
  if (typeof rascunho.conforme !== "boolean") {
    faltam.push("conforme");
    return faltam;
  }
  if (rascunho.conforme === false) {
    if (!preenchido(rascunho.motivoExcecao)) faltam.push("motivoExcecao");
    if (!preenchido(rascunho.responsavelAprovacao)) faltam.push("responsavelAprovacao");
  }
  return faltam;
}

/** Como cada campo se chama na tela — usado nas recusas da rota. */
export const ROTULO_DO_CAMPO: Record<CampoDaJustificativa, string> = {
  formula: "Fórmula de cálculo",
  regra: "Regra para alteração do valor",
  conforme: "Esta alteração foi realizada conforme a regra?",
  motivoExcecao: "Motivo da exceção",
  responsavelAprovacao: "Responsável pela aprovação",
};

/**
 * A frase que fica em `justificativa.texto`.
 *
 * `texto` não foi substituído pelos campos novos: ele continua sendo o que as
 * telas com espaço para uma linha só mostram — a coluna do FINAME, a fila do
 * painel, o export de Chamados. O que mudou é que ele deixou de ser digitado e
 * passou a ser derivado, **no servidor**, dos campos abaixo. Derivar no cliente
 * deixaria o resumo e a decisão discordarem no dia em que alguém postasse os
 * dois valores à mão; derivado de um lado só, não há como discordarem.
 */
export function resumoDaJustificativa(j: JustificativaEstruturada): string {
  if (j.conforme) return `Conforme a regra: ${j.regra.trim()}`;
  return `Exceção à regra: ${j.motivoExcecao!.trim()} — aprovada por ${j.responsavelAprovacao!.trim()}.`;
}

/** O corpo do POST virando justificativa, ou a lista do que falta nele. */
export function lerJustificativaEstruturada(
  corpo: unknown,
): { ok: true; valor: JustificativaEstruturada } | { ok: false; faltam: CampoDaJustificativa[] } {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const rascunho: RascunhoDaJustificativa = {
    formula: typeof c.formula === "string" ? c.formula : undefined,
    regra: typeof c.regra === "string" ? c.regra : undefined,
    conforme: typeof c.conforme === "boolean" ? c.conforme : undefined,
    motivoExcecao: typeof c.motivoExcecao === "string" ? c.motivoExcecao : undefined,
    responsavelAprovacao:
      typeof c.responsavelAprovacao === "string" ? c.responsavelAprovacao : undefined,
  };

  const faltam = faltamNaJustificativa(rascunho);
  if (faltam.length > 0) return { ok: false, faltam };

  const conforme = rascunho.conforme as boolean;
  return {
    ok: true,
    valor: {
      formula: rascunho.formula!.trim(),
      regra: rascunho.regra!.trim(),
      conforme,
      /*
        A exceção que virou conformidade não leva o motivo junto: quem marcou
        "sim" depois de ter escrito um motivo mudou de decisão, e guardar o
        texto abandonado deixaria no banco uma linha que se contradiz.
      */
      motivoExcecao: conforme ? null : rascunho.motivoExcecao!.trim(),
      responsavelAprovacao: conforme ? null : rascunho.responsavelAprovacao!.trim(),
    },
  };
}
