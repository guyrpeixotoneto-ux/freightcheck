import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Backup lógico do banco — a cópia que transforma um incidente em restauração.
 *
 * Este produto guarda decisão humana em registro append-only e promete que
 * nenhum número foi reescrito. Até aqui essa promessa tinha uma única cópia: o
 * Postgres da plataforma. O Provision de 17/08/2026 derrubou tabelas de
 * produção e não havia de onde trazê-las de volta — a reconvergência repõe
 * estrutura, nunca conteúdo. Este módulo é o conteúdo.
 *
 * **`pg_dump -Fc`, e não SQL caseiro.** O formato custom carrega schema,
 * dados, funções, triggers e views — inclusive o que o drizzle não modela — e
 * `pg_restore` o devolve inteiro num banco vazio. Uma segunda implementação de
 * "copiar tudo" divergiria da primeira exatamente nos objetos que já foram
 * esquecidos uma vez.
 *
 * **O destino é decisão de quem opera** (`BACKUP_DIR`): num deployment
 * autoscale o disco local é efêmero, e um backup efêmero é um enfeite. O
 * diretório precisa apontar para armazenamento durável (volume montado,
 * bucket, disco de VM reservada). O agendador avisa quando não há destino —
 * alto, na partida — em vez de fingir que a cópia existe.
 *
 * **Escrita em duas etapas.** O dump nasce com sufixo `.parcial` e só ganha o
 * nome final depois de pronto: um processo morto no meio deixa um arquivo que
 * a listagem ignora e a poda remove, nunca um backup truncado com cara de
 * inteiro — que é o falso verde clássico deste gênero.
 */

export interface ResultadoDeBackup {
  arquivo: string;
  bytes: number;
  duracaoMs: number;
  /** Quantos backups antigos a poda removeu nesta passada. */
  podados: number;
}

const PREFIXO = "freightcheck-";
const SUFIXO = ".dump";
const PARCIAL = ".parcial";

/** Quantos backups ficam no diretório depois da poda. */
export const RETENCAO_PADRAO = 14;

function nomeDoArquivo(agora: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${PREFIXO}${agora.getUTCFullYear()}${p(agora.getUTCMonth() + 1)}` +
    `${p(agora.getUTCDate())}-${p(agora.getUTCHours())}${p(agora.getUTCMinutes())}` +
    `${p(agora.getUTCSeconds())}${SUFIXO}`
  );
}

/** Os backups completos do diretório, do mais novo para o mais velho. */
export function listarBackups(dir: string): { arquivo: string; bytes: number; mtime: Date }[] {
  let nomes: string[];
  try {
    nomes = readdirSync(dir);
  } catch {
    return [];
  }
  return nomes
    .filter((n) => n.startsWith(PREFIXO) && n.endsWith(SUFIXO))
    .map((n) => {
      const caminho = path.join(dir, n);
      const st = statSync(caminho);
      return { arquivo: caminho, bytes: st.size, mtime: st.mtime };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

/** O backup mais recente, ou `null` — a pergunta do agendador e do healthz. */
export function ultimoBackup(dir: string): { arquivo: string; bytes: number; mtime: Date } | null {
  return listarBackups(dir)[0] ?? null;
}

function podar(dir: string, retencao: number): number {
  const completos = listarBackups(dir);
  const excedentes = completos.slice(retencao);
  let removidos = 0;
  for (const backup of excedentes) {
    try {
      unlinkSync(backup.arquivo);
      removidos++;
    } catch {
      /* um arquivo que não sai continua contando como backup — melhor sobrar */
    }
  }
  // Parciais são sempre lixo: ou o dump em andamento (recriado com outro nome
  // se preciso) ou o rastro de um processo morto no meio.
  try {
    for (const nome of readdirSync(dir)) {
      if (nome.endsWith(PARCIAL)) {
        const caminho = path.join(dir, nome);
        // Um parcial recente pode ser um dump em andamento de outra instância.
        const idadeMs = Date.now() - statSync(caminho).mtime.getTime();
        if (idadeMs > 60 * 60 * 1000) {
          unlinkSync(caminho);
        }
      }
    }
  } catch {
    /* poda de parciais é cortesia, nunca o motivo de falhar um backup */
  }
  return removidos;
}

/**
 * Faz um backup completo e poda os antigos.
 *
 * Lança quando o `pg_dump` falha ou não existe — quem chama decide o que fazer
 * com a falha (o agendador loga e alerta; a CLI sai com código de erro). Um
 * backup que falha em silêncio é pior que nenhum, porque desliga a procura por
 * alternativa.
 */
export async function fazerBackup(opcoes: {
  databaseUrl: string;
  dir: string;
  retencao?: number;
}): Promise<ResultadoDeBackup> {
  const inicio = Date.now();
  mkdirSync(opcoes.dir, { recursive: true });

  const destino = path.join(opcoes.dir, nomeDoArquivo(new Date()));
  const parcial = destino + PARCIAL;

  await execFileAsync(
    "pg_dump",
    ["--format=custom", "--no-owner", "--file", parcial, "--dbname", opcoes.databaseUrl],
    { maxBuffer: 16 * 1024 * 1024 },
  );

  renameSync(parcial, destino);
  const bytes = statSync(destino).size;
  const podados = podar(opcoes.dir, opcoes.retencao ?? RETENCAO_PADRAO);

  return { arquivo: destino, bytes, duracaoMs: Date.now() - inicio, podados };
}

/**
 * Restaura um backup num banco **vazio**.
 *
 * Vazio de propósito: `--clean` sobre um banco vivo é exatamente a classe de
 * operação destrutiva que este repositório não executa em silêncio. O caminho
 * de restauração é criar um banco novo, restaurar nele, conferir, e só então
 * decidir o que fazer com o antigo — decisão de gente, com o dado à vista.
 */
export async function restaurarBackup(opcoes: {
  databaseUrl: string;
  arquivo: string;
}): Promise<void> {
  await execFileAsync(
    "pg_restore",
    ["--no-owner", "--exit-on-error", "--dbname", opcoes.databaseUrl, opcoes.arquivo],
    { maxBuffer: 16 * 1024 * 1024 },
  );
}
