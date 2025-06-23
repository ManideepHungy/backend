const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkDates() {
  console.log('🔍 Checking dates in database...\n');

  // Check donations
  const donations = await prisma.donation.findMany({
    select: {
      id: true,
      createdAt: true,
      summary: true
    }
  });

  console.log('📅 Donations:');
  donations.forEach(d => {
    console.log(`  ID ${d.id}: ${d.createdAt.toISOString()} (${d.summary})`);
  });

  // Check shifts
  const shifts = await prisma.shift.findMany({
    select: {
      id: true,
      name: true,
      startTime: true
    }
  });

  console.log('\n📅 Shifts:');
  shifts.forEach(s => {
    console.log(`  ID ${s.id}: ${s.startTime.toISOString()} (${s.name})`);
  });

  // Check donation items
  const items = await prisma.donationItem.findMany({
    select: {
      id: true,
      weightKg: true,
      Donation: {
        select: {
          createdAt: true
        }
      }
    }
  });

  console.log('\n📅 Donation Items:');
  items.forEach(item => {
    console.log(`  ID ${item.id}: ${item.Donation.createdAt.toISOString()} (${item.weightKg}kg)`);
  });

  // Check current date
  const now = new Date();
  console.log(`\n📅 Current date: ${now.toISOString()}`);
  console.log(`📅 Current year: ${now.getFullYear()}`);
  console.log(`📅 Current month: ${now.getMonth() + 1}`);

  await prisma.$disconnect();
}

checkDates().catch(console.error); 