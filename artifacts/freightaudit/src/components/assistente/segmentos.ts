/**
 * Onde uma cerca começa e onde ela termina.
 *
 * Vive fora do componente para poder ser exercitada sem montar React: é a
 * única parte da renderização que tem estado de máquina — abre, acumula,
 * fecha — e a única que quebra em silêncio. Uma cerca partida no meio não dá
 * erro em lugar nenhum; ela só faz aparecer `:::cards` como texto na tela de
 * quem perguntou.
 */

export type Segmento =
  | { tipo: "cerca"; nome: string; corpo: string }
  | { tipo: "texto"; nome?: undefined; corpo: string };

export function segmentar(texto: string): Segmento[] {
  const partes: Segmento[] = [];
  const linhas = texto.split("\n");
  let solto: string[] = [];
  let cerca: { nome: string; linhas: string[] } | null = null;

  const fecharSolto = () => {
    const corpo = solto.join("\n").trim();
    if (corpo) partes.push({ tipo: "texto", corpo });
    solto = [];
  };

  for (const linha of linhas) {
    const abre = /^:::\s*([a-zA-Z]+)\s*$/.exec(linha.trim());
    if (!cerca && abre) {
      fecharSolto();
      cerca = { nome: abre[1].toLowerCase(), linhas: [] };
      continue;
    }
    if (cerca && /^:::\s*$/.test(linha.trim())) {
      partes.push({ tipo: "cerca", nome: cerca.nome, corpo: cerca.linhas.join("\n").trim() });
      cerca = null;
      continue;
    }
    if (cerca) cerca.linhas.push(linha);
    else solto.push(linha);
  }

  /*
    Cerca sem fim é o caso normal, não o caso raro: enquanto o texto chega em
    fluxo, toda cerca está aberta por um instante. Fechá-la aqui faz o bloco
    aparecer montado desde a primeira linha, em vez de piscar como texto cru e
    virar cartão quando o fim chegar.
  */
  if (cerca) partes.push({ tipo: "cerca", nome: cerca.nome, corpo: cerca.linhas.join("\n").trim() });
  fecharSolto();

  return partes;
}

/** As formas que a tela sabe desenhar. O resto degrada para texto. */
export const FORMAS = ["cards", "cartoes", "abas"] as const;
