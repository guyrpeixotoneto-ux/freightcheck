import { Link } from "wouter";

import { AssociarUnidade } from "@/components/fechamento/associar-unidade";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apresentar } from "@/lib/apresentar-erro";
import {
  type CanalDoResumo,
  type DiagnosticoDoCadastro,
  type ResumoDoMes,
} from "@/lib/fechamento";
import { cn } from "@/lib/utils";

/**
 * O DEVIDO QUE NÃO SAIU — o mesmo diagnóstico nas duas telas que o pedem.
 *
 * `devido` sai do contrato: cadastro da unidade, vigência da aba, linhas
 * digitadas. Quando ele não sai, Resumo geral e Conciliação ficam ambas sem a
 * coluna que sustenta a comparação — e a pessoa precisa ler, nas duas, **qual
 * das três portas fechou** e o que a destrava. Duas cópias deste texto
 * divergiriam no primeiro estado novo do diagnóstico, e a que a pessoa lesse
 * seria a que ninguém testa.
 */

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.orientacao?.resumo ?? aviso.mensagemCrua ?? "Não foi possível carregar o resumo.";
}

/**
 * POR QUE NÃO HÁ DEVIDO — a porta que fechou, e não a ausência genérica.
 *
 * **O que o Resumo dizia antes.** Uma frase só, para três causas diferentes:
 * *"o devido não aparece porque nenhum cadastro respondeu por esta unidade
 * nesta competência"*. Ela é verdadeira nas três e não serve em nenhuma. Quem
 * não cadastrou a unidade precisa informar um código; quem cadastrou e digitou
 * a aba de junho precisa digitar a de julho; quem digitou vinte das vinte e
 * duas linhas precisa saber **quais duas**. Os três liam o mesmo texto e iam
 * procurar em três lugares — e o mais provável deles (a unidade sem código, que
 * a `0047` passou a permitir) era justamente o que nenhuma das duas telas dizia.
 *
 * Havia ainda um segundo defeito, mais silencioso: a tela conferia o código com
 * `.trim()` dos dois lados e o backend comparava byte a byte. Podiam discordar
 * — a tela dizendo "existe unidade cadastrada com este código" e o fechamento
 * não achando nada —, e a que decidia era a que não explicava. As duas leituras
 * agora são a mesma: quem resolve é `resolverUnidade`, e o resultado dela é o
 * que chega aqui.
 *
 * **Nada aqui é deduzido.** `destrava` vem escrito do domínio (`comoDestravar`,
 * em `@workspace/fechamento`), e as três portas chegam medidas. A tela põe na
 * ordem e mostra; não decide.
 */
export function PorQueNaoTemDevido({
  cadastro,
  quinzenas,
}: {
  cadastro: CadastroDoCanal;
  /** As duas quinzenas do mês — é delas que sai a competência a associar. */
  quinzenas: ResumoDoMes["quinzenas"];
}) {
  /*
    A quinzena que parou mais tarde é a que se mostra: quem já tem a 1ª
    respondida e a 2ª sem aba precisa ler sobre a 2ª. Sem esta escolha a tela
    mostraria a primeira que falhou, que costuma ser a menos informativa.
  */
  const escolhido = maisAdiantado(cadastro);
  const diagnostico = escolhido?.diagnostico ?? null;

  if (!diagnostico) {
    return (
      <Alert className="mb-4">
        <AlertDescription className="text-xs">
          Abaixo está o painel do <strong>03.08.20 relido</strong> — ele
          concorda consigo mesmo, e por isso as linhas de frota aparecem em
          conjunto. O <strong>devido</strong> não aparece porque nenhuma
          competência deste mês chegou a perguntar pelo cadastro.
        </AlertDescription>
      </Alert>
    );
  }

  const { unidade, vigencia, contrato, destrava } = diagnostico;

  return (
    <Alert className="mb-4">
      <AlertDescription className="text-xs space-y-2">
        <p>
          Abaixo está o painel do <strong>03.08.20 relido</strong> — ele
          concorda consigo mesmo, e por isso as linhas de frota aparecem em
          conjunto. O <strong>devido</strong>, que abre essas linhas uma a uma,
          sai do contrato — e o contrato parou na porta abaixo.
        </p>

        <PortasDoCadastro diagnostico={diagnostico} />

        {destrava && (
          <div className="space-y-1">
            <p>{destrava.problema}</p>
            <p>
              <span className="font-medium">O que destrava: </span>
              {destrava.conserto}
            </p>
          </div>
        )}

        {/*
          A sugestão vira ato aqui, e não uma frase a executar noutra tela.

          A pessoa está lendo "há uma unidade cadastrada com este nome"; o
          caminho manual dali seria abrir Administração, achar a unidade, copiar
          o identificador e voltar. O botão faz o que a frase descreve — grava
          `unidade_id` na competência desta quinzena — e nada além disso.
        */}
        {unidade.sugestoes.length > 0 && escolhido && (
          <AssociarUnidade
            sugestoes={unidade.sugestoes}
            quinzena={escolhido.quinzena}
            competenciaId={
              quinzenas.find((q) => q.quinzena === escolhido.quinzena)
                ?.competenciaId ?? null
            }
          />
        )}

        {/*
          O link vai para onde o conserto acontece, e ele muda com a porta:
          não adianta mandar para a lista de unidades quem já tem a unidade e
          precisa digitar duas células de uma aba.
        */}
        <p>
          <Link
            href="/fechamento/remuneracao"
            className="text-primary hover:underline"
          >
            {diagnostico.estado === "UNIDADE_NAO_ENCONTRADA" ||
            diagnostico.estado === "UNIDADE_AMBIGUA" ||
            diagnostico.estado === "UNIDADE_SEM_CADASTRO"
              ? "Abrir Remuneração"
              : "Abrir o cadastro desta unidade"}
          </Link>
          {unidade.codigoNoCadastro !== null &&
            unidade.codigoNoCadastro !== unidade.codigoProcurado && (
              <>
                {" "}
                — o cadastro guarda o código como{" "}
                <code>{unidade.codigoNoCadastro}</code>, e a competência como{" "}
                <code>{unidade.codigoProcurado}</code>.
              </>
            )}
          {vigencia === null &&
            contrato === null &&
            unidade.cadastradas === 0 && (
              <> Nenhuma unidade foi cadastrada em Remuneração ainda.</>
            )}
        </p>
      </AlertDescription>
    </Alert>
  );
}

/**
 * As três portas, com a que fechou marcada — o mapa antes do texto.
 *
 * Existe porque "faltam duas linhas obrigatórias" só faz sentido depois de se
 * saber que as duas anteriores abriram. A lista responde, de relance, a pergunta
 * que a frase única não respondia: *até onde chegou?*
 */
function PortasDoCadastro({
  diagnostico,
}: {
  diagnostico: DiagnosticoDoCadastro;
}) {
  const { estado, unidade, vigencia, contrato } = diagnostico;
  const parouNaUnidade =
    estado === "UNIDADE_NAO_ENCONTRADA" ||
    estado === "UNIDADE_AMBIGUA" ||
    estado === "CONFLITO_DE_IDENTIDADE" ||
    estado === "UNIDADE_SEM_CADASTRO";

  const portas: {
    nome: string;
    estado: "OK" | "PAROU" | "NAO_AVALIADA";
    detalhe: string;
  }[] = [
    {
      nome: "Unidade",
      estado:
        estado === "CANAL_SEM_CONTRATO"
          ? "NAO_AVALIADA"
          : parouNaUnidade
            ? "PAROU"
            : "OK",
      detalhe: diagnostico.conflito
        ? `cadastro diz ${diagnostico.conflito.doCadastro} · acervo diz ` +
          `${diagnostico.conflito.doAcervo} — nenhum foi sobrescrito`
        : /*
            Com identidade não se procurou por texto, e a linha não pode dizer
            que sim: quem lesse "procura por X · cadastrado é Y" iria igualar os
            dois, que é justamente o que aqui não tem efeito nenhum.
          */
          estado === "UNIDADE_SEM_CADASTRO"
          ? `associada a “${unidade.identidade?.nome ?? "uma unidade"}” · nenhum ` +
            "cadastro de Remuneração aponta para ela"
          : parouNaUnidade
        ? `esta competência procura por “${unidade.codigoProcurado}”` +
          (unidade.codigosCadastrados.length > 0
            ? ` · cadastrado em Remuneração: ${unidade.codigosCadastrados
                .map((c) => `“${c}”`)
                .join(", ")}`
            : ` · ${unidade.cadastradas} cadastrada(s), nenhuma com este código`)
        : /*
            A identidade não compara texto nenhum, e a linha diz isso: mostrar
            "código X" aqui sugeriria que foi o texto que casou — e no dia em que
            o texto divergir, quem lesse iria "consertar" um código que já não é
            consultado.
          */
          unidade.comoCasou === "IDENTIDADE"
          ? "pela unidade cadastrada — sem comparar código"
          : unidade.comoCasou === "EXATO"
          ? `código ${unidade.codigoProcurado}`
          : unidade.comoCasou === "ESPACO"
            ? `código ${unidade.codigoProcurado}, casado ignorando o espaço em volta`
            : unidade.comoCasou === "DOCUMENTO"
              ? `código ${unidade.codigoProcurado}, casado como o mesmo CNPJ`
              : "não avaliada",
    },
    {
      nome: "Vigência",
      estado:
        vigencia === null
          ? "NAO_AVALIADA"
          : estado === "SEM_VIGENCIA"
            ? "PAROU"
            : "OK",
      detalhe:
        vigencia === null
          ? "não avaliada"
          : vigencia.vigenteDe === null
            ? vigencia.todas.length === 0
              ? "nenhuma aba digitada"
              : `abas digitadas: ${vigencia.todas.join(", ")} — nenhuma deste mês`
            : vigencia.vigenteDe,
    },
    {
      nome: "Contrato",
      estado:
        contrato === null
          ? "NAO_AVALIADA"
          : estado === "CONTRATO_INCOMPLETO"
            ? "PAROU"
            : "OK",
      detalhe:
        contrato === null
          ? "não avaliado"
          : contrato.faltam.length > 0
            ? `faltam ${contrato.faltam.length} de ${contrato.lidas} linhas`
            : `${contrato.lidas} linhas lidas`,
    },
  ];

  return (
    <ul className="space-y-0.5">
      {portas.map((p) => (
        <li key={p.nome} className="flex gap-2">
          <span
            aria-hidden
            className={cn(
              "font-mono",
              p.estado === "OK" && "text-emerald-600 dark:text-emerald-400",
              p.estado === "PAROU" && "text-destructive",
              p.estado === "NAO_AVALIADA" && "text-muted-foreground",
            )}
          >
            {p.estado === "OK" ? "✓" : p.estado === "PAROU" ? "✕" : "·"}
          </span>
          <span>
            <span className="font-medium">{p.nome}:</span>{" "}
            <span className="text-muted-foreground">{p.detalhe}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** O diagnóstico de cada quinzena, como o resumo o entrega. */
type CadastroDoCanal = CanalDoResumo["cadastro"];

/**
 * A quinzena que chegou mais longe **sem responder** — a que se explica.
 *
 * Duas escolhas, e as duas mudam o que a pessoa lê. A primeira é olhar só para
 * as quinzenas que **não** responderam: se uma respondeu e a outra não, quem
 * precisa de conserto é a segunda, e é dela que a frase tem de falar. A segunda
 * é, entre as que falharam, mostrar a que foi mais longe — quem já resolveu a
 * unidade e parou na vigência não quer ler de novo sobre o código.
 *
 * `null` quando nenhuma quinzena existe no mês, ou quando todas responderam. O
 * segundo caso não chega aqui — havendo contrato o painel é o comparado
 * —, e devolver `RESPONDEU` aqui faria a tela escrever "parou na porta abaixo"
 * com as três portas abertas.
 *
 * **Devolve de qual quinzena é o diagnóstico, e não só o diagnóstico.** Sem o
 * número não há como chegar à competência — e sem a competência a sugestão de
 * unidade seria uma frase a executar à mão, em outra tela, quando o que ela
 * pede é um clique.
 */
export function maisAdiantado(
  cadastro: CadastroDoCanal,
): { quinzena: 1 | 2; diagnostico: DiagnosticoDoCadastro } | null {
  const ordem: Record<DiagnosticoDoCadastro["estado"], number> = {
    CANAL_SEM_CONTRATO: 0,
    UNIDADE_NAO_ENCONTRADA: 1,
    UNIDADE_AMBIGUA: 1,
    /*
      O conflito para na primeira porta — a unidade foi encontrada e a
      identidade dela é que está em disputa —, e por isso pesa como ela.
    */
    CONFLITO_DE_IDENTIDADE: 1,
    /* A competência tem identidade e o cadastro de Remuneração não: primeira
       porta também — o que falta é um cadastro apontando para a unidade. */
    UNIDADE_SEM_CADASTRO: 1,
    SEM_VIGENCIA: 2,
    CONTRATO_INCOMPLETO: 3,
    RESPONDEU: 4,
  };
  const candidatos = ([1, 2] as const)
    .map((quinzena) => ({
      quinzena,
      diagnostico: quinzena === 1 ? cadastro.primeira : cadastro.segunda,
    }))
    .filter(
      (c): c is { quinzena: 1 | 2; diagnostico: DiagnosticoDoCadastro } =>
        c.diagnostico !== null && c.diagnostico.estado !== "RESPONDEU",
    );
  if (candidatos.length === 0) return null;
  return candidatos.reduce((a, b) =>
    ordem[b.diagnostico.estado] > ordem[a.diagnostico.estado] ? b : a,
  );
}


