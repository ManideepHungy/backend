const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Create Organizations
  console.log('Creating organizations...');
  const organization1 = await prisma.organization.create({
    data: {
      name: 'Community Food Bank',
      address: '123 Main Street, Downtown, CA 90210',
      incoming_dollar_value: 12.50,
      email: 'info@communityfoodbank.org'
    }
  });

  const organization2 = await prisma.organization.create({
    data: {
      name: 'Hope Kitchen',
      address: '456 Oak Avenue, Westside, CA 90211',
      incoming_dollar_value: 15.00,
      email: 'info@hopekitchen.org'
    }
  });

  console.log('✅ Organizations created');

  // Create Users
  console.log('Creating users...');
  const hashedPassword = await bcrypt.hash('password123', 10);

  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@communityfoodbank.org',
      phone: '555-0101',
      password: hashedPassword,
      firstName: 'Sarah',
      lastName: 'Johnson',
      organizationId: organization1.id,
      role: 'ADMIN',
      updatedAt: new Date()
    }
  });

  const staffUser = await prisma.user.create({
    data: {
      email: 'staff@communityfoodbank.org',
      phone: '555-0102',
      password: hashedPassword,
      firstName: 'Michael',
      lastName: 'Chen',
      organizationId: organization1.id,
      role: 'STAFF',
      updatedAt: new Date()
    }
  });

  const volunteer1 = await prisma.user.create({
    data: {
      email: 'volunteer1@communityfoodbank.org',
      phone: '555-0103',
      password: hashedPassword,
      firstName: 'Emily',
      lastName: 'Davis',
      organizationId: organization1.id,
      role: 'VOLUNTEER',
      updatedAt: new Date()
    }
  });

  const volunteer2 = await prisma.user.create({
    data: {
      email: 'volunteer2@communityfoodbank.org',
      phone: '555-0104',
      password: hashedPassword,
      firstName: 'David',
      lastName: 'Wilson',
      organizationId: organization1.id,
      role: 'VOLUNTEER',
      // Add some profile fields for testing
      ageBracket: 'AGE_30_39',
      pronouns: 'HE_HIM',
      address: '456 Oak Street, Downtown, CA 90210',
      city: 'Downtown',
      postalCode: '90210',
      emergencyContactName: 'Sarah Wilson',
      emergencyContactNumber: '555-0105',
      allergies: 'None',
      preferredDays: 'Weekends',
      frequency: 'WEEKLY',
      canCallIfShortHanded: true,
      updatedAt: new Date()
    }
  });

  const hopeKitchenAdmin = await prisma.user.create({
    data: {
      email: 'admin@hopekitchen.org',
      phone: '555-0201',
      password: hashedPassword,
      firstName: 'Lisa',
      lastName: 'Martinez',
      organizationId: organization2.id,
      role: 'ADMIN',
      updatedAt: new Date()
    }
  });

  // Add a youth volunteer for testing
  const youthVolunteer = await prisma.user.create({
    data: {
      email: 'youth@communityfoodbank.org',
      phone: '555-0106',
      password: hashedPassword,
      firstName: 'Alex',
      lastName: 'Thompson',
      organizationId: organization1.id,
      role: 'VOLUNTEER',
      // Youth volunteer specific fields
      ageBracket: 'UNDER_16',
      pronouns: 'THEY_THEM',
      registrationType: 'MINOR',
      parentGuardianName: 'Jennifer Thompson',
      parentGuardianEmail: 'jennifer.thompson@email.com',
      emergencyContactName: 'Jennifer Thompson',
      emergencyContactNumber: '555-0107',
      schoolWorkCommitment: true,
      requiredHours: 20,
      howDidYouHear: 'SCHOOL',
      updatedAt: new Date()
    }
  });

  console.log('✅ Users created');

  // Create Donors
  console.log('Creating donors...');
  const donor1 = await prisma.donor.create({
    data: {
      donorType: 'Business',
      email: 'contact@freshmarket.com',
      organizationName: 'Fresh Market Grocery',
      phoneNumber: '555-1001',
      kitchenId: organization1.id
    }
  });

  const donor2 = await prisma.donor.create({
    data: {
      donorType: 'Farm',
      email: 'info@localfarmcoop.com',
      organizationName: 'Local Farm Co-op',
      phoneNumber: '555-1002',
      kitchenId: organization1.id
    }
  });

  const donor3 = await prisma.donor.create({
    data: {
      donorType: 'Business',
      email: 'orders@citybakery.com',
      organizationName: 'City Bakery',
      phoneNumber: '555-1003',
      kitchenId: organization1.id
    }
  });

  const donor4 = await prisma.donor.create({
    data: {
      donorType: 'Community',
      email: 'volunteers@communitygarden.org',
      organizationName: 'Community Garden',
      phoneNumber: '555-1004',
      kitchenId: organization2.id
    }
  });

  console.log('✅ Donors created');

  // Create Donation Locations
  console.log('Creating donation locations...');
  const donationLocation1 = await prisma.donationLocation.create({
    data: {
      name: 'Main Kitchen',
      location: '123 Main Street, Downtown, CA 90210',
      contactInfo: 'kitchen@communityfoodbank.org',
      kitchenId: organization1.id
    }
  });

  const donationLocation2 = await prisma.donationLocation.create({
    data: {
      name: 'Distribution Center',
      location: '456 Oak Avenue, Westside, CA 90211',
      contactInfo: 'distribution@communityfoodbank.org',
      kitchenId: organization1.id
    }
  });

  const donationLocation3 = await prisma.donationLocation.create({
    data: {
      name: 'Hope Kitchen Location',
      location: '789 Hope Street, Westside, CA 90211',
      contactInfo: 'info@hopekitchen.org',
      kitchenId: organization2.id
    }
  });

  console.log('✅ Donation locations created');

  // Create Donation Categories
  console.log('Creating donation categories...');
  const produceCategory = await prisma.donationCategory.create({
    data: {
      name: 'Fresh Produce',
      icon: '🥬',
      organizationId: organization1.id
    }
  });

  const dairyCategory = await prisma.donationCategory.create({
    data: {
      name: 'Dairy Products',
      icon: '🥛',
      organizationId: organization1.id
    }
  });

  const breadCategory = await prisma.donationCategory.create({
    data: {
      name: 'Bread & Bakery',
      icon: '🍞',
      organizationId: organization1.id
    }
  });

  const cannedCategory = await prisma.donationCategory.create({
    data: {
      name: 'Canned Goods',
      icon: '🥫',
      organizationId: organization1.id
    }
  });

  const frozenCategory = await prisma.donationCategory.create({
    data: {
      name: 'Frozen Foods',
      icon: '🧊',
      organizationId: organization1.id
    }
  });

  const hopeProduceCategory = await prisma.donationCategory.create({
    data: {
      name: 'Fresh Produce',
      icon: '🥬',
      organizationId: organization2.id
    }
  });

  console.log('✅ Donation categories created');

  // Create Shift Categories
  console.log('Creating shift categories...');
  const morningShift = await prisma.shiftCategory.create({
    data: {
      name: 'Morning Shift',
      icon: '🌅',
      organizationId: organization1.id
    }
  });

  const afternoonShift = await prisma.shiftCategory.create({
    data: {
      name: 'Afternoon Shift',
      icon: '☀️',
      organizationId: organization1.id
    }
  });

  const eveningShift = await prisma.shiftCategory.create({
    data: {
      name: 'Evening Shift',
      icon: '🌆',
      organizationId: organization1.id
    }
  });

  const weekendShift = await prisma.shiftCategory.create({
    data: {
      name: 'Weekend Shift',
      icon: '📅',
      organizationId: organization1.id
    }
  });

  const hopeMorningShift = await prisma.shiftCategory.create({
    data: {
      name: 'Morning Shift',
      icon: '🌅',
      organizationId: organization2.id
    }
  });

  console.log('✅ Shift categories created');

  // Create Recurring Shifts
  console.log('Creating recurring shifts...');
  const recurringShift1 = await prisma.recurringShift.create({
    data: {
      name: 'Monday Morning Food Sorting',
      dayOfWeek: 1, // Monday
      startTime: new Date('2024-01-01T08:00:00Z'),
      endTime: new Date('2024-01-01T12:00:00Z'),
      shiftCategoryId: morningShift.id,
      location: 'Main Kitchen - Sorting Area',
      slots: 4,
      organizationId: organization1.id
    }
  });

  const recurringShift2 = await prisma.recurringShift.create({
    data: {
      name: 'Wednesday Afternoon Distribution',
      dayOfWeek: 3, // Wednesday
      startTime: new Date('2024-01-01T13:00:00Z'),
      endTime: new Date('2024-01-01T17:00:00Z'),
      shiftCategoryId: afternoonShift.id,
      location: 'Distribution Center',
      slots: 6,
      organizationId: organization1.id
    }
  });

  const recurringShift3 = await prisma.recurringShift.create({
    data: {
      name: 'Friday Evening Meal Prep',
      dayOfWeek: 5, // Friday
      startTime: new Date('2024-01-01T16:00:00Z'),
      endTime: new Date('2024-01-01T20:00:00Z'),
      shiftCategoryId: eveningShift.id,
      location: 'Main Kitchen - Prep Area',
      slots: 3,
      organizationId: organization1.id
    }
  });

  console.log('✅ Recurring shifts created');

  // Create Shifts
  console.log('Creating shifts...');
  const shift1 = await prisma.shift.create({
    data: {
      name: 'Food Sorting - June 15',
      shiftCategoryId: morningShift.id,
      startTime: new Date('2024-06-15T08:00:00Z'),
      endTime: new Date('2024-06-15T12:00:00Z'),
      location: 'Main Kitchen - Sorting Area',
      slots: 4,
      organizationId: organization1.id
    }
  });

  const shift2 = await prisma.shift.create({
    data: {
      name: 'Distribution - June 16',
      shiftCategoryId: afternoonShift.id,
      startTime: new Date('2024-06-16T13:00:00Z'),
      endTime: new Date('2024-06-16T17:00:00Z'),
      location: 'Distribution Center',
      slots: 6,
      organizationId: organization1.id
    }
  });

  const shift3 = await prisma.shift.create({
    data: {
      name: 'Meal Prep - June 17',
      shiftCategoryId: eveningShift.id,
      startTime: new Date('2024-06-17T16:00:00Z'),
      endTime: new Date('2024-06-17T20:00:00Z'),
      location: 'Main Kitchen - Prep Area',
      slots: 3,
      organizationId: organization1.id
    }
  });

  const shift4 = await prisma.shift.create({
    data: {
      name: 'Weekend Distribution - June 22',
      shiftCategoryId: weekendShift.id,
      startTime: new Date('2024-06-22T09:00:00Z'),
      endTime: new Date('2024-06-22T13:00:00Z'),
      location: 'Community Center',
      slots: 5,
      organizationId: organization1.id
    }
  });

  console.log('✅ Shifts created');

  // Create Shift Registration Fields
  console.log('Creating shift registration fields...');
  
  // For recurringShift1 - Basic fields only (default)
  await prisma.shiftRegistrationFields.create({
    data: {
      recurringShiftId: recurringShift1.id,
      requireFirstName: true,
      requireLastName: true,
      requireEmail: true,
      // All other fields default to false
    }
  });

  // For recurringShift2 - Include some additional fields
  await prisma.shiftRegistrationFields.create({
    data: {
      recurringShiftId: recurringShift2.id,
      requireFirstName: true,
      requireLastName: true,
      requireEmail: true,
      requirePhone: true,
      requireAgeBracket: true,
      requirePronouns: true,
      requireEmergencyContactName: true,
      requireEmergencyContactNumber: true,
    }
  });

  // For recurringShift3 - Include more comprehensive fields
  await prisma.shiftRegistrationFields.create({
    data: {
      recurringShiftId: recurringShift3.id,
      requireFirstName: true,
      requireLastName: true,
      requireEmail: true,
      requirePhone: true,
      requireAddress: true,
      requireCity: true,
      requirePostalCode: true,
      requireAgeBracket: true,
      requireBirthdate: true,
      requirePronouns: true,
      requireEmergencyContactName: true,
      requireEmergencyContactNumber: true,
      requireAllergies: true,
      requireMedicalConcerns: true,
      requirePreferredDays: true,
      requirePreferredShifts: true,
      requireFrequency: true,
      requireCanCallIfShortHanded: true,
      requireHowDidYouHear: true,
    }
  });

  // Create a fourth recurring shift for youth volunteer focused fields
  const recurringShift4 = await prisma.recurringShift.create({
    data: {
      name: 'Youth Volunteer Program',
      dayOfWeek: 6, // Saturday
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T14:00:00Z'),
      shiftCategoryId: weekendShift.id,
      location: 'Youth Center',
      slots: 8,
      organizationId: organization1.id
    }
  });

  // For recurringShift4 - Youth volunteer focused fields
  await prisma.shiftRegistrationFields.create({
    data: {
      recurringShiftId: recurringShift4.id,
      requireFirstName: true,
      requireLastName: true,
      requireEmail: true,
      requirePhone: true,
      requireAgeBracket: true,
      requireBirthdate: true,
      requirePronouns: true,
      requireParentGuardianName: true,
      requireParentGuardianEmail: true,
      requireEmergencyContactName: true,
      requireEmergencyContactNumber: true,
      requireSchoolWorkCommitment: true,
      requireRequiredHours: true,
    }
  });

  console.log('✅ Shift registration fields created');

  // Create Shift Signups
  console.log('Creating shift signups...');
  const signup1 = await prisma.shiftSignup.create({
    data: {
      userId: volunteer1.id,
      shiftId: shift1.id,
      checkIn: new Date('2024-06-15T08:05:00Z'),
      checkOut: new Date('2024-06-15T11:55:00Z'),
      mealsServed: 45,
      createdAt: new Date('2024-06-14T10:00:00Z')
    }
  });

  const signup2 = await prisma.shiftSignup.create({
    data: {
      userId: volunteer2.id,
      shiftId: shift1.id,
      checkIn: new Date('2024-06-15T08:00:00Z'),
      checkOut: new Date('2024-06-15T12:00:00Z'),
      mealsServed: 52,
      createdAt: new Date('2024-06-14T14:30:00Z')
    }
  });

  const signup3 = await prisma.shiftSignup.create({
    data: {
      userId: volunteer1.id,
      shiftId: shift2.id,
      checkIn: new Date('2024-06-16T13:10:00Z'),
      checkOut: new Date('2024-06-16T16:45:00Z'),
      mealsServed: 78,
      createdAt: new Date('2024-06-15T09:00:00Z')
    }
  });

  const signup4 = await prisma.shiftSignup.create({
    data: {
      userId: staffUser.id,
      shiftId: shift3.id,
      checkIn: new Date('2024-06-17T16:00:00Z'),
      checkOut: new Date('2024-06-17T19:30:00Z'),
      mealsServed: 35,
      createdAt: new Date('2024-06-16T11:00:00Z')
    }
  });

  console.log('✅ Shift signups created');

  // Create Donations
  console.log('Creating donations...');
  const donation1 = await prisma.donation.create({
    data: {
      shiftId: shift1.id,
      organizationId: organization1.id,
      donorId: donor1.id,
      shiftSignupId: signup1.id,
      summary: 125.50,
      donationLocationId: donationLocation1.id,
      createdAt: new Date('2024-06-15T10:30:00Z')
    }
  });

  const donation2 = await prisma.donation.create({
    data: {
      shiftId: shift1.id,
      organizationId: organization1.id,
      donorId: donor2.id,
      shiftSignupId: signup2.id,
      summary: 89.75,
      donationLocationId: donationLocation1.id,
      createdAt: new Date('2024-06-15T11:15:00Z')
    }
  });

  const donation3 = await prisma.donation.create({
    data: {
      shiftId: shift2.id,
      organizationId: organization1.id,
      donorId: donor3.id,
      shiftSignupId: signup3.id,
      summary: 156.25,
      donationLocationId: donationLocation2.id,
      createdAt: new Date('2024-06-16T14:45:00Z')
    }
  });

  const donation4 = await prisma.donation.create({
    data: {
      shiftId: shift3.id,
      organizationId: organization1.id,
      donorId: donor1.id,
      shiftSignupId: signup4.id,
      summary: 67.80,
      donationLocationId: donationLocation1.id,
      createdAt: new Date('2024-06-17T17:30:00Z')
    }
  });

  console.log('✅ Donations created');

  // Create Donation Items
  console.log('Creating donation items...');
  await prisma.donationItem.create({
    data: {
      donationId: donation1.id,
      categoryId: produceCategory.id,
      weightKg: 25.5
    }
  });

  await prisma.donationItem.create({
    data: {
      donationId: donation1.id,
      categoryId: dairyCategory.id,
      weightKg: 15.2
    }
  });

  await prisma.donationItem.create({
    data: {
      donationId: donation2.id,
      categoryId: produceCategory.id,
      weightKg: 18.7
    }
  });

  await prisma.donationItem.create({
    data: {
      donationId: donation2.id,
      categoryId: cannedCategory.id,
      weightKg: 12.3
    }
  });

  await prisma.donationItem.create({
    data: {
      donationId: donation3.id,
      categoryId: breadCategory.id,
      weightKg: 8.9
    }
  });

  await prisma.donationItem.create({
    data: {
      donationId: donation3.id,
      categoryId: dairyCategory.id,
      weightKg: 22.1
    }
  });

  await prisma.donationItem.create({
    data: {
      donationId: donation4.id,
      categoryId: frozenCategory.id,
      weightKg: 14.6
    }
  });

  await prisma.donationItem.create({
    data: {
      donationId: donation4.id,
      categoryId: produceCategory.id,
      weightKg: 9.8
    }
  });

  console.log('✅ Donation items created');

  // Create Weighing Categories
  console.log('Creating weighing categories...');
  const weighingCategory1 = await prisma.weighingCategory.create({
    data: {
      organizationId: organization1.id,
      kilogram_kg_: 1.0,
      pound_lb_: 2.20462,
      category: 'Backpack'
    }
  });

  const weighingCategory2 = await prisma.weighingCategory.create({
    data: {
      organizationId: organization1.id,
      kilogram_kg_: 2.5,
      pound_lb_: 5.51155,
      category: 'Family Box'
    }
  });

  const weighingCategory3 = await prisma.weighingCategory.create({
    data: {
      organizationId: organization1.id,
      kilogram_kg_: 0.5,
      pound_lb_: 1.10231,
      category: 'Individual Meal'
    }
  });

  const weighingCategory4 = await prisma.weighingCategory.create({
    data: {
      organizationId: organization1.id,
      kilogram_kg_: 5.0,
      pound_lb_: 11.0231,
      category: 'Large Family Pack'
    }
  });

  const weighingCategory5 = await prisma.weighingCategory.create({
    data: {
      organizationId: organization1.id,
      kilogram_kg_: 3.0,
      pound_lb_: 6.61386,
      category: 'Senior Box'
    }
  });

  const hopeWeighingCategory1 = await prisma.weighingCategory.create({
    data: {
      organizationId: organization2.id,
      kilogram_kg_: 1.5,
      pound_lb_: 3.30693,
      category: 'Emergency Pack'
    }
  });

  console.log('✅ Weighing categories created');

  // Create Modules for role-based permissions
  console.log('Creating modules...');
  const donationManagementModule = await prisma.module.create({
    data: {
      name: 'Donation Management',
      description: 'Manage donations, categories, and inventory',
      organizationId: organization1.id
    }
  });

  const volunteerMealCountingModule = await prisma.module.create({
    data: {
      name: 'Volunteer Meal Counting',
      description: 'Count meals served by volunteers during shifts',
      organizationId: organization1.id
    }
  });

  const volunteerShiftManagementModule = await prisma.module.create({
    data: {
      name: 'Volunteer Shift Management',
      description: 'Manage volunteer shifts and signups',
      organizationId: organization1.id
    }
  });

  const adminMealCountingModule = await prisma.module.create({
    data: {
      name: 'Admin Meal Counting',
      description: 'Administrative meal counting and reporting',
      organizationId: organization1.id
    }
  });

  const groupShiftsManagementModule = await prisma.module.create({
    data: {
      name: 'Group Shifts Management',
      description: 'Manage group shifts and recurring schedules',
      organizationId: organization1.id
    }
  });

  const dashboardModule = await prisma.module.create({
    data: {
      name: 'Dashboard',
      description: 'Main dashboard access',
      organizationId: organization1.id
    }
  });

  const profileModule = await prisma.module.create({
    data: {
      name: 'Profile',
      description: 'User profile management',
      organizationId: organization1.id
    }
  });

  console.log('✅ Modules created');

  // Create default role permissions
  console.log('Creating default role permissions...');
  
  // ADMIN role default permissions
  await prisma.roleDefaultPermission.createMany({
    data: [
      { role: 'ADMIN', moduleId: donationManagementModule.id, canAccess: true },
      { role: 'ADMIN', moduleId: adminMealCountingModule.id, canAccess: true },
      { role: 'ADMIN', moduleId: groupShiftsManagementModule.id, canAccess: true },
      { role: 'ADMIN', moduleId: dashboardModule.id, canAccess: true },
      { role: 'ADMIN', moduleId: profileModule.id, canAccess: true },
      { role: 'ADMIN', moduleId: volunteerMealCountingModule.id, canAccess: false },
      { role: 'ADMIN', moduleId: volunteerShiftManagementModule.id, canAccess: false }
    ]
  });

  // STAFF role default permissions
  await prisma.roleDefaultPermission.createMany({
    data: [
      { role: 'STAFF', moduleId: donationManagementModule.id, canAccess: true },
      { role: 'STAFF', moduleId: volunteerMealCountingModule.id, canAccess: true },
      { role: 'STAFF', moduleId: volunteerShiftManagementModule.id, canAccess: true },
      { role: 'STAFF', moduleId: dashboardModule.id, canAccess: true },
      { role: 'STAFF', moduleId: profileModule.id, canAccess: true },
      { role: 'STAFF', moduleId: adminMealCountingModule.id, canAccess: false },
      { role: 'STAFF', moduleId: groupShiftsManagementModule.id, canAccess: false }
    ]
  });

  // VOLUNTEER role default permissions
  await prisma.roleDefaultPermission.createMany({
    data: [
      { role: 'VOLUNTEER', moduleId: donationManagementModule.id, canAccess: true },
      { role: 'VOLUNTEER', moduleId: volunteerMealCountingModule.id, canAccess: true },
      { role: 'VOLUNTEER', moduleId: volunteerShiftManagementModule.id, canAccess: true },
      { role: 'VOLUNTEER', moduleId: dashboardModule.id, canAccess: true },
      { role: 'VOLUNTEER', moduleId: profileModule.id, canAccess: true },
      { role: 'VOLUNTEER', moduleId: adminMealCountingModule.id, canAccess: false },
      { role: 'VOLUNTEER', moduleId: groupShiftsManagementModule.id, canAccess: false }
    ]
  });

  console.log('✅ Default role permissions created');

  console.log('🎉 Database seeding completed successfully!');
  console.log('\n📊 Sample Data Summary:');
  console.log(`- Organizations: 2`);
  console.log(`- Users: 6 (1 Admin, 1 Staff, 3 Volunteers, 1 Hope Kitchen Admin)`);
  console.log(`- Donors: 4`);
  console.log(`- Donation Categories: 6`);
  console.log(`- Shift Categories: 5`);
  console.log(`- Recurring Shifts: 3`);
  console.log(`- Shifts: 4`);
  console.log(`- Shift Registration Fields: 4 (with different field configurations)`);
  console.log(`- Shift Signups: 4`);
  console.log(`- Donations: 4`);
  console.log(`- Donation Items: 8`);
  console.log(`- Weighing Categories: 6`);
  console.log(`- Modules: 7 (Donation Management, Volunteer Meal Counting, Volunteer Shift Management, Admin Meal Counting, Group Shifts Management, Dashboard, Profile)`);
  console.log(`- Role Default Permissions: 21 (7 modules × 3 roles)`);
  console.log('\n🔑 Login Credentials:');
  console.log('Email: admin@communityfoodbank.org');
  console.log('Password: password123');
  console.log('\n🧪 Test Data for New Features:');
  console.log('- Shift 1: Basic fields only (firstName, lastName, email)');
  console.log('- Shift 2: Basic + phone, ageBracket, pronouns, emergency contact');
  console.log('- Shift 3: Comprehensive fields including address, health info, preferences');
  console.log('- Shift 4: Youth volunteer focused with parent/guardian fields');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 