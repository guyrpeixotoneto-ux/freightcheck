/**
 * A identidade legível, lida de volta em campos — um fato por casa.
 *
 * ---------------------------------------------------------------------------
 * Por que este arquivo existe
 * ---------------------------------------------------------------------------
 * A importação emenda a identidade de uma linha numa string só:
 * `07526557001505_CERV · Cargo: Conferente | Classificação: CARREGAMENTO`. É a
 * forma legível da chave (`entity_key_raw`, e daí `identifier_value_raw`), e
 * ela viaja assim por todo o produto — o Quadro, a Evolução, a Auditoria, a
 * Comparação, o Monitor e a matriz de Compras leem a mesma string.
 *
 * O que cada uma dessas telas fazia era refatiá-la à mão, e sempre no primeiro
 * ` · `: o que sobrava caía inteiro numa coluna chamada "Cargo", que por isso
 * não se filtrava, não se ordenava e ainda escondia dois fatos — a
 * classificação, que a fonte escreve grudada dentro da célula, e o turno, que
 * é uma **terceira** coluna de identidade no QLP Operacional.
 *
 * Aqui a leitura acontece uma vez e com o que a importação já sabe: a lista de
 * colunas de identidade do tipo (`tipos.ts`), na mesma ordem em que a chave foi
 * emendada. É a mesma regra que `registroDoTipo` usa nos apontamentos —
 * `pipeline.ts` passou a chamar esta função em vez de repeti-la.
 *
 * ---------------------------------------------------------------------------
 * O que ele não faz
 * ---------------------------------------------------------------------------
 * **Não inventa estrutura.** Uma célula só se abre em campos quando ela própria
 * se rotula, e a coluna só cede o lugar ao campo que repete o nome dela: numa
 * coluna "Cargo", `AUX: ADM` continua sendo o cargo `AUX: ADM`, porque
 * dois-pontos no meio de um nome é pontuação.
 *
 * **Não descarta.** O que vem rotulado e não tem coluna própria continua na
 * lista, com o rótulo que a fonte lhe deu.
 *
 * **Não conserta a fonte.** O dado gravado não muda — inclusive o prefixo
 * repetido que o arquivo real traz (`Classificação: Classificação: …`), que
 * aqui só deixa de aparecer duas vezes na tela. Quem conserta o arquivo é quem
 * o emite; quem o lê direito é esta função.
 */
import { SEPARADOR_LEGIVEL, tipoDeImportacao, type ColunaIdentificadora } from "./tipos";

/** Um fato da identidade, com o nome que a fonte (ou a coluna) lhe deu. */
export interface CampoLegivel {
  rotulo: string;
  valor: string;
}

/**
 * A identidade de uma linha, desmembrada.
 *
 * `unidade` sai da coluna de documento, quando o tipo tem uma — é o CNPJ (com a
 * rubrica, quando o arquivo a escreve), e não um nome de unidade. `principal` é
 * o primeiro campo que **nomeia** a linha: o cargo no quadro de pessoal, a
 * placa no equipamento. O resto vai em `campos`, na ordem da fonte.
 */
export interface IdentidadeLegivel {
  unidade: string;
  principal: string;
  campos: CampoLegivel[];
}

/** A dobra de sempre para comparar rótulo: sem acento, sem caixa, sem borda. */
function dobrar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Os campos que uma célula traz rotulados — `Cargo: X | Classificação: Y`.
 *
 * Devolve vazio quando nenhuma parte se rotula: aí a célula é um texto só, e
 * abri-la seria inventar. Uma parte sem rótulo no meio de outras rotuladas
 * entra com rótulo vazio, porque perdê-la seria pior do que não saber o nome
 * dela.
 *
 * O prefixo repetido do arquivo (`Classificação: Classificação: CARREGAMENTO`)
 * cai quantas vezes vier — é o arquivo, não um erro de leitura nosso.
 */
export function camposDoTexto(texto: string): CampoLegivel[] {
  const partes = texto
    .split("|")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  const campos: CampoLegivel[] = [];
  let algumRotulado = false;
  for (const parte of partes) {
    const casa = parte.match(/^([^:]{1,40}):\s*(.+)$/s);
    if (!casa) {
      campos.push({ rotulo: "", valor: parte });
      continue;
    }
    algumRotulado = true;
    const rotulo = casa[1].trim();
    const repetido = new RegExp(
      `^${rotulo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*`,
      "i",
    );
    let valor = casa[2].trim();
    while (repetido.test(valor)) valor = valor.replace(repetido, "").trim();
    campos.push({ rotulo, valor });
  }
  return algumRotulado ? campos : [];
}

/**
 * O que uma coluna traz, quando a célula dela vem com mais de um fato dentro.
 *
 * A coluna só cede o lugar ao campo que **repete o nome dela**: é o que separa
 * `Cargo: Conferente | Classificação: …`, que a fonte rotulou, de `AUX: ADM`,
 * que é um nome com dois-pontos no meio. Sem essa correspondência, o texto fica
 * inteiro na coluna — abrir seria inventar estrutura.
 */
export function camposDaColuna(rotulo: string, valor: string): CampoLegivel[] {
  const dentro = camposDoTexto(valor);
  if (rotulo === "") {
    /*
      Sem nome de coluna não há o que reconhecer, e aí o critério é a forma: uma
      lista de dois ou mais campos, todos rotulados, é uma lista de campos —
      `Cargo: Manobrista | Classificação: CARREGAMENTO`. Um só, ou um com parte
      solta, fica inteiro: `AUX: ADM` é um nome com dois-pontos no meio.
    */
    const lista = dentro.length >= 2 && dentro.every((c) => c.rotulo !== "");
    return lista ? dentro : [{ rotulo, valor }];
  }
  const proprio = dentro.findIndex((c) => dobrar(c.rotulo) === dobrar(rotulo));
  if (proprio < 0) return [{ rotulo, valor }];
  const [meu] = dentro.splice(proprio, 1);
  return [{ rotulo, valor: meu.valor }, ...dentro];
}

/**
 * As partes da chave legível, casadas com as colunas de identidade do tipo.
 *
 * O casamento só vale quando o número de partes bate com o número de colunas:
 * uma chave de outra versão do tipo, com outro número de pedaços, viraria
 * rótulo trocado — e rótulo trocado é pior do que rótulo ausente. Sem
 * casamento, cada parte volta sem coluna, e quem chama decide o que fazer.
 */
export function partesDaIdentidade(
  entityType: string | null | undefined,
  legivel: string,
): { coluna: ColunaIdentificadora | null; valor: string }[] {
  const partes = legivel.split(SEPARADOR_LEGIVEL);
  const identidade = tipoDeImportacao(entityType)?.identidade ?? [];
  if (identidade.length > 0 && identidade.length === partes.length) {
    return identidade.map((coluna, i) => ({ coluna, valor: partes[i] }));
  }
  return partes.map((valor) => ({ coluna: null, valor }));
}

/** Como uma coluna de identidade se chama numa tela. O cabeçalho da planilha na falta dele. */
function rotuloDaColuna(coluna: ColunaIdentificadora): string {
  return coluna.rotulo ?? coluna.sourceName;
}

/**
 * A chave legível inteira, em campos.
 *
 * Sem o tipo — ou com uma chave que não casa com ele — a leitura ainda funciona
 * pela forma: a primeira parte é a unidade quando há mais de uma, e a segunda
 * nomeia a linha. É menos precisa e continua honesta; o que ela nunca faz é
 * dar a um pedaço o nome do pedaço ao lado.
 */
export function lerIdentidade(
  legivel: string,
  entityType?: string | null,
): IdentidadeLegivel {
  const partes = partesDaIdentidade(entityType, legivel);
  const campos: CampoLegivel[] = [];
  let unidade = "";
  let principal: string | null = null;

  partes.forEach(({ coluna, valor }, i) => {
    const documento = coluna
      ? coluna.normalizacao === "DOCUMENTO"
      : i === 0 && partes.length > 1;
    if (documento && unidade === "") {
      unidade = valor;
      return;
    }
    const rotulo = coluna ? rotuloDaColuna(coluna) : "";
    const [meu, ...dentro] = camposDaColuna(rotulo, valor);
    if (principal === null) principal = meu.valor;
    else campos.push(meu);
    campos.push(...dentro);
  });

  return { unidade, principal: principal ?? "", campos };
}

/** O valor de um campo pelo rótulo, ou `null` quando a fonte não o trouxe. */
export function campoDaIdentidade(
  identidade: IdentidadeLegivel,
  rotulo: string,
): string | null {
  const alvo = dobrar(rotulo);
  return identidade.campos.find((c) => dobrar(c.rotulo) === alvo)?.valor ?? null;
}

/** Os campos que sobram depois de tirar os que já têm coluna própria. */
export function camposFora(
  identidade: IdentidadeLegivel,
  rotulos: string[],
): CampoLegivel[] {
  const fora = rotulos.map(dobrar);
  return identidade.campos.filter((c) => !fora.includes(dobrar(c.rotulo)));
}
