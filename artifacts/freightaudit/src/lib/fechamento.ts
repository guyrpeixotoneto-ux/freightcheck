import { fetchJson, getApiUrl, readJson, erroDaResposta } from "@/lib/api";

/**
 * O cliente do ambiente Fechamento.
 *
 * Os tipos aqui espelham o que `@workspace/fechamento` produz. Eles são
 * reescritos em vez de importados do pacote porque o bundle da interface não
 * deve carregar o motor de apuração: a conta roda no servidor, sobre o que o
 * banco guardou, e a tela só a lê. Um tipo duplicado é o preço de a interface
 * não poder, nem por acidente, calcular remuneração por conta própria.
 */

export type TipoDeFonte =
  | "OPERACAO"
  | "CTE"
  | "PAGAMENTO"
  | "DISPONIBILIDADE"
  | "REQUISICOES"
  | "CONCILIACAO";

export interface Fonte {
  tipo: TipoDeFonte;
  /** O número da rotina do Promax — `03.08.15`. É como quem opera a chama. */
  rotina: string;
  nome: string;
  papel: string;
  extensoes: string[];
  /** Em que quinzenas este relatório é esperado. A 1ª espera quatro; a 2ª, os seis. */
  quinzenas: (1 | 2)[];
  /**
   * Em que quinzenas ele é **admitido sem ser cobrado** — o "pode existir".
   *
   * Hoje é o 03.08.12.09 na 1ª quinzena: a requisição aprovada entre os dias 1
   * e 15 sai no relatório daquela quinzena, mas uma quinzena sem requisição
   * nenhuma não gera arquivo. A casinha de envio aparece (ver
   * {@link fontesParaEnviar}) e a ausência não conta como falta (ver
   * {@link fontesDaCompetencia}, que é o denominador).
   */
  quinzenasOpcionais: (1 | 2)[];
}

export interface Competencia {
  id: string;
  chave: string;
  ano: number;
  mes: number;
  quinzena: 1 | 2;
  inicio: string;
  fim: string;
  rotulo: string;
  unidade: { codigo: string; nome: string | null };
  transportadora: { codigo: string; nome: string | null };
  /**
   * `EMPURRADA`, `ROTA` — a operação que este fechamento fecha, e o quarto eixo
   * da chave dele desde a `0046`.
   *
   * Não confundir com o `Canal` (`ROTA` | `AS`) das verbas: as duas palavras
   * colidem em "ROTA" e querem dizer coisas diferentes. `NAO_INFORMADO` são as
   * competências abertas antes de o campo existir.
   */
  tipoDeOperacao: string;
  estado: "ABERTA" | "EM_APURACAO" | "APURADA" | "APROVADA" | "ENCERRADA";
  abertaEm: string;
  apuradaEm: string | null;
  encerradaEm: string | null;
  /** Por que a competência foi reaberta, quando foi. */
  motivoDaReabertura: string | null;
}

/**
 * O carimbo do backfill da `0046` — as competências abertas antes de o tipo de
 * operação existir.
 *
 * Ele afirma uma coisa só: ninguém disse de qual operação aquele fechamento é.
 * A migration não adivinhou, e é por isso que este valor não se confunde com
 * `EMPURRADA`. Ver `lib/db/migrations/0046_tipo_de_operacao.sql`.
 */
export const TIPO_NAO_INFORMADO = "NAO_INFORMADO";

/**
 * Os tipos que se pode **abrir**.
 *
 * Lista fechada, ao contrário dos campos de unidade e transportadora, e a razão
 * é o que cada um protege: lá o vocabulário é da operação e cresce; aqui ele é
 * o eixo de uma **chave**, e um campo livre faria "Empurrada" e "EMPURRADA"
 * virarem dois fechamentos do mesmo mês. Um terceiro tipo é uma linha nesta
 * lista no dia em que ele existir.
 *
 * `NAO_INFORMADO` não está aqui de propósito: só o backfill pode escrevê-lo, e
 * `normalizarTipoDeOperacao` o recusa na porta de entrada. Quem **lê** precisa
 * alcançá-lo — ver {@link TIPOS_PARA_LER} —, quem abre, não.
 */
export const TIPOS_DE_OPERACAO: { valor: string; rotulo: string; explicacao: string }[] = [
  {
    valor: "EMPURRADA",
    rotulo: "Empurrada",
    explicacao:
      "A distribuição empurrada da unidade — a operação que as vigências deste acervo " +
      "descrevem hoje.",
  },
  {
    valor: "ROTA",
    rotulo: "Rota",
    explicacao:
      "A operação de rota da mesma unidade. É um fechamento separado do de empurrada, com a " +
      "sua própria planilha de remuneração.",
  },
];

/**
 * Os tipos que se pode **consultar** — os dois de cima, mais o do backfill.
 *
 * Ler e abrir pedem listas diferentes, e a diferença não é descuido. Abrir com
 * `NAO_INFORMADO` seria dar a quem abre uma forma de dizer "não sei" num campo
 * que a operação decidiu que é obrigatório. Mas todo fechamento anterior à
 * `0046` carrega esse carimbo, e uma tela de consulta que não o oferecesse
 * deixaria o acervo inteiro sem endereço: a trinca certa, o mês certo, e mesmo
 * assim nada na tela — que foi exatamente o que aconteceu quando o seletor de
 * Tipo chegou ao Resumo geral oferecendo só os dois tipos novos.
 */
export const TIPOS_PARA_LER: { valor: string; rotulo: string }[] = [
  ...TIPOS_DE_OPERACAO.map(({ valor, rotulo }) => ({ valor, rotulo })),
  { valor: TIPO_NAO_INFORMADO, rotulo: "Não informado" },
];

/**
 * O tipo como a tela o escreve.
 *
 * `NAO_INFORMADO` aparece por extenso, e não escondido: a linha que não diz de
 * qual operação ela é continua sendo um fato sobre o acervo, e mostrá-la como
 * se fosse empurrada seria escrever na tela um tipo que ninguém declarou.
 */
export function rotuloDoTipo(tipo: string): string {
  return TIPOS_PARA_LER.find((t) => t.valor === tipo)?.rotulo ?? tipo;
}

/** Os dois lados de um fechamento: o CDD que recebe e quem entrega. */
export type TipoDeParte = "UNIDADE" | "TRANSPORTADORA";

/**
 * Uma unidade ou transportadora que o Fechamento conhece.
 *
 * `competencias` é em quantas ela já apareceu, e pode ser `0`: a parte
 * cadastrada existe antes de qualquer competência usá-la — é o que faz o nome
 * sobreviver à exclusão de uma importação.
 */
export interface Parte {
  codigo: string;
  nome: string | null;
  competencias: number;
}

export interface Recusa {
  linha: number;
  motivo: string;
  original: string;
}

export interface Documento {
  id: string;
  tipo: TipoDeFonte;
  nomeDoArquivo: string;
  linhasLidas: number;
  recusas: Recusa[];
  vigente: boolean;
  enviadoEm: string;
  /**
   * Quantas verbas o documento sustenta — só o 03.08.20 tem, `null` nos outros.
   *
   * `linhasLidas` soma verbas e descontos, e por isso não distingue o
   * demonstrativo inteiro do demonstrativo do qual o leitor só tirou descontos.
   * É essa diferença que faz a lista mostrar visto verde enquanto o painel diz
   * não ter de onde sair.
   */
  verbas: number | null;
}

/**
 * O que aconteceu com o arquivo que acabou de subir.
 *
 * `PROMOVIDO` é o documento que passou a valer; `EM_QUARENTENA` é o que chegou,
 * ficou guardado e **não** virou a conta — e aí `motivoDaQuarentena` diz por
 * quê. A tela precisa dos dois: tratar 202 como sucesso mudo é o que fazia
 * alguém subir o mesmo arquivo, não ver erro nenhum e concluir que estava
 * importado.
 */
export interface DocumentoRecebido extends Omit<Documento, "vigente" | "verbas"> {
  desfecho: "PROMOVIDO" | "EM_QUARENTENA";
  motivoDaQuarentena: string | null;
  /** O documento que este substituiu, quando substituiu algum. */
  substituiu: string | null;
}

export interface Parcela {
  origem: TipoDeFonte;
  descricao: string;
  semImposto: number | null;
  comImposto: number;
  fator?: number;
  registros: number;
}

export interface VerbaApurada {
  vbz: number;
  canal: string;
  nome: string;
  natureza: string;
  emitido: number;
  baseEmitida: number;
  documentos: number;
  /** Nulo quando nenhuma fonte sustenta a verba. Nulo não é zero. */
  esperado: number | null;
  diferenca: number | null;
  memoria: Parcela[];
}

export interface Divergencia {
  id: string;
  tipo: string;
  canal: string;
  titulo: string;
  valor: number;
  onde: string;
  sentido: "A_RECEBER" | "A_PAGAR" | "INFORMATIVO";
  desfecho: string;
}

export interface Aliquota {
  canal: string;
  fator: number;
  percentual: number;
  medida: { vbzs: number[]; somaSemImposto: number; somaComImposto: number };
}

export interface Apuracao {
  id: string;
  rodadaEm: string;
  fontesPresentes: TipoDeFonte[];
  fontesAusentes: TipoDeFonte[];
  aliquotas: Aliquota[];
  cargaFiscal: { canal: string; percentual: number; fator: number }[];
  totais: { emitido: number; esperado: number; naoConferido: number; diferenca: number };
  verbas: VerbaApurada[];
  divergencias: Divergencia[];
}

export interface CompetenciaAberta {
  competencia: Competencia;
  documentos: Documento[];
  apuracao: Apuracao | null;
}

/* ---------------------------------------------------------------------------
   O diário: a operação dia a dia, e o dia aberto viagem a viagem
   ------------------------------------------------------------------------ */

/** O retrato da viagem — o que a tabela do dia mostra e a conta não usa. */
export interface DetalheDaViagem {
  transportadora: string;
  cargaAtual: string;
  regiao: string;
  veiculo: string;
  entregaOuVolume: string;
  unidadeDeOrigem: string;
  situacaoMultiCdd: string;
  veiculoCadastradoNoCdd: string;
  matriculaDoMotorista: string;
  matriculaDoAjudante1: string;
  matriculaDoAjudante2: string;

  veiculoIndisponivel: string;
  placaIndisponivel: string;
  frotaIndisponivel: string;
  tipoDeIndisponibilidade: string;

  ocupacao: number | null;
  caixasDeRota: number | null;
  caixasDeAs: number | null;
  veiculoBm: number | null;
  rShow: number | null;

  horaDeSaida: string;
  horaDeEntrada: string;
  kmDeSaida: number | null;
  kmDeEntrada: number | null;
  tempoInterno: string;
  tempoDoLaco: string;
  tempoDeDeslocamento: string;
  kmDoLaco: number | null;
  kmDeDeslocamento: number | null;

  tempoPrevisto: string;
  kmPrevisto: number | null;

  custoSpot: number | null;
  custoVariavel: number | null;
  lucro: number | null;
  lucroUnitario: number | null;
  tipoDeImposto: string;
  valorUnitarioPorCaixaEntregue: number | null;
  valorPagoPorCaixaSemImposto: number | null;
  valorPagoPorCaixaComImposto: number | null;
  valorDropdown: number | null;

  valorUnitarioDoPontoDoMotorista: number | null;
  valorUnitarioDoPontoDoAjudante: number | null;
  valorDaEquipeDeEntregaMotorista: number | null;
  valorDaEquipeDeEntregaAjudante: number | null;

  custoVariavelCedbz: number | null;
  lucroUnitarioCedbz: number | null;
  lucroVariavelPorCaixaEntregueFfcedbz: number | null;
}

export interface Viagem {
  /** A linha física no 2Art — a ponta da trilha até a célula de origem. */
  linha: number;
  dia: string;
  canal: string;
  frota: string;
  placa: string;
  mapa: string;
  entregas: number;
  caixasCarregadas: number;
  caixasEntregues: number;
  valorFrete: number;
  percentualDeImposto: number | null;
  valorDeImposto: number;
  valorFaturado: number;
  detalhe?: DetalheDaViagem;
}

export interface TotaisDaOperacao {
  viagens: number;
  entregas: number;
  caixasCarregadas: number;
  caixasEntregues: number;
  freteSemImposto: number;
  imposto: number;
  freteComImposto: number;
}

export interface DiaDaOperacao {
  dia: string;
  numeroDoDia: number;
  /** 0 = domingo. O nome é da tela, que é quem sabe o idioma. */
  diaDaSemana: number;
  totais: TotaisDaOperacao;
  porFrota: (TotaisDaOperacao & { frota: string })[];
  porCanal: (TotaisDaOperacao & { canal: string })[];
}

export interface DiaAberto extends DiaDaOperacao {
  viagens: Viagem[];
}

export interface FonteDoDiario {
  nomeDoArquivo: string;
  linhasLidas: number;
  enviadoEm: string;
}

export interface Diario {
  competencia: Competencia;
  /** Nulo quando o 2Art ainda não foi enviado — e aí a grade nasce vazia. */
  fonte: FonteDoDiario | null;
  dias: DiaDaOperacao[];
  /** Viagens do 2Art fora do período: o arquivo é mensal, a competência é meio mês. */
  viagensForaDoPeriodo: number;
}

export interface DiaDaCompetencia {
  competencia: Competencia;
  fonte: FonteDoDiario | null;
  dia: DiaAberto;
}

export function lerDiario(competenciaId: string): Promise<Diario> {
  return fetchJson<Diario>(`/fechamento/competencias/${competenciaId}/dias`);
}

export function lerDia(competenciaId: string, dia: string): Promise<DiaDaCompetencia> {
  return fetchJson<DiaDaCompetencia>(`/fechamento/competencias/${competenciaId}/dias/${dia}`);
}

/** Como o 2Art escreve o tipo de frota, na palavra que a planilha usa. */
export const NOME_DA_FROTA: Record<string, string> = {
  PADRAO: "Padrão",
  SPOT: "Spot",
  FIXO: "Fixo",
  ESPECIAL: "Especial",
};

/** Domingo a sábado, como o ladrilho os abrevia. */
export const DIAS_DA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function listarFontes(): Promise<Fonte[]> {
  return fetchJson<Fonte[]>("/fechamento/fontes");
}

/**
 * Os relatórios que uma competência **pede** — o denominador de "3 de 4".
 *
 * A quinzena decide: a primeira espera quatro relatórios (2Art, 03.08.15,
 * 03.08.20 e 03.08.18) e a segunda espera os seis, porque a conciliação
 * (03.02.59.02) chega com o fechamento do mês e o 03.08.12.09 da primeira nem
 * sempre existe. Pedir as seis nas duas fazia toda primeira quinzena exibir
 * linhas eternamente vazias — e "falta importar" é trabalho de alguém, enquanto
 * "não há o que importar" não é.
 *
 * `recebidas` é o que já entrou na competência, e entra na lista mesmo fora da
 * quinzena dele: um arquivo enviado nunca some da tela por causa deste recorte.
 * Isso é o que mantém a conta do rodapé honesta — o denominador é esta lista, e
 * um documento fora da quinzena aparece nas duas pontas da fração em vez de
 * virar um `5/4`.
 *
 * **Não é esta a lista das casinhas de envio** — essa é {@link fontesParaEnviar},
 * que é esta mais as opcionais. A diferença existe porque o opcional que ainda
 * não chegou tem de ser enviável sem ser cobrado: contá-lo aqui faria a
 * primeira quinzena completa aparecer como "4 de 5" para sempre.
 *
 * O catálogo chega por consulta, então a lista nasce vazia e se preenche; quem
 * a usa como denominador precisa tratar o vazio como "ainda não sei", nunca
 * como zero.
 */
export function fontesDaCompetencia(
  catalogo: Fonte[],
  quinzena: 1 | 2,
  recebidas: TipoDeFonte[] = [],
): Fonte[] {
  const chegou = new Set(recebidas);
  return catalogo.filter((f) => f.quinzenas.includes(quinzena) || chegou.has(f.tipo));
}

/**
 * Os relatórios que uma competência **aceita** — as casinhas de envio da tela.
 *
 * É {@link fontesDaCompetencia} mais o que a quinzena admite sem esperar: hoje,
 * o 03.08.12.09 na primeira. A requisição aprovada entre os dias 1 e 15 sai no
 * relatório daquela quinzena, e sem casinha para enviá-lo o complementar do
 * período ficava de fora da conta — não com um aviso, mas em silêncio, porque
 * uma fonte que a tela não oferece é uma fonte que ninguém sabe que falta.
 *
 * A ausência do opcional continua não sendo pendência: quem pergunta "quantos
 * faltam" pergunta à outra função, e a apuração nomeia como ausente só o que a
 * quinzena espera (`FONTES_DA_QUINZENA`, no motor).
 */
export function fontesParaEnviar(
  catalogo: Fonte[],
  quinzena: 1 | 2,
  recebidas: TipoDeFonte[] = [],
): Fonte[] {
  const chegou = new Set(recebidas);
  return catalogo.filter(
    (f) =>
      f.quinzenas.includes(quinzena) ||
      f.quinzenasOpcionais.includes(quinzena) ||
      chegou.has(f.tipo),
  );
}

export function listarCompetencias(): Promise<Competencia[]> {
  return fetchJson<Competencia[]>("/fechamento/competencias");
}

/**
 * Uma competência somada: o que cabe numa linha da tela de Apurações.
 *
 * Espelha `ResumoDeApuracao` do servidor. Os totais vêm prontos de propósito —
 * a interface não soma remuneração, nem a partir de partes que ela mesma
 * recebeu. Ver o cabeçalho deste arquivo.
 */
export interface ResumoDeApuracao {
  competencia: Competencia;
  /** As fontes com documento vigente, na ordem do catálogo. */
  relatorios: TipoDeFonte[];
  /** Nulo enquanto a competência não apurou. Nulo não é zero. */
  apuracao: {
    rodadaEm: string;
    emitido: number;
    naoConferido: number;
    diferenca: number;
    /** A soma, em módulo, das divergências acionáveis ainda sem desfecho. */
    aQuestionar: number;
    aQuestionarQuantidade: number;
  } | null;
}

export function listarApuracoes(): Promise<ResumoDeApuracao[]> {
  return fetchJson<ResumoDeApuracao[]>("/fechamento/apuracoes");
}

export function lerCompetencia(id: string): Promise<CompetenciaAberta> {
  return fetchJson<CompetenciaAberta>(`/fechamento/competencias/${id}`);
}

export function abrirCompetencia(entrada: {
  ano: number;
  mes: number;
  quinzena: 1 | 2;
  /**
   * A unidade da competência.
   *
   * `id` é a unidade **canônica** do cadastro mestre — o caminho da tela, e o
   * único que cria identidade. `codigo` é o caminho legado, mantido para a
   * importação e para chamadores antigos; ele grava a competência com
   * `unidade_id` nulo, e a tela a mostra como não associada.
   */
  unidade: { id?: string; codigo?: string; nome?: string };
  transportadora: { codigo: string; nome?: string };
  /**
   * `EMPURRADA`, `ROTA` — obrigatório, porque entra na chave do fechamento.
   *
   * Não é o `Canal` (`ROTA` | `AS`) das verbas: é o modelo de operação da
   * unidade, o mesmo eixo do rótulo da vigência e da planilha de remuneração.
   */
  tipoDeOperacao: string;
}): Promise<Competencia> {
  return fetchJson<Competencia>("/fechamento/competencias", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entrada),
  });
}

export function listarPartes(): Promise<{ unidades: Parte[]; transportadoras: Parte[] }> {
  return fetchJson<{ unidades: Parte[]; transportadoras: Parte[] }>("/fechamento/partes");
}

/**
 * Cadastra a unidade ou a transportadora — o "Usar" do campo.
 *
 * O cadastro é um ato à parte da abertura de propósito: quem escreve o nome de
 * um CDD não deveria perdê-lo ao excluir a importação que abriu por engano.
 * Recadastrar o mesmo código com nome novo renomeia; sem nome, mantém o que
 * estava lá.
 */
export function cadastrarParte(entrada: {
  tipo: TipoDeParte;
  codigo: string;
  nome?: string | null;
}): Promise<Parte> {
  return fetchJson<Parte>("/fechamento/partes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entrada),
  });
}

/**
 * Informa — ou corrige — o tipo de operação de uma competência já aberta.
 *
 * É `PUT` porque é a edição de um campo, e não um ato como encerrar ou reabrir.
 * A regra de quando a troca é aceita é do servidor, e a tela não a duplica: ela
 * oferece os tipos, manda, e mostra a frase que voltar. O que a tela **sabe** é
 * mais raso e está em `edicaoDoTipo` — que a encerrada com tipo declarado
 * precisa ser reaberta antes —, e serve para não oferecer um botão que já se
 * sabe que o servidor vai recusar.
 */
export function informarTipoDeOperacao(id: string, tipoDeOperacao: string): Promise<Competencia> {
  return fetchJson<Competencia>(`/fechamento/competencias/${id}/tipo-de-operacao`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipoDeOperacao }),
  });
}

/**
 * Associa a competência à unidade canônica — o conserto sem exclusão.
 *
 * **O que ele grava é uma coluna: `unidade_id`.** Nada do que foi importado é
 * lido ou tocado — nem documentos, nem itens do 03.08.20, nem os bytes
 * originais de cada arquivo —, e `unidade_codigo` fica onde está. É por isso
 * que a tela pode oferecê-lo como um botão: o custo de errar a unidade é
 * associar de novo, e não reimportar a quinzena.
 *
 * A recusa da competência encerrada é do servidor, e a tela mostra a frase que
 * voltar em vez de reescrevê-la: uma quinzena congelada que muda de número
 * depois de fechada é exatamente o que o encerramento existe para impedir.
 */
export function associarUnidadeDaCompetencia(
  id: string,
  unidadeId: string,
): Promise<Competencia> {
  return fetchJson<Competencia>(`/fechamento/competencias/${id}/unidade`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unidadeId }),
  });
}

/** Encerra a competência — congela a quinzena. */
export function encerrar(id: string): Promise<Competencia> {
  return fetchJson<Competencia>(`/fechamento/competencias/${id}/encerramento`, { method: "POST" });
}

/** Reabre uma competência encerrada. O motivo é obrigatório. */
export function reabrir(id: string, motivo: string): Promise<Competencia> {
  return fetchJson<Competencia>(`/fechamento/competencias/${id}/reabertura`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ motivo }),
  });
}

export function apurar(id: string): Promise<Apuracao> {
  return fetchJson<Apuracao>(`/fechamento/competencias/${id}/apuracao`, { method: "POST" });
}

/* ---------------------------------------------------------------------------
   O resumo do mês — as duas quinzenas lado a lado
   ------------------------------------------------------------------------ */

/** Um valor nas três colunas do resumo. `null` é ausência, nunca zero. */
export interface TresColunas {
  primeira: number | null;
  segunda: number | null;
  total: number | null;
}

export interface LinhaDoResumo {
  vbz: number;
  nome: string;
  natureza: string;
  emitido: TresColunas;
  apurado: TresColunas;
}

export interface BlocoDoResumo {
  natureza: string;
  titulo: string;
  linhas: LinhaDoResumo[];
  emitido: TresColunas;
  apurado: TresColunas;
}

/** Um desconto do 03.08.20 — informativo: já saiu das verbas, não se soma. */
export interface DescontoDoResumo {
  tipo: string;
  nome: string;
  valores: TresColunas;
}

/* ---------------------------------------------------------------------------
   O painel da planilha — o mesmo mês nas linhas com que ele é discutido
   ------------------------------------------------------------------------ */

/** Por que uma linha da planilha não tem número, e o que a destravaria. */
export interface AusenciaNoPainel {
  motivo: string;
  destrava: string;
}

/** Uma linha do `RESUMO` da planilha. `rotulo` é a transcrição; `nome`, a tela. */
export interface LinhaDoPainel {
  chave: string;
  rotulo: string;
  nome: string;
  papel: "PARCELA" | "DESCONTO" | "TOTAL";
  valores: TresColunas;
  /** A chave do conjunto quando o número é de várias linhas juntas. */
  conjunto: string | null;
  ausencia: AusenciaNoPainel | null;
  porque: string;
}

/** Um número do 03.08.20 que vale para várias linhas ao mesmo tempo. */
export interface ConjuntoDoPainel {
  chave: string;
  nome: string;
  linhas: string[];
  valores: TresColunas;
  porque: string;
}

export interface QuadroDoPainel {
  quadro: string;
  titulo: string;
  linhas: LinhaDoPainel[];
  conjuntos: ConjuntoDoPainel[];
  total: TresColunas;
  somado: TresColunas;
  /** `total − somado`. Zero é o quadro fechando. */
  residuo: TresColunas;
  /** As linhas da planilha entre as quais o resíduo se divide. */
  semLastro: string[];
  /** As verbas do relatório que nenhuma linha da planilha nomeia. */
  verbasSemLinha: { vbz: number; nome: string; valores: TresColunas }[];
}

export interface PainelDaPlanilha {
  canal: string;
  quadros: QuadroDoPainel[];
  /** A soma dos quadros, na moeda da planilha (sem imposto). */
  soma: TresColunas;
  /** O imposto — medido, nunca presumido. */
  imposto: TresColunas;
  /** `Total Remuneração` do 03.08.20 — o número que as duas abas partilham. */
  demonstrativo: TresColunas;
}

export interface CanalDoResumo {
  canal: string;
  blocos: BlocoDoResumo[];
  descontos: DescontoDoResumo[];
  emitido: TresColunas;
  conferido: TresColunas;
  semFonte: TresColunas;
  /** `Total Remuneração` do 03.08.20 — o lado que a Ambev assina. */
  demonstrativo: TresColunas;
  /** `emitido − demonstrativo`. */
  diferenca: TresColunas;
  /** O mesmo mês nas linhas da planilha. `null` quando não há painel. */
  painel: PainelDaPlanilha | null;
  /**
   * Por que não há painel, quando não há.
   *
   * `SEM_DEMONSTRATIVO`: o painel do canal está escrito e o 03.08.20 não foi
   * importado — falta arquivo. `CANAL_SEM_CATALOGO`: os rótulos do painel deste
   * canal ainda não foram transcritos — falta trabalho nosso. As duas ausências
   * têm o mesmo sintoma e mandam quem olha para lados opostos, e é por isso que
   * o servidor as separa em vez de a tela adivinhar.
   */
  semPainel: "CANAL_SEM_CATALOGO" | "SEM_DEMONSTRATIVO" | null;
  /** O devido, calculado do contrato, ao lado do demonstrado. */
  comparado: PainelComparado | null;
  /**
   * Precisão e lastro deste canal — ver {@link Afericao}.
   *
   * Opcional porque a resposta de um servidor mais antigo não a traz, e a tela
   * tem de continuar inteira sem ela: os selos somem, o resto fica.
   */
  afericao?: Afericao;
  /**
   * Por que há (ou não há) devido, quinzena a quinzena.
   *
   * Espelha `CanalDoResumo.cadastro` de `@workspace/fechamento`. `null` na
   * quinzena que não existe no mês.
   */
  cadastro: {
    primeira: DiagnosticoDoCadastro | null;
    segunda: DiagnosticoDoCadastro | null;
  };
}

/**
 * Uma linha nas três leituras que o fechamento discute.
 *
 * `devido` sai do contrato (cadastro + diário); `demonstrado` sai do 03.08.20.
 * São fontes independentes, e é por isso que a diferença entre elas diz algo —
 * o painel antigo comparava o demonstrativo consigo mesmo.
 */
export interface LinhaComparada {
  chave: string;
  /** O rótulo como a planilha o grita — para conferir contra o arquivo. */
  rotulo: string;
  /**
   * O mesmo rótulo escrito como se escreve — é o que a tela mostra.
   *
   * A caixa alta da planilha é formatação de célula, não sentido. As duas
   * grafias vêm do catálogo do de-para, no servidor; derivar uma da outra aqui
   * com `toLowerCase` estragaria `DVS`, que é sigla.
   */
  nome: string;
  papel: string;
  devido: TresColunas;
  demonstrado: TresColunas;
  diferenca: TresColunas;
  /**
   * O número que o 03.08.20 traz para esta linha **junto com outras**.
   *
   * Presente nas seis linhas do quadro fixo que o relatório não parte por tipo
   * de frota. É o que permite à coluna do demonstrado escrever `em conjunto` em
   * vez de um traço: as duas seriam o mesmo `null`, e significam coisas opostas
   * — o traço pede um arquivo, o conjunto diz que o arquivo não tem a partição.
   */
  conjunto: ConjuntoDoPainel | null;
  memoria: { primeira: string | null; segunda: string | null };
  falta: string | null;
  /**
   * O que a planilha da operação publica nesta linha — a **terceira** fonte.
   *
   * `null` em todo mês sem planilha anexada, que é o estado normal: a coluna é
   * opcional e a tela funciona sem ela exatamente como funcionava antes.
   *
   * Ela chega ao painel **depois** de o devido estar calculado, por enxerto
   * puro no servidor — nunca participa de `devido`, `demonstrado` nem
   * `diferenca`. Ver `painel-referencia.ts` em `@workspace/fechamento`.
   */
  planilha: TresColunas | null;
  /** `devido − planilha`, no mesmo sinal de `diferenca`: positivo é o sistema pedindo mais. */
  diferencaDaPlanilha: TresColunas | null;
  /** De que célula do `RESUMO GERAL` saiu cada quinzena — `AI7`, `AJ7`. */
  celulaDaPlanilha: { primeira: string | null; segunda: string | null } | null;
  /**
   * A causa já investigada desta divergência, quando existe.
   *
   * Não é tolerância: a diferença continua inteira ao lado. É o nome da causa,
   * para quem lê não reabrir a mesma investigação. `null` na divergência que
   * ninguém explicou — e é essa que merece olhar.
   */
  causaConhecida: string | null;
  /**
   * O que **nenhum documento sustenta** nesta linha — a coluna `Auditar`.
   *
   * Preenchida em dois casos, e só nesses dois: os dois lados existem e
   * discordam em mais de meio centavo, ou o devido é dinheiro e não há
   * demonstrado nenhum — nem próprio nem por conjunto.
   *
   * **Não é `causaConhecida` com outro nome.** Aquela fala do que a planilha faz
   * de diferente do sistema; esta, do que o demonstrativo assinado faz de
   * diferente do contrato. Uma linha pode ter as duas.
   *
   * **A coluna deve viver vazia**, e é assim que se lê a tela: linha com texto
   * aqui é a que merece o olho. Falta de arquivo não entra — para isso existe
   * `falta`, e ali o devido nem existe.
   */
  auditar: string | null;
}

/**
 * A comparação no único nível em que as duas fontes falam a mesma língua.
 *
 * O contrato parte a frota por tipo; o 03.08.20 não. Linha a linha a diferença
 * é incalculável — e o conjunto **é** calculável: a soma do devido das linhas
 * que dividem o número, contra o número. Não rateia nada, e é a subtração que
 * quem confere quer ver. `devido` é `null` se faltar o de qualquer linha.
 */
export interface ConjuntoComparado {
  chave: string;
  nome: string;
  linhas: string[];
  devido: TresColunas;
  demonstrado: TresColunas;
  diferenca: TresColunas;
  porque: string;
  /**
   * O que ninguém sustenta no conjunto — a mesma coluna `Auditar` das linhas.
   *
   * É aqui que a auditoria das linhas em conjunto acontece: elas não têm
   * demonstrado próprio, e a única subtração honesta é a do conjunto.
   */
  auditar: string | null;
}

export interface QuadroComparado {
  quadro: string;
  titulo: string;
  /** Como a planilha nomeia a linha de total do quadro. `null` quando não há. */
  rotuloDoTotal: string | null;
  /**
   * Por que o quadro não tem linha nenhuma. `null` no quadro que tem.
   *
   * O `REMUNERAÇÃO VARIÁVEL - EQUIPE DE ENTREGA` da planilha é um quadro
   * reservado: `AI34` e `AJ34` não existem como célula, e mesmo assim o total
   * geral dela os soma. A frase vem escrita do domínio para a tela não deduzir.
   */
  reservado: string | null;
  linhas: LinhaComparada[];
  conjuntos: ConjuntoComparado[];
  devido: TresColunas;
  /**
   * O total do quadro **somado das linhas demonstradas**, na moeda do devido.
   *
   * Não é o total que o 03.08.20 imprime para a seção — esse continua no painel
   * do demonstrativo, que é onde ele é o assunto. `null` quando alguma linha do
   * quadro tem devido em dinheiro e não tem demonstrado; {@link semDemonstrado}
   * diz qual.
   */
  demonstrado: TresColunas;
  diferenca: TresColunas;
  /** As linhas que impedem o total demonstrado de existir. Vazia quando ele existe. */
  semDemonstrado: string[];
  /** O total que a planilha publica para o quadro — lido, não somado das linhas. */
  planilha: TresColunas | null;
  diferencaDaPlanilha: TresColunas | null;
}

/* =========================================================================
 * A aferição — os dois números do cabeçalho, e o que eles não medem
 * ====================================================================== */

/** De que qualidade é a evidência por trás de uma parcela do fechamento. */
export type ClasseDeLastro =
  /** Os dois lados existem, saem de documentos diferentes, e a parcela fecha. */
  | "CRUZADO"
  /** Idem, mas a conferência é do **grupo** — a partição entre as linhas não é conferida. */
  | "CRUZADO_EM_CONJUNTO"
  /** Os dois lados saem do mesmo arquivo: prova a leitura, não a operação. */
  | "MESMA_FONTE"
  /** Devido em dinheiro e nada do outro lado. Não é diferença — é ausência. */
  | "SEM_CONTRAPARTIDA";

export interface ParcelaAferida {
  chave: string;
  nome: string;
  /** O dinheiro que a parcela move, em módulo. */
  valor: TresColunas;
  classe: ClasseDeLastro;
  /** Quanto de `valor` tem contrapartida independente. Pode ser parcial. */
  comLastro: TresColunas;
  fonteDoDevido: string | null;
  naoExplicado: TresColunas;
  porque: string;
}

/** Um limite do que a aferição mediu — com cifra quando tem cifra. */
export interface LimiteDaAfericao {
  titulo: string;
  texto: string;
  valor: TresColunas | null;
}

/**
 * Se **dá para aferir** — a pergunta que vem antes de qualquer percentual.
 *
 * `COMPLETO` é o único estado em que a precisão existe. `INCOMPLETO` é
 * fechamento com relatório faltando: a tela mostra traço e a lista do que
 * falta, **em âmbar** — é pendência de importação, não erro financeiro.
 * `NAO_APLICAVEL` é não haver o que conferir.
 */
export type Completude = "COMPLETO" | "INCOMPLETO" | "NAO_APLICAVEL";

/** Uma fonte que falta, com o endereço que quem importa precisa para agir. */
export interface FonteFaltante {
  tipo: string;
  quinzena: 1 | 2;
  /** `2Art`, `03.08.20` — como quem opera a chama. */
  rotina: string;
  nome: string;
  /** `NAO_IMPORTADO` pede upload; `QUINZENA_NAO_ABERTA` pede abrir a competência. */
  motivo: "NAO_IMPORTADO" | "QUINZENA_NAO_ABERTA";
}

export interface Aferibilidade {
  completude: Completude;
  /** As fontes esperadas que não chegaram. Vazia quando `COMPLETO`. */
  faltando: FonteFaltante[];
  /** A frase que a tela mostra no lugar do percentual. `null` quando `COMPLETO`. */
  porque: string | null;
}

/**
 * Precisão e lastro de um canal — **derivados, nunca digitados**.
 *
 * `precisao` responde *do dinheiro que o sistema conseguiu conferir, quanto
 * bate?*; `lastro`, *do dinheiro que o fechamento move, quanto tem
 * contrapartida num documento que não o produziu?*. São perguntas diferentes e
 * andam em direções opostas com frequência: conferir tudo contra o arquivo de
 * onde os números saíram dá precisão perfeita e lastro nenhum.
 *
 * Os dois vêm calculados do servidor. Nada aqui soma, e um percentual escrito à
 * mão numa tela envelheceria em silêncio — que é o defeito que este tipo existe
 * para tornar impossível.
 */
export interface Afericao {
  canal: string;
  /**
   * Dá para aferir cada coluna? — e o que falta quando não dá.
   *
   * É daqui que sai a diferença entre o vermelho de divergência real e o âmbar
   * de fechamento incompleto. Sem ela, a tela pintava de vermelho um mês que só
   * estava pela metade.
   */
  aferibilidade: { primeira: Aferibilidade; segunda: Aferibilidade; total: Aferibilidade };
  movimentado: TresColunas;
  comContrapartida: TresColunas;
  comLastroCruzado: TresColunas;
  naoExplicado: TresColunas;
  /**
   * Entre 0 e 1. **`null` sempre que a coluna não é aferível** — nunca zero.
   *
   * Zero afirma que a conta está errada; traço afirma que ela não foi feita.
   * Confundir as duas foi o defeito que esta versão conserta.
   */
  precisao: TresColunas;
  /** Entre 0 e 1. `null` quando nada foi movimentado. */
  lastro: TresColunas;
  parcelas: ParcelaAferida[];
  limites: LimiteDaAfericao[];
}

/** De onde saiu a coluna da planilha — a prova de contra o quê se conferiu. */
export interface ProcedenciaDaReferencia {
  id: string;
  versao: number;
  nomeDoArquivo: string;
  sha256: string;
  anexadaPor: string | null;
  anexadaEm: string;
}

/** Uma versão anexada, como a tela a lista para trocar de régua. */
export interface VersaoDaReferencia extends ProcedenciaDaReferencia {
  ativa: boolean;
  tamanhoEmBytes: number;
}

/**
 * As três últimas linhas do `RESUMO GERAL`.
 *
 * `totalGeralDaUnidade` é o que o contrato manda pagar, somado dos mesmos
 * quadros que a planilha soma. `totalGeralDoSrtrans` é o `Total Remuneração` do
 * 03.08.20 do canal — o mesmo número que a aba `Verbas` mostra no fecho dela, e
 * o mesmo que `Abertura!F45` traz na planilha.
 */
export interface FechoDoPainel {
  totalGeralDaUnidade: TresColunas;
  totalGeralDoSrtrans: TresColunas;
  /** `SRTrans − unidade`, no sinal da planilha. */
  diferenca: TresColunas;
}

export interface PainelComparado {
  canal: string;
  quadros: QuadroComparado[];
  /** O fecho do resumo — ver {@link FechoDoPainel}. */
  fecho: FechoDoPainel;
  /** De qual cadastro veio cada quinzena — onde conferir um número que surpreende. */
  cadastro: {
    primeira: { cadastroId: string; vigenteDe: string } | null;
    segunda: { cadastroId: string; vigenteDe: string } | null;
  };
  pendencias: string[];
  /**
   * O que as duas leituras não conciliam, ordenado por tamanho.
   *
   * **Não soma, e a tela não deve somar.** Os itens se sobrepõem — a diferença
   * do total de um quadro é, em parte, a soma das diferenças das linhas dele —,
   * e um total no rodapé desta lista contaria a mesma divergência duas vezes.
   * Ver `inconsistencias.ts` em `@workspace/fechamento`.
   */
  inconsistencias: Inconsistencia[];
  /**
   * De qual arquivo saiu a coluna da planilha. `null` quando ninguém anexou.
   *
   * A tela mostra isto **sempre que a coluna aparece**, e não atrás de um
   * clique: o `.xlsb` não declara a que mês pertence — quem anexa é que declara
   * —, e a única coisa que torna a diferença auditável é dizer, ao lado dela,
   * contra qual arquivo ela foi medida.
   */
  referencia: ProcedenciaDaReferencia | null;
}

/* ---------------------------------------------------------------------------
   O diagnóstico do cadastro — qual das três portas fechou
   ------------------------------------------------------------------------ */

/**
 * Onde a resolução do cadastro parou. Espelha `EstadoDaResolucao` do domínio.
 *
 * A tela **não** deriva o texto destes estados por conta própria: quem escreve
 * o problema e o conserto é `comoDestravar`, em `@workspace/fechamento`, e é de
 * lá que a frase vem pronta. Duplicá-la aqui daria duas versões da mesma
 * instrução, e a que a pessoa lê seria a que ninguém testa.
 */
export type EstadoDaResolucao =
  | "RESPONDEU"
  | "CANAL_SEM_CONTRATO"
  | "UNIDADE_NAO_ENCONTRADA"
  | "UNIDADE_AMBIGUA"
  /**
   * A competência já aponta para uma unidade e nenhum cadastro de Remuneração
   * aponta para a mesma.
   *
   * Separado de `UNIDADE_NAO_ENCONTRADA` porque o conserto é o oposto: ali
   * faltam dois textos coincidirem, aqui o texto nem é lido — falta um cadastro
   * de Remuneração associado à unidade.
   */
  | "UNIDADE_SEM_CADASTRO"
  | "SEM_VIGENCIA"
  | "CONTRATO_INCOMPLETO"
  /** Cadastro e acervo discordam sobre o CNPJ. Nenhum é sobrescrito. */
  | "CONFLITO_DE_IDENTIDADE";

/**
 * Como o código da competência encontrou o do cadastro.
 *
 * `IDENTIDADE` é o casamento que não compara texto nenhum — as duas pontas
 * apontam para a mesma unidade canônica. Os outros três são o plano B das
 * competências históricas, que ainda não têm identidade.
 */
export type ComoCasou = "IDENTIDADE" | "EXATO" | "ESPACO" | "DOCUMENTO";

/**
 * Uma unidade canônica como o diagnóstico a nomeia.
 *
 * O `id` é o que a associação grava; o par nome/CNPJ é como uma pessoa
 * reconhece a unidade — e o CNPJ é o que distingue dois CDDs de mesmo nome.
 */
export interface UnidadeSugerida {
  id: string;
  nome: string;
  /** Os catorze dígitos, sem máscara. A tela usa {@link formatarCnpj}. */
  cnpj: string;
}

/** `12345678000199` → `12.345.678/0001-99`. Só para exibir. */
export function formatarCnpj(cnpj: string): string {
  if (!/^\d{14}$/.test(cnpj)) return cnpj;
  return (
    `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}` +
    `/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`
  );
}

export interface PortaDaUnidade {
  codigoProcurado: string;
  cadastradas: number;
  candidatas: number;
  comoCasou: ComoCasou | null;
  codigoNoCadastro: string | null;
  /**
   * Os códigos que as unidades cadastradas têm — o outro lado da comparação.
   *
   * Só vem preenchido quando a unidade não foi encontrada, que é quando serve:
   * é o que transforma "não achei" em "procurei X e existe Y".
   */
  codigosCadastrados: string[];
  /** A unidade canônica que esta competência já aponta, quando aponta. */
  identidade: UnidadeSugerida | null;
  /**
   * As unidades cadastradas cujo nome é o texto que a competência carrega.
   *
   * Sugestão, nunca resolução: o nome trouxe a candidata até a tela e não a
   * escolhe — quem associa é gente. Vazia quando a unidade foi encontrada ou
   * quando a competência já tem identidade.
   */
  sugestoes: UnidadeSugerida[];
}

export interface PortaDaVigencia {
  doMes: string[];
  todas: string[];
  vigenteDe: string | null;
  herdadaDaOutraQuinzena: boolean;
}

export interface ChaveDoContrato {
  chave: string;
  rotulo: string;
}

export interface PortaDoContrato {
  faltam: ChaveDoContrato[];
  assumidasComoZero: ChaveDoContrato[];
  lidas: number;
}

/**
 * O que aconteceu nas três portas.
 *
 * `vigencia` e `contrato` são `null` nas portas que a resolução não alcançou —
 * não se avalia o que não se chegou a perguntar.
 */
export interface DiagnosticoDoCadastro {
  estado: EstadoDaResolucao;
  unidade: PortaDaUnidade;
  /** Os dois CNPJs em desacordo. Só em `CONFLITO_DE_IDENTIDADE`. */
  conflito?: { doCadastro: string; doAcervo: string; scopeHash: string } | null;
  vigencia: PortaDaVigencia | null;
  contrato: PortaDoContrato | null;
  /**
   * O problema e o conserto, escritos pelo domínio (`comoDestravar`).
   *
   * Chega pronto do servidor de propósito: qual é o conserto de cada porta é
   * regra de negócio, e montá-lo aqui daria duas versões da mesma instrução —
   * a que os testes cobrem e a que a pessoa lê. `null` quando respondeu.
   */
  destrava: { problema: string; conserto: string } | null;
}

/**
 * Uma unidade canônica, como Administração → Unidades a entrega.
 *
 * `id` é `null` só na linha **detectada no acervo e ainda não cadastrada** —
 * evidência de um snapshot, não identidade. Os seletores do Fechamento e da
 * Remuneração só oferecem as que têm `id`.
 */
export interface UnidadeCanonica {
  id: string | null;
  nome: string;
  cnpj: string;
  cnpjFormatado: string;
  estado: "CADASTRADA" | "CADASTRADA_E_IMPORTADA" | "DETECTADA";
  vigencias: number;
}

/** As unidades canônicas — o cadastro mestre. */
export async function listarUnidadesCanonicas(): Promise<UnidadeCanonica[]> {
  return fetchJson<UnidadeCanonica[]>("/unidades/canonicas");
}

/** Uma divergência nomeada entre o contrato e o demonstrativo. */
export interface Inconsistencia {
  chave: string;
  canal: string;
  quinzena: 1 | 2;
  linha: string;
  rotulo: string;
  quadro: string;
  tipo: "FONTES_DISCORDAM" | "SEM_DEMONSTRADO" | "SEM_DEVIDO";
  /** `devido − demonstrado`. Positivo: o contrato manda pagar mais. */
  valor: number;
  entre: [string, string];
  porque: string;
  destrava: string;
}

export interface ResumoDoMes {
  ano: number;
  mes: number;
  unidade: { codigo: string; nome: string | null };
  transportadora: { codigo: string; nome: string | null };
  quinzenas: {
    quinzena: 1 | 2;
    competenciaId: string | null;
    chave: string | null;
    estado: string | null;
    apurada: boolean;
    temDemonstrativo: boolean;
    /** O estado das seis fontes nesta quinzena — presente, ausente, não aplicável. */
    fontes?: { tipo: string; quinzena: 1 | 2; estado: string; rotina: string; opcional: boolean }[];
  }[];
  canais: CanalDoResumo[];
}

/* ---------------------------------------------------------------------------
   O endereço de um mês — a quíntupla que toda leitura do fechamento pede
   ------------------------------------------------------------------------ */

/**
 * O mês de um fechamento: quem, com quem, em que operação, quando.
 *
 * É a mesma quíntupla nas quatro leituras — resumo, conciliação, lista de
 * referências e anexo —, e ela é uma só porque um fechamento é a trinca
 * (unidade, transportadora, operação) num período: dois CDDs no mesmo mês são
 * dois fechamentos, e a mesma unidade com EMPURRADA e ROTA também.
 */
export interface MesDoFechamento {
  unidade: string;
  transportadora: string;
  /** `EMPURRADA`, `ROTA` — a leitura é de uma operação, e não da unidade. */
  tipoDeOperacao: string;
  ano: number;
  mes: number;
}

/**
 * O mês que uma referência endereça — o mesmo endereço, com o nome de lá.
 *
 * Continua exportado porque é assim que os componentes do anexo o nomeiam, e
 * porque "a referência é de um mês" é a frase que se lê naquele canto da tela.
 */
export type MesDaReferencia = MesDoFechamento;

function buscaDoMes(alvo: MesDoFechamento): string {
  return new URLSearchParams({
    unidade: alvo.unidade,
    transportadora: alvo.transportadora,
    tipoDeOperacao: alvo.tipoDeOperacao,
    ano: String(alvo.ano),
    mes: String(alvo.mes),
  }).toString();
}

/**
 * O mês inteiro, das duas quinzenas.
 *
 * Os quatro parâmetros são obrigatórios porque um fechamento é a trinca
 * (unidade, transportadora, período): dois CDDs no mesmo mês são dois resumos.
 *
 * **Sem a planilha anexada.** O Resumo confere o fechamento contra as duas
 * fontes que o sustentam — o contrato e o 03.08.20 —, e a régua da operação é
 * outra pergunta, com endereço próprio: {@link lerConciliacaoDoMes}. Nesta
 * leitura `referencia` vem sempre `null`, e as colunas da planilha também.
 */
export function lerResumoDoMes(alvo: MesDoFechamento): Promise<ResumoDoMes> {
  return fetchJson<ResumoDoMes>(`/fechamento/resumo?${buscaDoMes(alvo)}`);
}

/**
 * O mesmo mês, **com** a planilha da operação ao lado — a leitura da Conciliação.
 *
 * A resposta tem a forma do resumo, e a diferença está no que vem preenchido:
 * `referencia` diz de qual arquivo a régua saiu, e cada linha ganha `planilha`,
 * `diferencaDaPlanilha`, `celulaDaPlanilha` e `causaConhecida`. Sem arquivo
 * anexado ao mês ela responde exatamente o que o Resumo responde — a tela é que
 * diz, então, que falta anexar.
 *
 * O enxerto é feito no servidor **depois** de o devido estar calculado, e nunca
 * participa dele. Ver `painel-referencia.ts` em `@workspace/fechamento`.
 */
export function lerConciliacaoDoMes(alvo: MesDoFechamento): Promise<ResumoDoMes> {
  return fetchJson<ResumoDoMes>(`/fechamento/conciliacao?${buscaDoMes(alvo)}`);
}

/* ---------------------------------------------------------------------------
   A referência de conferência — a planilha da operação, anexada a um mês
   ------------------------------------------------------------------------ */

/** As versões já anexadas ao mês, da mais nova para a mais velha. */
export function listarReferenciasDoMes(alvo: MesDaReferencia): Promise<{ versoes: VersaoDaReferencia[] }> {
  return fetchJson<{ versoes: VersaoDaReferencia[] }>(`/fechamento/referencias?${buscaDoMes(alvo)}`);
}

/**
 * Anexa uma planilha ao mês.
 *
 * **A recusa volta como mensagem, e a mensagem nomeia a célula.** O servidor lê
 * o arquivo antes de gravar; se ele não for uma planilha deste formato, ou se
 * uma célula do `RESUMO GERAL` estiver vazia, com erro do Excel ou com texto, a
 * resposta é 400 com o endereço. Quem está na tela troca o arquivo — nada foi
 * gravado e nenhum valor foi suposto.
 */
export async function anexarReferencia(
  alvo: MesDaReferencia,
  arquivo: File,
): Promise<VersaoDaReferencia> {
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return fetchJson<VersaoDaReferencia>(`/fechamento/referencias?${buscaDoMes(alvo)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: arquivo.name, contentBase64: btoa(binario) }),
  });
}

/** Troca qual versão é a ativa. Nenhuma é apagada. */
export async function ativarReferencia(id: string): Promise<void> {
  const resposta = await fetch(getApiUrl(`/fechamento/referencias/${id}/ativacao`), {
    method: "POST",
  });
  if (!resposta.ok) throw erroDaResposta(resposta, await readJson(resposta));
}

/**
 * O painel da planilha de uma quinzena.
 *
 * Vem em três colunas com só a da quinzena preenchida — a mesma forma do resumo
 * mensal, para que a aba `Planilha` seja o mesmo componente nas duas telas.
 *
 * **404 quando nenhuma verba sustenta o painel**, e não um painel de zeros: sem
 * verba o painel não tem de onde sair, e dizer isso é diferente de dizer que a
 * quinzena não pagou nada. A mensagem do 404 distingue o arquivo que nunca
 * chegou do que chegou e não valeu — a tela imprime a que veio, e não supõe
 * qual é.
 */
export function lerPainelDaCompetencia(
  id: string,
  canal = "ROTA",
): Promise<{ competencia: Competencia; painel: PainelDaPlanilha }> {
  return fetchJson(`/fechamento/competencias/${id}/de-para?canal=${canal}`);
}

/**
 * Por que um 03.08.20 não virou verba — o diagnóstico do arquivo guardado.
 *
 * A tela mostra `resumo`, que é uma frase; o resto existe para quem for
 * consertar o arquivo ou o leitor, e é o que evita a próxima pergunta.
 */
export interface DiagnosticoDoPagamento {
  causa:
    | "LEU_NORMALMENTE"
    | "NAO_E_O_03_08_20"
    | "SEM_CABECALHO_DE_SECAO"
    | "LINHA_DE_VERBA_RECUSADA"
    | "SEM_CORPO_DE_VERBA";
  resumo: string;
  lido: { verbas: number; descontos: number; totais: number };
  cabecalho: {
    periodo: { inicio: string | null; fim: string | null };
    unidade: string | null;
    transportadora: string | null;
  };
  secoes: { canal: boolean; bloco: boolean; verbasBemFormatadas: number };
  suspeitas: { linha: number; motivo: string; original: string }[];
}

/**
 * O diagnóstico de um 03.08.20 importado, lido dos bytes que a importação
 * guardou — nada é reenviado para obtê-lo.
 */
export function diagnosticarDocumento(
  documentoId: string,
): Promise<{ documento: { id: string; nomeDoArquivo: string }; diagnostico: DiagnosticoDoPagamento }> {
  return fetchJson(`/fechamento/documentos/${documentoId}/diagnostico`);
}

/**
 * Reimporta o documento a partir do arquivo que a importação guardou.
 *
 * O conserto de quando a linha do banco discorda do arquivo — o 03.08.20 com
 * dez verbas dentro e a competência sem nenhuma. Nada é reenviado: os bytes já
 * estão no banco, e é sobre eles que a leitura é refeita. Reimportar não
 * perdoa o arquivo — ele passa pelos mesmos portões do envio, e volta em
 * `EM_QUARENTENA` se continuar não produzindo fato nenhum.
 */
export function reimportarDocumento(documentoId: string): Promise<DocumentoRecebido> {
  return fetchJson<DocumentoRecebido>(`/fechamento/documentos/${documentoId}/reimportar`, {
    method: "POST",
  });
}

/** O que o descarte apagou — contado por fonte, para a tela repetir de volta. */
export interface DadosDescartados {
  competencia: Competencia;
  documentos: number;
  apuracoes: number;
  linhas: Record<TipoDeFonte, number>;
}

/**
 * Descarta tudo que foi importado para a competência.
 *
 * Não é o desfazer de um envio: é o de todos. Existe porque o erro que ele
 * conserta — a quinzena aberta num período e alimentada com os arquivos de
 * outro — não se resolve reenviando por cima: o mesmo arquivo é recusado por
 * SHA na mesma competência enquanto o documento sustentar linhas, que é
 * exatamente o caso do arquivo do período errado. Ver `persistencia.ts`.
 *
 * **Não é mais a saída do documento que não sustenta nada.** Esse tem
 * {@link reimportarDocumento}, e o reenvio dele deixou de ser recusado —
 * descartar seis fontes por causa de uma era o preço de não ter conserto.
 */
export function descartarDados(id: string): Promise<DadosDescartados> {
  return fetchJson<DadosDescartados>(`/fechamento/competencias/${id}/dados`, { method: "DELETE" });
}

/** O que a exclusão levou — o mesmo tamanho que o descarte relata. */
export type CompetenciaExcluida = DadosDescartados;

/**
 * Exclui a competência inteira: a importação some da lista, com tudo dentro.
 *
 * É o outro erro, e não o mesmo do descarte. Descartar serve à quinzena certa
 * alimentada com os arquivos errados — ela fica, vazia, e recebe os certos.
 * Excluir serve à quinzena que não devia existir: o CDD errado, a
 * transportadora errada, o período aberto duas vezes. Uma competência encerrada
 * é recusada pelo servidor: reabrir, com motivo, vem antes.
 */
export function excluirCompetencia(id: string): Promise<CompetenciaExcluida> {
  return fetchJson<CompetenciaExcluida>(`/fechamento/competencias/${id}`, { method: "DELETE" });
}

/**
 * Envia um dos relatórios da quinzena.
 *
 * O arquivo vai em base64 dentro de um JSON, como na importação da Auditoria —
 * ver `routes/fechamento.ts` para o porquê. `FileReader` é usado em vez de
 * `arrayBuffer()` porque o resultado dele já é a data URL de que só o prefixo
 * precisa ser cortado, e o corte é uma linha em vez de uma conversão manual de
 * bytes que é fácil de errar por um caractere.
 */
export async function enviarDocumento(
  competenciaId: string,
  tipo: TipoDeFonte,
  arquivo: File,
): Promise<DocumentoRecebido> {
  const contentBase64 = await lerComoBase64(arquivo);
  const resposta = await fetch(getApiUrl(`/fechamento/competencias/${competenciaId}/documentos`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ tipo, filename: arquivo.name, contentBase64 }),
  });
  const corpo = await readJson(resposta);
  if (!resposta.ok) throw erroDaResposta(resposta, corpo);
  /*
    O 202 é `ok` e não é sucesso: é o arquivo guardado sem valer. Devolvê-lo
    como se fosse o 201 apagava a única notícia que a quarentena produz — quem
    chama tem de olhar `desfecho`.
  */
  return corpo as unknown as DocumentoRecebido;
}

function lerComoBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error(`Não foi possível ler "${arquivo.name}".`));
    leitor.onload = () => {
      const resultado = String(leitor.result ?? "");
      const virgula = resultado.indexOf(",");
      resolve(virgula >= 0 ? resultado.slice(virgula + 1) : resultado);
    };
    leitor.readAsDataURL(arquivo);
  });
}

/** O estado da competência, em palavra que quem opera reconhece. */
export const NOME_DO_ESTADO: Record<Competencia["estado"], string> = {
  ABERTA: "Aberta",
  EM_APURACAO: "Em apuração",
  APURADA: "Apurada",
  APROVADA: "Aprovada",
  ENCERRADA: "Encerrada",
};

/** O que cada divergência significa, em uma frase. */
export const EXPLICACAO_DA_DIVERGENCIA: Record<string, string> = {
  VERBA_SEM_ORIGEM:
    "Foi emitido CT-e nesta verba e nenhuma das fontes da quinzena a sustenta. Não é erro — é a parte fixa do contrato, que ainda não tem fonte aqui.",
  VERBA_NAO_FECHA:
    "A apuração reconstruiu esta verba a partir das fontes e chegou a um valor diferente do emitido.",
  REQUISICAO_NAO_FATURADA:
    "Uma despesa foi aprovada no SRTrans e não virou CT-e nenhum. É valor aprovado que não foi pago.",
  PAGAMENTO_DIVERGE_DO_CTE:
    "O demonstrativo de pagamento (03.08.20) e o CT-e emitido (03.08.15) dizem valores diferentes para a mesma verba. É o documento que as duas partes assinaram contra o que foi faturado.",
  DESCONTO_FRETE_MINIMO:
    "O SRTrans reduziu o valor calculado por frete mínimo. Aparece só na coluna do calculado, sem contrapartida no emitido.",
  SALDO_ATRAVESSANDO:
    "Valor que não se resolveu nesta quinzena e foi empurrado para a seguinte, incluindo nota fiscal sem CT-e.",
  DESCONTO_DE_DISPONIBILIDADE:
    "Desconto sobre a parcela fixa por veículo que não rodou, atribuído à transportadora. Reclassificar o gap para a Ambev devolve o valor.",
  OPERACAO_NAO_FECHA:
    "O que o 2Art registra de frete no canal não bate com o que o SRTrans diz ter calculado.",
  AVISO_DA_CONCILIACAO: "O relatório do Promax trouxe um aviso sem valor associado.",
};
