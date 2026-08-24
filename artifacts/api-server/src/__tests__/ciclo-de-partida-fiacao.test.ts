import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A fiação da partida — no mesmo idioma de `producao-migra-na-partida.test.ts`.
 *
 * `index.ts` não pode ser importado em teste: seu topo chama `app.listen()`
 * incondicionalmente, e cada arquivo desta pasta constrói o próprio `app` e o
 * dirige à mão por isso mesmo. O que este arquivo prova é o texto executável
 * — a mesma disciplina que já prendia `migrarComReparo`/`lembrarRelatorio` — e
 * cobre três garantias que o comportamento (provado em `startupz.test.ts` e
 * `banco-a-frente.test.ts`) não alcança sozinho, porque dependem de **onde**,
 * dentro de `index.ts`, uma chamada está.
 */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

/** O corpo de uma função top-level, do `{` de abertura ao `}` de fechamento. */
function corpoDaFuncao(fonte: string, assinatura: RegExp): string {
  const inicio = fonte.search(assinatura);
  if (inicio === -1) throw new Error(`Não achei ${assinatura}`);
  const abre = fonte.indexOf("{", inicio);
  let profundidade = 0;
  for (let i = abre; i < fonte.length; i++) {
    if (fonte[i] === "{") profundidade++;
    if (fonte[i] === "}") {
      profundidade--;
      if (profundidade === 0) return fonte.slice(abre, i + 1);
    }
  }
  throw new Error("chave de fechamento não encontrada");
}

describe("tentativaComecou/tentativaTerminou envolvem toda a tentativa", () => {
  const fonte = ler("src/index.ts");

  it("tentativaComecou() é chamada antes de applyMigrationsInBackground()", () => {
    const iComecou = fonte.indexOf("tentativaComecou()");
    const iChamada = fonte.indexOf("void applyMigrationsInBackground()");
    expect(iComecou).toBeGreaterThan(-1);
    expect(iComecou).toBeLessThan(iChamada);
  });

  it("tentativaTerminou() está em .finally() — corre em todo desfecho, inclusive os retornos antecipados", () => {
    const iChamada = fonte.indexOf("void applyMigrationsInBackground()");
    const trecho = fonte.slice(iChamada, iChamada + 400);
    expect(trecho).toMatch(/\.finally\(\(\) => \{\s*tentativaTerminou\(/);
  });

  it("anunciarProntidao roda depois — a promoção é liberada antes de o portão poder ser lido", () => {
    const iChamada = fonte.indexOf("void applyMigrationsInBackground()");
    const trecho = fonte.slice(iChamada, iChamada + 500);
    expect(trecho).toMatch(/\.then\(anunciarProntidao\)/);
  });
});

describe("ambiente sem migração automática não fica silencioso — P3", () => {
  const fonte = ler("src/index.ts");
  const applyBody = corpoDaFuncao(fonte, /async function applyMigrationsInBackground/);
  const anunciarBody = corpoDaFuncao(fonte, /async function anunciarProntidao/);

  it("o retorno antecipado de `!decisao.migrar` é só log info — a decisão de alertar não é dele", () => {
    const trecho = applyBody.slice(
      applyBody.indexOf("!decisao.migrar"),
      applyBody.indexOf("!decisao.migrar") + 300,
    );
    expect(trecho).toMatch(/logger\.info/);
    expect(trecho).not.toMatch(/alertar/);
  });

  it("anunciarProntidao alerta SERVICO_NAO_PRONTO sempre que `!estado.pronto` — incondicional a por que a partida não migrou", () => {
    // A condição é só `!estado.pronto`: nenhuma referência a `decisao` ou
    // `DB_MIGRATE_ON_BOOT` neste corpo — o mesmo diagnóstico que fecha o
    // portão é o que decide alertar, sem uma segunda condição que pudesse
    // silenciar justo o ambiente que nunca vai convergir sozinho.
    expect(anunciarBody).toMatch(/if\s*\(estado\.pronto\)/);
    expect(anunciarBody).toMatch(/tipo:\s*"SERVICO_NAO_PRONTO"/);
    expect(anunciarBody).not.toMatch(/decisao|DB_MIGRATE_ON_BOOT/);
    /*
      E ela roda depois de QUALQUER desfecho de applyMigrationsInBackground —
      inclusive o retorno antecipado de `!decisao.migrar` — porque está
      encadeada com `.then()` no callback do `listen`, provado acima. Um
      Preview com `DB_MIGRATE_ON_BOOT` ausente e pendências reais termina
      chamando exatamente este alerta: `estadoDaProntidao()` (real, sem mock —
      ver `janela-da-partida.test.ts`, que roda com `DB_MIGRATE_ON_BOOT=0` e
      confirma `MIGRATIONS_PENDENTES`) mede `!pronto`, e este trecho garante
      que a medição vira alerta, não um log que só quem lê o console vê.
    */
  });
});
