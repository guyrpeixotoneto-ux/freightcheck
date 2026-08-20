import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A AUTORIDADE ÚNICA da conta de remuneração, prendida como teste.
 *
 * A planilha que este pacote aposenta errava por ter a mesma conta escrita em
 * vários lugares: o custo fixo padronizado da 1ª quinzena pesava pelo cadastro
 * e o da 2ª pelo diário, na mesma coluna, e ninguém percebeu por anos. Uma
 * segunda implementação da mesma fórmula não diverge no dia em que nasce —
 * diverge no dia em que só uma das duas é corrigida.
 *
 * Por isso o gross-up e as linhas do `RESUMO GERAL` moram em `mapa-rota.ts` e
 * em nenhum outro lugar. API, tela, DRE e relatórios **consomem** o motor; se
 * precisarem de um número novo, ele nasce aqui.
 *
 * O que este arquivo impede é a regressão silenciosa: uma divisão por
 * `1 − (PIS + COFINS + ICMS)` escrita numa tela compila, roda, e devolve o
 * número certo até a alíquota mudar num lado só.
 */

const RAIZ_DO_REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

/** O motor, e o único arquivo autorizado a escrever a aritmética do imposto. */
const MOTOR = path.join("lib", "fechamento", "src", "mapa-rota.ts");

/** Onde a conta poderia ser reescrita sem ninguém notar. */
const PASTAS_VIGIADAS = ["lib", "artifacts", "scripts"];

const IGNORADAS = new Set(["node_modules", "dist", ".git", "__tests__", "amostras"]);

function arquivosFonte(dir: string): string[] {
  const saida: string[] = [];
  let entradas;
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch {
    return saida;
  }
  for (const entrada of entradas) {
    if (IGNORADAS.has(entrada.name)) continue;
    const alvo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) saida.push(...arquivosFonte(alvo));
    else if (/\.(ts|tsx)$/.test(entrada.name)) saida.push(alvo);
  }
  return saida;
}

const fontes = PASTAS_VIGIADAS.flatMap((p) => arquivosFonte(path.join(RAIZ_DO_REPO, p))).map((a) =>
  path.relative(RAIZ_DO_REPO, a),
);

/**
 * As assinaturas da conta — o que só o motor pode escrever.
 *
 * São padrões de **aritmética**, não de vocabulário: citar `custo fixo` num
 * rótulo é legítimo em qualquer lugar; dividir por `1 − (PIS + COFINS + ISS)`
 * não é.
 */
const ASSINATURAS: { nome: string; padrao: RegExp }[] = [
  {
    nome: "o divisor do imposto — `1 − (PIS + COFINS + ICMS|ISS)`",
    padrao: /1\s*-\s*\(?\s*[\w.]*\b(pis|PIS)\b\s*\+/,
  },
  {
    nome: "o fator de gross-up — fatia dividida pelo divisor, somada dos dois lados",
    padrao: /parcelaDentroDoMunicipio\s*\/\s*dentro/,
  },
];

describe("a aritmética do imposto existe num lugar só", () => {
  it("varre um conjunto de arquivos que não está vazio", () => {
    /* Sem isto, um erro de caminho faria o teste passar sem olhar nada. */
    expect(fontes.length).toBeGreaterThan(200);
    expect(fontes).toContain(MOTOR);
  });

  for (const { nome, padrao } of ASSINATURAS) {
    it(`${nome} só aparece no motor`, () => {
      const infratores = fontes.filter((arquivo) => {
        if (arquivo === MOTOR) return false;
        return padrao.test(readFileSync(path.join(RAIZ_DO_REPO, arquivo), "utf8"));
      });
      expect(
        infratores,
        `A conta do imposto foi reescrita fora de ${MOTOR}. ` +
          `Consuma o motor em vez de repeti-lo: ${infratores.join(", ")}`,
      ).toEqual([]);
    });
  }
});

describe("quem consome o resumo não recalcula nada", () => {
  /**
   * A tela recebe as linhas prontas e formata. Um `*` ou `/` sobre valores de
   * remuneração ali seria uma segunda opinião sobre dinheiro — que é
   * exatamente o que este pacote existe para não haver.
   */
  it("a página do resumo não multiplica nem divide valores", () => {
    const pagina = path.join("artifacts", "freightaudit", "src", "pages", "fechamento", "resumo.tsx");
    const conteudo = readFileSync(path.join(RAIZ_DO_REPO, pagina), "utf8");
    for (const { padrao } of ASSINATURAS) expect(padrao.test(conteudo)).toBe(false);
    /* A única aritmética que a tela faz é a subtração emitido − apurado. */
    expect(conteudo).not.toMatch(/\bfatorDeImposto\b/);
    expect(conteudo).not.toMatch(/\bdivisoresDe\b/);
  });
});
