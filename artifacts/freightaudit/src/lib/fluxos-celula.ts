/**
 * A SESSÃO DE EDIÇÃO DE UMA CÉLULA — a lógica, fora do componente.
 *
 * O que a célula editável da Lista faz não é desenho: é uma máquina de estados
 * pequena e cheia de arestas, e todas as arestas são casos em que a pessoa
 * perde trabalho ou o servidor recebe uma escrita a mais. Ela mora aqui, pura,
 * porque é assim que dá para prová-la sem DOM — do mesmo jeito que as projeções
 * do fluxo.
 *
 * ---------------------------------------------------------------------------
 * A trava, que é o coração disto
 * ---------------------------------------------------------------------------
 *
 * `Enter` grava e fecha o campo. Fechar o campo tira o foco. Tirar o foco
 * dispara o `blur`, que também grava. O resultado, sem trava, são **duas**
 * requisições para uma edição — e as duas montadas a partir de um cache que a
 * primeira ainda não atualizou, que é a receita de uma gravação desfazer a
 * outra.
 *
 * Então a sessão de edição **tranca na primeira decisão** — gravar ou desistir
 * — e só destranca quando alguém abre a célula de novo, ou quando a gravação
 * falha e há o que tentar outra vez. `Esc` tranca também: desistir não pode
 * acabar gravando pelo `blur` que vem logo atrás.
 *
 * ---------------------------------------------------------------------------
 * O que "não mudou" quer dizer
 * ---------------------------------------------------------------------------
 *
 * Abrir uma célula, ler o valor e sair é o gesto mais comum de quem confere uma
 * tabela — e não pode virar uma escrita. A comparação é feita com os dois lados
 * aparados, porque é isso que o servidor grava: `"Fiscal "` e `"Fiscal"` são o
 * mesmo valor, e mandar um PUT para trocar um pelo outro seria uma alteração
 * inventada no histórico de todo mundo.
 */

export interface EstadoDaCelula {
  /** O campo está aberto para digitação. */
  editando: boolean;
  /** O que está digitado — não necessariamente o que está gravado. */
  rascunho: string;
  /** Já gravou ou já desistiu nesta sessão: nenhuma segunda gravação sai. */
  travada: boolean;
  /** Há uma gravação em curso — só desta célula, nunca da tabela. */
  salvando: boolean;
  /** A frase do servidor, quando a última gravação falhou. */
  erro: string | null;
  /** O valor gravado, enquanto a recarga do fluxo não chega com ele. */
  salvo: string | null;
}

export type AcaoDaCelula =
  /** Alguém clicou na célula: abre e destranca. */
  | { tipo: "abrir" }
  | { tipo: "digitar"; valor: string }
  /** `Esc`: restaura o valor gravado e tranca. */
  | { tipo: "cancelar"; valorGravado: string }
  /**
   * `Enter`, `Tab` ou sair do campo. `saindo` diz que o foco já foi embora — aí
   * um erro fica visível na célula fechada, em vez de reabrir o campo e roubar
   * o foco de onde a pessoa já está digitando.
   */
  | { tipo: "confirmar"; valorGravado: string; saindo: boolean }
  | { tipo: "gravou"; valor: string }
  | { tipo: "falhou"; frase: string; saindo: boolean }
  /** O valor gravado mudou por fora — outra visualização, outra pessoa. */
  | { tipo: "sincronizar"; valorGravado: string };

export interface PassoDaCelula {
  estado: EstadoDaCelula;
  /** O valor a gravar, ou `null` quando este passo não grava nada. */
  gravar: string | null;
}

export function celulaEmRepouso(valorGravado: string): EstadoDaCelula {
  return {
    editando: false,
    rascunho: valorGravado,
    travada: false,
    salvando: false,
    erro: null,
    salvo: null,
  };
}

const parado = (estado: EstadoDaCelula): PassoDaCelula => ({ estado, gravar: null });

/**
 * O passo seguinte da célula — estado novo e, quando for o caso, o que gravar.
 *
 * Devolve o **mesmo objeto** de estado quando nada muda: é o que faz o efeito
 * de sincronização não virar um laço de renderização.
 */
export function reduzirCelula(estado: EstadoDaCelula, acao: AcaoDaCelula): PassoDaCelula {
  switch (acao.tipo) {
    case "abrir":
      return parado({ ...estado, editando: true, travada: false });

    case "digitar":
      return parado({ ...estado, rascunho: acao.valor });

    case "cancelar":
      return parado({
        ...estado,
        editando: false,
        travada: true,
        rascunho: acao.valorGravado,
        erro: null,
      });

    case "confirmar": {
      /* A segunda confirmação da mesma sessão — o `blur` depois do `Enter`. */
      if (estado.travada) return parado(estado);
      if (estado.rascunho.trim() === acao.valorGravado.trim()) {
        return parado({ ...estado, editando: false, travada: true, erro: null });
      }
      return {
        estado: {
          ...estado,
          editando: false,
          travada: true,
          salvando: true,
          erro: null,
        },
        gravar: estado.rascunho,
      };
    }

    case "gravou":
      return parado({ ...estado, salvando: false, erro: null, salvo: acao.valor.trim() });

    case "falhou":
      return parado({
        ...estado,
        salvando: false,
        erro: acao.frase,
        /* Destranca: uma falha tem de poder ser tentada de novo. */
        travada: false,
        editando: !acao.saindo,
      });

    case "sincronizar": {
      const gravado = acao.valorGravado;
      const seguindo = !estado.editando && estado.erro === null && estado.rascunho !== gravado;
      const alcancado = estado.salvo !== null && estado.salvo === gravado.trim();
      if (!seguindo && !alcancado) return parado(estado);
      return parado({
        ...estado,
        rascunho: seguindo ? gravado : estado.rascunho,
        salvo: alcancado ? null : estado.salvo,
      });
    }
  }
}
