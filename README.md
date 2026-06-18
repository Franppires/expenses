# Minhas despesas

App pessoal de controle de gastos mensais (contas, renda, extrato, projeção). Funciona no navegador e pode ser instalado no celular como PWA.

## Acessar online

**https://franppires.github.io/expenses/**

(Após o primeiro push, o GitHub Pages pode levar 1–2 minutos para publicar.)

## Instalar no celular

1. Abra o link acima no **Chrome** (Android) ou **Safari** (iPhone).
2. **Android:** menu ⋮ → *Instalar app* ou *Adicionar à tela inicial*.
3. **iPhone:** botão Compartilhar → *Adicionar à Tela de Início*.

## Login e sincronização

1. Preencha `js/firebase-config.js` com as chaves do projeto Firebase **expenses-144a4**.
2. Defina `configured: true`.
3. No Firebase Console → Authentication → Domínios autorizados, adicione: `franppires.github.io`
4. Crie uma conta com e-mail e senha no app — os dados sincronizam entre celular e PC.

## Desenvolvimento local

Abra `index.html` no navegador ou use um servidor estático na pasta do projeto.
