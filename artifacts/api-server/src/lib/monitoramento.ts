import { db } from "@workspace/db";
import { coletorDeAutorizacaoSefaz } from "@workspace/coletores";
import {
  registroDeColetores,
  type RegistroDeColetores,
} from "@workspace/fluxos";

/**
 * O ARRANQUE DO MONITORAMENTO — quem está ligado, dito num lugar só.
 *
 * `registroDeColetores` recusa dois coletores no mesmo prefixo **na hora de
 * registrar** (ver `lib/fluxos/src/monitoramento/registro.ts`), e essa recusa só
 * vale alguma coisa se a montagem acontecer uma vez, cedo, e em um lugar que se
 * possa ler de cima a baixo. Esta função é esse lugar: a lista de coletores
 * ligados nesta instalação é o corpo dela, e nada mais.
 *
 * ---------------------------------------------------------------------------
 * Memoizado, e não global mutável
 * ---------------------------------------------------------------------------
 *
 * O que existe aqui é uma função que devolve sempre o mesmo registro, montado na
 * primeira chamada. O que **não** existe, de propósito:
 *
 * - **nenhum `registrar()` exportado.** Ninguém acrescenta coletor em tempo de
 *   execução. Um registro que aceita inscrição depois do arranque é um registro
 *   cujo conteúdo depende da ordem em que os módulos foram importados — e o
 *   sintoma disso é um farol que muda de cor entre a máquina de quem
 *   desenvolveu e a de produção, sem nada na tela dizendo por quê;
 * - **nenhuma montagem no topo do módulo.** O registro nasce na primeira
 *   requisição que o pede, e não no `import`. Importar `app.ts` num teste que
 *   não fala de monitoramento não deve montar coletor nenhum;
 * - **nenhum estado além do próprio registro.** Sem medição guardada, sem cache
 *   de leitura, sem farol persistido. A colheita é feita na leitura da tela, e
 *   `Monitoramento.apuradoEm` diz de quando ela é.
 *
 * `db` entra aqui e não no motor: o coletor é quem tem fonte. `monitorarFluxo`
 * continua recebendo o fluxo que a rota já leu pelo repositório.
 *
 * ---------------------------------------------------------------------------
 * Um coletor, e a conta honesta
 * ---------------------------------------------------------------------------
 *
 * Hoje a lista tem **um** coletor real, e os fluxos do catálogo declaram 33
 * chaves distintas. Ligar a rota não muda esse número: 32 chaves continuam sem
 * dono e as etapas delas continuam `SEM_DADO`, com o motivo `sem_coletor` dito
 * por extenso em cada uma. É o retrato correto, e é o que `GET /fluxos/:id/cobertura`
 * existe para mostrar de frente em vez de deixar como cinza mudo no meio da
 * resposta.
 */
let registro: RegistroDeColetores | null = null;

export function registroDeMonitoramento(): RegistroDeColetores {
  registro ??= registroDeColetores(coletorDeAutorizacaoSefaz(db));
  return registro;
}
