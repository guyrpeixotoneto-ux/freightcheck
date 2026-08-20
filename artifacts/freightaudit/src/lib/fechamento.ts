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
  /** Em que quinzenas este relatório é esperado. A 1ª tem quatro; a 2ª, os seis. */
  quinzenas: (1 | 2)[];
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
  { valor: TIPO_NAO_INFORMADO, rotulo: "tipo não informado" },
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
 * Os relatórios que uma competência pede, na ordem do catálogo.
 *
 * A quinzena decide: a primeira fecha com quatro relatórios (2Art, 03.08.15,
 * 03.08.20 e 03.08.18) e a segunda com os seis, porque as requisições
 * (03.08.12.09) e a conciliação (03.02.59.02) chegam com o fechamento do mês.
 * Mostrar as seis nas duas fazia toda primeira quinzena exibir duas linhas
 * eternamente vazias — e "falta importar" é trabalho de alguém, enquanto "não
 * há o que importar" não é.
 *
 * `recebidas` é o que já entrou na competência, e entra na lista mesmo fora da
 * quinzena dele: um arquivo enviado nunca some da tela por causa deste recorte.
 * Isso é o que mantém a conta do rodapé honesta — o denominador é esta lista, e
 * um documento fora da quinzena aparece nas duas pontas da fração em vez de
 * virar um `5/4`.
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
  unidade: { codigo: string; nome?: string };
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
  rotulo: string;
  papel: string;
  devido: TresColunas;
  demonstrado: TresColunas;
  diferenca: TresColunas;
  memoria: { primeira: string | null; segunda: string | null };
  falta: string | null;
}

export interface QuadroComparado {
  quadro: string;
  titulo: string;
  linhas: LinhaComparada[];
  devido: TresColunas;
  demonstrado: TresColunas;
  diferenca: TresColunas;
}

export interface PainelComparado {
  canal: string;
  quadros: QuadroComparado[];
  /** De qual cadastro veio cada quinzena — onde conferir um número que surpreende. */
  cadastro: {
    primeira: { cadastroId: string; vigenteDe: string } | null;
    segunda: { cadastroId: string; vigenteDe: string } | null;
  };
  pendencias: string[];
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
  }[];
  canais: CanalDoResumo[];
}

/**
 * O mês inteiro, das duas quinzenas.
 *
 * Os quatro parâmetros são obrigatórios porque um fechamento é a trinca
 * (unidade, transportadora, período): dois CDDs no mesmo mês são dois resumos.
 */
export function lerResumoDoMes(alvo: {
  unidade: string;
  transportadora: string;
  /** `EMPURRADA`, `ROTA` — o resumo é de uma operação, e não da unidade. */
  tipoDeOperacao: string;
  ano: number;
  mes: number;
}): Promise<ResumoDoMes> {
  const busca = new URLSearchParams({
    unidade: alvo.unidade,
    transportadora: alvo.transportadora,
    tipoDeOperacao: alvo.tipoDeOperacao,
    ano: String(alvo.ano),
    mes: String(alvo.mes),
  });
  return fetchJson<ResumoDoMes>(`/fechamento/resumo?${busca.toString()}`);
}

/**
 * O painel da planilha de uma quinzena.
 *
 * Vem em três colunas com só a da quinzena preenchida — a mesma forma do resumo
 * mensal, para que a aba `Planilha` seja o mesmo componente nas duas telas.
 *
 * **404 quando o 03.08.20 não foi importado**, e não um painel de zeros: sem o
 * demonstrativo, o painel não tem de onde sair, e dizer isso é diferente de
 * dizer que a quinzena não pagou nada.
 */
export function lerPainelDaCompetencia(
  id: string,
  canal = "ROTA",
): Promise<{ competencia: Competencia; painel: PainelDaPlanilha }> {
  return fetchJson(`/fechamento/competencias/${id}/de-para?canal=${canal}`);
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
 * outro — não se resolve reenviando por cima, já que o mesmo arquivo é recusado
 * por SHA na mesma competência. Ver `persistencia.ts`.
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
): Promise<Documento> {
  const contentBase64 = await lerComoBase64(arquivo);
  const resposta = await fetch(getApiUrl(`/fechamento/competencias/${competenciaId}/documentos`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ tipo, filename: arquivo.name, contentBase64 }),
  });
  const corpo = await readJson(resposta);
  if (!resposta.ok) throw erroDaResposta(resposta, corpo);
  return corpo as unknown as Documento;
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
