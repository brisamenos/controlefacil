// src/routes/auth.js — entrar, sair, esqueci a senha, trocar senha
const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();
const { db } = require('./db');
const A = require('./auth');
const { auditar, ipDe } = require('./util');

router.post('/login', (req, res) => {
  const login = String(req.body.login || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');
  if (!login || !senha) return res.status(400).json({ erro: 'Informe usuário e senha.' });

  const chave = ipDe(req) + '|' + login;
  const min = A.bloqueado(chave);
  if (min) return res.status(429).json({ erro: 'Muitas tentativas. Tente de novo em ' + min + ' minuto(s).' });

  const u = db.prepare('SELECT * FROM users WHERE lower(email) = ? OR lower(usuario) = ?').get(login, login);
  if (!u || !bcrypt.compareSync(senha, u.senha_hash)) {
    A.falhou(chave);
    return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
  }
  if (!u.ativo) return res.status(403).json({ erro: 'Seu acesso está bloqueado. Fale com o administrador do sistema.' });

  A.acertou(chave);
  db.prepare('UPDATE users SET ultimo_acesso = ? WHERE id = ?').run(new Date().toISOString(), u.id);
  const sessao = A.criarSessao(u.id, !!req.body.lembrar, req);
  req.user = u;
  auditar(req, 'login', 'users', u.id, null, u.role === 'admin' ? u.id : null);
  res.json({ ...sessao, usuario: { id: u.id, nome: u.nome, role: u.role, permissoes: A.lerPermissoes(u.permissoes) } });
});

router.post('/esqueci', (req, res) => {
  const login = String(req.body.login || '').trim().toLowerCase();
  if (login) {
    const u = db.prepare('SELECT id, nome, email, usuario FROM users WHERE lower(email) = ? OR lower(usuario) = ?').get(login, login);
    if (u) {
      db.prepare(`INSERT INTO notifications (para_super, titulo, texto) VALUES (1, ?, ?)`)
        .run('Pedido de nova senha', u.nome + ' (' + (u.email || u.usuario) + ') pediu para redefinir a senha.');
    }
  }
  // Mesma resposta sempre, para não revelar quais usuários existem
  res.json({ ok: true, mensagem: 'Pedido enviado. O administrador do sistema vai redefinir sua senha e avisar você.' });
});

router.use(A.autenticar);

router.get('/me', (req, res) => {
  const { id, nome, role, email, usuario, telefone, permissoes } = req.user;
  res.json({ id, nome, role, email, usuario, telefone, permissoes });
});

router.post('/logout', (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.json({ ok: true });
});

router.put('/senha', (req, res) => {
  const { atual, nova } = req.body || {};
  const u = db.prepare('SELECT senha_hash FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(atual || ''), u.senha_hash)) return res.status(400).json({ erro: 'A senha atual está incorreta.' });
  if (String(nova || '').length < 6) return res.status(400).json({ erro: 'A nova senha precisa ter pelo menos 6 caracteres.' });
  db.prepare('UPDATE users SET senha_hash = ?, atualizado_em = ? WHERE id = ?').run(bcrypt.hashSync(String(nova), 10), new Date().toISOString(), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(req.user.id, req.token);
  auditar(req, 'senha_alterada', 'users', req.user.id);
  res.json({ ok: true });
});

module.exports = router;
