import { ArrowRightLeft, Link2, Unlink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AtivoNaEvolucao, ComposicaoNoTempo } from "@/lib/evolucao-por-placa";

/**
 * A linha do tempo da composição — **onde a troca de carreta fica evidente**.
 *
 * Um conjunto não é um cadastro: ele é o par que o arquivo declarou naquela
 * vigência, e ele muda. No acervo real, 5 dos 64 cavalos trocaram de carreta em
 * maio/2026. Sem este bloco, a matriz mostraria duas linhas com o mesmo cavalo
 * e nada explicando por que a primeira parou e a segunda começou — que é a
 * leitura mais fácil de errar desta aba.
 *
 * Três estados, e nenhum deles é o vazio do outro:
 *
 * - **junto** (azul, corrente): esta composição estava de pé naquela vigência;
 * - **com outro** (âmbar, setas): o cavalo estava com outra carreta, e o nome
 *   dela está escrito — é onde a troca aparece;
 * - **sem composição** (cinza, corrente partida): o par não existia ali, e não
 *   houve outro no lugar.
 */
export function ComposicaoNoTempoDoPar({
  composicao,
  ativo,
}: {
  composicao: ComposicaoNoTempo[];
  ativo: AtivoNaEvolucao;
}) {
  if (composicao.length === 0) return null;

  const juntos = composicao.filter((c) => c.juntos).length;
  const trocas = composicao.filter((c) => c.outraCarreta !== null);

  return (
    <div className="mt-5">
      <p className="text-sm font-semibold">Composição ao longo do tempo</p>
      <p className="text-xs text-muted-foreground">
        {juntos === composicao.length
          ? "Este par esteve junto em todas as vigências do período."
          : `Este par esteve junto em ${juntos} de ${composicao.length} vigências.`}
        {trocas.length > 0 &&
          ` Nas demais, ${ativo.componentes?.cavalo?.plate ?? "o cavalo"} operou com outra carreta.`}
      </p>

      <ol className="mt-2 space-y-1">
        {composicao.map((ponto) => (
          <li
            key={ponto.period}
            className={cn(
              "flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs",
              ponto.juntos
                ? "border-primary/30 bg-primary/5"
                : ponto.outraCarreta !== null
                  ? "border-amber-200 bg-amber-50"
                  : "border-dashed text-muted-foreground",
            )}
          >
            {ponto.juntos ? (
              <Link2 className="w-3.5 h-3.5 shrink-0 text-primary" />
            ) : ponto.outraCarreta !== null ? (
              <ArrowRightLeft className="w-3.5 h-3.5 shrink-0 text-amber-600" />
            ) : (
              <Unlink className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="font-medium">{ponto.label}</span>
            <span className="ml-auto text-right">
              {ponto.juntos ? (
                "juntos"
              ) : ponto.outraCarreta !== null ? (
                <span className="text-amber-800">com {ponto.outraCarreta}</span>
              ) : (
                "sem esta composição"
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * O aviso de composição ambígua — duas placas disputando o mesmo par.
 *
 * Não acontece no acervo real (medido: zero ocorrências nas nove vigências), e
 * é justamente por isso que ele precisa existir: no dia em que acontecer, a
 * leitura **desfaz** aqueles pares para não contar a mesma carreta em dois
 * conjuntos, e o total da aba fica menor sem que nada na tela explique. Este
 * bloco é a explicação.
 */
export function AmbiguidadesDaComposicao({
  ambiguidades,
}: {
  ambiguidades: { period: string; declarado: string; declarantes: number }[];
}) {
  if (ambiguidades.length === 0) return null;

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-semibold">
        {ambiguidades.length}{" "}
        {ambiguidades.length === 1
          ? "composição ficou ambígua"
          : "composições ficaram ambíguas"}{" "}
        e {ambiguidades.length === 1 ? "foi desfeita" : "foram desfeitas"}.
      </p>
      <p className="mt-1 text-amber-800">
        Mais de um cavalo declarou a mesma carreta na mesma vigência. Somar os dois
        pares contaria a carreta duas vezes, então cada lado aparece sozinho até o
        vínculo ser corrigido na origem:{" "}
        {ambiguidades
          .slice(0, 4)
          .map((a) => `${a.declarado} (${a.declarantes} cavalos, ${a.period})`)
          .join("; ")}
        {ambiguidades.length > 4 && ` e mais ${ambiguidades.length - 4}`}.
      </p>
    </section>
  );
}
