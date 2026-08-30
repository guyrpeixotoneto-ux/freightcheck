import {
  ContextNotFoundError,
  JanelaInvalidaError,
  RecursoDeOutraOperacaoError,
} from "@workspace/comparison";
import {
  BaixaRecusada,
  CelulaNaoEncontrada,
  DecisaoRecusada,
} from "@workspace/coverage";
import { VigenciaNaoEncontradaError } from "@workspace/qlp";
import {
  CodigoRecusado,
  ComparacaoSemDuasVigencias,
  ExclusaoRecusada,
  LinhaDaPlanilhaInvalida,
  PlanilhaVazia,
  UnidadeInvalida,
  UnidadeJaRegistrada,
  UnidadeNaoRegistrada,
  VigenciaDoCadastroNaoEncontrada,
  VigenciaForaDaQuinzena,
} from "@workspace/remuneracao";
import { TipoDeOperacaoAusente } from "@workspace/fechamento/persistencia";
import {
  ConexaoDuplicada,
  ConexaoNaoEncontrada,
  EmpresaDesconhecida,
  EtapaNaoEncontrada,
  FluxoNaoEncontrado,
  RecusaDeFluxo,
  SlugJaUsado,
} from "@workspace/fluxos";
import {
  IntegracaoNaoEncontrada,
  NomeDeIntegracaoJaUsado,
  RecusaDeIntegracao,
} from "@workspace/integrations";
import { EmailAlreadyUsedError } from "./session";
import {
  EmpresaNaoPermitida,
  EscopoDeEmpresaAusente,
} from "./empresa-da-requisicao";

/**
 * As recusas que têm nome, e o número HTTP de cada uma — numa tabela só.
 *
 * Estas classes não são defeito nosso: são o domínio dizendo "o que você pediu
 * não existe" ou "esta regra não deixa". A tradução delas para HTTP já estava
 * escrita — no comentário de cada classe, em `@workspace/comparison` e em
 * `@workspace/coverage`, lê-se "a rota traduz em 404" — e era executada por uma
 * cópia do `try/catch` por handler. Trinta e nove cópias, e o problema não era
 * a repetição: era o que vinha **junto** com ela.
 *
 * ```ts
 * } catch (err) {
 *   if (sendContextError(res, err)) return;          // a recusa, traduzida
 *   req.log.error({ err }, "Error building …");
 *   res.status(500).json({ error: "Internal server error" });   // e o resto
 * }
 * ```
 *
 * A segunda metade é que era o defeito. Para converter *uma* recusa nomeada, o
 * handler precisava capturar **tudo** — e o que não fosse aquela recusa perdia
 * ali o `code`, o `requestId` e a chance de ser classificado como banco
 * divergente, virando uma constante que nenhuma tela consegue explicar.
 *
 * Com a tradução aqui, o handler não precisa mais capturar nada: a exceção sobe
 * até `middlewares/contrato-json.ts`, que pergunta **nesta ordem** — é recusa
 * nomeada? falta schema? — e só então responde 500. Nenhum caminho perde
 * informação por causa de outro.
 *
 * **O que não entra nesta tabela.** Recusa cujo número depende do *conteúdo* do
 * erro, e não da classe dele: a promoção que responde 409 ou 422 conforme a
 * decisão que o pipeline tomou, a exclusão que responde 404 ou 409 conforme o
 * que ela não encontrou. Aquilo continua no `catch` da rota, que é onde o dado
 * para decidir existe — e é o que "preservar o tratamento intencional de 4xx"
 * quer dizer.
 */
const RECUSAS: { classe: new (...args: never[]) => Error; status: number }[] = [
  /* O contexto pedido não existe: não há o que importar, ou aquela unidade
     nunca entregou nada. 404 — a ausência é do recurso. */
  { classe: ContextNotFoundError, status: 404 },
  /* O contexto existe e o **recorte** é que não. 400, e nunca 404: trocar os
     dois faria a tela oferecer "importe alguma coisa" a quem só precisa
     escolher outra ponta da janela. */
  { classe: JanelaInvalidaError, status: 400 },
  /* O recurso existe, e é de outra operação. 404 — do ponto de vista de quem
     pergunta, ele não está no acervo desta auditoria; e a mensagem diz qual é a
     operação dele, para quem colou o link saber onde abrir. */
  { classe: RecursoDeOutraOperacaoError, status: 404 },
  { classe: CelulaNaoEncontrada, status: 404 },
  /* O contexto de QLP existe; a quinzena pedida é que não foi importada. 404 —
     a ausência é da vigência, e responder a mais próxima seria o número certo
     sob o título errado. */
  { classe: VigenciaNaoEncontradaError, status: 404 },
  /* Idem para o cadastro de remuneração: a unidade existe, a vigência pedida é
     que não. Classe própria, e não a do QLP, porque as duas telas oferecem
     listas de vigências diferentes — a mensagem precisa nomear a lista certa. */
  { classe: VigenciaDoCadastroNaoEncontrada, status: 404 },
  /* Criar uma vigência que não é quinzena. 400, e não 404: a unidade existe e o
     pedido é que está errado — a data pedida não é começo de quinzena, e criar
     uma no meio do mês guardaria a planilha onde nenhuma tela a procura. */
  { classe: VigenciaForaDaQuinzena, status: 400 },
  /* A unidade existe e o cadastro dela também; o que não existe é o **par**.
     422 e nunca 404: um 404 mandaria procurar uma unidade que está bem ali. */
  { classe: ComparacaoSemDuasVigencias, status: 422 },
  /* A célula que chegou não é da planilha: chave fora do catálogo, percentual
     em fração, quantidade quebrada. 400 — o defeito está no pedido, e a frase
     nomeia a linha e o que ela esperava. */
  { classe: LinhaDaPlanilhaInvalida, status: 400 },
  /* Salvar sem célula nenhuma. 400 e não 204: quem clicou em salvar espera que
     alguma coisa tenha sido salva, e o silêncio deixaria a dúvida de se a
     planilha foi apagada. */
  { classe: PlanilhaVazia, status: 400 },
  /* Regra de negócio escrita para quem opera — a frase é dela, e sai inteira. */
  { classe: DecisaoRecusada, status: 422 },
  { classe: BaixaRecusada, status: 422 },
  /* Abrir um fechamento sem dizer de qual operação ele é. 400: o pedido está
     incompleto, e a frase do domínio explica por que o campo existe — EMPURRADA
     e ROTA são fechamentos diferentes na mesma quinzena. */
  { classe: TipoDeOperacaoAusente, status: 400 },
  /* Registrar unidade sem o que a identifica. 400 — falta no pedido, e a frase
     diz qual campo e por que ele não é opcional. */
  { classe: UnidadeInvalida, status: 400 },
  /* Aquele par (escopo, canal) já está registrado. 409 e não 400: o pedido
     está bem formado, o estado é que já responde por ele — e a frase manda
     para a lista, onde a unidade está. */
  { classe: UnidadeJaRegistrada, status: 409 },
  /* Informar o código de um escopo que não é de unidade cadastrada à mão. 404:
     o pedido está bom, e o que não existe é a unidade que ele nomeia — em geral
     porque o export chegou entre a tela abrir e o clique. */
  { classe: UnidadeNaoRegistrada, status: 404 },
  /* O código não cabe naquela unidade: ela já tem um, ou o destino já está
     ocupado. 409 pela razão do `UnidadeJaRegistrada` — o pedido está bem
     formado, e é o estado que já responde. A frase nomeia o que está no
     caminho, porque a saída é sempre manual. */
  { classe: CodigoRecusado, status: 409 },
  /* Apagar a unidade cadastrada à mão que ainda tem planilha. 409 pela mesma
     razão das duas acima — o pedido está bem formado, e é o estado que
     responde: as quinzenas informadas saem primeiro, uma a uma, para que o que
     se perde esteja escrito antes de cada clique. */
  { classe: ExclusaoRecusada, status: 409 },
  /* Conflito de estado, não defeito do pedido: o e-mail já é de outra conta. */
  { classe: EmailAlreadyUsedError, status: 409 },
  /*
    Fluxos Operacionais. As filhas vêm **antes** da base, e a ordem é o
    contrato: `statusDaRecusa` devolve o primeiro `instanceof` que casar, e
    `RecusaDeFluxo` casa com todas as filhas. Invertê-las faria todo "não
    existe" virar 400.

    Não encontrado é 404 — e é a mesma resposta para "não existe" e para "é de
    outra empresa", de propósito: confirmar que o registro existe noutra empresa
    já é vazamento. Ver `lib/fluxos/src/repositorio.ts`.
  */
  { classe: FluxoNaoEncontrado, status: 404 },
  { classe: EtapaNaoEncontrada, status: 404 },
  { classe: ConexaoNaoEncontrada, status: 404 },
  /* A empresa citada não está cadastrada em Unidades — 404, e a frase manda lá. */
  { classe: EmpresaDesconhecida, status: 404 },
  /* Estado, não pedido: o endereço já é de outro fluxo desta empresa. */
  { classe: SlugJaUsado, status: 409 },
  /* Idem: as duas etapas já estão ligadas por uma seta deste tipo. */
  { classe: ConexaoDuplicada, status: 409 },
  /* Qualquer outra recusa do motor é defeito do pedido, com a frase do domínio. */
  { classe: RecusaDeFluxo, status: 400 },
  /*
    O escopo de empresa. Ausente é 400 — falta um dado do pedido, e a frase diz
    qual e onde escolhê-lo. Não permitida é 403: o pedido está completo, e é a
    conta que não alcança. Ver `lib/empresa-da-requisicao.ts`.
  */
  /*
    Integrações. As filhas antes da base, pela mesma razão dos fluxos:
    `statusDaRecusa` devolve o primeiro `instanceof` que casar.

    O nome repetido é 409 e não 400 — o pedido está bem formado, e é o estado
    que responde; a frase manda para a integração que já existe. O que não
    existe é 404. Tudo o mais que a gestão recusa é defeito do pedido.
  */
  { classe: NomeDeIntegracaoJaUsado, status: 409 },
  { classe: IntegracaoNaoEncontrada, status: 404 },
  { classe: RecusaDeIntegracao, status: 400 },
  { classe: EscopoDeEmpresaAusente, status: 400 },
  { classe: EmpresaNaoPermitida, status: 403 },
];

/**
 * O status desta recusa, ou `null` se o erro não for uma.
 *
 * A pergunta é pela **classe**, nunca pelo texto. Um `instanceof` não confunde
 * a frase de um domínio com a de um driver; uma heurística sobre a mensagem
 * confundiria, e é assim que consulta SQL chega à tela.
 */
export function statusDaRecusa(err: unknown): number | null {
  for (const { classe, status } of RECUSAS) {
    if (err instanceof classe) return status;
  }
  return null;
}
