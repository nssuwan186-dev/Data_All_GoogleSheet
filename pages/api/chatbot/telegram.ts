// pages/api/chatbot/telegram.ts

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../lib/db'; // Adjust path as necessary

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    const telegramMessage = req.body.message;
    if (!telegramMessage) {
      return res.status(400).json({ status: 'error', message: 'No message in webhook body' });
    }

    const text = telegramMessage.text || '';
    const chatId = telegramMessage.chat.id;
    const userId = telegramMessage.from.id;
    const username = telegramMessage.from.username || telegramMessage.from.first_name || `user_${userId}`;
    const timestamp = new Date().toISOString();
    const isCommand = text.startsWith('/');

    try {
      await pool.execute(
        'INSERT INTO conversation_history (user_id, username, role, message, timestamp) VALUES (?, ?, ?, ?, ?)',
        [userId, username, 'user', text, timestamp]
      );
      console.log('User message saved.');
    } catch (dbError) {
      console.error('Error saving user message to DB:', dbError);
    }

    if (isCommand) {
      await fetch(`https://api.telegram.org/bot8227507211:AAHO8uUAtTc52oNwlUodTrPgwo84OjXqNU0/sendMessage`, { // REMINDER: Replace with actual token
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `Got your command: "${text}". Commands are not yet fully supported.`, // Corrected escaping for double quotes within template literal
        }),
      });
      return res.status(200).json({ status: 'ok', message: 'Command received and acknowledged' });
    }

    let conversationHistory: any[] = [];
    try {
      const [rows] = await pool.execute(
        'SELECT role, message FROM conversation_history WHERE user_id = ? ORDER BY timestamp DESC LIMIT 10',
        [userId]
      );
      conversationHistory = (rows as any[]).reverse().map(row => ({
        role: row.role,
        content: row.message
      }));
      console.log(`Fetched ${conversationHistory.length} history items.`);
    } catch (dbError) {
      console.error('Error fetching conversation history from DB:', dbError);
    }

    const availableRooms = {
      standard_400: { available: 15, price: 400 },
      deluxe_500: { available: 10, price: 500 },
      superior_800: { available: 8, price: 800 },
      suite_1000: { available: 5, price: 1000 },
      premium_1200: { available: 3, price: 1200 }
    };

    const hotelInfo = {
      name: 'VIPAT Hotel',
      location: 'อุดรธานี',
      checkInTime: '14:00',
      checkOutTime: '12:00',
      amenities: ['WiFi ฟรี', 'ที่จอดรถ', 'ห้องอาหาร', 'ฟิตเนส'],
      policies: [
        'ยกเลิกฟรีก่อน 24 ชั่วโมง',
        'เด็กต่ำกว่า 6 ปีพักฟรี',
        'สัตว์เลี้ยงไม่อนุญาต'
      ]
    };

    const claudeContext = {
      userId,
      username,
      currentMessage: text,
      conversationHistory,
      availableRooms,
      hotelInfo,
      isExistingCustomer: false,
      guestInfo: null
    };

    // --- Claude API Call (equivalent to n8n's Claude API Call node) ---
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY; // REMINDER: Set this environment variable
    if (!ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY is not set.');
      return res.status(500).json({ status: 'error', message: 'API key not configured.' });
    }

    const claudeSystemPrompt = `
คุณคือ AI Assistant ของโรงแรม VIPAT Hotel ที่อุดรธานี

บทบาทและหน้าที่:
- ช่วยลูกค้าจองห้องพัก ตอบคำถามเกี่ยวกับโรงแรม
- พูดคุยเป็นกันเอง เป็นมิตร ใช้ภาษาไทย
- แนะนำห้องที่เหมาะสมตามความต้องการและงบประมาณ
- เก็บข้อมูลลูกค้าเพื่อการจอง: ชื่อ, เบอร์โทร, วันเข้า-ออก, จำนวนคน

ข้อมูลโรงแรม:
- ชื่อ: ${claudeContext.hotelInfo.name}
- สถานที่: ${claudeContext.hotelInfo.location}
- เช็คอิน: ${claudeContext.hotelInfo.checkInTime}
- เช็คเอาท์: ${claudeContext.hotelInfo.checkOutTime}
- สิ่งอำนวยความสะดวก: ${claudeContext.hotelInfo.amenities.join(', ')}
- นโยบาย: ${claudeContext.hotelInfo.policies.join('; ')}

ห้องพักที่มี:
${Object.entries(claudeContext.availableRooms).map(([room, data]) => `- ${room}: ${data.available} ห้องว่าง, ราคา ${data.price} บาท/คืน`).join('
')}

เมื่อลูกค้าต้องการจอง:
1. เก็บข้อมูล: ชื่อ, เบอร์โทร, วันเข้า-ออก, ประเภทห้อง, จำนวนคน
2. ตอบในรูปแบบ JSON:
{
  "action": "create_booking",
  "data": {
    "guest_name": "...",
    "phone": "...",
    "check_in": "DD/MM/YYYY",
    "check_out": "DD/MM/YYYY",
    "room_type": "...",
    "pax": 2
  }
}

หากเป็นการสนทนาทั่วไป ตอบแบบปกติ ไม่ต้องใช้ JSON`;

    const claudeMessages = [
      ...claudeContext.conversationHistory,
      { role: 'user', content: claudeContext.currentMessage }
    ];

    let claudeApiResponse;
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', // Using the model from n8n workflow
          max_tokens: 2000,
          system: claudeSystemPrompt,
          messages: claudeMessages
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Claude API Error:', response.status, errorData);
        return res.status(response.status).json({ status: 'error', message: 'Claude API call failed', details: errorData });
      }

      claudeApiResponse = await response.json();
      // console.log('Claude API Response:', JSON.stringify(claudeApiResponse, null, 2)); // Log full response for debugging
    } catch (apiError) {
      console.error('Error calling Claude API:', apiError);
      return res.status(500).json({ status: 'error', message: 'Failed to communicate with Claude API.' });
    }

    // --- Process AI Response (equivalent to n8n's Process AI Response node) ---
    const claudeResponseContent = claudeApiResponse.content[0]?.text || '';
    let hasBookingAction = false;
    let bookingData: any = null;

    try {
      // Try to parse JSON if present, similar to n8n's code node
      const jsonMatch = claudeResponseContent.match(/\{[\s\S]*"action"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.action === 'create_booking') {
          hasBookingAction = true;
          bookingData = parsed.data;
        }
      }
    } catch (e) {
      console.warn('Could not parse booking action JSON from Claude response:', e);
      // Not a booking action, just normal conversation
    }

    // Clean message (remove JSON if present)
    const cleanMessage = claudeResponseContent.replace(/\{[\s\S]*"action"[\s\S]*\}/, '').trim();

    // --- Further chatbot logic (IF Booking Action, Create Booking Data, etc.) will go here ---
    res.status(200).json({
      status: 'ok',
      message: 'Message received, context prepared, Claude API called, and response processed.',
      claudeResponse: cleanMessage,
      hasBookingAction,
      bookingData
    });

  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}