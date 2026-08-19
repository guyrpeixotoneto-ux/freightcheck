import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Columns2, Link2, Rows3, ScrollText } from "lucide-react";
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
import { VistaDeDuasQuinzenas } from "@/components/remuneracao/duas-quinzenas";
import { VistaDeUmaQuinzena } from "@/components/remuneracao/uma-quinzena";
import { apresentar } from "@/lib/apresentar-erro";
import {
  lerCadastro,
  lerComparacao,
  listarUnidadesDoCadastro,
  type UnidadeDoCadastro,
} from "@/lib/remuneracao";

/**
 * Remuneração — o cadastro da planilha, por unidade.
 *
 * Esta é a aba que abre a pasta de Excel: as quatro alíquotas, o tamanho da
 * frota, quanto vale cada parcela por veículo, quantas vans, quantas rotas
 * noturnas, e as duas proporções que decidem se o documento sai como ISS ou
 * como CT-e. Tudo o mais na planilha puxa daqui, e é por isso que ela é a
 * primeira coisa do Fechamento que valia a pena reproduzir.
 *
 * **Duas vistas, e a padrão é a de duas quinzenas.** A planilha traz os dois
 * blocos lado a lado — é a forma em que ela é lida, e é a comparação que
 * interessa a quem confere. A vista de uma quinzena continua a um clique, e é
 * ela que traz a memória de cálculo inteira: a regra que produziu cada número e
 * as colunas do export que a sustentam. Quando a unidade só tem uma vigência
 * não há par a mostrar, e a tela abre na vista de uma sem oferecer a outra.
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

type Vista = "uma" | "duas";

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
  const params = new URLSearchParams(busca);

  const scopeHashPedido = params.get("scopeHash");
  const canalPedido = params.get("canal");
  const vigenciaPedida = params.get("period");
  const dePedido = params.get("de");
  const atePedido = params.get("ate");
  const vistaPedida = params.get("vista") === "uma" ? "uma" : params.get("vista") === "duas" ? "duas" : null;

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
    queryKey: ["remuneracao", "cadastro", scopeHashPedido, canalPedido, vigenciaPedida],
    queryFn: () =>
      lerCadastro({
        ...(scopeHashPedido ? { scopeHash: scopeHashPedido } : {}),
        ...(canalPedido !== null ? { canal: canalPedido } : {}),
        ...(vigenciaPedida ? { period: vigenciaPedida } : {}),
      }),
    enabled: vista === "uma",
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
    navegar(`/fechamento/remuneracao?${query}`);
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
    navegar(`/fechamento/remuneracao?${query}`);
  }

  const carregando = vista === "duas" ? comparacao.isLoading : cadastro.isLoading;
  const erro = vista === "duas" ? comparacao.error : cadastro.error;
  const falhou = vista === "duas" ? comparacao.isError : cadastro.isError;

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <div className="flex items-center gap-2">
          <ScrollText className="w-6 h-6 text-nav-fechamento" />
          <h1 className="text-2xl font-bold tracking-tight">Remuneração</h1>
        </div>
        <p className="text-muted-foreground mt-2 max-w-3xl">
          O cadastro que abre a planilha de remuneração desta unidade — alíquotas, frota,
          parcelas por veículo e proporção de documentos. Cada linha diz de onde o número
          veio no acervo da Auditoria, ou o que falta para ele existir.
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
                  rotulo="Vigência"
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
                Competências.
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
