import { centavos, lerCanal, lerFrota, lerNumero, type Canal, type Frota, type Leitura, type Recusa } from "../dominio";
import { diaDeCelula, diaDeSerial, type Dia } from "../periodo";
import { celula, lerAba, type LinhaDePlanilha } from "./planilha";

/**
 * O 2Art — o diário operacional, uma linha por viagem.
 *
 * É a fonte mais rica de todas (cerca de 120 colunas) e a única que descreve
 * o que de fato aconteceu na rua: qual veículo saiu, com quantas caixas,
 * quantas entregou, a que horas voltou e quanto aquilo vale. Todo o frete
 * variável da quinzena nasce aqui — é este arquivo que as abas `01`…`31` da
 * planilha de fechamento reproduzem, uma aba por dia.
 *
 * **A viagem é lida em duas camadas, e a fronteira entre elas é a conta.** Os
 * campos do topo de `Viagem` — dia, canal, frota, caixas, frete, imposto — são
 * os que a apuração soma; mexer neles muda dinheiro. O `detalhe` é o retrato da
 * viagem: veículo, placa, horários, quilometragem, ocupação, a abertura da
 * remuneração da equipe, o previsto do roteirizador. Ele existe porque a tela
 * do dia (a que substitui as abas `01`…`31`) precisa mostrar a linha inteira, e
 * está separado para que continue evidente o que entra na conta e o que é
 * testemunho — nenhum campo de `detalhe` é somado por `apuracao.ts`.
 *
 * **O que falta continua faltando.** Uma coluna que a exportação não trouxe
 * vira `null` (número) ou `""` (texto), nunca zero: um `0` numa coluna de
 * dinheiro é uma afirmação — "esta viagem não pagou isso" —, e o módulo inteiro
 * existe para não fazer afirmação que a fonte não sustenta.
 */

/**
 * O retrato da viagem: as colunas que a tela do dia mostra e a conta não usa.
 *
 * Tudo aqui é opcional por natureza — o 2Art de um CDD traz colunas que o de
 * outro não traz, e o mesmo relatório muda de grafia conforme quem exporta
 * (ver `compactarColuna`, em `planilha.ts`). Nada aqui recusa uma linha.
 */
export interface DetalheDaViagem {
  /* --- quem rodou --------------------------------------------------------- */
  /** O código da transportadora na linha (`Transp`), como texto: é identidade. */
  transportadora: string;
  /** `Roteriz`, `Extra`, `Recarga` — o que originou a carga (`CargaAtual`). */
  cargaAtual: string;
  /** A região de entrega, como o roteirizador a numera. */
  regiao: string;
  /** O código do veículo na frota (`Veiculo`) — identidade, não quantidade. */
  veiculo: string;
  /** O que o 2Art registra como entrega ou volume (`EntrVol`). */
  entregaOuVolume: string;
  /** A unidade de origem da carga (`UnbOrigem`). */
  unidadeDeOrigem: string;
  /** `SitMultiCDD` — a marca de operação multi-CDD, como o relatório a escreve. */
  situacaoMultiCdd: string;
  /** `VeicCadDD` — se o veículo é cadastrado no CDD (`S`/`N`). */
  veiculoCadastradoNoCdd: string;
  matriculaDoMotorista: string;
  matriculaDoAjudante1: string;
  matriculaDoAjudante2: string;

  /* --- a indisponibilidade ------------------------------------------------ */
  /** O veículo que substituiu, quando houve substituição (`VeiculoIndisp`). */
  veiculoIndisponivel: string;
  placaIndisponivel: string;
  frotaIndisponivel: string;
  /** O motivo da indisponibilidade, como o 2Art o classifica (`TipoIndisp`). */
  tipoDeIndisponibilidade: string;

  /* --- o que a viagem moveu ----------------------------------------------- */
  /** Percentual de ocupação do veículo. */
  ocupacao: number | null;
  caixasDeRota: number | null;
  caixasDeAs: number | null;
  /** `VeicBM` — o veículo em base móvel, como o relatório o mede. */
  veiculoBm: number | null;
  /** `RShow` — preservado como o relatório o escreve, sem interpretação nossa. */
  rShow: number | null;

  /* --- o relógio e o hodômetro -------------------------------------------- */
  /** `dd/mm/aaaa hh:mm`, como o 2Art a escreve. Ver `comoInstante`. */
  horaDeSaida: string;
  horaDeEntrada: string;
  kmDeSaida: number | null;
  kmDeEntrada: number | null;
  /** Duração `h:mm`, preservada como texto — ver `comoDuracao`. */
  tempoInterno: string;
  tempoDoLaco: string;
  tempoDeDeslocamento: string;
  kmDoLaco: number | null;
  kmDeDeslocamento: number | null;

  /* --- o previsto do roteirizador ----------------------------------------- */
  tempoPrevisto: string;
  kmPrevisto: number | null;

  /* --- o dinheiro da viagem, além do frete -------------------------------- */
  custoSpot: number | null;
  custoVariavel: number | null;
  lucro: number | null;
  lucroUnitario: number | null;
  /** `CTRC-ICMS`, `NF-ISS` — o regime que a linha declara. */
  tipoDeImposto: string;
  valorUnitarioPorCaixaEntregue: number | null;
  valorPagoPorCaixaSemImposto: number | null;
  valorPagoPorCaixaComImposto: number | null;
  valorDropdown: number | null;

  /* --- a remuneração da equipe -------------------------------------------- */
  valorUnitarioDoPontoDoMotorista: number | null;
  valorUnitarioDoPontoDoAjudante: number | null;
  valorDaEquipeDeEntregaMotorista: number | null;
  valorDaEquipeDeEntregaAjudante: number | null;

  /* --- a abertura CEDBZ --------------------------------------------------- */
  custoVariavelCedbz: number | null;
  lucroUnitarioCedbz: number | null;
  lucroVariavelPorCaixaEntregueFfcedbz: number | null;
}

export interface Viagem {
  /** A linha física no arquivo — a ponta da trilha até a célula de origem. */
  linha: number;
  dia: Dia;
  canal: Canal;
  frota: Frota;
  /** A placa do veículo que rodou. Vazia quando a viagem não teve veículo alocado. */
  placa: string;
  /** O mapa (a rota do dia), como o roteirizador o numerou. */
  mapa: string;
  entregas: number;
  caixasCarregadas: number;
  caixasEntregues: number;
  /** O frete da viagem, **sem** imposto. É o que se soma para apurar o variável. */
  valorFrete: number;
  /** A alíquota que o Promax declarou nesta linha, em pontos percentuais. */
  percentualDeImposto: number | null;
  valorDeImposto: number;
  /** O frete **com** imposto — o que se compara ao CT-e. */
  valorFaturado: number;
  /**
   * O resto da linha — o que a tela do dia mostra e a conta não usa.
   *
   * Opcional porque a apuração reconstrói viagens a partir do banco sem
   * precisar dele (ver `lerFontesDoBanco`): carregar sessenta colunas para
   * somar quinze seria pagar por um detalhe que ninguém vai ler ali.
   */
  detalhe?: DetalheDaViagem;
}

const COLUNAS_EXIGIDAS = ["Data", "Entrega", "Frota", "ValorFrete", "ValorFaturado"];

/**
 * Lê o 2Art.
 *
 * Uma viagem sem data, sem canal ou sem frota reconhecíveis é recusada, e não
 * corrigida: essas três colunas são os eixos de toda agregação seguinte, e uma
 * viagem que entra no dia errado tira dinheiro de uma quinzena e põe em outra.
 * Já `ValorFrete` ausente **não** recusa a linha — vira zero explícito, porque
 * o 2Art traz viagens canceladas e improdutivas que valem zero de verdade e
 * ainda assim contam para a operação do dia.
 */
export function lerOperacao(arquivo: Buffer | ArrayBuffer): Leitura<Viagem> {
  const planilha = lerAba(arquivo, { exigidas: COLUNAS_EXIGIDAS });
  const linhas: Viagem[] = [];
  const recusas: Recusa[] = [];

  for (const bruta of planilha.linhas) {
    const viagem = lerViagem(bruta, recusas);
    if (viagem) linhas.push(viagem);
  }

  return { linhas, recusas };
}

function lerViagem(bruta: LinhaDePlanilha, recusas: Recusa[]): Viagem | null {
  const recusar = (motivo: string, original: unknown) => {
    recusas.push({ linha: bruta.numero, motivo, original: String(original ?? "") });
    return null;
  };

  const dia = diaDeCelula(celula(bruta, "Data"));
  if (!dia) {
    return recusar(
      "A data da viagem não está em nenhum formato conhecido (ddmmaaaa, dd/mm/aaaa ou serial).",
      celula(bruta, "Data"),
    );
  }

  const canal = lerCanal(celula(bruta, "Entrega"));
  if (!canal) return recusar("O canal da viagem não é Rota nem AS.", celula(bruta, "Entrega"));

  const frota = lerFrota(celula(bruta, "Frota"));
  if (!frota) return recusar("O tipo de frota não é reconhecido.", celula(bruta, "Frota"));

  const valorFrete = lerNumero(celula(bruta, "ValorFrete")) ?? 0;
  const valorFaturado = lerNumero(celula(bruta, "ValorFaturado")) ?? 0;

  return {
    linha: bruta.numero,
    dia,
    canal,
    frota,
    placa: comoTexto(bruta, "Placa"),
    mapa: comoTexto(bruta, "Mapa"),
    entregas: lerNumero(celula(bruta, "Entregas")) ?? 0,
    caixasCarregadas: lerNumero(celula(bruta, "CxCarreg")) ?? 0,
    caixasEntregues: lerNumero(celula(bruta, "CxEntreg")) ?? 0,
    valorFrete: centavos(valorFrete),
    percentualDeImposto: lerNumero(celula(bruta, "PercImposto")),
    valorDeImposto: centavos(lerNumero(celula(bruta, "ValorImposto")) ?? 0),
    valorFaturado: centavos(valorFaturado),
    detalhe: lerDetalhe(bruta),
  };
}

function lerDetalhe(bruta: LinhaDePlanilha): DetalheDaViagem {
  const numero = (coluna: string) => lerNumero(celula(bruta, coluna));
  const texto = (coluna: string) => comoTexto(bruta, coluna);
  const marca = (coluna: string) => comoMarca(bruta, coluna);

  return {
    transportadora: texto("Transp"),
    cargaAtual: texto("CargaAtual"),
    regiao: texto("Regiao"),
    veiculo: texto("Veiculo"),
    entregaOuVolume: texto("EntrVol"),
    unidadeDeOrigem: texto("UnbOrigem"),
    situacaoMultiCdd: texto("SitMultiCDD"),
    veiculoCadastradoNoCdd: texto("VeicCadDD"),
    matriculaDoMotorista: texto("MatricMotorista"),
    matriculaDoAjudante1: texto("MatricAjudante1"),
    matriculaDoAjudante2: texto("MatricAjudante2"),

    /*
      As quatro colunas da indisponibilidade passam por `comoMarca`, e não por
      `texto`: duas delas são numéricas e escrevem **zero** para dizer "não há".
      Ver `comoMarca` para o que isso custava.
    */
    veiculoIndisponivel: marca("VeiculoIndisp"),
    placaIndisponivel: marca("PlacaIndisp"),
    frotaIndisponivel: marca("FrotaIndisp"),
    tipoDeIndisponibilidade: marca("TipoIndisp"),

    ocupacao: numero("Ocupacao"),
    caixasDeRota: numero("CxRota"),
    caixasDeAs: numero("CxAS"),
    veiculoBm: numero("VeicBM"),
    rShow: numero("RShow"),

    horaDeSaida: comoInstante(celula(bruta, "HrSaida")),
    horaDeEntrada: comoInstante(celula(bruta, "HrEntrada")),
    kmDeSaida: numero("KmSaida"),
    kmDeEntrada: numero("KmEntrada"),
    tempoInterno: comoDuracao(celula(bruta, "TempoInterno")),
    tempoDoLaco: comoDuracao(celula(bruta, "TempoLaco")),
    tempoDeDeslocamento: comoDuracao(celula(bruta, "TempoDeslocamento")),
    kmDoLaco: numero("KmLaco"),
    kmDeDeslocamento: numero("KmDeslocamento"),

    /* O roteirizador escreve `Road` numa exportação e `Rodado` na outra. */
    tempoPrevisto: comoDuracao(
      celula(bruta, "TempoPrevistoRoad") ?? celula(bruta, "TempoPrevistoRodado"),
    ),
    kmPrevisto: numero("KmPrevistoRoad") ?? numero("KmPrevistoRodado"),

    custoSpot: numero("CustoSpot"),
    custoVariavel: numero("CustoVariavel"),
    lucro: numero("Lucro"),
    lucroUnitario: numero("LucroUnit"),
    tipoDeImposto: texto("TipoImposto"),
    valorUnitarioPorCaixaEntregue: numero("ValorUnitCxEntregue"),
    valorPagoPorCaixaSemImposto: numero("ValorPgCxEntregSemImp"),
    valorPagoPorCaixaComImposto: numero("ValorPgCxEntregComImp"),
    valorDropdown: numero("ValorDropdown"),

    valorUnitarioDoPontoDoMotorista: numero("ValorUnitPontoMot"),
    valorUnitarioDoPontoDoAjudante: numero("ValorUnitPontoAjd"),
    valorDaEquipeDeEntregaMotorista: numero("ValorEquipeEntrMot"),
    valorDaEquipeDeEntregaAjudante: numero("ValorEquipeEntrAjd"),

    custoVariavelCedbz: numero("CustoVariavelCEDBZ"),
    lucroUnitarioCedbz: numero("LucroUnitCEDBZ"),
    lucroVariavelPorCaixaEntregueFfcedbz: numero("LucroVariavelCxEntregueFFCEDBZ"),
  };
}

/** O texto de uma coluna, sem espaço em volta. Vazio quando a coluna não veio. */
function comoTexto(bruta: LinhaDePlanilha, coluna: string): string {
  return String(celula(bruta, coluna) ?? "").trim();
}

/**
 * Uma marca que o 2Art escreve como **número** quando ela não existe.
 *
 * **O bug que isto conserta, e como ele passava.** O bloco da indisponibilidade
 * tem quatro colunas: `PlacaIndisp` e `FrotaIndisp` são texto e chegam em
 * branco quando não há indisponibilidade; `VeiculoIndisp` e `TipoIndisp` são
 * numéricas e chegam com **zero**. `comoTexto` transformava esse zero em `"0"`,
 * que é uma string não vazia — e `somarIndisponibilidade` conta como marcada
 * toda viagem cujo tipo não é vazio. Resultado: **todas** as viagens entravam
 * na linha `INDISPONIBILIDADE`.
 *
 * Não era pequeno. Nos arquivos reais de julho/2026 a linha somava
 * R$ 308.411,01 na 1ª quinzena e R$ 328.169,46 na 2ª — que é o faturado inteiro
 * da Rota, viagem por viagem —, onde o `RESUMO GERAL` imprime `R$ -` nas duas.
 *
 * **Por que só apareceu agora.** O caminho que exercita isto é o da importação
 * de verdade; a reconciliação roda sobre as abas diárias da `.xlsb`, que não
 * têm estas colunas, e os testes de unidade montavam a viagem com `""`. Um
 * defeito que só existe entre o arquivo e o motor não é visível de nenhum dos
 * dois lados.
 *
 * **O alcance do que se sabe, dito.** Nas 1.827 linhas das duas quinzenas
 * conferidas `TipoIndisp` é `0` em todas, e a planilha confirma o zero. Não há,
 * nesta competência, nenhuma viagem com indisponibilidade — então não se sabe
 * como o 2Art escreve uma marca de verdade. O que esta função afirma é só o que
 * está provado: `0` é ausência, do mesmo jeito que o branco é ausência nas duas
 * colunas de texto ao lado. Um código numérico diferente de zero atravessa
 * inteiro e vira marca, que é o comportamento certo se for esse o formato.
 */
function comoMarca(bruta: LinhaDePlanilha, coluna: string): string {
  const texto = comoTexto(bruta, coluna);
  return texto === "0" ? "" : texto;
}

/**
 * O instante de saída ou de entrada, sempre em `dd/mm/aaaa hh:mm`.
 *
 * O 2Art escreve as duas colunas como texto quando exportado do Promax e como
 * data-hora nativa quando alguém o reabre e salva pelo Excel — e aí a célula
 * chega como serial fracionário (`46204,3187`), que na tela viraria um número
 * de cinco casas no lugar de um horário. As duas formas passam por aqui e saem
 * iguais; o que não é nem uma nem outra é preservado como veio, porque o
 * horário da viagem é testemunho e não conta.
 */
function comoInstante(bruto: unknown): string {
  if (typeof bruto === "number" && Number.isFinite(bruto)) {
    const dia = diaDeSerial(Math.floor(bruto));
    if (!dia) return String(bruto);
    const minutosDoDia = Math.round((bruto - Math.floor(bruto)) * 24 * 60);
    const hh = Math.floor(minutosDoDia / 60) % 24;
    const mm = minutosDoDia % 60;
    const [ano, mes, d] = dia.split("-");
    return `${d}/${mes}/${ano} ${hh}:${String(mm).padStart(2, "0")}`;
  }
  return String(bruto ?? "").trim();
}

/**
 * Uma duração (`9:14`, `00:37`, `0:37:00`), preservada como o relatório a
 * escreve.
 *
 * Não vira minutos nem número: o mesmo arquivo escreve a mesma grandeza em
 * `h:mm` e em `h:mm:ss`, e converter as duas para uma só unidade seria decidir,
 * sem fonte, qual delas o relatório quis dizer. O que a tela precisa é mostrar
 * o que está lá — e o Excel, quando a célula é hora nativa, entrega a fração do
 * dia, que é convertida aqui para o mesmo `h:mm`.
 */
function comoDuracao(bruto: unknown): string {
  if (typeof bruto === "number" && Number.isFinite(bruto)) {
    if (bruto === 0) return "0:00";
    /* Fração do dia (0,3854 = 9:15). Acima de 1 é dia inteiro mais o resto. */
    const minutos = Math.round(bruto * 24 * 60);
    return `${Math.floor(minutos / 60)}:${String(minutos % 60).padStart(2, "0")}`;
  }
  return String(bruto ?? "").trim();
}
