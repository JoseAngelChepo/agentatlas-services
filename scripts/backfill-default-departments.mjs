/**
 * Idempotent backfill: Strategy, Sales, Marketing for every company.
 * Mirrors DepartmentsService.ensureDefaultDepartments().
 *
 * Usage: node scripts/backfill-default-departments.mjs
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const DEFAULT_COMPANY_DEPARTMENTS = [
  { slug: 'strategy', name: 'Strategy', sortOrder: 0 },
  { slug: 'sales', name: 'Sales', sortOrder: 1 },
  { slug: 'marketing', name: 'Marketing', sortOrder: 2 },
];

async function ensureDefaultDepartments(departments, company) {
  const companyId = company._id;
  const userId = company.userId;
  let created = 0;
  let backfilled = 0;
  const now = new Date();

  for (const preset of DEFAULT_COMPANY_DEPARTMENTS) {
    const existing = await departments.findOne({ companyId, slug: preset.slug });

    if (existing) {
      continue;
    }

    const nameTaken = await departments.findOne({ companyId, name: preset.name });

    if (nameTaken) {
      const sortOrder =
        typeof nameTaken.sortOrder === 'number' && nameTaken.sortOrder > preset.sortOrder
          ? preset.sortOrder
          : nameTaken.sortOrder;
      await departments.updateOne(
        { _id: nameTaken._id },
        {
          $set: {
            slug: preset.slug,
            isDefault: true,
            sortOrder,
            updatedAt: now,
          },
        },
      );
      backfilled += 1;
      continue;
    }

    await departments.insertOne({
      companyId,
      userId,
      name: preset.name,
      sortOrder: preset.sortOrder,
      slug: preset.slug,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });
    created += 1;
  }

  return { created, backfilled };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required');
    process.exit(1);
  }

  await mongoose.connect(uri);

  const companiesCol = mongoose.connection.collection('companies');
  const departmentsCol = mongoose.connection.collection('departments');

  const companies = await companiesCol.find({}).toArray();
  let totalCreated = 0;
  let totalBackfilled = 0;

  for (const company of companies) {
    const before = await departmentsCol.countDocuments({ companyId: company._id });
    const { created, backfilled } = await ensureDefaultDepartments(departmentsCol, company);
    const after = await departmentsCol.countDocuments({ companyId: company._id });

    totalCreated += created;
    totalBackfilled += backfilled;

    const label = `${company.name ?? '(unnamed)'} (${company._id})`;
    if (created > 0 || backfilled > 0) {
      console.log(`${label}: +${created} created, ${backfilled} backfilled (${before} → ${after} depts)`);
    } else {
      console.log(`${label}: already complete (${after} depts)`);
    }
  }

  console.log(
    `\nDone. ${companies.length} companies scanned, ${totalCreated} departments created, ${totalBackfilled} backfilled.`,
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
