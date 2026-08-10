#!/usr/bin/env node
/**
 * Conferir o ambiente pelo caminho que o usuário usa.
 *
 * Este projeto já perdeu dias com um 502 que não era do código: o roteador do
 * Replit encaminha `/api` para a porta declarada no artifact, e não havia
 * ninguém lá. Da tela, isso é indistinguível de um defeito no upload; do
 * terminal, é uma linha. O que faltava era alguém perguntar as três coisas
 * certas — quem está em cada porta, se há mais de um processo disputando
 * alguma, e o que a URL do app devolve — sem abrir uma porta alternativa, que é
 * justamente como o defeito se escondeu.
 *
 *   node scripts/doctor.mjs                      # só o que dá para ver daqui
 *   node scripts/doctor.mjs https://…replit.dev  # inclui o caminho do roteador
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let problemas = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const erro = (m) => {
  problemas += 1;
  console.log(`  ERRO  ${m}`);
};
const nota = (m) => console.log(`        ${m}`);

/**
 * O `artifact.toml` é a fonte da verdade das portas: é dele que o roteador tira
 * o destino de cada caminho. Ler o arquivo em vez de repetir os números aqui
 * evita que este script passe a mentir junto quando alguém mudar uma porta.
 */
function lerArtifact(relativo) {
  const arquivo = path.join(root, relativo, ".replit-artifact/artifact.toml");
  const texto = readFileSync(arquivo, "utf8");
  let secao = "";
  let localPort = null;
  let envPort = null;
  let runDev = null;
  for (const linha of texto.split("\n")) {
    const limpa = linha.trim();
    if (limpa.startsWith("#") || limpa === "") continue;
    const cabecalho = limpa.match(/^\[+([^\]]+)\]+$/);
    if (cabecalho) {
      secao = cabecalho[1];
      continue;
    }
    const par = limpa.match(/^([A-Za-z_]+)\s*=\s*"?([^"#]+?)"?\s*(#.*)?$/);
    if (!par) continue;
    const [, chave, valor] = par;
    if (secao === "services" && chave === "localPort") localPort = valor;
    if (secao === "services.env" && chave === "PORT") envPort = valor;
    if (secao === "services.development" && chave === "run") runDev = valor;
  }
  return { relativo, localPort, envPort, runDev };
}

/** Quem está escutando em cada porta, pelo primeiro utilitário disponível. */
function ouvintes(porta) {
  for (const [cmd, args, parse] of [
    [
      "ss",
      ["-ltnp"],
      (saida) =>
        saida
          .split("\n")
          .filter((l) => new RegExp(`[:.]${porta}\\s`).test(l))
          .flatMap((l) => [...l.matchAll(/pid=(\d+)/g)].map((m) => m[1])),
    ],
    [
      "lsof",
      ["-iTCP", "-sTCP:LISTEN", "-P", "-n"],
      (saida) =>
        saida
          .split("\n")
          .filter((l) => l.includes(`:${porta} `) || l.endsWith(`:${porta}`))
          .map((l) => l.split(/\s+/)[1]),
    ],
  ]) {
    try {
      const saida = execFileSync(cmd, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return { pids: [...new Set(parse(saida))], ferramenta: cmd };
    } catch {
      // Ferramenta ausente ou sem permissão: tenta a próxima.
    }
  }
  return { pids: null, ferramenta: null };
}

function comando(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
  } catch {
    return `pid ${pid}`;
  }
}

async function status(url) {
  try {
    const resposta = await fetch(url, { redirect: "manual" });
    const corpo = await resposta.text();
    return { code: resposta.status, corpo };
  } catch (err) {
    return { code: null, corpo: err instanceof Error ? err.message : "" };
  }
}

// ---------------------------------------------------------------------------

const artifacts = [lerArtifact("artifacts/api-server"), lerArtifact("artifacts/freightaudit")];

console.log("\nPortas declaradas nos artifacts");
for (const a of artifacts) {
  if (a.localPort && a.localPort === a.envPort) {
    ok(`${a.relativo}: roteador manda para ${a.localPort}, service sobe em ${a.envPort}`);
  } else {
    erro(
      `${a.relativo}: localPort=${a.localPort ?? "ausente"} e ` +
        `[services.env] PORT=${a.envPort ?? "ausente"} não são o mesmo número.`,
    );
    nota("O service sobe numa porta e o roteador encaminha para outra: 502 em /api.");
  }
  if (!a.runDev?.includes("scripts/dev.mjs")) {
    erro(`${a.relativo}: o service de desenvolvimento não roda scripts/dev.mjs.`);
    nota(`É "${a.runDev}" — sem migrations nem rebuild, e diferente do que o terminal roda.`);
  }
}

console.log("\nQuem está em cada porta");
for (const a of artifacts) {
  const { pids, ferramenta } = ouvintes(a.localPort);
  if (pids === null) {
    nota(`${a.localPort}: sem ss nem lsof aqui; não dá para dizer.`);
    continue;
  }
  if (pids.length === 0) {
    erro(`${a.localPort} (${a.relativo}): ninguém escutando.`);
    nota("Toda chamada encaminhada para cá volta 502 sem corpo.");
  } else if (pids.length > 1) {
    erro(`${a.localPort}: ${pids.length} processos disputando a porta (${ferramenta}).`);
    for (const pid of pids) nota(comando(pid));
    nota("Suba o ambiente só pelo Run: os services dos artifacts são a única forma.");
  } else {
    ok(`${a.localPort}: um processo — ${comando(pids[0])}`);
  }
}

const url = process.argv[2]?.replace(/\/+$/, "");
if (!url) {
  console.log("\nCaminho do roteador");
  nota("Passe a URL do app para conferir o caminho que o usuário usa:");
  nota("node scripts/doctor.mjs https://<seu-app>.replit.dev");
} else {
  console.log(`\nCaminho do roteador — ${url}`);
  for (const caminho of ["/", "/api/healthz", "/api/imports"]) {
    const { code, corpo } = await status(`${url}${caminho}`);
    if (code === null) {
      erro(`${caminho}: não respondeu (${corpo}).`);
    } else if (code === 502 || code === 503 || code === 504) {
      erro(`${caminho}: ${code} — o roteador não achou ninguém na porta de destino.`);
    } else if (code >= 400) {
      erro(`${caminho}: ${code} — ${corpo.slice(0, 120)}`);
    } else if (caminho === "/api/imports" && corpo.trim().startsWith("<")) {
      // HTML em /api quer dizer que o Vite respondeu no lugar da API.
      erro(`${caminho}: ${code}, mas veio HTML — /api não está chegando ao api-server.`);
    } else {
      ok(`${caminho}: ${code}`);
    }
  }
}

console.log(
  problemas === 0
    ? "\nAmbiente coerente: uma stack, nas portas para onde o roteador encaminha.\n"
    : `\n${problemas} problema(s) acima. Nenhum deles se resolve mexendo na tela.\n`,
);
process.exit(problemas === 0 ? 0 : 1);
