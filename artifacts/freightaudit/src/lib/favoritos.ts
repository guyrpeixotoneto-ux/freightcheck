import { useCallback, useEffect, useState } from "react";

const CHAVE = "freightcheck:parametros-favoritos";

/**
 * A estrela dos cartões do Freightech.
 *
 * Lá ela existe porque a grade tem dezenas de cartões e cada operador usa uns
 * cinco. Aqui vale o mesmo, e por isso a lista fica no navegador: é preferência
 * de quem está na máquina, não dado do sistema — não merece uma tabela, uma
 * migration nem uma rota, e falhar em gravá-la não pode derrubar a tela.
 */
export function useFavoritos() {
  const [favoritos, setFavoritos] = useState<string[]>(ler);

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAVE, JSON.stringify(favoritos));
    } catch {
      // Navegador com armazenamento bloqueado: a estrela deixa de sobreviver ao
      // reload, e nada além disso acontece.
    }
  }, [favoritos]);

  const alternar = useCallback((chave: string) => {
    setFavoritos((atual) =>
      atual.includes(chave) ? atual.filter((c) => c !== chave) : [...atual, chave],
    );
  }, []);

  return { favoritos, alternar };
}

function ler(): string[] {
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    if (!bruto) return [];
    const valor: unknown = JSON.parse(bruto);
    return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
