// =========================
// server.js (ESM, final)
// =========================

// 1) Imports + dotenv
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import morgan from 'morgan';
import { Pool } from 'pg';

import session from 'express-session';
import { RedisStore } from 'connect-redis';
import { createClient } from 'redis';     // node-redis v4 (ONLY this, no ioredis)
import bcrypt from 'bcrypt';
import { GoogleGenerativeAI } from '@google/generative-ai';

// 2) Create app first (IMPORTANT)
const app = express();
const port = 3000;

app.use(morgan('dev'));
app.use(express.json());
app.use(express.static('public')); // serve static files from project root


// Store lead from JOIN NOW form
app.post('/join-now', async (req, res) => {
  try {
    const userId = req.session?.userId || null; // logged-in ho to link

    let { name, email, phone, plan, goal, details } = req.body || {};
    name    = (name || '').trim();
    email   = (email || '').trim().toLowerCase();
    phone   = (phone || '').replace(/[^\d+]/g, '').slice(0, 15);
    plan    = (plan || 'free').toLowerCase().replace(/\s+/g, '_');   // free | pro | enterprise
    goal    = (goal || '').toLowerCase().replace(/\s+/g, '_');       // weight_loss | muscle_gain | endurance | general
    details = (details || '').trim();

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required.' });
    }

    const q = `
      INSERT INTO leads (user_id, name, email, phone, plan, goal, details, source)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'join_now')
      RETURNING id
    `;
    const { rows } = await pool.query(q, [userId, name, email, phone, plan, goal, details]);

    return res.json({
      message: 'Thank you for submitting your details for the Free plan! A team member will be in touch.',
      leadId: rows[0].id
    });
  } catch (err) {
    console.error('JOIN NOW error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// 3) Postgres pool
const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'yf_user',
  password: process.env.PGPASSWORD || 'yf_pass',
  database: process.env.PGDATABASE || 'yf_db',
});

// 4) Redis client + session store
const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => console.error('Redis Client Error:', err));
await redisClient.connect(); // Node v25 supports top-level await

app.use(
  session({
    store: new RedisStore({
      client: redisClient,
      prefix: 'sess:',
    }),
    secret: process.env.SESSION_SECRET || 'change_me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // secure: true, // enable when behind HTTPS
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

// 5) Redis-backed chat memory helpers (per-user)
const CHAT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const chatKeyFor = (userId) => `chat:${userId}`;

async function loadChatHistory(userId) {
  const raw = await redisClient.get(chatKeyFor(userId));
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function saveChatHistory(userId, history) {
  await redisClient.set(
    chatKeyFor(userId),
    JSON.stringify(history),
    { EX: CHAT_TTL_SECONDS } // node-redis v4 syntax
  );
}

// 6) Health endpoints
app.get('/health/db', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/health/redis', async (_req, res) => {
  try { const pong = await redisClient.ping(); res.json({ ok: pong === 'PONG' }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 7) Fitness helper functions (BMI/BMR/TDEE/Targets/Macros)
function calculate_bmi(heightCm, weightKg) {
  try {
    const heightM = heightCm / 100;
    const bmi = weightKg / (heightM * heightM);
    return { bmi: bmi.toFixed(1), status: "Calculated!" };
  } catch (e) { return { bmi: null, status: "Error: " + e.message }; }
}

function calculate_bmr(heightCm, weightKg, age, gender) {
  try {
    let bmr;
    if ((gender || '').toLowerCase() === 'male') {
      bmr = (10 * weightKg) + (6.25 * heightCm) - (5 * age) + 5;
    } else if ((gender || '').toLowerCase() === 'female') {
      bmr = (10 * weightKg) + (6.25 * heightCm) - (5 * age) - 161;
    } else {
      bmr = (10 * weightKg) + (6.25 * heightCm) - (5 * age) - 78;
    }
    return { bmr: bmr.toFixed(0), status: "Calculated!" };
  } catch (e) { return { bmr: null, status: "Error: " + e.message }; }
}

function calculate_tdee(bmr, activity_level) {
  const activityMultipliers = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    high: 1.725,
    extreme: 1.9
  };
  const key = (activity_level || '').toLowerCase();
  const multiplier = activityMultipliers[key];
  if (!multiplier) return { tdee: null, status: "Error: Invalid activity level." };
  const tdee = bmr * multiplier;
  return { tdee: tdee.toFixed(0), status: "Calculated!" };
}

function get_calorie_target(tdee, goal) {
  let calories;
  const tdeeNum = parseFloat(tdee);
  switch ((goal || '').toLowerCase()) {
    case 'lose_weight': calories = tdeeNum - 500; break;
    case 'gain_muscle': calories = tdeeNum + 300; break;
    case 'maintain':
    default: calories = tdeeNum; break;
  }
  return { calories: calories.toFixed(0), status: "Calculated!" };
}

function get_macro_split(calories, goal) {
  const totalCalories = parseFloat(calories);
  let percentages = { protein: 0.3, carbs: 0.4, fat: 0.3 };
  if ((goal || '').toLowerCase() === 'lose_weight') percentages = { protein: 0.4, carbs: 0.3, fat: 0.3 };
  else if ((goal || '').toLowerCase() === 'gain_muscle') percentages = { protein: 0.35, carbs: 0.45, fat: 0.2 };

  const proteinGrams = (totalCalories * percentages.protein) / 4;
  const carbsGrams   = (totalCalories * percentages.carbs) / 4;
  const fatGrams     = (totalCalories * percentages.fat) / 9;

  return {
    proteinGrams: proteinGrams.toFixed(0),
    carbsGrams: carbsGrams.toFixed(0),
    fatGrams: fatGrams.toFixed(0),
    status: "Calculated!"
  };
}

// 8) Tools + Gemini model
const tools = [
  {
    functionDeclarations: [
      {
        name: "calculate_bmi",
        description: "User ka Body Mass Index (BMI) calculate karta hai.",
        parameters: {
          type: "OBJECT",
          properties: {
            heightCm: { type: "NUMBER" },
            weightKg: { type: "NUMBER" },
          },
          required: ["heightCm", "weightKg"],
        },
      },
      {
        name: "calculate_bmr",
        description: "User ka Basal Metabolic Rate (BMR) calculate karta hai.",
        parameters: {
          type: "OBJECT",
          properties: {
            heightCm: { type: "NUMBER" },
            weightKg: { type: "NUMBER" },
            age: { type: "NUMBER" },
            gender: { type: "STRING" },
          },
          required: ["heightCm", "weightKg", "age", "gender"],
        },
      },
      {
        name: "calculate_tdee",
        description: "User ka Total Daily Energy Expenditure (TDEE) calculate karta hai.",
        parameters: {
          type: "OBJECT",
          properties: {
            bmr: { type: "NUMBER" },
            activity_level: { type: "STRING" },
          },
          required: ["bmr", "activity_level"],
        },
      },
      {
        name: "get_calorie_target",
        description: "Goal ke hisab se calorie target.",
        parameters: {
          type: "OBJECT",
          properties: {
            tdee: { type: "NUMBER" },
            goal: { type: "STRING" },
          },
          required: ["tdee", "goal"],
        },
      },
      {
        name: "get_macro_split",
        description: "Macros grams mein.",
        parameters: {
          type: "OBJECT",
          properties: {
            calories: { type: "NUMBER" },
            goal: { type: "STRING" },
          },
          required: ["calories", "goal"],
        },
      },
    ],
  },
];

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-pro-latest",
  systemInstruction: `You are 'YashFitness Coach.' ... (fitness-only rules)`,
  tools: tools,
});

// 9) Chat endpoint (Redis-backed memory)
app.post('/ask-ai', async (req, res) => {
  try {
    const userMessage = (req.body?.message || '').trim();
    if (!userMessage) return res.status(400).json({ error: 'No message provided.' });

    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Login required to chat with memory.' });

    // load old history from Redis
    const oldHistory = await loadChatHistory(userId); // [] if none

    // start chat with history
    const chat = model.startChat({ history: oldHistory });

    // send user message
    const result = await chat.sendMessage(userMessage);
    const response = result.response;

    const functionCalls = (typeof response.functionCalls === 'function')
      ? response.functionCalls()
      : response.functionCalls;

    let aiMessageText;

    if (functionCalls && functionCalls.length > 0) {
      const call = functionCalls[0];
      let functionResponse;

      switch (call.name) {
        case 'calculate_bmi': {
          const { heightCm, weightKg } = call.args;
          functionResponse = calculate_bmi(heightCm, weightKg);
          break;
        }
        case 'calculate_bmr': {
          const { heightCm, weightKg, age, gender } = call.args;
          functionResponse = calculate_bmr(heightCm, weightKg, age, gender);
          break;
        }
        case 'calculate_tdee': {
          const { bmr, activity_level } = call.args;
          functionResponse = calculate_tdee(bmr, activity_level);
          break;
        }
        case 'get_calorie_target': {
          const { tdee, goal } = call.args;
          functionResponse = get_calorie_target(tdee, goal);
          break;
        }
        case 'get_macro_split': {
          const { calories, goal } = call.args;
          functionResponse = get_macro_split(calories, goal);
          break;
        }
        default: {
          functionResponse = { status: "Error: Unknown function requested" };
        }
      }

      // send tool result back to model
      const result2 = await chat.sendMessage([
        { functionResponse: { name: call.name, response: functionResponse } }
      ]);

      aiMessageText = result2.response.text();
    } else {
      aiMessageText = response.text();
    }

    const newHistory = [
      ...oldHistory,
      { role: 'user',  parts: [{ text: userMessage }] },
      { role: 'model', parts: [{ text: aiMessageText }] },
    ].slice(-40); // cap to last 40 turns

    await saveChatHistory(userId, newHistory);

    return res.json({ aiMessage: aiMessageText });
  } catch (error) {
    console.error("AI Error:", error);
    res.status(500).json({ error: 'Failed to get response from AI.' });
  }
});

// Clear chat endpoint (optional)
app.post('/chat/clear', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Login required.' });
  await redisClient.del(chatKeyFor(userId));
  res.json({ message: 'Chat cleared.' });
});

// 10) Auth endpoints
app.post('/signup', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rowCount > 0) return res.status(409).json({ error: 'Email already registered.' });

    const password_hash = await bcrypt.hash(password, 12);
    const insert = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email, password_hash]
    );

    req.session.userId = insert.rows[0].id;
    req.session.email = insert.rows[0].email;
    res.json({ message: 'Signup successful.', user: { id: insert.rows[0].id, email } });
  } catch (e) {
    console.error('Signup error:', e);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const result = await pool.query('SELECT id, email, password_hash FROM users WHERE email=$1', [email]);
    if (result.rowCount === 0) return res.status(401).json({ error: 'Invalid credentials.' });

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });

    req.session.userId = user.id;
    req.session.email = user.email;
    res.json({ message: 'Login successful.', user: { id: user.id, email: user.email } });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: 'Logged out.' }));
});

// Return logged-in user info (safe minimal)
app.get('/me', async (req, res) => {
  try {
    if (!req.session?.userId) return res.status(200).json({ user: null });
    const { rows } = await pool.query('SELECT id, email, plan FROM users WHERE id=$1', [req.session.userId]);
    if (!rows.length) return res.status(200).json({ user: null });
    const user = rows[0];
    // do NOT send sensitive fields
    res.json({ user: { id: user.id, email: user.email, plan: user.plan || 'free' } });
  } catch (err) {
    console.error('/me error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Payment success webhook / return (called by payment page after verification)
app.post('/payment-success', async (req, res) => {
  try {
    const { leadId, amount, transactionId } = req.body || {};
    if (!leadId) return res.status(400).json({ error: 'leadId required' });

    // 1) Mark lead converted
    await pool.query('UPDATE leads SET status=$1, updated_at=NOW() WHERE id=$2', ['converted', leadId]);

    // 2) Optionally create a user record and start session (if you want)
    // Here we try to fetch lead info and create user if not existing
    const lead = (await pool.query('SELECT name,email,phone FROM leads WHERE id=$1', [leadId])).rows[0];
    if (lead && lead.email) {
      // check existing user
      const existing = await pool.query('SELECT id FROM users WHERE email=$1', [lead.email]);
      if (existing.rowCount === 0) {
        // create a simple user with random password (you may want to send set-password email instead)
        const pw = Math.random().toString(36).slice(2,10);
        const pwHash = await bcrypt.hash(pw, 10);
        const newUser = await pool.query(
          'INSERT INTO users (email, password_hash, plan, created_at) VALUES ($1,$2,$3,NOW()) RETURNING id',
          [lead.email, pwHash, req.body.plan || 'pro']  // set plan, adjust as needed
        );
        // start session
        req.session.userId = newUser.rows[0].id;
        req.session.email = lead.email;
        req.session.userPlan = req.body.plan || 'pro';
      } else {
        // existing user: set their plan to paid if needed and start session
        const userId = existing.rows[0].id;
        await pool.query('UPDATE users SET plan=$1 WHERE id=$2', [req.body.plan || 'pro', userId]);
        req.session.userId = userId;
        req.session.email = lead.email;
        req.session.userPlan = req.body.plan || 'pro';
      }
    }

    // 3) respond ok
    res.json({ ok: true, message: 'Payment recorded, lead converted.' });

  } catch (err) {
    console.error('payment-success error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// ✅ Real-world style payment success handler
app.post('/payment-success', async (req, res) => {
  try {
    const { leadId, plan, amount, transactionId } = req.body || {};
    if (!leadId) return res.status(400).json({ error: 'leadId required' });

    // 1️⃣ Mark lead converted
    await pool.query(
      'UPDATE leads SET status=$1, updated_at=NOW() WHERE id=$2',
      ['converted', leadId]
    );

    // 2️⃣ Fetch lead info
    const { rows } = await pool.query(
      'SELECT name, email, phone FROM leads WHERE id=$1',
      [leadId]
    );
    const lead = rows[0];
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // 3️⃣ Ensure user exists (create if new)
    let userId;
    const existing = await pool.query('SELECT id FROM users WHERE email=$1', [lead.email]);
    if (existing.rowCount > 0) {
      userId = existing.rows[0].id;
      await pool.query('UPDATE users SET plan=$1 WHERE id=$2', [plan || 'pro', userId]);
    } else {
      const passwordHash = await bcrypt.hash(Math.random().toString(36).slice(2, 10), 10);
      const newUser = await pool.query(
        'INSERT INTO users (email, password_hash, plan, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id',
        [lead.email, passwordHash, plan || 'pro']
      );
      userId = newUser.rows[0].id;
    }

    // 4️⃣ Start session (auto-login)
    req.session.userId = userId;
    req.session.email = lead.email;
    req.session.userPlan = plan || 'pro';

    // 5️⃣ Respond with redirect URL
    res.json({
      ok: true,
      redirect: '/platform.html', // redirect to public area
      message: 'Payment successful! Redirecting to your dashboard...',
    });
  } catch (err) {
    console.error('❌ Payment route error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ Free plan signup (like Netflix free trial)
app.post('/signup-free', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email required' });

    // 1️⃣ Check if user already exists
    const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    let userId;
    if (existing.rowCount > 0) {
      userId = existing.rows[0].id;
      await pool.query('UPDATE users SET plan=$1 WHERE id=$2', ['free', userId]);
    } else {
      // create new free user
      const passwordHash = await bcrypt.hash(Math.random().toString(36).slice(2, 10), 10);
      const newUser = await pool.query(
        'INSERT INTO users (email, password_hash, plan, created_at) VALUES ($1,$2,$3,NOW()) RETURNING id',
        [email, passwordHash, 'free']
      );
      userId = newUser.rows[0].id;
    }

    // 2️⃣ Start session
    req.session.userId = userId;
    req.session.email = email;
    req.session.userPlan = 'free';

    // 3️⃣ Respond with redirect
    res.json({
      ok: true,
      redirect: '/platform.html',
      message: 'Welcome to YashFitness Free Plan!',
    });
  } catch (err) {
    console.error('signup-free error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// 11) Start server
app.listen(port, () => {
  console.log(`✅ YashFitness Server Running`);
  console.log(`➡️  http://localhost:${port}`);
});
