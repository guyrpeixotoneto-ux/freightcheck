import {
  diagnosticar,
  type Diagnostico,
  type EstadoDoBanco,
} from "@workspace/db/diagnostico";
import { observarBanco } from "./migrations";

/**
 * Este processo está pronto, e este processo pode servir produto?
 *
 * ---------------------------------------------------------------------------
 * Duas perguntas, e confundi-las é o defeito que este módulo separa
 * ---------------------------------------------------------------------------
 * **Prontidão** (`pronto`) é a resposta a "tudo o que este build precisa está
 * de pé neste ambiente?". Ela inclui a conectividade com o banco, a fila de
 * migrations obrigatórias deste build e a conferência de schema — é o que
 * `/readyz` publica, e é a pergunta que um probe de readiness faria.
 *
 * **O portão** (`bloqueiaProduto`) é a resposta a outra coisa: "deixar esta
 * requisição atravessar produz dado errado?". Ela é mais estreita de
 * propósito, e a diferença está documentada em `CONTRATO_DIVERGENTE`.
 *
 * Enquanto as duas eram um campo só, `/readyz` respondia `ready: true` com o
 * banco fora do ar — porque o portão, corretamente, não fecha nesse caso — e
 * quem consultasse a prontidão para diagnosticar uma falha recebia "está tudo
 * pronto" no exato momento em que nada estava.
 *
 * ---------------------------------------------------------------------------
 * A janela que o portão fecha
 * ---------------------------------------------------------------------------
 * A partida deste servidor abre a porta **antes** de a fila rodar: o `listen`
 * acontece, e só no callback dele `applyMigrationsInBackground()` começa (ver
 * `index.ts`, e o porquê — o startup probe do autoscale desiste se a porta
 * demora). Entre os dois instantes o roteador já encaminha `/api/*` para um
 * processo cujo banco pode estar em qualquer estado anterior.
 *
 * Foi essa janela, e não a `0055`, que produziu o envio de 22/08/2026: a tela
 * nova oferecia as duas casinhas do 03.08.18 e o banco ainda aplicava a lista
 * fechada de antes. A `0055` só teve o azar de ser a primeira migration a
 * mudar contrato de banco depois que a janela existia — qualquer próxima faria
 * igual.
 *
 * ---------------------------------------------------------------------------
 * Uma autoridade só, e medida — nunca declarada na partida
 * ---------------------------------------------------------------------------
 * A prontidão não é declarada pela partida — ela é **medida**, pelo mesmo
 * `diagnosticar(observarBanco())` que responde a todo o resto. A partida que
 * declarasse "convergi" seria uma segunda versão da verdade, e as duas
 * discordariam no dia em que outra instância, ou uma pessoa, aplicasse a fila.
 * Medindo, a prontidão acompanha o banco assim que ele converge — não importa
 * quem o converteu, nem se este processo reiniciou.
 */

/** O que se sabe sobre servir, agora. */
export interface Prontidao {
  /**
   * Tudo o que este build precisa está de pé: banco alcançável, fila aplicada,
   * schema conferido. É o que `/readyz` responde, e é `SAUDAVEL` e nada mais.
   */
  pronto: boolean;
  /** Uma requisição de produto agora produziria dado sob contrato divergente. */
  bloqueiaProduto: boolean;
  /** O estado que sustenta as duas respostas — sempre presente. */
  diagnostico: Diagnostico;
}

/**
 * Os estados em que o código e o banco falam versões diferentes do contrato.
 *
 * Os três têm a mesma forma: **a fila deste build não está aplicada aqui**, e
 * por isso não há como saber que versão de contrato o banco aplica. Gravar
 * dentro disso é o que produz metade de uma competência, ou um 500 sobre um
 * arquivo perfeito.
 *
 * **O que deliberadamente não fecha o portão** — e nenhum deles passa por
 * pronto: os três respondem `ready: false` em `/readyz`, com o diagnóstico
 * inteiro. O que muda é só quem responde a requisição de produto:
 *
 * - `SCHEMA_DIVERGENTE` e `BRIDGE_PENDENTE`. Aqui o registro está completo e o
 *   que falta é um objeto nomeado. Derrubar o produto inteiro por causa de uma
 *   coluna seria desproporcional — e existe resposta proporcional: a rota que
 *   esbarra nele responde 503 com o diagnóstico (`faltaSchema`, em
 *   `schema-ausente.ts`). O portão é para o estado que nenhuma rota consegue
 *   circunscrever; a segunda linha é para o que se circunscreve.
 * - `INDISPONIVEL`. Com o banco fora, fechar o portão troca o erro de conexão
 *   real — que diz o que houve e é o que a plataforma precisa ver — por um
 *   "não estou pronto" que esconde a causa. E uma queda de segundos passaria a
 *   travar o processo inteiro em vez de falhar as chamadas daquele instante.
 *   A rota que esbarra nele responde 503 com o mesmo diagnóstico, por
 *   `contrato-json.ts`.
 * - `SAUDAVEL`, evidentemente.
 */
const CONTRATO_DIVERGENTE: ReadonlySet<EstadoDoBanco> = new Set<EstadoDoBanco>([
  "MIGRATIONS_PENDENTES",
  "MIGRATION_FALHOU",
  "REGISTRO_PERDIDO",
]);

/**
 * Convergiu uma vez, e o **portão** não se pergunta mais.
 *
 * O caminho quente não paga nada depois da partida: uma vez que o banco
 * respondeu "a fila deste build está aplicada", nenhuma requisição de produto
 * volta a consultá-lo por causa do portão. O que acontecer com o schema
 * **depois** disso — o Provision que remove uma coluna, o banco trocado por
 * fora — é drift, e para drift a resposta certa é a da rota que esbarra nele,
 * não um portão que reabre e fecha a cada leitura.
 *
 * **A memória é do portão, e só dele.** `/readyz` nunca a consulta: uma
 * prontidão que respondesse pela lembrança da partida seria o estado obsoleto
 * que este módulo existe para não ter — diria "pronto" com o banco fora do ar,
 * horas depois de a medição que a fixou ter deixado de valer.
 */
let convergiu = false;

/** A observação em curso, compartilhada — ver `medir`. */
let emVoo: Promise<Prontidao> | null = null;

/**
 * O estado agora, perguntando ao banco.
 *
 * **As leituras concorrentes dividem uma observação só.** Na partida chegam
 * várias requisições no mesmo instante, e num processo travado por migration
 * que falhou elas chegariam para sempre: sem isto, cada uma abriria a sua
 * rodada de consultas ao banco e o portão fechado viraria um amplificador de
 * carga em cima de um banco que já está em incidente.
 *
 * O que **não** existe aqui é cache com prazo. Uma janela de validade, por
 * curta que fosse, é a mesma classe de defeito da memória de partida: a
 * primeira resposta depois de a fila rodar continuaria dizendo que ela não
 * rodou. O preço de não ter é uma rodada de consultas por chamada de
 * `/readyz` — e `/readyz` não está no caminho de nenhuma tela.
 */
async function medir(): Promise<Prontidao> {
  if (emVoo) return emVoo;

  const medindo = (async (): Promise<Prontidao> => {
    const diagnostico = diagnosticar(await observarBanco());
    const bloqueiaProduto = CONTRATO_DIVERGENTE.has(diagnostico.estado);
    if (!bloqueiaProduto) convergiu = true;
    return {
      pronto: diagnostico.estado === "SAUDAVEL",
      bloqueiaProduto,
      diagnostico,
    };
  })();

  emVoo = medindo;
  void medindo
    .catch(() => undefined)
    .finally(() => {
      if (emVoo === medindo) emVoo = null;
    });
  return medindo;
}

/**
 * A prontidão deste processo, sempre medida agora.
 *
 * É o que `/readyz` responde e o que a interface consulta quando uma chamada
 * falha. Nunca responde pela memória do portão: é justamente depois de
 * convergir que o banco pode cair, e uma prontidão que não voltasse a olhar
 * responderia "pronto" no meio de uma queda.
 */
export async function estadoDaProntidao(): Promise<Prontidao> {
  return medir();
}

/** O portão está fechado para esta requisição de produto? */
export type EstadoDoPortao =
  { bloqueia: false } | { bloqueia: true; diagnostico: Diagnostico };

/**
 * A pergunta do portão, com o atalho da convergência.
 *
 * Separada de `estadoDaProntidao` porque só ela pode usar a memória: "a fila
 * deste build está aplicada neste banco" é um fato que não se desfaz — o que
 * pode mudar depois é outra coisa (drift, queda), e para essas a resposta certa
 * é a da rota, não a do portão.
 */
export async function estadoDoPortao(): Promise<EstadoDoPortao> {
  if (convergiu) return { bloqueia: false };
  const estado = await medir();
  return estado.bloqueiaProduto
    ? { bloqueia: true, diagnostico: estado.diagnostico }
    : { bloqueia: false };
}

/**
 * Esquece o que foi medido — só os testes chamam.
 *
 * Existe porque a memória de `convergiu` é do processo, e uma suíte que
 * exercita "banco atrasado → banco em dia" no mesmo processo precisa poder
 * voltar ao começo. Em produção nada a chama: a prontidão já é medida a cada
 * pergunta, e o portão só guarda o que não se desfaz.
 */
export function esquecerProntidao(): void {
  convergiu = false;
  emVoo = null;
}
