const readline = require('readline');
const postgres = require('postgres');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('--------------------------------------------------');
console.log('Supabase Database Migration Tool');
console.log('--------------------------------------------------');
console.log('To run this migration, we need your IPv4 Connection Pooler URI.');
console.log('You can find it in your Supabase Dashboard under:');
console.log('👉 Project Settings (gear icon) -> Database -> Connection Pooler');
console.log('Mode: Session (Port 5432 or 6543)');
console.log('--------------------------------------------------\n');

rl.question('🔑 Paste your Connection Pooler URI (e.g. postgres://postgres.iuccdegvxugrnmgwzwtj:eg4qLJDooJD8J036@...): ', async (connectionString) => {
  rl.close();
  
  if (!connectionString || !connectionString.trim()) {
    console.error('❌ Connection string cannot be empty.');
    process.exit(1);
  }

  // Replace password placeholder if user forgot to replace it
  let finalUri = connectionString.trim();
  if (finalUri.includes('[YOUR-PASSWORD]')) {
    finalUri = finalUri.replace('[YOUR-PASSWORD]', 'eg4qLJDooJD8J036');
    console.log('Replacing [YOUR-PASSWORD] placeholder with your database password...');
  } else if (finalUri.includes('YOUR-PASSWORD')) {
    finalUri = finalUri.replace('YOUR-PASSWORD', 'eg4qLJDooJD8J036');
    console.log('Replacing YOUR-PASSWORD placeholder with your database password...');
  }

  const sql = postgres(finalUri);

  console.log('\n🔄 Connecting to Supabase PostgreSQL database...');
  try {
    console.log('⚠️ Dropping old hosts and users tables if they exist...');
    await sql`drop table if exists hosts;`;
    await sql`drop table if exists users;`;

    console.log('📦 Creating hosts table with native auth.users foreign key...');
    await sql`
      create table hosts (
        id uuid default gen_random_uuid() primary key,
        user_id uuid references auth.users(id) on delete cascade not null,
        name text not null,
        host text not null,
        port integer not null default 22,
        username text not null,
        password text,
        created_at timestamp with time zone default timezone('utc'::text, now()) not null
      );
    `;

    console.log('🔒 Enabling Row Level Security (RLS) on hosts table...');
    await sql`alter table hosts enable row level security;`;

    console.log('🛡️ Creating RLS Policy: Users can view their own hosts...');
    await sql`
      create policy "Users can view their own hosts"
        on hosts for select
        using (auth.uid() = user_id);
    `;

    console.log('🛡️ Creating RLS Policy: Users can insert their own hosts...');
    await sql`
      create policy "Users can insert their own hosts"
        on hosts for insert
        with check (auth.uid() = user_id);
    `;

    console.log('🛡️ Creating RLS Policy: Users can update their own hosts...');
    await sql`
      create policy "Users can update their own hosts"
        on hosts for update
        using (auth.uid() = user_id);
    `;

    console.log('🛡️ Creating RLS Policy: Users can delete their own hosts...');
    await sql`
      create policy "Users can delete their own hosts"
        on hosts for delete
        using (auth.uid() = user_id);
    `;

    console.log('🔔 Reloading PostgREST schema cache...');
    await sql`NOTIFY pgrst, 'reload schema';`;

    console.log('\n🚀 Migration completed successfully! Your tables are ready and secure.');
  } catch (err) {
    console.error('\n❌ Migration failed:', err);
  } finally {
    await sql.end();
  }
});
