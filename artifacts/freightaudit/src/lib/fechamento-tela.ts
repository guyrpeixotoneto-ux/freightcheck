import type { Documento, DocumentoRecebido } from "@/lib/fechamento";

/**
 * O que a tela do Fechamento decide antes de desenhar — e as chaves com que ela
 * pergunta.
 *
 * Duas decisões moram aqui pelo mesmo motivo: as duas eram tomadas dentro do
 * JSX, onde não dá para testá-las, e as duas erravam de um jeito que só
 * aparecia com o produto na mão.
 */

/**
 * A chave de tudo que se pergunta sobre uma competência.
 *
 * **O defeito que isto fecha.** O painel da planilha era
 * `["fechamento", "painel", id]` — **irmão** da competência, e não filho dela.
 * Toda invalidação do produto invalida `["fechamento", "competencia", id]`, e
 * nenhuma delas alcançava o painel: quem subia o 03.08.20 com a aba `Planilha`
 * aberta via a lista de relatórios ganhar o visto verde e o painel, um cartão
 * abaixo, continuar dizendo que o arquivo não tinha sido importado — a resposta
 * que ele buscara **antes** de o arquivo existir. Duas afirmações opostas sobre
 * o mesmo arquivo, na mesma tela, e as duas verdadeiras no instante em que foram
 * buscadas.
 *
 * O painel volta a si sozinho quando a aba é trocada e ele remonta, o que faz o
 * defeito parecer intermitente: ele dura enquanto quem enviou continuar olhando
 * para a aba `Planilha` — que é exatamente quando alguém está esperando o
 * arquivo aparecer.
 *
 * O descarte tinha o mesmo buraco pelo outro lado: apagava tudo e deixava o
 * painel na tela, com os números da competência que acabara de esvaziar.
 *
 * **Acrescentar a chave do painel àquelas invalidações resolveria aquele caso e
 * nenhum futuro** — a próxima consulta sobre a competência nasceria irmã de
 * novo, e quem a escrevesse não teria como saber que precisava se lembrar de
 * três lugares. O que fecha a porta é a chave ser derivada: tudo que se pergunta
 * sobre uma competência pendura-se em {@link chaveDaCompetencia}, e uma
 * invalidação dela alcança o que existe hoje e o que for escrito amanhã.
 */
export function chaveDaCompetencia(id: string): readonly [string, string, string] {
  return ["fechamento", "competencia", id];
}

/** O painel da planilha da competência — filho, para não poder ser esquecido. */
export function chaveDoPainel(id: string): readonly [string, string, string, string] {
  return [...chaveDaCompetencia(id), "painel"];
}

/** A grade de dias da competência — pelo mesmo motivo. */
export function chaveDoDiario(id: string): readonly [string, string, string, string] {
  return [...chaveDaCompetencia(id), "diario"];
}

/** Um dia da operação da competência — pelo mesmo motivo. */
export function chaveDoDia(id: string, dia: string): readonly [string, string, string, string, string] {
  return [...chaveDaCompetencia(id), "dia", dia];
}

/**
 * O diagnóstico de um documento — e este **não** é filho da competência, de
 * propósito.
 *
 * Ele responde sobre os bytes de um arquivo já guardado, que não mudam nunca:
 * pendurá-lo na competência o faria ser buscado de novo a cada envio, para
 * devolver exatamente a mesma resposta sobre exatamente os mesmos bytes.
 */
export function chaveDoDiagnostico(documentoId: string): readonly [string, string, string, string] {
  return ["fechamento", "documento", documentoId, "diagnostico"];
}

/**
 * O que a lista de relatórios diz sobre uma fonte.
 *
 * Três estados, e o do meio é o que faltava:
 *
 * - `AUSENTE` — nenhum documento vigente. A linha oferece "Enviar".
 * - `SEM_VERBA` — há documento vigente, e ele é um 03.08.20 que não sustenta
 *   verba nenhuma. O arquivo chegou; o que ele deveria abrir, não abriu.
 * - `IMPORTADA` — há documento vigente e ele produz o que se espera dele.
 *
 * **Por que `SEM_VERBA` não é `IMPORTADA`.** O visto verde diz "esta fonte está
 * no lugar". Um demonstrativo sem verba não está: ele é a única fonte que abre a
 * parcela fixa, e sem verba não abre nada. Dar-lhe o mesmo visto das outras foi
 * o que pôs, na mesma tela, a lista dizendo que o arquivo chegou e o painel
 * dizendo que não.
 *
 * **E por que não é `AUSENTE`.** Porque o arquivo está lá, com nome e data, e
 * uma tela que o esconde manda reenviar o que já foi enviado — que é a forma
 * mais rápida de alguém importá-lo duas vezes.
 */
export type EstadoDaFonte = "AUSENTE" | "IMPORTADA" | "SEM_VERBA";

export function estadoDaFonte(documento: Documento | undefined): EstadoDaFonte {
  if (!documento) return "AUSENTE";
  /* `verbas` é `null` nas cinco fontes que não têm verba a ter — e `null` não é
     zero: perguntar `!documento.verbas` acusaria todas elas. */
  return documento.verbas === 0 ? "SEM_VERBA" : "IMPORTADA";
}

/**
 * O que dizer depois de um envio que o servidor aceitou.
 *
 * `null` quando o arquivo foi promovido — o silêncio é a resposta certa para o
 * que deu certo, e a lista já mostra o resultado. Quando ele ficou em
 * quarentena, a tela **precisa** falar: o `202` é `ok` para o `fetch` e não é
 * sucesso, e tratá-lo como o `201` foi o que fez alguém subir o 03.08.20, não
 * ver aviso nenhum, e concluir que estava importado.
 */
export interface AvisoDoEnvio {
  nomeDoArquivo: string;
  motivo: string;
}

export function avisoDoEnvio(recebido: DocumentoRecebido): AvisoDoEnvio | null {
  if (recebido.desfecho !== "EM_QUARENTENA") return null;
  return {
    nomeDoArquivo: recebido.nomeDoArquivo,
    /* O servidor é quem leu o arquivo; a tela não inventa motivo. A frase de
       reserva existe para o dia em que uma quarentena nova esquecer de escrever
       a sua — dizer "chegou e não valeu" ainda é verdade. */
    motivo:
      recebido.motivoDaQuarentena ??
      "O arquivo foi guardado e não virou a conta desta quinzena.",
  };
}
