/**
 * O RECORTE DO HISTÓRICO — o que um link de "Ver histórico" carrega, e o que a
 * Linha do Tempo faz com ele.
 *
 * ---------------------------------------------------------------------------
 * Por que este arquivo existe
 * ---------------------------------------------------------------------------
 * "Ver histórico", no cartão de última alteração, promete abrir a Linha do
 * Tempo **já filtrada** — pela unidade, pela cobertura, pelo módulo e pelo
 * intervalo. Uma promessa dessas se quebra de um jeito silencioso: acrescentam-se
 * parâmetros ao endereço, a outra tela não os lê, e ela abre inteira. Ninguém vê
 * erro; o filtro simplesmente não existe.
 *
 * Então as duas pontas moram aqui, uma ao lado da outra: `enderecoDoHistorico`
 * escreve, `lerRecorteDoHistorico` lê. Quem acrescentar um recorte novo numa
 * ponta vê imediatamente a outra.
 *
 * ---------------------------------------------------------------------------
 * O que **não** viaja, e por quê
 * ---------------------------------------------------------------------------
 * **A entidade.** Um cartão de módulo não tem uma: ele fala de dez veículos, de
 * oitenta e oito trechos, de dezesseis assuntos. Mandar `entityId` num link de
 * cartão seria inventar um recorte que nenhum cartão tem — e a tela de ativo
 * único já existe, a um clique, pela Evolução por Placa. Quando um cartão passar
 * a ter entidade (o dia em que houver cartão por placa), é aqui que ela entra.
 *
 * **Código de atributo.** O que a Linha do Tempo recorta é `FAMÍLIA|parâmetro`,
 * e quem traduz é o servidor (`parametrosDoHistorico`). A tela repassa o que
 * recebeu e não monta chave nenhuma.
 */

/** O recorte que o endereço da Linha do Tempo pode carregar. */
export interface RecorteDoHistorico {
  /** A ponta inicial do intervalo. `null` abre no histórico inteiro. */
  de: string | null;
  /** Os `parameterKey`s do módulo. Vazio abre sem recorte de parâmetro. */
  parametros: string[];
  /** O rótulo do que está filtrado, para a tela poder dizer e poder desfazer. */
  rotulo: string | null;
}

export const SEM_RECORTE_DO_HISTORICO: RecorteDoHistorico = {
  de: null,
  parametros: [],
  rotulo: null,
};

/** Uma data do acervo — `YYYY-MM-DD`, como o endereço as escreve. */
function data(valor: string | null): string | null {
  return valor !== null && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : null;
}

/**
 * O recorte pedido no endereço.
 *
 * Um endereço adulterado cai na leitura inteira, e não numa tela quebrada nem —
 * pior — numa leitura vazia que se pareceria com "não houve alteração nenhuma".
 * É a mesma doutrina de `ehTipoDaLinhaDoTempo`.
 */
export function lerRecorteDoHistorico(search: string): RecorteDoHistorico {
  const p = new URLSearchParams(search);
  const bruto = p.get("parametros") ?? "";
  return {
    de: data(p.get("de")),
    parametros: bruto
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    rotulo: p.get("recorte")?.trim() || null,
  };
}

/** O que um cartão de última alteração sabe sobre o histórico dele. */
export interface HistoricoDoCartao {
  rotulo: string;
  parametrosDoHistorico: readonly string[];
  tipoDoHistorico: string | null;
  par: { baseData: string | null; comparadaData: string | null } | null;
}

/**
 * O endereço de "Ver histórico" — a Linha do Tempo recortada neste módulo.
 *
 * As pontas do intervalo são as do **par do cartão**, e não o histórico inteiro:
 * quem clica em "Ver histórico" no cartão do IPVA quer ver o que aconteceu até a
 * alteração que o cartão está mostrando, com ela dentro.
 */
export function enderecoDoHistorico(
  cartao: HistoricoDoCartao,
  contexto: { scopeHash: string | null; canal: string | null },
): string {
  const q = new URLSearchParams();
  if (contexto.scopeHash) q.set("scopeHash", contexto.scopeHash);
  if (contexto.canal) q.set("canal", contexto.canal);
  if (cartao.tipoDoHistorico) q.set("tipo", cartao.tipoDoHistorico);
  if (cartao.par?.baseData) q.set("de", cartao.par.baseData);
  /* `period` é a ponta final na Linha do Tempo — o nome dela naquele endereço,
     e não um segundo parâmetro nosso. */
  if (cartao.par?.comparadaData) q.set("period", cartao.par.comparadaData);
  if (cartao.parametrosDoHistorico.length > 0) {
    q.set("parametros", [...cartao.parametrosDoHistorico].join(","));
    /* O rótulo viaja para a outra tela poder **dizer** o que está filtrado. Um
       filtro invisível é indistinguível de um acervo pequeno. */
    q.set("recorte", cartao.rotulo);
  }
  const texto = q.toString();
  return texto ? `/linha-do-tempo?${texto}` : "/linha-do-tempo";
}
