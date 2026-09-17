import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { LinhaDeLista } from "@/components/panorama/linha-de-lista";
import { mapaVazio, type MapaDoPanorama, type MovimentoDaFrota } from "@/lib/panorama";

/**
 * Dobra 3 — o mapa. *"Onde isso aconteceu?"*
 *
 * **O único cartão que troca de forma entre as duas leituras**, e o comentário
 * de `mapaDoPanorama` diz por quê: a soma de unidades não tem tipos de ativo a
 * ranquear — `byEquipment` mora no cockpit de uma vigência, e o overview não
 * mescla cockpits —, e uma unidade não tem um ranking de unidades. Fingir
 * simetria aqui produziria um cartão vazio numa das duas leituras.
 *
 * A escolha de qual desenhar não é feita aqui: ela chega pronta em `mapa.eixo`,
 * decidida na aritmética, testada fora do JSX. É o que impede o `if` de virar
 * dois desenhos que divergem com o tempo.
 *
 * ---
 *
 * **Dentro de uma unidade, ele era quatro tiles e virou um ranking.** Os tiles
 * eram "Entraram", "Saíram", "Veículos ativos" e "Cavalo — o mais tocado", e o
 * defeito deles não era a aparência:
 *
 * - **três dos quatro não respondiam a pergunta do andar.** Entrada, saída e
 *   tamanho de frota dizem como a **população** mudou; onde a vigência mexeu,
 *   só o quarto dizia;
 * - **"Veículos ativos" publicava a frota inteira** (`ativos: leitura.frota`),
 *   e não os que respondem `ATIVO` na coluna — 133 onde o certo eram 46, com o
 *   número errado impresso a uma dobra de distância da régua que publica os
 *   dois com os nomes certos;
 * - **o dado do "onde" estava sendo jogado fora.** `byEquipment` traz a lista
 *   inteira, com alterações, parâmetros e frota por tipo; o cartão lia o
 *   primeiro balde e descartava o resto;
 * - e quatro caixas com borda dentro de um cartão com borda são moldura dentro
 *   de moldura, esticadas para acompanhar a altura do gráfico ao lado.
 *
 * **Ele também mudou de lugar.** Pareava com o gráfico da trajetória por ser
 * curto, não por responder a mesma pergunta — o gráfico fala da janela de
 * vigências e este cartão fala da competência aberta. Aquele lugar é de quem lê
 * a mesma janela (`components/panorama/o-que-puxou.tsx`), e este desceu para uma
 * faixa de largura inteira depois da decomposição, junto das outras leituras da
 * competência. Na faixa inteira as duas a quatro linhas param de apertar o nome
 * do tipo contra a contagem.
 *
 * Agora o corpo é o ranking dos tipos — na mesma forma de linha das listas da
 * dobra 2 (`components/panorama/linha-de-lista.tsx`) — e a movimentação da
 * frota é uma linha de rodapé, com os rótulos certos e sem o `+0 / −0` em corpo
 * de KPI de quem não teve movimento.
 */
export function Mapa({
  mapa,
  onAbrirUnidade,
}: {
  mapa: MapaDoPanorama;
  /** Abre uma unidade no próprio Panorama — `null` quando não há para onde ir. */
  onAbrirUnidade: ((chave: string) => void) | null;
}) {
  /* Os dois vazios, na regra que mora na leitura — ver `mapaVazio`. */
  if (mapaVazio(mapa)) return null;

  if (mapa.eixo === "unidades") {
    return (
      <Cartao
        titulo="Unidades por impacto"
        descricao="Da que mais pesa para a que menos pesa nesta competência"
      >
        <ol className="mt-1 divide-y">
          {mapa.linhas.map((linha, indice) => (
            <LinhaDeLista
              key={linha.chave}
              posicao={indice + 1}
              nome={linha.label}
              contexto={`${linha.alteracoes.toLocaleString("pt-BR")} ${
                linha.alteracoes === 1 ? "alteração" : "alterações"
              }`}
              proporcao={linha.proporcao}
              corDaBarra={
                linha.negativo === null
                  ? "bg-muted-foreground/60"
                  : linha.negativo
                    ? "bg-red-600"
                    : "bg-emerald-600"
              }
              /*
                Sem valor apurado não é zero: a unidade pode ter alterações que
                nenhuma virou dinheiro, e escrever "R$ 0" ali diria que a
                apuração aconteceu e deu zero.
              */
              valor={linha.impacto ?? "sem valor apurado"}
              corDoValor={
                linha.negativo === null
                  ? "text-muted-foreground"
                  : linha.negativo
                    ? "text-red-700"
                    : "text-emerald-700"
              }
              titulo={onAbrirUnidade ? `Abrir o Panorama de ${linha.label}` : undefined}
              onAbrir={onAbrirUnidade ? () => onAbrirUnidade(linha.chave) : null}
            />
          ))}
        </ol>
      </Cartao>
    );
  }

  return (
    <Cartao titulo="Onde aconteceu" descricao="Por tipo de ativo, do mais tocado para o menos">
      {mapa.tipos.length > 0 ? (
        <ol className="mt-1 divide-y">
          {mapa.tipos.map((tipo, indice) => (
            <LinhaDeLista
              key={tipo.chave}
              posicao={indice + 1}
              nome={tipo.nome}
              /* Já escrito pela leitura — quais cláusulas ele tem depende do
                 que a resposta soube dizer. Ver `LinhaDoTipo.contexto`. */
              contexto={tipo.contexto}
              proporcao={tipo.proporcao}
              corDaBarra="bg-brand"
              valor={tipo.alteracoes.toLocaleString("pt-BR")}
              subvalor={tipo.alteracoes === 1 ? "alteração" : "alterações"}
              titulo={tipo.href ? `Ver as alterações de ${tipo.nome}` : undefined}
              href={tipo.href}
            />
          ))}
        </ol>
      ) : (
        /* Uma frota que se moveu sem alteração nenhuma detectada: o rodapé é a
           notícia inteira, e o corpo diz por que está vazio. */
        <p className="text-sm text-muted-foreground py-6">
          Nenhuma alteração foi detectada nesta vigência — não há tipo de ativo a ranquear.
        </p>
      )}

      <Frota movimento={mapa.movimento} />
    </Cartao>
  );
}

/** A moldura — uma, e por fora. */
function Cartao({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao: string;
  children: ReactNode;
}) {
  return (
    <section className="superficie px-6 py-5" aria-label={titulo}>
      <h2 className="text-base font-bold">{titulo}</h2>
      <p className="text-xs text-muted-foreground mt-0.5 mb-2">{descricao}</p>
      {children}
    </section>
  );
}

/**
 * A movimentação da frota, em uma linha — o que sobrou dos três tiles que não
 * respondiam "onde".
 *
 * **Cada ponta só aparece quando diz algo.** Sem frota declarada não há
 * denominador a publicar; sem entrada nem saída não há movimento a anunciar — e
 * era justamente `+0` e `−0` em corpo de KPI que faziam o cartão antigo parecer
 * vazio nas vigências em que a frota ficou parada. A cláusula de `ATIVO` segue a
 * recusa da leitura: quem não trouxe a coluna não é contado como parado, e por
 * isso o que se publica é quantos responderam `ATIVO`, nunca a subtração.
 */
function Frota({ movimento }: { movimento: MovimentoDaFrota }) {
  const { frota, ativos, inativos, entraram, sairam } = movimento;
  const responderam = ativos + inativos;
  const semMovimento = entraram === 0 && sairam === 0;
  if (frota === null && semMovimento) return null;

  return (
    <div className="mt-3 pt-3 border-t flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {frota !== null && (
        <span className="flex items-center gap-1.5">
          <Truck className="w-3.5 h-3.5 shrink-0" />
          <span className="font-bold tabular-nums text-foreground">
            {frota.toLocaleString("pt-BR")}
          </span>
          na frota
          {responderam > 0 && (
            <>
              {/* O ponto num `<span>`: dois nós de texto vizinhos viram um item
                  só do flex, e o `gap` não separa o que está dentro de um item
                  — saía "na frota·" colado. */}
              <span aria-hidden>·</span>
              <span className="font-bold tabular-nums text-foreground">
                {ativos.toLocaleString("pt-BR")}
              </span>
              em ATIVO
            </>
          )}
        </span>
      )}
      {!semMovimento && (
        <>
          <Ponta icone={ArrowUpRight} cor="text-emerald-700" valor={entraram} rotulo="entraram" />
          <Ponta icone={ArrowDownRight} cor="text-red-700" valor={sairam} rotulo="saíram" />
        </>
      )}
    </div>
  );
}

function Ponta({
  icone: Icone,
  cor,
  valor,
  rotulo,
}: {
  icone: typeof Truck;
  cor: string;
  valor: number;
  rotulo: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <Icone className={cn("w-3.5 h-3.5 shrink-0", cor)} strokeWidth={2.25} />
      <span className={cn("font-bold tabular-nums", cor)}>{valor.toLocaleString("pt-BR")}</span>
      {rotulo}
    </span>
  );
}
