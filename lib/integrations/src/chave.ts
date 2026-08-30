import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * A CHAVE DE API — o que se entrega a um sistema, e o que fica guardado aqui.
 *
 * Este arquivo é a autoridade única sobre o formato da credencial: quem a
 * gera, como ela se parece, o que o banco guarda dela e como uma chave
 * apresentada por quem chama é reconhecida. Nada disso mora numa rota, e a
 * razão é a de sempre neste produto — regra copiada é regra que diverge, e uma
 * regra de credencial que diverge não aparece na tela: aparece no dia em que
 * uma chave revogada continua entrando por um caminho que ninguém releu.
 *
 * Três decisões, e nenhuma é de estilo.
 *
 * 1. **A chave é mostrada uma vez e nunca mais.** O banco guarda o SHA-256
 *    dela, e não ela. É o mesmo desenho de senha de conta, pela mesma razão:
 *    um dump do banco não pode virar acesso à API. O custo é conhecido e é
 *    aceito — quem perdeu a chave não a recupera, emite outra e revoga a
 *    anterior, que é o gesto que se quer que seja fácil.
 *
 * 2. **O prefixo fica em claro, e é ele que localiza a linha.** Sem prefixo, a
 *    conferência seria "leia todas as chaves do banco e compare uma a uma" —
 *    que funciona com dez chaves e para de funcionar bem antes de doer. Com
 *    ele, a busca é por índice, e a comparação do segredo acontece uma vez só.
 *    O prefixo também é o que a tela mostra e o que o log registra: é possível
 *    dizer *qual* chave chamou sem que nenhum lugar guarde a chave inteira.
 *
 * 3. **A comparação é em tempo constante.** `timingSafeEqual` sobre os dois
 *    hashes. É a defesa contra o ataque que mede o tempo da resposta para
 *    descobrir o segredo byte a byte — barata de fazer aqui, impossível de
 *    acrescentar depois que a comparação com `===` já se espalhou.
 */

/**
 * O carimbo que abre toda chave deste produto.
 *
 * Existe para ser reconhecível **fora** daqui: uma chave que vaza num
 * repositório, num log de terceiro ou num print de tela é identificável como
 * credencial do FreightCheck por quem a encontrar — que é a diferença entre
 * alguém avisar e ninguém perceber. É a mesma razão pela qual GitHub e Stripe
 * carimbam as deles.
 */
export const PREFIXO_DA_CHAVE = "fck";

/** Quantos hex o identificador público tem. */
const DIGITOS_DO_PUBLICO = 12;
/** Quantos bytes de aleatoriedade o segredo tem — 32 bytes, 64 hex. */
const BYTES_DO_SEGREDO = 32;

/**
 * O formato completo: `fck_<12 hex>_<64 hex>`.
 *
 * O identificador público e o segredo são gerados na mesma chamada e viajam
 * juntos porque quem chama manda uma coisa só. Separá-los em dois campos —
 * "id" e "senha" — dobraria a chance de alguém configurar um e esquecer o
 * outro, e não protegeria nada a mais.
 */
export const FORMATO_DA_CHAVE = new RegExp(
  `^${PREFIXO_DA_CHAVE}_[0-9a-f]{${DIGITOS_DO_PUBLICO}}_[0-9a-f]{${BYTES_DO_SEGREDO * 2}}$`,
);

/** Uma chave recém-emitida: o que se entrega, e o que se guarda. */
export interface ChaveEmitida {
  /**
   * A chave inteira, em claro. **Só existe neste retorno.** Quem a recebe tem
   * uma responsabilidade e uma só: entregá-la a quem pediu e não gravá-la.
   */
  segredo: string;
  /** `fck_a1b2c3d4e5f6` — o que a tela mostra e o log registra. */
  prefixo: string;
  /** SHA-256 hex da chave inteira — o que o banco guarda. */
  hash: string;
}

/** Emite uma chave nova. O segredo sai daqui e não volta. */
export function emitirChave(): ChaveEmitida {
  const publico = randomBytes(DIGITOS_DO_PUBLICO / 2).toString("hex");
  const segredoBruto = randomBytes(BYTES_DO_SEGREDO).toString("hex");
  const segredo = `${PREFIXO_DA_CHAVE}_${publico}_${segredoBruto}`;
  return { segredo, prefixo: prefixoDe(segredo) ?? "", hash: hashDaChave(segredo) };
}

/** O SHA-256 hex de uma chave — a mesma conta na emissão e na conferência. */
export function hashDaChave(segredo: string): string {
  return createHash("sha256").update(segredo, "utf8").digest("hex");
}

/**
 * O prefixo público de uma chave apresentada, ou `null` se ela não tem o
 * formato deste produto.
 *
 * Recusar pelo formato **antes** de tocar o banco não é otimização: é o que
 * impede que um cabeçalho `Authorization` com um JWT de outro sistema, ou com
 * a senha de alguém colada por engano, vire uma consulta — e uma linha de log
 * com aquele conteúdo dentro.
 */
export function prefixoDe(segredo: string): string | null {
  if (!FORMATO_DA_CHAVE.test(segredo)) return null;
  const [carimbo, publico] = segredo.split("_");
  return `${carimbo}_${publico}`;
}

/**
 * A chave apresentada é a chave guardada?
 *
 * Recebe os dois hashes — nunca o segredo do banco, que não existe. Hashes têm
 * sempre o mesmo tamanho, então a comparação em tempo constante é possível sem
 * o vazamento que `timingSafeEqual` provoca ao receber tamanhos diferentes.
 */
export function chaveConfere(hashApresentado: string, hashGuardado: string): boolean {
  const a = Buffer.from(hashApresentado, "hex");
  const b = Buffer.from(hashGuardado, "hex");
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * A chave que chega no cabeçalho, extraída sem adivinhação.
 *
 * Aceita `Authorization: Bearer <chave>` e o cabeçalho próprio
 * `X-FreightCheck-Key: <chave>`, nesta ordem. Dois formatos porque quem
 * integra nem sempre controla o cliente HTTP que usa — e um cliente que só
 * sabe mandar `Authorization` não pode ficar de fora por uma escolha nossa de
 * nome de cabeçalho.
 *
 * O que ela **não** aceita, e é decisão: chave em query string. Query string
 * entra no log de acesso de todo proxy do caminho, e uma credencial no log de
 * um terceiro é uma credencial vazada que ninguém sabe que vazou.
 */
export function chaveApresentada(cabecalhos: {
  authorization?: string | string[] | undefined;
  chavePropria?: string | string[] | undefined;
}): string | null {
  const primeiro = (v: string | string[] | undefined): string | null =>
    typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? null) : null;

  const auth = primeiro(cabecalhos.authorization);
  if (auth) {
    const casou = /^Bearer\s+(\S+)$/i.exec(auth.trim());
    if (casou) return casou[1];
  }
  const propria = primeiro(cabecalhos.chavePropria);
  if (propria && propria.trim() !== "") return propria.trim();
  return null;
}

/** O nome do cabeçalho próprio, escrito uma vez e usado nos dois lados. */
export const CABECALHO_DA_CHAVE = "x-freightcheck-key";
