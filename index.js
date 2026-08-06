import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import morgan from 'morgan';
import authRoutes from './routes/auth.js';
import billRoutes from './routes/bills.js';
import User from './models/User.js';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: [process.env.frontend_url, 'http://localhost:5173'],
  credentials: true
}));
app.use(express.json());
app.use(morgan('dev'));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/bills', billRoutes);

app.get('/', (_req, res) => res.json({ message: 'LedgerDesk API running' }));

// Connect & start
mongoose.connect(process.env.MONGODB_URI, { dbName: 'ledgerdesk' })
  .then(async () => {
    console.log('✅ MongoDB connected');

    // Seed admin user on first run
    const admin = await User.findOne({ username: 'admin' });
    if (!admin) {
      await User.create({ username: 'admin', password: 'Bisu@2003' });
      console.log('✅ Admin user seeded  (admin / Bisu@2003)');
    }
  })
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
  });

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
}

export default app;
