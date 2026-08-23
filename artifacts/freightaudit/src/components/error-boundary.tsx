import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { DetalhesTecnicos } from "@/components/detalhes-tecnicos";

/**
 * A última linha entre um defeito e uma tela branca.
 *
 * Sem isto, qualquer exceção durante o render desmonta a árvore inteira e o
 * navegador fica com um `<div id="root">` vazio: nenhuma mensagem, nenhum menu,
 * nenhum caminho de volta. Foi exatamente o que aconteceu quando o Painel leu
 * `data.impactByPeriodicity.length` de um corpo de erro — o defeito estava numa
 * linha de uma página, e o produto inteiro sumiu.
 *
 * A causa daquele caso está corrigida na origem (ver `lib/api.ts`). Esta rede
 * existe para o próximo: uma tela que falha deve continuar sendo uma tela que
 * diz o que houve.
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // O console é o único lugar onde o stack ainda serve para alguma coisa; a
    // tela recebe a mensagem, que é o que dá para ler.
    console.error("Erro não tratado no render:", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background p-8">
        <div className="max-w-xl space-y-4">
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            Esta tela não conseguiu ser desenhada
          </h1>
          <p className="text-sm text-muted-foreground">
            Alguma coisa falhou enquanto a página era montada, e a interface
            continua no ar — recarregar costuma bastar quando a causa foi uma
            resposta que não veio. Nada do que você fez se perdeu por causa
            disto.
          </p>

          {/*
            A mensagem da exceção desceu para cá, e o link "Ver /api/healthz"
            saiu de vez.

            Ela é o texto de um `Error` de JavaScript — em inglês, com nome de
            propriedade dentro — e ocupava o corpo do aviso: a coisa mais
            técnica da tela na posição mais visível dela. O botão ao lado
            oferecia a segunda: um endpoint técnico, entregue a quem tinha
            acabado de ver a página sumir. Continua tudo aqui, a um clique, para
            quem vai investigar.

            Esta caixa não consulta a prontidão como os outros avisos fazem: o
            que falhou aqui foi o **render**, e não uma chamada. Perguntar ao
            ambiente sobre um defeito de código nosso é a mesma troca de eixo
            que o resto deste trabalho desfaz.
          */}
          <DetalhesTecnicos
            detalhes={[{ rotulo: "Erro no render", texto: error.message }]}
            className="rounded-md border bg-muted px-4 py-3"
          />

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Recarregar
            </button>
          </div>
        </div>
      </div>
    );
  }
}
