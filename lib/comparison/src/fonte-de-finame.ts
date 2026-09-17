/**
 * AS DUAS FONTES DA AUDITORIA DE FINAME — e o que cada uma autoriza dizer.
 *
 * ---------------------------------------------------------------------------
 * Por que uma fonte, e não uma segunda tela
 * ---------------------------------------------------------------------------
 * A pergunta da Auditoria de FINAME não muda: **quanto custa o financiamento
 * desta frota, e o que se moveu?** O que muda é o fato contra o qual ela é
 * respondida — a planilha que a Ambev remunera, ou o custo que a operação
 * incorreu. Duas telas responderiam a mesma pergunta com dois códigos, e o dia
 * em que uma ganhasse a coluna de aluguel do implemento a outra ficaria para
 * trás sem ninguém perceber.
 *
 * Então é **uma** tela com duas fontes, e este arquivo é o contrato entre elas:
 * o vocabulário, a semântica de cada palavra e as três coisas que mudam de uma
 * para a outra — o eixo do tempo, a direção da comparação e o nome das coisas.
 *
 * ---------------------------------------------------------------------------
 * As duas fontes **não** fazem a mesma comparação, e isto é o ponto
 * ---------------------------------------------------------------------------
 * É o erro que este arquivo existe para impedir. "Trocar a fonte" sugere que
 * basta ler outra tabela com o mesmo formato, e não é isso:
 *
 * | | REMUNERADO | REAL |
 * |---|---|---|
 * | compara | vigência A × vigência B | remunerado × realizado |
 * | no tempo | duas vigências (quinzenas) | **uma** competência mensal |
 * | pergunta | o que mudou entre as duas entregas? | o remunerado cobriu o custo? |
 * | direção | reversível — `Inverter` troca as pontas | **fixa** — remunerado − realizado |
 *
 * A direção fixa do REAL é a razão de `permiteInverter` existir. Inverter uma
 * comparação entre duas vigências troca o sinal e a base do percentual, e as
 * duas leituras são legítimas: quem escolhe é quem lê. Inverter *remunerado ×
 * realizado* produziria "déficit" escrito sobre uma sobra — não é outra leitura
 * do mesmo fato, é o fato ao contrário. O botão some, e some daqui: uma tela
 * que decidisse isso sozinha voltaria a mostrá-lo no dia em que alguém
 * acrescentasse o terceiro modo.
 *
 * ---------------------------------------------------------------------------
 * A semântica mora aqui porque ela **erra calado**
 * ---------------------------------------------------------------------------
 * Um número errado tem chance de ser notado; um rótulo errado, não. "Novos na
 * vigência" sobre uma competência realizada continua sendo uma frase bem
 * formada, e quem lê acredita. Por isso cada palavra que muda com a fonte está
 * escrita uma vez, neste arquivo, e é lida pela tela **e** pelos testes — o
 * teste que prova que a troca de fonte troca os textos compara contra esta
 * tabela, não contra strings redigitadas nele.
 */

/**
 * A fonte analisada.
 *
 * `REMUNERADO` é o que a Ambev paga — as planilhas de remuneração, que é o
 * acervo inteiro que este produto sempre leu. `REAL` é o custo que a operação
 * incorreu, e a leitura dele é sempre **contra** o remunerado da mesma
 * competência (ver {@link ComparacaoDaFonte}).
 */
export type FonteDeFiname = "REMUNERADO" | "REAL";

/**
 * A fonte de um link que não diz qual quer.
 *
 * Retrocompatibilidade não é cortesia aqui: todo link para esta tela gravado
 * antes desta mudança — no Monitor Custo Fixo, num e-mail, no favorito de quem
 * audita — não tem o parâmetro, e abrir em REAL mudaria o dado sob um endereço
 * que prometia outro.
 */
export const FONTE_PADRAO: FonteDeFiname = "REMUNERADO";

/**
 * Como a fonte se escreve no endereço.
 *
 * Minúsculas porque é o que o resto da URL desta tela usa (`modo=comparacao`,
 * `recorteEvolucao=TODOS` é a exceção herdada), e estável porque links diretos
 * são um requisito: o valor aqui não pode mudar de grafia sem quebrar endereços
 * já compartilhados.
 */
const NO_ENDERECO: Record<FonteDeFiname, string> = {
  REMUNERADO: "remunerado",
  REAL: "real",
};

/**
 * A chave do parâmetro no endereço.
 *
 * **Não é `modo`**, e a razão é concreta: `modo` já existe nesta tela e nas
 * outras três auditorias de custo fixo, valendo `comparacao | evolucao`
 * (`lib/modo-da-auditoria.ts`, na interface). Reaproveitar a chave faria
 * `modo=real` e `modo=evolucao` disputarem o mesmo espaço — e um link com as
 * duas intenções seria impossível de escrever. `fonte` é chave própria,
 * ortogonal, e atravessa a Evolução sem tocá-la.
 */
export const CHAVE_DA_FONTE = "fonte";

/** Se o texto é uma fonte que este módulo reconhece. */
export function ehFonteDeFiname(valor: unknown): valor is FonteDeFiname {
  return valor === "REMUNERADO" || valor === "REAL";
}

/**
 * A fonte que o endereço pede — e a recusa de adivinhar.
 *
 * Valor ausente, vazio ou adulterado cai em {@link FONTE_PADRAO}. É a mesma
 * doutrina de `ehModoDaAuditoria`: nunca uma tela em branco nem um erro de
 * validação na cara de quem só clicou num link antigo. O que **não** acontece é
 * o contrário — o servidor não confia neste valor; ver `validarFonte`.
 */
export function fonteDoParametro(valor: string | null | undefined): FonteDeFiname {
  const limpo = (valor ?? "").trim().toLowerCase();
  if (limpo === NO_ENDERECO.REAL) return "REAL";
  if (limpo === NO_ENDERECO.REMUNERADO) return "REMUNERADO";
  return FONTE_PADRAO;
}

/** Como esta fonte se escreve no endereço. O inverso de {@link fonteDoParametro}. */
export function parametroDaFonte(fonte: FonteDeFiname): string {
  return NO_ENDERECO[fonte];
}

/**
 * A fonte que o **servidor** aceita — que não é a que o cliente mandou.
 *
 * `fonteDoParametro` é indulgente porque atende quem clicou num link; esta é
 * estrita porque atende uma rota. Um cliente que mande `fonte=realizado`,
 * `fonte=REAL%20`, ou que invente uma terceira está pedindo algo que este
 * produto não sabe responder, e responder "remunerado" a esse pedido seria
 * devolver dados de uma fonte que ninguém pediu sob o nome de outra.
 *
 * Devolve `null` para o que não reconhece; a rota traduz em 400.
 */
export function validarFonte(valor: unknown): FonteDeFiname | null {
  if (valor === undefined || valor === null || valor === "") return FONTE_PADRAO;
  if (typeof valor !== "string") return null;
  if (valor === NO_ENDERECO.REMUNERADO) return "REMUNERADO";
  if (valor === NO_ENDERECO.REAL) return "REAL";
  return null;
}

// ---------------------------------------------------------------------------
// O que muda de uma fonte para a outra
// ---------------------------------------------------------------------------

/**
 * O eixo do tempo de cada fonte.
 *
 * `VIGENCIA` é o eixo do acervo remunerado: entregas datadas, que no mês viram
 * quinzenas quando são duas (`rotulosDasVigencias`). `COMPETENCIA` é o eixo do
 * realizado: mês fechado, e **só** mês.
 *
 * A distinção existe para impedir a fabricação que o produto teria feito por
 * conveniência — desenhar "1ª quinzena" ao lado de um número que só existe
 * mensalmente. Ver {@link GRANULARIDADE_DA_FONTE}.
 */
export type EixoDoTempo = "VIGENCIA" | "COMPETENCIA";

/** O que a comparação de cada fonte confronta. */
export type ComparacaoDaFonte =
  /** Duas entregas remuneradas — o que mudou entre elas. */
  | "ENTRE_VIGENCIAS"
  /** O remunerado e o realizado da mesma competência — se um cobriu o outro. */
  | "REMUNERADO_CONTRA_REALIZADO";

/**
 * A granularidade **verdadeira** de cada fonte, e por que ela é declarada.
 *
 * O remunerado é quinzenal porque o acervo entrega duas vigências no mês — mas
 * repare que o *valor* dele é mensal (a parcela FINAME é MENSAL; ver
 * `docs/AUDITORIA-PERIODICIDADE.md` e `consolidarCompetencia`). As duas coisas
 * convivem: a entrega é quinzenal, o dinheiro é mensal, e é exatamente essa
 * diferença que a consolidação mensal resolve — sem somar as duas quinzenas.
 *
 * O realizado é mensal na entrega e mensal no valor. Não há quinzena para
 * mostrar, e inventar uma seria escrever uma precisão que a fonte não tem.
 */
export const GRANULARIDADE_DA_FONTE: Record<FonteDeFiname, EixoDoTempo> = {
  REMUNERADO: "VIGENCIA",
  REAL: "COMPETENCIA",
};

/**
 * Tudo que muda de nome quando a fonte muda.
 *
 * Uma tabela, e não `if (fonte === "REAL")` espalhado: a tela lê daqui, os
 * testes leem daqui, e acrescentar uma palavra é acrescentar uma linha em um
 * lugar. Enquanto isto não existia, "Novos na vigência" aparecia sobre uma
 * competência realizada — uma frase bem formada dizendo uma coisa falsa.
 */
export interface SemanticaDaFonte {
  /** Como a fonte se chama no seletor. */
  rotulo: string;
  /** A pastilha ao lado do título. */
  selo: string;
  /** A linha discreta sob a descrição da página. */
  linhaDeContexto: string;
  /** Como se chama uma ponta do tempo nesta fonte, no singular. */
  periodo: string;
  /** O mesmo, no plural. */
  periodos: string;
  /** O nome do dinheiro desta fonte. */
  valor: string;
  /** O eixo do tempo, e portanto o seletor que a tela desenha. */
  eixo: EixoDoTempo;
  /** O que a comparação confronta. */
  comparacao: ComparacaoDaFonte;
  /**
   * Se a direção da comparação pode ser trocada.
   *
   * Ver o cabeçalho deste arquivo: no REAL a direção é o significado.
   */
  permiteInverter: boolean;
}

export const SEMANTICA_DA_FONTE: Record<FonteDeFiname, SemanticaDaFonte> = {
  REMUNERADO: {
    rotulo: "Remunerado",
    selo: "Comparação entre vigências",
    linhaDeContexto: "Fonte atual: comparação entre duas vigências remuneradas pela Ambev",
    periodo: "vigência",
    periodos: "vigências",
    valor: "valor remunerado",
    eixo: "VIGENCIA",
    comparacao: "ENTRE_VIGENCIAS",
    permiteInverter: true,
  },
  REAL: {
    rotulo: "Real",
    selo: "Remunerado × Realizado",
    linhaDeContexto:
      "Comparação atual: valor remunerado pela Ambev × valor efetivamente realizado pela operação",
    periodo: "competência",
    periodos: "competências",
    valor: "custo realizado",
    eixo: "COMPETENCIA",
    comparacao: "REMUNERADO_CONTRA_REALIZADO",
    permiteInverter: false,
  },
};

/**
 * Os rótulos que a tabela e os cartões usam, por fonte.
 *
 * Separado de {@link SEMANTICA_DA_FONTE} porque são conjuntos diferentes: no
 * REMUNERADO os cartões contam **estados de mudança** (sem alteração, novos,
 * ausentes) e no REAL contam **cobertura e resultado** (sobra, déficit,
 * conciliados). Não são os mesmos cartões com outro nome — e reaproveitar
 * "Sem alteração" no REAL foi explicitamente recusado: ali não há duas
 * vigências entre as quais algo pudesse deixar de mudar.
 */
export const TITULOS_DO_REMUNERADO = {
  veiculosComparados: "Veículos comparados",
  semAlteracao: "Sem alteração",
  comAlteracao: "Veículos com alteração",
  novos: "Novos na vigência",
  ausentes: "Ausentes na comparada",
  impacto: "Impacto financeiro",
  totalPorPeriodo: "Valor total de FINAME por vigência",
} as const;

export const TITULOS_DO_REAL = {
  veiculosComparados: "Veículos conciliados",
  remunerado: "Remunerado na competência",
  realizado: "Realizado na competência",
  sobra: "Sobra de remuneração",
  deficit: "Déficit de remuneração",
  /*
    O nome carrega o escopo, e é a correção de fundo desta tela.

    Chamava-se "Resultado líquido". Em setembro/2026 ele mostrava −R$ 87.393,05
    — o saldo de 17 veículos conciliados — num mês de 64 veículos remunerados, e
    "líquido" se lê como *o que sobrou depois de tudo considerado*. O número
    estava certo ao centavo e a frase que ele produzia na cabeça de quem lia,
    não. Ver `docs/DEFINICOES-DO-CONFRONTO-DE-FINAME.md`.
  */
  saldoDosConciliados: "Saldo dos veículos conciliados",
  totalPorPeriodo: "FINAME remunerado × realizado por competência",
} as const;
