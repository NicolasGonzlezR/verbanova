const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const email = "admin@mail.com";
  const username = "admin";
  const passwordHash = await bcrypt.hash("adminadmin", 12);

  await prisma.user.upsert({
    where: { email },
    update: { username, passwordHash },
    create: { email, username, passwordHash },
  });

  console.log("Admin user ready:", email);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
