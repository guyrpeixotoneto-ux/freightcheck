import { periodicitySuffix, formatBrlShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LinhaDeLista } from "@/components/panorama/linha-de-lista";
import type { JanelaDoImpacto } from "@/lib/panorama";

/**
 * Dobra 2, à direita do gráfico — *"quem vem puxando isto?"*
 *
 * O gráfico ao lado desenha seis vigências de ganhos e perdas e responde "esta
 * competência é fora do normal?". O que ele não diz é **de onde** vem o
 * movimento que ele mostra, e essa era a metade que faltava na dobra: a leitura
 * por parâmetro existia só para a competência aberta, duas dobras abaixo, sobre
 * uma população diferente.
 *
 * As duas listas podem discordar, e é bom que discordem: o parâmetro que
 * dominou esta quinzena pode ser estreante, e o que sangra há seis vigências
 * pode não ter se mexido nesta. Por isso o título nomeia a janela e cada linha
 * diz **em quantas das vigências** aquele parâmetro se mexeu — é o que separa o
 * solavanco de uma quinzena da pressão que volta sempre.
 *
 * **Nada aqui soma com o de cima.** A janela cobre várias vigências; a manchete
 * é de uma. O intervalo vem escrito no subtítulo para que o número não seja
 * lido como desta competência — a mesma regra da travessia do quadro de
 * pessoal, por onde já passamos.
 *
 * O dado é `Movimentos.byParameter`, da resposta que o gráfico já buscou
 * (`lib/serie-de-impacto.ts`): o cartão não custa requisição nenhuma.
 */
export function OQuePuxou({
  janela,
  carregando,
  className,
}: {
  janela: JanelaDoImpacto | null;
  carregando: boolean;
  className?: string;
}) {
  const sufixo = periodicitySuffix(janela?.periodicity ?? null);

  return (
    <section
      className={cn("superficie px-6 py-5 flex flex-col", className)}
      aria-label="O que puxou a janela"
    >
      <h2 className="text-base font-bold">O que puxou a janela</h2>
      <p className="text-xs text-muted-foreground mt-0.5 mb-2">
        {/*
          O intervalo no subtítulo, e não numa nota de rodapé: ele é a ressalva
          que impede a contagem de ser lida como desta competência, e ressalva
          longe do número não é ressalva.
        */}
        {janela
          ? `Por parâmetro, no intervalo do gráfico (${janela.rotulo})${sufixo ? ` · R$${sufixo}` : ""}`
          : "Por parâmetro, no intervalo do gráfico"}
      </p>

      {carregando ? (
        <div aria-hidden className="mt-3 space-y-4">
          <span role="status" className="sr-only">
            Carregando a janela…
          </span>
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 w-40 rounded bg-muted animate-pulse" />
              <div className="h-1.5 w-full rounded-full bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      ) : janela === null || janela.linhas.length === 0 ? (
        /*
          Os dois vazios têm a mesma consequência e causas diferentes, e a frase
          diz qual é: sem intervalo comparado não há janela a ler (é o caso da
          primeira vigência de um histórico), e com janela sem valor apurado não
          há o que ranquear.
        */
        <p className="text-sm text-muted-foreground py-8">
          {janela === null
            ? "Não há intervalo comparado para ler — o gráfico ao lado diz quais vigências faltam."
            : "Nenhum parâmetro tem valor apurado nesta janela — não há o que ranquear."}
        </p>
      ) : (
        /* A lista preenche o cartão, que acompanha a altura do gráfico ao lado
           — a mesma regra do ranking da dobra 3. */
        <ol className="mt-1 divide-y flex-1 flex flex-col justify-center">
          {janela.linhas.map((linha, indice) => (
            <LinhaDeLista
              key={linha.chave}
              className="flex-1 max-h-28 flex items-center"
              posicao={indice + 1}
              nome={linha.nome}
              contexto={linha.contexto}
              proporcao={linha.proporcao}
              corDaBarra={linha.classificacao === "perda" ? "bg-red-600" : "bg-emerald-600"}
              valor={formatBrlShort(linha.valor)}
              corDoValor={linha.classificacao === "perda" ? "text-red-700" : "text-emerald-700"}
              subvalor={sufixo}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
