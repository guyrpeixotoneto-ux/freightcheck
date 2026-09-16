import { Search, X } from "lucide-react";
import {
  MODULOS_DO_MONITOR,
  ROTULO_DA_SITUACAO,
  ROTULO_DO_MODULO,
  SITUACOES_DO_IMPACTO,
  type ModuloDoMonitor,
  type SituacaoDoImpacto,
} from "@workspace/comparison/monitor-custo-fixo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FILTROS_VAZIOS,
  rotuloDaPeriodicidade,
  type FiltrosDoMonitor,
} from "@/lib/monitor-custo-fixo";
import { cn } from "@/lib/utils";

/**
 * Os filtros globais — **um conjunto, e não um por bloco**.
 *
 * Cartões, visão por módulo e tabela respondem a estes mesmos valores porque
 * respondem à mesma resposta do servidor: o recorte acontece antes do impacto,
 * lá, e não em três lugares aqui. Era a única forma de o cartão não contradizer
 * a tabela sem a tela somar dinheiro.
 *
 * **Filtro que não se aplica a um módulo não apaga o módulo.** Equipamento é o
 * caso de hoje: ele vale para quem tem cavalo e carreta, e quem não tem passa
 * inteiro — a regra mora na rota (`passaNoEquipamento`), onde ela pode ser
 * testada sem montar tela. O aviso abaixo do campo diz isso em voz alta, porque
 * um filtro que parece global e não é seria lido como dado faltando.
 */
export function FiltrosDoMonitorGlobais({
  filtros,
  periodicidades,
  onMudar,
  ignorados,
}: {
  filtros: FiltrosDoMonitor;
  /** As periodicidades que o recorte devolveu — a tela não as inventa. */
  periodicidades: readonly string[];
  onMudar: (proximos: FiltrosDoMonitor) => void;
  ignorados: readonly string[];
}) {
  const alternar = <T,>(lista: T[], valor: T): T[] =>
    lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor];

  const limpo =
    filtros.modulos.length === 0 &&
    filtros.equipamento === null &&
    filtros.situacoes.length === 0 &&
    filtros.periodicidades.length === 0 &&
    filtros.busca.trim() === "";

  return (
    <section className="flex flex-col gap-3" aria-label="Filtros do Monitor">
      <div className="flex flex-wrap items-end gap-4">
        <Grupo titulo="Módulo">
          {MODULOS_DO_MONITOR.map((m) => (
            <Alternador
              key={m}
              ativo={filtros.modulos.includes(m)}
              onClick={() => onMudar({ ...filtros, modulos: alternar(filtros.modulos, m) })}
            >
              {ROTULO_DO_MODULO[m]}
            </Alternador>
          ))}
        </Grupo>

        <Grupo titulo="Equipamento">
          {(["CAVALO", "CARRETA"] as const).map((e) => (
            <Alternador
              key={e}
              ativo={filtros.equipamento === e}
              onClick={() =>
                onMudar({ ...filtros, equipamento: filtros.equipamento === e ? null : e })
              }
            >
              {e === "CAVALO" ? "Cavalo" : "Carreta"}
            </Alternador>
          ))}
        </Grupo>

        <Grupo titulo="Situação do impacto">
          {SITUACOES_DO_IMPACTO.map((s: SituacaoDoImpacto) => (
            <Alternador
              key={s}
              ativo={filtros.situacoes.includes(s)}
              onClick={() =>
                onMudar({ ...filtros, situacoes: alternar(filtros.situacoes, s) })
              }
            >
              {ROTULO_DA_SITUACAO[s]}
            </Alternador>
          ))}
        </Grupo>

        {periodicidades.length > 0 && (
          <Grupo titulo="Periodicidade">
            {periodicidades.map((p) => (
              <Alternador
                key={p}
                ativo={filtros.periodicidades.includes(p)}
                onClick={() =>
                  onMudar({
                    ...filtros,
                    periodicidades: alternar(filtros.periodicidades, p),
                  })
                }
              >
                {rotuloDaPeriodicidade(p)}
              </Alternador>
            ))}
          </Grupo>
        )}

        <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
          <Label htmlFor="busca-do-monitor" className="text-xs font-medium">
            Buscar
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="busca-do-monitor"
              value={filtros.busca}
              onChange={(e) => onMudar({ ...filtros, busca: e.target.value })}
              placeholder="Placa, variável, unidade ou módulo"
              className="pl-8"
            />
          </div>
        </div>

        {!limpo && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onMudar({ ...FILTROS_VAZIOS, base: filtros.base, comparada: filtros.comparada })
            }
          >
            <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Limpar filtros
          </Button>
        )}
      </div>

      {filtros.equipamento !== null && (
        <p className="text-xs text-muted-foreground">
          O filtro de equipamento vale para os módulos que trabalham com cavalo e
          carreta. Módulos de outro grão continuam inteiros na contagem — um filtro
          que não se aplica não apaga dado.
        </p>
      )}

      {ignorados.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          O endereço trazia {ignorados.join(", ")}, que não existe. A tela abriu sem
          esse recorte, em vez de abrir vazia.
        </p>
      )}
    </section>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs font-medium">{titulo}</legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

function Alternador({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo} className="rounded-full">
      <Badge
        variant={ativo ? "default" : "outline"}
        className={cn("cursor-pointer whitespace-nowrap", !ativo && "text-muted-foreground")}
      >
        {children}
      </Badge>
    </button>
  );
}

export type { ModuloDoMonitor };
