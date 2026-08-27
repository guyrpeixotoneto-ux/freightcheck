import { useMemo } from "react";
import { CanvasDoFluxo } from "@/components/fluxos/canvas";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { analisarFluxo, SEVERIDADES, type Severidade } from "@/lib/fluxos-analise";
import { numeracaoDoFluxo, posicoesDoFluxo, type Orientacao } from "@/lib/fluxos-visoes";
import type { PropsDaVisaoNoCanvas } from "@/components/fluxos/visao";

/**
 * VISUALIZAÇÃO 6 — OS GARGALOS: o mesmo desenho, com uma leitura por cima.
 *
 * É o que transforma o módulo de documentação em ferramenta de melhoria: nada
 * de novo é cadastrado, nada de novo é desenhado — o fluxograma é o mesmo, e o
 * que muda é a cor do cartão, que passa a vir da análise em vez do tipo.
 *
 * **Nenhum sinal é inventado.** Cada um é uma contagem do que está cadastrado:
 * uma falha registrada, um retorno que chega, uma etapa sem responsável, sem
 * sistema, sem prazo, sem documentação. Atraso e SLA estourado não aparecem
 * porque dependem de execução medida, que este produto ainda não coleta — e uma
 * etapa "no prazo" desenhada sem dado de execução seria uma afirmação falsa.
 *
 * Por isso existe o cinza: uma etapa em que só o nome foi preenchido não é
 * "normal", é **sem avaliação**. Dizer isso é o que faz a visualização virar uma
 * lista de trabalho — quem lê descobre o que falta cadastrar.
 */
export function VisaoGargalos({
  completo,
  catalogo,
  etapaSelecionada,
  onSelecionarEtapa,
  somenteLeitura,
  onMoverEtapas,
  onConectar,
  onAbrirConexao,
  onSoltarElemento,
  orientacao,
  sinal,
  onTrocarSinal,
}: PropsDaVisaoNoCanvas & {
  orientacao: Orientacao;
  /** `""` analisa todos os sinais; um valor recorta por um deles. */
  sinal: string;
  onTrocarSinal: (sinal: string) => void;
}) {
  const analise = useMemo(() => analisarFluxo(completo), [completo]);

  const projecao = useMemo(() => {
    const severidades = new Map<string, Severidade>();
    for (const [etapaId, diagnostico] of analise.porEtapa) {
      /*
        Com um sinal escolhido, só quem o tem continua pintado. As outras etapas
        voltam à cor do tipo em vez de sumirem: o desenho precisa continuar
        sendo o processo inteiro, senão vira um recorte que engana sobre o
        tamanho do problema.
      */
      if (sinal !== "" && !diagnostico.sinais.some((s) => s.chave === sinal)) continue;
      severidades.set(etapaId, diagnostico.severidade);
    }
    return {
      posicoes: posicoesDoFluxo(completo, orientacao),
      numeracao: numeracaoDoFluxo(completo),
      severidades,
    };
  }, [analise, completo, orientacao, sinal]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-card px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Analisar</span>
          <Select value={sinal === "" ? "todos" : sinal} onValueChange={(v) => onTrocarSinal(v === "todos" ? "" : v)}>
            <SelectTrigger className="h-8 w-[230px]" aria-label="Sinal analisado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os sinais</SelectItem>
              {analise.frequencia.map((f) => (
                <SelectItem key={f.chave} value={f.chave}>
                  {f.rotulo} ({f.etapas})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {SEVERIDADES.map((s) => (
            <span key={s.valor} className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", s.ponto)} />
              {s.rotulo}
              <strong className="font-semibold tabular-nums text-foreground">
                {analise.contagem[s.valor]}
              </strong>
            </span>
          ))}
        </div>

        <p className="ml-auto text-[11px] text-muted-foreground/80">
          Sinais calculados sobre o que está cadastrado. Atraso e SLA estourado dependem de dado de
          execução.
        </p>
      </div>

      <div className="min-h-0 flex-1">
        <CanvasDoFluxo
          completo={completo}
          catalogo={catalogo}
          etapaSelecionada={etapaSelecionada}
          onSelecionarEtapa={onSelecionarEtapa}
          somenteLeitura={somenteLeitura}
          onMoverEtapas={onMoverEtapas}
          onConectar={onConectar}
          onAbrirConexao={onAbrirConexao}
      onSoltarElemento={onSoltarElemento}
          projecao={projecao}
          posicoesPersistidas={orientacao === "vertical"}
          chaveDoEnquadramento={`${completo.fluxo.id}:gargalos:${orientacao}`}
        />
      </div>
    </div>
  );
}
