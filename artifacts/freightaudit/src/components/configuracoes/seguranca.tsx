import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
  KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Refusal, post } from "@/components/configuracoes/campos";
import { cn } from "@/lib/utils";

/**
 * Segurança — a troca da própria senha, e só ela.
 *
 * A seção nasce de uma separação que Meu Perfil não fazia: lá estão os dados
 * que **descrevem** a conta — nome, e-mail, papel, id —, todos de leitura;
 * aqui está a única coisa que a pessoa **muda** sozinha. Enquanto as duas
 * dividiam a mesma tela, o formulário aparecia no pé de uma folha de consulta,
 * que é o lugar onde menos se procura por ele.
 *
 * A troca continua sendo a mesma operação de antes, com o mesmo endereço
 * (`POST /auth/password`): exige a senha atual mesmo com a sessão aberta, e
 * derruba as outras sessões da pessoa — que é o que se quer quando se troca
 * uma senha por desconfiança.
 *
 * **A confirmação da senha nova é conferida aqui, e é a única regra que não vem
 * do servidor.** Ela não protege contra nada; protege contra o erro de digitação
 * num campo que não se lê, e por isso não tem por que viajar. Todas as outras —
 * comprimento, e ser diferente da atual — são as do servidor, escritas na lista
 * ao lado (`REGRAS_DA_SENHA`), e quem recusa de verdade continua sendo ele.
 */

/**
 * As regras que o servidor aplica à senha nova, ditas antes da recusa.
 *
 * Cada linha corresponde a um `if` de `describePasswordProblem`
 * (`api-server/src/lib/auth.ts`). Uma lista que prometesse uma regra a mais —
 * "pelo menos um número", digamos — marcaria de verde o que ninguém confere, e
 * marcaria de vermelho senhas que o servidor aceita: seria a tela inventando
 * uma política que a instalação não tem.
 */
const REGRAS_DA_SENHA: Array<{ texto: string; cumprida: (senha: string) => boolean }> = [
  {
    texto: "Mínimo de 10 caracteres",
    cumprida: (senha) => senha.length >= 10,
  },
  {
    texto: "Máximo de 200 caracteres",
    cumprida: (senha) => senha.length > 0 && senha.length <= 200,
  },
];

export function PainelDeSeguranca() {
  return (
    <div className="space-y-6">
      <AlterarSenha />
    </div>
  );
}

function AlterarSenha() {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirmPassword, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const limpar = () => {
    setCurrent("");
    setNew("");
    setConfirm("");
  };

  const change = useMutation({
    mutationFn: () => post("/auth/password", { currentPassword, newPassword }),
    onSuccess: () => {
      setError(null);
      setDone(true);
      limpar();
    },
    onError: (err: Error) => {
      setDone(false);
      setError(err.message);
    },
  });

  /*
    A divergência entre a senha nova e a confirmação só é dita depois de a
    segunda ter começado a ser digitada: acusar "não conferem" no primeiro
    caractere é acusar quem ainda está digitando.
  */
  const divergem = confirmPassword !== "" && confirmPassword !== newPassword;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-primary" />
          Alterar senha
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Mantenha sua conta segura alterando sua senha regularmente. Trocar
          aqui encerra as suas outras sessões — esta aba continua aberta.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,18rem)]">
          <form
            className="space-y-5 max-w-md"
            onSubmit={(e) => {
              e.preventDefault();
              if (divergem || confirmPassword !== newPassword) {
                setDone(false);
                setError("A confirmação não confere com a senha nova.");
                return;
              }
              change.mutate();
            }}
          >
            <CampoDeSenha
              id="current-password"
              label="Senha atual"
              placeholder="Digite sua senha atual"
              autoComplete="current-password"
              value={currentPassword}
              onChange={setCurrent}
            />
            <CampoDeSenha
              id="next-password"
              label="Nova senha"
              placeholder="Digite sua nova senha"
              autoComplete="new-password"
              value={newPassword}
              onChange={setNew}
            />
            <CampoDeSenha
              id="confirm-password"
              label="Confirmar nova senha"
              placeholder="Digite novamente sua nova senha"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={setConfirm}
              problema={divergem ? "As duas senhas não conferem." : null}
            />

            <div className="flex items-center gap-3 pt-1">
              <Button type="submit" disabled={change.isPending}>
                {change.isPending ? "Alterando…" : "Alterar senha"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={change.isPending}
                onClick={() => {
                  limpar();
                  setError(null);
                  setDone(false);
                }}
              >
                Cancelar
              </Button>
            </div>

            {error && <Refusal>{error}</Refusal>}
            {done && (
              <p className="flex items-center gap-2 text-sm text-emerald-700">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Senha alterada.
              </p>
            )}
          </form>

          <span aria-hidden className="hidden md:block w-px bg-border" />

          <div>
            <p className="text-sm font-semibold">Sua senha deve conter:</p>
            <ul className="mt-4 space-y-3">
              {REGRAS_DA_SENHA.map((regra) => {
                const cumprida = regra.cumprida(newPassword);
                return (
                  <li
                    key={regra.texto}
                    className={cn(
                      "flex items-center gap-2 text-sm",
                      cumprida ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {cumprida ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                    ) : (
                      <Circle className="w-4 h-4 shrink-0 opacity-40" />
                    )}
                    {regra.texto}
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-xs text-muted-foreground">
              A senha nova precisa ser diferente da atual — quem confere isso, e
              tudo o mais, é o servidor.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CampoDeSenha({
  id,
  label,
  placeholder,
  autoComplete,
  value,
  onChange,
  problema = null,
}: {
  id: string;
  label: string;
  placeholder: string;
  autoComplete: string;
  value: string;
  onChange: (valor: string) => void;
  problema?: string | null;
}) {
  const [visivel, setVisivel] = useState(false);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-semibold">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type={visivel ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-invalid={problema ? true : undefined}
          className={cn("pr-10", problema && "border-destructive")}
          required
        />
        {/*
          O olho diz o que o clique faz, e não em que estado o campo está: quem
          ouve o rótulo não tem como ver o campo para descobrir o resto.
        */}
        <button
          type="button"
          onClick={() => setVisivel((v) => !v)}
          aria-label={visivel ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
        >
          {visivel ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {problema && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {problema}
        </p>
      )}
    </div>
  );
}
