import mongoose from 'mongoose';
import Counter from './Counter.js';

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  qty: { type: Number, required: true, default: 1 },
  buyPrice: { type: Number, required: true, default: 0 },
  sellPrice: { type: Number, required: true, default: 0 }
}, { _id: false });

const billSchema = new mongoose.Schema({
  billNo: { type: Number, unique: true },
  orderId: { type: String, required: true, trim: true },
  customerName: { type: String, required: true, trim: true },
  mobileNo: { type: String, trim: true, default: '' },
  platform: {
    type: String,
    enum: ['Amazon', 'Flipkart', 'Meesho', 'Store'],
    required: true
  },
  date: { type: Date, required: true, default: Date.now },
  products: [productSchema],
  paymentReceived: { type: Number, default: 0 }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ---- Virtual fields ----
billSchema.virtual('total').get(function () {
  return this.products.reduce((s, p) => s + p.sellPrice * p.qty, 0);
});

billSchema.virtual('cost').get(function () {
  return this.products.reduce((s, p) => s + p.buyPrice * p.qty, 0);
});

billSchema.virtual('profit').get(function () {
  return this.total - this.cost;
});

billSchema.virtual('balance').get(function () {
  return this.total - this.paymentReceived;
});

billSchema.virtual('status').get(function () {
  const bal = this.balance;
  if (bal <= 0) return 'Paid';
  if (this.paymentReceived > 0) return 'Partial';
  return 'Pending';
});

// ---- Auto-increment billNo ----
billSchema.pre('save', async function (next) {
  if (this.isNew && !this.billNo) {
    const counter = await Counter.findByIdAndUpdate(
      'billNo',
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    this.billNo = counter.seq;
  }
  next();
});

export default mongoose.model('Bill', billSchema);
