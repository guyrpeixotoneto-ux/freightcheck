import { ArrowDownRight, ArrowUpRight, ChevronRight, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MapaDoPanorama } from "@/lib/panorama";

/**
 * Andar 5 — o mapa. *"Onde isso aconteceu?"*
 *
 * **O único andar que troca de forma entre as duas leituras**, e o comentário
 * de `mapaDoPanorama` diz por quê: a soma de unidades não tem uma frota a
 * movimentar — `byEquipment` mora no cockpit de uma vigência, e o overview não
 * mescla cockpits —, e uma unidade não tem um ranking de unidades. Fingir
 * simetria aqui produziria um cartão vazio numa das duas leituras.
 *
 * A escolha de qual desenhar não é feita aqui: ela chega pronta em
 * `mapa.eixo`, decidida na aritmética, testada fora do JSX. É o que impede o
 * `if` de virar dois desenhos que divergem com o tempo.
 */
export function Mapa({
  mapa,
  onAbrirUnidade,
}: {
  mapa: MapaDoPanorama;
  /** Abre uma unidade no próprio Panorama — `null` quando não há para onde ir. */
  onAbrirUnidade: ((chave: string) => void) | null;
}) {
  if (mapa.eixo === "unidades") {
    if (mapa.linhas.length === 0) return null;
    return (
      <section
        className="bg-card border rounded-xl shadow-sm px-6 py-5"
        aria-label="Unidades por impacto"
      >
        <h2 className="text-base font-bold">Unidades por impacto</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Da que mais pesa para a que menos pesa nesta competência
        </p>

        <ul className="mt-4 divide-y">
          {mapa.linhas.map((linha) => (
            <li key={linha.chave}>
              <button
                type="button"
                disabled={onAbrirUnidade === null}
                onClick={
                  onAbrirUnidade === null ? undefined : () => onAbrirUnidade(linha.chave)
                }
                className={cn(
                  "w-full flex items-center gap-3 py-2.5 text-left",
                  onAbrirUnidade !== null && "hover:text-brand transition-colors",
                )}
              >
                <span className="min-w-0 flex-1 text-sm font-semibold truncate">
                  {linha.label}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {linha.alteracoes.toLocaleString("pt-BR")} alt.
                </span>
                <span
                  className={cn(
                    "text-sm font-bold tabular-nums shrink-0 w-32 text-right",
                    linha.negativo === null
                      ? "text-muted-foreground"
                      : linha.negativo
                        ? "text-red-700"
                        : "text-emerald-700",
                  )}
                >
                  {/*
                    Sem valor apurado não é zero: a unidade pode ter alterações
                    que nenhuma virou dinheiro, e escrever "R$ 0" ali diria que
                    a apuração aconteceu e deu zero.
                  */}
                  {linha.impacto ?? "sem valor apurado"}
                </span>
                {onAbrirUnidade !== null && (
                  <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                )}
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  /*
    Dentro de uma unidade: a movimentação da frota. O cartão some inteiro quando
    nada se moveu e não há ativo a contar — três zeros lado a lado ocupam a
    altura de um cartão para dizer que não há o que dizer.
  */
  const semMovimento = mapa.entraram === 0 && mapa.sairam === 0;
  if (semMovimento && mapa.ativos === null && mapa.equipamento === null) return null;

  return (
    <section
      className="bg-card border rounded-xl shadow-sm px-6 py-5"
      aria-label="Movimentação da frota"
    >
      <h2 className="text-base font-bold mb-4">Movimentação da frota</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Tile
          icone={ArrowUpRight}
          cor="text-emerald-700"
          rotulo="Entraram"
          valor={`+${mapa.entraram.toLocaleString("pt-BR")}`}
        />
        <Tile
          icone={ArrowDownRight}
          cor="text-red-700"
          rotulo="Saíram"
          valor={`−${mapa.sairam.toLocaleString("pt-BR")}`}
        />
        {mapa.ativos !== null && (
          <Tile
            icone={Truck}
            cor="text-brand"
            rotulo="Veículos ativos"
            valor={mapa.ativos.toLocaleString("pt-BR")}
          />
        )}
        {mapa.equipamento && (
          <Tile
            icone={Truck}
            cor="text-brand"
            rotulo={`${mapa.equipamento.nome} — o mais tocado`}
            valor={`${mapa.equipamento.mudancas.toLocaleString("pt-BR")} mudanças`}
          />
        )}
      </div>
    </section>
  );
}

function Tile({
  icone: Icone,
  cor,
  rotulo,
  valor,
}: {
  icone: typeof Truck;
  cor: string;
  rotulo: string;
  valor: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border px-4 py-3 min-w-0">
      <span className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shrink-0">
        <Icone className={cn("w-4 h-4", cor)} strokeWidth={2.25} />
      </span>
      <div className="min-w-0">
        <p className={cn("text-lg font-extrabold tabular-nums leading-tight", cor)}>{valor}</p>
        <p className="text-[0.6875rem] text-muted-foreground truncate">{rotulo}</p>
      </div>
    </div>
  );
}
