import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * O COFRE — a credencial **do outro lado**, guardada porque precisamos usá-la.
 *
 * Aqui a assimetria com `chave.ts` é o assunto inteiro, e vale entendê-la antes
 * de mexer em qualquer linha:
 *
 * · A **nossa** chave (a que damos a um sistema) é guardada como hash. Nunca
 *   precisamos dela de volta — só conferir se a que chegou bate. Um hash
 *   resolve, e é irreversível de propósito.
 * · A credencial **deles** (a que usamos para buscar o arquivo na API do
 *   fornecedor) precisa ser apresentada a cada busca. Hash não serve: o que se
 *   apresenta tem de ser o valor original. Então ela é **cifrada**, e a
 *   diferença entre cifrar e "guardar em texto com um nome bonito" é a chave
 *   mestra viver fora do banco.
 *
 * **AES-256-GCM**, e não AES-CBC nem "XOR com um segredo": GCM autentica o que
 * decifra. Um byte alterado no banco — por corrupção ou por alguém com acesso a
 * ele — faz a decifragem **falhar**, em vez de devolver lixo que seria enviado
 * como credencial para um servidor de fora.
 *
 * **A chave mestra não mora aqui.** Este arquivo recebe a chave e não sabe de
 * onde ela veio; quem a lê do ambiente é `artifacts/api-server/src/lib/cofre.ts`.
 * É o que permite testar a cifra inteira sem variável de ambiente nenhuma, e o
 * que impede que um segundo lugar do código descubra sozinho como derivar a
 * chave — que é como se acaba com dois cofres que não se abrem.
 *
 * **Sem chave mestra não há cofre, e o produto diz isso em voz alta** em vez de
 * inventar um padrão. Guardar credencial de terceiro cifrada com uma chave fixa
 * escrita no repositório seria pior do que não guardar: daria a quem opera a
 * impressão de proteção que não existe.
 */

/** O algoritmo, escrito uma vez. */
const ALGORITMO = "aes-256-gcm";
/** 12 bytes é o nonce recomendado para GCM — e é o que o formato reserva. */
const BYTES_DO_NONCE = 12;
/** A chave tem 32 bytes: é o "256" do nome do algoritmo. */
export const BYTES_DA_CHAVE_MESTRA = 32;

/**
 * O formato do que vai para o banco: `v1.<nonce>.<tag>.<cifrado>`, tudo em
 * base64url.
 *
 * O `v1` na frente não é enfeite: é o que permite trocar de algoritmo um dia
 * sem precisar adivinhar, na leitura, como cada linha foi escrita. O dia em que
 * existir `v2`, as duas convivem, e a rotação é uma releitura, não uma migração
 * às cegas.
 */
const VERSAO = "v1";

export class CofreIndisponivel extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "CofreIndisponivel";
  }
}

/**
 * A chave mestra, conferida antes de virar cofre.
 *
 * Aceita 32 bytes em hex (64 caracteres) ou em base64. Recusa qualquer outra
 * coisa com uma frase que diz como gerar uma — porque a alternativa, na prática,
 * é alguém colar uma senha curta ali e o cofre virar teatro.
 */
export function chaveMestraDe(bruto: string | undefined): Buffer {
  const texto = (bruto ?? "").trim();
  if (texto === "") {
    throw new CofreIndisponivel(
      "Não há chave mestra configurada (INTEGRACOES_CHAVE_MESTRA), então não " +
        "há onde guardar com segurança a credencial do sistema de fora. Gere " +
        "uma com `openssl rand -hex 32` e defina a variável neste ambiente.",
    );
  }

  const daHex = /^[0-9a-f]{64}$/i.test(texto) ? Buffer.from(texto, "hex") : null;
  const daBase64 = daHex ?? Buffer.from(texto, "base64");
  if (daBase64.length !== BYTES_DA_CHAVE_MESTRA) {
    throw new CofreIndisponivel(
      `A chave mestra precisa ter ${BYTES_DA_CHAVE_MESTRA} bytes — 64 caracteres ` +
        "em hexadecimal, ou o equivalente em base64. Gere uma com " +
        "`openssl rand -hex 32`; uma senha digitada não serve, e é justamente " +
        "por isso que ela é recusada aqui.",
    );
  }
  return daBase64;
}

/** Cifra um segredo. O retorno é o que vai para a coluna, e nada mais. */
export function cifrar(segredo: string, chaveMestra: Buffer): string {
  const nonce = randomBytes(BYTES_DO_NONCE);
  const cifra = createCipheriv(ALGORITMO, chaveMestra, nonce);
  const cifrado = Buffer.concat([cifra.update(segredo, "utf8"), cifra.final()]);
  const tag = cifra.getAuthTag();
  return [
    VERSAO,
    nonce.toString("base64url"),
    tag.toString("base64url"),
    cifrado.toString("base64url"),
  ].join(".");
}

/**
 * Decifra o que está no banco.
 *
 * Lança quando o conteúdo foi alterado, quando a chave mestra é outra ou quando
 * o formato não é reconhecido — e as três lançam a **mesma** classe, de
 * propósito: para quem opera, as três dizem a mesma coisa ("esta credencial não
 * pode mais ser usada, cadastre-a de novo"), e distingui-las na tela só
 * ajudaria quem estivesse testando chaves.
 */
export function decifrar(guardado: string, chaveMestra: Buffer): string {
  const partes = guardado.split(".");
  if (partes.length !== 4 || partes[0] !== VERSAO) {
    throw new CofreIndisponivel(
      "A credencial guardada não está no formato do cofre. Cadastre-a de novo.",
    );
  }
  try {
    const [, nonce, tag, cifrado] = partes as [string, string, string, string];
    const decifra = createDecipheriv(
      ALGORITMO,
      chaveMestra,
      Buffer.from(nonce, "base64url"),
    );
    decifra.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decifra.update(Buffer.from(cifrado, "base64url")),
      decifra.final(),
    ]).toString("utf8");
  } catch {
    throw new CofreIndisponivel(
      "A credencial guardada não pôde ser aberta: ou a chave mestra deste " +
        "ambiente é outra, ou o conteúdo foi alterado. Cadastre-a de novo.",
    );
  }
}
