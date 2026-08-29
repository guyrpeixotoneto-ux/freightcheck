import { db } from "@workspace/db";
import {
  coletorDeAutorizacaoSefaz,
  coletorDeEmissaoDeCte,
  coletorDeTransporte,
} from "@workspace/coletores";
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
 * Três coletores, e a conta honesta
 * ---------------------------------------------------------------------------
 *
 * A lista tem **três** coletores reais, e os fluxos do catálogo declaram 33
 * chaves distintas. As outras 30 continuam sem dono, e as etapas delas continuam
 * `SEM_DADO` com o motivo `sem_coletor` dito por extenso — é o retrato correto, e
 * é o que `GET /fluxos/:id/cobertura` existe para mostrar de frente em vez de
 * deixar como cinza mudo no meio da resposta.
 *
 * Os três leem o mesmo acervo de fechamento e são **três objetos, e não um**, de
 * propósito: cada um faz uma afirmação diferente, com o nome dela, e a colheita
 * isola falha por coletor (`colheita.ts`). Um coletor único respondendo pelas
 * três chaves apagaria as três quando qualquer uma das consultas quebrasse, e a
 * falha na tela sairia sem dizer qual medição se perdeu.
 *
 * A ordem aqui não decide nada: `registroDeColetores` resolve por prefixo, e
 * dois coletores no mesmo prefixo são recusados no arranque em vez de escolhidos
 * em silêncio. `cte.autorizacao_sefaz` e `cte.emissao` são prefixos distintos —
 * chaves exatas, não espaços —, e por isso convivem sobre o mesmo 03.08.15.
 */
let registro: RegistroDeColetores | null = null;

export function registroDeMonitoramento(): RegistroDeColetores {
  registro ??= registroDeColetores(
    coletorDeAutorizacaoSefaz(db),
    coletorDeEmissaoDeCte(db),
    coletorDeTransporte(db),
  );
  return registro;
}
