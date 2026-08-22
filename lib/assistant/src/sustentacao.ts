/**
 * "Tem certeza?" — a pergunta sobre a **resposta anterior**, e não sobre o assunto.
 *
 * **O defeito, e por que ele é dos piores.** "Tem certeza?" caía no
 * classificador como qualquer outra frase: sem assunto reconhecido, sem
 * período, sem verbo de consulta. O plano padrão a mandava investigar o
 * recorte, e ela recebia de volta o movimento da vigência — um resumo correto
 * de outra coisa. Quem duvidou de uma conclusão recebeu um relatório, o que
 * lido de fora parece deboche e lido de dentro é o assistente não ter
 * entendido a pergunta.
 *
 * **O que ela pede.** Não é o número de novo: é a **qualidade daquela
 * conclusão**. Quatro coisas, separadas, porque quem audita precisa saber qual é
 * qual — o que veio direto do dado, o que foi calculado a partir dele, o que o
 * assistente concluiu ligando as duas, e o que ele não conseguiu provar.
 *
 * **Sobre o nível de sustentação.** Ele não é um score. "95% de confiança" seria
 * um número sem apuração numa aplicação cuja regra inteira é não ter número sem
 * apuração — e seria o número menos auditável da tela. Os quatro níveis daqui
 * têm critério fechado, escrito abaixo, e cada um é derivável do rastro sem
 * nenhuma opinião: quantas consultas houve, se alguma falhou, se a cadeia
 * desceu até a célula de origem, se houve lacuna declarada, se a trava podou
 * alguma frase.
 *
 * **Esta resposta é escrita em código, sempre.** É uma afirmação sobre a nossa
 * própria máquina — o que ela consultou, o que ela podou —, e um modelo
 * redigindo isso estaria descrevendo de memória um processo que ele não
 * observou. É a mesma regra das lacunas.
 */

import type { SustentacaoGuardada } from "./conversa";
import type { FocoDaConversa } from "./foco";

/**
 * Quanto a conclusão anterior se sustenta — por critério, nunca por score.
 *
 * A ordem é decrescente e os critérios são exclusivos: o primeiro que se
 * aplicar é o nível.
 */
export type NivelDeSustentacao =
  /**
   * **Comprovado diretamente.** A cadeia desceu até a origem do valor — a
   * célula da planilha que a importação registrou — e nada foi podado nem
   * declarado como lacuna. É o único nível em que "de onde saiu?" já está
   * respondido dentro da própria resposta.
   */
  | "COMPROVADO_DIRETAMENTE"
  /**
   * **Fortemente sustentado.** Toda afirmação saiu de consulta, nenhuma
   * consulta falhou, nenhuma frase foi podada e nenhuma lacuna foi declarada —
   * mas a cadeia parou antes da célula de origem. O número está apurado; a
   * planilha de onde ele veio não foi aberta.
   */
  | "FORTEMENTE_SUSTENTADO"
  /**
   * **Indicativo.** Houve consulta e houve buraco: uma lacuna declarada, uma
   * frase podada pela trava, ou uma consulta que falhou. A direção se sustenta;
   * a conclusão fechada, não.
   */
  | "INDICATIVO"
  /**
   * **Inconclusivo.** Nenhuma consulta sustentou a resposta, ou o que se
   * respondeu foi a própria falta. Não há o que confirmar.
   */
  | "INCONCLUSIVO";

export const CRITERIO: Record<NivelDeSustentacao, string> = {
  COMPROVADO_DIRETAMENTE:
    "a cadeia desceu até a célula da planilha que originou o valor, sem lacuna declarada e sem frase podada",
  FORTEMENTE_SUSTENTADO:
    "tudo saiu de consulta, nenhuma falhou, nada foi podado e nenhuma lacuna foi declarada — a origem na planilha não foi aberta",
  INDICATIVO:
    "houve consulta e houve buraco: lacuna declarada, frase podada pela trava, ou consulta que falhou",
  INCONCLUSIVO: "nenhuma consulta sustentou a resposta, ou o que se respondeu foi a própria falta",
};

/** As capacidades que descem até o arquivo — o que separa os dois níveis de cima. */
const CHEGA_NA_ORIGEM = /^(proveniencia|celulas|estado_do_dado)/;

export function nivelDe(s: SustentacaoGuardada): NivelDeSustentacao {
  if (s.evidencias === 0) return "INCONCLUSIVO";

  const falhou = s.consultas.some((c) => c.endsWith("(falhou)"));
  const buraco = s.lacunas.length > 0 || s.podadas.removidas > 0 || falhou;
  if (buraco) return "INDICATIVO";

  const desceu = s.consultas.some((c) => CHEGA_NA_ORIGEM.test(c));
  return desceu ? "COMPROVADO_DIRETAMENTE" : "FORTEMENTE_SUSTENTADO";
}

export interface RespostaDeSustentacao {
  nivel: NivelDeSustentacao;
  texto: string;
}

/** O nome do nível como ele aparece para quem lê. */
const ROTULO: Record<NivelDeSustentacao, string> = {
  COMPROVADO_DIRETAMENTE: "comprovado diretamente",
  FORTEMENTE_SUSTENTADO: "fortemente sustentado",
  INDICATIVO: "indicativo",
  INCONCLUSIVO: "inconclusivo",
};

/** A capacidade, escrita como quem opera a chamaria. */
function emPortugues(capacidade: string): string {
  const nome = capacidade.replace(/ \((falhou|sem evidência)\)$/, "");
  const mapa: Record<string, string> = {
    "alteracoes:total": "o total do movimento da vigência",
    "alteracoes:grupos": "os grupos de alteração, ordenados",
    "alteracoes:linhas": "as linhas de um grupo, veículo a veículo",
    proveniencia: "a origem do valor na planilha importada",
    ordenacao: "o ranking por impacto",
    veiculos: "os veículos afetados",
    resultado: "o resultado apurado da frota",
    serie: "a série do parâmetro ao longo das vigências",
    comparar: "a comparação entre duas vigências",
    parametros: "o cadastro do parâmetro",
    recortes: "as vigências e unidades disponíveis",
    documentos: "o que o Book do Operador registra",
    estado_do_dado: "o estado da importação e da curadoria",
  };
  const legivel =
    mapa[nome] ??
    Object.entries(mapa).find(([k]) => nome.startsWith(`${k}:`))?.[1] ??
    nome;
  if (capacidade.endsWith("(falhou)")) return `${legivel} — **esta consulta falhou**`;
  if (capacidade.endsWith("(sem evidência)")) return `${legivel} — voltou vazia`;
  return legivel;
}

/**
 * A resposta a "tem certeza?", montada do rastro da resposta anterior.
 *
 * Quatro seções fixas e uma linha de nível. Fixas de propósito: a pessoa que
 * pergunta isso quer sempre as mesmas quatro coisas, e uma estrutura que muda
 * de forma a cada turno obriga a reler para achar a limitação — que é a seção
 * mais importante das quatro.
 */
export function responderSustentacao(
  s: SustentacaoGuardada,
  foco: FocoDaConversa | null,
): RespostaDeSustentacao {
  const nivel = nivelDe(s);
  const linhas: string[] = [];

  linhas.push(
    `Sobre **"${s.conclusao}"** — e o que sustenta isso.`,
    "",
    `> [!info] Nível: **${ROTULO[nivel]}** — ${CRITERIO[nivel]}.`,
    "",
  );

  // ---- Fatos ---------------------------------------------------------------
  linhas.push("### Fatos");
  if (s.evidencias === 0) {
    linhas.push(
      "Nenhuma consulta sustentou aquela resposta. Não há fato a confirmar — o que houve foi a declaração de uma falta.",
    );
  } else {
    const recorte = [s.recorte, s.vigencia].filter(Boolean).join(" · ");
    linhas.push(
      `${s.evidencias} consulta(s) ao dado sustentaram a resposta${recorte ? `, em ${recorte}` : ""}:`,
      ...s.consultas.map((c) => `- ${emPortugues(c)}`),
    );
    if (foco?.valor) {
      linhas.push(
        "",
        `O número em discussão é **${foco.valor.escrito}**, de ${foco.rotulo}${foco.vigencia ? ` em ${foco.vigencia}` : ""}.`,
      );
    }
  }

  // ---- Cálculos ------------------------------------------------------------
  linhas.push("", "### Cálculos");
  const contas = s.consultas.filter((c) => c.startsWith("calculo:"));
  if (contas.length > 0) {
    linhas.push(
      "Houve composição sobre valores já apurados — a conta está escrita ao lado de cada resultado nas fontes:",
      ...contas.map((c) => `- ${c.replace("calculo:", "")}`),
    );
  } else {
    linhas.push(
      "Nenhuma conta foi feita sobre os valores: eles saíram das consultas como estão. " +
        "O impacto em dinheiro, quando aparece, é o que o motor de comparação apura — não uma soma minha.",
    );
  }

  // ---- Interpretação -------------------------------------------------------
  linhas.push("", "### Interpretação");
  linhas.push(
    `A leitura foi minha: ${s.redigiu === "IA" ? "escrevi o texto" : "o texto saiu da redação em código"}, ` +
      "ligando o que as consultas devolveram. Os números são das consultas; a conclusão de que eles " +
      "respondem à pergunta é uma leitura, e é ela que você está pondo em dúvida.",
  );
  if (s.encadeamentos > 0) {
    linhas.push(
      "",
      `A investigação teve ${s.encadeamentos} passo(s) em que uma consulta foi escolhida ` +
        "**a partir do resultado da anterior** — foi assim que ela desceu do agregado ao detalhe, e não " +
        "por eu ter decidido antes o que olhar.",
    );
  }

  // ---- Limitações ----------------------------------------------------------
  linhas.push("", "### Limitações");
  const limites: string[] = [];
  for (const l of s.lacunas) limites.push(l);
  if (s.podadas.removidas > 0) {
    limites.push(
      `${s.podadas.removidas} de ${s.podadas.total} frase(s) saíram da resposta por não terem lastro ` +
        "no que foi consultado — o que você leu é o que sobrou depois disso.",
    );
  }
  for (const c of s.consultas.filter((x) => x.endsWith("(falhou)"))) {
    limites.push(`${emPortugues(c)} — e nada foi concluído a partir dela.`);
  }
  if (nivel !== "COMPROVADO_DIRETAMENTE") {
    limites.push(
      "A origem do valor na planilha importada não foi aberta nesta resposta. " +
        "Peça \"de onde saiu esse número?\" e eu desço até o arquivo, a aba, a linha e a coluna.",
    );
  }
  linhas.push(limites.length > 0 ? limites.map((l) => `- ${l}`).join("\n") : "- Nenhuma que eu tenha detectado.");

  return { nivel, texto: linhas.join("\n") };
}

/**
 * A resposta quando não há resposta anterior nenhuma.
 *
 * Existe porque "tem certeza?" como primeira mensagem é uma pergunta sem
 * objeto, e responder qualquer coisa a ela seria inventar o que se está
 * confirmando.
 */
export function semRespostaAnterior(): string {
  return (
    "Não há uma resposta minha anterior nesta conversa para eu conferir. " +
    "Me faça a pergunta e, depois dela, eu abro o que sustentou a conclusão — " +
    "o que veio do dado, o que foi calculado, o que é leitura minha e o que eu não consegui provar."
  );
}
