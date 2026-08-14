import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Onde os arquivos recebidos pela interface ficam.
 *
 * `receiveFile` grava o caminho no banco e a captura RAW o relê, então o
 * arquivo precisa sobreviver entre os dois — mas só entre os dois: depois da
 * captura, a evidência está em `raw_cell`, célula por célula. O diretório é
 * configurável para quem quiser retê-los por mais tempo.
 *
 * Isto mora aqui, e não na rota que grava, porque quem apaga uma importação
 * precisa da mesma resposta: o arquivo em disco só é nosso para apagar se foi
 * este diretório que o recebeu. Um `.xlsx` importado de outro lugar — a
 * planilha de origem de um teste, um caminho passado à mão — continua onde
 * está, e o banco esquecendo dele não é motivo para sumir com o arquivo de
 * alguém.
 */
export function importStorageDir(): string {
  return (
    process.env.IMPORT_STORAGE_DIR ??
    path.join(os.tmpdir(), "freightcheck-imports")
  );
}

/** O mesmo diretório, criado se ainda não existir. */
export function ensureImportStorageDir(): string {
  const dir = importStorageDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** O arquivo está dentro do diretório que recebemos — e não em outro lugar? */
export function isInsideImportStorage(filePath: string): boolean {
  const raiz = path.resolve(importStorageDir());
  const alvo = path.resolve(filePath);
  return alvo === raiz || alvo.startsWith(raiz + path.sep);
}
