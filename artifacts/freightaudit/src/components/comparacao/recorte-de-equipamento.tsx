import { rotuloDaCobertura } from "@workspace/comparison/recorte-de-rubrica";
import { cn } from "@/lib/utils";

/** O recorte aberto: os dois tipos, ou os dois juntos. */
export type RecorteDeTipo = "TODOS" | "CAVALO" | "CARRETA";

export const RECORTES: readonly RecorteDeTipo[] = ["TODOS", "CAVALO", "CARRETA"];

/**
 * Uma quarta aba que **não é um recorte** — hoje, só a Evolução do FINAME.
 *
 * ---------------------------------------------------------------------------
 * Por que ela é opcional, e não um quarto item de `RECORTES`
 * ---------------------------------------------------------------------------
 * Porque este controle é de quatro auditorias — FINAME, IPVA, Lucro Fixo e
 * Impostos — e só uma delas tem uma evolução para abrir. Acrescentar a aba à
 * lista a faria brotar nas outras três, onde ela levaria a lugar nenhum.
 * Ausente esta prop, o componente renderiza exatamente os três de sempre.
 *
 * ---------------------------------------------------------------------------
 * O que ela custa, e o que paga esse custo
 * ---------------------------------------------------------------------------
 * A fileira deixa de ser homogênea: três botões escolhem *o que se audita* e um
 * escolhe *como se lê*. É o preço de a evolução ficar ao lado de Carreta, e ele
 * é pago em três lugares:
 *
 * 1. **Um fio antes dela.** A separação visual é a única coisa que diz, sem
 *    texto, que aquele botão não é o quarto equipamento.
 * 2. **A tela aberta repõe o recorte.** Quem entra na Evolução encontra lá
 *    dentro um seletor Cavalo + Carreta / Cavalo / Carreta próprio — sem ele, a
 *    aba teria comido o filtro que ela substitui na fileira.
 * 3. **O recorte anterior não é perdido.** Ele continua no endereço e volta
 *    como estava ao sair — a aba não escolhe equipamento nenhum, nem ao entrar
 *    nem ao sair.
 */
export interface AbaExtraDoRecorte {
  rotulo: string;
  ativa: boolean;
  onAbrir: () => void;
  /** Por que está desabilitada, quando está. Vira o `title`, como nos outros. */
  indisponivel?: string;
}

/**
 * A SÉRIE QUE SE AUDITA — CAVALO, CARRETA, OU OS DOIS.
 *
 * ---------------------------------------------------------------------------
 * Por que ele subiu para o topo da tela
 * ---------------------------------------------------------------------------
 * Porque ele já existia e ninguém o achava. As quatro auditorias de grão
 * equipamento tinham um seletor "Tipo de equipamento" na fileira de filtros, ao
 * lado da busca e abaixo dos cartões — e o relato que originou esta peça foi
 * *"não seria melhor termos a aba Cavalo e a aba Carreta?"*, de quem estava com
 * a tela aberta e o seletor a um palmo do cursor. Um eixo de leitura escondido
 * entre refinamentos de tabela é um eixo que não se usa.
 *
 * E ele filtrava pouco: alcançava a tabela e a contagem das abas de estado, não
 * os cartões nem os gráficos, que vêm prontos do servidor. Quem achasse o
 * seletor lia a tabela de cavalo sob os cartões de cavalo **mais** carreta — o
 * número de um recorte sob o título de outro, que é o defeito que este produto
 * persegue em toda parte.
 *
 * ---------------------------------------------------------------------------
 * Por que ele fica acima do par de vigências
 * ---------------------------------------------------------------------------
 * Porque ele **manda** no par, e não o contrário: na aba Cavalo o seletor só
 * oferece vigências que têm cavalo, na de Carreta só as que têm carreta, e em
 * Cavalo + Carreta o acervo de equipamento inteiro. A ordem na tela é a ordem
 * da decisão — primeiro o que se audita, depois entre quais datas.
 *
 * É o mesmo padrão que Chamados já usa, onde a vigência é escolhida dentro da
 * aba (Cavalo, Carreta, Trecho). Aqui ele chegou depois, e pelo mesmo motivo:
 * um seletor que oferece a série errada só revela o erro depois do clique.
 *
 *
 * ---------------------------------------------------------------------------
 * Por que não é uma segunda fileira de abas
 * ---------------------------------------------------------------------------
 * Porque a tela já tem uma — Todas as alterações, Alterados, Novos, Ausentes,
 * Dado incompleto, Conflito, Sem alteração —, e ela é sobre a tabela. Duas
 * fileiras iguais empilhadas seriam duas perguntas disputando o mesmo gesto,
 * sem nada na forma dizendo qual manda em quê. Este controle é um segmento
 * fechado, acima dos cartões: a posição e o desenho dizem que ele governa a
 * tela inteira, e a fileira de abas continua governando a lista.
 */
export function RecorteDeEquipamento({
  valor,
  onValor,
  disponiveis,
  motivoDoVazio,
  idPrefixo,
  abaExtra,
  aoLado,
}: {
  valor: RecorteDeTipo;
  onValor: (v: RecorteDeTipo) => void;
  /**
   * Quais recortes a unidade aberta tem — o que decide se cada um é oferecido.
   *
   * Sai da **lista de vigências**, e não da comparação carregada. É o que
   * permite o controle viver acima do par: ele precisa estar em tela e correto
   * antes de existir comparação nenhuma, e a pergunta que ele responde — "esta
   * unidade tem carreta?" — já está respondida na cobertura das vigências.
   *
   * Uma aba clicável sobre uma unidade que não tem carreta leva a uma tela
   * vazia que não explica nada, que é a mesma falha que o seletor de vigências
   * tinha. Aqui o botão fica desabilitado e diz por quê: a ausência é a
   * notícia, e ela tem de estar escrita, não deduzida de uma tabela em branco.
   */
  disponiveis: Record<RecorteDeTipo, boolean>;
  /**
   * Por que um recorte está vazio, quando a razão **não** é a unidade.
   *
   * O motivo padrão — "nenhuma vigência desta unidade tem carreta" — vale para as
   * auditorias em que a rubrica existe nos dois equipamentos e o acervo é que não
   * tem um deles. Não vale para a Manutenção: ali a carreta está desabilitada
   * porque o `Modelo_Carreta` **não declara coluna de manutenção nenhuma**, e
   * mandar importar o arquivo correspondente seria pedir à pessoa um arquivo que
   * já chegou e que não responde a pergunta.
   *
   * Uma frase errada num botão desabilitado custa mais do que botão nenhum: ela
   * manda trabalhar à toa.
   */
  motivoDoVazio?: Partial<Record<RecorteDeTipo, string>>;
  idPrefixo: string;
  /** Ver {@link AbaExtraDoRecorte}. Ausente, a fileira é só os três recortes. */
  abaExtra?: AbaExtraDoRecorte;
  /**
   * Um segundo grupo, **na outra ponta da mesma barra** — hoje, só o seletor de
   * fonte da Auditoria de FINAME.
   *
   * ---------------------------------------------------------------------------
   * Por que dentro desta barra, e não numa própria
   * ---------------------------------------------------------------------------
   * Porque os dois grupos são a mesma decisão lida da esquerda para a direita:
   * **o que** se analisa, e **de onde** vem o dado. Uma segunda barra logo
   * abaixo custaria altura e sugeriria hierarquia — dois controles empilhados
   * parecem um governar o outro. Lado a lado, com um fio entre eles, eles se
   * leem como o que são: dois eixos ortogonais da mesma escolha.
   *
   * ---------------------------------------------------------------------------
   * A ausência desta prop não muda nada, e isso é o ponto
   * ---------------------------------------------------------------------------
   * Sem ela a barra continua sendo o `inline-flex` de sempre, largura do
   * conteúdo — que é o que IPVA, Lucro Fixo e Impostos desenham hoje. Com ela a
   * barra passa a ocupar a linha inteira para poder empurrar o segundo grupo
   * para a direita. É a única diferença, e ela só existe onde alguém pediu.
   *
   * Em tela estreita o grupo quebra para a segunda linha (`flex-wrap`) em vez de
   * espremer as abas ou passar por cima delas.
   */
  aoLado?: React.ReactNode;
}) {
  const rotulo = (r: RecorteDeTipo) =>
    r === "TODOS" ? "Cavalo + Carreta" : rotuloDaCobertura(r);

  /* Com a aba extra aberta, **nenhum** recorte aparece marcado. O recorte
     continua guardado e volta ao sair; o que ele não pode é seguir aceso sob
     uma tela que não é a dele — dois botões marcados na mesma fileira diriam
     que os dois estão valendo. */
  const extraAtiva = abaExtra?.ativa === true;

  return (
    <div
      role="tablist"
      aria-label="Recorte por equipamento"
      className={cn(
        "flex flex-wrap items-center gap-1 rounded-lg border bg-muted/40 p-1",
        aoLado ? "w-full justify-between" : "inline-flex",
      )}
    >
      <div className="flex flex-wrap items-center gap-1">
      {RECORTES.map((r) => {
        /* "Cavalo + Carreta" nunca desabilita: é a tela que já existia, e ela
           responde por qualquer acervo — inclusive o vazio, dizendo que está
           vazio. */
        const vazio = r !== "TODOS" && !disponiveis[r];
        return (
          <button
            key={r}
            id={`${idPrefixo}-recorte-${r.toLowerCase()}`}
            type="button"
            role="tab"
            aria-selected={!extraAtiva && valor === r}
            disabled={vazio}
            title={
              vazio
                ? (motivoDoVazio?.[r] ??
                  `Nenhuma vigência desta unidade tem ${rotulo(r).toLowerCase()}. Importe o arquivo correspondente para auditá-lo aqui.`)
                : undefined
            }
            onClick={() => onValor(r)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
              !extraAtiva && valor === r
                ? "bg-background text-brand shadow-sm"
                : "text-muted-foreground hover:text-foreground",
              vazio && "cursor-not-allowed opacity-40 hover:text-muted-foreground",
            )}
          >
            {rotulo(r)}
          </button>
        );
      })}

      {abaExtra && (
        <>
          {/* O fio é a única coisa que diz, sem texto, que o que vem depois
              não é o quarto equipamento. */}
          <span
            aria-hidden="true"
            className="mx-1 self-stretch border-l border-border/70"
          />
          <button
            id={`${idPrefixo}-recorte-extra`}
            type="button"
            role="tab"
            aria-selected={extraAtiva}
            disabled={Boolean(abaExtra.indisponivel)}
            title={abaExtra.indisponivel}
            onClick={abaExtra.onAbrir}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
              extraAtiva
                ? "bg-brand text-brand-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
              abaExtra.indisponivel &&
                "cursor-not-allowed opacity-40 hover:text-muted-foreground",
            )}
          >
            {abaExtra.rotulo}
          </button>
        </>
      )}
      </div>

      {aoLado}
    </div>
  );
}
