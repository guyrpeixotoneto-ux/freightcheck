import {
  COBERTURAS,
  ROTULO_DA_COBERTURA,
  type CartaoDeModulo,
  type CoberturaDoCatalogo,
} from "@workspace/comparison/alteracoes-por-modulo";
import { escreverModulo } from "@/lib/monitor-equipe";

/**
 * A metade de tela do catálogo de Alterações por Módulo — apresentação, e só.
 *
 * A conta inteira mora em `@workspace/comparison/alteracoes-por-modulo` e na
 * rota que a costura. O que este arquivo faz é o que o navegador precisa: ler e
 * escrever os quatro pares no endereço, e resolver o nome dos módulos cujo
 * rótulo o domínio **de propósito** não publica.
 */

/*
  As quatro coberturas, na ordem em que a tela as oferece — do domínio.

  A lista morava aqui, e desceu para `@workspace/comparison` quando a rota de
  candidatas do catálogo passou a percorrer as mesmas quatro do lado de lá. A
  reexportação é o que evita a segunda lista: uma quinta cobertura entra num
  arquivo só, e não numa tela que a oferece e num servidor que a ignora.
*/
export { COBERTURAS };

/**
 * O sufixo de cada cobertura no endereço — e é o mesmo que a rota lê.
 *
 * Escrito uma vez porque as duas pontas têm de concordar letra a letra: um
 * `baseTrecho` de um lado e um `baseDeTrecho` do outro não quebrariam nada,
 * apenas fariam a tela abrir sempre sem par de trecho.
 */
export const SUFIXO_DA_COBERTURA: Record<CoberturaDoCatalogo, string> = {
  EQUIPAMENTO: "Equipamento",
  TRECHO: "Trecho",
  QLP_OPERACIONAL: "Operacional",
  QLP_ADMINISTRATIVO: "Administrativo",
};

export type ParEscolhido = { base: string; comparada: string };

export type ParesDoCatalogo = Record<CoberturaDoCatalogo, ParEscolhido>;

export const PARES_VAZIOS: ParesDoCatalogo = {
  EQUIPAMENTO: { base: "", comparada: "" },
  TRECHO: { base: "", comparada: "" },
  QLP_OPERACIONAL: { base: "", comparada: "" },
  QLP_ADMINISTRATIVO: { base: "", comparada: "" },
};

/** Os pares que o endereço nomeia. O que ele não nomeia fica vazio. */
export function lerPares(search: string): ParesDoCatalogo {
  const q = new URLSearchParams(search);
  const pares = { ...PARES_VAZIOS };
  for (const cobertura of COBERTURAS) {
    const sufixo = SUFIXO_DA_COBERTURA[cobertura];
    pares[cobertura] = {
      base: q.get(`base${sufixo}`) ?? "",
      comparada: q.get(`comparada${sufixo}`) ?? "",
    };
  }
  return pares;
}

/**
 * Os pares de volta para o endereço — e o par pela metade não vai.
 *
 * Uma ponta sozinha não é comparação nenhuma, e escrevê-la faria o servidor
 * receber um `baseTrecho` sem `comparadaTrecho` e responder "nenhum par
 * escolhido" — correto, e com um parâmetro na barra sugerindo o contrário.
 */
export function escreverPares(pares: ParesDoCatalogo): string {
  const q = new URLSearchParams();
  for (const cobertura of COBERTURAS) {
    const par = pares[cobertura];
    if (!par.base || !par.comparada) continue;
    const sufixo = SUFIXO_DA_COBERTURA[cobertura];
    q.set(`base${sufixo}`, par.base);
    q.set(`comparada${sufixo}`, par.comparada);
  }
  return q.toString();
}

/**
 * O nome de um cartão.
 *
 * O domínio publica o rótulo das rubricas que ele nomeia e deixa `null` nas do
 * QLP, onde o nome é apresentação e mora aqui (`ROTULO_DA_RUBRICA`, por decisão
 * de `qlp-comparacao.ts`). Resolver o nulo é, portanto, trabalho da tela — e
 * `escreverModulo` é a mesma função que o Monitor Equipe usa, para que o mesmo
 * assunto não tenha dois nomes em duas telas.
 */
export function nomeDoCartao(cartao: CartaoDeModulo): string {
  return cartao.rotulo ?? escreverModulo(cartao.modulo);
}

/**
 * O endereço da auditoria de um cartão — com o par dele junto.
 *
 * Sem o par, o clique abriria a auditoria no par de partida dela, que pode não
 * ser o que a pessoa estava lendo aqui: o número visto no cartão e o número da
 * tela aberta seriam outros, sem nada explicando por quê. É a mesma regra de
 * `enderecoDaAuditoria` do Monitor.
 */
export function enderecoDoCartao(
  cartao: CartaoDeModulo,
  contexto: { scopeHash: string | null; canal: string | null },
): string {
  const q = new URLSearchParams();
  if (cartao.par) {
    q.set("base", cartao.par.baseId);
    q.set("comparada", cartao.par.comparadaId);
  }
  if (contexto.scopeHash) q.set("scopeHash", contexto.scopeHash);
  if (contexto.canal) q.set("canal", contexto.canal);
  const query = q.toString();
  return query === "" ? cartao.rota : `${cartao.rota}?${query}`;
}

/** O nome da cobertura, como a tela o escreve ao pé do cartão. */
export function nomeDaCobertura(cobertura: CoberturaDoCatalogo): string {
  return ROTULO_DA_COBERTURA[cobertura];
}
