/**
 * O REGISTRO — quem responde por qual chave, decidido uma vez e no arranque.
 *
 * O registro é a lista de coletores ligados e a função que traduz
 * `cte.autorizacao_sefaz` no coletor que sabe medir aquilo. É deliberadamente
 * burro: não busca nada, não guarda medição e não sabe o que é um fluxo. Ele
 * distribui chaves.
 *
 * ---------------------------------------------------------------------------
 * O prefixo mais longo ganha, e o empate é erro de montagem
 * ---------------------------------------------------------------------------
 *
 * Um coletor reivindica um espaço inteiro (`"cte."`) ou uma chave exata
 * (`"cte.autorizacao_sefaz"`). Quando os dois alcançam a mesma chave, ganha o
 * mais específico — é o que permite trocar **uma** métrica de dono sem
 * reescrever o coletor que responde pelas outras quinze.
 *
 * Quando dois coletores reivindicam exatamente o mesmo prefixo, `registrar`
 * **recusa na hora**. Escolher um dos dois em silêncio produziria um farol que
 * depende da ordem de importação dos arquivos: verde numa máquina, vermelho na
 * outra, e nada na tela dizendo por quê. Falhar no arranque custa um deploy
 * quebrado; a alternativa custa uma investigação.
 *
 * ---------------------------------------------------------------------------
 * Chave sem dono não é falha
 * ---------------------------------------------------------------------------
 *
 * `distribuir` separa as órfãs em vez de recusar. Uma etapa desenhada hoje com
 * a chave do coletor que entra no mês que vem é trabalho adiantado, não erro —
 * ela fica `SEM_DADO` até alguém a atender. Quem quiser ver essa lista de frente
 * usa `conferirCobertura`, em `cobertura.ts`.
 */

import { RecusaDeFluxo } from "../validacao";
import { normalizarChave } from "./chaves";
import type { Coletor } from "./contrato";

/** Um coletor e as chaves pedidas que são dele. */
export interface Lote {
  coletor: Coletor;
  chaves: string[];
}

export interface Distribuicao {
  lotes: Lote[];
  /** Pedidas, e sem coletor que responda por elas. */
  orfas: string[];
}

export class RegistroDeColetores {
  /** prefixo normalizado → coletor. */
  private readonly porPrefixo = new Map<string, Coletor>();

  registrar(coletor: Coletor): this {
    const nome = coletor.nome.trim();
    if (nome === "") {
      throw new RecusaDeFluxo(
        "coletor_sem_nome",
        "Um coletor precisa de nome — é por ele que a falha dele é identificada.",
      );
    }
    if (coletor.prefixos.length === 0) {
      throw new RecusaDeFluxo(
        "coletor_sem_prefixo",
        `O coletor "${nome}" não declara nenhuma chave, e por isso nunca seria chamado.`,
      );
    }
    for (const bruto of coletor.prefixos) {
      const prefixo = normalizarChave(bruto);
      if (prefixo === null) {
        throw new RecusaDeFluxo(
          "prefixo_em_branco",
          `O coletor "${nome}" declara um prefixo em branco.`,
        );
      }
      const dono = this.porPrefixo.get(prefixo);
      if (dono && dono !== coletor) {
        throw new RecusaDeFluxo(
          "prefixo_disputado",
          `"${prefixo}" é reivindicado pelos coletores "${dono.nome}" e "${nome}". ` +
            `Duas medições para a mesma etapa não têm desempate possível.`,
        );
      }
      this.porPrefixo.set(prefixo, coletor);
    }
    return this;
  }

  coletores(): Coletor[] {
    return [...new Set(this.porPrefixo.values())];
  }

  /** O coletor de uma chave, pelo prefixo mais longo que a alcança. */
  responsavelPor(chaveBruta: string): Coletor | null {
    const chave = normalizarChave(chaveBruta);
    if (chave === null) return null;
    let escolhido: Coletor | null = null;
    let maior = -1;
    for (const [prefixo, coletor] of this.porPrefixo) {
      const alcanca = prefixo.endsWith(".")
        ? chave.startsWith(prefixo)
        : chave === prefixo;
      if (alcanca && prefixo.length > maior) {
        escolhido = coletor;
        maior = prefixo.length;
      }
    }
    return escolhido;
  }

  /** Um coletor pode pintar esta chave? A cláusula "só se pinta o que é seu". */
  alcanca(coletor: Coletor, chave: string): boolean {
    return this.responsavelPor(chave) === coletor;
  }

  /**
   * As chaves pedidas, repartidas por coletor.
   *
   * A ordem dos lotes é a de registro, e as chaves de cada lote saem sem
   * repetição: pedir `cte.emissao` duas vezes porque duas etapas a declaram é
   * cobrar duas consultas por uma resposta.
   */
  distribuir(chaves: readonly string[]): Distribuicao {
    const porColetor = new Map<Coletor, Set<string>>();
    const orfas = new Set<string>();
    for (const bruta of chaves) {
      const chave = normalizarChave(bruta);
      if (chave === null) continue;
      const coletor = this.responsavelPor(chave);
      if (!coletor) {
        orfas.add(chave);
        continue;
      }
      const lote = porColetor.get(coletor) ?? new Set<string>();
      lote.add(chave);
      porColetor.set(coletor, lote);
    }
    return {
      lotes: this.coletores()
        .filter((c) => porColetor.has(c))
        .map((c) => ({ coletor: c, chaves: [...porColetor.get(c)!] })),
      orfas: [...orfas],
    };
  }
}

/** O registro montado numa expressão — o formato do arranque da aplicação. */
export function registroDeColetores(
  ...coletores: Coletor[]
): RegistroDeColetores {
  const registro = new RegistroDeColetores();
  for (const coletor of coletores) registro.registrar(coletor);
  return registro;
}
