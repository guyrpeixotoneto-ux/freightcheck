import type { AbaDeUltimasAlteracoes } from "@workspace/comparison/ultima-alteracao-financeira";
import { AbaBotao } from "@/components/changes/cartoes";
import {
  CartaoDeUltimaAlteracaoView,
  type AcoesDoCartao,
} from "@/components/alteracoes-por-modulo/cartao-de-ultima-alteracao";

/**
 * AS TRÊS ABAS — e a faixa que diz, antes de qualquer cartão, que eles não
 * estão todos no mesmo par.
 *
 * ---------------------------------------------------------------------------
 * Por que a aba é navegação, e não um estado a mais
 * ---------------------------------------------------------------------------
 * A aba escolhe **o que se olha**, e nada mais: ela não tem par próprio, não
 * escreve nada no endereço do motor e não muda pergunta nenhuma. Foi a recusa
 * desta tela desde o começo — uma aba com seletor próprio faria trocar o par em
 * Custo Fixo mudar, em silêncio, o cartão da Manutenção na aba vizinha, porque
 * as duas leem a **mesma** cobertura de equipamento.
 *
 * O que a aba tem de seu é a faixa: quantos períodos distintos os cartões dela
 * comparam. É a frase que torna a promessa da tela verificável antes de alguém
 * ler um cartão — "7 cartões · 2 períodos distintos" diz que dois deles estão
 * atrasados, e a ordenação põe os atrasados no fim.
 */
export function AbasDeUltimasAlteracoes({
  abas,
  aberta,
  onAbrir,
  acoes,
}: {
  abas: readonly AbaDeUltimasAlteracoes[];
  aberta: string;
  onAbrir: (area: string) => void;
  acoes: AcoesDoCartao;
}) {
  const atual = abas.find((a) => a.area === aberta) ?? abas[0];
  if (!atual) return null;

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex flex-wrap items-center gap-1 border-b" role="tablist">
        {abas.map((a) => (
          <AbaBotao
            key={a.area}
            active={a.area === atual.area}
            onClick={() => onAbrir(a.area)}
            label={`${a.rotulo} (${a.cartoes.length})`}
            hint={a.descricao}
          />
        ))}
      </nav>

      <FaixaDaAba aba={atual} />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {atual.cartoes.map((cartao) => (
          <CartaoDeUltimaAlteracaoView
            key={`${cartao.cobertura}:${cartao.modulo}`}
            cartao={cartao}
            acoes={acoes}
            maisRecenteDaAba={atual.comparadaMaisRecente}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A faixa de resumo da aba.
 *
 * Ela não soma dinheiro — e a ausência é deliberada. Um total de aba precisaria
 * atravessar periodicidades (R$/mês com R$/ano) e, pior, **períodos**: os
 * cartões desta aba comparam pares diferentes, e somá-los daria um número que
 * não corresponde a nenhum intervalo do acervo. O que a faixa conta é o que ela
 * pode contar com verdade — quantos módulos se moveram, em quantos períodos.
 */
function FaixaDaAba({ aba }: { aba: AbaDeUltimasAlteracoes }) {
  const comMovimento = aba.cartoes.filter(
    (c) => c.estado === "COM_MOVIMENTO_FINANCEIRO" || c.movimento.alteracoes > 0,
  ).length;
  const comLacuna = aba.cartoes.filter((c) => c.estado === "LACUNA_DE_CALCULO").length;

  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md bg-accent/60 px-3 py-2 text-xs">
      <span className="font-semibold">
        {comMovimento} de {aba.cartoes.length}{" "}
        {aba.cartoes.length === 1 ? "módulo se moveu" : "módulos se moveram"}
      </span>
      <span className="text-muted-foreground">
        {aba.periodosDistintos === 0
          ? "nenhum período comparado"
          : aba.periodosDistintos === 1
            ? "1 período"
            : `${aba.periodosDistintos} períodos distintos`}
        {aba.comparadaMaisRecente && ` · mais recente ${aba.comparadaMaisRecente}`}
      </span>
      {comLacuna > 0 && (
        <span className="text-muted-foreground">
          {comLacuna} {comLacuna === 1 ? "cartão espera" : "cartões esperam"} cálculo
        </span>
      )}
      <span className="ml-auto text-muted-foreground">
        Cada cartão compara o próprio par.
      </span>
    </div>
  );
}
