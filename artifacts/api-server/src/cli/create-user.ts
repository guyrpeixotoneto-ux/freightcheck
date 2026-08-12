import { createInterface } from "node:readline/promises";
import { db } from "@workspace/db";
import {
  describeEmailProblem,
  describeNameProblem,
  describePasswordProblem,
} from "../lib/auth";
import { EmailAlreadyUsedError, countUsers, createUser } from "../lib/session";

/**
 * A segunda conta em diante.
 *
 * A primeira nasce na própria tela — `POST /auth/setup`, enquanto não existe
 * nenhuma. Depois disso o produto não tem auto-cadastro, e não ter *nada* seria
 * deixar quem administra sem saída: a única forma de dar acesso a mais alguém
 * seria escrever um hash de scrypt à mão dentro do banco.
 *
 * Uso:
 *
 *   pnpm --filter @workspace/api-server run create-user "Nome" email@empresa.com
 *
 * A senha é lida do stdin, e não da linha de comando de propósito: argumento
 * fica no histórico do shell e na lista de processos da máquina inteira.
 * Para automatizar: `echo "$SENHA" | pnpm … run create-user "Nome" email@…`.
 */

const [, , name, email] = process.argv;

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

const argProblem = describeNameProblem(name) ?? describeEmailProblem(email);
if (argProblem) {
  die(
    `${argProblem}\n\nUso: pnpm --filter @workspace/api-server run create-user "Nome" email@empresa.com`,
  );
}

async function readPassword(): Promise<string> {
  // Sem TTY (pipe, CI) a senha vem pronta na entrada; com TTY, pergunta-se.
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question("Senha (mínimo 10 caracteres): ");
  } finally {
    rl.close();
  }
}

const password = await readPassword();
const passwordProblem = describePasswordProblem(password);
if (passwordProblem) die(passwordProblem);

try {
  const user = await createUser(db, {
    name: name!,
    email: email!,
    password,
  });
  const total = await countUsers(db);
  console.log(`Conta criada: ${user.name} <${user.email}>.`);
  console.log(`Este ambiente agora tem ${total} conta(s).`);
  process.exit(0);
} catch (err) {
  if (err instanceof EmailAlreadyUsedError) die(err.message);
  die(`Não foi possível criar a conta: ${String(err)}`);
}
