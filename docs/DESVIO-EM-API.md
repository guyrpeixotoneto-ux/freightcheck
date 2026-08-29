# O desvio de `/api/*` — a causa, provada

A tela da Visão Geral mostrava, em produção, o aviso `DESVIADA`: _"o pedido não
chegou ao FreightCheck: alguma camada entre o seu navegador e a aplicação o
desviou para outro endereço"_. A tela estava certa, e a camada tem nome.

**Causa raiz:** o deployment estava publicado como **privado**, e a camada de
proteção da Replit (_ReplShield_) fica na frente do roteador de caminhos.
`https://freightcheck.com.br/api/…` respondia **307 para
`replit.com/__replshield`**, que redirecionava para
`replit.com/silent-auth?privateDeployment=true`. Nenhum dos saltos traz o
carimbo desta API: a requisição nunca chegou ao Express. A cadeia inteira está
na seção 4, a correção na 5.

Este documento registra o que a investigação estabeleceu, com que evidência, e
o que teve de ser resolvido fora deste repositório.

## 1. O que a tela está afirmando, e por que a afirmação é forte

`artifacts/freightaudit/src/lib/api.ts` faz toda chamada com
`redirect: "manual"`. Com isso, um 3xx não é seguido: o navegador devolve uma
resposta opaca (`type: "opaqueredirect"`, `status: 0`) e
`lib/transporte.ts` a classifica como `DESVIADA`. **Só se chega a esse estado
tendo havido resposta, e sendo ela um redirect.** Não é interpretação de
`Failed to fetch`; é um 3xx observado.

O que transforma isso em acusação a uma camada intermediária é uma segunda
propriedade: **esta API não redireciona em rota nenhuma**. Ela deixou de ser
uma frase em comentário e passou a ser teste
(`artifacts/api-server/src/__tests__/nenhum-desvio-em-api.test.ts`), com duas
réguas — o comportamento do servidor real e o texto-fonte, que não pode conter
`res.redirect`, `res.location` nem `Location` escrito à mão.

## 2. A cadeia, medida

Servidor real, sem sessão e com o banco fora do ar — o pior caso, e o único em
que um servidor convencional mandaria alguém para uma tela de login:

```
GET /api/healthz                      → 200  application/json   X-FreightCheck-API: 1
GET /api/readyz                       → 503  application/json   X-FreightCheck-API: 1
GET /api/build                        → 200  application/json   X-FreightCheck-API: 1
GET /api/contexts                     → 401  application/json   X-FreightCheck-API: 1
GET /api/changes/families/overview…   → 401  application/json   X-FreightCheck-API: 1
GET /api/changes/families             → 401  application/json   X-FreightCheck-API: 1
GET /api/balance                      → 401  application/json   X-FreightCheck-API: 1
GET /api/imports                      → 401  application/json   X-FreightCheck-API: 1
GET /api/rota-que-nao-existe          → 401  application/json   X-FreightCheck-API: 1
```

Nenhum 3xx, nenhum `Location`, tudo JSON. Sessão inválida responde
`401 {"code":"UNAUTHENTICATED"}` — nunca um desvio para outra origem.

Do lado do cliente, a arquitetura é de **mesma origem** e isso também virou
régua (`mesma-origem-e-carimbo.test.ts`): `getApiUrl` devolve sempre caminho
relativo sob `/api`, e não existe neste repositório nenhuma `VITE_API_URL`,
`API_BASE_URL` ou endereço absoluto num `fetch`. O roteador da plataforma serve
o bundle em `/` e encaminha `/api/*` para o processo do `api-server` — é o que
os dois `.replit-artifact/artifact.toml` declaram.

**Conclusão:** o 3xx observado em produção não sai deste código, e não sai do
endereço que este código monta.

## 3. O carimbo — como não voltar a ficar cego

`middlewares/carimbo-da-api.ts` escreve `X-FreightCheck-API: 1` e
`X-Request-Id` em **toda** resposta que sai do Express, no primeiro middleware
da pilha. A recíproca é o valor: resposta sem o carimbo não passou por lá.

Isso troca uma inferência por um fato. Antes, "chegou ao Express?" era deduzido
do formato do corpo — não é JSON, logo não é nossa. A regra acerta na maioria e
erra nos casos caros: um 502 de corpo vazio do roteador e um 204 legítimo da API
têm o mesmo corpo. Agora o navegador grava `chegouAoServidor` (`true`, `false`
ou `undefined` quando não houve resposta para carimbar), junto com o
`requestId`, a origem HTTP, a duração e o estado, em `__freightcheck_falhas`.

## 4. A cadeia medida em produção — o desvio, com nome

Medida em 29/08/2026, de dentro do workspace, com `node scripts/prova-do-desvio.mjs
https://freightcheck.com.br`. Idêntica nas oito chamadas da Visão Geral, e
idêntica também em `/` — **o desvio não é específico de `/api`**:

```
[1] 307  https://freightcheck.com.br/api/changes/families/overview?period=2026-08
         content-type: text/html   X-FreightCheck-API: NÃO
         Location: https://replit.com/__replshield?redirect=…      ← outra origem

[2] 302  https://replit.com/__replshield?redirect=…
         server: cloudflare        X-FreightCheck-API: NÃO
         set-cookie: __cf_bm, _cfuvid
         Location: https://replit.com/silent-auth?privateDeployment=true&goto=…

[3] 200  https://replit.com/silent-auth?privateDeployment=true&goto=…
         content-type: text/html   X-FreightCheck-API: NÃO
         corpo: <!DOCTYPE html> … replit-ui-theme-root …
```

Três fatos, e cada um fecha uma pergunta:

1. **`X-FreightCheck-API` ausente nos três saltos.** A requisição nunca chegou
   ao Express. Não é a API que está fora do ar; ela não chegou a ser consultada.
2. **`privateDeployment=true`, escrito pela própria plataforma no destino
   final.** É o parâmetro que nomeia a causa: o deployment está publicado como
   **privado**, e a camada de proteção da Replit (o _ReplShield_) fica na frente
   do roteador de caminhos — antes, portanto, de qualquer decisão sobre `/api`.
3. **307, e não 301/302, no primeiro salto.** É o redirect que preserva método e
   corpo — a assinatura de um portal de autenticação, e não de um redirect
   canônico de domínio.

### Por que funcionava às vezes

A proteção é por sessão _da Replit_, não do FreightCheck. Enquanto o cookie dela
está válido, o ReplShield deixa passar e tudo funciona; quando expira, volta a
desviar. Uma **navegação** sobrevive a isso — o navegador segue os três saltos,
o `silent-auth` renova a sessão e devolve para o destino —, e é por isso que
"entrar de novo no endereço principal" restaura o produto. Uma **chamada de
API** não pode fazer o mesmo: ela é XHR, o destino é outra origem, o navegador
barra a leitura por CORS, e a chamada morre como desvio opaco. Daí o padrão que
se via: a tela abre, e só a Visão Geral quebra.

## 5. A correção — e ela é uma configuração

**Publicar o deployment como público.** Replit → Deployments → Settings → o
controle de acesso do deployment (o que produz `privateDeployment=true`).
Desligá-lo remove o ReplShield da frente do domínio, e `/api/*` passa a chegar
ao roteador de caminhos e ao Express.

Isso **não** abre o produto: quem protege o FreightCheck é o FreightCheck. O
`requireSession` está montado uma vez em `/api`, fecha por padrão, e responde
`401 {"code":"UNAUTHENTICATED"}` a qualquer chamada sem sessão válida — o que
está medido na seção 2 e coberto por teste. A proteção da plataforma estava
duplicando um portão que já existe, e duplicando-o de um jeito que uma API não
consegue atravessar.

Não há workaround honesto no código: um 3xx emitido antes de a aplicação existir
não se corrige na aplicação.

## 6. Como confirmar depois de mexer

```
node scripts/prova-do-desvio.mjs https://freightcheck.com.br
```

O esperado, com o deployment público:

```
[1] 200  /api/healthz   application/json   X-FreightCheck-API: 1
[1] 401  /api/contexts  application/json   X-FreightCheck-API: 1   (sem sessão do produto)
```

O script sai com código 0 quando não há desvio nenhum, e `node scripts/doctor.mjs
https://freightcheck.com.br` faz a versão curta. Enquanto houver um 3xx, os dois
falham dizendo para onde.

## 7. Como isto foi encontrado, para a próxima vez

O carimbo `X-FreightCheck-API` foi o que transformou "provavelmente é o proxy"
em fato: sem ele, os três saltos acima seriam indistinguíveis de uma API que
respondesse HTML. `middlewares/carimbo-da-api.ts` o escreve no primeiro
middleware da pilha, em toda resposta; a recíproca — resposta sem carimbo não
passou pelo Express — é o que a sonda lê.

O `doctor.mjs` imprimia `ok` para esse mesmo 307 antes desta correção: o único
script que se roda para conferir o caminho do roteador dava por bom exatamente o
defeito que se investigava. Foi corrigido junto.
