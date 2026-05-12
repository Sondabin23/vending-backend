require('dotenv').config(); // .env 파일의 암호를 읽어옴
const express = require('express');
const cors = require('cors');
const axios = require('axios'); // 기존에 쓰시던 axios 그대로 활용!

const app = express();
app.use(cors());
app.use(express.json()); // JSON 데이터를 읽을 수 있게 설정

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
// 2. 🆕 [토스페이 추가] 결제 최종 승인 API
// ==========================================
app.post('/api/toss/confirm', async (req, res) => {
  const { paymentKey, orderId, amount } = req.body;
  
  // 🆕 .env 파일에서 토스 시크릿 키 가져오기
  const secretKey = process.env.TOSS_SECRET_KEY; 

  if (!secretKey) {
    console.error('환경 변수에 TOSS_SECRET_KEY가 없습니다!');
    return res.status(500).json({ message: '서버 환경 변수 설정 오류' });
  }

  // 토스 API 스펙: 시크릿 키 뒤에 콜론(:)을 붙여서 Base64로 인코딩해야 함
  const encryptedSecretKey = Buffer.from(`${secretKey}:`).toString('base64');

  try {
    // 기존에 사용하시던 axios를 똑같이 사용하여 토스 서버와 통신합니다.
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

    // 통신 성공 시 axios는 응답 데이터를 response.data에 담아줍니다.
    res.status(200).json({ message: '결제 성공', data: response.data });
    
  } catch (error) {
    console.error("토스페이 통신 에러:", error.response ? error.response.data : error.message);
    // 토스 측에서 내려준 구체적인 에러 메시지를 프론트로 전달합니다.
    res.status(400).json({ 
      message: "결제 승인 실패", 
      error: error.response ? error.response.data : "알 수 없는 에러" 
    });
  }
});

// ==========================================
// 서버 실행
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 백엔드 서버가 http://localhost:${PORT} 에서 실행 중입니다!`);
});