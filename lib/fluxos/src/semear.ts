import type { Database } from "@workspace/db";
import { MODELOS, type ModeloDeFluxo } from "./exemplos";
import { importarFluxo, type Autor } from "./repositorio";
import type { Fluxo } from "./modelo";

/**
 * A semeadura — os fluxos que a empresa já tem antes de alguém digitar algo.
 *
 * Roda em dois momentos, e nunca na partida do servidor. O primeiro é o botão
 * "usar modelo" da tela, com um modelo escolhido por gente. O segundo é a
 * lista vazia de uma empresa que **já tem processo mapeado** aqui dentro: os
 * `jaMapeado` de `exemplos/index.ts` são o levantamento da própria empresa,
 * cadastrado como dado, e obrigar alguém a "usar um modelo" para ter de volta o
 * mapa que ele mesmo levantou é oferecer como sugestão o que já é fato.
 *
 * O que continua valendo é o limite: modelo de exemplo nenhum entra sozinho. Um
 * seed automático de exemplos encheria o cadastro de toda instalação com
 * processo que não é dela, e a pessoa passaria o primeiro contato com o módulo
 * apagando coisa.
 *
 * É idempotente pelo slug — `importarFluxo` devolve o fluxo que já existe em vez
 * de criar um segundo —, então clicar duas vezes não duplica e não desfaz
 * edição nenhuma que alguém já tenha feito no fluxo semeado.
 *
 * E o caminho é o mesmo do cadastro à mão: `importarFluxo` → as mesmas
 * validações do `POST /fluxos`. Não existe atalho de semeadura, porque um
 * atalho seria o único caminho testado.
 */
export async function semearModelos(
  db: Database,
  empresaId: string,
  autor: Autor,
  modelos: readonly ModeloDeFluxo[] = MODELOS.filter((m) => m.jaMapeado),
): Promise<Fluxo[]> {
  const criados: Fluxo[] = [];
  for (const modelo of modelos) {
    criados.push(await importarFluxo(db, empresaId, modelo.declarado, autor));
  }
  return criados;
}

/** Os processos já mapeados da empresa — o que a lista vazia semeia sozinha. */
export function modelosJaMapeados(): readonly ModeloDeFluxo[] {
  return MODELOS.filter((m) => m.jaMapeado);
}

/** Um modelo pelo slug — o que a tela pede ao escolher "começar deste". */
export function modeloPorSlug(slug: string): ModeloDeFluxo | undefined {
  return MODELOS.find((m) => m.declarado.slug === slug);
}
