require('dotenv').config(); // .env 파일의 암호를 읽어옴
const express = require('express');
const cors = require('cors');
const axios = require('axios'); 
const { Pool } = require('pg'); 

const app = express();
app.use(cors());
app.use(express.json()); 

// ==========================================
// 1. PostgreSQL DB 연결 설정 (Supabase 클라우드 DB용)
// ==========================================
const pool = new Pool({
  // Render 환경 변수에 설정한 DATABASE_URL을 사용합니다.
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // 외부 클라우드 DB 접속 시 필수
  }
});

// ==========================================
// 2. 결제 API (카카오페이 / 토스페이)
// ==========================================
app.post('/api/payment/ready', async (req, res) => {
  const { itemName, price, quantity, domain } = req.body;
  try {
    const response = await axios.post('https://open-api.kakaopay.com/online/v1/payment/ready', {
      cid: 'TC0ONETIME',
      partner_order_id: 'order_1234',
      partner_user_id: 'user_1234',
      item_name: itemName,
      quantity: quantity,
      total_amount: price,
      vat_amount: 0,
      tax_free_amount: 0,
      approval_url: `${domain}/success`,
      cancel_url: `${domain}/cancel`,
      fail_url: `${domain}/fail`,
    }, {
      headers: {
        'Authorization': `SECRET_KEY ${process.env.KAKAO_SECRET_KEY}`,
        'Content-Type': 'application/json',
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error("카카오페이 에러:", error.response?.data || error.message);
    res.status(500).json({ message: "결제 준비 중 오류가 발생했습니다." });
  }
});

app.post('/api/toss/confirm', async (req, res) => {
  const { paymentKey, orderId, amount } = req.body;
  const secretKey = process.env.TOSS_SECRET_KEY; 

  if (!secretKey) return res.status(500).json({ message: '서버 환경 변수 설정 오류' });

  const encryptedSecretKey = Buffer.from(`${secretKey}:`).toString('base64');
  try {
    const response = await axios.post('https://api.tosspayments.com/v1/payments/confirm', {
      paymentKey, orderId, amount
    }, {
      headers: {
        'Authorization': `Basic ${encryptedSecretKey}`,
        'Content-Type': 'application/json',
      }
    });
    res.status(200).json({ message: '결제 성공', data: response.data });
  } catch (error) {
    console.error("토스페이 에러:", error.response?.data || error.message);
    res.status(400).json({ message: "결제 승인 실패", error: error.response?.data || "알 수 없는 에러" });
  }
});

// ==========================================
// 3. 자판기 상품 DB 관리 API
// ==========================================
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY slot_number ASC');
    // 결과가 항상 배열(Array) 형태로 프론트에 전달됩니다.
    res.json(result.rows);
  } catch (err) {
    console.error('DB 조회 에러:', err);
    res.status(500).json({ error: '상품 목록을 불러오지 못했습니다.' });
  }
});

app.post('/api/products', async (req, res) => {
  const { slot_number, name, price, stock, category } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO products (slot_number, name, price, stock, category) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [slot_number, name, price, stock, category || '기타']
    );
    res.json({ success: true, product: result.rows });
  } catch (err) {
    console.error('DB 등록 에러:', err);
    res.status(500).json({ error: '상품 등록에 실패했습니다.' });
  }
});

// ==========================================
// 4. 자판기 구매 (재고 차감 및 이력 기록)
// ==========================================
app.post('/api/purchase', async (req, res) => {
  const { product_id } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 재고 차감 (0보다 클 때만)
    const updateRes = await client.query(
      'UPDATE products SET stock = stock - 1 WHERE product_id = $1 AND stock > 0 RETURNING *',
      [product_id]
    );

    if (updateRes.rows.length === 0) {
      throw new Error('재고가 없거나 상품을 찾을 수 없습니다.');
    }

    // 판매 기록
    await client.query(
      'INSERT INTO sales (product_id) VALUES ($1)',
      [product_id]
    );

    await client.query('COMMIT');
    res.json({ success: true, product: updateRes.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ==========================================
// 서버 실행
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 백엔드 서버가 포트 ${PORT}에서 실행 중입니다!`);
});