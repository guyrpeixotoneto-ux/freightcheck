import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * O caminho de volta de um clique no gráfico — de onde a pessoa saiu, e como
 * voltar para lá.
 *
 * Clicar numa vigência troca a tela inteira, e desfazer isso dependia até aqui
 * do "voltar" do navegador. Ele serve nas telas que empilham histórico, mas é
 * uma saída que não está onde o gesto aconteceu: quem clicou no gráfico
 * procura a volta no gráfico. Na Gestão à Vista ele nem serve — o telão troca
 * de vigência com `replace`, de propósito, e ali o "voltar" é o caminho de
 * saída da tela.
 *
 * **Este hook mora na página, nunca dentro do gráfico.** Trocar a vigência
 * refaz a consulta da tela, e enquanto ela não responde o bloco que desenha o
 * gráfico desmonta — levando junto qualquer estado guardado ali dentro. Foi
 * exatamente o que aconteceu na primeira versão: o botão nascia e sumia no
 * mesmo instante, sem nada na tela explicando por quê. A página sobrevive à
 * troca, e por isso é dela a lembrança de onde a leitura começou.
 *
 * O que fica guardado é a **origem**: a vigência que estava aberta quando o
 * primeiro clique aconteceu. Guardar o passo anterior faria o botão descer a
 * escada de volta um degrau por vez — três cliques exigiriam três voltas para
 * chegar onde a leitura começou, que é para onde alguém quer voltar. A origem
 * só é registrada uma vez, e some quando a tela volta a ela — por este botão,
 * pelo seletor do cabeçalho ou pelo navegador, tanto faz: a volta some porque
 * já foi feita, e não porque este componente ficou sabendo.
 */
export function useVoltaDeVigencia(atual: { periodo: string | null; label: string | null }) {
  const [origem, setOrigem] = useState<{ periodo: string; label: string } | null>(null);

  return {
    /** Chamado no clique, **antes** de trocar: é o que grava de onde se saiu. */
    registrar: () => {
      if (origem !== null) return;
      if (atual.periodo === null || atual.label === null) return;
      setOrigem({ periodo: atual.periodo, label: atual.label });
    },
    /** Para onde voltar, ou `null` quando não há volta a oferecer. */
    destino: origem !== null && origem.periodo !== atual.periodo ? origem : null,
    limpar: () => setOrigem(null),
  };
}

/**
 * O botão em si — texto curto, sempre com o nome da vigência de destino.
 *
 * "Voltar" sozinho não diz para onde, e num gráfico de seis vigências a
 * pergunta seguinte seria exatamente essa. O rótulo é o mesmo que o eixo
 * escreve, para o destino ser reconhecível na própria tela.
 */
export function BotaoDeVoltarVigencia({
  destino,
  onVoltar,
  className,
}: {
  destino: { periodo: string; label: string } | null;
  onVoltar: (periodo: string) => void;
  className?: string;
}) {
  if (destino === null) return null;

  return (
    <button
      type="button"
      onClick={() => onVoltar(destino.periodo)}
      title={`Voltar para ${destino.label}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold",
        "hover:bg-accent transition-colors shrink-0",
        className,
      )}
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      Voltar para {destino.label}
    </button>
  );
}
