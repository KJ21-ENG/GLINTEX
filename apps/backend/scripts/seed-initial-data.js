import { PrismaClient } from '@prisma/client';
import { ensureDefaultAdminUser } from '../src/utils/defaultAdmin.js';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

const ROLES = [
    { key: 'admin', name: 'Administrator', description: 'Full system access' },
    { key: 'operator', name: 'Operator', description: 'Machine operator' },
    { key: 'viewer', name: 'Viewer', description: 'Read-only access' }
];

async function main() {
    console.log('Seeding roles...');
    for (const role of ROLES) {
        await prisma.role.upsert({
            where: { key: role.key },
            update: {},
            create: role,
        });
        console.log(`Role ensured: ${role.key}`);
    }

    console.log('Ensuring default admin user...');
    try {
        const result = await ensureDefaultAdminUser();
        console.log('Admin user result:', result);
    } catch (error) {
        console.error('Error creating admin user:', error);
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
