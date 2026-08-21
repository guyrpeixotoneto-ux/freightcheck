import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Check, ChevronsUpDown, Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { avisoDeParecido, motivoDoVazio, sugerir, textoParaCriar } from "@/lib/interpretacao";
import { cn } from "@/lib/utils";

/**
 * Um campo de escolha que se pesquisa e que aceita cadastrar do próprio lugar.
 *
 * ---------------------------------------------------------------------------
 * Por que não um `<Select>`
 * ---------------------------------------------------------------------------
 * Um select fechado obriga o cadastro a ser completo antes de alguém precisar
 * dele — e o cadastro nunca está completo, porque o vocabulário é da operação.
 * O que acontecia na prática era o desvio: a pessoa escolhia a opção *mais
 * parecida* com o que ela queria dizer, e a semântica gravada passava a ser uma
 * aproximação que ninguém marcou como aproximação.
 *
 * Aqui a saída é criar na hora, sem sair da tela, sem abrir outro cadastro e
 * sem recarregar. Ao criar, a opção nova já fica selecionada no campo.
 *
 * ---------------------------------------------------------------------------
 * Três regras que este componente não abre mão
 * ---------------------------------------------------------------------------
 * 1. **Criar é um clique, nunca um efeito de digitar.** O `+ Criar "…"` é uma
 *    linha do dropdown com o texto à vista. Digitar não cadastra nada.
 * 2. **O parecido aparece antes do criar.** Quem digita `combustivel` vê
 *    `Combustível` na lista *e* um aviso ao lado do botão de criar. O aviso não
 *    bloqueia — bloquear decidiria pela pessoa —, mas ele é o instante em que
 *    ela olha.
 * 3. **A opção idêntica desliga o criar.** Ver `sugerir`: com uma opção igual
 *    ou economicamente equivalente na lista, a linha de criação não aparece.
 *
 * A lógica das três mora em `@/lib/interpretacao` e é testada sem DOM. Este
 * arquivo é o desenho delas.
 *
 * ---------------------------------------------------------------------------
 * A linha de criação também aparece antes da primeira letra
 * ---------------------------------------------------------------------------
 * Quem passa `rotuloDeCriacaoVazia` diz que há um formulário do outro lado do
 * `aoCriar`, e aí cadastrar deixa de depender de digitar: a linha fica no pé do
 * dropdown com a busca em branco. Sem isso, uma lista ainda vazia respondia
 * "Nada encontrado." e mais nada — a regra 1 estava intacta, e mesmo assim o
 * único caminho até o cadastro era adivinhar que digitar um nome inexistente
 * faria surgir um botão. Ver `textoParaCriar`.
 *
 * ---------------------------------------------------------------------------
 * E onde não há o que criar aqui, há para onde ir
 * ---------------------------------------------------------------------------
 * O seletor puro — sem `aoCriar` — não tem essa saída, e é o da unidade: a
 * identidade dela nasce em Administração → Unidades, com o CNPJ conferido, e
 * é isso que a mantém fora do alcance de quem só digitou um nome. Com o
 * cadastro ainda vazio, porém, o dropdown terminava em "Nada encontrado." e
 * mais nada — a regra intacta e a pessoa sem caminho nenhum, num campo
 * obrigatório. `atalhoDeCadastro` põe a porta à vista sem abrir a mão da
 * regra: leva à tela do cadastro, e não cria coisa alguma daqui.
 */

export interface ComboboxCriavelProps<T> {
  /** O que já existe. */
  itens: T[];
  /** O item escolhido, ou `null`. */
  valor: T | null;
  aoEscolher: (item: T) => void;
  /**
   * O que fazer quando alguém clica em criar. Devolve o item cadastrado — ou
   * `null` quando o servidor recusou, e aí `erro` diz por quê.
   *
   * **Opcional, e a ausência é uma escolha de produto.** Sem ela o combobox
   * vira um seletor puro: não oferece criar, e não há como um texto digitado
   * virar item. É o que o seletor de unidade do Fechamento precisa — lá a
   * identidade da unidade é o cadastro canônico, e "usar o que digitei" seria
   * justamente o caminho que criou `CDD Belém` como código.
   */
  aoCriar?: (texto: string) => Promise<T | null>;
  rotuloDe: (item: T) => string;
  /** A segunda linha de cada opção: a leitura, o caminho, a classe. */
  detalheDe?: (item: T) => string | null;
  /** A chave econômica, quando o item tem uma. Ver `procurarProximos`. */
  chaveDe?: (item: T) => string | null;
  /** O que a tela diz que vai acontecer se criar este texto. */
  previaDe?: (texto: string) => string | null;
  placeholder: string;
  /** "Criar" / "Criar categoria" — o verbo da linha de criação. */
  rotuloDeCriacao?: (texto: string) => string;
  /**
   * O rótulo da linha de criação quando **nada** foi digitado — e, por existir,
   * o que autoriza cadastrar do zero. Só passa quem tem formulário do outro
   * lado do `aoCriar`: onde o texto vira escrita direta, o vazio seria um
   * clique que só o servidor recusaria.
   */
  rotuloDeCriacaoVazia?: string;
  /**
   * A porta para o cadastro que enche esta lista — mostrada quando não há nada
   * para escolher.
   *
   * É o par de `rotuloDeCriacaoVazia` para o seletor **puro**. Onde cadastrar é
   * um clique daqui, a saída é a linha de criação; onde a identidade nasce em
   * outra tela — a unidade, que se cadastra em Administração → Unidades com o
   * CNPJ conferido —, não há o que criar aqui, e o dropdown terminava em "Nada
   * encontrado." e ponto final. Quem chegava com o cadastro vazio ficava sem
   * caminho nenhum: nem escolher, nem criar, nem saber para onde ir.
   *
   * O atalho não afrouxa a regra que este campo protege — continua não
   * existindo "usar o que digitei", e nada é criado a partir daqui. Ele só diz
   * onde fica a porta.
   */
  atalhoDeCadastro?: { rotulo: string; para: string };
  /** Recusa do servidor, mostrada sem fechar o dropdown. */
  erro?: string | null;
  id?: string;
  disabled?: boolean;
}

export function ComboboxCriavel<T>({
  itens,
  valor,
  aoEscolher,
  aoCriar,
  rotuloDe,
  detalheDe,
  chaveDe,
  previaDe,
  placeholder,
  rotuloDeCriacao = (texto) => `Criar “${texto}”`,
  rotuloDeCriacaoVazia,
  atalhoDeCadastro,
  erro,
  id,
  disabled,
}: ComboboxCriavelProps<T>) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState("");
  const [criando, setCriando] = useState(false);
  const campoDeBusca = useRef<HTMLInputElement>(null);

  /*
    O foco vai para a busca ao abrir, e o termo é zerado ao fechar. Sem o
    primeiro, o campo pesquisável exige um clique a mais para ser pesquisado;
    sem o segundo, reabrir mostra a lista filtrada pelo que alguém procurou da
    vez anterior — e a opção que sumiu parece não existir.
  */
  useEffect(() => {
    if (!aberto) {
      setTermo("");
      return undefined;
    }
    const t = setTimeout(() => campoDeBusca.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [aberto]);

  const sugestao = useMemo(
    () => sugerir(termo, itens, rotuloDe, chaveDe),
    [termo, itens, rotuloDe, chaveDe],
  );
  const aviso = avisoDeParecido(sugestao.parecidos, rotuloDe);
  /*
    O que a linha de criação leva: o texto digitado, o vazio de quem só abriu a
    lista, ou nada. A decisão é pura e mora em `textoParaCriar` — aqui fica só o
    desenho dela.
  */
  /*
    Sem `aoCriar` não há o que criar, e a linha de criação some inteira — não
    fica desabilitada, que sugeriria um caminho que não existe. É o seletor
    puro: escolhe-se do que está cadastrado, e nada mais.
  */
  const criavel =
    aoCriar === undefined
      ? null
      : textoParaCriar(sugestao.criar, termo, rotuloDeCriacaoVazia !== undefined);
  const previa = criavel !== null && previaDe ? previaDe(criavel) : null;
  /*
    Por que não há nada para escolher — ver `motivoDoVazio`. A distinção
    importa porque muda a frase e, com ela, a saída oferecida: quem não achou
    procura de novo; quem não tem cadastro precisa é de um caminho até ele.
  */
  const vazio = motivoDoVazio(itens.length, sugestao.opcoes.length);

  const criar = async () => {
    if (criavel === null || criando) return;
    setCriando(true);
    try {
      const item = await aoCriar!(criavel);
      // Só fecha quando deu certo: a recusa precisa aparecer com o texto ainda
      // digitado, ou a pessoa perde o que escreveu junto com o motivo.
      if (item) {
        aoEscolher(item);
        setAberto(false);
      }
    } finally {
      setCriando(false);
    }
  };

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={aberto}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !valor && "text-muted-foreground")}>
            {valor ? rotuloDe(valor) : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            ref={campoDeBusca}
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            onKeyDown={(e) => {
              // Enter cria quando não há nada escolhível — o atalho de quem já
              // sabe que a opção não existe. Nunca cria quando a lista tem
              // opção: aí Enter seria uma duplicata a um toque de distância.
              if (e.key === "Enter" && sugestao.opcoes.length === 0 && sugestao.criar) {
                e.preventDefault();
                void criar();
              }
            }}
            placeholder="Pesquisar…"
            className="h-10 border-0 px-0 shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="max-h-72 overflow-y-auto p-1">
          {sugestao.opcoes.map((item, indice) => {
            const detalhe = detalheDe?.(item);
            return (
              <button
                key={indice}
                type="button"
                onClick={() => {
                  aoEscolher(item);
                  setAberto(false);
                }}
                className="flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent"
              >
                <Check
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    valor && rotuloDe(valor) === rotuloDe(item)
                      ? "opacity-100"
                      : "opacity-0",
                  )}
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{rotuloDe(item)}</span>
                  {detalhe && (
                    <span className="block text-xs text-muted-foreground">{detalhe}</span>
                  )}
                </span>
              </button>
            );
          })}

          {/*
            Lista vazia não é "nada encontrado" quando não havia onde procurar.
            A frase muda porque a anterior mandava procurar melhor, e o que
            falta ali é cadastrar — a linha de criação logo abaixo, ou o atalho
            para a tela onde o cadastro mora.
          */}
          {vazio !== null && criavel === null && (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              {vazio === "SEM_CADASTRO" ? "Nada cadastrado ainda." : "Nada encontrado."}
            </p>
          )}

          {vazio !== null && criavel === "" && (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              Nada cadastrado ainda.
            </p>
          )}

          {/*
            A porta para o cadastro, quando ela é em outra tela. Fica no vazio e
            só nele: com opção na lista, escolher é o que se veio fazer aqui.

            `Link` do wouter, e não `<a>`: o dropdown vive dentro de um
            formulário meio preenchido, e uma navegação de página inteira
            recarregaria o app e perderia o que já foi digitado nos outros
            campos.
          */}
          {vazio !== null && atalhoDeCadastro && (
            <div className="border-t pt-1">
              <Link
                href={atalhoDeCadastro.para}
                onClick={() => setAberto(false)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm font-medium text-primary hover:bg-accent"
              >
                <ArrowRight className="h-4 w-4 shrink-0" />
                <span className="truncate">{atalhoDeCadastro.rotulo}</span>
              </Link>
            </div>
          )}

          {criavel !== null && (
            <div className="border-t pt-1">
              <button
                type="button"
                onClick={() => void criar()}
                disabled={criando}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm font-medium hover:bg-accent disabled:opacity-60"
              >
                {criando ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 shrink-0" />
                )}
                <span className="truncate">
                  {criavel === "" ? rotuloDeCriacaoVazia : rotuloDeCriacao(criavel)}
                </span>
              </button>

              {/* A prévia diz o que o cadastro vai entender — a diferença entre
                  criar às cegas e criar sabendo. */}
              {previa && (
                <p className="px-2 pb-2 text-xs text-muted-foreground">{previa}</p>
              )}
              {aviso && (
                <p className="px-2 pb-2 text-xs text-amber-700">{aviso}</p>
              )}
            </div>
          )}

          {erro && (
            <p className="mx-1 my-1 rounded-md border border-red-200 bg-red-50 px-2 py-2 text-xs text-red-800">
              {erro}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
