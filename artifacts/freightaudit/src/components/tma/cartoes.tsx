import { ArrowLeftRight, DoorOpen, MapPin, Scale, Timer, TriangleAlert } from "lucide-react";
import { CartaoDeIndicador } from "@/components/ui/cartao-de-indicador";
import { formatNumber } from "@/lib/format";
import {
  ROTULO_DA_PORTA,
  escreverDiferencaDeTempo,
  escreverFracao,
  escreverMinutos,
  type ComparacaoDeTma,
} from "@/lib/tma";

/**
 * Os seis indicadores do topo — e as duas médias que nunca viram uma.
 *
 * Nenhum número é calculado aqui: todos saem de `resumoPorVigencia`, no núcleo,
 * que é o mesmo que alimenta os painéis e as duas tabelas. O que este componente
 * decide é ordem, ícone e cor.
 *
 * **Há dois cartões de tempo onde uma tela descuidada teria um.** Carregar e
 * descarregar são operações diferentes — o dicionário da tabela de frete as
 * define com palavras diferentes —, e um "TMA médio" único exigiria somar as
 * duas e dividir por dois, o que descreveria uma espera que não acontece em
 * lugar nenhum.
 *
 * **O cartão de destaque é o da discordância**, e não o da média, porque é ele
 * que só esta tela enxerga: o mesmo local declarado com tempos diferentes
 * conforme o trecho. Uma tela por trecho nunca acusa isso — cada linha é
 * internamente coerente, e a contradição só aparece quando a tabela é virada do
 * avesso.
 */
export function CartoesDeTma({
  resumo,
  rotuloComparada,
}: {
  resumo: ComparacaoDeTma["resumo"];
  rotuloComparada: string;
}) {
  const daComparada = resumo.find((r) => r.ponta === "COMPARADA") ?? null;
  const daBase = resumo.find((r) => r.ponta === "BASE") ?? null;

  if (!daComparada) {
    return (
      <p className="superficie p-4 text-sm text-muted-foreground">
        A vigência comparada não trouxe nenhum trecho com nome de origem ou de destino, e sem
        nome de local não há tempo de porta por lugar. A tabela por trecho, abaixo, continua
        valendo.
      </p>
    );
  }

  /** A diferença de uma média entre as pontas, quando as duas existem. */
  const contra = (
    ler: (r: NonNullable<typeof daComparada>) => number | null,
  ): number | null => {
    const agora = ler(daComparada);
    const antes = daBase ? ler(daBase) : null;
    if (agora === null || antes === null) return null;
    return Number((agora - antes).toFixed(2));
  };

  const diferencaNaOrigem = contra((r) => r.medioNaOrigem);
  const diferencaNoDestino = contra((r) => r.medioNoDestino);
  const fracaoComVariacao =
    daComparada.portas === 0 ? null : (daComparada.comVariacao / daComparada.portas) * 100;

  return (
    <div
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      aria-label="Indicadores do tempo de porta"
    >
      <CartaoDeIndicador
        rotulo="Locais na malha"
        valor={formatNumber(daComparada.locais, 0)}
        nota={`${formatNumber(daComparada.portas, 0)} ${
          daComparada.portas === 1 ? "porta declarada" : "portas declaradas"
        }`}
        ajuda="Lugares distintos citados como origem ou destino na vigência comparada. Um CDD que é origem de uns trechos e destino de outros conta como um local e duas portas — são duas operações no mesmo endereço."
        icone={MapPin}
      />
      <CartaoDeIndicador
        rotulo={ROTULO_DA_PORTA.ORIGEM}
        valor={escreverMinutos(daComparada.medioNaOrigem)}
        nota={
          diferencaNaOrigem === null
            ? "média simples entre locais"
            : `${escreverDiferencaDeTempo(diferencaNaOrigem)} contra a base`
        }
        ajuda="Da chegada à saída carregado. Média simples entre locais, e não ponderada por viagens: quantas viagens cada trecho roda é o realizado, que este export não traz."
        icone={DoorOpen}
      />
      <CartaoDeIndicador
        rotulo={ROTULO_DA_PORTA.DESTINO}
        valor={escreverMinutos(daComparada.medioNoDestino)}
        nota={
          diferencaNoDestino === null
            ? "média simples entre locais"
            : `${escreverDiferencaDeTempo(diferencaNoDestino)} contra a base`
        }
        ajuda="Da chegada à liberação, incluindo fila e descarga. Fica em cartão próprio porque descarregar não é carregar — juntar os dois daria a média de uma operação que não existe."
        icone={Timer}
      />
      <CartaoDeIndicador
        rotulo="Do ciclo é porta"
        valor={escreverFracao(daComparada.pesoDasPortasNoCiclo)}
        nota="as duas portas somadas"
        ajuda="A única leitura desta tela que soma as duas portas — e aqui a soma descreve algo real: é o mesmo caminhão, no mesmo ciclo, parado nas duas pontas."
        icone={Scale}
      />
      <CartaoDeIndicador
        rotulo="Folga média"
        valor={escreverDiferencaDeTempo(daComparada.folgaMedia)}
        nota={
          daComparada.folgaMedia === null
            ? "nenhum local com as duas versões"
            : daComparada.folgaMedia > 0
              ? "paga-se mais porta do que se pratica"
              : daComparada.folgaMedia < 0
                ? "paga-se menos porta do que se pratica"
                : "o pago é o praticado"
        }
        ajuda="Tempo que remunera menos tempo praticado. Nenhum dos dois sinais é erro: para cima pode ser folga negociada, para baixo pode ser espera que a operação absorve sem reconhecimento."
        icone={ArrowLeftRight}
      />
      <CartaoDeIndicador
        destaque
        rotulo="Locais que se contradizem"
        valor={formatNumber(daComparada.comVariacao, 0)}
        corDoValor={daComparada.comVariacao > 0 ? "text-warning-foreground" : undefined}
        corDoIcone={
          daComparada.comVariacao > 0
            ? "bg-warning/15 text-warning-foreground"
            : "bg-success/10 text-success"
        }
        nota={
          daComparada.comVariacao === 0 ? (
            `em ${rotuloComparada}, cada local tem um tempo só em todos os seus trechos`
          ) : (
            <span>
              {fracaoComVariacao !== null &&
                `${formatNumber(fracaoComVariacao, 1)}% das portas`}
              {daComparada.ondeVariaMais && (
                <>
                  {" · maior diferença em "}
                  <strong className="font-semibold">{daComparada.ondeVariaMais.local}</strong>
                  {`, ${escreverMinutos(daComparada.maiorAmplitude)}`}
                </>
              )}
            </span>
          )
        }
        ajuda="Portas de local em que dois trechos declaram tempos diferentes para o mesmo lugar. Ou o modelo distingue trechos por uma razão que ninguém escreveu, ou alguém parametrizou de dois jeitos."
        icone={daComparada.comVariacao > 0 ? TriangleAlert : MapPin}
      />
    </div>
  );
}
