import {
  centavos,
  DESCRICAO_DA_FONTE,
  type Canal,
  type FonteDaQuinzena,
  type TipoDeFonte,
} from "./dominio";
import { FONTE_DO_DEMONSTRATIVO, procedenciaDoMotor } from "./matriz";
import type { CadastroNaTela, CanalDoResumo, ResumoDoMes, TresColunas } from "./resumo";

/**
 * A AFERIÇÃO — dois números sobre o próprio fechamento, e nenhum deles opinião.
 *
 * **A pergunta que ela responde.** Quem abre esta tela quer saber, antes de
 * discutir qualquer linha, *o quanto dá para confiar neste mês*. A resposta
 * honesta são duas perguntas separadas, e confundi-las é o que faz um painel
 * parecer mais firme do que é:
 *
 * 1. **Precisão** — do dinheiro que o sistema conseguiu conferir, quanto bate?
 *    É a medida da conta.
 * 2. **Lastro** — do dinheiro que o fechamento move, quanto tem contrapartida
 *    num documento que **não** o produziu? É a medida da evidência.
 *
 * As duas caminham em direções opostas com frequência, e é por isso que são
 * duas. Um fechamento pode ter precisão de 100% com lastro baixíssimo — basta
 * conferir tudo contra o arquivo de onde os números saíram, que é uma
 * conferência que concorda consigo mesma. E pode ter lastro alto e precisão
 * ruim, que é o caso interessante: as fontes existem, são independentes, e
 * discordam.
 *
 * **Nenhum dos dois é escrito à mão.** Não há tabela de notas, não há peso
 * arbitrado, não há percentual digitado em lugar nenhum. Precisão é
 * `1 − não explicado ÷ conferido`; lastro é `com lastro cruzado ÷ movimentado`.
 * As duas saem das mesmas parcelas que a tela mostra, e mudam sozinhas quando o
 * fechamento muda. Um número de confiança que precisasse ser atualizado à mão
 * envelheceria em silêncio e seria pior que nenhum.
 *
 * **O que a aferição não mede, e diz que não mede.** Ela olha uma competência.
 * Não sabe se a regra que fechou em julho fecha em agosto, não sabe se o
 * cadastro digitado corresponde ao contrato assinado, e não sabe o que
 * nenhuma das seis fontes traz. Esses limites saem em {@link Afericao.limites},
 * por extenso, e alguns deles com o valor em dinheiro ao lado — porque um
 * limite com cifra é auditável e um limite genérico é decoração.
 */

/**
 * Se **dá para aferir** esta coluna — a pergunta que vem antes de qualquer conta.
 *
 * **O defeito que este tipo existe para não deixar voltar.** A aferição
 * calculava precisão sobre um fechamento pela metade sem saber que estava pela
 * metade. Faltando a 2ª quinzena, as três parcelas de lastro cruzado
 * (disponibilidade, outros custos, equipe de entrega) valem zero — porque as
 * três só existem lá —, e o que sobra é conjunto e desconto. A razão
 * `1 − não explicado ÷ com contrapartida` ficava **negativa**, o `Math.max(0, …)`
 * a prendia em zero, e a tela imprimia **0,0% em vermelho**: "a remuneração
 * está toda errada", quando a verdade era "ainda não tenho documento para
 * conferir".
 *
 * Trocar o clamp por `null` trataria o sintoma. A causa é que **duas perguntas
 * estavam misturadas**: *tenho dados para conferir?* e *os valores conferem?*.
 * Este tipo é a primeira; `precisao` só responde a segunda depois de a primeira
 * dar `COMPLETO`.
 */
export type Completude =
  /** Todas as fontes que a quinzena espera chegaram. A precisão pode ser calculada. */
  | "COMPLETO"
  /** Falta fonte esperada. Precisão fica `null` — e {@link Aferibilidade.faltando} diz o quê. */
  | "INCOMPLETO"
  /** Não há o que aferir nesta coluna: nenhuma parcela move dinheiro nela. */
  | "NAO_APLICAVEL";

/** Uma fonte que falta, com o endereço que quem importa precisa para agir. */
export interface FonteFaltante {
  tipo: TipoDeFonte;
  quinzena: 1 | 2;
  /** `2Art`, `03.08.20` — como quem opera a chama. */
  rotina: string;
  /** O nome por extenso, para a tela não obrigar a decorar número de rotina. */
  nome: string;
  /**
   * Por que ela falta — e as duas causas pedem coisas diferentes.
   *
   * `NAO_IMPORTADO`: a competência existe e o arquivo não chegou. É upload.
   * `QUINZENA_NAO_ABERTA`: não há competência nenhuma para esta quinzena, e
   * antes de importar é preciso abri-la.
   */
  motivo: "NAO_IMPORTADO" | "QUINZENA_NAO_ABERTA";
}

/**
 * O contrato que falta para uma quinzena ser aferível.
 *
 * **Não é uma {@link FonteFaltante}, e por isso não entra na lista delas.** As
 * duas ausências param o mesmo cálculo e pedem gestos opostos: fonte que falta
 * se resolve importando um relatório, contrato que falta se resolve digitando a
 * aba Cadastro da vigência em Remuneração — outra tela, outro papel, outro dia.
 * Empurrar uma para dentro da outra faria a tela mandar procurar um arquivo que
 * ninguém emitiu.
 *
 * **Por que ela existe.** O devido sai do contrato: sem ele, nenhuma linha da
 * quinzena tem número, e a coluna inteira vira traço. Isso era invisível — a
 * aferição só olhava relatórios, declarava o mês `COMPLETO`, e a tela mostrava
 * meia coluna vazia sem uma palavra de explicação. Uma competência real ficou
 * assim e ninguém tinha como saber por quê.
 */
export interface ContratoFaltante {
  quinzena: 1 | 2;
  /** Em que porta o cadastro parou — `SEM_VIGENCIA`, `CONTRATO_INCOMPLETO`, … */
  estado: string;
  /**
   * O que está errado e o que destrava, na frase do domínio.
   *
   * Vêm de `comoDestravar` (em `cadastro-porta.ts`) e atravessam até aqui em
   * vez de serem reescritos na tela: qual é o conserto de "faltam três linhas
   * obrigatórias" é conhecimento de negócio, e uma segunda versão dele no
   * `.tsx` seria a que ninguém testa. `null` quando o domínio não tem frase
   * para o estado.
   */
  problema: string | null;
  conserto: string | null;
}

/** A resposta à primeira pergunta: dá para conferir esta coluna? */
export interface Aferibilidade {
  completude: Completude;
  /** As fontes esperadas que não chegaram. Vazia quando `COMPLETO`. */
  faltando: FonteFaltante[];
  /**
   * As quinzenas cujo contrato não respondeu. Vazia quando `COMPLETO`.
   *
   * Separada de {@link faltando} de propósito — ver {@link ContratoFaltante}.
   */
  semContrato: ContratoFaltante[];
  /** A frase que a tela mostra no lugar do percentual. `null` quando `COMPLETO`. */
  porque: string | null;
}

/** De que qualidade é a evidência por trás de uma parcela do fechamento. */
export type ClasseDeLastro =
  /**
   * Os dois lados existem, saem de **documentos diferentes**, e a linha fecha.
   *
   * É a evidência mais forte que este produto sabe produzir: o devido sai de um
   * arquivo (o 03.08.12.09, o 03.08.18, o 2Art, o cadastro) e o demonstrado sai
   * do 03.08.20. Dois documentos que ninguém escreveu olhando o outro chegando
   * ao mesmo centavo é uma afirmação sobre a operação, não sobre a leitura.
   */
  | "CRUZADO"
  /**
   * Idem, mas a conferência é do **grupo**, não da linha.
   *
   * As cinco linhas do custo fixo dividem um número só do 03.08.20 — ele não
   * parte a frota por tipo, e o contrato parte. A soma das cinco confere; a
   * partição entre elas não é conferida por nada. Contar isto como lastro é
   * certo (há documento independente atrás do dinheiro) e contá-lo como igual a
   * `CRUZADO` seria exagero: por isso a classe é própria e o detalhamento a
   * separa.
   */
  | "CRUZADO_EM_CONJUNTO"
  /**
   * Os dois lados saem do **mesmo arquivo**.
   *
   * A devolução e o complementar negativo são lidos do 03.08.20 para montar a
   * base do devido, e lidos do 03.08.20 outra vez para montar o demonstrado.
   * Fecharem em R$ 0,00 prova que a conversão de moeda e de sinal está certa —
   * e não prova mais nada. Chamar isso de conferido inflaria o número com a
   * evidência mais fraca que existe.
   */
  | "MESMA_FONTE"
  /**
   * Devido em dinheiro, e nada do outro lado.
   *
   * Não é imprecisão: é ausência. O `DVS` da Rota vale R$ 635.168,85 no mês e o
   * 03.08.20 não tem linha que lhe corresponda. Entra no fechamento sem
   * corroboração nenhuma.
   */
  | "SEM_CONTRAPARTIDA";

/** Uma parcela do fechamento, com o lastro dela classificado. */
export interface ParcelaAferida {
  chave: string;
  nome: string;
  /**
   * O dinheiro que a parcela move, **em módulo**.
   *
   * Em módulo porque um desconto de R$ 125.271,68 é tanto dinheiro quanto uma
   * parcela de R$ 125.271,68, e uma medida de cobertura que os deixasse se
   * cancelar diria que um fechamento com desconto igual à parcela não move
   * nada. O que se está medindo é quanto do fechamento tem evidência, não
   * quanto ele paga no fim.
   */
  valor: TresColunas;
  classe: ClasseDeLastro;
  /**
   * Quanto de {@link valor} tem contrapartida em documento independente.
   *
   * Igual a `valor` na parcela inteiramente cruzada, zero na que não tem
   * contrapartida — e **entre os dois** na parcela que só é coberta em parte.
   * Hoje há uma: o `DVS`, que vale R$ 635.168,85 no mês e cujo lastro é o
   * conjunto do quadro do variável, que cobre R$ 608.614,35 dele. Os
   * R$ 26.554,50 restantes — a recarga, a noturna e as vans — não são cobertos
   * por nada, e arredondar a parcela para "coberta" ou "descoberta" perderia
   * exatamente a informação que interessa.
   */
  comLastro: TresColunas;
  /** O relatório ou cadastro que produziu o devido, como o catálogo o nomeia. */
  fonteDoDevido: string | null;
  /** A diferença que ninguém explicou, em módulo. Zero quando a parcela fecha. */
  naoExplicado: TresColunas;
  /** O que esta parcela é — a frase que a barra lateral mostra. */
  porque: string;
}

/** Um limite do que a aferição mediu, nomeado — com cifra quando tem cifra. */
export interface LimiteDaAfericao {
  titulo: string;
  texto: string;
  /** O dinheiro que o limite alcança. `null` no limite que não é de dinheiro. */
  valor: TresColunas | null;
}

export interface Afericao {
  canal: Canal;
  /** Tudo o que o fechamento move, em módulo — o denominador do lastro. */
  movimentado: TresColunas;
  /** O que tem contrapartida do outro lado — o denominador da precisão. */
  comContrapartida: TresColunas;
  /** O que tem contrapartida num documento que não produziu o devido. */
  comLastroCruzado: TresColunas;
  /** A soma das diferenças sem causa — o numerador do que falta à precisão. */
  naoExplicado: TresColunas;
  /**
   * Dá para aferir cada coluna? — a pergunta que vem **antes** da precisão.
   *
   * Ver {@link Completude}. É aqui que a tela descobre que o vermelho não é
   * erro financeiro, e é daqui que sai a lista do que falta importar.
   */
  aferibilidade: { primeira: Aferibilidade; segunda: Aferibilidade; total: Aferibilidade };
  /**
   * `1 − naoExplicado ÷ comContrapartida`, entre 0 e 1.
   *
   * **`null` sempre que a coluna não é aferível** — e é a regra que dá sentido
   * ao número. Precisão só é calculada sobre fechamento cujas fontes esperadas
   * chegaram todas; sem isso, o que a razão devolve não é uma precisão baixa, é
   * uma conta feita sobre metade dos documentos. Ver {@link aferibilidade}.
   *
   * Também `null` no canal sem painel transcrito: ele não tem precisão ruim,
   * tem precisão **indefinida**, e mostrar 0% ali afirmaria que a conta está
   * errada quando ninguém a conferiu.
   */
  precisao: TresColunas;
  /** `comLastroCruzado ÷ movimentado`, entre 0 e 1. `null` sem nada movimentado. */
  lastro: TresColunas;
  parcelas: ParcelaAferida[];
  limites: LimiteDaAfericao[];
}

const VAZIO: TresColunas = { primeira: null, segunda: null, total: null };

/**
 * Zero onde a parcela existe, nada onde ela não existe — o "fecha" medido.
 *
 * A parcela que fecha tem diferença **zero**, e zero é uma medição: os dois
 * lados existem e são iguais. Devolver `null` ali faria a soma estrita
 * ({@link somarNaoExplicado}) confundir "não diverge" com "não se sabe", e o mês
 * inteiro ficaria sem precisão por causa de uma linha que está certa.
 */
function zeroOndeExiste(valor: TresColunas): TresColunas {
  const uma = (v: number | null) => (v === null ? null : 0);
  return { primeira: uma(valor.primeira), segunda: uma(valor.segunda), total: uma(valor.total) };
}
const COLUNAS = ["primeira", "segunda", "total"] as const;
type Coluna = (typeof COLUNAS)[number];

/** Soma coluna a coluna, tratando `null` como "esta quinzena não tem". */
function acumular(a: TresColunas, b: TresColunas): TresColunas {
  const soma = (x: number | null, y: number | null) =>
    x === null && y === null ? null : centavos((x ?? 0) + (y ?? 0));
  return {
    primeira: soma(a.primeira, b.primeira),
    segunda: soma(a.segunda, b.segunda),
    total: soma(a.total, b.total),
  };
}

/** O módulo de cada coluna. `null` continua `null` — ausência não vira zero. */
function emModulo(v: TresColunas): TresColunas {
  const abs = (x: number | null) => (x === null ? null : Math.abs(x));
  return { primeira: abs(v.primeira), segunda: abs(v.segunda), total: abs(v.total) };
}

/**
 * `1 − parte ÷ todo`, coluna a coluna — **só onde a coluna é aferível**.
 *
 * `null` quando o todo é nulo ou zero: razão de denominador zero não é 0% nem
 * 100%, é uma pergunta que não foi feita.
 *
 * `null` também quando a coluna não passou na decisão de completude, e é aí que
 * mora o conserto. **Não há clamp.** O `Math.max(0, …)` que existia aqui pegava
 * uma razão negativa — sinal de que o não explicado excedia tudo o que havia
 * para conferir, isto é, de que a pergunta não fazia sentido — e a devolvia como
 * `0`, que a tela pinta de vermelho e quem lê entende como "está tudo errado".
 * Um número fora de [0,1] não é um número ruim: é um número que não devia ter
 * sido calculado, e agora não é.
 *
 * Sobra a asserção: chegando aqui com a coluna aferível, o resultado **está**
 * em [0,1] por construção — o não explicado é diferença entre parcelas que
 * estão todas dentro do denominador. Se um dia sair fora, é defeito, e o `null`
 * o deixa visível em vez de o esconder num zero.
 */
function razaoInversa(
  parte: TresColunas,
  todo: TresColunas,
  aferivel: Record<Coluna, boolean>,
): TresColunas {
  const uma = (coluna: Coluna) => {
    if (!aferivel[coluna]) return null;
    const t = todo[coluna];
    if (t === null || t === 0) return null;
    /*
      Numerador desconhecido **não é numerador zero**. `?? 0` aqui devolvia 100%
      de precisão para uma coluna cuja diferença não era somável — o mesmo
      "ausência virou zero" que este conserto existe para tirar da tela, uma
      linha abaixo de onde ele já tinha sido tirado.
    */
    const parcial = parte[coluna];
    if (parcial === null) return null;
    const razao = 1 - parcial / t;
    return razao < 0 || razao > 1 ? null : razao;
  };
  return { primeira: uma("primeira"), segunda: uma("segunda"), total: uma("total") };
}

/** `parte ÷ todo`, coluna a coluna, com a mesma disciplina do denominador nulo. */
function razao(parte: TresColunas, todo: TresColunas): TresColunas {
  const uma = (p: number | null, t: number | null) =>
    t === null || t === 0 ? null : Math.max(0, Math.min(1, (p ?? 0) / t));
  return {
    primeira: uma(parte.primeira, todo.primeira),
    segunda: uma(parte.segunda, todo.segunda),
    total: uma(parte.total, todo.total),
  };
}

/**
 * A soma das diferenças sem causa — que **se recusa a tratar desconhecido como zero**.
 *
 * Uma parcela que fecha contribui zero, e zero é medido: os dois lados existem e
 * são iguais. Uma parcela cuja diferença **não é calculável naquela coluna** —
 * porque falta um dos lados — contribui desconhecido, e desconhecido contamina a
 * soma inteira: não dá para dizer quanto o mês tem de divergência sem explicação
 * se uma das parcelas dele não tem diferença apurável.
 *
 * `somar` genérico não serve aqui porque ele trata `null` como zero para poder
 * somar colunas que só uma quinzena tem — o que é certo lá e errado aqui.
 *
 * A parcela que **não existe** naquela coluna (a equipe de entrega na 1ª
 * quinzena, por exemplo) é pulada: ela não tem diferença por não ter valor, e
 * isso não é ignorância, é ausência de assunto.
 */
function somarNaoExplicado(parcelas: ParcelaAferida[]): TresColunas {
  const daColuna = (c: Coluna): number | null => {
    let soma = 0;
    for (const p of parcelas) {
      if (p.valor[c] === null) continue;
      const diferenca = p.naoExplicado[c];
      if (diferenca === null) return null;
      soma += diferenca;
    }
    return centavos(soma);
  };
  return { primeira: daColuna("primeira"), segunda: daColuna("segunda"), total: daColuna("total") };
}

/**
 * A primeira pergunta, respondida para uma quinzena: **dá para conferir?**
 *
 * A resposta sai das fontes que a quinzena espera e das que chegaram — regra do
 * processo, não desta função (ver `FONTES_DA_QUINZENA`). Falta de fonte esperada
 * ganha de tudo: uma quinzena com documento faltando é incompleta mesmo que as
 * parcelas que ela tem fechem perfeitamente, porque o que falta pode ser
 * exatamente o que não fecharia.
 */
function aferibilidadeDaQuinzena(
  quinzena: { quinzena: 1 | 2; competenciaId: string | null; fontes: FonteDaQuinzena[] } | null,
  temParcela: boolean,
  /**
   * Em que porta o cadastro desta quinzena parou. `null` quando ele respondeu —
   * ou quando não há quinzena para perguntar. Ver {@link ContratoFaltante}.
   */
  contrato: ContratoFaltante | null,
): Aferibilidade {
  /*
    Sem sequer a linha da quinzena não se afirma completude nenhuma. É o mesmo
    `null` do resto do módulo: não saber é diferente de estar tudo lá.
  */
  if (!quinzena) {
    return {
      completude: "INCOMPLETO",
      faltando: [],
      semContrato: [],
      porque:
        "Não há informação sobre os relatórios desta quinzena, e sem ela não dá para " +
        "afirmar que o fechamento está completo.",
    };
  }

  const faltando: FonteFaltante[] = quinzena.fontes
    .filter((f) => f.estado === "AUSENTE")
    .map((f) => ({
      tipo: f.tipo,
      quinzena: quinzena.quinzena,
      rotina: f.rotina,
      nome: DESCRICAO_DA_FONTE[f.tipo].nome,
      /*
        As duas causas pedem coisas diferentes de quem lê: sem competência, o
        próximo passo é abrir a quinzena; com ela, é enviar o arquivo.
      */
      motivo: quinzena.competenciaId ? ("NAO_IMPORTADO" as const) : ("QUINZENA_NAO_ABERTA" as const),
    }));

  /*
    As duas ausências entram juntas, e nenhuma esconde a outra.

    Quem está sem o 03.08.20 **e** sem a aba do cadastro precisa dos dois; uma
    tela que mostrasse um de cada vez faria a pessoa importar o relatório para
    só então descobrir que o devido continua sem sair. É a mesma razão pela qual
    `PorQueNaoTemDevido` já mostrava as três portas do cadastro de uma vez.
  */
  const semContrato = contrato ? [contrato] : [];

  if (faltando.length > 0 || semContrato.length > 0) {
    return {
      completude: "INCOMPLETO",
      faltando,
      semContrato,
      porque: porqueIncompleto(Boolean(quinzena.competenciaId), faltando.length > 0, semContrato.length > 0),
    };
  }

  /* Sem parcela que mova dinheiro não há o que conferir — e isso não é falha. */
  if (!temParcela) {
    return {
      completude: "NAO_APLICAVEL",
      faltando: [],
      semContrato: [],
      porque: "Nada a aferir nesta coluna: nenhuma parcela move dinheiro nela.",
    };
  }

  return { completude: "COMPLETO", faltando: [], semContrato: [], porque: null };
}

/**
 * A frase de "por que incompleto", que nomeia **o que** falta.
 *
 * Existe separada porque as três combinações pedem gestos diferentes, e uma
 * frase genérica ("fechamento incompleto") manda quem lê descobrir sozinho se o
 * próximo passo é importar, abrir a quinzena ou digitar o cadastro.
 */
function porqueIncompleto(temCompetencia: boolean, faltaFonte: boolean, faltaContrato: boolean): string {
  if (!temCompetencia) return "Fechamento incompleto: esta quinzena ainda não foi aberta.";
  if (faltaFonte && faltaContrato) {
    return (
      "Fechamento incompleto: faltam relatórios desta quinzena e o cadastro dela não " +
      "respondeu — sem contrato não há devido, e sem devido não há o que conferir."
    );
  }
  if (faltaContrato) {
    return (
      "Fechamento incompleto: o cadastro desta quinzena não respondeu. Sem contrato não " +
      "há devido, e as linhas dela ficam em branco — não em zero."
    );
  }
  return "Fechamento incompleto: faltam relatórios desta quinzena.";
}

/**
 * A mesma pergunta para a coluna do mês, que é as duas quinzenas juntas.
 *
 * **Um mês só é aferível se as duas metades forem.** Não basta a metade que
 * está na tela fechar: a coluna do total soma as duas, e um total conferido
 * contra meia pilha de documentos é exatamente o número que este conserto
 * existe para não imprimir.
 */
function aferibilidadeDoMes(primeira: Aferibilidade, segunda: Aferibilidade): Aferibilidade {
  const faltando = [...primeira.faltando, ...segunda.faltando];
  const semContrato = [...primeira.semContrato, ...segunda.semContrato];
  if (
    faltando.length > 0 ||
    semContrato.length > 0 ||
    primeira.completude === "INCOMPLETO" ||
    segunda.completude === "INCOMPLETO"
  ) {
    return {
      completude: "INCOMPLETO",
      faltando,
      semContrato,
      porque:
        semContrato.length > 0 && faltando.length === 0
          ? "Fechamento incompleto: o mês só é aferível com as duas quinzenas contratadas."
          : "Fechamento incompleto: o mês só é aferível com as duas quinzenas completas.",
    };
  }
  if (primeira.completude === "NAO_APLICAVEL" && segunda.completude === "NAO_APLICAVEL") {
    return {
      completude: "NAO_APLICAVEL",
      faltando: [],
      semContrato: [],
      porque: "Nada a aferir neste mês: nenhuma parcela move dinheiro.",
    };
  }
  return { completude: "COMPLETO", faltando: [], semContrato: [], porque: null };
}

/** O valor de uma coluna, ou zero — para somar quando a ausência não é o assunto. */
const ou0 = (v: TresColunas, c: Coluna) => v[c] ?? 0;

/** A soma das colunas de uma lista, com `null` onde nenhuma parcela tinha valor. */
function somar(valores: TresColunas[]): TresColunas {
  if (valores.length === 0) return VAZIO;
  return valores.reduce(acumular, VAZIO);
}

/**
 * O contrato que falta numa quinzena — ou `null` quando não falta.
 *
 * **Só se cobra contrato de quinzena aberta.** Sem competência não há período
 * para o cadastro responder, e a pendência a mostrar é outra: abrir a quinzena.
 * Cobrar as duas de uma vez faria a tela pedir um cadastro para um período que
 * ainda não existe.
 *
 * O diagnóstico chega pronto de `CanalDoResumo.cadastro`, que é o mesmo que
 * `PorQueNaoTemDevido` usa — as duas telas dizem a mesma coisa porque leem o
 * mesmo campo, e não porque alguém sincronizou dois textos.
 */
function contratoFaltanteDaQuinzena(
  quinzena: 1 | 2,
  daQuinzena: { competenciaId: string | null } | null,
  cadastro: CadastroNaTela | null,
): ContratoFaltante | null {
  if (!daQuinzena?.competenciaId) return null;
  if (!cadastro || cadastro.estado === "RESPONDEU") return null;
  return {
    quinzena,
    estado: cadastro.estado,
    problema: cadastro.destrava?.problema ?? null,
    conserto: cadastro.destrava?.conserto ?? null,
  };
}

/**
 * Afere um canal do resumo.
 *
 * **O canal sem painel não é aferido com nota zero — ele é aferido como não
 * conferido.** São coisas diferentes e a tela precisa distingui-las: o AS tem
 * verba do 03.08.20 e não tem de-para transcrito, então o dinheiro dele é
 * movimentado e não é conferido por nada. Precisão fica `null` (ninguém errou
 * uma conta que ninguém fez) e lastro fica 0 (não há documento cruzado atrás
 * daquele dinheiro), com o motivo escrito nos limites.
 */
export function aferir(
  canal: CanalDoResumo,
  /**
   * As duas quinzenas do mês, com o estado das fontes de cada uma.
   *
   * Entra por parâmetro porque a informação é **do mês**, não do canal: os
   * relatórios chegam por competência e valem para os dois canais. Passá-la
   * daqui é o que separa "os valores não conferem" de "ainda não tenho os
   * documentos" — as duas perguntas que este módulo existe para não misturar.
   *
   * Lista vazia é o caso de quem chama sem saber, e aí nenhuma coluna é
   * declarada completa: presumir que está tudo lá é justamente o defeito.
   */
  quinzenas: ResumoDoMes["quinzenas"],
): Afericao {
  const daQuinzena = (n: 1 | 2) => quinzenas.find((q) => q.quinzena === n) ?? null;
  const parcelas: ParcelaAferida[] = [];
  const limites: LimiteDaAfericao[] = [];

  if (!canal.comparado) {
    const movimentado = emModulo(canal.emitido);
    const zero = { primeira: 0, segunda: 0, total: 0 };
    limites.push(
      canal.semPainel === "CANAL_SEM_CATALOGO"
        ? {
            titulo: `O painel do ${canal.canal} não foi transcrito`,
            texto:
              `Os rótulos do quadro do ${canal.canal} na planilha nunca foram capturados, e ` +
              "escrevê-los por analogia com os da Rota inventaria a metade que falta. Sem " +
              "de-para não há demonstrado, e sem demonstrado não há o que subtrair: todo o " +
              "dinheiro deste canal entra no fechamento sem conferência. É trabalho nosso, " +
              "não de quem importa.",
            valor: movimentado,
          }
        : {
            titulo: "Sem devido para comparar",
            texto:
              "Não há cadastro vigente que produza o devido deste canal, e comparar o " +
              "03.08.20 com a releitura dele mesmo seria uma conferência que concorda " +
              "consigo mesma. O dinheiro aparece; a conferência, não.",
            valor: movimentado,
          },
    );
    /*
      Sem painel não há o que conferir, e isso é `NAO_APLICAVEL` — não
      `INCOMPLETO`. A diferença é de trabalho: incompleto pede arquivo,
      não aplicável pede transcrição (ou nada). O limite acima diz qual.
    */
    const naoSeAplica: Aferibilidade = {
      completude: "NAO_APLICAVEL",
      faltando: [],
      semContrato: [],
      porque: limites[0]!.titulo,
    };
    return {
      canal: canal.canal,
      aferibilidade: { primeira: naoSeAplica, segunda: naoSeAplica, total: naoSeAplica },
      movimentado,
      comContrapartida: VAZIO,
      comLastroCruzado: zero,
      naoExplicado: VAZIO,
      precisao: VAZIO,
      lastro: razao(zero, movimentado),
      parcelas: [],
      limites,
    };
  }

  const painel = canal.comparado;

  /*
    Os quadros que **pagam** e os que **abrem**. A separação é do motor
    (`QuadroDoMapa.detalha`), não desta função: o quadro do variável não soma
    dinheiro novo, ele abre o `DVS` que o quadro do fixo já paga. Aferir os
    quatro somaria o mesmo dinheiro duas vezes, e a planilha repete duas linhas
    de desconto no quadro aberto, o que somaria uma terceira.
  */
  const queAbrem = painel.quadros.filter((q) => q.detalha !== null);
  const quePagam = painel.quadros.filter((q) => q.detalha === null);

  /** O lastro que um quadro aberto oferece à linha que ele detalha. */
  const lastroDoDetalhe = (chaveDaLinha: string, quadroDaLinha: string) => {
    const aberto = queAbrem.find(
      (q) => q.detalha!.chave === chaveDaLinha && q.detalha!.quadro === quadroDaLinha,
    );
    if (!aberto) return null;
    /*
      Só os conjuntos e as parcelas próprias do quadro aberto — os descontos
      dele são as mesmas linhas do quadro de cima, repetidas pela planilha, e
      contá-las aqui seria contar de novo o desconto que já está no pagador.
    */
    const cobertura = somar([
      ...aberto.conjuntos.map((c) => emModulo(c.devido)),
      ...aberto.linhas
        .filter((l) => !l.conjunto && l.papel === "PARCELA")
        .map((l) => emModulo(l.devido)),
    ]);
    const naoExplicado = somar([
      ...aberto.conjuntos.filter((c) => c.auditar).map((c) => emModulo(c.diferenca)),
      ...aberto.linhas
        .filter((l) => !l.conjunto && l.papel === "PARCELA" && l.auditar)
        .map((l) => emModulo(l.diferenca)),
    ]);
    return { quadro: aberto, cobertura, naoExplicado };
  };

  for (const quadro of quePagam) {
    for (const conjunto of quadro.conjuntos) {
      const membros = quadro.linhas.filter((l) => l.conjunto?.chave === conjunto.chave);
      const fontes = [
        ...new Set(
          membros
            .map((l) => procedenciaDoMotor(quadro.quadro, l.chave)?.fonteOperacional)
            .filter((f): f is string => Boolean(f)),
        ),
      ];
      /*
        Se **alguma** das fontes do grupo for o próprio 03.08.20, o grupo inteiro
        deixa de ser cruzado. Um grupo é tão independente quanto o membro menos
        independente dele: bastaria uma parcela vinda do demonstrativo para a
        soma passar a se conferir em parte contra si mesma.
      */
      const cruzado = fontes.length > 0 && !fontes.includes(FONTE_DO_DEMONSTRATIVO);
      const valor = emModulo(conjunto.devido);
      parcelas.push({
        chave: conjunto.chave,
        nome: conjunto.nome,
        valor,
        classe: cruzado ? "CRUZADO_EM_CONJUNTO" : "MESMA_FONTE",
        comLastro: cruzado ? valor : { primeira: 0, segunda: 0, total: 0 },
        fonteDoDevido: fontes.join(" + ") || null,
        naoExplicado: conjunto.auditar ? emModulo(conjunto.diferenca) : zeroOndeExiste(valor),
        porque:
          `${membros.length} linhas dividem um número só do 03.08.20 — ele não parte este ` +
          "quadro como o contrato parte. A soma delas confere; a partição entre elas, não.",
      });
    }

    for (const linha of quadro.linhas) {
      if (linha.conjunto) continue;
      const valor = emModulo(linha.devido);
      /* Linha sem devido em coluna nenhuma não move dinheiro e não é aferida. */
      if (COLUNAS.every((c) => (valor[c] ?? 0) === 0)) continue;

      const procedencia = procedenciaDoMotor(quadro.quadro, linha.chave);
      const detalhe = lastroDoDetalhe(linha.chave, quadro.quadro);
      const temDemonstrado = COLUNAS.some((c) => linha.demonstrado[c] !== null);
      const daPropriaFonte = procedencia?.fonteOperacional === FONTE_DO_DEMONSTRATIVO;

      /*
        A linha sem demonstrado próprio ainda pode ter lastro: se um quadro a
        abre, é o conjunto **dele** que a corrobora. É o caso do `DVS`.
      */
      if (!temDemonstrado && detalhe) {
        const descoberto = COLUNAS.reduce(
          (fora, c) => Math.max(fora, ou0(valor, c) - ou0(detalhe.cobertura, c)),
          0,
        );
        parcelas.push({
          chave: linha.chave,
          nome: linha.nome,
          valor,
          classe: "CRUZADO_EM_CONJUNTO",
          comLastro: detalhe.cobertura,
          fonteDoDevido: procedencia?.fonteOperacional ?? null,
          naoExplicado: detalhe.naoExplicado,
          porque:
            `O 03.08.20 não traz linha própria para ela. O lastro é o quadro "` +
            `${detalhe.quadro.titulo}", que a abre por dentro` +
            (descoberto > 0.005
              ? ` — e cobre parte dela: o resto entra no fechamento sem contrapartida.`
              : `.`),
        });
        continue;
      }

      const classe: ClasseDeLastro = !temDemonstrado
        ? "SEM_CONTRAPARTIDA"
        : daPropriaFonte
          ? "MESMA_FONTE"
          : "CRUZADO";

      parcelas.push({
        chave: linha.chave,
        nome: linha.nome,
        valor,
        classe,
        comLastro: classe === "CRUZADO" ? valor : { primeira: 0, segunda: 0, total: 0 },
        fonteDoDevido: procedencia?.fonteOperacional ?? null,
        naoExplicado: linha.auditar ? emModulo(linha.diferenca) : zeroOndeExiste(valor),
        porque:
          classe === "SEM_CONTRAPARTIDA"
            ? "O contrato produz este valor e o 03.08.20 não traz linha que lhe corresponda."
            : classe === "MESMA_FONTE"
              ? "O devido e o demonstrado saem do mesmo 03.08.20 — fechar prova a leitura e a " +
                "conversão de moeda, e não a operação."
              : `O devido sai de ${procedencia?.fonteOperacional ?? "outra fonte"} e o ` +
                "demonstrado do 03.08.20. Dois documentos independentes.",
      });
    }
  }

  const daClasse = (...classes: ClasseDeLastro[]) =>
    parcelas.filter((p) => classes.includes(p.classe));

  const movimentado = somar(parcelas.map((p) => p.valor));
  const comLastroCruzado = somar(parcelas.map((p) => p.comLastro));
  const naoExplicado = somarNaoExplicado(parcelas);
  /*
    O denominador da precisão é o que tem contra o que ser medido — o lastro
    cruzado mais o que fecha contra a própria fonte. O dinheiro sem contrapartida
    fica de fora: não há subtração que o meça, e pô-lo aqui faria a precisão cair
    por uma ausência, confundindo as duas perguntas que esta aferição separa.
  */
  const comContrapartida = acumular(
    comLastroCruzado,
    somar(daClasse("MESMA_FONTE").map((p) => p.valor)),
  );

  /* ---- os limites, com cifra onde há cifra ------------------------------ */
  const soConjunto = somar(daClasse("CRUZADO_EM_CONJUNTO").map((p) => p.comLastro));
  if (COLUNAS.some((c) => (soConjunto[c] ?? 0) > 0)) {
    limites.push({
      titulo: "Conferido em conjunto, não linha a linha",
      texto:
        "O 03.08.20 traz este dinheiro somado para várias linhas de uma vez, e a partição " +
        "entre elas vem do contrato. A soma confere; qual fatia é de qual linha não é " +
        "conferida por nada — e não será enquanto o relatório não partir o número.",
      valor: soConjunto,
    });
  }

  const mesmaFonte = somar(daClasse("MESMA_FONTE").map((p) => p.valor));
  if (COLUNAS.some((c) => (mesmaFonte[c] ?? 0) > 0)) {
    limites.push({
      titulo: "Conferido contra a própria fonte",
      texto:
        "O devido destas linhas é lido do 03.08.20 e o demonstrado também. Elas fecharem em " +
        "R$ 0,00 prova que a leitura e a conversão de moeda estão certas, e não diz nada " +
        "sobre a operação. Entram na precisão, e não no lastro.",
      valor: mesmaFonte,
    });
  }

  /*
    O descoberto é a sobra: o que a parcela move menos o que tem lastro, fora o
    que se confere contra a própria fonte. Sai por subtração e não por uma lista
    à parte, para não haver duas contagens do mesmo dinheiro.
  */
  const descoberto = {
    primeira: centavos(ou0(movimentado, "primeira") - ou0(comContrapartida, "primeira")),
    segunda: centavos(ou0(movimentado, "segunda") - ou0(comContrapartida, "segunda")),
    total: centavos(ou0(movimentado, "total") - ou0(comContrapartida, "total")),
  };
  if (COLUNAS.some((c) => (descoberto[c] ?? 0) > 0.005)) {
    limites.push({
      titulo: "Sem contrapartida em documento nenhum",
      texto:
        "O contrato manda pagar e nenhuma das seis fontes corrobora. Não é diferença — é " +
        "ausência, e por isso não aparece na precisão: não há subtração que a meça. Aparece " +
        "no lastro, que é onde a ausência de evidência deve pesar.",
      valor: descoberto,
    });
  }

  /*
    O limite que não tem cifra, e é o mais importante dos dois números.

    Ele é fixo porque a afirmação é sobre o **método**, não sobre este mês: uma
    competência não corrobora uma regra, por melhor que os números dela fechem.
    Escrevê-lo aqui, e não deixá-lo para a documentação, é o que impede a tela
    de sugerir que 99% de precisão em julho seja uma previsão sobre agosto.
  */
  limites.push({
    titulo: "Uma competência não prova uma regra",
    texto:
      "Estes dois números medem o mês que está na tela. Eles não dizem se a regra que fechou " +
      "aqui fecha no mês seguinte, e nenhuma leitura de um mês só poderia dizer — a segunda " +
      "competência é o único teste disso. Enquanto ela não vier, precisão alta é notícia boa " +
      "sobre este fechamento e não é garantia sobre o próximo.",
    valor: null,
  });

  /* ---- a decisão que vem antes do cálculo ------------------------------ */
  const temParcela = (coluna: Coluna) => parcelas.some((p) => (p.valor[coluna] ?? 0) > 0);
  /*
    O contrato só é cobrado de quinzena que **existe**: perguntar pelo cadastro
    de uma competência que ninguém abriu somaria uma segunda pendência à
    primeira, e as duas se resolvem na mesma tela, na ordem — abrir, depois
    cadastrar. Ver `contratoFaltanteDaQuinzena`.
  */
  const primeira = aferibilidadeDaQuinzena(
    daQuinzena(1),
    temParcela("primeira"),
    contratoFaltanteDaQuinzena(1, daQuinzena(1), canal.cadastro?.primeira ?? null),
  );
  const segunda = aferibilidadeDaQuinzena(
    daQuinzena(2),
    temParcela("segunda"),
    contratoFaltanteDaQuinzena(2, daQuinzena(2), canal.cadastro?.segunda ?? null),
  );
  const aferibilidade = { primeira, segunda, total: aferibilidadeDoMes(primeira, segunda) };

  /*
    O limite que nomeia o que falta, com o arquivo e a quinzena de cada um.
    Sem cifra de propósito: o que falta não tem valor conhecido — é justamente
    o que não se sabe. Pôr um número ali seria inventar o que o arquivo traria.
  */
  const faltando = aferibilidade.total.faltando;
  if (faltando.length > 0) {
    limites.unshift({
      titulo: "Faltam dados para aferir",
      texto: faltando
        .map(
          (f) =>
            `${f.rotina} · ${f.quinzena}ª quinzena — ` +
            (f.motivo === "NAO_IMPORTADO" ? "não importado" : "quinzena não aberta"),
        )
        .join(" · "),
      valor: null,
    });
  }

  /*
    E o limite do contrato, separado do de cima — porque é outra tela e outro
    gesto. Vem **antes** na pilha por ser o que trava mais: sem contrato a
    quinzena inteira fica sem devido, enquanto um relatório que falta tira uma
    linha. Quem lê precisa ver primeiro o que apaga a coluna.
  */
  const semContrato = aferibilidade.total.semContrato;
  if (semContrato.length > 0) {
    limites.unshift({
      titulo: "Falta o cadastro de uma quinzena",
      texto:
        semContrato
          .map(
            (c) =>
              `${c.quinzena}ª quinzena — ${c.problema ?? "o cadastro não respondeu"}`,
          )
          .join(" · ") +
        " Sem contrato não sai devido: as linhas dessa quinzena ficam em branco, e branco " +
        "aqui é ainda não dá para saber — não é zero.",
      valor: null,
    });
  }

  return {
    canal: canal.canal,
    aferibilidade,
    movimentado,
    comContrapartida,
    comLastroCruzado,
    naoExplicado,
    /*
      A precisão só é calculada onde a coluna passou na decisão acima. É o
      conserto inteiro numa linha: sem base, `null` — nunca zero.
    */
    precisao: razaoInversa(naoExplicado, comContrapartida, {
      primeira: primeira.completude === "COMPLETO",
      segunda: segunda.completude === "COMPLETO",
      total: aferibilidade.total.completude === "COMPLETO",
    }),
    /*
      O lastro continua sendo calculado no fechamento incompleto, e de propósito:
      ele mede **cobertura de evidência**, não correção. Num mês pela metade ele
      é uma verdade sobre a metade que existe, e a tela o marca como provisório
      pela completude. Zerá-lo esconderia que o que chegou tem documento atrás.
    */
    lastro: razao(comLastroCruzado, movimentado),
    parcelas,
    limites,
  };
}

/** O que cada classe de lastro se chama na tela, e em que ordem ela aparece. */
export const CLASSES_DE_LASTRO: { classe: ClasseDeLastro; rotulo: string; conta: boolean }[] = [
  { classe: "CRUZADO", rotulo: "Cruzado — dois documentos independentes", conta: true },
  { classe: "CRUZADO_EM_CONJUNTO", rotulo: "Cruzado, mas só em conjunto", conta: true },
  { classe: "MESMA_FONTE", rotulo: "Conferido contra a própria fonte", conta: false },
  { classe: "SEM_CONTRAPARTIDA", rotulo: "Sem contrapartida", conta: false },
];

/** O total por classe, para a barra lateral não somar nada no navegador. */
export function porClasse(
  afericao: Afericao,
): {
  classe: ClasseDeLastro;
  rotulo: string;
  conta: boolean;
  valor: TresColunas;
  comLastro: TresColunas;
  parcelas: number;
}[] {
  return CLASSES_DE_LASTRO.map(({ classe, rotulo, conta }) => {
    const dela = afericao.parcelas.filter((p) => p.classe === classe);
    return {
      classe,
      rotulo,
      conta,
      valor: somar(dela.map((p) => p.valor)),
      /* Quanto da classe de fato tem lastro — igual a `valor` exceto no `DVS`. */
      comLastro: somar(dela.map((p) => p.comLastro)),
      parcelas: dela.length,
    };
  }).filter((c) => c.parcelas > 0);
}

/* `ou0` fica exportado para o teste poder somar as colunas sem repetir a regra. */
export { ou0 as valorDaColuna };

/**
 * Enxerta a aferição de cada canal num resumo já montado.
 *
 * **Chamada pela rota, e não por `lerResumoDoMes`** — a mesma escolha de
 * `resumoComReferencia`, e pelo mesmo motivo: mantém `persistencia.ts` sem
 * saber que a aferição existe, e mantém a aferição como uma leitura *sobre* o
 * resumo, nunca uma entrada dele. Um percentual que pudesse influenciar o
 * cálculo deixaria de ser medida e viraria parâmetro.
 *
 * É pura e idempotente: aferir duas vezes dá o mesmo resultado, porque ela só
 * lê. Nenhum campo de `devido`, `demonstrado` ou `diferenca` é tocado.
 */
export function resumoAferido(resumo: ResumoDoMes): ResumoDoMes {
  return {
    ...resumo,
    canais: resumo.canais.map((canal) => ({
      ...canal,
      afericao: aferir(canal, resumo.quinzenas),
    })),
  };
}
