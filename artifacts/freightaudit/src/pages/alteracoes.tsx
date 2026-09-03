import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  Activity,
  DollarSign,
  FileSpreadsheet,
  Handshake,
  Headset,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { AbaBotao } from "@/components/changes/cartoes";
import { AbaPlanilha } from "@/components/changes/aba-planilha";
import { AbaChamados } from "@/components/changes/aba-chamados";
import {
  ImpactoQuinzenas,
  type AberturaDaMatriz,
} from "@/components/changes/impacto-quinzenas";
import { ClienteRecomendacoes } from "@/components/changes/cliente-recomendacoes";
import type { JanelaDeVigencias } from "@/components/changes/janela-vigencias";
import type { TicketTotals } from "@/components/changes/ticket-table";
import { fetchJson } from "@/lib/api";
import {
  abaValida,
  lerFiltros,
  lerRecorte,
  paramsDeAlteracoes,
  paramsDoRecorte,
  type AbaDeAlteracoes,
} from "@/lib/recorte";

/**
 * Alterações — o que mudou, pelos caminhos por onde a mudança chega, e quanto
 * cada ativo custa em cada vigência.
 *
 * **Planilha** é a comparação entre vigências: o que a Ambev mexeu no cadastro
 * entre um export e o seguinte, apurado célula a célula. **Chamados** é o
 * outro lado da mesma história — o que nós pedimos pelo Freightech e o que
 * voltou aplicado.
 *
 * As duas nunca somam nada uma com a outra, e isso é a decisão de projeto
 * central desta tela. O impacto da planilha é uma diferença apurada entre dois
 * estados fechados; o do chamado é a distância entre um pedido e uma resposta,
 * ambos declarados pela própria fonte. Adicioná-los daria um número que não se
 * sustenta em lugar nenhum — e contaria em dobro toda mudança que foi pedida
 * por chamado e depois apareceu na planilha. Duas contas, duas réguas, lado a
 * lado.
 *
 * **Impacto** é a terceira, e é a única que não parte da alteração. Ela mostra
 * o valor de cada ativo em cada quinzena e deixa a alteração aparecer como a
 * diferença entre duas colunas. Existe porque as outras duas, por construção,
 * não conseguem mostrar o ativo que **não** mudou — ele não está em lista de
 * alteração nenhuma — e sem ele o total da coluna não fecha com o que a Ambev
 * pagou. Ela também não soma com as outras: é o estado, não o movimento.
 *
 * **Cliente** é a quarta, e é a única que não responde "o que mudou": ela
 * responde *o que fazer a respeito*. A cadeia é `Impacto identifica → semântica
 * interpreta → Cliente recomenda`, e a aba mostra o subconjunto das alterações
 * em que o movimento vai contra nós **e** existe algo objetivo a pedir ou a
 * perguntar. Ela não recalcula nada: o dinheiro é o mesmo que o Impacto apurou,
 * e o que ela acrescenta é a leitura econômica — porque o sinal matemático da
 * variação não é o sinal econômico dela. Uma taxa que cai reduz o que
 * recebemos; uma idade que sobe não é premissa que alguém mexeu.
 */

/**
 * Em qual aba a tela abre.
 *
 * `abaInicial` é de quem entrou por outro endereço: `/impacto-financeiro`, no
 * menu de Auditoria, é a mesma tela aberta no Impacto — a pergunta "quanto isso
 * custou" tem entrada própria no menu, e não podia depender de alguém saber que
 * a resposta mora numa aba de Alterações.
 *
 * `?aba=` vence, e agora **manda**: clicar numa aba reescreve o endereço em vez
 * de mexer num estado invisível. Foi o que faltava para a Visão geral conversar
 * com esta tela — quem manda um link manda a aba junto, o botão de voltar do
 * navegador desfaz a troca, e a barra de endereços descreve o que está à vista.
 * O caminho não muda no caminho: quem entrou por `/impacto-financeiro` continua
 * lá, com o menu aceso no item que abriu, e só a aba se move.
 */
export default function Alteracoes({
  abaInicial = "planilha",
}: {
  abaInicial?: AbaDeAlteracoes;
} = {}) {
  const search = useSearch();
  const [caminho, navegar] = useLocation();
  const pedida = new URLSearchParams(search).get("aba");
  const aba: AbaDeAlteracoes = abaValida(pedida) ? pedida : abaInicial;

  /*
    O parâmetro que outra aba mandou abrir no Impacto.

    Mora aqui porque a travessia é entre abas: "ver por placa e vigência" leva a
    pessoa da recomendação à tabela do segundo nível, e clicar no nome do
    atributo de uma alteração leva da Planilha à mesma tabela — guardar isso
    dentro de uma das abas faria a escolha morrer na troca. Zera ao trocar de aba
    pela barra para que a próxima entrada em Impacto abra no panorama, como
    sempre.

    Continua em estado, e não no endereço, e a diferença com a aba é real: a aba
    é o assunto — dá para apontar para ela de fora, e a Visão geral aponta. Isto
    é o meio de uma frase que começou na aba ao lado, e um endereço para o meio
    de uma frase abriria a matriz num parâmetro sem que ninguém o tivesse
    escolhido — que é a porta fechada em 16/08/2026.

    A placa só existe quando a travessia vem da Planilha, onde a alteração é de
    um ativo. Ela destaca a linha na matriz e não recorta nada — a distinção está
    em `AberturaDaMatriz`.
  */
  const [travessia, setTravessia] = useState<AberturaDaMatriz | null>(null);
  /*
    O recorte De/Até, compartilhado pelas quatro abas.

    Mora aqui pelo mesmo motivo que a travessia acima: as abas respondem sobre o
    mesmo período, e perder o recorte ao trocar de aba faria "quanto isso
    custou" e "o que pedir ao cliente" falarem de meses diferentes com a mesma
    cara.

    Nasceu só para Impacto e Cliente, com a nota de que Planilha e Chamados
    "não leem a série, leem comparações gravadas e chamados, e um de/até ali
    seria um filtro que promete um corte que aquelas contas não fazem". A nota
    estava certa sobre a implementação e errada sobre a pergunta: quem tem nove
    vigências à vista numa aba quer o mesmo intervalo nas outras, e a resposta
    foi ensinar as duas contas a recortar de verdade, e não pendurar um seletor
    decorativo em cima delas.

    O que cada aba passou a fazer com o recorte é diferente, porque as contas
    são diferentes, e as duas leituras estão escritas onde acontecem:

    - **Planilha** soma as transições cujas duas pontas caem no intervalo (ver
      `getConsolidated`). A vigência mais antiga do recorte não traz transição,
      e a tela diz quantas há em vez de deixar quem lê subtrair.
    - **Chamados** recorta pela vigência que o próprio chamado declara
      (`Vig. Abertura`), que é a mesma string de `snapshot.source_label`. O que
      não declara vigência legível fica de fora de qualquer recorte, e a aba diz
      quantos são.
  */
  const [janela, setJanela] = useState<JanelaDeVigencias>({});

  /**
   * Trocar de aba — pela barra, ou por uma travessia de dentro de uma delas.
   *
   * `limparTravessia` é o que separa as duas. Pela barra, quem clica em
   * "Impacto" pediu o panorama, e a escolha que a aba Cliente tinha entregado
   * morre ali. Pela travessia — "ver por placa e vigência" —, ela é justamente o
   * que se está pedindo, e sobrevive à troca.
   */
  const trocarAba = (
    proxima: AbaDeAlteracoes,
    { limparTravessia = true }: { limparTravessia?: boolean } = {},
  ) => {
    if (limparTravessia) setTravessia(null);
    /*
      O recorte de linha fica na aba que o aplica.

      Ir da Planilha filtrada em "sem impacto" para o Impacto levaria um
      `impactConfidence` que aquela aba não aplica — o endereço afirmaria um
      corte que a matriz não faz. Vigência e unidade também saem do endereço na
      aba que não as honra, pela mesma razão; `paramsDeAlteracoes` é quem sabe o
      que cada aba sustenta, e é dele que sai a resposta aqui.
    */
    const params = paramsDeAlteracoes({
      aba: proxima,
      recorte: lerRecorte(search),
      filtros: lerFiltros(search),
      serie: new URLSearchParams(search).get("serie"),
    });
    // Escrito mesmo quando é o padrão: aqui houve escolha, e o endereço de quem
    // escolheu a Planilha não pode ser indistinguível do de quem nunca clicou.
    params.set("aba", proxima);
    navegar(`${caminho}?${params}`);
  };

  // Só a contagem, para a aba dizer o tamanho do assunto antes de ser aberta.
  // `limit=1` porque a lista em si é da aba; o que interessa aqui é o total.
  const resumoChamados = useQuery({
    queryKey: ["tickets", "resumo"],
    queryFn: () =>
      fetchJson<{ totals: TicketTotals | null }>("/tickets?limit=1"),
  });

  return (
    <Layout>
      <div className="border-b bg-card px-8 pt-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Activity className="w-6 h-6 text-primary" />
          Alterações
        </h1>
        <p className="text-muted-foreground text-sm mt-1 max-w-3xl">
          A remuneração muda por dois caminhos, e cada um se confere de um
          jeito — os números de uma aba nunca somam com os da outra. Impacto é a
          terceira leitura: quanto cada ativo custa em cada quinzena.
        </p>

        <nav className="flex items-center gap-1 mt-4" role="tablist">
          <AbaBotao
            active={aba === "planilha"}
            onClick={() => trocarAba("planilha")}
            icon={<FileSpreadsheet className="w-4 h-4" />}
            label="Planilha"
            hint="o que a Ambev mexeu entre duas vigências"
          />
          <AbaBotao
            active={aba === "chamados"}
            onClick={() => trocarAba("chamados")}
            icon={<Headset className="w-4 h-4" />}
            label="Chamados"
            hint="o que pedimos e o que voltou aplicado"
            count={resumoChamados.data?.totals?.changes}
          />
          <AbaBotao
            active={aba === "impacto"}
            onClick={() => trocarAba("impacto")}
            icon={<DollarSign className="w-4 h-4" />}
            label="Impacto"
            hint="quanto cada ativo custa em cada quinzena"
          />
          <AbaBotao
            active={aba === "cliente"}
            onClick={() => trocarAba("cliente")}
            icon={<Handshake className="w-4 h-4" />}
            label="Cliente"
            hint="o que propor, o que investigar, e o que não levar"
          />
        </nav>
      </div>

      {aba === "planilha" && (
        <AbaPlanilha
          vigencias={janela}
          onVigencias={setJanela}
          /*
            O caminho da alteração para as nove vigências dela.

            É a mesma travessia da aba Cliente, e existe pela pergunta que a
            lista não responde: uma linha diz de quanto para quanto foi entre
            duas vigências, e quem lê quer saber se aquilo vinha acontecendo. O
            recorte De/Até atravessa junto porque é o mesmo estado das quatro
            abas — a matriz abre sobre o intervalo que estava à vista aqui.
          */
          onVerQuinzenas={(alvo) => {
            setTravessia(alvo);
            trocarAba("impacto", { limparTravessia: false });
          }}
        />
      )}
      {aba === "chamados" && (
        <AbaChamados vigencias={janela} onVigencias={setJanela} />
      )}
      {aba === "impacto" && (
        <div className="p-8">
          {/*
            A unidade atravessa, a vigência não.

            A matriz põe todas as quinzenas lado a lado — é a série inteira, e
            recortá-la na vigência aberta na Visão geral deixaria uma coluna só.
            Já a unidade é o assunto: sem ela, quem trocou para CAMAÇARI e veio
            para cá leria os números de outra unidade sem nada dizendo isso. O
            De/Até é outro recorte, e de outra natureza — ele estreita a série, e
            é escolhido aqui dentro.
          */}
          <ImpactoQuinzenas
            contexto={paramsDoRecorte(lerRecorte(search), { comPeriodo: false })}
            escolhaInicial={travessia}
            janela={janela}
            onJanela={setJanela}
            key={
              travessia
                ? `${travessia.entityType}:${travessia.code}:${travessia.placa ?? ""}`
                : "panorama"
            }
          />
        </div>
      )}
      {aba === "cliente" && (
        <div className="p-8">
          <ClienteRecomendacoes
            janela={janela}
            onJanela={setJanela}
            onAbrirImpacto={(escolha) => {
              setTravessia(escolha);
              // A travessia é dentro da tela, e o endereço acompanha: a aba é o
              // assunto, e ele mudou.
              trocarAba("impacto", { limparTravessia: false });
            }}
          />
        </div>
      )}
    </Layout>
  );
}
