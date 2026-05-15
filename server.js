require('dotenv').config(); // .env 파일의 암호를 읽어옴
const express = require('express');
const cors = require('cors');
const axios = require('axios'); // 기존에 쓰시던 axios 그대로 활용!
const { Pool } = require('pg'); // 🆕 PostgreSQL 추가

const app = express();
app.use(cors());
app.use(express.json()); // JSON 데이터를 읽을 수 있게 설정

// ==========================================
// 🆕 PostgreSQL DB 연결 설정
// ==========================================
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'vending_db',
  // DB 비밀번호도 .env 파일에 DB_PASSWORD=비밀번호 형태로 넣고 쓰는 것을 추천합니다!
  password: process.env.DB_PASSWORD, 
  port: 5432,
});

// ==========================================
// 1. 기존 카카오페이 결제 준비 API
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
    console.error("카카오페이 통신 에러:", error.response ? error.response.data : error.message);
    res.status(500).json({ message: "결제 준비 중 오류가 발생했습니다." });
  }
});

// ==========================================
// 2. 기존 토스페이 결제 최종 승인 API
// ==========================================
app.post('/api/toss/confirm', async (req, res) => {
  const { paymentKey, orderId, amount } = req.body;
  
  const secretKey = process.env.TOSS_SECRET_KEY; 

  if (!secretKey) {
    console.error('환경 변수에 TOSS_SECRET_KEY가 없습니다!');
    return res.status(500).json({ message: '서버 환경 변수 설정 오류' });
  }

  const encryptedSecretKey = Buffer.from(`${secretKey}:`).toString('base64');

  try {
    const response = await axios.post('https://api.tosspayments.com/v1/payments/confirm', {
      paymentKey: paymentKey,
      orderId: orderId,
      amount: amount
    }, {
      headers: {
        'Authorization': `Basic ${encryptedSecretKey}`,
        'Content-Type': 'application/json',
      }
    });

    res.status(200).json({ message: '결제 성공', data: response.data });
    
  } catch (error) {
    console.error("토스페이 통신 에러:", error.response ? error.response.data : error.message);
    res.status(400).json({ 
      message: "결제 승인 실패", 
      error: error.response ? error.response.data : "알 수 없는 에러" 
    });
  }
});

// ==========================================
// 3. 🆕 자판기 상품 DB 관리 API
// ==========================================
// [조회] 현재 자판기의 모든 상품 목록 가져오기
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY slot_number ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('DB 조회 에러:', err);
    res.status(500).json({ error: '상품 목록을 불러오지 못했습니다.' });
  }
});

// [등록] 새로운 상품을 DB에 추가하기
app.post('/api/products', async (req, res) => {
  const { slot_number, name, price, stock } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO products (slot_number, name, price, stock) VALUES ($1, $2, $3, $4) RETURNING *',
      [slot_number, name, price, stock]
    );
    res.json({ success: true, product: result.rows });
  } catch (err) {
    console.error('DB 등록 에러:', err);
    res.status(500).json({ error: '상품 등록에 실패했습니다.' });
  }
});

// ==========================================
// 4. 🆕 자판기 재고 차감 및 판매 기록 API
// ==========================================
// 앱 결제가 완료되었거나, 자판기 물리 버튼을 눌렀을 때 호출합니다.
app.post('/api/purchase', async (req, res) => {
  const { product_id } = req.body;
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // (1) 재고 1개 차감
    const updateRes = await client.query(
      'UPDATE products SET stock = stock - 1 WHERE product_id = $1 AND stock > 0 RETURNING *',
      [product_id]
    );

    if (updateRes.rows.length === 0) {
      throw new Error('재고가 없거나 상품을 찾을 수 없습니다.');
    }

    // (2) 판매 이력(sales) 기록
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
  console.log(`🚀 백엔드 서버가 http://localhost:${PORT} 에서 실행 중입니다!`);
});