"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const client_1 = require("@prisma/client");
const bcrypt = __importStar(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const exceljs_1 = __importDefault(require("exceljs"));
const nodemailer_1 = __importDefault(require("nodemailer"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
const port = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }
    jsonwebtoken_1.default.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};
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
        }
        else {
            // For plain text passwords (backward compatibility)
            validPassword = password === user.password;
        }
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        // Create JWT with user ID
        const token = jsonwebtoken_1.default.sign({
            id: user.id,
            userId: user.id,
            email: user.email,
            role: user.role,
            organizationId: user.organizationId
        }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ token });
    }
    catch (err) {
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
        }
        else {
            // For plain text passwords (backward compatibility)
            validPassword = password === user.password;
        }
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        // Create JWT with user ID
        const token = jsonwebtoken_1.default.sign({
            id: user.id,
            userId: user.id,
            email: user.email,
            role: user.role,
            organizationId: user.organizationId
        }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ token });
    }
    catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
// Get incoming stats
app.get('/api/incoming-stats', authenticateToken, async (req, res) => {
    try {
        const { month, year } = req.query;
        const organizationId = req.user.organizationId;
        // Get incoming_dollar_value for this organization
        const org = await prisma.organization.findUnique({
            where: { id: organizationId },
            select: { incoming_dollar_value: true }
        });
        const incomingDollarValue = (org === null || org === void 0 ? void 0 : org.incoming_dollar_value) || 0;
        // Get all donors for this organization
        const donors = await prisma.donor.findMany({
            where: { kitchenId: organizationId },
            select: { id: true, name: true }
        });
        // Get all donations for the specified month/year
        let startDate, endDate;
        if (parseInt(month) === 0) {
            // All months: get the whole year
            startDate = new Date(parseInt(year), 0, 1);
            endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
        }
        else {
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
        // Group donations by donor
        const donorTotals = {};
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
        // Calculate grand totals
        const grandTotalWeight = Object.values(donorTotals).reduce((sum, d) => sum + d.weight, 0);
        const grandTotalValue = Object.values(donorTotals).reduce((sum, d) => sum + d.value, 0);
        res.json({
            donors: donors.map((d) => d.name),
            donorTotals,
            grandTotalWeight,
            grandTotalValue,
            incomingDollarValue
        });
    }
    catch (err) {
        console.error('Error fetching incoming stats:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Export incoming stats as Excel
app.get('/api/incoming-stats/export', authenticateToken, async (req, res) => {
    try {
        const { month, year, unit } = req.query;
        const organizationId = req.user.organizationId;
        // Get all donors for this organization
        const donors = await prisma.donor.findMany({
            where: { kitchenId: organizationId },
            select: { id: true, name: true }
        });
        // Get all donations for the specified month/year
        let startDate, endDate;
        if (parseInt(month) === 0) {
            // All months: get the whole year
            startDate = new Date(parseInt(year), 0, 1);
            endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
        }
        else {
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
        const groupedData = donations.reduce((acc, donation) => {
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
        const tableData = Object.values(groupedData).map((row) => ({
            date: row.date,
            ...row.donors
        }));
        // Calculate totals
        const totals = donors.reduce((acc, donor) => {
            acc[donor.name] = tableData.reduce((sum, row) => sum + (row[donor.name] || 0), 0);
            return acc;
        }, {});
        // Calculate row totals
        const rowTotals = tableData.map((row) => donors.reduce((sum, donor) => sum + (row[donor.name] || 0), 0));
        // Calculate grand total
        const grandTotal = Object.values(totals).reduce((sum, val) => sum + val, 0);
        // Create Excel workbook
        const workbook = new exceljs_1.default.Workbook();
        const worksheet = workbook.addWorksheet('Incoming Stats');
        // Header row
        const headerRow = ['Date', ...donors.map((d) => d.name), 'Total'];
        worksheet.addRow(headerRow);
        // Data rows
        tableData.forEach((row, i) => {
            const rowArr = [
                row.date,
                ...donors.map((d) => row[d.name] || 0),
                rowTotals[i]
            ];
            worksheet.addRow(rowArr);
        });
        // Totals row
        const totalsRow = ['Monthly Total', ...donors.map((d) => totals[d.name]), grandTotal];
        worksheet.addRow(totalsRow);
        // Unit conversion if needed
        if (unit === 'Pounds (lb)') {
            // Convert all weight columns to lbs
            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber === 1)
                    return; // skip header
                row.eachCell((cell, colNumber) => {
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
    }
    catch (err) {
        console.error('Error exporting incoming stats:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get shift categories for the current organization
app.get('/api/shift-categories', authenticateToken, async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const categories = await prisma.shiftCategory.findMany({
            where: { organizationId },
            orderBy: { name: 'asc' }
        });
        res.json(categories);
    }
    catch (err) {
        console.error('Error fetching shift categories:', err);
        res.status(500).json({ error: 'Failed to fetch shift categories' });
    }
});
// Outgoing stats: meals distributed by shift category and date (for dashboard)
app.get('/api/outgoing-stats', authenticateToken, async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        // Get all shift categories for this organization
        const categories = await prisma.shiftCategory.findMany({
            where: { organizationId },
            orderBy: { id: 'asc' },
            select: { id: true, name: true }
        });
        const categoryIdToName = {};
        categories.forEach((cat) => { categoryIdToName[cat.id] = cat.name; });
        // Get all shifts for this organization
        const shifts = await prisma.shift.findMany({
            where: { organizationId },
            orderBy: { startTime: 'asc' },
            select: { id: true, shiftCategoryId: true, startTime: true }
        });
        // Build a map: shiftId -> { date, categoryName }
        const shiftIdToDate = {};
        const shiftIdToCategory = {};
        const dateSet = new Set();
        shifts.forEach((shift) => {
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
        const shiftIds = shifts.map((s) => s.id);
        const signups = await prisma.shiftSignup.findMany({
            where: { shiftId: { in: shiftIds } },
            select: { shiftId: true, mealsServed: true }
        });
        // Build a map: date -> { categoryName -> totalMeals }
        const dateCategoryMeals = {};
        signups.forEach((signup) => {
            const shiftId = signup.shiftId;
            const date = shiftIdToDate[shiftId];
            const category = shiftIdToCategory[shiftId];
            if (!date || !category)
                return;
            if (!dateCategoryMeals[date])
                dateCategoryMeals[date] = {};
            dateCategoryMeals[date][category] = (dateCategoryMeals[date][category] || 0) + (signup.mealsServed || 0);
        });
        // Prepare table data: one row per date, columns are categories
        const sortedDates = Array.from(dateSet).sort();
        const categoryNames = categories.map((c) => c.name);
        const tableData = sortedDates.map((date) => {
            const row = { Date: date };
            categoryNames.forEach((cat) => {
                var _a;
                row[cat] = ((_a = dateCategoryMeals[date]) === null || _a === void 0 ? void 0 : _a[cat]) || 0;
            });
            return row;
        });
        res.json({
            columns: ['Date', ...categoryNames],
            tableData
        });
    }
    catch (err) {
        console.error('Error fetching outgoing stats:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Filtered outgoing stats with month/year filtering (for Outgoing Stats page)
app.get('/api/outgoing-stats/filtered', authenticateToken, async (req, res) => {
    try {
        const { month, year } = req.query;
        const organizationId = req.user.organizationId;
        // Get date range based on month/year
        let startDate, endDate;
        if (!year) {
            return res.status(400).json({ error: 'Year is required' });
        }
        if (!month || parseInt(month) === 0) {
            startDate = new Date(parseInt(year), 0, 1);
            endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
        }
        else {
            startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
            endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
        }
        // Get all shift categories for this organization
        const categories = await prisma.shiftCategory.findMany({
            where: { organizationId },
            orderBy: { id: 'asc' },
            select: { id: true, name: true }
        });
        const categoryIdToName = {};
        categories.forEach((cat) => { categoryIdToName[cat.id] = cat.name; });
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
        const shiftIdToDate = {};
        const shiftIdToCategory = {};
        const dateSet = new Set();
        shifts.forEach((shift) => {
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
        const shiftIds = shifts.map((s) => s.id);
        const signups = await prisma.shiftSignup.findMany({
            where: { shiftId: { in: shiftIds } },
            select: { shiftId: true, mealsServed: true }
        });
        // Build a map: date -> { categoryName -> totalMeals }
        const dateCategoryMeals = {};
        signups.forEach((signup) => {
            const shiftId = signup.shiftId;
            const date = shiftIdToDate[shiftId];
            const category = shiftIdToCategory[shiftId];
            if (!date || !category)
                return;
            if (!dateCategoryMeals[date])
                dateCategoryMeals[date] = {};
            dateCategoryMeals[date][category] = (dateCategoryMeals[date][category] || 0) + (signup.mealsServed || 0);
        });
        // Prepare table data: one row per date, columns are categories
        const sortedDates = Array.from(dateSet).sort();
        const categoryNames = categories.map((c) => c.name);
        const tableData = sortedDates.map((date) => {
            const row = { Date: date };
            let total = 0;
            categoryNames.forEach((cat) => {
                var _a;
                const val = ((_a = dateCategoryMeals[date]) === null || _a === void 0 ? void 0 : _a[cat]) || 0;
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
    }
    catch (err) {
        console.error('Error fetching filtered outgoing stats:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Export filtered outgoing stats as Excel
app.get('/api/outgoing-stats/filtered/export', authenticateToken, async (req, res) => {
    try {
        const { month, year } = req.query;
        const organizationId = req.user.organizationId;
        // Get date range based on month/year
        let startDate, endDate;
        if (!year) {
            return res.status(400).json({ error: 'Year is required' });
        }
        if (!month || parseInt(month) === 0) {
            startDate = new Date(parseInt(year), 0, 1);
            endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
        }
        else {
            startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
            endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
        }
        // Get all shift categories for this organization
        const categories = await prisma.shiftCategory.findMany({
            where: { organizationId },
            orderBy: { id: 'asc' },
            select: { id: true, name: true }
        });
        const categoryIdToName = {};
        categories.forEach((cat) => { categoryIdToName[cat.id] = cat.name; });
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
        const shiftIdToDate = {};
        const shiftIdToCategory = {};
        const dateSet = new Set();
        shifts.forEach((shift) => {
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
        const shiftIds = shifts.map((s) => s.id);
        const signups = await prisma.shiftSignup.findMany({
            where: { shiftId: { in: shiftIds } },
            select: { shiftId: true, mealsServed: true }
        });
        // Build a map: date -> { categoryName -> totalMeals }
        const dateCategoryMeals = {};
        signups.forEach((signup) => {
            const shiftId = signup.shiftId;
            const date = shiftIdToDate[shiftId];
            const category = shiftIdToCategory[shiftId];
            if (!date || !category)
                return;
            if (!dateCategoryMeals[date])
                dateCategoryMeals[date] = {};
            dateCategoryMeals[date][category] = (dateCategoryMeals[date][category] || 0) + (signup.mealsServed || 0);
        });
        // Prepare table data: one row per date, columns are categories
        const sortedDates = Array.from(dateSet).sort();
        const categoryNames = categories.map((c) => c.name);
        const tableData = sortedDates.map((date) => {
            const row = { Date: date };
            let total = 0;
            categoryNames.forEach((cat) => {
                var _a;
                const val = ((_a = dateCategoryMeals[date]) === null || _a === void 0 ? void 0 : _a[cat]) || 0;
                row[cat] = val;
                total += val;
            });
            row['Total'] = total;
            return row;
        });
        // Generate Excel file
        const workbook = new exceljs_1.default.Workbook();
        const worksheet = workbook.addWorksheet('Outgoing Stats');
        worksheet.addRow(['Date', ...categoryNames, 'Total']);
        tableData.forEach((row) => {
            worksheet.addRow([
                row['Date'],
                ...categoryNames.map((cat) => row[cat] || 0),
                row['Total']
            ]);
        });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="outgoing-stats-${year}-${month}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    }
    catch (err) {
        console.error('Error exporting filtered outgoing stats:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Volunteer hours breakdown: dates from Shift.startTime, columns from ShiftCategory.name, dummy values for now
app.get('/api/volunteer-hours', authenticateToken, async (req, res) => {
    try {
        const { month, year } = req.query;
        const organizationId = req.user.organizationId;
        let startDate, endDate;
        if (!year) {
            return res.status(400).json({ error: 'Year is required' });
        }
        if (!month || parseInt(month) === 0) {
            startDate = new Date(parseInt(year), 0, 1);
            endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
        }
        else {
            startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
            endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
        }
        // Get all shift categories for this organization
        const categories = await prisma.shiftCategory.findMany({
            where: { organizationId },
            orderBy: { id: 'asc' },
            select: { id: true, name: true }
        });
        const categoryIdToName = {};
        categories.forEach((cat) => { categoryIdToName[cat.id] = cat.name; });
        const categoryNames = categories.map((c) => c.name);
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
        const shiftIdToShift = Object.fromEntries(shifts.map((s) => [s.id, s]));
        // Get all signups for these shifts
        const shiftIds = shifts.map((s) => s.id);
        const signups = await prisma.shiftSignup.findMany({
            where: { shiftId: { in: shiftIds } },
            select: { id: true, userId: true, shiftId: true, checkIn: true, checkOut: true }
        });
        // Group signups by date, category, and then by user
        const dateCategoryUserMap = {};
        for (const signup of signups) {
            const shift = shiftIdToShift[signup.shiftId];
            if (!shift)
                continue;
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
            if (!dateCategoryUserMap[date])
                dateCategoryUserMap[date] = {};
            if (!dateCategoryUserMap[date][catKey])
                dateCategoryUserMap[date][catKey] = {};
            if (!dateCategoryUserMap[date][catKey][signup.userId])
                dateCategoryUserMap[date][catKey][signup.userId] = [];
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
        const dateCategoryHours = {};
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
                        if (isNaN(hours) || hours < 0)
                            hours = 0;
                        if (hours < 1)
                            hours = 1;
                        if (hours > maxHours) {
                            maxHours = hours;
                        }
                        // Debug: print calculated hours for each entry
                        console.log(`Date: ${date}, Category: ${category}, User: ${userId}, CheckIn: ${checkIn}, CheckOut: ${checkOut}, Hours: ${hours}`);
                    }
                    totalCatHours += maxHours;
                }
                if (!dateCategoryHours[date])
                    dateCategoryHours[date] = {};
                dateCategoryHours[date][category] = (dateCategoryHours[date][category] || 0) + totalCatHours;
                // Debug: print total hours for this date/category
                console.log(`Date: ${date}, Category: ${category}, TotalCatHours: ${totalCatHours}`);
            }
        }
        // Prepare table data: one row per date, columns are categories
        const sortedDates = Object.keys(dateCategoryHours).sort();
        const tableData = sortedDates.map(date => {
            const row = { Date: date };
            let total = 0;
            categoryNames.forEach((cat) => {
                const val = dateCategoryHours[date][cat] || 0;
                row[cat] = Math.round(val * 100) / 100;
                total += val;
            });
            row['Total Hours'] = Math.round(total * 100) / 100;
            return row;
        });
        res.json({ columns: ['Date', ...categoryNames, 'Total Hours'], tableData });
    }
    catch (err) {
        console.error('Error fetching volunteer hours:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Export volunteer hours as Excel
app.get('/api/volunteer-hours/export', authenticateToken, async (req, res) => {
    try {
        const { month, year } = req.query;
        const organizationId = req.user.organizationId;
        let startDate, endDate;
        if (!year) {
            return res.status(400).json({ error: 'Year is required' });
        }
        if (!month || parseInt(month) === 0) {
            startDate = new Date(parseInt(year), 0, 1);
            endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
        }
        else {
            startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
            endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
        }
        // Get all shift categories for this organization
        const categories = await prisma.shiftCategory.findMany({
            where: { organizationId },
            orderBy: { id: 'asc' },
            select: { id: true, name: true }
        });
        const categoryIdToName = {};
        categories.forEach((cat) => { categoryIdToName[cat.id] = cat.name; });
        const categoryNames = categories.map((c) => c.name);
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
        const shiftIdToShift = Object.fromEntries(shifts.map((s) => [s.id, s]));
        // Get all signups for these shifts
        const shiftIds = shifts.map((s) => s.id);
        const signups = await prisma.shiftSignup.findMany({
            where: { shiftId: { in: shiftIds } },
            select: { id: true, userId: true, shiftId: true, checkIn: true, checkOut: true }
        });
        // Group signups by date, category, and then by user
        const dateCategoryUserMap = {};
        for (const signup of signups) {
            const shift = shiftIdToShift[signup.shiftId];
            if (!shift)
                continue;
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
            if (!dateCategoryUserMap[date])
                dateCategoryUserMap[date] = {};
            if (!dateCategoryUserMap[date][catKey])
                dateCategoryUserMap[date][catKey] = {};
            if (!dateCategoryUserMap[date][catKey][signup.userId])
                dateCategoryUserMap[date][catKey][signup.userId] = [];
            dateCategoryUserMap[date][catKey][signup.userId].push({ signup, shift, category, date });
        }
        // Build a map: date -> { categoryName -> totalHours }
        const dateCategoryHours = {};
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
                        if (isNaN(hours) || hours < 0)
                            hours = 0;
                        if (hours < 1)
                            hours = 1;
                        if (hours > maxHours) {
                            maxHours = hours;
                        }
                    }
                    totalCatHours += maxHours;
                }
                if (!dateCategoryHours[date])
                    dateCategoryHours[date] = {};
                dateCategoryHours[date][category] = (dateCategoryHours[date][category] || 0) + totalCatHours;
            }
        }
        // Prepare table data: one row per date, columns are categories
        const sortedDates = Object.keys(dateCategoryHours).sort();
        const tableData = sortedDates.map(date => {
            const row = { Date: date };
            let total = 0;
            categoryNames.forEach((cat) => {
                const val = dateCategoryHours[date][cat] || 0;
                row[cat] = Math.round(val * 100) / 100;
                total += val;
            });
            row['Total Hours'] = Math.round(total * 100) / 100;
            return row;
        });
        // Generate Excel file
        const workbook = new exceljs_1.default.Workbook();
        const worksheet = workbook.addWorksheet('Volunteer Hours');
        worksheet.addRow(['Date', ...categoryNames, 'Total Hours']);
        tableData.forEach((row) => {
            worksheet.addRow([
                row['Date'],
                ...categoryNames.map((cat) => row[cat] || 0),
                row['Total Hours']
            ]);
        });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="volunteer-hours-${year}-${month}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    }
    catch (err) {
        console.error('Error exporting volunteer hours:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Inventory by category: sum weightKg from DonationItem, group by DonationCategory.name
app.get('/api/inventory-categories', authenticateToken, async (req, res) => {
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
        const catIdToData = {};
        items.forEach((item) => {
            var _a, _b;
            if (!catIdToData[item.categoryId]) {
                catIdToData[item.categoryId] = { weight: 0, date: null };
            }
            catIdToData[item.categoryId].weight += item.weightKg;
            const itemDate = ((_a = item.Donation) === null || _a === void 0 ? void 0 : _a.createdAt) ? new Date(item.Donation.createdAt) : null;
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
                if (!catIdToData[item.categoryId].date || atlanticDateStr > ((_b = catIdToData[item.categoryId].date) !== null && _b !== void 0 ? _b : '')) {
                    catIdToData[item.categoryId].date = atlanticDateStr;
                }
            }
        });
        // Build result
        const result = categories
            .map((cat) => {
            var _a, _b;
            return ({
                name: cat.name,
                weight: ((_a = catIdToData[cat.id]) === null || _a === void 0 ? void 0 : _a.weight) || 0,
                date: ((_b = catIdToData[cat.id]) === null || _b === void 0 ? void 0 : _b.date) || null
            });
        })
            .filter((c) => c.weight > 0);
        res.json(result);
    }
    catch (err) {
        console.error('Error fetching inventory categories:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Inventory by category for a specific month/year: sum weightKg from DonationItem, group by DonationCategory.name
app.get('/api/inventory-categories/filtered', authenticateToken, async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const { month, year } = req.query;
        let startDate, endDate;
        if (!year) {
            return res.status(400).json({ error: 'Year is required' });
        }
        if (!month || month === 'all' || parseInt(month) === 0) {
            // All months: get the whole year
            startDate = new Date(parseInt(year), 0, 1);
            endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
        }
        else {
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
        const catIdToData = {};
        items.forEach((item) => {
            var _a, _b;
            if (!catIdToData[item.categoryId]) {
                catIdToData[item.categoryId] = { weight: 0, date: null };
            }
            catIdToData[item.categoryId].weight += item.weightKg;
            const itemDate = ((_a = item.Donation) === null || _a === void 0 ? void 0 : _a.createdAt) ? new Date(item.Donation.createdAt) : null;
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
                if (!catIdToData[item.categoryId].date || atlanticDateStr > ((_b = catIdToData[item.categoryId].date) !== null && _b !== void 0 ? _b : '')) {
                    catIdToData[item.categoryId].date = atlanticDateStr;
                }
            }
        });
        // Build result
        const result = categories
            .map((cat) => {
            var _a, _b;
            return ({
                name: cat.name,
                weight: ((_a = catIdToData[cat.id]) === null || _a === void 0 ? void 0 : _a.weight) || 0,
                date: ((_b = catIdToData[cat.id]) === null || _b === void 0 ? void 0 : _b.date) || null
            });
        })
            .filter((c) => c.weight > 0);
        res.json(result);
    }
    catch (err) {
        console.error('Error fetching filtered inventory categories:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Export inventory categories as Excel for dashboard (filtered by month/year/unit)
app.get('/api/inventory-categories/export-dashboard', authenticateToken, async (req, res) => {
    try {
        const { month, year, unit } = req.query;
        const organizationId = req.user.organizationId;
        let startDate, endDate;
        if (year) {
            if (!month || parseInt(month) === 0) {
                startDate = new Date(parseInt(year), 0, 1);
                endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
            }
            else {
                startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
                endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
            }
        }
        const categories = await prisma.donationCategory.findMany({
            where: { organizationId },
            select: { id: true, name: true }
        });
        const itemWhere = { Donation: { organizationId } };
        if (startDate && endDate) {
            itemWhere.Donation.createdAt = { gte: startDate, lte: endDate };
        }
        const items = await prisma.donationItem.findMany({
            where: itemWhere,
            select: { categoryId: true, weightKg: true }
        });
        const catIdToWeight = {};
        items.forEach((item) => {
            catIdToWeight[item.categoryId] = (catIdToWeight[item.categoryId] || 0) + item.weightKg;
        });
        const result = categories
            .map((cat) => ({ name: cat.name, weight: catIdToWeight[cat.id] || 0 }))
            .filter((c) => c.weight > 0);
        // Generate Excel file
        const workbook = new exceljs_1.default.Workbook();
        const worksheet = workbook.addWorksheet('Inventory');
        worksheet.addRow(['Category', `Weight (${unit === 'Pounds (lb)' ? 'lbs' : 'kg'})`]);
        result.forEach((row) => {
            const weight = unit === 'Pounds (lb)' ? Math.round(row.weight * 2.20462) : Math.round(row.weight);
            worksheet.addRow([row.name, weight]);
        });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="inventory-dashboard.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    }
    catch (err) {
        console.error('Error exporting inventory categories (dashboard):', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Export outgoing stats as Excel for dashboard
app.get('/api/outgoing-stats/export-dashboard', authenticateToken, async (req, res) => {
    try {
        const { month, year } = req.query;
        const organizationId = req.user.organizationId;
        let startDate, endDate;
        if (!year) {
            return res.status(400).json({ error: 'Year is required' });
        }
        if (!month || parseInt(month) === 0) {
            startDate = new Date(parseInt(year), 0, 1);
            endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
        }
        else {
            startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
            endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
        }
        // Get all shift categories for this organization
        const categories = await prisma.shiftCategory.findMany({
            where: { organizationId },
            orderBy: { id: 'asc' },
            select: { id: true, name: true }
        });
        const categoryIdToName = {};
        categories.forEach((cat) => { categoryIdToName[cat.id] = cat.name; });
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
        const shiftIdToDate = {};
        const shiftIdToCategory = {};
        const dateSet = new Set();
        shifts.forEach((shift) => {
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
        const shiftIds = shifts.map((s) => s.id);
        const signups = await prisma.shiftSignup.findMany({
            where: { shiftId: { in: shiftIds } },
            select: { shiftId: true, mealsServed: true }
        });
        // Build a map: date -> { categoryName -> totalMeals }
        const dateCategoryMeals = {};
        signups.forEach((signup) => {
            const shiftId = signup.shiftId;
            const date = shiftIdToDate[shiftId];
            const category = shiftIdToCategory[shiftId];
            if (!date || !category)
                return;
            if (!dateCategoryMeals[date])
                dateCategoryMeals[date] = {};
            dateCategoryMeals[date][category] = (dateCategoryMeals[date][category] || 0) + (signup.mealsServed || 0);
        });
        // Prepare table data: one row per date, columns are categories
        const sortedDates = Array.from(dateSet).sort();
        const categoryNames = categories.map((c) => c.name);
        // Generate Excel file
        const workbook = new exceljs_1.default.Workbook();
        const worksheet = workbook.addWorksheet('Outgoing Stats');
        worksheet.addRow(['Date', ...categoryNames]);
        sortedDates.forEach(date => {
            const row = [date, ...categoryNames.map(cat => { var _a; return ((_a = dateCategoryMeals[date]) === null || _a === void 0 ? void 0 : _a[cat]) || 0; })];
            worksheet.addRow(row);
        });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="outgoing-dashboard-${year}-${month}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    }
    catch (err) {
        console.error('Error exporting outgoing stats (dashboard):', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Export volunteer summary as Excel for dashboard
app.get('/api/volunteers/summary/export-dashboard', authenticateToken, async (req, res) => {
    try {
        const { month, year } = req.query;
        const organizationId = req.user.organizationId;
        let startDate, endDate;
        if (!year) {
            return res.status(400).json({ error: 'Year is required' });
        }
        if (!month || parseInt(month) === 0) {
            startDate = new Date(parseInt(year), 0, 1);
            endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
        }
        else {
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
        const userMap = {};
        for (const signup of signups) {
            const user = signup.User;
            if (!user)
                continue;
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
        const workbook = new exceljs_1.default.Workbook();
        const worksheet = workbook.addWorksheet('Volunteer Summary');
        worksheet.addRow(['Name', 'Role', 'Hours Worked']);
        result.forEach((row) => {
            worksheet.addRow([row.name, row.role, row.hours]);
        });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="volunteer-dashboard-${year}-${month}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    }
    catch (err) {
        console.error('Error exporting volunteer summary (dashboard):', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get dashboard summary data
app.get('/api/dashboard-summary', authenticateToken, async (req, res) => {
    try {
        const { month, year } = req.query;
        const organizationId = req.user.organizationId;
        // Get date range based on month/year
        let startDate, endDate;
        if (parseInt(month) === 0) {
            // All months: get the whole year
            startDate = new Date(parseInt(year), 0, 1);
            endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
        }
        else {
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
            totalWeight: donations.reduce((sum, d) => sum + (d.summary || 0), 0)
        };
        const outgoingStats = {
            totalMeals: shifts.reduce((sum, shift) => sum + shift.ShiftSignup.reduce((s, signup) => s + (signup.mealsServed || 0), 0), 0),
            totalShifts: shifts.length
        };
        const volunteerStats = {
            totalHours: volunteerHours.reduce((sum, v) => sum + (v.hoursWorked || 0), 0),
            totalVolunteers: new Set(volunteerHours.map((v) => v.userId)).size
        };
        const inventoryStats = {
            totalItems: inventory.length,
            totalWeight: inventory.reduce((sum, item) => sum + (item.weightKg || 0), 0)
        };
        res.json({
            incomingStats,
            outgoingStats,
            volunteerStats,
            inventoryStats
        });
    }
    catch (err) {
        console.error('Error fetching dashboard summary:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Volunteer summary endpoint
app.get('/api/volunteers/summary', authenticateToken, async (req, res) => {
    try {
        const { month, year } = req.query;
        const organizationId = req.user.organizationId;
        // Get date range based on month/year
        let startDate, endDate;
        if (parseInt(month) === 0) {
            // All months: get the whole year
            startDate = new Date(parseInt(year), 0, 1);
            endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
        }
        else {
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
        const userMap = {};
        for (const signup of signups) {
            const user = signup.User;
            if (!user)
                continue;
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
    }
    catch (err) {
        console.error('Error fetching volunteer summary:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get organization name by ID
app.get('/api/organization/:id', authenticateToken, async (req, res) => {
    try {
        const orgId = parseInt(req.params.id);
        if (!orgId)
            return res.status(400).json({ error: 'Invalid organization id' });
        const org = await prisma.organization.findUnique({ where: { id: orgId } });
        if (!org)
            return res.status(404).json({ error: 'Organization not found' });
        res.json({ name: org.name });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// --- User Management Endpoints ---
// Get all users
app.get('/api/users', authenticateToken, async (req, res) => {
    const reqAny = req;
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
                phone: true
            }
        });
        res.json(users);
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});
// Get user by id
app.get('/api/users/:id', authenticateToken, async (req, res) => {
    var _a;
    const reqAny = req;
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
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        res.json({
            id: user.id,
            name: user.firstName + ' ' + user.lastName,
            email: user.email,
            role: user.role,
            phone: user.phone,
            organizationName: ((_a = user.Organization) === null || _a === void 0 ? void 0 : _a.name) || 'Unknown Organization'
        });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});
// Edit user
app.put('/api/users/:id', authenticateToken, async (req, res) => {
    const reqAny = req;
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
        const updateData = {
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
    }
    catch (err) {
        console.error('Error updating user:', err);
        res.status(500).json({ error: 'Failed to update user' });
    }
});
// Update user password endpoint
app.put('/api/users/:id/password', authenticateToken, async (req, res) => {
    const reqAny = req;
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
        }
        else {
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
    }
    catch (err) {
        console.error('Error updating password:', err);
        res.status(500).json({ error: 'Failed to update password' });
    }
});
// Delete user
app.delete('/api/users/:id', authenticateToken, async (req, res) => {
    const reqAny = req;
    try {
        const organizationId = reqAny.user.organizationId;
        const user = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
        if (!user || user.organizationId !== organizationId) {
            return res.status(404).json({ error: 'User not found' });
        }
        // Manually delete related records
        await prisma.shiftSignup.deleteMany({ where: { userId: user.id } });
        // Add similar lines for other related tables if needed, e.g.:
        // await prisma.donation.deleteMany({ where: { userId: user.id } });
        // Now delete the user
        await prisma.user.delete({ where: { id: Number(req.params.id) } });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to delete user' });
    }
});
// Add user
app.post('/api/users', authenticateToken, async (req, res) => {
    const reqAny = req;
    try {
        const organizationId = reqAny.user.organizationId;
        const { firstName, lastName, email, phone, password, role } = req.body;
        // Log the incoming request data
        console.log('Adding user with data:', {
            firstName,
            lastName,
            email,
            phone,
            role,
            organizationId
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
        // Create user
        const user = await prisma.user.create({
            data: {
                firstName,
                lastName,
                email,
                phone,
                password: hashedPassword,
                role,
                organizationId,
                updatedAt: new Date()
            }
        });
        console.log('User created successfully:', user.id);
        // Fetch organization name
        const org = await prisma.organization.findUnique({ where: { id: organizationId } });
        // Send welcome email
        try {
            const transporter = nodemailer_1.default.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASS,
                },
            });
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: 'Welcome to Hungy!',
                text: `You have been added to Hungy under organization: ${(org === null || org === void 0 ? void 0 : org.name) || 'Unknown'}.
\nYour login details:\nUser ID: ${email}\nPassword: ${password}\nRole: ${role}\n\nPlease log in and change your password after first login.`,
            };
            await transporter.sendMail(mailOptions);
            console.log('Welcome email sent successfully to:', email);
        }
        catch (emailErr) {
            console.error('Failed to send welcome email:', emailErr);
            // Don't return error here as user was created successfully
        }
        res.json({
            id: user.id,
            name: user.firstName + ' ' + user.lastName,
            email: user.email,
            role: user.role
        });
    }
    catch (err) {
        console.error('Error adding user:', err);
        res.status(500).json({
            error: 'Failed to add user',
            details: err instanceof Error ? err.message : 'Unknown error'
        });
    }
});
// Get all organizations (for dropdown)
app.get('/api/organizations', authenticateToken, async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const organizations = await prisma.organization.findMany({
            where: { id: organizationId },
            select: {
                id: true,
                name: true,
                address: true,
                incoming_dollar_value: true
            }
        });
        res.json(organizations);
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch organizations' });
    }
});
// --- ShiftCategory CRUD Operations ---
// Create new shift category
app.post('/api/shift-categories', authenticateToken, async (req, res) => {
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
    }
    catch (err) {
        console.error('Error creating shift category:', err);
        res.status(500).json({ error: 'Failed to create shift category' });
    }
});
// Update shift category
app.put('/api/shift-categories/:id', authenticateToken, async (req, res) => {
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
    }
    catch (err) {
        console.error('Error updating shift category:', err);
        res.status(500).json({ error: 'Failed to update shift category' });
    }
});
// Delete shift category
app.delete('/api/shift-categories/:id', authenticateToken, async (req, res) => {
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
    }
    catch (err) {
        console.error('Error deleting shift category:', err);
        res.status(500).json({ error: 'Failed to delete shift category' });
    }
});
// --- RecurringShift CRUD Operations ---
// Get all recurring shifts for the organization
app.get('/api/recurring-shifts', authenticateToken, async (req, res) => {
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
    }
    catch (err) {
        console.error('Error fetching recurring shifts:', err);
        res.status(500).json({ error: 'Failed to fetch recurring shifts' });
    }
});
// Create new recurring shift
app.post('/api/recurring-shifts', authenticateToken, async (req, res) => {
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
        // Create recurring shift
        const shift = await prisma.recurringShift.create({
            data: {
                name,
                dayOfWeek,
                startTime: new Date(startTime),
                endTime: new Date(endTime),
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
    }
    catch (err) {
        console.error('Error creating recurring shift:', err);
        res.status(500).json({ error: 'Failed to create recurring shift' });
    }
});
// Update recurring shift
app.put('/api/recurring-shifts/:id', authenticateToken, async (req, res) => {
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
    }
    catch (err) {
        console.error('Error updating recurring shift:', err);
        res.status(500).json({ error: 'Failed to update recurring shift' });
    }
});
// Delete recurring shift
app.delete('/api/recurring-shifts/:id', authenticateToken, async (req, res) => {
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
    }
    catch (err) {
        console.error('Error deleting recurring shift:', err);
        res.status(500).json({ error: 'Failed to delete recurring shift' });
    }
});
// --- Shift CRUD Operations ---
// Get all shifts for the organization
app.get('/api/shifts', authenticateToken, async (req, res) => {
    const reqAny = req;
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
    }
    catch (err) {
        console.error('Error fetching shifts:', err);
        res.status(500).json({ error: 'Failed to fetch shifts' });
    }
});
// Get shift by id
app.get('/api/shifts/:id', authenticateToken, async (req, res) => {
    const reqAny = req;
    try {
        const organizationId = reqAny.user.organizationId;
        const id = parseInt(req.params.id);
        const shift = await prisma.shift.findFirst({
            where: { id, organizationId },
            include: { ShiftCategory: true }
        });
        if (!shift)
            return res.status(404).json({ error: 'Shift not found' });
        res.json(shift);
    }
    catch (err) {
        console.error('Error fetching shift:', err);
        res.status(500).json({ error: 'Failed to fetch shift' });
    }
});
// Create new shift
app.post('/api/shifts', authenticateToken, async (req, res) => {
    const reqAny = req;
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
    }
    catch (err) {
        console.error('Error creating shift:', err);
        res.status(500).json({ error: 'Failed to create shift' });
    }
});
// Update shift
app.put('/api/shifts/:id', authenticateToken, async (req, res) => {
    const reqAny = req;
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
    }
    catch (err) {
        console.error('Error updating shift:', err);
        res.status(500).json({ error: 'Failed to update shift' });
    }
});
// Delete shift
app.delete('/api/shifts/:id', authenticateToken, async (req, res) => {
    const reqAny = req;
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
    }
    catch (err) {
        console.error('Error deleting shift:', err);
        res.status(500).json({ error: 'Failed to delete shift' });
    }
});
// Schedule a shift for users based on recurring shift
app.post('/api/schedule-shift', authenticateToken, async (req, res) => {
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
        if (!rec)
            return res.status(404).json({ error: 'Recurring shift not found' });
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
    }
    catch (err) {
        console.error('Error scheduling shift:', err);
        res.status(500).json({ error: 'Failed to schedule shift' });
    }
});
// Create shift signup
app.post('/api/shiftsignups', authenticateToken, async (req, res) => {
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
        // Create the shift signup
        const signup = await prisma.shiftSignup.create({
            data: {
                userId: Number(userId),
                shiftId: Number(shiftId),
                checkIn: checkIn ? new Date(checkIn) : null,
                checkOut: checkOut ? new Date(checkOut) : null,
                mealsServed: mealsServed || 0
            },
            include: {
                User: true,
                Shift: true
            }
        });
        res.json(signup);
    }
    catch (err) {
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
                address: true
            }
        });
        res.json(organizations);
    }
    catch (err) {
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
                address: true
            }
        });
        if (!organization) {
            return res.status(404).json({ error: 'Organization not found' });
        }
        res.json(organization);
    }
    catch (err) {
        console.error('Error fetching organization:', err);
        res.status(500).json({ error: 'Failed to fetch organization' });
    }
});
// Create new organization
app.post('/api/organizations', authenticateToken, async (req, res) => {
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
                if (addresses.some((addr) => !addr || typeof addr !== 'string' || !addr.trim())) {
                    return res.status(400).json({ error: 'Invalid address format' });
                }
            }
            catch (err) {
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
                address
            },
            select: {
                id: true,
                name: true,
                address: true
            }
        });
        res.json(organization);
    }
    catch (err) {
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
        const { name, address, incoming_dollar_value } = req.body;
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
                if (addresses.some((addr) => !addr || typeof addr !== 'string' || !addr.trim())) {
                    return res.status(400).json({ error: 'Invalid address format' });
                }
            }
            catch (err) {
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
        const updateData = {
            name,
            address: address || existing.address
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
                incoming_dollar_value: true
            }
        });
        res.json(updatedOrganization);
    }
    catch (err) {
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
    }
    catch (err) {
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
    }
    catch (err) {
        console.error('Error fetching organization stats:', err);
        res.status(500).json({ error: 'Failed to fetch organization statistics' });
    }
});
// Update shift signup
app.put("/api/shiftsignups/:id", authenticateToken, async (req, res) => {
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
        }
        catch (updateError) {
            console.error("Prisma update error:", updateError);
            if (updateError.code === 'P2025') {
                return res.status(404).json({ error: "Shift signup not found" });
            }
            throw updateError;
        }
    }
    catch (err) {
        console.error("Error updating shift signup:", err);
        res.status(500).json({ error: "Failed to update shift signup" });
    }
});
// Delete shift signup
app.delete('/api/shiftsignups/:id', authenticateToken, async (req, res) => {
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
    }
    catch (err) {
        console.error('Error deleting shift signup:', err);
        res.status(500).json({ error: 'Failed to delete shift signup' });
    }
});
// Get all donors for the authenticated organization
app.get('/api/donors', authenticateToken, async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const donors = await prisma.donor.findMany({
            where: { kitchenId: organizationId },
            select: { id: true, name: true }
        });
        res.json(donors);
    }
    catch (err) {
        console.error('Error fetching donors:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Export inventory table (donor x category) as Excel
app.get('/api/inventory/export-table', authenticateToken, async (req, res) => {
    try {
        const { month, year, unit } = req.query;
        const organizationId = req.user.organizationId;
        // Convert month and year to numbers
        const monthNum = Number(month);
        const yearNum = Number(year);
        let startDate, endDate;
        if (!yearNum) {
            return res.status(400).json({ error: 'Year is required' });
        }
        if (!monthNum || monthNum === 0) {
            startDate = new Date(yearNum, 0, 1);
            endDate = new Date(yearNum, 11, 31, 23, 59, 59, 999);
        }
        else {
            startDate = new Date(yearNum, monthNum - 1, 1);
            endDate = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);
        }
        // Fetch donors
        const donors = await prisma.donor.findMany({
            where: { kitchenId: organizationId },
            select: { id: true, name: true }
        });
        // Find Walmart donorId
        const walmartDonor = donors.find(d => d.name.toLowerCase() === 'walmart');
        if (walmartDonor) {
            // Fetch all Donations for Walmart
            const walmartDonations = await prisma.donation.findMany({
                where: { donorId: walmartDonor.id, organizationId },
                select: { id: true, createdAt: true }
            });
            console.log('Walmart Donations:', walmartDonations);
            // Fetch all DonationItems for Walmart Donations
            const walmartDonationIds = walmartDonations.map(d => d.id);
            if (walmartDonationIds.length > 0) {
                const walmartItems = await prisma.donationItem.findMany({
                    where: { donationId: { in: walmartDonationIds } },
                    select: { id: true, donationId: true, categoryId: true, weightKg: true }
                });
                console.log('Walmart DonationItems:', walmartItems);
            }
            else {
                console.log('No Walmart Donations found.');
            }
        }
        else {
            console.log('No Walmart donor found.');
        }
        // Fetch categories
        const categories = await prisma.donationCategory.findMany({
            where: { organizationId },
            select: { id: true, name: true }
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
        // Debug log: print first 10 items and their donorId
        console.log('Sample donation items:', items.slice(0, 10).map(i => { var _a; return ({ categoryId: i.categoryId, weightKg: i.weightKg, donorId: (_a = i.Donation) === null || _a === void 0 ? void 0 : _a.donorId }); }));
        // Build donor x category table
        const donorIdToName = {};
        donors.forEach(d => { donorIdToName[d.id] = d.name; });
        const catIdToName = {};
        categories.forEach(c => { catIdToName[c.id] = c.name; });
        // Initialize table: donorName -> categoryName -> 0
        const table = {};
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
        // Prepare Excel data
        const workbook = new exceljs_1.default.Workbook();
        const worksheet = workbook.addWorksheet('Inventory');
        // Header row
        const headerRow = ['Donor', ...categories.map(c => c.name), 'Total'];
        worksheet.addRow(headerRow);
        // Data rows
        donors.forEach(donor => {
            const row = [donor.name];
            let donorTotal = 0;
            categories.forEach(cat => {
                let val = table[donor.name][cat.name] || 0;
                if (unit === 'Pounds (lb)')
                    val = +(val * 2.20462).toFixed(2);
                else
                    val = +val.toFixed(2);
                row.push(val);
                donorTotal += val;
            });
            row.push(+donorTotal.toFixed(2));
            worksheet.addRow(row);
        });
        // Total row
        const totalRow = ['Total'];
        let grandTotal = 0;
        categories.forEach(cat => {
            let catTotal = donors.reduce((sum, donor) => sum + (unit === 'Pounds (lb)'
                ? +(table[donor.name][cat.name] * 2.20462)
                : table[donor.name][cat.name]), 0);
            catTotal = +(catTotal.toFixed(2));
            totalRow.push(catTotal);
            grandTotal += catTotal;
        });
        totalRow.push(+grandTotal.toFixed(2));
        worksheet.addRow(totalRow);
        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="inventory-table-${year}-${month}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    }
    catch (err) {
        console.error('Error exporting inventory table:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Start server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
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
    }
    catch (err) {
        console.error('Error fetching shift signups:', err);
        res.status(500).json({ error: 'Failed to fetch shift signups' });
    }
});
// --- New endpoint: Get scheduled and unscheduled users for a shift ---
app.get('/api/shift-employees', authenticateToken, async (req, res) => {
    try {
        const reqAny = req;
        const { shiftId } = req.query;
        const organizationId = reqAny.user.organizationId;
        if (!shiftId)
            return res.status(400).json({ error: 'shiftId is required' });
        // Get the shift
        const shift = await prisma.shift.findFirst({
            where: { id: Number(shiftId), organizationId },
            include: { ShiftSignup: true }
        });
        if (!shift)
            return res.status(404).json({ error: 'Shift not found' });
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
    }
    catch (err) {
        console.error('Error in /api/shift-employees:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get inventory by donor and category for a specific month/year
app.get('/api/inventory/donor-category-table', authenticateToken, async (req, res) => {
    try {
        const { month, year, unit } = req.query;
        const organizationId = req.user.organizationId;
        // Convert month and year to numbers
        const monthNum = Number(month);
        const yearNum = Number(year);
        let startDate, endDate;
        if (!yearNum) {
            return res.status(400).json({ error: 'Year is required' });
        }
        if (!monthNum || monthNum === 0 || month === 'all') {
            startDate = new Date(yearNum, 0, 1);
            endDate = new Date(yearNum, 11, 31, 23, 59, 59, 999);
        }
        else {
            startDate = new Date(yearNum, monthNum - 1, 1);
            endDate = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);
        }
        // Fetch donors
        const donors = await prisma.donor.findMany({
            where: { kitchenId: organizationId },
            select: { id: true, name: true }
        });
        // Find Walmart donorId
        const walmartDonor = donors.find(d => d.name.toLowerCase() === 'walmart');
        if (walmartDonor) {
            // Fetch all Donations for Walmart
            const walmartDonations = await prisma.donation.findMany({
                where: { donorId: walmartDonor.id, organizationId },
                select: { id: true, createdAt: true }
            });
            console.log('Walmart Donations:', walmartDonations);
            // Fetch all DonationItems for Walmart Donations
            const walmartDonationIds = walmartDonations.map(d => d.id);
            if (walmartDonationIds.length > 0) {
                const walmartItems = await prisma.donationItem.findMany({
                    where: { donationId: { in: walmartDonationIds } },
                    select: { id: true, donationId: true, categoryId: true, weightKg: true }
                });
                console.log('Walmart DonationItems:', walmartItems);
            }
            else {
                console.log('No Walmart Donations found.');
            }
        }
        else {
            console.log('No Walmart donor found.');
        }
        // Fetch categories
        const categories = await prisma.donationCategory.findMany({
            where: { organizationId },
            select: { id: true, name: true }
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
        const donorIdToName = {};
        donors.forEach(d => { donorIdToName[d.id] = d.name; });
        const catIdToName = {};
        categories.forEach(c => { catIdToName[c.id] = c.name; });
        // Initialize table: donorName -> categoryName -> 0
        const table = {};
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
                let val = item.weightKg;
                if (unit === 'Pounds (lb)')
                    val = +(val * 2.20462);
                table[donorName][catName] += val;
            }
        });
        res.json({
            donors: donors.map(d => d.name),
            categories: categories.map(c => c.name),
            table
        });
    }
    catch (err) {
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
            const transporter = nodemailer_1.default.createTransport({
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
        }
        catch (emailErr) {
            console.error('Failed to send email:', emailErr);
            res.status(500).json({ error: 'Failed to send reset code. Please try again.' });
        }
    }
    catch (err) {
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
        const resetToken = jsonwebtoken_1.default.sign({ email, type: 'password_reset' }, JWT_SECRET, { expiresIn: '15m' });
        // Clear OTP after successful verification
        delete global.otpStore[email];
        res.json({
            message: 'OTP verified successfully',
            resetToken
        });
    }
    catch (err) {
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
        let decoded;
        try {
            decoded = jsonwebtoken_1.default.verify(resetToken, JWT_SECRET);
        }
        catch (err) {
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
    }
    catch (err) {
        console.error('Error resetting password:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// --- Weighing Management Endpoints ---
// Get all weighing categories for the organization
app.get('/api/weighing-categories', authenticateToken, async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const categories = await prisma.weighingCategory.findMany({
            where: { organizationId },
            select: {
                id: true,
                category: true,
                kilogram_kg_: true,
                pound_lb_: true,
                noofmeals: true
            }
        });
        res.json(categories);
    }
    catch (err) {
        console.error('Error fetching weighing categories:', err);
        res.status(500).json({ error: 'Failed to fetch weighing categories' });
    }
});
// Create new weighing category
app.post('/api/weighing-categories', authenticateToken, async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const { category, weight, unit, noofmeals } = req.body;
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
        let finalKilogram;
        let finalPound;
        if (unit === 'kg') {
            finalKilogram = weight;
            finalPound = weight * 2.20462;
        }
        else {
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
                noofmeals: noofmeals || 0,
                organizationId
            },
            select: {
                id: true,
                category: true,
                kilogram_kg_: true,
                pound_lb_: true,
                noofmeals: true
            }
        });
        res.json(weighingCategory);
    }
    catch (err) {
        console.error('Error creating weighing category:', err);
        res.status(500).json({ error: 'Failed to create weighing category' });
    }
});
// Get all weighing records for the organization
app.get('/api/weighing', authenticateToken, async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const weighings = await prisma.weighingCategory.findMany({
            where: { organizationId },
            select: {
                id: true,
                category: true,
                kilogram_kg_: true,
                pound_lb_: true,
                noofmeals: true
            },
            orderBy: {
                id: 'desc'
            }
        });
        res.json(weighings);
    }
    catch (err) {
        console.error('Error fetching weighing records:', err);
        res.status(500).json({ error: 'Failed to fetch weighing records' });
    }
});
// Create new weighing record
app.post('/api/weighing', authenticateToken, async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const { category, weight, unit, noofmeals } = req.body;
        if (!category || !weight || weight <= 0) {
            return res.status(400).json({ error: 'Category and valid weight value are required' });
        }
        if (!unit || !['kg', 'lb'].includes(unit)) {
            return res.status(400).json({ error: 'Unit must be either "kg" or "lb"' });
        }
        // Calculate both kg and lb values
        let finalKilogram;
        let finalPound;
        if (unit === 'kg') {
            finalKilogram = weight;
            finalPound = weight * 2.20462;
        }
        else {
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
                noofmeals: noofmeals || 0,
                organizationId
            },
            select: {
                id: true,
                category: true,
                kilogram_kg_: true,
                pound_lb_: true,
                noofmeals: true
            }
        });
        res.json(weighing);
    }
    catch (err) {
        console.error('Error creating weighing record:', err);
        res.status(500).json({ error: 'Failed to create weighing record' });
    }
});
// Update weighing record
app.put('/api/weighing/:id', authenticateToken, async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const weighingId = parseInt(req.params.id);
        const { category, weight, unit, noofmeals } = req.body;
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
        let finalKilogram;
        let finalPound;
        if (unit === 'kg') {
            finalKilogram = weight;
            finalPound = weight * 2.20462;
        }
        else {
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
                pound_lb_: finalPound,
                noofmeals: noofmeals || 0
            },
            select: {
                id: true,
                category: true,
                kilogram_kg_: true,
                pound_lb_: true,
                noofmeals: true
            }
        });
        res.json(updatedWeighing);
    }
    catch (err) {
        console.error('Error updating weighing record:', err);
        res.status(500).json({ error: 'Failed to update weighing record' });
    }
});
// Delete weighing record
app.delete('/api/weighing/:id', authenticateToken, async (req, res) => {
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
    }
    catch (err) {
        console.error('Error deleting weighing record:', err);
        res.status(500).json({ error: 'Failed to delete weighing record' });
    }
});
// Get weighing statistics for the organization
app.get('/api/weighing/stats', authenticateToken, async (req, res) => {
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
                pound_lb_: true,
                noofmeals: true
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
                pound_lb_: true,
                noofmeals: true
            }
        });
        const categoryStats = categoryTotals.map((total) => {
            return {
                categoryName: total.category,
                totalKilogram: total._sum.kilogram_kg_ || 0,
                totalPound: total._sum.pound_lb_ || 0,
                totalMeals: total._sum.noofmeals || 0
            };
        });
        res.json({
            totalWeighings,
            totalCategories: categoryStats.length,
            recentWeighings,
            categoryStats
        });
    }
    catch (err) {
        console.error('Error fetching weighing statistics:', err);
        res.status(500).json({ error: 'Failed to fetch weighing statistics' });
    }
});
