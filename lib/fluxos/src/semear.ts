import type { Database } from "@workspace/db";
import { MODELOS, type ModeloDeFluxo } from "./exemplos";
import { importarFluxo, type Autor } from "./repositorio";
import type { Fluxo } from "./modelo";

/**
 * A semeadura — o primeiro fluxo de uma empresa, e nada mais que isso.
 *
 * Roda **sob demanda**, a partir do botão "Começar de um modelo" da tela, e não
 * na partida do servidor. A diferença é a mesma que a `0049` escreveu sobre a
 * unidade canônica: um cadastro é ato de gente. Um seed automático encheria o
 * cadastro de toda instalação com um processo que talvez não seja o dela, e a
 * pessoa passaria o primeiro contato com o módulo apagando coisa.
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
  modelos: readonly ModeloDeFluxo[] = MODELOS.filter((m) => m.semeado),
): Promise<Fluxo[]> {
  const criados: Fluxo[] = [];
  for (const modelo of modelos) {
    criados.push(await importarFluxo(db, empresaId, modelo.declarado, autor));
  }
  return criados;
}

/** Um modelo pelo slug — o que a tela pede ao escolher "começar deste". */
export function modeloPorSlug(slug: string): ModeloDeFluxo | undefined {
  return MODELOS.find((m) => m.declarado.slug === slug);
}
