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
    return readFileSync(`/proc/${pid}/cmdline`, "utf8")
      .replace(/\0/g, " ")
      .trim();
  } catch {
    return `pid ${pid}`;
  }
}

/*
  `redirect: "manual"` está aqui desde sempre, e até agora não servia para
  nada: o 3xx que ele preserva caía no `else` final do laço abaixo e era
  impresso como `ok`. Ou seja, o único script que se roda para conferir o
  caminho do roteador dava o caminho por bom exatamente no defeito que mais
  custou a este projeto — `/api/*` respondido por um redirect para outra
  origem, que é o que a tela relata como DESVIADA (ver
  `artifacts/freightaudit/src/lib/transporte.ts`).

  O `location` e o carimbo passam a voltar junto porque são o que separa as
  duas perguntas seguintes: **para onde** desviou, e **quem** respondeu — só a
  nossa API escreve `X-FreightCheck-API`, e ela não redireciona em rota nenhuma.
*/
async function status(url) {
  try {
    const resposta = await fetch(url, { redirect: "manual" });
    const corpo = await resposta.text();
    return {
      code: resposta.status,
      corpo,
      location: resposta.headers.get("location"),
      daApi: resposta.headers.get("x-freightcheck-api") === "1",
    };
  } catch (err) {
    return {
      code: null,
      corpo: err instanceof Error ? err.message : "",
      location: null,
      daApi: false,
    };
  }
}

// ---------------------------------------------------------------------------

const artifacts = [
  lerArtifact("artifacts/api-server"),
  lerArtifact("artifacts/freightaudit"),
];

console.log("\nPortas declaradas nos artifacts");
for (const a of artifacts) {
  if (a.localPort && a.localPort === a.envPort) {
    ok(
      `${a.relativo}: roteador manda para ${a.localPort}, service sobe em ${a.envPort}`,
    );
  } else {
    erro(
      `${a.relativo}: localPort=${a.localPort ?? "ausente"} e ` +
        `[services.env] PORT=${a.envPort ?? "ausente"} não são o mesmo número.`,
    );
    nota(
      "O service sobe numa porta e o roteador encaminha para outra: 502 em /api.",
    );
  }
  if (!a.runDev?.includes("scripts/dev.mjs")) {
    erro(
      `${a.relativo}: o service de desenvolvimento não roda scripts/dev.mjs.`,
    );
    nota(
      `É "${a.runDev}" — sem migrations nem rebuild, e diferente do que o terminal roda.`,
    );
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
    erro(
      `${a.localPort}: ${pids.length} processos disputando a porta (${ferramenta}).`,
    );
    for (const pid of pids) nota(comando(pid));
    nota(
      "Suba o ambiente só pelo Run: os services dos artifacts são a única forma.",
    );
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
  /*
    O `/api/readyz` entrou no lugar do papel duplo que o `/api/healthz` tinha:
    o healthz virou liveness puro (não fala do banco), e é o readyz que carrega
    o diagnóstico. Um readyz 503 aqui não é a porta vazia — é a resposta.
  */
  for (const caminho of ["/", "/api/healthz", "/api/readyz", "/api/imports"]) {
    const { code, corpo, location, daApi } = await status(`${url}${caminho}`);
    if (code === null) {
      erro(`${caminho}: não respondeu (${corpo}).`);
    } else if (code >= 300 && code < 400) {
      /*
        Um 3xx aqui nunca é da API: não existe um `res.redirect` no servidor
        inteiro, e `nenhum-desvio-em-api.test.ts` mantém assim. Quem respondeu
        foi a camada de rede da publicação — roteador, proxy ou portal de
        autenticação da plataforma —, e não há correção no código que faça esta
        chamada chegar.
      */
      erro(
        `${caminho}: ${code} — desviada para ${location ?? "destino não informado"}.`,
      );
      nota(
        "Esta API não redireciona em rota nenhuma; quem respondeu foi uma camada antes dela.",
      );
      nota(
        "Se o destino for outra origem, o navegador barra a leitura por CORS e a tela mostra DESVIADA.",
      );
      nota(
        "Confira a proteção de acesso do deployment e as regras de domínio da plataforma — não a tela.",
      );
    } else if (caminho === "/api/readyz" && (code === 200 || code === 503)) {
      // Os dois códigos são resposta do readiness, e o corpo diz o resto.
      (code === 200 ? ok : erro)(
        `${caminho}: ${code} — ${code === 200 ? "pronto para servir" : "não está pronto"}.`,
      );
      relatarBanco(corpo);
    } else if (code === 502 || code === 503 || code === 504) {
      // Um 503 com `error` em JSON é o explicador do próprio projeto, ocupando
      // a porta para dizer por que a API não está nela. A razão dele vale mais
      // do que qualquer frase que este script inventasse.
      let razao = null;
      try {
        razao = JSON.parse(corpo).error;
      } catch {
        // Corpo vazio ou HTML: veio de uma camada antes da nossa.
      }
      if (razao) {
        erro(`${caminho}: ${code} — a API não está servindo, e diz por quê:`);
        nota(razao);
      } else {
        erro(
          `${caminho}: ${code} — o roteador não achou ninguém na porta de destino.`,
        );
      }
    } else if (code >= 400) {
      erro(`${caminho}: ${code} — ${corpo.slice(0, 120)}`);
    } else if (caminho === "/api/imports" && corpo.trim().startsWith("<")) {
      // HTML em /api quer dizer que o Vite respondeu no lugar da API.
      erro(
        `${caminho}: ${code}, mas veio HTML — /api não está chegando ao api-server.`,
      );
    } else if (caminho.startsWith("/api/") && !daApi) {
      /*
        Status bom e sem carimbo: a resposta é de alguém que não é esta API.
        Um cache, um proxy, uma página do ambiente — todos capazes de responder
        200 e JSON. Antes do carimbo, este caso passava por sucesso.
      */
      erro(`${caminho}: ${code}, e sem o carimbo X-FreightCheck-API.`);
      nota(
        "Ou o processo publicado é anterior a este build, ou quem respondeu não foi a API.",
      );
    } else {
      ok(`${caminho}: ${code}`);
      /*
        O relato do banco também sai do healthz de um api-server antigo, que
        ainda o carregava — `relatarBanco` só age quando o corpo tem `database`,
        então num build novo esta linha não imprime nada e o relato vem do
        readyz logo acima.
      */
      if (caminho === "/api/healthz") relatarBanco(corpo);
    }
  }
}

function relatarBanco(corpo) {
  let banco;
  try {
    banco = JSON.parse(corpo).database;
  } catch {
    return;
  }
  if (!banco) {
    return;
  }
  if (!banco.configured) {
    erro(`banco: a DATABASE_URL não chegou a este processo.`);
  } else if (!banco.reachable) {
    erro(
      `banco: variável recebida, conexão falhou${banco.code ? ` (${banco.code})` : ""}.`,
    );
  } else if (!banco.migrated) {
    erro("banco: conectado, mas sem schema — faltam migrations.");
  } else {
    ok("banco: conectado, com o schema aplicado.");
  }
  nota(banco.detail);
}

console.log(
  problemas === 0
    ? "\nAmbiente coerente: uma stack, nas portas para onde o roteador encaminha.\n"
    : `\n${problemas} problema(s) acima. Nenhum deles se resolve mexendo na tela.\n`,
);
process.exit(problemas === 0 ? 0 : 1);
