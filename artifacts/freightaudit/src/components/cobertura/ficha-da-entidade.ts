import type { EntidadeAusente } from "./tipos";

/**
 * O caminho da Cobertura até a ficha de um equipamento ausente.
 *
 * Existe como função, e não como template no JSX, porque a mesma travessia é
 * oferecida em dois lugares — a gaveta do atributo e o detalhe da célula — e
 * duas construções da mesma URL divergem no dia em que uma delas ganha um
 * parâmetro. É também o que torna a regra de destino conferível sem montar a
 * tela.
 *
 * ---------------------------------------------------------------------------
 * Por que este caminho precisou existir
 * ---------------------------------------------------------------------------
 * A Cobertura lista placas que continuam sendo cobradas e o `entityId` estava
 * ali, sem virar link. Quem quisesse olhar a placa ia procurá-la na Composição
 * — onde ela legitimamente não está, porque a Composição responde pelo que veio
 * no mês — e concluía que a cobrança não tinha lastro. A informação existia; o
 * caminho não.
 *
 * ---------------------------------------------------------------------------
 * As duas decisões de destino
 * ---------------------------------------------------------------------------
 * **A vigência é a última em que o equipamento apareceu**, e não a da célula
 * que o leitor está olhando. Na vigência da célula ele não veio: a ficha abriria
 * sem componente nenhum, e o leitor precisaria de um segundo salto para achar o
 * mês em que há o que ver. `ultimaVigencia` põe o leitor direto na última
 * fotografia real do equipamento, com o histórico ao lado mostrando a queda.
 *
 * Quando não há `ultimaVigencia` — o equipamento declarado `ESPERADA` que
 * nenhuma vigência jamais entregou — o destino é a vigência da célula. Não há
 * mês melhor, e a ficha diz que ele não veio, que é a resposta certa.
 *
 * **O recorte viaja junto.** A ficha resolve contexto sozinha quando não recebe
 * nenhum, e o padrão dela é o contexto mais recente — que não é necessariamente
 * a unidade da célula. Sem `scopeHash` e `canal`, clicar numa placa da unidade
 * de Uberlândia podia abrir a ficha dela na unidade de Betim.
 */
export function caminhoDaFicha(
  ausente: Pick<EntidadeAusente, "entityId" | "ultimaVigencia">,
  vigencia: { effectiveDate: string; scopeHash: string; canal: string },
): string {
  const period = ausente.ultimaVigencia ?? vigencia.effectiveDate;
  const query = new URLSearchParams({
    period,
    scopeHash: vigencia.scopeHash,
    canal: vigencia.canal,
  });
  return `/composicao/${ausente.entityId}?${query.toString()}`;
}

/**
 * O que o leitor lê ao pousar o cursor sobre a placa.
 *
 * A frase muda com a origem porque as duas ausências são diferentes: a de
 * continuidade tem "desde quando" e a declarada tem "quem disse e por quê". Uma
 * frase só para as duas diria "apareceu em 0 vigência(s) anterior(es); a última
 * foi null" no caso declarado, que é a tela admitindo que não sabe do que está
 * falando.
 */
export function tituloDaPlacaAusente(ausente: EntidadeAusente): string {
  if (ausente.ultimaVigencia === null) {
    const motivo = ausente.motivo ? ` Motivo declarado: ${ausente.motivo}` : "";
    return (
      `Declarada esperada em Curadoria e nunca entregue por nenhuma vigência ` +
      `deste recorte.${motivo}`
    );
  }
  const vezes = ausente.vigenciasComDado === 1 ? "1 vigência anterior" : `${ausente.vigenciasComDado} vigências anteriores`;
  const declarada =
    ausente.origem === "DECLARACAO" && ausente.motivo
      ? ` Declarada esperada em Curadoria: ${ausente.motivo}`
      : "";
  return (
    `Apareceu em ${vezes}; a última foi ${ausente.ultimaVigencia}. ` +
    `Abre a ficha nessa vigência.${declarada}`
  );
}
