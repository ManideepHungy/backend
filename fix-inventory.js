const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function fixInventory() {
  console.log('🔧 Fixing Inventory Snapshot...\n');

  // Find the June 2025 donation
  const donation = await prisma.donation.findFirst({
    where: {
      createdAt: {
        gte: new Date('2025-06-01'),
        lte: new Date('2025-06-30')
      }
    },
    select: { id: true, organizationId: true }
  });

  if (!donation) {
    console.log('❌ No June 2025 donation found');
    return;
  }

  console.log(`📦 Found donation ID: ${donation.id}`);

  // Get categories for this organization
  const categories = await prisma.donationCategory.findMany({
    where: { organizationId: donation.organizationId },
    select: { id: true, name: true }
  });

  console.log('📋 Available categories:');
  categories.forEach(cat => {
    console.log(`  - ${cat.name} (ID: ${cat.id})`);
  });

  // Add donation items to the June 2025 donation
  const itemsToAdd = [
    { categoryId: categories[0].id, weightKg: 15.5 }, // Fresh Produce
    { categoryId: categories[1].id, weightKg: 8.2 },  // Dairy Products
    { categoryId: categories[2].id, weightKg: 12.8 }, // Bread & Bakery
    { categoryId: categories[3].id, weightKg: 6.5 },  // Canned Goods
    { categoryId: categories[4].id, weightKg: 9.3 }   // Frozen Foods
  ];

  console.log('\n➕ Adding donation items...');
  
  for (const item of itemsToAdd) {
    const category = categories.find(c => c.id === item.categoryId);
    const newItem = await prisma.donationItem.create({
      data: {
        donationId: donation.id,
        categoryId: item.categoryId,
        weightKg: item.weightKg
      }
    });
    console.log(`  ✅ Added ${item.weightKg}kg of ${category.name} (ID: ${newItem.id})`);
  }

  // Verify the fix
  const totalItems = await prisma.donationItem.count({
    where: { donationId: donation.id }
  });

  console.log(`\n✅ Fixed! Donation ${donation.id} now has ${totalItems} items`);
  console.log('🎉 Inventory Snapshot should now show data for June 2025');

  await prisma.$disconnect();
}

fixInventory().catch(console.error); 