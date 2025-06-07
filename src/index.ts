import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import ExcelJS from 'exceljs'

dotenv.config()

const app = express()
const prisma = new PrismaClient()
const port = process.env.PORT || 3001
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

// Middleware
app.use(cors())
app.use(express.json())

// Middleware to verify JWT token
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: 'No token provided' })
  }

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' })
    }
    req.user = user
    next()
  })
}

// Admin login endpoint
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Find user by email
    const user = await prisma.user.findUnique({ where: { email } });
    // console.log(user);
    if (!user || user.role !== 'ADMIN') {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    // Compare password
    // const valid = await bcrypt.compare(password, user.password);
    // if (!valid) {
    //   return res.status(401).json({ error: 'Invalid password' });
    // }
    // Create JWT
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role, organizationId: user.organizationId }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get incoming stats
app.get('/api/incoming-stats', authenticateToken, async (req: any, res) => {
  try {
    const { month, year } = req.query;
    const organizationId = req.user.organizationId;

    // Get all donors for this organization
    const donors = await prisma.donor.findMany({
      where: { kitchenId: organizationId },
      select: { id: true, name: true }
    });

    // Get all donations for the specified month/year
    let startDate: Date, endDate: Date;
    if (parseInt(month) === 0) {
      // All months: get the whole year
      startDate = new Date(parseInt(year), 0, 1);
      endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
    } else {
      startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
    }

    const donations = await prisma.donation.findMany({
      where: {
        organizationId,
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        Donor: true
      }
    });

    // Group donations by date and donor, using donation.summary as total weight
    const groupedData = donations.reduce((acc: any, donation: any) => {
      const dt = new Date(donation.createdAt);
      const parts = dt.toLocaleString('en-US', {
        timeZone: 'America/Halifax',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).split('/');
      // Add one day to match database data
      const nextDay = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
      nextDay.setDate(nextDay.getDate() + 1);
      const date = nextDay.toISOString().split('T')[0];
      const donorName = donation.Donor.name;
      const totalWeight = donation.summary;

      if (!acc[date]) {
        acc[date] = {
          date,
          donors: {}
        };
      }

      acc[date].donors[donorName] = (acc[date].donors[donorName] || 0) + totalWeight;
      return acc;
    }, {});

    // Convert to array format
    const tableData = Object.values(groupedData).map((row: any) => ({
      date: row.date,
      ...row.donors
    }));

    // Calculate totals
    const totals = donors.reduce((acc: any, donor: any) => {
      acc[donor.name] = tableData.reduce((sum: number, row: any) => sum + (row[donor.name] || 0), 0);
      return acc;
    }, {});

    // Calculate row totals
    const rowTotals = tableData.map((row: any) => 
      donors.reduce((sum: number, donor: any) => sum + (row[donor.name] || 0), 0)
    );

    // Calculate grand total
    const grandTotal = Object.values(totals).reduce((sum: number, val: any) => sum + val, 0);

    res.json({
      donors: donors.map((d: any) => d.name),
      tableData,
      totals,
      rowTotals,
      grandTotal
    });
  } catch (err) {
    console.error('Error fetching incoming stats:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export incoming stats as Excel
app.get('/api/incoming-stats/export', authenticateToken, async (req: any, res) => {
  try {
    const { month, year, unit } = req.query;
    const organizationId = req.user.organizationId;

    // Get all donors for this organization
    const donors = await prisma.donor.findMany({
      where: { kitchenId: organizationId },
      select: { id: true, name: true }
    });

    // Get all donations for the specified month/year
    let startDate: Date, endDate: Date;
    if (parseInt(month) === 0) {
      // All months: get the whole year
      startDate = new Date(parseInt(year), 0, 1);
      endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
    } else {
      startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
    }

    const donations = await prisma.donation.findMany({
      where: {
        organizationId,
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        Donor: true
      }
    });

    // Group donations by date and donor, using donation.summary as total weight
    const groupedData = donations.reduce((acc: any, donation: any) => {
      const dt = new Date(donation.createdAt);
      const parts = dt.toLocaleString('en-US', {
        timeZone: 'America/Halifax',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).split('/');
      // Add one day to match database data
      const nextDay = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
      nextDay.setDate(nextDay.getDate() + 1);
      const date = nextDay.toISOString().split('T')[0];
      const donorName = donation.Donor.name;
      const totalWeight = donation.summary;

      if (!acc[date]) {
        acc[date] = {
          date,
          donors: {}
        };
      }

      acc[date].donors[donorName] = (acc[date].donors[donorName] || 0) + totalWeight;
      return acc;
    }, {});

    // Convert to array format
    const tableData = Object.values(groupedData).map((row: any) => ({
      date: row.date,
      ...row.donors
    }));

    // Calculate totals
    const totals = donors.reduce((acc: any, donor: any) => {
      acc[donor.name] = tableData.reduce((sum: number, row: any) => sum + (row[donor.name] || 0), 0);
      return acc;
    }, {});

    // Calculate row totals
    const rowTotals = tableData.map((row: any) => 
      donors.reduce((sum: number, donor: any) => sum + (row[donor.name] || 0), 0)
    );

    // Calculate grand total
    const grandTotal = Object.values(totals).reduce((sum: number, val: any) => sum + val, 0);

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Incoming Stats');

    // Header row
    const headerRow = ['Date', ...donors.map((d: any) => d.name), 'Total'];
    worksheet.addRow(headerRow);

    // Data rows
    tableData.forEach((row: any, i: number) => {
      const rowArr = [
        row.date,
        ...donors.map((d: any) => row[d.name] || 0),
        rowTotals[i]
      ];
      worksheet.addRow(rowArr);
    });

    // Totals row
    const totalsRow = ['Monthly Total', ...donors.map((d: any) => totals[d.name]), grandTotal];
    worksheet.addRow(totalsRow);

    // Unit conversion if needed
    if (unit === 'Pounds (lb)') {
      // Convert all weight columns to lbs
      worksheet.eachRow((row: any, rowNumber: any) => {
        if (rowNumber === 1) return; // skip header
        row.eachCell((cell: any, colNumber: any) => {
          if (colNumber > 1) {
            if (typeof cell.value === 'number') {
              cell.value = +(cell.value * 2.20462).toFixed(2);
            }
          }
        });
      });
    }

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="incoming-stats-${year}-${month}.xlsx"`);

    // Write workbook to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error exporting incoming stats:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get shift categories for the current organization
app.get('/api/shift-categories', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const categories = await prisma.shiftCategory.findMany({
      where: { organizationId },
      orderBy: { id: 'asc' },
      select: { name: true }
    });
    res.json(categories.map((c: any) => c.name));
  } catch (err) {
    console.error('Error fetching shift categories:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Outgoing stats: meals distributed by shift category and date (for dashboard)
app.get('/api/outgoing-stats', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;

    // Get all shift categories for this organization
    const categories = await prisma.shiftCategory.findMany({
      where: { organizationId },
      orderBy: { id: 'asc' },
      select: { id: true, name: true }
    });
    const categoryIdToName: Record<number, string> = {};
    categories.forEach((cat: any) => { categoryIdToName[cat.id] = cat.name; });

    // Get all shifts for this organization
    const shifts = await prisma.shift.findMany({
      where: { organizationId },
      orderBy: { startTime: 'asc' },
      select: { id: true, shiftCategoryId: true, startTime: true }
    });

    // Build a map: shiftId -> { date, categoryName }
    const shiftIdToDate: Record<number, string> = {};
    const shiftIdToCategory: Record<number, string> = {};
    const dateSet = new Set<string>();
    shifts.forEach((shift: any) => {
      const dt = new Date(shift.startTime);
      const parts = dt.toLocaleString('en-US', {
        timeZone: 'America/Halifax',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).split('/');
      // Add one day to match database data
      const nextDay = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
      nextDay.setDate(nextDay.getDate() + 1);
      const date = nextDay.toISOString().split('T')[0];
      shiftIdToDate[shift.id] = date;
      shiftIdToCategory[shift.id] = categoryIdToName[shift.shiftCategoryId] || '';
      dateSet.add(date);
    });

    // Get all shift signups for these shifts
    const shiftIds = shifts.map((s: any) => s.id);
    const signups = await prisma.shiftSignup.findMany({
      where: { shiftId: { in: shiftIds } },
      select: { shiftId: true, mealsServed: true }
    });

    // Build a map: date -> { categoryName -> totalMeals }
    const dateCategoryMeals: Record<string, Record<string, number>> = {};
    signups.forEach((signup: any) => {
      const shiftId = signup.shiftId;
      const date = shiftIdToDate[shiftId];
      const category = shiftIdToCategory[shiftId];
      if (!date || !category) return;
      if (!dateCategoryMeals[date]) dateCategoryMeals[date] = {};
      dateCategoryMeals[date][category] = (dateCategoryMeals[date][category] || 0) + (signup.mealsServed || 0);
    });

    // Prepare table data: one row per date, columns are categories
    const sortedDates = Array.from(dateSet).sort();
    const categoryNames = categories.map((c: any) => c.name);
    const tableData = sortedDates.map((date: any) => {
      const row: Record<string, string | number> = { Date: date };
      categoryNames.forEach((cat: any) => {
        row[cat] = dateCategoryMeals[date]?.[cat] || 0;
      });
      return row;
    });

    res.json({
      columns: ['Date', ...categoryNames],
      tableData
    });
  } catch (err) {
    console.error('Error fetching outgoing stats:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Filtered outgoing stats with month/year filtering (for Outgoing Stats page)
app.get('/api/outgoing-stats/filtered', authenticateToken, async (req: any, res) => {
  try {
    const { month, year } = req.query;
    const organizationId = req.user.organizationId;

    // Get date range based on month/year
    let startDate: Date, endDate: Date;
    if (!year) {
      return res.status(400).json({ error: 'Year is required' });
    }
    if (!month || parseInt(month) === 0) {
      startDate = new Date(parseInt(year), 0, 1);
      endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
    } else {
      startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
    }

    // Get all shift categories for this organization
    const categories = await prisma.shiftCategory.findMany({
      where: { organizationId },
      orderBy: { id: 'asc' },
      select: { id: true, name: true }
    });
    const categoryIdToName: Record<number, string> = {};
    categories.forEach((cat: any) => { categoryIdToName[cat.id] = cat.name; });

    // Get all shifts for this organization within date range
    const shifts = await prisma.shift.findMany({
      where: {
        organizationId,
        startTime: {
          gte: startDate,
          lte: endDate
        }
      },
      orderBy: { startTime: 'asc' },
      select: { id: true, shiftCategoryId: true, startTime: true }
    });

    // Build a map: shiftId -> { date, categoryName }
    const shiftIdToDate: Record<number, string> = {};
    const shiftIdToCategory: Record<number, string> = {};
    const dateSet = new Set<string>();
    shifts.forEach((shift: any) => {
      const dt = new Date(shift.startTime);
      const parts = dt.toLocaleString('en-US', {
        timeZone: 'America/Halifax',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).split('/');
      // Add one day to match database data
      const nextDay = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
      nextDay.setDate(nextDay.getDate() + 1);
      const date = nextDay.toISOString().split('T')[0];
      shiftIdToDate[shift.id] = date;
      shiftIdToCategory[shift.id] = categoryIdToName[shift.shiftCategoryId] || '';
      dateSet.add(date);
    });

    // Get all shift signups for these shifts
    const shiftIds = shifts.map((s: any) => s.id);
    const signups = await prisma.shiftSignup.findMany({
      where: { shiftId: { in: shiftIds } },
      select: { shiftId: true, mealsServed: true }
    });

    // Build a map: date -> { categoryName -> totalMeals }
    const dateCategoryMeals: Record<string, Record<string, number>> = {};
    signups.forEach((signup: any) => {
      const shiftId = signup.shiftId;
      const date = shiftIdToDate[shiftId];
      const category = shiftIdToCategory[shiftId];
      if (!date || !category) return;
      if (!dateCategoryMeals[date]) dateCategoryMeals[date] = {};
      dateCategoryMeals[date][category] = (dateCategoryMeals[date][category] || 0) + (signup.mealsServed || 0);
    });

    // Prepare table data: one row per date, columns are categories
    const sortedDates = Array.from(dateSet).sort();
    const categoryNames = categories.map((c: any) => c.name);
    const tableData = sortedDates.map((date: any) => {
      const row: Record<string, string | number> = { Date: date };
      let total = 0;
      categoryNames.forEach((cat: string) => {
        const val = dateCategoryMeals[date]?.[cat] || 0;
        row[cat] = val;
        total += val;
      });
      row['Total'] = total;
      return row;
    });

    res.json({
      columns: ['Date', ...categoryNames, 'Total'],
      tableData
    });
  } catch (err) {
    console.error('Error fetching filtered outgoing stats:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export filtered outgoing stats as Excel
app.get('/api/outgoing-stats/filtered/export', authenticateToken, async (req: any, res) => {
  try {
    const { month, year } = req.query;
    const organizationId = req.user.organizationId;

    // Get date range based on month/year
    let startDate: Date, endDate: Date;
    if (!year) {
      return res.status(400).json({ error: 'Year is required' });
    }
    if (!month || parseInt(month) === 0) {
      startDate = new Date(parseInt(year), 0, 1);
      endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
    } else {
      startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
    }

    // Get all shift categories for this organization
    const categories = await prisma.shiftCategory.findMany({
      where: { organizationId },
      orderBy: { id: 'asc' },
      select: { id: true, name: true }
    });
    const categoryIdToName: Record<number, string> = {};
    categories.forEach((cat: any) => { categoryIdToName[cat.id] = cat.name; });

    // Get all shifts for this organization within date range
    const shifts = await prisma.shift.findMany({
      where: {
        organizationId,
        startTime: {
          gte: startDate,
          lte: endDate
        }
      },
      orderBy: { startTime: 'asc' },
      select: { id: true, shiftCategoryId: true, startTime: true }
    });

    // Build a map: shiftId -> { date, categoryName }
    const shiftIdToDate: Record<number, string> = {};
    const shiftIdToCategory: Record<number, string> = {};
    const dateSet = new Set<string>();
    shifts.forEach((shift: any) => {
      const dt = new Date(shift.startTime);
      const parts = dt.toLocaleString('en-US', {
        timeZone: 'America/Halifax',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).split('/');
      // Add one day to match database data
      const nextDay = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
      nextDay.setDate(nextDay.getDate() + 1);
      const date = nextDay.toISOString().split('T')[0];
      shiftIdToDate[shift.id] = date;
      shiftIdToCategory[shift.id] = categoryIdToName[shift.shiftCategoryId] || '';
      dateSet.add(date);
    });

    // Get all shift signups for these shifts
    const shiftIds = shifts.map((s: any) => s.id);
    const signups = await prisma.shiftSignup.findMany({
      where: { shiftId: { in: shiftIds } },
      select: { shiftId: true, mealsServed: true }
    });

    // Build a map: date -> { categoryName -> totalMeals }
    const dateCategoryMeals: Record<string, Record<string, number>> = {};
    signups.forEach((signup: any) => {
      const shiftId = signup.shiftId;
      const date = shiftIdToDate[shiftId];
      const category = shiftIdToCategory[shiftId];
      if (!date || !category) return;
      if (!dateCategoryMeals[date]) dateCategoryMeals[date] = {};
      dateCategoryMeals[date][category] = (dateCategoryMeals[date][category] || 0) + (signup.mealsServed || 0);
    });

    // Prepare table data: one row per date, columns are categories
    const sortedDates = Array.from(dateSet).sort();
    const categoryNames = categories.map((c: any) => c.name);
    const tableData = sortedDates.map((date: any) => {
      const row: Record<string, string | number> = { Date: date };
      let total = 0;
      categoryNames.forEach((cat: string) => {
        const val = dateCategoryMeals[date]?.[cat] || 0;
        row[cat] = val;
        total += val;
      });
      row['Total'] = total;
      return row;
    });

    // Generate Excel file
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Outgoing Stats');
    worksheet.addRow(['Date', ...categoryNames, 'Total']);
    tableData.forEach((row: any) => {
      worksheet.addRow([
        row['Date'],
        ...categoryNames.map((cat: string) => row[cat] || 0),
        row['Total']
      ]);
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="outgoing-stats-${year}-${month}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error exporting filtered outgoing stats:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Volunteer hours breakdown: dates from Shift.startTime, columns from ShiftCategory.name, dummy values for now
app.get('/api/volunteer-hours', authenticateToken, async (req: any, res) => {
  try {
    const { month, year } = req.query;
    const organizationId = req.user.organizationId;
    let startDate: Date, endDate: Date;
    if (!year) {
      return res.status(400).json({ error: 'Year is required' });
    }
    if (!month || parseInt(month) === 0) {
      startDate = new Date(parseInt(year), 0, 1);
      endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
    } else {
      startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
    }
    // Get all shift categories for this organization
    const categories = await prisma.shiftCategory.findMany({
      where: { organizationId },
      orderBy: { id: 'asc' },
      select: { id: true, name: true }
    });
    const categoryIdToName: Record<number, string> = {};
    categories.forEach((cat: any) => { categoryIdToName[cat.id] = cat.name; });
    const categoryNames = categories.map((c: any) => c.name);
    // Get all shifts for this organization and date range
    const shifts = await prisma.shift.findMany({
      where: {
        organizationId,
        startTime: {
          gte: startDate,
          lte: endDate
        }
      },
      orderBy: { startTime: 'asc' },
      select: { id: true, shiftCategoryId: true, startTime: true, endTime: true }
    });
    const shiftIdToShift = Object.fromEntries(shifts.map((s: any) => [s.id, s]));
    // Get all signups for these shifts
    const shiftIds = shifts.map((s: any) => s.id);
    const signups = await prisma.shiftSignup.findMany({
      where: { shiftId: { in: shiftIds } },
      select: { id: true, userId: true, shiftId: true, checkIn: true, checkOut: true }
    });
    // Group signups by date, category, and then by user
    const dateCategoryUserMap: Record<string, Record<string, Record<number, any[]>>> = {};
    for (const signup of signups) {
      const shift = shiftIdToShift[signup.shiftId];
      if (!shift) continue;
      const category = categoryIdToName[shift.shiftCategoryId] || '';
      const dt = new Date(shift.startTime);
      const parts = dt.toLocaleString('en-US', {
        timeZone: 'America/Halifax',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).split('/');
      const nextDay = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
      nextDay.setDate(nextDay.getDate() + 1);
      const date = nextDay.toISOString().split('T')[0];
      // Special case: for 'Collection' category, only one entry per user per day
      let catKey = category.toLowerCase().includes('collection') ? `collection_${date}` : `${category}_${date}`;
      if (!dateCategoryUserMap[date]) dateCategoryUserMap[date] = {};
      if (!dateCategoryUserMap[date][catKey]) dateCategoryUserMap[date][catKey] = {};
      if (!dateCategoryUserMap[date][catKey][signup.userId]) dateCategoryUserMap[date][catKey][signup.userId] = [];
      dateCategoryUserMap[date][catKey][signup.userId].push({ signup, shift, category, date });
    }
    // Debug: print all signups grouped by date/category/user
    console.log('--- Volunteer Signups Grouped ---');
    for (const date in dateCategoryUserMap) {
      for (const catKey in dateCategoryUserMap[date]) {
        for (const userId in dateCategoryUserMap[date][catKey]) {
          const entries = dateCategoryUserMap[date][catKey][userId];
          console.log(`Date: ${date}, Category: ${catKey}, User: ${userId}, Entries:`, entries.map(e => ({ checkIn: e.signup.checkIn, checkOut: e.signup.checkOut })));
        }
      }
    }
    // Build a map: date -> { categoryName -> totalHours }
    const dateCategoryHours: Record<string, Record<string, number>> = {};
    for (const date in dateCategoryUserMap) {
      for (const catKey in dateCategoryUserMap[date]) {
        // Extract the real category name from the key
        const category = catKey.startsWith('collection_') ? 'Collection' : catKey.split('_')[0];
        let totalCatHours = 0;
        for (const userId in dateCategoryUserMap[date][catKey]) {
          const entries = dateCategoryUserMap[date][catKey][userId];
          // For each user, pick the signup with the longest duration
          let maxHours = 0;
          for (const entry of entries) {
            let checkIn = entry.signup.checkIn ? new Date(entry.signup.checkIn) : new Date(entry.shift.startTime);
            let checkOut = entry.signup.checkOut ? new Date(entry.signup.checkOut) : new Date(entry.shift.endTime);
            let hours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
            if (isNaN(hours) || hours < 0) hours = 0;
            if (hours < 1) hours = 1;
            if (hours > maxHours) {
              maxHours = hours;
            }
            // Debug: print calculated hours for each entry
            console.log(`Date: ${date}, Category: ${category}, User: ${userId}, CheckIn: ${checkIn}, CheckOut: ${checkOut}, Hours: ${hours}`);
          }
          totalCatHours += maxHours;
        }
        if (!dateCategoryHours[date]) dateCategoryHours[date] = {};
        dateCategoryHours[date][category] = (dateCategoryHours[date][category] || 0) + totalCatHours;
        // Debug: print total hours for this date/category
        console.log(`Date: ${date}, Category: ${category}, TotalCatHours: ${totalCatHours}`);
      }
    }
    // Prepare table data: one row per date, columns are categories
    const sortedDates = Object.keys(dateCategoryHours).sort();
    const tableData = sortedDates.map(date => {
      const row: Record<string, string | number> = { Date: date };
      let total = 0;
      categoryNames.forEach((cat: string) => {
        const val = dateCategoryHours[date][cat] || 0;
        row[cat] = Math.round(val * 100) / 100;
        total += val;
      });
      row['Total Hours'] = Math.round(total * 100) / 100;
      return row;
    });
    res.json({ columns: ['Date', ...categoryNames, 'Total Hours'], tableData });
  } catch (err) {
    console.error('Error fetching volunteer hours:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export volunteer hours as Excel
app.get('/api/volunteer-hours/export', authenticateToken, async (req: any, res) => {
  try {
    const { month, year } = req.query;
    const organizationId = req.user.organizationId;
    let startDate: Date, endDate: Date;
    if (!year) {
      return res.status(400).json({ error: 'Year is required' });
    }
    if (!month || parseInt(month) === 0) {
      startDate = new Date(parseInt(year), 0, 1);
      endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
    } else {
      startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
    }
    // Get all shift categories for this organization
    const categories = await prisma.shiftCategory.findMany({
      where: { organizationId },
      orderBy: { id: 'asc' },
      select: { id: true, name: true }
    });
    const categoryIdToName: Record<number, string> = {};
    categories.forEach((cat: any) => { categoryIdToName[cat.id] = cat.name; });
    const categoryNames = categories.map((c: any) => c.name);
    // Get all shifts for this organization and date range
    const shifts = await prisma.shift.findMany({
      where: {
        organizationId,
        startTime: {
          gte: startDate,
          lte: endDate
        }
      },
      orderBy: { startTime: 'asc' },
      select: { id: true, shiftCategoryId: true, startTime: true, endTime: true }
    });
    const shiftIdToShift = Object.fromEntries(shifts.map((s: any) => [s.id, s]));
    // Get all signups for these shifts
    const shiftIds = shifts.map((s: any) => s.id);
    const signups = await prisma.shiftSignup.findMany({
      where: { shiftId: { in: shiftIds } },
      select: { id: true, userId: true, shiftId: true, checkIn: true, checkOut: true }
    });
    // Group signups by date, category, and then by user
    const dateCategoryUserMap: Record<string, Record<string, Record<number, any[]>>> = {};
    for (const signup of signups) {
      const shift = shiftIdToShift[signup.shiftId];
      if (!shift) continue;
      const category = categoryIdToName[shift.shiftCategoryId] || '';
      const dt = new Date(shift.startTime);
      const parts = dt.toLocaleString('en-US', {
        timeZone: 'America/Halifax',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).split('/');
      const nextDay = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
      nextDay.setDate(nextDay.getDate() + 1);
      const date = nextDay.toISOString().split('T')[0];
      let catKey = category.toLowerCase().includes('collection') ? `collection_${date}` : `${category}_${date}`;
      if (!dateCategoryUserMap[date]) dateCategoryUserMap[date] = {};
      if (!dateCategoryUserMap[date][catKey]) dateCategoryUserMap[date][catKey] = {};
      if (!dateCategoryUserMap[date][catKey][signup.userId]) dateCategoryUserMap[date][catKey][signup.userId] = [];
      dateCategoryUserMap[date][catKey][signup.userId].push({ signup, shift, category, date });
    }
    // Build a map: date -> { categoryName -> totalHours }
    const dateCategoryHours: Record<string, Record<string, number>> = {};
    for (const date in dateCategoryUserMap) {
      for (const catKey in dateCategoryUserMap[date]) {
        const category = catKey.startsWith('collection_') ? 'Collection' : catKey.split('_')[0];
        let totalCatHours = 0;
        for (const userId in dateCategoryUserMap[date][catKey]) {
          const entries = dateCategoryUserMap[date][catKey][userId];
          let maxHours = 0;
          for (const entry of entries) {
            let checkIn = entry.signup.checkIn ? new Date(entry.signup.checkIn) : new Date(entry.shift.startTime);
            let checkOut = entry.signup.checkOut ? new Date(entry.signup.checkOut) : new Date(entry.shift.endTime);
            let hours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
            if (isNaN(hours) || hours < 0) hours = 0;
            if (hours < 1) hours = 1;
            if (hours > maxHours) {
              maxHours = hours;
            }
          }
          totalCatHours += maxHours;
        }
        if (!dateCategoryHours[date]) dateCategoryHours[date] = {};
        dateCategoryHours[date][category] = (dateCategoryHours[date][category] || 0) + totalCatHours;
      }
    }
    // Prepare table data: one row per date, columns are categories
    const sortedDates = Object.keys(dateCategoryHours).sort();
    const tableData = sortedDates.map(date => {
      const row: Record<string, string | number> = { Date: date };
      let total = 0;
      categoryNames.forEach((cat: string) => {
        const val = dateCategoryHours[date][cat] || 0;
        row[cat] = Math.round(val * 100) / 100;
        total += val;
      });
      row['Total Hours'] = Math.round(total * 100) / 100;
      return row;
    });
    // Generate Excel file
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Volunteer Hours');
    worksheet.addRow(['Date', ...categoryNames, 'Total Hours']);
    tableData.forEach((row: any) => {
      worksheet.addRow([
        row['Date'],
        ...categoryNames.map((cat: string) => row[cat] || 0),
        row['Total Hours']
      ]);
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="volunteer-hours-${year}-${month}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error exporting volunteer hours:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Inventory by category: sum weightKg from DonationItem, group by DonationCategory.name
app.get('/api/inventory-categories', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    // Get all categories for this org
    const categories = await prisma.donationCategory.findMany({
      where: { organizationId },
      select: { id: true, name: true }
    });
    // Get all donation items for this org, including Donation.createdAt
    const items = await prisma.donationItem.findMany({
      where: {
        Donation: { organizationId }
      },
      select: { categoryId: true, weightKg: true, Donation: { select: { createdAt: true } } }
    });
    // Group by category and find sum and latest date
    const catIdToData: Record<number, { weight: number, date: string | null }> = {};
    items.forEach((item: any) => {
      if (!catIdToData[item.categoryId]) {
        catIdToData[item.categoryId] = { weight: 0, date: null as string | null };
      }
      catIdToData[item.categoryId].weight += item.weightKg;
      const itemDate = item.Donation?.createdAt ? new Date(item.Donation.createdAt) : null;
      if (itemDate) {
        const parts = itemDate.toLocaleString('en-US', {
          timeZone: 'America/Halifax',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).split('/');
        // Add one day to match database data
        const nextDay = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
        nextDay.setDate(nextDay.getDate() + 1);
        const atlanticDateStr = nextDay.toISOString().split('T')[0];
        if (!catIdToData[item.categoryId].date || atlanticDateStr > (catIdToData[item.categoryId].date ?? '')) {
          catIdToData[item.categoryId].date = atlanticDateStr;
        }
      }
    });
    // Build result
    const result = categories
      .map((cat: any) => ({
        name: cat.name,
        weight: catIdToData[cat.id]?.weight || 0,
        date: catIdToData[cat.id]?.date || null
      }))
      .filter((c: any) => c.weight > 0);
    res.json(result);
  } catch (err) {
    console.error('Error fetching inventory categories:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Inventory by category for a specific month/year: sum weightKg from DonationItem, group by DonationCategory.name
app.get('/api/inventory-categories/filtered', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { month, year } = req.query;
    let startDate: Date, endDate: Date;
    if (!year) {
      return res.status(400).json({ error: 'Year is required' });
    }
    if (!month || parseInt(month) === 0) {
      // All months: get the whole year
      startDate = new Date(parseInt(year), 0, 1);
      endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
    } else {
      startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
    }
    // Get all categories for this org
    const categories = await prisma.donationCategory.findMany({
      where: { organizationId },
      select: { id: true, name: true }
    });
    // Get all donation items for this org and date range, including Donation.createdAt
    const items = await prisma.donationItem.findMany({
      where: {
        Donation: {
          organizationId,
          createdAt: {
            gte: startDate,
            lte: endDate
          }
        }
      },
      select: { categoryId: true, weightKg: true, Donation: { select: { createdAt: true } } }
    });
    // Group by category and find sum and latest date
    const catIdToData: Record<number, { weight: number, date: string | null }> = {};
    items.forEach((item: any) => {
      if (!catIdToData[item.categoryId]) {
        catIdToData[item.categoryId] = { weight: 0, date: null as string | null };
      }
      catIdToData[item.categoryId].weight += item.weightKg;
      const itemDate = item.Donation?.createdAt ? new Date(item.Donation.createdAt) : null;
      if (itemDate) {
        const parts = itemDate.toLocaleString('en-US', {
          timeZone: 'America/Halifax',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).split('/');
        // Add one day to match database data
        const nextDay = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
        nextDay.setDate(nextDay.getDate() + 1);
        const atlanticDateStr = nextDay.toISOString().split('T')[0];
        if (!catIdToData[item.categoryId].date || atlanticDateStr > (catIdToData[item.categoryId].date ?? '')) {
          catIdToData[item.categoryId].date = atlanticDateStr;
        }
      }
    });
    // Build result
    const result = categories
      .map((cat: any) => ({
        name: cat.name,
        weight: catIdToData[cat.id]?.weight || 0,
        date: catIdToData[cat.id]?.date || null
      }))
      .filter((c: any) => c.weight > 0);
    res.json(result);
  } catch (err) {
    console.error('Error fetching filtered inventory categories:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export inventory categories as Excel for dashboard (filtered by month/year/unit)
app.get('/api/inventory-categories/export-dashboard', authenticateToken, async (req: any, res) => {
  try {
    const { month, year, unit } = req.query;
    const organizationId = req.user.organizationId;
    let startDate: Date | undefined, endDate: Date | undefined;
    if (year) {
      if (!month || parseInt(month) === 0) {
        startDate = new Date(parseInt(year), 0, 1);
        endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
      } else {
        startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
        endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
      }
    }
    const categories = await prisma.donationCategory.findMany({
      where: { organizationId },
      select: { id: true, name: true }
    });
    const itemWhere: any = { Donation: { organizationId } };
    if (startDate && endDate) {
      itemWhere.Donation.createdAt = { gte: startDate, lte: endDate };
    }
    const items = await prisma.donationItem.findMany({
      where: itemWhere,
      select: { categoryId: true, weightKg: true }
    });
    const catIdToWeight: Record<number, number> = {};
    items.forEach((item: any) => {
      catIdToWeight[item.categoryId] = (catIdToWeight[item.categoryId] || 0) + item.weightKg;
    });
    const result = categories
      .map((cat: any) => ({ name: cat.name, weight: catIdToWeight[cat.id] || 0 }))
      .filter((c: any) => c.weight > 0);
    // Generate Excel file
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Inventory');
    worksheet.addRow(['Category', `Weight (${unit === 'Pounds (lb)' ? 'lbs' : 'kg'})`]);
    result.forEach((row: any) => {
      const weight = unit === 'Pounds (lb)' ? Math.round(row.weight * 2.20462) : Math.round(row.weight);
      worksheet.addRow([row.name, weight]);
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="inventory-dashboard.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error exporting inventory categories (dashboard):', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export outgoing stats as Excel for dashboard
app.get('/api/outgoing-stats/export-dashboard', authenticateToken, async (req: any, res) => {
  try {
    const { month, year } = req.query;
    const organizationId = req.user.organizationId;
    let startDate: Date, endDate: Date;
    if (!year) {
      return res.status(400).json({ error: 'Year is required' });
    }
    if (!month || parseInt(month) === 0) {
      startDate = new Date(parseInt(year), 0, 1);
      endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
    } else {
      startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
    }
    // Get all shift categories for this organization
    const categories = await prisma.shiftCategory.findMany({
      where: { organizationId },
      orderBy: { id: 'asc' },
      select: { id: true, name: true }
    });
    const categoryIdToName: Record<number, string> = {};
    categories.forEach((cat: any) => { categoryIdToName[cat.id] = cat.name; });
    // Get all shifts for this organization and date range
    const shifts = await prisma.shift.findMany({
      where: {
        organizationId,
        startTime: {
          gte: startDate,
          lte: endDate
        }
      },
      orderBy: { startTime: 'asc' },
      select: { id: true, shiftCategoryId: true, startTime: true }
    });
    // Build a map: shiftId -> { date, categoryName }
    const shiftIdToDate: Record<number, string> = {};
    const shiftIdToCategory: Record<number, string> = {};
    const dateSet = new Set<string>();
    shifts.forEach((shift: any) => {
      const dt = new Date(shift.startTime);
      const parts = dt.toLocaleString('en-US', {
        timeZone: 'America/Halifax',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).split('/');
      // Add one day to match database data
      const nextDay = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
      nextDay.setDate(nextDay.getDate() + 1);
      const date = nextDay.toISOString().split('T')[0];
      shiftIdToDate[shift.id] = date;
      shiftIdToCategory[shift.id] = categoryIdToName[shift.shiftCategoryId] || '';
      dateSet.add(date);
    });
    // Get all shift signups for these shifts
    const shiftIds = shifts.map((s: any) => s.id);
    const signups = await prisma.shiftSignup.findMany({
      where: { shiftId: { in: shiftIds } },
      select: { shiftId: true, mealsServed: true }
    });
    // Build a map: date -> { categoryName -> totalMeals }
    const dateCategoryMeals: Record<string, Record<string, number>> = {};
    signups.forEach((signup: any) => {
      const shiftId = signup.shiftId;
      const date = shiftIdToDate[shiftId];
      const category = shiftIdToCategory[shiftId];
      if (!date || !category) return;
      if (!dateCategoryMeals[date]) dateCategoryMeals[date] = {};
      dateCategoryMeals[date][category] = (dateCategoryMeals[date][category] || 0) + (signup.mealsServed || 0);
    });
    // Prepare table data: one row per date, columns are categories
    const sortedDates = Array.from(dateSet).sort();
    const categoryNames = categories.map((c: any) => c.name);
    // Generate Excel file
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Outgoing Stats');
    worksheet.addRow(['Date', ...categoryNames]);
    sortedDates.forEach(date => {
      const row = [date, ...categoryNames.map(cat => dateCategoryMeals[date]?.[cat] || 0)];
      worksheet.addRow(row);
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="outgoing-dashboard-${year}-${month}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error exporting outgoing stats (dashboard):', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export volunteer summary as Excel for dashboard
app.get('/api/volunteers/summary/export-dashboard', authenticateToken, async (req: any, res) => {
  try {
    const { month, year } = req.query;
    const organizationId = req.user.organizationId;
    let startDate: Date, endDate: Date;
    if (!year) {
      return res.status(400).json({ error: 'Year is required' });
    }
    if (!month || parseInt(month) === 0) {
      startDate = new Date(parseInt(year), 0, 1);
      endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
    } else {
      startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
    }
    // Get all shift signups for this org in the date range
    const signups = await prisma.shiftSignup.findMany({
      where: {
        Shift: {
          organizationId,
          startTime: {
            gte: startDate,
            lte: endDate
          }
        }
      },
      include: {
        User: true,
        Shift: true
      }
    });
    // Group by user
    const userMap: Record<number, { name: string; role: string; hours: number }> = {};
    for (const signup of signups) {
      const user = signup.User;
      if (!user) continue;
      const name = user.firstName + ' ' + user.lastName;
      const role = user.role;
      // Calculate hours worked for this signup
      let hours = 0;
      if (signup.checkIn && signup.checkOut) {
        hours = (new Date(signup.checkOut).getTime() - new Date(signup.checkIn).getTime()) / (1000 * 60 * 60);
      }
      if (!userMap[user.id]) {
        userMap[user.id] = { name, role, hours: 0 };
      }
      userMap[user.id].hours += hours;
    }
    // Convert to array and sort by hours desc
    const result = Object.values(userMap)
      .map(v => ({ ...v, hours: Math.round(v.hours * 100) / 100 }))
      .sort((a, b) => b.hours - a.hours);
    // Generate Excel file
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Volunteer Summary');
    worksheet.addRow(['Name', 'Role', 'Hours Worked']);
    result.forEach((row: any) => {
      worksheet.addRow([row.name, row.role, row.hours]);
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="volunteer-dashboard-${year}-${month}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error exporting volunteer summary (dashboard):', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get dashboard summary data
app.get('/api/dashboard-summary', authenticateToken, async (req: any, res) => {
  try {
    const { month, year } = req.query;
    const organizationId = req.user.organizationId;

    // Get date range based on month/year
    let startDate: Date, endDate: Date;
    if (parseInt(month) === 0) {
      // All months: get the whole year
      startDate = new Date(parseInt(year), 0, 1);
      endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
    } else {
      startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
    }

    // Get incoming stats
    const donations = await prisma.donation.findMany({
      where: {
        organizationId,
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      }
    });

    // Get outgoing stats
    const shifts = await prisma.shift.findMany({
      where: {
        organizationId,
        startTime: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        ShiftSignups: true
      }
    });

    // Get volunteer stats
    const volunteerHours = await prisma.shiftSignup.findMany({
      where: {
        shift: {
          organizationId,
          startTime: {
            gte: startDate,
            lte: endDate
          }
        }
      }
    });

    // Get inventory stats
    const inventory = await prisma.donationItem.findMany({
      where: {
        Donation: {
          organizationId,
          createdAt: {
            gte: startDate,
            lte: endDate
          }
        }
      }
    });

    // Calculate totals
    const incomingStats = {
      totalDonations: donations.length,
      totalWeight: donations.reduce((sum: number, d: any) => sum + (d.summary || 0), 0)
    };

    const outgoingStats = {
      totalMeals: shifts.reduce((sum: number, shift: any) => 
        sum + shift.ShiftSignups.reduce((s: number, signup: any) => s + (signup.mealsServed || 0), 0), 0),
      totalShifts: shifts.length
    };

    const volunteerStats = {
      totalHours: volunteerHours.reduce((sum: number, v: any) => sum + (v.hoursWorked || 0), 0),
      totalVolunteers: new Set(volunteerHours.map((v: any) => v.userId)).size
    };

    const inventoryStats = {
      totalItems: inventory.length,
      totalWeight: inventory.reduce((sum: number, item: any) => sum + (item.weightKg || 0), 0)
    };

    res.json({
      incomingStats,
      outgoingStats,
      volunteerStats,
      inventoryStats
    });
  } catch (err) {
    console.error('Error fetching dashboard summary:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Volunteer summary endpoint
app.get('/api/volunteers/summary', authenticateToken, async (req: any, res) => {
  try {
    const { month, year } = req.query;
    const organizationId = req.user.organizationId;

    // Get date range based on month/year
    let startDate: Date, endDate: Date;
    if (parseInt(month) === 0) {
      // All months: get the whole year
      startDate = new Date(parseInt(year), 0, 1);
      endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
    } else {
      startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
    }

    // Get all shift signups for this org in the date range
    const signups = await prisma.shiftSignup.findMany({
      where: {
        Shift: {
          organizationId,
          startTime: {
            gte: startDate,
            lte: endDate
          }
        }
      },
      include: {
        User: true,
        Shift: true
      }
    });

    // Group by user
    const userMap: Record<number, { name: string; role: string; hours: number }> = {};
    for (const signup of signups) {
      const user = signup.User;
      if (!user) continue;
      const name = user.firstName + ' ' + user.lastName;
      const role = user.role;
      // Calculate hours worked for this signup
      let hours = 0;
      if (signup.checkIn && signup.checkOut) {
        hours = (new Date(signup.checkOut).getTime() - new Date(signup.checkIn).getTime()) / (1000 * 60 * 60);
      }
      if (!userMap[user.id]) {
        userMap[user.id] = { name, role, hours: 0 };
      }
      userMap[user.id].hours += hours;
    }

    // Convert to array and sort by hours desc
    const result = Object.values(userMap)
      .map(v => ({ ...v, hours: Math.round(v.hours * 100) / 100 }))
      .sort((a, b) => b.hours - a.hours);

    res.json(result);
  } catch (err) {
    console.error('Error fetching volunteer summary:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get organization name by ID
app.get('/api/organization/:id', authenticateToken, async (req, res) => {
  try {
    const orgId = parseInt(req.params.id);
    if (!orgId) return res.status(400).json({ error: 'Invalid organization id' });
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    res.json({ name: org.name });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
}) 