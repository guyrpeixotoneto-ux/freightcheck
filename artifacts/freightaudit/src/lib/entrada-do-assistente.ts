/**
 * O endereço do Assistente, **com o recorte de onde a pessoa está**.
 *
 * **O defeito que isto fecha.** Os dois links do produto para o Assistente eram
 * `/assistente` nu. Sem `scopeHash`, o servidor resolve o contexto pelo padrão —
 * `contexts[0]`, que é o de vigência mais recente. Quem estava olhando a tela de
 * Alterações de uma unidade e clicava no atalho passava a conversar sobre outra,
 * e a única pista disso era o rótulo do recorte acima da resposta, que quase
 * ninguém lê como um aviso.
 *
 * **Por que ler da URL e não de um store.** Porque é onde o recorte já mora em
 * todas as telas deste produto: elas o mantêm em `?scopeHash=&canal=&period=`
 * justamente para que o endereço seja compartilhável. Um store global para isto
 * seria uma segunda verdade sobre qual unidade está selecionada — e a primeira
 * já está no endereço.
 *
 * **Só os três parâmetros do recorte atravessam.** Copiar a query inteira
 * levaria junto filtros que só fazem sentido na tela de origem (um atributo, uma
 * placa, uma aba aberta) e faria o Assistente receber pedidos que ele não sabe
 * ler.
 */

/** As chaves que descrevem um recorte, e nenhuma outra. */
const DO_RECORTE = ["scopeHash", "canal", "period"] as const;

export function enderecoDoAssistente(buscaAtual: string): string {
  const atual = new URLSearchParams(
    buscaAtual.startsWith("?") ? buscaAtual.slice(1) : buscaAtual,
  );
  const levar = new URLSearchParams();
  for (const chave of DO_RECORTE) {
    const valor = atual.get(chave);
    if (valor) levar.set(chave, valor);
  }
  const qs = levar.toString();
  return qs ? `/assistente?${qs}` : "/assistente";
}
