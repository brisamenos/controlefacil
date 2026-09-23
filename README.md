# Controle Fácil

Sistema web para cadastro de clientes, parcelas, pagamentos, vencimentos e lembretes de cobrança.
Funciona no celular, tablet e computador.

**Tecnologia:** Node.js + Express + SQLite (better-sqlite3), front-end em JavaScript puro.

## Rodar no computador

```bash
npm install
npm start
```

Acesse http://localhost:3000

Primeiro acesso: usuário **admin** / senha **admin123** (Super Admin). Troque a senha em *Sistema → Minha senha*.

## Implantar no EasyPanel

1. Crie um App apontando para o repositório. O `Dockerfile` já está pronto.
2. Em **Armazenamento**, adicione uma **Montagem de Volume** com o caminho `/data`.
   O banco (`/data/controle.db`) e os backups (`/data/backups`) ficam ali.
3. Variáveis de ambiente opcionais:

| Variável | Para que serve | Padrão |
|---|---|---|
| `SUPERADMIN_SENHA` | Senha do Super Admin criado no primeiro início | `admin123` |
| `SUPERADMIN_EMAIL` | E-mail do Super Admin | `admin@controlefacil.com` |
| `BACKUP_MANTER` | Quantos backups diários guardar | `14` |

4. Clique em **Implantar**.

## Estrutura (tudo numa pasta só)

```
server.js            servidor e rotas
db.js                banco e tabelas
auth.js              login, sessões, permissões
util.js              datas (fuso de São Paulo), dinheiro, auditoria, configurações
calculo.js           CÁLCULO: valores, percentual e geração das parcelas
agendador.js         AGENDAMENTO: decide quais lembretes saem e quando
mensagens.js         MENSAGEM: modelos e variáveis
whatsapp.js          ENVIO: escolhe o provedor
whatsapp-manual.js   provedor manual (abre o WhatsApp)
whatsapp-webhook.js  provedor automático (API externa)
backup.js            backup diário automático
rotas-*.js           rotas da API por área
index.html, estilo.css, tela-*.js   telas
```

## Tabelas

`users` (super admin e administradores), `sessions`, `clients`, `records` (registros financeiros),
`installments` (parcelas), `payments`, `reminders` (fila de lembretes), `message_templates`,
`notifications`, `audit_logs`, `settings`.

Todo cliente, registro, parcela, pagamento e lembrete tem `admin_id`. Toda consulta filtra pelo
administrador logado, então um administrador nunca vê dados de outro.

## Lembretes e WhatsApp

A cada 15 minutos o agendador prepara os lembretes do dia conforme as configurações de cada
administrador (7, 3 e 1 dia antes, no dia, e depois do vencimento a cada X dias).

- **Modo manual** (padrão): os lembretes aparecem no Início com o botão *Enviar*, que abre o
  WhatsApp com a mensagem pronta.
- **Modo automático (webhook)**: o sistema faz `POST` para a URL configurada, das 8h às 20h, com:

```json
{ "telefone": "5588999991234", "mensagem": "Olá, João! ..." }
```

e o cabeçalho `Authorization: Bearer <token>` quando houver token. Serve para Evolution API,
Z-API ou uma ponte para a API oficial.

**Para adicionar outro provedor:** crie `whatsapp-meuprovedor.js` exportando
`{ automatico: true, async enviar({ telefone, mensagem, config }) { ... return { ok: true } } }`
e registre em `PROVEDORES` no `whatsapp.js`. Nada mais precisa mudar.

## Segurança

- Senhas com bcrypt; sessão por token (12 horas, ou 30 dias com "Lembrar acesso").
- Bloqueio de 10 minutos após 5 senhas erradas.
- Bloquear um administrador ou redefinir a senha dele encerra as sessões na hora.
- Permissões por administrador: clientes, registros, pagamentos, relatórios, WhatsApp, configurações.
- Auditoria de login, cadastros, edições, pagamentos, estornos e cancelamentos, com IP.
- "Esqueci minha senha" gera um aviso para o Super Admin, que redefine a senha.
  Para envio automático por e-mail, é preciso configurar um serviço de e-mail (SMTP).
