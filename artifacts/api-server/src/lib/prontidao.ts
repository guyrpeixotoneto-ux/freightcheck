import {
  diagnosticar,
  type Diagnostico,
  type EstadoDoBanco,
} from "@workspace/db/diagnostico";
import { observarBanco } from "./migrations";

/**
 * Este processo pode receber tráfego de produto?
 *
 * ---------------------------------------------------------------------------
 * A janela que isto fecha
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
 * Por que a garantia é do processo, e não da plataforma
 * ---------------------------------------------------------------------------
 * O `artifact.toml` deste serviço declara **um** probe, o de startup, e ele
 * aponta para `/api/healthz` — que responde 200 mesmo com o banco fora, de
 * propósito: uma rota de saúde que falha junto com o banco faz o deployment
 * nunca subir, e o roteador volta a devolver 502 sem corpo. Não há readiness
 * probe para o roteador consultar, e portanto **não há como pedir à plataforma
 * que segure o tráfego**. Quem tem de recusar é o processo, e é isto aqui.
 *
 * ---------------------------------------------------------------------------
 * Uma autoridade só
 * ---------------------------------------------------------------------------
 * A prontidão não é declarada pela partida — ela é **medida**, pelo mesmo
 * `diagnosticar(observarBanco())` que responde ao `/healthz`. A partida que
 * declarasse "convergi" seria uma segunda versão da verdade, e as duas
 * discordariam no dia em que outra instância, ou uma pessoa, aplicasse a fila.
 * Medindo, o portão abre sozinho assim que o banco converge — não importa quem
 * o converteu, nem se este processo reiniciou.
 */
export type Prontidao =
  | { pronto: true }
  | { pronto: false; diagnostico: Diagnostico };

/**
 * Os estados em que o código e o banco falam versões diferentes do contrato.
 *
 * Os três têm a mesma forma: **a fila deste build não está aplicada aqui**, e
 * por isso não há como saber que versão de contrato o banco aplica. Gravar
 * dentro disso é o que produz metade de uma competência, ou um 500 sobre um
 * arquivo perfeito.
 *
 * **O que deliberadamente não fecha o portão**, e a razão de cada um:
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
 * - `SAUDAVEL`, evidentemente.
 */
const CONTRATO_DIVERGENTE: ReadonlySet<EstadoDoBanco> = new Set<EstadoDoBanco>([
  "MIGRATIONS_PENDENTES",
  "MIGRATION_FALHOU",
  "REGISTRO_PERDIDO",
]);

/**
 * Convergiu uma vez, e não se pergunta mais.
 *
 * O caminho quente não paga nada depois da partida: uma vez que o banco
 * respondeu "a fila deste build está aplicada", nenhuma requisição de produto
 * volta a consultá-lo por causa do portão. O que acontecer com o schema
 * **depois** disso — o Provision que remove uma coluna, o banco trocado por
 * fora — é drift, e para drift a resposta certa é a da rota que esbarra nele,
 * não um portão que reabre e fecha a cada leitura.
 */
let convergiu = false;

/** A observação em curso, compartilhada — ver `estadoDaProntidao`. */
let emVoo: Promise<Prontidao> | null = null;

/**
 * O estado agora, medido no banco enquanto ainda não convergiu.
 *
 * **As leituras concorrentes dividem uma observação só.** Na partida chegam
 * várias requisições no mesmo instante, e num processo travado por migration
 * que falhou elas chegariam para sempre: sem isto, cada uma abriria a sua
 * rodada de consultas ao banco e o portão fechado viraria um amplificador de
 * carga em cima de um banco que já está em incidente.
 */
export async function estadoDaProntidao(): Promise<Prontidao> {
  if (convergiu) return { pronto: true };
  if (emVoo) return emVoo;

  const medindo = (async (): Promise<Prontidao> => {
    const diagnostico = diagnosticar(await observarBanco());
    if (CONTRATO_DIVERGENTE.has(diagnostico.estado)) {
      return { pronto: false, diagnostico };
    }
    convergiu = true;
    return { pronto: true };
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
 * Esquece o que foi medido — só os testes chamam.
 *
 * Existe porque a memória de `convergiu` é do processo, e uma suíte que
 * exercita "banco atrasado → banco em dia" no mesmo processo precisa poder
 * voltar ao começo. Em produção nada a chama: reiniciar é o que a zera.
 */
export function esquecerProntidao(): void {
  convergiu = false;
  emVoo = null;
}
