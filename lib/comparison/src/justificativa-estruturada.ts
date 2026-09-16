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
 * (`conforme`) e, quando não seguiu, **o que houve** (`motivoExcecao`) — com o
 * aval de quem, quando houve aval (`responsavelAprovacao`). Uma exceção sem
 * responsável não é exceção, é alteração sem dono — por isso o responsável é
 * exigido junto com o motivo, e não oferecido como campo opcional.
 *
 * "Não seguiu" tem duas formas, e elas não são a mesma pergunta para quem
 * audita: a **exceção**, que é um desvio aprovado e tem aprovador, e o
 * **descumprimento da regra de remuneração**, que não tem — ver
 * {@link Conformidade}.
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

/**
 * As três respostas possíveis sobre a regra — e por que não são duas.
 *
 * Eram duas, e o "não" queria dizer uma coisa só: exceção aprovada, com motivo
 * e responsável. Mas nem todo desvio é aprovado. Quando a **regra de
 * remuneração é descumprida**, não há aprovador — e a caixa, que exigia um,
 * obrigava quem justificava a escrever um nome no campo "Responsável pela
 * aprovação" para conseguir salvar: o registro passava a afirmar que alguém
 * autorizou o que ninguém autorizou. As duas coisas são "fora da regra" e são
 * perguntas diferentes para quem audita — uma cobra o aval, a outra cobra a
 * correção.
 */
export type Conformidade = "CONFORME" | "EXCECAO" | "DESCUMPRIMENTO";

/** Como a tela escreve cada uma. */
export const ROTULO_DA_CONFORMIDADE: Record<Conformidade, string> = {
  CONFORME: "Sim, está conforme",
  EXCECAO: "Não, foi uma exceção",
  DESCUMPRIMENTO: "Não, regra de remuneração descumprida",
};

/** A justificativa completa, como o formulário a entrega e o banco a guarda. */
export interface JustificativaEstruturada {
  /** Como o valor é calculado — "Amortização mensal = valor amortizável ÷ prazo". */
  formula: string;
  /** Sob que condição este valor pode ser alterado. */
  regra: string;
  /** Esta alteração seguiu a regra acima? */
  conforme: boolean;
  /** Que tipo de não conformidade, quando não seguiu. Nulo quando `conforme`. */
  naoConformidade: Exclude<Conformidade, "CONFORME"> | null;
  /** Por que se alterou fora da regra. Nulo quando `conforme`. */
  motivoExcecao: string | null;
  /**
   * Quem autorizou a exceção. Nulo quando `conforme` **e** no descumprimento:
   * exigir um aprovador de quem está registrando que a regra foi descumprida
   * seria gravar um aval que não existiu.
   */
  responsavelAprovacao: string | null;
}

export type CampoDaJustificativa = keyof JustificativaEstruturada;

/** O rascunho enquanto se digita: tudo opcional, porque nada ainda foi decidido. */
export interface RascunhoDaJustificativa {
  formula?: string;
  regra?: string;
  /**
   * A resposta sobre a regra, nas três formas — e não o par
   * `conforme`/`naoConformidade` que o banco guarda.
   *
   * No formulário é **um** grupo de opções com três botões, e um rascunho que
   * guardasse o par teria estados que a tela não sabe desenhar (um "não" sem
   * tipo, um tipo com "sim"). A tradução para o par acontece uma vez, na hora
   * de entregar — ver {@link conformidadeDaJustificativa}.
   */
  conformidade?: Conformidade | null;
  motivoExcecao?: string;
  responsavelAprovacao?: string;
}

/** O par que o banco guarda, lido como a resposta única que a tela faz. */
export function conformidadeDaJustificativa(j: {
  conforme: boolean | null;
  naoConformidade?: string | null;
}): Conformidade | null {
  if (j.conforme === true) return "CONFORME";
  if (j.conforme === false) {
    /* Justificativa anterior a `0100` não tem tipo: o "não" dela era sempre a
       exceção, porque era a única que a caixa oferecia. */
    return j.naoConformidade === "DESCUMPRIMENTO" ? "DESCUMPRIMENTO" : "EXCECAO";
  }
  return null;
}

function preenchido(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * O que ainda falta preencher, na ordem em que a tela pergunta.
 *
 * Lista vazia é o único estado em que o botão salva e a rota aceita. O motivo
 * só entra na conta quando a alteração saiu da regra — pedi-lo de quem marcou
 * "conforme" seria pedir a explicação de um desvio que não houve —, e o
 * aprovador só na exceção, que é o único desvio que teve aval.
 */
export function faltamNaJustificativa(
  rascunho: RascunhoDaJustificativa,
): CampoDaJustificativa[] {
  const faltam: CampoDaJustificativa[] = [];
  if (!preenchido(rascunho.formula)) faltam.push("formula");
  if (!preenchido(rascunho.regra)) faltam.push("regra");
  if (!rascunho.conformidade) {
    faltam.push("conforme");
    return faltam;
  }
  if (rascunho.conformidade === "CONFORME") return faltam;

  /* O motivo é cobrado nos dois desvios: é ele que diz o que aconteceu. */
  if (!preenchido(rascunho.motivoExcecao)) faltam.push("motivoExcecao");
  /* O aprovador, só na exceção — ver `JustificativaEstruturada.responsavelAprovacao`. */
  if (rascunho.conformidade === "EXCECAO" && !preenchido(rascunho.responsavelAprovacao)) {
    faltam.push("responsavelAprovacao");
  }
  return faltam;
}

/** Como cada campo se chama na tela — usado nas recusas da rota. */
export const ROTULO_DO_CAMPO: Record<CampoDaJustificativa, string> = {
  formula: "Fórmula de cálculo",
  regra: "Regra para alteração do valor",
  conforme: "Esta alteração seguiu a regra?",
  naoConformidade: "Esta alteração seguiu a regra?",
  motivoExcecao: "Motivo",
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
  if (j.naoConformidade === "DESCUMPRIMENTO") {
    /* Sem "aprovada por": é justamente o que este caso não tem. */
    return `Regra de remuneração descumprida: ${j.motivoExcecao!.trim()}`;
  }
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
    /*
      O corpo traz o par que o banco guarda — `conforme` mais o tipo do desvio
      —, e a validação pensa na resposta única da tela. A tradução é a mesma
      que a leitura de uma justificativa gravada faz, e por isso é a mesma
      função: um corpo com `conforme: false` e sem tipo é o que as versões
      anteriores da tela mandavam, e continua valendo como exceção.
    */
    conformidade:
      typeof c.conforme === "boolean"
        ? conformidadeDaJustificativa({
            conforme: c.conforme,
            naoConformidade: typeof c.naoConformidade === "string" ? c.naoConformidade : null,
          })
        : undefined,
    motivoExcecao: typeof c.motivoExcecao === "string" ? c.motivoExcecao : undefined,
    responsavelAprovacao:
      typeof c.responsavelAprovacao === "string" ? c.responsavelAprovacao : undefined,
  };

  const faltam = faltamNaJustificativa(rascunho);
  if (faltam.length > 0) return { ok: false, faltam };

  return { ok: true, valor: montarJustificativa(rascunho) };
}

/**
 * O rascunho completo virando a justificativa que se grava.
 *
 * Mora aqui, e não no formulário, pelo mesmo motivo de `faltamNaJustificativa`:
 * é a regra de o que sobrevive a cada resposta, e as duas pontas precisam
 * aplicá-la igual. O que ela descarta é deliberado — a exceção que virou
 * conformidade não leva o motivo junto, e o descumprimento não leva aprovador
 * nenhum: quem mudou de decisão mudou de decisão, e guardar o texto abandonado
 * deixaria no banco uma linha que se contradiz.
 */
export function montarJustificativa(
  rascunho: RascunhoDaJustificativa,
): JustificativaEstruturada {
  const conformidade = rascunho.conformidade === "CONFORME";
  const excecao = rascunho.conformidade === "EXCECAO";
  return {
    formula: (rascunho.formula ?? "").trim(),
    regra: (rascunho.regra ?? "").trim(),
    conforme: conformidade,
    naoConformidade: conformidade
      ? null
      : ((rascunho.conformidade as Exclude<Conformidade, "CONFORME">) ?? null),
    motivoExcecao: conformidade ? null : (rascunho.motivoExcecao ?? "").trim(),
    responsavelAprovacao: excecao ? (rascunho.responsavelAprovacao ?? "").trim() : null,
  };
}
