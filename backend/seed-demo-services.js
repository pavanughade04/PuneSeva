require('dotenv').config();

const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const { pool } = require('./config/db');

const TARGET_COUNT = 20;
const ADDITIONAL_SERVICES_PER_CATEGORY = 10;
const ADDITIONAL_CATEGORIES = [
  'Electrician',
  'Plumber',
  'AC Repair',
  'Cleaning',
  'Painting',
  'Carpenter',
  'Home Appliance Repair',
  'Pest Control',
  'Tutor',
  'Beauty Services',
  'Vehicle Repair',
  'Packers and Movers'
];
const SEED_LOCK_NAME = 'pune_seva_demo_services_seed';
const DEMO_PREFIX = '[DEMO]';
const LOCATION = 'Pune';

const electricianServices = [
  ['Electrical fault diagnosis', 'Inspect household circuits and identify the cause of an electrical fault.', 499, 'fixed'],
  ['Switchboard repair', 'Repair loose connections and common faults in a household switchboard.', 299, 'fixed'],
  ['Ceiling fan installation', 'Install and test one ceiling fan using an existing electrical point.', 599, 'fixed'],
  ['LED light fitting installation', 'Fit and test LED lights at existing household electrical points.', 399, 'fixed'],
  ['Power socket replacement', 'Replace one damaged power socket and check its connection.', 250, 'fixed'],
  ['MCB replacement and testing', 'Replace a compatible miniature circuit breaker and test the circuit.', 699, 'fixed'],
  ['Doorbell installation', 'Install and test a wired doorbell using an existing connection.', 450, 'fixed'],
  ['Exhaust fan installation', 'Install and test an exhaust fan at a prepared electrical point.', 650, 'fixed'],
  ['Home wiring inspection', 'Inspect accessible wiring and provide an estimate for any required repairs.', 799, 'starting_from'],
  ['Earthing inspection', 'Check the household earthing connection and report visible issues.', 599, 'fixed'],
  ['Inverter connection setup', 'Connect an inverter to compatible household wiring and test the changeover.', 999, 'fixed'],
  ['Short-circuit troubleshooting', 'Trace a household short-circuit issue and recommend a safe repair.', 499, 'fixed'],
  ['Geyser connection wiring', 'Inspect and connect geyser wiring at an existing suitable point.', 549, 'fixed'],
  ['Modular switch installation', 'Install modular switches and verify operation at one switchboard.', 350, 'fixed'],
  ['CCTV power point wiring', 'Provide an estimate to prepare a power point for a CCTV installation.', 1299, 'starting_from'],
  ['Outdoor light installation', 'Install an outdoor light at an existing weather-protected electrical point.', 799, 'fixed'],
  ['Appliance electrical connection', 'Inspect and connect one household appliance to a compatible power point.', 499, 'hourly'],
  ['Concealed wiring repair', 'Assess concealed wiring symptoms and provide a repair estimate.', 899, 'starting_from'],
  ['Electrical safety inspection', 'Check common household electrical points and share safety recommendations.', 699, 'fixed'],
  ['Lighting circuit repair', 'Troubleshoot and repair a fault in one household lighting circuit.', 599, 'fixed']
].map(([title, details, price, priceType]) => ({ title, details, price, priceType }));

const genericServiceTemplates = [
  ['Inspection and diagnosis', 'Inspect the requested work and explain the recommended next steps.'],
  ['Minor repair visit', 'Assess and complete a minor repair where parts and access allow.'],
  ['Installation service', 'Install one suitable item at a prepared location.'],
  ['Preventive maintenance', 'Carry out a basic maintenance visit and note any issues found.'],
  ['Replacement service', 'Assess and replace one compatible item supplied for the work.'],
  ['New setup service', 'Set up the requested service at the customer location.'],
  ['Troubleshooting visit', 'Investigate a reported issue and recommend a practical solution.'],
  ['Safety check', 'Check the requested work area and provide safety recommendations.'],
  ['Repair estimate visit', 'Inspect the work and provide an estimate before major repairs.'],
  ['Routine service visit', 'Complete a routine service visit for the requested work.'],
  ['Upgrade consultation', 'Review the requested upgrade and recommend suitable options.'],
  ['Quality check visit', 'Check completed work and identify any follow-up items.'],
  ['Small project service', 'Handle a small project after confirming the scope at the location.'],
  ['Home visit consultation', 'Discuss the service requirement and recommend next steps.'],
  ['Parts replacement visit', 'Inspect the item and replace a compatible part if available.'],
  ['Seasonal maintenance', 'Perform a basic seasonal check and report maintenance needs.'],
  ['On-site assessment', 'Assess the service requirement in person before work begins.'],
  ['Follow-up service visit', 'Review an earlier service issue and complete suitable follow-up work.'],
  ['Standard service package', 'Complete a standard service visit for the requested work.'],
  ['Detailed service assessment', 'Provide a detailed assessment and a clear work recommendation.']
].map(([title, details], index) => ({
  title,
  details,
  price: 250 + (index * 75),
  priceType: ['fixed', 'starting_from', 'hourly'][index % 3]
}));

const additionalCategoryTemplates = {
  electrician: [
    ['EV charger point assessment', 'Assess the electrical load and installation requirements for a home EV charging point.', 999, 'fixed'],
    ['Home electrical load assessment', 'Review household circuits and recommend suitable load balancing.', 799, 'fixed'],
    ['Smart switch installation', 'Install and test a compatible smart switch at a prepared switchboard.', 899, 'fixed'],
    ['Surge protection installation', 'Assess and install a compatible surge protection device for the home.', 1499, 'starting_from'],
    ['Electrical panel labelling', 'Identify and label accessible household circuit breakers for easier reference.', 599, 'fixed'],
    ['Generator connection inspection', 'Inspect a prepared generator connection and check visible electrical safety points.', 999, 'fixed'],
    ['Garden lighting installation', 'Install outdoor lights at existing weather-protected electrical points.', 1199, 'starting_from'],
    ['Bathroom exhaust wiring check', 'Inspect the wiring and switch for a bathroom exhaust fan.', 399, 'fixed'],
    ['Power backup maintenance', 'Check inverter connections and carry out basic power backup maintenance.', 699, 'fixed'],
    ['Dedicated appliance circuit assessment', 'Assess the requirements for a dedicated circuit for a household appliance.', 699, 'fixed']
  ],
  plumber: [
    ['Tap and faucet repair', 'Inspect and repair a leaking or loose household tap or faucet.', 299, 'fixed'],
    ['Toilet flush repair', 'Diagnose and repair common faults in a household toilet flush mechanism.', 399, 'fixed'],
    ['Kitchen sink drain clearing', 'Clear a minor blockage in an accessible kitchen sink drain.', 499, 'fixed'],
    ['Bathroom drain cleaning', 'Inspect and clear a minor blockage in an accessible bathroom drain.', 499, 'fixed'],
    ['Shower mixer installation', 'Install a compatible shower mixer at a prepared plumbing connection.', 699, 'fixed'],
    ['Water tank float valve repair', 'Inspect and repair a compatible household water tank float valve.', 449, 'fixed'],
    ['Pipe leak inspection', 'Inspect accessible household pipes and identify the source of a visible leak.', 399, 'fixed'],
    ['Washbasin installation', 'Install a compatible washbasin at a prepared plumbing point.', 1499, 'starting_from'],
    ['Water filter plumbing setup', 'Connect a compatible water filter to an existing suitable water line.', 599, 'fixed'],
    ['Geyser pipe connection repair', 'Inspect and repair accessible geyser inlet or outlet pipe connections.', 549, 'fixed']
  ],
  'ac repair': [
    ['Split AC routine service', 'Clean accessible filters and inspect a split AC unit for routine maintenance needs.', 699, 'fixed'],
    ['AC filter cleaning', 'Clean reusable filters and check airflow on one household AC unit.', 399, 'fixed'],
    ['Cooling issue diagnosis', 'Inspect an AC unit and identify common causes of reduced cooling.', 499, 'fixed'],
    ['Condensate drain clearing', 'Inspect and clear an accessible AC condensate drain line.', 449, 'fixed'],
    ['Outdoor unit cleaning', 'Clean accessible external surfaces of one AC outdoor unit.', 599, 'fixed'],
    ['AC gas leak inspection', 'Inspect accessible AC connections for signs of refrigerant leakage and report findings.', 699, 'fixed'],
    ['Thermostat troubleshooting', 'Check AC temperature controls and diagnose common thermostat issues.', 499, 'fixed'],
    ['Window AC maintenance', 'Carry out a basic inspection and cleaning of one window AC unit.', 599, 'fixed'],
    ['AC installation assessment', 'Assess a room and existing connections before a new AC installation.', 399, 'fixed'],
    ['AC relocation estimate', 'Inspect an AC unit and provide an estimate for relocation and recommissioning.', 999, 'starting_from']
  ],
  cleaning: [
    ['One-bedroom deep cleaning', 'Deep clean accessible rooms, kitchen surfaces, and floors in a one-bedroom home.', 2499, 'fixed'],
    ['Kitchen degreasing service', 'Clean common kitchen surfaces and remove routine grease buildup.', 999, 'fixed'],
    ['Bathroom deep cleaning', 'Deep clean tiles, fixtures, and accessible surfaces in one bathroom.', 799, 'fixed'],
    ['Sofa vacuum cleaning', 'Vacuum one fabric sofa and remove loose dust from accessible upholstery.', 699, 'fixed'],
    ['Mattress vacuum cleaning', 'Vacuum one mattress and clean its accessible surfaces.', 599, 'fixed'],
    ['Window and balcony cleaning', 'Clean accessible windows and balcony floor surfaces in one home.', 899, 'fixed'],
    ['Move-in cleaning', 'Clean an unoccupied home before move-in; final price depends on size and condition.', 2499, 'starting_from'],
    ['Post-renovation dust cleanup', 'Remove ordinary surface dust after minor home work; heavy debris is excluded.', 3499, 'starting_from'],
    ['Water tank cleaning', 'Clean one accessible household water tank using standard hygiene procedures.', 1299, 'fixed'],
    ['Regular home cleaning visit', 'Complete a routine cleaning visit for common household rooms and surfaces.', 599, 'fixed']
  ],
  painting: [
    ['Single room wall repainting', 'Prepare and repaint one room; final scope depends on wall condition and paint choice.', 3999, 'starting_from'],
    ['Interior paint consultation', 'Review interior surfaces and provide a paint and scope estimate.', 399, 'fixed'],
    ['Wall crack putty preparation', 'Prepare and fill minor surface cracks before painting.', 899, 'starting_from'],
    ['Door and window repainting', 'Prepare and repaint one compatible interior door or window frame.', 1299, 'starting_from'],
    ['Kitchen wall repainting', 'Prepare and repaint a small kitchen wall area with suitable interior paint.', 2499, 'starting_from'],
    ['Exterior wall paint estimate', 'Inspect accessible exterior surfaces and provide a painting estimate.', 499, 'fixed'],
    ['Ceiling repainting', 'Prepare and repaint a room ceiling; final price depends on room size and condition.', 1999, 'starting_from'],
    ['Texture paint sample consultation', 'Review a wall and demonstrate suitable texture paint options.', 599, 'fixed'],
    ['Touch-up painting visit', 'Touch up small scuffs and paint marks using a compatible paint shade.', 799, 'fixed'],
    ['Full apartment painting estimate', 'Assess apartment rooms and provide a written painting scope estimate.', 699, 'fixed']
  ],
  carpenter: [
    ['Door hinge repair', 'Adjust or replace compatible hinges on one household door.', 399, 'fixed'],
    ['Cupboard hinge replacement', 'Replace compatible hinges on a cupboard door and check alignment.', 349, 'fixed'],
    ['Drawer channel repair', 'Inspect and repair or replace one compatible drawer channel.', 499, 'fixed'],
    ['Bed assembly', 'Assemble one standard bed frame using the supplied fittings.', 799, 'fixed'],
    ['Shelf installation', 'Install one shelf on a suitable wall after checking the mounting point.', 599, 'fixed'],
    ['Window latch repair', 'Adjust or replace a compatible latch on one household window.', 349, 'fixed'],
    ['Furniture polishing estimate', 'Inspect furniture surfaces and provide an estimate for polishing work.', 399, 'fixed'],
    ['Study table consultation', 'Discuss dimensions and provide a quote for a custom study table.', 299, 'fixed'],
    ['Wooden door lock fitting', 'Fit a compatible lock to a prepared wooden door.', 699, 'fixed'],
    ['Wardrobe alignment and repair', 'Adjust wardrobe doors and repair common hinges or fittings.', 599, 'fixed']
  ],
  'home appliance repair': [
    ['Washing machine inspection', 'Inspect a household washing machine and diagnose common operating issues.', 499, 'fixed'],
    ['Refrigerator cooling diagnosis', 'Check a refrigerator and identify common causes of inadequate cooling.', 599, 'fixed'],
    ['Microwave repair assessment', 'Inspect a microwave and provide an estimate for a repair if needed.', 399, 'fixed'],
    ['Mixer grinder repair', 'Diagnose common mixer grinder motor, jar, or switch issues.', 349, 'fixed'],
    ['Water purifier service', 'Inspect a household water purifier and report routine maintenance needs.', 599, 'fixed'],
    ['Dishwasher troubleshooting', 'Inspect a dishwasher and diagnose common cleaning or drainage issues.', 499, 'fixed'],
    ['Geyser maintenance', 'Inspect a household geyser and check common maintenance points.', 599, 'fixed'],
    ['Oven heating repair assessment', 'Check an oven with heating issues and provide a repair estimate.', 499, 'fixed'],
    ['Vacuum cleaner repair', 'Diagnose common vacuum cleaner suction, cable, or switch issues.', 399, 'fixed'],
    ['Appliance electrical safety check', 'Check visible plug, cable, and connection condition for one appliance.', 299, 'fixed']
  ],
  'pest control': [
    ['General household pest inspection', 'Inspect common household areas and recommend an appropriate pest-control plan.', 399, 'fixed'],
    ['Cockroach control service', 'Provide a household cockroach-control visit using suitable professional methods.', 899, 'fixed'],
    ['Ant treatment service', 'Inspect common ant entry points and provide a targeted household treatment.', 699, 'fixed'],
    ['Mosquito breeding-site inspection', 'Inspect accessible areas for standing water and advise on prevention.', 499, 'fixed'],
    ['Termite inspection', 'Inspect accessible woodwork and report signs that may require termite treatment.', 599, 'fixed'],
    ['Bed bug inspection', 'Inspect bedding and nearby furniture for signs of bed bugs and advise next steps.', 599, 'fixed'],
    ['Rodent entry-point assessment', 'Inspect accessible areas for rodent entry points and recommend prevention measures.', 499, 'fixed'],
    ['Kitchen pest-control visit', 'Inspect a household kitchen and provide a suitable pest-control service.', 799, 'fixed'],
    ['Pre-monsoon pest prevention', 'Carry out a household inspection and recommend seasonal pest-prevention measures.', 699, 'fixed'],
    ['Follow-up pest inspection', 'Revisit treated areas and review whether further professional service is needed.', 399, 'fixed']
  ],
  tutor: [
    ['Mathematics tutoring session', 'One-to-one mathematics support tailored to the student’s current syllabus.', 500, 'hourly'],
    ['Science tutoring session', 'One-to-one science tutoring with practice questions for the student’s level.', 500, 'hourly'],
    ['English grammar tutoring', 'Practice English grammar and writing skills in an individual lesson.', 450, 'hourly'],
    ['Primary homework support', 'Support a primary-school student with homework and study routines.', 350, 'hourly'],
    ['Exam preparation session', 'Review topics and practice questions ahead of an upcoming examination.', 600, 'hourly'],
    ['Spoken English practice', 'Practice conversation and everyday spoken English in a guided session.', 450, 'hourly'],
    ['Basic computer tutoring', 'Learn basic computer use and common office tasks in a one-to-one lesson.', 450, 'hourly'],
    ['Coding fundamentals lesson', 'Introduce programming fundamentals through age-appropriate exercises.', 650, 'hourly'],
    ['One-to-one study planning', 'Create a practical study plan based on subjects, goals, and available time.', 399, 'fixed'],
    ['Weekly revision tutoring', 'Review recent lessons and practice key concepts in a scheduled session.', 450, 'hourly']
  ],
  'beauty services': [
    ['At-home haircut and styling', 'Provide a basic haircut and styling appointment at the customer’s home.', 699, 'fixed'],
    ['Hair wash and styling', 'Wash and style hair using customer-preferred products where available.', 499, 'fixed'],
    ['Basic facial appointment', 'Provide a basic facial service after confirming skin-care preferences.', 999, 'fixed'],
    ['Manicure appointment', 'Provide a basic manicure and nail-care appointment.', 499, 'fixed'],
    ['Pedicure appointment', 'Provide a basic pedicure and foot-care appointment.', 599, 'fixed'],
    ['Bridal makeup consultation', 'Discuss a bridal makeup look, timing, and service requirements.', 499, 'fixed'],
    ['Party makeup appointment', 'Provide a party makeup appointment with the agreed look and products.', 1499, 'starting_from'],
    ['Saree draping service', 'Provide saree draping assistance for an event or occasion.', 499, 'fixed'],
    ['At-home grooming appointment', 'Provide a basic grooming service based on the customer’s requested scope.', 699, 'fixed'],
    ['Hair-care consultation', 'Discuss hair-care preferences and recommend suitable salon services.', 299, 'fixed']
  ],
  'vehicle repair': [
    ['Two-wheeler basic inspection', 'Inspect common two-wheeler maintenance points and report visible concerns.', 399, 'fixed'],
    ['Car battery test and estimate', 'Test a vehicle battery and provide a replacement estimate if needed.', 399, 'fixed'],
    ['Puncture repair visit', 'Inspect and repair one accessible vehicle tyre puncture where suitable.', 499, 'fixed'],
    ['Engine oil change service', 'Replace engine oil using a compatible customer-approved product.', 699, 'starting_from'],
    ['Brake inspection', 'Inspect visible brake components and recommend any required workshop repair.', 399, 'fixed'],
    ['Car AC diagnosis', 'Check a vehicle AC system and identify common cooling issues.', 599, 'fixed'],
    ['Vehicle breakdown assistance', 'Provide roadside assessment and recommend safe next steps for a breakdown.', 999, 'starting_from'],
    ['Headlight and bulb replacement', 'Replace a compatible vehicle headlight or bulb supplied for the service.', 299, 'fixed'],
    ['Vehicle periodic maintenance', 'Carry out a basic maintenance inspection for a car or two-wheeler.', 799, 'starting_from'],
    ['Pre-purchase vehicle inspection', 'Inspect common visible vehicle condition points before a purchase decision.', 999, 'fixed']
  ],
  'packers and movers': [
    ['Local one-room move estimate', 'Assess a one-room household move and provide a local relocation estimate.', 399, 'fixed'],
    ['Packing materials and service', 'Pack household items using suitable packing materials for a local move.', 1499, 'starting_from'],
    ['Furniture disassembly and reassembly', 'Disassemble and reassemble standard furniture for a local relocation.', 999, 'starting_from'],
    ['Loading and unloading helpers', 'Provide helpers for loading or unloading household goods at one location.', 1499, 'starting_from'],
    ['Appliance packing and transport', 'Pack and move household appliances with suitable protective materials.', 1999, 'starting_from'],
    ['Small office relocation', 'Assess and coordinate packing and movement for a small office.', 4999, 'starting_from'],
    ['Unpacking and placement service', 'Unpack boxed household goods and place items in agreed rooms.', 999, 'starting_from'],
    ['Two-wheeler transport estimate', 'Assess a two-wheeler relocation and provide a transport estimate.', 399, 'fixed'],
    ['Fragile item packing service', 'Pack selected fragile household items using suitable protective materials.', 899, 'starting_from'],
    ['Local household relocation', 'Assess household goods and provide a local moving estimate.', 2499, 'starting_from']
  ]
};

function templatesForCategory(category, addCategories) {
  const normalizedCategory = category.trim().toLocaleLowerCase();
  if (addCategories) {
    const templates = additionalCategoryTemplates[normalizedCategory];
    if (!templates) throw new Error(`No additional demo templates are defined for "${category}".`);
    return templates.map(([title, details, price, priceType]) => ({ title, details, price, priceType }));
  }
  return normalizedCategory === 'electrician' ? electricianServices : genericServiceTemplates;
}

async function getTableColumns(connection, tableName) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_NAME, COLUMN_TYPE
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  return new Map(rows.map((row) => [row.COLUMN_NAME, row.COLUMN_TYPE]));
}

function assertRequiredColumns(columns) {
  const required = ['id', 'provider_id', 'service_name', 'category', 'price', 'location'];
  const missing = required.filter((column) => !columns.has(column));
  if (missing.length > 0) {
    throw new Error(`The services table is missing required columns: ${missing.join(', ')}.`);
  }
}

function getAllowedEnumValues(columnType) {
  if (!columnType || !columnType.startsWith('enum(')) return [];
  return [...columnType.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((match) => match[1]);
}

async function getEligibleProviders(connection, providerColumns, userColumns) {
  if (!providerColumns.has('user_id') || !providerColumns.has('approval_status') || !userColumns.has('role')) {
    throw new Error('Cannot safely identify approved providers in this database schema.');
  }

  const conditions = ["u.role = 'provider'", "p.approval_status = 'approved'"];
  if (userColumns.has('account_status')) conditions.push("u.account_status = 'active'");
  else if (userColumns.has('is_active')) conditions.push('u.is_active = 1');

  const [rows] = await connection.execute(
    `SELECT p.user_id AS provider_id
     FROM provider_profiles AS p
     JOIN users AS u ON u.id = p.user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY p.user_id`
  );
  return rows.map((row) => Number(row.provider_id));
}

async function buildPlan(connection, serviceColumns, providers, addCategories = false) {
  const [categoryRows] = await connection.execute(
    `SELECT category, COUNT(*) AS service_count
     FROM services
     WHERE category IS NOT NULL AND TRIM(category) <> ''
     GROUP BY category
     ORDER BY category`
  );
  const currentCounts = new Map(
    categoryRows.map((row) => [String(row.category).trim().toLocaleLowerCase(), Number(row.service_count)])
  );
  const categories = addCategories
    ? ADDITIONAL_CATEGORIES.map((category) => ({
      category,
      currentCount: currentCounts.get(category.toLocaleLowerCase()) || 0
    }))
    : categoryRows.map((row) => ({
      category: row.category,
      currentCount: Number(row.service_count)
    }));

  const overTarget = addCategories
    ? []
    : categories.filter(({ currentCount }) => currentCount > TARGET_COUNT);
  if (overTarget.length > 0) {
    throw new Error(
      `Cannot safely reach exactly ${TARGET_COUNT} services without deleting existing records: ` +
      overTarget.map(({ category, currentCount }) => `${category} (${currentCount})`).join(', ')
    );
  }
  if (categories.length === 0) {
    throw new Error('No existing service categories were found in services.category.');
  }
  if (providers.length === 0) {
    throw new Error('No active, approved provider accounts are available for the demo services.');
  }

  const canApprove = serviceColumns.has('approval_status')
    && providers.length > 0;
  const approvalStatus = canApprove ? 'approved' : 'pending';
  const isAvailable = canApprove ? 1 : 0;
  const priceTypeValues = getAllowedEnumValues(serviceColumns.get('price_type'));
  const plan = [];
  const summary = [];

  for (const { category, currentCount } of categories) {
    const [existingRows] = await connection.execute(
      'SELECT service_name FROM services WHERE category = ?',
      [category]
    );
    const existingNames = new Set(existingRows.map((row) => String(row.service_name).toLocaleLowerCase()));
    const templates = templatesForCategory(category, addCategories);
    const needed = addCategories
      ? templates.filter((template) => !existingNames.has(
        `${DEMO_PREFIX} ${category} - ${template.title}`.toLocaleLowerCase()
      )).length
      : TARGET_COUNT - currentCount;
    const categoryPlan = [];

    for (let index = 0; index < templates.length && categoryPlan.length < needed; index += 1) {
      const template = templates[index];
      const serviceName = `${DEMO_PREFIX} ${category} - ${template.title}`;
      if (existingNames.has(serviceName.toLocaleLowerCase())) continue;

      if (serviceColumns.has('price_type') && !priceTypeValues.includes(template.priceType)) {
        throw new Error(`The services.price_type column does not support "${template.priceType}".`);
      }

      const record = {
        providerId: providers[(plan.length + categoryPlan.length) % providers.length],
        serviceName,
        category,
        description: `[DEMO DATA] ${template.details}`,
        location: LOCATION,
        price: template.price,
        priceType: serviceColumns.has('price_type') ? template.priceType : 'fixed',
        isAvailable,
        approvalStatus
      };
      if (serviceColumns.has('service_name') && serviceName.length > 150) {
        throw new Error(`Generated service name is too long for category "${category}".`);
      }
      if (serviceColumns.has('description') && record.description.length > 6000) {
        throw new Error(`Generated description is too long for category "${category}".`);
      }
      categoryPlan.push(record);
      existingNames.add(serviceName.toLocaleLowerCase());
    }

    if (categoryPlan.length !== needed) {
      throw new Error(`Not enough unique demo templates are available for category "${category}".`);
    }

    summary.push({
      category,
      previousCount: currentCount,
      toAdd: categoryPlan.length,
      finalCount: currentCount + categoryPlan.length
    });
    plan.push(...categoryPlan);
  }

  return { categories: summary, records: plan };
}

function printPreview(plan, addCategories, apply) {
  console.log(apply
    ? 'Mode: APPLY (database changes require the confirmation phrase below)'
    : 'Mode: DRY RUN (no database changes)');
  if (addCategories) {
    console.log(`Plan: add up to ${ADDITIONAL_SERVICES_PER_CATEGORY} new demo services to each of the ${ADDITIONAL_CATEGORIES.length} configured categories.`);
  } else {
    console.log(`Plan: fill each existing category to ${TARGET_COUNT} services.`);
  }
  console.log(`Categories found: ${plan.categories.length}`);
  console.table(plan.categories);
  console.log('Proposed service records:');
  console.table(plan.records.map((record) => ({
    category: record.category,
    name: record.serviceName,
    description: record.description,
    providerId: record.providerId,
    priceINR: record.price,
    priceType: record.priceType,
    location: record.location,
    approvalStatus: record.approvalStatus,
    isAvailable: record.isAvailable
  })));
}

async function confirmApply(recordCount) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(`Type INSERT ${recordCount} DEMO SERVICES to continue: `);
    return answer.trim() === `INSERT ${recordCount} DEMO SERVICES`;
  } finally {
    rl.close();
  }
}

async function insertRecords(connection, serviceColumns, records) {
  const optionalColumns = [
    'description',
    'price_type',
    'is_available',
    'approval_status'
  ].filter((column) => serviceColumns.has(column));
  const columns = ['provider_id', 'service_name', 'category', ...optionalColumns, 'location', 'price'];
  const placeholders = columns.map(() => '?').join(', ');

  for (const record of records) {
    const valuesByColumn = {
      provider_id: record.providerId,
      service_name: record.serviceName,
      category: record.category,
      description: record.description,
      price_type: record.priceType,
      is_available: record.isAvailable,
      approval_status: record.approvalStatus,
      location: record.location,
      price: record.price
    };
    const values = columns.map((column) => valuesByColumn[column]);
    await connection.execute(
      `INSERT INTO services (${columns.join(', ')}) VALUES (${placeholders})`,
      values
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const addCategories = args.includes('--add-categories');
  if (args.includes('--apply') && args.includes('--dry-run')) {
    throw new Error('Choose either --dry-run or --apply, not both.');
  }
  if (args.some((argument) => !['--apply', '--dry-run', '--add-categories'].includes(argument))) {
    throw new Error('Usage: node seed-demo-services.js [--add-categories] [--dry-run|--apply].');
  }

  const connection = await pool.getConnection();
  let lockAcquired = false;
  let transactionStarted = false;
  try {
    const serviceColumns = await getTableColumns(connection, 'services');
    const providerColumns = await getTableColumns(connection, 'provider_profiles');
    const userColumns = await getTableColumns(connection, 'users');
    assertRequiredColumns(serviceColumns);

    if (apply) {
      const [lockRows] = await connection.execute('SELECT GET_LOCK(?, 10) AS acquired', [SEED_LOCK_NAME]);
      lockAcquired = Number(lockRows[0].acquired) === 1;
      if (!lockAcquired) throw new Error('Could not acquire the demo-service seed lock. Try again.');
      await connection.beginTransaction();
      transactionStarted = true;
    }

    const providers = await getEligibleProviders(connection, providerColumns, userColumns);
    const plan = await buildPlan(connection, serviceColumns, providers, addCategories);
    printPreview(plan, addCategories, apply);

    if (!apply) return;
    if (plan.records.length === 0) {
      console.log('No new demo services are needed. Nothing to insert.');
      await connection.rollback();
      transactionStarted = false;
      return;
    }

    if (!(await confirmApply(plan.records.length))) {
      console.log('Confirmation did not match. No services were inserted.');
      await connection.rollback();
      transactionStarted = false;
      return;
    }

    await insertRecords(connection, serviceColumns, plan.records);
    const [finalRows] = await connection.execute(
      `SELECT category, COUNT(*) AS service_count
       FROM services
       WHERE category IS NOT NULL AND TRIM(category) <> ''
       GROUP BY category
       ORDER BY category`
    );
    const finalCounts = new Map(finalRows.map((row) => [row.category, Number(row.service_count)]));
    const invalidCounts = plan.categories.filter(
      ({ category, finalCount }) => finalCounts.get(category) !== finalCount
    );
    if (invalidCounts.length > 0) {
      throw new Error('Final category counts did not match the target; transaction will be rolled back.');
    }

    await connection.commit();
    transactionStarted = false;
    console.log('Demo services inserted and verified:');
    console.table(plan.categories.map((row) => ({
      category: row.category,
      previousCount: row.previousCount,
      added: row.toAdd,
      finalCount: finalCounts.get(row.category)
    })));
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally {
    try {
      if (lockAcquired) {
        await connection.execute('SELECT RELEASE_LOCK(?)', [SEED_LOCK_NAME]);
      }
    } finally {
      connection.release();
    }
  }
}

main()
  .catch((error) => {
    console.error('Demo service seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
