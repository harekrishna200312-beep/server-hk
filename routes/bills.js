import { Router } from 'express';
import Bill from '../models/Bill.js';
import auth from '../middleware/auth.js';
import PDFDocument from 'pdfkit';

const router = Router();
router.use(auth);

/* ── helper: build Mongo filter from query-string ── */
function buildFilter(q) {
  const filter = {};

  if (q.platform && q.platform !== 'All') filter.platform = q.platform;

  if (q.mode === 'single' && q.date) {
    const d = new Date(q.date);
    d.setHours(0, 0, 0, 0);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    filter.date = { $gte: d, $lt: next };
  } else if (q.mode === 'range' && q.startDate && q.endDate) {
    const s = new Date(q.startDate); s.setHours(0, 0, 0, 0);
    const e = new Date(q.endDate);   e.setHours(23, 59, 59, 999);
    filter.date = { $gte: s, $lte: e };
  }

  if (q.search) {
    filter.$or = [
      { orderId: { $regex: q.search, $options: 'i' } },
      { customerName: { $regex: q.search, $options: 'i' } },
      { mobileNo: { $regex: q.search, $options: 'i' } }
    ];
  }
  return filter;
}

/* ══════════════ SUMMARY ══════════════ */
router.get('/summary', async (req, res) => {
  try {
    const { platform, date: selDate } = req.query;
    const mp = platform && platform !== 'All' ? { platform } : {};

    const base = selDate ? new Date(selDate) : new Date();
    const dayStart = new Date(base); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    const mStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), 1);
    const mEnd   = new Date(dayStart.getFullYear(), dayStart.getMonth() + 1, 1);

    const [dayBills, monthBills, allBills] = await Promise.all([
      Bill.find({ date: { $gte: dayStart, $lt: dayEnd }, ...mp }),
      Bill.find({ date: { $gte: mStart, $lt: mEnd }, ...mp }),
      Bill.find(mp)
    ]);

    const sum = (arr, fn) => arr.reduce((s, b) => s + fn(b), 0);

    // Daily sales — last 7 days
    const dailySales = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(dayStart); d.setDate(d.getDate() - i);
      const n = new Date(d); n.setDate(n.getDate() + 1);
      const db = await Bill.find({ date: { $gte: d, $lt: n }, ...mp });
      dailySales.push({
        date: d.toISOString().slice(5, 10),
        sales: sum(db, b => b.total),
        profit: sum(db, b => b.profit)
      });
    }

    // Platform split
    const platformSplit = [];
    for (const p of ['Amazon', 'Flipkart', 'Meesho', 'Store']) {
      const t = sum(allBills.filter(b => b.platform === p), b => b.total);
      if (t > 0) platformSplit.push({ name: p, value: t });
    }

    // Monthly profit trend — last 6 months
    const monthlyTrend = [];
    for (let i = 5; i >= 0; i--) {
      const ms = new Date(dayStart.getFullYear(), dayStart.getMonth() - i, 1);
      const me = new Date(dayStart.getFullYear(), dayStart.getMonth() - i + 1, 1);
      const mb = await Bill.find({ date: { $gte: ms, $lt: me }, ...mp });
      monthlyTrend.push({
        month: ms.toLocaleString('en-US', { month: 'short' }),
        profit: sum(mb, b => b.profit),
        sales: sum(mb, b => b.total)
      });
    }

    // Top 5 products
    const pMap = {};
    for (const b of monthBills) for (const p of b.products) pMap[p.name] = (pMap[p.name] || 0) + p.qty;
    const topProducts = Object.entries(pMap).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, qty]) => ({ name, qty }));

    const pending = allBills.filter(b => b.balance > 0);

    res.json({
      todaySales:      sum(dayBills, b => b.total),
      todayProfit:     sum(dayBills, b => b.profit),
      todayOrderCount: dayBills.length,
      monthlySales:    sum(monthBills, b => b.total),
      monthlyProfit:   sum(monthBills, b => b.profit),
      pendingAmount:   sum(pending, b => b.balance),
      pendingBillCount: pending.length,
      dailySales, platformSplit, monthlyTrend, topProducts
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ══════════════ EXPORT CSV ══════════════ */
router.get('/export/csv', async (req, res) => {
  try {
    const filter = buildFilter(req.query);
    let bills = await Bill.find(filter).sort({ date: -1 });
    if (req.query.status && req.query.status !== 'All') {
      bills = bills.filter(b => b.status === req.query.status);
    }

    const hdr = 'Bill No,Order ID,Customer,Mobile,Platform,Date,Total,Cost,Profit,Received,Balance,Status\n';
    const rows = bills.map(b =>
      `${b.billNo},"${b.orderId}","${b.customerName}","${b.mobileNo}",${b.platform},` +
      `${new Date(b.date).toLocaleDateString('en-IN')},${b.total},${b.cost},${b.profit},` +
      `${b.paymentReceived},${b.balance},${b.status}`
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=ledgerdesk-bills.csv');
    res.send(hdr + rows);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

/* ══════════════ EXPORT PDF ══════════════ */
router.get('/export/pdf', async (req, res) => {
  try {
    const filter = buildFilter(req.query);
    let bills = await Bill.find(filter).sort({ date: -1 });
    if (req.query.status && req.query.status !== 'All') {
      bills = bills.filter(b => b.status === req.query.status);
    }

    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=ledgerdesk-bills.pdf');
    doc.pipe(res);

    doc.fontSize(20).text('LedgerDesk — Bill History', { align: 'center' });
    doc.moveDown();

    const cols = ['Bill#', 'Order ID', 'Customer', 'Platform', 'Total', 'Profit', 'Balance', 'Status', 'Date'];
    const cw   = [40, 110, 110, 70, 65, 65, 65, 55, 75];

    doc.fontSize(9).font('Helvetica-Bold');
    let x = 30, y = doc.y;
    cols.forEach((c, i) => { doc.text(c, x, y, { width: cw[i] }); x += cw[i] + 5; });
    doc.moveTo(30, doc.y + 2).lineTo(780, doc.y + 2).stroke();
    doc.moveDown(0.5);

    doc.font('Helvetica').fontSize(8);
    for (const b of bills) {
      if (doc.y > 540) doc.addPage();
      x = 30; y = doc.y;
      const row = [b.billNo, b.orderId, b.customerName, b.platform,
        `₹${b.total}`, `₹${b.profit}`, `₹${b.balance}`, b.status,
        new Date(b.date).toLocaleDateString('en-IN')];
      row.forEach((c, i) => { doc.text(String(c), x, y, { width: cw[i] }); x += cw[i] + 5; });
      doc.moveDown(0.3);
    }

    doc.end();
  } catch (err) { res.status(500).json({ message: err.message }); }
});

/* ══════════════ CRUD ══════════════ */
router.get('/', async (req, res) => {
  try {
    const filter = buildFilter(req.query);
    let bills = await Bill.find(filter).sort({ createdAt: -1 });
    if (req.query.status && req.query.status !== 'All') {
      bills = bills.filter(b => b.status === req.query.status);
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const total = bills.length;
    const paginatedBills = bills.slice(startIndex, endIndex);

    res.json({
      bills: paginatedBills,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const bill = new Bill(req.body);
    await bill.save();
    res.status(201).json(bill);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const bill = await Bill.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!bill) return res.status(404).json({ message: 'Bill not found' });
    res.json(bill);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const bill = await Bill.findByIdAndDelete(req.params.id);
    if (!bill) return res.status(404).json({ message: 'Bill not found' });
    res.json({ message: 'Bill deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

export default router;
