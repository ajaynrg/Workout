import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
const options = {};

let client;
let clientPromise;

if (!process.env.MONGODB_URI) {
  throw new Error('Please define MONGODB_URI in your environment variables.');
}

// Reuse database connection across serverless invocations
if (process.env.NODE_ENV === 'development') {
  if (!global._mongoClientPromise) {
    client = new MongoClient(uri, options);
    global._mongoClientPromise = client.connect();
  }
  clientPromise = global._mongoClientPromise;
} else {
  client = new MongoClient(uri, options);
  clientPromise = client.connect();
}

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const client = await clientPromise;
    const db = client.db('strength_db');
    const workouts = db.collection('workouts');

    // POST: Save completed workout session
    if (req.method === 'POST') {
      const payload = req.body;

      if (!payload.dayKey || !payload.exercises) {
        return res.status(400).json({ error: 'Missing required workout data' });
      }

      const newSession = {
        date: new Date(),
        dayKey: payload.dayKey,
        dayName: payload.dayName,
        durationMinutes: payload.durationMinutes || 0,
        notes: payload.notes || '',
        exercises: payload.exercises, // Array: [{ name, weightKg, setsCompleted, targetReps }]
        totalVolumeKg: payload.totalVolumeKg || 0
      };

      const result = await workouts.insertOne(newSession);
      return res.status(201).json({ success: true, id: result.insertedId, session: newSession });
    }

    // GET: Retrieve workout logs / progression history
    if (req.method === 'GET') {
      const limit = parseInt(req.query.limit, 10) || 30;
      const history = await workouts
        .find({})
        .sort({ date: -1 })
        .limit(limit)
        .toArray();

      return res.status(200).json({ success: true, history });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}