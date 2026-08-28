/**
 * O COLETOR FIXO — medições escritas à mão, para provar o desenho antes de
 * existir integração.
 *
 * Não é um coletor de mentira posto na aplicação: é o coletor que a bateria de
 * testes usa e o que se liga numa demonstração, quando se quer ver a Jornada
 * pintada sem depender da SEFAZ estar no ar. Ele mora no pacote, e não em
 * `__tests__`, exatamente por causa do segundo uso.
 *
 * O que ele **não** faz: nada. Não guarda estado, não sorteia cor e não inventa
 * `medidoEm` — quem monta diz tudo. Um coletor de exemplo que gerasse números
 * plausíveis sozinho é como um farol chega verde à produção sem ninguém ter
 * ligado integração nenhuma.
 */

import type { Coletor, Leitura, PedidoDeColeta } from "./contrato";
import { normalizarChave } from "./chaves";

export interface OpcoesDoColetorFixo {
  nome?: string;
  /** Simula a integração fora do ar. */
  falharCom?: string;
  /** Simula a integração lenta, em ms — para provar o tempo limite. */
  demorarEmMs?: number;
}

/**
 * Monta um coletor a partir das leituras dadas. Os prefixos saem das próprias
 * chaves, como chaves exatas: assim o coletor fixo nunca reivindica um espaço
 * inteiro por acidente e a prova de "só se pinta o que é seu" continua possível.
 */
export function coletorFixo(
  leituras: readonly Leitura[],
  opcoes: OpcoesDoColetorFixo = {},
): Coletor {
  const chaves = [
    ...new Set(leituras.map((l) => normalizarChave(l.chave)).filter(ehTexto)),
  ];
  return {
    nome: opcoes.nome ?? "fixo",
    prefixos: chaves,
    async ler(pedido: PedidoDeColeta): Promise<readonly Leitura[]> {
      if (opcoes.demorarEmMs) await esperar(opcoes.demorarEmMs);
      if (opcoes.falharCom) throw new Error(opcoes.falharCom);
      const pedidas = new Set(pedido.chaves.map(normalizarChave));
      return leituras.filter((l) => pedidas.has(normalizarChave(l.chave)));
    },
  };
}

function ehTexto(valor: string | null): valor is string {
  return valor !== null;
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}
