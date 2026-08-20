import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Copy,
  Eraser,
  ImageUp,
  PencilLine,
  Save,
  ScanLine,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apresentar } from "@/lib/apresentar-erro";
import { cn } from "@/lib/utils";
import {
  copiarPlanilha,
  doCampo,
  escreverDivergencia,
  escreverValor,
  gravarPlanilha,
  lerPlanilha,
  lerPlanilhaDaImagem,
  paraOCampo,
  type BlocoApurado,
  type CadastroDaUnidade,
  type CelulaAGravar,
  type LeituraDeImagem,
  type LinhaApurada,
  type Medida,
} from "@/lib/remuneracao";
import { Legenda, MarcaDoPreenchimento } from "./comuns";

/**
 * CADASTRAR A PLANILHA — a aba de Excel digitada no produto.
 *
 * A terceira vista do cadastro, e a única que **escreve**. As outras duas leem
 * o acervo da Auditoria e dizem o que ele sustenta; esta pergunta a quem
 * preenche a planilha o que a planilha diz.
 *
 * **Por que ela existe.** O cadastro tem trinta linhas e o acervo sustenta
 * onze. As outras dezenove não esperam arquivo nenhum — esperam decisões de
 * negócio que ninguém registrou: qual conjunto de colunas forma "Remuneração
 * Fixa - Frota Fixa Ativa", qual valor de turno marca a rota noturna, o que
 * separa van de cavalo. Enquanto essas decisões não chegam, o número existe: em
 * agosto de 2026 ele está digitado na aba que a transportadora manda todo mês,
 * e o produto o ignorava. Aqui ele entra, marcado pelo que é.
 *
 * **As três regras desta tela, e cada uma existe contra um jeito de errar:**
 *
 * 1. **O campo nunca vem preenchido com o que o acervo mediu.** O número
 *    apurado aparece ao lado, como referência, e não dentro do campo. Um campo
 *    pré-preenchido com o medido faria "salvar" registrar como declaração da
 *    planilha um número que ninguém leu na planilha — e a conferência entre os
 *    dois passaria a bater sempre, por construção.
 * 2. **Pelo mesmo motivo não há botão de "usar o valor apurado".** Ele
 *    economizaria uma digitação e destruiria o produto: a divergência entre a
 *    aba e o acervo é a única coisa que esta tela existe para achar.
 * 3. **Salvar manda só o que mudou.** Quem edita um bloco não pode apagar os
 *    outros oito por não os ter tocado.
 * 4. **A imagem preenche o campo; ela não salva.** Importar um print da aba é
 *    a mesma coisa que digitar depressa: o número cai no rascunho, marcado com
 *    o texto que estava na célula, e continua esperando o "Salvar" de quem
 *    cadastra. A regra 1 não é contrariada por ela — o que a imagem traz é o
 *    que a **planilha** diz, que é exatamente o que esta tela pergunta; o que
 *    não pode entrar no campo sozinho é o que o **acervo** mediu.
 *
 * O campo relê o que entendeu ao perder o foco: `1.424` vira `1.424,00` antes
 * de qualquer clique em salvar, e quem quis dizer um vírgula quatro dois quatro
 * vê o engano na hora — ver `doCampo` para a regra de leitura.
 */

/** O símbolo de cada medida, do lado que a planilha o escreve. */
const SIMBOLO: Record<Medida, { antes: string; depois: string }> = {
  DINHEIRO: { antes: "R$", depois: "" },
  PERCENTUAL: { antes: "", depois: "%" },
  QUANTIDADE: { antes: "", depois: "" },
};

/** O que está digitado num campo — vazio na linha que ninguém informou. */
function rascunhoInicial(linha: LinhaApurada): string {
  return linha.declarado ? paraOCampo(linha.declarado.valor, linha.medida) : "";
}

export function CadastrarAPlanilha({
  dados,
  aoSalvar,
}: {
  dados: CadastroDaUnidade;
  /** Chamado depois de gravar, para a tela recarregar o cadastro montado. */
  aoSalvar?: () => void;
}) {
  const queryClient = useQueryClient();
  const linhas = useMemo(() => dados.blocos.flatMap((b) => b.linhas), [dados.blocos]);

  /*
    O rascunho é remontado quando a unidade ou a vigência muda — a `key` de
    quem monta este componente carrega as duas. Sem isso, trocar de quinzena no
    seletor deixaria na tela o que se digitou na anterior, e "salvar" gravaria a
    planilha de julho dentro de agosto.
  */
  const [rascunho, setRascunho] = useState<Record<string, string>>(() =>
    Object.fromEntries(linhas.map((l) => [l.chave, rascunhoInicial(l)])),
  );
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<string | null>(null);

  /*
    O que veio de uma imagem, por chave, guardado como o **texto da célula** —
    `R$ 1.424,00`, e não `1424`.

    Ele é a prova ao lado do campo: sem ela, um número lido de uma foto fica
    indistinguível de um número digitado por uma pessoa, e a inversão de
    vírgula que a leitura pode cometer (`5,90` virando `590`) não teria como ser
    pega de relance. A marca some no instante em que alguém edita a linha à mão
    — a partir daí o campo é dela, e dizer "veio da imagem" seria mentira.
  */
  const [daImagem, setDaImagem] = useState<Record<string, string>>({});

  const original = useMemo(
    () => Object.fromEntries(linhas.map((l) => [l.chave, rascunhoInicial(l)])),
    [linhas],
  );

  /*
    Quando o que está gravado muda, o rascunho volta a ser ele.

    O caso que isto conserta é o "copiar de outra vigência": a cópia grava trinta
    linhas no servidor, e os campos, que guardam texto em estado local,
    continuariam vazios. A tela mostraria "30 linhas alteradas" — as trinta que
    acabaram de chegar, lidas como se a pessoa as tivesse apagado — e o próximo
    "salvar" apagaria exatamente o que ela mandou copiar. Depois de gravar, o
    efeito é invisível: o servidor devolve o que foi digitado.

    A comparação é sobre o que está gravado, e não sobre a resposta inteira: um
    número de frota que mudou porque uma importação chegou não pode descartar o
    que alguém está digitando. E nada aqui recarrega sozinho — `refetchOnWindow
    Focus` é `false` no cliente (ver `lib/chamada-resiliente.ts`), então a única
    coisa que muda esta assinatura é uma escrita desta própria tela.
  */
  const assinatura = linhas
    .map((l) => `${l.chave}=${l.declarado?.valor ?? ""}`)
    .join(";");
  const [assinaturaAnterior, setAssinaturaAnterior] = useState(assinatura);
  if (assinatura !== assinaturaAnterior) {
    setAssinaturaAnterior(assinatura);
    setRascunho(original);
    setDaImagem({});
  }

  /*
    O que mudou desde que a tela abriu, comparado como texto: é o texto que a
    pessoa vê, e `"5,90"` contra `"5.9"` são a mesma coisa depois de `doCampo`,
    mas a segunda forma nunca chega aqui — o campo se reescreve ao perder o
    foco. Comparar número contra número diria "mudou" para a linha que só foi
    reformatada.
  */
  const mudadas = linhas.filter((l) => {
    const antes = original[l.chave]!;
    return (rascunho[l.chave] ?? antes) !== antes;
  });

  /** As linhas cujo texto não vira número — o que impede salvar. */
  const invalidas = mudadas.filter((l) => {
    const texto = rascunho[l.chave]?.trim() ?? "";
    return texto !== "" && doCampo(texto) === undefined;
  });

  const gravar = useMutation({
    mutationFn: () => {
      const celulas: CelulaAGravar[] = mudadas.map((linha) => {
        const texto = rascunho[linha.chave]!.trim();
        return {
          chave: linha.chave,
          valor: texto === "" ? null : (doCampo(texto) ?? null),
        };
      });
      return gravarPlanilha({
        scopeHash: dados.contexto.scopeHash,
        canal: dados.contexto.channel,
        period: dados.effectiveDate,
        celulas,
      });
    },
    onSuccess: (planilha) => {
      setErro(null);
      setSalvo(
        `${planilha.linhas.length} ${
          planilha.linhas.length === 1 ? "linha informada" : "linhas informadas"
        } nesta vigência.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["remuneracao"] });
      aoSalvar?.();
    },
    onError: (err: unknown) => {
      setSalvo(null);
      setErro(textoDoErro(err));
    },
  });

  function editar(chave: string, texto: string) {
    setSalvo(null);
    setRascunho((atual) => ({ ...atual, [chave]: texto }));
    setDaImagem((atual) => {
      if (!(chave in atual)) return atual;
      const { [chave]: _, ...resto } = atual;
      return resto;
    });
  }

  /**
   * Despeja no rascunho o que a imagem respondeu.
   *
   * Escreve por cima do que estiver no campo, inclusive do que já foi salvo, e
   * é o comportamento certo: quem manda o print da aba está dizendo qual é a
   * aba. O que ela **não** faz é apagar o que não leu — as linhas fora da
   * leitura ficam como estavam, porque uma imagem que pegou meia planilha não
   * é uma declaração de que a outra metade está vazia.
   */
  function preencherComAImagem(leitura: LeituraDeImagem) {
    const porChave = new Map(linhas.map((l) => [l.chave, l]));
    const textos: Record<string, string> = {};
    const marcas: Record<string, string> = {};

    for (const lido of leitura.valores) {
      const linha = porChave.get(lido.chave);
      if (!linha) continue;
      textos[lido.chave] = paraOCampo(lido.valor, linha.medida);
      marcas[lido.chave] = lido.comoEstaNaImagem;
    }

    setSalvo(null);
    setRascunho((atual) => ({ ...atual, ...textos }));
    setDaImagem((atual) => ({ ...atual, ...marcas }));
  }

  /** Reescreve o campo no formato canônico — o que a leitura entendeu. */
  function normalizar(linha: LinhaApurada) {
    const numero = doCampo(rascunho[linha.chave] ?? "");
    if (numero === undefined) return;
    editar(linha.chave, paraOCampo(numero, linha.medida));
  }

  return (
    <div className="space-y-6">
      <Cabecalho
        dados={dados}
        informadas={linhas.filter((l) => l.declarado !== null).length}
        aoCopiar={() => {
          setErro(null);
          setSalvo(null);
        }}
        aoErro={setErro}
        aoLerImagem={preencherComAImagem}
        aoCopiado={(quantas) => {
          setSalvo(
            quantas === 0
              ? "A vigência escolhida não tinha nada que esta já não tenha."
              : `${quantas} ${quantas === 1 ? "linha copiada" : "linhas copiadas"}.`,
          );
          aoSalvar?.();
        }}
      />

      {dados.blocos.map((bloco) => (
        <BlocoEditavel
          key={bloco.titulo}
          bloco={bloco}
          rascunho={rascunho}
          daImagem={daImagem}
          onEditar={editar}
          onNormalizar={normalizar}
        />
      ))}

      <Legenda />

      {/*
        A barra de salvar gruda no rodapé porque a planilha tem trinta linhas e
        nove blocos: com o botão só no fim, quem edita as alíquotas no topo
        precisa rolar a tela inteira para gravar duas células — e é nessa rolagem
        que se perde o que foi digitado.
      */}
      <div className="sticky bottom-0 -mx-8 border-t bg-card/95 px-8 py-4 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        {erro && (
          <Alert variant="destructive" className="mb-3">
            <AlertDescription>{erro}</AlertDescription>
          </Alert>
        )}
        {invalidas.length > 0 && (
          <Alert className="mb-3">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>
              {invalidas.length === 1
                ? `"${invalidas[0]!.rotulo}" não está com um número que dê para ler.`
                : `${invalidas.length} linhas não estão com um número que dê para ler: ` +
                  invalidas.map((l) => `"${l.rotulo}"`).join(", ")}{" "}
              Corrija antes de salvar — para deixar em branco, apague o campo.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {mudadas.length === 0 ? (
              salvo ? (
                <span className="inline-flex items-center gap-1.5 text-foreground">
                  <Check className="w-4 h-4" />
                  {salvo}
                </span>
              ) : (
                "Nada mudou desde que esta tela abriu."
              )
            ) : (
              <>
                <strong className="text-foreground">
                  {mudadas.length} {mudadas.length === 1 ? "linha alterada" : "linhas alteradas"}
                </strong>{" "}
                — as outras ficam como estão.
              </>
            )}
          </p>
          <Button
            onClick={() => gravar.mutate()}
            disabled={mudadas.length === 0 || invalidas.length > 0 || gravar.isPending}
          >
            <Save className="w-4 h-4 mr-1.5" />
            {gravar.isPending ? "Salvando…" : "Salvar a planilha desta vigência"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * O topo: onde se está gravando, e o que a vigência já tem.
 *
 * A unidade e a vigência aparecem por extenso, e não só nos seletores acima,
 * porque esta é a única vista que escreve: quem cadastra a planilha de agosto
 * dentro de julho só descobre o engano na quinzena seguinte, e o custo de
 * repetir dois rótulos é zero perto disso.
 */
function Cabecalho({
  dados,
  informadas,
  aoCopiar,
  aoCopiado,
  aoErro,
  aoLerImagem,
}: {
  dados: CadastroDaUnidade;
  informadas: number;
  aoCopiar: () => void;
  aoCopiado: (quantas: number) => void;
  aoErro: (mensagem: string) => void;
  aoLerImagem: (leitura: LeituraDeImagem) => void;
}) {
  const queryClient = useQueryClient();
  const [origem, setOrigem] = useState<string>("");

  const outras = dados.vigencias.filter((v) => v.effectiveDate !== dados.effectiveDate);

  /*
    Quantas linhas a vigência de origem tem — a pergunta que decide se o botão
    faz alguma coisa. Sem ela, "copiar" de uma quinzena vazia responderia
    "0 linhas copiadas" depois do clique, e quem clicou concluiria que a cópia
    falhou.
  */
  const daOrigem = useQuery({
    queryKey: ["remuneracao", "planilha", dados.contexto.scopeHash, dados.contexto.channel, origem],
    queryFn: () =>
      lerPlanilha({
        scopeHash: dados.contexto.scopeHash,
        canal: dados.contexto.channel,
        period: origem,
      }),
    enabled: origem !== "",
  });

  const copiar = useMutation({
    mutationFn: () =>
      copiarPlanilha({
        scopeHash: dados.contexto.scopeHash,
        canal: dados.contexto.channel,
        de: origem,
        para: dados.effectiveDate,
      }),
    onSuccess: (planilha) => {
      void queryClient.invalidateQueries({ queryKey: ["remuneracao"] });
      aoCopiado(planilha.linhas.length - informadas);
    },
    onError: (err: unknown) => aoErro(textoDoErro(err)),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <PencilLine className="w-4 h-4" />
          {dados.contexto.label} · {dados.periodLabel}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Contagem titulo="Linhas da planilha" valor={dados.resumo.linhas} />
          <Contagem titulo="Informadas" valor={informadas} />
          <Contagem titulo="Conferidas com o acervo" valor={dados.resumo.conferidas} />
          <Contagem
            titulo="Divergentes"
            valor={dados.resumo.divergentes}
            alerta={dados.resumo.divergentes > 0}
          />
        </div>

        <p className="text-xs text-muted-foreground border-t pt-3">
          O que você digitar aqui vale <strong>para esta vigência</strong> e não é medida do
          acervo: cada linha volta ao cadastro marcada como informada, com o seu nome e a data.
          Onde o acervo também responde, o número dele continua sendo o do cadastro e o seu
          aparece ao lado — é a diferença entre os dois que esta tela existe para mostrar.
        </p>

        <ImportarDaImagem aoLer={aoLerImagem} aoErro={aoErro} aoComecar={aoCopiar} />

        {outras.length > 0 && (
          <div className="flex flex-wrap items-end gap-3 border-t pt-3">
            <div className="space-y-1.5 min-w-[14rem]">
              <label
                htmlFor="copiar-de"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Copiar de outra vigência
              </label>
              <Select
                value={origem}
                onValueChange={(v) => {
                  aoCopiar();
                  setOrigem(v);
                }}
              >
                <SelectTrigger id="copiar-de">
                  <SelectValue placeholder="Escolha a vigência de origem" />
                </SelectTrigger>
                <SelectContent>
                  {outras.map((v) => (
                    <SelectItem key={v.effectiveDate} value={v.effectiveDate}>
                      {v.periodLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              disabled={origem === "" || copiar.isPending || daOrigem.data?.linhas.length === 0}
              onClick={() => copiar.mutate()}
            >
              <Copy className="w-4 h-4 mr-1.5" />
              {copiar.isPending ? "Copiando…" : "Copiar"}
            </Button>
            <p className="text-xs text-muted-foreground flex-1 min-w-[16rem]">
              {origem === ""
                ? "As alíquotas e as parcelas por veículo costumam repetir de uma quinzena para " +
                  "a outra — a própria aba traz os dois blocos iguais."
                : daOrigem.isLoading
                  ? "Vendo o que aquela vigência tem…"
                  : daOrigem.data?.linhas.length === 0
                    ? "Aquela vigência não tem planilha informada — não há o que copiar."
                    : `Traz as ${daOrigem.data?.linhas.length} linhas de lá que ainda não existem ` +
                      "aqui. O que já está preenchido nesta vigência não é sobrescrito, e a " +
                      "cópia fica no seu nome."}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * IMPORTAR A ABA DE UMA IMAGEM — o print que vira rascunho.
 *
 * O gesto que este bloco substitui é uma pessoa com o anexo aberto de um lado e
 * o formulário do outro, transcrevendo trinta linhas. A transcrição é onde o
 * erro entra: o salto de linha, o total copiado para a parcela de cima, o
 * `5,90` digitado como `0,059`.
 *
 * **Ele preenche, e para aí.** Nada é gravado: os números caem nos campos como
 * rascunho, cada um marcado com o texto que estava na célula, e o "Salvar"
 * continua sendo de quem cadastra. É por isso que o botão pode existir sem
 * contrariar a primeira regra desta tela — o que ele traz é o que a **planilha**
 * diz, e não o que o acervo mediu.
 *
 * **O resultado é dito em três partes.** Quantas linhas entraram, quais a
 * imagem não mostrou e quais ela mostrou mas a regra da linha recusou. A
 * terceira é a que importa mais e é a que um resumo em número só apagaria: uma
 * alíquota lida como `590` não é uma linha a menos, é um aviso de que a foto
 * está sendo lida errado.
 */
function ImportarDaImagem({
  aoLer,
  aoErro,
  aoComecar,
}: {
  aoLer: (leitura: LeituraDeImagem) => void;
  aoErro: (mensagem: string) => void;
  aoComecar: () => void;
}) {
  const [resumo, setResumo] = useState<string | null>(null);
  const [ressalva, setRessalva] = useState<string | null>(null);

  const ler = useMutation({
    mutationFn: async (arquivo: File) => {
      const dados = await base64De(arquivo);
      return lerPlanilhaDaImagem({ imagem: dados, mimeType: arquivo.type });
    },
    onSuccess: (leitura) => {
      if (leitura.motivo === "SEM_CHAVE") {
        setResumo(null);
        setRessalva(null);
        aoErro(
          "A leitura de imagem não está configurada neste ambiente — falta a chave do modelo. " +
            "Os campos continuam abertos para digitar.",
        );
        return;
      }
      if (leitura.motivo !== "IA") {
        setResumo(null);
        setRessalva(null);
        aoErro(
          leitura.erro ??
            "Não consegui ler esta imagem. Um print da aba inteira, sem corte e sem giro, " +
              "costuma resolver.",
        );
        return;
      }

      aoLer(leitura);

      const lidas = leitura.valores.length;
      setResumo(
        lidas === 0
          ? "Não achei nenhuma linha do cadastro nesta imagem — confira se é a aba de parâmetros."
          : `${lidas} ${lidas === 1 ? "linha preenchida" : "linhas preenchidas"} a partir da ` +
            "imagem. Confira cada uma e salve — nada foi gravado ainda.",
      );

      /*
        As recusadas vêm antes das não encontradas quando as duas existem: uma
        linha em branco na foto é rotina, e uma linha que a regra barrou é
        sinal de que a leitura entendeu a vírgula ao contrário — que é o
        defeito que estraga a quinzena inteira sem aparecer.
      */
      setRessalva(
        leitura.recusadas.length > 0
          ? `${leitura.recusadas.length} ${
              leitura.recusadas.length === 1 ? "linha ficou de fora" : "linhas ficaram de fora"
            } porque o valor lido não passa na regra da linha (${leitura.recusadas
              .map((r) => `"${r.comoEstaNaImagem}"`)
              .join(", ")}). Digite essas à mão.`
          : leitura.naoEncontradas.length > 0
            ? `${leitura.naoEncontradas.length} ${
                leitura.naoEncontradas.length === 1
                  ? "linha do cadastro não aparece"
                  : "linhas do cadastro não aparecem"
              } nesta imagem, e ficaram como estavam.`
            : null,
      );
    },
    onError: (err: unknown) => {
      setResumo(null);
      setRessalva(null);
      aoErro(textoDoErro(err));
    },
  });

  /*
    O `Button` deste repositório declara `asChild` e não o implementa — ele
    sempre desenha um `<button>`. Um `<label>` embrulhado nele viraria HTML
    inválido e não abriria o seletor de arquivo; o `input` fica fora e o botão
    o aciona por referência, que funciona nos dois casos.
  */
  const entrada = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-wrap items-center gap-3 border-t pt-3">
      <Button
        variant="outline"
        disabled={ler.isPending}
        onClick={() => entrada.current?.click()}
      >
        {ler.isPending ? (
          <>
            <ScanLine className="w-4 h-4 mr-1.5 animate-pulse" />
            Lendo a imagem…
          </>
        ) : (
          <>
            <ImageUp className="w-4 h-4 mr-1.5" />
            Preencher a partir de uma imagem
          </>
        )}
      </Button>

      <input
        ref={entrada}
        type="file"
        className="sr-only"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          /*
            O campo é zerado antes da chamada para que mandar **o mesmo
            arquivo** duas vezes dispare de novo: sem isso o `change` não volta
            a acontecer, e quem tentou reler a foto depois de corrigir um campo
            acharia que o botão quebrou.
          */
          e.target.value = "";
          if (!arquivo) return;
          setResumo(null);
          setRessalva(null);
          aoComecar();
          if (arquivo.size > TETO_DA_IMAGEM) {
            aoErro(
              `Esta imagem tem ${(arquivo.size / 1024 / 1024).toFixed(1)} MB e o limite é ` +
                `${TETO_DA_IMAGEM / 1024 / 1024} MB. Um print da tela pesa bem menos que ` +
                "uma foto de celular em resolução cheia.",
            );
            return;
          }
          ler.mutate(arquivo);
        }}
      />

      <p className="text-xs text-muted-foreground flex-1 min-w-[16rem]">
        {resumo ? (
          <>
            <span className={cn(ressalva ? undefined : "text-foreground")}>{resumo}</span>
            {ressalva && <span className="block mt-0.5 text-foreground">{ressalva}</span>}
          </>
        ) : (
          "Um print da aba de parâmetros preenche os campos de uma vez, cada um marcado com o " +
          "texto que estava na célula. Nada é gravado por isso: é rascunho, e o salvar continua " +
          "sendo seu."
        )}
      </p>
    </div>
  );
}

/** Doze megabytes: um print de tela cabe com folga, uma foto crua não. */
const TETO_DA_IMAGEM = 12 * 1024 * 1024;

/**
 * O arquivo em base64, sem o prefixo `data:`.
 *
 * O servidor corta o prefixo também, e a redundância é de propósito: são dois
 * lados de uma fronteira, e o que chega nela nunca é só o que este código
 * manda.
 */
function base64De(arquivo: File): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onerror = () =>
      rejeitar(new Error("Não consegui abrir este arquivo. Tente salvá-lo como PNG e reenviar."));
    leitor.onload = () => {
      const bruto = typeof leitor.result === "string" ? leitor.result : "";
      resolver(bruto.replace(/^data:[^,]*,/, ""));
    };
    leitor.readAsDataURL(arquivo);
  });
}

function Contagem({
  titulo,
  valor,
  alerta = false,
}: {
  titulo: string;
  valor: number;
  alerta?: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <p
        className={cn(
          "text-2xl font-bold tabular-nums mt-0.5",
          alerta ? "text-destructive" : undefined,
        )}
      >
        {valor}
      </p>
    </div>
  );
}

function BlocoEditavel({
  bloco,
  rascunho,
  daImagem,
  onEditar,
  onNormalizar,
}: {
  bloco: BlocoApurado;
  rascunho: Record<string, string>;
  daImagem: Record<string, string>;
  onEditar: (chave: string, texto: string) => void;
  onNormalizar: (linha: LinhaApurada) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold uppercase tracking-wide">{bloco.titulo}</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">{bloco.resumo}</p>
      </CardHeader>
      <CardContent className="p-0">
        <ul>
          {bloco.linhas.map((linha) => (
            <LinhaEditavel
              key={linha.chave}
              linha={linha}
              rascunho={rascunho[linha.chave] ?? ""}
              daImagem={daImagem[linha.chave] ?? null}
              onEditar={(texto) => onEditar(linha.chave, texto)}
              onNormalizar={() => onNormalizar(linha)}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Uma linha da planilha, editável.
 *
 * O campo à direita é o que a aba diz. Embaixo dele, quando existe, o que o
 * cadastro apurou sem a planilha — e a divergência entre os dois, se houver.
 * A ordem não é estética: quem está digitando olha para o campo, e o número do
 * acervo é a referência que ele confirma ou contradiz.
 */
function LinhaEditavel({
  linha,
  rascunho,
  daImagem,
  onEditar,
  onNormalizar,
}: {
  linha: LinhaApurada;
  rascunho: string;
  /** O texto da célula na imagem, quando foi de lá que este campo veio. */
  daImagem: string | null;
  onEditar: (texto: string) => void;
  onNormalizar: () => void;
}) {
  const simbolo = SIMBOLO[linha.medida];

  /*
    O número a que o cadastro chega **sem esta linha da planilha** — a
    referência ao lado do campo.

    Duas fontes, e a ordem entre elas importa. Quando há conferência, é ela que
    guarda o número do cadastro; quando não há, o valor da linha só serve de
    referência se ninguém a digitou — numa linha que a pessoa preencheu, o valor
    **é** o que ela digitou, e mostrá-lo como referência seria a tela conferindo
    o campo contra ele mesmo.

    A referência aparece também nas linhas derivadas que ainda não foram
    digitadas — o total que soma as seis parcelas, o resumo de impostos sobre as
    quatro alíquotas —, e é onde ela rende mais: é contra ela que se confere o
    total impresso na aba.
  */
  const doCadastro =
    linha.conferencia !== null
      ? linha.conferencia.cadastro
      : linha.declarado === null && linha.valor !== null
        ? linha.valor
        : null;

  const divergiu = linha.conferencia !== null && !linha.conferencia.bate;

  return (
    <li className="border-t first:border-t-0 px-6 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium flex items-center gap-2">
            <MarcaDoPreenchimento preenchimento={linha.preenchimento} />
            {linha.rotulo}
          </p>

          {doCadastro !== null && (
            <p className="mt-1 text-xs text-muted-foreground">
              {linha.lastroDoAcervo
                ? "O cadastro apura "
                : "Com o que já foi informado, o cadastro chega a "}
              <strong className="tabular-nums text-foreground">
                {escreverValor(doCadastro, linha.medida)}
              </strong>{" "}
              {linha.conferencia === null
                ? "— digite o que a aba diz, e a tela mostra a diferença."
                : divergiu
                  ? "— e a sua planilha diz outra coisa."
                  : "— e a sua planilha concorda."}
            </p>
          )}

          {linha.declarado && (
            <p className="mt-1 text-xs text-muted-foreground/80">
              Informado por {linha.declarado.autor ?? "uma conta não identificada"} em{" "}
              {new Date(linha.declarado.informadoEm).toLocaleDateString("pt-BR")}.
            </p>
          )}
        </div>

        <div className="shrink-0 space-y-1.5 w-56">
          <div className="flex items-center gap-1.5">
            {simbolo.antes && (
              <span className="text-xs text-muted-foreground w-5 text-right">{simbolo.antes}</span>
            )}
            <Input
              aria-label={linha.rotulo}
              inputMode="decimal"
              value={rascunho}
              placeholder="—"
              onChange={(e) => onEditar(e.target.value)}
              onBlur={onNormalizar}
              className={cn(
                "text-right tabular-nums",
                divergiu && "border-destructive/60 focus-visible:ring-destructive/30",
              )}
            />
            {simbolo.depois && (
              <span className="text-xs text-muted-foreground w-4">{simbolo.depois}</span>
            )}
          </div>

          {/*
            O texto da célula, como ele está na imagem, embaixo do campo que
            ele preencheu.

            É o que torna a leitura conferível sem abrir o anexo de novo: `R$
            1.424,00` embaixo de um campo com `1.424,00` confere de relance, e
            `5,90%` embaixo de um campo com `590,00` denuncia a vírgula lida ao
            contrário — que é o erro que a foto produz e o único que atravessa a
            quinzena inteira parecendo certo.
          */}
          {daImagem !== null && (
            <p className="text-[0.6875rem] text-muted-foreground flex items-start gap-1">
              <ScanLine className="w-3 h-3 mt-0.5 shrink-0" />
              <span>
                na imagem: <span className="text-foreground">{daImagem}</span>
              </span>
            </p>
          )}

          {rascunho !== "" && (
            <button
              type="button"
              onClick={() => onEditar("")}
              className="text-[0.6875rem] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <Eraser className="w-3 h-3" />
              Apagar esta linha da planilha
            </button>
          )}
        </div>
      </div>

      {divergiu && linha.conferencia && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="destructive" className="tabular-nums">
            {escreverDivergencia(linha.conferencia, linha.medida)}
            {linha.conferencia.percentual !== null &&
              ` (${linha.conferencia.percentual > 0 ? "+" : "−"}${Math.abs(
                linha.conferencia.percentual,
              ).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)`}
          </Badge>
          <span className="text-xs text-muted-foreground">
            A planilha e o cadastro discordam nesta linha. Nenhum dos dois é corrigido pelo
            outro — a diferença fica registrada, que é o que permite discuti-la.
          </span>
        </div>
      )}

    </li>
  );
}

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return (
    aviso.orientacao?.resumo ?? aviso.mensagemCrua ?? "Não foi possível salvar a planilha."
  );
}
