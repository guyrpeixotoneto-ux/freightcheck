import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Building2, Truck, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TipoDeParte } from "@/lib/fechamento";

/**
 * CADASTRAR A UNIDADE OU A TRANSPORTADORA — dois campos, não uma sintaxe.
 *
 * **O que este formulário substitui.** A criação morava dentro do próprio
 * combobox: quem não achava a unidade na lista digitava `443 — CDD Belém` e
 * clicava "Usar". Funciona, e cobra um preço que só aparece depois — o código
 * fica misturado ao nome numa caixa só, com um separador que a pessoa precisa
 * saber que existe, e quem digita só `CDD Belém` cadastra uma parte cujo
 * **código é "CDD Belém"**. O erro é silencioso e é caro: o código é a
 * identidade da unidade, e é por ele que o cadastro de Remuneração encontra o
 * fechamento. Um código digitado como nome não encontra nada, e a tela do
 * resumo cai no painel antigo sem dizer por quê.
 *
 * **Por que estes dois campos e não outros.** São os mesmos, na mesma ordem e
 * com os mesmos rótulos, do "Cadastrar uma unidade" da Remuneração — que já
 * havia copiado a trinca da quinzena daqui. As duas telas pedem a mesma coisa;
 * pedir de formas diferentes é o que fazia o código sair diferente nos dois
 * lados, e o resto do produto passar o dia procurando por quê.
 *
 * **Uma diferença de propósito: aqui o código é obrigatório.** Lá ele é
 * opcional porque a aba de Excel chega antes do export, e a unidade sem CNPJ
 * ainda tem para que servir. Aqui não há esse caso — `registrarParte` recusa
 * código vazio, e a competência sem código não encontraria nem o cadastro nem
 * o próprio arquivo.
 */
export interface ParteDigitada {
  codigo: string;
  nome: string | null;
}

export const ROTULOS: Record<
  TipoDeParte,
  { titulo: string; campo: string; exemplo: string; codigo: string; campoDoCodigo: string }
> = {
  UNIDADE: {
    titulo: "Cadastrar uma unidade",
    campo: "Unidade (CDD)",
    /* O mesmo rótulo da tela de Remuneração — ver `registrar-unidade.tsx`. */
    campoDoCodigo: "Código da unidade",
    exemplo: "CDD BELÉM",
    /*
      O CNPJ, e **não** o número do CDD — o exemplo aqui era `443`, e era ele
      que desalinhava as duas telas. A de Remuneração sempre pediu o CNPJ, com
      o placeholder `12.345.678/0001-99` e a frase "o mesmo da coluna
      `Unidade - CNPJ` do export"; esta pedia o código numérico do CDD. Duas
      telas pedindo coisas diferentes sob o mesmo rótulo "Código", e é por ele
      que uma encontra a outra: quem seguia os dois exemplos gravava `443` de
      um lado e um CNPJ do outro, e o resumo caía no painel antigo sem que
      nada estivesse errado em nenhuma das duas telas.

      O número do CDD continua existindo e continua sendo da Ambev — o
      03.08.20 o escreve como `081-0443`, e o produto o lê e não o reescreve.
      Ele só não é a identidade por onde o fechamento acha o cadastro.
    */
    codigo: "12.345.678/0001-99",
  },
  TRANSPORTADORA: {
    titulo: "Cadastrar uma transportadora",
    campo: "Transportadora",
    campoDoCodigo: "Código da transportadora",
    exemplo: "HORIZONTE LOGÍSTICA",
    /*
      Aqui o exemplo continua sendo o número da Ambev, e continuar é o certo:
      não há cadastro de transportadora em Remuneração para esta identidade
      encontrar. É a unidade que o resumo procura (`cadastroDaRemuneracao` casa
      por `unidadeCodigo`), e alinhar a transportadora ao CNPJ por simetria
      trocaria um código que funciona por um que não tem par do outro lado.
    */
    codigo: "36",
  },
};

export function CadastrarParte({
  tipo,
  nomeInicial,
  codigoInicial,
  erro,
  salvando,
  aoCancelar,
  aoConfirmar,
}: {
  tipo: TipoDeParte;
  nomeInicial: string;
  codigoInicial: string;
  erro: string | null;
  salvando: boolean;
  aoCancelar: () => void;
  aoConfirmar: (parte: ParteDigitada) => void;
}) {
  const [nome, setNome] = useState(nomeInicial);
  const [codigo, setCodigo] = useState(codigoInicial);
  const rotulos = ROTULOS[tipo];
  const Icone = tipo === "UNIDADE" ? Building2 : Truck;

  /* Esc fecha, como em todo diálogo do produto. */
  useEffect(() => {
    const naTecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoCancelar();
    };
    window.addEventListener("keydown", naTecla);
    return () => window.removeEventListener("keydown", naTecla);
  }, [aoCancelar]);

  const codigoLimpo = codigo.trim();
  const podeSalvar = codigoLimpo !== "" && !salvando;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={aoCancelar} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={rotulos.titulo}
        className="relative z-50 w-full max-w-2xl rounded-xl border bg-background shadow-lg animate-in fade-in zoom-in-95"
      >
        <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-none tracking-tight flex items-center gap-2">
              <Icone className="w-4 h-4" />
              {rotulos.titulo}
            </h2>
            <p className="text-xs text-muted-foreground mt-1.5">
              Fica gravada na hora e continua na lista mesmo que a competência seja excluída
              depois. Digitar o mesmo código com um nome novo renomeia.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={aoCancelar} aria-label="Fechar">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {erro && (
            <Alert variant="destructive">
              <AlertDescription>{erro}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="parte-nome">{rotulos.campo}</Label>
              <Input
                autoFocus
                id="parte-nome"
                value={nome}
                placeholder={rotulos.exemplo}
                onChange={(e) => setNome(e.target.value)}
                className="uppercase"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="parte-codigo">{rotulos.campoDoCodigo}</Label>
              <Input
                id="parte-codigo"
                value={codigo}
                placeholder={rotulos.codigo}
                onChange={(e) => setCodigo(e.target.value)}
              />
            </div>
          </div>

          {/*
            A frase abaixo é a razão de o campo existir separado, e por isso ela
            não é genérica: o código é a identidade, e é ele que precisa bater
            com o cadastro de Remuneração. Sem essa ligação dita, um campo a
            mais parece burocracia.
          */}
          <p className="text-xs text-muted-foreground">
            O nome é o que a lista mostra. O <strong>código</strong> é a identidade — é por
            ele que a competência encontra o cadastro de Remuneração desta unidade. Ele
            precisa ser exatamente o mesmo nos dois lugares, com ou sem máscara.
          </p>

          {/*
            Dizer **qual** código, e não só que ele precisa bater. A frase acima
            já existia e não bastava: ela pede que os dois lados coincidam sem
            dizer em quê, e quem tinha o número do CDD na cabeça digitava o
            número do CDD. É a mesma frase da tela de Remuneração, de propósito
            — as duas pedem a mesma coisa e agora dizem a mesma coisa.
          */}
          {tipo === "UNIDADE" && (
            <p className="text-xs text-muted-foreground">
              O código da unidade é o <strong>CNPJ</strong>, como está na coluna{" "}
              <strong>Unidade - CNPJ</strong> do export — é o mesmo que a tela de
              Remuneração pede ao cadastrar a unidade da planilha. O número do CDD
              (<code>081-0443</code> no 03.08.20) é da Ambev, o sistema o lê e não o
              usa como identidade aqui.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-6 py-4">
          <Button variant="ghost" onClick={aoCancelar}>
            Cancelar
          </Button>
          <Button
            disabled={!podeSalvar}
            onClick={() => aoConfirmar({ codigo: codigoLimpo, nome: nome.trim() || null })}
          >
            {salvando ? "Cadastrando…" : rotulos.titulo}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
