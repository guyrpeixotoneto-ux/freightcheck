import { useMemo, useState } from "react";
import { ArrowLeftRight, Info } from "lucide-react";
import {
  compativelMaisProxima,
  composicaoDoArquivo,
  formamParDeVigencias,
  rotuloDaCobertura,
  TITULO_DA_OUTRA_SERIE,
  vigenciasCompativeisCom,
} from "@workspace/comparison/recorte-de-rubrica";
import { rotuloDaVigencia } from "@workspace/comparison/labels";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { numerosDaLinha, type CandidatosDoPar } from "@/lib/candidatos";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Uma vigência que pode ser escolhida como ponta. */
export interface VigenciaEscolhivel {
  id: string;
  sourceLabel: string;
  effectiveDate: string;
  entityTypeSet: string;
  /**
   * De qual unidade/operador é esta vigência.
   *
   * Está aqui porque o rótulo sozinho não distingue: um arquivo da Ambev traz
   * as cinco unidades juntas, então uma importação produz cinco vigências com o
   * **mesmo** `sourceLabel` e a **mesma** data — cinco linhas idênticas no
   * seletor. Comparar uma com a outra é o que o motor recusa (`engine.ts`), e
   * era o que o par padrão desta tela fazia sozinho.
   *
   * Quem recorta a lista pela unidade aberta é a página; quem escreve a unidade
   * no rótulo é `rotulosDasVigencias` (`lib/finame.ts`). O campo precisa chegar
   * aos dois.
   */
  scopeHash: string;
  /** A revisão da importação — o último desempate de rótulo. */
  revision?: number | null;
}

/**
 * Os dois seletores de vigência — e o botão que inverte o par.
 *
 * ---------------------------------------------------------------------------
 * Por que inverter não é trocar o sinal na tela
 * ---------------------------------------------------------------------------
 * Porque o percentual não é simétrico. Ir de 100 para 110 é +10,0%; voltar de
 * 110 para 100 é −9,09%, e não −10,0% — a base do percentual passou a ser a
 * outra ponta. Uma tela que negasse o sinal do número que já tem mostraria
 * −10,0% na volta, que é um número que não existe.
 *
 * Então o botão troca os dois parâmetros e **pede o par invertido ao motor**,
 * que calcula B×A de verdade. É mais uma consulta e é a única forma de o número
 * continuar verdadeiro.
 *
 * As opções são exatamente as vigências que o acervo entregou (`/snapshots`),
 * nunca um calendário: um seletor de datas ofereceria meses que não existem, e
 * a recusa viria depois do clique.
 *
 * ---------------------------------------------------------------------------
 * "De" e "Para", e não "Anterior" e "Atual"
 * ---------------------------------------------------------------------------
 * Os dois campos não guardam um **estado** — guardam as duas pontas de uma
 * **direção**. Chamar o da direita de "Vigência Atual" afirmaria que ele é a
 * última do acervo, e ele não é: qualquer vigência pode ser escolhida ali, e o
 * botão no meio troca as duas de lado. No clique seguinte o rótulo estaria
 * mentindo sobre o que está na caixa.
 *
 * "De" e "Para" continuam verdadeiros depois de inverter, e são o vocabulário
 * em que o resultado já é lido: a parcela saiu de X e chegou em Y. As colunas
 * da tabela e as da gaveta do veículo usam as mesmas duas palavras.
 *
 * ---------------------------------------------------------------------------
 * Por que ele mora em `components/comparacao/` e não na pasta de uma tela
 * ---------------------------------------------------------------------------
 * Porque agora são duas as telas que escolhem um par de vigências — a Auditoria
 * de FINAME e a de IPVA —, e serão mais à medida que as rubricas do Custo Fixo
 * ganharem tela. Ele nasceu em `components/finame/` e mudou de endereço no dia
 * em que a segunda chegou: uma cópia por rubrica divergiria no primeiro ajuste
 * que alguém fizesse numa e esquecesse nas outras, e o aviso sobre a
 * assimetria do percentual — que é a única coisa difícil desta peça — é o que
 * menos pode existir em duas versões.
 *
 * O que ele **não** faz é adivinhar o par. Qual vigência abre selecionada é
 * decisão da tela, que conhece a série que interessa a ela.
 */
export function SeletorDoPar({
  vigencias,
  rotulos,
  base,
  comparada,
  onBase,
  onComparada,
  onInverter,
  carregando = false,
  idPrefixo,
  candidatos,
  carregandoCandidatos = false,
  erroDosCandidatos = null,
  foco = null,
}: {
  vigencias: VigenciaEscolhivel[];
  /**
   * O texto de cada vigência, por id — já desempatado por quem o montou.
   *
   * Vem de fora e não é calculado aqui porque desempatar é uma decisão sobre a
   * **lista inteira**: só olhando as outras dá para saber se esta precisa dizer
   * a unidade. Um componente que escrevesse o rótulo linha a linha é
   * exatamente o que produzia cinco `EMPURRADA_1_6_2026 · 01/06/2026` seguidas.
   */
  rotulos: ReadonlyMap<string, string>;
  /**
   * O que cada candidata a "De" produz contra o "Para" aberto — por id.
   *
   * `undefined` enquanto a pergunta está no ar; uma entrada com `numeros: null`
   * é a candidata que o servidor ainda não calculou. Os dois casos escrevem a
   * mesma coisa na linha: **nada**.
   *
   * Quem pergunta é a página, e pergunta **no carregamento dela** — não na
   * abertura do menu. O componente não tem mais opinião sobre isso: ele desenha
   * o que chegou, e um esqueleto enquanto não chegou.
   *
   * Opcional, e é o que mantém a Auditoria de IPVA intacta: sem a propriedade,
   * o menu é exatamente o que era antes. Quando houver `/ipva/candidatos`,
   * basta a tela passar a resposta — o componente já sabe desenhá-la.
   */
  candidatos?: CandidatosDoPar;
  /** Há pergunta em voo: as linhas sem número mostram esqueleto, não vazio. */
  carregandoCandidatos?: boolean;
  /** A falha da pergunta pelos números, quando houve uma. */
  erroDosCandidatos?: string | null;
  base: string;
  comparada: string;
  onBase: (id: string) => void;
  onComparada: (id: string) => void;
  onInverter: () => void;
  carregando?: boolean;
  /**
   * O equipamento da aba aberta — o que dá sentido ao grupo de baixo.
   *
   * Na aba Cavalo, uma vigência `CARRETA+CAVALO` é "Cavalo com carreta"; na de
   * Carreta, a mesma vigência é "Carreta com cavalo". A frase é lida da
   * pergunta que está sendo feita, e não de um rótulo fixo que obrigaria quem
   * lê a traduzir. `null` é a aba que mostra os dois.
   */
  foco?: string | null;
  /**
   * O prefixo dos `id` dos dois campos — `finame`, `ipva`.
   *
   * Existe porque `id` é global na página e `<label htmlFor>` resolve pelo
   * primeiro que encontra: duas telas com o mesmo `finame-base` funcionariam
   * até o dia em que as duas fossem montadas juntas, e então o rótulo de uma
   * passaria a focar o campo da outra.
   */
  idPrefixo: string;
}) {
  /*
    O rótulo desempatado, e — só se ele faltar — a vigência escrita aqui.

    O reserva era `EMPURRADA_1_6_2026 · 01/06/2026`: o nome do arquivo e a data
    em dígitos, que é o idioma que esta tela deixou de falar. Ele agora usa a
    mesma função do resto da casa (`rotuloDaVigencia`), com as datas da própria
    lista por contexto, e sai `junho/2026 · 1ª quinzena` como todas as outras
    linhas. É um caminho que não deveria ser tomado — `rotulos` cobre a lista
    inteira —, e mesmo assim ele não pode ser o único lugar da tela escrevendo
    a vigência de outro jeito.
  */
  const datasDaLista = useMemo(() => vigencias.map((v) => v.effectiveDate), [vigencias]);
  const rotulo = (v: VigenciaEscolhivel) =>
    rotulos.get(v.id) ?? rotuloDaVigencia(v.effectiveDate, datasDaLista);

  const porId = useMemo(
    () => new Map(vigencias.map((v) => [v.id, v] as const)),
    [vigencias],
  );
  const escolhida = porId.get(base);
  const destino = porId.get(comparada);

  /**
   * Qual dos dois campos está livre — e por que um deles precisa estar.
   *
   * Se os dois recortassem um ao outro, o par ficaria preso na cobertura em que
   * abriu: com `CAVALO+CARRETA` dos dois lados, nenhuma caixa ofereceria as
   * vigências só de cavalo, e não haveria gesto nenhum que levasse àquela
   * série. A saída é o campo que a pessoa **está mexendo** oferecer o acervo
   * inteiro da unidade, e o outro seguir atrás: escolher ali reancora o par e
   * arrasta a outra ponta para a compatível mais próxima.
   *
   * O efeito prático é o critério de aceite: o par em tela é sempre um par que
   * o motor aceita, e ainda assim dá para ir de uma cobertura à outra num
   * clique.
   */
  const [ancora, setAncora] = useState<"base" | "comparada">("base");
  const referencia = ancora === "base" ? escolhida : destino;

  /**
   * As opções de um campo: as que formam par, e as que trocariam o par.
   *
   * `resto` só existe no campo ancorado — é a saída para outra cobertura. No
   * campo dependente ele é vazio, e é isso que garante que nenhum par recusado
   * pelo motor possa ser montado clicando: o que está lá já é compatível com a
   * outra ponta.
   */
  const opcoes = (papel: "base" | "comparada") => {
    const outra = papel === "base" ? destino : escolhida;
    if (!outra) return { compativeis: vigencias, resto: [] as VigenciaEscolhivel[] };
    const compativeis = vigenciasCompativeisCom(vigencias, outra);
    const resto =
      ancora === papel
        ? vigencias.filter((v) => v.id !== outra.id && !formamParDeVigencias(v, outra))
        : [];
    return { compativeis, resto };
  };

  /**
   * Escolher numa das caixas — e levar a outra junto quando ela deixou de valer.
   *
   * Sem o arrasto, trocar o "De" para uma cobertura diferente deixaria em tela
   * um par que o motor recusa, e a tela abriria no erro. Com ele, a outra ponta
   * vai para a vizinha compatível — o mês ao lado, que é o par que quem audita
   * quase sempre quer. Quando não há vizinha nenhuma, a ponta fica **vazia** de
   * propósito: a página não consulta par incompleto, e a frase abaixo dos
   * campos explica o que falta importar.
   */
  const escolher = (papel: "base" | "comparada", id: string) => {
    setAncora(papel);
    const nova = porId.get(id);
    const outra = papel === "base" ? destino : escolhida;
    const definirOutra = papel === "base" ? onComparada : onBase;
    (papel === "base" ? onBase : onComparada)(id);
    if (!nova) return;
    if (!outra || !formamParDeVigencias(outra, nova)) {
      definirOutra(compativelMaisProxima(vigencias, nova)?.id ?? "");
    }
  };

  /**
   * A vigência escolhida não tem com quem se comparar — e a tela diz isso.
   *
   * É o estado que a importação de carreta produziu no acervo real: uma
   * cobertura que existe numa vigência só. Antes ele chegava como caixa muda e
   * comparação recusada depois do clique; agora é uma frase que nomeia a
   * cobertura e diz o que fazer.
   */
  const semCompativel = Boolean(
    referencia && vigenciasCompativeisCom(vigencias, referencia).length === 0,
  );
  const aviso = referencia
    ? `Não há outra vigência com cobertura de ${rotuloDaCobertura(
        referencia.entityTypeSet,
      )} disponível para comparação. Importe os dados correspondentes na vigência desejada.`
    : "";

  const numerosDe = (id: string) =>
    numerosDaLinha(candidatos?.candidatos.find((c) => c.id === id)?.numeros ?? null);

  /**
   * Ainda vem número — e é isto, não "há requisição no ar", que o esqueleto diz.
   *
   * A diferença aparece entre duas rodadas: a resposta chegou com pendentes, a
   * seguinte ainda não partiu, e por um instante `carregandoCandidatos` é falso
   * com metade das linhas sem número. Amarrado só a ele, o esqueleto sumia e
   * voltava a cada rodada, e a lista piscava enquanto se preenchia. `pendentes`
   * é o que o servidor diz que ainda deve; enquanto ele não zera, a linha sem
   * número está esperando, e é isso que ela mostra.
   */
  const faltamNumeros = carregandoCandidatos || (candidatos?.pendentes ?? 0) > 0;

  /**
   * A linha do menu: a vigência à esquerda, o que o par produz à direita.
   *
   * Sem números, a linha é só a vigência — e um esqueleto no lugar deles
   * enquanto ainda houver número a chegar. O esqueleto é deliberado: ele diz
   * "está vindo" sem escrever um valor, que é a única coisa que não se pode
   * fazer aqui (ver `numerosDaLinha`). Quando a fila termina, ele some: uma
   * linha que ficasse em esqueleto para sempre prometeria um número que não
   * vem.
   */
  /**
   * O `ItemText` do Radix encolhe, e era ele que desalinhava a coluna direita.
   *
   * `SelectItem` desenha `<Item><span indicador/><ItemText>{filhos}</ItemText></Item>`,
   * e o `ItemText` sai sem classe nenhuma: ele se ajusta ao conteúdo. O
   * `w-full` da nossa linha resolvia contra **ele**, não contra a largura do
   * item — então cada valor da direita parava a um tanto do rótulo, e a coluna
   * saía em escada. Esticar o último `span` do item devolve a régua comum.
   *
   * Mora aqui, e não em `ui/select.tsx`: são estes menus que têm duas colunas.
   */
  const ITEM_LARGO = "[&>span:last-child]:w-full";

  const linha = (
    v: VigenciaEscolhivel,
    comNumeros: boolean,
    coberturaDiferente = false,
  ) => {
    const n = comNumeros && !coberturaDiferente ? numerosDe(v.id) : null;
    return (
      <span className="flex w-full items-center justify-between gap-6">
        <span>{rotulo(v)}</span>
        {/*
          Como o arquivo veio composto, escrito onde o número estaria.

          Estas linhas nunca terão número: o servidor não as considera
          candidatas, porque o motor não compara vigências de composição
          diferente. Deixá-las em branco ao lado das que dizem "R$ 0,00 · 0
          alterações" é convidar a ler ausência de conta como ausência de
          mudança. "Somente cavalo" responde a pergunta certa — é o que separa
          esta linha das de cima, e não o equipamento, que é o mesmo.
        */}
        {coberturaDiferente ? (
          <span className="text-xs text-muted-foreground">
            {composicaoDoArquivo(v.entityTypeSet, foco)}
          </span>
        ) : n ? (
          <span className="flex flex-col items-end text-xs leading-tight">
            {n.valores.map((valor) => (
              <span
                key={valor.texto}
                className={cn(
                  "font-semibold tabular-nums",
                  /*
                    A cor sai da **mesma** leitura que escolheu o sinal
                    (`numerosDaLinha`), e não de uma segunda conta sobre o
                    número. Era o defeito que havia: a cor lia o sinal aqui, o
                    texto o escrevia lá, e bastaria uma das duas mudar para a
                    linha escrever `−` em verde.

                    Zero não é positivo nem negativo: a linha zerada fica na cor
                    do texto secundário, e o verde/vermelho continua reservado a
                    quem tem direção.
                  */
                  valor.leitura === "NEUTRO"
                    ? "text-muted-foreground"
                    : valor.leitura === "GANHO"
                      ? "text-emerald-700"
                      : "text-destructive",
                )}
              >
                {valor.texto}
              </span>
            ))}
            <span className="text-muted-foreground">{n.alteracoes}</span>
          </span>
        ) : comNumeros && faltamNumeros ? (
          <Skeleton className="h-3 w-24 rounded" />
        ) : null}
      </span>
    );
  };

  return (
    <section className="superficie px-4 py-3" aria-label="Par de vigências">
      {/*
        Uma coluna no celular, uma linha a partir de `sm` — e não uma linha que
        quebra sozinha.

        `flex-wrap` puro dava o pior dos dois: "De" e Inverter cabiam juntos na
        primeira linha e o "Para" descia sozinho, largo, desalinhado do campo
        que ele emparelha. Empilhado de propósito, os dois campos têm a mesma
        largura e o botão fica entre eles, que é a ordem em que a frase é lida
        — de X para Y — e também a ordem do foco.

        A largura mínima dos campos só vale na linha: empilhados, `min-w` não
        segura nada e ainda estoura a tela mais estreita.
      */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex flex-col gap-1.5 sm:min-w-[15rem] sm:flex-1">
          <label
            htmlFor={`${idPrefixo}-base`}
            className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-muted-foreground"
          >
            De
          </label>
          <Select value={base} onValueChange={(id) => escolher("base", id)}>
            <SelectTrigger id={`${idPrefixo}-base`} aria-label="De (vigência de origem)">
              {/*
                O campo fechado mostra **só a vigência**, e não a linha inteira
                da lista.

                Por padrão o Radix repete no gatilho os filhos do item
                escolhido, e isso punha `+R$ 7.238,85/mês · 7 alterações` dentro
                da caixa — a dois centímetros do cartão "Impacto financeiro",
                que publica o mesmo número maior e com rótulo. Número repetido
                não confirma nada: só divide a atenção, e no dia em que os dois
                divergirem por um arredondamento é ele que vira a dúvida.

                Na lista o número é o que faz escolher; escolhido, ele já está
                dito na tela inteira.
              */}
              <SelectValue placeholder="Escolha a vigência de origem">
                {escolhida ? rotulo(escolhida) : null}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(() => {
                const { compativeis, resto } = opcoes("base");
                return (
                  <>
                    {compativeis.map((v) => (
                      <SelectItem key={v.id} value={v.id} className={ITEM_LARGO}>
                        {linha(v, true)}
                      </SelectItem>
                    ))}
                    {compativeis.length === 0 && (
                      <p className="px-2 py-1.5 text-xs text-muted-foreground">{aviso}</p>
                    )}
                    {resto.length > 0 && (
                      <>
                        <SelectSeparator />
                        <SelectGroup>
                          <SelectLabel className="text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                            {TITULO_DA_OUTRA_SERIE}
                          </SelectLabel>
                          {resto.map((v) => (
                            <SelectItem key={v.id} value={v.id} className={ITEM_LARGO}>
                              {linha(v, true, true)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </>
                    )}
                  </>
                );
              })()}
              {/*
                A falha não tira o menu do ar: escolher a vigência continua
                possível, e o que se perde é só a coluna da direita. A frase é
                a do servidor — desde `apresentar-erro.ts`, ela é uma frase.
              */}
              {erroDosCandidatos && (
                <p className="border-t px-2 py-1.5 text-xs text-muted-foreground">
                  {erroDosCandidatos}
                </p>
              )}
            </SelectContent>
          </Select>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={onInverter}
          disabled={carregando || !base || !comparada}
          aria-label="Inverter: trocar a vigência de origem com a de destino"
          className="w-full gap-2 sm:w-auto"
        >
          <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
          Inverter
        </Button>

        <div className="flex flex-col gap-1.5 sm:min-w-[15rem] sm:flex-1">
          <label
            htmlFor={`${idPrefixo}-comparada`}
            className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-muted-foreground"
          >
            Para
          </label>
          <Select value={comparada} onValueChange={(id) => escolher("comparada", id)}>
            <SelectTrigger id={`${idPrefixo}-comparada`} aria-label="Para (vigência de destino)">
              {/*
                O texto sai do acervo inteiro, e não da lista recortada.

                A caixa mostra o rótulo do item escolhido, e o recorte pode
                deixá-lo de fora por um quadro — entre a troca do "De" e o
                arrasto desta ponta. Lido da lista, o campo piscaria o
                `placeholder` no meio de uma escolha que já aconteceu.
              */}
              <SelectValue placeholder="Escolha a vigência de destino">
                {destino ? rotulo(destino) : null}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(() => {
                const { compativeis, resto } = opcoes("comparada");
                return (
                  <>
                    {compativeis.map((v) => (
                      <SelectItem key={v.id} value={v.id} className={ITEM_LARGO}>
                        {linha(v, false)}
                      </SelectItem>
                    ))}
                    {compativeis.length === 0 && (
                      <p className="px-2 py-1.5 text-xs text-muted-foreground">{aviso}</p>
                    )}
                    {resto.length > 0 && (
                      <>
                        <SelectSeparator />
                        <SelectGroup>
                          <SelectLabel className="text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                            {TITULO_DA_OUTRA_SERIE}
                          </SelectLabel>
                          {resto.map((v) => (
                            <SelectItem key={v.id} value={v.id} className={ITEM_LARGO}>
                              {linha(v, false, true)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </>
                    )}
                  </>
                );
              })()}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/*
        A frase que a caixa vazia não diz sozinha.

        Ela fica **fora** do menu de propósito: o menu só aparece depois do
        clique, e quem abre a tela num par impossível precisa ler o motivo sem
        abrir nada. `role="status"` porque o texto troca sem a página navegar —
        é o leitor de tela sabendo que a escolha anterior mudou o que cabe aqui.
      */}
      {semCompativel && (
        <p
          role="status"
          className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <Info className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
          <span>{aviso}</span>
        </p>
      )}

      <p className="mt-3 flex items-start gap-2 border-l-2 border-border pl-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
        <span>
          Inverter troca o par pedido ao motor: a diferença muda de sinal, e a variação
          muda de sinal <strong className="font-semibold">mas não de magnitude</strong> —
          a base do percentual passa a ser a outra vigência.
        </span>
      </p>
    </section>
  );
}
