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

function parseIdQuery(id) {
  if (!id) return null;
  if (ObjectId.isValid(id)) {
    return { _id: new ObjectId(id) };
  }
  return { _id: id };
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
    return res.status(200).end();
  }

  try {
    const client = await clientPromise;
    const db = client.db('strength_db');
    const workouts = db.collection('workouts');

    // GET: Query logs with date range and limit
    if (req.method === 'GET') {
      const { startDate, endDate, limit } = req.query;
      const maxLimit = parseInt(limit, 10) || 100;
      
      const filter = {};
      if (startDate || endDate) {
        filter.date = {};
        if (startDate) {
          const start = new Date(startDate);
          start.setHours(0, 0, 0, 0);
          filter.date.$gte = start;
        }
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          filter.date.$lte = end;
        }
      }

      const history = await workouts
        .find(filter)
        .sort({ date: -1 })
        .limit(maxLimit)
        .toArray();

      return res.status(200).json({ success: true, history });
    }

    // POST: Insert completed workout
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

    // PUT / PATCH: Update workout session
    if (req.method === 'PUT' || req.method === 'PATCH') {
      const { id, exercises, notes, dayName } = req.body;
      const query = parseIdQuery(id);
      if (!query) {
        return res.status(400).json({ error: 'Valid session ID required' });
      }

      const updateDoc = {};
      if (exercises && Array.isArray(exercises)) {
        updateDoc.exercises = exercises;
        updateDoc.totalVolumeKg = exercises.reduce((acc, ex) => {
          return acc + ((Number(ex.setsCompleted) || 0) * (Number(ex.weightKg) || 0) * 8);
        }, 0);
      }
      if (notes !== undefined) updateDoc.notes = notes;
      if (dayName) updateDoc.dayName = dayName;

      const result = await workouts.updateOne(query, { $set: updateDoc });
      return res.status(200).json({ success: true, modifiedCount: result.modifiedCount });
    }

    // DELETE: Delete single session or clear all
    if (req.method === 'DELETE') {
      const { id, purgeAll } = req.query;

      if (purgeAll === 'true') {
        const result = await workouts.deleteMany({});
        return res.status(200).json({ success: true, deletedCount: result.deletedCount });
      }

      const query = parseIdQuery(id);
      if (!query) {
        return res.status(400).json({ error: 'Valid session ID required for deletion' });
      }

      const result = await workouts.deleteOne(query);
      return res.status(200).json({ success: true, deletedCount: result.deletedCount });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Atlas API Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}