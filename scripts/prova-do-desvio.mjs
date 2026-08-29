#!/usr/bin/env node
/**
 * A cadeia HTTP inteira de `/api/*`, hop a hop — para provar **quem** desvia.
 *
 * A tela sabe dizer *que* houve desvio e não sabe dizer *para onde*: um
 * redirect para outra origem chega ao navegador como resposta opaca, sem
 * `Location`, sem cabeçalho e sem corpo (ver
 * `artifacts/freightaudit/src/lib/transporte.ts`). Isso é uma limitação do
 * navegador, e não do problema — fora dele, o `Location` está lá.
 *
 * Este script é esse "fora dele". Ele repete as chamadas que a Visão Geral faz,
 * sem seguir redirect automaticamente, e imprime de cada salto o que a
 * investigação precisa: status, `Location`, `Content-Type`, `Server`, os nomes
 * dos cookies que a resposta manda, e — o fato que decide tudo — se a resposta
 * traz `X-FreightCheck-API`, o carimbo que **só** o Express deste projeto
 * escreve (`artifacts/api-server/src/middlewares/carimbo-da-api.ts`).
 *
 * A conclusão sai por eliminação, e não por opinião:
 *
 *   - 3xx **sem** carimbo → quem respondeu foi uma camada antes da API. Não há
 *     correção possível no código deste repositório: esta API não redireciona
 *     em rota nenhuma, e `nenhum-desvio-em-api.test.ts` mantém assim.
 *   - 3xx **com** carimbo → seria defeito nosso, e o teste acima teria de estar
 *     quebrado. Nunca foi observado.
 *   - 2xx/4xx com carimbo → a chamada chegou ao Express, e o que voltou é dele.
 *
 * Uso:
 *
 *   node scripts/prova-do-desvio.mjs https://freightcheck.com.br
 *   node scripts/prova-do-desvio.mjs https://freightcheck.com.br --cookie "fc_session=…"
 *
 * O cookie é opcional e é o que separa "sessão do produto expirada" de "desvio
 * da plataforma": sem ele o esperado é `401` em JSON, e nunca um 3xx.
 */

/** As chamadas que montam a Visão Geral, na ordem em que a tela as dispara. */
const CHAMADAS_DA_VISAO_GERAL = [
  "/api/healthz",
  "/api/readyz",
  "/api/build",
  "/api/contexts",
  "/api/changes/families/overview?period=2026-08",
  "/api/changes/families",
  "/api/balance",
  "/api/imports",
];

/** Quantos saltos seguir antes de desistir. Um portal de login usa dois ou três. */
const MAX_SALTOS = 10;

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith("--"))?.replace(/\/+$/, "");
const cookie = args.includes("--cookie")
  ? args[args.indexOf("--cookie") + 1]
  : undefined;

if (!base) {
  console.error(
    'uso: node scripts/prova-do-desvio.mjs <url-base> [--cookie "nome=valor"]',
  );
  process.exit(2);
}

const origem = new URL(base).origin;

function nomesDosCookies(resposta) {
  // Só os **nomes**: o valor de um cookie de sessão não entra em log nenhum.
  const bruto = resposta.headers.getSetCookie?.() ?? [];
  return bruto.map((c) => c.split("=")[0]).join(", ");
}

async function salto(url, metodo) {
  const inicio = Date.now();
  try {
    const resposta = await fetch(url, {
      method: metodo,
      redirect: "manual",
      headers: {
        // A mesma `Origin` que o navegador manda numa chamada da tela.
        Origin: origem,
        Accept: "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    const corpo = await resposta.text().catch(() => "");
    return {
      url,
      status: resposta.status,
      location: resposta.headers.get("location"),
      contentType: resposta.headers.get("content-type"),
      server: resposta.headers.get("server"),
      requestId: resposta.headers.get("x-request-id"),
      daApi: resposta.headers.get("x-freightcheck-api") === "1",
      allowOrigin: resposta.headers.get("access-control-allow-origin"),
      cookies: nomesDosCookies(resposta),
      ms: Date.now() - inicio,
      corpo: corpo.slice(0, 200),
    };
  } catch (err) {
    return {
      url,
      status: null,
      erro: err instanceof Error ? err.message : String(err),
      ms: Date.now() - inicio,
    };
  }
}

async function preflight(url) {
  try {
    const resposta = await fetch(url, {
      method: "OPTIONS",
      redirect: "manual",
      headers: {
        Origin: origem,
        "Access-Control-Request-Method": "GET",
      },
    });
    return {
      status: resposta.status,
      allowOrigin: resposta.headers.get("access-control-allow-origin"),
      location: resposta.headers.get("location"),
    };
  } catch (err) {
    return {
      status: null,
      erro: err instanceof Error ? err.message : String(err),
    };
  }
}

let desvios = 0;
let semCarimbo = 0;

for (const caminho of CHAMADAS_DA_VISAO_GERAL) {
  console.log(`\n=== GET ${base}${caminho}`);
  console.log(
    `    Origin: ${origem}   credenciais: ${cookie ? "cookie enviado" : "nenhuma"}`,
  );

  let alvo = `${base}${caminho}`;
  for (let n = 1; n <= MAX_SALTOS; n += 1) {
    const r = await salto(alvo, "GET");
    if (r.status === null) {
      console.log(
        `  [${n}] ${alvo}\n      sem resposta: ${r.erro} (${r.ms}ms)`,
      );
      break;
    }
    console.log(
      `  [${n}] ${r.status} ${alvo} (${r.ms}ms)\n` +
        `      content-type: ${r.contentType ?? "—"}\n` +
        `      server: ${r.server ?? "—"}   X-FreightCheck-API: ${r.daApi ? "sim" : "NÃO"}` +
        `${r.requestId ? `   X-Request-Id: ${r.requestId}` : ""}\n` +
        `      access-control-allow-origin: ${r.allowOrigin ?? "—"}\n` +
        `      set-cookie: ${r.cookies || "—"}`,
    );

    if (r.status >= 300 && r.status < 400) {
      desvios += 1;
      const destino = r.location ? new URL(r.location, alvo).toString() : null;
      const outraOrigem = destino && new URL(destino).origin !== origem;
      console.log(
        `      Location: ${destino ?? "ausente"}` +
          `${outraOrigem ? "   ← OUTRA ORIGEM (o navegador barra a leitura por CORS)" : ""}`,
      );
      console.log(
        r.daApi
          ? "      QUEM RESPONDEU: a API (carimbo presente). Isto seria defeito nosso — ver nenhum-desvio-em-api.test.ts."
          : "      QUEM RESPONDEU: uma camada antes da API (sem carimbo). Não há correção no código deste repositório.",
      );
      if (!destino) break;
      alvo = destino;
      continue;
    }

    if (!r.daApi) {
      semCarimbo += 1;
      console.log(
        "      QUEM RESPONDEU: não foi esta API (sem carimbo) — ou o build publicado é anterior ao carimbo.",
      );
    }
    console.log(`      corpo: ${r.corpo.replace(/\s+/g, " ")}`);
    break;
  }

  const pre = await preflight(`${base}${caminho}`);
  console.log(
    `      OPTIONS (preflight): ${pre.status ?? `sem resposta (${pre.erro})`}` +
      `${pre.location ? `   Location: ${pre.location}` : ""}` +
      `   allow-origin: ${pre.allowOrigin ?? "—"}`,
  );
}

console.log(
  `\n${desvios} desvio(s) e ${semCarimbo} resposta(s) sem carimbo em ${CHAMADAS_DA_VISAO_GERAL.length} chamadas.`,
);
if (desvios > 0) {
  console.log(
    "Um 3xx em /api/* não sai deste código. Leve a cadeia acima para a camada de\n" +
      "publicação: proteção de acesso do deployment, domínio, proxy reverso e portal\n" +
      "de autenticação da plataforma.",
  );
}
process.exit(desvios > 0 ? 1 : 0);
