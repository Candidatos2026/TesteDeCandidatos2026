// ============================================================
// BACKEND DE EXEMPLO — Cobrança de R$ 5 via Mercado Pago
// ============================================================
// Este servidor faz só uma coisa: cria uma cobrança (preferência)
// no Mercado Pago e confirma, via webhook, quando ela foi paga.
// Ele NUNCA expõe seu Access Token para o navegador do usuário —
// isso é o motivo de precisar de um backend em primeiro lugar.
//
// Como usar:
//   1) npm install
//   2) Copie .env.example para .env e preencha com suas chaves
//      (painel do Mercado Pago > Suas integrações > Credenciais)
//   3) npm start
//   4) Depois de hospedar este servidor, cole a URL pública dele na
//      constante BACKEND_URL no topo do <script> do index.html.
//      O site já sabe chamar POST /api/criar-pagamento e
//      GET /api/status-pagamento/:sessionId automaticamente.
// ============================================================

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

const app = express();
app.use(cors());
app.use(express.json());

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN, // NUNCA coloque isso no front-end
});

// Armazenamento simples em memória para o protótipo.
// Em produção, troque por um banco de dados de verdade (Postgres, Redis etc.)
// — se o servidor reiniciar, esta lista de pagamentos confirmados se perde.
const pagamentosConfirmados = new Set();

// 1) Front-end chama esta rota quando o usuário clica em "Pagar e revelar resultado"
app.post("/api/criar-pagamento", async (req, res) => {
  try {
    const sessionId = crypto.randomUUID(); // identifica esta tentativa de compra

    const preference = new Preference(client);
    const result = await preference.create({
      body: {
        items: [
          {
            title: "Resultado — Teste de Compatibilidade Eleitoral 2026",
            quantity: 1,
            unit_price: 5.0,
            currency_id: "BRL",
          },
        ],
        external_reference: sessionId,
        back_urls: {
          success: `${process.env.SITE_URL}/?pago=1&sessao=${sessionId}`,
          failure: `${process.env.SITE_URL}/?pago=0`,
          pending: `${process.env.SITE_URL}/?pago=pendente`,
        },
        auto_return: "approved",
        notification_url: `${process.env.BACKEND_URL}/api/webhook`,
      },
    });

    res.json({
      sessionId,
      checkoutUrl: result.init_point, // o front-end redireciona o usuário para cá
    });
  } catch (err) {
    console.error("Erro ao criar preferência:", err);
    res.status(500).json({ erro: "Não foi possível iniciar o pagamento." });
  }
});

// 2) Mercado Pago chama esta rota automaticamente quando o status do pagamento muda.
//    É AQUI, e só aqui, que confirmamos de verdade que o dinheiro entrou —
//    nunca confie apenas no redirecionamento do navegador para liberar conteúdo pago.
app.post("/api/webhook", async (req, res) => {
  try {
    const topic = req.query.type || req.body.type;
    if (topic === "payment") {
      const paymentId = req.query["data.id"] || req.body.data?.id;
      const payment = new Payment(client);
      const info = await payment.get({ id: paymentId });

      if (info.status === "approved") {
        const sessionId = info.external_reference;
        pagamentosConfirmados.add(sessionId);
        console.log(`Pagamento aprovado para sessão ${sessionId}`);
      }
    }
    res.sendStatus(200); // sempre responda 200 rápido, senão o MP tenta reenviar
  } catch (err) {
    console.error("Erro no webhook:", err);
    res.sendStatus(200); // mesmo em erro, responda 200 para não gerar reenvio em loop
  }
});

// 3) Front-end consulta esta rota (após o redirecionamento de volta) para saber
//    se pode liberar o resultado.
app.get("/api/status-pagamento/:sessionId", (req, res) => {
  const pago = pagamentosConfirmados.has(req.params.sessionId);
  res.json({ pago });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor de pagamento rodando na porta ${PORT}`));
