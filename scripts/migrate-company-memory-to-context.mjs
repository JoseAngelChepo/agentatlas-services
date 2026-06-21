/**
 * One-time migration: companies.memory → context_blocks.
 *
 * Usage: node scripts/migrate-company-memory-to-context.mjs
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const CONTEXT_NAMESPACES = {
  PROFILE: 'profile',
  CUSTOM: 'custom',
};

const COMPANY_PROFILE_KEY = 'default';
const COMPANY_PROFILE_SCHEMA_KEY = 'company_research_v1';

const DEFAULT_COMPANY_MEMORY_COMPANY = {
  target_customers: '',
  primary_icp: '',
  secondary_icp: [],
  company_size: [],
  industries: [],
  buyer_roles: [],
  pain_points: [],
  use_cases: [],
  evidence: [],
  products: [],
  summary: '',
  problem: '',
  solution: '',
  key_features: '',
  one_liner: '',
  what_it_does: '',
  product_type: '',
  category: '',
  subcategories: [],
  keywords: [],
  market_function: '',
  business_outcomes: [],
  buying_triggers: [],
  automation_areas: [],
  website: '',
  stage: '',
  differentiator: '',
  competitors: [],
  key_goals: [],
};

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(String).filter((item) => item.trim().length > 0);
}

function normalizeMemoryCompany(raw) {
  const base = { ...DEFAULT_COMPANY_MEMORY_COMPANY };
  if (!raw) {
    return base;
  }

  const products = Array.isArray(raw.products)
    ? raw.products
        .map((item) => ({
          product: String(item.product ?? '').trim(),
          price: item.price !== undefined ? String(item.price) : '',
          currency: item.currency !== undefined ? String(item.currency) : '',
          billing_period: item.billing_period !== undefined ? String(item.billing_period) : '',
        }))
        .filter((item) => item.product.length > 0)
    : base.products;

  return {
    ...base,
    target_customers:
      raw.target_customers !== undefined ? String(raw.target_customers) : base.target_customers,
    primary_icp: raw.primary_icp !== undefined ? String(raw.primary_icp) : base.primary_icp,
    secondary_icp:
      raw.secondary_icp !== undefined ? normalizeStringList(raw.secondary_icp) : base.secondary_icp,
    company_size:
      raw.company_size !== undefined ? normalizeStringList(raw.company_size) : base.company_size,
    industries:
      raw.industries !== undefined ? normalizeStringList(raw.industries) : base.industries,
    buyer_roles:
      raw.buyer_roles !== undefined ? normalizeStringList(raw.buyer_roles) : base.buyer_roles,
    pain_points:
      raw.pain_points !== undefined ? normalizeStringList(raw.pain_points) : base.pain_points,
    use_cases: raw.use_cases !== undefined ? normalizeStringList(raw.use_cases) : base.use_cases,
    evidence: raw.evidence !== undefined ? normalizeStringList(raw.evidence) : base.evidence,
    products,
    summary: raw.summary !== undefined ? String(raw.summary) : base.summary,
    problem: raw.problem !== undefined ? String(raw.problem) : base.problem,
    solution: raw.solution !== undefined ? String(raw.solution) : base.solution,
    key_features: raw.key_features !== undefined ? String(raw.key_features) : base.key_features,
    one_liner: raw.one_liner !== undefined ? String(raw.one_liner) : base.one_liner,
    what_it_does: raw.what_it_does !== undefined ? String(raw.what_it_does) : base.what_it_does,
    product_type: raw.product_type !== undefined ? String(raw.product_type) : base.product_type,
    category: raw.category !== undefined ? String(raw.category) : base.category,
    subcategories:
      raw.subcategories !== undefined ? normalizeStringList(raw.subcategories) : base.subcategories,
    keywords: raw.keywords !== undefined ? normalizeStringList(raw.keywords) : base.keywords,
    market_function:
      raw.market_function !== undefined ? String(raw.market_function) : base.market_function,
    business_outcomes:
      raw.business_outcomes !== undefined
        ? normalizeStringList(raw.business_outcomes)
        : base.business_outcomes,
    buying_triggers:
      raw.buying_triggers !== undefined
        ? normalizeStringList(raw.buying_triggers)
        : base.buying_triggers,
    automation_areas:
      raw.automation_areas !== undefined
        ? normalizeStringList(raw.automation_areas)
        : base.automation_areas,
    website: raw.website !== undefined ? String(raw.website) : base.website,
    stage: raw.stage !== undefined ? String(raw.stage) : base.stage,
    differentiator:
      raw.differentiator !== undefined ? String(raw.differentiator) : base.differentiator,
    competitors:
      raw.competitors !== undefined ? normalizeStringList(raw.competitors) : base.competitors,
    key_goals:
      raw.key_goals !== undefined
        ? normalizeStringList(raw.key_goals)
        : normalizeStringList(raw.keyGoals ?? base.key_goals),
  };
}

function legacyBriefToCompany(brief) {
  return normalizeMemoryCompany({
    summary: brief.product ?? brief.mission ?? '',
    primary_icp: brief.icp ?? '',
    stage: brief.stage ?? '',
    differentiator: brief.differentiator ?? '',
    competitors: brief.competitors ?? [],
    key_goals: brief.keyGoals ?? brief.key_goals ?? [],
  });
}

function resolveCompanyMemory(company) {
  const memory = company.memory;
  if (memory?.company || memory?.core) {
    return {
      company: normalizeMemoryCompany(memory.company ?? memory.core),
      custom: Array.isArray(memory.custom) ? memory.custom : [],
    };
  }

  if (company.brief) {
    return {
      company: legacyBriefToCompany(company.brief),
      custom: [],
    };
  }

  return {
    company: { ...DEFAULT_COMPANY_MEMORY_COMPANY },
    custom: [],
  };
}

function customKindToBlockKind(kind) {
  switch (kind) {
    case 'list':
      return 'list';
    case 'multiline':
      return 'multiline';
    default:
      return 'text';
  }
}

async function upsertBlock(contextBlocks, block) {
  const now = new Date();
  const filter = {
    scopeType: block.scopeType,
    scopeId: block.scopeId,
    namespace: block.namespace,
    key: block.key,
  };

  const existing = await contextBlocks.findOne(filter);
  if (existing) {
    await contextBlocks.updateOne(
      { _id: existing._id },
      {
        $set: {
          ...block,
          version: (existing.version ?? 1) + 1,
          updatedAt: now,
        },
      },
    );
    return 'updated';
  }

  await contextBlocks.insertOne({
    ...block,
    version: 1,
    source: 'user',
    sourceRunId: null,
    createdAt: now,
    updatedAt: now,
  });
  return 'created';
}

async function migrateCompany(contextBlocks, company) {
  const memory = resolveCompanyMemory(company);
  const companyId = company._id;
  const userId = company.userId;
  let created = 0;
  let updated = 0;

  const profileResult = await upsertBlock(contextBlocks, {
    userId,
    scopeType: 'company',
    scopeId: companyId,
    namespace: CONTEXT_NAMESPACES.PROFILE,
    key: COMPANY_PROFILE_KEY,
    label: 'Company profile',
    kind: 'structured',
    schemaKey: COMPANY_PROFILE_SCHEMA_KEY,
    data: memory.company,
    sortOrder: 0,
  });
  if (profileResult === 'created') created += 1;
  else updated += 1;

  for (const entry of memory.custom) {
    const slug = String(entry.slug ?? '').toLowerCase().trim();
    if (!slug) {
      continue;
    }

    const customResult = await upsertBlock(contextBlocks, {
      userId,
      scopeType: 'company',
      scopeId: companyId,
      namespace: CONTEXT_NAMESPACES.CUSTOM,
      key: slug,
      label: String(entry.label ?? slug),
      kind: customKindToBlockKind(entry.kind),
      data: entry.value,
      sortOrder: typeof entry.sortOrder === 'number' ? entry.sortOrder : 0,
    });
    if (customResult === 'created') created += 1;
    else updated += 1;
  }

  await mongoose.connection.collection('companies').updateOne(
    { _id: companyId },
    { $unset: { memory: '', brief: '' } },
  );

  return { created, updated };
}

async function seedMissingProfiles(contextBlocks, companies) {
  let seeded = 0;

  for (const company of companies) {
    const existing = await contextBlocks.findOne({
      scopeType: 'company',
      scopeId: company._id,
      namespace: CONTEXT_NAMESPACES.PROFILE,
      key: COMPANY_PROFILE_KEY,
    });

    if (existing) {
      continue;
    }

    await upsertBlock(contextBlocks, {
      userId: company.userId,
      scopeType: 'company',
      scopeId: company._id,
      namespace: CONTEXT_NAMESPACES.PROFILE,
      key: COMPANY_PROFILE_KEY,
      label: 'Company profile',
      kind: 'structured',
      schemaKey: COMPANY_PROFILE_SCHEMA_KEY,
      data: { ...DEFAULT_COMPANY_MEMORY_COMPANY },
      sortOrder: 0,
    });
    seeded += 1;
  }

  return seeded;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required');
    process.exit(1);
  }

  await mongoose.connect(uri);

  const companiesCol = mongoose.connection.collection('companies');
  const contextBlocksCol = mongoose.connection.collection('context_blocks');

  const companies = await companiesCol.find({}).toArray();
  let totalCreated = 0;
  let totalUpdated = 0;
  let migrated = 0;

  for (const company of companies) {
    const hasLegacyMemory = Boolean(company.memory || company.brief);
    if (!hasLegacyMemory) {
      continue;
    }

    const { created, updated } = await migrateCompany(contextBlocksCol, company);
    totalCreated += created;
    totalUpdated += updated;
    migrated += 1;
    console.log(
      `${company.name ?? '(unnamed)'} (${company._id}): ${created} blocks created, ${updated} updated, memory unset`,
    );
  }

  const allCompanies = await companiesCol.find({}).toArray();
  const seeded = await seedMissingProfiles(contextBlocksCol, allCompanies);

  console.log(
    `\nDone. ${companies.length} companies scanned, ${migrated} migrated, ${totalCreated} blocks created, ${totalUpdated} updated, ${seeded} empty profiles seeded.`,
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
