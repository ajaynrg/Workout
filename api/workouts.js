import { MongoClient, ObjectId } from 'mongodb';

const uri = process.env.MONGODB_URI;
const options = {
  tls: true,
  tlsAllowInvalidCertificates: false,
  connectTimeoutMS: 10000,
  serverSelectionTimeoutMS: 10000,
};

let client;
let clientPromise;

if (!process.env.MONGODB_URI) {
  throw new Error('Please define MONGODB_URI in your environment variables.');
}

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

    // 1. GET: Fetch workout history
    if (req.method === 'GET') {
      const limit = parseInt(req.query.limit, 10) || 40;
      const history = await workouts
        .find({})
        .sort({ date: -1 })
        .limit(limit)
        .toArray();

      return res.status(200).json({ success: true, history });
    }

    // 2. POST: Create a new session
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
        exercises: payload.exercises,
        totalVolumeKg: payload.totalVolumeKg || 0
      };

      const result = await workouts.insertOne(newSession);
      return res.status(201).json({ success: true, id: result.insertedId, session: newSession });
    }

    // 3. PUT / PATCH: Edit existing session
    if (req.method === 'PUT' || req.method === 'PATCH') {
      const { id, exercises, notes, dayName } = req.body;
      if (!id) {
        return res.status(400).json({ error: 'Session ID is required for edit' });
      }

      const updateDoc = {};
      if (exercises) updateDoc.exercises = exercises;
      if (notes !== undefined) updateDoc.notes = notes;
      if (dayName) updateDoc.dayName = dayName;

      // Recalculate total approximate volume
      if (exercises && Array.isArray(exercises)) {
        updateDoc.totalVolumeKg = exercises.reduce((acc, ex) => {
          return acc + ((ex.setsCompleted || 0) * (ex.weightKg || 0) * 8);
        }, 0);
      }

      const result = await workouts.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateDoc }
      );

      return res.status(200).json({ success: true, modifiedCount: result.modifiedCount });
    }

    // 4. DELETE: Remove single item OR purge all
    if (req.method === 'DELETE') {
      const { id, purgeAll } = req.query;

      // Clear all records in DB
      if (purgeAll === 'true') {
        const result = await workouts.deleteMany({});
        return res.status(200).json({ success: true, deletedCount: result.deletedCount, message: 'All workouts cleared.' });
      }

      // Delete single session by ID
      if (!id) {
        return res.status(400).json({ error: 'Target ID or purgeAll flag required' });
      }

      const result = await workouts.deleteOne({ _id: new ObjectId(id) });
      return res.status(200).json({ success: true, deletedCount: result.deletedCount });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}