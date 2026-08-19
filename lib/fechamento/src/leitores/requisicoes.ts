import { centavos, lerCanal, lerNumero, type Canal, type Leitura, type Recusa } from "../dominio";
import { diaDeTextoBR, type Dia } from "../periodo";
import { verbaDe, verbaDesconhecida, type Verba } from "../verbas";

/**
 * O 03.08.12.09 — as requisições de despesa aprovadas.
 *
 * É o complementar: tudo que a operação gastou fora do cálculo automático e
 * conseguiu aprovar — incentivo, hora extra, remuneração variável da equipe,
 * taxa de descarga, pernoite, pedágio. O valor circula **sem imposto**, e cada
 * requisição aponta a VBZ em que virará CT-e.
 *
 * **O que este leitor guarda que a planilha jogava fora: a trilha de
 * aprovação.** Cada linha traz quem pediu, quem aprovou no regional, quem
 * aprovou no AC, e quando. A `.xlsb` somava a coluna de valor e seguia; aqui a
 * trilha fica, porque "esta despesa não foi paga" e "esta despesa não foi
 * aprovada a tempo" são pendências diferentes, com donos diferentes.
 *
 * **O arquivo é CSV com ponto e vírgula, em latin-1.** As duas coisas são do
 * SRTrans e não se negociam; o decodificador é escolhido aqui e testado, porque
 * ler `Pesquisa de Risco` como `Pesquisa de Risco` com acento quebrado
 * transformaria o tipo de despesa em duas categorias distintas na tela.
 */

export interface Requisicao {
  linha: number;
  /** O número da requisição no SRTrans — a identidade dela. */
  numero: string;
  /** A quinzena de pagamento, como o arquivo a rotula: o primeiro dia do período. */
  quinzenaDePagamento: Dia | null;
  canal: Canal;
  verba: Verba;
  /** O tipo de despesa, pelo código e nome do SRTrans. */
  tipoDeDespesa: { codigo: string; nome: string };
  /** O que quem pediu escreveu — `Incentivo Geo - Dias de Jogos`, `Fretado Feriado`. */
  descricao: string;
  /** `Aprovada`, `Reprovada`, `Pendente` — como veio. */
  status: string;
  /** O valor **sem** imposto. */
  valor: number;
  solicitante: string;
  aprovadorRegional: string;
  aprovadorAC: string;
  enviadaEm: Dia | null;
  decididaEm: Dia | null;
}

/** O status que faz a requisição entrar na conta. */
export const STATUS_QUE_PAGA = "aprovada";

/**
 * Lê o 03.08.12.09.
 *
 * Recebe o arquivo em bytes e não em texto para poder decodificar latin-1 aqui
 * dentro: quem chama não deveria precisar saber a codificação de uma fonte.
 */
export function lerRequisicoes(arquivo: Buffer | ArrayBuffer): Leitura<Requisicao> {
  const texto = decodificar(arquivo);
  const linhas: Requisicao[] = [];
  const recusas: Recusa[] = [];

  const fisicas = texto.split(/\r?\n/);
  const cabecalho = (fisicas[0] ?? "").split(";").map((c) => normalizar(c));
  const indice = (nome: string) => cabecalho.indexOf(normalizar(nome));

  const iRequisicao = indice("Requisição");
  const iCanal = indice("Canal");
  const iVbz = indice("Cod. VBZ");
  const iValor = indice("Valor");
  if (iRequisicao < 0 || iCanal < 0 || iVbz < 0 || iValor < 0) {
    throw new Error(
      "O arquivo não tem o cabeçalho do relatório de requisições " +
        "(faltou Requisição, Canal, Cod. VBZ ou Valor).",
    );
  }

  for (let i = 1; i < fisicas.length; i += 1) {
    const bruta = fisicas[i];
    if (!bruta || bruta.trim() === "") continue;
    const campos = bruta.split(";");
    const recusar = (motivo: string, original: unknown) => {
      recusas.push({ linha: i + 1, motivo, original: String(original ?? "") });
      return null;
    };

    const canal = lerCanal(campos[iCanal]);
    if (!canal) {
      recusar("O canal da requisição não é Rota nem AS.", campos[iCanal]);
      continue;
    }

    const vbz = lerNumero(campos[iVbz]);
    if (vbz == null) {
      recusar("A requisição não aponta uma VBZ.", campos[iVbz]);
      continue;
    }

    const valor = lerNumero(campos[iValor]);
    if (valor == null) {
      recusar("O valor da requisição não é um número.", campos[iValor]);
      continue;
    }

    const nomeDaVbz = campos[indice("VBZ")] ?? "";
    linhas.push({
      linha: i + 1,
      numero: (campos[iRequisicao] ?? "").trim(),
      quinzenaDePagamento: diaDeTextoBR(campos[indice("Quinzena Pagamento")]),
      canal,
      verba: verbaDe(vbz) ?? verbaDesconhecida(vbz, canal, nomeDaVbz),
      tipoDeDespesa: {
        codigo: (campos[indice("Cod Tipo Despesa")] ?? "").trim(),
        nome: (campos[indice("Tipo Despesa")] ?? "").trim(),
      },
      descricao: (campos[indice("Descrição Despesa")] ?? "").trim(),
      status: (campos[indice("Status")] ?? "").trim(),
      valor: centavos(valor),
      solicitante: (campos[indice("ID Solicitante")] ?? "").trim(),
      aprovadorRegional: (campos[indice("ID Aprovador RG")] ?? "").trim(),
      aprovadorAC: (campos[indice("ID Aprovador AC")] ?? "").trim(),
      enviadaEm: diaDeTextoBR(campos[indice("Data Envio Requisição")]),
      decididaEm: diaDeTextoBR(campos[indice("Data Decisão Regional")]),
    });
  }

  return { linhas, recusas };
}

/**
 * Decodifica o CSV.
 *
 * O SRTrans exporta em latin-1 (ISO-8859-1). Tentar UTF-8 primeiro e cair para
 * latin-1 seria adivinhação: a mesma sequência de bytes é válida nas duas e
 * produz palavras diferentes. Como a origem é conhecida e única, a codificação
 * é declarada — e o teste que lê `Requisição` de volta é quem guarda a
 * declaração.
 */
function decodificar(arquivo: Buffer | ArrayBuffer): string {
  return new TextDecoder("latin1").decode(
    arquivo instanceof Buffer ? arquivo : new Uint8Array(arquivo),
  );
}

function normalizar(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
