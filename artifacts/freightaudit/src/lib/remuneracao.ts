import { fetchJson } from "@/lib/api";

/**
 * O cliente do módulo Remuneração.
 *
 * Os tipos espelham o que `@workspace/remuneracao` produz, e são reescritos em
 * vez de importados pela mesma razão de `lib/fechamento.ts`: o bundle da
 * interface não deve carregar o motor. A montagem do cadastro roda no servidor,
 * sobre o que o acervo guardou, e a tela só a lê — um tipo duplicado é o preço
 * de a interface não poder, nem por acidente, medir alíquota por conta própria.
 */

export type Medida = "DINHEIRO" | "PERCENTUAL" | "QUANTIDADE";
export type Preenchimento = "INFORMADO" | "AUTOMATICO";
export type EstadoDaLinha = "APURADO" | "INFORMADO" | "EM_CONJUNTO" | "SEM_LASTRO";

/** O que alguém digitou da aba de Excel para uma linha do cadastro. */
export interface ValorDeclarado {
  valor: number;
  observacao: string | null;
  autor: string | null;
  informadoEm: string;
}

/**
 * O acervo e a planilha respondendo a mesma linha — e o que os separa.
 *
 * `cadastro` é o número a que o cadastro chegou sem a planilha: medido no
 * acervo, ou derivado de linhas que o foram. É por isso que ele não se chama
 * "medido" — conferir o total impresso na aba contra a soma das parcelas da
 * própria aba é uma conferência sem medida nenhuma, e é uma das mais úteis.
 */
export interface Conferencia {
  cadastro: number;
  planilha: number;
  diferenca: number;
  percentual: number | null;
  bate: boolean;
}

export interface Procedencia {
  fonte: string;
  colunas: string[];
  regra: string;
  registros: number;
}

export interface Ausencia {
  motivo: string;
  destrava: string;
  hoje?: { href: string; label: string; porque: string };
}

export interface Conjunto {
  rotulo: string;
  linhas: string[];
  valor: number;
  medida: Medida;
  procedencia: Procedencia;
  /** A soma das partes declaradas contra o par medido. Só com todas informadas. */
  conferencia: Conferencia | null;
}

export interface LinhaApurada {
  chave: string;
  rotulo: string;
  medida: Medida;
  preenchimento: Preenchimento;
  estado: EstadoDaLinha;
  valor: number | null;
  procedencia: Procedencia | null;
  ausencia: Ausencia | null;
  conjunto: Conjunto | null;
  /** O que a planilha informada diz sobre esta linha, quando alguém a preencheu. */
  declarado: ValorDeclarado | null;
  /** O do cadastro contra o da planilha. Só existe quando os dois respondem. */
  conferencia: Conferencia | null;
  /**
   * Se o **acervo** sustenta esta linha, independentemente do que a planilha
   * diga.
   *
   * `estado` não responde isso sozinho desde que a planilha passou a ser
   * informável: uma linha do par PIS + COFINS que alguém digitou sai como
   * `INFORMADO` e continua sendo sustentada pelo export.
   */
  lastroDoAcervo: boolean;
}

export interface BlocoApurado {
  titulo: string;
  resumo: string;
  linhas: LinhaApurada[];
}

export interface CadastroDaUnidade {
  blocos: BlocoApurado[];
  resumo: {
    linhas: number;
    apuradas: number;
    informadas: number;
    emConjunto: number;
    /** Linhas sem número nenhum — nem medido, nem digitado. */
    semLastro: number;
    /**
     * Linhas que o **acervo** sustenta, sozinhas ou em par.
     *
     * Não é `apuradas + emConjunto`: a linha do par que alguém informou passa a
     * `INFORMADO` e continua sendo sustentada pelo export.
     */
    comLastro: number;
    /** Linhas que o acervo e a planilha respondem — as que dá para conferir. */
    conferidas: number;
    /** Destas, quantas discordam. */
    divergentes: number;
  };
  contexto: {
    scopeHash: string;
    channel: string | null;
    label: string;
    unidade: string | null;
    scopes: { scopeType: string; code: string; name: string | null }[];
  };
  effectiveDate: string;
  periodLabel: string;
  vigencias: { effectiveDate: string; periodLabel: string }[];
  material: MaterialDaVigencia;
}

/** O que a vigência entregou, e quanto dela foi digitado à mão. */
export interface MaterialDaVigencia {
  cavalos: number;
  trechos: number;
  trechosEntregues: boolean;
  linhasInformadas: number;
}

/**
 * O que aconteceu com a linha entre uma quinzena e a outra.
 *
 * Os quatro últimos são sobre o **acervo**, não sobre o dinheiro — ver
 * `lib/remuneracao/src/comparacao.ts`. A tela os desenha diferente por isso: um
 * "+100%" que descreve uma coluna que passou a ser importada seria o número
 * mais perigoso que este módulo poderia mostrar.
 */
export type Movimento =
  | "IGUAL"
  | "SUBIU"
  | "DESCEU"
  | "GANHOU_LASTRO"
  | "PERDEU_LASTRO"
  | "SEM_COMPARACAO";

export interface Variacao {
  absoluta: number;
  /** Nulo quando a base é zero — dividir por zero não é "infinito%". */
  percentual: number | null;
}

export interface LinhaComparada {
  chave: string;
  rotulo: string;
  medida: Medida;
  preenchimento: Preenchimento;
  esquerda: LinhaApurada;
  direita: LinhaApurada;
  movimento: Movimento;
  variacao: Variacao | null;
  /**
   * As duas pontas têm número e ele não veio do mesmo lugar — uma medida no
   * acervo, a outra informada na planilha.
   *
   * A variação continua valendo, e o que ela quer dizer muda: uma frota que
   * "cai" de 62 para 56 entre julho e agosto pode ser seis caminhões que saíram
   * ou o export de um mês contra a aba do outro.
   */
  fontesDiferentes: boolean;
}

export interface BlocoComparado {
  titulo: string;
  resumo: string;
  linhas: LinhaComparada[];
}

export interface PontaDaComparacao {
  effectiveDate: string;
  periodLabel: string;
  material: MaterialDaVigencia;
}

export interface ComparacaoDeCadastros {
  blocos: BlocoComparado[];
  resumo: {
    linhas: number;
    iguais: number;
    mudaram: number;
    ganharamLastro: number;
    perderamLastro: number;
    semComparacao: number;
  };
  contexto: CadastroDaUnidade["contexto"];
  esquerda: PontaDaComparacao;
  direita: PontaDaComparacao;
  vigencias: { effectiveDate: string; periodLabel: string }[];
}

export interface UnidadeDoCadastro {
  scopeHash: string;
  canal: string | null;
  label: string;
  scopes: { scopeType: string; code: string; name: string | null }[];
  vigenciaMaisRecente: string;
  vigencias: string[];
}

export function listarUnidadesDoCadastro(): Promise<UnidadeDoCadastro[]> {
  return fetchJson<UnidadeDoCadastro[]>("/remuneracao/unidades");
}

/**
 * O que o acervo sustenta no cadastro de uma unidade.
 *
 * Quatro estados, e nenhum deles é uma nota: dizem qual das duas metades do
 * cadastro tem lastro — a frota, que vem do export de equipamento, e as
 * alíquotas, que vêm do de frete. Ver `lib/remuneracao/src/situacao.ts` para
 * por que não é um percentual sobre as trinta linhas.
 */
export type EstadoDoCadastro =
  | "FROTA_E_ALIQUOTAS"
  | "SO_FROTA"
  | "SO_ALIQUOTAS"
  | "SEM_LASTRO";

export interface SituacaoDoCadastro {
  linhas: number;
  comLastro: number;
  semLastro: number;
  frota: boolean;
  aliquotas: boolean;
  estado: EstadoDoCadastro;
  /** Linhas com número porque alguém as informou — fora de `comLastro`. */
  informadas: number;
  /** Linhas que o acervo e a planilha respondem. */
  conferidas: number;
  /** Destas, quantas discordam. */
  divergentes: number;

  /* --- as três perguntas, separadas — ver `lib/remuneracao/src/situacao.ts` */

  /**
   * Quantas linhas **podem** ter lastro documental. Onze das trinta.
   *
   * É o denominador honesto: as outras dezenove não esperam arquivo nenhum.
   * `0 de 30` dizia que faltavam trinta arquivos e mandava procurar o que não
   * existe. Ver `procedenciaPossivel`, no catálogo do domínio.
   */
  verificaveis: number;
  /** Quantas linhas o contrato exige — as vinte. */
  obrigatorias: number;
  /** Destas, quantas foram informadas. */
  obrigatoriasInformadas: number;
  /** Opcionais em branco: a premissa adotada, e não uma falta. */
  opcionaisAssumidasComoZero: number;
  /** Linhas que o motor refaz — digitá-las é conferência, não entrada. */
  calculadas: number;
  /** **O indicador principal**: este cadastro basta para calcular o devido? */
  suficienteParaCalcular: boolean;
  /** Conferências contra o acervo — evidência externa. */
  conferenciasComAcervo: number;
  /** Conferências da aba contra ela mesma — coerência de transcrição. */
  conferenciasInternas: number;
  /** Das conferências com o acervo, quantas discordam. */
  divergenciasComAcervo: number;
  /** Das internas, quantas discordam — erro de transcrição, não de fonte. */
  divergenciasInternas: number;
}

/** Uma unidade **numa vigência** — a linha da lista. */
export interface SituacaoDaUnidade {
  scopeHash: string;
  channel: string | null;
  label: string;
  unidade: string | null;
  scopes: { scopeType: string; code: string; name: string | null }[];
  /** A vigência que esta linha responde. */
  effectiveDate: string;
  periodLabel: string;
  material: MaterialDaVigencia;
  cadastro: SituacaoDoCadastro;
  /**
   * A unidade existe porque alguém a cadastrou, e não porque um export a
   * trouxe — e a tela precisa dizê-lo.
   *
   * "Sem lastro" numa unidade importada quer dizer "o arquivo veio e não
   * trouxe o que o cadastro lê", e manda procurar a coluna que falta. Numa
   * cadastrada à mão quer dizer "arquivo nenhum veio ainda", e não há o que
   * procurar. Sem esta marca as duas ficam com a mesma cara.
   */
  registradaAMao: boolean;
  /**
   * Esta linha existe **porque a planilha existe** — e por mais nada.
   *
   * Nem acervo, nem cadastro à mão: o par (unidade, operação) sumiu das duas
   * fontes que dizem quem é a unidade, e o que restou foram as células que
   * alguém digitou. Acontece quando a importação que sustentava a unidade é
   * excluída, ou quando o banco volta de um restauro sem ela.
   *
   * A linha era descartada em silêncio, e o silêncio é o defeito: os números
   * ficavam no banco sem aparecer em lugar nenhum, e quem tinha preenchido a
   * aba lia isso como "sumiu". A tela agora a mostra e diz o que houve — é a
   * única coisa honesta a dizer, e é o que permite recuperar os números.
   */
  planilhaOrfa: boolean;
}

/**
 * O nome da unidade como a lista a chama — sem o canal, e sem hash na tela.
 *
 * `unidade` é o nome que o escopo declara, e é ele que manda. Quando a unidade
 * saiu do acervo, o servidor pode não ter mais escopo nenhum para nomeá-la: o
 * rótulo então vem sendo o `scope_hash`, que é honesto no domínio (inventar um
 * nome seria pior) e ilegível numa coluna de tabela — sessenta e quatro
 * caracteres de hexadecimal onde se espera "CDD BELÉM". Nesse caso, e só nele, a
 * tela diz o que de fato sabe: que a unidade não está mais no acervo.
 *
 * Mora aqui, e não em cada tela, porque são duas as que a escrevem — a lista e
 * o painel de cadastro que abre por cima dela — e um nome que dependesse de qual
 * delas montou a frase seria a mesma unidade com dois nomes.
 */
export function nomeDaUnidade(u: {
  unidade: string | null;
  label: string;
  planilhaOrfa?: boolean;
}): string {
  if (u.unidade !== null) return u.unidade;
  if (u.planilhaOrfa) return "unidade fora do acervo";
  return u.label.split(" · ")[0] ?? u.label;
}

export interface SituacaoDasUnidades {
  /** Um cadastro por (unidade, vigência) — a linha da lista. */
  cadastros: SituacaoDaUnidade[];
  /**
   * Os totais do conjunto, contados no servidor.
   *
   * `unidades` e `cadastros` são grãos diferentes e os dois estão aqui: a
   * unidade de nove vigências é **uma** unidade e nove cadastros. Os quatro
   * estados contam cadastros, e somam `cadastros`.
   */
  resumo: {
    unidades: number;
    cadastros: number;
    frotaEAliquotas: number;
    soFrota: number;
    soAliquotas: number;
    semLastro: number;
  };
}

/** Os cadastros que o módulo conhece — um por unidade e vigência. */
export function lerSituacaoDasUnidades(): Promise<SituacaoDasUnidades> {
  return fetchJson<SituacaoDasUnidades>("/remuneracao/situacao");
}

/**
 * O estado escrito: o rótulo curto da marca e a frase que o sustenta.
 *
 * A frase não é enfeite e não é a mesma para os quatro: ela é o que separa "o
 * cadastro desta unidade não existe" de "o cadastro existe e falta a metade que
 * o export de frete traz". A primeira leitura manda procurar quem não mandou
 * arquivo; a segunda manda procurar **qual** arquivo, e são trabalhos
 * diferentes.
 */
export const ESTADO_DO_CADASTRO: Record<
  EstadoDoCadastro,
  { rotulo: string; frase: string }
> = {
  FROTA_E_ALIQUOTAS: {
    rotulo: "Frota e alíquotas",
    frase:
      "As duas metades têm lastro: a vigência entregou os cavalos e entregou os trechos com " +
      "as colunas em reais.",
  },
  SO_FROTA: {
    rotulo: "Só a frota",
    frase:
      "A frota está contada, e as alíquotas, as proporções e o resumo de impostos não têm " +
      "lastro — todos saem dos trechos.",
  },
  SO_ALIQUOTAS: {
    rotulo: "Só as alíquotas",
    frase:
      "As alíquotas estão medidas, e a frota fixa fica sem número: a vigência não entregou " +
      "cavalos, ou eles vieram sem a coluna que separa ativo de parado.",
  },
  SEM_LASTRO: {
    rotulo: "Sem lastro documental",
    frase:
      "Nenhuma das onze linhas verificáveis tem documento por trás nesta vigência — o acervo " +
      "não recebeu cavalos nem trechos. Não diz nada sobre o cadastro existir: um cadastro " +
      "digitado calcula o devido sem lastro nenhum, e perde só a conferência externa.",
  },
};

/**
 * O QUE A COLUNA `CADASTRO` RESPONDE — e o que ela deixou de responder.
 *
 * Ela mostrava o selo de lastro, vermelho, com a palavra "SEM LASTRO". A coluna
 * chama-se `Cadastro`, e quem lê uma coluna chamada Cadastro marcada de
 * vermelho entende que o cadastro não existe ou não serve — quando o que ele
 * não tem é documento por trás. As duas perguntas passaram a ter colunas
 * próprias: aqui, se o cadastro **calcula**; ao lado, quanto dele se
 * **comprova**.
 */
export function suficienciaDoCadastro(cadastro: SituacaoDoCadastro): {
  rotulo: string;
  frase: string;
  variante: "success" | "destructive";
} {
  const faltam = cadastro.obrigatorias - cadastro.obrigatoriasInformadas;
  if (cadastro.suficienteParaCalcular) {
    return {
      rotulo: "Calcula o devido",
      frase:
        `As ${cadastro.obrigatorias} linhas obrigatórias estão informadas, e é só delas que o ` +
        "contrato sai. O devido desta quinzena é calculado com este cadastro.",
      variante: "success",
    };
  }
  return {
    rotulo: `Faltam ${faltam} obrigatórias`,
    frase:
      `${faltam} das ${cadastro.obrigatorias} linhas que o contrato lê não foram informadas. ` +
      "Sem elas não há devido — e completá-las com zero produziria um número que ninguém " +
      "contratou. Abra o cadastro para ver quais.",
    variante: "destructive",
  };
}

/**
 * A chave com que se pergunta pelo cadastro de uma unidade.
 *
 * Três telas fazem a mesma pergunta ao servidor — a lista de unidades, quando
 * alguém abre uma linha; a tela do cadastro; o painel que digita a planilha — e
 * a chave é o que decide se elas compartilham a resposta ou mantêm cópias
 * próprias dela. Compartilhar é o certo: quem abre o cadastro na lista e depois
 * entra na tela de dentro o encontra pronto, e quem volta de lá reabre a linha
 * sem nova ida ao servidor. É a mesma decisão de `chaveDaCompetencia`, em
 * `lib/fechamento-tela.ts`, pela mesma razão — duas chaves para o mesmo recurso
 * dariam duas cópias que podem discordar entre si.
 *
 * Os três argumentos são exatamente o que a leitura envia: escopo, canal e
 * vigência. `null` em qualquer um deles é "o que o servidor escolher", e é
 * diferente de um valor escrito — por isso viaja na chave em vez de ser
 * omitido.
 */
export function chaveDoCadastro(
  scopeHash: string | null,
  canal: string | null,
  period: string | null,
): readonly [string, string, string | null, string | null, string | null] {
  return ["remuneracao", "cadastro", scopeHash, canal, period];
}

export function lerCadastro(pedido: {
  scopeHash?: string;
  canal?: string | null;
  period?: string;
  /**
   * Abrir o formulário de um canal que pode ainda não existir.
   *
   * Só a tela que cadastra a planilha pede assim: é onde o canal nasce, e as
   * trinta linhas em branco precisam aparecer para que alguém as preencha. Nas
   * outras leituras o canal desconhecido continua sendo 404.
   */
  canalNovo?: boolean;
  /**
   * Abrir o formulário de uma quinzena que a unidade ainda não tem.
   *
   * A outra metade de `canalNovo`, e pelo mesmo motivo: a aba de Excel da
   * quinzena nova chega antes do export dela, e as trinta linhas em branco
   * precisam aparecer para que alguém as preencha. O servidor continua exigindo
   * que a data seja começo de quinzena — dia 1 ou dia 16.
   */
  vigenciaNova?: boolean;
}): Promise<CadastroDaUnidade> {
  const query = new URLSearchParams();
  if (pedido.scopeHash) query.set("scopeHash", pedido.scopeHash);
  if (pedido.canal !== undefined && pedido.canal !== null) query.set("canal", pedido.canal);
  if (pedido.period) query.set("period", pedido.period);
  if (pedido.canalNovo) query.set("canalNovo", "1");
  if (pedido.vigenciaNova) query.set("vigenciaNova", "1");
  const sufixo = query.toString();
  return fetchJson<CadastroDaUnidade>(`/remuneracao/cadastro${sufixo ? `?${sufixo}` : ""}`);
}

/** As duas quinzenas lado a lado. Sem `de`/`ate`, as duas mais recentes. */
export function lerComparacao(pedido: {
  scopeHash?: string;
  canal?: string | null;
  de?: string;
  ate?: string;
}): Promise<ComparacaoDeCadastros> {
  const query = new URLSearchParams();
  if (pedido.scopeHash) query.set("scopeHash", pedido.scopeHash);
  if (pedido.canal !== undefined && pedido.canal !== null) query.set("canal", pedido.canal);
  if (pedido.de) query.set("de", pedido.de);
  if (pedido.ate) query.set("ate", pedido.ate);
  const sufixo = query.toString();
  return fetchJson<ComparacaoDeCadastros>(
    `/remuneracao/comparacao${sufixo ? `?${sufixo}` : ""}`,
  );
}

/**
 * O valor de uma linha, escrito conforme o que ela mede.
 *
 * Percentual com quatro casas porque é assim que ele entra na conta do
 * gross-up: 72,91% arredondado para 72,9% muda o valor de um documento de
 * R$ 8.697,88 em oito reais, e oito reais por rota por quinzena é a ordem de
 * grandeza das diferenças que este produto existe para achar. Dinheiro com
 * duas, que é o que o real tem.
 *
 * `null` nunca chega aqui como zero: a tela não chama esta função para linha
 * sem valor — quem não tem número mostra o motivo, e é outra coisa na tela.
 */
export function escreverValor(valor: number, medida: Medida): string {
  if (medida === "QUANTIDADE") {
    return valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  }
  if (medida === "PERCENTUAL") {
    return `${valor.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    })}%`;
  }
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * A variação escrita, com o sinal explícito.
 *
 * Pontos percentuais em linha de percentual, e não "%": a fatia dentro do
 * município que vai de 3,16% para 2,38% caiu **0,78 ponto**, e escrever "−0,78%"
 * ali seria confundir a diferença com a razão entre as duas — que é −24,7%. As
 * duas aparecem na tela, e por isso precisam ser distinguíveis.
 */
export function escreverVariacao(variacao: Variacao, medida: Medida): string {
  const sinal = variacao.absoluta > 0 ? "+" : "−";
  const magnitude = Math.abs(variacao.absoluta);

  if (medida === "PERCENTUAL") {
    const pontos = magnitude.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
    return `${sinal}${pontos} ${magnitude === 1 ? "ponto" : "pontos"}`;
  }
  return `${sinal}${escreverValor(magnitude, medida)}`;
}

/**
 * A planilha informada de uma unidade numa vigência.
 *
 * O que o servidor devolve depois de gravar, e o que a tela pede para saber se
 * a vigência anterior tem o que copiar.
 */
export interface PlanilhaDaVigencia {
  scopeHash: string;
  canal: string | null;
  effectiveDate: string;
  linhas: (ValorDeclarado & { chave: string; rotulo: string })[];
  atualizadaEm: string | null;
}

/** Uma célula a gravar. `valor: null` apaga a linha. */
export interface CelulaAGravar {
  chave: string;
  valor: number | null;
  observacao?: string | null;
}

export function lerPlanilha(pedido: {
  scopeHash?: string;
  canal?: string | null;
  period?: string;
}): Promise<PlanilhaDaVigencia> {
  const query = new URLSearchParams();
  if (pedido.scopeHash) query.set("scopeHash", pedido.scopeHash);
  if (pedido.canal !== undefined && pedido.canal !== null) query.set("canal", pedido.canal);
  if (pedido.period) query.set("period", pedido.period);
  const sufixo = query.toString();
  return fetchJson<PlanilhaDaVigencia>(`/remuneracao/planilha${sufixo ? `?${sufixo}` : ""}`);
}

/**
 * Grava a planilha informada — o "Salvar" da aba de cadastro manual.
 *
 * Manda só o que mudou: as chaves ausentes do corpo ficam como estavam, e
 * `valor: null` apaga a linha. É por isso que a tela pode salvar um bloco de
 * cada vez sem apagar os outros oito.
 */
export function gravarPlanilha(pedido: {
  scopeHash?: string;
  canal?: string | null;
  period?: string;
  /** A quinzena pode ser uma que a unidade ainda não tem — ver `lerCadastro`. */
  vigenciaNova?: boolean;
  celulas: CelulaAGravar[];
}): Promise<PlanilhaDaVigencia> {
  return fetchJson<PlanilhaDaVigencia>("/remuneracao/planilha", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pedido),
  });
}

/**
 * Apaga a planilha informada de uma quinzena — a lixeira da linha da lista.
 *
 * **O canal vai sempre, mesmo vazio**, e é a diferença que decide onde a
 * exclusão cai: omiti-lo pede "qualquer canal", e o servidor apagaria o
 * primeiro que encontrasse. Uma unidade pode ter uma série de EMPURRADA e outra
 * de ROTA no mesmo escopo — apagar a errada é a espécie de acidente que não
 * avisa, porque as duas respondem com sucesso.
 */
export function apagarPlanilha(pedido: {
  scopeHash: string;
  canal: string | null;
  period: string;
}): Promise<{ apagadas: number }> {
  const query = new URLSearchParams({
    scopeHash: pedido.scopeHash,
    canal: pedido.canal ?? "",
    period: pedido.period,
  });
  return fetchJson<{ apagadas: number }>(`/remuneracao/planilha?${query}`, {
    method: "DELETE",
  });
}

/**
 * Apaga o cadastro de uma unidade registrada à mão.
 *
 * O desfazer de `registrarUnidade`, e nada além: sai a identidade que alguém
 * digitou. O servidor recusa (409) enquanto houver planilha informada naquele
 * par — as quinzenas saem primeiro, uma a uma, cada uma com a sua confirmação.
 */
export function excluirUnidadeCadastrada(pedido: {
  scopeHash: string;
  canal: string | null;
}): Promise<{ unidade: UnidadeRegistrada }> {
  const query = new URLSearchParams({
    scopeHash: pedido.scopeHash,
    canal: pedido.canal ?? "",
  });
  return fetchJson<{ unidade: UnidadeRegistrada }>(`/remuneracao/unidades?${query}`, {
    method: "DELETE",
  });
}

/** Uma unidade registrada à mão, como o servidor a devolve. */
export interface UnidadeRegistrada {
  scopeHash: string;
  scopeType: string;
  codigo: string;
  nome: string;
  canal: string | null;
  vigenciaInicial: string;
  autorNome: string | null;
  criadaEm: string;
}

/**
 * Registra uma unidade que ainda não importou vigência nenhuma.
 *
 * O `codigo` vai **como foi digitado**: é sobre ele que o servidor soma o mesmo
 * `scope_hash` que a importação somará, e limpar a máscara aqui produziria o
 * identificador de um código que o export não tem — a unidade digitada nunca
 * reencontraria a importada.
 */
export function registrarUnidade(pedido: {
  /**
   * A unidade canônica que este cadastro descreve — a identidade.
   *
   * É o mesmo `id` que o Fechamento grava na competência, e é o que faz os dois
   * lados apontarem para a mesma unidade em vez de casarem por texto.
   */
  unidadeId?: string;
  nome: string;
  codigo: string;
  canal: string | null;
  /** A quinzena inicial, em `aaaa-mm-dd`. */
  vigencia: string;
}): Promise<UnidadeRegistrada> {
  return fetchJson<UnidadeRegistrada>("/remuneracao/unidades", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pedido),
  });
}

/**
 * Informa o código de uma unidade que foi cadastrada sem ele.
 *
 * **O que volta é um endereço novo.** Informar o código muda o `scopeHash` da
 * unidade — é esse o ato: ela passa a viver no escopo que a importação vai
 * produzir, com a planilha digitada junto. Quem chamou está numa tela que tem o
 * escopo antigo na mão, e sem o novo recarregaria uma unidade que mudou de
 * lugar.
 */
export function informarCodigoDaUnidade(pedido: {
  /** O escopo que a unidade tem **hoje** — o derivado do nome. */
  scopeHash: string;
  /** O código como está no export, sem limpeza — ver `registrarUnidade`. */
  codigo: string;
}): Promise<{ scopeHash: string; unidades: UnidadeRegistrada[] }> {
  return fetchJson<{ scopeHash: string; unidades: UnidadeRegistrada[] }>(
    "/remuneracao/unidades/codigo",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pedido),
    },
  );
}

/**
 * O que uma imagem da aba respondeu — e o que ela não respondeu.
 *
 * As três listas são separadas de propósito, porque significam coisas
 * diferentes na tela: `valores` preenche campo, `naoEncontradas` fica em
 * branco esperando alguém, e `recusadas` é o que a imagem mostrou e a regra da
 * linha barrou — o `5,90` lido como `590` numa alíquota. Somá-las num número só
 * ("20 de 30 lidas") esconderia justamente o que precisa de atenção.
 */
export interface LeituraDeImagem {
  valores: { chave: string; valor: number; comoEstaNaImagem: string }[];
  naoEncontradas: string[];
  recusadas: { chave: string; comoEstaNaImagem: string; motivo: string }[];
  motivo: "IA" | "SEM_CHAVE" | "RECUSA" | "ERRO";
  erro: string | null;
  modelo: string;
}

/**
 * Lê um print da aba e devolve o que está escrito nele. **Não grava nada.**
 *
 * O que volta daqui vai para os campos como rascunho, do mesmo jeito que se
 * tivesse sido digitado: continua sendo o "Salvar" de quem cadastra que
 * escreve a planilha.
 */
export function lerPlanilhaDaImagem(pedido: {
  /** O conteúdo da imagem em base64 — com ou sem o prefixo `data:`. */
  imagem: string;
  mimeType: string;
}): Promise<LeituraDeImagem> {
  return fetchJson<LeituraDeImagem>("/remuneracao/planilha/leitura-de-imagem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pedido),
  });
}

/** Repete numa vigência o que já foi digitado noutra, sem sobrescrever nada. */
export function copiarPlanilha(pedido: {
  scopeHash?: string;
  canal?: string | null;
  de: string;
  para: string;
  /** Vale para o **destino**: a origem tem de existir, senão não há o que copiar. */
  vigenciaNova?: boolean;
}): Promise<PlanilhaDaVigencia> {
  return fetchJson<PlanilhaDaVigencia>("/remuneracao/planilha/copia", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pedido),
  });
}

/**
 * O número de uma linha como o campo de edição o quer — em pt-BR, sem símbolo.
 *
 * Sem "R$" e sem "%" porque o campo já os traz do lado de fora: um valor
 * digitável que volta do servidor com símbolo obriga quem edita a apagá-lo
 * antes de digitar, e é assim que se perde um dígito.
 */
export function paraOCampo(valor: number, medida: Medida): string {
  if (medida === "QUANTIDADE") return String(valor);
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: medida === "PERCENTUAL" ? 4 : 2,
  });
}

/**
 * O que a pessoa digitou, virado número — ou `undefined` se não for número.
 *
 * O campo aceita as duas grafias que aparecem ao copiar de uma planilha:
 * `1.424,91`, como o Excel brasileiro escreve, e `1424.91`, como ele exporta em
 * CSV. Três regras, nesta ordem, e nenhuma delas é chute:
 *
 * 1. **Os dois sinais presentes** — o último é o decimal. `1.424,91` são mil
 *    quatrocentos e vinte e quatro reais e noventa e um centavos; `1,424.91`
 *    também. Sem esta regra, colar uma célula do Excel produziria cento e
 *    quarenta e dois mil no lugar de mil e quatrocentos.
 * 2. **Um sinal só, repetido** — é separador de milhar. `1.234.567` não tem
 *    duas partes decimais.
 * 3. **Um sinal só, uma vez, com exatamente três dígitos depois** — é separador
 *    de milhar. `1.424` é mil quatrocentos e vinte e quatro, que é como se
 *    escreve um valor redondo em português; um decimal de três casas em linha de
 *    dinheiro não existe, e em linha de percentual se escreve com quatro.
 *
 * A ambiguidade que sobra (`1.424` querendo dizer um vírgula quatro dois
 * quatro) é resolvida na tela, não aqui: o campo reescreve o que entendeu assim
 * que perde o foco, e quem digitou vê `1.424,00` antes de salvar.
 *
 * `undefined` e não `NaN`: um `NaN` no corpo da requisição vira `null` no JSON,
 * e `null` **apaga** a linha. O erro de digitação viraria um apagamento
 * silencioso.
 */
export function doCampo(texto: string): number | undefined {
  const limpo = texto.trim().replace(/\s|R\$|%/g, "");
  if (limpo === "") return undefined;
  if (!/^-?[\d.,]+$/.test(limpo)) return undefined;

  const virgulas = (limpo.match(/,/g) ?? []).length;
  const pontos = (limpo.match(/\./g) ?? []).length;
  const corte = Math.max(limpo.lastIndexOf(","), limpo.lastIndexOf("."));

  const decimal =
    corte === -1
      ? -1
      : virgulas > 0 && pontos > 0
        ? corte
        : virgulas + pontos > 1
          ? -1
          : limpo.length - corte - 1 === 3
            ? -1
            : corte;

  const normalizado =
    decimal === -1
      ? limpo.replace(/[.,]/g, "")
      : `${limpo.slice(0, decimal).replace(/[.,]/g, "")}.${limpo.slice(decimal + 1)}`;

  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : undefined;
}

/**
 * A divergência escrita — o número e o quanto ele representa.
 *
 * Sempre com sinal, e sempre do ponto de vista da planilha: "+R$ 6,00" quer
 * dizer que a aba pede seis reais a mais do que o cadastro apurou. Quem confere
 * precisa saber para que lado, porque é isso que decide quem cobra de quem.
 */
export function escreverDivergencia(conferencia: Conferencia, medida: Medida): string {
  const sinal = conferencia.diferenca > 0 ? "+" : "−";
  return `${sinal}${escreverValor(Math.abs(conferencia.diferenca), medida)}`;
}

/** A legenda da planilha, em palavra que quem a usa reconhece. */
export const NOME_DO_PREENCHIMENTO: Record<Preenchimento, string> = {
  INFORMADO: "Preencher informações",
  AUTOMATICO: "Preenchimento automático",
};

/**
 * O que cada movimento significa, numa frase.
 *
 * `IGUAL`, `SUBIU` e `DESCEU` não têm frase: o número das duas colunas já as
 * diz, e uma legenda repetindo "subiu" ao lado de uma seta para cima só ocupa
 * espaço.
 *
 * `SEM_COMPARACAO` também não tem, e por outra razão: ela é a maioria das
 * linhas hoje, e a mesma frase escrita em cada uma apareceu vinte e sete vezes
 * idênticas na mesma tela, empurrando para baixo as três que tinham número. O
 * que ela diria a tabela agora diz uma vez por bloco.
 *
 * Ficam as duas que são notícia — cobertura que apareceu e cobertura que sumiu.
 * Nenhuma das duas é sobre dinheiro, e as duas seriam lidas como se fossem.
 */
export const EXPLICACAO_DO_MOVIMENTO: Partial<Record<Movimento, string>> = {
  GANHOU_LASTRO:
    "Não é aumento: o acervo passou a sustentar esta linha nesta quinzena. Comparar com a " +
    "anterior seria comparar com um valor que nunca existiu.",
  PERDEU_LASTRO:
    "A quinzena anterior sustentava esta linha e esta não sustenta. Não é queda — é cobertura " +
    "que se perdeu, e vale conferir o que mudou na importação.",
};
