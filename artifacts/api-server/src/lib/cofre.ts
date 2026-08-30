import {
  CofreIndisponivel,
  chaveMestraDe,
  cifrar,
  decifrar,
} from "@workspace/integrations";

/**
 * O cofre deste processo — a única linha do produto que lê a chave mestra.
 *
 * `@workspace/integrations` sabe cifrar e não sabe de onde vem a chave; este
 * arquivo sabe de onde vem e não sabe cifrar. A divisão é o que permite testar
 * a cifra inteira sem variável de ambiente, e é o que impede um segundo lugar
 * do código de descobrir sozinho como derivar a chave — que é como se acaba com
 * dois cofres que não se abrem.
 *
 * **`INTEGRACOES_CHAVE_MESTRA`**, 32 bytes em hex (`openssl rand -hex 32`) ou
 * em base64. Sem ela o cofre não existe, e o que **não** acontece é o produto
 * inventar um padrão: uma credencial de terceiro cifrada com uma chave escrita
 * no repositório é pior do que uma credencial não guardada, porque parece
 * protegida.
 *
 * A leitura é a cada chamada, e não uma constante de módulo. É de propósito: a
 * variável pode aparecer num redeploy sem que este processo tenha nascido com
 * ela, e uma constante lida na importação deixaria o cofre morto até o próximo
 * reinício.
 */

/** O cofre está disponível neste ambiente? Nunca lança — é para a tela. */
export function cofreDisponivel(): boolean {
  try {
    chaveMestraDe(process.env["INTEGRACOES_CHAVE_MESTRA"]);
    return true;
  } catch {
    return false;
  }
}

/** Guarda um segredo do outro lado. Lança `CofreIndisponivel` sem chave mestra. */
export function guardarSegredo(segredo: string): string {
  return cifrar(segredo, chaveMestraDe(process.env["INTEGRACOES_CHAVE_MESTRA"]));
}

/** Abre um segredo guardado. Lança quando a chave é outra ou o conteúdo mudou. */
export function abrirSegredo(guardado: string): string {
  return decifrar(guardado, chaveMestraDe(process.env["INTEGRACOES_CHAVE_MESTRA"]));
}

export { CofreIndisponivel };
