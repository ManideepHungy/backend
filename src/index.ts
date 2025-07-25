import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import ExcelJS from 'exceljs'
import nodemailer from 'nodemailer'
import { upload, uploadToR2, deleteFromR2, generateSignedUrl } from './services/fileUpload'
import multer from 'multer'
import path from 'path'
import fs from 'fs'

dotenv.config()

// Halifax timezone utilities
const HALIFAX_TIMEZONE = 'America/Halifax';

// Convert UTC date to Halifax timezone
const toHalifaxTime = (utcDate: Date): Date => {
  const halifaxDate = new Date(utcDate.toLocaleString('en-CA', { timeZone: HALIFAX_TIMEZONE }));
  return halifaxDate;
};

// Convert Halifax timezone to UTC for database storage
const toUTC = (halifaxDate: Date): Date => {
  const utcDate = new Date(halifaxDate.toLocaleString('en-CA', { timeZone: 'UTC' }));
  return utcDate;
};

// Get Halifax date string (YYYY-MM-DD)
const getHalifaxDateString = (date: Date): string => {
  return date.toLocaleDateString('en-CA', { timeZone: HALIFAX_TIMEZONE }).split('/').reverse().join('-');
};

// Create date in Halifax timezone
const createHalifaxDate = (year: number, month: number, day: number, hour: number = 0, minute: number = 0): Date => {
  const halifaxDate = new Date(year, month - 1, day, hour, minute, 0, 0);
  return halifaxDate;
};

const app = express()
const prisma = new PrismaClient()
const port = process.env.PORT || 3001
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

// Add TypeScript declaration for global OTP store
declare global {
  var otpStore: {
    [email: string]: {
      otp: string;
      expiry: Date;
      attempts: number;
    };
  } | undefined;
}

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
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check if user is admin (for admin login)
    if (user.role !== 'ADMIN') {
      return res.status(401).json({ error: 'Access denied. Admin privileges required.' });
    }

    // Compare password - handle both hashed and plain text passwords for backward compatibility
    let validPassword = false;
    
    // First, try to compare with bcrypt (for hashed passwords)
    if (user.password.startsWith('$2b$') || user.password.startsWith('$2a$')) {
      validPassword = await bcrypt.compare(password, user.password);
    } else {
      // For plain text passwords (backward compatibility)
      validPassword = password === user.password;
    }

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Create JWT with user ID
    const token = jwt.sign({ 
      id: user.id,
      userId: user.id, 
      email: user.email, 
      role: user.role, 
      organizationId: user.organizationId 
    }, JWT_SECRET, { expiresIn: '7d' });
    
    return res.json({ token });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// User login endpoint (for non-admin users)
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Find user by email
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Compare password - handle both hashed and plain text passwords for backward compatibility
    let validPassword = false;
    
    // First, try to compare with bcrypt (for hashed passwords)
    if (user.password.startsWith('$2b$') || user.password.startsWith('$2a$')) {
      validPassword = await bcrypt.compare(password, user.password);
    } else {
      // For plain text passwords (backward compatibility)
      validPassword = password === user.password;
    }

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Create JWT with user ID
    const token = jwt.sign({ 
      id: user.id,
      userId: user.id, 
      email: user.email, 
      role: user.role, 
      organizationId: user.organizationId 
    }, JWT_SECRET, { expiresIn: '7d' });
    
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

    // Get incoming_dollar_value for this organization
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { incoming_dollar_value: true }
    });
    const incomingDollarValue = org?.incoming_dollar_value || 0;

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

    // Calculate totals for each donor
    const donorTotals: { [donor: string]: { weight: number, value: number } } = {};
    for (const donor of donors) {
      donorTotals[donor.name] = { weight: 0, value: 0 };
    }
    for (const donation of donations) {
      const donorName = donation.Donor.name;
      const totalWeight = donation.summary;
      if (donorTotals[donorName]) {
        donorTotals[donorName].weight += totalWeight;
        donorTotals[donorName].value += totalWeight * incomingDollarValue;
      }
    }

    // Calculate totals
    const totals = donors.reduce((acc: any, donor: any) => {
      acc[donor.name] = tableData.reduce((sum: number, row: any) => sum + (row[donor.name] || 0), 0);
      return acc;
    }, {});

    // Calculate row totals
    const rowTotals = tableData.map((row: any) => 
      donors.reduce((sum: number, donor: any) => sum + (row[donor.name] || 0), 0)
    );

    // Calculate grand totals
    const grandTotalWeight = Object.values(donorTotals).reduce((sum, d) => sum + d.weight, 0);
    const grandTotalValue = Object.values(donorTotals).reduce((sum, d) => sum + d.value, 0);
    const grandTotal = Object.values(totals).reduce((sum: number, val: any) => sum + val, 0);

    res.json({
      donors: donors.map((d: any) => d.name),
      tableData: tableData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
      totals,
      rowTotals,
      grandTotal,
      donorTotals,
      grandTotalWeight,
      grandTotalValue,
      incomingDollarValue
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

    // Get weighing categories for custom unit conversion
    const weighingCategories = await prisma.weighingCategory.findMany({
      where: { organizationId },
      select: {
        id: true,
        category: true,
        kilogram_kg_: true,
        pound_lb_: true
      }
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

    // Helper function to convert weight based on selected unit
    const convertWeight = (weight: number) => {
      if (weight == null || isNaN(weight)) return 0;
      
      // Handle base units
      if (unit === 'Pounds (lb)') {
        return +(weight * 2.20462).toFixed(2);
      }
      if (unit === 'Kilograms (kg)') {
        return +weight.toFixed(2);
      }
      
      // Handle custom weighing categories
      const category = weighingCategories.find(c => c.category === unit);
      if (category && category.kilogram_kg_ > 0) {
        // Convert kg to custom unit (divide by kg per unit)
        return +(weight / category.kilogram_kg_).toFixed(2);
      }
      
      return +weight.toFixed(2);
    };

    // Helper function to format date for Excel (matches frontend display)
    const formatDateForExcel = (dateStr: string) => {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    };

    // Helper function to get unit label for display
    const getUnitLabel = () => {
      if (unit === 'Kilograms (kg)') return 'kg';
      if (unit === 'Pounds (lb)') return 'lbs';
      return unit;
    };

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Incoming Stats');

    // Check if we need to aggregate by month (All Months view)
    if (parseInt(month) === 0) {
      // Monthly aggregated view
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                         'July', 'August', 'September', 'October', 'November', 'December'];
      
      // Initialize all months
      const monthMap: { [month: number]: any } = {};
      for (let m = 1; m <= 12; m++) {
        monthMap[m] = { Month: monthNames[m - 1] };
        donors.forEach(donor => {
          monthMap[m][donor.name] = 0;
        });
        monthMap[m]['Total'] = 0;
      }

      // Aggregate data by month
      tableData.forEach(row => {
        const d = new Date(row.date as string);
        if (isNaN(d.getTime())) return;
        const m = d.getMonth() + 1;
        let rowTotal = 0;
        donors.forEach(donor => {
          if (typeof row[donor.name] === 'number') {
            const value = Number(row[donor.name]);
            monthMap[m][donor.name] += value;
            rowTotal += value;
          }
        });
        monthMap[m]['Total'] += rowTotal;
      });

      // Build display data for all months
      const displayData = Object.values(monthMap);
      const columns = ['Month', ...donors.map(d => d.name), 'Total'];

      // Header row with unit labels
      const headerRow = columns.map(col => {
        if (col === 'Month' || col === 'Total') return col;
        return `${col} (${getUnitLabel()})`;
      });
    worksheet.addRow(headerRow);

    // Data rows
      displayData.forEach((row: any) => {
      const rowArr = [
          row.Month,
          ...donors.map(d => convertWeight(row[d.name] || 0)),
          convertWeight(row.Total || 0)
      ];
      worksheet.addRow(rowArr);
    });

      // Yearly totals row
      const yearlyTotalsRow = [
        'Yearly Total',
        ...donors.map(d => convertWeight(totals[d.name] || 0)),
        convertWeight(grandTotal)
      ];
      worksheet.addRow(yearlyTotalsRow);

    } else {
      // Daily view for specific month
      const columns = ['Date', ...donors.map(d => d.name), 'Total'];

      // Header row with unit labels
      const headerRow = columns.map(col => {
        if (col === 'Date' || col === 'Total') return col;
        return `${col} (${getUnitLabel()})`;
      });
      worksheet.addRow(headerRow);

      // Data rows
      tableData.forEach((row: any, i: number) => {
        const rowArr = [
          formatDateForExcel(row.date),
          ...donors.map(d => convertWeight(row[d.name] || 0)),
          convertWeight(rowTotals[i])
        ];
        worksheet.addRow(rowArr);
      });

      // Monthly totals row
      const monthlyTotalsRow = [
        'Monthly Total',
        ...donors.map(d => convertWeight(totals[d.name] || 0)),
        convertWeight(grandTotal)
      ];
      worksheet.addRow(monthlyTotalsRow);
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
      orderBy: { name: 'asc' }
    });
    res.json(categories);
  } catch (err) {
    console.error('Error fetching shift categories:', err);
    res.status(500).json({ error: 'Failed to fetch shift categories' });
  }
});

// Outgoing stats: meals distributed by shift category and shift name (for dashboard)
app.get('/api/outgoing-stats', authenticateToken, async (req: any, res) => {
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
      select: { id: true, name: true, shiftCategoryId: true, startTime: true }
    });
    // Build a map: shiftId -> { date, categoryName, shiftName }
    const shiftIdToInfo: Record<number, { date: string, category: string, shiftName: string }> = {};
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
      shiftIdToInfo[shift.id] = {
        date,
        category: categories.find((c: any) => c.id === shift.shiftCategoryId)?.name || '',
        shiftName: shift.name
      };
      dateSet.add(date);
    });
    // Get all shift signups for these shifts
    const shiftIds = shifts.map((s: any) => s.id);
    const signups = await prisma.shiftSignup.findMany({
      where: { shiftId: { in: shiftIds } },
      select: { shiftId: true, mealsServed: true }
    });
    // Build a map: category -> shiftName -> totalMeals
    const categoryShiftMeals: Record<string, Record<string, number>> = {};
    signups.forEach((signup: any) => {
      const info = shiftIdToInfo[signup.shiftId];
      if (!info) return;
      const { category, shiftName } = info;
      if (!category || !shiftName) return;
      if (!categoryShiftMeals[category]) categoryShiftMeals[category] = {};
      categoryShiftMeals[category][shiftName] = (categoryShiftMeals[category][shiftName] || 0) + (signup.mealsServed || 0);
    });
    // Build response: for each category, list shift names and their totals, and category total
    const result = categories.map((cat: any) => {
      const shiftsInCat = Object.entries(categoryShiftMeals[cat.name] || {}).map(([shiftName, total]) => ({ shiftName, total }));
      const categoryTotal = shiftsInCat.reduce((sum, s) => sum + s.total, 0);
      return {
        category: cat.name,
        shifts: shiftsInCat,
        total: categoryTotal
      };
    });
    res.json({
      data: result
    });
  } catch (err) {
    console.error('Error fetching outgoing stats:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export outgoing stats as Excel for dashboard (category + shift name breakdown)
app.get('/api/outgoing-stats/export-dashboard', authenticateToken, async (req: any, res) => {
  try {
    const { month, year, unit } = req.query;
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
      select: { id: true, name: true, shiftCategoryId: true, startTime: true }
    });
    // Build a map: shiftId -> { date, categoryName, shiftName }
    const shiftIdToInfo: Record<number, { date: string, category: string, shiftName: string }> = {};
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
      shiftIdToInfo[shift.id] = {
        date,
        category: categories.find((c: any) => c.id === shift.shiftCategoryId)?.name || '',
        shiftName: shift.name
      };
    });
    // Get all shift signups for these shifts
    const shiftIds = shifts.map((s: any) => s.id);
    const signups = await prisma.shiftSignup.findMany({
      where: { shiftId: { in: shiftIds } },
      select: { shiftId: true, mealsServed: true }
    });
    // Build a map: category -> shiftName -> totalMeals
    const categoryShiftMeals: Record<string, Record<string, number>> = {};
    signups.forEach((signup: any) => {
      const info = shiftIdToInfo[signup.shiftId];
      if (!info) return;
      const { category, shiftName } = info;
      if (!category || !shiftName) return;
      if (!categoryShiftMeals[category]) categoryShiftMeals[category] = {};
      categoryShiftMeals[category][shiftName] = (categoryShiftMeals[category][shiftName] || 0) + (signup.mealsServed || 0);
    });
    // Custom unit support - use weight ratios instead of noofmeals
    let customWeightRatio = null;
    let unitLabel = 'kg';
    if (unit && unit !== 'kg' && unit !== 'lb' && unit !== 'Kilograms (kg)' && unit !== 'Pounds (lb)') {
      const weighingCat = await prisma.weighingCategory.findFirst({
        where: { organizationId, category: unit },
        select: { kilogram_kg_: true, category: true }
      });
      if (weighingCat && weighingCat.kilogram_kg_ > 0) {
        customWeightRatio = weighingCat.kilogram_kg_;
        unitLabel = unit;
      }
    } else if (unit === 'lb' || unit === 'Pounds (lb)') {
      customWeightRatio = 1 / 2.20462; // Convert kg to lb
      unitLabel = 'lb';
    }
    // Generate Excel file: columns are [Category, Shift Name, Total Weight in Selected Unit]
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Outgoing Stats');
    worksheet.addRow(['Category', 'Shift Name', `Total Weight (${unitLabel})`]);
    categories.forEach((cat: any) => {
      const shiftsInCat = Object.entries(categoryShiftMeals[cat.name] || {});
      shiftsInCat.forEach(([shiftName, total]) => {
        let val = total; // total is already in kg
        if (customWeightRatio) {
          val = total / customWeightRatio; // Convert kg to custom unit
        } else if (unitLabel === 'lb') {
          val = total * 2.20462; // Convert kg to lb
        }
        worksheet.addRow([cat.name, shiftName, Math.round(val * 100) / 100]);
      });
      // Add category total row
      let catTotal = shiftsInCat.reduce((sum, [, total]) => sum + (total as number), 0);
      if (customWeightRatio) {
        catTotal = catTotal / customWeightRatio;
      } else if (unitLabel === 'lb') {
        catTotal = catTotal * 2.20462;
      }
      worksheet.addRow([cat.name, 'Category Total', Math.round(catTotal * 100) / 100]);
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
    const { month, year, unit } = req.query;
    const organizationId = req.user.organizationId;

    // Get weighing categories for custom unit conversion
    const weighingCategories = await prisma.weighingCategory.findMany({
      where: { organizationId },
      select: {
        id: true,
        category: true,
        kilogram_kg_: true,
        pound_lb_: true
      }
    });

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
    // Filter out 'Collections' category from display (matches frontend logic)
    const filteredCategoryNames = categoryNames.filter(name => name !== 'Collections');
    
    const tableData = sortedDates.map((date: any) => {
      const row: Record<string, string | number> = { Date: date };
      let total = 0;
      filteredCategoryNames.forEach((cat: string) => {
        const val = dateCategoryMeals[date]?.[cat] || 0;
        row[cat] = val;
        total += val;
      });
      row['Total'] = total;
      return row;
    });

    // Calculate totals for each category
    const totals: Record<string, number> = {};
    let grandTotal = 0;
    filteredCategoryNames.forEach(cat => {
      totals[cat] = tableData.reduce((sum, row) => sum + (Number(row[cat]) || 0), 0);
      grandTotal += totals[cat];
    });

    // Helper function to convert weight based on selected unit
    const convertWeight = (value: number) => {
      if (value == null || isNaN(value)) return 0;
      
      // Handle base units
      if (unit === 'kg') {
        return +value.toFixed(2);
      }
      if (unit === 'lb') {
        return +(value * 2.20462).toFixed(2);
      }
      
      // Handle custom weighing categories
      const category = weighingCategories.find(c => c.category === unit);
      if (category && category.kilogram_kg_ > 0) {
        // Convert kg to custom unit (divide by kg per unit)
        return +(value / category.kilogram_kg_).toFixed(2);
      }
      
      return +value.toFixed(2);
    };

    // Helper function to format date for Excel (matches frontend display)
    const formatDateForExcel = (dateStr: string) => {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    };

    // Helper function to get unit label for display
    const getUnitLabel = () => {
      if (unit === 'kg') return 'kg';
      if (unit === 'lb') return 'lb';
      return unit;
    };

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Outgoing Stats');

    // Check if we need to aggregate by month (All Months view)
    if (parseInt(month) === 0) {
      // Monthly aggregated view
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                         'July', 'August', 'September', 'October', 'November', 'December'];
      
      // Initialize all months
      const monthMap: { [month: number]: any } = {};
      for (let m = 1; m <= 12; m++) {
        monthMap[m] = { Month: monthNames[m - 1] };
        filteredCategoryNames.forEach(cat => {
          monthMap[m][cat] = 0;
        });
        monthMap[m]['Total'] = 0;
      }

      // Aggregate data by month
      tableData.forEach(row => {
        const d = new Date(row.Date as string);
        if (isNaN(d.getTime())) return;
        const m = d.getMonth() + 1;
        let rowTotal = 0;
        filteredCategoryNames.forEach(cat => {
          if (typeof row[cat] === 'number') {
            const value = Number(row[cat]);
            monthMap[m][cat] += value;
            rowTotal += value;
          }
        });
        monthMap[m]['Total'] += rowTotal;
      });

      // Build display data for all months
      const displayData = Object.values(monthMap);
      const columns = ['Month', ...filteredCategoryNames, 'Total'];

      // Header row with unit labels
      const headerRow = columns.map(col => {
        if (col === 'Month' || col === 'Total') return col;
        return `${col} (${getUnitLabel()})`;
      });
      worksheet.addRow(headerRow);

      // Data rows
    tableData.forEach((row: any) => {
        const rowArr = [
          formatDateForExcel(row.Date as string),
          ...filteredCategoryNames.map(cat => convertWeight(row[cat] || 0)),
          convertWeight(row.Total || 0)
        ];
        worksheet.addRow(rowArr);
      });

      // Monthly totals row
      const monthlyTotalsRow = [
        'Monthly Total',
        ...filteredCategoryNames.map(cat => convertWeight(totals[cat] || 0)),
        convertWeight(grandTotal)
      ];
      worksheet.addRow(monthlyTotalsRow);
    }

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
    // Check if we need to aggregate by month (when month=0, "All Months")
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Volunteer Hours');
    
    if (!month || parseInt(month) === 0) {
      // Aggregate by month (same logic as frontend)
      const monthMap: Record<number, any> = {};
      const monthNames = [
        '', 'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      
      // Initialize all months
      for (let m = 1; m <= 12; m++) {
        monthMap[m] = { Month: monthNames[m] };
        categoryNames.forEach((cat: string) => {
          monthMap[m][cat] = 0;
        });
      }

      // Aggregate daily data by month
      Object.keys(dateCategoryHours).forEach(date => {
        const d = new Date(date);
        if (isNaN(d.getTime())) return;
        const m = d.getMonth() + 1;
        categoryNames.forEach((cat: string) => {
          const val = dateCategoryHours[date][cat] || 0;
          monthMap[m][cat] += val;
        });
      });

      // Build monthly display data
      const monthlyData = Object.values(monthMap);
      
      // Generate Excel file with monthly aggregation
      worksheet.addRow(['Month', ...categoryNames, 'Total Hours']);
      
      monthlyData.forEach((row: any) => {
        let total = 0;
        categoryNames.forEach((cat: string) => {
          total += (row[cat] || 0);
        });
        worksheet.addRow([
          row['Month'],
          ...categoryNames.map((cat: string) => Math.round((row[cat] || 0) * 100) / 100),
          Math.round(total * 100) / 100
        ]);
      });

      // Add total row
      const totalRow: any[] = ['Total Hours'];
      let grandTotal: number = 0;
      categoryNames.forEach((cat: string) => {
        const catTotal: number = monthlyData.reduce((sum: number, row: any) => sum + (Number(row[cat]) || 0), 0);
        totalRow.push(Math.round(catTotal * 100) / 100);
        grandTotal += catTotal;
      });
      totalRow.push(Math.round(grandTotal * 100) / 100);
      worksheet.addRow(totalRow);
      
    } else {
      // Daily view (specific month selected)
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

      // Helper function to format date for Excel (to match frontend display)
      const formatDateForExcel = (dateStr: string) => {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
      };

      // Generate Excel file with daily data
    worksheet.addRow(['Date', ...categoryNames, 'Total Hours']);
    tableData.forEach((row: any) => {
      worksheet.addRow([
        formatDateForExcel(row['Date']),
        ...categoryNames.map((cat: string) => row[cat] || 0),
        row['Total Hours']
      ]);
    });

      // Add total row
      const totalRow: any[] = ['Total Hours'];
      let grandTotal: number = 0;
      categoryNames.forEach((cat: string) => {
        const catTotal: number = tableData.reduce((sum: number, row: any) => sum + (typeof row[cat] === 'number' ? Number(row[cat]) : 0), 0);
        totalRow.push(Math.round(catTotal * 100) / 100);
        grandTotal += catTotal;
      });
      totalRow.push(Math.round(grandTotal * 100) / 100);
      worksheet.addRow(totalRow);
    }
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
    if (!month || month === 'all' || parseInt(month) === 0) {
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
    // Custom unit support
    let customKg = null;
    let unitLabel = 'kg';
    if (unit && unit !== 'kg' && unit !== 'lb' && unit !== 'Kilograms (kg)' && unit !== 'Pounds (lb)') {
      const weighingCat = await prisma.weighingCategory.findFirst({
        where: { organizationId, category: unit },
        select: { kilogram_kg_: true }
      });
      if (weighingCat && weighingCat.kilogram_kg_ > 0) {
        customKg = weighingCat.kilogram_kg_;
        unitLabel = unit;
      }
    }
    // Build result
    const result = categories
      .map((cat: any) => ({ name: cat.name, weight: catIdToWeight[cat.id] || 0 }))
      .filter((c: any) => c.weight > 0);
    // Generate Excel file
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Inventory');
    worksheet.addRow(['Category', `Weight (${unitLabel})`]);
    let total = 0;
    result.forEach((row: any) => {
      let weight = row.weight;
      if (unit === 'Pounds (lb)') weight = Math.round(weight * 2.20462);
      else if (customKg) weight = Math.round(weight / customKg);
      else weight = Math.round(weight);
      total += weight;
      worksheet.addRow([row.name, weight]);
    });
    worksheet.addRow(['Total', total]);
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
    // Add total row
    const totalHours = result.reduce((sum, row) => sum + row.hours, 0);
    worksheet.addRow(['Total', '', Math.round(totalHours * 100) / 100]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="volunteer-dashboard-${year}-${month}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error exporting volunteer summary (dashboard):', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export dashboard summary as Excel
app.get('/api/dashboard-summary/export', authenticateToken, async (req: any, res) => {
  try {
    const { month, year, unit } = req.query;
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

    // Use the same logic as outgoing-stats to get the data that matches the frontend
    const categories = await prisma.shiftCategory.findMany({
      where: { organizationId },
      orderBy: { id: 'asc' },
      select: { id: true, name: true }
    });

    const shifts = await prisma.shift.findMany({
      where: {
        organizationId,
        startTime: {
          gte: startDate,
          lte: endDate
        }
      },
      orderBy: { startTime: 'asc' },
      select: { id: true, name: true, shiftCategoryId: true, startTime: true }
    });

    // Build shift info map
    const shiftIdToInfo: Record<number, { date: string, category: string, shiftName: string }> = {};
    const categoryIdToName: Record<number, string> = {};
    categories.forEach((cat: any) => { categoryIdToName[cat.id] = cat.name; });

    const dateSet = new Set<string>();
    shifts.forEach((shift: any) => {
      const date = shift.startTime.toISOString().split('T')[0];
      const categoryName = categoryIdToName[shift.shiftCategoryId] || 'Unknown';
      const shiftName = shift.name || 'Unnamed Shift';
      shiftIdToInfo[shift.id] = { date, category: categoryName, shiftName };
      dateSet.add(date);
    });

    // Get all shift signups for these shifts (same as outgoing stats endpoint)
    const shiftIds = shifts.map((s: any) => s.id);
    const signups = await prisma.shiftSignup.findMany({
      where: { shiftId: { in: shiftIds } },
      select: { shiftId: true, mealsServed: true }
    });

    // Build a map: category -> shiftName -> totalMeals (same as outgoing stats)
    const categoryShiftMeals: Record<string, Record<string, number>> = {};
    signups.forEach((signup: any) => {
      const info = shiftIdToInfo[signup.shiftId];
      if (!info) return;
      const { category, shiftName } = info;
      if (!category || !shiftName) return;
      if (!categoryShiftMeals[category]) categoryShiftMeals[category] = {};
      categoryShiftMeals[category][shiftName] = (categoryShiftMeals[category][shiftName] || 0) + (signup.mealsServed || 0);
    });

    // Build response data (same format as outgoing stats)
    const categoryData = categories.map((cat: any) => {
      const shiftsInCat = Object.entries(categoryShiftMeals[cat.name] || {}).map(([shiftName, total]) => ({ shiftName, total }));
      const categoryTotal = shiftsInCat.reduce((sum, s) => sum + s.total, 0);
      return {
        category: cat.name,
        shifts: shiftsInCat,
        total: categoryTotal
      };
    });

    // Use the categoryData directly (it's already in the correct format)
    const outTable = categoryData;

    // Calculate category totals with unit conversion (matching frontend logic)
    const categoryTotals: Record<string, number> = {};
    let totalWeightKg = 0;

    // Custom unit support
    let customWeightRatio: number | null = null;
    let unitLabel: string = 'kg';
    if (unit && unit !== 'kg' && unit !== 'lb' && unit !== 'Kilograms (kg)' && unit !== 'Pounds (lb)') {
      const weighingCat = await prisma.weighingCategory.findFirst({
        where: { organizationId, category: unit },
        select: { kilogram_kg_: true }
      });
      if (weighingCat && weighingCat.kilogram_kg_ && weighingCat.kilogram_kg_ > 0) {
        customWeightRatio = weighingCat.kilogram_kg_;
        unitLabel = unit as string;
      }
    } else if (unit === 'lb' || unit === 'Pounds (lb)') {
      unitLabel = 'lb';
    }

    // Convert weight function (matching frontend convertWeightForCategory)
    const convertWeightForCategory = (rawWeight: number): number => {
      if (unit === 'lb' || unit === 'Pounds (lb)') {
        return rawWeight * 2.20462; // kg to lb
      } else if (customWeightRatio !== null) {
        return rawWeight / customWeightRatio; // kg to custom unit
      }
      return rawWeight; // kg (default)
    };

    // Calculate totals (matching frontend logic)
    outTable.forEach((cat: any) => {
      totalWeightKg += cat.total; // Keep raw values in kg
      categoryTotals[cat.category] = convertWeightForCategory(cat.total); // Converted values for display
    });

    const totalDistributed = Object.values(categoryTotals).reduce((sum, val) => sum + val, 0);
    const equivalentValue = totalWeightKg * 10; // $10 per kg equivalent (matching frontend)

    // Generate Excel file
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Dashboard Summary');

    // Add headers
    worksheet.addRow(['Category', `Total Weight (${unitLabel})`]);

    // Add category data (exactly as shown in frontend Summary section)
    Object.entries(categoryTotals).forEach(([category, total]) => {
      worksheet.addRow([category, Math.round(total * 100) / 100]);
    });

    // Add total distributed row (matching frontend display)
    worksheet.addRow(['TOTAL DISTRIBUTED', Math.round(totalDistributed * 100) / 100]);

    // Add equivalent value row (matching frontend display)
    worksheet.addRow(['EQUIVALENT VALUE ($)', equivalentValue.toLocaleString()]);

    // Style the worksheet (no colors, only bold text)
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };

    const totalRow = worksheet.getRow(worksheet.rowCount - 1);
    totalRow.font = { bold: true };

    const valueRow = worksheet.getRow(worksheet.rowCount);
    valueRow.font = { bold: true };

    // Auto-fit columns
    worksheet.columns.forEach((column: any) => {
      column.width = 20;
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="dashboard-summary-${year}-${month}.xlsx"`);
    
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error exporting dashboard summary:', err);
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
        ShiftSignup: true
      }
    });

    // Get volunteer stats
    const volunteerHours = await prisma.shiftSignup.findMany({
      where: {
        Shift: {
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
      totalWeight: shifts.reduce((sum: number, shift: any) => 
        sum + shift.ShiftSignup.reduce((s: number, signup: any) => s + (signup.mealsServed || 0), 0), 0),
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

// --- User Management Endpoints ---

// Get all users
app.get('/api/users', authenticateToken, async (req, res) => {
  const reqAny = req as any;
  try {
    const organizationId = reqAny.user.organizationId;
    const users = await prisma.user.findMany({
      where: { organizationId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        password: true,
        organizationId: true,
        phone: true,
        status: true,
        createdAt: true,
        approvedAt: true,
        deniedAt: true,
        approvedBy: true,
        deniedBy: true,
        denialReason: true
      }
    });
    
    // Get approver/denier names separately since relationships don't exist in schema
    const userIds = [...new Set([...users.map(u => u.approvedBy), ...users.map(u => u.deniedBy)].filter(Boolean))] as number[];
    const approverUsers = userIds.length > 0 ? await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true }
    }) : [];
    
    const approverMap = approverUsers.reduce((map, user) => {
      map[user.id] = `${user.firstName} ${user.lastName}`;
      return map;
    }, {} as Record<number, string>);
    
    // Format the response to include approver/denier names
    const formattedUsers = users.map(user => ({
      ...user,
      approvedByName: user.approvedBy ? approverMap[user.approvedBy] : null,
      deniedByName: user.deniedBy ? approverMap[user.deniedBy] : null
    }));
    
    res.json(formattedUsers);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get user by id
app.get('/api/users/:id', authenticateToken, async (req, res) => {
  const reqAny = req as any;
  try {
    const organizationId = reqAny.user.organizationId;
    const user = await prisma.user.findFirst({
      where: { id: Number(req.params.id), organizationId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        phone: true,
        Organization: {
          select: {
            name: true
          }
        }
      }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      id: user.id,
      name: user.firstName + ' ' + user.lastName,
      email: user.email,
      role: user.role,
      phone: user.phone,
      organizationName: user.Organization?.name || 'Unknown Organization'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Edit user
app.put('/api/users/:id', authenticateToken, async (req, res) => {
  const reqAny = req as any;
  try {
    const organizationId = reqAny.user.organizationId;
    let { firstName, lastName, name, email, phone, role, password } = req.body;

    // If firstName/lastName not provided, try to split from name
    if ((!firstName || !lastName) && name) {
      const [f, ...lArr] = name.split(' ');
      firstName = f;
      lastName = lArr.join(' ');
    }

    // Accept lastName as empty string or null
    if (lastName === undefined || lastName === null) {
      lastName = '';
    }

    // Validate required fields
    if (!firstName || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Prepare update data
    const updateData: any = {
      firstName,
      lastName,
      email,
      phone,
      role,
      updatedAt: new Date()
    };

    // If password is provided, hash it
    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const user = await prisma.user.update({
      where: { id: Number(req.params.id), organizationId },
      data: updateData
    });

    res.json({
      id: user.id,
      name: user.firstName + ' ' + user.lastName,
      email: user.email,
      phone: user.phone,
      role: user.role
    });
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Update user password endpoint
app.put('/api/users/:id/password', authenticateToken, async (req, res) => {
  const reqAny = req as any;
  try {
    const organizationId = reqAny.user.organizationId;
    const { currentPassword, newPassword } = req.body;
    const userId = Number(req.params.id);

    // Validate required fields
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    // Get the user
    const user = await prisma.user.findFirst({
      where: { id: userId, organizationId }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    let validCurrentPassword = false;
    
    // Handle both hashed and plain text passwords for backward compatibility
    if (user.password.startsWith('$2b$') || user.password.startsWith('$2a$')) {
      validCurrentPassword = await bcrypt.compare(currentPassword, user.password);
    } else {
      validCurrentPassword = currentPassword === user.password;
    }

    if (!validCurrentPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash the new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // Update the password
    await prisma.user.update({
      where: { id: userId },
      data: { 
        password: hashedNewPassword,
        updatedAt: new Date()
      }
    });

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('Error updating password:', err);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

// Delete user
app.delete('/api/users/:id', authenticateToken, async (req, res) => {
  const reqAny = req as any;
  try {
    const organizationId = reqAny.user.organizationId;
    const userId = Number(req.params.id);
    
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.organizationId !== organizationId) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if this user has approved/denied other users
    const hasApprovedUsers = await prisma.user.count({
      where: { 
        OR: [
          { approvedBy: userId },
          { deniedBy: userId }
        ]
      }
    });

    if (hasApprovedUsers > 0) {
      // Clear the approvedBy/deniedBy references instead of preventing deletion
      await prisma.user.updateMany({
        where: { approvedBy: userId },
        data: { approvedBy: null }
      });
      
      await prisma.user.updateMany({
        where: { deniedBy: userId },
        data: { deniedBy: null }
      });
    }

    // Delete related records in the correct order (child tables first)
    console.log(`Deleting user ${userId} and all related records...`);
    
    // 1. Delete donations related to this user's shift signups
    const userShiftSignups = await prisma.shiftSignup.findMany({
      where: { userId },
      select: { id: true }
    });
    
    if (userShiftSignups.length > 0) {
      const shiftSignupIds = userShiftSignups.map(s => s.id);
      await prisma.donation.deleteMany({
        where: { shiftSignupId: { in: shiftSignupIds } }
      });
      console.log(`Deleted donations for ${shiftSignupIds.length} shift signups`);
    }

    // 2. Delete user's shift signups
    const deletedShiftSignups = await prisma.shiftSignup.deleteMany({ 
      where: { userId } 
    });
    console.log(`Deleted ${deletedShiftSignups.count} shift signups`);

    // 3. Delete user's module permissions
    const deletedPermissions = await prisma.userModulePermission.deleteMany({ 
      where: { userId } 
    });
    console.log(`Deleted ${deletedPermissions.count} user permissions`);

    // 4. Delete user's agreements
    const deletedAgreements = await prisma.userAgreement.deleteMany({ 
      where: { userId } 
    });
    console.log(`Deleted ${deletedAgreements.count} user agreements`);

    // 5. Finally delete the user
    await prisma.user.delete({ where: { id: userId } });
    console.log(`Successfully deleted user ${userId}`);

    res.json({ 
      success: true,
      message: 'User and all related data deleted successfully',
      deletedRecords: {
        shiftSignups: deletedShiftSignups.count,
        permissions: deletedPermissions.count,
        agreements: deletedAgreements.count
      }
    });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ 
      error: 'Failed to delete user',
      details: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

// Upload user agreement document
app.post('/api/users/upload-agreement', authenticateToken, upload.single('agreement'), async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const userId = req.user.id;
    
    console.log('Upload agreement request received:', {
      organizationId,
      userId,
      hasFile: !!req.file
    });
    
    if (!req.file) {
      console.log('No file uploaded in request');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('File details:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    // Upload to R2 useragreements folder
    console.log('Attempting to upload to useragreements folder...');
    const result = await uploadToR2(req.file, organizationId, 'useragreements');
    
    console.log('Upload successful:', result);
    
    res.json({
      success: true,
      fileUrl: result.fileUrl,
      fileName: result.fileName,
      fileSize: result.fileSize
    });
  } catch (error) {
    console.error('Error uploading user agreement:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      code: (error as any)?.code,
      statusCode: (error as any)?.statusCode
    });
    res.status(500).json({ 
      error: 'Failed to upload agreement document',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Add user
app.post('/api/users', authenticateToken, async (req, res) => {
  const reqAny = req as any;
  try {
    const organizationId = reqAny.user.organizationId;
    const { firstName, lastName, email, phone, password, role, agreementFileUrl, agreementFileName, agreementFileSize } = req.body;

    // Log the incoming request data
    console.log('Adding user with data:', {
      firstName,
      lastName,
      email,
      phone,
      role,
      organizationId,
      hasAgreement: !!agreementFileUrl
    });

    // Validate required fields
    if (!firstName || !lastName || !email || !phone || !password || !role) {
      console.log('Missing required fields:', {
        firstName: !firstName,
        lastName: !lastName,
        email: !email,
        phone: !phone,
        password: !password,
        role: !role
      });
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: {
          firstName: !firstName,
          lastName: !lastName,
          email: !email,
          phone: !phone,
          password: !password,
          role: !role
        }
      });
    }

    // Validate agreement upload
    if (!agreementFileUrl) {
      return res.status(400).json({ 
        error: 'Terms and conditions agreement document is required'
      });
    }

    // Check if user with email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      console.log('User with email already exists:', email);
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Check if user with phone already exists
    const existingPhone = await prisma.user.findUnique({
      where: { phone }
    });

    if (existingPhone) {
      console.log('User with phone already exists:', phone);
      return res.status(400).json({ error: 'User with this phone number already exists' });
    }

    // Hash the password before storing
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user with APPROVED status (since admin is creating them)
    const user = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email,
        phone,
        password: hashedPassword,
        role,
        organizationId,
        status: 'APPROVED', // Set status to APPROVED directly
        approvedBy: reqAny.user.id, // Track who approved them
        approvedAt: new Date(), // Set approval timestamp
        updatedAt: new Date()
      }
    });

    console.log('User created successfully:', user.id);

    // Create user agreement record if agreement was uploaded
    if (agreementFileUrl) {
      try {
        // Get or create default terms and conditions for the organization
        let termsAndConditions = await prisma.termsAndConditions.findFirst({
          where: { 
            organizationId,
            isActive: true 
          }
        });

        // If no active terms exist, create a default one
        if (!termsAndConditions) {
          termsAndConditions = await prisma.termsAndConditions.create({
            data: {
              organizationId,
              version: '1.0',
              title: 'Default Terms and Conditions',
              fileUrl: '',
              fileName: 'Default Terms',
              fileSize: 0,
              isActive: true,
              updatedAt: new Date(),
              createdBy: reqAny.user.id
            }
          });
        }

        // Create user agreement record
        await prisma.userAgreement.create({
          data: {
            userId: user.id,
            organizationId,
            termsAndConditionsId: termsAndConditions.id,
            signature: `${firstName} ${lastName}`, // Use full name as signature
            signedDocumentUrl: agreementFileUrl,
            acceptedAt: new Date(),
            ipAddress: req.ip || req.connection.remoteAddress || 'Unknown',
            userAgent: req.get('User-Agent') || 'Unknown'
          }
        });

        console.log('User agreement created successfully for user:', user.id);
      } catch (agreementError) {
        console.error('Error creating user agreement:', agreementError);
        // Don't fail the user creation, but log the error
      }
    }

    // Fetch organization name
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });

    // Send welcome email with password reset link
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

      // Generate password reset token for the new user
      const resetToken = jwt.sign({ email, type: 'password_reset' }, JWT_SECRET, { expiresIn: '7d' }); // 7 days for new users
      const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/forgot-password?token=${resetToken}`;

      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Welcome to Hungy - Account Created!',
        text: `Welcome to Hungy!

You have been added to Hungy under organization: ${org?.name || 'Unknown'}.

Your login details:
Email: ${email}
Password: ${password}
Role: ${role}

For security, we recommend changing your password after first login.
You can reset your password using this link: ${resetUrl}

Please log in to get started!`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #ff9800; margin-bottom: 20px;">Welcome to Hungy!</h2>
            
            <p>You have been added to Hungy under organization: <strong>${org?.name || 'Unknown'}</strong>.</p>
            
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #333;">Your Login Details:</h3>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Password:</strong> ${password}</p>
              <p><strong>Role:</strong> ${role}</p>
            </div>
            
            <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2196f3;">
              <h4 style="margin-top: 0; color: #1976d2;">Security Recommendation</h4>
              <p>For your security, we recommend changing your password after first login.</p>
              <p>You can reset your password using the link below:</p>
              <a href="${resetUrl}" style="display: inline-block; background: #2196f3; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 10px;">Reset Password</a>
            </div>
            
            <p style="margin-top: 30px;">Please log in to get started!</p>
            
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
            <p style="color: #666; font-size: 12px;">This is an automated message from Hungy.</p>
          </div>
        `
      };
      await transporter.sendMail(mailOptions);
      console.log('Welcome email sent successfully to:', email);
    } catch (emailErr) {
      console.error('Failed to send welcome email:', emailErr);
      // Don't return error here as user was created successfully
    }

    res.json({
      id: user.id,
      name: user.firstName + ' ' + user.lastName,
      email: user.email,
      role: user.role
    });
  } catch (err) {
    console.error('Error adding user:', err);
    res.status(500).json({ 
      error: 'Failed to add user',
      details: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

// Get all organizations (for dropdown)
app.get('/api/organizations', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const organizations = await prisma.organization.findMany({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        address: true,
        email: true,
        incoming_dollar_value: true
      }
    });
    res.json(organizations);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

// --- Advanced User Management Endpoints ---

// Get all users with status and approval details
app.get('/api/users/management', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const users = await prisma.user.findMany({
      where: { organizationId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
        approvedAt: true,
        approvedBy: true,
        deniedAt: true,
        deniedBy: true,
        denialReason: true,
        updatedAt: true
      },
      orderBy: [
        { status: 'asc' }, // PENDING first
        { createdAt: 'desc' } // newest first
      ]
    });

    // Get approver names
    const approverIds = [...new Set([
      ...users.map(u => u.approvedBy).filter((id): id is number => id !== null),
      ...users.map(u => u.deniedBy).filter((id): id is number => id !== null)
    ])];

    const approvers = await prisma.user.findMany({
      where: { id: { in: approverIds } },
      select: { id: true, firstName: true, lastName: true }
    });

    const approverMap = approvers.reduce((map, user) => {
      map[user.id] = `${user.firstName} ${user.lastName}`;
      return map;
    }, {} as Record<number, string>);

    const formattedUsers = users.map(user => ({
      ...user,
      name: `${user.firstName} ${user.lastName}`,
      approvedByName: user.approvedBy ? approverMap[user.approvedBy] : null,
      deniedByName: user.deniedBy ? approverMap[user.deniedBy] : null
    }));

    res.json(formattedUsers);
  } catch (err) {
    console.error('Error fetching users for management:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Approve user
app.put('/api/users/:id/approve', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const userId = parseInt(req.params.id);
    const approverId = req.user.id;

    // Check if user exists and belongs to organization
    const user = await prisma.user.findFirst({
      where: { id: userId, organizationId }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.status !== 'PENDING') {
      return res.status(400).json({ error: 'User is not in pending status' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        status: 'APPROVED',
        approvedBy: approverId,
        approvedAt: new Date(),
        updatedAt: new Date()
      }
    });

    // Create default permissions for approved user
    const modules = await prisma.module.findMany();
    const defaultPermissions = modules.map(module => ({
      userId,
      organizationId,
      moduleId: module.id,
      canAccess: module.name === 'Dashboard' || module.name === 'Profile' // Default access to Dashboard and Profile
    }));

    await prisma.userModulePermission.createMany({
      data: defaultPermissions,
      skipDuplicates: true
    });

    res.json({
      ...updatedUser,
      name: `${updatedUser.firstName} ${updatedUser.lastName}`
    });
  } catch (err) {
    console.error('Error approving user:', err);
    res.status(500).json({ error: 'Failed to approve user' });
  }
});

// Deny user
app.put('/api/users/:id/deny', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const userId = parseInt(req.params.id);
    const denierId = req.user.id;
    const { reason } = req.body;

    // Check if user exists and belongs to organization
    const user = await prisma.user.findFirst({
      where: { id: userId, organizationId }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.status !== 'PENDING') {
      return res.status(400).json({ error: 'User is not in pending status' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        status: 'DENIED',
        deniedBy: denierId,
        deniedAt: new Date(),
        denialReason: reason || 'No reason provided',
        updatedAt: new Date()
      }
    });

    res.json({
      ...updatedUser,
      name: `${updatedUser.firstName} ${updatedUser.lastName}`
    });
  } catch (err) {
    console.error('Error denying user:', err);
    res.status(500).json({ error: 'Failed to deny user' });
  }
});

// Reset user status to pending
app.put('/api/users/:id/reset', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const userId = parseInt(req.params.id);

    // Check if user exists and belongs to organization
    const user = await prisma.user.findFirst({
      where: { id: userId, organizationId }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        status: 'PENDING',
        approvedBy: null,
        approvedAt: null,
        deniedBy: null,
        deniedAt: null,
        denialReason: null,
        updatedAt: new Date()
      }
    });

    res.json({
      ...updatedUser,
      name: `${updatedUser.firstName} ${updatedUser.lastName}`
    });
  } catch (err) {
    console.error('Error resetting user status:', err);
    res.status(500).json({ error: 'Failed to reset user status' });
  }
});

// --- User Permission Management Endpoints ---

// Get all modules
app.get('/api/modules', authenticateToken, async (req: any, res) => {
  try {
    const modules = await prisma.module.findMany({
      orderBy: { name: 'asc' }
    });
    res.json(modules);
  } catch (err) {
    console.error('Error fetching modules:', err);
    res.status(500).json({ error: 'Failed to fetch modules' });
  }
});


// Get user agreement document
app.get('/api/users/:id/agreement', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const userId = parseInt(req.params.id);

    console.log('Fetching user agreement for userId:', userId, 'organizationId:', organizationId);

    // Check if user exists and belongs to organization
    const user = await prisma.user.findFirst({
      where: { id: userId, organizationId }
    });

    if (!user) {
      console.log('User not found:', userId);
      return res.status(404).json({ error: 'User not found' });
    }

    // Get user agreement
    const userAgreement = await prisma.userAgreement.findFirst({
      where: { userId, organizationId },
      select: {
        id: true,
        signature: true,
        signedDocumentUrl: true,
        acceptedAt: true,
        TermsAndConditions: {
          select: {
            title: true,
            version: true
          }
        }
      }
    });

    console.log('Found user agreement:', {
      exists: !!userAgreement,
      hasSignedDocumentUrl: !!userAgreement?.signedDocumentUrl,
      signedDocumentUrl: userAgreement?.signedDocumentUrl
    });

    if (!userAgreement || !userAgreement.signedDocumentUrl) {
      console.log('No agreement document found for user:', userId);
      return res.status(404).json({ error: 'No agreement document found for this user' });
    }

    // Check and potentially fix the URL format
    let documentUrl = userAgreement.signedDocumentUrl;
    
    // Get the correct public domain for user agreements
    const correctPublicDomain = process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN_USERAGREEMENTS || 'https://pub-f419c4a70b0e43678d4b60ea2eac8295.r2.dev';
    
    console.log('Original document URL:', documentUrl);
    console.log('Correct public domain:', correctPublicDomain);
    
    // Extract the file path from the URL if it's a full URL
    if (documentUrl && documentUrl.includes('http')) {
      try {
        const url = new URL(documentUrl);
        const filePath = url.pathname.substring(1); // Remove leading slash
        
        console.log('Extracted file path:', filePath);
        
        // Check if it starts with useragreements path
        if (filePath.startsWith('useragreements/')) {
          // Reconstruct with correct domain
          documentUrl = `${correctPublicDomain}/${filePath}`;
          console.log('Corrected document URL from', userAgreement.signedDocumentUrl, 'to', documentUrl);
        } else if (filePath.includes('useragreements/')) {
          // Handle cases where the path might have extra parts
          const agreementIndex = filePath.indexOf('useragreements/');
          const cleanPath = filePath.substring(agreementIndex);
          documentUrl = `${correctPublicDomain}/${cleanPath}`;
          console.log('Cleaned document URL from', userAgreement.signedDocumentUrl, 'to', documentUrl);
        }
      } catch (urlError) {
        console.error('Error parsing document URL:', urlError);
        // If URL parsing fails, try to construct a fallback URL
        if (documentUrl.includes('useragreements/')) {
          const pathStart = documentUrl.indexOf('useragreements/');
          const cleanPath = documentUrl.substring(pathStart);
          documentUrl = `${correctPublicDomain}/${cleanPath}`;
          console.log('Fallback document URL:', documentUrl);
        }
      }

    } else if (documentUrl && documentUrl.startsWith('useragreements/')) {
      // Handle relative paths
      documentUrl = `${correctPublicDomain}/${documentUrl}`;
      console.log('Added domain to relative path:', documentUrl);
    }

    console.log('Returning document URL:', documentUrl);
    console.log('Returning document URL:', documentUrl);

    res.json({
      documentUrl: documentUrl,
      signature: userAgreement.signature,
      acceptedAt: userAgreement.acceptedAt,
      termsTitle: userAgreement.TermsAndConditions?.title,
      termsVersion: userAgreement.TermsAndConditions?.version
    });
  } catch (err) {
    console.error('Error fetching user agreement:', err);
    res.status(500).json({ error: 'Failed to fetch user agreement' });
  }
});

// Get user permissions
app.get('/api/users/:id/permissions', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const userId = parseInt(req.params.id);

    // Check if user exists and belongs to organization
    const user = await prisma.user.findFirst({
      where: { id: userId, organizationId }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get all modules and user permissions
    const modules = await prisma.module.findMany({
      orderBy: { name: 'asc' }
    });

    const userPermissions = await prisma.userModulePermission.findMany({
      where: { userId, organizationId },
      include: { Module: true }
    });

    const permissionMap = userPermissions.reduce((map, permission) => {
      map[permission.moduleId] = permission.canAccess;
      return map;
    }, {} as Record<number, boolean>);

    const result = modules.map(module => ({
      moduleId: module.id,
      moduleName: module.name,
      moduleDescription: module.description,
      canAccess: permissionMap[module.id] || false
    }));

    res.json({
      userId,
      userName: `${user.firstName} ${user.lastName}`,
      userEmail: user.email,
      userRole: user.role,
      permissions: result
    });
  } catch (err) {
    console.error('Error fetching user permissions:', err);
    res.status(500).json({ error: 'Failed to fetch user permissions' });
  }
});

// Update user permissions
app.put('/api/users/:id/permissions', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const userId = parseInt(req.params.id);
    const { permissions } = req.body; // Array of { moduleId, canAccess }

    // Check if user exists and belongs to organization
    const user = await prisma.user.findFirst({
      where: { id: userId, organizationId }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Validate permissions format
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: 'Permissions must be an array' });
    }

    // Delete existing permissions for this user and organization
    await prisma.userModulePermission.deleteMany({
      where: { userId, organizationId }
    });

    // Create new permissions
    const permissionData = permissions.map(p => ({
      userId,
      organizationId,
      moduleId: p.moduleId,
      canAccess: p.canAccess
    }));

    await prisma.userModulePermission.createMany({
      data: permissionData
    });

    // Return updated permissions
    const updatedPermissions = await prisma.userModulePermission.findMany({
      where: { userId, organizationId },
      include: { Module: true }
    });

    const result = updatedPermissions.map(permission => ({
      moduleId: permission.moduleId,
      moduleName: permission.Module.name,
      moduleDescription: permission.Module.description,
      canAccess: permission.canAccess
    }));

    res.json({
      userId,
      userName: `${user.firstName} ${user.lastName}`,
      permissions: result
    });
  } catch (err) {
    console.error('Error updating user permissions:', err);
    res.status(500).json({ error: 'Failed to update user permissions' });
  }
});

// Get all users for permission management
app.get('/api/users/permissions/overview', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    
    const users = await prisma.user.findMany({
      where: { 
        organizationId,
        status: 'APPROVED' // Only show approved users
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        status: true,
        UserModulePermission: {
          include: { Module: true }
        }
      },
      orderBy: [
        { role: 'asc' },
        { firstName: 'asc' }
      ]
    });

    const result = users.map(user => {
      const permissionCount = user.UserModulePermission.filter(p => p.canAccess).length;
      const totalModules = user.UserModulePermission.length;
      
      return {
        id: user.id,
        name: `${user.firstName} ${user.lastName}`,
        email: user.email,
        role: user.role,
        status: user.status,
        permissionCount,
        totalModules,
        hasPermissions: permissionCount > 0
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Error fetching users permission overview:', err);
    res.status(500).json({ error: 'Failed to fetch users permission overview' });
  }
});

// --- ShiftCategory CRUD Operations ---

// Create new shift category
app.post('/api/shift-categories', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { name, icon } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Check if category with same name exists for this organization
    const existing = await prisma.shiftCategory.findFirst({
      where: {
        name,
        organizationId
      }
    });

    if (existing) {
      return res.status(400).json({ error: 'Category with this name already exists' });
    }

    const category = await prisma.shiftCategory.create({
      data: {
        name,
        icon,
        organizationId
      }
    });

    res.json(category);
  } catch (err) {
    console.error('Error creating shift category:', err);
    res.status(500).json({ error: 'Failed to create shift category' });
  }
});

// Update shift category
app.put('/api/shift-categories/:id', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { name, icon } = req.body;
    const id = parseInt(req.params.id);

    // Validate required fields
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Check if category exists and belongs to organization
    const existing = await prisma.shiftCategory.findFirst({
      where: {
        id,
        organizationId
      }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Check if new name conflicts with another category
    const nameConflict = await prisma.shiftCategory.findFirst({
      where: {
        name,
        organizationId,
        id: { not: id }
      }
    });

    if (nameConflict) {
      return res.status(400).json({ error: 'Category with this name already exists' });
    }

    const category = await prisma.shiftCategory.update({
      where: { id },
      data: { name, icon }
    });

    res.json(category);
  } catch (err) {
    console.error('Error updating shift category:', err);
    res.status(500).json({ error: 'Failed to update shift category' });
  }
});

// Delete shift category
app.delete('/api/shift-categories/:id', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const id = parseInt(req.params.id);

    // Check if category exists and belongs to organization
    const existing = await prisma.shiftCategory.findFirst({
      where: {
        id,
        organizationId
      }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Check if category is in use
    const shifts = await prisma.shift.findFirst({
      where: { shiftCategoryId: id }
    });

    const recurringShifts = await prisma.recurringShift.findFirst({
      where: { shiftCategoryId: id }
    });

    if (shifts || recurringShifts) {
      return res.status(400).json({ 
        error: 'Cannot delete category that is in use by shifts or recurring shifts' 
      });
    }

    await prisma.shiftCategory.delete({
      where: { id }
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting shift category:', err);
    res.status(500).json({ error: 'Failed to delete shift category' });
  }
});

// --- RecurringShift CRUD Operations ---

// Get all recurring shifts for the organization
app.get('/api/recurring-shifts', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const shifts = await prisma.recurringShift.findMany({
      where: { organizationId },
      include: {
        ShiftCategory: true
      },
      orderBy: [
        { dayOfWeek: 'asc' },
        { startTime: 'asc' }
      ]
    });
    
    res.json(shifts);
  } catch (err) {
    console.error('Error fetching recurring shifts:', err);
    res.status(500).json({ error: 'Failed to fetch recurring shifts' });
  }
});

// Create new recurring shift
app.post('/api/recurring-shifts', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { name, dayOfWeek, startTime, endTime, shiftCategoryId, location, slots } = req.body;

    // Validate required fields
    if (!name || dayOfWeek === undefined || !startTime || !endTime || !shiftCategoryId || !location || !slots) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: {
          name: !name,
          dayOfWeek: dayOfWeek === undefined,
          startTime: !startTime,
          endTime: !endTime,
          shiftCategoryId: !shiftCategoryId,
          location: !location,
          slots: !slots
        }
      });
    }

    // Validate day of week
    if (dayOfWeek < 0 || dayOfWeek > 6) {
      return res.status(400).json({ error: 'Day of week must be between 0 and 6' });
    }

    // Validate slots
    if (slots < 1) {
      return res.status(400).json({ error: 'Slots must be at least 1' });
    }

    // Check if category exists and belongs to organization
    const category = await prisma.shiftCategory.findFirst({
      where: {
        id: shiftCategoryId,
        organizationId
      }
    });

    if (!category) {
      return res.status(404).json({ error: 'Shift category not found' });
    }

    // Create recurring shift with Halifax timezone handling
    const shift = await prisma.recurringShift.create({
      data: {
        name,
        dayOfWeek,
        startTime: new Date(startTime), // This will be stored as UTC but represents Halifax time
        endTime: new Date(endTime),     // This will be stored as UTC but represents Halifax time
        shiftCategoryId,
        location,
        slots,
        organizationId
      },
      include: {
        ShiftCategory: true
      }
    });

    res.json(shift);
  } catch (err) {
    console.error('Error creating recurring shift:', err);
    res.status(500).json({ error: 'Failed to create recurring shift' });
  }
});

// Update recurring shift
app.put('/api/recurring-shifts/:id', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const id = parseInt(req.params.id);
    const { name, dayOfWeek, startTime, endTime, shiftCategoryId, location, slots } = req.body;

    // Validate required fields
    if (!name || dayOfWeek === undefined || !startTime || !endTime || !shiftCategoryId || !location || !slots) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: {
          name: !name,
          dayOfWeek: dayOfWeek === undefined,
          startTime: !startTime,
          endTime: !endTime,
          shiftCategoryId: !shiftCategoryId,
          location: !location,
          slots: !slots
        }
      });
    }

    // Validate day of week
    if (dayOfWeek < 0 || dayOfWeek > 6) {
      return res.status(400).json({ error: 'Day of week must be between 0 and 6' });
    }

    // Validate slots
    if (slots < 1) {
      return res.status(400).json({ error: 'Slots must be at least 1' });
    }

    // Check if shift exists and belongs to organization
    const existing = await prisma.recurringShift.findFirst({
      where: {
        id,
        organizationId
      }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Recurring shift not found' });
    }

    // Check if category exists and belongs to organization
    const category = await prisma.shiftCategory.findFirst({
      where: {
        id: shiftCategoryId,
        organizationId
      }
    });

    if (!category) {
      return res.status(404).json({ error: 'Shift category not found' });
    }

    // Update recurring shift
    const shift = await prisma.recurringShift.update({
      where: { id },
      data: {
        name,
        dayOfWeek,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        shiftCategoryId,
        location,
        slots
      },
      include: {
        ShiftCategory: true
      }
    });

    res.json(shift);
  } catch (err) {
    console.error('Error updating recurring shift:', err);
    res.status(500).json({ error: 'Failed to update recurring shift' });
  }
});

// Delete recurring shift
app.delete('/api/recurring-shifts/:id', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const id = parseInt(req.params.id);

    // Check if shift exists and belongs to organization
    const existing = await prisma.recurringShift.findFirst({
      where: {
        id,
        organizationId
      }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Recurring shift not found' });
    }

    await prisma.recurringShift.delete({
      where: { id }
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting recurring shift:', err);
    res.status(500).json({ error: 'Failed to delete recurring shift' });
  }
});

// --- Shift CRUD Operations ---

// Get all shifts for the organization
app.get('/api/shifts', authenticateToken, async (req, res) => {
  const reqAny = req as any;
  try {
    const organizationId = reqAny.user.organizationId;
    const shifts = await prisma.shift.findMany({
      where: { organizationId },
      include: { 
        ShiftCategory: true,
        ShiftSignup: {
          include: {
            User: true
          }
        }
      },
      orderBy: { startTime: 'asc' }
    });
    
    res.json(shifts);
  } catch (err) {
    console.error('Error fetching shifts:', err);
    res.status(500).json({ error: 'Failed to fetch shifts' });
  }
});

// Get last updated time for shifts
app.get('/api/shifts/last-updated', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const lastSignup = await prisma.shiftSignup.findFirst({
      where: { 
        Shift: { organizationId } 
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true }
    });
    
    const lastUpdated = lastSignup?.createdAt?.getTime() || Date.now();
    
    res.json({ lastUpdated });
  } catch (err) {
    console.error('Error fetching last updated time:', err);
    res.status(500).json({ error: 'Failed to fetch last updated time' });
  }
});

// Get shift by id
app.get('/api/shifts/:id', authenticateToken, async (req, res) => {
  const reqAny = req as any;
  try {
    const organizationId = reqAny.user.organizationId;
    const id = parseInt(req.params.id);
    const shift = await prisma.shift.findFirst({
      where: { id, organizationId },
      include: { ShiftCategory: true }
    });
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    res.json(shift);
  } catch (err) {
    console.error('Error fetching shift:', err);
    res.status(500).json({ error: 'Failed to fetch shift' });
  }
});

// Create new shift
app.post('/api/shifts', authenticateToken, async (req, res) => {
  const reqAny = req as any;
  try {
    const organizationId = reqAny.user.organizationId;
    const { name, shiftCategoryId, startTime, endTime, location, slots } = req.body;
    if (!name || !shiftCategoryId || !startTime || !endTime || !location || !slots) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (slots < 1) {
      return res.status(400).json({ error: 'Slots must be at least 1' });
    }
    // Check if category exists and belongs to organization
    const category = await prisma.shiftCategory.findFirst({
      where: { id: shiftCategoryId, organizationId }
    });
    if (!category) {
      return res.status(404).json({ error: 'Shift category not found' });
    }
    const shift = await prisma.shift.create({
      data: {
        name,
        shiftCategoryId,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        location,
        slots,
        organizationId
      },
      include: { ShiftCategory: true }
    });
    res.json(shift);
  } catch (err) {
    console.error('Error creating shift:', err);
    res.status(500).json({ error: 'Failed to create shift' });
  }
});

// Update shift
app.put('/api/shifts/:id', authenticateToken, async (req, res) => {
  const reqAny = req as any;
  try {
    const organizationId = reqAny.user.organizationId;
    const id = parseInt(req.params.id);
    const { name, shiftCategoryId, startTime, endTime, location, slots } = req.body;
    if (!name || !shiftCategoryId || !startTime || !endTime || !location || !slots) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (slots < 1) {
      return res.status(400).json({ error: 'Slots must be at least 1' });
    }
    // Check if shift exists and belongs to organization
    const existing = await prisma.shift.findFirst({
      where: { id, organizationId }
    });
    if (!existing) {
      return res.status(404).json({ error: 'Shift not found' });
    }
    // Check if category exists and belongs to organization
    const category = await prisma.shiftCategory.findFirst({
      where: { id: shiftCategoryId, organizationId }
    });
    if (!category) {
      return res.status(404).json({ error: 'Shift category not found' });
    }
    const shift = await prisma.shift.update({
      where: { id },
      data: {
        name,
        shiftCategoryId,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        location,
        slots
      },
      include: { ShiftCategory: true }
    });
    res.json(shift);
  } catch (err) {
    console.error('Error updating shift:', err);
    res.status(500).json({ error: 'Failed to update shift' });
  }
});

// Delete shift
app.delete('/api/shifts/:id', authenticateToken, async (req, res) => {
  const reqAny = req as any;
  try {
    const organizationId = reqAny.user.organizationId;
    const id = parseInt(req.params.id);
    // Check if shift exists and belongs to organization
    const existing = await prisma.shift.findFirst({
      where: { id, organizationId }
    });
    if (!existing) {
      return res.status(404).json({ error: 'Shift not found' });
    }
    // Optionally: delete related shift signups
    await prisma.shiftSignup.deleteMany({ where: { shiftId: id } });
    await prisma.shift.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting shift:', err);
    res.status(500).json({ error: 'Failed to delete shift' });
  }
});

// Schedule a shift for users based on recurring shift
app.post('/api/schedule-shift', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { recurringShiftId, userIds } = req.body;
    if (!recurringShiftId || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'recurringShiftId and userIds[] are required' });
    }
    // Get the recurring shift
    const rec = await prisma.recurringShift.findFirst({
      where: { id: Number(recurringShiftId), organizationId },
      include: { ShiftCategory: true }
    });
    if (!rec) return res.status(404).json({ error: 'Recurring shift not found' });
    // Calculate next occurrence date
    const today = new Date();
    const dayDiff = (rec.dayOfWeek - today.getDay() + 7) % 7 || 7;
    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() + dayDiff);
    // Set start/end times for next occurrence
    const start = new Date(nextDate);
    start.setHours(new Date(rec.startTime).getHours(), new Date(rec.startTime).getMinutes(), 0, 0);
    const end = new Date(nextDate);
    end.setHours(new Date(rec.endTime).getHours(), new Date(rec.endTime).getMinutes(), 0, 0);
    // Check if a shift already exists for this recurring shift/date/time
    let shift = await prisma.shift.findFirst({
      where: {
        organizationId,
        shiftCategoryId: rec.shiftCategoryId,
        name: rec.name,
        startTime: start,
        endTime: end,
        location: rec.location
      }
    });
    if (!shift) {
      // Create the shift
      shift = await prisma.shift.create({
        data: {
          name: rec.name,
          shiftCategoryId: rec.shiftCategoryId,
          startTime: start,
          endTime: end,
          location: rec.location,
          slots: rec.slots,
          organizationId
        }
      });
    }
    // For each user, create a ShiftSignup if not already present
    let created = 0, skipped = 0;
    for (const userId of userIds) {
      const existing = await prisma.shiftSignup.findFirst({
        where: { userId: Number(userId), shiftId: shift.id }
      });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.shiftSignup.create({
        data: {
          userId: Number(userId),
          shiftId: shift.id
        }
      });
      created++;
    }
    res.json({ success: true, created, skipped, shiftId: shift.id });
  } catch (err) {
    console.error('Error scheduling shift:', err);
    res.status(500).json({ error: 'Failed to schedule shift' });
  }
});

// Create shift signup
app.post('/api/shiftsignups', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { userId, shiftId, checkIn, checkOut, mealsServed } = req.body;

    // Validate required fields
    if (!userId || !shiftId) {
      return res.status(400).json({ error: 'userId and shiftId are required' });
    }

    // Check if shift exists and belongs to organization
    const shift = await prisma.shift.findFirst({
      where: { id: Number(shiftId), organizationId }
    });
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    // Check if user exists and belongs to organization
    const user = await prisma.user.findFirst({
      where: { id: Number(userId), organizationId }
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if signup already exists
    const existing = await prisma.shiftSignup.findFirst({
      where: { userId: Number(userId), shiftId: Number(shiftId) }
    });
    if (existing) {
      return res.status(400).json({ error: 'User is already signed up for this shift' });
    }

    // Create the shift signup with Halifax timezone handling
    const signup = await prisma.shiftSignup.create({
      data: {
        userId: Number(userId),
        shiftId: Number(shiftId),
        checkIn: checkIn ? new Date(checkIn) : null, // Store as UTC but represents Halifax time
        checkOut: checkOut ? new Date(checkOut) : null, // Store as UTC but represents Halifax time
        mealsServed: mealsServed || 0
      },
      include: {
        User: true,
        Shift: true
      }
    });
    
    res.json(signup);
  } catch (err) {
    console.error('Error creating shift signup:', err);
    res.status(500).json({ error: 'Failed to create shift signup' });
  }
});

// --- Organization CRUD Operations ---

// Get all organizations
app.get('/api/organizations', authenticateToken, async (req, res) => {
  try {
    const organizations = await prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        address: true,
        email: true
      }
    });
    res.json(organizations);
  } catch (err) {
    console.error('Error fetching organizations:', err);
    res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

// Get organization by ID
app.get('/api/organizations/:id', authenticateToken, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.id);
    if (!organizationId) {
      return res.status(400).json({ error: 'Invalid organization ID' });
    }

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        address: true,
        email: true
      }
    });

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    res.json(organization);
  } catch (err) {
    console.error('Error fetching organization:', err);
    res.status(500).json({ error: 'Failed to fetch organization' });
  }
});

// Create new organization
app.post('/api/organizations', authenticateToken, async (req: any, res) => {
  try {
    const { name, address } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Validate address format
    if (address) {
      try {
        const addresses = JSON.parse(address);
        if (!Array.isArray(addresses)) {
          return res.status(400).json({ error: 'Address must be an array' });
        }
        if (addresses.length === 0) {
          return res.status(400).json({ error: 'At least one address is required' });
        }
        if (addresses.some((addr: string) => !addr || typeof addr !== 'string' || !addr.trim())) {
          return res.status(400).json({ error: 'Invalid address format' });
        }
      } catch (err) {
        return res.status(400).json({ error: 'Invalid address JSON format' });
      }
    }

    // Check if organization with same name exists
    const existing = await prisma.organization.findUnique({
      where: { name }
    });

    if (existing) {
      return res.status(400).json({ error: 'Organization with this name already exists' });
    }

    const organization = await prisma.organization.create({
      data: {
        name,
        address,
        email: req.body.email || '' // Add email field
      },
      select: {
        id: true,
        name: true,
        address: true,
        email: true
      }
    });

    res.json(organization);
  } catch (err) {
    console.error('Error creating organization:', err);
    res.status(500).json({ error: 'Failed to create organization' });
  }
});

// Update organization
app.put('/api/organizations/:id', authenticateToken, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.id);
    if (!organizationId) {
      return res.status(400).json({ error: 'Invalid organization ID' });
    }

    const { name, address, email, incoming_dollar_value } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Validate email format if provided
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate address format if provided
    if (address !== undefined && address !== null && address !== '') {
      try {
        const addresses = JSON.parse(address);
        if (!Array.isArray(addresses)) {
          return res.status(400).json({ error: 'Address must be an array' });
        }
        if (addresses.length === 0) {
          return res.status(400).json({ error: 'At least one address is required' });
        }
        if (addresses.some((addr: string) => !addr || typeof addr !== 'string' || !addr.trim())) {
          return res.status(400).json({ error: 'Invalid address format' });
        }
      } catch (err) {
        return res.status(400).json({ error: 'Invalid address JSON format' });
      }
    }

    // Check if organization exists
    const existing = await prisma.organization.findUnique({
      where: { id: organizationId }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Check if new name conflicts with another organization
    if (name !== existing.name) {
      const nameConflict = await prisma.organization.findUnique({
        where: { name }
      });

      if (nameConflict) {
        return res.status(400).json({ error: 'Organization with this name already exists' });
      }
    }

    // Prepare update data
    const updateData: any = {
      name,
      address: address || existing.address,
      email: email || existing.email
    };

    // Add incoming_dollar_value if provided
    if (incoming_dollar_value !== undefined) {
      updateData.incoming_dollar_value = parseFloat(incoming_dollar_value);
    }

    const updatedOrganization = await prisma.organization.update({
      where: { id: organizationId },
      data: updateData,
      select: {
        id: true,
        name: true,
        address: true,
        email: true,
        incoming_dollar_value: true
      }
    });

    res.json(updatedOrganization);
  } catch (err) {
    console.error('Error updating organization:', err);
    res.status(500).json({ error: 'Failed to update organization' });
  }
});

// Delete organization
app.delete('/api/organizations/:id', authenticateToken, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.id);
    if (!organizationId) {
      return res.status(400).json({ error: 'Invalid organization ID' });
    }

    // Check if organization exists
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId }
    });

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Delete related records first
    await prisma.$transaction([
      prisma.donation.deleteMany({ where: { organizationId } }),
      prisma.donationCategory.deleteMany({ where: { organizationId } }),
      prisma.donor.deleteMany({ where: { kitchenId: organizationId } }),
      prisma.recurringShift.deleteMany({ where: { organizationId } }),
      prisma.shift.deleteMany({ where: { organizationId } }),
      prisma.shiftCategory.deleteMany({ where: { organizationId } }),
      prisma.user.deleteMany({ where: { organizationId } })
    ]);

    // Delete the organization
    await prisma.organization.delete({
      where: { id: organizationId }
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting organization:', err);
    res.status(500).json({ error: 'Failed to delete organization' });
  }
});

// Get organization statistics
app.get('/api/organizations/:id/stats', authenticateToken, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.id);
    if (!organizationId) {
      return res.status(400).json({ error: 'Invalid organization ID' });
    }

    // Get counts for different entities
    const [totalUsers, totalShifts, totalDonations] = await Promise.all([
      prisma.user.count({ where: { organizationId } }),
      prisma.shift.count({ where: { organizationId } }),
      prisma.donation.count({ where: { organizationId } })
    ]);

    res.json({
      totalUsers,
      totalShifts,
      totalDonations
    });
  } catch (err) {
    console.error('Error fetching organization stats:', err);
    res.status(500).json({ error: 'Failed to fetch organization statistics' });
  }
});

// Update shift signup
app.put("/api/shiftsignups/:id", authenticateToken, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    try {
      // Update the shift signup with the new userId
      const updatedSignup = await prisma.shiftSignup.update({
        where: { id: Number(id) },
        data: {
          userId: Number(userId)
        }
      });
      res.json(updatedSignup);
    } catch (updateError: any) {
      console.error("Prisma update error:", updateError);
      if (updateError.code === 'P2025') {
        return res.status(404).json({ error: "Shift signup not found" });
      }
      throw updateError;
    }
  } catch (err) {
    console.error("Error updating shift signup:", err);
    res.status(500).json({ error: "Failed to update shift signup" });
  }
});

// Delete shift signup
app.delete('/api/shiftsignups/:id', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const id = parseInt(req.params.id);

    // Check if signup exists and belongs to organization
    const existing = await prisma.shiftSignup.findFirst({
      where: { 
        id,
        Shift: {
          organizationId
        }
      }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Shift signup not found' });
    }

    // Delete the shift signup
    await prisma.shiftSignup.delete({
      where: { id }
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting shift signup:', err);
    res.status(500).json({ error: 'Failed to delete shift signup' });
  }
});

// Get all donors for the authenticated organization
app.get('/api/donors', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const donors = await prisma.donor.findMany({
      where: { kitchenId: organizationId },
      select: { id: true, name: true }
    });
    res.json(donors);
  } catch (err) {
    console.error('Error fetching donors:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add GET endpoint to fetch shift signups by shiftId
app.get('/api/shiftsignups', authenticateToken, async (req, res) => {
  try {
    const { shiftId } = req.query;
    if (!shiftId) {
      return res.status(400).json({ error: 'shiftId is required' });
    }
    const signups = await prisma.shiftSignup.findMany({
      where: { shiftId: Number(shiftId) },
      include: { User: true }
    });
    res.json(signups);
  } catch (err) {
    console.error('Error fetching shift signups:', err);
    res.status(500).json({ error: 'Failed to fetch shift signups' });
  }
}); 

// --- New endpoint: Get scheduled and unscheduled users for a shift ---
app.get('/api/shift-employees', authenticateToken, async (req, res) => {
  try {
    const reqAny = req as any;
    const { shiftId } = req.query;
    const organizationId = reqAny.user.organizationId;
    if (!shiftId) return res.status(400).json({ error: 'shiftId is required' });
    // Get the shift
    const shift = await prisma.shift.findFirst({
      where: { id: Number(shiftId), organizationId },
      include: { ShiftSignup: true }
    });
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    // Get all users in the org
    const users = await prisma.user.findMany({
      where: { organizationId },
      select: { id: true, firstName: true, lastName: true }
    });
    // Get all signups for this shift
    const signups = await prisma.shiftSignup.findMany({
      where: { shiftId: Number(shiftId) },
      include: { User: true }
    });
    // Scheduled users
    const scheduled = signups.map(signup => ({
      id: signup.User.id,
      name: signup.User.firstName + ' ' + signup.User.lastName,
      signupId: signup.id
    }));
    // Unscheduled users
    const scheduledIds = new Set(scheduled.map(u => u.id));
    const unscheduled = users
      .filter(u => !scheduledIds.has(u.id))
      .map(u => ({ id: u.id, name: u.firstName + ' ' + u.lastName }));
    res.json({
      scheduled,
      unscheduled,
      slots: shift.slots,
      booked: scheduled.length
    });
  } catch (err) {
    console.error('Error in /api/shift-employees:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}); 

// Get inventory by donor and category for a specific month/year
app.get('/api/inventory/donor-category-table', authenticateToken, async (req: any, res) => {
  try {
    const { month, year, unit } = req.query;
    const organizationId = req.user.organizationId;
    // Convert month and year to numbers
    const monthNum = Number(month);
    const yearNum = Number(year);
    let startDate: Date, endDate: Date;
    if (!yearNum) {
      return res.status(400).json({ error: 'Year is required' });
    }
    if (!monthNum || monthNum === 0 || month === 'all') {
      startDate = new Date(yearNum, 0, 1);
      endDate = new Date(yearNum, 11, 31, 23, 59, 59, 999);
    } else {
      startDate = new Date(yearNum, monthNum - 1, 1);
      endDate = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);
    }
    // Fetch donors
    const donors = await prisma.donor.findMany({
      where: { kitchenId: organizationId },
      select: { id: true, name: true }
    });
    // Fetch categories
    const allCategories = await prisma.donationCategory.findMany({
      where: { organizationId },
      select: { id: true, name: true }
    });
    
    // Remove duplicate category names (keep first occurrence)
    const uniqueCategoryNames = new Set<string>();
    const categories = allCategories.filter(cat => {
      if (uniqueCategoryNames.has(cat.name)) {
        return false;
      }
      uniqueCategoryNames.add(cat.name);
      return true;
    });
    
    // Fetch all donation items for this org and date range
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
      select: { categoryId: true, weightKg: true, Donation: { select: { donorId: true } } }
    });
    // Build donor x category table
    const donorIdToName: Record<number, string> = {};
    donors.forEach(d => { donorIdToName[d.id] = d.name; });
    const catIdToName: Record<number, string> = {};
    categories.forEach(c => { catIdToName[c.id] = c.name; });
    // Initialize table: donorName -> categoryName -> 0
    const table: Record<string, Record<string, number>> = {};
    donors.forEach(donor => {
      table[donor.name] = {};
      categories.forEach(cat => {
        table[donor.name][cat.name] = 0;
      });
    });
    // Get weighing categories for custom unit conversion
    const weighingCategories = await prisma.weighingCategory.findMany({
      where: { organizationId },
      select: {
        id: true,
        category: true,
        kilogram_kg_: true,
        pound_lb_: true
      }
    });

    // Fill table with actual weights (store raw kg values)
    items.forEach(item => {
      const donorName = donorIdToName[Number(item.Donation.donorId)];
      const catName = catIdToName[Number(item.categoryId)];
      if (donorName && catName) {
        table[donorName][catName] += item.weightKg;
      }
    });

    // Helper function to convert weight based on selected unit
    const convertWeight = (weight: number) => {
      if (weight == null || isNaN(weight)) return 0;
      
      // Handle base units
      if (unit === 'Pounds (lb)') {
        return +(weight * 2.20462).toFixed(2);
      }
      if (unit === 'Kilograms (kg)') {
        return +weight.toFixed(2);
      }
      
      // Handle custom weighing categories
      const category = weighingCategories.find(c => c.category === unit);
      if (category && category.kilogram_kg_ > 0) {
        // Convert kg to custom unit (divide by kg per unit)
        return +(weight / category.kilogram_kg_).toFixed(2);
      }
      
      return +weight.toFixed(2);
    };

    // Convert table values to display units
    const convertedTable: Record<string, Record<string, number>> = {};
    donors.forEach(donor => {
      convertedTable[donor.name] = {};
      categories.forEach(cat => {
        convertedTable[donor.name][cat.name] = convertWeight(table[donor.name][cat.name] || 0);
      });
    });

    res.json({
      donors: donors.map(d => d.name),
      categories: categories.map(c => c.name),
      table: convertedTable
    });
  } catch (err) {
    console.error('Error fetching donor-category inventory table:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Forgot password endpoint - send OTP
app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Find user by email
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: 'This email is not yet registered. Please check your email address or contact support.' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store OTP in database with expiration (15 minutes)
    const otpExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now
    
    // Store OTP in memory for testing
    if (!global.otpStore) {
      global.otpStore = {};
    }
    global.otpStore[email] = {
      otp,
      expiry: otpExpiry,
      attempts: 0
    };

    // Check if email configuration is available
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.log('Email configuration not found. OTP for testing:', otp);
      res.json({ 
        message: 'Password reset code sent to your email',
        // For testing purposes, include OTP in response when email is not configured
        otp: process.env.NODE_ENV === 'development' ? otp : undefined
      });
      return;
    }

    // Send OTP via email
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Password Reset Code - Hungy',
        text: `Your password reset code is: ${otp}\n\nThis code will expire in 15 minutes.\n\nIf you didn't request this, please ignore this email.`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #ff9800;">Password Reset Request</h2>
            <p>You requested a password reset for your Hungy account.</p>
            <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
              <h3 style="margin: 0; color: #333; font-size: 24px; letter-spacing: 4px;">${otp}</h3>
            </div>
            <p><strong>This code will expire in 15 minutes.</strong></p>
            <p>If you didn't request this password reset, please ignore this email.</p>
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
            <p style="color: #666; font-size: 12px;">This is an automated message from Hungy.</p>
          </div>
        `
      };

      await transporter.sendMail(mailOptions);
      res.json({ message: 'Password reset code sent to your email' });
    } catch (emailErr) {
      console.error('Failed to send email:', emailErr);
      res.status(500).json({ error: 'Failed to send reset code. Please try again.' });
    }
  } catch (err) {
    console.error('Error in forgot password:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify OTP endpoint
app.post('/api/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    // Check if OTP exists and is valid
    if (!global.otpStore || !global.otpStore[email]) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    const otpData = global.otpStore[email];

    // Check if OTP is expired
    if (new Date() > otpData.expiry) {
      delete global.otpStore[email];
      return res.status(400).json({ error: 'OTP has expired' });
    }

    // Check if too many attempts
    if (otpData.attempts >= 3) {
      delete global.otpStore[email];
      return res.status(400).json({ error: 'Too many failed attempts. Please request a new code.' });
    }

    // Verify OTP
    if (otpData.otp !== otp) {
      otpData.attempts++;
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    // Generate reset token
    const resetToken = jwt.sign({ email, type: 'password_reset' }, JWT_SECRET, { expiresIn: '15m' });

    // Clear OTP after successful verification
    delete global.otpStore[email];

    res.json({ 
      message: 'OTP verified successfully',
      resetToken 
    });
  } catch (err) {
    console.error('Error verifying OTP:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reset password endpoint
app.post('/api/reset-password', async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({ error: 'Reset token and new password are required' });
    }

    // Validate password
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    // Verify reset token
    let decoded: any;
    try {
      decoded = jwt.verify(resetToken, JWT_SECRET);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    if (decoded.type !== 'password_reset') {
      return res.status(400).json({ error: 'Invalid token type' });
    }

    // Find user by email
    const user = await prisma.user.findUnique({ where: { email: decoded.email } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update the password
    await prisma.user.update({
      where: { email: decoded.email },
      data: { 
        password: hashedPassword,
        updatedAt: new Date()
      }
    });

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('Error resetting password:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Weighing Management Endpoints ---

// Get all weighing categories for the organization
app.get('/api/weighing-categories', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const categories = await prisma.weighingCategory.findMany({
      where: { organizationId },
      select: {
        id: true,
        category: true,
        kilogram_kg_: true,
        pound_lb_: true
      }
    });
    res.json(categories);
  } catch (err) {
    console.error('Error fetching weighing categories:', err);
    res.status(500).json({ error: 'Failed to fetch weighing categories' });
  }
});

// Create new weighing category
app.post('/api/weighing-categories', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { category, weight, unit } = req.body;

    if (!category) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    if (!weight || weight <= 0) {
      return res.status(400).json({ error: 'Valid weight value is required' });
    }

    if (!unit || !['kg', 'lb'].includes(unit)) {
      return res.status(400).json({ error: 'Unit must be either "kg" or "lb"' });
    }

    // Check if category with same name already exists for this organization
    const existingCategory = await prisma.weighingCategory.findFirst({
      where: { category, organizationId }
    });

    if (existingCategory) {
      return res.status(400).json({ error: 'Category with this name already exists' });
    }

    // Calculate both kg and lb values
    let finalKilogram: number;
    let finalPound: number;
    
    if (unit === 'kg') {
      finalKilogram = weight;
      finalPound = weight * 2.20462;
    } else {
      finalPound = weight;
      finalKilogram = weight / 2.20462;
    }

    // Round to 2 decimal places
    finalKilogram = Math.round(finalKilogram * 100) / 100;
    finalPound = Math.round(finalPound * 100) / 100;

    const weighingCategory = await prisma.weighingCategory.create({
      data: {
        category,
        kilogram_kg_: finalKilogram,
        pound_lb_: finalPound,
        organizationId
      },
      select: {
        id: true,
        category: true,
        kilogram_kg_: true,
        pound_lb_: true
      }
    });

    res.json(weighingCategory);
  } catch (err) {
    console.error('Error creating weighing category:', err);
    res.status(500).json({ error: 'Failed to create weighing category' });
  }
});

// Get all weighing records for the organization
app.get('/api/weighing', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const weighings = await prisma.weighingCategory.findMany({
      where: { organizationId },
      select: {
        id: true,
        category: true,
        kilogram_kg_: true,
        pound_lb_: true
      },
      orderBy: {
        id: 'desc'
      }
    });
    res.json(weighings);
  } catch (err) {
    console.error('Error fetching weighing records:', err);
    res.status(500).json({ error: 'Failed to fetch weighing records' });
  }
});

// Create new weighing record
app.post('/api/weighing', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { category, weight, unit } = req.body;

    if (!category || !weight || weight <= 0) {
      return res.status(400).json({ error: 'Category and valid weight value are required' });
    }

    if (!unit || !['kg', 'lb'].includes(unit)) {
      return res.status(400).json({ error: 'Unit must be either "kg" or "lb"' });
    }

    // Calculate both kg and lb values
    let finalKilogram: number;
    let finalPound: number;
    
    if (unit === 'kg') {
      finalKilogram = weight;
      finalPound = weight * 2.20462;
    } else {
      finalPound = weight;
      finalKilogram = weight / 2.20462;
    }

    // Round to 2 decimal places
    finalKilogram = Math.round(finalKilogram * 100) / 100;
    finalPound = Math.round(finalPound * 100) / 100;

    const weighing = await prisma.weighingCategory.create({
      data: {
        category,
        kilogram_kg_: finalKilogram,
        pound_lb_: finalPound,
        organizationId
      },
      select: {
        id: true,
        category: true,
        kilogram_kg_: true,
        pound_lb_: true
      }
    });

    res.json(weighing);
  } catch (err) {
    console.error('Error creating weighing record:', err);
    res.status(500).json({ error: 'Failed to create weighing record' });
  }
});

// Update weighing record
app.put('/api/weighing/:id', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const weighingId = parseInt(req.params.id);
    const { category, weight, unit } = req.body;

    if (!category || !weight || weight <= 0) {
      return res.status(400).json({ error: 'Category and valid weight value are required' });
    }

    if (!unit || !['kg', 'lb'].includes(unit)) {
      return res.status(400).json({ error: 'Unit must be either "kg" or "lb"' });
    }

    // Check if weighing record exists and belongs to organization
    const existing = await prisma.weighingCategory.findFirst({
      where: { id: weighingId, organizationId }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Weighing record not found' });
    }

    // Calculate both kg and lb values
    let finalKilogram: number;
    let finalPound: number;
    
    if (unit === 'kg') {
      finalKilogram = weight;
      finalPound = weight * 2.20462;
    } else {
      finalPound = weight;
      finalKilogram = weight / 2.20462;
    }

    // Round to 2 decimal places
    finalKilogram = Math.round(finalKilogram * 100) / 100;
    finalPound = Math.round(finalPound * 100) / 100;

    const updatedWeighing = await prisma.weighingCategory.update({
      where: { id: weighingId },
      data: {
        category,
        kilogram_kg_: finalKilogram,
        pound_lb_: finalPound
      },
      select: {
        id: true,
        category: true,
        kilogram_kg_: true,
        pound_lb_: true
      }
    });

    res.json(updatedWeighing);
  } catch (err) {
    console.error('Error updating weighing record:', err);
    res.status(500).json({ error: 'Failed to update weighing record' });
  }
});

// Delete weighing record
app.delete('/api/weighing/:id', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const weighingId = parseInt(req.params.id);

    // Check if weighing record exists and belongs to organization
    const existing = await prisma.weighingCategory.findFirst({
      where: { id: weighingId, organizationId }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Weighing record not found' });
    }

    await prisma.weighingCategory.delete({
      where: { id: weighingId }
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting weighing record:', err);
    res.status(500).json({ error: 'Failed to delete weighing record' });
  }
});

// Get weighing statistics for the organization
app.get('/api/weighing/stats', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    
    // Get total counts
    const totalWeighings = await prisma.weighingCategory.count({ where: { organizationId } });

    // Get recent weighings (last 10)
    const recentWeighings = await prisma.weighingCategory.findMany({
      where: { organizationId },
      select: {
        id: true,
        category: true,
        kilogram_kg_: true,
        pound_lb_: true
      },
      orderBy: {
        id: 'desc'
      },
      take: 10
    });

    // Get category totals
    const categoryTotals = await prisma.weighingCategory.groupBy({
      by: ['category'],
      where: { organizationId },
      _sum: {
        kilogram_kg_: true,
        pound_lb_: true
      }
    });

    const categoryStats = categoryTotals.map((total: any) => {
      return {
        categoryName: total.category,
        totalKilogram: total._sum.kilogram_kg_ || 0,
        totalPound: total._sum.pound_lb_ || 0,
        totalWeight: (total._sum.kilogram_kg_ || 0)
      };
    });

    res.json({
      totalWeighings,
      totalCategories: categoryStats.length,
      recentWeighings,
      categoryStats
    });
  } catch (err) {
    console.error('Error fetching weighing statistics:', err);
    res.status(500).json({ error: 'Failed to fetch weighing statistics' });
  }
});

// Update organization incoming dollar value only
app.put('/api/organizations/:id/incoming-value', authenticateToken, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.id);
    if (!organizationId) {
      return res.status(400).json({ error: 'Invalid organization ID' });
    }

    const { incoming_dollar_value } = req.body;

    // Validate incoming_dollar_value
    if (incoming_dollar_value === undefined || incoming_dollar_value === null) {
      return res.status(400).json({ error: 'Incoming dollar value is required' });
    }

    const parsedValue = parseFloat(incoming_dollar_value);
    if (isNaN(parsedValue) || parsedValue < 0) {
      return res.status(400).json({ error: 'Invalid incoming dollar value. Must be a positive number.' });
    }

    // Check if organization exists and user has access
    const reqAny = req as any;
    const userOrganizationId = reqAny.user.organizationId;
    
    if (organizationId !== userOrganizationId) {
      return res.status(403).json({ error: 'Access denied. You can only update your own organization.' });
    }

    const existing = await prisma.organization.findUnique({
      where: { id: organizationId }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    console.log(`Updating incoming_dollar_value for org ${organizationId} from ${existing.incoming_dollar_value} to ${parsedValue}`);

    // Update only the incoming_dollar_value
    const updatedOrganization = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        incoming_dollar_value: parsedValue
      },
      select: {
        id: true,
        name: true,
        address: true,
        incoming_dollar_value: true
      }
    });

    console.log('Successfully updated incoming_dollar_value:', updatedOrganization);
    res.json(updatedOrganization);
  } catch (err) {
    console.error('Error updating incoming dollar value:', err);
    res.status(500).json({ error: 'Failed to update incoming dollar value' });
  }
});

// Delete organization
app.delete('/api/organizations/:id', authenticateToken, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.id);
    if (!organizationId) {
      return res.status(400).json({ error: 'Invalid organization ID' });
    }

    // Check if organization exists
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId }
    });

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Delete related records first
    await prisma.$transaction([
      prisma.donation.deleteMany({ where: { organizationId } }),
      prisma.donationCategory.deleteMany({ where: { organizationId } }),
      prisma.donor.deleteMany({ where: { kitchenId: organizationId } }),
      prisma.recurringShift.deleteMany({ where: { organizationId } }),
      prisma.shift.deleteMany({ where: { organizationId } }),
      prisma.shiftCategory.deleteMany({ where: { organizationId } }),
      prisma.user.deleteMany({ where: { organizationId } })
    ]);

    // Delete the organization
    await prisma.organization.delete({
      where: { id: organizationId }
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting organization:', err);
    res.status(500).json({ error: 'Failed to delete organization' });
  }
});

// Get organization statistics
app.get('/api/organizations/:id/stats', authenticateToken, async (req, res) => {
  try {
    const organizationId = parseInt(req.params.id);
    if (!organizationId) {
      return res.status(400).json({ error: 'Invalid organization ID' });
    }

    // Get counts for different entities
    const [totalUsers, totalShifts, totalDonations] = await Promise.all([
      prisma.user.count({ where: { organizationId } }),
      prisma.shift.count({ where: { organizationId } }),
      prisma.donation.count({ where: { organizationId } })
    ]);

    res.json({
      totalUsers,
      totalShifts,
      totalDonations
    });
  } catch (err) {
    console.error('Error fetching organization stats:', err);
    res.status(500).json({ error: 'Failed to fetch organization statistics' });
  }
});

// Update shift signup
app.put("/api/shiftsignups/:id", authenticateToken, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    try {
      // Update the shift signup with the new userId
      const updatedSignup = await prisma.shiftSignup.update({
        where: { id: Number(id) },
        data: {
          userId: Number(userId)
        }
      });
      res.json(updatedSignup);
    } catch (updateError: any) {
      console.error("Prisma update error:", updateError);
      if (updateError.code === 'P2025') {
        return res.status(404).json({ error: "Shift signup not found" });
      }
      throw updateError;
    }
  } catch (err) {
    console.error("Error updating shift signup:", err);
    res.status(500).json({ error: "Failed to update shift signup" });
  }
});

// Delete shift signup
app.delete('/api/shiftsignups/:id', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const id = parseInt(req.params.id);

    // Check if signup exists and belongs to organization
    const existing = await prisma.shiftSignup.findFirst({
      where: { 
        id,
        Shift: {
          organizationId
        }
      }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Shift signup not found' });
    }

    // Delete the shift signup
    await prisma.shiftSignup.delete({
      where: { id }
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting shift signup:', err);
    res.status(500).json({ error: 'Failed to delete shift signup' });
  }
});

// Get all donors for the authenticated organization
app.get('/api/donors', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const donors = await prisma.donor.findMany({
      where: { kitchenId: organizationId },
      select: { id: true, name: true }
    });
    res.json(donors);
  } catch (err) {
    console.error('Error fetching donors:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export inventory table (donor x category) as Excel
app.get('/api/inventory/export-table', authenticateToken, async (req: any, res) => {
  try {
    const { month, year, unit } = req.query;
    const organizationId = req.user.organizationId;
    // Convert month and year to numbers
    const monthNum = Number(month);
    const yearNum = Number(year);
    let startDate: Date, endDate: Date;
    if (!yearNum) {
      return res.status(400).json({ error: 'Year is required' });
    }
    if (!monthNum || monthNum === 0) {
      startDate = new Date(yearNum, 0, 1);
      endDate = new Date(yearNum, 11, 31, 23, 59, 59, 999);
    } else {
      startDate = new Date(yearNum, monthNum - 1, 1);
      endDate = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);
    }

    // Get weighing categories for custom unit conversion
    const weighingCategories = await prisma.weighingCategory.findMany({
      where: { organizationId },
      select: {
        id: true,
        category: true,
        kilogram_kg_: true,
        pound_lb_: true
      }
    });

    // Fetch donors
    const donors = await prisma.donor.findMany({
      where: { kitchenId: organizationId },
      select: { id: true, name: true }
    });
    // Fetch categories
    const allCategories = await prisma.donationCategory.findMany({
      where: { organizationId },
      select: { id: true, name: true }
    });
    
    // Remove duplicate category names (keep first occurrence)
    const uniqueCategoryNames = new Set<string>();
    const categories = allCategories.filter(cat => {
      if (uniqueCategoryNames.has(cat.name)) {
        return false;
      }
      uniqueCategoryNames.add(cat.name);
      return true;
    });
    
    // Fetch all donation items for this org and date range
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
      select: { categoryId: true, weightKg: true, Donation: { select: { donorId: true } } }
    });
    // Build donor x category table
    const donorIdToName: Record<number, string> = {};
    donors.forEach(d => { donorIdToName[d.id] = d.name; });
    const catIdToName: Record<number, string> = {};
    categories.forEach(c => { catIdToName[c.id] = c.name; });
    // Initialize table: donorName -> categoryName -> 0
    const table: Record<string, Record<string, number>> = {};
    donors.forEach(donor => {
      table[donor.name] = {};
      categories.forEach(cat => {
        table[donor.name][cat.name] = 0;
      });
    });
    // Fill table with actual weights
    items.forEach(item => {
      const donorName = donorIdToName[Number(item.Donation.donorId)];
      const catName = catIdToName[Number(item.categoryId)];
      if (donorName && catName) {
        table[donorName][catName] += item.weightKg;
      }
    });

    // Helper function to convert weight based on selected unit
    const convertWeight = (weight: number) => {
      if (weight == null || isNaN(weight)) return 0;
      
      // Handle base units
      if (unit === 'Pounds (lb)') {
        return +(weight * 2.20462).toFixed(2);
      }
      if (unit === 'Kilograms (kg)') {
        return +weight.toFixed(2);
      }
      
      // Handle custom weighing categories
      const category = weighingCategories.find(c => c.category === unit);
      if (category && category.kilogram_kg_ > 0) {
        // Convert kg to custom unit (divide by kg per unit)
        return +(weight / category.kilogram_kg_).toFixed(2);
      }
      
      return +weight.toFixed(2);
    };

    // Helper function to get unit label for display
    const getUnitLabel = () => {
      if (unit === 'Kilograms (kg)') return 'kg';
      if (unit === 'Pounds (lb)') return 'lbs';
      return unit;
    };

    // Prepare Excel data
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Inventory');
    // Header row with unit labels
    const headerRow = ['Donor', ...categories.map(c => `${c.name} (${getUnitLabel()})`), `Total (${getUnitLabel()})`];
    worksheet.addRow(headerRow);
    // Data rows
    donors.forEach(donor => {
      const row: (string | number)[] = [donor.name];
      let donorTotal = 0;
      categories.forEach(cat => {
        const val = convertWeight(table[donor.name][cat.name] || 0);
        row.push(val);
        donorTotal += val;
      });
      row.push(+donorTotal.toFixed(2));
      worksheet.addRow(row);
    });
    // Total row
    const totalRow: (string | number)[] = ['Total'];
    let grandTotal: number = 0;
    categories.forEach(cat => {
      const catTotal = donors.reduce((sum: number, donor) => sum + convertWeight(table[donor.name][cat.name] || 0), 0);
      totalRow.push(+catTotal.toFixed(2));
      grandTotal += catTotal;
    });
    totalRow.push(+grandTotal.toFixed(2));
    worksheet.addRow(totalRow);
    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="inventory-table-${year}-${month}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error exporting inventory table:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export consolidated incoming stats summary for dashboard as Excel
app.get('/api/incoming-stats/export-dashboard', authenticateToken, async (req: any, res) => {
  try {
    const { month, year, unit } = req.query;
    const organizationId = req.user.organizationId;

    // Get incoming dollar value for this organization
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { incoming_dollar_value: true }
    });
    const incomingDollarValue = org?.incoming_dollar_value || 0;

    // Get all donors for this organization
    const donors = await prisma.donor.findMany({
      where: { kitchenId: organizationId },
      select: { id: true, name: true }
    });

    // Get all donations for the specified month/year
    let startDate: Date, endDate: Date;
    if (parseInt(month) === 0) {
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
      include: { Donor: true }
    });

    // Get weighing categories for custom units
    let weighingCategories: any[] = [];
    if (unit && unit !== 'Kilograms (kg)' && unit !== 'Pounds (lb)') {
      weighingCategories = await prisma.weighingCategory.findMany({
        where: { organizationId },
      });
    }

    // Helper to convert weight
    function convertWeight(weightKg: number): number {
      if (unit === 'Pounds (lb)') {
        return +(weightKg * 2.20462).toFixed(2);
      }
      if (unit === 'Kilograms (kg)') {
        return +weightKg.toFixed(2);
      }
      // Custom unit
      const cat = weighingCategories.find(c => c.category === unit);
      if (cat && cat.kilogram_kg_ > 0) {
        return +(weightKg / cat.kilogram_kg_).toFixed(2);
      }
      return +weightKg.toFixed(2);
    }

    // Build donor totals
    const donorTotals: { [donor: string]: { weight: number, value: number } } = {};
    donors.forEach(donor => { donorTotals[donor.name] = { weight: 0, value: 0 }; });
    donations.forEach(donation => {
      const donorName = donation.Donor.name;
      const weightKg = donation.summary;
      if (donorTotals[donorName]) {
        donorTotals[donorName].weight += weightKg;
        donorTotals[donorName].value += weightKg * incomingDollarValue;
      }
    });

    // Prepare Excel data
    const workbook = new (require('exceljs')).Workbook();
    const worksheet = workbook.addWorksheet('Incoming Summary');
    const unitLabel = unit === 'Pounds (lb)' ? 'lbs' : (unit === 'Kilograms (kg)' ? 'kg' : unit);
    worksheet.addRow(['Donor', `Weight (${unitLabel})`, 'Value ($)']);
    let grandTotalWeight = 0;
    let grandTotalValue = 0;
    donors.forEach(donor => {
      const w = convertWeight(donorTotals[donor.name].weight);
      const v = +(donorTotals[donor.name].value).toFixed(2);
      worksheet.addRow([donor.name, w, v]);
      grandTotalWeight += w;
      grandTotalValue += v;
    });
    worksheet.addRow(['Grand Total', +grandTotalWeight.toFixed(2), +grandTotalValue.toFixed(2)]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="incoming-dashboard-${year}-${month}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error exporting dashboard incoming stats:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== TERMS AND CONDITIONS ENDPOINTS =====

// Get all terms and conditions for an organization
app.get('/api/terms-and-conditions', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    
    const termsAndConditions = await prisma.termsAndConditions.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        version: true,
        title: true,
        fileUrl: true,
        fileName: true,
        fileSize: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        createdBy: true
      }
    });

    res.json(termsAndConditions);
  } catch (err) {
    console.error('Error fetching terms and conditions:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
  });


// Upload and create new terms and conditions
app.post('/api/terms-and-conditions', authenticateToken, upload.single('file'), async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const userId = req.user.id;
    const { version, title, isActive } = req.body;
    
    console.log('Terms and conditions upload request:', {
      organizationId,
      userId,
      version,
      title,
      isActive,
      hasFile: !!req.file
    });

    if (!req.file) {
      console.log('No file uploaded in request');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('File details:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    if (!version || !title) {
      console.log('Missing required fields:', { version: !!version, title: !!title });
      return res.status(400).json({ error: 'Version and title are required' });
    }

    // Check if version already exists for this organization
    console.log('Checking for existing version...');
    const existingVersion = await prisma.termsAndConditions.findUnique({
      where: {
        organizationId_version: {
          organizationId,
          version
        }
      }
    });

    if (existingVersion) {
      console.log('Version already exists:', version);
      return res.status(400).json({ error: 'Version already exists for this organization' });
    }

    // Upload file to Cloudflare R2
    console.log('Attempting to upload file to R2...');
    let uploadResult;
    try {
      uploadResult = await uploadToR2(req.file, organizationId, 'terms-and-conditions');
      console.log('File uploaded successfully:', uploadResult);
    } catch (uploadError) {
      console.error('R2 upload failed:', uploadError);
      throw uploadError;
    }
    const { fileUrl, fileName, fileSize } = uploadResult;

    // If this is set as active, deactivate all other versions
    // if (isActive === 'true' || isActive === true) {
    //   console.log('Deactivating other versions...');
    //   await prisma.termsAndConditions.updateMany({
    //     where: { organizationId },
    //     data: { isActive: false }
    //   });
    // }

    // Create new terms and conditions record
    console.log('Creating database record...');
    const createData = {
      organizationId,
      version,
      title,
      fileUrl,
      fileName,
      fileSize,
      isActive: isActive === 'true' || isActive === true,
      createdBy: userId,
      updatedAt: new Date()
    };
    console.log('Database create data:', createData);
    
    let newTermsAndConditions;
    try {
      newTermsAndConditions = await prisma.termsAndConditions.create({
        data: createData
      });
      console.log('Database record created successfully:', newTermsAndConditions.id);
    } catch (dbError) {
      console.error('Database creation failed:', dbError);
      throw dbError;
    }

    console.log('Terms and conditions created successfully:', newTermsAndConditions.id);
    res.status(201).json(newTermsAndConditions);
  } catch (err) {
    console.error('Error creating terms and conditions:', err);
    console.error('Error details:', {
      message: err instanceof Error ? err.message : 'Unknown error',
      stack: err instanceof Error ? err.stack : undefined,
      code: (err as any)?.code,
      statusCode: (err as any)?.statusCode
    });
    res.status(500).json({ 
      error: 'Internal server error',
      details: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

// Update terms and conditions (without file upload)
app.put('/api/terms-and-conditions/:id', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const termsId = parseInt(req.params.id);
    const { version, title, isActive } = req.body;

    if (!version || !title) {
      return res.status(400).json({ error: 'Version and title are required' });
    }

    // Check if the terms and conditions exists and belongs to the organization
    const existingTerms = await prisma.termsAndConditions.findFirst({
      where: {
        id: termsId,
        organizationId
      }
    });

    if (!existingTerms) {
      return res.status(404).json({ error: 'Terms and conditions not found' });
    }

    // Check if version already exists for this organization (excluding current record)
    if (version !== existingTerms.version) {
      const existingVersion = await prisma.termsAndConditions.findFirst({
        where: {
          organizationId,
          version,
          id: { not: termsId }
        }
      });

      if (existingVersion) {
        return res.status(400).json({ error: 'Version already exists for this organization' });
      }
    }

    // If this is set as active, deactivate all other versions
    // if (isActive === 'true' || isActive === true) {
    //   await prisma.termsAndConditions.updateMany({
    //     where: { 
    //       organizationId,
    //       id: { not: termsId }
    //     },
    //     data: { isActive: false }
    //   });
    // }

    // Update the terms and conditions
    const updatedTerms = await prisma.termsAndConditions.update({
      where: { id: termsId },
      data: {
        version,
        title,
        isActive: isActive === 'true' || isActive === true,
        updatedAt: new Date()
      }
    });

    res.json(updatedTerms);
  } catch (err) {
    console.error('Error updating terms and conditions:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete terms and conditions
app.delete('/api/terms-and-conditions/:id', authenticateToken, async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const termsId = parseInt(req.params.id);

    console.log('Delete request:', { organizationId, termsId });

    // Check if the terms and conditions exists and belongs to the organization
    console.log('Checking for existing terms and conditions...');
    const existingTerms = await prisma.termsAndConditions.findFirst({
      where: {
        id: termsId,
        organizationId
      }
    });

    if (!existingTerms) {
      console.log('Terms and conditions not found:', { termsId, organizationId });
      return res.status(404).json({ error: 'Terms and conditions not found' });
    }

    console.log('Found terms to delete:', {
      id: existingTerms.id,
      fileName: existingTerms.fileName,
      fileUrl: existingTerms.fileUrl
    });

    // Delete file from Cloudflare R2
    if (existingTerms.fileUrl) {
      try {
        console.log('Deleting file from R2...');
        await deleteFromR2(existingTerms.fileUrl);
        console.log('File deleted from R2 successfully');
      } catch (fileError) {
        console.error('Error deleting file from R2:', fileError);
        // Continue with database deletion even if file deletion fails
      }
    }

    // Delete the terms and conditions record
    console.log('Deleting database record...');
    await prisma.termsAndConditions.delete({
      where: { id: termsId }
    });

    console.log('Terms and conditions deleted successfully:', termsId);
    res.json({ success: true, message: 'Terms and conditions deleted successfully' });
  } catch (err) {
    console.error('Error deleting terms and conditions:', err);
    console.error('Error details:', {
      message: err instanceof Error ? err.message : 'Unknown error',
      stack: err instanceof Error ? err.stack : undefined,
      code: (err as any)?.code,
      statusCode: (err as any)?.statusCode
    });
    res.status(500).json({ 
      error: 'Internal server error',
      details: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

// Replace file for existing terms and conditions
app.put('/api/terms-and-conditions/:id/file', authenticateToken, upload.single('file'), async (req: any, res) => {
  try {
    const organizationId = req.user.organizationId;
    const termsId = parseInt(req.params.id);
    
    console.log('File replacement request:', {
      organizationId,
      termsId,
      hasFile: !!req.file
    });
    
    if (!req.file) {
      console.log('No file uploaded in request');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('File details:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    // Check if the terms and conditions exists and belongs to the organization
    console.log('Checking for existing terms and conditions...');
    const existingTerms = await prisma.termsAndConditions.findFirst({
      where: {
        id: termsId,
        organizationId
      }
    });

    if (!existingTerms) {
      console.log('Terms and conditions not found:', { termsId, organizationId });
      return res.status(404).json({ error: 'Terms and conditions not found' });
    }

    console.log('Found existing terms:', {
      id: existingTerms.id,
      fileName: existingTerms.fileName,
      fileUrl: existingTerms.fileUrl
    });

    // Upload new file to Cloudflare R2
    console.log('Uploading new file to R2...');
    const { fileUrl, fileName, fileSize } = await uploadToR2(req.file, organizationId, 'terms-and-conditions');
    console.log('New file uploaded successfully:', { fileUrl, fileName, fileSize });

    // Delete old file from R2
    try {
      console.log('Deleting old file from R2...');
      await deleteFromR2(existingTerms.fileUrl);
      console.log('Old file deleted successfully');
    } catch (fileError) {
      console.error('Error deleting old file from R2:', fileError);
      // Continue with update even if old file deletion fails
    }

    // Update the terms and conditions with new file info
    console.log('Updating database record...');
    const updatedTerms = await prisma.termsAndConditions.update({
      where: { id: termsId },
      data: {
        fileUrl,
        fileName,
        fileSize,
        updatedAt: new Date()
      }
    });

    console.log('Terms and conditions file updated successfully:', updatedTerms.id);
    res.json(updatedTerms);
  } catch (err) {
    console.error('Error updating terms and conditions file:', err);
    console.error('Error details:', {
      message: err instanceof Error ? err.message : 'Unknown error',
      stack: err instanceof Error ? err.stack : undefined,
      code: (err as any)?.code,
      statusCode: (err as any)?.statusCode
    });
    res.status(500).json({ 
      error: 'Internal server error',
      details: err instanceof Error ? err.message : 'Unknown error'
    });
  }
});

// Shift signup endpoints (public access)

// Get shift details by category and shift name (public endpoint)
app.get('/api/public/shift-signup/:categoryName/:shiftName', async (req, res) => {
  try {
    const { categoryName, shiftName } = req.params;
    const { date } = req.query;
    
    console.log('Fetching shift details for:', { categoryName, shiftName, date });
    
    let whereClause: any = {
      name: shiftName,
      ShiftCategory: {
        name: categoryName
      }
    };
    
    // If date is provided, filter by date
    if (date && typeof date === 'string') {
      // Parse the date and create UTC date range
      const [year, month, day] = date.split('-').map(Number);
      const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
      const endOfDay = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
      
      console.log('Date filtering:', { date, startOfDay, endOfDay });
      
      whereClause.startTime = {
        gte: startOfDay,
        lt: endOfDay
      };
    }
    
    // Find the shift by category name, shift name, and optionally date
    const shift = await prisma.shift.findFirst({
      where: whereClause,
      include: {
        ShiftCategory: true,
        Organization: true,
        ShiftSignup: {
          include: {
            User: true
          }
        }
      }
    });
    
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }
    
    // Calculate available slots
    const signedUpCount = shift.ShiftSignup.length;
    const availableSlots = shift.slots - signedUpCount;
    
    res.json({
      id: shift.id,
      name: shift.name,
      categoryName: shift.ShiftCategory.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      location: shift.location,
      slots: shift.slots,
      availableSlots: availableSlots,
      organizationId: shift.organizationId,
      organizationName: shift.Organization.name,
      signedUpCount: signedUpCount
    });
  } catch (err) {
    console.error('Error fetching shift details:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Submit shift signup (public endpoint)
app.post('/api/public/shift-signup/:categoryName/:shiftName', async (req, res) => {
  try {
    const { categoryName, shiftName } = req.params;
    const { email, firstName, lastName, shiftDate } = req.body;
    
    console.log('Shift signup request:', { categoryName, shiftName, email, firstName, lastName, shiftDate });
    
    // Validate required fields
    if (!email || !firstName || !lastName || !shiftDate) {
      return res.status(400).json({ error: 'Email, first name, last name, and date are required' });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Find the shift for the specific date
    const [year, month, day] = shiftDate.split('-').map(Number);
    const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
    
    const shift = await prisma.shift.findFirst({
      where: {
        name: shiftName,
        ShiftCategory: {
          name: categoryName
        },
        startTime: {
          gte: startOfDay,
          lt: endOfDay
        }
      },
      include: {
        ShiftCategory: true,
        Organization: true,
        ShiftSignup: true
      }
    });
    
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }
    
    // Check if shift is full
    if (shift.ShiftSignup.length >= shift.slots) {
      return res.status(400).json({ error: 'Shift is full' });
    }
    
    // Check if user already exists
    let user = await prisma.user.findUnique({
      where: { email }
    });
    
    let isNewUser = false;
    
    if (!user) {
      // Create new user
      isNewUser = true;
      const tempPassword = Math.random().toString(36).slice(-8); // Temporary password
      const hashedPassword = await bcrypt.hash(tempPassword, 10);
      
      // Generate password reset token
      const resetToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      const resetTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      
      user = await prisma.user.create({
        data: {
          email,
          firstName,
          lastName,
          password: hashedPassword,
          organizationId: shift.organizationId,
          role: 'VOLUNTEER',
          status: 'APPROVED', // Auto-approve shift signups
          resetToken,
          resetTokenExpiry,
          updatedAt: new Date()
        }
      });
      
      console.log('Created new user:', user.id);
    } else {
      // Check if user is already signed up for this shift
      const existingSignup = await prisma.shiftSignup.findFirst({
        where: {
          userId: user.id,
          shiftId: shift.id
        }
      });
      
      if (existingSignup) {
        return res.status(400).json({ error: 'You are already signed up for this shift' });
      }
    }
    
    // Create shift signup
    const shiftSignup = await prisma.shiftSignup.create({
      data: {
        userId: user.id,
        shiftId: shift.id
      }
    });
    
    console.log('Created shift signup:', shiftSignup.id);
    
    // Send email notification
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });
      
      let emailSubject, emailText;
      
      if (isNewUser) {
        // New user - send welcome email
        emailSubject = 'Welcome to Hungy - Shift Signup Confirmation';
        emailText = `Hi ${firstName},

Thank you for signing up for the shift: ${shift.name} (${shift.ShiftCategory.name})

Shift Details:
- Date & Time: ${new Date(shift.startTime).toLocaleString('en-CA', { timeZone: 'America/Halifax' })} - ${new Date(shift.endTime).toLocaleString('en-CA', { timeZone: 'America/Halifax' })}
- Location: ${shift.location}
- Organization: ${shift.Organization.name}

Welcome to the team!`;
      } else {
        // Existing user - send confirmation email
        emailSubject = 'Shift Signup Confirmation - Hungy';
        emailText = `Hi ${firstName},

Your shift signup has been confirmed!

Shift Details:
- Shift: ${shift.name} (${shift.ShiftCategory.name})
- Date & Time: ${new Date(shift.startTime).toLocaleString('en-CA', { timeZone: 'America/Halifax' })} - ${new Date(shift.endTime).toLocaleString('en-CA', { timeZone: 'America/Halifax' })}
- Location: ${shift.location}
- Organization: ${shift.Organization.name}

Thank you for volunteering!`;
      }
      
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: emailSubject,
        text: emailText,
      };
      
      await transporter.sendMail(mailOptions);
      console.log('Email sent successfully to:', email);
    } catch (emailErr) {
      console.error('Failed to send email:', emailErr);
      // Don't fail the signup if email fails
    }
    
    res.status(201).json({
      success: true,
      message: 'Signup successful! Confirmation email sent.',
      shiftSignup: {
        id: shiftSignup.id,
        shiftName: shift.name,
        categoryName: shift.ShiftCategory.name,
        startTime: shift.startTime,
        endTime: shift.endTime,
        location: shift.location,
        selectedDate: shiftDate
      },
      isNewUser
    });
  } catch (err) {
    console.error('Error processing shift signup:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`)
})