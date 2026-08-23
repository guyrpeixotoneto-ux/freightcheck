import type { Apresentacao } from "@/lib/apresentar-erro";

/**
 * O que quem investiga precisa, onde quem só quer usar o produto não esbarra.
 *
 * ---------------------------------------------------------------------------
 * Por que fechado, e por que não escondido
 * ---------------------------------------------------------------------------
 * As duas coisas são diferentes, e a distância entre elas é o desenho inteiro
 * desta caixa. **Escondido** seria apagar: quem opera o ambiente perderia o
 * nome da migration que falta e o comando que a aplica, que é a única coisa que
 * de fato resolve. **Fechado** é o que se tem aqui — a informação está a um
 * clique, no mesmo aviso, sem ocupar a linha que se lê com pressa.
 *
 * O caso que motivou isto está na tela de login: um parágrafo vermelho de doze
 * linhas nomeando `0053_rastro_da_resposta`, `0054_regra_de_alteracao` e
 * `0055_disponibilidade_por_frota`, com `pnpm --filter @workspace/db run
 * migrate` no meio, entregue a quem tinha digitado a senha certa. Tudo aquilo
 * era verdade e nada daquilo era para aquela pessoa.
 *
 * `<details>` do próprio HTML, e não um estado de React: abre e fecha sem
 * JavaScript, é acessível por padrão, e o conteúdo fica no DOM — quem precisa
 * copiar o texto para um chamado consegue, inclusive com a busca do navegador.
 */
export function DetalhesTecnicos({
  detalhes,
  className,
}: {
  detalhes: Apresentacao["detalhes"];
  className?: string;
}) {
  if (detalhes.length === 0) return null;

  return (
    <details className={className}>
      <summary className="text-xs cursor-pointer select-none opacity-80 hover:opacity-100">
        Detalhes técnicos
      </summary>
      <dl className="mt-2 space-y-1.5">
        {detalhes.map((linha) => (
          <div key={`${linha.rotulo}:${linha.texto}`} className="text-xs">
            <dt className="font-medium opacity-70">{linha.rotulo}</dt>
            <dd className="mt-0.5">
              {linha.comando ? (
                /*
                  O que se copia sai em `select-all`: um comando transcrito à
                  mão é um comando digitado errado, e o identificador da
                  requisição existe justamente para ser passado adiante.
                */
                <code className="font-mono break-all select-all">
                  {linha.texto}
                </code>
              ) : (
                <span className="break-words">{linha.texto}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
