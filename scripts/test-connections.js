import axios from 'axios';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function runTest() {
  console.log('==============================================');
  console.log('🔍 Checking Gemini API & MongoDB Atlas');
  console.log('==============================================');

  // 1. Check Gemini API
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  if (!key) {
    console.error('❌ ERROR: No GEMINI_API_KEY set in .env');
  } else {
    console.log(`🔑 Testing Key: ${key.slice(0, 10)}...${key.slice(-4)}`);
    console.log(`🤖 Testing Model: ${model}`);
    try {
      const startTime = Date.now();
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      
      const res = await axios.post(
        url,
        {
          system_instruction: { parts: [{ text: 'You are an interview prep AI. Output valid JSON.' }] },
          contents: [{ role: 'user', parts: [{ text: 'Return a JSON object with keys "status" and "message".' }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
          },
        },
        { timeout: 35000 }
      );

      const elapsed = Date.now() - startTime;
      const rawText = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      const parsed = JSON.parse(rawText);

      console.log(`✅ Gemini API is ACTIVE & WORKING! (Response time: ${elapsed}ms)`);
      console.log(`   Model: ${model}`);
      console.log('   JSON Output:', JSON.stringify(parsed));
    } catch (err) {
      console.error('❌ Gemini API Failed:', err.response?.data?.error?.message || err.message);
    }
  }

  // 2. Check MongoDB Atlas
  console.log('\n----------------------------------------------');
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('❌ ERROR: No MONGODB_URI set in .env');
  } else {
    try {
      console.log('📡 Testing MongoDB Atlas Connection...');
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
      console.log('✅ MongoDB Atlas is CONNECTED!');
      console.log(`   Database Name: "${mongoose.connection.name}"`);
      console.log(`   Host: ${mongoose.connection.host}`);
      await mongoose.disconnect();
    } catch (err) {
      console.error('❌ MongoDB Atlas Connection Failed:', err.message);
    }
  }
  console.log('==============================================');
}

runTest();
