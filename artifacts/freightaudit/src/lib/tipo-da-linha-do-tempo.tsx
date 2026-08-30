import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { TipoDaLinhaDoTempo } from "@workspace/comparison/tipos";
import { linkDeAlteracoes, type DestinoDeAlteracoes } from "@/lib/recorte";

/**
 * De qual tipo a Linha do Tempo está falando — cavalo, carreta ou trecho.
 *
 * Existe como contexto, e não como propriedade passada de mão em mão, pela
 * mesma razão que `lib/escopos.ts` dá para o escopo de frota: **isto não é um
 * filtro de lista, é a população da leitura inteira**. O cartão de resumo, a
 * evolução vigência a vigência, a gaveta de detalhe e cada link para Alterações
 * falam todos do mesmo tipo, e um deles que esquecesse de repassar a
 * propriedade não quebraria a tela — mostraria a frota inteira sob um título
 * que promete um equipamento só, que é a pior forma de errar.
 *
 * Fora da aba de tipo o contexto vale `null`, e tudo que lê daqui volta a se
 * comportar como sempre se comportou: a aba Geral não passa a existir de outro
 * jeito por causa deste arquivo.
 */
const TipoDaLeitura = createContext<TipoDaLinhaDoTempo | null>(null);

export function LeituraPorTipo({
  tipo,
  children,
}: {
  tipo: TipoDaLinhaDoTempo | null;
  children: ReactNode;
}) {
  return <TipoDaLeitura.Provider value={tipo}>{children}</TipoDaLeitura.Provider>;
}

/** O tipo aberto, ou `null` na aba Geral. */
export function useTipoDaLinhaDoTempo(): TipoDaLinhaDoTempo | null {
  return useContext(TipoDaLeitura);
}

/**
 * O endereço de Alterações que esta leitura pode oferecer — ou `null`.
 *
 * Duas coisas num lugar só, porque as duas são a mesma pergunta ("este link
 * continua querendo dizer o que promete?"):
 *
 * 1. **Cavalo e carreta.** Um link que sai de uma leitura de cavalo e chega a
 *    Alterações mostrando a frota inteira mente sobre o que prometeu.
 *    `entityType` já é um filtro que aquela tela honra e que viaja na URL
 *    (`FILTROS_NA_URL`), então não há nada a inventar: basta escrevê-lo.
 * 2. **Trecho.** Alterações não lê trecho — a leitura agrupada o exclui na
 *    origem (ver `loadChanges`) —, então não há endereço a oferecer. O hook
 *    devolve `null`, e quem chama desenha texto em vez de link: prometer uma
 *    lista que viria vazia se leria como "nada mudou", que é falso.
 *
 * Fora da aba de tipo devolve `linkDeAlteracoes` sem acréscimo nenhum.
 */
export function useLinkDeAlteracoes():
  | ((destino: DestinoDeAlteracoes) => string)
  | null {
  const tipo = useTipoDaLinhaDoTempo();
  return useMemo(() => {
    if (tipo === "TRECHO") return null;
    if (tipo === null) return (destino: DestinoDeAlteracoes) => linkDeAlteracoes(destino);
    return (destino: DestinoDeAlteracoes) =>
      linkDeAlteracoes({
        ...destino,
        filtros: { ...destino.filtros, entityType: tipo },
      });
  }, [tipo]);
}
