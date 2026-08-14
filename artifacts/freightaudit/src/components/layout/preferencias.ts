import { useCallback, useEffect, useState } from "react";

/**
 * O que o usuário escolheu sobre a forma do menu.
 *
 * **Por que isto precisa sobreviver ao componente.** Cada página deste produto
 * monta a sua própria `Layout`, então a casca inteira — faixa, lateral, tudo —
 * é desmontada e remontada a cada navegação. Em `useState` puro, toda escolha
 * feita aqui duraria até o próximo clique num item do menu: quem recolhesse a
 * lateral para ler uma tabela larga a veria voltar inteira ao abrir a tabela
 * seguinte, e concluiria, com razão, que o botão não funciona.
 *
 * **Por que no navegador e não no servidor.** É a mesma razão da estrela dos
 * cartões (`lib/favoritos.ts`): isto é preferência de quem está na máquina, não
 * dado do sistema. Não merece tabela, migration nem rota — e falhar em gravá-la
 * não pode derrubar a tela, daí cada acesso ao `localStorage` ir dentro de um
 * `try`. Navegador com armazenamento bloqueado perde a memória da escolha, e
 * nada além disso acontece.
 */

const CHAVE_MENU = "freightcheck:menu-aberto";
const CHAVE_SECOES = "freightcheck:menu-secoes-recolhidas";

/** A lateral inteira ou a faixa de ícones. O padrão é a lateral inteira. */
export function useMenuAberto() {
  const [aberto, setAberto] = useState<boolean>(() => lerBooleano(CHAVE_MENU, true));

  useEffect(() => {
    gravar(CHAVE_MENU, aberto);
  }, [aberto]);

  const alternar = useCallback(() => setAberto((atual) => !atual), []);

  return { aberto, alternar };
}

/**
 * Quais seções o usuário fechou.
 *
 * A chave é o título da seção. Renomear uma seção reabre-a para quem a tinha
 * fechado, e é o comportamento certo: a seção com aquele nome é outra.
 */
export function useSecoesRecolhidas() {
  const [recolhidas, setRecolhidas] = useState<string[]>(() => lerTextos(CHAVE_SECOES));

  useEffect(() => {
    gravar(CHAVE_SECOES, recolhidas);
  }, [recolhidas]);

  const alternar = useCallback((titulo: string) => {
    setRecolhidas((atual) =>
      atual.includes(titulo) ? atual.filter((t) => t !== titulo) : [...atual, titulo],
    );
  }, []);

  const recolhido = useCallback((titulo: string) => recolhidas.includes(titulo), [recolhidas]);

  return { recolhido, alternar };
}

function gravar(chave: string, valor: unknown): void {
  try {
    window.localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    // Armazenamento bloqueado: a escolha deixa de sobreviver ao reload.
  }
}

function lerBooleano(chave: string, padrao: boolean): boolean {
  try {
    const bruto = window.localStorage.getItem(chave);
    if (bruto === null) return padrao;
    const valor: unknown = JSON.parse(bruto);
    return typeof valor === "boolean" ? valor : padrao;
  } catch {
    return padrao;
  }
}

function lerTextos(chave: string): string[] {
  try {
    const bruto = window.localStorage.getItem(chave);
    if (!bruto) return [];
    const valor: unknown = JSON.parse(bruto);
    return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
