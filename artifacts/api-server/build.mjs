import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { cp, rm, mkdir, symlink, readlink, readdir, access } from "node:fs/promises";
import { constants, readFileSync } from "node:fs";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Garante que todos os pacotes lib/* têm seus symlinks de workspace criados.
 *
 * O ambiente de build de produção roda `pnpm install` (sem --force), que não
 * recria symlinks ausentes quando novos pacotes lib/* são adicionados por
 * task agents. Esta função faz o trabalho que o pnpm deveria ter feito:
 *
 * - Para cada lib/<pkg> com deps @workspace/*, cria
 *   lib/<pkg>/node_modules/@workspace/<dep> → ../../../<dep>
 * - Para deps externas (ex: drizzle-orm), reutiliza o mesmo alvo relativo
 *   que pacotes irmãos já usam (todos estão na mesma profundidade).
 */
async function ensureWorkspaceSymlinks() {
  const libDir = path.resolve(artifactDir, "../../lib");

  const exists = (p) => access(p, constants.F_OK).then(() => true, () => false);

  const entries = await readdir(libDir, { withFileTypes: true });
  const libPkgs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  // Mapa: nome-do-dep-externo → alvo relativo já resolvido por um irmão
  const externalTargetCache = {};

  for (const pkgName of libPkgs) {
    const pkgDir = path.join(libDir, pkgName);
    const pkgJsonPath = path.join(pkgDir, "package.json");
    if (!(await exists(pkgJsonPath))) continue;

    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    const runtimeDeps = Object.keys(pkgJson.dependencies ?? {});
    if (runtimeDeps.length === 0) continue;

    const workspaceDeps = runtimeDeps.filter((d) => d.startsWith("@workspace/"));
    const externalDeps = runtimeDeps.filter((d) => !d.startsWith("@workspace/"));

    // --- workspace symlinks ---
    if (workspaceDeps.length > 0) {
      const wsDir = path.join(pkgDir, "node_modules", "@workspace");
      await mkdir(wsDir, { recursive: true });
      for (const dep of workspaceDeps) {
        const depName = dep.replace("@workspace/", "");
        const link = path.join(wsDir, depName);
        if (!(await exists(link))) {
          // De lib/<pkgName>/node_modules/@workspace/<depName>:
          //   ../  → node_modules/
          //   ../../  → lib/<pkgName>/
          //   ../../../  → lib/
          //   ../../../<depName> → lib/<depName>
          await symlink(`../../../${depName}`, link).catch(() => {});
        }
      }
    }

    // --- external dep symlinks ---
    for (const dep of externalDeps) {
      const link = path.join(pkgDir, "node_modules", dep);
      if (await exists(link)) continue;

      // Procura o alvo no cache ou em pacotes irmãos
      if (!externalTargetCache[dep]) {
        for (const sibling of libPkgs) {
          if (sibling === pkgName) continue;
          const siblingLink = path.join(libDir, sibling, "node_modules", dep);
          if (await exists(siblingLink)) {
            externalTargetCache[dep] = await readlink(siblingLink);
            break;
          }
        }
      }

      const target = externalTargetCache[dep];
      if (!target) continue; // dep não encontrada em nenhum irmão; pnpm resolve

      const depParts = dep.split("/");
      if (depParts.length > 1) {
        await mkdir(path.join(pkgDir, "node_modules", depParts[0]), { recursive: true });
      }
      await symlink(target, link).catch(() => {});
    }
  }
}

/**
 * De qual código este bundle foi feito.
 *
 * Três rodadas deste projeto se perderam sem conseguir responder "o servidor
 * que está no ar é o do meu último commit?". A resposta passa a viajar dentro
 * do próprio binário, e a rota /api/build a devolve.
 */
function buildStamp() {
  let revision = "desconhecida";
  try {
    revision = execSync("git rev-parse --short HEAD", {
      cwd: artifactDir,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    // Um deploy pode construir fora de um clone git. O carimbo de tempo
    // sozinho já distingue um bundle novo de um de três dias atrás.
  }
  return { revision, builtAt: new Date().toISOString() };
}

async function buildAll() {
  // Garantir que todos os symlinks de workspace estão corretos antes de
  // bundlar. O ambiente de build de produção roda `pnpm install` (sem
  // --force), que não recria symlinks ausentes quando novos pacotes lib/*
  // são adicionados. Este passo recria os links necessários sem depender
  // do pnpm.
  await ensureWorkspaceSymlinks();

  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  const stamp = buildStamp();

  await esbuild({
    define: {
      "process.env.BUILD_REVISION": JSON.stringify(stamp.revision),
      "process.env.BUILD_TIME": JSON.stringify(stamp.builtAt),
    },
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  /**
   * As migrations vão junto com o bundle.
   *
   * `lib/db/src/migrate.ts` resolve a pasta a partir do próprio arquivo, o que
   * funciona no repositório e deixa de funcionar depois do bundle — o
   * `import.meta.url` passa a ser o dist. Copiando aqui, o servidor encontra as
   * migrations em qualquer ambiente, inclusive num deploy que só recebe o dist.
   */
  await cp(
    path.resolve(artifactDir, "../../lib/db/migrations"),
    path.resolve(distDir, "migrations"),
    { recursive: true },
  );
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
