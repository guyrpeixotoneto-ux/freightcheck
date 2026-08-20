import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowLeft, Columns2, Link2, PencilLine, Rows3, ScrollText } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CadastrarAPlanilha } from "@/components/remuneracao/cadastrar-planilha";
import { VistaDeDuasQuinzenas } from "@/components/remuneracao/duas-quinzenas";
import { VistaDeUmaQuinzena } from "@/components/remuneracao/uma-quinzena";
import { apresentar } from "@/lib/apresentar-erro";
import {
  chaveDoCadastro,
  lerCadastro,
  lerComparacao,
  listarUnidadesDoCadastro,
  type UnidadeDoCadastro,
} from "@/lib/remuneracao";

/**
 * Remuneração — o cadastro da planilha de **uma** unidade.
 *
 * A tela de dentro: quem chega aqui já escolheu a unidade, na lista que
 * `remuneracao-unidades.tsx` desenha. As duas perguntas são diferentes e por
 * isso são duas telas — lá é *onde está o trabalho*, aqui é *quais são os
 * parâmetros desta unidade*. O seletor de unidade continua no topo, para quem
 * está conferindo dois CDDs seguidos e não quer voltar à lista entre um e
 * outro.
 *
 * Esta é a aba que abre a pasta de Excel: as quatro alíquotas, o tamanho da
 * frota, quanto vale cada parcela por veículo, quantas vans, quantas rotas
 * noturnas, e as duas proporções que decidem se o documento sai como ISS ou
 * como CT-e. Tudo o mais na planilha puxa daqui, e é por isso que ela é a
 * primeira coisa do Fechamento que valia a pena reproduzir.
 *
 * **Três vistas, e a padrão é a de duas quinzenas.** A planilha traz os dois
 * blocos lado a lado — é a forma em que ela é lida, e é a comparação que
 * interessa a quem confere. A vista de uma quinzena continua a um clique, e é
 * ela que traz a memória de cálculo inteira: a regra que produziu cada número e
 * as colunas do export que a sustentam. Quando a unidade só tem uma vigência
 * não há par a mostrar, e a tela abre na vista de uma sem oferecer a outra.
 *
 * **A terceira vista escreve, e é a única.** "Cadastrar a planilha" pergunta a
 * quem preenche a aba de Excel o que a aba diz, linha por linha. Ela existe
 * porque o acervo sustenta onze das trinta linhas, e as outras dezenove não
 * esperam arquivo nenhum — esperam decisões de negócio que ninguém registrou.
 * Enquanto elas não chegam, o número está digitado na planilha que a
 * transportadora manda todo mês, e ignorá-lo não o tornava mais verdadeiro. O
 * que entra por ali volta às outras duas vistas marcado como **informado**, com
 * autor e data, e nunca por cima de um número que o acervo sustente: onde os
 * dois respondem, o do acervo continua sendo o do cadastro e o da planilha
 * aparece ao lado como conferência.
 *
 * **Por que a tela mostra as linhas que não têm número.** Porque a planilha as
 * tem, e a pergunta de quem abre é "o cadastro desta unidade está completo?".
 * Hoje, sobre um acervo completo, onze das trinta linhas têm lastro; uma tela
 * que listasse só essas onze responderia "está completo" todos os dias, e
 * estaria calando as outras dezenove. Cada linha sem lastro diz o que falta e
 * onde olhar hoje — o mesmo contrato das telas em preparo, aplicado uma linha
 * de cada vez em vez de uma tela inteira.
 *
 * A unidade, a vista e as vigências moram no endereço, não em estado da tela:
 * compartilhar o link compartilha o que se estava olhando, e voltar no
 * histórico volta tudo junto.
 */

type Vista = "uma" | "duas" | "cadastrar";

const VISTAS: Vista[] = ["uma", "duas", "cadastrar"];

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.orientacao?.resumo ?? aviso.mensagemCrua ?? "Não foi possível carregar o cadastro.";
}

/** `abc123` + canal → a chave de um item do seletor, e o par que a URL carrega. */
function chaveDaUnidade(scopeHash: string, canal: string | null): string {
  return `${scopeHash}::${canal ?? ""}`;
}

export default function RemuneracaoCadastro() {
  const busca = useSearch();
  const [, navegar] = useLocation();
  const queryClient = useQueryClient();
  const params = new URLSearchParams(busca);

  const scopeHashPedido = params.get("scopeHash");
  const canalPedido = params.get("canal");
  const vigenciaPedida = params.get("period");
  const dePedido = params.get("de");
  const atePedido = params.get("ate");
  const vistaPedida = VISTAS.includes(params.get("vista") as Vista)
    ? (params.get("vista") as Vista)
    : null;

  const unidades = useQuery({
    queryKey: ["remuneracao", "unidades"],
    queryFn: listarUnidadesDoCadastro,
  });

  /*
    Quantas vigências a unidade aberta tem decide se o par existe — e a resposta
    sai da lista de unidades, que já a traz, em vez de uma chamada só para
    contar. Enquanto a lista não chega, `null`: é diferente de "uma só", e é o
    que impede a tela de piscar na vista errada antes de saber.
  */
  const unidadeAberta: UnidadeDoCadastro | undefined = (unidades.data ?? []).find((u) =>
    scopeHashPedido === null
      ? true
      : u.scopeHash === scopeHashPedido &&
        (canalPedido === null || (u.canal ?? "") === canalPedido),
  );
  const temPar = unidadeAberta ? unidadeAberta.vigencias.length >= 2 : null;

  /*
    A vista padrão é a de duas quinzenas — a forma da planilha —, e ela só cede
    lugar quando não há par. `vistaPedida` sempre ganha: quem escolheu a vista
    de uma quinzena não pode ser levado de volta ao carregar a página.
  */
  const vista: Vista = vistaPedida ?? (temPar === false ? "uma" : "duas");

  const cadastro = useQuery({
    queryKey: chaveDoCadastro(scopeHashPedido, canalPedido, vigenciaPedida),
    queryFn: () =>
      lerCadastro({
        ...(scopeHashPedido ? { scopeHash: scopeHashPedido } : {}),
        ...(canalPedido !== null ? { canal: canalPedido } : {}),
        ...(vigenciaPedida ? { period: vigenciaPedida } : {}),
      }),
    /*
      A vista de cadastrar lê o mesmo cadastro montado da vista de uma quinzena,
      e não uma leitura própria da planilha: é dele que saem os rótulos, a ordem
      dos blocos, o que já foi informado e o que o acervo apura em cada linha —
      tudo o que o formulário precisa mostrar ao lado do campo. Uma segunda
      leitura só da planilha teria de cruzar as duas listas no navegador, e é
      assim que a tela passa a discordar do servidor sobre o que existe.
    */
    enabled: vista === "uma" || vista === "cadastrar",
  });

  const comparacao = useQuery({
    queryKey: ["remuneracao", "comparacao", scopeHashPedido, canalPedido, dePedido, atePedido],
    queryFn: () =>
      lerComparacao({
        ...(scopeHashPedido ? { scopeHash: scopeHashPedido } : {}),
        ...(canalPedido !== null ? { canal: canalPedido } : {}),
        ...(dePedido ? { de: dePedido } : {}),
        ...(atePedido ? { ate: atePedido } : {}),
      }),
    enabled: vista === "duas" && temPar !== false,
  });

  /** As vigências para os seletores, da vista que estiver aberta. */
  const vigencias = (vista === "duas" ? comparacao.data?.vigencias : cadastro.data?.vigencias) ?? [];
  const contexto = vista === "duas" ? comparacao.data?.contexto : cadastro.data?.contexto;

  function trocar(mudancas: Record<string, string | null>) {
    const query = new URLSearchParams(busca);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null) query.delete(chave);
      else query.set(chave, valor);
    }
    navegar(`/fechamento/remuneracao/unidade?${query}`);
  }

  /*
    Trocar de unidade limpa as três datas do endereço. As vigências de uma
    unidade são dela: manter a data ao pular para outra pediria uma quinzena que
    a nova pode não ter, e a resposta seria um 404 no lugar de um cadastro —
    punindo quem só quis trocar de CDD.
  */
  function irParaUnidade(chave: string) {
    const [scopeHash, canal] = chave.split("::");
    /*
      O canal vai sempre no endereço, mesmo vazio. Uma unidade pode ter uma
      série com canal e outra sem, no mesmo `scopeHash`; omitir o parâmetro
      pediria "qualquer canal" e o servidor escolheria o primeiro — e a tela
      abriria numa série que ninguém pediu. `canal=` é o pedido explícito pela
      série sem canal, e é assim que `routes/remuneracao.ts` o lê.
    */
    const query = new URLSearchParams({ scopeHash, canal });
    if (vistaPedida !== null) query.set("vista", vistaPedida);
    navegar(`/fechamento/remuneracao/unidade?${query}`);
  }

  const carregando = vista === "duas" ? comparacao.isLoading : cadastro.isLoading;
  const erro = vista === "duas" ? comparacao.error : cadastro.error;
  const falhou = vista === "duas" ? comparacao.isError : cadastro.isError;

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <Link
          href="/fechamento/remuneracao"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3 h-3" />
          Todas as unidades
        </Link>
        <div className="flex items-center gap-2 mt-2">
          <ScrollText className="w-6 h-6 text-nav-fechamento" />
          <h1 className="text-2xl font-bold tracking-tight">Remuneração</h1>
        </div>
        <p className="text-muted-foreground mt-2 max-w-3xl">
          O cadastro que abre a planilha de remuneração desta unidade — alíquotas, frota,
          parcelas por veículo e proporção de documentos. Cada linha diz de onde o número
          veio no acervo da Auditoria, ou o que falta para ele existir. O que o acervo ainda
          não responde, você preenche em <strong>Cadastrar a planilha</strong>, e ele passa a
          aparecer aqui marcado como informado.
        </p>
      </header>

      <div className="p-8 space-y-6 max-w-6xl">
        <Card>
          <CardContent className="pt-6 space-y-4">
            <Tabs value={vista} onValueChange={(v) => trocar({ vista: v })}>
              <TabsList>
                <TabsTrigger value="duas" disabled={temPar === false}>
                  <Columns2 className="w-3.5 h-3.5 mr-1.5" />
                  Duas quinzenas
                </TabsTrigger>
                <TabsTrigger value="uma">
                  <Rows3 className="w-3.5 h-3.5 mr-1.5" />
                  Uma quinzena, com a memória de cálculo
                </TabsTrigger>
                <TabsTrigger value="cadastrar">
                  <PencilLine className="w-3.5 h-3.5 mr-1.5" />
                  Cadastrar a planilha
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="unidade"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Unidade
                </label>
                <Select
                  value={contexto ? chaveDaUnidade(contexto.scopeHash, contexto.channel) : ""}
                  onValueChange={irParaUnidade}
                  disabled={!unidades.data || unidades.data.length === 0}
                >
                  <SelectTrigger id="unidade">
                    <SelectValue placeholder="Escolha a unidade" />
                  </SelectTrigger>
                  <SelectContent>
                    {unidades.data?.map((u) => (
                      <SelectItem
                        key={chaveDaUnidade(u.scopeHash, u.canal)}
                        value={chaveDaUnidade(u.scopeHash, u.canal)}
                      >
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {vista === "duas" ? (
                <>
                  <SeletorDeVigencia
                    id="de"
                    rotulo="Quinzena da esquerda"
                    valor={comparacao.data?.esquerda.effectiveDate ?? ""}
                    vigencias={vigencias}
                    onChange={(v) => trocar({ de: v })}
                  />
                  <SeletorDeVigencia
                    id="ate"
                    rotulo="Quinzena da direita"
                    valor={comparacao.data?.direita.effectiveDate ?? ""}
                    vigencias={vigencias}
                    onChange={(v) => trocar({ ate: v })}
                  />
                </>
              ) : (
                <SeletorDeVigencia
                  id="period"
                  rotulo={vista === "cadastrar" ? "Vigência que você preenche" : "Vigência"}
                  valor={cadastro.data?.effectiveDate ?? ""}
                  vigencias={vigencias}
                  onChange={(v) => trocar({ period: v })}
                />
              )}
            </div>

            <p className="flex items-start gap-2 text-xs text-muted-foreground border-t pt-3">
              <Link2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                O cadastro é da <strong>unidade numa vigência</strong>, e não de uma competência:
                ele descreve o que a Ambev contratou, que é o que a Auditoria guarda. É por isso
                que a lista de períodos aqui é de vigências, e não das quinzenas abertas em
                Importações.
              </span>
            </p>
          </CardContent>
        </Card>

        {carregando && <p className="text-sm text-muted-foreground">Montando o cadastro…</p>}

        {falhou && (
          <Alert variant="destructive">
            <AlertDescription>{textoDoErro(erro)}</AlertDescription>
          </Alert>
        )}

        {vista === "duas" && comparacao.data && <VistaDeDuasQuinzenas dados={comparacao.data} />}
        {vista === "uma" && cadastro.data && <VistaDeUmaQuinzena dados={cadastro.data} />}
        {vista === "cadastrar" && cadastro.data && (
          /*
            A `key` carrega a unidade e a vigência de propósito: o formulário
            guarda o que foi digitado em estado local, e sem ela trocar de
            quinzena no seletor deixaria na tela o rascunho da anterior — que o
            botão de salvar gravaria dentro da vigência errada.
          */
          <CadastrarAPlanilha
            key={`${cadastro.data.contexto.scopeHash}|${cadastro.data.contexto.channel ?? ""}|${cadastro.data.effectiveDate}`}
            dados={cadastro.data}
            aoSalvar={() => {
              void queryClient.invalidateQueries({ queryKey: ["remuneracao"] });
            }}
          />
        )}
      </div>
    </Layout>
  );
}

function SeletorDeVigencia({
  id,
  rotulo,
  valor,
  vigencias,
  onChange,
}: {
  id: string;
  rotulo: string;
  valor: string;
  vigencias: { effectiveDate: string; periodLabel: string }[];
  onChange: (valor: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {rotulo}
      </label>
      <Select value={valor} onValueChange={onChange} disabled={vigencias.length === 0}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Escolha a vigência" />
        </SelectTrigger>
        <SelectContent>
          {vigencias.map((v) => (
            <SelectItem key={v.effectiveDate} value={v.effectiveDate}>
              {v.periodLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
