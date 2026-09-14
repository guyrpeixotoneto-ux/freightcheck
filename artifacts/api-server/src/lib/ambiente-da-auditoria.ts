import { normalizarOperacao } from "@workspace/comparison";
import { AMBIENTES, type Ambiente } from "./permissoes";

/**
 * O vínculo entre o ambiente de trabalho e a operação do acervo.
 *
 * Os dois eixos já existiam e eram lidos **em separado**: `?ambiente=` decide
 * permissão (`lib/permissoes.ts`) e `?operacao=` decide qual acervo a consulta
 * alcança (`lib/operacao.ts`). Lidos em separado, nada impedia o par
 * incompatível — mandar um ambiente a que se tem acesso junto com a operação de
 * outro —, e o par incompatível é uma leitura do acervo alheio com a permissão
 * do próprio.
 *
 * Aqui o **ambiente é a autoridade** e a operação só pode concordar com ele.
 * A razão de não bastar validar os dois é que não existe, em lugar nenhum deste
 * servidor, uma lista fechada de operações: `normalizarOperacao` não recusa
 * nada — ela normaliza qualquer texto num token, e `?operacao=ROTAA` viraria
 * `ROTAA`, filtrando zero linha sem erro nenhum. Derivar do ambiente é o que
 * cria essa lista fechada, e é o que faz o par trocado e o valor sem sentido
 * morrerem pela mesma porta.
 *
 * **Só as quatro auditorias.** Os quatro ambientes de fechamento existem e são
 * permissão do mesmo jeito, mas o eixo de operação deles é outro
 * (`competencia.tipo_de_operacao`, e não `snapshot.canal`) e eles não leem
 * vigência. Aceitá-los aqui daria uma resposta sobre um acervo que a pergunta
 * não descreve.
 */

export const AMBIENTES_DE_AUDITORIA = [
  "auditoria",
  "auditoria-rota",
  "auditoria-as",
  "auditoria-apoio",
] as const;

export type AmbienteDeAuditoria = (typeof AMBIENTES_DE_AUDITORIA)[number];

/**
 * A operação de cada auditoria.
 *
 * O par de `OPERACAO_DA_AUDITORIA` em `freightaudit/src/lib/ambiente.ts`, e
 * escrito aqui pela mesma razão pela qual {@link AMBIENTES} é: são dois
 * pacotes, e o servidor não importa a tela. A lista é curta e muda junto com o
 * `?operacao=` que separa os acervos.
 *
 * `auditoria` é a Empurrada — ela não tem prefixo de rota porque foi a primeira,
 * e o endereço dela é a raiz do produto.
 */
export const OPERACAO_DA_AUDITORIA: Record<AmbienteDeAuditoria, string> = {
  auditoria: "EMPURRADA",
  "auditoria-rota": "ROTA",
  "auditoria-as": "AS",
  "auditoria-apoio": "APOIO",
};

/** Os códigos de recusa desta porta — cada um alcançável, e nenhum ambíguo. */
export type RecusaDoRecorte =
  | "AMBIENTE_AUSENTE"
  | "AMBIENTE_INVALIDO"
  | "OPERACAO_AUSENTE"
  | "OPERACAO_INVALIDA"
  | "PAR_INCOMPATIVEL";

export type RecorteDaAuditoria =
  | { ok: true; ambiente: AmbienteDeAuditoria; operacao: string }
  | { ok: false; code: RecusaDoRecorte; error: string };

/**
 * O ambiente e a operação da consulta, ou a recusa — **sem tocar no banco**.
 *
 * Função pura de propósito: ela decide sobre a *forma* do pedido, e a forma não
 * depende de quem pergunta. Quem decide sobre a pessoa é o portão de permissão,
 * depois, e as duas decisões respondem com status diferentes por isso — 400
 * aqui, 403 lá.
 *
 * **Nenhuma destas recusas resolve contexto**, e é o que garante que nenhuma
 * revele a existência de unidade, canal ou vigência: elas acontecem antes de
 * `resolveContext` ser chamado.
 *
 * A separação entre ausente e inválido é deliberada, e é por isso que esta
 * função lê a query crua em vez de reusar `ambienteDaConsulta` /
 * `operacaoDaConsulta`: as duas devolvem `null` para o ausente **e** para o
 * desconhecido. Lá isso está certo — um ambiente que este servidor não conhece é
 * um cliente mais novo do que ele, e recusar seria transformar deploy fora de
 * ordem em bloqueio de trabalho. Aqui o ambiente não é carimbo, é a chave da
 * permissão e a origem da operação: tratar desconhecido como ausente abriria a
 * porta que ele deveria fechar.
 */
export function recorteDaAuditoria(
  query: Record<string, unknown>,
): RecorteDaAuditoria {
  const ambienteBruto = query["ambiente"];
  if (typeof ambienteBruto !== "string" || ambienteBruto === "") {
    return {
      ok: false,
      code: "AMBIENTE_AUSENTE",
      error: "Informe o ambiente de trabalho desta leitura.",
    };
  }

  if (!(AMBIENTES_DE_AUDITORIA as readonly string[]).includes(ambienteBruto)) {
    /*
      A frase separa os dois casos sem dar códigos diferentes a eles: um
      ambiente de fechamento é conhecido pelo servidor e ainda assim não serve
      aqui, e quem colou o endereço precisa saber qual das duas coisas houve.
    */
    const conhecido = (AMBIENTES as readonly string[]).includes(ambienteBruto);
    return {
      ok: false,
      code: "AMBIENTE_INVALIDO",
      error: conhecido
        ? "Esta leitura é das auditorias; o Fechamento tem eixo de operação próprio."
        : "Ambiente de trabalho desconhecido.",
    };
  }

  const ambiente = ambienteBruto as AmbienteDeAuditoria;
  const daCasa = OPERACAO_DA_AUDITORIA[ambiente];

  const operacaoBruta = query["operacao"];
  if (typeof operacaoBruta !== "string") {
    return {
      ok: false,
      code: "OPERACAO_AUSENTE",
      error: "Informe a operação desta leitura.",
    };
  }

  const pedida = normalizarOperacao(operacaoBruta);
  if (pedida === null) {
    return {
      ok: false,
      code: "OPERACAO_INVALIDA",
      error: "A operação informada não é um valor legível.",
    };
  }

  if (pedida !== daCasa) {
    /*
      A recusa não diz qual é a operação do ambiente nem qual acervo existe do
      outro lado. Ela diz que o par não fecha, que é tudo o que quem montou o
      endereço precisa saber para corrigi-lo — e é o que mantém a recusa muda
      sobre o acervo alheio.
    */
    return {
      ok: false,
      code: "PAR_INCOMPATIVEL",
      error: "O ambiente de trabalho e a operação pedidos não são o mesmo acervo.",
    };
  }

  return { ok: true, ambiente, operacao: daCasa };
}
