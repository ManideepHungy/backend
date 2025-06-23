const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function debugAPI() {
  console.log('🔍 Debugging Inventory API...\n');

  const organizationId = 1; // Community Food Bank
  const year = 2025;
  const month = 6; // June

  console.log(`📅 Looking for data in: ${month}/${year}\n`);

  // Check what the API logic does
  let startDate, endDate;
  if (!month || month === 'all' || parseInt(month) === 0) {
    startDate = new Date(parseInt(year), 0, 1);
    endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
  } else {
    startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
    endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
  }

  console.log(`📅 Date range: ${startDate.toISOString()} to ${endDate.toISOString()}\n`);

  // Get all categories for this org
  const categories = await prisma.donationCategory.findMany({
    where: { organizationId },
    select: { id: true, name: true }
  });

  console.log('📋 Categories found:');
  categories.forEach(cat => {
    console.log(`  - ${cat.name} (ID: ${cat.id})`);
  });

  // Get all donation items for this org and date range
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
    select: { 
      categoryId: true, 
      weightKg: true, 
      Donation: { 
        select: { 
          createdAt: true,
          id: true
        } 
      } 
    }
  });

  console.log(`\n📦 Items found in date range: ${items.length}`);
  items.forEach(item => {
    console.log(`  - Category ID: ${item.categoryId}, Weight: ${item.weightKg}kg, Date: ${item.Donation.createdAt.toISOString()}, Donation ID: ${item.Donation.id}`);
  });

  // Check all donations in the date range
  const donations = await prisma.donation.findMany({
    where: {
      organizationId,
      createdAt: {
        gte: startDate,
        lte: endDate
      }
    },
    select: {
      id: true,
      createdAt: true,
      summary: true
    }
  });

  console.log(`\n💰 Donations found in date range: ${donations.length}`);
  donations.forEach(d => {
    console.log(`  - ID: ${d.id}, Date: ${d.createdAt.toISOString()}, Summary: ${d.summary}`);
  });

  await prisma.$disconnect();
}

debugAPI().catch(console.error); 