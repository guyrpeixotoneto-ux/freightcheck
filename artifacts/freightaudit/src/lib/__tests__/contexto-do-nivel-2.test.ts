import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O nível 2 de um cartão responde pela mesma unidade que o total acima dele.
 *
 * O teste irmão em `recorte.test.ts` prova que `paramsDosVeiculosDoGrupo` monta
 * o endereço certo. Este prova a outra metade, que é onde o defeito realmente
 * morava: que **toda** tela usa essa função em vez de montar a consulta à mão.
 *
 * Eram três cópias escritas à mão da mesma chamada e só uma mandava o contexto.
 * Quem não manda `scopeHash`/`canal` não fica sem filtro — o servidor cai em
 * `contexts[0]`, a unidade com a vigência mais recente (`resolveContext`, em
 * `@workspace/comparison`). O total do cartão continuava certo, porque a
 * leitura que o produziu recebe o contexto; a lista por baixo virava de outra
 * unidade. Numa base com duas unidades: cabeçalho −R$ 1.000 da unidade B,
 * lista com a placa da unidade A somando +R$ 200.
 *
 * Nem o compilador nem o lint veem isso: cada cópia é um `URLSearchParams`
 * perfeitamente razoável. O que se vê é a soma não fechar, meses depois, sem
 * ninguém saber qual das duas telas mente. Por isso a regra é prendida aqui, na
 * forma mais grosseira e mais difícil de contornar por acidente: quem cita a
 * rota, cita a função.
 */

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const ROTA = "/changes/grouped/vehicles";
const FUNCAO = "paramsDosVeiculosDoGrupo";

function arquivosDeCodigo(dir: string): string[] {
  const achados: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const caminho = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name !== "__tests__") achados.push(...arquivosDeCodigo(caminho));
    } else if (/\.tsx?$/.test(entrada.name)) {
      achados.push(caminho);
    }
  }
  return achados;
}

describe("quem pede os veículos de um grupo", () => {
  const chamadores = arquivosDeCodigo(RAIZ)
    .map((caminho) => ({ caminho, fonte: readFileSync(caminho, "utf8") }))
    .filter(({ fonte, caminho }) => fonte.includes(ROTA) && !caminho.endsWith("recorte.ts"));

  it("existe — se ninguém cita a rota, este teste virou letra morta", () => {
    expect(chamadores.length).toBeGreaterThan(0);
  });

  it.each(chamadores.map((c) => path.relative(RAIZ, c.caminho)))(
    "%s monta o endereço com a função compartilhada, e não à mão",
    (relativo) => {
      const { fonte } = chamadores.find(
        (c) => path.relative(RAIZ, c.caminho) === relativo,
      )!;
      expect(fonte).toContain(FUNCAO);
    },
  );

  /*
    O contexto na chave, e não só na URL.
    
    O React Query guarda uma entrada por chave literal. Duas unidades na mesma
    vigência com a mesma chave dividem a mesma entrada: trocar de unidade
    serviria a lista da anterior sem sequer ir ao servidor — o mesmo defeito
    outra vez, agora sem nenhuma requisição para culpar.
  */
  it.each(chamadores.map((c) => path.relative(RAIZ, c.caminho)))(
    "%s põe o contexto também na queryKey",
    (relativo) => {
      const { fonte } = chamadores.find(
        (c) => path.relative(RAIZ, c.caminho) === relativo,
      )!;
      const chave = fonte.match(/queryKey: \["group-vehicles"[^\]]*\]/);
      expect(chave, "não achei a queryKey de group-vehicles").not.toBeNull();
      expect(chave![0]).toContain("contexto.toString()");
    },
  );
});
