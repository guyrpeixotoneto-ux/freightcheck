import { useCallback, useEffect, useState } from "react";

const CHAVE = "freightcheck:parametros-favoritos";

/**
 * A estrela dos cartões do Freightech.
 *
 * Lá ela existe porque a grade tem dezenas de cartões e cada operador usa uns
 * cinco. Aqui vale o mesmo, e por isso a lista fica no navegador: é preferência
 * de quem está na máquina, não dado do sistema — não merece uma tabela, uma
 * migration nem uma rota, e falhar em gravá-la não pode derrubar a tela.
 *
 * **A chave é parâmetro porque há mais de uma grade.** Parâmetros e Book do
 * Operador têm cartões com nomes parecidos e conjuntos diferentes; favoritar
 * "OUTROS CUSTOS" numa tela não pode acender uma estrela na outra. Cada grade
 * traz a sua chave, e o padrão continua sendo o da tela que existia primeiro —
 * assim ninguém perde os favoritos que já tinha.
 */
export function useFavoritos(chave: string = CHAVE) {
  const [favoritos, setFavoritos] = useState<string[]>(() => ler(chave));

  /*
   * Trocar de chave recarrega a lista. Sem isto, navegar de uma grade para a
   * outra escreveria os favoritos da primeira sobre os da segunda no efeito
   * abaixo — o estado sobrevive à troca, o `localStorage` não deveria.
   */
  useEffect(() => {
    setFavoritos(ler(chave));
  }, [chave]);

  useEffect(() => {
    try {
      window.localStorage.setItem(chave, JSON.stringify(favoritos));
    } catch {
      // Navegador com armazenamento bloqueado: a estrela deixa de sobreviver ao
      // reload, e nada além disso acontece.
    }
  }, [chave, favoritos]);

  const alternar = useCallback((chave: string) => {
    setFavoritos((atual) =>
      atual.includes(chave) ? atual.filter((c) => c !== chave) : [...atual, chave],
    );
  }, []);

  return { favoritos, alternar };
}

function ler(chave: string): string[] {
  try {
    const bruto = window.localStorage.getItem(chave);
    if (!bruto) return [];
    const valor: unknown = JSON.parse(bruto);
    return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
